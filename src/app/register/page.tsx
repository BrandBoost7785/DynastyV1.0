import type { Metadata } from 'next';
import { AuthForm } from '../../components/auth/auth-form';

export const metadata: Metadata = { title: 'Create account — Dynasty' };

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-panel border border-line bg-panel/90 p-6 shadow-float">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Dynasty</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Create your account</h1>
        <p className="mt-1 mb-5 text-sm text-ink-dim">
          One account, many saves. Start with ¤4,200, a starter cargo and a world that prices goods differently in every city.
        </p>
        <AuthForm mode="register" />
      </div>
    </main>
  );
}
