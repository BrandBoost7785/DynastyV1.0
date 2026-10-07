'use client';

/**
 * Businesses.
 *
 * A business is a daily machine: it earns from local demand, pays wages, opex and tax,
 * accumulates a cashbox and — if it is the kind that can — launders dirty money through
 * that cashbox at a rate the server publishes. The screen sorts owned ventures by what
 * they actually contribute, shows the signals behind each one's demand, and lets a player
 * open, upgrade, promote, sweep or close.
 */
import { useState } from 'react';
import { useGame, useView } from '../../../../lib/game-context';
import { ViewPanel, CommandButton, QuantityPicker } from '../../../../components/game/view-panel';
import { BarList } from '../../../../components/game/charts';
import { Badge, Button, Checkbox, Input, KeyValue, Meter, Panel, Tabs } from '../../../../components/ui/primitives';
import { InlineNote } from '../../../../components/ui/states';
import { humanise, money, num, pct } from '../../../../lib/format';
import type { BusinessListing, BusinessesView, BusinessViewRow } from '../../../../lib/game-data';

type Tab = 'owned' | 'open';

export default function BusinessesPage() {
  const [tab, setTab] = useState<Tab>('owned');
  const businesses = useView<BusinessesView>('businesses');
  const portfolio = businesses.data?.portfolio;
  const owned = businesses.data?.businesses ?? [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Operations</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">Businesses</h1>
          <p className="mt-1 text-xs text-ink-dim">
            {portfolio
              ? `${portfolio.count} open (${portfolio.legal} legal, ${portfolio.illegal} illegal) · ${money(portfolio.dailyProfit, { sign: true })}/day · valuation ${money(portfolio.totalValuation)}`
              : 'Reading the portfolio…'}
          </p>
        </div>
        <Tabs
          label="Business sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'owned', label: 'Your businesses', count: owned.length },
            { id: 'open', label: 'Open a business', count: businesses.data?.catalogue.length },
          ]}
        />
      </header>

      {portfolio && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Daily revenue" value={money(portfolio.dailyRevenue)} sub={`opex ${money(portfolio.dailyOpex)}`} />
          <Tile label="Daily profit" value={money(portfolio.dailyProfit, { sign: true })} sub={`wages ${money(portfolio.dailyWages)} · tax ${money(portfolio.dailyTax)}`} tone={portfolio.dailyProfit >= 0 ? 'up' : 'down'} />
          <Tile label="Cash in tills" value={money(portfolio.cashboxTotal)} sub={`laundered to date ${money(portfolio.launderedTotal)}`} tone="gold" />
          <Tile
            label="Staff employed"
            value={num(portfolio.staffEmployed)}
            sub={portfolio.suspended > 0 ? `${portfolio.suspended} business(es) suspended` : 'all operating'}
            tone={portfolio.suspended > 0 ? 'down' : undefined}
          />
        </div>
      )}

      {portfolio && (portfolio.bestPerformer || portfolio.worstPerformer) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {portfolio.bestPerformer && (
            <Panel title="Best performer" subtitle={portfolio.bestPerformer.name}>
              <p className="tnum text-lg text-up">{money(portfolio.bestPerformer.profitPerDay)}/day</p>
            </Panel>
          )}
          {portfolio.worstPerformer && (
            <Panel title="Needs attention" subtitle={portfolio.worstPerformer.name}>
              <p className={`tnum text-lg ${portfolio.worstPerformer.profitPerDay < 0 ? 'text-down' : 'text-ink'}`}>{money(portfolio.worstPerformer.profitPerDay)}/day</p>
            </Panel>
          )}
        </div>
      )}

      {tab === 'owned' ? (
        <ViewPanel<BusinessesView>
          view="businesses"
          title="Operating ventures"
          isEmpty={(data) => data.businesses.length === 0}
          emptyTitle="You are not running a business yet"
          emptyBody="A business earns every day it is open, employs staff, pays tax and — where the kind allows — launders dirty cash through its takings. Open one from the catalogue."
        >
          {() => (
            <ul className="space-y-3">
              {owned.map((business) => (
                <BusinessCard key={business.id} business={business} />
              ))}
            </ul>
          )}
        </ViewPanel>
      ) : (
        <Catalogue />
      )}
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

function BusinessCard({ business }: { business: BusinessViewRow }) {
  const [open, setOpen] = useState(false);
  const [sweepAmount, setSweepAmount] = useState(Math.floor(business.cashbox));
  const [marketingAmount, setMarketingAmount] = useState(2500);

  const losing = business.profitPerDay < 0;
  return (
    <li className={`rounded-panel border ${business.suspended ? 'border-down/40' : 'border-line'} bg-panel`}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            {business.name}
            <Badge tone={business.legality === 'legal' ? 'up' : business.legality === 'contraband' ? 'down' : 'warn'}>{humanise(business.legality)}</Badge>
            {business.suspended && <Badge tone="down">suspended</Badge>}
            <Badge tone="neutral">level {business.level}/{business.maxLevel}</Badge>
          </h3>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            {humanise(business.kind)} · {business.locationName}
            {business.propertyName ? ` · ${business.propertyName}` : ''} · open {business.daysOperating} days
          </p>
        </div>
        <div className="text-right">
          <p className={`tnum text-lg font-semibold ${losing ? 'text-down' : 'text-up'}`}>{money(business.profitPerDay, { sign: true })}</p>
          <p className="text-[11px] text-ink-faint">per day</p>
        </div>
      </header>

      <div className="grid gap-4 px-4 pb-3 lg:grid-cols-4">
        <dl className="space-y-0.5">
          <KeyValue label="Revenue / day">{money(business.revenuePerDay)}</KeyValue>
          <KeyValue label="Opex / day">{money(business.opexPerDay)}</KeyValue>
          <KeyValue label="Wages / day">{money(business.wagesPerDay)}</KeyValue>
          <KeyValue label="Tax / day">{money(business.taxPerDay)}</KeyValue>
          <KeyValue label="30-day profit" tone={business.profit30d >= 0 ? 'text-up' : 'text-down'}>
            {money(business.profit30d, { sign: true })}
          </KeyValue>
        </dl>
        <dl className="space-y-0.5">
          <KeyValue label="Cashbox">{money(business.cashbox)}</KeyValue>
          <KeyValue label="Dirty cash held">{money(business.launderingBuffer)}</KeyValue>
          <KeyValue label="Laundered total">{money(business.launderedTotal)}</KeyValue>
          <KeyValue label="Laundering capacity">{money(business.launderingCapacityPerDay)}/day</KeyValue>
          <KeyValue label="Valuation">{money(business.valuation)}</KeyValue>
        </dl>
        <div className="space-y-2">
          <div>
            <p className="text-[11px] text-ink-faint">Condition</p>
            <Meter value={business.condition} tone={business.condition < 0.4 ? 'down' : business.condition < 0.7 ? 'warn' : 'up'} display={pct(business.condition, { from: 'fraction', decimals: 0 })} />
          </div>
          <div>
            <p className="text-[11px] text-ink-faint">Local reputation</p>
            <Meter value={Math.max(0, Math.min(1, business.reputationLocal))} tone="gold" display={num(business.reputationLocal, 2)} />
          </div>
          <div>
            <p className="text-[11px] text-ink-faint">Clientele</p>
            <p className="tnum text-sm text-ink">{num(business.clientele)}</p>
          </div>
          <div>
            <p className="text-[11px] text-ink-faint">Marketing spend</p>
            <p className="tnum text-sm text-ink">{money(business.marketing)}</p>
          </div>
        </div>
        <div className="space-y-2">
          <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Demand</h4>
          <p className="tnum text-sm text-ink">Index {num(business.demandIndex, 2)}</p>
          {business.demandDrivers.length > 0 && <BarList items={business.demandDrivers.map((driver) => ({ label: driver.label, value: driver.value, tone: driver.value >= 0 ? 'up' as const : 'down' as const }))} format={(value) => pct(value, { from: 'fraction', sign: true, decimals: 0 })} />}
          <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Staff</h4>
          <p className="text-xs text-ink-dim">
            {business.staffCount}/{business.staffSlots} employed · manager {business.manager ? `${business.manager.name} (skill ${num(business.manager.skill, 1)})` : 'none'}
          </p>
        </div>
      </div>

      {business.risks.length > 0 && (
        <ul className="px-4 pb-3">
          {business.risks.map((risk) => (
            <li key={risk}>
              <InlineNote tone="warn">{risk}</InlineNote>
            </li>
          ))}
        </ul>
      )}
      {business.suspended && business.suspensionReason && <div className="px-4 pb-3"><InlineNote tone="down">{business.suspensionReason}</InlineNote></div>}

      <div className="border-t border-line px-4 py-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide controls' : 'Manage this business'}
        </Button>
      </div>

      {open && (
        <div className="grid gap-4 border-t border-line px-4 py-3 lg:grid-cols-3">
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Sweep the till</h4>
            <p className="text-xs text-ink-dim">Move the cashbox into your accounts. Money swept from an illegal business arrives clean.</p>
            <QuantityPicker value={sweepAmount} onChange={setSweepAmount} max={Math.max(0, Math.floor(business.cashbox))} unit="cash" label="Amount to sweep" id={`sweep-${business.id}`} />
            <CommandButton
              intent={{ type: 'business.sweep', businessId: business.id, amount: sweepAmount }}
              label="Sweep to accounts"
              variant="success"
              disabled={sweepAmount <= 0 || sweepAmount > business.cashbox}
              disabledReason={business.cashbox <= 0 ? 'The cashbox is empty.' : 'Enter an amount within the cashbox.'}
            />
          </div>

          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Invest in demand</h4>
            <p className="text-xs text-ink-dim">Marketing raises clientele, which raises revenue — with diminishing returns per day.</p>
            <QuantityPicker value={marketingAmount} onChange={setMarketingAmount} unit="cash" label="Marketing spend" id={`marketing-${business.id}`} step={500} />
            <CommandButton
              intent={{ type: 'business.marketing', businessId: business.id, amount: marketingAmount }}
              label="Spend on marketing"
              variant="secondary"
              disabled={marketingAmount <= 0}
              disabledReason="Enter an amount to spend."
              confirm={marketingAmount >= 25000 ? { title: 'Spend this on marketing?', body: `${money(marketingAmount)} is a large single-day spend on one business.`, confirmLabel: 'Spend it' } : undefined}
            />
          </div>

          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Upgrade or close</h4>
            <p className="text-xs text-ink-dim">
              Level {business.level} of {business.maxLevel}. Upgrading raises capacity and demand at a one-off cost of {money(business.upgradeCost)}.
            </p>
            <CommandButton
              intent={{ type: 'business.upgrade', businessId: business.id }}
              label={`Upgrade for ${money(business.upgradeCost)}`}
              variant="primary"
              disabled={business.level >= business.maxLevel}
              disabledReason="This business is already at its maximum level."
              confirm={{ title: `Upgrade ${business.name}?`, body: `${money(business.upgradeCost)} is charged immediately. Higher levels raise both earnings and overheads.`, confirmLabel: 'Upgrade' }}
            />
            <CommandButton
              intent={{ type: 'business.close', businessId: business.id }}
              label="Close business"
              variant="danger"
              confirm={{
                title: `Close ${business.name}?`,
                body: 'The venture stops trading, staff are let go and any remaining cashbox is swept to you. The property stays yours. This cannot be undone.',
                confirmLabel: 'Close it',
                destructive: true,
              }}
            />
          </div>
        </div>
      )}
    </li>
  );
}

function Catalogue() {
  const { gameId } = useGame();
  const businesses = useView<BusinessesView>('businesses');
  const catalogue = businesses.data?.catalogue ?? [];
  const properties = useView<{ owned: { id: string; name: string; kind: string; locationName: string }[] }>('properties');
  const [propertyByDef, setPropertyByDef] = useState<Record<string, string>>({});
  const [kind, setKind] = useState('');
  const [maxPayback, setMaxPayback] = useState('');
  const [onlyAffordable, setOnlyAffordable] = useState(false);

  const kinds = [...new Set(catalogue.map((item) => item.kind))];
  const filtered = catalogue.filter((item) => {
    if (kind && item.kind !== kind) return false;
    if (onlyAffordable && !item.canOpen) return false;
    if (maxPayback && item.estimatedPaybackDays > Number(maxPayback)) return false;
    return true;
  });

  const ownedProperties = properties.data?.owned ?? [];

  return (
    <ViewPanel<BusinessesView>
      view="businesses"
      title="Franchise catalogue"
      subtitle="Business types available at your location"
      isEmpty={(data) => data.catalogue.length === 0}
      emptyTitle="Nothing is on offer here"
      emptyBody="Business types are local: a port city offers different ventures from an inland capital. Travel, or check the catalogue where you are."
      actions={
        <>
          <Input placeholder="Max payback (days)" inputMode="numeric" value={maxPayback} onChange={(event) => setMaxPayback(event.target.value.replace(/[^0-9]/g, ''))} aria-label="Maximum payback days" className="w-40" />
          <label className="flex items-center gap-2 text-xs text-ink-dim">
            <span>Kind</span>
            <select className="rounded-md border border-line-strong bg-hull px-2 py-1.5 text-sm text-ink" value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Business kind">
              <option value="">All kinds</option>
              {kinds.map((item) => (
                <option key={item} value={item}>
                  {humanise(item)}
                </option>
              ))}
            </select>
          </label>
          <Checkbox label="Only openable now" checked={onlyAffordable} onChange={setOnlyAffordable} />
        </>
      }
    >
      {() => (
        <ul className="space-y-3">
          {filtered.map((listing) => (
            <ListingRow
              key={listing.defId}
              listing={listing}
              properties={ownedProperties}
              chosenProperty={propertyByDef[listing.defId] ?? listing.suitableProperties[0]?.id ?? ''}
              onChoose={(propertyId) => setPropertyByDef({ ...propertyByDef, [listing.defId]: propertyId })}
              gameId={gameId}
            />
          ))}
          {filtered.length === 0 && <li className="text-xs text-ink-faint">No business types match those filters.</li>}
        </ul>
      )}
    </ViewPanel>
  );
}

function ListingRow({
  listing,
  properties,
  chosenProperty,
  onChoose,
  gameId,
}: {
  listing: BusinessListing;
  properties: { id: string; name: string; kind: string; locationName: string }[];
  chosenProperty: string;
  onChoose: (propertyId: string) => void;
  gameId: string;
}) {
  // The catalogue itself says which properties suit the type; the owned list is only used
  // to filter to what the player already has.
  const options = properties.filter((property) => listing.suitableProperties.some((suitable) => suitable.id === property.id));
  const chosen = options.find((property) => property.id === chosenProperty) ?? options[0];

  return (
    <li className="rounded-panel border border-line bg-panel px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            {listing.name}
            <Badge tone={listing.legality === 'legal' ? 'up' : listing.legality === 'contraband' ? 'down' : 'warn'}>{humanise(listing.legality)}</Badge>
            <Badge tone="neutral">{humanise(listing.kind)}</Badge>
          </h3>
          <p className="mt-0.5 max-w-3xl text-xs text-ink-dim">{listing.description}</p>
        </div>
        <div className="text-right">
          <p className="tnum text-sm text-ink">{money(listing.setupCost)} setup</p>
          <p className="tnum text-[11px] text-ink-faint">
            {money(listing.estimatedDailyProfit, { sign: true })}/day · payback {listing.estimatedPaybackDays > 0 ? `${num(listing.estimatedPaybackDays)}d` : '—'}
          </p>
        </div>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
        <KeyValue label="Base revenue">{money(listing.baseDailyRevenue)}/day</KeyValue>
        <KeyValue label="Base opex">{money(listing.baseDailyOpex)}/day</KeyValue>
        <KeyValue label="Staff slots">{listing.staffSlots}</KeyValue>
        <KeyValue label="Laundering capacity">{money(listing.launderingCapacityPerDay)}/day</KeyValue>
        <KeyValue label="Demand sensitivity">{num(listing.demandSensitivity, 2)}</KeyValue>
        <KeyValue label="Reputation effect">
          {listing.reputationEffect ? `${humanise(listing.reputationEffect.dimension)} ${listing.reputationEffect.perDay >= 0 ? '+' : ''}${num(listing.reputationEffect.perDay, 3)}/day` : '—'}
        </KeyValue>
        <KeyValue label="Needs property">{humanise(listing.requiredPropertyKind)}</KeyValue>
        <KeyValue label="Skill">
          {listing.requiredSkill ? <span className={listing.skillMet ? 'text-up' : 'text-down'}>{humanise(listing.requiredSkill)} {listing.skillMet ? 'met' : 'not met'}</span> : 'none'}
        </KeyValue>
      </dl>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="mb-1 block text-ink-dim">Property to open in</span>
          <select
            className="rounded-md border border-line-strong bg-hull px-2 py-1.5 text-sm text-ink"
            value={chosen?.id ?? ''}
            onChange={(event) => onChoose(event.target.value)}
            aria-label={`Property for ${listing.name}`}
          >
            {options.length === 0 && <option value="">No suitable property owned</option>}
            {options.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name} — {property.locationName}
              </option>
            ))}
          </select>
        </label>
        <CommandButton
          intent={{ type: 'business.open', defId: listing.defId, propertyId: chosen?.id ?? '' }}
          label={`Open for ${money(listing.setupCost)}`}
          variant={listing.canOpen ? 'success' : 'secondary'}
          disabled={!listing.canOpen || !chosen}
          disabledReason={listing.reason ?? (!chosen ? 'You need a suitable property at this location first.' : 'This cannot be opened right now.')}
          confirm={{ title: `Open ${listing.name}?`, body: `${money(listing.setupCost)} is charged to set the venture up in ${chosen?.name ?? 'your property'}.`, confirmLabel: 'Open business' }}
        />
        {!listing.canOpen && listing.reason && <p className="text-[11px] text-warn">{listing.reason}</p>}
        <p className="text-[11px] text-ink-faint">
          Suited to {listing.suitableProperties.length} of your properties. <span className="sr-only">game {gameId}</span>
        </p>
      </div>
    </li>
  );
}
