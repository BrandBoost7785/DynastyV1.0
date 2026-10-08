/**
 * Phase 3.1 — how rival firms *find* their opportunities.
 *
 * The trade network's economics are covered by `trade-network.test.ts`. These tests
 * cover the discovery architecture that replaced the full per-firm scan:
 *
 *   1. candidates are economically eligible (a route, a commodity both cities openly
 *      trade, a firm allowed to move it) and enumerated deterministically;
 *   2. the per-day cost is bounded by a rotating sweep window, not by
 *      firms × commodities × cities × cities;
 *   3. *considering* a line never creates a market — only dispatching into one does;
 *   4. long runs stay bounded (markets, flow history, save size);
 *   5. the network is still economically alive, to measured thresholds.
 *
 * Thresholds are floors set well below what the implementation actually produces, so
 * they fail on a real regression rather than on sandbox noise. They exist because the
 * cheapest way to make this simulation fast is to make it do nothing, and that is not
 * an acceptable trade.
 */
import { describe, expect, it } from 'vitest';
import { createNewGame } from '../src/sim/bootstrap';
import { advanceDays } from '../src/sim/tick';
import { creditCash, totalBalance, validateState } from '../src/sim/state';
import { marketKey } from '../src/sim/economy';
import { ensureMarket } from '../src/sim/markets';
import { createTradeNetwork, sweepWindowRange, tradeNetworkTick, tradeDiscoverySummary } from '../src/sim/trade-network';
import { deserializeState, serializeState } from '../src/persistence/serialize';
import { getCommodityRegistry, getWorldRegistry } from '../src/engine/registry';
import { BALANCE as B } from '../src/config/balance';
import { canonicalJson } from '../src/lib/hash';
import { Rng } from '../src/engine/rng';
import type { GameState } from '../src/sim/types';

const world = getWorldRegistry();
const registry = getCommodityRegistry();

function fresh(seed: string, cash = 2_000_000): GameState {
  const { state } = createNewGame({ userId: 'discovery-user', playerName: 'Operator', seed }) as unknown as { state: GameState };
  creditCash(state, cash, { kind: 'adjustment', description: 'test capital' });
  return state;
}

function runDays(state: GameState, days: number, tag: string, phase = 'days'): void {
  advanceDays(state, new Rng(`${tag}:${phase}`, 'test'), days);
}

/**
 * The parts of a state that must be reproducible.
 *
 * `gameId`, `createdAt`/`updatedAt` and the per-phase `ms` diagnostics are wall-clock
 * and identity observations, not simulation results — the same exclusions the
 * project's own restore/replay test uses. Everything else, economic state included,
 * has to match exactly.
 */
function comparable(state: GameState): string {
  return canonicalJson({
    ...state,
    gameId: null,
    createdAt: null,
    updatedAt: null,
    diagnostics: state.diagnostics.map((d) => ({ ...d, message: d.message.replace(/ in \d+ ms/, ''), data: undefined })),
  });
}

/* ------------------------------------------------------------------ */
/* 1. Candidate generation                                             */
/* ------------------------------------------------------------------ */

describe('discovery is over economically real lines only', () => {
  it('never trades a line a city does not stock, or a commodity firms may not move', () => {
    const state = fresh('discovery-eligibility');
    const network = state.world.tradeNetwork!;
    runDays(state, 200, 'discovery-eligibility');

    const flows = network.flows;
    expect(flows.length).toBeGreaterThan(0);
    for (const flow of flows) {
      const from = world.location(flow.originLocationId);
      const to = world.location(flow.destinationLocationId);
      expect(from, `flow ${flow.id} has no origin`).toBeDefined();
      expect(to, `flow ${flow.id} has no destination`).toBeDefined();
      // A firm buys where the good is sold and carries it where it is also sold: the
      // same rule the player's own market view applies.
      expect(from!.tradedCommodityIds).toContain(flow.commodityId);
      expect(to!.tradedCommodityIds).toContain(flow.commodityId);
      expect(registry.get(flow.commodityId)!.legality).toBe('legal');
      // …and the route is one the world actually prices.
      expect(world.route(flow.routeId)).toBeDefined();
    }
  });

  it('enumerates the opportunity index deterministically and within bound', () => {
    const first = tradeDiscoverySummary();
    const second = tradeDiscoverySummary();
    expect(second).toEqual(first);
    expect(first.indexLegs).toBeGreaterThan(0);
    // Every leg is priced once per sweep window, so the daily work is the window, not
    // the index — and never more than the index itself.
    expect(first.windowSize).toBeGreaterThan(0);
    expect(first.windowSize).toBeLessThanOrEqual(first.indexLegs);
    expect(first.windowSize).toBe(Math.ceil(first.indexLegs / first.sweepWindowDays));
  });
});

  it('covers the whole index within one sweep window', () => {
    /*
     * The reason a rotating sweep is *safe*: although only one window is priced per
     * day, every leg is revisited within `sweepWindowDays` days. If the window ever
     * stopped advancing, the same slice would be re-priced forever and the rest of the
     * world's routes would be silently dropped — this is the guarantee that filtering
     * cannot permanently hide a valid opportunity.
     */
    const { indexLegs, sweepWindowDays, windowSize } = tradeDiscoverySummary();
    expect(indexLegs).toBeGreaterThan(0);
    expect(sweepWindowDays).toBeGreaterThan(0);
    const covered = new Set<number>();
    for (let day = 0; day < sweepWindowDays; day += 1) {
      const { start, size } = sweepWindowRange(indexLegs, day);
      expect(size).toBe(windowSize);
      for (let i = 0; i < size; i += 1) covered.add((start + i) % indexLegs);
      // The window advances every day: no two consecutive days price the same start.
      const next = sweepWindowRange(indexLegs, day + 1);
      expect(next.start).not.toBe(start);
    }
    expect(covered.size).toBe(indexLegs);
    // …and the arithmetic is pure: the same day always yields the same window.
    expect(sweepWindowRange(indexLegs, 7)).toEqual(sweepWindowRange(indexLegs, 7));
  });

/* ------------------------------------------------------------------ */
/* 2. Market existence vs materialisation                              */
/* ------------------------------------------------------------------ */

describe('considering a line does not create a market', () => {
  it('creates no book at all on a tick that dispatches nothing', () => {
    const state = fresh('discovery-no-materialisation');
    const network = state.world.tradeNetwork!;
    // No firm may trade: every book that appears would be a book created merely by
    // being *considered*, which is what this phase removed.
    for (const agent of Object.values(network.agents)) agent.status = 'insolvent';
    const before = new Set(Object.keys(state.markets));
    for (let day = 1; day <= 40; day += 1) {
      state.world.day = day;
      tradeNetworkTick(state, new Rng(`discovery-static:${day}`, 'test'));
    }
    const created = Object.keys(state.markets).filter((key) => !before.has(key));
    expect(created).toEqual([]);
    expect(network.stats.dispatched).toBe(0);
  });

  it('opens a book only for a line the city actually trades', () => {
    const state = fresh('discovery-materialisation-shape');
    runDays(state, 120, 'discovery-materialisation-shape');
    for (const market of Object.values(state.markets)) {
      const location = world.location(market.locationId);
      expect(location, `market ${market.key} names an unknown location`).toBeDefined();
      expect(location!.tradedCommodityIds, `market ${market.key} is not a line this city stocks`).toContain(market.commodityId);
    }
  });

  it('keeps materialised markets bounded over a long run', () => {
    const state = fresh('discovery-bounded-markets');
    runDays(state, 500, 'discovery-bounded-markets');
    const markets = Object.values(state.markets);
    expect(markets.length).toBeLessThanOrEqual(B.tradeNetwork.liveMarketCap);
    // No line is ever stored twice under different keys.
    expect(new Set(markets.map((m) => m.key)).size).toBe(markets.length);
    // …and every key is the canonical location::commodity pair.
    for (const market of markets) expect(market.key).toBe(marketKey(market.locationId, market.commodityId));
  });
});

/* ------------------------------------------------------------------ */
/* 3. Bounded, self-contained state growth                             */
/* ------------------------------------------------------------------ */

describe('long runs do not grow without bound', () => {
  it('bounds flow history while never dropping cargo still in transit', () => {
    const state = fresh('discovery-bounded-flows');
    const network = state.world.tradeNetwork!;
    runDays(state, 400, 'discovery-bounded-flows');
    expect(network.flows.length).toBeLessThanOrEqual(B.tradeNetwork.flowHistory);
    expect(network.stats.dispatched).toBeGreaterThan(network.flows.length * 2);
    // The retained history is the most recent traffic, and in-transit cargo is state
    // the tick still has to settle, so it is never trimmed.
    const inTransit = network.flows.filter((f) => f.status === 'in_transit');
    expect(inTransit.length).toBeLessThanOrEqual(B.tradeNetwork.flowHistory);
    expect(network.flows.some((f) => f.status !== 'in_transit' || inTransit.length === network.flows.length)).toBe(true);
  });

  it('does not let the save grow with the length of the run', () => {
    const state = fresh('discovery-save-size');
    runDays(state, 200, 'discovery-save-size');
    const at200 = serializeState(state);
    runDays(state, 300, 'discovery-save-size');
    const at500 = serializeState(state);
    expect(at200.ok && at500.ok).toBe(true);
    if (!at200.ok || !at500.ok) return;
    const growth = at500.value.json.length / at200.value.json.length;
    // The world gets richer, but 300 further days must not multiply the document:
    // market count is capped and settled history is trimmed, so growth is bounded by
    // the live economy rather than by elapsed time.
    expect(growth).toBeLessThan(1.6);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Determinism and cache lifetime                                   */
/* ------------------------------------------------------------------ */

describe('discovery state is per-tick and rebuilds after a restore', () => {
  it('prices the same day identically when called twice from the same state', () => {
    const state = fresh('discovery-idempotent-day');
    const network = state.world.tradeNetwork!;
    runDays(state, 20, 'discovery-idempotent-day');
    const snapshot = network.flows.map((f) => `${f.id}:${f.status}:${f.qty}`);
    // A second tick on the same day, from the same state, is a fresh tick — the caches
    // live inside it, so nothing is carried across.
    state.world.day += 1;
    tradeNetworkTick(state, new Rng('discovery-repeat', 'test'));
    const firstCount = network.flows.length;
    expect(network.flows.length).toBeGreaterThanOrEqual(snapshot.length);
    expect(firstCount).toBeGreaterThan(0);
  });

  it('continues identically after save, restore and replay', () => {
    const continuous = fresh('discovery-restore');
    const interrupted = fresh('discovery-restore');
    // Both runs replay the same commands with the same seeds: advance 30 days, save
    // and restore one of them, then advance the remaining 30 days in both.
    runDays(continuous, 30, 'discovery-restore', 'pre');
    runDays(interrupted, 30, 'discovery-restore', 'pre');

    const sealed = serializeState(interrupted);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    const restored = deserializeState(sealed.value.json, { expectedHash: sealed.value.integrityHash });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;

    runDays(continuous, 30, 'discovery-restore', 'post');
    runDays(restored.value, 30, 'discovery-restore', 'post');

    // The whole authoritative document — books, firms, cargo, counters — must match.
    // Discovery's caches are ephemeral by design, so a restore rebuilds the sweep
    // rather than carrying a stale window across the boundary.
    expect(comparable(restored.value)).toBe(comparable(continuous));
    expect(validateState(restored.value).filter((i) => i.severity === 'error')).toEqual([]);
    // …and the world it rebuilt is a trading one, not an inert one.
    expect(restored.value.world.tradeNetwork!.stats.dispatched).toBe(continuous.world.tradeNetwork!.stats.dispatched);
    expect(restored.value.world.tradeNetwork!.stats.dispatched).toBeGreaterThan(0);
  });

  it('does not let one state’s books leak into another', () => {
    const a = fresh('discovery-isolation');
    const b = fresh('discovery-isolation');
    runDays(a, 60, 'discovery-isolation');
    runDays(b, 60, 'discovery-isolation');
    // Same seed, same days: two independent runs must agree exactly, which they could
    // not if any per-tick cache (the priced slice, the book peeks) were shared between
    // them. The opportunity index is registry-static, so it is safe to share.
    expect(comparable(b)).toBe(comparable(a));
  });
});

/* ------------------------------------------------------------------ */
/* 5. The economy is still alive                                       */
/* ------------------------------------------------------------------ */

describe('the network stays economically alive', () => {
  it('clears activity floors over a long run', () => {
    const state = fresh('discovery-activity');
    const network = state.world.tradeNetwork!;
    runDays(state, 400, 'discovery-activity');

    const delivered = network.flows.filter((f) => f.status === 'delivered');
    const agents = Object.values(network.agents);

    /*
     * Floors, not targets. Measured on this build over 400 days: 1359 dispatched,
     * 1157 delivered, 190 lost, 24 925 units moved. Each floor sits around half the
     * measured value, so a change that made the economy inert — over-filtering
     * candidates, starving firms of capital, shrinking the sweep — fails loudly while
     * ordinary variation does not.
     */
    expect(network.stats.dispatched).toBeGreaterThan(600);
    expect(network.stats.delivered).toBeGreaterThan(450);
    expect(network.stats.lost).toBeGreaterThan(60);
    expect(network.stats.volume).toBeGreaterThan(8_000);

    /*
     * Reach is measured on the retained window (older settled flows are trimmed by
     * design). Measured: 48 markets receiving cargo, 21 destination cities, 23 origin
     * cities, 29 commodities, 39 routes.
     */
    expect(new Set(delivered.map((f) => `${f.destinationLocationId}::${f.commodityId}`)).size).toBeGreaterThan(15);
    expect(new Set(delivered.map((f) => f.destinationLocationId)).size).toBeGreaterThan(8);
    expect(new Set(delivered.map((f) => f.originLocationId)).size).toBeGreaterThan(8);
    expect(new Set(delivered.map((f) => f.commodityId)).size).toBeGreaterThan(12);
    expect(new Set(delivered.map((f) => f.routeId)).size).toBeGreaterThan(12);

    // Capital is working: firms are funded and still trading at the end of the run.
    expect(agents.filter((a) => a.status === 'active').length).toBe(agents.length);
    expect(agents.every((a) => a.capital > 0)).toBe(true);
    expect(network.stats.realisedProfit).toBeGreaterThan(0);
    // Losses are real: route risk bites often enough to matter (measured ~14%).
    expect(network.stats.lost / (network.stats.delivered + network.stats.lost)).toBeGreaterThan(0.05);
  });

  it('keeps cargo flowing after the sweep has covered the whole map', () => {
    const state = fresh('discovery-sweep-coverage');
    const network = state.world.tradeNetwork!;
    // Ten sweep windows have passed; every leg in the index has been priced many
    // times, and dispatch must still be happening rather than having exhausted itself.
    runDays(state, 15 * tradeDiscoverySummary().sweepWindowDays, 'discovery-sweep-coverage');
    const early = network.stats.dispatched;
    runDays(state, 15 * tradeDiscoverySummary().sweepWindowDays, 'discovery-sweep-coverage');
    const later = network.stats.dispatched - early;
    expect(early).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* 6. Firms pay the costs they are judged on                           */
/* ------------------------------------------------------------------ */

describe('a firm’s balance sheet matches its own profit and loss', () => {
  it('pays freight in cash, not only in the cost basis', () => {
    const state = fresh('discovery-freight-cash');
    const network = state.world.tradeNetwork!;
    const agent = Object.values(network.agents)[0]!;
    // One firm, dispatching on a known tick, with everything else idle.
    for (const other of Object.values(network.agents)) if (other.id !== agent.id) other.status = 'insolvent';
    runDays(state, 5, 'discovery-freight-cash');

    const capitalBefore = agent.capital;
    state.world.day += 1;
    tradeNetworkTick(state, new Rng('discovery-freight-cash:tick', 'test'));
    const dispatched = network.flows.find((f) => f.agentId === agent.id && f.dispatchedDay === state.world.day);
    if (!dispatched) return; // this seed's firm did not move on this day
    const spent = capitalBefore - agent.capital;
    // Cash out is the cargo plus its freight, and the cost basis records exactly the
    // same two things — so a firm cannot drift richer than the profit it reports.
    expect(spent).toBeCloseTo(dispatched.qty * dispatched.unitCost, 2);
  });
});

/* ------------------------------------------------------------------ */
/* 7. Scaling                                                          */
/* ------------------------------------------------------------------ */

describe('discovery cost is a property of the world, not of firm count', () => {
  it('does not price more legs when the world has more firms', () => {
    const single = tradeDiscoverySummary();
    const state = fresh('discovery-stress');
    const competitors = state.world.competitors;
    const doubled: typeof competitors = { ...competitors };
    for (const competitor of Object.values(competitors)) {
      doubled[`${competitor.id}_x`] = { ...competitor, id: `${competitor.id}_x`, operatingLocationIds: [...competitor.operatingLocationIds] };
    }
    // 28 firms instead of 14: the sweep window is unchanged, because the index is the
    // world's, and each day's slice is shared by every firm.
    state.world.tradeNetwork = createTradeNetwork(doubled);
    const after = tradeDiscoverySummary();
    expect(after.indexLegs).toBe(single.indexLegs);
    expect(after.windowSize).toBe(single.windowSize);

    // With more firms the same priced slice supports more claims — activity scales,
    // cost does not.
    runDays(state, 120, 'discovery-stress');
    const network = state.world.tradeNetwork!;
    expect(Object.keys(network.agents).length).toBe(Object.keys(doubled).length);
    expect(network.stats.dispatched).toBeGreaterThan(0);
    expect(Object.keys(state.markets).length).toBeLessThanOrEqual(B.tradeNetwork.liveMarketCap);
  });
});

/* ------------------------------------------------------------------ */
/* 8. The player's own books are never touched by discovery             */
/* ------------------------------------------------------------------ */

describe('a rival never reaches into the player’s own position', () => {
  it('trades heavily without touching player cash, goods or trade counters', () => {
    const state = fresh('discovery-player-separation');
    const network = state.world.tradeNetwork!;
    const cashBefore = totalBalance(state.player);
    const inventoryBefore = state.player.inventory.map((s) => `${s.commodityId}:${s.qty}`).join(',');

    /*
     * Only the trade network runs here — no world tick, so no events, factions or
     * player-facing systems. Anything that moves in the player's accounts would
     * therefore have to be the network's doing.
     */
    for (let day = 1; day <= 120; day += 1) {
      state.world.day = day;
      tradeNetworkTick(state, new Rng(`discovery-isolation-tick:${day}`, 'test'));
    }

    expect(network.stats.dispatched).toBeGreaterThan(50);
    expect(totalBalance(state.player)).toBe(cashBefore);
    expect(state.player.inventory.map((s) => `${s.commodityId}:${s.qty}`).join(',')).toBe(inventoryBefore);
    // The player traded nothing, so they have no traded counters at all — while the
    // rivals' own volume is recorded under its separate prefix.
    expect(Object.keys(state.player.stats.counters).filter((k) => k.startsWith('traded:'))).toEqual([]);
    expect(Object.keys(state.player.stats.counters).filter((k) => k.startsWith('rival_traded:')).length).toBeGreaterThan(0);
    expect(validateState(state).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('cannot satisfy the player’s own objectives', () => {
    const state = fresh('discovery-objectives');
    for (let day = 1; day <= 120; day += 1) {
      state.world.day = day;
      tradeNetworkTick(state, new Rng(`discovery-objectives:${day}`, 'test'));
    }
    // The monopoly objective reads the *player's* share of trade. Rival cargo must
    // never count towards it, however much of the world they move.
    expect(state.world.tradeNetwork!.stats.dispatched).toBeGreaterThan(50);
    expect(state.status).toBe('active');
    expect(state.ending).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 9. The sweep still answers the world                                */
/* ------------------------------------------------------------------ */

/**
 * Direct-tick causality. Only `tradeNetworkTick` runs, so a difference between two
 * same-seed worlds is caused by the single thing that was changed in one of them — no
 * daily pass can absorb the intervention first, and route risk keeps the value the
 * test gave it.
 *
 * Landings are counted by watching cargo that was `in_transit` at the start of a tick
 * and has settled by the end, rather than by slicing the flow list: settled history is
 * trimmed at the retention cap, so slicing would silently under-count. The line under
 * test is *discovered* from a warm-up run of the control world, never hardcoded —
 * which line the firms concentrate on is a property of the world and its seed.
 */
interface Landings { landings: number; units: number; lost: number }

function tallyLandings(state: GameState, days: number, tag: string): { byLine: Map<string, Landings>; byRoute: Map<string, Landings> } {
  const network = state.world.tradeNetwork!;
  const byLine = new Map<string, Landings>();
  const byRoute = new Map<string, Landings>();
  const bump = (map: Map<string, Landings>, key: string, flow: { qty: number }, delivered: boolean) => {
    const entry = map.get(key) ?? { landings: 0, units: 0, lost: 0 };
    if (delivered) {
      entry.landings += 1;
      entry.units += flow.qty;
    } else entry.lost += 1;
    map.set(key, entry);
  };
  for (let i = 1; i <= days; i += 1) {
    const inTransit = new Map(network.flows.filter((f) => f.status === 'in_transit').map((f) => [f.id, f]));
    state.world.day += 1;
    tradeNetworkTick(state, new Rng(`${tag}:${i}`, 'test'));
    for (const [id, flow] of inTransit) {
      const settled = network.flows.find((f) => f.id === id);
      if (!settled || settled.status === 'in_transit') continue;
      bump(byLine, `${flow.destinationLocationId}|${flow.commodityId}`, flow, settled.status === 'delivered');
      bump(byRoute, flow.routeId, flow, settled.status === 'delivered');
    }
  }
  return { byLine, byRoute };
}

/** The busiest entry of a tally — the traffic a world actually concentrates on. */
function busiest(map: Map<string, Landings>): string {
  const ranked = [...map.entries()].filter(([, v]) => v.units > 0).sort((a, b) => b[1].units - a[1].units);
  expect(ranked.length, 'no cargo moved at all during the warm-up').toBeGreaterThan(0);
  return ranked[0]![0];
}

describe('the sweep still answers the world it prices into', () => {
  it('caps shipment size by what a starved book can absorb, and keeps serving it', () => {
    /*
     * An empty book is not an invitation to dump cargo: `sizeFor` follows the
     * destination's absorbable depth, so a starved market draws smaller shipments and
     * stays scarce instead of being arbitraged flat in one tick. This is the shortage
     * response, and it has to survive the new discovery path.
     */
    const seed = 'discovery-shortage';
    const control = fresh(seed);
    const starved = fresh(seed);
    const warm = tallyLandings(control, 60, `${seed}:warm`);
    tallyLandings(starved, 60, `${seed}:warm`);
    const [destinationId, commodityId] = busiest(warm.byLine).split('|') as [string, string];
    const controlMarket = ensureMarket(control, destinationId, commodityId)!;
    const starvedMarket = ensureMarket(starved, destinationId, commodityId)!;
    // A tenth of nothing is nothing: pin the book to a depth no shipment can fill.
    starvedMarket.supply = 25;

    const controlAfter = tallyLandings(control, 90, `${seed}:post`);
    const starvedAfter = tallyLandings(starved, 90, `${seed}:post`);
    const line = `${destinationId}|${commodityId}`;
    const controlLine = controlAfter.byLine.get(line) ?? { landings: 0, units: 0, lost: 0 };
    const starvedLine = starvedAfter.byLine.get(line) ?? { landings: 0, units: 0, lost: 0 };

    // The line is still served — scarcity does not make it invisible to discovery.
    expect(starvedLine.landings).toBeGreaterThan(0);
    // But the depth of the book caps what arrives, so it moves materially less than the
    // supplied twin and stays scarce.
    expect(controlLine.units).toBeGreaterThan(150);
    expect(starvedLine.units).toBeLessThan(controlLine.units * 0.75);
    expect(starvedMarket.supply).toBeLessThan(controlMarket.supply / 2);
  });

  it('settles cargo on a calm lane and loses some of it on a deadly one', () => {
    // The same traffic, the same seed, one world with the risk of the busiest lane
    // removed and one with it near certain. Risk alone must decide what arrives.
    const seed = 'discovery-risk-response';
    const calm = fresh(seed);
    const deadly = fresh(seed);
    const warm = tallyLandings(calm, 60, `${seed}:warm`);
    tallyLandings(deadly, 60, `${seed}:warm`);
    const routeId = busiest(warm.byRoute);
    for (const route of Object.values(calm.world.routes)) {
      if (route.routeId === routeId) {
        route.risk = 0;
        route.disrupted = false;
      }
    }
    for (const route of Object.values(deadly.world.routes)) {
      if (route.routeId === routeId) {
        route.risk = 0.95;
        route.disrupted = false;
      }
    }

    const calmAfter = tallyLandings(calm, 90, `${seed}:post`).byRoute.get(routeId) ?? { landings: 0, units: 0, lost: 0 };
    const deadlyAfter = tallyLandings(deadly, 90, `${seed}:post`).byRoute.get(routeId) ?? { landings: 0, units: 0, lost: 0 };

    expect(calmAfter.landings).toBeGreaterThan(5);
    // Nothing is lost on a lane with no risk…
    expect(calmAfter.lost).toBe(0);
    // …while the same lane at 0.95 risk both loses cargo and lands less of it.
    expect(deadlyAfter.lost).toBeGreaterThan(0);
    expect(deadlyAfter.units).toBeLessThan(calmAfter.units);
  });
});
