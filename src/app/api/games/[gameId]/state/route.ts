/**
 * GET /api/games/:gameId/state — the authoritative state, projected.
 *
 * This is the endpoint the client loads after signing in or reconnecting: it returns
 * everything the UI is allowed to know (player, world, net worth, notifications) and
 * nothing it is not (RNG state, diagnostics, transaction chain, competitor and event
 * scheduling internals). `meta.version` is the value the client must send back as
 * `expectedVersion` on its next command.
 */
import { okJson, withGame } from '../../../../../server/api-helpers';
import { gameStateDto } from '../../../../../server/dto';
import { extractMetadata } from '../../../../../persistence/serialize';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ gameId: string }> }): Promise<Response> {
  const { gameId } = await context.params;
  return withGame(request, gameId, async ({ game, requestId }) =>
    okJson({ state: gameStateDto(game.state), meta: extractMetadata(game.state), requestId }, request),
  );
}
