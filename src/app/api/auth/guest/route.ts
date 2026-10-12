/**
 * POST /api/auth/guest — start a guest session, or resume the one this browser holds.
 *
 * This is the only way into the game without a password, and it asks for nothing: the body
 * is not read, so no identity can be supplied by the client. The guest id is generated on
 * the server, and the credential is an HttpOnly session cookie.
 *
 *  - 201 when a new guest was created (cookie set);
 *  - 200 when a valid guest session was resumed (no new cookie, no new row).
 *
 * Rate limited per client. Nothing is created on a page load: the client calls this only when
 * the player chooses to play.
 */
import { ensureStore, failJson, okJson, withAnonymous, withSetCookies } from '../../../../server/api-helpers';
import { startGuest } from '../../../../server/services/auth-service';
import { GUEST_BUDGET } from '../../../../server/services/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withAnonymous(
    request,
    async () => {
      const skipped = await ensureStore(request);
      if (skipped) return skipped;

      const result = await startGuest(request);
      if (result.code === 'conflict') {
        return withSetCookies(failJson('conflict', result.message ?? 'Sign out before starting a guest session.', request, { status: 409 }), result.setCookies);
      }
      if (!result.ok || !result.userId) {
        return withSetCookies(failJson('service_unavailable', result.message ?? 'The guest session could not be started.', request, { status: 503 }), result.setCookies);
      }
      return withSetCookies(
        okJson(
          { userId: result.userId, displayName: result.displayName, created: result.created, message: result.message },
          request,
          { status: result.created ? 201 : 200 },
        ),
        result.setCookies,
      );
    },
    { scope: 'auth.guest', budget: GUEST_BUDGET },
  );
}
