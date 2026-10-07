'use client';

/**
 * In-app notifications.
 *
 * Transient feedback for the result of a command — a purchase, a refusal, a conflict.
 * Server-authored notifications (the ones that are part of the game state) live in the
 * notification drawer; these are purely "your last action did this".
 *
 * The viewport is a polite live region, so a screen reader hears the outcome without
 * being interrupted mid-sentence.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from './primitives';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  body?: string;
  /** Sticky toasts stay until dismissed — used for conflicts that need a reload. */
  sticky?: boolean;
}

interface ToastApi {
  push: (toast: Omit<Toast, 'id'> & { id?: string }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>.');
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback<ToastApi['push']>(
    (toast) => {
      counter.current += 1;
      const id = toast.id ?? `toast_${counter.current}`;
      setToasts((current) => [...current.filter((t) => t.id !== id).slice(-4), { ...toast, id }]);
      if (!toast.sticky) {
        const timer = setTimeout(() => dismiss(id), toast.tone === 'danger' ? 9000 : 6000);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  const clear = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setToasts([]);
  }, []);

  const api = useMemo(() => ({ push, dismiss, clear }), [push, dismiss, clear]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-3 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:items-end">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'danger' ? 'alert' : 'status'}
            className={`animate-enter pointer-events-auto w-full max-w-sm rounded-panel border px-3.5 py-3 shadow-float backdrop-blur ${
              toast.tone === 'success'
                ? 'border-up/50 bg-up-soft/95'
                : toast.tone === 'danger'
                  ? 'border-down/50 bg-down-soft/95'
                  : toast.tone === 'warning'
                    ? 'border-warn/50 bg-warn-soft/95'
                    : 'border-info/50 bg-info-soft/95'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{toast.title}</p>
                {toast.body && <p className="mt-0.5 text-xs leading-relaxed text-ink-dim">{toast.body}</p>}
              </div>
              <Button size="sm" variant="ghost" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
                ✕
              </Button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
