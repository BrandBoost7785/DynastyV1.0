/**
 * Simulation-depth tests.
 *
 * Phase 1 proved the platform (transport, persistence, authority). These tests are
 * about the *simulation itself*: that the catalogue the game ships is actually
 * reachable, that the systems which depend on each other agree, that a run is
 * reproducible, that restoring a save and replaying the same commands lands in the
 * same place, and that a long run cannot quietly corrupt state.
 *
 * They are deliberately written against the registries and the simulation API rather
 * than against the UI: a screen existing has never been evidence that the mechanic
 * beneath it works.
 */
import { describe, expect, it } from 'vitest';
import { getCommodityRegistry, getWorldRegistry } from '../src/engine/registry';
import { RECIPES } from '../src/engine/registry/assets';
import { MISSIONS } from '../src/engine/registry/missions';
import { createNewGame } from '../src/sim/bootstrap';
import { advanceDays, rngForAction } from '../src/sim/tick';
import { dispatch } from '../src/sim/actions';
import { creditCash, totalBalance, validateState } from '../src/sim/state';
import type { ActionIntent } from '../src/sim/validation';
import { marketRows, tradePermission } from '../src/sim/markets';
import { deserializeState, serializeState } from '../src/persistence/serialize';
import { Rng } from '../src/engine/rng';
import { canonicalJson } from '../src/lib/hash';
import type { GameState, ID } from '../src/sim/types';

const registry = getCommodityRegistry();
const world = getWorldRegistry();

function fresh(seed: string, name = 'Sim Tester'): GameState {
  return createNewGame({ userId: 'sim-user', playerName: name, seed }).state;
}

/** Every commodity any market anywhere will actually trade. */
function reachableCommodities(): Map<ID, number> {
  const counts = new Map<ID, number>();
  for (const location of world.locations) {
    for (const id of location.tradedCommodityIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* Catalogue reachability                                              */
/* ------------------------------------------------------------------ */

describe('market coverage', () => {
  it('leaves no tradeable commodity without a market', () => {
    const coverage = world.coverage();
    // The orphan list is reported in full so a failure names the goods, not a count.
    expect(coverage.unreachable.map((c) => c.id)).toEqual([]);
    expect(coverage.reachable).toBe(coverage.commodities);
  });

  it('keeps scarcity meaningful instead of stocking the catalogue everywhere', () => {
    const counts = reachableCommodities();
    const markets = world.locations.length;

    // A handful of genuine staples and fuels is universal, and that is correct:
    // every city sells water, flour, tinned food, diesel and petrol. What is *not*
    // acceptable is universality leaking beyond them — a scarce, restricted or
    // illegal good that trades everywhere has no regional economy left to trade in.
    const universal = [...counts.entries()].filter(([, n]) => n === markets).map(([id]) => id);
    expect(universal.length).toBeLessThan(counts.size * 0.02);
    for (const id of universal) {
      const c = registry.get(id)!;
      expect(c.legality, `${id} must not be universal`).toBe('legal');
      expect(c.rarity, `${id} must be a common good to be universal`).toBeLessThanOrEqual(2);
      expect(['energy', 'foodstuff', 'agriculture'], `${id} category ${c.category}`).toContain(c.category);
    }

    // The long tail stays genuinely local…
    const scarce = [...counts.values()].filter((n) => n <= 2).length;
    expect(scarce).toBeGreaterThan(20);
    // …and the bulk of the catalogue trades in several markets, not one.
    const spread = [...counts.values()].filter((n) => n >= 3).length;
    expect(spread).toBeGreaterThan(counts.size * 0.5);

    // Nothing restricted, illegal or contraband may be near-universal either.
    const nearUniversal = [...counts.entries()].filter(([, n]) => n >= markets - 3).map(([id]) => registry.get(id)!);
    for (const c of nearUniversal) expect(c.legality).toBe('legal');
  });

  it('keeps a market readable', () => {
    const sizes = world.locations.map((l) => l.tradedCommodityIds.length);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(20);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(160);
  });

  it('gives each location a roster shaped by what that location is', () => {
    const categoryMix = (locationId: ID): Record<string, number> => {
      const mix: Record<string, number> = {};
      const location = world.location(locationId)!;
      for (const id of location.tradedCommodityIds) {
        const category = registry.get(id)?.category ?? 'unknown';
        mix[category] = (mix[category] ?? 0) + 1;
      }
      return mix;
    };
    const financial = world.locations.find((l) => l.kind === 'financial_center')!;
    const rural = world.locations.find((l) => l.kind === 'rural')!;
    const finMix = categoryMix(financial.id);
    const ruralMix = categoryMix(rural.id);

    // A financial centre deals in paper, tech and luxury; a farming town in crops.
    expect(finMix['financial_asset'] ?? 0).toBeGreaterThan(ruralMix['financial_asset'] ?? 0);
    expect(finMix['luxury'] ?? 0).toBeGreaterThan(ruralMix['luxury'] ?? 0);
    expect(ruralMix['agriculture'] ?? 0).toBeGreaterThan(finMix['agriculture'] ?? 0);
    expect(ruralMix['livestock'] ?? 0).toBeGreaterThan(finMix['livestock'] ?? 0);

    // And the two cities do not carry the same shelf.
    const fin = new Set(financial.tradedCommodityIds);
    const ruralIds = new Set(rural.tradedCommodityIds);
    const shared = [...fin].filter((id) => ruralIds.has(id)).length;
    expect(shared / Math.min(fin.size, ruralIds.size)).toBeLessThan(0.5);
  });

  it('composes the same world on every rebuild', () => {
    // The composition is a pure function of the catalogue, so two registries built in
    // the same process must agree; a save loaded tomorrow must see the same markets.
    const again = new (world.constructor as new () => typeof world)();
    const a = world.locations.map((l) => `${l.id}:${l.tradedCommodityIds.join(',')}`).join('|');
    const b = again.locations.map((l) => `${l.id}:${l.tradedCommodityIds.join(',')}`).join('|');
    expect(b).toBe(a);
  });

  it('never openly trades a good the jurisdiction bans', () => {
    for (const location of world.locations) {
      for (const id of location.tradedCommodityIds) {
        const commodity = registry.get(id)!;
        const tolerated = world.isTolerated(location.id, commodity);
        if (tolerated) continue;
        // Untolerated goods may appear only as hidden-channel lines, which the trade
        // permission is what enforces.
        const state = fresh('channel-check');
        state.player.locationId = location.id;
        const permission = tradePermission(state, location.id, commodity);
        expect(permission.channel).not.toBe('open');
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* Cross-system coherence                                              */
/* ------------------------------------------------------------------ */

describe('cross-system coherence', () => {
  it('lets every production recipe be fed and sold', () => {
    const reachable = reachableCommodities();
    const broken: string[] = [];
    for (const recipe of RECIPES) {
      for (const input of recipe.inputs) {
        if (!reachable.has(input.commodityId)) broken.push(`${recipe.id} needs ${input.commodityId}`);
      }
      for (const output of recipe.outputs) {
        if (!reachable.has(output.commodityId)) broken.push(`${recipe.id} produces unsellable ${output.commodityId}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('keeps every mission objective achievable with goods that trade somewhere', () => {
    const reachable = reachableCommodities();
    const referenced = new Set<string>();
    for (const mission of MISSIONS) {
      const json = JSON.stringify(mission);
      for (const commodity of registry.all()) {
        if (json.includes(`"${commodity.id}"`)) referenced.add(commodity.id);
      }
    }
    const stranded = [...referenced].filter((id) => !reachable.has(id));
    expect(stranded).toEqual([]);
  });

  it('hands a new player a position their own container can hold', () => {
    // The starting grant is the first thing every player touches: goods they cannot
    // legally store are a trap at the door, and they surfaced only once the market
    // composer stopped excluding every scarce and processed good.
    for (const seed of ['starter-a', 'starter-b', 'starter-c', 'starter-d', 'starter-e']) {
      const state = fresh(seed);
      const storage = state.player.storages[0]!;
      for (const stack of state.player.inventory) {
        const commodity = registry.get(stack.commodityId)!;
        if (commodity.storage === 'refrigerated') expect(storage.refrigerated).toBe(true);
        if (commodity.storage === 'hazardous') expect(storage.kind).not.toBe('personal');
        if (commodity.storage === 'secure') expect(storage.security).toBeGreaterThanOrEqual(0.5);
      }
      // …and the market that gave it to them can buy it back.
      const row = marketRows(state, state.player.locationId, { onlyTradable: true }).find(
        (r) => r.commodityId === state.player.inventory[0]!.commodityId,
      );
      expect(row).toBeDefined();
      expect(row!.tradable).toBe(true);
    }
  });

  it('explains every price it charges', () => {
    const state = fresh('drivers');
    const rows = marketRows(state, state.player.locationId, { onlyTradable: true, limit: 25 });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.drivers.length).toBeGreaterThan(0);
      for (const driver of row.drivers) {
        expect(Number.isFinite(driver.contributionPct)).toBe(true);
        expect(driver.label.length).toBeGreaterThan(0);
      }
      expect(row.ask).toBeGreaterThan(0);
      expect(row.bid).toBeLessThanOrEqual(row.ask);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Determinism                                                         */
/* ------------------------------------------------------------------ */

describe('determinism', () => {
  /** A short scripted session: the same commands, in the same order, every time. */
  function playSession(state: GameState, seed: string): GameState {
    const commands: ActionIntent[] = [
      { type: 'time.advance_days', days: 3 } as ActionIntent,
      { type: 'crew.refresh_pool' } as ActionIntent,
      { type: 'time.advance_days', days: 5 } as ActionIntent,
    ];
    for (const command of commands) {
      dispatch(state, new Rng(`${seed}:script`, 'test'), command, { userId: state.userId });
    }
    advanceDays(state, new Rng(`${seed}:days`, 'test'), 12);
    return state;
  }

  it('produces an identical world from an identical starting state', () => {
    const a = playSession(fresh('determinism'), 'determinism');
    const b = playSession(fresh('determinism'), 'determinism');

    expect(b.world.day).toBe(a.world.day);
    expect(totalBalance(b.player)).toBe(totalBalance(a.player));
    expect(b.world.inflationRate).toBe(a.world.inflationRate);
    expect(b.world.indicators.cyclePhaseLabel).toBe(a.world.indicators.cyclePhaseLabel);
    expect(JSON.stringify(b.world.news.map((n) => n.headline))).toBe(JSON.stringify(a.world.news.map((n) => n.headline)));

    // Every market both saves happened to touch must agree to the cent.
    const keys = Object.keys(a.markets).sort();
    expect(keys.length).toBeGreaterThan(0);
    expect(Object.keys(b.markets).sort()).toEqual(keys);
    for (const key of keys) {
      expect(b.markets[key]!.price).toBe(a.markets[key]!.price);
      expect(b.markets[key]!.supply).toBe(a.markets[key]!.supply);
      expect(b.markets[key]!.demand).toBe(a.markets[key]!.demand);
    }
  });

  it('diverges when the seed changes, so the world is not a constant', () => {
    const a = playSession(fresh('seed-one'), 'shared');
    const b = playSession(fresh('seed-two'), 'shared');
    const aPrices = Object.keys(a.markets).sort().map((k) => a.markets[k]!.price);
    const bPrices = Object.keys(b.markets).sort().map((k) => b.markets[k]!.price);
    expect(bPrices).not.toEqual(aPrices);
  });

  it('makes the same command twice with different streams where it should', () => {
    // Trades carry randomness (counterparty depth, quality); the same trade on a
    // different turn must be able to differ, or the world would be a slideshow.
    const state = fresh('action-streams');
    creditCash(state, 500_000, { kind: 'adjustment', description: 'test capital' });
    const commodity = state.player.inventory[0]!.commodityId;
    const first = dispatch(state, rngForAction(state, 'trade.buy'), { type: 'trade.buy', commodityId: commodity, qty: 1 } as ActionIntent, { userId: state.userId });
    const second = dispatch(state, rngForAction(state, 'trade.buy'), { type: 'trade.buy', commodityId: commodity, qty: 1 } as ActionIntent, { userId: state.userId });
    expect(first.ok || second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect((first.data as { quote?: { effectiveUnitPrice: number } }).quote?.effectiveUnitPrice)
        .not.toBe((second.data as { quote?: { effectiveUnitPrice: number } }).quote?.effectiveUnitPrice);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Save / restore round trip                                           */
/* ------------------------------------------------------------------ */

/**
 * The parts of a state that must be reproducible under replay. `updatedAt` and the
 * per-phase `ms` diagnostics are wall-clock observations, not simulation results.
 */
function comparable(state: GameState): unknown {
  return {
    ...state,
    updatedAt: null,
    diagnostics: state.diagnostics.map((d) => ({ ...d, message: d.message.replace(/ in \d+ ms/, ''), data: undefined })),
  };
}

describe('save and restore replay', () => {
  it('resumes a restored save identically to the run it came from', () => {
    const original = fresh('restore-replay');
    creditCash(original, 250_000, { kind: 'adjustment', description: 'test capital' });
    advanceDays(original, new Rng('restore:pre', 'test'), 6);

    // Everything the save system promises to carry: the whole document, sealed.
    const sealed = serializeState(original);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    const reopened = deserializeState(sealed.value.json, { expectedHash: sealed.value.integrityHash });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const restored = reopened.value;
    expect(restored.world.day).toBe(original.world.day);
    expect(totalBalance(restored.player)).toBe(totalBalance(original.player));

    // From here on the two must be indistinguishable under identical input.
    const originalRng = new Rng('restore:post', 'test');
    const restoredRng = new Rng('restore:post', 'test');
    advanceDays(original, originalRng, 15);
    advanceDays(restored, restoredRng, 15);

    // Compare the *whole* document, not a few sampled fields: the divergence this
    // test was written to catch was invisible in any single number and only showed
    // up as the macro world drifting a day later.
    //
    // Two things are legitimately not reproducible and are excluded: the save
    // timestamp and the wall-clock duration recorded in per-phase diagnostics.
    expect(canonicalJson(comparable(restored))).toBe(canonicalJson(comparable(original)));
    expect(validateState(restored).filter((i) => i.severity === 'error')).toEqual([]);
    expect(restored.world.inflationRate).toBe(original.world.inflationRate);
  });
});

/* ------------------------------------------------------------------ */
/* Invariants over a long run                                          */
/* ------------------------------------------------------------------ */

describe('simulation invariants', () => {
  it('survives a long run without corrupting a single promise it makes', () => {
    const state = fresh('invariants-long');
    creditCash(state, 2_000_000, { kind: 'adjustment', description: 'test capital' });
    advanceDays(state, new Rng('invariants:run', 'test'), 200);

    const cash = totalBalance(state.player);
    expect(Number.isFinite(cash)).toBe(true);
    expect(cash).toBeGreaterThanOrEqual(0);

    for (const account of state.player.accounts) {
      expect(Number.isFinite(account.balance)).toBe(true);
      expect(account.balance).toBeGreaterThanOrEqual(0);
    }
    for (const stack of state.player.inventory) {
      expect(stack.qty).toBeGreaterThan(0);
      expect(Number.isFinite(stack.avgCost)).toBe(true);
    }
    // Debt never silently disappears: every loan is still a loan.
    for (const loan of state.player.loans) {
      expect(Number.isFinite(loan.balance)).toBe(true);
      expect(loan.balance).toBeGreaterThanOrEqual(0);
    }
    expect(state.player.stats.actionsToday).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(state.world.inflationRate)).toBe(true);

    // Prices stay inside the engine's own bounds — no runaway, no zero, no NaN.
    for (const [key, market] of Object.entries(state.markets)) {
      expect(Number.isFinite(market.price), `${key} price`).toBe(true);
      expect(market.price).toBeGreaterThan(0);
      expect(market.price).toBeLessThan(1e9);
      expect(market.supply).toBeGreaterThanOrEqual(0);
      expect(market.demand).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(market.supply), `${key} supply`).toBe(true);
    }

    // Identifiers are unique — a duplicated holding or ledger row would double-count.
    const stacks = state.player.inventory.map((s) => s.id);
    expect(new Set(stacks).size).toBe(stacks.length);
    const ledgerIds = state.player.recentTransactions.map((entry) => entry.id);
    expect(new Set(ledgerIds).size).toBe(ledgerIds.length);

    expect(validateState(state).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('never lets production consume an input the run does not have', () => {
    const state = fresh('production-inputs');
    creditCash(state, 1_000_000, { kind: 'adjustment', description: 'test capital' });
    advanceDays(state, new Rng('production:run', 'test'), 60);
    for (const line of state.player.productionLines) {
      for (const [commodityId, qty] of Object.entries(line.inputs)) {
        expect(Number.isFinite(qty), `${line.id} buffer ${commodityId}`).toBe(true);
        expect(qty).toBeGreaterThanOrEqual(0);
      }
      expect(line.totalProduced).toBeGreaterThanOrEqual(0);
      expect(line.totalWaste).toBeGreaterThanOrEqual(0);
    }
    expect(validateState(state).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('refuses to spend money the player does not have, however the command is phrased', () => {
    const state = fresh('no-free-money');
    const commodity = marketRows(state, state.player.locationId, { onlyTradable: true })[0]!;
    // Try to buy far more than the purse can pay, at any size the client cares to claim.
    const cash = totalBalance(state.player);
    const before = totalBalance(state.player);
    const attempt = dispatch(state, rngForAction(state, 'overbuy'), {
      type: 'trade.buy',
      commodityId: commodity.commodityId,
      qty: Math.max(1, Math.floor(cash / Math.max(1, commodity.ask)) * 4),
    } as ActionIntent, { userId: state.userId });
    const after = totalBalance(state.player);
    expect(after).toBeGreaterThanOrEqual(0);
    expect(after).toBeLessThanOrEqual(before + 1e-6);
    if (attempt.ok) {
      const quote = (attempt.data as { quote?: { qty: number; effectiveUnitPrice: number; fees: { amount: number }[] } }).quote!;
      const paid = quote.effectiveUnitPrice * quote.qty + quote.fees.reduce((sum, fee) => sum + fee.amount, 0);
      expect(before - after).toBeCloseTo(paid, 4);
    }
  });
});
