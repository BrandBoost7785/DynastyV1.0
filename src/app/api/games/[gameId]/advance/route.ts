/**
 * POST /api/games/:gameId/advance — advance the world by whole days.
 *
 * Body: `{ "days": 3, "expectedVersion": 17, "requestId": "…" }`
 *
 * This is the same authoritative pipeline as `/intent` — it exists as its own route
 * because "advance time" is the one command with a published bound
 * (`api.maxAdvanceDaysPerRequest`, currently 30). A longer catch-up is a validation
 * error, never a silent truncation: the client is told the largest advance it may ask
 * for, and the response carries the full day report (net worth movement, market movers,
 * payroll, events, enforcement) for the days that ran.
 */
import { okJson, readBody, serviceFailure, withGame } from '../../../../../server/api-helpers';
import { advanceRequestSchema } from '../../../../../server/contracts';
import { gameStateDto } from '../../../../../server/dto';
import { advanceTime } from '../../../../../server/services/game-service';
import { rateLimitHeaders } from '../../../../../server/services/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ gameId: string }> }): Promise<Response> {
  const { gameId } = await context.params;
  return withGame(
    request,
    gameId,
    async ({ user, game }) => {
      const body = await readBody(request, advanceRequestSchema);
      if (!body.ok) return body.response;

      const headerKey = request.headers.get('x-idempotency-key') ?? request.headers.get('idempotency-key');
      const requestKey = body.value.requestId ?? headerKey ?? null;

      const outcome = await advanceTime(user.id, game.gameId, body.value.days, {
        expectedVersion: body.value.expectedVersion ?? null,
        requestId: requestKey,
      });
      if (!outcome.ok) return serviceFailure(outcome, request);

      const { response, state, meta, saved, replayed, rateLimit } = outcome.value;
      const headers = rateLimit ? rateLimitHeaders(rateLimit) : undefined;
      return okJson(
        { ...response, state: gameStateDto(state), meta, saved, replayed, gameId: game.gameId },
        request,
        headers ? { headers } : undefined,
      );
    },
    { scope: 'advance' },
  );
}
