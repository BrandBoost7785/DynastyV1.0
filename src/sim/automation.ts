/**
 * Automation — hierarchical delegation (spec §22).
 *
 * The player cannot be everywhere, so the organisation runs itself: a rule names
 * an operation, a manager executes it, and the daily tick performs it with the
 * same authoritative code paths the player would use. Nothing here bypasses
 * validation — an automated trade goes through `executeBuy`, an automated
 * repayment through `repayLoan`, and every run is recorded with its result so the
 * UI can show what the manager did and why.
 *
 * Managers are fallible on purpose. Uptime, error chance and error cost scale with
 * the manager's skill, morale and loyalty, so delegation is a decision with
 * tradeoffs rather than a free upgrade.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { EMPLOYEE_ROLES, ROLE_BY_ID } from '../engine/registry/people';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { getWorldRegistry } from '../engine/registry/world';
import { businessViews, sweepCashbox } from './businesses';
import { assignEmployee, hire, candidateViews, crewSkillLevel } from './crew';
import { launderingFronts, launder, repayLoan } from './finance';
import { quantityOnHand } from './inventory';
import { executeBuy, executeSell, marketRows, playerArbitrage, quoteSell } from './markets';
import { feedInputs, collectOutputs, lineViews, restartLine } from './production';
import { bumpCounter, counter, playerModifiers, setCounter } from './progression';
import { planShipment, sendShipment, type ShipmentPlan } from './logistics';
import { buyShares, stockMarketView } from './stocks';
import { stake, buyCrypto, cryptoMarketView } from './crypto';
import { creditCash, debitCash, formatMoney, newId, pushDiagnostic, pushNotification, round2, spendable } from './state';
import { automationErrorReduction } from './modifiers';
import type { AutomationResult, AutomationRule, EmployeeInstance, GameState, ID, TravelMode } from './types';
import { orderedEntries } from './ordering';

const B = getBalance();
const worldReg = getWorldRegistry();
const registry = getCommodityRegistry();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Which employee roles can execute which rule kinds. */
const CAPABILITY_FOR_KIND: Record<AutomationRule['kind'], string[]> = {
  auto_trade: ['auto_trade', 'auto_finance'],
  auto_resupply: ['auto_logistics', 'auto_trade'],
  auto_ship: ['auto_logistics'],
  auto_loan_repay: ['auto_finance'],
  auto_invest: ['auto_finance'],
  auto_launder: ['laundering', 'auto_finance'],
  auto_produce: ['auto_production'],
  auto_business_sweep: ['auto_business'],
  auto_hire: ['auto_business'],
};

export interface RuleConfigField {
  key: string;
  label: string;
  type: 'number' | 'boolean' | 'select';
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  defaultValue: number | boolean | string;
  help: string;
}

/** Data-driven config schema per rule kind — the UI renders forms from this. */
export function ruleConfigSchema(kind: AutomationRule['kind']): RuleConfigField[] {
  switch (kind) {
    case 'auto_trade':
      return [
        { key: 'minMargin', label: 'Minimum margin', type: 'number', min: 0.02, max: 1, step: 0.01, defaultValue: B.automation.autoTradeMarginThreshold, help: 'Only trade when the net margin after travel and fees beats this.' },
        { key: 'maxCashFraction', label: 'Max share of cash per trade', type: 'number', min: 0.02, max: 0.6, step: 0.01, defaultValue: B.automation.autoTradeMaxFractionOfCash, help: 'Caps how much of your available cash one automated order can commit.' },
        { key: 'sellHoldings', label: 'Also sell profitable holdings', type: 'boolean', defaultValue: true, help: 'Sells stock here when the local price beats your cost basis by the margin threshold.' },
        { key: 'allowIllegal', label: 'Allow illegal goods', type: 'boolean', defaultValue: false, help: 'Lets the manager use hidden channels. Raises heat and can end in seizure.' },
        { key: 'insure', label: 'Insure freight', type: 'boolean', defaultValue: true, help: 'Pays a premium so a lost shipment is reimbursed at the policy fraction.' },
        { key: 'maxRouteRisk', label: 'Max route risk', type: 'number', min: 0.05, max: 1, step: 0.05, defaultValue: B.automation.autoShipMaxRisk, help: 'Declines dispatch when inspection plus theft risk beats this. Lower is safer and slower.' },
      ];
    case 'auto_resupply':
      return [
        { key: 'daysOfCover', label: 'Target days of input cover', type: 'number', min: 1, max: 30, step: 1, defaultValue: 4, help: 'Buys inputs when a line has fewer days of cover than this.' },
        { key: 'maxCashFraction', label: 'Max share of cash per day', type: 'number', min: 0.02, max: 0.6, step: 0.01, defaultValue: 0.25, help: 'Daily spending cap on input purchases.' },
      ];
    case 'auto_ship':
      return [
        { key: 'minMargin', label: 'Minimum delivered margin', type: 'number', min: 0.02, max: 1, step: 0.01, defaultValue: 0.18, help: 'Ships only when the destination price beats local value by this much after freight.' },
        { key: 'maxKg', label: 'Max kg per shipment', type: 'number', min: 1, max: 100000, step: 1, defaultValue: 2000, help: 'Keeps shipments inside your vehicle capacity.' },
        { key: 'mode', label: 'Freight mode', type: 'select', options: ['bus', 'truck', 'train', 'ferry', 'air', 'cargo_ship'], defaultValue: 'truck', help: 'Cheaper modes are slower and carry less.' },
        { key: 'insure', label: 'Insure shipments', type: 'boolean', defaultValue: true, help: 'Pays a premium per day in transit for a capped payout on loss.' },
        { key: 'maxRouteRisk', label: 'Max route risk', type: 'number', min: 0.05, max: 1, step: 0.05, defaultValue: B.automation.autoShipMaxRisk, help: 'Declines dispatch when inspection plus theft risk beats this.' },
      ];
    case 'auto_loan_repay':
      return [
        { key: 'cashReserve', label: 'Cash reserve to keep', type: 'number', min: 0, max: 10000000, step: 500, defaultValue: 25000, help: 'Never repays below this balance.' },
        { key: 'maxApr', label: 'Only repay above APR', type: 'number', min: 0, max: 2, step: 0.01, defaultValue: 0.08, help: 'Ignores cheap debt so capital stays working.' },
      ];
    case 'auto_invest':
      return [
        { key: 'cashReserve', label: 'Cash reserve to keep', type: 'number', min: 0, max: 10000000, step: 500, defaultValue: 50000, help: 'Invests only what is above this.' },
        { key: 'minYield', label: 'Minimum dividend yield', type: 'number', min: 0, max: 0.2, step: 0.005, defaultValue: 0.025, help: 'Buys equities yielding at least this.' },
        { key: 'stakeCrypto', label: 'Also stake crypto', type: 'boolean', defaultValue: false, help: 'Bonds idle crypto at the best available APY.' },
        { key: 'maxPositionFraction', label: 'Max position size', type: 'number', min: 0.01, max: 0.5, step: 0.01, defaultValue: 0.08, help: 'Share of investable cash committed to one name.' },
      ];
    case 'auto_launder':
      return [
        { key: 'minAmount', label: 'Minimum batch', type: 'number', min: 500, max: 500000, step: 500, defaultValue: 5000, help: 'Stages dirty cash in batches of at least this size.' },
        { key: 'maxHeat', label: 'Stop above heat', type: 'number', min: 5, max: 100, step: 1, defaultValue: 55, help: 'Pauses laundering when enforcement attention is too high.' },
      ];
    case 'auto_produce':
      return [
        { key: 'collect', label: 'Collect outputs to storage', type: 'boolean', defaultValue: true, help: 'Moves finished goods into warehouse storage so they can be sold or shipped.' },
        { key: 'restart', label: 'Restart suspended lines', type: 'boolean', defaultValue: true, help: 'Brings lines back online once cash is available.' },
      ];
    case 'auto_business_sweep':
      return [
        { key: 'threshold', label: 'Sweep above cashbox', type: 'number', min: 0, max: 1000000, step: 500, defaultValue: 5000, help: 'Leaves working float in the business below this.' },
      ];
    case 'auto_hire':
      return [
        { key: 'fillSlots', label: 'Fill empty staff slots', type: 'boolean', defaultValue: true, help: 'Hires for businesses and properties with nobody assigned.' },
        { key: 'minSkill', label: 'Minimum skill', type: 'number', min: 1, max: 99, step: 1, defaultValue: 40, help: 'Rejects candidates below this skill.' },
        { key: 'maxSalary', label: 'Maximum daily salary', type: 'number', min: 10, max: 5000, step: 10, defaultValue: 260, help: 'Payroll discipline.' },
      ];
    default:
      return [];
  }
}

export function defaultConfig(kind: AutomationRule['kind']): AutomationRule['config'] {
  const config: AutomationRule['config'] = {};
  for (const field of ruleConfigSchema(kind)) config[field.key] = field.defaultValue;
  return config;
}

/* ------------------------------------------------------------------ */
/* Rule management                                                     */
/* ------------------------------------------------------------------ */

export interface RuleActionResult {
  ok: boolean;
  reason?: string;
  rule?: AutomationRule;
}

export function eligibleManagers(state: GameState, kind: AutomationRule['kind']): EmployeeInstance[] {
  const capabilities = CAPABILITY_FOR_KIND[kind];
  return state.player.crew.filter((e) => {
    if (e.status !== 'active' || e.injured) return false;
    const role = ROLE_BY_ID[e.role];
    return role !== undefined && capabilities.includes(role.automationCapability);
  });
}

export function createRule(
  state: GameState,
  rng: Rng,
  kind: AutomationRule['kind'],
  opts: { name?: string; managerId?: ID; config?: AutomationRule['config'] } = {},
): RuleActionResult {
  if (state.player.automation.some((r) => r.kind === kind)) {
    return { ok: false, reason: `You already have a ${kindLabel(kind)} rule. Edit it instead.` };
  }
  const managers = eligibleManagers(state, kind);
  const manager = opts.managerId ? managers.find((m) => m.id === opts.managerId) : managers.sort((a, b) => b.stats.skill - a.stats.skill)[0];
  if (!manager) {
    return {
      ok: false,
      reason: `Nobody on your payroll can run ${kindLabel(kind)}. Hire one of these roles: ${rolesForCapabilities(CAPABILITY_FOR_KIND[kind])}. They must be active, uninjured and on your books here.`,
    };
  }
  const span = delegationLoad(state);
  if (span.rulesPerManager > B.automation.managerSpanOfControl) {
    return { ok: false, reason: `${manager.name} already runs ${span.rulesPerManager} rules; the span of control is ${B.automation.managerSpanOfControl}. Promote another manager.` };
  }
  const rule: AutomationRule = {
    id: newId(rng, 'rule'),
    name: opts.name ?? `${kindLabel(kind)} (${manager.name})`,
    enabled: true,
    managerId: manager.id,
    kind,
    config: { ...defaultConfig(kind), ...(opts.config ?? {}) },
    createdDay: state.world.day,
    lastRunDay: null,
    lastResult: null,
    totalProfit: 0,
    totalRuns: 0,
    totalErrors: 0,
  };
  state.player.automation.push(rule);
  if (!manager.assignment) {
    manager.assignment = { kind: 'manager_of_managers', targetId: state.player.locationId, tier: 2, reportsTo: null };
  }
  bumpCounter(state, 'rules_created');
  pushNotification(state, {
    kind: 'success',
    title: `${rule.name} is live`,
    body: `${manager.name} will run ${kindLabel(kind)} every day. Uptime ${(uptimeFor(manager) * 100).toFixed(0)}%, error chance ${(errorChanceFor(state, manager) * 100).toFixed(1)}%.`,
    link: '/game/settings',
    metrics: [
      { label: 'Manager', value: manager.name },
      { label: 'Skill', value: String(manager.stats.skill) },
      { label: 'Uptime', value: `${(uptimeFor(manager) * 100).toFixed(0)}%` },
    ],
  });
  return { ok: true, rule };
}

/** Role names that can actually run these capabilities — read from the registry. */
function rolesForCapabilities(capabilities: string[]): string {
  const names = EMPLOYEE_ROLES.filter((r) => capabilities.includes(r.automationCapability)).map((r) => r.name);
  return names.length > 0 ? names.join(', ') : 'nobody currently on the roles list';
}

export function updateRule(state: GameState, ruleId: ID, patch: { name?: string; enabled?: boolean; managerId?: ID; config?: AutomationRule['config'] }): RuleActionResult {
  const rule = state.player.automation.find((r) => r.id === ruleId);
  if (!rule) return { ok: false, reason: 'No such rule.' };
  if (patch.name !== undefined) rule.name = patch.name;
  if (patch.enabled !== undefined) rule.enabled = patch.enabled;
  if (patch.managerId !== undefined) {
    const manager = eligibleManagers(state, rule.kind).find((m) => m.id === patch.managerId);
    if (!manager) return { ok: false, reason: 'That employee cannot run this rule.' };
    rule.managerId = manager.id;
    rule.name = patch.name ?? `${kindLabel(rule.kind)} (${manager.name})`;
  }
  if (patch.config) rule.config = { ...rule.config, ...patch.config };
  return { ok: true, rule };
}

export function deleteRule(state: GameState, ruleId: ID): RuleActionResult {
  const rule = state.player.automation.find((r) => r.id === ruleId);
  if (!rule) return { ok: false, reason: 'No such rule.' };
  state.player.automation = state.player.automation.filter((r) => r.id !== ruleId);
  return { ok: true, rule };
}

export function kindLabel(kind: AutomationRule['kind']): string {
  switch (kind) {
    case 'auto_trade':
      return 'automated trading';
    case 'auto_resupply':
      return 'production resupply';
    case 'auto_ship':
      return 'freight dispatch';
    case 'auto_loan_repay':
      return 'debt repayment';
    case 'auto_invest':
      return 'treasury investment';
    case 'auto_launder':
      return 'cash laundering';
    case 'auto_produce':
      return 'production floor';
    case 'auto_business_sweep':
      return 'cashbox sweeping';
    case 'auto_hire':
      return 'recruitment';
    default:
      return String(kind);
  }
}

/* ------------------------------------------------------------------ */
/* Reliability model                                                   */
/* ------------------------------------------------------------------ */

export function uptimeFor(manager: EmployeeInstance | null): number {
  if (!manager) return B.automation.automationUptimeBase * 0.6;
  const skill = clamp(manager.stats.skill / 100, 0, 1);
  const morale = clamp(manager.stats.morale / 100, 0, 1);
  return round2(clamp(B.automation.automationUptimeBase + skill * 0.05 + morale * 0.03 - manager.level * -0.0008, 0.4, 0.995));
}

export function errorChanceFor(state: GameState, manager: EmployeeInstance | null): number {
  const mods = playerModifiers(state);
  const reduction = automationErrorReduction(mods);
  const base = manager
    ? B.automation.errorChanceBase - manager.level * B.automation.errorChancePerLevel - (manager.stats.skill / 100) * 0.065
    : B.automation.errorChanceBase + 0.08;
  return round2(clamp(base * (1 - reduction), 0.01, 0.6));
}

export interface DelegationLoad {
  rules: number;
  enabled: number;
  managers: number;
  rulesPerManager: number;
  capacity: number;
  overloaded: boolean;
  tiers: { tier: string; count: number; description: string }[];
}

export function delegationLoad(state: GameState): DelegationLoad {
  const rules = state.player.automation;
  const managers = new Set(rules.filter((r) => r.managerId).map((r) => r.managerId));
  const managerCount = Math.max(1, managers.size);
  const tiers = B.automation.delegationLevels.map((level, index) => ({
    tier: level,
    count:
      level === 'player'
        ? 1
        : level === 'regional_manager'
          ? state.player.crew.filter((e) => e.assignment?.tier === 3).length
          : level === 'business_manager'
            ? state.player.businesses.filter((b) => b.managerId).length
            : level === 'warehouse_manager'
              ? state.player.crew.filter((e) => e.assignment?.kind === 'warehouse' && e.assignment.tier >= 2).length
              : state.player.crew.filter((e) => e.assignment && e.assignment.tier === 1).length,
    description: TIER_DESCRIPTIONS[index] ?? '',
  }));
  return {
    rules: rules.length,
    enabled: rules.filter((r) => r.enabled).length,
    managers: managers.size,
    rulesPerManager: Math.ceil(rules.filter((r) => r.enabled).length / managerCount),
    capacity: B.automation.managerSpanOfControl,
    overloaded: Math.ceil(rules.filter((r) => r.enabled).length / managerCount) > B.automation.managerSpanOfControl,
    tiers,
  };
}

const TIER_DESCRIPTIONS = [
  'You: every decision taken by hand, nothing runs while you sleep.',
  'Regional manager: runs rules across a whole region and supervises other managers.',
  'Business manager: runs one operation, sweeps its cash and keeps it staffed.',
  'Warehouse manager: keeps stock moving — resupply, freight and storage.',
  'Worker: executes a single assignment under supervision.',
];

/* ------------------------------------------------------------------ */
/* Daily run                                                           */
/* ------------------------------------------------------------------ */

export interface AutomationTickResult {
  ran: number;
  skipped: number;
  profit: number;
  errors: number;
  results: { ruleId: ID; name: string; kind: AutomationRule['kind']; result: AutomationResult }[];
}

export function automationTick(state: GameState, rng: Rng): AutomationTickResult {
  const out: AutomationTickResult = { ran: 0, skipped: 0, profit: 0, errors: 0, results: [] };
  if (state.player.prison.incarcerated) return out; // nobody takes orders from a cell

  for (const rule of state.player.automation) {
    if (!rule.enabled) {
      out.skipped += 1;
      continue;
    }
    const manager = rule.managerId ? state.player.crew.find((e) => e.id === rule.managerId) ?? null : null;
    if (!manager || manager.status !== 'active' || manager.injured) {
      out.skipped += 1;
      rule.lastResult = {
        day: state.world.day,
        success: false,
        profit: 0,
        message: manager ? `${manager.name} is ${manager.status}${manager.injured ? ' and injured' : ''} — the rule did not run.` : 'No manager is assigned, so the rule did not run.',
        actions: [],
        errorKind: 'manager_error',
      };
      continue;
    }
    if (rule.lastRunDay !== null && state.world.day - rule.lastRunDay < cooldownFor(rule)) {
      out.skipped += 1;
      continue;
    }
    if (!rng.chance(uptimeFor(manager))) {
      out.skipped += 1;
      rule.lastResult = {
        day: state.world.day,
        success: false,
        profit: 0,
        message: `${manager.name} was unavailable today (uptime ${(uptimeFor(manager) * 100).toFixed(0)}%).`,
        actions: [],
        errorKind: 'risk_avoided',
      };
      continue;
    }

    const result = runRule(state, rng, rule, manager);
    rule.lastRunDay = state.world.day;
    rule.lastResult = result;
    rule.totalRuns += 1;
    if (result.success) {
      rule.totalProfit = round2(rule.totalProfit + result.profit);
      out.profit = round2(out.profit + result.profit);
    } else {
      rule.totalErrors += 1;
      out.errors += 1;
    }
    out.ran += 1;
    out.results.push({ ruleId: rule.id, name: rule.name, kind: rule.kind, result });
    pushDiagnostic(state, {
      system: 'automation',
      level: result.success ? 'info' : 'warn',
      message: `${rule.kind} via ${manager.name}: ${result.message}${result.actions.length > 0 ? ` [${result.actions.join('; ')}]` : ''}`,
      data: { ruleId: rule.id, profit: result.profit, success: result.success ? 1 : 0, actions: result.actions.length },
    });
  }

  if (out.ran > 0) {
    setCounter(state, 'automation_profit', round2(counter(state, 'automation_profit') + out.profit));
    setCounter(state, 'automation_runs', counter(state, 'automation_runs') + out.ran);
    if (out.errors > 0) setCounter(state, 'automation_errors', counter(state, 'automation_errors') + out.errors);
  }
  return out;
}

function cooldownFor(rule: AutomationRule): number {
  return rule.kind === 'auto_trade' ? B.automation.autoTradeCooldownDays : rule.kind === 'auto_hire' ? 2 : 1;
}

function num(config: AutomationRule['config'], key: string, fallback: number): number {
  const value = config[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(config: AutomationRule['config'], key: string, fallback: boolean): boolean {
  const value = config[key];
  return typeof value === 'boolean' ? value : fallback;
}

function str(config: AutomationRule['config'], key: string, fallback: string): string {
  const value = config[key];
  return typeof value === 'string' ? value : fallback;
}

function runRule(state: GameState, rng: Rng, rule: AutomationRule, manager: EmployeeInstance): AutomationResult {
  const errorChance = errorChanceFor(state, manager);
  const errored = rng.chance(errorChance);
  const actions: string[] = [];

  try {
    switch (rule.kind) {
      case 'auto_trade':
        return runAutoTrade(state, rng, rule, manager, actions, errored, errorChance);
      case 'auto_resupply':
        return runAutoResupply(state, rule, actions, errored, errorChance);
      case 'auto_ship':
        return runAutoShip(state, rng, rule, actions, errored, errorChance);
      case 'auto_loan_repay':
        return runAutoRepay(state, rule, actions, errored, errorChance);
      case 'auto_invest':
        return runAutoInvest(state, rng, rule, actions, errored, errorChance);
      case 'auto_launder':
        return runAutoLaunder(state, rng, rule, actions, errored, errorChance);
      case 'auto_produce':
        return runAutoProduce(state, rule, actions, errored, errorChance);
      case 'auto_business_sweep':
        return runAutoSweep(state, rule, actions, errored, errorChance);
      case 'auto_hire':
        return runAutoHire(state, rng, rule, actions, errored, errorChance);
      default:
        return { day: state.world.day, success: false, profit: 0, message: 'Unknown rule kind.', actions: [], errorKind: 'manager_error' };
    }
  } catch (error) {
    // A manager must never be able to corrupt the save: the run is abandoned and
    // reported, and the day continues.
    const message = error instanceof Error ? error.message : String(error);
    pushDiagnostic(state, {
      system: 'automation',
      level: 'error',
      message: `${rule.kind} threw and was aborted: ${message}`,
      data: { ruleId: rule.id },
    });
    return { day: state.world.day, success: false, profit: 0, message: `The run was aborted after an internal error: ${message}`, actions, errorKind: 'manager_error' };
  }
}

/**
 * Cost of a manager's mistake.
 *
 * Scaled by what the run actually put at risk (`exposure`) and hard-capped at a
 * small fraction of liquid cash. Charging a percentage of the whole treasury made
 * a single clerical error cost more than the entire trade it was running, which
 * punished delegation instead of pricing it.
 */
function managerError(
  state: GameState,
  rule: AutomationRule,
  manager: EmployeeInstance,
  actions: string[],
  message: string,
  errorKind: AutomationResult['errorKind'],
  exposure: number,
): AutomationResult {
  const treasuryCap = spendable(state.player, state.world.day, false) * 0.0025;
  const loss = round2(Math.min(Math.max(0, exposure) * B.automation.errorCostFraction, treasuryCap));
  if (loss > 1) {
    debitCash(state, loss, {
      kind: 'fee',
      description: `${manager.name} made a mistake running ${rule.name}`,
      allowDirty: false,
      meta: { ruleId: rule.id, exposure: round2(exposure), loss },
    });
  }
  return {
    day: state.world.day,
    success: false,
    profit: -loss,
    message: `${message}${loss > 1 ? ` The error cost ${formatMoney(loss)} on ${formatMoney(round2(exposure))} at risk.` : ''}`,
    actions,
    ...(errorKind ? { errorKind } : {}),
  };
}

/* ------------------------------- trading ------------------------------- */

/**
 * The trading manager runs a *route*, not a single city: it sells anything held
 * anywhere that clears the margin threshold (including freight delivered into a
 * depot in another city), then buys the best arbitrage at the player's current
 * location and dispatches it, so the cycle completes without the player having
 * to travel. Without the dispatch leg a manager would only ever accumulate stock
 * marked down by the spread.
 */
/**
 * Charge this rule for cargo it dispatched that never arrived.
 *
 * Delegated freight is the player's capital, so an intercepted or stolen shipment
 * must show up on the rule's own P/L — otherwise the automation screen reports
 * profit while the balance sheet quietly bleeds, and the player cannot tell a good
 * manager from a reckless one.
 */
function settleFreightLosses(state: GameState, rule: AutomationRule, actions: string[]): number {
  const settled = rule.settledTrackingCodes ?? (rule.settledTrackingCodes = []);
  let loss = 0;
  for (const shipment of state.player.shipments) {
    if (shipment.managedBy !== rule.id) continue;
    if (shipment.status !== 'lost' && shipment.status !== 'intercepted') continue;
    if (settled.includes(shipment.trackingCode)) continue;
    const payout = shipment.insuranceId ? round2(shipment.actualValue * B.logistics.insurancePayoutFraction) : 0;
    const net = round2(Math.max(0, shipment.actualValue - payout));
    if (net > 0) {
      loss = round2(loss + net);
      actions.push(
        `freight loss ${shipment.trackingCode} (${shipment.status}) to ${worldReg.location(shipment.destinationLocationId)?.name ?? shipment.destinationLocationId}: -${formatMoney(net)}${payout > 0 ? ` after ${formatMoney(payout)} insurance` : ', uninsured'}`,
      );
    }
    settled.push(shipment.trackingCode);
  }
  if (settled.length > 60) settled.splice(0, settled.length - 60);
  return -loss;
}

/**
 * Book freight only if the route is inside the rule's risk tolerance.
 *
 * Planning first costs nothing and lets a manager decline a run rather than walk
 * the player's capital into a border with a 60% inspection rate.
 */
function freightAcceptable(
  state: GameState,
  destinationId: ID,
  mode: TravelMode,
  items: { commodityId: ID; qty: number }[],
  maxRisk: number,
  insure: boolean,
): { ok: true; plan: ShipmentPlan } | { ok: false; reason: string } {
  const plan = planShipment(state, destinationId, mode, items, { insured: insure });
  if (!plan.ok) return { ok: false, reason: plan.reason ?? 'Freight could not be booked.' };
  if (plan.overCapacityKg > 0) {
    return { ok: false, reason: `over capacity by ${Math.round(plan.overCapacityKg).toLocaleString('en-US')} kg` };
  }
  const risk = round2(plan.detectionChance + plan.theftChance);
  if (risk > maxRisk) {
    return {
      ok: false,
      reason: `route risk ${(risk * 100).toFixed(0)}% exceeds the ${(maxRisk * 100).toFixed(0)}% tolerance (${(plan.detectionChance * 100).toFixed(0)}% inspection, ${(plan.theftChance * 100).toFixed(0)}% theft)`,
    };
  }
  return { ok: true, plan };
}

function runAutoTrade(state: GameState, rng: Rng, rule: AutomationRule, manager: EmployeeInstance, actions: string[], errored: boolean, errorChance: number): AutomationResult {
  const minMargin = num(rule.config, 'minMargin', B.automation.autoTradeMarginThreshold);
  const maxFraction = num(rule.config, 'maxCashFraction', B.automation.autoTradeMaxFractionOfCash);
  const sellHoldings = bool(rule.config, 'sellHoldings', true);
  const allowIllegal = bool(rule.config, 'allowIllegal', false);
  const maxRouteRisk = num(rule.config, 'maxRouteRisk', B.automation.autoShipMaxRisk);
  const insure = bool(rule.config, 'insure', true);
  void errorChance;

  // Cargo this rule lost in transit is charged here, not silently absorbed.
  let profit = settleFreightLosses(state, rule, actions);
  // Cash and goods this run actually put at risk — the basis for any error cost.
  let exposure = 0;

  // Positions bought or dispatched on this run are reserved for their route.
  const routed = new Set<ID>();

  /* --------------------- buy + dispatch: capture the route ---------------- */
  const opportunities = playerArbitrage(state, 8).filter((o) => {
    if (o.affordableQty <= 0 || o.netProfit <= 0) return false;
    // `allowIllegal` gates the goods, not just dirty money: an unwitting manager
    // buying contraband gets it under-declared, seized and paid out at a fraction.
    if (!allowIllegal) {
      const def = registry.get(o.commodityId);
      if (def && def.legality !== 'legal') return false;
    }
    return true;
  });
  for (const opp of opportunities) {
    if (opp.roi < minMargin) continue;
    const cash = spendable(state.player, state.world.day, true);
    const budget = cash * maxFraction;
    const qty = Math.min(opp.affordableQty, Math.max(1, Math.floor(budget / Math.max(0.01, opp.buyPrice))));
    if (qty <= 0) continue;
    const buy = executeBuy(state, { commodityId: opp.commodityId, qty, automated: true, allowDirty: allowIllegal });
    if (!buy.ok || buy.filled <= 0) continue;
    routed.add(opp.commodityId);
    const spent = round2(-buy.cashDelta);
    exposure = round2(exposure + spent);
    actions.push(`bought ${buy.filled} × ${opp.commodityName} for ${formatMoney(spent)} targeting ${worldReg.location(opp.sellLocationId)?.name ?? opp.sellLocationId} (+${(opp.roi * 100).toFixed(0)}% net)`);

    // Dispatch immediately so the position does not sit marked down by the spread.
    const held = quantityOnHand(state, opp.commodityId);
    if (held > 0 && opp.sellLocationId !== state.player.locationId) {
      const destName = worldReg.location(opp.sellLocationId)?.name ?? opp.sellLocationId;
      const items = [{ commodityId: opp.commodityId, qty: held }];
      const gate = freightAcceptable(state, opp.sellLocationId, 'truck', items, maxRouteRisk, insure);
      if (!gate.ok) {
        actions.push(`held ${held} × ${opp.commodityName} instead of dispatching to ${destName}: ${gate.reason}`);
      } else {
        const ship = sendShipment(state, rng, opp.sellLocationId, 'truck', items, { insured: insure });
        if (ship.ok && ship.shipment) {
          ship.shipment.managedBy = rule.id;
          actions.push(`dispatched ${ship.shipment.trackingCode} to ${destName} (${Math.round(ship.plan?.weightKg ?? 0)} kg, ${ship.plan?.days ?? 0} day(s), freight ${formatMoney(ship.plan?.totalCost ?? 0)}, risk ${((ship.plan?.detectionChance ?? 0) * 100).toFixed(0)}%)`);
          profit = round2(profit - (ship.plan?.totalCost ?? 0));
        } else {
          actions.push(`could not dispatch to ${destName}: ${ship.reason ?? 'no freight available'} — holding for a later run`);
        }
      }
    }
    break;
  }

  /* --------------------- sell locally: only what has no route -------------- */
  if (sellHoldings && actions.length < 4) {
    for (const locationId of storageLocations(state)) {
      const rows = marketRows(state, locationId, { onlyHoldings: true, limit: 40 });
      for (const row of rows) {
        if (row.onHand <= 0 || !row.tradable) continue;
        if (!allowIllegal && row.legality !== 'legal') continue;
        if (routed.has(row.commodityId)) continue;
        // Gate on what a fill of *this size* actually pays after impact, fees and
        // tax. The row's mark-to-market uses the marginal unit, which read "+10%
        // over cost" on orders that realised a loss — the manager was judged on a
        // number it could never collect.
        const quote = quoteSell(state, row.commodityId, row.onHand, locationId);
        if (!quote || quote.qty <= 0 || quote.total <= 0) continue;
        const basis = row.holdingCostBasis > 0 ? row.holdingCostBasis * (quote.qty / row.onHand) : 0;
        const margin = basis > 0 ? quote.total / basis - 1 : 0;
        if (margin < minMargin) continue;
        const sale = executeSell(state, { commodityId: row.commodityId, qty: quote.qty, automated: true, locationId });
        if (!sale.ok || sale.filled <= 0) continue;
        profit = round2(profit + sale.profit);
        exposure = round2(exposure + sale.cashDelta);
        const where = locationId === state.player.locationId ? 'here' : `in ${worldReg.location(locationId)?.name ?? locationId}`;
        actions.push(
          `sold ${sale.filled} × ${row.name} ${where} for ${formatMoney(sale.cashDelta)} — quoted ${(margin * 100).toFixed(1)}%, realised ${sale.profit >= 0 ? '+' : ''}${formatMoney(sale.profit)} after spread, impact and fees`,
        );
        if (actions.length >= 4) break;
      }
      if (actions.length >= 4) break;
    }
  }

  if (errored) {
    return managerError(state, rule, manager, actions, `${manager.name} misjudged the spread and paid above the market.`, 'manager_error', exposure);
  }
  if (actions.length === 0) {
    // Say which constraint actually bound, or the player cannot act on it.
    const blocked = playerArbitrage(state, 8);
    const capacityBlocked = blocked.length > 0 && blocked.every((o) => o.blocker === 'storage');
    return {
      day: state.world.day,
      success: true,
      profit: 0,
      message: capacityBlocked
        ? `${blocked.length} profitable route(s) exist but you can only carry ${Math.round(blocked[0]?.carryKg ?? 0).toLocaleString('en-US')} kg — a vehicle, warehouse or shipment capacity would unlock them.`
        : `No opportunity cleared the ${(minMargin * 100).toFixed(0)}% margin threshold today.`,
      actions: [],
      errorKind: capacityBlocked ? 'no_capacity' : 'risk_avoided',
    };
  }
  return {
    day: state.world.day,
    success: true,
    profit,
    message: `${actions.length} action(s); realised ${formatMoney(profit)}${profit <= 0 ? ' (open positions settle on delivery)' : ''}.`,
    actions,
  };
}

/** Every location where the player currently has goods in storage. */
function storageLocations(state: GameState): ID[] {
  const ids = new Set<ID>();
  for (const storage of state.player.storages) {
    if (state.player.inventory.some((i) => i.storageId === storage.id)) ids.add(storage.locationId);
  }
  ids.add(state.player.locationId);
  return [...ids];
}

/* ------------------------------ resupply ------------------------------- */

function runAutoResupply(state: GameState, rule: AutomationRule, actions: string[], errored: boolean, errorChance: number): AutomationResult {
  const daysOfCover = num(rule.config, 'daysOfCover', 4);
  const maxFraction = num(rule.config, 'maxCashFraction', 0.25);
  void errorChance;
  let spent = 0;
  const budget = spendable(state.player, state.world.day, false) * maxFraction;

  for (const line of lineViews(state)) {
    for (const input of line.inputs) {
      if (input.daysOfCover >= daysOfCover) continue;
      const need = Math.ceil(input.neededPerDay * daysOfCover - input.inBuffer);
      if (need <= 0) continue;
      if (quantityOnHand(state, input.commodityId, state.player.locationId) >= need) {
        const fed = feedInputs(state, line.id, input.commodityId, need);
        if (fed.ok) actions.push(`moved ${fed.fed} × ${input.name} into ${line.name}`);
        continue;
      }
      const affordable = Math.min(need, Math.floor((budget - spent) / Math.max(0.01, input.localPrice)));
      if (affordable <= 0) continue;
      const buy = executeBuy(state, { commodityId: input.commodityId, qty: affordable, automated: true });
      if (!buy.ok) continue;
      spent = round2(spent - buy.cashDelta);
      const fed = feedInputs(state, line.id, input.commodityId, buy.filled);
      actions.push(`bought ${buy.filled} × ${input.name} for ${formatMoney(-buy.cashDelta)} and fed ${fed.ok ? fed.fed : 0} into ${line.name}`);
      if (spent >= budget) break;
    }
    if (spent >= budget) break;
  }

  if (errored && spent > 0) {
    return {
      day: state.world.day,
      success: false,
      profit: round2(-Math.min(spent * B.automation.errorCostFraction, spendable(state.player, state.world.day, false) * 0.0025)),
      message: 'Bought the wrong grade of input; part of the spend was wasted.',
      actions,
      errorKind: 'manager_error',
    };
  }
  if (actions.length === 0) {
    return { day: state.world.day, success: true, profit: 0, message: 'All lines already have enough inputs.', actions: [], errorKind: 'risk_avoided' };
  }
  return { day: state.world.day, success: true, profit: 0, message: `${actions.length} resupply action(s); spent ${formatMoney(spent)}.`, actions };
}

/* -------------------------------- freight ------------------------------- */

function runAutoShip(state: GameState, rng: Rng, rule: AutomationRule, actions: string[], errored: boolean, errorChance: number): AutomationResult {
  const minMargin = num(rule.config, 'minMargin', 0.18);
  const maxKg = num(rule.config, 'maxKg', 2000);
  const mode = str(rule.config, 'mode', 'truck') as never;
  const insure = bool(rule.config, 'insure', true);
  const maxRouteRisk = num(rule.config, 'maxRouteRisk', B.automation.autoShipMaxRisk);
  void errorChance;

  let freightPnl = settleFreightLosses(state, rule, actions);

  const rows = marketRows(state, state.player.locationId, { onlyHoldings: true, limit: 60 });
  const candidates = rows
    .filter((r) => r.onHand > 0 && r.tradable && r.weightKg * r.onHand <= maxKg)
    .map((r) => ({ row: r, best: bestDestination(state, r.commodityId, r.price) }))
    .filter((x) => x.best !== null && x.best.margin >= minMargin)
    .sort((a, b) => (b.best?.margin ?? 0) - (a.best?.margin ?? 0));

  if (candidates.length === 0) {
    return { day: state.world.day, success: true, profit: 0, message: 'No held goods beat the freight cost by enough to ship.', actions: [], errorKind: 'risk_avoided' };
  }
  const pick = candidates[0]!;
  const qty = Math.min(pick.row.onHand, Math.max(1, Math.floor(maxKg / Math.max(0.001, pick.row.weightKg))));
  const items = [{ commodityId: pick.row.commodityId, qty }];
  const gate = freightAcceptable(state, pick.best!.locationId, mode, items, maxRouteRisk, insure);
  if (!gate.ok) {
    return {
      day: state.world.day,
      success: true,
      profit: freightPnl,
      message: `Declined to ship ${qty} × ${pick.row.name}: ${gate.reason}.`,
      actions,
      errorKind: 'risk_avoided',
    };
  }
  const shipment = sendShipment(state, rng, pick.best!.locationId, mode, items, { insured: insure });
  if (!shipment.ok) {
    return { day: state.world.day, success: false, profit: freightPnl, message: shipment.reason ?? 'Freight could not be booked.', actions, errorKind: 'no_capacity' };
  }
  if (shipment.shipment) shipment.shipment.managedBy = rule.id;
  freightPnl = round2(freightPnl - (shipment.plan?.totalCost ?? 0));
  actions.push(`shipped ${qty} × ${pick.row.name} to ${worldReg.location(pick.best!.locationId)?.name ?? pick.best!.locationId} (+${(pick.best!.margin * 100).toFixed(0)}%, freight ${formatMoney(shipment.plan?.totalCost ?? 0)}, risk ${((shipment.plan?.detectionChance ?? 0) * 100).toFixed(0)}%)`);
  if (errored) {
    const atRisk = shipment.plan?.actualValue ?? 0;
    return {
      day: state.world.day,
      success: false,
      profit: round2(freightPnl - Math.min(atRisk * B.automation.errorCostFraction, spendable(state.player, state.world.day, false) * 0.0025)),
      message: 'The manager under-declared the cargo; customs attention rose.',
      actions,
      errorKind: 'manager_error',
    };
  }
  return { day: state.world.day, success: true, profit: freightPnl, message: `${actions.length} shipment booked (${shipment.shipment?.trackingCode ?? ''}).`, actions };
}

function bestDestination(state: GameState, commodityId: ID, localPrice: number): { locationId: ID; price: number; margin: number } | null {
  let best: { locationId: ID; price: number; margin: number } | null = null;
  for (const [key, market] of orderedEntries(state.markets)) {
    if (market.commodityId !== commodityId || market.locationId === state.player.locationId) continue;
    const margin = localPrice > 0 ? market.price / localPrice - 1 : 0;
    if (margin <= 0) continue;
    // Discount by distance: a 40% spread across a continent is not the same as
    // a 40% spread next door.
    const distance = worldReg.findPath(state.player.locationId, market.locationId)?.distanceKm ?? 0;
    const netMargin = margin - Math.min(0.35, distance / 22000);
    if (!best || netMargin > best.margin) best = { locationId: market.locationId, price: market.price, margin: netMargin };
    void key;
  }
  return best;
}

/* ------------------------------ debt service ---------------------------- */

function runAutoRepay(state: GameState, rule: AutomationRule, actions: string[], errored: boolean, errorChance: number): AutomationResult {
  const reserve = num(rule.config, 'cashReserve', 25000);
  const maxApr = num(rule.config, 'maxApr', 0.08);
  void errorChance;
  const available = round2(spendable(state.player, state.world.day, false) - reserve);
  if (available <= 0) {
    return { day: state.world.day, success: true, profit: 0, message: `Cash is below the ${formatMoney(reserve)} reserve; no repayment made.`, actions: [], errorKind: 'insufficient_funds' };
  }
  const loans = state.player.loans
    .filter((l) => l.status === 'active' && l.apr >= maxApr)
    .sort((a, b) => b.apr - a.apr);
  if (loans.length === 0) {
    return { day: state.world.day, success: true, profit: 0, message: `No debt above ${(maxApr * 100).toFixed(1)}% APR.`, actions: [], errorKind: 'risk_avoided' };
  }
  let remaining = available;
  let paid = 0;
  for (const loan of loans) {
    if (remaining <= 0) break;
    const amount = round2(Math.min(remaining, loan.balance));
    const result = repayLoan(state, loan.id, amount);
    if (!result.ok) continue;
    remaining = round2(remaining - (result.repaid ?? 0));
    paid = round2(paid + (result.repaid ?? 0));
    actions.push(`repaid ${formatMoney(result.repaid ?? 0)} on the ${loan.kind} loan at ${(loan.apr * 100).toFixed(1)}%${result.settled ? ' (settled)' : ''}`);
  }
  if (errored && paid > 0) {
    return {
      day: state.world.day,
      success: false,
      profit: round2(-Math.min(paid * B.automation.errorCostFraction * 0.1, 5000)),
      message: 'A payment was sent to the wrong account and had to be recalled at a cost.',
      actions,
      errorKind: 'manager_error',
    };
  }
  return { day: state.world.day, success: true, profit: 0, message: paid > 0 ? `Repaid ${formatMoney(paid)} across ${actions.length} loan(s).` : 'Nothing to repay.', actions };
}

/* ------------------------------- treasury ------------------------------- */

function runAutoInvest(state: GameState, rng: Rng, rule: AutomationRule, actions: string[], errored: boolean, errorChance: number): AutomationResult {
  const reserve = num(rule.config, 'cashReserve', 50000);
  const minYield = num(rule.config, 'minYield', 0.025);
  const stakeCrypto = bool(rule.config, 'stakeCrypto', false);
  const maxPosition = num(rule.config, 'maxPositionFraction', 0.08);
  void rng;
  void errorChance;

  const available = round2(spendable(state.player, state.world.day, false) - reserve);
  if (available <= 0) {
    return { day: state.world.day, success: true, profit: 0, message: `Cash is below the ${formatMoney(reserve)} reserve.`, actions: [], errorKind: 'insufficient_funds' };
  }

  const market = stockMarketView(state);
  if (!market.brokerageAccountId) {
    return { day: state.world.day, success: false, profit: 0, message: 'No brokerage settlement account is linked, so nothing could be bought.', actions, errorKind: 'market_closed' };
  }
  const targets = market.all
    .filter((row) => row.status === 'active' && row.dividendYield / 100 >= minYield && row.premiumVsFair < 0.25)
    .sort((a, b) => b.dividendYield - a.dividendYield)
    .slice(0, 3);

  let committed = 0;
  for (const target of targets) {
    const budget = round2(Math.min(available - committed, available * maxPosition));
    if (budget < 100) break;
    const shares = Math.max(1, Math.floor(budget / Math.max(0.01, target.price)));
    const buy = buyShares(state, target.companyId, shares);
    if (!buy.ok) continue;
    committed = round2(committed - buy.cashDelta);
    actions.push(`bought ${buy.shares} ${target.ticker} at ${formatMoney(buy.quote?.executionPrice ?? 0)} (${target.dividendYield.toFixed(2)}% yield)`);
  }

  if (stakeCrypto) {
    const crypto = cryptoMarketView(state);
    for (const asset of crypto.assets.filter((a) => a.stakeable && a.held - a.staked > 0 && a.status === 'active').slice(0, 2)) {
      const amount = Math.min(asset.held - asset.staked, asset.held * 0.5);
      if (amount <= 0) continue;
      const staked = stake(state, asset.assetId, amount, B.crypto.stakingLockDays[B.crypto.stakingLockDays.length - 1] ?? 90);
      if (staked.ok) actions.push(`staked ${amount.toFixed(4)} ${asset.symbol} at ${((staked.apy ?? 0) * 100).toFixed(2)}% APY`);
      else if (staked.reason) actions.push(`could not stake ${asset.symbol}: ${staked.reason}`);
    }
    const idle = crypto.assets.filter((a) => a.kind === 'store_of_value' && a.held === 0 && a.change30d < -0.12);
    if (idle.length > 0 && available - committed > reserve * 0.2) {
      const target = idle[0]!;
      const buy = buyCrypto(state, rng, target.assetId, Math.max(0.0001, ((available - committed) * maxPosition) / Math.max(1e-9, target.price)));
      if (buy.ok) {
        committed = round2(committed - buy.cashDelta);
        actions.push(`bought ${buy.amount.toFixed(6)} ${target.symbol} after a ${(Math.abs(target.change30d) * 100).toFixed(0)}% 30-day drawdown`);
      }
    }
  }

  if (errored && committed > 0) {
    return {
      day: state.world.day,
      success: false,
      profit: round2(-Math.min(committed * B.automation.errorCostFraction, spendable(state.player, state.world.day, false) * 0.0025)),
      message: 'An order was entered at the wrong size and unwound at a loss.',
      actions,
      errorKind: 'manager_error',
    };
  }
  if (actions.length === 0) {
    return { day: state.world.day, success: true, profit: 0, message: `Nothing met the ${(minYield * 100).toFixed(2)}% yield and valuation screen.`, actions: [], errorKind: 'risk_avoided' };
  }
  return { day: state.world.day, success: true, profit: 0, message: `Committed ${formatMoney(committed)} across ${actions.length} position(s).`, actions };
}

/* ------------------------------ laundering ------------------------------ */

function runAutoLaunder(state: GameState, rng: Rng, rule: AutomationRule, actions: string[], errored: boolean, errorChance: number): AutomationResult {
  const minAmount = num(rule.config, 'minAmount', 5000);
  const maxHeat = num(rule.config, 'maxHeat', 55);
  void errorChance;
  if (state.player.reputation.heat > maxHeat) {
    return { day: state.world.day, success: true, profit: 0, message: `Heat ${state.player.reputation.heat.toFixed(0)} exceeds the ${maxHeat} limit — laundering paused.`, actions: [], errorKind: 'risk_avoided' };
  }
  const fronts = launderingFronts(state).filter((f) => f.usable && f.buffer < f.throughputPerDay * 3);
  if (fronts.length === 0) {
    return { day: state.world.day, success: false, profit: 0, message: 'No front has spare throughput. Open another business or wait for the buffer to clear.', actions, errorKind: 'no_capacity' };
  }
  const dirty = state.player.accounts.reduce((s, a) => s + a.dirtyBalance, 0);
  if (dirty < minAmount) {
    return { day: state.world.day, success: true, profit: 0, message: `Only ${formatMoney(dirty)} of unlaundered cash — below the ${formatMoney(minAmount)} batch minimum.`, actions: [], errorKind: 'risk_avoided' };
  }
  const front = fronts.sort((a, b) => b.throughputPerDay - a.throughputPerDay)[0]!;
  const amount = round2(Math.min(dirty, front.throughputPerDay * 2));
  const result = launder(state, rng, amount, front.businessId);
  if (!result.ok) {
    return { day: state.world.day, success: false, profit: 0, message: result.reason ?? 'Cash could not be staged.', actions, errorKind: 'insufficient_funds' };
  }
  actions.push(`staged ${formatMoney(result.staged ?? 0)} through ${front.name} (fee ~${formatMoney(result.feeEstimate ?? 0)}, ~${result.daysToClear ?? 1} day(s))`);
  if (errored) {
    return {
      day: state.world.day,
      success: false,
      profit: round2(-Math.min((result.staged ?? 0) * B.automation.errorCostFraction, 20000)),
      message: 'The deposits were structured badly and one was flagged.',
      actions,
      errorKind: 'manager_error',
    };
  }
  return { day: state.world.day, success: true, profit: 0, message: actions[0] ?? 'Nothing staged.', actions };
}

/* ------------------------------ production ------------------------------ */

function runAutoProduce(state: GameState, rule: AutomationRule, actions: string[], errored: boolean, errorChance: number): AutomationResult {
  const collect = bool(rule.config, 'collect', true);
  const restart = bool(rule.config, 'restart', true);
  void errorChance;
  for (const line of lineViews(state)) {
    if (restart && line.status === 'suspended') {
      const result = restartLine(state, line.id);
      if (result.ok) actions.push(`restarted ${line.name}`);
    }
    if (line.status === 'broken') {
      actions.push(`${line.name} is broken until day ${line.brokenUntilDay} — repairs needed`);
      continue;
    }
    if (collect) {
      const ready = line.outputs.filter((o) => o.inBuffer >= 1);
      if (ready.length > 0) {
        const result = collectOutputs(state, line.id, true);
        if (result.ok && result.collected) {
          actions.push(`collected ${result.collected.map((c) => `${c.qty} × ${c.commodityId}`).join(', ')} from ${line.name}`);
        }
      }
    }
  }
  if (errored && actions.length > 0) {
    return { day: state.world.day, success: false, profit: 0, message: 'A batch was run outside specification and had to be scrapped.', actions, errorKind: 'manager_error' };
  }
  if (actions.length === 0) {
    return { day: state.world.day, success: true, profit: 0, message: 'Nothing to collect or restart.', actions: [], errorKind: 'risk_avoided' };
  }
  return { day: state.world.day, success: true, profit: 0, message: `${actions.length} production action(s).`, actions };
}

/* ------------------------------- sweeping ------------------------------- */

function runAutoSweep(state: GameState, rule: AutomationRule, actions: string[], errored: boolean, errorChance: number): AutomationResult {
  const threshold = num(rule.config, 'threshold', 5000);
  void errorChance;
  let swept = 0;
  for (const business of businessViews(state)) {
    if (business.cashbox <= threshold) continue;
    const result = sweepCashbox(state, business.id, round2(business.cashbox - threshold * 0.5));
    if (!result.ok || !result.swept) continue;
    swept = round2(swept + result.swept);
    actions.push(`swept ${formatMoney(result.swept)} from ${business.name}`);
  }
  if (errored && swept > 0) {
    return {
      day: state.world.day,
      success: false,
      profit: round2(-Math.min(swept * B.automation.errorCostFraction, 10000)),
      message: 'A sweep was mis-recorded and part of the cash went missing.',
      actions,
      errorKind: 'manager_error',
    };
  }
  if (swept <= 0) {
    return { day: state.world.day, success: true, profit: 0, message: `No cashbox exceeded ${formatMoney(threshold)}.`, actions: [], errorKind: 'risk_avoided' };
  }
  return { day: state.world.day, success: true, profit: 0, message: `Swept ${formatMoney(swept)} from ${actions.length} business(es).`, actions };
}

/* ------------------------------ recruitment ----------------------------- */

function runAutoHire(state: GameState, rng: Rng, rule: AutomationRule, actions: string[], errored: boolean, errorChance: number): AutomationResult {
  const fillSlots = bool(rule.config, 'fillSlots', true);
  const minSkill = num(rule.config, 'minSkill', 40);
  const maxSalary = num(rule.config, 'maxSalary', 260);
  void errorChance;
  if (!fillSlots) {
    return { day: state.world.day, success: true, profit: 0, message: 'Slot filling is disabled.', actions: [], errorKind: 'risk_avoided' };
  }
  const gaps: { businessId: ID; name: string; slots: number }[] = businessViews(state)
    .filter((b) => b.staffCount < b.staffSlots)
    .map((b) => ({ businessId: b.id, name: b.name, slots: b.staffSlots - b.staffCount }));
  if (gaps.length === 0) {
    return { day: state.world.day, success: true, profit: 0, message: 'Every business is fully staffed.', actions: [], errorKind: 'risk_avoided' };
  }
  const payroll = state.player.crew.reduce((s, e) => s + e.salaryPerDay, 0);
  if (payroll > Math.max(1, state.player.businesses.reduce((s, b) => s + b.revenue30d, 0) / 30) * 0.6) {
    return { day: state.world.day, success: true, profit: 0, message: 'Payroll is already over 60% of revenue — hiring paused.', actions: [], errorKind: 'risk_avoided' };
  }

  const candidates = candidateViews(state)
    .filter((c) => c.here && c.stats.skill >= minSkill && c.salaryAskPerDay <= maxSalary && c.stats.loyalty >= 35)
    .sort((a, b) => b.valueScore - a.valueScore);

  let hired = 0;
  for (const gap of gaps) {
    for (let i = 0; i < gap.slots; i += 1) {
      const candidate = candidates.shift();
      if (!candidate) break;
      const result = hire(state, rng, candidate.id);
      if (!result.ok || !result.employee) {
        if (result.reason) actions.push(`could not hire ${candidate.name}: ${result.reason}`);
        break;
      }
      const assigned = assignEmployee(state, result.employee.id, 'business', gap.businessId);
      hired += 1;
      actions.push(`hired ${candidate.name} (${candidate.roleName}, skill ${candidate.stats.skill}) for ${gap.name}${assigned.ok ? '' : ` — assignment failed: ${assigned.reason ?? ''}`}`);
    }
  }
  if (errored && hired > 0) {
    return { day: state.world.day, success: false, profit: 0, message: 'A hire was made without checking references and left within the week.', actions, errorKind: 'manager_error' };
  }
  if (hired === 0) {
    return { day: state.world.day, success: true, profit: 0, message: 'No candidate met the skill and salary screen.', actions: [], errorKind: 'risk_avoided' };
  }
  return { day: state.world.day, success: true, profit: 0, message: `Hired ${hired} employee(s).`, actions };
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface RuleView {
  id: ID;
  name: string;
  kind: AutomationRule['kind'];
  kindLabel: string;
  enabled: boolean;
  manager: { id: ID; name: string; role: string; skill: number; morale: number; loyalty: number; salaryPerDay: number } | null;
  uptime: number;
  errorChance: number;
  errorCostFraction: number;
  config: AutomationRule['config'];
  schema: RuleConfigField[];
  lastRunDay: number | null;
  lastResult: AutomationResult | null;
  totalRuns: number;
  totalErrors: number;
  totalProfit: number;
  errorRate: number;
  createdDay: number;
  cooldownDays: number;
}

export interface AutomationView {
  rules: RuleView[];
  availableKinds: { kind: AutomationRule['kind']; label: string; configured: boolean; managerAvailable: boolean; managerName: string | null; schema: RuleConfigField[] }[];
  delegation: DelegationLoad;
  totalProfit: number;
  totalRuns: number;
  totalErrors: number;
  profitToday: number;
  automationProfitAllTime: number;
  managers: { id: ID; name: string; role: string; capability: string; skill: number; rules: number }[];
}

export function automationView(state: GameState): AutomationView {
  const rules: RuleView[] = state.player.automation.map((rule) => {
    const manager = rule.managerId ? state.player.crew.find((e) => e.id === rule.managerId) ?? null : null;
    return {
      id: rule.id,
      name: rule.name,
      kind: rule.kind,
      kindLabel: kindLabel(rule.kind),
      enabled: rule.enabled,
      manager: manager
        ? { id: manager.id, name: manager.name, role: manager.role, skill: manager.stats.skill, morale: manager.stats.morale, loyalty: manager.stats.loyalty, salaryPerDay: manager.salaryPerDay }
        : null,
      uptime: uptimeFor(manager),
      errorChance: errorChanceFor(state, manager),
      errorCostFraction: B.automation.errorCostFraction,
      config: rule.config,
      schema: ruleConfigSchema(rule.kind),
      lastRunDay: rule.lastRunDay,
      lastResult: rule.lastResult,
      totalRuns: rule.totalRuns,
      totalErrors: rule.totalErrors,
      totalProfit: rule.totalProfit,
      errorRate: rule.totalRuns > 0 ? round2(rule.totalErrors / rule.totalRuns) : 0,
      createdDay: rule.createdDay,
      cooldownDays: cooldownFor(rule),
    };
  });

  const kinds = Object.keys(CAPABILITY_FOR_KIND) as AutomationRule['kind'][];
  return {
    rules,
    availableKinds: kinds.map((kind) => {
      const managers = eligibleManagers(state, kind);
      return {
        kind,
        label: kindLabel(kind),
        configured: state.player.automation.some((r) => r.kind === kind),
        managerAvailable: managers.length > 0,
        managerName: managers.sort((a, b) => b.stats.skill - a.stats.skill)[0]?.name ?? null,
        schema: ruleConfigSchema(kind),
      };
    }),
    delegation: delegationLoad(state),
    totalProfit: round2(rules.reduce((s, r) => s + r.totalProfit, 0)),
    totalRuns: rules.reduce((s, r) => s + r.totalRuns, 0),
    totalErrors: rules.reduce((s, r) => s + r.totalErrors, 0),
    profitToday: round2(rules.reduce((s, r) => s + (r.lastResult?.day === state.world.day && r.lastResult.success ? r.lastResult.profit : 0), 0)),
    automationProfitAllTime: round2(counter(state, 'automation_profit')),
    managers: state.player.crew
      .filter((e) => {
        const role = ROLE_BY_ID[e.role];
        return role !== undefined && role.automationCapability !== 'none' && role.automationCapability !== 'combat' && role.automationCapability !== 'intel';
      })
      .map((e) => ({
        id: e.id,
        name: e.name,
        role: e.role,
        capability: ROLE_BY_ID[e.role]?.automationCapability ?? 'none',
        skill: e.stats.skill,
        rules: state.player.automation.filter((r) => r.managerId === e.id).length,
      })),
  };
}

/** Cash a manager can commit without player approval (used by the UI + guards). */
export function delegationBudget(state: GameState, rule: AutomationRule): number {
  const manager = rule.managerId ? state.player.crew.find((e) => e.id === rule.managerId) ?? null : null;
  const trust = manager ? clamp(0.25 + manager.stats.loyalty / 200 + manager.level / 120, 0.1, 0.8) : 0.1;
  return round2(spendable(state.player, state.world.day, false) * trust);
}

/** Convenience used by the daily tick report and the settings screen. */
export function automationSummaryLine(result: AutomationTickResult): string {
  if (result.ran === 0) return 'No automation ran today.';
  return `${result.ran} rule(s) ran, ${result.skipped} skipped, profit ${formatMoney(result.profit)}, ${result.errors} error(s).`;
}

/** Credit any profit the automation produced (kept explicit for auditing). */
export function recordAutomationProfit(state: GameState, amount: number): void {
  if (amount <= 0) return;
  creditCash(state, round2(amount), { kind: 'adjustment', description: 'Automated operation profit', dirty: false });
}

export function crewSkillForAutomation(state: GameState, skillId: ID): number {
  return crewSkillLevel(state, skillId);
}
