/**
 * Factions — the political and criminal world that keeps moving without you
 * (spec §16).
 *
 * Factions hold territory, compete, ally, declare war, make offers, demand
 * tribute and remember what you did. They are simulated daily: resources and
 * power drift, relations evolve, borders change hands, and the consequences land
 * in the price model (a faction at war raises route risk and shifts local demand)
 * and in enforcement (a faction that controls a city changes how it is policed).
 *
 * Player standing is earned through contracts, tribute, favours and reputation —
 * never permanently locked, and always recoverable.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { FACTIONS, FACTION_BY_ID } from '../engine/registry/actors';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { MISSION_BY_ID } from '../engine/registry/missions';
import { getWorldRegistry } from '../engine/registry/world';
import { materialiseLocation } from './markets';
import { offerMission } from './missions';
import { bumpCounter, counter, grantXp, setCounter } from './progression';
import { addHeat, changeReputation } from './reputation';
import {
  computeNetWorth,
  creditCash,
  debitCash,
  formatMoney,
  newId,
  pushDiagnostic,
  pushNotification,
  round2,
} from './state';
import { pushNews } from './world';
import type { FactionDef, FactionOffer, FactionState, GameState, ID } from './types';

const B = getBalance();
const worldReg = getWorldRegistry();
const registry = getCommodityRegistry();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * How many wars the world sustains at once. Each war raises route risk and
 * freight costs across every territory the belligerents touch, so an unbounded
 * number of simultaneous wars makes the map permanently untraversable.
 */
const MAX_CONCURRENT_WARS = 5;

function countWars(state: GameState): number {
  let total = 0;
  for (const faction of Object.values(state.world.factions)) {
    for (const enemyId of faction.atWarWith) {
      if (faction.factionId < enemyId) total += 1;
    }
  }
  return total;
}

const KIND_LABELS: Record<FactionDef['kind'], string> = {
  criminal_syndicate: 'Criminal syndicate',
  corporation: 'Corporation',
  government: 'Government',
  guild: 'Trade guild',
  militia: 'Militia',
  cartel: 'Cartel',
  bank: 'Bank',
  intelligence: 'Intelligence service',
  cult: 'Cult',
  union: 'Union',
};

/* ------------------------------------------------------------------ */
/* Standing                                                            */
/* ------------------------------------------------------------------ */

export function changeStanding(state: GameState, factionId: ID, delta: number, reason: string): number {
  const faction = state.world.factions[factionId];
  if (!faction || !Number.isFinite(delta) || delta === 0) return 0;
  const before = faction.playerStanding;
  faction.playerStanding = round2(clamp(before + delta, B.factions.relationshipRange[0], B.factions.relationshipRange[1]));
  faction.mood = round2(clamp(faction.mood + delta / 400, 0, 1));
  const applied = round2(faction.playerStanding - before);
  if (Math.abs(applied) >= 6) {
    pushNotification(state, {
      kind: applied > 0 ? 'success' : 'warning',
      title: `${FACTION_BY_ID[factionId]?.name ?? factionId} standing ${applied > 0 ? 'improved' : 'fell'}`,
      body: `${reason} (${applied > 0 ? '+' : ''}${applied} → ${faction.playerStanding.toFixed(0)}).`,
      link: '/game/factions',
    });
  }
  pushDiagnostic(state, {
    system: 'factions',
    level: 'debug',
    message: `Standing ${factionId} ${applied > 0 ? '+' : ''}${applied} → ${faction.playerStanding.toFixed(1)}: ${reason}`,
    data: { factionId, delta: applied, standing: faction.playerStanding },
  });
  return applied;
}

export function standingLabel(standing: number): string {
  if (standing >= 75) return 'Inner circle';
  if (standing >= B.factions.recruitmentRequirementStanding) return 'Trusted';
  if (standing >= 5) return 'Known';
  if (standing >= -20) return 'Neutral';
  if (standing >= -55) return 'Disliked';
  return 'Enemy';
}

/* ------------------------------------------------------------------ */
/* Daily simulation                                                    */
/* ------------------------------------------------------------------ */

export interface FactionTickResult {
  warsDeclared: { factionId: ID; enemyId: ID }[];
  peaceMade: { factionId: ID; enemyId: ID }[];
  territoryChanges: { factionId: ID; locationId: ID; taken: boolean }[];
  offersMade: FactionOffer[];
  tributeDemanded: { factionId: ID; amount: number } | null;
  relationShifts: number;
  newsGenerated: number;
}

export function factionTick(state: GameState, rng: Rng): FactionTickResult {
  const result: FactionTickResult = { warsDeclared: [], peaceMade: [], territoryChanges: [], offersMade: [], tributeDemanded: null, relationShifts: 0, newsGenerated: 0 };
  const day = state.world.day;
  // The world can only absorb so much drama per day: one new war and one new
  // offer for the player. Without a budget every route is permanently disrupted
  // and the news feed is nothing but crises.
  let warsToday = 0;
  let offersToday = 0;

  for (const faction of Object.values(state.world.factions)) {
    const def = FACTION_BY_ID[faction.factionId];
    if (!def) continue;

    /* --------------------------- resources & power -------------------------- */
    const incomeRate = def.kind === 'corporation' || def.kind === 'bank' ? 0.0016 : def.kind === 'government' ? 0.0011 : 0.0022;
    faction.resources = round2(Math.max(0, faction.resources * (1 + incomeRate * (0.6 + state.world.indicators.gdpGrowth + 0.4)) - faction.resources * 0.0008 * (1 + faction.aggression)));
    faction.power = round2(clamp(faction.power * (1 + rng.gaussian(0, 0.004)) + (faction.resources > 1_000_000 ? 0.0006 : -0.0004), 0.02, 0.99));
    faction.mood = round2(clamp(faction.mood + rng.gaussian(0, 0.012) + (state.world.globalSentiment - 0.5) * 0.01, 0, 1));

    /* ------------------------------- relations ------------------------------ */
    for (const [otherId, value] of Object.entries(faction.relations)) {
      const other = state.world.factions[otherId];
      if (!other) continue;
      const otherDef = FACTION_BY_ID[otherId];
      if (!otherDef) continue;
      // Shared interests pull factions together; contested territory pushes apart.
      const sharedInterest = def.interests.filter((i) => otherDef.interests.includes(i)).length;
      const contested = def.territoryIds.filter((t) => otherDef.territoryIds.includes(t)).length;
      const atWar = faction.atWarWith.includes(otherId);
      let drift = (sharedInterest * 0.02 - contested * 0.05) * (atWar ? -1.6 : 1);
      // War weariness: belligerents drift back toward a cold-but-not-frozen
      // relationship, which is what eventually makes a ceasefire possible.
      if (atWar) drift += (-14 - value) * 0.006;
      else drift += (0 - value) * 0.0012; // slow mean reversion
      drift += rng.gaussian(0, 0.22);
      const next = round2(clamp(value + drift, B.factions.relationshipRange[0], B.factions.relationshipRange[1]));
      faction.relations[otherId] = next;
      if (Math.abs(next - value) > 0.01) result.relationShifts += 1;

      /* ------------------------------ war & peace ---------------------------- */
      const warBudget = warsToday === 0 && countWars(state) < MAX_CONCURRENT_WARS;
      if (!atWar && warBudget && next <= B.factions.warDeclarationThreshold && faction.power > other.power * 0.85 && rng.chance(0.02)) {
        declareWar(state, faction, other, `Relations fell to ${next.toFixed(0)} and ${def.name} decided it could win.`);
        result.warsDeclared.push({ factionId: faction.factionId, enemyId: otherId });
        result.newsGenerated += 1;
        warsToday += 1;
      } else if (atWar && (next > -35 || faction.power < other.power * 0.5) && rng.chance(0.08)) {
        makePeace(state, faction, other, next > -35 ? 'Both sides ran out of appetite for the fight.' : `${def.name} could no longer sustain the war.`);
        result.peaceMade.push({ factionId: faction.factionId, enemyId: otherId });
        result.newsGenerated += 1;
      }
    }

    /* ------------------------------ territory ------------------------------- */
    if (rng.chance(B.factions.territoryContestChancePerDay * (0.5 + faction.aggression))) {
      const change = contestTerritory(state, rng, faction);
      if (change) {
        result.territoryChanges.push(change);
        result.newsGenerated += 1;
      }
    }

    /* -------------------------------- offers -------------------------------- */
    if (offersToday < 1 && day - faction.lastActionDay >= 9 && faction.pendingOffers.length < 2 && faction.playerStanding > -12 && rng.chance(0.09 + faction.mood * 0.07)) {
      const offer = makeOffer(state, rng, faction);
      if (offer) {
        faction.pendingOffers.push(offer);
        faction.lastActionDay = day;
        offersToday += 1;
        if (faction.pendingOffers.length > 6) faction.pendingOffers.shift();
        result.offersMade.push(offer);
        pushNotification(state, {
          kind: offer.kind === 'warning' ? 'danger' : 'opportunity',
          title: `${def.name}: ${describeOfferKind(offer.kind)}`,
          body: `${offer.description} Reward ${formatMoney(offer.reward)}, standing ${offer.standingDelta >= 0 ? '+' : ''}${offer.standingDelta}, risk ${(offer.risk * 100).toFixed(0)}%. Expires day ${offer.expiresDay}.`,
          link: '/game/factions',
          metrics: [
            { label: 'Reward', value: formatMoney(offer.reward) },
            { label: 'Standing', value: `${offer.standingDelta >= 0 ? '+' : ''}${offer.standingDelta}` },
            { label: 'Risk', value: `${(offer.risk * 100).toFixed(0)}%` },
          ],
        });
      }
    }

    // Expire stale offers.
    faction.pendingOffers = faction.pendingOffers.filter((o) => o.expiresDay >= day || o.accepted !== null);

    /* ------------------------------- tribute -------------------------------- */
    const controlsHere = faction.controlledLocationIds.includes(state.player.locationId);
    if (controlsHere && (def.kind === 'criminal_syndicate' || def.kind === 'cartel' || def.kind === 'militia')) {
      const demand = round2(B.factions.tributeFractionOfRevenue * Math.max(2000, computeNetWorth(state).total * 0.03) * (1 + faction.aggression));
      if (demand > 500 && day % 21 === 0 && !result.tributeDemanded) {
        result.tributeDemanded = { factionId: faction.factionId, amount: demand };
        const offer: FactionOffer = {
          id: newId(rng, 'offer'),
          kind: 'tribute',
          description: `${def.name} expects ${formatMoney(demand)} for operating in ${worldReg.requireLocation(state.player.locationId).name}. Paying buys protection; refusing buys attention.`,
          createdDay: day,
          expiresDay: day + 7,
          reward: 0,
          standingDelta: 8,
          risk: 0.4,
          accepted: null,
        };
        faction.pendingOffers.push(offer);
        result.offersMade.push(offer);
        pushNotification(state, {
          kind: 'warning',
          title: `${def.name} demands tribute`,
          body: offer.description,
          link: '/game/factions',
          metrics: [{ label: 'Amount', value: formatMoney(demand) }],
        });
      }
    }
  }

  return result;
}

/**
 * Provoke a war between two factions that are already hostile. Used by the event
 * engine (`faction_war` effect) so authored events can escalate the world.
 */
export function provokeWar(state: GameState, rng: Rng): { factionId: ID; enemyId: ID } | null {
  if (countWars(state) >= MAX_CONCURRENT_WARS) return null;
  const candidates: { faction: FactionState; enemy: FactionState; score: number }[] = [];
  for (const faction of Object.values(state.world.factions)) {
    for (const [enemyId, relation] of Object.entries(faction.relations)) {
      const enemy = state.world.factions[enemyId];
      if (!enemy || faction.atWarWith.includes(enemyId)) continue;
      if (relation > -42) continue;
      candidates.push({ faction, enemy, score: -relation * faction.aggression * faction.power });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const pick = rng.chance(0.6) ? candidates[0]! : rng.pick(candidates)!;
  declareWar(state, pick.faction, pick.enemy, 'A long-running dispute turned violent.');
  return { factionId: pick.faction.factionId, enemyId: pick.enemy.factionId };
}

function declareWar(state: GameState, faction: FactionState, enemy: FactionState, reason: string): void {
  if (!faction.atWarWith.includes(enemy.factionId)) faction.atWarWith.push(enemy.factionId);
  if (!enemy.atWarWith.includes(faction.factionId)) enemy.atWarWith.push(faction.factionId);
  faction.relations[enemy.factionId] = B.factions.relationshipRange[0];
  enemy.relations[faction.factionId] = B.factions.relationshipRange[0];
  faction.alliedWith = faction.alliedWith.filter((id) => id !== enemy.factionId);
  enemy.alliedWith = enemy.alliedWith.filter((id) => id !== faction.factionId);
  const name = FACTION_BY_ID[faction.factionId]?.name ?? faction.factionId;
  const enemyName = FACTION_BY_ID[enemy.factionId]?.name ?? enemy.factionId;
  pushNews(state.world, {
    scope: 'regional',
    category: 'faction',
    headline: `${name} declares war on ${enemyName}`,
    body: `${reason} Expect route risk, enforcement spikes and price dislocation wherever the two overlap.`,
    locationIds: faction.controlledLocationIds.concat(enemy.controlledLocationIds).slice(0, 6),
    tags: ['faction', 'war', faction.factionId, enemy.factionId],
    importance: 4,
  });
  // War raises risk on the routes between their territories.
  for (const routeId of Object.keys(state.world.routes)) {
    const route = worldReg.route(routeId);
    if (!route) continue;
    const touchesFaction = faction.controlledLocationIds.includes(route.from) || faction.controlledLocationIds.includes(route.to);
    const touchesEnemy = enemy.controlledLocationIds.includes(route.from) || enemy.controlledLocationIds.includes(route.to);
    if (touchesFaction && touchesEnemy) {
      const routeState = state.world.routes[routeId]!;
      routeState.risk = round2(clamp(routeState.risk + 0.22, 0, 0.95));
      routeState.costMultiplier = round2(clamp(routeState.costMultiplier * 1.35, 1, 3));
    }
  }
  if (state.player.locationId && (faction.controlledLocationIds.includes(state.player.locationId) || enemy.controlledLocationIds.includes(state.player.locationId))) {
    addHeat(state, 4, 'Faction war in your city');
  }
}

function makePeace(state: GameState, faction: FactionState, enemy: FactionState, reason: string): void {
  faction.atWarWith = faction.atWarWith.filter((id) => id !== enemy.factionId);
  enemy.atWarWith = enemy.atWarWith.filter((id) => id !== faction.factionId);
  faction.relations[enemy.factionId] = round2(clamp(faction.relations[enemy.factionId] ?? -50, -40, 10));
  enemy.relations[faction.factionId] = faction.relations[enemy.factionId]!;
  const name = FACTION_BY_ID[faction.factionId]?.name ?? faction.factionId;
  const enemyName = FACTION_BY_ID[enemy.factionId]?.name ?? enemy.factionId;
  pushNews(state.world, {
    scope: 'regional',
    category: 'faction',
    headline: `${name} and ${enemyName} agree a ceasefire`,
    body: `${reason} Routes between their territories should normalise within days.`,
    locationIds: faction.controlledLocationIds.slice(0, 4),
    tags: ['faction', 'peace'],
    importance: 3,
  });
  for (const routeId of Object.keys(state.world.routes)) {
    const route = worldReg.route(routeId);
    if (!route) continue;
    const touches =
      (faction.controlledLocationIds.includes(route.from) || faction.controlledLocationIds.includes(route.to)) &&
      (enemy.controlledLocationIds.includes(route.from) || enemy.controlledLocationIds.includes(route.to));
    if (touches) {
      const routeState = state.world.routes[routeId]!;
      routeState.risk = round2(clamp(routeState.risk * 0.6, route.baseRisk * 0.8, 0.95));
      routeState.costMultiplier = round2(clamp(routeState.costMultiplier * 0.8, 1, 3));
    }
  }
}

function contestTerritory(state: GameState, rng: Rng, faction: FactionState): { factionId: ID; locationId: ID; taken: boolean } | null {
  const def = FACTION_BY_ID[faction.factionId];
  if (!def) return null;
  // Attack a neighbour of what we hold, or defend against an enemy.
  const candidates = new Set<ID>();
  for (const locationId of faction.controlledLocationIds) {
    for (const { other } of worldReg.neighboursOf(locationId)) candidates.add(other.id);
  }
  const targets = [...candidates].filter((id) => !faction.controlledLocationIds.includes(id));
  if (targets.length === 0) return null;
  const targetId = rng.pick(targets)!;
  const holder = Object.values(state.world.factions).find((f) => f.factionId !== faction.factionId && f.controlledLocationIds.includes(targetId));
  const attackerStrength = faction.power * faction.resources ** 0.25 * (0.7 + faction.aggression * 0.6);
  const defenderStrength = holder ? holder.power * holder.resources ** 0.25 * 1.15 : faction.power * 0.4;
  const chance = clamp(attackerStrength / Math.max(0.001, attackerStrength + defenderStrength), 0.05, 0.9);
  if (!rng.chance(chance)) return null;

  if (holder) holder.controlledLocationIds = holder.controlledLocationIds.filter((id) => id !== targetId);
  faction.controlledLocationIds.push(targetId);
  const location = worldReg.requireLocation(targetId);
  const locState = state.world.locations[targetId];
  if (locState) {
    locState.controllingFactionId = faction.factionId;
    locState.stability = round2(clamp(locState.stability - rng.float(0.06, 0.2), 0.02, 1));
    locState.patrolIntensity = round2(clamp(locState.patrolIntensity + (def.kind === 'government' ? 0.08 : -0.1), 0.02, 0.95));
  }
  pushNews(state.world, {
    scope: 'local',
    category: 'faction',
    headline: `${def.name} takes ${location.name}`,
    body: holder
      ? `${FACTION_BY_ID[holder.factionId]?.name ?? holder.factionId} lost control of ${location.name}. Stability fell and the enforcement posture changed with the new owner.`
      : `${location.name} came under ${def.name} control without a fight.`,
    locationIds: [targetId],
    tags: ['faction', 'territory'],
    importance: 3,
  });
  // Category demand shifts with the new owner's interests.
  if (locState) {
    for (const category of def.interests.slice(0, 3)) {
      locState.demandShift[category] = round2(clamp((locState.demandShift[category] ?? 1) * (def.kind === 'government' ? 1.08 : 1.18), 0.4, 2.4));
    }
  }
  return { factionId: faction.factionId, locationId: targetId, taken: true };
}

function describeOfferKind(kind: FactionOffer['kind']): string {
  switch (kind) {
    case 'contract':
      return 'contract offered';
    case 'tribute':
      return 'tribute demanded';
    case 'alliance':
      return 'alliance proposed';
    case 'warning':
      return 'warning';
    case 'trade_access':
      return 'trade access offered';
    default:
      return 'offer';
  }
}

function makeOffer(state: GameState, rng: Rng, faction: FactionState): FactionOffer | null {
  const def = FACTION_BY_ID[faction.factionId];
  if (!def) return null;
  if (faction.playerStanding < def.recruitmentRequirement * 0.4 && rng.chance(0.6)) return null;
  const worth = computeNetWorth(state).total;
  const roll = rng.float(0, 1);
  const base: Omit<FactionOffer, 'id' | 'createdDay' | 'expiresDay'> = {
    kind: 'contract',
    description: '',
    reward: 0,
    standingDelta: 0,
    risk: 0.1,
    accepted: null,
  };

  if (roll < 0.42 && def.services.includes('contracts')) {
    const missionIds = Object.keys(MISSION_BY_ID).filter((id) => {
      const m = MISSION_BY_ID[id]!;
      return m.minLevel <= state.player.progression.level + 2 && (m.giverFactionId === null || m.giverFactionId === faction.factionId);
    });
    const missionId = missionIds.length > 0 ? rng.pick(missionIds) : null;
    const mission = missionId ? MISSION_BY_ID[missionId] : null;
    return {
      ...base,
      id: newId(rng, 'offer'),
      kind: 'contract',
      description: mission
        ? `${def.name} wants "${mission.title}" done. ${mission.description}`
        : `${def.name} has work for someone discreet.`,
      createdDay: state.world.day,
      expiresDay: state.world.day + rng.int(6, 16),
      reward: round2((mission?.rewardCash ?? 4000) * rng.float(0.9, 1.5)),
      standingDelta: Math.round(B.factions.standingGainPerFavour * rng.float(0.6, 1.3)),
      risk: round2(clamp((mission?.risk ?? 0.2) * 1.1, 0.02, 0.9)),
      accepted: null,
      ...(missionId ? { missionId } : {}),
    };
  }
  if (roll < 0.58 && def.services.includes('protection')) {
    return {
      ...base,
      id: newId(rng, 'offer'),
      kind: 'warning',
      description: `${def.name} knows what you move through ${worldReg.requireLocation(state.player.locationId).name}. Pay for protection, or deal with whoever comes next.`,
      createdDay: state.world.day,
      expiresDay: state.world.day + 5,
      reward: 0,
      standingDelta: 6,
      risk: 0.45,
      accepted: null,
    };
  }
  if (roll < 0.74 && (def.services.includes('smuggling') || def.services.includes('contracts'))) {
    return {
      ...base,
      id: newId(rng, 'offer'),
      kind: 'trade_access',
      description: `${def.name} will introduce you to a channel they control — goods that are not openly stocked here.`,
      createdDay: state.world.day,
      expiresDay: state.world.day + rng.int(8, 20),
      reward: round2(Math.max(500, worth * 0.004)),
      standingDelta: 4,
      risk: 0.18,
      accepted: null,
    };
  }
  if (roll < 0.88 && def.services.includes('intel')) {
    return {
      ...base,
      id: newId(rng, 'offer'),
      kind: 'contract',
      description: `${def.name} will sell you intelligence about a market or a rival. Discretion is expected on both sides.`,
      createdDay: state.world.day,
      expiresDay: state.world.day + rng.int(4, 12),
      reward: round2(Math.max(800, worth * 0.006)),
      standingDelta: 5,
      risk: 0.12,
      accepted: null,
    };
  }
  return {
    ...base,
    id: newId(rng, 'offer'),
    kind: 'alliance',
    description: `${def.name} proposes a formal arrangement: mutual access, shared information, and an expectation of loyalty when it matters.`,
    createdDay: state.world.day,
    expiresDay: state.world.day + rng.int(10, 25),
    reward: 0,
    standingDelta: 18,
    risk: 0.25,
    accepted: null,
  };
}

/* ------------------------------------------------------------------ */
/* Player actions                                                      */
/* ------------------------------------------------------------------ */

export interface FactionActionResult {
  ok: boolean;
  reason?: string;
  standing?: number;
  cost?: number;
  reward?: number;
}

export function acceptOffer(state: GameState, rng: Rng, factionId: ID, offerId: ID): FactionActionResult {
  const faction = state.world.factions[factionId];
  const offer = faction?.pendingOffers.find((o) => o.id === offerId);
  if (!faction || !offer) return { ok: false, reason: 'That offer no longer exists.' };
  if (offer.accepted !== null) return { ok: false, reason: 'You already answered that offer.' };
  if (state.world.day > offer.expiresDay) {
    offer.accepted = false;
    changeStanding(state, factionId, -3, 'An offer was left to expire');
    return { ok: false, reason: `That offer expired on day ${offer.expiresDay}.` };
  }
  const def = FACTION_BY_ID[factionId];

  if (offer.kind === 'tribute' || offer.kind === 'warning') {
    const amount = offer.kind === 'tribute' ? Math.max(500, round2(offer.reward > 0 ? offer.reward : B.factions.tributeFractionOfRevenue * Math.max(2000, computeNetWorth(state).total * 0.03))) : round2(Math.max(300, computeNetWorth(state).total * 0.006));
    const move = debitCash(state, amount, {
      kind: 'bribe',
      description: `Tribute to ${def?.name ?? factionId}`,
      allowDirty: true,
      counterparty: def?.name ?? factionId,
      meta: { offerId },
    });
    if (!move.ok) return { ok: false, reason: move.reason ?? `They want ${formatMoney(amount)}.` };
    offer.accepted = true;
    changeStanding(state, factionId, offer.standingDelta, `Paid tribute to ${def?.name ?? factionId}`);
    changeReputation(state, 'criminal', 1.5, 'Paid tribute');
    setCounter(state, 'tribute_paid', round2(counter(state, 'tribute_paid') + amount));
    bumpCounter(state, 'tributes');
    // Protection has a real effect: less enforcement attention where they rule.
    const locState = state.world.locations[state.player.locationId];
    if (locState) locState.patrolIntensity = round2(clamp(locState.patrolIntensity * 0.72, 0.02, 0.95));
    grantXp(state, 25, `Settled with ${def?.name ?? factionId}`);
    return { ok: true, cost: amount, standing: faction.playerStanding };
  }

  if (offer.kind === 'contract') {
    const missionId = offer.missionId;
    if (missionId && MISSION_BY_ID[missionId]) {
      const mission = offerMission(state, rng, missionId);
      offer.accepted = true;
      changeStanding(state, factionId, 2, 'Accepted a faction contract');
      return {
        ok: true,
        standing: faction.playerStanding,
        reason: mission ? `Contract "${mission.title}" added to your board.` : 'The contract was posted to your board.',
      };
    }
    // Generic contract: pay out now for a job done, with risk.
    if (rng.chance(offer.risk)) {
      addHeat(state, 8, `A ${def?.name ?? 'faction'} contract went wrong`);
      changeStanding(state, factionId, -B.factions.standingLossPerTransgression * 0.5, 'A contract went wrong');
      offer.accepted = true;
      return { ok: true, standing: faction.playerStanding, reason: 'The job went sideways. They blame you.' };
    }
    const payout = round2(offer.reward * rng.float(0.85, 1.2));
    creditCash(state, payout, { kind: 'mission_reward', description: `Contract payment from ${def?.name ?? factionId}`, dirty: (def?.kind ?? '') === 'criminal_syndicate' || (def?.kind ?? '') === 'cartel', counterparty: def?.name ?? factionId });
    offer.accepted = true;
    changeStanding(state, factionId, offer.standingDelta, `Completed a contract for ${def?.name ?? factionId}`);
    grantXp(state, Math.round(60 + offer.reward / 400), `Contract for ${def?.name ?? factionId}`);
    bumpCounter(state, 'faction_contracts');
    return { ok: true, reward: payout, standing: faction.playerStanding };
  }

  if (offer.kind === 'trade_access') {
    offer.accepted = true;
    changeStanding(state, factionId, offer.standingDelta, `Accepted trade access from ${def?.name ?? factionId}`);
    state.player.progression.milestones.push(`faction_access:${factionId}`);
    state.player.underground.digitalReputation = round2(clamp(state.player.underground.digitalReputation + 4, 0, 100));
    changeReputation(state, 'underground', 3, `Introduced by ${def?.name ?? factionId}`);
    // Reveal the hidden channels they control at this location.
    materialiseLocation(state, state.player.locationId, { includeHidden: true });
    return { ok: true, standing: faction.playerStanding, reason: 'Hidden channels are now visible at your current location.' };
  }

  if (offer.kind === 'alliance') {
    offer.accepted = true;
    changeStanding(state, factionId, offer.standingDelta, `Formal alliance with ${def?.name ?? factionId}`);
    for (const rival of faction.atWarWith) changeStanding(state, rival, -B.factions.standingLossPerTransgression * 0.6, `Allied with their enemy ${def?.name ?? factionId}`);
    changeReputation(state, 'global', 3, `Allied with ${def?.name ?? factionId}`);
    state.player.progression.milestones.push(`alliance:${factionId}`);
    return { ok: true, standing: faction.playerStanding, reason: `You are allied with ${def?.name ?? factionId}. Their enemies now regard you as one too.` };
  }

  offer.accepted = true;
  return { ok: false, reason: 'Nothing came of it.' };
}

export function declineOffer(state: GameState, factionId: ID, offerId: ID): FactionActionResult {
  const faction = state.world.factions[factionId];
  const offer = faction?.pendingOffers.find((o) => o.id === offerId);
  if (!faction || !offer) return { ok: false, reason: 'That offer no longer exists.' };
  offer.accepted = false;
  const penalty = offer.kind === 'tribute' || offer.kind === 'warning' ? -B.factions.standingLossPerTransgression : -2;
  changeStanding(state, factionId, penalty, `Refused ${offer.kind === 'tribute' ? 'tribute' : 'an offer'}`);
  if (offer.kind === 'tribute' || offer.kind === 'warning') {
    addHeat(state, 6, 'Refused a faction\u2019s demand');
    changeReputation(state, 'criminal', -3, 'Refused to pay a faction');
    pushNotification(state, {
      kind: 'warning',
      title: `${FACTION_BY_ID[factionId]?.name ?? factionId} will remember this`,
      body: 'Refusing tribute means enforcement of their own: expect pressure on your routes, premises and people.',
      link: '/game/factions',
    });
  }
  return { ok: true, standing: faction.playerStanding };
}

export function payFactionGift(state: GameState, factionId: ID, amount: number): FactionActionResult {
  const faction = state.world.factions[factionId];
  const def = FACTION_BY_ID[factionId];
  if (!faction) return { ok: false, reason: 'Unknown faction.' };
  if (amount <= 0) return { ok: false, reason: 'Amount must be positive.' };
  const move = debitCash(state, round2(amount), {
    kind: 'bribe',
    description: `Gift to ${def?.name ?? factionId}`,
    allowDirty: true,
    counterparty: def?.name ?? factionId,
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? 'Insufficient funds.' };
  // Diminishing returns: the first money matters most, and it cannot buy trust
  // from a faction that already regards you as an enemy.
  const goodwill = clamp(Math.log10(Math.max(10, amount)) * 2.4, 0.5, 14) * (faction.playerStanding < -30 ? 0.4 : 1);
  changeStanding(state, factionId, goodwill, 'A gift was delivered');
  changeReputation(state, 'criminal', 0.6, 'Cultivated a faction');
  setCounter(state, 'faction_gifts', round2(counter(state, 'faction_gifts') + amount));
  return { ok: true, cost: round2(amount), standing: faction.playerStanding };
}

export function requestService(state: GameState, rng: Rng, factionId: ID, service: FactionDef['services'][number]): FactionActionResult {
  const faction = state.world.factions[factionId];
  const def = FACTION_BY_ID[factionId];
  if (!faction || !def) return { ok: false, reason: 'Unknown faction.' };
  if (!def.services.includes(service)) return { ok: false, reason: `${def.name} does not offer ${service}.` };
  if (faction.playerStanding < def.recruitmentRequirement) {
    return { ok: false, reason: `${def.name} requires ${def.recruitmentRequirement} standing to use their services (you have ${faction.playerStanding.toFixed(0)}).` };
  }
  switch (service) {
    case 'smuggling': {
      const locState = state.world.locations[state.player.locationId];
      if (locState) locState.patrolIntensity = round2(clamp(locState.patrolIntensity * 0.6, 0.02, 0.95));
      changeStanding(state, factionId, -2, 'Called in a smuggling favour');
      return { ok: true, reason: 'Their people will look the other way for a while — patrol intensity here dropped.' };
    }
    case 'protection': {
      const property = state.player.properties.find((p) => p.locationId === state.player.locationId);
      if (property) property.security = round2(clamp(property.security + 0.12, 0, 0.98));
      changeStanding(state, factionId, -3, 'Called in protection');
      return { ok: true, reason: 'Your premises here are watched by their people. Security improved.' };
    }
    case 'intel': {
      const hidden = worldReg.locations.filter((l) => l.hidden && !state.world.locations[l.id]?.discovered);
      const target = hidden.length > 0 ? rng.pick(hidden) : null;
      if (target && state.world.locations[target.id]) {
        state.world.locations[target.id]!.discovered = true;
        state.player.progression.milestones.push(`discovered:${target.id}`);
        changeStanding(state, factionId, -2, 'Asked for location intel');
        return { ok: true, reason: `${target.name} has been revealed on your map.` };
      }
      return { ok: false, reason: 'They have nothing new to sell you right now.' };
    }
    case 'mercenary': {
      const cost = round2(2400 + faction.power * 9000);
      const move = debitCash(state, cost, { kind: 'hire', description: `Mercenary detail from ${def.name}`, allowDirty: true, counterparty: def.name });
      if (!move.ok) return { ok: false, reason: move.reason ?? `They want ${formatMoney(cost)}.` };
      changeStanding(state, factionId, 1, 'Hired their muscle');
      return { ok: true, cost, reason: 'Their people will fight alongside you in the next engagement.' };
    }
    case 'laundering': {
      changeStanding(state, factionId, -2, 'Used their laundering channel');
      return { ok: true, reason: 'They will move cash for you — stage it through a business you own and they will take the heat.' };
    }
    case 'loans': {
      return { ok: true, reason: `${def.name} will lend to you. A faction loan appears in the bank screen's offer list.` };
    }
    case 'legal': {
      const cost = round2(4000 + Math.max(0, state.player.reputation.heat) * 120);
      const move = debitCash(state, cost, { kind: 'fee', description: `Legal representation via ${def.name}`, allowDirty: false, counterparty: def.name });
      if (!move.ok) return { ok: false, reason: move.reason ?? `Counsel costs ${formatMoney(cost)}.` };
      const before = state.player.reputation.heat;
      state.player.reputation.heat = round2(clamp(before * 0.55, 0, 200));
      changeStanding(state, factionId, 1, 'Used their lawyers');
      return { ok: true, cost, reason: `Heat reduced from ${before.toFixed(0)} to ${state.player.reputation.heat.toFixed(0)}.` };
    }
    case 'contracts': {
      const missionIds = Object.keys(MISSION_BY_ID).filter((id) => MISSION_BY_ID[id]!.minLevel <= state.player.progression.level + 2);
      const missionId = missionIds.length > 0 ? rng.pick(missionIds) : null;
      if (!missionId) return { ok: false, reason: 'They have no work that fits you right now.' };
      offerMission(state, rng, missionId);
      changeStanding(state, factionId, 1, 'Asked for work');
      return { ok: true, reason: 'A contract was posted to your board.' };
    }
    case 'logistics': {
      for (const shipment of state.player.shipments.filter((s) => s.status === 'delayed')) {
        shipment.status = 'in_transit';
        shipment.delayReason = null;
        shipment.arrivesDay = Math.max(state.world.day + 1, shipment.arrivesDay - 2);
      }
      changeStanding(state, factionId, -2, 'Used their logistics');
      return { ok: true, reason: 'Delayed shipments were expedited through their carriers.' };
    }
    default:
      return { ok: false, reason: 'That service is not available right now.' };
  }
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface FactionView {
  id: ID;
  name: string;
  kind: FactionDef['kind'];
  kindLabel: string;
  description: string;
  goals: string[];
  services: FactionDef['services'];
  resources: number;
  power: number;
  aggression: number;
  mood: number;
  playerStanding: number;
  standingLabel: string;
  recruitmentRequirement: number;
  canUseServices: boolean;
  territory: { id: ID; name: string; here: boolean }[];
  atWarWith: { id: ID; name: string }[];
  alliedWith: { id: ID; name: string }[];
  relations: { id: ID; name: string; value: number }[];
  interests: string[];
  offers: {
    id: ID;
    kind: FactionOffer['kind'];
    kindLabel: string;
    description: string;
    reward: number;
    standingDelta: number;
    risk: number;
    expiresDay: number;
    daysLeft: number;
    accepted: boolean | null;
  }[];
  tributeOwed: number;
  controlsCurrentLocation: boolean;
}

export function factionViews(state: GameState): FactionView[] {
  return FACTIONS.map((def): FactionView | null => {
    const faction = state.world.factions[def.id];
    if (!faction) return null;
    const tribute = faction.pendingOffers.find((o) => o.kind === 'tribute' && o.accepted === null);
    return {
      id: def.id,
      name: def.name,
      kind: def.kind,
      kindLabel: KIND_LABELS[def.kind],
      description: def.description,
      goals: def.goals,
      services: def.services,
      resources: round2(faction.resources),
      power: round2(faction.power),
      aggression: round2(faction.aggression),
      mood: round2(faction.mood),
      playerStanding: round2(faction.playerStanding),
      standingLabel: standingLabel(faction.playerStanding),
      recruitmentRequirement: def.recruitmentRequirement,
      canUseServices: faction.playerStanding >= def.recruitmentRequirement,
      territory: faction.controlledLocationIds.map((id) => ({ id, name: worldReg.location(id)?.name ?? id, here: id === state.player.locationId })),
      atWarWith: faction.atWarWith.map((id) => ({ id, name: FACTION_BY_ID[id]?.name ?? id })),
      alliedWith: faction.alliedWith.map((id) => ({ id, name: FACTION_BY_ID[id]?.name ?? id })),
      relations: Object.entries(faction.relations)
        .map(([id, value]) => ({ id, name: FACTION_BY_ID[id]?.name ?? id, value: round2(value) }))
        .sort((a, b) => a.value - b.value)
        .slice(0, 8),
      interests: def.interests.map((i) => i),
      offers: faction.pendingOffers
        .filter((o) => o.accepted === null && o.expiresDay >= state.world.day)
        .map((o) => ({
          id: o.id,
          kind: o.kind,
          kindLabel: describeOfferKind(o.kind),
          description: o.description,
          reward: o.reward,
          standingDelta: o.standingDelta,
          risk: o.risk,
          expiresDay: o.expiresDay,
          daysLeft: o.expiresDay - state.world.day,
          accepted: o.accepted,
        })),
      tributeOwed: tribute ? round2(B.factions.tributeFractionOfRevenue * Math.max(2000, computeNetWorth(state).total * 0.03)) : 0,
      controlsCurrentLocation: faction.controlledLocationIds.includes(state.player.locationId),
    };
  }).filter((f): f is FactionView => f !== null)
    .sort((a, b) => b.playerStanding - a.playerStanding);
}

export interface FactionOverview {
  total: number;
  wars: { a: string; b: string; sinceBalance: number }[];
  controllerHere: { id: ID; name: string; kind: string } | null;
  territoryChanges30d: number;
  bestStanding: { name: string; standing: number } | null;
  worstStanding: { name: string; standing: number } | null;
  offersOpen: number;
  tributeDemands: number;
  servicesAvailable: { faction: string; service: string }[];
  factionPressure: number;
}

export function factionOverview(state: GameState): FactionOverview {
  const views = factionViews(state);
  const wars: FactionOverview['wars'] = [];
  for (const faction of Object.values(state.world.factions)) {
    for (const enemyId of faction.atWarWith) {
      if (faction.factionId < enemyId) {
        const balance = (faction.relations[enemyId] ?? 0) + (state.world.factions[enemyId]?.relations[faction.factionId] ?? 0);
        wars.push({
          a: FACTION_BY_ID[faction.factionId]?.name ?? faction.factionId,
          b: FACTION_BY_ID[enemyId]?.name ?? enemyId,
          sinceBalance: round2(balance / 2),
        });
      }
    }
  }
  const controllerId = state.world.locations[state.player.locationId]?.controllingFactionId ?? null;
  const controller = controllerId ? FACTION_BY_ID[controllerId] : null;
  return {
    total: views.length,
    wars,
    controllerHere: controller && controllerId ? { id: controllerId, name: controller.name, kind: KIND_LABELS[controller.kind] } : null,
    territoryChanges30d: counter(state, 'territory_changes'),
    bestStanding: views.length > 0 ? { name: views[0]!.name, standing: views[0]!.playerStanding } : null,
    worstStanding: views.length > 0 ? { name: views[views.length - 1]!.name, standing: views[views.length - 1]!.playerStanding } : null,
    offersOpen: views.reduce((s, v) => s + v.offers.length, 0),
    tributeDemands: views.filter((v) => v.tributeOwed > 0).length,
    servicesAvailable: views.filter((v) => v.canUseServices).flatMap((v) => v.services.map((service) => ({ faction: v.name, service }))),
    factionPressure: round2(
      clamp(
        views.filter((v) => v.controlsCurrentLocation).reduce((s, v) => s + (1 - v.playerStanding / 100) * v.aggression, 0) +
          state.player.reputation.heat / 200,
        0,
        3,
      ),
    ),
  };
}

/** Which factions are interested in a commodity category (UI explanation). */
export function factionsInterestedIn(category: string): { id: ID; name: string; power: number }[] {
  return FACTIONS.filter((f) => f.interests.includes(category as never)).map((f) => ({ id: f.id, name: f.name, power: f.power }));
}

/** Commodity categories a faction's territory demand is tilted toward. */
export function factionInterestSummary(factionId: ID): { category: string; commodities: number; exampleValue: number }[] {
  const def = FACTION_BY_ID[factionId];
  if (!def) return [];
  return def.interests.map((category) => {
    const items = registry.all().filter((c) => c.category === category);
    return {
      category,
      commodities: items.length,
      exampleValue: items.length > 0 ? round2(items.reduce((s, c) => s + c.baseValue, 0) / items.length) : 0,
    };
  });
}
