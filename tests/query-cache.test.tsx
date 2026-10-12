// @vitest-environment jsdom
/**
 * Regression: a mounted query must see data that arrives after the cache is cleared.
 *
 * Sign-in and "Play as Guest" both do: clear the cache, then refetch the session. Before this
 * fix the component subscribed to a cache *entry object*, and `clearAllQueries()` threw that
 * object away. The refetch then published to a new entry the component was not subscribed to,
 * so the screen stayed on its loading state until the page was reloaded. In a real browser the
 * first "Play as Guest" click from /games left the player on "Checking your session…".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { clearAllQueries, refetchQuery, useQuery } from '../src/lib/query';

afterEach(() => {
  cleanup();
  clearAllQueries();
});

describe('query cache after a clear', () => {
  it('delivers a refetched session to a component that was mounted before the clear', async () => {
    // What the server answers. Every read, including the hook's own, asks the server now.
    let server: { authenticated: boolean; user?: { provider: string } } = { authenticated: false };
    const readSession = async () => server;

    const { result } = renderHook(() => useQuery('session', readSession));
    await waitFor(() => expect(result.current.data).toEqual({ authenticated: false }));

    // What startGuest() does: the server now holds a guest, the cache is dropped, and the
    // session is read again.
    server = { authenticated: true, user: { provider: 'guest' } };
    act(() => clearAllQueries());
    await act(async () => {
      await refetchQuery('session', readSession);
    });

    await waitFor(() => expect(result.current.data).toEqual({ authenticated: true, user: { provider: 'guest' } }));
    expect(result.current.loading).toBe(false);
  });
});
