/**
 * POST /api/games/:gameId/intent — the single command entry point.
 *
 * Body:
 * ```json
 * {
 *   "intent": { "type": "trade.buy", "commodityId": "…", "qty": 40 },
 *   "expectedVersion": 17,
 *   "requestId": "web-8f2c…"
 * }
 * ```
 *
 * Guarantees enforced here and in the service:
 *
 *  • **Authentication and ownership** — the save is loaded by `(gameId, session user)`,
 *    so a changed id yields a 404 rather than another player's game.
 *  • **Validation** — the intent is parsed by the simulation's own schema. Unknown keys
 *    are stripped, so a client cannot inject a price, a total, an XP award or an
 *    outcome: those numbers are computed server-side from authoritative state.
 *  • **Optimistic concurrency** — a state-changing intent must carry `expectedVersion`.
 *    A stale version is a 409 conflict and nothing is written.
 *  • **Idempotency** — when `requestId` is supplied, the outcome is recorded, and a
 *    retry with the same key (and the same payload) replays the recorded answer instead
 *    of executing the command twice. Reusing a key for a different payload is refused.
 *  • **No state leakage** — the response carries the sanitised action envelope and a
 *    fresh state projection, never the raw simulation document.
 */
import { ensureStore, failJson, okJson, readBody, serviceFailure, withGame } from '../../../../../server/api-helpers';
import { intentRequestSchema } from '../../../../../server/contracts';
import { gameStateDto } from '../../../../../server/dto';
import { performIntent } from '../../../../../server/services/game-service';
import { rateLimitHeaders } from '../../../../../server/services/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ gameId: string }> }): Promise<Response> {
  const { gameId } = await context.params;
  return withGame(
    request,
    gameId,
    async ({ user, game }) => {
      const skipped = await ensureStore(request);
      if (skipped) return skipped;

      const body = await readBody(request, intentRequestSchema);
      if (!body.ok) return body.response;

      // The idempotency key may also arrive as a header, which is what generic HTTP
      // clients prefer. The body field wins when both are present.
      const headerKey = request.headers.get('x-idempotency-key') ?? request.headers.get('idempotency-key');
      const requestKey = body.value.requestId ?? headerKey ?? null;

      // `expectedVersion` stays mandatory for state-changing intents even when an
      // idempotency key is present: the key protects against a *retry*, the version
      // protects against a *stale write*. Calling for both is the safe default.
      const outcome = await performIntent(user.id, game.gameId, body.value.intent, {
        expectedVersion: body.value.expectedVersion ?? null,
        requestId: requestKey,
      });
      if (!outcome.ok) return serviceFailure(outcome, request);

      const { response, state, meta, saved, replayed, rateLimit } = outcome.value;
      const payload = {
        ...response,
        state: gameStateDto(state),
        meta,
        saved,
        replayed,
        gameId: game.gameId,
      };
      const headers = rateLimit ? rateLimitHeaders(rateLimit) : undefined;
      return okJson(payload, request, headers ? { headers } : undefined);
    },
    { scope: 'intent' },
  );
}

/**
 * Reject other methods explicitly rather than letting one fall through as a GET.
 * (Next answers undefined methods with 405 automatically; this documents intent.)
 */
export async function GET(request: Request): Promise<Response> {
  return failJson('unsupported_method', 'Commands are POSTed to this endpoint.', request, {
    status: 405,
    headers: { allow: 'POST' },
  });
}
