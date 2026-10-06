/**
 * Intent validation — the trust boundary.
 *
 * Everything the browser sends arrives here first. These schemas exist to make one
 * guarantee absolute: **the client never supplies a value that determines money,
 * quantity, price, odds or an outcome.** It supplies *identifiers* and *intentions*
 * ("buy 40 of commodity X", "travel to Y by truck"), and the server derives every
 * number from its own authoritative state via the quoting functions in the sim.
 *
 * That is why there is no `price`, `total`, `profit`, `chance`, `damage` or `xp`
 * field anywhere in this file. A client that invents one has it stripped by the
 * schema before the dispatcher ever sees it (spec §37 server-authoritative rules).
 */
import { z } from 'zod';
import { getBalance } from '../config/balance';

const B = getBalance();

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/** Registry/state identifier. Deliberately permissive on charset, strict on size. */
const id = z.string().trim().min(1).max(64);

/** A count of physical units. Integral, positive, and capped so a malformed
 *  payload cannot make the sim loop over an absurd quantity. */
const qty = z.number().int().min(1).max(10_000_000);

/** Currency. Non-negative and finite; NaN/Infinity are rejected explicitly
 *  because they would silently poison every downstream calculation. */
const money = z
  .number()
  .finite()
  .min(0)
  .max(1e12)
  .refine((n) => !Number.isNaN(n), 'Amount must be a number.');

/** A fraction 0…1. */
const fraction = z.number().finite().min(0).max(1);

/** Days to advance. Bounded so one interactive request cannot monopolise the server. */
const days = z.number().int().min(1).max(B.api.maxAdvanceDaysPerRequest);

const travelMode = z.enum(['foot', 'bus', 'car', 'truck', 'train', 'ferry', 'air', 'private_jet', 'cargo_ship']);
const loanKind = z.enum(['bank', 'loan_shark', 'business', 'mortgage', 'margin', 'faction']);
const collateralKind = z.enum(['property', 'vehicle', 'stock', 'crypto', 'inventory']);

/* ------------------------------------------------------------------ */
/* Intents                                                             */
/* ------------------------------------------------------------------ */

const trading = [
  /** Read-only: the server computes the quote. Costs no action point. */
  z.object({ type: z.literal('trade.quote_buy'), commodityId: id, qty }),
  z.object({ type: z.literal('trade.quote_sell'), commodityId: id, qty, locationId: id.optional() }),
  z.object({
    type: z.literal('trade.buy'),
    commodityId: id,
    qty,
    storageId: id.optional(),
    concealed: z.boolean().optional(),
    /** Hidden channels only. Spending unlaundered cash is a deliberate choice. */
    allowDirty: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('trade.sell'),
    commodityId: id,
    qty,
    includeConcealed: z.boolean().optional(),
    locationId: id.optional(),
  }),
];

const travel = [
  z.object({ type: z.literal('travel.plan'), toId: id, mode: travelMode }),
  z.object({
    type: z.literal('travel.go'),
    toId: id,
    mode: travelMode,
    bribeCustoms: z.boolean().optional(),
    crewIds: z.array(id).max(12).optional(),
    vehicleId: id.optional(),
  }),
  z.object({ type: z.literal('travel.resume') }),
  z.object({ type: z.literal('travel.abandon') }),
  z.object({ type: z.literal('travel.refuel'), vehicleId: id }),
  z.object({ type: z.literal('travel.repair_vehicle'), vehicleId: id }),
  z.object({ type: z.literal('travel.conceal'), commodityId: id, qty }),
];

const logistics = [
  z.object({ type: z.literal('logistics.buy_vehicle'), defId: id }),
  z.object({ type: z.literal('logistics.sell_vehicle'), vehicleId: id }),
  z.object({ type: z.literal('logistics.upgrade_vehicle'), vehicleId: id, upgradeId: id }),
  z.object({ type: z.literal('logistics.service_vehicle'), vehicleId: id }),
  z.object({
    type: z.literal('logistics.plan_shipment'),
    destinationId: id,
    mode: travelMode,
    items: z.array(z.object({ commodityId: id, qty })).min(1).max(40),
    insured: z.boolean().optional(),
    declaredValue: money.optional(),
    concealed: z.boolean().optional(),
    vehicleId: id.optional(),
  }),
  z.object({
    type: z.literal('logistics.send_shipment'),
    destinationId: id,
    mode: travelMode,
    items: z.array(z.object({ commodityId: id, qty })).min(1).max(40),
    insured: z.boolean().optional(),
    /**
     * Under-declaring to customs is a smuggling decision with real consequences,
     * so it is an explicit client choice — but the *risk* it buys is computed
     * server-side from the route, the cargo and the player's modifiers.
     */
    declaredValue: money.optional(),
    concealed: z.boolean().optional(),
    vehicleId: id.optional(),
    crewIds: z.array(id).max(12).optional(),
  }),
  z.object({
    type: z.literal('logistics.move_goods'),
    commodityId: id,
    qty,
    fromStorageId: id,
    toStorageId: id,
  }),
];

const finance = [
  z.object({
    type: z.literal('finance.open_account'),
    bankId: id.optional(),
    kind: z.enum(['checking', 'savings', 'offshore', 'crypto_backed', 'shell']).optional(),
    institution: id.optional(),
    locationId: id.optional(),
    initialDeposit: money.optional(),
    /** Offshore/shell accounts need a jurisdiction with bank secrecy. */
    offshore: z.boolean().optional(),
  }),
  z.object({ type: z.literal('finance.close_account'), accountId: id }),
  z.object({ type: z.literal('finance.transfer'), fromAccountId: id, toAccountId: id, amount: money }),
  z.object({ type: z.literal('finance.loan_offer'), kind: loanKind, amount: money, termDays: z.number().int().min(1).max(3650) }),
  z.object({
    type: z.literal('finance.take_loan'),
    kind: loanKind,
    amount: money,
    termDays: z.number().int().min(1).max(3650),
    collateral: z.array(z.object({ kind: collateralKind, refId: id })).max(12).optional(),
  }),
  z.object({ type: z.literal('finance.repay_loan'), loanId: id, amount: money }),
  z.object({ type: z.literal('finance.launder'), amount: money, businessId: id.optional() }),
  z.object({ type: z.literal('finance.pay_tax'), amount: money }),
];

const stocks = [
  z.object({ type: z.literal('stocks.open_account') }),
  z.object({ type: z.literal('stocks.quote'), companyId: id, shares: qty, side: z.enum(['buy', 'sell']) }),
  z.object({ type: z.literal('stocks.buy'), companyId: id, shares: qty }),
  z.object({ type: z.literal('stocks.sell'), companyId: id, shares: qty }),
];

const crypto = [
  z.object({ type: z.literal('crypto.open_account'), exchangeId: id }),
  z.object({ type: z.literal('crypto.quote'), assetId: id, amount: z.number().finite().min(0).max(1e12), side: z.enum(['buy', 'sell']), exchangeId: id.optional() }),
  z.object({
    type: z.literal('crypto.buy'),
    assetId: id,
    /** Fiat amount to spend — the server integrates the venue's book to find how
     *  many units that actually buys after slippage. */
    amount: money,
    exchangeId: id.optional(),
    custody: z.enum(['wallet', 'exchange']).optional(),
  }),
  z.object({
    type: z.literal('crypto.sell'),
    assetId: id,
    /** Units to sell. */
    amount: z.number().finite().min(0).max(1e12),
    exchangeId: id.optional(),
    custody: z.enum(['wallet', 'exchange']).optional(),
  }),
  z.object({ type: z.literal('crypto.transfer'), assetId: id, amount: z.number().finite().min(0).max(1e12), to: z.enum(['wallet', 'exchange']), exchangeId: id.optional() }),
  z.object({ type: z.literal('crypto.stake'), assetId: id, amount: z.number().finite().min(0).max(1e12), lockDays: z.number().int().min(1).max(1095) }),
  z.object({ type: z.literal('crypto.unstake'), assetId: id, amount: z.number().finite().min(0).max(1e12), early: z.boolean().optional() }),
  z.object({ type: z.literal('crypto.buy_rig'), rigId: id, propertyId: id.optional() }),
  z.object({ type: z.literal('crypto.toggle_rig'), rigId: id, active: z.boolean() }),
  z.object({ type: z.literal('crypto.repair_rig'), rigId: id }),
];

const property = [
  z.object({ type: z.literal('property.buy'), defId: id, locationId: id.optional() }),
  z.object({ type: z.literal('property.sell'), propertyId: id }),
  z.object({ type: z.literal('property.upgrade'), propertyId: id }),
  z.object({ type: z.literal('property.insure'), propertyId: id, insured: z.boolean() }),
  z.object({ type: z.literal('property.repair'), propertyId: id }),
  z.object({ type: z.literal('property.assign_staff'), propertyId: id, employeeIds: z.array(id).max(24) }),
];

const business = [
  z.object({ type: z.literal('business.open'), defId: id, propertyId: id }),
  z.object({ type: z.literal('business.close'), businessId: id }),
  z.object({ type: z.literal('business.upgrade'), businessId: id }),
  z.object({ type: z.literal('business.marketing'), businessId: id, amount: money }),
  z.object({ type: z.literal('business.sweep'), businessId: id, amount: money.optional() }),
];

const production = [
  z.object({ type: z.literal('production.install'), recipeId: id, propertyId: id }),
  z.object({ type: z.literal('production.decommission'), lineId: id }),
  z.object({ type: z.literal('production.automate'), lineId: id }),
  z.object({ type: z.literal('production.assign_workers'), lineId: id, employeeIds: z.array(id).max(40) }),
  z.object({ type: z.literal('production.assign_manager'), lineId: id, employeeId: id.nullable() }),
  z.object({ type: z.literal('production.feed'), lineId: id, commodityId: id, qty }),
  z.object({ type: z.literal('production.collect'), lineId: id, includeByproducts: z.boolean().optional() }),
  z.object({ type: z.literal('production.restart'), lineId: id }),
  z.object({ type: z.literal('production.repair'), lineId: id }),
];

const crew = [
  z.object({ type: z.literal('crew.refresh_pool') }),
  z.object({ type: z.literal('crew.hire'), candidateId: id }),
  z.object({ type: z.literal('crew.fire'), employeeId: id, severanceDays: z.number().int().min(0).max(90).optional() }),
  z.object({
    type: z.literal('crew.assign'),
    employeeId: id,
    kind: z.enum(['business', 'production', 'logistics', 'security', 'warehouse', 'trading', 'finance', 'intel', 'manager_of_managers']),
    targetId: id,
    tier: z.number().int().min(1).max(5).optional(),
    reportsTo: id.nullable().optional(),
  }),
  z.object({ type: z.literal('crew.unassign'), employeeId: id }),
  z.object({ type: z.literal('crew.train'), employeeId: id }),
  z.object({ type: z.literal('crew.promote'), employeeId: id }),
  z.object({ type: z.literal('crew.pay_wages') }),
];

const underground = [
  z.object({ type: z.literal('underground.buy_access') }),
  z.object({ type: z.literal('underground.upgrade_vpn'), targetQuality: fraction }),
  z.object({ type: z.literal('underground.discover_market'), marketId: id }),
  z.object({ type: z.literal('underground.escrow_deposit'), amount: money }),
  z.object({ type: z.literal('underground.escrow_withdraw'), amount: money }),
  z.object({ type: z.literal('underground.buy'), marketId: id, commodityId: id, qty }),
  z.object({ type: z.literal('underground.sell'), marketId: id, commodityId: id, qty }),
  z.object({ type: z.literal('underground.buy_data'), kind: z.enum(['intel', 'credentials', 'market_data', 'blueprint', 'blackmail', 'exploit', 'ledger']), targetId: id.optional() }),
  z.object({ type: z.literal('underground.sell_data'), assetId: id }),
  z.object({ type: z.literal('underground.hack'), kind: z.enum(['company', 'bank', 'exchange', 'faction', 'venue']), targetId: id }),
  z.object({ type: z.literal('underground.burn_handle') }),
  z.object({ type: z.literal('underground.buy_intel'), locationId: id }),
];

const factions = [
  z.object({ type: z.literal('faction.accept_offer'), factionId: id, offerId: id }),
  z.object({ type: z.literal('faction.decline_offer'), factionId: id, offerId: id }),
  z.object({ type: z.literal('faction.gift'), factionId: id, amount: money }),
  z.object({ type: z.literal('faction.request_service'), factionId: id, service: z.string().min(1).max(48) }),
  // `service` is checked against the faction's own service list in the dispatcher;
  // factions are data, so the valid values are not a closed compile-time union.
];

const missions = [
  z.object({ type: z.literal('mission.accept'), missionId: id }),
  z.object({ type: z.literal('mission.abandon'), missionId: id }),
];

const combat = [
  /**
   * Tactical actions. Only the *choice* comes from the client; resolution,
   * damage, odds and outcomes are all computed server-side.
   */
  z.object({
    type: z.literal('combat.take_turn'),
    actions: z
      .array(
        z.union([
          z.object({ type: z.literal('attack'), targetId: id }),
          z.object({ type: z.literal('move'), x: z.number().int().min(0).max(64), y: z.number().int().min(0).max(64) }),
          z.object({ type: z.literal('cover') }),
          z.object({ type: z.literal('flee') }),
          z.object({ type: z.literal('negotiate') }),
          z.object({ type: z.literal('intimidate') }),
          z.object({ type: z.literal('bribe'), amount: money }),
          z.object({ type: z.literal('useItem'), commodityId: id }),
          z.object({ type: z.literal('wait') }),
        ]),
      )
      .min(1)
      .max(8),
  }),
  z.object({ type: z.literal('combat.auto_resolve') }),
  z.object({ type: z.literal('combat.pay_bail') }),
  z.object({ type: z.literal('combat.escape') }),
];

const progression = [
  z.object({ type: z.literal('progression.learn_skill'), skillId: id }),
  z.object({ type: z.literal('progression.take_perk'), perkId: id }),
  z.object({ type: z.literal('progression.respec') }),
  z.object({ type: z.literal('progression.set_title'), title: z.string().trim().min(1).max(64) }),
  z.object({ type: z.literal('progression.prestige') }),
];

const automation = [
  z.object({
    type: z.literal('automation.create_rule'),
    kind: z.enum([
      'auto_trade',
      'auto_resupply',
      'auto_ship',
      'auto_loan_repay',
      'auto_invest',
      'auto_launder',
      'auto_produce',
      'auto_business_sweep',
      'auto_hire',
    ]),
    name: z.string().trim().min(1).max(80).optional(),
    managerId: id.optional(),
    /**
     * Rule configuration values are policy knobs (thresholds, toggles, caps), not
     * outcomes. The dispatcher validates each key against the rule's own schema
     * and clamps it to the published bounds, so a hostile value cannot escape the
     * range the balancing config allows.
     */
    config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).optional(),
  }),
  z.object({
    type: z.literal('automation.update_rule'),
    ruleId: id,
    name: z.string().trim().min(1).max(80).optional(),
    enabled: z.boolean().optional(),
    managerId: id.optional(),
    config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).optional(),
  }),
  z.object({ type: z.literal('automation.delete_rule'), ruleId: id }),
];

const inventory = [
  /** Move a specific stack between storage units (warehouses, vehicles, compartments). */
  z.object({ type: z.literal('inventory.move'), stackId: id, qty, toStorageId: id }),
  /**
   * Hide a stack in a concealed compartment. This is the smuggling decision: it
   * lowers inspection exposure and raises the penalty if it is found.
   */
  z.object({ type: z.literal('inventory.conceal'), stackId: id, concealed: z.boolean() }),
];

const time = [
  z.object({ type: z.literal('time.advance_day') }),
  z.object({ type: z.literal('time.advance_days'), days }),
];

/** Every intent option in one place — the union below is built from this list. */
const intentOptions = [
  ...trading,
  ...travel,
  ...logistics,
  ...finance,
  ...stocks,
  ...crypto,
  ...property,
  ...business,
  ...production,
  ...crew,
  ...underground,
  ...factions,
  ...missions,
  ...combat,
  ...progression,
  ...automation,
  ...inventory,
  ...time,
];

/**
 * zod v4 requires a non-empty *tuple*, and spreading the groups above widens to a
 * plain array. Asserting the tuple shape keeps every option's literal type intact
 * so `z.infer` still produces the real discriminated union (casting to an opaque
 * type would collapse it to `unknown`).
 */
type IntentOptionTuple = [typeof intentOptions[number], ...typeof intentOptions[number][]];

export const intentSchema = z.discriminatedUnion('type', intentOptions as IntentOptionTuple);

export type ActionIntent = z.infer<typeof intentSchema>;
export type IntentType = ActionIntent['type'];

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

export interface ParseFailure {
  ok: false;
  error: 'validation_failed';
  issues: { path: string; message: string }[];
  message: string;
}

export type ParseResult = { ok: true; intent: ActionIntent } | ParseFailure;

/**
 * Validate and narrow an untrusted payload.
 *
 * Unknown keys are stripped (zod's default) so a client cannot smuggle a
 * `price` or `profit` field past the schema by adding it to an otherwise valid
 * intent.
 */
export function parseIntent(raw: unknown): ParseResult {
  const result = intentSchema.safeParse(raw);
  if (result.success) return { ok: true, intent: result.data };
  const issues = (result.error.issues ?? []).slice(0, 12).map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
  const rawType =
    typeof raw === 'object' && raw !== null ? String((raw as Record<string, unknown>).type ?? 'unknown') : 'unknown';
  return {
    ok: false,
    error: 'validation_failed',
    issues,
    message: `Intent "${rawType}" was rejected: ${issues.map((i) => `${i.path} ${i.message}`).join('; ') || 'malformed payload'}`,
  };
}

/** Every intent type the server accepts — used by the API contract and tests. */
export const INTENT_TYPES: IntentType[] = intentOptions.map(
  (option) =>
    (option as unknown as { shape: { type: { value: string } } }).shape.type.value as IntentType,
);
