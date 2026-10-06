/**
 * GET    /api/games/:gameId — the game's summary plus its player-facing state.
 * DELETE /api/games/:gameId — delete the save (audited; ownership enforced).
 *
 * The heavy read is capped by the DTO layer: the response carries a curated projection,
 * never the raw simulation document with its RNG state and integrity chain.
 */
import { failJson, okJson, serviceFailure, withGame } from '../../../../server/api-helpers';
import { deleteGame, summarise } from '../../../../server/services/game-service';
import { gameStateDto } from '../../../../server/dto';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ gameId: string }> }): Promise<Response> {
  const { gameId } = await context.params;
  return withGame(request, gameId, async ({ game }) =>
    okJson({ game: summarise(game), state: gameStateDto(game.state) }, request),
  );
}

export async function DELETE(request: Request, context: { params: Promise<{ gameId: string }> }): Promise<Response> {
  const { gameId } = await context.params;
  return withGame(request, gameId, async ({ user }) => {
    // Deleting a save is destructive and irreversible. Requiring an explicit
    // confirmation keeps a mis-routed request (or a stray fetch) from wiping a game.
    const confirmation = new URL(request.url).searchParams.get('confirm');
    if (confirmation !== 'true') {
      return failJson('invalid_input', 'Deleting a save is permanent. Repeat the request with ?confirm=true.', request);
    }
    const deleted = await deleteGame(user.id, gameId);
    if (!deleted.ok) return serviceFailure(deleted, request);
    return okJson({ gameId, deleted: true }, request);
  }, { scope: 'games.delete' });
}
