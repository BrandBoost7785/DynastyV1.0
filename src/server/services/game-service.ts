/**
 * Game service — the orchestration every route handler goes through.
 *
 * The loop is always the same, and keeping it in one place is what makes the
 * security argument simple to audit:
 *
 *   authenticate → rate limit → **load the authoritative state from the store**
 *   → validate → dispatch the intent through the sim → persist with a
 *   compare-and-set → record the audit row → return the envelope.
 *
 * Nothing in here accepts a state document from the client. The browser sends an
 * intent and the version it last saw; the server owns everything else. If the
 * version is stale the write is rejected as a conflict and nothing is persisted, so
 * two tabs cannot clobber each other.
 */
import { getBalance } from '../../config/balance';
import { digestHex } from '../../lib/hash';
import { getStore } from '../../persistence';
import { extractMetadata, prepareForSave } from '../../persistence/serialize';
import type { SaveMetadata, SaveRecord, SaveVersionRow } from '../../persistence/types';
import { dispatch, isFreeIntent } from '../../sim/actions';
import { createNewGame } from '../../sim/bootstrap';
import { rngForAction } from '../../sim/tick';
import { parseIntent, type ActionIntent } from '../../sim/validation';
import type { ActionResult, GameState, GameStatus, ID } from '../../sim/types';
import type { Difficulty } from '../../sim/state';
import { actionResultDto, DTO_LIMITS, type ActionResultDto } from '../dto';
import { ACTION_BUDGET, consume, type RateLimitResult } from './rate-limit';
import type { ApiErrorCode } from '../http';

const B = getBalance();

export type ServiceOutcome<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: ApiErrorCode;
      message: string;
      details?: { path?: string; message: string }[];
      /** Set on a rate-limit refusal so the HTTP layer can emit `Retry-After`. */
      retryAfterMs?: number;
    };

export interface PerformIntentOptions {
  /** The version the client last saw. Required for state-changing intents. */
  expectedVersion?: number | null;
  /** Rate-limit key, normally the authenticated user id. */
  limitKey?: string;
  /** Persist even for read-only intents (default false — they do not change the save). */
  persistReadOnly?: boolean;
  /** Recorded in version history and the audit trail. */
  reason?: string;
  /**
   * Client idempotency key. When present, the outcome is recorded and a retry of the
   * same key returns the recorded answer instead of executing the command again.
   */
  requestId?: string | null;
  /**
   * Demand `expectedVersion`. Defaults to true for state-changing intents and false
   * for read-only ones; only server-initiated writes may turn it off.
   */
  requireExpectedVersion?: boolean;
}

export interface IntentOutcome {
  /** Sanitised action envelope, ready to serialise. Never contains raw state. */
  response: ActionResultDto;
  /** Authoritative state after the action, for the caller to project as a DTO. */
  state: GameState;
  /** Metadata of the save as it now stands; `meta.version` is the next expectedVersion. */
  meta: SaveMetadata;
  saved: boolean;
  /** True when this response came from a recorded receipt rather than a fresh run. */
  replayed: boolean;
  requestId: string | null;
  rateLimit: RateLimitResult | null;
  conflict: string | null;
}

/* ------------------------------------------------------------------ */
/* Saves                                                               */
/* ------------------------------------------------------------------ */

export async function listGames(userId: ID): Promise<ServiceOutcome<SaveMetadata[]>> {
  const store = getStore();
  const result = await store.listGames(userId);
  if (!result.ok) return { ok: false, code: 'internal_error', message: result.message };
  return { ok: true, value: result.value };
}

export interface CreateGameInput {
  userId: ID;
  playerName: string;
  gameName?: string;
  seed?: string;
  difficulty?: Difficulty;
  startLocationId?: ID;
  permadeath?: boolean;
  endless?: boolean;
}

export async function createGame(input: CreateGameInput): Promise<ServiceOutcome<SaveRecord>> {
  const name = input.gameName?.trim() || `${input.playerName.trim() || 'Trader'}'s dynasty`;
  if (name.length > 80) return { ok: false, code: 'invalid_input', message: 'A game name is at most 80 characters.' };
  const playerName = input.playerName.trim();
  if (playerName.length < 1 || playerName.length > 40) {
    return { ok: false, code: 'invalid_input', message: 'Choose a character name between 1 and 40 characters.' };
  }

  let created;
  try {
    created = createNewGame({
      userId: input.userId,
      playerName,
      gameName: name,
      ...(input.seed ? { seed: input.seed.slice(0, 64) } : {}),
      difficulty: input.difficulty ?? 'standard',
      ...(input.startLocationId ? { startLocationId: input.startLocationId } : {}),
      permadeath: input.permadeath ?? false,
      endless: input.endless ?? false,
    });
  } catch (error) {
    return { ok: false, code: 'internal_error', message: `A new game could not be created: ${error instanceof Error ? error.message : String(error)}` };
  }

  const store = getStore();
  const state: GameState = { ...created.state, version: 0 };
  const saved = await store.saveGame({ ...extractMetadata(state), state, reason: 'new game' }, null);
  if (!saved.ok) {
    if (saved.code === 'conflict') return { ok: false, code: 'conflict', message: saved.message };
    return { ok: false, code: 'internal_error', message: saved.message };
  }
  await store.appendAudit({
    userId: input.userId,
    gameId: state.gameId,
    action: 'game.create',
    ok: true,
    code: null,
    day: state.world.day,
    turn: state.turn,
    detail: `seed=${created.seed} difficulty=${state.config.difficulty} issues=${created.issues.length}`,
  });
  return { ok: true, value: saved.value };
}

export async function loadGame(userId: ID, gameId: ID): Promise<ServiceOutcome<SaveRecord>> {
  const store = getStore();
  const loaded = await store.loadGame(gameId, userId);
  if (!loaded.ok) {
    const code: ApiErrorCode = loaded.code === 'not_found' ? 'not_found' : loaded.code === 'corrupt' ? 'state_corrupt' : loaded.code === 'validation_failed' ? 'state_corrupt' : 'internal_error';
    return { ok: false, code, message: loaded.message };
  }
  return { ok: true, value: loaded.value };
}

export async function deleteGame(userId: ID, gameId: ID): Promise<ServiceOutcome<{ deleted: true }>> {
  const store = getStore();
  const result = await store.deleteGame(gameId, userId);
  if (!result.ok) {
    return { ok: false, code: result.code === 'not_found' ? 'not_found' : 'internal_error', message: result.message };
  }
  await store.appendAudit({ userId, gameId, action: 'game.delete', ok: true, code: null, day: 0, turn: 0, detail: null });
  return { ok: true, value: { deleted: true } };
}

export async function listVersions(userId: ID, gameId: ID, limit?: number): Promise<ServiceOutcome<SaveVersionRow[]>> {
  const store = getStore();
  const result = await store.listVersions(gameId, userId, limit ?? B.saves.maxSaveVersions);
  if (!result.ok) return { ok: false, code: result.code === 'not_found' ? 'not_found' : 'internal_error', message: result.message };
  return { ok: true, value: result.value };
}

export async function restoreVersion(userId: ID, gameId: ID, version: number): Promise<ServiceOutcome<SaveRecord>> {
  if (!Number.isInteger(version) || version < 0) {
    return { ok: false, code: 'invalid_input', message: 'A version number must be a non-negative integer.' };
  }
  const store = getStore();
  const result = await store.restoreVersion(gameId, userId, version);
  if (!result.ok) {
    const code: ApiErrorCode = result.code === 'not_found' ? 'not_found' : result.code === 'corrupt' ? 'state_corrupt' : result.code === 'conflict' ? 'conflict' : 'internal_error';
    return { ok: false, code, message: result.message };
  }
  await store.appendAudit({ userId, gameId, action: 'game.restore', ok: true, code: null, day: result.value.day, turn: result.value.turn, detail: `version ${version}` });
  return { ok: true, value: result.value };
}

/* ------------------------------------------------------------------ */
/* Intents                                                             */
/* ------------------------------------------------------------------ */

/** Longest accepted idempotency key. The database constraint is 128. */
const MAX_REQUEST_ID = 128;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;

/** A client-supplied idempotency key, or null when the caller did not send one. */
export function normaliseRequestId(raw: unknown): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, message: 'A request id must be a string.' };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > MAX_REQUEST_ID) return { ok: false, message: `A request id is at most ${MAX_REQUEST_ID} characters.` };
  if (!REQUEST_ID_PATTERN.test(trimmed)) {
    return { ok: false, message: 'A request id may contain letters, digits, dot, dash, colon and underscore only.' };
  }
  return { ok: true, value: trimmed };
}

/** Fingerprint of a validated intent, used to detect a request id reused for a different action. */
function intentFingerprint(intent: ActionIntent): string {
  return digestHex(JSON.stringify(intent));
}

/**
 * Validate, dispatch and persist one intent.
 *
 * The client's `expectedVersion` is what makes this conflict-safe: the state is
 * loaded, mutated in memory, and written back only if nobody else wrote in between.
 * It is *required* for state-changing intents — see `requireExpectedVersion` — because
 * a client that does not say which version it acted on cannot be protected from a
 * stale second tab, and the server must not guess.
 */
export async function performIntent(userId: ID, gameId: ID, rawIntent: unknown, options: PerformIntentOptions = {}): Promise<ServiceOutcome<IntentOutcome>> {
  const parsed = parseIntent(rawIntent);
  if (!parsed.ok) {
    return { ok: false, code: 'validation_failed', message: parsed.message, details: parsed.issues };
  }
  return performValidatedIntent(userId, gameId, parsed.intent, options);
}

/**
 * Dispatch an already-validated intent. Used by tests and by server-side flows.
 *
 * Order of operations is deliberate:
 *
 *   1. rate limit          — cheap, protects everything below
 *   2. idempotency replay  — *before* the version check, so a retry of a command that
 *                            already committed returns the original answer rather
 *                            than a confusing conflict
 *   3. load + ownership    — the store scopes the read by `userId`; nobody can load
 *                            another player's game by guessing an id
 *   4. version check       — compare-and-set precondition
 *   5. dispatch            — the authoritative simulation
 *   6. persist with CAS    — a losing writer is told, never silently overwritten
 *   7. audit + receipt     — trail, then the replay record
 */
export async function performValidatedIntent(
  userId: ID,
  gameId: ID,
  intent: ActionIntent,
  options: PerformIntentOptions = {},
): Promise<ServiceOutcome<IntentOutcome>> {
  const store = getStore();
  const free = isFreeIntent(intent.type);

  const limitKey = options.limitKey ?? userId;
  const rateLimit = consume(`${limitKey}:action`, ACTION_BUDGET);
  if (!rateLimit.allowed) {
    return {
      ok: false,
      code: 'rate_limited',
      message: `Too many actions: the limit is ${rateLimit.limit} per action window. Wait ${Math.ceil(rateLimit.retryAfterMs / 1000)}s.`,
      retryAfterMs: rateLimit.retryAfterMs,
    };
  }

  const requestKey = normaliseRequestId(options.requestId ?? null);
  if (!requestKey.ok) return { ok: false, code: 'validation_failed', message: requestKey.message };
  const requestId = requestKey.value;

  /* 2. Idempotency: has this exact command already been executed? */
  if (requestId && !free) {
    const existing = await store.findIntentReceipt(gameId, requestId);
    if (!existing.ok) return { ok: false, code: 'internal_error', message: existing.message };
    if (existing.value) {
      if (existing.value.userId !== userId) {
        // A key is scoped to (game, request id). A different account must not be able
        // to probe for the existence of another player's receipts.
        return { ok: false, code: 'not_found', message: `No save "${gameId}" for this account.` };
      }
      if (existing.value.intentHash !== intentFingerprint(intent) || existing.value.intentType !== intent.type) {
        return {
          ok: false,
          code: 'conflict',
          message: `Request id "${requestId}" was already used for a different action. Use a new request id for a new command.`,
        };
      }
      const current = await store.loadGame(gameId, userId);
      if (!current.ok) return { ok: false, code: 'not_found', message: current.message };
      let stored: ActionResultDto;
      try {
        stored = JSON.parse(existing.value.response) as ActionResultDto;
      } catch {
        // A receipt that cannot be parsed must not be replayed as if it were valid.
        return { ok: false, code: 'internal_error', message: 'The stored result for this request could not be read. Reload the game and try again.' };
      }
      return {
        ok: true,
        value: {
          response: { ...stored, message: stored.message ?? undefined },
          state: current.value.state,
          meta: extractMetadata(current.value.state),
          saved: existing.value.stateVersion !== null,
          replayed: true,
          requestId,
          rateLimit,
          conflict: null,
        },
      };
    }
  }

  /* 3. Load the authoritative state. Ownership is enforced by the query itself. */
  const loaded = await store.loadGame(gameId, userId);
  if (!loaded.ok) {
    const code: ApiErrorCode = loaded.code === 'not_found' ? 'not_found' : loaded.code === 'corrupt' || loaded.code === 'validation_failed' ? 'state_corrupt' : 'internal_error';
    return { ok: false, code, message: loaded.message };
  }
  const state = loaded.value.state;
  const versionAtLoad = loaded.value.version;

  /* 4. Compare-and-set precondition. */
  const versionRequired = options.requireExpectedVersion ?? !free;
  if (options.expectedVersion !== undefined && options.expectedVersion !== null && options.expectedVersion !== versionAtLoad) {
    return {
      ok: false,
      code: 'conflict',
      message: `This save has moved on to version ${versionAtLoad} but your request was based on version ${options.expectedVersion}. Reload to see the current state.`,
    };
  }
  if (versionRequired && (options.expectedVersion === undefined || options.expectedVersion === null)) {
    return {
      ok: false,
      code: 'validation_failed',
      message: `This action needs the save version it was planned against. Send expectedVersion (meta.version from your last load) — the server rejects a write it cannot prove is not stale.`,
    };
  }

  /* 5. Dispatch through the authoritative command pipeline. */
  const rng = rngForAction(state, intent.type);
  const result = dispatch(state, rng, intent, { userId, ...(requestId ? { requestId } : {}) });

  // Read-only intents (quotes, plans) do not advance the turn and are not worth a
  // write: any state they touch is lazy materialisation that is deterministically
  // rebuilt on demand.
  const shouldSave = !free || options.persistReadOnly === true;
  let savedMeta: SaveMetadata = extractMetadata(state);
  if (shouldSave) {
    const nextVersion = versionAtLoad + 1;
    const toSave = prepareForSave({ ...state, version: nextVersion }, gameId, userId);
    const saved = await store.saveGame({ ...extractMetadata(toSave), state: toSave, reason: options.reason ?? intent.type }, versionAtLoad);
    if (!saved.ok) {
      // The action already happened in memory but could not be persisted. The
      // client must not be told it succeeded: report the conflict and let it reload.
      await store.appendAudit({
        userId,
        gameId,
        action: intent.type,
        ok: false,
        code: 'save_conflict',
        day: state.world.day,
        turn: state.turn,
        detail: saved.message,
      });
      return { ok: false, code: saved.code === 'conflict' ? 'conflict' : 'internal_error', message: saved.message };
    }
    // `saveGame` returns the stored record, which includes the raw state document.
    // Only the metadata may travel: `meta` is what the client echoes back as
    // `expectedVersion`, not a second copy of the simulation.
    savedMeta = extractMetadata(saved.value.state);
  }

  await store.appendAudit({
    userId,
    gameId,
    action: intent.type,
    ok: result.ok,
    code: result.error ?? null,
    day: result.day,
    turn: result.turn,
    detail: result.message ? result.message.slice(0, 500) : null,
  });

  /* 7. Record the receipt so a retry replays instead of re-executing. */
  const response = actionResultDto(result as ActionResult<unknown>);
  if (requestId && !free) {
    const encoded = JSON.stringify(response);
    const stored = Buffer.byteLength(encoded, 'utf8') > DTO_LIMITS.receiptBytes
      ? JSON.stringify({
          ok: response.ok,
          error: response.error,
          message: response.message,
          warnings: response.warnings,
          notifications: [],
          day: response.day,
          turn: response.turn,
          auditId: response.auditId,
          dataTruncated: true,
        } satisfies ActionResultDto)
      : encoded;
    const recorded = await store.recordIntentReceipt({
      gameId,
      userId,
      requestId,
      intentType: intent.type,
      intentHash: intentFingerprint(intent),
      stateVersion: shouldSave ? savedMeta.version : null,
      day: result.day,
      turn: result.turn,
      response: stored,
    });
    // A receipt that could not be written is not fatal: the compare-and-set on the
    // version is what actually prevents a double apply, so the client is told the
    // action succeeded and the failure is logged for operations.
    if (!recorded.ok) console.error(`[intents] receipt for ${gameId}/${requestId} was not stored: ${recorded.message}`);
    else void store.pruneIntentReceipts(gameId, B.api.maxIntentReceiptsPerGame);
  }

  return {
    ok: true,
    value: {
      response,
      state,
      meta: savedMeta,
      saved: shouldSave,
      replayed: false,
      requestId,
      rateLimit,
      conflict: null,
    },
  };
}

/** Advance the world by N days — the idle/long-journey path. */
export async function advanceTime(userId: ID, gameId: ID, days: number, options: PerformIntentOptions = {}): Promise<ServiceOutcome<IntentOutcome>> {
  if (!Number.isInteger(days) || days < 1 || days > B.api.maxAdvanceDaysPerRequest) {
    return {
      ok: false,
      code: 'invalid_input',
      message: `Advance between 1 and ${B.api.maxAdvanceDaysPerRequest} days per request. Longer catch-ups must be split or run by a background worker.`,
    };
  }
  const intent: ActionIntent = days === 1 ? { type: 'time.advance_day' } : { type: 'time.advance_days', days };
  return performValidatedIntent(userId, gameId, intent, { ...options, reason: `advance ${days} day(s)` });
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface GameSummary {
  meta: SaveMetadata;
  status: GameStatus;
  cash: number;
  actionsLeft: number;
  notificationsUnread: number;
}

/** The small payload a save list or header needs, without shipping the whole state. */
export function summarise(record: SaveRecord): GameSummary {
  const state = record.state;
  return {
    meta: extractMetadata(state),
    status: state.status,
    cash: Math.round(state.player.accounts.reduce((sum, a) => sum + a.balance, 0) * 100) / 100,
    actionsLeft: state.player.stats.actionsToday,
    notificationsUnread: state.player.notifications.filter((n) => !n.read).length,
  };
}

/** Convenience wrapper used by tests: dispatch against an in-memory state only. */
export function dispatchInMemory(state: GameState, intent: ActionIntent, userId: ID): ActionResult<unknown> {
  return dispatch(state, rngForAction(state, intent.type), intent, { userId }) as ActionResult<unknown>;
}
