'use client';

/**
 * Modal dialog and confirmation.
 *
 * Behaviours that matter for a game where some actions are irreversible:
 *  - `role="dialog" aria-modal="true"` with a labelled heading;
 *  - Escape closes (unless `dismissible` is false);
 *  - focus moves into the dialog on open and back to the trigger on close;
 *  - the backdrop is a real button, so a click outside is keyboard-reachable too;
 *  - the body scroll is locked while it is open.
 *
 * Destructive confirmations require the player to press an explicit button — never a
 * stray click or a keyboard shortcut.
 */
import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './primitives';

export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  dismissible = true,
  tone = 'default',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  dismissible?: boolean;
  tone?: 'default' | 'danger';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  const handleKey = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) {
        event.stopPropagation();
        onClose();
      }
      // Keep focus inside: Tab from the last control wraps to the first.
      if (event.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      }
    },
    [dismissible, onClose],
  );

  if (!open) return null;

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl', xl: 'max-w-5xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" onKeyDown={handleKey}>
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={dismissible ? 0 : -1}
        onClick={dismissible ? onClose : undefined}
        className="absolute inset-0 cursor-default bg-abyss/80 backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`animate-enter relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-panel border bg-panel shadow-float sm:rounded-panel ${widths[size]} ${
          tone === 'danger' ? 'border-down/50' : 'border-line-strong'
        }`}
      >
        <header className={`flex items-start justify-between gap-3 border-b px-4 py-3 ${tone === 'danger' ? 'border-down/40 bg-down-soft/30' : 'border-line'}`}>
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold text-ink">
              {title}
            </h2>
            {subtitle && <div className="mt-0.5 text-xs text-ink-dim">{subtitle}</div>}
          </div>
          {dismissible && (
            <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
              ✕
            </Button>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-panel-2/60 px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Confirm',
  busy = false,
  destructive = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  destructive?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      tone={destructive ? 'danger' : 'default'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-ink-dim">{body}</div>
    </Dialog>
  );
}
