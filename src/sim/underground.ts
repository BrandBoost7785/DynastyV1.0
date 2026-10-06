/**
 * Underground — the darknet and digital economy (spec §15).
 *
 * Game mechanics only: no real-world wrongdoing is described or enabled. What is
 * modelled is the *economics* of an illicit market — access cost, vendor
 * reputation, escrow deposits, exit scams, information assets that decay in
 * value, skill checks against a difficulty, digital reputation as a separate
 * currency of trust, and tracing heat that feeds the enforcement systems.
 *
 * The underground is never a dead end: access is purchasable, reputation can be
 * rebuilt, and every gate has a stated route through it.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { FACTIONS } from '../engine/registry/actors';
import { getWorldRegistry } from '../engine/registry/world';
import { addItem, removeCommodity } from './inventory';
import { ensureMarket, hiddenChannelCommodities, marketAt, materialiseLocation, tradePermission } from './markets';
import { hackBonus } from './modifiers';
import { counter, grantXp, playerModifiers } from './progression';
import { addHeat, addTraceHeat, changeReputation } from './reputation';
import {
  computeNetWorth,
  creditCash,
  debitCash,
  formatMoney,
  newId,
  pushDiagnostic,
  pushNotification,
  round2,
  spendable,
} from './state';
import type { DataAsset, GameState, ID } from './types';

const B = getBalance();
const worldReg = getWorldRegistry();
const registry = getCommodityRegistry();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ------------------------------------------------------------------ */
/* Venues (simulation content data — see SHOCK_TEMPLATES in world.ts)   */
/* ------------------------------------------------------------------ */

export interface DarknetMarketSeed {
  id: ID;
  name: string;
  /** 0…1 baseline honesty: drives exit-scam risk and delivery reliability. */
  vendorReputation: number;
  escrowFeeFraction: number;
  minimumDeposit: number;
  /** Categories the venue specialises in. */
  focus: string[];
  /** Digital reputation required to see listings. */
  minDigitalReputation: number;
  locationBias: ID[];
  description: string;
}

const DARKNET_MARKETS: DarknetMarketSeed[] = [
  {
    id: 'sprawl_bazaar', name: 'Sprawl Bazaar', vendorReputation: 0.62, escrowFeeFraction: 0.045, minimumDeposit: 500,
    focus: ['narcotic', 'weapon', 'contraband_misc', 'pharmaceutical'], minDigitalReputation: 0,
    locationBias: ['bharat_metro', 'kumasi_hub', 'delta_port'],
    description: 'The oldest open market. High volume, mediocre dispute handling, and vendors who vanish when the price moves.',
  },
  {
    id: 'zero_harbour', name: 'Zero Harbour', vendorReputation: 0.81, escrowFeeFraction: 0.032, minimumDeposit: 2500,
    focus: ['information', 'electronics', 'technology', 'financial_asset'], minDigitalReputation: 8,
    locationBias: ['free_port_zero', 'sunrise_capital'],
    description: 'Invite-only venue for data and hardware. Long-standing vendors, real escrow, and a rating system people actually fear.',
  },
  {
    id: 'isthmus_exchange', name: 'Isthmus Exchange', vendorReputation: 0.54, escrowFeeFraction: 0.055, minimumDeposit: 200,
    focus: ['luxury', 'art', 'metal', 'narcotic'], minDigitalReputation: 0,
    locationBias: ['isthmus_freeport', 'westhaven'],
    description: 'Fence-fronted market for hot goods. Cheap fees, thin escrow, and a reputation for paying late or not at all.',
  },
  {
    id: 'veil_ledger', name: 'Veil Ledger', vendorReputation: 0.9, escrowFeeFraction: 0.02, minimumDeposit: 10_000,
    focus: ['information', 'financial_asset', 'crypto_asset'], minDigitalReputation: 25,
    locationBias: ['jinwan_city', 'aldrich_capital'],
    description: 'A reputation-bonded ledger market. Vendors post collateral; disputes are settled by code. Getting an invite is the hard part.',
  },
  {
    id: 'frostreach_node', name: 'Frostreach Node', vendorReputation: 0.47, escrowFeeFraction: 0.07, minimumDeposit: 100,
    focus: ['energy', 'chemical', 'weapon', 'raw_material'], minDigitalReputation: 0,
    locationBias: ['frostreach', 'polar_station', 'mine_ridge'],
    description: 'Industrial contraband out of the datacentre towns. Everything is cheap and about a third of it never arrives.',
  },
  {
    id: 'cartel_wire', name: 'Cartel Wire', vendorReputation: 0.73, escrowFeeFraction: 0.038, minimumDeposit: 5000,
    focus: ['narcotic', 'weapon', 'contraband_misc'], minDigitalReputation: 15,
    locationBias: ['valle_hoja', 'khabar_pass', 'porto_marenza'],
    description: 'A syndicate-run wholesale channel. Bulk quantities, enforced honesty, and a strong preference for known buyers.',
  },
];

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

export function buyDarknetAccess(state: GameState, rng: Rng): { ok: boolean; reason?: string; cost?: number } {
  const underground = state.player.underground;
  if (underground.accessUnlocked) return { ok: false, reason: 'You already have darknet access.' };
  const cost = round2(B.underground.accessCostOneTime * state.world.inflationIndex);
  const move = debitCash(state, cost, {
    kind: 'fee',
    description: 'Darknet access: hardware, routing and an introduction',
    allowDirty: true,
    meta: { handle: underground.handle },
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? `Access costs ${formatMoney(cost)}.` };
  underground.accessUnlocked = true;
  underground.accessGrantedDay = state.world.day;
  underground.digitalReputation = Math.max(underground.digitalReputation, 2);
  underground.knownMarketIds = DARKNET_MARKETS.filter((m) => m.minDigitalReputation <= underground.digitalReputation)
    .slice(0, 2)
    .map((m) => m.id);
  void rng;
  changeReputation(state, 'underground', 6, 'Bought darknet access');
  changeReputation(state, 'digital', 4, 'Created a darknet identity');
  addTraceHeat(state, 4, 'Buying access leaves traces');
  pushNotification(state, {
    kind: 'success',
    title: `Darknet access granted — you are "${underground.handle}"`,
    body: `${formatMoney(cost)} bought routing hardware, a clean entry node and an introduction. Known venues: ${underground.knownMarketIds.join(', ')}. Raise digital reputation to see the bonded markets.`,
    link: '/game/underground',
    metrics: [
      { label: 'Handle', value: underground.handle },
      { label: 'Digital reputation', value: String(underground.digitalReputation) },
      { label: 'Venues', value: String(underground.knownMarketIds.length) },
    ],
  });
  return { ok: true, cost };
}

export function upgradeVpn(state: GameState, targetQuality: number): { ok: boolean; reason?: string; cost?: number } {
  const underground = state.player.underground;
  const current = underground.vpnQuality;
  if (targetQuality <= current) return { ok: false, reason: 'That is not an upgrade.' };
  if (targetQuality > 0.95) return { ok: false, reason: 'Nothing above 0.95 exists — someone always sees you.' };
  const cost = round2(Math.pow((targetQuality - current) * 10, 1.7) * 900);
  const move = debitCash(state, cost, { kind: 'fee', description: `Routing and privacy upgrade to ${(targetQuality * 100).toFixed(0)}%`, allowDirty: true });
  if (!move.ok) return { ok: false, reason: move.reason ?? 'Insufficient funds.' };
  underground.vpnQuality = round2(targetQuality);
  pushNotification(state, {
    kind: 'success',
    title: 'Routing upgraded',
    body: `Trace heat now accumulates at ${((1 - clamp(targetQuality, 0, 0.85)) * 100).toFixed(0)}% of the previous rate. Cost ${formatMoney(cost)}.`,
    link: '/game/underground',
  });
  return { ok: true, cost };
}

/* ------------------------------------------------------------------ */
/* Venue views                                                         */
/* ------------------------------------------------------------------ */

export interface DarknetMarketView {
  id: ID;
  name: string;
  known: boolean;
  vendorReputation: number;
  escrowFeeFraction: number;
  minimumDeposit: number;
  focus: string[];
  minDigitalReputation: number;
  yourReputationWithThem: number;
  listings: number;
  description: string;
  accessible: boolean;
  reason?: string;
}

export function darknetMarketViews(state: GameState): DarknetMarketView[] {
  const underground = state.player.underground;
  return DARKNET_MARKETS.map((m) => {
    const known = underground.knownMarketIds.includes(m.id);
    const repOk = underground.digitalReputation >= m.minDigitalReputation;
    return {
      id: m.id,
      name: m.name,
      known,
      vendorReputation: m.vendorReputation,
      escrowFeeFraction: m.escrowFeeFraction,
      minimumDeposit: m.minimumDeposit,
      focus: m.focus,
      minDigitalReputation: m.minDigitalReputation,
      yourReputationWithThem: round2(underground.vendorRelationships[m.id] ?? 0),
      listings: known && repOk ? hiddenChannelCommodities(state, state.player.locationId, 40).filter((c) => m.focus.includes(c.category)).length : 0,
      description: m.description,
      accessible: underground.accessUnlocked && known && repOk,
      reason: !underground.accessUnlocked
        ? 'Buy darknet access first.'
        : !known
          ? 'You do not know this venue exists. Ask a faction contact or buy intel.'
          : !repOk
            ? `Requires ${m.minDigitalReputation} digital reputation (you have ${underground.digitalReputation}).`
            : undefined,
    };
  });
}

export function discoverMarket(state: GameState, marketId: ID): { ok: boolean; reason?: string } {
  const seed = DARKNET_MARKETS.find((m) => m.id === marketId);
  if (!seed) return { ok: false, reason: 'Unknown venue.' };
  const underground = state.player.underground;
  if (underground.knownMarketIds.includes(marketId)) return { ok: false, reason: 'You already know that venue.' };
  if (!underground.accessUnlocked) return { ok: false, reason: 'Buy darknet access first.' };
  underground.knownMarketIds.push(marketId);
  pushNotification(state, {
    kind: 'info',
    title: `Venue discovered: ${seed.name}`,
    body: seed.description,
    link: '/game/underground',
  });
  return { ok: true };
}

export interface DarknetListing {
  marketId: ID;
  marketName: string;
  commodityId: ID;
  name: string;
  category: string;
  legality: string;
  unitPrice: number;
  openMarketPrice: number | null;
  premiumVsOpen: number;
  escrowFee: number;
  deliveryChance: number;
  available: number;
  qty: number;
  totalWithFees: number;
  tradable: boolean;
  reason?: string;
  vendorReputation: number;
  heatOnPurchase: number;
}

export function darknetListings(state: GameState, marketId: ID, opts: { qty?: number; category?: string; search?: string } = {}): DarknetListing[] {
  const seed = DARKNET_MARKETS.find((m) => m.id === marketId);
  const underground = state.player.underground;
  if (!seed || !underground.accessUnlocked || !underground.knownMarketIds.includes(marketId)) return [];
  if (underground.digitalReputation < seed.minDigitalReputation) return [];

  const qty = Math.max(1, opts.qty ?? 1);
  const search = (opts.search ?? '').trim().toLowerCase();
  const here = state.player.locationId;
  const candidates = hiddenChannelCommodities(state, here, 60).filter((c) => seed.focus.includes(c.category));
  const relationship = underground.vendorRelationships[marketId] ?? 0;
  const deliveryChance = round2(clamp(seed.vendorReputation * 0.72 + relationship * 0.2 + underground.digitalReputation / 400 + 0.08, 0.2, 0.985));

  return candidates
    .filter((c) => (opts.category ? c.category === opts.category : true))
    .filter((c) => (search ? c.name.toLowerCase().includes(search) || c.category.includes(search) : true))
    .map((c) => {
      const market = ensureMarket(state, here, c.id);
      const openPrice = c.legality === 'legal' ? marketAt(state, here, c.id)?.price ?? null : null;
      const base = market?.price ?? c.baseValue * state.world.inflationIndex;
      // Hidden channels price above the open market where one exists, and add a
      // risk premium everywhere else.
      const unitPrice = round2(base * (1.06 + (1 - seed.vendorReputation) * 0.22 + c.risk * 0.18));
      const permission = tradePermission(state, here, c);
      const escrowFee = round2(unitPrice * qty * seed.escrowFeeFraction);
      return {
        marketId,
        marketName: seed.name,
        commodityId: c.id,
        name: c.name,
        category: c.category,
        legality: c.legality,
        unitPrice,
        openMarketPrice: openPrice,
        premiumVsOpen: openPrice && openPrice > 0 ? round2(unitPrice / openPrice - 1) : 0,
        escrowFee,
        deliveryChance,
        available: market ? Math.floor(market.supply * 0.25) : 50,
        qty,
        totalWithFees: round2(unitPrice * qty + escrowFee),
        tradable: permission.allowed || permission.code === 'requires_darknet' ? true : permission.allowed,
        ...(permission.allowed ? {} : { reason: permission.reason }),
        vendorReputation: seed.vendorReputation,
        heatOnPurchase: round2((0.8 + c.risk * 3.2) * qty * 0.15),
      };
    })
    .sort((a, b) => b.unitPrice * b.qty - a.unitPrice * a.qty);
}

/* ------------------------------------------------------------------ */
/* Escrow deposits                                                     */
/* ------------------------------------------------------------------ */

export function depositEscrow(state: GameState, amount: number): { ok: boolean; reason?: string } {
  const underground = state.player.underground;
  if (amount <= 0) return { ok: false, reason: 'Amount must be positive.' };
  const move = debitCash(state, round2(amount), {
    kind: 'deposit',
    description: 'Escrow deposit at a darknet venue',
    allowDirty: true,
    counterparty: 'Escrow agent',
    meta: { escrow: round2(underground.escrowBalance + amount) },
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? 'Insufficient funds.' };
  underground.escrowBalance = round2(underground.escrowBalance + amount);
  return { ok: true };
}

export function withdrawEscrow(state: GameState, amount: number): { ok: boolean; reason?: string } {
  const underground = state.player.underground;
  const take = round2(Math.min(Math.max(0, amount), underground.escrowBalance));
  if (take <= 0) return { ok: false, reason: 'No escrow balance to withdraw.' };
  underground.escrowBalance = round2(underground.escrowBalance - take);
  creditCash(state, take, { kind: 'withdraw', description: 'Escrow withdrawal', dirty: true, counterparty: 'Escrow agent' });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Trading through a venue                                             */
/* ------------------------------------------------------------------ */

export interface DarknetTradeResult {
  ok: boolean;
  reason?: string;
  delivered: boolean;
  qty: number;
  paid: number;
  escrowUsed: number;
  lost: number;
  heat: number;
  reputationGain: number;
  warnings: string[];
}

export function buyFromVenue(state: GameState, rng: Rng, marketId: ID, commodityId: ID, qty: number): DarknetTradeResult {
  const seed = DARKNET_MARKETS.find((m) => m.id === marketId);
  const underground = state.player.underground;
  const warnings: string[] = [];
  const empty: DarknetTradeResult = { ok: false, reason: '', delivered: false, qty: 0, paid: 0, escrowUsed: 0, lost: 0, heat: 0, reputationGain: 0, warnings };
  if (!seed) return { ...empty, reason: 'Unknown venue.' };
  if (!underground.accessUnlocked) return { ...empty, reason: 'You do not have darknet access.' };
  if (!underground.knownMarketIds.includes(marketId)) return { ...empty, reason: 'You do not know that venue.' };
  if (underground.compromised) return { ...empty, reason: 'Your identity is compromised — trading now would be traced immediately. Wait it out or burn the handle.' };

  const c = registry.get(commodityId);
  if (!c) return { ...empty, reason: 'Unknown commodity.' };
  const amount = Math.max(1, Math.floor(qty));
  const listings = darknetListings(state, marketId, { qty: amount });
  const listing = listings.find((l) => l.commodityId === commodityId);
  if (!listing) return { ...empty, reason: `${c.name} is not listed at ${seed.name}.` };

  const total = listing.totalWithFees;
  if (total > spendable(state.player, state.world.day, true)) {
    return { ...empty, reason: `That costs ${formatMoney(total)} including escrow fees.` };
  }

  // Pay from the escrow deposit first, then from cash.
  const fromEscrow = round2(Math.min(underground.escrowBalance, total));
  if (fromEscrow > 0) underground.escrowBalance = round2(underground.escrowBalance - fromEscrow);
  const fromCash = round2(total - fromEscrow);
  if (fromCash > 0) {
    const move = debitCash(state, fromCash, {
      kind: 'buy',
      description: `Darknet purchase: ${amount} × ${c.name} via ${seed.name}`,
      allowDirty: true,
      commodityId: c.id,
      qty: amount,
      unitPrice: listing.unitPrice,
      counterparty: `${seed.name} vendor`,
      meta: { marketId, escrowFee: listing.escrowFee, deliveryChance: listing.deliveryChance },
    });
    if (!move.ok) {
      underground.escrowBalance = round2(underground.escrowBalance + fromEscrow);
      return { ...empty, reason: move.reason ?? 'Payment failed.' };
    }
  }

  // Delivery roll: escrow protects the buyer from non-delivery, but the vendor
  // can still disappear with a deposit-backed order.
  const scamChance = clamp(B.underground.exitScamChancePerVendorPerDay * 22 * (1.4 - seed.vendorReputation) * (1 - (underground.vendorRelationships[marketId] ?? 0) * 0.35), 0.005, 0.4);
  const delivered = rng.chance(listing.deliveryChance) && !rng.chance(scamChance);

  const heat = listing.heatOnPurchase;
  addHeat(state, heat, `Bought ${amount} × ${c.name} on ${seed.name}`);
  addTraceHeat(state, B.underground.traceHeatPerIllegalTransaction * Math.min(10, 1 + total / 20_000), 'Darknet purchase');

  if (delivered) {
    const added = addItem(state, { commodityId: c.id, qty: amount, avgCost: round2(total / amount), concealed: true, origin: 'purchased' });
    if (!added.ok) {
      warnings.push(`The goods arrived but you cannot store them here: ${added.message ?? added.problem}. They were left with the courier and lost.`);
    }
    underground.vendorRelationships[marketId] = round2(clamp((underground.vendorRelationships[marketId] ?? 0) + 0.02, 0, 1));
    underground.digitalReputation = round2(clamp(underground.digitalReputation + 0.35 + amount * 0.004, 0, 100));
    changeReputation(state, 'underground', 0.5, `Bought on ${seed.name}`);
    changeReputation(state, 'digital', 0.25, 'Completed a darknet trade');
    pushNotification(state, {
      kind: 'success',
      title: `Delivery confirmed: ${amount} × ${c.name}`,
      body: `${seed.name} released escrow. Total ${formatMoney(total)} (${(listing.escrowFee / Math.max(1, total) * 100).toFixed(1)}% fees), delivery chance was ${(listing.deliveryChance * 100).toFixed(0)}%, heat +${heat}.`,
      link: '/game/underground',
      metrics: [
        { label: 'Paid', value: formatMoney(total) },
        { label: 'Unit', value: formatMoney(listing.unitPrice) },
        { label: 'Heat', value: `+${heat}` },
      ],
    });
    return { ok: true, delivered: true, qty: added.ok ? added.qty : 0, paid: total, escrowUsed: fromEscrow, lost: 0, heat, reputationGain: 0.35, warnings };
  }

  // Non-delivery: escrow refunds most of it, but the vendor keeps the fee and
  // your deposit exposure is at risk.
  const refund = round2((total - listing.escrowFee) * (underground.escrowBalance >= 0 ? 0.82 : 0.6));
  const lost = round2(total - refund);
  underground.escrowBalance = round2(underground.escrowBalance + refund);
  underground.vendorRelationships[marketId] = round2(clamp((underground.vendorRelationships[marketId] ?? 0) - 0.08, -0.5, 1));
  changeReputation(state, 'underground', -0.6, 'A darknet vendor failed to deliver');
  bumpCounterSafe(state, 'exit_scams');
  pushNotification(state, {
    kind: 'danger',
    title: `No delivery from ${seed.name}`,
    body: `The vendor took the order and vanished. Escrow returned ${formatMoney(refund)} to your deposit; you lost ${formatMoney(lost)} including the fee. Venue reputation ${(seed.vendorReputation * 100).toFixed(0)}%, scam chance was ${(scamChance * 100).toFixed(1)}%.`,
    link: '/game/underground',
    metrics: [
      { label: 'Lost', value: formatMoney(lost) },
      { label: 'Refunded to escrow', value: formatMoney(refund) },
    ],
  });
  return { ok: true, delivered: false, qty: 0, paid: total, escrowUsed: fromEscrow, lost, heat, reputationGain: 0, warnings };
}

export function sellToVenue(state: GameState, rng: Rng, marketId: ID, commodityId: ID, qty: number): { ok: boolean; reason?: string; proceeds?: number; heat?: number } {
  const seed = DARKNET_MARKETS.find((m) => m.id === marketId);
  const underground = state.player.underground;
  if (!seed || !underground.accessUnlocked) return { ok: false, reason: 'You do not have access to that venue.' };
  const c = registry.get(commodityId);
  if (!c) return { ok: false, reason: 'Unknown commodity.' };
  const market = ensureMarket(state, state.player.locationId, commodityId);
  const base = market?.price ?? c.baseValue;
  const unitPrice = round2(base * (0.86 - (1 - seed.vendorReputation) * 0.12));
  const amount = Math.max(1, Math.floor(qty));
  const gross = round2(unitPrice * amount);
  const fee = round2(gross * seed.escrowFeeFraction);
  const proceeds = round2(gross - fee);

  const removed = removeCommodityLocal(state, commodityId, amount);
  if (removed <= 0) return { ok: false, reason: `You have no ${c.name} in storage here.` };

  creditCash(state, proceeds, {
    kind: 'sell',
    description: `Darknet sale: ${removed} × ${c.name} via ${seed.name}`,
    dirty: true,
    commodityId: c.id,
    qty: removed,
    unitPrice,
    counterparty: `${seed.name} buyer`,
    meta: { marketId, fee },
  });
  const heat = round2((0.6 + c.risk * 2.6) * removed * 0.12);
  addHeat(state, heat, `Sold ${removed} × ${c.name} on ${seed.name}`);
  addTraceHeat(state, B.underground.traceHeatPerIllegalTransaction * Math.min(8, 1 + proceeds / 25_000), 'Darknet sale');
  underground.digitalReputation = round2(clamp(underground.digitalReputation + 0.3, 0, 100));
  underground.vendorRelationships[marketId] = round2(clamp((underground.vendorRelationships[marketId] ?? 0) + 0.015, 0, 1));
  changeReputation(state, 'underground', 0.4, `Sold on ${seed.name}`);
  void rng;
  pushDiagnostic(state, {
    system: 'underground',
    level: 'info',
    message: `Darknet sale ${removed} × ${c.id} via ${marketId} at ${unitPrice} (open ${base.toFixed(2)}), proceeds ${proceeds}, heat +${heat}`,
    data: { qty: removed, unitPrice, proceeds, heat },
  });
  return { ok: true, proceeds, heat };
}

function removeCommodityLocal(state: GameState, commodityId: ID, qty: number): number {
  return removeCommodity(state, commodityId, qty, state.player.locationId).removed;
}

function bumpCounterSafe(state: GameState, key: string, delta = 1): void {
  const counters = state.player.stats.counters;
  counters[key] = (counters[key] ?? 0) + delta;
}

/* ------------------------------------------------------------------ */
/* Information assets                                                  */
/* ------------------------------------------------------------------ */

export interface DataAssetOffer {
  kind: DataAsset['kind'];
  name: string;
  price: number;
  baseValue: number;
  freshnessPerDay: number;
  riskOnHold: number;
  buyers: string;
  description: string;
}

const DATA_CATALOGUE: DataAssetOffer[] = [
  { kind: 'intel', name: 'Location intel', price: 4200, baseValue: 6800, freshnessPerDay: 0.02, riskOnHold: 0.05, buyers: 'Traders and factions', description: 'Coordinates and access notes for a hidden location. Buys you a route nobody else has.' },
  { kind: 'market_data', name: 'Market data feed', price: 9000, baseValue: 15_500, freshnessPerDay: 0.055, riskOnHold: 0.04, buyers: 'Brokers and competitors', description: 'Order flow from a regional exchange. Stale within days, valuable while fresh.' },
  { kind: 'credentials', name: 'Corporate credentials', price: 16_500, baseValue: 27_000, freshnessPerDay: 0.075, riskOnHold: 0.22, buyers: 'Fixers and rivals', description: 'Working logins to a logistics back office. Rotated often, and holding them is dangerous.' },
  { kind: 'blueprint', name: 'Process blueprint', price: 32_000, baseValue: 58_000, freshnessPerDay: 0.008, riskOnHold: 0.09, buyers: 'Manufacturers', description: 'A production process someone spent years tuning. Barely depreciates.' },
  { kind: 'ledger', name: 'Encrypted ledger', price: 21_000, baseValue: 34_500, freshnessPerDay: 0.012, riskOnHold: 0.16, buyers: 'Investigators and blackmailers', description: 'Somebody\u2019s private books. Worth a fortune to the right buyer and a prison sentence to you if traced.' },
  { kind: 'blackmail', name: 'Compromising dossier', price: 48_000, baseValue: 92_000, freshnessPerDay: 0.004, riskOnHold: 0.3, buyers: 'Factions and rivals', description: 'Leverage over a named individual. Highest value, highest risk, and it never expires quietly.' },
  { kind: 'exploit', name: 'Zero-day exploit', price: 120_000, baseValue: 240_000, freshnessPerDay: 0.09, riskOnHold: 0.35, buyers: 'State actors and syndicates', description: 'A working exploit against a common system. Enormous value that evaporates the first time it is patched.' },
];

export function dataOffers(state: GameState): DataAssetOffer[] {
  const multiplier = 1 + (state.player.underground.digitalReputation / 100) * 0.35;
  return DATA_CATALOGUE.map((offer) => ({
    ...offer,
    price: round2(offer.price * multiplier * state.world.inflationIndex),
    baseValue: round2(offer.baseValue * multiplier * state.world.inflationIndex),
  }));
}

export function buyDataAsset(state: GameState, rng: Rng, kind: DataAsset['kind'], targetId?: ID): { ok: boolean; reason?: string; asset?: DataAsset } {
  const underground = state.player.underground;
  if (!underground.accessUnlocked) return { ok: false, reason: 'Buy darknet access first.' };
  const offer = dataOffers(state).find((o) => o.kind === kind);
  if (!offer) return { ok: false, reason: 'Unknown data type.' };
  const move = debitCash(state, offer.price, {
    kind: 'buy',
    description: `Bought ${offer.name}`,
    allowDirty: true,
    counterparty: 'Data broker',
    meta: { kind, price: offer.price },
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? `${offer.name} costs ${formatMoney(offer.price)}.` };

  const asset: DataAsset = {
    id: newId(rng, 'data'),
    name: offer.name,
    kind,
    acquiredDay: state.world.day,
    baseValue: offer.baseValue,
    freshness: 1,
    targetId: targetId ?? randomTarget(state, rng, kind),
    sold: false,
    riskOnHold: offer.riskOnHold,
  };
  underground.dataAssets.push(asset);
  underground.digitalReputation = round2(clamp(underground.digitalReputation + 1.2, 0, 100));
  addTraceHeat(state, offer.riskOnHold * 6, `Holding ${offer.name}`);
  pushNotification(state, {
    kind: 'success',
    title: `Acquired: ${offer.name}`,
    body: `${offer.description} Value decays ${(offer.freshnessPerDay * 100).toFixed(1)}%/day while you hold it, and holding carries ${(offer.riskOnHold * 100).toFixed(0)}% exposure.`,
    link: '/game/underground',
    metrics: [
      { label: 'Paid', value: formatMoney(offer.price) },
      { label: 'Value now', value: formatMoney(assetValue(state, asset)) },
      { label: 'Decay/day', value: `${(offer.freshnessPerDay * 100).toFixed(1)}%` },
    ],
  });
  return { ok: true, asset };
}

function randomTarget(state: GameState, rng: Rng, kind: DataAsset['kind']): ID {
  switch (kind) {
    case 'intel':
      return rng.pick(worldReg.locations.filter((l) => l.hidden))?.id ?? rng.pick(worldReg.locations)!.id;
    case 'credentials':
    case 'ledger':
    case 'market_data':
      return rng.pick(Object.keys(state.world.companies));
    case 'blackmail':
      return rng.pick(FACTIONS)?.id ?? 'unknown';
    case 'blueprint':
      return rng.pick(state.player.productionLines.map((l) => l.recipeId)) ?? 'unknown';
    case 'exploit':
      return rng.pick(['avalon_digital', 'jinwan_bit', 'jade_gateway']);
    default:
      return 'unknown';
  }
}

export function assetValue(state: GameState, asset: DataAsset): number {
  return round2(asset.baseValue * asset.freshness * state.world.inflationIndex);
}

export function sellDataAsset(state: GameState, assetId: ID): { ok: boolean; reason?: string; proceeds?: number; heat?: number } {
  const underground = state.player.underground;
  const asset = underground.dataAssets.find((a) => a.id === assetId && !a.sold);
  if (!asset) return { ok: false, reason: 'No such data asset.' };
  const offer = DATA_CATALOGUE.find((o) => o.kind === asset.kind);
  const value = assetValue(state, asset);
  if (value < 100) return { ok: false, reason: 'The asset has decayed to the point where nobody will buy it.' };

  const buyerMultiplier = 0.72 + (underground.digitalReputation / 100) * 0.5 + clamp(underground.vendorRelationships['zero_harbour'] ?? 0, 0, 0.3);
  const proceeds = round2(value * buyerMultiplier);
  asset.sold = true;
  creditCash(state, proceeds, {
    kind: 'sell',
    description: `Sold ${asset.name} (freshness ${(asset.freshness * 100).toFixed(0)}%)`,
    dirty: true,
    counterparty: 'Data buyer',
    meta: { kind: asset.kind, freshness: asset.freshness },
  });
  const heat = round2((offer?.riskOnHold ?? 0.1) * 14);
  addHeat(state, heat, `Sold ${asset.name}`);
  addTraceHeat(state, heat * 0.8, 'Data sale');
  underground.digitalReputation = round2(clamp(underground.digitalReputation + 2.2, 0, 100));
  changeReputation(state, 'digital', 1.8, 'Sold information');
  changeReputation(state, 'underground', 1.2, 'Sold information');
  bumpCounterSafe(state, 'data_sold');
  setCounterSafe(state, 'data_revenue', round2(counter(state, 'data_revenue') + proceeds));
  underground.dataAssets = underground.dataAssets.filter((a) => a.id !== assetId);
  pushNotification(state, {
    kind: 'success',
    title: `${asset.name} sold for ${formatMoney(proceeds)}`,
    body: `Freshness was ${(asset.freshness * 100).toFixed(0)}%. Heat +${heat}. Buyers pay ${(buyerMultiplier * 100).toFixed(0)}% of assessed value at your digital reputation.`,
    link: '/game/underground',
    metrics: [
      { label: 'Proceeds', value: formatMoney(proceeds) },
      { label: 'Heat', value: `+${heat}` },
    ],
  });
  return { ok: true, proceeds, heat };
}

function setCounterSafe(state: GameState, key: string, value: number): void {
  state.player.stats.counters[key] = Number.isFinite(value) ? value : 0;
}

/* ------------------------------------------------------------------ */
/* Hacking                                                             */
/* ------------------------------------------------------------------ */

export interface HackTarget {
  kind: 'company' | 'bank' | 'exchange' | 'faction' | 'venue';
  targetId: ID;
  name: string;
  difficulty: number;
  successChance: number;
  rewardEstimate: number;
  heatOnFailure: number;
  traceHeat: number;
  lootKind: DataAsset['kind'];
  description: string;
}

export function hackTargets(state: GameState): HackTarget[] {
  const mods = playerModifiers(state);
  const skillBonus = hackBonus(mods);
  const repBonus = state.player.underground.digitalReputation / 220;
  const out: HackTarget[] = [];

  for (const [companyId, company] of Object.entries(state.world.companies).slice(0, 14)) {
    if (company.status !== 'active') continue;
    const difficulty = round2(B.underground.hackingBaseDifficulty + company.fundamentalsQuality * 26 + (1 - company.sentiment) * 12);
    out.push({
      kind: 'company',
      targetId: companyId,
      name: companyId,
      difficulty,
      successChance: round2(clamp(0.08 + skillBonus * 1.5 + repBonus - difficulty / 260, 0.01, 0.86)),
      rewardEstimate: round2(company.price * company.sharesOutstanding * 0.00004 + 4200),
      heatOnFailure: round2(9 + difficulty * 0.2),
      traceHeat: round2(3 + difficulty * 0.08),
      lootKind: rngPickKind(companyId, ['market_data', 'ledger', 'credentials']),
      description: 'Ledger access: inside information about earnings and order flow.',
    });
  }
  for (const account of state.player.accounts.filter((a) => a.kind === 'offshore' || a.kind === 'shell').slice(0, 2)) {
    void account;
  }
  out.push({
    kind: 'bank',
    targetId: 'meridian_holdings',
    name: 'Meridian Trust settlement layer',
    difficulty: round2(B.underground.hackingBaseDifficulty + 46),
    successChance: round2(clamp(0.04 + skillBonus * 1.4 + repBonus - 0.34, 0.005, 0.6)),
    rewardEstimate: round2(computeNetWorth(state).total * 0.12 + 40_000),
    heatOnFailure: 34,
    traceHeat: 18,
    lootKind: 'ledger',
    description: 'Extremely well defended. Success is a career-defining payout; failure is an investigation.',
  });
  out.push({
    kind: 'exchange',
    targetId: 'jinwan_bit',
    name: 'Jinwan Bit hot wallet',
    difficulty: round2(B.underground.hackingBaseDifficulty + 38),
    successChance: round2(clamp(0.05 + skillBonus * 1.5 + repBonus - 0.28, 0.005, 0.65)),
    rewardEstimate: 180_000,
    heatOnFailure: 22,
    traceHeat: 14,
    lootKind: 'credentials',
    description: 'Exchange custody is the soft target of the crypto economy — and every failure makes the next one harder.',
  });
  for (const faction of FACTIONS.filter((f) => f.kind === 'criminal_syndicate' || f.kind === 'cartel' || f.kind === 'intelligence').slice(0, 4)) {
    const difficulty = round2(B.underground.hackingBaseDifficulty + faction.power * 52);
    out.push({
      kind: 'faction',
      targetId: faction.id,
      name: faction.name,
      difficulty,
      successChance: round2(clamp(0.07 + skillBonus * 1.5 + repBonus - difficulty / 250, 0.01, 0.8)),
      rewardEstimate: round2(faction.resources * 0.004 + 9000),
      heatOnFailure: round2(12 + faction.power * 18),
      traceHeat: round2(6 + faction.power * 8),
      lootKind: 'blackmail',
      description: 'Their comms. Leverage over a faction is worth more than the money in it.',
    });
  }
  for (const market of DARKNET_MARKETS.filter((m) => state.player.underground.knownMarketIds.includes(m.id))) {
    const difficulty = round2(B.underground.hackingBaseDifficulty * 0.7 + (1 - market.vendorReputation) * 30);
    out.push({
      kind: 'venue',
      targetId: market.id,
      name: `${market.name} escrow`,
      difficulty,
      successChance: round2(clamp(0.12 + skillBonus * 1.6 + repBonus - difficulty / 220, 0.02, 0.88)),
      rewardEstimate: round2(state.player.underground.escrowBalance * 0.4 + 12_000),
      heatOnFailure: round2(6 + difficulty * 0.15),
      traceHeat: round2(4 + difficulty * 0.1),
      lootKind: 'exploit',
      description: 'Drain the escrow pool. The venue will blacklist your handle permanently if you fail.',
    });
  }
  return out.sort((a, b) => b.successChance - a.successChance);
}

function rngPickKind(seed: string, kinds: DataAsset['kind'][]): DataAsset['kind'] {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return kinds[hash % kinds.length]!;
}

export interface HackResult {
  ok: boolean;
  reason?: string;
  success: boolean;
  target: HackTarget;
  cash: number;
  asset: DataAsset | null;
  xp: number;
  heat: number;
  traceHeat: number;
  reputationGain: number;
  cooldownUntilDay: number | null;
  compromised: boolean;
}

export function hack(state: GameState, rng: Rng, kind: HackTarget['kind'], targetId: ID): HackResult {
  const underground = state.player.underground;
  const target = hackTargets(state).find((t) => t.kind === kind && t.targetId === targetId);
  const fail: Omit<HackResult, 'target'> = {
    ok: false,
    success: false,
    cash: 0,
    asset: null,
    xp: 0,
    heat: 0,
    traceHeat: 0,
    reputationGain: 0,
    cooldownUntilDay: underground.hackCooldownUntilDay,
    compromised: false,
  };
  if (!target) return { ...fail, reason: 'Unknown target.', target: target ?? ({} as HackTarget) } as HackResult;
  if (!underground.accessUnlocked) return { ...fail, reason: 'You need darknet access.', target };
  if (underground.hackCooldownUntilDay !== null && state.world.day < underground.hackCooldownUntilDay) {
    return { ...fail, reason: `Your tooling is burned out until day ${underground.hackCooldownUntilDay}.`, target };
  }

  const mods = playerModifiers(state);
  const chance = clamp(target.successChance + (underground.vpnQuality - 0.2) * 0.08, 0.01, 0.92);
  underground.hackCooldownUntilDay = state.world.day + (rng.chance(0.5) ? 1 : 2);
  void mods;

  if (rng.chance(chance)) {
    const payout = round2(target.rewardEstimate * rng.float(0.55, 1.5) * B.underground.hackingRewardMultiplier * 0.6);
    creditCash(state, payout, {
      kind: 'combat_loot',
      description: `Intrusion payout: ${target.name}`,
      dirty: true,
      counterparty: target.name,
      meta: { kind, difficulty: target.difficulty, chance },
    });
    const asset: DataAsset = {
      id: newId(rng, 'data'),
      name: `${target.name} — ${target.lootKind}`,
      kind: target.lootKind,
      acquiredDay: state.world.day,
      baseValue: round2(payout * 0.8 + target.rewardEstimate * 0.4),
      freshness: 1,
      targetId,
      sold: false,
      riskOnHold: round2(clamp(target.difficulty / 160, 0.05, 0.5)),
    };
    underground.dataAssets.push(asset);
    const repGain = round2(3 + target.difficulty / 12);
    underground.digitalReputation = round2(clamp(underground.digitalReputation + repGain, 0, 100));
    changeReputation(state, 'digital', repGain * 0.6, `Breached ${target.name}`);
    changeReputation(state, 'underground', repGain * 0.4, `Breached ${target.name}`);
    const heat = round2(target.heatOnFailure * 0.25);
    const trace = round2(target.traceHeat * 0.4);
    addHeat(state, heat, `Intrusion against ${target.name}`);
    addTraceHeat(state, trace, 'Intrusion traffic');
    bumpCounterSafe(state, 'hacks_success');
    setCounterSafe(state, 'hack_revenue', round2(counter(state, 'hack_revenue') + payout));
    const xp = grantXp(state, Math.round(40 + target.difficulty * 3.2), `Breached ${target.name}`).granted;
    pushNotification(state, {
      kind: 'success',
      title: `Breach successful: ${target.name}`,
      body: `Took ${formatMoney(payout)} and a ${asset.name} asset worth about ${formatMoney(assetValue(state, asset))}. Chance was ${(chance * 100).toFixed(0)}% against difficulty ${target.difficulty.toFixed(0)}. Digital reputation +${repGain}.`,
      link: '/game/underground',
      metrics: [
        { label: 'Cash', value: formatMoney(payout) },
        { label: 'Asset', value: asset.name },
        { label: 'XP', value: String(xp) },
        { label: 'Trace heat', value: `+${trace}` },
      ],
    });
    return { ok: true, success: true, target, cash: payout, asset, xp, heat, traceHeat: trace, reputationGain: repGain, cooldownUntilDay: underground.hackCooldownUntilDay, compromised: false };
  }

  const heat = round2(target.heatOnFailure * rng.float(0.7, 1.3));
  const trace = round2(target.traceHeat * rng.float(1, 1.8));
  addHeat(state, heat, `Failed intrusion against ${target.name}`);
  addTraceHeat(state, trace, 'Failed intrusion');
  underground.digitalReputation = round2(clamp(underground.digitalReputation - rng.float(2, 7), 0, 100));
  underground.vendorRelationships[targetId] = round2(clamp((underground.vendorRelationships[targetId] ?? 0) - 0.3, -0.6, 1));
  changeReputation(state, 'digital', -4, `Failed to breach ${target.name}`);
  bumpCounterSafe(state, 'hacks_failed');
  const compromised = rng.chance(clamp(trace / 60, 0.05, 0.5));
  if (compromised) {
    underground.compromised = true;
    underground.compromisedUntilDay = state.world.day + rng.int(4, 14);
  }
  if (target.kind === 'company' && state.world.companies[target.targetId]) {
    state.world.companies[target.targetId]!.sentiment = round2(clamp(state.world.companies[target.targetId]!.sentiment - 0.02, 0.02, 0.99));
  }
  pushNotification(state, {
    kind: 'danger',
    title: `Breach failed: ${target.name}`,
    body: `You were detected. Heat +${heat}, trace heat +${trace}, digital reputation down. Chance was ${(chance * 100).toFixed(0)}% against difficulty ${target.difficulty.toFixed(0)}.${compromised ? ` Your identity is compromised until day ${underground.compromisedUntilDay} — trading now is traced.` : ''}`,
    link: '/game/underground',
    metrics: [
      { label: 'Heat', value: `+${heat}` },
      { label: 'Trace heat', value: `+${trace}` },
    ],
  });
  return { ok: true, success: false, target, cash: 0, asset: null, xp: 0, heat, traceHeat: trace, reputationGain: 0, cooldownUntilDay: underground.hackCooldownUntilDay, compromised };
}

export function burnHandle(state: GameState, rng: Rng): { ok: boolean; reason?: string; newHandle?: string } {
  const underground = state.player.underground;
  if (!underground.accessUnlocked) return { ok: false, reason: 'You have no handle to burn.' };
  const cost = round2(1200 + underground.traceHeat * 90);
  const move = debitCash(state, cost, { kind: 'fee', description: 'Burned the current handle and rebuilt routing', allowDirty: true });
  if (!move.ok) return { ok: false, reason: move.reason ?? `Burning a handle costs ${formatMoney(cost)}.` };
  const handle = underground.handle;
  underground.handle = `${newHandle(rng)}`;
  underground.traceHeat = 0;
  underground.compromised = false;
  underground.compromisedUntilDay = null;
  underground.digitalReputation = round2(underground.digitalReputation * 0.45);
  underground.vendorRelationships = {};
  changeReputation(state, 'digital', -6, 'Burned a handle');
  pushNotification(state, {
    kind: 'warning',
    title: 'Handle burned',
    body: `"${handle}" is gone and you are now "${underground.handle}". Trace heat cleared and the compromise lifted, but digital reputation fell to ${underground.digitalReputation} and every vendor relationship reset. Cost ${formatMoney(cost)}.`,
    link: '/game/underground',
  });
  return { ok: true, newHandle: underground.handle };
}

function newHandle(rng: Rng): string {
  const a = ['null', 'ghost', 'zero', 'static', 'cipher', 'vector', 'hex', 'onyx', 'pale', 'iron'];
  const b = ['wave', 'market', 'index', 'runner', 'ledger', 'fox', 'crow', 'hand', 'wire', 'gate'];
  return `${rng.pick(a)}_${rng.pick(b)}${rng.int(10, 99)}`;
}

/* ------------------------------------------------------------------ */
/* Daily tick                                                          */
/* ------------------------------------------------------------------ */

export interface UndergroundTickResult {
  escrowLost: number;
  assetDecayValue: number;
  breaches: number;
  compromised: boolean;
  assetsHeld: number;
  heatDecayed: number;
}

export function undergroundTick(state: GameState, rng: Rng): UndergroundTickResult {
  const underground = state.player.underground;
  const result: UndergroundTickResult = { escrowLost: 0, assetDecayValue: 0, breaches: 0, compromised: underground.compromised, assetsHeld: underground.dataAssets.length, heatDecayed: 0 };
  if (!underground.accessUnlocked) return result;

  // Exit scams against escrow deposits.
  if (underground.escrowBalance > 0) {
    const venues = underground.knownMarketIds.length;
    const chance = clamp(B.underground.exitScamChancePerVendorPerDay * venues * (1 + underground.escrowBalance / 250_000), 0, 0.06);
    if (rng.chance(chance)) {
      const lost = round2(underground.escrowBalance * rng.float(0.25, 0.9));
      underground.escrowBalance = round2(underground.escrowBalance - lost);
      result.escrowLost = lost;
      pushNotification(state, {
        kind: 'danger',
        title: 'Escrow deposit raided',
        body: `A venue operator disappeared with ${formatMoney(lost)} of your deposit. Self-custody and small balances are the only real defence.`,
        link: '/game/underground',
      });
    }
  }

  // Data assets decay and can expose you.
  for (const asset of underground.dataAssets) {
    const offer = DATA_CATALOGUE.find((o) => o.kind === asset.kind);
    const decay = offer?.freshnessPerDay ?? 0.03;
    const before = assetValue(state, asset);
    asset.freshness = round2(clamp(asset.freshness - decay * rng.float(0.7, 1.3), 0, 1));
    result.assetDecayValue = round2(result.assetDecayValue + Math.max(0, before - assetValue(state, asset)));
    if (rng.chance(asset.riskOnHold * 0.02)) {
      result.breaches += 1;
      const heat = round2(4 + asset.riskOnHold * 18);
      addHeat(state, heat, `Holding ${asset.name} was noticed`);
      addTraceHeat(state, heat * 0.6, 'Data asset exposure');
      pushNotification(state, {
        kind: 'danger',
        title: 'Your data holding was noticed',
        body: `${asset.name} is linked to you. Heat +${heat}. Sell it or destroy it.`,
        link: '/game/underground',
      });
    }
  }
  underground.dataAssets = underground.dataAssets.filter((a) => a.freshness > 0.02);

  // Network-level breach events (exchange hacks) affect the whole economy.
  if (rng.chance(B.underground.dataBreachChancePerDay)) {
    const victim = rng.pick(['avalon_digital', 'jinwan_bit', 'jade_gateway', 'isthmus_swap']);
    if (victim) {
      result.breaches += 1;
      pushNotification(state, {
        kind: 'warning',
        title: `Breach reported at ${victim}`,
        body: 'Client data was exfiltrated. Expect tighter controls, frozen withdrawals and a wave of traced transactions across the digital economy.',
        link: '/game/underground',
      });
      addTraceHeat(state, rng.float(1.5, 6), 'Sector-wide breach raised scrutiny');
      for (const account of state.player.underground.exchangeAccounts.filter((a) => a.exchangeId === victim)) {
        account.frozenUntilDay = state.world.day + rng.int(2, 12);
      }
    }
  }

  // VPN quality degrades; routing needs maintenance.
  if (underground.vpnQuality > 0.2 && rng.chance(0.25)) {
    underground.vpnQuality = round2(clamp(underground.vpnQuality - rng.float(0.005, 0.02), 0.2, 0.95));
  }
  if (underground.compromised && underground.compromisedUntilDay !== null && state.world.day >= underground.compromisedUntilDay) {
    underground.compromised = false;
    underground.compromisedUntilDay = null;
    pushNotification(state, { kind: 'success', title: 'Identity cleared', body: 'The traces went cold. You can trade and hack again without immediate attribution.', link: '/game/underground' });
  }
  result.compromised = underground.compromised;
  result.assetsHeld = underground.dataAssets.length;

  // Vendor relationships cool off without trade.
  for (const [id, value] of Object.entries(underground.vendorRelationships)) {
    if (value > 0) underground.vendorRelationships[id] = round2(clamp(value - 0.004, 0, 1));
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export interface UndergroundView {
  accessUnlocked: boolean;
  accessCost: number;
  handle: string;
  digitalReputation: number;
  digitalReputationLabel: string;
  escrowBalance: number;
  traceHeat: number;
  traceHeatLabel: string;
  vpnQuality: number;
  vpnUpgradeCost: number;
  compromised: boolean;
  compromisedUntilDay: number | null;
  hackCooldownUntilDay: number | null;
  markets: DarknetMarketView[];
  assets: {
    id: ID;
    name: string;
    kind: DataAsset['kind'];
    acquiredDay: number;
    ageDays: number;
    freshness: number;
    value: number;
    baseValue: number;
    riskOnHold: number;
    targetId: ID | null;
    decayPerDay: number;
  }[];
  dataOffers: DataAssetOffer[];
  hackTargets: HackTarget[];
  hiddenChannelListings: number;
  stats: { dataSold: number; dataRevenue: number; hacksSuccess: number; hacksFailed: number; exitScams: number; hackRevenue: number };
}

export function undergroundView(state: GameState): UndergroundView {
  const underground = state.player.underground;
  const rep = underground.digitalReputation;
  return {
    accessUnlocked: underground.accessUnlocked,
    accessCost: round2(B.underground.accessCostOneTime * state.world.inflationIndex),
    handle: underground.handle,
    digitalReputation: rep,
    digitalReputationLabel: rep >= 70 ? 'Trusted operator' : rep >= 45 ? 'Known handle' : rep >= 20 ? 'Established' : rep >= 8 ? 'Newcomer' : 'Nobody',
    escrowBalance: round2(underground.escrowBalance),
    traceHeat: underground.traceHeat,
    traceHeatLabel:
      underground.traceHeat > 80
        ? 'Attribution likely — burn the handle'
        : underground.traceHeat > 45
          ? 'Investigators are closing in'
          : underground.traceHeat > 18
            ? 'Some traffic has been logged'
            : 'Clean routing',
    vpnQuality: underground.vpnQuality,
    vpnUpgradeCost: round2(Math.pow((Math.min(0.95, underground.vpnQuality + 0.1) - underground.vpnQuality) * 10, 1.7) * 900),
    compromised: underground.compromised,
    compromisedUntilDay: underground.compromisedUntilDay,
    hackCooldownUntilDay: underground.hackCooldownUntilDay,
    markets: darknetMarketViews(state),
    assets: underground.dataAssets.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      acquiredDay: a.acquiredDay,
      ageDays: state.world.day - a.acquiredDay,
      freshness: a.freshness,
      value: assetValue(state, a),
      baseValue: a.baseValue,
      riskOnHold: a.riskOnHold,
      targetId: a.targetId,
      decayPerDay: round2(assetValue(state, a) * (DATA_CATALOGUE.find((o) => o.kind === a.kind)?.freshnessPerDay ?? 0.03)),
    })),
    dataOffers: dataOffers(state),
    hackTargets: hackTargets(state),
    hiddenChannelListings: hiddenChannelCommodities(state, state.player.locationId).length,
    stats: {
      dataSold: state.player.stats.counters['data_sold'] ?? 0,
      dataRevenue: round2(counter(state, 'data_revenue')),
      hacksSuccess: state.player.stats.counters['hacks_success'] ?? 0,
      hacksFailed: state.player.stats.counters['hacks_failed'] ?? 0,
      exitScams: state.player.stats.counters['exit_scams'] ?? 0,
      hackRevenue: round2(counter(state, 'hack_revenue')),
    },
  };
}

/** Location intel purchase: reveals a hidden location permanently. */
export function buyLocationIntel(state: GameState, rng: Rng, locationId: ID): { ok: boolean; reason?: string; cost?: number } {
  const loc = worldReg.location(locationId);
  if (!loc) return { ok: false, reason: 'Unknown location.' };
  if (!loc.hidden) return { ok: false, reason: `${loc.name} is already on every map.` };
  const locState = state.world.locations[locationId];
  if (locState?.discovered) return { ok: false, reason: 'You already know how to get there.' };
  const cost = round2((1800 + loc.risk * 9000) * state.world.inflationIndex);
  const move = debitCash(state, cost, { kind: 'fee', description: `Bought access intel for ${loc.name}`, allowDirty: true, counterparty: 'Fixer' });
  if (!move.ok) return { ok: false, reason: move.reason ?? `Intel costs ${formatMoney(cost)}.` };
  if (locState) locState.discovered = true;
  state.player.progression.milestones.push(`discovered:${locationId}`);
  bumpCounterSafe(state, 'locations_discovered');
  materialiseLocation(state, locationId, { includeHidden: true });
  pushNotification(state, {
    kind: 'success',
    title: `${loc.name} revealed`,
    body: `${loc.description ?? 'A place that does not appear on any map.'} ${loc.tradedCommodityIds.length} commodity lines are now visible there, and you can travel and ship to it.`,
    link: '/game/world',
    metrics: [{ label: 'Cost', value: formatMoney(cost) }],
  });
  void rng;
  return { ok: true, cost };
}
