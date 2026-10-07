'use client';

/**
 * Route guard.
 *
 * The authoritative check is always the server's — this only decides what to render
 * while the session is being established, so an unauthenticated visitor never sees a
 * flash of game chrome. It grants no access by itself: every request that follows still
 * carries the session cookie and is re-authorised server-side.
 */
import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthState, useSession } from '../../lib/game-context';
import { LoadingState } from '../ui/states';

export function AuthGate({ children }: { children: ReactNode }) {
  const state = useAuthState();
  const { session } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (state === 'anonymous') router.replace('/login');
  }, [router, state]);

  if (state === 'authenticated' && session) return <>{children}</>;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <LoadingState label={state === 'anonymous' ? 'Redirecting to sign in' : 'Checking your session'} rows={4} cols={3} />
    </div>
  );
}
