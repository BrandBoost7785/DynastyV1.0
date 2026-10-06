/**
 * GET /api/games/:gameId/versions — the save's version history (rollback candidates).
 *
 * Metadata only: the stored state documents are never shipped to the client, because a
 * client never needs to be trusted with a save file. Restoring a version is a separate,
 * confirmed POST.
 */
import { failJson, okJson, serviceFailure, withGame } from '../../../../../server/api-helpers';
import { listVersions } from '../../../../../server/services/game-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ gameId: string }> }): Promise<Response> {
  const { gameId } = await context.params;
  return withGame(request, gameId, async ({ user, game }) => {
    const limitRaw = new URL(request.url).searchParams.get('limit');
    const limit = limitRaw === null ? undefined : Number(limitRaw);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
      return failJson('invalid_input', 'A history limit must be an integer between 1 and 200.', request);
    }
    const versions = await listVersions(user.id, game.gameId, limit);
    if (!versions.ok) return serviceFailure(versions, request);
    return okJson({ gameId: game.gameId, currentVersion: game.version, versions: versions.value }, request);
  });
}
