/**
 * Guest identity: the anonymous, server-issued session a player starts with.
 *
 * Drives the real route handlers, service and SQLite adapter, as api.test.ts does. What is
 * proven here:
 *   1. POST /api/auth/guest issues a server-side identity with no email and no password,
 *      delivered as an HttpOnly, SameSite=Lax session cookie and never in the body;
 *   2. the call is idempotent: a valid guest session is resumed, not replaced;
 *   3. nothing is created on a bare page load, and no game is created for the guest;
 *   4. two guests are fully isolated: a guessed id is a 404, lists are per-owner;
 *   5. a guest survives a reload (same cookie) but not a sign-out, and a sign-out is final;
 *   6. a forged or revoked cookie is refused;
 *   7. unsafe requests from a foreign origin are refused before any side effect;
 *   8. the guest entry point is rate limited per client;
 *   9. a legacy SQLite database (email NOT NULL) is rebuilt in place without losing rows.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '../src/persistence/sqlite-store';
import { resetStoreInit, useStoreDriver } from '../src/persistence';
import { GUEST_BUDGET, resetRateLimits } from '../src/server/services/rate-limit';
import { issueSessionToken } from '../src/server/auth/tokens';
import type { GameStateDto } from '../src/server/dto';
import type { SaveMetadata } from '../src/persistence/types';

import { GET as sessionGet } from '../src/app/api/auth/session/route';
import { POST as guestPost } from '../src/app/api/auth/guest/route';
import { POST as logoutPost } from '../src/app/api/auth/logout/route';
import { GET as gamesGet, POST as gamesPost } from '../src/app/api/games/route';
import { DELETE as gameDelete, GET as gameGet } from '../src/app/api/games/[gameId]/route';
import { GET as stateGet } from '../src/app/api/games/[gameId]/state/route';
import { POST as intentPost } from '../src/app/api/games/[gameId]/intent/route';
import { GET as auditGet } from '../src/app/api/audit/route';

const store = new SqliteStore(':memory:');

beforeAll(() => {
  process.env.DYNASTY_APP_SECRET ??= 'test-secret-for-guest-mode-tests-only';
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

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: { path?: string; message: string }[] };
  requestId: string;
}

interface CallOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  host?: string;
}

type RouteHandler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function invoke<T = unknown>(handler: RouteHandler, path: string, options: CallOptions = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const request = new Request(`http://${options.host ?? 'localhost:3000'}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const response = await handler(request, { params: Promise.resolve(options.params ?? {}) });
  const raw = await response.text();
  const body = raw.length > 0 ? (JSON.parse(raw) as Envelope<T>) : ({ ok: false, error: { code: 'empty', message: 'empty body' }, requestId: '' } as Envelope<T>);
  return { status: response.status, body, response, raw };
}

/** Route exports are typed to Next's context; the harness passes the same shape. */
const H = (fn: unknown): RouteHandler => fn as RouteHandler;

/** The session cookie a response sets, as a `cookie:` header for the next request. */
function sessionCookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .filter((cookie) => cookie.startsWith('dynasty_session='))
    .map((cookie) => cookie.split(';')[0] ?? '')
    .join('; ');
}

function setCookieFor(response: Response): string {
  return response.headers.getSetCookie().find((cookie) => cookie.startsWith('dynasty_session=')) ?? '';
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

async function newGame(guest: Guest, overrides: Record<string, unknown> = {}): Promise<{ gameId: string }> {
  const created = await invoke<{ game: { meta: SaveMetadata }; state: GameStateDto }>(H(gamesPost), '/api/games', {
    method: 'POST',
    cookie: guest.cookie,
    body: { playerName: 'Guest Founder', ...overrides },
  });
  expect(created.status).toBe(201);
  return { gameId: created.body.data!.game.meta.gameId };
}

function countProfiles(where = '1 = 1'): number {
  // A separate, read-only probe of the same in-memory database.
  const db = (store as unknown as { db: DatabaseSync }).db;
  const row = db.prepare(`select count(*) as n from profiles where ${where}`).get() as { n: number };
  return Number(row.n);
}

/* ------------------------------------------------------------------ */
/* Issuing a guest identity                                            */
/* ------------------------------------------------------------------ */

describe('guest identity', () => {
  it('issues a server-side guest with no email and no password', async () => {
    const created = await invoke<{ userId: string; displayName: string }>(H(guestPost), '/api/auth/guest', { method: 'POST', body: {} });
    expect(created.status).toBe(201);
    const userId = created.body.data!.userId;
    expect(userId).toMatch(/^gst_/);
    expect(created.body.data!.displayName.length).toBeGreaterThan(0);

    const row = (store as unknown as { db: DatabaseSync }).db
      .prepare('select email, password_hash, auth_provider from profiles where id = ?')
      .get(userId) as { email: string | null; password_hash: string | null; auth_provider: string };
    expect(row.email).toBeNull();
    expect(row.password_hash).toBeNull();
    expect(row.auth_provider).toBe('guest');
  });

  it('delivers the credential only as an HttpOnly, SameSite=Lax session cookie, never in the body', async () => {
    const created = await invoke(H(guestPost), '/api/auth/guest', { method: 'POST', body: {} });
    const setCookie = setCookieFor(created.response);
    expect(setCookie).not.toBe('');
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Max-Age=\d+/);
    const token = sessionCookie(created.response).split('=')[1] ?? '';
    expect(token.length).toBeGreaterThan(20);
    expect(created.raw).not.toContain(token);
    expect(created.raw).not.toMatch(/dynasty_session/);
  });

  it('ignores any identity the client tries to supply in the body', async () => {
    const victim = await startGuest();
    const created = await invoke<{ userId: string }>(H(guestPost), '/api/auth/guest', {
      method: 'POST',
      body: { userId: victim.userId, guestId: victim.userId, email: 'someone@example.com', authProvider: 'local' },
    });
    expect(created.status).toBe(201);
    expect(created.body.data!.userId).not.toBe(victim.userId);
    const row = (store as unknown as { db: DatabaseSync }).db
      .prepare('select email, auth_provider from profiles where id = ?')
      .get(created.body.data!.userId) as { email: string | null; auth_provider: string };
    expect(row.email).toBeNull();
    expect(row.auth_provider).toBe('guest');
  });

  it('reports the guest on the session endpoint with no email and no token', async () => {
    const guest = await startGuest();
    const session = await invoke<{ authenticated: boolean; user: { id: string; email: string | null; provider: string } }>(H(sessionGet), '/api/auth/session', {
      cookie: guest.cookie,
    });
    expect(session.body.data?.authenticated).toBe(true);
    expect(session.body.data?.user.id).toBe(guest.userId);
    expect(session.body.data?.user.provider).toBe('guest');
    expect(session.body.data?.user.email).toBeNull();
    expect(session.raw).not.toContain(guest.cookie.split('=')[1]!);
  });
});

/* ------------------------------------------------------------------ */
/* Idempotence and persistence across reloads                          */
/* ------------------------------------------------------------------ */

describe('resuming a guest session', () => {
  it('resumes a valid guest session instead of creating another', async () => {
    const guest = await startGuest();
    const before = countProfiles("auth_provider = 'guest'");
    const again = await invoke<{ userId: string }>(H(guestPost), '/api/auth/guest', { method: 'POST', body: {}, cookie: guest.cookie });
    expect(again.status).toBe(200);
    expect(again.body.data?.userId).toBe(guest.userId);
    expect(countProfiles("auth_provider = 'guest'")).toBe(before);
    expect(setCookieFor(again.response)).toBe('');
  });

  it('keeps the same guest across a reload, with the same cookie', async () => {
    const guest = await startGuest();
    const first = await invoke<{ authenticated: boolean; user: { id: string } }>(H(sessionGet), '/api/auth/session', { cookie: guest.cookie });
    const reload = await invoke<{ authenticated: boolean; user: { id: string } }>(H(sessionGet), '/api/auth/session', { cookie: guest.cookie });
    expect(first.body.data?.user.id).toBe(guest.userId);
    expect(reload.body.data?.user.id).toBe(guest.userId);
  });

  it('does not create a guest or a game on a bare page-load session check', async () => {
    const before = countProfiles("auth_provider = 'guest'");
    const anonymous = await invoke<{ authenticated: boolean }>(H(sessionGet), '/api/auth/session');
    expect(anonymous.body.data?.authenticated).toBe(false);
    expect(countProfiles("auth_provider = 'guest'")).toBe(before);
    expect(anonymous.response.headers.getSetCookie().filter((c) => c.startsWith('dynasty_session='))).toHaveLength(0);
  });

  it('starts a new guest with no games of its own', async () => {
    const guest = await startGuest();
    const games = await invoke<{ games: SaveMetadata[]; count: number }>(H(gamesGet), '/api/games', { cookie: guest.cookie });
    expect(games.status).toBe(200);
    expect(games.body.data?.count).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Ownership between guests                                            */
/* ------------------------------------------------------------------ */

describe('guest ownership', () => {
  it('lets a guest play a game it owns, and reload the same save', async () => {
    const guest = await startGuest();
    const { gameId } = await newGame(guest);
    const state = await invoke<{ state: GameStateDto }>(H(stateGet), `/api/games/${gameId}/state`, { cookie: guest.cookie, params: { gameId } });
    expect(state.status).toBe(200);
    expect(JSON.stringify(state.body.data)).not.toMatch(/worldSeed/);
  });

  it('gives a second guest a 404 for the first guest’s save, on every game route', async () => {
    const owner = await startGuest();
    const intruder = await startGuest();
    const { gameId } = await newGame(owner);
    const params = { gameId };

    expect((await invoke(H(gameGet), `/api/games/${gameId}`, { cookie: intruder.cookie, params })).status).toBe(404);
    expect((await invoke(H(stateGet), `/api/games/${gameId}/state`, { cookie: intruder.cookie, params })).status).toBe(404);
    expect((await invoke(H(intentPost), `/api/games/${gameId}/intent`, { method: 'POST', cookie: intruder.cookie, params, body: { expectedVersion: 0, intent: { type: 'time.advance_day' } } })).status).toBe(404);
    expect((await invoke(H(gameDelete), `/api/games/${gameId}?confirm=true`, { method: 'DELETE', cookie: intruder.cookie, params })).status).toBe(404);
  });

  it('lists only the caller’s own guest saves', async () => {
    const a = await startGuest();
    const b = await startGuest();
    const aGame = await newGame(a);
    await newGame(b);
    const listed = await invoke<{ games: { gameId: string }[] }>(H(gamesGet), '/api/games', { cookie: a.cookie });
    expect(listed.body.data?.games.map((g) => g.gameId)).toEqual([aGame.gameId]);
  });

  it('does not let a client name the owner of a new save', async () => {
    const a = await startGuest();
    const b = await startGuest();
    const created = await invoke<{ game: { meta: SaveMetadata } }>(H(gamesPost), '/api/games', {
      method: 'POST',
      cookie: a.cookie,
      body: { playerName: 'Injected', userId: b.userId, ownerId: b.userId },
    });
    expect(created.status).toBe(201);
    expect(created.body.data!.game.meta.userId).toBe(a.userId);
  });

  it('keeps the audit trail private to the guest that produced it', async () => {
    const a = await startGuest();
    const b = await startGuest();
    await newGame(a);
    const bAudit = await invoke<{ rows: unknown[] }>(H(auditGet), '/api/audit', { cookie: b.cookie });
    expect(bAudit.status).toBe(200);
    expect(JSON.stringify(bAudit.body.data)).not.toContain(a.userId);
  });
});

/* ------------------------------------------------------------------ */
/* Ending a session is final                                           */
/* ------------------------------------------------------------------ */

describe('ending a guest session', () => {
  it('revokes the cookie server-side so a copy of it stops working', async () => {
    const guest = await startGuest();
    const out = await invoke(H(logoutPost), '/api/auth/logout', { method: 'POST', cookie: guest.cookie, body: {} });
    expect(out.status).toBe(200);
    const replay = await invoke(H(gamesGet), '/api/games', { cookie: guest.cookie });
    expect(replay.status).toBe(401);
    expect(replay.body.error?.code).toBe('not_authenticated');
  });

  it('does not recover the old guest after sign-out: the next start is a new identity', async () => {
    const guest = await startGuest();
    await newGame(guest);
    await invoke(H(logoutPost), '/api/auth/logout', { method: 'POST', cookie: guest.cookie, body: {} });
    const fresh = await startGuest();
    expect(fresh.userId).not.toBe(guest.userId);
    const games = await invoke<{ count: number }>(H(gamesGet), '/api/games', { cookie: fresh.cookie });
    expect(games.body.data?.count).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Forged and malformed credentials                                    */
/* ------------------------------------------------------------------ */

describe('credential integrity', () => {
  it('refuses a cookie for a real session that is signed with a different secret', async () => {
    const guest = await startGuest();
    const payloadText = guest.cookie.split('=')[1]!.split('.')[1]!;
    const forgedSignature = createHmac('sha256', 'an-attacker-chosen-secret').update(payloadText).digest('base64url');
    const outcome = await invoke(H(gamesGet), '/api/games', { cookie: `dynasty_session=v1.${payloadText}.${forgedSignature}` });
    expect(outcome.status).toBe(401);
    expect(outcome.body.error?.code).toBe('not_authenticated');
  });

  it('refuses a cookie whose session row was never stored', async () => {
    const orphan = issueSessionToken((await startGuest()).userId, { ttlMs: 60_000 });
    const outcome = await invoke(H(gamesGet), '/api/games', { cookie: `dynasty_session=${orphan.token}` });
    expect(outcome.status).toBe(401);
  });

  it('refuses an edited cookie payload', async () => {
    const guest = await startGuest();
    const [prefix, , signature] = guest.cookie.split('=')[1]!.split('.');
    const altered = Buffer.from(JSON.stringify({ sid: 'x', userId: 'usr_someone_else', exp: Date.now() + 1e9, iat: Date.now() }), 'utf8').toString('base64url');
    const outcome = await invoke(H(gamesGet), '/api/games', { cookie: `dynasty_session=${prefix}.${altered}.${signature}` });
    expect(outcome.status).toBe(401);
  });
});

/* ------------------------------------------------------------------ */
/* Origin checks                                                       */
/* ------------------------------------------------------------------ */

describe('origin checks on unsafe requests', () => {
  it('refuses a guest request from a foreign origin, before creating anything', async () => {
    const before = countProfiles("auth_provider = 'guest'");
    const refused = await invoke(H(guestPost), '/api/auth/guest', { method: 'POST', body: {}, headers: { origin: 'https://evil.example' } });
    expect(refused.status).toBe(403);
    expect(refused.body.error?.code).toBe('forbidden_origin');
    expect(setCookieFor(refused.response)).toBe('');
    expect(countProfiles("auth_provider = 'guest'")).toBe(before);
  });

  it('accepts a request whose origin matches the host it was sent to', async () => {
    const accepted = await invoke(H(guestPost), '/api/auth/guest', { method: 'POST', body: {}, headers: { origin: 'http://localhost:3000' } });
    expect(accepted.status).toBe(201);
  });

  it('accepts a request with no Origin header, as non-browser clients send', async () => {
    const accepted = await invoke(H(guestPost), '/api/auth/guest', { method: 'POST', body: {} });
    expect(accepted.status).toBe(201);
  });

  it('refuses a cross-site fetch even when Origin is absent', async () => {
    const refused = await invoke(H(guestPost), '/api/auth/guest', { method: 'POST', body: {}, headers: { 'sec-fetch-site': 'cross-site' } });
    expect(refused.status).toBe(403);
  });

  it('accepts a same-origin request even when a proxy has rewritten the Host it arrived under', async () => {
    // The browser decides "same-origin" from the URL it actually used. A preview proxy that
    // rewrites Host must not turn the game's own requests into refusals.
    const accepted = await invoke(H(guestPost), '/api/auth/guest', {
      method: 'POST',
      body: {},
      host: 'localhost:3000',
      headers: { origin: 'https://3000-preview.example.test', 'sec-fetch-site': 'same-origin' },
    });
    expect(accepted.status).toBe(201);
  });

  it('refuses a same-site request from another origin on the same site', async () => {
    const refused = await invoke(H(guestPost), '/api/auth/guest', {
      method: 'POST',
      body: {},
      headers: { origin: 'https://sibling.example.test', 'sec-fetch-site': 'same-site' },
    });
    expect(refused.status).toBe(403);
  });

  it('refuses an opaque origin, the form a sandboxed page sends', async () => {
    const refused = await invoke(H(guestPost), '/api/auth/guest', { method: 'POST', body: {}, headers: { origin: 'null' } });
    expect(refused.status).toBe(403);
  });

  it('refuses a foreign origin on an authenticated game command, before the save is touched', async () => {
    const guest = await startGuest();
    const { gameId } = await newGame(guest);
    const before = await invoke<{ game: { meta: SaveMetadata } }>(H(gameGet), `/api/games/${gameId}`, { cookie: guest.cookie, params: { gameId } });
    const refused = await invoke(H(intentPost), `/api/games/${gameId}/intent`, {
      method: 'POST',
      cookie: guest.cookie,
      params: { gameId },
      headers: { origin: 'https://evil.example' },
      body: { expectedVersion: before.body.data!.game.meta.version, intent: { type: 'time.advance_day' } },
    });
    expect(refused.status).toBe(403);
    const after = await invoke<{ game: { meta: SaveMetadata } }>(H(gameGet), `/api/games/${gameId}`, { cookie: guest.cookie, params: { gameId } });
    expect(after.body.data!.game.meta.version).toBe(before.body.data!.game.meta.version);
  });

  it('does not apply the origin check to safe reads', async () => {
    const read = await invoke(H(sessionGet), '/api/auth/session', { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
    expect(read.status).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* Rate limits                                                         */
/* ------------------------------------------------------------------ */

describe('rate limits on guest creation', () => {
  it('limits how many guests one client can start within the window', async () => {
    let last = 0;
    let retryAfter: string | null = null;
    for (let i = 0; i < GUEST_BUDGET.limit + 1; i++) {
      const out = await invoke(H(guestPost), '/api/auth/guest', { method: 'POST', body: {}, headers: { 'x-forwarded-for': '203.0.113.7' } });
      last = out.status;
      if (out.status === 429) retryAfter = out.response.headers.get('retry-after');
    }
    expect(last).toBe(429);
    expect(retryAfter).not.toBeNull();
  });

  it('does not let one client exhaust the budget for another', async () => {
    const other = await invoke(H(guestPost), '/api/auth/guest', { method: 'POST', body: {}, headers: { 'x-forwarded-for': '198.51.100.9' } });
    expect(other.status).toBe(201);
  });
});

/* ------------------------------------------------------------------ */
/* Legacy SQLite databases                                             */
/* ------------------------------------------------------------------ */

describe('upgrading an existing SQLite database', () => {
  it('rebuilds profiles with a nullable email in place, keeping rows and foreign keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dynasty-legacy-'));
    const path = join(dir, 'legacy.sqlite');
    try {
      const legacy = new DatabaseSync(path);
      legacy.exec('pragma foreign_keys = on;');
      legacy.exec(`
        create table profiles (
          id text primary key, email text not null unique, display_name text not null,
          auth_provider text not null default 'local', password_hash text,
          created_at text not null, last_seen_at text
        );
        create table sessions (
          id text primary key, user_id text not null references profiles (id) on delete cascade,
          created_at text not null, expires_at text not null, user_agent text
        );
        insert into profiles (id, email, display_name, auth_provider, password_hash, created_at)
          values ('usr_legacy', 'legacy@example.com', 'Legacy', 'local', 'hash', '2025-01-01T00:00:00.000Z');
        insert into sessions (id, user_id, created_at, expires_at) values ('ses_legacy', 'usr_legacy', '2025-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z');
      `);
      legacy.close();

      const upgraded = new SqliteStore(path);
      await upgraded.init();
      const kept = await upgraded.findUserByEmail('legacy@example.com');
      expect(kept.ok && kept.value?.id).toBe('usr_legacy');
      const session = await upgraded.findSession('ses_legacy');
      expect(session.ok && session.value?.userId).toBe('usr_legacy');

      const guest = await upgraded.createUser({ id: 'gst_upgrade', email: null, displayName: 'Guest', passwordHash: null, authProvider: 'guest' });
      expect(guest.ok).toBe(true);

      const probe = new DatabaseSync(path);
      const column = (probe.prepare('pragma table_info(profiles)').all() as { name: string; notnull: number }[]).find((c) => c.name === 'email');
      expect(column?.notnull).toBe(0);
      probe.exec('pragma foreign_keys = on;');
      expect(() => probe.prepare("insert into sessions (id, user_id, created_at, expires_at) values ('ses_orphan', 'usr_missing', 'x', 'x')").run()).toThrow();
      probe.close();
      await upgraded.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
