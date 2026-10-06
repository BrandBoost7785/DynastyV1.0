/**
 * Store selection.
 *
 * One singleton, chosen from the environment, so no application code ever decides
 * where persistence lives. The rule that matters: **SQLite is a development,
 * sandbox and test adapter.** Production is Postgres/Supabase, and booting a
 * production server on SQLite is refused outright rather than silently allowed.
 */
import { assertProductionConfig, getEnv, type DbDriver } from '../config/env';
import { PostgresStore } from './postgres-store';
import { SqliteStore } from './sqlite-store';
import { err, ok, type GameStore, type StoreResult } from './types';

export * from './types';
export { CURRENT_SCHEMA_VERSION, MAX_SAVE_VERSIONS, MAX_STATE_BYTES, deserializeState, extractMetadata, migrateState, prepareForSave, serializeState, stateFingerprint } from './serialize';
export { PostgresStore } from './postgres-store';
export { SqliteStore } from './sqlite-store';

let store: GameStore | null = null;
let forcedDriver: DbDriver | null = null;
/**
 * `init()` has completed for the live store.
 *
 * Route handlers call `initStore()` on every request as a cheap guard against an
 * unavailable database; doing the migration check each time would mean reading the
 * migrations directory and querying `schema_migrations` per request. The guard is
 * reset whenever the store is replaced, so tests that swap adapters still initialise.
 */
let initialised = false;
let initDetail = '';

/**
 * The process-wide store. Created on first use.
 *
 * @throws if production is configured for the dev-only adapter.
 */
export function getStore(): GameStore {
  if (store) return store;
  const env = getEnv();
  const driver = forcedDriver ?? env.dbDriver;

  if (driver === 'sqlite' && env.isProduction) {
    const problems = assertProductionConfig();
    throw new Error(
      `Refusing to start: production cannot use the SQLite development adapter. ${problems.join('; ') || 'Set DATABASE_URL and DYNASTY_DB_DRIVER=postgres.'}`,
    );
  }

  store = driver === 'postgres' ? new PostgresStore() : new SqliteStore();
  return store;
}

/** Create the schema and report liveness. Called at boot and by `db:migrate`. */
export async function initStore(): Promise<StoreResult<{ driver: DbDriver; detail: string }>> {
  if (initialised) return ok({ driver: storeDriver(), detail: initDetail });
  try {
    const active = getStore();
    await active.init();
    const health = await active.health();
    if (!health.ok) return err('unavailable', health.detail);
    initialised = true;
    initDetail = health.detail;
    return ok({ driver: health.driver, detail: health.detail });
  } catch (error) {
    return err('unavailable', error instanceof Error ? error.message : String(error));
  }
}

/** Drop the memoised init state. Used by tests and by `useStoreDriver`. */
export function resetStoreInit(): void {
  initialised = false;
  initDetail = '';
}

export async function closeStore(): Promise<void> {
  await store?.close();
  store = null;
  resetStoreInit();
}

/**
 * Test helper: pin the adapter and drop the singleton.
 *
 * Lets the same integration suite run against SQLite locally and Postgres in CI
 * without any application code knowing the difference.
 */
export function useStoreDriver(driver: DbDriver | null, instance?: GameStore): void {
  forcedDriver = driver;
  store = instance ?? null;
  resetStoreInit();
}

/** Which adapter is live, for the diagnostics panel and `/api/health`. */
export function storeDriver(): DbDriver {
  return store?.driver ?? forcedDriver ?? getEnv().dbDriver;
}
