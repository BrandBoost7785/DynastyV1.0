'use client';

/**
 * Stocks.
 *
 * Equities are a slower, more institutional version of the commodity market: listed
 * companies with earnings, dividends, betas and sectors, traded through a brokerage
 * account that has to be opened somewhere that has an exchange.
 *
 * Prices, fair value, portfolio risk and the index all come from the server's own market
 * model — the browser never prices a share or computes a return.
 */
import { useState } from 'react';
import { useGame, useView } from '../../../../lib/game-context';
import { ViewPanel, CommandButton, QuantityPicker } from '../../../../components/game/view-panel';
import { Button, Delta, Input, KeyValue, Panel, Select, Table, Tabs, Td, Th, Tr } from '../../../../components/ui/primitives';
import { EmptyState, InlineNote } from '../../../../components/ui/states';
import { BarList, Sparkline } from '../../../../components/game/charts';
import { humanise, money, num, pct } from '../../../../lib/format';
import type { StockRow, StocksView } from '../../../../lib/game-data';

type Tab = 'market' | 'portfolio' | 'risk';

export default function StocksPage() {
  const stocks = useView<StocksView>('stocks');
  const market = stocks.data?.market;
  const [tab, setTab] = useState<Tab>('market');

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Public markets</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">Stocks</h1>
          <p className="mt-1 text-xs text-ink-dim">
            {market
              ? market.brokerageAccountId
                ? `Index ${num(market.indexLevel, 2)} (${pct(market.indexChange1d, { from: 'fraction', sign: true, decimals: 2 })} today) · portfolio ${money(market.portfolioValue)}`
                : 'No brokerage account yet — open one to trade listed companies.'
              : 'Opening the exchange…'}
          </p>
        </div>
        <Tabs
          label="Stock sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'market', label: 'Market', count: market?.all.length },
            { id: 'portfolio', label: 'Portfolio', count: market?.holdings.length },
            { id: 'risk', label: 'Risk' },
          ]}
        />
      </header>

      {market && !market.brokerageAccountId && (
        <Panel title="Open a brokerage account" subtitle="Equities settle through a brokerage account, opened where there is an exchange" tone="info">
          <p className="text-xs text-ink-dim">
            The account holds your cash and shares. Opening it is free; keeping it is not — settlement, custody and tax apply to what you hold and what you sell.
          </p>
          <div className="mt-2">
            <CommandButton intent={{ type: 'stocks.open_account' }} label="Open brokerage account" variant="primary" />
          </div>
        </Panel>
      )}

      {tab === 'market' && <Market />}
      {tab === 'portfolio' && <Portfolio />}
      {tab === 'risk' && <Risk />}
    </div>
  );
}

function Market() {
  const stocks = useView<StocksView>('stocks');
  const [sector, setSector] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'marketCap' | 'change' | 'pe' | 'yield'>('marketCap');
  const [selected, setSelected] = useState<string | null>(null);

  const market = stocks.data?.market;
  const rows = market?.all ?? [];
  const sectors = market?.sectors.map((entry) => entry.sector) ?? [];

  const visible = rows
    .filter((row) => (!sector || row.sector === sector) && (!search || `${row.ticker} ${row.name}`.toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => {
      if (sort === 'change') return b.change1d - a.change1d;
      if (sort === 'pe') return (a.pe || Infinity) - (b.pe || Infinity);
      if (sort === 'yield') return b.dividendYield - a.dividendYield;
      return b.marketCap - a.marketCap;
    });

  const selectedRow = visible.find((row) => row.companyId === selected) ?? null;

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-3">
        {market && market.sectors.length > 0 && (
          <Panel title="Sector board" subtitle="Where the market's money is moving" bodyClassName="px-4 py-2">
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {market.sectors.map((entry) => (
                <li key={entry.sector} className="rounded border border-line bg-panel-2/40 px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-ink">{humanise(entry.sector)}</span>
                    <Delta value={entry.change1d} format={(value) => pct(value, { from: 'fraction', sign: true, decimals: 2 })} />
                  </div>
                  <p className="text-[11px] text-ink-faint">
                    {entry.companies} listed · cap {money(entry.marketCap, { compact: true })} · sentiment {num(entry.sentiment, 2)}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <ViewPanel<StocksView>
          view="stocks"
          title="Listed companies"
          subtitle={market ? `${visible.length} of ${market.all.length} companies` : 'Loading'}
          isEmpty={(data) => data.market.all.length === 0}
          emptyTitle="No companies are listed"
          emptyBody="The exchange has no listings the server can show for this world seed."
          actions={
            <>
              <Input placeholder="Ticker or name" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search companies" />
              <Select aria-label="Sector" value={sector} onChange={(event) => setSector(event.target.value)}>
                <option value="">All sectors</option>
                {sectors.map((entry) => (
                  <option key={entry} value={entry}>
                    {humanise(entry)}
                  </option>
                ))}
              </Select>
              <Select aria-label="Sort" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                <option value="marketCap">Largest</option>
                <option value="change">Best today</option>
                <option value="pe">Cheapest earnings</option>
                <option value="yield">Highest yield</option>
              </Select>
            </>
          }
        >
          {() => (
            <Table label="Listed companies">
              <thead>
                <tr>
                  <Th>Ticker</Th>
                  <Th>Company</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">1d</Th>
                  <Th align="right">30d</Th>
                  <Th align="right">P/E</Th>
                  <Th align="right">Yield</Th>
                  <Th align="right">vs fair</Th>
                  <Th align="right">Held</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <Tr key={row.companyId} highlight={selected === row.companyId}>
                    <Td className="tnum text-xs text-gold">{row.ticker}</Td>
                    <Td>
                      <button type="button" className="text-left" onClick={() => setSelected(row.companyId === selected ? null : row.companyId)} aria-expanded={selected === row.companyId}>
                        <span className="block text-sm text-ink hover:text-gold">{row.name}</span>
                        <span className="text-[11px] text-ink-faint">
                          {humanise(row.sector)} · {row.country} · {humanise(row.status)}
                        </span>
                      </button>
                    </Td>
                    <Td align="right" className="tnum">{money(row.price)}</Td>
                    <Td align="right">
                      <Delta value={row.change1d} format={(value) => pct(value, { from: 'fraction', sign: true, decimals: 2 })} />
                    </Td>
                    <Td align="right">
                      <Delta value={row.change30d} format={(value) => pct(value, { from: 'fraction', sign: true, decimals: 1 })} />
                    </Td>
                    <Td align="right" className="tnum text-xs">{row.pe > 0 ? num(row.pe, 1) : '—'}</Td>
                    <Td align="right" className="tnum text-xs">{pct(row.dividendYield, { from: 'fraction', decimals: 2 })}</Td>
                    <Td align="right" className="tnum text-xs">
                      <span className={row.premiumVsFair < -0.05 ? 'text-up' : row.premiumVsFair > 0.05 ? 'text-down' : 'text-ink-dim'}>{pct(row.premiumVsFair, { from: 'fraction', sign: true, decimals: 1 })}</span>
                    </Td>
                    <Td align="right" className="tnum text-xs">{row.heldShares > 0 ? num(row.heldShares) : '—'}</Td>
                    <Td align="right">
                      <Button size="sm" variant="ghost" onClick={() => setSelected(row.companyId)}>
                        Trade
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </ViewPanel>
      </div>

      <aside className="space-y-3">
        {selectedRow ? <TradeTicket key={selectedRow.companyId} row={selectedRow} onClear={() => setSelected(null)} /> : <MarketSide />}
      </aside>
    </div>
  );
}

function MarketSide() {
  const stocks = useView<StocksView>('stocks');
  const market = stocks.data?.market;
  if (!market) return null;
  return (
    <Panel title="Exchange" subtitle={market.brokerageName ?? 'No brokerage account'}>
      <dl className="space-y-0.5">
        <KeyValue label="Index level">{num(market.indexLevel, 2)}</KeyValue>
        <KeyValue label="Index today">
          <Delta value={market.indexChange1d} format={(value) => pct(value, { from: 'fraction', sign: true, decimals: 2 })} />
        </KeyValue>
        <KeyValue label="Index 30 days">
          <Delta value={market.indexChange30d} format={(value) => pct(value, { from: 'fraction', sign: true, decimals: 1 })} />
        </KeyValue>
        <KeyValue label="Cycle phase">{humanise(market.cyclePhase)}</KeyValue>
        <KeyValue label="Market sentiment">{num(market.sentiment, 2)}</KeyValue>
        <KeyValue label="Interest rate">{pct(market.interestRate, { from: 'fraction', decimals: 2 })}</KeyValue>
        <KeyValue label="Brokerage cash">{money(market.cash)}</KeyValue>
        <KeyValue label="Portfolio value">{money(market.portfolioValue)}</KeyValue>
      </dl>
      {market.indexHistory.length > 1 && (
        <div className="mt-3">
          <Sparkline points={market.indexHistory} label="Stock index" tone="gold" />
        </div>
      )}
      {market.movers.up.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Biggest movers today</p>
          <ul className="mt-1 space-y-0.5">
            {[...market.movers.up.slice(0, 3), ...market.movers.down.slice(0, 3)].map((row) => (
              <li key={row.companyId} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-ink-dim">
                  {row.ticker} <span className="text-ink-faint">{row.name}</span>
                </span>
                <span className={`tnum ${row.change1d >= 0 ? 'text-up' : 'text-down'}`}>{pct(row.change1d, { from: 'fraction', sign: true, decimals: 2 })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function TradeTicket({ row, onClear }: { row: StockRow; onClear: () => void }) {
  const { state } = useGame();
  const stocks = useView<StocksView>('stocks');
  const market = stocks.data?.market;
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [shares, setShares] = useState(10);

  const maxBuy = market ? Math.floor(market.cash / Math.max(0.01, row.price)) : 0;
  const maxSell = row.heldShares;
  const hasAccount = Boolean(market?.brokerageAccountId);

  return (
    <Panel
      title={`${row.ticker} — ${row.name}`}
      subtitle={`${humanise(row.sector)} · ${row.country}`}
      actions={
        <Button size="sm" variant="ghost" onClick={onClear} aria-label="Close ticket">
          ✕
        </Button>
      }
    >
      <div className="space-y-3">
        <dl className="space-y-0.5">
          <KeyValue label="Price">{money(row.price)}</KeyValue>
          <KeyValue label="Fair value">{money(row.fairValue)}</KeyValue>
          <KeyValue label="Premium to fair">
            <Delta value={row.premiumVsFair} format={(value) => pct(value, { from: 'fraction', sign: true, decimals: 1 })} />
          </KeyValue>
          <KeyValue label="Market cap">{money(row.marketCap, { compact: true })}</KeyValue>
          <KeyValue label="Daily volume">{num(row.dailyVolume)}</KeyValue>
          <KeyValue label="Beta">{num(row.beta, 2)}</KeyValue>
          <KeyValue label="EPS">{money(row.eps)}</KeyValue>
          <KeyValue label="Your holding">{row.heldShares > 0 ? `${num(row.heldShares)} shares @ ${money(row.heldCost / Math.max(1, row.heldShares))}` : '—'}</KeyValue>
          <KeyValue label="Unrealised P&L" tone={row.unrealisedPnl > 0 ? 'text-up' : row.unrealisedPnl < 0 ? 'text-down' : undefined}>
            {row.heldShares > 0 ? `${money(row.unrealisedPnl)} (${pct(row.unrealisedPnlPct, { from: 'fraction', sign: true })})` : '—'}
          </KeyValue>
          <KeyValue label="Dividends received">{money(row.dividendsReceived)}</KeyValue>
          <KeyValue label="Fundamentals quality">{pct(row.fundamentalsQuality, { from: 'fraction', decimals: 0 })}</KeyValue>
        </dl>

        {row.description && <p className="text-xs text-ink-dim">{row.description}</p>}

        {row.exposure.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Exposure</p>
            <BarList items={row.exposure.map((entry) => ({ label: humanise(entry.category), value: entry.weight }))} format={(value) => pct(value, { from: 'fraction', decimals: 0 })} />
          </div>
        )}

        {!hasAccount ? (
          <InlineNote tone="warn">Open a brokerage account to trade this company. Cash for share purchases settles through it.</InlineNote>
        ) : (
          <>
            <div role="tablist" aria-label="Order side" className="grid grid-cols-2 gap-1 rounded border border-line p-1">
              {(['buy', 'sell'] as const).map((option) => (
                <button
                  key={option}
                  role="tab"
                  type="button"
                  aria-selected={side === option}
                  onClick={() => {
                    setSide(option);
                    setShares(option === 'buy' ? 10 : Math.max(1, maxSell));
                  }}
                  className={`rounded px-2 py-1 text-xs font-semibold uppercase ${side === option ? (option === 'buy' ? 'bg-up-soft text-up' : 'bg-down-soft text-down') : 'text-ink-faint hover:text-ink'}`}
                  disabled={option === 'sell' && maxSell === 0}
                >
                  {option}
                </button>
              ))}
            </div>

            <QuantityPicker value={shares} onChange={setShares} max={side === 'buy' ? maxBuy : maxSell} unit="shares" label={side === 'buy' ? 'Shares to buy' : 'Shares to sell'} id={`shares-${row.companyId}`} />

            <p className="text-[11px] text-ink-faint">
              {side === 'buy'
                ? `About ${money(shares * row.price)} settled from brokerage cash (${money(market?.cash ?? 0)} available).`
                : `About ${money(shares * row.price)} credited before brokerage fees and tax.`}
            </p>

            <CommandButton
              intent={side === 'buy' ? { type: 'stocks.buy', companyId: row.companyId, shares } : { type: 'stocks.sell', companyId: row.companyId, shares }}
              label={side === 'buy' ? `Buy ${num(shares)} shares` : `Sell ${num(shares)} shares`}
              variant={side === 'buy' ? 'success' : 'primary'}
              size="lg"
              disabled={shares <= 0 || (side === 'buy' ? shares > maxBuy : shares > maxSell)}
              disabledReason={side === 'buy' ? `Brokerage cash covers ${num(maxBuy)} shares.` : 'You do not hold that many shares.'}
              confirm={shares * row.price > 50_000 ? { title: 'Place this order?', body: `${money(shares * row.price)} is a large single order in ${row.ticker}.`, confirmLabel: 'Place order' } : undefined}
            />
            <p className="text-[11px] text-ink-faint">
              Orders execute at the server&apos;s current price with its fees and tax; a stale save version is refused rather than filled at an old price.
            </p>
          </>
        )}
        {state?.player.combat && state.player.combat.phase === 'active' && <InlineNote tone="down">A live encounter blocks trading until it is resolved.</InlineNote>}
      </div>
    </Panel>
  );
}

function Portfolio() {
  const stocks = useView<StocksView>('stocks');
  const market = stocks.data?.market;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Portfolio value" value={money(market?.portfolioValue ?? 0)} sub={`cost ${money(market?.portfolioCost ?? 0)}`} />
        <Tile label="Unrealised P&L" value={money(market?.unrealisedPnl ?? 0, { sign: true })} sub="versus cost basis" tone={(market?.unrealisedPnl ?? 0) >= 0 ? 'up' : 'down'} />
        <Tile label="Realised gains" value={money(market?.realisedGains ?? 0)} sub="lifetime, after tax" tone="gold" />
        <Tile label="Dividends received" value={money(market?.dividendsReceived ?? 0)} sub="lifetime" tone="up" />
      </div>

      <ViewPanel<StocksView>
        view="stocks"
        title="Holdings"
        subtitle="Positions with their cost, current value and dividends"
        isEmpty={(data) => data.market.holdings.length === 0}
        emptyTitle="No holdings"
        emptyBody="You own no shares. Buy on the Market tab — the brokerage account holds cash and settlement."
      >
        {() => (
          <Table label="Stock holdings">
            <thead>
              <tr>
                <Th>Ticker</Th>
                <Th align="right">Shares</Th>
                <Th align="right">Avg cost</Th>
                <Th align="right">Price</Th>
                <Th align="right">Value</Th>
                <Th align="right">P&amp;L</Th>
                <Th align="right">Dividends</Th>
                <Th align="right">Beta</Th>
              </tr>
            </thead>
            <tbody>
              {(market?.holdings ?? []).map((row) => (
                <Tr key={row.companyId}>
                  <Td className="tnum text-xs text-gold">
                    {row.ticker}
                    <span className="ml-2 text-ink-dim">{row.name}</span>
                  </Td>
                  <Td align="right" className="tnum">{num(row.heldShares)}</Td>
                  <Td align="right" className="tnum text-xs">{money(row.heldCost / Math.max(1, row.heldShares))}</Td>
                  <Td align="right" className="tnum">{money(row.price)}</Td>
                  <Td align="right" className="tnum">{money(row.heldValue)}</Td>
                  <Td align="right">
                    <Delta value={row.unrealisedPnl} format={(value) => money(value)} />
                    <span className="tnum block text-[11px] text-ink-faint">{pct(row.unrealisedPnlPct, { from: 'fraction', sign: true, decimals: 1 })}</span>
                  </Td>
                  <Td align="right" className="tnum text-xs">{money(row.dividendsReceived)}</Td>
                  <Td align="right" className="tnum text-xs">{num(row.beta, 2)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </ViewPanel>
    </div>
  );
}

function Risk() {
  const stocks = useView<StocksView>('stocks');
  const risk = stocks.data?.risk;
  if (!risk) return null;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title="Portfolio risk" subtitle="As the server measures it">
        <dl className="space-y-0.5">
          <KeyValue label="Position value">{money(risk.value)}</KeyValue>
          <KeyValue label="Cash weight">{pct(risk.cashWeight, { from: 'fraction', decimals: 1 })}</KeyValue>
          <KeyValue label="Weighted beta">{num(risk.weightedBeta, 2)}</KeyValue>
          <KeyValue label="Diversification">{num(risk.diversification, 2)}</KeyValue>
          <KeyValue label="Largest position">{risk.largestPosition ? `${risk.largestPosition.name} (${pct(risk.largestPosition.weight, { from: 'fraction', decimals: 1 })})` : '—'}</KeyValue>
        </dl>
        {risk.weightedBeta > 1.3 && <InlineNote tone="warn">Your book is more volatile than the market: a downturn hits this portfolio harder than the index.</InlineNote>}
        {risk.cashWeight < 0.05 && risk.value > 0 && <InlineNote tone="warn">Almost fully invested — there is little cash to buy a dip or absorb a margin call.</InlineNote>}
      </Panel>
      <Panel title="Concentration" subtitle="How much of the portfolio each position is">
        {risk.concentration.length === 0 ? (
          <EmptyState title="Nothing concentrated" body="You hold no shares, so there is no concentration to measure." />
        ) : (
          <BarList items={risk.concentration.map((entry) => ({ label: entry.name, value: entry.weight }))} format={(value) => pct(value, { from: 'fraction', decimals: 1 })} />
        )}
      </Panel>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'up' | 'down' | 'gold' }) {
  return (
    <div className="rounded-panel border border-line bg-panel px-3 py-2.5">
      <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">{label}</p>
      <p className={`tnum mt-0.5 text-lg font-semibold ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : tone === 'gold' ? 'text-gold' : 'text-ink'}`}>{value}</p>
      <p className="text-[11px] text-ink-faint">{sub}</p>
    </div>
  );
}
