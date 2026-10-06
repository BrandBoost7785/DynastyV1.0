/**
 * GET /api/leaderboard — the public face of other players' empires.
 *
 * Only the columns a leaderboard needs are selected by the store query; no state
 * document, no account details, no email address. `limit` is bounded server-side.
 */
import { failJson, okJson, withUser } from '../../../server/api-helpers';
import { getStore } from '../../../persistence';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withUser(request, async () => {
    const limitRaw = new URL(request.url).searchParams.get('limit');
    const limit = limitRaw === null ? 25 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return failJson('invalid_input', 'A leaderboard limit must be an integer between 1 and 100.', request);
    }
    const rows = await getStore().leaderboard(limit);
    if (!rows.ok) return failJson('internal_error', rows.message, request);
    return okJson({ rows: rows.value, count: rows.value.length }, request);
  }, { scope: 'leaderboard' });
}
