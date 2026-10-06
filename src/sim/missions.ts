/**
 * Missions — the contract/job system.
 *
 * Mission *definitions* are data (`engine/registry/missions.ts`). This module
 * instantiates them into concrete objectives with the seeded RNG (so the same
 * save always sees the same job board), tracks progress from real engine
 * outcomes, and pays out rewards computed server-side.
 *
 * Progress is never accepted from the client: every objective advances only
 * because another system (trading, travel, production, crew, finance, combat)
 * reported a real result through `recordObjective`.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { MISSIONS, MISSION_BY_ID, type MissionDef, type ObjectiveTemplate } from '../engine/registry/missions';
import { EMPLOYEE_ROLES } from '../engine/registry/people';
import { FACTIONS } from '../engine/registry/actors';
import { PROPERTIES } from '../engine/registry/assets';
import { getWorldRegistry } from '../engine/registry/world';
import { evaluateConditions, firstFailure, makeContext } from './conditions';
import { counter, setCounter, bumpCounter } from './progression';
import { changeReputation } from './reputation';
import { creditCash, computeNetWorth, newId, pushNotification, round2 } from './state';
import type { ReputationDimension } from './types';
import type { GameState, ID, LocationDef, MissionObjective, MissionState } from './types';

const B = getBalance();
const world = getWorldRegistry();
const commodities = getCommodityRegistry();

/* ------------------------------------------------------------------ */
/* Objective plumbing                                                  */
/* ------------------------------------------------------------------ */

export type ObjectiveKind = MissionObjective['kind'];

/** Everything another system reports when it does something objective-relevant. */
export interface ObjectivePayload {
  commodityId?: ID;
  locationId?: ID;
  roleId?: ID;
  propertyId?: ID;
  factionId?: ID;
  qty?: number;
  amount?: number;
  margin?: number;
  won?: boolean;
  days?: number;
}

function objectiveKey(missionId: ID, objectiveId: ID): string {
  return `mission:${missionId}:${objectiveId}`;
}

/**
 * Commodity implied by a mission: the target of its first acquisition or
 * production objective. `deliver_commodity` and `sell_commodity` objectives are
 * authored without a commodity because it is always "the thing you just bought".
 */
function impliedCommodity(mission: MissionState): ID | null {
  for (const o of mission.objectives) {
    if ((o.kind === 'buy_commodity' || o.kind === 'produce_commodity') && o.targetId) return o.targetId;
  }
  return null;
}

function commodityName(id: ID | null): string {
  if (!id) return 'the goods';
  return commodities.get(id)?.name ?? id;
}

function locationName(id: ID | null): string {
  if (!id) return 'the destination';
  return world.location(id)?.name ?? id;
}

function roleName(id: ID | null): string {
  if (!id) return 'the hire';
  return EMPLOYEE_ROLES.find((r) => r.id === id)?.name ?? id;
}

function propertyName(id: ID | null): string {
  if (!id) return 'the property';
  return PROPERTIES.find((p) => p.id === id)?.name ?? id;
}

function factionName(id: ID | null): string {
  if (!id) return 'the faction';
  return FACTIONS.find((f) => f.id === id)?.name ?? id;
}

function formatTarget(kind: ObjectiveKind, targetId: ID | null): string {
  switch (kind) {
    case 'deliver_commodity':
    case 'travel_to':
      return locationName(targetId);
    case 'buy_commodity':
    case 'sell_commodity':
    case 'produce_commodity':
      return commodityName(targetId);
    case 'hire_role':
      return roleName(targetId);
    case 'own_property':
      return propertyName(targetId);
    case 'reach_faction_standing':
      return factionName(targetId);
    default:
      return targetId ? String(targetId) : 'the target';
  }
}

function instantiateDescription(template: ObjectiveTemplate, kind: ObjectiveKind, amount: number, targetId: ID | null): string {
  return template.description
    .replace(/\{amount\}/g, amount.toLocaleString('en-US'))
    .replace(/\{target\}/g, formatTarget(kind, targetId));
}

/* ------------------------------------------------------------------ */
/* Target resolution                                                   */
/* ------------------------------------------------------------------ */

function distanceBetween(a: LocationDef, b: LocationDef): number {
  return world.findPath(a.id, b.id)?.distanceKm ?? Number.POSITIVE_INFINITY;
}

function resolveTarget(state: GameState, rng: Rng, template: ObjectiveTemplate): { targetId: ID | null; label: string } {
  const t = template.target;
  switch (t.kind) {
    case 'none':
      return { targetId: null, label: 'the target' };

    case 'fixed': {
      if (t.id === 'player_location') return { targetId: state.player.locationId, label: locationName(state.player.locationId) };
      return { targetId: t.id, label: t.id };
    }

    case 'random_commodity': {
      const filter = t.filter;
      const legalities = new Set(filter?.legality ?? []);
      const categories = new Set(filter?.category ?? []);
      const candidates = commodities
        .all()
        .filter((c) => (legalities.size === 0 ? true : legalities.has(c.legality)))
        .filter((c) => (categories.size === 0 ? true : categories.has(c.category)))
        .filter((c) => (filter?.minBaseValue !== undefined ? c.baseValue >= filter.minBaseValue : true))
        .filter((c) => (filter?.maxBaseValue !== undefined ? c.baseValue <= filter.maxBaseValue : true))
        .filter((c) => c.rarity <= 4);
      const pool = candidates.length > 0 ? candidates : commodities.all().filter((c) => c.rarity <= 2);
      const pick = rng.pick(pool);
      return { targetId: pick?.id ?? null, label: pick ? pick.name : 'the goods' };
    }

    case 'random_location': {
      const filter = t.filter;
      const kinds = new Set(filter?.kinds ?? []);
      const here = world.location(state.player.locationId);
      const candidates = world.locations
        .filter((l) => !l.hidden || filter?.hidden === true)
        .filter((l) => (kinds.size === 0 ? true : kinds.has(l.kind)))
        .filter((l) => (filter?.maxRisk !== undefined ? l.risk <= filter.maxRisk : true))
        .filter((l) => (filter?.minDistanceKm !== undefined && here ? distanceBetween(here, l) >= filter.minDistanceKm : true))
        .filter((l) => l.id !== state.player.locationId);
      const pool = candidates.length > 0 ? candidates : world.locations.filter((l) => l.id !== state.player.locationId);
      const pick = rng.pick(pool);
      return { targetId: pick?.id ?? null, label: pick ? pick.name : 'the destination' };
    }

    case 'random_role': {
      const pick = rng.pick(EMPLOYEE_ROLES);
      return { targetId: pick?.id ?? null, label: pick ? pick.name : 'the hire' };
    }

    case 'random_property': {
      const affordable = PROPERTIES.filter((p) => p.basePrice <= Math.max(250_000, computeNetWorth(state).total * 1.6));
      const pool = affordable.length > 0 ? affordable : PROPERTIES;
      const pick = rng.pick(pool);
      return { targetId: pick?.id ?? null, label: pick ? pick.name : 'the property' };
    }

    case 'random_faction': {
      const near = FACTIONS.filter(
        (f) => f.kind === 'criminal_syndicate' || f.kind === 'cartel' || f.kind === 'corporation' || f.kind === 'government' || f.kind === 'guild',
      );
      const pool = near.length > 0 ? near : FACTIONS;
      const pick = rng.pick(pool);
      return { targetId: pick?.id ?? null, label: pick ? pick.name : 'the faction' };
    }

    default:
      return { targetId: null, label: 'the target' };
  }
}

function resolveAmount(state: GameState, rng: Rng, template: ObjectiveTemplate, def: MissionDef): number {
  const base = Array.isArray(template.amount) ? rng.int(template.amount[0], template.amount[1]) : template.amount;
  const scale = template.amountScalePerDifficulty ?? 0;
  const levelStretch = Math.max(0, state.player.progression.level - def.minLevel);
  return Math.max(1, Math.round(base * (1 + scale * levelStretch * 0.12)));
}

/* ------------------------------------------------------------------ */
/* Instantiation                                                       */
/* ------------------------------------------------------------------ */

export function instantiateMission(state: GameState, rng: Rng, def: MissionDef): MissionState {
  const variance = B.missions.rewardVariance;
  const levelStretch = Math.max(0, state.player.progression.level - def.minLevel);
  const rewardCash = Math.round(def.rewardCash * rng.float(1 - variance, 1 + variance) * (1 + levelStretch * 0.07));
  const rewardXp = Math.round(def.rewardXp * rng.float(1 - variance, 1 + variance) * (1 + levelStretch * 0.05));
  const [lo, hi] = def.deadlineDays;
  const deadlineDays = Math.max(B.missions.deadlineDaysRange[0], Math.min(rng.int(lo, hi), B.missions.deadlineDaysRange[1] + def.difficulty * 4));
  const missionId = newId(rng, 'mis');

  const objectives: MissionObjective[] = def.objectives.map((template) => {
    const resolved = resolveTarget(state, rng, template);
    const amount = resolveAmount(state, rng, template, def);
    const id = newId(rng, 'obj');
    return {
      id,
      description: instantiateDescription(template, template.kind, amount, resolved.targetId),
      kind: template.kind,
      targetId: resolved.targetId,
      requiredAmount: amount,
      currentAmount: 0,
      completed: false,
    };
  });

  // `deliver_commodity` / `sell_commodity` are authored with `none` targets for
  // the commodity: they inherit the acquisition objective's commodity.
  const implied = objectives.find((o) => o.kind === 'buy_commodity' || o.kind === 'produce_commodity')?.targetId ?? null;
  for (const o of objectives) {
    if ((o.kind === 'sell_commodity' || o.kind === 'deliver_commodity') && o.targetId === null && implied !== null) {
      // Keep the location target when the objective had one; otherwise bind the
      // commodity so progress tracking is unambiguous.
      if (o.kind === 'sell_commodity') o.targetId = implied;
    }
  }

  return {
    id: missionId,
    defId: def.id,
    title: def.title,
    description: def.description,
    giverName: def.giverName,
    giverFactionId: def.giverFactionId,
    acceptedDay: state.world.day,
    deadlineDay: state.world.day + deadlineDays,
    objectives,
    rewardCash,
    rewardXp,
    rewardReputation: def.reputation.map((r) => ({ ...r, amount: Math.round(r.amount * B.missions.reputationRewardMultiplier * 10) / 10 })),
    rewardItems: [],
    risk: def.risk,
    status: 'available',
    chainId: null,
    completedDay: null,
  };
}

/* ------------------------------------------------------------------ */
/* Job board                                                           */
/* ------------------------------------------------------------------ */

export interface BoardRollResult {
  offered: ID[];
  rejected: { defId: ID; reason: string }[];
}

function eligibleMissions(state: GameState, rng: Rng): { def: MissionDef; reason: string | null }[] {
  const ctx = makeContext(state, { rng });
  return MISSIONS.map((def) => {
    if (def.minLevel > state.player.progression.level) {
      return { def, reason: `Requires level ${def.minLevel}` };
    }
    if (state.player.missions.some((m) => m.defId === def.id && m.status === 'active')) {
      return { def, reason: 'Already contracted' };
    }
    if (!evaluateConditions(ctx, def.conditions)) {
      return { def, reason: firstFailure(state, def.conditions) ?? 'Requirements not met' };
    }
    return { def, reason: null };
  });
}

/**
 * Roll a fresh job board. Offers persist until the next refresh so the player is
 * not punished for reading the board slowly, and previously completed missions
 * are excluded unless they are explicitly repeatable.
 */
export function rollMissionOffers(state: GameState, rng: Rng): BoardRollResult {
  const eligible = eligibleMissions(state, rng).filter((e) => e.reason === null);
  const completed = new Set(state.player.missions.filter((m) => m.status === 'completed').map((m) => m.defId));
  const fresh = eligible.filter((e) => !completed.has(e.def.id));
  const pool = fresh.length >= 3 ? fresh : eligible;

  // Weight toward missions that match the player's stage: difficulty close to
  // level/8, with unlocked chains preferred.
  const stage = state.player.progression.level / 8;
  const weights = pool.map((e) => 1 / (1 + Math.abs(e.def.difficulty - stage) * 0.9) + (e.def.unlocks.length > 0 ? 0.15 : 0));
  const chosen: MissionDef[] = [];
  const available = pool.map((e, i) => ({ e, w: weights[i]! }));
  const slots = Math.min(B.missions.maxActiveMissions + 2, available.length);
  for (let i = 0; i < slots; i += 1) {
    if (available.length === 0) break;
    const total = available.reduce((s, a) => s + a.w, 0);
    let roll = rng.float(0, 1) * total;
    let index = available.length - 1;
    for (let j = 0; j < available.length; j += 1) {
      roll -= available[j]!.w;
      if (roll <= 0) {
        index = j;
        break;
      }
    }
    chosen.push(available[index]!.e.def);
    available.splice(index, 1);
  }

  state.player.missionOffers = chosen.map((def) => instantiateMission(state, rng, def));
  state.player.missionRefreshDay = state.world.day;
  return {
    offered: state.player.missionOffers.map((m) => m.defId),
    rejected: eligibleMissions(state, rng)
      .filter((e) => e.reason !== null)
      .slice(0, 24)
      .map((e) => ({ defId: e.def.id, reason: e.reason! })),
  };
}

export function maybeRefreshOffers(state: GameState, rng: Rng): boolean {
  const since = state.world.day - (state.player.missionRefreshDay ?? -B.missions.offerRefreshDays);
  if (state.player.missionOffers.length > 0 && since < B.missions.offerRefreshDays) return false;
  rollMissionOffers(state, rng);
  return true;
}

/** Force a specific mission onto the board (used by the `spawn_mission` effect). */
export function offerMission(state: GameState, rng: Rng, defId: ID): MissionState | null {
  const def = MISSION_BY_ID[defId];
  if (!def) return null;
  const mission = instantiateMission(state, rng, def);
  state.player.missionOffers.unshift(mission);
  if (state.player.missionOffers.length > 8) state.player.missionOffers.length = 8;
  pushNotification(state, {
    kind: 'info',
    title: `New contract: ${def.title}`,
    body: `${def.giverName} is looking for someone. ${def.description}`,
    link: '/game/missions',
  });
  return mission;
}

/* ------------------------------------------------------------------ */
/* Accept / abandon                                                    */
/* ------------------------------------------------------------------ */

export interface MissionActionResult {
  ok: boolean;
  reason?: string;
  mission?: MissionState;
}

export function acceptMission(state: GameState, missionId: ID): MissionActionResult {
  const active = state.player.missions.filter((m) => m.status === 'active');
  if (active.length >= B.missions.maxActiveMissions) {
    return { ok: false, reason: `You can only run ${B.missions.maxActiveMissions} contracts at once` };
  }
  const index = state.player.missionOffers.findIndex((m) => m.id === missionId);
  const offer = index >= 0 ? state.player.missionOffers[index] : state.player.missions.find((m) => m.id === missionId && m.status === 'available');
  if (!offer) return { ok: false, reason: 'That contract is no longer available' };
  if (offer.deadlineDay < state.world.day) return { ok: false, reason: 'That contract has already expired' };

  offer.status = 'active';
  offer.acceptedDay = state.world.day;
  state.player.missions.push(offer);
  if (index >= 0) state.player.missionOffers.splice(index, 1);
  state.player.missions.sort((a, b) => a.deadlineDay - b.deadlineDay);

  pushNotification(state, {
    kind: 'info',
    title: `Contract accepted: ${offer.title}`,
    body: `${offer.giverName}. Deadline: day ${offer.deadlineDay} (${offer.deadlineDay - state.world.day} days).`,
    link: '/game/missions',
    metrics: [
      { label: 'Reward', value: offer.rewardCash.toLocaleString('en-US') },
      { label: 'XP', value: String(offer.rewardXp) },
      { label: 'Objectives', value: String(offer.objectives.length) },
    ],
  });
  return { ok: true, mission: offer };
}

export function abandonMission(state: GameState, missionId: ID): MissionActionResult {
  const mission = state.player.missions.find((m) => m.id === missionId && m.status === 'active');
  if (!mission) return { ok: false, reason: 'No active contract with that id' };
  mission.status = 'failed';
  failMission(state, mission, 'Contract abandoned');
  return { ok: true, mission };
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

export interface ObjectiveUpdate {
  missionId: ID;
  missionTitle: string;
  objectiveId: ID;
  description: string;
  current: number;
  required: number;
  completed: boolean;
  missionCompleted: boolean;
}

/**
 * Report a real outcome to every active contract that cares about it.
 *
 * Returns the updates so callers can surface them in the UI ("+12 units toward
 * Standing Order") — the spec requires the game to explain *why* things changed.
 */
export function recordObjective(state: GameState, kind: ObjectiveKind, payload: ObjectivePayload): ObjectiveUpdate[] {
  const updates: ObjectiveUpdate[] = [];
  for (const mission of state.player.missions) {
    if (mission.status !== 'active') continue;
    for (const objective of mission.objectives) {
      if (objective.completed) continue;
      if (objective.kind !== kind) continue;
      const delta = advanceObjective(state, mission, objective, payload);
      if (delta === 0) continue;
      objective.currentAmount = round2(objective.currentAmount + delta);
      if (objective.currentAmount >= objective.requiredAmount - 1e-9) {
        objective.currentAmount = objective.requiredAmount;
        objective.completed = true;
      }
      updates.push({
        missionId: mission.id,
        missionTitle: mission.title,
        objectiveId: objective.id,
        description: objective.description,
        current: objective.currentAmount,
        required: objective.requiredAmount,
        completed: objective.completed,
        missionCompleted: mission.objectives.every((o) => o.completed),
      });
    }
    if (mission.objectives.every((o) => o.completed)) completeMission(state, mission);
  }
  return updates;
}

function advanceObjective(state: GameState, mission: MissionState, objective: MissionObjective, payload: ObjectivePayload): number {
  const key = objectiveKey(mission.id, objective.id);
  switch (objective.kind) {
    case 'buy_commodity':
    case 'produce_commodity': {
      if (!objective.targetId || payload.commodityId !== objective.targetId) return 0;
      return Math.max(0, payload.qty ?? 0);
    }

    case 'sell_commodity': {
      const target = objective.targetId ?? impliedCommodity(mission);
      if (target && payload.commodityId && payload.commodityId !== target) return 0;
      // Authored as "sell for at least 18% over cost" → one qualifying trade.
      const minMargin = 0.18;
      return (payload.margin ?? 0) >= minMargin ? 1 : 0;
    }

    case 'deliver_commodity': {
      const implied = impliedCommodity(mission);
      if (implied && payload.commodityId && payload.commodityId !== implied) return 0;
      if (objective.targetId && payload.locationId && payload.locationId !== objective.targetId) return 0;
      return Math.max(0, payload.qty ?? 1);
    }

    case 'travel_to': {
      const locationId = payload.locationId ?? state.player.locationId;
      const seen = `mission:${mission.id}:visited`;
      const visited: string[] = readList(state, seen);
      if (visited.includes(locationId)) return 0;
      writeList(state, seen, [...visited, locationId]);
      if (objective.targetId && objective.targetId !== locationId) return 0;
      return 1;
    }

    case 'acquire_cash': {
      const base = counter(state, `${key}:base`);
      if (base === 0) setCounter(state, `${key}:base`, 1);
      return Math.max(0, payload.amount ?? 0);
    }

    case 'launder_amount':
      return Math.max(0, payload.amount ?? 0);

    case 'hire_role': {
      if (objective.targetId && payload.roleId && payload.roleId !== objective.targetId) return 0;
      return Math.max(0, payload.qty ?? 1);
    }

    case 'own_property': {
      if (!objective.targetId) return 0;
      const owned = state.player.properties.filter((p) => p.defId === objective.targetId).length;
      return Math.max(0, owned - objective.currentAmount);
    }

    case 'reach_net_worth':
      return Math.max(0, computeNetWorth(state).total - objective.currentAmount);

    case 'reach_level':
      return Math.max(0, state.player.progression.level - objective.currentAmount);

    case 'reach_reputation': {
      const dimension = (objective.targetId ?? 'global') as keyof typeof state.player.reputation.dimensions;
      const value = state.player.reputation.dimensions[dimension] ?? 0;
      return Math.max(0, value - objective.currentAmount);
    }

    case 'reach_faction_standing': {
      if (!objective.targetId) return 0;
      const standing = state.world.factions[objective.targetId]?.playerStanding ?? 0;
      return Math.max(0, standing - objective.currentAmount);
    }

    case 'survive_days':
      return Math.max(0, state.world.day - mission.acceptedDay - objective.currentAmount);

    case 'complete_combat':
      return payload.won === true ? Math.max(0, payload.qty ?? 1) : 0;

    default:
      return 0;
  }
}

/** Objectives that are measured against live state rather than accumulated deltas. */
const LIVE_OBJECTIVE_KINDS: ObjectiveKind[] = [
  'reach_net_worth',
  'reach_level',
  'reach_reputation',
  'reach_faction_standing',
  'survive_days',
  'own_property',
];

function readList(state: GameState, key: string): string[] {
  const raw = state.player.progression.milestones.filter((m) => m.startsWith(`${key}|`));
  return raw.map((m) => m.split('|')[1] ?? '');
}

function writeList(state: GameState, key: string, values: string[]): void {
  state.player.progression.milestones = state.player.progression.milestones.filter((m) => !m.startsWith(`${key}|`));
  for (const v of values) state.player.progression.milestones.push(`${key}|${v}`);
}

/** Re-evaluate live-measured objectives (called by the daily tick). */
export function refreshLiveObjectives(state: GameState): ObjectiveUpdate[] {
  const updates: ObjectiveUpdate[] = [];
  for (const mission of state.player.missions) {
    if (mission.status !== 'active') continue;
    for (const objective of mission.objectives) {
      if (objective.completed || !LIVE_OBJECTIVE_KINDS.includes(objective.kind)) continue;
      const delta = advanceObjective(state, mission, objective, { locationId: state.player.locationId });
      if (delta <= 0) continue;
      objective.currentAmount = round2(objective.currentAmount + delta);
      if (objective.currentAmount >= objective.requiredAmount - 1e-9) {
        objective.currentAmount = objective.requiredAmount;
        objective.completed = true;
      }
      updates.push({
        missionId: mission.id,
        missionTitle: mission.title,
        objectiveId: objective.id,
        description: objective.description,
        current: objective.currentAmount,
        required: objective.requiredAmount,
        completed: objective.completed,
        missionCompleted: mission.objectives.every((o) => o.completed),
      });
    }
    if (mission.objectives.every((o) => o.completed)) completeMission(state, mission);
  }
  return updates;
}

/* ------------------------------------------------------------------ */
/* Completion / failure                                                */
/* ------------------------------------------------------------------ */

export interface MissionReward {
  cash: number;
  xp: number;
  reputation: { dimension: string; amount: number }[];
  items: { commodityId: ID; qty: number }[];
  unlocked: ID[];
}

export function completeMission(state: GameState, mission: MissionState): MissionReward | null {
  if (mission.status !== 'active') return null;
  mission.status = 'completed';
  mission.completedDay = state.world.day;

  const def = MISSION_BY_ID[mission.defId];
  const reward: MissionReward = {
    cash: mission.rewardCash,
    xp: mission.rewardXp,
    reputation: mission.rewardReputation.map((r) => ({ dimension: r.dimension, amount: r.amount })),
    items: mission.rewardItems.map((i) => ({ ...i })),
    unlocked: [],
  };

  if (reward.cash > 0) {
    creditCash(state, reward.cash, {
      kind: 'mission_reward',
      description: `Contract payment: ${mission.title}`,
      counterparty: mission.giverName,
      meta: { defId: mission.defId, xp: mission.rewardXp },
    });
  }
  for (const r of reward.reputation) {
    changeReputation(state, r.dimension as ReputationDimension, r.amount, `Completed contract "${mission.title}"`);
  }

  // Unlocks are offered, not force-fed: the player keeps agency over the board.
  for (const unlockId of def?.unlocks ?? []) {
    const unlockDef = MISSION_BY_ID[unlockId];
    if (!unlockDef) continue;
    if (state.player.missionOffers.some((m) => m.defId === unlockId)) continue;
    if (state.player.missions.some((m) => m.defId === unlockId)) continue;
    reward.unlocked.push(unlockId);
  }

  bumpCounter(state, 'missions_completed');
  setCounter(state, 'missions_completed_cash', counter(state, 'missions_completed_cash') + reward.cash);

  pushNotification(state, {
    kind: 'success',
    title: `Contract complete: ${mission.title}`,
    body: `${mission.giverName} paid out. ${reward.unlocked.length > 0 ? `New contacts unlocked: ${reward.unlocked.map((u) => MISSION_BY_ID[u]?.title ?? u).join(', ')}.` : ''}`,
    link: '/game/missions',
    metrics: [
      { label: 'Payment', value: reward.cash.toLocaleString('en-US') },
      { label: 'XP', value: String(reward.xp) },
      ...reward.reputation.map((r) => ({ label: `${r.dimension} reputation`, value: `+${r.amount}` })),
    ],
  });
  return reward;
}

export function failMission(state: GameState, mission: MissionState, reason: string): void {
  if (mission.status !== 'active') return;
  mission.status = 'expired';
  const penalty = round2(mission.rewardReputation.reduce((s, r) => s + Math.abs(r.amount), 0) * B.missions.failurePenaltyFraction);
  if (penalty > 0) {
    changeReputation(state, 'business', -penalty, `Failed contract "${mission.title}"`);
  }
  if (mission.giverFactionId && state.world.factions[mission.giverFactionId]) {
    const faction = state.world.factions[mission.giverFactionId]!;
    faction.playerStanding = Math.max(-100, faction.playerStanding - 4);
  }
  bumpCounter(state, 'missions_failed');
  pushNotification(state, {
    kind: 'danger',
    title: `Contract failed: ${mission.title}`,
    body: `${reason}${penalty > 0 ? ` Your business reputation took a hit (−${penalty}).` : ''}`,
    link: '/game/missions',
  });
}

export interface MissionTickResult {
  completed: MissionReward[];
  expired: ID[];
  objectiveUpdates: ObjectiveUpdate[];
  offersRolled: boolean;
  riskEvents: ID[];
}

/** Daily contract maintenance: deadlines, live objectives, board refresh. */
export function missionsDailyTick(state: GameState, rng: Rng): MissionTickResult {
  const result: MissionTickResult = { completed: [], expired: [], objectiveUpdates: [], offersRolled: false, riskEvents: [] };

  for (const mission of state.player.missions) {
    if (mission.status !== 'active') continue;
    if (state.world.day > mission.deadlineDay) {
      failMission(state, mission, `Deadline passed on day ${mission.deadlineDay}.`);
      result.expired.push(mission.id);
      continue;
    }
    // Contract risk: the job can go wrong (betrayal, exposure) as authored.
    if (rng.chance(mission.risk * 0.06)) {
      const roll = rng.float(0, 1);
      if (roll < 0.4) {
        changeReputation(state, 'business', -2, `Complications on "${mission.title}"`);
        pushNotification(state, {
          kind: 'warning',
          title: `Complication: ${mission.title}`,
          body: `${mission.giverName} is unhappy with the delay. Your business reputation slipped.`,
          link: '/game/missions',
        });
      } else {
        const extension = rng.int(1, 3);
        mission.deadlineDay += extension;
        pushNotification(state, {
          kind: 'info',
          title: `Deadline extended: ${mission.title}`,
          body: `${mission.giverName} granted ${extension} more day(s). New deadline: day ${mission.deadlineDay}.`,
          link: '/game/missions',
        });
      }
      result.riskEvents.push(mission.id);
    }
  }

  result.objectiveUpdates = refreshLiveObjectives(state);
  for (const update of result.objectiveUpdates) {
    if (update.missionCompleted) {
      const mission = state.player.missions.find((m) => m.id === update.missionId);
      if (mission) {
        const reward = completeMission(state, mission);
        if (reward) result.completed.push(reward);
      }
    }
  }

  // Prune the history so long saves stay small but recent outcomes remain visible.
  if (state.player.missions.length > 40) {
    state.player.missions = state.player.missions.filter((m) => m.status === 'active' || m.completedDay === null || state.world.day - (m.completedDay ?? 0) < 60);
  }

  result.offersRolled = maybeRefreshOffers(state, rng);
  return result;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface MissionView {
  id: ID;
  defId: ID;
  title: string;
  description: string;
  giverName: string;
  giverFactionId: ID | null;
  kind: MissionDef['kind'];
  difficulty: number;
  status: MissionState['status'];
  acceptedDay: number;
  deadlineDay: number;
  daysRemaining: number;
  rewardCash: number;
  rewardXp: number;
  risk: number;
  progress: number;
  objectives: {
    id: ID;
    description: string;
    current: number;
    required: number;
    progress: number;
    completed: boolean;
  }[];
  reputationRewards: { dimension: string; amount: number }[];
  unlockReason: string | null;
  unlocks: { id: ID; title: string }[];
}

function toView(state: GameState, mission: MissionState): MissionView {
  const def = MISSION_BY_ID[mission.defId];
  const done = mission.objectives.filter((o) => o.completed).length;
  return {
    id: mission.id,
    defId: mission.defId,
    title: mission.title,
    description: mission.description,
    giverName: mission.giverName,
    giverFactionId: mission.giverFactionId,
    kind: def?.kind ?? 'delivery',
    difficulty: def?.difficulty ?? 1,
    status: mission.status,
    acceptedDay: mission.acceptedDay,
    deadlineDay: mission.deadlineDay,
    daysRemaining: mission.deadlineDay - state.world.day,
    rewardCash: mission.rewardCash,
    rewardXp: mission.rewardXp,
    risk: mission.risk,
    progress: mission.objectives.length === 0 ? 0 : done / mission.objectives.length,
    objectives: mission.objectives.map((o) => ({
      id: o.id,
      description: o.description,
      current: Math.min(o.currentAmount, o.requiredAmount),
      required: o.requiredAmount,
      progress: o.requiredAmount === 0 ? 1 : Math.min(1, o.currentAmount / o.requiredAmount),
      completed: o.completed,
    })),
    reputationRewards: mission.rewardReputation.map((r) => ({ dimension: r.dimension, amount: r.amount })),
    unlockReason: null,
    unlocks: (def?.unlocks ?? []).map((u) => ({ id: u, title: MISSION_BY_ID[u]?.title ?? u })),
  };
}

export interface MissionBoard {
  offers: MissionView[];
  active: MissionView[];
  history: MissionView[];
  nextRefreshDay: number;
  maxActive: number;
  completed: number;
  failed: number;
  locked: { defId: ID; title: string; reason: string }[];
}

export function missionBoard(state: GameState): MissionBoard {
  const locked = eligibleMissions(state, new Rng(`${state.gameId}:missions:locked:${state.world.day}`))
    .filter((e) => e.reason !== null)
    .slice(0, 18)
    .map((e) => ({ defId: e.def.id, title: e.def.title, reason: e.reason! }));
  const finished = state.player.missions.filter((m) => m.status === 'completed' || m.status === 'failed' || m.status === 'expired');
  return {
    offers: state.player.missionOffers.map((m) => toView(state, m)),
    active: state.player.missions.filter((m) => m.status === 'active').map((m) => toView(state, m)),
    history: finished.slice(-20).reverse().map((m) => toView(state, m)),
    nextRefreshDay: (state.player.missionRefreshDay ?? 0) + B.missions.offerRefreshDays,
    maxActive: B.missions.maxActiveMissions,
    completed: counter(state, 'missions_completed'),
    failed: counter(state, 'missions_failed'),
    locked,
  };
}
