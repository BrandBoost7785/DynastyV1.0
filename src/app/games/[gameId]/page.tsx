'use client';

/**
 * Dashboard — the strategic command centre.
 *
 * Answers, in order: where am I, what am I worth, what can I do about it, what is
 * happening in the world, and what needs attention. Every figure is a server projection;
 * the "next actions" list is derived only from things the server reported (unpaid wages,
 * a blocked production line, a live encounter, unsent capacity, unspent points) and each
 * entry links to the screen that can act on it.
 */
import { useMemo } from 'react';
import Link from 'next/link';
import { useGame, usePurse, useView } from '../../../lib/game-context';
import { gameHref } from '../../../components/game/nav';
import { ViewPanel } from '../../../components/game/view-panel';
import { Badge, Button, Delta, KeyValue, Meter, Panel, Stat, Table, Td, Th, Tr } from '../../../components/ui/primitives';
import { EmptyState, InlineNote } from '../../../components/ui/states';
import { Icon } from '../../../components/ui/icons';
import { days, humanise, mass, money, num, pct, ratio, volume } from '../../../lib/format';
import type {
  BusinessesView,
  CrewView,
  FinanceView,
  InventoryView,
  LedgerView,
  LocationView,
  MarketView,
  MissionsView,
  ProductionView,
  ProfileView,
  WorldView,
} from '../../../lib/game-data';

export default function DashboardPage() {
  const { gameId, state, game } = useGame();
  const { cash } = usePurse();
  const market = useView<MarketView>('market', { limit: 60 });
  const location = useView<LocationView>('location');
  const ledger = useView<LedgerView>('ledger', { limit: 8 });
  const netWorth = state?.netWorth;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Command centre</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">
            Day {num(state?.world.day ?? 0)} · {location.data?.name ?? '—'}
          </h1>
          <p className="mt-1 text-xs text-ink-dim">
            {location.data ? `${location.data.region}, ${location.data.country}` : 'Loading location…'}
            {location.data?.lockdown ? ' · under lockdown' : ''}
          </p>
        </div>
        {game && (
          <div className="text-right text-xs text-ink-faint">
            <p>{game.meta.title} · level {game.meta.level}</p>
            <p className="tnum">Empire score {num(game.meta.empireScore, 0)}</p>
          </div>
        )}
      </header>

      {/* Financial position */}
      <section aria-label="Financial position" className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Stat label="Available cash" value={money(cash)} icon={<Icon.Wallet size={15} />} />
        <Stat label="Net worth" value={money(netWorth?.total ?? 0)} icon={<Icon.Scale size={15} />} />
        <Stat label="Debt" value={money(netWorth?.debts ?? 0)} tone={(netWorth?.debts ?? 0) > 0 ? 'warn' : 'default'} />
        <Stat label="Actions left" value={`${num(state?.player.stats.actionsToday ?? 0)}/${num(state?.player.stats.maxActionsPerDay ?? 0)}`} icon={<Icon.Clock size={15} />} />
        <Stat label="Location heat" value={ratio(location.data?.playerHeat ?? 0, 0)} tone={(location.data?.playerHeat ?? 0) > 0.5 ? 'warn' : 'default'} />
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <NextActions />

          {/* Market opportunities — the server's own screening, not ours */}
          <ViewPanel<MarketView>
            view="market"
            params={{ limit: 60 }}
            title="Local market signal"
            subtitle={market.data ? `${market.data.summary.name} · ${market.data.summary.tradedCount} traded goods · enforcement ${ratio(market.data.summary.enforcement, 0)}` : undefined}
            actions={
              <Link href={gameHref(gameId, 'market')} className="text-xs text-gold hover:underline">
                Open market →
              </Link>
            }
          >
            {(data) => (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <Screener title="Cheapest here" tone="up" rows={data.summary.cheapest.map((row) => ({ name: row.name, value: pct(row.premiumPct ?? 0, { from: 'fraction', sign: true }) }))} />
                  <Screener title="Dearest here" tone="down" rows={data.summary.dearest.map((row) => ({ name: row.name, value: pct(row.premiumPct ?? 0, { from: 'fraction', sign: true }) }))} />
                  <Screener title="Most volatile" tone="warn" rows={data.summary.mostVolatile.map((row) => ({ name: row.name, value: pct(row.volatilityPct ?? 0, { decimals: 1 }) }))} />
                </div>
                <Table label="Biggest movers today">
                  <thead>
                    <tr>
                      <Th>Mover</Th>
                      <Th align="right">Price</Th>
                      <Th align="right">1 day</Th>
                      <Th align="right">Held</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.summary.biggestMovers1d.slice(0, 6).map((mover) => {
                      const row = data.rows.find((candidate) => candidate.commodityId === mover.commodityId);
                      return (
                        <Tr key={mover.commodityId}>
                          <Td className="text-xs">{mover.name}</Td>
                          <Td align="right" className="tnum">{money(row?.price ?? 0)}</Td>
                          <Td align="right">
                            <Delta value={mover.changePct ?? 0} format={(n) => pct(n, { sign: true })} />
                          </Td>
                          <Td align="right" className="tnum">{num(row?.onHand ?? 0)}</Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            )}
          </ViewPanel>

          {/* Holdings */}
          <ViewPanel<InventoryView>
            view="inventory"
            title="What you are carrying"
            subtitle="Capacity is per storage unit; the binding constraint is named, not averaged."
            actions={<Link href={gameHref(gameId, 'inventory')} className="text-xs text-gold hover:underline">Manage inventory →</Link>}
            isEmpty={(data) => data.rows.length === 0}
            emptyTitle="No goods in hand"
            emptyBody="You are not carrying anything. Buy a cargo in the market — a city that produces a good sells it cheap, and a city that needs it pays more."
          >
            {(data) => (
              <div className="space-y-4">
                {data.storages.slice(0, 2).map((storage) => (
                  <div key={storage.storage.id} className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-ink">
                        {storage.storage.name}
                        <span className="ml-2 text-ink-faint">{humanise(storage.storage.kind)}</span>
                      </span>
                      <span className="tnum text-ink-faint">{money(storage.value)} held</span>
                    </div>
                    <Meter
                      label={`Weight · ${mass(storage.usage.kg)} of ${mass(storage.usage.kgCapacity)}`}
                      display={ratio(storage.usage.kgUtilisation, 0)}
                      value={storage.usage.kgUtilisation}
                      tone="gold"
                    />
                    <Meter
                      label={`Volume · ${volume(storage.usage.litres)} of ${volume(storage.usage.litresCapacity)}`}
                      display={ratio(storage.usage.litresUtilisation, 0)}
                      value={storage.usage.litresUtilisation}
                      tone="info"
                    />
                    <p className="text-[11px] text-ink-faint">
                      Binding constraint: <span className="text-ink-dim">{storage.usage.bindingConstraint}</span>
                    </p>
                  </div>
                ))}
                {data.rows.length > 0 && (
                  <Table label="Held stacks">
                    <thead>
                      <tr>
                        <Th>Good</Th>
                        <Th align="right">Qty</Th>
                        <Th align="right">Value</Th>
                        <Th align="right">Unrealised</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.slice(0, 6).map((row) => (
                        <Tr key={row.stackId}>
                          <Td className="text-xs">
                            {row.name}
                            {row.concealed && <Badge tone="violet" className="ml-1.5">concealed</Badge>}
                          </Td>
                          <Td align="right" className="tnum">{num(row.qty)}</Td>
                          <Td align="right" className="tnum">{money(row.marketValue)}</Td>
                          <Td align="right">
                            <Delta value={row.unrealisedPnl} format={(n) => money(n)} />
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </div>
            )}
          </ViewPanel>

          <ViewPanel<MissionsView>
            view="missions"
            title="Contracts"
            subtitle="Offers refresh on the server's schedule; deadlines are real."
            actions={<Link href={gameHref(gameId, 'missions')} className="text-xs text-gold hover:underline">Mission board →</Link>}
            isEmpty={(data) => data.offers.length === 0 && data.active.length === 0}
            emptyTitle="No contracts available"
            emptyBody="The board refreshes every few days. Until then, trading and production are the reliable income."
          >
            {(data) => (
              <ul className="space-y-2">
                {[...data.active, ...data.offers].slice(0, 4).map((mission) => (
                  <li key={mission.id} className="rounded border border-line bg-panel-2/50 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink">{mission.title}</span>
                      <div className="flex items-center gap-2 text-xs">
                        <Badge tone={mission.status === 'active' ? 'info' : 'neutral'}>{mission.status}</Badge>
                        <span className="tnum text-up">{money(mission.rewardCash)}</span>
                        <span className="tnum text-ink-faint">{mission.rewardXp} XP</span>
                        {mission.daysRemaining <= 2 && <Badge tone="warn">{days(mission.daysRemaining)} left</Badge>}
                      </div>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-dim">{mission.description}</p>
                    {mission.objectives.length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {mission.objectives.map((objective) => (
                          <Meter
                            key={objective.id}
                            label={objective.description}
                            display={`${objective.current}/${objective.required}`}
                            value={objective.required > 0 ? objective.current / objective.required : 0}
                            tone="up"
                            height={4}
                          />
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </ViewPanel>
        </div>

        <div className="space-y-4">
          {/* World status */}
          <ViewPanel<WorldView> view="world" title="World status" staleTime={60_000}>
            {(data) => (
              <div className="space-y-3">
                <dl>
                  <KeyValue label="Cycle">{data.indicators.cyclePhaseLabel}</KeyValue>
                  <KeyValue label="Inflation (YoY)">{pct(data.indicators.inflationYoY, { from: 'fraction' })}</KeyValue>
                  <KeyValue label="Base rate">{pct(data.indicators.interestRate, { from: 'fraction' })}</KeyValue>
                  <KeyValue label="Stock index 30d">
                    <Delta value={data.indicators.stockIndexChange30d} format={(n) => pct(n, { from: 'fraction' })} />
                  </KeyValue>
                  <KeyValue label="Crypto index 30d">
                    <Delta value={data.indicators.cryptoIndexChange30d} format={(n) => pct(n, { from: 'fraction' })} />
                  </KeyValue>
                </dl>
                {data.world.activeEvents.length > 0 ? (
                  <ul className="space-y-1.5">
                    {data.world.activeEvents.slice(0, 3).map((event) => (
                      <li key={event.id} className="rounded border border-line bg-panel-2/40 px-2.5 py-1.5">
                        <div className="flex items-center gap-2">
                          <Badge tone={event.severity === 'major' ? 'down' : event.severity === 'moderate' ? 'warn' : 'info'}>{event.severity}</Badge>
                          <span className="text-xs font-medium text-ink">{event.name}</span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-ink-dim">{event.appliedEffects[0] ?? event.description}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-ink-faint">No active events. Conditions are quiet.</p>
                )}
                <Link href={gameHref(gameId, 'news')} className="block text-xs text-gold hover:underline">
                  All news and events →
                </Link>
              </div>
            )}
          </ViewPanel>

          {/* Empire alerts */}
          <EmpireAlerts />

          {/* Recent activity */}
          <ViewPanel<LedgerView>
            view="ledger"
            params={{ limit: 8 }}
            title="Recent ledger"
            subtitle={ledger.data ? `${ledger.data.total} entries on record` : undefined}
            isEmpty={(data) => data.rows.length === 0}
            emptyTitle="No transactions yet"
            emptyBody="Your bank ledger fills as you trade, pay wages and settle debts."
          >
            {(data) => (
              <ul className="divide-y divide-line text-xs">
                {[...data.rows].reverse().map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-2 py-1.5">
                    <div className="min-w-0">
                      <p className="truncate text-ink">{row.description}</p>
                      <p className="text-[11px] text-ink-faint">
                        Day {row.day} · {humanise(row.kind)}
                      </p>
                    </div>
                    <span className={`tnum shrink-0 ${row.amount >= 0 ? 'text-up' : 'text-down'}`}>{money(row.amount, { sign: true })}</span>
                  </li>
                ))}
              </ul>
            )}
          </ViewPanel>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Contextual next actions                                             */
/* ------------------------------------------------------------------ */

function NextActions() {
  const { gameId, state } = useGame();
  const crew = useView<CrewView>('crew');
  const production = useView<ProductionView>('production', {}, { staleTime: 30_000 });
  const businesses = useView<BusinessesView>('businesses', {}, { staleTime: 30_000 });
  const finance = useView<FinanceView>('finance');
  const missions = useView<MissionsView>('missions');

  const actions = useMemo(() => {
    const list: { tone: 'down' | 'warn' | 'info' | 'gold'; label: string; detail: string; href: string }[] = [];
    const combat = state?.player.combat;
    if (combat && combat.phase === 'active') {
      list.push({ tone: 'down', label: 'Finish the encounter', detail: 'A fight is live. Time cannot pass until it is resolved.', href: gameHref(gameId, 'combat') });
    }
    const crewData = crew.data;
    if (crewData && crewData.summary.unpaidWages > 0) {
      list.push({
        tone: 'down',
        label: `Pay ${money(crewData.summary.unpaidWages)} of unpaid wages`,
        detail: 'Unpaid crew lose morale and can walk out — or worse, talk.',
        href: gameHref(gameId, 'crew'),
      });
    }
    const blocked = production.data?.supplyChain.blocked ?? 0;
    if (blocked > 0) {
      list.push({ tone: 'warn', label: `${blocked} production line(s) blocked`, detail: 'Inputs are short or a line has broken down.', href: gameHref(gameId, 'production') });
    }
    const suspended = businesses.data?.portfolio.suspended ?? 0;
    if (suspended > 0) {
      list.push({ tone: 'warn', label: `${suspended} business(es) suspended`, detail: 'Suspended ventures generate no revenue but still cost you.', href: gameHref(gameId, 'businesses') });
    }
    const dueSoon = missions.data?.active.filter((mission) => mission.daysRemaining <= 2) ?? [];
    if (dueSoon.length > 0) {
      list.push({ tone: 'warn', label: `${dueSoon.length} contract(s) due within 2 days`, detail: dueSoon.map((mission) => mission.title).join(', '), href: gameHref(gameId, 'missions') });
    }
    const arrears = finance.data?.finance.tax.arrears ?? 0;
    if (arrears > 0) {
      list.push({ tone: 'warn', label: `${money(arrears)} of tax arrears`, detail: 'Arrears accrue penalties and raise audit risk.', href: gameHref(gameId, 'finance') });
    }
    const points = state?.player.progression.skillPoints ?? 0;
    const perkPoints = state?.player.progression.perkPoints ?? 0;
    if (points > 0 || perkPoints > 0) {
      list.push({
        tone: 'gold',
        label: `${points} skill point(s) and ${perkPoints} perk point(s) unspent`,
        detail: 'Unspent points do nothing for you.',
        href: gameHref(gameId, 'progression'),
      });
    }
    const cash = state?.player.accounts.reduce((sum, account) => sum + account.balance, 0) ?? 0;
    if (list.length === 0 && cash > 0 && (state?.player.inventory.length ?? 0) === 0) {
      list.push({ tone: 'info', label: 'Buy your first cargo', detail: 'A city that produces a good sells it cheap; somewhere else pays more.', href: gameHref(gameId, 'market') });
    }
    return list;
  }, [businesses.data, crew.data, finance.data, gameId, missions.data, production.data, state]);

  if (actions.length === 0) {
    return (
      <Panel title="Next actions">
        <p className="text-xs text-ink-dim">
          Nothing needs your attention right now. Nothing is broken, nothing is unpaid and no deadline is close — a good moment to scout new cities, open a
          business or let time pass.
        </p>
      </Panel>
    );
  }

  const tones = { down: 'border-down/40 bg-down-soft/30', warn: 'border-warn/40 bg-warn-soft/30', info: 'border-info/40 bg-info-soft/30', gold: 'border-gold/40 bg-gold/10' };
  return (
    <Panel title="Next actions" subtitle="Derived from what the server reports about your empire — not from guesswork.">
      <ul className="space-y-2">
        {actions.map((action) => (
          <li key={action.label} className={`rounded border px-3 py-2 ${tones[action.tone]}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{action.label}</p>
                <p className="text-xs text-ink-dim">{action.detail}</p>
              </div>
              <Link href={action.href}>
                <Button size="sm" variant="secondary">
                  Open
                </Button>
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function EmpireAlerts() {
  const { gameId } = useGame();
  const crew = useView<CrewView>('crew');
  const businesses = useView<BusinessesView>('businesses', {}, { staleTime: 30_000 });
  const production = useView<ProductionView>('production', {}, { staleTime: 30_000 });
  const profile = useView<ProfileView>('profile', { notifications: 6 });

  const loading = !crew.data && !businesses.data && !production.data;
  const anything =
    (crew.data?.summary.headcount ?? 0) > 0 ||
    (businesses.data?.businesses.length ?? 0) > 0 ||
    (production.data?.lines.length ?? 0) > 0 ||
    (profile.data?.player.notifications.length ?? 0) > 0;

  return (
    <Panel title="Empire" subtitle="Headcount, ventures and the last things the world told you.">
      {loading ? (
        <p className="text-xs text-ink-faint">Loading…</p>
      ) : !anything ? (
        <EmptyState
          title="No ventures yet"
          body="Hire crew, buy a property and open a business to turn cash into daily income — or keep trading, which needs none of it."
          action={
            <Link href={gameHref(gameId, 'businesses')}>
              <Button size="sm" variant="secondary">
                Browse business types
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Crew" value={num(crew.data?.summary.headcount ?? 0)} compact hint={`${money(crew.data?.payrollForecastPerDay ?? 0)}/day payroll`} />
            <Stat
              label="Ventures"
              value={num(businesses.data?.businesses.length ?? 0)}
              compact
              hint={`${money(businesses.data?.portfolio.dailyProfit ?? 0, { sign: true })}/day`}
              tone={(businesses.data?.portfolio.dailyProfit ?? 0) >= 0 ? 'up' : 'down'}
            />
            <Stat label="Production lines" value={num(production.data?.lines.length ?? 0)} compact hint={`${num(production.data?.supplyChain.running ?? 0)} running`} />
            <Stat
              label="Output/day"
              value={money(production.data?.supplyChain.outputValuePerDay ?? 0, { compact: true })}
              compact
              hint={`cost ${money(production.data?.supplyChain.costPerDay ?? 0, { compact: true })}`}
            />
          </div>

          {(crew.data?.summary.highestRisk.length ?? 0) > 0 && (
            <div>
              <h3 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Crew risk</h3>
              <ul className="mt-1 space-y-1">
                {crew.data!.summary.highestRisk.slice(0, 3).map((risk) => (
                  <li key={risk.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-ink-dim">
                      {risk.name} — {risk.reason}
                    </span>
                    <Badge tone={risk.risk > 0.6 ? 'down' : 'warn'}>{pct(risk.risk, { from: 'fraction', decimals: 0 })}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(profile.data?.player.notifications.length ?? 0) > 0 && (
            <div>
              <h3 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Latest notices</h3>
              <ul className="mt-1 space-y-1">
                {[...(profile.data?.player.notifications ?? [])]
                  .slice(-3)
                  .reverse()
                  .map((notification) => (
                    <li key={notification.id} className="text-xs">
                      <span className="text-ink">{notification.title}</span> <span className="text-ink-faint">— {notification.body}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {crew.data && crew.data.summary.unpaidWages === 0 && crew.data.summary.headcount > 0 && (
            <InlineNote tone="up">Payroll is current. Crew morale averages {pct(crew.data.summary.averageMorale, { from: 'fraction', decimals: 0 })}.</InlineNote>
          )}
        </div>
      )}
    </Panel>
  );
}

function Screener({ title, rows, tone }: { title: string; rows: { name: string; value: string }[]; tone: 'up' | 'down' | 'warn' }) {
  return (
    <div className="rounded border border-line bg-panel-2/40 px-2.5 py-2">
      <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">{title}</h4>
      {rows.length === 0 ? (
        <p className="mt-1 text-xs text-ink-faint">No signal</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {rows.slice(0, 4).map((row) => (
            <li key={row.name} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-ink-dim">{row.name}</span>
              <span className={`tnum ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-warn'}`}>{row.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
