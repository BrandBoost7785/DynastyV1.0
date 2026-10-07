'use client';

/**
 * The persistent game shell.
 *
 * Answers, on every screen, the four questions a strategy player keeps asking: where am
 * I, what day is it, how much money do I have, and what needs my attention. It also owns
 * the single most important action in the game — advancing time — with the day report
 * that comes back from it.
 *
 * The shell reads the authoritative projection out of `GameProvider`; it never computes
 * a game value. Cash is the sum of the server's account balances, net worth is the
 * server's own `netWorth` breakdown, and the day/turn counters are the save's.
 */
import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { NAV_GROUPS, activeSlug, gameHref } from './nav';
import { Icon } from '../ui/icons';
import { Badge, Button, Select, StatusDot, Tabs } from '../ui/primitives';
import { ErrorState, LoadingState } from '../ui/states';
import { Dialog } from '../ui/dialog';
import { useGame, useSession, useView } from '../../lib/game-context';
import { useToast } from '../ui/toast';
import { money, num, pct } from '../../lib/format';
import type { JourneyView, LocationView, WorldView } from '../../lib/game-data';
import type { DayReportDto, MultiDayReportDto } from '../../server/dto';
import { DayReport } from './day-report';

const ADVANCE_CHOICES = [1, 2, 3, 7, 14, 30];

export function GameShell({ children }: { children: React.ReactNode }) {
  const { gameId, game, state, meta, loading, error, refresh, advance, isPending } = useGame();
  const toast = useToast();
  const pathname = usePathname();
  /*
   * The mobile drawer remembers the pathname it was opened on, so navigating anywhere
   * closes it — derived rather than copied into state by an effect, which also means a
   * deep link can never leave a stale drawer open behind a new screen.
   */
  const [navOpenOn, setNavOpenOn] = useState<string | null>(null);
  const [days, setDays] = useState(1);
  const [report, setReport] = useState<{ report: DayReportDto | MultiDayReportDto | null; title: string } | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const slug = activeSlug(pathname, gameId);
  const journey = useView<JourneyView | null>('travel');
  const location = useView<LocationView>('location');
  const world = useView<WorldView>('world', {}, { staleTime: 60_000 });

  const cash = useMemo(() => (state ? state.player.accounts.reduce((sum, account) => sum + account.balance, 0) : 0), [state]);
  const unread = useMemo(() => (state ? state.player.notifications.filter((n) => !n.read).length : 0), [state]);
  const journeyActive = journey.data?.inProgress === true;
  const ending = state?.ending ?? null;

  const onAdvance = useCallback(async () => {
    /*
     * `silent` keeps the report from being announced twice (the modal is the announcement),
     * but a *refusal* has no modal to explain it — the day did not pass — so that case is
     * reported here in the server's own words rather than swallowed.
     */
    const outcome = await advance(days, { silent: true });
    if (!outcome.ok) {
      if (!outcome.stale && outcome.message) toast.push({ tone: 'warning', title: 'Time did not advance', body: outcome.message });
      return;
    }
    const payload = outcome.response.data as { data?: DayReportDto | MultiDayReportDto } | undefined;
    const next = payload?.data ?? null;
    setReport({ report: next, title: days === 1 ? 'Day report' : `${days}-day report` });
  }, [advance, days, toast]);

  if (error && !state) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <ErrorState error={error} onRetry={() => void refresh()} label="This save could not be opened" />
        <div className="mt-3">
          <Link href="/games" className="text-sm text-gold hover:underline">
            ← Back to your games
          </Link>
        </div>
      </div>
    );
  }

  if (loading && !state) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <LoadingState label="Loading your empire" rows={8} cols={5} />
      </div>
    );
  }

  const gameName = meta?.name ?? gameId;
  const version = meta?.version ?? 0;

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop rail */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-hull/80 lg:flex">
        <div className="border-b border-line px-4 py-3">
          <Link href="/games" className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">
            Dynasty
          </Link>
          <p className="mt-1 truncate text-sm font-semibold text-ink" title={gameName}>
            {gameName}
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">
            Day {num(meta?.day ?? 0)} · v{version}
          </p>
        </div>
        <nav aria-label="Game systems" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="mb-3">
              <p className="px-2 pb-1 text-[10px] font-semibold tracking-[0.16em] text-ink-faint uppercase">{group.label}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.slug}>
                    <NavLink gameId={gameId} slug={item.slug} label={item.label} icon={item.icon} active={slug === item.slug} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <SessionFooter />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-line bg-hull/95 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
            <Button variant="ghost" size="sm" className="lg:hidden" aria-expanded={navOpenOn === pathname} onClick={() => setNavOpenOn((open) => (open === pathname ? null : pathname))} aria-label="Toggle navigation">
              <Icon.Dashboard size={16} />
            </Button>

            <div className="flex min-w-0 items-center gap-2">
              <Icon.Pin size={14} />
              <span className="truncate text-sm font-medium text-ink">{location.data?.name ?? '—'}</span>
              <span className="hidden text-xs text-ink-faint sm:inline">{location.data?.country ?? ''}</span>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
              <HeaderStat label="Day" value={num(state?.world.day ?? 0)} />
              <HeaderStat label="Actions" value={`${num(state?.player.stats.actionsToday ?? 0)}/${num(state?.player.stats.maxActionsPerDay ?? 0)}`} />
              <HeaderStat label="Cash" value={money(cash, { compact: true })} title={money(cash)} />
              <HeaderStat
                label="Net worth"
                value={money(state?.netWorth.total ?? 0, { compact: true })}
                title={money(state?.netWorth.total ?? 0)}
                tone={(state?.netWorth.total ?? 0) >= 0 ? 'default' : 'down'}
              />

              <button
                type="button"
                onClick={() => setNotificationsOpen(true)}
                className="relative inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-panel-2 px-2.5 py-1.5 text-xs text-ink-dim hover:text-ink"
                aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
              >
                <Icon.Bell size={15} />
                <span className="hidden sm:inline">Alerts</span>
                {unread > 0 && <span className="tnum rounded-full bg-gold px-1.5 text-[10px] font-bold text-abyss">{unread > 99 ? '99+' : unread}</span>}
              </button>

              <div className="flex items-center gap-1.5">
                <label htmlFor="advance-days" className="sr-only">
                  Days to advance
                </label>
                <Select id="advance-days" className="w-auto px-2 py-1.5 text-xs" value={days} onChange={(event) => setDays(Number(event.target.value))}>
                  {ADVANCE_CHOICES.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice} {choice === 1 ? 'day' : 'days'}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void onAdvance()}
                  loading={isPending('advance')}
                  disabled={Boolean(state?.player.combat && state.player.combat.phase === 'active') || ending !== null}
                  title={
                    state?.player.combat && state.player.combat.phase === 'active'
                      ? 'Finish the encounter before letting time pass.'
                      : ending !== null
                        ? 'This run has ended.'
                        : 'Advance the world by the selected number of days.'
                  }
                >
                  <Icon.Clock size={14} />
                  Advance
                </Button>
              </div>
            </div>
          </div>

          {/* Contextual banners: things that change what the next click should be. */}
          {(journeyActive || ending) && (
            <div className="border-t border-line px-3 py-1.5 sm:px-4">
              {journeyActive && journey.data && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-info">
                  <StatusDot tone="info" pulse label={`Travelling: ${journey.data.from} → ${journey.data.to}`} />
                  <span className="text-ink-faint">
                    {journey.data.modeLabel} · {journey.data.daysRemaining} day(s) remaining · {pct(journey.data.progress, { from: 'fraction', decimals: 0 })} complete
                  </span>
                  <Link href={gameHref(gameId, 'world')} className="text-gold hover:underline">
                    Manage journey
                  </Link>
                  {journey.data.encounterPending && <Badge tone="down">An encounter is waiting</Badge>}
                </div>
              )}
              {ending && (
                <div className="text-xs text-warn">
                  This run has ended — {ending.summary}
                </div>
              )}
            </div>
          )}

          {/* Mobile navigation drawer */}
          {navOpenOn === pathname && (
            <nav aria-label="Game systems" className="max-h-[65vh] overflow-y-auto border-t border-line bg-hull px-2 py-2 lg:hidden">
              {NAV_GROUPS.map((group) => (
                <div key={group.id} className="mb-2">
                  <p className="px-2 pb-1 text-[10px] font-semibold tracking-[0.16em] text-ink-faint uppercase">{group.label}</p>
                  <ul className="grid grid-cols-2 gap-1">
                    {group.items.map((item) => (
                      <li key={item.slug}>
                        <NavLink gameId={gameId} slug={item.slug} label={item.label} icon={item.icon} active={slug === item.slug} compact />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="px-2 pt-1">
                <SessionFooter />
              </div>
            </nav>
          )}
        </header>

        {/* World pulse strip: only shown when something is actually moving. */}
        {(world.data?.world.activeEvents.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-panel/60 px-3 py-1.5 text-xs sm:px-4">
            <span className="font-semibold tracking-wide text-ink-faint uppercase">Active events</span>
            {world.data!.world.activeEvents.slice(0, 3).map((event) => (
              <span key={event.id} className="flex items-center gap-1.5 text-ink-dim">
                <Badge tone={event.severity === 'major' || event.severity === 'severe' ? 'down' : event.severity === 'moderate' ? 'warn' : 'info'}>{event.severity}</Badge>
                {event.name}
                {event.expiresDay !== null && <span className="text-ink-faint">until day {event.expiresDay}</span>}
              </span>
            ))}
            {(world.data?.world.activeEvents.length ?? 0) > 3 && <Link href={gameHref(gameId, 'news')} className="text-gold hover:underline">+{world.data!.world.activeEvents.length - 3} more</Link>}
          </div>
        )}

        <main className="min-w-0 flex-1 px-3 py-4 sm:px-4 sm:py-5">{children}</main>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-[11px] text-ink-faint sm:px-4">
          <span>
            Save version <span className="tnum text-ink-dim">{version}</span>
          </span>
          <span>
            Turn <span className="tnum text-ink-dim">{num(meta?.turn ?? 0)}</span>
          </span>
          <span className="hidden sm:inline">
            Seed <span className="tnum text-ink-dim">{game?.meta.worldSeed ?? '—'}</span>
          </span>
          <span className="ml-auto">
            {meta?.status === 'active' ? <StatusDot tone="up" label="Running" /> : <StatusDot tone="warn" label={meta?.status ?? 'unknown'} />}
          </span>
          <Link href={gameHref(gameId, 'save')} className="text-gold hover:underline">
            Versions
          </Link>
        </footer>
      </div>

      <Dialog
        open={report !== null}
        onClose={() => setReport(null)}
        title={report?.title ?? 'Day report'}
        subtitle={state ? `Now day ${state.world.day} · turn ${state.meta.turn}` : undefined}
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setReport(null)}>
            Close
          </Button>
        }
      >
        <DayReport report={report?.report ?? null} />
      </Dialog>

      <Dialog
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : 'Nothing new'}
        size="md"
        footer={
          <Button variant="secondary" onClick={() => setNotificationsOpen(false)}>
            Close
          </Button>
        }
      >
        <NotificationList />
      </Dialog>
    </div>
  );
}

function HeaderStat({ label, value, title, tone = 'default' }: { label: string; value: string; title?: string; tone?: 'default' | 'down' }) {
  return (
    <div className="hidden text-right sm:block" title={title}>
      <p className="text-[10px] font-medium tracking-wide text-ink-faint uppercase">{label}</p>
      <p className={`tnum text-sm font-semibold ${tone === 'down' ? 'text-down' : 'text-ink'}`}>{value}</p>
    </div>
  );
}

function NavLink({ gameId, slug, label, icon, active, compact = false }: { gameId: string; slug: string; label: string; icon: keyof typeof Icon; active: boolean; compact?: boolean }) {
  const Glyph = Icon[icon];
  return (
    <Link
      href={gameHref(gameId, slug)}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
        active ? 'bg-panel-3 font-semibold text-ink' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
      }`}
    >
      <Glyph size={15} />
      <span className={compact ? 'truncate text-xs' : 'truncate'}>{label}</span>
    </Link>
  );
}

function SessionFooter() {
  const { session, signOut } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-auto border-t border-line px-3 py-2">
      <p className="truncate text-xs text-ink-dim">{session?.user?.displayName ?? 'Signed in'}</p>
      <p className="truncate text-[11px] text-ink-faint">{session?.user?.email ?? ''}</p>
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await signOut();
            router.push('/login');
          }}
        >
          <Icon.Logout size={14} />
          Sign out
        </Button>
      </div>
    </div>
  );
}

function NotificationList() {
  const { state } = useGame();
  const [filter, setFilter] = useState<'all' | 'risk'>('all');
  const notifications = state?.player.notifications ?? [];
  const shown = filter === 'all' ? notifications : notifications.filter((n) => n.kind === 'danger' || n.kind === 'warning');
  const reversed = [...shown].reverse();

  const tone = (kind: string) => (kind === 'danger' ? 'down' : kind === 'warning' ? 'warn' : kind === 'success' ? 'up' : 'info') as 'down' | 'warn' | 'up' | 'info';

  return (
    <div>
      <Tabs
        label="Notification filter"
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: 'all', label: 'All', count: notifications.length },
          { id: 'risk', label: 'Risks', count: notifications.filter((n) => n.kind === 'danger' || n.kind === 'warning').length },
        ]}
      />
      {reversed.length === 0 ? (
        <p className="py-6 text-center text-xs text-ink-faint">Nothing to report yet. Advance time or place an order and the log fills up.</p>
      ) : (
        <ul className="divide-y divide-line">
          {reversed.map((notification) => (
            <li key={notification.id} className="flex items-start gap-2 py-2">
              <Badge tone={tone(notification.kind)}>{notification.kind}</Badge>
              <div className="min-w-0">
                <p className="text-sm text-ink">{notification.title}</p>
                <p className="text-xs text-ink-dim">{notification.body}</p>
                <p className="mt-0.5 text-[11px] text-ink-faint">Day {notification.day}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
