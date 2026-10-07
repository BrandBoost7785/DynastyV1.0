/**
 * Server-authoritative intent dispatcher.
 *
 * This is the only place in the codebase where a client request becomes a change
 * to game state. The rules it enforces (spec §37):
 *
 *   1. **No client number is trusted.** Payloads carry identifiers and intentions;
 *      every price, fee, odd, quantity limit and outcome is derived here from the
 *      authoritative state via the sim's own quoting functions.
 *   2. **One envelope.** Every intent returns an `ActionResult` with a
 *      machine-readable `GameErrorCode`, the notifications it produced, and an
 *      explanation trail so the UI can show *why* a value changed (spec §40).
 *   3. **Gates before effects.** Incarceration, active combat, a journey in
 *      progress and a finished game are all checked before any handler runs, so no
 *      system has to remember to check them itself.
 *   4. **Nothing throws.** A handler that fails returns `internal_error` and a
 *      diagnostic entry; a bug must never take down a request or corrupt a save.
 *
 * Action points are charged only when an attempt succeeds, so a rejected order
 * costs the player nothing — but attempts that consume in-game time regardless of
 * outcome (hacking, combat, travel) opt into `costsActionOnFailure`.
 */
import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { FACTION_BY_ID } from '../engine/registry/actors';
import { advanceDay as advanceDayImpl, advanceDays } from './tick';
import {
  consumeAction,
  formatMoney,
  hasActions,
  pushDiagnostic,
  round2,
} from './state';
import { executeBuy, executeSell, quoteBuy, quoteSell, type TradeQuote, type TradeResult } from './markets';
import {
  abandonTravel,
  concealCargo,
  executeTravel,
  planTravel,
  refuelVehicle,
  repairVehicle,
  resumeTravel,
} from './travel';
import {
  buyVehicle,
  installVehicleUpgrade,
  moveGoods,
  planShipment,
  sellVehicle,
  sendShipment,
  serviceVehicle,
} from './logistics';
import {
  closeAccount,
  launder,
  loanOffer,
  openAccount,
  payTaxArrears,
  repayLoan,
  takeLoan,
} from './finance';
import { buyShares, openBrokerageAccount, quoteShares, sellShares } from './stocks';
import {
  buyCrypto,
  buyMiningRig,
  openExchangeAccount,
  quoteCrypto,
  repairRig,
  sellCrypto,
  stake,
  toggleRig,
  transferCustody,
  unstake,
} from './crypto';
import {
  assignStaff,
  buyProperty,
  insureProperty,
  repairProperty,
  sellProperty,
  upgradeProperty,
} from './properties';
import { closeBusiness, investMarketing, openBusiness, sweepCashbox, upgradeBusiness } from './businesses';
import {
  assignLineManager,
  assignWorkers,
  automateLine,
  collectOutputs,
  decommissionLine,
  feedInputs,
  installLine,
  repairLine,
  restartLine,
} from './production';
import {
  assignEmployee,
  fire,
  hire,
  payOutstandingWages,
  promoteEmployee,
  refreshHiringPool,
  trainEmployee,
  unassignEmployee,
} from './crew';
import {
  burnHandle,
  buyDarknetAccess,
  buyDataAsset,
  buyFromVenue,
  buyLocationIntel,
  depositEscrow,
  discoverMarket,
  hack,
  sellDataAsset,
  sellToVenue,
  upgradeVpn,
  withdrawEscrow,
} from './underground';
import { acceptOffer, declineOffer, payFactionGift, requestService } from './factions';
import { abandonMission, acceptMission } from './missions';
import { attemptPrisonEscape, autoResolve, payBail, takeTurn, type TacticalAction } from './combat';
import { learnSkill, prestige, respec, respecCost, setTitle, takePerk } from './progression';
import { moveItem, setConcealed } from './inventory';
import { createRule, deleteRule, ruleConfigSchema, updateRule } from './automation';
import { transferCash } from './state';
import { parseIntent, type ActionIntent } from './validation';
import { orderedKeys } from './ordering';
import type {
  ActionWarning,
  ActionResult,
  AutomationRule,
  EmployeeAssignment,
  GameErrorCode,
  GameState,
  PlayerNotification,
  TravelMode,
} from './types';

const B = getBalance();

/* ------------------------------------------------------------------ */
/* Context and handler result                                          */
/* ------------------------------------------------------------------ */

export interface DispatchContext {
  /** Authenticated owner of this state; recorded on the audit trail. */
  userId: string;
  /** Request id, so a client can correlate a response with its audit entry. */
  requestId?: string;
  /**
   * Day advance injected for journeys that span multiple days. Defaults to the
   * real tick; tests substitute a stub.
   */
  advanceDay?: (state: GameState, rng: Rng) => void;
}

interface HandlerResult {
  ok: boolean;
  error?: GameErrorCode;
  message?: string;
  data?: unknown;
  explanations?: { label: string; detail: string }[];
  warnings?: ActionWarning[];
  /** Charge an action point even though the attempt failed (time still passed). */
  costsActionOnFailure?: boolean;
  /** Override the action-point cost (default 1, free intents 0). */
  actionCost?: number;
}

/* ------------------------------------------------------------------ */
/* Intent classification                                               */
/* ------------------------------------------------------------------ */

/**
 * Read-only intents. The server still computes them — a client asking for a quote
 * gets the server's number, never its own — but they cost no action point and are
 * permitted in every situation, including prison, because information is what a
 * locked-up player still has.
 */
const FREE_INTENTS = new Set<ActionIntent['type']>([
  'trade.quote_buy',
  'trade.quote_sell',
  'travel.plan',
  'logistics.plan_shipment',
  'finance.loan_offer',
  'stocks.quote',
  'crypto.quote',
]);

/** What a prisoner can still do: manage money, serve time, or get out. */
const PRISON_INTENTS = new Set<ActionIntent['type']>([
  'combat.pay_bail',
  'combat.escape',
  'time.advance_day',
  'time.advance_days',
  'finance.transfer',
  'finance.repay_loan',
  'finance.pay_tax',
  'finance.launder',
  'crew.pay_wages',
  'crew.fire',
  'business.sweep',
  'stocks.sell',
  'crypto.sell',
  'crypto.unstake',
  'property.sell',
  'logistics.sell_vehicle',
  'progression.learn_skill',
  'progression.take_perk',
  'automation.create_rule',
  'automation.update_rule',
  'automation.delete_rule',
]);

/** While a fight is live, only fighting and fleeing are meaningful. */
const COMBAT_INTENTS = new Set<ActionIntent['type']>([
  'combat.take_turn',
  'combat.auto_resolve',
  'combat.pay_bail',
  'combat.escape',
]);

/** While a journey is under way, only the journey exists. */
const TRAVEL_INTENTS = new Set<ActionIntent['type']>([
  'travel.resume',
  'travel.abandon',
  'time.advance_day',
  'time.advance_days',
]);

/**
 * Intents whose sim handler charges the action point itself.
 *
 * `executeBuy`/`executeSell` consume an action unless the order is flagged
 * `automated`, which is how manager orders stay free. Charging again here would
 * cost the player two actions per trade.
 */
const SELF_CHARGING = new Set<ActionIntent['type']>(['trade.buy', 'trade.sell']);

/**
 * Intents that cost no action point: information the server computes, and
 * advancing time (which is what refills the allowance in the first place).
 */
const ZERO_COST_INTENTS = new Set<ActionIntent['type']>([...FREE_INTENTS, 'time.advance_day', 'time.advance_days']);

/** Attempts that burn time whether or not they succeed. */
const COSTS_ON_FAILURE = new Set<ActionIntent['type']>(['underground.hack', 'combat.take_turn', 'combat.auto_resolve', 'combat.escape']);

const actionCostFor = (intent: ActionIntent): number =>
  ZERO_COST_INTENTS.has(intent.type) || SELF_CHARGING.has(intent.type) ? 0 : 1;

/* ------------------------------------------------------------------ */
/* Gates                                                               */
/* ------------------------------------------------------------------ */

interface GateFailure {
  ok: false;
  error: GameErrorCode;
  message: string;
}

function gateCheck(state: GameState, intent: ActionIntent): { ok: true } | GateFailure {
  if (FREE_INTENTS.has(intent.type)) return { ok: true };

  if (state.status !== 'active') {
    return {
      ok: false,
      error: 'locked',
      message: `This game has ended (${state.ending?.kind ?? state.status}). Start a new game to keep playing.`,
    };
  }

  const combat = state.player.combat;
  if (combat && combat.phase === 'active' && !COMBAT_INTENTS.has(intent.type)) {
    return {
      ok: false,
      error: 'combat_active',
      message: 'You are in the middle of an encounter. Fight, flee, talk or bribe your way out first.',
    };
  }

  if (state.player.prison.incarcerated && !PRISON_INTENTS.has(intent.type)) {
    const release = state.player.prison.releaseDay;
    return {
      ok: false,
      error: 'incarcerated',
      message: `You are held in ${state.player.prison.facility}${release !== null ? ` until day ${release}` : ''}. Pay bail, serve the time, or attempt an escape — your empire keeps running without you.`,
    };
  }

  if (state.player.travel && !TRAVEL_INTENTS.has(intent.type)) {
    return {
      ok: false,
      error: 'in_transit',
      message: `You are en route to ${state.player.travel.toLocationId}. Finish or abandon the journey before doing anything else.`,
    };
  }

  const cost = actionCostFor(intent);
  if (cost > 0 && !hasActions(state, cost)) {
    return {
      ok: false,
      error: 'rate_limited',
      message: `No actions left today (${B.player.maxActionsPerDay} per day). Advance the day to recover.`,
    };
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Envelope                                                            */
/* ------------------------------------------------------------------ */

function newNotifications(state: GameState, before: number): PlayerNotification[] {
  // Notifications are newest-first, so everything produced by this action sits at
  // the front of the array.
  const after = state.player.notifications.length;
  return after > before ? state.player.notifications.slice(0, after - before) : [];
}

function envelope(
  state: GameState,
  result: HandlerResult,
  notifications: PlayerNotification[],
  auditId?: string,
): ActionResult<unknown> {
  return {
    ok: result.ok,
    ...(result.ok ? {} : { error: result.error ?? 'action_not_permitted' }),
    ...(result.message ? { message: result.message } : {}),
    warnings: result.warnings ?? [],
    state,
    ...(result.data !== undefined ? { data: result.data } : {}),
    day: state.world.day,
    turn: state.turn,
    notifications,
    ...(auditId ? { auditId } : {}),
    ...(result.explanations && result.explanations.length > 0 ? { explanations: result.explanations } : {}),
  };
}

/**
 * Infer an API error code from a refusal message.
 *
 * Most sim functions return `{ ok, reason }` with no code, so a single static code
 * per intent was routinely wrong — "you do not own that property" arrived as
 * `insufficient_funds`, telling the client to show a money problem for a missing
 * entity. The fallback stays intent-specific; the reason overrides it when it
 * clearly says otherwise.
 */
function codeFromReason(reason: string | undefined, fallback: GameErrorCode): GameErrorCode {
  if (!reason) return fallback;
  const text = reason.toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => text.includes(n));

  if (has('cannot afford', "can't afford", 'insufficient funds', 'not enough cash', 'no funds', 'exceeds your', 'you need ¤', 'spendable cash')) {
    return 'insufficient_funds';
  }
  if (has('do not own', 'not found', 'no such', 'unknown', 'no longer', 'does not exist', 'is not listed', 'not on your books')) {
    return 'not_found';
  }
  if (has('over capacity', 'no space', 'capacity', 'no storage', 'volume', 'too heavy', 'cannot store')) return 'insufficient_capacity';
  if (has('you have no ', 'hold no', 'nothing to sell', 'nothing available', 'no goods', 'not enough ', 'no shares', 'unlocked in')) {
    return 'insufficient_goods';
  }
  if (has('already', 'no active', 'not travelling', 'no journey', 'not incarcerated', 'no wages', 'no tax arrears', 'no escrow', 'in progress', 'is frozen')) {
    return 'conflict';
  }
  if (has('requires', 'require ', 'standing', 'level ', 'not earned', 'you need darknet', 'unlocked', 'permission', 'not available to you', 'suspended')) {
    return 'unlocked_required';
  }
  if (has('no route', 'unreachable', 'no truck route', 'no bus route')) return 'no_route';
  return fallback;
}

/** Adapt the `{ ok, reason }` shape used across the sim into a handler result. */
function adapt<T extends { ok: boolean; reason?: string }>(
  result: T,
  error: GameErrorCode = 'action_not_permitted',
  extras: Partial<HandlerResult> = {},
): HandlerResult {
  return {
    ok: result.ok,
    ...(result.ok ? {} : { error: codeFromReason(result.reason, error) }),
    ...(result.reason ? { message: result.reason } : {}),
    data: result,
    ...extras,
  };
}

const denied = (error: GameErrorCode, message: string, extras: Partial<HandlerResult> = {}): HandlerResult => ({
  ok: false,
  error,
  message,
  ...extras,
});

const granted = (message: string, data?: unknown, extras: Partial<HandlerResult> = {}): HandlerResult => ({
  ok: true,
  message,
  ...(data !== undefined ? { data } : {}),
  ...extras,
});

/** Turn a trade quote into the "why this number" trail the UI renders. */
function tradeExplanations(result: TradeResult, side: 'buy' | 'sell'): { label: string; detail: string }[] {
  const quote: TradeQuote | undefined = result.quote;
  const out: { label: string; detail: string }[] = [];
  out.push({
    label: side === 'buy' ? 'Cash paid' : 'Cash received',
    detail: `${formatMoney(Math.abs(result.cashDelta))} for ${result.filled} unit(s) — ${formatMoney(quote?.netUnitPrice ?? 0)} net per unit.`,
  });
  if (quote) {
    out.push({
      label: 'Price build-up',
      detail: `Market ${formatMoney(quote.marketPrice)} → ${side === 'buy' ? 'ask' : 'bid'} ${formatMoney(quote.quotedUnitPrice)} → after your order's impact ${formatMoney(quote.effectiveUnitPrice)} → after fees and tax ${formatMoney(quote.netUnitPrice)}.`,
    });
    if (quote.impactFraction !== 0) {
      out.push({
        label: 'Market impact',
        detail: `An order of ${result.filled} unit(s) moves this market ${(quote.impactFraction * 100).toFixed(2)}%. The market absorbs ${quote.capacity.marketAbsorbable} unit(s) today before prices dislocate further.`,
      });
    }
    for (const fee of quote.fees) out.push({ label: fee.label, detail: formatMoney(fee.amount) });
    if (quote.taxTotal > 0) out.push({ label: 'Tax', detail: formatMoney(quote.taxTotal) });
    if (quote.requestedQty !== quote.qty) {
      out.push({
        label: 'Partial fill',
        detail: `You asked for ${quote.requestedQty}; ${quote.qty} was fillable given depth, cash, storage and today's trading limits.`,
      });
    }
  }
  if (side === 'sell') {
    out.push({
      label: 'Realised profit',
      detail: `${formatMoney(result.profit)} against a cost basis of ${formatMoney(result.costBasis)} (${(result.margin * 100).toFixed(1)}%).`,
    });
  }
  if (result.heat > 0) out.push({ label: 'Enforcement heat', detail: `+${result.heat.toFixed(1)} — this trade drew attention.` });
  if (result.xp > 0) out.push({ label: 'Experience', detail: `+${result.xp} XP` });
  for (const objective of result.objectiveUpdates) {
    out.push({ label: `Contract: ${objective.missionTitle}`, detail: `${objective.description} — ${objective.current}/${objective.required}` });
  }
  return out;
}

function tradeWarnings(result: TradeResult): ActionWarning[] {
  return result.warnings.map((message) => ({ code: 'trade', message, severity: 'warning' as const }));
}

/**
 * Clamp a client-supplied rule configuration to the rule's published schema.
 *
 * Policy knobs are the one place a client sends numbers, so they are validated
 * against `ruleConfigSchema`: unknown keys are dropped, numbers are clamped to
 * their declared bounds, selects must be one of the declared options.
 */
export function sanitiseRuleConfig(
  kind: AutomationRule['kind'],
  config: Record<string, string | number | boolean | string[]> | undefined,
): { config: AutomationRule['config']; rejected: string[] } {
  const schema = ruleConfigSchema(kind);
  const out: AutomationRule['config'] = {};
  const rejected: string[] = [];
  for (const field of schema) {
    const raw = config?.[field.key];
    if (raw === undefined) continue;
    if (field.type === 'boolean') {
      if (typeof raw === 'boolean') out[field.key] = raw;
      else rejected.push(`${field.key} must be true or false`);
    } else if (field.type === 'number') {
      const value = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(value)) {
        rejected.push(`${field.key} must be a number`);
        continue;
      }
      const min = field.min ?? Number.NEGATIVE_INFINITY;
      const max = field.max ?? Number.POSITIVE_INFINITY;
      out[field.key] = round2(Math.min(max, Math.max(min, value)));
    } else {
      const value = String(raw);
      if (field.options && !field.options.includes(value)) {
        rejected.push(`${field.key} must be one of ${field.options.join(', ')}`);
        continue;
      }
      out[field.key] = value;
    }
  }
  for (const key of orderedKeys(config ?? {})) {
    if (!schema.some((f) => f.key === key)) rejected.push(`${key} is not a setting for this rule`);
  }
  return { config: out, rejected };
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

function execute(state: GameState, rng: Rng, intent: ActionIntent, ctx: DispatchContext): HandlerResult {
  const advance = ctx.advanceDay ?? ((s: GameState, r: Rng) => void advanceDayImpl(s, r));

  switch (intent.type) {
    /* ------------------------------- trading ------------------------------ */
    case 'trade.quote_buy': {
      const quote = quoteBuy(state, intent.commodityId, intent.qty);
      if (!quote) return denied('market_unavailable', 'There is no market for that here, or you are not permitted to trade it.');
      return granted('Quote prepared.', quote, {
        explanations: [
          { label: 'Unit price', detail: `Market ${formatMoney(quote.marketPrice)}, ask ${formatMoney(quote.quotedUnitPrice)}, after impact ${formatMoney(quote.effectiveUnitPrice)}, all-in ${formatMoney(quote.netUnitPrice)}.` },
          { label: 'Fillable', detail: `${quote.qty} of ${intent.qty} requested — depth ${quote.capacity.marketAbsorbable}, cash ${quote.capacity.affordable < 0 ? 'unlimited' : quote.capacity.affordable}, storage ${quote.capacity.storable < 0 ? 'unlimited' : quote.capacity.storable}.` },
          ...quote.fees.map((f) => ({ label: f.label, detail: formatMoney(f.amount) })),
        ],
        warnings: quote.warnings.map((message) => ({ code: 'quote', message, severity: 'warning' as const })),
      });
    }
    case 'trade.quote_sell': {
      const quote = quoteSell(state, intent.commodityId, intent.qty, intent.locationId);
      if (!quote) return denied('market_unavailable', 'There is no market for that, or you do not hold it there.');
      return granted('Quote prepared.', quote, {
        explanations: [
          { label: 'Unit price', detail: `Market ${formatMoney(quote.marketPrice)}, bid ${formatMoney(quote.quotedUnitPrice)}, after impact ${formatMoney(quote.effectiveUnitPrice)}, net ${formatMoney(quote.netUnitPrice)}.` },
          { label: 'Fillable', detail: `${quote.qty} of ${intent.qty} requested; you hold ${quote.capacity.onHand} here and the market absorbs ${quote.capacity.marketAbsorbable} today.` },
          ...quote.fees.map((f) => ({ label: f.label, detail: formatMoney(f.amount) })),
        ],
        warnings: quote.warnings.map((message) => ({ code: 'quote', message, severity: 'warning' as const })),
      });
    }
    case 'trade.buy': {
      const result = executeBuy(state, {
        commodityId: intent.commodityId,
        qty: intent.qty,
        ...(intent.storageId ? { storageId: intent.storageId } : {}),
        concealed: intent.concealed ?? false,
        allowDirty: intent.allowDirty ?? false,
      });
      return adapt(result, codeForTrade(result.code), {
        message: result.ok ? `Bought ${result.filled} for ${formatMoney(Math.abs(result.cashDelta))}.` : result.reason,
        explanations: tradeExplanations(result, 'buy'),
        warnings: tradeWarnings(result),
      });
    }
    case 'trade.sell': {
      const result = executeSell(state, {
        commodityId: intent.commodityId,
        qty: intent.qty,
        includeConcealed: intent.includeConcealed ?? false,
        ...(intent.locationId ? { locationId: intent.locationId } : {}),
      });
      return adapt(result, codeForTrade(result.code), {
        message: result.ok ? `Sold ${result.filled} for ${formatMoney(result.cashDelta)} (${formatMoney(result.profit)} profit).` : result.reason,
        explanations: tradeExplanations(result, 'sell'),
        warnings: tradeWarnings(result),
      });
    }

    /* -------------------------------- travel ------------------------------ */
    case 'travel.plan': {
      const plan = planTravel(state, intent.toId, intent.mode as TravelMode);
      if (!plan.ok) return denied(codeForTravel(plan.code), plan.reason ?? 'That journey is not possible right now.', { data: plan });
      return granted('Route planned.', plan, {
        explanations: plan.costs.map((c) => ({ label: c.label, detail: formatMoney(c.amount) })),
        warnings: plan.warnings.map((message) => ({ code: 'route', message, severity: 'warning' as const })),
      });
    }
    case 'travel.go': {
      const result = executeTravel(state, rng, intent.toId, intent.mode as TravelMode, { advanceDay: advance }, {
        bribeCustoms: intent.bribeCustoms ?? false,
        crewIds: intent.crewIds ?? [],
        ...(intent.vehicleId ? { vehicleId: intent.vehicleId } : {}),
      });
      const explanations = [
        { label: 'Journey', detail: `${result.daysElapsed} day(s), ${Math.round(result.distanceTravelledKm).toLocaleString('en-US')} km, ${formatMoney(result.cost)}.` },
        ...result.plan.costs.map((c) => ({ label: c.label, detail: formatMoney(c.amount) })),
        ...(result.fines > 0 ? [{ label: 'Fines paid', detail: formatMoney(result.fines) }] : []),
        ...result.seizures.map((s) => ({ label: `Seized at ${s.atBorder}`, detail: `${s.qty} × ${s.name} worth ${formatMoney(s.value)}.` })),
      ];
      return adapt(result, codeForTravel(result.code), {
        message: result.ok ? (result.arrived ? `Arrived in ${result.currentLocationId}.` : 'Journey under way.') : result.reason,
        explanations,
        warnings: result.plan.warnings.map((message) => ({ code: 'route', message, severity: 'warning' as const })),
        costsActionOnFailure: true,
      });
    }
    case 'travel.resume': {
      const result = resumeTravel(state, rng, { advanceDay: advance });
      if (!result) return denied('not_found', 'There is no journey in progress.');
      return adapt(result, codeForTravel(result.code), {
        message: result.ok ? (result.arrived ? 'You arrived.' : 'Still travelling.') : result.reason,
        costsActionOnFailure: true,
      });
    }
    case 'travel.abandon': {
      const result = abandonTravel(state);
      return adapt(result, 'action_not_permitted', {
        message: result.ok ? `Journey abandoned; ${formatMoney(result.refund)} refunded on unused tickets.` : result.reason,
      });
    }
    case 'travel.refuel':
      return adapt(refuelVehicle(state, intent.vehicleId), 'action_not_permitted');
    case 'travel.repair_vehicle':
      return adapt(repairVehicle(state, intent.vehicleId), 'action_not_permitted');
    case 'travel.conceal': {
      const result = concealCargo(state, intent.commodityId, intent.qty);
      return adapt(result, 'insufficient_capacity', {
        message: result.ok ? `${result.concealed ?? 0} unit(s) hidden in a compartment.` : result.reason,
      });
    }

    /* ------------------------------ logistics ----------------------------- */
    case 'logistics.buy_vehicle': {
      const result = buyVehicle(state, rng, intent.defId);
      return adapt(result, result.reason?.includes('afford') ? 'insufficient_funds' : 'not_found', {
        message: result.ok ? `${result.vehicle?.name} acquired.` : result.reason,
      });
    }
    case 'logistics.sell_vehicle':
      return adapt(sellVehicle(state, intent.vehicleId), 'not_found');
    case 'logistics.upgrade_vehicle':
      return adapt(installVehicleUpgrade(state, intent.vehicleId, intent.upgradeId), 'not_found');
    case 'logistics.service_vehicle':
      return adapt(serviceVehicle(state, intent.vehicleId), 'not_found');
    case 'logistics.plan_shipment': {
      const plan = planShipment(state, intent.destinationId, intent.mode as TravelMode, intent.items, {
        insured: intent.insured ?? false,
        ...(intent.declaredValue !== undefined ? { declaredValue: intent.declaredValue } : {}),
        concealed: intent.concealed ?? false,
        ...(intent.vehicleId ? { vehicleId: intent.vehicleId } : {}),
      });
      if (!plan.ok) return denied(plan.overCapacityKg > 0 ? 'capacity_exceeded' : 'no_route', plan.reason ?? 'That shipment cannot be booked.', { data: plan });
      return granted('Freight costed.', plan, {
        explanations: [
          { label: 'Transit', detail: `${plan.days} day(s), ${Math.round(plan.distanceKm).toLocaleString('en-US')} km, ${plan.borderCrossings} border crossing(s).` },
          { label: 'Freight', detail: formatMoney(plan.freightCost) },
          ...(plan.insurancePremium > 0 ? [{ label: 'Insurance', detail: `${formatMoney(plan.insurancePremium)} covers ${formatMoney(plan.insuranceCover)} of ${formatMoney(plan.actualValue)}.` }] : []),
          { label: 'Risk', detail: `${(plan.detectionChance * 100).toFixed(1)}% inspection, ${(plan.theftChance * 100).toFixed(1)}% theft, ${(plan.delayChance * 100).toFixed(1)}% delay. ${formatMoney(plan.interceptionValueAtRisk)} at risk.` },
        ],
        warnings: plan.warnings.map((message) => ({ code: 'freight', message, severity: 'warning' as const })),
      });
    }
    case 'logistics.send_shipment': {
      const result = sendShipment(state, rng, intent.destinationId, intent.mode as TravelMode, intent.items, {
        insured: intent.insured ?? false,
        ...(intent.declaredValue !== undefined ? { declaredValue: intent.declaredValue } : {}),
        concealed: intent.concealed ?? false,
        ...(intent.vehicleId ? { vehicleId: intent.vehicleId } : {}),
        crewIds: intent.crewIds ?? [],
      });
      return adapt(result, result.plan && result.plan.overCapacityKg > 0 ? 'capacity_exceeded' : 'no_route', {
        message: result.ok ? `Shipment ${result.shipment?.trackingCode} booked.` : result.reason,
        explanations: result.plan
          ? [
              { label: 'Cargo', detail: `${Math.round(result.plan.weightKg).toLocaleString('en-US')} kg declared at ${formatMoney(result.plan.declaredValue)} (actual ${formatMoney(result.plan.actualValue)}).` },
              { label: 'Total cost', detail: `${formatMoney(result.plan.totalCost)} — freight ${formatMoney(result.plan.freightCost)}${result.plan.insurancePremium > 0 ? `, insurance ${formatMoney(result.plan.insurancePremium)}` : ''}.` },
              { label: 'Risk', detail: `${(result.plan.detectionChance * 100).toFixed(1)}% inspection, ${(result.plan.theftChance * 100).toFixed(1)}% theft.` },
            ]
          : [],
        warnings: (result.plan?.warnings ?? []).map((message) => ({ code: 'freight', message, severity: 'warning' as const })),
        costsActionOnFailure: true,
      });
    }
    case 'logistics.move_goods': {
      const result = moveGoods(state, intent.commodityId, intent.qty, intent.fromStorageId, intent.toStorageId);
      return adapt(result, 'storage_unsuitable', {
        message: result.ok ? `${result.moved ?? 0} unit(s) moved.` : result.reason,
      });
    }

    /* ------------------------------- finance ------------------------------ */
    case 'finance.open_account': {
      const result = openAccount(state, rng, {
        ...(intent.kind ? { kind: intent.kind } : {}),
        ...(intent.institution ? { institution: intent.institution } : {}),
        ...(intent.locationId ? { locationId: intent.locationId } : {}),
        ...(intent.initialDeposit !== undefined ? { initialDeposit: intent.initialDeposit } : {}),
        offshore: intent.offshore ?? false,
      });
      return adapt(result, 'action_not_permitted', {
        message: result.ok ? `${result.account?.institution} account opened.` : result.reason,
      });
    }
    case 'finance.close_account':
      return adapt(closeAccount(state, intent.accountId), 'not_found');
    case 'finance.transfer': {
      const move = transferCash(state, intent.fromAccountId, intent.toAccountId, intent.amount, {
        description: 'Player transfer between own accounts',
        fee: B.finance.wireFeeFlat,
      });
      return {
        ok: move.ok,
        ...(move.ok ? {} : { error: 'insufficient_funds' as GameErrorCode }),
        message: move.ok ? `${formatMoney(move.amount)} transferred.` : move.reason,
        data: move,
        explanations: move.ok
          ? [
              { label: 'Moved', detail: `${formatMoney(move.amount)} (${formatMoney(move.cleanUsed)} clean${move.dirtyUsed > 0 ? `, ${formatMoney(move.dirtyUsed)} unlaundered` : ''}).` },
              ...move.legs.map((leg) => ({
                label: `Account ${leg.accountId}`,
                detail: `${formatMoney(leg.amount)} (${formatMoney(leg.clean)} clean${leg.dirty > 0 ? `, ${formatMoney(leg.dirty)} unlaundered` : ''})`,
              })),
            ]
          : [],
      };
    }
    case 'finance.loan_offer': {
      const offer = loanOffer(state, intent.kind, intent.amount, intent.termDays);
      return offer.available
        ? granted('Offer priced.', offer, {
            explanations: [
              { label: 'Terms', detail: `${formatMoney(offer.amount)} from ${offer.lenderName} over ${offer.termDays} day(s) at ${(offer.apr * 100).toFixed(2)}% APR — ${formatMoney(offer.paymentPerDay)}/day, ${formatMoney(offer.totalRepayment)} total (${formatMoney(offer.totalInterest)} interest plus a ${formatMoney(offer.originationFee)} origination fee).` },
              { label: 'Requirements', detail: `Collateral of ${formatMoney(offer.collateralRequired)} (valued at a ${(offer.collateralHaircut * 100).toFixed(0)}% haircut), approval chance ${(offer.approvalChance * 100).toFixed(0)}%, maximum ${formatMoney(offer.maxAmount)}.` },
            ],
          })
        : denied('credit_denied', offer.reason ?? 'That loan is not available to you.', { data: offer });
    }
    case 'finance.take_loan': {
      const result = takeLoan(state, rng, intent.kind, intent.amount, intent.termDays, intent.collateral ?? []);
      return adapt(result, result.reason?.toLowerCase().includes('credit') ? 'credit_denied' : 'max_loans', {
        message: result.ok ? `Loan funded: ${formatMoney(intent.amount)}.` : result.reason,
        explanations: result.offer
          ? [{ label: 'Terms', detail: `${(result.offer.apr * 100).toFixed(2)}% APR over ${result.offer.termDays} day(s); ${formatMoney(result.offer.paymentPerDay)} per day, ${formatMoney(result.offer.totalRepayment)} in total.` }]
          : [],
      });
    }
    case 'finance.repay_loan': {
      const result = repayLoan(state, intent.loanId, intent.amount);
      return adapt(result, 'insufficient_funds', {
        message: result.ok ? `${formatMoney(result.repaid ?? 0)} repaid${result.settled ? ' — loan settled.' : '.'}` : result.reason,
      });
    }
    case 'finance.launder': {
      const result = launder(state, rng, intent.amount, intent.businessId);
      return adapt(result, 'action_not_permitted', {
        message: result.ok ? `${formatMoney(result.staged ?? 0)} staged through ${result.front ?? 'a front'}.` : result.reason,
        explanations: result.ok
          ? [
              { label: 'Fee', detail: `${formatMoney(result.feeEstimate ?? 0)} expected, clearing in about ${result.daysToClear ?? 0} day(s).` },
              { label: 'Why it takes time', detail: 'Layered deposits must survive scrutiny; clearing early is what triggers audits.' },
            ]
          : [],
      });
    }
    case 'finance.pay_tax':
      return adapt(payTaxArrears(state, intent.amount), 'insufficient_funds');

    /* -------------------------------- stocks ------------------------------ */
    case 'stocks.open_account': {
      const result = openBrokerageAccount(state);
      return adapt(result, 'action_not_permitted');
    }
    case 'stocks.quote': {
      const quote = quoteShares(state, intent.companyId, intent.shares, intent.side);
      if (!quote) return denied('not_found', 'That company is not listed, or you have no brokerage account.');
      return granted('Quote prepared.', quote);
    }
    case 'stocks.buy': {
      const result = buyShares(state, intent.companyId, intent.shares);
      return adapt(result, 'insufficient_funds');
    }
    case 'stocks.sell': {
      const result = sellShares(state, intent.companyId, intent.shares);
      return adapt(result, 'insufficient_goods');
    }

    /* -------------------------------- crypto ------------------------------ */
    case 'crypto.open_account':
      return adapt(openExchangeAccount(state, intent.exchangeId), 'not_found');
    case 'crypto.quote': {
      const quote = quoteCrypto(state, intent.assetId, intent.amount, intent.side, {
        ...(intent.exchangeId ? { exchangeId: intent.exchangeId } : {}),
      });
      if (!quote) return denied('not_found', 'Unknown asset or venue.');
      return granted('Quote prepared.', quote, {
        explanations: [
          { label: 'Execution', detail: `Market ${formatMoney(quote.marketPrice)} → average fill ${formatMoney(quote.averagePrice)} after ${(quote.slippage * 100).toFixed(3)}% integrated slippage across ${quote.exchangeName}'s book.` },
          { label: 'All-in', detail: `${formatMoney(quote.total)} for ${quote.amount} ${quote.symbol} — notional ${formatMoney(quote.notional)}, fee ${formatMoney(quote.fee)}, tax ${formatMoney(quote.tax)}.` },
          { label: 'Liquidity', detail: `${formatMoney(quote.liquidity)} on the book; this venue caps you at ${formatMoney(quote.maxNotionalToday)} of notional today.` },
        ],
      });
    }
    case 'crypto.buy': {
      const result = buyCrypto(state, rng, intent.assetId, intent.amount, {
        ...(intent.exchangeId ? { exchangeId: intent.exchangeId } : {}),
        custody: intent.custody ?? 'exchange',
      });
      return adapt(result, 'insufficient_funds');
    }
    case 'crypto.sell': {
      const result = sellCrypto(state, rng, intent.assetId, intent.amount, {
        ...(intent.exchangeId ? { exchangeId: intent.exchangeId } : {}),
        custody: intent.custody ?? 'exchange',
      });
      return adapt(result, 'insufficient_goods');
    }
    case 'crypto.transfer': {
      const result = transferCustody(state, rng, intent.assetId, intent.amount, intent.to === 'wallet' ? 'to_wallet' : 'to_exchange', intent.exchangeId);
      return adapt(result, 'insufficient_goods');
    }
    case 'crypto.stake': {
      const result = stake(state, intent.assetId, intent.amount, intent.lockDays);
      return adapt(result, 'action_not_permitted', {
        message: result.ok ? `Staked at ${(result.apy ?? 0) * 100}% APY until day ${result.untilDay ?? 0}.` : result.reason,
      });
    }
    case 'crypto.unstake': {
      const result = unstake(state, intent.assetId, intent.amount, intent.early ?? false);
      return adapt(result, 'action_not_permitted', {
        message: result.ok ? `Released${result.slashed ? ` after a ${formatMoney(result.slashed)} slash` : ''}.` : result.reason,
      });
    }
    case 'crypto.buy_rig': {
      const result = buyMiningRig(state, rng, intent.rigId, intent.propertyId);
      return adapt(result, 'insufficient_funds');
    }
    case 'crypto.toggle_rig':
      return adapt(toggleRig(state, intent.rigId, intent.active), 'not_found');
    case 'crypto.repair_rig':
      return adapt(repairRig(state, intent.rigId), 'not_found');

    /* ------------------------------ properties ---------------------------- */
    case 'property.buy': {
      const result = buyProperty(state, rng, intent.defId, intent.locationId);
      return adapt(result, 'insufficient_funds');
    }
    case 'property.sell': {
      const result = sellProperty(state, intent.propertyId);
      return adapt(result, 'not_found');
    }
    case 'property.upgrade': {
      const result = upgradeProperty(state, rng, intent.propertyId);
      return adapt(result, 'insufficient_funds');
    }
    case 'property.insure': {
      const result = insureProperty(state, intent.propertyId, intent.insured);
      return adapt(result, 'not_found', {
        message: result.ok ? (intent.insured ? `Insured at ${formatMoney(result.premiumPerDay ?? 0)}/day.` : 'Insurance cancelled.') : result.reason,
      });
    }
    case 'property.repair':
      return adapt(repairProperty(state, intent.propertyId), 'not_found');
    case 'property.assign_staff': {
      const result = assignStaff(state, intent.propertyId, intent.employeeIds);
      return adapt(result, 'not_found', { message: result.ok ? `${result.assigned ?? 0} staff assigned.` : result.reason });
    }

    /* ------------------------------ businesses ---------------------------- */
    case 'business.open': {
      const result = openBusiness(state, rng, intent.defId, intent.propertyId);
      return adapt(result, 'insufficient_funds');
    }
    case 'business.close': {
      const result = closeBusiness(state, intent.businessId);
      return adapt(result, 'not_found');
    }
    case 'business.upgrade': {
      const result = upgradeBusiness(state, intent.businessId);
      return adapt(result, 'insufficient_funds');
    }
    case 'business.marketing': {
      const result = investMarketing(state, intent.businessId, intent.amount);
      return adapt(result, 'insufficient_funds', {
        message: result.ok ? `Marketing pushed demand by ${((result.boost ?? 0) * 100).toFixed(0)}%.` : result.reason,
      });
    }
    case 'business.sweep': {
      const result = sweepCashbox(state, intent.businessId, intent.amount);
      return adapt(result, 'not_found', {
        message: result.ok ? `${formatMoney(result.swept ?? 0)} swept to your account.` : result.reason,
      });
    }

    /* ------------------------------ production ---------------------------- */
    case 'production.install': {
      const result = installLine(state, rng, intent.recipeId, intent.propertyId);
      return adapt(result, 'insufficient_funds');
    }
    case 'production.decommission': {
      const result = decommissionLine(state, intent.lineId);
      return adapt(result, 'not_found');
    }
    case 'production.automate': {
      const result = automateLine(state, intent.lineId);
      return adapt(result, 'insufficient_funds');
    }
    case 'production.assign_workers': {
      const result = assignWorkers(state, intent.lineId, intent.employeeIds);
      return adapt(result, 'not_found', { message: result.ok ? `${result.assigned ?? 0} worker(s) assigned.` : result.reason });
    }
    case 'production.assign_manager': {
      const result = assignLineManager(state, intent.lineId, intent.employeeId);
      return adapt(result, 'not_found');
    }
    case 'production.feed': {
      const result = feedInputs(state, intent.lineId, intent.commodityId, intent.qty);
      return adapt(result, 'insufficient_goods', { message: result.ok ? `${result.fed ?? 0} unit(s) fed into the line.` : result.reason });
    }
    case 'production.collect': {
      const result = collectOutputs(state, intent.lineId, intent.includeByproducts ?? false);
      return adapt(result, 'insufficient_capacity', {
        message: result.ok ? `Collected ${(result.collected ?? []).map((c) => `${c.qty} × ${c.commodityId}`).join(', ') || 'nothing'}.` : result.reason,
      });
    }
    case 'production.restart':
      return adapt(restartLine(state, intent.lineId), 'not_found');
    case 'production.repair':
      return adapt(repairLine(state, intent.lineId), 'not_found');

    /* --------------------------------- crew ------------------------------- */
    case 'crew.refresh_pool': {
      const count = refreshHiringPool(state, rng);
      return granted(`A fresh pool of ${count} candidate(s) is looking for work.`);
    }
    case 'crew.hire': {
      const result = hire(state, rng, intent.candidateId);
      return adapt(result, 'not_found', {
        message: result.ok ? `${result.employee?.name} joined as ${result.employee?.role}.` : result.reason,
      });
    }
    case 'crew.fire': {
      const result = fire(state, intent.employeeId, intent.severanceDays ?? 7);
      return adapt(result, 'not_found');
    }
    case 'crew.assign': {
      const result = assignEmployee(state, intent.employeeId, intent.kind as EmployeeAssignment['kind'], intent.targetId, intent.tier ?? 1, intent.reportsTo ?? null);
      return adapt(result, 'not_found');
    }
    case 'crew.unassign':
      return adapt(unassignEmployee(state, intent.employeeId), 'not_found');
    case 'crew.train': {
      const result = trainEmployee(state, intent.employeeId);
      return adapt(result, 'insufficient_funds', {
        message: result.ok ? `Training until day ${result.untilDay ?? 0}.` : result.reason,
      });
    }
    case 'crew.promote':
      return adapt(promoteEmployee(state, intent.employeeId), 'action_not_permitted');
    case 'crew.pay_wages': {
      const result = payOutstandingWages(state);
      return adapt(result, 'insufficient_funds', {
        message: result.ok ? `${formatMoney(result.paid ?? 0)} of back wages paid.` : result.reason,
      });
    }

    /* ----------------------------- underground ---------------------------- */
    case 'underground.buy_access': {
      const result = buyDarknetAccess(state, rng);
      return adapt(result, 'insufficient_funds', {
        message: result.ok ? `Access bought for ${formatMoney(result.cost ?? 0)}. Hidden channels are now visible.` : result.reason,
      });
    }
    case 'underground.upgrade_vpn': {
      const result = upgradeVpn(state, intent.targetQuality);
      return adapt(result, 'insufficient_funds');
    }
    case 'underground.discover_market':
      return adapt(discoverMarket(state, intent.marketId), 'unlocked_required');
    case 'underground.escrow_deposit': {
      const result = depositEscrow(state, intent.amount);
      return adapt(result, 'insufficient_funds');
    }
    case 'underground.escrow_withdraw': {
      const result = withdrawEscrow(state, intent.amount);
      return adapt(result, 'insufficient_funds');
    }
    case 'underground.buy': {
      const result = buyFromVenue(state, rng, intent.marketId, intent.commodityId, intent.qty);
      return adapt(result, 'insufficient_funds', {
        message: result.ok ? `${result.qty} unit(s) delivered for ${formatMoney(result.paid)}.` : result.reason,
        warnings: result.warnings.map((message) => ({ code: 'darknet', message, severity: 'danger' as const })),
        costsActionOnFailure: true,
      });
    }
    case 'underground.sell': {
      const result = sellToVenue(state, rng, intent.marketId, intent.commodityId, intent.qty);
      return adapt(result, 'insufficient_goods', {
        message: result.ok ? `Sold for ${formatMoney(result.proceeds ?? 0)}; heat +${(result.heat ?? 0).toFixed(1)}.` : result.reason,
      });
    }
    case 'underground.buy_data': {
      const result = buyDataAsset(state, rng, intent.kind, intent.targetId);
      return adapt(result, 'insufficient_funds', {
        message: result.ok ? `${result.asset?.name ?? 'Data asset'} acquired.` : result.reason,
      });
    }
    case 'underground.sell_data': {
      const result = sellDataAsset(state, intent.assetId);
      return adapt(result, 'not_found', {
        message: result.ok ? `Sold for ${formatMoney(result.proceeds ?? 0)}; heat +${(result.heat ?? 0).toFixed(1)}.` : result.reason,
      });
    }
    case 'underground.hack': {
      const result = hack(state, rng, intent.kind, intent.targetId);
      return adapt(result, 'action_not_permitted', {
        message: result.ok ? 'Intrusion succeeded.' : result.reason,
        costsActionOnFailure: true,
      });
    }
    case 'underground.burn_handle': {
      const result = burnHandle(state, rng);
      return adapt(result, 'action_not_permitted', {
        message: result.ok ? `New handle: ${result.newHandle}.` : result.reason,
      });
    }
    case 'underground.buy_intel': {
      const result = buyLocationIntel(state, rng, intent.locationId);
      return adapt(result, 'insufficient_funds', {
        message: result.ok ? `Intel on ${intent.locationId} bought for ${formatMoney(result.cost ?? 0)}.` : result.reason,
      });
    }

    /* ------------------------------- factions ----------------------------- */
    case 'faction.accept_offer': {
      const result = acceptOffer(state, rng, intent.factionId, intent.offerId);
      return adapt(result, 'not_found');
    }
    case 'faction.decline_offer': {
      const result = declineOffer(state, intent.factionId, intent.offerId);
      return adapt(result, 'not_found');
    }
    case 'faction.gift': {
      const result = payFactionGift(state, intent.factionId, intent.amount);
      return adapt(result, 'insufficient_funds');
    }
    case 'faction.request_service': {
      const def = FACTION_BY_ID[intent.factionId];
      if (!def) return denied('not_found', 'Unknown faction.');
      const service = def.services.find((s) => s === intent.service);
      if (!service) {
        return denied('action_not_permitted', `${def.name} does not offer "${intent.service}". They offer: ${def.services.join(', ')}.`);
      }
      const result = requestService(state, rng, intent.factionId, service);
      return adapt(result, 'unlocked_required');
    }

    /* -------------------------------- missions ---------------------------- */
    case 'mission.accept': {
      const result = acceptMission(state, intent.missionId);
      return adapt(result, 'not_found');
    }
    case 'mission.abandon': {
      const result = abandonMission(state, intent.missionId);
      return adapt(result, 'not_found');
    }

    /* -------------------------------- combat ------------------------------ */
    case 'combat.take_turn': {
      const result = takeTurn(state, rng, intent.actions as TacticalAction[]);
      return adapt(result, 'combat_active', {
        message: result.ok ? (result.finished ? 'The encounter is over.' : 'Turn resolved.') : result.reason,
        warnings: result.warnings.map((message) => ({ code: 'combat', message, severity: 'danger' as const })),
        costsActionOnFailure: true,
      });
    }
    case 'combat.auto_resolve': {
      const result = autoResolve(state, rng);
      return adapt(result, 'combat_active', {
        message: result.ok ? 'The encounter was resolved.' : result.reason,
        costsActionOnFailure: true,
      });
    }
    case 'combat.pay_bail': {
      const result = payBail(state);
      return adapt(result, 'insufficient_funds', {
        message: result.ok ? (result.released ? 'Bail posted — you are out.' : 'Bail paid.') : result.reason,
      });
    }
    case 'combat.escape': {
      const result = attemptPrisonEscape(state, rng);
      return adapt(result, 'incarcerated', {
        message: result.ok ? (result.escaped ? 'You got out.' : 'The attempt failed.') : result.reason,
        costsActionOnFailure: true,
      });
    }

    /* ----------------------------- progression ---------------------------- */
    case 'progression.learn_skill': {
      const result = learnSkill(state, intent.skillId);
      return adapt(result, 'action_not_permitted', {
        message: result.ok ? `${intent.skillId} is now level ${result.newLevel ?? 1}.` : result.reason,
      });
    }
    case 'progression.take_perk':
      return adapt(takePerk(state, intent.perkId), 'action_not_permitted');
    case 'progression.respec': {
      // The price is computed here, never taken from the client.
      const cost = respecCost(state);
      const result = respec(state, cost);
      return adapt(result, 'insufficient_funds', {
        message: result.ok ? `Loadout reset for ${formatMoney(result.cost ?? cost)}.` : result.reason,
        explanations: [{ label: 'Respec price', detail: `${formatMoney(cost)} — it rises by ${((B.progression.respecCostGrowth - 1) * 100).toFixed(0)}% each time you rebuild.` }],
      });
    }
    case 'progression.set_title':
      return adapt(setTitle(state, intent.title), 'unlocked_required');
    case 'progression.prestige': {
      const result = prestige(state);
      return adapt(result, 'action_not_permitted');
    }

    /* ------------------------------ automation ---------------------------- */
    case 'automation.create_rule': {
      const sanitised = sanitiseRuleConfig(intent.kind, intent.config);
      const result = createRule(state, rng, intent.kind, {
        ...(intent.name ? { name: intent.name } : {}),
        ...(intent.managerId ? { managerId: intent.managerId } : {}),
        config: sanitised.config,
      });
      return adapt(result, 'action_not_permitted', {
        message: result.ok ? `${result.rule?.name ?? intent.kind} is now running.` : result.reason,
        warnings: sanitised.rejected.map((message) => ({ code: 'config', message, severity: 'info' as const })),
      });
    }
    case 'automation.update_rule': {
      const rule = state.player.automation.find((r) => r.id === intent.ruleId);
      if (!rule) return denied('not_found', 'No such rule.');
      const sanitised = intent.config ? sanitiseRuleConfig(rule.kind, intent.config) : { config: undefined, rejected: [] };
      const result = updateRule(state, intent.ruleId, {
        ...(intent.name !== undefined ? { name: intent.name } : {}),
        ...(intent.enabled !== undefined ? { enabled: intent.enabled } : {}),
        ...(intent.managerId !== undefined ? { managerId: intent.managerId } : {}),
        ...(sanitised.config ? { config: { ...rule.config, ...sanitised.config } } : {}),
      });
      return adapt(result, 'action_not_permitted', {
        warnings: sanitised.rejected.map((message) => ({ code: 'config', message, severity: 'info' as const })),
      });
    }
    case 'automation.delete_rule': {
      const result = deleteRule(state, intent.ruleId);
      return adapt(result, 'not_found');
    }

    /* ------------------------------- inventory ---------------------------- */
    case 'inventory.move': {
      const result = moveItem(state, intent.stackId, intent.qty, intent.toStorageId);
      return {
        ok: result.ok,
        ...(result.ok ? {} : { error: 'storage_unsuitable' as GameErrorCode }),
        ...(result.message ? { message: result.message } : {}),
        data: result,
        explanations: result.ok
          ? [{ label: 'Moved', detail: `${result.moved ?? 0} unit(s) into ${intent.toStorageId}. Goods only trade from storage at the location they sit in.` }]
          : [],
      };
    }
    case 'inventory.conceal': {
      const result = setConcealed(state, intent.stackId, intent.concealed);
      return {
        ok: result.ok,
        ...(result.ok ? {} : { error: 'storage_unsuitable' as GameErrorCode }),
        ...(result.message ? { message: result.message } : {}),
        data: result,
        explanations: result.ok
          ? [
              {
                label: intent.concealed ? 'Concealed' : 'Exposed',
                detail: intent.concealed
                  ? 'Hidden cargo is much harder for inspectors to find, but discovery is treated as deliberate smuggling: heavier fines, seizure and heat.'
                  : 'Concealed cargo is visible to customs again and trades normally.',
              },
            ]
          : [],
      };
    }

    /* --------------------------------- time ------------------------------- */
    case 'time.advance_day': {
      const report = advanceDayImpl(state, rng);
      return granted(`Day ${state.world.day}.`, report, {
        actionCost: 0,
        explanations: report.phases
          .filter((phase) => phase.metrics.length > 0)
          .slice(0, 12)
          .map((phase) => ({ label: phase.phase, detail: phase.summary })),
      });
    }
    case 'time.advance_days': {
      const report = advanceDays(state, rng, intent.days, { stopOnCombat: true });
      return granted(`Advanced ${report.days} day(s) to day ${state.world.day}${report.stoppedEarly ? ` (stopped early: ${report.stopReason ?? 'interrupted'})` : ''}.`, report, {
        actionCost: 0,
        explanations: report.highlights.slice(0, 12).map((phase) => ({ label: phase.phase, detail: phase.summary })),
      });
    }

    default: {
      // Exhaustiveness guard: adding an intent without a handler is a compile error.
      const unhandled: never = intent;
      return denied('invalid_input', `Unhandled intent: ${JSON.stringify((unhandled as ActionIntent).type)}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Error code mapping                                                  */
/* ------------------------------------------------------------------ */

/**
 * Map the sim's own refusal codes onto the API's `GameErrorCode`.
 *
 * Every code the trading layer can emit is listed explicitly, because the client
 * keys its messaging off these: an unmapped code would silently degrade into a
 * generic "not permitted" and the player would never learn that the real problem
 * is a level requirement, a closed border or a lot too small to cover its fees.
 */
function codeForTrade(code?: string): GameErrorCode {
  switch (code) {
    case 'insufficient_funds':
    case 'payment_failed':
    case 'daily_limit':
      return 'insufficient_funds';
    case 'no_storage':
    case 'storage_full':
    case 'insufficient_capacity':
      return 'insufficient_capacity';
    case 'no_goods':
    case 'not_held':
    case 'insufficient_qty':
    case 'removal_failed':
      return 'insufficient_goods';
    case 'no_market':
    case 'not_stocked':
    case 'closed':
    case 'no_fill':
    case 'instrument_only':
      return 'market_unavailable';
    // Soft gates: always unlockable, never a dead end (spec §21).
    case 'locked_level':
    case 'locked_reputation':
    case 'locked_skill':
    case 'locked_perk':
    case 'locked_faction':
    case 'locked_discovery':
    case 'requires_darknet':
    case 'requires_underground_access':
      return 'unlocked_required';
    case 'undiscovered':
    case 'unknown_commodity':
    case 'unknown_location':
      return 'not_found';
    case 'lockdown':
    case 'border_closed':
      return 'locked';
    case 'no_actions':
    case 'daily_trade_limit':
      return 'rate_limited';
    case 'below_minimum':
      // The lot is too small to clear its own charges — a quantity problem the
      // player can fix, not a permissions problem.
      return 'invalid_input';
    case 'not_permitted':
    case 'illegal':
      return 'illegal_in_jurisdiction';
    default:
      return 'action_not_permitted';
  }
}

function codeForTravel(code?: string): GameErrorCode {
  switch (code) {
    case 'unreachable':
    case 'mode_unavailable':
      return 'no_route';
    case 'no_vehicle':
      return 'insufficient_capacity';
    case 'skill_required':
      return 'unlocked_required';
    case 'lockdown':
    case 'border_closed':
      return 'locked';
    case 'undiscovered':
    case 'not_discovered':
      return 'not_found';
    case 'insufficient_funds':
      return 'insufficient_funds';
    default:
      return 'action_not_permitted';
  }
}

/* ------------------------------------------------------------------ */
/* Public entry points                                                 */
/* ------------------------------------------------------------------ */

/**
 * Validate an untrusted payload and dispatch it.
 *
 * This is what a route handler calls: `dispatchRaw(state, rng, await req.json(), ctx)`.
 */
export function dispatchRaw(state: GameState, rng: Rng, raw: unknown, ctx: DispatchContext): ActionResult<unknown> {
  const parsed = parseIntent(raw);
  if (!parsed.ok) {
    return envelope(
      state,
      { ok: false, error: parsed.error, message: parsed.message, warnings: parsed.issues.slice(0, 6).map((i) => ({ code: 'validation', message: `${i.path}: ${i.message}`, severity: 'info' as const })) },
      [],
    );
  }
  return dispatch(state, rng, parsed.intent, ctx);
}

/**
 * Dispatch an already-validated intent.
 *
 * Mutates `state` in place and returns the standard envelope including the new
 * notifications and the audit id recorded against this operation.
 */
export function dispatch(state: GameState, rng: Rng, intent: ActionIntent, ctx: DispatchContext): ActionResult<unknown> {
  const notificationsBefore = state.player.notifications.length;
  const auditId = `act_${state.world.day}_${state.turn}_${intent.type.replace(/\W/g, '_')}`;

  const gate = gateCheck(state, intent);
  if (!gate.ok) {
    pushDiagnostic(state, {
      system: 'actions',
      message: `${intent.type} refused: ${gate.message}`,
      level: 'warn',
      data: { intent: intent.type, code: gate.error, userId: ctx.userId },
    });
    return envelope(state, denied(gate.error, gate.message), newNotifications(state, notificationsBefore), auditId);
  }

  let result: HandlerResult;
  try {
    result = execute(state, rng, intent, ctx);
  } catch (error) {
    // A bug must never reach the client as a stack trace, and must never leave the
    // caller without an envelope.
    const message = error instanceof Error ? error.message : String(error);
    pushDiagnostic(state, {
      system: 'actions',
      message: `${intent.type} threw: ${message}`,
      level: 'error',
      data: { intent: intent.type, userId: ctx.userId, requestId: ctx.requestId ?? null },
    });
    return envelope(
      state,
      { ok: false, error: 'internal_error', message: 'That action could not be completed. The incident was logged.', warnings: [] },
      newNotifications(state, notificationsBefore),
      auditId,
    );
  }

  const cost = result.actionCost ?? actionCostFor(intent);
  const shouldCharge = cost > 0 && (result.ok || result.costsActionOnFailure || COSTS_ON_FAILURE.has(intent.type));
  if (shouldCharge && !consumeAction(state, cost)) {
    // Another gate consumed the day's actions between the check and the charge.
    return envelope(
      state,
      denied('rate_limited', 'No actions left today.'),
      newNotifications(state, notificationsBefore),
      auditId,
    );
  }

  state.turn += 1;
  pushDiagnostic(state, {
    system: 'actions',
    message: `${intent.type} ${result.ok ? 'ok' : `failed (${result.error ?? 'refused'})`}${result.message ? `: ${result.message}` : ''}`,
    level: result.ok ? 'info' : 'warn',
    data: {
      intent: intent.type,
      ok: result.ok ? 1 : 0,
      userId: ctx.userId,
      ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
    },
  });

  return envelope(state, result, newNotifications(state, notificationsBefore), auditId);
}

/**
 * Intents that are safe to call while the game is over or the player is locked
 * out — used by the API layer to decide whether to short-circuit.
 */
export function isFreeIntent(type: ActionIntent['type']): boolean {
  return FREE_INTENTS.has(type);
}
