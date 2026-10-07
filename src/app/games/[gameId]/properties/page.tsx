'use client';

/**
 * Property.
 *
 * Premises are the physical layer under everything else: they hold storage, they host
 * businesses and production lines, they cost carry every day and they can be bought,
 * upgraded, insured, repaired or sold. The listings below come from the server's own
 * property catalogue for the location you are standing in.
 */
import { useMemo, useState } from 'react';
import { useGame, useView } from '../../../../lib/game-context';
import { ViewPanel, CommandButton } from '../../../../components/game/view-panel';
import { BarList } from '../../../../components/game/charts';
import { Badge, Button, Checkbox, Delta, Input, KeyValue, Meter, Panel, Table, Td, Th, Tr } from '../../../../components/ui/primitives';
import { humanise, mass, money, pct, volume } from '../../../../lib/format';
import type { PropertyListing, PropertyOwned, PropertiesView } from '../../../../lib/game-data';

export default function PropertiesPage() {
  const properties = useView<PropertiesView>('properties');
  const portfolio = properties.data?.portfolio;
  const owned = properties.data?.owned ?? [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Real assets</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">Properties</h1>
          <p className="mt-1 text-xs text-ink-dim">
            {portfolio
              ? `${portfolio.count} owned across ${portfolio.locations} location(s) · valuation ${money(portfolio.totalValuation)} · carry ${money(portfolio.carryPerDay)}/day`
              : 'Reading the portfolio…'}
          </p>
        </div>
      </header>

      {portfolio && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Valuation" value={money(portfolio.totalValuation)} sub={`bought for ${money(portfolio.totalPurchasePrice)}`} />
            <Tile label="Unrealised gain" value={money(portfolio.unrealisedGain, { sign: true })} sub={`${pct(portfolio.totalPurchasePrice > 0 ? portfolio.unrealisedGain / portfolio.totalPurchasePrice : 0, { from: 'fraction', sign: true, decimals: 1 })} on cost`} tone={portfolio.unrealisedGain >= 0 ? 'up' : 'down'} />
            <Tile label="Net carry" value={money(portfolio.netPerDay, { sign: true })} sub={`rent ${money(portfolio.rentPerDay)} − carry ${money(portfolio.carryPerDay)}`} tone={portfolio.netPerDay >= 0 ? 'up' : 'down'} />
            <Tile label="Arrears" value={money(portfolio.arrears)} sub={portfolio.arrears > 0 ? 'unpaid property charges' : 'up to date'} tone={portfolio.arrears > 0 ? 'down' : undefined} />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Panel title="Portfolio shape" subtitle="Where the value sits">
              {owned.length === 0 ? (
                <p className="text-xs text-ink-faint">Nothing owned yet.</p>
              ) : (
                <BarList
                  items={owned
                    .slice()
                    .sort((a, b) => b.valuation - a.valuation)
                    .slice(0, 8)
                    .map((property) => ({ label: property.name, value: property.valuation }))}
                  format={(value) => money(value, { compact: true })}
                />
              )}
            </Panel>
            <Panel title="Storage under management" subtitle="Capacity your property provides">
              <dl className="space-y-0.5">
                <KeyValue label="Total capacity">{mass(portfolio.totalStorageKg)}</KeyValue>
                <KeyValue label="Average condition">
                  <Delta value={portfolio.averageCondition - 1} format={() => pct(portfolio.averageCondition, { from: 'fraction', decimals: 0 })} />
                </KeyValue>
                <KeyValue label="Average condition value">{pct(portfolio.averageCondition, { from: 'fraction', decimals: 0 })}</KeyValue>
              </dl>
            </Panel>
            <Panel title="What property is for">
              <ul className="space-y-1 text-xs text-ink-dim">
                <li>Storage: every premise carries weight and volume limits you can use for free.</li>
                <li>Businesses: a venture needs a premise of the right kind before it can open.</li>
                <li>Production: recipe lines install into premises with the matching tags.</li>
                <li>Carry: opex, property tax and insurance are charged every simulated day.</li>
                <li>Risk: raids, arrears and forced sales happen when you neglect a property.</li>
              </ul>
            </Panel>
          </div>
        </>
      )}

      <ViewPanel<PropertiesView>
        view="properties"
        title="Owned premises"
        subtitle="Each property's condition, storage and daily carry"
        isEmpty={(data) => data.owned.length === 0}
        emptyTitle="You own no property"
        emptyBody="Buying premises unlocks storage, a home for a business, and a place to run production. Listings for your location are below."
      >
        {() => (
          <ul className="space-y-2">
            {owned.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </ul>
        )}
      </ViewPanel>

      <Listings />
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'up' | 'down' }) {
  return (
    <div className="rounded-panel border border-line bg-panel px-3 py-2.5">
      <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">{label}</p>
      <p className={`tnum mt-0.5 text-lg font-semibold ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-ink'}`}>{value}</p>
      <p className="text-[11px] text-ink-faint">{sub}</p>
    </div>
  );
}

function PropertyCard({ property }: { property: PropertyOwned }) {
  const [open, setOpen] = useState(false);
  const conditionTone = property.condition < 0.4 ? 'down' : property.condition < 0.7 ? 'warn' : 'up';

  return (
    <li className="rounded-panel border border-line bg-panel px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            {property.name}
            <Badge tone="neutral">{humanise(property.kind)}</Badge>
            <Badge tone="neutral">level {property.upgradeLevel}/{property.maxUpgradeLevel}</Badge>
            {property.insured && <Badge tone="info">insured</Badge>}
            {property.refrigerated && <Badge tone="info">cold storage</Badge>}
            {property.staffed && <Badge tone="info">staffed</Badge>}
          </h3>
          <p className="mt-0.5 text-[11px] text-ink-faint">{property.locationName}</p>
        </div>
        <div className="text-right">
          <p className="tnum text-lg font-semibold text-ink">{money(property.valuation)}</p>
          <p className={`tnum text-[11px] ${property.valuationChange >= 0 ? 'text-up' : 'text-down'}`}>
            {pct(property.valuationChange, { from: 'fraction', sign: true, decimals: 1 })} vs purchase
          </p>
        </div>
      </div>

      <div className="mt-2 grid gap-3 lg:grid-cols-4">
        <dl className="space-y-0.5">
          <KeyValue label="Purchase price">{money(property.purchasePrice)}</KeyValue>
          <KeyValue label="Opex / day">{money(property.opexPerDay)}</KeyValue>
          <KeyValue label="Property tax / day">{money(property.taxPerDay)}</KeyValue>
          <KeyValue label="Insurance / day">{money(property.insurancePerDay)}</KeyValue>
          <KeyValue label="Rent income / day">{property.rentalIncomePerDay > 0 ? money(property.rentalIncomePerDay) : '—'}</KeyValue>
        </dl>
        <div className="space-y-2">
          <div>
            <p className="text-[11px] text-ink-faint">Condition</p>
            <Meter value={property.condition} tone={conditionTone} display={pct(property.condition, { from: 'fraction', decimals: 0 })} />
          </div>
          <div>
            <p className="text-[11px] text-ink-faint">Security</p>
            <Meter value={property.security} tone="info" display={pct(property.security, { from: 'fraction', decimals: 0 })} />
          </div>
        </div>
        <div className="space-y-2">
          <div>
            <p className="text-[11px] text-ink-faint">Storage used</p>
            <Meter value={property.utilisation} tone={property.utilisation > 0.9 ? 'warn' : 'gold'} display={pct(property.utilisation, { from: 'fraction', decimals: 0 })} />
            <p className="tnum mt-0.5 text-[11px] text-ink-faint">
              {mass(property.usedKg)} / {mass(property.storageKg)} · {volume(property.usedL)} / {volume(property.storageL)}
            </p>
          </div>
          <KeyValue label="Hidden compartment">{property.hiddenCompartmentKg > 0 ? mass(property.hiddenCompartmentKg) : 'none'}</KeyValue>
        </div>
        <dl className="space-y-0.5">
          <KeyValue label="Staff assigned">{property.staff.length}</KeyValue>
          <KeyValue label="Business hosted">{property.businessName ?? '—'}</KeyValue>
          <KeyValue label="Production lines">{property.productionLines}</KeyValue>
          <KeyValue label="Recipes enabled">{property.recipesEnabled.length}</KeyValue>
          <KeyValue label="Owned for">{property.ownedDays} days</KeyValue>
          <KeyValue label="Next upgrade">{property.nextUpgradeCost > 0 ? money(property.nextUpgradeCost) : 'max level'}</KeyValue>
        </dl>
      </div>

      {(property.arrears > 0 || property.raidedDay !== null || property.damagedUntilDay !== null) && (
        <ul className="mt-2 space-y-0.5 text-[11px]">
          {property.arrears > 0 && <li className="text-warn">Arrears of {money(property.arrears)} — unpaid charges accumulate penalties and can force a sale.</li>}
          {property.raidedDay !== null && <li className="text-warn">Last raided on day {property.raidedDay}. Security is what reduces the chance of another.</li>}
          {property.damagedUntilDay !== null && <li className="text-warn">Damaged and unusable until day {property.damagedUntilDay}.</li>}
        </ul>
      )}

      <div className="mt-2 border-t border-line pt-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide controls' : 'Manage property'}
        </Button>
        {open && (
          <div className="mt-2 grid gap-3 lg:grid-cols-3">
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Upgrade</h4>
              <p className="text-xs text-ink-dim">Upgrades raise storage, security and the kind of business the premise can host.</p>
              <CommandButton
                intent={{ type: 'property.upgrade', propertyId: property.id }}
                label={property.nextUpgradeCost > 0 ? `Upgrade for ${money(property.nextUpgradeCost)}` : 'Maximum level reached'}
                variant="primary"
                disabled={property.upgradeLevel >= property.maxUpgradeLevel}
                disabledReason="This property cannot be upgraded further."
                confirm={{ title: `Upgrade ${property.name}?`, body: `${money(property.nextUpgradeCost)} is charged now and the property closes for the work.`, confirmLabel: 'Upgrade' }}
              />
            </div>
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Repair &amp; insure</h4>
              <p className="text-xs text-ink-dim">Condition decays daily; raids and accidents damage it faster. Insurance pays out on covered loss.</p>
              <CommandButton intent={{ type: 'property.repair', propertyId: property.id }} label="Repair to full condition" variant="secondary" disabled={property.condition >= 0.999} disabledReason="Already in full condition." />
              <CommandButton
                intent={{ type: 'property.insure', propertyId: property.id, insured: !property.insured }}
                label={property.insured ? 'Cancel insurance' : 'Insure this property'}
                variant="secondary"
                confirm={property.insured ? { title: 'Cancel insurance?', body: 'Losses from raids, fire and theft would no longer be covered at this property.', confirmLabel: 'Cancel cover' } : undefined}
              />
            </div>
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Sell</h4>
              <p className="text-xs text-ink-dim">
                Selling pays current valuation less any transfer tax and unsettled charges. Businesses and production lines inside must be closed first.
              </p>
              <CommandButton
                intent={{ type: 'property.sell', propertyId: property.id }}
                label="Sell property"
                variant="danger"
                disabled={property.businessId !== null || property.productionLines > 0}
                disabledReason="Close the businesses and production lines inside before selling."
                confirm={{ title: `Sell ${property.name}?`, body: `You receive approximately ${money(property.valuation)}. Anything still stored there must be moved out first.`, confirmLabel: 'Sell', destructive: true }}
              />
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

function Listings() {
  const { gameId } = useGame();
  const properties = useView<PropertiesView>('properties');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [onlyAffordable, setOnlyAffordable] = useState(false);

  const listings = properties.data?.listings ?? [];
  const kinds = useMemo(() => [...new Set(listings.map((item) => item.kind))].sort(), [listings]);
  const filtered = listings.filter((item) => {
    if (kind && item.kind !== kind) return false;
    if (onlyAffordable && !item.affordable) return false;
    if (search && !`${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <ViewPanel<PropertiesView>
      view="properties"
      title="Listings at this location"
      subtitle="What is for sale where you are standing"
      isEmpty={(data) => data.listings.length === 0}
      emptyTitle="Nothing is listed here"
      emptyBody="Property listings are local. Travel to another location, or check the auction house for distressed sales."
      actions={
        <>
          <Input placeholder="Search listings" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search property listings" />
          <label className="flex items-center gap-2 text-xs text-ink-dim">
            <span>Kind</span>
            <select className="rounded-md border border-line-strong bg-hull px-2 py-1.5 text-sm text-ink" value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Property kind">
              <option value="">All kinds</option>
              {kinds.map((item) => (
                <option key={item} value={item}>
                  {humanise(item)}
                </option>
              ))}
            </select>
          </label>
          <Checkbox label="Affordable" checked={onlyAffordable} onChange={setOnlyAffordable} />
        </>
      }
    >
      {() => (
        <Table label="Property listings">
          <thead>
            <tr>
              <Th>Property</Th>
              <Th align="right">Price</Th>
              <Th align="right">Transfer tax</Th>
              <Th align="right">Net cost</Th>
              <Th align="right">Storage</Th>
              <Th align="right">Security</Th>
              <Th align="right">Carry / day</Th>
              <Th align="right">Est. rent</Th>
              <Th>Enables</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <Tr>
                <Td className="text-xs text-ink-faint" colSpan={10}>
                  No listings match those filters at this location.
                </Td>
              </Tr>
            )}
            {filtered.map((listing) => (
              <ListingRow key={listing.defId} listing={listing} gameId={gameId} />
            ))}
          </tbody>
        </Table>
      )}
    </ViewPanel>
  );
}

function ListingRow({ listing, gameId }: { listing: PropertyListing; gameId: string }) {
  return (
    <Tr>
      <Td>
        <span className="text-sm text-ink">{listing.name}</span>
        <span className="block max-w-xl text-[11px] text-ink-faint">
          {humanise(listing.kind)} · {listing.description}
        </span>
      </Td>
      <Td align="right" className="tnum">{money(listing.askingPrice)}</Td>
      <Td align="right" className="tnum text-xs text-ink-dim">{money(listing.transferTax)}</Td>
      <Td align="right" className="tnum">{money(listing.netCost)}</Td>
      <Td align="right" className="tnum text-xs">
        {mass(listing.storageKg)}
        {listing.storageL > 0 ? ` / ${volume(listing.storageL)}` : ''}
        {listing.hiddenCompartmentKg > 0 && <span className="block text-violet">{mass(listing.hiddenCompartmentKg)} hidden</span>}
      </Td>
      <Td align="right" className="tnum text-xs">{pct(listing.security, { from: 'fraction', decimals: 0 })}</Td>
      <Td align="right" className="tnum text-xs">{money(listing.totalCarryPerDay)}</Td>
      <Td align="right" className="tnum text-xs">
        {money(listing.estimatedRentPerDay)}/day
        <span className="block text-ink-faint">{pct(listing.rentYieldAnnual, { from: 'fraction', decimals: 1 })} p.a.</span>
      </Td>
      <Td className="text-[11px] text-ink-dim">
        {listing.enablesBusinessId ? <span className="block">business: {humanise(listing.enablesBusinessId)}</span> : null}
        {listing.recipesEnabled > 0 ? <span className="block">{listing.recipesEnabled} recipe(s)</span> : null}
        {listing.productionTags.length > 0 ? <span className="block text-ink-faint">{listing.productionTags.map(humanise).join(', ')}</span> : null}
        <span className="sr-only">game {gameId}</span>
      </Td>
      <Td align="right">
        <CommandButton
          intent={{ type: 'property.buy', defId: listing.defId }}
          label="Buy"
          size="sm"
          variant={listing.affordable ? 'success' : 'secondary'}
          disabled={!listing.affordable}
          disabledReason="You cannot afford this property."
          confirm={{
            title: `Buy ${listing.name}?`,
            body: `${money(listing.netCost)} including ${money(listing.transferTax)} transfer tax leaves your accounts immediately. Carry of ${money(listing.totalCarryPerDay)}/day begins the next day.`,
            confirmLabel: 'Buy property',
          }}
        />
      </Td>
    </Tr>
  );
}
