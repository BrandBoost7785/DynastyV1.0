/**
 * GET /api/games/:gameId/views/:view — every read model, one contract.
 *
 * Each view is a projection the simulation already knows how to produce
 * (`src/server/services/game-views.ts`). Adding a screen's data source is adding an
 * entry to that registry — the client never re-derives a price, a valuation or a board.
 *
 * One route rather than a dozen near-identical files: the authorisation, ownership and
 * error handling are identical for all of them, and they are exercised by one set of
 * tests. `GET /api/games/:gameId/views` lists what is available.
 */
import { failJson, methodNotAllowed, okJson, withGame } from '../../../../../../server/api-helpers';
import { buildView, isViewName } from '../../../../../../server/services/game-views';
import { getWorldRegistry } from '../../../../../../engine/registry';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ gameId: string; view: string }> },
): Promise<Response> {
  const { gameId, view } = await context.params;
  return withGame(request, gameId, async ({ game }) => {
    if (!isViewName(view)) {
      return failJson('not_found', `There is no "${view}" view. Ask GET /api/games/${gameId}/views for the list.`, request, { status: 404 });
    }
    const url = new URL(request.url);
    const locationId = url.searchParams.get('locationId')?.trim();
    if (locationId && locationId.length > 64) {
      return failJson('invalid_input', 'A location id is at most 64 characters.', request);
    }
    const state = game.state;
    if (locationId && !getWorldRegistry().location(locationId)) {
      // An unknown location is a client mistake, not an empty market — saying so is
      // more useful than silently rendering the player's own city.
      return failJson('not_found', `No location "${locationId}".`, request, { status: 404 });
    }
    const ctx = { locationId: locationId ?? state.player.locationId };
    return okJson(
      {
        view,
        day: state.world.day,
        turn: state.turn,
        version: state.version,
        locationId: ctx.locationId,
        data: buildView(state, view, url.searchParams, ctx),
      },
      request,
    );
  });
}

export async function POST(request: Request): Promise<Response> {
  return methodNotAllowed(request, ['GET']);
}
