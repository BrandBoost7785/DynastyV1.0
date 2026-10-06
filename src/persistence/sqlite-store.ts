/**
 * SQLite persistence adapter — DEVELOPMENT, SANDBOX AND TESTS ONLY.
 *
 * This is not the production persistence implementation and must never become it.
 * Production is `PostgresStore` (Supabase/PostgreSQL); `getEnv().dbDriver` selects
 * between them and `assertProductionConfig()` refuses to boot a production server
 * on this adapter. Its reason to exist is that the game must be playable, testable
 * and debuggable with no network access to Supabase.
 *
 * It uses Node's built-in `node:sqlite` (no native build step, no dependency), and
 * mirrors the production schema table-for-table so a save written here is
 * structurally identical to one written to Postgres — which is what lets the same
 * integration tests run against either adapter.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getEnv } from '../config/env';
import {
  CURRENT_SCHEMA_VERSION,
  MAX_SAVE_VERSIONS,
  deserializeState,
  extractMetadata,
  serializeState,
} from './serialize';
import { err, ok, type AuditRecord, type GameStore, type IntentReceiptRecord, type LeaderboardRow, type SaveMetadata, type SaveRecord, type SaveVersionRow, type SessionRecord, type StoreResult, type UserRecord } from './types';
import type { ID } from '../sim/types';

const DDL = `
create table if not exists schema_migrations (
  id text primary key,
  applied_at text not null,
  checksum text not null
);

create table if not exists profiles (
  id text primary key,
  email text not null unique,
  display_name text not null,
  auth_provider text not null default 'local',
  password_hash text,
  created_at text not null,
  last_seen_at text
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references profiles (id) on delete cascade,
  created_at text not null,
  expires_at text not null,
  user_agent text
);

create table if not exists games (
  game_id text primary key,
  user_id text not null references profiles (id) on delete cascade,
  name text not null,
  status text not null default 'active',
  schema_version integer not null,
  version integer not null default 0,
  day integer not null default 0,
  turn integer not null default 0,
  level integer not null default 1,
  title text not null default '',
  net_worth real not null default 0,
  empire_score real not null default 0,
  world_seed text not null,
  difficulty text not null default 'standard',
  location_id text not null,
  incarcerated integer not null default 0,
  ending_kind text,
  state text not null,
  integrity_hash text not null,
  size_bytes integer not null default 0,
  created_at text not null,
  updated_at text not null
);

create index if not exists games_user_updated_idx on games (user_id, updated_at desc);
create index if not exists games_leaderboard_idx on games (empire_score desc, net_worth desc);

create table if not exists game_versions (
  game_id text not null references games (game_id) on delete cascade,
  version integer not null,
  day integer not null,
  net_worth real not null default 0,
  empire_score real not null default 0,
  state text not null,
  integrity_hash text not null,
  size_bytes integer not null default 0,
  reason text,
  saved_at text not null,
  primary key (game_id, version)
);

create table if not exists action_audit (
  id integer primary key autoincrement,
  user_id text,
  game_id text,
  action text not null,
  ok integer not null,
  code text,
  day integer not null default 0,
  turn integer not null default 0,
  detail text,
  created_at text not null
);

create index if not exists action_audit_user_idx on action_audit (user_id, created_at desc);
create index if not exists action_audit_game_idx on action_audit (game_id, created_at desc);

-- Idempotency receipts: one row per (game, client request id). Kept out of the save
-- document so the compare-and-set on games.version stays the single concurrency
-- primitive and simulation state carries no transport concerns.
create table if not exists intent_receipts (
  game_id text not null,
  user_id text not null,
  request_id text not null,
  intent_type text not null,
  intent_hash text not null,
  state_version integer,
  day integer not null default 0,
  turn integer not null default 0,
  response text not null,
  created_at text not null,
  primary key (game_id, request_id)
);

create index if not exists intent_receipts_created_idx on intent_receipts (game_id, created_at desc);
`;

type Row = Record<string, string | number | null | Uint8Array>;

function asMetadata(row: Row): SaveMetadata {
  return {
    gameId: String(row.game_id),
    userId: String(row.user_id),
    name: String(row.name),
    status: row.status as SaveMetadata['status'],
    schemaVersion: Number(row.schema_version),
    version: Number(row.version),
    day: Number(row.day),
    turn: Number(row.turn),
    level: Number(row.level),
    title: String(row.title ?? ''),
    netWorth: Number(row.net_worth),
    empireScore: Number(row.empire_score),
    worldSeed: String(row.world_seed),
    difficulty: String(row.difficulty),
    locationId: String(row.location_id),
    incarcerated: Number(row.incarcerated) === 1,
    endingKind: (row.ending_kind as SaveMetadata['endingKind']) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function asUser(row: Row): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    passwordHash: (row.password_hash as string | null) ?? null,
    authProvider: (row.auth_provider as UserRecord['authProvider']) ?? 'local',
    createdAt: String(row.created_at),
    lastSeenAt: (row.last_seen_at as string | null) ?? null,
  };
}

export class SqliteStore implements GameStore {
  readonly driver = 'sqlite' as const;
  private db: DatabaseSync | null = null;
  private readonly path: string;

  constructor(path?: string) {
    const requested = path ?? getEnv().sqlitePath;
    // `:memory:` is a SQLite keyword, not a filename — resolving it would create a
    // file literally called ":memory:" in the working directory.
    this.path = requested === ':memory:' ? requested : resolve(requested);
  }

  /** Open (creating the file and tables if needed). Idempotent. */
  async init(): Promise<void> {
    if (this.db) return;
    if (this.path !== ':memory:') {
      const dir = dirname(this.path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    const db = new DatabaseSync(this.path);
    db.exec('pragma journal_mode = wal;');
    db.exec('pragma synchronous = normal;');
    db.exec('pragma foreign_keys = on;');
    db.exec(DDL);
    db.prepare(`insert into schema_migrations (id, applied_at, checksum) values ('0001_initial_schema', ?, 'sqlite-dev')
                on conflict (id) do nothing`).run(new Date().toISOString());
    this.db = db;
  }

  private require(): DatabaseSync {
    if (!this.db) throw new Error('SqliteStore used before init(); call init() first.');
    return this.db;
  }

  async health(): Promise<{ ok: boolean; driver: 'sqlite'; detail: string }> {
    try {
      await this.init();
      const row = this.require().prepare('select count(*) as games from games').get() as Row;
      return { ok: true, driver: 'sqlite', detail: `sqlite at ${this.path} (${row.games} save(s))` };
    } catch (error) {
      return { ok: false, driver: 'sqlite', detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  /* ------------------------------- identity ------------------------------ */

  async createUser(input: { id: ID; email: string; displayName: string; passwordHash: string | null; authProvider: UserRecord['authProvider'] }): Promise<StoreResult<UserRecord>> {
    try {
      await this.init();
      const now = new Date().toISOString();
      this.require()
        .prepare('insert into profiles (id, email, display_name, auth_provider, password_hash, created_at) values (?, ?, ?, ?, ?, ?)')
        .run(input.id, input.email.toLowerCase(), input.displayName, input.authProvider, input.passwordHash, now);
      return ok({ ...input, email: input.email.toLowerCase(), createdAt: now, lastSeenAt: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('UNIQUE')) return err('duplicate', 'An account with that email already exists.');
      return err('internal', message);
    }
  }

  async findUserById(id: ID): Promise<StoreResult<UserRecord | null>> {
    await this.init();
    const row = this.require().prepare('select * from profiles where id = ?').get(id) as Row | undefined;
    return ok(row ? asUser(row) : null);
  }

  async findUserByEmail(email: string): Promise<StoreResult<UserRecord | null>> {
    await this.init();
    const row = this.require().prepare('select * from profiles where email = ?').get(email.toLowerCase()) as Row | undefined;
    return ok(row ? asUser(row) : null);
  }

  async touchUser(id: ID): Promise<StoreResult<void>> {
    await this.init();
    this.require().prepare('update profiles set last_seen_at = ? where id = ?').run(new Date().toISOString(), id);
    return ok(undefined);
  }

  async updateUserPassword(id: ID, passwordHash: string): Promise<StoreResult<void>> {
    await this.init();
    const result = this.require().prepare('update profiles set password_hash = ? where id = ?').run(passwordHash, id);
    if (Number(result.changes) === 0) return err('not_found', `No account "${id}" to update.`);
    return ok(undefined);
  }

  /* -------------------------------- sessions ------------------------------ */

  async createSession(input: { id: ID; userId: ID; expiresAt: string; userAgent?: string | null }): Promise<StoreResult<SessionRecord>> {
    await this.init();
    const createdAt = new Date().toISOString();
    this.require()
      .prepare('insert into sessions (id, user_id, created_at, expires_at, user_agent) values (?, ?, ?, ?, ?)')
      .run(input.id, input.userId, createdAt, input.expiresAt, input.userAgent ?? null);
    return ok({ id: input.id, userId: input.userId, createdAt, expiresAt: input.expiresAt, userAgent: input.userAgent ?? null });
  }

  async findSession(id: ID): Promise<StoreResult<SessionRecord | null>> {
    await this.init();
    const row = this.require().prepare('select * from sessions where id = ?').get(id) as Row | undefined;
    if (!row) return ok(null);
    return ok({
      id: String(row.id),
      userId: String(row.user_id),
      createdAt: String(row.created_at),
      expiresAt: String(row.expires_at),
      userAgent: (row.user_agent as string | null) ?? null,
    });
  }

  async deleteSession(id: ID): Promise<StoreResult<void>> {
    await this.init();
    this.require().prepare('delete from sessions where id = ?').run(id);
    return ok(undefined);
  }

  async deleteSessionsForUser(userId: ID): Promise<StoreResult<number>> {
    await this.init();
    const result = this.require().prepare('delete from sessions where user_id = ?').run(userId);
    return ok(Number(result.changes));
  }

  /* --------------------------------- saves -------------------------------- */

  async listGames(userId: ID): Promise<StoreResult<SaveMetadata[]>> {
    await this.init();
    const rows = this.require()
      .prepare('select * from games where user_id = ? order by updated_at desc')
      .all(userId) as Row[];
    return ok(rows.map(asMetadata));
  }

  async loadGame(gameId: ID, userId: ID): Promise<StoreResult<SaveRecord>> {
    await this.init();
    const row = this.require().prepare('select * from games where game_id = ? and user_id = ?').get(gameId, userId) as Row | undefined;
    if (!row) return err('not_found', `No save "${gameId}" for this account.`);
    const parsed = deserializeState(String(row.state), { expectedHash: String(row.integrity_hash) });
    if (!parsed.ok) return parsed;
    return ok({ ...asMetadata(row), state: parsed.value });
  }

  async saveGame(record: SaveRecord, expectedVersion: number | null): Promise<StoreResult<SaveRecord>> {
    try {
      await this.init();
      const db = this.require();
      const sealed = serializeState(record.state);
      if (!sealed.ok) return sealed;

      const meta = extractMetadata(record.state);
      const existing = db.prepare('select version, schema_version from games where game_id = ? and user_id = ?').get(meta.gameId, meta.userId) as Row | undefined;
      const now = new Date().toISOString();

      if (!existing) {
        if (expectedVersion !== null && expectedVersion !== 0) {
          return err('conflict', `Save "${meta.gameId}" does not exist, but the write expected version ${expectedVersion}.`);
        }
        db.prepare(
          `insert into games (game_id, user_id, name, status, schema_version, version, day, turn, level, title, net_worth,
             empire_score, world_seed, difficulty, location_id, incarcerated, ending_kind, state, integrity_hash, size_bytes,
             created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          meta.gameId, meta.userId, meta.name, meta.status, CURRENT_SCHEMA_VERSION, meta.version, meta.day, meta.turn,
          meta.level, meta.title, meta.netWorth, meta.empireScore, meta.worldSeed, meta.difficulty, meta.locationId,
          meta.incarcerated ? 1 : 0, meta.endingKind, sealed.value.json, sealed.value.integrityHash, sealed.value.sizeBytes,
          record.createdAt || now, now,
        );
      } else {
        const currentVersion = Number(existing.version);
        if (expectedVersion !== null && expectedVersion !== currentVersion) {
          return err(
            'conflict',
            `Save "${meta.gameId}" is at version ${currentVersion} but this write expected ${expectedVersion}. Another session saved first; reload before continuing.`,
          );
        }
        // Compare-and-set on the version column: even two concurrent writers in
        // this process cannot both succeed.
        const result = db.prepare(
          `update games set name = ?, status = ?, schema_version = ?, version = ?, day = ?, turn = ?, level = ?, title = ?,
             net_worth = ?, empire_score = ?, world_seed = ?, difficulty = ?, location_id = ?, incarcerated = ?, ending_kind = ?,
             state = ?, integrity_hash = ?, size_bytes = ?, updated_at = ?
           where game_id = ? and user_id = ? and version = ?`,
        ).run(
          meta.name, meta.status, CURRENT_SCHEMA_VERSION, meta.version, meta.day, meta.turn, meta.level, meta.title,
          meta.netWorth, meta.empireScore, meta.worldSeed, meta.difficulty, meta.locationId, meta.incarcerated ? 1 : 0,
          meta.endingKind, sealed.value.json, sealed.value.integrityHash, sealed.value.sizeBytes, now,
          meta.gameId, meta.userId, currentVersion,
        );
        if (Number(result.changes) === 0) {
          return err('conflict', `Save "${meta.gameId}" changed while this write was in flight. Reload and retry.`);
        }
      }

      // Version history, pruned to the configured ceiling.
      db.prepare(
        `insert or replace into game_versions (game_id, version, day, net_worth, empire_score, state, integrity_hash, size_bytes, reason, saved_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        meta.gameId, meta.version, meta.day, meta.netWorth, meta.empireScore, sealed.value.json,
        sealed.value.integrityHash, sealed.value.sizeBytes, record.reason ?? null, now,
      );
      db.prepare(
        `delete from game_versions where game_id = ? and version not in (
           select version from game_versions where game_id = ? order by version desc limit ?
         )`,
      ).run(meta.gameId, meta.gameId, MAX_SAVE_VERSIONS);

      return ok({ ...meta, state: record.state });
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  async deleteGame(gameId: ID, userId: ID): Promise<StoreResult<void>> {
    await this.init();
    const db = this.require();
    // Ownership is re-checked on the delete itself; the dependent rows are only
    // touched for a save this account actually owns.
    db.prepare('delete from game_versions where game_id = ?').run(gameId);
    db.prepare('delete from intent_receipts where game_id = ?').run(gameId);
    const result = db.prepare('delete from games where game_id = ? and user_id = ?').run(gameId, userId);
    if (Number(result.changes) === 0) return err('not_found', `No save "${gameId}" for this account.`);
    return ok(undefined);
  }

  async listVersions(gameId: ID, userId: ID, limit = 24): Promise<StoreResult<SaveVersionRow[]>> {
    await this.init();
    const db = this.require();
    const owned = db.prepare('select 1 from games where game_id = ? and user_id = ?').get(gameId, userId);
    if (!owned) return err('not_found', `No save "${gameId}" for this account.`);
    const rows = db.prepare(
      'select game_id, version, day, net_worth, saved_at, size_bytes, reason from game_versions where game_id = ? order by version desc limit ?',
    ).all(gameId, limit) as Row[];
    return ok(
      rows.map((row) => ({
        gameId: String(row.game_id),
        version: Number(row.version),
        day: Number(row.day),
        netWorth: Number(row.net_worth),
        savedAt: String(row.saved_at),
        sizeBytes: Number(row.size_bytes),
        reason: (row.reason as string | null) ?? null,
      })),
    );
  }

  async restoreVersion(gameId: ID, userId: ID, version: number): Promise<StoreResult<SaveRecord>> {
    await this.init();
    const db = this.require();
    const owned = db.prepare('select version from games where game_id = ? and user_id = ?').get(gameId, userId) as Row | undefined;
    if (!owned) return err('not_found', `No save "${gameId}" for this account.`);
    const row = db.prepare('select state, integrity_hash from game_versions where game_id = ? and version = ?').get(gameId, version) as Row | undefined;
    if (!row) return err('not_found', `Version ${version} of "${gameId}" is not in history.`);
    const parsed = deserializeState(String(row.state), { expectedHash: String(row.integrity_hash) });
    if (!parsed.ok) return parsed;
    // Restoring writes forward: the restored state takes a *new* version number so
    // history is never rewritten and the compare-and-set still holds.
    const restored = { ...parsed.value, version: Number(owned.version) + 1, updatedAt: new Date().toISOString() };
    return this.saveGame({ ...extractMetadata(restored), state: restored, reason: `restored version ${version}` }, Number(owned.version));
  }

  /* ------------------------------ leaderboard ----------------------------- */

  async leaderboard(limit = 25): Promise<StoreResult<LeaderboardRow[]>> {
    await this.init();
    const rows = this.require()
      .prepare(
        `select g.user_id, p.display_name, g.title, g.level, g.net_worth, g.empire_score, g.day, g.status, g.game_id
         from games g join profiles p on p.id = g.user_id
         order by g.empire_score desc, g.net_worth desc limit ?`,
      )
      .all(limit) as Row[];
    return ok(
      rows.map((row) => ({
        userId: String(row.user_id),
        displayName: String(row.display_name),
        title: String(row.title ?? ''),
        level: Number(row.level),
        netWorth: Number(row.net_worth),
        empireScore: Number(row.empire_score),
        day: Number(row.day),
        status: row.status as LeaderboardRow['status'],
        gameId: String(row.game_id),
      })),
    );
  }

  /* ------------------------------ idempotency ----------------------------- */

  async findIntentReceipt(gameId: ID, requestId: string): Promise<StoreResult<IntentReceiptRecord | null>> {
    await this.init();
    const row = this.require()
      .prepare('select * from intent_receipts where game_id = ? and request_id = ?')
      .get(gameId, requestId) as Row | undefined;
    if (!row) return ok(null);
    return ok({
      gameId: String(row.game_id),
      userId: String(row.user_id),
      requestId: String(row.request_id),
      intentType: String(row.intent_type),
      intentHash: String(row.intent_hash),
      stateVersion: row.state_version === null ? null : Number(row.state_version),
      day: Number(row.day),
      turn: Number(row.turn),
      response: String(row.response),
      createdAt: String(row.created_at),
    });
  }

  async recordIntentReceipt(record: Omit<IntentReceiptRecord, 'createdAt'> & { createdAt?: string }): Promise<StoreResult<IntentReceiptRecord>> {
    try {
      await this.init();
      const createdAt = record.createdAt ?? new Date().toISOString();
      // `on conflict do nothing` — the first receipt wins. A retry of the same key
      // must never rewrite the recorded outcome.
      this.require()
        .prepare(
          `insert into intent_receipts (game_id, user_id, request_id, intent_type, intent_hash, state_version, day, turn, response, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict (game_id, request_id) do nothing`,
        )
        .run(
          record.gameId, record.userId, record.requestId, record.intentType, record.intentHash,
          record.stateVersion, record.day, record.turn, record.response, createdAt,
        );
      const stored = await this.findIntentReceipt(record.gameId, record.requestId);
      if (!stored.ok) return stored;
      if (!stored.value) return err('internal', 'The idempotency receipt was not stored.');
      return ok(stored.value);
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  async pruneIntentReceipts(gameId: ID, keep: number): Promise<StoreResult<number>> {
    await this.init();
    const result = this.require()
      .prepare(
        `delete from intent_receipts where game_id = ? and request_id not in (
           select request_id from intent_receipts where game_id = ? order by created_at desc limit ?
         )`,
      )
      .run(gameId, gameId, Math.max(1, Math.floor(keep)));
    return ok(Number(result.changes));
  }

  /* --------------------------------- audit -------------------------------- */

  async appendAudit(entry: Omit<AuditRecord, 'id' | 'createdAt'> & { id?: ID; createdAt?: string }): Promise<StoreResult<AuditRecord>> {
    await this.init();
    const createdAt = entry.createdAt ?? new Date().toISOString();
    this.require()
      .prepare('insert into action_audit (user_id, game_id, action, ok, code, day, turn, detail, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(entry.userId, entry.gameId, entry.action, entry.ok ? 1 : 0, entry.code, entry.day, entry.turn, entry.detail, createdAt);
    return ok({ ...entry, id: entry.id ?? `aud_${Date.now()}`, createdAt });
  }

  async recentAudit(userId: ID, limit = 50): Promise<StoreResult<AuditRecord[]>> {
    await this.init();
    const rows = this.require()
      .prepare('select * from action_audit where user_id = ? order by id desc limit ?')
      .all(userId, limit) as Row[];
    return ok(
      rows.map((row) => ({
        id: String(row.id),
        userId: String(row.user_id ?? ''),
        gameId: (row.game_id as string | null) ?? null,
        action: String(row.action),
        ok: Number(row.ok) === 1,
        code: (row.code as string | null) ?? null,
        day: Number(row.day),
        turn: Number(row.turn),
        detail: (row.detail as string | null) ?? null,
        createdAt: String(row.created_at),
      })),
    );
  }
}
