/**
 * Dispatcher integration tests.
 *
 * The point of this file is not to re-test each gameplay system — those have their
 * own coverage — but to prove the *authority boundary* holds: every intent the API
 * accepts has a handler, nothing a client sends can set a price or an outcome, the
 * global gates fire before effects, and no intent can throw its way out of the
 * request handler.
 */
import { describe, expect, it } from 'vitest';
import { COMPANIES, CRYPTO_ASSETS, CRYPTO_EXCHANGES, FACTIONS } from '../src/engine/registry/actors';
import { PERKS, SKILLS } from '../src/engine/registry/people';
import { getCommodityRegistry, getWorldRegistry } from '../src/engine/registry';
import { dispatch, dispatchRaw, sanitiseRuleConfig } from '../src/sim/actions';
import { INTENT_TYPES, parseIntent, type ActionIntent } from '../src/sim/validation';
import { createNewGame } from '../src/sim/bootstrap';
import { rngForDay } from '../src/sim/tick';
import { creditCash, totalBalance } from '../src/sim/state';
import { candidateViews, hire, refreshHiringPool } from '../src/sim/crew';
import { buyDataAsset, darknetMarketViews } from '../src/sim/underground';
import { buyMiningRig, rigCatalogue } from '../src/sim/crypto';
import { missionBoard, rollMissionOffers } from '../src/sim/missions';
import { availableRecipes, installLine } from '../src/sim/production';
import { businessCatalogue, openBusiness } from '../src/sim/businesses';
import { buyProperty, propertyListings } from '../src/sim/properties';
import { buyVehicle, vehicleListings } from '../src/sim/logistics';
import { executeBuy, marketRows } from '../src/sim/markets';
import { moveItem } from '../src/sim/inventory';
import { openBrokerageAccount } from '../src/sim/stocks';
import { openAccount, takeLoan } from '../src/sim/finance';
import { openExchangeAccount } from '../src/sim/crypto';
import { buyDarknetAccess } from '../src/sim/underground';
import { startCombat } from '../src/sim/combat';
import type { GameState } from '../src/sim/types';

const worldReg = getWorldRegistry();
const commodityReg = getCommodityRegistry();

/** Roles that can run trading automation, so `automation.create_rule` has a manager. */
const TRADING_ROLES = ['trader', 'broker', 'accountant', 'financial_specialist'];

/**
 * A state with a real operating company behind it: rolling stock, premises that can
 * actually host a shop and a production line, staff who can be delegated to, stock
 * to ship, accounts, a loan, a rig and contracts on the board. Fixtures read their
 * ids from this, so every intent is dispatched against an entity that exists.
 */
function richState(seed = 'dispatcher-test'): GameState {
  const { state } = createNewGame({ userId: 'u', playerName: 'Tester', seed });
  const rng = rngForDay(state, 1);
  creditCash(state, 25_000_000, { kind: 'adjustment', description: 'test capital', dirty: false });

  openAccount(state, rng, { kind: 'savings' });
  openBrokerageAccount(state);
  openExchangeAccount(state, CRYPTO_EXCHANGES[0]!.id);
  buyDarknetAccess(state, rng);

  // A van, not a bicycle: freight and travel intents need real carrying capacity.
  const van = vehicleListings(state).find((v) => v.defId === 'panel_van') ?? vehicleListings(state).find((v) => v.defId === 'pickup');
  if (van) buyVehicle(state, rng, van.defId);
  // A second, deliberately empty vehicle: `logistics.sell_vehicle` refuses to sell
  // one with cargo aboard, and the van is about to be loaded.
  const spare = vehicleListings(state).find((v) => v.defId === 'bicycle');
  if (spare) buyVehicle(state, rng, spare.defId);

  // Premises chosen for what they enable: production tags for a line, and a
  // business type the catalog says can actually open here.
  const listings = propertyListings(state);
  const industrial = listings.find((l) => (l.productionTags?.length ?? 0) > 0 || (l.recipesEnabled ?? 0) > 0);
  const retail = listings.find((l) => l.staffSlots > 0 && l.kind !== 'residential');
  for (const listing of [industrial, retail]) {
    if (listing) buyProperty(state, rng, listing.defId);
  }

  const openable = businessCatalogue(state).filter((b) => b.canOpen);
  for (const business of openable.slice(0, 2)) {
    const premises = business.suitableProperties.find((p) => p.free) ?? business.suitableProperties[0];
    if (premises) openBusiness(state, rng, business.defId, premises.id);
  }

  for (const recipe of availableRecipes(state, { onlyInstallable: true }).slice(0, 2)) {
    const premises = recipe.propertyOptions.find((p) => p.free) ?? recipe.propertyOptions[0];
    if (premises) installLine(state, rng, recipe.recipeId, premises.propertyId);
  }

  // Hire somebody who can be delegated to first, then fill out the roster.
  refreshHiringPool(state, rng);
  const trading = candidateViews(state).find((c) => c.here && TRADING_ROLES.includes(c.role));
  if (trading) hire(state, rng, trading.id);
  // One more, and no further: the span of control is four direct reports, and the
  // `crew.hire` fixture needs room to actually hire somebody.
  const second = candidateViews(state).find((c) => c.here && c.id !== trading?.id);
  if (second) hire(state, rng, second.id);

  // Stock to ship and sell, so freight intents are not refused for want of cargo.
  const held = tradableCommodity(state);
  executeBuy(state, { commodityId: held, qty: 40, automated: true });

  // Some of it goes in the van's hidden compartment: concealment only works where
  // a compartment exists, and personal storage has none.
  const compartment = state.player.storages.find((u) => (u.hiddenCompartmentKg ?? 0) > 0);
  const bought = state.player.inventory.find((i) => i.commodityId === held);
  if (compartment && bought) moveItem(state, bought.id, Math.min(bought.qty, 10), compartment.id);

  // Work for the repair and sweep intents to actually do: a brand-new property is
  // already in good condition and a brand-new shop has an empty cashbox, so both
  // would (correctly) refuse as no-ops.
  const damaged = state.player.properties[0];
  if (damaged) {
    damaged.condition = 0.7;
    damaged.damagedUntilDay = state.world.day + 10;
  }
  const shop = state.player.businesses[0];
  if (shop) shop.cashbox = 8000;

  // Entities several intents need: a loan to repay, a rig to toggle, a data asset
  // to sell, contracts on the board.
  for (const amount of [20_000, 5_000, 1_000]) {
    if (takeLoan(state, rng, 'bank', amount, 90).ok) break;
  }
  const rig = rigCatalogue(state)[0];
  if (rig) buyMiningRig(state, rng, rig.id, state.player.properties[0]?.id);
  buyDataAsset(state, rng, 'intel');
  rollMissionOffers(state, rng);

  return state;
}

/**
 * A legal commodity traded here that a level-1 player may actually buy, whose unit
 * value clears the flat settlement fee at small quantities and whose weight fits
 * the player's carrying capacity.
 */
function tradableCommodity(state: GameState): string {
  const here = state.player.locationId;
  const rows = marketRows(state, here, { limit: 400 })
    .filter((row) => row.tradable && row.legality === 'legal' && row.price >= 20 && row.weightKg * 40 <= 500)
    .sort((a, b) => b.price - a.price);
  return rows[0]?.commodityId ?? commodityReg.all()[0]!.id;
}

function otherLocation(state: GameState): string {
  const here = state.player.locationId;
  const reachable = worldReg.locations.find((l) => l.id !== here && !l.hidden);
  return reachable?.id ?? here;
}

/** One plausible payload per intent, built from live state and registry ids. */
function fixtures(state: GameState): Record<string, unknown> {
  const commodityId = state.player.inventory[0]?.commodityId ?? tradableCommodity(state);
  const destinationId = otherLocation(state);
  const accountId = state.player.accounts[0]?.id ?? 'acc_missing';
  const secondAccountId = state.player.accounts[1]?.id ?? accountId;
  const employeeId = state.player.crew[0]?.id ?? 'emp_missing';
  const vehicleId = state.player.vehicles[0]?.id ?? 'veh_missing';
  // A vehicle with nothing loaded, so the sell fixture is not refused for cargo.
  const storageByVehicle = new Map(
    state.player.storages.filter((u) => u.vehicleId).map((u) => [u.vehicleId as string, u.id]),
  );
  const emptyVehicleId =
    state.player.vehicles.find((v) => {
      const sid = storageByVehicle.get(v.id);
      return !sid || !state.player.inventory.some((i) => i.storageId === sid);
    })?.id ?? vehicleId;
  const propertyId = state.player.properties[0]?.id ?? 'prop_missing';
  const sellablePropertyId =
    state.player.properties.find((p) => p.businessId === null && !state.player.productionLines.some((l) => l.propertyId === p.id))?.id ??
    propertyId;
  const businessId = state.player.businesses[0]?.id ?? 'biz_missing';
  const lineId = state.player.productionLines[0]?.id ?? 'line_missing';
  const storageId = state.player.storages[0]?.id ?? 'sto_missing';
  const secondStorageId = state.player.storages.find((s) => s.id !== storageId)?.id ?? storageId;
  const missionId = missionBoard(state).offers[0]?.id ?? state.player.missions[0]?.id ?? 'msn_missing';
  const marketId = darknetMarketViews(state)[0]?.id ?? 'mkt_missing';
  const factionId = FACTIONS[0]!.id;
  const offerId = state.world.factions[factionId]?.pendingOffers[0]?.id ?? 'off_missing';
  const dataAssetId = state.player.underground.dataAssets[0]?.id ?? 'dat_missing';
  const loanId = state.player.loans[0]?.id ?? 'loan_missing';
  const rigId = state.player.miningRigs[0]?.id ?? rigCatalogue(state)[0]?.id ?? 'rig_missing';
  const vehicleDefId = 'panel_van';
  const upgradeId = 'roof_rack';
  const propertyDefId = propertyListings(state).find((l) => l.kind !== 'residential')?.defId ?? 'warehouse_small';
  const openableBusiness = businessCatalogue(state).find((b) => b.canOpen) ?? businessCatalogue(state)[0];
  const businessDefId = openableBusiness?.defId ?? 'corner_shop';
  const businessPremisesId = openableBusiness?.suitableProperties.find((p) => p.free)?.id ?? propertyId;
  const installable = availableRecipes(state, { onlyInstallable: true })[0] ?? availableRecipes(state)[0];
  const recipeId = installable?.recipeId ?? 'ready_garments';
  const recipePremisesId = installable?.propertyOptions.find((p) => p.free)?.propertyId ?? propertyId;
  const candidateId = candidateViews(state).find((c) => c.here)?.id ?? 'cand_missing';
  const ruleId = state.player.automation[0]?.id ?? 'rule_missing';
  const stackId = state.player.inventory[0]?.id ?? 'stk_missing';
  const compartmentId = state.player.storages.find((u) => (u.hiddenCompartmentKg ?? 0) > 0)?.id;
  const concealedStackId =
    (compartmentId ? state.player.inventory.find((i) => i.storageId === compartmentId) : undefined)?.id ?? stackId;
  const stakeable = CRYPTO_ASSETS.find((a) => a.stakeable)?.id ?? CRYPTO_ASSETS[0]!.id;
  const assetId = CRYPTO_ASSETS[0]!.id;

  return {
    'trade.quote_buy': { type: 'trade.quote_buy', commodityId, qty: 10 },
    'trade.quote_sell': { type: 'trade.quote_sell', commodityId, qty: 5 },
    'trade.buy': { type: 'trade.buy', commodityId, qty: 2 },
    'trade.sell': { type: 'trade.sell', commodityId, qty: 5 },
    'travel.plan': { type: 'travel.plan', toId: destinationId, mode: 'truck' },
    'travel.go': { type: 'travel.go', toId: destinationId, mode: 'truck' },
    'travel.resume': { type: 'travel.resume' },
    'travel.abandon': { type: 'travel.abandon' },
    'travel.refuel': { type: 'travel.refuel', vehicleId },
    'travel.repair_vehicle': { type: 'travel.repair_vehicle', vehicleId },
    'travel.conceal': { type: 'travel.conceal', commodityId, qty: 1 },
    'logistics.buy_vehicle': { type: 'logistics.buy_vehicle', defId: vehicleDefId },
    'logistics.sell_vehicle': { type: 'logistics.sell_vehicle', vehicleId: emptyVehicleId },
    'logistics.upgrade_vehicle': { type: 'logistics.upgrade_vehicle', vehicleId, upgradeId },
    'logistics.service_vehicle': { type: 'logistics.service_vehicle', vehicleId },
    'logistics.plan_shipment': { type: 'logistics.plan_shipment', destinationId, mode: 'truck', items: [{ commodityId, qty: 5 }] },
    'logistics.send_shipment': { type: 'logistics.send_shipment', destinationId, mode: 'truck', items: [{ commodityId, qty: 5 }], insured: true },
    'logistics.move_goods': { type: 'logistics.move_goods', commodityId, qty: 1, fromStorageId: storageId, toStorageId: secondStorageId },
    'finance.open_account': { type: 'finance.open_account', kind: 'savings' },
    'finance.close_account': { type: 'finance.close_account', accountId: secondAccountId },
    'finance.transfer': { type: 'finance.transfer', fromAccountId: accountId, toAccountId: secondAccountId, amount: 10 },
    'finance.loan_offer': { type: 'finance.loan_offer', kind: 'bank', amount: 5000, termDays: 90 },
    'finance.take_loan': { type: 'finance.take_loan', kind: 'bank', amount: 5000, termDays: 90 },
    'finance.repay_loan': { type: 'finance.repay_loan', loanId, amount: 100 },
    'finance.launder': { type: 'finance.launder', amount: 1000 },
    'finance.pay_tax': { type: 'finance.pay_tax', amount: 100 },
    'stocks.open_account': { type: 'stocks.open_account' },
    'stocks.quote': { type: 'stocks.quote', companyId: COMPANIES[0]!.id, shares: 10, side: 'buy' },
    'stocks.buy': { type: 'stocks.buy', companyId: COMPANIES[0]!.id, shares: 10 },
    'stocks.sell': { type: 'stocks.sell', companyId: COMPANIES[0]!.id, shares: 5 },
    'crypto.open_account': { type: 'crypto.open_account', exchangeId: CRYPTO_EXCHANGES[1]?.id ?? CRYPTO_EXCHANGES[0]!.id },
    'crypto.quote': { type: 'crypto.quote', assetId, amount: 100, side: 'buy' },
    'crypto.buy': { type: 'crypto.buy', assetId, amount: 100 },
    'crypto.sell': { type: 'crypto.sell', assetId, amount: 0.001 },
    'crypto.transfer': { type: 'crypto.transfer', assetId, amount: 0.001, to: 'wallet' },
    'crypto.stake': { type: 'crypto.stake', assetId: stakeable, amount: 0.001, lockDays: 30 },
    'crypto.unstake': { type: 'crypto.unstake', assetId: stakeable, amount: 0.001 },
    'crypto.buy_rig': { type: 'crypto.buy_rig', rigId },
    'crypto.toggle_rig': { type: 'crypto.toggle_rig', rigId, active: false },
    'crypto.repair_rig': { type: 'crypto.repair_rig', rigId },
    'property.buy': { type: 'property.buy', defId: propertyDefId },
    'property.sell': { type: 'property.sell', propertyId: sellablePropertyId },
    'property.upgrade': { type: 'property.upgrade', propertyId },
    'property.insure': { type: 'property.insure', propertyId, insured: true },
    'property.repair': { type: 'property.repair', propertyId },
    'property.assign_staff': { type: 'property.assign_staff', propertyId, employeeIds: [employeeId] },
    'business.open': { type: 'business.open', defId: businessDefId, propertyId: businessPremisesId },
    'business.close': { type: 'business.close', businessId },
    'business.upgrade': { type: 'business.upgrade', businessId },
    'business.marketing': { type: 'business.marketing', businessId, amount: 500 },
    'business.sweep': { type: 'business.sweep', businessId },
    'production.install': { type: 'production.install', recipeId, propertyId: recipePremisesId },
    'production.decommission': { type: 'production.decommission', lineId },
    'production.automate': { type: 'production.automate', lineId },
    'production.assign_workers': { type: 'production.assign_workers', lineId, employeeIds: [employeeId] },
    'production.assign_manager': { type: 'production.assign_manager', lineId, employeeId },
    'production.feed': { type: 'production.feed', lineId, commodityId, qty: 1 },
    'production.collect': { type: 'production.collect', lineId },
    'production.restart': { type: 'production.restart', lineId },
    'production.repair': { type: 'production.repair', lineId },
    'crew.refresh_pool': { type: 'crew.refresh_pool' },
    'crew.hire': { type: 'crew.hire', candidateId },
    'crew.fire': { type: 'crew.fire', employeeId },
    'crew.assign': { type: 'crew.assign', employeeId, kind: 'business', targetId: businessId },
    'crew.unassign': { type: 'crew.unassign', employeeId },
    'crew.train': { type: 'crew.train', employeeId },
    'crew.promote': { type: 'crew.promote', employeeId },
    'crew.pay_wages': { type: 'crew.pay_wages' },
    'underground.buy_access': { type: 'underground.buy_access' },
    'underground.upgrade_vpn': { type: 'underground.upgrade_vpn', targetQuality: 0.6 },
    'underground.discover_market': { type: 'underground.discover_market', marketId },
    'underground.escrow_deposit': { type: 'underground.escrow_deposit', amount: 500 },
    'underground.escrow_withdraw': { type: 'underground.escrow_withdraw', amount: 100 },
    'underground.buy': { type: 'underground.buy', marketId, commodityId, qty: 1 },
    'underground.sell': { type: 'underground.sell', marketId, commodityId, qty: 1 },
    'underground.buy_data': { type: 'underground.buy_data', kind: 'intel' },
    'underground.sell_data': { type: 'underground.sell_data', assetId: dataAssetId },
    'underground.hack': { type: 'underground.hack', kind: 'company', targetId: COMPANIES[0]!.id },
    'underground.burn_handle': { type: 'underground.burn_handle' },
    'underground.buy_intel': { type: 'underground.buy_intel', locationId: destinationId },
    'faction.accept_offer': { type: 'faction.accept_offer', factionId, offerId },
    'faction.decline_offer': { type: 'faction.decline_offer', factionId, offerId },
    'faction.gift': { type: 'faction.gift', factionId, amount: 500 },
    'faction.request_service': { type: 'faction.request_service', factionId, service: FACTIONS[0]!.services[0] ?? 'smuggling' },
    'mission.accept': { type: 'mission.accept', missionId },
    'mission.abandon': { type: 'mission.abandon', missionId },
    'combat.take_turn': { type: 'combat.take_turn', actions: [{ type: 'wait' }] },
    'combat.auto_resolve': { type: 'combat.auto_resolve' },
    'combat.pay_bail': { type: 'combat.pay_bail' },
    'combat.escape': { type: 'combat.escape' },
    'progression.learn_skill': { type: 'progression.learn_skill', skillId: SKILLS[0]!.id },
    'progression.take_perk': { type: 'progression.take_perk', perkId: PERKS[0]!.id },
    'progression.respec': { type: 'progression.respec' },
    'progression.set_title': { type: 'progression.set_title', title: 'Trader' },
    'progression.prestige': { type: 'progression.prestige' },
    'automation.create_rule': { type: 'automation.create_rule', kind: 'auto_trade', config: { minMargin: 0.1 } },
    'automation.update_rule': { type: 'automation.update_rule', ruleId, enabled: false },
    'automation.delete_rule': { type: 'automation.delete_rule', ruleId },
    'inventory.move': { type: 'inventory.move', stackId, qty: 1, toStorageId: compartmentId ?? secondStorageId },
    'inventory.conceal': { type: 'inventory.conceal', stackId: concealedStackId, concealed: true },
    'time.advance_day': { type: 'time.advance_day' },
    'time.advance_days': { type: 'time.advance_days', days: 2 },
  };
}

describe('intent validation', () => {
  it('recognises every intent the dispatcher claims to handle', () => {
    expect(INTENT_TYPES.length).toBeGreaterThanOrEqual(95);
    for (const type of INTENT_TYPES) {
      // The discriminator must always be recognised: either the intent takes no
      // fields at all (so a bare type parses), or the only complaints are about
      // the missing payload — never about the type itself.
      const parsed = parseIntent({ type });
      if (!parsed.ok) {
        expect(parsed.error).toBe('validation_failed');
        expect(parsed.issues.every((i) => i.path !== 'type')).toBe(true);
      }
    }
  });

  it('rejects unknown intents', () => {
    const result = parseIntent({ type: 'money.print', amount: 1e9 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('validation_failed');
  });

  it('strips client-supplied money fields', () => {
    const result = parseIntent({ type: 'trade.buy', commodityId: 'x', qty: 1, price: 0.01, profit: 9e9, xp: 5000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intent).not.toHaveProperty('price');
      expect(result.intent).not.toHaveProperty('profit');
      expect(result.intent).not.toHaveProperty('xp');
    }
  });

  it('rejects impossible quantities and non-finite money', () => {
    expect(parseIntent({ type: 'trade.buy', commodityId: 'x', qty: 0 }).ok).toBe(false);
    expect(parseIntent({ type: 'trade.buy', commodityId: 'x', qty: -40 }).ok).toBe(false);
    expect(parseIntent({ type: 'trade.buy', commodityId: 'x', qty: 1.5 }).ok).toBe(false);
    expect(parseIntent({ type: 'finance.repay_loan', loanId: 'l', amount: Number.NaN }).ok).toBe(false);
    expect(parseIntent({ type: 'finance.repay_loan', loanId: 'l', amount: Number.POSITIVE_INFINITY }).ok).toBe(false);
  });

  it('clamps rule configuration to the published schema', () => {
    const { config, rejected } = sanitiseRuleConfig('auto_trade', {
      minMargin: 99,
      maxCashFraction: -5,
      sellHoldings: 'yes' as unknown as boolean,
      madeUpKey: 1,
    });
    expect(config.minMargin).toBe(1);
    expect(config.maxCashFraction).toBe(0.02);
    expect(config.sellHoldings).toBeUndefined();
    expect(rejected.some((r) => r.includes('madeUpKey'))).toBe(true);
    expect(rejected.some((r) => r.includes('sellHoldings'))).toBe(true);
  });
});

describe('dispatcher', () => {
  /**
   * Robustness, not outcomes: whatever the game state, an intent must be handled,
   * must not throw, and must come back as a well-formed envelope. Most refusals
   * here are *correct* ("you are not incarcerated", "there is no journey in
   * progress") — the invariant is that none of them is an unhandled intent or a
   * crash, and that the error code is always a real one.
   */
  it('handles every intent without throwing or falling through', () => {
    const problems: string[] = [];
    const codes = new Set<string>();

    for (const type of INTENT_TYPES) {
      // A fresh state per intent keeps them independent: several are destructive
      // (fire the crew, sell the van, delete the rule) and order would otherwise
      // decide the outcome. Fixtures are built from *that* state, because entity
      // ids are generated per game.
      const fresh = richState(`dispatch-${type}`);
      const payload = fixtures(fresh)[type];
      if (!payload) {
        problems.push(`${type}: no fixture`);
        continue;
      }
      const result = dispatch(fresh, rngForDay(fresh, 1), payload as ActionIntent, { userId: 'u' });

      if (result.error === 'invalid_input') problems.push(`${type}: unhandled by the dispatcher`);
      if (result.error === 'internal_error') problems.push(`${type}: threw — ${result.message}`);
      if (result.error) codes.add(result.error);
      if (typeof result.day !== 'number' || typeof result.turn !== 'number') problems.push(`${type}: malformed envelope`);
      if (!Array.isArray(result.notifications) || !Array.isArray(result.warnings)) problems.push(`${type}: envelope missing collections`);
      if (!result.ok && !result.message) problems.push(`${type}: refused without telling the player why`);
    }

    expect(problems).toEqual([]);
    // Every code returned must be one the API contract publishes.
    const published = new Set([
      'invalid_input', 'not_authenticated', 'not_found', 'conflict', 'insufficient_funds', 'insufficient_capacity',
      'insufficient_goods', 'market_unavailable', 'illegal_in_jurisdiction', 'locked', 'in_transit', 'incarcerated',
      'rate_limited', 'combat_active', 'no_route', 'max_loans', 'credit_denied', 'validation_failed', 'state_corrupt',
      'save_conflict', 'internal_error', 'action_not_permitted', 'cooldown_active', 'capacity_exceeded',
      'unlocked_required', 'storage_unsuitable',
    ]);
    expect([...codes].filter((c) => !published.has(c))).toEqual([]);
  });

  /** Happy paths: with a functioning company behind it, these must work. */
  it('executes the core loop end to end', () => {
    const mustSucceed = [
      'trade.quote_buy', 'trade.quote_sell', 'trade.buy',
      'finance.open_account', 'finance.transfer', 'finance.loan_offer', 'finance.repay_loan',
      'stocks.open_account', 'stocks.quote', 'stocks.buy',
      'crypto.open_account', 'crypto.quote', 'crypto.buy',
      'property.buy', 'property.upgrade', 'property.insure', 'property.repair',
      'logistics.buy_vehicle', 'logistics.sell_vehicle', 'logistics.service_vehicle', 'logistics.upgrade_vehicle',
      'crew.refresh_pool', 'crew.hire', 'crew.fire', 'crew.train', 'crew.unassign',
      'underground.upgrade_vpn', 'underground.escrow_deposit', 'underground.buy_data', 'underground.sell_data',
      'underground.burn_handle',
      'faction.gift', 'mission.accept',
      'progression.learn_skill', 'progression.respec',
      'inventory.conceal',
      'time.advance_day', 'time.advance_days',
    ];
    const failures: string[] = [];
    for (const type of mustSucceed) {
      const fresh = richState(`happy-${type}`);
      const payload = fixtures(fresh)[type];
      const result = dispatch(fresh, rngForDay(fresh, 1), payload as ActionIntent, { userId: 'u' });
      if (!result.ok) failures.push(`${type}: ${result.error} — ${result.message}`);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('never lets a client-set price change what it pays', () => {
    const state = richState();
    const rng = rngForDay(state, 1);
    const commodityId = tradableCommodity(state);
    const before = totalBalance(state.player);

    const result = dispatchRaw(state, rng, { type: 'trade.buy', commodityId, qty: 5, price: 0.01, total: 0.05 }, { userId: 'u' });

    expect(result.ok).toBe(true);
    const spent = before - totalBalance(state.player);
    expect(spent).toBeGreaterThan(0.05); // the injected ¤0.01/unit was ignored
    const quote = (result.data as { quote?: { total?: number } } | undefined)?.quote;
    if (quote?.total !== undefined) expect(Math.abs(spent - quote.total)).toBeLessThan(0.01);
  });

  it('charges action points for effects but not for information', () => {
    const state = richState();
    const rng = rngForDay(state, 1);
    const commodityId = tradableCommodity(state);
    const actions = state.player.stats.actionsToday;

    dispatch(state, rng, { type: 'trade.quote_buy', commodityId, qty: 3 } as ActionIntent, { userId: 'u' });
    expect(state.player.stats.actionsToday).toBe(actions);

    const buy = dispatch(state, rng, { type: 'trade.buy', commodityId, qty: 1 } as ActionIntent, { userId: 'u' });
    expect(buy.ok).toBe(true);
    expect(state.player.stats.actionsToday).toBe(actions - 1);
  });

  it('refuses everything meaningful once the day is spent', () => {
    const state = richState();
    const rng = rngForDay(state, 1);
    state.player.stats.actionsToday = 0;
    const result = dispatch(state, rng, { type: 'crew.refresh_pool' } as ActionIntent, { userId: 'u' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('rate_limited');
  });

  it('locks the world down while incarcerated but never permanently', () => {
    const state = richState();
    const rng = rngForDay(state, 1);
    state.player.prison.incarcerated = true;
    state.player.prison.releaseDay = state.world.day + 30;
    state.player.prison.facility = 'Test Facility';

    const trade = dispatch(state, rng, { type: 'trade.buy', commodityId: tradableCommodity(state), qty: 1 } as ActionIntent, { userId: 'u' });
    expect(trade.ok).toBe(false);
    expect(trade.error).toBe('incarcerated');

    // Reading still works, and so does getting out — the player is never locked
    // out of the systems that end the lockout.
    const quote = dispatch(state, rng, { type: 'trade.quote_buy', commodityId: tradableCommodity(state), qty: 1 } as ActionIntent, { userId: 'u' });
    expect(quote.ok).toBe(true);
    const bail = dispatch(state, rng, { type: 'combat.pay_bail' } as ActionIntent, { userId: 'u' });
    expect(bail.error).not.toBe('incarcerated');
    const day = dispatch(state, rng, { type: 'time.advance_day' } as ActionIntent, { userId: 'u' });
    expect(day.ok).toBe(true);
  });

  it('restricts actions to the fight while combat is active', () => {
    const state = richState();
    const rng = rngForDay(state, 1);
    startCombat(state, rng, { kind: 'ambush', table: 'street_thugs', enemyCount: [1, 2], stakes: 'medium', reason: 'test', seedLabel: 'test' });
    if (!state.player.combat || state.player.combat.phase !== 'active') return; // auto-resolved: nothing to gate

    const trade = dispatch(state, rng, { type: 'trade.buy', commodityId: tradableCommodity(state), qty: 1 } as ActionIntent, { userId: 'u' });
    expect(trade.error).toBe('combat_active');

    const resolve = dispatch(state, rng, { type: 'combat.auto_resolve' } as ActionIntent, { userId: 'u' });
    expect(resolve.error).not.toBe('combat_active');
  });

  it('refuses to keep playing a finished game', () => {
    const state = richState();
    const rng = rngForDay(state, 1);
    state.status = 'lost';
    const result = dispatch(state, rng, { type: 'crew.refresh_pool' } as ActionIntent, { userId: 'u' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('locked');
  });

  it('records an audit trail for every dispatched intent', () => {
    const state = richState();
    const rng = rngForDay(state, 1);
    const before = state.diagnostics.length;
    dispatch(state, rng, { type: 'crew.refresh_pool' } as ActionIntent, { userId: 'u', requestId: 'req-1' });
    expect(state.diagnostics.length).toBeGreaterThan(before);
    const entry = state.diagnostics[state.diagnostics.length - 1]!;
    expect(entry.system).toBe('actions');
    expect(entry.data?.intent).toBe('crew.refresh_pool');
  });

  it('returns a well-formed envelope for a malformed payload', () => {
    const state = richState();
    const rng = rngForDay(state, 1);
    const result = dispatchRaw(state, rng, { type: 'trade.buy' }, { userId: 'u' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('validation_failed');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.day).toBe(state.world.day);
  });

  it('advances time through the dispatcher and resets the day', () => {
    const state = richState();
    const rng = rngForDay(state, 1);
    state.player.stats.actionsToday = 0;
    const day = state.world.day;
    const result = dispatch(state, rng, { type: 'time.advance_day' } as ActionIntent, { userId: 'u' });
    expect(result.ok).toBe(true);
    expect(state.world.day).toBe(day + 1);
    expect(state.player.stats.actionsToday).toBeGreaterThan(0);
  });

  it('keeps money conserved across a dispatcher round trip', () => {
    const state = richState();
    const rng = rngForDay(state, 1);
    const commodityId = tradableCommodity(state);
    const before = totalBalance(state.player);

    const buy = dispatch(state, rng, { type: 'trade.buy', commodityId, qty: 4 } as ActionIntent, { userId: 'u' });
    expect(buy.ok, buy.message ?? '').toBe(true);
    const afterBuy = totalBalance(state.player);
    expect(afterBuy).toBeLessThan(before);

    const sell = dispatch(state, rng, { type: 'trade.sell', commodityId, qty: 4 } as ActionIntent, { userId: 'u' });
    expect(sell.ok, sell.message ?? '').toBe(true);
    const afterSell = totalBalance(state.player);
    expect(afterSell).toBeGreaterThan(afterBuy);
    // The spread is the house edge: a buy/sell round trip must never be free money.
    expect(afterSell).toBeLessThan(before);
  });

  it('refuses a lot too small to cover its own fees instead of paying the player to sell', () => {
    const state = richState();
    const rng = rngForDay(state, 1);
    // Bulk water is cheap: one unit cannot clear the flat settlement fee.
    const cheap = commodityReg.all().find((c) => c.legality === 'legal' && c.baseValue < 2 && c.id.includes('bulk'));
    if (!cheap) return;
    const buy = dispatch(state, rng, { type: 'trade.buy', commodityId: cheap.id, qty: 1 } as ActionIntent, { userId: 'u' });
    if (!buy.ok) return;
    const quote = dispatch(state, rng, { type: 'trade.quote_sell', commodityId: cheap.id, qty: 1 } as ActionIntent, { userId: 'u' });
    const data = quote.data as { total?: number; netUnitPrice?: number; breakEvenQty?: number | null } | undefined;
    expect(data?.total ?? 0).toBeGreaterThanOrEqual(0);
    expect(data?.netUnitPrice ?? 0).toBeGreaterThanOrEqual(0);
    expect(data?.breakEvenQty ?? 0).toBeGreaterThan(1);
  });
});
