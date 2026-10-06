/**
 * DTO layer — the public shape of the game.
 *
 * This module exists because of one hard rule from the API contract:
 *
 *   **The client never receives authoritative simulation state.**
 *
 * `GameState` is a 25-system simulation document. It contains a deterministic RNG
 * state (which would let a client predict every future roll), diagnostics, the
 * transaction-integrity chain, unpublished event scheduling, competitor and
 * government internals, and the service's own bookkeeping. `dispatch()` hands all of
 * that back inside `ActionResult.state`. Returning it verbatim would be a serious
 * leak, so every response is built here instead:
 *
 *   • `gameStateDto`  → a curated player-facing projection of the save
 *   • `actionResultDto` → the action envelope with `state` removed and `data`
 *     converted (day reports lose `elapsedMs`, anything huge is capped)
 *   • `sanitiseForClient` → a final defensive pass applied by the HTTP layer to
 *     *every* success body, which strips a fixed list of internal key names
 *     wherever they appear and caps payload size
 *
 * The last one is deliberately belt-and-braces: a future view function that
 * accidentally embeds `rng` or a `prevHash` in its output still cannot reach a
 * browser. Tests assert that no response body contains a forbidden key.
 */
import { computeNetWorth, type NetWorthBreakdown } from '../sim/state';
import type { DayReport, MultiDayReport } from '../sim/tick';
import type {
  ActiveEvent,
  ActionResult,
  ActiveShock,
  EconomicIndicators,
  GameEnding,
  GameState,
  GameStatus,
  NewsItem,
  OnChainEntry,
  PlayerNotification,
  PlayerState,
  TransactionRecord,
  UndergroundState,
} from '../sim/types';

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

/**
 * Ceilings on array payloads. A save legitimately accumulates thousands of
 * notifications and transactions over a long game; the client only ever renders the
 * recent tail, so shipping the whole history would waste bandwidth on every request.
 *
 * These are presentation limits, not data loss: the authoritative arrays stay
 * untouched on the server, and anything dropped here is still available through the
 * audit trail and the storable version history.
 */
export const DTO_LIMITS = {
  notifications: 60,
  transactions: 80,
  newsItems: 40,
  historyPoints: 180,
  xpTrail: 40,
  onChainEntries: 40,
  reportNews: 40,
  /** Largest JSON payload a success response may carry, in bytes. */
  responseBytes: 1_500_000,
  /** Largest sanitised action result stored as an idempotency receipt. */
  receiptBytes: 256 * 1024,
} as const;

/* ------------------------------------------------------------------ */
/* Public projections                                                  */
/* ------------------------------------------------------------------ */

/** The bank ledger without its integrity-chain internals (`seq`, `prevHash`, digest). */
export type PublicTransactionRecord = Omit<TransactionRecord, 'seq' | 'prevHash' | 'integrityHash'>;

/** The on-chain ledger without the hash chain used for tamper detection. */
export type PublicOnChainEntry = Omit<OnChainEntry, 'prevHash'>;

export type PublicUndergroundState = Omit<UndergroundState, 'onChain'> & {
  onChain: PublicOnChainEntry[];
};

/**
 * The player's own state, with two substitutions:
 *  - the transaction ledger drops chain internals,
 *  - the on-chain ledger is capped and drops its back-hash.
 *
 * Everything else is player-owned information the UI legitimately renders.
 */
export type PublicPlayerState = Omit<PlayerState, 'recentTransactions' | 'transactionChain' | 'underground'> & {
  recentTransactions: PublicTransactionRecord[];
  underground: PublicUndergroundState;
};

export interface PublicActiveEvent {
  id: string;
  defId: string;
  name: string;
  description: string;
  scope: ActiveEvent['scope'];
  severity: ActiveEvent['severity'];
  startedDay: number;
  expiresDay: number | null;
  locationIds: string[];
  regionIds: string[];
  /** Why the event changed something — kept for the UI's explanation trail. */
  appliedEffects: string[];
}

export interface WorldDto {
  day: number;
  inflationIndex: number;
  inflationRate: number;
  interestRate: number;
  cyclePhase: number;
  cycleFactor: number;
  globalSentiment: number;
  stockIndex: number;
  cryptoIndex: number;
  unemployment: number;
  consumerConfidence: number;
  gdpIndex: number;
  indicators: EconomicIndicators;
  shocks: ActiveShock[];
  activeEvents: PublicActiveEvent[];
  /** Recent headlines only; the rest stay server-side. */
  news: NewsItem[];
  stockIndexHistory: number[];
  cryptoIndexHistory: number[];
}

export interface GameConfigDto {
  mode: GameState['config']['mode'];
  difficulty: GameState['config']['difficulty'];
  permadeath: boolean;
  endless: boolean;
  startLocationId: string;
  startDateLabel: string;
  worldSeed: string;
  victoryConditions: GameState['config']['victoryConditions'];
  lossConditions: GameState['config']['lossConditions'];
  difficultyModifiers: GameState['config']['difficultyModifiers'];
}

export interface GameStateDto {
  meta: {
    gameId: string;
    name: string;
    status: GameStatus;
    /** Monotonic save version. The client echoes this back as `expectedVersion`. */
    version: number;
    turn: number;
    day: number;
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
    lastTickDay: number;
    config: GameConfigDto;
  };
  world: WorldDto;
  player: PublicPlayerState;
  netWorth: NetWorthBreakdown;
  ending: GameEnding | null;
  /** Notifications are also inside `player`; repeated here for the action debrief UI. */
  notifications: PlayerNotification[];
}

/**
 * A day report as the client sees it. `elapsedMs` is dropped: it is the server's own
 * wall-clock cost for the tick, which is operations information rather than game state.
 */
export type DayReportDto = Omit<DayReport, 'elapsedMs'>;

export interface MultiDayReportDto extends Omit<MultiDayReport, 'elapsedMs' | 'reports'> {
  reports: DayReportDto[];
}

export interface ActionResultDto {
  ok: boolean;
  error?: ActionResult['error'];
  message?: string;
  warnings: ActionResult['warnings'];
  explanations?: ActionResult['explanations'];
  notifications: PlayerNotification[];
  /** Action payload: quotes, plans, day reports — converted, bounded, never raw state. */
  data?: unknown;
  day: number;
  turn: number;
  auditId?: string;
  /** True when the payload exceeded the DTO budget and was reduced. */
  dataTruncated?: boolean;
}

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

function tail<T>(items: readonly T[], limit: number): T[] {
  return items.length <= limit ? [...items] : items.slice(items.length - limit);
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * `seq`, `prevHash` and `integrityHash` are chain internals: they prove the ledger has
 * not been edited server-side, which is nobody's business but the server's.
 */
export function publicTransaction(record: TransactionRecord): PublicTransactionRecord {
  const { seq: _seq, prevHash: _prevHash, integrityHash: _integrityHash, ...rest } = record;
  return rest;
}

export function publicOnChainEntry(entry: OnChainEntry): PublicOnChainEntry {
  const { prevHash: _prevHash, ...rest } = entry;
  return rest;
}

export function publicUnderground(state: UndergroundState): PublicUndergroundState {
  return {
    ...state,
    onChain: tail(state.onChain, DTO_LIMITS.onChainEntries).map(publicOnChainEntry),
  };
}

export function publicPlayer(state: PlayerState): PublicPlayerState {
  // `transactionChain` is integrity bookkeeping for the server's own verification; it is
  // deliberately destructured away rather than spread through.
  const { transactionChain: _transactionChain, ...player } = state;
  return {
    ...player,
    recentTransactions: tail(state.recentTransactions, DTO_LIMITS.transactions).map(publicTransaction),
    underground: publicUnderground(state.underground),
    notifications: tail(state.notifications, DTO_LIMITS.notifications),
    netWorthHistory: tail(state.netWorthHistory, DTO_LIMITS.historyPoints),
    progression: {
      ...state.progression,
      recentXp: tail(state.progression.recentXp, DTO_LIMITS.xpTrail),
    },
    reputation: {
      ...state.reputation,
      recentChanges: tail(state.reputation.recentChanges, DTO_LIMITS.xpTrail),
    },
  };
}

export function publicEvent(event: ActiveEvent): PublicActiveEvent {
  // `payload` carries the effect parameters the engine applies. It can reveal
  // unpublished event mechanics, so it stays server-side.
  const { payload: _payload, ...rest } = event;
  return { ...rest, appliedEffects: [...rest.appliedEffects] };
}

export function worldDto(state: GameState): WorldDto {
  const world = state.world;
  return {
    day: world.day,
    inflationIndex: finite(world.inflationIndex, 1),
    inflationRate: finite(world.inflationRate),
    interestRate: finite(world.interestRate),
    cyclePhase: finite(world.cyclePhase),
    cycleFactor: finite(world.cycleFactor, 1),
    globalSentiment: finite(world.globalSentiment),
    stockIndex: finite(world.stockIndex, 1),
    cryptoIndex: finite(world.cryptoIndex, 1),
    unemployment: finite(world.unemployment),
    consumerConfidence: finite(world.consumerConfidence),
    gdpIndex: finite(world.gdpIndex, 1),
    indicators: world.indicators,
    shocks: world.shocks,
    activeEvents: world.activeEvents.map(publicEvent),
    news: tail(world.news, DTO_LIMITS.newsItems),
    stockIndexHistory: tail(world.stockIndexHistory, DTO_LIMITS.historyPoints),
    cryptoIndexHistory: tail(world.cryptoIndexHistory, DTO_LIMITS.historyPoints),
  };
}

/**
 * The player-facing save document.
 *
 * Deliberately absent: `rng`/`rngLabel` (predicting future rolls), `diagnostics`
 * (server ops), `transactionChain` (integrity bookkeeping), `markets` (huge, and
 * exposed per-location through the market view), and the world's `competitors`,
 * `governments`, `eventCooldowns` and `scheduledEvents` (hidden NPC and event
 * scheduling information).
 */
export function gameStateDto(state: GameState): GameStateDto {
  return {
    meta: {
      gameId: state.gameId,
      name: state.name,
      status: state.status,
      version: state.version,
      turn: state.turn,
      day: state.world.day,
      schemaVersion: state.schemaVersion,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      lastTickDay: state.lastTickDay,
      config: {
        mode: state.config.mode,
        difficulty: state.config.difficulty,
        permadeath: state.config.permadeath,
        endless: state.config.endless,
        startLocationId: state.config.startLocationId,
        startDateLabel: state.config.startDateLabel,
        worldSeed: state.config.worldSeed,
        victoryConditions: state.config.victoryConditions,
        lossConditions: state.config.lossConditions,
        difficultyModifiers: state.config.difficultyModifiers,
      },
    },
    world: worldDto(state),
    player: publicPlayer(state.player),
    netWorth: computeNetWorth(state),
    ending: state.ending,
    notifications: tail(state.player.notifications, DTO_LIMITS.notifications),
  };
}

/**
 * Strip the ops-only timing fields from a day report.
 *
 * The report is a deep structure with event results inside it, and those carry the
 * event's own effect `payload` — internal mechanics the player is not meant to read off
 * a screen. Rather than hand-projecting half a dozen nested tick results (and missing
 * one whenever a system gains a field), the report goes through the same key
 * redaction the HTTP layer applies to everything, here at the point the boundary is
 * defined. The safety net then has nothing left to catch.
 */
export function dayReportDto(report: DayReport): DayReportDto {
  const { elapsedMs: _elapsedMs, ...rest } = report;
  const cleaned = stripInternalKeys({ ...rest, news: tail(rest.news, DTO_LIMITS.reportNews) });
  return cleaned.value;
}

export function multiDayReportDto(report: MultiDayReport): MultiDayReportDto {
  const { elapsedMs: _elapsedMs, reports, ...rest } = report;
  const cleaned = stripInternalKeys({ ...rest, reports: reports.map(dayReportDto) });
  return cleaned.value;
}

/** Does this look like a day report produced by a time-advance intent? */
function isDayReport(value: unknown): value is DayReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as DayReport).day === 'number' &&
    Array.isArray((value as DayReport).phases) &&
    typeof (value as DayReport).netWorthChange === 'number'
  );
}

function isMultiDayReport(value: unknown): value is MultiDayReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as MultiDayReport).days === 'number' &&
    Array.isArray((value as MultiDayReport).reports) &&
    typeof (value as MultiDayReport).netWorthEnd === 'number'
  );
}

/** JSON size in bytes, without holding a second copy of a huge string for long. */
function jsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Convert an action's `data` payload for transport.
 *
 * Day reports (single and multi) are converted; anything else is passed through
 * unchanged but size-checked, because a handler is free to return a view object and
 * silently reshaping it would break the contract. Oversized payloads are replaced by
 * a marker so the client is told the truth rather than receiving a truncated object
 * it might misread as complete.
 */
export function actionDataDto(data: unknown): { data: unknown; truncated: boolean } {
  if (isMultiDayReport(data)) {
    const converted = multiDayReportDto(data);
    return jsonBytes(converted) > DTO_LIMITS.responseBytes
      ? { data: { days: data.days, netWorthChange: data.netWorthChange, truncated: true }, truncated: true }
      : { data: converted, truncated: false };
  }
  if (isDayReport(data)) {
    const converted = dayReportDto(data);
    return jsonBytes(converted) > DTO_LIMITS.responseBytes ? { data: { day: data.day, truncated: true }, truncated: true } : { data: converted, truncated: false };
  }
  if (data === undefined) return { data: undefined, truncated: false };
  return jsonBytes(data) > DTO_LIMITS.responseBytes ? { data: { truncated: true }, truncated: true } : { data, truncated: false };
}

/**
 * The action envelope as the client sees it: no `state`, converted `data`, bounded
 * notification list. `state` is replaced by the caller with a fresh
 * `gameStateDto`, so the client always reconciles against a project it is allowed
 * to see.
 */
export function actionResultDto(result: ActionResult<unknown>): ActionResultDto {
  const { state: _state, data, notifications, ...rest } = result;
  const converted = actionDataDto(data);
  return {
    ...rest,
    notifications: tail(notifications, DTO_LIMITS.notifications),
    ...(converted.data === undefined ? {} : { data: converted.data }),
    ...(converted.truncated ? { dataTruncated: true } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Final safety net                                                    */
/* ------------------------------------------------------------------ */

/**
 * Key names that must never appear in a response body, whatever the payload was.
 *
 * This is a deny-list applied by `sanitiseForClient` to every success response, so a
 * single mistake in a view builder cannot leak internals. It is intentionally
 * conservative: dropping an unexpectedly named field is a cosmetic bug, leaking the
 * RNG state or a credential is not.
 */
export const FORBIDDEN_CLIENT_KEYS: readonly string[] = [
  'rng',
  'rngState',
  'rngLabel',
  'diagnostics',
  'transactionChain',
  'prevHash',
  'seq',
  'integrityHash',
  'passwordHash',
  'password',
  'serviceRoleKey',
  'service_role_key',
  'databaseUrl',
  'connectionString',
  'appSecret',
  'apiKey',
  'payload',
  'competitors',
  'governments',
  'eventCooldowns',
  'scheduledEvents',
  'sqlitePath',
  'accessToken',
  'refreshToken',
];

const FORBIDDEN = new Set(FORBIDDEN_CLIENT_KEYS);

export interface SanitisedResponse<T> {
  value: T;
  /** Key names that were removed, for the incident log and for tests. */
  removed: string[];
  truncated: boolean;
}

/**
 * Deep-copy `input`, dropping forbidden keys and capping the total JSON size.
 *
 * Arrays are capped by the byte budget: once the running serialised estimate passes
 * the ceiling, the remaining tail is replaced and `truncated` is reported.
 */
export function sanitiseForClient<T>(input: T, maxBytes: number = DTO_LIMITS.responseBytes): SanitisedResponse<T | { truncated: true }> {
  const removed = new Set<string>();

  // Estimate first: most responses are small and are returned untouched in shape.
  const estimate = jsonBytes(input);
  if (estimate !== Number.POSITIVE_INFINITY && estimate <= maxBytes) {
    const cleaned = clean(input, removed, 0);
    if (removed.size === 0) return { value: cleaned as T, removed: [], truncated: false };
    return { value: cleaned as T, removed: [...removed], truncated: false };
  }

  const cleaned = clean(input, removed, 0);
  if (jsonBytes(cleaned) <= maxBytes) return { value: cleaned as T, removed: [...removed], truncated: true };

  // Past the ceiling even after redaction: keep the shape but drop the bulkiest
  // arrays, which are always the history lists, until it fits.
  const slimmed = slimPayload(cleaned, maxBytes);
  return { value: slimmed as T | { truncated: true }, removed: [...removed], truncated: true };
}

/**
 * Deep-copy `input`, dropping keys that must never reach a client.
 *
 * Exported because the DTO builders use it to strip internals they do not explicitly
 * project — a day report's nested event payloads, for example — so that redaction is a
 * deliberate part of the boundary rather than something the HTTP safety net has to
 * clean up afterwards.
 */
export function stripInternalKeys<T>(input: T): { value: T; removed: string[] } {
  const removed = new Set<string>();
  const value = clean(input, removed, 0) as T;
  return { value, removed: [...removed] };
}

function clean(value: unknown, removed: Set<string>, depth: number): unknown {
  if (depth > 24 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => clean(entry, removed, depth + 1));
  // Date and Buffer-ish objects serialise themselves; leave them alone.
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN.has(key)) {
      removed.add(key);
      continue;
    }
    out[key] = clean(entry, removed, depth + 1);
  }
  return out;
}

const ARRAY_BUDGETS = ['reports', 'news', 'notifications', 'recentTransactions', 'netWorthHistory', 'stockIndexHistory', 'cryptoIndexHistory', 'onChain'];

function slimPayload(value: unknown, maxBytes: number, depth = 0): unknown {
  if (depth > 24 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    let arr = value;
    let size = jsonBytes(arr);
    while (arr.length > 1 && size > maxBytes) {
      arr = arr.slice(Math.ceil(arr.length / 2));
      size = jsonBytes(arr);
    }
    return arr.map((entry) => slimPayload(entry, maxBytes, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = ARRAY_BUDGETS.includes(key) && Array.isArray(entry) ? slimPayload(entry.slice(-12), maxBytes, depth + 1) : slimPayload(entry, maxBytes, depth + 1);
  }
  return out;
}

/** True when a payload contains a key that must never reach a browser. */
export function findForbiddenKeys(value: unknown, depth = 0): string[] {
  if (depth > 24 || value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((entry) => findForbiddenKeys(entry, depth + 1));
  const found: string[] = [];
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN.has(key)) found.push(key);
    else found.push(...findForbiddenKeys(entry, depth + 1));
  }
  return [...new Set(found)];
}
