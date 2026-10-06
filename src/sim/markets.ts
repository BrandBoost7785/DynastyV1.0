/**
 * Markets — lazy materialisation, quoting, and the authoritative trade engine.
 *
 * This is the module that moves goods and money in the commodity economy. It
 * owns three responsibilities the rest of the codebase must not duplicate:
 *
 *  1. **Materialisation.** Only markets the player can actually see or touch are
 *     instantiated (spec §51 performance requirement for 763 SKUs × 48 cities).
 *     Materialisation is deterministic, so two saves with the same seed see the
 *     same prices.
 *  2. **Quoting.** Every quote is depth-aware: the price you pay depends on how
 *     much you move, the more dislocated the print the fewer counterparties will
 *     absorb, and the spread narrows with trading/negotiation skill. Quotes are
 *     pure — they never mutate state — so the UI can show live numbers.
 *  3. **Execution.** Money moves only through `debitCash`/`creditCash`, goods
 *     only through the inventory module, market state only through
 *     `tradeImpact`. Failures mutate nothing (plan → validate → apply).
 *
 * Trading is never hard-locked: goods a jurisdiction does not tolerate are still
 * reachable through black-market or darknet channels once the player has access,
 * at worse prices, higher fees and real heat.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { getWorldRegistry } from '../engine/registry/world';
import { fnv1aHex } from '../lib/hash';
import {
  analyseMarket,
  createMarketState,
  marketKey,
  quotedPrices,
  scanArbitrage,
  stepMarket,
  tradeImpact,
  type ArbitrageOpportunity,
  type MarketAnalytics,
  type MarketContext,
} from './economy';
import { addItem, canStore, portableCapacityKg, quantityOnHand, removeCommodity, storagesAtLocation, type StorageProblem } from './inventory';
import { priceImpactReduction, spreadReduction, taxReduction } from './modifiers';
import { recordObjective } from './missions';
import { bumpCounter, counter, grantXp, maxCounter, playerModifiers, setCounter, xpFromTradeProfit } from './progression';
import { addHeat, addTraceHeat, changeReputation } from './reputation';
import {
  consumeAction,
  creditCash,
  debitCash,
  formatMoney,
  hasActions,
  pushDiagnostic,
  pushNotification,
  round2,
  spendable,
} from './state';
import type { CommodityDef, GameState, ID, LocationDef, LocationState, MarketState, ReputationDimension } from './types';

const B = getBalance();
const worldReg = getWorldRegistry();
const registry = getCommodityRegistry();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Fraction of a market's supply a single player order may absorb per day. */
const ABSORB_FRACTION = 0.25;

/* ------------------------------------------------------------------ */
/* Materialisation                                                     */
/* ------------------------------------------------------------------ */

export function marketContext(state: GameState): MarketContext {
  const locations = new Map<ID, LocationDef>();
  const locationStates = new Map<ID, LocationState>();
  for (const l of worldReg.locations) {
    locations.set(l.id, l);
    const ls = state.world.locations[l.id];
    if (ls) locationStates.set(l.id, ls);
  }
  return { world: state.world, locations, locationStates };
}

export function marketAt(state: GameState, locationId: ID, commodityId: ID): MarketState | undefined {
  return state.markets[marketKey(locationId, commodityId)];
}

/**
 * Materialise one market if it does not exist yet. Returns null when the
 * commodity/location pair is unknown (never for balance reasons).
 */
export function ensureMarket(state: GameState, locationId: ID, commodityId: ID): MarketState | null {
  const key = marketKey(locationId, commodityId);
  const existing = state.markets[key];
  if (existing) return existing;
  const created = createMarketState(locationId, commodityId, marketContext(state), state.world.day);
  if (!created) return null;
  state.markets[key] = created;
  return created;
}

/**
 * Keep the materialised set bounded. Markets nobody can reach and nobody has
 * traded in recently are evicted; the player's current city is always kept.
 */
export function pruneMarkets(state: GameState, cap = 900): number {
  const keys = Object.keys(state.markets);
  if (keys.length <= cap) return 0;
  const here = state.player.locationId;
  const scored = keys
    .filter((k) => !k.startsWith(`${here}::`))
    .map((k) => {
      const m = state.markets[k]!;
      const recency = state.world.day - Math.max(m.lastTradedDay, m.historyStartDay);
      return { key: k, score: recency + (m.volume30d > 0 ? -60 : 0) };
    })
    .sort((a, b) => b.score - a.score);
  let removed = 0;
  for (const s of scored) {
    if (keys.length - removed <= cap) break;
    delete state.markets[s.key];
    removed += 1;
  }
  if (removed > 0) {
    pushDiagnostic(state, {
      system: 'markets',
      level: 'debug',
      message: `Evicted ${removed} stale market(s) to stay within the ${cap}-market budget`,
      data: { remaining: Object.keys(state.markets).length },
    });
  }
  return removed;
}

/**
 * Deterministic set of goods reachable only through hidden channels at a
 * location (untolerated legality / not openly stocked). Selection is hashed from
 * (location, commodity) so the same save always sees the same black market.
 */
export function hiddenChannelCommodities(state: GameState, locationId: ID, limit = 48): CommodityDef[] {
  const loc = worldReg.location(locationId);
  if (!loc) return [];
  const underground = state.player.underground;
  const criminalRep = state.player.reputation.dimensions.criminal;
  const hasAccess = underground.accessUnlocked || criminalRep >= 5;
  if (!hasAccess) return [];

  const openness = 1 - loc.risk; // riskier places hide more
  const ranked = registry
    .all()
    .filter((c) => c.legality !== 'legal' || !worldReg.isTolerated(locationId, c))
    .filter((c) => c.marketTypes.includes('black') || c.marketTypes.includes('darknet') || c.rarity >= 4)
    .filter((c) => (underground.accessUnlocked ? true : !c.marketTypes.includes('darknet') || criminalRep >= 12))
    .map((c) => ({ c, h: parseInt(fnv1aHex(`${locationId}|${c.id}`), 16) }))
    .sort((a, b) => a.h - b.h)
    .map((x) => x.c);

  return ranked.slice(0, Math.max(6, Math.round(limit * (0.45 + openness * 0.55))));
}

export interface MaterialiseResult {
  created: number;
  total: number;
  hidden: number;
}

/** Materialise every market the player can see at a location. */
export function materialiseLocation(
  state: GameState,
  locationId: ID,
  opts: { includeHidden?: boolean; neighbours?: boolean } = {},
): MaterialiseResult {
  const loc = worldReg.location(locationId);
  if (!loc) return { created: 0, total: 0, hidden: 0 };
  let created = 0;
  for (const commodityId of loc.tradedCommodityIds) {
    if (!state.markets[marketKey(locationId, commodityId)]) {
      if (ensureMarket(state, locationId, commodityId)) created += 1;
    }
  }
  let hidden = 0;
  if (opts.includeHidden) {
    for (const c of hiddenChannelCommodities(state, locationId)) {
      if (!state.markets[marketKey(locationId, c.id)]) {
        if (ensureMarket(state, locationId, c.id)) hidden += 1;
      }
    }
  }
  if (opts.neighbours) {
    for (const { other } of worldReg.neighboursOf(locationId)) {
      for (const commodityId of other.tradedCommodityIds.slice(0, 24)) {
        if (!state.markets[marketKey(other.id, commodityId)]) {
          if (ensureMarket(state, other.id, commodityId)) created += 1;
        }
      }
    }
  }
  pruneMarkets(state);
  return { created, total: Object.keys(state.markets).length, hidden };
}

/** Materialise the destination markets used by the arbitrage scanner. */
export function materialiseArbitrageSet(state: GameState, commodityId: ID, limit = 8): number {
  let created = 0;
  const candidates = worldReg
    .locationsTrading(commodityId)
    .map((l) => ({ l, h: parseInt(fnv1aHex(`${state.gameId}|${commodityId}|${l.id}`), 16) }))
    .sort((a, b) => a.h - b.h)
    .slice(0, limit);
  for (const { l } of candidates) {
    if (!state.markets[marketKey(l.id, commodityId)]) {
      if (ensureMarket(state, l.id, commodityId)) created += 1;
    }
  }
  return created;
}

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

export type TradeChannel = 'open' | 'black' | 'darknet';

export type TradeDenialCode =
  | 'unknown_location'
  | 'undiscovered'
  | 'lockdown'
  | 'border_closed'
  | 'not_stocked'
  | 'requires_darknet'
  | 'requires_underground_access'
  | 'locked_level'
  | 'locked_reputation'
  | 'locked_skill'
  | 'locked_perk'
  | 'locked_faction'
  | 'locked_discovery'
  | 'no_actions'
  | 'instrument_only';

export interface TradePermission {
  allowed: boolean;
  code: TradeDenialCode | 'ok';
  reason: string;
  channel: TradeChannel;
  /** What the player can do to unlock this, if anything (never a dead end). */
  hint?: string;
  legality: string;
  tolerated: boolean;
  openlyTraded: boolean;
}

export function tradePermission(state: GameState, locationId: ID, c: CommodityDef): TradePermission {
  const loc = worldReg.location(locationId);
  if (!loc) {
    return deny('unknown_location', 'That location does not exist.', c, locationId);
  }
  const locState = state.world.locations[locationId];
  if (loc.hidden && locState && !locState.discovered) {
    return deny(
      'undiscovered',
      `${loc.name} is not on any map you have access to.`,
      c,
      locationId,
      'Buy location intel on the darknet or ask a faction that controls the area.',
    );
  }
  if (locState?.lockdown) {
    return deny('lockdown', `${loc.name} is under lockdown — markets are closed.`, c, locationId, 'Wait for the lockdown to lift or trade elsewhere.');
  }
  if (c.isInstrument) {
    return deny('instrument_only', `${c.name} is a financial instrument, not a physical good — trade it on the exchange.`, c, locationId);
  }

  const legality = worldReg.effectiveLegality(locationId, c);
  const tolerated = loc.laws.tolerated.includes(legality);
  const openlyTraded = loc.tradedCommodityIds.includes(c.id);
  const underground = state.player.underground;
  const criminalRep = state.player.reputation.dimensions.criminal;

  // Progression gate (data-driven, always reachable).
  const unlock = c.unlock;
  if (unlock) {
    const p = state.player.progression;
    if (unlock.minLevel !== undefined && p.level < unlock.minLevel) {
      return {
        allowed: false,
        code: 'locked_level',
        reason: `${c.name} requires level ${unlock.minLevel} (you are level ${p.level}).`,
        channel: 'open',
        hint: 'Trade and complete contracts to level up.',
        legality,
        tolerated,
        openlyTraded,
      };
    }
    if (unlock.minReputation && state.player.reputation.dimensions[unlock.minReputation.dimension] < unlock.minReputation.value) {
      const have = state.player.reputation.dimensions[unlock.minReputation.dimension];
      return {
        allowed: false,
        code: 'locked_reputation',
        reason: `${c.name} requires ${unlock.minReputation.value} ${unlock.minReputation.dimension} reputation (you have ${have}).`,
        channel: 'open',
        hint: 'Build that reputation through contracts, crew and faction work.',
        legality,
        tolerated,
        openlyTraded,
      };
    }
    if (unlock.minSkill) {
      const have = p.skills[unlock.minSkill.skillId] ?? 0;
      if (have < unlock.minSkill.level) {
        return {
          allowed: false,
          code: 'locked_skill',
          reason: `${c.name} requires ${unlock.minSkill.skillId} ${unlock.minSkill.level} (you have ${have}).`,
          channel: 'open',
          hint: 'Spend skill points on that skill.',
          legality,
          tolerated,
          openlyTraded,
        };
      }
    }
    if (unlock.requiresPerk && !p.perks.includes(unlock.requiresPerk)) {
      return {
        allowed: false,
        code: 'locked_perk',
        reason: `${c.name} requires the ${unlock.requiresPerk} perk.`,
        channel: 'open',
        hint: 'Take that perk when you next level.',
        legality,
        tolerated,
        openlyTraded,
      };
    }
    if (unlock.minFactionStanding) {
      const standing = state.world.factions[unlock.minFactionStanding.factionId]?.playerStanding ?? -100;
      if (standing < unlock.minFactionStanding.value) {
        return {
          allowed: false,
          code: 'locked_faction',
          reason: `${c.name} requires ${unlock.minFactionStanding.value} standing with ${unlock.minFactionStanding.factionId} (you have ${Math.round(standing)}).`,
          channel: 'open',
          hint: 'Complete faction contracts or pay tribute.',
          legality,
          tolerated,
          openlyTraded,
        };
      }
    }
    if (unlock.requiresDiscovery && !p.milestones.includes(unlock.requiresDiscovery)) {
      return {
        allowed: false,
        code: 'locked_discovery',
        reason: `${c.name} is only available through contacts you have not made yet.`,
        channel: 'open',
        hint: 'Explore the underground economy and faction offers.',
        legality,
        tolerated,
        openlyTraded,
      };
    }
  }

  // Channel selection.
  let channel: TradeChannel = 'open';
  if (!tolerated || !openlyTraded) {
    const darknetOnly = c.marketTypes.includes('darknet');
    if (!underground.accessUnlocked && criminalRep < 5) {
      return {
        allowed: false,
        code: darknetOnly ? 'requires_darknet' : 'requires_underground_access',
        reason: tolerated
          ? `${c.name} is not openly stocked in ${loc.name}.`
          : `${c.name} is ${legality} in ${loc.name} and there is no open market for it.`,
        channel: 'open',
        hint: darknetOnly
          ? `Darknet access costs ${formatMoney(B.underground.accessCostOneTime)} and is bought from the Underground screen.`
          : 'Raise criminal reputation or buy darknet access to reach hidden channels.',
        legality,
        tolerated,
        openlyTraded,
      };
    }
    channel = darknetOnly && underground.accessUnlocked ? 'darknet' : 'black';
  }

  return {
    allowed: true,
    code: 'ok',
    reason:
      channel === 'open'
        ? `Traded openly in ${loc.name}.`
        : channel === 'darknet'
          ? `Available on the darknet in ${loc.name} — escrow fees and trace heat apply.`
          : `Available through hidden channels in ${loc.name} — higher fees and heat apply.`,
    channel,
    legality,
    tolerated,
    openlyTraded,
  };
}

function deny(
  code: TradeDenialCode,
  reason: string,
  c: CommodityDef,
  locationId: ID,
  hint?: string,
): TradePermission {
  const legality = worldReg.effectiveLegality(locationId, c);
  return {
    allowed: false,
    code,
    reason,
    channel: 'open',
    ...(hint ? { hint } : {}),
    legality,
    tolerated: worldReg.isTolerated(locationId, c),
    openlyTraded: worldReg.location(locationId)?.tradedCommodityIds.includes(c.id) ?? false,
  };
}

/* ------------------------------------------------------------------ */
/* Quoting                                                             */
/* ------------------------------------------------------------------ */

export interface FeeLine {
  label: string;
  amount: number;
  kind: 'broker' | 'tax' | 'escrow' | 'black_market' | 'duty';
}

export interface TradeQuote {
  side: 'buy' | 'sell';
  locationId: ID;
  locationName: string;
  commodityId: ID;
  commodityName: string;
  channel: TradeChannel;
  requestedQty: number;
  /** Quantity that would actually fill after every guard. */
  qty: number;
  marketPrice: number;
  fundamental: number;
  quotedUnitPrice: number;
  impactFraction: number;
  effectiveUnitPrice: number;
  netUnitPrice: number;
  gross: number;
  fees: FeeLine[];
  feeTotal: number;
  taxTotal: number;
  /** Cash out (buy) or cash in (sell). */
  total: number;
  premiumVsFundamental: number;
  priceAfterTrade: number;
  /**
   * Smallest quantity worth selling here: below it, the flat fee and tax take the
   * whole proceeds. Null when no flat fee applies. The UI shows this so a player
   * holding three units of a cheap good understands why the offer is zero.
   */
  breakEvenQty: number | null;
  warnings: string[];
  capacity: {
    marketAbsorbable: number;
    affordable: number;
    storable: number;
    onHand: number;
    alreadyTradedToday: number;
  };
  storageProblem?: StorageProblem;
  permission: TradePermission;
  analytics?: MarketAnalytics;
}

function channelFeeRate(channel: TradeChannel): { rate: number; kind: FeeLine['kind']; label: string } {
  switch (channel) {
    case 'darknet':
      return { rate: B.underground.escrowFeeFraction, kind: 'escrow', label: 'Darknet escrow fee' };
    case 'black':
      return { rate: B.underground.marketFeeFraction, kind: 'black_market', label: 'Hidden-channel fee' };
    default:
      return { rate: B.finance.bankTransactionFee, kind: 'broker', label: 'Broker / settlement fee' };
  }
}

/**
 * How many units the market will absorb from one order today.
 *
 * Two limits combine: a fraction of standing supply, and a *dislocation* limit —
 * the further the price has moved from fundamental, the fewer counterparties are
 * willing to trade at it. This is the mechanism that makes extreme prints
 * unexploitable at scale (spec §44 exploit resistance) while still rewarding
 * genuine scarcity trading at modest size.
 */
export function absorbableUnits(state: GameState, market: MarketState, side: 'buy' | 'sell'): number {
  const base = market.supply * ABSORB_FRACTION;
  const premium = market.fundamental > 0 ? market.price / market.fundamental - 1 : 0;
  const dislocation = side === 'sell' ? Math.max(0, premium) : Math.max(0, -premium);
  const guard = B.market.arbitrageGuardMaxMargin;
  const factor = dislocation > guard ? guard / dislocation : 1;
  const tradedToday = counter(state, `traded:${market.key}:${state.world.day}`);
  return Math.max(0, Math.floor(base * clamp(factor, 0.05, 1) - tradedToday));
}

function impactFor(market: MarketState, c: CommodityDef, qty: number, side: 'buy' | 'sell', reduction: number): number {
  const depth = Math.max(1, market.supply * B.market.depthPerSupplyUnit * 1000);
  const signed = side === 'buy' ? qty : -qty;
  const raw = (signed / depth) * B.market.playerImpactFactor;
  return clamp(raw, -B.market.maxImpactPerTrade, B.market.maxImpactPerTrade) * (1 - clamp(reduction, 0, 0.8));
}

/**
 * Largest quantity that still fits in some storage unit at the player's current
 * location, respecting weight, volume, refrigeration, security and concealment
 * rules. Binary search over the real `canStore` predicate so quoting and
 * execution can never disagree.
 */
function storableQty(state: GameState, c: CommodityDef, concealed: boolean): number {
  const storages = storagesAtLocation(state, state.player.locationId);
  if (storages.length === 0) return 0;
  let lo = 0;
  let hi = 250_000;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const fits = storages.some((s) => canStore(state, s.id, c, mid, concealed).ok);
    if (fits) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

interface FillComputation {
  impact: number;
  effectiveUnitPrice: number;
  gross: number;
  fees: FeeLine[];
  feeTotal: number;
  taxTotal: number;
  total: number;
  netUnitPrice: number;
  priceAfterTrade: number;
  /** Smallest sell lot whose proceeds cover the flat fee, or null if not applicable. */
  breakEvenQty: number | null;
}

/** Price a specific fill size against a market (pure — mutates nothing). */
function computeFill(
  state: GameState,
  market: MarketState,
  c: CommodityDef,
  loc: LocationDef,
  permission: TradePermission,
  side: 'buy' | 'sell',
  qty: number,
  mods: ReturnType<typeof playerModifiers>,
): FillComputation {
  const quotes = quotedPrices(market, c, permission.channel === 'open' ? spreadReduction(mods) : spreadReduction(mods) * 0.4);
  const quotedUnit = side === 'buy' ? quotes.buy : quotes.sell;
  const impact = impactFor(market, c, qty, side, priceImpactReduction(mods));
  const effectiveUnitPrice = round2(Math.max(0.01, quotedUnit * (1 + impact)));
  const gross = round2(effectiveUnitPrice * qty);

  const fees: FeeLine[] = [];
  if (qty > 0) {
    const ch = channelFeeRate(permission.channel);
    const feeAmount = round2(Math.max(ch.rate * gross, permission.channel === 'open' ? B.finance.bankTransactionFeeMin : 0));
    if (feeAmount > 0) fees.push({ label: ch.label, amount: feeAmount, kind: ch.kind });
  }

  // Sales tax applies to legal, openly-traded goods. Deliberate evasion is a
  // separate, risky system in finance.ts — here the law is simply applied.
  let taxTotal = 0;
  if (qty > 0 && side === 'sell' && permission.channel === 'open' && c.legality === 'legal') {
    const rate = Math.max(0, loc.laws.taxRate * (1 - taxReduction(mods)));
    taxTotal = round2(gross * rate);
    if (taxTotal > 0) fees.push({ label: `Sales tax (${(loc.laws.taxRate * 100).toFixed(1)}%)`, amount: taxTotal, kind: 'tax' });
  }

  const rawFeeTotal = round2(fees.reduce((sum, f) => sum + f.amount, 0));

  /*
   * A sale must never cost the player money.
   *
   * Open channels charge a flat minimum fee, so a tiny lot (four units of bulk
   * water) used to quote a *negative* net price: the UI would have shown "sell
   * this and pay ¤0.78", and executeSell then tried to credit a negative amount
   * and failed with an opaque "invalid_amount". Charges are now capped at the
   * value of the lot, and the quote says how big the lot has to be to clear them.
   */
  const feeFloor = permission.channel === 'open' ? B.finance.bankTransactionFeeMin : 0;
  const variableRate = gross > 0 ? clamp((rawFeeTotal - Math.min(rawFeeTotal, feeFloor)) / gross, 0, 0.95) : 0;
  const netPerUnit = effectiveUnitPrice * (1 - variableRate);
  const breakEvenQty = side === 'sell' && feeFloor > 0 && netPerUnit > 0 ? Math.ceil(feeFloor / netPerUnit) : null;

  const capped = side === 'sell' && rawFeeTotal > gross;
  if (capped && rawFeeTotal > 0) {
    const scale = Math.max(0, gross) / rawFeeTotal;
    for (const fee of fees) fee.amount = round2(fee.amount * scale);
  }
  const feeTotal = capped ? round2(fees.reduce((sum, f) => sum + f.amount, 0)) : rawFeeTotal;
  const total = side === 'buy' ? round2(gross + feeTotal) : round2(Math.max(0, gross - feeTotal));
  const priceAfterTrade = round2(
    clamp(market.price * (1 + impact), market.fundamental * B.market.priceFloorFraction, market.fundamental * B.market.priceCeilingMultiple),
  );
  void state;
  return {
    impact,
    effectiveUnitPrice,
    gross,
    fees,
    feeTotal,
    taxTotal,
    total,
    netUnitPrice: qty > 0 ? round2(total / qty) : 0,
    priceAfterTrade,
    breakEvenQty,
  };
}

function buildQuote(
  state: GameState,
  side: 'buy' | 'sell',
  locationId: ID,
  commodityId: ID,
  requestedQty: number,
  opts: { concealed?: boolean } = {},
): TradeQuote | null {
  const c = registry.get(commodityId);
  const loc = worldReg.location(locationId);
  if (!c || !loc) return null;
  const permission = tradePermission(state, locationId, c);
  const market = ensureMarket(state, locationId, commodityId);
  if (!market) return null;

  const mods = playerModifiers(state);
  const quotes = quotedPrices(market, c, permission.channel === 'open' ? spreadReduction(mods) : spreadReduction(mods) * 0.4);
  const quotedUnit = side === 'buy' ? quotes.buy : quotes.sell;

  const warnings: string[] = [];
  const requested = Math.max(0, Math.floor(requestedQty));

  const absorbable = absorbableUnits(state, market, side);
  const onHand = quantityOnHand(state, commodityId, locationId);
  const storable = side === 'buy' ? storableQty(state, c, opts.concealed ?? false) : Number.POSITIVE_INFINITY;
  const cash = spendable(state.player, state.world.day, permission.channel !== 'open');

  // Physical/depth limits first, then cash (which depends on the size itself
  // because impact grows with the order), solved by fixed-point iteration.
  let hardLimit = Math.min(absorbable, storable);
  if (side === 'sell') hardLimit = Math.min(hardLimit, onHand);
  let qty = Math.min(requested, hardLimit);

  let fill = computeFill(state, market, c, loc, permission, side, qty, mods);
  if (side === 'buy') {
    for (let i = 0; i < 10 && qty > 0 && fill.total > cash; i += 1) {
      const ratio = cash / Math.max(1, fill.total);
      qty = Math.max(0, Math.floor(qty * ratio * 0.995));
      fill = computeFill(state, market, c, loc, permission, side, qty, mods);
    }
  }

  const affordable = side === 'buy' ? (quotedUnit > 0 ? maxAffordable(state, market, c, loc, permission, mods, cash) : 0) : Number.POSITIVE_INFINITY;

  if (requested > qty) {
    if (qty <= 0) {
      warnings.push(
        permission.allowed
          ? side === 'buy'
            ? cash < quotedUnit
              ? `Not enough cash: ${formatMoney(quotedUnit)} needed per unit, ${formatMoney(cash)} available.`
              : absorbable <= 0
                ? 'This market has no sellers left at the current price today.'
                : storable <= 0
                  ? 'No storage here can hold these goods (weight, volume or special handling).'
                  : 'Nothing to buy.'
            : onHand <= 0
              ? `You have no ${c.name} stored in ${loc.name}.`
              : 'This market has no buyers left at the current price today.'
          : permission.reason,
      );
    } else {
      const binding =
        absorbable <= Math.min(storable, onHand, affordable)
          ? 'the market will only absorb this much at the current price'
          : side === 'buy' && affordable < storable
            ? 'available cash'
            : side === 'sell' && onHand < absorbable
              ? 'goods in storage here'
              : 'storage capacity';
      warnings.push(
        `Partial fill: ${requested.toLocaleString('en-US')} requested, ${qty.toLocaleString('en-US')} filled — limited by ${binding}.`,
      );
    }
  }
  if (!permission.allowed && !warnings.includes(permission.reason)) warnings.push(permission.reason);
  if (side === 'sell' && qty > 0 && fill.total <= 0) {
    warnings.push(
      `This lot is too small to sell: ${formatMoney(fill.feeTotal)} of fees and tax takes the whole ${formatMoney(fill.gross)} it would fetch.` +
        (fill.breakEvenQty
          ? ` Sell at least ${fill.breakEvenQty.toLocaleString('en-US')} unit(s) to clear the charges.`
          : ''),
    );
  }

  return {
    side,
    locationId,
    locationName: loc.name,
    commodityId,
    commodityName: c.name,
    channel: permission.channel,
    requestedQty: requested,
    qty,
    marketPrice: market.price,
    fundamental: market.fundamental,
    quotedUnitPrice: quotedUnit,
    impactFraction: round2(fill.impact * 10000) / 10000,
    effectiveUnitPrice: fill.effectiveUnitPrice,
    netUnitPrice: fill.netUnitPrice,
    gross: fill.gross,
    fees: fill.fees,
    feeTotal: fill.feeTotal,
    taxTotal: fill.taxTotal,
    total: fill.total,
    premiumVsFundamental: market.fundamental > 0 ? round2((market.price / market.fundamental - 1) * 1000) / 1000 : 0,
    priceAfterTrade: fill.priceAfterTrade,
    breakEvenQty: fill.breakEvenQty,
    warnings,
    capacity: {
      marketAbsorbable: absorbable,
      affordable: Number.isFinite(affordable) ? affordable : -1,
      storable: Number.isFinite(storable) ? storable : -1,
      onHand,
      alreadyTradedToday: counter(state, `traded:${market.key}:${state.world.day}`),
    },
    permission,
    analytics: analyseMarket(market),
  };
}

/**
 * Largest buy size the available cash supports, impact included. Deliberately
 * ignores storage: this is the *cash* limit, and the UI shows it alongside the
 * storage and depth limits so the player can see which constraint binds.
 */
function maxAffordable(
  state: GameState,
  market: MarketState,
  c: CommodityDef,
  loc: LocationDef,
  permission: TradePermission,
  mods: ReturnType<typeof playerModifiers>,
  cash: number,
): number {
  let qty = Math.min(absorbableUnits(state, market, 'buy'), 250_000);
  if (qty <= 0) return 0;
  let fill = computeFill(state, market, c, loc, permission, 'buy', qty, mods);
  for (let i = 0; i < 12 && qty > 0 && fill.total > cash; i += 1) {
    qty = Math.max(0, Math.floor(qty * (cash / Math.max(1, fill.total)) * 0.995));
    fill = computeFill(state, market, c, loc, permission, 'buy', qty, mods);
  }
  return fill.total <= cash ? qty : 0;
}

export function quoteBuy(state: GameState, commodityId: ID, qty: number, opts: { concealed?: boolean } = {}): TradeQuote | null {
  return buildQuote(state, 'buy', state.player.locationId, commodityId, qty, opts);
}

/**
 * Quote a sale. `locationId` defaults to where the player stands; automation
 * passes a depot location so a manager can sell freight that was delivered to a
 * bonded depot without the player travelling there.
 */
export function quoteSell(state: GameState, commodityId: ID, qty: number, locationId?: ID): TradeQuote | null {
  return buildQuote(state, 'sell', locationId ?? state.player.locationId, commodityId, qty);
}

/** Largest quantity the player could buy right now (cash + storage + depth). */
export function maxBuyQty(state: GameState, commodityId: ID): number {
  return quoteBuy(state, commodityId, 1_000_000)?.qty ?? 0;
}

/** Largest quantity the player can sell here right now. */
export function maxSellQty(state: GameState, commodityId: ID): number {
  return quoteSell(state, commodityId, 1_000_000)?.qty ?? 0;
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

export interface TradeResult {
  ok: boolean;
  code?: string;
  reason?: string;
  quote?: TradeQuote;
  transactionId?: ID;
  filled: number;
  cashDelta: number;
  costBasis: number;
  profit: number;
  margin: number;
  xp: number;
  heat: number;
  priceBefore: number;
  priceAfter: number;
  objectiveUpdates: { missionTitle: string; description: string; current: number; required: number }[];
  warnings: string[];
}

function emptyTradeResult(reason: string, code: string, quote?: TradeQuote): TradeResult {
  return {
    ok: false,
    code,
    reason,
    ...(quote ? { quote } : {}),
    filled: 0,
    cashDelta: 0,
    costBasis: 0,
    profit: 0,
    margin: 0,
    xp: 0,
    heat: 0,
    priceBefore: quote?.marketPrice ?? 0,
    priceAfter: quote?.marketPrice ?? 0,
    objectiveUpdates: [],
    warnings: quote?.warnings ?? [],
  };
}

export interface BuyParams {
  commodityId: ID;
  qty: number;
  storageId?: ID;
  concealed?: boolean;
  /** Allow spending unlaundered cash (hidden channels only). */
  allowDirty?: boolean;
  /** Automation/manager orders do not consume the player's daily actions. */
  automated?: boolean;
}

export function executeBuy(state: GameState, params: BuyParams): TradeResult {
  const c = registry.get(params.commodityId);
  if (!c) return emptyTradeResult(`Unknown commodity "${params.commodityId}"`, 'unknown_commodity');
  const locationId = state.player.locationId;
  const quote = quoteBuy(state, params.commodityId, params.qty, { concealed: params.concealed });
  if (!quote) return emptyTradeResult('Market unavailable for that commodity here.', 'no_market', undefined);

  if (!quote.permission.allowed) return emptyTradeResult(quote.permission.reason, quote.permission.code, quote);
  if (quote.qty <= 0) {
    const reason = quote.warnings[0] ?? 'Nothing to buy.';
    return emptyTradeResult(reason, 'no_fill', quote);
  }
  if (!params.automated && !hasActions(state)) {
    return emptyTradeResult('You have no actions left today — rest to recover.', 'no_actions', quote);
  }

  const market = state.markets[marketKey(locationId, params.commodityId)]!;
  const priceBefore = market.price;
  const allowDirty = params.allowDirty ?? quote.channel !== 'open';

  const move = debitCash(state, quote.total, {
    kind: 'buy',
    description: `Bought ${quote.qty} × ${c.name} @ ${formatMoney(quote.effectiveUnitPrice)} in ${quote.locationName}`,
    allowDirty,
    commodityId: c.id,
    qty: quote.qty,
    unitPrice: quote.effectiveUnitPrice,
    locationId,
    counterparty: quote.locationName,
    meta: { channel: quote.channel, fees: quote.feeTotal, impact: quote.impactFraction },
  });
  if (!move.ok) return emptyTradeResult(move.reason ?? 'Insufficient funds.', 'payment_failed', quote);

  const added = addItem(state, {
    commodityId: c.id,
    qty: quote.qty,
    avgCost: quote.netUnitPrice,
    storageId: params.storageId,
    concealed: params.concealed,
    origin: 'purchased',
  });
  if (!added.ok) {
    // Roll the money back: never leave the player paying for goods they do not have.
    creditCash(state, quote.total, {
      kind: 'adjustment',
      description: `Refund: could not store ${quote.qty} × ${c.name} (${added.message ?? added.problem ?? 'no capacity'})`,
      dirty: false,
      commodityId: c.id,
      qty: quote.qty,
      locationId,
    });
    return emptyTradeResult(added.message ?? `No storage capacity (${added.problem ?? 'unknown'})`, added.problem ?? 'storage', quote);
  }

  const impact = tradeImpact(market, c, quote.qty, 'buy', { impactReduction: priceImpactReduction(playerModifiers(state)) });
  market.lastTradedDay = state.world.day;
  market.volume30d = round2(market.volume30d + quote.qty);
  bumpCounter(state, `traded:${market.key}:${state.world.day}`, quote.qty);
  void impact;

  if (!params.automated) consumeAction(state, 1, B.player.staminaPerAction);

  state.player.stats.totalTradesExecuted += 1;
  bumpCounter(state, 'volume_traded', quote.qty);
  setCounter(state, 'cash_spent', round2(counter(state, 'cash_spent') + quote.total));
  maxCounter(state, 'biggest_buy', quote.total);
  maxCounter(state, 'bought_units', quote.qty);

  const xp = Math.max(B.progression.xpTradeMin, Math.round(Math.sqrt(quote.gross) * 0.09));
  const xpResult = grantXp(state, xp, `Bought ${quote.qty} × ${c.name}`);

  const heat = applyTradeConsequences(state, c, quote, 'buy');
  const updates = recordObjective(state, 'buy_commodity', { commodityId: c.id, qty: quote.qty, locationId });

  pushDiagnostic(state, {
    system: 'markets',
    level: 'info',
    message: `BUY ${quote.qty} × ${c.id} @ ${quote.locationName}: unit ${quote.effectiveUnitPrice} (mid ${priceBefore}, impact ${(quote.impactFraction * 100).toFixed(2)}%), total ${quote.total}`,
    data: { qty: quote.qty, unitPrice: quote.effectiveUnitPrice, total: quote.total, channel: quote.channel, heat },
  });

  return {
    ok: true,
    quote,
    transactionId: move.transaction?.id,
    filled: quote.qty,
    cashDelta: -quote.total,
    costBasis: quote.total,
    profit: 0,
    margin: 0,
    xp: xpResult.granted,
    heat,
    priceBefore,
    priceAfter: market.price,
    objectiveUpdates: updates.map((u) => ({ missionTitle: u.missionTitle, description: u.description, current: u.current, required: u.required })),
    warnings: quote.warnings,
  };
}

export interface SellParams {
  commodityId: ID;
  qty: number;
  /** Sell from concealed/hidden compartments too. */
  includeConcealed?: boolean;
  automated?: boolean;
  /**
   * Sell out of storage at this location instead of the player's current one.
   * Only automation and server-side flows use it; the goods must physically be
   * stored there, so this never creates stock out of nothing.
   */
  locationId?: ID;
}

export function executeSell(state: GameState, params: SellParams): TradeResult {
  const c = registry.get(params.commodityId);
  if (!c) return emptyTradeResult(`Unknown commodity "${params.commodityId}"`, 'unknown_commodity');
  const locationId = params.locationId ?? state.player.locationId;
  const quote = quoteSell(state, params.commodityId, params.qty, locationId);
  if (!quote) return emptyTradeResult('Market unavailable for that commodity here.', 'no_market');
  if (!quote.permission.allowed) return emptyTradeResult(quote.permission.reason, quote.permission.code, quote);

  const onHand = quantityOnHand(state, c.id, locationId, params.includeConcealed ?? true);
  if (onHand <= 0) {
    return emptyTradeResult(`You have no ${c.name} stored in ${quote.locationName}. Goods only sell from storage at your current location.`, 'no_goods', quote);
  }
  const qty = Math.min(quote.qty, onHand);
  if (qty <= 0) return emptyTradeResult(quote.warnings[0] ?? 'Nothing to sell.', 'no_fill', quote);
  if (quote.total <= 0) {
    // Refuse *before* removing anything: a sale that pays nothing is not a sale.
    return emptyTradeResult(
      `Selling ${qty.toLocaleString('en-US')} × ${c.name} would bring in nothing — ${formatMoney(quote.feeTotal)} of fees and tax takes the whole ${formatMoney(quote.gross)} this lot fetches.` +
        (quote.breakEvenQty
          ? ` Sell at least ${quote.breakEvenQty.toLocaleString('en-US')} unit(s) to break even, or sell through a channel with lower charges.`
          : ''),
      'below_minimum',
      quote,
    );
  }
  if (!params.automated && !hasActions(state)) {
    return emptyTradeResult('You have no actions left today — rest to recover.', 'no_actions', quote);
  }

  const market = state.markets[marketKey(locationId, c.id)]!;
  const priceBefore = market.price;

  const removed = removeCommodity(state, c.id, qty, locationId);
  if (!removed.ok && removed.removed < qty) {
    return emptyTradeResult(removed.message ?? 'Could not release those goods from storage.', 'removal_failed', quote);
  }
  const sold = removed.removed;
  const costBasis = removed.costBasis ?? 0;
  const proceeds = round2(quote.netUnitPrice * sold);
  const origins = removed.acquiredLocationIds ?? [];

  const move = creditCash(state, proceeds, {
    kind: 'sell',
    description: `Sold ${sold} × ${c.name} @ ${formatMoney(quote.netUnitPrice)} in ${quote.locationName}`,
    dirty: c.legality !== 'legal' || quote.channel !== 'open',
    commodityId: c.id,
    qty: sold,
    unitPrice: quote.netUnitPrice,
    locationId,
    counterparty: quote.locationName,
    meta: { channel: quote.channel, fees: quote.feeTotal, tax: quote.taxTotal, costBasis },
  });
  if (!move.ok) {
    // Put the goods back rather than destroying player property.
    addItem(state, { commodityId: c.id, qty: sold, avgCost: sold > 0 ? costBasis / sold : 0, origin: 'purchased' });
    return emptyTradeResult(move.reason ?? 'Could not credit the proceeds.', 'credit_failed', quote);
  }

  tradeImpact(market, c, sold, 'sell', { impactReduction: priceImpactReduction(playerModifiers(state)) });
  market.lastTradedDay = state.world.day;
  market.volume30d = round2(market.volume30d + sold);
  bumpCounter(state, `traded:${market.key}:${state.world.day}`, sold);

  if (!params.automated) consumeAction(state, 1, B.player.staminaPerAction);

  const profit = round2(proceeds - costBasis);
  const margin = costBasis > 0 ? round2(profit / costBasis) : 0;
  state.player.stats.totalTradesExecuted += 1;
  bumpCounter(state, 'volume_traded', sold);
  setCounter(state, 'cash_earned', round2(counter(state, 'cash_earned') + proceeds));
  setCounter(state, 'profit_realised', round2(counter(state, 'profit_realised') + profit));
  if (profit > state.player.stats.biggestDealProfit) state.player.stats.biggestDealProfit = profit;
  bumpCounter(state, 'trades');
  maxCounter(state, 'biggest_sale', proceeds);
  if (profit > 0) {
    bumpCounter(state, 'profit_trades');
    setCounter(state, 'realised_profit', round2(counter(state, 'realised_profit') + profit));
  } else {
    bumpCounter(state, 'loss_trades');
  }

  // Arbitrage = bought in one city, sold for a profit in another.
  const isArbitrage = profit > 0 && origins.some((o) => o !== locationId);
  if (isArbitrage) {
    bumpCounter(state, 'arbitrage');
    setCounter(state, 'arbitrage_profit', round2(counter(state, 'arbitrage_profit') + profit));
    maxCounter(state, 'best_arbitrage_margin', margin);
  }

  const xp = Math.max(B.progression.xpTradeMin, Math.round(Math.sqrt(Math.max(0, proceeds)) * 0.09)) + xpFromTradeProfit(profit);
  const xpResult = grantXp(state, xp, `Sold ${sold} × ${c.name} for ${formatMoney(proceeds)} (${profit >= 0 ? '+' : '−'}${formatMoney(Math.abs(profit))})`);

  const heat = applyTradeConsequences(state, c, { ...quote, qty: sold, total: proceeds }, 'sell');
  const marginForMission = costBasis > 0 ? proceeds / costBasis - 1 : 0;
  const sellUpdates = recordObjective(state, 'sell_commodity', {
    commodityId: c.id,
    qty: sold,
    amount: proceeds,
    margin: marginForMission,
    locationId,
  });
  const deliverUpdates = recordObjective(state, 'deliver_commodity', {
    commodityId: c.id,
    qty: sold,
    locationId,
    amount: proceeds,
  });

  pushDiagnostic(state, {
    system: 'markets',
    level: 'info',
    message: `SELL ${sold} × ${c.id} @ ${quote.locationName}: unit ${quote.netUnitPrice} (mid ${priceBefore}), proceeds ${proceeds}, profit ${profit}${isArbitrage ? ' [arbitrage]' : ''}`,
    data: { qty: sold, unitPrice: quote.netUnitPrice, proceeds, profit, margin, heat, arbitrage: isArbitrage ? 1 : 0 },
  });

  if (Math.abs(profit) >= 25_000) {
    pushNotification(state, {
      kind: profit > 0 ? 'success' : 'danger',
      title: profit > 0 ? `Large profit: ${formatMoney(profit)}` : `Large loss: ${formatMoney(Math.abs(profit))}`,
      body: `${sold} × ${c.name} ${profit > 0 ? 'sold above' : 'sold below'} your ${formatMoney(costBasis)} cost basis in ${quote.locationName}.`,
      link: '/game/market',
      metrics: [
        { label: 'Unit price', value: formatMoney(quote.netUnitPrice) },
        { label: 'Cost basis', value: formatMoney(costBasis) },
        { label: 'Margin', value: `${(margin * 100).toFixed(1)}%` },
      ],
    });
  }

  return {
    ok: true,
    quote,
    transactionId: move.transaction?.id,
    filled: sold,
    cashDelta: proceeds,
    costBasis,
    profit,
    margin,
    xp: xpResult.granted,
    heat,
    priceBefore,
    priceAfter: market.price,
    objectiveUpdates: [...sellUpdates, ...deliverUpdates].map((u) => ({
      missionTitle: u.missionTitle,
      description: u.description,
      current: u.current,
      required: u.required,
    })),
    warnings: quote.warnings,
  };
}

/**
 * Shared consequences of a trade: heat, trace heat, reputation, and the
 * per-location trading record used by the news feed and enforcement.
 */
function applyTradeConsequences(state: GameState, c: CommodityDef, quote: TradeQuote, side: 'buy' | 'sell'): number {
  const loc = worldReg.location(quote.locationId);
  if (!loc) return 0;
  let heat = 0;

  if (c.legality !== 'legal' || quote.channel !== 'open') {
    const enforcement = loc.laws.enforcement;
    const scale = side === 'buy' ? 0.6 : 1;
    heat = round2(
      (c.risk * 2.2 + enforcement * 1.4) *
        Math.min(6, Math.log10(Math.max(10, quote.gross)) - 0.4) *
        scale *
        state.config.difficultyModifiers.enforcementMultiplier,
    );
    addHeat(state, heat, `${side === 'buy' ? 'Bought' : 'Sold'} ${c.name} (${c.legality}) in ${loc.name}`);
    if (quote.channel === 'darknet') {
      addTraceHeat(state, B.underground.traceHeatPerIllegalTransaction * Math.min(8, 1 + quote.gross / 25_000), 'Darknet trade');
    }
    changeReputation(state, 'criminal', side === 'buy' ? 0.15 : 0.4, `Traded ${c.name} on hidden channels`);
    changeReputation(state, 'legal', -0.2, `Traded ${c.legality} goods in ${loc.name}`);
    bumpCounter(state, side === 'buy' ? 'illegal_buys' : 'illegal_sells');
    setCounter(state, 'illegal_volume', round2(counter(state, 'illegal_volume') + quote.gross));
  } else {
    // Legitimate commerce builds commercial standing, slowly.
    if (quote.gross > 5_000) changeReputation(state, 'business', 0.25, `Completed a ${formatMoney(quote.gross)} legitimate trade`);
    changeReputation(state, 'legal', 0.05, 'Legitimate trade');
  }

  if (quote.gross > 100_000) {
    changeReputation(state, 'global', 0.4, `Moved ${formatMoney(quote.gross)} of ${c.name}`);
    maxCounter(state, 'largest_single_trade', quote.gross);
  }

  // Local market record (used by news + competitor AI).
  const locState = state.world.locations[quote.locationId];
  if (locState) {
    locState.playerHeat = round2(clamp(locState.playerHeat + heat * 0.5, 0, 200));
  }
  bumpCounter(state, 'trade_volume', quote.gross);
  return heat;
}

/* ------------------------------------------------------------------ */
/* Daily stepping                                                      */
/* ------------------------------------------------------------------ */

export interface StepMarketsResult {
  stepped: number;
  biggestMovers: { commodityId: ID; locationId: ID; name: string; change: number; price: number }[];
}

/** Advance every materialised market one day. Called from `tick.advanceDay`. */
export function stepMarkets(state: GameState, rng: Rng): StepMarketsResult {
  const ctx = marketContext(state);
  const day = state.world.day;
  let stepped = 0;
  const movers: StepMarketsResult['biggestMovers'] = [];

  for (const market of Object.values(state.markets)) {
    const before = market.price;
    stepMarket(market, ctx, day);
    stepped += 1;
    if (before > 0) {
      const change = market.price / before - 1;
      if (Math.abs(change) > 0.04) {
        const c = registry.get(market.commodityId);
        movers.push({
          commodityId: market.commodityId,
          locationId: market.locationId,
          name: c?.name ?? market.commodityId,
          change: round2(change * 1000) / 1000,
          price: market.price,
        });
      }
    }
  }

  // Clear yesterday's per-market volume counters so the daily absorb cap resets.
  const prefix = `traded:`;
  const yesterday = `${day - 1}`;
  for (const key of Object.keys(state.player.stats.counters)) {
    if (key.startsWith(prefix) && key.endsWith(`:${yesterday}`)) delete state.player.stats.counters[key];
  }

  movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  void rng;
  return { stepped, biggestMovers: movers.slice(0, 12) };
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface MarketRow {
  commodityId: ID;
  name: string;
  category: string;
  unit: string;
  legality: string;
  rarity: number;
  weightKg: number;
  volumeL: number;
  price: number;
  fundamental: number;
  bid: number;
  ask: number;
  spreadPct: number;
  changePct1d: number;
  changePct7d: number;
  changePct30d: number;
  premiumVsFundamentalPct: number;
  supply: number;
  demand: number;
  scarcityRatio: number;
  sentiment: number;
  volatility: number;
  absorbable: number;
  onHand: number;
  holdingValue: number;
  holdingCostBasis: number;
  unrealisedPnl: number;
  unrealisedPnlPct: number;
  channel: TradeChannel;
  tradable: boolean;
  denialReason?: string;
  drivers: { label: string; contributionPct: number; kind: string }[];
  tags: string[];
  shelfLifeDays: number | null;
  storage: string[];
}

export interface MarketListOptions {
  category?: string;
  search?: string;
  legality?: string;
  onlyTradable?: boolean;
  onlyHoldings?: boolean;
  sort?: 'name' | 'price' | 'change' | 'premium' | 'value' | 'volume';
  limit?: number;
  includeHidden?: boolean;
}

export function marketRows(state: GameState, locationId: ID, opts: MarketListOptions = {}): MarketRow[] {
  const loc = worldReg.location(locationId);
  if (!loc) return [];
  const search = (opts.search ?? '').trim().toLowerCase();
  const rows: MarketRow[] = [];

  const ids = new Set<ID>(loc.tradedCommodityIds);
  if (opts.includeHidden) for (const c of hiddenChannelCommodities(state, locationId)) ids.add(c.id);
  for (const stack of state.player.inventory) ids.add(stack.commodityId);

  for (const commodityId of ids) {
    const c = registry.get(commodityId);
    if (!c) continue;
    if (opts.category && c.category !== opts.category) continue;
    if (opts.legality && c.legality !== opts.legality) continue;
    if (search && !c.name.toLowerCase().includes(search) && !c.category.includes(search) && !c.tags.some((t) => t.includes(search))) continue;

    const market = marketAt(state, locationId, commodityId);
    const permission = tradePermission(state, locationId, c);
    const onHand = quantityOnHand(state, commodityId, locationId);
    if (opts.onlyTradable && !permission.allowed) continue;
    if (opts.onlyHoldings && onHand <= 0) continue;

    if (!market) {
      // Not materialised: show the deterministic fundamental estimate so the UI
      // is never empty, flagged as an estimate.
      rows.push({
        commodityId,
        name: c.name,
        category: c.category,
        unit: c.unit,
        legality: permission.legality,
        rarity: c.rarity,
        weightKg: c.weightKg,
        volumeL: c.volumeL,
        price: 0,
        fundamental: 0,
        bid: 0,
        ask: 0,
        spreadPct: 0,
        changePct1d: 0,
        changePct7d: 0,
        changePct30d: 0,
        premiumVsFundamentalPct: 0,
        supply: 0,
        demand: 0,
        scarcityRatio: 0,
        sentiment: 0.5,
        volatility: c.volatility,
        absorbable: 0,
        onHand,
        holdingValue: 0,
        holdingCostBasis: 0,
        unrealisedPnl: 0,
        unrealisedPnlPct: 0,
        channel: permission.channel,
        tradable: permission.allowed,
        ...(permission.allowed ? {} : { denialReason: permission.reason }),
        drivers: [],
        tags: c.tags,
        shelfLifeDays: c.shelfLifeDays,
        storage: storageLabels(c),
      });
      continue;
    }

    const mods = playerModifiers(state);
    const quotes = quotedPrices(market, c, permission.channel === 'open' ? spreadReduction(mods) : spreadReduction(mods) * 0.4);
    const analytics = analyseMarket(market);
    const holdingCostBasis = round2(
      state.player.inventory
        .filter((s) => s.commodityId === commodityId)
        .reduce((sum, s) => sum + s.avgCost * s.qty, 0),
    );
    const holdingValue = round2(quotes.sell * onHand);

    rows.push({
      commodityId,
      name: c.name,
      category: c.category,
      unit: c.unit,
      legality: permission.legality,
      rarity: c.rarity,
      weightKg: c.weightKg,
      volumeL: c.volumeL,
      price: market.price,
      fundamental: market.fundamental,
      bid: quotes.sell,
      ask: quotes.buy,
      spreadPct: round2(quotes.spread * 1000) / 10,
      changePct1d: round2(analytics.change1d * 1000) / 10,
      changePct7d: round2(analytics.change7d * 1000) / 10,
      changePct30d: round2(analytics.change30d * 1000) / 10,
      premiumVsFundamentalPct: market.fundamental > 0 ? round2(((market.price / market.fundamental - 1) * 1000)) / 10 : 0,
      supply: round2(market.supply),
      demand: round2(market.demand),
      scarcityRatio: market.supply > 0 ? round2((market.demand / market.supply) * 100) / 100 : 0,
      sentiment: market.sentiment,
      volatility: round2(market.volatility * 1000) / 1000,
      absorbable: absorbableUnits(state, market, 'buy'),
      onHand,
      holdingValue,
      holdingCostBasis,
      unrealisedPnl: round2(holdingValue - holdingCostBasis),
      unrealisedPnlPct: holdingCostBasis > 0 ? round2(((holdingValue / holdingCostBasis - 1) * 1000)) / 10 : 0,
      channel: permission.channel,
      tradable: permission.allowed,
      ...(permission.allowed ? {} : { denialReason: permission.reason }),
      drivers: market.drivers.map((d) => ({ label: d.label, contributionPct: round2(d.contribution * 1000) / 10, kind: d.kind })),
      tags: c.tags,
      shelfLifeDays: c.shelfLifeDays,
      storage: storageLabels(c),
    });
  }

  const sort = opts.sort ?? 'value';
  rows.sort((a, b) => {
    switch (sort) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'price':
        return b.price - a.price;
      case 'change':
        return b.changePct1d - a.changePct1d;
      case 'premium':
        return b.premiumVsFundamentalPct - a.premiumVsFundamentalPct;
      case 'volume':
        return b.supply - a.supply;
      case 'value':
      default:
        return b.holdingValue + b.price * b.absorbable * 0.001 - (a.holdingValue + a.price * a.absorbable * 0.001);
    }
  });
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

function storageLabels(c: CommodityDef): string[] {
  switch (c.storage) {
    case 'refrigerated':
      return ['Refrigerated'];
    case 'secure':
      return ['Secure vault'];
    case 'hazardous':
      return ['Hazmat certified'];
    case 'climate':
      return ['Climate controlled'];
    default:
      return ['Standard'];
  }
}

export interface MarketDetail {
  row: MarketRow;
  history: { day: number; price: number }[];
  analytics: MarketAnalytics;
  buyQuote: TradeQuote | null;
  sellQuote: TradeQuote | null;
  permission: TradePermission;
  lawSummary: string;
  locationSummary: { name: string; country: string; region: string; kind: string; risk: number; taxRate: number; enforcement: number; corruption: number };
  bestElsewhere: { locationId: ID; name: string; price: number; marginPct: number; distanceKm: number } | null;
}

export function marketDetail(state: GameState, locationId: ID, commodityId: ID): MarketDetail | null {
  const c = registry.get(commodityId);
  const loc = worldReg.location(locationId);
  if (!c || !loc) return null;
  const rows = marketRows(state, locationId, { search: '', limit: undefined });
  const row = rows.find((r) => r.commodityId === commodityId);
  const market = ensureMarket(state, locationId, commodityId);
  if (!row || !market) return null;

  const history = market.history.map((price, i) => ({ day: market.historyStartDay + i, price }));
  const analytics = analyseMarket(market);
  const permission = tradePermission(state, locationId, c);

  // Best alternative destination, using only materialised markets (cheap) plus
  // the deterministic fundamental estimate for unvisited ones.
  let bestElsewhere: MarketDetail['bestElsewhere'] = null;
  for (const other of worldReg.locationsTrading(commodityId)) {
    if (other.id === locationId) continue;
    const otherMarket = marketAt(state, other.id, commodityId);
    const price = otherMarket ? otherMarket.price : 0;
    if (price <= 0) continue;
    const marginPct = market.price > 0 ? (price / market.price - 1) * 100 : 0;
    const distanceKm = worldReg.findPath(locationId, other.id)?.distanceKm ?? 0;
    if (!bestElsewhere || marginPct > bestElsewhere.marginPct) {
      bestElsewhere = { locationId: other.id, name: other.name, price: round2(price), marginPct: round2(marginPct * 10) / 10, distanceKm: Math.round(distanceKm) };
    }
  }

  return {
    row,
    history,
    analytics,
    buyQuote: quoteBuy(state, commodityId, 1),
    sellQuote: quoteSell(state, commodityId, 1),
    permission,
    lawSummary: describeLaw(loc, c, permission),
    locationSummary: {
      name: loc.name,
      country: loc.countryName,
      region: loc.regionName,
      kind: loc.kind,
      risk: loc.risk,
      taxRate: loc.laws.taxRate,
      enforcement: loc.laws.enforcement,
      corruption: loc.laws.corruption,
    },
    bestElsewhere,
  };
}

function describeLaw(loc: LocationDef, c: CommodityDef, permission: TradePermission): string {
  const tolerated = loc.laws.tolerated.includes(permission.legality as never);
  if (tolerated) {
    return `${c.name} is ${permission.legality} and openly traded in ${loc.name}. Sales tax ${(loc.laws.taxRate * 100).toFixed(1)}%, enforcement ${(loc.laws.enforcement * 100).toFixed(0)}%.`;
  }
  return `${c.name} is ${permission.legality} in ${loc.name} and is not tolerated openly. ${
    permission.allowed
      ? `Hidden channels (${permission.channel}) will deal at a fee, with heat ${(loc.laws.enforcement * 100).toFixed(0)}% of normal enforcement attention.`
      : permission.hint ?? 'No channel currently reaches this market.'
  }`;
}

export interface PlayerArbitrage extends ArbitrageOpportunity {
  /** Units the player could move *right now* (cash + storage + depth). */
  affordableQty: number;
  /** Units the market and the player's cash would allow with better logistics. */
  logisticsQty: number;
  /** Total weight of the logistics-limited load, for "buy a truck" guidance. */
  capacityKgNeeded: number;
  carryKg: number;
  /** Loads required at the player's current carrying capacity. */
  trips: number;
  estProfit: number;
  travelDays: number;
  travelCost: number;
  netProfit: number;
  roi: number;
  feasibleNow: boolean;
  blocker: 'none' | 'storage' | 'cash' | 'depth';
  blockerDetail: string;
}

/**
 * Arbitrage the *player* can actually execute right now, net of travel cost and
 * time. Unmaterialised destination markets are seeded on demand so the scan is
 * never artificially empty.
 */
export function playerArbitrage(state: GameState, limit = 12): PlayerArbitrage[] {
  const here = state.player.locationId;
  const holdings = new Map<ID, number>();
  for (const stack of state.player.inventory) {
    holdings.set(stack.commodityId, (holdings.get(stack.commodityId) ?? 0) + stack.qty);
  }

  // Ensure the scanner sees real prices for what the player holds plus the
  // most-liquid goods traded here.
  const loc = worldReg.location(here);
  const seeds = new Set<ID>(holdings.keys());
  for (const id of (loc?.tradedCommodityIds ?? []).slice(0, 40)) seeds.add(id);
  for (const id of seeds) materialiseArbitrageSet(state, id, 6);

  const opportunities = scanArbitrage(state.markets, { minMargin: 0.04, limit: 80 });
  const carryKg = portableCapacityKg(state, here);
  const out: PlayerArbitrage[] = [];

  for (const opp of opportunities) {
    if (opp.buyLocationId !== here) continue;
    const c = registry.get(opp.commodityId);
    if (!c) continue;
    const permission = tradePermission(state, here, c);
    if (!permission.allowed) continue;

    const quote = quoteBuy(state, opp.commodityId, 1_000_000);
    if (!quote) continue;
    const absorbable = quote.capacity.marketAbsorbable;
    const affordableCash = quote.capacity.affordable < 0 ? Number.POSITIVE_INFINITY : quote.capacity.affordable;
    const storable = quote.capacity.storable < 0 ? Number.POSITIVE_INFINITY : quote.capacity.storable;

    // Two sizes: what you can do today, and what the same trade looks like once
    // your logistics can carry it. Both are shown so the panel is never empty and
    // the player always sees the next upgrade worth buying.
    const feasibleQty = quote.qty;
    const logisticsQty = Math.max(feasibleQty, Math.min(absorbable, Math.floor(affordableCash)));
    if (logisticsQty <= 0) continue;

    const destMarket = marketAt(state, opp.sellLocationId, opp.commodityId);
    const destQuote = destMarket ? quotedPrices(destMarket, c).sell : opp.sellPrice;
    const destAbsorb = destMarket ? absorbableUnits(state, destMarket, 'sell') : logisticsQty;
    const fillable = Math.max(1, Math.min(logisticsQty, destAbsorb));

    const path = worldReg.findPath(here, opp.sellLocationId);
    const distanceKm = path?.distanceKm ?? 0;
    const mode = c.weightKg > 500 ? 'cargo_ship' : c.weightKg > 50 ? 'truck' : 'bus';
    const speed = B.travel.speedKmPerDay[mode] ?? 420;
    const perKm = B.travel.costPerKm[mode] ?? 0.09;
    const fixed = B.travel.fixedCostByMode[mode] ?? 14;
    const totalKg = round2(c.weightKg * fillable);
    const trips = Math.max(1, Math.ceil(totalKg / carryKg));
    // One journey's duration; `trips` tells the player how many loads the route
    // needs at their current carrying capacity.
    const travelDays = Math.max(1, Math.ceil(distanceKm / speed));
    const travelCost = round2((distanceKm * perKm + fixed) * trips);

    const unitCost = quote.qty > 0 ? quote.netUnitPrice : quote.effectiveUnitPrice * (1 + B.finance.bankTransactionFee);
    const destImpact = destMarket ? impactFor(destMarket, c, fillable, 'sell', priceImpactReduction(playerModifiers(state))) : 0;
    const realisedUnit = round2(Math.max(0.01, destQuote * (1 + destImpact)));
    const gross = round2(realisedUnit * fillable);
    const cost = round2(unitCost * fillable);
    const netProfit = round2(gross - cost - travelCost);
    if (netProfit <= 0) continue;

    const blocker: PlayerArbitrage['blocker'] =
      feasibleQty >= logisticsQty ? 'none' : storable < Math.min(absorbable, affordableCash) ? 'storage' : affordableCash < absorbable ? 'cash' : 'depth';
    const blockerDetail =
      blocker === 'none'
        ? 'Executable now.'
        : blocker === 'storage'
          ? `Needs ${Math.round(totalKg).toLocaleString('en-US')} kg of carrying capacity (you have ${Math.round(carryKg).toLocaleString('en-US')} kg) — a vehicle, warehouse or hidden compartment unlocks the full load.`
          : blocker === 'cash'
            ? `Cash-limited: the full load costs more than your available balance.`
            : 'Depth-limited: this market only has this many units to sell today.';

    out.push({
      ...opp,
      affordableQty: feasibleQty,
      logisticsQty: fillable,
      capacityKgNeeded: totalKg,
      carryKg: round2(carryKg),
      trips,
      estProfit: round2(gross - cost),
      travelDays,
      travelCost,
      netProfit,
      roi: cost > 0 ? round2((netProfit / cost) * 1000) / 1000 : 0,
      feasibleNow: feasibleQty > 0 && blocker === 'none',
      blocker,
      blockerDetail,
    });
  }

  out.sort((a, b) => Number(b.feasibleNow) - Number(a.feasibleNow) || b.netProfit - a.netProfit);
  return out.slice(0, limit);
}

export interface LocationMarketSummary {
  locationId: ID;
  name: string;
  country: string;
  region: string;
  kind: string;
  tradedCount: number;
  materialisedCount: number;
  hiddenChannelCount: number;
  index: number;
  cheapest: { commodityId: ID; name: string; premiumPct: number }[];
  dearest: { commodityId: ID; name: string; premiumPct: number }[];
  mostVolatile: { commodityId: ID; name: string; volatilityPct: number }[];
  biggestMovers1d: { commodityId: ID; name: string; changePct: number }[];
  taxRate: number;
  enforcement: number;
  lockdown: boolean;
  playerHeat: number;
}

export function locationMarketSummary(state: GameState, locationId: ID): LocationMarketSummary | null {
  const loc = worldReg.location(locationId);
  if (!loc) return null;
  const rows = marketRows(state, locationId, { limit: 400 });
  const withPrices = rows.filter((r) => r.price > 0);
  const byPremium = [...withPrices].sort((a, b) => a.premiumVsFundamentalPct - b.premiumVsFundamentalPct);
  const ls = state.world.locations[locationId];
  const index =
    withPrices.length > 0
      ? round2(withPrices.reduce((s, r) => s + (r.fundamental > 0 ? r.price / r.fundamental : 1), 0) / withPrices.length * 100) / 100
      : 1;

  return {
    locationId,
    name: loc.name,
    country: loc.countryName,
    region: loc.regionName,
    kind: loc.kind,
    tradedCount: loc.tradedCommodityIds.length,
    materialisedCount: withPrices.length,
    hiddenChannelCount: hiddenChannelCommodities(state, locationId).length,
    index,
    cheapest: byPremium.slice(0, 6).map((r) => ({ commodityId: r.commodityId, name: r.name, premiumPct: r.premiumVsFundamentalPct })),
    dearest: byPremium.slice(-6).reverse().map((r) => ({ commodityId: r.commodityId, name: r.name, premiumPct: r.premiumVsFundamentalPct })),
    mostVolatile: [...withPrices]
      .sort((a, b) => b.volatility - a.volatility)
      .slice(0, 6)
      .map((r) => ({ commodityId: r.commodityId, name: r.name, volatilityPct: round2(r.volatility * 100) })),
    biggestMovers1d: [...withPrices]
      .sort((a, b) => Math.abs(b.changePct1d) - Math.abs(a.changePct1d))
      .slice(0, 8)
      .map((r) => ({ commodityId: r.commodityId, name: r.name, changePct: r.changePct1d })),
    taxRate: loc.laws.taxRate,
    enforcement: loc.laws.enforcement,
    lockdown: ls?.lockdown ?? false,
    playerHeat: ls?.playerHeat ?? 0,
  };
}

/** Reputation dimensions affected by market activity, exposed for the UI. */
export function tradeReputationDimensions(): ReputationDimension[] {
  return ['business', 'legal', 'criminal', 'global'];
}

export type { MarketAnalytics };
