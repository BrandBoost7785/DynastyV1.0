/**
 * A very small server-state cache.
 *
 * The game screens read the same handful of authoritative projections over and over
 * (the save state, the market at a location, the ledger). A full data-fetching library
 * would be a large new dependency for what is ultimately *one* rule: a screen shows
 * what the server last said, and a command invalidates it.
 *
 * Design constraints this satisfies:
 *
 *  • **No duplicated authority.** The cache holds exactly the payloads the API
 *    returned. It never merges, derives or mutates game data.
 *  • **No refetch storms.** Identical keys share one in-flight request, and a fresh
 *    entry is not refetched on every mount (`staleTime`).
 *  • **Deterministic invalidation.** A command bumps the epoch; every mounted query
 *    whose key is affected refetches once.
 *  • **StrictMode-safe.** Fetching happens in an effect, never during render.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { ApiError } from './api-client';

export interface QueryEntry<T = unknown> {
  data: T | undefined;
  error: ApiError | null;
  /** When the data last arrived; `0` means "stale, refetch when observed". */
  updatedAt: number;
  /** True while a request is in flight for this key. */
  loading: boolean;
}

export interface QuerySnapshot<T> {
  data: T | undefined;
  error: ApiError | null;
  /** First load: nothing in the cache yet and a request is running. */
  loading: boolean;
  /** A request is running while stale data is still on screen. */
  refreshing: boolean;
  /** The epoch this snapshot was taken at — changes when anything is invalidated. */
  epoch: number;
}

interface InternalEntry<T = unknown> extends QueryEntry<T> {
  promise: Promise<void> | null;
  subscribers: Set<() => void>;
  /**
   * The snapshot this entry handed to React last.
   *
   * `useSyncExternalStore` compares snapshots by identity and re-renders whenever the
   * value changes, so a `getSnapshot` that built a *fresh object* on every call made
   * React believe the store had changed on every commit: the client re-rendered
   * forever ("Maximum update depth exceeded") even though the payload was identical.
   * The snapshot is therefore memoised on the entry and dropped only when something
   * actually changes.
   */
  snapshot: QuerySnapshot<unknown> | null;
}

const cache = new Map<string, InternalEntry>();
let epoch = 0;
const globalSubscribers = new Set<() => void>();

/**
 * The snapshot for a key that has nothing cached.
 *
 * Also memoised per epoch, for the same identity reason — a disabled query or a key
 * that was cleared still has subscribers, and each of them must see a stable value.
 */
const emptySnapshots = new Map<number, QuerySnapshot<unknown>>();

/** What a server render sees: no cache, no request, a loading state. */
const SERVER_SNAPSHOT: QuerySnapshot<unknown> = Object.freeze({ data: undefined, error: null, loading: true, refreshing: false, epoch: 0 });

function emptySnapshot(): QuerySnapshot<unknown> {
  const existing = emptySnapshots.get(epoch);
  if (existing) return existing;
  const snapshot: QuerySnapshot<unknown> = { data: undefined, error: null, loading: false, refreshing: false, epoch };
  // Keep only the current epoch: older ones can never be selected again.
  emptySnapshots.clear();
  emptySnapshots.set(epoch, snapshot);
  return snapshot;
}

/** The memoised snapshot for one key, rebuilt only when the entry has changed. */
function snapshotFor<T>(key: string): QuerySnapshot<T> {
  const entry = cache.get(key) as InternalEntry<T> | undefined;
  if (!entry) return emptySnapshot() as QuerySnapshot<T>;
  if (entry.snapshot) return entry.snapshot as QuerySnapshot<T>;
  const snapshot: QuerySnapshot<T> = {
    data: entry.data,
    error: entry.error ?? null,
    loading: entry.loading && entry.data === undefined,
    refreshing: entry.loading && entry.data !== undefined,
    epoch,
  };
  entry.snapshot = snapshot;
  return snapshot;
}

/** Default freshness window. Views are cheap; 10s keeps a busy screen from spinning. */
export const DEFAULT_STALE_MS = 10_000;

function entryFor<T>(key: string): InternalEntry<T> {
  let entry = cache.get(key) as InternalEntry<T> | undefined;
  if (!entry) {
    entry = { data: undefined, error: null, updatedAt: 0, loading: false, promise: null, subscribers: new Set(), snapshot: null };
    cache.set(key, entry as InternalEntry);
  }
  return entry;
}

function publish(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  entry.snapshot = null;
  for (const notify of entry.subscribers) notify();
}

function publishAll(): void {
  epoch += 1;
  // Every snapshot embeds the epoch, so every one of them is now out of date.
  for (const entry of cache.values()) entry.snapshot = null;
  emptySnapshots.clear();
  for (const notify of globalSubscribers) notify();
  for (const entry of cache.values()) for (const notify of entry.subscribers) notify();
}

/** Read whatever the cache currently holds. */
export function getQueryData<T>(key: string): T | undefined {
  return cache.get(key)?.data as T | undefined;
}

/** Write a payload the server just returned (an intent response, for example). */
export function setQueryData<T>(key: string, data: T): void {
  const entry = entryFor<T>(key);
  entry.data = data;
  entry.error = null;
  entry.updatedAt = Date.now();
  entry.loading = false;
  publish(key);
}

/**
 * Mark cached reads stale. Called after every successful command, so the next render
 * of a mounted screen refetches from the server rather than trusting a projection of
 * a state that no longer exists.
 *
 * `prefix` narrows the blast radius (`views/` refreshes read models without touching
 * the save summary).
 */
export function invalidate(prefix = ''): void {
  for (const [key, entry] of cache.entries()) {
    if (prefix === '' || key.startsWith(prefix)) entry.updatedAt = 0;
  }
  publishAll();
}

/** Drop a key entirely (a deleted game, a signed-out session). */
export function clearQuery(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  publish(key);
  cache.delete(key);
}

/** Drop everything — used on sign-out so one account's data cannot appear in another's UI. */
export function clearAllQueries(): void {
  cache.clear();
  publishAll();
}

function isFresh(entry: InternalEntry, staleTime: number): boolean {
  return entry.data !== undefined && staleTime > 0 && Date.now() - entry.updatedAt < staleTime;
}

/**
 * Start (or join) a request for `key`. Concurrent callers share one request.
 */
export function fetchQuery<T>(key: string, fetcher: () => Promise<T>, opts: { staleTime?: number; force?: boolean } = {}): Promise<void> {
  const staleTime = opts.staleTime ?? DEFAULT_STALE_MS;
  const entry = entryFor<T>(key);
  if (!opts.force && isFresh(entry, staleTime)) return Promise.resolve();
  if (entry.promise) return entry.promise;

  entry.loading = true;
  publish(key);

  const promise = fetcher()
    .then((data) => {
      entry.data = data;
      entry.error = null;
    })
    .catch((error: unknown) => {
      entry.error = error instanceof ApiError ? error : new ApiError('internal_error', error instanceof Error ? error.message : 'Request failed', 0);
    })
    .finally(() => {
      entry.updatedAt = Date.now();
      entry.loading = false;
      entry.promise = null;
      publish(key);
    });

  entry.promise = promise;
  return promise;
}

/** Re-run a request now, ignoring freshness. */
export function refetchQuery<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
  return fetchQuery(key, fetcher, { force: true, staleTime: 0 });
}

/**
 * Subscribe to a cached read.
 *
 * `key` may be `null` to disable the query (a screen that needs a location before it
 * can ask for the market), which keeps hooks unconditional and therefore legal.
 */
export function useQuery<T>(key: string | null, fetcher: () => Promise<T>, opts: { staleTime?: number; enabled?: boolean } = {}): QuerySnapshot<T> {
  const { staleTime = DEFAULT_STALE_MS } = opts;
  const enabled = (opts.enabled ?? true) && key !== null;
  /*
   * The fetcher is kept in a ref so the fetch effect below never has to depend on the
   * (per-render) closure identity of the caller's lambda. It is written in an effect
   * rather than during render: this effect is declared before the fetch effect, so a
   * mount or a key change always reads the current fetcher and never a stale one.
   */
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!key) {
        globalSubscribers.add(onStoreChange);
        return () => globalSubscribers.delete(onStoreChange);
      }
      const entry = entryFor(key);
      entry.subscribers.add(onStoreChange);
      globalSubscribers.add(onStoreChange);
      return () => {
        entry.subscribers.delete(onStoreChange);
        globalSubscribers.delete(onStoreChange);
      };
    },
    [key],
  );

  const getSnapshot = useCallback((): QuerySnapshot<T> => (key ? snapshotFor<T>(key) : (emptySnapshot() as QuerySnapshot<T>)), [key]);

  // Server render: no cache, no request, no data. Screens render their loading state.
  // One shared object: the server pass always renders the loading state, and an
  // unstable snapshot here would make hydration compare two different objects.
  const getServerSnapshot = useCallback((): QuerySnapshot<T> => SERVER_SNAPSHOT as QuerySnapshot<T>, []);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!enabled || !key) return;
    void fetchQuery(key, () => fetcherRef.current(), { staleTime });
    // `snapshot.epoch` is the invalidation signal: a command bumps it and every mounted
    // query refetches exactly once.
  }, [key, enabled, staleTime, snapshot.epoch]);

  return snapshot;
}

/** Test/debug helper: how many keys are cached right now. */
export function queryCacheSize(): number {
  return cache.size;
}
