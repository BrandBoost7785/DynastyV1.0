/**
 * PlayerModifiers — resolves skills + perks into numeric effects.
 *
 * Convention:
 *  - keys ending in `Multiplier`/`.multiplier` are **multiplicative**
 *    (combined by product, identity 1)
 *  - every other key is **additive** (combined by sum, identity 0) and
 *    represents a fraction unless the domain says otherwise
 *
 * Domains call `mods.get('trade.spreadReduction')` rather than inspecting
 * perks, so new perks that grant a known key work without code changes.
 */

import { PERK_BY_ID, SKILL_BY_ID } from '../engine/registry/people';
import type { ID, ProgressionState } from './types';

export interface Modifiers {
  /** Additive modifier (0 when absent). */
  get(key: string): number;
  /** Multiplicative modifier (1 when absent). */
  getMul(key: string): number;
  /** Current level of a skill (0 when untrained). */
  skill(id: ID): number;
  hasPerk(id: ID): boolean;
  /** All resolved modifier keys — used by the debug/inspection UI. */
  dump(): Record<string, number>;
}

function isMultiplierKey(key: string): boolean {
  return key.endsWith('Multiplier') || key.endsWith('.multiplier');
}

export function buildModifiers(progression: ProgressionState): Modifiers {
  const add: Record<string, number> = {};
  const mul: Record<string, number> = {};

  for (const perkId of progression.perks) {
    const perk = PERK_BY_ID[perkId];
    if (!perk) continue;
    for (const [key, value] of Object.entries(perk.modifiers)) {
      if (isMultiplierKey(key)) {
        mul[key] = (mul[key] ?? 1) * value;
      } else {
        add[key] = (add[key] ?? 0) + value;
      }
    }
  }

  const skills = progression.skills;

  return {
    get(key) {
      return add[key] ?? 0;
    },
    getMul(key) {
      return mul[key] ?? 1;
    },
    skill(id) {
      return skills[id] ?? 0;
    },
    hasPerk(id) {
      return progression.perks.includes(id);
    },
    dump() {
      const out: Record<string, number> = { ...add };
      for (const [k, v] of Object.entries(mul)) out[k] = v;
      return out;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Named skill effects used across domains                             */
/* ------------------------------------------------------------------ */

/** Buy/sell spread reduction from trading + negotiation skill and perks. */
export function spreadReduction(m: Modifiers): number {
  return Math.min(
    0.6,
    m.skill('trading') * 0.0045 + m.skill('negotiation') * 0.003 + m.get('trade.spreadReduction'),
  );
}

/** Reduction of the price impact a player trade has on a market. */
export function priceImpactReduction(m: Modifiers): number {
  return Math.min(0.7, m.skill('trading') * 0.008 + m.skill('market_analysis') * 0.006 + m.get('trade.priceImpactReduction'));
}

/** Fractional reduction of travel cost. */
export function travelCostReduction(m: Modifiers): number {
  return Math.min(0.45, m.skill('logistics') * 0.004 + m.get('travel.costReduction'));
}

/** Fractional reduction of travel time (days), floored at 1 day for long hauls. */
export function travelTimeReduction(m: Modifiers): number {
  return Math.min(0.4, m.skill('logistics') * 0.005 + m.get('travel.timeReduction'));
}

/** Reduction of interdiction/seizure probability when moving goods. */
export function detectionReduction(m: Modifiers): number {
  return Math.min(
    0.85,
    m.skill('smuggling') * 0.006 + m.skill('stealth') * 0.004 + m.skill('forgery') * 0.003 + m.get('smuggling.detectionReduction'),
  );
}

/** Effective annual interest rate multiplier on borrowed money. */
export function interestReduction(m: Modifiers): number {
  return Math.min(0.45, m.skill('finance') * 0.006 + m.get('finance.interestReduction'));
}

/** Reduction of laundering fee. */
export function launderingFeeReduction(m: Modifiers): number {
  return Math.min(0.5, m.skill('laundering') * 0.005 + m.skill('accounting') * 0.002 + m.get('finance.launderingFeeReduction'));
}

/** Reduction of laundering detection chance. */
export function launderingDetectionReduction(m: Modifiers): number {
  return Math.min(0.7, m.skill('laundering') * 0.006 + m.skill('accounting') * 0.003 + m.get('finance.launderingDetectionReduction'));
}

/** Reduction of taxes paid. */
export function taxReduction(m: Modifiers): number {
  return Math.min(0.55, m.skill('accounting') * 0.004 + m.skill('law') * 0.003 + m.get('finance.taxReduction'));
}

/** Production efficiency bonus. */
export function productionEfficiencyBonus(m: Modifiers): number {
  return m.skill('production') * 0.006 + m.skill('engineering') * 0.004 + m.get('production.efficiencyBonus');
}

/** Production quality bonus. */
export function productionQualityBonus(m: Modifiers): number {
  return m.skill('production') * 0.004 + m.skill('chemistry') * 0.005 + m.get('production.qualityBonus');
}

/** Business revenue bonus. */
export function businessRevenueBonus(m: Modifiers): number {
  return m.skill('business_management') * 0.005 + m.skill('marketing') * 0.004 + m.get('business.revenueBonus');
}

/** Business opex reduction. */
export function businessOpexReduction(m: Modifiers): number {
  return Math.min(0.4, m.skill('business_management') * 0.003 + m.get('business.opexReduction'));
}

/** Crew salary reduction from negotiation/HR. */
export function salaryReduction(m: Modifiers): number {
  return Math.min(0.35, m.skill('human_resources') * 0.004 + m.skill('negotiation') * 0.002 + m.get('crew.salaryReduction'));
}

/** Crew loyalty bonus. */
export function loyaltyBonus(m: Modifiers): number {
  return m.skill('human_resources') * 0.4 + m.skill('leadership') * 0.3 + m.get('crew.loyaltyBonus');
}

/** Reduction of theft/spoilage losses. */
export function lossReduction(m: Modifiers): number {
  return Math.min(0.8, m.skill('storage_management') * 0.006 + m.get('logistics.theftReduction') + m.get('logistics.spoilageReduction') * 0.5);
}

/** XP multiplier. */
export function xpMultiplier(m: Modifiers): number {
  return m.getMul('xp.multiplier');
}

/** Combat accuracy bonus. */
export function combatAccuracyBonus(m: Modifiers): number {
  return m.skill('firearms') * 0.008 + m.skill('combat') * 0.004 + m.get('combat.accuracyBonus');
}

/** Combat damage bonus. */
export function combatDamageBonus(m: Modifiers): number {
  return m.skill('combat') * 0.006 + m.skill('tactics') * 0.005 + m.get('combat.damageBonus');
}

/** Chance to flee an encounter successfully. */
export function fleeBonus(m: Modifiers): number {
  return Math.min(0.5, m.skill('stealth') * 0.006 + m.get('combat.fleeBonus'));
}

/** Bribe success bonus. */
export function bribeBonus(m: Modifiers): number {
  return Math.min(0.5, m.skill('bribery') * 0.008 + m.skill('negotiation') * 0.004 + m.get('combat.bribeBonus'));
}

/** Intimidation success bonus. */
export function intimidationBonus(m: Modifiers): number {
  return Math.min(0.5, m.skill('intimidation') * 0.008 + m.get('combat.intimidationBonus'));
}

/** Underground heat accumulation reduction. */
export function heatReduction(m: Modifiers): number {
  return Math.min(0.75, m.skill('stealth') * 0.004 + m.skill('hacking') * 0.003 + m.get('underground.heatReduction'));
}

/** Hack success bonus. */
export function hackBonus(m: Modifiers): number {
  return m.skill('hacking') * 0.012 + m.skill('technology') * 0.005;
}

/** Automation uptime / error reduction. */
export function automationErrorReduction(m: Modifiers): number {
  return Math.min(0.7, m.skill('automation') * 0.007 + m.skill('leadership') * 0.003 + m.get('automation.errorReduction'));
}

/** Extra actions per day. */
export function actionPointBonus(m: Modifiers): number {
  return Math.max(0, Math.round(m.get('action.pointsBonus')));
}

/** Additional personal carrying capacity in kg. */
export function personalCapacityKgBonus(m: Modifiers): number {
  return Math.max(0, m.get('inventory.capacityKgBonus'));
}

/** Additional personal carrying capacity in litres. */
export function personalCapacityLBonus(m: Modifiers): number {
  return Math.max(0, m.get('inventory.capacityLBonus'));
}

/** Enforcement prosecution/fine reduction. */
export function enforcementReduction(m: Modifiers): number {
  return Math.min(0.7, m.skill('law') * 0.005 + m.get('enforcement.prosecutionReduction'));
}

/** Reputation gain multiplier. */
export function reputationGainMultiplier(m: Modifiers): number {
  return m.getMul('reputation.gainMultiplier') * (1 + m.skill('diplomacy') * 0.01);
}

/** Span-of-control bonus for delegation. */
export function spanOfControlBonus(m: Modifiers): number {
  return Math.max(0, Math.round(m.skill('leadership') / 4 + m.get('crew.capacityBonus')));
}

/** Whether a skill is known to the registry (guards typos in data). */
export function isKnownSkill(id: ID): boolean {
  return SKILL_BY_ID[id] !== undefined;
}
