'use client';

/**
 * Crypto.
 *
 * Digital assets differ from equities in the two ways that matter: custody is a choice
 * (an exchange is convenient and can freeze, a wallet is yours and can be stolen) and the
 * network itself changes — halvings, issuance, difficulty and staking rewards all move
 * with simulated days.
 *
 * Everything here is the server's: prices, slippage-aware fills, staking APY, custody risk
 * and the portfolio's own risk decomposition.
 */
import { useState } from 'react';
import { useGame, useView } from '../../../../lib/game-context';
import { ViewPanel, CommandButton } from '../../../../components/game/view-panel';
import { Badge, Button, Delta, Input, KeyValue, Meter, Panel, Select, Table, Tabs, Td, Th, Tr } from '../../../../components/ui/primitives';
import { EmptyState, InlineNote } from '../../../../components/ui/states';
import { BarList, Sparkline } from '../../../../components/game/charts';
import { humanise, money, num, pct } from '../../../../lib/format';
import type { CryptoAssetRow, CryptoView } from '../../../../lib/game-data';

type Tab = 'market' | 'portfolio' | 'exchanges' | 'mining';

export default function CryptoPage() {
  const crypto = useView<CryptoView>('crypto');
  const market = crypto.data?.market;
  const [tab, setTab] = useState<Tab>('market');

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Digital assets</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">Crypto</h1>
          <p className="mt-1 text-xs text-ink-dim">
            {market
              ? `Index ${num(market.indexLevel, 2)} (${pct(market.indexChange1d, { from: 'fraction', sign: true, decimals: 2 })} today) · portfolio ${money(market.portfolioValue)} · staked ${money(market.stakedValue)}`
              : 'Reading the network…'}
          </p>
        </div>
        <Tabs
          label="Crypto sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'market', label: 'Market', count: market?.assets.length },
            { id: 'portfolio', label: 'Holdings', count: market?.holdings.length },
            { id: 'exchanges', label: 'Exchanges', count: crypto.data?.exchanges.length },
            { id: 'mining', label: 'Mining', count: crypto.data?.rigs.length },
          ]}
        />
      </header>

      {market && !market.walletAddress && (
        <InlineNote tone="info">
          You have no wallet yet. Buying through an exchange gives you custody risk; a wallet gives you control plus the risk of losing it. Self-custody is chosen per purchase.
        </InlineNote>
      )}

      {tab === 'market' && <Market />}
      {tab === 'portfolio' && <Portfolio />}
      {tab === 'exchanges' && <Exchanges />}
      {tab === 'mining' && <Mining />}
    </div>
  );
}

function Market() {
  const crypto = useView<CryptoView>('crypto');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const market = crypto.data?.market;
  const assets = market?.assets ?? [];
  const kinds = [...new Set(assets.map((asset) => asset.kind))];
  const visible = assets.filter((asset) => (!kind || asset.kind === kind) && (!search || `${asset.symbol} ${asset.name}`.toLowerCase().includes(search.toLowerCase())));
  const selectedAsset = visible.find((asset) => asset.assetId === selected) ?? null;

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-3">
        <ViewPanel<CryptoView>
          view="crypto"
          title="Assets"
          subtitle={market ? `${visible.length} of ${assets.length} assets · global sentiment ${num(market.globalSentiment, 2)}` : 'Loading'}
          isEmpty={(data) => data.market.assets.length === 0}
          emptyTitle="No assets listed"
          emptyBody="The exchanges in this world have no listed assets for this seed."
          actions={
            <>
              <Input placeholder="Symbol or name" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search assets" />
              <Select aria-label="Asset kind" value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="">All kinds</option>
                {kinds.map((entry) => (
                  <option key={entry} value={entry}>
                    {humanise(entry)}
                  </option>
                ))}
              </Select>
            </>
          }
        >
          {() => (
            <Table label="Crypto assets">
              <thead>
                <tr>
                  <Th>Asset</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">1d</Th>
                  <Th align="right">30d</Th>
                  <Th align="right">Volatility</Th>
                  <Th align="right">Liquidity</Th>
                  <Th align="right">Staking APY</Th>
                  <Th align="right">Held</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {visible.map((asset) => (
                  <Tr key={asset.assetId} highlight={selected === asset.assetId}>
                    <Td>
                      <button type="button" className="text-left" onClick={() => setSelected(asset.assetId === selected ? null : asset.assetId)} aria-expanded={selected === asset.assetId}>
                        <span className="block text-sm text-ink hover:text-gold">
                          <span className="tnum text-gold">{asset.symbol}</span> {asset.name}
                        </span>
                        <span className="text-[11px] text-ink-faint">
                          {humanise(asset.kind)} · {humanise(asset.status)}
                          {asset.mineable ? ' · mineable' : ''}
                          {asset.stakeable ? ' · stakeable' : ''}
                        </span>
                      </button>
                    </Td>
                    <Td align="right" className="tnum">{money(asset.price, { decimals: asset.price < 10 ? 4 : 2 })}</Td>
                    <Td align="right">
                      <Delta value={asset.change1d} format={(value) => pct(value, { from: 'fraction', sign: true, decimals: 2 })} />
                    </Td>
                    <Td align="right">
                      <Delta value={asset.change30d} format={(value) => pct(value, { from: 'fraction', sign: true, decimals: 1 })} />
                    </Td>
                    <Td align="right" className="tnum text-xs">{pct(asset.volatility, { from: 'fraction', decimals: 0 })}</Td>
                    <Td align="right" className="tnum text-xs">{pct(asset.liquidity, { from: 'fraction', decimals: 0 })}</Td>
                    <Td align="right" className="tnum text-xs">{asset.stakeable ? pct(asset.currentApy, { from: 'fraction', decimals: 2 }) : '—'}</Td>
                    <Td align="right" className="tnum text-xs">
                      {asset.held > 0 ? (
                        <>
                          {num(asset.held, 4)}
                          <span className="block text-[11px] text-ink-faint">{asset.custody ? humanise(asset.custody) : ''}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td align="right">
                      <Button size="sm" variant="ghost" onClick={() => setSelected(asset.assetId)}>
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
        {selectedAsset ? <AssetTicket key={selectedAsset.assetId} asset={selectedAsset} onClear={() => setSelected(null)} /> : <NetworkPanel />}
      </aside>
    </div>
  );
}

function NetworkPanel() {
  const crypto = useView<CryptoView>('crypto');
  const market = crypto.data?.market;
  if (!market) return null;
  return (
    <Panel title="Network" subtitle="What the chain itself is doing">
      <dl className="space-y-0.5">
        <KeyValue label="Index level">{num(market.indexLevel, 2)}</KeyValue>
        <KeyValue label="Index today">
          <Delta value={market.indexChange1d} format={(value) => pct(value, { from: 'fraction', sign: true, decimals: 2 })} />
        </KeyValue>
        <KeyValue label="Index 30 days">
          <Delta value={market.indexChange30d} format={(value) => pct(value, { from: 'fraction', sign: true, decimals: 1 })} />
        </KeyValue>
        <KeyValue label="Global sentiment">{num(market.globalSentiment, 2)}</KeyValue>
        <KeyValue label="Risk appetite">{num(market.riskAppetite, 2)}</KeyValue>
        <KeyValue label="Wallet">{market.walletAddress ? `${market.walletAddress.slice(0, 10)}…` : 'none'}</KeyValue>
        <KeyValue label="Mined value">{money(market.minedValue)}</KeyValue>
      </dl>
      {market.indexHistory.length > 1 && (
        <div className="mt-3">
          <Sparkline points={market.indexHistory} label="Crypto index" tone="violet" />
        </div>
      )}
      {market.movers.up.length + market.movers.down.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Movers</p>
          <ul className="mt-1 space-y-0.5">
            {[...market.movers.up.slice(0, 3), ...market.movers.down.slice(0, 3)].map((asset) => (
              <li key={asset.assetId} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-ink-dim">
                  {asset.symbol} <span className="text-ink-faint">{asset.name}</span>
                </span>
                <span className={`tnum ${asset.change1d >= 0 ? 'text-up' : 'text-down'}`}>{pct(asset.change1d, { from: 'fraction', sign: true, decimals: 2 })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function AssetTicket({ asset, onClear }: { asset: CryptoAssetRow; onClear: () => void }) {
  const { state } = useGame();
  const crypto = useView<CryptoView>('crypto');
  const exchanges = (crypto.data?.market.exchanges ?? []).filter((exchange) => exchange.hasAccount && exchange.accessible);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState(0);
  const [exchangeId, setExchangeId] = useState('');
  const [custody, setCustody] = useState<'wallet' | 'exchange'>('wallet');

  const exchange = exchanges.find((entry) => entry.id === exchangeId) ?? exchanges[0];
  const fiat = state ? state.player.accounts.reduce((sum, account) => sum + account.balance, 0) : 0;
  const buyAmount = amount > 0 ? amount : Math.min(fiat * 0.1, 5000);
  const sellAmount = amount > 0 ? amount : asset.held;

  return (
    <Panel
      title={`${asset.symbol} — ${asset.name}`}
      subtitle={`${humanise(asset.kind)} · ${humanise(asset.status)}`}
      actions={
        <Button size="sm" variant="ghost" onClick={onClear} aria-label="Close ticket">
          ✕
        </Button>
      }
    >
      <div className="space-y-3">
        <dl className="space-y-0.5">
          <KeyValue label="Price">{money(asset.price, { decimals: asset.price < 10 ? 4 : 2 })}</KeyValue>
          <KeyValue label="Volatility">{pct(asset.volatility, { from: 'fraction', decimals: 0 })}</KeyValue>
          <KeyValue label="Liquidity">{pct(asset.liquidity, { from: 'fraction', decimals: 0 })}</KeyValue>
          <KeyValue label="Max notional per order">{money(asset.maxNotional)}</KeyValue>
          <KeyValue label="Regulatory risk" tone={asset.regulatoryRisk > 0.4 ? 'text-warn' : undefined}>
            {pct(asset.regulatoryRisk, { from: 'fraction', decimals: 0 })}
          </KeyValue>
          <KeyValue label="Protocol risk">{pct(asset.protocolRisk, { from: 'fraction', decimals: 0 })}</KeyValue>
          <KeyValue label="You hold">{asset.held > 0 ? `${num(asset.held, 6)} (${money(asset.heldValue)})` : '—'}</KeyValue>
          <KeyValue label="Staked">{asset.staked > 0 ? `${num(asset.staked, 6)} @ ${pct(asset.currentApy, { from: 'fraction', decimals: 2 })}` : '—'}</KeyValue>
          <KeyValue label="Unrealised P&L" tone={asset.unrealisedPnl > 0 ? 'text-up' : asset.unrealisedPnl < 0 ? 'text-down' : undefined}>
            {asset.held > 0 ? `${money(asset.unrealisedPnl)} (${pct(asset.unrealisedPnlPct, { from: 'fraction', sign: true, decimals: 1 })})` : '—'}
          </KeyValue>
          <KeyValue label="Issuance">{pct(asset.issuanceRate, { from: 'fraction', decimals: 2 })} annual</KeyValue>
          <KeyValue label="Block reward">{num(asset.blockReward, 4)}</KeyValue>
          <KeyValue label="Next halving">{asset.halvingEpoch > 0 ? `day ${asset.nextHalvingDay}` : 'not applicable'}</KeyValue>
        </dl>

        {asset.description && <p className="text-xs text-ink-dim">{asset.description}</p>}

        <div role="tablist" aria-label="Order side" className="grid grid-cols-2 gap-1 rounded border border-line p-1">
          {(['buy', 'sell'] as const).map((option) => (
            <button
              key={option}
              role="tab"
              type="button"
              aria-selected={side === option}
              onClick={() => {
                setSide(option);
                setAmount(0);
              }}
              className={`rounded px-2 py-1 text-xs font-semibold uppercase ${side === option ? (option === 'buy' ? 'bg-up-soft text-up' : 'bg-down-soft text-down') : 'text-ink-faint hover:text-ink'}`}
              disabled={option === 'sell' && asset.held <= 0}
            >
              {option}
            </button>
          ))}
        </div>

        {exchanges.length > 0 ? (
          <label className="block text-xs">
            <span className="mb-1 block text-ink-dim">Venue</span>
            <Select value={exchange?.id ?? ''} onChange={(event) => setExchangeId(event.target.value)}>
              {exchanges.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} — fee {pct(entry.feeFraction, { from: 'fraction', decimals: 2 })} · liquidity ×{num(entry.liquidityMultiplier, 2)}
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <InlineNote tone="warn">No accessible exchange account. Open one on the Exchanges tab — some venues are only reachable once darknet access is unlocked.</InlineNote>
        )}

        {side === 'buy' ? (
          <>
            <label className="block text-xs">
              <span className="mb-1 block text-ink-dim">Cash to spend</span>
              <Input type="number" min={0} step={100} value={buyAmount} onChange={(event) => setAmount(Math.max(0, Number(event.target.value)))} />
            </label>
            <p className="text-[11px] text-ink-faint">
              You hold {money(fiat)} in accounts. The server integrates the venue&apos;s book, so a large order fills at a worse average price — the slippage is part of the outcome, not hidden.
            </p>
            <label className="flex items-center gap-2 text-xs text-ink-dim">
              <input type="radio" checked={custody === 'wallet'} onChange={() => setCustody('wallet')} name="custody" />
              Self-custody wallet (you hold the keys)
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-dim">
              <input type="radio" checked={custody === 'exchange'} onChange={() => setCustody('exchange')} name="custody" />
              Leave on the exchange (convenient, custodied)
            </label>
            <CommandButton
              intent={{ type: 'crypto.buy', assetId: asset.assetId, amount: buyAmount, ...(exchange ? { exchangeId: exchange.id } : {}), custody }}
              label={`Buy ${money(buyAmount)} of ${asset.symbol}`}
              variant="success"
              size="lg"
              disabled={!exchange || buyAmount <= 0 || buyAmount > fiat}
              disabledReason={!exchange ? 'No accessible exchange.' : buyAmount > fiat ? 'That is more cash than you hold.' : 'Enter an amount.'}
              confirm={buyAmount > fiat * 0.25 ? { title: 'Place this order?', body: `${money(buyAmount)} is a quarter or more of your cash into one asset.`, confirmLabel: 'Buy' } : undefined}
            />
          </>
        ) : (
          <>
            <label className="block text-xs">
              <span className="mb-1 block text-ink-dim">Units to sell</span>
              <Input type="number" min={0} step={0.0001} value={sellAmount} onChange={(event) => setAmount(Math.max(0, Number(event.target.value)))} />
            </label>
            <p className="text-[11px] text-ink-faint">
              Selling {num(sellAmount, 6)} units at the current price is roughly {money(sellAmount * asset.price)} before venue fees and tax.
              {asset.custody === 'exchange' ? ' Your holding is custodied on an exchange — withdrawing it later costs a fee and a delay.' : ''}
            </p>
            <CommandButton
              intent={{ type: 'crypto.sell', assetId: asset.assetId, amount: sellAmount, ...(exchange ? { exchangeId: exchange.id } : {}), ...(asset.custody ? { custody: asset.custody as 'wallet' | 'exchange' } : {}) }}
              label={`Sell ${num(sellAmount, 6)} ${asset.symbol}`}
              variant="primary"
              size="lg"
              disabled={!exchange || sellAmount <= 0 || sellAmount > asset.held}
              disabledReason={!exchange ? 'No accessible exchange.' : sellAmount > asset.held ? 'You do not hold that much.' : 'Enter an amount.'}
            />
            {asset.staked > 0 && <p className="text-[11px] text-ink-faint">{num(asset.staked, 6)} units are staked and must be unstaked before they can be sold.</p>}
          </>
        )}

        <div className="grid grid-cols-2 gap-2 border-t border-line pt-2">
          <label className="text-xs">
            <span className="mb-1 block text-ink-dim">Stake units</span>
            <Input type="number" min={0} step={0.0001} value={amount > 0 ? amount : 0} onChange={(event) => setAmount(Math.max(0, Number(event.target.value)))} />
          </label>
          <div className="flex items-end gap-2">
            <CommandButton
              intent={{ type: 'crypto.stake', assetId: asset.assetId, amount: amount > 0 ? amount : 0, lockDays: 30 }}
              label="Stake 30d"
              size="sm"
              variant="secondary"
              disabled={!asset.stakeable || amount <= 0 || amount > asset.held}
              disabledReason={!asset.stakeable ? 'This asset cannot be staked.' : 'Enter an amount within your holding.'}
            />
            <CommandButton intent={{ type: 'crypto.unstake', assetId: asset.assetId, amount: asset.staked }} label="Unstake all" size="sm" variant="secondary" disabled={asset.staked <= 0} disabledReason="Nothing is staked." />
          </div>
        </div>
        <p className="text-[11px] text-ink-faint">Staking locks the units for the term; early exit is allowed but costs part of the accrued reward.</p>
        {state?.player.combat && state.player.combat.phase === 'active' && <InlineNote tone="down">A live encounter blocks trading until it is resolved.</InlineNote>}
      </div>
    </Panel>
  );
}

function Portfolio() {
  const crypto = useView<CryptoView>('crypto');
  const market = crypto.data?.market;
  const risk = crypto.data?.risk;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Portfolio value" value={money(market?.portfolioValue ?? 0)} sub={`cost ${money(market?.portfolioCost ?? 0)}`} />
        <Tile label="Unrealised P&L" value={money(market?.unrealisedPnl ?? 0, { sign: true })} sub="versus cost basis" tone={(market?.unrealisedPnl ?? 0) >= 0 ? 'up' : 'down'} />
        <Tile label="Staked" value={money(market?.stakedValue ?? 0)} sub={`weighted APY ${pct(market?.stakedApyWeighted ?? 0, { from: 'fraction', decimals: 2 })}`} tone="gold" />
        <Tile label="Mined / realised" value={`${money(market?.minedValue ?? 0, { compact: true })} / ${money(market?.realisedGains ?? 0, { compact: true })}`} sub="lifetime" />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ViewPanel<CryptoView>
          view="crypto"
          title="Holdings"
          subtitle="Positions, custody and accrued rewards"
          isEmpty={(data) => data.market.holdings.length === 0}
          emptyTitle="No crypto holdings"
          emptyBody="You hold no digital assets. Buy on the Market tab — choose self-custody or leave the units on an exchange."
        >
          {() => (
            <Table label="Crypto holdings">
              <thead>
                <tr>
                  <Th>Asset</Th>
                  <Th align="right">Units</Th>
                  <Th align="right">Staked</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">Value</Th>
                  <Th align="right">P&amp;L</Th>
                  <Th align="right">Rewards</Th>
                  <Th>Custody</Th>
                </tr>
              </thead>
              <tbody>
                {(market?.holdings ?? []).map((asset) => (
                  <Tr key={asset.assetId}>
                    <Td className="text-xs">
                      <span className="tnum text-gold">{asset.symbol}</span>
                      <span className="ml-2 text-ink-dim">{asset.name}</span>
                    </Td>
                    <Td align="right" className="tnum">{num(asset.held, 6)}</Td>
                    <Td align="right" className="tnum text-xs">{asset.staked > 0 ? num(asset.staked, 6) : '—'}</Td>
                    <Td align="right" className="tnum">{money(asset.price, { decimals: asset.price < 10 ? 4 : 2 })}</Td>
                    <Td align="right" className="tnum">{money(asset.heldValue)}</Td>
                    <Td align="right">
                      <Delta value={asset.unrealisedPnl} format={(value) => money(value)} />
                    </Td>
                    <Td align="right" className="tnum text-xs">{money(asset.rewardsAccrued)}</Td>
                    <Td className="text-[11px]">
                      {asset.custody ? <Badge tone={asset.custody === 'wallet' ? 'up' : 'warn'}>{humanise(asset.custody)}</Badge> : <Badge tone="neutral">unset</Badge>}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </ViewPanel>

        <div className="space-y-3">
          {risk && (
            <Panel title="Risk" subtitle="How the exposure is shaped">
              <dl className="space-y-0.5">
                <KeyValue label="Position value">{money(risk.value)}</KeyValue>
                <KeyValue label="Weighted volatility">{pct(risk.weightedVolatility, { from: 'fraction', decimals: 1 })}</KeyValue>
                <KeyValue label="Concentration">{pct(risk.concentration, { from: 'fraction', decimals: 1 })}</KeyValue>
                <KeyValue label="Exchange exposure">{pct(risk.exchangeExposure, { from: 'fraction', decimals: 1 })}</KeyValue>
                <KeyValue label="Custody split">
                  wallet {money(risk.custodySplit.wallet)} / exchange {money(risk.custodySplit.exchange)}
                </KeyValue>
                <KeyValue label="Largest">{risk.largest ? `${risk.largest.symbol} (${pct(risk.largest.weight, { from: 'fraction', decimals: 1 })})` : '—'}</KeyValue>
              </dl>
              {risk.byKind.length > 0 && (
                <div className="mt-3">
                  <BarList items={risk.byKind.map((entry) => ({ label: humanise(entry.kind), value: entry.value }))} format={(value) => money(value, { compact: true })} />
                </div>
              )}
              {risk.exchangeExposure > 0.5 && <InlineNote tone="warn">More than half of your crypto sits on exchanges. Exchanges freeze accounts during investigations, and some have failed entirely.</InlineNote>}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function Exchanges() {
  const crypto = useView<CryptoView>('crypto');
  const exchanges = crypto.data?.exchanges ?? [];
  return (
    <ViewPanel<CryptoView>
      view="crypto"
      title="Exchanges"
      subtitle="Venues, their fees, their custody risk and their compliance pressure"
      isEmpty={(data) => data.exchanges.length === 0}
      emptyTitle="No exchanges reachable"
      emptyBody="Exchanges operate out of locations with digital infrastructure — or off the books entirely, once darknet access is unlocked."
    >
      {() => (
        <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {exchanges.map((exchange) => (
            <li key={exchange.id} className="rounded-panel border border-line bg-panel px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-medium text-ink">{exchange.name}</h3>
                  <p className="text-[11px] text-ink-faint">
                    {humanise(exchange.kind)} · {exchange.listsKinds.map(humanise).join(', ')}
                  </p>
                </div>
                <Badge tone={exchange.hasAccount ? (exchange.accessible ? 'up' : 'warn') : 'neutral'}>{exchange.hasAccount ? (exchange.accessible ? 'trading' : 'restricted') : 'no account'}</Badge>
              </div>
              {exchange.description && <p className="mt-1 text-xs text-ink-dim">{exchange.description}</p>}
              <div className="mt-2 space-y-1">
                <Meter value={exchange.feeFraction * 12} label="Fee load" display={pct(exchange.feeFraction, { from: 'fraction', decimals: 2 })} tone="gold" />
                <Meter value={exchange.custodyRiskPerDay * 365} label="Custody risk" display={`${pct(exchange.custodyRiskPerDay, { from: 'fraction', decimals: 3 })}/day`} tone="down" />
                <Meter value={exchange.compliancePressure} label="Compliance pressure" display={pct(exchange.compliancePressure, { from: 'fraction', decimals: 0 })} tone="info" />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3">
                <KeyValue label="Liquidity">{num(exchange.liquidityMultiplier, 2)}×</KeyValue>
                <KeyValue label="Withdrawal fee">{money(exchange.withdrawalFeeFlat)}</KeyValue>
                <KeyValue label="Withdrawal delay">{exchange.withdrawalDelayDays}d</KeyValue>
                <KeyValue label="KYC level">{exchange.kycLevel}</KeyValue>
                <KeyValue label="Balance">{exchange.hasAccount ? money(exchange.balance) : '—'}</KeyValue>
                <KeyValue label="Home">{humanise(exchange.homeCountryId)}</KeyValue>
              </dl>
              {exchange.frozenUntilDay !== null && <InlineNote tone="down">Frozen until day {exchange.frozenUntilDay}.</InlineNote>}
              {!exchange.hasAccount && (
                <div className="mt-2">
                  <CommandButton intent={{ type: 'crypto.open_account', exchangeId: exchange.id }} label="Open account" size="sm" variant="primary" />
                </div>
              )}
              {exchange.hasAccount && !exchange.accessible && exchange.accessReason && <InlineNote tone="warn">{exchange.accessReason}</InlineNote>}
            </li>
          ))}
        </ul>
      )}
    </ViewPanel>
  );
}

function Mining() {
  const crypto = useView<CryptoView>('crypto');
  const rigs = crypto.data?.rigs ?? [];
  const rigStates = (crypto.data?.market.assets ?? []).filter((asset) => asset.mineable);
  return (
    <div className="space-y-3">
      <ViewPanel<CryptoView>
        view="crypto"
        title="Mining rigs"
        subtitle="Hardware you can buy, run and switch off"
        isEmpty={(data) => data.rigs.length === 0}
        emptyTitle="No rigs available"
        emptyBody="Mining hardware is sold in industrial locations with cheap power."
      >
        {() => (
          <Table label="Mining rigs">
            <thead>
              <tr>
                <Th>Rig</Th>
                <Th align="right">Price</Th>
                <Th align="right">Hash rate</Th>
                <Th align="right">Power</Th>
                <Th align="right">Power cost / day</Th>
                <Th align="right">Expected yield / day</Th>
                <Th align="right">Payback</Th>
                <Th>Requirement</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rigs.map((rig) => (
                <Tr key={rig.defId}>
                  <Td>
                    <span className="text-sm text-ink">{rig.name}</span>
                    <span className="block text-[11px] text-ink-faint">{rig.description}</span>
                  </Td>
                  <Td align="right" className="tnum">{money(rig.price)}</Td>
                  <Td align="right" className="tnum text-xs">{num(rig.hashRate, 1)}</Td>
                  <Td align="right" className="tnum text-xs">{num(rig.powerKw, 1)} kW</Td>
                  <Td align="right" className="tnum text-xs">{money(rig.dailyPowerCost)}</Td>
                  <Td align="right" className="tnum text-xs">{money(rig.expectedYieldPerDay)}</Td>
                  <Td align="right" className="tnum text-xs">{rig.paybackDays > 0 ? `${num(rig.paybackDays)}d` : '—'}</Td>
                  <Td className="text-[11px] text-ink-faint">
                    {rig.requiresProperty ? 'needs a property' : 'no property needed'}
                    {rig.requiresSkill ? ` · ${humanise(rig.requiresSkill)} ${rig.skillMet ? 'met' : 'not met'}` : ''}
                  </Td>
                  <Td align="right">
                    <CommandButton
                      intent={{ type: 'crypto.buy_rig', rigId: rig.defId }}
                      label="Buy rig"
                      size="sm"
                      variant={rig.affordable && rig.skillMet ? 'success' : 'secondary'}
                      disabled={!rig.affordable || !rig.skillMet}
                      disabledReason={!rig.skillMet ? 'Skill requirement not met.' : 'You cannot afford this rig.'}
                      confirm={{ title: `Buy the ${rig.name}?`, body: `${money(rig.price)} is charged now and the rig draws ${money(rig.dailyPowerCost)} of power every day it runs.`, confirmLabel: 'Buy rig' }}
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </ViewPanel>

      <Panel title="Mineable networks" subtitle="Assets whose issuance rewards hash power">
        {rigStates.length === 0 ? (
          <EmptyState title="Nothing to mine" body="No listed asset is mineable in this world." />
        ) : (
          <Table label="Mineable assets">
            <thead>
              <tr>
                <Th>Asset</Th>
                <Th align="right">Block reward</Th>
                <Th align="right">Difficulty</Th>
                <Th align="right">Issuance</Th>
                <Th align="right">Next halving</Th>
                <Th align="right">Price</Th>
              </tr>
            </thead>
            <tbody>
              {rigStates.map((asset) => (
                <Tr key={asset.assetId}>
                  <Td className="text-xs">
                    <span className="tnum text-gold">{asset.symbol}</span>
                    <span className="ml-2 text-ink-dim">{asset.name}</span>
                  </Td>
                  <Td align="right" className="tnum text-xs">{num(asset.blockReward, 4)}</Td>
                  <Td align="right" className="tnum text-xs">{num(asset.networkDifficulty, 2)}</Td>
                  <Td align="right" className="tnum text-xs">{pct(asset.issuanceRate, { from: 'fraction', decimals: 2 })}</Td>
                  <Td align="right" className="tnum text-xs">{asset.halvingEpoch > 0 ? `day ${asset.nextHalvingDay}` : '—'}</Td>
                  <Td align="right" className="tnum">{money(asset.price, { decimals: asset.price < 10 ? 4 : 2 })}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
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
