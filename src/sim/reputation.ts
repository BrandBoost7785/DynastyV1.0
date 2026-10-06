/**
 * Reputation, heat and enforcement attention.
 *
 * Reputation is multi-dimensional (spec §21): you can be a respected legal
 * merchant and a wanted smuggler at the same time, and different systems read
 * different dimensions. Heat is the short-term enforcement attention that a
 * reputation dimension alone cannot express, and an investigation is the
 * slow-burning consequence of sustained heat.
 *
 * Nothing here is a permanent lock: reputation decays toward zero, heat decays
 * faster when you lie low, and investigations close when attention drops.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { getWorldRegistry } from '../engine/registry/world';
import { heatReduction } from './modifiers';
import { playerModifiers } from './progression';
import { pushNotification, round2 } from './state';
import type { GameState, ID, ReputationDimension, ReputationState } from './types';

const B = getBalance();

export const DIMENSIONS: ReputationDimension[] = [
  'global',
  'legal',
  'criminal',
  'business',
  'crew',
  'underground',
  'digital',
];

export const DIMENSION_LABELS: Record<ReputationDimension, string> = {
  global: 'World standing',
  legal: 'Law-abiding',
  criminal: 'Underworld',
  business: 'Commercial',
  crew: 'Employer',
  underground: 'Black market',
  digital: 'Digital identity',
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function reputationLabel(value: number): string {
  if (value <= -70) return 'Notorious';
  if (value <= -35) return 'Disliked';
  if (value <= -10) return 'Poor';
  if (value < 10) return 'Unknown';
  if (value < 35) return 'Respected';
  if (value < 70) return 'Prominent';
  return 'Legendary';
}

/**
 * Change one reputation dimension.
 *
 * Positive changes are scaled by the player's reputation-gain modifier (skills,
 * perks, diplomacy); negative changes are not, so you cannot build a reputation
 * engine that makes consequences cheap.
 */
export function changeReputation(
  state: GameState,
  dimension: ReputationDimension,
  delta: number,
  reason: string,
): number {
  if (!Number.isFinite(delta) || delta === 0) return 0;
  const rep = state.player.reputation;
  const before = rep.dimensions[dimension];
  const applied = delta > 0 ? delta * repGainMultiplier(state) : delta;
  const after = round2(clamp(before + applied, B.reputation.min, B.reputation.max));
  rep.dimensions[dimension] = after;
  rep.recentChanges.push({ day: state.world.day, dimension, delta: round2(after - before), reason });
  if (rep.recentChanges.length > 60) rep.recentChanges.splice(0, rep.recentChanges.length - 60);

  const swing = after - before;
  if (Math.abs(swing) >= 12) {
    pushNotification(state, {
      kind: swing > 0 ? 'success' : 'warning',
      title: `${DIMENSION_LABELS[dimension]} reputation ${swing > 0 ? 'improved' : 'damaged'}`,
      body: `${reason} (${swing > 0 ? '+' : ''}${swing.toFixed(1)} → ${after.toFixed(1)}, ${reputationLabel(after)})`,
      link: '/game/progression',
    });
  }
  return round2(swing);
}

function repGainMultiplier(state: GameState): number {
  return playerModifiers(state).getMul('reputation.gainMultiplier');
}

export function changeRegionalReputation(state: GameState, regionId: ID, delta: number, reason: string): void {
  if (!Number.isFinite(delta) || delta === 0) return;
  const rep = state.player.reputation;
  const current = rep.regional[regionId] ?? 0;
  rep.regional[regionId] = round2(clamp(current + delta, B.reputation.min, B.reputation.max));
  rep.recentChanges.push({ day: state.world.day, dimension: `region:${regionId}`, delta: round2(delta), reason });
}

export function changeLocalReputation(state: GameState, locationId: ID, delta: number, reason: string): void {
  if (!Number.isFinite(delta) || delta === 0) return;
  const rep = state.player.reputation;
  const current = rep.local[locationId] ?? 0;
  rep.local[locationId] = round2(clamp(current + delta, B.reputation.min, B.reputation.max));
  // Recorded like every other dimension: the UI has to be able to answer "why is
  // my standing in this city what it is" (spec §40).
  rep.recentChanges.push({ day: state.world.day, dimension: `local:${locationId}`, delta: round2(delta), reason });
}

export function regionalReputation(state: GameState, regionId: ID): number {
  return state.player.reputation.regional[regionId] ?? 0;
}

export function localReputation(state: GameState, locationId: ID): number {
  return state.player.reputation.local[locationId] ?? 0;
}

/**
 * Effective reputation at a location: the global dimension plus the regional and
 * local adjustments, which is what NPCs and enforcement actually react to.
 */
export function effectiveReputationAt(state: GameState, dimension: ReputationDimension, locationId: ID): number {
  const world = getWorldRegistry();
  const location = world.location(locationId);
  const base = state.player.reputation.dimensions[dimension];
  const regional = location ? regionalReputation(state, location.regionId) : 0;
  const local = localReputation(state, locationId);
  return round2(clamp(base + regional * 0.35 + local * 0.25, B.reputation.min, B.reputation.max));
}

/* ------------------------------------------------------------------ */
/* Heat and investigations                                             */
/* ------------------------------------------------------------------ */

export function addHeat(state: GameState, amount: number, reason: string): number {
  if (!Number.isFinite(amount) || amount <= 0) return state.player.reputation.heat;
  const rep = state.player.reputation;
  const reduction = heatReduction(playerModifiers(state));
  const applied = round2(amount * (1 - reduction) * state.config.difficultyModifiers.enforcementMultiplier);
  rep.heat = round2(clamp(rep.heat + applied, 0, 200));
  rep.recentChanges.push({ day: state.world.day, dimension: 'heat', delta: applied, reason });
  if (rep.recentChanges.length > 60) rep.recentChanges.splice(0, rep.recentChanges.length - 60);

  if (rep.investigationStartedDay === null && rep.heat >= B.enforcement.investigationOpenHeatThreshold) {
    startInvestigation(state, reason);
  }
  return rep.heat;
}

export function reduceHeat(state: GameState, amount: number, reason: string): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const rep = state.player.reputation;
  rep.heat = round2(clamp(rep.heat - amount, 0, 200));
  rep.recentChanges.push({ day: state.world.day, dimension: 'heat', delta: -amount, reason });
}

export function startInvestigation(state: GameState, reason: string): void {
  const rep = state.player.reputation;
  if (rep.investigationStartedDay !== null) return;
  rep.investigationStartedDay = state.world.day;
  rep.investigation = 1;
  pushNotification(state, {
    kind: 'danger',
    title: 'You are under investigation',
    body: `Enforcement has opened a file on you: ${reason}. Investigation pressure builds daily; raids and arrests follow at high levels. Lie low, launder carefully, or buy influence.`,
    link: '/game/progression',
    metrics: [{ label: 'Heat', value: rep.heat.toFixed(0) }],
  });
}

export function closeInvestigation(state: GameState, reason: string): void {
  const rep = state.player.reputation;
  if (rep.investigationStartedDay === null) return;
  rep.investigationStartedDay = null;
  rep.investigation = 0;
  pushNotification(state, {
    kind: 'success',
    title: 'Investigation closed',
    body: reason,
    link: '/game/progression',
  });
}

export function isUnderInvestigation(state: GameState): boolean {
  return state.player.reputation.investigationStartedDay !== null;
}

/** Add tracing pressure from digital/underground activity. */
export function addTraceHeat(state: GameState, amount: number, reason: string): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const u = state.player.underground;
  const vpnDamping = 1 - clamp(u.vpnQuality, 0, 0.85);
  u.traceHeat = round2(clamp(u.traceHeat + amount * vpnDamping, 0, 200));
  if (u.traceHeat > 40) addHeat(state, amount * 0.35, reason);
}

/* ------------------------------------------------------------------ */
/* Daily tick                                                          */
/* ------------------------------------------------------------------ */

export interface ReputationTickResult {
  heatDecayed: number;
  investigationDelta: number;
  investigationClosed: boolean;
  investigationStarted: boolean;
  digitalReputationDelta: number;
}

export function reputationTick(state: GameState, rng: Rng): ReputationTickResult {
  const rep: ReputationState = state.player.reputation;
  const day = state.world.day;
  const result: ReputationTickResult = {
    heatDecayed: 0,
    investigationDelta: 0,
    investigationClosed: false,
    investigationStarted: false,
    digitalReputationDelta: 0,
  };

  // Reputation drifts toward zero: nobody stays famous forever.
  for (const dim of DIMENSIONS) {
    const value = rep.dimensions[dim];
    if (value === 0) continue;
    const drift = B.reputation.decayPerDayTowardZero * (value > 0 ? 1 : 1.35);
    const next = Math.abs(value) <= drift ? 0 : value - Math.sign(value) * drift;
    rep.dimensions[dim] = round2(next);
  }
  for (const [key, value] of Object.entries(rep.regional)) {
    if (value === 0) continue;
    const next = Math.abs(value) <= B.reputation.decayPerDayTowardZero ? 0 : value - Math.sign(value) * B.reputation.decayPerDayTowardZero;
    rep.regional[key] = round2(next);
  }
  for (const [key, value] of Object.entries(rep.local)) {
    if (value === 0) continue;
    const next = Math.abs(value) <= B.reputation.decayPerDayTowardZero * 1.4 ? 0 : value - Math.sign(value) * B.reputation.decayPerDayTowardZero * 1.4;
    rep.local[key] = round2(next);
  }

  // Heat decays faster when you are quiet (no illegal deals today).
  const before = rep.heat;
  if (rep.heat > 0) {
    const decay = B.reputation.heatDecayPerDay * (1 + (isUnderInvestigation(state) ? -0.35 : 0.4));
    rep.heat = round2(clamp(rep.heat - Math.max(0, decay), 0, 200));
    result.heatDecayed = round2(before - rep.heat);
  }

  // Investigations build while heat is high, and close when it drops.
  if (isUnderInvestigation(state)) {
    const progress =
      B.enforcement.investigationProgressPerDay *
      state.config.difficultyModifiers.enforcementMultiplier *
      (0.4 + clamp(rep.heat / 100, 0, 1.4)) *
      rng.float(0.75, 1.25);
    rep.investigation = round2(clamp(rep.investigation + progress, 0, 100));
    result.investigationDelta = round2(progress);
    if (rep.heat <= B.enforcement.investigationCloseHeatThreshold && rep.investigation < 45) {
      closeInvestigation(state, 'Enforcement lost interest — your heat dropped below the threshold.');
      result.investigationClosed = true;
    }
  } else if (rep.heat >= B.enforcement.investigationOpenHeatThreshold) {
    startInvestigation(state, 'Sustained heat attracted enforcement attention.');
    result.investigationStarted = true;
  }

  // Digital reputation decays unless maintained by activity.
  const u = state.player.underground;
  if (u.digitalReputation > 0) {
    const decay = B.underground.digitalReputationDecayPerDay;
    u.digitalReputation = round2(clamp(u.digitalReputation - decay, 0, 100));
    result.digitalReputationDelta = round2(-decay);
  }
  if (u.traceHeat > 0) {
    u.traceHeat = round2(clamp(u.traceHeat - B.underground.heatDecayPerDay, 0, 200));
  }
  if (u.compromised && u.compromisedUntilDay !== null && day >= u.compromisedUntilDay) {
    u.compromised = false;
    u.compromisedUntilDay = null;
  }

  // Location heat decays too (see world.stepWorld for the jurisdiction copy).
  return result;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface ReputationSummary {
  dimensions: { dimension: ReputationDimension; label: string; value: number; label2: string }[];
  heat: number;
  heatLabel: string;
  investigation: number;
  investigationActive: boolean;
  investigationDays: number | null;
  digitalReputation: number;
  traceHeat: number;
  overall: number;
  recentChanges: ReputationState['recentChanges'];
  regional: { regionId: ID; value: number }[];
  local: { locationId: ID; value: number }[];
}

export function heatLabel(heat: number): string {
  if (heat < 10) return 'Cold — nobody is looking';
  if (heat < 30) return 'Warm — occasional attention';
  if (heat < 60) return 'Hot — active interest';
  if (heat < 90) return 'Burning — surveillance likely';
  return 'Critical — arrest or raid imminent';
}

export function reputationSummary(state: GameState): ReputationSummary {
  const rep = state.player.reputation;
  const overall = round2(
    DIMENSIONS.reduce((sum, d) => sum + rep.dimensions[d], 0) / DIMENSIONS.length,
  );
  return {
    dimensions: DIMENSIONS.map((d) => ({
      dimension: d,
      label: DIMENSION_LABELS[d],
      value: rep.dimensions[d],
      label2: reputationLabel(rep.dimensions[d]),
    })),
    heat: rep.heat,
    heatLabel: heatLabel(rep.heat),
    investigation: rep.investigation,
    investigationActive: isUnderInvestigation(state),
    investigationDays: rep.investigationStartedDay !== null ? state.world.day - rep.investigationStartedDay : null,
    digitalReputation: state.player.underground.digitalReputation,
    traceHeat: state.player.underground.traceHeat,
    overall,
    recentChanges: rep.recentChanges.slice(-24).reverse(),
    regional: Object.entries(rep.regional)
      .filter(([, v]) => v !== 0)
      .map(([regionId, value]) => ({ regionId, value })),
    local: Object.entries(rep.local)
      .filter(([, v]) => v !== 0)
      .map(([locationId, value]) => ({ locationId, value })),
  };
}
