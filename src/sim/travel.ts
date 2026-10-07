/**
 * Travel — the world graph as a gameplay system (spec §12).
 *
 * Journeys are planned across the node/route graph with Dijkstra paths, costed
 * per mode (tickets for public transport, fuel + maintenance for your own
 * vehicles), and resolved day by day. Border crossings roll customs inspection
 * against concealed contraband, smuggling skill, vehicle stealth and heat;
 * dangerous legs can spawn encounters.
 *
 * A journey is a state machine, not a teleport: `executeTravel` advances days
 * through the injected `advanceDay` hook (so the world keeps simulating while
 * you are on the road) and pauses if a major encounter needs tactical play.
 * `resumeTravel` continues afterwards. Nothing here is a dead end — if you are
 * arrested or your vehicle is wrecked you can still travel once you are out.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { VEHICLES } from '../engine/registry/assets';
import { getWorldRegistry } from '../engine/registry/world';
import { startCombat, type CombatResult } from './combat';
import { portableCapacityKg, quantityOnHand } from './inventory';
import { detectionReduction, travelCostReduction, travelTimeReduction } from './modifiers';
import { recordObjective } from './missions';
import { bumpCounter, counter, grantXp, playerModifiers } from './progression';
import { addHeat, changeReputation } from './reputation';
import { creditCash, debitCash, formatMoney, pushDiagnostic, pushNotification, round2 } from './state';
import type { ActiveCombat, CommodityDef, GameState, ID, TravelMode, TravelState, VehicleInstance } from './types';
import { materialiseLocation } from './markets';

const B = getBalance();
const worldReg = getWorldRegistry();
const registry = getCommodityRegistry();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Nominal range of a full tank, by vehicle kind (km). */
const TANK_RANGE_KM: Record<string, number> = {
  motorcycle: 320,
  car: 620,
  van: 560,
  truck: 900,
  trailer: 900,
  armored: 480,
  boat: 2600,
  aircraft: 3400,
};

/** Modes that require your own vehicle, and which vehicle kinds satisfy them. */
const MODE_VEHICLE_KINDS: Partial<Record<TravelMode, string[]>> = {
  car: ['car', 'van', 'motorcycle', 'armored'],
  truck: ['truck', 'trailer', 'armored', 'van'],
  private_jet: ['aircraft'],
  cargo_ship: ['boat'],
};

export const ALL_MODES: TravelMode[] = ['foot', 'bus', 'car', 'truck', 'train', 'ferry', 'air', 'private_jet', 'cargo_ship'];

/* ------------------------------------------------------------------ */
/* Hooks and planning                                                  */
/* ------------------------------------------------------------------ */

export interface TravelHooks {
  /**
   * Advance the whole simulation by one day. Injected by the action layer so
   * travel never imports the tick module (and therefore never creates a cycle).
   */
  advanceDay: (state: GameState, rng: Rng) => void;
}

export interface TravelPlanLeg {
  routeId: ID;
  fromId: ID;
  toId: ID;
  fromName: string;
  toName: string;
  distanceKm: number;
  borderCrossing: boolean;
  fromCountry: string;
  toCountry: string;
  customsIntensity: number;
  baseRisk: number;
  currentRisk: number;
  disrupted: boolean;
  disruptionReason: string | null;
  costMultiplier: number;
  modes: TravelMode[];
  supported: boolean;
}

export interface CargoLine {
  commodityId: ID;
  name: string;
  qty: number;
  weightKg: number;
  volumeL: number;
  value: number;
  legality: string;
  concealed: boolean;
  illegal: boolean;
}

export interface CostLine {
  label: string;
  amount: number;
  kind: 'ticket' | 'fuel' | 'maintenance' | 'toll' | 'bribe' | 'baggage' | 'refuel' | 'crew';
}

export interface TravelPlan {
  ok: boolean;
  code?: string;
  reason?: string;
  hint?: string;
  fromId: ID;
  fromName: string;
  toId: ID;
  toName: string;
  mode: TravelMode;
  legs: TravelPlanLeg[];
  distanceKm: number;
  borderCrossings: number;
  days: number;
  costs: CostLine[];
  totalCost: number;
  cashAvailable: number;
  vehicle: { id: ID; name: string; capacityKg: number; fuel: number; condition: number } | null;
  cargoKg: number;
  cargoL: number;
  capacityKg: number;
  capacityL: number;
  overCapacityKg: number;
  overCapacityL: number;
  cargo: CargoLine[];
  contrabandValue: number;
  contrabandUnits: number;
  detectionChancePerBorder: number;
  seizureValueAtRisk: number;
  encounterChancePerLeg: number;
  bribeCostPerBorder: number;
  bribeSuccessChance: number;
  xp: number;
  warnings: string[];
  routeRisk: number;
  discovered: boolean;
}

/**
 * What travels with the player.
 *
 * `vehicleId` selects the vehicle whose cargo space counts. When omitted it falls
 * back to the vehicle of a journey in progress — which means a *planned* shipment
 * must pass the vehicle it intends to use, or goods loaded in a van are invisible
 * to the plan and every dispatch fails the capacity check.
 */
export function cargoManifest(state: GameState, vehicleId?: ID | null): CargoLine[] {
  const personalIds = new Set(state.player.storages.filter((s) => s.kind === 'personal').map((s) => s.id));
  const travel = state.player.travel;
  const resolvedVehicleId = vehicleId !== undefined ? vehicleId : travel?.vehicleId ?? null;
  const vehicleStorageIds = new Set(
    state.player.storages
      .filter((s) => s.vehicleId !== null && (resolvedVehicleId === null || s.vehicleId === resolvedVehicleId))
      .map((s) => s.id),
  );
  const carried = new Set([...personalIds, ...vehicleStorageIds]);
  const lines: CargoLine[] = [];
  for (const stack of state.player.inventory) {
    if (!carried.has(stack.storageId)) continue;
    const c = registry.get(stack.commodityId);
    if (!c) continue;
    lines.push({
      commodityId: c.id,
      name: c.name,
      qty: stack.qty,
      weightKg: round2(c.weightKg * stack.qty),
      volumeL: round2(c.volumeL * stack.qty),
      value: round2(stack.qty * c.baseValue),
      legality: c.legality,
      concealed: stack.concealed,
      illegal: c.legality !== 'legal',
    });
  }
  return lines;
}

export function bestVehicleFor(state: GameState, mode: TravelMode): VehicleInstance | null {
  const kinds = MODE_VEHICLE_KINDS[mode];
  if (!kinds) return null;
  const candidates = state.player.vehicles
    .filter((v) => v.locationId === state.player.locationId)
    .filter((v) => v.inUseBy === 'idle' || v.inUseBy === 'player')
    .filter((v) => v.condition > 0.15 && v.damage < 0.9)
    .filter((v) => {
      const def = VEHICLES.find((d) => d.id === v.defId);
      return def !== undefined && (kinds as string[]).includes(def.kind);
    })
    .sort((a, b) => b.capacityKg * b.condition - a.capacityKg * a.condition);
  return candidates[0] ?? null;
}

function vehicleDef(v: VehicleInstance | null) {
  return v ? VEHICLES.find((d) => d.id === v.defId) ?? null : null;
}

export function travelSpeedKmPerDay(state: GameState, mode: TravelMode, vehicle: VehicleInstance | null): number {
  const mods = playerModifiers(state);
  const tableSpeed = B.travel.speedKmPerDay[mode] ?? 400;
  const base = vehicle ? Math.max(vehicle.speedKmPerDay, 40) * (0.55 + vehicle.condition * 0.45) : tableSpeed;
  const skillKey = mode === 'air' || mode === 'private_jet' ? 'piloting' : mode === 'cargo_ship' || mode === 'ferry' ? 'seamanship' : 'driving';
  return Math.max(8, base * (1 + travelTimeReduction(mods) + mods.skill(skillKey) * 0.006));
}

/** Customs detection chance for one border crossing with the current cargo. */
export function detectionChance(state: GameState, leg: TravelPlanLeg, cargo: CargoLine[], vehicle: VehicleInstance | null): number {
  const mods = playerModifiers(state);
  const contraband = cargo.filter((c) => c.illegal);
  if (contraband.length === 0) {
    // Legal cargo still gets a paperwork check, but it cannot cost you goods.
    return round2(clamp(leg.customsIntensity * 0.25 * B.travel.contrabandDetectionBase * 4, 0, 0.35));
  }
  const exposure = contraband.reduce((s, c) => s + c.qty * (registry.get(c.commodityId)?.risk ?? 0.4), 0);
  const def = vehicleDef(vehicle);
  const concealedKg = contraband.filter((c) => c.concealed).reduce((s, c) => s + c.weightKg, 0);
  const openKg = contraband.filter((c) => !c.concealed).reduce((s, c) => s + c.weightKg, 0);
  const hiddenCapacity = (vehicle?.hiddenCompartmentKg ?? 0) + state.player.storages.filter((s) => s.kind === 'personal').reduce((sum, s) => sum + s.hiddenCompartmentKg, 0);
  const properlyHidden = concealedKg > 0 && concealedKg <= Math.max(1, hiddenCapacity);

  let chance =
    B.travel.contrabandDetectionBase +
    exposure * B.travel.contrabandDetectionPerUnit +
    leg.customsIntensity * 0.28 +
    (openKg > 0 ? 0.08 : 0) +
    state.player.reputation.heat * 0.0016;
  if (properlyHidden) chance *= 1 - B.travel.hiddenCompartmentDetectionReduction;
  if (def) chance *= 1 - def.stealth * 0.45;
  chance *= 1 - detectionReduction(mods);
  chance *= 1 - clamp(mods.skill('smuggling') * 0.022, 0, 0.5);
  chance *= 1 - clamp(mods.skill('forgery') * 0.012, 0, 0.3);
  return round2(clamp(chance * state.config.difficultyModifiers.enforcementMultiplier, 0.005, 0.92));
}

/** Chance a customs bribe is accepted at a given border, before it is paid. */
export function bribeSuccessBase(state: GameState, leg: TravelPlanLeg): number {
  const mods = playerModifiers(state);
  const corruption = worldReg.location(leg.toId)?.laws.corruption ?? 0.3;
  return round2(
    clamp(B.travel.bribeSuccessBase + corruption * 0.35 + mods.skill('bribery') * 0.014 + mods.skill('forgery') * 0.008, 0.05, 0.95),
  );
}

export function planTravel(state: GameState, toId: ID, mode: TravelMode): TravelPlan {
  const fromId = state.player.locationId;
  const from = worldReg.location(fromId);
  const to = worldReg.location(toId);
  const warnings: string[] = [];

  const base: TravelPlan = {
    ok: false,
    /*
     * No placeholder `reason`.
     *
     * Every failure branch below supplies its own, and the success branch must
     * carry none: a plan that says `ok: true` next to "Travel is not possible
     * right now." contradicts itself, and any caller using `plan.reason` as a
     * fallback message would show a failure string for a journey it is about to
     * take. `warnings` is the channel for advice that does not block the trip.
     */
    fromId,
    fromName: from?.name ?? fromId,
    toId,
    toName: to?.name ?? toId,
    mode,
    legs: [],
    distanceKm: 0,
    borderCrossings: 0,
    days: 0,
    costs: [],
    totalCost: 0,
    cashAvailable: 0,
    vehicle: null,
    cargoKg: 0,
    cargoL: 0,
    capacityKg: 0,
    capacityL: 0,
    overCapacityKg: 0,
    overCapacityL: 0,
    cargo: [],
    contrabandValue: 0,
    contrabandUnits: 0,
    detectionChancePerBorder: 0,
    seizureValueAtRisk: 0,
    encounterChancePerLeg: 0,
    bribeCostPerBorder: 0,
    bribeSuccessChance: 0,
    xp: 0,
    warnings,
    routeRisk: 0,
    discovered: to ? !to.hidden || (state.world.locations[toId]?.discovered ?? false) : false,
  };

  if (!from || !to) return { ...base, ok: false, code: 'unknown_location', reason: 'Unknown location.' };
  if (fromId === toId) return { ...base, ok: false, code: 'already_here', reason: `You are already in ${from.name}.` };
  if (state.player.prison.incarcerated) {
    return { ...base, ok: false, code: 'incarcerated', reason: 'You are in prison.', hint: 'Post bail, serve the sentence, or attempt an escape.' };
  }
  if (state.world.locations[fromId]?.lockdown) {
    return { ...base, ok: false, code: 'lockdown', reason: `${from.name} is under lockdown — nobody leaves.` };
  }
  if (state.world.locations[fromId]?.borderClosed) {
    return { ...base, ok: false, code: 'border_closed', reason: `${from.countryName}'s borders are closed.` };
  }
  if (to.hidden && !(state.world.locations[toId]?.discovered ?? false)) {
    return {
      ...base,
      ok: false,
      code: 'undiscovered',
      reason: `${to.name} is not a place you can buy a ticket to.`,
      hint: 'Buy location intel on the darknet or get introduced by a faction that controls it.',
    };
  }

  const path = worldReg.findPath(fromId, toId, { mode });
  if (!path || path.legs.length === 0) {
    // Fall back to any mode so the player is never permanently stuck.
    const anyPath = worldReg.findPath(fromId, toId);
    if (!anyPath || anyPath.legs.length === 0) {
      return { ...base, ok: false, code: 'unreachable', reason: `There is no route from ${from.name} to ${to.name}.` };
    }
    const usable = new Set(anyPath.legs.flatMap((l) => l.route.modes));
    return {
      ...base,
      ok: false,
      code: 'mode_unavailable',
      reason: `No ${mode} route connects ${from.name} to ${to.name}.`,
      hint: `Available modes on the shortest path: ${[...usable].join(', ')}.`,
    };
  }

  const vehicle = bestVehicleFor(state, mode);
  const def = vehicleDef(vehicle);
  if (MODE_VEHICLE_KINDS[mode] && !vehicle) {
    return {
      ...base,
      ok: false,
      code: 'no_vehicle',
      reason: `${mode} travel requires a suitable vehicle parked in ${from.name}.`,
      hint: 'Buy one from the Logistics screen, or travel by bus/train/air instead.',
    };
  }
  if (def?.requiredSkill) {
    const have = state.player.progression.skills[def.requiredSkill.skillId] ?? 0;
    if (have < def.requiredSkill.level) {
      return {
        ...base,
        ok: false,
        code: 'skill_required',
        reason: `Operating ${def.name} requires ${def.requiredSkill.skillId} ${def.requiredSkill.level} (you have ${have}).`,
        hint: 'Train the skill or hire a crew member who has it.',
      };
    }
  }

  const legs: TravelPlanLeg[] = path.legs.map((leg) => {
    const routeState = state.world.routes[leg.route.id];
    const fromLoc = leg.from;
    const toLoc = leg.to;
    return {
      routeId: leg.route.id,
      fromId: fromLoc.id,
      toId: toLoc.id,
      fromName: fromLoc.name,
      toName: toLoc.name,
      distanceKm: leg.distanceKm,
      borderCrossing: leg.route.borderCrossing,
      fromCountry: fromLoc.countryName,
      toCountry: toLoc.countryName,
      customsIntensity: leg.route.customsIntensity,
      baseRisk: leg.route.baseRisk,
      currentRisk: routeState?.risk ?? leg.route.baseRisk,
      disrupted: routeState?.disrupted ?? false,
      disruptionReason: routeState?.disruptionReason ?? null,
      costMultiplier: routeState?.costMultiplier ?? 1,
      modes: leg.route.modes,
      supported: leg.route.modes.includes(mode),
    };
  });

  const distanceKm = round2(path.distanceKm);
  const borderCrossings = legs.filter((l) => l.borderCrossing).length;
  const speed = travelSpeedKmPerDay(state, mode, vehicle);
  const days = Math.max(1, Math.ceil(distanceKm / speed));
  const mods = playerModifiers(state);
  const costCut = travelCostReduction(mods);

  const costs: CostLine[] = [];
  if (vehicle && def) {
    const fuel = round2(distanceKm * def.fuelPerKm * (1.25 - vehicle.condition * 0.25));
    const maintenance = round2(distanceKm * def.maintenancePerKm * (1.4 - vehicle.condition * 0.4));
    costs.push({ label: `Fuel (${def.name}, ${distanceKm.toLocaleString('en-US')} km)`, amount: fuel, kind: 'fuel' });
    costs.push({ label: 'Wear and maintenance', amount: maintenance, kind: 'maintenance' });
    const tankRange = TANK_RANGE_KM[def.kind] ?? 600;
    if (distanceKm > vehicle.fuel * tankRange) {
      const refuelCost = round2((distanceKm - vehicle.fuel * tankRange) * def.fuelPerKm * 1.18);
      costs.push({ label: 'Refuelling en route (premium)', amount: refuelCost, kind: 'refuel' });
      warnings.push(`Your tank only covers ${Math.round(vehicle.fuel * tankRange).toLocaleString('en-US')} km — you will buy fuel on the road at an 18% premium.`);
    }
  } else {
    const perKm = B.travel.costPerKm[mode] ?? 0.1;
    const fixed = B.travel.fixedCostByMode[mode] ?? 20;
    const people = 1 + availableCrewForJourney(state).length;
    costs.push({ label: `${mode} tickets (${people} traveller${people > 1 ? 's' : ''})`, amount: round2((distanceKm * perKm + fixed) * people), kind: 'ticket' });
  }

  for (const leg of legs) {
    if (leg.disrupted) {
      warnings.push(`${leg.fromName} → ${leg.toName}: ${leg.disruptionReason ?? 'route disrupted'} (cost ×${leg.costMultiplier.toFixed(2)}).`);
    }
    if (leg.currentRisk > 0.35) warnings.push(`${leg.fromName} → ${leg.toName} is dangerous (${(leg.currentRisk * 100).toFixed(0)}% risk).`);
    if (leg.borderCrossing) {
      const toll = round2(leg.customsIntensity * 60 * (vehicle ? 1.4 : 1));
      if (toll > 0) costs.push({ label: `Customs/visa fees — ${leg.toCountry}`, amount: toll, kind: 'toll' });
    }
  }

  // Cargo: what actually travels with you.
  const cargo = cargoManifest(state, vehicle?.id ?? null);
  const cargoKg = round2(cargo.reduce((s, c) => s + c.weightKg, 0));
  const cargoL = round2(cargo.reduce((s, c) => s + c.volumeL, 0));
  const personal = state.player.storages.find((s) => s.kind === 'personal');
  const capacityKg = round2(portableCapacityKg(state, fromId) + (vehicle ? vehicle.capacityKg : 0));
  const capacityL = round2((personal?.capacityL ?? B.logistics.personalCapacityLitres) + (vehicle?.capacityL ?? 0));

  // Public transport carries only what you can hold; excess is charged as freight.
  if (!vehicle) {
    const personalKg = personal?.capacityKg ?? B.logistics.personalCapacityKg;
    const excessKg = Math.max(0, cargoKg - personalKg);
    if (excessKg > 0) {
      const baggage = round2(excessKg * 2.6 * (mode === 'air' || mode === 'private_jet' ? 2.4 : 1));
      costs.push({ label: `Excess baggage (${Math.round(excessKg)} kg)`, amount: baggage, kind: 'baggage' });
      warnings.push(`${Math.round(excessKg)} kg of cargo travels as checked freight on ${mode} — it is exposed to handling loss and inspection.`);
    }
  }

  const costMultiplier = legs.reduce((m, l) => m * (l.disrupted ? l.costMultiplier : 1), 1);
  for (const line of costs) line.amount = round2(line.amount * costMultiplier * (1 - costCut));
  const contraband = cargo.filter((c) => c.illegal);
  const contrabandValue = round2(contraband.reduce((s, c) => s + c.value, 0));
  const contrabandUnits = contraband.reduce((s, c) => s + c.qty, 0);

  const borderLeg = legs.find((l) => l.borderCrossing);
  const detectionPerBorder = borderLeg ? detectionChance(state, borderLeg, cargo, vehicle) : 0;
  const bribeCostPerBorder = round2(Math.max(150, contrabandValue * B.travel.bribeCostMultiplier * 0.06));
  if (borderLeg && contrabandUnits > 0) {
    warnings.push(
      `${borderCrossings} border crossing(s) carrying ${contrabandUnits} unit(s) of contraband worth ${formatMoney(contrabandValue)}: ` +
        `${(detectionPerBorder * 100).toFixed(1)}% inspection chance per crossing. A bribe costs about ${formatMoney(bribeCostPerBorder)} per border ` +
        `and succeeds ${(bribeSuccessBase(state, borderLeg) * 100).toFixed(0)}% of the time.`,
    );
  }
  const encounterChancePerLeg = round2(
    clamp(
      legs.reduce((s, l) => s + l.currentRisk, 0) / Math.max(1, legs.length) * 0.55 *
        (1 + state.player.reputation.heat / 250) *
        state.config.difficultyModifiers.enforcementMultiplier,
      0,
      0.6,
    ),
  );

  const totalCost = round2(costs.reduce((s, c) => s + c.amount, 0));
  const cash = state.player.accounts.reduce((s, a) => s + a.balance, 0);
  if (totalCost > cash) warnings.push(`This journey costs ${formatMoney(totalCost)} — you have ${formatMoney(cash)}.`);
  if (cargoKg > capacityKg) warnings.push(`Cargo ${Math.round(cargoKg)} kg exceeds capacity ${Math.round(capacityKg)} kg — leave goods behind or upgrade logistics.`);
  if (cargoL > capacityL) warnings.push(`Cargo ${Math.round(cargoL)} L exceeds volume ${Math.round(capacityL)} L.`);

  const xp = Math.round(B.progression.xpTravelBase + distanceKm / 90 + borderCrossings * 6);

  /*
   * The success flag and the failure reason are computed from the *same* three
   * predicates. They used to differ by the 0.001 tolerance, which could produce
   * `ok: true` alongside an "over capacity" reason — a plan that both approves the
   * journey and says why it is impossible.
   */
  const overWeight = cargoKg > capacityKg + 0.001;
  const overVolume = cargoL > capacityL + 0.001;
  const unaffordable = totalCost > cash;

  return {
    ...base,
    ok: !overWeight && !overVolume && !unaffordable,
    ...(overWeight
      ? { code: 'over_capacity', reason: `Cargo is ${Math.round(cargoKg - capacityKg)} kg over capacity.`, hint: 'Store goods in a warehouse here, or buy a bigger vehicle.' }
      : overVolume
        ? { code: 'over_volume', reason: `Cargo is ${Math.round(cargoL - capacityL)} L over volume capacity.` }
        : unaffordable
          ? { code: 'insufficient_funds', reason: `The journey costs ${formatMoney(totalCost)}; you have ${formatMoney(cash)}.` }
          : {}),
    legs,
    distanceKm,
    borderCrossings,
    days,
    costs,
    totalCost,
    cashAvailable: cash,
    vehicle: vehicle
      ? { id: vehicle.id, name: vehicle.name, capacityKg: vehicle.capacityKg, fuel: round2(vehicle.fuel), condition: round2(vehicle.condition) }
      : null,
    cargoKg,
    cargoL,
    capacityKg,
    capacityL,
    overCapacityKg: round2(Math.max(0, cargoKg - capacityKg)),
    overCapacityL: round2(Math.max(0, cargoL - capacityL)),
    cargo,
    contrabandValue,
    contrabandUnits,
    detectionChancePerBorder: detectionPerBorder,
    seizureValueAtRisk: contrabandValue,
    encounterChancePerLeg,
    bribeCostPerBorder,
    bribeSuccessChance: borderLeg ? bribeSuccessBase(state, borderLeg) : round2(B.travel.bribeSuccessBase),
    xp,
    warnings,
    routeRisk: round2(path.risk),
  };
}

export interface ModeOption {
  mode: TravelMode;
  label: string;
  days: number;
  cost: number;
  ok: boolean;
  reason?: string;
  requiresVehicle: boolean;
  vehicleName: string | null;
}

/** All modes for a destination, priced — the travel screen's mode picker. */
export function availableModes(state: GameState, toId: ID): ModeOption[] {
  return ALL_MODES.map((mode) => {
    const plan = planTravel(state, toId, mode);
    const vehicle = bestVehicleFor(state, mode);
    return {
      mode,
      label: MODE_LABELS[mode],
      days: plan.days,
      cost: plan.totalCost,
      ok: plan.ok,
      ...(plan.ok ? {} : { reason: plan.reason ?? plan.code }),
      requiresVehicle: MODE_VEHICLE_KINDS[mode] !== undefined,
      vehicleName: vehicle ? vehicle.name : null,
    };
  }).sort((a, b) => a.days - b.days || a.cost - b.cost);
}

export const MODE_LABELS: Record<TravelMode, string> = {
  foot: 'On foot',
  bus: 'Bus / coach',
  car: 'Own car',
  truck: 'Own truck',
  train: 'Rail',
  ferry: 'Ferry',
  air: 'Commercial flight',
  private_jet: 'Private jet',
  cargo_ship: 'Own vessel',
};

function availableCrewForJourney(state: GameState): { id: ID; name: string }[] {
  return state.player.crew
    .filter((e) => e.status === 'active' && !e.injured && e.locationId === state.player.locationId)
    .filter((e) => e.role === 'driver' || e.role === 'pilot' || e.role === 'security' || e.role === 'mercenary')
    .slice(0, 3)
    .map((e) => ({ id: e.id, name: e.name }));
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

export interface SeizureReport {
  commodityId: ID;
  name: string;
  qty: number;
  value: number;
  atBorder: string;
}

export interface EncounterReport {
  legIndex: number;
  between: string;
  table: string;
  combatId: ID;
  victory: boolean;
  summary: string;
}

export interface TravelResult {
  ok: boolean;
  code?: string;
  reason?: string;
  plan: TravelPlan;
  arrived: boolean;
  paused: boolean;
  daysElapsed: number;
  cost: number;
  fromId: ID;
  toId: ID;
  currentLocationId: ID;
  distanceTravelledKm: number;
  seizures: SeizureReport[];
  fines: number;
  encounters: EncounterReport[];
  combat: CombatResult | null;
  vehicleDamage: number;
  breakdown: boolean;
  cargoLostValue: number;
  xp: number;
  heat: number;
  warnings: string[];
}

export interface TravelOptions {
  /** Pre-pay customs bribes at every border on the route. */
  bribeCustoms?: boolean;
  /** Crew to bring along (they travel with you and can fight). */
  crewIds?: ID[];
  vehicleId?: ID;
}

export function executeTravel(state: GameState, rng: Rng, toId: ID, mode: TravelMode, hooks: TravelHooks, opts: TravelOptions = {}): TravelResult {
  const plan = planTravel(state, toId, mode);
  const fromId = state.player.locationId;
  const result: TravelResult = {
    ok: plan.ok,
    ...(plan.ok ? {} : { code: plan.code ?? 'plan_failed', reason: plan.reason ?? 'Travel is not possible right now.' }),
    plan,
    arrived: false,
    paused: false,
    daysElapsed: 0,
    cost: 0,
    fromId,
    toId,
    currentLocationId: fromId,
    distanceTravelledKm: 0,
    seizures: [],
    fines: 0,
    encounters: [],
    combat: null,
    vehicleDamage: 0,
    breakdown: false,
    cargoLostValue: 0,
    xp: 0,
    heat: 0,
    warnings: [...plan.warnings],
  };
  if (!plan.ok) return result;
  if (state.player.travel) {
    result.ok = false;
    result.code = 'journey_in_progress';
    result.reason = 'You are already travelling. Finish or abandon that journey first.';
    return result;
  }

  const vehicle = opts.vehicleId
    ? state.player.vehicles.find((v) => v.id === opts.vehicleId && v.locationId === fromId) ?? bestVehicleFor(state, mode)
    : bestVehicleFor(state, mode);
  const crew = availableCrewForJourney(state).filter((c) => !opts.crewIds || opts.crewIds.includes(c.id));

  let totalCost = plan.totalCost;
  const bribes = plan.borderCrossings > 0 && opts.bribeCustoms ? plan.bribeCostPerBorder * plan.borderCrossings : 0;
  if (bribes > 0) totalCost = round2(totalCost + bribes);

  const payment = debitCash(state, totalCost, {
    kind: 'travel',
    description: `${MODE_LABELS[mode]} ${plan.fromName} → ${plan.toName} (${Math.round(plan.distanceKm).toLocaleString('en-US')} km, ${plan.days} day${plan.days > 1 ? 's' : ''})`,
    allowDirty: false,
    locationId: fromId,
    meta: { mode, distanceKm: plan.distanceKm, days: plan.days, borders: plan.borderCrossings, bribes },
  });
  if (!payment.ok) {
    result.ok = false;
    result.code = 'payment_failed';
    result.reason = payment.reason ?? 'You cannot afford this journey.';
    return result;
  }
  result.cost = totalCost;

  const travel: TravelState = {
    mode,
    fromLocationId: fromId,
    toLocationId: toId,
    routeId: plan.legs[0]?.routeId ?? '',
    departedDay: state.world.day,
    arrivesDay: state.world.day + plan.days,
    cost: totalCost,
    vehicleId: vehicle?.id ?? null,
    crewIds: crew.map((c) => c.id),
    risk: plan.routeRisk,
    encounterPending: false,
  };
  state.player.travel = travel;
  if (vehicle) vehicle.inUseBy = 'player';

  return runJourney(state, rng, travel, plan, vehicle, hooks, bribes > 0, result);
}

/**
 * Advance an in-progress journey. Handles per-day events, border inspections,
 * encounters and arrival. Pauses (returning `paused: true`) when a major
 * encounter needs tactical play.
 */
function runJourney(
  state: GameState,
  rng: Rng,
  travel: TravelState,
  plan: TravelPlan,
  vehicle: VehicleInstance | null,
  hooks: TravelHooks,
  bribed: boolean,
  result: TravelResult,
): TravelResult {
  const startDay = state.world.day;
  const totalDays = plan.days;
  const perLegDays = plan.legs.map((leg) => Math.max(1, Math.round((leg.distanceKm / Math.max(1, plan.distanceKm)) * totalDays)));

  let legIndex = 0;
  let dayInLeg = 0;
  let guard = 0;

  while (guard < 400) {
    guard += 1;
    if (legIndex >= plan.legs.length) break;
    const leg = plan.legs[legIndex]!;

    hooks.advanceDay(state, rng);
    result.daysElapsed += 1;
    result.distanceTravelledKm = round2(result.distanceTravelledKm + leg.distanceKm / Math.max(1, perLegDays[legIndex] ?? 1));
    state.player.stats.totalDistanceTravelledKm = round2(state.player.stats.totalDistanceTravelledKm + leg.distanceKm / Math.max(1, perLegDays[legIndex] ?? 1));

    if (state.player.prison.incarcerated) {
      // Arrested mid-journey: the trip ends here.
      state.player.travel = null;
      result.paused = true;
      result.warnings.push('You were taken into custody during the journey.');
      return result;
    }

    // Vehicle wear and breakdown.
    if (vehicle) {
      const def = vehicleDef(vehicle);
      const dayKm = leg.distanceKm / Math.max(1, perLegDays[legIndex] ?? 1);
      vehicle.odometerKm = round2(vehicle.odometerKm + dayKm);
      const tankRange = TANK_RANGE_KM[def?.kind ?? 'car'] ?? 600;
      vehicle.fuel = round2(clamp(vehicle.fuel - dayKm / tankRange, 0, 1));
      if (vehicle.fuel <= 0.02) {
        const refuel = round2(dayKm * (def?.fuelPerKm ?? 0.08) * 1.18);
        const pay = debitCash(state, refuel, { kind: 'travel', description: 'Roadside refuelling', allowDirty: false });
        if (pay.ok) {
          vehicle.fuel = 0.9;
          result.cost = round2(result.cost + refuel);
          result.warnings.push(`Ran dry and bought fuel at a roadside premium (${formatMoney(refuel)}).`);
        } else {
          vehicle.fuel = 0.05;
        }
      }
      const breakdownChance = B.travel.vehicleDamageChancePerTrip / Math.max(1, totalDays) * (1.6 - vehicle.condition) * (def ? 1.6 - def.reliability : 1);
      if (rng.chance(breakdownChance)) {
        const damage = round2(rng.float(0.04, 0.16));
        vehicle.condition = round2(clamp(vehicle.condition - damage, 0.05, 1));
        vehicle.damage = round2(clamp(vehicle.damage + damage, 0, 1));
        result.vehicleDamage = round2(result.vehicleDamage + damage);
        result.breakdown = true;
        const repair = round2(damage * (def?.price ?? 5000) * 0.08);
        const pay = debitCash(state, repair, { kind: 'travel', description: `Roadside repair: ${vehicle.name}`, allowDirty: false });
        if (pay.ok) {
          result.cost = round2(result.cost + repair);
          vehicle.damage = round2(clamp(vehicle.damage - damage * 0.7, 0, 1));
        }
        result.warnings.push(`${vehicle.name} broke down between ${leg.fromName} and ${leg.toName} — ${formatMoney(repair)} in repairs, condition −${(damage * 100).toFixed(0)}%.`);
      }
    }

    dayInLeg += 1;
    const legDone = dayInLeg >= (perLegDays[legIndex] ?? 1);

    // Border inspection at the end of a crossing leg.
    if (legDone && leg.borderCrossing) {
      const cargo = cargoManifest(state);
      const chance = bribed ? 0.02 : detectionChance(state, leg, cargo, vehicle);
      if (bribed) {
        if (!rng.chance(plan.bribeSuccessChance)) {
          result.warnings.push(`The bribe at the ${leg.toCountry} border was refused — they searched anyway.`);
          inspectCargo(state, rng, leg, vehicle, result, 1);
        } else {
          result.warnings.push(`Bribed the ${leg.toCountry} border (${formatMoney(plan.bribeCostPerBorder)}) — waved through.`);
          addHeat(state, 1.2, 'Border bribery');
          bumpCounter(state, 'borders_bribed');
        }
      } else if (rng.chance(chance)) {
        inspectCargo(state, rng, leg, vehicle, result, chance);
      } else {
        pushDiagnostic(state, { system: 'travel', level: 'debug', message: `Cleared customs at ${leg.toCountry} (${(chance * 100).toFixed(1)}% detection)` });
      }
    }

    // Encounters.
    if (rng.chance(plan.encounterChancePerLeg / Math.max(1, perLegDays[legIndex] ?? 1))) {
      const encounter = spawnTravelEncounter(state, rng, leg, plan.mode);
      if (encounter) {
        result.encounters.push({
          legIndex,
          between: `${leg.fromName} → ${leg.toName}`,
          table: encounter.combat.enemyGroupId,
          combatId: encounter.combat.id,
          victory: encounter.outcome?.victory ?? false,
          summary: encounter.outcome?.summary ?? 'Engagement in progress.',
        });
        result.combat = encounter;
        if (encounter.outcome?.arrested) {
          state.player.travel = null;
          result.paused = true;
          return result;
        }
        if (!encounter.finished) {
          // Tactical fight: pause the journey until the player resolves it.
          travel.encounterPending = true;
          result.paused = true;
          result.warnings.push(`Ambushed between ${leg.fromName} and ${leg.toName} — the journey is on hold until the fight is over.`);
          return result;
        }
        if (encounter.outcome && !encounter.outcome.victory && !encounter.outcome.fled) {
          // Lost the fight: cargo partially gone, journey continues if you can.
          travel.encounterPending = false;
        } else {
          travel.encounterPending = false;
        }
      }
    }

    if (legDone) {
      legIndex += 1;
      dayInLeg = 0;
    }
    if (state.world.day >= travel.arrivesDay) break;
  }

  return arrive(state, rng, travel, plan, vehicle, result, startDay);
}

function inspectCargo(state: GameState, rng: Rng, leg: TravelPlanLeg, vehicle: VehicleInstance | null, result: TravelResult, chance: number): void {
  const cargo = cargoManifest(state).filter((c) => c.illegal);
  const loc = worldReg.location(leg.toId);
  const heat = round2((6 + chance * 22 + cargo.reduce((s, c) => s + c.qty * 0.05, 0)) * state.config.difficultyModifiers.enforcementMultiplier);
  addHeat(state, heat, `Customs inspection at the ${leg.toCountry} border`);
  result.heat = round2(result.heat + heat);
  changeReputation(state, 'legal', -2.5, 'Caught carrying contraband at a border');
  changeReputation(state, 'criminal', 1.5, 'Ran contraband through a border');
  bumpCounter(state, 'borders_searched');

  if (cargo.length === 0) {
    // Paperwork problem, not a cargo problem: a fine only.
    const fine = round2(Math.max(80, 0.02 * state.player.accounts.reduce((s, a) => s + a.balance, 0)));
    const pay = debitCash(state, fine, { kind: 'fine', description: `Customs fine at ${leg.toCountry} border`, allowDirty: true });
    if (pay.ok) {
      result.fines = round2(result.fines + fine);
      result.warnings.push(`Searched at the ${leg.toCountry} border. Paperwork fine: ${formatMoney(fine)}.`);
    }
    return;
  }

  // Seizure.
  let seizedValue = 0;
  for (const line of cargo) {
    const fraction = line.concealed ? clamp(B.travel.seizureFractionOnCaught * (1 - (vehicle?.stealth ?? 0) * 0.4), 0.2, 1) : B.travel.seizureFractionOnCaught;
    const qty = Math.max(1, Math.floor(line.qty * fraction));
    const removed = removeCarried(state, line.commodityId, qty);
    if (removed <= 0) continue;
    seizedValue += removed * (registry.get(line.commodityId)?.baseValue ?? 0);
    result.seizures.push({ commodityId: line.commodityId, name: line.name, qty: removed, value: round2(removed * (registry.get(line.commodityId)?.baseValue ?? 0)), atBorder: leg.toCountry });
  }
  result.cargoLostValue = round2(result.cargoLostValue + seizedValue);
  bumpCounter(state, 'smuggled_caught');
  setCounterSafe(state, 'seized_value', counter(state, 'seized_value') + seizedValue);

  const fine = round2(Math.max(250, seizedValue * 0.4));
  const pay = debitCash(state, fine, { kind: 'fine', description: `Customs seizure fine at ${leg.toCountry} border`, allowDirty: true });
  if (pay.ok) result.fines = round2(result.fines + fine);

  pushNotification(state, {
    kind: 'danger',
    title: 'Cargo seized at the border',
    body: `${leg.toCountry} customs found ${result.seizures.map((s) => `${s.qty} × ${s.name}`).join(', ')}. Fine ${formatMoney(fine)}, heat +${heat}.`,
    link: '/game/logistics',
    metrics: [
      { label: 'Seized value', value: formatMoney(seizedValue) },
      { label: 'Fine', value: formatMoney(fine) },
      { label: 'Detection chance was', value: `${(chance * 100).toFixed(1)}%` },
    ],
  });

  // Serious contraband escalates to detention.
  if (seizedValue > 20_000 || chance > 0.6) {
    const combat = startCombat(state, rng, {
      kind: 'police',
      table: 'customs',
      enemyCount: [1, 3],
      stakes: 'medium',
      reason: `Customs officers at the ${leg.toCountry} border move to detain you.`,
      locationId: leg.toId,
      seedLabel: `customs:${leg.routeId}`,
    });
    result.combat = combat;
    if (combat.outcome?.arrested) result.warnings.push('You were detained at the border.');
    void loc;
  }
}

/** Remove goods from carried (personal/vehicle) storage only. */
function removeCarried(state: GameState, commodityId: ID, qty: number): number {
  const before = quantityOnHand(state, commodityId);
  const personalIds = new Set(state.player.storages.filter((s) => s.kind === 'personal' || s.vehicleId !== null).map((s) => s.id));
  let remaining = qty;
  for (const stack of state.player.inventory.filter((s) => s.commodityId === commodityId && personalIds.has(s.storageId))) {
    if (remaining <= 0) break;
    const take = Math.min(stack.qty, remaining);
    stack.qty -= take;
    remaining -= take;
  }
  state.player.inventory = state.player.inventory.filter((s) => s.qty > 0);
  return Math.max(0, before - quantityOnHand(state, commodityId));
}

function setCounterSafe(state: GameState, key: string, value: number): void {
  state.player.stats.counters[key] = Number.isFinite(value) ? value : 0;
}

function spawnTravelEncounter(state: GameState, rng: Rng, leg: TravelPlanLeg, mode: TravelMode): CombatResult | null {
  const sea = mode === 'cargo_ship' || mode === 'ferry';
  const to = worldReg.location(leg.toId);
  const warzone = (to?.risk ?? 0) > 0.62;
  const heat = state.player.reputation.heat;
  let table = 'rival_territory';
  let kind: ActiveCombat['kind'] = 'ambush';
  let stakes: 'low' | 'medium' | 'high' = 'medium';
  if (sea) {
    table = 'piracy';
    kind = 'ambush';
    stakes = 'high';
  } else if (warzone) {
    table = 'warzone';
    kind = 'faction_war';
    stakes = 'high';
  } else if (heat > 55) {
    table = 'police_stop';
    kind = 'police';
    stakes = 'medium';
  } else if (heat > 85) {
    table = 'raid';
    kind = 'pursuit';
    stakes = 'high';
  }
  const count: [number, number] = stakes === 'high' ? [2, 4] : stakes === 'medium' ? [1, 3] : [1, 2];
  return startCombat(state, rng, {
    kind,
    table,
    enemyCount: count,
    stakes,
    reason:
      table === 'piracy'
        ? `A fast boat closes on you between ${leg.fromName} and ${leg.toName}.`
        : table === 'warzone'
          ? `Armed men flag you down on the ${leg.fromName}–${leg.toName} road.`
          : table === 'police_stop'
            ? `A highway patrol unit pulls you over near ${leg.toName}.`
            : `You are ambushed between ${leg.fromName} and ${leg.toName}.`,
    locationId: leg.toId,
    seedLabel: `travel:${leg.routeId}`,
  });
}

function arrive(
  state: GameState,
  rng: Rng,
  travel: TravelState,
  plan: TravelPlan,
  vehicle: VehicleInstance | null,
  result: TravelResult,
  startDay: number,
): TravelResult {
  const dest = travel.toLocationId;
  const loc = worldReg.requireLocation(dest);
  state.player.locationId = dest;
  const locState = state.world.locations[dest];
  if (locState) {
    locState.discovered = true;
    locState.lastVisitedDay = state.world.day;
  }
  if (vehicle) {
    vehicle.locationId = dest;
    vehicle.inUseBy = 'idle';
  }
  for (const crewId of travel.crewIds) {
    const emp = state.player.crew.find((e) => e.id === crewId);
    if (emp) emp.locationId = dest;
  }
  // Warehouses and fixed storage stay behind; personal storage travels with you.
  state.player.travel = null;

  const daysElapsed = Math.max(1, state.world.day - startDay);
  const xp = grantXp(state, plan.xp + daysElapsed * 2, `Travelled ${Math.round(plan.distanceKm).toLocaleString('en-US')} km to ${loc.name}`).granted;
  result.xp = xp;
  result.arrived = true;
  result.paused = false;
  result.currentLocationId = dest;
  result.toId = dest;

  const visitedKey = `visited:${dest}`;
  if (counter(state, visitedKey) === 0) {
    setCounterSafe(state, visitedKey, 1);
    bumpCounter(state, 'locations_visited');
    state.player.progression.milestones.push(`visited:${dest}`);
    changeReputation(state, 'global', 0.6, `Reached ${loc.name} for the first time`);
  }
  bumpCounter(state, 'journeys');
  setCounterSafe(state, 'distance_travelled', counter(state, 'distance_travelled') + plan.distanceKm);
  state.player.stats.daysSurvived += daysElapsed;
  recordObjective(state, 'travel_to', { locationId: dest, qty: 1, days: daysElapsed });

  /*
   * Price the city you just walked into.
   *
   * Markets are materialised lazily, and the starting city (plus its neighbours) is
   * priced at bootstrap — but arrival at a *new* city used to price nothing, so the
   * market screen after a journey showed a roster of goods at ¤0.00 that the rows
   * still described as tradable. The prices were not missing because the goods
   * could not be traded; they were missing because nobody had asked the location to
   * open a book yet. Arrival is the state transition where that becomes true, so it
   * happens here, once, rather than being recomputed by every reader.
   */
  materialiseLocation(state, dest, { includeHidden: state.player.underground.accessUnlocked });

  pushNotification(state, {
    kind: 'success',
    title: `Arrived in ${loc.name}`,
    body: `${plan.distanceKm.toLocaleString('en-US')} km by ${MODE_LABELS[plan.mode]} in ${daysElapsed} day(s), ${plan.borderCrossings} border crossing(s). Cost ${formatMoney(result.cost)}${result.seizures.length > 0 ? `, ${result.seizures.length} seizure(s)` : ''}.`,
    link: '/game/world',
    metrics: [
      { label: 'Cost', value: formatMoney(result.cost) },
      { label: 'Days', value: String(daysElapsed) },
      { label: 'Distance', value: `${Math.round(plan.distanceKm).toLocaleString('en-US')} km` },
      { label: 'XP', value: String(xp) },
      ...(result.fines > 0 ? [{ label: 'Fines', value: formatMoney(result.fines) }] : []),
      ...(result.cargoLostValue > 0 ? [{ label: 'Cargo lost', value: formatMoney(result.cargoLostValue) }] : []),
    ],
  });

  pushDiagnostic(state, {
    system: 'travel',
    level: 'info',
    message: `Arrived ${plan.fromName} → ${loc.name} (${plan.mode}, ${Math.round(plan.distanceKm)} km, ${daysElapsed}d, cost ${result.cost}, seizures ${result.seizures.length}, encounters ${result.encounters.length})`,
    data: { days: daysElapsed, cost: result.cost, seizures: result.seizures.length, encounters: result.encounters.length, distanceKm: plan.distanceKm },
  });
  void rng;
  return result;
}

/**
 * Resume a journey paused by a tactical encounter (or any other interruption).
 * Called by the action layer once the player is free again.
 */
export function resumeTravel(state: GameState, rng: Rng, hooks: TravelHooks): TravelResult | null {
  const travel = state.player.travel;
  if (!travel) return null;
  if (state.player.combat && state.player.combat.phase === 'active') return null;
  if (state.player.prison.incarcerated) return null;

  const fromHere = state.player.locationId;
  const remaining = planTravel(state, travel.toLocationId, travel.mode);
  const vehicle = travel.vehicleId ? state.player.vehicles.find((v) => v.id === travel.vehicleId) ?? null : null;

  const result: TravelResult = {
    ok: true,
    plan: remaining,
    arrived: false,
    paused: false,
    daysElapsed: 0,
    cost: 0,
    fromId: fromHere,
    toId: travel.toLocationId,
    currentLocationId: fromHere,
    distanceTravelledKm: 0,
    seizures: [],
    fines: 0,
    encounters: [],
    combat: null,
    vehicleDamage: 0,
    breakdown: false,
    cargoLostValue: 0,
    xp: 0,
    heat: 0,
    warnings: [...remaining.warnings],
  };
  travel.encounterPending = false;
  const daysLeft = Math.max(1, travel.arrivesDay - state.world.day);
  const resumed: TravelPlan = { ...remaining, days: daysLeft };
  return runJourney(state, rng, travel, resumed, vehicle, hooks, false, result);
}

/** Give up a journey in progress (you stay where you are; the fare is spent). */
export function abandonTravel(state: GameState): { ok: boolean; reason?: string; refund: number } {
  const travel = state.player.travel;
  if (!travel) return { ok: false, reason: 'You are not travelling.', refund: 0 };
  const elapsed = Math.max(0, state.world.day - travel.departedDay);
  const total = Math.max(1, travel.arrivesDay - travel.departedDay);
  const refund = round2(travel.cost * clamp((total - elapsed) / total, 0, 1) * 0.4);
  if (refund > 0) creditCash(state, refund, { kind: 'travel', description: 'Partial refund on an abandoned journey', dirty: false });
  if (travel.vehicleId) {
    const vehicle = state.player.vehicles.find((v) => v.id === travel.vehicleId);
    if (vehicle) vehicle.inUseBy = 'idle';
  }
  state.player.travel = null;
  pushNotification(state, {
    kind: 'warning',
    title: 'Journey abandoned',
    body: `You stopped en route${refund > 0 ? ` and recovered ${formatMoney(refund)}` : ''}. You are still in ${worldReg.requireLocation(state.player.locationId).name}.`,
    link: '/game/world',
  });
  return { ok: true, refund };
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface JourneyView {
  inProgress: boolean;
  mode: TravelMode;
  modeLabel: string;
  from: string;
  to: string;
  departedDay: number;
  arrivesDay: number;
  daysRemaining: number;
  progress: number;
  cost: number;
  vehicle: string | null;
  crew: string[];
  risk: number;
  encounterPending: boolean;
}

export function journeyView(state: GameState): JourneyView | null {
  const travel = state.player.travel;
  if (!travel) return null;
  const total = Math.max(1, travel.arrivesDay - travel.departedDay);
  const elapsed = clamp(state.world.day - travel.departedDay, 0, total);
  return {
    inProgress: true,
    mode: travel.mode,
    modeLabel: MODE_LABELS[travel.mode],
    from: worldReg.location(travel.fromLocationId)?.name ?? travel.fromLocationId,
    to: worldReg.location(travel.toLocationId)?.name ?? travel.toLocationId,
    departedDay: travel.departedDay,
    arrivesDay: travel.arrivesDay,
    daysRemaining: Math.max(0, travel.arrivesDay - state.world.day),
    progress: round2(elapsed / total),
    cost: travel.cost,
    vehicle: travel.vehicleId ? state.player.vehicles.find((v) => v.id === travel.vehicleId)?.name ?? 'vehicle' : null,
    crew: travel.crewIds.map((id) => state.player.crew.find((e) => e.id === id)?.name ?? id),
    risk: travel.risk,
    encounterPending: travel.encounterPending,
  };
}

/** Every known location with route feasibility from where the player stands. */
export function destinationList(state: GameState, opts: { mode?: TravelMode; search?: string; limit?: number } = {}): {
  locationId: ID;
  name: string;
  country: string;
  region: string;
  kind: string;
  distanceKm: number;
  days: number;
  cost: number;
  risk: number;
  borders: number;
  reachable: boolean;
  reason?: string;
  discovered: boolean;
  traded: number;
  lockdown: boolean;
}[] {
  const mode = opts.mode ?? 'bus';
  const search = (opts.search ?? '').trim().toLowerCase();
  const from = state.player.locationId;
  const out = worldReg.locations
    .filter((l) => l.id !== from)
    .filter((l) => (search ? l.name.toLowerCase().includes(search) || l.countryName.toLowerCase().includes(search) || l.regionName.toLowerCase().includes(search) : true))
    .map((l) => {
      const discovered = !l.hidden || (state.world.locations[l.id]?.discovered ?? false);
      const path = worldReg.findPath(from, l.id, { mode });
      const plan = discovered ? planTravel(state, l.id, mode) : null;
      return {
        locationId: l.id,
        name: l.name,
        country: l.countryName,
        region: l.regionName,
        kind: l.kind,
        distanceKm: Math.round(path?.distanceKm ?? plan?.distanceKm ?? 0),
        days: plan?.days ?? Math.max(1, Math.ceil((path?.distanceKm ?? 0) / Math.max(1, B.travel.speedKmPerDay[mode] ?? 400))),
        cost: plan?.totalCost ?? 0,
        risk: round2(path?.risk ?? 0),
        borders: path?.borderCrossings ?? 0,
        reachable: discovered && (plan?.ok ?? false),
        ...(plan && !plan.ok ? { reason: plan.reason ?? plan.code } : discovered ? {} : { reason: 'Not yet discovered' }),
        discovered,
        traded: l.tradedCommodityIds.length,
        lockdown: state.world.locations[l.id]?.lockdown ?? false,
      };
    })
    .sort((a, b) => Number(b.reachable) - Number(a.reachable) || a.distanceKm - b.distanceKm);
  return opts.limit ? out.slice(0, opts.limit) : out;
}

export function refuelVehicle(state: GameState, vehicleId: ID): { ok: boolean; reason?: string; cost?: number; fuel?: number } {
  const vehicle = state.player.vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) return { ok: false, reason: 'Vehicle not found.' };
  if (vehicle.locationId !== state.player.locationId) return { ok: false, reason: 'That vehicle is not here.' };
  const def = vehicleDef(vehicle);
  if (!def || def.fuelPerKm <= 0) return { ok: false, reason: `${vehicle.name} needs no fuel.` };
  const tankRange = TANK_RANGE_KM[def.kind] ?? 600;
  const needed = (1 - vehicle.fuel) * tankRange;
  const cost = round2(needed * def.fuelPerKm);
  if (cost <= 0) return { ok: false, reason: 'Tank is already full.' };
  const pay = debitCash(state, cost, { kind: 'travel', description: `Refuelled ${vehicle.name}`, allowDirty: false, meta: { litres: needed } });
  if (!pay.ok) return { ok: false, reason: pay.reason ?? 'Cannot afford fuel.' };
  vehicle.fuel = 1;
  return { ok: true, cost, fuel: 1 };
}

export function repairVehicle(state: GameState, vehicleId: ID): { ok: boolean; reason?: string; cost?: number; condition?: number } {
  const vehicle = state.player.vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) return { ok: false, reason: 'Vehicle not found.' };
  if (vehicle.locationId !== state.player.locationId) return { ok: false, reason: 'That vehicle is not here.' };
  const def = vehicleDef(vehicle);
  const missing = 1 - vehicle.condition;
  if (missing <= 0.01) return { ok: false, reason: `${vehicle.name} is already in good condition.` };
  const cost = round2(missing * (def?.price ?? 5000) * 0.14);
  const pay = debitCash(state, cost, { kind: 'travel', description: `Repairs: ${vehicle.name}`, allowDirty: false });
  if (!pay.ok) return { ok: false, reason: pay.reason ?? 'Cannot afford repairs.' };
  vehicle.condition = 1;
  vehicle.damage = 0;
  return { ok: true, cost, condition: 1 };
}

export function vehicleSummary(state: GameState): {
  id: ID;
  name: string;
  kind: string;
  here: boolean;
  condition: number;
  damage: number;
  fuel: number;
  rangeKm: number;
  capacityKg: number;
  capacityL: number;
  hiddenCompartmentKg: number;
  speedKmPerDay: number;
  odometerKm: number;
  inUseBy: VehicleInstance['inUseBy'];
  upgrades: ID[];
  maintenanceDueDay: number;
  valueEstimate: number;
}[] {
  return state.player.vehicles.map((v) => {
    const def = vehicleDef(v);
    return {
      id: v.id,
      name: v.name,
      kind: def?.kind ?? 'car',
      here: v.locationId === state.player.locationId,
      condition: v.condition,
      damage: v.damage,
      fuel: v.fuel,
      rangeKm: Math.round(v.fuel * (TANK_RANGE_KM[def?.kind ?? 'car'] ?? 600)),
      capacityKg: v.capacityKg,
      capacityL: v.capacityL,
      hiddenCompartmentKg: v.hiddenCompartmentKg,
      speedKmPerDay: v.speedKmPerDay,
      odometerKm: v.odometerKm,
      inUseBy: v.inUseBy,
      upgrades: [...v.upgrades],
      maintenanceDueDay: v.maintenanceDueDay,
      valueEstimate: round2((def?.price ?? v.purchasePrice) * (0.55 + v.condition * 0.45)),
    };
  });
}

export function contrabandExposure(state: GameState): { units: number; value: number; riskiest: { name: string; qty: number; risk: number }[] } {
  const cargo = cargoManifest(state).filter((c) => c.illegal);
  const riskiest = cargo
    .map((c) => ({ name: c.name, qty: c.qty, risk: registry.get(c.commodityId)?.risk ?? 0.4 }))
    .sort((a, b) => b.risk * b.qty - a.risk * a.qty)
    .slice(0, 6);
  return {
    units: cargo.reduce((s, c) => s + c.qty, 0),
    value: round2(cargo.reduce((s, c) => s + c.value, 0)),
    riskiest,
  };
}

export function concealCargo(state: GameState, commodityId: ID, qty: number): { ok: boolean; reason?: string; concealed?: number } {
  const c: CommodityDef | undefined = registry.get(commodityId);
  if (!c) return { ok: false, reason: 'Unknown commodity.' };
  const personalIds = new Set(state.player.storages.filter((s) => s.kind === 'personal' || s.vehicleId !== null).map((s) => s.id));
  const hiddenKg = state.player.storages.filter((s) => personalIds.has(s.id)).reduce((sum, s) => sum + s.hiddenCompartmentKg, 0);
  const alreadyHiddenKg = state.player.inventory
    .filter((s) => s.concealed && personalIds.has(s.storageId))
    .reduce((sum, s) => sum + (registry.get(s.commodityId)?.weightKg ?? 0) * s.qty, 0);
  const freeKg = hiddenKg - alreadyHiddenKg;
  let concealed = 0;
  let remaining = qty;
  for (const stack of state.player.inventory.filter((s) => s.commodityId === commodityId && personalIds.has(s.storageId) && !s.concealed)) {
    if (remaining <= 0) break;
    const kgPerUnit = c.weightKg;
    const fits = kgPerUnit > 0 ? Math.floor(freeKg / kgPerUnit) - concealed : remaining;
    const take = Math.min(stack.qty, remaining, Math.max(0, fits));
    if (take <= 0) break;
    stack.concealed = true;
    concealed += take;
    remaining -= take;
  }
  if (concealed === 0) {
    return {
      ok: false,
      reason: freeKg <= 0 ? 'No free hidden-compartment capacity. Upgrade a vehicle or buy concealment gear.' : 'Nothing left to conceal.',
    };
  }
  changeReputation(state, 'criminal', 0.2, 'Concealed cargo');
  return { ok: true, concealed };
}
