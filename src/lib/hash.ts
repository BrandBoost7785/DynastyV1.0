/**
 * Deterministic, dependency-free hashing.
 *
 * Used for transaction integrity chains, save checksums and content-addressable
 * ids. Deliberately pure TypeScript (no `node:crypto`) so the exact same digest
 * can be computed in the browser for offline save verification and on the server
 * for tamper evidence.
 */

/** FNV-1a 32-bit, returned as an 8-char hex string. */
export function fnv1aHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 64-bit-ish digest built from two offset FNV passes. Not cryptographic — it
 * exists to make accidental corruption and naive client-side tampering obvious,
 * which is the threat model for a single-player save file. Real authentication
 * and authorisation live server-side.
 */
export function digestHex(input: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    a ^= c;
    a = Math.imul(a, 0x01000193);
    b = Math.imul(b ^ (c + i), 0x85ebca6b);
    b ^= b >>> 13;
  }
  return ((a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')).slice(0, 16);
}

/** Stable hash of a plain JSON-serialisable value (key order independent). */
export function stableHash(value: unknown): string {
  return digestHex(canonicalJson(value));
}

/** JSON.stringify with sorted object keys, so equal data always hashes equal. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** Short human-readable checksum used in the save UI ("integrity: 4f2a…"). */
export function shortChecksum(value: unknown): string {
  return stableHash(value).slice(0, 8);
}
