/**
 * Deterministic random number generation.
 *
 * Every random decision in the simulation (market noise, events, combat,
 * procedural generation) flows through an explicit {@link Rng} instance so
 * that:
 *
 *  - a saved game can be reproduced exactly from `(seed, turn)`
 *  - subsystems can be given independent, forkable streams that never
 *    interfere with each other
 *  - tests can assert on outcomes without flakiness
 *
 * The generator is xoshiro128** over four 32-bit lanes, seeded from a
 * deterministic string hash (cyrb128). It is *not* cryptographically secure
 * and must never be used for secrets — see `src/server/crypto.ts` for that.
 */

/** cyrb128 — fast, well-distributed 128-bit string hash. Public domain. */
export function hashSeed(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export type RngState = [number, number, number, number];

/**
 * A reproducible pseudo-random stream.
 *
 * Instances are cheap; prefer `fork()` for a labelled sub-stream over sharing
 * a single generator across unrelated systems, so that adding a new system
 * does not perturb the streams of existing ones.
 */
export class Rng {
  private s: RngState;
  readonly label: string;

  constructor(seed: string | number | RngState, label = 'root') {
    this.label = label;
    if (Array.isArray(seed)) {
      this.s = [seed[0] >>> 0, seed[1] >>> 0, seed[2] >>> 0, seed[3] >>> 0];
    } else {
      const key = typeof seed === 'number' ? `n:${seed}` : seed;
      this.s = hashSeed(key);
    }
    // Guard against the all-zero degenerate state.
    if (this.s.every((v) => v === 0)) this.s = hashSeed(`fallback:${label}`);
    // Warm up the generator so early outputs are well mixed.
    for (let i = 0; i < 12; i++) this.raw();
  }

  private raw(): number {
    const [s0, s1, s2, s3] = this.s;
    const result = (Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9)) >>> 0;
    const t = (s1 << 9) >>> 0;

    let s2x = (s2 ^ s0) >>> 0;
    let s3x = (s3 ^ s1) >>> 0;
    const s1x = (s1 ^ s2x) >>> 0;
    const s0x = (s0 ^ s3x) >>> 0;
    s2x = (s2x ^ t) >>> 0;
    s3x = rotl(s3x, 11);

    this.s = [s0x, s1x, s2x, s3x];
    return result;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.raw() / 4294967296;
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) [min, max] = [max, min];
    return Math.floor(min + (max - min + 1) * this.next());
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  /** Normal-ish distribution via Box–Muller, clamped to ±4σ. */
  gaussian(mean = 0, sd = 1): number {
    let u1 = this.next();
    const u2 = this.next();
    if (u1 < 1e-12) u1 = 1e-12;
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const clamped = Math.max(-4, Math.min(4, z));
    return mean + sd * clamped;
  }

  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty collection');
    return items[this.int(0, items.length - 1)] as T;
  }

  pickOr<T>(items: readonly T[], fallback: T): T {
    return items.length === 0 ? fallback : this.pick(items);
  }

  /**
   * Weighted selection. Weights must be finite and non-negative; if the total
   * is zero the fallback (last item) is returned deterministically.
   */
  weighted<T>(entries: readonly { value: T; weight: number }[]): T {
    if (entries.length === 0) throw new Error('Rng.weighted: empty entries');
    let total = 0;
    for (const e of entries) {
      if (Number.isFinite(e.weight) && e.weight > 0) total += e.weight;
    }
    if (total <= 0) return entries[entries.length - 1]!.value;
    let r = this.next() * total;
    for (const e of entries) {
      const w = Number.isFinite(e.weight) && e.weight > 0 ? e.weight : 0;
      r -= w;
      if (r <= 0) return e.value;
    }
    return entries[entries.length - 1]!.value;
  }

  /** Fisher–Yates shuffle; returns a new array, never mutates the input. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = out[i]!;
      out[i] = out[j]!;
      out[j] = tmp;
    }
    return out;
  }

  /** `count` distinct elements, uniform without replacement. */
  sample<T>(items: readonly T[], count: number): T[] {
    if (count <= 0) return [];
    if (count >= items.length) return this.shuffle(items);
    return this.shuffle(items).slice(0, count);
  }

  /** Independent labelled sub-stream derived from this generator's state. */
  fork(label: string): Rng {
    return new Rng([...this.s], `${this.label}/${label}`);
  }

  /** Stable sub-stream that does not advance this generator. */
  derive(label: string): Rng {
    return new Rng(`${this.label}|${label}`, `${this.label}/${label}`);
  }

  getState(): RngState {
    return [...this.s] as RngState;
  }

  setState(state: RngState): void {
    this.s = [state[0] >>> 0, state[1] >>> 0, state[2] >>> 0, state[3] >>> 0];
  }

  clone(): Rng {
    const r = new Rng([...this.s], this.label);
    return r;
  }
}

/** Convenience: a throwaway generator for one-off procedural generation. */
export function rngFor(seed: string, label = 'gen'): Rng {
  return new Rng(seed, label);
}
