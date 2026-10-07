'use client';

/**
 * Inventory and storage.
 *
 * The stacking reality matters here: buying the same good twice creates a second stack, so
 * the table keeps each physical stack addressable (move, conceal) while the headline
 * numbers aggregate over what is actually visible. Every value — market value, cost basis,
 * P&L, free space — comes from the server's inventory read model.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { gameHref } from '../../../../components/game/nav';
import { useGame, useView } from '../../../../lib/game-context';
import { ViewPanel, CommandButton, QuantityPicker } from '../../../../components/game/view-panel';
import { Badge, Button, Delta, Input, KeyValue, Meter, Panel, Select, Table, Td, Th, Tr } from '../../../../components/ui/primitives';
import { EmptyState } from '../../../../components/ui/states';
import { days, humanise, mass, money, num, pct, volume } from '../../../../lib/format';
import type { InventoryRow, InventoryView, StorageUsage } from '../../../../lib/game-data';

export default function InventoryPage() {
  const { gameId, meta } = useGame();
  const inventory = useView<InventoryView>('inventory');
  const [query, setQuery] = useState('');
  const [storageFilter, setStorageFilter] = useState('');
  const [openStack, setOpenStack] = useState<string | null>(null);
  const [onlyAtCurrent, setOnlyAtCurrent] = useState(false);

  const rows = inventory.data?.rows ?? [];
  const storages = inventory.data?.storages ?? [];

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (storageFilter && row.storageId !== storageFilter) return false;
      if (onlyAtCurrent && !row.atCurrentLocation) return false;
      if (!needle) return true;
      return row.name.toLowerCase().includes(needle) || row.commodityId.toLowerCase().includes(needle) || row.category.toLowerCase().includes(needle);
    });
  }, [onlyAtCurrent, query, rows, storageFilter]);

  const view = inventory.data;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Holdings</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">Inventory &amp; storage</h1>
          <p className="mt-1 text-xs text-ink-dim">
            {view ? (
              <>
                {view.stacks} stacks across {storages.length} storage units · {mass(view.totalWeightKg)} · {volume(view.totalVolumeL)}
              </>
            ) : (
              'Reading your holdings…'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Filter holdings" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Filter holdings" />
          <Select aria-label="Filter by storage" value={storageFilter} onChange={(event) => setStorageFilter(event.target.value)}>
            <option value="">All storage</option>
            {storages.map((item) => (
              <option key={item.storage.id} value={item.storage.id}>
                {item.storage.name}
              </option>
            ))}
          </Select>
        </div>
      </header>

      {view && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Market value" value={money(view.totalMarketValue)} sub={`cost basis ${money(view.totalCostBasis)}`} />
          <StatTile
            label="Unrealised P&L"
            value={`${view.totalUnrealisedPnl >= 0 ? '+' : ''}${money(view.totalUnrealisedPnl)}`}
            sub={`${pct(view.totalCostBasis > 0 ? view.totalUnrealisedPnl / view.totalCostBasis : 0, { from: 'fraction', sign: true })} on cost`}
            tone={view.totalUnrealisedPnl >= 0 ? 'up' : 'down'}
          />
          <StatTile label="Units held" value={num(view.totalQty)} sub={`${view.stacks} stacks`} />
          <StatTile
            label="Concealed"
            value={`${num(view.storages.reduce((sum, item) => sum + item.usage.hiddenKg, 0))} kg`}
            sub={view.storages.some((item) => item.usage.hiddenKg > 0) ? 'in hidden compartments' : 'nothing hidden'}
            tone={view.storages.some((item) => item.usage.hiddenKg > 0) ? 'warn' : undefined}
          />
        </div>
      )}

      <section className="grid gap-3 lg:grid-cols-2" aria-label="Storage units">
        {storages.map((item) => (
          <StorageCard key={item.storage.id} item={item} />
        ))}
      </section>

      <ViewPanel<InventoryView>
        view="inventory"
        dense
        isEmpty={(data) => data.rows.length === 0}
        emptyTitle="You own nothing yet"
        emptyBody={
          <>
            Buy goods on the market and they appear here, stack by stack, with the storage they occupy.{' '}
            <Link className="text-gold hover:underline" href={gameHref(gameId, 'market')}>
              Open the trading desk
            </Link>
            .
          </>
        }
        title="Commodity stacks"
        subtitle={visible.length === rows.length ? `${rows.length} stacks` : `${visible.length} of ${rows.length} stacks shown`}
        actions={
          <Button size="sm" variant={onlyAtCurrent ? 'primary' : 'secondary'} onClick={() => setOnlyAtCurrent(!onlyAtCurrent)} aria-pressed={onlyAtCurrent}>
            Only goods here
          </Button>
        }
      >
        {() => (
          <>
            <Table label="Commodity stacks">
              <thead>
                <tr>
                  <Th>Good</Th>
                  <Th>Storage</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Avg cost</Th>
                  <Th align="right">Value</Th>
                  <Th align="right">P&amp;L</Th>
                  <Th align="right">Weight / vol</Th>
                  <Th align="right">Age</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <Tr>
                    <Td className="text-xs text-ink-faint" colSpan={9}>
                      No stacks match those filters. {rows.length} stacks are hidden by the current filter.
                    </Td>
                  </Tr>
                )}
                {visible.map((row) => (
                  <Tr key={row.stackId} highlight={openStack === row.stackId}>
                    <Td>
                      <span className="flex flex-wrap items-center gap-1">
                        <span className="text-sm text-ink">{row.name}</span>
                        {row.concealed && <Badge tone="violet">concealed</Badge>}
                        {row.legality !== 'legal' && <Badge tone={row.legality === 'contraband' ? 'down' : 'warn'}>{row.legality}</Badge>}
                        {row.daysUntilExpiry !== null && row.daysUntilExpiry <= 3 && <Badge tone="down">{row.daysUntilExpiry}d to expiry</Badge>}
                        {row.quality < 1 && <Badge tone="neutral">{pct(row.quality, { from: 'fraction', decimals: 0 })} quality</Badge>}
                        {!row.atCurrentLocation && <Badge tone="neutral">elsewhere</Badge>}
                      </span>
                      <span className="text-[11px] text-ink-faint">{humanise(row.category)}</span>
                    </Td>
                    <Td className="text-xs text-ink-dim">
                      {row.storageName}
                      <span className="block text-[11px] text-ink-faint">{humanise(row.storageKind)}</span>
                    </Td>
                    <Td align="right" className="tnum">{num(row.qty)}</Td>
                    <Td align="right" className="tnum text-ink-dim">{money(row.avgCost)}</Td>
                    <Td align="right" className="tnum">{money(row.marketValue)}</Td>
                    <Td align="right">
                      <Delta value={row.unrealisedPnl} format={(n) => money(n)} />
                      <span className="tnum block text-[11px] text-ink-faint">{pct(row.pnlFraction, { from: 'fraction', sign: true, decimals: 1 })}</span>
                    </Td>
                    <Td align="right" className="tnum text-xs text-ink-faint">
                      {mass(row.weightKg)} / {volume(row.volumeL)}
                    </Td>
                    <Td align="right" className="tnum text-xs text-ink-faint">{row.expiresDay === null ? '—' : row.daysUntilExpiry !== null && row.daysUntilExpiry > 0 ? `expires in ${days(row.daysUntilExpiry)}` : 'expiring'}</Td>
                    <Td align="right">
                      <Button size="sm" variant="ghost" onClick={() => setOpenStack(openStack === row.stackId ? null : row.stackId)} aria-expanded={openStack === row.stackId}>
                        Manage
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {openStack && <StackActions stackId={openStack} onClose={() => setOpenStack(null)} />}
            <p className="mt-3 text-[11px] text-ink-faint">
              Version <span className="tnum">{meta?.version ?? 0}</span> · storage, weight and value are recomputed by the server after every trade and shipment.
            </p>
          </>
        )}
      </ViewPanel>
    </div>
  );
}

function StatTile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'up' | 'down' | 'warn' }) {
  return (
    <div className="rounded-panel border border-line bg-panel px-3 py-2.5">
      <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">{label}</p>
      <p className={`tnum mt-0.5 text-lg font-semibold ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : tone === 'warn' ? 'text-warn' : 'text-ink'}`}>{value}</p>
      <p className="text-[11px] text-ink-faint">{sub}</p>
    </div>
  );
}

function StorageCard({ item }: { item: StorageUsage }) {
  const { storage, usage, value } = item;
  const tight = usage.kgUtilisation > 0.95 || usage.litresUtilisation > 0.95;
  return (
    <Panel
      title={storage.name}
      subtitle={`${humanise(storage.kind)} · security ${pct(storage.security, { from: 'fraction', decimals: 0 })}`}
      actions={
        <>
          {storage.insured && <Badge tone="info">insured</Badge>}
          <Badge tone={tight ? 'down' : usage.kgUtilisation > 0.8 ? 'warn' : 'up'}>{tight ? 'full' : 'space free'}</Badge>
        </>
      }
    >
      <div className="space-y-2">
        <Meter
          value={usage.kgUtilisation}
          label="Weight"
          display={`${num(usage.kg)} / ${num(usage.kgCapacity)} kg`}
          tone={usage.kgUtilisation > 0.95 ? 'down' : usage.kgUtilisation > 0.8 ? 'warn' : 'gold'}
        />
        <Meter
          value={usage.litresUtilisation}
          label="Volume"
          display={`${num(usage.litres)} / ${num(usage.litresCapacity)} L`}
          tone={usage.litresUtilisation > 0.95 ? 'down' : usage.litresUtilisation > 0.8 ? 'warn' : 'gold'}
        />
        <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          <KeyValue label="Goods value">{money(value)}</KeyValue>
          <KeyValue label="Cost / day">{money(storage.costPerDay)}</KeyValue>
          <KeyValue label="Free space">
            {num(usage.kgFree)} kg / {num(usage.litresFree)} L
          </KeyValue>
          <KeyValue label="Binding limit">{humanise(usage.bindingConstraint)}</KeyValue>
          <KeyValue label="Concealment">
            {usage.hiddenKgCapacity > 0 ? `${num(usage.hiddenKg)} / ${num(usage.hiddenKgCapacity)} kg` : 'none'}
          </KeyValue>
          <KeyValue label="Refrigerated">{storage.refrigerated ? 'yes' : 'no'}</KeyValue>
        </dl>
        {tight && <p className="text-[11px] text-warn">This storage is at its {humanise(usage.bindingConstraint)} limit — new purchases may be refused.</p>}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Per-stack management                                                */
/* ------------------------------------------------------------------ */

function StackActions({ stackId, onClose }: { stackId: string; onClose: () => void }) {
  const { state } = useGame();
  const inventory = useView<InventoryView>('inventory');
  const [qty, setQty] = useState(1);
  const [toStorageId, setToStorageId] = useState('');

  const row: InventoryRow | undefined = inventory.data?.rows.find((item) => item.stackId === stackId);
  const storages = inventory.data?.storages ?? [];

  if (!row) {
    return (
      <Panel title="Manage stack" className="mt-3">
        <EmptyState title="That stack is gone" body="It may have been sold, moved or seized. Refresh the list to see current holdings." />
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={inventory.refetch}>
            Refresh holdings
          </Button>
        </div>
      </Panel>
    );
  }

  const elsewhere = storages.filter((item) => item.storage.id !== row.storageId);

  return (
    <Panel
      className="mt-3"
      title={`Manage ${row.name}`}
      subtitle={`${num(row.qty)} ${row.unit} in ${row.storageName}`}
      actions={
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Move to another storage</h3>
          <Select aria-label="Destination storage" value={toStorageId} onChange={(event) => setToStorageId(event.target.value)}>
            <option value="">Choose storage…</option>
            {elsewhere.map((item) => (
              <option key={item.storage.id} value={item.storage.id}>
                {item.storage.name} — {num(item.usage.kgFree)} kg free
              </option>
            ))}
          </Select>
          <QuantityPicker value={qty} onChange={setQty} max={row.qty} unit={row.unit} label="Quantity" id={`move-${row.stackId}`} />
          <CommandButton
            intent={{ type: 'inventory.move', stackId: row.stackId, qty, toStorageId }}
            label="Move goods"
            disabled={!toStorageId || qty <= 0 || qty > row.qty}
            disabledReason={!toStorageId ? 'Choose a destination storage.' : qty > row.qty ? 'The stack does not hold that many.' : 'Enter a quantity.'}
            onDone={(outcome) => {
              if (outcome.ok) setQty(1);
            }}
          />
        </div>

        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Concealment</h3>
          <p className="text-xs text-ink-dim">
            Concealed goods cross borders with less inspection exposure and are harder to seize, but they cannot be sold on the open market and the penalty is heavier if
            customs finds them.
          </p>
          <CommandButton
            intent={{ type: 'inventory.conceal', stackId: row.stackId, concealed: !row.concealed }}
            label={row.concealed ? 'Bring out of concealment' : 'Conceal this stack'}
            variant={row.concealed ? 'secondary' : 'primary'}
          />
          <p className="text-[11px] text-ink-faint">
            {row.concealed ? 'This stack is currently hidden in a compartment.' : 'This stack is in the open hold.'}
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Sell it here</h3>
          <p className="text-xs text-ink-dim">
            Orders are priced by the server on the trading desk: market depth, fees, tax and the price impact of your own size are all part of the quote.
          </p>
          <Link href={gameHref(gameFromState(state), 'market')}>
            <Button variant="secondary">Open the trading desk</Button>
          </Link>
          <p className="text-[11px] text-ink-faint">Shipments of goods between locations are planned in Logistics.</p>
        </div>
      </div>
    </Panel>
  );
}

/** The market screen only needs the game id, not the state; this keeps the link honest. */
function gameFromState(state: { meta: { gameId: string } } | null | undefined): string {
  return state?.meta.gameId ?? '';
}
