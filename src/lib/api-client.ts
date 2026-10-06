/**
 * Typed API client.
 *
 * The only way client code is allowed to talk to the server. It exists so the UI cannot
 * accidentally do any of the things the architecture forbids:
 *
 *  • it never computes game values — it sends *intents* and renders what comes back;
 *  • it always uses relative URLs, so it works unchanged in local development, behind
 *    the sandbox preview proxy, and in production (no `localhost` anywhere);
 *  • it always sends cookies (`credentials: 'include'`) so the session is established by
 *    the provider rather than asserted by the client;
 *  • it carries the save version and an idempotency key on every command, which is what
 *    makes a retry safe and a stale write impossible.
 *
 * Responses are unwrapped from the single envelope `{ ok, data } | { ok, error }`;
 * failures throw `ApiError` with the server's code, so a screen can branch on
 * `error.code === 'conflict'` without parsing prose.
 */
import type { ApiErrorCode } from '../server/http';
import type { ActionResultDto, GameStateDto } from '../server/dto';
import type { SaveMetadata, SaveVersionRow, LeaderboardRow, AuditRecord } from '../persistence/types';

/* ------------------------------------------------------------------ */
/* Envelope                                                            */
/* ------------------------------------------------------------------ */

export interface ApiFailureBody {
  code: ApiErrorCode;
  message: string;
  details?: { path?: string; message: string }[];
}

export type ApiEnvelope<T> = { ok: true; data: T; requestId: string } | { ok: false; error: ApiFailureBody; requestId: string };

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: { path?: string; message: string }[];

  constructor(code: ApiErrorCode, message: string, status: number, details: { path?: string; message: string }[] = []) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  /** Idempotency key for a command. Use `newRequestId()`. */
  requestId?: string;
  signal?: AbortSignal;
}

/** A fresh idempotency key. Prefers the platform UUID, falls back to time + random. */
export function newRequestId(): string {
  const cryptoRef = globalThis.crypto as Crypto | undefined;
  if (cryptoRef?.randomUUID) return `web-${cryptoRef.randomUUID()}`;
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function call<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.requestId) headers['x-idempotency-key'] = options.requestId;

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers,
      credentials: 'include',
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    // A transport failure is not a game error; say so plainly so the UI can offer a retry.
    throw new ApiError('service_unavailable', error instanceof Error ? `The server could not be reached: ${error.message}` : 'The server could not be reached.', 0);
  }

  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    envelope = null;
  }

  if (!envelope || typeof envelope !== 'object' || !('ok' in envelope)) {
    throw new ApiError('internal_error', `The server returned an unreadable response (${response.status}).`, response.status);
  }
  if (!envelope.ok) {
    throw new ApiError(envelope.error.code, envelope.error.message, response.status, envelope.error.details ?? []);
  }
  return envelope.data;
}

/* ------------------------------------------------------------------ */
/* Payload types                                                       */
/* ------------------------------------------------------------------ */

export interface SessionInfo {
  authenticated: boolean;
  user?: { id: string; email: string; displayName: string; provider: 'local' | 'supabase' };
  auth: 'local' | 'supabase';
  environment: string;
  requestId: string;
}

export interface GameSummaryDto {
  meta: SaveMetadata;
  status: string;
  cash: number;
  actionsLeft: number;
  notificationsUnread: number;
}

export interface IntentResponse extends Omit<ActionResultDto, 'notifications'> {
  notifications: ActionResultDto['notifications'];
  state: GameStateDto;
  meta: SaveMetadata;
  saved: boolean;
  replayed: boolean;
  gameId: string;
}

export interface ViewResponse<T = unknown> {
  view: string;
  day: number;
  turn: number;
  version: number;
  locationId: string;
  data: T;
}

export interface IntentRequestOptions {
  /** The `meta.version` the command was planned against. Required for state changes. */
  expectedVersion?: number;
  /** Supply a stable key across retries of the *same* command. Defaults to a fresh one. */
  requestId?: string;
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

export const api = {
  /* auth */
  session: () => call<SessionInfo>('/api/auth/session'),
  register: (input: { email: string; password: string; displayName: string }) => call<{ userId: string; displayName: string }>('/api/auth/register', { body: input }),
  login: (input: { email: string; password: string }) => call<{ userId: string; displayName: string }>('/api/auth/login', { body: input }),
  logout: () => call<{ message: string }>('/api/auth/logout', { body: {} }),

  /* games */
  listGames: () => call<{ games: SaveMetadata[]; count: number }>('/api/games'),
  createGame: (input: {
    playerName: string;
    gameName?: string;
    seed?: string;
    difficulty?: 'relaxed' | 'standard' | 'hardcore' | 'brutal';
    permadeath?: boolean;
    endless?: boolean;
  }) => call<{ game: GameSummaryDto; state: GameStateDto }>('/api/games', { body: input }),
  getGame: (gameId: string) => call<{ game: GameSummaryDto; state: GameStateDto }>(`/api/games/${encodeURIComponent(gameId)}`),
  getState: (gameId: string) => call<{ state: GameStateDto; meta: SaveMetadata }>(`/api/games/${encodeURIComponent(gameId)}/state`),
  deleteGame: (gameId: string) =>
    call<{ gameId: string; deleted: true }>(`/api/games/${encodeURIComponent(gameId)}?confirm=true`, { method: 'DELETE' }),

  /* commands */
  intent: (gameId: string, intent: Record<string, unknown>, options: IntentRequestOptions = {}) =>
    call<IntentResponse>(`/api/games/${encodeURIComponent(gameId)}/intent`, {
      body: {
        intent,
        ...(options.expectedVersion === undefined ? {} : { expectedVersion: options.expectedVersion }),
        requestId: options.requestId ?? newRequestId(),
      },
    }),
  advance: (gameId: string, days: number, options: IntentRequestOptions = {}) =>
    call<IntentResponse>(`/api/games/${encodeURIComponent(gameId)}/advance`, {
      body: {
        days,
        ...(options.expectedVersion === undefined ? {} : { expectedVersion: options.expectedVersion }),
        requestId: options.requestId ?? newRequestId(),
      },
    }),

  /* read models */
  viewIndex: (gameId: string) =>
    call<{ views: { name: string; description: string; params: string[] }[] }>(`/api/games/${encodeURIComponent(gameId)}/views`),
  view: <T = unknown>(gameId: string, view: string, params: Record<string, string | number | boolean> = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    }
    const suffix = query.toString();
    return call<ViewResponse<T>>(`/api/games/${encodeURIComponent(gameId)}/views/${encodeURIComponent(view)}${suffix ? `?${suffix}` : ''}`);
  },

  /* history and account */
  versions: (gameId: string, limit?: number) =>
    call<{ gameId: string; currentVersion: number; versions: SaveVersionRow[] }>(
      `/api/games/${encodeURIComponent(gameId)}/versions${limit ? `?limit=${limit}` : ''}`,
    ),
  restoreVersion: (gameId: string, version: number, expectedVersion: number, requestId = newRequestId()) =>
    call<{ game: GameSummaryDto; state: GameStateDto; restoredFrom: number }>(
      `/api/games/${encodeURIComponent(gameId)}/versions/${version}`,
      { body: { confirm: true, expectedVersion, requestId } },
    ),
  leaderboard: (limit = 25) => call<{ rows: LeaderboardRow[]; count: number }>(`/api/leaderboard?limit=${limit}`),
  audit: (limit = 50) => call<{ rows: AuditRecord[]; count: number }>(`/api/audit?limit=${limit}`),
};
