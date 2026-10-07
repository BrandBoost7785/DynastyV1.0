'use client';

/**
 * Sign in / create account.
 *
 * Deliberately plain: email, password, and (when registering) a display name. The form
 * never decides anything about identity — the server does — it just reports what came
 * back, in words a player can act on. Failures are announced to screen readers, and the
 * submit control cannot be double-fired while a request is in flight.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '../../lib/game-context';
import { ApiError } from '../../lib/api-client';
import { Button, Field, Input } from '../ui/primitives';
import { InlineNote } from '../ui/states';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const { signIn, signUp } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') await signUp(email.trim(), password, displayName.trim());
      else await signIn(email.trim(), password);
      router.push('/games');
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null;
      setError(
        apiError
          ? apiError.status === 401
            ? 'Those credentials were not accepted. Check the email and password and try again.'
            : apiError.message
          : 'The request could not be completed. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {error && (
        <div role="alert">
          <InlineNote tone="down">{error}</InlineNote>
        </div>
      )}

      {mode === 'register' && (
        <Field label="Display name" hint="Shown on leaderboards and to factions." htmlFor="displayName">
          <Input
            id="displayName"
            name="displayName"
            autoComplete="nickname"
            required
            minLength={2}
            maxLength={32}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
      )}

      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </Field>

      <Field label="Password" htmlFor="password" hint={mode === 'register' ? 'Use a passphrase you do not use anywhere else.' : undefined}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>

      <Button type="submit" variant="primary" block loading={busy} disabled={busy}>
        {mode === 'register' ? 'Create account' : 'Sign in'}
      </Button>

      <p className="text-center text-xs text-ink-faint">
        {mode === 'register' ? (
          <>
            Already trading?{' '}
            <Link href="/login" className="text-gold hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{' '}
            <Link href="/register" className="text-gold hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
