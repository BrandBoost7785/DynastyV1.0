'use client';

/**
 * Underground.
 *
 * The darknet is a second economy with its own currency (digital reputation), its own
 * risk (trace heat) and its own rules about who is allowed in. The screen is built around
 * that access ladder rather than around a product list:
 *
 *  • **Locked** — one honest panel saying what access costs and what it unlocks, with the
 *    single command that changes it. Nothing about the venues is invented to fill space.
 *  • **Unlocked** — the venues the player *knows about*, each carrying the server's own
 *    reason when it is still out of reach, then listings, escrow, data and hacks.
 *
 * Everything shown here is already filtered server-side: markets the player has not
 * discovered have no listings, and a listing that cannot legally be bought arrives with a
 * `reason` instead of a price the client should not have been trusted with.
 */
import { useState } from 'react';
import { useView } from '../../../../lib/game-context';
import { CommandButton, QuantityPicker } from '../../../../components/game/view-panel';
import { Badge, Button, Input, KeyValue, Meter, Panel, Select, Stat, Table, Tabs, Td, Th, Tr } from '../../../../components/ui/primitives';
import { EmptyState, InlineNote } from '../../../../components/ui/states';
import { humanise, money, num, pct } from '../../../../lib/format';
import type { DarknetListing, UndergroundView } from '../../../../lib/game-data';

type Tab = 'venues' | 'data' | 'hack' | 'assets';

export default function UndergroundPage() {
  const underground = useView<UndergroundView>('underground');
  const core = underground.data?.view;
  const [tab, setTab] = useState<Tab>('venues');

  if (underground.error && !core) {
    return (
      <div className="space-y-4">
        <Header core={undefined} />
        <InlineNote tone="down">Could not reach the darknet read model: {underground.error.message}</InlineNote>
      </div>
    );
  }

  if (!core) {
    return (
      <div className="space-y-4">
        <Header core={undefined} />
        <Panel title="Checking your handle">
          <p className="text-xs text-ink-faint">Loading your digital identity…</p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Header core={core} />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Digital reputation" value={core.digitalReputationLabel} hint={`${num(core.digitalReputation)} reputation`} tone={core.digitalReputation > 0 ? 'gold' : 'default'} />
        <Stat
          label="Trace heat"
          value={num(core.traceHeat)}
          hint={core.traceHeatLabel}
          tone={core.traceHeat > 45 ? 'down' : core.traceHeat > 18 ? 'warn' : 'default'}
        />
        <Stat label="Escrow held" value={money(core.escrowBalance)} hint="locked with vendors until a deal settles" />
        <Stat
          label="Routing quality"
          value={pct(core.vpnQuality, { from: 'fraction', decimals: 0 })}
          hint={`upgrade for ${money(core.vpnUpgradeCost)}`}
          tone={core.vpnQuality < 0.5 ? 'warn' : 'default'}
        />
      </div>

      {core.compromised && (
        <InlineNote tone="down">
          Your handle is compromised{core.compromisedUntilDay !== null ? ` until day ${num(core.compromisedUntilDay)}` : ''}. Operations are exposed until you burn it and start again.
        </InlineNote>
      )}
      {!core.accessUnlocked && <Locked core={core} />}
      {core.accessUnlocked && (
        <>
          <Tabs
            label="Underground sections"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'venues', label: 'Venues', count: core.markets.length },
              { id: 'data', label: 'Data', count: core.dataOffers.length },
              { id: 'hack', label: 'Targets', count: core.hackTargets.length },
              { id: 'assets', label: 'Holdings', count: core.assets.length },
            ]}
          />
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-3 lg:col-span-2">
              {tab === 'venues' && <Venues />}
              {tab === 'data' && <DataMarket />}
              {tab === 'hack' && <HackTargets />}
              {tab === 'assets' && <Holdings />}
            </div>
            <div className="space-y-3">
              <Escrow core={core} />
              <Identity core={core} />
              <TrackRecord core={core} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Header({ core }: { core: UndergroundView['view'] | undefined }) {
  return (
    <header>
      <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Risk</p>
      <h1 className="text-xl font-semibold text-ink sm:text-2xl">Underground</h1>
      <p className="mt-1 text-xs text-ink-dim">
        {core
          ? core.accessUnlocked
            ? `Handle ${core.handle} · ${core.markets.filter((market) => market.known).length} of ${core.markets.length} venues known · ${core.hiddenChannelListings} hidden-channel goods in this city`
            : `Handle ${core.handle} · not yet on the network`
          : 'Checking your handle…'}
      </p>
    </header>
  );
}

function Locked({ core }: { core: UndergroundView['view'] }) {
  return (
    <Panel title="You are not on the network yet" subtitle="Access is bought once, with cash, and cannot be refunded">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm leading-relaxed text-ink-dim">
            A darknet handle buys privacy, not immunity. It unlocks hidden venues — contraband, data and stolen goods that never
            appear on an open exchange — and it makes you a target: every purchase adds trace heat, and enough heat ends with
            somebody reading your traffic.
          </p>
          <dl>
            <KeyValue label="One-off access fee">{money(core.accessCost)}</KeyValue>
            <KeyValue label="Handle assigned">{core.handle}</KeyValue>
            <KeyValue label="Starting reputation">{`${num(core.digitalReputation)} (${core.digitalReputationLabel})`}</KeyValue>
            <KeyValue label="Current trace heat">{`${num(core.traceHeat)} — ${core.traceHeatLabel}`}</KeyValue>
          </dl>
          <CommandButton
            intent={{ type: 'underground.buy_access' }}
            label={`Buy access for ${money(core.accessCost)}`}
            variant="primary"
            confirm={{
              title: 'Buy darknet access?',
              body: 'This is a one-off payment for a permanent handle. It does not make contraband legal: local law still applies, and shipping illegal goods through a checkpoint is still what gets you arrested.',
              confirmLabel: 'Buy access',
            }}
          />
        </div>
        <div>
          <h2 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Venues you would be able to reach</h2>
          <ul className="mt-1 space-y-2">
            {core.markets.map((market) => (
              <li key={market.id} className="rounded border border-line bg-panel px-2.5 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-ink">{market.name}</span>
                  <Badge tone="neutral">{market.focus.map(humanise).join(' · ')}</Badge>
                </div>
                <p className="mt-1 text-[11px] text-ink-dim">{market.description}</p>
                <p className="mt-1 text-[11px] text-ink-faint">
                  Vendor reputation {num(market.vendorReputation, 2)} · escrow {pct(market.escrowFeeFraction, { from: 'fraction', decimals: 1 })} · minimum deposit {money(market.minimumDeposit)}
                  {market.minDigitalReputation > 0 ? ` · needs ${num(market.minDigitalReputation)} reputation` : ''}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

function Venues() {
  const underground = useView<UndergroundView>('underground');
  const markets = underground.data?.markets ?? [];
  const [openMarket, setOpenMarket] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <Panel title="Venues" subtitle="Known markets, what they carry and whether you are welcome">
        {markets.length === 0 && <EmptyState title="No venues" body="This world has no darknet venues configured." />}
        <ul className="grid gap-2 md:grid-cols-2">
          {markets.map((market) => (
            <li key={market.id} className="rounded-panel border border-line bg-panel px-3 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-ink">{market.name}</h3>
                  <p className="text-[11px] text-ink-faint">{market.focus.map(humanise).join(' · ')}</p>
                </div>
                <Badge tone={market.accessible ? 'up' : market.known ? 'warn' : 'neutral'}>
                  {market.accessible ? 'open to you' : market.known ? 'restricted' : 'unknown'}
                </Badge>
              </div>
              <p className="mt-1.5 text-[11px] text-ink-dim">{market.description}</p>
              <dl className="mt-1.5">
                <KeyValue label="Vendor reputation">{num(market.vendorReputation, 2)}</KeyValue>
                <KeyValue label="Escrow fee">{pct(market.escrowFeeFraction, { from: 'fraction', decimals: 1 })}</KeyValue>
                <KeyValue label="Minimum deposit">{money(market.minimumDeposit)}</KeyValue>
                <KeyValue label="Your standing with them">{num(market.yourReputationWithThem)}</KeyValue>
                {market.known && <KeyValue label="Listings here">{num(market.listings)}</KeyValue>}
              </dl>
              {market.reason && <InlineNote tone="warn">{market.reason}</InlineNote>}
              <div className="mt-2 flex flex-wrap gap-2">
                {!market.known && (
                  <CommandButton
                    intent={{ type: 'underground.discover_market', marketId: market.id }}
                    label="Try to find it"
                    size="sm"
                    variant="secondary"
                  />
                )}
                {market.known && market.accessible && (
                  <Button size="sm" variant="primary" onClick={() => setOpenMarket(openMarket === market.id ? null : market.id)} aria-expanded={openMarket === market.id}>
                    {openMarket === market.id ? 'Close listings' : `Browse ${num(market.listings)} listings`}
                  </Button>
                )}
              </div>
              {openMarket === market.id && <Listings marketId={market.id} />}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Listings({ marketId }: { marketId: string }) {
  const [qty, setQty] = useState(1);
  const [search, setSearch] = useState('');
  const underground = useView<UndergroundView>(
    'underground',
    { marketId, qty, ...(search.trim() ? { search: search.trim() } : {}) },
    { staleTime: 0 },
  );
  const rows = underground.data?.listings ?? [];
  const marketName = underground.data?.view.markets.find((market) => market.id === marketId)?.name ?? marketId;

  return (
    <div className="mt-2 rounded border border-line-strong bg-hull/60 px-2.5 py-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <QuantityPicker id={`dn-qty-${marketId}`} label="Order size" value={qty} onChange={setQty} max={1000} />
        <label className="text-xs">
          <span className="mb-1 block text-ink-dim">Filter</span>
          <Input aria-label="Filter listings" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or category" className="w-40" />
        </label>
      </div>
      {underground.data === undefined && <p className="mt-2 text-[11px] text-ink-faint">Asking {marketName} for prices…</p>}
      {underground.error && <InlineNote tone="down">The venue refused to quote: {underground.error.message}</InlineNote>}
      {underground.data && rows.length === 0 && (
        <p className="mt-2 text-[11px] text-ink-faint">Nothing matches here right now — this venue only carries its own focus categories, and stock moves with the world.</p>
      )}
      {rows.length > 0 && (
        <Table label={`${marketName} listings`} className="min-w-[34rem]">
          <thead>
            <tr>
              <Th>Goods</Th>
              <Th align="right">Unit price</Th>
              <Th align="right">Open market</Th>
              <Th align="right">Escrow</Th>
              <Th align="right">Delivery odds</Th>
              <Th align="right">Heat</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((listing) => (
              <ListingRow key={listing.commodityId} listing={listing} />
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function ListingRow({ listing }: { listing: DarknetListing }) {
  return (
    <Tr>
      <Td>
        <span className="text-xs text-ink">{listing.name}</span>
        <span className="block text-[11px] text-ink-faint">
          {humanise(listing.category)} · {humanise(listing.legality)} · {num(listing.available)} available
        </span>
      </Td>
      <Td align="right" className="tnum text-xs">
        {money(listing.unitPrice)}
        {listing.premiumVsOpen !== 0 && (
          <span className={`block text-[11px] ${listing.premiumVsOpen > 0 ? 'text-warn' : 'text-up'}`}>
            {listing.premiumVsOpen > 0 ? '+' : ''}
            {pct(listing.premiumVsOpen, { from: 'fraction', decimals: 0 })} vs open
          </span>
        )}
      </Td>
      <Td align="right" className="tnum text-xs text-ink-dim">{listing.openMarketPrice === null ? '—' : money(listing.openMarketPrice)}</Td>
      <Td align="right" className="tnum text-xs text-ink-dim">{money(listing.escrowFee)}</Td>
      <Td align="right" className="tnum text-xs">{pct(listing.deliveryChance, { from: 'fraction', decimals: 0 })}</Td>
      <Td align="right" className="tnum text-xs text-warn">{num(listing.heatOnPurchase, 1)}</Td>
      <Td align="right">
        <CommandButton
          intent={{ type: 'underground.buy', marketId: listing.marketId, commodityId: listing.commodityId, qty: listing.qty }}
          label={`Buy ${listing.qty} for ${money(listing.totalWithFees)}`}
          size="sm"
          variant="primary"
          disabled={!listing.tradable}
          disabledReason={listing.reason ?? 'This listing cannot be bought from here.'}
          confirm={{
            title: `Buy ${listing.qty} × ${listing.name}?`,
            body: `${money(listing.totalWithFees)} including escrow. Delivery is not guaranteed (${pct(listing.deliveryChance, { from: 'fraction', decimals: 0 })} odds), the goods arrive in this city, and the purchase adds about ${num(listing.heatOnPurchase, 1)} trace heat.`,
            confirmLabel: 'Place darknet order',
          }}
        />
      </Td>
    </Tr>
  );
}

function DataMarket() {
  const underground = useView<UndergroundView>('underground');
  const offers = underground.data?.view.dataOffers ?? [];
  const assets = underground.data?.view.assets ?? [];
  const [kind, setKind] = useState(offers[0]?.kind ?? '');

  return (
    <Panel title="Data" subtitle="Information decays: what was worth a fortune yesterday is a footnote next week">
      {offers.length === 0 ? (
        <EmptyState title="No data on sale" body="Nobody is offering datasets to you at your current reputation." />
      ) : (
        <>
          <label htmlFor="data-kind" className="block text-xs">
            <span className="mb-1 block text-ink-dim">Dataset</span>
            <Select id="data-kind" value={kind || offers[0]!.kind} onChange={(event) => setKind(event.target.value)}>
              {offers.map((offer) => (
                <option key={offer.kind} value={offer.kind}>
                  {offer.name} — {money(offer.price)}
                </option>
              ))}
            </Select>
          </label>
          {(() => {
            const offer = offers.find((entry) => entry.kind === (kind || offers[0]!.kind)) ?? offers[0]!;
            return (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-ink-dim">{offer.description}</p>
                <dl>
                  <KeyValue label="Price">{money(offer.price)}</KeyValue>
                  <KeyValue label="Face value">{money(offer.baseValue)}</KeyValue>
                  <KeyValue label="Decays per day">{pct(offer.freshnessPerDay, { from: 'fraction', decimals: 1 })}</KeyValue>
                  <KeyValue label="Risk while held">{pct(offer.riskOnHold, { from: 'fraction', decimals: 1 })}</KeyValue>
                  <KeyValue label="Likely buyers">{offer.buyers}</KeyValue>
                </dl>
                <CommandButton
                  intent={{ type: 'underground.buy_data', kind: offer.kind }}
                  label={`Buy for ${money(offer.price)}`}
                  variant="primary"
                  confirm={{
                    title: `Buy ${offer.name}?`,
                    body: `It arrives as a holding you must sell on before it goes stale: about ${pct(offer.freshnessPerDay, { from: 'fraction', decimals: 1 })} of its value per day, and it carries ${pct(offer.riskOnHold, { from: 'fraction', decimals: 1 })} risk for as long as you hold it.`,
                    confirmLabel: 'Buy dataset',
                  }}
                />
              </div>
            );
          })()}
        </>
      )}
      {assets.length > 0 && (
        <p className="mt-3 text-[11px] text-ink-faint">
          You are holding {assets.length} dataset{assets.length === 1 ? '' : 's'} — sell them from Holdings before they go stale.
        </p>
      )}
    </Panel>
  );
}

function HackTargets() {
  const underground = useView<UndergroundView>('underground');
  const core = underground.data?.view;
  const targets = core?.hackTargets ?? [];
  const cooling = core?.hackCooldownUntilDay;

  return (
    <Panel title="Targets" subtitle="Attempts burn time and heat whether or not they work">
      {cooling !== null && cooling !== undefined && cooling > 0 && (
        <InlineNote tone="warn">Your last attempt left a trail. Hacking is on cooldown until day {num(cooling)}.</InlineNote>
      )}
      {targets.length === 0 ? (
        <EmptyState title="No targets worth touching" body="Targets appear where the world has something worth taking and your reputation opens the door." />
      ) : (
        <ul className="mt-2 grid gap-2 md:grid-cols-2">
          {targets.map((target) => (
            <li key={`${target.kind}-${target.targetId}`} className="rounded border border-line bg-panel px-2.5 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink">{target.name}</span>
                <Badge tone="violet">{humanise(target.kind)}</Badge>
              </div>
              <p className="mt-1 text-[11px] text-ink-dim">{target.description}</p>
              <dl className="mt-1">
                <KeyValue label="Difficulty">{num(target.difficulty, 2)}</KeyValue>
                <KeyValue label="Success chance" tone={target.successChance < 0.4 ? 'text-warn' : undefined}>
                  {pct(target.successChance, { from: 'fraction', decimals: 0 })}
                </KeyValue>
                <KeyValue label="Expected take">{money(target.rewardEstimate)}</KeyValue>
                <KeyValue label="Heat if it fails">{num(target.heatOnFailure, 1)}</KeyValue>
                <KeyValue label="Loot">{humanise(target.lootKind)}</KeyValue>
              </dl>
              <div className="mt-1.5">
                <CommandButton
                  intent={{ type: 'underground.hack', kind: target.kind, targetId: target.targetId }}
                  label="Attempt hack"
                  size="sm"
                  variant="danger"
                  disabled={cooling !== null && cooling !== undefined && cooling > 0}
                  disabledReason={cooling ? `On cooldown until day ${cooling}.` : 'Not available.'}
                  confirm={{
                    title: `Hack ${target.name}?`,
                    body: `${pct(target.successChance, { from: 'fraction', decimals: 0 })} chance of a take worth roughly ${money(target.rewardEstimate)}. A failed attempt still costs the time and adds ${num(target.heatOnFailure, 1)} heat — the attempt is charged whether or not it succeeds.`,
                    confirmLabel: 'Attempt it',
                    destructive: true,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Holdings() {
  const underground = useView<UndergroundView>('underground');
  const assets = underground.data?.view.assets ?? [];

  return (
    <Panel title="Holdings" subtitle="Data you own, and what it is worth today">
      {assets.length === 0 ? (
        <EmptyState title="No data holdings" body="Datasets you buy or hack appear here. They lose value every day, so the question is never whether to sell, only when." />
      ) : (
        <Table label="Data holdings">
          <thead>
            <tr>
              <Th>Asset</Th>
              <Th>Kind</Th>
              <Th align="right">Age</Th>
              <Th align="right">Freshness</Th>
              <Th align="right">Value</Th>
              <Th align="right">Decay / day</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <Tr key={asset.id}>
                <Td className="text-sm text-ink">{asset.name}</Td>
                <Td className="text-xs text-ink-dim">{humanise(asset.kind)}</Td>
                <Td align="right" className="tnum text-xs">{`${num(asset.ageDays)} day(s)`}</Td>
                <Td align="right">
                  <Meter value={asset.freshness} tone={asset.freshness < 0.4 ? 'down' : asset.freshness < 0.7 ? 'warn' : 'up'} display={pct(asset.freshness, { from: 'fraction', decimals: 0 })} label={`${asset.name} freshness`} />
                </Td>
                <Td align="right" className="tnum">{money(asset.value)}</Td>
                <Td align="right" className="tnum text-xs text-warn">{money(asset.decayPerDay)}</Td>
                <Td align="right">
                  <CommandButton intent={{ type: 'underground.sell_data', assetId: asset.id }} label="Sell" size="sm" variant="success" />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}

function Escrow({ core }: { core: UndergroundView['view'] }) {
  const [amount, setAmount] = useState(1000);
  return (
    <Panel title="Escrow" subtitle="Vendors only transact against a deposit">
      <dl>
        <KeyValue label="Held in escrow">{money(core.escrowBalance)}</KeyValue>
        <KeyValue label="Minimum for some venues">{money(Math.max(...core.markets.map((market) => market.minimumDeposit), 0))}</KeyValue>
      </dl>
      <label htmlFor="escrow-amount" className="mt-2 block text-xs">
        <span className="mb-1 block text-ink-dim">Amount</span>
        <Input id="escrow-amount" type="number" min={1} value={amount} onChange={(event) => setAmount(Math.max(0, Number(event.target.value)))} />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <CommandButton
          intent={{ type: 'underground.escrow_deposit', amount }}
          label="Deposit"
          size="sm"
          variant="primary"
          disabled={amount <= 0}
          disabledReason="Enter an amount."
        />
        <CommandButton
          intent={{ type: 'underground.escrow_withdraw', amount }}
          label="Withdraw"
          size="sm"
          variant="secondary"
          disabled={amount <= 0 || core.escrowBalance <= 0}
          disabledReason={core.escrowBalance <= 0 ? 'Nothing is held in escrow.' : 'Enter an amount.'}
        />
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">
        Money in escrow is outside your accounts: it cannot be spent on the open market, but it is also what a venue sees when it decides whether to deal with you.
      </p>
    </Panel>
  );
}

function Identity({ core }: { core: UndergroundView['view'] }) {
  const [quality, setQuality] = useState(Math.min(0.95, Math.round((core.vpnQuality + 0.1) * 100) / 100));
  return (
    <Panel title="Identity" subtitle="Handle, routing and the cost of disappearing again">
      <dl>
        <KeyValue label="Handle">{core.handle}</KeyValue>
        <KeyValue label="Reputation">{`${num(core.digitalReputation)} — ${core.digitalReputationLabel}`}</KeyValue>
        <KeyValue label="Routing quality">{pct(core.vpnQuality, { from: 'fraction', decimals: 0 })}</KeyValue>
        <KeyValue label="Trace heat">{`${num(core.traceHeat)} — ${core.traceHeatLabel}`}</KeyValue>
        {core.compromisedUntilDay !== null && <KeyValue label="Compromised until" tone="text-down">{`day ${num(core.compromisedUntilDay)}`}</KeyValue>}
      </dl>
      <label htmlFor="vpn-quality" className="mt-2 block text-xs">
        <span className="mb-1 block text-ink-dim">Target routing quality</span>
        <Input
          id="vpn-quality"
          type="number"
          min={core.vpnQuality}
          max={0.95}
          step={0.05}
          value={quality}
          onChange={(event) => setQuality(Number(event.target.value))}
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <CommandButton
          intent={{ type: 'underground.upgrade_vpn', targetQuality: quality }}
          label="Improve routing"
          size="sm"
          variant="secondary"
          disabled={quality <= core.vpnQuality}
          disabledReason="Choose a higher quality than you already have."
        />
        <CommandButton
          intent={{ type: 'underground.burn_handle' }}
          label="Burn the handle"
          size="sm"
          variant="danger"
          confirm={{
            title: 'Burn your handle?',
            body: 'Your identity and its reputation are destroyed. Heat is wiped, but so is everything you built with it — venues will treat you as a stranger again.',
            confirmLabel: 'Burn it',
            destructive: true,
          }}
        />
      </div>
    </Panel>
  );
}

function TrackRecord({ core }: { core: UndergroundView['view'] }) {
  const stats = core.stats;
  const totalHacks = stats.hacksSuccess + stats.hacksFailed;
  return (
    <Panel title="Track record" subtitle="What the network has actually seen you do">
      <dl>
        <KeyValue label="Data sold">{num(stats.dataSold)}</KeyValue>
        <KeyValue label="Data revenue">{money(stats.dataRevenue)}</KeyValue>
        <KeyValue label="Hacks succeeded">{num(stats.hacksSuccess)}</KeyValue>
        <KeyValue label="Hacks failed">{num(stats.hacksFailed)}</KeyValue>
        <KeyValue label="Exit scams suffered" tone={stats.exitScams > 0 ? 'text-down' : undefined}>
          {num(stats.exitScams)}
        </KeyValue>
        <KeyValue label="Hack revenue">{money(stats.hackRevenue)}</KeyValue>
      </dl>
      {totalHacks > 0 && <Meter label="Hack success rate" value={stats.hacksSuccess / totalHacks} display={pct(stats.hacksSuccess / totalHacks, { from: 'fraction', decimals: 0 })} tone="violet" />}
      <p className="mt-2 text-[11px] text-ink-faint">
        Reputation grows with completed deals and shrinks with burned vendors. {core.hiddenChannelListings} hidden-channel goods are moving through this city right now.
      </p>
    </Panel>
  );
}
