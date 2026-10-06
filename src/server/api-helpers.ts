/**
 * Route handler plumbing.
 *
 * Every endpoint composes the same four concerns — authentication, rate limiting,
 * error isolation and a consistent envelope — so they live here once instead of
 * being re-implemented (and eventually diverging) in twenty route files.
 */
import { resolveUser, type AuthUser, type CookieToSet } from './auth';
import { clientKey, failJson, internalError, methodNotAllowed, newRequestId, okJson, readJson, requestIdOf } from './http';
import { consume, rateLimitHeaders, READ_BUDGET, type RateLimitBudget } from './services/rate-limit';
import { loadGame, type ServiceOutcome } from './services/game-service';
import { validate, type ContractResult } from './contracts';
import { initStore } from '../persistence';
import type { SaveRecord } from '../persistence/types';
import type { z } from 'zod';

export interface HandlerContext {
  user: AuthUser;
  requestId: string;
}

/**
 * Run a handler with authentication, read-rate limiting and error isolation.
 *
 * A thrown error becomes a 500 envelope with the request id, never a stack trace in
 * the response body.
 */
export async function withUser(
  request: Request,
  handler: (ctx: HandlerContext) => Promise<Response>,
  options: { budget?: RateLimitBudget; scope?: string } = {},
): Promise<Response> {
  const requestId = requestIdOf(request);
  try {
    const auth = await resolveUser(request);
    // Supabase may have refreshed the session cookies while resolving; they must go
    // back to the browser on this response or the session expires early.
    const cookies: CookieToSet[] = auth.cookies;
    if (!auth.ok) {
      return applyCookies(failJson('not_authenticated', auth.message, request, { status: 401 }), cookies);
    }

    const limit = consume(`${auth.user.id}:${options.scope ?? 'read'}`, options.budget ?? READ_BUDGET);
    if (!limit.allowed) {
      return applyCookies(
        failJson('rate_limited', `Too many requests. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.`, request, {
          status: 429,
          headers: rateLimitHeaders(limit),
        }),
        cookies,
      );
    }

    const response = await handler({ user: auth.user, requestId });
    return applyCookies(withRateLimit(response, limit), cookies);
  } catch (error) {
    return internalError(request, error, options.scope ?? new URL(request.url).pathname);
  }
}

/** Run a handler that does not require authentication (health, login, register). */
export async function withAnonymous(
  request: Request,
  handler: (ctx: { requestId: string }) => Promise<Response>,
  options: { budget?: RateLimitBudget; scope?: string } = {},
): Promise<Response> {
  const requestId = requestIdOf(request);
  try {
    const limit = consume(`${clientKey(request)}:${options.scope ?? 'anonymous'}`, options.budget ?? READ_BUDGET);
    if (!limit.allowed) {
      return failJson('rate_limited', `Too many requests. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.`, request, {
        status: 429,
        headers: rateLimitHeaders(limit),
      });
    }
    const response = await handler({ requestId });
    return withRateLimit(response, limit);
  } catch (error) {
    return internalError(request, error, options.scope ?? 'route');
  }
}

function withRateLimit(response: Response, limit: { limit: number; remaining: number; resetAt: number }): Response {
  const headers = rateLimitHeaders({ ...limit, retryAfterMs: 0, allowed: true });
  for (const [key, value] of Object.entries(headers)) {
    if (!response.headers.has(key)) response.headers.set(key, value);
  }
  return response;
}

function applyCookies(response: Response, cookies: CookieToSet[]): Response {
  for (const cookie of cookies) {
    response.headers.append('set-cookie', serializeCookie(cookie.name, cookie.value, cookie.options));
  }
  return response;
}

/* ------------------------------------------------------------------ */
/* Game-scoped handlers                                                */
/* ------------------------------------------------------------------ */

export interface GameHandlerContext extends HandlerContext {
  /** The loaded save. Ownership was proven by the store query, not by the client. */
  game: SaveRecord;
}

/**
 * Run a handler against one save, with authentication and ownership enforced.
 *
 * The route never receives a state document from the client, and it never trusts a
 * `userId` from the body: the save is loaded *by* `(gameId, authenticated user)`, so a
 * client that changes an id in the URL gets a 404, not somebody else's empire.
 *
 * `gameId` is validated before it reaches the store, so a malformed path segment
 * cannot become a query parameter worth fuzzing.
 */
export async function withGame(
  request: Request,
  rawGameId: unknown,
  handler: (ctx: GameHandlerContext) => Promise<Response>,
  options: { budget?: RateLimitBudget; scope?: string } = {},
): Promise<Response> {
  return withUser(
    request,
    async (ctx) => {
      const gameId = typeof rawGameId === 'string' ? rawGameId.trim() : '';
      if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(gameId)) {
        return failJson('invalid_input', 'A game id is required and must be 1-64 characters of letters, digits, dot, dash, colon or underscore.', request);
      }
      const skipped = await ensureStore(request);
      if (skipped) return skipped;

      const loaded = await loadGame(ctx.user.id, gameId);
      if (!loaded.ok) {
        return failJson(loaded.code, loaded.message, request, { details: loaded.details, status: loaded.code === 'not_found' ? 404 : undefined });
      }
      return handler({ ...ctx, game: loaded.value });
    },
    options,
  );
}

/**
 * Read and validate a JSON body against a contract.
 *
 * Returns either the parsed value or the Response to send back, so a route cannot
 * forget the size guard or the validation step.
 */
export async function readBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes = 256 * 1024,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  const body = await readJson(request, maxBytes);
  if (!body.ok) return body;
  const parsed: ContractResult<T> = validate(schema, body.body);
  if (!parsed.ok) {
    return { ok: false, response: failJson('validation_failed', parsed.message, request, { details: parsed.issues }) };
  }
  return { ok: true, value: parsed.value };
}

/** Map a service failure onto the HTTP envelope with the right status code. */
export function serviceFailure<T>(result: Extract<ServiceOutcome<T>, { ok: false }>, request: Request): Response {
  const headers =
    result.code === 'rate_limited' && result.retryAfterMs !== undefined
      ? { 'retry-after': String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))) }
      : undefined;
  return failJson(result.code, result.message, request, { details: result.details, ...(headers ? { headers } : {}) });
}

/** Build a `set-cookie` header list from the auth service's serialised cookies. */
export function withSetCookies(response: Response, setCookies: readonly string[]): Response {
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
  return response;
}

/** Minimal cookie serializer, so no framework-specific cookie API is needed here. */
export function serializeCookie(name: string, value: string, options: Record<string, unknown> = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(Number(options.maxAge))}`);
  if (options.path) parts.push(`Path=${String(options.path)}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${String(options.sameSite)[0]!.toUpperCase()}${String(options.sameSite).slice(1)}`);
  if (options.domain) parts.push(`Domain=${String(options.domain)}`);
  return parts.join('; ');
}

/** Ensure the store exists and is healthy before serving a request. */
export async function ensureStore(request: Request): Promise<Response | null> {
  const initialised = await initStore();
  if (!initialised.ok) {
    return failJson('service_unavailable', `Persistence is unavailable: ${initialised.message}`, request, { status: 503 });
  }
  return null;
}

export { failJson, methodNotAllowed, newRequestId, okJson, readJson, requestIdOf };
