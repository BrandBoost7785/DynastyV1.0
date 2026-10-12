'use client';

/**
 * "Play as Guest": the one way into the game.
 *
 * It asks for nothing. The server creates (or resumes) a guest identity and sets the
 * session cookie; this button only asks for that and then goes to the save library. It is
 * the only place a guest session is started, so a page load never creates one.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '../../lib/game-context';
import { ApiError } from '../../lib/api-client';
import { describeError } from '../ui/states';
import { Button } from '../ui/primitives';

export function PlayAsGuest({ size = 'lg' }: { size?: 'sm' | 'md' | 'lg' }) {
  const { startGuest } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="primary"
        size={size}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setProblem(null);
          try {
            await startGuest();
            router.push('/games');
          } catch (error) {
            const apiError = error instanceof ApiError ? error : null;
            const described = describeError(apiError);
            setProblem(apiError?.code === 'rate_limited' ? 'Too many new guest sessions from this connection. Try again later.' : described.title);
            setBusy(false);
          }
        }}
      >
        Play as Guest
      </Button>
      {problem && (
        <p role="alert" className="text-sm text-down">
          {problem}
        </p>
      )}
    </div>
  );
}
