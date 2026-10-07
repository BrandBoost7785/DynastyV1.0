import type { Metadata } from 'next';
import { AuthForm } from '../../components/auth/auth-form';

export const metadata: Metadata = { title: 'Sign in — Dynasty' };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-panel border border-line bg-panel/90 p-6 shadow-float">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Dynasty</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Sign in</h1>
        <p className="mt-1 mb-5 text-sm text-ink-dim">
          Pick up where your empire left off. Every decision is validated and persisted on the server.
        </p>
        <AuthForm mode="login" />
      </div>
      <p className="mt-4 text-center text-xs text-ink-faint">
        Sessions are signed cookies; the game state lives on the server, never in the browser.
      </p>
    </main>
  );
}
