/**
 * Request authentication.
 *
 * Two providers behind one call:
 *
 *  - **Supabase Auth** (production, whenever the project credentials are present).
 *    The user comes from the access token in the Supabase session cookies, so
 *    identity is established by the provider and never asserted by the client.
 *  - **Local signed sessions** (development and tests). A scrypt-hashed password
 *    plus an HMAC-signed cookie, with the session row stored server-side so logout
 *    genuinely revokes.
 *
 * Either way the result is the same: a `userId` that the rest of the server uses to
 * scope every query. Nothing downstream ever reads a user id from a request body.
 */
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../../config/env';
import { getStore } from '../../persistence';
import { SESSION_COOKIE, verifySessionToken } from './tokens';
import type { StoreResult, UserRecord } from '../../persistence/types';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  provider: UserRecord['authProvider'];
}

export interface CookieToSet {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

export type AuthResult =
  | { ok: true; user: AuthUser; cookies: CookieToSet[] }
  | { ok: false; code: 'not_authenticated'; message: string; status: 401; cookies: CookieToSet[] };

function parseCookies(request: Request): Map<string, string> {
  const header = request.headers.get('cookie');
  const jar = new Map<string, string>();
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) jar.set(name, decodeURIComponent(value));
  }
  return jar;
}

/**
 * A Supabase client bound to one request's cookies.
 *
 * The refresh sink is a parameter, not module state: a server process handles many
 * requests concurrently, and a shared array would attach one user's refreshed token
 * to another user's response.
 */
function supabaseForRequest(request: Request, sink: CookieToSet[]): SupabaseClient | null {
  const env = getEnv();
  if (!env.supabase.url || !env.supabase.publishableKey) return null;
  const jar = parseCookies(request);
  return createServerClient(env.supabase.url, env.supabase.publishableKey, {
    cookies: {
      getAll() {
        return [...jar.entries()].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        sink.push(...cookiesToSet.map((c) => ({ name: c.name, value: c.value, options: c.options as Record<string, unknown> | undefined })));
      },
    },
  });
}

async function resolveWithSupabase(request: Request): Promise<AuthResult | null> {
  const cookies: CookieToSet[] = [];
  const supabase = supabaseForRequest(request, cookies);
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return { ok: false, code: 'not_authenticated', message: 'Your Supabase session is not valid. Sign in again.', status: 401, cookies };
    }
    const store = getStore();
    const profile = await store.findUserById(data.user.id);
    const email = data.user.email ?? '';
    if (profile.ok && profile.value) {
      return {
        ok: true,
        user: {
          id: profile.value.id,
          email: profile.value.email || email,
          displayName: profile.value.displayName,
          provider: 'supabase',
        },
        cookies,
      };
    }
    // First request after signing up with Supabase: mirror the identity into a
    // profile row so saves have an owner. No password is ever stored.
    const created = await store.createUser({
      id: data.user.id,
      email: email || `${data.user.id}@supabase.local`,
      displayName: String(data.user.user_metadata?.display_name ?? data.user.user_metadata?.name ?? email.split('@')[0] ?? 'Trader'),
      passwordHash: null,
      authProvider: 'supabase',
    });
    if (!created.ok && created.code !== 'duplicate') {
      return { ok: false, code: 'not_authenticated', message: `Your account could not be provisioned (${created.message}).`, status: 401, cookies };
    }
    const record: StoreResult<UserRecord | null> = created.ok
      ? { ok: true, value: created.value }
      : await store.findUserById(data.user.id);
    if (!record.ok || !record.value) {
      return { ok: false, code: 'not_authenticated', message: 'Your account could not be loaded.', status: 401, cookies };
    }
    return {
      ok: true,
      user: { id: record.value.id, email: record.value.email, displayName: record.value.displayName, provider: 'supabase' },
      cookies,
    };
  } catch (error) {
    // Supabase unreachable must not look like a valid session, and must not crash
    // the handler either.
    return {
      ok: false,
      code: 'not_authenticated',
      message: `Authentication provider unavailable: ${error instanceof Error ? error.message : String(error)}`,
      status: 401,
      cookies,
    };
  }
}

async function resolveWithLocalSession(request: Request): Promise<AuthResult> {
  const token = parseCookies(request).get(SESSION_COOKIE);
  const verified = verifySessionToken(token);
  if (!verified.ok) {
    return { ok: false, code: 'not_authenticated', message: verified.message, status: 401, cookies: [] };
  }

  const store = getStore();
  const session = await store.findSession(verified.payload.sid);
  if (!session.ok || !session.value) {
    return { ok: false, code: 'not_authenticated', message: 'This session was signed out or revoked.', status: 401, cookies: [] };
  }
  if (new Date(session.value.expiresAt).getTime() <= Date.now()) {
    await store.deleteSession(session.value.id);
    return { ok: false, code: 'not_authenticated', message: 'Your session expired. Sign in again.', status: 401, cookies: [] };
  }

  const profile = await store.findUserById(session.value.userId);
  if (!profile.ok || !profile.value) {
    return { ok: false, code: 'not_authenticated', message: 'The account for this session no longer exists.', status: 401, cookies: [] };
  }
  void store.touchUser(profile.value.id);
  return {
    ok: true,
    user: { id: profile.value.id, email: profile.value.email, displayName: profile.value.displayName, provider: profile.value.authProvider },
    cookies: [],
  };
}

/**
 * Who is making this request?
 *
 * Supabase is preferred whenever it is configured; the local session cookie is the
 * development path. Both return the same shape so callers cannot tell them apart.
 */
export async function resolveUser(request: Request): Promise<AuthResult> {
  const env = getEnv();
  if (env.supabase.configured) {
    const result = await resolveWithSupabase(request);
    if (result) return result;
  }
  return resolveWithLocalSession(request);
}

/** True when the deployed build should be using Supabase Auth. */
export function usingSupabaseAuth(): boolean {
  return getEnv().supabase.configured;
}
