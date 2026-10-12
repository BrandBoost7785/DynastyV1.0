/**
 * Shared helpers for route-level tests: invoke a Next route handler exactly as Next would,
 * and read back the envelope and the session cookie it set.
 */
import type { SaveMetadata } from '../src/persistence/types';
import type { GameStateDto } from '../src/server/dto';

export interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: { path?: string; message: string }[] };
  requestId: string;
}

export interface CallOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}

export type RouteHandler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

export const H = (fn: unknown): RouteHandler => fn as RouteHandler;

export async function invokeRoute<T = unknown>(handler: RouteHandler, path: string, options: CallOptions = {}) {
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

/** The `dynasty_session=…` pair from a response, as a `cookie:` header for the next request. */
export function sessionCookieOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .filter((cookie) => cookie.startsWith('dynasty_session='))
    .map((cookie) => cookie.split(';')[0] ?? '')
    .join('; ');
}

export type { SaveMetadata, GameStateDto };
