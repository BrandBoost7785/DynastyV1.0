'use client';

/**
 * Production.
 *
 * A line turns inputs into outputs on a daily cycle: it needs workers (or automation),
 * inputs in the buffer, a sound machine and a property it belongs to. The screen reads as
 * a supply-chain view — where the inputs come from, what is short, what each line earns —
 * because a margin the player cannot feed is not a margin.
 */
import { useMemo, useState } from 'react';
import { useView } from '../../../../lib/game-context';
import { ViewPanel, CommandButton, QuantityPicker } from '../../../../components/game/view-panel';
import { BarList } from '../../../../components/game/charts';
import { Badge, Button, Checkbox, Input, KeyValue, Meter, Panel, Progress, Select, Table, Tabs, Td, Th, Tr } from '../../../../components/ui/primitives';
import { EmptyState, InlineNote } from '../../../../components/ui/states';
import { humanise, mass, money, num, pct } from '../../../../lib/format';
import type { ProductionLine, ProductionView, PropertyOwned, RecipeListing } from '../../../../lib/game-data';

type Tab = 'lines' | 'supply' | 'install';

const STATUS_TONE: Record<ProductionLine['status'], 'up' | 'warn' | 'down' | 'neutral'> = {
  running: 'up',
  idle: 'neutral',
  starved: 'warn',
  broken: 'down',
  suspended: 'down',
};

export default function ProductionPage() {
  const [tab, setTab] = useState<Tab>('lines');
  const production = useView<ProductionView>('production');
  const supply = production.data?.supplyChain;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Manufacturing</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">Production</h1>
          <p className="mt-1 text-xs text-ink-dim">
            {supply
              ? `${supply.lines} line(s) · ${supply.running} running · ${supply.blocked} blocked · margin ${money(supply.marginPerDay, { sign: true })}/day`
              : 'Reading the plant…'}
          </p>
        </div>
        <Tabs
          label="Production sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'lines', label: 'Lines', count: production.data?.lines.length },
            { id: 'supply', label: 'Supply chain' },
            { id: 'install', label: 'Install a line', count: production.data?.recipes.length },
          ]}
        />
      </header>

      {supply && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Output value" value={money(supply.outputValuePerDay)} sub={`cost ${money(supply.costPerDay)}/day`} />
          <Tile label="Margin" value={money(supply.marginPerDay, { sign: true })} sub="per simulated day" tone={supply.marginPerDay >= 0 ? 'up' : 'down'} />
          <Tile label="Efficiency" value={pct(supply.averageEfficiency, { from: 'fraction', decimals: 0 })} sub={`quality ${pct(supply.averageQuality, { from: 'fraction', decimals: 0 })}`} tone="gold" />
          <Tile label="Produced / wasted" value={`${num(supply.totalProduced)} / ${num(supply.totalWaste)}`} sub="units since installation" />
        </div>
      )}

      {tab === 'lines' && <Lines />}
      {tab === 'supply' && <Supply />}
      {tab === 'install' && <Install />}
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

function Lines() {
  const production = useView<ProductionView>('production');
  return (
    <ViewPanel<ProductionView>
      view="production"
      title="Production lines"
      isEmpty={(data) => data.lines.length === 0}
      emptyTitle="No lines installed"
      emptyBody="Installing a line converts a property into a plant: it consumes inputs every day and produces outputs you can sell. Look at the recipes available here."
    >
      {() => (
        <ul className="space-y-3">
          {production.data?.lines.map((line) => (
            <LineCard key={line.id} line={line} />
          ))}
        </ul>
      )}
    </ViewPanel>
  );
}

function LineCard({ line }: { line: ProductionLine }) {
  const [open, setOpen] = useState(false);
  const [feedQty, setFeedQty] = useState(0);
  const [feedCommodity, setFeedCommodity] = useState(line.inputs[0]?.commodityId ?? '');

  const short = line.inputs.filter((input) => input.daysOfCover < 1);
  const labourShort = line.labourFactor < 1;

  return (
    <li className={`rounded-panel border ${line.status === 'broken' || line.status === 'suspended' ? 'border-down/40' : line.status === 'starved' ? 'border-warn/40' : 'border-line'} bg-panel px-4 py-3`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            {line.name}
            <Badge tone={STATUS_TONE[line.status]}>{humanise(line.status)}</Badge>
            {line.automated ? <Badge tone="info">automated level {line.automationLevel}</Badge> : <Badge tone="neutral">manual</Badge>}
          </h3>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            {line.propertyName} · {line.locationName} · recipe {humanise(line.recipeId)}
          </p>
        </div>
        <div className="text-right">
          <p className={`tnum text-lg font-semibold ${line.marginPerDay >= 0 ? 'text-up' : 'text-down'}`}>{money(line.marginPerDay, { sign: true })}</p>
          <p className="text-[11px] text-ink-faint">margin per day</p>
        </div>
      </div>

      <div className="mt-2 grid gap-3 lg:grid-cols-4">
        <dl className="space-y-0.5">
          <KeyValue label="Output value / day">{money(line.outputValuePerDay)}</KeyValue>
          <KeyValue label="Total cost / day">{money(line.totalCostPerDay)}</KeyValue>
          <KeyValue label="Energy / day">{money(line.energyCostPerDay)}</KeyValue>
          <KeyValue label="Opex / day">{money(line.opexPerDay)}</KeyValue>
          <KeyValue label="Produced">{num(line.producedTotal)}</KeyValue>
          <KeyValue label="Waste">{num(line.wasteTotal)}</KeyValue>
        </dl>
        <div className="space-y-2">
          <div>
            <p className="text-[11px] text-ink-faint">Efficiency</p>
            <Meter value={line.efficiency} tone={line.efficiency < 0.5 ? 'down' : 'gold'} display={pct(line.efficiency, { from: 'fraction', decimals: 0 })} />
          </div>
          <div>
            <p className="text-[11px] text-ink-faint">Quality</p>
            <Meter value={line.quality} tone="info" display={pct(line.quality, { from: 'fraction', decimals: 0 })} />
          </div>
          <div>
            <p className="text-[11px] text-ink-faint">Condition</p>
            <Meter value={line.condition} tone={line.condition < 0.4 ? 'down' : line.condition < 0.7 ? 'warn' : 'up'} display={pct(line.condition, { from: 'fraction', decimals: 0 })} />
          </div>
          <p className="text-[11px] text-ink-faint">
            Capacity {num(line.effectiveCapacityPerDay, 1)} of {num(line.capacityPerDay, 1)} units/day
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Inputs</p>
          <ul className="mt-1 space-y-1">
            {line.inputs.length === 0 && <li className="text-xs text-ink-faint">No inputs.</li>}
            {line.inputs.map((input) => (
              <li key={input.commodityId}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate text-ink-dim">{input.name}</span>
                  <span className="tnum shrink-0">
                    {num(input.inBuffer, 0)} ({num(input.daysOfCover, 1)}d)
                  </span>
                </div>
                <Progress value={Math.min(1, input.daysOfCover / 3)} label={`${num(input.neededPerDay, 1)}/day needed`} />
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Outputs</p>
          <ul className="mt-1 space-y-1">
            {line.outputs.map((output) => (
              <li key={output.commodityId} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-ink-dim">{output.name}</span>
                <span className="tnum shrink-0">
                  {num(output.producedPerDay, 1)}/day · {money(output.valuePerDay)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-ink-faint">
            Workers {line.workers.length}/{line.labourRequired} · manager {line.manager ?? 'none'}
          </p>
        </div>
      </div>

      {(line.blockers.length > 0 || line.alerts.length > 0 || short.length > 0 || labourShort) && (
        <ul className="mt-2 space-y-1">
          {line.blockers.map((blocker) => (
            <li key={blocker}>
              <InlineNote tone="down">{blocker}</InlineNote>
            </li>
          ))}
          {short.map((input) => (
            <li key={`short-${input.commodityId}`}>
              <InlineNote tone="warn">
                {input.name} cover is {num(input.daysOfCover, 1)} days — buy {num(Math.max(0, input.neededPerDay * 3 - input.inBuffer), 0)} units locally at about {money(input.localPrice)} each.
              </InlineNote>
            </li>
          ))}
          {labourShort && (
            <li>
              <InlineNote tone="warn">
                Labour factor {pct(line.labourFactor, { from: 'fraction', decimals: 0 })} — assign more crew or automate the line.
              </InlineNote>
            </li>
          )}
          {line.alerts.map((alert) => (
            <li key={alert}>
              <InlineNote tone="warn">{alert}</InlineNote>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 border-t border-line pt-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide controls' : 'Manage line'}
        </Button>
      </div>

      {open && (
        <div className="grid gap-3 border-t border-line pt-3 lg:grid-cols-4">
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Feed the line</h4>
            <Select aria-label="Input to feed" value={feedCommodity} onChange={(event) => setFeedCommodity(event.target.value)}>
              {line.inputs.map((input) => (
                <option key={input.commodityId} value={input.commodityId}>
                  {input.name} — needs {num(input.neededPerDay, 1)}/day
                </option>
              ))}
            </Select>
            <QuantityPicker value={feedQty} onChange={setFeedQty} unit="units" label="Quantity to feed" id={`feed-${line.id}`} />
            <CommandButton
              intent={{ type: 'production.feed', lineId: line.id, commodityId: feedCommodity, qty: feedQty }}
              label="Feed from storage"
              variant="primary"
              disabled={feedQty <= 0 || !feedCommodity}
              disabledReason={!feedCommodity ? 'This line has no inputs to feed.' : 'Enter a quantity.'}
            />
          </div>

          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Collect output</h4>
            <p className="text-xs text-ink-dim">Buffered output is moved into your storage, where it can be sold or shipped.</p>
            <CommandButton intent={{ type: 'production.collect', lineId: line.id }} label="Collect output" variant="success" />
            <CommandButton intent={{ type: 'production.collect', lineId: line.id, includeByproducts: true }} label="Collect with byproducts" variant="secondary" />
          </div>

          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Automate</h4>
            <p className="text-xs text-ink-dim">
              Automation buys down the labour requirement and lets a manager run the line. Level {line.automationLevel}; next level costs{' '}
              {line.automationCostNext > 0 ? money(line.automationCostNext) : '—'}.
            </p>
            <CommandButton
              intent={{ type: 'production.automate', lineId: line.id }}
              label={line.automationCostNext > 0 ? `Automate for ${money(line.automationCostNext)}` : 'Fully automated'}
              variant="secondary"
              disabled={line.automationCostNext <= 0}
              disabledReason="This line is already fully automated."
              confirm={line.automationCostNext >= 50000 ? { title: 'Automate this line?', body: `${money(line.automationCostNext)} is charged now and permanently reduces the labour this line needs.`, confirmLabel: 'Automate' } : undefined}
            />
          </div>

          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Repair &amp; shut down</h4>
            <CommandButton intent={{ type: 'production.repair', lineId: line.id }} label="Repair line" variant="secondary" disabled={line.status !== 'broken'} disabledReason="The line is not broken." />
            <CommandButton intent={{ type: 'production.restart', lineId: line.id }} label="Restart line" variant="secondary" disabled={line.status === 'running'} disabledReason="The line is already running." />
            <CommandButton
              intent={{ type: 'production.decommission', lineId: line.id }}
              label="Decommission line"
              variant="danger"
              confirm={{ title: `Decommission ${line.name}?`, body: 'The installed machinery is scrapped and the property is freed. Nothing that is still in the buffer is recovered.', confirmLabel: 'Decommission', destructive: true }}
            />
          </div>
        </div>
      )}
    </li>
  );
}

function Supply() {
  const production = useView<ProductionView>('production');
  const supply = production.data?.supplyChain;
  const buffers = production.data?.buffers;

  if (!supply) return null;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Input requirements" subtitle="What every line needs per day, and what is buffered">
          {supply.inputRequirements.length === 0 ? (
            <p className="text-xs text-ink-faint">No lines are consuming inputs.</p>
          ) : (
            <Table label="Input requirements">
              <thead>
                <tr>
                  <Th>Input</Th>
                  <Th align="right">Needed / day</Th>
                  <Th align="right">Buffered</Th>
                  <Th align="right">Shortfall</Th>
                  <Th align="right">Local price</Th>
                </tr>
              </thead>
              <tbody>
                {supply.inputRequirements.map((input) => (
                  <Tr key={input.commodityId}>
                    <Td className="text-xs text-ink">{input.name}</Td>
                    <Td align="right" className="tnum text-xs">{num(input.neededPerDay, 1)}</Td>
                    <Td align="right" className="tnum text-xs">{num(input.buffered, 0)}</Td>
                    <Td align="right" className={`tnum text-xs ${input.shortfallPerDay > 0 ? 'text-down' : 'text-ink-faint'}`}>{num(input.shortfallPerDay, 1)}</Td>
                    <Td align="right" className="tnum text-xs">{money(input.localPrice)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel title="Output products" subtitle="What the plant is producing and what it is worth">
          {supply.outputProducts.length === 0 ? (
            <p className="text-xs text-ink-faint">Nothing is being produced.</p>
          ) : (
            <BarList items={supply.outputProducts.map((output) => ({ label: `${output.name} (${num(output.producedPerDay, 1)}/day)`, value: output.valuePerDay }))} format={(value) => money(value)} />
          )}
          {buffers && (
            <dl className="mt-3 space-y-0.5">
              <KeyValue label="Buffered inputs">{num(buffers.inputs, 0)} units</KeyValue>
              <KeyValue label="Buffered outputs">{num(buffers.outputs, 0)} units</KeyValue>
              <KeyValue label="Buffer value">{money(buffers.value)}</KeyValue>
            </dl>
          )}
        </Panel>

        <Panel title="Chains" subtitle="Recipe chains with their current blockers">
          {supply.chains.length === 0 ? (
            <p className="text-xs text-ink-faint">No chains are running.</p>
          ) : (
            <ul className="space-y-2">
              {supply.chains.map((chain) => (
                <li key={chain.recipeId} className="rounded border border-line bg-panel-2/40 px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-ink">{chain.name}</span>
                    <Badge tone="neutral">{chain.lines} line(s)</Badge>
                  </div>
                  {chain.blockers.length > 0 && <p className="mt-0.5 text-[11px] text-warn">{chain.blockers.join(' · ')}</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Install() {
  const production = useView<ProductionView>('production');
  const properties = useView<{ owned: PropertyOwned[] }>('properties');
  const [kindFilter, setKindFilter] = useState('');
  const [onlyViable, setOnlyViable] = useState(true);
  const [propertyByRecipe, setPropertyByRecipe] = useState<Record<string, string>>({});

  const recipes = production.data?.recipes ?? [];
  const owned = properties.data?.owned ?? [];
  const [search, setSearch] = useState('');

  const tags = useMemo(() => [...new Set(recipes.map((recipe) => recipe.requiresTag))].sort(), [recipes]);
  const filtered = recipes.filter((recipe) => {
    if (kindFilter && recipe.requiresTag !== kindFilter) return false;
    if (onlyViable && !recipe.viable) return false;
    if (search && !`${recipe.name} ${recipe.outputName}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (owned.length === 0) {
    return (
      <Panel title="Install a production line">
        <EmptyState
          title="You need a property first"
          body="Lines install into premises with the right tags — a workshop, a warehouse, a factory. Buy property at this location, then come back."
        />
      </Panel>
    );
  }

  return (
    <ViewPanel<ProductionView>
      view="production"
      title="Recipes installable here"
      subtitle="Priced against this location's input and output prices"
      isEmpty={(data) => data.recipes.length === 0}
      emptyTitle="No recipes apply here"
      emptyBody="Recipes need property tags this location does not have, or inputs that cannot be sourced here."
      actions={
        <>
          <Input placeholder="Search recipes" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search recipes" />
          <Select aria-label="Required property tag" value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
            <option value="">All property tags</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {humanise(tag)}
              </option>
            ))}
          </Select>
          <Checkbox label="Viable only" checked={onlyViable} onChange={setOnlyViable} />
        </>
      }
    >
      {() => (
        <ul className="space-y-3">
          {filtered.length === 0 && <li className="text-xs text-ink-faint">No recipes match those filters.</li>}
          {filtered.map((recipe) => (
            <RecipeRow
              key={recipe.recipeId}
              recipe={recipe}
              owned={owned}
              chosen={propertyByRecipe[recipe.recipeId] ?? ''}
              onChoose={(propertyId) => setPropertyByRecipe({ ...propertyByRecipe, [recipe.recipeId]: propertyId })}
            />
          ))}
        </ul>
      )}
    </ViewPanel>
  );
}

function RecipeRow({ recipe, owned, chosen, onChoose }: { recipe: RecipeListing; owned: PropertyOwned[]; chosen: string; onChoose: (propertyId: string) => void }) {
  // The server tells us which recipes each owned property can run — no tag matching here.
  const suitable = owned.filter((property) => property.recipesEnabled.some((entry) => entry.id === recipe.recipeId) && property.productionLines === 0 && property.businessId === null);
  const propertyId = chosen || suitable[0]?.id || '';

  return (
    <li className="rounded-panel border border-line bg-panel px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            {recipe.name}
            <Badge tone={recipe.viable ? 'up' : 'warn'}>{recipe.viable ? 'viable here' : 'marginal here'}</Badge>
            <Badge tone="neutral">needs {humanise(recipe.requiresTag)}</Badge>
          </h3>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            Produces {num(recipe.outputQtyPerDay, 1)} × {recipe.outputName} per day
            {recipe.byproducts.length > 0 ? ` · byproducts ${recipe.byproducts.map((item) => item.name).join(', ')}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="tnum text-sm text-ink">{money(recipe.netMarginAtBase, { sign: true })}/day</p>
          <p className="text-[11px] text-ink-faint">
            payback {recipe.paybackDaysAtBase > 0 ? `${num(recipe.paybackDaysAtBase)} days` : '—'}
          </p>
        </div>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
        <KeyValue label="Install capex">{money(recipe.installCapex)}</KeyValue>
        <KeyValue label="Automation capex">{money(recipe.automationCapex)}</KeyValue>
        <KeyValue label="Input cost / day">{money(recipe.inputCostPerDay)}</KeyValue>
        <KeyValue label="Energy / day">{money(recipe.energyCostPerDay)}</KeyValue>
        <KeyValue label="Labour (imputed)">{money(recipe.imputedLabourCostPerDay)}/day</KeyValue>
        <KeyValue label="Maintenance / day">{money(recipe.maintenancePerDay)}</KeyValue>
        <KeyValue label="Revenue at base">{money(recipe.revenuePerDayAtBase)}/day</KeyValue>
        <KeyValue label="Gross margin">{pct(recipe.grossMarginAtBase, { from: 'fraction', decimals: 1 })}</KeyValue>
      </dl>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Inputs per day</p>
          <ul className="mt-0.5">
            {recipe.inputs.map((input) => (
              <li key={input.commodityId} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-ink-dim">{input.name}</span>
                <span className="tnum text-ink-faint">
                  {num(input.qtyPerDay, 1)} · {money(input.costPerDay)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Outputs per day</p>
          <ul className="mt-0.5">
            {recipe.outputs.map((output) => (
              <li key={output.commodityId} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-ink-dim">{output.name}</span>
                <span className="tnum text-ink-faint">
                  {num(output.qtyPerDay, 1)} · {money(output.revenuePerDay)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {recipe.notes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {recipe.notes.map((note) => (
            <li key={note}>
              <InlineNote tone="info">{note}</InlineNote>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="mb-1 block text-ink-dim">Install into</span>
          <select
            className="rounded-md border border-line-strong bg-hull px-2 py-1.5 text-sm text-ink"
            value={propertyId}
            onChange={(event) => onChoose(event.target.value)}
            aria-label={`Property for ${recipe.name}`}
          >
            {suitable.length === 0 && <option value="">No suitable free property</option>}
            {suitable.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name} — {property.locationName} ({mass(property.storageKg)})
              </option>
            ))}
          </select>
        </label>
        <CommandButton
          intent={{ type: 'production.install', recipeId: recipe.recipeId, propertyId }}
          label={`Install for ${money(recipe.installCapex)}`}
          variant={recipe.viable && propertyId ? 'success' : 'secondary'}
          disabled={!propertyId}
          disabledReason="You need a free property with the right tags at this location."
          confirm={{ title: `Install ${recipe.name}?`, body: `${money(recipe.installCapex)} is charged to install the line. It then runs every day, consuming inputs whether or not you are watching.`, confirmLabel: 'Install line' }}
        />
      </div>
    </li>
  );
}
