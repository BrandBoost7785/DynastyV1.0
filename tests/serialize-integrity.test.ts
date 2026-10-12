/**
 * Seal verification over stored documents, independent of any database.
 *
 * PostgreSQL returns a `jsonb` document with its keys re-ordered. These tests reproduce
 * that re-ordering in memory, so the fix is exercised without a server: an unchanged save
 * must verify, and any change to its content must not.
 */
import { describe, expect, it } from 'vitest';
import { createNewGame } from '../src/sim/bootstrap';
import { advanceDay, rngForDay } from '../src/sim/tick';
import { deserializeState, extractMetadata, sealedTextFromStored, serializeState } from '../src/persistence/serialize';
import { canonicalJson } from '../src/lib/hash';
import type { GameState } from '../src/sim/types';

/** Re-order every object's keys in reverse and add whitespace: the shape jsonb hands back. */
function reorderedText(text: string): string {
  const reverse = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reverse);
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).reverse()) {
        out[key] = reverse((value as Record<string, unknown>)[key]);
      }
      return out;
    }
    return value;
  };
  return JSON.stringify(reverse(JSON.parse(text)), null, 2);
}

function sealedFixture(days = 2): { state: GameState; json: string; hash: string } {
  const state = createNewGame({ userId: 'user-seal', playerName: 'Seal', seed: 'seal-fixture' }).state;
  state.version = 1;
  for (let i = 0; i < days; i++) advanceDay(state, rngForDay(state, state.world.day + 1));
  const sealed = serializeState(state);
  if (!sealed.ok) throw new Error('fixture did not serialise');
  return { state, json: sealed.value.json, hash: sealed.value.integrityHash };
}

describe('sealed text recovered from a re-ordering document store', () => {
  it('verifies an unchanged save whose keys were re-ordered', () => {
    const { state, json, hash } = sealedFixture();
    const stored = reorderedText(json);
    expect(stored).not.toBe(json);

    const sealed = sealedTextFromStored(stored);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    expect(sealed.value).toBe(json);

    const restored = deserializeState(sealed.value, { expectedHash: hash });
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(restored.value.gameId).toBe(state.gameId);
      expect(restored.value.world.day).toBe(state.world.day);
      expect(canonicalJson(restored.value)).toBe(json);
    }
  });

  it('keeps floating-point values byte-identical through the round trip', () => {
    const { json, hash } = sealedFixture();
    const sealed = sealedTextFromStored(reorderedText(json));
    expect(sealed.ok && sealed.value).toBe(json);
    expect(sealed.ok && deserializeState(sealed.value, { expectedHash: hash }).ok).toBe(true);
  });

  it('still rejects a save whose content was changed after sealing', () => {
    const { json, hash } = sealedFixture();
    const tampered = JSON.parse(reorderedText(json)) as { world: { day: number } };
    tampered.world.day += 1;
    const sealed = sealedTextFromStored(JSON.stringify(tampered));
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    const result = deserializeState(sealed.value, { expectedHash: hash });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('corrupt');
  });

  it('still rejects a save whose seal was edited', () => {
    const { json } = sealedFixture();
    const sealed = sealedTextFromStored(reorderedText(json));
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    const result = deserializeState(sealed.value, { expectedHash: '0000000000000000' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('corrupt');
  });

  it('accepts text that is already canonical, as SQLite stores it (legacy compatibility)', () => {
    const { json, hash } = sealedFixture();
    const sealed = sealedTextFromStored(json);
    expect(sealed.ok && sealed.value).toBe(json);
    expect(sealed.ok && deserializeState(sealed.value, { expectedHash: hash }).ok).toBe(true);
  });

  it('reports text that is not JSON as corrupt rather than throwing', () => {
    const result = sealedTextFromStored('{"unterminated": ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('corrupt');
  });

  it('keeps the metadata a save is listed by', () => {
    const { state } = sealedFixture();
    const meta = extractMetadata(state);
    expect(meta.gameId).toBe(state.gameId);
    expect(meta.day).toBe(state.world.day);
  });
});
