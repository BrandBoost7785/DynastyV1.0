/**
 * DTO boundary tests.
 *
 * The API's central promise is that the browser never receives authoritative
 * simulation state — no RNG state it could use to predict rolls, no integrity chain,
 * no diagnostics, no event scheduling, no competitor internals. These tests attack
 * that promise directly, and they attack the final safety net too: a payload with an
 * internal key buried in a nested array must still come out clean.
 */
import { describe, expect, it } from 'vitest';
import {
  DTO_LIMITS,
  SERVER_ONLY_REPORT_FIELDS,
  actionDataDto,
  actionResultDto,
  dayReportDto,
  findForbiddenKeys,
  gameStateDto,
  multiDayReportDto,
  publicOnChainEntry,
  publicPlayer,
  publicTransaction,
  sanitiseForClient,
} from '../src/server/dto';
import type { DayReportDto, MultiDayReportDto } from '../src/server/dto';
import { createNewGame } from '../src/sim/bootstrap';
import { advanceDay, advanceDays, rngForDay } from '../src/sim/tick';
import { creditCash } from '../src/sim/state';
import type { GameState, TransactionRecord } from '../src/sim/types';

function fresh(seed = 'dto-seed', userId = 'dto-user'): GameState {
  return createNewGame({ userId, playerName: 'Boundary', seed }).state;
}

/** Every key that appears anywhere in a value, dotted by path. */
function keyPaths(value: unknown, path = '$', depth = 0): string[] {
  if (depth > 24 || value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((entry, i) => keyPaths(entry, `${path}[${i}]`, depth + 1));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => [`${path}.${key}`, ...keyPaths(entry, `${path}.${key}`, depth + 1)]);
}

/**
 * Compile-time guard: if `elapsedMs` is ever put back into the public type, this
 * resolves to `never` and the assignment below stops compiling — which `npm run
 * verify` runs before the tests.
 */
type PublicDayReportHasNoTiming = 'elapsedMs' extends keyof DayReportDto ? never : true;

describe('state projection', () => {
  it('drops every internal system from the player-facing save', () => {
    const state = fresh();
    creditCash(state, 500, { kind: 'adjustment', description: 'seed', dirty: false });
    advanceDay(state, rngForDay(state, 1));

    const dto = gameStateDto(state);
    const serialised = JSON.stringify(dto);

    for (const key of ['"rng"', 'rngLabel', 'diagnostics', 'transactionChain', '"markets"', 'competitors', 'governments', 'eventCooldowns', 'scheduledEvents', 'prevHash', 'integrityHash', '"seq"']) {
      expect(serialised, `state projection leaked ${key}`).not.toContain(key);
    }
    expect(findForbiddenKeys(dto)).toEqual([]);
  });

  it('keeps the information the UI legitimately needs', () => {
    const state = fresh('dto-keeps');
    const dto = gameStateDto(state);
    expect(dto.meta.gameId).toBe(state.gameId);
    expect(dto.meta.version).toBe(state.version);
    expect(dto.meta.config.difficulty).toBe(state.config.difficulty);
    expect(dto.world.day).toBe(state.world.day);
    expect(dto.player.locationId).toBe(state.player.locationId);
    expect(dto.player.accounts.length).toBe(state.player.accounts.length);
    expect(dto.netWorth.total).toBeGreaterThan(0);
    expect(dto.world.news.length).toBeLessThanOrEqual(DTO_LIMITS.newsItems);
  });

  it('caps the history arrays rather than shipping a decade of notifications', () => {
    const state = fresh('dto-caps');
    for (let i = 0; i < DTO_LIMITS.transactions + 40; i++) {
      creditCash(state, 1, { kind: 'adjustment', description: `tx-${i}`, day: state.world.day });
    }
    for (let i = 0; i < DTO_LIMITS.notifications + 25; i++) {
      state.player.notifications.push({ id: `ntf_${i}`, day: i, kind: 'info', title: `t${i}`, body: 'b', read: false, link: null });
    }
    const dto = publicPlayer(state.player);
    expect(dto.recentTransactions.length).toBeLessThanOrEqual(DTO_LIMITS.transactions);
    expect(dto.notifications.length).toBeLessThanOrEqual(DTO_LIMITS.notifications);
    // The tail is kept, not the head: the newest entries are the ones the UI shows.
    expect(dto.notifications[dto.notifications.length - 1]!.id).toBe(`ntf_${DTO_LIMITS.notifications + 24}`);
    expect(dto.recentTransactions[dto.recentTransactions.length - 1]!.description).toContain('tx-');
  });

  it('strips chain internals from ledger entries', () => {
    const record = {
      id: 'tx_1',
      day: 3,
      turn: 9,
      kind: 'buy' as const,
      amount: 12,
      balanceAfter: 100,
      description: 'Bought 2 crates',
      seq: 41,
      prevHash: 'deadbeef',
      integrityHash: 'cafebabe',
    } as unknown as TransactionRecord;
    const publicRecord = publicTransaction(record);
    expect(publicRecord).not.toHaveProperty('seq');
    expect(publicRecord).not.toHaveProperty('prevHash');
    expect(publicRecord).not.toHaveProperty('integrityHash');
    expect(publicRecord.description).toBe('Bought 2 crates');
  });
});

describe('action envelope', () => {
  it('removes the raw state document from a dispatch result', () => {
    const state = fresh('dto-action');
    const before = state.turn;
    const result = actionResultDto({
      ok: true,
      warnings: [],
      day: state.world.day,
      turn: state.turn + 1,
      notifications: [],
      state,
    });
    expect(result).not.toHaveProperty('state');
    expect(findForbiddenKeys(result)).toEqual([]);
    expect(before).toBe(state.turn);
  });

  it('converts a day report and drops the ops-only timing field', () => {
    const state = fresh('dto-report');
    const report = advanceDay(state, rngForDay(state, 1));
    const dto = dayReportDto(report);
    expect(dto).not.toHaveProperty('elapsedMs');
    expect(dto.day).toBe(report.day);
    expect(dto.netWorth.total).toBe(report.netWorth.total);
    expect(JSON.stringify(dto)).not.toContain('elapsedMs');
  });

  it('strips event effect payloads out of a day report', () => {
    const state = fresh('dto-report-events');
    // Fire days until an event lands in a report, so the assertion is about real output.
    let cleaned: ReturnType<typeof dayReportDto> | null = null;
    for (let day = 0; day < 12 && cleaned === null; day++) {
      const report = advanceDay(state, rngForDay(state, day + 1));
      if (report.events.fired.length > 0) cleaned = dayReportDto(report);
    }
    expect(cleaned).not.toBeNull();
    expect(JSON.stringify(cleaned)).not.toContain('"payload"');
    expect(findForbiddenKeys(cleaned)).toEqual([]);
  });

  it('converts a multi-day report and keeps its per-day reports', () => {
    const state = fresh('dto-multi');
    const report = advanceDays(state, rngForDay(state, 1), 3);
    const dto = multiDayReportDto(report);
    expect(dto.days).toBe(3);
    expect(dto.reports).toHaveLength(3);
    expect(dto).not.toHaveProperty('elapsedMs');
    for (const day of dto.reports) expect(day).not.toHaveProperty('elapsedMs');
  });

  it('recognises reports inside an action payload and converts them', () => {
    const state = fresh('dto-payload');
    const report = advanceDay(state, rngForDay(state, 1));
    const converted = actionDataDto(report);
    expect(converted.truncated).toBe(false);
    expect(converted.data).not.toHaveProperty('elapsedMs');

    const multi = actionDataDto(advanceDays(state, rngForDay(state, 2), 2));
    expect(multi.truncated).toBe(false);
    expect(JSON.stringify(multi.data)).not.toContain('"elapsedMs"');
  });

  it('passes an ordinary payload through untouched', () => {
    const quote = { quote: { commodityId: 'x', effectiveUnitPrice: 12.5 } };
    const converted = actionDataDto(quote);
    expect(converted.data).toEqual(quote);
    expect(converted.truncated).toBe(false);
  });

  it('replaces an oversized payload with an explicit truncation marker', () => {
    const huge = { rows: Array.from({ length: 20_000 }, (_, i) => ({ i, blob: 'x'.repeat(200) })) };
    const converted = actionDataDto(huge);
    expect(converted.truncated).toBe(true);
    expect(converted.data).toEqual({ truncated: true });
  });
});

describe('day report server-only fields', () => {
  it('declares the omission in one place instead of dropping the field silently', () => {
    expect(SERVER_ONLY_REPORT_FIELDS).toEqual(['elapsedMs']);
    // Type-level half of the rule: the public report type cannot carry the field.
    const guard: PublicDayReportHasNoTiming = true;
    expect(guard).toBe(true);
  });

  it('keeps the engine report intact — the timing field is server-only, not truncated', () => {
    const state = fresh('dto-elapsed-domain');
    const single = advanceDay(state, rngForDay(state, 1));
    const multi = advanceDays(state, rngForDay(state, 2), 3);

    // The authoritative report still measures the tick: nothing is lost, and the
    // server keeps the operations number it logs into diagnostics.
    expect(Number.isFinite(single.elapsedMs)).toBe(true);
    expect(single.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(single.elapsedMs)).toBe(true);
    expect(Number.isFinite(multi.elapsedMs)).toBe(true);
    expect(multi.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('drops exactly the declared field from a public report and nothing else', () => {
    const state = fresh('dto-elapsed-exactly');
    const report = advanceDay(state, rngForDay(state, 1));
    const dto = dayReportDto(report);

    const declared: readonly string[] = SERVER_ONLY_REPORT_FIELDS;
    const expected = Object.keys(report)
      .filter((key) => !declared.includes(key))
      .sort();
    // Nothing but the declaration is missing: absence of elapsedMs is a decision about
    // the contract, not a truncated day report.
    expect(Object.keys(dto).sort()).toEqual(expected);
    expect(expected).toContain('phases');
    expect(expected).toContain('netWorth');
    expect(expected.length).toBe(Object.keys(report).length - declared.length);
  });

  it('never carries a timing field into a transport payload, single or multi day', () => {
    const state = fresh('dto-elapsed-transport');
    const single = actionDataDto(advanceDay(state, rngForDay(state, 1)));
    expect(single.truncated).toBe(false);
    expect(keyPaths(single.data).filter((path) => /elapsed|millis|duration|\.ms$/.test(path))).toEqual([]);

    const multi = actionDataDto(advanceDays(state, rngForDay(state, 2), 3));
    expect(multi.truncated).toBe(false);
    expect(keyPaths(multi.data).filter((path) => /elapsed|millis|duration|\.ms$/.test(path))).toEqual([]);
    // The per-day reports inside the batch are projected the same way.
    const reports = (multi.data as MultiDayReportDto).reports;
    expect(reports.length).toBeGreaterThan(0);
    for (const day of reports) expect(day).not.toHaveProperty('elapsedMs');
  });

  it('returns a complete, untruncated report for a realistic 30-day advance', () => {
    const state = fresh('dto-elapsed-thirty');
    const converted = actionDataDto(advanceDays(state, rngForDay(state, 3), 30));
    expect(converted.truncated).toBe(false);

    const dto = converted.data as MultiDayReportDto;
    // The report is whole — which is what proves the missing timing field is omitted by
    // contract rather than trimmed by a size limit.
    expect(dto.days).toBe(dto.reports.length);
    expect(dto.days).toBeGreaterThan(0);
    expect(JSON.stringify(dto)).not.toContain('"elapsedMs"');
    for (const day of dto.reports) {
      expect(day.phases.length).toBeGreaterThan(0);
      expect(Number.isFinite(day.netWorth.total)).toBe(true);
    }
  });
});

describe('final safety net', () => {
  it('removes forbidden keys wherever they appear', () => {
    const payload = {
      safe: 1,
      nested: { rng: { seed: 42 }, list: [{ prevHash: 'abc', keep: true }] },
      diagnostics: ['hidden'],
      deeper: { ok: { transactionChain: { seq: 9 } } },
    };
    const result = sanitiseForClient(payload);
    expect(result.removed.sort()).toEqual(['diagnostics', 'prevHash', 'rng', 'transactionChain']);
    expect(JSON.stringify(result.value)).not.toContain('prevHash');
    expect((result.value as { nested: { list: { keep: boolean }[] } }).nested.list[0]!.keep).toBe(true);
  });

  it('reports nothing to remove when a payload is already clean', () => {
    const result = sanitiseForClient({ a: 1, b: [{ c: 'd' }] });
    expect(result.removed).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('caps a payload that is over budget and says so', () => {
    const payload = { rows: Array.from({ length: 40_000 }, (_, i) => ({ i, text: 'y'.repeat(120) })) };
    const result = sanitiseForClient(payload, 200_000);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result.value), 'utf8')).toBeLessThanOrEqual(400_000);
  });

  it('detects a forbidden key at any depth', () => {
    expect(findForbiddenKeys({ a: { b: [{ c: { rng: 1 } }] } })).toEqual(['rng']);
    expect(findForbiddenKeys({ clean: true })).toEqual([]);
  });

  it('drops the on-chain back-hash but keeps the transaction hash', () => {
    const entry = { hash: 'h1', prevHash: 'h0', day: 2, assetId: 'nexus', side: 'buy' as const, amount: 1, price: 2, address: 'a', counterparty: 'b', note: '' };
    const publicEntry = publicOnChainEntry(entry);
    expect(publicEntry).not.toHaveProperty('prevHash');
    expect(publicEntry.hash).toBe('h1');
  });
});

/* ------------------------------------------------------------------ */
/* World seed: never public                                            */
/* ------------------------------------------------------------------ */

/**
 * The world seed generates the whole world, so a player who learns it can predict the
 * generated outcomes. It stays server-side. These tests serialise the public payload the
 * way `okJson` does (the DTO, then the redaction pass) and search the bytes, so a copy
 * under any key name, nested anywhere, is caught — not just the one property we named.
 */
describe('world seed is never public', () => {
  const SEED = 'seed-canary-7f3a9c1e';

  /** The bytes a success body carries: the DTO after the redaction pass `okJson` runs. */
  function wireJson(value: unknown): string {
    return JSON.stringify(sanitiseForClient(value).value);
  }

  function seeded(seed = SEED): GameState {
    return createNewGame({ userId: 'seed-user', playerName: 'Seeded', seed }).state;
  }

  it('is absent from the public state projection of a new game', () => {
    const state = seeded();
    expect(wireJson(gameStateDto(state)), 'world seed reached the public state projection').not.toContain(SEED);
    expect(findForbiddenKeys(gameStateDto(state))).toEqual([]);
  });

  it('stays absent from the public projection after the simulation has run', () => {
    const state = seeded();
    for (let day = 1; day <= 10; day += 1) advanceDay(state, rngForDay(state, day));
    expect(wireJson(gameStateDto(state))).not.toContain(SEED);
  });

  it('is not written into a progression milestone by a new game', () => {
    const state = seeded();
    expect(state.player.progression.milestones.filter((m) => m.includes(SEED))).toEqual([]);
  });

  it('withholds a seed-bearing milestone that an existing save already carries', () => {
    // Saves written before this fix stored `started:<seed>` inside the sealed state.
    const state = seeded();
    state.player.progression.milestones.push(`started:${SEED}`);
    expect(wireJson(publicPlayer(state.player)), 'legacy milestone reached the public player').not.toContain(SEED);
    expect(wireJson(gameStateDto(state))).not.toContain(SEED);
  });

  it('keeps the seed inside the engine, where generation and replay need it', () => {
    const state = seeded();
    expect(state.config.worldSeed).toBe(SEED);
    // The same seed reproduces the same world; a different seed diverges.
    const again = seeded();
    expect(again.player.locationId).toBe(state.player.locationId);
    expect(JSON.stringify(again.world)).toBe(JSON.stringify(state.world));
    const other = seeded('a-different-seed-9');
    expect(JSON.stringify(other.world)).not.toBe(JSON.stringify(state.world));
  });

  it('treats a worldSeed key as forbidden at any depth, and removes it from the wire', () => {
    expect(findForbiddenKeys({ meta: { config: { worldSeed: SEED } } })).toEqual(['worldSeed']);
    const cleaned = sanitiseForClient({ list: [{ worldSeed: SEED, name: 'kept' }] });
    expect(cleaned.removed).toEqual(['worldSeed']);
    expect(JSON.stringify(cleaned.value)).not.toContain(SEED);
    expect(JSON.stringify(cleaned.value)).toContain('kept');
  });
});
