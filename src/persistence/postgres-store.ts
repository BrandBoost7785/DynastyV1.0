/**
 * PostgreSQL persistence adapter — PRODUCTION.
 *
 * This is the persistence target for the deployed game (Supabase/PostgreSQL).
 * It implements exactly the same contract as the dev SQLite adapter, so the same
 * integration tests and the same application code run against either; only the
 * dialect differs.
 *
 * Security and integrity notes:
 *  • The server connects with a privileged role (`DATABASE_URL`), which bypasses
 *    row level security. That is deliberate: RLS in migration 0002 is the second
 *    lock for any direct client access, and the first lock is that every read and
 *    write goes through a route handler that has already authenticated the caller
 *    and scoped the query to their user id.
 *  • Writes are a compare-and-set on `games.version`. A stale write is rejected as
 *    a conflict and changes nothing.
 *  • Saved documents are sealed with a canonical-JSON hash and verified on load, so
 *    a damaged row is reported as corrupt instead of being handed to the sim.
 *  • Migrations are read from `supabase/migrations/*.sql` and tracked in
 *    `schema_migrations`; nothing is applied twice and a changed file is detected.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { getEnv } from '../config/env';
import { CURRENT_SCHEMA_VERSION, MAX_SAVE_VERSIONS, deserializeState, extractMetadata, serializeState } from './serialize';
import {
  err,
  ok,
  type AuditRecord,
  type GameStore,
  type IntentReceiptRecord,
  type LeaderboardRow,
  type SaveMetadata,
  type SaveRecord,
  type SaveVersionRow,
  type SessionRecord,
  type StoreResult,
  type UserRecord,
} from './types';
import type { ID } from '../sim/types';

const { Pool, types: pgTypes } = pg;

// numeric comes back as a string by default; money and scores are read as numbers
// everywhere in this codebase, so parse them at the driver boundary instead of
// scattering Number() calls through the application.
pgTypes.setTypeParser(pgTypes.builtins.NUMERIC, (value) => Number.parseFloat(value));
pgTypes.setTypeParser(pgTypes.builtins.INT8, (value) => Number.parseInt(value, 10));

type Row = Record<string, unknown>;

const str = (value: unknown, fallback = ''): string => (value === null || value === undefined ? fallback : String(value));
const num = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};
const bool = (value: unknown): boolean => value === true || value === 1 || value === 't' || value === 'true';

function asMetadata(row: Row): SaveMetadata {
  return {
    gameId: str(row.game_id),
    userId: str(row.user_id),
    name: str(row.name),
    status: str(row.status, 'active') as SaveMetadata['status'],
    schemaVersion: num(row.schema_version),
    version: num(row.version),
    day: num(row.day),
    turn: num(row.turn),
    level: num(row.level, 1),
    title: str(row.title),
    netWorth: num(row.net_worth),
    empireScore: num(row.empire_score),
    worldSeed: str(row.world_seed),
    difficulty: str(row.difficulty, 'standard'),
    locationId: str(row.location_id),
    incarcerated: bool(row.incarcerated),
    endingKind: (row.ending_kind as SaveMetadata['endingKind'] | null) ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : str(row.updated_at),
  };
}

function asUser(row: Row): UserRecord {
  return {
    id: str(row.id),
    email: str(row.email),
    displayName: str(row.display_name),
    passwordHash: (row.password_hash as string | null) ?? null,
    authProvider: (str(row.auth_provider, 'supabase') as UserRecord['authProvider']),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at),
    lastSeenAt: row.last_seen_at instanceof Date ? row.last_seen_at.toISOString() : ((row.last_seen_at as string | null) ?? null),
  };
}

export interface PostgresStoreOptions {
  connectionString?: string;
  /** Directory holding `*.sql` migrations. Defaults to the repo's supabase/migrations. */
  migrationsDir?: string;
  max?: number;
}

export class PostgresStore implements GameStore {
  readonly driver = 'postgres' as const;
  private pool: pg.Pool | null = null;
  private readonly connectionString: string | null;
  private readonly migrationsDir: string;
  private readonly max: number;

  constructor(options: PostgresStoreOptions = {}) {
    const env = getEnv();
    this.connectionString = options.connectionString ?? env.databaseUrl;
    this.migrationsDir = resolve(/* turbopackIgnore: true */ options.migrationsDir ?? 'supabase/migrations');
    this.max = options.max ?? Number(process.env.DYNASTY_DB_POOL_MAX ?? 5);
  }

  private requirePool(): pg.Pool {
    if (!this.pool) {
      if (!this.connectionString) {
        throw new Error('PostgresStore requires DATABASE_URL (or an explicit connectionString). The SQLite adapter is dev/test only.');
      }
      const ssl =
        process.env.DYNASTY_DB_SSL === 'disable'
          ? false
          : { rejectUnauthorized: process.env.DYNASTY_DB_SSL_REJECT_UNAUTHORIZED !== 'false' };
      this.pool = new Pool({ connectionString: this.connectionString, max: this.max, ssl, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
      this.pool.on('error', (error) => {
        // An idle client failing must not take the process down; the next query
        // re-establishes a connection.
        console.error('[persistence] idle postgres client error', error.message);
      });
    }
    return this.pool;
  }

  /** Create the tracking table and apply any pending migrations. */
  async init(): Promise<void> {
    await this.migrate();
  }

  async health(): Promise<{ ok: boolean; driver: 'postgres'; detail: string }> {
    try {
      const pool = this.requirePool();
      const result = await pool.query('select count(*)::int as games from games');
      const version = await pool.query('select version() as v');
      return { ok: true, driver: 'postgres', detail: `${String(version.rows[0]?.v ?? 'postgres').split(',')[0]} — ${result.rows[0]?.games ?? 0} save(s)` };
    } catch (error) {
      return { ok: false, driver: 'postgres', detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
  }

  /* ------------------------------- migrations ----------------------------- */

  /**
   * Apply every `*.sql` file in the migrations directory that has not been applied,
   * in filename order, each in its own transaction.
   */
  async migrate(): Promise<StoreResult<{ applied: string[]; skipped: string[] }>> {
    try {
      const pool = this.requirePool();
      await pool.query(`create table if not exists public.schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now(),
        checksum text not null
      )`);

      if (!existsSync(this.migrationsDir)) {
        return err('unavailable', `Migrations directory not found at ${this.migrationsDir}.`);
      }
      const files = readdirSync(this.migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      const applied: string[] = [];
      const skipped: string[] = [];
      for (const file of files) {
        const sql = readFileSync(resolve(this.migrationsDir, file), 'utf8');
        const id = file.replace(/\.sql$/, '');
        const checksum = createHash('sha256').update(sql).digest('hex').slice(0, 16);
        const existing = await pool.query('select checksum from public.schema_migrations where id = $1', [id]);
        if (existing.rowCount && existing.rowCount > 0) {
          const recorded = String(existing.rows[0]?.checksum);
          if (recorded !== checksum) {
            return err(
              'conflict',
              `Migration "${id}" has already been applied with a different checksum (${recorded} vs ${checksum}). Applied migrations must never be edited — add a new one.`,
            );
          }
          skipped.push(id);
          continue;
        }
        const client = await pool.connect();
        try {
          await client.query('begin');
          await client.query(sql);
          await client.query('insert into public.schema_migrations (id, checksum) values ($1, $2)', [id, checksum]);
          await client.query('commit');
          applied.push(id);
        } catch (error) {
          await client.query('rollback');
          throw error instanceof Error ? new Error(`Migration "${id}" failed: ${error.message}`) : error;
        } finally {
          client.release();
        }
      }
      return ok({ applied, skipped });
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  /* ------------------------------- identity ------------------------------ */

  async createUser(input: { id: ID; email: string; displayName: string; passwordHash: string | null; authProvider: UserRecord['authProvider'] }): Promise<StoreResult<UserRecord>> {
    try {
      const pool = this.requirePool();
      const result = await pool.query(
        `insert into public.profiles (id, email, display_name, auth_provider, password_hash)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do nothing
         returning *`,
        [input.id, input.email.toLowerCase(), input.displayName, input.authProvider, input.passwordHash],
      );
      if (!result.rowCount) {
        const existing = await this.findUserByEmail(input.email);
        if (existing.ok && existing.value) return err('duplicate', 'An account with that email already exists.');
        return err('duplicate', 'That account already exists.');
      }
      return ok(asUser(result.rows[0] as Row));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('duplicate key') || message.includes('profiles_email_key')) {
        return err('duplicate', 'An account with that email already exists.');
      }
      return err('internal', message);
    }
  }

  async findUserById(id: ID): Promise<StoreResult<UserRecord | null>> {
    try {
      const result = await this.requirePool().query('select * from public.profiles where id = $1', [id]);
      return ok(result.rowCount ? asUser(result.rows[0] as Row) : null);
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  async findUserByEmail(email: string): Promise<StoreResult<UserRecord | null>> {
    try {
      const result = await this.requirePool().query('select * from public.profiles where email = $1', [email.toLowerCase()]);
      return ok(result.rowCount ? asUser(result.rows[0] as Row) : null);
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  async touchUser(id: ID): Promise<StoreResult<void>> {
    try {
      await this.requirePool().query('update public.profiles set last_seen_at = now() where id = $1', [id]);
      return ok(undefined);
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  async updateUserPassword(id: ID, passwordHash: string): Promise<StoreResult<void>> {
    try {
      const result = await this.requirePool().query('update public.profiles set password_hash = $2 where id = $1', [id, passwordHash]);
      if (!result.rowCount) return err('not_found', `No account "${id}" to update.`);
      return ok(undefined);
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  /* -------------------------------- sessions ------------------------------ */

  async createSession(input: { id: ID; userId: ID; expiresAt: string; userAgent?: string | null }): Promise<StoreResult<SessionRecord>> {
    try {
      const result = await this.requirePool().query(
        `insert into public.sessions (id, user_id, expires_at, user_agent) values ($1, $2, $3, $4) returning *`,
        [input.id, input.userId, input.expiresAt, input.userAgent ?? null],
      );
      const row = result.rows[0] as Row;
      return ok({
        id: str(row.id),
        userId: str(row.user_id),
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at),
        expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : str(row.expires_at),
        userAgent: (row.user_agent as string | null) ?? null,
      });
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  async findSession(id: ID): Promise<StoreResult<SessionRecord | null>> {
    try {
      const result = await this.requirePool().query('select * from public.sessions where id = $1', [id]);
      if (!result.rowCount) return ok(null);
      const row = result.rows[0] as Row;
      return ok({
        id: str(row.id),
        userId: str(row.user_id),
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at),
        expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : str(row.expires_at),
        userAgent: (row.user_agent as string | null) ?? null,
      });
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  async deleteSession(id: ID): Promise<StoreResult<void>> {
    try {
      await this.requirePool().query('delete from public.sessions where id = $1', [id]);
      return ok(undefined);
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  async deleteSessionsForUser(userId: ID): Promise<StoreResult<number>> {
    try {
      const result = await this.requirePool().query('delete from public.sessions where user_id = $1', [userId]);
      return ok(result.rowCount ?? 0);
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  /* --------------------------------- saves -------------------------------- */

  async listGames(userId: ID): Promise<StoreResult<SaveMetadata[]>> {
    try {
      const result = await this.requirePool().query(
        `select game_id, user_id, name, status, schema_version, version, day, turn, level, title, net_worth,
                empire_score, world_seed, difficulty, location_id, incarcerated, ending_kind, created_at, updated_at
         from public.games where user_id = $1 order by updated_at desc`,
        [userId],
      );
      return ok(result.rows.map((row) => asMetadata(row as Row)));
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  async loadGame(gameId: ID, userId: ID): Promise<StoreResult<SaveRecord>> {
    try {
      const result = await this.requirePool().query(
        'select *, state::text as state_text from public.games where game_id = $1 and user_id = $2',
        [gameId, userId],
      );
      if (!result.rowCount) return err('not_found', `No save "${gameId}" for this account.`);
      const row = result.rows[0] as Row;
      const parsed = deserializeState(str(row.state_text), { expectedHash: str(row.integrity_hash) });
      if (!parsed.ok) return parsed;
      return ok({ ...asMetadata(row), state: parsed.value });
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  async saveGame(record: SaveRecord, expectedVersion: number | null): Promise<StoreResult<SaveRecord>> {
    const pool = this.requirePool();
    const client = await pool.connect();
    try {
      const sealed = serializeState(record.state);
      if (!sealed.ok) return sealed;
      const meta = extractMetadata(record.state);

      await client.query('begin');
      // Lock the row for the duration of the compare-and-set so two concurrent
      // writers serialize instead of racing.
      const existing = await client.query('select version from public.games where game_id = $1 and user_id = $2 for update', [
        meta.gameId,
        meta.userId,
      ]);

      if (!existing.rowCount) {
        if (expectedVersion !== null && expectedVersion !== 0) {
          await client.query('rollback');
          return err('conflict', `Save "${meta.gameId}" does not exist, but the write expected version ${expectedVersion}.`);
        }
        await client.query(
          `insert into public.games (game_id, user_id, name, status, schema_version, version, day, turn, level, title,
             net_worth, empire_score, world_seed, difficulty, location_id, incarcerated, ending_kind, state, integrity_hash,
             size_bytes, created_at, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21,now())`,
          [
            meta.gameId, meta.userId, meta.name, meta.status, CURRENT_SCHEMA_VERSION, meta.version, meta.day, meta.turn,
            meta.level, meta.title, meta.netWorth, meta.empireScore, meta.worldSeed, meta.difficulty, meta.locationId,
            meta.incarcerated, meta.endingKind, sealed.value.json, sealed.value.integrityHash, sealed.value.sizeBytes,
            record.createdAt || new Date().toISOString(),
          ],
        );
      } else {
        const currentVersion = num(existing.rows[0]?.version);
        if (expectedVersion !== null && expectedVersion !== currentVersion) {
          await client.query('rollback');
          return err(
            'conflict',
            `Save "${meta.gameId}" is at version ${currentVersion} but this write expected ${expectedVersion}. Another session saved first; reload before continuing.`,
          );
        }
        const updated = await client.query(
          `update public.games set name = $3, status = $4, schema_version = $5, version = $6, day = $7, turn = $8,
             level = $9, title = $10, net_worth = $11, empire_score = $12, world_seed = $13, difficulty = $14,
             location_id = $15, incarcerated = $16, ending_kind = $17, state = $18::jsonb, integrity_hash = $19,
             size_bytes = $20, updated_at = now()
           where game_id = $1 and user_id = $2 and version = $21`,
          [
            meta.gameId, meta.userId, meta.name, meta.status, CURRENT_SCHEMA_VERSION, meta.version, meta.day, meta.turn,
            meta.level, meta.title, meta.netWorth, meta.empireScore, meta.worldSeed, meta.difficulty, meta.locationId,
            meta.incarcerated, meta.endingKind, sealed.value.json, sealed.value.integrityHash, sealed.value.sizeBytes,
            currentVersion,
          ],
        );
        if (!updated.rowCount) {
          await client.query('rollback');
          return err('conflict', `Save "${meta.gameId}" changed while this write was in flight. Reload and retry.`);
        }
      }

      await client.query(
        `insert into public.game_versions (game_id, version, day, net_worth, empire_score, state, integrity_hash, size_bytes, reason, saved_at)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,now())
         on conflict (game_id, version) do update set state = excluded.state, integrity_hash = excluded.integrity_hash,
           size_bytes = excluded.size_bytes, reason = excluded.reason, saved_at = now()`,
        [
          meta.gameId, meta.version, meta.day, meta.netWorth, meta.empireScore, sealed.value.json,
          sealed.value.integrityHash, sealed.value.sizeBytes, record.reason ?? null,
        ],
      );
      await client.query(
        `delete from public.game_versions where game_id = $1 and version not in (
           select version from public.game_versions where game_id = $1 order by version desc limit $2
         )`,
        [meta.gameId, MAX_SAVE_VERSIONS],
      );

      await client.query('commit');
      return ok({ ...meta, state: record.state });
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      return err('internal', error instanceof Error ? error.message : String(error));
    } finally {
      client.release();
    }
  }

  async deleteGame(gameId: ID, userId: ID): Promise<StoreResult<void>> {
    try {
      const result = await this.requirePool().query('delete from public.games where game_id = $1 and user_id = $2', [gameId, userId]);
      if (!result.rowCount) return err('not_found', `No save "${gameId}" for this account.`);
      // Only reached once ownership has been proven, so this cannot be used to clear
      // another player's receipts.
      await this.requirePool().query('delete from public.intent_receipts where game_id = $1 and user_id = $2', [gameId, userId]);
      return ok(undefined);
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  async listVersions(gameId: ID, userId: ID, limit = MAX_SAVE_VERSIONS): Promise<StoreResult<SaveVersionRow[]>> {
    try {
      const result = await this.requirePool().query(
        `select v.game_id, v.version, v.day, v.net_worth, v.saved_at, v.size_bytes, v.reason
         from public.game_versions v join public.games g on g.game_id = v.game_id
         where v.game_id = $1 and g.user_id = $2
         order by v.version desc limit $3`,
        [gameId, userId, limit],
      );
      return ok(
        result.rows.map((row: Row) => ({
          gameId: str(row.game_id),
          version: num(row.version),
          day: num(row.day),
          netWorth: num(row.net_worth),
          savedAt: row.saved_at instanceof Date ? row.saved_at.toISOString() : str(row.saved_at),
          sizeBytes: num(row.size_bytes),
          reason: (row.reason as string | null) ?? null,
        })),
      );
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  async restoreVersion(gameId: ID, userId: ID, version: number): Promise<StoreResult<SaveRecord>> {
    try {
      const pool = this.requirePool();
      const owned = await pool.query('select version from public.games where game_id = $1 and user_id = $2', [gameId, userId]);
      if (!owned.rowCount) return err('not_found', `No save "${gameId}" for this account.`);
      const row = await pool.query('select state::text as state_text, integrity_hash from public.game_versions where game_id = $1 and version = $2', [
        gameId,
        version,
      ]);
      if (!row.rowCount) return err('not_found', `Version ${version} of "${gameId}" is not in history.`);
      const parsed = deserializeState(str((row.rows[0] as Row).state_text), { expectedHash: str((row.rows[0] as Row).integrity_hash) });
      if (!parsed.ok) return parsed;
      // Restoring writes forward: the restored state takes a new version number so
      // history is never rewritten and the compare-and-set still holds.
      const restored = { ...parsed.value, version: num(owned.rows[0]?.version) + 1, updatedAt: new Date().toISOString() };
      return this.saveGame({ ...extractMetadata(restored), state: restored, reason: `restored version ${version}` }, num(owned.rows[0]?.version));
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  /* ------------------------------ leaderboard ----------------------------- */

  async leaderboard(limit = 25): Promise<StoreResult<LeaderboardRow[]>> {
    try {
      const result = await this.requirePool().query(
        `select g.user_id, p.display_name, g.title, g.level, g.net_worth, g.empire_score, g.day, g.status, g.game_id
         from public.games g join public.profiles p on p.id = g.user_id
         order by g.empire_score desc, g.net_worth desc limit $1`,
        [limit],
      );
      return ok(
        result.rows.map((row: Row) => ({
          userId: str(row.user_id),
          displayName: str(row.display_name),
          title: str(row.title),
          level: num(row.level, 1),
          netWorth: num(row.net_worth),
          empireScore: num(row.empire_score),
          day: num(row.day),
          status: str(row.status, 'active') as LeaderboardRow['status'],
          gameId: str(row.game_id),
        })),
      );
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  /* ------------------------------ idempotency ----------------------------- */

  async findIntentReceipt(gameId: ID, requestId: string): Promise<StoreResult<IntentReceiptRecord | null>> {
    try {
      const result = await this.requirePool().query(
        'select * from public.intent_receipts where game_id = $1 and request_id = $2',
        [gameId, requestId],
      );
      const row = result.rows[0] as Row | undefined;
      if (!row) return ok(null);
      return ok({
        gameId: str(row.game_id),
        userId: str(row.user_id),
        requestId: str(row.request_id),
        intentType: str(row.intent_type),
        intentHash: str(row.intent_hash),
        stateVersion: row.state_version === null || row.state_version === undefined ? null : num(row.state_version),
        day: num(row.day),
        turn: num(row.turn),
        response: str(row.response),
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at),
      });
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  async recordIntentReceipt(record: Omit<IntentReceiptRecord, 'createdAt'> & { createdAt?: string }): Promise<StoreResult<IntentReceiptRecord>> {
    try {
      // `on conflict do nothing`: the first receipt wins, so a retry can never
      // rewrite the outcome of the command it is replaying.
      await this.requirePool().query(
        `insert into public.intent_receipts (game_id, user_id, request_id, intent_type, intent_hash, state_version, day, turn, response, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10, now()))
         on conflict (game_id, request_id) do nothing`,
        [
          record.gameId, record.userId, record.requestId, record.intentType, record.intentHash,
          record.stateVersion, record.day, record.turn, record.response, record.createdAt ?? null,
        ],
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
    try {
      const result = await this.requirePool().query(
        `delete from public.intent_receipts
          where game_id = $1
            and request_id not in (
              select request_id from public.intent_receipts where game_id = $1 order by created_at desc limit $2
            )`,
        [gameId, Math.max(1, Math.floor(keep))],
      );
      return ok(result.rowCount ?? 0);
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  /* --------------------------------- audit -------------------------------- */

  async appendAudit(entry: Omit<AuditRecord, 'id' | 'createdAt'> & { id?: ID; createdAt?: string }): Promise<StoreResult<AuditRecord>> {
    try {
      const result = await this.requirePool().query(
        `insert into public.action_audit (user_id, game_id, action, ok, code, day, turn, detail)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [entry.userId, entry.gameId, entry.action, entry.ok, entry.code, entry.day, entry.turn, entry.detail],
      );
      const row = (result.rows[0] ?? {}) as Row;
      return ok({
        id: str(row.id, entry.id ?? ''),
        userId: str(row.user_id, entry.userId),
        gameId: (row.game_id as string | null) ?? entry.gameId,
        action: str(row.action, entry.action),
        ok: bool(row.ok ?? entry.ok),
        code: (row.code as string | null) ?? entry.code,
        day: num(row.day, entry.day),
        turn: num(row.turn, entry.turn),
        detail: (row.detail as string | null) ?? entry.detail,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date().toISOString(),
      });
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }

  async recentAudit(userId: ID, limit = 50): Promise<StoreResult<AuditRecord[]>> {
    try {
      const result = await this.requirePool().query(
        'select * from public.action_audit where user_id = $1 order by id desc limit $2',
        [userId, limit],
      );
      return ok(
        result.rows.map((row: Row) => ({
          id: str(row.id),
          userId: str(row.user_id),
          gameId: (row.game_id as string | null) ?? null,
          action: str(row.action),
          ok: bool(row.ok),
          code: (row.code as string | null) ?? null,
          day: num(row.day),
          turn: num(row.turn),
          detail: (row.detail as string | null) ?? null,
          createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : str(row.created_at),
        })),
      );
    } catch (error) {
      return err('internal', error instanceof Error ? error.message : String(error));
    }
  }
}
