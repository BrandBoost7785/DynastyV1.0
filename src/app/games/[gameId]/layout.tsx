/**
 * Game layout.
 *
 * Wraps every screen of a save in the authoritative game context: the save's state, its
 * version, and the command runner. The shell is a client component because the game is a
 * live client of the API — but nothing it renders is client-authoritative.
 */
import type { Metadata } from 'next';
import { AuthGate } from '../../../components/auth/auth-gate';
import { GameProvider } from '../../../lib/game-context';
import { GameShell } from '../../../components/game/shell';

export const metadata: Metadata = { title: 'Dynasty' };

export default async function GameLayout({ children, params }: { children: React.ReactNode; params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return (
    <AuthGate>
      <GameProvider gameId={gameId}>
        <GameShell>{children}</GameShell>
      </GameProvider>
    </AuthGate>
  );
}
