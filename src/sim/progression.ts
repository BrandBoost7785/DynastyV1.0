/**
 * Progression — XP, levels, skills, perks, titles, achievements, prestige.
 *
 * XP is always awarded by the engine from computed outcomes (profit actually
 * realised, distance actually travelled, enemies actually defeated). The client
 * can never send XP, levels or skill points.
 *
 * Achievements are data: each one carries a tiny comparison expression over
 * named counters, so new achievements need no engine changes.
 */

import { getBalance } from '../config/balance';
import { PERK_BY_ID, SKILL_BY_ID } from '../engine/registry/people';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID } from '../engine/registry/missions';
import { buildModifiers, type Modifiers } from './modifiers';
import { computeNetWorth, creditCash, debitCash, pushNotification, round2, titleForLevel, xpForLevel } from './state';
import type { GameState, ID, ProgressionState, ReputationDimension } from './types';

const B = getBalance();

/* ------------------------------------------------------------------ */
/* Counters                                                            */
/* ------------------------------------------------------------------ */

export function counter(state: GameState, key: string): number {
  return state.player.stats.counters[key] ?? 0;
}

export function setCounter(state: GameState, key: string, value: number): void {
  if (!Number.isFinite(value)) return;
  state.player.stats.counters[key] = value;
}

export function bumpCounter(state: GameState, key: string, delta = 1): number {
  const next = counter(state, key) + delta;
  setCounter(state, key, next);
  return next;
}

export function maxCounter(state: GameState, key: string, candidate: number): void {
  if (candidate > counter(state, key)) setCounter(state, key, candidate);
}

/* ------------------------------------------------------------------ */
/* XP and levels                                                       */
/* ------------------------------------------------------------------ */

export interface XpResult {
  granted: number;
  levelsGained: number;
  newLevel: number;
  skillPointsGained: number;
  perkPointsGained: number;
  newTitles: string[];
}

/**
 * Award XP. Difficulty and perks scale the award; level-ups grant skill and
 * perk points and unlock titles. The XP trail is recorded so the UI can answer
 * "why did my level change?" (spec §40).
 */
export function grantXp(state: GameState, baseAmount: number, reason: string): XpResult {
  const mods = playerModifiers(state);
  const difficultyMul = state.config.difficultyModifiers.xpMultiplier;
  const granted = Math.max(0, Math.round(baseAmount * difficultyMul * xpMultiplierFrom(mods) * (1 + state.player.progression.legacyBonus)));
  const p = state.player.progression;

  p.xp += granted;
  p.totalXpEarned += granted;
  p.recentXp.push({ day: state.world.day, amount: granted, reason });
  if (p.recentXp.length > 40) p.recentXp.splice(0, p.recentXp.length - 40);

  let levelsGained = 0;
  let skillPointsGained = 0;
  let perkPointsGained = 0;
  const newTitles: string[] = [];

  while (p.level < B.progression.maxLevel && p.xp >= p.xpToNext) {
    p.xp -= p.xpToNext;
    p.level += 1;
    levelsGained += 1;
    p.xpToNext = xpForLevel(p.level);
    skillPointsGained += B.progression.skillPointsPerLevel;
    p.skillPoints += B.progression.skillPointsPerLevel;
    if (p.level % B.progression.perkPointEveryNthLevel === 0) {
      perkPointsGained += B.progression.perkPointsPerLevel;
      p.perkPoints += B.progression.perkPointsPerLevel;
    }
    const title = titleForLevel(p.level);
    if (!p.titles.includes(title)) {
      p.titles.push(title);
      p.currentTitle = title;
      newTitles.push(title);
    }
  }
  if (p.level >= B.progression.maxLevel) p.xp = Math.min(p.xp, p.xpToNext);

  if (levelsGained > 0) {
    pushNotification(state, {
      kind: 'success',
      title: `Level ${p.level}${newTitles.length > 0 ? ` — ${newTitles[newTitles.length - 1]}` : ''}`,
      body:
        `You gained ${levelsGained} level(s) from "${reason}". ` +
        `+${skillPointsGained} skill point(s)${perkPointsGained > 0 ? ` and +${perkPointsGained} perk point(s)` : ''}.`,
      link: '/game/progression',
      metrics: [
        { label: 'XP granted', value: String(granted) },
        { label: 'Level', value: String(p.level) },
        { label: 'To next level', value: String(Math.max(0, p.xpToNext - p.xp)) },
      ],
    });
  }

  setCounter(state, 'level', p.level);
  return { granted, levelsGained, newLevel: p.level, skillPointsGained, perkPointsGained, newTitles };
}

function xpMultiplierFrom(mods: Modifiers): number {
  return mods.getMul('xp.multiplier');
}

/** XP awarded for a realised trade profit (losses award nothing). */
export function xpFromTradeProfit(profit: number): number {
  if (profit <= 0) return B.progression.xpTradeMin;
  return Math.max(B.progression.xpTradeMin, Math.round(Math.sqrt(profit) * B.progression.xpTradeFractionOfProfit));
}

/* ------------------------------------------------------------------ */
/* Skills                                                              */
/* ------------------------------------------------------------------ */

export interface SkillCheck {
  ok: boolean;
  reason?: string;
  missingPrerequisites: { skillId: ID; required: number; current: number }[];
}

export function skillLevel(p: ProgressionState, skillId: ID): number {
  return p.skills[skillId] ?? 0;
}

export function canLearnSkill(state: GameState, skillId: ID): SkillCheck {
  const def = SKILL_BY_ID[skillId];
  if (!def) return { ok: false, reason: 'Unknown skill', missingPrerequisites: [] };
  const p = state.player.progression;
  const current = skillLevel(p, skillId);
  if (current >= def.maxLevel) return { ok: false, reason: `${def.name} is already at its maximum level`, missingPrerequisites: [] };
  if (p.skillPoints <= 0) return { ok: false, reason: 'No unspent skill points', missingPrerequisites: [] };

  const missing: SkillCheck['missingPrerequisites'] = [];
  for (const pre of def.prerequisites) {
    const have = skillLevel(p, pre.skillId);
    if (have < pre.level) missing.push({ skillId: pre.skillId, required: pre.level, current: have });
  }
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Requires ${missing.map((m) => `${SKILL_BY_ID[m.skillId]?.name ?? m.skillId} ${m.required}`).join(', ')}`,
      missingPrerequisites: missing,
    };
  }
  return { ok: true, missingPrerequisites: [] };
}

export function learnSkill(state: GameState, skillId: ID): { ok: boolean; reason?: string; newLevel?: number } {
  const check = canLearnSkill(state, skillId);
  if (!check.ok) return { ok: false, reason: check.reason };
  const p = state.player.progression;
  p.skillPoints -= 1;
  const next = skillLevel(p, skillId) + 1;
  p.skills[skillId] = next;
  const def = SKILL_BY_ID[skillId]!;
  pushNotification(state, {
    kind: 'success',
    title: `${def.name} ${next}`,
    body: `${def.effectPerLevel}`,
    link: '/game/progression',
  });
  return { ok: true, newLevel: next };
}

/* ------------------------------------------------------------------ */
/* Perks                                                               */
/* ------------------------------------------------------------------ */

export interface PerkCheck {
  ok: boolean;
  reason?: string;
}

export function canTakePerk(state: GameState, perkId: ID): PerkCheck {
  const def = PERK_BY_ID[perkId];
  if (!def) return { ok: false, reason: 'Unknown perk' };
  const p = state.player.progression;
  if (p.perks.includes(perkId)) return { ok: false, reason: 'Perk already taken' };
  if (p.perkPoints <= 0) return { ok: false, reason: 'No unspent perk points' };
  if (def.minLevel !== undefined && p.level < def.minLevel) {
    return { ok: false, reason: `Requires level ${def.minLevel}` };
  }
  if (def.requiresSkill) {
    const have = skillLevel(p, def.requiresSkill.skillId);
    if (have < def.requiresSkill.level) {
      const name = SKILL_BY_ID[def.requiresSkill.skillId]?.name ?? def.requiresSkill.skillId;
      return { ok: false, reason: `Requires ${name} ${def.requiresSkill.level}` };
    }
  }
  if (def.requiresPerk && !p.perks.includes(def.requiresPerk)) {
    return { ok: false, reason: `Requires ${PERK_BY_ID[def.requiresPerk]?.name ?? def.requiresPerk}` };
  }
  for (const ex of def.mutuallyExclusive ?? []) {
    if (p.perks.includes(ex)) return { ok: false, reason: `Mutually exclusive with ${PERK_BY_ID[ex]?.name ?? ex}` };
  }
  return { ok: true };
}

export function takePerk(state: GameState, perkId: ID): { ok: boolean; reason?: string } {
  const check = canTakePerk(state, perkId);
  if (!check.ok) return check;
  const def = PERK_BY_ID[perkId]!;
  const p = state.player.progression;
  p.perkPoints -= 1;
  p.perks.push(perkId);
  pushNotification(state, {
    kind: 'success',
    title: `Perk: ${def.name}`,
    body: def.description,
    link: '/game/progression',
    metrics: Object.entries(def.modifiers).map(([label, value]) => ({ label, value: String(value) })),
  });
  return { ok: true };
}

/**
 * What a respec costs right now.
 *
 * Prices escalate with each rebuild so a player cannot swap loadouts to suit every
 * situation for free — specialization has to mean something.
 */
export function respecCost(state: GameState): number {
  const times = counter(state, 'respecs');
  return round2(B.progression.respecBaseCost * Math.pow(B.progression.respecCostGrowth, Math.min(12, times)));
}

export function respec(state: GameState, cost: number): { ok: boolean; reason?: string; cost?: number } {
  const p = state.player.progression;
  const price = round2(Math.max(0, cost));
  if (price <= 0) {
    return { ok: false, reason: 'A respec always costs money — somebody has to retrain you.' };
  }
  const move = debitCash(state, price, { kind: 'fee', description: 'Skill and perk respec' });
  if (!move.ok) {
    return { ok: false, reason: move.reason ?? `You cannot afford a respec (${price} required).` };
  }
  p.skills = {};
  p.perks = [];
  p.skillPoints = Math.max(0, (p.level - 1) * B.progression.skillPointsPerLevel + B.player.startingSkillPoints);
  p.perkPoints = Math.floor(p.level / B.progression.perkPointEveryNthLevel) * B.progression.perkPointsPerLevel;
  bumpCounter(state, 'respecs');
  pushNotification(state, {
    kind: 'info',
    title: 'Loadout rebuilt',
    body: `Every skill and perk was reset for a fee. You have ${p.skillPoints} skill point(s) and ${p.perkPoints} perk point(s) to spend again — the next respec will cost more.`,
    link: '/game/progression',
  });
  return { ok: true, cost: price };
}

export function setTitle(state: GameState, title: string): { ok: boolean; reason?: string } {
  const p = state.player.progression;
  if (!p.titles.includes(title)) return { ok: false, reason: 'Title not earned' };
  p.currentTitle = title;
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Achievements                                                        */
/* ------------------------------------------------------------------ */

interface Comparison {
  metric: string;
  op: '>=' | '==' | '<=';
  value: number;
}

function parseCheck(check: string): Comparison[] {
  return check.split('&&').map((clause) => {
    const m = /^([a-z_]+)(>=|==|<=)([0-9.]+)$/.exec(clause.trim());
    if (!m) return { metric: clause, op: '>=', value: Infinity };
    return { metric: m[1]!, op: m[2] as Comparison['op'], value: Number(m[3]) };
  });
}

/**
 * Collect every metric an achievement expression can reference. Derived values
 * are computed live; cumulative values come from `stats.counters`.
 */
export function achievementMetrics(state: GameState): Record<string, number> {
  const p = state.player;
  const worth = computeNetWorth(state);
  const counters = p.stats.counters;
  const metrics: Record<string, number> = { ...counters };

  metrics.net_worth = worth.total;
  metrics.level = p.progression.level;
  metrics.days = state.world.day;
  metrics.trades = p.stats.totalTradesExecuted;
  metrics.combats = p.stats.combatsWon + p.stats.combatsLost;
  metrics.combats_won = p.stats.combatsWon;
  metrics.arrests = p.stats.arrests;
  metrics.properties = p.properties.length;
  metrics.businesses = p.businesses.length;
  metrics.crew = p.crew.length;
  metrics.loans = p.loans.filter((l) => l.status === 'active' || l.status === 'defaulted').length;
  metrics.stocks = p.stockHoldings.filter((h) => h.shares > 0).length;
  metrics.crypto = p.cryptoHoldings.filter((h) => h.amount > 0).length;
  metrics.underground = p.underground.accessUnlocked ? 1 : 0;
  metrics.locations_visited = new Set(Object.values(state.world.locations).filter((l) => l.lastVisitedDay !== null).map((l) => l.locationId)).size;
  metrics.achievements = p.progression.achievements.length;
  metrics.distance = p.stats.totalDistanceTravelledKm;
  metrics.heat = p.reputation.heat;
  return metrics;
}

export interface AchievementAward {
  id: ID;
  name: string;
  description: string;
  xp: number;
}

/** Evaluate every not-yet-earned achievement; award those now satisfied. */
export function checkAchievements(state: GameState): AchievementAward[] {
  const metrics = achievementMetrics(state);
  const awarded: AchievementAward[] = [];
  for (const def of ACHIEVEMENTS) {
    if (state.player.progression.achievements.includes(def.id)) continue;
    const comparisons = parseCheck(def.check);
    const satisfied = comparisons.every((c) => {
      const actual = metrics[c.metric] ?? 0;
      switch (c.op) {
        case '>=':
          return actual >= c.value;
        case '<=':
          return actual <= c.value;
        case '==':
          return Math.abs(actual - c.value) < 1e-9;
        default:
          return false;
      }
    });
    if (!satisfied) continue;
    state.player.progression.achievements.push(def.id);
    awarded.push({ id: def.id, name: def.name, description: def.description, xp: def.xp });
    pushNotification(state, {
      kind: 'success',
      title: `Achievement: ${def.name}`,
      body: `${def.description} (+${def.xp} XP)`,
      link: '/game/progression',
    });
    grantXp(state, def.xp, `Achievement: ${def.name}`);
  }
  return awarded;
}

export function achievementProgress(state: GameState): {
  id: ID;
  name: string;
  description: string;
  earned: boolean;
  earnedDay: number | null;
  metrics: { metric: string; current: number; target: number; op: string }[];
  progress: number;
}[] {
  const values = achievementMetrics(state);
  return ACHIEVEMENTS.map((def) => {
    const comparisons = parseCheck(def.check);
    const earned = state.player.progression.achievements.includes(def.id);
    const parts = comparisons.map((c) => ({
      metric: c.metric,
      current: values[c.metric] ?? 0,
      target: c.value,
      op: c.op,
    }));
    const progress = earned
      ? 1
      : parts.length === 0
        ? 0
        : Math.min(
            1,
            parts.reduce((sum, p) => sum + (p.target === 0 ? 1 : Math.min(1, Math.max(0, p.current / p.target))), 0) / parts.length,
          );
    return { id: def.id, name: def.name, description: def.description, earned, earnedDay: null, metrics: parts, progress };
  });
}

/* ------------------------------------------------------------------ */
/* Prestige                                                            */
/* ------------------------------------------------------------------ */

export interface PrestigeResult {
  ok: boolean;
  reason?: string;
  /** Refusal code, so a caller can distinguish "not yet" from "not allowed". */
  code?:
    | 'below_threshold'
    | 'too_soon'
    | 'max_prestiges'
    | 'debts_outstanding'
    | 'unstable_state'
    | 'liquidation_failed';
  legacyBonus?: number;
  /** What this handover added to the permanent bonus. */
  bonusGained?: number;
  /** Whether the cap is now reached — further handovers add nothing. */
  capped?: boolean;
  prestigesRemaining?: number;
  /** Net worth forfeited, for the confirmation screen and the audit trail. */
  forfeited?: number;
  daysUntilEligible?: number;
  kept?: string[];
  lost?: string[];
}

/**
 * Prestige: hand the empire to your heir and restart with a permanent legacy bonus.
 *
 * This is a *cost*, not a tap. The whole estate is forfeited, progression restarts
 * at level 1, and what comes back is a bounded XP bonus — capped, diminishing, and
 * available a limited number of times per character, with a minimum interval
 * between handovers. All four limits exist because an uncapped, free, repeatable
 * multiplier is an exploit: the previous implementation awarded the bonus and
 * liquidated nothing, so calling it 25 times bought a 7x XP multiplier for free.
 *
 * Per the design rule that an earlier choice must never hard-lock a later system,
 * titles, achievements, learned skills, perks and reputation survive the handover.
 * Everything here is validated server-side; the intent carries no client fields, so
 * there is no number for a caller to tamper with.
 *
 * Atomicity: every precondition is checked before anything mutates, and the one
 * step that can fail (withdrawing the estate's cash through the money primitive)
 * runs first, so a refusal leaves the state exactly as it was.
 */
export function prestige(state: GameState): PrestigeResult {
  const cfg = B.progression.prestige;
  const p = state.player.progression;
  const day = state.world.day;
  const kept = ['titles', 'achievements', 'learned skills', 'perks', 'reputation history', 'the day counter and your location'];
  const lost = ['cash', 'inventory', 'properties', 'businesses', 'production lines', 'vehicles', 'crew', 'automation rules', 'stock and crypto holdings', 'mining rigs', 'escrow and data assets', 'character level'];

  /* --------------------------- preconditions --------------------------- */
  if (p.prestigeCount >= cfg.maxPrestiges) {
    return {
      ok: false,
      code: 'max_prestiges',
      reason: `An empire can only be handed over ${cfg.maxPrestiges} times. Yours has been ${p.prestigeCount} times, and the legacy bonus is capped at ${(cfg.legacyBonusCap * 100).toFixed(0)}%.`,
      legacyBonus: p.legacyBonus,
      prestigesRemaining: 0,
      kept,
      lost,
    };
  }

  if (p.lastPrestigeDay !== null) {
    const elapsed = day - p.lastPrestigeDay;
    if (elapsed < cfg.minDaysBetween) {
      return {
        ok: false,
        code: 'too_soon',
        reason: `Your heir needs ${cfg.minDaysBetween} days to take the reins; ${elapsed} have passed. Rebuild the estate first.`,
        daysUntilEligible: cfg.minDaysBetween - elapsed,
        legacyBonus: p.legacyBonus,
        prestigesRemaining: cfg.maxPrestiges - p.prestigeCount,
        kept,
        lost,
      };
    }
  }

  if (state.status !== 'active' || state.player.prison.incarcerated || state.player.combat !== null || state.player.travel !== null) {
    return {
      ok: false,
      code: 'unstable_state',
      reason: state.player.prison.incarcerated
        ? 'You cannot hand over an empire from a cell.'
        : state.player.combat !== null
          ? 'Resolve the fight before handing over the empire.'
          : state.player.travel !== null
            ? 'Finish the journey before handing over the empire.'
            : 'The empire can only be handed over while the game is active.',
      kept,
      lost,
    };
  }

  const outstandingDebt = round2(
    state.player.loans.filter((l) => l.status === 'active').reduce((sum, l) => sum + l.balance, 0),
  );
  if (cfg.requireDebtsSettled && outstandingDebt > 0.009) {
    return {
      ok: false,
      code: 'debts_outstanding',
      reason: `Settle ${formatMoneyLocal(outstandingDebt)} of outstanding debt first. Handing over the estate is not a way out of what it owes.`,
      kept,
      lost,
    };
  }

  const worth = computeNetWorth(state).total;
  if (!(worth >= cfg.netWorthRequirement)) {
    // `!(>=)` so a NaN net worth is refused rather than slipping through.
    return {
      ok: false,
      code: 'below_threshold',
      reason: `Handing over the empire requires an estate worth ${cfg.netWorthRequirement.toLocaleString('en-US')}.`,
      kept,
      lost,
    };
  }

  /* ------------------------- the cost, applied ------------------------- */
  const cash = round2(state.player.accounts.reduce((sum, a) => sum + a.balance, 0));
  if (cash > 0) {
    // One call across every usable account: `debitCash` plans all legs before it
    // applies any, so this either withdraws the whole estate or changes nothing.
    const withdrawn = debitCash(state, cash, {
      kind: 'adjustment',
      description: `Estate handed over to your heir (prestige ${p.prestigeCount + 1})`,
      allowDirty: true,
      day,
    });
    if (!withdrawn.ok) {
      return {
        ok: false,
        code: 'liquidation_failed',
        reason: withdrawn.reason ?? 'The estate could not be liquidated (an account is frozen or over its daily limit). Nothing was changed.',
        kept,
        lost,
      };
    }
  }

  const player = state.player;
  const personal = player.storages.find((s) => s.kind === 'personal') ?? player.storages[0] ?? null;
  player.storages = personal ? [personal] : [];
  player.inventory = [];
  player.properties = [];
  player.businesses = [];
  player.productionLines = [];
  player.vehicles = [];
  player.shipments = [];
  player.crew = [];
  player.hiringPool = [];
  player.hiringPoolRefreshDay = day;
  player.automation = [];
  player.stockHoldings = [];
  player.cryptoHoldings = [];
  player.miningRigs = [];
  player.brokerageAccountId = null;
  player.loans = [];
  player.underground.escrowBalance = 0;
  player.underground.dataAssets = [];
  // Contracts in flight referenced assets that no longer exist; the board rerolls.
  player.missions = [];
  player.missionOffers = [];
  player.missionRefreshDay = day;

  // Keep one settlement account, reopened with the standard starting balance.
  const primary = player.accounts[0];
  if (primary) {
    primary.balance = 0;
    primary.dirtyBalance = 0;
    primary.frozen = false;
    primary.frozenUntilDay = null;
    primary.freezeReason = null;
    player.accounts = [primary];
  }
  const startingCash = round2(B.finance.startingCash * state.config.difficultyModifiers.startingCashMultiplier);
  if (startingCash > 0 && primary) {
    creditCash(state, startingCash, {
      kind: 'adjustment',
      description: 'The heir settles a starting balance on you',
      accountId: primary.id,
      day,
    });
  }

  /* --------------------------- the reward ------------------------------ */
  const gained = round2(cfg.legacyBonusFraction * (1 + p.prestigeCount * cfg.diminishingPerPrestige));
  const uncapped = round2(p.legacyBonus + gained);
  const capped = uncapped > cfg.legacyBonusCap + 1e-9;
  p.legacyBonus = capped ? cfg.legacyBonusCap : uncapped;
  const bonusGained = round2(p.legacyBonus - (uncapped - gained));
  p.prestigeCount += 1;
  p.lastPrestigeDay = day;
  p.lastPrestigeNetWorth = round2(worth);

  // Progression restarts; what was *learned* is kept.
  p.level = 1;
  p.xp = 0;
  p.xpToNext = xpForLevel(1);
  p.skillPoints = B.player.startingSkillPoints;
  p.perkPoints = 0;
  p.specialisation = null;
  p.milestones.push(`prestige_${day}`);

  setCounter(state, 'prestige', p.prestigeCount);
  maxCounter(state, 'prestige_forfeited', round2(worth));

  pushNotification(state, {
    kind: 'success',
    title: `The empire passes to your heir (${p.prestigeCount} of ${cfg.maxPrestiges})`,
    body: `${formatMoneyLocal(round2(worth))} of estate handed over. You keep your titles, achievements, learned skills and reputation, and restart at level 1 with a permanent +${(p.legacyBonus * 100).toFixed(0)}% XP legacy bonus${capped ? ' (the cap)' : ''}.`,
    link: '/game/progression',
    metrics: [
      { label: 'Forfeited', value: formatMoneyLocal(round2(worth)) },
      { label: 'Legacy bonus', value: `+${(p.legacyBonus * 100).toFixed(0)}%` },
      { label: 'Handovers left', value: String(cfg.maxPrestiges - p.prestigeCount) },
    ],
  });

  return {
    ok: true,
    legacyBonus: p.legacyBonus,
    bonusGained,
    capped,
    prestigesRemaining: cfg.maxPrestiges - p.prestigeCount,
    forfeited: round2(worth),
    daysUntilEligible: cfg.minDaysBetween,
    kept,
    lost,
  };
}

/** Money formatting without importing `formatMoney` back into this module's API. */
function formatMoneyLocal(v: number): string {
  return `\u00A4${Math.round(v).toLocaleString('en-US')}`;
}

/* ------------------------------------------------------------------ */
/* Convenience                                                         */
/* ------------------------------------------------------------------ */

export function playerModifiers(state: GameState): Modifiers {
  return buildModifiers(state.player.progression);
}

/** Reputation multiplier applied to every reputation change. */
export function reputationGainMultiplier(state: GameState): number {
  const mods = playerModifiers(state);
  return mods.getMul('reputation.gainMultiplier');
}

export function specialisationFor(state: GameState): string | null {
  const skills = state.player.progression.skills;
  const entries = Object.entries(skills).sort((a, b) => b[1] - a[1]);
  const top = entries[0];
  if (!top || top[1] < 8) return null;
  return SKILL_BY_ID[top[0]]?.tree ?? null;
}

export function progressionSummary(state: GameState): {
  level: number;
  title: string;
  xp: number;
  xpToNext: number;
  xpProgress: number;
  skillPoints: number;
  perkPoints: number;
  skills: { id: ID; name: string; level: number; maxLevel: number; tree: string; effect: string }[];
  perks: { id: ID; name: string; description: string; modifiers: Record<string, number> }[];
  achievementsEarned: number;
  achievementsTotal: number;
  prestigeCount: number;
  legacyBonus: number;
  reputation: Record<ReputationDimension, number>;
  resolvedModifiers: Record<string, number>;
} {
  const p = state.player.progression;
  return {
    level: p.level,
    title: p.currentTitle,
    xp: p.xp,
    xpToNext: p.xpToNext,
    xpProgress: p.xpToNext > 0 ? Math.min(1, p.xp / p.xpToNext) : 1,
    skillPoints: p.skillPoints,
    perkPoints: p.perkPoints,
    skills: Object.entries(p.skills)
      .map(([id, level]) => {
        const def = SKILL_BY_ID[id];
        return {
          id,
          name: def?.name ?? id,
          level,
          maxLevel: def?.maxLevel ?? 30,
          tree: def?.tree ?? 'technical',
          effect: def?.effectPerLevel ?? '',
        };
      })
      .sort((a, b) => b.level - a.level),
    perks: p.perks
      .map((id) => PERK_BY_ID[id])
      .filter((d): d is NonNullable<typeof d> => d !== undefined)
      .map((d) => ({ id: d.id, name: d.name, description: d.description, modifiers: d.modifiers })),
    achievementsEarned: p.achievements.length,
    achievementsTotal: ACHIEVEMENTS.length,
    prestigeCount: p.prestigeCount,
    legacyBonus: p.legacyBonus,
    reputation: { ...state.player.reputation.dimensions },
    resolvedModifiers: playerModifiers(state).dump(),
  };
}

export { ACHIEVEMENT_BY_ID };
