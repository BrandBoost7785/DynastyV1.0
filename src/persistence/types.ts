/**
 * Persistence contract.
 *
 * One interface, two adapters:
 *
 *  - `PostgresStore` — **production**. Supabase/PostgreSQL over `pg`. This is the
 *    persistence target for the deployed game.
 *  - `SqliteStore` — **development, sandbox and tests only**. Node's built-in
 *    `node:sqlite`, writing to a local file. It exists so the game is playable and
 *    testable with no network access; it is never selected in production (see
 *    `assertProductionConfig`) and must never grow into the production path.
 *
 * Design notes that shape every implementation:
 *
 *  • **Optimistic concurrency.** A save carries a monotonic `version`. Writing
 *    requires the version the client believes it has; a mismatch is a `conflict`,
 *    never a silent overwrite. Two tabs open on the same game cannot clobber each
 *    other.
 *  • **Metadata is relational, the simulation is a document.** Identity, versions,
 *    audit and leaderboard rows live in proper normalized tables with keys and
 *    indexes. The 25-system simulation state is a versioned JSON document with a
 *    schema version and an integrity hash, plus extracted columns for anything the
 *    server needs to query (day, net worth, level, score, status). Pretending a
 *    live simulation graph is a set of flat tables would make every balance change
 *    a migration; pretending it needs no structure would make leaderboards and
 *    conflict detection impossible. This does both jobs.
 *  • **Never trust a stored blob.** Loads are validated before they reach the sim,
 *    so a truncated or hand-edited row is reported as `corrupt` rather than
 *    crashing a request handler.
 */
import type { DbDriver } from '../config/env';
import type { GameEnding, GameState, GameStatus, ID } from '../sim/types';

export type StoreErrorCode =
  | 'not_found'
  | 'conflict'
  | 'corrupt'
  | 'unavailable'
  | 'validation_failed'
  | 'duplicate'
  | 'internal';

export type StoreResult<T> = { ok: true; value: T } | { ok: false; code: StoreErrorCode; message: string };

/** Indexed, queryable facts about a save — everything a list or leaderboard needs. */
export interface SaveMetadata {
  gameId: ID;
  userId: ID;
  name: string;
  status: GameStatus;
  schemaVersion: number;
  /** Monotonic; the client must present this to write. */
  version: number;
  day: number;
  turn: number;
  level: number;
  title: string;
  netWorth: number;
  empireScore: number;
  worldSeed: string;
  difficulty: string;
  locationId: ID;
  incarcerated: boolean;
  endingKind: GameEnding['kind'] | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveRecord extends SaveMetadata {
  state: GameState;
  /** Why this save exists — 'manual', 'autosave', 'restored version N'. Recorded in history. */
  reason?: string | null;
}

/** A row of the leaderboard: the public face of somebody's empire. */
export interface LeaderboardRow {
  userId: ID;
  displayName: string;
  title: string;
  level: number;
  netWorth: number;
  empireScore: number;
  day: number;
  status: GameStatus;
  gameId: ID;
}

export interface UserRecord {
  id: ID;
  email: string;
  displayName: string;
  /**
   * scrypt hash for the dev fallback authenticator. Always null when Supabase Auth
   * owns identity — the production adapter never stores a password.
   */
  passwordHash: string | null;
  authProvider: 'local' | 'supabase';
  createdAt: string;
  lastSeenAt: string | null;
}

export interface SessionRecord {
  id: ID;
  userId: ID;
  createdAt: string;
  expiresAt: string;
  userAgent: string | null;
}

export interface AuditRecord {
  id: ID;
  userId: ID;
  gameId: ID | null;
  action: string;
  ok: boolean;
  code: string | null;
  day: number;
  turn: number;
  detail: string | null;
  createdAt: string;
}

/**
 * A recorded outcome for one idempotent command.
 *
 * A browser retries — a double click, a reconnect, a timed-out response that
 * actually succeeded. The receipt is what makes the retry safe: the key is
 * `(game_id, request_id)`, the payload fingerprint catches a request id reused for a
 * *different* action, and `response` holds the already-sanitised result so a replay
 * returns the same answer without touching the simulation a second time.
 *
 * This lives in its own table (not inside the save document) so that the
 * compare-and-set on `games.version` remains the single concurrency primitive and
 * the simulation state stays free of transport concerns.
 */
export interface IntentReceiptRecord {
  gameId: ID;
  userId: ID;
  /** Client-supplied idempotency key. */
  requestId: string;
  intentType: string;
  /** Digest of the validated intent payload; a mismatch means the key was reused. */
  intentHash: string;
  /** Save version produced by the command, or null for a command that did not persist. */
  stateVersion: number | null;
  day: number;
  turn: number;
  /** Sanitised action result, JSON-encoded. Never raw simulation state. */
  response: string;
  createdAt: string;
}

/** A stored snapshot of a previous save version, for rollback and diagnostics. */
export interface SaveVersionRow {
  gameId: ID;
  version: number;
  day: number;
  netWorth: number;
  savedAt: string;
  sizeBytes: number;
  reason: string | null;
}

export interface GameStore {
  readonly driver: DbDriver;

  /** Create tables/indexes if missing. Idempotent; called on boot and by migrate. */
  init(): Promise<void>;
  /** Cheap liveness probe for `/api/health` and boot-time diagnostics. */
  health(): Promise<{ ok: boolean; driver: DbDriver; detail: string }>;
  close(): Promise<void>;

  /* ------------------------------- identity ------------------------------ */
  createUser(input: {
    id: ID;
    email: string;
    displayName: string;
    passwordHash: string | null;
    authProvider: UserRecord['authProvider'];
  }): Promise<StoreResult<UserRecord>>;
  findUserById(id: ID): Promise<StoreResult<UserRecord | null>>;
  findUserByEmail(email: string): Promise<StoreResult<UserRecord | null>>;
  touchUser(id: ID): Promise<StoreResult<void>>;
  /**
   * Replace a stored password hash. Used when scrypt parameters are raised, so an
   * old hash is upgraded the next time the password is proven — never by a client.
   */
  updateUserPassword(id: ID, passwordHash: string): Promise<StoreResult<void>>;

  /* ------------------------- sessions (dev fallback) ---------------------- */
  createSession(input: { id: ID; userId: ID; expiresAt: string; userAgent?: string | null }): Promise<StoreResult<SessionRecord>>;
  findSession(id: ID): Promise<StoreResult<SessionRecord | null>>;
  deleteSession(id: ID): Promise<StoreResult<void>>;
  deleteSessionsForUser(userId: ID): Promise<StoreResult<number>>;

  /* --------------------------------- saves -------------------------------- */
  listGames(userId: ID): Promise<StoreResult<SaveMetadata[]>>;
  loadGame(gameId: ID, userId: ID): Promise<StoreResult<SaveRecord>>;
  /**
   * Persist a save. `expectedVersion` is the version the caller read; a mismatch
   * returns `conflict` and writes nothing.
   */
  saveGame(record: SaveRecord, expectedVersion: number | null): Promise<StoreResult<SaveRecord>>;
  deleteGame(gameId: ID, userId: ID): Promise<StoreResult<void>>;
  listVersions(gameId: ID, userId: ID, limit?: number): Promise<StoreResult<SaveVersionRow[]>>;
  /** Restore a stored version as the current save (returns the restored record). */
  restoreVersion(gameId: ID, userId: ID, version: number): Promise<StoreResult<SaveRecord>>;

  /* ------------------------------ leaderboard ----------------------------- */
  leaderboard(limit?: number): Promise<StoreResult<LeaderboardRow[]>>;

  /* ------------------------------ idempotency ----------------------------- */
  /** The receipt recorded for a command, if this key has already been used. */
  findIntentReceipt(gameId: ID, requestId: string): Promise<StoreResult<IntentReceiptRecord | null>>;
  /**
   * Record a command outcome. Recording the same key twice is not an error and does
   * not overwrite the first receipt — the caller decides what a replay means.
   */
  recordIntentReceipt(record: Omit<IntentReceiptRecord, 'createdAt'> & { createdAt?: string }): Promise<StoreResult<IntentReceiptRecord>>;
  /** Keep only the newest `keep` receipts for a game. Returns how many were dropped. */
  pruneIntentReceipts(gameId: ID, keep: number): Promise<StoreResult<number>>;

  /* --------------------------------- audit -------------------------------- */
  appendAudit(entry: Omit<AuditRecord, 'id' | 'createdAt'> & { id?: ID; createdAt?: string }): Promise<StoreResult<AuditRecord>>;
  recentAudit(userId: ID, limit?: number): Promise<StoreResult<AuditRecord[]>>;
}

export const ok = <T>(value: T): StoreResult<T> => ({ ok: true, value });
export const err = <T>(code: StoreErrorCode, message: string): StoreResult<T> => ({ ok: false, code, message });
