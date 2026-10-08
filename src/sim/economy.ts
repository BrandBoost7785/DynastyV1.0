/**
 * Economic engine — price formation, supply/demand dynamics and indicators.
 *
 * Design goals (spec §5, §6):
 *  - **Every market has its own state.** Prices are per (location, commodity),
 *    not a single global number.
 *  - **Randomness + predictability.** A deterministic fundamental (regional
 *    preference, cost of living, wealth, legality premium, seasonality, long-run
 *    trend, inflation, cycle, shocks) is perturbed by seeded noise and driven by
 *    a real supply/demand feedback loop with mean reversion and momentum.
 *    Players can learn seasonal patterns and read indicators; they cannot
 *    predict noise.
 *  - **Lazy materialisation.** Unvisited markets do not need to be stored: their
 *    price is a pure function of `(location, commodity, day, world)`. Only
 *    markets that actors have actually perturbed carry stored state, which keeps
 *    a 700-commodity × 48-location world tractable (spec §32).
 *  - **Player trades move markets** through depth-limited impact, which is what
 *    prevents guaranteed infinite arbitrage (spec §36).
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { getWorldRegistry } from '../engine/registry/world';
import { REGION_BY_ID } from '../engine/registry/regions';
import { FACTION_BY_ID } from '../engine/registry/actors';
import type {
  ActiveShock,
  CommodityCategory,
  CommodityDef,
  CompetitorState,
  ID,
  LocationDef,
  LocationState,
  MarketState,
  PriceDriver,
  WorldState,
} from './types';
import { orderedEntries, orderedValues } from './ordering';

const B = getBalance();

export function marketKey(locationId: ID, commodityId: ID): string {
  return `${locationId}::${commodityId}`;
}

export function parseMarketKey(key: string): { locationId: ID; commodityId: ID } | null {
  const i = key.indexOf('::');
  if (i <= 0) return null;
  return { locationId: key.slice(0, i), commodityId: key.slice(i + 2) };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Deterministic per-(commodity, day) noise source used for reproducibility. */
function noiseRng(locationId: ID, commodityId: ID, day: number): Rng {
  return new Rng(`mkt:${locationId}:${commodityId}:${day}`, 'market-noise');
}

/* ------------------------------------------------------------------ */
/* Baseline quantities                                                 */
/* ------------------------------------------------------------------ */

/**
 * How much the political situation at a location moves its markets.
 *
 * Factions already took territory, declared wars, disrupted routes and gated
 * standing-locked goods, but none of that reached a price: a city under the thumb
 * of a syndicate traded identically to one run by a bank, and a city whose
 * neighbours were at war imported as freely as anywhere else. These are the
 * channels that were missing.
 *
 * Everything here is a function of world state — no randomness, no player input —
 * and every multiplier comes back with a driver so a player can see *why* the
 * shelf got dearer.
 */
export interface FactionMarketPressure {
  /** Multiplier on daily replenishment. War chokes supply; syndicates smuggle more in. */
  supplyMultiplier: number;
  /** Multiplier on the fundamental price. */
  priceMultiplier: number;
  /** Multiplier on demand. Conflict drives hoarding; syndicates drive vice demand. */
  demandMultiplier: number;
  drivers: PriceDriver[];
}

export function factionMarketPressure(world: WorldState, locationId: ID): FactionMarketPressure {
  let supplyMultiplier = 1;
  let priceMultiplier = 1;
  let demandMultiplier = 1;
  const drivers: PriceDriver[] = [];

  for (const faction of Object.values(world.factions)) {
    const def = FACTION_BY_ID[faction.factionId];
    if (!def) continue;
    const controlsHere = faction.controlledLocationIds.includes(locationId);

    // Occupation shapes a market: vice thrives under a syndicate, commerce under a
    // bank, and the state's own turf is the most tightly run of all.
    if (controlsHere) {
      if (def.kind === 'criminal_syndicate') {
        demandMultiplier *= 1.05;
        supplyMultiplier *= 1.04;
        drivers.push({ label: `${def.name} controls this market`, contribution: 0.05, kind: 'sentiment' });
      } else if (def.kind === 'bank' || def.kind === 'corporation') {
        priceMultiplier *= 1.03;
        supplyMultiplier *= 1.02;
        drivers.push({ label: `${def.name} operates here`, contribution: 0.03, kind: 'regional' });
      }
    }

    // A war the location is part of, or sits between, raises prices and thins shelves.
    for (const enemyId of faction.atWarWith) {
      if (faction.factionId > enemyId) continue; // count each war once
      const enemy = world.factions[enemyId];
      if (!enemy) continue;
      const here = controlsHere || enemy.controlledLocationIds.includes(locationId);
      if (!here) continue;
      const severity = 0.9 - 0.12 * Math.min(3, faction.atWarWith.length + enemy.atWarWith.length) * 0.5;
      supplyMultiplier *= severity;
      priceMultiplier *= 2 - severity;
      demandMultiplier *= 1.04;
      drivers.push({
        label: `War: ${def.name} vs ${FACTION_BY_ID[enemyId]?.name ?? enemyId}`,
        contribution: (2 - severity) - 1,
        kind: 'event',
      });
    }
  }

  return {
    supplyMultiplier: clamp(supplyMultiplier, 0.5, 1.4),
    priceMultiplier: clamp(priceMultiplier, 0.85, 1.6),
    demandMultiplier: clamp(demandMultiplier, 0.85, 1.4),
    drivers: drivers.slice(0, 3),
  };
}

/**
 * Baseline daily supply (units) of a commodity at a location, before dynamic
 * perturbation. Specialties produce far more; remote and poor locations less.
 */
export function baseSupplyUnits(location: LocationDef, c: CommodityDef): number {
  const specialty = location.specialties.includes(c.id) ? 3.2 : 1;
  const regionalSupply = c.regionalPreference[location.regionId] ?? 1;
  const popScale = Math.pow(Math.max(1000, location.population) / 1_000_000, 0.42);
  const infraScale = 0.55 + location.infrastructure * 0.75;
  const availability = c.availability;
  const scarcity = 1 + (5 - c.rarity) * 0.18;
  return Math.max(0.5, c.baseDemand * availability * regionalSupply * popScale * infraScale * specialty * scarcity * 1.6);
}

/**
 * Baseline daily demand (units). Wealthy regions demand luxuries; poor regions
 * demand staples; category demand profiles and regional preference scale both.
 */
export function baseDemandUnits(location: LocationDef, c: CommodityDef, world: WorldState, locState?: LocationState): number {
  const region = REGION_BY_ID[location.regionId];
  const regionalPref = c.regionalPreference[location.regionId] ?? 1;
  const profile = location.demandProfile[c.category] ?? 1;
  const wealthFactor = c.category === 'luxury' || c.category === 'art'
    ? 0.35 + location.economy.wealthIndex * 1.7
    : 1.35 - location.economy.wealthIndex * 0.45;
  const popScale = Math.pow(Math.max(1000, location.population) / 1_000_000, 0.55);
  const cycle = world.cycleFactor;
  const confidence = 0.8 + world.consumerConfidence * 0.4;
  const shift = locState?.demandShift?.[c.category] ?? 1;
  const archetype = region ? region.archetype : 'industrial';
  const archetypeFit = archetype === 'remote' ? 0.35 : archetype === 'offshore' ? 0.6 : 1;
  return Math.max(0.25, c.baseDemand * regionalPref * profile * wealthFactor * popScale * cycle * confidence * shift * archetypeFit);
}

/**
 * Seasonal factor. Agricultural and livestock goods follow a harvest cycle;
 * energy follows a heating/cooling cycle. Phase is seeded per commodity so the
 * pattern is stable and discoverable across saves.
 */
export function seasonalFactor(c: CommodityDef, location: LocationDef, day: number): number {
  const rng = new Rng(`season:${c.id}`, 'season');
  const phase = rng.float(0, Math.PI * 2);
  const hemisphere = location.map.y > 50 ? -1 : 1;

  let amplitude = 0;
  const cat: CommodityCategory = c.category;
  if (cat === 'agriculture' || cat === 'livestock' || cat === 'foodstuff') amplitude = 0.16;
  else if (cat === 'energy') amplitude = 0.13;
  else if (cat === 'textile' || cat === 'beverage') amplitude = 0.07;
  else if (cat === 'luxury' || cat === 'art') amplitude = 0.09;
  if (amplitude === 0) return 1;

  // Supply-side seasonality: harvests *increase* supply, which *lowers* price.
  const wave = Math.cos(((day / 365) * Math.PI * 2 + phase) * hemisphere);
  return 1 - amplitude * wave;
}

/** Long-run structural trend: technology deflates, scarce resources inflate. */
export function structuralTrend(c: CommodityDef, day: number): number {
  const rng = new Rng(`trend:${c.id}`, 'trend');
  let drift = rng.float(-0.00025, 0.00032);
  if (c.category === 'technology' || c.category === 'electronics') drift -= 0.0005;
  if (c.category === 'raw_material' || c.category === 'metal' || c.category === 'energy') drift += 0.00022;
  if (c.rarity >= 4) drift += 0.00028;
  return 1 + drift * day;
}

/** Multiplier applied to price because a good is illegal here and untolerated. */
export function legalityPremium(location: LocationDef, c: CommodityDef): number {
  const effective = location.laws.legalityOverrides[c.category] ?? c.legality;
  if (effective === 'legal') return 1;
  const tolerated = location.laws.tolerated.includes(effective);
  const enforcement = location.laws.enforcement;
  const base = B.market.illegalRiskPremium;
  switch (effective) {
    case 'restricted':
      return tolerated ? 1 + base * 0.18 * enforcement : 1 + base * 0.6;
    case 'illegal':
      return tolerated ? 1 + base * (0.55 + enforcement * 0.5) : 1 + base * 1.9;
    case 'contraband':
      return tolerated ? 1 + base * (1.1 + enforcement * 0.8) : 1 + base * 3.1;
    default:
      return 1;
  }
}

/** Product of all shock modifiers applying to a commodity at a location. */
export function shockMultiplier(
  world: WorldState,
  location: LocationDef,
  c: CommodityDef,
  day: number,
): { factor: number; drivers: PriceDriver[] } {
  let factor = 1;
  const drivers: PriceDriver[] = [];
  for (const s of world.shocks) {
    if (!shockApplies(s, location, day)) continue;
    const pm = s.priceModifiers[c.category];
    const dm = s.demandModifiers[c.category];
    const sm = s.supplyModifiers[c.category];
    let m = 1;
    if (pm !== undefined) m *= pm;
    if (dm !== undefined) m *= 1 + (dm - 1) * 0.6;
    if (sm !== undefined) m *= 1 + (1 - sm) * 0.8;
    if (m !== 1) {
      factor *= m;
      drivers.push({ label: s.name, contribution: m - 1, kind: 'shock', eventId: s.sourceEventId });
    }
  }
  return { factor, drivers };
}

export function shockApplies(s: ActiveShock, location: LocationDef, day: number): boolean {
  if (s.expiresDay !== null && s.expiresDay <= day) return false;
  if (day < s.startedDay) return false;
  if (s.locationIds.length > 0 || s.regionIds.length > 0) {
    return s.locationIds.includes(location.id) || s.regionIds.includes(location.regionId);
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Fundamental price                                                   */
/* ------------------------------------------------------------------ */

export interface FundamentalContext {
  location: LocationDef;
  locationState?: LocationState;
  commodity: CommodityDef;
  world: WorldState;
  day: number;
  /** Pre-computed political pressure for this location, when the caller has it. */
  political?: FactionMarketPressure;
}

export interface FundamentalBreakdown {
  price: number;
  components: { label: string; value: number; kind: PriceDriver['kind'] }[];
}

/**
 * The deterministic "fair value" of a commodity at a location on a day,
 * ignoring transient supply/demand imbalance and actor impact.
 *
 * Returns a breakdown so the UI can explain *why* a price is what it is
 * (spec §40).
 */
export function computeFundamental(ctx: FundamentalContext, opts: { withComponents?: boolean } = {}): FundamentalBreakdown {
  const { location, commodity: c, world, day, locationState } = ctx;
  const withComponents = opts.withComponents !== false;
  const components: FundamentalBreakdown['components'] = [];

  let price = c.baseValue;
  if (withComponents) components.push({ label: 'Base value', value: c.baseValue, kind: 'regional' });

  const regional = c.regionalPreference[location.regionId] ?? 1;
  price *= regional;
  if (withComponents) components.push({ label: `${location.regionName} preference`, value: regional, kind: 'regional' });

  const costOfLiving = Math.pow(location.costOfLivingIndex, 0.55);
  price *= costOfLiving;
  if (withComponents) components.push({ label: 'Local cost level', value: costOfLiving, kind: 'regional' });

  const wealth = 0.85 + location.economy.wealthIndex * 0.35;
  price *= wealth;
  if (withComponents) components.push({ label: 'Local wealth', value: wealth, kind: 'demand' });

  const demandProfile = location.demandProfile[c.category] ?? 1;
  price *= Math.pow(demandProfile, 0.45);
  if (withComponents) components.push({ label: 'Category demand', value: Math.pow(demandProfile, 0.45), kind: 'demand' });

  const specialty = location.specialties.includes(c.id) ? 0.74 : 1;
  if (specialty !== 1) {
    price *= specialty;
    if (withComponents) components.push({ label: 'Local specialisation (cheap supply)', value: specialty, kind: 'supply' });
  }

  const legality = legalityPremium(location, c);
  if (legality !== 1) {
    price *= legality;
    if (withComponents) components.push({ label: 'Illegality premium', value: legality, kind: 'regional' });
  }

  const inflation = world.inflationIndex;
  price *= inflation;
  if (withComponents) components.push({ label: 'Inflation', value: inflation, kind: 'inflation' });

  const cycle = world.cycleFactor;
  price *= cycle;
  if (withComponents) components.push({ label: 'Economic cycle', value: cycle, kind: 'cycle' });

  const seasonal = seasonalFactor(c, location, day);
  price *= seasonal;
  if (withComponents) components.push({ label: 'Seasonality', value: seasonal, kind: 'cycle' });

  const trend = structuralTrend(c, day);
  price *= trend;
  if (withComponents) components.push({ label: 'Long-run trend', value: trend, kind: 'cycle' });

  const shock = shockMultiplier(world, location, c, day);
  if (shock.factor !== 1) {
    price *= shock.factor;
    if (withComponents) components.push({ label: 'Active shocks', value: shock.factor, kind: 'shock' });
  }

  const priceLevel = locationState?.priceLevel ?? 1;
  if (priceLevel !== 1) {
    price *= priceLevel;
    if (withComponents) components.push({ label: 'Local price level', value: priceLevel, kind: 'regional' });
  }

  const government = world.governments[location.countryId];
  if (government) {
    const taxEffect = 1 + government.taxRate * 0.35;
    price *= taxEffect;
    if (withComponents) components.push({ label: 'National tax regime', value: taxEffect, kind: 'regional' });
  }

  const political = ctx.political ?? factionMarketPressure(world, location.id);
  if (political.priceMultiplier !== 1) {
    price *= political.priceMultiplier;
    if (withComponents) components.push({ label: 'Faction control and conflict', value: political.priceMultiplier, kind: 'event' });
  }

  return { price: Math.max(0.01, price), components };
}

/**
 * Convenience: fundamental price only.
 *
 * Skips the component list. `stepMarket` needs the *number* for every market every
 * day and never the explanation, and building a dozen throwaway objects per market
 * per day was measurable GC pressure in a 900-market world. The multiplication
 * order is untouched, so the value is bit-for-bit the same.
 */
export function fundamentalPrice(ctx: FundamentalContext): number {
  return computeFundamental(ctx, { withComponents: false }).price;
}

/* ------------------------------------------------------------------ */
/* Market materialisation and daily stepping                           */
/* ------------------------------------------------------------------ */

export interface MarketContext {
  world: WorldState;
  locations: Map<ID, LocationDef>;
  locationStates: Map<ID, LocationState>;
  /**
   * Competitors in canonical order. `competitorPressure` multiplies their
   * aggression together, and floating-point multiplication is not associative, so
   * the order is part of the result — but it only has to be computed once per tick,
   * not once per market.
   */
  competitors?: CompetitorState[];
  /**
   * Political pressure per location, computed once when the context is built.
   * It is a pure function of the world state, and every market at a location shares
   * the answer — recomputing it per market meant scanning all factions (and their
   * territory lists) for every line on every shelf, which measured as the single
   * most expensive thing the economy did.
   */
  political?: Map<ID, FactionMarketPressure>;
  /**
   * In-transit NPC cargo per market key, built once per step.
   *
   * Same reasoning as `political`: every consumer needs the same answer, and
   * scanning the flow list per market would make the economy O(markets × flows).
   */
  flows?: Map<string, { inbound: number; outbound: number }>;
}

/** Political pressure for every location on the map, computed in one pass. */
export function politicalPressureIndex(world: WorldState, locationIds: ID[]): Map<ID, FactionMarketPressure> {
  const index = new Map<ID, FactionMarketPressure>();
  for (const locationId of locationIds) index.set(locationId, factionMarketPressure(world, locationId));
  return index;
}

/** Create the stored state for a market that has just become relevant. */
/**
 * The price a market line *would* open at, without creating anything.
 *
 * This is the same arithmetic `createMarketState` uses for its opening price — same
 * fundamental, same seeded scarcity, same deterministic opening wobble — but it
 * touches no state: no book is written, no history is back-filled and no RNG stream
 * is consumed (`mkt-init` is a private hash-based stream). It exists because
 * discovery and creation are different questions: an actor (the player's arbitrage
 * scanner, or a rival firm ranking destinations) needs to ask "what is this line
 * worth?" about far more lines than it will ever trade, and asking used to mean
 * materialising a market per question.
 *
 * Returns null only when the location or commodity is unknown.
 */
export function prospectiveMarket(
  locationId: ID,
  commodityId: ID,
  ctx: MarketContext,
  day: number,
): { price: number; fundamental: number; supply: number; demand: number } | null {
  const world = getWorldRegistry();
  const registry = getCommodityRegistry();
  const location = ctx.locations.get(locationId) ?? world.location(locationId);
  const commodity = registry.get(commodityId);
  if (!location || !commodity) return null;
  const locationState = ctx.locationStates.get(locationId);
  const political = ctx.political?.get(locationId);
  const fundamental = fundamentalPrice({ location, locationState, commodity, world: ctx.world, day, political });
  const supply = baseSupplyUnits(location, commodity);
  const demand = baseDemandUnits(location, commodity, ctx.world, locationState);
  const rng = new Rng(`mkt-init:${locationId}:${commodityId}:${day}`, 'market-init');
  const seededScarcity = clamp(Math.pow(demand / Math.max(0.1, supply), B.economy.priceElasticity), ...B.economy.scarcityClamp);
  const openingWobble = rng.float(0.94, 1.06);
  const price = clamp(fundamental * seededScarcity * openingWobble, fundamental * B.market.priceFloorFraction, fundamental * B.market.priceCeilingMultiple);
  return { price, fundamental, supply, demand };
}

export function createMarketState(
  locationId: ID,
  commodityId: ID,
  ctx: MarketContext,
  day: number,
): MarketState | null {
  const world = getWorldRegistry();
  const registry = getCommodityRegistry();
  const location = ctx.locations.get(locationId) ?? world.location(locationId);
  const commodity = registry.get(commodityId);
  if (!location || !commodity) return null;

  const locationState = ctx.locationStates.get(locationId);
  const political = ctx.political?.get(locationId);
  // One source of truth for the opening price: `prospectiveMarket`.
  const opening = prospectiveMarket(locationId, commodityId, ctx, day);
  if (!opening) return null;
  const { fundamental, supply, demand, price } = opening;
  const rng = new Rng(`mkt-init:${locationId}:${commodityId}:${day}`, 'market-init');
  const seededScarcity = clamp(Math.pow(demand / Math.max(0.1, supply), B.economy.priceElasticity), ...B.economy.scarcityClamp);
  // The same opening draw is taken twice from the same private stream: once here for
  // the book's own sentiment, and once inside `prospectiveMarket` for the price. The
  // streams are independent, so ordering cannot change either value.
  const openingWobble = rng.float(0.94, 1.06);

  const history: number[] = [];
  // Back-fill a short synthetic history so charts and trend indicators are
  // meaningful the first time a player opens a market, derived deterministically
  // from the same noise function used for live simulation.
  const backDays = Math.min(30, B.market.historyLengthDays);
  for (let i = backDays; i >= 1; i--) {
    const d = day - i;
    const pastFundamental = fundamentalPrice({ location, locationState, commodity, world: ctx.world, day: d, political });
    const n = noiseRng(locationId, commodityId, d);
    const wobble = 1 + n.gaussian(0, commodity.volatility * 0.6);
    history.push(round2(clamp(pastFundamental * wobble, pastFundamental * B.market.priceFloorFraction, pastFundamental * B.market.priceCeilingMultiple)));
  }

  return {
    key: marketKey(locationId, commodityId),
    locationId,
    commodityId,
    price: round2(price),
    fundamental: round2(fundamental),
    supply: round2(supply),
    demand: round2(demand),
    sentiment: clamp(0.5 + rng.gaussian(0, 0.12), 0.02, 0.98),
    volatility: commodity.volatility,
    deviation: 1,
    playerImpact: 0,
    shocks: {},
    history,
    historyStartDay: day - backDays,
    lastTradedDay: -1,
    volume30d: 0,
    drivers: seedDrivers(fundamental, price, demand, supply, seededScarcity, openingWobble),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface StepMarketResult {
  market: MarketState;
  drivers: PriceDriver[];
}

/**
 * Explain a freshly seeded price in the same vocabulary `stepMarket` uses.
 *
 * A market's first view used to carry the price but no explanation, so the very
 * first screen a player opens showed a quotation several percent away from
 * fundamental with an empty "why" list. The opening price is formed from exactly
 * two contributions — the seeded scarcity of the location and the bid/ask
 * imbalance of the opening book — so those are what it reports.
 *
 * The list is never empty: if both contributions round away, the larger of the two
 * is kept, because "this price is the fundamental price" is itself an explanation
 * and a blank panel is not.
 */
function seedDrivers(
  fundamental: number,
  price: number,
  demand: number,
  supply: number,
  scarcity: number,
  wobble: number,
  cap = 6,
): PriceDriver[] {
  const candidates: PriceDriver[] = [
    {
      label: `Scarcity (${round2(demand)} demand / ${round2(supply)} supply)`,
      contribution: scarcity - 1,
      kind: 'supply',
    },
    { label: 'Opening book imbalance', contribution: wobble - 1, kind: 'noise' },
    { label: 'Against fundamental', contribution: fundamental > 0 ? price / fundamental - 1 : 0, kind: 'regional' },
  ];
  const kept = candidates.filter((d) => Math.abs(d.contribution) > 0.0015);
  const ranked = (kept.length > 0 ? kept : [candidates.reduce((a, b) => (Math.abs(b.contribution) > Math.abs(a.contribution) ? b : a))])
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, cap);
  return ranked;
}

/**
 * Advance one market by one day.
 *
 * The supply/demand loop is the important part:
 *   consumption = demand × drainRate × priceSensitivity(price)
 *   supply      += replenishment − consumption
 *   scarcity     = (demand / supply) ^ elasticity
 *   target       = fundamental × scarcity × deviation
 *   price       moves toward target with mean reversion + momentum + noise
 *
 * Because consumption falls as price rises, a spike self-corrects; because
 * replenishment is bounded, a genuine shortage persists for a while. That is the
 * "randomness + predictability" balance the design asks for.
 */
export function stepMarket(market: MarketState, ctx: MarketContext, day: number): StepMarketResult {
  const worldReg = getWorldRegistry();
  const registry = getCommodityRegistry();
  const location = ctx.locations.get(market.locationId) ?? worldReg.location(market.locationId);
  const commodity = registry.get(market.commodityId);
  if (!location || !commodity) return { market, drivers: [] };

  const locationState = ctx.locationStates.get(market.locationId);
  /*
   * Pass the tick's political index rather than letting `fundamentalPrice` fall
   * back to `factionMarketPressure`. Without it, every market re-scaned every
   * faction's territory on every day — an O(markets × factions) loop that profiled
   * as the single hottest thing the simulation did. The value is identical.
   */
  const fundamental = fundamentalPrice({
    location,
    locationState,
    commodity,
    world: ctx.world,
    day,
    political: ctx.political?.get(location.id),
  });
  const baseSupply = baseSupplyUnits(location, commodity);
  const baseDemand = baseDemandUnits(location, commodity, ctx.world, locationState);
  const drivers: PriceDriver[] = [];

  const rng = noiseRng(market.locationId, market.commodityId, day);

  /* ---- supply / demand dynamics ---- */
  const priceRatio = market.price > 0 ? market.price / Math.max(0.01, fundamental) : 1;
  // Demand falls as price rises relative to fundamental (elastic response).
  const priceSensitivity = Math.pow(clamp(priceRatio, 0.25, 4), -commodity.elasticity);
  const consumption = Math.min(market.supply, baseDemand * priceSensitivity * B.economy.npcDemandDrainPerDay * rng.float(0.7, 1.3));
  const replenish = (baseSupply - market.supply) * B.economy.supplyReplenishPerDay * rng.float(0.75, 1.25);
  /*
   * Producer response — the supply half of the loop.
   *
   * Elastic demand alone lets a spike decay from the demand side, but nothing ever
   * *answers* a shortage: no additional units appear, so a genuine dislocation lasts
   * until mean reversion grinds it away, and two locations can hold permanently
   * different prices with no force between them. Here producers and carriers supply
   * more when price sits above fundamental and withhold when it sits below, which is
   * what makes scarcity self-correcting and what gives arbitrage a natural expiry.
   * The response is proportional, symmetric and hard-capped per day.
   */
  const supplyResponse = clamp(
    (priceRatio - 1) * B.economy.supplyResponseElasticity * baseSupply,
    -baseSupply * B.economy.supplyResponseCapFraction,
    baseSupply * B.economy.supplyResponseCapFraction,
  );

  let supply = Math.max(baseSupply * 0.05, market.supply - consumption + replenish + supplyResponse);
  let demand = market.demand + (baseDemand - market.demand) * 0.18;

  // Competitor and faction activity perturbs local supply/demand.
  const political = ctx.political?.get(location.id) ?? factionMarketPressure(ctx.world, location.id);
  if (political.supplyMultiplier !== 1 || political.demandMultiplier !== 1) {
    supply *= political.supplyMultiplier;
    demand *= political.demandMultiplier;
    drivers.push(...political.drivers);
  }

  // NPC cargo already in the water toward or away from this market. This is
  // *announced future* supply rather than a same-day price term: the units land
  // through `tradeImpact` on arrival. Surfacing it here is what lets the market's
  // own explanation say "relief is coming" before the price turns.
  const flow = ctx.flows?.get(market.key) ?? { inbound: 0, outbound: 0 };
  if (flow.inbound > 0 || flow.outbound > 0) {
    const scale = Math.max(1, baseSupply);
    const contribution = (flow.outbound - flow.inbound) / scale;
    if (Math.abs(contribution) > 0.0015) {
      drivers.push({
        label: flow.inbound > 0
          ? `Cargo inbound (${flow.inbound.toLocaleString('en-US')} units)`
          : `Cargo outbound (${flow.outbound.toLocaleString('en-US')} units)`,
        contribution,
        kind: 'competitor',
      });
    }
  }

  const comp = competitorPressure(ctx.world, location, commodity, ctx.competitors);
  if (comp !== 1) {
    supply *= comp < 1 ? 1 : comp;
    demand *= comp > 1 ? comp : 1;
    drivers.push({
      label: comp > 1 ? 'Competitor buying' : 'Competitor selling',
      contribution: (comp - 1) * 0.5,
      kind: 'competitor',
    });
  }

  const scarcity = clamp(Math.pow(demand / Math.max(0.01, supply), B.economy.priceElasticity), ...B.economy.scarcityClamp);
  drivers.push({ label: `Scarcity (${round2(demand)} demand / ${round2(supply)} supply)`, contribution: scarcity - 1, kind: 'supply' });
  if (Math.abs(supplyResponse) > 0) {
    // The response's own price contribution: more supply arriving pushes price down.
    drivers.push({
      label: supplyResponse > 0 ? 'Producers answering the price' : 'Producers withholding supply',
      contribution: -supplyResponse / Math.max(1, baseSupply),
      kind: 'supply',
    });
  }

  /* ---- deviation / impact relaxation ---- */
  let deviation = market.deviation;
  if (deviation !== 1) {
    deviation = 1 + (deviation - 1) * (1 - B.market.impactRelaxationPerDay);
    if (Math.abs(deviation - 1) < 0.002) deviation = 1;
  }
  let playerImpact = market.playerImpact;
  if (playerImpact !== 0) {
    // Report the footprint the player actually left, before decay: a trade the
    // player made is never noise, however small, and the market should be able to
    // say "this moved because of you". The filter at the bottom of this function
    // keeps player entries for exactly that reason.
    const footprint = playerImpact;
    playerImpact *= 1 - B.market.impactRelaxationPerDay;
    if (Math.abs(playerImpact) < 0.001) playerImpact = 0;
    drivers.push({ label: 'Your recent trading', contribution: footprint, kind: 'player' });
  }

  /* ---- expiring shocks ---- */
  const shocks: Record<ID, number> = {};
  for (const [id, mul] of orderedEntries(market.shocks)) {
    const shock = ctx.world.shocks.find((s) => s.id === id);
    if (shock && shockApplies(shock, location, day)) shocks[id] = mul;
  }

  /* ---- price formation ---- */
  const target = fundamental * scarcity * deviation * (1 + playerImpact);
  const prevPrice = market.price > 0 ? market.price : target;
  const prevRet = market.history.length >= 2
    ? (market.history[market.history.length - 1]! - market.history[market.history.length - 2]!) / Math.max(0.01, market.history[market.history.length - 2]!)
    : 0;

  const illegality = commodity.legality === 'legal' ? 1 : commodity.legality === 'restricted' ? 1.6 : B.market.illegalNoiseMultiplier;
  const noiseScale = B.market.baseNoise * (0.4 + commodity.volatility * 2.2) * illegality * (0.7 + (1 - ctx.world.globalSentiment) * 0.6);
  const noise = rng.gaussian(0, noiseScale);
  drivers.push({ label: 'Market noise', contribution: noise, kind: 'noise' });

  const reversion = B.economy.meanReversion * (target / prevPrice - 1);
  const momentum = B.economy.momentum * prevRet;
  drivers.push({ label: 'Mean reversion to fundamental', contribution: reversion, kind: 'supply' });
  if (Math.abs(momentum) > 0.0005) drivers.push({ label: 'Price momentum', contribution: momentum, kind: 'sentiment' });

  const ret = reversion + momentum + noise;
  const floor = fundamental * B.market.priceFloorFraction;
  const ceiling = fundamental * B.market.priceCeilingMultiple;
  const newPrice = clamp(prevPrice * (1 + ret), floor, ceiling);

  /* ---- sentiment follows returns ---- */
  const sentiment = clamp(market.sentiment * 0.92 + (0.5 + clamp(ret * 12, -0.5, 0.5)) * 0.08, 0.01, 0.99);

  /* ---- history ring buffer ---- */
  const history = market.history.length >= B.market.historyLengthDays
    ? [...market.history.slice(1), round2(newPrice)]
    : [...market.history, round2(newPrice)];
  const historyStartDay = history.length >= B.market.historyLengthDays
    ? market.historyStartDay + (market.history.length - B.market.historyLengthDays + 1)
    : market.historyStartDay;

  const realisedVol = market.volatility * 0.9 + Math.abs(ret) * 0.1;

  market.supply = round2(supply);
  market.demand = round2(demand);
  market.fundamental = round2(fundamental);
  market.price = round2(newPrice);
  market.sentiment = round2(sentiment * 100) / 100;
  market.volatility = clamp(realisedVol, 0.005, 2.5);
  market.deviation = deviation;
  market.playerImpact = playerImpact;
  market.shocks = shocks;
  market.history = history;
  market.historyStartDay = historyStartDay;
  market.volume30d = Math.max(0, market.volume30d - market.volume30d * 0.033);
  /*
   * Rank the explanation, then make sure the player's own footprint survives the
   * cut. It is usually the smallest term in the list — a player trading 18 units
   * against a 28,000-unit book is a rounding error next to a war — but it is the one
   * entry the player can act on, so it is never the one dropped.
   */
  const ranked = drivers
    .filter((d) => d.kind === 'player' || Math.abs(d.contribution) > 0.0015)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const mine = ranked.filter((d) => d.kind === 'player');
  const rest = ranked.filter((d) => d.kind !== 'player').slice(0, Math.max(0, 6 - mine.length));
  market.drivers = [...mine, ...rest].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  return { market, drivers: market.drivers };
}

/**
 * Competitor/NPC pressure on a market: aggregates the activity of simulated
 * competitor firms operating at this location with interest in this category.
 */
export function competitorPressure(
  world: WorldState,
  location: LocationDef,
  c: CommodityDef,
  ordered?: CompetitorState[],
): number {
  let pressure = 1;
  for (const comp of ordered ?? Object.values(world.competitors)) {
    if (!comp.operatingLocationIds.includes(location.id)) continue;
    if (!comp.focus.includes(c.category)) continue;
    const aggression = comp.aggression * (0.6 + comp.capital / 10_000_000);
    // Positive aggression = accumulating (raises demand); negative = dumping.
    pressure *= 1 + clamp((comp.hostileToPlayer ? -0.02 : 0.02) * aggression, -0.12, 0.12);
  }
  return clamp(pressure, 0.7, 1.4);
}

/* ------------------------------------------------------------------ */
/* Trade impact                                                        */
/* ------------------------------------------------------------------ */

export interface TradeImpactResult {
  /** Signed fraction the price moves because of this trade. */
  impact: number;
  supplyDelta: number;
  demandDelta: number;
}

/**
 * Depth-limited price impact of a player trade.
 *
 * Impact is proportional to `qty / depth` where depth scales with the market's
 * standing supply, and is capped so a single trade can never move a market by
 * more than `maxImpactPerTrade`. Buying consumes supply (price up); selling
 * adds supply (price down). This is the mechanism that makes large-scale
 * arbitrage self-limiting instead of a free money tap.
 */
export function tradeImpact(market: MarketState, commodity: CommodityDef, qty: number, side: 'buy' | 'sell', mods?: { impactReduction?: number }): TradeImpactResult {
  const depth = Math.max(1, market.supply * B.market.depthPerSupplyUnit * 1000);
  const signedQty = side === 'buy' ? qty : -qty;
  let impact = (signedQty / depth) * B.market.playerImpactFactor;
  impact = clamp(impact, -B.market.maxImpactPerTrade, B.market.maxImpactPerTrade);
  if (mods?.impactReduction) impact *= 1 - clamp(mods.impactReduction, 0, 0.8);

  const supplyDelta = side === 'buy' ? -qty : qty;
  const demandDelta = side === 'buy' ? qty * 0.25 : -qty * 0.15;

  market.supply = Math.max(depth * 0.02, market.supply + supplyDelta);
  market.demand = Math.max(0.1, market.demand + demandDelta);
  market.playerImpact = clamp(market.playerImpact + impact, -B.market.maxImpactPerTrade * 2, B.market.maxImpactPerTrade * 2);
  market.deviation = clamp(market.deviation * (1 + impact * 0.5), 0.2, 5);
  market.price = round2(clamp(market.price * (1 + impact), market.fundamental * B.market.priceFloorFraction, market.fundamental * B.market.priceCeilingMultiple));
  market.lastTradedDay = market.lastTradedDay; // set by caller with current day
  market.volume30d += qty;

  return { impact, supplyDelta, demandDelta };
}

/** Buy (ask) and sell (bid) prices for a market, after spread. */
export function quotedPrices(market: MarketState, commodity: CommodityDef, spreadReduction = 0): { buy: number; sell: number; spread: number } {
  const base = commodity.legality === 'legal'
    ? B.market.legalSpread
    : commodity.marketTypes.includes('darknet')
      ? B.market.cryptoSpread + B.market.illegalSpread
      : B.market.illegalSpread;
  const spread = Math.max(0.004, base * (1 - clamp(spreadReduction, 0, 0.6)));
  // Two-decimal rounding can collapse the spread on very cheap goods (a litre of
  // bulk water trades below a cent of spread). Enforce one cent of tick so the
  // bid is always strictly below the ask and a round trip can never profit.
  const tick = 0.01;
  let buy = round2(market.price * (1 + spread / 2));
  const sell = round2(market.price * (1 - spread / 2));
  if (buy - sell < tick) {
    buy = round2(sell + tick);
  }
  return { buy, sell, spread: round2(spread * 1000) / 1000 };
}

/* ------------------------------------------------------------------ */
/* Analytics / indicators                                              */
/* ------------------------------------------------------------------ */

export interface MarketAnalytics {
  price: number;
  change1d: number;
  change7d: number;
  change30d: number;
  sma7: number;
  sma30: number;
  volatility30d: number;
  trend: 'rising' | 'falling' | 'flat';
  trendStrength: number;
  momentum: number;
  rsi: number;
  supplyDemandRatio: number;
  scarcityLabel: 'surplus' | 'balanced' | 'tight' | 'shortage';
  sentimentLabel: 'fearful' | 'cautious' | 'neutral' | 'optimistic' | 'euphoric';
  deviationFromFundamental: number;
  /** Naive forecast: mean-reversion plus momentum, ± volatility band. */
  forecast: { next1d: number; next7d: number; band: number };
}

export function analyseMarket(market: MarketState): MarketAnalytics {
  const h = market.history;
  const last = h.length > 0 ? h[h.length - 1]! : market.price;
  const at = (n: number) => (h.length > n ? h[h.length - 1 - n]! : h[0] ?? last);

  const change = (n: number) => (at(n) > 0 ? last / at(n) - 1 : 0);
  const sma = (n: number) => {
    const slice = h.slice(Math.max(0, h.length - n));
    if (slice.length === 0) return last;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  };

  const returns: number[] = [];
  for (let i = Math.max(1, h.length - 30); i < h.length; i++) {
    const prev = h[i - 1]!;
    if (prev > 0) returns.push((h[i]! - prev) / prev);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / Math.max(1, returns.length);
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, returns.length);
  const volatility30d = Math.sqrt(variance);

  // RSI(14)
  const period = Math.min(14, returns.length);
  let gains = 0;
  let losses = 0;
  for (let i = returns.length - period; i < returns.length; i++) {
    const r = returns[i] ?? 0;
    if (r >= 0) gains += r;
    else losses -= r;
  }
  const rs = losses === 0 ? 100 : gains / losses;
  const rsi = losses === 0 ? 100 : 100 - 100 / (1 + rs);

  // Linear regression slope over the last 14 points, normalised by price.
  const win = h.slice(-14);
  let trendStrength = 0;
  if (win.length >= 4) {
    const n = win.length;
    const xm = (n - 1) / 2;
    const ym = win.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xm) * (win[i]! - ym);
      den += (i - xm) ** 2;
    }
    const slope = den === 0 ? 0 : num / den;
    trendStrength = ym > 0 ? (slope * n) / ym : 0;
  }

  const ratio = market.supply > 0 ? market.demand / market.supply : 2;
  const scarcityLabel = ratio < 0.75 ? 'surplus' : ratio < 1.1 ? 'balanced' : ratio < 1.6 ? 'tight' : 'shortage';
  const sentimentLabel =
    market.sentiment < 0.2 ? 'fearful'
      : market.sentiment < 0.4 ? 'cautious'
        : market.sentiment < 0.6 ? 'neutral'
          : market.sentiment < 0.8 ? 'optimistic'
            : 'euphoric';

  const reversion = B.economy.meanReversion * (market.fundamental / Math.max(0.01, last) - 1);
  const momentum = B.economy.momentum * change(1);
  const next1d = last * (1 + reversion + momentum);

  return {
    price: last,
    change1d: change(1),
    change7d: change(7),
    change30d: change(30),
    sma7: sma(7),
    sma30: sma(30),
    volatility30d,
    trend: trendStrength > 0.02 ? 'rising' : trendStrength < -0.02 ? 'falling' : 'flat',
    trendStrength,
    momentum,
    rsi,
    supplyDemandRatio: ratio,
    scarcityLabel,
    sentimentLabel,
    deviationFromFundamental: market.fundamental > 0 ? last / market.fundamental - 1 : 0,
    forecast: {
      next1d: round2(next1d),
      next7d: round2(last * Math.pow(1 + reversion + momentum * 0.5, 7)),
      band: round2(volatility30d * Math.sqrt(7) * last),
    },
  };
}

export interface ArbitrageOpportunity {
  commodityId: ID;
  commodityName: string;
  buyLocationId: ID;
  sellLocationId: ID;
  buyPrice: number;
  sellPrice: number;
  /** Gross margin before travel/fees/risk. */
  grossMargin: number;
  units: number;
  /** Estimated travel cost per unit for the cheapest viable mode. */
  estTravelCostPerUnit: number;
  netMargin: number;
  risk: number;
  legal: boolean;
}

/**
 * Scans materialised markets for arbitrage. Deliberately reports *gross* and
 * *net* margin so the player sees that most apparent spreads are eaten by
 * travel, fees and risk — the mechanism that keeps arbitrage a skill rather
 * than a money printer.
 */
export function scanArbitrage(markets: Record<string, MarketState>, opts: { minMargin?: number; limit?: number } = {}): ArbitrageOpportunity[] {
  const worldReg = getWorldRegistry();
  const registry = getCommodityRegistry();
  const byCommodity = new Map<ID, MarketState[]>();
  for (const m of orderedValues(markets)) {
    const arr = byCommodity.get(m.commodityId);
    if (arr) arr.push(m);
    else byCommodity.set(m.commodityId, [m]);
  }

  const out: ArbitrageOpportunity[] = [];
  const minMargin = opts.minMargin ?? 0.08;

  for (const [commodityId, list] of byCommodity) {
    if (list.length < 2) continue;
    const commodity = registry.get(commodityId);
    if (!commodity) continue;
    const sorted = list.slice().sort((a, b) => a.price - b.price);
    const cheap = sorted[0]!;
    const dear = sorted[sorted.length - 1]!;
    if (cheap.locationId === dear.locationId || cheap.price <= 0) continue;
    const gross = dear.price / cheap.price - 1;
    if (gross < minMargin) continue;

    const a = worldReg.requireLocation(cheap.locationId);
    const b = worldReg.requireLocation(dear.locationId);
    const path = worldReg.findPath(a.id, b.id);
    const distance = path?.distanceKm ?? 1000;
    // Cheapest per-kg mode that can actually carry it.
    const mode = commodity.weightKg > 500 ? 'cargo_ship' : commodity.weightKg > 50 ? 'truck' : 'bus';
    const perKm = B.travel.costPerKm[mode] ?? B.travel.costPerKm.bus!;
    const fixed = B.travel.fixedCostByMode[mode] ?? 0;
    const travelCost = distance * perKm + fixed;
    const perUnit = commodity.weightKg > 0 ? travelCost / Math.max(1, 24 / commodity.weightKg) : travelCost;
    const net = gross - perUnit / Math.max(0.01, cheap.price);

    out.push({
      commodityId,
      commodityName: commodity.name,
      buyLocationId: a.id,
      sellLocationId: b.id,
      buyPrice: cheap.price,
      sellPrice: dear.price,
      grossMargin: round2(gross * 1000) / 1000,
      units: Math.floor(Math.min(cheap.supply * 0.25, 1000)),
      estTravelCostPerUnit: round2(perUnit),
      netMargin: round2(net * 1000) / 1000,
      risk: round2((path?.risk ?? 0.1) + commodity.risk * 0.4),
      legal: commodity.legality === 'legal' || commodity.legality === 'restricted',
    });
  }

  return out
    .filter((o) => o.grossMargin > 0)
    .sort((a, b) => b.netMargin - a.netMargin)
    .slice(0, opts.limit ?? 40);
}

/**
 * Guard rail used by tests and the server: a market pair must never present a
 * risk-free, cost-free, infinitely repeatable margin. Returns the largest
 * achievable margin after depth-limited impact for a given trade size.
 */
export function achievableMargin(
  buyMarket: MarketState,
  sellMarket: MarketState,
  commodity: CommodityDef,
  qty: number,
): number {
  const buyQuote = quotedPrices(buyMarket, commodity).buy;
  const sellQuote = quotedPrices(sellMarket, commodity).sell;
  if (buyQuote <= 0) return 0;
  // Model the impact of moving `qty` through both books.
  const buyDepth = Math.max(1, buyMarket.supply * B.market.depthPerSupplyUnit * 1000);
  const sellDepth = Math.max(1, sellMarket.supply * B.market.depthPerSupplyUnit * 1000);
  const buyImpact = clamp((qty / buyDepth) * B.market.playerImpactFactor, 0, B.market.maxImpactPerTrade);
  const sellImpact = clamp((qty / sellDepth) * B.market.playerImpactFactor, 0, B.market.maxImpactPerTrade);
  const effectiveBuy = buyQuote * (1 + buyImpact);
  const effectiveSell = sellQuote * (1 - sellImpact);
  return effectiveSell / effectiveBuy - 1;
}

/** Aggregate commodity price index across materialised markets (UI indicator). */
export function commodityPriceIndex(markets: Record<string, MarketState>): number {
  const list = orderedValues(markets);
  if (list.length === 0) return 1;
  let sum = 0;
  for (const m of list) sum += m.fundamental > 0 ? m.price / m.fundamental : 1;
  return sum / list.length;
}

export function describeLegality(location: LocationDef, c: CommodityDef): string {
  const effective = location.laws.legalityOverrides[c.category] ?? c.legality;
  const tolerated = location.laws.tolerated.includes(effective);
  if (effective === 'legal') return 'Legal — tradeable openly';
  if (effective === 'restricted') return tolerated ? 'Restricted — licence or paperwork required' : 'Restricted — not tolerated here';
  if (effective === 'illegal') return tolerated ? 'Illegal — tolerated, enforcement risk applies' : 'Illegal — actively enforced';
  return tolerated ? 'Contraband — severe penalties if discovered' : 'Contraband — highest enforcement priority';
}
