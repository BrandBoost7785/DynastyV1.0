/**
 * Save serialization: the boundary between a live `GameState` and a stored row.
 *
 * Responsibilities, in the order they matter:
 *
 *  1. **Extract queryable metadata** so saves, leaderboards and conflict checks
 *     never have to parse a 1 MB document.
 *  2. **Seal the document** with a canonical-JSON integrity hash, so a truncated
 *     or hand-edited blob is detected on load instead of producing a state that
 *     silently violates its own invariants.
 *  3. **Refuse what we cannot honour.** A save written by a newer schema version
 *     is rejected with an actionable message rather than being half-parsed; a
 *     document over the size ceiling is rejected before it reaches the database.
 *  4. **Validate on load** through the sim's own `validateState`, because a save
 *     that parses is not the same as a save that is legal.
 */
import { getBalance } from '../config/balance';
import { canonicalJson, digestHex } from '../lib/hash';
import { adoptLegacyTransactionLedger, computeNetWorth, empireScore, validateState, verifyTransactionChain } from '../sim/state';
import type { GameState, ID, PlayerState, ProgressionState, TransactionChainState, TransactionRecord } from '../sim/types';
import { err, ok, type SaveMetadata, type StoreResult } from './types';

const B = getBalance();

/** What the current build writes and reads. */
export const CURRENT_SCHEMA_VERSION = B.saves.schemaVersion;
export const MAX_STATE_BYTES = B.saves.maxStateBytes;
export const MAX_SAVE_VERSIONS = B.saves.maxSaveVersions;

/**
 * The indexed facts about a save.
 *
 * Everything here is derived from the state, never accepted from a client, so a
 * leaderboard cannot be inflated by posting a score.
 */
export function extractMetadata(state: GameState): SaveMetadata {
  const netWorth = computeNetWorth(state).total;
  return {
    gameId: state.gameId,
    userId: state.userId,
    name: state.name,
    status: state.status,
    schemaVersion: state.schemaVersion,
    version: state.version,
    day: state.world.day,
    turn: state.turn,
    level: state.player.progression.level,
    title: state.player.progression.currentTitle,
    netWorth: Math.round(netWorth * 100) / 100,
    empireScore: Math.round(empireScore(state) * 100) / 100,
    worldSeed: state.config.worldSeed,
    difficulty: state.config.difficulty,
    locationId: state.player.locationId,
    incarcerated: state.player.prison.incarcerated,
    endingKind: state.ending?.kind ?? null,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

export interface SerializedState {
  json: string;
  integrityHash: string;
  sizeBytes: number;
}

/**
 * Serialize deterministically.
 *
 * `canonicalJson` sorts object keys, so the same state always produces the same
 * bytes and therefore the same hash — which is what makes the seal worth checking
 * and makes save diffs meaningful.
 */
export function serializeState(state: GameState): StoreResult<SerializedState> {
  let json: string;
  try {
    json = canonicalJson(state);
  } catch (error) {
    return err('internal', `State could not be serialized: ${error instanceof Error ? error.message : String(error)}`);
  }
  const sizeBytes = Buffer.byteLength(json, 'utf8');
  if (sizeBytes > MAX_STATE_BYTES) {
    return err(
      'validation_failed',
      `Save is ${(sizeBytes / 1_000_000).toFixed(1)} MB, over the ${(MAX_STATE_BYTES / 1_000_000).toFixed(0)} MB ceiling. This usually means an unbounded collection (diagnostics, notifications or transaction history) escaped its ring buffer.`,
    );
  }
  return ok({ json, integrityHash: digestHex(json), sizeBytes });
}

export interface DeserializeOptions {
  /** Seal to verify against. Omit only when migrating an unsealed legacy row. */
  expectedHash?: string | null;
  /** Run the sim's invariant checks (default true). */
  validate?: boolean;
}

/**
 * Rebuild a state from a stored document.
 *
 * Failure modes are distinguished because they need different responses: a hash
 * mismatch means corruption (restore a previous version), a schema mismatch means
 * the build and the save disagree (run a migration), and a validation failure
 * means the document parses but describes an impossible game (quarantine it).
 */
export function deserializeState(json: string, opts: DeserializeOptions = {}): StoreResult<GameState> {
  if (opts.expectedHash) {
    const actual = digestHex(json);
    if (actual !== opts.expectedHash) {
      return err('corrupt', `Integrity check failed (expected ${opts.expectedHash.slice(0, 12)}…, found ${actual.slice(0, 12)}…). The stored save is damaged; restore a previous version.`);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return err('corrupt', `Save is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return err('corrupt', 'Save document is not an object.');
  }
  const candidate = parsed as Partial<GameState>;
  if (typeof candidate.gameId !== 'string' || typeof candidate.userId !== 'string') {
    return err('corrupt', 'Save document is missing its identity fields.');
  }
  if (!candidate.world || !candidate.player || !candidate.markets) {
    return err('corrupt', 'Save document is missing world, player or market data.');
  }

  const version = candidate.schemaVersion;
  if (typeof version !== 'number') {
    return err('corrupt', 'Save document has no schema version.');
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return err(
      'validation_failed',
      `This save was written by a newer version of the game (schema ${version}, this build understands ${CURRENT_SCHEMA_VERSION}). Update the server before loading it.`,
    );
  }
  if (version < CURRENT_SCHEMA_VERSION) {
    const migrated = migrateState(candidate as GameState, version);
    if (!migrated.ok) return migrated;
    return finishLoad(migrated.value, opts);
  }

  return finishLoad(candidate as GameState, opts);
}

function finishLoad(state: GameState, opts: DeserializeOptions): StoreResult<GameState> {
  if (opts.validate === false) return ok(state);
  const issues = validateState(state).filter((issue) => issue.severity === 'error');
  if (issues.length > 0) {
    const summary = issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`).join('; ');
    return err(
      'validation_failed',
      `The save parsed but breaks ${issues.length} game invariant(s): ${summary}. It was not loaded, because continuing from an impossible state would corrupt the economy.`,
    );
  }
  return ok(state);
}

/**
 * Upgrade an older schema version to the current one.
 *
 * Migrations are additive and defensive: each step fills in what a newer build
 * expects, and anything unrecognised is reported rather than guessed at. Adding a
 * step here is how a `GameState` shape change ships without orphaning saves.
 */
export function migrateState(state: GameState, fromVersion: number): StoreResult<GameState> {
  let current = state;
  for (let v = fromVersion; v < CURRENT_SCHEMA_VERSION; v += 1) {
    switch (v) {
      case 1: {
        const migrated = migrate1to2(current);
        if (!migrated.ok) return migrated;
        current = migrated.value;
        break;
      }
      // When schemaVersion is bumped again, add `case 2: …` here. A version with
      // no step is refused rather than guessed at: an unknown shape must never be
      // half-adopted into a live game.
      default:
        return err('validation_failed', `No migration path from schema version ${v} to ${CURRENT_SCHEMA_VERSION}.`);
    }
  }
  current = { ...current, schemaVersion: CURRENT_SCHEMA_VERSION };
  return ok(current);
}

/**
 * Schema 1 → 2: give the transaction ledger a verifiable eviction checkpoint.
 *
 * Version 1 linked each record to the one before it by array position, with a
 * literal `'genesis'` fallback for the first entry. Once the 240-record ring
 * buffer dropped its oldest entries that fallback no longer matched anything, so
 * a perfectly honest save failed `validateState` and could never be loaded again
 * — an ordinary player hit it around day 141 of owning one property.
 *
 * Version 2 stores the link (`prevHash`) and a lifetime sequence number (`seq`) on
 * every record, plus a `transactionChain` checkpoint that remembers what was
 * evicted. Migration is non-destructive: retained records are re-sequenced and
 * re-hashed, and no money, item or progression value is touched.
 *
 * A version-1 ledger that does not verify under the *old* rule is refused, not
 * repaired. At that point an edited history and a history broken by the eviction
 * bug are indistinguishable, and guessing would mean trusting data we cannot
 * vouch for. The refusal names the offending record so it can be diagnosed.
 */
function migrate1to2(state: GameState): StoreResult<GameState> {
  const player = state.player as PlayerState & {
    transactionChain?: TransactionChainState | null;
    recentTransactions?: TransactionRecord[];
  };
  if (!Array.isArray(player.recentTransactions)) {
    return err('corrupt', 'Save has no transaction ledger to migrate.');
  }

  // Already on the new shape (a partially migrated document, or a save written by
  // a build that adopted the field before bumping the version): verify rather than
  // redo, so migrating twice cannot silently rewrite history.
  if (player.transactionChain) {
    const check = verifyTransactionChain(player.recentTransactions, player.transactionChain);
    if (!check.ok) {
      return err('validation_failed', `Transaction ledger failed verification during migration: ${check.reason ?? 'unknown reason'}`);
    }
    return ok(state);
  }

  const adopted = adoptLegacyTransactionLedger(state, 1);
  if (!adopted.ok) {
    return err(
      'validation_failed',
      `Transaction ledger record ${adopted.brokenAtIndex} does not match its integrity hash, so this save cannot be migrated. ` +
        'It was not loaded and nothing was discarded: restore an earlier version, or inspect the record before deciding.',
    );
  }

  // Progression gained two prestige bookkeeping fields in the same bump. Fill them
  // from what the save already says rather than inventing history.
  const progression = state.player.progression as ProgressionState & {
    lastPrestigeDay?: number | null;
    lastPrestigeNetWorth?: number;
  };
  if (progression.lastPrestigeDay === undefined) progression.lastPrestigeDay = null;
  if (progression.lastPrestigeNetWorth === undefined) progression.lastPrestigeNetWorth = 0;

  return ok(state);
}

/** A short, stable fingerprint used in logs and audit rows. */
export function stateFingerprint(state: GameState): string {
  return digestHex(`${state.gameId}:${state.version}:${state.world.day}:${state.turn}`).slice(0, 12);
}

/** Stamp the fields the store owns before persisting. */
export function prepareForSave(state: GameState, gameId: ID, userId: ID): GameState {
  return {
    ...state,
    gameId,
    userId,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    lastTickDay: state.world.day,
    updatedAt: new Date().toISOString(),
  };
}
