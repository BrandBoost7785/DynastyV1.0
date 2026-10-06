/**
 * Businesses — operating companies that produce recurring cash flow (spec §19).
 *
 * A business needs a property of the right kind, staff, and a market. Revenue is
 * driven by local demand (read from the materialised commodity markets, not a
 * constant), clientele health, marketing, your reputation, the economic cycle and
 * daily volatility. Every day produces a `DailyBusinessReport` with labelled
 * drivers so the UI can explain *why* yesterday's profit was what it was.
 *
 * Businesses are also the laundering infrastructure: cash-carrying kinds absorb
 * staged money (see `finance.ts`), which raises revenue on paper and — if the
 * volumes do not match the footfall — attracts attention.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { BUSINESSES, BUSINESS_BY_ID, PROPERTY_BY_ID } from '../engine/registry/assets';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { getWorldRegistry } from '../engine/registry/world';
import { businessRevenueMultiplier } from './events';
import { marketAt } from './markets';
import { businessOpexReduction, businessRevenueBonus, taxReduction } from './modifiers';
import { bumpCounter, counter, grantXp, maxCounter, playerModifiers, setCounter } from './progression';
import { addHeat, changeLocalReputation, changeReputation } from './reputation';
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
import type { BusinessInstance, DailyBusinessReport, GameState, ID } from './types';

const B = getBalance();
const worldReg = getWorldRegistry();
const registry = getCommodityRegistry();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

export interface BusinessListing {
  defId: ID;
  name: string;
  kind: string;
  legality: string;
  setupCost: number;
  baseDailyRevenue: number;
  baseDailyOpex: number;
  staffSlots: number;
  launderingCapacityPerDay: number;
  demandSensitivity: number;
  reputationEffect: { dimension: string; perDay: number };
  requiredPropertyKind: string | null;
  suitableProperties: { id: ID; name: string; locationName: string; free: boolean }[];
  requiredSkill: { skillId: ID; level: number } | null;
  skillMet: boolean;
  estimatedDailyProfit: number;
  estimatedPaybackDays: number;
  canOpen: boolean;
  reason?: string;
  description: string;
}

/** Local demand multiplier read from the materialised markets at a location. */
export function localDemandIndex(state: GameState, locationId: ID): number {
  const loc = worldReg.location(locationId);
  if (!loc) return 1;
  const locState = state.world.locations[locationId];
  let sum = 0;
  let n = 0;
  for (const commodityId of loc.tradedCommodityIds.slice(0, 60)) {
    const market = marketAt(state, locationId, commodityId);
    if (!market || market.fundamental <= 0) continue;
    sum += clamp(market.demand / Math.max(1, market.supply), 0.2, 3);
    n += 1;
  }
  const scarcity = n > 0 ? sum / n : 1;
  const wealth = clamp(0.7 + loc.costOfLivingIndex * 0.45, 0.5, 1.8);
  const stability = locState ? clamp(0.6 + locState.stability * 0.6, 0.5, 1.3) : 1;
  const lockdown = locState?.lockdown ? 0.35 : 1;
  return round2(clamp(scarcity * 0.45 + wealth * 0.4 + stability * 0.15, 0.3, 2.2) * lockdown);
}

export function businessCatalogue(state: GameState, locationId?: ID): BusinessListing[] {
  const at = locationId ?? state.player.locationId;
  const loc = worldReg.location(at);
  if (!loc) return [];
  const demand = localDemandIndex(state, at);
  const priceLevel = state.world.locations[at]?.priceLevel ?? 1;

  return BUSINESSES.map((def) => {
    const suitable = state.player.properties
      .filter((p) => p.locationId === at)
      .filter((p) => propertyKindMatches(p.defId, def.requiredPropertyKind))
      .map((p) => ({
        id: p.id,
        name: p.name,
        locationName: worldReg.location(p.locationId)?.name ?? p.locationId,
        free: p.businessId === null,
      }));
    const skillMet = def.requiredSkill ? (state.player.progression.skills[def.requiredSkill.skillId] ?? 0) >= def.requiredSkill.level : true;
    const revenue = def.baseDailyRevenue * demand * priceLevel;
    const opex = def.baseDailyOpex * priceLevel;
    const estimatedProfit = round2(revenue - opex - revenue * loc.laws.taxRate);
    const canOpen = suitable.some((p) => p.free) && skillMet && computeNetWorth(state).cash >= def.setupCost;
    let reason: string | undefined;
    if (!suitable.some((p) => p.free)) {
      reason = def.requiredPropertyKind
        ? `Needs a free ${def.requiredPropertyKind} property in ${loc.name}.`
        : `Needs a free property in ${loc.name}.`;
    } else if (!skillMet && def.requiredSkill) {
      reason = `Requires ${def.requiredSkill.skillId} ${def.requiredSkill.level}.`;
    } else if (computeNetWorth(state).cash < def.setupCost) {
      reason = `Setup costs ${formatMoney(def.setupCost)}.`;
    }
    return {
      defId: def.id,
      name: def.name,
      kind: def.kind,
      legality: def.legality,
      setupCost: def.setupCost,
      baseDailyRevenue: def.baseDailyRevenue,
      baseDailyOpex: def.baseDailyOpex,
      staffSlots: def.staffSlots,
      launderingCapacityPerDay: def.launderingCapacityPerDay,
      demandSensitivity: def.demandSensitivity,
      reputationEffect: { dimension: def.reputationEffect.dimension, perDay: def.reputationEffect.perDay },
      requiredPropertyKind: def.requiredPropertyKind ?? null,
      suitableProperties: suitable,
      requiredSkill: def.requiredSkill ?? null,
      skillMet,
      estimatedDailyProfit: estimatedProfit,
      estimatedPaybackDays: estimatedProfit > 0 ? Math.round(def.setupCost / estimatedProfit) : -1,
      canOpen,
      ...(canOpen ? {} : { reason }),
      description: def.description,
    };
  }).sort((a, b) => a.setupCost - b.setupCost);
}

function propertyKindMatches(propertyDefId: ID, required?: string): boolean {
  if (!required) return true;
  return PROPERTY_BY_ID[propertyDefId]?.kind === required;
}

/* ------------------------------------------------------------------ */
/* Open / close / upgrade                                              */
/* ------------------------------------------------------------------ */

export interface BusinessActionResult {
  ok: boolean;
  reason?: string;
  business?: BusinessInstance;
  cost?: number;
  proceeds?: number;
}

export function openBusiness(state: GameState, rng: Rng, defId: ID, propertyId: ID): BusinessActionResult {
  const def = BUSINESS_BY_ID[defId];
  if (!def) return { ok: false, reason: 'Unknown business type.' };
  const property = state.player.properties.find((p) => p.id === propertyId);
  if (!property) return { ok: false, reason: 'You do not own that property.' };
  if (property.businessId) return { ok: false, reason: `${property.name} already hosts a business.` };
  if (def.requiredPropertyKind && !propertyKindMatches(property.defId, def.requiredPropertyKind)) {
    return { ok: false, reason: `${def.name} requires a ${def.requiredPropertyKind} property.` };
  }
  if (def.requiredSkill) {
    const have = state.player.progression.skills[def.requiredSkill.skillId] ?? 0;
    if (have < def.requiredSkill.level) {
      return { ok: false, reason: `${def.name} requires ${def.requiredSkill.skillId} ${def.requiredSkill.level} (you have ${have}).` };
    }
  }
  const loc = worldReg.requireLocation(property.locationId);
  if (def.legality !== 'legal' && !loc.laws.tolerated.includes(def.legality)) {
    // Not a hard block: untolerated operations can open, but they start exposed
    // and enforcement attention scales with turnover.
    addHeat(state, 6, `Opened a ${def.legality} business in a jurisdiction that does not tolerate it`);
    pushDiagnostic(state, {
      system: 'businesses',
      level: 'warn',
      message: `${def.name} opened in ${loc.name} where ${def.legality} operations are not tolerated — enforcement attention will be high`,
      data: { defId: def.id, locationId: loc.id },
    });
  }

  const priceLevel = state.world.locations[property.locationId]?.priceLevel ?? 1;
  const setup = round2(def.setupCost * priceLevel);
  const move = debitCash(state, setup, {
    kind: 'business_setup',
    description: `Opened ${def.name} at ${property.name}`,
    allowDirty: def.legality !== 'legal',
    locationId: property.locationId,
    counterparty: def.name,
    meta: { defId, propertyId },
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? `Opening ${def.name} costs ${formatMoney(setup)}.` };

  const business: BusinessInstance = {
    id: newId(rng, 'biz'),
    defId: def.id,
    name: `${def.name} — ${loc.name}`,
    locationId: property.locationId,
    propertyId: property.id,
    openedDay: state.world.day,
    cashbox: 0,
    launderingBuffer: 0,
    launderedTotal: 0,
    staffIds: [],
    managerId: null,
    level: 1,
    clientele: round2(clamp(0.35 + rng.float(0, 0.2) + state.player.reputation.dimensions.business / 400, 0.1, 0.85)),
    marketing: 0,
    reputationLocal: round2(state.player.reputation.local[property.locationId] ?? 0),
    revenue30d: 0,
    opex30d: 0,
    profit30d: 0,
    lastOperatedDay: state.world.day,
    lastDailyReport: null,
    legality: def.legality,
    suspended: false,
    suspendedUntilDay: null,
  };
  state.player.businesses.push(business);
  property.businessId = business.id;
  property.rentalIncomePerDay = 0; // you occupy it now

  bumpCounter(state, 'businesses_opened');
  setCounter(state, 'business_capex', round2(counter(state, 'business_capex') + setup));
  maxCounter(state, 'largest_business_setup', setup);
  changeReputation(state, 'business', 3.5, `Opened ${def.name}`);
  if (def.legality === 'legal') changeReputation(state, 'legal', 2, 'Registered a legitimate business');
  else addHeat(state, 4, `Opened a ${def.legality} business`);
  grantXp(state, Math.round(60 + Math.log10(Math.max(1000, setup)) * 26), `Opened ${def.name}`);

  pushNotification(state, {
    kind: 'success',
    title: `${def.name} is open`,
    body: `${loc.name}. Setup ${formatMoney(setup)}, ${def.staffSlots} staff slot(s), base revenue ${formatMoney(def.baseDailyRevenue)}/day against ${formatMoney(def.baseDailyOpex)} of opex. Clientele starts at ${(business.clientele * 100).toFixed(0)}%.`,
    link: '/game/businesses',
    metrics: [
      { label: 'Setup', value: formatMoney(setup) },
      { label: 'Base revenue/day', value: formatMoney(def.baseDailyRevenue) },
      { label: 'Base opex/day', value: formatMoney(def.baseDailyOpex) },
      ...(def.launderingCapacityPerDay > 0 ? [{ label: 'Laundering capacity/day', value: formatMoney(def.launderingCapacityPerDay) }] : []),
    ],
  });
  return { ok: true, business, cost: setup };
}

export function closeBusiness(state: GameState, businessId: ID): BusinessActionResult {
  const business = state.player.businesses.find((b) => b.id === businessId);
  if (!business) return { ok: false, reason: 'No such business.' };
  const def = BUSINESS_BY_ID[business.defId];
  const salvage = round2((def?.setupCost ?? 20_000) * 0.22 * (0.5 + business.clientele * 0.5));
  if (business.cashbox > 0) {
    creditCash(state, round2(business.cashbox), { kind: 'business_revenue', description: `Final cashbox sweep from ${business.name}`, dirty: business.legality !== 'legal' });
  }
  if (business.launderingBuffer > 0) {
    // Staged dirty cash that never made it through the till is returned as dirty.
    creditCash(state, round2(business.launderingBuffer), { kind: 'launder', description: `Unprocessed cash recovered from ${business.name}`, dirty: true });
  }
  if (salvage > 0) {
    creditCash(state, salvage, { kind: 'business_setup', description: `Salvage and fittings from ${business.name}`, dirty: false });
  }
  const property = state.player.properties.find((p) => p.id === business.propertyId);
  if (property) {
    property.businessId = null;
    property.rentalIncomePerDay = round2(property.valuation * 0.00018);
  }
  for (const employee of state.player.crew) {
    if (employee.assignment?.targetId === businessId) employee.assignment = null;
  }
  state.player.businesses = state.player.businesses.filter((b) => b.id !== businessId);
  bumpCounter(state, 'businesses_closed');
  changeReputation(state, 'business', -1.5, `Closed ${business.name}`);
  changeReputation(state, 'crew', -2, 'Staff lost their jobs when a business closed');
  pushNotification(state, {
    kind: 'info',
    title: `${business.name} closed`,
    body: `Salvage ${formatMoney(salvage)}. The property is free again${property ? ' and can host another operation or be let to tenants' : ''}.`,
    link: '/game/businesses',
  });
  return { ok: true, proceeds: salvage };
}

export function upgradeBusiness(state: GameState, businessId: ID): BusinessActionResult {
  const business = state.player.businesses.find((b) => b.id === businessId);
  if (!business) return { ok: false, reason: 'No such business.' };
  const def = BUSINESS_BY_ID[business.defId];
  if (!def) return { ok: false, reason: 'Unknown business type.' };
  if (business.level >= 5) return { ok: false, reason: 'The operation is already at level 5.' };
  if (business.profit30d <= 0) {
    return { ok: false, reason: 'Investors and landlords only extend credit to a profitable operation. Get 30-day profit positive first.' };
  }
  const cost = round2(def.setupCost * 0.72 * Math.pow(1.7, business.level));
  const move = debitCash(state, cost, {
    kind: 'business_setup',
    description: `Expanded ${business.name} to level ${business.level + 1}`,
    allowDirty: business.legality !== 'legal',
    locationId: business.locationId,
    meta: { level: business.level + 1 },
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? `The expansion costs ${formatMoney(cost)}.` };
  business.level += 1;
  setCounter(state, 'business_capex', round2(counter(state, 'business_capex') + cost));
  changeReputation(state, 'business', 1.8, `Expanded ${business.name}`);
  grantXp(state, Math.round(40 + business.level * 18), `Expanded ${business.name} to level ${business.level}`);
  pushNotification(state, {
    kind: 'success',
    title: `${business.name} → level ${business.level}`,
    body: `Revenue capacity, staff slots and laundering throughput all scale with the level. Cost ${formatMoney(cost)}.`,
    link: '/game/businesses',
  });
  return { ok: true, business, cost };
}

export function investMarketing(state: GameState, businessId: ID, amount: number): { ok: boolean; reason?: string; boost?: number } {
  const business = state.player.businesses.find((b) => b.id === businessId);
  if (!business) return { ok: false, reason: 'No such business.' };
  if (amount <= 0) return { ok: false, reason: 'Amount must be positive.' };
  const move = debitCash(state, round2(amount), {
    kind: 'business_opex',
    description: `Marketing spend for ${business.name}`,
    allowDirty: business.legality !== 'legal',
    locationId: business.locationId,
    meta: { amount },
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? 'Insufficient funds.' };
  const boost = round2(amount * B.business.marketingBoostPerSpend);
  business.marketing = round2(clamp(business.marketing + boost, 0, 3));
  business.clientele = round2(clamp(business.clientele + boost * 0.35, 0.05, 1));
  setCounter(state, 'marketing_spend', round2(counter(state, 'marketing_spend') + amount));
  return { ok: true, boost };
}

export function sweepCashbox(state: GameState, businessId: ID, amount?: number): { ok: boolean; reason?: string; swept?: number } {
  const business = state.player.businesses.find((b) => b.id === businessId);
  if (!business) return { ok: false, reason: 'No such business.' };
  const available = round2(business.cashbox);
  if (available <= 0) return { ok: false, reason: 'The cashbox is empty.' };
  const swept = amount === undefined ? available : round2(Math.min(amount, available));
  if (swept <= 0) return { ok: false, reason: 'Nothing to sweep.' };
  business.cashbox = round2(business.cashbox - swept);
  creditCash(state, swept, {
    kind: 'business_revenue',
    description: `Cashbox sweep from ${business.name}`,
    dirty: business.legality !== 'legal',
    locationId: business.locationId,
    counterparty: business.name,
    meta: { businessId, level: business.level },
  });
  return { ok: true, swept };
}

/* ------------------------------------------------------------------ */
/* Daily operation                                                     */
/* ------------------------------------------------------------------ */

export interface BusinessDayResult {
  businessId: ID;
  name: string;
  report: DailyBusinessReport;
  suspended: boolean;
  closed: boolean;
}

export interface BusinessTickResult {
  results: BusinessDayResult[];
  totalRevenue: number;
  totalOpex: number;
  totalWages: number;
  totalTax: number;
  totalProfit: number;
  suspended: number;
  failures: ID[];
}

export function businessTick(state: GameState, rng: Rng): BusinessTickResult {
  const result: BusinessTickResult = { results: [], totalRevenue: 0, totalOpex: 0, totalWages: 0, totalTax: 0, totalProfit: 0, suspended: 0, failures: [] };
  const mods = playerModifiers(state);
  const revenueBonus = businessRevenueBonus(mods);
  const opexCut = businessOpexReduction(mods);
  const taxCut = taxReduction(mods);

  for (const business of state.player.businesses) {
    const def = BUSINESS_BY_ID[business.defId];
    if (!def) continue;

    if (business.suspended && business.suspendedUntilDay !== null && state.world.day >= business.suspendedUntilDay) {
      business.suspended = false;
      business.suspendedUntilDay = null;
      pushNotification(state, {
        kind: 'success',
        title: `${business.name} reopened`,
        body: 'The suspension was lifted. Clientele takes time to come back.',
        link: '/game/businesses',
      });
    }

    const loc = worldReg.location(business.locationId);
    const locState = state.world.locations[business.locationId];
    const demand = localDemandIndex(state, business.locationId);
    const priceLevel = locState?.priceLevel ?? 1;
    const drivers: DailyBusinessReport['drivers'] = [];

    if (business.suspended) {
      const report: DailyBusinessReport = { day: state.world.day, revenue: 0, opex: round2(def.baseDailyOpex * 0.4), wages: 0, tax: 0, profit: round2(-def.baseDailyOpex * 0.4), drivers: [{ label: 'Suspended by authorities', contribution: -1 }] };
      business.lastDailyReport = report;
      business.cashbox = round2(business.cashbox - report.opex);
      result.suspended += 1;
      result.results.push({ businessId: business.id, name: business.name, report, suspended: true, closed: false });
      continue;
    }

    /* ------------------------------- revenue ------------------------------ */
    const levelFactor = 1 + (business.level - 1) * 0.38;
    const staffed = business.staffIds.length;
    const staffFactor = clamp(0.45 + (staffed / Math.max(1, def.staffSlots)) * 0.75, 0.4, 1.35);
    const manager = business.managerId ? state.player.crew.find((e) => e.id === business.managerId) : null;
    const managerFactor = manager && !manager.injured ? 1 + clamp(manager.stats.skill / 400, 0, 0.22) : 1;
    const demandFactor = 1 + (demand - 1) * def.demandSensitivity;
    const cycleFactor = clamp(0.82 + state.world.cycleFactor * 0.2 + (state.world.indicators.consumerConfidence - 0.5) * 0.25, 0.55, 1.6);
    const reputationFactor = clamp(1 + business.reputationLocal / 260 + state.player.reputation.dimensions.business / 320, 0.6, 1.6);
    const marketingFactor = 1 + clamp(business.marketing, 0, 1.5) * 0.35;
    const clienteleFactor = clamp(0.45 + business.clientele * 0.85, 0.35, 1.4);
    const volatility = 1 + rng.gaussian(0, B.business.dailyRevenueVolatility * (def.legality === 'legal' ? 1 : 1.5));
    const launderingBoost = business.launderingBuffer > 0 ? 1 + clamp((business.launderingBuffer / Math.max(1, def.baseDailyRevenue * 4)) * B.business.launderingIntegrationFraction, 0, 0.55) : 1;

    // Authored events can move revenue for a bounded number of days.
    const eventFactor = businessRevenueMultiplier(state, business.locationId);
    const revenue = round2(
      Math.max(
        0,
        def.baseDailyRevenue *
          levelFactor *
          staffFactor *
          managerFactor *
          demandFactor *
          cycleFactor *
          reputationFactor *
          marketingFactor *
          clienteleFactor *
          priceLevel *
          launderingBoost *
          eventFactor *
          volatility *
          (1 + revenueBonus),
      ),
    );

    drivers.push(
      { label: 'Base revenue', contribution: def.baseDailyRevenue },
      ...(eventFactor !== 1 ? [{ label: 'Events in force', contribution: round2(def.baseDailyRevenue * (eventFactor - 1)) }] : []),
      { label: `Level ${business.level}`, contribution: round2(def.baseDailyRevenue * (levelFactor - 1)) },
      { label: `Staffing ${staffed}/${def.staffSlots}`, contribution: round2(def.baseDailyRevenue * (staffFactor - 1)) },
      { label: 'Local demand', contribution: round2(def.baseDailyRevenue * (demandFactor - 1)) },
      { label: 'Economic cycle', contribution: round2(def.baseDailyRevenue * (cycleFactor - 1)) },
      { label: 'Reputation', contribution: round2(def.baseDailyRevenue * (reputationFactor - 1)) },
      { label: 'Marketing', contribution: round2(def.baseDailyRevenue * (marketingFactor - 1)) },
      { label: 'Clientele', contribution: round2(def.baseDailyRevenue * (clienteleFactor - 1)) },
    );
    if (manager) drivers.push({ label: `Manager ${manager.name}`, contribution: round2(def.baseDailyRevenue * (managerFactor - 1)) });
    if (launderingBoost > 1) drivers.push({ label: 'Cash through the till', contribution: round2(def.baseDailyRevenue * (launderingBoost - 1)) });

    /* -------------------------------- costs ------------------------------- */
    // Facility overhead per staff slot. Wages themselves are paid by the payroll
    // run in crew.ts — counting them here too would charge you twice.
    const facilityOverhead = round2(B.business.staffCostPerDayBase * def.staffSlots * 0.35 * priceLevel);
    const opex = round2((def.baseDailyOpex * (1 + (business.level - 1) * 0.3) * priceLevel + facilityOverhead) * (1 - opexCut));
    const wages = round2(business.staffIds.reduce((sum, id) => sum + (state.player.crew.find((e) => e.id === id)?.salaryPerDay ?? 0), 0));

    /* --------------------------------- tax -------------------------------- */
    let tax = 0;
    if (def.legality === 'legal' && loc) {
      tax = round2(Math.max(0, revenue - opex) * Math.max(0, loc.laws.taxRate * (1 - taxCut)));
    }

    const profit = round2(revenue - opex - tax);
    const report: DailyBusinessReport = {
      day: state.world.day,
      revenue,
      opex,
      wages,
      tax,
      profit,
      drivers: drivers.filter((d) => Math.abs(d.contribution) > 0.5).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 8),
    };
    business.lastDailyReport = report;
    business.cashbox = round2(business.cashbox + profit);
    business.lastOperatedDay = state.world.day;

    // Rolling 30-day figures (EWMA over a 30-day window).
    business.revenue30d = round2((business.revenue30d * 29) / 30 + revenue);
    business.opex30d = round2((business.opex30d * 29) / 30 + (opex + tax));
    business.profit30d = round2((business.profit30d * 29) / 30 + profit);

    /* ------------------------------ clientele ----------------------------- */
    const clienteleTarget = clamp(
      0.42 +
        (profit > 0 ? 0.22 : -0.18) +
        state.player.reputation.dimensions.business / 300 +
        business.reputationLocal / 400 +
        clamp(business.marketing, 0, 1.5) * 0.14 +
        (business.legality === 'legal' ? 0.05 : -0.04),
      0.05,
      1,
    );
    business.clientele = round2(clamp(business.clientele + (clienteleTarget - business.clientele) * 0.08 + rng.gaussian(0, 0.012), 0.03, 1));
    business.marketing = round2(Math.max(0, business.marketing * (1 - B.business.marketingDecayPerDay)));
    business.reputationLocal = round2(clamp(business.reputationLocal + def.reputationEffect.perDay * 0.35 + (profit > 0 ? 0.12 : -0.2), -100, 100));

    /* ----------------------------- reputation ----------------------------- */
    if (def.reputationEffect.perDay !== 0) {
      changeReputation(state, def.reputationEffect.dimension, def.reputationEffect.perDay, `${business.name} operating`);
    }
    // Trading in a neighbourhood moves the owner's standing there: a profitable,
    // legal shop builds it, a loss-making or illegal one erodes it.
    changeLocalReputation(
      state,
      business.locationId,
      round2(def.reputationEffect.perDay * 0.2 + (profit > 0 ? 0.05 : -0.08) + (business.legality === 'legal' ? 0.02 : -0.06)),
      `${business.name} operating in ${worldReg.location(business.locationId)?.name ?? business.locationId}`,
    );
    if (def.legality !== 'legal') {
      addHeat(state, round2(0.8 + (revenue / Math.max(1, def.baseDailyRevenue)) * 0.9), `Illegal business turnover at ${business.name}`);
    }

    /* ------------------------------- accounting --------------------------- */
    result.totalRevenue = round2(result.totalRevenue + revenue);
    result.totalOpex = round2(result.totalOpex + opex);
    result.totalWages = round2(result.totalWages + wages);
    result.totalTax = round2(result.totalTax + tax);
    result.totalProfit = round2(result.totalProfit + profit);
    setCounter(state, 'business_revenue', round2(counter(state, 'business_revenue') + revenue));
    setCounter(state, 'business_profit', round2(counter(state, 'business_profit') + Math.max(0, profit)));
    if (tax > 0) setCounter(state, 'tax_paid', round2(counter(state, 'tax_paid') + tax));

    // Cashboxes accumulate; sweeping is a player action, but a manager sweeps
    // automatically so an idle empire does not strand cash.
    if (business.cashbox > def.baseDailyRevenue * 12 && manager) {
      const swept = sweepCashbox(state, business.id);
      if (swept.ok && swept.swept) {
        pushDiagnostic(state, {
          system: 'businesses',
          level: 'debug',
          message: `${manager.name} swept ${formatMoney(swept.swept)} from ${business.name}`,
          data: { businessId: business.id, swept: swept.swept },
        });
      }
    }

    /* -------------------------------- failure ----------------------------- */
    if (business.profit30d < 0 && state.world.day - business.openedDay > 20) {
      const failureChance = B.business.failureChancePerDayIfUnprofitable * (1 + Math.abs(business.profit30d) / Math.max(1, def.baseDailyOpex * 30));
      if (rng.chance(clamp(failureChance, 0, 0.08))) {
        result.failures.push(business.id);
        pushNews(state.world, {
          scope: 'local',
          category: 'economy',
          headline: `${business.name} closes its doors`,
          body: `After ${state.world.day - business.openedDay} days of losses the operation stopped trading. Staff are looking for work.`,
          locationIds: [business.locationId],
          tags: ['business', 'economy'],
          importance: 2,
        });
        pushNotification(state, {
          kind: 'danger',
          title: `${business.name} failed`,
          body: `Sustained losses (30-day profit ${formatMoney(business.profit30d)}) forced closure. The property is empty again.`,
          link: '/game/businesses',
        });
        changeReputation(state, 'business', -4, 'A business failed');
        changeReputation(state, 'crew', -3, 'Staff were left without work');
        bumpCounter(state, 'business_failures');
        closeBusiness(state, business.id);
        continue;
      }
    }

    result.results.push({ businessId: business.id, name: business.name, report, suspended: false, closed: false });
  }

  // Remove failures that closed themselves during the loop.
  result.results = result.results.filter((r) => state.player.businesses.some((b) => b.id === r.businessId));
  return result;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface BusinessView {
  id: ID;
  defId: ID;
  name: string;
  kind: string;
  legality: string;
  locationName: string;
  propertyName: string | null;
  level: number;
  openedDay: number;
  daysOperating: number;
  cashbox: number;
  launderingBuffer: number;
  launderedTotal: number;
  launderingCapacityPerDay: number;
  clientele: number;
  marketing: number;
  reputationLocal: number;
  staffCount: number;
  staffSlots: number;
  staff: { id: ID; name: string; role: string; skill: number }[];
  manager: { id: ID; name: string; skill: number } | null;
  revenue30d: number;
  opex30d: number;
  profit30d: number;
  dailyRevenue: number;
  dailyOpex: number;
  dailyTax: number;
  dailyWages: number;
  dailyProfit: number;
  suspended: boolean;
  suspendedUntilDay: number | null;
  lastReport: DailyBusinessReport | null;
  valuation: number;
  upgradeCost: number;
  canUpgrade: boolean;
  paybackDays: number;
  commodityLines: number;
}

export function businessViews(state: GameState): BusinessView[] {
  return state.player.businesses.map((b) => {
    const def = BUSINESS_BY_ID[b.defId];
    const report = b.lastDailyReport;
    const property = state.player.properties.find((p) => p.id === b.propertyId);
    const manager = b.managerId ? state.player.crew.find((e) => e.id === b.managerId) ?? null : null;
    const valuation = round2((def?.setupCost ?? 20_000) * (1 + (b.level - 1) * 0.6) * (0.4 + b.clientele * 0.9) + Math.max(0, b.profit30d) * 60);
    return {
      id: b.id,
      defId: b.defId,
      name: b.name,
      kind: def?.kind ?? 'retail',
      legality: b.legality,
      locationName: worldReg.location(b.locationId)?.name ?? b.locationId,
      propertyName: property?.name ?? null,
      level: b.level,
      openedDay: b.openedDay,
      daysOperating: state.world.day - b.openedDay,
      cashbox: b.cashbox,
      launderingBuffer: b.launderingBuffer,
      launderedTotal: b.launderedTotal,
      launderingCapacityPerDay: round2((def?.launderingCapacityPerDay ?? 0) * (1 + (b.level - 1) * 0.35)),
      clientele: b.clientele,
      marketing: b.marketing,
      reputationLocal: b.reputationLocal,
      staffCount: b.staffIds.length,
      staffSlots: def?.staffSlots ?? 0,
      staff: b.staffIds
        .map((id) => state.player.crew.find((e) => e.id === id))
        .filter((e): e is NonNullable<typeof e> => e !== undefined)
        .map((e) => ({ id: e.id, name: e.name, role: e.role, skill: e.stats.skill })),
      manager: manager ? { id: manager.id, name: manager.name, skill: manager.stats.skill } : null,
      revenue30d: b.revenue30d,
      opex30d: b.opex30d,
      profit30d: b.profit30d,
      dailyRevenue: report?.revenue ?? 0,
      dailyOpex: report?.opex ?? 0,
      dailyTax: report?.tax ?? 0,
      dailyWages: report?.wages ?? 0,
      dailyProfit: report?.profit ?? 0,
      suspended: b.suspended,
      suspendedUntilDay: b.suspendedUntilDay,
      lastReport: report,
      valuation,
      upgradeCost: b.level >= 5 ? 0 : round2((def?.setupCost ?? 20_000) * 0.72 * Math.pow(1.7, b.level)),
      canUpgrade: b.level < 5 && b.profit30d > 0,
      paybackDays: report && report.profit > 0 ? Math.round((def?.setupCost ?? 20_000) / report.profit) : -1,
      commodityLines: state.player.productionLines.filter((l) => l.propertyId === b.propertyId).length,
    };
  });
}

export interface BusinessPortfolioSummary {
  count: number;
  legal: number;
  illegal: number;
  dailyRevenue: number;
  dailyOpex: number;
  dailyTax: number;
  dailyWages: number;
  dailyProfit: number;
  profit30d: number;
  cashboxTotal: number;
  launderingBufferTotal: number;
  launderedTotal: number;
  totalValuation: number;
  staffEmployed: number;
  suspended: number;
  bestPerformer: { name: string; profit: number } | null;
  worstPerformer: { name: string; profit: number } | null;
}

export function businessPortfolioSummary(state: GameState): BusinessPortfolioSummary {
  const views = businessViews(state);
  const sorted = [...views].sort((a, b) => b.dailyProfit - a.dailyProfit);
  return {
    count: views.length,
    legal: views.filter((v) => v.legality === 'legal').length,
    illegal: views.filter((v) => v.legality !== 'legal').length,
    dailyRevenue: round2(views.reduce((s, v) => s + v.dailyRevenue, 0)),
    dailyOpex: round2(views.reduce((s, v) => s + v.dailyOpex, 0)),
    dailyTax: round2(views.reduce((s, v) => s + v.dailyTax, 0)),
    dailyWages: round2(views.reduce((s, v) => s + v.dailyWages, 0)),
    dailyProfit: round2(views.reduce((s, v) => s + v.dailyProfit, 0)),
    profit30d: round2(views.reduce((s, v) => s + v.profit30d, 0)),
    cashboxTotal: round2(views.reduce((s, v) => s + v.cashbox, 0)),
    launderingBufferTotal: round2(views.reduce((s, v) => s + v.launderingBuffer, 0)),
    launderedTotal: round2(views.reduce((s, v) => s + v.launderedTotal, 0)),
    totalValuation: round2(views.reduce((s, v) => s + v.valuation, 0)),
    staffEmployed: views.reduce((s, v) => s + v.staffCount, 0),
    suspended: views.filter((v) => v.suspended).length,
    bestPerformer: sorted[0] ? { name: sorted[0]!.name, profit: sorted[0]!.dailyProfit } : null,
    worstPerformer: sorted.length > 0 ? { name: sorted[sorted.length - 1]!.name, profit: sorted[sorted.length - 1]!.dailyProfit } : null,
  };
}

/** Which commodity lines a business's demand is exposed to (UI explanation). */
export function businessDemandDrivers(state: GameState, businessId: ID): { label: string; value: number }[] {
  const business = state.player.businesses.find((b) => b.id === businessId);
  const def = business ? BUSINESS_BY_ID[business.defId] : null;
  if (!business || !def) return [];
  const out: { label: string; value: number }[] = [];
  const demand = localDemandIndex(state, business.locationId);
  out.push({ label: 'Local demand index', value: demand });
  const loc = worldReg.location(business.locationId);
  if (loc) {
    out.push({ label: `Local price level (${loc.name})`, value: state.world.locations[business.locationId]?.priceLevel ?? 1 });
    out.push({ label: 'Local tax rate', value: loc.laws.taxRate });
    // Show the most relevant commodity markets for the sector.
    const categories = categoriesForKind(def.kind);
    for (const category of categories.slice(0, 4)) {
      const commodity = registry.all().find((c) => c.category === category);
      if (!commodity) continue;
      const market = marketAt(state, business.locationId, commodity.id);
      if (!market) continue;
      out.push({ label: `${category} price vs fundamental`, value: market.fundamental > 0 ? round2(market.price / market.fundamental) : 1 });
    }
  }
  out.push({ label: 'Economic cycle factor', value: state.world.cycleFactor });
  out.push({ label: 'Consumer confidence', value: state.world.indicators.consumerConfidence });
  return out;
}

function categoriesForKind(kind: string): string[] {
  switch (kind) {
    case 'restaurant':
      return ['foodstuff', 'agriculture', 'livestock'];
    case 'retail':
      return ['consumer_goods', 'textile', 'electronics'];
    case 'nightclub':
    case 'entertainment':
      return ['alcohol', 'narcotic', 'luxury'];
    case 'pawnshop':
      return ['luxury', 'art', 'metal'];
    case 'factory':
      return ['metal', 'chemical', 'manufactured'];
    case 'farm':
      return ['agriculture', 'livestock'];
    case 'clinic':
      return ['pharmaceutical', 'medical'];
    case 'logistics_firm':
    case 'import_export':
      return ['energy', 'raw_material'];
    case 'consultancy':
    case 'law_firm':
      return ['information', 'financial_asset'];
    default:
      return ['consumer_goods'];
  }
}
