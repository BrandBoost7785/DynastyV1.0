/**
 * Entry point.
 *
 * A server component, so the decision is made before any client bundle runs: a signed-in
 * player goes straight to their games, everyone else to the sign-in screen. No session
 * data beyond a boolean ever reaches the browser from here.
 */
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { resolveUser } from '../server/auth';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const cookieHeader = (await cookies()).toString();
  const resolved = await resolveUser(new Request('http://internal/', { headers: cookieHeader ? { cookie: cookieHeader } : {} }));
  redirect(resolved.ok ? '/games' : '/login');
}
