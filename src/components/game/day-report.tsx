'use client';

/**
 * The day report.
 *
 * This is the debrief the player reads after time passes: what moved, what it cost, what
 * went wrong and what is now waiting for them. Every number comes from the authoritative
 * `DayReportDto` / `MultiDayReportDto` the advance command returned — the panel groups
 * and labels them, and only shows a section when the server reported something in it, so
 * a quiet day reads as a quiet day instead of a wall of zeroes.
 */
import { useState } from 'react';
import type { DayReportDto, MultiDayReportDto } from '../../server/dto';
import { Badge, Button, KeyValue, Stat, Table, Td, Th, Tr } from '../ui/primitives';
import { money, num, pct } from '../../lib/format';

type AnyReport = DayReportDto | MultiDayReportDto;

function isMulti(report: AnyReport): report is MultiDayReportDto {
  return 'reports' in report && Array.isArray((report as MultiDayReportDto).reports);
}

export function DayReport({ report }: { report: AnyReport | null }) {
  const [showAllDays, setShowAllDays] = useState(false);

  if (!report) {
    return <p className="py-4 text-center text-xs text-ink-faint">No report was returned for that advance.</p>;
  }

  const multi = isMulti(report) ? report : null;
  const days: DayReportDto[] = multi ? multi.reports : [report as DayReportDto];
  const last = days[days.length - 1]!;
  const startTotal = multi ? multi.netWorthStart : (report as DayReportDto).netWorth.total - (report as DayReportDto).netWorthChange;
  const endTotal = multi ? multi.netWorthEnd : (report as DayReportDto).netWorth.total;
  const change = multi ? multi.netWorthChange : (report as DayReportDto).netWorthChange;

  const highlights = multi ? multi.highlights : (report as DayReportDto).phases.filter((phase) => phase.severity !== 'info');
  const news = days.flatMap((day) => day.news ?? []);
  const notifications = days.flatMap((day) => day.notifications ?? []);
  const risks = days.filter((day) => day.enforcement.raided || day.enforcement.combat || day.theft.length > 0 || day.prison.incarcerated || day.ending);
  const shownDays = showAllDays ? days : days.slice(-3);

  return (
    <div className="space-y-4">
      {/* Financial headline */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Net worth before" value={money(startTotal)} compact />
        <Stat label="Net worth after" value={money(endTotal)} compact />
        <Stat label="Change" value={money(change, { sign: true })} tone={change >= 0 ? 'up' : 'down'} compact />
        <Stat label={multi ? 'Days advanced' : 'Empire score'} value={multi ? num(multi.days) : num(last.empireScore, 0)} compact />
      </div>

      {multi?.stoppedEarly && (
        <p className="rounded border border-warn/40 bg-warn-soft/40 px-3 py-2 text-xs text-warn">
          Time stopped early: {multi.stopReason ?? 'something needed your attention'}.
        </p>
      )}

      {risks.length > 0 && (
        <section aria-label="Risks this period" className="rounded-panel border border-down/40 bg-down-soft/30 px-3 py-2">
          <h3 className="text-xs font-semibold tracking-wide text-down uppercase">Needs attention</h3>
          <ul className="mt-1 space-y-1 text-xs text-ink-dim">
            {risks.map((day) => (
              <li key={day.day}>
                <span className="font-semibold text-ink">Day {day.day}:</span>{' '}
                {[
                  day.enforcement.raided ? 'you were raided' : null,
                  day.enforcement.combat ? 'an encounter started' : null,
                  day.theft.length > 0 ? `${day.theft.length} theft event(s)` : null,
                  day.prison.incarcerated ? `in custody, ${day.prison.daysRemaining} day(s) remaining` : null,
                  day.ending ? `run ended: ${day.ending.summary}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Narrative highlights */}
      {highlights.length > 0 && (
        <section aria-label="Highlights">
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-faint uppercase">What happened</h3>
          <ul className="space-y-1.5">
            {highlights.slice(0, 10).map((phase, index) => (
              <li key={`${phase.system}-${index}`} className="rounded border border-line bg-panel-2/50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge tone={phase.severity === 'danger' ? 'down' : phase.severity === 'warning' ? 'warn' : phase.severity === 'good' ? 'up' : 'info'}>{phase.severity}</Badge>
                  <span className="text-sm text-ink">{phase.summary}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Per-day breakdown */}
      <section aria-label="Per-day detail">
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Day by day</h3>
          {days.length > 3 && (
            <Button size="sm" variant="ghost" onClick={() => setShowAllDays((value) => !value)}>
              {showAllDays ? 'Show recent only' : `Show all ${days.length} days`}
            </Button>
          )}
        </div>
        <Table label="Daily results">
          <thead>
            <tr>
              <Th>Day</Th>
              <Th align="right">Net worth change</Th>
              <Th align="right">Cash</Th>
              <Th align="right">Inventory</Th>
              <Th align="right">Dividends</Th>
              <Th align="right">Wages paid</Th>
              <Th align="right">Business profit</Th>
              <Th align="left">Notes</Th>
            </tr>
          </thead>
          <tbody>
            {shownDays.map((day) => (
              <Tr key={day.day}>
                <Td className="tnum">{day.day}</Td>
                <Td align="right" className={`tnum ${day.netWorthChange >= 0 ? 'text-up' : 'text-down'}`}>
                  {money(day.netWorthChange, { sign: true })}
                </Td>
                <Td align="right" className="tnum">{money(day.netWorth.cash, { compact: true })}</Td>
                <Td align="right" className="tnum">{money(day.netWorth.inventory, { compact: true })}</Td>
                <Td align="right" className="tnum">{money(day.companies.dividendsPaidToPlayer)}</Td>
                <Td align="right" className="tnum">{money(day.payroll.totalSalary)}</Td>
                <Td align="right" className="tnum">{money(day.businesses.totalProfit)}</Td>
                <Td>
                  <span className="text-xs text-ink-faint">
                    {day.phases.filter((phase) => phase.severity !== 'info').length > 0
                      ? day.phases.filter((phase) => phase.severity !== 'info')[0]!.summary
                      : '—'}
                  </span>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Markets */}
        {last.marketMovers.length > 0 && (
          <Section title="Biggest market movers">
            <Table label="Market movers">
              <thead>
                <tr>
                  <Th>Commodity</Th>
                  <Th align="right">Change</Th>
                  <Th align="right">Price</Th>
                </tr>
              </thead>
              <tbody>
                {last.marketMovers.slice(0, 6).map((mover) => (
                  <Tr key={`${mover.commodityId}-${mover.locationId}`}>
                    <Td className="text-xs">{mover.name}</Td>
                    <Td align="right" className={`tnum ${mover.change >= 0 ? 'text-up' : 'text-down'}`}>
                      {pct(mover.change, { from: 'fraction', sign: true })}
                    </Td>
                    <Td align="right" className="tnum">{money(mover.price)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Section>
        )}

        {/* Operations */}
        <Section title="Operations">
          <dl>
            <KeyValue label="Business profit">{money(last.businesses.totalProfit)}</KeyValue>
            <KeyValue label="Production output">{money(last.production.totalOutputValue)}</KeyValue>
            <KeyValue label="Production cost">{money(last.production.totalCost)}</KeyValue>
            <KeyValue label="Freight spend">{money(last.logistics.freightSpend)}</KeyValue>
            <KeyValue label="Property costs">{money(last.properties.opex + last.properties.tax + last.properties.insurance)}</KeyValue>
            <KeyValue label="Automation profit">{money(last.automation.profit)}</KeyValue>
            <KeyValue label="Payroll paid">{money(last.payroll.paid)}</KeyValue>
            {last.payroll.unpaid > 0 && <KeyValue label="Wages unpaid" tone="text-warn">{money(last.payroll.unpaid)}</KeyValue>}
          </dl>
          {last.businesses.suspended > 0 && <p className="mt-2 text-xs text-warn">{last.businesses.suspended} business(es) suspended.</p>}
          {last.production.blocked.length > 0 && <p className="mt-1 text-xs text-warn">{last.production.blocked.length} production line(s) blocked.</p>}
        </Section>

        {/* Finance */}
        <Section title="Finance">
          <dl>
            <KeyValue label="Interest earned">{money(last.finance.interestEarned)}</KeyValue>
            <KeyValue label="Loan interest accrued">{money(last.finance.loans.interestAccrued)}</KeyValue>
            <KeyValue label="Scheduled repayments">{money(last.finance.loans.scheduledPayments)}</KeyValue>
            {last.finance.loans.lateFees > 0 && <KeyValue label="Late fees" tone="text-down">{money(last.finance.loans.lateFees)}</KeyValue>}
            <KeyValue label="Laundered">{money(last.finance.laundering.cleaned)}</KeyValue>
            <KeyValue label="Laundering fees">{money(last.finance.laundering.fees)}</KeyValue>
            <KeyValue label="Tax paid">{money(last.finance.tax.paid)}</KeyValue>
            {last.finance.tax.arrearsAdded > 0 && <KeyValue label="Arrears added" tone="text-down">{money(last.finance.tax.arrearsAdded)}</KeyValue>}
          </dl>
          {(last.finance.loans.defaults.length > 0 || last.finance.tax.audited || last.finance.tax.accountFrozen) && (
            <p className="mt-2 rounded border border-down/40 bg-down-soft/40 px-2 py-1 text-xs text-down">
              {[
                last.finance.loans.defaults.length > 0 ? `${last.finance.loans.defaults.length} loan default(s)` : null,
                last.finance.tax.audited ? 'a tax audit was opened' : null,
                last.finance.tax.accountFrozen ? 'an account was frozen' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </Section>

        {/* People */}
        <Section title="People">
          <dl>
            <KeyValue label="Salaries paid">{money(last.payroll.totalSalary)}</KeyValue>
            <KeyValue label="Injuries">{num(last.payroll.injuries)}</KeyValue>
            <KeyValue label="Departures">{num(last.payroll.departures.length)}</KeyValue>
            <KeyValue label="Betrayals">{num(last.payroll.betrayals.length)}</KeyValue>
            <KeyValue label="Promotions">{num(last.payroll.promotions.length)}</KeyValue>
            <KeyValue label="Missions completed">{num(last.missions?.completed.length ?? 0)}</KeyValue>
            <KeyValue label="Missions expired">{num(last.missions?.expired.length ?? 0)}</KeyValue>
          </dl>
        </Section>
      </div>

      {/* World news */}
      {news.length > 0 && (
        <Section title="World news" subtitle={`${news.length} headline(s) over the period`}>
          <ul className="space-y-1.5">
            {news.slice(0, 8).map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                <Badge tone={item.category === 'crime' ? 'down' : item.category === 'market' ? 'info' : 'neutral'}>{item.category}</Badge>
                <div className="min-w-0">
                  <p className="text-sm text-ink">{item.headline}</p>
                  {item.body && <p className="text-xs text-ink-dim">{item.body}</p>}
                  <p className="text-[11px] text-ink-faint">
                    Day {item.day} · {item.scope}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {notifications.length > 0 && (
        <Section title="Your notifications">
          <ul className="space-y-1">
            {notifications.slice(0, 8).map((notification) => (
              <li key={notification.id} className="flex items-start gap-2 text-xs">
                <Badge tone={notification.kind === 'danger' ? 'down' : notification.kind === 'warning' ? 'warn' : notification.kind === 'success' ? 'up' : 'info'}>{notification.kind}</Badge>
                <span className="text-ink-dim">
                  <span className="font-medium text-ink">{notification.title}</span> — {notification.body}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-panel border border-line bg-panel/60 px-3 py-2">
      <h3 className="text-xs font-semibold tracking-wide text-ink-faint uppercase">{title}</h3>
      {subtitle && <p className="mt-0.5 text-[11px] text-ink-faint">{subtitle}</p>}
      <div className="mt-1.5">{children}</div>
    </section>
  );
}
