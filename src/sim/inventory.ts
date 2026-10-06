/**
 * Inventory — physical goods, storage units, capacity, spoilage and theft.
 *
 * Everything the player owns physically lives in an `ItemStack` inside a
 * `StorageUnit`. Capacity is enforced in **both** weight and volume, storage
 * suitability is enforced (perishables need cold, hazardous goods need secure
 * storage, contraband needs concealment), and goods are only tradeable from a
 * storage unit that is at the player's current location — you cannot sell what
 * is not there. That single rule is what makes logistics a real game system
 * rather than a numeric inventory.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { getWorldRegistry } from '../engine/registry/world';
import { VEHICLES } from '../engine/registry/assets';
import { buildModifiers, personalCapacityKgBonus } from './modifiers';
import { newId, priceAt, round2 } from './state';
import type {
  PropertyInstance,
  VehicleInstance,
  CommodityDef,
  GameState,
  ID,
  ItemStack,
  StorageKind,
  StorageUnit,
} from './types';

const B = getBalance();

export interface CapacityUsage {
  kg: number;
  kgCapacity: number;
  litres: number;
  litresCapacity: number;
  kgFree: number;
  litresFree: number;
  kgUtilisation: number;
  litresUtilisation: number;
  /** Weight or volume, whichever is closer to full. */
  bindingConstraint: 'weight' | 'volume' | 'none';
  /** True for compartments used to hide contraband. */
  hiddenKg: number;
  hiddenKgCapacity: number;
}

export function stackWeightKg(commodity: CommodityDef, qty: number): number {
  return round2(commodity.weightKg * qty);
}

export function stackVolumeL(commodity: CommodityDef, qty: number): number {
  return round2(commodity.volumeL * qty);
}

export function getStorage(state: GameState, storageId: ID): StorageUnit | undefined {
  return state.player.storages.find((s) => s.id === storageId);
}

export function requireStorage(state: GameState, storageId: ID): StorageUnit {
  const s = getStorage(state, storageId);
  if (!s) throw new Error(`Unknown storage unit ${storageId}`);
  return s;
}

/** Storage units physically present at a location (personal storage travels). */
export function storagesAtLocation(state: GameState, locationId: ID): StorageUnit[] {
  return state.player.storages.filter(
    (s) => s.kind === 'personal' || s.locationId === locationId,
  );
}

export function stacksInStorage(state: GameState, storageId: ID): ItemStack[] {
  return state.player.inventory.filter((s) => s.storageId === storageId);
}

export function capacityOf(state: GameState, storage: StorageUnit): CapacityUsage {
  const registry = getCommodityRegistry();
  let kg = 0;
  let litres = 0;
  let hiddenKg = 0;
  for (const stack of stacksInStorage(state, storage.id)) {
    const commodity = registry.get(stack.commodityId);
    if (!commodity) continue;
    const w = stackWeightKg(commodity, stack.qty);
    const v = stackVolumeL(commodity, stack.qty);
    if (stack.concealed) hiddenKg += w;
    else kg += w;
    litres += v;
  }
  const kgCapacity = storage.capacityKg;
  const litresCapacity = storage.capacityL;
  const kgUtil = kgCapacity > 0 ? kg / kgCapacity : kg > 0 ? 1 : 0;
  const lUtil = litresCapacity > 0 ? litres / litresCapacity : litres > 0 ? 1 : 0;
  return {
    kg: round2(kg),
    kgCapacity: round2(kgCapacity),
    litres: round2(litres),
    litresCapacity: round2(litresCapacity),
    kgFree: round2(Math.max(0, kgCapacity - kg)),
    litresFree: round2(Math.max(0, litresCapacity - litres)),
    kgUtilisation: Math.min(99, kgUtil),
    litresUtilisation: Math.min(99, lUtil),
    bindingConstraint: kgUtil > lUtil ? 'weight' : lUtil > kgUtil ? 'volume' : 'none',
    hiddenKg: round2(hiddenKg),
    hiddenKgCapacity: round2(storage.hiddenCompartmentKg),
  };
}

export type StorageProblem =
  | 'capacity_weight'
  | 'capacity_volume'
  | 'capacity_hidden'
  | 'needs_refrigeration'
  | 'needs_secure'
  | 'needs_hazardous'
  | 'not_concealable'
  | 'storage_missing';

export interface StorageCheck {
  ok: boolean;
  problem?: StorageProblem;
  message?: string;
  kgNeeded: number;
  litresNeeded: number;
}

/**
 * Can `qty` of this commodity go into this storage unit?
 *
 * Suitability rules are real constraints, not suggestions: perishables spoil
 * fast without refrigeration, high-value goods are stolen without security, and
 * concealment capacity is what makes smuggling possible at all.
 */
export function canStore(
  state: GameState,
  storageId: ID,
  commodity: CommodityDef,
  qty: number,
  concealed = false,
): StorageCheck {
  const storage = getStorage(state, storageId);
  if (!storage) return { ok: false, problem: 'storage_missing', message: 'Storage not found', kgNeeded: 0, litresNeeded: 0 };
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, problem: 'capacity_weight', message: 'Quantity must be positive', kgNeeded: 0, litresNeeded: 0 };
  }

  const kgNeeded = stackWeightKg(commodity, qty);
  const litresNeeded = stackVolumeL(commodity, qty);
  const usage = capacityOf(state, storage);

  if (concealed) {
    if (storage.hiddenCompartmentKg <= 0) {
      return { ok: false, problem: 'not_concealable', message: `${storage.name} has no hidden compartment`, kgNeeded, litresNeeded };
    }
    if (usage.hiddenKg + kgNeeded > storage.hiddenCompartmentKg + 1e-9) {
      return {
        ok: false,
        problem: 'capacity_hidden',
        message: `Hidden compartment holds ${storage.hiddenCompartmentKg} kg; ${round2(storage.hiddenCompartmentKg - usage.hiddenKg)} kg free`,
        kgNeeded,
        litresNeeded,
      };
    }
  } else if (usage.kg + kgNeeded > usage.kgCapacity + 1e-9) {
    return {
      ok: false,
      problem: 'capacity_weight',
      message: `${storage.name} is weight-limited: ${usage.kgFree} kg free, needs ${kgNeeded} kg`,
      kgNeeded,
      litresNeeded,
    };
  }

  if (usage.litres + litresNeeded > usage.litresCapacity + 1e-9) {
    return {
      ok: false,
      problem: 'capacity_volume',
      message: `${storage.name} is volume-limited: ${usage.litresFree} L free, needs ${litresNeeded} L`,
      kgNeeded,
      litresNeeded,
    };
  }

  if (commodity.storage === 'refrigerated' && !storage.refrigerated) {
    return {
      ok: false,
      problem: 'needs_refrigeration',
      message: `${commodity.name} needs refrigeration; ${storage.name} is not refrigerated`,
      kgNeeded,
      litresNeeded,
    };
  }
  if (commodity.storage === 'secure' && storage.security < 0.5) {
    return {
      ok: false,
      problem: 'needs_secure',
      message: `${commodity.name} needs secure storage; ${storage.name} security is ${(storage.security * 100).toFixed(0)}%`,
      kgNeeded,
      litresNeeded,
    };
  }
  if (commodity.storage === 'hazardous' && storage.kind === 'personal') {
    return {
      ok: false,
      problem: 'needs_hazardous',
      message: `${commodity.name} is hazardous and cannot be carried on your person`,
      kgNeeded,
      litresNeeded,
    };
  }
  if (commodity.storage === 'climate' && !storage.refrigerated && storage.kind === 'personal') {
    return {
      ok: false,
      problem: 'needs_refrigeration',
      message: `${commodity.name} needs climate control`,
      kgNeeded,
      litresNeeded,
    };
  }

  return { ok: true, kgNeeded, litresNeeded };
}

export interface AddItemOptions {
  commodityId: ID;
  qty: number;
  storageId?: ID;
  avgCost?: number;
  quality?: number;
  day?: number;
  concealed?: boolean;
  origin?: ItemStack['origin'];
}

export interface AddItemResult {
  ok: boolean;
  stackId: ID | null;
  qty: number;
  merged: boolean;
  problem?: StorageProblem;
  message?: string;
}

/**
 * Add goods to inventory, merging into an existing compatible stack so long
 * campaigns do not accumulate thousands of stack rows.
 */
export function addItem(state: GameState, opts: AddItemOptions, rng?: Rng): AddItemResult {
  const registry = getCommodityRegistry();
  const commodity = registry.get(opts.commodityId);
  if (!commodity) return { ok: false, stackId: null, qty: 0, merged: false, problem: 'storage_missing', message: `Unknown commodity ${opts.commodityId}` };
  const qty = Math.floor(opts.qty);
  if (qty <= 0) return { ok: false, stackId: null, qty: 0, merged: false, message: 'Quantity must be at least 1' };

  const day = opts.day ?? state.world.day;
  const storageId = opts.storageId ?? pickBestStorage(state, commodity, qty, opts.concealed ?? false);
  if (!storageId) {
    return { ok: false, stackId: null, qty, merged: false, problem: 'capacity_weight', message: 'No storage with enough suitable capacity' };
  }
  const check = canStore(state, storageId, commodity, qty, opts.concealed ?? false);
  if (!check.ok) return { ok: false, stackId: null, qty, merged: false, problem: check.problem, message: check.message };

  const quality = opts.quality ?? round2(0.7 + (rng ? rng.float(0, 0.2) : 0.1));
  const expiresDay =
    commodity.shelfLifeDays !== null ? day + Math.max(1, Math.round(commodity.shelfLifeDays * (0.55 + quality * 0.6))) : null;

  // Merge into a compatible stack: same commodity, same storage, same
  // concealment, no expiry clock, and similar quality/cost basis.
  const compatible = state.player.inventory.find(
    (s) =>
      s.commodityId === commodity.id &&
      s.storageId === storageId &&
      s.concealed === (opts.concealed ?? false) &&
      s.expiresDay === null &&
      expiresDay === null &&
      Math.abs(s.quality - quality) < 0.08,
  );

  if (compatible) {
    const totalQty = compatible.qty + qty;
    const cost = opts.avgCost ?? compatible.avgCost;
    compatible.avgCost = round2((compatible.avgCost * compatible.qty + cost * qty) / totalQty);
    compatible.quality = round2((compatible.quality * compatible.qty + quality * qty) / totalQty);
    compatible.qty = totalQty;
    syncCarriedStats(state);
    return { ok: true, stackId: compatible.id, qty, merged: true };
  }

  const stack: ItemStack = {
    id: rng ? newId(rng, 'stack') : `stack_${day}_${state.player.inventory.length + 1}`,
    commodityId: commodity.id,
    qty,
    avgCost: round2(opts.avgCost ?? commodity.baseValue),
    acquiredDay: day,
    quality: round2(Math.min(1, Math.max(0, quality))),
    expiresDay,
    storageId,
    concealed: opts.concealed ?? false,
    origin: opts.origin ?? 'purchased',
    acquiredLocationId: state.player.locationId,
  };
  state.player.inventory.push(stack);
  syncCarriedStats(state);
  return { ok: true, stackId: stack.id, qty, merged: false };
}

/**
 * Choose the most suitable storage for a purchase: refrigerated/secure first if
 * the good needs it, then the unit with the most free capacity, and personal
 * carry only when nothing else is available.
 */
export function pickBestStorage(
  state: GameState,
  commodity: CommodityDef,
  qty: number,
  concealed: boolean,
): ID | null {
  const candidates = storagesAtLocation(state, state.player.locationId);
  let best: { id: ID; score: number } | null = null;
  for (const storage of candidates) {
    const check = canStore(state, storage.id, commodity, qty, concealed);
    if (!check.ok) continue;
    const usage = capacityOf(state, storage);
    let score = usage.kgFree + usage.litresFree * 0.4;
    if (storage.kind === 'personal') score *= 0.35; // prefer fixed storage
    if (commodity.storage === 'refrigerated' && storage.refrigerated) score += 5000;
    if (commodity.storage === 'secure') score += storage.security * 4000;
    if (!best || score > best.score) best = { id: storage.id, score };
  }
  return best?.id ?? null;
}

export interface RemoveItemResult {
  ok: boolean;
  removed: number;
  message?: string;
  /** Weighted acquisition cost of the units actually removed. */
  costBasis?: number;
  /** Where the removed units were bought (arbitrage + provenance tracking). */
  acquiredLocationIds?: ID[];
  /** Weighted quality of the removed units. */
  quality?: number;
}

/** Remove goods (sale, consumption, production input, seizure, spoilage). */
export function removeItem(state: GameState, stackId: ID, qty: number): RemoveItemResult {
  const stack = state.player.inventory.find((s) => s.id === stackId);
  if (!stack) return { ok: false, removed: 0, message: 'Stack not found' };
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, removed: 0, message: 'Invalid quantity' };
  const remove = Math.min(stack.qty, Math.floor(qty));
  if (remove <= 0) return { ok: false, removed: 0, message: 'Stack is empty' };
  stack.qty -= remove;
  const result: RemoveItemResult = {
    ok: true,
    removed: remove,
    costBasis: round2(stack.avgCost * remove),
    acquiredLocationIds: stack.acquiredLocationId ? [stack.acquiredLocationId] : [],
    quality: stack.quality,
  };
  if (stack.qty <= 0) {
    state.player.inventory = state.player.inventory.filter((s) => s.id !== stackId);
  }
  syncCarriedStats(state);
  return result;
}

/** Remove `qty` of a commodity from wherever it is stored at this location. */
export function removeCommodity(state: GameState, commodityId: ID, qty: number, locationId?: ID): RemoveItemResult {
  const at = locationId ?? state.player.locationId;
  const allowed = new Set(storagesAtLocation(state, at).map((s) => s.id));
  const stacks = state.player.inventory
    .filter((s) => s.commodityId === commodityId && allowed.has(s.storageId) && !s.concealed)
    .sort((a, b) => (a.expiresDay ?? Infinity) - (b.expiresDay ?? Infinity));
  let remaining = Math.floor(qty);
  let removed = 0;
  let costBasis = 0;
  let qualityWeighted = 0;
  const origins = new Set<ID>();
  for (const stack of stacks) {
    if (remaining <= 0) break;
    const take = Math.min(stack.qty, remaining);
    const res = removeItem(state, stack.id, take);
    removed += res.removed;
    remaining -= res.removed;
    costBasis += res.costBasis ?? 0;
    qualityWeighted += (res.quality ?? 1) * res.removed;
    for (const o of res.acquiredLocationIds ?? []) origins.add(o);
  }
  const detail = {
    costBasis: round2(costBasis),
    acquiredLocationIds: [...origins],
    quality: removed > 0 ? round2(qualityWeighted / removed) : 1,
  };
  if (remaining > 0) return { ok: false, removed, message: `Only ${removed} of ${qty} available here`, ...detail };
  return { ok: true, removed, ...detail };
}

/** Total quantity of a commodity the player can actually reach right now. */
export function quantityOnHand(state: GameState, commodityId: ID, locationId?: ID, includeConcealed = true): number {
  const at = locationId ?? state.player.locationId;
  const allowed = new Set(storagesAtLocation(state, at).map((s) => s.id));
  return state.player.inventory
    .filter((s) => s.commodityId === commodityId && allowed.has(s.storageId))
    .filter((s) => includeConcealed || !s.concealed)
    .reduce((sum, s) => sum + s.qty, 0);
}

export function moveItem(state: GameState, stackId: ID, qty: number, toStorageId: ID): RemoveItemResult & { moved?: number } {
  const stack = state.player.inventory.find((s) => s.id === stackId);
  if (!stack) return { ok: false, removed: 0, message: 'Stack not found' };
  const registry = getCommodityRegistry();
  const commodity = registry.get(stack.commodityId);
  if (!commodity) return { ok: false, removed: 0, message: 'Unknown commodity' };
  const move = Math.min(stack.qty, Math.floor(qty));
  if (move <= 0) return { ok: false, removed: 0, message: 'Nothing to move' };

  const target = getStorage(state, toStorageId);
  if (!target) return { ok: false, removed: 0, message: 'Destination storage not found' };
  if (target.locationId !== state.player.locationId && target.kind !== 'personal') {
    return { ok: false, removed: 0, message: 'Destination is not at your current location' };
  }
  const check = canStore(state, toStorageId, commodity, move, stack.concealed);
  if (!check.ok) return { ok: false, removed: 0, message: check.message };

  const destination = state.player.inventory.find(
    (s) =>
      s.id !== stackId &&
      s.commodityId === stack.commodityId &&
      s.storageId === toStorageId &&
      s.concealed === stack.concealed &&
      s.expiresDay === null &&
      stack.expiresDay === null,
  );
  if (destination) {
    const total = destination.qty + move;
    destination.avgCost = round2((destination.avgCost * destination.qty + stack.avgCost * move) / total);
    destination.quality = round2((destination.quality * destination.qty + stack.quality * move) / total);
    destination.qty = total;
    stack.qty -= move;
  } else if (move === stack.qty) {
    stack.storageId = toStorageId;
  } else {
    stack.qty -= move;
    state.player.inventory.push({ ...stack, id: `${stack.id}_m${state.player.inventory.length}`, qty: move, storageId: toStorageId });
  }
  if (stack.qty <= 0) state.player.inventory = state.player.inventory.filter((s) => s.id !== stackId);
  syncCarriedStats(state);
  return { ok: true, removed: move, moved: move };
}

/** Hide or reveal goods in a compartment (changes detection risk, not value). */
export function setConcealed(state: GameState, stackId: ID, concealed: boolean): { ok: boolean; message?: string } {
  const stack = state.player.inventory.find((s) => s.id === stackId);
  if (!stack) return { ok: false, message: 'Stack not found' };
  const registry = getCommodityRegistry();
  const commodity = registry.get(stack.commodityId);
  if (!commodity) return { ok: false, message: 'Unknown commodity' };
  if (concealed) {
    const check = canStore(state, stack.storageId, commodity, stack.qty, true);
    if (!check.ok) return { ok: false, message: check.message };
  }
  stack.concealed = concealed;
  syncCarriedStats(state);
  return { ok: true };
}

/** Keep `stats.carriedKg/carriedL` in sync with the personal storage unit. */
export function syncCarriedStats(state: GameState): void {
  const personal = state.player.storages.find((s) => s.kind === 'personal');
  if (!personal) {
    state.player.stats.carriedKg = 0;
    state.player.stats.carriedL = 0;
    return;
  }
  const usage = capacityOf(state, personal);
  state.player.stats.carriedKg = usage.kg + usage.hiddenKg;
  state.player.stats.carriedL = usage.litres;
}

export interface SpoilageLoss {
  stackId: ID;
  commodityId: ID;
  commodityName: string;
  qty: number;
  value: number;
  reason: 'expired' | 'degraded';
}

/**
 * Daily spoilage: expired stacks are lost, and stacks in unsuitable storage
 * degrade in quality (which lowers their sale price) before they expire.
 */
export function spoilageTick(state: GameState, rng: Rng): SpoilageLoss[] {
  const registry = getCommodityRegistry();
  const day = state.world.day;
  const losses: SpoilageLoss[] = [];

  for (const stack of [...state.player.inventory]) {
    const commodity = registry.get(stack.commodityId);
    if (!commodity) continue;
    const storage = getStorage(state, stack.storageId);

    if (stack.expiresDay !== null && day >= stack.expiresDay) {
      losses.push({
        stackId: stack.id,
        commodityId: stack.commodityId,
        commodityName: commodity.name,
        qty: stack.qty,
        value: round2(stack.avgCost * stack.qty),
        reason: 'expired',
      });
      state.player.inventory = state.player.inventory.filter((s) => s.id !== stack.id);
      continue;
    }

    if (!storage) continue;
    const needsCold = commodity.storage === 'refrigerated' || commodity.storage === 'climate';
    if (needsCold && !storage.refrigerated && rng.chance(0.35)) {
      stack.quality = round2(Math.max(0.05, stack.quality - rng.float(0.06, 0.18)));
      if (stack.expiresDay !== null) stack.expiresDay = Math.max(day + 1, stack.expiresDay - rng.int(1, 4));
      losses.push({
        stackId: stack.id,
        commodityId: stack.commodityId,
        commodityName: commodity.name,
        qty: 0,
        value: 0,
        reason: 'degraded',
      });
    }
  }
  if (losses.length > 0) syncCarriedStats(state);
  return losses;
}

export interface TheftLoss {
  stackId: ID;
  commodityId: ID;
  commodityName: string;
  qty: number;
  value: number;
  storageId: ID;
  storageName: string;
  insured: boolean;
  payout: number;
}

/**
 * Daily theft/seizure roll per storage unit.
 *
 * Risk falls with security and rises with how obviously valuable the contents
 * are — which is why players end up splitting stock across units, buying
 * insurance and installing upgrades rather than hoarding everything in one
 * warehouse.
 */
export function theftTick(state: GameState, rng: Rng): TheftLoss[] {
  const registry = getCommodityRegistry();
  const losses: TheftLoss[] = [];
  const world = getWorldRegistry();

  for (const storage of state.player.storages) {
    if (storage.kind === 'personal') continue;
    const stacks = stacksInStorage(state, storage.id);
    if (stacks.length === 0) continue;

    const location = world.location(storage.locationId);
    const localRisk = location ? location.risk : 0.2;
    const value = stacks.reduce((sum, s) => sum + s.avgCost * s.qty, 0);
    // Attractiveness scales with value but saturates: a warehouse full of gravel
    // is not worth robbing, a warehouse full of gold is.
    const attractiveness = Math.min(1, Math.log10(Math.max(10, value)) / 6);
    const chance =
      (B.logistics.theftChancePerDayBase + localRisk * B.logistics.seizureChancePerDayPerRiskUnit * 6) *
      (1 - storage.security) *
      (0.3 + attractiveness) *
      (1 - Math.min(0.85, storage.security * B.logistics.theftReductionPerSecurityLevel * 100));

    if (!rng.chance(Math.max(0, chance))) continue;

    // Thieves take the most valuable, most portable stack first.
    const target = stacks
      .map((s) => ({ stack: s, commodity: registry.get(s.commodityId) }))
      .filter((x): x is { stack: ItemStack; commodity: CommodityDef } => x.commodity !== undefined)
      .sort((a, b) => {
        const da = a.commodity.baseValue / Math.max(0.01, a.commodity.weightKg);
        const db = b.commodity.baseValue / Math.max(0.01, b.commodity.weightKg);
        return db - da;
      })[0];
    if (!target) continue;

    const fraction = target.stack.concealed ? rng.float(0.1, 0.3) : rng.float(0.25, 0.75);
    const qty = Math.max(1, Math.floor(target.stack.qty * fraction));
    const value0 = round2(target.stack.avgCost * qty);
    const payout = storage.insured ? round2(Math.min(storage.insuredValue, value0 * B.logistics.insurancePayoutFraction)) : 0;

    losses.push({
      stackId: target.stack.id,
      commodityId: target.stack.commodityId,
      commodityName: target.commodity.name,
      qty,
      value: value0,
      storageId: storage.id,
      storageName: storage.name,
      insured: storage.insured,
      payout,
    });
    removeItem(state, target.stack.id, qty);
  }
  return losses;
}

export interface InventoryRow {
  stackId: ID;
  commodityId: ID;
  name: string;
  category: string;
  qty: number;
  unit: string;
  avgCost: number;
  quality: number;
  weightKg: number;
  volumeL: number;
  marketValue: number;
  costBasis: number;
  unrealisedPnl: number;
  pnlFraction: number;
  storageId: ID;
  storageName: string;
  storageKind: StorageKind;
  atCurrentLocation: boolean;
  concealed: boolean;
  expiresDay: number | null;
  daysUntilExpiry: number | null;
  legality: string;
}

export interface InventorySummary {
  rows: InventoryRow[];
  totalQty: number;
  totalWeightKg: number;
  totalVolumeL: number;
  totalMarketValue: number;
  totalCostBasis: number;
  totalUnrealisedPnl: number;
  stacks: number;
  storages: { storage: StorageUnit; usage: CapacityUsage; value: number }[];
}

/**
 * How much the player can physically carry out of a location right now:
 * personal capacity plus the best vehicle parked there. Used by travel costing
 * and by the arbitrage scanner so estimates reflect real logistics.
 */
export function portableCapacityKg(state: GameState, locationId?: ID): number {
  const at = locationId ?? state.player.locationId;
  const personal = state.player.storages.find((s) => s.kind === 'personal');
  let best = personal?.capacityKg ?? B.logistics.personalCapacityKg;
  const mods = buildModifiers(state.player.progression);
  best += personalCapacityKgBonus(mods);
  for (const v of state.player.vehicles) {
    if (v.locationId !== at) continue;
    const def = VEHICLES.find((d) => d.id === v.defId);
    const cap = (def?.capacityKg ?? 0) * (0.4 + v.condition * 0.6);
    if (cap > best) best = cap;
  }
  return Math.max(1, round2(best));
}

/** Full inventory view for the UI, including per-storage capacity utilisation. */
export function inventorySummary(state: GameState): InventorySummary {
  const registry = getCommodityRegistry();
  const rows: InventoryRow[] = [];
  let totalMarketValue = 0;
  let totalCostBasis = 0;
  let totalWeight = 0;
  let totalVolume = 0;
  let totalQty = 0;

  for (const stack of state.player.inventory) {
    const commodity = registry.get(stack.commodityId);
    if (!commodity) continue;
    const storage = getStorage(state, stack.storageId);
    const quote = priceAt(state, storage?.locationId ?? state.player.locationId, stack.commodityId);
    const marketPrice = quote?.price ?? commodity.baseValue;
    const qualityFactor = 0.72 + stack.quality * 0.4;
    const marketValue = round2(marketPrice * stack.qty * qualityFactor);
    const costBasis = round2(stack.avgCost * stack.qty);
    totalMarketValue += marketValue;
    totalCostBasis += costBasis;
    totalWeight += stackWeightKg(commodity, stack.qty);
    totalVolume += stackVolumeL(commodity, stack.qty);
    totalQty += stack.qty;
    rows.push({
      stackId: stack.id,
      commodityId: stack.commodityId,
      name: commodity.name,
      category: commodity.category,
      qty: stack.qty,
      unit: commodity.unit,
      avgCost: stack.avgCost,
      quality: stack.quality,
      weightKg: stackWeightKg(commodity, stack.qty),
      volumeL: stackVolumeL(commodity, stack.qty),
      marketValue,
      costBasis,
      unrealisedPnl: round2(marketValue - costBasis),
      pnlFraction: costBasis > 0 ? round2(marketValue / costBasis - 1) : 0,
      storageId: stack.storageId,
      storageName: storage?.name ?? 'Unknown',
      storageKind: storage?.kind ?? 'personal',
      atCurrentLocation: storage ? storage.kind === 'personal' || storage.locationId === state.player.locationId : false,
      concealed: stack.concealed,
      expiresDay: stack.expiresDay,
      daysUntilExpiry: stack.expiresDay !== null ? stack.expiresDay - state.world.day : null,
      legality: commodity.legality,
    });
  }

  rows.sort((a, b) => b.marketValue - a.marketValue);

  return {
    rows,
    totalQty,
    totalWeightKg: round2(totalWeight),
    totalVolumeL: round2(totalVolume),
    totalMarketValue: round2(totalMarketValue),
    totalCostBasis: round2(totalCostBasis),
    totalUnrealisedPnl: round2(totalMarketValue - totalCostBasis),
    stacks: rows.length,
    storages: state.player.storages.map((storage) => ({
      storage,
      usage: capacityOf(state, storage),
      value: round2(
        stacksInStorage(state, storage.id).reduce((sum, s) => {
          const c = registry.get(s.commodityId);
          return sum + (c ? s.avgCost * s.qty : 0);
        }, 0),
      ),
    })),
  };
}

/** Create a storage unit from a property the player owns. */
/**
 * Create the storage unit that a property provides. Capacity, security, cold
 * chain and hidden compartments all come from the property instance, so an
 * upgrade immediately changes what can be stored there.
 */
export function createStorageFromProperty(state: GameState, rng: Rng, property: PropertyInstance): StorageUnit {
  const existing = state.player.storages.find((s) => s.propertyId === property.id);
  if (existing) return existing;
  const storage: StorageUnit = {
    id: newId(rng, 'store'),
    kind: property.refrigerated ? 'cold' : property.security >= 0.75 ? 'safehouse' : 'warehouse',
    name: `${property.name} storage`,
    locationId: property.locationId,
    propertyId: property.id,
    vehicleId: null,
    capacityKg: property.storageKg,
    capacityL: property.storageL,
    security: property.security,
    refrigerated: property.refrigerated,
    hiddenCompartmentKg: property.hiddenCompartmentKg,
    costPerDay: round2(property.opexPerDay),
    insured: property.insured,
    insuredValue: round2(property.valuation),
  };
  state.player.storages.push(storage);
  return storage;
}

/** Create a storage unit inside a vehicle (moves with the vehicle). */
/** Create (or return) the storage unit inside a vehicle instance. */
export function createStorageFromVehicle(state: GameState, rng: Rng, vehicle: VehicleInstance): StorageUnit {
  const existing = state.player.storages.find((s) => s.vehicleId === vehicle.id);
  if (existing) return existing;
  const storage: StorageUnit = {
    id: newId(rng, 'store'),
    kind: 'vehicle',
    name: `${vehicle.name} cargo`,
    locationId: vehicle.locationId,
    propertyId: null,
    vehicleId: vehicle.id,
    capacityKg: vehicle.capacityKg,
    capacityL: vehicle.capacityL,
    security: round2(0.2 + vehicle.stealth * 0.5),
    refrigerated: false,
    hiddenCompartmentKg: vehicle.hiddenCompartmentKg,
    costPerDay: 0,
    insured: false,
    insuredValue: 0,
  };
  state.player.storages.push(storage);
  return storage;
}

/** Remove a storage unit; goods inside are returned to the caller, not deleted. */
export function detachStorage(state: GameState, storageId: ID): ItemStack[] {
  const stacks = stacksInStorage(state, storageId);
  state.player.inventory = state.player.inventory.filter((s) => s.storageId !== storageId);
  state.player.storages = state.player.storages.filter((s) => s.id !== storageId);
  syncCarriedStats(state);
  return stacks;
}
