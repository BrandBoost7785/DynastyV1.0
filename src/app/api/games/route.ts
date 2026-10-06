/**
 * GET  /api/games — the account's saves, newest first.
 * POST /api/games — create a new game owned by the authenticated account.
 *
 * Ownership is never accepted from the client: the user id comes from the session, and
 * `createGame` stamps it onto the state. A body that tries to set `userId` has the field
 * stripped by the contract before the service sees it.
 */
import { ensureStore, failJson, okJson, readBody, serviceFailure, withUser } from '../../../server/api-helpers';
import { createGameSchema } from '../../../server/contracts';
import { createGame, listGames, summarise } from '../../../server/services/game-service';
import { gameStateDto } from '../../../server/dto';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withUser(request, async ({ user }) => {
    const skipped = await ensureStore(request);
    if (skipped) return skipped;

    const games = await listGames(user.id);
    if (!games.ok) return failJson(games.code, games.message, request);
    return okJson({ games: games.value, count: games.value.length }, request);
  }, { scope: 'games.list' });
}

export async function POST(request: Request): Promise<Response> {
  return withUser(request, async ({ user }) => {
    const skipped = await ensureStore(request);
    if (skipped) return skipped;

    // A new save is a heavier write than a read; the body guard is generous but finite.
    const body = await readBody(request, createGameSchema);
    if (!body.ok) return body.response;

    const created = await createGame({ userId: user.id, ...body.value });
    if (!created.ok) return serviceFailure(created, request);

    const record = created.value;
    return okJson(
      {
        game: summarise(record),
        state: gameStateDto(record.state),
      },
      request,
      { status: 201 },
    );
  }, { scope: 'games.create' });
}
