/**
 * GET /api/audit — the authenticated account's own action trail.
 *
 * The security record a player can check: every command the server executed for their
 * games, with the outcome and the day it happened. Scoped to the session's user id, so
 * it can never be used to read another account's activity.
 */
import { failJson, okJson, withUser } from '../../../server/api-helpers';
import { getStore } from '../../../persistence';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withUser(request, async ({ user }) => {
    const limitRaw = new URL(request.url).searchParams.get('limit');
    const limit = limitRaw === null ? 50 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return failJson('invalid_input', 'An audit limit must be an integer between 1 and 200.', request);
    }
    const rows = await getStore().recentAudit(user.id, limit);
    if (!rows.ok) return failJson('internal_error', rows.message, request);
    return okJson({ rows: rows.value, count: rows.value.length }, request);
  }, { scope: 'audit' });
}
