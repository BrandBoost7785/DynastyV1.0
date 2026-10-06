/**
 * HTTP response conventions.
 *
 * One envelope for every endpoint, so the client has a single shape to parse and a
 * single place to look for the reason something failed:
 *
 * ```json
 * { "ok": true,  "data": { … }, "requestId": "req_…" }
 * { "ok": false, "error": { "code": "conflict", "message": "…", "details": […] }, "requestId": "req_…" }
 * ```
 *
 * `GameErrorCode` from the simulation is the vocabulary for `error.code`; transport
 * level failures reuse the same names where they apply (`not_authenticated`,
 * `rate_limited`, `validation_failed`, `internal_error`).
 */
import { randomUUID } from 'node:crypto';
import type { GameErrorCode } from '../sim/types';
import { sanitiseForClient } from './dto';

export type ApiErrorCode = GameErrorCode | 'payload_too_large' | 'unsupported_method' | 'service_unavailable';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: { path?: string; message: string }[];
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  requestId: string;
}

export interface ApiFailure {
  ok: false;
  error: ApiError;
  requestId: string;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export const STATUS_FOR_CODE: Partial<Record<ApiErrorCode, number>> = {
  invalid_input: 400,
  validation_failed: 400,
  payload_too_large: 413,
  not_authenticated: 401,
  action_not_permitted: 403,
  illegal_in_jurisdiction: 403,
  locked: 403,
  unlocked_required: 403,
  not_found: 404,
  conflict: 409,
  save_conflict: 409,
  rate_limited: 429,
  cooldown_active: 429,
  unsupported_method: 405,
  state_corrupt: 422,
  internal_error: 500,
  service_unavailable: 503,
};

export function statusFor(code: ApiErrorCode, fallback = 400): number {
  return STATUS_FOR_CODE[code] ?? fallback;
}

export function newRequestId(): string {
  return `req_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

/** Pull a request id off an incoming request, or mint one. */
export function requestIdOf(request: Request): string {
  return request.headers.get('x-request-id')?.slice(0, 64) || newRequestId();
}

function headers(requestId: string, extra?: HeadersInit): Headers {
  const headersInit = new Headers(extra);
  headersInit.set('x-request-id', requestId);
  // Every response is per-session state; a shared cache would leak one player's
  // empire into another's browser.
  headersInit.set('cache-control', 'no-store, max-age=0');
  return headersInit;
}

/**
 * Every success body passes through `sanitiseForClient` before it is serialised.
 *
 * This is the last line of defence for the "no internals to the browser" rule: a
 * view builder that embeds an RNG state or a chain hash is redacted here rather than
 * reaching the client. Redactions are logged with the request id so a real leak
 * attempt is visible in operations instead of silent.
 */
export function okJson<T>(data: T, request: Request, init?: { status?: number; headers?: HeadersInit }): Response {
  const requestId = requestIdOf(request);
  const sanitised = sanitiseForClient(data);
  const extraHeaders = new Headers(init?.headers);
  if (sanitised.removed.length > 0) {
    console.warn(`[api] redacted internal keys from ${new URL(request.url).pathname} (${requestId}): ${sanitised.removed.join(', ')}`);
    extraHeaders.set('x-dynasty-redacted', sanitised.removed.join(','));
  }
  if (sanitised.truncated) extraHeaders.set('x-dynasty-truncated', 'true');
  const body: ApiSuccess<T> = { ok: true, data: sanitised.value as T, requestId };
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: headers(requestId, extraHeaders),
  });
}

export function failJson(
  code: ApiErrorCode,
  message: string,
  request: Request,
  init?: { status?: number; details?: ApiError['details']; headers?: HeadersInit },
): Response {
  const requestId = requestIdOf(request);
  const body: ApiFailure = { ok: false, error: { code, message, ...(init?.details ? { details: init.details } : {}) }, requestId };
  return new Response(JSON.stringify(body), {
    status: init?.status ?? statusFor(code),
    headers: headers(requestId, init?.headers),
  });
}

/** 204-style success with no body but a consistent envelope. */
export function okEmpty(request: Request): Response {
  return okJson({ done: true }, request);
}

export function methodNotAllowed(request: Request, allowed: string[]): Response {
  return failJson('unsupported_method', `Use ${allowed.join(' or ')} on this endpoint.`, request, {
    status: 405,
    headers: { allow: allowed.join(', ') },
  });
}

/** Never leak internals: log the detail, return a generic message. */
export function internalError(request: Request, error: unknown, context: string): Response {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[api] ${context}: ${message}`, error instanceof Error ? error.stack : '');
  return failJson('internal_error', 'Something went wrong on our side. The incident was logged with your request id.', request);
}

/** Read a JSON body with a size guard, so a huge payload cannot exhaust memory. */
export async function readJson(request: Request, maxBytes = 256 * 1024): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: failJson('payload_too_large', `Request body exceeds ${(maxBytes / 1024).toFixed(0)} KB.`, request) };
  }
  let text: string;
  try {
    text = await request.text();
  } catch (error) {
    return { ok: false, response: failJson('invalid_input', `Body could not be read: ${error instanceof Error ? error.message : String(error)}`, request) };
  }
  if (text.length > maxBytes) {
    return { ok: false, response: failJson('payload_too_large', `Request body exceeds ${(maxBytes / 1024).toFixed(0)} KB.`, request) };
  }
  if (text.length === 0) return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: failJson('invalid_input', 'Request body is not valid JSON.', request) };
  }
}

/** Best-effort client identity for rate limiting unauthenticated endpoints. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}
