'use client';

/**
 * Travel and the world.
 *
 * Three questions, in the order a player asks them: where am I, where can I get to from
 * here (and what does it cost me in days, cash and risk), and what is the world doing
 * around me while I decide.
 *
 * Routes, costs, detection odds and the plan itself are all computed by the server:
 * `travel.plan` prices a move without committing to it, and `travel.go` re-validates
 * every part of that plan before the journey starts.
 */
import { useMemo, useState } from 'react';
import { api } from '../../../../lib/api-client';
import { useGame, usePurse, useView } from '../../../../lib/game-context';
import { ViewPanel, CommandButton } from '../../../../components/game/view-panel';
import { Badge, Button, Checkbox, KeyValue, Panel, Progress, Select, Table, Tabs, Td, Th, Tr } from '../../../../components/ui/primitives';
import { EmptyState, InlineNote } from '../../../../components/ui/states';
import { humanise, mass, money, num, pct, volume } from '../../../../lib/format';
import type { DestinationsView, JourneyView, LocationView, TravelPlan } from '../../../../lib/game-data';

type Tab = 'journey' | 'destinations' | 'world';

export default function TravelPage() {
  const [tab, setTab] = useState<Tab>('destinations');
  const journey = useView<JourneyView>('travel');

  const inTransit = journey.data?.inProgress ?? false;
  const activeTab: Tab = inTransit ? 'journey' : tab;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Movement</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">{inTransit ? 'In transit' : 'Travel'}</h1>
          <p className="mt-1 text-xs text-ink-dim">
            {inTransit && journey.data
              ? `${journey.data.modeLabel} · ${journey.data.daysRemaining} day${journey.data.daysRemaining === 1 ? '' : 's'} remaining · ${pct(journey.data.progress, { from: 'fraction', decimals: 0 })} complete`
              : 'Plan a route, board a vehicle, cross a border. Journeys take real days.'}
          </p>
        </div>
        <Tabs
          label="Travel sections"
          value={activeTab}
          onChange={(next) => setTab(next)}
          tabs={[
            { id: 'journey', label: 'Journey' },
            { id: 'destinations', label: 'Destinations' },
            { id: 'world', label: 'World map' },
          ]}
        />
      </header>

      {inTransit && <JourneyPanel />}

      {activeTab === 'destinations' && !inTransit && <DestinationsPanel />}
      {activeTab === 'world' && <WorldPanel />}
      {activeTab === 'journey' && !inTransit && (
        <Panel title="No journey in progress">
          <EmptyState
            title="You are standing still"
            body="Choose a destination, compare modes, then commit. Days in transit are real days: the world keeps moving while you travel."
          />
          <div className="mt-3">
            <Button size="sm" variant="primary" onClick={() => setTab('destinations')}>
              Choose a destination
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Journey in progress                                                 */
/* ------------------------------------------------------------------ */

function JourneyPanel() {
  const journey = useView<JourneyView>('travel');
  const { state } = useGame();
  const data = journey.data;
  if (!data) return null;

  const vehicle = data.vehicle;
  return (
    <Panel
      title="Journey in progress"
      subtitle={`${data.from} → ${data.to}`}
      tone={data.encounterPending ? 'warn' : 'info'}
      actions={<Badge tone={data.encounterPending ? 'warn' : 'info'}>{data.encounterPending ? 'encounter pending' : data.modeLabel}</Badge>}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-3">
          <Progress value={data.progress} label={`${data.daysRemaining} days remaining`} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
            <KeyValue label="Mode">{data.modeLabel}</KeyValue>
            <KeyValue label="Departed day">{data.departedDay}</KeyValue>
            <KeyValue label="Arrives day">{data.arrivesDay}</KeyValue>
            <KeyValue label="Cost">{money(data.cost)}</KeyValue>
            <KeyValue label="Route risk">{pct(data.risk, { from: 'fraction', decimals: 0 })}</KeyValue>
            <KeyValue label="Vehicle">{vehicle ?? 'on foot'}</KeyValue>
          </dl>
          {data.crew.length > 0 && <p className="text-xs text-ink-dim">Crew travelling: {data.crew.join(', ')}</p>}
          {data.encounterPending && (
            <InlineNote tone="warn">Something is waiting on this leg. Advance the day to resolve it — you may be offered a fight, a shakedown or a bribe.</InlineNote>
          )}
          <div className="flex flex-wrap gap-2">
            <CommandButton intent={{ type: 'travel.resume' }} label="Advance this leg" variant="primary" />
            <CommandButton
              intent={{ type: 'travel.abandon' }}
              label="Abandon journey"
              variant="danger"
              confirm={{
                title: 'Abandon the journey?',
                body: 'You turn back and the days already spent travelling are lost. Costs already paid are not refunded.',
                confirmLabel: 'Turn back',
                destructive: true,
              }}
            />
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">En route</h3>
          <p className="text-xs text-ink-dim">
            While a journey is in progress, buying, selling and most business decisions wait until you arrive. You may still advance days.
          </p>
          {state?.player.combat && <InlineNote tone="down">Combat is live — resolve it before continuing to travel.</InlineNote>}
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Destinations and planning                                           */
/* ------------------------------------------------------------------ */

function DestinationsPanel() {
  const { gameId } = useGame();
  const { cash } = usePurse();
  const [mode, setMode] = useState<string>('');
  const [selected, setSelected] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ plan: TravelPlan; toId: string } | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [bribeCustoms, setBribeCustoms] = useState(false);

  const destinations = useView<DestinationsView>('destinations', mode ? { mode } : {});
  const data = destinations.data;

  const modes = data?.modes ?? [];
  const chosenMode = mode || modes.find((item) => item.ok)?.mode || modes[0]?.mode || '';

  const requestPlan = async (toId: string) => {
    setSelected(toId);
    setPlanning(true);
    setPlanError(null);
    try {
      const response = await api.intent(gameId, { type: 'travel.plan', toId, mode: chosenMode });
      const payload = response.data as TravelPlan | undefined;
      if (payload && payload.ok) setPlan({ plan: payload, toId });
      else {
        setPlan(null);
        setPlanError(payload?.reason ?? 'The server refused that route.');
      }
    } catch (error) {
      setPlan(null);
      setPlanError(error instanceof Error ? error.message : 'Could not price that route.');
    } finally {
      setPlanning(false);
    }
  };

  const reachable = useMemo(() => (data?.destinations ?? []).filter((item) => item.reachable), [data]);
  const unreachable = useMemo(() => (data?.destinations ?? []).filter((item) => !item.reachable), [data]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section className="space-y-3">
        <Panel
          title="Reachable now"
          subtitle={data ? `${reachable.length} place${reachable.length === 1 ? '' : 's'} reachable from ${data.fromName}` : 'Reading routes…'}
          actions={
            <label className="flex items-center gap-2 text-xs text-ink-dim">
              <span>Mode</span>
              <Select aria-label="Travel mode" value={chosenMode} onChange={(event) => setMode(event.target.value)}>
                {modes.map((item) => (
                  <option key={item.mode} value={item.mode}>
                    {item.label}
                    {item.ok ? '' : ' (unavailable)'}
                  </option>
                ))}
              </Select>
            </label>
          }
        >
          {data && modes.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {modes.map((item) => (
                <button
                  key={item.mode}
                  type="button"
                  onClick={() => setMode(item.mode)}
                  className={`rounded-full border px-3 py-1 text-xs ${item.mode === chosenMode ? 'border-gold text-gold' : 'border-line text-ink-dim hover:text-ink'}`}
                  title={item.ok ? item.reason ?? undefined : item.reason}
                >
                  {item.label} · {item.days}d · {money(item.cost)}
                  {!item.ok && <span className="ml-1 text-down">✕</span>}
                </button>
              ))}
            </div>
          )}
          <Table label="Destination list">
            <thead>
              <tr>
                <Th>Destination</Th>
                <Th align="right">Distance</Th>
                <Th align="right">Days</Th>
                <Th align="right">Cost</Th>
                <Th align="right">Borders</Th>
                <Th align="right">Risk</Th>
                <Th align="right">Traded</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {reachable.length === 0 && (
                <Tr>
                  <Td className="text-xs text-ink-faint" colSpan={8}>
                    {data ? 'Nothing is reachable with the selected mode — try another mode, or buy a vehicle.' : 'Loading routes…'}
                  </Td>
                </Tr>
              )}
              {reachable.map((destination) => (
                <Tr key={destination.locationId} highlight={selected === destination.locationId}>
                  <Td>
                    <span className="flex flex-wrap items-center gap-1">
                      <span className="text-sm text-ink">{destination.name}</span>
                      {destination.lockdown && <Badge tone="down">lockdown</Badge>}
                      {!destination.discovered && <Badge tone="violet">uncharted</Badge>}
                    </span>
                    <span className="text-[11px] text-ink-faint">
                      {destination.country} · {humanise(destination.kind)}
                    </span>
                  </Td>
                  <Td align="right" className="tnum text-xs">{num(destination.distanceKm)} km</Td>
                  <Td align="right" className="tnum">{destination.days}</Td>
                  <Td align="right" className="tnum">{money(destination.cost)}</Td>
                  <Td align="right" className="tnum text-xs">{destination.borders}</Td>
                  <Td align="right" className="tnum text-xs">{pct(destination.risk, { from: 'fraction', decimals: 0 })}</Td>
                  <Td align="right" className="tnum text-xs text-ink-faint">{destination.traded}</Td>
                  <Td align="right">
                    <Button size="sm" variant={selected === destination.locationId ? 'primary' : 'secondary'} loading={planning && selected === destination.locationId} onClick={() => void requestPlan(destination.locationId)}>
                      Plan
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {unreachable.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-ink-dim hover:text-ink">Why {unreachable.length} places are unreachable</summary>
              <ul className="mt-2 space-y-1">
                {unreachable.slice(0, 12).map((destination) => (
                  <li key={destination.locationId} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                    <span className="text-ink-dim">{destination.name}</span>
                    <span className="text-ink-faint">{destination.reason ?? 'no route with this mode'}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Panel>
      </section>

      <aside className="space-y-3">
        {planError && !plan && (
          <Panel title="Route refused" tone="warn">
            <p className="text-xs text-ink-dim">{planError}</p>
          </Panel>
        )}
        {plan ? (
          <PlanPanel
            key={`${plan.toId}-${chosenMode}`}
            plan={plan.plan}
            bribeCustoms={bribeCustoms}
            onBribe={setBribeCustoms}
            onClear={() => {
              setPlan(null);
              setSelected(null);
            }}
          />
        ) : (
          <Panel title="Route planning">
            <p className="text-xs text-ink-dim">
              Pick a destination to see the server&apos;s plan: legs, distance, border crossings, freight cost, cargo you would carry, detection odds per border and the value at
              risk.
            </p>
            <dl className="mt-3">
              <KeyValue label="Cash available">{money(cash)}</KeyValue>
              <KeyValue label="Locations traded at">{data ? num(data.destinations.filter((item) => item.traded > 0).length) : '—'}</KeyValue>
            </dl>
            <p className="mt-3 text-[11px] text-ink-faint">Unexplored locations become discoverable through travel, intel, or contacts.</p>
          </Panel>
        )}
      </aside>
    </div>
  );
}

function PlanPanel({ plan, bribeCustoms, onBribe, onClear }: { plan: TravelPlan; bribeCustoms: boolean; onBribe: (next: boolean) => void; onClear: () => void }) {
  const { cash } = usePurse();
  const overCapacity = plan.overCapacityKg > 0 || plan.overCapacityL > 0;
  const unaffordable = plan.totalCost > cash;

  return (
    <Panel
      title={`${plan.fromName} → ${plan.toName}`}
      subtitle={`${plan.mode} · ${num(plan.distanceKm)} km · ${plan.days} day${plan.days === 1 ? '' : 's'}`}
      actions={
        <Button size="sm" variant="ghost" onClick={onClear}>
          ✕
        </Button>
      }
      tone={unaffordable ? 'danger' : overCapacity ? 'warn' : 'default'}
    >
      <div className="space-y-3">
        <dl className="space-y-0.5">
          <KeyValue label="Border crossings">{plan.borderCrossings}</KeyValue>
          <KeyValue label="Total cost">
            <span className={unaffordable ? 'text-down' : ''}>{money(plan.totalCost)}</span>
          </KeyValue>
          <KeyValue label="Cash available">{money(plan.cashAvailable)}</KeyValue>
          <KeyValue label="Cargo carried">
            {plan.cargo.length} good{plan.cargo.length === 1 ? '' : 's'} · {mass(plan.cargoKg)} / {volume(plan.cargoL)}
          </KeyValue>
          <KeyValue label="Vehicle capacity">
            {plan.vehicle ? `${plan.vehicle.name} — ${mass(plan.capacityKg)}` : 'no vehicle (goods stay behind)'}
          </KeyValue>
          <KeyValue label="Detection chance per border">{pct(plan.detectionChancePerBorder, { from: 'fraction', decimals: 1 })}</KeyValue>
          <KeyValue label="Encounter chance per leg">{pct(plan.encounterChancePerLeg, { from: 'fraction', decimals: 1 })}</KeyValue>
          <KeyValue label="Route risk">{pct(plan.routeRisk, { from: 'fraction', decimals: 0 })}</KeyValue>
          {plan.contrabandUnits > 0 && (
            <>
              <KeyValue label="Contraband units">{num(plan.contrabandUnits)}</KeyValue>
              <KeyValue label="Value at risk" tone="text-warn">{money(plan.seizureValueAtRisk)}</KeyValue>
              <KeyValue label="Bribe per border">{money(plan.bribeCostPerBorder)} · {pct(plan.bribeSuccessChance, { from: 'fraction', decimals: 0 })} chance</KeyValue>
            </>
          )}
          <KeyValue label="Experience">{plan.xp} xp</KeyValue>
        </dl>

        {plan.costs.length > 0 && (
          <div>
            <h3 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Cost breakdown</h3>
            <ul className="mt-1 space-y-0.5">
              {plan.costs.map((cost) => (
                <li key={cost.label} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-ink-dim">
                    {cost.label}
                    {cost.note && <span className="ml-1 text-ink-faint">({cost.note})</span>}
                  </span>
                  <span className="tnum text-ink">{money(cost.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {plan.legs.length > 1 && (
          <div>
            <h3 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Legs</h3>
            <ul className="mt-1 space-y-0.5">
              {plan.legs.map((leg, index) => (
                <li key={`${leg.from}-${leg.to}-${index}`} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate text-ink-dim">
                    {leg.from} → {leg.to} {leg.borderCrossing && <Badge tone="warn">border</Badge>}
                  </span>
                  <span className="tnum text-ink-faint shrink-0">
                    {num(leg.distanceKm)} km · {leg.days}d · risk {pct(leg.risk, { from: 'fraction', decimals: 0 })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {plan.overCapacityKg > 0 && <InlineNote tone="warn">You are {mass(plan.overCapacityKg)} over the vehicle&apos;s capacity — leave goods behind or take a larger vehicle.</InlineNote>}
        {plan.overCapacityL > 0 && <InlineNote tone="warn">You are {volume(plan.overCapacityL)} over the vehicle&apos;s volume.</InlineNote>}
        {unaffordable && <InlineNote tone="down">That journey costs more than you can pay. Reduce cargo, choose a cheaper mode, or earn first.</InlineNote>}
        {plan.warnings.map((warning) => (
          <InlineNote key={warning} tone="warn">
            {warning}
          </InlineNote>
        ))}

        {plan.borderCrossings > 0 && plan.contrabandUnits > 0 && (
          <Checkbox
            label="Bribe customs at each border"
            hint={`About ${money(plan.bribeCostPerBorder)} per crossing, ${pct(plan.bribeSuccessChance, { from: 'fraction', decimals: 0 })} chance of clearing.`}
            checked={bribeCustoms}
            onChange={onBribe}
          />
        )}

        <CommandButton
          intent={{ type: 'travel.go', toId: plan.toId, mode: plan.mode, ...(bribeCustoms ? { bribeCustoms: true } : {}), ...(plan.vehicle ? { vehicleId: plan.vehicle.id } : {}) }}
          label={`Travel ${plan.days} day${plan.days === 1 ? '' : 's'} to ${plan.toName}`}
          variant="primary"
          size="lg"
          disabled={!plan.ok || unaffordable}
          disabledReason={!plan.ok ? plan.reason ?? 'The server refused this route.' : 'You cannot afford this journey.'}
          confirm={
            plan.days >= 5 || plan.contrabandUnits > 0
              ? {
                  title: `Travel to ${plan.toName}?`,
                  body: (
                    <>
                      {plan.days} days, {money(plan.totalCost)} in costs
                      {plan.contrabandUnits > 0 ? <>, carrying {num(plan.contrabandUnits)} contraband units worth {money(plan.seizureValueAtRisk)} across {plan.borderCrossings} border(s)</> : null}
                      . The world advances while you travel.
                    </>
                  ),
                  confirmLabel: 'Depart',
                }
              : undefined
          }
        />
        <p className="text-[11px] text-ink-faint">
          {plan.discovered ? 'Known route.' : 'Route discovered by this plan — arriving will chart it.'} Every leg is re-validated server-side at departure.
        </p>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* World map                                                           */
/* ------------------------------------------------------------------ */

function WorldPanel() {
  const destinations = useView<DestinationsView>('destinations');
  const [focus, setFocus] = useState<string | null>(null);
  const data = destinations.data;

  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];

  // The registry's coordinates are the world's own geography — nothing is generated here.
  const bounds = useMemo(() => {
    if (nodes.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    const xs = nodes.map((node) => node.map.x);
    const ys = nodes.map((node) => node.map.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }, [nodes]);

  const project = (x: number, y: number) => ({
    cx: 24 + ((x - bounds.minX) / Math.max(1, bounds.maxX - bounds.minX)) * 952,
    cy: 24 + ((y - bounds.minY) / Math.max(1, bounds.maxY - bounds.minY)) * 552,
  });

  const focused = nodes.find((node) => node.id === focus) ?? null;

  return (
    <div className="space-y-3">
      <Panel
        title="World map"
        subtitle={data ? `${nodes.length} charted locations · ${edges.length} routes · ${data.unchartedLocations} still uncharted` : 'Charting the world…'}
        bodyClassName="px-4 py-2"
      >
        {nodes.length === 0 ? (
          <EmptyState title="No charted locations" body="The world registry has not returned any locations for this save." />
        ) : (
          <div className="overflow-x-auto">
            <svg viewBox="0 0 1000 600" className="h-auto w-full min-w-[42rem]" role="img" aria-label="World map of charted locations and routes">
              <title>Charted locations and the routes between them</title>
              <g>
                {edges.map((edge) => {
                  const from = nodes.find((node) => node.id === edge.from);
                  const to = nodes.find((node) => node.id === edge.to);
                  if (!from || !to) return null;
                  const a = project(from.map.x, from.map.y);
                  const b = project(to.map.x, to.map.y);
                  const active = focused !== null && (edge.from === focused.id || edge.to === focused.id);
                  return (
                    <line
                      key={edge.id}
                      x1={a.cx}
                      y1={a.cy}
                      x2={b.cx}
                      y2={b.cy}
                      stroke={active ? 'var(--color-gold)' : 'var(--color-line-strong)'}
                      strokeWidth={active ? 1.6 : 0.7}
                      strokeDasharray={edge.borderCrossing ? '4 3' : undefined}
                      opacity={active ? 0.9 : edge.risk > 0.25 ? 0.55 : 0.28}
                    />
                  );
                })}
                {nodes.map((node) => {
                  const point = project(node.map.x, node.map.y);
                  const isFocus = node.id === focus;
                  return (
                    <g key={node.id}>
                      <circle
                        cx={point.cx}
                        cy={point.cy}
                        r={node.here ? 7 : isFocus ? 6 : 3.4}
                        fill={node.here ? 'var(--color-gold)' : node.lockdown ? 'var(--color-down)' : node.traded > 0 ? 'var(--color-up)' : 'var(--color-ink-faint)'}
                        stroke={isFocus ? 'var(--color-ink)' : 'none'}
                        strokeWidth={1.2}
                      />
                      <circle cx={point.cx} cy={point.cy} r={12} fill="transparent" className="cursor-pointer" onClick={() => setFocus(node.id === focus ? null : node.id)} role="button" tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') setFocus(node.id === focus ? null : node.id);
                        }}
                      >
                        <title>{`${node.name} — ${node.country}${node.here ? ' (you are here)' : ''}`}</title>
                      </circle>
                      {(isFocus || node.here || node.traded > 0) && (
                        <text x={point.cx + 9} y={point.cy + 3} fontSize={isFocus ? 13 : 11} fill={isFocus ? 'var(--color-ink)' : 'var(--color-ink-dim)'}>
                          {node.name}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-faint">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-gold" /> you are here
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-up" /> traded before
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-down" /> lockdown
          </span>
          <span>dashed route = border crossing · click a node for detail</span>
        </div>
      </Panel>

      {focused ? <NodeDetail nodeId={focused.id} /> : <CurrentLocationCard />}
    </div>
  );
}

function NodeDetail({ nodeId }: { nodeId: string }) {
  const location = useView<LocationView>('location', { locationId: nodeId });
  return (
    <ViewPanel<LocationView>
      view="location"
      params={{ locationId: nodeId }}
      title="Location detail"
      bare
      isEmpty={(data) => !data.discovered}
      emptyTitle="Not yet charted"
      emptyBody="You have not discovered this location. Travel there, buy intel, or work a contact to reveal it."
    >
      {(data) => (
        <Panel title={data.name} subtitle={`${data.country} · ${humanise(data.kind)} · population ${num(data.population)}`}>
          <p className="text-xs text-ink-dim">{data.description}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <dl className="space-y-0.5">
              <KeyValue label="Wealth index">{num(data.economy.wealthIndex, 2)}</KeyValue>
              <KeyValue label="Industry">{num(data.economy.industrialIndex, 2)}</KeyValue>
              <KeyValue label="Services">{num(data.economy.serviceIndex, 2)}</KeyValue>
              <KeyValue label="Unemployment">{pct(data.economy.unemployment, { from: 'fraction', decimals: 1 })}</KeyValue>
            </dl>
            <dl className="space-y-0.5">
              <KeyValue label="Security">{pct(data.security, { from: 'fraction', decimals: 0 })}</KeyValue>
              <KeyValue label="Risk">{pct(data.risk, { from: 'fraction', decimals: 0 })}</KeyValue>
              <KeyValue label="Tax rate">{pct(data.laws.taxRate, { from: 'fraction', decimals: 1 })}</KeyValue>
              <KeyValue label="Enforcement">{pct(data.laws.enforcement, { from: 'fraction', decimals: 0 })}</KeyValue>
            </dl>
            <dl className="space-y-0.5">
              <KeyValue label="Corruption">{pct(data.laws.corruption, { from: 'fraction', decimals: 0 })}</KeyValue>
              <KeyValue label="Market index">{num(data.market.index, 2)}</KeyValue>
              <KeyValue label="Goods traded">{data.market.tradedCount}</KeyValue>
              <KeyValue label="Your heat">{pct(data.playerHeat, { from: 'fraction', decimals: 0 })}</KeyValue>
            </dl>
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {data.services.bank && <Badge tone="info">bank</Badge>}
            {data.services.stockExchange && <Badge tone="info">stock exchange</Badge>}
            {data.services.cryptoExchange && <Badge tone="info">crypto exchange</Badge>}
            {data.services.offshore && <Badge tone="violet">offshore banking</Badge>}
            {data.services.loanSharks && <Badge tone="warn">loan sharks</Badge>}
            {data.services.auctionHouse && <Badge tone="info">auction house</Badge>}
            {data.services.darknetAccess && <Badge tone="violet">darknet access</Badge>}
            {data.lockdown && <Badge tone="down">lockdown</Badge>}
            {data.laws.tolerated.map((item) => (
              <Badge key={item} tone="warn">
                tolerates {humanise(item)}
              </Badge>
            ))}
          </div>
          {data.specialties.length > 0 && (
            <p className="mt-2 text-xs text-ink-dim">
              Known for: {data.specialties.map((item) => item.name).join(', ')}
            </p>
          )}
          {location.error && <InlineNote tone="down">{location.error.message}</InlineNote>}
        </Panel>
      )}
    </ViewPanel>
  );
}

function CurrentLocationCard() {
  const location = useView<LocationView>('location');
  const data = location.data;
  if (!data) return null;
  return (
    <Panel title="You are here" subtitle={`${data.name} · ${data.country}`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <dl className="space-y-0.5">
          <KeyValue label="Region">{data.region}</KeyValue>
          <KeyValue label="Kind">{humanise(data.kind)}</KeyValue>
          <KeyValue label="Population">{num(data.population)}</KeyValue>
          <KeyValue label="Specialities">{data.specialties.map((item) => item.name).join(', ') || '—'}</KeyValue>
        </dl>
        <dl className="space-y-0.5">
          <KeyValue label="Security">{pct(data.security, { from: 'fraction', decimals: 0 })}</KeyValue>
          <KeyValue label="Risk">{pct(data.risk, { from: 'fraction', decimals: 0 })}</KeyValue>
          <KeyValue label="Enforcement">{pct(data.laws.enforcement, { from: 'fraction', decimals: 0 })}</KeyValue>
          <KeyValue label="Your heat" tone={data.playerHeat > 0.3 ? 'text-warn' : undefined}>
            {pct(data.playerHeat, { from: 'fraction', decimals: 0 })}
          </KeyValue>
        </dl>
      </div>
      <p className="mt-3 text-xs text-ink-dim">{data.description}</p>
      {data.lockdown && <InlineNote tone="down">This location is under lockdown: enforcement is high and some trade is refused.</InlineNote>}
    </Panel>
  );
}
