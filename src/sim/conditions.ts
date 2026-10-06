/**
 * Condition evaluation — the single place that decides "is this event/mission
 * available right now?".
 *
 * Every event and mission availability rule is authored as data
 * (`EventCondition`). This evaluator is generic: adding a new condition kind to
 * the registry means adding one case here and nothing else. Unknown kinds fail
 * *closed* for content gating (so a typo cannot silently unlock content) and
 * are reported through diagnostics.
 */

import { Rng } from '../engine/rng';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { getWorldRegistry } from '../engine/registry/world';
import { cyclePhaseLabel } from './world';
import { computeNetWorth, pushDiagnostic } from './state';
import type { EventCondition } from '../engine/registry/events';
import type { GameState, ID, LocationDef } from './types';

/** Everything a condition may look at. Kept explicit so gating stays auditable. */
export interface ConditionContext {
  state: GameState;
  /** Deterministic stream; `probability` conditions consume it. */
  rng?: Rng;
  /** Scope anchor for `here` conditions. */
  locationId?: ID;
  /** Definition being gated, used for diagnostics. */
  defId?: ID;
}

export function makeContext(
  state: GameState,
  opts: { rng?: Rng; locationId?: ID; defId?: ID } = {},
): ConditionContext {
  return {
    state,
    rng: opts.rng,
    locationId: opts.locationId ?? state.player.locationId,
    defId: opts.defId,
  };
}

function reputationOf(state: GameState, dimension: string): number {
  return state.player.reputation.dimensions[dimension as keyof typeof state.player.reputation.dimensions] ?? 0;
}

function locationOf(state: GameState, locationId: ID): LocationDef | undefined {
  return getWorldRegistry().location(locationId);
}

export interface ConditionResult {
  ok: boolean;
  /** Human-readable reason when the condition fails (surfaced in the UI). */
  reason?: string;
}

export function explainCondition(state: GameState, condition: EventCondition): ConditionResult {
  switch (condition.kind) {
    case 'min_day':
      return { ok: state.world.day >= condition.day, reason: `Requires day ${condition.day}` };
    case 'max_day':
      return { ok: state.world.day <= condition.day, reason: `Only available until day ${condition.day}` };
    case 'probability':
      return { ok: true, reason: `${Math.round(condition.chance * 100)}% chance` };
    case 'player_level_min':
      return { ok: state.player.progression.level >= condition.level, reason: `Requires level ${condition.level}` };
    case 'player_level_max':
      return { ok: state.player.progression.level <= condition.level, reason: `Requires level ${condition.level} or below` };
    case 'player_net_worth_min':
      return {
        ok: computeNetWorth(state).total >= condition.amount,
        reason: `Requires net worth of ${condition.amount.toLocaleString('en-US')}`,
      };
    case 'player_net_worth_max':
      return {
        ok: computeNetWorth(state).total <= condition.amount,
        reason: `Requires net worth below ${condition.amount.toLocaleString('en-US')}`,
      };
    case 'player_cash_min':
      return { ok: cashOf(state) >= condition.amount, reason: `Requires ${condition.amount.toLocaleString('en-US')} in cash` };
    case 'player_heat_min':
      return { ok: state.player.reputation.heat >= condition.value, reason: `Requires heat of ${condition.value}` };
    case 'player_heat_max':
      return { ok: state.player.reputation.heat <= condition.value, reason: `Requires heat below ${condition.value}` };
    case 'player_reputation_min':
      return { ok: reputationOf(state, condition.dimension) >= condition.value, reason: `Requires ${condition.dimension} reputation ${condition.value}` };
    case 'player_reputation_max':
      return { ok: reputationOf(state, condition.dimension) <= condition.value, reason: `Requires ${condition.dimension} reputation below ${condition.value}` };
    case 'player_owns_property':
      return { ok: state.player.properties.length > 0, reason: 'Requires owning property' };
    case 'player_owns_business':
      return { ok: state.player.businesses.length > 0, reason: 'Requires owning a business' };
    case 'player_has_crew':
      return { ok: state.player.crew.length >= condition.min, reason: `Requires ${condition.min} employee(s)` };
    case 'player_has_loans':
      return { ok: state.player.loans.some((l) => l.status === 'active'), reason: 'Requires an outstanding loan' };
    case 'player_has_delinquent_loan':
      return {
        ok: state.player.loans.some((l) => l.status === 'active' && (l.daysDelinquent > 0 || l.pressure > 0.35)) || state.player.loans.some((l) => l.status === 'defaulted'),
        reason: 'Requires a delinquent loan',
      };
    case 'player_holds_illegal_inventory':
      return { ok: holdsIllegalInventory(state), reason: 'Requires carrying illegal goods' };
    case 'player_in_location_kind': {
      const loc = locationOf(state, state.player.locationId);
      return { ok: loc !== undefined && condition.kinds.includes(loc.kind), reason: `Requires being in a ${condition.kinds.join(' or ')}` };
    }
    case 'player_in_location':
      return { ok: condition.locationIds.includes(state.player.locationId), reason: `Requires being in one of ${condition.locationIds.length} specific locations` };
    case 'player_has_underground_access':
      return { ok: state.player.underground.accessUnlocked, reason: 'Requires darknet access' };
    case 'player_has_inventory_category':
      return { ok: holdsCategory(state, condition.category), reason: `Requires holding ${condition.category} goods` };
    case 'player_stock_holdings_min':
      return { ok: stockValue(state) >= condition.amount, reason: `Requires ${condition.amount.toLocaleString('en-US')} in stocks` };
    case 'player_crypto_holdings_min':
      return { ok: cryptoValue(state) >= condition.amount, reason: `Requires ${condition.amount.toLocaleString('en-US')} in crypto` };
    case 'inflation_above':
      return { ok: state.world.inflationRate > condition.value, reason: `Requires inflation above ${(condition.value * 100).toFixed(1)}%` };
    case 'inflation_below':
      return { ok: state.world.inflationRate < condition.value, reason: `Requires inflation below ${(condition.value * 100).toFixed(1)}%` };
    case 'interest_rate_above':
      return { ok: state.world.interestRate > condition.value, reason: `Requires interest rates above ${(condition.value * 100).toFixed(1)}%` };
    case 'cycle_phase_in':
      return { ok: condition.phases.includes(cyclePhaseLabel(state.world.cyclePhase)), reason: `Requires the cycle to be in ${condition.phases.join('/')}` };
    case 'global_sentiment_below':
      return { ok: state.world.globalSentiment < condition.value, reason: `Requires global sentiment below ${condition.value}` };
    case 'global_sentiment_above':
      return { ok: state.world.globalSentiment > condition.value, reason: `Requires global sentiment above ${condition.value}` };
    case 'stock_index_change_below':
      return { ok: state.world.indicators.stockIndexChange30d < condition.value, reason: `Requires a 30-day index change below ${(condition.value * 100).toFixed(1)}%` };
    case 'faction_at_war':
      return {
        ok: Object.values(state.world.factions).some((f) => f.atWarWith.length > 0),
        reason: 'Requires at least one faction at war',
      };
    case 'active_shock_max':
      return { ok: state.world.shocks.length <= condition.count, reason: `Requires at most ${condition.count} active shocks` };
    case 'no_active_event':
      return {
        ok: !state.world.activeEvents.some((e) => e.defId === condition.defId),
        reason: `Already happening (${condition.defId})`,
      };
    default:
      return { ok: false, reason: 'Unsupported condition' };
  }
}

function cashOf(state: GameState): number {
  return state.player.accounts.reduce((sum, a) => sum + (a.frozenUntilDay !== null && a.frozenUntilDay > state.world.day ? 0 : a.balance), 0);
}

function holdsIllegalInventory(state: GameState): boolean {
  const registry = getCommodityRegistry();
  return state.player.inventory.some((stack) => {
    const def = registry.get(stack.commodityId);
    return def !== undefined && (def.legality === 'illegal' || def.legality === 'contraband' || def.legality === 'restricted');
  });
}

function holdsCategory(state: GameState, category: string): boolean {
  const registry = getCommodityRegistry();
  return state.player.inventory.some((stack) => registry.get(stack.commodityId)?.category === category);
}

function stockValue(state: GameState): number {
  return state.player.stockHoldings.reduce((sum, h) => sum + h.shares * (state.world.companies[h.companyId]?.price ?? h.avgCost), 0);
}

function cryptoValue(state: GameState): number {
  return state.player.cryptoHoldings.reduce((sum, h) => sum + h.amount * (state.world.cryptoAssets[h.assetId]?.price ?? h.avgCost), 0);
}

/**
 * Evaluate one condition. Probability conditions consume the context RNG so the
 * outcome is deterministic for a given seed and day.
 */
export function evaluateCondition(ctx: ConditionContext, condition: EventCondition): boolean {
  const result = explainCondition(ctx.state, condition);
  if (!result.ok) return false;
  if (condition.kind === 'probability') {
    if (!ctx.rng) return true;
    if (!ctx.rng.chance(condition.chance)) {
      if (ctx.defId) {
        pushDiagnostic(ctx.state, {
          system: 'events',
          level: 'debug',
          message: `${ctx.defId}: probability gate failed (${Math.round(condition.chance * 100)}%)`,
          data: { chance: condition.chance, day: ctx.state.world.day },
        });
      }
      return false;
    }
  }
  return true;
}

export function evaluateConditions(ctx: ConditionContext, conditions: readonly EventCondition[]): boolean {
  return conditions.every((c) => evaluateCondition(ctx, c));
}

/** First failing reason, for UI tooltips explaining why content is hidden. */
export function firstFailure(state: GameState, conditions: readonly EventCondition[]): string | null {
  for (const c of conditions) {
    const result = explainCondition(state, c);
    if (!result.ok) return result.reason ?? null;
  }
  return null;
}
