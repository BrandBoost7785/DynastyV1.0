/**
 * GET /api/auth/session — who am I, and how is this deployment configured?
 *
 * Answers 200 either way, with `authenticated: false` when there is no session: this is
 * the endpoint a client calls before rendering anything, and a 401 would make an
 * ordinary anonymous visit look like an error in logs and error tracking.
 *
 * It returns the caller's own identity only, plus the auth provider in use — never a
 * token, a secret, or another account's information. Supabase may refresh the session
 * while resolving, so any cookies it minted are attached to the response.
 */
import { resolveUser, usingSupabaseAuth } from '../../../../server/auth';
import { serializeCookie, withAnonymous, withSetCookies, okJson } from '../../../../server/api-helpers';
import { getEnv } from '../../../../config/env';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withAnonymous(
    request,
    async ({ requestId }) => {
      const env = getEnv();
      const auth = await resolveUser(request);
      const cookies = auth.cookies.map((c) => serializeCookie(c.name, c.value, c.options ?? {}));
      if (!auth.ok) {
        return withSetCookies(okJson({ authenticated: false, auth: usingSupabaseAuth() ? 'supabase' : 'local', environment: env.nodeEnv, requestId }, request), cookies);
      }
      return withSetCookies(
        okJson(
          {
            authenticated: true,
            user: {
              id: auth.user.id,
              email: auth.user.email,
              displayName: auth.user.displayName,
              provider: auth.user.provider,
            },
            auth: usingSupabaseAuth() ? 'supabase' : 'local',
            environment: env.nodeEnv,
            requestId,
          },
          request,
        ),
        cookies,
      );
    },
    { scope: 'auth.session' },
  );
}
