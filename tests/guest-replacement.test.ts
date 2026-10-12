/**
 * Starting a guest must never replace a real account's session in this browser.
 *
 * A browser that is signed in to an account and calls POST /api/auth/guest would otherwise be
 * handed a new guest cookie, and the account would be signed out here without the player choosing
 * it. The refusal is 409 `conflict` with no session cookie. Supabase is replaced by a stub.
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
          ? { data: { user: { id: supabaseUser.id, email: supabaseUser.email, user_metadata: { display_name: 'Account' } } }, error: null }
          : { data: { user: null }, error: { message: 'Auth session missing!' } },
      signOut: async () => ({ error: null }),
    },
  }),
}));

import { POST as guestPost } from '../src/app/api/auth/guest/route';
import { invokeRoute as invoke, sessionCookieOf, H } from './route-harness';

const store = new SqliteStore(':memory:');

beforeAll(() => {
  process.env.DYNASTY_APP_SECRET ??= 'test-secret-for-guest-replacement-only';
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

describe('starting a guest while signed in to an account', () => {
  it('refuses with 409 conflict and sets no session cookie, so the account is not replaced', async () => {
    supabaseUser = { id: 'acct-replacement-1', email: 'player@example.test' };

    const attempt = await invoke<unknown>(H(guestPost), '/api/auth/guest', {
      method: 'POST',
      body: {},
      headers: { origin: 'http://localhost:3000' },
    });

    expect(attempt.status).toBe(409);
    expect(attempt.body.error?.code).toBe('conflict');
    expect(sessionCookieOf(attempt.response)).toBe('');
  });
});
