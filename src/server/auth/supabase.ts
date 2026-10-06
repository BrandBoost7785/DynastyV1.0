/**
 * Supabase Auth operations (production identity).
 *
 * Only used when the project credentials are present. The local email+password
 * path in `./index.ts` is the development fallback; both produce the same
 * `AuthUser`, so nothing above this module knows which one ran.
 *
 * Cookies the provider wants to set are returned to the caller rather than written
 * to a shared buffer, because a server process handles many requests at once.
 */
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../../config/env';
import type { CookieToSet } from './index';

function parseCookies(request: Request): Map<string, string> {
  const jar = new Map<string, string>();
  const header = request.headers.get('cookie');
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    jar.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return jar;
}

export interface SupabaseOperation<T> {
  ok: boolean;
  message?: string;
  value?: T;
  cookies: CookieToSet[];
}

function clientFor(request: Request, sink: CookieToSet[]): SupabaseClient | null {
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

export async function supabaseSignUp(
  request: Request,
  input: { email: string; password: string; displayName: string },
): Promise<SupabaseOperation<{ userId: string; email: string; needsConfirmation: boolean }>> {
  const cookies: CookieToSet[] = [];
  const supabase = clientFor(request, cookies);
  if (!supabase) return { ok: false, message: 'Supabase Auth is not configured on this deployment.', cookies };
  try {
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { display_name: input.displayName } },
    });
    if (error) return { ok: false, message: error.message, cookies };
    if (!data.user) return { ok: false, message: 'Sign-up did not return a user.', cookies };
    return {
      ok: true,
      cookies,
      value: {
        userId: data.user.id,
        email: data.user.email ?? input.email,
        // Email confirmation is a project setting; when it is on, no session is
        // issued until the link is followed.
        needsConfirmation: data.session === null,
      },
    };
  } catch (error) {
    return { ok: false, message: `Supabase Auth is unreachable: ${error instanceof Error ? error.message : String(error)}`, cookies };
  }
}

export async function supabaseSignIn(
  request: Request,
  input: { email: string; password: string },
): Promise<SupabaseOperation<{ userId: string; email: string }>> {
  const cookies: CookieToSet[] = [];
  const supabase = clientFor(request, cookies);
  if (!supabase) return { ok: false, message: 'Supabase Auth is not configured on this deployment.', cookies };
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email: input.email, password: input.password });
    if (error) return { ok: false, message: error.message, cookies };
    if (!data.user) return { ok: false, message: 'Sign-in did not return a user.', cookies };
    return { ok: true, cookies, value: { userId: data.user.id, email: data.user.email ?? input.email } };
  } catch (error) {
    return { ok: false, message: `Supabase Auth is unreachable: ${error instanceof Error ? error.message : String(error)}`, cookies };
  }
}

export async function supabaseSignOut(request: Request): Promise<SupabaseOperation<void>> {
  const cookies: CookieToSet[] = [];
  const supabase = clientFor(request, cookies);
  if (!supabase) return { ok: false, message: 'Supabase Auth is not configured on this deployment.', cookies };
  try {
    const { error } = await supabase.auth.signOut();
    if (error) return { ok: false, message: error.message, cookies };
    return { ok: true, cookies };
  } catch (error) {
    return { ok: false, message: `Supabase Auth is unreachable: ${error instanceof Error ? error.message : String(error)}`, cookies };
  }
}
