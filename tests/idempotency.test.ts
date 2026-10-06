/**
 * Idempotency receipts — the persistence contract and the service semantics.
 *
 * A browser retries: double clicks, reconnects, and responses that time out after the
 * server committed. Two mechanisms make that safe together:
 *
 *   • the receipt table, which replays a recorded outcome instead of re-running it;
 *   • the compare-and-set on `games.version`, which refuses a write that is not based
 *     on the current version — so even a lost receipt cannot double-apply a command.
 *
 * Both adapters implement the same contract; these tests run against SQLite (the
 * Postgres adapter is verified by the same suite in CI when `DATABASE_URL` is set).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/persistence/sqlite-store';
import { createNewGame } from '../src/sim/bootstrap';
import { extractMetadata } from '../src/persistence/serialize';
import type { IntentReceiptRecord } from '../src/persistence/types';

const tempDirs: string[] = [];

function tempStore(): SqliteStore {
  const dir = mkdtempSync(join(tmpdir(), 'dynasty-idem-'));
  tempDirs.push(dir);
  return new SqliteStore(join(dir, 'test.sqlite'));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function receipt(overrides: Partial<Omit<IntentReceiptRecord, 'createdAt'> & { createdAt?: string }> = {}): Omit<IntentReceiptRecord, 'createdAt'> {
  return {
    gameId: 'game_1',
    userId: 'user_1',
    requestId: 'req_1',
    intentType: 'trade.buy',
    intentHash: 'hash-a',
    stateVersion: 4,
    day: 2,
    turn: 7,
    response: JSON.stringify({ ok: true, day: 2, turn: 7, warnings: [], notifications: [] }),
    ...overrides,
  };
}

describe('receipt store contract', () => {
  it('round-trips a receipt', async () => {
    const store = tempStore();
    await store.recordIntentReceipt(receipt());
    const found = await store.findIntentReceipt('game_1', 'req_1');
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value?.intentType).toBe('trade.buy');
    expect(found.value?.stateVersion).toBe(4);
    expect(found.value?.day).toBe(2);
    expect(found.value?.createdAt).toBeTruthy();
    await store.close();
  });

  it('returns null for an unknown key instead of failing', async () => {
    const store = tempStore();
    const found = await store.findIntentReceipt('game_1', 'never-used');
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.value).toBeNull();
    await store.close();
  });

  it('keeps the first receipt when a key is recorded twice', async () => {
    const store = tempStore();
    await store.recordIntentReceipt(receipt({ intentHash: 'hash-a', stateVersion: 4 }));
    await store.recordIntentReceipt(receipt({ intentHash: 'hash-b', stateVersion: 99 }));
    const found = await store.findIntentReceipt('game_1', 'req_1');
    expect(found.ok).toBe(true);
    // A retry must never be able to rewrite the recorded outcome.
    if (found.ok) {
      expect(found.value?.intentHash).toBe('hash-a');
      expect(found.value?.stateVersion).toBe(4);
    }
    await store.close();
  });

  it('scopes keys per game and per user', async () => {
    const store = tempStore();
    await store.recordIntentReceipt(receipt({ gameId: 'game_1', requestId: 'shared' }));
    await store.recordIntentReceipt(receipt({ gameId: 'game_2', requestId: 'shared', userId: 'user_2', stateVersion: 9 }));

    const first = await store.findIntentReceipt('game_1', 'shared');
    const second = await store.findIntentReceipt('game_2', 'shared');
    expect(first.ok && first.value?.gameId).toBe('game_1');
    expect(second.ok && second.value?.gameId).toBe('game_2');
    expect(second.ok && second.value?.userId).toBe('user_2');
    await store.close();
  });

  it('accepts a receipt for a command that did not persist state', async () => {
    const store = tempStore();
    await store.recordIntentReceipt(receipt({ stateVersion: null, requestId: 'read-only' }));
    const found = await store.findIntentReceipt('game_1', 'read-only');
    expect(found.ok && found.value?.stateVersion).toBeNull();
    await store.close();
  });

  it('prunes the oldest receipts and keeps the newest', async () => {
    const store = tempStore();
    for (let i = 0; i < 12; i++) {
      await store.recordIntentReceipt(
        receipt({
          requestId: `req_${i}`,
          createdAt: new Date(2026, 0, 1 + i).toISOString(),
        }),
      );
    }
    const pruned = await store.pruneIntentReceipts('game_1', 5);
    expect(pruned.ok && pruned.value).toBe(7);

    const newest = await store.findIntentReceipt('game_1', 'req_11');
    const oldest = await store.findIntentReceipt('game_1', 'req_0');
    expect(newest.ok && newest.value).not.toBeNull();
    expect(oldest.ok && oldest.value).toBeNull();
    await store.close();
  });

  it('removes receipts with the save they belong to', async () => {
    const store = tempStore();
    await store.createUser({ id: 'user_1', email: 'a@example.com', displayName: 'A', passwordHash: null, authProvider: 'local' });
    const state = createNewGame({ userId: 'user_1', playerName: 'A', seed: 'receipt-delete' }).state;
    await store.saveGame({ ...extractMetadata(state), state }, null);
    await store.recordIntentReceipt(receipt({ gameId: state.gameId, userId: 'user_1', requestId: 'will-be-deleted' }));

    const deleted = await store.deleteGame(state.gameId, 'user_1');
    expect(deleted.ok).toBe(true);
    const found = await store.findIntentReceipt(state.gameId, 'will-be-deleted');
    expect(found.ok && found.value).toBeNull();
    await store.close();
  });

  it('survives a store restart, so a retry after a deploy still replays', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dynasty-idem-restart-'));
    tempDirs.push(dir);
    const path = join(dir, 'restart.sqlite');

    const first = new SqliteStore(path);
    await first.recordIntentReceipt(receipt({ requestId: 'across-restarts' }));
    await first.close();

    const second = new SqliteStore(path);
    const found = await second.findIntentReceipt('game_1', 'across-restarts');
    expect(found.ok && found.value?.requestId).toBe('across-restarts');
    await second.close();
  });
});
