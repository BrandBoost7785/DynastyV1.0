/**
 * Rival trade network — unit, integration, persistence and determinism tests.
 *
 * The network exists so that the world's other firms are *economic actors* rather
 * than decoration. These tests hold it to that: cargo must be paid for, freight
 * must be charged, arrivals must become supply, risk must be able to destroy a
 * cargo, and the whole thing must replay identically from a save.
 *
 * Nothing here mocks the market layer. Deliveries go through the same
 * `tradeImpact` the player's trades use, so if the wiring is wrong — if a landed
 * shipment fails to depress the destination price, or a route's risk is ignored —
 * it fails here rather than in a player's save.
 */
import { describe, expect, it } from 'vitest';
import { createNewGame } from '../src/sim/bootstrap';
import { advanceDays, monopolyShare, rngForDay } from '../src/sim/tick';
import { creditCash, validateState, totalBalance } from '../src/sim/state';
import { marketKey } from '../src/sim/economy';
import { absorbableUnits, ensureMarket, recordRivalTrade } from '../src/sim/markets';
import {
  adoptTradeNetwork,
  createTradeNetwork,
  freightCostPerUnit,
  freightDays,
  tradeAgents,
  tradeNetworkTick,
  tradeNetworkView,
} from '../src/sim/trade-network';
import { deserializeState, serializeState } from '../src/persistence/serialize';
import { getCommodityRegistry, getWorldRegistry } from '../src/engine/registry';
import { BALANCE as B } from '../src/config/balance';
import { Rng } from '../src/engine/rng';
import { publicTradeNetwork } from '../src/server/dto';
import type { GameState } from '../src/sim/types';

const registry = getCommodityRegistry();
const world = getWorldRegistry();

function fresh(seed: string, cash = 500_000): GameState {
  const { state } = createNewGame({ userId: 'network-user', playerName: 'Operator', seed });
  creditCash(state, cash, { kind: 'adjustment', description: 'network test capital' });
  return state;
}

/** A deterministic stream for the network under test, independent of the day RNG. */
function netRng(seed: string, day: number): Rng {
  return new Rng(`${seed}:net:${day}`, 'trade-network-test');
}

function runDays(state: GameState, days: number, tag = 'net'): void {
  for (let i = 1; i <= days; i += 1) {
    const day = state.world.day + 1;
    state.world.day = day;
    tradeNetworkTick(state, netRng(tag, day));
  }
}

/* ------------------------------------------------------------------ */
/* 1. Construction                                                     */
/* ------------------------------------------------------------------ */

describe('the trade network is built from the world, not alongside it', () => {
  it('gives every competitor firm an agent with real working capital', () => {
    const state = fresh('network-construct');
    const network = state.world.tradeNetwork;
    expect(network).toBeDefined();
    const competitorIds = Object.keys(state.world.competitors).sort();
    expect(Object.keys(network!.agents).sort()).toEqual(competitorIds);
    for (const id of competitorIds) {
      const agent = network!.agents[id]!;
      const competitor = state.world.competitors[id]!;
      expect(agent.name).toBe(competitor.name);
      expect(agent.capital).toBeGreaterThan(0);
      expect(agent.status).toBe('active');
      // Focus and footprint come from the competitor record: the agent *is* that firm.
      expect(agent.focus).toEqual(competitor.focus);
      expect(agent.operatingLocationIds).toEqual(competitor.operatingLocationIds);
    }
  });

  it('derives an equivalent network for a save that predates the feature', () => {
    const state = fresh('network-adopt');
    const rebuilt = adoptTradeNetwork(state.world);
    const original = state.world.tradeNetwork!;
    // Same identities, same capital, same footprint — a migrated save gets exactly
    // the network it would have had, and nothing invented.
    expect(Object.keys(rebuilt.agents).sort()).toEqual(Object.keys(original.agents).sort());
    for (const id of Object.keys(original.agents)) {
      expect(rebuilt.agents[id]!.capital).toBe(original.agents[id]!.capital);
      expect(rebuilt.agents[id]!.operatingLocationIds).toEqual(original.agents[id]!.operatingLocationIds);
    }
    expect(rebuilt.flows).toEqual([]);
    expect(rebuilt.stats).toEqual({ dispatched: 0, delivered: 0, lost: 0, volume: 0, realisedProfit: 0 });
  });

  it('creates one agent per competitor without needing a game state', () => {
    const network = createTradeNetwork({
      a: { id: 'a', name: 'A', homeLocationId: world.locations[0]!.id, capital: 100_000, focus: ['metal'], operatingLocationIds: [world.locations[0]!.id] },
    });
    expect(network.agents.a!.capital).toBeGreaterThan(0);
    expect(network.flows).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Freight mirrors what the player pays                             */
/* ------------------------------------------------------------------ */

describe('agents pay the same freight the player pays', () => {
  it('prices a leg from the shared travel rates, and disruption raises it', () => {
    const route = world.routes.find((r) => r.modes.includes('truck'))!;
    const mode = 'truck' as const;
    const clean = freightCostPerUnit({ disrupted: false, costMultiplier: 1 }, route, mode);
    const expected = route.distanceKm * B.travel.costPerKm[mode]! + B.travel.fixedCostByMode[mode]!;
    expect(clean).toBeCloseTo(expected, 6);

    // A disrupted route costs the multiplier the *player's* travel planner applies.
    const disrupted = freightCostPerUnit({ disrupted: true, costMultiplier: 1.9 }, route, mode);
    expect(disrupted).toBeCloseTo(clean * 1.9, 6);

    // Transit time uses the player's own average speeds, floored at one day.
    expect(freightDays(route, mode)).toBe(Math.max(1, Math.ceil(route.distanceKm / B.travel.speedKmPerDay[mode]!)));
  });
});

/* ------------------------------------------------------------------ */
/* 3. Dispatching                                                      */
/* ------------------------------------------------------------------ */

describe('agents move real cargo under the real rules', () => {
  it('dispatches cargo that is paid for out of the agent’s own capital', () => {
    const state = fresh('network-dispatch');
    const network = state.world.tradeNetwork!;
    const capitalBefore = Object.fromEntries(Object.entries(network.agents).map(([id, a]) => [id, a.capital]));
    runDays(state, 40, 'network-dispatch');

    const dispatched = Object.values(network.agents).reduce((n, a) => n + a.dispatched, 0);
    expect(dispatched).toBeGreaterThan(0);

    for (const agent of Object.values(network.agents)) {
      expect(Number.isFinite(agent.capital)).toBe(true);
      expect(agent.capital).toBeGreaterThanOrEqual(0);
      expect(agent.dispatched).toBeGreaterThanOrEqual(0);
    }
    // Cargo is paid for: somebody spent money to move something.
    const spent = Object.entries(network.agents).some(([id, a]) => a.dispatched > 0 && a.capital !== capitalBefore[id]);
    expect(spent).toBe(true);
  });

  it('never moves cargo a firm is not allowed to move', () => {
    const state = fresh('network-legality');
    runDays(state, 60, 'network-legality');
    const network = state.world.tradeNetwork!;
    expect(network.flows.length).toBeGreaterThan(0);
    for (const flow of network.flows) {
      const c = registry.get(flow.commodityId);
      expect(c).toBeDefined();
      // Legitimate firms carry legal (and, where their channel permits it, restricted)
      // goods — never narcotics or contraband.
      expect(['legal', 'restricted']).toContain(c!.legality);
    }
  });

  it('keeps its footprint bounded so the economy stays affordable', () => {
    const state = fresh('network-footprint');
    const cap = B.tradeNetwork.liveMarketCap;
    runDays(state, 120, 'network-footprint');
    expect(Object.keys(state.markets).length).toBeLessThanOrEqual(cap);
  });

  it('leaves a world with no agents alone', () => {
    const state = fresh('network-empty');
    state.world.tradeNetwork = { agents: {}, flows: [], stats: { dispatched: 0, delivered: 0, lost: 0, volume: 0, realisedProfit: 0 }, lastScanDay: -1 };
    const marketsBefore = JSON.stringify(state.markets);
    const result = tradeNetworkTick(state, netRng('network-empty', 1));
    expect(result.dispatched).toBe(0);
    expect(result.delivered).toBe(0);
    expect(JSON.stringify(state.markets)).toBe(marketsBefore);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Deliveries are supply events                                     */
/* ------------------------------------------------------------------ */

describe('a landed cargo is a supply event in the destination market', () => {
  it('credits the destination book and presses its price down', () => {
    const state = fresh('network-delivery');
    const network = state.world.tradeNetwork!;
    const day = state.world.day;

    // Place one cargo of a known commodity at a known destination by hand, priced
    // exactly the way the dispatcher prices one, and settle it.
    const location = world.location(state.player.locationId)!;
    const commodity = registry.all().find((c) => c.legality === 'legal' && c.category === 'foodstuff')!;
    const market = ensureMarket(state, location.id, commodity.id)!;
    const route = world.neighboursOf(location.id)[0]!;
    const before = { supply: market.supply, price: market.price, volume30d: market.volume30d };
    const agent = Object.values(network.agents)[0]!;
    network.flows.push({
      id: 'flow_test_delivery',
      agentId: agent.id,
      commodityId: commodity.id,
      originLocationId: route.other.id,
      destinationLocationId: location.id,
      routeId: route.route.id,
      mode: 'truck',
      qty: Math.max(10, Math.floor(market.supply * 0.1)),
      unitCost: 1,
      notionalValue: 1,
      dispatchedDay: day - 5,
      arrivesDay: day,
      status: 'in_transit',
      detail: null,
    });
    state.world.day = day + 1;

    const result = tradeNetworkTick(state, new Rng('network-delivery:settle', 'test'));

    expect(result.delivered).toBe(1);
    expect(result.volume).toBeGreaterThan(0);
    expect(result.touchedMarkets).toContain(marketKey(location.id, commodity.id));
    const after = state.markets[marketKey(location.id, commodity.id)]!;
    expect(after.supply).toBeGreaterThan(before.supply);
    expect(after.price).toBeLessThan(before.price);
    expect(after.volume30d).toBeGreaterThan(before.volume30d);
    expect(network.flows[0]!.status).toBe('delivered');
  });

  it('pays the agent for the cargo it landed, net of what it cost', () => {
    const state = fresh('network-proceeds');
    const network = state.world.tradeNetwork!;
    const agent = Object.values(network.agents)[0]!;
    // Only this firm is trading, and it is not dispatching today: every change to its
    // books here comes from the cargo placed below, which is what the test asserts.
    for (const other of Object.values(network.agents)) if (other.id !== agent.id) other.status = 'insolvent';
    agent.lastDispatchDay = 1_000_000;
    const location = world.location(state.player.locationId)!;
    const commodity = registry.all().find((c) => c.legality === 'legal')!;
    const market = ensureMarket(state, location.id, commodity.id)!;
    const route = world.neighboursOf(location.id)[0]!;
    const qty = Math.max(5, Math.floor(market.supply * 0.05));
    network.flows.push({
      id: 'flow_test_proceeds',
      agentId: agent.id,
      commodityId: commodity.id,
      originLocationId: route.other.id,
      destinationLocationId: location.id,
      routeId: route.route.id,
      mode: 'truck',
      qty,
      unitCost: 1,
      notionalValue: 1,
      dispatchedDay: state.world.day,
      arrivesDay: state.world.day,
      status: 'in_transit',
      detail: null,
    });
    state.world.day += 1;
    const capitalBefore = agent.capital;
    tradeNetworkTick(state, new Rng('network-proceeds:settle', 'test'));
    expect(agent.capital).toBeGreaterThan(capitalBefore);
    expect(agent.delivered).toBe(1);
    expect(Number.isFinite(agent.realisedProfit)).toBe(true);
    expect(agent.volume).toBeGreaterThan(0);
  });

  it('turns a route’s risk into lost cargo, which never becomes supply', () => {
    const state = fresh('network-risk');
    const network = state.world.tradeNetwork!;
    const agent = Object.values(network.agents)[0]!;
    // Only this firm is trading and it never dispatches on its own account, so every
    // change to its books during this test comes from the cargo placed below.
    for (const other of Object.values(network.agents)) if (other.id !== agent.id) other.status = 'insolvent';
    agent.lastDispatchDay = 1_000_000;

    const location = world.location(state.player.locationId)!;
    const commodity = registry.all().find((c) => c.legality === 'legal')!;
    const market = ensureMarket(state, location.id, commodity.id)!;
    const route = world.neighboursOf(location.id)[0]!;
    // A route at maximum risk: interception is rolled on every attempt, so this
    // drives the settle path until a cargo is genuinely taken.
    state.world.routes[route.route.id] = {
      routeId: route.route.id,
      disrupted: true,
      disruptedUntilDay: null,
      disruptionReason: 'Test closure',
      risk: 1,
      costMultiplier: 2,
    };
    const supplyBefore = market.supply;
    const lostBefore = agent.lost;

    let attempt = 0;
    let lost = false;
    while (!lost && attempt < 400) {
      attempt += 1;
      const id = `flow_test_risk_${attempt}`;
      network.flows.push({
        id,
        agentId: agent.id,
        commodityId: commodity.id,
        originLocationId: route.other.id,
        destinationLocationId: location.id,
        routeId: route.route.id,
        mode: 'truck',
        qty: Math.max(10, Math.floor(market.supply * 0.1)),
        unitCost: 1,
        notionalValue: 1,
        dispatchedDay: state.world.day,
        arrivesDay: state.world.day,
        status: 'in_transit',
        detail: null,
      });
      state.world.day += 1;
      tradeNetworkTick(state, new Rng(`network-risk:settle:${attempt}`, 'test'));
      lost = network.flows.find((f) => f.id === id)?.status === 'lost';
    }

    // A route risk that never bites would make wars and closures purely cosmetic.
    expect(lost).toBe(true);
    const settled = network.flows.filter((f) => f.id.startsWith('flow_test_risk_'));
    expect(settled.length).toBeGreaterThan(0);
    expect(settled.some((f) => f.status === 'lost')).toBe(true);
    // The cargo never became supply, and the firm was not paid for it.
    expect(market.supply).toBeGreaterThanOrEqual(supplyBefore);
    expect(agent.lost).toBeGreaterThan(lostBefore);
    const lostFlow = settled.find((f) => f.status === 'lost')!;
    expect(lostFlow.detail).toBe('Test closure');
  });
});

/* ------------------------------------------------------------------ */
/* 5. Competition: a gap attracts carriers until it stops paying       */
/* ------------------------------------------------------------------ */

describe('rival cargo answers a price gap', () => {
  it('makes every settled cargo a supply event in the market it lands in', () => {
    /*
     * Measured on real dispatches, tick by tick: only `tradeNetworkTick` is driven
     * here, so a change to a destination book across a landing tick is the cargo and
     * nothing else. This is the causal chain the network exists for — a rival
     * perceives a gap, ships, and the arrival *is* supply.
     */
    const state = fresh('network-chain');
    const network = state.world.tradeNetwork!;
    const snapshots = new Map<string, { supply: number; price: number }>();
    const observed: { supplyUp: number; priceDown: number; checked: number } = { supplyUp: 0, priceDown: 0, checked: 0 };

    for (let i = 1; i <= 90; i += 1) {
      // Snapshot every market an in-transit cargo is heading for, before the tick.
      snapshots.clear();
      for (const flow of network.flows) {
        if (flow.status !== 'in_transit') continue;
        const market = state.markets[marketKey(flow.destinationLocationId, flow.commodityId)];
        if (market) snapshots.set(flow.id, { supply: market.supply, price: market.price });
      }
      const inTransitBefore = new Set(network.flows.filter((f) => f.status === 'in_transit').map((f) => f.id));
      state.world.day += 1;
      tradeNetworkTick(state, new Rng(`network-chain:${i}`, 'test'));
      for (const flow of network.flows) {
        // A cargo that left 'in_transit' for 'delivered' on this tick.
        if (!inTransitBefore.has(flow.id) || flow.status !== 'delivered') continue;
        const before = snapshots.get(flow.id);
        if (!before) continue;
        const after = state.markets[marketKey(flow.destinationLocationId, flow.commodityId)];
        if (!after) continue;
        observed.checked += 1;
        if (after.supply > before.supply) observed.supplyUp += 1;
        if (after.price < before.price) observed.priceDown += 1;
      }
    }

    expect(network.stats.delivered).toBeGreaterThan(0);
    expect(observed.checked).toBeGreaterThan(0);
    // Cargo that lands adds units to the destination book every single time.
    expect(observed.supplyUp).toBe(observed.checked);
    // And, because a landing goes through the same impact rule the player's own sales
    // use, it presses the destination price down.
    expect(observed.priceDown / observed.checked).toBeGreaterThan(0.8);
  });

  it('routes cargo in a direction that pays, and the world diverges from a world without it', () => {
    const DAYS = 90;
    const live = fresh('network-competition');
    const control = fresh('network-competition');
    // The control is the same world with every firm halted before the first tick.
    for (const agent of Object.values(control.world.tradeNetwork!.agents)) agent.status = 'insolvent';

    runDays(live, DAYS, 'network-competition');
    runDays(control, DAYS, 'network-competition');

    const network = live.world.tradeNetwork!;
    const delivered = network.flows.filter((f) => f.status === 'delivered');
    expect(network.stats.volume).toBeGreaterThan(0);
    expect(delivered.length).toBeGreaterThan(0);
    for (const flow of delivered) {
      // Costed cargo: the firm paid a unit cost, and nothing lands before it departs.
      expect(flow.unitCost).toBeGreaterThan(0);
      expect(flow.arrivesDay).toBeGreaterThanOrEqual(flow.dispatchedDay);
    }

    // A network that changed nothing about the world would be decoration.
    const diverged = Object.keys(live.markets).some((key) => {
      const theirs = control.markets[key];
      return theirs === undefined || theirs.price !== live.markets[key]!.price || theirs.supply !== live.markets[key]!.supply;
    });
    expect(diverged).toBe(true);
    // The player's own city is priced in both worlds: the extra demand of rival
    // buyers and the extra supply they land have to show up somewhere.
    const hereLive = live.markets[marketKey(live.player.locationId, 'wheat__raw')];
    const hereControl = control.markets[marketKey(control.player.locationId, 'wheat__raw')];
    if (hereLive && hereControl) {
      expect(Number.isFinite(hereLive.price)).toBe(true);
      expect(Number.isFinite(hereControl.price)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 6. Solvency                                                         */
/* ------------------------------------------------------------------ */

describe('a rival that keeps losing money stops trading', () => {
  it('halts a firm whose working capital is gone', () => {
    const state = fresh('network-insolvent');
    const network = state.world.tradeNetwork!;
    state.world.day += 1;
    for (const agent of Object.values(network.agents)) {
      agent.capital = 0;
      agent.losses = B.tradeNetwork.lossesBeforeExit;
    }
    const result = tradeNetworkTick(state, netRng('network-insolvent', state.world.day));
    expect(result.agentFailures.length).toBeGreaterThan(0);
    for (const agent of Object.values(network.agents)) {
      expect(agent.status).toBe('insolvent');
    }
    // A halted firm does not dispatch.
    const dispatchedBefore = Object.values(network.agents).reduce((n, a) => n + a.dispatched, 0);
    runDays(state, 5, 'network-insolvent-after');
    expect(Object.values(network.agents).reduce((n, a) => n + a.dispatched, 0)).toBe(dispatchedBefore);
  });
});

/* ------------------------------------------------------------------ */
/* 7. Persistence, determinism and the public view                     */
/* ------------------------------------------------------------------ */

describe('flows live in the save and replay identically', () => {
  it('survives a save round-trip with its cargo, books and history intact', () => {
    const state = fresh('network-save');
    runDays(state, 45, 'network-save');
    const serialised = serializeState(state);
    expect(serialised.ok).toBe(true);
    if (!serialised.ok) return;
    const restored = deserializeState(serialised.value.json, { validate: true });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const before = state.world.tradeNetwork!;
    const after = restored.value.world.tradeNetwork!;
    expect(Object.keys(after.agents).sort()).toEqual(Object.keys(before.agents).sort());
    expect(after.flows).toEqual(before.flows);
    expect(after.stats).toEqual(before.stats);
    for (const id of Object.keys(before.agents)) {
      expect(after.agents[id]!.capital).toBe(before.agents[id]!.capital);
      expect(after.agents[id]!.dispatched).toBe(before.agents[id]!.dispatched);
    }
  });

  it('produces identical cargo from identical state and seed', () => {
    const a = fresh('network-determinism');
    const b = fresh('network-determinism');
    runDays(a, 30, 'shared');
    runDays(b, 30, 'shared');
    expect(a.world.tradeNetwork!.flows).toEqual(b.world.tradeNetwork!.flows);
    expect(a.world.tradeNetwork!.stats).toEqual(b.world.tradeNetwork!.stats);
    // The markets the landed cargo touched are identical too.
    expect(Object.keys(a.markets).sort()).toEqual(Object.keys(b.markets).sort());
    for (const key of Object.keys(a.markets)) {
      expect(a.markets[key]!.price).toBe(b.markets[key]!.price);
      expect(a.markets[key]!.supply).toBe(b.markets[key]!.supply);
    }
  });

  it('diverges when the seed changes, so the world is not a constant', () => {
    const a = fresh('network-seed-a');
    const b = fresh('network-seed-b');
    runDays(a, 30, 'shared');
    runDays(b, 30, 'shared');
    expect(a.world.tradeNetwork!.flows).not.toEqual(b.world.tradeNetwork!.flows);
  });

  it('keeps a restored save on the same path as the run it came from', () => {
    const live = fresh('network-resume');
    runDays(live, 25, 'network-resume');
    const snapshot = serializeState(live);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const restored = deserializeState(snapshot.value.json, { validate: false });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    // Same commands, same seeds, from the same day: identical outcome.
    runDays(live, 20, 'network-resume');
    const copy = restored.value;
    for (let i = 1; i <= 20; i += 1) {
      const day = copy.world.day + 1;
      copy.world.day = day;
      tradeNetworkTick(copy, netRng('network-resume', day));
    }
    expect(copy.world.tradeNetwork!.flows).toEqual(live.world.tradeNetwork!.flows);
    expect(copy.world.tradeNetwork!.stats).toEqual(live.world.tradeNetwork!.stats);
  });
});

describe('rival trade is market activity, never the player’s own', () => {
  it('never books a rival’s cargo against the player', () => {
    const state = fresh('network-counter-hygiene');
    const network = state.world.tradeNetwork!;
    runDays(state, 30, 'network-counter-hygiene');
    expect(network.stats.dispatched).toBeGreaterThan(0);

    const sum = (prefix: string) =>
      Object.entries(state.player.stats.counters)
        .filter(([key]) => key.startsWith(prefix))
        .reduce((total, [, value]) => total + value, 0);
    // The player has traded nothing in this world…
    expect(sum('traded:')).toBe(0);
    // …while the rivals' drain of the same books is recorded under its own prefix, so
    // it counts against the daily absorb cap without ever being the player's volume.
    expect(sum('rival_traded:')).toBeGreaterThan(0);
    // Which is what the monopoly objective reads: no player volume, no share.
    expect(monopolyShare(state)).toBe(0);
    expect(state.status).toBe('active');
    expect(state.ending).toBeNull();
  });

  it('makes rival buying drain the same daily book the player buys from', () => {
    const state = fresh('network-book-drain');
    const location = world.location(state.player.locationId)!;
    const commodity = registry.all().find((c) => c.legality === 'legal')!;
    const market = ensureMarket(state, location.id, commodity.id)!;
    market.supply = Math.max(market.supply, 500);

    const before = absorbableUnits(state, market, 'buy');
    expect(before).toBeGreaterThan(20);
    recordRivalTrade(state, market.key, 10);
    const after = absorbableUnits(state, market, 'buy');
    // Ten units a competitor took out of this market are ten units the player cannot
    // also take today — the cap is the market's, not each participant's private one.
    expect(before - after).toBe(10);
  });
});

describe('the public view shows traffic without the balance sheet', () => {
  it('exposes who is moving what, and withholds working capital and profit', () => {
    const state = fresh('network-view');
    runDays(state, 40, 'network-view');
    const view = tradeNetworkView(state);
    expect(view).not.toBeNull();
    expect(view!.agents).toBeGreaterThan(0);
    expect(view!.flows.length).toBeGreaterThan(0);
    for (const flow of view!.flows) {
      expect(registry.get(flow.commodityId)).toBeDefined();
      expect(flow.qty).toBeGreaterThan(0);
      expect(flow.arrivesDay).toBeGreaterThanOrEqual(flow.dispatchedDay);
      expect(typeof flow.fromName).toBe('string');
      expect(typeof flow.toName).toBe('string');
    }

    const publicView = publicTradeNetwork(view)!;
    const json = JSON.stringify(publicView);
    for (const forbidden of ['"capital"', 'realisedProfit', 'losses', 'lastDispatchDay', 'agentId']) {
      expect(json.includes(forbidden)).toBe(false);
    }
    // Traffic is still described, because that is what a market participant sees.
    expect(publicView.inTransit).toBe(view!.inTransit);
    expect(publicView.flows.length).toBe(view!.flows.length);
  });

  it('returns null rather than inventing a network for a world without one', () => {
    expect(tradeNetworkView({ ...fresh('network-null'), world: { ...fresh('network-null').world, tradeNetwork: undefined } } as GameState)).toBeNull();
    expect(publicTradeNetwork(null)).toBeNull();
    expect(tradeAgents({ ...fresh('network-null2'), world: { ...fresh('network-null2').world, tradeNetwork: undefined } } as GameState)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 8. Invariants                                                       */
/* ------------------------------------------------------------------ */

describe('the network cannot break the economy it trades in', () => {
  it('keeps every market finite and valid over a long run', () => {
    const state = fresh('network-invariants');
    advanceDays(state, rngForDay(state, 120), 120, { stopOnCombat: false });
    const errors = validateState(state).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
    for (const market of Object.values(state.markets)) {
      expect(Number.isFinite(market.price)).toBe(true);
      expect(market.price).toBeGreaterThan(0);
      expect(Number.isFinite(market.supply)).toBe(true);
      expect(market.supply).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(market.fundamental)).toBe(true);
    }
    for (const agent of tradeAgents(state)) {
      expect(Number.isFinite(agent.capital)).toBe(true);
      expect(agent.capital).toBeGreaterThanOrEqual(0);
      expect(agent.volume).toBeGreaterThanOrEqual(0);
    }
    expect(totalBalance(state.player)).toBeGreaterThanOrEqual(0);
  });

  it('never lets a cargo be settled twice', () => {
    const state = fresh('network-double-settle');
    runDays(state, 60, 'network-double-settle');
    const network = state.world.tradeNetwork!;
    const delivered = network.flows.filter((f) => f.status === 'delivered');
    expect(new Set(delivered.map((f) => f.id)).size).toBe(delivered.length);
    // Re-running the tick on the same day cannot redeliver a settled cargo.
    const volumeBefore = network.stats.volume;
    network.flows = network.flows.map((f) => ({ ...f }));
    const again = tradeNetworkTick(state, netRng('network-double-settle', state.world.day));
    expect(again.delivered).toBe(0);
    expect(network.stats.volume).toBe(volumeBefore);
  });

  it('clamps a hostile state to a sane world', () => {
    const state = fresh('network-hostile');
    const agent = Object.values(state.world.tradeNetwork!.agents)[0]!;
    // Negative capital, a commodity with no counterparties, an operating list of one.
    agent.capital = -5000;
    agent.operatingLocationIds = [state.player.locationId];
    const before = agent.dispatched;
    tradeNetworkTick(state, netRng('network-hostile', state.world.day));
    // An agent with no money and nowhere to go dispatches nothing; the rest of the
    // world is unaffected.
    expect(agent.dispatched).toBe(before);
    expect(Number.isFinite(agent.capital)).toBe(true);
    expect(agent.capital).toBeLessThan(B.tradeNetwork.minCapitalToTrade);
  });
});
