'use client';

/**
 * The save library.
 *
 * Rendered on the client because it is a live view of the account's saves: it lists,
 * creates and deletes through the API, and every one of those calls is authorised
 * server-side against the session cookie.
 */
import { AuthGate } from '../../components/auth/auth-gate';
import { GameLibrary } from '../../components/games/game-library';
import { useSession } from '../../lib/game-context';

export default function GamesPage() {
  return (
    <AuthGate>
      <main className="mx-auto w-full max-w-6xl px-4 py-8">
        <Games />
      </main>
    </AuthGate>
  );
}

function Games() {
  const { session } = useSession();
  if (!session) return null;
  return <GameLibrary session={session} />;
}
