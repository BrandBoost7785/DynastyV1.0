/**
 * Session lifecycle, cross-site request forgery and ownership on every game route.
 *
 * Drives the real route handlers against an in-memory SQLite store, as guest-mode.test.ts
 * does. Each test here answers one question an attacker or a careless client could ask:
 *   - can a page on another site make this browser act? (no: every unsafe route, every method)
 *   - can a valid signed-in account be silently swapped for a guest? (no)
 *   - does an expired or revoked session stay dead? (yes, and its row is removed)
 *   - does the session cookie carry the right attributes? (HttpOnly, SameSite=Lax, Path=/, Secure in production)
 *   - does production refuse to sign sessions with a per-process secret? (yes)
 *   - are two guests with the same seed independent? (yes: separate ids, separate saves)
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SqliteStore } from '../src/persistence/sqlite-store';
import { resetStoreInit, useStoreDriver } from '../src/persistence';
import { resetRateLimits } from '../src/server/services/rate-limit';
import { issueSessionToken, sessionCookieOptions, signingSecret } from '../src/server/auth/tokens';
import { resetEnvCache } from '../src/config/env';
import type { SaveMetadata } from '../src/persistence/types';
import type { GameStateDto } from '../src/server/dto';

import { GET as sessionGet } from '../src/app/api/auth/session/route';
import { POST as guestPost } from '../src/app/api/auth/guest/route';
import { POST as logoutPost } from '../src/app/api/auth/logout/route';
import { POST as registerPost } from '../src/app/api/auth/register/route';
import { GET as gamesGet, POST as gamesPost } from '../src/app/api/games/route';
import { DELETE as gameDelete } from '../src/app/api/games/[gameId]/route';
import { GET as stateGet } from '../src/app/api/games/[gameId]/state/route';
import { POST as intentPost } from '../src/app/api/games/[gameId]/intent/route';
import { POST as advancePost } from '../src/app/api/games/[gameId]/advance/route';
import { POST as viewPost } from '../src/app/api/games/[gameId]/views/[view]/route';
import { POST as restorePost } from '../src/app/api/games/[gameId]/versions/[version]/route';

const store = new SqliteStore(':memory:');
const SAVED_ENV = { ...process.env };

beforeAll(() => {
  process.env.DYNASTY_APP_SECRET = 'test-secret-for-session-hardening-only';
  useStoreDriver('sqlite', store);
  resetStoreInit();
});

afterAll(async () => {
  await store.close();
  useStoreDriver(null, undefined);
});

beforeEach(() => {
  resetRateLimits();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in SAVED_ENV)) delete process.env[key];
  Object.assign(process.env, SAVED_ENV);
  resetEnvCache();
});

/* ------------------------------------------------------------------ */
/* Harness (same contract as guest-mode.test.ts)                       */
/* ------------------------------------------------------------------ */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
  requestId: string;
}

interface CallOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  bare?: boolean;
}

type RouteHandler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
const H = (fn: unknown): RouteHandler => fn as RouteHandler;

async function invoke<T = unknown>(handler: RouteHandler, path: string, options: CallOptions = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const unsafe = ['POST', 'PUT', 'PATCH', 'DELETE'].includes((options.method ?? 'GET').toUpperCase());
  if (unsafe && !options.bare && !headers.has('origin') && !headers.has('sec-fetch-site')) {
    headers.set('origin', 'http://localhost:3000');
  }
  const request = new Request(`http://localhost:3000${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const response = await handler(request, { params: Promise.resolve(options.params ?? {}) });
  const raw = await response.text();
  const body = raw.length > 0 ? (JSON.parse(raw) as Envelope<T>) : ({ ok: false, requestId: '', error: { code: 'empty', message: '' } } as Envelope<T>);
  return { status: response.status, body, response, raw };
}

function sessionCookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .filter((cookie) => cookie.startsWith('dynasty_session='))
    .map((cookie) => cookie.split(';')[0] ?? '')
    .join('; ');
}

interface Guest {
  cookie: string;
  userId: string;
}

async function startGuest(): Promise<Guest> {
  const created = await invoke<{ userId: string }>(H(guestPost), '/api/auth/guest', { method: 'POST', body: {} });
  expect(created.status).toBe(201);
  return { cookie: sessionCookie(created.response), userId: created.body.data!.userId };
}

async function newGame(guest: Guest, overrides: Record<string, unknown> = {}): Promise<{ gameId: string; version: number }> {
  const created = await invoke<{ game: { meta: SaveMetadata } }>(H(gamesPost), '/api/games', {
    method: 'POST',
    cookie: guest.cookie,
    body: { playerName: 'Session Tester', ...overrides },
  });
  expect(created.status).toBe(201);
  const meta = created.body.data!.game.meta;
  return { gameId: meta.gameId, version: meta.version };
}

function rawDb(): import('node:sqlite').DatabaseSync {
  return (store as unknown as { db: import('node:sqlite').DatabaseSync }).db;
}

/* ------------------------------------------------------------------ */
/* A signed-in account is never silently replaced by a guest           */
/* ------------------------------------------------------------------ */

describe('a signed-in account is not swapped for a guest', () => {
  it('refuses to start a guest from an account session, and leaves the account signed in', async () => {
    const registered = await invoke<{ userId: string }>(H(registerPost), '/api/auth/register', {
      method: 'POST',
      body: { email: 'account.holder@example.test', password: 'correct-horse-battery-1', displayName: 'Account Holder' },
    });
    expect(registered.status).toBe(201);
    const accountCookie = sessionCookie(registered.response);
    expect(accountCookie).not.toBe('');

    const attempt = await invoke(H(guestPost), '/api/auth/guest', { method: 'POST', body: {}, cookie: accountCookie });
    expect(attempt.status).toBe(409);
    expect(attempt.body.error?.code).toBe('conflict');
    expect(attempt.response.headers.getSetCookie()).toEqual([]);

    const stillSignedIn = await invoke<{ authenticated: boolean; user?: { id: string; provider: string } }>(H(sessionGet), '/api/auth/session', {
      cookie: accountCookie,
    });
    expect(stillSignedIn.body.data?.authenticated).toBe(true);
    expect(stillSignedIn.body.data?.user?.id).toBe(registered.body.data!.userId);
    expect(stillSignedIn.body.data?.user?.provider).toBe('local');
  });
});

/* ------------------------------------------------------------------ */
/* Session lifetime and cookie attributes                              */
/* ------------------------------------------------------------------ */

describe('session lifetime', () => {
  it('refuses a session whose stored row has expired, and removes the row', async () => {
    const guest = await startGuest();
    const sid = JSON.parse(Buffer.from(guest.cookie.split('=')[1]!.split('.')[1]!, 'base64url').toString('utf8')).sid as string;
    rawDb().prepare('update sessions set expires_at = ? where id = ?').run(new Date(Date.now() - 60_000).toISOString(), sid);

    const replay = await invoke(H(gamesGet), '/api/games', { cookie: guest.cookie });
    expect(replay.status).toBe(401);
    expect(replay.body.error?.code).toBe('not_authenticated');
    const row = rawDb().prepare('select count(*) as n from sessions where id = ?').get(sid) as { n: number };
    expect(Number(row.n)).toBe(0);
  });

  it('refuses a signed token whose own expiry has passed, even when its row is still live', async () => {
    const guest = await startGuest();
    const sid = `expired-${Date.now()}`;
    const expired = issueSessionToken(guest.userId, { ttlMs: -60_000, sid });
    await store.createSession({ id: sid, userId: guest.userId, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });

    const out = await invoke(H(gamesGet), '/api/games', { cookie: `dynasty_session=${expired.token}` });
    expect(out.status).toBe(401);
    expect(out.body.error?.code).toBe('not_authenticated');
  });

  it('sets the guest cookie HttpOnly, SameSite=Lax and Path=/, and not Secure outside production', async () => {
    const created = await invoke(H(guestPost), '/api/auth/guest', { method: 'POST', body: {} });
    const setCookie = created.response.headers.getSetCookie().find((c) => c.startsWith('dynasty_session='))!;
    expect(setCookie).toMatch(/; HttpOnly/);
    expect(setCookie).toMatch(/; SameSite=Lax/);
    expect(setCookie).toMatch(/; Path=\//);
    expect(setCookie).not.toMatch(/; Secure/);
  });

  it('marks the cookie Secure in production', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    resetEnvCache();
    const options = sessionCookieOptions();
    expect(options.secure).toBe(true);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
  });

  it('refuses to sign sessions with a per-process secret in production', () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.DYNASTY_APP_SECRET;
    resetEnvCache();
    expect(() => signingSecret()).toThrow(/DYNASTY_APP_SECRET is required in production/);
    expect(() => issueSessionToken('usr_any')).toThrow(/DYNASTY_APP_SECRET is required in production/);
  });

  it('a sign-out sent from another site does not sign the player out', async () => {
    const guest = await startGuest();
    const forged = await invoke(H(logoutPost), '/api/auth/logout', {
      method: 'POST',
      cookie: guest.cookie,
      body: {},
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    expect(forged.status).toBe(403);
    const still = await invoke(H(gamesGet), '/api/games', { cookie: guest.cookie });
    expect(still.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* Cross-site requests are refused on every unsafe game route          */
/* ------------------------------------------------------------------ */

describe('cross-site requests on every unsafe route', () => {
  const FOREIGN = { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' };

  async function versionOf(guest: Guest, gameId: string): Promise<number> {
    const state = await invoke<{ state: GameStateDto; meta: SaveMetadata }>(H(stateGet), `/api/games/${gameId}/state`, { cookie: guest.cookie, params: { gameId } });
    return state.body.data!.meta.version;
  }

  it('refuses a foreign page on each state-changing route, and changes nothing', async () => {
    const guest = await startGuest();
    const { gameId } = await newGame(guest);
    const params = { gameId };
    const before = await versionOf(guest, gameId);
    const gamesBefore = (await invoke<{ count: number }>(H(gamesGet), '/api/games', { cookie: guest.cookie })).body.data!.count;

    const attempts: Array<[string, () => Promise<{ status: number }>]> = [
      ['create game', () => invoke(H(gamesPost), '/api/games', { method: 'POST', cookie: guest.cookie, body: { playerName: 'Forged' }, headers: FOREIGN })],
      ['advance', () => invoke(H(advancePost), `/api/games/${gameId}/advance`, { method: 'POST', cookie: guest.cookie, params, body: { days: 1, expectedVersion: before }, headers: FOREIGN })],
      ['intent', () => invoke(H(intentPost), `/api/games/${gameId}/intent`, { method: 'POST', cookie: guest.cookie, params, body: { expectedVersion: before, intent: { type: 'time.advance_day' } }, headers: FOREIGN })],
      ['restore version', () => invoke(H(restorePost), `/api/games/${gameId}/versions/0`, { method: 'POST', cookie: guest.cookie, params: { gameId, version: '0' }, body: { confirm: true, expectedVersion: before }, headers: FOREIGN })],
      ['delete game', () => invoke(H(gameDelete), `/api/games/${gameId}?confirm=true`, { method: 'DELETE', cookie: guest.cookie, params, headers: FOREIGN })],
    ];
    for (const [name, attempt] of attempts) {
      const out = await attempt();
      expect(out.status, name).toBe(403);
    }

    expect(await versionOf(guest, gameId)).toBe(before);
    const gamesAfter = (await invoke<{ count: number }>(H(gamesGet), '/api/games', { cookie: guest.cookie })).body.data!.count;
    expect(gamesAfter).toBe(gamesBefore);
  });

  it('refuses a request that states no origin and no fetch metadata, on the game route', async () => {
    const guest = await startGuest();
    const { gameId } = await newGame(guest);
    const bare = await invoke(H(advancePost), `/api/games/${gameId}/advance`, { method: 'POST', cookie: guest.cookie, params: { gameId }, body: { days: 1, expectedVersion: 0 }, bare: true });
    expect(bare.status).toBe(403);
    expect(bare.body.error?.code).toBe('forbidden_origin');
    expect(await versionOf(guest, gameId)).toBe(0);
  });

  it('accepts the same routes from the same origin, as the game itself sends them', async () => {
    const guest = await startGuest();
    const { gameId } = await newGame(guest);
    const SAME = { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' };
    const advanced = await invoke(H(advancePost), `/api/games/${gameId}/advance`, { method: 'POST', cookie: guest.cookie, params: { gameId }, body: { days: 1, expectedVersion: 0 }, headers: SAME });
    expect(advanced.status).toBe(200);
    expect(await versionOf(guest, gameId)).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Two guests with the same seed are independent                       */
/* ------------------------------------------------------------------ */

describe('two guests with the same seed', () => {
  it('get separate ids and separate saves, and one guest’s play does not move the other’s save', async () => {
    const a = await startGuest();
    const b = await startGuest();
    const gameA = await newGame(a, { seed: 'shared-seed-42', gameName: 'A' });
    const gameB = await newGame(b, { seed: 'shared-seed-42', gameName: 'B' });

    expect(a.userId).not.toBe(b.userId);
    expect(gameA.gameId).not.toBe(gameB.gameId);

    const advanced = await invoke(H(advancePost), `/api/games/${gameA.gameId}/advance`, {
      method: 'POST',
      cookie: a.cookie,
      params: { gameId: gameA.gameId },
      body: { days: 3, expectedVersion: gameA.version },
    });
    expect(advanced.status).toBe(200);

    const stateB = await invoke<{ state: GameStateDto; meta: SaveMetadata }>(H(stateGet), `/api/games/${gameB.gameId}/state`, { cookie: b.cookie, params: { gameId: gameB.gameId } });
    expect(stateB.body.data!.meta.day).toBe(0);
    expect(stateB.body.data!.meta.version).toBe(gameB.version);
  });
});

/* ------------------------------------------------------------------ */
/* Ownership on every game route, for a second guest                   */
/* ------------------------------------------------------------------ */

describe('ownership on every game route, for a second guest', () => {
  it('returns 404 on the advance and restore routes too, and leaves the owner’s save alone', async () => {
    const owner = await startGuest();
    const intruder = await startGuest();
    const { gameId, version } = await newGame(owner);
    const params = { gameId };

    expect((await invoke(H(advancePost), `/api/games/${gameId}/advance`, { method: 'POST', cookie: intruder.cookie, params, body: { days: 2, expectedVersion: version } })).status).toBe(404);
    expect((await invoke(H(restorePost), `/api/games/${gameId}/versions/0`, { method: 'POST', cookie: intruder.cookie, params: { gameId, version: '0' }, body: { confirm: true, expectedVersion: version } })).status).toBe(404);
    // The view route only ever answers GET; a POST is a 405 for everyone, owner included.
    expect((await invoke(H(viewPost), `/api/games/${gameId}/views/map`, { method: 'POST', cookie: owner.cookie, params: { gameId, view: 'map' }, body: {} })).status).toBe(405);

    const ownerState = await invoke<{ state: GameStateDto; meta: SaveMetadata }>(H(stateGet), `/api/games/${gameId}/state`, { cookie: owner.cookie, params });
    expect(ownerState.body.data!.meta.version).toBe(version);
    expect(ownerState.body.data!.meta.day).toBe(0);
  });
});
