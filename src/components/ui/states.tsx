/**
 * Loading, empty and error states.
 *
 * Every screen in the game can be in any of these three states, and the rule is that
 * each one explains itself: what is being loaded, why a list is empty, what actually
 * failed and what the player can do about it. "Something went wrong" is never shown.
 */
import type { ReactNode } from 'react';
import type { ApiError } from '../../lib/api-client';
import { Button, Spinner } from './primitives';

export function Skeleton({ className = '', height = 12 }: { className?: string; height?: number }) {
  return <div className={`skeleton ${className}`} style={{ height }} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={10} className={i === lines - 1 ? 'w-2/3' : 'w-full'} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      <div className="flex gap-2">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} height={10} className="flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-2">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} height={16} className="flex-1 opacity-70" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** The standard busy state for a panel whose contents are not yet known. */
export function LoadingState({ label = 'Loading', rows = 5, cols = 4 }: { label?: string; rows?: number; cols?: number }) {
  return (
    <div role="status" aria-live="polite" className="py-1">
      <p className="mb-3 flex items-center gap-2 text-xs text-ink-faint">
        <Spinner size={13} />
        {label}…
      </p>
      <SkeletonTable rows={rows} cols={cols} />
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-panel border border-dashed border-line-strong bg-panel/60 px-4 py-8 text-center">
      {icon && <div className="text-ink-faint">{icon}</div>}
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <div className="max-w-md text-xs leading-relaxed text-ink-dim">{body}</div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/**
 * Error display.
 *
 * The message is the server's own `error.code`/`message` where one exists, mapped to
 * something a player can act on. Stack traces and internal details are never shown —
 * the request id is, so a support conversation can identify the call.
 */
export function ErrorState({ error, onRetry, label = 'Could not load this data' }: { error: ApiError | null; onRetry?: () => void; label?: string }) {
  const { title, detail } = describeError(error);
  return (
    <div role="alert" className="rounded-panel border border-down/40 bg-down-soft/40 px-4 py-4">
      <h3 className="text-sm font-semibold text-down">{label}</h3>
      <p className="mt-1 text-xs text-ink-dim">{title}</p>
      {detail && <p className="mt-1 text-xs text-ink-faint">{detail}</p>}
      <div className="mt-3 flex items-center gap-2">
        {onRetry && (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        )}
        {error?.status ? <span className="text-[11px] text-ink-faint">{error.status}</span> : null}
      </div>
    </div>
  );
}

/** Turn an `ApiError` into a sentence a player can act on. */
export function describeError(error: ApiError | null): { title: string; detail: string | null } {
  if (!error) return { title: 'The request could not be completed.', detail: null };
  const code = error.code;
  const map: Record<string, string> = {
    not_authenticated: 'Your session has expired. Sign in again to continue.',
    not_found: 'That record no longer exists — it may have been deleted in another session.',
    conflict: 'The game moved on while you were looking at it. Reload to see the current position.',
    save_conflict: 'Your command was based on an older save version, so it was refused rather than applied twice.',
    insufficient_funds: 'There is not enough available cash for that.',
    insufficient_capacity: 'There is not enough free storage for that.',
    insufficient_goods: 'You do not hold enough of that to complete the order.',
    market_unavailable: 'That market is not trading this commodity right now.',
    illegal_in_jurisdiction: 'That commodity is not legal here.',
    locked: 'That system is not unlocked yet.',
    in_transit: 'You are travelling; finish or abandon the journey first.',
    rate_limited: 'Too many requests in a short window. Wait a moment and retry.',
    cooldown_active: 'That action is on cooldown.',
    payload_too_large: 'The request was too large for the server to accept.',
    validation_failed: 'The command was rejected as malformed.',
    invalid_input: 'That input is not valid.',
    service_unavailable: 'The server is temporarily unavailable.',
    internal_error: 'The server hit an unexpected error. Nothing was changed.',
    state_corrupt: 'The save failed its integrity check and was not loaded.',
    action_not_permitted: 'That action is not available in your current situation.',
    unsupported_method: 'That request type is not supported here.',
  };
  return {
    title: map[code] ?? error.message,
    detail: map[code] && error.message !== map[code] ? error.message : null,
  };
}

/** A one-line inline notice: cheaper than a panel for a field-level problem. */
export function InlineNote({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'down' | 'up'; children: ReactNode }) {
  const styles: Record<string, string> = {
    info: 'border-info/40 bg-info-soft/40 text-info',
    warn: 'border-warn/40 bg-warn-soft/40 text-warn',
    down: 'border-down/40 bg-down-soft/40 text-down',
    up: 'border-up/40 bg-up-soft/40 text-up',
  };
  return <p className={`rounded border px-2.5 py-1.5 text-xs ${styles[tone]}`}>{children}</p>;
}
