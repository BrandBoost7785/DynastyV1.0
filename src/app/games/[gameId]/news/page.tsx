'use client';

/**
 * News and events.
 *
 * The world's own record of what happened and what is still happening: indicators, live
 * shocks, active events with their remaining duration, and the news feed the simulation
 * writes as it runs. Nothing is summarised into prose the server did not produce — the
 * reading is the point.
 */
import { useState } from 'react';
import { useView } from '../../../../lib/game-context';
import { ViewPanel } from '../../../../components/game/view-panel';
import { Sparkline } from '../../../../components/game/charts';
import { Badge, Delta, KeyValue, Panel, Select, Table, Tabs, Td, Th, Tr } from '../../../../components/ui/primitives';
import { humanise, money, num, pct } from '../../../../lib/format';
import type { ProfileView, WorldView } from '../../../../lib/game-data';

type Tab = 'feed' | 'events' | 'indicators' | 'notifications';

const SEVERITY_TONE: Record<string, 'down' | 'warn' | 'info' | 'up'> = { critical: 'down', severe: 'down', major: 'warn', moderate: 'warn', minor: 'info', positive: 'up' };

export default function NewsPage() {
  const [tab, setTab] = useState<Tab>('feed');
  const world = useView<WorldView>('world');
  const notifications = world.data?.world.news.filter((item) => !item.read).length ?? 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Intelligence</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">News &amp; events</h1>
          <p className="mt-1 text-xs text-ink-dim">
            {world.data ? `${world.data.world.news.length} stories · ${world.data.world.activeEvents.length} active events · cycle ${world.data.indicators.cyclePhaseLabel}` : 'Reading the wires…'}
          </p>
        </div>
        <Tabs
          label="News sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'feed', label: 'Feed', count: world.data?.world.news.length },
            { id: 'events', label: 'Active events', count: world.data?.world.activeEvents.length },
            { id: 'indicators', label: 'Indicators' },
            { id: 'notifications', label: 'Your alerts', count: notifications || undefined },
          ]}
        />
      </header>

      {tab === 'feed' && <Feed />}
      {tab === 'events' && <Events />}
      {tab === 'indicators' && <Indicators />}
      {tab === 'notifications' && <Notifications />}
    </div>
  );
}

function Feed() {
  const [scope, setScope] = useState('');
  const [category, setCategory] = useState('');
  const world = useView<WorldView>('world');

  const all = world.data?.world.news ?? [];
  const scopes = [...new Set(all.map((item) => item.scope))];
  const categories = [...new Set(all.map((item) => item.category))];
  const items = all.filter((item) => (!scope || item.scope === scope) && (!category || item.category === category));

  return (
    <ViewPanel<WorldView>
      view="world"
      title="World feed"
      subtitle={`${items.length} of ${all.length} stories`}
      isEmpty={(data) => data.world.news.length === 0}
      emptyTitle="The wires are quiet"
      emptyBody="No news has been generated for this save yet. Advance time — events fire, prices move and the feed fills."
      actions={
        <>
          <Select aria-label="Scope" value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="">All scopes</option>
            {scopes.map((item) => (
              <option key={item} value={item}>
                {humanise(item)}
              </option>
            ))}
          </Select>
          <Select aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {humanise(item)}
              </option>
            ))}
          </Select>
        </>
      }
    >
      {() => (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="tnum text-[11px] text-ink-faint">day {item.day}</span>
                <Badge tone="neutral">{humanise(item.category)}</Badge>
                <Badge tone="info">{humanise(item.scope)}</Badge>
                {item.locationId && <span className="text-[11px] text-ink-faint">{item.locationId}</span>}
                {!item.read && <Badge tone="gold">new</Badge>}
              </div>
              <h3 className="mt-1 text-sm font-medium text-ink">{item.headline}</h3>
              {item.body && <p className="mt-0.5 text-xs text-ink-dim">{item.body}</p>}
            </li>
          ))}
        </ul>
      )}
    </ViewPanel>
  );
}

function Events() {
  const world = useView<WorldView>('world');
  const data = world.data;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ViewPanel<WorldView>
        view="world"
        title="Active events"
        subtitle="Live conditions with remaining duration where the server knows it"
        isEmpty={(payload) => payload.world.activeEvents.length === 0}
        emptyTitle="Nothing unusual is happening"
        emptyBody="No shocks or events are currently active. Prices still move on supply, demand and season."
      >
        {(payload) => (
          <ul className="space-y-3">
            {payload.world.activeEvents.map((event) => (
              <li key={event.id} className="rounded border border-line bg-panel-2/40 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-ink">{event.name}</h3>
                  <Badge tone={SEVERITY_TONE[event.severity] ?? 'info'}>{event.severity}</Badge>
                </div>
                <p className="mt-1 text-xs text-ink-dim">{event.description}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
                  <KeyValue label="Scope">{humanise(event.scope)}</KeyValue>
                  <KeyValue label="Started">day {event.startedDay}</KeyValue>
                  <KeyValue label="Ends">{event.expiresDay === null ? 'while conditions last' : `day ${event.expiresDay}`}</KeyValue>
                  <KeyValue label="Chain depth">{event.chainDepth}</KeyValue>
                </dl>
                {event.appliedEffects.length > 0 && (
                  <p className="mt-1 text-[11px] text-ink-faint">Effects in play: {event.appliedEffects.map(humanise).join(', ')}</p>
                )}
                {(event.locationIds.length > 0 || event.regionIds.length > 0) && (
                  <p className="mt-1 text-[11px] text-ink-faint">
                    {event.locationIds.length > 0 && `${event.locationIds.length} location(s)`}
                    {event.locationIds.length > 0 && event.regionIds.length > 0 && ' · '}
                    {event.regionIds.length > 0 && event.regionIds.map(humanise).join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </ViewPanel>

      <ViewPanel<WorldView>
        view="world"
        title="Price and demand shocks"
        isEmpty={(payload) => payload.world.shocks.length === 0}
        emptyTitle="No price shocks active"
        emptyBody="Supply and demand are moving prices without a shock on top."
      >
        {(payload) => (
          <ul className="space-y-3">
            {payload.world.shocks.map((shock) => (
              <li key={shock.id} className="rounded border border-line bg-panel-2/40 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-ink">{shock.name}</h3>
                  <Badge tone={SEVERITY_TONE[shock.severity] ?? 'warn'}>{shock.severity}</Badge>
                </div>
                <p className="text-[11px] text-ink-faint">
                  {humanise(shock.scope)} · day {shock.startedDay} → {shock.expiresDay ?? 'open ended'}
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <ModifierList label="Price" modifiers={shock.priceModifiers} />
                  <ModifierList label="Demand" modifiers={shock.demandModifiers} />
                  <ModifierList label="Supply" modifiers={shock.supplyModifiers} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </ViewPanel>
      {data ? null : null}
    </div>
  );
}

function ModifierList({ label, modifiers }: { label: string; modifiers: Record<string, number> }) {
  const entries = Object.entries(modifiers);
  return (
    <div>
      <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">{label}</p>
      {entries.length === 0 ? (
        <p className="text-[11px] text-ink-faint">—</p>
      ) : (
        <ul className="mt-0.5 space-y-0.5">
          {entries.slice(0, 6).map(([key, value]) => (
            <li key={key} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="truncate text-ink-dim">{humanise(key)}</span>
              <span className={`tnum ${value >= 0 ? 'text-up' : 'text-down'}`}>{pct(value, { from: 'fraction', sign: true, decimals: 0 })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Indicators() {
  const world = useView<WorldView>('world');
  const indicators = world.data?.indicators;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title="Macro indicators" subtitle="What the world economy is doing right now">
        {!indicators ? (
          <p className="text-xs text-ink-faint">Loading indicators…</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <KeyValue label="Cycle phase">{indicators.cyclePhaseLabel}</KeyValue>
            <KeyValue label="Inflation (YoY)">{pct(indicators.inflationYoY, { from: 'fraction', decimals: 2 })}</KeyValue>
            <KeyValue label="Interest rate">{pct(indicators.interestRate, { from: 'fraction', decimals: 2 })}</KeyValue>
            <KeyValue label="Unemployment">{pct(indicators.unemployment, { from: 'fraction', decimals: 1 })}</KeyValue>
            <KeyValue label="Consumer confidence">{num(indicators.consumerConfidence, 1)}</KeyValue>
            <KeyValue label="GDP growth">{pct(indicators.gdpGrowth, { from: 'fraction', decimals: 2 })}</KeyValue>
            <KeyValue label="Commodity price index">{num(indicators.averageCommodityPriceIndex, 2)}</KeyValue>
            <KeyValue label="Trade volume (30d)">{money(indicators.tradeVolume30d, { compact: true })}</KeyValue>
            <KeyValue label="Stock index (30d)">
              <Delta value={indicators.stockIndexChange30d} format={(n) => pct(n, { from: 'fraction', sign: true, decimals: 1 })} />
            </KeyValue>
            <KeyValue label="Crypto index (30d)">
              <Delta value={indicators.cryptoIndexChange30d} format={(n) => pct(n, { from: 'fraction', sign: true, decimals: 1 })} />
            </KeyValue>
            <KeyValue label="Risk appetite">{pct(indicators.globalRiskAppetite, { from: 'fraction', decimals: 0 })}</KeyValue>
          </dl>
        )}
      </Panel>

      <ViewPanel<WorldView> view="world" title="Index history" subtitle="Day-by-day levels recorded by the simulation">
        {(payload) => (
          <div className="space-y-4">
            <div>
              <h3 className="mb-1 text-xs font-semibold text-ink-dim">Stock index</h3>
              <Sparkline points={payload.world.stockIndexHistory} label="Stock index" tone="gold" />
            </div>
            <div>
              <h3 className="mb-1 text-xs font-semibold text-ink-dim">Crypto index</h3>
              <Sparkline points={payload.world.cryptoIndexHistory} label="Crypto index" tone="violet" />
            </div>
            <p className="text-[11px] text-ink-faint">History accrues one point per simulated day; a brand-new save has a single observation.</p>
          </div>
        )}
      </ViewPanel>
    </div>
  );
}

function Notifications() {
  return (
    <ViewPanel<ProfileView>
      view="profile"
      title="Your alerts"
      subtitle="Server-generated notices about your own affairs"
      isEmpty={(data) => data.player.notifications.length === 0}
      emptyTitle="Nothing needs your attention"
      emptyBody="Employer, lender, tax office and crew notices appear here as they happen during simulated days."
    >
      {(data) => (
        <Table label="Notifications">
          <thead>
            <tr>
              <Th>Day</Th>
              <Th>Kind</Th>
              <Th>Notice</Th>
              <Th align="right">Read</Th>
            </tr>
          </thead>
          <tbody>
            {data.player.notifications.map((notice) => (
              <Tr key={notice.id}>
                <Td className="tnum text-xs">{notice.day}</Td>
                <Td>
                  <Badge tone={notice.kind === 'danger' || notice.kind === 'warning' ? 'warn' : 'info'}>{humanise(notice.kind)}</Badge>
                </Td>
                <Td>
                  <span className="text-sm text-ink">{notice.title}</span>
                  <span className="block text-xs text-ink-dim">{notice.body}</span>
                </Td>
                <Td align="right" className="text-xs text-ink-faint">{notice.read ? 'read' : 'unread'}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </ViewPanel>
  );
}

