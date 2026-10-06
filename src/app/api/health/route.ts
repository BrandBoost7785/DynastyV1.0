/**
 * GET /api/health — liveness and configuration status.
 *
 * Deliberately unauthenticated (a load balancer has to be able to call it) and
 * deliberately honest: it reports which persistence driver is live, whether the
 * schema is reachable, and whether the deployment is missing configuration it needs.
 * It never prints a secret value, only whether one is present.
 */
import { assertProductionConfig, getEnv } from '../../../config/env';
import { initStore, storeDriver } from '../../../persistence';
import { CURRENT_SCHEMA_VERSION } from '../../../persistence/serialize';
import { usingSupabaseAuth } from '../../../server/auth';
import { failJson, okJson, withAnonymous } from '../../../server/api-helpers';
import { registrySummary } from '../../../engine/registry';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withAnonymous(
    request,
    async () => {
      const env = getEnv();
      const initialised = await initStore();
      if (!initialised.ok) {
        return failJson('service_unavailable', `Persistence is unavailable: ${initialised.message}`, request, { status: 503 });
      }

      const problems = assertProductionConfig();
      const summary = registrySummary();
      return okJson(
        {
          status: problems.length === 0 ? 'ok' : 'degraded',
          version: 1,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          driver: storeDriver(),
          nodeEnv: env.nodeEnv,
          auth: usingSupabaseAuth() ? 'supabase' : 'local',
          persistence: initialised.value.detail,
          /*
           * Presence flags, never values. Named `…Configured` rather than after the
           * variable so a reader cannot mistake the boolean for the secret itself.
           */
          configuration: {
            appSecretConfigured: env.appSecret !== null,
            databaseConfigured: env.databaseUrl !== null,
            supabaseConfigured: env.supabase.configured,
          },
          /*
           * Real content counts, straight from the registries — nothing here is
           * hardcoded, so a data regression shows up in the health check. Deliberately
           * excludes anything secret (values are only reported as present/absent above)
           * and anything player-specific (this endpoint is unauthenticated).
           */
          content: summary,
          problems,
          time: new Date().toISOString(),
        },
        request,
      );
    },
    { scope: 'health' },
  );
}
