/**
 * Formatting helpers.
 *
 * Pure display arithmetic only. Nothing here derives a game value: every input is a
 * number the server already decided, and these functions only choose how to render it.
 */

/** The game's currency. `¤` keeps the sim's abstract credit distinct from any real one. */
export const CURRENCY = '¤';

/** Compact currency for headers and chips: `¤4.2K`, `¤1.4M`. */
export function money(value: number | null | undefined, opts: { compact?: boolean; decimals?: number; sign?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const { compact = false, decimals, sign = false } = opts;
  const prefix = sign && value > 0 ? '+' : value < 0 ? '−' : '';
  const abs = Math.abs(value);
  if (compact && abs >= 1000) {
    const units: [number, string][] = [
      [1e12, 'T'],
      [1e9, 'B'],
      [1e6, 'M'],
      [1e3, 'K'],
    ];
    for (const [scale, suffix] of units) {
      if (abs >= scale) {
        const scaled = abs / scale;
        return `${prefix}${CURRENCY}${scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2)}${suffix}`;
      }
    }
  }
  const dp = decimals ?? (abs < 10 ? 2 : abs < 1000 ? 2 : 0);
  return `${prefix}${CURRENCY}${abs.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

/** A plain number with sensible grouping. */
export function num(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Compact count: `12.4K`. */
export function compact(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(decimals)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(decimals)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(decimals)}K`;
  return `${sign}${abs.toFixed(abs < 10 && abs % 1 !== 0 ? 1 : 0)}`;
}

/** A percentage from either a fraction (0.18) or an already-scaled value (18). */
export function pct(value: number | null | undefined, opts: { from?: 'fraction' | 'percent'; decimals?: number; sign?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const { from = 'percent', decimals = 1, sign = false } = opts;
  const scaled = from === 'fraction' ? value * 100 : value;
  const prefix = sign && scaled > 0 ? '+' : scaled < 0 ? '−' : '';
  return `${prefix}${Math.abs(scaled).toFixed(decimals)}%`;
}

/** Quantity with a unit label: `11 piece`. */
export function qty(value: number | null | undefined, unit?: string | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = Math.abs(value) < 1 && value !== 0 ? value.toFixed(3) : num(value, value % 1 === 0 ? 0 : 2);
  return unit ? `${rounded} ${unit}` : rounded;
}

/** Weight or volume with a sensible unit, from kilograms or litres. */
export function mass(kg: number | null | undefined): string {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return '—';
  const abs = Math.abs(kg);
  if (abs >= 1000) return `${num(kg / 1000, 2)} t`;
  if (abs >= 1) return `${num(kg, 1)} kg`;
  return `${num(kg * 1000, 0)} g`;
}

export function volume(litres: number | null | undefined): string {
  if (litres === null || litres === undefined || !Number.isFinite(litres)) return '—';
  const abs = Math.abs(litres);
  if (abs >= 1000) return `${num(litres / 1000, 2)} m³`;
  if (abs >= 1) return `${num(litres, 1)} L`;
  return `${num(litres * 1000, 0)} mL`;
}

/** A 0…1 value as a whole-percent bar label. */
export function ratio(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(decimals)}%`;
}

/** Tone for a signed number, so the same rule colours every screen. */
export function deltaTone(value: number | null | undefined): 'up' | 'down' | 'flat' {
  if (value === null || value === undefined || !Number.isFinite(value) || Math.abs(value) < 1e-9) return 'flat';
  return value > 0 ? 'up' : 'down';
}

/** `1 day`, `3 days`. */
export function days(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${num(value, 0)} ${Math.abs(value) === 1 ? 'day' : 'days'}`;
}

/** An ISO timestamp as a short local date-time. */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** `2h ago` style age, for news and audit rows. */
export function age(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** `weapon_grade` → `Weapon grade`. */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  const spaced = value.replace(/[_.]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Shorten an id for display without losing which record it is: `stack_armmmpc` → `…mmmpc`. */
export function shortId(id: string | null | undefined, tail = 5): string {
  if (!id) return '—';
  return id.length <= tail + 1 ? id : `…${id.slice(-tail)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Tailwind text-colour class for a tone. */
export function toneClass(tone: 'up' | 'down' | 'flat' | 'warn' | 'info' | 'muted'): string {
  switch (tone) {
    case 'up':
      return 'text-up';
    case 'down':
      return 'text-down';
    case 'warn':
      return 'text-warn';
    case 'info':
      return 'text-info';
    case 'muted':
      return 'text-ink-faint';
    default:
      return 'text-ink-dim';
  }
}
