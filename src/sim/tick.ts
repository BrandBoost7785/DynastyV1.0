/**
 * Tick — the continuous world simulation driver (spec §16, §52).
 *
 * `advanceDay` is the single place where a day passes. Phase order is fixed and
 * deliberate, because later phases read what earlier phases wrote:
 *
 *   1. calendar        — day/turn counters, prison status
 *   2. macro world     — rates, inflation, cycle, sentiment, locations, routes,
 *                        competitors, governments, shocks (`world.stepWorld`)
 *   3. markets         — every materialised commodity market steps
 *   4. holdings        — spoilage, quality decay, theft, insurance
 *   5. reputation      — decay, heat, investigations
 *   6. enforcement     — patrols, customs follow-up, raids, arrests
 *   7. contracts       — mission deadlines, live objectives, job board refresh
 *   8. player          — actions/stamina/health reset
 *   9. valuation       — net worth snapshot, victory and loss conditions
 *  10. reporting       — news, notifications and diagnostics for the day
 *
 * Every phase returns a report entry so the UI can answer "what happened while
 * I was away, and why?" — the day report is the game's audit trail.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { getWorldRegistry } from '../engine/registry/world';
import { clearResolvedCombat, enforcementEncounterChance, prisonTick, spawnEnforcementEncounter, type CombatResult } from './combat';
import { accountsTick, creditTick, launderingTick, loanTick, taxTick, type LaunderingTickResult, type LoanTickResult, type TaxTickResult } from './finance';
import { businessTick, type BusinessTickResult } from './businesses';
import { automationSummaryLine, automationTick, type AutomationTickResult } from './automation';
import { crewTick, maybeRefreshHiringPool, payrollForecast, type PayrollResult } from './crew';
import { eventTick, type EventTickResult } from './events';
import { factionTick, type FactionTickResult } from './factions';
import { tradeNetworkTick, tradeNetworkSummary } from './trade-network';
import { logisticsTick, storageRentTick, type LogisticsTickResult } from './logistics';
import { undergroundTick, type UndergroundTickResult } from './underground';
import { stepCrypto, type CryptoStepResult } from './crypto';
import { stepCompanies, type CompanyStepResult } from './stocks';
import { spoilageTick, theftTick, type SpoilageLoss, type TheftLoss } from './inventory';
import { stepMarkets, type StepMarketsResult } from './markets';
import { missionsDailyTick, type MissionTickResult } from './missions';
import { productionTick, type ProductionTickResult } from './production';
import { propertyTick, type PropertyTickResult } from './properties';
import { reputationTick, type ReputationTickResult } from './reputation';
import {
  buildEnding,
  computeNetWorth,
  empireScore,
  formatMoney,
  pushDiagnostic,
  pushNetWorthSnapshot,
  pushNotification,
  round2,
  trimTransactionHistory,
  type NetWorthBreakdown,
} from './state';
import { pushNews, stepWorld, type WorldStepResult } from './world';
import type { ActiveShock, DiagnosticEntry, GameState, NewsItem, PlayerNotification } from './types';
import { orderedEntries } from './ordering';

const B = getBalance();
const worldReg = getWorldRegistry();
const registry = getCommodityRegistry();

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export interface PhaseReport {
  phase: string;
  system: string;
  summary: string;
  metrics: { label: string; value: string }[];
  severity: 'info' | 'good' | 'warning' | 'danger';
}

export interface DayReport {
  day: number;
  turn: number;
  phases: PhaseReport[];
  news: NewsItem[];
  notifications: PlayerNotification[];
  netWorth: NetWorthBreakdown;
  netWorthChange: number;
  empireScore: number;
  spoilage: SpoilageLoss[];
  theft: TheftLoss[];
  marketMovers: StepMarketsResult['biggestMovers'];
  companies: CompanyStepResult;
  crypto: CryptoStepResult;
  finance: { interestEarned: number; loans: LoanTickResult; laundering: LaunderingTickResult; tax: TaxTickResult };
  properties: PropertyTickResult;
  payroll: PayrollResult;
  businesses: BusinessTickResult;
  production: ProductionTickResult;
  factions: FactionTickResult;
  logistics: LogisticsTickResult;
  underground: UndergroundTickResult;
  events: EventTickResult;
  automation: AutomationTickResult;
  missions: MissionTickResult | null;
  enforcement: { encounterChance: number; combat: CombatResult | null; raided: boolean };
  prison: { incarcerated: boolean; released: boolean; escaped: boolean; daysRemaining: number };
  ending: GameState['ending'];
  elapsedMs: number;
}

export interface AdvanceOptions {
  /** Suppress player-facing notifications (used for batch/idle simulation). */
  quiet?: boolean;
  /** Skip enforcement rolls (used by tests and by "safe house" mechanics). */
  noEnforcement?: boolean;
}

/* ------------------------------------------------------------------ */
/* The day step                                                        */
/* ------------------------------------------------------------------ */

export function advanceDay(state: GameState, rng: Rng, opts: AdvanceOptions = {}): DayReport {
  const started = Date.now();
  const previousWorth = computeNetWorth(state).total;
  const notificationsBefore = state.player.notifications.length;
  const newsBefore = state.world.news.length;
  const phases: PhaseReport[] = [];

  /* ---------------------------- 1. calendar --------------------------- */
  const day = state.world.day + 1;
  state.turn += 1;
  state.world.day = day;
  state.lastTickDay = day;
  state.player.stats.daysSurvived += 1;

  const prison = prisonTick(state, rng);
  if (prison.incarcerated || prison.released || prison.escaped) {
    phases.push({
      phase: 'calendar',
      system: 'prison',
      summary: prison.escaped
        ? 'You escaped from prison and are now a fugitive.'
        : prison.released
          ? 'You were released from prison.'
          : `Day ${prison.daysRemaining} of your sentence remains.`,
      metrics: [
        { label: 'Influence', value: prison.influence.toFixed(1) },
        { label: 'Days remaining', value: String(prison.daysRemaining) },
      ],
      severity: prison.escaped ? 'warning' : prison.released ? 'good' : 'info',
    });
  }

  /* --------------------------- 2. macro world --------------------------- */
  const worldResult: WorldStepResult = stepWorld(state.world, rng, day);
  for (const shock of worldResult.newShocks) {
    phases.push(shockPhase(shock));
  }
  if (worldResult.diagnostics.length > 0) {
    for (const d of worldResult.diagnostics) state.diagnostics.push(d);
  }
  phases.push({
    phase: 'world',
    system: 'macro',
    summary: macroSummary(state),
    metrics: [
      { label: 'Inflation', value: `${(state.world.inflationRate * 100).toFixed(2)}%` },
      { label: 'Base rate', value: `${(state.world.interestRate * 100).toFixed(2)}%` },
      { label: 'Cycle', value: state.world.indicators.cyclePhaseLabel },
      { label: 'Sentiment', value: state.world.globalSentiment.toFixed(2) },
      { label: 'Active shocks', value: String(state.world.shocks.length) },
    ],
    severity: state.world.indicators.cyclePhaseLabel === 'recession' ? 'warning' : 'info',
  });

  /* ----------------------------- 3. markets ----------------------------- */
  const marketResult = stepMarkets(state, rng);
  if (marketResult.biggestMovers.length > 0) {
    phases.push({
      phase: 'markets',
      system: 'commodities',
      summary: `${marketResult.stepped} market(s) stepped. Biggest mover: ${marketResult.biggestMovers[0]!.name} ${pct(marketResult.biggestMovers[0]!.change)}.`,
      metrics: marketResult.biggestMovers.slice(0, 5).map((m) => ({ label: m.name, value: `${pct(m.change)} → ${formatMoney(m.price)}` })),
      severity: marketResult.biggestMovers[0]!.change < -0.08 ? 'warning' : 'info',
    });
    publishMovers(state, marketResult.biggestMovers);
  }

  /* --------------------------- 3b. trade network -------------------------- */
  /*
   * Rival firms move cargo *after* the books have stepped and *before* factions,
   * enforcement and the player's own day resolve. Deliveries land into the same
   * market records the player trades against, so an inbound shipment is simply
   * supply: it presses the destination price down through `tradeImpact`.
   */
  const tradeResult = tradeNetworkTick(state, rng);
  if (tradeResult.dispatched > 0 || tradeResult.delivered > 0 || tradeResult.lost > 0 || tradeResult.agentFailures.length > 0) {
    phases.push({
      phase: 'trade',
      system: 'trade_network',
      summary: tradeNetworkSummary(tradeResult),
      metrics: [
        { label: 'Dispatched', value: String(tradeResult.dispatched) },
        { label: 'Landed', value: String(tradeResult.delivered) },
        { label: 'Units landed', value: tradeResult.volume.toLocaleString('en-US') },
        { label: 'Lost in transit', value: String(tradeResult.lost) },
        { label: 'Realised profit', value: formatMoney(tradeResult.realisedProfit) },
      ],
      severity: tradeResult.lost > 0 ? 'warning' : 'info',
    });
  }

  /* ------------------------------- 2b. factions -------------------------- */
  const factions: FactionTickResult = factionTick(state, rng);
  if (factions.warsDeclared.length > 0 || factions.peaceMade.length > 0 || factions.territoryChanges.length > 0 || factions.offersMade.length > 0) {
    phases.push({
      phase: 'world',
      system: 'factions',
      summary: [
        factions.warsDeclared.length > 0 ? `${factions.warsDeclared.length} war(s) declared` : '',
        factions.peaceMade.length > 0 ? `${factions.peaceMade.length} ceasefire(s)` : '',
        factions.territoryChanges.length > 0 ? `${factions.territoryChanges.length} border change(s)` : '',
        factions.offersMade.length > 0 ? `${factions.offersMade.length} offer(s) for you` : '',
      ]
        .filter(Boolean)
        .join(', ') + '.',
      metrics: [
        { label: 'Wars declared', value: String(factions.warsDeclared.length) },
        { label: 'Ceasefires', value: String(factions.peaceMade.length) },
        { label: 'Territory changes', value: String(factions.territoryChanges.length) },
        { label: 'Open offers', value: String(factions.offersMade.length) },
        ...(factions.tributeDemanded ? [{ label: 'Tribute demanded', value: formatMoney(factions.tributeDemanded.amount) }] : []),
      ],
      severity: factions.warsDeclared.length > 0 || factions.tributeDemanded ? 'warning' : 'info',
    });
  }

  /* ------------------------------- 2c. events ---------------------------- */
  const events: EventTickResult = eventTick(state, rng);
  if (events.fired.length > 0 || events.expired.length > 0) {
    for (const fired of events.fired) {
      phases.push({
        phase: 'events',
        system: fired.event.scope === 'global' ? 'world event' : `${fired.event.scope} event`,
        summary: `${fired.event.name}: ${fired.reports.map((r) => r.summary).join(' ')}`,
        metrics: fired.reports.flatMap((r) => r.metrics).slice(0, 6),
        severity: fired.severity === 'catastrophic' || fired.severity === 'major' ? 'danger' : fired.severity === 'moderate' ? 'warning' : 'info',
      });
    }
    if (events.expired.length > 0) {
      phases.push({
        phase: 'events',
        system: 'world event',
        summary: `${events.expired.length} event effect(s) expired.`,
        metrics: [{ label: 'Expired', value: events.expired.slice(0, 4).join(', ') }],
        severity: 'info',
      });
    }
  }

  /* ------------------------- 3b. equities & crypto ----------------------- */
  const companyResult: CompanyStepResult = stepCompanies(state, rng);
  const cryptoResult: CryptoStepResult = stepCrypto(state, rng);
  if (companyResult.events.length > 0 || Math.abs(companyResult.indexChange) > 0.005) {
    phases.push({
      phase: 'markets',
      system: 'equities',
      summary: `Index ${companyResult.indexLevel.toFixed(0)} (${pct(companyResult.indexChange)}). ${companyResult.events.length > 0 ? companyResult.events[0]!.headline : 'No corporate actions.'}`,
      metrics: [
        { label: 'Index', value: companyResult.indexLevel.toFixed(2) },
        { label: 'Day change', value: pct(companyResult.indexChange) },
        { label: 'Corporate events', value: String(companyResult.events.length) },
        ...(companyResult.dividendsPaidToPlayer > 0 ? [{ label: 'Dividends to you', value: formatMoney(companyResult.dividendsPaidToPlayer) }] : []),
      ],
      severity: companyResult.indexChange < -0.02 ? 'danger' : companyResult.indexChange > 0.02 ? 'good' : 'info',
    });
  }
  if (cryptoResult.events.length > 0 || Math.abs(cryptoResult.indexChange) > 0.005) {
    phases.push({
      phase: 'markets',
      system: 'crypto',
      summary: `Crypto index ${cryptoResult.indexLevel.toFixed(0)} (${pct(cryptoResult.indexChange)}). ${cryptoResult.events.length > 0 ? cryptoResult.events[0]!.headline : 'No protocol events.'}`,
      metrics: [
        { label: 'Index', value: cryptoResult.indexLevel.toFixed(2) },
        { label: 'Day change', value: pct(cryptoResult.indexChange) },
        { label: 'Protocol events', value: String(cryptoResult.events.length) },
        ...(cryptoResult.stakingRewards > 0 ? [{ label: 'Staking rewards', value: formatMoney(cryptoResult.stakingRewards) }] : []),
        ...(cryptoResult.minedValue > 0 ? [{ label: 'Mined', value: formatMoney(cryptoResult.minedValue) }, { label: 'Mining cost', value: formatMoney(cryptoResult.miningCost) }] : []),
      ],
      severity: cryptoResult.indexChange < -0.04 ? 'danger' : cryptoResult.indexChange > 0.04 ? 'good' : 'info',
    });
  }

  /* ----------------------------- 4. holdings ---------------------------- */
  const spoilage = spoilageTick(state, rng);
  const theft = theftTick(state, rng);
  if (spoilage.length > 0) {
    const value = round2(spoilage.reduce((s, l) => s + l.value, 0));
    phases.push({
      phase: 'holdings',
      system: 'inventory',
      summary: `${spoilage.length} stack(s) spoiled or degraded${value > 0 ? ` — ${formatMoney(value)} lost` : ''}.`,
      metrics: spoilage.slice(0, 5).map((l) => ({ label: l.commodityName, value: `${l.reason}${l.qty > 0 ? ` × ${l.qty}` : ''}` })),
      severity: value > 500 ? 'danger' : 'warning',
    });
  }
  if (theft.length > 0) {
    const value = round2(theft.reduce((s, l) => s + l.value, 0));
    const insured = theft.filter((l) => l.payout > 0).reduce((s, l) => s + l.payout, 0);
    phases.push({
      phase: 'holdings',
      system: 'security',
      summary: `Theft: ${formatMoney(value)} of goods taken${insured > 0 ? `, insurance paid ${formatMoney(insured)}` : ''}.`,
      metrics: theft.slice(0, 5).map((l) => ({ label: l.commodityName, value: `${l.qty} × ${formatMoney(l.value / Math.max(1, l.qty))}` })),
      severity: 'danger',
    });
  }

  /* ---------------------------- 5. reputation --------------------------- */
  const repResult: ReputationTickResult = reputationTick(state, rng);
  if (repResult.investigationStarted || repResult.investigationClosed || state.player.reputation.investigation > 40) {
    phases.push({
      phase: 'reputation',
      system: 'enforcement',
      summary: repResult.investigationStarted
        ? 'An investigation into your activities was opened.'
        : repResult.investigationClosed
          ? 'The investigation into you was closed.'
          : `Investigation pressure ${state.player.reputation.investigation.toFixed(0)}/100, heat ${state.player.reputation.heat.toFixed(0)}.`,
      metrics: [
        { label: 'Heat', value: state.player.reputation.heat.toFixed(1) },
        { label: 'Heat decayed', value: repResult.heatDecayed.toFixed(1) },
        { label: 'Investigation', value: state.player.reputation.investigation.toFixed(1) },
      ],
      severity: state.player.reputation.investigation > 70 ? 'danger' : state.player.reputation.investigation > 35 ? 'warning' : 'info',
    });
  }

  /* ---------------------------- 6. enforcement -------------------------- */
  const enforcement: DayReport['enforcement'] = { encounterChance: enforcementEncounterChance(state), combat: null, raided: false };
  if (!opts.noEnforcement && !prison.incarcerated && state.player.combat === null) {
    const combat = spawnEnforcementEncounter(state, rng);
    if (combat) {
      enforcement.combat = combat;
      phases.push({
        phase: 'enforcement',
        system: 'patrol',
        summary: combat.outcome?.summary ?? 'An enforcement encounter is in progress.',
        metrics: [
          { label: 'Encounter chance', value: `${(enforcement.encounterChance * 100).toFixed(1)}%` },
          { label: 'Outcome', value: combat.outcome ? (combat.outcome.victory ? 'victory' : combat.outcome.arrested ? 'arrested' : 'defeat') : 'pending' },
        ],
        severity: combat.outcome?.arrested ? 'danger' : combat.outcome?.victory ? 'warning' : 'danger',
      });
    } else if (state.player.reputation.investigation > 55 && rng.chance(B.enforcement.raidChancePerDayAtMaxInvestigation * (state.player.reputation.investigation / 100))) {
      enforcement.raided = true;
      const raid = raidPremises(state, rng);
      phases.push({
        phase: 'enforcement',
        system: 'raid',
        summary: raid.summary,
        metrics: raid.metrics,
        severity: 'danger',
      });
    }
  }
  clearResolvedCombat(state);

  /* ------------------- 6b. infrastructure and people -------------------- */
  const properties: PropertyTickResult = propertyTick(state, rng);
  const payroll: PayrollResult = crewTick(state, rng);
  const hiringRefreshed = maybeRefreshHiringPool(state, rng);
  if (properties.raids.length > 0 || properties.rent > 0 || properties.arrearsAdded > 0) {
    phases.push({
      phase: 'infrastructure',
      system: 'property',
      summary:
        properties.raids.length > 0
          ? `${properties.raids.length} property raid(s): ${properties.raids.map((r) => r.name).join(', ')}.`
          : `Property carry ${formatMoney(properties.opex + properties.tax + properties.insurance)}, rent ${formatMoney(properties.rent)}, valuation ${properties.appreciation >= 0 ? '+' : '−'}${formatMoney(Math.abs(properties.appreciation))}.`,
      metrics: [
        { label: 'Opex', value: formatMoney(properties.opex) },
        { label: 'Property tax', value: formatMoney(properties.tax) },
        { label: 'Insurance', value: formatMoney(properties.insurance) },
        { label: 'Rent received', value: formatMoney(properties.rent) },
        { label: 'Valuation change', value: formatMoney(properties.appreciation) },
        ...(properties.arrearsAdded > 0 ? [{ label: 'Unpaid arrears', value: formatMoney(properties.arrearsAdded) }] : []),
      ],
      severity: properties.raids.length > 0 || properties.arrearsAdded > 0 ? 'danger' : properties.rent > 0 ? 'good' : 'info',
    });
  }
  if (payroll.paid > 0 || payroll.unpaid > 0 || payroll.betrayals.length > 0 || payroll.departures.length > 0 || payroll.injuries > 0 || hiringRefreshed) {
    phases.push({
      phase: 'people',
      system: 'crew',
      summary:
        payroll.betrayals.length > 0
          ? `${payroll.betrayals.map((b) => b.name).join(', ')} betrayed you.`
          : payroll.unpaid > 0
            ? `Payroll short by ${formatMoney(payroll.unpaid)} — ${payroll.unpaidEmployees.length} employee(s) unpaid.`
            : payroll.departures.length > 0
              ? `${payroll.departures.length} employee(s) left (${payroll.departures.map((d) => d.reason).join(', ')}).`
              : `Payroll ${formatMoney(payroll.paid)} for ${state.player.crew.length} employee(s).${hiringRefreshed ? ' The hiring pool refreshed.' : ''}`,
      metrics: [
        { label: 'Wages paid', value: formatMoney(payroll.paid) },
        ...(payroll.unpaid > 0 ? [{ label: 'Wages owed', value: formatMoney(payroll.unpaid) }] : []),
        { label: 'Headcount', value: String(state.player.crew.length) },
        { label: 'Daily payroll', value: formatMoney(payrollForecast(state)) },
        ...(payroll.injuries > 0 ? [{ label: 'Injuries', value: String(payroll.injuries) }] : []),
        ...(payroll.promotions.length > 0 ? [{ label: 'Level-ups', value: payroll.promotions.map((p) => `${p.name} → ${p.level}`).join(', ') }] : []),
      ],
      severity:
        payroll.betrayals.length > 0 || payroll.unpaid > 0
          ? 'danger'
          : payroll.departures.length > 0 || payroll.injuries > 0
            ? 'warning'
            : 'info',
    });
  }

  /* ----------------------------- 6c. logistics --------------------------- */
  const logistics: LogisticsTickResult = state.player.shipments.length > 0 || state.player.vehicles.length > 0 ? logisticsTick(state, rng) : emptyLogisticsTick();
  const storageRent = storageRentTick(state);
  if (logistics.events.length > 0 || storageRent.paid > 0) {
    phases.push({
      phase: 'logistics',
      system: 'shipments',
      summary:
        logistics.events.length > 0
          ? logistics.events.map((e) => `${e.trackingCode}: ${e.detail}`).join(' ')
          : `Storage rent ${formatMoney(storageRent.paid)} across ${storageRent.units} unit(s).`,
      metrics: [
        { label: 'In transit', value: String(logistics.inTransit) },
        { label: 'Delivered', value: String(logistics.delivered.length) },
        { label: 'Storage rent', value: formatMoney(storageRent.paid) },
        ...(logistics.insurancePayouts > 0 ? [{ label: 'Insurance paid', value: formatMoney(logistics.insurancePayouts) }] : []),
        ...(logistics.vehicleWear > 0 ? [{ label: 'Vehicle wear', value: `${(logistics.vehicleWear * 100).toFixed(1)}%` }] : []),
      ],
      severity: logistics.events.some((e) => e.kind === 'seized' || e.kind === 'theft') ? 'danger' : logistics.delivered.length > 0 ? 'good' : 'info',
    });
  }

  /* ----------------------------- 6d. underground ------------------------- */
  const underground: UndergroundTickResult = state.player.underground.accessUnlocked ? undergroundTick(state, rng) : emptyUndergroundTick();
  if (underground.escrowLost > 0 || underground.breaches > 0 || underground.compromised) {
    phases.push({
      phase: 'underground',
      system: 'digital',
      summary: [
        underground.escrowLost > 0 ? `escrow raid lost ${formatMoney(underground.escrowLost)}` : '',
        underground.breaches > 0 ? `${underground.breaches} exposure event(s)` : '',
        underground.compromised ? 'your identity is compromised' : '',
      ]
        .filter(Boolean)
        .join('; ') + '.',
      metrics: [
        { label: 'Data assets held', value: String(underground.assetsHeld) },
        { label: 'Value decayed', value: formatMoney(underground.assetDecayValue) },
        { label: 'Trace heat', value: state.player.underground.traceHeat.toFixed(1) },
      ],
      severity: underground.compromised || underground.escrowLost > 0 ? 'danger' : 'warning',
    });
  }

  /* ----------------------------- 6e. operations -------------------------- */
  const businesses: BusinessTickResult = state.player.businesses.length > 0 ? businessTick(state, rng) : emptyBusinessTick();
  const production: ProductionTickResult = state.player.productionLines.length > 0 ? productionTick(state, rng) : emptyProductionTick();
  if (businesses.results.length > 0 || businesses.failures.length > 0) {
    phases.push({
      phase: 'operations',
      system: 'businesses',
      summary:
        businesses.failures.length > 0
          ? `${businesses.failures.length} business(es) failed today.`
          : `${businesses.results.length} business(es) traded: revenue ${formatMoney(businesses.totalRevenue)}, profit ${formatMoney(businesses.totalProfit)}.`,
      metrics: [
        { label: 'Revenue', value: formatMoney(businesses.totalRevenue) },
        { label: 'Opex', value: formatMoney(businesses.totalOpex) },
        { label: 'Wages on site', value: formatMoney(businesses.totalWages) },
        { label: 'Tax', value: formatMoney(businesses.totalTax) },
        { label: 'Profit', value: formatMoney(businesses.totalProfit) },
        ...(businesses.suspended > 0 ? [{ label: 'Suspended', value: String(businesses.suspended) }] : []),
      ],
      severity: businesses.failures.length > 0 || businesses.totalProfit < 0 ? 'warning' : businesses.totalProfit > 0 ? 'good' : 'info',
    });
  }
  if (production.reports.length > 0 || production.blocked.length > 0 || production.breakdowns.length > 0) {
    phases.push({
      phase: 'operations',
      system: 'production',
      summary:
        production.blocked.length > 0 && production.reports.length === 0
          ? `Production stalled: ${production.blocked.map((b) => `${b.name} (${b.reason})`).join('; ')}.`
          : `${production.reports.length} line(s) ran: output worth ${formatMoney(production.totalOutputValue)} for ${formatMoney(production.totalCost)} of energy and opex${production.breakdowns.length > 0 ? `, ${production.breakdowns.length} breakdown(s)` : ''}.`,
      metrics: [
        { label: 'Output value', value: formatMoney(production.totalOutputValue) },
        { label: 'Operating cost', value: formatMoney(production.totalCost) },
        { label: 'Waste', value: formatMoney(production.totalWaste) },
        ...(production.breakdowns.length > 0 ? [{ label: 'Breakdowns', value: production.breakdowns.map((b) => b.name).join(', ') }] : []),
        ...(production.blocked.length > 0 ? [{ label: 'Blocked', value: production.blocked.map((b) => `${b.name}: ${b.reason}`).join('; ') }] : []),
      ],
      severity: production.blocked.length > 0 || production.breakdowns.length > 0 ? 'warning' : 'good',
    });
  }

  /* ----------------------------- 6f. automation -------------------------- */
  const automation: AutomationTickResult = state.player.automation.length > 0 ? automationTick(state, rng) : emptyAutomationTick();
  if (automation.ran > 0) {
    phases.push({
      phase: 'automation',
      system: 'delegation',
      summary: automationSummaryLine(automation),
      metrics: automation.results.slice(0, 6).map((r) => ({
        label: r.name,
        value: `${r.result.success ? 'ok' : r.result.errorKind ?? 'failed'}${r.result.profit !== 0 ? ` (${formatMoney(r.result.profit)})` : ''}: ${r.result.actions[0] ?? r.result.message}`.slice(0, 160),
      })),
      severity: automation.errors > 0 ? 'warning' : automation.profit > 0 ? 'good' : 'info',
    });
  }

  /* ----------------------------- 7. contracts --------------------------- */
  const missionResult = missionsDailyTick(state, rng);
  if (missionResult.completed.length > 0 || missionResult.expired.length > 0 || missionResult.offersRolled) {
    phases.push({
      phase: 'contracts',
      system: 'missions',
      summary:
        missionResult.completed.length > 0
          ? `${missionResult.completed.length} contract(s) paid out ${formatMoney(missionResult.completed.reduce((s, r) => s + r.cash, 0))}.`
          : missionResult.expired.length > 0
            ? `${missionResult.expired.length} contract(s) expired unfulfilled.`
            : 'The job board refreshed with new contracts.',
      metrics: [
        { label: 'Completed', value: String(missionResult.completed.length) },
        { label: 'Expired', value: String(missionResult.expired.length) },
        { label: 'Active', value: String(state.player.missions.filter((m) => m.status === 'active').length) },
      ],
      severity: missionResult.expired.length > 0 ? 'warning' : missionResult.completed.length > 0 ? 'good' : 'info',
    });
  }

  /* ------------------------------ 7b. finance --------------------------- */
  const accounts = accountsTick(state, rng);
  creditTick(state);
  const loans: LoanTickResult = loanTick(state, rng);
  const laundering: LaunderingTickResult = launderingTick(state, rng);
  const tax: TaxTickResult = taxTick(state, rng);
  // Only report when something actually happened: daily accrual is not news, a
  // capitalisation, a missed payment, a seizure, an audit or cleaned cash is.
  const financeNotable =
    accounts.interestEarned > 0 ||
    accounts.frozen.length > 0 ||
    accounts.unfrozen.length > 0 ||
    loans.capitalised > 0 ||
    loans.scheduledPayments > 0 ||
    loans.delinquent.length > 0 ||
    loans.defaults.length > 0 ||
    loans.seizures.length > 0 ||
    loans.violence.length > 0 ||
    loans.lateFees > 0 ||
    laundering.cleaned > 0 ||
    laundering.detections > 0 ||
    tax.assessed;
  if (financeNotable) {
    const metrics: { label: string; value: string }[] = [];
    if (accounts.interestEarned > 0) metrics.push({ label: 'Deposit interest', value: formatMoney(accounts.interestEarned) });
    if (loans.interestAccrued > 0) metrics.push({ label: 'Interest accrued today', value: formatMoney(loans.interestAccrued) });
    if (loans.capitalised > 0) metrics.push({ label: 'Interest capitalised', value: formatMoney(loans.capitalised) });
    if (loans.scheduledPayments > 0) metrics.push({ label: 'Scheduled payments', value: formatMoney(loans.scheduledPayments) });
    if (loans.lateFees > 0) metrics.push({ label: 'Late fees', value: formatMoney(loans.lateFees) });
    if (laundering.cleaned > 0) metrics.push({ label: 'Cash cleaned', value: formatMoney(laundering.cleaned) }, { label: 'Laundering fees', value: formatMoney(laundering.fees) });
    if (tax.assessed && tax.assessment) metrics.push({ label: 'Tax liability', value: formatMoney(tax.assessment.liability) });
    if (tax.penalty > 0) metrics.push({ label: 'Tax penalties', value: formatMoney(tax.penalty) });
    phases.push({
      phase: 'finance',
      system: 'treasury',
      summary: financeSummary(accounts.interestEarned, loans, laundering, tax),
      metrics,
      severity:
        loans.defaults.length > 0 || tax.audited || laundering.detections > 0
          ? 'danger'
          : loans.delinquent.length > 0 || tax.arrearsAdded > 0
            ? 'warning'
            : accounts.interestEarned > 0 || laundering.cleaned > 0
              ? 'good'
              : 'info',
    });
  }

  /* ------------------------------ 8. player ----------------------------- */
  resetDailyPlayerState(state);
  phases.push({
    phase: 'player',
    system: 'status',
    summary: `${state.player.stats.actionsToday} action(s) available, ${Math.round(state.player.stats.health)} HP, ${Math.round(state.player.stats.stamina)} stamina.`,
    metrics: [
      { label: 'Actions', value: `${state.player.stats.actionsToday}/${state.player.stats.maxActionsPerDay}` },
      { label: 'Health', value: `${Math.round(state.player.stats.health)}/${state.player.stats.maxHealth}` },
      { label: 'Stamina', value: `${Math.round(state.player.stats.stamina)}/${state.player.stats.maxStamina}` },
    ],
    severity: state.player.stats.health < 35 ? 'warning' : 'info',
  });

  /* ---------------------------- 9. valuation ---------------------------- */
  const netWorth = pushNetWorthSnapshot(state);
  const score = empireScore(state);
  evaluateConditions(state, netWorth.total, score);

  /* ---------------------------- 10. reporting --------------------------- */
  const news = state.world.news.slice(0, Math.max(0, newsBefore - state.world.news.length + newNewsCount(state, newsBefore)));
  const notifications = state.player.notifications.slice(0, Math.max(0, state.player.notifications.length - notificationsBefore));
  void news;

  state.updatedAt = new Date().toISOString();
  trimBuffers(state);

  const report: DayReport = {
    day,
    turn: state.turn,
    phases,
    news: state.world.news.filter((n) => n.day === day),
    notifications: opts.quiet ? [] : notifications,
    netWorth,
    netWorthChange: round2(netWorth.total - previousWorth),
    empireScore: score,
    spoilage,
    theft,
    marketMovers: marketResult.biggestMovers,
    companies: companyResult,
    crypto: cryptoResult,
    finance: { interestEarned: accounts.interestEarned, loans, laundering, tax },
    properties,
    payroll,
    businesses,
    production,
    factions,
    logistics,
    underground,
    events,
    automation,
    missions: missionResult,
    enforcement,
    prison: { incarcerated: prison.incarcerated, released: prison.released, escaped: prison.escaped, daysRemaining: prison.daysRemaining },
    ending: state.ending,
    elapsedMs: Date.now() - started,
  };

  pushDiagnostic(state, {
    system: 'tick',
    level: 'debug',
    message: `Day ${day} advanced in ${report.elapsedMs} ms: markets ${marketResult.stepped}, shocks ${worldResult.newShocks.length}, net worth ${round2(netWorth.total)}`,
    data: { day, markets: marketResult.stepped, shocks: worldResult.newShocks.length, netWorth: round2(netWorth.total), ms: report.elapsedMs },
  });

  return report;
}

function newNewsCount(state: GameState, before: number): number {
  return Math.max(0, state.world.news.length - before);
}

function shockPhase(shock: ActiveShock): PhaseReport {
  const scope = shock.locationIds.length > 0 ? shock.locationIds.map((id) => worldReg.location(id)?.name ?? id).slice(0, 3).join(', ') : shock.scope;
  const categories = Object.keys(shock.demandModifiers).length > 0 ? Object.keys(shock.demandModifiers) : Object.keys(shock.priceModifiers);
  return {
    phase: 'world',
    system: 'shock',
    summary: `${shock.name} (${shock.severity}) affecting ${scope}.`,
    metrics: [
      { label: 'Categories', value: categories.slice(0, 4).join(', ') || 'general' },
      { label: 'Expires', value: shock.expiresDay !== null ? `day ${shock.expiresDay}` : 'open-ended' },
      ...Object.entries(shock.priceModifiers)
        .slice(0, 4)
        .map(([cat, mul]) => ({ label: `${cat} price`, value: `×${mul.toFixed(2)}` })),
    ],
    severity: shock.severity === 'catastrophic' ? 'danger' : shock.severity === 'moderate' ? 'warning' : 'info',
  };
}

function emptyAutomationTick(): AutomationTickResult {
  return { ran: 0, skipped: 0, profit: 0, errors: 0, results: [] };
}

function emptyLogisticsTick(): LogisticsTickResult {
  return { events: [], delivered: [], inTransit: 0, freightSpend: 0, insurancePayouts: 0, vehicleWear: 0 };
}

function emptyUndergroundTick(): UndergroundTickResult {
  return { escrowLost: 0, assetDecayValue: 0, breaches: 0, compromised: false, assetsHeld: 0, heatDecayed: 0 };
}

function emptyBusinessTick(): BusinessTickResult {
  return { results: [], totalRevenue: 0, totalOpex: 0, totalWages: 0, totalTax: 0, totalProfit: 0, suspended: 0, failures: [] };
}

function emptyProductionTick(): ProductionTickResult {
  return { reports: [], totalOutputValue: 0, totalCost: 0, totalWaste: 0, breakdowns: [], blocked: [] };
}

function financeSummary(
  interestEarned: number,
  loans: LoanTickResult,
  laundering: LaunderingTickResult,
  tax: TaxTickResult,
): string {
  const parts: string[] = [];
  if (interestEarned > 0) parts.push(`deposits earned ${formatMoney(interestEarned)}`);
  if (loans.capitalised > 0) parts.push(`${formatMoney(loans.capitalised)} of interest capitalised into debt`);
  else if (loans.interestAccrued > 0) parts.push(`debt accrued ${formatMoney(loans.interestAccrued)}`);
  if (loans.scheduledPayments > 0) parts.push(`${formatMoney(loans.scheduledPayments)} of scheduled payments made`);
  if (loans.delinquent.length > 0) parts.push(`${loans.delinquent.length} loan(s) delinquent`);
  if (loans.defaults.length > 0) parts.push(`${loans.defaults.length} loan(s) defaulted`);
  if (loans.seizures.length > 0) parts.push(`${loans.seizures.length} pledged asset(s) seized`);
  if (loans.violence.length > 0) parts.push('collectors turned violent');
  if (laundering.cleaned > 0) parts.push(`fronts cleaned ${formatMoney(laundering.cleaned)}`);
  if (laundering.detections > 0) parts.push('laundering was detected');
  if (tax.assessed && tax.assessment && tax.assessment.liability > 0) {
    parts.push(tax.paid > 0 ? `tax paid ${formatMoney(tax.paid)}` : `tax unpaid ${formatMoney(tax.assessment.liability)}`);
  }
  if (tax.audited) parts.push('you were audited');
  return parts.length > 0 ? `Treasury: ${parts.join('; ')}.` : 'Treasury: no cash movements.';
}

function macroSummary(state: GameState): string {
  const ind = state.world.indicators;
  const trend = ind.inflationYoY > 0.08 ? 'Inflation is running hot' : ind.inflationYoY < 0.02 ? 'Inflation is tame' : 'Prices are drifting up';
  return `${trend} (${(ind.inflationYoY * 100).toFixed(1)}% YoY), base rate ${(ind.interestRate * 100).toFixed(2)}%, economy in ${ind.cyclePhaseLabel}, unemployment ${(ind.unemployment * 100).toFixed(1)}%, consumer confidence ${(ind.consumerConfidence * 100).toFixed(0)}%.`;
}

function pct(v: number): string {
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
}

/** Turn the day's biggest movers into news items so the feed explains prices. */
function publishMovers(state: GameState, movers: StepMarketsResult['biggestMovers']): void {
  const top = movers.slice(0, 3);
  if (top.length === 0) return;
  const rising = top.filter((m) => m.change > 0);
  const falling = top.filter((m) => m.change < 0);
  if (rising.length > 0) {
    pushNews(state.world, {
      scope: rising.length > 1 ? 'global' : 'local',
      category: 'market',
      headline: `${rising[0]!.name} jumps ${(rising[0]!.change * 100).toFixed(1)}%`,
      body: `${rising
        .map((m) => `${m.name} ${pct(m.change)} to ${formatMoney(m.price)}`)
        .join('; ')}. Traders point to tightening supply and event-driven demand.`,
      locationIds: rising.map((m) => m.locationId),
      tags: ['market', 'prices'],
      importance: rising[0]!.change > 0.15 ? 4 : 3,
      metrics: rising.map((m) => ({ label: m.name, value: pct(m.change) })),
    });
  }
  if (falling.length > 0) {
    pushNews(state.world, {
      scope: falling.length > 1 ? 'global' : 'local',
      category: 'market',
      headline: `${falling[0]!.name} slides ${(Math.abs(falling[0]!.change) * 100).toFixed(1)}%`,
      body: `${falling.map((m) => `${m.name} ${pct(m.change)} to ${formatMoney(m.price)}`).join('; ')}. Sellers are hitting bids as the glut builds.`,
      locationIds: falling.map((m) => m.locationId),
      tags: ['market', 'prices'],
      importance: falling[0]!.change < -0.15 ? 4 : 3,
      metrics: falling.map((m) => ({ label: m.name, value: pct(m.change) })),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Player daily reset                                                  */
/* ------------------------------------------------------------------ */

export function resetDailyPlayerState(state: GameState): void {
  const stats = state.player.stats;
  stats.actionsToday = stats.maxActionsPerDay;
  stats.stamina = round2(Math.min(stats.maxStamina, stats.stamina + B.player.staminaRegenPerDay));
  if (!state.player.prison.incarcerated) {
    stats.health = round2(Math.min(stats.maxHealth, stats.health + B.player.healthRegenPerDay));
  } else {
    stats.health = round2(Math.min(stats.maxHealth, stats.health + B.player.healthRegenPerDay * 0.4));
  }
  // Injuries heal.
  for (const emp of state.player.crew) {
    if (emp.injured && emp.injuredUntilDay !== null && state.world.day >= emp.injuredUntilDay) {
      emp.injured = false;
      emp.injuredUntilDay = null;
      emp.stats.health = 100;
      if (emp.status === 'injured') emp.status = 'active';
    }
  }
}

/* ------------------------------------------------------------------ */
/* Raids                                                               */
/* ------------------------------------------------------------------ */

export interface RaidResult {
  summary: string;
  metrics: { label: string; value: string }[];
  cashSeized: number;
  goodsSeizedValue: number;
  propertyDamage: number;
  arrested: boolean;
}

/** Enforcement raids premises the player owns at the current location. */
function raidPremises(state: GameState, rng: Rng): RaidResult {
  const locationId = state.player.locationId;
  const here = state.player.properties.filter((p) => p.locationId === locationId);
  const metrics: { label: string; value: string }[] = [];
  let cashSeized = 0;
  let goodsSeizedValue = 0;
  let propertyDamage = 0;

  // Dirty cash on hand is the first thing they take.
  const dirty = state.player.accounts.reduce((s, a) => s + a.dirtyBalance, 0);
  if (dirty > 0) {
    cashSeized = round2(dirty * B.enforcement.fineFractionOfDirtyCash * rng.float(0.8, 1.3));
    metrics.push({ label: 'Cash seized', value: formatMoney(cashSeized) });
  }

  // Illegal inventory stored here.
  const storages = state.player.storages.filter((s) => s.locationId === locationId || s.kind === 'personal');
  const storageIds = new Set(storages.map((s) => s.id));
  for (const stack of state.player.inventory.filter((s) => storageIds.has(s.storageId))) {
    const c = registry.get(stack.commodityId);
    if (!c || c.legality === 'legal') continue;
    const found = stack.concealed ? rng.chance(0.35) : rng.chance(0.85);
    if (!found) continue;
    goodsSeizedValue += stack.qty * c.baseValue;
    stack.qty = 0;
    metrics.push({ label: c.name, value: `${stack.qty} seized` });
  }
  state.player.inventory = state.player.inventory.filter((s) => s.qty > 0);
  goodsSeizedValue = round2(goodsSeizedValue);

  for (const property of here) {
    const damage = round2(rng.float(0.03, 0.14));
    property.condition = round2(Math.max(0.05, property.condition - damage));
    propertyDamage = round2(propertyDamage + damage);
  }
  if (here.length > 0) metrics.push({ label: 'Properties damaged', value: `${here.length} (−${(propertyDamage * 100).toFixed(0)}% condition)` });

  if (cashSeized > 0) {
    const accounts = state.player.accounts.filter((a) => a.dirtyBalance > 0);
    let remaining = cashSeized;
    for (const account of accounts) {
      if (remaining <= 0) break;
      const take = Math.min(account.dirtyBalance, remaining);
      account.dirtyBalance = round2(account.dirtyBalance - take);
      account.balance = round2(account.balance - take);
      remaining = round2(remaining - take);
    }
  }

  const arrested = rng.chance(0.35 * state.config.difficultyModifiers.enforcementMultiplier);
  if (arrested) {
    metrics.push({ label: 'Outcome', value: 'Arrested' });
  }

  pushNotification(state, {
    kind: 'danger',
    title: 'Premises raided',
    body: `Enforcement executed a raid in ${worldReg.requireLocation(locationId).name}. Investigation pressure was ${state.player.reputation.investigation.toFixed(0)}/100.`,
    link: '/game/progression',
    metrics: [
      ...metrics,
      { label: 'Goods seized', value: formatMoney(goodsSeizedValue) },
    ],
  });

  return {
    summary: `Raid in ${worldReg.requireLocation(locationId).name}: ${formatMoney(cashSeized)} cash and ${formatMoney(goodsSeizedValue)} of goods seized${here.length > 0 ? `, ${here.length} property(ies) damaged` : ''}.`,
    metrics,
    cashSeized,
    goodsSeizedValue,
    propertyDamage,
    arrested,
  };
}

/* ------------------------------------------------------------------ */
/* Victory and loss conditions                                         */
/* ------------------------------------------------------------------ */

export interface ConditionEvaluation {
  id: string;
  kind: string;
  description: string;
  target: number;
  current: number;
  progress: number;
  achieved: boolean;
}

export function evaluateVictoryConditions(state: GameState): ConditionEvaluation[] {
  const worth = computeNetWorth(state).total;
  const score = empireScore(state);
  return state.config.victoryConditions.map((condition) => {
    let current = 0;
    switch (condition.kind) {
      case 'net_worth':
        current = worth;
        break;
      case 'level':
        current = state.player.progression.level;
        break;
      case 'empire_score':
        current = score;
        break;
      case 'days_survived':
        current = state.world.day;
        break;
      case 'locations_controlled':
        current = state.player.properties.length;
        break;
      case 'faction_standing':
        current = condition.targetId
          ? state.world.factions[condition.targetId]?.playerStanding ?? 0
          : Math.max(...Object.values(state.world.factions).map((f) => f.playerStanding), 0);
        break;
      case 'monopoly':
        current = monopolyShare(state);
        break;
      default:
        current = 0;
    }
    const progress = condition.target > 0 ? Math.min(1, current / condition.target) : current >= condition.target ? 1 : 0;
    const achieved = current >= condition.target;
    if (achieved && !condition.achieved) {
      condition.achieved = true;
      condition.achievedDay = state.world.day;
    }
    return { id: condition.id, kind: condition.kind, description: condition.description, target: condition.target, current: round2(current), progress: round2(progress), achieved };
  });
}

/** Largest share the player holds of any single commodity category's trade. */
export function monopolyShare(state: GameState): number {
  const shareByCategory = new Map<string, number>();
  for (const market of Object.values(state.markets)) {
    const c = registry.get(market.commodityId);
    if (!c) continue;
    const traded = Math.max(market.volume30d, 1);
    const playerVolume = state.player.stats.counters[`traded:${market.key}:${state.world.day}`] ?? 0;
    const share = Math.min(1, playerVolume / traded);
    shareByCategory.set(c.category, Math.max(shareByCategory.get(c.category) ?? 0, share));
  }
  let best = 0;
  for (const value of shareByCategory.values()) best = Math.max(best, value);
  return round2(best);
}

export function evaluateLossConditions(state: GameState, netWorth: number, score: number): ConditionEvaluation[] {
  void score;
  return state.config.lossConditions.map((condition) => {
    let current = 0;
    switch (condition.kind) {
      case 'bankruptcy':
      case 'net_worth_floor':
        current = netWorth;
        break;
      case 'debt_floor':
        current = -state.player.loans.filter((l) => l.status === 'active').reduce((s, l) => s + l.balance, 0);
        break;
      case 'reputation_collapse':
        current = state.player.reputation.dimensions.global;
        break;
      case 'imprisonment':
        current = state.player.prison.incarcerated ? (state.player.prison.releaseDay ?? state.world.day) - (state.player.prison.incarceratedDay ?? state.world.day) : 0;
        break;
      case 'death':
        current = state.player.stats.health;
        break;
      default:
        current = 0;
    }
    // For bankruptcy/debt the condition triggers *below* the threshold; for
    // imprisonment it triggers above it. Encoded explicitly rather than guessed.
    const triggersBelow = condition.kind === 'bankruptcy' || condition.kind === 'net_worth_floor' || condition.kind === 'reputation_collapse' || condition.kind === 'death';
    const triggered = triggersBelow ? current <= condition.threshold : current >= condition.threshold;
    if (triggered && !condition.triggered) {
      condition.triggered = true;
      condition.triggeredDay = state.world.day;
    }
    const progress = condition.threshold === 0 ? (triggered ? 1 : 0) : Math.min(1, Math.abs(current / condition.threshold));
    return { id: condition.id, kind: condition.kind, description: condition.description, target: condition.threshold, current: round2(current), progress: round2(progress), achieved: triggered };
  });
}

export function evaluateConditions(state: GameState, netWorth: number, score: number): void {
  const victories = evaluateVictoryConditions(state);
  const losses = evaluateLossConditions(state, netWorth, score);

  if (state.status !== 'active') return;

  const triggeredLoss = losses.find((l) => l.achieved);
  if (triggeredLoss) {
    const kind = triggeredLoss.kind === 'bankruptcy' || triggeredLoss.kind === 'net_worth_floor' || triggeredLoss.kind === 'debt_floor'
      ? 'bankruptcy'
      : triggeredLoss.kind === 'reputation_collapse'
        ? 'reputation_collapse'
        : triggeredLoss.kind === 'imprisonment'
          ? 'imprisonment'
          : triggeredLoss.kind === 'death'
            ? 'death'
            : 'bankruptcy';
    state.ending = buildEnding(state, kind, `${triggeredLoss.description} (threshold ${triggeredLoss.target}, actual ${triggeredLoss.current}).`);
    state.status = kind === 'imprisonment' ? 'ended_imprisoned' : 'lost';
    pushNotification(state, {
      kind: 'danger',
      title: 'Game over',
      body: state.ending.summary,
      link: '/game',
    });
    return;
  }

  const won = victories.filter((v) => v.achieved);
  if (won.length > 0 && !state.config.endless) {
    state.ending = buildEnding(state, 'victory', `Objective met: ${won[0]!.description}.`);
    state.status = 'won';
    pushNotification(state, { kind: 'success', title: 'Victory', body: state.ending.summary, link: '/game' });
    return;
  }
  if (won.length > 0 && state.config.endless) {
    for (const w of won) {
      if (!state.player.progression.milestones.includes(`victory:${w.id}`)) {
        state.player.progression.milestones.push(`victory:${w.id}`);
        pushNotification(state, {
          kind: 'success',
          title: `Objective achieved: ${w.description}`,
          body: 'Endless mode is on — the empire keeps running. Turn off endless mode in settings to end the run here.',
          link: '/game/progression',
        });
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Multi-day advance                                                   */
/* ------------------------------------------------------------------ */

export interface MultiDayReport {
  days: number;
  reports: DayReport[];
  netWorthStart: number;
  netWorthEnd: number;
  netWorthChange: number;
  highlights: PhaseReport[];
  ending: GameState['ending'];
  stoppedEarly: boolean;
  stopReason: string | null;
  elapsedMs: number;
}

/**
 * Advance several days (resting, long journeys, idle automation). Stops early if
 * the run ends or something needs the player's attention.
 */
export function advanceDays(state: GameState, rng: Rng, count: number, opts: AdvanceOptions & { stopOnCombat?: boolean } = {}): MultiDayReport {
  const started = Date.now();
  const netWorthStart = computeNetWorth(state).total;
  const reports: DayReport[] = [];
  const highlights: PhaseReport[] = [];
  let stoppedEarly = false;
  let stopReason: string | null = null;

  for (let i = 0; i < Math.max(0, Math.floor(count)); i += 1) {
    if (state.status !== 'active') {
      stoppedEarly = true;
      stopReason = state.ending?.summary ?? 'The run has ended.';
      break;
    }
    if (opts.stopOnCombat && state.player.combat && state.player.combat.phase === 'active') {
      stoppedEarly = true;
      stopReason = 'A fight needs your attention.';
      break;
    }
    const report = advanceDay(state, rng, opts);
    reports.push(report);
    for (const phase of report.phases) {
      if (phase.severity === 'danger' || phase.severity === 'warning') highlights.push(phase);
    }
    if (report.enforcement.combat && !report.enforcement.combat.finished) {
      stoppedEarly = true;
      stopReason = 'An encounter interrupted the day.';
      break;
    }
    if (report.prison.incarcerated && !report.prison.released) {
      // Time still passes in prison, but the player cannot act.
      continue;
    }
  }

  const netWorthEnd = computeNetWorth(state).total;
  return {
    days: reports.length,
    reports,
    netWorthStart: round2(netWorthStart),
    netWorthEnd: round2(netWorthEnd),
    netWorthChange: round2(netWorthEnd - netWorthStart),
    highlights: highlights.slice(-24),
    ending: state.ending,
    stoppedEarly,
    stopReason,
    elapsedMs: Date.now() - started,
  };
}

/* ------------------------------------------------------------------ */
/* Housekeeping                                                        */
/* ------------------------------------------------------------------ */

function trimBuffers(state: GameState): void {
  const keepDiagnostics = B.player.diagnosticHistoryLength;
  if (state.diagnostics.length > keepDiagnostics) {
    state.diagnostics.splice(0, state.diagnostics.length - keepDiagnostics);
  }
  const keepNotifications = B.player.notificationHistoryLength;
  if (state.player.notifications.length > keepNotifications) {
    state.player.notifications.splice(0, state.player.notifications.length - keepNotifications);
  }
  // Ledger eviction goes through the one function that also moves the integrity
  // checkpoint forward. Splicing here directly would orphan the retained chain.
  trimTransactionHistory(state);
  const keepWorth = B.player.netWorthHistoryLength;
  if (state.player.netWorthHistory.length > keepWorth) {
    state.player.netWorthHistory.splice(0, state.player.netWorthHistory.length - keepWorth);
  }
  // Expire finished shocks and stale event cooldowns so long saves stay lean.
  state.world.shocks = state.world.shocks.filter((s) => s.expiresDay === null || s.expiresDay > state.world.day);
  for (const [key, until] of orderedEntries(state.world.eventCooldowns)) {
    if (until <= state.world.day) delete state.world.eventCooldowns[key];
  }
}

/** Diagnostic snapshot used by the debug panel and by tests. */
export function simulationStatus(state: GameState): {
  day: number;
  turn: number;
  status: GameState['status'];
  markets: number;
  shocks: number;
  activeEvents: number;
  news: number;
  diagnostics: DiagnosticEntry[];
  netWorth: number;
  empireScore: number;
  inflation: number;
  interestRate: number;
  cycle: string;
  inventoryStacks: number;
  crew: number;
  properties: number;
  businesses: number;
  loans: number;
  heat: number;
  investigation: number;
  incarcerated: boolean;
  travelling: boolean;
  combatActive: boolean;
} {
  return {
    day: state.world.day,
    turn: state.turn,
    status: state.status,
    markets: Object.keys(state.markets).length,
    shocks: state.world.shocks.length,
    activeEvents: state.world.activeEvents.length,
    news: state.world.news.length,
    diagnostics: state.diagnostics.slice(-40),
    netWorth: round2(computeNetWorth(state).total),
    empireScore: round2(empireScore(state)),
    inflation: state.world.inflationRate,
    interestRate: state.world.interestRate,
    cycle: state.world.indicators.cyclePhaseLabel,
    inventoryStacks: state.player.inventory.length,
    crew: state.player.crew.length,
    properties: state.player.properties.length,
    businesses: state.player.businesses.length,
    loans: state.player.loans.filter((l) => l.status === 'active').length,
    heat: state.player.reputation.heat,
    investigation: state.player.reputation.investigation,
    incarcerated: state.player.prison.incarcerated,
    travelling: state.player.travel !== null,
    combatActive: state.player.combat !== null && state.player.combat.phase === 'active',
  };
}

/** Deterministic per-day stream so the same seed replays identically. */
export function rngForDay(state: GameState, day: number): Rng {
  return new Rng(`${state.config.worldSeed}:day:${day}`, `day-${day}`);
}

/**
 * Per-action randomness.
 *
 * Seeded from the world seed, the day, the turn counter and the intent, so:
 *   • two actions on the same day never share a stream (the turn increments),
 *   • the same save replayed with the same intent produces the same outcome, which
 *     is what makes a deterministic bug report possible,
 *   • a client cannot influence the roll — nothing here comes from the request.
 */
export function rngForAction(state: GameState, intentType: string): Rng {
  return new Rng(`${state.config.worldSeed}:action:${state.world.day}:${state.turn}:${intentType}`, `action-${state.world.day}-${state.turn}`);
}

export function locationName(locationId: string): string {
  return worldReg.location(locationId)?.name ?? locationId;
}
