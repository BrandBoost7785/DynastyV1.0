'use client';

/**
 * Live API probe for the shell page.
 *
 * This is deliberately small — it is not the game UI (that is Phase 1B). Its job is to
 * prove the client/server wiring works end to end from a browser: a client component
 * calling the typed API client over relative URLs, receiving the standard envelope,
 * and rendering what the server says. If the session endpoint answers, the whole
 * stack (route handler → service → persistence) answered.
 *
 * The refresh is driven by an attempt counter so the effect only ever updates state
 * from an asynchronous continuation — never synchronously while React is rendering.
 */
import { useEffect, useState } from 'react';
import { api, ApiError, type SessionInfo } from '../lib/api-client';

interface HealthPayload {
  status: string;
  driver: string;
  schemaVersion: number;
  content: Record<string, number>;
}

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; session: SessionInfo; health: HealthPayload }
  | { phase: 'error'; message: string };

export default function SystemStatus() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // `/api/health` is public and `/api/auth/session` answers for anonymous visitors,
        // so this works before any account exists.
        const [session, healthResponse] = await Promise.all([api.session(), fetch('/api/health').then((response) => response.json())]);
        if (cancelled) return;
        setState({ phase: 'ready', session, health: healthResponse.data as HealthPayload });
      } catch (error) {
        if (cancelled) return;
        setState({ phase: 'error', message: error instanceof ApiError ? `${error.code}: ${error.message}` : 'The API could not be reached.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state.phase === 'loading') return <p className="status">Checking the API…</p>;
  if (state.phase === 'error') {
    return (
      <div className="status status-error">
        <p>{state.message}</p>
        <button type="button" onClick={() => setAttempt((current) => current + 1)}>
          Retry
        </button>
      </div>
    );
  }

  const { session, health } = state;
  return (
    <div className="status">
      <p>
        <strong>API reachable.</strong> {health.driver} driver, schema v{health.schemaVersion}, {health.status}.
      </p>
      <p>
        {session.authenticated && session.user
          ? `Signed in as ${session.user.displayName} (${session.auth}).`
          : `Not signed in yet — auth provider: ${session.auth}.`}
      </p>
      <p className="muted">
        {health.content.commodities} commodities · {health.content.locations} locations · {health.content.routes} routes · {health.content.events} events
      </p>
      <button
        type="button"
        onClick={() => {
          setState({ phase: 'loading' });
          setAttempt((current) => current + 1);
        }}
      >
        Re-check
      </button>
    </div>
  );
}
