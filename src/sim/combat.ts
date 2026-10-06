/**
 * Combat — hybrid resolution (spec §23).
 *
 * Routine encounters (a patrol, a mugging, a debt collector) auto-resolve in a
 * single deterministic roll so the game keeps moving. Major encounters (raids,
 * faction war, bosses, pursuits) open a turn-based tactical engagement on a
 * grid where the player spends action points, takes cover, flees, intimidates,
 * negotiates or bribes.
 *
 * Both paths run the *same* mechanics (`runRound`), so auto-resolution is a
 * faithful simulation of the fight rather than a separate formula — and the
 * outcome is never decided by the client. Every action reports its success
 * chance before it is taken, because the UI must explain *why* things happened.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { ENCOUNTER_TABLES, ENEMY_BY_ID, ENEMIES } from '../engine/registry/people';
import { getWorldRegistry } from '../engine/registry/world';
import { addItem, quantityOnHand, removeCommodity } from './inventory';
import {
  actionPointBonus,
  bribeBonus,
  combatAccuracyBonus,
  combatDamageBonus,
  fleeBonus,
  intimidationBonus,
  lossReduction,
} from './modifiers';
import { recordObjective } from './missions';
import { bumpCounter, counter, grantXp, playerModifiers } from './progression';
import { addHeat, changeReputation } from './reputation';
import {
  buildEnding,
  computeNetWorth,
  creditCash,
  debitCash,
  formatMoney,
  newId,
  pushDiagnostic,
  pushNotification,
  round2,
} from './state';
import type {
  ActiveCombat,
  Combatant,
  CombatLogEntry,
  CombatOutcome,
  CombatStakes,
  EmployeeInstance,
  EnemyDef,
  GameState,
  ID,
  ReputationDimension,
} from './types';

const B = getBalance();
const registry = getCommodityRegistry();
const worldReg = getWorldRegistry();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ------------------------------------------------------------------ */
/* Combatant construction                                              */
/* ------------------------------------------------------------------ */

const COMBAT_ROLES: EmployeeInstance['role'][] = ['security', 'mercenary', 'fixer', 'driver'];

/** Best weapon the player is actually carrying, and the damage it implies. */
export function equippedWeapon(state: GameState): { name: string; damage: [number, number]; commodityId: ID | null } {
  let best: { name: string; value: number; id: ID } | null = null;
  for (const stack of state.player.inventory) {
    const c = registry.get(stack.commodityId);
    if (!c) continue;
    if (c.category !== 'weapon' && !c.tags.includes('weapon')) continue;
    if (quantityOnHand(state, c.id) <= 0) continue;
    if (!best || c.baseValue > best.value) best = { name: c.name, value: c.baseValue, id: c.id };
  }
  if (!best) return { name: 'Fists', damage: [4, 9], commodityId: null };
  // Damage scales logarithmically with the weapon's value so a pistol is meaningfully
  // better than a knife but cannot one-shot an armoured unit.
  const base = 8 + Math.log10(Math.max(10, best.value)) * 6;
  return {
    name: best.name,
    damage: [Math.round(base * 0.72), Math.round(base * 1.28)],
    commodityId: best.id,
  };
}

export function playerCombatant(state: GameState): Combatant {
  const mods = playerModifiers(state);
  const stats = state.player.stats;
  const weapon = equippedWeapon(state);
  const dmgBonus = combatDamageBonus(mods);
  return {
    id: 'player',
    name: state.player.name,
    side: 'player',
    hp: Math.max(1, Math.round(stats.health)),
    maxHp: Math.max(1, Math.round(stats.maxHealth)),
    actionPoints: Math.max(1, Math.round(B.combat.playerBaseActionPoints + actionPointBonus(mods))),
    maxActionPoints: Math.max(1, Math.round(B.combat.playerBaseActionPoints + actionPointBonus(mods))),
    accuracy: round2(clamp(B.combat.accuracyBase + combatAccuracyBonus(mods) + mods.skill('tactics') * 0.005, 0.08, 0.95)),
    damage: [Math.max(1, Math.round(weapon.damage[0] * (1 + dmgBonus))), Math.max(2, Math.round(weapon.damage[1] * (1 + dmgBonus)))],
    defense: round2(clamp(B.combat.defenseBase + mods.skill('tactics') * 0.006 + mods.get('combat.defenseBonus'), 0.02, 0.8)),
    speed: 5 + Math.round(mods.skill('combat') * 0.15),
    position: { x: 1, y: 4 },
    cover: false,
    statusEffects: [],
    alive: true,
    morale: 100,
  };
}

function crewCombatant(emp: EmployeeInstance, index: number): Combatant {
  const toughness = emp.stats.toughness / 100;
  const skill = emp.stats.skill / 100;
  return {
    id: emp.id,
    name: emp.name,
    side: 'ally',
    hp: Math.round(50 + toughness * 90),
    maxHp: Math.round(50 + toughness * 90),
    actionPoints: emp.role === 'mercenary' ? 3 : 2,
    maxActionPoints: emp.role === 'mercenary' ? 3 : 2,
    accuracy: round2(clamp(0.34 + skill * 0.36 + (emp.stats.morale / 100) * 0.08, 0.1, 0.9)),
    damage: [Math.round(7 + skill * 12), Math.round(13 + skill * 20)],
    defense: round2(clamp(0.1 + toughness * 0.3, 0.02, 0.6)),
    speed: 4 + Math.round(emp.stats.initiative / 25),
    position: { x: 1, y: 2 + index * 2 },
    cover: false,
    statusEffects: [],
    employeeId: emp.id,
    alive: true,
    morale: emp.stats.morale,
  };
}

/** Crew who would actually fight for you right now (present, loyal, uninjured). */
export function availableAllies(state: GameState, limit = 4): EmployeeInstance[] {
  return state.player.crew
    .filter((e) => e.status === 'active' && !e.injured && e.locationId === state.player.locationId)
    .filter((e) => COMBAT_ROLES.includes(e.role))
    .filter((e) => e.stats.loyalty >= 25)
    .sort((a, b) => b.stats.skill + b.stats.toughness - (a.stats.skill + a.stats.toughness))
    .slice(0, limit);
}

function scaleEnemy(def: EnemyDef, state: GameState, rng: Rng, index: number): Combatant {
  const levelScale = 1 + B.combat.enemyScalingPerPlayerLevel * Math.max(0, state.player.progression.level - 1);
  const tierMul = def.tier === 'boss' ? B.combat.bossMultiplier : def.tier === 'elite' ? B.combat.eliteMultiplier : 1;
  const difficulty = state.config.difficultyModifiers.combatDifficultyMultiplier;
  const hp = Math.round(def.hp * levelScale * tierMul * difficulty * rng.float(0.92, 1.08));
  const jitter = rng.float(0.94, 1.06);
  return {
    id: `enemy_${index}_${def.id}`,
    name: def.name,
    side: 'enemy',
    hp,
    maxHp: hp,
    actionPoints: Math.max(1, Math.round(def.actionPoints * (def.tier === 'boss' ? 1.4 : 1))),
    maxActionPoints: Math.max(1, Math.round(def.actionPoints * (def.tier === 'boss' ? 1.4 : 1))),
    accuracy: round2(clamp(def.accuracy * jitter * difficulty, 0.05, 0.94)),
    damage: [Math.max(1, Math.round(def.damage[0] * levelScale * jitter)), Math.max(2, Math.round(def.damage[1] * levelScale * jitter))],
    defense: round2(clamp(def.defense * tierMul * 0.8, 0, 0.75)),
    speed: def.speed,
    position: { x: 9 + (index % 2), y: 1 + index * 2 },
    cover: false,
    statusEffects: [],
    enemyDefId: def.id,
    alive: true,
    morale: def.tier === 'boss' ? 100 : 70,
  };
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

export interface CombatSetup {
  kind: ActiveCombat['kind'];
  table: string;
  enemyCount: [number, number];
  stakes: 'low' | 'medium' | 'high';
  reason: string;
  locationId?: ID;
  defendedPropertyId?: ID | null;
  defendedShipmentId?: ID | null;
  canFlee?: boolean;
  canNegotiate?: boolean;
  canBribe?: boolean;
  bribeAmount?: number;
  /** Deterministic label; the encounter is reproducible for a given seed. */
  seedLabel?: string;
}

const STAKE_PROFILE: Record<'low' | 'medium' | 'high', { cash: number; inventory: number; arrest: number; injury: number; death: number; xp: number }> = {
  low: { cash: 0.04, inventory: 0.08, arrest: 0.12, injury: 0.3, death: 0.01, xp: 1 },
  medium: { cash: 0.12, inventory: 0.25, arrest: B.combat.arrestChanceOnDefeat, injury: B.combat.injuryChanceOnDefeat, death: 0.05, xp: 1.6 },
  high: { cash: 0.3, inventory: 0.6, arrest: 0.72, injury: 0.85, death: B.combat.deathChanceOnDefeatInWarzone, xp: 2.6 },
};

function buildStakes(state: GameState, rng: Rng, setup: CombatSetup, enemies: EnemyDef[]): CombatStakes {
  const profile = STAKE_PROFILE[setup.stakes];
  const mods = playerModifiers(state);
  const reduction = lossReduction(mods);
  const cash = round2(
    (setup.kind === 'police' || setup.kind === 'raid'
      ? Math.max(0, state.player.accounts.reduce((s, a) => s + a.dirtyBalance, 0)) * B.enforcement.fineFractionOfDirtyCash
      : totalCash(state) * profile.cash) *
      (1 - reduction),
  );
  const xpReward = Math.round(enemies.reduce((s, e) => s + (e.lootTable[0]?.xp ?? 24), 0) * profile.xp);
  const isLaw = setup.kind === 'police' || setup.kind === 'raid';
  return {
    lossCash: round2(cash),
    lossInventoryFraction: round2(profile.inventory * (1 - reduction)),
    arrestChance: round2(clamp(profile.arrest * (isLaw ? 1 : 0.25) * state.config.difficultyModifiers.enforcementMultiplier, 0, 0.95)),
    injuryChance: round2(clamp(profile.injury * (1 - reduction * 0.5), 0, 0.98)),
    deathChance: round2(clamp(profile.death * (setup.kind === 'faction_war' || setup.kind === 'ambush' ? 1.6 : 1) * (1 - reduction * 0.5), 0, 0.6)),
    xpReward,
    reputationReward: isLaw
      ? [{ dimension: 'criminal' as ReputationDimension, amount: 3 }, { dimension: 'legal' as ReputationDimension, amount: -5 }]
      : [{ dimension: 'criminal' as ReputationDimension, amount: 4 }, { dimension: 'crew' as ReputationDimension, amount: 2 }],
    loot: enemies.flatMap((e) => e.lootTable.map((l) => ({ ...(l.commodityId ? { commodityId: l.commodityId } : {}), ...(l.cash ? { cash: rng.int(l.cash[0], l.cash[1]) } : {}) }))),
    defendedPropertyId: setup.defendedPropertyId ?? null,
    defendedShipmentId: setup.defendedShipmentId ?? null,
  };
}

function totalCash(state: GameState): number {
  return state.player.accounts.reduce((s, a) => s + a.balance, 0);
}

export function pickEnemies(rng: Rng, table: string, count: [number, number]): EnemyDef[] {
  const ids = ENCOUNTER_TABLES[table] ?? ENCOUNTER_TABLES.rival_territory ?? [];
  const n = clamp(rng.int(count[0], count[1]), 1, 8);
  const out: EnemyDef[] = [];
  for (let i = 0; i < n; i += 1) {
    const id = ids.length > 0 ? rng.pick(ids) : rng.pick(ENEMIES)?.id;
    const def = id ? ENEMY_BY_ID[id] : undefined;
    if (def) out.push(def);
  }
  return out.length > 0 ? out : [ENEMIES[0]!];
}

export function shouldAutoResolve(state: GameState, enemyCount: number, kind: ActiveCombat['kind']): boolean {
  const mode = state.player.settings.combatMode;
  if (mode === 'tactical') return false;
  if (mode === 'auto') return true;
  // 'ask' → routine encounters auto-resolve, major ones prompt the player.
  const major: ActiveCombat['kind'][] = ['raid', 'faction_war', 'boss', 'pursuit'];
  return !major.includes(kind) && enemyCount <= B.combat.autoResolveThresholdEnemies;
}

export interface CombatResult {
  ok: boolean;
  code?: string;
  reason?: string;
  combat: ActiveCombat;
  outcome: CombatOutcome | null;
  finished: boolean;
  log: CombatLogEntry[];
  playerHp: number;
  warnings: string[];
}

export function startCombat(state: GameState, rng: Rng, setup: CombatSetup): CombatResult {
  if (state.player.combat && state.player.combat.phase === 'active') {
    return {
      ok: false,
      code: 'combat_in_progress',
      reason: 'You are already in a fight.',
      combat: state.player.combat,
      outcome: null,
      finished: false,
      log: state.player.combat.log,
      playerHp: state.player.stats.health,
      warnings: [],
    };
  }
  if (state.player.prison.incarcerated) {
    return emptyCombatResult(state, 'incarcerated', 'You are in prison.');
  }

  const locationId = setup.locationId ?? state.player.locationId;
  const enemyDefs = pickEnemies(rng, setup.table, setup.enemyCount);
  const participants: Combatant[] = [playerCombatant(state)];
  availableAllies(state).forEach((emp, i) => participants.push(crewCombatant(emp, i)));
  enemyDefs.forEach((def, i) => participants.push(scaleEnemy(def, state, rng, i)));

  const stakes = buildStakes(state, rng, setup, enemyDefs);
  const isLaw = enemyDefs.some((e) => e.archetype === 'police' || e.archetype === 'inspector' || e.archetype === 'swat');
  const combat: ActiveCombat = {
    id: newId(rng, 'cbt'),
    kind: setup.kind,
    locationId,
    startedDay: state.world.day,
    turn: 1,
    phase: 'active',
    participants,
    grid: { width: 12, height: 8 },
    log: [],
    stakes,
    enemyGroupId: setup.table,
    canFlee: setup.canFlee ?? setup.kind !== 'raid',
    canNegotiate: setup.canNegotiate ?? (isLaw ? enemyDefs.some((e) => e.negotiable > 0.3) : true),
    canBribe: setup.canBribe ?? (isLaw && worldReg.requireLocation(locationId).laws.corruption > 0.25),
    bribeAmount: setup.bribeAmount ?? Math.max(120, Math.round(stakes.lossCash * 1.4 + computeNetWorth(state).total * 0.01)),
    outcome: null,
    autoResolved: false,
    seed: `${state.config.worldSeed}:${setup.seedLabel ?? setup.table}:${state.world.day}`,
  };

  pushLog(combat, {
    turn: 1,
    actorId: 'system',
    actorName: 'Encounter',
    action: 'start',
    targetId: null,
    targetName: null,
    damage: 0,
    detail: `${setup.reason} — ${enemyDefs.length} × ${enemyDefs.map((e) => e.name).join(', ')}.`,
    critical: false,
  });

  state.player.combat = combat;
  pushDiagnostic(state, {
    system: 'combat',
    level: 'info',
    message: `Combat started (${setup.kind}, ${setup.table}): ${enemyDefs.length} enemies, stakes arrest=${stakes.arrestChance} cash=${stakes.lossCash}`,
    data: { kind: setup.kind, enemies: enemyDefs.length, arrest: stakes.arrestChance },
  });

  if (shouldAutoResolve(state, enemyDefs.length, setup.kind)) {
    combat.autoResolved = true;
    return autoResolve(state, rng);
  }
  return {
    ok: true,
    combat,
    outcome: null,
    finished: false,
    log: combat.log,
    playerHp: state.player.stats.health,
    warnings: ['Tactical engagement — choose your actions.'],
  };
}

/**
 * A well-formed, already-resolved combat with no participants.
 *
 * Callers that refuse an engagement (player incarcerated, no escape, bribe
 * rejected) still owe the API a complete `CombatResult`, and an event effect can
 * legitimately try to start a fight against a player who is in prison and has no
 * combat object at all. Throwing there would take the whole request handler down
 * for a reachable game state, so every path returns a stub instead.
 */
function combatStub(state: GameState): ActiveCombat {
  return {
    id: 'none',
    kind: 'ambush',
    locationId: state.player.locationId,
    startedDay: state.world.day,
    turn: 0,
    phase: 'resolved',
    participants: [],
    grid: { width: 12, height: 8 },
    log: [],
    stakes: { lossCash: 0, lossInventoryFraction: 0, arrestChance: 0, injuryChance: 0, deathChance: 0, xpReward: 0, reputationReward: [], loot: [], defendedPropertyId: null, defendedShipmentId: null },
    enemyGroupId: 'none',
    canFlee: false,
    canNegotiate: false,
    canBribe: false,
    bribeAmount: 0,
    outcome: null,
    autoResolved: true,
    seed: state.config.worldSeed,
  };
}

function emptyCombatResult(state: GameState, code: string, reason: string): CombatResult {
  const combat = state.player.combat ?? combatStub(state);
  return { ok: false, code, reason, combat, outcome: combat.outcome, finished: combat.phase === 'resolved', log: combat.log, playerHp: state.player.stats.health, warnings: [] };
}

function pushLog(combat: ActiveCombat, entry: Omit<CombatLogEntry, 'turn'> & { turn?: number }): void {
  combat.log.push({ turn: entry.turn ?? combat.turn, ...entry });
  if (combat.log.length > 240) combat.log.splice(0, combat.log.length - 240);
}

function alive(combat: ActiveCombat, side: Combatant['side']): Combatant[] {
  return combat.participants.filter((p) => p.alive && p.hp > 0 && (side === 'enemy' ? p.side === 'enemy' : p.side !== 'enemy'));
}

function distance(a: Combatant, b: Combatant): number {
  return Math.abs(a.position.x - b.position.x) + Math.abs(a.position.y - b.position.y);
}

/* ------------------------------------------------------------------ */
/* Round mechanics (shared by tactical and auto play)                   */
/* ------------------------------------------------------------------ */

interface AttackResult {
  hit: boolean;
  damage: number;
  critical: boolean;
  killed: boolean;
}

function attack(combat: ActiveCombat, rng: Rng, attacker: Combatant, target: Combatant): AttackResult {
  const coverPenalty = target.cover ? B.combat.coverBonus : 0;
  const rangePenalty = clamp(distance(attacker, target) * 0.012, 0, 0.18);
  const chance = clamp(attacker.accuracy - coverPenalty - rangePenalty - target.defense * 0.35, 0.03, 0.95);
  if (!rng.chance(chance)) {
    pushLog(combat, {
      actorId: attacker.id,
      actorName: attacker.name,
      action: 'attack',
      targetId: target.id,
      targetName: target.name,
      damage: 0,
      detail: `Missed (${(chance * 100).toFixed(0)}% chance).`,
      critical: false,
    });
    return { hit: false, damage: 0, critical: false, killed: false };
  }
  const critical = rng.chance(B.combat.critChanceBase);
  const raw = rng.int(attacker.damage[0], attacker.damage[1]);
  const mitigation = clamp(target.defense + coverPenalty * 0.5, 0, 0.85);
  const damage = Math.max(1, Math.round(raw * (1 - mitigation) * (critical ? B.combat.critMultiplier : 1) * rng.float(1 - B.combat.damageVariance, 1 + B.combat.damageVariance)));
  target.hp = Math.max(0, target.hp - damage);
  const killed = target.hp <= 0;
  if (killed) {
    target.alive = false;
    target.statusEffects.push({ id: 'down', name: 'Down', turnsRemaining: 99, modifiers: {} });
  }
  pushLog(combat, {
    actorId: attacker.id,
    actorName: attacker.name,
    action: critical ? 'critical' : 'attack',
    targetId: target.id,
    targetName: target.name,
    damage,
    detail: killed ? `${target.name} is down.` : `${target.name} at ${target.hp}/${target.maxHp} HP.`,
    critical,
  });
  return { hit: true, damage, critical, killed };
}

function moveToward(combat: ActiveCombat, actor: Combatant, target: Combatant, steps: number): void {
  for (let i = 0; i < steps; i += 1) {
    const dx = Math.sign(target.position.x - actor.position.x);
    const dy = Math.sign(target.position.y - actor.position.y);
    const nx = clamp(actor.position.x + (Math.abs(target.position.x - actor.position.x) >= Math.abs(target.position.y - actor.position.y) ? dx : 0), 0, combat.grid.width - 1);
    const ny = clamp(actor.position.y + (Math.abs(target.position.x - actor.position.x) >= Math.abs(target.position.y - actor.position.y) ? 0 : dy), 0, combat.grid.height - 1);
    const occupied = combat.participants.some((p) => p.alive && p.id !== actor.id && p.position.x === nx && p.position.y === ny);
    if (!occupied) {
      actor.position = { x: nx, y: ny };
    }
    if (distance(actor, target) <= 1) break;
  }
}

/** One full round: player side acts (per supplied orders), then enemies react. */
export interface RoundOrders {
  playerId?: ID;
  actions?: TacticalAction[];
}

function runRound(state: GameState, rng: Rng, combat: ActiveCombat, orders: RoundOrders = {}): void {
  // Player-side actors act first (initiative by speed).
  const friendly = alive(combat, 'player').sort((a, b) => b.speed - a.speed);
  for (const actor of friendly) {
    if (!actor.alive) continue;
    let ap = actor.maxActionPoints;
    if (actor.id === 'player' && orders.actions) {
      for (const action of orders.actions) {
        if (ap <= 0) break;
        ap -= applyPlayerAction(state, rng, combat, actor, action, ap);
      }
      continue;
    }
    // Allied crew fight automatically: close, attack, take cover when hurt.
    while (ap > 0) {
      const enemies = alive(combat, 'enemy');
      if (enemies.length === 0) break;
      const target = enemies.sort((a, b) => distance(actor, a) - distance(actor, b))[0]!;
      if (distance(actor, target) > 2) {
        moveToward(combat, actor, target, 3);
        ap -= 1;
        continue;
      }
      attack(combat, rng, actor, target);
      ap -= 1;
      if (actor.hp < actor.maxHp * 0.35 && !actor.cover) {
        actor.cover = true;
        pushLog(combat, { actorId: actor.id, actorName: actor.name, action: 'cover', targetId: null, targetName: null, damage: 0, detail: 'Takes cover.', critical: false });
      }
    }
  }

  if (alive(combat, 'enemy').length === 0) return;

  // Enemy side.
  const enemies = alive(combat, 'enemy').sort((a, b) => b.speed - a.speed);
  for (const actor of enemies) {
    if (!actor.alive) continue;
    let ap = actor.maxActionPoints;
    while (ap > 0) {
      const targets = alive(combat, 'player');
      if (targets.length === 0) break;
      // Prefer the player, but shoot whichever ally is closest when blocked.
      const target = targets.sort((a, b) => (a.id === 'player' ? -2 : 0) + distance(actor, a) - ((b.id === 'player' ? -2 : 0) + distance(actor, b)))[0]!;
      if (distance(actor, target) > 3) {
        moveToward(combat, actor, target, 2);
        ap -= 1;
        continue;
      }
      attack(combat, rng, actor, target);
      ap -= 1;
    }
    // Morale: normal enemies break when half their group is down.
    const def = actor.enemyDefId ? ENEMY_BY_ID[actor.enemyDefId] : undefined;
    const totalEnemies = combat.participants.filter((p) => p.side === 'enemy').length;
    const downed = combat.participants.filter((p) => p.side === 'enemy' && !p.alive).length;
    if (def && def.tier === 'normal' && downed / Math.max(1, totalEnemies) >= 0.5 && rng.chance(0.35)) {
      actor.alive = false;
      actor.hp = 0;
      pushLog(combat, { actorId: actor.id, actorName: actor.name, action: 'flee', targetId: null, targetName: null, damage: 0, detail: `${actor.name} breaks and runs.`, critical: false });
    }
  }

  combat.turn += 1;
  for (const p of combat.participants) {
    for (const effect of p.statusEffects) effect.turnsRemaining -= 1;
    p.statusEffects = p.statusEffects.filter((e) => e.turnsRemaining > 0);
  }
}

/* ------------------------------------------------------------------ */
/* Tactical actions                                                    */
/* ------------------------------------------------------------------ */

export type TacticalAction =
  | { type: 'attack'; targetId: ID }
  | { type: 'move'; x: number; y: number }
  | { type: 'cover' }
  | { type: 'flee' }
  | { type: 'negotiate' }
  | { type: 'intimidate' }
  | { type: 'bribe'; amount: number }
  | { type: 'useItem'; commodityId: ID }
  | { type: 'wait' };

export interface ActionEstimate {
  action: TacticalAction;
  label: string;
  apCost: number;
  successChance: number;
  expectedValue: string;
  available: boolean;
  reason?: string;
}

/**
 * Pre-computed odds for every action the player could take — the UI shows these
 * so a decision is informed rather than a guess (spec §40).
 */
export function actionEstimates(state: GameState, combat: ActiveCombat): ActionEstimate[] {
  const player = combat.participants.find((p) => p.id === 'player');
  if (!player || !player.alive) return [];
  const enemies = alive(combat, 'enemy');
  const out: ActionEstimate[] = [];

  for (const e of enemies.slice(0, 6)) {
    const coverPenalty = e.cover ? B.combat.coverBonus : 0;
    const rangePenalty = clamp(distance(player, e) * 0.012, 0, 0.18);
    const chance = clamp(player.accuracy - coverPenalty - rangePenalty - e.defense * 0.35, 0.03, 0.95);
    const avgDamage = Math.round(((player.damage[0] + player.damage[1]) / 2) * (1 - clamp(e.defense + coverPenalty * 0.5, 0, 0.85)));
    out.push({
      action: { type: 'attack', targetId: e.id },
      label: `Attack ${e.name} (${e.hp}/${e.maxHp} HP)`,
      apCost: 1,
      successChance: round2(chance),
      expectedValue: `~${avgDamage} damage${e.hp <= avgDamage ? ' — likely kill' : ''}`,
      available: player.actionPoints >= 1,
      ...(player.actionPoints >= 1 ? {} : { reason: 'Not enough action points' }),
    });
  }

  out.push({
    action: { type: 'cover' },
    label: player.cover ? 'Already in cover' : 'Take cover',
    apCost: 1,
    successChance: 1,
    expectedValue: `−${Math.round(B.combat.coverBonus * 100)}% enemy hit chance against you`,
    available: !player.cover && player.actionPoints >= 1,
    ...(player.cover ? { reason: 'Already in cover' } : {}),
  });

  out.push({
    action: { type: 'move', x: clamp(player.position.x + 2, 0, combat.grid.width - 1), y: player.position.y },
    label: 'Advance 2 tiles',
    apCost: 1,
    successChance: 1,
    expectedValue: 'Closes distance (less range penalty)',
    available: player.actionPoints >= 1,
  });

  const fleeOdds = fleeChance(state, combat);
  out.push({
    action: { type: 'flee' },
    label: 'Flee the encounter',
    apCost: player.maxActionPoints,
    successChance: fleeOdds,
    expectedValue: fleeOdds >= 0.5 ? 'Likely escape with your cargo' : 'Risky — failure means a free enemy volley',
    available: combat.canFlee && player.actionPoints >= 1,
    ...(combat.canFlee ? {} : { reason: 'There is no way out of this fight' }),
  });

  if (combat.canNegotiate) {
    const chance = negotiateChance(state, combat);
    out.push({
      action: { type: 'negotiate' },
      label: 'Negotiate / talk them down',
      apCost: 1,
      successChance: chance,
      expectedValue: 'Ends the encounter without a fight (small reputation cost with rivals)',
      available: player.actionPoints >= 1,
    });
    out.push({
      action: { type: 'intimidate' },
      label: 'Intimidate',
      apCost: 1,
      successChance: intimidateChance(state, combat),
      expectedValue: 'Enemies may break and flee',
      available: player.actionPoints >= 1,
    });
  }
  if (combat.canBribe) {
    const chance = bribeChance(state, combat, combat.bribeAmount);
    out.push({
      action: { type: 'bribe', amount: combat.bribeAmount },
      label: `Bribe (${formatMoney(combat.bribeAmount)})`,
      apCost: 1,
      successChance: chance,
      expectedValue: chance > 0.5 ? 'Likely walks away, no seizure' : 'May take the money and arrest you anyway',
      available: player.actionPoints >= 1 && totalCash(state) >= combat.bribeAmount,
      ...(totalCash(state) >= combat.bribeAmount ? {} : { reason: 'Not enough cash' }),
    });
  }

  const medkit = findMedicine(state);
  if (medkit) {
    out.push({
      action: { type: 'useItem', commodityId: medkit.commodityId },
      label: `Use ${medkit.name}`,
      apCost: 1,
      successChance: 1,
      expectedValue: `+${medkit.heal} HP`,
      available: player.actionPoints >= 1,
    });
  }

  out.push({ action: { type: 'wait' }, label: 'Hold position (end turn)', apCost: 0, successChance: 1, expectedValue: 'Passes the turn', available: true });
  return out;
}

function applyPlayerAction(state: GameState, rng: Rng, combat: ActiveCombat, player: Combatant, action: TacticalAction, ap: number): number {
  switch (action.type) {
    case 'attack': {
      const target = combat.participants.find((p) => p.id === action.targetId && p.alive);
      if (!target || ap < 1) return 0;
      attack(combat, rng, player, target);
      return 1;
    }
    case 'move': {
      if (ap < 1) return 0;
      const x = clamp(action.x, 0, combat.grid.width - 1);
      const y = clamp(action.y, 0, combat.grid.height - 1);
      const occupied = combat.participants.some((p) => p.alive && p.id !== player.id && p.position.x === x && p.position.y === y);
      if (!occupied) {
        player.position = { x, y };
        player.cover = false;
        pushLog(combat, { actorId: player.id, actorName: player.name, action: 'move', targetId: null, targetName: null, damage: 0, detail: `Moves to (${x}, ${y}).`, critical: false });
      }
      return 1;
    }
    case 'cover': {
      if (ap < 1 || player.cover) return 0;
      player.cover = true;
      pushLog(combat, { actorId: player.id, actorName: player.name, action: 'cover', targetId: null, targetName: null, damage: 0, detail: 'Takes cover.', critical: false });
      return 1;
    }
    case 'useItem': {
      if (ap < 1) return 0;
      const med = findMedicine(state, action.commodityId);
      if (!med) return 0;
      removeCommodity(state, med.commodityId, 1, state.player.locationId);
      player.hp = Math.min(player.maxHp, player.hp + med.heal);
      state.player.stats.health = player.hp;
      pushLog(combat, { actorId: player.id, actorName: player.name, action: 'item', targetId: null, targetName: null, damage: -med.heal, detail: `Uses ${med.name}: +${med.heal} HP.`, critical: false });
      return 1;
    }
    case 'wait':
      return 0;
    default:
      // flee / negotiate / intimidate / bribe are handled at the action layer
      // because they end the encounter rather than consume the round.
      return 0;
  }
}

export function fleeChance(state: GameState, combat: ActiveCombat): number {
  const player = combat.participants.find((p) => p.id === 'player');
  const mods = playerModifiers(state);
  const enemies = alive(combat, 'enemy');
  const speedEdge = (player?.speed ?? 5) - enemies.reduce((s, e) => s + e.speed, 0) / Math.max(1, enemies.length);
  return round2(
    clamp(
      B.combat.fleeBaseChance + speedEdge * B.combat.fleeChancePerSpeed * 10 + fleeBonus(mods) - enemies.length * 0.06,
      0.05,
      0.95,
    ),
  );
}

export function negotiateChance(state: GameState, combat: ActiveCombat): number {
  const mods = playerModifiers(state);
  const enemies = alive(combat, 'enemy');
  const negotiable = enemies.reduce((s, e) => s + (e.enemyDefId ? ENEMY_BY_ID[e.enemyDefId]?.negotiable ?? 0.2 : 0.2), 0) / Math.max(1, enemies.length);
  const heatPenalty = clamp(state.player.reputation.heat / 400, 0, 0.2);
  return round2(clamp(B.combat.negotiationBase + negotiable * 0.5 + mods.skill('negotiation') * 0.018 - heatPenalty - enemies.length * 0.04, 0.03, 0.92));
}

export function intimidateChance(state: GameState, combat: ActiveCombat): number {
  const mods = playerModifiers(state);
  const enemies = alive(combat, 'enemy');
  const rep = state.player.reputation.dimensions.criminal / 200;
  const weapon = equippedWeapon(state).commodityId !== null ? 0.12 : 0;
  const crew = alive(combat, 'ally').length * 0.05;
  return round2(clamp(B.combat.intimidationBase + intimidationBonus(mods) + rep + weapon + crew - enemies.length * 0.05, 0.02, 0.9));
}

export function bribeChance(state: GameState, combat: ActiveCombat, amount: number): number {
  const mods = playerModifiers(state);
  const loc = worldReg.location(combat.locationId);
  const corruption = loc?.laws.corruption ?? 0.3;
  const enemies = alive(combat, 'enemy');
  const negotiable = enemies.reduce((s, e) => s + (e.enemyDefId ? ENEMY_BY_ID[e.enemyDefId]?.negotiable ?? 0.2 : 0.2), 0) / Math.max(1, enemies.length);
  const scale = clamp(Math.log10(Math.max(100, amount) / 500) * 0.28, -0.2, 0.45);
  return round2(clamp(B.combat.briberyBase + corruption * 0.4 + negotiable * 0.25 + scale + bribeBonus(mods), 0.02, 0.95));
}

function findMedicine(state: GameState, commodityId?: ID): { commodityId: ID; name: string; heal: number } | null {
  const candidates = state.player.inventory
    .map((s) => registry.get(s.commodityId))
    .filter((c): c is NonNullable<typeof c> => c !== undefined && (c.category === 'medical' || c.category === 'pharmaceutical'))
    .filter((c) => c.tags.some((t) => t.includes('trauma') || t.includes('medical') || t.includes('first_aid')) || c.name.toLowerCase().includes('kit') || c.name.toLowerCase().includes('trauma'))
    .filter((c) => (commodityId ? c.id === commodityId : true));
  const best = candidates.sort((a, b) => b.baseValue - a.baseValue)[0];
  if (!best) return null;
  return { commodityId: best.id, name: best.name, heal: Math.round(clamp(12 + Math.log10(Math.max(10, best.baseValue)) * 12, 10, 70)) };
}

/* ------------------------------------------------------------------ */
/* Player-facing turn API                                              */
/* ------------------------------------------------------------------ */

export function takeTurn(state: GameState, rng: Rng, actions: TacticalAction[]): CombatResult {
  const combat = state.player.combat;
  if (!combat || combat.phase !== 'active') return emptyCombatResultOrError(state, 'no_combat', 'There is no active encounter.');

  // Terminal actions end the encounter outright.
  for (const action of actions) {
    if (action.type === 'flee') return attemptFlee(state, rng);
    if (action.type === 'negotiate') return attemptNegotiate(state, rng);
    if (action.type === 'intimidate') return attemptIntimidate(state, rng);
    if (action.type === 'bribe') return attemptBribe(state, rng, action.amount);
  }

  const player = combat.participants.find((p) => p.id === 'player');
  if (!player) return emptyCombatResultOrError(state, 'no_player', 'Combat state is corrupted.');
  player.actionPoints = player.maxActionPoints;
  runRound(state, rng, combat, { actions });
  return finishOrContinue(state, rng, combat);
}

function emptyCombatResultOrError(state: GameState, code: string, reason: string): CombatResult {
  return emptyCombatResult(state, code, reason);
}

/** Auto-resolve the whole fight round by round using the same mechanics. */
export function autoResolve(state: GameState, rng: Rng): CombatResult {
  const combat = state.player.combat;
  if (!combat || combat.phase !== 'active') return emptyCombatResultOrError(state, 'no_combat', 'There is no active encounter.');
  combat.autoResolved = true;
  let guard = 0;
  while (combat.phase === 'active' && guard < B.combat.turnLimit) {
    const player = combat.participants.find((p) => p.id === 'player');
    if (player) player.actionPoints = player.maxActionPoints;
    runRound(state, rng, combat, {});
    const result = finishOrContinue(state, rng, combat);
    if (result.finished) return result;
    guard += 1;
  }
  // Turn limit reached: the side with more remaining HP fraction wins the attrition.
  const friendlyHp = alive(combat, 'player').reduce((s, p) => s + p.hp / p.maxHp, 0);
  const enemyHp = alive(combat, 'enemy').reduce((s, p) => s + p.hp / p.maxHp, 0);
  return conclude(state, rng, combat, friendlyHp >= enemyHp ? 'victory' : 'defeat', 'The engagement stalled and both sides withdrew.');
}

function finishOrContinue(state: GameState, rng: Rng, combat: ActiveCombat): CombatResult {
  const playerDown = !combat.participants.some((p) => p.id === 'player' && p.alive && p.hp > 0);
  const enemiesDown = alive(combat, 'enemy').length === 0;
  if (enemiesDown) return conclude(state, rng, combat, 'victory', 'All opponents are down.');
  if (playerDown) return conclude(state, rng, combat, 'defeat', 'You are down.');
  if (combat.turn > B.combat.turnLimit) return conclude(state, rng, combat, 'defeat', 'The fight dragged on and reinforcements arrived.');
  return {
    ok: true,
    combat,
    outcome: null,
    finished: false,
    log: combat.log.slice(-40),
    playerHp: combat.participants.find((p) => p.id === 'player')?.hp ?? 0,
    warnings: [],
  };
}

/* ------------------------------------------------------------------ */
/* Non-violent resolutions                                             */
/* ------------------------------------------------------------------ */

function attemptFlee(state: GameState, rng: Rng): CombatResult {
  const combat = state.player.combat!;
  if (!combat.canFlee) return emptyCombatResult(state, 'cannot_flee', 'There is no escape from this fight.');
  const chance = fleeChance(state, combat);
  pushLog(combat, { actorId: 'player', actorName: state.player.name, action: 'flee', targetId: null, targetName: null, damage: 0, detail: `Attempts to flee (${(chance * 100).toFixed(0)}%).`, critical: false });
  if (rng.chance(chance)) {
    return conclude(state, rng, combat, 'fled', 'You broke contact and got away.');
  }
  pushLog(combat, { actorId: 'player', actorName: state.player.name, action: 'flee_failed', targetId: null, targetName: null, damage: 0, detail: 'They cut you off.', critical: false });
  // Failed flee costs the round: enemies get a free volley.
  for (const e of alive(combat, 'enemy')) {
    const player = combat.participants.find((p) => p.id === 'player');
    if (player && player.alive) attack(combat, rng, e, player);
  }
  return finishOrContinue(state, rng, combat);
}

function attemptNegotiate(state: GameState, rng: Rng): CombatResult {
  const combat = state.player.combat!;
  const chance = negotiateChance(state, combat);
  pushLog(combat, { actorId: 'player', actorName: state.player.name, action: 'negotiate', targetId: null, targetName: null, damage: 0, detail: `Opens a negotiation (${(chance * 100).toFixed(0)}%).`, critical: false });
  if (rng.chance(chance)) {
    changeReputation(state, 'criminal', -1, 'Talked your way out of a fight');
    return conclude(state, rng, combat, 'negotiated', 'Words worked. Everyone walks away.');
  }
  addHeat(state, 2, 'Failed negotiation drew attention');
  return finishOrContinue(state, rng, combat);
}

function attemptIntimidate(state: GameState, rng: Rng): CombatResult {
  const combat = state.player.combat!;
  const chance = intimidateChance(state, combat);
  pushLog(combat, { actorId: 'player', actorName: state.player.name, action: 'intimidate', targetId: null, targetName: null, damage: 0, detail: `Makes an example of themselves (${(chance * 100).toFixed(0)}%).`, critical: false });
  if (rng.chance(chance)) {
    changeReputation(state, 'criminal', 2, 'Intimidated opponents into backing down');
    return conclude(state, rng, combat, 'victory', 'They backed down.');
  }
  for (const e of alive(combat, 'enemy').slice(0, 2)) {
    const player = combat.participants.find((p) => p.id === 'player');
    if (player && player.alive) attack(combat, rng, e, player);
  }
  return finishOrContinue(state, rng, combat);
}

function attemptBribe(state: GameState, rng: Rng, amount: number): CombatResult {
  const combat = state.player.combat!;
  if (!combat.canBribe) return emptyCombatResult(state, 'cannot_bribe', 'These opponents cannot be bought.');
  if (amount <= 0) return emptyCombatResult(state, 'invalid_amount', 'Bribe amount must be positive.');
  const chance = bribeChance(state, combat, amount);
  const move = debitCash(state, amount, {
    kind: 'bribe',
    description: `Bribe during ${combat.kind} encounter`,
    allowDirty: true,
    locationId: combat.locationId,
    meta: { chance, enemies: alive(combat, 'enemy').length },
  });
  if (!move.ok) return emptyCombatResult(state, 'insufficient_funds', move.reason ?? 'You cannot afford that bribe.');
  pushLog(combat, { actorId: 'player', actorName: state.player.name, action: 'bribe', targetId: null, targetName: null, damage: 0, detail: `Offers ${formatMoney(amount)} (${(chance * 100).toFixed(0)}%).`, critical: false });
  bumpCounter(state, 'bribes_paid');
  setCounterSafe(state, 'bribe_total', counter(state, 'bribe_total') + amount);
  if (rng.chance(chance)) {
    changeReputation(state, 'criminal', 1, 'Bribed an official');
    changeReputation(state, 'legal', -1.5, 'Bribed an official');
    addHeat(state, 1.5, 'Bribery leaves a paper trail');
    return conclude(state, rng, combat, 'bribed', 'The money changed hands and the problem disappeared.');
  }
  addHeat(state, 6, 'Attempted bribery was refused and reported');
  changeReputation(state, 'legal', -3, 'Attempted bribery was refused');
  pushNotification(state, {
    kind: 'danger',
    title: 'Bribe refused',
    body: `They took note of the offer. ${formatMoney(amount)} is gone and enforcement attention rose.`,
    link: '/game/combat',
  });
  return finishOrContinue(state, rng, combat);
}

function setCounterSafe(state: GameState, key: string, value: number): void {
  state.player.stats.counters[key] = Number.isFinite(value) ? value : 0;
}

/* ------------------------------------------------------------------ */
/* Conclusion                                                          */
/* ------------------------------------------------------------------ */

type Conclusion = 'victory' | 'defeat' | 'fled' | 'negotiated' | 'bribed';

function conclude(state: GameState, rng: Rng, combat: ActiveCombat, conclusion: Conclusion, summary: string): CombatResult {
  const player = combat.participants.find((p) => p.id === 'player');
  const won = conclusion === 'victory';
  const escaped = conclusion === 'fled' || conclusion === 'negotiated' || conclusion === 'bribed';
  const casualties: CombatOutcome['casualties'] = [];

  for (const p of combat.participants) {
    if (p.side === 'enemy') {
      casualties.push({ id: p.id, name: p.name, status: p.alive && p.hp > 0 ? 'fled' : 'dead' });
    } else if (p.id !== 'player') {
      const status = p.hp <= 0 ? (rng.chance(0.35) ? 'dead' : 'injured') : 'injured';
      if (p.hp < p.maxHp) casualties.push({ id: p.id, name: p.name, status: p.hp <= 0 ? status : 'injured' });
      const emp = state.player.crew.find((e) => e.id === p.employeeId);
      if (emp) {
        if (p.hp <= 0 && status === 'dead') {
          emp.status = 'departed';
          emp.injured = false;
          changeReputation(state, 'crew', -6, `${emp.name} died fighting for you`);
        } else if (p.hp < p.maxHp * 0.7) {
          emp.injured = true;
          emp.injuredUntilDay = state.world.day + rng.int(4, 18);
          emp.stats.health = Math.max(10, Math.round((p.hp / p.maxHp) * 100));
          emp.stats.morale = clamp(emp.stats.morale - 8, 0, 100);
          changeReputation(state, 'crew', -1.5, `${emp.name} was injured in a fight`);
        }
      }
    }
  }

  // Sync player health from the combatant.
  if (player) state.player.stats.health = clamp(Math.round(player.hp), 0, state.player.stats.maxHealth);

  const outcome: CombatOutcome = {
    victory: won,
    fled: conclusion === 'fled',
    arrested: false,
    bribed: conclusion === 'bribed',
    negotiated: conclusion === 'negotiated',
    casualties,
    lootCash: 0,
    lootItems: [],
    xpGained: 0,
    reputationChanges: [],
    heatChange: 0,
    summary,
  };

  if (won) {
    const lootCash = combat.stakes.loot.reduce((s, l) => s + (l.cash ?? 0), 0);
    if (lootCash > 0) {
      creditCash(state, lootCash, { kind: 'combat_loot', description: `Loot from ${combat.kind} encounter`, dirty: combat.kind !== 'police', locationId: combat.locationId });
      outcome.lootCash = lootCash;
    }
    for (const l of combat.stakes.loot) {
      if (!l.commodityId) continue;
      const c = registry.get(l.commodityId);
      if (!c) continue;
      const qty = Math.max(1, rng.int(1, 3));
      const added = addItem(state, { commodityId: c.id, qty, origin: 'looted', avgCost: 0 });
      if (added.ok) outcome.lootItems.push({ commodityId: c.id, qty: added.qty });
    }
    const xp = combat.stakes.xpReward + B.combat.xpPerRoundWon * combat.turn;
    outcome.xpGained = grantXp(state, xp, `Won a ${combat.kind} engagement`).granted;
    for (const r of combat.stakes.reputationReward) {
      changeReputation(state, r.dimension, r.amount, `${combat.kind} engagement won`);
      outcome.reputationChanges.push({ dimension: r.dimension, amount: r.amount, reason: 'combat victory' });
    }
    // Fighting law enforcement is loud even when you win.
    const lawEnemies = combat.participants.filter((p) => p.side === 'enemy' && p.enemyDefId && ['police', 'swat', 'inspector'].includes(ENEMY_BY_ID[p.enemyDefId]?.archetype ?? ''));
    if (lawEnemies.length > 0) {
      const heat = round2(14 * lawEnemies.length * state.config.difficultyModifiers.enforcementMultiplier);
      addHeat(state, heat, `Attacked ${lawEnemies.length} law enforcement officer(s)`);
      outcome.heatChange = heat;
      changeReputation(state, 'legal', -8 * lawEnemies.length, 'Assaulted law enforcement');
      changeReputation(state, 'criminal', 6, 'Assaulted law enforcement');
    }
    state.player.stats.combatsWon += 1;
    bumpCounter(state, 'combats_won');
    recordObjective(state, 'complete_combat', { won: true, qty: 1 });
  } else if (!escaped) {
    applyDefeat(state, rng, combat, outcome);
    state.player.stats.combatsLost += 1;
    bumpCounter(state, 'combats_lost');
    recordObjective(state, 'complete_combat', { won: false, qty: 1 });
  } else {
    // Escaped: lose a little, keep your freedom.
    if (conclusion === 'fled' && combat.stakes.lossInventoryFraction > 0) {
      const lostFraction = combat.stakes.lossInventoryFraction * 0.4;
      const lost = dropCargo(state, rng, lostFraction);
      if (lost > 0) outcome.summary += ` You dropped ${formatMoney(lost)} of cargo while running.`;
    }
    bumpCounter(state, 'escapes');
    recordObjective(state, 'complete_combat', { won: false, qty: 1 });
  }

  combat.phase = 'resolved';
  combat.outcome = outcome;
  pushLog(combat, { actorId: 'system', actorName: 'Outcome', action: conclusion, targetId: null, targetName: null, damage: 0, detail: summary, critical: true });

  pushNotification(state, {
    kind: won ? 'success' : escaped ? 'warning' : 'danger',
    title: won ? `Victory — ${combat.kind}` : escaped ? `Escaped — ${combat.kind}` : `Defeated — ${combat.kind}`,
    body: summary + (outcome.arrested ? ' You were arrested.' : ''),
    link: '/game/combat',
    metrics: [
      { label: 'XP', value: String(outcome.xpGained) },
      ...(outcome.lootCash > 0 ? [{ label: 'Loot', value: formatMoney(outcome.lootCash) }] : []),
      { label: 'Your HP', value: `${Math.round(state.player.stats.health)}/${state.player.stats.maxHealth}` },
      ...(outcome.heatChange > 0 ? [{ label: 'Heat', value: `+${outcome.heatChange}` }] : []),
    ],
  });

  pushDiagnostic(state, {
    system: 'combat',
    level: won ? 'info' : 'warn',
    message: `Combat ${conclusion} (${combat.kind}, turn ${combat.turn}, ${combat.participants.filter((p) => p.side === 'enemy').length} enemies) auto=${combat.autoResolved ? 1 : 0}`,
    data: { conclusion, turns: combat.turn, xp: outcome.xpGained, loot: outcome.lootCash, arrested: outcome.arrested ? 1 : 0 },
  });

  // Death (only when permadeath is on) ends the run.
  if (state.player.stats.health <= 0 && state.config.permadeath && !outcome.arrested) {
    state.ending = buildEnding(state, 'death', 'You died from your injuries.');
    state.status = 'lost';
  }

  const result: CombatResult = {
    ok: true,
    combat,
    outcome,
    finished: true,
    log: combat.log.slice(-60),
    playerHp: state.player.stats.health,
    warnings: [],
  };
  // Clear the encounter unless the player was arrested (prison screen reads it).
  if (!outcome.arrested) state.player.combat = combat;
  return result;
}

function applyDefeat(state: GameState, rng: Rng, combat: ActiveCombat, outcome: CombatOutcome): void {
  const stakes = combat.stakes;
  const losses: string[] = [];

  if (stakes.lossCash > 0) {
    const move = debitCash(state, stakes.lossCash, {
      kind: 'fine',
      description: `Lost ${formatMoney(stakes.lossCash)} in a ${combat.kind} engagement`,
      allowDirty: true,
      locationId: combat.locationId,
    });
    if (move.ok) losses.push(formatMoney(stakes.lossCash) + ' in cash');
  }
  if (stakes.lossInventoryFraction > 0) {
    const lost = dropCargo(state, rng, stakes.lossInventoryFraction);
    if (lost > 0) losses.push(formatMoney(lost) + ' in goods');
  }
  if (rng.chance(stakes.injuryChance)) {
    const injury = Math.round(rng.int(8, 30) * (1 - lossReduction(playerModifiers(state))));
    state.player.stats.health = clamp(state.player.stats.health - injury, 0, state.player.stats.maxHealth);
    state.player.stats.lastInjuryDay = state.world.day;
    losses.push(`injury (−${injury} HP)`);
  }
  changeReputation(state, 'criminal', -4, `Lost a ${combat.kind} engagement`);
  changeReputation(state, 'crew', -3, 'Your people saw you lose');
  outcome.reputationChanges.push({ dimension: 'criminal', amount: -4, reason: 'defeat' });

  if (rng.chance(stakes.arrestChance)) {
    const arrest = applyArrest(state, rng, { reason: `Defeated by ${combat.enemyGroupId}`, kind: combat.kind });
    outcome.arrested = arrest.arrested;
    if (arrest.arrested) losses.push(`arrested (${arrest.sentenceDays} days)`);
  }
  outcome.summary = `Defeat. Lost ${losses.length > 0 ? losses.join(', ') : 'nothing but pride'}.`;
}

/** Sell/drop a fraction of the carried inventory (looting, seizure, fleeing). */
export function dropCargo(state: GameState, rng: Rng, fraction: number): number {
  if (fraction <= 0) return 0;
  const stacks = state.player.inventory.filter((s) => s.qty > 0);
  let lostValue = 0;
  for (const stack of stacks) {
    if (rng.chance(0.5) && fraction < 0.5) continue;
    const qty = Math.max(1, Math.floor(stack.qty * clamp(fraction * rng.float(0.6, 1.4), 0, 1)));
    const c = registry.get(stack.commodityId);
    const unit = c?.baseValue ?? stack.avgCost;
    const res = removeCommodity(state, stack.commodityId, qty, state.player.locationId);
    lostValue += res.removed * unit;
  }
  return round2(lostValue);
}

/* ------------------------------------------------------------------ */
/* Arrest, prison, bail                                                */
/* ------------------------------------------------------------------ */

export interface ArrestResult {
  arrested: boolean;
  sentenceDays: number;
  bailAmount: number;
  forfeitedCash: number;
  forfeitedItems: number;
  reason: string;
}

export function applyArrest(state: GameState, rng: Rng, opts: { reason: string; kind?: ActiveCombat['kind'] }): ArrestResult {
  const heat = state.player.reputation.heat;
  const lawyer = state.player.crew.some((e) => e.role === 'lawyer' && e.status === 'active' && !e.injured);
  let sentenceDays = rng.int(B.enforcement.prisonDaysBase[0], B.enforcement.prisonDaysBase[1]) + Math.round(heat * B.enforcement.prisonDaysPerHeatUnit);
  if (lawyer) sentenceDays = Math.round(sentenceDays * (1 - B.enforcement.lawyerReductionFraction));
  sentenceDays = Math.max(3, Math.round(sentenceDays * state.config.difficultyModifiers.enforcementMultiplier));

  const worth = computeNetWorth(state).total;
  const bailAmount = round2(Math.max(500, worth * B.enforcement.bailFractionOfNetWorth));
  const forfeitFraction = B.enforcement.assetForfeitureFraction * (lawyer ? 1 - B.enforcement.lawyerReductionFraction : 1);
  const cash = totalCash(state);
  const forfeitedCash = round2(Math.min(cash, cash * forfeitFraction));
  if (forfeitedCash > 0) {
    debitCash(state, forfeitedCash, { kind: 'fine', description: `Asset forfeiture on arrest: ${opts.reason}`, allowDirty: true });
  }
  const seizedItems = state.player.inventory.filter((s) => {
    const c = registry.get(s.commodityId);
    return c !== undefined && c.legality !== 'legal';
  });
  let forfeitedItems = 0;
  for (const stack of seizedItems) {
    const c = registry.get(stack.commodityId)!;
    const res = removeCommodity(state, stack.commodityId, stack.qty, state.player.locationId);
    forfeitedItems += res.removed;
    void c;
  }

  const prison = state.player.prison;
  prison.incarcerated = true;
  prison.incarceratedDay = state.world.day;
  prison.releaseDay = state.world.day + sentenceDays;
  prison.facility = `${worldReg.requireLocation(state.player.locationId).name} Correctional Facility`;
  prison.bailAmount = bailAmount;
  prison.bailPaid = false;
  prison.forfeitedCash = forfeitedCash;
  prison.forfeitedItems = forfeitedItems;
  prison.sentenceDays = sentenceDays;
  prison.escapedDay = null;
  prison.influence = 0;

  state.player.stats.arrests += 1;
  state.player.reputation.heat = round2(Math.max(0, heat * 0.35));
  bumpCounter(state, 'arrests');
  changeReputation(state, 'legal', -12, 'Arrested');
  changeReputation(state, 'criminal', 5, 'Arrested — the street noticed');
  changeReputation(state, 'business', -6, 'Arrested');

  pushNotification(state, {
    kind: 'danger',
    title: 'Arrested',
    body: `${opts.reason}. Sentence: ${sentenceDays} day(s) at ${prison.facility}. Bail is ${formatMoney(bailAmount)}${lawyer ? ' (your lawyer reduced the sentence and forfeiture).' : '.'}`,
    link: '/game/progression',
    metrics: [
      { label: 'Sentence', value: `${sentenceDays} days` },
      { label: 'Bail', value: formatMoney(bailAmount) },
      { label: 'Forfeited cash', value: formatMoney(forfeitedCash) },
      { label: 'Items seized', value: String(forfeitedItems) },
    ],
  });

  // Imprisonment is a loss condition only for very long sentences (spec rule:
  // never permanently hard-lock the player out of major systems).
  const lossCondition = state.config.lossConditions.find((l) => l.kind === 'imprisonment');
  if (lossCondition && sentenceDays >= lossCondition.threshold) {
    state.ending = buildEnding(state, 'imprisonment', `Sentenced to ${sentenceDays} days — the empire dissolved without you.`);
    state.status = 'ended_imprisoned';
  }

  return { arrested: true, sentenceDays, bailAmount, forfeitedCash, forfeitedItems, reason: opts.reason };
}

export interface PrisonTickResult {
  incarcerated: boolean;
  released: boolean;
  escaped: boolean;
  influence: number;
  daysRemaining: number;
}

export function prisonTick(state: GameState, rng: Rng): PrisonTickResult {
  const prison = state.player.prison;
  if (!prison.incarcerated) return { incarcerated: false, released: false, escaped: false, influence: 0, daysRemaining: 0 };

  prison.influence = round2(clamp(prison.influence + rng.float(0.4, 1.6), 0, 100));
  const daysRemaining = Math.max(0, (prison.releaseDay ?? state.world.day) - state.world.day);

  if (rng.chance(B.enforcement.prisonEscapeChancePerDay + prison.influence / 100 * 0.01)) {
    prison.escapedDay = state.world.day;
    prison.incarcerated = false;
    prison.incarceratedDay = null;
    prison.releaseDay = null;
    addHeat(state, 35, 'Escaped from prison');
    changeReputation(state, 'criminal', 14, 'Escaped from prison');
    changeReputation(state, 'legal', -10, 'Escaped from prison');
    bumpCounter(state, 'prison_escapes');
    pushNotification(state, {
      kind: 'warning',
      title: 'Prison escape',
      body: 'You are out, and you are now a fugitive. Enforcement attention spiked.',
      link: '/game/progression',
    });
    return { incarcerated: false, released: false, escaped: true, influence: prison.influence, daysRemaining: 0 };
  }

  if (daysRemaining <= 0) {
    prison.incarcerated = false;
    prison.releaseDay = null;
    pushNotification(state, {
      kind: 'success',
      title: 'Released',
      body: `You served ${prison.sentenceDays} days at ${prison.facility}. Your empire is whatever your people kept running.`,
      link: '/game',
    });
    return { incarcerated: false, released: true, escaped: false, influence: prison.influence, daysRemaining: 0 };
  }
  return { incarcerated: true, released: false, escaped: false, influence: prison.influence, daysRemaining };
}

export function payBail(state: GameState): { ok: boolean; reason?: string; released?: boolean } {
  const prison = state.player.prison;
  if (!prison.incarcerated) return { ok: false, reason: 'You are not incarcerated.' };
  if (prison.bailAmount === null) return { ok: false, reason: 'Bail is not available for this sentence.' };
  if (prison.bailPaid) return { ok: false, reason: 'Bail was already posted.' };
  const move = debitCash(state, prison.bailAmount, {
    kind: 'fine',
    description: `Bail posted at ${prison.facility}`,
    allowDirty: false,
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? 'You cannot afford bail.' };
  prison.bailPaid = true;
  prison.incarcerated = false;
  prison.releaseDay = null;
  changeReputation(state, 'legal', 3, 'Posted bail and surrendered to the process');
  pushNotification(state, {
    kind: 'success',
    title: 'Bail posted',
    body: `You are out on bail (${formatMoney(prison.bailAmount)}). The case still hangs over you — heat remains and further arrests will be harsher.`,
    link: '/game',
  });
  return { ok: true, released: true };
}

export function attemptPrisonEscape(state: GameState, rng: Rng): { ok: boolean; escaped: boolean; reason?: string } {
  const prison = state.player.prison;
  if (!prison.incarcerated) return { ok: false, escaped: false, reason: 'You are not incarcerated.' };
  const mods = playerModifiers(state);
  const chance = clamp(0.04 + (prison.influence / 100) * 0.22 + mods.skill('streetwise') * 0.012 + mods.skill('stealth') * 0.01, 0.01, 0.6);
  if (rng.chance(chance)) {
    prisonTick(state, rng);
    return { ok: true, escaped: true };
  }
  prison.influence = round2(Math.max(0, prison.influence - 12));
  prison.releaseDay = (prison.releaseDay ?? state.world.day) + rng.int(10, 40);
  state.player.stats.health = clamp(state.player.stats.health - rng.int(6, 22), 1, state.player.stats.maxHealth);
  pushNotification(state, {
    kind: 'danger',
    title: 'Escape attempt failed',
    body: `Solitary confinement and an extended sentence (${prison.releaseDay}). Chance was ${(chance * 100).toFixed(0)}%.`,
    link: '/game/progression',
  });
  return { ok: true, escaped: false, reason: 'Caught and punished.' };
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface CombatView {
  id: ID;
  kind: ActiveCombat['kind'];
  locationName: string;
  turn: number;
  turnLimit: number;
  phase: ActiveCombat['phase'];
  autoResolved: boolean;
  grid: { width: number; height: number };
  participants: {
    id: ID;
    name: string;
    side: Combatant['side'];
    hp: number;
    maxHp: number;
    hpPct: number;
    ap: number;
    maxAp: number;
    accuracy: number;
    damage: [number, number];
    defense: number;
    position: { x: number; y: number };
    cover: boolean;
    alive: boolean;
    tier?: string;
    description?: string;
  }[];
  log: CombatLogEntry[];
  stakes: CombatStakes;
  estimates: ActionEstimate[];
  canFlee: boolean;
  canNegotiate: boolean;
  canBribe: boolean;
  bribeAmount: number;
  outcome: CombatOutcome | null;
  odds: { victoryChance: number; explanation: string };
}

/** Rough victory odds from relative effective power — shown before committing. */
export function victoryOdds(state: GameState, combat: ActiveCombat): { victoryChance: number; explanation: string } {
  const friendly = combat.participants.filter((p) => p.side !== 'enemy' && p.alive);
  const enemies = combat.participants.filter((p) => p.side === 'enemy' && p.alive);
  const power = (list: Combatant[]) =>
    list.reduce((s, p) => s + (p.hp / Math.max(1, p.maxHp)) * ((p.damage[0] + p.damage[1]) / 2) * p.accuracy * (1 + p.defense) * p.maxActionPoints, 0);
  const f = power(friendly);
  const e = power(enemies);
  const ratio = e === 0 ? 1 : f / e;
  const chance = round2(clamp(ratio / (1 + ratio), 0.02, 0.97));
  return {
    victoryChance: chance,
    explanation: `Your side's effective power ${f.toFixed(0)} vs theirs ${e.toFixed(0)} (${friendly.length} vs ${enemies.length} combatants, HP/accuracy/damage/AP weighted).`,
  };
}

export function combatView(state: GameState): CombatView | null {
  const combat = state.player.combat;
  if (!combat) return null;
  return {
    id: combat.id,
    kind: combat.kind,
    locationName: worldReg.location(combat.locationId)?.name ?? combat.locationId,
    turn: combat.turn,
    turnLimit: B.combat.turnLimit,
    phase: combat.phase,
    autoResolved: combat.autoResolved,
    grid: combat.grid,
    participants: combat.participants.map((p) => {
      const def = p.enemyDefId ? ENEMY_BY_ID[p.enemyDefId] : undefined;
      return {
        id: p.id,
        name: p.name,
        side: p.side,
        hp: p.hp,
        maxHp: p.maxHp,
        hpPct: p.maxHp > 0 ? round2(p.hp / p.maxHp) : 0,
        ap: p.actionPoints,
        maxAp: p.maxActionPoints,
        accuracy: p.accuracy,
        damage: p.damage,
        defense: p.defense,
        position: p.position,
        cover: p.cover,
        alive: p.alive,
        ...(def ? { tier: def.tier, description: def.description } : {}),
      };
    }),
    log: combat.log.slice(-60),
    stakes: combat.stakes,
    estimates: combat.phase === 'active' ? actionEstimates(state, combat) : [],
    canFlee: combat.canFlee,
    canNegotiate: combat.canNegotiate,
    canBribe: combat.canBribe,
    bribeAmount: combat.bribeAmount,
    outcome: combat.outcome,
    odds: victoryOdds(state, combat),
  };
}

export function clearResolvedCombat(state: GameState): void {
  if (state.player.combat && state.player.combat.phase === 'resolved') state.player.combat = null;
}

/** Enforcement-driven encounter spawning used by the daily tick. */
export function enforcementEncounterChance(state: GameState): number {
  const loc = worldReg.location(state.player.locationId);
  const locState = state.world.locations[state.player.locationId];
  if (!loc || !locState) return 0;
  const heat = state.player.reputation.heat;
  const investigation = state.player.reputation.investigation / 100;
  const illegalCargo = state.player.inventory.some((s) => {
    const c = registry.get(s.commodityId);
    return c !== undefined && c.legality !== 'legal';
  });
  const base = B.enforcement.patrolChancePerDayByLocation * (0.4 + loc.laws.enforcement * 1.6);
  // Attention scales with heat: a clean trader is almost never bothered, while a
  // hot one is stopped constantly. This keeps enforcement a consequence, not noise.
  const attention = 0.25 + clamp(heat / 60, 0, 2.2) + investigation * 0.9;
  return round2(
    clamp(base * attention * (illegalCargo ? 1.5 : 1) * state.config.difficultyModifiers.enforcementMultiplier, 0, 0.55),
  );
}

export function spawnEnforcementEncounter(state: GameState, rng: Rng): CombatResult | null {
  const chance = enforcementEncounterChance(state);
  if (!rng.chance(chance)) return null;
  const rep = state.player.reputation;
  const illegalCargo = state.player.inventory.some((s) => {
    const c = registry.get(s.commodityId);
    return c !== undefined && c.legality !== 'legal';
  });

  // A law-abiding player with nothing to hide gets a paperwork check, not a
  // firefight: fighting a routine stop should never be the optimal response.
  if (!illegalCargo && rep.heat < 25 && rep.investigation < 20) {
    const fine = rng.chance(0.3) ? round2(Math.max(40, totalCash(state) * 0.004)) : 0;
    if (fine > 0) {
      debitCash(state, fine, { kind: 'fine', description: 'Routine inspection: paperwork irregularity', allowDirty: false });
    }
    addHeat(state, rng.float(0.4, 1.6), 'Routine patrol stop');
    pushNotification(state, {
      kind: fine > 0 ? 'warning' : 'info',
      title: 'Routine patrol stop',
      body:
        fine > 0
          ? `Officers checked your papers and found an irregularity. Fine ${formatMoney(fine)}.`
          : 'Officers checked your papers and found nothing. You are clean — for now.',
      link: '/game/progression',
      ...(fine > 0 ? { metrics: [{ label: 'Fine', value: formatMoney(fine) }] } : {}),
    });
    pushDiagnostic(state, {
      system: 'combat',
      level: 'info',
      message: `Routine patrol stop (no contraband, heat ${rep.heat.toFixed(1)}): fine ${fine}`,
      data: { fine, heat: rep.heat },
    });
    bumpCounter(state, 'patrol_stops');
    return null;
  }

  const table = rep.investigation > 60 ? 'raid' : rep.investigation > 25 ? 'investigation' : illegalCargo ? 'customs' : 'police_stop';
  const kind: ActiveCombat['kind'] = table === 'raid' ? 'raid' : table === 'investigation' ? 'police' : 'police';
  const count: [number, number] = table === 'raid' ? [2, 4] : table === 'investigation' ? [1, 2] : [1, 2];
  return startCombat(state, rng, {
    kind,
    table,
    enemyCount: count,
    stakes: table === 'raid' ? 'high' : illegalCargo ? 'medium' : 'low',
    reason:
      table === 'raid'
        ? 'Enforcement raids your premises.'
        : table === 'investigation'
          ? 'Investigators stop you for questioning.'
          : illegalCargo
            ? 'Customs pulls your cargo for inspection.'
            : 'A routine patrol stops you.',
    seedLabel: `enforcement:${table}`,
  });
}
