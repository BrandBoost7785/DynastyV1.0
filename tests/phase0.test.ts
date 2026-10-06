/**
 * Phase 0 regressions: production blockers, data integrity, exploit removal and
 * request-safety fixes. These tests exercise real engine/persistence code paths;
 * no hash verifier or simulation module is mocked.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digestHex } from '../src/lib/hash';
import { SqliteStore } from '../src/persistence/sqlite-store';
import { CURRENT_SCHEMA_VERSION, deserializeState, extractMetadata, serializeState } from '../src/persistence/serialize';
import { dispatch } from '../src/sim/actions';
import { createNewGame } from '../src/sim/bootstrap';
import { canStore, capacityOf, quantityOnHand } from '../src/sim/inventory';
import { buyVehicle, planShipment } from '../src/sim/logistics';
import { marketRows } from '../src/sim/markets';
import { prestige, grantXp } from '../src/sim/progression';
import { advanceDay, rngForAction, rngForDay } from '../src/sim/tick';
import { planTravel } from '../src/sim/travel';
import { parseIntent } from '../src/sim/validation';
import { computeNetWorth, creditCash, totalBalance, validateState, verifyTransactionChain } from '../src/sim/state';
import { getCommodityRegistry, getWorldRegistry } from '../src/engine/registry';
import type { GameState, TransactionRecord } from '../src/sim/types';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function fresh(seed: string, userId = 'phase0-user'): GameState {
  return createNewGame({ userId, playerName: 'Phase Zero', seed }).state;
}

function cloneState<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function addTransactions(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) {
    creditCash(state, 1, { kind: 'adjustment', description: `tx-${i}`, day: state.world.day });
  }
}

function tempStore(): SqliteStore {
  const dir = mkdtempSync(join(tmpdir(), 'dynasty-phase0-'));
  tempDirs.push(dir);
  return new SqliteStore(join(dir, 'test.sqlite'));
}

function recordFor(state: GameState, reason?: string) {
  return { ...extractMetadata(state), state, reason };
}

function oldLedgerHash(prev: string, t: TransactionRecord): string {
  return digestHex([
    prev,
    t.day,
    t.turn,
    t.kind,
    t.amount.toFixed(2),
    t.balanceAfter.toFixed(2),
    t.accountId ?? '-',
    t.description,
    t.counterparty ?? '-',
    t.commodityId ?? '-',
    t.qty ?? '-',
    t.unitPrice ?? '-',
    t.locationId ?? '-',
  ].join('|'));
}

function asLegacyV1(state: GameState): GameState {
  const legacy = cloneState(state) as GameState & { player: GameState['player'] & { transactionChain?: unknown } };
  legacy.schemaVersion = 1;
  delete (legacy.player as { transactionChain?: unknown }).transactionChain;
  legacy.player.recentTransactions.forEach((t, i, all) => {
    delete (t as Partial<TransactionRecord>).seq;
    delete (t as Partial<TransactionRecord>).prevHash;
    t.integrityHash = oldLedgerHash(i === 0 ? 'genesis' : all[i - 1]!.integrityHash, t);
  });
  return legacy;
}

describe('transaction-chain retention and save/load integrity', () => {
  for (const count of [0, 100, 300, 1000]) {
    it(`saves and loads a real game after ${count} transactions`, async () => {
      const store = tempStore();
      await store.createUser({ id: 'phase0-user', email: `${count}@example.test`, displayName: 'Phase Zero', passwordHash: null, authProvider: 'local' });
      const state = fresh(`phase0-chain-${count}`);
      addTransactions(state, count);

      const check = verifyTransactionChain(state.player.recentTransactions, state.player.transactionChain);
      expect(check.ok).toBe(true);
      expect(validateState(state).filter((i) => i.severity === 'error')).toHaveLength(0);
      expect(state.player.transactionChain.evictedCount).toBe(Math.max(0, count - 240));

      const saved = await store.saveGame(recordFor(state, `chain-${count}`), null);
      expect(saved.ok).toBe(true);
      const loaded = await store.loadGame(state.gameId, state.userId);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      expect(loaded.value.state.player.recentTransactions).toHaveLength(Math.min(count, 240));
      expect(loaded.value.state.player.transactionChain.evictedCount).toBe(Math.max(0, count - 240));
      expect(totalBalance(loaded.value.state.player)).toBe(totalBalance(state.player));
      await store.close();
    });
  }

  it('detects altered, reordered, duplicated, deleted and anchor-corrupted retained records', () => {
    const state = fresh('phase0-chain-tamper');
    addTransactions(state, 320);

    const cases: [string, (s: GameState) => void][] = [
      ['altered amount', (s) => { s.player.recentTransactions[3]!.amount += 1; }],
      ['reordered records', (s) => { const a = s.player.recentTransactions[2]!; s.player.recentTransactions[2] = s.player.recentTransactions[3]!; s.player.recentTransactions[3] = a; }],
      ['duplicated record', (s) => { s.player.recentTransactions[9] = cloneState(s.player.recentTransactions[8]!); }],
      ['deleted record', (s) => { s.player.recentTransactions.splice(5, 1); }],
      ['corrupt anchor', (s) => { s.player.transactionChain.anchorHash = 'deadbeefdeadbeef'; }],
    ];

    for (const [label, mutate] of cases) {
      const tampered = cloneState(state);
      mutate(tampered);
      const sealed = serializeState(tampered);
      expect(sealed.ok, label).toBe(true);
      if (!sealed.ok) continue;
      const loaded = deserializeState(sealed.value.json, { expectedHash: sealed.value.integrityHash });
      expect(loaded.ok, label).toBe(false);
      if (!loaded.ok) expect(loaded.code).toBe('validation_failed');
    }
  });

  it('handles an empty history and preserves state over repeated save/load cycles', () => {
    let state = fresh('phase0-empty-chain');
    const before = totalBalance(state.player);
    for (let i = 0; i < 3; i++) {
      const sealed = serializeState(state);
      expect(sealed.ok).toBe(true);
      if (!sealed.ok) return;
      const loaded = deserializeState(sealed.value.json, { expectedHash: sealed.value.integrityHash });
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      state = loaded.value;
    }
    expect(state.player.recentTransactions).toHaveLength(0);
    expect(state.player.transactionChain.evictedCount).toBe(0);
    expect(totalBalance(state.player)).toBe(before);
  });

  it('migrates valid schema-1 ledgers and refuses corrupted legacy ledgers without mutating the active state', () => {
    const state = fresh('phase0-legacy');
    addTransactions(state, 12);
    const activeBefore = serializeState(state);
    expect(activeBefore.ok).toBe(true);

    const legacy = asLegacyV1(state);
    const sealed = serializeState(legacy);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    const migrated = deserializeState(sealed.value.json, { expectedHash: sealed.value.integrityHash });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.value.player.transactionChain.reanchoredFromSchema).toBe(1);
    expect(verifyTransactionChain(migrated.value.player.recentTransactions, migrated.value.player.transactionChain).ok).toBe(true);

    legacy.player.recentTransactions[1]!.amount += 99;
    const corrupt = serializeState(legacy);
    expect(corrupt.ok).toBe(true);
    if (!corrupt.ok) return;
    const refused = deserializeState(corrupt.value.json, { expectedHash: corrupt.value.integrityHash });
    expect(refused.ok).toBe(false);
    expect(serializeState(state)).toEqual(activeBefore);
  });
});

describe('prestige exploit removal', () => {
  it('rejects prestige below threshold and invalid numeric values', () => {
    const state = fresh('phase0-prestige-reject');
    expect(prestige(state).ok).toBe(false);
    state.player.progression.legacyBonus = Number.POSITIVE_INFINITY;
    expect(validateState(state).some((i) => i.path === 'progression.legacyBonus')).toBe(true);
  });

  it('applies one atomic estate handover, caps repeated rewards and survives save/load', () => {
    const state = fresh('phase0-prestige-success');
    creditCash(state, 30_000_000, { kind: 'adjustment', description: 'capital' });
    const beforeWorth = computeNetWorth(state).total;
    const first = prestige(state);
    expect(first.ok).toBe(true);
    expect(state.player.progression.prestigeCount).toBe(1);
    expect(state.player.progression.legacyBonus).toBe(0.06);
    expect(computeNetWorth(state).total).toBeLessThan(beforeWorth * 0.01);
    expect(grantXp(state, 1000, 'after prestige').granted).toBe(1060);

    const blocked = prestige(state);
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe('too_soon');
    expect(state.player.progression.legacyBonus).toBe(0.06);

    const sealed = serializeState(state);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    const restored = deserializeState(sealed.value.json, { expectedHash: sealed.value.integrityHash });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.player.progression.prestigeCount).toBe(1);
    expect(restored.value.player.progression.legacyBonus).toBe(0.06);
  });

  it('does not double-award duplicate prestige requests', () => {
    const state = fresh('phase0-prestige-dispatch');
    creditCash(state, 30_000_000, { kind: 'adjustment', description: 'capital' });
    const a = dispatch(state, rngForAction(state, 'prestige-a'), { type: 'progression.prestige' }, { userId: state.userId });
    const b = dispatch(state, rngForAction(state, 'prestige-b'), { type: 'progression.prestige' }, { userId: state.userId });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(state.player.progression.prestigeCount).toBe(1);
    expect(state.player.progression.legacyBonus).toBe(0.06);
  });
});

describe('starting capacity, first trade and deterministic smoke flow', () => {
  it('creates a valid starter inventory and permits a first legal purchase through the authoritative dispatcher', () => {
    const a = fresh('phase0-first-trade');
    const b = fresh('phase0-first-trade');
    for (const state of [a, b]) {
      expect(validateState(state).filter((i) => i.severity === 'error')).toHaveLength(0);
      const personal = state.player.storages.find((s) => s.kind === 'personal')!;
      const usage = capacityOf(state, personal);
      expect(usage.kg).toBeLessThanOrEqual(usage.kgCapacity);
      expect(usage.litres).toBeLessThanOrEqual(usage.litresCapacity);

      const registry = getCommodityRegistry();
      const row = marketRows(state, state.player.locationId, { onlyTradable: true }).find((r) => {
        const c = registry.get(r.commodityId);
        return c !== undefined && r.ask > 0 && r.ask < totalBalance(state.player) && canStore(state, personal.id, c, 1).ok;
      });
      expect(row).toBeDefined();
      if (!row) return;
      const beforeCash = totalBalance(state.player);
      const beforeQty = quantityOnHand(state, row.commodityId, state.player.locationId);
      const parsed = parseIntent({ type: 'trade.buy', commodityId: row.commodityId, qty: 1, price: 0, profit: 999_999, xp: 999 });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const result = dispatch(state, rngForAction(state, 'first-buy'), parsed.intent, { userId: state.userId });
      expect(result.ok).toBe(true);
      expect(totalBalance(state.player)).toBeLessThan(beforeCash);
      expect(quantityOnHand(state, row.commodityId, state.player.locationId)).toBe(beforeQty + 1);

      const cashAfterBuy = totalBalance(state.player);
      const sell = dispatch(state, rngForAction(state, 'first-sell'), { type: 'trade.sell', commodityId: row.commodityId, qty: 1 }, { userId: state.userId });
      expect(sell.ok).toBe(true);
      expect(totalBalance(state.player)).toBeGreaterThan(cashAfterBuy);
      expect(quantityOnHand(state, row.commodityId, state.player.locationId)).toBe(beforeQty);

      const invalid = dispatch(state, rngForAction(state, 'invalid-buy'), { type: 'trade.buy', commodityId: 'not-a-commodity', qty: 1 }, { userId: state.userId });
      expect(invalid.ok).toBe(false);
      expect(quantityOnHand(state, row.commodityId, state.player.locationId)).toBe(beforeQty);
    }
    expect(totalBalance(a.player)).toBe(totalBalance(b.player));
    expect(a.player.inventory.map((s) => [s.commodityId, s.qty])).toEqual(b.player.inventory.map((s) => [s.commodityId, s.qty]));
  });

  it('rejects a genuine capacity overflow and preserves invariants over save/load after trade', () => {
    const state = fresh('phase0-capacity-overflow');
    const personal = state.player.storages.find((s) => s.kind === 'personal')!;
    const registry = getCommodityRegistry();
    const row = marketRows(state, state.player.locationId, { onlyTradable: true }).find((r) => {
      const c = registry.get(r.commodityId);
      return c && canStore(state, personal.id, c, 1).ok;
    })!;
    const c = registry.get(row.commodityId)!;
    expect(canStore(state, personal.id, c, 1_000_000).ok).toBe(false);
    const sealed = serializeState(state);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    const loaded = deserializeState(sealed.value.json, { expectedHash: sealed.value.integrityHash });
    expect(loaded.ok).toBe(true);
  });
});

describe('travel/shipment planning contract', () => {
  it('returns success plans without failure reasons and failures with useful reasons', () => {
    const state = fresh('phase0-plan-contracts');
    creditCash(state, 5_000_000, { kind: 'adjustment', description: 'capital' });
    const world = getWorldRegistry();
    const destination = world.neighboursOf(state.player.locationId).map((n) => n.other).find((l) => !l.hidden)!;
    const travel = planTravel(state, destination.id, 'bus');
    expect(travel.ok).toBe(true);
    expect(travel.reason).toBeUndefined();
    const badTravel = planTravel(state, 'not-a-location', 'bus');
    expect(badTravel.ok).toBe(false);
    expect(badTravel.reason).toMatch(/Unknown/);

    buyVehicle(state, rngForDay(state, 1), 'panel_van');
    const registry = getCommodityRegistry();
    const row = marketRows(state, state.player.locationId, { onlyTradable: true }).find((r) => {
      const c = registry.get(r.commodityId);
      return c && r.ask > 0 && c.weightKg < 3 && c.volumeL < 10;
    })!;
    const buy = dispatch(state, rngForAction(state, 'shipment-buy'), { type: 'trade.buy', commodityId: row.commodityId, qty: 2 }, { userId: state.userId });
    expect(buy.ok).toBe(true);
    const shipment = planShipment(state, destination.id, 'truck', [{ commodityId: row.commodityId, qty: 1 }]);
    expect(shipment.ok).toBe(true);
    expect(shipment.reason).toBeUndefined();
    const badShipment = planShipment(state, state.player.locationId, 'truck', [{ commodityId: row.commodityId, qty: 1 }]);
    expect(badShipment.ok).toBe(false);
    expect(badShipment.reason).toContain('current location');
  });
});

describe('bounded long simulation and request safety', () => {
  it('keeps invariants and loadable checkpoints through a 300-day run', () => {
    const state = fresh('phase0-long-run');
    addTransactions(state, 320);
    for (let day = 1; day <= 300; day++) {
      advanceDay(state, rngForDay(state, state.world.day + 1));
      if (day % 60 === 0) {
        expect(validateState(state).filter((i) => i.severity === 'error')).toHaveLength(0);
        const sealed = serializeState(state);
        expect(sealed.ok).toBe(true);
        if (!sealed.ok) return;
        const loaded = deserializeState(sealed.value.json, { expectedHash: sealed.value.integrityHash });
        expect(loaded.ok).toBe(true);
      }
    }
  });

  it('rejects interactive advances above the configured request bound', () => {
    expect(parseIntent({ type: 'time.advance_days', days: 30 }).ok).toBe(true);
    expect(parseIntent({ type: 'time.advance_days', days: 31 }).ok).toBe(false);
  });
});
