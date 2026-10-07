'use client';

/**
 * Charts, drawn from server history only.
 *
 * Every series here comes from a read model that already stores day-by-day history; when
 * a save is new, the series has one point and the chart says so instead of drawing an
 * invented trend. No smoothing, no synthetic baseline.
 */
import { useMemo, useState } from 'react';
import { compact, money, num, pct } from '../../lib/format';

export interface SeriesPoint {
  day: number;
  level: number;
}

export function Sparkline({
  points,
  label,
  tone = 'gold',
  height = 34,
  format = (value: number) => num(value, 2),
}: {
  points: SeriesPoint[];
  label: string;
  tone?: 'gold' | 'up' | 'down' | 'info' | 'violet';
  height?: number;
  format?: (value: number) => string;
}) {
  if (points.length < 2) {
    return (
      <p className="text-[11px] text-ink-faint">
        {points.length === 1 ? `One day of ${label.toLowerCase()} recorded — a trend needs at least two.` : `No ${label.toLowerCase()} history yet.`}
      </p>
    );
  }
  const stroke: Record<string, string> = { gold: 'var(--color-gold)', up: 'var(--color-up)', down: 'var(--color-down)', info: 'var(--color-info)', violet: 'var(--color-violet)' };
  const values = points.map((point) => point.level);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 100;
      const y = 100 - ((point.level - min) / span) * 100;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  return (
    <figure className="w-full">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={`${label}: from ${format(first)} to ${format(last)} over ${points.length} days`}>
        <path d={`${path} L100,100 L0,100 Z`} fill={`var(--color-gold)`} opacity={0.08} />
        <path d={path} fill="none" stroke={stroke[tone]} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="mt-1 flex items-baseline justify-between text-[11px] text-ink-faint">
        <span>
          day {points[0]?.day} → {points[points.length - 1]?.day}
        </span>
        <span className="tnum">
          {format(first)} → <span className={last >= first ? 'text-up' : 'text-down'}>{format(last)}</span> ({pct(first !== 0 ? (last - first) / Math.abs(first) : 0, { from: 'fraction', sign: true, decimals: 1 })})
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * Net-worth composition over time.
 *
 * Stacked areas for the asset classes the save records, with debt drawn as a line below
 * zero so the shape of the balance sheet is honest: total can rise while cash falls.
 */
export function NetWorthChart({
  history,
  height = 180,
}: {
  history: { day: number; total: number; cash: number; inventory: number; properties: number; businesses: number; stocks: number; crypto: number; vehicles: number; debt: number }[];
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const bands = [
    { key: 'cash', label: 'Cash', colour: 'var(--color-up)' },
    { key: 'inventory', label: 'Inventory', colour: 'var(--color-gold)' },
    { key: 'properties', label: 'Properties', colour: 'var(--color-info)' },
    { key: 'businesses', label: 'Businesses', colour: 'var(--color-violet)' },
    { key: 'stocks', label: 'Stocks', colour: '#6ea8fe' },
    { key: 'crypto', label: 'Crypto', colour: '#c084fc' },
    { key: 'vehicles', label: 'Vehicles', colour: '#94a3b8' },
  ] as const;

  const geometry = useMemo(() => {
    if (history.length < 2) return null;
    const rows = history as unknown as (typeof history[number] & Record<string, number>)[];
    const totals = rows.map((point) => bands.reduce((sum, band) => sum + Math.max(0, point[band.key] ?? 0), 0));
    const max = Math.max(...totals, ...rows.map((point) => point.total)) * 1.05 || 1;
    const x = (index: number) => (index / (rows.length - 1)) * 100;
    const y = (value: number) => 100 - (value / max) * 100;
    let cumulative = rows.map(() => 0);
    const areas = bands.map((band) => {
      const lower = cumulative.slice();
      cumulative = cumulative.map((value, index) => value + Math.max(0, rows[index]?.[band.key] ?? 0));
      const upper = cumulative.slice();
      const top = upper.map((value, index) => `${x(index).toFixed(2)},${y(value).toFixed(2)}`);
      const bottom = lower.map((value, index) => `${x(index).toFixed(2)},${y(value).toFixed(2)}`).reverse();
      return { band, path: `M${top.join(' L')} L${bottom.join(' L')} Z` };
    });
    const debtPath = rows.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(-point.debt).toFixed(2)}`).join(' ');
    const totalPath = rows.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(point.total).toFixed(2)}`).join(' ');
    return { areas, debtPath, totalPath, max, x, y };
  }, [history]);

  if (!geometry) {
    return (
      <p className="text-xs text-ink-faint">
        {history.length === 1 ? 'One day of history so far — advance time and the balance sheet trend appears here.' : 'No history recorded for this save yet.'}
      </p>
    );
  }

  const first = history[0];
  const last = history[history.length - 1];
  const point = (hover === null ? last : history[hover]) ?? first;
  if (!first || !last || !point) return null;

  return (
    <figure>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={`Net worth from ${money(first.total)} on day ${first.day} to ${money(last.total)} on day ${last.day}`}>
        {geometry.areas.map((area) => (
          <path key={area.band.key} d={area.path} fill={area.band.colour} opacity={0.55} />
        ))}
        <path d={geometry.totalPath} fill="none" stroke="var(--color-ink)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        <path d={geometry.debtPath} fill="none" stroke="var(--color-down)" strokeWidth={1.2} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
        {hover !== null && (
          <line x1={geometry.x(hover)} y1={0} x2={geometry.x(hover)} y2={100} stroke="var(--color-ink-faint)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {bands.map((band) => (
          <span key={band.key} className="flex items-center gap-1 text-[11px] text-ink-faint">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: band.colour }} /> {band.label}
          </span>
        ))}
        <span className="flex items-center gap-1 text-[11px] text-ink-faint">
          <span className="inline-block h-0.5 w-3 bg-down" /> Debt {compact(point.debt)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Jump to a day">
        {history.slice(-8).map((entry, index) => {
          const absolute = history.length - Math.min(8, history.length) + index;
          return (
            <button key={entry.day} type="button" onClick={() => setHover(absolute)} className={`tnum rounded border px-2 py-0.5 text-[11px] ${hover === absolute ? 'border-gold text-gold' : 'border-line text-ink-faint hover:text-ink'}`}>
              d{entry.day}
            </button>
          );
        })}
      </div>
      <figcaption className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
        <span className="text-[11px] text-ink-faint">
          Day <span className="tnum text-ink-dim">{point.day}</span>
        </span>
        <span className="text-[11px] text-ink-faint">
          Net worth <span className="tnum text-ink">{money(point.total)}</span>
        </span>
        <span className="text-[11px] text-ink-faint">
          Debt <span className="tnum text-down">{money(point.debt)}</span>
        </span>
      </figcaption>
    </figure>
  );
}

/** A horizontal bar comparison from real numbers; used for reputation and standings. */
export function BarList({ items, format = (value: number) => num(value, 2) }: { items: { label: string; value: number; tone?: 'up' | 'down' | 'gold' }[]; format?: (value: number) => string }) {
  if (items.length === 0) return <p className="text-xs text-ink-faint">Nothing to compare yet.</p>;
  const max = Math.max(...items.map((item) => Math.abs(item.value))) || 1;
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-ink-dim">{item.label}</span>
            <span className="tnum text-ink">{format(item.value)}</span>
          </div>
          <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-panel-3">
            <div className={`h-full rounded-full ${item.tone === 'down' ? 'bg-down' : item.tone === 'up' ? 'bg-up' : 'bg-gold'}`} style={{ width: `${(Math.abs(item.value) / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
