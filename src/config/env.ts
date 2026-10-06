/**
 * Runtime environment configuration.
 *
 * Secrets are read exclusively from environment variables — never hard-coded.
 * The application is designed to run in two persistence modes:
 *
 *  - `postgres` — PRODUCTION. Supabase/PostgreSQL. Selected automatically when
 *    a `DATABASE_URL` (or Supabase project credentials) is present.
 *  - `sqlite`   — DEVELOPMENT / SANDBOX / TEST ONLY. Uses Node's built-in
 *    `node:sqlite`, stored under `.data/`. This adapter exists so the game is
 *    playable and testable without network access to Supabase; it is NOT a
 *    production persistence implementation and is never selected when
 *    `NODE_ENV === 'production'` unless explicitly forced.
 */

export type DbDriver = 'postgres' | 'sqlite';

export interface EnvConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  dbDriver: DbDriver;
  /** Postgres/Supabase connection string (production). */
  databaseUrl: string | null;
  supabase: {
    url: string | null;
    publishableKey: string | null;
    serviceRoleKey: string | null;
    configured: boolean;
  };
  /** Secret used to sign session cookies and audit hashes. Required in prod. */
  appSecret: string | null;
  /** Where the dev SQLite file lives. */
  sqlitePath: string;
  /** Base URL of the app, used for absolute links in notifications. */
  appUrl: string;
}

function nonEmpty(v: string | undefined | null): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function deriveDriver(): DbDriver {
  const forced = nonEmpty(process.env.DYNASTY_DB_DRIVER)?.toLowerCase();
  if (forced === 'postgres' || forced === 'postgresql') return 'postgres';
  if (forced === 'sqlite') return 'sqlite';

  const hasPostgres =
    nonEmpty(process.env.DATABASE_URL) !== null ||
    nonEmpty(process.env.POSTGRES_URL) !== null ||
    nonEmpty(process.env.SUPABASE_DB_URL) !== null;

  if (hasPostgres) return 'postgres';

  // Production must never silently fall back to the dev-only SQLite adapter.
  if (process.env.NODE_ENV === 'production') return 'postgres';
  return 'sqlite';
}

let cached: EnvConfig | null = null;

export function getEnv(): EnvConfig {
  if (cached) return cached;

  const nodeEnvRaw = nonEmpty(process.env.NODE_ENV) ?? 'development';
  const nodeEnv: EnvConfig['nodeEnv'] =
    nodeEnvRaw === 'production' || nodeEnvRaw === 'test' ? nodeEnvRaw : 'development';

  const supabaseUrl = nonEmpty(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey =
    nonEmpty(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
    nonEmpty(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const serviceRoleKey =
    nonEmpty(process.env.SUPABASE_SERVICE_ROLE_KEY) ??
    nonEmpty(process.env.SUPABASE_SERVICE_KEY);

  const databaseUrl =
    nonEmpty(process.env.DATABASE_URL) ??
    nonEmpty(process.env.POSTGRES_URL) ??
    nonEmpty(process.env.SUPABASE_DB_URL);

  cached = {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    dbDriver: deriveDriver(),
    databaseUrl,
    supabase: {
      url: supabaseUrl,
      publishableKey,
      serviceRoleKey,
      configured: supabaseUrl !== null && publishableKey !== null,
    },
    appSecret: nonEmpty(process.env.DYNASTY_APP_SECRET),
    sqlitePath: nonEmpty(process.env.DYNASTY_SQLITE_PATH) ?? '.data/dynasty-dev.sqlite',
    appUrl: nonEmpty(process.env.NEXT_PUBLIC_APP_URL) ?? 'http://localhost:3000',
  };
  return cached;
}

/** Test helper: drop the memoised config. */
export function resetEnvCache(): void {
  cached = null;
}

/**
 * Production safety check. Called during server boot so misconfiguration is
 * surfaced loudly instead of silently persisting to a dev database.
 */
export function assertProductionConfig(): string[] {
  const env = getEnv();
  if (!env.isProduction) return [];
  const problems: string[] = [];
  if (!env.databaseUrl) problems.push('DATABASE_URL is required in production');
  if (!env.appSecret) problems.push('DYNASTY_APP_SECRET is required in production');
  if (env.dbDriver === 'sqlite') {
    problems.push('The SQLite adapter is dev/test only and cannot be used in production');
  }
  return problems;
}
