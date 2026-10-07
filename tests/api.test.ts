/**
 * Phase 1A — API / application layer integration tests.
 *
 * These drive the real route handlers, the real service layer, the real simulation and
 * the real SQLite persistence adapter. Nothing is mocked: a request goes in, an
 * authoritative command runs, a save is written with a compare-and-set, and the
 * response is inspected — including a scan for internal keys that must never reach a
 * browser.
 *
 * What is proven here:
 *   1. authentication is required, and identity comes from the session, never a body;
 *   2. ownership is enforced by the query, so a guessed game id is a 404;
 *   3. every command carries a version, and a stale version is a conflict, not a
 *      silent overwrite;
 *   4. a retried command with the same idempotency key replays instead of double-applying;
 *   5. a client cannot inject money, quantity, price or an outcome;
 *   6. validation bounds hold (advance ≤ 30 days, no negative quantities, no NaN);
 *   7. every read model answers, and no response body contains an internal key.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SqliteStore } from '../src/persistence/sqlite-store';
import { resetStoreInit, useStoreDriver } from '../src/persistence';
import { resetRateLimits } from '../src/server/services/rate-limit';
import { getWorldRegistry } from '../src/engine/registry';
import { SERVER_ONLY_REPORT_FIELDS, findForbiddenKeys } from '../src/server/dto';
import type { GameStateDto } from '../src/server/dto';
import type { SaveMetadata, SaveVersionRow } from '../src/persistence/types';

import { GET as sessionGet } from '../src/app/api/auth/session/route';
import { POST as registerPost } from '../src/app/api/auth/register/route';
import { POST as loginPost } from '../src/app/api/auth/login/route';
import { POST as logoutPost } from '../src/app/api/auth/logout/route';
import { GET as gamesGet, POST as gamesPost } from '../src/app/api/games/route';
import { DELETE as gameDelete, GET as gameGet } from '../src/app/api/games/[gameId]/route';
import { GET as stateGet } from '../src/app/api/games/[gameId]/state/route';
import { POST as intentPost } from '../src/app/api/games/[gameId]/intent/route';
import { POST as advancePost } from '../src/app/api/games/[gameId]/advance/route';
import { GET as viewsGet } from '../src/app/api/games/[gameId]/views/route';
import { GET as viewGet } from '../src/app/api/games/[gameId]/views/[view]/route';
import { GET as versionsGet } from '../src/app/api/games/[gameId]/versions/route';
import { POST as restorePost } from '../src/app/api/games/[gameId]/versions/[version]/route';
import { GET as leaderboardGet } from '../src/app/api/leaderboard/route';
import { GET as auditGet } from '../src/app/api/audit/route';
import { GET as healthGet } from '../src/app/api/health/route';

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

const store = new SqliteStore(':memory:');
const world = getWorldRegistry();

/**
 * The commodity the player starts with. The starter position is chosen by the world
 * seed, so tests read it from the authoritative state rather than assuming one.
 */
function starterCommodity(game: TestGame): string {
  const stack = game.state.player.inventory[0];
  if (!stack) throw new Error('The starter save has no inventory stack to trade.');
  return stack.commodityId;
}

beforeAll(() => {
  process.env.DYNASTY_APP_SECRET ??= 'test-secret-for-api-tests-only';
  useStoreDriver('sqlite', store);
  resetStoreInit();
});

afterAll(async () => {
  await store.close();
  useStoreDriver(null, undefined);
});

beforeEach(() => {
  // Rate limits are per process; a fresh window per test keeps them from leaking.
  resetRateLimits();
});

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
}

type RouteHandler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** Invoke a route handler exactly as Next would, and parse the envelope. */
async function invoke<T = unknown>(handler: RouteHandler, path: string, options: CallOptions = {}): Promise<{ status: number; body: Envelope<T>; response: Response; raw: string }> {
  const headers = new Headers(options.headers ?? {});
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const request = new Request(`http://localhost:3000${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const response = await handler(request, { params: Promise.resolve(options.params ?? {}) });
  const raw = await response.text();
  const body = raw.length > 0 ? (JSON.parse(raw) as Envelope<T>) : ({ ok: false, error: { code: 'empty', message: 'empty body' }, requestId: '' } as Envelope<T>);
  return { status: response.status, body, response, raw };
}

/** Cookies from a response, as a `cookie:` header for the next request. */
function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .filter(Boolean)
    .join('; ');
}

interface TestUser {
  cookie: string;
  userId: string;
  email: string;
}

let userSeq = 0;

async function newUser(): Promise<TestUser> {
  const email = `player${++userSeq}@example.com`;
  const registered = await invoke<{ userId: string }>(registerPost as unknown as RouteHandler, '/api/auth/register', {
    method: 'POST',
    body: { email, password: 'Correct-Horse-Battery-9', displayName: `Player ${userSeq}` },
  });
  expect(registered.status).toBe(201);
  return { cookie: cookieHeader(registered.response), userId: registered.body.data!.userId, email };
}

interface TestGame {
  gameId: string;
  state: GameStateDto;
}

/** A game as the client sees it: created through the API, state read back through it. */
async function newGame(user: TestUser, overrides: Record<string, unknown> = {}): Promise<TestGame> {
  const created = await invoke<{ game: { meta: SaveMetadata }; state: GameStateDto }>(gamesPost as unknown as RouteHandler, '/api/games', {
    method: 'POST',
    cookie: user.cookie,
    body: { playerName: `Founder ${userSeq}`, ...overrides },
  });
  expect(created.status).toBe(201);
  const gameId = created.body.data!.game.meta.gameId;
  const state = await invoke<{ state: GameStateDto }>(stateGet as unknown as RouteHandler, `/api/games/${gameId}/state`, {
    cookie: user.cookie,
    params: { gameId },
  });
  return { gameId, state: state.body.data!.state };
}

const bearer = (user: TestUser) => ({ cookie: user.cookie });

/**
 * The safety net must never have to fire.
 *
 * `okJson` strips a fixed list of internal keys from every success body, so a leak is
 * invisible from the client's side — which is exactly why it is dangerous: a response
 * could be carrying a raw simulation document and every test would still pass. If the
 * redaction header is set, a DTO builder is wrong, so every command assertion checks it.
 */
function expectNoRedaction(response: Response, label: string): void {
  expect(response.headers.get('x-dynasty-redacted'), `${label} required redaction of internal keys`).toBeNull();
}



/* ------------------------------------------------------------------ */
/* Authentication and session                                          */
/* ------------------------------------------------------------------ */

describe('authentication', () => {
  it('reports an anonymous session without failing', async () => {
    const result = await invoke(sessionGet as unknown as RouteHandler, '/api/auth/session');
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect((result.body.data as { authenticated: boolean }).authenticated).toBe(false);
  });

  it('signs up, reports the identity, and refuses unauthenticated game access', async () => {
    const user = await newUser();

    const session = await invoke<{ authenticated: boolean; user: { id: string } }>(sessionGet as unknown as RouteHandler, '/api/auth/session', {
      ...bearer(user),
    });
    expect(session.body.data?.authenticated).toBe(true);
    expect(session.body.data?.user.id).toBe(user.userId);

    const anonymous = await invoke(gamesGet as unknown as RouteHandler, '/api/games');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error?.code).toBe('not_authenticated');
  });

  it('signs in with the same credentials and revokes the session on logout', async () => {
    const user = await newUser();
    const login = await invoke(loginPost as unknown as RouteHandler, '/api/auth/login', {
      method: 'POST',
      // Email case must not matter.
      body: { email: user.email.toUpperCase(), password: 'Correct-Horse-Battery-9' },
    });
    expect(login.status).toBe(200);
    const cookie = cookieHeader(login.response);
    expect(cookie.length).toBeGreaterThan(0);

    const logout = await invoke(logoutPost as unknown as RouteHandler, '/api/auth/logout', { method: 'POST', cookie, body: {} });
    expect(logout.status).toBe(200);

    const after = await invoke<{ authenticated: boolean }>(sessionGet as unknown as RouteHandler, '/api/auth/session', { cookie });
    expect(after.body.data?.authenticated).toBe(false);
  });

  it('rejects a wrong password without revealing whether the account exists', async () => {
    const user = await newUser();
    const wrongPassword = await invoke(loginPost as unknown as RouteHandler, '/api/auth/login', {
      method: 'POST',
      body: { email: user.email, password: 'not-the-password' },
    });
    const unknownAccount = await invoke(loginPost as unknown as RouteHandler, '/api/auth/login', {
      method: 'POST',
      body: { email: 'nobody@example.com', password: 'not-the-password' },
    });
    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    expect(unknownAccount.body.error?.message).toBe(wrongPassword.body.error?.message);
  });
});

/* ------------------------------------------------------------------ */
/* Ownership                                                           */
/* ------------------------------------------------------------------ */

describe('ownership', () => {
  it('gives another account a 404 rather than somebody else\'s game', async () => {
    const owner = await newUser();
    const intruder = await newUser();
    const game = await newGame(owner);

    const asIntruderState = await invoke<{ state: GameStateDto }>(stateGet as unknown as RouteHandler, `/api/games/${game.gameId}/state`, {
      cookie: intruder.cookie,
      params: { gameId: game.gameId },
    });
    expect(asIntruderState.status).toBe(404);
    expect(asIntruderState.body.error?.code).toBe('not_found');

    const asIntruderSummary = await invoke(gameGet as unknown as RouteHandler, `/api/games/${game.gameId}`, {
      cookie: intruder.cookie,
      params: { gameId: game.gameId },
    });
    expect(asIntruderSummary.status).toBe(404);

    const command = await invoke(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
      method: 'POST',
      cookie: intruder.cookie,
      params: { gameId: game.gameId },
      body: { intent: { type: 'time.advance_day' }, expectedVersion: game.state.meta.version },
    });
    expect(command.status).toBe(404);

    const view = await invoke(viewGet as unknown as RouteHandler, `/api/games/${game.gameId}/views/finance`, {
      cookie: intruder.cookie,
      params: { gameId: game.gameId, view: 'finance' },
    });
    expect(view.status).toBe(404);

    // The owner's game is untouched.
    const intact = await invoke<{ state: GameStateDto }>(stateGet as unknown as RouteHandler, `/api/games/${game.gameId}/state`, {
      cookie: owner.cookie,
      params: { gameId: game.gameId },
    });
    expect(intact.body.data?.state.meta.version).toBe(game.state.meta.version);
  });

  it('lists only the caller\'s own saves', async () => {
    const a = await newUser();
    const b = await newUser();
    await newGame(a);
    const list = await invoke<{ games: SaveMetadata[] }>(gamesGet as unknown as RouteHandler, '/api/games', { cookie: b.cookie });
    expect(list.status).toBe(200);
    expect(list.body.data?.games).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Commands: CAS, validation, idempotency                              */
/* ------------------------------------------------------------------ */

describe('command pipeline', () => {
  it('requires the version a command was planned against', async () => {
    const user = await newUser();
    const game = await newGame(user);
    const noVersion = await invoke(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
      method: 'POST',
      cookie: user.cookie,
      params: { gameId: game.gameId },
      body: { intent: { type: 'time.advance_day' } },
    });
    expect(noVersion.status).toBe(400);
    expect(noVersion.body.error?.code).toBe('validation_failed');
    expect(noVersion.body.error?.message).toContain('expectedVersion');
  });

  it('rejects a stale version with a conflict and writes nothing', async () => {
    const user = await newUser();
    const game = await newGame(user);

    const first = await invoke(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
      method: 'POST',
      cookie: user.cookie,
      params: { gameId: game.gameId },
      body: { intent: { type: 'time.advance_day' }, expectedVersion: game.state.meta.version },
    });
    expect(first.status).toBe(200);

    // The same version again: the save has moved on, so this must be refused.
    const stale = await invoke(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
      method: 'POST',
      cookie: user.cookie,
      params: { gameId: game.gameId },
      body: { intent: { type: 'time.advance_day' }, expectedVersion: game.state.meta.version },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe('conflict');

    const state = await invoke<{ state: GameStateDto }>(stateGet as unknown as RouteHandler, `/api/games/${game.gameId}/state`, {
      cookie: user.cookie,
      params: { gameId: game.gameId },
    });
    // Exactly one day advanced: the conflict did not apply.
    expect(state.body.data?.state.meta.version).toBe(game.state.meta.version + 1);
    expect(state.body.data?.state.world.day).toBe(game.state.world.day + 1);
  });

  it('runs a real command and returns the updated authoritative state', async () => {
    const user = await newUser();
    const game = await newGame(user);
    const commodity = starterCommodity(game);

    const held = (state: GameStateDto, commodityId: string) =>
      state.player.inventory.filter((stack) => stack.commodityId === commodityId).reduce((sum, stack) => sum + stack.qty, 0);
    const before = held(game.state, commodity);

    const bought = await invoke<{ ok: boolean; replayed: boolean; state: GameStateDto; meta: SaveMetadata; saved: boolean }>(
      intentPost as unknown as RouteHandler,
      `/api/games/${game.gameId}/intent`,
      {
        method: 'POST',
        cookie: user.cookie,
        params: { gameId: game.gameId },
        body: { intent: { type: 'trade.buy', commodityId: commodity, qty: 1 }, expectedVersion: game.state.meta.version, requestId: 'buy-1' },
      },
    );

    expect(bought.status).toBe(200);
    expectNoRedaction(bought.response, 'intent (trade.buy)');
    expect(bought.body.data?.ok).toBe(true);
    expect(bought.body.data?.replayed).toBe(false);
    expect(bought.body.data?.saved).toBe(true);
    expect(bought.body.data?.meta.version).toBe(game.state.meta.version + 1);

    expect(held(bought.body.data!.state, commodity)).toBe(before + 1);
  });

  it('replays a retried command instead of buying twice', async () => {
    const user = await newUser();
    const game = await newGame(user);
    const commodity = starterCommodity(game);
    const body = {
      intent: { type: 'trade.buy', commodityId: commodity, qty: 1 },
      expectedVersion: game.state.meta.version,
      requestId: 'retry-me-please',
    };

    const first = await invoke<{ meta: SaveMetadata; replayed: boolean; state: GameStateDto }>(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
      method: 'POST',
      cookie: user.cookie,
      params: { gameId: game.gameId },
      body,
    });
    expect(first.status).toBe(200);
    expectNoRedaction(first.response, 'intent (retry base)');

    // The identical retry: same key, same payload, same version — the classic
    // "response timed out but the write committed" case.
    const retry = await invoke<{ meta: SaveMetadata; replayed: boolean; state: GameStateDto }>(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
      method: 'POST',
      cookie: user.cookie,
      params: { gameId: game.gameId },
      body,
    });

    expect(retry.status).toBe(200);
    expectNoRedaction(retry.response, 'intent (replayed)');
    expect(retry.body.data?.replayed).toBe(true);
    // Nothing was applied a second time: version and holdings are identical.
    expect(retry.body.data?.meta.version).toBe(first.body.data?.meta.version);
    const totalHeld = (state: GameStateDto) =>
      state.player.inventory.filter((stack) => stack.commodityId === commodity).reduce((sum, stack) => sum + stack.qty, 0);
    expect(totalHeld(retry.body.data!.state)).toBe(totalHeld(first.body.data!.state));
  });

  it('refuses an idempotency key reused for a different command', async () => {
    const user = await newUser();
    const game = await newGame(user);
    const key = 'shared-key';
    const first = await invoke(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
      method: 'POST',
      cookie: user.cookie,
      params: { gameId: game.gameId },
      body: { intent: { type: 'time.advance_day' }, expectedVersion: game.state.meta.version, requestId: key },
    });
    expect(first.status).toBe(200);

    const reused = await invoke(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
      method: 'POST',
      cookie: user.cookie,
      params: { gameId: game.gameId },
      body: { intent: { type: 'time.advance_days', days: 2 }, expectedVersion: game.state.meta.version, requestId: key },
    });
    expect(reused.status).toBe(409);
    expect(reused.body.error?.message).toContain('already used for a different action');
  });

  it('lets exactly one of two racing commands win', async () => {
    const user = await newUser();
    const game = await newGame(user);
    const version = game.state.meta.version;

    const [a, b] = await Promise.all([
      invoke(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
        method: 'POST',
        cookie: user.cookie,
        params: { gameId: game.gameId },
        body: { intent: { type: 'time.advance_day' }, expectedVersion: version, requestId: 'race-a' },
      }),
      invoke(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
        method: 'POST',
        cookie: user.cookie,
        params: { gameId: game.gameId },
        body: { intent: { type: 'time.advance_day' }, expectedVersion: version, requestId: 'race-b' },
      }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const state = await invoke<{ state: GameStateDto }>(stateGet as unknown as RouteHandler, `/api/games/${game.gameId}/state`, {
      cookie: user.cookie,
      params: { gameId: game.gameId },
    });
    // One day was simulated, not two.
    expect(state.body.data?.state.world.day).toBe(game.state.world.day + 1);
    expect(state.body.data?.state.meta.version).toBe(version + 1);
  });

  it('ignores client-supplied money, price and outcome fields', async () => {
    const user = await newUser();
    const game = await newGame(user);
    const commodity = starterCommodity(game);
    const injected = { price: 0.01, total: 0.01, cash: 1e11, ok: true, xp: 999_999, level: 99, netWorth: 1e12 };

    // 1. A read-only quote must be byte-identical with and without injected fields,
    //    which is the clearest proof that the schema strips what the client adds.
    const clean = await invoke<{ data?: { quote?: { effectiveUnitPrice: number } } }>(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
      method: 'POST',
      cookie: user.cookie,
      params: { gameId: game.gameId },
      body: { intent: { type: 'trade.quote_buy', commodityId: commodity, qty: 1 }, expectedVersion: game.state.meta.version },
    });
    const forgedQuote = await invoke<{ data?: { quote?: { effectiveUnitPrice: number } } }>(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
      method: 'POST',
      cookie: user.cookie,
      params: { gameId: game.gameId },
      body: { intent: { type: 'trade.quote_buy', commodityId: commodity, qty: 1, ...injected }, expectedVersion: game.state.meta.version },
    });
    expect(forgedQuote.status).toBe(200);
    expect(forgedQuote.body.data?.data?.quote?.effectiveUnitPrice).toBe(clean.body.data?.data?.quote?.effectiveUnitPrice);

    // 2. A real purchase settles at the server's own quote, and the injected numbers
    //    have no effect on cash or progression.
    const cashBefore = game.state.player.accounts.reduce((sum, account) => sum + account.balance, 0);
    const bought = await invoke<{ data?: { quote?: { effectiveUnitPrice: number; fees: { amount: number }[] } }; state: GameStateDto }>(
      intentPost as unknown as RouteHandler,
      `/api/games/${game.gameId}/intent`,
      {
        method: 'POST',
        cookie: user.cookie,
        params: { gameId: game.gameId },
        body: { intent: { type: 'trade.buy', commodityId: commodity, qty: 1, ...injected }, expectedVersion: game.state.meta.version, requestId: 'forged-buy' },
      },
    );
    expect(bought.status).toBe(200);
    const quote = bought.body.data!.data!.quote!;
    const fees = quote.fees.reduce((sum, fee) => sum + fee.amount, 0);
    const cashAfter = bought.body.data!.state.player.accounts.reduce((sum, account) => sum + account.balance, 0);
    // Paid the quoted price plus the server's fees — not `price: 0.01`.
    expect(cashBefore - cashAfter).toBeCloseTo(quote.effectiveUnitPrice + fees, 6);
    expect(cashBefore - cashAfter).toBeGreaterThan(1);
    // No XP or level was granted by the payload.
    expect(bought.body.data!.state.player.progression.level).toBe(game.state.player.progression.level);
  });

  it('rejects malformed intents with a field-level error', async () => {
    const user = await newUser();
    const game = await newGame(user);
    const cases: unknown[] = [
      { type: 'trade.buy', commodityId: starterCommodity(game), qty: -5 },
      { type: 'trade.buy', commodityId: starterCommodity(game), qty: 0 },
      { type: 'trade.buy', commodityId: starterCommodity(game), qty: Number.NaN },
      { type: 'trade.buy', commodityId: '', qty: 1 },
      { type: 'trade.buy', commodityId: starterCommodity(game), qty: 1e9 },
      { type: 'not.a.real.intent' },
      'trade.buy',
    ];
    for (const intent of cases) {
      const result = await invoke(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
        method: 'POST',
        cookie: user.cookie,
        params: { gameId: game.gameId },
        body: { intent, expectedVersion: game.state.meta.version },
      });
      expect(result.status, JSON.stringify(intent)).toBe(400);
      expect(result.body.error?.code).toBe('validation_failed');
    }
  });

  it('bounds advance-time per request and reports the bound', async () => {
    const user = await newUser();
    const game = await newGame(user);

    const tooLong = await invoke(advancePost as unknown as RouteHandler, `/api/games/${game.gameId}/advance`, {
      method: 'POST',
      cookie: user.cookie,
      params: { gameId: game.gameId },
      body: { days: 31, expectedVersion: game.state.meta.version, requestId: 'too-long' },
    });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error?.message).toContain('30');

    const ok = await invoke<{ state: GameStateDto; meta: SaveMetadata; data?: unknown; dataTruncated?: boolean }>(advancePost as unknown as RouteHandler, `/api/games/${game.gameId}/advance`, {
      method: 'POST',
      cookie: user.cookie,
      params: { gameId: game.gameId },
      body: { days: 3, expectedVersion: game.state.meta.version, requestId: 'three-days' },
    });
    expect(ok.status).toBe(200);
    expectNoRedaction(ok.response, 'advance');
    expect(ok.body.data?.state.world.day).toBe(game.state.world.day + 3);
    expect(ok.body.data?.meta.version).toBe(game.state.meta.version + 1);
    // The day report is present, and the ops-only timing field is not.
    expect(findForbiddenKeys(ok.body.data)).toEqual([]);
    // The server's own tick timing is ops information, not game state: it is declared
    // server-only in SERVER_ONLY_REPORT_FIELDS and omitted from the public contract.
    // The report is *whole* — no truncation marker — which is what makes the missing
    // field a deliberate omission rather than a trimmed payload.
    expect(JSON.stringify(ok.body.data)).not.toContain('"elapsedMs"');
    const report = ok.body.data?.data as { days?: number; reports?: unknown[] } | undefined;
    expect(report?.days).toBe(3);
    expect(report?.reports).toHaveLength(3);
    expect(ok.body.data?.dataTruncated).toBeUndefined();
    expect(SERVER_ONLY_REPORT_FIELDS).toEqual(['elapsedMs']);
  });

  it('advances a single day with a full report and no server-only timing field', async () => {
    const user = await newUser();
    const game = await newGame(user);

    const ok = await invoke<{ state: GameStateDto; meta: SaveMetadata; data?: unknown; dataTruncated?: boolean }>(
      advancePost as unknown as RouteHandler,
      `/api/games/${game.gameId}/advance`,
      {
        method: 'POST',
        cookie: user.cookie,
        params: { gameId: game.gameId },
        body: { days: 1, expectedVersion: game.state.meta.version, requestId: 'one-day' },
      },
    );
    expect(ok.status).toBe(200);
    expectNoRedaction(ok.response, 'advance one day');
    expect(ok.body.data?.dataTruncated).toBeUndefined();
    const report = ok.body.data?.data as { day?: number; phases?: unknown[]; netWorthChange?: number } | undefined;
    expect(report?.day).toBe(game.state.world.day + 1);
    expect(Array.isArray(report?.phases)).toBe(true);
    expect(typeof report?.netWorthChange).toBe('number');
    expect(JSON.stringify(ok.body.data)).not.toContain('"elapsedMs"');
  });

  it('replays a refused command without consuming another turn', async () => {
    const user = await newUser();
    const game = await newGame(user);

    const body = {
      intent: { type: 'finance.close_account', accountId: 'acct_does_not_exist' },
      expectedVersion: game.state.meta.version,
      requestId: 'refused-once',
    };
    const first = await invoke<{ ok: boolean; message?: string; meta: SaveMetadata; turn: number }>(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
      method: 'POST',
      cookie: user.cookie,
      params: { gameId: game.gameId },
      body,
    });
    expect(first.status).toBe(200);
    expect(first.body.data?.ok).toBe(false);

    const replay = await invoke<{ replayed: boolean; message?: string; meta: SaveMetadata }>(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
      method: 'POST',
      cookie: user.cookie,
      params: { gameId: game.gameId },
      body,
    });
    expect(replay.body.data?.replayed).toBe(true);
    expect(replay.body.data?.message).toBe(first.body.data?.message);
    expect(replay.body.data?.meta.version).toBe(first.body.data?.meta.version);
  });

  it('rate limits an action flood', async () => {
    const user = await newUser();
    const game = await newGame(user);
    let sawRateLimit = false;
    for (let i = 0; i < 60; i++) {
      const result = await invoke(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
        method: 'POST',
        cookie: user.cookie,
        params: { gameId: game.gameId },
        // A free intent: no save, so this measures the limiter rather than the disk.
        body: { intent: { type: 'trade.quote_buy', commodityId: starterCommodity(game), qty: 1 }, expectedVersion: game.state.meta.version },
      });
      if (result.status === 429) {
        sawRateLimit = true;
        expect(result.response.headers.get('retry-after')).toBeTruthy();
        break;
      }
    }
    expect(sawRateLimit).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Read models                                                         */
/* ------------------------------------------------------------------ */

describe('read models', () => {
  it('lists the available views', async () => {
    const user = await newUser();
    const game = await newGame(user);
    const index = await invoke<{ views: { name: string; description: string; params: string[] }[] }>(viewsGet as unknown as RouteHandler, `/api/games/${game.gameId}/views`, {
      cookie: user.cookie,
      params: { gameId: game.gameId },
    });
    expect(index.status).toBe(200);
    const names = index.body.data!.views.map((v) => v.name);
    for (const expected of ['market', 'finance', 'stocks', 'crypto', 'automation', 'missions', 'combat', 'underground', 'factions', 'inventory', 'progression', 'ledger', 'world']) {
      expect(names).toContain(expected);
    }
    // The index is self-documenting: every entry says what it accepts.
    expect(index.body.data!.views.every((v) => v.description.length > 10)).toBe(true);
  });

  it('serves every registered view without leaking internals', async () => {
    const user = await newUser();
    const game = await newGame(user);
    const index = await invoke<{ views: { name: string }[] }>(viewsGet as unknown as RouteHandler, `/api/games/${game.gameId}/views`, {
      cookie: user.cookie,
      params: { gameId: game.gameId },
    });
    const names = index.body.data!.views.map((v) => v.name);
    expect(names.length).toBeGreaterThan(10);

    for (const name of names) {
      const result = await invoke(viewGet as unknown as RouteHandler, `/api/games/${game.gameId}/views/${name}`, {
        cookie: user.cookie,
        params: { gameId: game.gameId, view: name },
      });
      expect(result.status, `${name} view`).toBe(200);
      expect(result.body.ok, `${name} view`).toBe(true);
      expect(findForbiddenKeys(result.body), `${name} view leaked an internal key`).toEqual([]);
      expectNoRedaction(result.response, `${name} view`);
    }
  });

  it('filters the market view by location and rejects an unknown location', async () => {
    const user = await newUser();
    const game = await newGame(user);
    const here = game.state.player.locationId;
    const somewhereElse = world.locations.find((location) => location.id !== here)?.id;
    expect(somewhereElse).toBeTruthy();

    const atHome = await invoke<{ data: { rows: { commodityId: string }[] }; locationId: string }>(viewGet as unknown as RouteHandler, `/api/games/${game.gameId}/views/market`, {
      cookie: user.cookie,
      params: { gameId: game.gameId, view: 'market' },
    });
    expect(atHome.body.data?.locationId).toBe(here);

    const elsewhere = await invoke<{ data: { rows: unknown[] }; locationId: string }>(viewGet as unknown as RouteHandler, `/api/games/${game.gameId}/views/market?locationId=${somewhereElse}`, {
      cookie: user.cookie,
      params: { gameId: game.gameId, view: 'market' },
    });
    expect(elsewhere.body.data?.locationId).toBe(somewhereElse);

    const bogus = await invoke(viewGet as unknown as RouteHandler, `/api/games/${game.gameId}/views/market?locationId=atlantis`, {
      cookie: user.cookie,
      params: { gameId: game.gameId, view: 'market' },
    });
    expect(bogus.status).toBe(404);
  });

  it('404s an unknown view', async () => {
    const user = await newUser();
    const game = await newGame(user);
    const result = await invoke(viewGet as unknown as RouteHandler, `/api/games/${game.gameId}/views/nonsense`, {
      cookie: user.cookie,
      params: { gameId: game.gameId, view: 'nonsense' },
    });
    expect(result.status).toBe(404);
    expect(result.body.error?.message).toContain('views');
  });

  it('returns the leaderboard and audit trail without private columns', async () => {
    const user = await newUser();
    const game = await newGame(user);
    await invoke(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
      method: 'POST',
      cookie: user.cookie,
      params: { gameId: game.gameId },
      body: { intent: { type: 'time.advance_day' }, expectedVersion: game.state.meta.version, requestId: 'audited' },
    });

    const leaderboard = await invoke<{ rows: Record<string, unknown>[] }>(leaderboardGet as unknown as RouteHandler, '/api/leaderboard', { cookie: user.cookie });
    expect(leaderboard.status).toBe(200);
    expectNoRedaction(leaderboard.response, 'leaderboard');
    const row = leaderboard.body.data!.rows.find((entry) => entry.gameId === game.gameId);
    expect(row).toBeTruthy();
    expect(Object.keys(row!)).not.toContain('state');
    expect(Object.keys(row!)).not.toContain('integrityHash');
    expect(findForbiddenKeys(leaderboard.body)).toEqual([]);

    const audit = await invoke<{ rows: { action: string; userId: string }[] }>(auditGet as unknown as RouteHandler, '/api/audit', { cookie: user.cookie });
    expectNoRedaction(audit.response, 'audit');
    expect(audit.body.data!.rows.some((entry) => entry.action === 'time.advance_day')).toBe(true);
    expect(audit.body.data!.rows.every((entry) => entry.userId === user.userId)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* State projection and lifecycle                                      */
/* ------------------------------------------------------------------ */

describe('state projection', () => {
  it('never includes RNG, diagnostics, chain or competitor internals', async () => {
    const user = await newUser();
    const game = await newGame(user);
    const result = await invoke<{ state: GameStateDto }>(stateGet as unknown as RouteHandler, `/api/games/${game.gameId}/state`, {
      cookie: user.cookie,
      params: { gameId: game.gameId },
    });
    expect(findForbiddenKeys(result.body)).toEqual([]);
    expectNoRedaction(result.response, 'state');

    // Spot-check the specific things the projection exists to remove.
    const raw = result.raw;
    expect(raw).not.toContain('"rng"');
    expect(raw).not.toContain('transactionChain');
    expect(raw).not.toContain('competitors');
    expect(raw).not.toContain('scheduledEvents');
    // The ledger is present but without chain internals.
    for (const transaction of result.body.data!.state.player.recentTransactions) {
      expect(transaction).not.toHaveProperty('seq');
      expect(transaction).not.toHaveProperty('prevHash');
      expect(transaction).not.toHaveProperty('integrityHash');
    }
  });

  it('keeps the health endpoint honest and free of secrets', async () => {
    const result = await invoke<{ status: string; driver: string; configuration: { appSecretConfigured: boolean }; problems: string[] }>(
      healthGet as unknown as RouteHandler,
      '/api/health',
    );
    expect(result.status).toBe(200);
    expectNoRedaction(result.response, 'health');
    expect(result.body.data?.driver).toBe('sqlite');
    // Present/absent only — never the value.
    expect(typeof result.body.data?.configuration.appSecretConfigured).toBe('boolean');
    expect(findForbiddenKeys(result.body)).toEqual([]);
    expect(result.raw).not.toContain('test-secret-for-api-tests-only');
  });
});

describe('save lifecycle', () => {
  it('stores version history and restores forward, not backward', async () => {
    const user = await newUser();
    const game = await newGame(user);

    for (let day = 0; day < 3; day++) {
      const current = await invoke<{ meta: SaveMetadata }>(stateGet as unknown as RouteHandler, `/api/games/${game.gameId}/state`, {
        cookie: user.cookie,
        params: { gameId: game.gameId },
      });
      const advanced = await invoke(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
        method: 'POST',
        cookie: user.cookie,
        params: { gameId: game.gameId },
        body: { intent: { type: 'time.advance_day' }, expectedVersion: current.body.data!.meta.version, requestId: `advance-${day}` },
      });
      expect(advanced.status).toBe(200);
    }

    const list = await invoke<{ currentVersion: number; versions: SaveVersionRow[] }>(versionsGet as unknown as RouteHandler, `/api/games/${game.gameId}/versions`, {
      cookie: user.cookie,
      params: { gameId: game.gameId },
    });
    expect(list.status).toBe(200);
    const versions = list.body.data!.versions;
    expect(versions.length).toBeGreaterThan(1);
    expect(findForbiddenKeys(list.body)).toEqual([]);

    const target = versions[versions.length - 1]!;

    // Without confirmation the request is refused.
    const unconfirmed = await invoke(restorePost as unknown as RouteHandler, `/api/games/${game.gameId}/versions/${target.version}`, {
      method: 'POST',
      cookie: user.cookie,
      params: { gameId: game.gameId, version: String(target.version) },
      body: { expectedVersion: list.body.data!.currentVersion, requestId: 'restore-unconfirmed' },
    });
    expect(unconfirmed.status).toBe(400);

    // With a stale version it is a conflict.
    const stale = await invoke(restorePost as unknown as RouteHandler, `/api/games/${game.gameId}/versions/${target.version}`, {
      method: 'POST',
      cookie: user.cookie,
      params: { gameId: game.gameId, version: String(target.version) },
      body: { confirm: true, expectedVersion: 0, requestId: 'restore-stale' },
    });
    expect(stale.status).toBe(409);

    const restored = await invoke<{ state: GameStateDto; restoredFrom: number }>(restorePost as unknown as RouteHandler, `/api/games/${game.gameId}/versions/${target.version}`, {
      method: 'POST',
      cookie: user.cookie,
      params: { gameId: game.gameId, version: String(target.version) },
      body: { confirm: true, expectedVersion: list.body.data!.currentVersion, requestId: 'restore-now' },
    });
    expect(restored.status).toBe(200);
    expectNoRedaction(restored.response, 'restore version');
    expect(restored.body.data?.restoredFrom).toBe(target.version);
    // Restoring writes forward: the version is strictly greater than before.
    expect(restored.body.data!.state.meta.version).toBeGreaterThan(list.body.data!.currentVersion);
    expect(restored.body.data!.state.world.day).toBe(target.day);
  });

  it('deletes a save only with explicit confirmation, and cannot delete another account\'s', async () => {
    const user = await newUser();
    const other = await newUser();
    const game = await newGame(user);

    const intruder = await invoke(gameDelete as unknown as RouteHandler, `/api/games/${game.gameId}?confirm=true`, {
      method: 'DELETE',
      cookie: other.cookie,
      params: { gameId: game.gameId },
    });
    expect(intruder.status).toBe(404);

    const unconfirmed = await invoke(gameDelete as unknown as RouteHandler, `/api/games/${game.gameId}`, {
      method: 'DELETE',
      cookie: user.cookie,
      params: { gameId: game.gameId },
    });
    expect(unconfirmed.status).toBe(400);

    const confirmed = await invoke<{ deleted: boolean }>(gameDelete as unknown as RouteHandler, `/api/games/${game.gameId}?confirm=true`, {
      method: 'DELETE',
      cookie: user.cookie,
      params: { gameId: game.gameId },
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data?.deleted).toBe(true);

    const gone = await invoke(gameGet as unknown as RouteHandler, `/api/games/${game.gameId}`, {
      cookie: user.cookie,
      params: { gameId: game.gameId },
    });
    expect(gone.status).toBe(404);
  });
});

/* ------------------------------------------------------------------ */
/* Regression — a missing `limit` is an absence, not a zero            */
/* ------------------------------------------------------------------ */

/**
 * `Number(null)` is `0`, and `0` is finite, so a naive parameter helper read every
 * *absent* limit as an explicit zero and clamped it up to the minimum: the market
 * answered with a single row, the ledger with one record, the stock board with one
 * company and the profile with a *zero-length* notification tail. These tests drive the
 * real routes and pin the corrected reading — absence means "the view's own default".
 */
describe('view pagination defaults', () => {
  /** Read one view through the real handler and return just its payload. */
  async function payload<T>(user: TestUser, game: TestGame, name: string, query = ''): Promise<T> {
    const result = await invoke<{ data: T }>(viewGet as unknown as RouteHandler, `/api/games/${game.gameId}/views/${name}${query}`, {
      cookie: user.cookie,
      params: { gameId: game.gameId, view: name },
    });
    expect(result.status, `${name}${query}`).toBe(200);
    return result.body.data!.data;
  }

  it('reads an absent, blank or malformed limit as the view default', async () => {
    const user = await newUser();
    const game = await newGame(user);

    const rows = await payload<{ rows: { commodityId: string }[] }>(user, game, 'market');
    // The defect returned exactly one row here.
    expect(rows.rows.length).toBeGreaterThan(1);
    const pageSize = rows.rows.length;

    for (const query of ['?limit=', '?limit=abc', '?limit=%20%20', '?limit=null']) {
      const result = await payload<{ rows: unknown[] }>(user, game, 'market', query);
      expect(result.rows.length, `market ${query} should fall back to the default`).toBe(pageSize);
    }
  });

  it('honours an explicit limit and clamps junk instead of trusting it', async () => {
    const user = await newUser();
    const game = await newGame(user);

    expect((await payload<{ rows: unknown[] }>(user, game, 'market', '?limit=1')).rows.length).toBe(1);
    expect((await payload<{ rows: unknown[] }>(user, game, 'market', '?limit=2')).rows.length).toBe(2);

    // A fraction floors rather than confusing the slice.
    expect((await payload<{ rows: unknown[] }>(user, game, 'market', '?limit=2.9')).rows.length).toBe(2);

    // A negative limit is clamped up to the minimum: it must never slice from the end.
    expect((await payload<{ rows: unknown[] }>(user, game, 'market', '?limit=-4')).rows.length).toBe(1);

    // An absurd limit is clamped to the documented ceiling without an error.
    const huge = await payload<{ rows: unknown[] }>(user, game, 'market', '?limit=99999');
    expect(huge.rows.length).toBeLessThanOrEqual(400);
  });

  it('keeps the stock board whole by default and paginates it on request', async () => {
    const user = await newUser();
    const game = await newGame(user);

    const all = await payload<{ market: { all: unknown[] } }>(user, game, 'stocks');
    expect(all.market.all.length).toBeGreaterThan(1);

    const ten = await payload<{ market: { all: unknown[] } }>(user, game, 'stocks', '?limit=10');
    expect(ten.market.all.length).toBe(10);

    const junk = await payload<{ market: { all: unknown[] } }>(user, game, 'stocks', '?limit=nonsense');
    expect(junk.market.all.length).toBe(all.market.all.length);
  });

  it('treats the destination limit as "no limit" when absent and as a cap when given', async () => {
    const user = await newUser();
    const game = await newGame(user);

    const all = await payload<{ destinations: unknown[] }>(user, game, 'destinations');
    expect(all.destinations.length).toBeGreaterThan(3);

    // Zero is the view's own way of saying "everything", not "nothing".
    const zero = await payload<{ destinations: unknown[] }>(user, game, 'destinations', '?limit=0');
    expect(zero.destinations.length).toBe(all.destinations.length);

    expect((await payload<{ destinations: unknown[] }>(user, game, 'destinations', '?limit=3')).destinations.length).toBe(3);
    expect((await payload<{ destinations: unknown[] }>(user, game, 'destinations', '?limit=abc')).destinations.length).toBe(all.destinations.length);
  });

  it('paginates the ledger from the newest end with the documented default', async () => {
    const user = await newUser();
    const game = await newGame(user);
    // Two trades give the ledger something to page: each write appends one record.
    let version = game.state.meta.version;
    for (const requestId of ['ledger-seed-a', 'ledger-seed-b']) {
      const bought = await invoke<{ meta: { version: number } }>(intentPost as unknown as RouteHandler, `/api/games/${game.gameId}/intent`, {
        method: 'POST',
        cookie: user.cookie,
        params: { gameId: game.gameId },
        body: { intent: { type: 'trade.buy', commodityId: starterCommodity(game), qty: 1 }, expectedVersion: version, requestId },
      });
      expect(bought.status).toBe(200);
      version = bought.body.data!.meta.version;
    }

    const fallback = await payload<{ total: number; rows: { id: string }[] }>(user, game, 'ledger');
    expect(fallback.rows.length).toBe(Math.min(50, fallback.total));
    expect(fallback.rows.length).toBeGreaterThan(1);

    const one = await payload<{ rows: { id: string }[] }>(user, game, 'ledger', '?limit=1');
    expect(one.rows.length).toBe(1);
    // Newest last: a single-row page is the tail of the default page, not its head.
    expect(one.rows[0]!.id).toBe(fallback.rows[fallback.rows.length - 1]!.id);

    expect((await payload<{ rows: unknown[] }>(user, game, 'ledger', '?limit=abc')).rows.length).toBe(fallback.rows.length);
    expect((await payload<{ rows: unknown[] }>(user, game, 'ledger', '?limit=-3')).rows.length).toBe(1);
  });

  it('does not truncate the notification tail to zero when the parameter is absent', async () => {
    const user = await newUser();
    const game = await newGame(user);

    // A brand-new save opens with a notice from the world; the defect hid it entirely.
    const fallback = await payload<{ player: { notifications: { id: string }[] } }>(user, game, 'profile');
    expect(fallback.player.notifications.length).toBeGreaterThan(0);

    const blank = await payload<{ player: { notifications: unknown[] } }>(user, game, 'profile', '?notifications=');
    expect(blank.player.notifications.length).toBe(fallback.player.notifications.length);

    const junk = await payload<{ player: { notifications: unknown[] } }>(user, game, 'profile', '?notifications=many');
    expect(junk.player.notifications.length).toBe(fallback.player.notifications.length);

    // Zero is an explicit request: it means none, not the default.
    expect((await payload<{ player: { notifications: unknown[] } }>(user, game, 'profile', '?notifications=0')).player.notifications.length).toBe(0);
    expect((await payload<{ player: { notifications: unknown[] } }>(user, game, 'profile', '?notifications=1')).player.notifications.length).toBe(1);
  });
});
