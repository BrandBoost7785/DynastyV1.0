/**
 * Game identity and save-creation integrity.
 *
 * Persistent identifiers (`gameId`, `player.id`) must be unique per game and must not be
 * a function of the world seed: the seed decides the world, not which save a player owns.
 * Before this was fixed, the same seed produced the same `gameId`, so creating a second
 * game with a seed already in use silently replaced the first save (same owner) or failed
 * with a database error (another owner).
 *
 * The creation path must be insert-only, and the version check on existing saves must
 * stay intact. Simulation determinism must not change: the same seed still produces the
 * same world, prices, events and progression. Identity-only fields are masked when the
 * simulation is compared, and the masks are listed beside the normaliser below.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/persistence/sqlite-store';
import { resetStoreInit, useStoreDriver } from '../src/persistence';
import { deserializeState, extractMetadata, serializeState } from '../src/persistence/serialize';
import { createNewGame } from '../src/sim/bootstrap';
import { advanceDay, rngForDay } from '../src/sim/tick';
import { creditCash, totalBalance, verifyTransactionChain } from '../src/sim/state';
import { digestHex } from '../src/lib/hash';
import { createGame, deleteGame, advanceTime, listGames, loadGame } from '../src/server/services/game-service';
import { resetRateLimits } from '../src/server/services/rate-limit';
import type { SaveRecord } from '../src/persistence/types';
import type { GameState } from '../src/sim/types';

/* ------------------------------------------------------------------ */
/* Fixtures and helpers                                                */
/* ------------------------------------------------------------------ */

const tempDirs: string[] = [];

function tempStore(): SqliteStore {
  const dir = mkdtempSync(join(tmpdir(), 'dynasty-identity-'));
  tempDirs.push(dir);
  return new SqliteStore(join(dir, 'identity.sqlite'));
}

function recordFor(state: GameState, reason?: string): SaveRecord {
  return { ...extractMetadata(state), state, reason };
}

function newGame(seed: string, userId = 'user-1', playerName = 'Founder'): GameState {
  return createNewGame({ userId, playerName, seed }).state;
}

function playDays(state: GameState, days: number): void {
  for (let i = 0; i < days; i++) advanceDay(state, rngForDay(state, state.world.day + 1));
}

/** The 32 hex characters a `game_` id is built from, for injecting a known collision. */
function hexOf(gameId: string): string {
  return gameId.slice('game_'.length);
}

/**
 * Simulation content as JSON with identity-only fields masked:
 *  - `gameId`, `createdAt`, `updatedAt`: identity or wall-clock fields.
 *  - `simulationKey`: the seed-derived key the simulation hashes with. It is internal
 *    bookkeeping, not simulation output.
 *  - `transactionChain`: its salt includes the game id, so the chain is replaced by null.
 *  - ledger record `id`, `integrityHash` and `prevHash`: these are hashes salted with the
 *    game id, so they change with the identity. The record content (amounts, balances,
 *    days, descriptions) is still compared, and `ledgerChainVerifies` checks the chain.
 *  - `elapsedMs` and `"ms":` values in log lines: wall-clock timing in diagnostics.
 *  - the literal `gameId` and `player.id` strings, replaced by placeholders.
 */
const IDENTITY_KEYS = new Set(['gameId', 'createdAt', 'updatedAt', 'simulationKey', 'elapsedMs']);
const LEDGER_HASH_KEYS = new Set(['integrityHash', 'prevHash']);

function normalisedJson(state: GameState): string {
  // Object keys are sorted so the comparison ignores key order, which a restore does not keep.
  const json = JSON.stringify(state, (key, value: unknown) => {
    if (IDENTITY_KEYS.has(key)) return undefined;
    if (key === 'transactionChain') return null;
    if (LEDGER_HASH_KEYS.has(key)) return '<HASH>';
    if (key === 'id' && typeof value === 'string' && /^tx_\d+_/.test(value)) return '<TX>';
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return value;
  });
  return json
    .split(state.gameId)
    .join('<GAME>')
    .split(state.player.id)
    .join('<PLAYER>')
    .replace(/advanced in \d+ ms/g, 'advanced in <MS> ms')
    .replace(/"ms":\d+/g, '"ms":<MS>');
}

/**
 * Pinned from the pre-identity-change code: simulation digest after 30 days for two seeds,
 * and the bootstrap RNG state at creation. An identity change must not move either. The
 * creation RNG check also shows that identity generation consumes no extra draws.
 */
const GOLDEN = {
  alpha: {
    seed: 'golden-alpha-17',
    digest30Days: 'd327b3be6d123f79',
    rngAtCreation: [3651446350, 1800797266, 3340178871, 503852527],
  },
  beta: {
    seed: 'golden-beta-903',
    digest30Days: '8be815612f3879ec',
    rngAtCreation: [231877200, 382734007, 234633618, 237437702],
  },
} as const;

const USER_ONE = 'identity-user-one';
const USER_TWO = 'identity-user-two';

beforeEach(() => {
  process.env.DYNASTY_APP_SECRET ??= 'test-secret-for-identity-tests-only';
  resetRateLimits();
});

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

afterAll(() => {
  useStoreDriver(null, undefined);
  resetStoreInit();
});

/* ------------------------------------------------------------------ */
/* 1. Identity: a new game never shares a persistent identity          */
/* ------------------------------------------------------------------ */

describe('game identity is independent of the world seed', () => {
  it('gives two games created from one seed different game ids', () => {
    const first = newGame('identity-same-seed');
    const second = newGame('identity-same-seed');

    expect(first.gameId).not.toBe(second.gameId);
    // Persistent ids are opaque random identifiers, not derivations of the seed.
    expect(first.gameId).toMatch(/^game_[0-9a-f]{32}$/);
    expect(second.gameId).toMatch(/^game_[0-9a-f]{32}$/);
  });

  it('gives two games from one seed different player ids', () => {
    const first = newGame('identity-player-seed');
    const second = newGame('identity-player-seed');

    expect(first.player.id).not.toBe(second.player.id);
    expect(first.player.id).toMatch(/^plr_[0-9a-f]{32}$/);
  });

  it('keeps identities distinct across owners using the same seed', () => {
    const ownerOne = newGame('identity-two-owners', USER_ONE);
    const ownerTwo = newGame('identity-two-owners', USER_TWO);

    expect(ownerOne.gameId).not.toBe(ownerTwo.gameId);
    expect(ownerOne.player.id).not.toBe(ownerTwo.player.id);
    expect(ownerOne.userId).toBe(USER_ONE);
    expect(ownerTwo.userId).toBe(USER_TWO);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Determinism: the same seed still yields the same simulation      */
/* ------------------------------------------------------------------ */

describe('simulation stays seed-determined', () => {
  it('reproduces the pre-change simulation digest after 30 days (alpha)', () => {
    const state = newGame(GOLDEN.alpha.seed, 'user-golden', 'Golden');
    playDays(state, 30);
    expect(digestHex(normalisedJson(state))).toBe(GOLDEN.alpha.digest30Days);
  });

  it('reproduces the pre-change simulation digest after 30 days (beta)', () => {
    const state = newGame(GOLDEN.beta.seed, 'user-golden', 'Golden');
    playDays(state, 30);
    expect(digestHex(normalisedJson(state))).toBe(GOLDEN.beta.digest30Days);
  });

  it('does not consume extra simulation RNG draws for identity (creation state pinned)', () => {
    expect(newGame(GOLDEN.alpha.seed, 'user-golden', 'Golden').rng).toEqual(GOLDEN.alpha.rngAtCreation);
    expect(newGame(GOLDEN.beta.seed, 'user-golden', 'Golden').rng).toEqual(GOLDEN.beta.rngAtCreation);
  });

  it('gives two same-seed games identical simulation output despite different identities', () => {
    const first = newGame('identity-replay-seed');
    const second = newGame('identity-replay-seed');
    expect(first.gameId).not.toBe(second.gameId);

    playDays(first, 10);
    playDays(second, 10);
    expect(normalisedJson(first)).toBe(normalisedJson(second));
  });

  it('shares one seed-derived simulation key between same-seed games', () => {
    const first = newGame('identity-simkey-seed');
    const second = newGame('identity-simkey-seed');
    const keyOne = (first.config as { simulationKey?: string }).simulationKey;
    const keyTwo = (second.config as { simulationKey?: string }).simulationKey;

    expect(typeof keyOne).toBe('string');
    expect(keyOne).toBe(keyTwo);
  });

  it('treats a legacy save as the save it was: stored game id as simulation key, same behaviour', () => {
    // Before this change the game id itself was the seed-derived simulation key.
    // A save without `simulationKey` must keep behaving exactly as that save did.
    const fresh = newGame('identity-legacy-seed');
    const key = (fresh.config as { simulationKey?: string }).simulationKey;
    expect(typeof key).toBe('string');

    const legacy = structuredClone(fresh);
    legacy.gameId = key!;
    delete (legacy.config as { simulationKey?: string }).simulationKey;

    playDays(fresh, 10);
    playDays(legacy, 10);
    expect(normalisedJson(legacy)).toBe(normalisedJson(fresh));
  });

  it('keeps each new game\'s ledger chain verifiable after 30 days', () => {
    const state = newGame('identity-ledger-seed');
    creditCash(state, 4200, { kind: 'adjustment', description: 'capital', dirty: false });
    playDays(state, 30);
    const check = verifyTransactionChain(state.player.recentTransactions, state.player.transactionChain);
    expect(check.ok).toBe(true);
  });

  it('save and restore preserve the simulation continuation', () => {
    const state = newGame('identity-restore-seed');
    creditCash(state, 25_000, { kind: 'adjustment', description: 'capital', dirty: false });
    playDays(state, 5);

    const sealed = serializeState(state);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    const restored = deserializeState(sealed.value.json, { expectedHash: sealed.value.integrityHash });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;

    playDays(state, 10);
    playDays(restored.value, 10);
    expect(normalisedJson(restored.value)).toBe(normalisedJson(state));
    expect(totalBalance(restored.value.player)).toBe(totalBalance(state.player));
  });
});

/* ------------------------------------------------------------------ */
/* 3. Storage: creation is insert-only; existing saves stay protected  */
/* ------------------------------------------------------------------ */

describe('storage refuses to replace an existing save on creation', () => {
  it('rejects a creation that reuses an existing save id from the same owner', async () => {
    const store = tempStore();
    await store.createUser({ id: USER_ONE, email: 'one@example.test', displayName: 'One', passwordHash: null, authProvider: 'local' });
    const original = newGame('insert-only-owner', USER_ONE);
    expect((await store.saveGame(recordFor(original), null)).ok).toBe(true);
    const before = normalisedJson(original);

    // A second game that happens to carry the same id, progressed to a different day.
    const impostor = newGame('insert-only-other', USER_ONE);
    impostor.gameId = original.gameId;
    playDays(impostor, 3);

    const result = await store.saveGame(recordFor(impostor), null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('conflict');

    const loaded = await store.loadGame(original.gameId, USER_ONE);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value.day).toBe(original.world.day);
      expect(normalisedJson(loaded.value.state)).toBe(before);
    }
    await store.close();
  });

  it('rejects a creation that reuses another owner\'s save id, as a conflict rather than a crash', async () => {
    const store = tempStore();
    await store.createUser({ id: USER_ONE, email: 'one@example.test', displayName: 'One', passwordHash: null, authProvider: 'local' });
    await store.createUser({ id: USER_TWO, email: 'two@example.test', displayName: 'Two', passwordHash: null, authProvider: 'local' });
    const owned = newGame('cross-owner-collision', USER_ONE);
    expect((await store.saveGame(recordFor(owned), null)).ok).toBe(true);

    const intruder = newGame('cross-owner-other', USER_TWO);
    intruder.gameId = owned.gameId;
    const result = await store.saveGame(recordFor(intruder), null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('conflict');
      expect(result.message).not.toMatch(/UNIQUE|constraint/i);
    }

    const stillOwned = await store.loadGame(owned.gameId, USER_ONE);
    expect(stillOwned.ok && stillOwned.value.userId).toBe(USER_ONE);
    expect((await store.loadGame(owned.gameId, USER_TWO)).ok).toBe(false);
    await store.close();
  });

  it('keeps the version check on existing saves: no null-version overwrite, no stale write', async () => {
    const store = tempStore();
    await store.createUser({ id: USER_ONE, email: 'one@example.test', displayName: 'One', passwordHash: null, authProvider: 'local' });
    const state = newGame('cas-guard', USER_ONE);
    state.version = 1;
    expect((await store.saveGame(recordFor(state), null)).ok).toBe(true);

    state.version = 2;
    playDays(state, 1);
    expect((await store.saveGame(recordFor(state), 1)).ok).toBe(true);

    // A write that claims to be a creation must not overwrite the version-2 save.
    const creation = newGame('cas-guard-other', USER_ONE);
    creation.gameId = state.gameId;
    const overwrite = await store.saveGame(recordFor(creation), null);
    expect(overwrite.ok).toBe(false);

    // A stale write expecting version 1 must not overwrite either.
    const stale = await store.saveGame(recordFor({ ...state, version: 2 }), 1);
    expect(stale.ok).toBe(false);

    const current = await store.loadGame(state.gameId, USER_ONE);
    expect(current.ok && current.value.version).toBe(2);
    await store.close();
  });

  it('deleting another owner\'s save does not destroy its version history', async () => {
    const store = tempStore();
    await store.createUser({ id: USER_ONE, email: 'one@example.test', displayName: 'One', passwordHash: null, authProvider: 'local' });
    await store.createUser({ id: USER_TWO, email: 'two@example.test', displayName: 'Two', passwordHash: null, authProvider: 'local' });
    const state = newGame('delete-ownership', USER_ONE);
    expect((await store.saveGame(recordFor(state, 'first'), null)).ok).toBe(true);
    state.version = 2;
    playDays(state, 1);
    expect((await store.saveGame(recordFor(state, 'second'), 1)).ok).toBe(true);

    const attempt = await store.deleteGame(state.gameId, USER_TWO);
    expect(attempt.ok).toBe(false);

    const history = await store.listVersions(state.gameId, USER_ONE);
    expect(history.ok && history.value.map((v) => v.version)).toEqual([2, 1]);
    await store.close();
  });
});

/* ------------------------------------------------------------------ */
/* 4. Service: game creation under concurrency and collision           */
/* ------------------------------------------------------------------ */

describe('game creation through the service', () => {
  let store: SqliteStore;

  beforeEach(async () => {
    store = tempStore();
    await store.createUser({ id: USER_ONE, email: 'one@example.test', displayName: 'One', passwordHash: null, authProvider: 'local' });
    await store.createUser({ id: USER_TWO, email: 'two@example.test', displayName: 'Two', passwordHash: null, authProvider: 'local' });
    useStoreDriver('sqlite', store);
    resetStoreInit();
  });

  afterEach(async () => {
    useStoreDriver(null, undefined);
    resetStoreInit();
    await store.close();
  });

  it('keeps an existing game intact when the same user creates another with the same seed', async () => {
    const first = await createGame({ userId: USER_ONE, playerName: 'Founder', seed: 'service-same-seed' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstId = first.value.state.gameId;
    expect(await advanceTime(USER_ONE, firstId, 3, { expectedVersion: 0 })).toMatchObject({ ok: true });

    const beforeLoad = await loadGame(USER_ONE, firstId);
    expect(beforeLoad.ok).toBe(true);
    if (!beforeLoad.ok) return;
    const before = normalisedJson(beforeLoad.value.state);
    expect(beforeLoad.value.state.world.day).toBe(3);

    const second = await createGame({ userId: USER_ONE, playerName: 'Founder', seed: 'service-same-seed' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.state.gameId).not.toBe(firstId);
    expect(second.value.state.world.day).toBe(0);
    expect(second.value.state.version).toBe(0);

    const afterLoad = await loadGame(USER_ONE, firstId);
    expect(afterLoad.ok).toBe(true);
    if (afterLoad.ok) expect(normalisedJson(afterLoad.value.state)).toBe(before);

    const list = await listGames(USER_ONE);
    expect(list.ok && list.value.map((m) => m.gameId).sort()).toEqual([firstId, second.value.state.gameId].sort());
  });

  it('gives two owners who use the same seed separate saves, with no crossover', async () => {
    const one = await createGame({ userId: USER_ONE, playerName: 'Alpha', seed: 'service-two-owners' });
    const two = await createGame({ userId: USER_TWO, playerName: 'Beta', seed: 'service-two-owners' });

    expect(one.ok).toBe(true);
    expect(two.ok).toBe(true);
    if (!one.ok || !two.ok) return;
    expect(one.value.state.gameId).not.toBe(two.value.state.gameId);
    expect(one.value.state.userId).toBe(USER_ONE);
    expect(two.value.state.userId).toBe(USER_TWO);

    const listOne = await listGames(USER_ONE);
    const listTwo = await listGames(USER_TWO);
    expect(listOne.ok && listOne.value.map((m) => m.gameId)).toEqual([one.value.state.gameId]);
    expect(listTwo.ok && listTwo.value.map((m) => m.gameId)).toEqual([two.value.state.gameId]);

    expect((await loadGame(USER_ONE, two.value.state.gameId)).ok).toBe(false);
    expect((await loadGame(USER_TWO, one.value.state.gameId)).ok).toBe(false);
  });

  it('creates independent saves under repeated and concurrent creation with one seed', async () => {
    const results = await Promise.all(
      [0, 1, 2, 3].map(() => createGame({ userId: USER_ONE, playerName: 'Founder', seed: 'service-concurrent' })),
    );
    for (const result of results) expect(result.ok).toBe(true);
    const ids = results.flatMap((r) => (r.ok ? [r.value.state.gameId] : []));
    expect(new Set(ids).size).toBe(4);

    const list = await listGames(USER_ONE);
    expect(list.ok && list.value).toHaveLength(4);
  });

  it('retries a forced game-id collision and leaves the existing save untouched', async () => {
    const existing = await createGame({ userId: USER_ONE, playerName: 'Founder', seed: 'service-forced-collision' });
    expect(existing.ok).toBe(true);
    if (!existing.ok) return;
    const existingId = existing.value.state.gameId;
    const before = await loadGame(USER_ONE, existingId);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const beforeJson = normalisedJson(before.value.state);

    // The next identifiers handed out collide with the existing save first, then succeed.
    // Order: gameId (collides), playerId, then the retry's gameId and playerId.
    const uuid = vi.spyOn(globalThis.crypto, 'randomUUID');
    uuid
      .mockReturnValueOnce(hexOf(existingId) as `${string}-${string}-${string}-${string}-${string}`)
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
      .mockReturnValueOnce('33333333-3333-4333-8333-333333333333');
    const retried = await createGame({ userId: USER_ONE, playerName: 'Founder', seed: 'service-forced-collision' });
    uuid.mockRestore();

    expect(retried.ok).toBe(true);
    if (retried.ok) expect(retried.value.state.gameId).not.toBe(existingId);

    const after = await loadGame(USER_ONE, existingId);
    expect(after.ok).toBe(true);
    if (after.ok) expect(normalisedJson(after.value.state)).toBe(beforeJson);
  });

  it('fails with a conflict, and changes nothing, when every attempt collides', async () => {
    const existing = await createGame({ userId: USER_ONE, playerName: 'Founder', seed: 'service-persistent-collision' });
    expect(existing.ok).toBe(true);
    if (!existing.ok) return;
    const existingId = existing.value.state.gameId;
    const before = await loadGame(USER_ONE, existingId);
    if (!before.ok) throw new Error('setup failed');
    const beforeJson = normalisedJson(before.value.state);

    const uuid = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(hexOf(existingId) as `${string}-${string}-${string}-${string}-${string}`);
    const refused = await createGame({ userId: USER_ONE, playerName: 'Founder', seed: 'service-persistent-collision' });
    uuid.mockRestore();

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('conflict');

    const after = await loadGame(USER_ONE, existingId);
    expect(after.ok).toBe(true);
    if (after.ok) expect(normalisedJson(after.value.state)).toBe(beforeJson);
    const list = await listGames(USER_ONE);
    expect(list.ok && list.value).toHaveLength(1);
  });

  it('a deleted save leaves a same-seed save in place for its owner', async () => {
    const first = await createGame({ userId: USER_ONE, playerName: 'Founder', seed: 'service-delete-seed' });
    const second = await createGame({ userId: USER_ONE, playerName: 'Founder', seed: 'service-delete-seed' });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect((await deleteGame(USER_ONE, first.value.state.gameId)).ok).toBe(true);
    expect((await loadGame(USER_ONE, second.value.state.gameId)).ok).toBe(true);
  });
});
