/**
 * Authentication service — provider-agnostic sign-up, sign-in and sign-out.
 *
 * Production uses Supabase Auth; development and tests use the local scrypt +
 * signed-cookie path. Route handlers call these three functions and never branch on
 * the provider themselves, which is what keeps the two paths from drifting apart.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { getEnv } from '../../config/env';
import { getStore } from '../../persistence';
import { hashPassword, passwordProblems, verifyPassword } from '../auth/passwords';
import { SESSION_COOKIE, issueSessionToken, randomId, sessionCookieOptions } from '../auth/tokens';
import { supabaseSignIn, supabaseSignOut, supabaseSignUp } from '../auth/supabase';
import { resolveUser, type CookieToSet } from '../auth';
import { serializeCookie } from '../api-helpers';

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
}

export interface AuthOutcome {
  ok: boolean;
  message?: string;
  userId?: string;
  displayName?: string;
  /** Set-Cookie header values the route must attach. */
  setCookies: string[];
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function register(input: RegisterInput, request: Request): Promise<AuthOutcome> {
  const email = normaliseEmail(input.email);
  const displayName = input.displayName.trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, message: 'That does not look like an email address.', setCookies: [] };
  }
  if (displayName.length < 2 || displayName.length > 32) {
    return { ok: false, message: 'Choose a display name between 2 and 32 characters.', setCookies: [] };
  }

  const env = getEnv();
  const store = getStore();

  if (env.supabase.configured) {
    const problems = passwordProblems(input.password);
    if (problems.length > 0) return { ok: false, message: problems.join(' '), setCookies: [] };
    const signUp = await supabaseSignUp(request, { email, password: input.password, displayName });
    // Whatever cookies Supabase minted must reach the browser even on failure paths.
    const setCookies = signUp.cookies.map((c) => serializeCookie(c.name, c.value, c.options ?? {}));
    if (!signUp.ok || !signUp.value) return { ok: false, message: signUp.message ?? 'Sign-up failed.', setCookies };

    // Mirror the identity into a profile row so saves have an owner. No password is
    // ever stored when Supabase owns credentials.
    const existing = await store.findUserById(signUp.value.userId);
    if (!existing.ok || !existing.value) {
      const created = await store.createUser({
        id: signUp.value.userId,
        email,
        displayName,
        passwordHash: null,
        authProvider: 'supabase',
      });
      if (!created.ok && created.code !== 'duplicate') {
        return { ok: false, message: `Your account was created but could not be provisioned here: ${created.message}`, setCookies };
      }
    }
    if (signUp.value.needsConfirmation) {
      return {
        ok: true,
        userId: signUp.value.userId,
        displayName,
        message: 'Account created. Check your email to confirm the address, then sign in.',
        setCookies,
      };
    }
    return { ok: true, userId: signUp.value.userId, displayName, message: 'Account created.', setCookies };
  }

  const problems = passwordProblems(input.password);
  if (problems.length > 0) return { ok: false, message: problems.join(' '), setCookies: [] };

  const taken = await store.findUserByEmail(email);
  if (!taken.ok) return { ok: false, message: taken.message, setCookies: [] };
  if (taken.value) return { ok: false, message: 'An account with that email already exists.', setCookies: [] };

  const userId = `usr_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const passwordHash = await hashPassword(input.password);
  const created = await store.createUser({ id: userId, email, displayName, passwordHash, authProvider: 'local' });
  if (!created.ok) return { ok: false, message: created.message, setCookies: [] };

  await store.appendAudit({ userId, gameId: null, action: 'auth.register', ok: true, code: null, day: 0, turn: 0, detail: 'local' });
  const session = await startLocalSession(userId, request);
  return { ok: true, userId, displayName, message: 'Account created. Welcome to Dynasty.', setCookies: session.setCookies };
}

export async function login(input: { email: string; password: string }, request: Request): Promise<AuthOutcome> {
  const email = normaliseEmail(input.email);
  const env = getEnv();
  const store = getStore();

  if (env.supabase.configured) {
    const signIn = await supabaseSignIn(request, { email, password: input.password });
    const setCookies = signIn.cookies.map((c) => serializeCookie(c.name, c.value, c.options ?? {}));
    if (!signIn.ok || !signIn.value) return { ok: false, message: signIn.message ?? 'Sign-in failed.', setCookies };
    const profile = await store.findUserById(signIn.value.userId);
    await store.touchUser(signIn.value.userId);
    await store.appendAudit({ userId: signIn.value.userId, gameId: null, action: 'auth.login', ok: true, code: null, day: 0, turn: 0, detail: 'supabase' });
    return {
      ok: true,
      userId: signIn.value.userId,
      displayName: profile.ok ? (profile.value?.displayName ?? email) : email,
      setCookies,
    };
  }

  const found = await store.findUserByEmail(email);
  if (!found.ok) return { ok: false, message: found.message, setCookies: [] };
  // Same message whether the account is missing or the password is wrong: an
  // attacker must not be able to enumerate registered emails.
  if (!found.value) return { ok: false, message: 'That email and password do not match an account.', setCookies: [] };
  if (!found.value.passwordHash) {
    return { ok: false, message: 'This account signs in with the external provider, not a password.', setCookies: [] };
  }

  const verified = await verifyPassword(input.password, found.value.passwordHash);
  if (!verified.ok) {
    await store.appendAudit({ userId: found.value.id, gameId: null, action: 'auth.login', ok: false, code: 'bad_credentials', day: 0, turn: 0, detail: null });
    return { ok: false, message: 'That email and password do not match an account.', setCookies: [] };
  }

  if (verified.needsRehash) {
    // scrypt parameters moved on since this hash was written. The password has just
    // been proven, so upgrade it transparently; a failure is logged, not fatal.
    const fresh = await hashPassword(input.password);
    const updated = await store.updateUserPassword(found.value.id, fresh);
    if (!updated.ok) console.warn(`[auth] password rehash failed for ${found.value.id}: ${updated.message}`);
  }
  const session = await startLocalSession(found.value.id, request);
  const setCookies = session.setCookies;

  await store.appendAudit({ userId: found.value.id, gameId: null, action: 'auth.login', ok: true, code: null, day: 0, turn: 0, detail: 'local' });
  return { ok: true, userId: found.value.id, displayName: found.value.displayName, setCookies };
}

async function startLocalSession(userId: string, request: Request): Promise<{ setCookies: string[]; sessionId: string }> {
  const store = getStore();
  const issued = issueSessionToken(userId, { ttlMs: SESSION_TTL_MS });
  const expiresAt = new Date(issued.payload.exp).toISOString();
  const created = await store.createSession({
    id: issued.payload.sid,
    userId,
    expiresAt,
    userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? null,
  });
  if (!created.ok) {
    // Without a stored session the token would be unverifiable on the next request;
    // fail closed rather than hand out a cookie that cannot be revoked.
    throw new Error(`Session could not be stored: ${created.message}`);
  }
  const options = sessionCookieOptions(Math.floor(SESSION_TTL_MS / 1000));
  return { setCookies: [serializeCookie(SESSION_COOKIE, issued.token, options)], sessionId: issued.payload.sid };
}

export interface GuestOutcome {
  ok: boolean;
  /** True when a new guest was created; false when a valid guest session was resumed. */
  created: boolean;
  userId?: string;
  displayName?: string;
  message?: string;
  /** `conflict` when a non-guest account is signed in and must sign out first. */
  code?: 'conflict';
  setCookies: string[];
}

/**
 * Start a guest session, or resume the one this browser already holds.
 *
 * Idempotent by design. A request that already carries a valid guest session gets that same
 * identity back and no new row, so a reload, a double click or a second tab cannot mint
 * extra guests or orphan a save. Only a request with no usable session creates an identity,
 * and the id is generated here, never taken from the request.
 *
 * The guest has no email and no password. Its credential is the signed session cookie, which
 * is only ever delivered in Set-Cookie, never in the body.
 *
 * A valid session for a real account is never replaced. Starting a guest would overwrite the
 * account's cookie in this browser, and the player would be signed out of the account without
 * having chosen to. That refusal is `conflict`; the player signs out first.
 */
export async function startGuest(request: Request): Promise<GuestOutcome> {
  const existing = await resolveUser(request);
  if (existing.ok && existing.user.provider === 'guest') {
    return {
      ok: true,
      created: false,
      userId: existing.user.id,
      displayName: existing.user.displayName,
      message: 'Resumed your guest session.',
      setCookies: existing.cookies.map((c) => serializeCookie(c.name, c.value, c.options ?? {})),
    };
  }
  if (existing.ok) {
    return {
      ok: false,
      created: false,
      code: 'conflict',
      message: 'You are signed in to an account. Sign out before starting a guest session.',
      setCookies: [],
    };
  }

  const store = getStore();
  const userId = randomId('gst');
  const displayName = `Guest ${randomBytes(2).toString('hex').toUpperCase()}`;
  const created = await store.createUser({ id: userId, email: null, displayName, passwordHash: null, authProvider: 'guest' });
  if (!created.ok) return { ok: false, created: false, message: created.message, setCookies: [] };

  await store.appendAudit({ userId, gameId: null, action: 'auth.guest', ok: true, code: null, day: 0, turn: 0, detail: null });
  const session = await startLocalSession(userId, request);
  return { ok: true, created: true, userId, displayName, message: 'Guest session started.', setCookies: session.setCookies };
}

export async function logout(userId: string, request: Request): Promise<AuthOutcome> {
  const store = getStore();
  const env = getEnv();
  const setCookies: string[] = [];

  if (env.supabase.configured) {
    const signedOut = await supabaseSignOut(request);
    setCookies.push(...signedOut.cookies.map((c) => serializeCookie(c.name, c.value, c.options ?? {})));
  }

  // Revoke every local session for the account, and expire the cookie regardless of
  // which provider issued it: logout must always leave the browser with nothing.
  await store.deleteSessionsForUser(userId);
  setCookies.push(serializeCookie(SESSION_COOKIE, '', { ...sessionCookieOptions(0), maxAge: 0 }));
  await store.appendAudit({ userId, gameId: null, action: 'auth.logout', ok: true, code: null, day: 0, turn: 0, detail: null });
  return { ok: true, message: 'Signed out.', setCookies };
}

/** Cookie header that clears the local session, for 401 responses. */
export function expiredSessionCookie(): CookieToSet {
  return { name: SESSION_COOKIE, value: '', options: { ...sessionCookieOptions(0), maxAge: 0 } };
}
