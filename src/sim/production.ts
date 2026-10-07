/**
 * Production — supply chains that turn inputs into outputs (spec §21).
 *
 * A production line lives on a property with the right production tag, needs
 * inputs in its buffer, labour assigned to it (or automation), energy paid for in
 * cash, and it produces outputs plus occasional byproducts at a quality that
 * depends on worker skill. Breakdowns, waste and wear are real.
 *
 * Wages are *not* charged here: staff are paid by the payroll run in `crew.ts`.
 * Production charges energy, opex and maintenance, and treats labour as a
 * capacity constraint. The imputed labour cost is still reported so the player can
 * see the true unit economics of a chain.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { PROPERTY_BY_ID, RECIPES, RECIPE_BY_ID, recipesForProperty } from '../engine/registry/assets';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { getWorldRegistry } from '../engine/registry/world';
import { addItem, quantityOnHand, removeCommodity, storagesAtLocation } from './inventory';
import { marketAt } from './markets';
import { automationErrorReduction, productionEfficiencyBonus, productionQualityBonus } from './modifiers';
import { bumpCounter, counter, grantXp, playerModifiers, setCounter } from './progression';
import { changeReputation } from './reputation';
import {
  creditCash,
  debitCash,
  formatMoney,
  newId,
  pushDiagnostic,
  pushNotification,
  round2,
} from './state';
import type { GameState, ID, ProductionLineInstance, ProductionRecipeDef, ProductionReport } from './types';
import { orderedEntries } from './ordering';

const B = getBalance();
const worldReg = getWorldRegistry();
const registry = getCommodityRegistry();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function baseValue(commodityId: ID): number {
  return registry.get(commodityId)?.baseValue ?? 1;
}

function nameOf(commodityId: ID): string {
  return registry.get(commodityId)?.name ?? commodityId;
}

/* ------------------------------------------------------------------ */
/* Economics                                                           */
/* ------------------------------------------------------------------ */

export interface RecipeEconomics {
  recipeId: ID;
  name: string;
  requiresTag: string;
  outputCommodityId: ID;
  outputName: string;
  outputQtyPerDay: number;
  inputCostPerDay: number;
  energyCostPerDay: number;
  imputedLabourCostPerDay: number;
  opexPerDay: number;
  maintenancePerDay: number;
  installCapex: number;
  automationCapex: number;
  totalCostPerDay: number;
  revenuePerDayAtBase: number;
  grossMarginAtBase: number;
  netMarginAtBase: number;
  paybackDaysAtBase: number;
  inputs: { commodityId: ID; name: string; qtyPerDay: number; unitValue: number; costPerDay: number }[];
  outputs: { commodityId: ID; name: string; qtyPerDay: number; unitValue: number; revenuePerDay: number }[];
  byproducts: { commodityId: ID; name: string; expectedQtyPerDay: number }[];
  viable: boolean;
  notes: string[];
}

export function recipeEconomics(state: GameState, recipeId: ID, locationId?: ID): RecipeEconomics | null {
  const recipe = RECIPE_BY_ID[recipeId];
  if (!recipe) return null;
  const at = locationId ?? state.player.locationId;
  const notes: string[] = [];

  const outputs = recipe.outputs.map((o) => {
    const market = marketAt(state, at, o.commodityId);
    const unitValue = market?.price ?? baseValue(o.commodityId);
    const qtyPerDay = round2((recipe.capacityPerDay / Math.max(0.001, outputQtyOf(recipe))) * o.qty);
    return { commodityId: o.commodityId, name: nameOf(o.commodityId), qtyPerDay, unitValue: round2(unitValue), revenuePerDay: round2(qtyPerDay * unitValue) };
  });
  const inputs = recipe.inputs.map((i) => {
    const market = marketAt(state, at, i.commodityId);
    const unitValue = market?.price ?? baseValue(i.commodityId);
    const qtyPerDay = round2((recipe.capacityPerDay / Math.max(0.001, outputQtyOf(recipe))) * i.qty);
    return { commodityId: i.commodityId, name: nameOf(i.commodityId), qtyPerDay, unitValue: round2(unitValue), costPerDay: round2(qtyPerDay * unitValue) };
  });
  const byproducts = (recipe.byproducts ?? []).map((b) => ({
    commodityId: b.commodityId,
    name: nameOf(b.commodityId),
    expectedQtyPerDay: round2((recipe.capacityPerDay / Math.max(0.001, outputQtyOf(recipe))) * b.qty * b.chance * 100) / 100,
  }));

  const outputUnitsPerDay = recipe.capacityPerDay;
  const outputValuePerUnit = outputs.length > 0 ? outputs[0]!.unitValue / Math.max(0.001, outputs[0]!.qtyPerDay) * outputUnitsPerDay / Math.max(1, outputUnitsPerDay) : 0;
  const primaryOutputValue = outputs.reduce((s, o) => s + o.revenuePerDay, 0);
  const energyCostPerDay = round2(
    outputUnitsPerDay * recipe.energyPerUnit * B.production.energyCostPerUnit * (primaryOutputValue / Math.max(1, outputUnitsPerDay)),
  );
  const imputedLabourCostPerDay = round2(recipe.labourRequired * (B.crew.salaryBaseByRole.production_worker ?? 52));
  const opexPerDay = round2(recipe.opexPerDay);
  const maintenancePerDay = round2(installCapexFor(recipe) * B.production.maintenanceCostPerDayFraction);
  const inputCostPerDay = round2(inputs.reduce((s, i) => s + i.costPerDay, 0));
  const totalCostPerDay = round2(inputCostPerDay + energyCostPerDay + imputedLabourCostPerDay + opexPerDay + maintenancePerDay);
  const byproductValue = round2(
    byproducts.reduce((s, b) => s + b.expectedQtyPerDay * (marketAt(state, at, b.commodityId)?.price ?? baseValue(b.commodityId)), 0),
  );
  const revenue = round2(primaryOutputValue + byproductValue);
  const grossMargin = revenue > 0 ? round2((revenue - inputCostPerDay - energyCostPerDay) / revenue) : 0;
  const netMargin = revenue > 0 ? round2((revenue - totalCostPerDay) / revenue) : 0;
  const capex = round2(installCapexFor(recipe));

  void outputValuePerUnit;
  if (netMargin <= 0) notes.push(`At today's local prices this chain loses ${formatMoney(Math.abs(revenue - totalCostPerDay))}/day. Source inputs cheaper or sell elsewhere.`);
  if (grossMargin > 0.85) notes.push('Gross margin is unusually wide — check whether input prices here are depressed.');
  if (recipe.automationCost > 0) notes.push(`Automation costs ${formatMoney(round2(recipe.automationCost))} and removes the labour requirement.`);
  if (byproducts.length > 0) notes.push(`Byproducts add about ${formatMoney(byproductValue)}/day when they roll.`);

  return {
    recipeId: recipe.id,
    name: recipe.name,
    requiresTag: recipe.requiresTag,
    outputCommodityId: recipe.outputs[0]?.commodityId ?? '',
    outputName: recipe.outputs[0] ? nameOf(recipe.outputs[0].commodityId) : '',
    outputQtyPerDay: outputUnitsPerDay,
    inputCostPerDay,
    energyCostPerDay,
    imputedLabourCostPerDay,
    opexPerDay,
    maintenancePerDay,
    installCapex: capex,
    automationCapex: round2(recipe.automationCost),
    totalCostPerDay,
    revenuePerDayAtBase: revenue,
    grossMarginAtBase: grossMargin,
    netMarginAtBase: netMargin,
    paybackDaysAtBase: revenue - totalCostPerDay > 0 ? Math.round(capex / (revenue - totalCostPerDay)) : -1,
    inputs,
    outputs,
    byproducts,
    viable: revenue > totalCostPerDay,
    notes,
  };
}

function outputQtyOf(recipe: ProductionRecipeDef): number {
  return recipe.outputs.reduce((s, o) => s + o.qty, 0);
}

/** Plant capex: roughly ten days of output value plus twenty days of opex. */
export function installCapexFor(recipe: ProductionRecipeDef | undefined): number {
  if (!recipe) return 0;
  const outputValue = recipe.outputs.reduce((s, o) => s + o.qty * baseValue(o.commodityId), 0);
  const perDay = (recipe.capacityPerDay / Math.max(0.001, outputQtyOf(recipe))) * outputValue;
  return perDay * 10 + recipe.opexPerDay * 20;
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

export interface RecipeListing extends RecipeEconomics {
  propertyOptions: { propertyId: ID; name: string; locationName: string; free: boolean }[];
  canInstall: boolean;
  reason?: string;
  description: string;
  skillId: ID;
  labourRequired: number;
  energyPerUnit: number;
  capacityPerDay: number;
  automationCost: number;
}

export function availableRecipes(state: GameState, opts: { locationId?: ID; onlyInstallable?: boolean } = {}): RecipeListing[] {
  const at = opts.locationId ?? state.player.locationId;
  const properties = state.player.properties.filter((p) => (opts.locationId ? p.locationId === opts.locationId : true));
  const out: RecipeListing[] = [];

  for (const property of properties) {
    for (const recipe of recipesForProperty(property.defId)) {
      const economics = recipeEconomics(state, recipe.id, property.locationId);
      if (!economics) continue;
      const existing = state.player.productionLines.filter((l) => l.recipeId === recipe.id && l.propertyId === property.id);
      const canInstall = property.businessId === null || existing.length === 0;
      const free = existing.length === 0;
      out.push({
        ...economics,
        propertyOptions: [
          {
            propertyId: property.id,
            name: property.name,
            locationName: worldReg.location(property.locationId)?.name ?? property.locationId,
            free,
          },
        ],
        canInstall: canInstall && free,
        ...(canInstall && free ? {} : { reason: free ? 'That property is committed to a business.' : 'A line for this recipe already runs there.' }),
        description: recipe.description,
        skillId: recipe.skillId,
        labourRequired: recipe.labourRequired,
        energyPerUnit: recipe.energyPerUnit,
        capacityPerDay: recipe.capacityPerDay,
        automationCost: recipe.automationCost,
      });
    }
  }

  // Also list recipes that could run somewhere the player does not yet own, so
  // the supply-chain screen shows what to build toward.
  const seen = new Set(out.map((o) => o.recipeId));
  for (const recipe of RECIPES) {
    if (seen.has(recipe.id)) continue;
    const economics = recipeEconomics(state, recipe.id, at);
    if (!economics) continue;
    const host = Object.values(PROPERTY_BY_ID).find((p) => (p.productionTags ?? []).includes(recipe.requiresTag));
    out.push({
      ...economics,
      propertyOptions: [],
      canInstall: false,
      reason: `Requires a ${recipe.requiresTag} property${host ? ` such as ${host.name}` : ''}.`,
      description: recipe.description,
      skillId: recipe.skillId,
      labourRequired: recipe.labourRequired,
      energyPerUnit: recipe.energyPerUnit,
      capacityPerDay: recipe.capacityPerDay,
      automationCost: recipe.automationCost,
    });
  }

  const filtered = opts.onlyInstallable ? out.filter((o) => o.canInstall) : out;
  return filtered.sort((a, b) => b.netMarginAtBase - a.netMarginAtBase);
}

/* ------------------------------------------------------------------ */
/* Line lifecycle                                                      */
/* ------------------------------------------------------------------ */

export interface ProductionActionResult {
  ok: boolean;
  reason?: string;
  line?: ProductionLineInstance;
  cost?: number;
}

export function installLine(state: GameState, rng: Rng, recipeId: ID, propertyId: ID): ProductionActionResult {
  const recipe = RECIPE_BY_ID[recipeId];
  if (!recipe) return { ok: false, reason: 'Unknown recipe.' };
  const property = state.player.properties.find((p) => p.id === propertyId);
  if (!property) return { ok: false, reason: 'You do not own that property.' };
  if (!propertyKindHasTag(property.defId, recipe.requiresTag)) {
    return { ok: false, reason: `${property.name} cannot run ${recipe.name} — it needs the "${recipe.requiresTag}" capability.` };
  }
  if (state.player.productionLines.some((l) => l.recipeId === recipeId && l.propertyId === propertyId)) {
    return { ok: false, reason: 'A line for that recipe already runs at this property.' };
  }
  const capex = round2(installCapexFor(recipe) * (state.world.inflationIndex ?? 1));
  const move = debitCash(state, capex, {
    kind: 'production',
    description: `Installed production line: ${recipe.name} at ${property.name}`,
    allowDirty: false,
    locationId: property.locationId,
    meta: { recipeId, capex },
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? `Installation costs ${formatMoney(capex)}.` };

  const line: ProductionLineInstance = {
    id: newId(rng, 'line'),
    recipeId: recipe.id,
    name: recipe.name,
    propertyId: property.id,
    locationId: property.locationId,
    installedDay: state.world.day,
    inputs: {},
    outputs: {},
    workerIds: [],
    managerId: null,
    automated: false,
    automationLevel: 0,
    efficiency: B.production.efficiencyBase,
    quality: B.production.qualityBase,
    capacityPerDay: recipe.capacityPerDay,
    broken: false,
    brokenUntilDay: null,
    lastRunDay: -1,
    totalProduced: 0,
    totalWaste: 0,
    energyCostPerDay: 0,
    opexPerDay: recipe.opexPerDay,
    lastReport: null,
    suspended: false,
  };
  state.player.productionLines.push(line);
  property.productionLineIds.push(line.id);

  bumpCounter(state, 'lines_installed');
  setCounter(state, 'production_capex', round2(counter(state, 'production_capex') + capex));
  changeReputation(state, 'business', 2, `Commissioned ${recipe.name}`);
  grantXp(state, Math.round(50 + Math.log10(Math.max(1000, capex)) * 20), `Installed ${recipe.name}`);
  pushNotification(state, {
    kind: 'success',
    title: `${recipe.name} installed`,
    body: `${property.name}. Capex ${formatMoney(capex)}, capacity ${recipe.capacityPerDay} units/day, needs ${recipe.labourRequired} labour and ${recipe.energyPerUnit} energy per unit. Feed inputs into the buffer to start production.`,
    link: '/game/production',
    metrics: [
      { label: 'Capex', value: formatMoney(capex) },
      { label: 'Capacity/day', value: String(recipe.capacityPerDay) },
      { label: 'Labour required', value: String(recipe.labourRequired) },
      { label: 'Opex/day', value: formatMoney(recipe.opexPerDay) },
    ],
  });
  return { ok: true, line, cost: capex };
}

function propertyKindHasTag(propertyDefId: ID, tag: string): boolean {
  return (PROPERTY_BY_ID[propertyDefId]?.productionTags ?? []).includes(tag);
}

export function decommissionLine(state: GameState, lineId: ID): ProductionActionResult {
  const line = state.player.productionLines.find((l) => l.id === lineId);
  if (!line) return { ok: false, reason: 'No such production line.' };
  const recipe = RECIPE_BY_ID[line.recipeId];
  const salvage = round2(installCapexFor(recipe) * 0.28);
  // Return buffered goods to storage before scrapping the line.
  collectOutputs(state, lineId, true);
  returnInputs(state, lineId);

  const property = state.player.properties.find((p) => p.id === line.propertyId);
  if (property) property.productionLineIds = property.productionLineIds.filter((id) => id !== lineId);
  for (const employee of state.player.crew) {
    if (employee.assignment?.targetId === lineId) employee.assignment = null;
  }
  state.player.productionLines = state.player.productionLines.filter((l) => l.id !== lineId);
  if (salvage > 0) {
    creditCash(state, salvage, {
      kind: 'production',
      description: `Salvage from decommissioning ${line.name}`,
      dirty: false,
      locationId: line.locationId,
      meta: { recipeId: line.recipeId },
    });
  }
  bumpCounter(state, 'lines_decommissioned');
  pushNotification(state, {
    kind: 'info',
    title: `${line.name} decommissioned`,
    body: `Equipment salvaged for ${formatMoney(salvage)} and buffered goods returned to storage.`,
    link: '/game/production',
  });
  return { ok: true, cost: salvage };
}

/** Push buffered inputs back into storage (used when a line is scrapped). */
function returnInputs(state: GameState, lineId: ID): void {
  const line = state.player.productionLines.find((l) => l.id === lineId);
  if (!line) return;
  for (const [commodityId, qty] of orderedEntries(line.inputs)) {
    if (qty <= 0) continue;
    addItem(state, { commodityId, qty: Math.floor(qty), avgCost: baseValue(commodityId), origin: 'purchased' });
    line.inputs[commodityId] = 0;
  }
}

export function automateLine(state: GameState, lineId: ID): ProductionActionResult {
  const line = state.player.productionLines.find((l) => l.id === lineId);
  if (!line) return { ok: false, reason: 'No such production line.' };
  const recipe = RECIPE_BY_ID[line.recipeId];
  if (!recipe) return { ok: false, reason: 'Unknown recipe.' };
  if (line.automationLevel >= 3) return { ok: false, reason: 'The line is fully automated.' };
  const cost = round2(recipe.automationCost * (1 + line.automationLevel * 0.6) * B.production.automationCapexMultiple * 0.4);
  const move = debitCash(state, cost, {
    kind: 'production',
    description: `Automation level ${line.automationLevel + 1} for ${line.name}`,
    allowDirty: false,
    locationId: line.locationId,
    meta: { level: line.automationLevel + 1 },
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? `Automation costs ${formatMoney(cost)}.` };
  line.automationLevel += 1;
  line.automated = true;
  line.efficiency = round2(clamp(line.efficiency + B.production.automationEfficiencyBonus * 0.5, 0.1, 1.6));
  setCounter(state, 'automation_capex', round2(counter(state, 'automation_capex') + cost));
  grantXp(state, Math.round(60 + line.automationLevel * 30), `Automated ${line.name}`);
  pushNotification(state, {
    kind: 'success',
    title: `${line.name} automated (level ${line.automationLevel})`,
    body: `The line now feeds itself from storage and collects its own output when a manager is assigned. Efficiency rose to ${(line.efficiency * 100).toFixed(0)}% and the labour requirement is largely removed.`,
    link: '/game/production',
    metrics: [
      { label: 'Cost', value: formatMoney(cost) },
      { label: 'Efficiency', value: `${(line.efficiency * 100).toFixed(0)}%` },
    ],
  });
  return { ok: true, line, cost };
}

export function assignWorkers(state: GameState, lineId: ID, employeeIds: ID[]): { ok: boolean; reason?: string; assigned?: number } {
  const line = state.player.productionLines.find((l) => l.id === lineId);
  if (!line) return { ok: false, reason: 'No such production line.' };
  const recipe = RECIPE_BY_ID[line.recipeId];
  if (employeeIds.length > Math.max(1, recipe?.labourRequired ?? 1)) {
    return { ok: false, reason: `${line.name} needs at most ${recipe?.labourRequired ?? 1} workers.` };
  }
  let assigned = 0;
  line.workerIds = [];
  for (const id of employeeIds) {
    const employee = state.player.crew.find((e) => e.id === id);
    if (!employee || employee.status !== 'active' || employee.injured) continue;
    if (employee.locationId !== line.locationId) continue;
    employee.assignment = { kind: 'production', targetId: lineId, tier: 1, reportsTo: line.managerId };
    line.workerIds.push(id);
    assigned += 1;
  }
  return { ok: true, assigned };
}

export function assignLineManager(state: GameState, lineId: ID, employeeId: ID | null): { ok: boolean; reason?: string } {
  const line = state.player.productionLines.find((l) => l.id === lineId);
  if (!line) return { ok: false, reason: 'No such production line.' };
  if (employeeId === null) {
    line.managerId = null;
    return { ok: true };
  }
  const employee = state.player.crew.find((e) => e.id === employeeId);
  if (!employee) return { ok: false, reason: 'No such employee.' };
  const role = employee.role;
  if (role !== 'production_worker' && role !== 'business_manager' && role !== 'technical_specialist' && role !== 'logistics_manager') {
    return { ok: false, reason: `${employee.name} (${role}) cannot manage a production line.` };
  }
  employee.assignment = { kind: 'manager_of_managers', targetId: lineId, tier: 2, reportsTo: null };
  line.managerId = employeeId;
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Buffer handling                                                     */
/* ------------------------------------------------------------------ */

export function feedInputs(state: GameState, lineId: ID, commodityId: ID, qty: number): { ok: boolean; reason?: string; fed?: number } {
  const line = state.player.productionLines.find((l) => l.id === lineId);
  if (!line) return { ok: false, reason: 'No such production line.' };
  const recipe = RECIPE_BY_ID[line.recipeId];
  if (!recipe) return { ok: false, reason: 'Unknown recipe.' };
  if (!recipe.inputs.some((i) => i.commodityId === commodityId)) {
    return { ok: false, reason: `${recipe.name} does not use ${nameOf(commodityId)}.` };
  }
  const onHand = quantityOnHand(state, commodityId, line.locationId);
  const fed = Math.min(Math.max(0, Math.floor(qty)), Math.floor(onHand));
  if (fed <= 0) return { ok: false, reason: `No ${nameOf(commodityId)} in storage at ${worldReg.location(line.locationId)?.name ?? line.locationId}.` };
  const removed = removeCommodity(state, commodityId, fed, line.locationId);
  if (removed.removed <= 0) return { ok: false, reason: removed.message ?? 'Could not move goods out of storage.' };
  line.inputs[commodityId] = round2((line.inputs[commodityId] ?? 0) + removed.removed);
  return { ok: true, fed: removed.removed };
}

export function collectOutputs(state: GameState, lineId: ID, includeByproducts = false): { ok: boolean; reason?: string; collected?: { commodityId: ID; qty: number }[] } {
  const line = state.player.productionLines.find((l) => l.id === lineId);
  if (!line) return { ok: false, reason: 'No such production line.' };
  const collected: { commodityId: ID; qty: number }[] = [];
  for (const [commodityId, qty] of orderedEntries(line.outputs)) {
    const whole = Math.floor(qty);
    if (whole <= 0) continue;
    const recipe = RECIPE_BY_ID[line.recipeId];
    const isByproduct = (recipe?.byproducts ?? []).some((b) => b.commodityId === commodityId);
    if (isByproduct && !includeByproducts) continue;
    const added = addItem(state, { commodityId, qty: whole, avgCost: unitCostOf(line, commodityId), origin: 'produced', quality: line.quality });
    if (added.ok) {
      line.outputs[commodityId] = round2(qty - added.qty);
      collected.push({ commodityId, qty: added.qty });
    }
  }
  if (collected.length === 0) return { ok: false, reason: 'Nothing ready to collect.' };
  return { ok: true, collected };
}

function unitCostOf(line: ProductionLineInstance, commodityId: ID): number {
  // Imputed unit cost: inputs consumed plus energy and opex, spread over output.
  const recipe = RECIPE_BY_ID[line.recipeId];
  if (!recipe) return baseValue(commodityId);
  const inputCost = recipe.inputs.reduce((s, i) => s + i.qty * baseValue(i.commodityId), 0);
  const outputQty = Math.max(0.001, outputQtyOf(recipe));
  const energy = recipe.energyPerUnit * B.production.energyCostPerUnit * (inputCost / outputQty);
  const share = recipe.outputs.find((o) => o.commodityId === commodityId);
  const fraction = share ? share.qty / outputQty : 0;
  return round2(Math.max(0.01, (inputCost + energy + recipe.opexPerDay / Math.max(1, recipe.capacityPerDay)) * (fraction > 0 ? 1 : 0.4)));
}

/* ------------------------------------------------------------------ */
/* Daily run                                                           */
/* ------------------------------------------------------------------ */

export interface ProductionTickResult {
  reports: { lineId: ID; name: string; report: ProductionReport }[];
  totalOutputValue: number;
  totalCost: number;
  totalWaste: number;
  breakdowns: { lineId: ID; name: string; untilDay: number }[];
  blocked: { lineId: ID; name: string; reason: string }[];
}

export function productionTick(state: GameState, rng: Rng): ProductionTickResult {
  const result: ProductionTickResult = { reports: [], totalOutputValue: 0, totalCost: 0, totalWaste: 0, breakdowns: [], blocked: [] };
  const mods = playerModifiers(state);
  const efficiencyBonus = productionEfficiencyBonus(mods);
  const qualityBonus = productionQualityBonus(mods);
  const errorCut = automationErrorReduction(mods);
  const day = state.world.day;

  for (const line of state.player.productionLines) {
    const recipe = RECIPE_BY_ID[line.recipeId];
    if (!recipe) continue;

    /* ------------------------------ breakdowns ---------------------------- */
    if (line.broken && line.brokenUntilDay !== null && day >= line.brokenUntilDay) {
      line.broken = false;
      line.brokenUntilDay = null;
      pushNotification(state, {
        kind: 'success',
        title: `${line.name} back online`,
        body: 'Repairs are complete and the line is running again.',
        link: '/game/production',
      });
    }
    if (line.broken || line.suspended) continue;

    const property = state.player.properties.find((p) => p.id === line.propertyId);
    if (property?.damagedUntilDay !== undefined && property?.damagedUntilDay !== null && property.damagedUntilDay > day) {
      result.blocked.push({ lineId: line.id, name: line.name, reason: `The property is damaged until day ${property.damagedUntilDay}.` });
      continue;
    }

    /* -------------------------------- labour ------------------------------ */
    const workers = line.workerIds
      .map((id) => state.player.crew.find((e) => e.id === id))
      .filter((e): e is NonNullable<typeof e> => e !== undefined && e.status === 'active' && !e.injured && e.locationId === line.locationId);
    const labourSupply = workers.reduce((s, w) => s + 0.6 + w.stats.skill / 90 + w.stats.morale / 400, 0);
    const labourFactor = line.automated
      ? clamp(0.75 + line.automationLevel * 0.12 + labourSupply / Math.max(1, recipe.labourRequired) * 0.25, 0.5, 1.15)
      : clamp(labourSupply / Math.max(1, recipe.labourRequired), 0, 1.15);

    /* ------------------------------ efficiency ---------------------------- */
    const skill = crewSkillForLine(workers, recipe.skillId);
    const conditionFactor = property ? 0.6 + property.condition * 0.4 : 0.85;
    const efficiency = round2(
      clamp(
        (B.production.efficiencyBase + skill * B.production.efficiencyPerWorkerSkill + line.automationLevel * B.production.automationEfficiencyBonus * 0.5 + efficiencyBonus) *
          conditionFactor *
          (1 - (1 - line.quality) * 0.08),
        0.15,
        1.45,
      ),
    );
    line.efficiency = efficiency;

    // `capacityPerDay` is *output units per day* at full efficiency and labour.
    // A batch yields `outputQtyOf(recipe)` units, so batches/day is the single
    // scale factor for inputs, outputs and byproducts alike. Mixing the two
    // conventions here would let a line consume a fraction of its inputs while
    // producing the full output — free money.
    const outputQtyPerBatch = Math.max(0.001, outputQtyOf(recipe));
    const effectiveCapacity = round2(recipe.capacityPerDay * efficiency * labourFactor);
    const batchesPerDay = effectiveCapacity / outputQtyPerBatch;

    /* --------------------------- auto-feed inputs ------------------------- */
    const canAutoFeed = line.automated || line.managerId !== null;
    if (canAutoFeed) {
      for (const input of recipe.inputs) {
        const needed = round2(input.qty * batchesPerDay);
        const have = line.inputs[input.commodityId] ?? 0;
        const shortfall = Math.max(0, Math.ceil(needed - have));
        if (shortfall <= 0) continue;
        const onHand = Math.floor(quantityOnHand(state, input.commodityId, line.locationId));
        if (onHand <= 0) continue;
        const moved = removeCommodity(state, input.commodityId, Math.min(shortfall, onHand), line.locationId);
        if (moved.removed > 0) line.inputs[input.commodityId] = round2(have + moved.removed);
      }
    }

    /* ------------------------------- inputs ------------------------------- */
    let runFactor = 1;
    let blockedBy: string | null = null;
    for (const input of recipe.inputs) {
      const needed = input.qty * batchesPerDay;
      const have = line.inputs[input.commodityId] ?? 0;
      if (needed <= 0) continue;
      if (have < needed) {
        const factor = have / needed;
        if (factor < runFactor) runFactor = factor;
        if (have <= 0) blockedBy = `No ${nameOf(input.commodityId)} in the input buffer`;
      }
    }
    const actualCapacity = round2(effectiveCapacity * runFactor);
    const actualBatches = batchesPerDay * runFactor;
    if (actualCapacity <= 0) {
      const report: ProductionReport = {
        day,
        produced: [],
        consumed: [],
        waste: 0,
        efficiency,
        quality: line.quality,
        cost: 0,
        blockedBy: blockedBy ?? 'No inputs available',
      };
      line.lastReport = report;
      line.lastRunDay = day;
      result.blocked.push({ lineId: line.id, name: line.name, reason: report.blockedBy ?? 'No inputs' });
      continue;
    }

    const actualScale = actualCapacity / Math.max(0.001, recipe.capacityPerDay);
    const consumed: ProductionReport['consumed'] = [];
    for (const input of recipe.inputs) {
      const used = round2(input.qty * actualBatches * 1000) / 1000;
      const have = line.inputs[input.commodityId] ?? 0;
      const take = Math.min(have, used);
      line.inputs[input.commodityId] = round2(have - take);
      consumed.push({ commodityId: input.commodityId, qty: round2(take) });
    }

    /* ------------------------------- quality ------------------------------ */
    const quality = round2(
      clamp(
        B.production.qualityBase +
          skill * B.production.qualityPerSkill +
          qualityBonus +
          line.automationLevel * 0.04 +
          (workers.length >= recipe.labourRequired ? 0.03 : -0.05) +
          rng.gaussian(0, 0.02),
        0.1,
        1,
      ),
    );
    line.quality = quality;

    /* ------------------------------- outputs ------------------------------ */
    const wasteFraction = clamp(rng.float(B.production.wasteFractionRange[0], B.production.wasteFractionRange[1]) * (1.35 - quality), 0, 0.4);
    const produced: ProductionReport['produced'] = [];
    let outputValue = 0;
    for (const output of recipe.outputs) {
      const gross = output.qty * actualBatches;
      const net = round2(Math.max(0, gross * (1 - wasteFraction)));
      if (net <= 0) continue;
      line.outputs[output.commodityId] = round2((line.outputs[output.commodityId] ?? 0) + net);
      produced.push({ commodityId: output.commodityId, qty: net });
      outputValue += net * outputUnitPrice(state, line.locationId, output.commodityId);
      line.totalProduced = round2(line.totalProduced + net);
    }
    for (const byproduct of recipe.byproducts ?? []) {
      if (!rng.chance(byproduct.chance * (0.6 + quality * 0.6))) continue;
      const qty = round2(byproduct.qty * actualBatches * 100) / 100;
      if (qty <= 0) continue;
      line.outputs[byproduct.commodityId] = round2((line.outputs[byproduct.commodityId] ?? 0) + qty);
      produced.push({ commodityId: byproduct.commodityId, qty });
      outputValue += qty * outputUnitPrice(state, line.locationId, byproduct.commodityId);
    }
    const waste = round2(outputValue > 0 ? wasteFraction * outputValue : 0);
    line.totalWaste = round2(line.totalWaste + waste);

    /* -------------------------------- costs ------------------------------- */
    const energyCost = round2(actualCapacity * recipe.energyPerUnit * B.production.energyCostPerUnit * (outputValue / Math.max(1, actualCapacity)));
    const maintenance = round2(installCapexFor(recipe) * B.production.maintenanceCostPerDayFraction);
    const opex = round2(recipe.opexPerDay * (0.5 + actualScale * 0.5));
    const cost = round2(energyCost + maintenance + opex);
    line.energyCostPerDay = energyCost;
    line.opexPerDay = round2(maintenance + opex);

    const payment = debitCash(state, cost, {
      kind: 'production',
      description: `${line.name}: energy ${formatMoney(energyCost)}, opex ${formatMoney(opex)}, maintenance ${formatMoney(maintenance)}`,
      allowDirty: false,
      locationId: line.locationId,
      meta: { recipeId: line.recipeId, energyCost, opex, maintenance, efficiency },
    });
    if (!payment.ok) {
      line.suspended = true;
      const report: ProductionReport = { day, produced: [], consumed: [], waste: 0, efficiency, quality, cost: 0, blockedBy: `Could not pay ${formatMoney(cost)} of operating cost` };
      line.lastReport = report;
      result.blocked.push({ lineId: line.id, name: line.name, reason: report.blockedBy! });
      pushNotification(state, {
        kind: 'danger',
        title: `${line.name} halted`,
        body: `You could not cover ${formatMoney(cost)} of energy and opex. The line is suspended until you restart it.`,
        link: '/game/production',
      });
      // Give the consumed inputs back — the run never happened.
      for (const item of consumed) line.inputs[item.commodityId] = round2((line.inputs[item.commodityId] ?? 0) + item.qty);
      for (const item of produced) line.outputs[item.commodityId] = round2(Math.max(0, (line.outputs[item.commodityId] ?? 0) - item.qty));
      continue;
    }

    /* ------------------------------ breakdowns ---------------------------- */
    const breakdownChance = B.production.breakdownChancePerDay * (1.4 - conditionFactor) * (1 - errorCut * (line.automated ? 1 : 0.4));
    if (rng.chance(clamp(breakdownChance, 0, 0.25))) {
      const downtime = rng.int(B.production.breakdownDowntimeDays[0], B.production.breakdownDowntimeDays[1]);
      line.broken = true;
      line.brokenUntilDay = day + downtime;
      const repairCost = round2(installCapexFor(recipe) * rng.float(0.01, 0.05));
      debitCash(state, repairCost, { kind: 'production', description: `Emergency repair: ${line.name}`, allowDirty: false });
      result.breakdowns.push({ lineId: line.id, name: line.name, untilDay: line.brokenUntilDay });
      pushNotification(state, {
        kind: 'warning',
        title: `${line.name} broke down`,
        body: `Offline until day ${line.brokenUntilDay}. Repairs cost ${formatMoney(repairCost)}. Automation and maintenance skill reduce breakdown frequency.`,
        link: '/game/production',
        metrics: [{ label: 'Downtime', value: `${downtime} day(s)` }],
      });
    }

    /* ------------------------------ auto-collect -------------------------- */
    if (line.automated || line.managerId) collectOutputs(state, line.id, true);

    const report: ProductionReport = { day, produced, consumed, waste, efficiency, quality, cost, blockedBy };
    line.lastReport = report;
    line.lastRunDay = day;
    result.reports.push({ lineId: line.id, name: line.name, report });
    result.totalOutputValue = round2(result.totalOutputValue + outputValue);
    result.totalCost = round2(result.totalCost + cost);
    result.totalWaste = round2(result.totalWaste + waste);

    setCounter(state, 'produced_value', round2(counter(state, 'produced_value') + outputValue));
    setCounter(state, 'production_cost', round2(counter(state, 'production_cost') + cost));
    bumpCounter(state, 'production_runs');
    for (const item of produced) bumpCounter(state, `produced:${item.commodityId}`, item.qty);
    grantXp(state, Math.round(B.progression.xpProductionPerDay * (0.5 + efficiency)), `${line.name} ran at ${(efficiency * 100).toFixed(0)}% efficiency`);

    pushDiagnostic(state, {
      system: 'production',
      level: 'info',
      message: `${line.name}: produced ${produced.map((p) => `${p.qty} ${p.commodityId}`).join(', ') || 'nothing'} at ${(efficiency * 100).toFixed(0)}% efficiency, quality ${(quality * 100).toFixed(0)}%, cost ${formatMoney(cost)}, output value ${formatMoney(round2(outputValue))}`,
      data: { efficiency, quality, cost, outputValue: round2(outputValue), waste },
    });
  }

  if (result.reports.length > 0) {
    changeReputation(state, 'business', 0.15 * result.reports.length, 'Production running');
  }
  return result;
}

/**
 * Effective skill on a line: the best worker's level in the recipe's skill,
 * damped by morale. Unstaffed lines run at zero skill (automation compensates
 * elsewhere in the efficiency formula).
 */
function crewSkillForLine(
  workers: { skills: Record<ID, number>; stats: { morale: number } }[],
  skillId: ID,
): number {
  if (workers.length === 0) return 0;
  const best = workers.reduce((m, w) => Math.max(m, w.skills[skillId] ?? 0), 0);
  const morale = workers.reduce((s, w) => s + w.stats.morale, 0) / workers.length;
  return round2(best * clamp(0.65 + morale / 220, 0.5, 1.15));
}

function outputUnitPrice(state: GameState, locationId: ID, commodityId: ID): number {
  return marketAt(state, locationId, commodityId)?.price ?? baseValue(commodityId);
}

export function restartLine(state: GameState, lineId: ID): { ok: boolean; reason?: string } {
  const line = state.player.productionLines.find((l) => l.id === lineId);
  if (!line) return { ok: false, reason: 'No such production line.' };
  if (line.broken) return { ok: false, reason: `The line is broken until day ${line.brokenUntilDay}.` };
  line.suspended = false;
  return { ok: true };
}

export function repairLine(state: GameState, lineId: ID): { ok: boolean; reason?: string; cost?: number } {
  const line = state.player.productionLines.find((l) => l.id === lineId);
  if (!line) return { ok: false, reason: 'No such production line.' };
  if (!line.broken) return { ok: false, reason: 'The line is not broken.' };
  const recipe = RECIPE_BY_ID[line.recipeId];
  const cost = round2(installCapexFor(recipe) * 0.06);
  const move = debitCash(state, cost, { kind: 'production', description: `Repairs: ${line.name}`, allowDirty: false });
  if (!move.ok) return { ok: false, reason: move.reason ?? 'Insufficient funds.' };
  line.broken = false;
  line.brokenUntilDay = null;
  return { ok: true, cost };
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface LineView {
  id: ID;
  name: string;
  recipeId: ID;
  propertyName: string;
  locationName: string;
  status: 'running' | 'idle' | 'broken' | 'suspended' | 'starved';
  automated: boolean;
  automationLevel: number;
  automationCostNext: number;
  efficiency: number;
  quality: number;
  capacityPerDay: number;
  effectiveCapacityPerDay: number;
  workers: { id: ID; name: string; skill: number; morale: number }[];
  labourRequired: number;
  labourFactor: number;
  manager: string | null;
  inputs: { commodityId: ID; name: string; inBuffer: number; neededPerDay: number; daysOfCover: number; localPrice: number; costPerDay: number }[];
  outputs: { commodityId: ID; name: string; inBuffer: number; producedPerDay: number; unitPrice: number; valuePerDay: number }[];
  energyCostPerDay: number;
  opexPerDay: number;
  totalCostPerDay: number;
  outputValuePerDay: number;
  marginPerDay: number;
  totalProduced: number;
  totalWaste: number;
  installedDay: number;
  brokenUntilDay: number | null;
  lastReport: ProductionReport | null;
  economics: RecipeEconomics | null;
  blockers: string[];
}

export function lineViews(state: GameState): LineView[] {
  return state.player.productionLines.map((line) => {
    const recipe = RECIPE_BY_ID[line.recipeId];
    const property = state.player.properties.find((p) => p.id === line.propertyId);
    const workers = line.workerIds
      .map((id) => state.player.crew.find((e) => e.id === id))
      .filter((e): e is NonNullable<typeof e> => e !== undefined)
      .map((e) => ({ id: e.id, name: e.name, skill: e.stats.skill, morale: e.stats.morale }));
    const labourFactor = recipe
      ? line.automated
        ? clamp(0.75 + line.automationLevel * 0.12, 0.5, 1.15)
        : clamp(workers.reduce((s, w) => s + 0.6 + w.skill / 90, 0) / Math.max(1, recipe.labourRequired), 0, 1.15)
      : 0;
    const effectiveCapacity = recipe ? round2(recipe.capacityPerDay * line.efficiency * labourFactor) : 0;
    const blockers: string[] = [];
    if (line.broken) blockers.push(`Broken until day ${line.brokenUntilDay}`);
    if (line.suspended) blockers.push('Suspended (could not pay operating cost)');
    if (!line.automated && workers.length < (recipe?.labourRequired ?? 0)) {
      blockers.push(`Needs ${Math.max(0, (recipe?.labourRequired ?? 0) - workers.length)} more worker(s)`);
    }

    const batches = effectiveCapacity / Math.max(0.001, outputQtyOf(recipe!));
    const inputs = (recipe?.inputs ?? []).map((i) => {
      const inBuffer = round2(line.inputs[i.commodityId] ?? 0);
      const neededPerDay = round2(i.qty * batches);
      const localPrice = outputUnitPrice(state, line.locationId, i.commodityId);
      return {
        commodityId: i.commodityId,
        name: nameOf(i.commodityId),
        inBuffer,
        neededPerDay,
        daysOfCover: neededPerDay > 0 ? round2(inBuffer / neededPerDay) : 99,
        localPrice: round2(localPrice),
        costPerDay: round2(neededPerDay * localPrice),
      };
    });
    for (const input of inputs) {
      if (input.inBuffer < input.neededPerDay) blockers.push(`Short of ${input.name} (${input.inBuffer}/${input.neededPerDay})`);
    }

    const outputs = (recipe?.outputs ?? []).map((o) => {
      const unitPrice = outputUnitPrice(state, line.locationId, o.commodityId);
      const producedPerDay = round2(o.qty * batches);
      return {
        commodityId: o.commodityId,
        name: nameOf(o.commodityId),
        inBuffer: round2(line.outputs[o.commodityId] ?? 0),
        producedPerDay,
        unitPrice: round2(unitPrice),
        valuePerDay: round2(producedPerDay * unitPrice),
      };
    });
    const byproducts = (recipe?.byproducts ?? []).map((b) => ({
      commodityId: b.commodityId,
      name: nameOf(b.commodityId),
      inBuffer: round2(line.outputs[b.commodityId] ?? 0),
      producedPerDay: round2(b.qty * b.chance * batches),
      unitPrice: round2(outputUnitPrice(state, line.locationId, b.commodityId)),
      valuePerDay: round2(b.qty * b.chance * outputUnitPrice(state, line.locationId, b.commodityId)),
    }));
    const outputValuePerDay = round2([...outputs, ...byproducts].reduce((s, o) => s + o.valuePerDay, 0));
    const totalCostPerDay = round2(line.energyCostPerDay + line.opexPerDay);

    const status: LineView['status'] = line.broken
      ? 'broken'
      : line.suspended
        ? 'suspended'
        : line.lastReport?.blockedBy
          ? 'starved'
          : blockers.some((b) => b.startsWith('Short of') || b.startsWith('Needs'))
            ? 'starved'
            : line.lastRunDay === state.world.day
              ? 'running'
              : 'idle';

    return {
      id: line.id,
      name: line.name,
      recipeId: line.recipeId,
      propertyName: property?.name ?? '—',
      locationName: worldReg.location(line.locationId)?.name ?? line.locationId,
      status,
      automated: line.automated,
      automationLevel: line.automationLevel,
      automationCostNext:
        recipe && line.automationLevel < 3
          ? round2(recipe.automationCost * (1 + line.automationLevel * 0.6) * B.production.automationCapexMultiple * 0.4)
          : 0,
      efficiency: line.efficiency,
      quality: line.quality,
      capacityPerDay: recipe?.capacityPerDay ?? 0,
      effectiveCapacityPerDay: effectiveCapacity,
      workers,
      labourRequired: recipe?.labourRequired ?? 0,
      labourFactor: round2(labourFactor),
      manager: line.managerId ? state.player.crew.find((e) => e.id === line.managerId)?.name ?? null : null,
      inputs,
      outputs: [...outputs, ...byproducts],
      energyCostPerDay: line.energyCostPerDay,
      opexPerDay: line.opexPerDay,
      totalCostPerDay,
      outputValuePerDay,
      marginPerDay: round2(outputValuePerDay - totalCostPerDay),
      totalProduced: line.totalProduced,
      totalWaste: line.totalWaste,
      installedDay: line.installedDay,
      brokenUntilDay: line.brokenUntilDay,
      lastReport: line.lastReport,
      economics: recipe ? recipeEconomics(state, recipe.id, line.locationId) : null,
      blockers,
    };
  });
}

export interface SupplyChainSummary {
  lines: number;
  running: number;
  blocked: number;
  outputValuePerDay: number;
  costPerDay: number;
  marginPerDay: number;
  totalProduced: number;
  totalWaste: number;
  averageEfficiency: number;
  averageQuality: number;
  inputRequirements: { commodityId: ID; name: string; perDay: number; inBuffer: number; daysOfCover: number; localPrice: number }[];
  outputProducts: { commodityId: ID; name: string; perDay: number; inBuffer: number; localPrice: number; valuePerDay: number }[];
  chains: { from: string; to: string; marginPerDay: number }[];
}

export function supplyChainSummary(state: GameState): SupplyChainSummary {
  const views = lineViews(state);
  const inputs = new Map<ID, { perDay: number; inBuffer: number }>();
  const outputs = new Map<ID, { perDay: number; inBuffer: number }>();
  for (const line of views) {
    for (const input of line.inputs) {
      const entry = inputs.get(input.commodityId) ?? { perDay: 0, inBuffer: 0 };
      entry.perDay += input.neededPerDay;
      entry.inBuffer += input.inBuffer;
      inputs.set(input.commodityId, entry);
    }
    for (const output of line.outputs) {
      const entry = outputs.get(output.commodityId) ?? { perDay: 0, inBuffer: 0 };
      entry.perDay += output.producedPerDay;
      entry.inBuffer += output.inBuffer;
      outputs.set(output.commodityId, entry);
    }
  }
  const at = state.player.locationId;
  return {
    lines: views.length,
    running: views.filter((v) => v.status === 'running').length,
    blocked: views.filter((v) => v.status === 'broken' || v.status === 'starved' || v.status === 'suspended').length,
    outputValuePerDay: round2(views.reduce((s, v) => s + v.outputValuePerDay, 0)),
    costPerDay: round2(views.reduce((s, v) => s + v.totalCostPerDay, 0)),
    marginPerDay: round2(views.reduce((s, v) => s + v.marginPerDay, 0)),
    totalProduced: round2(views.reduce((s, v) => s + v.totalProduced, 0)),
    totalWaste: round2(views.reduce((s, v) => s + v.totalWaste, 0)),
    averageEfficiency: views.length > 0 ? round2(views.reduce((s, v) => s + v.efficiency, 0) / views.length) : 0,
    averageQuality: views.length > 0 ? round2(views.reduce((s, v) => s + v.quality, 0) / views.length) : 0,
    inputRequirements: [...inputs.entries()]
      .map(([commodityId, v]) => ({
        commodityId,
        name: nameOf(commodityId),
        perDay: round2(v.perDay),
        inBuffer: round2(v.inBuffer),
        daysOfCover: v.perDay > 0 ? round2(v.inBuffer / v.perDay) : 99,
        localPrice: round2(outputUnitPrice(state, at, commodityId)),
      }))
      .sort((a, b) => b.perDay - a.perDay),
    outputProducts: [...outputs.entries()]
      .map(([commodityId, v]) => {
        const price = outputUnitPrice(state, at, commodityId);
        return {
          commodityId,
          name: nameOf(commodityId),
          perDay: round2(v.perDay),
          inBuffer: round2(v.inBuffer),
          localPrice: round2(price),
          valuePerDay: round2(v.perDay * price),
        };
      })
      .sort((a, b) => b.valuePerDay - a.valuePerDay),
    chains: views.map((v) => ({
      from: v.inputs.map((i) => i.name).join(' + '),
      to: v.outputs.map((o) => o.name).join(' + '),
      marginPerDay: v.marginPerDay,
    })),
  };
}

/** Total storage capacity used by production buffers, for the logistics view. */
export function bufferSummary(state: GameState): { inputs: number; outputs: number; value: number } {
  let inputs = 0;
  let outputs = 0;
  let value = 0;
  for (const line of state.player.productionLines) {
    for (const [id, qty] of orderedEntries(line.inputs)) {
      inputs += qty;
      value += qty * baseValue(id);
    }
    for (const [id, qty] of orderedEntries(line.outputs)) {
      outputs += qty;
      value += qty * baseValue(id);
    }
  }
  return { inputs: round2(inputs), outputs: round2(outputs), value: round2(value) };
}

/** Storages available at a location for a line's inputs/outputs. */
export function storagesForLine(state: GameState, lineId: ID): { id: ID; name: string; kind: string; freeKg: number }[] {
  const line = state.player.productionLines.find((l) => l.id === lineId);
  if (!line) return [];
  return storagesAtLocation(state, line.locationId).map((s) => ({ id: s.id, name: s.name, kind: s.kind, freeKg: s.capacityKg }));
}
