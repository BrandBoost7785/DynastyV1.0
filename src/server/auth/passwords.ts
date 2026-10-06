/**
 * Password hashing for the local development authenticator.
 *
 * In production Supabase Auth owns credentials and this module is never on the
 * path — `profiles.password_hash` stays null for every Supabase account. It exists
 * so the game is fully playable and testable with no external identity provider,
 * and it is written to the standard it would need to meet if it were ever used for
 * real: scrypt with a per-password salt, constant-time comparison, and a work
 * factor that is explicit rather than accidental.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (password: string | Buffer, salt: string | Buffer, keylen: number, options: object) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
/**
 * scrypt cost parameters. N must be a power of two; 2^15 with r=8 is the OWASP
 * floor and costs about 32 MB and ~80 ms per hash — slow enough to resist brute
 * force, fast enough not to be a denial-of-service lever on the login endpoint
 * (which is rate limited anyway).
 */
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const COST = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 256 * SCRYPT_N * SCRYPT_R };

export interface HashedPassword {
  hash: string;
}

/** Format: `scrypt$N$r$p$saltHex$hashHex` — self-describing so parameters can change. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { N: COST.N, r: COST.r, p: COST.p, maxmem: COST.maxmem });
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export interface VerifyResult {
  ok: boolean;
  /** True when the stored hash uses older parameters and should be rehashed. */
  needsRehash: boolean;
  reason?: string;
}

export async function verifyPassword(password: string, stored: string | null): Promise<VerifyResult> {
  if (!stored) return { ok: false, needsRehash: false, reason: 'No password is set for this account.' };
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return { ok: false, needsRehash: true, reason: 'Stored hash is not in a recognised format.' };
  }
  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return { ok: false, needsRehash: true, reason: 'Stored hash has invalid parameters.' };
  }
  const salt = Buffer.from(saltHex ?? '', 'hex');
  const expected = Buffer.from(hashHex ?? '', 'hex');
  if (salt.length === 0 || expected.length === 0) {
    return { ok: false, needsRehash: true, reason: 'Stored hash is malformed.' };
  }

  const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, { N, r, p, maxmem: 128 * N * r * 2 });
  // Equal-length check first: timingSafeEqual throws on a length mismatch, and an
  // exception here would leak whether the stored hash was well formed.
  const ok = derived.length === expected.length && timingSafeEqual(derived, expected);
  return { ok, needsRehash: ok && (N !== COST.N || r !== COST.r || p !== COST.p) };
}

/**
 * Password policy.
 *
 * Deliberately modest: this is a game account, and a policy nobody can remember
 * produces reused passwords. Length is what matters most.
 */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 10) problems.push('Use at least 10 characters.');
  if (password.length > 512) problems.push('That password is unreasonably long.');
  if (!/[a-zA-Z]/.test(password)) problems.push('Include at least one letter.');
  if (!/[0-9]/.test(password)) problems.push('Include at least one number.');
  if (password !== password.trim()) problems.push('Do not start or end with a space.');
  return problems;
}

export const PASSWORD_POLICY = 'At least 10 characters, with a letter and a number.';
