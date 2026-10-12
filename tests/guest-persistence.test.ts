/**
 * Guest persistence across a server restart, on a file-backed SQLite database.
 *
 * The in-memory store used elsewhere cannot show persistence: it vanishes with the process.
 * Here the store is closed and reopened on the same file, which is what a restart does. Proven:
 *   1. the same signed cookie resumes the same guest and the same save after a restart;
 *   2. a resumed guest is not recreated (no second identity, no orphaned save);
 *   3. a save edited directly in the database is refused, not served.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '../src/persistence/sqlite-store';
import { resetStoreInit, useStoreDriver as bindStoreDriver } from '../src/persistence';
import { resetRateLimits } from '../src/server/services/rate-limit';
import type { GameStateDto } from '../src/server/dto';
import type { SaveMetadata } from '../src/persistence/types';

import { GET as sessionGet } from '../src/app/api/auth/session/route';
import { POST as guestPost } from '../src/app/api/auth/guest/route';
import { GET as gamesGet, POST as gamesPost } from '../src/app/api/games/route';
import { GET as stateGet } from '../src/app/api/games/[gameId]/state/route';
import { POST as advancePost } from '../src/app/api/games/[gameId]/advance/route';

type RouteHandler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
const H = (fn: unknown): RouteHandler => fn as RouteHandler;

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function call<T = unknown>(handler: RouteHandler, path: string, opts: { method?: string; cookie?: string; body?: unknown; params?: Record<string, string> } = {}) {
  const headers = new Headers({ origin: 'http://localhost:3000' });
  if (opts.cookie) headers.set('cookie', opts.cookie);
  if (opts.body !== undefined) headers.set('content-type', 'application/json');
  const request = new Request(`http://localhost:3000${path}`, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const response = await handler(request, { params: Promise.resolve(opts.params ?? {}) });
  const raw = await response.text();
  return { status: response.status, body: (raw ? JSON.parse(raw) : {}) as Envelope<T>, response };
}

const SAVED_SECRET = process.env.DYNASTY_APP_SECRET;
let dir: string;
let path: string;

beforeEach(() => {
  process.env.DYNASTY_APP_SECRET = 'test-secret-for-persistence-tests-only';
  dir = mkdtempSync(join(tmpdir(), 'dynasty-persist-'));
  path = join(dir, 'persist.sqlite');
  resetRateLimits();
});

afterEach(() => {
  bindStoreDriver(null, undefined);
  if (SAVED_SECRET === undefined) delete process.env.DYNASTY_APP_SECRET;
  else process.env.DYNASTY_APP_SECRET = SAVED_SECRET;
  rmSync(dir, { recursive: true, force: true });
});

async function openStore(): Promise<SqliteStore> {
  const store = new SqliteStore(path);
  bindStoreDriver('sqlite', store);
  resetStoreInit();
  return store;
}

describe('guest persistence across a restart', () => {
  it('resumes the same guest and the same save after the store is closed and reopened', async () => {
    const first = await openStore();
    const created = await call<{ userId: string }>(H(guestPost), '/api/auth/guest', { method: 'POST', body: {} });
    expect(created.status).toBe(201);
    const cookie = created.response.headers.getSetCookie().find((c) => c.startsWith('dynasty_session='))!.split(';')[0]!;
    const game = await call<{ game: { meta: { gameId: string } } }>(H(gamesPost), '/api/games', { method: 'POST', cookie, body: { playerName: 'Restart Test', seed: 'restart-seed' } });
    expect(game.status).toBe(201);
    const gameId = game.body.data!.game.meta.gameId;
    const advanced = await call(H(advancePost), `/api/games/${gameId}/advance`, { method: 'POST', cookie, params: { gameId }, body: { days: 2, expectedVersion: 0 } });
    expect(advanced.status).toBe(200);
    const before = await call<{ state: GameStateDto; meta: SaveMetadata }>(H(stateGet), `/api/games/${gameId}/state`, { cookie, params: { gameId } });
    await first.close();
    bindStoreDriver(null, undefined);

    // A restart: a new process would open the same file with the same secret.
    const second = await openStore();
    try {
      const session = await call<{ authenticated: boolean; user: { id: string; provider: string } }>(H(sessionGet), '/api/auth/session', { cookie });
      expect(session.body.data?.authenticated).toBe(true);
      expect(session.body.data?.user.id).toBe(created.body.data!.userId);
      expect(session.body.data?.user.provider).toBe('guest');

      // Resuming is not creating: the same identity comes back, with 200 and no new cookie.
      const resumed = await call<{ userId: string; created: boolean }>(H(guestPost), '/api/auth/guest', { method: 'POST', cookie, body: {} });
      expect(resumed.status).toBe(200);
      expect(resumed.body.data?.userId).toBe(created.body.data!.userId);
      expect(resumed.response.headers.getSetCookie()).toEqual([]);

      const games = await call<{ count: number; games: { gameId: string }[] }>(H(gamesGet), '/api/games', { cookie });
      expect(games.body.data?.count).toBe(1);
      expect(games.body.data?.games[0]?.gameId).toBe(gameId);

      const after = await call<{ state: GameStateDto; meta: SaveMetadata }>(H(stateGet), `/api/games/${gameId}/state`, { cookie, params: { gameId } });
      expect(after.body.data?.meta.version).toBe(before.body.data?.meta.version);
      expect(after.body.data?.meta.day).toBe(before.body.data?.meta.day);
    } finally {
      await second.close();
    }
  });

  it('refuses a save whose stored document was edited directly in the database', async () => {
    const store = await openStore();
    try {
      const created = await call<{ userId: string }>(H(guestPost), '/api/auth/guest', { method: 'POST', body: {} });
      const cookie = created.response.headers.getSetCookie().find((c) => c.startsWith('dynasty_session='))!.split(';')[0]!;
      const game = await call<{ game: { meta: { gameId: string } } }>(H(gamesPost), '/api/games', { method: 'POST', cookie, body: { playerName: 'Tamper Test' } });
      const gameId = game.body.data!.game.meta.gameId;

      const db = (store as unknown as { db: DatabaseSync }).db;
      const row = db.prepare('select state from games where game_id = ?').get(gameId) as { state: string };
      const edited = row.state.replace(/"cash":\s*(-?[\d.]+)/, '"cash": 999999999');
      expect(edited).not.toBe(row.state);
      db.prepare('update games set state = ? where game_id = ?').run(edited, gameId);

      const out = await call(H(stateGet), `/api/games/${gameId}/state`, { cookie, params: { gameId } });
      // The seal, not a missing row, is what refuses it.
      expect(out.status).toBe(422);
      expect(out.body.error?.code).toBe('state_corrupt');
      expect(out.body.data).toBeUndefined();
    } finally {
      await store.close();
    }
  });
});
