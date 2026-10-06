/**
 * Logistics — vehicles, warehouses, shipments, insurance and interdiction
 * (spec §14).
 *
 * This is the layer that turns "I found a price gap" into "I can actually move
 * the goods". Goods travel as shipments: they leave a storage unit, spend days in
 * transit with a tracking code, and can be delayed, robbed, seized at a border or
 * delivered. Insurance is real — a premium per day and a capped payout on loss.
 *
 * Vehicles are instances with condition, odometer, fuel, upgrades and hidden
 * compartments; warehouses are storage units created from properties. Both are
 * priced, sold and depreciated as assets.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { VEHICLES, VEHICLE_UPGRADE_BY_ID } from '../engine/registry/assets';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { getWorldRegistry } from '../engine/registry/world';
import { addItem, createStorageFromVehicle, getStorage, quantityOnHand, removeCommodity, storagesAtLocation } from './inventory';
import { detectionReduction, travelCostReduction } from './modifiers';
import { bumpCounter, counter, grantXp, playerModifiers, setCounter } from './progression';
import { addHeat, changeReputation } from './reputation';
import {
  computeNetWorth,
  creditCash,
  debitCash,
  formatMoney,
  newId,
  pushNotification,
  round2,
} from './state';
import { detectionChance as borderDetectionChance } from './travel';
import type { GameState, ID, Shipment, StorageUnit, TravelMode, VehicleInstance } from './types';

const B = getBalance();
const worldReg = getWorldRegistry();
const registry = getCommodityRegistry();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ------------------------------------------------------------------ */
/* Vehicles                                                            */
/* ------------------------------------------------------------------ */

export interface VehicleListing {
  defId: ID;
  name: string;
  kind: string;
  price: number;
  capacityKg: number;
  capacityL: number;
  speedKmPerDay: number;
  fuelPerKm: number;
  maintenancePerKm: number;
  stealth: number;
  armor: number;
  hiddenCompartmentKg: number;
  reliability: number;
  upgradeSlots: number;
  requiredSkill: { skillId: ID; level: number } | null;
  skillMet: boolean;
  affordable: boolean;
  description: string;
}

export function vehicleListings(state: GameState): VehicleListing[] {
  const cash = computeNetWorth(state).cash;
  return VEHICLES.map((def) => {
    const skillMet = def.requiredSkill ? (state.player.progression.skills[def.requiredSkill.skillId] ?? 0) >= def.requiredSkill.level : true;
    return {
      defId: def.id,
      name: def.name,
      kind: def.kind,
      price: round2(def.price * state.world.inflationIndex),
      capacityKg: def.capacityKg,
      capacityL: def.capacityL,
      speedKmPerDay: def.speedKmPerDay,
      fuelPerKm: def.fuelPerKm,
      maintenancePerKm: def.maintenancePerKm,
      stealth: def.stealth,
      armor: def.armor,
      hiddenCompartmentKg: def.hiddenCompartmentKg,
      reliability: def.reliability,
      upgradeSlots: def.upgradeSlots,
      requiredSkill: def.requiredSkill ?? null,
      skillMet,
      affordable: cash >= def.price * state.world.inflationIndex,
      description: def.description,
    };
  }).sort((a, b) => a.price - b.price);
}

export function buyVehicle(state: GameState, rng: Rng, defId: ID): { ok: boolean; reason?: string; vehicle?: VehicleInstance } {
  const def = VEHICLES.find((v) => v.id === defId);
  if (!def) return { ok: false, reason: 'Unknown vehicle.' };
  if (def.requiredSkill) {
    const have = state.player.progression.skills[def.requiredSkill.skillId] ?? 0;
    if (have < def.requiredSkill.level) {
      return { ok: false, reason: `${def.name} requires ${def.requiredSkill.skillId} ${def.requiredSkill.level} (you have ${have}).` };
    }
  }
  const price = round2(def.price * state.world.inflationIndex);
  const transferTax = round2(price * 0.035);
  const move = debitCash(state, round2(price + transferTax), {
    kind: 'property_buy',
    description: `Bought ${def.name}`,
    allowDirty: false,
    locationId: state.player.locationId,
    meta: { defId, price, transferTax },
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? `${def.name} costs ${formatMoney(price)}.` };

  const vehicle: VehicleInstance = {
    id: newId(rng, 'veh'),
    defId: def.id,
    name: def.name,
    purchasedDay: state.world.day,
    purchasePrice: price,
    condition: round2(rng.float(0.86, 1)),
    fuel: round2(rng.float(0.6, 1)),
    odometerKm: def.kind === 'car' || def.kind === 'van' || def.kind === 'truck' ? Math.round(rng.int(0, 90_000) * (1 - def.reliability)) : 0,
    locationId: state.player.locationId,
    upgrades: [],
    capacityKg: def.capacityKg,
    capacityL: def.capacityL,
    stealth: def.stealth,
    armor: def.armor,
    speedKmPerDay: def.speedKmPerDay,
    hiddenCompartmentKg: def.hiddenCompartmentKg,
    inUseBy: 'idle',
    assignedCrewId: null,
    maintenanceDueDay: state.world.day + 30,
    damage: 0,
  };
  state.player.vehicles.push(vehicle);
  createStorageFromVehicle(state, rng, vehicle);
  bumpCounter(state, 'vehicles_bought');
  setCounter(state, 'vehicle_capex', round2(counter(state, 'vehicle_capex') + price));
  grantXp(state, Math.round(30 + Math.log10(Math.max(1000, price)) * 16), `Bought ${def.name}`);
  pushNotification(state, {
    kind: 'success',
    title: `${def.name} acquired`,
    body: `${formatMoney(price)} plus ${formatMoney(transferTax)} transfer tax. Capacity ${def.capacityKg.toLocaleString('en-US')} kg / ${def.capacityL.toLocaleString('en-US')} L, ${def.speedKmPerDay} km/day, hidden compartment ${def.hiddenCompartmentKg} kg, ${def.upgradeSlots} upgrade slot(s).`,
    link: '/game/logistics',
    metrics: [
      { label: 'Capacity', value: `${def.capacityKg} kg` },
      { label: 'Speed', value: `${def.speedKmPerDay} km/day` },
      { label: 'Stealth', value: `${(def.stealth * 100).toFixed(0)}%` },
    ],
  });
  return { ok: true, vehicle };
}

export function sellVehicle(state: GameState, vehicleId: ID): { ok: boolean; reason?: string; proceeds?: number } {
  const vehicle = state.player.vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) return { ok: false, reason: 'You do not own that vehicle.' };
  if (vehicle.inUseBy === 'player' || vehicle.inUseBy === 'logistics') {
    return { ok: false, reason: 'The vehicle is in use. Finish the journey or recall the shipment first.' };
  }
  if (vehicle.locationId !== state.player.locationId) {
    return { ok: false, reason: `${vehicle.name} is in ${worldReg.location(vehicle.locationId)?.name ?? vehicle.locationId}.` };
  }
  const def = VEHICLES.find((v) => v.id === vehicle.defId);
  const base = def?.price ?? vehicle.purchasePrice;
  const value = round2(base * (0.35 + vehicle.condition * 0.5) * (1 - vehicle.damage * 0.3) * state.world.inflationIndex);
  const storage = state.player.storages.find((s) => s.vehicleId === vehicleId);
  if (storage) {
    const stored = state.player.inventory.filter((i) => i.storageId === storage.id);
    if (stored.length > 0) return { ok: false, reason: 'Empty the vehicle before selling it.' };
    state.player.storages = state.player.storages.filter((s) => s.id !== storage.id);
  }
  state.player.vehicles = state.player.vehicles.filter((v) => v.id !== vehicleId);
  creditCash(state, value, { kind: 'property_buy', description: `Sold ${vehicle.name}`, dirty: false, locationId: vehicle.locationId, meta: { condition: vehicle.condition } });
  const gain = round2(value - vehicle.purchasePrice);
  setCounter(state, 'vehicle_gains', round2(counter(state, 'vehicle_gains') + gain));
  pushNotification(state, {
    kind: gain >= 0 ? 'success' : 'info',
    title: `${vehicle.name} sold`,
    body: `${formatMoney(value)} (${gain >= 0 ? '+' : '−'}${formatMoney(Math.abs(gain))} against purchase). Condition ${(vehicle.condition * 100).toFixed(0)}%, odometer ${Math.round(vehicle.odometerKm).toLocaleString('en-US')} km.`,
    link: '/game/logistics',
  });
  return { ok: true, proceeds: value };
}

export function installVehicleUpgrade(state: GameState, vehicleId: ID, upgradeId: ID): { ok: boolean; reason?: string; cost?: number } {
  const vehicle = state.player.vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) return { ok: false, reason: 'You do not own that vehicle.' };
  const def = VEHICLES.find((v) => v.id === vehicle.defId);
  const upgrade = VEHICLE_UPGRADE_BY_ID[upgradeId];
  if (!upgrade) return { ok: false, reason: 'Unknown upgrade.' };
  if (vehicle.upgrades.includes(upgradeId)) return { ok: false, reason: 'Already installed.' };
  if (vehicle.upgrades.length >= (def?.upgradeSlots ?? 0)) {
    return { ok: false, reason: `${vehicle.name} has ${def?.upgradeSlots ?? 0} upgrade slot(s) and they are all used.` };
  }
  const cost = round2(upgrade.price * state.world.inflationIndex);
  const move = debitCash(state, cost, { kind: 'property_upgrade', description: `${upgrade.name} fitted to ${vehicle.name}`, allowDirty: false, locationId: vehicle.locationId });
  if (!move.ok) return { ok: false, reason: move.reason ?? 'Insufficient funds.' };

  vehicle.upgrades.push(upgradeId);
  const m = upgrade.modifiers;
  vehicle.capacityKg = Math.round(vehicle.capacityKg + (m.capacityKg ?? 0));
  vehicle.capacityL = Math.round(vehicle.capacityL + (m.capacityL ?? 0));
  vehicle.stealth = round2(clamp(vehicle.stealth + (m.stealth ?? 0), 0, 0.98));
  vehicle.armor = round2(clamp(vehicle.armor + (m.armor ?? 0), 0, 0.95));
  vehicle.speedKmPerDay = Math.round(vehicle.speedKmPerDay * (1 + (m.speed ?? 0)));
  vehicle.condition = round2(clamp(vehicle.condition + (m.reliability ?? 0) * 0.2, 0, 1));
  if (upgradeId.includes('compartment')) vehicle.hiddenCompartmentKg = round2(vehicle.hiddenCompartmentKg + Math.max(20, vehicle.capacityKg * 0.08));

  const storage = state.player.storages.find((s) => s.vehicleId === vehicleId);
  if (storage) {
    storage.capacityKg = vehicle.capacityKg;
    storage.capacityL = vehicle.capacityL;
    storage.security = round2(clamp(0.3 + vehicle.armor * 0.5 + vehicle.stealth * 0.2, 0, 0.95));
    storage.hiddenCompartmentKg = vehicle.hiddenCompartmentKg;
  }
  setCounter(state, 'upgrade_spend', round2(counter(state, 'upgrade_spend') + cost));
  pushNotification(state, {
    kind: 'success',
    title: `${upgrade.name} fitted`,
    body: `${vehicle.name}: ${upgrade.description} Capacity ${vehicle.capacityKg} kg, stealth ${(vehicle.stealth * 100).toFixed(0)}%.`,
    link: '/game/logistics',
  });
  return { ok: true, cost };
}

export function serviceVehicle(state: GameState, vehicleId: ID): { ok: boolean; reason?: string; cost?: number } {
  const vehicle = state.player.vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) return { ok: false, reason: 'You do not own that vehicle.' };
  const def = VEHICLES.find((v) => v.id === vehicle.defId);
  const cost = round2(Math.max(120, (def?.price ?? 5000) * 0.012 * (1.2 - vehicle.condition) + vehicle.damage * 900));
  const move = debitCash(state, cost, { kind: 'fee', description: `Serviced ${vehicle.name}`, allowDirty: false, locationId: vehicle.locationId });
  if (!move.ok) return { ok: false, reason: move.reason ?? 'Insufficient funds.' };
  vehicle.condition = round2(clamp(vehicle.condition + 0.18, 0, 1));
  vehicle.damage = 0;
  vehicle.maintenanceDueDay = state.world.day + 30;
  return { ok: true, cost };
}

/* ------------------------------------------------------------------ */
/* Shipments                                                           */
/* ------------------------------------------------------------------ */

export interface ShipmentPlan {
  ok: boolean;
  reason?: string;
  destinationId: ID;
  destinationName: string;
  mode: TravelMode;
  distanceKm: number;
  days: number;
  items: { commodityId: ID; name: string; qty: number; weightKg: number; value: number; illegal: boolean }[];
  weightKg: number;
  declaredValue: number;
  actualValue: number;
  capacityKg: number;
  overCapacityKg: number;
  freightCost: number;
  insurancePremium: number;
  insuranceCover: number;
  totalCost: number;
  borderCrossings: number;
  detectionChance: number;
  interceptionValueAtRisk: number;
  theftChance: number;
  delayChance: number;
  vehicleId: ID | null;
  crewIds: ID[];
  concealed: boolean;
  warnings: string[];
}

/**
 * The vehicle a shipment will actually use.
 *
 * Freight forwarders book against whatever is parked at the origin, so a player
 * who owns a van should not be limited to what they can carry by hand. Without
 * this, every dispatch of more than ~24 kg failed the capacity check no matter
 * how much rolling stock the player had.
 */
function freightVehicleAt(state: GameState, locationId: ID, requestedId?: ID | null) {
  const here = state.player.vehicles.filter(
    (v) => v.locationId === locationId && v.condition > 0.15 && v.damage < 0.9 && v.capacityKg > 0,
  );
  if (requestedId) {
    const requested = here.find((v) => v.id === requestedId);
    if (requested) return requested;
  }
  // Prefer rolling stock that is not already committed to another run, but never
  // hard-lock: a busy vehicle is better than no shipment at all.
  const free = here.filter((v) => v.inUseBy !== 'logistics');
  const pool = free.length > 0 ? free : here;
  return pool.slice().sort((a, b) => b.capacityKg - a.capacityKg || b.condition - a.condition)[0] ?? null;
}

export function planShipment(
  state: GameState,
  destinationId: ID,
  mode: TravelMode,
  items: { commodityId: ID; qty: number }[],
  opts: { insured?: boolean; declaredValue?: number; concealed?: boolean; vehicleId?: ID; crewIds?: ID[] } = {},
): ShipmentPlan {
  const from = state.player.locationId;
  const dest = worldReg.location(destinationId);
  const warnings: string[] = [];
  const empty: ShipmentPlan = {
    ok: false,
    // No placeholder reason — see the same rule in `planTravel`. Every failure
    // branch below sets a specific one; success carries none.
    destinationId,
    destinationName: dest?.name ?? destinationId,
    mode,
    distanceKm: 0,
    days: 0,
    items: [],
    weightKg: 0,
    declaredValue: 0,
    actualValue: 0,
    capacityKg: 0,
    overCapacityKg: 0,
    freightCost: 0,
    insurancePremium: 0,
    insuranceCover: 0,
    totalCost: 0,
    borderCrossings: 0,
    detectionChance: 0,
    interceptionValueAtRisk: 0,
    theftChance: 0,
    delayChance: 0,
    vehicleId: opts.vehicleId ?? null,
    crewIds: opts.crewIds ?? [],
    concealed: opts.concealed ?? false,
    warnings,
  };
  if (!dest) return { ...empty, reason: 'Unknown destination.' };
  if (destinationId === from) return { ...empty, reason: 'The destination is the current location.' };
  if (dest.hidden && !state.world.locations[destinationId]?.discovered) {
    return { ...empty, reason: `${dest.name} is not a place a freight forwarder will book to.` };
  }

  const path = worldReg.findPath(from, destinationId, { mode });
  if (!path || path.legs.length === 0) return { ...empty, reason: `No ${mode} route to ${dest.name}.` };

  const lines = items
    .map((item) => {
      const c = registry.get(item.commodityId);
      const onHand = quantityOnHand(state, item.commodityId, from);
      const qty = Math.max(0, Math.min(Math.floor(item.qty), Math.floor(onHand)));
      if (!c || qty <= 0) return null;
      return {
        commodityId: c.id,
        name: c.name,
        qty,
        weightKg: round2(c.weightKg * qty),
        value: round2(c.baseValue * qty),
        illegal: c.legality !== 'legal',
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (lines.length === 0) return { ...empty, reason: 'No goods available to ship from storage here.' };

  const weightKg = round2(lines.reduce((s, l) => s + l.weightKg, 0));
  const actualValue = round2(lines.reduce((s, l) => s + l.value, 0));
  const declaredValue = opts.declaredValue !== undefined ? round2(Math.max(0, opts.declaredValue)) : round2(actualValue * (lines.some((l) => l.illegal) ? 0.35 : 1));

  const vehicle = freightVehicleAt(state, from, opts.vehicleId ?? null);
  const capacityKg = round2((vehicle ? vehicle.capacityKg : 0) + (vehicle ? 0 : B.logistics.personalCapacityKg));
  const overCapacityKg = round2(Math.max(0, weightKg - capacityKg));
  if (overCapacityKg > 0) warnings.push(`Over capacity by ${Math.round(overCapacityKg).toLocaleString('en-US')} kg — use a vehicle or split the shipment.`);

  const distanceKm = round2(path.distanceKm);
  const speed = vehicle ? Math.max(40, vehicle.speedKmPerDay * (0.6 + vehicle.condition * 0.4)) : B.travel.speedKmPerDay[mode] ?? 420;
  const days = Math.max(1, Math.ceil(distanceKm / speed));
  const mods = playerModifiers(state);
  const perKgKm = (B.travel.costPerKm[mode] ?? 0.09) / Math.max(1, capacityKg) * 12;
  const freightCost = round2(
    (distanceKm * (B.travel.costPerKm[mode] ?? 0.09) + (B.travel.fixedCostByMode[mode] ?? 14)) * Math.max(1, Math.ceil(weightKg / Math.max(1, capacityKg))) * (1 - travelCostReduction(mods)) +
      weightKg * distanceKm * perKgKm * 0.02,
  );

  const insured = opts.insured ?? false;
  const insurancePremium = insured ? round2(actualValue * B.logistics.insurancePremiumPerDayFraction * days) : 0;
  const insuranceCover = insured ? round2(actualValue * B.logistics.insurancePayoutFraction) : 0;
  if (insured && lines.some((l) => l.illegal)) warnings.push('Insurers do not pay out on contraband — the policy covers legal cargo only.');

  const borderCrossings = path.borderCrossings;
  const illegalLines = lines.filter((l) => l.illegal);
  const detection =
    borderCrossings > 0 && illegalLines.length > 0
      ? borderDetectionChance(state, {
          routeId: path.legs[0]!.route.id,
          fromId: from,
          toId: destinationId,
          fromName: '',
          toName: '',
          distanceKm,
          borderCrossing: true,
          fromCountry: '',
          toCountry: '',
          customsIntensity: path.legs[0]!.route.customsIntensity,
          baseRisk: path.legs[0]!.route.baseRisk,
          currentRisk: state.world.routes[path.legs[0]!.route.id]?.risk ?? path.legs[0]!.route.baseRisk,
          disrupted: false,
          disruptionReason: null,
          costMultiplier: 1,
          modes: path.legs[0]!.route.modes,
          supported: true,
        }, illegalLines.map((l) => ({
          commodityId: l.commodityId,
          name: l.name,
          qty: l.qty,
          weightKg: l.weightKg,
          volumeL: 0,
          value: l.value,
          legality: 'illegal',
          concealed: opts.concealed ?? false,
          illegal: true,
        })), vehicle)
      : 0;
  if (declaredValue < actualValue * 0.8) warnings.push(`Declaring ${formatMoney(declaredValue)} against ${formatMoney(actualValue)} of cargo is under-declaration — it raises inspection risk and is a criminal offence if caught.`);

  const theftChance = round2(clamp(B.logistics.theftChancePerDayBase * days * (1 + actualValue / 400_000) * (path.risk * 2 + 0.4) * (vehicle ? 1 - vehicle.stealth * 0.4 : 1), 0, 0.6));
  const delayChance = round2(clamp(B.logistics.shipmentDelayChancePerDay * days * (1 + path.risk), 0, 0.7));
  const totalCost = round2(freightCost + insurancePremium);

  return {
    ...empty,
    ok: overCapacityKg <= 0 && totalCost <= computeNetWorth(state).cash,
    ...(overCapacityKg > 0
      ? { reason: `Over carrying capacity by ${Math.round(overCapacityKg)} kg.` }
      : totalCost > computeNetWorth(state).cash
        ? { reason: `Freight and insurance cost ${formatMoney(totalCost)}.` }
        : {}),
    destinationName: dest.name,
    distanceKm,
    days,
    items: lines,
    weightKg,
    declaredValue,
    actualValue,
    capacityKg,
    overCapacityKg,
    freightCost,
    insurancePremium,
    insuranceCover,
    totalCost,
    borderCrossings,
    detectionChance: detection,
    interceptionValueAtRisk: round2(illegalLines.reduce((s, l) => s + l.value, 0)),
    theftChance,
    delayChance,
    vehicleId: vehicle?.id ?? null,
    crewIds: opts.crewIds ?? [],
    concealed: opts.concealed ?? false,
    warnings,
  };
}

export function sendShipment(
  state: GameState,
  rng: Rng,
  destinationId: ID,
  mode: TravelMode,
  items: { commodityId: ID; qty: number }[],
  opts: { insured?: boolean; declaredValue?: number; concealed?: boolean; vehicleId?: ID; crewIds?: ID[] } = {},
): { ok: boolean; reason?: string; shipment?: Shipment; plan?: ShipmentPlan } {
  const plan = planShipment(state, destinationId, mode, items, opts);
  if (!plan.ok) return { ok: false, reason: plan.reason ?? plan.warnings[0] ?? 'Shipment not possible.', plan };

  const move = debitCash(state, plan.totalCost, {
    kind: 'travel',
    description: `Freight ${worldReg.requireLocation(state.player.locationId).name} → ${plan.destinationName} (${Math.round(plan.weightKg)} kg, ${plan.days} day(s))`,
    allowDirty: false,
    locationId: state.player.locationId,
    meta: { destinationId, mode, weightKg: plan.weightKg, insured: plan.insurancePremium > 0, declaredValue: plan.declaredValue },
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? 'Cannot pay the freight.', plan };

  // Goods leave storage now: they are in transit, not available to trade.
  const shipmentItems: Shipment['items'] = [];
  for (const line of plan.items) {
    const removed = removeCommodity(state, line.commodityId, line.qty, state.player.locationId);
    if (removed.removed <= 0) continue;
    shipmentItems.push({ stackId: `ship_${line.commodityId}`, commodityId: line.commodityId, qty: removed.removed });
  }
  if (shipmentItems.length === 0) {
    creditCash(state, plan.totalCost, { kind: 'adjustment', description: 'Freight refunded: no goods could be released from storage', dirty: false });
    return { ok: false, reason: 'No goods could be released from storage.', plan };
  }

  const vehicle = plan.vehicleId ? state.player.vehicles.find((v) => v.id === plan.vehicleId) ?? null : null;
  if (vehicle) vehicle.inUseBy = 'logistics';
  for (const crewId of plan.crewIds) {
    const employee = state.player.crew.find((e) => e.id === crewId);
    if (employee) employee.status = 'deployed';
  }

  const shipment: Shipment = {
    id: newId(rng, 'ship'),
    originLocationId: state.player.locationId,
    destinationLocationId: destinationId,
    routeId: worldReg.findPath(state.player.locationId, destinationId, { mode })?.legs[0]?.route.id ?? '',
    mode,
    departedDay: state.world.day,
    arrivesDay: state.world.day + plan.days,
    items: shipmentItems,
    vehicleId: vehicle?.id ?? null,
    crewIds: plan.crewIds,
    declaredValue: plan.declaredValue,
    actualValue: plan.actualValue,
    concealed: plan.concealed,
    status: 'in_transit',
    insuranceId: plan.insurancePremium > 0 ? newId(rng, 'ins') : null,
    trackingCode: `DY${Math.abs(rng.int(100000, 999999))}${destinationId.slice(0, 2).toUpperCase()}`,
    managedBy: null,
    delayReason: null,
  };
  state.player.shipments.push(shipment);
  bumpCounter(state, 'shipments_sent');
  setCounter(state, 'freight_spend', round2(counter(state, 'freight_spend') + plan.totalCost));
  grantXp(state, Math.round(18 + Math.log10(Math.max(100, plan.actualValue)) * 9), `Shipped ${Math.round(plan.weightKg)} kg to ${plan.destinationName}`);

  pushNotification(state, {
    kind: 'info',
    title: `Shipment ${shipment.trackingCode} departed`,
    body: `${Math.round(plan.weightKg).toLocaleString('en-US')} kg to ${plan.destinationName} by ${mode}, arriving day ${shipment.arrivesDay}. Freight ${formatMoney(plan.totalCost)}${plan.insurancePremium > 0 ? ` (insured for ${formatMoney(plan.insuranceCover)})` : ''}${plan.borderCrossings > 0 ? `, ${plan.borderCrossings} border crossing(s) with a ${(plan.detectionChance * 100).toFixed(1)}% inspection chance` : ''}.`,
    link: '/game/logistics',
    metrics: [
      { label: 'Value', value: formatMoney(plan.actualValue) },
      { label: 'Declared', value: formatMoney(plan.declaredValue) },
      { label: 'Theft risk', value: `${(plan.theftChance * 100).toFixed(1)}%` },
      { label: 'Delay risk', value: `${(plan.delayChance * 100).toFixed(1)}%` },
    ],
  });
  return { ok: true, shipment, plan };
}

/* ------------------------------------------------------------------ */
/* In-transit tick                                                     */
/* ------------------------------------------------------------------ */

export interface ShipmentEvent {
  shipmentId: ID;
  trackingCode: string;
  kind: 'delayed' | 'theft' | 'seized' | 'delivered' | 'damaged' | 'insurance';
  detail: string;
  value: number;
}

export interface LogisticsTickResult {
  events: ShipmentEvent[];
  delivered: ID[];
  inTransit: number;
  freightSpend: number;
  insurancePayouts: number;
  vehicleWear: number;
}

export function logisticsTick(state: GameState, rng: Rng): LogisticsTickResult {
  const result: LogisticsTickResult = { events: [], delivered: [], inTransit: 0, freightSpend: 0, insurancePayouts: 0, vehicleWear: 0 };
  const day = state.world.day;
  const mods = playerModifiers(state);

  for (const shipment of state.player.shipments) {
    if (shipment.status === 'delivered' || shipment.status === 'lost' || shipment.status === 'intercepted') continue;
    result.inTransit += 1;

    /* -------------------------------- delay -------------------------------- */
    if (shipment.status === 'in_transit' && rng.chance(B.logistics.shipmentDelayChancePerDay)) {
      const extra = rng.int(B.logistics.shipmentDelayDays[0], B.logistics.shipmentDelayDays[1]);
      shipment.arrivesDay += extra;
      shipment.status = 'delayed';
      shipment.delayReason = rng.chance(0.5) ? 'Border queue' : 'Carrier capacity';
      result.events.push({
        shipmentId: shipment.id,
        trackingCode: shipment.trackingCode,
        kind: 'delayed',
        detail: `${shipment.delayReason} added ${extra} day(s); now due day ${shipment.arrivesDay}.`,
        value: 0,
      });
      continue;
    }
    if (shipment.status === 'delayed' && rng.chance(0.45)) {
      shipment.status = 'in_transit';
      shipment.delayReason = null;
    }

    /* -------------------------------- theft -------------------------------- */
    const route = worldReg.route(shipment.routeId);
    const routeState = state.world.routes[shipment.routeId];
    const risk = (routeState?.risk ?? route?.baseRisk ?? 0.1) * (routeState?.disrupted ? 1.5 : 1);
    const theftChance = clamp(
      (B.logistics.theftChancePerDayBase + risk * 0.02) * (1 + shipment.actualValue / 500_000) * (1 - detectionReduction(mods) * 0.5),
      0,
      0.4,
    );
    if (rng.chance(theftChance)) {
      const fraction = rng.float(0.2, 0.8);
      const lostValue = round2(shipment.actualValue * fraction);
      shipment.actualValue = round2(shipment.actualValue - lostValue);
      shipment.items = shipment.items
        .map((item) => ({ ...item, qty: Math.max(0, Math.round(item.qty * (1 - fraction))) }))
        .filter((item) => item.qty > 0);
      result.events.push({
        shipmentId: shipment.id,
        trackingCode: shipment.trackingCode,
        kind: 'theft',
        detail: `Pilfered in transit: ${formatMoney(lostValue)} of cargo gone (${(fraction * 100).toFixed(0)}%).`,
        value: lostValue,
      });
      if (shipment.insuranceId && lostValue > 0) {
        const payout = round2(lostValue * B.logistics.insurancePayoutFraction);
        creditCash(state, payout, { kind: 'insurance', description: `Insurance payout on shipment ${shipment.trackingCode}`, dirty: false });
        result.insurancePayouts = round2(result.insurancePayouts + payout);
        result.events.push({ shipmentId: shipment.id, trackingCode: shipment.trackingCode, kind: 'insurance', detail: `Insurer paid ${formatMoney(payout)}.`, value: payout });
      }
      if (shipment.items.length === 0) {
        shipment.status = 'lost';
        releaseVehicle(state, shipment);
      }
      continue;
    }

    /* ------------------------------ interception --------------------------- */
    const bordersOnLeg = route?.borderCrossing ?? false;
    const illegal = shipment.items.some((item) => (registry.get(item.commodityId)?.legality ?? 'legal') !== 'legal');
    if (bordersOnLeg && illegal) {
      const vehicle = shipment.vehicleId ? state.player.vehicles.find((v) => v.id === shipment.vehicleId) ?? null : null;
      const exposure = shipment.items.reduce((s, item) => s + item.qty * (registry.get(item.commodityId)?.risk ?? 0.4), 0);
      const underDeclared = shipment.declaredValue < shipment.actualValue * 0.8;
      const chance = clamp(
        (B.travel.contrabandDetectionBase + exposure * B.travel.contrabandDetectionPerUnit + (route?.customsIntensity ?? 0.3) * 0.3 + (underDeclared ? 0.12 : 0)) *
          (shipment.concealed ? 1 - B.travel.hiddenCompartmentDetectionReduction : 1) *
          (vehicle ? 1 - vehicle.stealth * 0.45 : 1) *
          (1 - detectionReduction(mods)) *
          state.config.difficultyModifiers.enforcementMultiplier,
        0.002,
        0.9,
      );
      if (rng.chance(chance)) {
        const seizedValue = round2(shipment.actualValue * B.travel.seizureFractionOnCaught);
        shipment.status = 'intercepted';
        shipment.items = [];
        releaseVehicle(state, shipment);
        addHeat(state, round2(14 + seizedValue / 30_000), `Shipment ${shipment.trackingCode} intercepted at a border`);
        changeReputation(state, 'legal', -5, 'Freight seized at the border');
        changeReputation(state, 'criminal', 2, 'Ran contraband freight');
        bumpCounter(state, 'shipments_seized');
        setCounter(state, 'seized_value', round2(counter(state, 'seized_value') + seizedValue));
        const fine = round2(seizedValue * 0.35);
        debitCash(state, fine, { kind: 'fine', description: `Customs fine on shipment ${shipment.trackingCode}`, allowDirty: true });
        result.events.push({
          shipmentId: shipment.id,
          trackingCode: shipment.trackingCode,
          kind: 'seized',
          detail: `Customs seized the cargo (${formatMoney(seizedValue)}) and fined ${formatMoney(fine)}. Detection chance was ${(chance * 100).toFixed(1)}%.`,
          value: seizedValue,
        });
        pushNotification(state, {
          kind: 'danger',
          title: `Shipment ${shipment.trackingCode} seized`,
          body: `Intercepted en route to ${worldReg.requireLocation(shipment.destinationLocationId).name}. Cargo ${formatMoney(seizedValue)}, fine ${formatMoney(fine)}, heat raised.`,
          link: '/game/logistics',
          metrics: [
            { label: 'Seized', value: formatMoney(seizedValue) },
            { label: 'Fine', value: formatMoney(fine) },
            { label: 'Detection was', value: `${(chance * 100).toFixed(1)}%` },
          ],
        });
        continue;
      }
    }

    /* ------------------------------- delivery ------------------------------ */
    if (day >= shipment.arrivesDay) {
      const delivered = deliverShipment(state, rng, shipment);
      result.delivered.push(shipment.id);
      result.events.push(delivered);
      releaseVehicle(state, shipment);
    }
  }

  // Vehicle wear while away, plus condition decay and maintenance prompts.
  for (const vehicle of state.player.vehicles) {
    if (vehicle.inUseBy !== 'logistics') {
      vehicle.condition = round2(clamp(vehicle.condition - 0.0006, 0.05, 1));
      continue;
    }
    const def = VEHICLES.find((v) => v.id === vehicle.defId);
    const wear = round2(0.004 * (1.3 - (def?.reliability ?? 0.8)) + rng.float(0, 0.002));
    vehicle.condition = round2(clamp(vehicle.condition - wear, 0.05, 1));
    result.vehicleWear = round2(result.vehicleWear + wear);
    if (day >= vehicle.maintenanceDueDay && vehicle.condition < 0.72) {
      pushNotification(state, {
        kind: 'warning',
        title: `${vehicle.name} needs service`,
        body: `Condition ${(vehicle.condition * 100).toFixed(0)}%. Breakdowns and theft risk rise as condition falls.`,
        link: '/game/logistics',
      });
      vehicle.maintenanceDueDay = day + 15;
    }
  }

  // Prune finished shipments so long saves stay small but the audit trail holds.
  if (state.player.shipments.length > 60) {
    state.player.shipments = state.player.shipments.filter(
      (s) => s.status === 'in_transit' || s.status === 'delayed' || day - s.departedDay < 45,
    );
  }
  return result;
}

function releaseVehicle(state: GameState, shipment: Shipment): void {
  if (shipment.vehicleId) {
    const vehicle = state.player.vehicles.find((v) => v.id === shipment.vehicleId);
    if (vehicle) {
      vehicle.inUseBy = 'idle';
      vehicle.locationId = shipment.destinationLocationId;
    }
  }
  for (const crewId of shipment.crewIds) {
    const employee = state.player.crew.find((e) => e.id === crewId);
    if (employee && employee.status === 'deployed') {
      employee.status = 'active';
      employee.locationId = shipment.destinationLocationId;
    }
  }
}

function deliverShipment(state: GameState, rng: Rng, shipment: Shipment): ShipmentEvent {
  const destination = shipment.destinationLocationId;
  shipment.status = 'delivered';

  // Goods need somewhere to go: the player's storage at the destination, else a
  // bonded depot is created (and charged) so deliveries are never destroyed.
  let storage = storagesAtLocation(state, destination).filter((s) => s.kind !== 'personal').sort((a, b) => b.capacityKg - a.capacityKg)[0];
  if (!storage) {
    storage = createDepot(state, rng, destination);
  }
  let landedValue = 0;
  const landed: string[] = [];
  for (const item of shipment.items) {
    const c = registry.get(item.commodityId);
    if (!c) continue;
    const result = addItemSafe(state, storage, item.commodityId, item.qty, shipment.concealed);
    landedValue += result.qty * c.baseValue;
    if (result.qty > 0) landed.push(`${result.qty} × ${c.name}`);
  }

  bumpCounter(state, 'shipments_delivered');
  setCounter(state, 'delivered_value', round2(counter(state, 'delivered_value') + landedValue));
  grantXp(state, Math.round(22 + Math.log10(Math.max(100, landedValue)) * 10), `Delivered a shipment to ${worldReg.requireLocation(destination).name}`);
  pushNotification(state, {
    kind: 'success',
    title: `Shipment ${shipment.trackingCode} delivered`,
    body: `${landed.length > 0 ? landed.join(', ') : 'The cargo'} landed in ${worldReg.requireLocation(destination).name} and was put in ${storage.name}. Value about ${formatMoney(round2(landedValue))}.`,
    link: '/game/logistics',
    metrics: [
      { label: 'Transit days', value: String(state.world.day - shipment.departedDay) },
      { label: 'Value landed', value: formatMoney(round2(landedValue)) },
    ],
  });
  return {
    shipmentId: shipment.id,
    trackingCode: shipment.trackingCode,
    kind: 'delivered',
    detail: `Delivered to ${worldReg.requireLocation(destination).name}: ${landed.length > 0 ? landed.join(', ') : 'empty'} (~${formatMoney(round2(landedValue))}).`,
    value: round2(landedValue),
  };
}

function addItemSafe(state: GameState, storage: StorageUnit, commodityId: ID, qty: number, concealed: boolean): { qty: number } {
  // Placement rules live in the inventory module so capacity and handling
  // requirements are respected; overflow falls back to any unit that fits.
  const first = addItem(state, { commodityId, qty, storageId: storage.id, concealed, origin: 'purchased' });
  if (first.ok) return { qty: first.qty };
  const fallback = addItem(state, { commodityId, qty, concealed: false, origin: 'purchased' });
  return { qty: fallback.ok ? fallback.qty : 0 };
}

/** A rented bonded depot at a destination, so freight is never lost on arrival. */
function createDepot(state: GameState, rng: Rng, locationId: ID): StorageUnit {
  const depot: StorageUnit = {
    id: newId(rng, 'depot'),
    kind: 'warehouse',
    name: `Bonded depot — ${worldReg.requireLocation(locationId).name}`,
    locationId,
    propertyId: null,
    vehicleId: null,
    capacityKg: 25_000,
    capacityL: 60_000,
    security: 0.55,
    refrigerated: false,
    hiddenCompartmentKg: 0,
    costPerDay: 85,
    insured: false,
    insuredValue: 0,
  };
  state.player.storages.push(depot);
  pushNotification(state, {
    kind: 'info',
    title: 'Bonded depot rented',
    body: `You have no storage in ${worldReg.requireLocation(locationId).name}, so the carrier put your goods in a bonded depot at ${formatMoney(depot.costPerDay)}/day. Buy a property there to stop paying rent.`,
    link: '/game/logistics',
  });
  return depot;
}

/** Daily rent for depots and third-party storage. */
export function storageRentTick(state: GameState): { paid: number; units: number } {
  let paid = 0;
  let units = 0;
  for (const storage of state.player.storages) {
    if (storage.costPerDay <= 0 || storage.propertyId !== null) continue;
    const move = debitCash(state, storage.costPerDay, {
      kind: 'fee',
      description: `Storage rent: ${storage.name}`,
      allowDirty: false,
      locationId: storage.locationId,
    });
    if (move.ok) {
      paid = round2(paid + storage.costPerDay);
      units += 1;
    }
  }
  if (paid > 0) setCounter(state, 'storage_rent', round2(counter(state, 'storage_rent') + paid));
  return { paid, units };
}

/* ------------------------------------------------------------------ */
/* Goods handling                                                      */
/* ------------------------------------------------------------------ */

export function moveGoods(
  state: GameState,
  commodityId: ID,
  qty: number,
  fromStorageId: ID,
  toStorageId: ID,
): { ok: boolean; reason?: string; moved?: number } {
  const from = getStorage(state, fromStorageId);
  const to = getStorage(state, toStorageId);
  if (!from || !to) return { ok: false, reason: 'Unknown storage unit.' };
  if (from.locationId !== to.locationId) {
    return { ok: false, reason: 'Goods can only be moved between storage at the same location. Use a shipment to move them between cities.' };
  }
  const stack = state.player.inventory.find((s) => s.storageId === fromStorageId && s.commodityId === commodityId && s.qty > 0);
  if (!stack) return { ok: false, reason: 'No such goods in that storage unit.' };
  const moved = Math.min(Math.max(0, Math.floor(qty)), stack.qty);
  if (moved <= 0) return { ok: false, reason: 'Quantity must be positive.' };
  stack.qty -= moved;
  if (stack.qty <= 0) state.player.inventory = state.player.inventory.filter((s) => s.id !== stack.id);
  const result = addItem(state, {
    commodityId,
    qty: moved,
    storageId: toStorageId,
    avgCost: stack.avgCost,
    quality: stack.quality,
    day: stack.acquiredDay,
    concealed: stack.concealed,
    origin: stack.origin,
  });
  if (!result.ok) {
    // Put it back rather than destroying goods.
    addItem(state, { commodityId, qty: moved, storageId: fromStorageId, avgCost: stack.avgCost, quality: stack.quality, origin: stack.origin });
    return { ok: false, reason: result.message ?? `The destination cannot hold it (${result.problem ?? 'capacity'}).` };
  }
  return { ok: true, moved: result.qty };
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface ShipmentView {
  id: ID;
  trackingCode: string;
  origin: string;
  destination: string;
  mode: TravelMode;
  departedDay: number;
  arrivesDay: number;
  daysRemaining: number;
  progress: number;
  status: Shipment['status'];
  delayReason: string | null;
  items: { commodityId: ID; name: string; qty: number; value: number; illegal: boolean }[];
  declaredValue: number;
  actualValue: number;
  underDeclared: boolean;
  concealed: boolean;
  insured: boolean;
  vehicle: string | null;
  crew: string[];
}

export function shipmentViews(state: GameState): ShipmentView[] {
  return state.player.shipments.map((s) => {
    const total = Math.max(1, s.arrivesDay - s.departedDay);
    return {
      id: s.id,
      trackingCode: s.trackingCode,
      origin: worldReg.location(s.originLocationId)?.name ?? s.originLocationId,
      destination: worldReg.location(s.destinationLocationId)?.name ?? s.destinationLocationId,
      mode: s.mode,
      departedDay: s.departedDay,
      arrivesDay: s.arrivesDay,
      daysRemaining: Math.max(0, s.arrivesDay - state.world.day),
      progress: round2(clamp((state.world.day - s.departedDay) / total, 0, 1)),
      status: s.status,
      delayReason: s.delayReason,
      items: s.items.map((item) => {
        const c = registry.get(item.commodityId);
        return {
          commodityId: item.commodityId,
          name: c?.name ?? item.commodityId,
          qty: item.qty,
          value: round2((c?.baseValue ?? 0) * item.qty),
          illegal: (c?.legality ?? 'legal') !== 'legal',
        };
      }),
      declaredValue: s.declaredValue,
      actualValue: s.actualValue,
      underDeclared: s.declaredValue < s.actualValue * 0.8,
      concealed: s.concealed,
      insured: s.insuranceId !== null,
      vehicle: s.vehicleId ? state.player.vehicles.find((v) => v.id === s.vehicleId)?.name ?? null : null,
      crew: s.crewIds.map((id) => state.player.crew.find((e) => e.id === id)?.name ?? id),
    };
  });
}

export interface LogisticsView {
  shipments: ShipmentView[];
  inTransit: number;
  delivered: number;
  seized: number;
  lost: number;
  valueInTransit: number;
  vehicles: {
    id: ID;
    name: string;
    kind: string;
    here: boolean;
    locationName: string;
    condition: number;
    damage: number;
    fuel: number;
    capacityKg: number;
    usedKg: number;
    capacityL: number;
    hiddenCompartmentKg: number;
    stealth: number;
    armor: number;
    speedKmPerDay: number;
    odometerKm: number;
    upgrades: { id: ID; name: string }[];
    freeUpgradeSlots: number;
    inUseBy: VehicleInstance['inUseBy'];
    value: number;
    serviceCost: number;
    assignedCrew: string | null;
  }[];
  storage: {
    id: ID;
    name: string;
    kind: string;
    locationName: string;
    here: boolean;
    capacityKg: number;
    usedKg: number;
    capacityL: number;
    usedL: number;
    utilisation: number;
    security: number;
    refrigerated: boolean;
    hiddenCompartmentKg: number;
    costPerDay: number;
    insured: boolean;
    stacks: number;
    value: number;
  }[];
  warehouseRentPerDay: number;
  freightSpend: number;
  deliveredValue: number;
  seizedValue: number;
  catalogue: VehicleListing[];
}

export function logisticsView(state: GameState): LogisticsView {
  const here = state.player.locationId;
  return {
    shipments: shipmentViews(state),
    inTransit: state.player.shipments.filter((s) => s.status === 'in_transit' || s.status === 'delayed').length,
    delivered: counter(state, 'shipments_delivered'),
    seized: counter(state, 'shipments_seized'),
    lost: state.player.shipments.filter((s) => s.status === 'lost').length,
    valueInTransit: round2(
      state.player.shipments
        .filter((s) => s.status === 'in_transit' || s.status === 'delayed')
        .reduce((sum, s) => sum + s.actualValue, 0),
    ),
    vehicles: state.player.vehicles.map((v) => {
      const def = VEHICLES.find((d) => d.id === v.defId);
      const storage = state.player.storages.find((s) => s.vehicleId === v.id);
      const usedKg = storage
        ? round2(state.player.inventory.filter((i) => i.storageId === storage.id).reduce((sum, i) => sum + i.qty * (registry.get(i.commodityId)?.weightKg ?? 0), 0))
        : 0;
      return {
        id: v.id,
        name: v.name,
        kind: def?.kind ?? 'car',
        here: v.locationId === here,
        locationName: worldReg.location(v.locationId)?.name ?? v.locationId,
        condition: v.condition,
        damage: v.damage,
        fuel: v.fuel,
        capacityKg: v.capacityKg,
        usedKg,
        capacityL: v.capacityL,
        hiddenCompartmentKg: v.hiddenCompartmentKg,
        stealth: v.stealth,
        armor: v.armor,
        speedKmPerDay: v.speedKmPerDay,
        odometerKm: Math.round(v.odometerKm),
        upgrades: v.upgrades.map((id) => ({ id, name: VEHICLE_UPGRADE_BY_ID[id]?.name ?? id })),
        freeUpgradeSlots: Math.max(0, (def?.upgradeSlots ?? 0) - v.upgrades.length),
        inUseBy: v.inUseBy,
        value: round2((def?.price ?? v.purchasePrice) * (0.35 + v.condition * 0.5) * (1 - v.damage * 0.3)),
        serviceCost: round2(Math.max(120, (def?.price ?? 5000) * 0.012 * (1.2 - v.condition) + v.damage * 900)),
        assignedCrew: v.assignedCrewId ? state.player.crew.find((e) => e.id === v.assignedCrewId)?.name ?? null : null,
      };
    }),
    storage: state.player.storages.map((s) => {
      const stacks = state.player.inventory.filter((i) => i.storageId === s.id);
      const usedKg = round2(stacks.reduce((sum, i) => sum + i.qty * (registry.get(i.commodityId)?.weightKg ?? 0), 0));
      const usedL = round2(stacks.reduce((sum, i) => sum + i.qty * (registry.get(i.commodityId)?.volumeL ?? 0), 0));
      const value = round2(stacks.reduce((sum, i) => sum + i.qty * (registry.get(i.commodityId)?.baseValue ?? 0), 0));
      return {
        id: s.id,
        name: s.name,
        kind: s.kind,
        locationName: worldReg.location(s.locationId)?.name ?? s.locationId,
        here: s.locationId === here || s.kind === 'personal',
        capacityKg: s.capacityKg,
        usedKg,
        capacityL: s.capacityL,
        usedL,
        utilisation: s.capacityKg > 0 ? round2(usedKg / s.capacityKg) : 0,
        security: s.security,
        refrigerated: s.refrigerated,
        hiddenCompartmentKg: s.hiddenCompartmentKg,
        costPerDay: s.costPerDay,
        insured: s.insured,
        stacks: stacks.length,
        value,
      };
    }),
    warehouseRentPerDay: round2(state.player.storages.filter((s) => s.costPerDay > 0 && s.propertyId === null).reduce((sum, s) => sum + s.costPerDay, 0)),
    freightSpend: round2(counter(state, 'freight_spend')),
    deliveredValue: round2(counter(state, 'delivered_value')),
    seizedValue: round2(counter(state, 'seized_value')),
    catalogue: vehicleListings(state),
  };
}

/** Insurance cover available across storage units (used by the theft tick). */
export function insuredValueAt(state: GameState, locationId: ID): number {
  return round2(
    state.player.storages
      .filter((s) => s.locationId === locationId && s.insured)
      .reduce((sum, s) => sum + s.insuredValue, 0),
  );
}
