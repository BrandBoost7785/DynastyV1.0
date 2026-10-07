/**
 * Deterministic iteration over state records.
 *
 * Object key order is *observable* to this simulation: loops that draw from a
 * seeded RNG, or accumulate floating-point totals, produce different results when
 * the same data is stored in a different order. That is not a theoretical hazard.
 * Saves are written as canonical JSON, whose object keys are sorted, so a state
 * that had been saved and restored used to iterate in a different order from the
 * live state that produced it — and the two runs then diverged: entity A got the
 * random draw that entity B had received before the save, and the world's
 * inflation, sentiment and price levels drifted apart over the following weeks.
 *
 * Every loop over a *state record* that can affect a number or a draw therefore
 * goes through these helpers, which impose a single canonical order (ascending
 * key). Iteration over registry/definition records is deliberately left alone:
 * those are module constants, their order is fixed at build time, and sorting them
 * on every tick would cost without buying anything.
 *
 * The helpers return fresh arrays, so callers may mutate the values they iterate
 * (they are live references) but cannot disturb the underlying key set by
 * iterating — deleting inside one of these loops is safe because we snapshot the
 * keys first.
 */

/** Ascending, canonical key order for a record. */
export function orderedKeys<T>(record: Record<string, T> | null | undefined): string[] {
  return record ? Object.keys(record).sort() : [];
}

/** Ascending key order, paired with the live values. */
export function orderedEntries<T>(record: Record<string, T> | null | undefined): [string, T][] {
  if (!record) return [];
  return Object.keys(record)
    .sort()
    .map((key) => [key, record[key]!] as [string, T]);
}

/** Ascending key order, values only. */
export function orderedValues<T>(record: Record<string, T> | null | undefined): T[] {
  if (!record) return [];
  return Object.keys(record)
    .sort()
    .map((key) => record[key]!);
}

/**
 * Stable total of a weighted contribution per key, summed in canonical order.
 * Floating-point addition is not associative, so a total computed in a different
 * order is a different number — this is the one place we want it to always be the
 * same number.
 */
export function orderedSum<T>(record: Record<string, T> | null | undefined, weight: (value: T) => number): number {
  let total = 0;
  for (const value of orderedValues(record)) total += weight(value);
  return total;
}
