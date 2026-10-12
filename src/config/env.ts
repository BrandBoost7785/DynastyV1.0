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
  /**
   * How a client address is obtained for rate limiting. Exactly one declaration is allowed.
   * `problem` is set when the declaration is missing or malformed in a way that cannot be
   * trusted; see client-identity.ts for the model.
   */
  clientIp: {
    header: string | null;
    trustedProxyHops: number | null;
    problem: string | null;
  };
}

const HEADER_NAME = /^[a-z0-9-]{1,64}$/;

function parseClientIp(): EnvConfig['clientIp'] {
  const header = nonEmpty(process.env.DYNASTY_CLIENT_IP_HEADER)?.toLowerCase() ?? null;
  const hopsRaw = nonEmpty(process.env.DYNASTY_TRUSTED_PROXY_HOPS);
  if (header !== null && hopsRaw !== null) {
    return { header: null, trustedProxyHops: null, problem: 'Set only one of DYNASTY_CLIENT_IP_HEADER or DYNASTY_TRUSTED_PROXY_HOPS, not both' };
  }
  if (header !== null) {
    if (!HEADER_NAME.test(header)) {
      return { header: null, trustedProxyHops: null, problem: 'DYNASTY_CLIENT_IP_HEADER must be a plain header name such as cf-connecting-ip' };
    }
    return { header, trustedProxyHops: null, problem: null };
  }
  if (hopsRaw !== null) {
    const hops = /^\d+$/.test(hopsRaw) ? Number(hopsRaw) : NaN;
    if (!Number.isInteger(hops) || hops < 1 || hops > 10) {
      return { header: null, trustedProxyHops: null, problem: 'DYNASTY_TRUSTED_PROXY_HOPS must be an integer from 1 to 10' };
    }
    return { header: null, trustedProxyHops: hops, problem: null };
  }
  return { header: null, trustedProxyHops: null, problem: null };
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
    clientIp: parseClientIp(),
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
  if (env.clientIp.problem) {
    problems.push(env.clientIp.problem);
  } else if (env.clientIp.header === null && env.clientIp.trustedProxyHops === null) {
    problems.push(
      'DYNASTY_TRUSTED_PROXY_HOPS or DYNASTY_CLIENT_IP_HEADER must be set in production, so guest and sign-in limits are charged to a real client',
    );
  }
  if (env.dbDriver === 'sqlite') {
    problems.push('The SQLite adapter is dev/test only and cannot be used in production');
  }
  return problems;
}
