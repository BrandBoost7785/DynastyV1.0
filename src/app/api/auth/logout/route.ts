/**
 * POST /api/auth/logout — revoke every session for the authenticated account.
 *
 * Server-side revocation matters: a signed cookie that is merely deleted in the
 * browser is still valid until it expires. The auth service deletes the session rows,
 * so a stolen cookie stops working the moment the owner signs out.
 */
import { withUser, withSetCookies, okJson } from '../../../../server/api-helpers';
import { logout } from '../../../../server/services/auth-service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return withUser(request, async ({ user }) => {
    const result = await logout(user.id, request);
    return withSetCookies(okJson({ message: result.message ?? 'Signed out.' }, request), result.setCookies);
  }, { scope: 'auth.logout' });
}
