'use client';

/**
 * Client state: session, the open save, and commands.
 *
 * Three rules shaped this file.
 *
 *  1. **The server is the only authority.** This provider holds the last projection the
 *     server sent (`state`, `meta`) and never edits it. A command is sent as an *intent*
 *     — a description of what the player wants — and the response replaces the local
 *     projection wholesale.
 *  2. **One write path.** Every control in the game goes through `run()`, which attaches
 *     the idempotency key and the save version the command was planned against, and
 *     deduplicates a double click by key rather than by luck.
 *  3. **A conflict is information, not an error.** If the save moved on (another tab, a
 *     manager rule, a background tick), the server refuses the stale write; the client
 *     *shows that*, refreshes the authoritative state, and lets the player decide again.
 *     It never silently overwrites a newer state.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, newRequestId, type IntentResponse, type SessionInfo } from './api-client';
import { clearAllQueries, DEFAULT_STALE_MS, getQueryData, invalidate, refetchQuery, setQueryData, useQuery } from './query';
import { useToast } from '../components/ui/toast';
import type { GameMeta, GameStateDto } from './game-data';

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

interface SessionApi {
  session: SessionInfo | null;
  loading: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionApi | null>(null);

export function useSession(): SessionApi {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>.');
  return context;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const query = useQuery<SessionInfo>('session', () => api.session(), { staleTime: 30_000 });

  const refresh = useCallback(async () => {
    // Force a fresh read: a session check must never answer from a stale cache entry.
    await refetchQuery('session', () => api.session());
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await api.login({ email, password });
      clearAllQueries();
      await refresh();
    },
    [refresh],
  );

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      await api.register({ email, password, displayName });
      clearAllQueries();
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    await api.logout();
    clearAllQueries();
  }, []);

  const value = useMemo<SessionApi>(
    () => ({ session: query.data ?? null, loading: query.loading, error: query.error, refresh, signIn, signUp, signOut }),
    [query.data, query.error, query.loading, refresh, signIn, signOut, signUp],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Is the visitor signed in? Distinguishes "still asking" from "definitely not". */
export function useAuthState(): 'loading' | 'authenticated' | 'anonymous' {
  const { session, loading } = useSession();
  if (session?.authenticated) return 'authenticated';
  if (loading && !session) return 'loading';
  return 'anonymous';
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

export interface CommandOptions {
  /** Version this command was planned against. Defaults to the save's current version. */
  expectedVersion?: number;
  /** Reuse a key to retry the *same* command safely (a replayed receipt, not a double). */
  requestId?: string;
  /** Quote-style intents change nothing, so the read models do not need invalidating. */
  readOnly?: boolean;
  /** Suppress the automatic toast when the caller renders the outcome itself. */
  silent?: boolean;
}

/**
 * What a command actually did.
 *
 * `ok` means **the server applied the action**, not merely that HTTP accepted the request.
 * A legitimate refusal (an unmet rule, a missing prerequisite, a rule that said no) comes
 * back as `200` with `ok:false` in the action envelope: the simulation declined, and the
 * caller must say so rather than reporting success. `response` is carried on refusals too,
 * so a caller can show the server's own reason without a second read.
 */
export type CommandOutcome =
  | { ok: true; response: IntentResponse }
  | {
      ok: false;
      code: string;
      message: string;
      /** the save moved on; recompute and retry */
      stale: boolean;
      /** The refusal envelope, when the server answered rather than the transport failing. */
      response?: IntentResponse;
    };

export interface GameSummary {
  meta: GameMeta;
  status: string;
  cash: number;
  actionsLeft: number;
  notificationsUnread: number;
}

interface GamePayload {
  game: GameSummary;
  state: GameStateDto;
}

export interface GameApi {
  gameId: string;
  game: GameSummary | null;
  state: GameStateDto | null;
  meta: GameMeta | null;
  loading: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
  /** Apply an authoritative projection (a command response) to the local cache. */
  apply: (state: GameStateDto, meta: GameMeta) => void;
  run: (intent: Record<string, unknown>, options?: CommandOptions) => Promise<CommandOutcome>;
  advance: (days: number, options?: CommandOptions) => Promise<CommandOutcome>;
  /** True while any command for this save is in flight. */
  busy: boolean;
  /** True while the specific command key is in flight (used to disable one button). */
  isPending: (key: string) => boolean;
}

const GameContext = createContext<GameApi | null>(null);

export function useGame(): GameApi {
  const context = useContext(GameContext);
  if (!context) throw new Error('useGame must be used inside <GameProvider>.');
  return context;
}

export function GameProvider({ gameId, children }: { gameId: string; children: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState<GameStateDto | null>(null);
  const [meta, setMeta] = useState<GameMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const pending = useRef(new Map<string, Promise<CommandOutcome>>());
  /** The payload most recently adopted into local state, so adoption happens once each. */
  const [adopted, setAdopted] = useState<GamePayload | null>(null);

  const gameKey = `game:${gameId}`;
  const query = useQuery<GamePayload>(gameKey, () => api.getGame(gameId), { staleTime: 5_000 });

  /*
   * Adopt the server's projection.
   *
   * This adjusts state during render instead of in an effect, which is React's
   * documented pattern for state derived from a value that changes over time. The effect
   * version rendered one frame of the previous save before correcting itself; comparing
   * against `adopted` makes the write happen exactly once per payload and lets the first
   * paint after a save lands already show the authoritative state.
   */
  if (query.data && query.data !== adopted) {
    setAdopted(query.data);
    setState(query.data.state);
    setMeta(query.data.state.meta);
  }

  const apply = useCallback(
    (next: GameStateDto, nextMeta: GameMeta) => {
      setState(next);
      setMeta(nextMeta);
      setQueryData<GamePayload>(gameKey, {
        game: {
          meta: nextMeta,
          status: next.meta.status,
          cash: sumCash(next),
          actionsLeft: next.player.stats.actionsToday ?? 0,
          notificationsUnread: next.player.notifications.filter((notification) => !notification.read).length,
        },
        state: next,
      });
    },
    [gameKey],
  );

  const refresh = useCallback(async () => {
    await refetchQuery(gameKey, () => api.getGame(gameId));
    const fresh = getQueryData<GamePayload>(gameKey);
    if (fresh) {
      setState(fresh.state);
      setMeta(fresh.state.meta);
    }
  }, [gameId, gameKey]);

  const submit = useCallback(
    async (kind: 'intent' | 'advance', payload: Record<string, unknown> | number, options: CommandOptions = {}): Promise<CommandOutcome> => {
      const requestId = options.requestId ?? newRequestId();
      const existing = pending.current.get(requestId);
      if (existing) return existing;

      const flight = (async (): Promise<CommandOutcome> => {
        try {
          /*
           * The version to send is the one from the state the server last sent us; the
           * comparison happens server-side, so a stale value is a refused conflict that
           * triggers a refresh — never a silent overwrite of a newer save.
           */
          const expectedVersion = options.expectedVersion ?? state?.meta.version ?? 0;
          const response =
            kind === 'advance'
              ? await api.advance(gameId, payload as number, { expectedVersion, requestId })
              : await api.intent(gameId, payload as Record<string, unknown>, { expectedVersion, requestId });

          apply(response.state, response.meta ?? response.state.meta);
          if (!options.readOnly) invalidate(`views:${gameId}`);
          if (!options.silent && response.message) {
            toast.push({ tone: response.ok ? 'success' : 'warning', title: response.message, ...(response.replayed ? { body: 'Replayed from this command’s receipt — nothing was applied twice.' } : {}) });
          }
          /*
           * A refusal is not a success. The request succeeded, but the simulation
           * declined — so the caller is told `ok:false` and given the server's reason,
           * the same shape a transport refusal takes. Anything else would let a screen
           * clear a form, close a panel or announce a result that never happened.
           */
          if (response.ok) return { ok: true, response };
          return {
            ok: false,
            code: response.error ?? 'action_not_permitted',
            message: response.message ?? 'The server refused that command.',
            stale: false,
            response,
          };
        } catch (error) {
          const apiError = toApiError(error);
          if (apiError.status === 401 || apiError.code === 'not_authenticated') {
            clearAllQueries();
            toast.push({ tone: 'warning', title: 'Session expired', body: 'Sign in again to pick up where you left off.' });
            router.push(`/login?next=${encodeURIComponent(`/games/${gameId}`)}`);
            return { ok: false, code: 'not_authenticated', message: apiError.message, stale: true };
          }
          if (apiError.status === 409 || apiError.code === 'conflict') {
            toast.push({
              tone: 'warning',
              title: 'Game state changed. Refreshing your market data.',
              body: 'Your command was not applied because the save had already moved on. The latest authoritative state is loading now.',
              sticky: true,
            });
            await refresh();
            invalidate(`views:${gameId}`);
            return { ok: false, code: apiError.code, message: apiError.message, stale: true };
          }
          if (!options.silent) toast.push({ tone: 'danger', title: 'Command refused', body: apiError.message });
          return { ok: false, code: apiError.code, message: apiError.message, stale: false };
        } finally {
          pending.current.delete(requestId);
          setPendingKeys((keys) => keys.filter((key) => key !== requestId));
          if (pending.current.size === 0) setBusy(false);
        }
      })();

      pending.current.set(requestId, flight);
      setPendingKeys((keys) => [...keys, requestId]);
      setBusy(true);
      return flight;
    },
    [apply, gameId, refresh, router, state, toast],
  );

  const run = useCallback<GameApi['run']>((intent, options) => submit('intent', intent, options), [submit]);
  const advance = useCallback<GameApi['advance']>((days, options) => submit('advance', days, options), [submit]);
  const isPending = useCallback((key: string) => pendingKeys.includes(key), [pendingKeys]);

  const value = useMemo<GameApi>(
    () => ({
      gameId,
      game: query.data?.game ?? null,
      state,
      meta: meta ?? query.data?.state.meta ?? null,
      loading: query.loading && !state,
      error: query.error,
      refresh,
      apply,
      run,
      advance,
      busy,
      isPending,
    }),
    [advance, apply, busy, gameId, isPending, meta, query.data, query.error, query.loading, refresh, run, state],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

function sumCash(state: GameStateDto): number {
  return state.player.accounts.reduce((sum, account) => sum + account.balance, 0);
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) {
    const code = /fetch|network|failed to load/i.test(error.message) ? 'service_unavailable' : 'internal_error';
    return new ApiError(code, error.message, 0);
  }
  return new ApiError('internal_error', 'The command could not be sent.', 0);
}

/* ------------------------------------------------------------------ */
/* View hooks                                                          */
/* ------------------------------------------------------------------ */

export interface ViewSnapshot<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  refreshing: boolean;
  /** Re-run this view's request now (a panel-level retry). */
  refetch: () => void;
  /** The cache key, so a caller can retry or inspect exactly this entry. */
  key: string;
}

/**
 * Read one view for the current save.
 *
 * The key includes the game id and the parameters, so two locations' markets are two
 * cache entries and one command's invalidation refreshes both consistently.
 */
export function useView<T>(viewName: string, params: Record<string, string | number | boolean> = {}, options: { enabled?: boolean; staleTime?: number } = {}): ViewSnapshot<T> {
  const { gameId } = useGame();
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const suffix = search.toString();
  const key = `views:${gameId}:${viewName}${suffix ? `?${suffix}` : ''}`;
  const query = useQuery<T>(key, () => api.view<T>(gameId, viewName, params).then((response) => response.data), {
    staleTime: options.staleTime ?? DEFAULT_STALE_MS,
    enabled: options.enabled ?? true,
  });
  const refetch = useCallback(() => {
    // Mark exactly this entry stale and publish: only the panels that read it refetch.
    invalidate(key);
  }, [key]);
  return { ...query, refetch, key };
}

/** Cash, version and day — the three numbers nearly every screen needs. */
export function usePurse(): { cash: number; version: number; day: number } {
  const { state, meta } = useGame();
  const cash = state ? state.player.accounts.reduce((sum, account) => sum + account.balance, 0) : 0;
  return { cash, version: meta?.version ?? 0, day: state?.world.day ?? meta?.day ?? 0 };
}
