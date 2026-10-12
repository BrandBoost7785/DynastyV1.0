/**
 * Entry point.
 *
 * A server component. A visitor who already holds a session (a guest resuming, or an account)
 * goes straight to their saves. Everyone else sees the landing screen with "Play as Guest".
 * Nothing is created here: a page load never starts a guest session or a game.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { resolveUser } from '../server/auth';
import { PlayAsGuest } from '../components/auth/guest-entry';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Dynasty — economic strategy simulation' };

export default async function HomePage() {
  const cookieHeader = (await cookies()).toString();
  const resolved = await resolveUser(new Request('http://internal/', { headers: cookieHeader ? { cookie: cookieHeader } : {} }));
  if (resolved.ok) redirect('/games');

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 px-4 py-12">
      <div className="rounded-panel border border-line bg-panel/90 p-6 shadow-float">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Dynasty</p>
        <h1 className="mt-1 text-3xl font-semibold text-ink">Build an empire, one trade at a time.</h1>
        <p className="mt-3 text-sm text-ink-dim">
          Trade commodities across a living world, build businesses, run production, and manage crews, debt and risk. Every decision is checked and
          saved on the server.
        </p>
        <div className="mt-6">
          <PlayAsGuest />
        </div>
      </div>
      <ul className="space-y-2 px-1 text-xs text-ink-faint">
        <li>No account or email is needed. Your guest session is kept in a secure cookie in this browser.</li>
        <li>Guest saves cannot be reopened from another device, and ending the session cannot be undone.</li>
      </ul>
    </main>
  );
}
