/**
 * GET /api/games/:gameId/views — the view index.
 *
 * Lets a client discover the read models the server offers (name, description, accepted
 * query parameters) without hard-coding a list that drifts.
 */
import { okJson, withGame } from '../../../../../server/api-helpers';
import { viewIndex } from '../../../../../server/services/game-views';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ gameId: string }> }): Promise<Response> {
  const { gameId } = await context.params;
  return withGame(request, gameId, async ({ game }) =>
    okJson(
      {
        gameId,
        day: game.state.world.day,
        turn: game.state.turn,
        views: viewIndex(),
      },
      request,
    ),
  );
}
