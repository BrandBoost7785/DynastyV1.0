/**
 * POST /api/games/:gameId/versions/:version — restore a stored version.
 *
 * Body: `{ "confirm": true, "expectedVersion": 17, "requestId": "…" }`
 *
 * Restoring is destructive to the current state, so it requires an explicit
 * confirmation flag and is conflict-checked: a client that is not looking at the live
 * version cannot roll the game back underneath the tab that is.
 *
 * The write is forward-only — the restored state takes a *new* version number, so the
 * history that is being restored from is itself never rewritten.
 */
import { failJson, okJson, readBody, serviceFailure, withGame } from '../../../../../../server/api-helpers';
import { restoreVersionSchema } from '../../../../../../server/contracts';
import { gameStateDto } from '../../../../../../server/dto';
import { restoreVersion, summarise } from '../../../../../../server/services/game-service';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ gameId: string; version: string }> },
): Promise<Response> {
  const { gameId, version } = await context.params;
  return withGame(request, gameId, async ({ user, game }) => {
    const versionNumber = Number(version);
    if (!Number.isInteger(versionNumber) || versionNumber < 0) {
      return failJson('invalid_input', 'A version number must be a non-negative integer.', request);
    }
    const body = await readBody(request, restoreVersionSchema);
    if (!body.ok) return body.response;

    if (body.value.expectedVersion !== undefined && body.value.expectedVersion !== game.version) {
      return failJson(
        'conflict',
        `This save is at version ${game.version}, but your request was based on version ${body.value.expectedVersion}. Reload before restoring.`,
        request,
      );
    }
    if (body.value.expectedVersion === undefined) {
      return failJson('validation_failed', 'Restoring needs expectedVersion (the live meta.version) so a stale rollback cannot erase progress.', request);
    }

    const restored = await restoreVersion(user.id, game.gameId, versionNumber);
    if (!restored.ok) return serviceFailure(restored, request);
    return okJson({ game: summarise(restored.value), state: gameStateDto(restored.value.state), restoredFrom: versionNumber }, request);
  });
}
