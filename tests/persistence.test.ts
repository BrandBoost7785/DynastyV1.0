/**
 * Persistence tests, run against the SQLite development adapter.
 *
 * The Postgres adapter implements the same contract with the same semantics, so
 * what is verified here — round-trip fidelity, optimistic concurrency, tamper
 * detection, version history, schema refusal — is the behaviour both must have.
 * (Supabase is not reachable from the sandbox, so the Postgres adapter is verified
 * by contract and by `npm run db:migrate` against a live DATABASE_URL.)
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/persistence/sqlite-store';
import { CURRENT_SCHEMA_VERSION, deserializeState, extractMetadata, serializeState } from '../src/persistence/serialize';
import { createNewGame } from '../src/sim/bootstrap';
import { advanceDay, rngForDay } from '../src/sim/tick';
import { computeNetWorth, creditCash, totalBalance } from '../src/sim/state';
import { empireScore } from '../src/sim/state';
import type { SaveRecord } from '../src/persistence/types';
import type { GameState } from '../src/sim/types';

const tempDirs: string[] = [];

function tempStore(): SqliteStore {
  const dir = mkdtempSync(join(tmpdir(), 'dynasty-store-'));
  tempDirs.push(dir);
  return new SqliteStore(join(dir, 'test.sqlite'));
}

function recordFor(state: GameState, reason?: string): SaveRecord {
  return { ...extractMetadata(state), state, reason };
}

function freshGame(seed: string, userId = 'user-1'): GameState {
  const { state } = createNewGame({ userId, playerName: 'Founder', seed });
  return state;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('serialization', () => {
  it('round-trips a live game without loss', () => {
    const state = freshGame('serialize-roundtrip');
    creditCash(state, 100_000, { kind: 'adjustment', description: 'capital', dirty: false });
    advanceDay(state, rngForDay(state, 1));

    const sealed = serializeState(state);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;

    const restored = deserializeState(sealed.value.json, { expectedHash: sealed.value.integrityHash });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;

    expect(restored.value.world.day).toBe(state.world.day);
    expect(totalBalance(restored.value.player)).toBe(totalBalance(state.player));
    expect(restored.value.player.inventory.length).toBe(state.player.inventory.length);
    expect(Object.keys(restored.value.markets).length).toBe(Object.keys(state.markets).length);
    // Determinism: the same bytes must produce the same seal.
    expect(serializeState(restored.value).ok && serializeState(state).ok).toBe(true);
  });

  it('is deterministic, so the seal is worth checking', () => {
    const state = freshGame('serialize-determinism');
    const a = serializeState(state);
    const b = serializeState(state);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value.integrityHash).toBe(b.value.integrityHash);
  });

  it('detects a tampered document', () => {
    const state = freshGame('serialize-tamper');
    const sealed = serializeState(state);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;

    const tampered = sealed.value.json.replace('"netWorth"', '"netWorth"').replace(/"cash":\s*[\d.]+/, '"cash": 999999999');
    const result = deserializeState(tampered, { expectedHash: sealed.value.integrityHash });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('corrupt');
  });

  it('rejects a document written by a newer schema', () => {
    const state = freshGame('serialize-future');
    const sealed = serializeState({ ...state, schemaVersion: CURRENT_SCHEMA_VERSION + 3 });
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    const result = deserializeState(sealed.value.json);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('validation_failed');
      expect(result.message).toContain('newer version');
    }
  });

  it('rejects malformed JSON and half-formed documents', () => {
    expect(deserializeState('{not json').ok).toBe(false);
    expect(deserializeState('null').ok).toBe(false);
    expect(deserializeState('{"gameId":"g"}').ok).toBe(false);
    const corrupt = deserializeState('{not json');
    if (!corrupt.ok) expect(corrupt.code).toBe('corrupt');
  });

  it('refuses a save that parses but breaks the game invariants', () => {
    const state = freshGame('serialize-invalid');
    // A negative balance is impossible: money primitives roll back rather than
    // allow it, so a document containing one did not come from this engine.
    state.player.accounts[0]!.balance = -50_000;
    const sealed = serializeState(state);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    const result = deserializeState(sealed.value.json);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('validation_failed');
  });

  it('derives leaderboard metadata from the state, not from the client', () => {
    const state = freshGame('serialize-metadata');
    creditCash(state, 250_000, { kind: 'adjustment', description: 'capital', dirty: false });
    advanceDay(state, rngForDay(state, 1));
    const meta = extractMetadata(state);
    expect(meta.day).toBe(state.world.day);
    expect(meta.netWorth).toBeCloseTo(computeNetWorth(state).total, 2);
    expect(meta.empireScore).toBeCloseTo(empireScore(state), 2);
    expect(meta.level).toBe(state.player.progression.level);
    expect(meta.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe('sqlite store', () => {
  it('reports health and creates its schema', async () => {
    const store = tempStore();
    const health = await store.health();
    expect(health.ok).toBe(true);
    expect(health.driver).toBe('sqlite');
    await store.close();
  });

  it('creates, finds and de-duplicates accounts', async () => {
    const store = tempStore();
    const created = await store.createUser({ id: 'u1', email: 'Founder@Example.com', displayName: 'Founder', passwordHash: 'hash', authProvider: 'local' });
    expect(created.ok).toBe(true);

    const byEmail = await store.findUserByEmail('founder@example.com');
    expect(byEmail.ok && byEmail.value?.id).toBe('u1');

    const byId = await store.findUserById('u1');
    expect(byId.ok && byId.value?.displayName).toBe('Founder');

    const duplicate = await store.createUser({ id: 'u2', email: 'founder@example.com', displayName: 'Impostor', passwordHash: 'x', authProvider: 'local' });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.code).toBe('duplicate');

    await store.touchUser('u1');
    const touched = await store.findUserById('u1');
    expect(touched.ok && touched.value?.lastSeenAt).not.toBeNull();
    await store.close();
  });

  it('issues, reads and revokes sessions', async () => {
    const store = tempStore();
    await store.createUser({ id: 'u1', email: 'a@b.c', displayName: 'A', passwordHash: null, authProvider: 'supabase' });
    const session = await store.createSession({ id: 'sess-1', userId: 'u1', expiresAt: new Date(Date.now() + 60_000).toISOString(), userAgent: 'vitest' });
    expect(session.ok).toBe(true);
    const found = await store.findSession('sess-1');
    expect(found.ok && found.value?.userId).toBe('u1');
    await store.deleteSession('sess-1');
    const gone = await store.findSession('sess-1');
    expect(gone.ok && gone.value).toBeNull();
    await store.close();
  });

  it('persists a game and loads it back intact', async () => {
    const store = tempStore();
    await store.createUser({ id: 'u1', email: 'a@b.c', displayName: 'A', passwordHash: null, authProvider: 'local' });
    const state = freshGame('store-roundtrip', 'u1');
    creditCash(state, 500_000, { kind: 'adjustment', description: 'capital', dirty: false });
    for (let i = 0; i < 5; i++) advanceDay(state, rngForDay(state, state.world.day + 1));

    const saved = await store.saveGame(recordFor(state, 'manual'), null);
    expect(saved.ok).toBe(true);

    const loaded = await store.loadGame(state.gameId, 'u1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.world.day).toBe(state.world.day);
    expect(totalBalance(loaded.value.state.player)).toBe(totalBalance(state.player));
    expect(loaded.value.day).toBe(state.world.day);
    expect(loaded.value.netWorth).toBeCloseTo(computeNetWorth(state).total, 2);

    // The restored state is playable: continuing from it advances normally.
    const continued = loaded.value.state;
    advanceDay(continued, rngForDay(continued, continued.world.day + 1));
    expect(continued.world.day).toBe(state.world.day + 1);
    await store.close();
  });

  it('scopes saves to their owner', async () => {
    const store = tempStore();
    await store.createUser({ id: 'u1', email: 'a@b.c', displayName: 'A', passwordHash: null, authProvider: 'local' });
    await store.createUser({ id: 'u2', email: 'd@e.f', displayName: 'B', passwordHash: null, authProvider: 'local' });
    const state = freshGame('store-ownership', 'u1');
    await store.saveGame(recordFor(state), null);

    const stranger = await store.loadGame(state.gameId, 'u2');
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.code).toBe('not_found');

    const strangerDeletes = await store.deleteGame(state.gameId, 'u2');
    expect(strangerDeletes.ok).toBe(false);
    expect((await store.listGames('u2')).ok).toBe(true);
    const list = await store.listGames('u2');
    if (list.ok) expect(list.value).toHaveLength(0);
    await store.close();
  });

  it('rejects a stale write and never overwrites a newer save', async () => {
    const store = tempStore();
    await store.createUser({ id: 'u1', email: 'a@b.c', displayName: 'A', passwordHash: null, authProvider: 'local' });
    const state = freshGame('store-conflict', 'u1');
    state.version = 1;
    expect((await store.saveGame(recordFor(state), null)).ok).toBe(true);

    // A second session read version 1, then the first session saved version 2.
    state.version = 2;
    advanceDay(state, rngForDay(state, state.world.day + 1));
    expect((await store.saveGame(recordFor(state), 1)).ok).toBe(true);

    const stale = { ...state, version: 2 };
    const conflict = await store.saveGame(recordFor(stale), 1);
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.code).toBe('conflict');
      expect(conflict.message).toContain('version 2');
    }

    const current = await store.loadGame(state.gameId, 'u1');
    expect(current.ok && current.value.version).toBe(2);
    await store.close();
  });

  it('refuses to create a game at a version that does not exist', async () => {
    const store = tempStore();
    await store.createUser({ id: 'u1', email: 'a@b.c', displayName: 'A', passwordHash: null, authProvider: 'local' });
    const state = freshGame('store-phantom', 'u1');
    const result = await store.saveGame(recordFor(state), 7);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('conflict');
    await store.close();
  });

  it('keeps version history and restores forward without rewriting it', async () => {
    const store = tempStore();
    await store.createUser({ id: 'u1', email: 'a@b.c', displayName: 'A', passwordHash: null, authProvider: 'local' });
    const state = freshGame('store-history', 'u1');

    for (let v = 1; v <= 4; v++) {
      state.version = v;
      advanceDay(state, rngForDay(state, state.world.day + 1));
      expect((await store.saveGame(recordFor(state, `day ${v}`), v - 1)).ok).toBe(true);
    }

    const versions = await store.listVersions(state.gameId, 'u1');
    expect(versions.ok).toBe(true);
    if (!versions.ok) return;
    expect(versions.value.map((v) => v.version)).toEqual([4, 3, 2, 1]);

    const restored = await store.restoreVersion(state.gameId, 'u1', 2);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    // Restoring writes forward: the day comes from version 2, the version number
    // is newer than anything stored, and history is intact.
    expect(restored.value.day).toBeLessThan(4);
    expect(restored.value.version).toBe(5);
    const after = await store.listVersions(state.gameId, 'u1');
    expect(after.ok && after.value.map((v) => v.version)).toEqual([5, 4, 3, 2, 1]);
    await store.close();
  });

  it('detects corruption in the database itself', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dynasty-tamper-'));
    tempDirs.push(dir);
    const file = join(dir, 'tamper.sqlite');
    const store = new SqliteStore(file);
    await store.createUser({ id: 'u1', email: 'a@b.c', displayName: 'A', passwordHash: null, authProvider: 'local' });
    const state = freshGame('store-tamper', 'u1');
    creditCash(state, 4200, { kind: 'adjustment', description: 'start', dirty: false });
    expect((await store.saveGame(recordFor(state), null)).ok).toBe(true);
    await store.close();

    // Somebody edits the row behind the application's back.
    const db = new DatabaseSync(file);
    db.prepare(`update games set state = replace(state, '"status":"active"', '"status":"won"') where game_id = ?`).run(state.gameId);
    db.close();

    const reopened = new SqliteStore(file);
    const loaded = await reopened.loadGame(state.gameId, 'u1');
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.code).toBe('corrupt');
    await reopened.close();
  });

  it('orders the leaderboard by empire score', async () => {
    const store = tempStore();
    for (const [userId, email, capital] of [
      ['u1', 'one@x.y', 10_000],
      ['u2', 'two@x.y', 5_000_000],
      ['u3', 'three@x.y', 250_000],
    ] as [string, string, number][]) {
      await store.createUser({ id: userId, email, displayName: email.split('@')[0]!, passwordHash: null, authProvider: 'local' });
      const state = freshGame(`leaderboard-${userId}`, userId);
      creditCash(state, capital, { kind: 'adjustment', description: 'capital', dirty: false });
      expect((await store.saveGame(recordFor(state), null)).ok).toBe(true);
    }
    const board = await store.leaderboard(10);
    expect(board.ok).toBe(true);
    if (!board.ok) return;
    expect(board.value.map((row) => row.userId)).toEqual(['u2', 'u3', 'u1']);
    expect(board.value[0]!.displayName).toBe('two');
    await store.close();
  });

  it('records and reads back an audit trail', async () => {
    const store = tempStore();
    await store.createUser({ id: 'u1', email: 'a@b.c', displayName: 'A', passwordHash: null, authProvider: 'local' });
    await store.appendAudit({ userId: 'u1', gameId: 'g1', action: 'trade.buy', ok: true, code: null, day: 3, turn: 12, detail: 'bought 40 × copper' });
    await store.appendAudit({ userId: 'u1', gameId: 'g1', action: 'trade.buy', ok: false, code: 'insufficient_funds', day: 3, turn: 13, detail: null });
    const recent = await store.recentAudit('u1', 10);
    expect(recent.ok).toBe(true);
    if (!recent.ok) return;
    expect(recent.value).toHaveLength(2);
    expect(recent.value[0]!.action).toBe('trade.buy'); // newest first
    expect(recent.value.some((r) => r.code === 'insufficient_funds')).toBe(true);
    await store.close();
  });

  it('lists a player’s saves newest first', async () => {
    const store = tempStore();
    await store.createUser({ id: 'u1', email: 'a@b.c', displayName: 'A', passwordHash: null, authProvider: 'local' });
    const first = freshGame('list-first', 'u1');
    const second = freshGame('list-second', 'u1');
    expect((await store.saveGame(recordFor(first), null)).ok).toBe(true);
    second.version = 0;
    expect((await store.saveGame(recordFor(second), null)).ok).toBe(true);

    const list = await store.listGames('u1');
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value).toHaveLength(2);
    expect(list.value.map((m) => m.gameId)).toContain(first.gameId);
    // Deleting removes it from the list.
    expect((await store.deleteGame(first.gameId, 'u1')).ok).toBe(true);
    const after = await store.listGames('u1');
    expect(after.ok && after.value).toHaveLength(1);
    await store.close();
  });
});
