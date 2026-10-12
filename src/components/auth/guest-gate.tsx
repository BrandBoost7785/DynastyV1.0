'use client';

/**
 * Guard for the player's screens.
 *
 * A visitor without a session is never sent to a sign-in page. They see the way in, "Play as
 * Guest", in place, and nothing else. The server still authorises every request that follows,
 * so this only decides what to draw while the session is being read.
 */
import type { ReactNode } from 'react';
import { useAuthState } from '../../lib/game-context';
import { LoadingState } from '../ui/states';
import { PlayAsGuest } from './guest-entry';

export function GuestGate({ children }: { children: ReactNode }) {
  const state = useAuthState();

  if (state === 'authenticated') return <>{children}</>;
  if (state === 'loading') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <LoadingState label="Checking your session" rows={4} cols={3} />
      </div>
    );
  }
  return (
    <section aria-labelledby="guest-start" className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-12">
      <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Dynasty</p>
      <h1 id="guest-start" className="text-2xl font-semibold text-ink">
        Start a guest session to play
      </h1>
      <p className="text-sm text-ink-dim">
        No account is needed. Your guest session is kept by a secure cookie in this browser, so it survives reloads. It cannot be
        reopened from another device.
      </p>
      <PlayAsGuest />
    </section>
  );
}
