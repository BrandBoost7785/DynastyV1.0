/**
 * Design-system primitives.
 *
 * Built from repeated patterns in the real screens rather than up front: a panel, a
 * button in four intents, a badge, a stat, a meter, a field. Everything is a plain
 * semantic element with Tailwind utilities, so keyboard and screen-reader behaviour
 * comes from the browser rather than from a reimplementation.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { useId } from 'react';
import { clamp } from '../../lib/format';

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
  bodyClassName = '',
  tone = 'default',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  tone?: 'default' | 'danger' | 'warn' | 'info';
}) {
  const border = tone === 'danger' ? 'border-down/40' : tone === 'warn' ? 'border-warn/40' : tone === 'info' ? 'border-info/40' : 'border-line';
  return (
    <section className={`rounded-panel border ${border} bg-panel shadow-panel ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="truncate text-sm font-semibold tracking-wide text-ink uppercase">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={`px-4 py-3 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function SectionHeader({ title, subtitle, actions, id }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 id={id} className="text-base font-semibold text-ink">
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, meta, actions }: { eyebrow?: string; title: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">{eyebrow}</p>}
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">{title}</h1>
        {meta && <div className="mt-1 text-xs text-ink-dim">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-gold text-abyss border-gold hover:bg-gold-soft font-semibold',
  secondary: 'bg-panel-2 text-ink border-line-strong hover:bg-panel-3',
  ghost: 'bg-transparent text-ink-dim border-transparent hover:bg-panel-2 hover:text-ink',
  danger: 'bg-down-soft text-down border-down/50 hover:bg-down/25',
  success: 'bg-up-soft text-up border-up/50 hover:bg-up/25',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3.5 py-1.5 text-sm',
  lg: 'px-5 py-2.5 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', loading = false, block = false, className = '', children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type={rest.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
}

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Badges and chips                                                    */
/* ------------------------------------------------------------------ */

export type Tone = 'neutral' | 'up' | 'down' | 'warn' | 'info' | 'violet' | 'gold' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-panel-3 text-ink-dim border-line-strong',
  up: 'bg-up-soft text-up border-up/40',
  down: 'bg-down-soft text-down border-down/40',
  warn: 'bg-warn-soft text-warn border-warn/40',
  info: 'bg-info-soft text-info border-info/40',
  violet: 'bg-violet-soft text-violet border-violet/40',
  gold: 'bg-gold/15 text-gold border-gold/40',
  danger: 'bg-danger-soft text-danger border-danger/40',
};

export function Badge({ tone = 'neutral', children, title, className = '' }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** A small status dot with a text label, so state is never colour-only. */
export function StatusDot({ tone = 'neutral', label, pulse = false }: { tone?: Tone; label: string; pulse?: boolean }) {
  const colour: Record<Tone, string> = {
    neutral: 'bg-ink-faint',
    up: 'bg-up',
    down: 'bg-down',
    warn: 'bg-warn',
    info: 'bg-info',
    violet: 'bg-violet',
    gold: 'bg-gold',
    danger: 'bg-danger',
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-dim">
      <span className={`h-2 w-2 shrink-0 rounded-full ${colour[tone]} ${pulse ? 'animate-pulse-soft' : ''}`} aria-hidden="true" />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Data display                                                        */
/* ------------------------------------------------------------------ */

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
  icon,
  compact = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'up' | 'down' | 'warn' | 'gold';
  icon?: ReactNode;
  compact?: boolean;
}) {
  const valueTone = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : tone === 'warn' ? 'text-warn' : tone === 'gold' ? 'text-gold' : 'text-ink';
  return (
    <div className={`rounded-panel border border-line bg-panel ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">{label}</p>
        {icon && <span className="text-ink-faint" aria-hidden="true">{icon}</span>}
      </div>
      <p className={`tnum mt-1 font-semibold ${compact ? 'text-base' : 'text-lg'} ${valueTone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

export function KeyValue({ label, children, tone }: { label: ReactNode; children: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className={`tnum text-sm ${tone ?? 'text-ink'}`}>{children}</dd>
    </div>
  );
}

export function Meter({
  value,
  max = 1,
  label,
  display,
  tone = 'gold',
  height = 6,
}: {
  /** Current value. `max` defaults to 1 so a 0…1 ratio can be passed directly. */
  value: number;
  max?: number;
  label?: string;
  display?: string;
  tone?: 'gold' | 'up' | 'down' | 'warn' | 'info' | 'violet';
  height?: number;
}) {
  const ratio = max > 0 ? clamp(value / max, 0, 1) : 0;
  const bar: Record<string, string> = {
    gold: 'bg-gold',
    up: 'bg-up',
    down: 'bg-down',
    warn: 'bg-warn',
    info: 'bg-info',
    violet: 'bg-violet',
  };
  return (
    <div>
      {(label || display) && (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          {label && <span className="text-ink-faint">{label}</span>}
          {display && <span className="tnum text-ink-dim">{display}</span>}
        </div>
      )}
      <div
        className="w-full overflow-hidden rounded-full bg-panel-3"
        style={{ height }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        aria-label={label ?? 'Usage'}
      >
        <div className={`h-full rounded-full ${bar[tone]} transition-[width] duration-300`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

export function Progress({ value, tone = 'gold', label }: { value: number; tone?: 'gold' | 'up' | 'warn' | 'info'; label?: string }) {
  return <Meter value={clamp(value, 0, 1)} tone={tone} label={label} display={`${Math.round(clamp(value, 0, 1) * 100)}%`} />;
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-line pb-px">
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors ${
              active ? 'border-gold font-semibold text-ink' : 'border-transparent text-ink-dim hover:text-ink'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && <span className="tnum ml-1.5 text-xs text-ink-faint">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form fields                                                         */
/* ------------------------------------------------------------------ */

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-ink-dim">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
      {error && (
        <p className="mt-1 text-xs text-down" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-line-strong bg-hull px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-gold focus:outline-none disabled:opacity-50 ${className}`}
      {...rest}
    />
  );
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`w-full rounded-md border border-line-strong bg-hull px-3 py-2 text-sm text-ink focus:border-gold focus:outline-none disabled:opacity-50 ${className}`} {...rest}>
      {children}
    </select>
  );
}

export function Checkbox({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-gold)]" />
      <div>
        <label htmlFor={id} className="text-sm text-ink">
          {label}
        </label>
        {hint && <p className="text-xs text-ink-faint">{hint}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */

export function Table({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table aria-label={label} className={`w-full min-w-[36rem] border-collapse text-sm ${className}`}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, align = 'left', className = '', ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      scope="col"
      className={`sticky top-0 z-10 border-b border-line bg-panel px-2.5 py-2 text-[11px] font-semibold tracking-wide text-ink-faint uppercase ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      } ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({ children, align = 'left', className = '', ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <td
      className={`border-b border-line/60 px-2.5 py-2 align-middle ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} ${className}`}
      {...rest}
    >
      {children}
    </td>
  );
}

export function Tr({ children, className = '', highlight = false }: { children: ReactNode; className?: string; highlight?: boolean }) {
  return <tr className={`${highlight ? 'bg-panel-2/70' : 'hover:bg-panel-2/40'} ${className}`}>{children}</tr>;
}

/** A signed change value, coloured and labelled consistently. */
export function Delta({ value, format, tone }: { value: number; format: (n: number) => string; tone?: Tone }) {
  const t: Tone = tone ?? (value > 0 ? 'up' : value < 0 ? 'down' : 'neutral');
  const cls = t === 'up' ? 'text-up' : t === 'down' ? 'text-down' : t === 'warn' ? 'text-warn' : 'text-ink-dim';
  return (
    <span className={`tnum ${cls}`}>
      {value > 0 ? '▲ ' : value < 0 ? '▼ ' : '· '}
      {format(Math.abs(value))}
    </span>
  );
}
