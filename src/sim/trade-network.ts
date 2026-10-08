/**
 * Trade network — the world's *other* economic actors, as physical flows.
 *
 * ## Why this exists
 *
 * Before Phase 3 the world's NPC firms were decorative: `competitorPressure`
 * multiplied local supply/demand by a small constant derived from a competitor's
 * `focus` and `operatingLocationIds`, and those two fields were themselves chosen
 * at random. Nothing in the simulation connected two locations to each other. A
 * city with a shortage stayed short until mean reversion ground it away; a city
 * with a glut stayed cheap. The player's arbitrage had no competitor, so the only
 * cost of a long-haul run was the player's own freight bill, and no player action
 * could ever be *answered* by a rival.
 *
 * This module gives rivals real balance sheets and real cargo. An agent looks for
 * a commodity it can buy in one of its cities and sell for more in another, pays
 * the freight, accepts the route risk, and moves the units. When cargo lands it
 * *is* supply: the destination book is credited through the same
 * `tradeImpact` the player's own trades use, so a landed shipment depresses the
 * price the seller hoped to fetch. That is what makes arbitrage a race rather
 * than a free-money tap, and what makes a shortage attract relief.
 *
 * ## Rules the agents obey (they are not a second economy)
 *
 *  - Every purchase and sale goes through `tradeImpact`, the same function that
 *    prices the player's trades, inside the same `absorbableUnits` limit.
 *  - Freight is charged at the same per-km rates and speeds the player pays
 *    (`BALANCE.travel`), from the same `RouteState` that carries risk, disruption
 *    and cost multipliers — so a war or a port closure chokes NPC trade exactly
 *    as it chokes the player's.
 *  - An agent cannot spend capital it does not have, and cannot buy a book that
 *    has no units in it.
 *  - Legality is enforced: an agent only touches goods its own channel may move.
 *
 * ## Determinism
 *
 * Iteration is over id-sorted keys, every roll comes from the caller's day RNG,
 * and nothing depends on insertion order. Identical state + seed replays
 * identically, which is why flows live in the save.
 */

import { getBalance } from '../config/balance';
import { Rng } from '../engine/rng';
import { getCommodityRegistry, getWorldRegistry } from '../engine/registry';
import type {
  CommodityCategory,
  CommodityDef,
  GameState,
  ID,
  LocationDef,
  MarketState,
  RouteDef,
  TradeAgentState,
  TradeFlowState,
  TradeNetworkState,
  TravelMode,
  WorldState,
} from './types';
import { marketKey, tradeImpact, type MarketContext } from './economy';
import { absorbableUnits, ensureMarket, marketContext, pruneMarkets, recordRivalTrade } from './markets';
import { newId, round2 } from './state';
import { pushNews } from './world';
import { orderedEntries, orderedKeys } from './ordering';

const B = getBalance();

/* ------------------------------------------------------------------ */
/* Construction                                                        */
/* ------------------------------------------------------------------ */

/** Freight modes an NPC firm will use, cheapest-first per unit of reach. */
const FREIGHT_MODES: TravelMode[] = ['truck', 'cargo_ship', 'train'];

function freightModeFor(route: RouteDef, distanceKm: number): TravelMode | null {
  for (const mode of FREIGHT_MODES) {
    if (route.modes.includes(mode)) return mode;
  }
  // A route that carries no freight mode at all (a footpath) is not tradable.
  if (distanceKm <= 0) return null;
  return route.modes.includes('air') ? 'air' : null;
}

/** All-in cost per unit to move cargo one leg, using the player's own rates. */
export function freightCostPerUnit(routeState: { disrupted: boolean; costMultiplier: number }, route: RouteDef, mode: TravelMode): number {
  const perKm = B.travel.costPerKm[mode] ?? 1;
  const fixed = B.travel.fixedCostByMode[mode] ?? 0;
  // Mirror `planTravel`: a disrupted leg costs its multiplier, otherwise list price.
  const disruption = routeState.disrupted ? routeState.costMultiplier : 1;
  return (route.distanceKm * perKm + fixed) * disruption;
}

/** Days a leg takes at the mode's average speed, floored at one. */
export function freightDays(route: RouteDef, mode: TravelMode): number {
  const speed = B.travel.speedKmPerDay[mode] ?? 400;
  return Math.max(1, Math.ceil(route.distanceKm / speed));
}

export function createTradeNetwork(
  competitors: Record<ID, { id: ID; name: string; homeLocationId: ID; capital: number; focus: CommodityCategory[]; operatingLocationIds: ID[] }>,
): TradeNetworkState {
  const agents: Record<ID, TradeAgentState> = {};
  for (const id of orderedKeys(competitors)) {
    const comp = competitors[id]!;
    agents[id] = {
      id,
      name: comp.name,
      homeLocationId: comp.homeLocationId,
      capital: round2(Math.max(10_000, comp.capital * B.tradeNetwork.capitalFraction)),
      focus: [...comp.focus],
      operatingLocationIds: [...comp.operatingLocationIds],
      dispatched: 0,
      delivered: 0,
      lost: 0,
      volume: 0,
      realisedProfit: 0,
      lastDispatchDay: -999,
      status: 'active',
      losses: 0,
    };
  }
  return { agents, flows: [], stats: { dispatched: 0, delivered: 0, lost: 0, volume: 0, realisedProfit: 0 }, lastScanDay: -1 };
}

/**
 * Rebuild the slice for a save written before Phase 3.
 *
 * Deterministic and lossless: an agent's identity, focus and footprint all come
 * from the competitor record the save already carries, so a migrated save yields
 * exactly the network it would have had if the feature had shipped earlier.
 */
export function adoptTradeNetwork(world: WorldState): TradeNetworkState {
  return createTradeNetwork(world.competitors);
}

/* ------------------------------------------------------------------ */
/* Market plumbing                                                     */
/* ------------------------------------------------------------------ */

interface Leg {
  commodity: CommodityDef;
  originId: ID;
  destinationId: ID;
  route: RouteDef;
  mode: TravelMode;
  buyPrice: number;
  sellPrice: number;
  freight: number;
  days: number;
  risk: number;
  /** Expected profit per unit after freight, before risk of loss. */
  margin: number;
  /** Units the origin book can surrender today (`absorbableUnits`). */
  originAbsorbable: number;
  /** Standing supply at the destination, before this cargo lands. */
  destinationSupply: number;
  /** Fraction of the purchase price left after freight and risk. */
  marginFraction: number;
}

function closedMarket(market: MarketState | undefined): boolean {
  return !market || market.price <= 0;
}

/**
 * Price an agent would pay / receive through its own channel.
 *
 * Agents pay the same spread the player pays for the same commodity class, and
 * are blocked from commodities they are not allowed to move (a legitimate trading
 * house does not buy narcotics just because they are cheap).
 */
function channelPrices(c: CommodityDef, market: MarketState, agentKindRestricted: boolean): { buy: number; sell: number } | null {
  if (c.legality !== 'legal') {
    if (c.legality === 'illegal' || c.legality === 'contraband') return null;
    if (agentKindRestricted && c.legality === 'restricted') return null;
  }
  const spread = c.legality === 'legal' ? B.market.legalSpread : B.market.illegalSpread;
  const half = Math.max(0.005, spread * 0.5);
  return { buy: round2(market.price * (1 + half)), sell: round2(market.price * (1 - half)) };
}

/*
 * Per-tick market lookup cache.
 *
 * A firm scores every origin×destination pair for the commodities it scans, and
 * agents overlap heavily on the same books, so the *same* location/commodity pair is
 * looked up thousands of times in one tick. `ensureMarket` materialises a book on
 * first touch, which is the expensive part; this cache makes it happen once per pair
 * per tick instead. It is a pure lookup cache — same books, same order, no RNG — so
 * simulation results are unchanged.
 */
type MarketBookCache = Map<string, MarketState | null>;

/*
 * Per-tick leg memo.
 *
 * A leg's economics (`evaluateLeg`) depend only on the commodity, the two cities and
 * the route — never on which firm is looking at it, because the firm's own budget is
 * applied afterwards in `sizeFor`. Firms overlap heavily on the same cities, so without
 * this the same leg is priced once per firm per day. Memoising it is exact: same
 * inputs, same `Leg` object, same ordering of the scan's comparisons.
 */
type LegCache = Map<string, Leg | null>;

function legIn(
  cache: LegCache,
  state: GameState,
  ctx: MarketContext,
  books: MarketBookCache,
  commodity: CommodityDef,
  origin: LocationDef,
  destination: LocationDef,
  route: RouteDef,
  restricted: boolean,
): Leg | null {
  const key = `${commodity.id}::${origin.id}::${destination.id}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const leg = evaluateLeg(state, ctx, commodity, origin, destination, route, restricted, books);
  cache.set(key, leg);
  return leg;
}

function marketIn(
  books: MarketBookCache,
  state: GameState,
  ctx: MarketContext,
  locationId: ID,
  commodityId: ID,
): MarketState | null {
  const key = `${locationId}::${commodityId}`;
  const cached = books.get(key);
  if (cached !== undefined) return cached;
  const market = ensureMarket(state, locationId, commodityId, ctx) ?? null;
  books.set(key, market);
  return market;
}

/**
 * Evaluate a single origin→destination leg for one commodity.
 *
 * Returns null unless the leg is physically possible, legally open to the agent,
 * and the freight bill still leaves a margin worth taking.
 */
function evaluateLeg(
  state: GameState,
  ctx: MarketContext,
  commodity: CommodityDef,
  origin: LocationDef,
  destination: LocationDef,
  route: RouteDef,
  restricted: boolean,
  books: MarketBookCache,
): Leg | null {
  const originMarket = marketIn(books, state, ctx, origin.id, commodity.id);
  const destinationMarket = marketIn(books, state, ctx, destination.id, commodity.id);
  if (closedMarket(originMarket ?? undefined) || closedMarket(destinationMarket ?? undefined)) return null;

  const originPrices = channelPrices(commodity, originMarket!, restricted);
  const destinationPrices = channelPrices(commodity, destinationMarket!, restricted);
  if (!originPrices || !destinationPrices) return null;

  const mode = freightModeFor(route, route.distanceKm);
  if (!mode) return null;

  const routeState = state.world.routes[route.id] ?? { disrupted: false, costMultiplier: 1 };
  const freight = freightCostPerUnit(routeState, route, mode);
  const days = freightDays(route, mode);
  const risk = state.world.routes[route.id]?.risk ?? route.baseRisk;

  const gross = destinationPrices.sell - originPrices.buy;
  // Expected loss from a route at risk r: cargo value × r × loss fraction.
  const riskHaircut = risk * B.tradeNetwork.riskLossFraction;
  const margin = gross - freight - destinationPrices.sell * riskHaircut;

  // A leg must clear the hurdle *and* actually leave something behind: agents do
  // not move a truck for a 0.1% edge, and a wrapped branch cannot be posted
  // negative on a route the player would also refuse.
  if (margin <= 0) return null;
  const marginFraction = margin / Math.max(0.01, originPrices.buy);
  if (marginFraction < B.tradeNetwork.minMarginFraction) return null;
  // A route that is closed (disrupted and unknown) carries no cargo.
  if (routeState.disrupted && risk >= B.tradeNetwork.maxDispatchRisk) return null;

  const originAbsorbable = absorbableUnits(state, originMarket!, 'buy');
  if (originAbsorbable <= 0) return null;

  return {
    commodity,
    originId: origin.id,
    destinationId: destination.id,
    route,
    mode,
    buyPrice: originPrices.buy,
    sellPrice: destinationPrices.sell,
    freight,
    days,
    risk,
    margin,
    marginFraction,
    originAbsorbable,
    destinationSupply: Math.max(0, destinationMarket!.supply),
  };
}

/** Units this leg would actually move, for a given working capital budget. */
function sizeFor(leg: Leg, budget: number): number {
  const byCapital = Math.floor(budget / Math.max(0.01, leg.buyPrice));
  const byOriginBook = Math.floor(leg.originAbsorbable * B.tradeNetwork.bookSharePerDispatch);
  const byDestinationBook = Math.floor(leg.destinationSupply * B.tradeNetwork.destinationBookShare);
  const size = Math.floor(Math.min(B.tradeNetwork.maxUnitsPerDispatch, byCapital, byOriginBook, byDestinationBook));
  return Math.max(0, size);
}

/* ------------------------------------------------------------------ */
/* The tick                                                            */
/* ------------------------------------------------------------------ */

export interface TradeNetworkTickResult {
  dispatched: number;
  delivered: number;
  lost: number;
  volume: number;
  realisedProfit: number;
  agentFailures: { agentId: ID; name: string; reason: string }[];
  /** Market keys whose book changed because of a delivery this tick. */
  touchedMarkets: ID[];
}

/** Candidate commodities for an agent: its focus categories, sampled per day. */
function candidateCommodities(agent: TradeAgentState, rng: Rng): CommodityDef[] {
  const registry = getCommodityRegistry();
  const out: CommodityDef[] = [];
  const seen = new Set<ID>();
  for (const category of agent.focus) {
    const pool = registry.byCategoryList(category).filter((c) => c.legality === 'legal' || c.legality === 'restricted');
    if (pool.length === 0) continue;
    for (let i = 0; i < B.tradeNetwork.commoditiesPerAgentScan; i += 1) {
      const pick = rng.pick(pool);
      if (!pick || seen.has(pick.id)) continue;
      seen.add(pick.id);
      out.push(pick);
    }
  }
  return out;
}

/**
 * Move the network forward one day.
 *
 * Order matters and is fixed: deliveries settle first (so cargo that lands today
 * is supply today), then interception is resolved, then new legs are priced
 * against the resulting books. Within each stage iteration is id-sorted.
 */
export function tradeNetworkTick(state: GameState, rng: Rng): TradeNetworkTickResult {
  const world = state.world;
  const day = world.day;
  const worldReg = getWorldRegistry();
  const registry = getCommodityRegistry();
  const network = world.tradeNetwork;
  const result: TradeNetworkTickResult = {
    dispatched: 0,
    delivered: 0,
    lost: 0,
    volume: 0,
    realisedProfit: 0,
    agentFailures: [],
    touchedMarkets: [],
  };
  if (!network) return result;

  const touched = new Set<ID>();

  /*
   * One market context for the whole network pass.
   *
   * Deliberately lazy: on a day when no agent has capital, is off cooldown and
   * rolls a scan, nothing is built at all. When a scan does run, every market it
   * materialises shares this context instead of recomputing faction pressure for
   * all 48 locations each time.
   */
  let ctx: MarketContext | null = null;
  const contextFor = () => (ctx ??= marketContext(state));
  // One book cache and one leg memo per tick: see their definitions for why both are
  // exact rather than approximations.
  const books: MarketBookCache = new Map();
  const legs: LegCache = new Map();

  /* ------------------------- 1. settle in-transit cargo ------------------------ */
  for (const flow of network.flows) {
    if (flow.status !== 'in_transit') continue;
    if (day < flow.arrivesDay) continue;

    const commodity = registry.get(flow.commodityId);
    const destination = worldReg.location(flow.destinationLocationId);
    const routeState = world.routes[flow.routeId];
    if (!commodity || !destination) {
      flow.status = 'lost';
      continue;
    }

    // Route risk, raised by wars and disruption, can take the cargo before it lands.
    const risk = routeState?.risk ?? worldReg.route(flow.routeId)?.baseRisk ?? 0.1;
    const intercepted = rng.chance(Math.min(B.tradeNetwork.maxInterceptionChance, risk * B.tradeNetwork.interceptionPerRisk));
    const agent = network.agents[flow.agentId];
    if (intercepted) {
      flow.status = 'lost';
      flow.detail = routeState?.disruptionReason ?? 'Taken on a high-risk route';
      result.lost += 1;
      network.stats.lost += 1;
      if (agent) {
        agent.lost += 1;
        agent.losses += 1;
        agent.realisedProfit = round2(agent.realisedProfit - flow.notionalValue);
      }
      continue;
    }

    const market = ensureMarket(state, flow.destinationLocationId, flow.commodityId, contextFor());
    if (!market) {
      flow.status = 'lost';
      continue;
    }

    /*
     * The landing *is* the supply event. Selling `qty` into the destination book
     * uses the player's own impact rule, which credits supply and presses the
     * price down — which is exactly why an easy arbitrage does not stay easy.
     */
    const storable = Math.max(0, Math.floor(flow.qty));
    if (storable > 0) {
      tradeImpact(market, commodity, storable, 'sell');
      market.lastTradedDay = day;
      touched.add(market.key);
    }
    const proceeds = round2(storable * market.price);
    flow.status = 'delivered';
    flow.detail = null;
    result.delivered += 1;
    result.volume += storable;
    network.stats.delivered += 1;
    network.stats.volume += storable;
    if (agent) {
      const profit = round2(proceeds - flow.qty * flow.unitCost);
      agent.capital = round2(agent.capital + proceeds);
      agent.delivered += 1;
      agent.volume += storable;
      agent.realisedProfit = round2(agent.realisedProfit + profit);
      network.stats.realisedProfit = round2(network.stats.realisedProfit + profit);
      result.realisedProfit = round2(result.realisedProfit + profit);
      if (profit > 0) agent.losses = 0;
      else agent.losses += 1;
    }
  }

  /* ------------------------------ 2. dispatch ----------------------------- */
  for (const id of orderedKeys(network.agents)) {
    const agent = network.agents[id]!;
    if (agent.status !== 'active') continue;
    if (day - agent.lastDispatchDay < B.tradeNetwork.dispatchCooldownDays) continue;
    if (!rng.chance(B.tradeNetwork.dispatchChancePerDay)) continue;
    if (agent.capital < B.tradeNetwork.minCapitalToTrade) continue;

    const inFlight = network.flows.filter((f) => f.agentId === agent.id && f.status === 'in_transit').length;
    if (inFlight >= B.tradeNetwork.maxFlowsPerAgent) continue;

    const locations = agent.operatingLocationIds
      .map((locationId) => worldReg.location(locationId))
      .filter((l): l is LocationDef => l !== undefined && !l.hidden);
    if (locations.length < 2) continue;

    const scanCtx = contextFor();
    const commodities = candidateCommodities(agent, rng);
    const restricted = true; // legitimate firms do not touch restricted goods
    const budget = agent.capital * B.tradeNetwork.capitalCommitFraction;

    /*
     * A firm maximises *expected profit*, not markup.
     *
     * Scoring legs by unit margin picks the thinnest, most expensive good on the
     * map — two bars of refined gold — because a 4% edge on a 400,000-unit item
     * dwarfs a 3% edge on a truckload. Real carriers move freight, so the score is
     * `margin × size`, which naturally favours deep books with a worthwhile spread
     * and is also what makes a landed cargo big enough to press a price down.
     */
    let best: Leg | null = null;
    let bestSize = 0;
    let bestScore = 0;
    for (const commodity of commodities) {
      for (const origin of locations) {
        for (const destination of locations) {
          if (origin.id === destination.id) continue;
          const route = worldReg.routeBetween(origin.id, destination.id);
          if (!route) continue;
          const leg = legIn(legs, state, scanCtx, books, commodity, origin, destination, route, restricted);
          if (!leg) continue;
          const size = sizeFor(leg, budget);
          if (size <= 0) continue;
          const score = leg.margin * size;
          if (score > bestScore) {
            best = leg;
            bestSize = size;
            bestScore = score;
          }
        }
      }
    }
    if (!best) continue;

    const market = ensureMarket(state, best.originId, best.commodity.id, scanCtx);
    if (!market) continue;
    const absorbable = absorbableUnits(state, market, 'buy');
    if (absorbable <= 0) continue;
    const qty = Math.min(bestSize, absorbable);
    if (qty <= 0) continue;

    // Pay for the cargo through the same impact path the player's buy uses.
    tradeImpact(market, best.commodity, qty, 'buy');
    market.lastTradedDay = day;
    touched.add(market.key);
    const spend = round2(qty * market.price);
    agent.capital = round2(agent.capital - spend);
    agent.lastDispatchDay = day;
    agent.dispatched += 1;
    // The market's daily absorb cap is shared with the player, but the *player's*
    // volume counter is not: rival volume must never be attributed to the player.
    recordRivalTrade(state, market.key, qty, day);
    if (market.price <= 0) {
      // A dead book is not a market; refund and skip rather than dispatch nothing.
      agent.capital = round2(agent.capital + spend);
      continue;
    }

    const flow: TradeFlowState = {
      id: newId(rng, 'flow'),
      agentId: agent.id,
      commodityId: best.commodity.id,
      originLocationId: best.originId,
      destinationLocationId: best.destinationId,
      routeId: best.route.id,
      mode: best.mode,
      qty,
      unitCost: round2((spend + qty * best.freight) / qty),
      notionalValue: round2(qty * best.sellPrice),
      dispatchedDay: day,
      arrivesDay: day + best.days,
      status: 'in_transit',
      detail: null,
    };
    // Freight is paid up front, like the player pays a carrier.
    agent.capital = round2(agent.capital - qty * best.freight);
    network.flows.push(flow);
    network.stats.dispatched += 1;
    result.dispatched += 1;

    // The trade is worth a line in the feed when it is large enough to matter to
    // the destination's book, which is the signal of a real dislocation.
    const destinationMarket = state.markets[marketKey(best.destinationId, best.commodity.id)];
    const bookShare = destinationMarket ? qty / Math.max(1, destinationMarket.supply) : 0;
    if (bookShare >= B.tradeNetwork.newsWorthinessBookShare) {
      pushNews(world, {
        scope: 'regional',
        category: 'market',
        headline: `${agent.name} ships ${best.commodity.name} to ${worldReg.requireLocation(best.destinationId).name}`,
        body: `${qty.toLocaleString('en-US')} units bought at ${worldReg.requireLocation(best.originId).name} for ${worldReg.requireLocation(best.destinationId).name}, arriving day ${flow.arrivesDay} (~${(bookShare * 100).toFixed(1)}% of the local book).`,
        locationIds: [best.originId, best.destinationId],
        tags: ['trade', best.commodity.id, agent.id],
        importance: bookShare > 0.2 ? 4 : 2,
      });
    }
  }

  /* --------------------------- 3. agent solvency --------------------------- */
  for (const id of orderedKeys(network.agents)) {
    const agent = network.agents[id]!;
    if (agent.status !== 'active') continue;
    if (agent.capital >= B.tradeNetwork.minCapitalToTrade) continue;
    if (agent.losses < B.tradeNetwork.lossesBeforeExit) continue;
    agent.status = 'insolvent';
    result.agentFailures.push({ agentId: agent.id, name: agent.name, reason: `Working capital ${agent.capital.toFixed(0)} and ${agent.losses} consecutive losses` });
    pushNews(world, {
      scope: 'regional',
      category: 'market',
      headline: `${agent.name} halts trading`,
      body: `The firm stopped buying after ${agent.losses} losing cargoes and ${agent.dispatched} dispatches. Its footprint on local books is now open for whoever moves first.`,
      locationIds: agent.operatingLocationIds.slice(0, 4),
      tags: ['trade', agent.id],
      importance: 3,
    });
  }

  /* ----------------------------- 4. book-keeping ---------------------------- */
  if (network.flows.length > B.tradeNetwork.flowHistory) {
    // Keep settled history bounded; in-transit cargo is never dropped.
    const inTransit = network.flows.filter((f) => f.status === 'in_transit');
    const settled = network.flows.filter((f) => f.status !== 'in_transit').slice(-B.tradeNetwork.flowHistory);
    network.flows = [...inTransit, ...settled];
  }
  /*
   * Keep the live market set bounded.
   *
   * The scan prices legs by materialising the (location × commodity) pairs it
   * evaluates, which is how a rival firm "discovers" a market at all — but every
   * materialised line is then stepped by `stepMarkets` every single day, so an
   * unbounded footprint makes the whole economy slower, not just this system.
   * Pruning here is safe and self-correcting: a market the agents actually trade
   * has a recent `lastTradedDay` and survives, while a pair that was priced and
   * then rejected is evicted first and simply rematerialises next time it matters.
   */
  const evicted = pruneMarkets(state, B.tradeNetwork.liveMarketCap);
  if (evicted > 0) {
    state.diagnostics.push({
      day,
      turn: state.turn,
      system: 'trade_network',
      level: 'debug',
      message: `Pruned ${evicted} stale market(s) after the trade-network pass`,
    });
  }

  network.lastScanDay = day;
  result.touchedMarkets = [...touched].sort();
  return result;
}

/* ------------------------------------------------------------------ */
/* Read models                                                         */
/* ------------------------------------------------------------------ */

export interface TradeFlowView {
  id: ID;
  /** Server-side identity. The public projection drops it; the name is what ships. */
  agentId: ID;
  agentName: string;
  commodityId: ID;
  commodityName: string;
  fromName: string;
  toName: string;
  mode: TravelMode;
  qty: number;
  unitCost: number;
  notionalValue: number;
  dispatchedDay: number;
  arrivesDay: number;
  daysRemaining: number;
  status: TradeFlowState['status'];
  risk: number;
  detail: string | null;
}

/** Player-visible view of routes, flows, and per-route exposure. */
export interface TradeNetworkView {
  asOfDay: number;
  agents: number;
  activeAgents: number;
  inTransit: number;
  stats: TradeNetworkState['stats'];
  /** Flow volume dispatched / landed in the last 30 days. */
  dispatchedLast30Days: number;
  landedLast30Days: number;
  flows: TradeFlowView[];
  routes: {
    routeId: ID;
    commodityId: ID;
    originId: ID;
    destinationId: ID;
    fromName: string;
    toName: string;
    inTransitQty: number;
    dispatches: number;
    landedQty: number;
    lostQty: number;
    risk: number;
  }[];
}

export function tradeNetworkView(state: GameState): TradeNetworkView | null {
  const network = state.world.tradeNetwork;
  if (!network) return null;
  const worldReg = getWorldRegistry();
  const registry = getCommodityRegistry();
  const day = state.world.day;
  const nameOf = (id: ID) => worldReg.location(id)?.name ?? id;

  const flows: TradeFlowView[] = network.flows
    .filter((f) => f.status === 'in_transit')
    .map((f) => ({
      id: f.id,
      agentId: f.agentId,
      agentName: network.agents[f.agentId]?.name ?? f.agentId,
      commodityId: f.commodityId,
      commodityName: registry.get(f.commodityId)?.name ?? f.commodityId,
      fromName: nameOf(f.originLocationId),
      toName: nameOf(f.destinationLocationId),
      mode: f.mode,
      qty: f.qty,
      unitCost: f.unitCost,
      notionalValue: f.notionalValue,
      dispatchedDay: f.dispatchedDay,
      arrivesDay: f.arrivesDay,
      daysRemaining: Math.max(0, f.arrivesDay - day),
      status: f.status,
      risk: state.world.routes[f.routeId]?.risk ?? worldReg.route(f.routeId)?.baseRisk ?? 0,
      detail: f.detail,
    }))
    .sort((a, b) => a.arrivesDay - b.arrivesDay || (a.id < b.id ? -1 : 1));

  const routeAgg = new Map<string, TradeNetworkView['routes'][number]>();
  for (const f of network.flows) {
    if (f.dispatchedDay < day - 30) continue;
    const key = `${f.routeId}::${f.commodityId}`;
    const entry = routeAgg.get(key) ?? {
      routeId: f.routeId,
      commodityId: f.commodityId,
      originId: f.originLocationId,
      destinationId: f.destinationLocationId,
      fromName: nameOf(f.originLocationId),
      toName: nameOf(f.destinationLocationId),
      inTransitQty: 0,
      dispatches: 0,
      landedQty: 0,
      lostQty: 0,
      risk: state.world.routes[f.routeId]?.risk ?? worldReg.route(f.routeId)?.baseRisk ?? 0,
    };
    entry.dispatches += 1;
    if (f.status === 'in_transit') entry.inTransitQty += f.qty;
    else if (f.status === 'delivered') entry.landedQty += f.qty;
    else entry.lostQty += f.qty;
    routeAgg.set(key, entry);
  }

  const agents = orderedKeys(network.agents).map((id) => network.agents[id]!);
  return {
    asOfDay: day,
    agents: agents.length,
    activeAgents: agents.filter((a) => a.status === 'active').length,
    inTransit: flows.length,
    stats: network.stats,
    dispatchedLast30Days: network.flows.filter((f) => f.dispatchedDay >= day - 30).length,
    landedLast30Days: network.flows.filter((f) => f.status === 'delivered' && f.arrivesDay >= day - 30).length,
    flows,
    routes: [...routeAgg.values()].sort((a, b) => b.inTransitQty - a.inTransitQty || (a.routeId < b.routeId ? -1 : 1)),
  };
}

/**
 * Net flow signal for one market, used to explain a price in the market's own
 * words. Positive means cargo is inbound (bearish for price), negative outbound.
 */
export function flowSignalFor(state: GameState, locationId: ID, commodityId: ID): { inbound: number; outbound: number } {
  const network = state.world.tradeNetwork;
  if (!network) return { inbound: 0, outbound: 0 };
  let inbound = 0;
  let outbound = 0;
  for (const flow of network.flows) {
    if (flow.commodityId !== commodityId) continue;
    if (flow.status !== 'in_transit') continue;
    if (flow.destinationLocationId === locationId) inbound += flow.qty;
    else if (flow.originLocationId === locationId) outbound += flow.qty;
  }
  return { inbound, outbound };
}

/** Compact summary for diagnostics and the day report. */
export function tradeNetworkSummary(result: TradeNetworkTickResult): string {
  const parts = [`${result.dispatched} dispatch(es)`];
  if (result.delivered > 0) parts.push(`${result.delivered} landed (${result.volume.toLocaleString('en-US')} units)`);
  if (result.lost > 0) parts.push(`${result.lost} lost in transit`);
  if (result.agentFailures.length > 0) parts.push(`${result.agentFailures.length} firm(s) halted`);
  return parts.join(', ');
}

/** Registered agents, for the player-facing view and tests. */
export function tradeAgents(state: GameState): TradeAgentState[] {
  const network = state.world.tradeNetwork;
  if (!network) return [];
  return orderedEntries(network.agents).map(([, agent]) => agent);
}
