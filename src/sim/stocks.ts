/**
 * Stocks — listed companies, sectors, dividends, bubbles, crashes, M&A and
 * failures (spec §17).
 *
 * Equities are deliberately *not* another commodity market. Prices here are
 * driven by earnings per share and the multiple investors are willing to pay for
 * those earnings, which is itself a function of sentiment, the economic cycle,
 * the company's beta and its exposure to commodity categories. That produces the
 * behaviour equities actually have: drift with a trend, sector correlation,
 * manias when sentiment runs hot, and air pockets when it breaks — plus discrete
 * corporate events (dividends, mergers, bankruptcies) that commodities never have.
 *
 * The player interacts through a brokerage settlement account. Orders are
 * validated, priced with liquidity impact, and settled server-side.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { COMPANIES, COMPANY_BY_ID, SECTORS } from '../engine/registry/actors';
import { getWorldRegistry } from '../engine/registry/world';
import { taxReduction } from './modifiers';
import { bumpCounter, counter, grantXp, maxCounter, playerModifiers, setCounter } from './progression';
import { changeReputation } from './reputation';
import {
  computeNetWorth,
  creditCash,
  debitCash,
  formatMoney,
  newId,
  pushDiagnostic,
  pushNotification,
  round2,
  spendable,
} from './state';
import { pushNews } from './world';
import type { CompanyDef, CompanyState, GameState, ID, WorldState } from './types';

const B = getBalance();
const worldReg = getWorldRegistry();

const HISTORY_DAYS = 120;
const DIVIDEND_PERIOD_DAYS = 90;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Earnings per share needs finer precision than currency. */
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/**
 * Share prices need relative precision: a large cap trades in the hundreds while
 * a post-bankruptcy shell trades in fractions of a cent. Fixed 2-decimal rounding
 * would floor the cheap end at zero and poison every later return calculation.
 */
function roundPrice(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0.0001;
  return Number(Math.max(0.0001, v).toPrecision(10));
}

/* ------------------------------------------------------------------ */
/* Initialisation                                                      */
/* ------------------------------------------------------------------ */

/** Populate `world.companies` from the registry with seeded opening prices. */
export function initCompanies(world: WorldState, rng: Rng, day = 0): number {
  let created = 0;
  // Ascending id order: see `orderedRecord` in world.ts — the save format sorts
  // object keys, so a record built in this order iterates identically live and
  // after a reload.
  for (const def of [...COMPANIES].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (world.companies[def.id]) continue;
    const price = roundPrice(def.marketCap / Math.max(1, def.sharesOutstanding));
    const eps = round4((def.revenueAnnual * def.margin) / Math.max(1, def.sharesOutstanding));
    const sentiment = round2(clamp(0.5 + rng.gaussian(0, 0.09), 0.08, 0.92));
    const history: number[] = [];
    const startDay = Math.max(0, day - HISTORY_DAYS);
    for (let d = startDay; d < day; d += 1) {
      const drift = (def.growth / 365) * (d - startDay);
      const noise = new Rng(`stock:${def.id}:${d}`, 'stock-history').gaussian(0, 0.011 + def.beta * 0.004);
      history.push(roundPrice(price * (1 + drift + noise * (1 + (d - startDay) * 0.001))));
    }
    world.companies[def.id] = {
      companyId: def.id,
      price,
      eps,
      revenue: def.revenueAnnual,
      sentiment,
      sharesOutstanding: def.sharesOutstanding,
      history,
      historyStartDay: startDay,
      dividendPerShareAnnual: round4(price * def.dividendYieldAnnual),
      lastDividendDay: day,
      status: 'active',
      pendingAction: null,
      fundamentalsQuality: round4(clamp(0.35 + def.margin * 1.6 + def.growth * 2.4 + rng.float(0, 0.18), 0.05, 0.99)),
    };
    created += 1;
  }
  world.stockIndex = indexLevel(world);
  world.stockIndexHistory = [world.stockIndex];
  return created;
}

/**
 * Capitalisation-weighted index level, normalised to the configured base.
 *
 * Constituents that are acquired or go bankrupt are removed from *both* the
 * current value and the base — the same divisor adjustment a real index makes.
 * Leaving them in the base only would drop the index mechanically on every
 * corporate action regardless of how the market actually traded.
 */
export function indexLevel(world: WorldState): number {
  let base = 0;
  let value = 0;
  for (const def of COMPANIES) {
    const c = world.companies[def.id];
    if (!c || c.status !== 'active') continue;
    base += def.marketCap;
    value += c.price * def.sharesOutstanding;
  }
  if (base === 0 || value === 0) return B.stocks.indexBaseLevel;
  return roundPrice((value / base) * B.stocks.indexBaseLevel);
}

/* ------------------------------------------------------------------ */
/* Daily step                                                          */
/* ------------------------------------------------------------------ */

export interface CorporateEvent {
  companyId: ID;
  ticker: string;
  name: string;
  kind: 'dividend' | 'merger' | 'acquisition' | 'bankruptcy' | 'crash' | 'bubble' | 'earnings' | 'delisting';
  headline: string;
  detail: string;
  importance: 1 | 2 | 3 | 4 | 5;
}

export interface CompanyStepResult {
  stepped: number;
  indexLevel: number;
  indexChange: number;
  events: CorporateEvent[];
  biggestMovers: { companyId: ID; ticker: string; name: string; change: number; price: number }[];
  dividendsPaidToPlayer: number;
}

/** Commodity-category price pressure from active shocks, per company exposure. */
function exposurePressure(world: WorldState, def: CompanyDef): number {
  let pressure = 0;
  for (const [category, weight] of Object.entries(def.exposure)) {
    if (weight === undefined) continue;
    let multiplier = 1;
    for (const shock of world.shocks) {
      const pm = shock.priceModifiers[category as keyof typeof shock.priceModifiers];
      const dm = shock.demandModifiers[category as keyof typeof shock.demandModifiers];
      if (pm !== undefined) multiplier *= pm;
      if (dm !== undefined) multiplier *= 1 + (dm - 1) * 0.35;
    }
    // Producers benefit from higher input prices; consumers are squeezed by them.
    const producer = def.sector === 'Materials' || def.sector === 'Energy' || def.sector === 'Consumer Staples';
    pressure += (multiplier - 1) * weight * (producer ? 1 : -1);
  }
  return clamp(pressure, -0.6, 0.9);
}

export function stepCompanies(state: GameState, rng: Rng): CompanyStepResult {
  const world = state.world;
  const day = world.day;
  const events: CorporateEvent[] = [];
  const movers: CompanyStepResult['biggestMovers'] = [];
  let stepped = 0;
  let dividendsPaid = 0;

  // Market-wide factors. Cycle position, sentiment and rates are *levels*, so
  // they contribute a slow daily drift rather than a full daily return — applying
  // them unscaled would grind every equity toward zero during a contraction.
  const levelToDailyDrift = 0.02;
  const cyclePush = (world.cycleFactor - 1) * 0.35 * levelToDailyDrift;
  const sentimentPush = (world.globalSentiment - 0.5) * 0.06 * levelToDailyDrift;
  const ratePush = -(world.interestRate - B.finance.baseInterestRateAnnual) * 0.5 * levelToDailyDrift;
  // Long-run equity risk premium (~10%/yr): the reason holding equities is
  // expected to beat cash. Without it the index grinds down in every simulation.
  const equityRiskPremiumPerDay = 0.0004;
  const marketReturn = clamp(cyclePush + sentimentPush + ratePush + equityRiskPremiumPerDay + rng.gaussian(0, B.stocks.marketBetaNoise), -0.05, 0.05);
  const sectorNoise = new Map<string, number>();
  for (const sector of SECTORS) sectorNoise.set(sector, rng.gaussian(0, B.stocks.marketBetaNoise * B.stocks.sectorCorrelation));

  for (const def of COMPANIES) {
    const c = world.companies[def.id];
    if (!c || c.status !== 'active') continue;
    const before = c.price;

    /* ------------------------------- earnings ------------------------------ */
    const growthPerDay = (def.growth + B.stocks.earningsDriftAnnual) / 365;
    const earningsNoise = rng.gaussian(0, B.stocks.earningsVolatility / Math.sqrt(365));
    const pressure = exposurePressure(world, def);
    c.eps = round4(c.eps * (1 + growthPerDay + earningsNoise + pressure * 0.004));
    c.revenue = round2(c.revenue * (1 + growthPerDay * 0.8 + earningsNoise * 0.4));

    /* ------------------------------ sentiment ------------------------------ */
    const retNoise = rng.gaussian(0, 0.02) + marketReturn * def.beta * 0.6;
    c.sentiment = round2(clamp(c.sentiment * 0.985 + (0.5 + clamp(retNoise * 6, -0.28, 0.28)) * 0.015, 0.05, 0.97));
    // Manias are *event-driven*, not price-driven. Feeding price back into
    // sentiment creates a runaway loop that ends in a permanent bear market; a
    // discrete narrative shock produces the same boom (and the same bust) without
    // the instability.
    if (rng.chance(0.0009)) {
      const mania = rng.float(0.18, 0.42);
      c.sentiment = round2(clamp(c.sentiment + mania, 0.02, 0.99));
      events.push({
        companyId: def.id,
        ticker: def.ticker,
        name: def.name,
        kind: 'bubble',
        headline: `Investors pile into ${def.ticker}`,
        detail: `A new narrative — ${mania > 0.32 ? 'a blockbuster guidance upgrade' : 'sector rotation and a widely shared thesis'} — has money chasing ${def.name}. Sentiment is now ${(c.sentiment * 100).toFixed(0)}/100.`,
        importance: 3,
      });
    }

    /* ------------------------------ valuation ------------------------------ */
    const [peLow, peHigh] = B.stocks.peRange;
    const sentimentPe = peLow + (peHigh - peLow) * Math.pow(c.sentiment, 1.35);
    // The multiple the market is *currently* paying drifts toward the
    // sentiment-implied multiple instead of snapping to it, so opening prices
    // (from the registry market cap) stay authoritative and re-rating is gradual.
    const impliedPe = c.eps > 0 ? clamp(before / c.eps, 1, 200) : sentimentPe;
    const pe = impliedPe * 0.94 + sentimentPe * 0.06;
    const bubble = c.sentiment > B.stocks.bubbleThresholdSentiment ? B.stocks.bubbleInflationPerDay * (c.sentiment - B.stocks.bubbleThresholdSentiment) * 12 : 0;
    const fair = c.eps > 0 ? Math.max(0.01, c.eps * pe) : Math.max(0.01, before * 0.985);
    const reversion = 0.02;
    const target = fair * (1 + bubble * 30);
    const idio = rng.gaussian(0, 0.008 + def.beta * 0.006);
    const ret = clamp(reversion * (target / Math.max(0.01, before) - 1) + marketReturn * def.beta + (sectorNoise.get(def.sector) ?? 0) + idio, -0.35, 0.4);
    c.price = roundPrice(before * (1 + ret));

    /* --------------------------- bubbles & crashes -------------------------- */
    if (c.sentiment > B.stocks.bubbleThresholdSentiment && bubble > 0 && rng.chance(0.02)) {
      events.push({
        companyId: def.id,
        ticker: def.ticker,
        name: def.name,
        kind: 'bubble',
        headline: `${def.ticker} looks stretched`,
        detail: `Sentiment ${(c.sentiment * 100).toFixed(0)}/100 with a P/E of ${(c.price / Math.max(0.001, c.eps)).toFixed(1)}. Manias end abruptly.`,
        importance: 3,
      });
    }
    // Every crash trigger is probability-gated. An ungated "sentiment is low"
    // test fires *every day* the condition holds, which compounds a 30% loss
    // daily and turns any bear patch into a total wipeout.
    const bubblePopChance = c.sentiment > B.stocks.bubbleThresholdSentiment ? 0.035 + (c.sentiment - B.stocks.bubbleThresholdSentiment) * 0.6 : 0;
    const capitulationChance = c.sentiment < B.stocks.crashThresholdSentiment ? 0.22 : 0;
    const distressChance = c.eps <= 0 ? 0.06 : 0;
    const crashChance = clamp(bubblePopChance + capitulationChance + distressChance, 0, 0.45);
    if (crashChance > 0 && rng.chance(crashChance)) {
      const [lo, hi] = B.stocks.crashSeverityRange;
      const severity = rng.float(lo, hi) * state.config.difficultyModifiers.eventSeverityMultiplier;
      c.price = roundPrice(c.price * (1 - clamp(severity, 0.05, 0.85)));
      // Capitulation clears the sellers: sentiment resets upward after the break
      // so the name can recover instead of grinding to zero.
      c.sentiment = round2(clamp(rng.float(0.22, 0.46), 0.02, 0.99));
      c.fundamentalsQuality = round2(clamp(c.fundamentalsQuality - rng.float(0.05, 0.2), 0.02, 0.99));
      c.pendingAction = `Air pocket on day ${day}: −${(clamp(severity, 0.05, 0.85) * 100).toFixed(0)}%`;
      events.push({
        companyId: def.id,
        ticker: def.ticker,
        name: def.name,
        kind: 'crash',
        headline: `${def.ticker} falls ${(severity * 100).toFixed(0)}% in a single session`,
        detail:
          c.eps <= 0
            ? `${def.name} is loss-making and investors stopped paying for the story.`
            : `Sentiment broke below ${B.stocks.crashThresholdSentiment}. Leveraged holders were forced to sell into the fall.`,
        importance: severity > 0.35 ? 5 : 4,
      });
    }

    /* ------------------------------- dividends ------------------------------ */
    if (day - c.lastDividendDay >= DIVIDEND_PERIOD_DAYS) {
      c.lastDividendDay = day;
      const perShare = round4(c.dividendPerShareAnnual / 4);
      c.dividendPerShareAnnual = round4(Math.max(0, perShare * 4 * (1 + (def.growth + B.stocks.earningsDriftAnnual) / 4)));
      if (perShare > 0) {
        const paid = payPlayerDividend(state, def, c, perShare);
        dividendsPaid = round2(dividendsPaid + paid);
        if (paid > 0) {
          events.push({
            companyId: def.id,
            ticker: def.ticker,
            name: def.name,
            kind: 'dividend',
            headline: `${def.ticker} pays a ${formatMoney(perShare)} dividend`,
            detail: `Yield ${((c.dividendPerShareAnnual / Math.max(0.01, c.price)) * 100).toFixed(2)}% at the current price.`,
            importance: 2,
          });
        }
      }
    }

    /* --------------------------- M&A and failures --------------------------- */
    if (rng.chance(B.stocks.mergerChancePerCompanyPerDay)) {
      const merger = attemptMerger(state, rng, def, c);
      if (merger) events.push(merger);
    }
    if (c.status === 'active' && rng.chance(B.stocks.failureChancePerCompanyPerDay * (1 + (c.eps <= 0 ? 6 : 0)) * (1.6 - c.fundamentalsQuality))) {
      const failure = bankruptCompany(state, rng, def, c);
      if (failure) events.push(failure);
    }

    /* -------------------------------- history ------------------------------- */
    c.history = c.history.length >= HISTORY_DAYS ? [...c.history.slice(1), c.price] : [...c.history, c.price];
    if (c.history.length >= HISTORY_DAYS) c.historyStartDay = day - HISTORY_DAYS + 1;
    stepped += 1;

    const change = before > 0 ? c.price / before - 1 : 0;
    if (Math.abs(change) > 0.02) movers.push({ companyId: def.id, ticker: def.ticker, name: def.name, change: round2(change), price: c.price });
  }

  const previousIndex = world.stockIndex;
  world.stockIndex = indexLevel(world);
  world.stockIndexHistory = world.stockIndexHistory.length >= HISTORY_DAYS ? [...world.stockIndexHistory.slice(1), world.stockIndex] : [...world.stockIndexHistory, world.stockIndex];

  movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  for (const event of events) {
    pushNews(world, {
      scope: 'global',
      category: event.kind === 'dividend' || event.kind === 'merger' || event.kind === 'acquisition' || event.kind === 'bankruptcy' || event.kind === 'delisting' ? 'corporate' : 'market',
      headline: event.headline,
      body: event.detail,
      locationIds: [],
      tags: ['stocks', event.ticker, event.kind],
      importance: event.importance,
    });
  }

  return {
    stepped,
    indexLevel: world.stockIndex,
    indexChange: previousIndex > 0 ? round2(world.stockIndex / previousIndex - 1) : 0,
    events,
    biggestMovers: movers.slice(0, 10),
    dividendsPaidToPlayer: dividendsPaid,
  };
}

function payPlayerDividend(state: GameState, def: CompanyDef, c: CompanyState, perShare: number): number {
  const holding = state.player.stockHoldings.find((h) => h.companyId === def.id && h.shares > 0);
  if (!holding) return 0;
  const gross = round2(perShare * holding.shares);
  if (gross <= 0) return 0;
  const mods = playerModifiers(state);
  const taxRate = Math.max(0, B.finance.tax.incomeTaxRate * (1 - taxReduction(mods)));
  const tax = round2(gross * taxRate);
  const net = round2(gross - tax);
  creditCash(state, net, {
    kind: 'dividend',
    description: `${def.ticker} dividend on ${holding.shares.toLocaleString('en-US')} shares`,
    dirty: false,
    accountId: holding.accountId,
    counterparty: def.name,
    meta: { perShare, gross, tax },
  });
  if (tax > 0) {
    debitCash(state, tax, {
      kind: 'tax',
      description: `Dividend withholding on ${def.ticker}`,
      allowDirty: false,
      accountId: holding.accountId,
    });
    setCounter(state, 'tax_paid', round2(counter(state, 'tax_paid') + tax));
  }
  holding.dividendsReceived = round2(holding.dividendsReceived + net);
  bumpCounter(state, 'dividends_received');
  setCounter(state, 'dividend_income', round2(counter(state, 'dividend_income') + net));
  void c;
  return net;
}

function attemptMerger(state: GameState, rng: Rng, target: CompanyDef, targetState: CompanyState): CorporateEvent | null {
  const candidates = COMPANIES.filter(
    (c) => c.id !== target.id && c.sector === target.sector && c.marketCap > target.marketCap * 1.25 && state.world.companies[c.id]?.status === 'active',
  );
  if (candidates.length === 0) return null;
  const acquirer = rng.pick(candidates);
  if (!acquirer) return null;
  const acquirerState = state.world.companies[acquirer.id]!;
  const premium = rng.float(0.18, 0.45);
  const offerPrice = round2(targetState.price * (1 + premium));

  // Cash out the player's holding at the offer price.
  const holding = state.player.stockHoldings.find((h) => h.companyId === target.id && h.shares > 0);
  if (holding) {
    const proceeds = round2(offerPrice * holding.shares);
    creditCash(state, proceeds, {
      kind: 'stock_sell',
      description: `${acquirer.ticker} acquisition of ${target.ticker}: ${holding.shares.toLocaleString('en-US')} shares at ${formatMoney(offerPrice)}`,
      dirty: false,
      accountId: holding.accountId,
      counterparty: acquirer.name,
      meta: { premium, shares: holding.shares },
    });
    const gain = round2(proceeds - holding.avgCost * holding.shares);
    if (gain > 0) {
      setCounter(state, 'capital_gains', round2(counter(state, 'capital_gains') + gain));
      grantXp(state, Math.round(Math.sqrt(gain) * 0.4), `${target.ticker} taken out at a premium`);
    }
    state.player.stockHoldings = state.player.stockHoldings.filter((h) => h.companyId !== target.id);
    pushNotification(state, {
      kind: gain > 0 ? 'success' : 'warning',
      title: `${target.ticker} acquired by ${acquirer.ticker}`,
      body: `Your ${holding.shares.toLocaleString('en-US')} shares were bought out at ${formatMoney(offerPrice)} (${(premium * 100).toFixed(0)}% premium) for ${formatMoney(proceeds)}.`,
      link: '/game/stocks',
      metrics: [
        { label: 'Proceeds', value: formatMoney(proceeds) },
        { label: 'Gain', value: formatMoney(gain) },
      ],
    });
  }

  targetState.status = 'acquired';
  targetState.acquiredBy = acquirer.id;
  targetState.pendingAction = `Acquired by ${acquirer.name} at ${formatMoney(offerPrice)}`;
  acquirerState.eps = round4(acquirerState.eps * (1 + targetState.eps * 0.02));
  acquirerState.price = roundPrice(acquirerState.price * (1 - premium * 0.04));
  acquirerState.sentiment = round2(clamp(acquirerState.sentiment + 0.04, 0.02, 0.99));
  bumpCounter(state, 'mergers_observed');

  return {
    companyId: target.id,
    ticker: target.ticker,
    name: target.name,
    kind: 'acquisition',
    headline: `${acquirer.ticker} to acquire ${target.ticker} at a ${(premium * 100).toFixed(0)}% premium`,
    detail: `${acquirer.name} agreed to buy ${target.name} for ${formatMoney(offerPrice)} per share, consolidating the ${target.sector} sector.`,
    importance: 4,
  };
}

function bankruptCompany(state: GameState, rng: Rng, def: CompanyDef, c: CompanyState): CorporateEvent | null {
  c.status = 'bankrupt';
  c.price = roundPrice(c.price * rng.float(0.02, 0.12));
  c.sentiment = 0.03;
  c.pendingAction = 'Bankrupt — equity wiped out';

  const holding = state.player.stockHoldings.find((h) => h.companyId === def.id && h.shares > 0);
  if (holding) {
    const loss = round2(holding.shares * holding.avgCost);
    state.player.stockHoldings = state.player.stockHoldings.filter((h) => h.companyId !== def.id);
    bumpCounter(state, 'bankruptcy_losses');
    setCounter(state, 'writeoffs', round2(counter(state, 'writeoffs') + loss));
    changeReputation(state, 'business', -1, `Held ${def.ticker} into bankruptcy`);
    pushNotification(state, {
      kind: 'danger',
      title: `${def.ticker} is bankrupt`,
      body: `${def.name} failed. Your ${holding.shares.toLocaleString('en-US')} shares are worthless — a ${formatMoney(loss)} write-off against your ${formatMoney(holding.avgCost)} average cost.`,
      link: '/game/stocks',
      metrics: [{ label: 'Written off', value: formatMoney(loss) }],
    });
  }
  pushDiagnostic(state, {
    system: 'stocks',
    level: 'warn',
    message: `${def.ticker} bankrupt (eps ${c.eps}, quality ${c.fundamentalsQuality}, sentiment ${c.sentiment})`,
    data: { eps: c.eps, quality: c.fundamentalsQuality },
  });
  return {
    companyId: def.id,
    ticker: def.ticker,
    name: def.name,
    kind: 'bankruptcy',
    headline: `${def.name} files for bankruptcy`,
    detail: `${def.ticker} equity is worthless. Creditors will recover what they can; the ${def.sector} sector loses a competitor.`,
    importance: 5,
  };
}

/* ------------------------------------------------------------------ */
/* Brokerage                                                           */
/* ------------------------------------------------------------------ */

export interface BrokerageResult {
  ok: boolean;
  reason?: string;
  accountId?: ID;
}

/**
 * Link a settlement account for share trading. Requires a real bank account in
 * good standing — the brokerage is not a bank and holds no cash of its own.
 */
export function openBrokerageAccount(state: GameState, accountId?: ID): BrokerageResult {
  if (state.player.brokerageAccountId) {
    const existing = state.player.accounts.find((a) => a.id === state.player.brokerageAccountId);
    if (existing) return { ok: true, accountId: existing.id };
  }
  const candidates = state.player.accounts.filter((a) => !a.frozen && (a.frozenUntilDay === null || a.frozenUntilDay <= state.world.day));
  if (accountId && !candidates.some((a) => a.id === accountId)) {
    return { ok: false, reason: 'That account cannot be used for settlement (frozen or unknown).' };
  }
  const account = accountId ? candidates.find((a) => a.id === accountId)! : candidates[0];
  if (!account) return { ok: false, reason: 'You need an unfrozen bank account to settle share trades.' };
  state.player.brokerageAccountId = account.id;
  pushNotification(state, {
    kind: 'success',
    title: 'Brokerage account opened',
    body: `Settlement account: ${account.institution}. Trading fee ${(B.stocks.tradingFeeFraction * 100).toFixed(2)}% (minimum ${formatMoney(B.stocks.tradingFeeMin)}).`,
    link: '/game/stocks',
  });
  return { ok: true, accountId: account.id };
}

/* ------------------------------------------------------------------ */
/* Quoting and trading                                                 */
/* ------------------------------------------------------------------ */

export interface StockQuote {
  companyId: ID;
  ticker: string;
  name: string;
  sector: string;
  side: 'buy' | 'sell';
  requestedShares: number;
  shares: number;
  marketPrice: number;
  fairValue: number;
  premiumVsFair: number;
  executionPrice: number;
  gross: number;
  fee: number;
  tax: number;
  total: number;
  impact: number;
  liquidityShares: number;
  dailyVolume: number;
  warnings: string[];
  tradable: boolean;
  reason?: string;
}

function liquidityOf(c: CompanyState): number {
  // ~0.2% of shares outstanding change hands daily.
  return Math.max(1000, Math.round(c.sharesOutstanding * 0.002));
}

export function quoteShares(state: GameState, companyId: ID, shares: number, side: 'buy' | 'sell'): StockQuote | null {
  const def = COMPANY_BY_ID[companyId];
  const c = state.world.companies[companyId];
  if (!def || !c) return null;
  const warnings: string[] = [];
  const requested = Math.max(0, Math.floor(shares));

  if (c.status !== 'active') {
    warnings.push(`${def.ticker} is ${c.status} — it cannot be traded.`);
  }
  if (!state.player.brokerageAccountId) warnings.push('No brokerage settlement account is linked.');

  const holding = state.player.stockHoldings.find((h) => h.companyId === companyId);
  const owned = holding?.shares ?? 0;
  const liquidity = liquidityOf(c);
  const dailyVolume = Math.round(liquidity * (0.4 + c.sentiment * 0.9));

  let limit = Math.min(requested, Math.round(dailyVolume * 0.25));
  if (side === 'sell') limit = Math.min(limit, owned);

  const [peLow, peHigh] = B.stocks.peRange;
  const fairValue = c.eps > 0 ? round2(c.eps * (peLow + (peHigh - peLow) * Math.pow(c.sentiment, 1.35))) : round2(c.price * 0.6);
  const impact = limit > 0 ? clamp((limit / Math.max(1, dailyVolume)) * 0.35, 0, 0.18) : 0;
  const executionPrice = roundPrice(side === 'buy' ? c.price * (1 + 0.0012 + impact) : c.price * (1 - 0.0012 - impact));
  const gross = round2(executionPrice * limit);
  const fee = round2(Math.max(B.stocks.tradingFeeMin, gross * B.stocks.tradingFeeFraction));

  let tax = 0;
  if (side === 'sell' && holding && limit > 0) {
    const gain = Math.max(0, (executionPrice - holding.avgCost) * limit);
    const mods = playerModifiers(state);
    tax = round2(gain * Math.max(0, B.finance.tax.capitalGainsRate * (1 - taxReduction(mods))));
  }

  const total = side === 'buy' ? round2(gross + fee) : round2(gross - fee - tax);
  if (side === 'buy' && total > spendable(state.player, state.world.day, false)) {
    warnings.push(`Insufficient settled cash: ${formatMoney(total)} required, ${formatMoney(spendable(state.player, state.world.day, false))} available.`);
  }
  if (side === 'sell' && limit < requested) {
    warnings.push(limit <= owned ? `Only ${dailyVolume.toLocaleString('en-US')} shares trade daily — the order was capped to stay liquid.` : `You only hold ${owned.toLocaleString('en-US')} shares.`);
  }
  if (requested > 0 && limit <= 0) warnings.push('No executable size.');
  if (side === 'buy' && fairValue > 0 && executionPrice / fairValue > 1.6) {
    warnings.push(`${def.ticker} trades ${(executionPrice / fairValue).toFixed(2)}× its earnings-based fair value — sentiment is doing the pricing.`);
  }

  const tradable = c.status === 'active' && state.player.brokerageAccountId !== null && limit > 0 && (side === 'sell' || total <= spendable(state.player, state.world.day, false));

  return {
    companyId,
    ticker: def.ticker,
    name: def.name,
    sector: def.sector,
    side,
    requestedShares: requested,
    shares: limit,
    marketPrice: c.price,
    fairValue,
    premiumVsFair: fairValue > 0 ? round2(executionPrice / fairValue - 1) : 0,
    executionPrice,
    gross,
    fee,
    tax,
    total,
    impact: round2(impact),
    liquidityShares: liquidity,
    dailyVolume,
    warnings,
    tradable,
    ...(tradable ? {} : { reason: warnings[0] ?? 'Not tradable' }),
  };
}

export interface StockTradeResult {
  ok: boolean;
  code?: string;
  reason?: string;
  quote?: StockQuote;
  shares: number;
  cashDelta: number;
  holdingShares: number;
  avgCost: number;
  unrealisedPnl: number;
  realisedGain: number;
  tax: number;
  fee: number;
  xp: number;
  transactionId?: ID;
  warnings: string[];
}

export function buyShares(state: GameState, companyId: ID, shares: number): StockTradeResult {
  const quote = quoteShares(state, companyId, shares, 'buy');
  if (!quote) return failedTrade('unknown_company', `Unknown company "${companyId}".`);
  if (!state.player.brokerageAccountId) {
    const opened = openBrokerageAccount(state);
    if (!opened.ok) return failedTrade('no_brokerage', opened.reason ?? 'No brokerage account.', quote);
  }
  if (!quote.tradable) return failedTrade('not_tradable', quote.reason ?? 'Order cannot be executed.', quote);

  const move = debitCash(state, quote.total, {
    kind: 'stock_buy',
    description: `Bought ${quote.shares.toLocaleString('en-US')} ${quote.ticker} @ ${formatMoney(quote.executionPrice)}`,
    allowDirty: false,
    accountId: state.player.brokerageAccountId ?? undefined,
    counterparty: quote.name,
    meta: { fee: quote.fee, impact: quote.impact, sector: quote.sector },
  });
  if (!move.ok) return failedTrade('payment_failed', move.reason ?? 'Insufficient settled cash.', quote);

  const holding = state.player.stockHoldings.find((h) => h.companyId === companyId);
  if (holding) {
    const totalCost = holding.avgCost * holding.shares + quote.executionPrice * quote.shares;
    holding.shares += quote.shares;
    holding.avgCost = round4(totalCost / Math.max(1, holding.shares));
  } else {
    state.player.stockHoldings.push({
      companyId,
      shares: quote.shares,
      avgCost: quote.executionPrice,
      acquiredDay: state.world.day,
      dividendsReceived: 0,
      accountId: state.player.brokerageAccountId!,
    });
  }

  const c = state.world.companies[companyId]!;
  applyOrderImpact(c, quote.shares, 'buy');
  setCounter(state, 'stock_trades', counter(state, 'stock_trades') + 1);
  setCounter(state, 'stock_buy_volume', round2(counter(state, 'stock_buy_volume') + quote.gross));
  maxCounter(state, 'largest_stock_order', quote.gross);
  const xp = grantXp(state, Math.max(2, Math.round(Math.sqrt(quote.gross) * 0.12)), `Bought ${quote.shares} ${quote.ticker}`).granted;
  pushDiagnostic(state, {
    system: 'stocks',
    level: 'info',
    message: `BUY ${quote.shares} ${quote.ticker} @ ${quote.executionPrice} (mid ${c.price}, impact ${(quote.impact * 100).toFixed(2)}%, fee ${quote.fee})`,
    data: { shares: quote.shares, price: quote.executionPrice, total: quote.total },
  });

  const updated = state.player.stockHoldings.find((h) => h.companyId === companyId)!;
  return {
    ok: true,
    quote,
    shares: quote.shares,
    cashDelta: -quote.total,
    holdingShares: updated.shares,
    avgCost: updated.avgCost,
    unrealisedPnl: round2((c.price - updated.avgCost) * updated.shares),
    realisedGain: 0,
    tax: 0,
    fee: quote.fee,
    xp,
    transactionId: move.transaction?.id,
    warnings: quote.warnings,
  };
}

export function sellShares(state: GameState, companyId: ID, shares: number): StockTradeResult {
  const quote = quoteShares(state, companyId, shares, 'sell');
  if (!quote) return failedTrade('unknown_company', `Unknown company "${companyId}".`);
  if (!quote.tradable) return failedTrade('not_tradable', quote.reason ?? 'Order cannot be executed.', quote);
  const holding = state.player.stockHoldings.find((h) => h.companyId === companyId);
  if (!holding) return failedTrade('no_holding', 'You do not hold those shares.', quote);

  const realisedGain = round2((quote.executionPrice - holding.avgCost) * quote.shares);
  const move = creditCash(state, quote.total, {
    kind: 'stock_sell',
    description: `Sold ${quote.shares.toLocaleString('en-US')} ${quote.ticker} @ ${formatMoney(quote.executionPrice)}`,
    dirty: false,
    accountId: state.player.brokerageAccountId ?? holding.accountId,
    counterparty: quote.name,
    meta: { fee: quote.fee, tax: quote.tax, gain: realisedGain },
  });
  if (!move.ok) return failedTrade('credit_failed', move.reason ?? 'Could not credit proceeds.', quote);

  holding.shares -= quote.shares;
  if (holding.shares <= 0) {
    state.player.stockHoldings = state.player.stockHoldings.filter((h) => h.companyId !== companyId);
  }
  const c = state.world.companies[companyId]!;
  applyOrderImpact(c, quote.shares, 'sell');

  if (quote.tax > 0) setCounter(state, 'tax_paid', round2(counter(state, 'tax_paid') + quote.tax));
  setCounter(state, 'stock_trades', counter(state, 'stock_trades') + 1);
  setCounter(state, 'capital_gains', round2(counter(state, 'capital_gains') + Math.max(0, realisedGain)));
  setCounter(state, 'capital_losses', round2(counter(state, 'capital_losses') + Math.max(0, -realisedGain)));
  const xp = Math.max(2, Math.round(Math.sqrt(quote.gross) * 0.12)) + (realisedGain > 0 ? Math.round(Math.sqrt(realisedGain) * 0.5) : 0);
  const xpGranted = grantXp(state, xp, `Sold ${quote.shares} ${quote.ticker} for ${realisedGain >= 0 ? 'a gain' : 'a loss'} of ${formatMoney(Math.abs(realisedGain))}`).granted;

  pushDiagnostic(state, {
    system: 'stocks',
    level: 'info',
    message: `SELL ${quote.shares} ${quote.ticker} @ ${quote.executionPrice}: proceeds ${quote.total}, gain ${realisedGain}, tax ${quote.tax}`,
    data: { shares: quote.shares, price: quote.executionPrice, gain: realisedGain, tax: quote.tax },
  });

  return {
    ok: true,
    quote,
    shares: quote.shares,
    cashDelta: quote.total,
    holdingShares: Math.max(0, holding.shares),
    avgCost: holding.avgCost,
    unrealisedPnl: round2((c.price - holding.avgCost) * Math.max(0, holding.shares)),
    realisedGain,
    tax: quote.tax,
    fee: quote.fee,
    xp: xpGranted,
    transactionId: move.transaction?.id,
    warnings: quote.warnings,
  };
}

function applyOrderImpact(c: CompanyState, shares: number, side: 'buy' | 'sell'): void {
  const dailyVolume = Math.max(1, Math.round(liquidityOf(c) * (0.4 + c.sentiment * 0.9)));
  const impact = clamp((shares / dailyVolume) * 0.06, 0, 0.05) * (side === 'buy' ? 1 : -1);
  c.price = roundPrice(c.price * (1 + impact));
  c.sentiment = round2(clamp(c.sentiment + impact * 0.4, 0.02, 0.99));
}

function failedTrade(code: string, reason: string, quote?: StockQuote): StockTradeResult {
  return {
    ok: false,
    code,
    reason,
    ...(quote ? { quote } : {}),
    shares: 0,
    cashDelta: 0,
    holdingShares: 0,
    avgCost: 0,
    unrealisedPnl: 0,
    realisedGain: 0,
    tax: 0,
    fee: 0,
    xp: 0,
    warnings: quote?.warnings ?? [],
  };
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface StockRow {
  companyId: ID;
  ticker: string;
  name: string;
  sector: string;
  country: string;
  status: CompanyState['status'];
  price: number;
  change1d: number;
  change7d: number;
  change30d: number;
  eps: number;
  pe: number | null;
  dividendYield: number;
  sentiment: number;
  fairValue: number;
  premiumVsFair: number;
  beta: number;
  marketCap: number;
  dailyVolume: number;
  fundamentalsQuality: number;
  heldShares: number;
  heldValue: number;
  heldCost: number;
  unrealisedPnl: number;
  unrealisedPnlPct: number;
  dividendsReceived: number;
  description: string;
  exposure: { category: string; weight: number }[];
}

function toRow(state: GameState, def: CompanyDef, c: CompanyState): StockRow {
  const holding = state.player.stockHoldings.find((h) => h.companyId === def.id);
  const at = (n: number) => (c.history.length > n ? c.history[c.history.length - 1 - n]! : c.history[0] ?? c.price);
  const change = (n: number) => (at(n) > 0 ? round2(c.price / at(n) - 1) : 0);
  const [peLow, peHigh] = B.stocks.peRange;
  const fairValue = c.eps > 0 ? round2(c.eps * (peLow + (peHigh - peLow) * Math.pow(c.sentiment, 1.35))) : round2(c.price * 0.6);
  const heldShares = holding?.shares ?? 0;
  const heldCost = round2((holding?.avgCost ?? 0) * heldShares);
  const heldValue = round2(c.price * heldShares);
  return {
    companyId: def.id,
    ticker: def.ticker,
    name: def.name,
    sector: def.sector,
    country: worldReg.locations.find((l) => l.countryId === def.countryId)?.countryName ?? def.countryId,
    status: c.status,
    price: c.price,
    change1d: change(1),
    change7d: change(7),
    change30d: change(30),
    eps: c.eps,
    pe: c.eps > 0 ? round2(c.price / c.eps) : null,
    dividendYield: c.price > 0 ? round2((c.dividendPerShareAnnual / c.price) * 1000) / 10 : 0,
    sentiment: c.sentiment,
    fairValue,
    premiumVsFair: fairValue > 0 ? round2(c.price / fairValue - 1) : 0,
    beta: def.beta,
    marketCap: round2(c.price * c.sharesOutstanding),
    dailyVolume: Math.round(liquidityOf(c) * (0.4 + c.sentiment * 0.9)),
    fundamentalsQuality: c.fundamentalsQuality,
    heldShares,
    heldValue,
    heldCost,
    unrealisedPnl: round2(heldValue - heldCost),
    unrealisedPnlPct: heldCost > 0 ? round2((heldValue / heldCost - 1) * 1000) / 10 : 0,
    dividendsReceived: holding?.dividendsReceived ?? 0,
    description: def.description,
    exposure: Object.entries(def.exposure)
      .filter(([, w]) => w !== undefined)
      .map(([category, weight]) => ({ category, weight: weight as number })),
  };
}

export interface StockMarketView {
  indexLevel: number;
  indexChange1d: number;
  indexChange30d: number;
  indexHistory: { day: number; level: number }[];
  cyclePhase: string;
  sentiment: number;
  interestRate: number;
  brokerageAccountId: ID | null;
  brokerageName: string | null;
  cash: number;
  portfolioValue: number;
  portfolioCost: number;
  unrealisedPnl: number;
  realisedGains: number;
  dividendsReceived: number;
  holdings: StockRow[];
  all: StockRow[];
  sectors: { sector: string; companies: number; change1d: number; marketCap: number; sentiment: number }[];
  movers: { up: StockRow[]; down: StockRow[] };
  events: { day: number; headline: string; body: string; importance: number }[];
}

export function stockMarketView(state: GameState, opts: { sector?: string; search?: string; limit?: number } = {}): StockMarketView {
  const world = state.world;
  const rows = COMPANIES.map((def) => ({ def, c: world.companies[def.id] }))
    .filter((x): x is { def: CompanyDef; c: CompanyState } => x.c !== undefined)
    .map((x) => toRow(state, x.def, x.c));

  const search = (opts.search ?? '').trim().toLowerCase();
  const filtered = rows
    .filter((r) => (opts.sector ? r.sector === opts.sector : true))
    .filter((r) => (search ? r.ticker.toLowerCase().includes(search) || r.name.toLowerCase().includes(search) || r.sector.toLowerCase().includes(search) : true))
    .filter((r) => r.status === 'active' || r.heldShares > 0);

  const holdings = rows.filter((r) => r.heldShares > 0);
  const historyStart = world.stockIndexHistory.length > 0 ? world.day - world.stockIndexHistory.length + 1 : world.day;
  const account = state.player.accounts.find((a) => a.id === state.player.brokerageAccountId);

  return {
    indexLevel: world.stockIndex,
    indexChange1d: world.stockIndexHistory.length > 1 ? round2(world.stockIndex / world.stockIndexHistory[world.stockIndexHistory.length - 2]! - 1) : 0,
    indexChange30d: world.stockIndexHistory.length > 30 ? round2(world.stockIndex / world.stockIndexHistory[world.stockIndexHistory.length - 31]! - 1) : 0,
    indexHistory: world.stockIndexHistory.map((level, i) => ({ day: historyStart + i, level })),
    cyclePhase: world.indicators.cyclePhaseLabel,
    sentiment: world.globalSentiment,
    interestRate: world.interestRate,
    brokerageAccountId: state.player.brokerageAccountId,
    brokerageName: account ? account.institution : null,
    cash: round2(spendable(state.player, world.day, false)),
    portfolioValue: round2(holdings.reduce((s, h) => s + h.heldValue, 0)),
    portfolioCost: round2(holdings.reduce((s, h) => s + h.heldCost, 0)),
    unrealisedPnl: round2(holdings.reduce((s, h) => s + h.unrealisedPnl, 0)),
    realisedGains: round2(counter(state, 'capital_gains') - counter(state, 'capital_losses')),
    dividendsReceived: round2(counter(state, 'dividend_income')),
    holdings,
    all: opts.limit ? filtered.slice(0, opts.limit) : filtered,
    sectors: SECTORS.map((sector) => {
      const list = rows.filter((r) => r.sector === sector && r.status === 'active');
      const cap = list.reduce((s, r) => s + r.marketCap, 0);
      return {
        sector,
        companies: list.length,
        change1d: cap > 0 ? round2(list.reduce((s, r) => s + r.change1d * r.marketCap, 0) / cap) : 0,
        marketCap: round2(cap),
        sentiment: list.length > 0 ? round2(list.reduce((s, r) => s + r.sentiment, 0) / list.length) : 0,
      };
    }).filter((s) => s.companies > 0),
    movers: {
      up: [...filtered].sort((a, b) => b.change1d - a.change1d).slice(0, 5),
      down: [...filtered].sort((a, b) => a.change1d - b.change1d).slice(0, 5),
    },
    events: world.news.filter((n) => n.tags.includes('stocks')).slice(0, 12).map((n) => ({ day: n.day, headline: n.headline, body: n.body, importance: n.importance })),
  };
}

export interface CompanyDetail extends StockRow {
  history: { day: number; price: number }[];
  epsHistory: number[];
  revenue: number;
  sharesOutstanding: number;
  lastDividendDay: number;
  nextDividendDay: number;
  pendingAction: string | null;
  acquiredBy: ID | null;
  acquiredByName: string | null;
  maxBuyShares: number;
  buyQuote: StockQuote | null;
  sellQuote: StockQuote | null;
  riskNotes: string[];
}

export function companyDetail(state: GameState, companyId: ID, shares = 100): CompanyDetail | null {
  const def = COMPANY_BY_ID[companyId];
  const c = state.world.companies[companyId];
  if (!def || !c) return null;
  const row = toRow(state, def, c);
  const historyStart = c.history.length > 0 ? state.world.day - c.history.length + 1 : state.world.day;
  const riskNotes: string[] = [];
  if (c.eps <= 0) riskNotes.push('Loss-making: earnings no longer support the price.');
  if (c.sentiment > B.stocks.bubbleThresholdSentiment) riskNotes.push(`Sentiment ${(c.sentiment * 100).toFixed(0)}/100 is in bubble territory.`);
  if (c.sentiment < B.stocks.crashThresholdSentiment * 1.6) riskNotes.push('Sentiment is fragile; a break lower would be sharp.');
  if (c.fundamentalsQuality < 0.3) riskNotes.push('Weak fundamentals — bankruptcy risk is elevated.');
  if (def.beta > 1.3) riskNotes.push(`High beta (${def.beta.toFixed(2)}): amplifies every move in the cycle.`);
  if (c.status !== 'active') riskNotes.push(`Status: ${c.status}.`);

  return {
    ...row,
    history: c.history.map((price, i) => ({ day: historyStart + i, price })),
    epsHistory: [],
    revenue: c.revenue,
    sharesOutstanding: c.sharesOutstanding,
    lastDividendDay: c.lastDividendDay,
    nextDividendDay: c.lastDividendDay + DIVIDEND_PERIOD_DAYS,
    pendingAction: c.pendingAction,
    acquiredBy: c.acquiredBy ?? null,
    acquiredByName: c.acquiredBy ? COMPANY_BY_ID[c.acquiredBy]?.name ?? c.acquiredBy : null,
    maxBuyShares: quoteShares(state, companyId, 1_000_000, 'buy')?.shares ?? 0,
    buyQuote: quoteShares(state, companyId, shares, 'buy'),
    sellQuote: quoteShares(state, companyId, shares, 'sell'),
    riskNotes,
  };
}

/** Portfolio concentration and beta — used by risk panels and by automation. */
export function portfolioRisk(state: GameState): {
  value: number;
  cashWeight: number;
  weightedBeta: number;
  concentration: { sector: string; weight: number }[];
  largestPosition: { ticker: string; weight: number } | null;
  diversification: number;
} {
  const holdings = state.player.stockHoldings.filter((h) => h.shares > 0);
  const worth = computeNetWorth(state);
  const value = worth.stocks;
  const cash = worth.cash;
  const total = value + cash;
  const bySector = new Map<string, number>();
  let weightedBeta = 0;
  let largest: { ticker: string; weight: number } | null = null;
  for (const h of holdings) {
    const def = COMPANY_BY_ID[h.companyId];
    const c = state.world.companies[h.companyId];
    if (!def || !c) continue;
    const v = h.shares * c.price;
    bySector.set(def.sector, (bySector.get(def.sector) ?? 0) + v);
    weightedBeta += def.beta * v;
    const weight = value > 0 ? v / value : 0;
    if (!largest || weight > largest.weight) largest = { ticker: def.ticker, weight: round2(weight) };
  }
  const concentration = [...bySector.entries()]
    .map(([sector, v]) => ({ sector, weight: value > 0 ? round2(v / value) : 0 }))
    .sort((a, b) => b.weight - a.weight);
  const hhi = concentration.reduce((s, c) => s + c.weight * c.weight, 0);
  return {
    value: round2(value),
    cashWeight: total > 0 ? round2(cash / total) : 1,
    weightedBeta: value > 0 ? round2(weightedBeta / value) : 0,
    concentration,
    largestPosition: largest,
    diversification: round2(clamp(1 - hhi, 0, 1)),
  };
}

export function newBrokerageAccountId(state: GameState, rng: Rng): ID {
  return newId(rng, `brk_${state.world.day}`);
}
