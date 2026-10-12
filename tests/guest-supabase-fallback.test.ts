/**
 * Guest sessions on a deployment that has Supabase configured.
 *
 * When Supabase is configured it is tried first, and it does not know a guest. These tests
 * pin that a guest still resolves through the server's own signed session, that a real
 * Supabase user still resolves through Supabase, and that neither path accepts a forgery.
 * Supabase itself is replaced by a stub, so the test needs no network.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteStore } from '../src/persistence/sqlite-store';
import { resetStoreInit, useStoreDriver } from '../src/persistence';
import { resetRateLimits } from '../src/server/services/rate-limit';

let supabaseUser: { id: string; email: string } | null = null;

vi.mock('../src/config/env', async (importOriginal) => {
  const real = (await importOriginal()) as typeof import('../src/config/env');
  return {
    ...real,
    getEnv: () => {
      const base = real.getEnv();
      return {
        ...base,
        supabase: { ...base.supabase, configured: true, url: 'https://stub.supabase.test', publishableKey: 'stub-publishable-key' },
      };
    },
  };
});

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () =>
        supabaseUser
          ? { data: { user: { id: supabaseUser.id, email: supabaseUser.email, user_metadata: { display_name: 'Supa' } } }, error: null }
          : { data: { user: null }, error: { message: 'Auth session missing!' } },
      signOut: async () => ({ error: null }),
    },
  }),
}));

import { GET as sessionGet } from '../src/app/api/auth/session/route';
import { POST as guestPost } from '../src/app/api/auth/guest/route';
import { GET as gamesGet } from '../src/app/api/games/route';
import { invokeRoute as invoke, sessionCookieOf, H } from './route-harness';

const store = new SqliteStore(':memory:');

beforeAll(() => {
  process.env.DYNASTY_APP_SECRET ??= 'test-secret-for-supabase-fallback-only';
  useStoreDriver('sqlite', store);
  resetStoreInit();
});

afterAll(async () => {
  await store.close();
  useStoreDriver(null, undefined);
});

beforeEach(() => {
  resetRateLimits();
  supabaseUser = null;
});

describe('guest sessions with Supabase configured', () => {
  it('resolves a guest through the server session when Supabase knows no user', async () => {
    const created = await invoke<{ userId: string }>(H(guestPost), '/api/auth/guest', { method: 'POST', body: {} });
    expect(created.status).toBe(201);
    const cookie = sessionCookieOf(created.response);

    const session = await invoke<{ authenticated: boolean; user: { id: string; provider: string; email: string | null } }>(H(sessionGet), '/api/auth/session', { cookie });
    expect(session.body.data?.authenticated).toBe(true);
    expect(session.body.data?.user.id).toBe(created.body.data!.userId);
    expect(session.body.data?.user.provider).toBe('guest');
    expect(session.body.data?.user.email).toBeNull();

    const games = await invoke(H(gamesGet), '/api/games', { cookie });
    expect(games.status).toBe(200);
  });

  it('answers an anonymous visitor as unauthenticated, with no cookie minted', async () => {
    const session = await invoke<{ authenticated: boolean }>(H(sessionGet), '/api/auth/session');
    expect(session.status).toBe(200);
    expect(session.body.data?.authenticated).toBe(false);
    const games = await invoke(H(gamesGet), '/api/games');
    expect(games.status).toBe(401);
  });

  it('refuses a forged local cookie even though Supabase is configured', async () => {
    const forged = await invoke(H(gamesGet), '/api/games', { cookie: 'dynasty_session=v1.bogus.bogus' });
    expect(forged.status).toBe(401);
  });

  it('still resolves a real Supabase user through Supabase, not through the local path', async () => {
    supabaseUser = { id: 'sb-user-1', email: 'supa@example.com' };
    const session = await invoke<{ authenticated: boolean; user: { id: string; provider: string; email: string | null } }>(H(sessionGet), '/api/auth/session', {
      cookie: 'sb-test-access=stub',
    });
    expect(session.body.data?.authenticated).toBe(true);
    expect(session.body.data?.user.id).toBe('sb-user-1');
    expect(session.body.data?.user.provider).toBe('supabase');
    expect(session.body.data?.user.email).toBe('supa@example.com');
  });
});
