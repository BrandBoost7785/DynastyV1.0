/**
 * `npm run db:migrate` — apply pending schema migrations.
 *
 * Postgres/Supabase is the production target and reads `supabase/migrations/*.sql`
 * in filename order, tracking what has been applied in `schema_migrations` with a
 * checksum so an edited migration is refused rather than silently re-run. The
 * development SQLite adapter creates the equivalent schema in one idempotent step.
 *
 * Exit codes are meaningful so CI can fail a build on an unapplied migration.
 */
import { getEnv } from '../src/config/env';
import { PostgresStore } from '../src/persistence/postgres-store';
import { SqliteStore } from '../src/persistence/sqlite-store';

async function main(): Promise<number> {
  const env = getEnv();
  console.log(`[migrate] driver=${env.dbDriver} nodeEnv=${env.nodeEnv}`);

  if (env.dbDriver === 'postgres') {
    if (!env.databaseUrl) {
      console.error('[migrate] DATABASE_URL is not set. Refusing to migrate.');
      return 1;
    }
    const store = new PostgresStore();
    const result = await store.migrate();
    if (!result.ok) {
      console.error(`[migrate] failed (${result.code}): ${result.message}`);
      await store.close();
      return 1;
    }
    console.log(`[migrate] applied: ${result.value.applied.length ? result.value.applied.join(', ') : 'none'}`);
    console.log(`[migrate] already current: ${result.value.skipped.length ? result.value.skipped.join(', ') : 'none'}`);
    const health = await store.health();
    console.log(`[migrate] health: ${health.ok ? 'ok' : 'FAILED'} — ${health.detail}`);
    await store.close();
    return health.ok ? 0 : 1;
  }

  if (env.isProduction) {
    console.error('[migrate] The SQLite adapter is development/test only and cannot be used in production.');
    return 1;
  }

  const store = new SqliteStore();
  await store.init();
  const health = await store.health();
  console.log(`[migrate] sqlite schema ready at ${env.sqlitePath}`);
  console.log(`[migrate] health: ${health.ok ? 'ok' : 'FAILED'} — ${health.detail}`);
  await store.close();
  return health.ok ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error('[migrate] unexpected failure:', error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
