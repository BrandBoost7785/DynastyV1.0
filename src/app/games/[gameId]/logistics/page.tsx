'use client';

/**
 * Logistics.
 *
 * Freight is how goods leave the city you bought them in: a vehicle is capacity, a
 * shipment is cargo in motion, and every shipment carries a declared value, an insurance
 * decision and a customs risk the server calculates from the route. This screen shows the
 * state of all three and lets a player dispatch a new one.
 */
import { useMemo, useState } from 'react';
import { api } from '../../../../lib/api-client';
import { useGame, useView } from '../../../../lib/game-context';
import { ViewPanel, CommandButton, QuantityPicker } from '../../../../components/game/view-panel';
import { Badge, Button, Checkbox, Input, KeyValue, Meter, Panel, Progress, Select, Table, Tabs, Td, Th, Tr } from '../../../../components/ui/primitives';
import { EmptyState, InlineNote } from '../../../../components/ui/states';
import { humanise, mass, money, num, pct, shortId, volume } from '../../../../lib/format';
import type { DestinationsView, InventoryView, LogisticsView, RivalTradeView, TravelPlan } from '../../../../lib/game-data';

type Tab = 'shipments' | 'vehicles' | 'storage' | 'dispatch';

interface VehicleView {
  id: string;
  name: string;
  kind: string;
  locationName: string;
  here: boolean;
  condition: number;
  damage: number;
  fuel: number;
  capacityKg: number;
  usedKg: number;
  stealth: number;
  armor: number;
  value: number;
  serviceCost: number;
  freeUpgradeSlots: number;
  inTransit: boolean;
  insured: boolean;
  odometerKm?: number;
  upgrades: { id: string; name: string }[];
  upgradeOptions?: { id: string; name: string; description: string; price: number; installed: boolean; affordable: boolean }[];
}

interface VehicleListingRow {
  defId: string;
  name: string;
  kind: string;
  price: number;
  capacityKg: number;
  capacityL: number;
  speedKmPerDay: number;
  stealth: number;
  armor: number;
  hiddenCompartmentKg: number;
  reliability: number;
  upgradeSlots: number;
  requiredSkill: string | null;
  skillMet: boolean;
  affordable: boolean;
  description: string;
}

export default function LogisticsPage() {
  const [tab, setTab] = useState<Tab>('shipments');
  const logistics = useView<LogisticsView>('logistics');
  const view = logistics.data?.view;
  const hasFleet = (view?.vehicles.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Freight</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">Logistics</h1>
          <p className="mt-1 text-xs text-ink-dim">
            {view
              ? `${view.inTransit} in transit · ${view.delivered} delivered · ${view.seized} seized · ${money(view.valueInTransit)} on the road`
              : 'Reading the freight desk…'}
          </p>
        </div>
        <Tabs
          label="Logistics sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'shipments', label: 'Shipments', count: view?.shipments.length },
            { id: 'vehicles', label: 'Vehicles', count: view?.vehicles.length },
            { id: 'storage', label: 'Storage', count: view?.storage.length },
            { id: 'dispatch', label: 'Dispatch freight' },
          ]}
        />
      </header>

      {view && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Freight spend" value={money(view.freightSpend)} sub={`warehouse rent ${money(view.warehouseRentPerDay)}/day`} />
          <Tile label="Delivered value" value={money(view.deliveredValue)} sub={`${view.delivered} shipments`} tone="up" />
          <Tile label="Value in transit" value={money(view.valueInTransit)} sub={`${view.inTransit} moving`} tone="gold" />
          <Tile label="Seized value" value={money(view.seizedValue)} sub={`${view.seized} seized · ${view.lost} lost`} tone={view.seizedValue > 0 ? 'down' : undefined} />
        </div>
      )}

      {tab === 'shipments' && <Shipments />}
      {tab === 'vehicles' && <Vehicles />}
      {tab === 'storage' && <Storages />}
      {tab === 'dispatch' && (hasFleet ? <Dispatch /> : <NoVehicleFirst />)}
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

function Shipments() {
  const shipments = useView<LogisticsView>('logistics');
  return (
    <ViewPanel<LogisticsView>
      view="logistics"
      title="Shipments"
      subtitle="Cargo the server is tracking between locations"
      isEmpty={(data) => data.view.shipments.length === 0}
      emptyTitle="Nothing is in transit"
      emptyBody="Dispatch freight from the Dispatch tab: choose a destination, a mode and the goods to load."
    >
      {() => (
        <div className="space-y-3">
          {shipments.data?.view.shipments.map((shipment) => {
            const moving = shipment.status === 'in_transit' || shipment.status === 'delayed';
            return (
              <article key={shipment.id} className="rounded border border-line bg-panel-2/40 px-3 py-2">
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-medium text-ink">
                      {shipment.origin} → {shipment.destination}
                    </h3>
                    <p className="text-[11px] text-ink-faint">
                      {humanise(shipment.mode)} · tracking <span className="tnum">{shipment.trackingCode}</span> · id {shortId(shipment.id)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone={shipment.status === 'delivered' ? 'up' : shipment.status === 'seized' || shipment.status === 'lost' ? 'down' : shipment.status === 'delayed' ? 'warn' : 'info'}>
                      {humanise(shipment.status)}
                    </Badge>
                    {shipment.insured && <Badge tone="info">insured</Badge>}
                    {shipment.concealed && <Badge tone="violet">concealed</Badge>}
                    {shipment.underDeclared && <Badge tone="warn">under-declared</Badge>}
                  </div>
                </header>
                {moving && <Progress value={shipment.progress} label={`${shipment.daysRemaining} day(s) remaining`} />}
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
                  <KeyValue label="Departed">{`day ${shipment.departedDay}`}</KeyValue>
                  <KeyValue label="Arrives">{`day ${shipment.arrivesDay}`}</KeyValue>
                  <KeyValue label="Declared value">{money(shipment.declaredValue)}</KeyValue>
                  <KeyValue label="Actual value">{money(shipment.actualValue)}</KeyValue>
                  <KeyValue label="Vehicle">{shipment.vehicle ?? '—'}</KeyValue>
                  <KeyValue label="Crew">{shipment.crew.length > 0 ? shipment.crew.join(', ') : '—'}</KeyValue>
                  {shipment.delayReason && <KeyValue label="Delay" tone="text-warn">{shipment.delayReason}</KeyValue>}
                </dl>
                <ul className="mt-2 flex flex-wrap gap-1">
                  {shipment.items.map((item) => (
                    <li key={item.commodityId} className="rounded border border-line px-2 py-0.5 text-[11px] text-ink-dim">
                      {item.name} × {num(item.qty)} · {money(item.value)}
                      {item.illegal && <span className="ml-1 text-down">illegal</span>}
                    </li>
                  ))}
                </ul>
                {moving && shipment.underDeclared && (
                  <InlineNote tone="warn">Customs will compare the declared {money(shipment.declaredValue)} against what they find. Under-declaring raises the penalty if it is inspected.</InlineNote>
                )}
              </article>
            );
          })}
          <RivalTraffic rival={shipments.data?.rival ?? null} />
        </div>
      )}
    </ViewPanel>
  );
}

/**
 * Cargo rival firms have on the road right now.
 *
 * The simulation's own trade network lands these units in these markets on these
 * days, so what a player reads here is what the economy will do — not a sampled or
 * illustrative feed. What is *not* here is a rival's working capital or profit: those
 * are server-side, and a shipper could not observe them.
 */
function RivalTraffic({ rival }: { rival: RivalTradeView | null }) {
  if (!rival || rival.flows.length === 0) {
    return (
      <Panel title="Rival cargo" subtitle="Freight competitors have moving between markets" bodyClassName="px-4 py-3">
        <EmptyState title="No rival cargo in transit" body="Independent firms dispatch when a route clears their margin after freight and risk. Nothing is on the road today." />
      </Panel>
    );
  }
  return (
    <Panel title="Rival cargo" subtitle="Freight competitors have moving between markets — the units they are bringing in are supply the market will receive" bodyClassName="px-4 py-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        <KeyValue label="Firms trading">{`${rival.activeAgents} of ${rival.agents}`}</KeyValue>
        <KeyValue label="Cargo in transit">{num(rival.inTransit)}</KeyValue>
        <KeyValue label="Dispatched (30d)">{num(rival.dispatchedLast30Days)}</KeyValue>
        <KeyValue label="Landed (30d)">{num(rival.landedLast30Days)}</KeyValue>
      </dl>
      <div className="mt-3 overflow-x-auto">
        <Table label="Rival cargo in transit">
          <thead>
            <tr>
              <Th>Firm</Th>
              <Th>Goods</Th>
              <Th>Lane</Th>
              <Th align="right">Qty</Th>
              <Th align="right">Lands</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rival.flows.map((flow) => (
              <Tr key={flow.id}>
                <Td>{flow.agentName}</Td>
                <Td>{flow.commodityName}</Td>
                <Td>{`${flow.fromName} → ${flow.toName}`}</Td>
                <Td align="right" className="tnum">{num(flow.qty)}</Td>
                <Td align="right" className="tnum">{flow.daysRemaining === 0 ? 'today' : `day ${flow.arrivesDay}`}</Td>
                <Td>
                  {flow.risk >= 0.5 ? <Badge tone="warn">{`risk ${pct(flow.risk, { decimals: 0 })}`}</Badge> : <Badge tone="info">in transit</Badge>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      <InlineNote>Arrivals add units to the destination market, which presses its price down — the same impact rule your own sales follow.</InlineNote>
    </Panel>
  );
}

function Vehicles() {
  const logistics = useView<LogisticsView>('logistics');
  const view = logistics.data?.view;
  const listings = (logistics.data?.listings ?? []) as VehicleListingRow[];
  const [showCatalogue, setShowCatalogue] = useState(false);
  const [openVehicle, setOpenVehicle] = useState<string | null>(null);
  const vehicles = (view?.vehicles ?? []) as unknown as VehicleView[];

  return (
    <div className="space-y-3">
      <ViewPanel<LogisticsView>
        view="logistics"
        title="Your vehicles"
        subtitle="Capacity, condition and the freight they can carry"
        isEmpty={(data) => (data.view.vehicles as unknown[]).length === 0}
        emptyTitle="You own no vehicles"
        emptyBody="Walking is free and slow. Any motorised mode needs a vehicle of its own; goods can only travel by vehicle."
        actions={
          <Button size="sm" variant={showCatalogue ? 'primary' : 'secondary'} onClick={() => setShowCatalogue(!showCatalogue)} aria-pressed={showCatalogue}>
            {showCatalogue ? 'Hide dealership' : 'Buy a vehicle'}
          </Button>
        }
      >
        {() => (
          <ul className="space-y-2">
            {vehicles.map((vehicle) => (
              <li key={vehicle.id} className="rounded border border-line bg-panel-2/40 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-medium text-ink">{vehicle.name}</h3>
                    <p className="text-[11px] text-ink-faint">
                      {humanise(vehicle.kind)} · {vehicle.locationName} {vehicle.here ? '(here)' : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {vehicle.inTransit && <Badge tone="info">in transit</Badge>}
                    {!vehicle.here && !vehicle.inTransit && <Badge tone="neutral">elsewhere</Badge>}
                    {vehicle.damage > 0 && <Badge tone="warn">{pct(vehicle.damage, { from: 'fraction', decimals: 0 })} damage</Badge>}
                    <Button size="sm" variant="ghost" onClick={() => setOpenVehicle(openVehicle === vehicle.id ? null : vehicle.id)} aria-expanded={openVehicle === vehicle.id}>
                      Manage
                    </Button>
                  </div>
                </div>
                <div className="mt-2 space-y-1.5">
                  <Meter value={vehicle.condition} label="Condition" display={pct(vehicle.condition, { from: 'fraction', decimals: 0 })} tone={vehicle.condition < 0.4 ? 'down' : vehicle.condition < 0.7 ? 'warn' : 'up'} />
                  <Meter value={vehicle.fuel} label="Fuel" display={pct(vehicle.fuel, { from: 'fraction', decimals: 0 })} tone={vehicle.fuel < 0.2 ? 'down' : 'gold'} />
                  <Meter value={vehicle.capacityKg > 0 ? vehicle.usedKg / vehicle.capacityKg : 0} label="Load" display={`${mass(vehicle.usedKg)} / ${mass(vehicle.capacityKg)}`} tone="info" />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
                  <KeyValue label="Value">{money(vehicle.value)}</KeyValue>
                  <KeyValue label="Service cost">{money(vehicle.serviceCost)}</KeyValue>
                  <KeyValue label="Stealth">{pct(vehicle.stealth, { from: 'fraction', decimals: 0 })}</KeyValue>
                  <KeyValue label="Armour">{pct(vehicle.armor, { from: 'fraction', decimals: 0 })}</KeyValue>
                  <KeyValue label="Upgrade slots">{vehicle.freeUpgradeSlots} free</KeyValue>
                  {vehicle.odometerKm !== undefined && <KeyValue label="Odometer">{num(vehicle.odometerKm)} km</KeyValue>}
                  <KeyValue label="Fitted">{vehicle.upgrades.map((upgrade) => upgrade.name).join(', ') || '—'}</KeyValue>
                </dl>
                {openVehicle === vehicle.id && <VehicleActions vehicle={vehicle} />}
              </li>
            ))}
          </ul>
        )}
      </ViewPanel>

      {showCatalogue && (
        <Panel title="Dealership" subtitle="Vehicles available for sale at this location" bodyClassName="px-4 py-2">
          <Table label="Vehicle catalogue">
            <thead>
              <tr>
                <Th>Vehicle</Th>
                <Th align="right">Price</Th>
                <Th align="right">Capacity</Th>
                <Th align="right">Speed</Th>
                <Th align="right">Stealth</Th>
                <Th align="right">Armour</Th>
                <Th align="right">Compartment</Th>
                <Th>Requirement</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {listings.length === 0 && (
                <Tr>
                  <Td className="text-xs text-ink-faint" colSpan={9}>
                    No vehicles are offered here. Dealerships appear in industrial and port locations.
                  </Td>
                </Tr>
              )}
              {listings.map((listing) => (
                <Tr key={listing.defId}>
                  <Td>
                    <span className="text-sm text-ink">{listing.name}</span>
                    <span className="block text-[11px] text-ink-faint">
                      {humanise(listing.kind)} · {listing.description}
                    </span>
                  </Td>
                  <Td align="right" className="tnum">{money(listing.price)}</Td>
                  <Td align="right" className="tnum text-xs">
                    {mass(listing.capacityKg)} / {volume(listing.capacityL)}
                  </Td>
                  <Td align="right" className="tnum text-xs">{num(listing.speedKmPerDay)} km/day</Td>
                  <Td align="right" className="tnum text-xs">{pct(listing.stealth, { from: 'fraction', decimals: 0 })}</Td>
                  <Td align="right" className="tnum text-xs">{pct(listing.armor, { from: 'fraction', decimals: 0 })}</Td>
                  <Td align="right" className="tnum text-xs">{listing.hiddenCompartmentKg > 0 ? mass(listing.hiddenCompartmentKg) : '—'}</Td>
                  <Td className="text-[11px] text-ink-faint">
                    {listing.requiredSkill ? (
                      <span className={listing.skillMet ? 'text-up' : 'text-down'}>
                        {humanise(listing.requiredSkill)} {listing.skillMet ? 'met' : 'not met'}
                      </span>
                    ) : (
                      'none'
                    )}
                  </Td>
                  <Td align="right">
                    <CommandButton
                      intent={{ type: 'logistics.buy_vehicle', defId: listing.defId }}
                      label="Buy"
                      size="sm"
                      variant={listing.affordable && listing.skillMet ? 'success' : 'secondary'}
                      disabled={!listing.affordable || !listing.skillMet}
                      disabledReason={!listing.skillMet ? `Requires ${humanise(listing.requiredSkill ?? '')} skill.` : 'You cannot afford this vehicle.'}
                      confirm={{ title: `Buy the ${listing.name}?`, body: `${money(listing.price)} leaves your accounts immediately.`, confirmLabel: 'Buy vehicle' }}
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </div>
  );
}

function VehicleActions({ vehicle }: { vehicle: VehicleView }) {
  const options = vehicle.upgradeOptions ?? [];
  const fitted = vehicle.upgrades.map((upgrade) => upgrade.id);
  const available = options.filter((option) => !option.installed);
  return (
    <div className="mt-2 grid gap-3 border-t border-line pt-2 lg:grid-cols-3">
      <div className="space-y-2">
        <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Service &amp; repair</h4>
        <p className="text-xs text-ink-dim">Restores condition and clears damage. Wear accrues every kilometre the vehicle is used.</p>
        <CommandButton intent={{ type: 'logistics.service_vehicle', vehicleId: vehicle.id }} label={`Service for ${money(vehicle.serviceCost)}`} variant="secondary" />
      </div>
      <div className="space-y-2">
        <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Fitted upgrades</h4>
        {fitted.length === 0 ? (
          <p className="text-xs text-ink-faint">Nothing fitted. {vehicle.freeUpgradeSlots} slot(s) free.</p>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {vehicle.upgrades.map((upgrade) => (
              <li key={upgrade.id}>
                <Badge tone="info">{upgrade.name}</Badge>
              </li>
            ))}
          </ul>
        )}
        <h4 className="mt-2 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Available</h4>
        {available.length === 0 ? (
          <p className="text-xs text-ink-faint">Every upgrade for this chassis is already installed.</p>
        ) : (
          <ul className="space-y-1">
            {available.slice(0, 4).map((option) => (
              <li key={option.id} className="flex items-start justify-between gap-2">
                <span className="text-xs">
                  <span className="text-ink-dim">{option.name}</span>
                  <span className="block text-[11px] text-ink-faint">{option.description}</span>
                </span>
                <CommandButton
                  intent={{ type: 'logistics.upgrade_vehicle', vehicleId: vehicle.id, upgradeId: option.id }}
                  label={money(option.price)}
                  size="sm"
                  variant="secondary"
                  disabled={!option.affordable || vehicle.freeUpgradeSlots <= 0}
                  disabledReason={vehicle.freeUpgradeSlots <= 0 ? 'No free upgrade slots on this vehicle.' : 'You cannot afford this upgrade.'}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-2">
        <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Dispose</h4>
        <p className="text-xs text-ink-dim">Selling is at depreciated market value and cannot be undone.</p>
        <CommandButton
          intent={{ type: 'logistics.sell_vehicle', vehicleId: vehicle.id }}
          label="Sell vehicle"
          variant="danger"
          confirm={{ title: `Sell the ${vehicle.name}?`, body: 'It leaves your fleet immediately at its current depreciated value. Cargo inside would need to be unloaded first.', confirmLabel: 'Sell', destructive: true }}
        />
      </div>
    </div>
  );
}

function Storages() {
  return (
    <ViewPanel<LogisticsView>
      view="logistics"
      title="Storage units"
      subtitle="Every place goods physically sit, and how full it is"
      isEmpty={(data) => data.view.storage.length === 0}
      emptyTitle="No storage"
      emptyBody="Warehouses, property vaults and vehicle holds appear here."
    >
      {(data) => (
        <Table label="Storage units">
          <thead>
            <tr>
              <Th>Storage</Th>
              <Th>Location</Th>
              <Th align="right">Weight</Th>
              <Th align="right">Volume</Th>
              <Th align="right">Stacks</Th>
              <Th align="right">Value</Th>
              <Th align="right">Security</Th>
              <Th align="right">Cost / day</Th>
              <Th align="right">Flags</Th>
            </tr>
          </thead>
          <tbody>
            {data.view.storage.map((storage) => (
              <Tr key={storage.id}>
                <Td>
                  <span className="text-sm text-ink">{storage.name}</span>
                  <span className="block text-[11px] text-ink-faint">{humanise(storage.kind)}</span>
                </Td>
                <Td className="text-xs text-ink-dim">
                  {storage.locationName} {storage.here ? <Badge tone="info">here</Badge> : null}
                </Td>
                <Td align="right" className="tnum text-xs">
                  {mass(storage.usedKg)} / {mass(storage.capacityKg)}
                </Td>
                <Td align="right" className="tnum text-xs">
                  {volume(storage.usedL)} / {volume(storage.capacityL)}
                </Td>
                <Td align="right" className="tnum text-xs">{storage.stacks}</Td>
                <Td align="right" className="tnum">{money(storage.value)}</Td>
                <Td align="right" className="tnum text-xs">{pct(storage.security, { from: 'fraction', decimals: 0 })}</Td>
                <Td align="right" className="tnum text-xs">{money(storage.costPerDay)}</Td>
                <Td align="right" className="text-[11px]">
                  {storage.insured && <Badge tone="info">insured</Badge>}
                  {storage.refrigerated && <Badge tone="info">cold</Badge>}
                  {storage.hiddenCompartmentKg > 0 && <Badge tone="violet">{mass(storage.hiddenCompartmentKg)} hidden</Badge>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </ViewPanel>
  );
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

function NoVehicleFirst() {
  return (
    <Panel title="Dispatch freight">
      <EmptyState
        title="You need a vehicle first"
        body="Shipments move by vehicle — the vehicle's capacity is what limits the cargo, and its stealth and armour decide how the route goes. Buy one from the dealership on the Vehicles tab."
      />
    </Panel>
  );
}

function Dispatch() {
  const { gameId } = useGame();
  const destinations = useView<DestinationsView>('destinations');
  const inventory = useView<InventoryView>('inventory');
  const logistics = useView<LogisticsView>('logistics');

  const [destinationId, setDestinationId] = useState('');
  const [mode, setMode] = useState('');
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [insured, setInsured] = useState(true);
  const [concealed, setConcealed] = useState(false);
  const [vehicleId, setVehicleId] = useState('');
  const [declared, setDeclared] = useState('');
  const [plan, setPlan] = useState<TravelPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);

  const view = logistics.data?.view;
  const vehicles = ((view?.vehicles ?? []) as unknown as VehicleView[]).filter((vehicle) => vehicle.here && !vehicle.inTransit);
  const rows = (inventory.data?.rows ?? []).filter((row) => row.atCurrentLocation && !row.concealed);
  const modes = destinations.data?.modes ?? [];
  const chosenMode = mode || modes.find((item) => item.ok)?.mode || modes[0]?.mode || '';

  const items = useMemo(
    () =>
      Object.entries(picked)
        .filter(([, qty]) => qty > 0)
        .map(([commodityId, qty]) => ({ commodityId, qty })),
    [picked],
  );

  const selectedValue = rows.reduce((sum, row) => sum + (picked[row.commodityId] ?? 0) * (row.qty > 0 ? row.marketValue / row.qty : 0), 0);
  const selectedMass = rows.reduce((sum, row) => sum + (picked[row.commodityId] ?? 0) * (row.qty > 0 ? row.weightKg / row.qty : 0), 0);

  const requestPlan = async () => {
    if (!destinationId || items.length === 0) return;
    setPlanning(true);
    setPlanError(null);
    try {
      const response = await api.intent(gameId, {
        type: 'logistics.plan_shipment',
        destinationId,
        mode: chosenMode,
        items,
        ...(insured ? { insured: true } : {}),
        ...(concealed ? { concealed: true } : {}),
        ...(vehicleId ? { vehicleId } : {}),
        ...(declared.trim() && Number.isFinite(Number(declared)) ? { declaredValue: Number(declared) } : {}),
      });
      const payload = response.data as TravelPlan | null | undefined;
      setPlan(payload ?? null);
      if (!payload) setPlanError('The server could not build a shipment plan for those choices.');
    } catch (error) {
      setPlan(null);
      setPlanError(error instanceof Error ? error.message : 'Could not price that shipment.');
    } finally {
      setPlanning(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Panel title="Load a shipment" subtitle="Pick a destination, the mode, then the cargo — the server prices it before anything moves" bodyClassName="px-4 py-2">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">
            <span className="mb-1 block text-ink-dim">Destination</span>
            <Select value={destinationId} onChange={(event) => setDestinationId(event.target.value)}>
              <option value="">Choose a destination…</option>
              {(destinations.data?.destinations ?? [])
                .filter((item) => item.reachable)
                .map((item) => (
                  <option key={item.locationId} value={item.locationId}>
                    {item.name} — {item.days}d, {money(item.cost)}
                  </option>
                ))}
            </Select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-ink-dim">Mode</span>
            <Select value={chosenMode} onChange={(event) => setMode(event.target.value)}>
              {modes.map((item) => (
                <option key={item.mode} value={item.mode} disabled={!item.ok}>
                  {item.label} {item.ok ? '' : `— ${item.reason ?? 'unavailable'}`}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-ink-dim">Vehicle</span>
            <Select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
              <option value="">Not assigned</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.name} — {mass(vehicle.capacityKg - vehicle.usedKg)} free
                </option>
              ))}
            </Select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-ink-dim">Declared customs value (optional)</span>
            <Input inputMode="decimal" placeholder="Leave blank to declare the true value" value={declared} onChange={(event) => setDeclared(event.target.value)} />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-4">
          <Checkbox label="Insure the cargo" checked={insured} onChange={setInsured} />
          <Checkbox label="Conceal in a compartment" hint="Lower inspection exposure, heavier penalty if found." checked={concealed} onChange={setConcealed} />
        </div>

        <h3 className="mt-4 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Cargo at this location</h3>
        {rows.length === 0 ? (
          <EmptyState title="Nothing to load here" body="Cargo must physically be at your current location to be shipped. Buy goods on the market or move them here first." />
        ) : (
          <Table label="Cargo selection">
            <thead>
              <tr>
                <Th>Good</Th>
                <Th align="right">Held</Th>
                <Th align="right">Unit value</Th>
                <Th align="right">To load</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.stackId}>
                  <Td>
                    <span className="text-sm text-ink">{row.name}</span>
                    <span className="block text-[11px] text-ink-faint">{row.storageName}</span>
                  </Td>
                  <Td align="right" className="tnum text-xs">{num(row.qty)}</Td>
                  <Td align="right" className="tnum text-xs">{money(row.qty > 0 ? row.marketValue / row.qty : 0)}</Td>
                  <Td align="right">
                    <QuantityPicker
                      id={`load-${row.stackId}`}
                      label="Load"
                      unit={row.unit}
                      max={row.qty}
                      value={picked[row.commodityId] ?? 0}
                      onChange={(next) => setPicked({ ...picked, [row.commodityId]: Math.min(row.qty, next) })}
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}

        {items.length > 0 && (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
            <KeyValue label="Goods selected">{items.length}</KeyValue>
            <KeyValue label="Selected value">{money(selectedValue)}</KeyValue>
            <KeyValue label="Selected weight">{mass(selectedMass)}</KeyValue>
          </dl>
        )}
      </Panel>

      <aside className="space-y-3">
        <Panel title="Shipment plan" tone={planError ? 'warn' : 'default'}>
          <p className="text-xs text-ink-dim">The server builds the same route plan as travel — legs, cost, customs exposure and what is at risk — for freight rather than a passenger.</p>
          <div className="mt-2">
            <Button variant="secondary" onClick={() => void requestPlan()} loading={planning} disabled={!destinationId || items.length === 0}>
              Price this shipment
            </Button>
          </div>
          {planError && <InlineNote tone="warn">{planError}</InlineNote>}
          {plan && (
            <dl className="mt-3 space-y-0.5">
              <KeyValue label="Route">{`${plan.fromName} → ${plan.toName}`}</KeyValue>
              <KeyValue label="Days">{plan.days}</KeyValue>
              <KeyValue label="Total cost">{money(plan.totalCost)}</KeyValue>
              <KeyValue label="Border crossings">{plan.borderCrossings}</KeyValue>
              <KeyValue label="Detection per border">{pct(plan.detectionChancePerBorder, { from: 'fraction', decimals: 1 })}</KeyValue>
              <KeyValue label="Contraband units">{num(plan.contrabandUnits)}</KeyValue>
              <KeyValue label="Value at risk" tone={plan.seizureValueAtRisk > 0 ? 'text-warn' : undefined}>
                {money(plan.seizureValueAtRisk)}
              </KeyValue>
              <KeyValue label="Encounter chance">{pct(plan.encounterChancePerLeg, { from: 'fraction', decimals: 1 })}</KeyValue>
            </dl>
          )}
          {plan && plan.warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {plan.warnings.map((warning) => (
                <li key={warning}>
                  <InlineNote tone="warn">{warning}</InlineNote>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Dispatch">
          <p className="text-xs text-ink-dim">Sending is a commitment: freight is paid now, customs decides later, and the cargo is not yours to trade until it arrives.</p>
          <div className="mt-2 space-y-2">
            <CommandButton
              intent={{
                type: 'logistics.send_shipment',
                destinationId,
                mode: chosenMode,
                items,
                ...(insured ? { insured: true } : {}),
                ...(concealed ? { concealed: true } : {}),
                ...(vehicleId ? { vehicleId } : {}),
                ...(declared.trim() && Number.isFinite(Number(declared)) ? { declaredValue: Number(declared) } : {}),
              }}
              label="Dispatch shipment"
              variant="primary"
              size="lg"
              disabled={!destinationId || items.length === 0}
              disabledReason={!destinationId ? 'Choose a destination.' : 'Load at least one good.'}
              confirm={{
                title: 'Dispatch this shipment?',
                body: (
                  <>
                    {items.length} good{items.length === 1 ? '' : 's'} worth {money(selectedValue)} travelling {plan ? `${plan.days} day(s)` : 'by freight'} to{' '}
                    {destinations.data?.destinations.find((item) => item.locationId === destinationId)?.name ?? destinationId}
                    {plan && plan.totalCost > 0 ? ` for ${money(plan.totalCost)}` : ''}
                    {concealed ? ', concealed in a compartment' : ''}.
                  </>
                ),
                confirmLabel: 'Dispatch',
              }}
            />
            <p className="text-[11px] text-ink-faint">Insurance pays out only if the loss is covered — read the plan&apos;s warnings before sending contraband.</p>
          </div>
        </Panel>
      </aside>
    </div>
  );
}
