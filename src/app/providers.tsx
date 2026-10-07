'use client';

/**
 * Client providers.
 *
 * Mounted once at the root: the toast viewport (any screen can raise a result) and the
 * session (every guarded screen needs to know who is signed in). The per-game provider
 * lives inside the game layout, so leaving a save releases its state.
 *
 * The service worker registration lives here too. `public/sw.js` is deliberately a
 * cache-free worker: it installs, claims its clients and registers no fetch handler, so it
 * can never serve a stale price, a stale save or a stale bundle. It exists so the app is a
 * proper installable PWA shell; offline gameplay remains explicitly out of scope, because a
 * server-authoritative game has nothing meaningful to show without the server.
 */
import { useEffect, type ReactNode } from 'react';
import { SessionProvider } from '../lib/game-context';
import { ToastProvider } from '../components/ui/toast';

function useServiceWorker(): void {
  useEffect(() => {
    /*
     * Production only, and never fatal.
     *
     * A service worker in development outlives the dev server and happily intercepts the
     * next build's requests — the classic "why is my app stale" trap. Registration failure
     * is also not an error worth surfacing: the game works perfectly without a worker.
     */
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      /* A missing or blocked worker must not interrupt play. */
    });
  }, []);
}

export function Providers({ children }: { children: ReactNode }) {
  useServiceWorker();
  return (
    <ToastProvider>
      <SessionProvider>{children}</SessionProvider>
    </ToastProvider>
  );
}
