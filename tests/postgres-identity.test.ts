/**
 * Game identity and save creation against PostgreSQL.
 *
 * The SQLite suites cover the logic; this file covers the production adapter's own SQL:
 * the insert-only creation, the compare-and-set on updates and the ownership checks, under
 * real concurrency on a connection pool.
 *
 * It runs only when `DYNASTY_DISPOSABLE_POSTGRES_URL` is set, and only against a database
 * whose name marks it as disposable (it must contain "disposable", "scratch" or "_test").
 * Every run creates its own accounts with random ids and removes them afterwards. Without
 * the variable the suite is skipped, so the default `npm test` needs no database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../src/persistence/postgres-store';
import { resetStoreInit, useStoreDriver } from '../src/persistence';
import { extractMetadata } from '../src/persistence/serialize';
import { createNewGame } from '../src/sim/bootstrap';
import { advanceDay, rngForDay } from '../src/sim/tick';
import { advanceTime, createGame, deleteGame, loadGame, listVersions, restoreVersion } from '../src/server/services/game-service';
import { resetRateLimits } from '../src/server/services/rate-limit';
import type { SaveRecord } from '../src/persistence/types';
import type { GameState } from '../src/sim/types';

const DISPOSABLE_URL = process.env.DYNASTY_DISPOSABLE_POSTGRES_URL ?? '';

/** The suite refuses to run against anything that does not name itself as disposable. */
function disposableUrlProblem(raw: string): string | null {
  if (!raw) return 'not set';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'not a valid URL';
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/disposable|scratch|_test/i.test(name)) return `database "${name}" is not marked disposable`;
  if (process.env.NODE_ENV === 'production') return 'refusing to run with NODE_ENV=production';
  return null;
}

const problem = disposableUrlProblem(DISPOSABLE_URL);
const describePg = problem === null ? describe : describe.skip;

function recordFor(state: GameState): SaveRecord {
  return { ...extractMetadata(state), state };
}

function playDays(state: GameState, days: number): void {
  for (let i = 0; i < days; i++) advanceDay(state, rngForDay(state, state.world.day + 1));
}

function randomUserId(): string {
  return `pgid-${randomBytes(8).toString('hex')}`;
}

describePg('game identity on PostgreSQL', () => {
  const store = new PostgresStore({ connectionString: DISPOSABLE_URL, max: 5 });
  // Separate pool for the test's own cleanup, so the adapter under test is never bypassed.
  const admin = new pg.Pool({ connectionString: DISPOSABLE_URL, max: 1 });
  const users: string[] = [];

  async function newUser(label: string): Promise<string> {
    const id = randomUserId();
    users.push(id);
    const created = await store.createUser({
      id,
      email: `${id}@disposable.example.test`,
      displayName: label,
      passwordHash: null,
      authProvider: 'local',
    });
    if (!created.ok) throw new Error(`setup: could not create test account (${created.code})`);
    return id;
  }

  /** Column-level metadata for one owner's games; this does not read the state document. */
  async function metaFor(userId: string): Promise<Map<string, { version: number; day: number }>> {
    const listed = await store.listGames(userId);
    if (!listed.ok) throw new Error(`setup: listGames failed (${listed.code})`);
    return new Map(listed.value.map((m) => [m.gameId, { version: m.version, day: m.day }]));
  }

  beforeAll(async () => {
    process.env.DYNASTY_APP_SECRET ??= 'test-secret-for-postgres-identity-tests-only';
    const migrated = await store.migrate();
    if (!migrated.ok) throw new Error(`setup: migrations not applied (${migrated.code}): ${migrated.message}`);
    useStoreDriver('postgres', store);
    resetStoreInit();
    resetRateLimits();
  });

  afterAll(async () => {
    // Accounts are removed; their saves, versions and receipts cascade with them.
    for (const id of users) await admin.query('delete from public.profiles where id = $1', [id]).catch(() => undefined);
    useStoreDriver(null, undefined);
    resetStoreInit();
    await store.close();
    await admin.end();
  });

  it('gives two games from one user and one seed separate saves, and leaves the first untouched', async () => {
    const user = await newUser('Repeat');
    const first = await createGame({ userId: user, playerName: 'Founder', seed: 'pg-repeat-seed' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstState = first.value.state;
    playDays(firstState, 3);
    expect((await store.saveGame(recordFor({ ...firstState, version: 1 }), 0)).ok).toBe(true);
    const before = await metaFor(user);
    expect(before.get(firstState.gameId)).toEqual({ version: 1, day: 3 });

    const second = await createGame({ userId: user, playerName: 'Founder', seed: 'pg-repeat-seed' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.state.gameId).not.toBe(firstState.gameId);
    const after = await metaFor(user);
    expect(after.size).toBe(2);
    expect(after.get(firstState.gameId)).toEqual({ version: 1, day: 3 });
    expect(after.get(second.value.state.gameId)).toEqual({ version: 0, day: 0 });
  });

  it('gives two owners the same seed separate saves, with no crossover', async () => {
    const one = await newUser('Owner one');
    const two = await newUser('Owner two');
    const a = await createGame({ userId: one, playerName: 'Alpha', seed: 'pg-two-owners' });
    const b = await createGame({ userId: two, playerName: 'Beta', seed: 'pg-two-owners' });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.state.gameId).not.toBe(b.value.state.gameId);
    expect([...(await metaFor(one)).keys()]).toEqual([a.value.state.gameId]);
    expect([...(await metaFor(two)).keys()]).toEqual([b.value.state.gameId]);
    const crossed = await loadGame(one, b.value.state.gameId);
    expect(!crossed.ok && crossed.code).toBe('not_found');
  });

  it('creates independent saves under real concurrency with one seed', async () => {
    const user = await newUser('Concurrent');
    const results = await Promise.all(
      [0, 1, 2, 3, 4].map(() => createGame({ userId: user, playerName: 'Founder', seed: 'pg-concurrent' })),
    );
    for (const result of results) expect(result.ok).toBe(true);
    const ids = results.flatMap((r) => (r.ok ? [r.value.state.gameId] : []));
    expect(new Set(ids).size).toBe(5);
    expect((await metaFor(user)).size).toBe(5);
  });

  it('refuses a creation that reuses an existing id, as a conflict, and never replaces the row', async () => {
    const user = await newUser('Insert only');
    const original = createNewGame({ userId: user, playerName: 'Original', seed: 'pg-insert-only' }).state;
    original.version = 0;
    expect((await store.saveGame(recordFor(original), null)).ok).toBe(true);

    const impostor = createNewGame({ userId: user, playerName: 'Impostor', seed: 'pg-insert-only-other' }).state;
    impostor.gameId = original.gameId;
    playDays(impostor, 2);
    const result = await store.saveGame(recordFor(impostor), null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('conflict');
      expect(result.message).not.toMatch(/duplicate key|unique|constraint/i);
    }
    expect((await metaFor(user)).get(original.gameId)).toEqual({ version: 0, day: 0 });
  });

  it("refuses another owner's id as a conflict, without exposing the owner or a database error", async () => {
    const owner = await newUser('Owner');
    const intruder = await newUser('Intruder');
    const owned = createNewGame({ userId: owner, playerName: 'Owned', seed: 'pg-cross-owner' }).state;
    owned.version = 0;
    expect((await store.saveGame(recordFor(owned), null)).ok).toBe(true);

    const attempt = createNewGame({ userId: intruder, playerName: 'Intruder', seed: 'pg-cross-owner-other' }).state;
    attempt.gameId = owned.gameId;
    const result = await store.saveGame(recordFor(attempt), null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('conflict');
      expect(result.message).not.toContain(owner);
    }
    expect((await metaFor(owner)).has(owned.gameId)).toBe(true);
    expect((await metaFor(intruder)).has(owned.gameId)).toBe(false);
  });

  it('keeps compare-and-set on existing saves: no null-version overwrite, no stale write', async () => {
    const user = await newUser('CAS');
    const state = createNewGame({ userId: user, playerName: 'CAS', seed: 'pg-cas' }).state;
    state.version = 1;
    expect((await store.saveGame(recordFor(state), null)).ok).toBe(true);

    state.version = 2;
    playDays(state, 1);
    expect((await store.saveGame(recordFor(state), 1)).ok).toBe(true);

    const overwrite = await store.saveGame(recordFor({ ...state, version: 3 }), null);
    expect(overwrite.ok).toBe(false);
    const stale = await store.saveGame(recordFor({ ...state, version: 3 }), 1);
    expect(stale.ok).toBe(false);

    expect((await metaFor(user)).get(state.gameId)?.version).toBe(2);
  });

  it("keeps another owner's version history when a delete is attempted", async () => {
    const owner = await newUser('History owner');
    const other = await newUser('History other');
    const state = createNewGame({ userId: owner, playerName: 'History', seed: 'pg-history' }).state;
    state.version = 0;
    expect((await store.saveGame(recordFor(state), null)).ok).toBe(true);
    state.version = 1;
    playDays(state, 1);
    expect((await store.saveGame(recordFor(state), 0)).ok).toBe(true);

    const attempt = await deleteGame(other, state.gameId);
    expect(attempt.ok).toBe(false);
    const history = await listVersions(owner, state.gameId);
    expect(history.ok && history.value.map((v) => v.version)).toEqual([1, 0]);
  });

  /**
   * Regression: `loadGame` once read `state::text` from a jsonb column, and jsonb re-orders
   * keys, so the seal check over the canonical JSON failed for every save. The stored text is
   * now re-canonicalised before the seal is checked (see sealedTextFromStored).
   */
  it('loads back a game it has just created', async () => {
    const user = await newUser('Round trip');
    const created = await createGame({ userId: user, playerName: 'Round', seed: 'pg-round-trip' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const loaded = await loadGame(user, created.value.state.gameId);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.gameId).toBe(created.value.state.gameId);
  });

  it('saves, advances, restores an earlier version and loads it back', async () => {
    const user = await newUser('History');
    const created = await createGame({ userId: user, playerName: 'History', seed: 'pg-restore' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const gameId = created.value.state.gameId;
    const advanced = await advanceTime(user, gameId, 2, { expectedVersion: 0 });
    expect(advanced.ok).toBe(true);

    const restored = await restoreVersion(user, gameId, 0);
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.value.day).toBe(0);
    const reloaded = await loadGame(user, gameId);
    expect(reloaded.ok && reloaded.value.day).toBe(0);
  });

  it('rejects a save whose stored content was edited in the database', async () => {
    const user = await newUser('Tamper');
    const created = await createGame({ userId: user, playerName: 'Tamper', seed: 'pg-tamper' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const gameId = created.value.state.gameId;
    await admin.query(`update public.games set state = jsonb_set(state, '{world,day}', '999') where game_id = $1`, [gameId]);
    const loaded = await loadGame(user, gameId);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.code).toBe('state_corrupt');
  });

  /**
   * Guest identities (migration 0004): a profile with no email, which the database must
   * accept, and which owns its saves exactly as any account does.
   */
  it('stores a guest with no email, and keeps its saves private to it', async () => {
    const guestId = `gst_${randomBytes(8).toString('base64url')}`;
    users.push(guestId);
    const created = await store.createUser({ id: guestId, email: null, displayName: 'Guest PG', passwordHash: null, authProvider: 'guest' });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.email).toBeNull();
      expect(created.value.authProvider).toBe('guest');
    }
    const row = await admin.query('select email, auth_provider from public.profiles where id = $1', [guestId]);
    expect(row.rows[0]?.email).toBeNull();
    expect(row.rows[0]?.auth_provider).toBe('guest');

    const other = await newUser('Other');
    const game = await createGame({ userId: guestId, playerName: 'Guest', seed: 'pg-guest-owned' });
    expect(game.ok).toBe(true);
    if (!game.ok) return;
    const own = await loadGame(guestId, game.value.state.gameId);
    expect(own.ok).toBe(true);
    const intruder = await loadGame(other, game.value.state.gameId);
    expect(intruder.ok).toBe(false);
  });

  it('keeps the database’s provider check: an unknown provider is refused', async () => {
    const id = `gst_${randomBytes(8).toString('base64url')}`;
    users.push(id);
    await expect(
      admin.query("insert into public.profiles (id, email, display_name, auth_provider) values ($1, null, 'x', 'anonymous-bogus')", [id]),
    ).rejects.toThrow();
  });

  it('rejects a save whose seal was edited in the database', async () => {
    const user = await newUser('Seal');
    const created = await createGame({ userId: user, playerName: 'Seal', seed: 'pg-seal' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const gameId = created.value.state.gameId;
    await admin.query(`update public.games set integrity_hash = '0000000000000000' where game_id = $1`, [gameId]);
    const loaded = await loadGame(user, gameId);
    expect(loaded.ok).toBe(false);
  });
});

describe('PostgreSQL identity suite gating', () => {
  it('is skipped unless a disposable database is named, and never runs against a production-looking name', () => {
    expect(disposableUrlProblem('')).not.toBeNull();
    expect(disposableUrlProblem('postgres://u:p@h:5432/dynasty_production')).toMatch(/not marked disposable/);
    expect(disposableUrlProblem('postgres://u:p@h:5432/dynasty_disposable')).toBeNull();
    expect(disposableUrlProblem('postgres://u:p@h:5432/dynasty_test')).toBeNull();
  });
});
