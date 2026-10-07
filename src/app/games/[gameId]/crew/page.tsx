'use client';

/**
 * Crew.
 *
 * People are the most expensive thing a player owns and the only asset that can betray
 * them. This screen answers three questions in order: who works for me and what are they
 * doing, who could I hire from the local pool, and what is payroll about to cost me.
 *
 * The server decides everything that matters here — wages, loyalty, betrayal risk, span of
 * control, whether an employee's capability even permits an assignment. The screen only
 * shows those verdicts and forwards the player's choice.
 */
import { Fragment, useState } from 'react';
import { useGame, useView } from '../../../../lib/game-context';
import { ViewPanel, CommandButton } from '../../../../components/game/view-panel';
import { Badge, Button, KeyValue, Meter, Panel, Progress, Select, Table, Tabs, Td, Th, Tr } from '../../../../components/ui/primitives';
import { EmptyState, InlineNote } from '../../../../components/ui/states';
import { humanise, money, num, pct } from '../../../../lib/format';
import type { BusinessesView, CandidateRow, CrewView, EmployeeRow, ProductionView, PropertiesView } from '../../../../lib/game-data';

type Tab = 'roster' | 'hiring' | 'payroll';

const ASSIGNMENT_KINDS = ['business', 'production', 'logistics', 'warehouse', 'security', 'trading', 'finance', 'intel', 'manager_of_managers'] as const;
type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

/** Assignment kinds the server validates against a property the player owns. */
const PROPERTY_TARGETED: AssignmentKind[] = ['warehouse', 'security', 'logistics', 'manager_of_managers'];
const BUSINESS_TARGETED: AssignmentKind[] = ['business'];
const LINE_TARGETED: AssignmentKind[] = ['production'];

export default function CrewPage() {
  const crew = useView<CrewView>('crew');
  const summary = crew.data?.summary;
  const [tab, setTab] = useState<Tab>('roster');

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">People</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">Crew</h1>
          <p className="mt-1 text-xs text-ink-dim">
            {summary
              ? `${summary.headcount} on the books · ${summary.active} active · payroll ${money(summary.payrollPerDay)}/day (${pct(summary.payrollShareOfRevenue, { from: 'fraction', decimals: 1 })} of revenue)`
              : 'Reading the roster…'}
          </p>
        </div>
        <Tabs
          label="Crew sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'roster', label: 'Roster', count: crew.data?.employees.length },
            { id: 'hiring', label: 'Hiring pool', count: crew.data?.candidates.length },
            { id: 'payroll', label: 'Payroll' },
          ]}
        />
      </header>

      {summary && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Payroll forecast" value={`${money(crew.data?.payrollForecastPerDay ?? 0)}/day`} sub={`${summary.headcount} employees`} />
          <Stat
            label="Unpaid wages"
            value={money(summary.unpaidWages)}
            sub={summary.unpaidWages > 0 ? 'loyalty is falling' : 'up to date'}
            tone={summary.unpaidWages > 0 ? 'down' : undefined}
          />
          <Stat label="Average loyalty / morale" value={`${num(summary.averageLoyalty, 2)} / ${num(summary.averageMorale, 2)}`} sub={`avg skill ${num(summary.averageSkill, 2)}`} />
          <Stat
            label="Span of control"
            value={`${summary.span.crew} / ${summary.span.capacity}`}
            sub={summary.span.overloaded ? `overloaded: ${summary.span.explanation}` : 'within capacity'}
            tone={summary.span.overloaded ? 'warn' : undefined}
          />
        </div>
      )}

      {tab === 'roster' && <Roster />}
      {tab === 'hiring' && <Hiring />}
      {tab === 'payroll' && <Payroll />}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'up' | 'down' | 'warn' }) {
  return (
    <div className="rounded-panel border border-line bg-panel px-3 py-2.5">
      <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">{label}</p>
      <p className={`tnum mt-0.5 text-lg font-semibold ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : tone === 'warn' ? 'text-warn' : 'text-ink'}`}>{value}</p>
      <p className="text-[11px] text-ink-faint">{sub}</p>
    </div>
  );
}

function Roster() {
  const crew = useView<CrewView>('crew');
  const [roleFilter, setRoleFilter] = useState('');
  const [openEmployee, setOpenEmployee] = useState<string | null>(null);

  const employees = crew.data?.employees ?? [];
  const roles = [...new Set(employees.map((employee) => employee.role))];
  const visible = roleFilter ? employees.filter((employee) => employee.role === roleFilter) : employees;

  return (
    <ViewPanel<CrewView>
      view="crew"
      title="Employees"
      subtitle="Everyone on the payroll, their assignment and their risk"
      isEmpty={(data) => data.employees.length === 0}
      emptyTitle="Nobody works for you yet"
      emptyBody="Hire from the local pool. Staff run businesses, feed production lines, guard property and operate standing orders when you are elsewhere."
      actions={
        <label className="flex items-center gap-2 text-xs text-ink-dim">
          <span>Role</span>
          <Select aria-label="Role filter" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="">All roles</option>
            {roles.map((role) => (
              <option key={role} value={role}>
                {humanise(role)}
              </option>
            ))}
          </Select>
        </label>
      }
    >
      {() => (
        <Table label="Employees">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Assignment</Th>
              <Th align="right">Level / XP</Th>
              <Th align="right">Skill</Th>
              <Th align="right">Loyalty</Th>
              <Th align="right">Morale</Th>
              <Th align="right">Salary / day</Th>
              <Th>State</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <Tr>
                <Td className="text-xs text-ink-faint" colSpan={10}>
                  No employees match that filter.
                </Td>
              </Tr>
            )}
            {visible.map((employee) => (
              <Fragment key={employee.id}>
              <Tr highlight={openEmployee === employee.id}>
                <Td>
                  <span className="text-sm text-ink">{employee.name}</span>
                  <span className="block text-[11px] text-ink-faint">
                    {employee.locationName} · {num(employee.daysEmployed)} days employed
                  </span>
                </Td>
                <Td className="text-xs text-ink-dim">{employee.roleName}</Td>
                <Td className="text-xs">
                  {employee.assignment ? (
                    <span className="text-ink-dim">
                      {humanise(employee.assignment.kind)}
                      <span className="block text-[11px] text-ink-faint">
                        {employee.assignment.targetName} · tier {employee.assignment.tier}
                      </span>
                    </span>
                  ) : (
                    <Badge tone="warn">unassigned</Badge>
                  )}
                </Td>
                <Td align="right" className="tnum text-xs">
                  {employee.level}
                  <span className="block text-[11px] text-ink-faint">
                    {num(employee.xp)}/{num(employee.xpToNext)} xp
                  </span>
                </Td>
                <Td align="right" className="tnum">{num(employee.stats.skill, 2)}</Td>
                <Td align="right">
                  <Meter value={employee.stats.loyalty} tone={employee.stats.loyalty < 0.35 ? 'down' : employee.stats.loyalty < 0.6 ? 'warn' : 'up'} display={num(employee.stats.loyalty, 2)} />
                </Td>
                <Td align="right">
                  <Meter value={employee.stats.morale} tone={employee.stats.morale < 0.35 ? 'down' : employee.stats.morale < 0.6 ? 'warn' : 'info'} display={num(employee.stats.morale, 2)} />
                </Td>
                <Td align="right" className="tnum">
                  {money(employee.salaryPerDay)}
                  <span className="block text-[11px] text-ink-faint">{pct(employee.salaryShareOfRevenue, { from: 'fraction', decimals: 1 })} of revenue</span>
                </Td>
                <Td className="text-[11px]">
                  {employee.injured && <Badge tone="down">injured {employee.injuredUntilDay !== null ? `→ day ${employee.injuredUntilDay}` : ''}</Badge>}
                  {employee.trainingUntilDay !== null && employee.trainingUntilDay > 0 && <Badge tone="info">training → day {employee.trainingUntilDay}</Badge>}
                  {employee.daysUnpaid > 0 && <Badge tone="down">{employee.daysUnpaid}d unpaid</Badge>}
                  {employee.betrayalRisk > 0.3 && <Badge tone="warn">betrayal {pct(employee.betrayalRisk, { from: 'fraction', decimals: 0 })}</Badge>}
                </Td>
                <Td align="right">
                  <Button size="sm" variant="ghost" onClick={() => setOpenEmployee(openEmployee === employee.id ? null : employee.id)} aria-expanded={openEmployee === employee.id}>
                    Manage
                  </Button>
                </Td>
              </Tr>
              {openEmployee === employee.id && (
                <tr>
                  <td colSpan={10} className="border-b border-line bg-panel-2/30 px-3 pb-3">
                    <EmployeeActions employee={employee} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </Table>
      )}
    </ViewPanel>
  );
}

function EmployeeActions({ employee }: { employee: EmployeeRow }) {
  const businesses = useView<BusinessesView>('businesses');
  const properties = useView<PropertiesView>('properties');
  const production = useView<ProductionView>('production');
  const [kind, setKind] = useState<AssignmentKind>((employee.assignment?.kind as AssignmentKind) ?? 'business');
  const [targetId, setTargetId] = useState('');
  const [tier, setTier] = useState(1);

  const targets = (() => {
    if (BUSINESS_TARGETED.includes(kind)) return (businesses.data?.businesses ?? []).map((business) => ({ id: business.id, label: `${business.name} — ${business.locationName}` }));
    if (LINE_TARGETED.includes(kind)) return (production.data?.lines ?? []).map((line) => ({ id: line.id, label: `${line.name} — ${line.propertyName}` }));
    if (PROPERTY_TARGETED.includes(kind)) return (properties.data?.owned ?? []).map((property) => ({ id: property.id, label: `${property.name} — ${property.locationName}` }));
    return [];
  })();

  const needsTarget = targets.length >= 0 && !['trading', 'finance', 'intel'].includes(kind);
  const effectiveTarget = needsTarget ? targetId || targets[0]?.id || '' : 'global';

  return (
    <div className="grid gap-3 border-t border-line pt-3 lg:grid-cols-4">
      <div className="space-y-2 lg:col-span-2">
        <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Assign</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs">
            <span className="mb-1 block text-ink-dim">Role on assignment</span>
            <Select value={kind} onChange={(event) => setKind(event.target.value as AssignmentKind)}>
              {ASSIGNMENT_KINDS.map((option) => (
                <option key={option} value={option}>
                  {humanise(option)}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-ink-dim">Tier</span>
            <Select value={tier} onChange={(event) => setTier(Number(event.target.value))}>
              {[1, 2, 3, 4, 5].map((option) => (
                <option key={option} value={option}>
                  Tier {option}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {needsTarget && (
          <label className="block text-xs">
            <span className="mb-1 block text-ink-dim">Target</span>
            <Select value={targetId || targets[0]?.id || ''} onChange={(event) => setTargetId(event.target.value)}>
              {targets.length === 0 && <option value="">Nothing suitable to assign to</option>}
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </Select>
            <span className="mt-1 block text-[11px] text-ink-faint">
              {kind === 'business'
                ? 'Businesses take staff directly; a manager runs the venture day to day.'
                : kind === 'production'
                  ? 'Production lines take workers and one manager.'
                  : 'Properties take guards, warehouse staff and logistics staff.'}
            </span>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <CommandButton
            intent={{ type: 'crew.assign', employeeId: employee.id, kind, targetId: effectiveTarget, tier }}
            label="Assign"
            variant="primary"
            disabled={!employee.assignment && needsTarget && !effectiveTarget}
            disabledReason={needsTarget ? 'Choose what to assign them to.' : 'This role needs no specific target.'}
          />
          <CommandButton intent={{ type: 'crew.unassign', employeeId: employee.id }} label="Unassign" variant="secondary" disabled={!employee.assignment} disabledReason="They are already unassigned." />
        </div>
        {employee.personalObjective && <p className="text-[11px] text-ink-faint">Their own goal: {employee.personalObjective}</p>}
      </div>

      <div className="space-y-2">
        <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Develop</h4>
        <CommandButton
          intent={{ type: 'crew.train', employeeId: employee.id }}
          label={employee.trainingCost > 0 ? `Train for ${money(employee.trainingCost)}` : 'Train'}
          variant="secondary"
          disabled={employee.trainingUntilDay !== null && employee.trainingUntilDay > 0}
          disabledReason="They are already in training."
        />
        <CommandButton
          intent={{ type: 'crew.promote', employeeId: employee.id }}
          label="Promote"
          variant="secondary"
          disabled={!employee.canPromote}
          disabledReason="Not ready for promotion yet."
        />
        <dl className="pt-1">
          <KeyValue label="Toughness / discretion">
            {num(employee.stats.toughness, 2)} / {num(employee.stats.discretion, 2)}
          </KeyValue>
          <KeyValue label="Initiative / health">
            {num(employee.stats.initiative, 2)} / {num(employee.stats.health, 2)}
          </KeyValue>
          <KeyValue label="Skills">
            {employee.skills.length === 0 ? '—' : employee.skills.map((skill) => `${skill.name} ${skill.level}`).join(', ')}
          </KeyValue>
          {employee.automatedCapability && <KeyValue label="Automation capability">{humanise(employee.automatedCapability)}</KeyValue>}
        </dl>
      </div>

      <div className="space-y-2">
        <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Dismiss</h4>
        <p className="text-xs text-ink-dim">Severance is negotiable in law only; the higher it is, the less the rest of the crew notices. Loyalty of the remaining staff moves when someone is thrown out.</p>
        <CommandButton
          intent={{ type: 'crew.fire', employeeId: employee.id, severanceDays: 7 }}
          label="Dismiss with severance"
          variant="secondary"
          confirm={{ title: `Dismiss ${employee.name}?`, body: 'Seven days of severance is paid, their assignment is cleared and any business or line they managed is left unattended.', confirmLabel: 'Dismiss' }}
        />
        <CommandButton
          intent={{ type: 'crew.fire', employeeId: employee.id, severanceDays: 0 }}
          label="Dismiss without severance"
          variant="danger"
          confirm={{ title: `Dismiss ${employee.name} without pay?`, body: 'Cheaper now, but the crew sees it: morale and loyalty fall, and some of them start looking at you differently.', confirmLabel: 'Dismiss without pay', destructive: true }}
        />
      </div>
    </div>
  );
}

function Hiring() {
  const crew = useView<CrewView>('crew');
  const [roleFilter, setRoleFilter] = useState('');
  const [sort, setSort] = useState<'value' | 'salary' | 'skill'>('value');

  const candidates = crew.data?.candidates ?? [];
  const roles = [...new Set(candidates.map((candidate) => candidate.role))];
  const visible = candidates
    .filter((candidate) => !roleFilter || candidate.role === roleFilter)
    .sort((a, b) => (sort === 'salary' ? a.salaryAskPerDay - b.salaryAskPerDay : sort === 'skill' ? b.stats.skill - a.stats.skill : b.valueScore - a.valueScore));

  return (
    <ViewPanel<CrewView>
      view="crew"
      title="Local hiring pool"
      subtitle="Who is looking for work where you are"
      isEmpty={(data) => data.candidates.length === 0}
      emptyTitle="Nobody is looking for work here"
      emptyBody="The pool refreshes over time and differs by location — a port attracts different people from a capital. Advance a few days or travel elsewhere."
      actions={
        <>
          <label className="flex items-center gap-2 text-xs text-ink-dim">
            <span>Role</span>
            <Select aria-label="Candidate role" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="">All roles</option>
              {roles.map((role) => (
                <option key={role} value={role}>
                  {humanise(role)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-dim">
            <span>Sort</span>
            <Select aria-label="Sort candidates" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
              <option value="value">Best value</option>
              <option value="skill">Highest skill</option>
              <option value="salary">Cheapest</option>
            </Select>
          </label>
          <CommandButton intent={{ type: 'crew.refresh_pool' }} label="Refresh pool" size="sm" variant="secondary" />
        </>
      }
    >
      {() => (
        <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((candidate) => (
            <CandidateCard key={candidate.id} candidate={candidate} />
          ))}
        </ul>
      )}
    </ViewPanel>
  );
}

function CandidateCard({ candidate }: { candidate: CandidateRow }) {
  return (
    <li className="rounded-panel border border-line bg-panel px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-ink">{candidate.name}</h3>
          <p className="text-[11px] text-ink-faint">
            {candidate.roleName} · level {candidate.level} · {candidate.locationName}
            {candidate.here ? '' : ' (elsewhere)'}
          </p>
        </div>
        <Badge tone={candidate.valueScore > 0.7 ? 'up' : candidate.valueScore > 0.4 ? 'info' : 'neutral'}>value {num(candidate.valueScore, 2)}</Badge>
      </div>
      <div className="mt-2 space-y-1">
        <Meter value={candidate.stats.skill} label="Skill" display={num(candidate.stats.skill, 2)} tone="gold" />
        <Meter value={candidate.stats.loyalty} label="Loyalty expectation" display={num(candidate.stats.loyalty, 2)} tone="info" />
        <Meter value={candidate.stats.discretion} label="Discretion" display={num(candidate.stats.discretion, 2)} tone="violet" />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3">
        <KeyValue label="Salary ask">{money(candidate.salaryAskPerDay)}/day</KeyValue>
        <KeyValue label="Hiring fee">{money(candidate.hiringFee)}</KeyValue>
        <KeyValue label="Capability">{candidate.automationCapability ? humanise(candidate.automationCapability) : 'none'}</KeyValue>
        <KeyValue label="Skills">{candidate.skills.length === 0 ? '—' : candidate.skills.map((skill) => `${skill.name} ${skill.level}`).join(', ')}</KeyValue>
      </dl>
      {candidate.personalObjective && <p className="mt-1 text-[11px] text-ink-faint">Wants: {candidate.personalObjective}</p>}
      <div className="mt-2">
        <CommandButton
          intent={{ type: 'crew.hire', candidateId: candidate.id }}
          label={`Hire for ${money(candidate.hiringFee)}`}
          size="sm"
          variant="success"
          disabled={!candidate.here}
          disabledReason="They are not at your location. Travel to them or hire locally."
        />
      </div>
    </li>
  );
}

function Payroll() {
  const crew = useView<CrewView>('crew');
  const data = crew.data;
  const { gameId } = useGame();
  if (!data) return null;

  const byRole = data.summary.byRole ?? [];
  const byAssignment = data.summary.byAssignment ?? [];

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title="Payroll" subtitle={`${money(data.payrollForecastPerDay)} per simulated day`}>
        <dl className="space-y-0.5">
          <KeyValue label="Headcount">{data.summary.headcount}</KeyValue>
          <KeyValue label="Payroll / day">{money(data.summary.payrollPerDay)}</KeyValue>
          <KeyValue label="Share of revenue">{pct(data.summary.payrollShareOfRevenue, { from: 'fraction', decimals: 1 })}</KeyValue>
          <KeyValue label="Unpaid wages" tone={data.summary.unpaidWages > 0 ? 'text-down' : undefined}>
            {money(data.summary.unpaidWages)}
          </KeyValue>
          <KeyValue label="Injured">{data.summary.injured}</KeyValue>
          <KeyValue label="Training">{data.summary.training}</KeyValue>
          <KeyValue label="Unassigned">{data.summary.unassigned}</KeyValue>
        </dl>
        <div className="mt-3">
          <CommandButton
            intent={{ type: 'crew.pay_wages' }}
            label="Pay outstanding wages"
            variant="primary"
            disabled={data.summary.unpaidWages <= 0}
            disabledReason="There are no unpaid wages."
          />
          <p className="mt-1 text-[11px] text-ink-faint">Unpaid staff lose loyalty, then morale, then discretion — in that order, and the third one is what gets you caught.</p>
        </div>
      </Panel>

      <Panel title="Where the money goes" subtitle="Payroll by role and by assignment">
        <h3 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">By role</h3>
        {byRole.length === 0 ? (
          <p className="text-xs text-ink-faint">No employees on the payroll.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {byRole.map((row) => (
              <li key={row.role} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-ink-dim">
                    {humanise(row.role)} × {row.count}
                  </span>
                  <span className="tnum text-ink">{money(row.payrollPerDay)}/day</span>
                </div>
                <Progress value={data.summary.payrollPerDay > 0 ? row.payrollPerDay / data.summary.payrollPerDay : 0} label={`${humanise(row.role)} share of payroll`} />
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-3 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">By assignment</h3>
        {byAssignment.length === 0 ? (
          <p className="text-xs text-ink-faint">Everyone is unassigned.</p>
        ) : (
          <ul className="mt-1 grid grid-cols-2 gap-1">
            {byAssignment.map((row) => (
              <li key={row.kind} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-ink-dim">{humanise(row.kind)}</span>
                <span className="tnum text-ink">{row.count}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Span of control</p>
          <p className="mt-0.5 text-xs text-ink-dim">{data.span.explanation}</p>
          <dl className="mt-1">
            <KeyValue label="Crew per manager">{`${data.span.crew} / ${data.span.capacity}`}</KeyValue>
            <KeyValue label="Managers">{`${data.span.managers} / ${data.span.managerCapacity}`}</KeyValue>
            {data.span.overloaded && <KeyValue label="Morale penalty" tone="text-warn">{pct(data.span.moralePenalty, { from: 'fraction', decimals: 1 })} per day</KeyValue>}
          </dl>
        </div>
        <p className="mt-3 text-[11px] text-ink-faint">
          Save <span className="tnum">{gameId}</span> — every wage, risk and capability here is computed by the simulation, not the browser.
        </p>
      </Panel>

      {data.summary.highestRisk.length > 0 && (
        <Panel title="Watch list" subtitle="The employees the server rates as most likely to cause trouble" className="lg:col-span-2">
          <ul className="space-y-1">
            {data.summary.highestRisk.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-ink">{row.name}</span>
                <span className="text-ink-faint">{row.reason}</span>
                <span className="tnum text-warn">{pct(row.risk, { from: 'fraction', decimals: 0 })}</span>
              </li>
            ))}
          </ul>
          <InlineNote tone="warn">Pay them, keep them busy, or keep them away from the ledger. Disloyal staff steal, talk and occasionally leave with a customer list.</InlineNote>
        </Panel>
      )}

      <div className="lg:col-span-2">
        <EmptyState
          title="Hiring is a local decision"
          body="The pool is generated per location and refreshes with time. Some roles only turn up in cities with the right industry — pilots and engineers near ports, hackers near data centres."
        />
      </div>
    </div>
  );
}
