/**
 * Signed session tokens for the local development authenticator.
 *
 * Pure crypto with no framework dependency, so it can be unit tested and reused by
 * anything that needs a tamper-evident bearer value. Production identity comes from
 * Supabase Auth; this is the fallback that keeps the game playable and testable
 * without an external provider.
 *
 * Format: `v1.<base64url payload>.<base64url HMAC-SHA256>`. The payload holds the
 * user id, the session id (so logout can revoke server-side), and an expiry. The
 * signature covers the whole payload, so none of it can be edited.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getEnv } from '../../config/env';

const PREFIX = 'v1';

export interface SessionPayload {
  /** Session id — the key of the server-side row, so logout revokes it. */
  sid: string;
  userId: string;
  /** Expiry as epoch milliseconds. */
  exp: number;
  /** Issued at, epoch milliseconds. */
  iat: number;
}

let bootSecret: string | null = null;

/**
 * The signing secret.
 *
 * In production `DYNASTY_APP_SECRET` is mandatory (`assertProductionConfig` fails
 * the boot without it). In development, if it is missing, a random secret is
 * generated once per process: sessions still work, they just do not survive a
 * restart, which is the correct trade-off for refusing to ship a guessable key.
 */
export function signingSecret(): { secret: string; ephemeral: boolean } {
  const env = getEnv();
  if (env.appSecret) return { secret: env.appSecret, ephemeral: false };
  if (!bootSecret) {
    bootSecret = randomBytes(32).toString('hex');
    console.warn('[auth] DYNASTY_APP_SECRET is not set — using an ephemeral dev secret. Sessions will not survive a restart.');
  }
  return { secret: bootSecret, ephemeral: true };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function fromBase64url(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

function sign(payloadText: string, secret: string): string {
  return base64url(createHmac('sha256', secret).update(payloadText).digest());
}

/** Issue a token. `ttlMs` defaults to 30 days. */
export function issueSessionToken(userId: string, opts: { ttlMs?: number; sid?: string } = {}): { token: string; payload: SessionPayload } {
  const ttl = opts.ttlMs ?? 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const payload: SessionPayload = {
    sid: opts.sid ?? randomUUID(),
    userId,
    iat: now,
    exp: now + ttl,
  };
  const payloadText = base64url(JSON.stringify(payload));
  const { secret } = signingSecret();
  return { token: `${PREFIX}.${payloadText}.${sign(payloadText, secret)}`, payload };
}

export type TokenVerification =
  | { ok: true; payload: SessionPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired'; message: string };

export function verifySessionToken(token: string | null | undefined): TokenVerification {
  if (!token) return { ok: false, reason: 'malformed', message: 'No session token was presented.' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    return { ok: false, reason: 'malformed', message: 'Session token is not in a recognised format.' };
  }
  const [, payloadText, signature] = parts;
  if (!payloadText || !signature) return { ok: false, reason: 'malformed', message: 'Session token is incomplete.' };

  const { secret } = signingSecret();
  const expected = Buffer.from(sign(payloadText, secret), 'base64url');
  const presented = fromBase64url(signature);
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
    return { ok: false, reason: 'bad_signature', message: 'Session token signature does not match. It was altered or signed with a different secret.' };
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromBase64url(payloadText).toString('utf8')) as SessionPayload;
  } catch {
    return { ok: false, reason: 'malformed', message: 'Session token payload is not valid JSON.' };
  }
  if (typeof payload.userId !== 'string' || typeof payload.exp !== 'number' || typeof payload.sid !== 'string') {
    return { ok: false, reason: 'malformed', message: 'Session token payload is missing required fields.' };
  }
  if (payload.exp <= Date.now()) {
    return { ok: false, reason: 'expired', message: 'Your session expired. Sign in again.' };
  }
  return { ok: true, payload };
}

/** Cookie attributes shared by every place a session cookie is written. */
export function sessionCookieOptions(maxAgeSeconds = 30 * 24 * 60 * 60): Record<string, unknown> {
  const env = getEnv();
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export const SESSION_COOKIE = 'dynasty_session';

/** A random id suitable for anything that must not be guessable. */
export function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}
