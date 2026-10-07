'use client';

/**
 * Finance.
 *
 * Money in this game has a legal state: clean, dirty, offshore, frozen, owed. This screen
 * is the balance sheet plus the four things a player actually does with it — move money,
 * borrow, launder and settle tax — and it shows the *server's* verdict on each: the loan
 * offers are priced by the server, the laundering ceiling is the server's, the tax
 * liability is the server's, and the credit score is the server's with its factors listed.
 */
import { useState } from 'react';
import { useView } from '../../../../lib/game-context';
import { ViewPanel, CommandButton, QuantityPicker } from '../../../../components/game/view-panel';
import { Badge, Button, Input, KeyValue, Panel, Progress, Select, Table, Tabs, Td, Th, Tr } from '../../../../components/ui/primitives';
import { EmptyState, InlineNote } from '../../../../components/ui/states';
import { Sparkline } from '../../../../components/game/charts';
import { days, humanise, money, num, pct } from '../../../../lib/format';
import type { FinanceView, LoanOffer } from '../../../../lib/game-data';

type Tab = 'overview' | 'accounts' | 'borrow' | 'tax';

export default function FinancePage() {
  const finance = useView<FinanceView>('finance');
  const [tab, setTab] = useState<Tab>('overview');
  const core = finance.data?.finance;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Treasury</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">Finance</h1>
          <p className="mt-1 text-xs text-ink-dim">
            {core ? (
              <>
                {money(core.cash, { compact: true })} liquid · {money(core.dirty, { compact: true })} unlaundered · {money(core.debt, { compact: true })} owed ·{' '}
                {core.creditBand} credit
              </>
            ) : (
              'Opening the books…'
            )}
          </p>
        </div>
        <Tabs
          label="Finance sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'accounts', label: 'Accounts', count: finance.data?.accounts.length },
            { id: 'borrow', label: 'Borrow', count: finance.data?.finance.offers.length },
            { id: 'tax', label: 'Tax & laundering' },
          ]}
        />
      </header>

      {core?.bankruptcyRisk && core.bankruptcyRisk !== 'none' && (
        <InlineNote tone="down">
          Solvency warning: {core.bankruptcyRisk}. Creditors act on unpaid balances — repay, restructure or raise cash before the next tick.
        </InlineNote>
      )}

      {tab === 'overview' && <Overview />}
      {tab === 'accounts' && <Accounts />}
      {tab === 'borrow' && <Borrow />}
      {tab === 'tax' && <TaxAndLaundering />}
    </div>
  );
}

function Overview() {
  const finance = useView<FinanceView>('finance');
  const data = finance.data;
  if (!data) return <Panel title="Overview"><p className="text-xs text-ink-faint">Loading…</p></Panel>;
  const { finance: core, credit, debt } = data;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Liquid cash" value={money(core.cash)} sub={`${data.accounts.length} accounts`} />
        <Stat label="Clean / dirty" value={`${money(core.clean, { compact: true })} / ${money(core.dirty, { compact: true })}`} sub="dirty needs laundering" tone={core.dirty > 0 ? 'warn' : undefined} />
        <Stat label="Debt" value={money(core.debt)} sub={`service ${money(core.dailyDebtService)}/day · leverage ${num(core.leverage, 2)}×`} tone={core.debt > 0 ? 'down' : undefined} />
        <Stat label="Interest income" value={`${money(core.dailyInterestIncome)}/day`} sub={`credit ${core.creditScore} (${core.creditBand})`} tone="up" />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Credit position" subtitle={`Score ${credit.score} · ${credit.band}`}>
          <dl className="space-y-0.5">
            <KeyValue label="Max bank loan">{money(credit.maxBankLoan)}</KeyValue>
            <KeyValue label="Bank APR">{pct(credit.bankApr, { from: 'fraction', decimals: 2 })}</KeyValue>
            <KeyValue label="Credit utilisation">{pct(credit.utilisation, { from: 'fraction', decimals: 1 })}</KeyValue>
            <KeyValue label="Worst delinquency">{debt.worstDelinquency > 0 ? days(debt.worstDelinquency) : 'none'}</KeyValue>
            <KeyValue label="Collateral held">{money(debt.totalCollateralValue)}</KeyValue>
            <KeyValue label="Bankruptcy distance">{money(debt.bankruptcyDistance)}</KeyValue>
          </dl>
          {credit.factors.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Score drivers</p>
              <ul className="mt-1 space-y-0.5">
                {credit.factors.map((factor) => (
                  <li key={factor.label} className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="text-ink-dim">{factor.label}</span>
                    <span className={`tnum ${factor.impact >= 0 ? 'text-up' : 'text-down'}`}>
                      {factor.impact >= 0 ? '+' : '−'}
                      {num(Math.abs(factor.impact), 1)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {credit.history.length > 1 && (
            <div className="mt-3">
              <Sparkline points={credit.history.map((point) => ({ day: point.day, level: point.score }))} label="Credit score" tone={credit.score >= 650 ? 'up' : 'down'} />
            </div>
          )}
        </Panel>

        <Panel title="Laundering" subtitle="Turning dirty cash into money you can spend openly">
          <dl className="space-y-0.5">
            <KeyValue label="Dirty cash held">{money(core.laundering.buffer)}</KeyValue>
            <KeyValue label="Laundered to date">{money(core.laundering.launderedTotal)}</KeyValue>
            <KeyValue label="Fronts available">{core.laundering.fronts.length}</KeyValue>
          </dl>
          {core.laundering.fronts.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {core.laundering.fronts.map((front) => (
                <li key={front.id}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate text-ink-dim">{front.name}</span>
                    <span className="tnum text-ink-faint">
                      {money(front.usedPerDay)} / {money(front.capacityPerDay)} per day
                    </span>
                  </div>
                  <Progress value={front.capacityPerDay > 0 ? front.usedPerDay / front.capacityPerDay : 0} label="Front capacity used" />
                  {front.heat > 0.4 && <p className="mt-0.5 text-[11px] text-warn">Heat {pct(front.heat, { from: 'fraction', decimals: 0 })} — this front is drawing attention.</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-ink-faint">No fronts yet. A business you own becomes a front once it is open, and offshore accounts can absorb smaller amounts.</p>
          )}
        </Panel>

        <Panel title="Loans" subtitle={debt.totalOutstanding > 0 ? `${money(debt.totalDailyPayments)}/day in payments` : 'No debt outstanding'}>
          {data.finance.loans.length === 0 ? (
            <p className="text-xs text-ink-faint">You owe nothing. Credit history still builds from accounts, repayments and trading.</p>
          ) : (
            <ul className="space-y-2">
              {data.finance.loans.map((loan) => (
                <li key={loan.id} className="rounded border border-line bg-panel-2/40 px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-ink">{loan.lenderName}</span>
                    <Badge tone={loan.daysOverdue > 0 ? 'down' : loan.delinquency > 0 ? 'warn' : 'up'}>{humanise(loan.status)}</Badge>
                  </div>
                  <dl className="mt-1 grid grid-cols-2 gap-x-3">
                    <KeyValue label="Balance">{money(loan.balance)}</KeyValue>
                    <KeyValue label="APR">{pct(loan.apr, { from: 'fraction', decimals: 1 })}</KeyValue>
                    <KeyValue label="Payment">{money(loan.paymentPerDay)}/day</KeyValue>
                    <KeyValue label="Remaining">{days(loan.daysRemaining)}</KeyValue>
                  </dl>
                  {loan.daysOverdue > 0 && <p className="mt-1 text-[11px] text-down">{days(loan.daysOverdue)} overdue — collateral and standing are at risk.</p>}
                  <RepayRow loanId={loan.id} balance={loan.balance} paymentPerDay={loan.paymentPerDay} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Collateral register" subtitle="What lenders can take, and what they will lend against it">
        {core.collateral.lines.length === 0 ? (
          <p className="text-xs text-ink-faint">Nothing is pledged. Property, vehicles and holdings can be posted as collateral against larger loans.</p>
        ) : (
          <Table label="Collateral">
            <thead>
              <tr>
                <Th>Asset</Th>
                <Th>Kind</Th>
                <Th align="right">Value</Th>
                <Th align="right">Lendable</Th>
                <Th align="right">Haircut</Th>
              </tr>
            </thead>
            <tbody>
              {core.collateral.lines.map((line) => (
                <Tr key={`${line.kind}-${line.refId}`}>
                  <Td className="text-xs text-ink">{line.label}</Td>
                  <Td className="text-xs text-ink-dim">{humanise(line.kind)}</Td>
                  <Td align="right" className="tnum">{money(line.value)}</Td>
                  <Td align="right" className="tnum text-up">{money(line.lendable)}</Td>
                  <Td align="right" className="tnum text-xs text-ink-faint">{pct(1 - (line.value > 0 ? line.lendable / line.value : 0), { from: 'fraction', decimals: 0 })}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

function RepayRow({ loanId, balance, paymentPerDay }: { loanId: string; balance: number; paymentPerDay: number }) {
  const [amount, setAmount] = useState(Math.min(balance, Math.max(paymentPerDay, 1000)));
  return (
    <div className="mt-1.5">
      <QuantityPicker id={`repay-${loanId}`} label="Repay" value={amount} onChange={setAmount} max={balance} unit="cash" />
      <CommandButton
        intent={{ type: 'finance.repay_loan', loanId, amount }}
        label={amount >= balance ? 'Settle loan in full' : `Repay ${money(amount)}`}
        size="sm"
        variant={amount >= balance ? 'success' : 'secondary'}
        disabled={amount <= 0}
        disabledReason="Enter an amount to repay."
      />
    </div>
  );
}

function Accounts() {
  const finance = useView<FinanceView>('finance');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState(1000);
  const [openKind, setOpenKind] = useState<'checking' | 'savings' | 'offshore' | 'shell'>('checking');
  const [deposit, setDeposit] = useState(0);

  const accounts = finance.data?.accounts ?? [];
  const from = accounts.find((account) => account.id === fromId);
  const to = accounts.find((account) => account.id === toId);

  return (
    <div className="space-y-3">
      <ViewPanel<FinanceView>
        view="finance"
        title="Accounts"
        subtitle="Where the money actually sits — and what the server will let you do with it"
        isEmpty={(data) => data.accounts.length === 0}
        emptyTitle="No accounts"
        emptyBody="An account is opened at a bank in a location that has one. Salary, rent and taxes all settle through accounts."
      >
        {() => (
          <Table label="Accounts">
            <thead>
              <tr>
                <Th>Institution</Th>
                <Th>Kind</Th>
                <Th>Location</Th>
                <Th align="right">Balance</Th>
                <Th align="right">Clean / dirty</Th>
                <Th align="right">APY</Th>
                <Th align="right">Interest / day</Th>
                <Th align="right">Tax on deposits</Th>
                <Th>State</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <Tr key={account.id}>
                  <Td>
                    <span className="text-sm text-ink">{account.institution}</span>
                    {account.isSettlementAccount && <Badge tone="info">settlement</Badge>}
                    {account.offshore && <Badge tone="violet">offshore</Badge>}
                  </Td>
                  <Td className="text-xs text-ink-dim">{humanise(account.kind)}</Td>
                  <Td className="text-xs text-ink-dim">{account.locationName}</Td>
                  <Td align="right" className="tnum">{money(account.balance)}</Td>
                  <Td align="right" className="tnum text-xs">
                    <span className="text-up">{money(account.clean, { compact: true })}</span> / <span className={account.dirty > 0 ? 'text-warn' : 'text-ink-faint'}>{money(account.dirty, { compact: true })}</span>
                  </Td>
                  <Td align="right" className="tnum text-xs">{pct(account.apy, { from: 'fraction', decimals: 2 })}</Td>
                  <Td align="right" className="tnum text-xs">{money(account.dailyInterest)}</Td>
                  <Td align="right" className="tnum text-xs">{pct(account.taxRateApplied, { from: 'fraction', decimals: 1 })}</Td>
                  <Td className="text-[11px]">
                    {account.frozen ? (
                      <Badge tone="down">{account.freezeReason ?? 'frozen'}</Badge>
                    ) : account.usable ? (
                      <Badge tone="up">usable</Badge>
                    ) : (
                      <Badge tone="warn">restricted</Badge>
                    )}
                  </Td>
                  <Td align="right">
                    <CommandButton
                      intent={{ type: 'finance.close_account', accountId: account.id }}
                      label="Close"
                      size="sm"
                      variant="ghost"
                      disabled={account.balance > 0}
                      disabledReason="Empty the account before closing it."
                      confirm={{ title: `Close this ${humanise(account.kind)} account?`, body: `The account at ${account.institution} is closed permanently.`, confirmLabel: 'Close account', destructive: true }}
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </ViewPanel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Transfer between accounts" subtitle="Instant, and taxed according to where the money lands">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs">
              <span className="mb-1 block text-ink-dim">From</span>
              <Select value={fromId} onChange={(event) => setFromId(event.target.value)}>
                <option value="">Choose…</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.institution} — {money(account.balance)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-ink-dim">To</span>
              <Select value={toId} onChange={(event) => setToId(event.target.value)}>
                <option value="">Choose…</option>
                {accounts
                  .filter((account) => account.id !== fromId)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.institution} — {money(account.balance)}
                    </option>
                  ))}
              </Select>
            </label>
          </div>
          <div className="mt-2">
            <QuantityPicker value={amount} onChange={setAmount} max={from?.balance ?? 0} unit="cash" label="Amount" id="transfer-amount" />
          </div>
          {from && to && amount > 0 && (
            <p className="mt-1 text-[11px] text-ink-faint">
              {money(amount)} from {from.institution} → {to.institution}. Destination tax rate {pct(to.taxRateApplied, { from: 'fraction', decimals: 1 })}.
            </p>
          )}
          <div className="mt-2">
            <CommandButton
              intent={{ type: 'finance.transfer', fromAccountId: fromId, toAccountId: toId, amount }}
              label="Transfer"
              variant="primary"
              disabled={!fromId || !toId || amount <= 0 || (from ? amount > from.balance : true)}
              disabledReason={!fromId || !toId ? 'Choose both accounts.' : amount > (from?.balance ?? 0) ? 'That account does not hold that much.' : 'Enter an amount.'}
            />
          </div>
        </Panel>

        <Panel title="Open an account" subtitle="Offshore and shell accounts exist where the jurisdiction allows them">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs">
              <span className="mb-1 block text-ink-dim">Kind</span>
              <Select value={openKind} onChange={(event) => setOpenKind(event.target.value as typeof openKind)}>
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="offshore">Offshore</option>
                <option value="shell">Shell</option>
              </Select>
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-ink-dim">Initial deposit (optional)</span>
              <Input type="number" min={0} value={deposit} onChange={(event) => setDeposit(Math.max(0, Number(event.target.value)))} />
            </label>
          </div>
          {(openKind === 'offshore' || openKind === 'shell') && (
            <p className="mt-2 text-[11px] text-ink-faint">
              Offshore accounts need a location with bank secrecy and are not offered everywhere. The server refuses the request where the jurisdiction does not allow it.
            </p>
          )}
          <div className="mt-2">
            <CommandButton
              intent={{ type: 'finance.open_account', kind: openKind, ...(deposit > 0 ? { initialDeposit: deposit } : {}), ...(openKind === 'offshore' || openKind === 'shell' ? { offshore: true } : {}) }}
              label="Open account"
              variant="secondary"
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Borrow() {
  const finance = useView<FinanceView>('finance');
  const offers = finance.data?.finance.offers ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const [termDays, setTermDays] = useState(0);

  const offer: LoanOffer | undefined = offers.find((item) => item.kind === selected) ?? offers[0];
  const chosenAmount = amount || offer?.amount || 0;
  const chosenTerm = termDays || offer?.termDays || 30;

  return (
    <div className="space-y-3">
      <ViewPanel<FinanceView>
        view="finance"
        title="Loan offers"
        subtitle="Priced by the lender from your credit, collateral and the world interest rate"
        isEmpty={(data) => data.finance.offers.length === 0}
        emptyTitle="No offers on the table"
        emptyBody="Lenders appear once you have accounts and some history where you are standing. Loan sharks lend anywhere, at a price."
      >
        {() => (
          <Table label="Loan offers">
            <thead>
              <tr>
                <Th>Lender</Th>
                <Th>Kind</Th>
                <Th align="right">Amount</Th>
                <Th align="right">APR</Th>
                <Th align="right">Term</Th>
                <Th align="right">Payment / day</Th>
                <Th align="right">Origination</Th>
                <Th align="right">Total interest</Th>
                <Th align="right">Approval</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {offers.map((item) => (
                <Tr key={item.kind} highlight={offer?.kind === item.kind}>
                  <Td>
                    <span className="text-sm text-ink">{item.lenderName}</span>
                    <span className="block text-[11px] text-ink-faint">{humanise(item.method)} · compounding {item.compoundingPeriodDays}d</span>
                  </Td>
                  <Td className="text-xs text-ink-dim">{humanise(item.kind)}</Td>
                  <Td align="right" className="tnum">
                    {money(item.amount)}
                    <span className="block text-[11px] text-ink-faint">max {money(item.maxAmount)}</span>
                  </Td>
                  <Td align="right" className="tnum">{pct(item.apr, { from: 'fraction', decimals: 1 })}</Td>
                  <Td align="right" className="tnum text-xs">{item.termOptions.join(' / ')}d</Td>
                  <Td align="right" className="tnum">{money(item.paymentPerDay)}</Td>
                  <Td align="right" className="tnum text-xs">{money(item.originationFee)}</Td>
                  <Td align="right" className="tnum text-down">{money(item.totalInterest)}</Td>
                  <Td align="right" className="tnum text-xs">{pct(item.approvalChance, { from: 'fraction', decimals: 0 })}</Td>
                  <Td align="right">
                    <Button size="sm" variant={offer?.kind === item.kind ? 'primary' : 'secondary'} onClick={() => { setSelected(item.kind); setAmount(item.amount); setTermDays(item.termDays); }}>
                      {offer?.kind === item.kind ? 'Selected' : 'Choose'}
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </ViewPanel>

      {offer && (
        <Panel
          title={`Take a ${humanise(offer.kind)} loan from ${offer.lenderName}`}
          subtitle={`${pct(offer.apr, { from: 'fraction', decimals: 2 })} APR · ${money(offer.paymentPerDay)}/day at the displayed amount`}
          actions={<Badge tone={offer.available ? 'up' : 'warn'}>{offer.available ? 'available' : 'conditions unmet'}</Badge>}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <QuantityPicker value={chosenAmount} onChange={setAmount} max={offer.maxAmount} unit="cash" label="Principal" id="loan-amount" step={1000} />
              <p className="text-[11px] text-ink-faint">Maximum the lender will consider: {money(offer.maxAmount)}.</p>
            </div>
            <label className="text-xs">
              <span className="mb-1 block text-ink-dim">Term</span>
              <Select value={chosenTerm} onChange={(event) => setTermDays(Number(event.target.value))}>
                {offer.termOptions.map((option) => (
                  <option key={option} value={option}>
                    {option} days
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[11px] text-ink-faint">
                Collateral required: {money(offer.collateralRequired)} (haircut {pct(offer.collateralHaircut, { from: 'fraction', decimals: 0 })}).
              </p>
            </label>
            <div className="space-y-1">
              <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Estimated cost at this size</p>
              <p className="tnum text-sm text-down">{money((offer.totalInterest / Math.max(1, offer.amount)) * chosenAmount)} in interest</p>
              <p className="text-[11px] text-ink-faint">
                Overdue pressure: {pct(offer.pressurePerDayOverdue, { from: 'fraction', decimals: 2 })} per day. Missing payments damages credit and invites enforcement.
              </p>
              <CommandButton
                intent={{ type: 'finance.take_loan', kind: offer.kind, amount: chosenAmount, termDays: chosenTerm }}
                label={`Borrow ${money(chosenAmount)}`}
                variant="primary"
                disabled={!offer.available || chosenAmount <= 0}
                disabledReason={!offer.available ? 'The lender will not lend on these terms right now.' : 'Enter an amount.'}
                confirm={{
                  title: `Borrow ${money(chosenAmount)}?`,
                  body: `You commit to ${money(offer.paymentPerDay)} per day for ${offer.termDays} days, and ${money(offer.collateralRequired)} of collateral may be pledged. Defaulting accelerates the debt and damages your credit.`,
                  confirmLabel: 'Accept the loan',
                }}
              />
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}

function TaxAndLaundering() {
  const finance = useView<FinanceView>('finance');
  const [launderAmount, setLaunderAmount] = useState(0);
  const [taxAmount, setTaxAmount] = useState(0);
  const [frontId, setFrontId] = useState('');
  const data = finance.data;
  if (!data) return null;
  const { tax, laundering } = data.finance;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title="Tax position" subtitle={`Period day ${tax.periodStartDay} → ${tax.periodEndDay}`} tone={tax.arrears > 0 ? 'warn' : 'default'}>
        <dl className="space-y-0.5">
          <KeyValue label="Taxable income">{money(tax.taxableIncome)}</KeyValue>
          <KeyValue label="Gross liability">{money(tax.grossLiability)}</KeyValue>
          <KeyValue label="Reductions">{money(tax.reductions)}</KeyValue>
          <KeyValue label="Net liability">{money(tax.liability)}</KeyValue>
          <KeyValue label="Paid this period">{money(tax.paid)}</KeyValue>
          <KeyValue label="Arrears" tone={tax.arrears > 0 ? 'text-down' : undefined}>
            {money(tax.arrears)}
          </KeyValue>
          <KeyValue label="Effective rate">{pct(tax.effectiveRate, { from: 'fraction', decimals: 1 })}</KeyValue>
          <KeyValue label="Offshore share">{pct(tax.offshoreShare, { from: 'fraction', decimals: 1 })}</KeyValue>
          <KeyValue label="Audit risk" tone={tax.auditRisk > 0.4 ? 'text-warn' : undefined}>
            {pct(tax.auditRisk, { from: 'fraction', decimals: 0 })}
          </KeyValue>
        </dl>
        {tax.lines.length > 0 && (
          <Table label="Tax lines" className="mt-3">
            <thead>
              <tr>
                <Th>Line</Th>
                <Th align="right">Rate</Th>
                <Th align="right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {tax.lines.map((line) => (
                <Tr key={line.label}>
                  <Td className="text-xs text-ink-dim">
                    {line.label}
                    {line.note && <span className="block text-[11px] text-ink-faint">{line.note}</span>}
                  </Td>
                  <Td align="right" className="tnum text-xs">{line.rate === undefined ? '—' : pct(line.rate, { from: 'fraction', decimals: 1 })}</Td>
                  <Td align="right" className="tnum">{money(line.amount)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="mt-3">
          <QuantityPicker value={taxAmount || Math.max(0, Math.ceil(tax.liability - tax.paid))} onChange={setTaxAmount} unit="cash" label="Pay tax" id="pay-tax" />
          <CommandButton
            intent={{ type: 'finance.pay_tax', amount: taxAmount || Math.max(0, Math.ceil(tax.liability - tax.paid)) }}
            label="Pay tax"
            variant="secondary"
            disabled={(taxAmount || tax.liability - tax.paid) <= 0}
            disabledReason="Nothing is outstanding."
          />
        </div>
        {tax.arrears > 0 && <InlineNote tone="warn">Arrears accrue penalties and raise audit risk. Paying down the liability early is cheaper than being audited.</InlineNote>}
      </Panel>

      <Panel title="Laundering" subtitle="Dirty cash becomes spendable at a cost and with a risk of detection">
        <dl className="space-y-0.5">
          <KeyValue label="Dirty cash held">{money(laundering.buffer)}</KeyValue>
          <KeyValue label="Laundered to date">{money(laundering.launderedTotal)}</KeyValue>
          <KeyValue label="Fronts">{laundering.fronts.length}</KeyValue>
        </dl>
        <div className="mt-3 space-y-2">
          {laundering.fronts.length > 0 && (
            <label className="block text-xs">
              <span className="mb-1 block text-ink-dim">Route through</span>
              <Select value={frontId} onChange={(event) => setFrontId(event.target.value)}>
                <option value="">Any available front</option>
                {laundering.fronts.map((front) => (
                  <option key={front.id} value={front.id}>
                    {front.name} — {money(front.capacityPerDay - front.usedPerDay)} capacity left today
                  </option>
                ))}
              </Select>
            </label>
          )}
          <QuantityPicker value={launderAmount} onChange={setLaunderAmount} max={laundering.buffer} unit="dirty cash" label="Amount to launder" id="launder-amount" step={500} />
          <CommandButton
            intent={{ type: 'finance.launder', amount: launderAmount }}
            label="Launder cash"
            variant="primary"
            disabled={launderAmount <= 0 || launderAmount > laundering.buffer}
            disabledReason={laundering.buffer <= 0 ? 'You are not holding unlaundered cash.' : 'Enter an amount within your dirty cash.'}
            confirm={launderAmount >= 50000 ? { title: 'Launder this much?', body: 'Large volumes raise detection risk and the fee is taken on the way through.', confirmLabel: 'Launder' } : undefined}
          />
          {laundering.fronts.length === 0 && (
            <EmptyState
              title="No front to launder through"
              body="Open a business — its till is the classic front — or buy into a jurisdiction that looks the other way. Until then dirty cash stays dirty and cannot be banked."
            />
          )}
          <p className="text-[11px] text-ink-faint">{frontId ? 'Routing through the selected front.' : 'The server picks the best available front and charges its fee.'}</p>
        </div>
      </Panel>
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
