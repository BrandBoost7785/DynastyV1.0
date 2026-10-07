'use client';

/**
 * Market — the trading desk.
 *
 * A dense screen on purpose: the player is comparing prices, spreads and holdings, so
 * the table carries the numbers and the side panel carries the decision. Order entry is
 * quote-driven — the server prices the order before it is placed, including the market
 * impact of the order's own size, the fees, the tax and what would actually fill — and
 * the same numbers decide what the buttons are allowed to do.
 *
 * Nothing here computes a price. The client sends an intent and renders the answer.
 */
import { useMemo, useState } from 'react';
import { api } from '../../../../lib/api-client';
import { useGame, usePurse, useView } from '../../../../lib/game-context';
import { useQuery, DEFAULT_STALE_MS } from '../../../../lib/query';
import { useDebounced } from '../../../../lib/hooks';
import { ViewPanel, CommandButton, QuantityPicker } from '../../../../components/game/view-panel';
import { Badge, Button, Checkbox, Delta, Input, KeyValue, Panel, Select, Table, Td, Th, Tr, type Tone } from '../../../../components/ui/primitives';
import { InlineNote } from '../../../../components/ui/states';
import { Icon } from '../../../../components/ui/icons';
import { humanise, mass, money, num, pct, volume } from '../../../../lib/format';
import type { MarketRow, MarketView } from '../../../../lib/game-data';

interface TradeQuote {
  side: 'buy' | 'sell';
  commodityName: string;
  requestedQty: number;
  qty: number;
  marketPrice: number;
  quotedUnitPrice: number;
  effectiveUnitPrice: number;
  netUnitPrice: number;
  impactFraction: number;
  gross: number;
  fees: { label: string; amount: number; kind: string }[];
  feeTotal: number;
  taxTotal: number;
  total: number;
  breakEvenQty: number | null;
  warnings: string[];
  capacity: { marketAbsorbable: number; affordable: number; storable: number; onHand: number };
  premiumVsFundamental: number;
  priceAfterTrade: number;
}

const SORTS = [
  { id: 'name', label: 'Name' },
  { id: 'price', label: 'Price (high → low)' },
  { id: 'change', label: 'Change today' },
  { id: 'premium', label: 'Premium vs fundamental' },
  { id: 'value', label: 'Held value' },
  { id: 'volume', label: 'Volume' },
] as const;

const LEGALITIES = ['legal', 'restricted', 'illegal', 'contraband'] as const;

export default function MarketPage() {
  const { state, meta } = useGame();
  const { cash } = usePurse();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [legality, setLegality] = useState('');
  const [sort, setSort] = useState<(typeof SORTS)[number]['id']>('name');
  const [onlyHoldings, setOnlyHoldings] = useState(false);
  const debouncedSearch = useDebounced(search, 300);

  const undergroundUnlocked = state?.player.underground.accessUnlocked ?? false;
  const [includeHidden, setIncludeHidden] = useState(false);

  const params = useMemo(
    () => ({
      limit: 200,
      sort,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(category ? { category } : {}),
      ...(legality ? { legality } : {}),
      ...(onlyHoldings ? { onlyHoldings: true } : {}),
      ...(includeHidden && undergroundUnlocked ? { includeHidden: true } : {}),
    }),
    [category, debouncedSearch, includeHidden, legality, onlyHoldings, sort, undergroundUnlocked],
  );

  const market = useView<MarketView>('market', params);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = market.data?.rows ?? [];
  const selected = rows.find((row) => row.commodityId === selectedId) ?? null;
  const categories = useMemo(() => [...new Set(rows.map((row) => row.category))].sort(), [rows]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Trading desk</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">{market.data?.summary.name ?? 'Market'}</h1>
          <p className="mt-1 text-xs text-ink-dim">
            {market.data
              ? `${market.data.summary.tradedCount} goods traded · tax ${pct(market.data.summary.taxRate, { from: 'fraction' })} · enforcement ${pct(market.data.summary.enforcement, { from: 'fraction', decimals: 0 })} · index ${num(market.data.summary.index, 2)}`
              : 'Loading local conditions…'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={(market.data?.summary.lockdown ?? false) ? 'down' : 'up'}>
            {(market.data?.summary.lockdown ?? false) ? 'Lockdown' : 'Open for trade'}
          </Badge>
          <span className="text-ink-faint">
            Cash available: <span className="tnum text-ink">{money(cash)}</span>
          </span>
          <span className="text-ink-faint">
            Version <span className="tnum text-ink">{meta?.version ?? 0}</span>
          </span>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="relative">
              <span className="sr-only">Search commodities</span>
              <span className="pointer-events-none absolute top-2.5 left-2.5 text-ink-faint">
                <Icon.Search size={14} />
              </span>
              <Input className="pl-8" placeholder="Search goods, categories, tags" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <Select aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {humanise(item)}
                </option>
              ))}
            </Select>
            <Select aria-label="Legality" value={legality} onChange={(event) => setLegality(event.target.value)}>
              <option value="">Any legality</option>
              {LEGALITIES.map((item) => (
                <option key={item} value={item}>
                  {humanise(item)}
                </option>
              ))}
            </Select>
            <Select aria-label="Sort by" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
              {SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <Checkbox label="Only what I hold" checked={onlyHoldings} onChange={setOnlyHoldings} />
            {undergroundUnlocked && (
              <Checkbox
                label="Include hidden channels"
                hint="Markets you have unlocked through darknet access."
                checked={includeHidden}
                onChange={setIncludeHidden}
              />
            )}
            <span className="tnum ml-auto text-xs text-ink-faint">{rows.length} rows</span>
          </div>

          {market.error && !market.data ? (
            <Panel title="Market">
              <p className="text-xs text-down">{market.error.message}</p>
              <Button size="sm" className="mt-2" onClick={market.refetch}>
                Retry
              </Button>
            </Panel>
          ) : null}

          <Table label="Commodities at this location">
            <thead>
              <tr>
                <Th>Good</Th>
                <Th align="right">Price</Th>
                <Th align="right">Bid / Ask</Th>
                <Th align="right">1d</Th>
                <Th align="right">7d</Th>
                <Th align="right">vs fundamental</Th>
                <Th align="right">Supply</Th>
                <Th align="right">Held</Th>
                <Th align="right">Unit</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !market.loading && (
                <Tr>
                  <Td className="text-xs text-ink-faint">No goods match those filters.</Td>
                </Tr>
              )}
              {rows.map((row) => (
                <Tr key={row.commodityId} highlight={row.commodityId === selectedId}>
                  <Td>
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => setSelectedId(row.commodityId === selectedId ? null : row.commodityId)}
                      aria-expanded={row.commodityId === selectedId}
                    >
                      <span className="block text-sm text-ink hover:text-gold">{row.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1">
                        <span className="text-[11px] text-ink-faint">{humanise(row.category)}</span>
                        {row.legality !== 'legal' && <Badge tone={row.legality === 'contraband' || row.legality === 'illegal' ? 'down' : 'warn'}>{row.legality}</Badge>}
                        {row.channel !== 'open' && <Badge tone="violet">{humanise(row.channel)}</Badge>}
                        {!row.tradable && <Badge tone="neutral">not tradable</Badge>}
                        {row.shelfLifeDays !== null && <Badge tone="warn">perishable</Badge>}
                      </span>
                    </button>
                  </Td>
                  <Td align="right" className="tnum">{money(row.price)}</Td>
                  <Td align="right" className="tnum text-xs text-ink-faint">
                    {money(row.bid)} / {money(row.ask)}
                    <span className="ml-1">({pct(row.spreadPct, { decimals: 1 })})</span>
                  </Td>
                  <Td align="right">
                    <Delta value={row.changePct1d} format={(n) => pct(n, { sign: true })} />
                  </Td>
                  <Td align="right">
                    <Delta value={row.changePct7d} format={(n) => pct(n, { sign: true })} />
                  </Td>
                  <Td align="right" className="tnum">
                    <span className={row.premiumVsFundamentalPct < -10 ? 'text-up' : row.premiumVsFundamentalPct > 10 ? 'text-down' : 'text-ink-dim'}>
                      {pct(row.premiumVsFundamentalPct, { sign: true })}
                    </span>
                  </Td>
                  <Td align="right" className="tnum text-xs">{num(row.supply, 0)}</Td>
                  <Td align="right" className="tnum">{row.onHand > 0 ? num(row.onHand) : <span className="text-ink-faint">—</span>}</Td>
                  <Td align="right" className="text-[11px] text-ink-faint">
                    {mass(row.weightKg)} / {volume(row.volumeL)}
                  </Td>
                  <Td align="right">
                    <Signals row={row} onSelect={() => setSelectedId(row.commodityId)} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </section>

        <aside className="space-y-3">
          {selected ? <OrderTicket key={selected.commodityId} row={selected} onClear={() => setSelectedId(null)} /> : <MarketSidePanels />}
        </aside>
      </div>
    </div>
  );
}

/** Display labels over server numbers — the thresholds are shown in the tooltip. */
function Signals({ row, onSelect }: { row: MarketRow; onSelect: () => void }) {
  const signals: { label: string; tone: Tone; title: string }[] = [];
  if (row.premiumVsFundamentalPct <= -10) signals.push({ label: 'Cheap', tone: 'up', title: 'Trades at least 10% below the server’s fundamental estimate.' });
  if (row.premiumVsFundamentalPct >= 10) signals.push({ label: 'Rich', tone: 'down', title: 'Trades at least 10% above the server’s fundamental estimate.' });
  if (row.onHand > 0 && row.unrealisedPnl > 0) signals.push({ label: 'In profit', tone: 'gold', title: 'Your holdings are worth more than their cost basis.' });
  if (row.onHand > 0 && row.unrealisedPnl < 0) signals.push({ label: 'Underwater', tone: 'warn', title: 'Your holdings are worth less than their cost basis.' });
  if (row.volatility >= 0.3) signals.push({ label: 'Volatile', tone: 'warn', title: 'Annualised volatility at or above 30%.' });
  return (
    <span className="flex flex-wrap items-center justify-end gap-1">
      {signals.slice(0, 2).map((signal) => (
        <Badge key={signal.label} tone={signal.tone} title={signal.title}>
          {signal.label}
        </Badge>
      ))}
      <Button size="sm" variant="ghost" onClick={onSelect} aria-label={`Trade ${row.name}`}>
        Trade
      </Button>
    </span>
  );
}

function MarketSidePanels() {
  const { gameId } = useGame();
  return (
    <ViewPanel<MarketView> view="market" params={{ limit: 1 }} title="Order entry" bare={false}>
      {(data) => (
        <div className="space-y-3 text-xs text-ink-dim">
          <p>Select a good to price an order. The server returns the fill, the fees, the tax and the post-trade price before anything is committed.</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-line bg-panel-2/40 px-2 py-1.5">
              <p className="text-[11px] text-ink-faint uppercase">Traded here</p>
              <p className="tnum text-ink">{data.summary.tradedCount}</p>
            </div>
            <div className="rounded border border-line bg-panel-2/40 px-2 py-1.5">
              <p className="text-[11px] text-ink-faint uppercase">Market index</p>
              <p className="tnum text-ink">{num(data.summary.index, 2)}</p>
            </div>
          </div>
          <p className="text-ink-faint">
            Location id <code className="text-ink-dim">{data.locationId}</code> · game <code className="text-ink-dim">{gameId}</code>
          </p>
        </div>
      )}
    </ViewPanel>
  );
}

/* ------------------------------------------------------------------ */
/* Order ticket                                                        */
/* ------------------------------------------------------------------ */

function OrderTicket({ row, onClear }: { row: MarketRow; onClear: () => void }) {
  const { gameId, state } = useGame();
  const { cash } = usePurse();
  const [side, setSide] = useState<'buy' | 'sell'>(row.onHand > 0 ? 'sell' : 'buy');
  const [qty, setQty] = useState(1);
  const [allowDirty, setAllowDirty] = useState(false);
  const [includeConcealed, setIncludeConcealed] = useState(false);
  const debouncedQty = useDebounced(qty, 250);

  const undergroundUnlocked = state?.player.underground.accessUnlocked ?? false;
  const canBuy = row.tradable && row.channel === 'open';
  const onHandAtLocation = row.onHand;

  const quoteKey = `quote:${gameId}:${side}:${row.commodityId}:${debouncedQty}:${includeConcealed ? 'c' : '-'}:${allowDirty ? 'd' : '-'}`;
  const quote = useQuery<TradeQuote | null>(
    quoteKey,
    async () => {
      if (debouncedQty <= 0) return null;
      const intent =
        side === 'buy'
          ? { type: 'trade.quote_buy', commodityId: row.commodityId, qty: debouncedQty }
          : { type: 'trade.quote_sell', commodityId: row.commodityId, qty: debouncedQty };
      const response = await api.intent(gameId, intent);
      return (response.data as TradeQuote | undefined) ?? null;
    },
    { staleTime: DEFAULT_STALE_MS, enabled: debouncedQty > 0 },
  );

  const data = quote.data;
  const fillable = data?.qty ?? 0;
  const partial = data !== null && data !== undefined && fillable < debouncedQty;

  return (
    <Panel
      title={row.name}
      subtitle={`${humanise(row.category)} · ${humanise(row.legality)} · ${row.channel === 'open' ? 'open market' : `${humanise(row.channel)} channel`}`}
      actions={
        <Button size="sm" variant="ghost" onClick={onClear} aria-label="Close order ticket">
          ✕
        </Button>
      }
    >
      <div className="space-y-3">
        <dl className="space-y-0.5">
          <KeyValue label="Market price">{money(row.price)}</KeyValue>
          <KeyValue label="Fundamental estimate">{money(row.fundamental)}</KeyValue>
          <KeyValue label="Premium vs fundamental">
            <Delta value={row.premiumVsFundamentalPct} format={(n) => pct(n, { sign: true })} />
          </KeyValue>
          <KeyValue label="Volatility">{pct(row.volatility, { from: 'fraction' })}</KeyValue>
          <KeyValue label="Sentiment">{pct(row.sentiment, { from: 'fraction', decimals: 0 })}</KeyValue>
          <KeyValue label="Supply / demand">
            {num(row.supply, 0)} / {num(row.demand, 0)}
          </KeyValue>
          <KeyValue label="Your holding">
            {onHandAtLocation > 0 ? `${num(onHandAtLocation)} ${row.unit} @ ${money(row.holdingCostBasis / Math.max(1, onHandAtLocation))}` : '—'}
          </KeyValue>
          <KeyValue label="Unrealised P&L" tone={row.unrealisedPnl > 0 ? 'text-up' : row.unrealisedPnl < 0 ? 'text-down' : undefined}>
            {row.onHand > 0 ? `${money(row.unrealisedPnl)} (${pct(row.unrealisedPnlPct, { from: 'fraction', sign: true })})` : '—'}
          </KeyValue>
          <KeyValue label="Unit weight">{mass(row.weightKg)}</KeyValue>
          <KeyValue label="Unit volume">{volume(row.volumeL)}</KeyValue>
          {row.storage.length > 0 && <KeyValue label="Storage needs">{row.storage.join(', ')}</KeyValue>}
        </dl>

        {row.drivers.length > 0 && (
          <div>
            <h3 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Why the price moved</h3>
            <ul className="mt-1 space-y-0.5">
              {row.drivers.slice(0, 4).map((driver) => (
                <li key={`${driver.label}-${driver.kind}`} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-ink-dim">{driver.label}</span>
                  <span className={`tnum ${driver.contributionPct >= 0 ? 'text-up' : 'text-down'}`}>{pct(driver.contributionPct, { sign: true })}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div role="tablist" aria-label="Order side" className="grid grid-cols-2 gap-1 rounded border border-line p-1">
          {(['buy', 'sell'] as const).map((option) => (
            <button
              key={option}
              role="tab"
              type="button"
              aria-selected={side === option}
              onClick={() => {
                setSide(option);
                setQty(1);
              }}
              className={`rounded px-2 py-1 text-xs font-semibold uppercase ${side === option ? (option === 'buy' ? 'bg-up-soft text-up' : 'bg-down-soft text-down') : 'text-ink-faint hover:text-ink'}`}
              disabled={option === 'buy' ? !canBuy : onHandAtLocation <= 0 && !includeConcealed}
            >
              {option}
            </button>
          ))}
        </div>

        {side === 'buy' && !canBuy && (
          <InlineNote tone="warn">
            This good cannot be bought on the open market here{row.channel !== 'open' ? ` — it trades on the ${humanise(row.channel)} channel` : ''}. Check legality, lockdown
            status and your access.
          </InlineNote>
        )}

        <QuantityPicker
          value={qty}
          onChange={setQty}
          max={side === 'sell' ? Math.max(1, onHandAtLocation) : undefined}
          unit={row.unit}
          label={side === 'buy' ? 'Buy quantity' : 'Sell quantity'}
        />

        {side === 'sell' && (
          <Checkbox label="Include concealed goods" hint="Offered on the open market, so concealment is given up." checked={includeConcealed} onChange={setIncludeConcealed} />
        )}
        {side === 'buy' && undergroundUnlocked && row.channel !== 'open' && (
          <Checkbox label="Spend unlaundered cash" hint="Only hidden channels accept dirty money." checked={allowDirty} onChange={setAllowDirty} />
        )}

        {/* Quote from the server */}
        <div className="rounded border border-line bg-panel-2/40 px-3 py-2">
          <h3 className="flex items-center justify-between text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
            Server quote
            {quote.loading && <span className="text-ink-faint normal-case">pricing…</span>}
          </h3>
          {!data ? (
            <p className="mt-1 text-xs text-ink-faint">{quote.error ? quote.error.message : 'Enter a quantity to price the order.'}</p>
          ) : (
            <dl className="mt-1 space-y-0.5">
              <KeyValue label="Fillable now">
                {num(data.qty)} of {num(data.requestedQty)} {row.unit}
              </KeyValue>
              {partial && <InlineNote tone="warn">Only {num(data.qty)} would fill at this size — the market absorbs {num(data.capacity.marketAbsorbable)} today.</InlineNote>}
              <KeyValue label="Quoted unit price">{money(data.quotedUnitPrice)}</KeyValue>
              <KeyValue label="After your size">{money(data.effectiveUnitPrice)}</KeyValue>
              <KeyValue label="Price impact">{pct(data.impactFraction, { from: 'fraction', decimals: 2 })}</KeyValue>
              <KeyValue label="Gross">{money(data.gross)}</KeyValue>
              {data.fees.map((fee) => (
                <KeyValue key={fee.label} label={fee.label}>
                  {money(fee.amount)}
                </KeyValue>
              ))}
              {data.taxTotal > 0 && <KeyValue label="Tax">{money(data.taxTotal)}</KeyValue>}
              <KeyValue label={side === 'buy' ? 'Total cash out' : 'Net proceeds'}>
                <span className={side === 'buy' ? 'text-warn' : 'text-up'}>{money(data.total)}</span>
              </KeyValue>
              <KeyValue label="Price after trade">{money(data.priceAfterTrade)}</KeyValue>
              {data.breakEvenQty !== null && side === 'sell' && <KeyValue label="Break-even size">{num(data.breakEvenQty)} {row.unit}</KeyValue>}
            </dl>
          )}
          {data && data.warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {data.warnings.map((warning) => (
                <li key={warning}>
                  <InlineNote tone="warn">{warning}</InlineNote>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <CommandButton
            intent={
              side === 'buy'
                ? { type: 'trade.buy', commodityId: row.commodityId, qty, ...(allowDirty ? { allowDirty: true } : {}) }
                : { type: 'trade.sell', commodityId: row.commodityId, qty, ...(includeConcealed ? { includeConcealed: true } : {}) }
            }
            label={side === 'buy' ? `Buy ${num(qty)} ${row.unit}` : `Sell ${num(qty)} ${row.unit}`}
            variant={side === 'buy' ? 'success' : 'primary'}
            size="lg"
            disabled={qty <= 0 || (side === 'buy' && !canBuy) || (side === 'sell' && onHandAtLocation <= 0 && !includeConcealed)}
            disabledReason={qty <= 0 ? 'Enter a quantity first.' : side === 'buy' ? 'Not tradable here.' : 'You hold none here.'}
            confirm={
              side === 'sell' && qty >= onHandAtLocation && onHandAtLocation > 0
                ? { title: 'Sell your entire holding?', body: `This sells all ${num(onHandAtLocation)} ${row.unit} of ${row.name} on the open market at whatever the server fills.`, confirmLabel: 'Sell all' }
                : qty * (data?.effectiveUnitPrice ?? row.price) > cash * 0.5 && side === 'buy'
                  ? { title: 'Commit a large share of cash?', body: `This order is about ${pct((qty * (data?.effectiveUnitPrice ?? row.price)) / Math.max(1, cash), { from: 'fraction', decimals: 0 })} of your available cash.`, confirmLabel: 'Place order' }
                  : undefined
            }
          />
          <p className="text-[11px] text-ink-faint">
            Orders are validated server-side: cash, storage, legality, market depth and lockdown are all re-checked at execution. A stale version is refused rather
            than applied.
          </p>
          {state?.player.combat && state.player.combat.phase === 'active' && <InlineNote tone="down">A fight is live — trading is refused until it is resolved.</InlineNote>}
        </div>
      </div>
    </Panel>
  );
}
