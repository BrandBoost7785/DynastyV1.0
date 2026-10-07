'use client';

/**
 * Automation.
 *
 * Standing orders are the difference between a business and a job: the player writes a
 * policy once and a manager executes it every day they are elsewhere.
 *
 * Three deliberate limits shape this screen:
 *
 *  • **The server owns the policy.** Create and edit forms are rendered from the rule's
 *    own `schema` — a field the server did not publish cannot be invented here — and the
 *    dispatcher re-validates and clamps every value regardless of what was typed.
 *  • **The server owns the verdict.** Uptime, error chance, cooldown, delegation load and
 *    manager eligibility are all read from the view. Nothing is recomputed in the browser.
 *  • **No manager, no rule.** A rule without a capable manager is shown as blocked with
 *    the server's own explanation, and hiring is a link to Crew rather than a fake toggle.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useView } from '../../../../lib/game-context';
import { CommandButton } from '../../../../components/game/view-panel';
import { Badge, Button, Input, KeyValue, Meter, Panel, Progress, Select, Stat, Table, Tabs, Td, Th, Tr } from '../../../../components/ui/primitives';
import { Checkbox } from '../../../../components/ui/primitives';
import { EmptyState, InlineNote } from '../../../../components/ui/states';
import { days, humanise, money, num, pct } from '../../../../lib/format';
import type { AutomationRuleView, AutomationView, RuleConfigField } from '../../../../lib/game-data';

type Tab = 'rules' | 'delegate' | 'managers';

/** A working copy of a rule's config: only keys the server published. */
type ConfigValues = Record<string, number | boolean | string>;

function defaultsFor(schema: RuleConfigField[]): ConfigValues {
  const values: ConfigValues = {};
  for (const field of schema) values[field.key] = field.defaultValue;
  return values;
}

/** Merge stored config over the defaults, keeping only keys the schema still declares. */
function valuesFor(schema: RuleConfigField[], stored: Record<string, unknown>): ConfigValues {
  const values = defaultsFor(schema);
  for (const field of schema) {
    const current = stored[field.key];
    if (current === undefined) continue;
    if (field.type === 'number' && typeof current === 'number') values[field.key] = current;
    else if (field.type === 'boolean' && typeof current === 'boolean') values[field.key] = current;
    else if (field.type === 'select' && typeof current === 'string') values[field.key] = current;
  }
  return values;
}

export default function AutomationPage() {
  const automation = useView<AutomationView>('automation');
  const data = automation.data;
  const [tab, setTab] = useState<Tab>('rules');

  const rules = data?.rules ?? [];
  const enabled = rules.filter((rule) => rule.enabled).length;
  const errorRate = data && data.totalRuns > 0 ? data.totalErrors / data.totalRuns : 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-gold uppercase">Empire</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">Automation</h1>
          <p className="mt-1 text-xs text-ink-dim">
            {data
              ? `${enabled} of ${rules.length} standing order${rules.length === 1 ? '' : 's'} running · ${money(data.profitToday)} earned today`
              : 'Reading your standing orders…'}
          </p>
        </div>
        <Tabs
          label="Automation sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'rules', label: 'Standing orders', count: rules.length },
            { id: 'delegate', label: 'Write an order' },
            { id: 'managers', label: 'Delegation', count: data?.managers.length },
          ]}
        />
      </header>

      {data && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Running"
            value={`${enabled} / ${rules.length}`}
            hint={rules.length === 0 ? 'nothing is delegated yet' : `${rules.length - enabled} paused`}
            tone={enabled > 0 ? 'up' : 'default'}
          />
          <Stat label="Profit today" value={money(data.profitToday)} hint={`${money(data.automationProfitAllTime)} all time`} tone={data.profitToday > 0 ? 'up' : 'default'} />
          <Stat
            label="Runs / errors"
            value={`${num(data.totalRuns)} / ${num(data.totalErrors)}`}
            hint={data.totalRuns > 0 ? `${pct(errorRate, { from: 'fraction', decimals: 1 })} failure rate` : 'no runs recorded yet'}
            tone={errorRate > 0.15 ? 'warn' : 'default'}
          />
          <Stat
            label="Delegation load"
            value={`${data.delegation.rules} / ${data.delegation.capacity}`}
            hint={data.delegation.overloaded ? 'over capacity — rules will be skipped' : `${data.delegation.managers} manager${data.delegation.managers === 1 ? '' : 's'} supervising`}
            tone={data.delegation.overloaded ? 'warn' : 'default'}
          />
        </div>
      )}

      {tab === 'rules' && <Rules onWrite={() => setTab('delegate')} />}
      {tab === 'delegate' && <Delegate />}
      {tab === 'managers' && <Delegation />}
    </div>
  );
}

function Rules({ onWrite }: { onWrite: () => void }) {
  const automation = useView<AutomationView>('automation');
  const [openRule, setOpenRule] = useState<string | null>(null);

  return (
    <Panel
      title="Standing orders"
      subtitle="Each order is a policy the server executes once per day on your behalf"
      actions={
        <Button size="sm" variant="secondary" onClick={onWrite}>
          Write a new order
        </Button>
      }
    >
      {automation.data === undefined && automation.error === null && <p className="text-xs text-ink-faint">Loading standing orders…</p>}
      {automation.error && automation.data === undefined && (
        <InlineNote tone="down">Could not load your standing orders: {automation.error.message}</InlineNote>
      )}
      {automation.data?.rules.length === 0 && (
        <EmptyState
          title="Nothing is delegated yet"
          body="Every order you write hands one repetitive decision — trading, resupply, sweeping a business — to a manager who runs it each day while you are elsewhere. Write one, hire a manager, and the empire keeps moving while you sleep."
        />
      )}
      {automation.data && automation.data.rules.length > 0 && (
        <ul className="space-y-2">
          {automation.data.rules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} open={openRule === rule.id} onToggle={() => setOpenRule(openRule === rule.id ? null : rule.id)} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RuleCard({ rule, open, onToggle }: { rule: AutomationRuleView; open: boolean; onToggle: () => void }) {
  const [config, setConfig] = useState<ConfigValues>(() => valuesFor(rule.schema, rule.config));
  const dirty = useMemo(() => rule.schema.some((field) => config[field.key] !== valuesFor(rule.schema, rule.config)[field.key]), [config, rule.schema, rule.config]);

  return (
    <li className="rounded-panel border border-line bg-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-ink">{rule.name}</h3>
            <Badge tone={rule.enabled ? 'up' : 'neutral'}>{rule.enabled ? 'running' : 'paused'}</Badge>
            <Badge tone="info">{rule.kindLabel}</Badge>
            {rule.cooldownDays > 0 && <Badge tone="warn">cooling down {days(rule.cooldownDays)}</Badge>}
          </div>
          <p className="mt-1 text-[11px] text-ink-faint">
            {rule.manager ? `Manager ${rule.manager.name} · ${humanise(rule.manager.role)}` : 'No manager assigned — this order cannot run'}
            {' · '}
            written day {rule.createdDay}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CommandButton
            intent={{ type: 'automation.update_rule', ruleId: rule.id, enabled: !rule.enabled }}
            label={rule.enabled ? 'Pause' : 'Enable'}
            size="sm"
            variant={rule.enabled ? 'secondary' : 'success'}
            options={{ silent: false }}
          />
          <Button size="sm" variant="ghost" onClick={onToggle} aria-expanded={open}>
            {open ? 'Close' : 'Details'}
          </Button>
        </div>
      </div>

      {open && (
        <div className="grid gap-3 border-t border-line px-3 py-3 lg:grid-cols-3">
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Track record</h4>
            <dl>
              <KeyValue label="Runs">{num(rule.totalRuns)}</KeyValue>
              <KeyValue label="Errors">{num(rule.totalErrors)}</KeyValue>
              <KeyValue label="Failure rate" tone={rule.errorRate > 0.15 ? 'text-warn' : undefined}>
                {pct(rule.errorRate, { from: 'fraction', decimals: 1 })}
              </KeyValue>
              <KeyValue label="Profit contributed">{money(rule.totalProfit)}</KeyValue>
              <KeyValue label="Last run">{rule.lastRunDay === null ? 'never' : `day ${rule.lastRunDay}`}</KeyValue>
            </dl>
            {rule.lastResult && (
              <InlineNote tone={rule.lastResult.success ? 'up' : 'warn'}>
                Day {rule.lastResult.day}: {rule.lastResult.message}
                {rule.lastResult.profit !== 0 ? ` (${money(rule.lastResult.profit)})` : ''}
              </InlineNote>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Reliability</h4>
            <Meter label="Uptime" value={rule.uptime} display={pct(rule.uptime, { from: 'fraction', decimals: 0 })} tone="up" />
            <Meter label="Chance of a bad day" value={rule.errorChance} display={pct(rule.errorChance, { from: 'fraction', decimals: 0 })} tone={rule.errorChance > 0.2 ? 'warn' : 'info'} />
            <p className="text-[11px] text-ink-faint">
              A failed run costs about {pct(rule.errorCostFraction, { from: 'fraction', decimals: 0 })} of the order value. Managers with higher skill and morale cut both numbers.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Policy</h4>
            <RuleConfigForm schema={rule.schema} values={config} onChange={(key, value) => setConfig((current) => ({ ...current, [key]: value }))} idPrefix={rule.id} />
            <div className="flex flex-wrap gap-2">
              <CommandButton
                intent={{ type: 'automation.update_rule', ruleId: rule.id, config }}
                label="Save policy"
                size="sm"
                variant="primary"
                disabled={!dirty}
                disabledReason="Nothing has changed yet."
              />
              <CommandButton
                intent={{ type: 'automation.delete_rule', ruleId: rule.id }}
                label="Delete order"
                size="sm"
                variant="danger"
                confirm={{
                  title: `Delete “${rule.name}”?`,
                  body: 'The standing order stops immediately and its track record is discarded. The goods and cash it already moved are untouched.',
                  confirmLabel: 'Delete order',
                  destructive: true,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

/** A schema-driven form: numbers, checkboxes and selects, all bounded by the server. */
function RuleConfigForm({
  schema,
  values,
  onChange,
  idPrefix,
}: {
  schema: RuleConfigField[];
  values: ConfigValues;
  onChange: (key: string, value: number | boolean | string) => void;
  idPrefix: string;
}) {
  if (schema.length === 0) return <p className="text-xs text-ink-faint">This order has no settings to tune.</p>;
  return (
    <div className="space-y-2.5">
      {schema.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        if (field.type === 'boolean') {
          return (
            <Checkbox
              key={field.key}
              label={field.label}
              hint={field.help}
              checked={Boolean(values[field.key])}
              onChange={(next) => onChange(field.key, next)}
            />
          );
        }
        if (field.type === 'select') {
          return (
            <label key={field.key} htmlFor={id} className="block text-xs">
              <span className="mb-1 block text-ink-dim">{field.label}</span>
              <Select id={id} value={String(values[field.key] ?? '')} onChange={(event) => onChange(field.key, event.target.value)}>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {humanise(option)}
                  </option>
                ))}
              </Select>
              {field.help && <span className="mt-1 block text-[11px] text-ink-faint">{field.help}</span>}
            </label>
          );
        }
        return (
          <label key={field.key} htmlFor={id} className="block text-xs">
            <span className="mb-1 block text-ink-dim">
              {field.label}
              {field.min !== undefined && field.max !== undefined && (
                <span className="text-ink-faint">
                  {' '}
                  ({num(field.min)}–{num(field.max)})
                </span>
              )}
            </span>
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              {...(field.min === undefined ? {} : { min: field.min })}
              {...(field.max === undefined ? {} : { max: field.max })}
              step={field.step ?? 1}
              value={Number(values[field.key] ?? field.defaultValue)}
              onChange={(event) => onChange(field.key, Number(event.target.value))}
            />
            {field.help && <span className="mt-1 block text-[11px] text-ink-faint">{field.help}</span>}
          </label>
        );
      })}
    </div>
  );
}

function Delegate() {
  const automation = useView<AutomationView>('automation');
  const data = automation.data;
  const kinds = data?.availableKinds ?? [];
  const [kind, setKind] = useState('');
  const selected = kinds.find((option) => option.kind === kind) ?? kinds[0];
  const [managerId, setManagerId] = useState('');
  const [name, setName] = useState('');
  const [config, setConfig] = useState<ConfigValues | null>(null);

  const effectiveKind = selected?.kind ?? '';
  const schema = selected?.schema ?? [];
  const effectiveConfig = config ?? defaultsFor(schema);

  if (!data) return <Panel title="Write a standing order">{automation.error ? <InlineNote tone="down">{automation.error.message}</InlineNote> : <p className="text-xs text-ink-faint">Loading the rule catalogue…</p>}</Panel>;

  const managers = data.managers;
  const eligibleManager = managerId || (managers.length === 1 ? managers[0]!.id : '');

  return (
    <Panel title="Write a standing order" subtitle="Pick a policy, hand it to a manager, and set its bounds">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <label htmlFor="automation-kind" className="block text-xs">
            <span className="mb-1 block text-ink-dim">Order type</span>
            <Select
              id="automation-kind"
              value={effectiveKind}
              onChange={(event) => {
                setKind(event.target.value);
                setConfig(null);
              }}
            >
              {kinds.map((option) => (
                <option key={option.kind} value={option.kind}>
                  {option.label}
                  {option.managerAvailable ? '' : ' — needs a manager'}
                  {option.configured ? ' (already written)' : ''}
                </option>
              ))}
            </Select>
          </label>

          <label htmlFor="automation-manager" className="block text-xs">
            <span className="mb-1 block text-ink-dim">Manager</span>
            <Select id="automation-manager" value={eligibleManager} onChange={(event) => setManagerId(event.target.value)}>
              <option value="">Assign later</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.name} — {humanise(manager.role)} (skill {num(manager.skill, 2)}, {manager.rules} orders)
                </option>
              ))}
            </Select>
            <span className="mt-1 block text-[11px] text-ink-faint">
              {selected?.managerAvailable
                ? `${selected.managerName} can run this order type today.`
                : 'Nobody you employ has the capability this order needs — hire a manager on the Crew screen.'}
            </span>
          </label>

          <label htmlFor="automation-name" className="block text-xs">
            <span className="mb-1 block text-ink-dim">Name (optional)</span>
            <Input id="automation-name" value={name} maxLength={80} placeholder={selected?.label ?? 'Standing order'} onChange={(event) => setName(event.target.value)} />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <CommandButton
              intent={{
                type: 'automation.create_rule',
                kind: effectiveKind,
                ...(name.trim() ? { name: name.trim() } : {}),
                ...(eligibleManager ? { managerId: eligibleManager } : {}),
                config: effectiveConfig,
              }}
              label="Write the order"
              variant="primary"
              disabled={!effectiveKind}
              disabledReason="Choose an order type first."
              onDone={(outcome) => {
                if (outcome.ok) {
                  setName('');
                  setConfig(null);
                }
              }}
            />
            {!selected?.managerAvailable && (
              <Link href="../crew" className="text-xs text-gold hover:underline">
                Hire a manager →
              </Link>
            )}
          </div>
          {!eligibleManager && (
            <InlineNote tone="warn">
              Without a manager the order is stored but never executed. The dispatcher will report it as paused until somebody is assigned.
            </InlineNote>
          )}
        </div>

        <div className="space-y-2">
          <h2 className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Policy</h2>
          <RuleConfigForm schema={schema} values={effectiveConfig} onChange={(key, value) => setConfig({ ...effectiveConfig, [key]: value })} idPrefix="new-rule" />
          <p className="text-[11px] text-ink-faint">
            These bounds are recommendations, not limits: the server clamps every value into the published range and can refuse a dispatch outright when a rule would break another game rule.
          </p>
        </div>
      </div>
    </Panel>
  );
}

function Delegation() {
  const automation = useView<AutomationView>('automation');
  const data = automation.data;
  if (!data) return <Panel title="Delegation">{automation.error ? <InlineNote tone="down">{automation.error.message}</InlineNote> : <p className="text-xs text-ink-faint">Loading delegation…</p>}</Panel>;

  const { delegation, managers } = data;
  const load = delegation.capacity > 0 ? delegation.rules / delegation.capacity : 0;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title="Delegation load" subtitle="How much of your operation runs without you">
        <Progress value={load} tone={delegation.overloaded ? 'warn' : 'gold'} label="Orders against capacity" />
        <dl className="mt-2">
          <KeyValue label="Orders">{`${delegation.enabled} enabled / ${delegation.rules} written`}</KeyValue>
          <KeyValue label="Capacity">{delegation.capacity}</KeyValue>
          <KeyValue label="Managers in post">{delegation.managers}</KeyValue>
          <KeyValue label="Orders per manager">{num(delegation.rulesPerManager, 1)}</KeyValue>
        </dl>
        {delegation.overloaded && <InlineNote tone="warn">More orders are written than your managers can supervise, so the least important ones get skipped. Reduce the count or promote somebody.</InlineNote>}
        <h3 className="mt-3 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Who can hold an order</h3>
        <ul className="mt-1 space-y-1">
          {delegation.tiers.map((tier) => (
            <li key={tier.tier} className="flex items-start justify-between gap-3 text-xs">
              <span className="text-ink-dim">{tier.description}</span>
              <span className="tnum shrink-0 text-ink">{tier.count}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Managers" subtitle="Crew whose role carries automation capability">
        {managers.length === 0 ? (
          <EmptyState
            title="You have no managers"
            body="Automation is not a machine you buy, it is a person you trust with a decision. Hire somebody whose role carries an automation capability — logistics, finance or business staff — then assign them an order."
          />
        ) : (
          <Table label="Managers available for standing orders">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Capability</Th>
                <Th align="right">Skill</Th>
                <Th align="right">Orders</Th>
              </tr>
            </thead>
            <tbody>
              {managers.map((manager) => (
                <Tr key={manager.id}>
                  <Td className="text-sm text-ink">{manager.name}</Td>
                  <Td className="text-xs text-ink-dim">{humanise(manager.role)}</Td>
                  <Td className="text-xs text-ink-dim">{humanise(manager.capability)}</Td>
                  <Td align="right" className="tnum">{num(manager.skill, 2)}</Td>
                  <Td align="right" className="tnum">{manager.rules}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="mt-2 text-[11px] text-ink-faint">
          Wages, morale, injury and span of control all move these numbers, and they are computed on the server — this table is a read-out, not a scoreboard you can edit.
        </p>
      </Panel>
    </div>
  );
}
