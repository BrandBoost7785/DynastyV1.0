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
import { createNewGame } from '../src/sim/bootstrap';
import { advanceDay, advanceDays, rngForDay } from '../src/sim/tick';
import { creditCash } from '../src/sim/state';
import type { GameState, TransactionRecord } from '../src/sim/types';

function fresh(seed = 'dto-seed', userId = 'dto-user'): GameState {
  return createNewGame({ userId, playerName: 'Boundary', seed }).state;
}

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
