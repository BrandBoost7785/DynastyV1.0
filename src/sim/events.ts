/**
 * Events — the hybrid intelligent event engine (spec §16, §40).
 *
 * Events are data (`engine/registry/events.ts`): a scope, a weight, conditions,
 * effects and chain links. This module is the interpreter:
 *
 *   • **Selection** is weighted by severity, scope probability and cooldowns, and
 *     gated by the generic condition evaluator, so an event can only fire when the
 *     world and the player actually satisfy its preconditions.
 *   • **Effects** are applied by a single dispatcher. Every effect kind in the
 *     registry union is implemented; adding a new kind means adding one case here
 *     and nothing else.
 *   • **Chains** are scheduled as follow-on events with a depth limit, which is
 *     how a port strike becomes a regional shortage becomes a price spike.
 *   • **Explanation** is first-class: every fired event becomes an `ActiveEvent`
 *     with its applied effects serialised, a news item, and a human-readable
 *     description of each effect, because the UI must say *why* values changed.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { COMPANY_BY_ID, FACTION_BY_ID } from '../engine/registry/actors';
import { EVENT_BY_ID, EVENTS, EVENTS_BY_SCOPE } from '../engine/registry/events';
import type { EventDef, EventEffect } from '../engine/registry/events';
import { COUNTRY_BY_ID } from '../engine/registry/regions';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { getWorldRegistry } from '../engine/registry/world';
import { applyArrest, startCombat } from './combat';
import { changeStanding, provokeWar } from './factions';
import { makeContext, evaluateConditions, type ConditionContext } from './conditions';
import { offerMission } from './missions';
import { bumpCounter, counter, grantXp, playerModifiers, setCounter } from './progression';
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
import { addShock, pushNews } from './world';
import type {
  ActiveEvent,
  CommodityCategory,
  EventScope,
  GameState,
  ID,
  LocationState,
  ReputationDimension,
  Severity,
} from './types';

const B = getBalance();
const worldReg = getWorldRegistry();
const registry = getCommodityRegistry();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

export interface FiredEvent {
  event: ActiveEvent;
  defId: ID;
  scope: EventScope;
  severity: Severity;
  reports: EffectReport[];
  chained: ID[];
}

export interface EventTickResult {
  fired: FiredEvent[];
  expired: ID[];
  scheduled: ID[];
  candidates: number;
}

export function eventTick(state: GameState, rng: Rng): EventTickResult {
  const result: EventTickResult = { fired: [], expired: [], scheduled: [], candidates: 0 };
  const day = state.world.day;

  // Scheduled chain reactions fire first so they appear in causal order.
  const due = state.world.scheduledEvents.filter((s) => s.day <= day);
  state.world.scheduledEvents = state.world.scheduledEvents.filter((s) => s.day > day);
  for (const scheduled of due) {
    if (scheduled.chainDepth > B.events.maxChainDepth) continue;
    const def = EVENT_BY_ID[scheduled.defId];
    if (!def) continue;
    const fired = fireEvent(state, rng, def, { chainDepth: scheduled.chainDepth, sourceEventId: scheduled.sourceEventId });
    if (fired) result.fired.push(fired);
  }

  expireEvents(state, result);

  const budget = Math.max(0, B.events.maxEventsPerDay - result.fired.length);
  if (budget <= 0) return result;

  const scopes: { scope: EventScope; chance: number }[] = [
    { scope: 'local', chance: B.events.localEventChance },
    { scope: 'regional', chance: B.events.regionalEventChance },
    { scope: 'national', chance: B.events.regionalEventChance * 0.8 },
    { scope: 'global', chance: B.events.globalEventChance },
  ];

  for (const { scope, chance } of scopes) {
    if (result.fired.length >= B.events.maxEventsPerDay) break;
    if (!rng.chance(chance * B.events.baseEventChancePerDay * (0.6 + state.world.indicators.globalRiskAppetite))) continue;
    const def = selectEvent(state, rng, scope);
    if (!def) continue;
    const fired = fireEvent(state, rng, def, { chainDepth: 0 });
    if (fired) result.fired.push(fired);
  }

  result.candidates = EVENTS.length;
  return result;
}

function expireEvents(state: GameState, result: EventTickResult): void {
  const day = state.world.day;
  const keep: ActiveEvent[] = [];
  for (const event of state.world.activeEvents) {
    if (event.expiresDay !== null && event.expiresDay <= day) {
      result.expired.push(event.defId);
      continue;
    }
    keep.push(event);
  }
  state.world.activeEvents = keep;
  // Shocks expire in world.stepWorld/trim; event cooldowns expire with the day.
  for (const [defId, until] of Object.entries(state.world.eventCooldowns)) {
    if (until <= day) delete state.world.eventCooldowns[defId];
  }
}

function selectEvent(state: GameState, rng: Rng, scope: EventScope): EventDef | null {
  const day = state.world.day;
  const ctx: ConditionContext = makeContext(state, { rng, defId: undefined });
  const candidates = (EVENTS_BY_SCOPE[scope] ?? []).filter((def) => {
    if ((state.world.eventCooldowns[def.id] ?? 0) > day) return false;
    return evaluateConditions(ctx, def.conditions);
  });
  if (candidates.length === 0) return null;

  const weights = candidates.map((def) => {
    const severityWeight = B.events.severityWeights[def.severity] ?? 0.2;
    // Rarer, more severe events are gated by their own conditions; the weight
    // keeps the mix dominated by ordinary news with occasional shocks.
    const novelty = state.world.activeEvents.some((e) => e.defId === def.id) ? 0.25 : 1;
    return Math.max(0.0001, def.weight * severityWeight * novelty);
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = rng.float(0, 1) * total;
  for (let i = 0; i < candidates.length; i += 1) {
    roll -= weights[i]!;
    if (roll <= 0) return candidates[i]!;
  }
  return candidates[candidates.length - 1]!;
}

/* ------------------------------------------------------------------ */
/* Firing                                                              */
/* ------------------------------------------------------------------ */

export interface FireOptions {
  chainDepth?: number;
  sourceEventId?: ID;
  locationId?: ID;
}

export function fireEvent(state: GameState, rng: Rng, def: EventDef, opts: FireOptions = {}): FiredEvent | null {
  const day = state.world.day;
  const chainDepth = opts.chainDepth ?? 0;

  // Resolve the affected geography.
  const { locationIds, regionIds, epicentre } = resolveTargets(state, rng, def, opts.locationId);
  const duration = def.durationDays ? rng.int(def.durationDays[0], def.durationDays[1]) : null;

  const event: ActiveEvent = {
    id: newId(rng, 'evt'),
    defId: def.id,
    name: def.name,
    description: describeEvent(def, epicentre),
    scope: def.scope,
    severity: def.severity,
    startedDay: day,
    expiresDay: duration !== null ? day + duration : null,
    locationIds,
    regionIds,
    appliedEffects: [],
    chainDepth,
    ...(opts.sourceEventId ? { sourceEventId: opts.sourceEventId } : {}),
    payload: { epicentre: epicentre ?? '', duration: duration ?? 0, severity: def.severity },
  };

  const context: EffectContext = { state, rng, event, def, locationIds, regionIds, epicentre, duration };
  const reports: EffectReport[] = [];
  for (const effect of def.effects) {
    const report = applyEffect(context, effect);
    reports.push(report);
    event.appliedEffects.push(`${effect.kind}: ${report.summary}`);
  }

  state.world.activeEvents.push(event);
  state.world.eventCooldowns[def.id] = day + Math.max(def.cooldownDays, B.events.cooldownDaysDefault);

  // Chains: roll each follow-on and schedule it.
  const chained: ID[] = [];
  for (const link of def.chain) {
    if (chainDepth >= B.events.maxChainDepth) break;
    const follow = EVENT_BY_ID[link.eventId];
    if (!follow) continue;
    if (!rng.chance(link.chance * B.events.chainReactionChance + link.chance * 0.4)) continue;
    const delay = rng.int(link.delayDays[0], link.delayDays[1]);
    state.world.scheduledEvents.push({
      id: newId(rng, 'sch'),
      defId: link.eventId,
      day: day + delay,
      sourceEventId: event.id,
      chainDepth: chainDepth + 1,
    });
    chained.push(link.eventId);
  }

  publishEvent(state, def, event, reports, epicentre, chained);
  pushDiagnostic(state, {
    system: 'events',
    level: def.severity === 'catastrophic' || def.severity === 'major' ? 'warn' : 'info',
    message: `Event fired ${def.id} (${def.scope}/${def.severity}, depth ${chainDepth}) at ${epicentre ?? 'global'}: ${reports.map((r) => r.summary).join(' | ')}`,
    data: { defId: def.id, scope: def.scope, chainDepth, locations: locationIds.length, chained: chained.length },
  });
  bumpCounter(state, 'events_fired');
  bumpCounter(state, `events:${def.category}`);

  return { event, defId: def.id, scope: def.scope, severity: def.severity, reports, chained };
}

function resolveTargets(
  state: GameState,
  rng: Rng,
  def: EventDef,
  preferred?: ID,
): { locationIds: ID[]; regionIds: ID[]; epicentre: ID | null } {
  switch (def.scope) {
    case 'local': {
      if (preferred) return { locationIds: [preferred], regionIds: [], epicentre: preferred };
      if (def.targetsLocation) {
        // Bias toward places the player actually touches, so local events matter.
        const pool: ID[] = [state.player.locationId];
        for (const property of state.player.properties.slice(0, 4)) pool.push(property.locationId);
        for (const business of state.player.businesses.slice(0, 4)) pool.push(business.locationId);
        for (const shipment of state.player.shipments.slice(0, 4)) pool.push(shipment.destinationLocationId);
        const picked = rng.pick(pool) ?? state.player.locationId;
        return { locationIds: [picked], regionIds: [], epicentre: picked };
      }
      return { locationIds: [state.player.locationId], regionIds: [], epicentre: state.player.locationId };
    }
    case 'regional': {
      const regionId = def.targetsLocation
        ? worldReg.requireLocation(rng.pick([state.player.locationId, ...state.player.properties.map((p) => p.locationId)]) ?? state.player.locationId).regionId
        : worldReg.requireLocation(state.player.locationId).regionId;
      return {
        locationIds: worldReg.locationsInRegion(regionId).map((l) => l.id),
        regionIds: [regionId],
        epicentre: null,
      };
    }
    case 'national': {
      const countryId = worldReg.requireLocation(state.player.locationId).countryId;
      return {
        locationIds: worldReg.locationsInCountry(countryId).map((l) => l.id),
        regionIds: [...new Set(worldReg.locationsInCountry(countryId).map((l) => l.regionId))],
        epicentre: null,
      };
    }
    case 'global':
    default:
      return { locationIds: [], regionIds: [], epicentre: null };
  }
  void rng;
}

/** Replace `{location}` in authored copy with the epicentre's name. */
function fill(text: string, epicentre: ID | null, scope: EventScope): string {
  const place = epicentre ? worldReg.location(epicentre)?.name ?? epicentre : scope === 'global' ? 'the world' : 'the region';
  return text.replace(/\{location\}/g, place);
}

function describeEvent(def: EventDef, epicentre: ID | null): string {
  const place = epicentre ? worldReg.location(epicentre)?.name ?? epicentre : def.scope === 'global' ? 'the world' : 'the region';
  const headline = def.headline ?? def.name;
  const body = def.body ?? `A ${def.severity} ${def.category} event affecting ${place}.`;
  return `${fill(headline, epicentre, def.scope)} — ${fill(body, epicentre, def.scope)}`;
}

function publishEvent(state: GameState, def: EventDef, event: ActiveEvent, reports: EffectReport[], epicentre: ID | null, chained: ID[]): void {
  const importance = (def.severity === 'catastrophic' ? 5 : def.severity === 'major' ? 4 : def.severity === 'moderate' ? 3 : 2) as 1 | 2 | 3 | 4 | 5;
  pushNews(state.world, {
    scope: def.scope,
    category:
      def.category === 'economic' || def.category === 'financial'
        ? 'economy'
        : def.category === 'political'
          ? 'politics'
          : def.category === 'corporate'
            ? 'corporate'
            : def.category === 'crime'
              ? 'crime'
              : def.category === 'faction'
                ? 'faction'
                : def.category === 'technology'
                  ? 'technology'
                  : 'market',
    headline: fill(def.headline ?? def.name, epicentre, def.scope),
    body: [
      fill(def.body ?? `${def.severity.charAt(0).toUpperCase()}${def.severity.slice(1)} ${def.category} event.`, epicentre, def.scope),
      reports.length > 0 ? `Effects: ${reports.map((r) => r.summary).join('; ')}.` : '',
      chained.length > 0 ? `Follow-on developments expected: ${chained.map((id) => EVENT_BY_ID[id]?.name ?? id).join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
    locationIds: event.locationIds.slice(0, 8),
    tags: [def.id, def.category, ...(epicentre ? [epicentre] : [])],
    importance,
    eventId: event.id,
    metrics: reports
      .filter((r) => r.metrics.length > 0)
      .slice(0, 4)
      .map((r) => r.metrics[0]!) ,
  });

  // Tell the player when the event touches them directly.
  const affectsPlayer =
    event.locationIds.length === 0 ||
    event.locationIds.includes(state.player.locationId) ||
    reports.some((r) => r.playerImpact !== null);
  if (affectsPlayer) {
    pushNotification(state, {
      kind: importance >= 4 ? 'danger' : importance === 3 ? 'warning' : 'info',
      title: fill(def.name, epicentre, def.scope),
      body: `${reports.map((r) => r.summary).join(' ')}${event.expiresDay !== null ? ` Expected to last until day ${event.expiresDay}.` : ''}`,
      link: '/game/news',
      metrics: reports.flatMap((r) => r.metrics).slice(0, 6),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Effects                                                             */
/* ------------------------------------------------------------------ */

export interface EffectContext {
  state: GameState;
  rng: Rng;
  event: ActiveEvent;
  def: EventDef;
  locationIds: ID[];
  regionIds: ID[];
  epicentre: ID | null;
  duration: number | null;
}

export interface EffectReport {
  kind: EventEffect['kind'];
  summary: string;
  metrics: { label: string; value: string }[];
  /** Set when the effect changed the player's own position. */
  playerImpact: string | null;
}

function report(kind: EventEffect['kind'], summary: string, metrics: { label: string; value: string }[] = [], playerImpact: string | null = null): EffectReport {
  return { kind, summary, metrics, playerImpact };
}

function scopeLocations(ctx: EffectContext, locationScope?: 'here' | 'region' | 'country' | 'global'): ID[] {
  const state = ctx.state;
  switch (locationScope) {
    case 'here':
      return [state.player.locationId];
    case 'region':
      return ctx.regionIds.length > 0 ? ctx.locationIds : worldReg.locationsInRegion(worldReg.requireLocation(state.player.locationId).regionId).map((l) => l.id);
    case 'country':
      return worldReg.locationsInCountry(worldReg.requireLocation(state.player.locationId).countryId).map((l) => l.id);
    case 'global':
    default:
      return ctx.locationIds.length > 0 ? ctx.locationIds : [];
  }
}

function scopeRegions(ctx: EffectContext, locationScope?: 'here' | 'region' | 'country' | 'global'): ID[] {
  switch (locationScope) {
    case 'here':
      return [worldReg.requireLocation(ctx.state.player.locationId).regionId];
    case 'region':
      return ctx.regionIds.length > 0 ? ctx.regionIds : [worldReg.requireLocation(ctx.state.player.locationId).regionId];
    case 'country':
      return [...new Set(worldReg.locationsInCountry(worldReg.requireLocation(ctx.state.player.locationId).countryId).map((l) => l.regionId))];
    default:
      return ctx.regionIds;
  }
}

export function applyEffect(ctx: EffectContext, effect: EventEffect): EffectReport {
  const { state, rng, event } = ctx;
  const duration = effectDuration(ctx, effect);

  switch (effect.kind) {
    case 'demand_shift':
    case 'supply_shift':
    case 'price_shift': {
      const locations = scopeLocations(ctx, effect.locationScope);
      const regions = scopeRegions(ctx, effect.locationScope);
      const modifiers = Object.fromEntries(effect.categories.map((c) => [c, effect.multiplier])) as Partial<Record<CommodityCategory, number>>;
      addShock(state.world, {
        name: `${event.name} (${effect.kind.replace('_shift', '')})`,
        scope: event.scope,
        severity: event.severity,
        startedDay: state.world.day,
        expiresDay: duration !== null ? state.world.day + duration : null,
        demandModifiers: effect.kind === 'demand_shift' ? modifiers : {},
        supplyModifiers: effect.kind === 'supply_shift' ? modifiers : {},
        priceModifiers: effect.kind === 'price_shift' ? modifiers : {},
        locationIds: locations,
        regionIds: regions,
        sourceEventId: event.id,
      }, rng);
      return report(
        effect.kind,
        `${effect.kind === 'demand_shift' ? 'Demand' : effect.kind === 'supply_shift' ? 'Supply' : 'Prices'} ×${effect.multiplier.toFixed(2)} for ${effect.categories.join(', ')}${locations.length > 0 ? ` across ${locations.length} location(s)` : ' globally'}${duration !== null ? ` for ${duration} day(s)` : ''}.`,
        [{ label: 'Multiplier', value: `×${effect.multiplier.toFixed(2)}` }, { label: 'Categories', value: effect.categories.join(', ') }],
        null,
      );
    }

    case 'commodity_demand_shift': {
      const categories = new Set<CommodityCategory>();
      for (const id of effect.commodityIds) {
        const c = registry.get(id);
        if (c) categories.add(c.category);
      }
      const modifiers = Object.fromEntries([...categories].map((c) => [c, effect.multiplier])) as Partial<Record<CommodityCategory, number>>;
      addShock(state.world, {
        name: `${event.name} (commodity demand)`,
        scope: event.scope,
        severity: event.severity,
        startedDay: state.world.day,
        expiresDay: duration !== null ? state.world.day + duration : null,
        demandModifiers: modifiers,
        supplyModifiers: {},
        priceModifiers: {},
        locationIds: ctx.locationIds,
        regionIds: ctx.regionIds,
        sourceEventId: event.id,
      }, rng);
      return report(effect.kind, `Demand ×${effect.multiplier.toFixed(2)} for ${effect.commodityIds.join(', ')}.`, [{ label: 'Commodities', value: effect.commodityIds.join(', ') }], null);
    }

    case 'inflation': {
      state.world.inflationRate = round2(clamp(state.world.inflationRate + effect.delta, B.economy.inflationFloor / 20, B.economy.inflationCeiling / 4));
      return report(effect.kind, `Inflation ${effect.delta >= 0 ? 'up' : 'down'} ${(Math.abs(effect.delta) * 100).toFixed(2)} points to ${(state.world.inflationRate * 100).toFixed(2)}%.`, [{ label: 'New rate', value: `${(state.world.inflationRate * 100).toFixed(2)}%` }], null);
    }

    case 'interest_rate': {
      state.world.interestRate = round2(clamp(state.world.interestRate + effect.delta, B.finance.rateFloor, B.finance.rateCeiling));
      return report(effect.kind, `Base rate ${effect.delta >= 0 ? 'raised' : 'cut'} to ${(state.world.interestRate * 100).toFixed(2)}%.`, [{ label: 'Base rate', value: `${(state.world.interestRate * 100).toFixed(2)}%` }], null);
    }

    case 'global_sentiment': {
      state.world.globalSentiment = round2(clamp(state.world.globalSentiment + effect.delta, 0.02, 0.98));
      return report(effect.kind, `Global risk appetite ${effect.delta >= 0 ? 'improved' : 'deteriorated'} to ${(state.world.globalSentiment * 100).toFixed(0)}/100.`, [{ label: 'Sentiment', value: state.world.globalSentiment.toFixed(2) }], null);
    }

    case 'cycle_shock': {
      state.world.cyclePhase = clamp(state.world.cyclePhase + effect.delta / B.economy.cycleLengthDays, 0, 1);
      return report(effect.kind, `The business cycle jumped ${(effect.delta >= 0 ? 'forward' : 'back')} by ${Math.abs(effect.delta).toFixed(0)} days.`, [{ label: 'Phase', value: state.world.indicators.cyclePhaseLabel }], null);
    }

    case 'stock_market': {
      let moved = 0;
      for (const company of Object.values(state.world.companies)) {
        if (company.status !== 'active') continue;
        const matches = !effect.sectors || effect.sectors.length === 0 || sectorIn(company.companyId, effect.sectors);
        if (!matches) continue;
        const impact = effect.delta * rng.float(0.7, 1.3);
        company.price = round2(Math.max(0.0001, company.price * (1 + impact)));
        company.sentiment = round2(clamp(company.sentiment + impact * 0.8, 0.02, 0.99));
        moved += 1;
      }
      state.world.stockIndex = round2(Math.max(1, state.world.stockIndex * (1 + effect.delta)));
      return report(effect.kind, `Equities ${effect.delta >= 0 ? 'up' : 'down'} ${(Math.abs(effect.delta) * 100).toFixed(1)}%${effect.sectors ? ` in ${effect.sectors.join(', ')}` : ''} (${moved} name(s)).`, [{ label: 'Index', value: state.world.stockIndex.toFixed(1) }], holdingsImpact(state, 'stocks'));
    }

    case 'crypto_market': {
      let moved = 0;
      for (const asset of Object.values(state.world.cryptoAssets)) {
        if (asset.status === 'rugged' || asset.status === 'delisted') continue;
        if (effect.assets && effect.assets.length > 0 && !effect.assets.includes(asset.assetId)) continue;
        const impact = effect.delta * rng.float(0.6, 1.6);
        asset.price = Math.max(1e-12, Number((asset.price * (1 + impact)).toPrecision(10)));
        asset.sentiment = round2(clamp(asset.sentiment + impact * 0.9, 0.02, 0.99));
        asset.liquidity = round2(clamp(asset.liquidity * (1 + impact * 0.4), 500, B.crypto.liquidityDepthBase * 400));
        moved += 1;
      }
      return report(effect.kind, `Digital assets ${effect.delta >= 0 ? 'up' : 'down'} ${(Math.abs(effect.delta) * 100).toFixed(1)}% (${moved} asset(s)).`, [{ label: 'Assets moved', value: String(moved) }], holdingsImpact(state, 'crypto'));
    }

    case 'company_event': {
      const touched: string[] = [];
      for (const companyId of effect.companyIds) {
        const company = state.world.companies[companyId];
        if (!company) continue;
        company.price = round2(Math.max(0.0001, company.price * (1 + effect.priceDelta)));
        company.sentiment = round2(clamp(company.sentiment + effect.priceDelta, 0.02, 0.99));
        company.pendingAction = effect.reason;
        touched.push(companyId);
      }
      return report(effect.kind, `${touched.join(', ')} ${effect.priceDelta >= 0 ? 'rose' : 'fell'} ${(Math.abs(effect.priceDelta) * 100).toFixed(1)}%: ${effect.reason}`, [{ label: 'Companies', value: touched.join(', ') }], holdingsImpact(state, 'stocks'));
    }

    case 'location_lockdown': {
      const locations = effect.scope === 'random_tradeable' ? [randomTradeableLocation(state, rng)] : scopeLocations(ctx, 'here');
      for (const locationId of locations) {
        const locState = state.world.locations[locationId];
        if (!locState) continue;
        locState.lockdown = true;
        locState.lockdownUntilDay = state.world.day + effect.durationDays;
        locState.stability = round2(clamp(locState.stability - 0.12, 0.02, 1));
      }
      return report(effect.kind, `Lockdown in ${locations.map((id) => worldReg.location(id)?.name ?? id).join(', ') || 'the region'} for ${effect.durationDays} day(s) — markets closed, nobody leaves.`, [{ label: 'Days', value: String(effect.durationDays) }], locations.includes(state.player.locationId) ? 'You are inside the lockdown.' : null);
    }

    case 'border_closure': {
      const countryId = worldReg.requireLocation(state.player.locationId).countryId;
      const locations = effect.scope === 'country' ? worldReg.locationsInCountry(countryId).map((l) => l.id) : [state.player.locationId];
      for (const locationId of locations) {
        const locState = state.world.locations[locationId];
        if (!locState) continue;
        locState.borderClosed = true;
        locState.borderClosedUntilDay = state.world.day + effect.durationDays;
      }
      return report(effect.kind, `${COUNTRY_BY_ID[countryId]?.name ?? countryId} closed its borders for ${effect.durationDays} day(s).`, [{ label: 'Days', value: String(effect.durationDays) }], 'Your routes in and out are closed.');
    }

    case 'route_disruption': {
      const from = state.player.locationId;
      let disrupted = 0;
      for (const { route } of worldReg.neighboursOf(from)) {
        const routeState = state.world.routes[route.id];
        if (!routeState) continue;
        routeState.disrupted = true;
        routeState.disruptedUntilDay = state.world.day + effect.durationDays;
        routeState.disruptionReason = effect.reason;
        routeState.costMultiplier = round2(clamp(routeState.costMultiplier * effect.costMultiplier, 1, 4));
        routeState.risk = round2(clamp(routeState.risk + 0.12, 0, 0.95));
        disrupted += 1;
      }
      return report(effect.kind, `${disrupted} route(s) out of ${worldReg.requireLocation(from).name} disrupted for ${effect.durationDays} day(s): ${effect.reason}`, [{ label: 'Routes', value: String(disrupted) }, { label: 'Cost', value: `×${effect.costMultiplier}` }], 'Your freight and travel costs out of here just rose.');
    }

    case 'faction_war': {
      if (!rng.chance(effect.chance)) return report(effect.kind, 'War did not break out.', [], null);
      const war = provokeWar(state, rng);
      return report(effect.kind, war ? 'A faction war broke out.' : 'Tensions rose but no faction committed.', [], war ? 'Route risk and enforcement rise wherever they overlap.' : null);
    }

    case 'faction_relation': {
      const faction = state.world.factions[effect.factionId];
      if (!faction) return report(effect.kind, 'Faction unknown.', [], null);
      for (const [otherId, value] of Object.entries(faction.relations)) {
        faction.relations[otherId] = round2(clamp(value + effect.delta, -100, 100));
      }
      return report(effect.kind, `${faction.factionId} relations moved ${effect.delta >= 0 ? '+' : ''}${effect.delta}.`, [{ label: 'Delta', value: String(effect.delta) }], null);
    }

    case 'faction_standing': {
      const kinds = effect.scope === 'criminal' ? ['criminal_syndicate', 'cartel', 'militia'] : effect.scope === 'legitimate' ? ['corporation', 'bank', 'government', 'guild', 'union'] : null;
      let touched = 0;
      for (const faction of Object.values(state.world.factions)) {
        if (kinds) {
          const kind = factionKind(faction.factionId);
          if (!kind || !kinds.includes(kind)) continue;
        }
        changeStanding(state, faction.factionId, effect.delta, event.name);
        touched += 1;
      }
      return report(effect.kind, `Standing ${effect.delta >= 0 ? '+' : ''}${effect.delta} with ${touched} faction(s)${effect.scope ? ` (${effect.scope})` : ''}.`, [{ label: 'Factions', value: String(touched) }], effect.delta < 0 ? 'Factions regard you worse.' : 'Factions regard you better.');
    }

    case 'player_cash': {
      const amount = round2(Math.abs(effect.amount));
      if (effect.amount >= 0) {
        creditCash(state, amount, { kind: 'adjustment', description: `${event.name}: ${effect.reason}`, dirty: effect.dirty ?? false, counterparty: event.name });
      } else {
        debitCash(state, amount, { kind: 'adjustment', description: `${event.name}: ${effect.reason}`, allowDirty: true, counterparty: event.name });
      }
      return report(effect.kind, `${effect.reason} (${effect.amount >= 0 ? '+' : '−'}${formatMoney(amount)}).`, [{ label: 'Cash', value: `${effect.amount >= 0 ? '+' : '−'}${formatMoney(amount)}` }], `${effect.amount >= 0 ? 'Received' : 'Lost'} ${formatMoney(amount)}.`);
    }

    case 'player_heat': {
      addHeat(state, effect.delta, event.name);
      return report(effect.kind, `Enforcement attention ${effect.delta >= 0 ? '+' : ''}${effect.delta}.`, [{ label: 'Heat', value: String(effect.delta) }], `Heat is now ${state.player.reputation.heat.toFixed(0)}.`);
    }

    case 'player_reputation': {
      const applied = changeReputation(state, effect.dimension as ReputationDimension, effect.delta, event.name);
      return report(effect.kind, `${effect.dimension} reputation ${applied >= 0 ? '+' : ''}${applied.toFixed(1)}.`, [{ label: effect.dimension, value: applied.toFixed(1) }], `${effect.dimension} reputation ${applied >= 0 ? '+' : ''}${applied.toFixed(1)}.`);
    }

    case 'player_xp': {
      const xp = grantXp(state, effect.amount, event.name).granted;
      return report(effect.kind, `Gained ${xp} XP.`, [{ label: 'XP', value: String(xp) }], `+${xp} XP.`);
    }

    case 'property_damage': {
      let damaged = 0;
      for (const property of state.player.properties) {
        if (ctx.locationIds.length > 0 && !ctx.locationIds.includes(property.locationId)) continue;
        property.condition = round2(clamp(property.condition - effect.fraction * rng.float(0.6, 1.4), 0.05, 1));
        property.damagedUntilDay = state.world.day + rng.int(2, 8);
        damaged += 1;
      }
      return report(effect.kind, `${damaged} property(ies) damaged by up to ${(effect.fraction * 100).toFixed(0)}%.`, [{ label: 'Properties', value: String(damaged) }], damaged > 0 ? 'Repair cost and storage security fell.' : null);
    }

    case 'inventory_spoilage': {
      let lost = 0;
      let value = 0;
      for (const stack of state.player.inventory) {
        const c = registry.get(stack.commodityId);
        if (!c) continue;
        if (effect.perishableOnly && c.shelfLifeDays === null) continue;
        const qty = Math.floor(stack.qty * effect.fraction * rng.float(0.6, 1.3));
        if (qty <= 0) continue;
        stack.qty -= qty;
        lost += qty;
        value += qty * c.baseValue;
      }
      state.player.inventory = state.player.inventory.filter((s) => s.qty > 0);
      return report(effect.kind, `${lost} unit(s) spoiled (${formatMoney(round2(value))}).`, [{ label: 'Units lost', value: String(lost) }, { label: 'Value', value: formatMoney(round2(value)) }], lost > 0 ? `You lost ${formatMoney(round2(value))} of stock.` : null);
    }

    case 'theft': {
      const target = effect.target ?? 'warehouse';
      const storages = state.player.storages.filter((s) =>
        target === 'personal' ? s.kind === 'personal' : target === 'vehicle' ? s.vehicleId !== null : s.kind === 'warehouse' || s.kind === 'safehouse' || s.kind === 'cold',
      );
      let value = 0;
      let units = 0;
      for (const storage of storages) {
        for (const stack of state.player.inventory.filter((i) => i.storageId === storage.id)) {
          const chance = clamp(effect.fraction * (1 - storage.security) * 1.4, 0, 0.9);
          if (!rng.chance(chance)) continue;
          const c = registry.get(stack.commodityId);
          const qty = Math.max(1, Math.floor(stack.qty * rng.float(0.2, 0.7)));
          stack.qty -= qty;
          units += qty;
          value += qty * (c?.baseValue ?? stack.avgCost);
          if (storage.insured) {
            const payout = round2(qty * (c?.baseValue ?? 0) * B.logistics.insurancePayoutFraction);
            if (payout > 0) {
              creditCash(state, payout, { kind: 'insurance', description: `Theft claim on ${storage.name}`, dirty: false });
              value -= payout;
            }
          }
        }
      }
      state.player.inventory = state.player.inventory.filter((s) => s.qty > 0);
      return report(effect.kind, `${units} unit(s) stolen from ${target} storage (${formatMoney(round2(Math.max(0, value)))} net).`, [{ label: 'Units', value: String(units) }, { label: 'Net loss', value: formatMoney(round2(Math.max(0, value))) }], units > 0 ? 'Your storage was robbed.' : null);
    }

    case 'seizure': {
      if (!rng.chance(effect.chance)) return report(effect.kind, 'A search found nothing.', [], null);
      let units = 0;
      let value = 0;
      for (const stack of state.player.inventory) {
        const c = registry.get(stack.commodityId);
        if (!c) continue;
        if (effect.illegalOnly && c.legality === 'legal') continue;
        const qty = Math.max(1, Math.floor(stack.qty * effect.fraction));
        stack.qty -= qty;
        units += qty;
        value += qty * c.baseValue;
      }
      state.player.inventory = state.player.inventory.filter((s) => s.qty > 0);
      addHeat(state, 8, event.name);
      setCounter(state, 'seized_value', round2(counter(state, 'seized_value') + value));
      return report(effect.kind, `${units} unit(s) seized (${formatMoney(round2(value))}).`, [{ label: 'Value seized', value: formatMoney(round2(value)) }], units > 0 ? `${formatMoney(round2(value))} of goods seized.` : null);
    }

    case 'arrest_chance': {
      if (!rng.chance(effect.chance)) return report(effect.kind, 'They did not come for you.', [], null);
      const days = rng.int(effect.days[0], effect.days[1]);
      const arrest = applyArrest(state, rng, { reason: event.name, kind: 'police' });
      void days;
      return report(effect.kind, `Arrested: ${arrest.sentenceDays} day(s), bail ${formatMoney(arrest.bailAmount)}.`, [{ label: 'Sentence', value: `${arrest.sentenceDays} days` }, { label: 'Bail', value: formatMoney(arrest.bailAmount) }], 'You are in custody.');
    }

    case 'business_suspension': {
      let suspended = 0;
      for (const business of state.player.businesses) {
        if (ctx.locationIds.length > 0 && !ctx.locationIds.includes(business.locationId)) continue;
        if (!rng.chance(effect.chance)) continue;
        business.suspended = true;
        business.suspendedUntilDay = state.world.day + effect.days;
        business.clientele = round2(clamp(business.clientele - 0.12, 0.05, 1));
        suspended += 1;
      }
      return report(effect.kind, `${suspended} business(es) suspended for ${effect.days} day(s).`, [{ label: 'Suspended', value: String(suspended) }], suspended > 0 ? 'Revenue stops while suspended.' : null);
    }

    case 'business_revenue': {
      let touched = 0;
      for (const business of state.player.businesses) {
        if (ctx.locationIds.length > 0 && !ctx.locationIds.includes(business.locationId)) continue;
        business.clientele = round2(clamp(business.clientele * (0.7 + effect.multiplier * 0.35), 0.05, 1));
        business.marketing = round2(clamp(business.marketing + (effect.multiplier - 1) * 0.5, 0, 2));
        touched += 1;
      }
      event.payload.revenueMultiplier = effect.multiplier;
      event.payload.revenueDays = effect.days;
      return report(effect.kind, `Revenue ×${effect.multiplier.toFixed(2)} for ${effect.days} day(s) across ${touched} business(es).`, [{ label: 'Multiplier', value: `×${effect.multiplier.toFixed(2)}` }], touched > 0 ? 'Your businesses feel it immediately.' : null);
    }

    case 'production_disruption': {
      let disrupted = 0;
      for (const line of state.player.productionLines) {
        if (ctx.locationIds.length > 0 && !ctx.locationIds.includes(line.locationId)) continue;
        if (!rng.chance(effect.chance)) continue;
        line.broken = true;
        line.brokenUntilDay = state.world.day + effect.days;
        disrupted += 1;
      }
      return report(effect.kind, `${disrupted} production line(s) offline for ${effect.days} day(s).`, [{ label: 'Lines', value: String(disrupted) }], disrupted > 0 ? 'Output stops until the lines are repaired.' : null);
    }

    case 'crew_effect': {
      let injured = 0;
      for (const employee of state.player.crew) {
        if (ctx.locationIds.length > 0 && !ctx.locationIds.includes(employee.locationId)) continue;
        employee.stats.loyalty = Math.round(clamp(employee.stats.loyalty + effect.loyaltyDelta, 0, 100));
        employee.stats.morale = Math.round(clamp(employee.stats.morale + effect.moraleDelta, 0, 100));
        if (effect.injuryChance > 0 && rng.chance(effect.injuryChance) && !employee.injured) {
          employee.injured = true;
          employee.injuredUntilDay = state.world.day + rng.int(B.crew.injuryRecoveryDays[0], B.crew.injuryRecoveryDays[1]);
          employee.status = 'injured';
          employee.stats.health = rng.int(15, 55);
          injured += 1;
        }
      }
      return report(effect.kind, `Crew loyalty ${effect.loyaltyDelta >= 0 ? '+' : ''}${effect.loyaltyDelta}, morale ${effect.moraleDelta >= 0 ? '+' : ''}${effect.moraleDelta}, ${injured} injured.`, [{ label: 'Injured', value: String(injured) }], injured > 0 ? `${injured} of your people are off duty.` : null);
    }

    case 'spawn_combat': {
      if (state.player.prison.incarcerated) {
        return report(effect.kind, 'An engagement was spoilt — you are in prison.', [{ label: 'Skipped', value: 'incarcerated' }], null);
      }
      const combat = startCombat(state, rng, {
        kind: eventCategory(event) === 'crime' ? 'ambush' : eventCategory(event) === 'faction' ? 'faction_war' : 'raid',
        table: effect.table,
        enemyCount: effect.enemyCount,
        stakes: effect.stakes,
        reason: `${event.name}: ${effect.table.replace(/_/g, ' ')}`,
        locationId: ctx.epicentre ?? state.player.locationId,
        seedLabel: `event:${event.defId}`,
      });
      return report(effect.kind, `An engagement started (${effect.table}, ${effect.enemyCount[0]}–${effect.enemyCount[1]} opponents, ${effect.stakes} stakes).`, [{ label: 'Table', value: effect.table }, { label: 'Stakes', value: effect.stakes }], combat.ok ? 'You are in a fight.' : combat.reason ?? null);
    }

    case 'spawn_mission': {
      const mission = offerMission(state, rng, effect.missionId);
      return report(effect.kind, mission ? `A contract appeared: ${mission.title}.` : `No contract could be posted (${effect.missionId}).`, [], mission ? 'Check the job board.' : null);
    }

    case 'unlock_location': {
      const locState = state.world.locations[effect.locationId];
      if (!locState) return report(effect.kind, 'Unknown location.', [], null);
      locState.discovered = true;
      state.player.progression.milestones.push(`discovered:${effect.locationId}`);
      return report(effect.kind, `${worldReg.requireLocation(effect.locationId).name} is now on your map.`, [{ label: 'Location', value: worldReg.requireLocation(effect.locationId).name }], 'New trade and travel options unlocked.');
    }

    case 'tax_change': {
      const countryIds = effect.countryId ? [effect.countryId] : [...new Set(worldReg.locations.map((l) => l.countryId))];
      for (const countryId of countryIds) {
        const gov = state.world.governments[countryId];
        if (!gov) continue;
        gov.taxRate = round2(clamp(gov.taxRate + effect.delta, 0, 0.45));
      }
      return report(effect.kind, `Tax rates ${effect.delta >= 0 ? 'raised' : 'cut'} by ${(Math.abs(effect.delta) * 100).toFixed(1)} points${effect.countryId ? ` in ${COUNTRY_BY_ID[effect.countryId]?.name ?? effect.countryId}` : ' worldwide'}.`, [{ label: 'Delta', value: `${effect.delta >= 0 ? '+' : ''}${(effect.delta * 100).toFixed(1)}pp` }], effect.delta > 0 ? 'Your local tax burden rises.' : 'Your local tax burden falls.');
    }

    case 'currency_crisis': {
      const countryIds = effect.countryId ? [effect.countryId] : [worldReg.requireLocation(state.player.locationId).countryId];
      for (const countryId of countryIds) {
        const gov = state.world.governments[countryId];
        if (!gov) continue;
        gov.currencyIndex = round2(clamp(gov.currencyIndex * (1 - effect.severity), 0.2, 2));
        gov.stability = round2(clamp(gov.stability - effect.severity * 0.4, 0.02, 1));
        for (const loc of worldReg.locationsInCountry(countryId)) {
          const locState = state.world.locations[loc.id];
          if (locState) locState.priceLevel = round2(clamp(locState.priceLevel * (1 + effect.severity * 0.5), 0.4, 3));
        }
      }
      return report(effect.kind, `Currency crisis (${(effect.severity * 100).toFixed(0)}% severity) in ${countryIds.map((c) => COUNTRY_BY_ID[c]?.name ?? c).join(', ')} — local prices and stability moved.`, [{ label: 'Severity', value: `${(effect.severity * 100).toFixed(0)}%` }], 'Cash held in that currency is worth less.');
    }

    case 'competitor_action': {
      const competitors = Object.values(state.world.competitors);
      let touched = 0;
      for (const competitor of competitors) {
        if (!rng.chance(effect.intensity)) continue;
        switch (effect.action) {
          case 'buy_spree':
            competitor.capital = round2(Math.max(0, competitor.capital * (1 - effect.intensity * 0.2)));
            competitor.aggression = round2(clamp(competitor.aggression + effect.intensity * 0.3, 0, 1));
            break;
          case 'dump':
            competitor.aggression = round2(clamp(competitor.aggression - effect.intensity * 0.35, -1, 1));
            break;
          case 'enter_market':
            competitor.operatingLocationIds = [...new Set([...competitor.operatingLocationIds, ctx.epicentre ?? state.player.locationId])];
            break;
          case 'exit_market':
            competitor.operatingLocationIds = competitor.operatingLocationIds.filter((id) => id !== (ctx.epicentre ?? state.player.locationId));
            break;
          default:
            break;
        }
        touched += 1;
      }
      return report(effect.kind, `${touched} competitor firm(s) ${effect.action.replace('_', ' ')} at ${(effect.intensity * 100).toFixed(0)}% intensity.`, [{ label: 'Firms', value: String(touched) }], 'Competitor behaviour changes the depth and price of the markets you trade.');
    }

    case 'cyber_event': {
      const severity = effect.severity;
      if (effect.target === 'player') {
        const underground = state.player.underground;
        underground.traceHeat = round2(clamp(underground.traceHeat + severity * 40, 0, 200));
        underground.compromised = severity > 0.5;
        if (underground.compromised) underground.compromisedUntilDay = state.world.day + Math.round(severity * 20);
        const stolen = round2(Math.min(computeNetWorth(state).cash * severity * 0.08, 60_000 * severity));
        if (stolen > 0) debitCash(state, stolen, { kind: 'theft', description: `${event.name}: wallet drained`, allowDirty: true });
        return report(effect.kind, `Your systems were attacked (${(severity * 100).toFixed(0)}% severity): trace heat up${stolen > 0 ? `, ${formatMoney(stolen)} taken` : ''}.`, [{ label: 'Severity', value: `${(severity * 100).toFixed(0)}%` }], 'Your digital identity is exposed.');
      }
      if (effect.target === 'exchange') {
        for (const account of state.player.underground.exchangeAccounts) {
          account.frozenUntilDay = state.world.day + Math.round(severity * 14);
        }
        for (const asset of Object.values(state.world.cryptoAssets)) {
          asset.liquidity = round2(clamp(asset.liquidity * (1 - severity * 0.35), 500, B.crypto.liquidityDepthBase * 400));
          asset.sentiment = round2(clamp(asset.sentiment - severity * 0.25, 0.02, 0.99));
        }
        return report(effect.kind, `An exchange was breached (${(severity * 100).toFixed(0)}%): withdrawals frozen and liquidity thinned across the crypto economy.`, [{ label: 'Severity', value: `${(severity * 100).toFixed(0)}%` }], holdingsImpact(state, 'crypto'));
      }
      for (const account of state.player.accounts) {
        if (rng.chance(severity * 0.6)) {
          account.frozen = true;
          account.frozenUntilDay = state.world.day + Math.round(severity * 10);
          account.freezeReason = `Frozen after a cyber attack (${event.name})`;
        }
      }
      return report(effect.kind, `A bank was attacked (${(severity * 100).toFixed(0)}%): some of your accounts are frozen while it recovers.`, [{ label: 'Severity', value: `${(severity * 100).toFixed(0)}%` }], 'Settlement may be unavailable.');
    }

    case 'bank_failure': {
      if (!rng.chance(effect.chance)) return report(effect.kind, 'A bank was stabilised before it failed.', [], null);
      const accounts = state.player.accounts.filter((a) => a.kind === 'checking' || a.kind === 'savings');
      const target = accounts.sort((a, b) => b.balance - a.balance)[0];
      if (!target) return report(effect.kind, 'A bank failed elsewhere.', [], null);
      const haircut = round2(target.balance * rng.float(0.08, 0.32));
      if (haircut > 0) {
        debitCash(state, haircut, { kind: 'seizure', description: `${event.name}: deposit haircut at ${target.institution}`, allowDirty: true, accountId: target.id });
      }
      target.frozen = true;
      target.frozenUntilDay = state.world.day + rng.int(5, 20);
      target.freezeReason = 'Institution in resolution';
      return report(effect.kind, `${target.institution} failed: ${formatMoney(haircut)} haircut and the account is frozen until day ${target.frozenUntilDay}.`, [{ label: 'Haircut', value: formatMoney(haircut) }], 'Move your settlement account.');
    }

    case 'technology_breakthrough': {
      addShock(state.world, {
        name: `${event.name} (technology)`,
        scope: event.scope,
        severity: event.severity,
        startedDay: state.world.day,
        expiresDay: duration !== null ? state.world.day + duration : null,
        demandModifiers: {},
        supplyModifiers: { [effect.category]: effect.supplyMultiplier } as Partial<Record<CommodityCategory, number>>,
        priceModifiers: {},
        locationIds: [],
        regionIds: [],
        sourceEventId: event.id,
      }, rng);
      return report(effect.kind, `A breakthrough raised ${effect.category} supply ×${effect.supplyMultiplier.toFixed(2)}.`, [{ label: 'Category', value: effect.category }], null);
    }

    case 'news': {
      // The authored copy is published by publishEvent; here we only record it so
      // the event's applied-effect trail explains itself.
      return report(effect.kind, fill(effect.headline, ctx.epicentre, ctx.def.scope), [
        { label: 'Detail', value: fill(effect.body, ctx.epicentre, ctx.def.scope).slice(0, 120) },
      ], null);
    }

    default:
      return report('news', 'Unhandled effect — the world absorbed it without visible change.', [], null);
  }
}

/** Category of a fired event, resolved from its definition. */
function eventCategory(event: ActiveEvent): string {
  return EVENT_BY_ID[event.defId]?.category ?? 'economic';
}

function effectDuration(ctx: EffectContext, effect: EventEffect): number | null {
  const own = 'durationDays' in effect ? effect.durationDays : undefined;
  return own ?? ctx.duration ?? B.events.effectDurationDaysDefault;
}

function factionKind(factionId: ID): string | null {
  return FACTION_BY_ID[factionId]?.kind ?? null;
}

function sectorIn(companyId: ID, sectors: string[]): boolean {
  const sector = COMPANY_BY_ID[companyId]?.sector;
  return sector !== undefined && sectors.includes(sector);
}

function randomTradeableLocation(state: GameState, rng: Rng): ID {
  const pool = worldReg.locations.filter((l) => l.tradedCommodityIds.length > 20 && !l.hidden);
  return rng.pick(pool)?.id ?? state.player.locationId;
}

function holdingsImpact(state: GameState, kind: 'stocks' | 'crypto'): string | null {
  const worth = computeNetWorth(state);
  const value = kind === 'stocks' ? worth.stocks : worth.crypto;
  if (value <= 0) return null;
  return `Your ${kind} position is worth ${formatMoney(round2(value))}.`;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface ActiveEventView {
  id: ID;
  defId: ID;
  name: string;
  description: string;
  scope: EventScope;
  severity: Severity;
  category: string;
  startedDay: number;
  expiresDay: number | null;
  daysRemaining: number | null;
  locations: string[];
  regions: string[];
  appliedEffects: string[];
  chainDepth: number;
  sourceEventId: ID | null;
}

export function activeEventViews(state: GameState): ActiveEventView[] {
  return state.world.activeEvents
    .map((event) => {
      const def = EVENT_BY_ID[event.defId];
      return {
        id: event.id,
        defId: event.defId,
        name: event.name,
        description: event.description,
        scope: event.scope,
        severity: event.severity,
        category: def?.category ?? 'economic',
        startedDay: event.startedDay,
        expiresDay: event.expiresDay,
        daysRemaining: event.expiresDay !== null ? Math.max(0, event.expiresDay - state.world.day) : null,
        locations: event.locationIds.map((id) => worldReg.location(id)?.name ?? id),
        regions: event.regionIds.map((id) => id),
        appliedEffects: event.appliedEffects,
        chainDepth: event.chainDepth,
        sourceEventId: event.sourceEventId ?? null,
      };
    })
    .sort((a, b) => b.startedDay - a.startedDay);
}

/** Human-readable description of an effect, for tooltips and the news feed. */
export function describeEffect(effect: EventEffect): string {
  switch (effect.kind) {
    case 'demand_shift':
      return `Demand ×${effect.multiplier.toFixed(2)} for ${effect.categories.join(', ')}${effect.locationScope ? ` (${effect.locationScope})` : ''}`;
    case 'supply_shift':
      return `Supply ×${effect.multiplier.toFixed(2)} for ${effect.categories.join(', ')}`;
    case 'price_shift':
      return `Prices ×${effect.multiplier.toFixed(2)} for ${effect.categories.join(', ')}`;
    case 'commodity_demand_shift':
      return `Demand ×${effect.multiplier.toFixed(2)} for ${effect.commodityIds.join(', ')}`;
    case 'inflation':
      return `Inflation ${effect.delta >= 0 ? '+' : ''}${(effect.delta * 100).toFixed(2)}pp`;
    case 'interest_rate':
      return `Base rate ${effect.delta >= 0 ? '+' : ''}${(effect.delta * 100).toFixed(2)}pp`;
    case 'global_sentiment':
      return `Risk appetite ${effect.delta >= 0 ? '+' : ''}${effect.delta.toFixed(2)}`;
    case 'cycle_shock':
      return `Cycle shifted by ${effect.delta.toFixed(0)} days`;
    case 'stock_market':
      return `Equities ${effect.delta >= 0 ? '+' : ''}${(effect.delta * 100).toFixed(1)}%${effect.sectors ? ` (${effect.sectors.join(', ')})` : ''}`;
    case 'crypto_market':
      return `Crypto ${effect.delta >= 0 ? '+' : ''}${(effect.delta * 100).toFixed(1)}%`;
    case 'company_event':
      return `${effect.companyIds.join(', ')} ${effect.priceDelta >= 0 ? '+' : ''}${(effect.priceDelta * 100).toFixed(1)}%: ${effect.reason}`;
    case 'location_lockdown':
      return `Lockdown for ${effect.durationDays} day(s)`;
    case 'border_closure':
      return `Borders closed for ${effect.durationDays} day(s)`;
    case 'route_disruption':
      return `Routes cost ×${effect.costMultiplier} for ${effect.durationDays} day(s): ${effect.reason}`;
    case 'faction_war':
      return `${(effect.chance * 100).toFixed(0)}% chance of a faction war`;
    case 'faction_relation':
      return `${effect.factionId} relations ${effect.delta >= 0 ? '+' : ''}${effect.delta}`;
    case 'faction_standing':
      return `Your standing ${effect.delta >= 0 ? '+' : ''}${effect.delta}${effect.scope ? ` (${effect.scope})` : ''}`;
    case 'player_cash':
      return `${effect.amount >= 0 ? '+' : '−'}${formatMoney(Math.abs(effect.amount))}: ${effect.reason}`;
    case 'player_heat':
      return `Heat ${effect.delta >= 0 ? '+' : ''}${effect.delta}`;
    case 'player_reputation':
      return `${effect.dimension} reputation ${effect.delta >= 0 ? '+' : ''}${effect.delta}`;
    case 'player_xp':
      return `+${effect.amount} XP`;
    case 'property_damage':
      return `Property condition −${(effect.fraction * 100).toFixed(0)}%`;
    case 'inventory_spoilage':
      return `${(effect.fraction * 100).toFixed(0)}% of stock spoils${effect.perishableOnly ? ' (perishables only)' : ''}`;
    case 'theft':
      return `${(effect.fraction * 100).toFixed(0)}% theft risk on ${effect.target ?? 'warehouse'} stock`;
    case 'seizure':
      return `${(effect.chance * 100).toFixed(0)}% chance of a ${(effect.fraction * 100).toFixed(0)}% seizure${effect.illegalOnly ? ' of illegal goods' : ''}`;
    case 'arrest_chance':
      return `${(effect.chance * 100).toFixed(0)}% arrest risk (${effect.days[0]}–${effect.days[1]} days)`;
    case 'business_suspension':
      return `${(effect.chance * 100).toFixed(0)}% chance each business is suspended for ${effect.days} day(s)`;
    case 'business_revenue':
      return `Business revenue ×${effect.multiplier.toFixed(2)} for ${effect.days} day(s)`;
    case 'production_disruption':
      return `${(effect.chance * 100).toFixed(0)}% chance each line is offline for ${effect.days} day(s)`;
    case 'crew_effect':
      return `Loyalty ${effect.loyaltyDelta >= 0 ? '+' : ''}${effect.loyaltyDelta}, morale ${effect.moraleDelta >= 0 ? '+' : ''}${effect.moraleDelta}, ${(effect.injuryChance * 100).toFixed(0)}% injury`;
    case 'spawn_combat':
      return `Combat: ${effect.table}, ${effect.enemyCount[0]}–${effect.enemyCount[1]} enemies, ${effect.stakes} stakes`;
    case 'spawn_mission':
      return `Contract posted: ${EVENT_BY_ID[effect.missionId]?.name ?? effect.missionId}`;
    case 'unlock_location':
      return `Reveals ${worldReg.location(effect.locationId)?.name ?? effect.locationId}`;
    case 'tax_change':
      return `Tax ${effect.delta >= 0 ? '+' : ''}${(effect.delta * 100).toFixed(1)}pp${effect.countryId ? ` in ${COUNTRY_BY_ID[effect.countryId]?.name ?? effect.countryId}` : ''}`;
    case 'currency_crisis':
      return `Currency crisis, severity ${(effect.severity * 100).toFixed(0)}%`;
    case 'competitor_action':
      return `Competitors ${effect.action.replace('_', ' ')} at ${(effect.intensity * 100).toFixed(0)}% intensity`;
    case 'cyber_event':
      return `Cyber event against ${effect.target}, severity ${(effect.severity * 100).toFixed(0)}%`;
    case 'bank_failure':
      return `${(effect.chance * 100).toFixed(0)}% chance of a bank failure`;
    case 'technology_breakthrough':
      return `${effect.category} supply ×${effect.supplyMultiplier.toFixed(2)}`;
    case 'news':
      return effect.headline;
    default:
      return 'Unknown effect';
  }
}

/** Everything the player can see about the event system's current state. */
export function eventsView(state: GameState): {
  active: ActiveEventView[];
  scheduled: { id: ID; name: string; day: number; daysUntil: number; sourceEventId: ID; chainDepth: number }[];
  cooldowns: { defId: ID; name: string; untilDay: number }[];
  firedByCategory: { category: string; count: number }[];
  shocks: { id: ID; name: string; scope: string; severity: string; expiresDay: number | null; categories: string[] }[];
  totalFired: number;
  retentionDays: number;
} {
  const categories = new Map<string, number>();
  for (const [key, value] of Object.entries(state.player.stats.counters)) {
    if (!key.startsWith('events:')) continue;
    categories.set(key.slice(7), value);
  }
  return {
    active: activeEventViews(state),
    scheduled: state.world.scheduledEvents
      .filter((s) => s.day > state.world.day)
      .map((s) => ({
        id: s.id,
        name: EVENT_BY_ID[s.defId]?.name ?? s.defId,
        day: s.day,
        daysUntil: s.day - state.world.day,
        sourceEventId: s.sourceEventId,
        chainDepth: s.chainDepth,
      }))
      .sort((a, b) => a.day - b.day),
    cooldowns: Object.entries(state.world.eventCooldowns).map(([defId, untilDay]) => ({ defId, name: EVENT_BY_ID[defId]?.name ?? defId, untilDay })),
    firedByCategory: [...categories.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    shocks: state.world.shocks.map((s) => ({
      id: s.id,
      name: s.name,
      scope: s.scope,
      severity: s.severity,
      expiresDay: s.expiresDay,
      categories: [...new Set([...Object.keys(s.demandModifiers), ...Object.keys(s.supplyModifiers), ...Object.keys(s.priceModifiers)])],
    })),
    totalFired: counter(state, 'events_fired'),
    retentionDays: B.events.newsRetentionDays,
  };
}

/**
 * Revenue multiplier from active events at a location — read by `businesses.ts`
 * so an authored `business_revenue` effect actually moves daily P&L.
 */
export function businessRevenueMultiplier(state: GameState, locationId: ID): number {
  let multiplier = 1;
  for (const event of state.world.activeEvents) {
    const value = event.payload.revenueMultiplier;
    if (typeof value !== 'number') continue;
    const days = typeof event.payload.revenueDays === 'number' ? event.payload.revenueDays : 0;
    if (state.world.day - event.startedDay > days) continue;
    if (event.locationIds.length > 0 && !event.locationIds.includes(locationId)) continue;
    multiplier *= value;
  }
  return round2(clamp(multiplier, 0.2, 3));
}

export function playerEventModifiers(state: GameState): number {
  return playerModifiers(state).get('events.severityReduction');
}

export function eventCatalogue(state: GameState, opts: { scope?: EventScope; category?: string; limit?: number } = {}): {
  id: ID;
  name: string;
  scope: EventScope;
  severity: Severity;
  category: string;
  available: boolean;
  blockedBy: string | null;
  effects: string[];
  chainsTo: string[];
  cooldownUntilDay: number | null;
}[] {
  const ctx = makeContext(state);
  const out = EVENTS.filter((def) => (opts.scope ? def.scope === opts.scope : true))
    .filter((def) => (opts.category ? def.category === opts.category : true))
    .map((def) => {
      const cooldown = state.world.eventCooldowns[def.id] ?? 0;
      const eligible = evaluateConditions(ctx, def.conditions);
      const onCooldown = cooldown > state.world.day;
      return {
        id: def.id,
        name: def.name,
        scope: def.scope,
        severity: def.severity,
        category: def.category,
        available: eligible && !onCooldown,
        blockedBy: onCooldown ? `On cooldown until day ${cooldown}` : eligible ? null : 'Conditions not met',
        effects: def.effects.map(describeEffect),
        chainsTo: def.chain.map((c) => EVENT_BY_ID[c.eventId]?.name ?? c.eventId),
        cooldownUntilDay: onCooldown ? cooldown : null,
      };
    })
    .sort((a, b) => Number(b.available) - Number(a.available) || a.severity.localeCompare(b.severity));
  return opts.limit ? out.slice(0, opts.limit) : out;
}

/** Location states touched by an event, for the map view. */
export function affectedLocationStates(state: GameState, eventId: ID): LocationState[] {
  const event = state.world.activeEvents.find((e) => e.id === eventId);
  if (!event) return [];
  return event.locationIds.map((id) => state.world.locations[id]).filter((ls): ls is LocationState => ls !== undefined);
}
