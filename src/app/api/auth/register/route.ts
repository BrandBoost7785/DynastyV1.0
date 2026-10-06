/**
 * POST /api/auth/register — create an account and start a session.
 *
 * Sign-up goes through the auth service, which uses Supabase Auth when the project is
 * configured and the local scrypt + signed-cookie path in development. Identity is
 * therefore always provider-established; nothing in the request body is treated as an
 * account id.
 */
import { ensureStore, readBody, withAnonymous, withSetCookies, failJson, okJson } from '../../../../server/api-helpers';
import { registerSchema } from '../../../../server/contracts';
import { register } from '../../../../server/services/auth-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withAnonymous(
    request,
    async () => {
      const skipped = await ensureStore(request);
      if (skipped) return skipped;

      const body = await readBody(request, registerSchema);
      if (!body.ok) return body.response;

      const result = await register(body.value, request);
      if (!result.ok) {
        return withSetCookies(failJson('invalid_input', result.message ?? 'Sign-up failed.', request), result.setCookies);
      }
      return withSetCookies(
        okJson(
          {
            userId: result.userId,
            displayName: result.displayName,
            message: result.message ?? 'Account created.',
          },
          request,
          { status: 201 },
        ),
        result.setCookies,
      );
    },
    { scope: 'auth.register' },
  );
}
