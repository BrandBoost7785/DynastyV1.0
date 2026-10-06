/**
 * POST /api/auth/login — exchange credentials for a session cookie.
 *
 * A failure is deliberately indistinguishable between "no such account" and "wrong
 * password"; the auth service enforces that, and this route never enriches the error.
 */
import { ensureStore, readBody, withAnonymous, withSetCookies, failJson, okJson } from '../../../../server/api-helpers';
import { loginSchema } from '../../../../server/contracts';
import { login } from '../../../../server/services/auth-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withAnonymous(
    request,
    async () => {
      const skipped = await ensureStore(request);
      if (skipped) return skipped;

      const body = await readBody(request, loginSchema);
      if (!body.ok) return body.response;

      const result = await login(body.value, request);
      if (!result.ok) {
        // 401, not 400: this is an authentication answer.
        return withSetCookies(failJson('not_authenticated', result.message ?? 'Sign-in failed.', request, { status: 401 }), result.setCookies);
      }
      return withSetCookies(okJson({ userId: result.userId, displayName: result.displayName, message: 'Signed in.' }, request), result.setCookies);
    },
    { scope: 'auth.login' },
  );
}
