/**
 * Properties — permanent infrastructure (spec §19).
 *
 * Property is the game's durable layer: it stores goods, hosts businesses and
 * production lines, generates rent, appreciates, and can be raided, damaged,
 * insured, upgraded and borrowed against. Buying one creates a real storage unit
 * (see `inventory.ts`), which is what turns a backpack trader into a logistics
 * operator.
 *
 * Valuations are location-specific and deterministic per (property, location),
 * so the same save always sees the same asking prices.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { PROPERTIES, PROPERTY_BY_ID, recipesForProperty } from '../engine/registry/assets';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { getWorldRegistry } from '../engine/registry/world';
import { createStorageFromProperty, detachStorage, getStorage } from './inventory';
import { businessOpexReduction } from './modifiers';
import { bumpCounter, counter, grantXp, maxCounter, playerModifiers, setCounter } from './progression';
import { addHeat, changeReputation } from './reputation';
import {
  computeNetWorth,
  creditCash,
  debitCash,
  formatMoney,
  newId,
  pushDiagnostic,
  pushNotification,
  round2,
} from './state';
import { pushNews } from './world';
import type { GameState, ID, PropertyDef, PropertyInstance, StorageUnit } from './types';

const B = getBalance();
const worldReg = getWorldRegistry();
const registry = getCommodityRegistry();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ------------------------------------------------------------------ */
/* Valuation                                                           */
/* ------------------------------------------------------------------ */

/** Location premium applied to a property's base price. */
export function locationPremium(state: GameState, locationId: ID): number {
  const loc = worldReg.location(locationId);
  if (!loc) return 1;
  const locState = state.world.locations[locationId];
  const [lo, hi] = B.property.valuationLocationPremiumRange;
  const raw =
    0.55 +
    loc.costOfLivingIndex * 0.42 +
    loc.infrastructure * 0.3 +
    loc.security * 0.18 +
    (locState ? (locState.stability - 0.5) * 0.25 : 0) +
    (locState?.lockdown ? -0.18 : 0) +
    (locState && locState.disasterUntilDay !== null && locState.disasterUntilDay > state.world.day ? -0.22 : 0);
  return round2(clamp(raw, lo, hi));
}

export function askingPrice(state: GameState, def: PropertyDef, locationId: ID): number {
  const jitter = new Rng(`property:${def.id}:${locationId}`, 'property-ask').float(0.94, 1.08);
  return round2(def.basePrice * locationPremium(state, locationId) * jitter * state.world.inflationIndex);
}

export function currentValuation(state: GameState, property: PropertyInstance): number {
  const def = PROPERTY_BY_ID[property.defId];
  if (!def) return property.valuation;
  const conditionFactor = 0.55 + property.condition * 0.45;
  const upgradeFactor = 1 + property.upgradeLevel * 0.22;
  return round2(askingPrice(state, def, property.locationId) * conditionFactor * upgradeFactor * 0.92);
}

export function rentYieldFor(state: GameState, def: PropertyDef, locationId: ID): number {
  const rng = new Rng(`rent:${def.id}:${locationId}`, 'rent-yield');
  const [lo, hi] = B.property.rentYieldAnnualRange;
  const loc = worldReg.location(locationId);
  const demand = loc ? clamp(0.4 + loc.costOfLivingIndex * 0.4 + loc.infrastructure * 0.3, 0.3, 1.4) : 1;
  const kindFactor = def.kind === 'distribution_center' || def.kind === 'factory' ? 0.8 : def.kind === 'residential' ? 1.15 : 1;
  return round2(clamp(rng.float(lo, hi) * demand * kindFactor, 0, hi * 1.6));
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

export interface PropertyListing {
  defId: ID;
  name: string;
  kind: string;
  locationId: ID;
  locationName: string;
  askingPrice: number;
  storageKg: number;
  storageL: number;
  security: number;
  refrigerated: boolean;
  hiddenCompartmentKg: number;
  maxUpgradeLevel: number;
  upgradeCostBase: number;
  opexPerDay: number;
  staffSlots: number;
  rentYieldAnnual: number;
  estimatedRentPerDay: number;
  propertyTaxPerDay: number;
  insurancePerDay: number;
  totalCarryPerDay: number;
  enablesBusinessId: ID | null;
  productionTags: string[];
  recipesEnabled: number;
  description: string;
  affordable: boolean;
  transferTax: number;
  netCost: number;
}

export function propertyListings(state: GameState, locationId?: ID, opts: { kind?: string; search?: string; limit?: number } = {}): PropertyListing[] {
  const at = locationId ?? state.player.locationId;
  const loc = worldReg.location(at);
  if (!loc) return [];
  const search = (opts.search ?? '').trim().toLowerCase();
  const cash = computeNetWorth(state).cash;

  return PROPERTIES.filter((def) => (opts.kind ? def.kind === opts.kind : true))
    .filter((def) => (search ? def.name.toLowerCase().includes(search) || def.kind.includes(search) : true))
    .map((def) => {
      const price = askingPrice(state, def, at);
      const rentYield = rentYieldFor(state, def, at);
      const estimatedRent = round2((price * rentYield) / 365);
      const propertyTax = round2((price * B.property.propertyTaxAnnualFraction) / 365);
      const insurance = round2((price * B.property.insurancePremiumAnnualFraction) / 365);
      const opex = round2(def.opexPerDay * locationPremium(state, at));
      const transferTax = round2(price * B.property.transferTaxFraction);
      return {
        defId: def.id,
        name: def.name,
        kind: def.kind,
        locationId: at,
        locationName: loc.name,
        askingPrice: price,
        storageKg: def.storageKg,
        storageL: def.storageL,
        security: def.security,
        refrigerated: def.refrigerated,
        hiddenCompartmentKg: def.hiddenCompartmentKg,
        maxUpgradeLevel: def.maxUpgradeLevel,
        upgradeCostBase: def.upgradeCostBase,
        opexPerDay: opex,
        staffSlots: def.staffSlots,
        rentYieldAnnual: rentYield,
        estimatedRentPerDay: estimatedRent,
        propertyTaxPerDay: propertyTax,
        insurancePerDay: insurance,
        totalCarryPerDay: round2(opex + propertyTax + insurance),
        enablesBusinessId: def.enablesBusinessId ?? null,
        productionTags: def.productionTags ?? [],
        recipesEnabled: recipesForProperty(def.id).length,
        description: def.description,
        affordable: cash >= price + transferTax,
        transferTax,
        netCost: round2(price + transferTax),
      };
    })
    .sort((a, b) => a.netCost - b.netCost)
    .slice(0, opts.limit ?? PROPERTIES.length);
}

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

export interface PropertyResult {
  ok: boolean;
  reason?: string;
  property?: PropertyInstance;
  storage?: StorageUnit;
  cost?: number;
  proceeds?: number;
}

export function buyProperty(state: GameState, rng: Rng, defId: ID, locationId?: ID): PropertyResult {
  const def = PROPERTY_BY_ID[defId];
  if (!def) return { ok: false, reason: 'Unknown property.' };
  const at = locationId ?? state.player.locationId;
  const loc = worldReg.location(at);
  if (!loc) return { ok: false, reason: 'Unknown location.' };
  const locState = state.world.locations[at];
  if (locState?.lockdown) return { ok: false, reason: `${loc.name} is under lockdown — property transactions are suspended.` };
  if (loc.hidden && !locState?.discovered) return { ok: false, reason: `You cannot buy property in a place you have not found (${loc.name}).` };

  const price = askingPrice(state, def, at);
  const transferTax = round2(price * B.property.transferTaxFraction);
  const total = round2(price + transferTax);
  const heldHere = state.player.properties.filter((p) => p.locationId === at).length;
  if (heldHere >= 8) return { ok: false, reason: 'Local authorities will not register more than eight properties to one owner here.' };

  const move = debitCash(state, total, {
    kind: 'property_buy',
    description: `Bought ${def.name} in ${loc.name}`,
    allowDirty: false,
    locationId: at,
    counterparty: `${loc.name} Land Registry`,
    meta: { defId, price, transferTax },
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? `${def.name} costs ${formatMoney(total)} including transfer tax.` };

  const property: PropertyInstance = {
    id: newId(rng, 'prop'),
    defId: def.id,
    name: def.name,
    locationId: at,
    purchasedDay: state.world.day,
    purchasePrice: price,
    valuation: price,
    upgradeLevel: 0,
    condition: round2(rng.float(0.78, 1)),
    security: round2(clamp(def.security * (0.85 + rng.float(0, 0.3)), 0, 0.98)),
    storageKg: def.storageKg,
    storageL: def.storageL,
    refrigerated: def.refrigerated,
    hiddenCompartmentKg: def.hiddenCompartmentKg,
    opexPerDay: round2(def.opexPerDay * locationPremium(state, at)),
    staffed: false,
    insured: false,
    insurancePremiumPerDay: round2((price * B.property.insurancePremiumAnnualFraction) / 365),
    arrears: 0,
    damagedUntilDay: null,
    raidedDay: null,
    rentalIncomePerDay: round2((price * rentYieldFor(state, def, at)) / 365),
    businessId: null,
    productionLineIds: [],
  };
  state.player.properties.push(property);
  const storage = createStorageFromProperty(state, rng, property);

  bumpCounter(state, 'properties_bought');
  setCounter(state, 'property_capex', round2(counter(state, 'property_capex') + total));
  maxCounter(state, 'largest_property_purchase', total);
  changeReputation(state, 'business', 2.5, `Bought ${def.name} in ${loc.name}`);
  changeReputation(state, 'legal', 1.2, 'Registered property');
  grantXp(state, Math.round(40 + Math.log10(Math.max(1000, price)) * 22), `Acquired ${def.name}`);

  pushNotification(state, {
    kind: 'success',
    title: `Deed signed: ${def.name}`,
    body: `${loc.name}. ${formatMoney(price)} plus ${formatMoney(transferTax)} transfer tax. Storage ${def.storageKg.toLocaleString('en-US')} kg / ${def.storageL.toLocaleString('en-US')} L${def.enablesBusinessId ? `, and it can host a ${def.enablesBusinessId}` : ''}${(def.productionTags ?? []).length > 0 ? `, production tags: ${def.productionTags!.join(', ')}` : ''}.`,
    link: '/game/properties',
    metrics: [
      { label: 'Price', value: formatMoney(price) },
      { label: 'Carry per day', value: formatMoney(property.opexPerDay + round2((price * B.property.propertyTaxAnnualFraction) / 365)) },
      { label: 'Rent per day', value: formatMoney(property.rentalIncomePerDay) },
      { label: 'Storage', value: `${def.storageKg} kg / ${def.storageL} L` },
    ],
  });
  pushDiagnostic(state, {
    system: 'properties',
    level: 'info',
    message: `Bought ${def.id} in ${at} for ${total} (condition ${property.condition}, security ${property.security})`,
    data: { defId: def.id, total, condition: property.condition },
  });
  return { ok: true, property, ...(storage ? { storage } : {}), cost: total };
}

export function sellProperty(state: GameState, propertyId: ID): PropertyResult {
  const property = state.player.properties.find((p) => p.id === propertyId);
  if (!property) return { ok: false, reason: 'You do not own that property.' };
  if (property.businessId) return { ok: false, reason: 'Close or relocate the business operating there first.' };
  if (property.productionLineIds.length > 0) return { ok: false, reason: 'Decommission the production lines on site first.' };

  const storage = state.player.storages.find((s) => s.propertyId === propertyId);
  const stored = storage ? state.player.inventory.filter((i) => i.storageId === storage.id).length : 0;
  if (stored > 0) return { ok: false, reason: `${stored} stack(s) of goods are still stored there. Move or sell them first.` };

  const valuation = currentValuation(state, property);
  // Markets absorb property slowly: a forced sale costs a spread.
  const spread = 0.07;
  const gross = round2(valuation * (1 - spread));
  const tax = round2(Math.max(0, gross - property.purchasePrice) * B.finance.tax.capitalGainsRate);
  const transferTax = round2(gross * B.property.transferTaxFraction * 0.5);
  const proceeds = round2(gross - tax - transferTax);

  if (storage) detachStorage(state, storage.id);
  state.player.properties = state.player.properties.filter((p) => p.id !== propertyId);
  for (const crew of state.player.crew) {
    if (crew.assignment?.targetId === propertyId) crew.assignment = null;
  }

  creditCash(state, proceeds, {
    kind: 'property_buy',
    description: `Sold ${property.name} in ${worldReg.requireLocation(property.locationId).name}`,
    dirty: false,
    locationId: property.locationId,
    meta: { valuation, tax, transferTax, spread },
  });

  const gain = round2(proceeds - property.purchasePrice);
  setCounter(state, 'property_gains', round2(counter(state, 'property_gains') + Math.max(0, gain)));
  bumpCounter(state, 'properties_sold');
  grantXp(state, Math.round(25 + Math.log10(Math.max(1000, gross)) * 12), `Sold ${property.name}`);
  pushNotification(state, {
    kind: gain >= 0 ? 'success' : 'warning',
    title: `Sold ${property.name}`,
    body: `Valuation ${formatMoney(valuation)}, sold at a ${(spread * 100).toFixed(0)}% market spread for ${formatMoney(gross)}. Capital gains tax ${formatMoney(tax)}, transfer tax ${formatMoney(transferTax)}, net ${formatMoney(proceeds)} (${gain >= 0 ? '+' : '−'}${formatMoney(Math.abs(gain))} vs purchase).`,
    link: '/game/properties',
    metrics: [
      { label: 'Net proceeds', value: formatMoney(proceeds) },
      { label: 'Gain', value: formatMoney(gain) },
    ],
  });
  return { ok: true, proceeds, cost: 0 };
}

export function upgradeProperty(state: GameState, rng: Rng, propertyId: ID): PropertyResult {
  const property = state.player.properties.find((p) => p.id === propertyId);
  if (!property) return { ok: false, reason: 'You do not own that property.' };
  const def = PROPERTY_BY_ID[property.defId];
  if (!def) return { ok: false, reason: 'Unknown property type.' };
  if (property.upgradeLevel >= def.maxUpgradeLevel) {
    return { ok: false, reason: `${property.name} is already at its maximum upgrade level (${def.maxUpgradeLevel}).` };
  }
  const level = property.upgradeLevel + 1;
  const cost = round2(def.upgradeCostBase * Math.pow(1.85, level - 1) * B.property.upgradeCostMultiplier * locationPremium(state, property.locationId));
  const move = debitCash(state, cost, {
    kind: 'property_upgrade',
    description: `${property.name} upgrade to level ${level}`,
    allowDirty: false,
    locationId: property.locationId,
    meta: { level, cost },
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? `The upgrade costs ${formatMoney(cost)}.` };

  property.upgradeLevel = level;
  property.storageKg = Math.round(def.storageKg * (1 + level * 0.45));
  property.storageL = Math.round(def.storageL * (1 + level * 0.45));
  property.security = round2(clamp(property.security + 0.09, 0, 0.98));
  property.hiddenCompartmentKg = round2(property.hiddenCompartmentKg + def.hiddenCompartmentKg * 0.4);
  property.condition = round2(clamp(property.condition + 0.12, 0, 1));
  property.opexPerDay = round2(property.opexPerDay * 1.18);
  property.valuation = currentValuation(state, property);
  if (def.refrigerated) property.refrigerated = true;

  const storage = state.player.storages.find((s) => s.propertyId === propertyId);
  if (storage) {
    storage.capacityKg = property.storageKg;
    storage.capacityL = property.storageL;
    storage.security = property.security;
    storage.hiddenCompartmentKg = property.hiddenCompartmentKg;
    storage.refrigerated = property.refrigerated;
    storage.costPerDay = round2(property.opexPerDay);
  }

  setCounter(state, 'upgrade_spend', round2(counter(state, 'upgrade_spend') + cost));
  grantXp(state, Math.round(30 + level * 12), `Upgraded ${property.name} to level ${level}`);
  pushNotification(state, {
    kind: 'success',
    title: `${property.name} → level ${level}`,
    body: `Storage now ${property.storageKg.toLocaleString('en-US')} kg / ${property.storageL.toLocaleString('en-US')} L, security ${(property.security * 100).toFixed(0)}%, valuation ${formatMoney(property.valuation)}. Opex rose to ${formatMoney(property.opexPerDay)}/day.`,
    link: '/game/properties',
    metrics: [
      { label: 'Cost', value: formatMoney(cost) },
      { label: 'Storage', value: `${property.storageKg} kg` },
      { label: 'Security', value: `${(property.security * 100).toFixed(0)}%` },
    ],
  });
  void rng;
  return { ok: true, property, cost };
}

export function insureProperty(state: GameState, propertyId: ID, insured: boolean): { ok: boolean; reason?: string; premiumPerDay?: number } {
  const property = state.player.properties.find((p) => p.id === propertyId);
  if (!property) return { ok: false, reason: 'You do not own that property.' };
  const premium = round2((property.valuation * B.property.insurancePremiumAnnualFraction) / 365);
  property.insured = insured;
  property.insurancePremiumPerDay = insured ? premium : 0;
  return { ok: true, premiumPerDay: insured ? premium : 0 };
}

export function repairProperty(state: GameState, propertyId: ID): { ok: boolean; reason?: string; cost?: number } {
  const property = state.player.properties.find((p) => p.id === propertyId);
  if (!property) return { ok: false, reason: 'You do not own that property.' };
  const def = PROPERTY_BY_ID[property.defId];
  const missing = 1 - property.condition;
  if (missing <= 0.02) return { ok: false, reason: 'The property is already in good condition.' };
  const cost = round2(missing * (def?.basePrice ?? property.purchasePrice) * 0.09);
  const move = debitCash(state, cost, { kind: 'property_upgrade', description: `Repairs at ${property.name}`, allowDirty: false, locationId: property.locationId });
  if (!move.ok) return { ok: false, reason: move.reason ?? 'Insufficient funds.' };
  property.condition = 1;
  property.damagedUntilDay = null;
  property.valuation = currentValuation(state, property);
  return { ok: true, cost };
}

export function assignStaff(state: GameState, propertyId: ID, employeeIds: ID[]): { ok: boolean; reason?: string; assigned?: number } {
  const property = state.player.properties.find((p) => p.id === propertyId);
  if (!property) return { ok: false, reason: 'You do not own that property.' };
  const def = PROPERTY_BY_ID[property.defId];
  const slots = def?.staffSlots ?? 0;
  if (employeeIds.length > slots) return { ok: false, reason: `${property.name} has ${slots} staff slot(s).` };
  let assigned = 0;
  for (const id of employeeIds) {
    const emp = state.player.crew.find((e) => e.id === id);
    if (!emp || emp.status !== 'active' || emp.injured) continue;
    emp.assignment = { kind: property.businessId ? 'business' : 'warehouse', targetId: propertyId, tier: 1, reportsTo: null };
    emp.locationId = property.locationId;
    assigned += 1;
  }
  property.staffed = assigned > 0;
  return { ok: true, assigned };
}

/* ------------------------------------------------------------------ */
/* Daily tick                                                          */
/* ------------------------------------------------------------------ */

export interface PropertyTickResult {
  opex: number;
  tax: number;
  insurance: number;
  rent: number;
  appreciation: number;
  raids: { propertyId: ID; name: string; damage: number; seizedValue: number }[];
  arrearsAdded: number;
}

export function propertyTick(state: GameState, rng: Rng): PropertyTickResult {
  const result: PropertyTickResult = { opex: 0, tax: 0, insurance: 0, rent: 0, appreciation: 0, raids: [], arrearsAdded: 0 };
  const mods = playerModifiers(state);
  const opexCut = businessOpexReduction(mods);

  for (const property of state.player.properties) {
    const def = PROPERTY_BY_ID[property.defId];
    if (!def) continue;

    // Valuation drifts with the local property market and inflation.
    const drift = (B.property.priceAppreciationAnnual / 365) + rng.gaussian(0, B.property.priceVolatility / Math.sqrt(365));
    const before = property.valuation;
    property.valuation = round2(Math.max(def.basePrice * 0.25, property.valuation * (1 + drift)));
    result.appreciation = round2(result.appreciation + (property.valuation - before));

    // Condition decay.
    property.condition = round2(clamp(property.condition - B.property.maintenancePerDayFraction * 6 * (1.2 - property.security * 0.4), 0.05, 1));

    const opex = round2(property.opexPerDay * (1 - opexCut));
    const tax = round2((property.valuation * B.property.propertyTaxAnnualFraction) / 365);
    const insurance = property.insured ? property.insurancePremiumPerDay : 0;
    const due = round2(opex + tax + insurance);

    const payment = debitCash(state, due, {
      kind: due > 0 ? 'property_buy' : 'fee',
      description: `Carrying costs for ${property.name} (opex ${formatMoney(opex)}, tax ${formatMoney(tax)}${insurance > 0 ? `, insurance ${formatMoney(insurance)}` : ''})`,
      allowDirty: false,
      locationId: property.locationId,
      meta: { propertyId: property.id, opex, tax, insurance },
    });
    if (payment.ok) {
      result.opex = round2(result.opex + opex);
      result.tax = round2(result.tax + tax);
      result.insurance = round2(result.insurance + insurance);
      setCounter(state, 'property_opex', round2(counter(state, 'property_opex') + due));
      if (property.arrears > 0) property.arrears = round2(Math.max(0, property.arrears - due));
    } else {
      property.arrears = round2(property.arrears + due);
      result.arrearsAdded = round2(result.arrearsAdded + due);
      if (property.arrears > property.valuation * 0.06) {
        addHeat(state, 3, `Unpaid property costs at ${property.name}`);
        changeReputation(state, 'business', -1.5, 'Property arrears');
      }
    }

    // Rent (only when the property is not running your own operation).
    if (!property.businessId && property.rentalIncomePerDay > 0 && property.condition > 0.35) {
      const occupancy = clamp(0.55 + property.condition * 0.35 + property.security * 0.2 + rng.float(-0.08, 0.08), 0, 1);
      const rent = round2(property.rentalIncomePerDay * occupancy);
      if (rent > 0) {
        creditCash(state, rent, {
          kind: 'business_revenue',
          description: `Rent from ${property.name}`,
          dirty: false,
          locationId: property.locationId,
          counterparty: 'Tenants',
          meta: { propertyId: property.id, occupancy },
        });
        result.rent = round2(result.rent + rent);
        setCounter(state, 'rent_income', round2(counter(state, 'rent_income') + rent));
      }
    }

    // Raids target properties where illegal activity is plausible.
    const storage = state.player.storages.find((s) => s.propertyId === property.id);
    const illegalStored = storage
      ? state.player.inventory.some((i) => i.storageId === storage.id && legalityOf(i.commodityId) !== 'legal')
      : false;
    const heat = state.player.reputation.heat;
    const raidChance =
      B.property.raidChancePerDayByHeat *
      heat *
      (illegalStored ? 3.2 : 1) *
      (1 - property.security * 0.55) *
      state.config.difficultyModifiers.enforcementMultiplier;
    if (raidChance > 0 && rng.chance(clamp(raidChance, 0, 0.35))) {
      const raid = raidProperty(state, rng, property, illegalStored);
      result.raids.push(raid);
    }
  }
  return result;
}

function legalityOf(commodityId: ID): string {
  return registry.get(commodityId)?.legality ?? 'legal';
}

export interface RaidReport {
  propertyId: ID;
  name: string;
  damage: number;
  seizedValue: number;
}

export function raidProperty(state: GameState, rng: Rng, property: PropertyInstance, illegalStored: boolean): RaidReport {
  const [lo, hi] = B.property.damageFractionOnRaid;
  const damage = round2(rng.float(lo, hi) * (1 - property.security * 0.5));
  property.condition = round2(clamp(property.condition - damage, 0.05, 1));
  property.raidedDay = state.world.day;
  property.damagedUntilDay = state.world.day + rng.int(2, 9);
  property.valuation = currentValuation(state, property);

  let seizedValue = 0;
  const storage = state.player.storages.find((s) => s.propertyId === property.id);
  if (storage) {
    const seized: string[] = [];
    // Enforcement only takes contraband: concealment and a real hidden
    // compartment are what protect it.
    for (const stack of state.player.inventory.filter((i) => i.storageId === storage.id)) {
      if (legalityOf(stack.commodityId) === 'legal') continue;
      const concealedChance = 0.28 * (1 - clamp(property.hiddenCompartmentKg / 120, 0, 0.85));
      const found = rng.chance(stack.concealed ? concealedChance : 0.82);
      if (!found) continue;
      const name = registry.get(stack.commodityId)?.name ?? stack.commodityId;
      seizedValue += stack.qty * stack.avgCost;
      seized.push(`${stack.qty} × ${name}`);
      stack.qty = 0;
    }
    state.player.inventory = state.player.inventory.filter((i) => i.qty > 0);
    if (seized.length > 0) {
      pushNotification(state, {
        kind: 'danger',
        title: `Raid: ${property.name}`,
        body: `Officers searched the premises and seized ${seized.join(', ')} worth about ${formatMoney(round2(seizedValue))}. Structural damage ${(damage * 100).toFixed(0)}%.`,
        link: '/game/properties',
        metrics: [
          { label: 'Seized', value: formatMoney(round2(seizedValue)) },
          { label: 'Damage', value: `${(damage * 100).toFixed(0)}%` },
        ],
      });
    }
  }

  // Insurance covers structural damage, never contraband.
  if (property.insured) {
    const payout = round2(property.valuation * damage * B.logistics.insurancePayoutFraction);
    if (payout > 0) {
      creditCash(state, payout, {
        kind: 'insurance',
        description: `Insurance payout for raid damage at ${property.name}`,
        dirty: false,
        locationId: property.locationId,
        meta: { damage, payout },
      });
      pushNotification(state, {
        kind: 'info',
        title: 'Insurance payout',
        body: `${formatMoney(payout)} credited for the damage at ${property.name}.`,
        link: '/game/properties',
      });
    }
  }

  addHeat(state, 6 + (illegalStored ? 12 : 0), `Raid on ${property.name}`);
  changeReputation(state, 'legal', illegalStored ? -5 : -1.5, `Premises raided at ${property.name}`);
  bumpCounter(state, 'property_raids');
  pushNews(state.world, {
    scope: 'local',
    category: 'crime',
    headline: `Officers raid a ${worldReg.requireLocation(property.locationId).name} property`,
    body: illegalStored
      ? `A search of ${property.name} produced seizures and a damaged structure. Neighbours reported vehicles before dawn.`
      : `A search of ${property.name} found nothing chargeable. The owner will still pay for the door.`,
    locationIds: [property.locationId],
    tags: ['crime', 'property'],
    importance: illegalStored ? 3 : 2,
  });
  return { propertyId: property.id, name: property.name, damage, seizedValue: round2(seizedValue) };
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface PropertyView {
  id: ID;
  defId: ID;
  name: string;
  kind: string;
  locationName: string;
  locationId: ID;
  purchasePrice: number;
  valuation: number;
  valuationChange: number;
  upgradeLevel: number;
  maxUpgradeLevel: number;
  nextUpgradeCost: number;
  condition: number;
  security: number;
  storageKg: number;
  storageL: number;
  usedKg: number;
  usedL: number;
  utilisation: number;
  hiddenCompartmentKg: number;
  refrigerated: boolean;
  opexPerDay: number;
  taxPerDay: number;
  insurancePerDay: number;
  carryPerDay: number;
  rentalIncomePerDay: number;
  netPerDay: number;
  insured: boolean;
  arrears: number;
  staffed: boolean;
  staff: { id: ID; name: string; role: string }[];
  businessId: ID | null;
  businessName: string | null;
  productionLines: number;
  recipesEnabled: { id: ID; output: string }[];
  raidedDay: number | null;
  damagedUntilDay: number | null;
  ownedDays: number;
  storageId: ID | null;
}

export function propertyViews(state: GameState): PropertyView[] {
  return state.player.properties.map((p) => {
    const def = PROPERTY_BY_ID[p.defId];
    const storage = state.player.storages.find((s) => s.propertyId === p.id) ?? null;
    const stored = storage ? state.player.inventory.filter((i) => i.storageId === storage.id) : [];
    const usedKg = round2(stored.reduce((s, i) => s + i.qty * weightOf(i.commodityId), 0));
    const usedL = round2(stored.reduce((s, i) => s + i.qty * volumeOf(i.commodityId), 0));
    const taxPerDay = round2((p.valuation * B.property.propertyTaxAnnualFraction) / 365);
    const business = p.businessId ? state.player.businesses.find((b) => b.id === p.businessId) ?? null : null;
    return {
      id: p.id,
      defId: p.defId,
      name: p.name,
      kind: def?.kind ?? 'other',
      locationName: worldReg.location(p.locationId)?.name ?? p.locationId,
      locationId: p.locationId,
      purchasePrice: p.purchasePrice,
      valuation: p.valuation,
      valuationChange: p.purchasePrice > 0 ? round2(p.valuation / p.purchasePrice - 1) : 0,
      upgradeLevel: p.upgradeLevel,
      maxUpgradeLevel: def?.maxUpgradeLevel ?? 0,
      nextUpgradeCost:
        def && p.upgradeLevel < def.maxUpgradeLevel
          ? round2(def.upgradeCostBase * Math.pow(1.85, p.upgradeLevel) * B.property.upgradeCostMultiplier * locationPremium(state, p.locationId))
          : 0,
      condition: p.condition,
      security: p.security,
      storageKg: p.storageKg,
      storageL: p.storageL,
      usedKg,
      usedL,
      utilisation: p.storageKg > 0 ? round2(usedKg / p.storageKg) : 0,
      hiddenCompartmentKg: p.hiddenCompartmentKg,
      refrigerated: p.refrigerated,
      opexPerDay: p.opexPerDay,
      taxPerDay,
      insurancePerDay: p.insurancePremiumPerDay,
      carryPerDay: round2(p.opexPerDay + taxPerDay + p.insurancePremiumPerDay),
      rentalIncomePerDay: p.rentalIncomePerDay,
      netPerDay: round2(p.rentalIncomePerDay - (p.opexPerDay + taxPerDay + p.insurancePremiumPerDay)),
      insured: p.insured,
      arrears: p.arrears,
      staffed: p.staffed,
      staff: state.player.crew.filter((e) => e.assignment?.targetId === p.id).map((e) => ({ id: e.id, name: e.name, role: e.role })),
      businessId: p.businessId,
      businessName: business?.name ?? null,
      productionLines: p.productionLineIds.length,
      recipesEnabled: recipesForProperty(p.defId).map((r) => ({ id: r.id, output: r.outputs[0]?.commodityId ?? '' })),
      raidedDay: p.raidedDay,
      damagedUntilDay: p.damagedUntilDay,
      ownedDays: state.world.day - p.purchasedDay,
      storageId: storage?.id ?? null,
    };
  });
}

function weightOf(commodityId: ID): number {
  return registry.get(commodityId)?.weightKg ?? 0;
}

function volumeOf(commodityId: ID): number {
  return registry.get(commodityId)?.volumeL ?? 0;
}

/** Total storage capacity the player controls, by location. */
export function storagePortfolio(state: GameState): {
  locationId: ID;
  locationName: string;
  units: number;
  capacityKg: number;
  usedKg: number;
  capacityL: number;
  usedL: number;
  secureKg: number;
  refrigeratedKg: number;
  hiddenKg: number;
  costPerDay: number;
}[] {
  const byLocation = new Map<ID, StorageUnit[]>();
  for (const unit of state.player.storages) {
    const list = byLocation.get(unit.locationId);
    if (list) list.push(unit);
    else byLocation.set(unit.locationId, [unit]);
  }
  const out = [];
  for (const [locationId, units] of byLocation) {
    const stacks = state.player.inventory.filter((i) => units.some((u) => u.id === i.storageId));
    out.push({
      locationId,
      locationName: worldReg.location(locationId)?.name ?? locationId,
      units: units.length,
      capacityKg: round2(units.reduce((s, u) => s + u.capacityKg, 0)),
      usedKg: round2(stacks.reduce((s, i) => s + i.qty * weightOf(i.commodityId), 0)),
      capacityL: round2(units.reduce((s, u) => s + u.capacityL, 0)),
      usedL: round2(stacks.reduce((s, i) => s + i.qty * volumeOf(i.commodityId), 0)),
      secureKg: round2(units.filter((u) => u.security > 0.5).reduce((s, u) => s + u.capacityKg, 0)),
      refrigeratedKg: round2(units.filter((u) => u.refrigerated).reduce((s, u) => s + u.capacityKg, 0)),
      hiddenKg: round2(units.reduce((s, u) => s + u.hiddenCompartmentKg, 0)),
      costPerDay: round2(units.reduce((s, u) => s + u.costPerDay, 0)),
    });
  }
  return out.sort((a, b) => b.capacityKg - a.capacityKg);
}

export function propertyPortfolioSummary(state: GameState): {
  count: number;
  totalValuation: number;
  totalPurchasePrice: number;
  unrealisedGain: number;
  carryPerDay: number;
  rentPerDay: number;
  netPerDay: number;
  arrears: number;
  averageCondition: number;
  totalStorageKg: number;
  locations: number;
} {
  const views = propertyViews(state);
  return {
    count: views.length,
    totalValuation: round2(views.reduce((s, v) => s + v.valuation, 0)),
    totalPurchasePrice: round2(views.reduce((s, v) => s + v.purchasePrice, 0)),
    unrealisedGain: round2(views.reduce((s, v) => s + (v.valuation - v.purchasePrice), 0)),
    carryPerDay: round2(views.reduce((s, v) => s + v.carryPerDay, 0)),
    rentPerDay: round2(views.reduce((s, v) => s + v.rentalIncomePerDay, 0)),
    netPerDay: round2(views.reduce((s, v) => s + v.netPerDay, 0)),
    arrears: round2(views.reduce((s, v) => s + v.arrears, 0)),
    averageCondition: views.length > 0 ? round2(views.reduce((s, v) => s + v.condition, 0) / views.length) : 0,
    totalStorageKg: round2(views.reduce((s, v) => s + v.storageKg, 0)),
    locations: new Set(views.map((v) => v.locationId)).size,
  };
}

export function getStorageUnit(state: GameState, storageId: ID): StorageUnit | undefined {
  return getStorage(state, storageId);
}
