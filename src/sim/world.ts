/**
 * World simulation — the layer that makes the world move without the player.
 *
 * Owns macroeconomics (inflation, rates, business cycle, sentiment), location
 * and route dynamics (lockdowns, closures, disruptions), governments,
 * competitors and shock lifecycle. Company and crypto-asset dynamics live in
 * `stocks.ts` and `crypto.ts`; faction dynamics in `factions.ts`. All of them
 * are stepped from `tick.ts` in a fixed order so a day is reproducible.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { getWorldRegistry } from '../engine/registry/world';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { COUNTRIES, REGIONS } from '../engine/registry/regions';
import { FACTIONS, FACTION_BY_ID } from '../engine/registry/actors';
import type {
  ActiveShock,
  CommodityCategory,
  CompetitorState,
  DiagnosticEntry,
  EconomicIndicators,
  EventScope,
  FactionState,
  GovernmentState,
  ID,
  LocationState,
  RouteState,
  Severity,
  WorldState,
} from './types';
import { orderedEntries } from './ordering';

const B = getBalance();

/**
 * Build a record whose keys are inserted in ascending order.
 *
 * The simulation must not care what order a record's keys happen to be in, and it
 * mostly does not — but where it does (a seeded RNG drawn per entry, a float total
 * accumulated per entry), the order has to be *the same* for a live world and for
 * the same world reloaded from a save, whose canonical JSON has sorted keys. These
 * records are written once, at world creation, so imposing the order here costs
 * nothing and removes the need to re-sort them on every tick.
 */
function orderedRecord<T>(entries: [ID, T][]): Record<ID, T> {
  const out: Record<ID, T> = {};
  for (const [key, value] of [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) out[key] = value;
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function round(v: number, d = 4): number {
  const m = 10 ** d;
  return Math.round(v * m) / m;
}

/**
 * Builds a fresh world. Deterministic in `seed`: two worlds created with the
 * same seed are byte-identical, which is what makes save reproduction and
 * simulation tests possible.
 */
export function createWorldState(seed: string, startDay = 0): WorldState {
  const worldReg = getWorldRegistry();
  const rng = new Rng(`${seed}:world`, 'world-gen');

  const locations: Record<ID, LocationState> = orderedRecord(
    worldReg.locations.map((l): [ID, LocationState] => [l.id, {
      locationId: l.id,
      discovered: !l.hidden,
      stability: round(clamp(0.35 + l.security * 0.5 + rng.float(-0.1, 0.1), 0.02, 1), 3),
      lockdown: false,
      lockdownUntilDay: null,
      borderClosed: false,
      borderClosedUntilDay: null,
      sanctions: false,
      priceLevel: round(0.94 + rng.float(0, 0.12), 4),
      controllingFactionId: l.factionIds[0] ?? null,
      playerHeat: 0,
      patrolIntensity: round(l.laws.enforcement * (0.6 + rng.float(0, 0.5)), 3),
      disasterUntilDay: null,
      demandShift: {},
      lastVisitedDay: null,
    }]),
  );

  const routes: Record<ID, RouteState> = orderedRecord(
    worldReg.routes.map((r): [ID, RouteState] => [r.id, {
      routeId: r.id,
      disrupted: false,
      disruptedUntilDay: null,
      disruptionReason: null,
      risk: round(r.baseRisk, 3),
      costMultiplier: 1,
    }]),
  );

  const factionEntries: [ID, WorldState['factions'][ID]][] = [];
  for (const f of FACTIONS) {
    const relations: Record<ID, number> = {};
    for (const other of FACTIONS) {
      if (other.id === f.id) continue;
      let rel = rng.float(-12, 18);
      if (f.rivalIds.includes(other.id)) rel = -40 - rng.float(0, 30);
      if (f.allyIds.includes(other.id)) rel = 40 + rng.float(0, 30);
      // Same-kind factions in the same territory compete.
      if (f.kind === other.kind && f.territoryIds.some((t) => other.territoryIds.includes(t))) rel -= 18;
      relations[other.id] = round(clamp(rel, -100, 100), 1);
    }
    factionEntries.push([f.id, {
      factionId: f.id,
      resources: f.resources,
      power: f.power,
      aggression: round(clamp(0.2 + (f.kind === 'cartel' || f.kind === 'militia' || f.kind === 'criminal_syndicate' ? 0.45 : 0.1) + rng.float(0, 0.25), 0, 1), 3),
      relations,
      atWarWith: f.rivalIds.filter((r) => FACTIONS.some((x) => x.id === r)).slice(0, 1),
      alliedWith: f.allyIds.filter((a) => FACTIONS.some((x) => x.id === a)),
      controlledLocationIds: [...f.territoryIds],
      playerStanding: 0,
      mood: round(rng.float(0.4, 0.65), 3),
      lastActionDay: startDay,
      pendingOffers: [],
    }]);
  }
  const factions: WorldState['factions'] = orderedRecord(factionEntries);

  const governmentEntries: [ID, GovernmentState][] = [];
  for (const c of COUNTRIES) {
    governmentEntries.push([c.id, {
      countryId: c.id,
      stability: round(clamp(c.governance * 0.8 + rng.float(0, 0.25), 0.05, 1), 3),
      crackdownIntensity: round(clamp((1 - c.tolerance) * 0.8 + rng.float(0, 0.2), 0.05, 1), 3),
      taxRate: round(0.04 + c.governance * 0.1, 4),
      currencyIndex: round(0.9 + rng.float(0, 0.25), 4),
      sanctionsTargetIds: [],
      policy: c.development > 0.8 ? 'open' : c.development > 0.5 ? 'protectionist' : 'austerity',
      electionInDays: rng.chance(0.4) ? rng.int(120, 900) : null,
    }]);
  }
  const governments: Record<ID, GovernmentState> = orderedRecord(governmentEntries);

  const competitors = createCompetitors(rng, startDay);

  const world: WorldState = {
    day: startDay,
    inflationIndex: 1,
    inflationRate: B.economy.baseInflationPerDay * 365,
    interestRate: B.finance.baseInterestRateAnnual,
    cyclePhase: rng.float(0, 1),
    cycleFactor: 1,
    globalSentiment: round(rng.float(0.45, 0.6), 3),
    stockIndex: B.stocks.indexBaseLevel,
    stockIndexHistory: [B.stocks.indexBaseLevel],
    cryptoIndex: 100,
    cryptoIndexHistory: [100],
    unemployment: round(0.06 + rng.float(0, 0.05), 4),
    consumerConfidence: round(rng.float(0.45, 0.6), 3),
    gdpIndex: 100,
    shocks: [],
    locations,
    routes,
    factions,
    companies: {},
    cryptoAssets: {},
    competitors,
    governments,
    activeEvents: [],
    news: [],
    eventCooldowns: {},
    scheduledEvents: [],
    indicators: {
      inflationYoY: B.economy.baseInflationPerDay * 365,
      interestRate: B.finance.baseInterestRateAnnual,
      unemployment: 0.07,
      consumerConfidence: 0.5,
      gdpGrowth: 0.02,
      stockIndexChange30d: 0,
      cryptoIndexChange30d: 0,
      cyclePhaseLabel: 'expansion',
      averageCommodityPriceIndex: 1,
      tradeVolume30d: 0,
      globalRiskAppetite: 0.5,
    },
  };

  world.cycleFactor = cycleFactorFor(world.cyclePhase);
  return world;
}

function createCompetitors(rng: Rng, startDay: number): Record<ID, CompetitorState> {
  const worldReg = getWorldRegistry();
  const registry = getCommodityRegistry();
  const categories = registry.categories();
  const out: [ID, CompetitorState][] = [];
  const names = [
    'Halden Freight', 'Vasquez Hermanos', 'Northwind Trading', 'Kessel Mercantile',
    'Blue Harbor Logistics', 'Sable Ridge Commodities', 'Meridian Cargo', 'Tessier et Fils',
    'Okonkwo Sons', 'Pacific Rim Bulk', 'Redstone Supply', 'Almeida Distribuidora',
    'Kaito Shoji', 'Ferrovia Norte',
  ];
  for (let i = 0; i < B.world.competitorCount; i++) {
    const id = `comp_${i + 1}`;
    const home = rng.pick(worldReg.locations.filter((l) => !l.hidden));
    const focusCount = rng.int(2, 4);
    const focus = rng.sample(categories, focusCount);
    const operating = [home.id];
    const neighbours = worldReg.neighboursOf(home.id).slice(0, rng.int(1, 3));
    for (const n of neighbours) operating.push(n.other.id);
    out.push([id, {
      id,
      name: names[i % names.length] ?? `Competitor ${i + 1}`,
      kind: rng.pick(['trader', 'syndicate', 'corporation', 'logistics'] as const),
      homeLocationId: home.id,
      capital: round(rng.float(400_000, 24_000_000), 0),
      aggression: round(rng.float(0.25, 0.95), 3),
      focus,
      operatingLocationIds: operating,
      reputation: round(rng.float(-20, 60), 1),
      lastActionDay: startDay,
      hostileToPlayer: false,
    }]);
  }
  return orderedRecord(out);
}

/** Sinusoidal business cycle → demand/price multiplier. */
export function cycleFactorFor(phase: number): number {
  return 1 + B.economy.cycleAmplitude * Math.sin(phase * Math.PI * 2);
}

export function cyclePhaseLabel(phase: number): EconomicIndicators['cyclePhaseLabel'] {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.15) return 'recovery';
  if (p < 0.38) return 'expansion';
  if (p < 0.55) return 'boom';
  if (p < 0.72) return 'contraction';
  return 'recession';
}

export interface WorldStepResult {
  diagnostics: DiagnosticEntry[];
  newShocks: ActiveShock[];
}

/**
 * Advance the macro world by one day. Order matters and is fixed:
 * rates → inflation → cycle → sentiment → locations → routes → competitors →
 * governments → shocks. Company/crypto/faction steps are separate and are
 * called by `tick.ts` after this.
 */
export function stepWorld(world: WorldState, rng: Rng, day: number): WorldStepResult {
  const diagnostics: DiagnosticEntry[] = [];
  const newShocks: ActiveShock[] = [];
  world.day = day;

  /* ------------------------- interest rates ------------------------- */
  const targetRate = B.finance.baseInterestRateAnnual + Math.max(0, world.inflationRate - 0.04) * 0.85;
  const rateDrift = (targetRate - world.interestRate) * 0.02 + rng.gaussian(0, B.finance.rateVolatilityPerDay);
  world.interestRate = round(clamp(world.interestRate + rateDrift, B.finance.rateFloor, B.finance.rateCeiling), 5);

  /* ---------------------------- inflation --------------------------- */
  // Shock pressure is an *average* severity contribution with a hard cap. Summing
  // per-shock pressure let a busy event season stack twenty shocks and push
  // inflation to its ceiling, which then saturated the policy rate.
  const shockSeverity = world.shocks.reduce(
    (acc, s) => acc + (s.severity === 'catastrophic' ? 1 : s.severity === 'major' ? 0.55 : s.severity === 'moderate' ? 0.22 : 0.08),
    0,
  );
  const shockPressure = clamp((shockSeverity / Math.max(1, world.shocks.length)) * 0.0005, 0, 0.00014);
  const inflationDrift =
    B.economy.baseInflationPerDay +
    rng.gaussian(0, B.economy.inflationVolatility) +
    shockPressure -
    (world.cycleFactor - 1) * 0.0004;
  world.inflationRate = clamp(world.inflationRate * 0.94 + inflationDrift * 365 * 0.06, -0.12, 1.4);
  world.inflationIndex = clamp(world.inflationIndex * (1 + inflationDrift), B.economy.inflationFloor, B.economy.inflationCeiling);
  diagnostics.push({
    day, turn: 0, system: 'economy', level: 'debug',
    message: `inflationIndex=${round(world.inflationIndex, 4)} rate=${round(world.inflationRate, 4)} baseRate=${round(world.interestRate, 4)}`,
    data: { inflationIndex: round(world.inflationIndex, 4), inflationRate: round(world.inflationRate, 4), interestRate: world.interestRate },
  });

  // Keep the shock population bounded so long games do not accumulate an
  // unbounded stack of overlapping modifiers.
  const MAX_SHOCKS = 14;
  if (world.shocks.length > MAX_SHOCKS) {
    const rank = (s: ActiveShock) =>
      (s.severity === 'catastrophic' ? 4 : s.severity === 'major' ? 3 : s.severity === 'moderate' ? 2 : 1) * 1000 -
      ((s.expiresDay ?? day + 999) - day);
    world.shocks.sort((a, b) => rank(b) - rank(a));
    const dropped = world.shocks.splice(MAX_SHOCKS);
    if (dropped.length > 0) {
      diagnostics.push({
        day, turn: 0, system: 'economy', level: 'debug',
        message: `${dropped.length} shock(s) retired to keep the active set at ${MAX_SHOCKS}`,
        data: { dropped: dropped.length, active: world.shocks.length },
      });
    }
  }

  /* -------------------------- business cycle ------------------------ */
  world.cyclePhase = (world.cyclePhase + 1 / B.economy.cycleLengthDays) % 1;
  world.cycleFactor = round(cycleFactorFor(world.cyclePhase), 4);

  /* ------------------------- global sentiment ----------------------- */
  const sentimentTarget = clamp(0.5 + (world.cycleFactor - 1) * 1.6 - Math.max(0, world.inflationRate - 0.06) * 1.2 + (world.consumerConfidence - 0.5) * 0.6, 0.02, 0.98);
  world.globalSentiment = round(clamp(world.globalSentiment + (sentimentTarget - world.globalSentiment) * 0.08 + rng.gaussian(0, 0.02), 0.01, 0.99), 4);
  world.consumerConfidence = round(clamp(world.consumerConfidence + (world.cycleFactor - 1) * 0.06 + rng.gaussian(0, 0.012), 0.05, 0.98), 4);
  world.unemployment = round(clamp(world.unemployment - (world.cycleFactor - 1) * 0.012 + rng.gaussian(0, 0.0016), 0.015, 0.45), 4);
  world.gdpIndex = round(world.gdpIndex * (1 + (world.cycleFactor - 1) * 0.0022 + rng.gaussian(0, 0.0009)), 4);

  /* ---------------------------- locations --------------------------- */
  for (const loc of Object.values(world.locations)) {
    if (loc.lockdown && loc.lockdownUntilDay !== null && day >= loc.lockdownUntilDay) {
      loc.lockdown = false;
      loc.lockdownUntilDay = null;
      diagnostics.push({ day, turn: 0, system: 'world', level: 'info', message: `Lockdown lifted at ${loc.locationId}` });
    }
    if (loc.borderClosed && loc.borderClosedUntilDay !== null && day >= loc.borderClosedUntilDay) {
      loc.borderClosed = false;
      loc.borderClosedUntilDay = null;
    }
    if (loc.disasterUntilDay !== null && day >= loc.disasterUntilDay) loc.disasterUntilDay = null;

    // Stability drifts toward the jurisdiction's governance quality.
    const def = getWorldRegistry().location(loc.locationId);
    const governance = def ? COUNTRIES.find((c) => c.id === def.countryId)?.governance ?? 0.5 : 0.5;
    loc.stability = round(clamp(loc.stability + (governance * 0.85 - loc.stability) * 0.01 + rng.gaussian(0, 0.006), 0.02, 1), 4);

    // Local price level drifts with inflation and stability.
    const drift = (world.inflationIndex - 1) * 0.02 + (0.6 - loc.stability) * 0.004;
    loc.priceLevel = round(clamp(loc.priceLevel * (1 + drift * 0.06) + rng.gaussian(0, 0.0016), 0.5, 2.4), 4);

    // Player heat decays; patrol intensity follows enforcement + heat.
    if (loc.playerHeat > 0) loc.playerHeat = round(Math.max(0, loc.playerHeat - B.reputation.heatDecayPerDay * (0.6 + governance)), 2);
    const enforcement = def?.laws.enforcement ?? 0.5;
    const gov = world.governments[def?.countryId ?? ''];
    const crackdown = gov?.crackdownIntensity ?? 0.4;
    /*
     * Who runs the place decides how hard it is policed. Taking territory used to
     * adjust `patrolIntensity` for exactly one day — this recomputation overwrote it
     * the next morning — so a city seized by a criminal syndicate was patrolled just
     * like one run by a bank. The owner's kind is now part of the daily figure.
     */
    const owner = loc.controllingFactionId ? world.factions[loc.controllingFactionId] : undefined;
    const ownerKind = owner ? FACTION_BY_ID[owner.factionId]?.kind : undefined;
    const ownerFactor = ownerKind === 'government' ? 1.15 : ownerKind === 'criminal_syndicate' ? 0.75 : ownerKind === 'bank' ? 1.05 : 1;
    loc.patrolIntensity = round(clamp(enforcement * (0.5 + crackdown * 0.6) * ownerFactor + loc.playerHeat * 0.004, 0.01, 1.6), 3);

    // Demand shifts decay back to neutral.
    for (const [cat, mul] of orderedEntries(loc.demandShift)) {
      const next = 1 + (mul - 1) * 0.94;
      if (Math.abs(next - 1) < 0.01) delete loc.demandShift[cat as keyof typeof loc.demandShift];
      else (loc.demandShift as Record<string, number>)[cat] = round(next, 4);
    }
  }

  /* ------------------------------ routes ---------------------------- */
  const worldReg = getWorldRegistry();
  /*
   * Canonical order, computed once per day rather than inside the loops below.
   * `factionWarRiskOnRoute` runs for every route and every market day; sorting the
   * faction table each time it was called cost more than the rest of the world step
   * put together, which is why the ordering lives out here.
   */
  const factions = Object.values(world.factions);
  for (const rs of Object.values(world.routes)) {
    if (rs.disrupted && rs.disruptedUntilDay !== null && day >= rs.disruptedUntilDay) {
      rs.disrupted = false;
      rs.disruptedUntilDay = null;
      rs.disruptionReason = null;
      rs.costMultiplier = 1;
      diagnostics.push({ day, turn: 0, system: 'world', level: 'info', message: `Route ${rs.routeId} reopened` });
    }
    const def = worldReg.route(rs.routeId);
    if (!def) continue;
    const fromState = world.locations[def.from];
    const toState = world.locations[def.to];
    const borderBlocked = (fromState?.borderClosed || toState?.borderClosed) ?? false;
    const baseRisk = def.baseRisk * (1 + (fromState ? (1 - fromState.stability) * 0.5 : 0) + (toState ? (1 - toState.stability) * 0.5 : 0));
    const factionWarRisk = factionWarRiskOnRoute(world, factions, def.from, def.to);
    rs.risk = round(clamp(baseRisk + factionWarRisk + (borderBlocked ? 0.25 : 0) + (rs.disrupted ? 0.12 : 0), 0.005, 0.99), 4);
    if (!rs.disrupted && rng.chance(B.travel.routeDisruptionChancePerDay)) {
      const duration = rng.int(...B.travel.routeDisruptionDurationDays);
      rs.disrupted = true;
      rs.disruptedUntilDay = day + duration;
      rs.disruptionReason = pickDisruptionReason(rng, def.borderCrossing);
      rs.costMultiplier = B.travel.routeDisruptionCostMultiplier;
      diagnostics.push({ day, turn: 0, system: 'world', level: 'info', message: `Route ${rs.routeId} disrupted: ${rs.disruptionReason}` });
    }
  }

  /* --------------------------- competitors -------------------------- */
  stepCompetitors(world, rng, day, diagnostics);

  /* --------------------------- governments -------------------------- */
  for (const gov of Object.values(world.governments)) {
    const country = COUNTRIES.find((c) => c.id === gov.countryId);
    const target = (country?.governance ?? 0.5) * 0.9;
    gov.stability = round(clamp(gov.stability + (target - gov.stability) * 0.006 + rng.gaussian(0, B.world.governmentStabilityDriftPerDay), 0.02, 1), 4);
    gov.crackdownIntensity = round(clamp(
      gov.crackdownIntensity + ((1 - (country?.tolerance ?? 0.5)) * 0.7 - gov.crackdownIntensity) * 0.008 + rng.gaussian(0, 0.004),
      0.02, 1,
    ), 4);
    gov.currencyIndex = round(clamp(
      gov.currencyIndex * (1 + (world.inflationRate - 0.04) * -0.004 + rng.gaussian(0, 0.0022)),
      0.15, 2.5,
    ), 4);
    if (gov.electionInDays !== null) {
      gov.electionInDays -= 1;
      if (gov.electionInDays <= 0) {
        gov.electionInDays = rng.int(300, 1200);
        gov.policy = rng.pick(['open', 'protectionist', 'austerity', 'stimulus'] as const);
        gov.taxRate = round(clamp(gov.taxRate + rng.float(-0.02, 0.025), 0.01, 0.22), 4);
        diagnostics.push({ day, turn: 0, system: 'world', level: 'info', message: `Election in ${gov.countryId}: policy now ${gov.policy}` });
      }
    }
  }

  /* ------------------------------ shocks ---------------------------- */
  const before = world.shocks.length;
  world.shocks = world.shocks.filter((s) => s.expiresDay === null || s.expiresDay > day);
  if (world.shocks.length !== before) {
    diagnostics.push({ day, turn: 0, system: 'economy', level: 'debug', message: `${before - world.shocks.length} shock(s) expired` });
  }
  if (rng.chance(B.economy.shockChancePerDay)) {
    const shock = createRandomShock(world, rng, day);
    world.shocks.push(shock);
    newShocks.push(shock);
    diagnostics.push({ day, turn: 0, system: 'economy', level: 'info', message: `Market shock: ${shock.name} (${shock.severity})` });
  }
  for (const s of world.shocks) {
    // Shock magnitude decays toward neutral each day.
    const decay = B.economy.shockDecayPerDay;
    decayShock(s, decay);
  }

  /* --------------------------- indicators --------------------------- */
  world.indicators = computeIndicators(world);
  return { diagnostics, newShocks };
}

function decayShock(s: ActiveShock, decay: number): void {
  const shrink = (v: number) => round(1 + (v - 1) * (1 - decay), 4);
  const decayMap = (map: Partial<Record<CommodityCategory, number>>): void => {
    for (const [key, value] of orderedEntries(map) as [CommodityCategory, number | undefined][]) {
      if (value === undefined) continue;
      map[key] = shrink(value);
    }
  };
  decayMap(s.priceModifiers);
  decayMap(s.demandModifiers);
  decayMap(s.supplyModifiers);
}

function pickDisruptionReason(rng: Rng, border: boolean): string {
  const reasons = border
    ? ['Checkpoint closure', 'Customs system outage', 'Diplomatic incident', 'Bridge inspection', 'Strike at the border post']
    : ['Road collapse', 'Signal failure', 'Localised flooding', 'Police operation', 'Industrial accident', 'Fuel shortage'];
  return rng.pick(reasons);
}

function factionWarRiskOnRoute(world: WorldState, factions: FactionState[], from: ID, to: ID): number {
  const a = world.locations[from];
  const b = world.locations[to];
  if (!a || !b) return 0;
  let risk = 0;
  for (const f of factions) {
    if (f.atWarWith.length === 0) continue;
    const controlsA = f.controlledLocationIds.includes(from);
    const controlsB = f.controlledLocationIds.includes(to);
    if (controlsA || controlsB) {
      for (const enemyId of f.atWarWith) {
        const enemy = world.factions[enemyId];
        if (!enemy) continue;
        if (enemy.controlledLocationIds.includes(from) || enemy.controlledLocationIds.includes(to)) risk += 0.18;
      }
    }
  }
  return Math.min(0.5, risk);
}

/**
 * Competitors trade every day. Their activity is applied as supply/demand
 * pressure on the markets they operate in, which is what makes prices move even
 * when the player does nothing (spec §5: "NPC activity must also influence
 * markets").
 */
function stepCompetitors(world: WorldState, rng: Rng, day: number, diagnostics: DiagnosticEntry[]): void {
  const registry = getCommodityRegistry();
  for (const comp of Object.values(world.competitors)) {
    comp.capital = Math.max(0, comp.capital * (1 + B.world.competitorGrowthPerDay * (comp.aggression - 0.4) + rng.gaussian(0, 0.004)));
    if (!rng.chance(B.world.competitorTradeChancePerDay)) continue;
    comp.lastActionDay = day;

    // Occasionally expand or contract their footprint.
    if (rng.chance(0.03)) {
      const worldReg = getWorldRegistry();
      const current = worldReg.location(rng.pick(comp.operatingLocationIds));
      if (current) {
        const neighbours = worldReg.neighboursOf(current.id).filter((n) => !n.other.hidden);
        if (neighbours.length > 0 && comp.operatingLocationIds.length < 8) {
          const next = rng.pick(neighbours).other.id;
          if (!comp.operatingLocationIds.includes(next)) comp.operatingLocationIds.push(next);
        }
      }
    }
    if (rng.chance(0.02) && comp.operatingLocationIds.length > 1) {
      comp.operatingLocationIds.splice(rng.int(0, comp.operatingLocationIds.length - 1), 1);
    }
    // Focus drifts toward whatever is most profitable-looking.
    if (rng.chance(0.04)) {
      const cat = rng.pick(registry.categories());
      if (!comp.focus.includes(cat)) comp.focus.push(cat);
      if (comp.focus.length > 5) comp.focus.shift();
    }
    if (comp.capital < 20000 && rng.chance(0.1)) {
      diagnostics.push({ day, turn: 0, system: 'world', level: 'info', message: `Competitor ${comp.name} is running out of capital` });
      comp.hostileToPlayer = true;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Shocks                                                              */
/* ------------------------------------------------------------------ */

interface ShockTemplate {
  name: string;
  scope: EventScope;
  severity: Severity;
  categories: import('./types').CommodityCategory[];
  priceMul: number;
  demandMul: number;
  supplyMul: number;
  duration: [number, number];
  regional: boolean;
}

const SHOCK_TEMPLATES: ShockTemplate[] = [
  { name: 'Regional shortage', scope: 'regional', severity: 'moderate', categories: ['foodstuff', 'agriculture'], priceMul: 1.22, demandMul: 1.1, supplyMul: 0.72, duration: [12, 34], regional: true },
  { name: 'Industrial oversupply', scope: 'global', severity: 'minor', categories: ['metal', 'raw_material'], priceMul: 0.86, demandMul: 0.95, supplyMul: 1.4, duration: [18, 48], regional: false },
  { name: 'Energy price spike', scope: 'global', severity: 'major', categories: ['energy', 'chemical'], priceMul: 1.34, demandMul: 1.02, supplyMul: 0.8, duration: [10, 30], regional: false },
  { name: 'Technology glut', scope: 'global', severity: 'moderate', categories: ['electronics', 'technology'], priceMul: 0.82, demandMul: 1.15, supplyMul: 1.5, duration: [20, 55], regional: false },
  { name: 'Luxury demand surge', scope: 'global', severity: 'minor', categories: ['luxury', 'art'], priceMul: 1.18, demandMul: 1.4, supplyMul: 0.95, duration: [14, 40], regional: false },
  { name: 'Enforcement sweep', scope: 'national', severity: 'moderate', categories: ['narcotic', 'contraband_misc', 'weapon'], priceMul: 1.4, demandMul: 0.95, supplyMul: 0.6, duration: [10, 30], regional: true },
  { name: 'Pharmaceutical panic', scope: 'global', severity: 'major', categories: ['pharmaceutical', 'medical'], priceMul: 1.5, demandMul: 1.9, supplyMul: 0.7, duration: [8, 26], regional: false },
  { name: 'Construction boom', scope: 'regional', severity: 'moderate', categories: ['construction', 'metal', 'industrial'], priceMul: 1.2, demandMul: 1.45, supplyMul: 0.95, duration: [25, 70], regional: true },
  { name: 'Textile collapse', scope: 'global', severity: 'minor', categories: ['textile'], priceMul: 0.8, demandMul: 0.85, supplyMul: 1.35, duration: [22, 60], regional: false },
  { name: 'Livestock disease', scope: 'regional', severity: 'major', categories: ['livestock', 'foodstuff'], priceMul: 1.3, demandMul: 0.8, supplyMul: 0.5, duration: [15, 45], regional: true },
  { name: 'Financial flight to safety', scope: 'global', severity: 'moderate', categories: ['metal', 'financial_asset'], priceMul: 1.24, demandMul: 1.5, supplyMul: 0.9, duration: [12, 40], regional: false },
  { name: 'Fuel rationing', scope: 'national', severity: 'major', categories: ['energy'], priceMul: 1.45, demandMul: 0.8, supplyMul: 0.55, duration: [8, 24], regional: true },
];

export function createRandomShock(world: WorldState, rng: Rng, day: number): ActiveShock {
  const tpl = rng.weighted(
    SHOCK_TEMPLATES.map((t) => ({
      value: t,
      weight: B.events.severityWeights[t.severity] ?? 0.3,
    })),
  );
  const worldReg = getWorldRegistry();
  const locationIds: ID[] = [];
  const regionIds: ID[] = [];
  if (tpl.regional) {
    const region = rng.pick(REGIONS);
    regionIds.push(region.id);
    for (const l of worldReg.locationsInRegion(region.id)) locationIds.push(l.id);
  }
  const duration = rng.int(...tpl.duration);
  const severityScale = tpl.severity === 'catastrophic' ? 1.4 : tpl.severity === 'major' ? 1.15 : tpl.severity === 'moderate' ? 1 : 0.8;
  const spread = (v: number) => round(1 + (v - 1) * severityScale * rng.float(0.8, 1.2), 4);

  const priceModifiers: ActiveShock['priceModifiers'] = {};
  const demandModifiers: ActiveShock['demandModifiers'] = {};
  const supplyModifiers: ActiveShock['supplyModifiers'] = {};
  for (const cat of tpl.categories) {
    priceModifiers[cat] = spread(tpl.priceMul);
    demandModifiers[cat] = spread(tpl.demandMul);
    supplyModifiers[cat] = spread(tpl.supplyMul);
  }

  return {
    id: `shock_${day}_${rng.int(1000, 9999)}`,
    name: tpl.name,
    scope: tpl.scope,
    severity: tpl.severity,
    startedDay: day,
    expiresDay: day + duration,
    demandModifiers,
    supplyModifiers,
    priceModifiers,
    locationIds,
    regionIds,
  };
}

/** Programmatic shock creation used by the event effect applier. */
export function addShock(
  world: WorldState,
  shock: Omit<ActiveShock, 'id'> & { id?: string },
  rng: Rng,
): ActiveShock {
  const created: ActiveShock = {
    ...shock,
    id: shock.id ?? `shock_${world.day}_${rng.int(10000, 99999)}`,
  };
  world.shocks.push(created);
  return created;
}

/* ------------------------------------------------------------------ */
/* Indicators                                                          */
/* ------------------------------------------------------------------ */

export function computeIndicators(world: WorldState): EconomicIndicators {
  const idxChange = (history: number[], current: number, days: number) => {
    if (history.length <= days) return history.length > 1 ? current / history[0]! - 1 : 0;
    return current / history[history.length - 1 - days]! - 1;
  };
  return {
    inflationYoY: round(world.inflationRate, 4),
    interestRate: round(world.interestRate, 4),
    unemployment: round(world.unemployment, 4),
    consumerConfidence: round(world.consumerConfidence, 4),
    gdpGrowth: round((world.cycleFactor - 1) * 0.35, 4),
    stockIndexChange30d: round(idxChange(world.stockIndexHistory, world.stockIndex, 30), 4),
    cryptoIndexChange30d: round(idxChange(world.cryptoIndexHistory, world.cryptoIndex, 30), 4),
    cyclePhaseLabel: cyclePhaseLabel(world.cyclePhase),
    averageCommodityPriceIndex: 1,
    tradeVolume30d: 0,
    globalRiskAppetite: round(world.globalSentiment, 4),
  };
}

/** Push a news item, keeping the feed bounded by the configured retention. */
export function pushNews(
  world: WorldState,
  item: Omit<import('./types').NewsItem, 'id' | 'day' | 'read'> & { id?: string; day?: number },
): import('./types').NewsItem {
  const news: import('./types').NewsItem = {
    id: item.id ?? `news_${world.day}_${world.news.length}_${Math.abs(hashString(item.headline))}`,
    day: item.day ?? world.day,
    read: false,
    scope: item.scope,
    category: item.category,
    headline: item.headline,
    body: item.body,
    locationIds: item.locationIds ?? [],
    tags: item.tags ?? [],
    importance: item.importance ?? 2,
    eventId: item.eventId,
    metrics: item.metrics,
  };
  world.news.unshift(news);
  const cutoff = world.day - B.events.newsRetentionDays;
  if (world.news.length > 400) world.news.length = 400;
  const filtered = world.news.filter((n) => n.day >= cutoff || n.importance >= 4);
  world.news.length = 0;
  world.news.push(...filtered.slice(0, 400));
  return news;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Convenience: total tradeable market count for diagnostics. */
export function worldMarketCapacity(): number {
  const worldReg = getWorldRegistry();
  const registry = getCommodityRegistry();
  let total = 0;
  for (const l of worldReg.locations) total += Math.min(l.tradedCommodityIds.length, registry.count);
  return total;
}
