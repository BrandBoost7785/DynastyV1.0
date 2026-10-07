'use client';

/**
 * Shared screen scaffolding.
 *
 * Every game screen is the same shape: ask the server for a read model, handle the three
 * states honestly, then render. `ViewPanel` owns the first two so no screen can forget
 * them, and `CommandButton` owns the client half of the command contract — one
 * idempotency key per attempt, a pending state that blocks a double submit, an explicit
 * confirmation where an action cannot be undone, and the server's own refusal message
 * when it says no.
 */
import { useId, useState, type ReactNode } from 'react';
import type { ApiError } from '../../lib/api-client';
import { useGame, useView, type CommandOptions } from '../../lib/game-context';
import { EmptyState, ErrorState, InlineNote, LoadingState } from '../ui/states';
import { Button, Panel } from '../ui/primitives';
import { ConfirmDialog } from '../ui/dialog';
import { humanise } from '../../lib/format';

export interface ViewPanelProps<T> {
  /** Read model name as registered on the server. */
  view: string;
  params?: Record<string, string | number | boolean>;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Render the payload. Only called when data has arrived. */
  children: (data: T) => ReactNode;
  /** Shown instead of the children when the payload is an empty list/zero rows. */
  isEmpty?: (data: T) => boolean;
  emptyTitle?: string;
  emptyBody?: ReactNode;
  staleTime?: number;
  enabled?: boolean;
  /** Render without the surrounding panel (for screens that compose their own layout). */
  bare?: boolean;
  dense?: boolean;
}

export function ViewPanel<T>({
  view,
  params = {},
  title,
  subtitle,
  actions,
  children,
  isEmpty,
  emptyTitle = 'Nothing here yet',
  emptyBody,
  staleTime,
  enabled = true,
  bare = false,
  dense = false,
}: ViewPanelProps<T>) {
  const query = useView<T>(view, params, { ...(staleTime === undefined ? {} : { staleTime }), enabled });

  const body = (() => {
    if (query.error && query.data === undefined) {
      return <ErrorState error={query.error} onRetry={query.refetch} label={`Could not load ${humanise(view)}`} />;
    }
    if (query.data === undefined) {
      return <LoadingState label={`Loading ${humanise(view)}`} rows={5} cols={dense ? 4 : 6} />;
    }
    if (isEmpty?.(query.data)) {
      return (
        <EmptyState
          title={emptyTitle}
          body={emptyBody ?? 'The server returned no rows for this view — there is genuinely nothing to show.'}
        />
      );
    }
    return children(query.data);
  })();

  if (bare) return <>{body}</>;

  return (
    <Panel
      {...(title === undefined ? {} : { title })}
      {...(subtitle === undefined ? {} : { subtitle })}
      {...(actions === undefined ? {} : { actions })}
      bodyClassName={dense ? 'px-4 py-2' : 'px-4 py-3'}
    >
      {query.refreshing && <p className="mb-2 text-[11px] text-ink-faint">Refreshing…</p>}
      {body}
    </Panel>
  );
}

export interface CommandButtonProps {
  /** The authoritative intent to send, e.g. `{ type: 'trade.buy', commodityId, qty }`. */
  intent: Record<string, unknown>;
  label: ReactNode;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  /** Shown to the player when the control is disabled — never a silent grey button. */
  disabledReason?: string;
  /** Ask before sending. Required for anything expensive or irreversible. */
  confirm?: { title: string; body: ReactNode; confirmLabel?: string; destructive?: boolean };
  options?: CommandOptions;
  className?: string;
  onDone?: (outcome: { ok: boolean; message?: string; code?: string }) => void;
}

/**
 * A button that sends exactly one command.
 *
 * The idempotency key is created per *attempt*: a double click or a reconnect reuses the
 * key and the server replays its receipt instead of applying the order twice.
 */
export function CommandButton({
  intent,
  label,
  pendingLabel = 'Working…',
  variant = 'secondary',
  size = 'md',
  disabled = false,
  disabledReason,
  confirm,
  options,
  className,
  onDone,
}: CommandButtonProps) {
  const { run, meta } = useGame();
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  const send = async () => {
    if (busy) return;
    setBusy(true);
    const outcome = await run(intent, { ...options, ...(requestId ? { requestId } : {}) });
    setBusy(false);
    setRequestId(null);
    onDone?.(outcome.ok ? { ok: true, message: outcome.response.message } : { ok: false, message: outcome.message, code: outcome.code });
  };

  // A refusal a player cannot fix by retrying (an unmet rule) is worth showing inline
  // rather than as a dead control. The reason is rendered as real text that assistive
  // technology can read (`aria-describedby`), not only as a hover tooltip.
  const title = disabled ? disabledReason : undefined;
  const reasonId = useId();
  const reason = disabled ? disabledReason : undefined;

  return (
    <>
      <span className={className} title={title}>
        <Button
          variant={variant}
          size={size}
          disabled={disabled}
          loading={busy}
          aria-describedby={reason ? reasonId : undefined}
          onClick={() => (confirm ? setAsking(true) : void send())}
          className="w-full sm:w-auto"
        >
          {busy ? pendingLabel : label}
        </Button>
        {reason && (
          <span id={reasonId} className="mt-0.5 block text-[11px] leading-snug text-ink-faint">
            {reason}
          </span>
        )}
      </span>
      {confirm && (
        <ConfirmDialog
          open={asking}
          onClose={() => setAsking(false)}
          busy={busy}
          destructive={confirm.destructive}
          title={confirm.title}
          confirmLabel={confirm.confirmLabel ?? 'Confirm'}
          body={confirm.body}
          onConfirm={async () => {
            // Keep the same key across the confirmation: a retry after a timeout replays.
            if (!requestId) setRequestId(crypto.randomUUID?.() ?? `cmd_${Date.now()}`);
            setAsking(false);
            await send();
          }}
        />
      )}
      {meta === null && <span className="sr-only">The save is still loading.</span>}
    </>
  );
}

/** A refusal or warning that belongs next to the control that produced it. */
export function CommandNote({ error, message }: { error?: ApiError | null; message?: string | null }) {
  if (error) return <InlineNote tone="down">{error.message}</InlineNote>;
  if (message) return <InlineNote tone="warn">{message}</InlineNote>;
  return null;
}

/** Quantity + submit, the shape every order-entry form in the game takes. */
export function QuantityPicker({
  value,
  onChange,
  max,
  unit,
  step = 1,
  label = 'Quantity',
  id = 'quantity',
}: {
  value: number;
  onChange: (next: number) => void;
  max?: number;
  unit?: string;
  step?: number;
  label?: string;
  id?: string;
}) {
  const clampNext = (next: number) => {
    const bounded = max !== undefined ? Math.min(max, next) : next;
    onChange(Math.max(0, bounded));
  };
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-dim">
        {label}
        {unit ? <span className="text-ink-faint"> ({unit})</span> : null}
      </label>
      <div className="flex items-stretch gap-1">
        <Button size="sm" variant="secondary" onClick={() => clampNext(value - step)} aria-label={`Decrease ${label}`} disabled={value <= 0}>
          −
        </Button>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          {...(max === undefined ? {} : { max })}
          step={step}
          value={value}
          onChange={(event) => clampNext(Number(event.target.value))}
          className="tnum w-full rounded-md border border-line-strong bg-hull px-2 py-1.5 text-center text-sm text-ink focus:border-gold focus:outline-none"
        />
        <Button size="sm" variant="secondary" onClick={() => clampNext(value + step)} aria-label={`Increase ${label}`} disabled={max !== undefined && value >= max}>
          +
        </Button>
      </div>
      {max !== undefined && (
        <div className="mt-1 flex items-center justify-between text-[11px] text-ink-faint">
          <span>Available: {max.toLocaleString('en-US')}</span>
          <button type="button" className="text-gold hover:underline" onClick={() => clampNext(max)}>
            Max
          </button>
        </div>
      )}
    </div>
  );
}
