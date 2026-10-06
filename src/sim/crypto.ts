/**
 * Crypto — a distinct asset class with its own mechanics (spec §18).
 *
 * Nothing here reuses the commodity price model. Crypto prices are reflexive:
 * sentiment feeds price and price feeds sentiment, anchored loosely to a network
 * value derived from adoption and issuance scarcity. On top of that sit the
 * mechanics that only exist on-chain:
 *
 *   • **Liquidity and slippage** — orders are sized against venue depth, and
 *     large orders move the price against themselves.
 *   • **Halving epochs** — scheduled issuance cuts that change scarcity and
 *     miner economics on a known calendar.
 *   • **Staking** — locked yield with early-exit slashing.
 *   • **Mining** — rigs, hash rate vs network difficulty, energy cost, wear.
 *   • **Custody** — exchange balances can be frozen or lost when a venue fails;
 *     self-custody cannot, but you carry the key risk.
 *   • **Protocol and regulatory events** — exploits, forks, depegs, bans,
 *     approvals, and memecoin rugs.
 *   • **An on-chain ledger** — every movement is hashed into a chain the save
 *     validator can verify.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { CRYPTO_ASSETS, CRYPTO_BY_ID, CRYPTO_EXCHANGES, EXCHANGE_BY_ID, cryptoSeedFor, type CryptoExchangeDef } from '../engine/registry/actors';
import { canonicalJson, digestHex, shortChecksum } from '../lib/hash';
import { taxReduction } from './modifiers';
import { bumpCounter, counter, grantXp, maxCounter, playerModifiers, setCounter } from './progression';
import { addTraceHeat, changeReputation } from './reputation';
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
import type { CryptoAssetDef, CryptoAssetState, CryptoHolding, GameState, ID, MiningRig, OnChainEntry, WorldState } from './types';

const B = getBalance();
const HISTORY_DAYS = 180;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * Prices need *relative* precision, not fixed decimals: a memecoin trades at
 * 1e-8 while a store-of-value trades at 4e4. Fixed 6-decimal rounding collapses
 * the cheap end to zero, which then propagates NaN through every return
 * calculation. Ten significant digits covers the whole catalogue.
 */
function roundPrice(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  return Number(v.toPrecision(10));
}

/** Smallest price an asset may print before it is considered dead. */
function priceFloor(def: CryptoAssetDef): number {
  return Math.max(1e-12, def.genesisPrice * 1e-6);
}

/* ------------------------------------------------------------------ */
/* Initialisation                                                      */
/* ------------------------------------------------------------------ */

export function initCryptoAssets(world: WorldState, rng: Rng, day = 0): number {
  let created = 0;
  for (const def of CRYPTO_ASSETS) {
    if (world.cryptoAssets[def.id]) continue;
    const seed = cryptoSeedFor(def.id);
    const sentiment = round2(clamp(0.35 + def.networkEffect * 0.4 + rng.float(-0.08, 0.12), 0.03, 0.97));
    const epoch = def.halvingIntervalDays ? Math.floor(day / def.halvingIntervalDays) : 0;
    // The opening print is the model's own anchor plus seeded dispersion, so day
    // one starts fair instead of being dragged toward a different fair value.
    const price = roundPrice(anchorPrice(def, sentiment, def.circulatingSupply, epoch) * (def.kind === 'stablecoin' ? 1 : seed.float(0.94, 1.06)));
    const history: number[] = [];
    const startDay = Math.max(0, day - HISTORY_DAYS);
    for (let d = startDay; d < day; d += 1) {
      const n = new Rng(`crypto-hist:${def.id}:${d}`, 'crypto-history');
      const drift = def.kind === 'memecoin' ? n.gaussian(0, def.volatility * 0.9) : n.gaussian(0, def.volatility * 0.22);
      const level = price * (1 + drift * ((d - startDay) / HISTORY_DAYS - 0.5) * 2);
      history.push(roundPrice(Math.max(def.kind === 'stablecoin' ? 0.5 : price * 0.05, level)));
    }
    world.cryptoAssets[def.id] = {
      assetId: def.id,
      price,
      circulatingSupply: def.circulatingSupply,
      sentiment,
      networkDifficulty: round2(clamp(0.4 + def.networkEffect * 1.4 + rng.float(0, 0.3), 0.05, 8)),
      liquidity: round2(B.crypto.liquidityDepthBase * (0.35 + def.networkEffect * 2.4) * (def.kind === 'memecoin' ? 0.25 : 1)),
      history,
      historyStartDay: startDay,
      halvingEpoch: epoch,
      status: 'active',
      currentApy: round2(def.stakingApy > 0 ? def.stakingApy : rng.float(B.crypto.stakingApyRange[0], B.crypto.stakingApyRange[1]) * 0.4),
      lastEventDay: null,
      volatility: round2(def.volatility),
    };
    created += 1;
  }
  world.cryptoIndex = cryptoIndexLevel(world);
  world.cryptoIndexHistory = [world.cryptoIndex];
  return created;
}

/** Equal-weighted index of active assets, normalised to 1000 at genesis. */
export function cryptoIndexLevel(world: WorldState): number {
  const active = CRYPTO_ASSETS.filter((d) => d.kind !== 'stablecoin' && world.cryptoAssets[d.id]?.status === 'active');
  if (active.length === 0) return 1000;
  let sum = 0;
  for (const def of active) {
    const c = world.cryptoAssets[def.id]!;
    sum += c.price / Math.max(1e-9, def.genesisPrice);
  }
  return round2((sum / active.length) * 1000);
}

/* ------------------------------------------------------------------ */
/* Daily step                                                          */
/* ------------------------------------------------------------------ */

export interface CryptoEvent {
  assetId: ID;
  symbol: string;
  kind: 'halving' | 'exploit' | 'fork' | 'depeg' | 'rug' | 'regulatory_ban' | 'regulatory_approval' | 'exchange_failure' | 'liquidity_crisis' | 'adoption';
  headline: string;
  detail: string;
  importance: 1 | 2 | 3 | 4 | 5;
  priceImpact: number;
}

export interface CryptoStepResult {
  stepped: number;
  indexLevel: number;
  indexChange: number;
  events: CryptoEvent[];
  stakingRewards: number;
  minedValue: number;
  miningCost: number;
  biggestMovers: { assetId: ID; symbol: string; change: number; price: number }[];
}

/** Network value anchor: adoption × scarcity, per asset kind. */
/**
 * Long-run value anchor: adoption (network effect), issuance scarcity and the
 * halving schedule. Sentiment only tilts it slightly — otherwise price feeds
 * sentiment feeds anchor feeds price and the asset goes vertical forever.
 */
export function anchorPrice(
  def: CryptoAssetDef,
  sentiment: number,
  circulatingSupply: number,
  halvingEpoch: number,
  day = 0,
): number {
  if (def.kind === 'stablecoin') return def.peg?.value ?? 1;
  const scarcity = def.maxSupply ? clamp(def.maxSupply / Math.max(1, circulatingSupply), 1, 1.35) : 1;
  // Adoption grows on a slow S-curve: the long-run reason holding a network with
  // real usage is expected to beat holding cash, and the reason a dead network is
  // not. Capped so it can never become an exponential money tree.
  const adoptionCurve = clamp(1 + Math.log1p(Math.max(0, day) * 0.0016) * def.networkEffect * 0.55, 1, 3.2);
  const adoption = clamp(0.35 + def.networkEffect * 1.1, 0.1, 1.8) * adoptionCurve;
  const halvingBonus = 1 + halvingEpoch * 0.05;
  return Math.max(1e-12, def.genesisPrice * adoption * scarcity * halvingBonus * (0.88 + clamp(sentiment, 0.02, 0.99) * 0.24));
}

function networkAnchor(def: CryptoAssetDef, c: CryptoAssetState, day: number): number {
  return anchorPrice(def, c.sentiment, c.circulatingSupply, c.halvingEpoch, day);
}

export function stepCrypto(state: GameState, rng: Rng): CryptoStepResult {
  const world = state.world;
  const day = world.day;
  const events: CryptoEvent[] = [];
  const movers: CryptoStepResult['biggestMovers'] = [];
  let stepped = 0;

  // Market-wide crypto risk appetite: correlated across assets, unlike
  // commodities which are driven by local physical supply and demand.
  // Risk appetite has two parts, and separating them matters:
  //  • a *level* term (macro backdrop) scaled to a slow daily drift, and
  //  • a zero-mean *flow* shock (today's positioning/liquidations).
  // Adding them together unscaled turned a mildly cautious macro backdrop into a
  // permanent ~35% per-half-year bleed for every asset.
  const macroRiskAppetite = clamp((world.globalSentiment - 0.5) * 0.9, -0.45, 0.45) * 0.02;
  const flowShock = rng.gaussian(0, 0.045);
  const globalCryptoMood = macroRiskAppetite + flowShock;
  const rateDrag = -(world.interestRate - B.finance.baseInterestRateAnnual) * 0.35;

  for (const def of CRYPTO_ASSETS) {
    const c = world.cryptoAssets[def.id];
    if (!c || c.status === 'delisted' || c.status === 'rugged') {
      if (c) {
        c.history = c.history.length >= HISTORY_DAYS ? [...c.history.slice(1), c.price] : [...c.history, c.price];
      }
      continue;
    }
    const before = c.price;

    /* -------------------------------- halvings ------------------------------- */
    const interval = def.halvingIntervalDays ?? B.crypto.halvingIntervalDays;
    if (def.mineable && def.halvingIntervalDays && day > 0 && day % interval === 0) {
      c.halvingEpoch += 1;
      c.sentiment = round2(clamp(c.sentiment + rng.float(0.06, 0.18), 0.03, 0.99));
      events.push({
        assetId: def.id,
        symbol: def.symbol,
        kind: 'halving',
        headline: `${def.symbol} block reward halves (epoch ${c.halvingEpoch})`,
        detail: `Issuance drops to ${blockReward(def, c).toFixed(4)} ${def.symbol} per block. Miners with high energy costs become unprofitable and hash rate usually falls before difficulty adjusts.`,
        importance: 4,
        priceImpact: rng.float(0.02, 0.09),
      });
    }

    /* ------------------------------ issuance -------------------------------- */
    const issuancePerDay = def.issuanceRate > 0 ? (c.circulatingSupply * def.issuanceRate) / 365 : 0;
    if (issuancePerDay > 0) {
      c.circulatingSupply = round2(c.circulatingSupply + issuancePerDay);
      if (def.maxSupply) c.circulatingSupply = Math.min(c.circulatingSupply, def.maxSupply);
    }

    /* ------------------------------ difficulty ------------------------------ */
    if (def.mineable) {
      const playerHash = state.player.miningRigs.filter((r) => r.assetId === def.id && r.active).reduce((s, r) => s + r.hashRate, 0);
      const pressure = 1 + B.crypto.networkDifficultyDriftPerDay * (1 + playerHash / 2000) * (0.5 + c.sentiment);
      c.networkDifficulty = round2(clamp(c.networkDifficulty * pressure, 0.02, 25));
    }

    /* -------------------------------- pricing ------------------------------- */
    const anchor = networkAnchor(def, c, day);
    const reversion = def.kind === 'stablecoin' ? 0.55 : Math.min(0.035, B.crypto.sentimentReversion);
    const pullToAnchor = reversion * (anchor / Math.max(1e-9, before) - 1);

    // Reflexivity: yesterday's return pushes sentiment, sentiment pushes price.
    const prevClose = c.history.length > 1 ? c.history[c.history.length - 2]! : 0;
    const prevReturn = Number.isFinite(prevClose) && prevClose > 0 && Number.isFinite(before) && before > 0 ? clamp(before / prevClose - 1, -0.9, 3) : 0;
    c.sentiment = round2(
      clamp(
        c.sentiment +
          clamp(prevReturn * 0.35, -0.03, 0.03) +
          globalCryptoMood * 0.05 +
          rng.gaussian(0, 0.012 + def.volatility * 0.02) -
          (c.sentiment - B.crypto.sentimentMean) * 0.02,
        0.02,
        0.99,
      ),
    );

    // Daily sigma: majors ~2-4%, hot chains ~5%, memecoins ~12-15%.
    const vol = def.volatility * B.crypto.volatilityScale * (def.kind === 'memecoin' ? 1.7 : 1) * (0.6 + c.sentiment * 0.8) * 0.026;
    let ret =
      pullToAnchor +
      prevReturn * (def.kind === 'memecoin' ? 0.24 : 0.07) + // momentum: strong in memes, mild elsewhere
      globalCryptoMood * (0.35 + def.networkEffect * 0.5) +
      rateDrag * 0.02 * (def.kind === 'store_of_value' ? 1.2 : 1) +
      rng.gaussian(0, vol);

    // Mania and panic are bounded, and panic is paired with value buying: an
    // unbounded daily penalty while sentiment is low bleeds an asset to zero.
    if (c.sentiment > 0.85) ret += clamp((c.sentiment - 0.85) * 0.35, 0, 0.05);
    if (c.sentiment < 0.15) {
      ret -= clamp((0.15 - c.sentiment) * 0.5, 0, 0.035);
      if (c.price < anchor) ret += clamp((anchor / c.price - 1) * 0.035, 0, 0.05);
    }

    // Defensive repair: a non-finite or zero print would poison every later
    // return calculation, so re-anchor instead of propagating it.
    const floor = priceFloor(def);
    const nextPrice = Number.isFinite(before) && before > 0 ? before * (1 + clamp(ret, -0.55, 0.85)) : anchor;
    c.price = roundPrice(Math.max(def.kind === 'stablecoin' ? 0.01 : floor, nextPrice));
    c.volatility = round2(clamp(c.volatility * 0.94 + Math.abs(ret) * 0.9, 0.01, 4));

    /* ------------------------------ liquidity ------------------------------- */
    c.liquidity = round2(
      clamp(c.liquidity * (1 + (c.sentiment - 0.5) * 0.012) * (c.status === 'active' ? 1 : 0.6), B.crypto.liquidityDepthBase * 0.02, B.crypto.liquidityDepthBase * 400),
    );

    /* --------------------------- stablecoin pegs ---------------------------- */
    if (def.kind === 'stablecoin') {
      const peg = def.peg?.value ?? 1;
      if (c.status === 'active' && c.price < peg * B.crypto.depegThreshold && rng.chance(0.35)) {
        c.status = 'depegged';
        c.price = roundPrice(c.price * rng.float(0.4, 0.85));
        c.sentiment = round2(clamp(c.sentiment * 0.3, 0.02, 0.99));
        events.push({
          assetId: def.id,
          symbol: def.symbol,
          kind: 'depeg',
          headline: `${def.symbol} breaks its peg`,
          detail: `${def.name} trades at ${formatMoney(c.price)} against a ${formatMoney(peg)} peg. Redemptions have been paused; the reserve attestation is being questioned.`,
          importance: 5,
          priceImpact: c.price / before - 1,
        });
      } else if (c.status === 'depegged' && rng.chance(0.06)) {
        c.status = 'active';
        c.price = roundPrice(peg * rng.float(0.9, 0.99));
        events.push({
          assetId: def.id,
          symbol: def.symbol,
          kind: 'adoption',
          headline: `${def.symbol} re-pegs`,
          detail: 'Reserves were verified and redemptions reopened.',
          importance: 4,
          priceImpact: c.price / before - 1,
        });
      }
    }

    // Reflexive bubbles must be able to pop, otherwise hot sentiment compounds.
    if (c.sentiment > 0.85 && rng.chance(0.05 + (c.sentiment - 0.85) * 0.9)) {
      const severity = rng.float(0.18, 0.46);
      c.price = roundPrice(Math.max(priceFloor(def), c.price * (1 - severity)));
      c.sentiment = round2(clamp(c.sentiment - rng.float(0.22, 0.45), 0.02, 0.99));
      events.push({
        assetId: def.id,
        symbol: def.symbol,
        kind: 'liquidity_crisis',
        headline: `${def.symbol} mania breaks — ${(severity * 100).toFixed(0)}% drawdown`,
        detail: `Leveraged longs were liquidated into thin books. ${def.name} had run up on sentiment alone; the anchor value is far below the last trade.`,
        importance: 5,
        priceImpact: -severity,
      });
    }

    /* --------------------------- protocol events ---------------------------- */
    if (rng.chance(B.crypto.protocolEventChancePerDay * (0.4 + def.protocolRisk * 2.2))) {
      const exploit = rng.chance(0.55);
      const severity = rng.float(0.08, 0.42) * (0.5 + def.protocolRisk) * state.config.difficultyModifiers.eventSeverityMultiplier;
      c.price = roundPrice(Math.max(priceFloor(def), c.price * (1 - severity)));
      c.sentiment = round2(clamp(c.sentiment - rng.float(0.1, 0.3), 0.02, 0.99));
      c.liquidity = round2(c.liquidity * (1 - severity * 0.5));
      if (exploit && severity > 0.3 && rng.chance(0.4)) c.status = 'forked';
      c.lastEventDay = day;
      events.push({
        assetId: def.id,
        symbol: def.symbol,
        kind: exploit ? 'exploit' : 'fork',
        headline: exploit ? `${def.symbol} protocol exploited for an estimated ${formatMoney(c.liquidity * severity * 8)}` : `${def.symbol} community splits over a contentious upgrade`,
        detail: exploit
          ? `A re-entrancy bug in ${def.name}'s bridge drained funds. The chain was paused, and ${c.status === 'forked' ? 'two incompatible histories now compete' : 'the team has promised restitution'}.`
          : `Validators are split over the upgrade. Expect volatility and thin liquidity while the fork resolves.`,
        importance: severity > 0.3 ? 5 : 4,
        priceImpact: -severity,
      });
      // Stakers take the hit directly.
      for (const h of state.player.cryptoHoldings.filter((h) => h.assetId === def.id && h.staked > 0)) {
        const loss = round2(h.staked * severity * 0.5);
        h.staked = round6(Math.max(0, h.staked - loss));
        h.rewardsAccrued = round6(Math.max(0, h.rewardsAccrued - loss * 0.2));
        if (loss > 0) {
          pushNotification(state, {
            kind: 'danger',
            title: `Stake slashed on ${def.symbol}`,
            body: `The protocol event cost you ${loss.toFixed(4)} ${def.symbol} of bonded stake.`,
            link: '/game/crypto',
          });
        }
      }
    }

    /* -------------------------- regulatory shocks --------------------------- */
    if (rng.chance(B.crypto.regulatoryShockChancePerDay * (0.3 + def.regulatoryRisk * 2.4))) {
      const approval = rng.chance(0.42);
      const magnitude = rng.float(0.06, 0.28) * state.config.difficultyModifiers.eventSeverityMultiplier;
      if (approval) {
        c.price = roundPrice(c.price * (1 + magnitude));
        c.sentiment = round2(clamp(c.sentiment + magnitude, 0.02, 0.99));
        c.liquidity = round2(c.liquidity * (1 + magnitude * 1.6));
      } else {
        c.price = roundPrice(c.price * (1 - magnitude));
        c.sentiment = round2(clamp(c.sentiment - magnitude * 1.2, 0.02, 0.99));
        c.liquidity = round2(c.liquidity * (1 - magnitude));
      }
      c.lastEventDay = day;
      events.push({
        assetId: def.id,
        symbol: def.symbol,
        kind: approval ? 'regulatory_approval' : 'regulatory_ban',
        headline: approval ? `Regulators clear ${def.symbol} products` : `New restrictions hit ${def.symbol}`,
        detail: approval
          ? `Custodial access to ${def.name} was approved in three major jurisdictions. Institutional flow follows listing.`
          : `A major jurisdiction restricted ${def.name} custody and on-ramps. Liquidity is thinning and the tax treatment is now hostile.`,
        importance: 4,
        priceImpact: approval ? magnitude : -magnitude,
      });
    }

    /* ------------------------------ memecoin rugs --------------------------- */
    if (def.kind === 'memecoin' && c.status === 'active' && rng.chance(B.crypto.memecoinRugChancePerDay * (0.2 + c.sentiment * 1.4) * (1 - def.networkEffect))) {
      c.status = 'rugged';
      const collapse = rng.float(0.86, 0.995);
      c.price = roundPrice(Math.max(1e-14, c.price * (1 - collapse)));
      c.liquidity = round2(c.liquidity * 0.04);
      c.sentiment = 0.02;
      events.push({
        assetId: def.id,
        symbol: def.symbol,
        kind: 'rug',
        headline: `${def.symbol} liquidity pulled — token collapses ${(collapse * 100).toFixed(0)}%`,
        detail: `The deployer of ${def.name} withdrew the pool. Holders are left with a token nobody will buy.`,
        importance: 5,
        priceImpact: -collapse,
      });
      for (const h of state.player.cryptoHoldings.filter((h) => h.assetId === def.id)) {
        if (h.amount > 0) {
          pushNotification(state, {
            kind: 'danger',
            title: `${def.symbol} was rugged`,
            body: `Your ${h.amount.toFixed(4)} ${def.symbol} are effectively worthless. Cost basis ${formatMoney(h.avgCost * h.amount)}.`,
            link: '/game/crypto',
          });
          setCounter(state, 'rug_losses', round2(counter(state, 'rug_losses') + h.avgCost * h.amount));
        }
      }
    }

    /* -------------------------------- history ------------------------------- */
    c.history = c.history.length >= HISTORY_DAYS ? [...c.history.slice(1), c.price] : [...c.history, c.price];
    if (c.history.length >= HISTORY_DAYS) c.historyStartDay = day - HISTORY_DAYS + 1;
    stepped += 1;

    const change = before > 0 ? c.price / before - 1 : 0;
    if (Math.abs(change) > 0.01) movers.push({ assetId: def.id, symbol: def.symbol, change: round2(change), price: c.price });
  }

  /* ------------------------------- staking -------------------------------- */
  const stakingRewards = accrueStakingRewards(state, day);

  /* -------------------------------- mining -------------------------------- */
  const mining = miningTick(state, rng, day);

  /* --------------------------- exchange failures -------------------------- */
  for (const event of exchangeFailureTick(state, rng)) events.push(event);

  const previousIndex = world.cryptoIndex;
  world.cryptoIndex = cryptoIndexLevel(world);
  world.cryptoIndexHistory = world.cryptoIndexHistory.length >= HISTORY_DAYS ? [...world.cryptoIndexHistory.slice(1), world.cryptoIndex] : [...world.cryptoIndexHistory, world.cryptoIndex];

  movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  for (const event of events) {
    pushNews(world, {
      scope: 'global',
      category: event.kind.startsWith('regulatory') ? 'politics' : 'technology',
      headline: event.headline,
      body: event.detail,
      locationIds: [],
      tags: ['crypto', event.symbol, event.kind],
      importance: event.importance,
    });
  }

  return {
    stepped,
    indexLevel: world.cryptoIndex,
    indexChange: previousIndex > 0 ? round2(world.cryptoIndex / previousIndex - 1) : 0,
    events,
    stakingRewards,
    minedValue: mining.value,
    miningCost: mining.cost,
    biggestMovers: movers.slice(0, 10),
  };
}

export function blockReward(def: CryptoAssetDef, c: CryptoAssetState): number {
  const genesis = def.genesisBlockReward ?? 0;
  if (genesis <= 0) return 0;
  return genesis / Math.pow(2, c.halvingEpoch);
}

/* ------------------------------------------------------------------ */
/* Wallets, exchanges and the on-chain ledger                          */
/* ------------------------------------------------------------------ */

export function walletAddressFor(state: GameState, rng: Rng): string {
  const existing = state.player.underground.walletAddress;
  if (existing) return existing;
  const address = `0x${digestHex(`${state.config.worldSeed}:${state.player.id}:${rng.int(0, 1e9)}`).slice(0, 40)}`;
  state.player.underground.walletAddress = address;
  return address;
}

export function appendOnChain(state: GameState, entry: Omit<OnChainEntry, 'hash' | 'prevHash'>): OnChainEntry {
  const ledger = state.player.underground.onChain;
  const prevHash = ledger.length > 0 ? ledger[ledger.length - 1]!.hash : 'genesis';
  const hash = digestHex(canonicalJson({ prevHash, ...entry }));
  const record: OnChainEntry = { ...entry, prevHash, hash };
  ledger.push(record);
  if (ledger.length > 400) ledger.splice(0, ledger.length - 400);
  return record;
}

/** Verify the on-chain ledger; returns the index of the first broken link. */
export function verifyOnChain(state: GameState): number {
  const ledger = state.player.underground.onChain;
  let prev = 'genesis';
  for (let i = 0; i < ledger.length; i += 1) {
    const entry = ledger[i]!;
    if (entry.prevHash !== prev) return i;
    const { hash, prevHash, ...rest } = entry;
    void hash;
    if (digestHex(canonicalJson({ prevHash, ...rest })) !== entry.hash) return i;
    prev = entry.hash;
  }
  return -1;
}

export function openExchangeAccount(state: GameState, exchangeId: ID): { ok: boolean; reason?: string } {
  const ex = EXCHANGE_BY_ID[exchangeId];
  if (!ex) return { ok: false, reason: 'Unknown exchange.' };
  if (ex.requiresUnderground && !state.player.underground.accessUnlocked) {
    return { ok: false, reason: `${ex.name} is a darknet venue — you need darknet access.` };
  }
  if (state.player.underground.exchangeAccounts.some((a) => a.exchangeId === exchangeId)) {
    return { ok: false, reason: 'You already have an account there.' };
  }
  state.player.underground.exchangeAccounts.push({
    exchangeId,
    openedDay: state.world.day,
    balance: 0,
    frozenUntilDay: null,
    kycLevel: ex.kycLevel,
  });
  walletAddressFor(state, new Rng(`${state.config.worldSeed}:wallet`));
  pushNotification(state, {
    kind: 'success',
    title: `Account opened: ${ex.name}`,
    body: `Taker fee ${(ex.feeFraction * 100).toFixed(2)}%, withdrawal fee ${formatMoney(ex.withdrawalFeeFlat)}, ${ex.withdrawalDelayDays}-day holds${ex.kycLevel > 0 ? `, KYC level ${ex.kycLevel} on file` : ', no identity checks'}.`,
    link: '/game/crypto',
  });
  if (ex.kycLevel >= 2) changeReputation(state, 'legal', 0.6, `Completed KYC at ${ex.name}`);
  return { ok: true };
}

export function listExchanges(state: GameState): (CryptoExchangeDef & { hasAccount: boolean; balance: number; frozenUntilDay: number | null; accessible: boolean; accessReason: string | null })[] {
  return CRYPTO_EXCHANGES.map((ex) => {
    const account = state.player.underground.exchangeAccounts.find((a) => a.exchangeId === ex.id);
    const accessible = !ex.requiresUnderground || state.player.underground.accessUnlocked;
    return {
      ...ex,
      hasAccount: account !== undefined,
      balance: account?.balance ?? 0,
      frozenUntilDay: account?.frozenUntilDay ?? null,
      accessible,
      accessReason: accessible ? null : 'Requires darknet access.',
    };
  });
}

/* ------------------------------------------------------------------ */
/* Quoting                                                             */
/* ------------------------------------------------------------------ */

export interface CryptoQuote {
  assetId: ID;
  symbol: string;
  name: string;
  kind: CryptoAssetDef['kind'];
  exchangeId: ID;
  exchangeName: string;
  side: 'buy' | 'sell';
  requestedAmount: number;
  amount: number;
  marketPrice: number;
  executionPrice: number;
  averagePrice: number;
  slippage: number;
  notional: number;
  fee: number;
  tax: number;
  total: number;
  liquidity: number;
  maxNotionalToday: number;
  custody: 'wallet' | 'exchange';
  warnings: string[];
  tradable: boolean;
  reason?: string;
  gasFee: number;
}

function venueLiquidity(c: CryptoAssetState, ex: CryptoExchangeDef): number {
  return Math.max(1000, c.liquidity * ex.liquidityMultiplier);
}

/**
 * Slippage-aware quote.
 *
 * Depth is denominated in currency, so the same order slips more on a thin
 * venue. Average execution price integrates the slippage curve across the order
 * rather than applying a single end-of-book price.
 */
export function quoteCrypto(
  state: GameState,
  assetId: ID,
  amount: number,
  side: 'buy' | 'sell',
  opts: { exchangeId?: ID; custody?: 'wallet' | 'exchange' } = {},
): CryptoQuote | null {
  const def = CRYPTO_BY_ID[assetId];
  const c = state.world.cryptoAssets[assetId];
  if (!def || !c) return null;

  const exchanges: CryptoExchangeDef[] = opts.exchangeId
    ? [EXCHANGE_BY_ID[opts.exchangeId]].filter((ex): ex is CryptoExchangeDef => ex !== undefined)
    : CRYPTO_EXCHANGES;
  const usable = exchanges.filter(
    (ex) => ex.listsKinds.includes(def.kind) && (!ex.requiresUnderground || state.player.underground.accessUnlocked),
  );
  if (usable.length === 0) return null;
  // Best venue = deepest effective liquidity for this asset, unless specified.
  const ex = usable.sort((a, b) => venueLiquidity(c, b) - venueLiquidity(c, a))[0]!;

  const account = state.player.underground.exchangeAccounts.find((a) => a.exchangeId === ex.id);
  const warnings: string[] = [];
  if (!account) warnings.push(`No account at ${ex.name} — one will be opened on execution.`);
  const frozenUntil = account?.frozenUntilDay ?? null;
  if (frozenUntil !== null && frozenUntil > state.world.day) {
    warnings.push(`${ex.name} has frozen withdrawals until day ${frozenUntil}.`);
  }
  if (c.status !== 'active') warnings.push(`${def.symbol} status: ${c.status}. Liquidity is impaired.`);

  const liquidity = venueLiquidity(c, ex);
  const maxNotional = round2(liquidity * 0.25);
  const requested = Math.max(0, amount);
  const requestedNotional = requested * c.price;
  let notional = Math.min(requestedNotional, maxNotional);
  let qty = c.price > 0 ? notional / c.price : 0;
  if (requestedNotional > maxNotional) {
    warnings.push(`Capped to ${formatMoney(maxNotional)} (25% of ${ex.name}'s ${formatMoney(liquidity)} depth) — larger orders would move the book against you.`);
  }

  const holding = state.player.cryptoHoldings.find((h) => h.assetId === assetId);
  const custody = opts.custody ?? holding?.custody ?? 'wallet';
  const availableToSell = holding ? (custody === 'exchange' ? holding.amount : holding.amount - holding.staked) : 0;
  if (side === 'sell' && qty > availableToSell) {
    qty = Math.max(0, availableToSell);
    notional = round2(qty * c.price);
    if (qty <= 0) warnings.push('Nothing available to sell (staked amounts are locked).');
    else warnings.push(`Only ${qty.toFixed(6)} ${def.symbol} is unlocked and available.`);
  }

  // Integrate slippage across the order: each incremental slice trades worse.
  const slippage = clamp((notional / Math.max(1, liquidity)) * B.crypto.slippagePerDepthFraction, 0, 0.6);
  const effectiveSlippage = slippage / 2; // average across the book, not the final tick
  const executionPrice = roundPrice(Math.max(priceFloor(def), side === 'buy' ? c.price * (1 + effectiveSlippage) : c.price * (1 - effectiveSlippage)));
  const averagePrice = roundPrice(Math.max(priceFloor(def), side === 'buy' ? c.price * (1 + effectiveSlippage * 0.6) : c.price * (1 - effectiveSlippage * 0.6)));
  const gross = round2(averagePrice * qty);
  const fee = round2(Math.max(ex.kind === 'dex' ? 0 : B.crypto.exchangeFeeMin, gross * ex.feeFraction));
  const gasFee = round2(ex.kind === 'dex' ? Math.max(0.4, 2.2 * (0.5 + c.sentiment)) : 0);

  let tax = 0;
  if (side === 'sell' && holding) {
    const gain = Math.max(0, (averagePrice - holding.avgCost) * qty);
    const mods = playerModifiers(state);
    tax = round2(gain * Math.max(0, B.finance.tax.capitalGainsRate * (1 - taxReduction(mods))));
  }

  const total = side === 'buy' ? round2(gross + fee + gasFee) : round2(gross - fee - tax - gasFee);
  const cash = spendable(state.player, state.world.day, true);
  if (side === 'buy' && total > cash) {
    const affordableNotional = Math.max(0, cash - fee - gasFee);
    const affordableQty = averagePrice > 0 ? affordableNotional / averagePrice : 0;
    if (affordableQty < qty) {
      warnings.push(`Cash-limited: ${formatMoney(cash)} available. Reduce the order to about ${affordableQty.toFixed(6)} ${def.symbol}.`);
    }
  }

  const tradable =
    qty > 0 &&
    c.status !== 'rugged' &&
    c.status !== 'delisted' &&
    (side === 'sell' || total <= cash) &&
    !(frozenUntil !== null && frozenUntil > state.world.day);

  /*
   * Name the constraint that actually binds.
   *
   * Falling back to `warnings[0]` reported the *first* thing worth mentioning,
   * which was often irrelevant — a player holding none of an asset was told "no
   * account at this venue, one will be opened on execution" while the real answer
   * was that there was nothing to sell.
   */
  let blockReason: string | null = null;
  if (!tradable) {
    if (c.status === 'rugged' || c.status === 'delisted') blockReason = `${def.symbol} is ${c.status}.`;
    else if (qty <= 0 && side === 'sell') {
      blockReason = holding
        ? `All of your ${def.symbol} is staked or locked in the other custody — unstake or transfer it first.`
        : `You hold no ${def.symbol}.`;
    } else if (qty <= 0) blockReason = `Nothing to buy: check the order size and ${def.symbol}'s status.`;
    else if (side === 'buy' && total > cash) blockReason = `You need ${formatMoney(total)} but have ${formatMoney(cash)} of spendable cash.`;
    else if (frozenUntil !== null && frozenUntil > state.world.day) blockReason = `${ex.name} has frozen withdrawals until day ${frozenUntil}.`;
    else blockReason = warnings[warnings.length - 1] ?? 'Not tradable right now.';
  }

  return {
    assetId,
    symbol: def.symbol,
    name: def.name,
    kind: def.kind,
    exchangeId: ex.id,
    exchangeName: ex.name,
    side,
    requestedAmount: requested,
    amount: round6(qty),
    marketPrice: c.price,
    executionPrice,
    averagePrice,
    slippage: round2(slippage * 10000) / 10000,
    notional: round2(notional),
    fee,
    tax,
    total,
    liquidity: round2(liquidity),
    maxNotionalToday: maxNotional,
    custody,
    warnings,
    tradable,
    ...(tradable || blockReason === null ? {} : { reason: blockReason }),
    gasFee,
  };
}

/* ------------------------------------------------------------------ */
/* Trading                                                             */
/* ------------------------------------------------------------------ */

export interface CryptoTradeResult {
  ok: boolean;
  code?: string;
  reason?: string;
  quote?: CryptoQuote;
  amount: number;
  cashDelta: number;
  holdings: number;
  avgCost: number;
  realisedGain: number;
  fee: number;
  tax: number;
  gasFee: number;
  slippage: number;
  txHash: ID;
  xp: number;
  warnings: string[];
}

function failedCrypto(code: string, reason: string, quote?: CryptoQuote): CryptoTradeResult {
  return { ok: false, code, reason, ...(quote ? { quote } : {}), amount: 0, cashDelta: 0, holdings: 0, avgCost: 0, realisedGain: 0, fee: 0, tax: 0, gasFee: 0, slippage: 0, txHash: '', xp: 0, warnings: quote?.warnings ?? [] };
}

export function buyCrypto(state: GameState, rng: Rng, assetId: ID, amount: number, opts: { exchangeId?: ID; custody?: 'wallet' | 'exchange' } = {}): CryptoTradeResult {
  const def = CRYPTO_BY_ID[assetId];
  const c = state.world.cryptoAssets[assetId];
  if (!def || !c) return failedCrypto('unknown_asset', `Unknown asset "${assetId}".`);
  const quote = quoteCrypto(state, assetId, amount, 'buy', opts);
  if (!quote) return failedCrypto('no_venue', `No accessible venue lists ${def.symbol}.`);
  if (!quote.tradable) return failedCrypto('not_tradable', quote.reason ?? 'Order cannot be executed.', quote);
  if (quote.amount <= 0) return failedCrypto('zero_size', 'Order size rounds to zero.', quote);

  if (!state.player.underground.exchangeAccounts.some((a) => a.exchangeId === quote.exchangeId)) {
    const opened = openExchangeAccount(state, quote.exchangeId);
    if (!opened.ok) return failedCrypto('exchange_unavailable', opened.reason ?? 'Cannot open an account at that venue.', quote);
  }

  const move = debitCash(state, quote.total, {
    kind: 'crypto_buy',
    description: `Bought ${quote.amount.toFixed(6)} ${def.symbol} @ ${formatMoney(quote.averagePrice)} on ${quote.exchangeName}`,
    allowDirty: quote.exchangeId === 'sprawl_market',
    counterparty: quote.exchangeName,
    meta: { assetId, slippage: quote.slippage, fee: quote.fee, gas: quote.gasFee, custody: quote.custody },
  });
  if (!move.ok) return failedCrypto('payment_failed', move.reason ?? 'Insufficient funds.', quote);

  const address = walletAddressFor(state, rng);
  const holding = state.player.cryptoHoldings.find((h) => h.assetId === assetId && h.custody === quote.custody);
  if (holding) {
    const cost = holding.avgCost * holding.amount + quote.averagePrice * quote.amount;
    holding.amount = round6(holding.amount + quote.amount);
    holding.avgCost = round6(cost / Math.max(1e-9, holding.amount));
  } else {
    state.player.cryptoHoldings.push({
      assetId,
      amount: quote.amount,
      avgCost: quote.averagePrice,
      acquiredDay: state.world.day,
      custody: quote.custody,
      walletAddress: address,
      staked: 0,
      stakedUntilDay: null,
      stakingApy: 0,
      rewardsAccrued: 0,
      miningRigId: null,
    });
  }

  applyBookImpact(c, quote, state);
  const tx = appendOnChain(state, {
    day: state.world.day,
    assetId,
    side: 'buy',
    amount: quote.amount,
    price: quote.averagePrice,
    address,
    counterparty: quote.exchangeName,
    note: `Buy ${quote.amount.toFixed(6)} ${def.symbol}`,
  });

  setCounter(state, 'crypto_trades', counter(state, 'crypto_trades') + 1);
  setCounter(state, 'crypto_buy_volume', round2(counter(state, 'crypto_buy_volume') + quote.notional));
  maxCounter(state, 'largest_crypto_order', quote.notional);
  const xp = grantXp(state, Math.max(2, Math.round(Math.sqrt(quote.notional) * 0.14)), `Bought ${quote.amount.toFixed(4)} ${def.symbol}`).granted;
  if (quote.exchangeId === 'sprawl_market') addTraceHeat(state, 0.8, 'Darknet venue trade');

  pushDiagnostic(state, {
    system: 'crypto',
    level: 'info',
    message: `BUY ${quote.amount.toFixed(6)} ${def.symbol} @ ${quote.averagePrice} on ${quote.exchangeName} (mid ${c.price}, slippage ${(quote.slippage * 100).toFixed(2)}%, fee ${quote.fee}) tx ${tx.hash.slice(0, 10)}`,
    data: { amount: quote.amount, price: quote.averagePrice, total: quote.total, slippage: quote.slippage },
  });

  const updated = state.player.cryptoHoldings.find((h) => h.assetId === assetId)!;
  return {
    ok: true,
    quote,
    amount: quote.amount,
    cashDelta: -quote.total,
    holdings: updated.amount,
    avgCost: updated.avgCost,
    realisedGain: 0,
    fee: quote.fee,
    tax: 0,
    gasFee: quote.gasFee,
    slippage: quote.slippage,
    txHash: tx.hash,
    xp,
    warnings: quote.warnings,
  };
}

export function sellCrypto(state: GameState, rng: Rng, assetId: ID, amount: number, opts: { exchangeId?: ID; custody?: 'wallet' | 'exchange' } = {}): CryptoTradeResult {
  const def = CRYPTO_BY_ID[assetId];
  const c = state.world.cryptoAssets[assetId];
  if (!def || !c) return failedCrypto('unknown_asset', `Unknown asset "${assetId}".`);
  const quote = quoteCrypto(state, assetId, amount, 'sell', opts);
  if (!quote) return failedCrypto('no_venue', `No accessible venue lists ${def.symbol}.`);
  if (!quote.tradable) return failedCrypto('not_tradable', quote.reason ?? 'Order cannot be executed.', quote);

  const holding = state.player.cryptoHoldings.find((h) => h.assetId === assetId);
  if (!holding) return failedCrypto('no_holding', `You hold no ${def.symbol}.`, quote);

  const realisedGain = round2((quote.averagePrice - holding.avgCost) * quote.amount);
  const address = walletAddressFor(state, rng);
  const move = creditCash(state, quote.total, {
    kind: 'crypto_sell',
    description: `Sold ${quote.amount.toFixed(6)} ${def.symbol} @ ${formatMoney(quote.averagePrice)} on ${quote.exchangeName}`,
    dirty: def.kind === 'privacy' || quote.exchangeId === 'sprawl_market',
    counterparty: quote.exchangeName,
    meta: { assetId, slippage: quote.slippage, fee: quote.fee, tax: quote.tax, gain: realisedGain },
  });
  if (!move.ok) return failedCrypto('credit_failed', move.reason ?? 'Could not credit proceeds.', quote);

  holding.amount = round6(Math.max(0, holding.amount - quote.amount));
  if (holding.amount <= 1e-9) {
    state.player.cryptoHoldings = state.player.cryptoHoldings.filter((h) => h.assetId !== assetId || h.custody !== quote.custody);
  }

  applyBookImpact(c, quote, state);
  const tx = appendOnChain(state, {
    day: state.world.day,
    assetId,
    side: 'sell',
    amount: quote.amount,
    price: quote.averagePrice,
    address,
    counterparty: quote.exchangeName,
    note: `Sell ${quote.amount.toFixed(6)} ${def.symbol}`,
  });

  if (quote.tax > 0) setCounter(state, 'tax_paid', round2(counter(state, 'tax_paid') + quote.tax));
  setCounter(state, 'crypto_trades', counter(state, 'crypto_trades') + 1);
  setCounter(state, 'crypto_gains', round2(counter(state, 'crypto_gains') + Math.max(0, realisedGain)));
  setCounter(state, 'crypto_losses', round2(counter(state, 'crypto_losses') + Math.max(0, -realisedGain)));
  const xp = Math.max(2, Math.round(Math.sqrt(quote.notional) * 0.14)) + (realisedGain > 0 ? Math.round(Math.sqrt(realisedGain) * 0.55) : 0);
  const xpGranted = grantXp(state, xp, `Sold ${def.symbol} for ${realisedGain >= 0 ? 'a gain' : 'a loss'} of ${formatMoney(Math.abs(realisedGain))}`).granted;

  pushDiagnostic(state, {
    system: 'crypto',
    level: 'info',
    message: `SELL ${quote.amount.toFixed(6)} ${def.symbol} @ ${quote.averagePrice}: proceeds ${quote.total}, gain ${realisedGain}, tax ${quote.tax}, slippage ${(quote.slippage * 100).toFixed(2)}%`,
    data: { amount: quote.amount, price: quote.averagePrice, gain: realisedGain, tax: quote.tax },
  });

  return {
    ok: true,
    quote,
    amount: quote.amount,
    cashDelta: quote.total,
    holdings: holding.amount,
    avgCost: holding.avgCost,
    realisedGain,
    fee: quote.fee,
    tax: quote.tax,
    gasFee: quote.gasFee,
    slippage: quote.slippage,
    txHash: tx.hash,
    xp: xpGranted,
    warnings: quote.warnings,
  };
}

/** Orders move the book: liquidity is consumed and price shifts. */
function applyBookImpact(c: CryptoAssetState, quote: CryptoQuote, state: GameState): void {
  const depth = Math.max(1, quote.liquidity);
  const impact = clamp((quote.notional / depth) * 0.55, 0, 0.22) * (quote.side === 'buy' ? 1 : -1);
  c.price = roundPrice(Math.max(1e-14, c.price * (1 + impact)));
  c.liquidity = round2(clamp(c.liquidity * (1 - Math.abs(impact) * 0.12) + Math.abs(quote.notional) * 0.06, 500, B.crypto.liquidityDepthBase * 400));
  c.sentiment = round2(clamp(c.sentiment + impact * 0.25, 0.02, 0.99));
  bumpCounter(state, quote.side === 'buy' ? 'crypto_buys' : 'crypto_sells');
}

/* ------------------------------------------------------------------ */
/* Custody transfers                                                   */
/* ------------------------------------------------------------------ */

export function transferCustody(
  state: GameState,
  rng: Rng,
  assetId: ID,
  amount: number,
  direction: 'to_wallet' | 'to_exchange',
  exchangeId?: ID,
): { ok: boolean; reason?: string; amount?: number; fee?: number; arrivesDay?: number } {
  const def = CRYPTO_BY_ID[assetId];
  if (!def) return { ok: false, reason: 'Unknown asset.' };
  const qty = round6(Math.max(0, amount));
  if (qty <= 0) return { ok: false, reason: 'Amount must be positive.' };
  const from = state.player.cryptoHoldings.find((h) => h.assetId === assetId && h.custody === (direction === 'to_wallet' ? 'exchange' : 'wallet'));
  if (!from || from.amount - from.staked < qty) {
    return { ok: false, reason: `Only ${(from ? from.amount - from.staked : 0).toFixed(6)} ${def.symbol} is unlocked in ${direction === 'to_wallet' ? 'exchange custody' : 'your wallet'}.` };
  }

  const ex = (exchangeId ? EXCHANGE_BY_ID[exchangeId] : undefined) ?? CRYPTO_EXCHANGES.find((e) => e.listsKinds.includes(def.kind)) ?? CRYPTO_EXCHANGES[0]!;
  const fee = direction === 'to_wallet' ? round2(ex.withdrawalFeeFlat + 1.2) : round2(0.6);
  const move = debitCash(state, fee, {
    kind: 'transfer',
    description: `${direction === 'to_wallet' ? 'Withdrawal' : 'Deposit'} of ${qty} ${def.symbol} (${ex.name})`,
    allowDirty: true,
    counterparty: ex.name,
    meta: { assetId, direction, fee },
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? 'Cannot pay the transfer fee.' };

  const address = walletAddressFor(state, rng);
  from.amount = round6(from.amount - qty);
  const target = state.player.cryptoHoldings.find((h) => h.assetId === assetId && h.custody === (direction === 'to_wallet' ? 'wallet' : 'exchange'));
  if (target) {
    const cost = target.avgCost * target.amount + from.avgCost * qty;
    target.amount = round6(target.amount + qty);
    target.avgCost = round6(cost / Math.max(1e-9, target.amount));
  } else {
    state.player.cryptoHoldings.push({
      assetId,
      amount: qty,
      avgCost: from.avgCost,
      acquiredDay: state.world.day,
      custody: direction === 'to_wallet' ? 'wallet' : 'exchange',
      walletAddress: address,
      staked: 0,
      stakedUntilDay: null,
      stakingApy: 0,
      rewardsAccrued: 0,
      miningRigId: null,
    });
  }
  if (from.amount <= 1e-9) {
    state.player.cryptoHoldings = state.player.cryptoHoldings.filter((h) => h !== from);
  }

  appendOnChain(state, {
    day: state.world.day,
    assetId,
    side: 'transfer',
    amount: qty,
    price: state.world.cryptoAssets[assetId]?.price ?? 0,
    address,
    counterparty: ex.name,
    note: direction === 'to_wallet' ? 'Withdrawal to self-custody' : 'Deposit to exchange custody',
  });

  const arrivesDay = state.world.day + (direction === 'to_wallet' ? ex.withdrawalDelayDays : 0);
  if (direction === 'to_wallet' && ex.withdrawalDelayDays > 0) {
    const account = state.player.underground.exchangeAccounts.find((a) => a.exchangeId === ex.id);
    if (account) account.frozenUntilDay = Math.max(account.frozenUntilDay ?? 0, arrivesDay);
  }
  bumpCounter(state, 'custody_transfers');
  return { ok: true, amount: qty, fee, arrivesDay };
}

/* ------------------------------------------------------------------ */
/* Staking                                                             */
/* ------------------------------------------------------------------ */

export function stake(state: GameState, assetId: ID, amount: number, lockDays: number): { ok: boolean; reason?: string; apy?: number; untilDay?: number } {
  const def = CRYPTO_BY_ID[assetId];
  const c = state.world.cryptoAssets[assetId];
  if (!def || !c) return { ok: false, reason: 'Unknown asset.' };
  if (!def.stakeable) return { ok: false, reason: `${def.symbol} cannot be staked.` };
  if (c.status !== 'active') return { ok: false, reason: `${def.symbol} is ${c.status}; staking is suspended.` };
  if (!B.crypto.stakingLockDays.includes(lockDays)) {
    return { ok: false, reason: `Lock period must be one of ${B.crypto.stakingLockDays.join(', ')} days.` };
  }
  const holding = state.player.cryptoHoldings.find((h) => h.assetId === assetId);
  const free = holding ? holding.amount - holding.staked : 0;
  const qty = round6(Math.min(Math.max(0, amount), free));
  if (qty <= 0) return { ok: false, reason: `Only ${free.toFixed(6)} ${def.symbol} is unstaked.` };

  // Longer locks earn more; thin liquidity and hot sentiment cut the real yield.
  const lockBonus = 1 + (lockDays / 90) * 0.35;
  const apy = round2(clamp(c.currentApy * lockBonus * (0.6 + c.sentiment * 0.6), 0.001, 0.6));
  holding!.staked = round6(holding!.staked + qty);
  holding!.stakedUntilDay = state.world.day + lockDays;
  holding!.stakingApy = apy;

  appendOnChain(state, {
    day: state.world.day,
    assetId,
    side: 'stake',
    amount: qty,
    price: c.price,
    address: holding!.walletAddress,
    counterparty: 'staking contract',
    note: `Bond ${qty.toFixed(6)} ${def.symbol} for ${lockDays} days at ${(apy * 100).toFixed(2)}% APY`,
  });
  bumpCounter(state, 'staking_positions');
  pushNotification(state, {
    kind: 'info',
    title: `Staked ${qty.toFixed(4)} ${def.symbol}`,
    body: `Locked until day ${holding!.stakedUntilDay} at ${(apy * 100).toFixed(2)}% APY. Exiting early costs ${(B.crypto.stakingSlashOnExitEarly * 100).toFixed(1)}% of the bonded amount, and a protocol event can slash it.`,
    link: '/game/crypto',
    metrics: [
      { label: 'APY', value: `${(apy * 100).toFixed(2)}%` },
      { label: 'Unlocks', value: `day ${holding!.stakedUntilDay}` },
      { label: 'Daily yield', value: `${((qty * apy) / 365).toFixed(6)} ${def.symbol}` },
    ],
  });
  return { ok: true, apy, untilDay: holding!.stakedUntilDay };
}

export function unstake(state: GameState, assetId: ID, amount: number, early = false): { ok: boolean; reason?: string; slashed?: number; released?: number } {
  const def = CRYPTO_BY_ID[assetId];
  const holding = state.player.cryptoHoldings.find((h) => h.assetId === assetId && h.staked > 0);
  if (!def || !holding) return { ok: false, reason: 'No bonded stake for that asset.' };
  const locked = holding.stakedUntilDay !== null && state.world.day < holding.stakedUntilDay;
  if (locked && !early) {
    return { ok: false, reason: `Stake unlocks on day ${holding.stakedUntilDay}. Force-exit to take the ${(B.crypto.stakingSlashOnExitEarly * 100).toFixed(1)}% slash.` };
  }
  const qty = round6(Math.min(Math.max(0, amount), holding.staked));
  if (qty <= 0) return { ok: false, reason: 'Nothing to unbond.' };
  const slashed = locked ? round6(qty * B.crypto.stakingSlashOnExitEarly) : 0;
  const released = round6(qty - slashed);
  holding.staked = round6(holding.staked - qty);
  if (holding.staked <= 1e-9) {
    holding.stakedUntilDay = null;
    holding.stakingApy = 0;
  }
  appendOnChain(state, {
    day: state.world.day,
    assetId,
    side: 'unstake',
    amount: released,
    price: state.world.cryptoAssets[assetId]?.price ?? 0,
    address: holding.walletAddress,
    counterparty: 'staking contract',
    note: slashed > 0 ? `Early unbond: ${slashed.toFixed(6)} ${def.symbol} slashed` : `Unbond ${released.toFixed(6)} ${def.symbol}`,
  });
  if (slashed > 0) {
    setCounter(state, 'staking_slashed', round6(counter(state, 'staking_slashed') + slashed));
    pushNotification(state, {
      kind: 'warning',
      title: `Early exit slashed ${slashed.toFixed(4)} ${def.symbol}`,
      body: `You unbonded before day ${holding.stakedUntilDay ?? state.world.day}. ${released.toFixed(6)} ${def.symbol} returned to your balance.`,
      link: '/game/crypto',
    });
  }
  return { ok: true, slashed, released };
}

function accrueStakingRewards(state: GameState, day: number): number {
  let totalValue = 0;
  for (const holding of state.player.cryptoHoldings) {
    if (holding.staked <= 0 || holding.stakingApy <= 0) continue;
    const def = CRYPTO_BY_ID[holding.assetId];
    const c = state.world.cryptoAssets[holding.assetId];
    if (!def || !c) continue;
    const reward = round6((holding.staked * holding.stakingApy) / 365);
    if (reward <= 0) continue;
    holding.rewardsAccrued = round6(holding.rewardsAccrued + reward);
    totalValue += reward * c.price;
    if (holding.rewardsAccrued * c.price >= 25) {
      // Auto-compound into the bonded position once rewards are material.
      holding.staked = round6(holding.staked + holding.rewardsAccrued);
      appendOnChain(state, {
        day,
        assetId: holding.assetId,
        side: 'reward',
        amount: holding.rewardsAccrued,
        price: c.price,
        address: holding.walletAddress,
        counterparty: 'staking contract',
        note: `Staking reward compounded (${(holding.stakingApy * 100).toFixed(2)}% APY)`,
      });
      setCounter(state, 'staking_rewards', round2(counter(state, 'staking_rewards') + holding.rewardsAccrued * c.price));
      holding.rewardsAccrued = 0;
    }
  }
  return round2(totalValue);
}

/* ------------------------------------------------------------------ */
/* Mining                                                              */
/* ------------------------------------------------------------------ */

export interface RigSpec {
  id: ID;
  name: string;
  assetId: ID;
  hashRate: number;
  powerDraw: number;
  price: number;
  description: string;
}

/**
 * Rig catalogue derived from the asset registry so new assets automatically get
 * mineable hardware. Efficiency (hashes per unit of power) improves with tier.
 */
export function rigCatalogue(state: GameState): RigSpec[] {
  const out: RigSpec[] = [];
  for (const def of CRYPTO_ASSETS.filter((d) => d.mineable)) {
    const c = state.world.cryptoAssets[def.id];
    if (!c) continue;
    const tiers = [
      { suffix: 'USB rig', hash: 40, power: 0.9, priceMul: 1 },
      { suffix: 'GPU rig', hash: 320, power: 3.4, priceMul: 5.6 },
      { suffix: 'ASIC array', hash: 4200, power: 18, priceMul: 46 },
    ];
    tiers.forEach((tier, i) => {
      const valuePerHash = (blockReward(def, c) * c.price * 86400) / Math.max(1, def.blockTimeSeconds ?? 600) / Math.max(0.01, c.networkDifficulty * 1200);
      const price = round2(Math.max(320, tier.hash * valuePerHash * 210 * tier.priceMul * (1 + i * 0.08)));
      out.push({
        id: `${def.id}_rig_${i}`,
        name: `${def.symbol} ${tier.suffix}`,
        assetId: def.id,
        hashRate: tier.hash,
        powerDraw: tier.power,
        price,
        description: `${tier.hash} TH/s at ${tier.power} kW. Payback depends on ${def.symbol} price, network difficulty (${c.networkDifficulty.toFixed(2)}) and your electricity rate.`,
      });
    });
  }
  return out;
}

export function buyMiningRig(state: GameState, rng: Rng, rigId: ID, propertyId?: ID): { ok: boolean; reason?: string; rig?: MiningRig } {
  const spec = rigCatalogue(state).find((r) => r.id === rigId);
  if (!spec) return { ok: false, reason: 'Unknown rig.' };
  const property = propertyId ? state.player.properties.find((p) => p.id === propertyId) : state.player.properties.find((p) => p.locationId === state.player.locationId);
  const powerCostMultiplier = property ? 1 : 1.55;
  const move = debitCash(state, spec.price, {
    kind: 'production',
    description: `Assembled ${spec.name}`,
    allowDirty: false,
    locationId: state.player.locationId,
    meta: { assetId: spec.assetId, hashRate: spec.hashRate, power: spec.powerDraw },
  });
  if (!move.ok) return { ok: false, reason: move.reason ?? 'Insufficient funds.' };

  const rig: MiningRig = {
    id: newId(rng, 'rig'),
    name: spec.name,
    assetId: spec.assetId,
    hashRate: spec.hashRate,
    powerDraw: spec.powerDraw * powerCostMultiplier,
    purchasedDay: state.world.day,
    locationId: state.player.locationId,
    propertyId: property?.id ?? null,
    condition: 1,
    totalMined: 0,
    active: true,
  };
  state.player.miningRigs.push(rig);
  bumpCounter(state, 'rigs_built');
  setCounter(state, 'rig_capex', round2(counter(state, 'rig_capex') + spec.price));
  pushNotification(state, {
    kind: 'success',
    title: `${spec.name} online`,
    body: property
      ? `Hosted at ${property.name} with metered power. Output depends on network difficulty and ${CRYPTO_BY_ID[spec.assetId]?.symbol ?? ''} price.`
      : `Running on commercial power at a 55% premium — host it at a property you own to cut costs.`,
    link: '/game/crypto',
    metrics: [
      { label: 'Hash rate', value: `${spec.hashRate} TH/s` },
      { label: 'Power', value: `${rig.powerDraw.toFixed(2)} kW` },
      { label: 'Capex', value: formatMoney(spec.price) },
    ],
  });
  return { ok: true, rig };
}

export function miningTick(state: GameState, rng: Rng, day: number): { value: number; cost: number; units: { assetId: ID; symbol: string; mined: number }[] } {
  let totalValue = 0;
  let totalCost = 0;
  const units: { assetId: ID; symbol: string; mined: number }[] = [];

  for (const rig of state.player.miningRigs) {
    if (!rig.active) continue;
    const def = CRYPTO_BY_ID[rig.assetId];
    const c = state.world.cryptoAssets[rig.assetId];
    if (!def || !c || c.status === 'rugged') continue;

    const blocksPerDay = 86400 / Math.max(1, def.blockTimeSeconds ?? 600);
    const reward = blockReward(def, c);
    const networkHash = Math.max(1, c.networkDifficulty * 1200);
    const share = clamp((rig.hashRate * rig.condition) / networkHash, 0, 0.35);
    const mined = round6(blocksPerDay * reward * share * rng.float(0.72, 1.28));

    const property = rig.propertyId ? state.player.properties.find((p) => p.id === rig.propertyId) : null;
    const energyPrice = B.crypto.miningCostPerUnitEnergy * (property ? 1 : 1.55) * (1 + state.world.inflationRate * 0.4);
    const energyCost = round2(rig.powerDraw * 24 * energyPrice);
    const maintenance = round2(rig.powerDraw * 0.4 + (1 - rig.condition) * 6);
    const cost = round2(energyCost + maintenance);

    const value = round2(mined * c.price);
    totalValue = round2(totalValue + value);
    totalCost = round2(totalCost + cost);

    // Mining is only worth running when it is profitable; rigs can be idled.
    if (value < cost) {
      rig.active = false;
      pushNotification(state, {
        kind: 'warning',
        title: `${rig.name} halted — unprofitable`,
        body: `It mined ${mined.toFixed(6)} ${def.symbol} worth ${formatMoney(value)} against ${formatMoney(cost)} of power and maintenance. Difficulty ${c.networkDifficulty.toFixed(2)}, block reward ${reward.toFixed(4)}. Restart it from the Crypto screen when conditions improve.`,
        link: '/game/crypto',
      });
      continue;
    }

    const pay = debitCash(state, cost, { kind: 'production', description: `Mining power and maintenance: ${rig.name}`, allowDirty: false, meta: { mined, assetId: rig.assetId } });
    if (!pay.ok) {
      rig.active = false;
      pushNotification(state, { kind: 'danger', title: `${rig.name} offline`, body: 'You could not pay the power bill.', link: '/game/crypto' });
      continue;
    }

    const holding = state.player.cryptoHoldings.find((h) => h.assetId === rig.assetId && h.custody === 'wallet');
    if (holding) {
      const costBasis = holding.avgCost * holding.amount + cost;
      holding.amount = round6(holding.amount + mined);
      holding.avgCost = round6(costBasis / Math.max(1e-9, holding.amount));
    } else {
      state.player.cryptoHoldings.push({
        assetId: rig.assetId,
        amount: mined,
        avgCost: round6(cost / Math.max(1e-9, mined)),
        acquiredDay: day,
        custody: 'wallet',
        walletAddress: walletAddressFor(state, rng),
        staked: 0,
        stakedUntilDay: null,
        stakingApy: 0,
        rewardsAccrued: 0,
        miningRigId: rig.id,
      });
    }
    rig.totalMined = round6(rig.totalMined + mined);
    rig.condition = round2(clamp(rig.condition - rng.float(0.0015, 0.006), 0.2, 1));
    units.push({ assetId: rig.assetId, symbol: def.symbol, mined });
    appendOnChain(state, {
      day,
      assetId: rig.assetId,
      side: 'mine',
      amount: mined,
      price: c.price,
      address: holding?.walletAddress ?? walletAddressFor(state, rng),
      counterparty: rig.name,
      note: `Mined ${mined.toFixed(6)} ${def.symbol} (share ${(share * 100).toFixed(3)}% of network)`,
    });
    pushDiagnostic(state, {
      system: 'crypto',
      level: 'debug',
      message: `MINED ${mined.toFixed(6)} ${def.symbol} with ${rig.name}: value ${value}, cost ${cost}, share ${(share * 100).toFixed(3)}%, difficulty ${c.networkDifficulty.toFixed(2)}`,
      data: { mined, value, cost, difficulty: c.networkDifficulty },
    });
  }

  if (units.length > 0) {
    setCounter(state, 'crypto_mined_value', round2(counter(state, 'crypto_mined_value') + totalValue));
    setCounter(state, 'mining_energy_cost', round2(counter(state, 'mining_energy_cost') + totalCost));
    grantXp(state, Math.round(4 + units.length * 2), 'Mining rewards credited');
  }
  return { value: totalValue, cost: totalCost, units };
}

export function toggleRig(state: GameState, rigId: ID, active: boolean): { ok: boolean; reason?: string } {
  const rig = state.player.miningRigs.find((r) => r.id === rigId);
  if (!rig) return { ok: false, reason: 'Rig not found.' };
  rig.active = active;
  return { ok: true };
}

export function repairRig(state: GameState, rigId: ID): { ok: boolean; reason?: string; cost?: number } {
  const rig = state.player.miningRigs.find((r) => r.id === rigId);
  if (!rig) return { ok: false, reason: 'Rig not found.' };
  const spec = rigCatalogue(state).find((s) => s.name === rig.name);
  const cost = round2((1 - rig.condition) * (spec?.price ?? 4000) * 0.16);
  if (cost <= 1) return { ok: false, reason: 'The rig is already in good condition.' };
  const pay = debitCash(state, cost, { kind: 'production', description: `Refurbished ${rig.name}`, allowDirty: false });
  if (!pay.ok) return { ok: false, reason: pay.reason ?? 'Insufficient funds.' };
  rig.condition = 1;
  return { ok: true, cost };
}

/* ------------------------------------------------------------------ */
/* Exchange failures (custody risk)                                    */
/* ------------------------------------------------------------------ */

function exchangeFailureTick(state: GameState, rng: Rng): CryptoEvent[] {
  const events: CryptoEvent[] = [];
  for (const account of state.player.underground.exchangeAccounts) {
    const ex = EXCHANGE_BY_ID[account.exchangeId];
    if (!ex) continue;
    const atRisk = state.player.cryptoHoldings.filter((h) => h.custody === 'exchange');
    if (atRisk.length === 0 && account.balance <= 0) continue;
    const exposure = atRisk.reduce((s, h) => s + h.amount * (state.world.cryptoAssets[h.assetId]?.price ?? 0), 0) + account.balance;
    if (exposure <= 0) continue;
    const chance = ex.custodyRiskPerDay * (1 + state.world.indicators.globalRiskAppetite * -0.4) * (1 + exposure / 2_000_000);
    if (!rng.chance(clamp(chance, 0, 0.06))) continue;

    const frozen = rng.chance(0.55);
    if (frozen) {
      account.frozenUntilDay = state.world.day + rng.int(6, 40);
      pushNotification(state, {
        kind: 'danger',
        title: `${ex.name} has frozen withdrawals`,
        body: `Custodial balances are locked until day ${account.frozenUntilDay}. ${formatMoney(exposure)} of exposure is stuck. This is what self-custody is for.`,
        link: '/game/crypto',
        metrics: [{ label: 'Exposure', value: formatMoney(exposure) }],
      });
      events.push({
        assetId: atRisk[0]?.assetId ?? 'n/a',
        symbol: ex.name,
        kind: 'exchange_failure',
        headline: `${ex.name} freezes withdrawals`,
        detail: `The venue halted withdrawals amid a liquidity squeeze. Client balances of ${formatMoney(exposure)} are inaccessible.`,
        importance: 4,
        priceImpact: 0,
      });
      continue;
    }

    // Insolvency: custodial balances are gone.
    let lost = 0;
    for (const h of atRisk) {
      const c = state.world.cryptoAssets[h.assetId];
      lost += h.amount * (c?.price ?? 0);
      appendOnChain(state, {
        day: state.world.day,
        assetId: h.assetId,
        side: 'loss',
        amount: h.amount,
        price: c?.price ?? 0,
        address: h.walletAddress,
        counterparty: ex.name,
        note: `Balance lost in ${ex.name} insolvency`,
      });
    }
    lost = round2(lost + account.balance);
    state.player.cryptoHoldings = state.player.cryptoHoldings.filter((h) => h.custody !== 'exchange');
    account.balance = 0;
    state.player.underground.exchangeAccounts = state.player.underground.exchangeAccounts.filter((a) => a.exchangeId !== ex.id);
    setCounter(state, 'exchange_losses', round2(counter(state, 'exchange_losses') + lost));
    changeReputation(state, 'digital', -3, 'Lost in an exchange insolvency');
    pushNotification(state, {
      kind: 'danger',
      title: `${ex.name} is insolvent`,
      body: `Custodial balances are gone: ${formatMoney(lost)} written off. Coins in your own wallet are untouched.`,
      link: '/game/crypto',
      metrics: [{ label: 'Written off', value: formatMoney(lost) }],
    });
    events.push({
      assetId: atRisk[0]?.assetId ?? 'n/a',
      symbol: ex.name,
      kind: 'exchange_failure',
      headline: `${ex.name} collapses`,
      detail: `The exchange is insolvent and client funds are lost — ${formatMoney(lost)} for you. Self-custodied coins are unaffected.`,
      importance: 5,
      priceImpact: 0,
    });
  }
  return events;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface CryptoRow {
  assetId: ID;
  symbol: string;
  name: string;
  kind: CryptoAssetDef['kind'];
  status: CryptoAssetState['status'];
  price: number;
  change1d: number;
  change7d: number;
  change30d: number;
  volatility: number;
  sentiment: number;
  liquidity: number;
  maxNotional: number;
  circulatingSupply: number;
  maxSupply: number | null;
  issuanceRate: number;
  halvingEpoch: number;
  nextHalvingDay: number | null;
  blockReward: number;
  networkDifficulty: number;
  currentApy: number;
  stakeable: boolean;
  mineable: boolean;
  regulatoryRisk: number;
  protocolRisk: number;
  networkEffect: number;
  held: number;
  staked: number;
  heldValue: number;
  heldCost: number;
  unrealisedPnl: number;
  unrealisedPnlPct: number;
  rewardsAccrued: number;
  custody: CryptoHolding['custody'] | null;
  venues: string[];
  description: string;
}

function toCryptoRow(state: GameState, def: CryptoAssetDef, c: CryptoAssetState): CryptoRow {
  const holdings = state.player.cryptoHoldings.filter((h) => h.assetId === def.id);
  const held = round6(holdings.reduce((s, h) => s + h.amount, 0));
  const staked = round6(holdings.reduce((s, h) => s + h.staked, 0));
  const cost = holdings.reduce((s, h) => s + h.avgCost * h.amount, 0);
  const value = held * c.price;
  const at = (n: number) => (c.history.length > n ? c.history[c.history.length - 1 - n]! : c.history[0] ?? c.price);
  const change = (n: number) => (at(n) > 0 ? round2(c.price / at(n) - 1) : 0);
  const venues = CRYPTO_EXCHANGES.filter((ex) => ex.listsKinds.includes(def.kind)).map((ex) => ex.name);
  const interval = def.halvingIntervalDays ?? null;
  return {
    assetId: def.id,
    symbol: def.symbol,
    name: def.name,
    kind: def.kind,
    status: c.status,
    price: c.price,
    change1d: change(1),
    change7d: change(7),
    change30d: change(30),
    volatility: c.volatility,
    sentiment: c.sentiment,
    liquidity: round2(c.liquidity),
    maxNotional: round2(c.liquidity * 0.25),
    circulatingSupply: c.circulatingSupply,
    maxSupply: def.maxSupply,
    issuanceRate: def.issuanceRate,
    halvingEpoch: c.halvingEpoch,
    nextHalvingDay: interval ? (Math.floor(state.world.day / interval) + 1) * interval : null,
    blockReward: blockReward(def, c),
    networkDifficulty: c.networkDifficulty,
    currentApy: c.currentApy,
    stakeable: def.stakeable,
    mineable: def.mineable,
    regulatoryRisk: def.regulatoryRisk,
    protocolRisk: def.protocolRisk,
    networkEffect: def.networkEffect,
    held,
    staked,
    heldValue: round2(value),
    heldCost: round2(cost),
    unrealisedPnl: round2(value - cost),
    unrealisedPnlPct: cost > 0 ? round2((value / cost - 1) * 1000) / 10 : 0,
    rewardsAccrued: round6(holdings.reduce((s, h) => s + h.rewardsAccrued, 0)),
    custody: holdings[0]?.custody ?? null,
    venues,
    description: def.description,
  };
}

export interface CryptoMarketView {
  indexLevel: number;
  indexChange1d: number;
  indexChange30d: number;
  indexHistory: { day: number; level: number }[];
  globalSentiment: number;
  riskAppetite: number;
  interestRate: number;
  walletAddress: string | null;
  exchanges: (CryptoExchangeDef & { hasAccount: boolean; balance: number; frozenUntilDay: number | null; accessible: boolean; accessReason: string | null })[];
  portfolioValue: number;
  portfolioCost: number;
  unrealisedPnl: number;
  stakedValue: number;
  stakedApyWeighted: number;
  realisedGains: number;
  minedValue: number;
  assets: CryptoRow[];
  holdings: CryptoRow[];
  movers: { up: CryptoRow[]; down: CryptoRow[] };
  rigs: {
    id: ID;
    name: string;
    assetId: ID;
    symbol: string;
    hashRate: number;
    powerDraw: number;
    condition: number;
    active: boolean;
    totalMined: number;
    estimatedDailyUnits: number;
    estimatedDailyValue: number;
    estimatedDailyCost: number;
    profitability: number;
    hostedAt: string | null;
  }[];
  events: { day: number; headline: string; body: string; importance: number }[];
  ledger: OnChainEntry[];
}

export function cryptoMarketView(state: GameState, opts: { kind?: string; search?: string } = {}): CryptoMarketView {
  const world = state.world;
  const rows = CRYPTO_ASSETS.map((def) => ({ def, c: world.cryptoAssets[def.id] }))
    .filter((x): x is { def: CryptoAssetDef; c: CryptoAssetState } => x.c !== undefined)
    .map((x) => toCryptoRow(state, x.def, x.c));

  const search = (opts.search ?? '').trim().toLowerCase();
  const filtered = rows
    .filter((r) => (opts.kind ? r.kind === opts.kind : true))
    .filter((r) => (search ? r.symbol.toLowerCase().includes(search) || r.name.toLowerCase().includes(search) : true));

  const holdings = rows.filter((r) => r.held > 0);
  const stakedValue = holdings.reduce((s, r) => s + r.staked * r.price, 0);
  const stakedWeightedApy = stakedValue > 0 ? holdings.reduce((s, r) => s + r.staked * r.price * r.currentApy, 0) / stakedValue : 0;
  const historyStart = world.cryptoIndexHistory.length > 0 ? world.day - world.cryptoIndexHistory.length + 1 : world.day;

  return {
    indexLevel: world.cryptoIndex,
    indexChange1d: world.cryptoIndexHistory.length > 1 ? round2(world.cryptoIndex / world.cryptoIndexHistory[world.cryptoIndexHistory.length - 2]! - 1) : 0,
    indexChange30d: world.cryptoIndexHistory.length > 30 ? round2(world.cryptoIndex / world.cryptoIndexHistory[world.cryptoIndexHistory.length - 31]! - 1) : 0,
    indexHistory: world.cryptoIndexHistory.map((level, i) => ({ day: historyStart + i, level })),
    globalSentiment: round2(rows.length > 0 ? rows.reduce((s, r) => s + r.sentiment, 0) / rows.length : 0.5),
    riskAppetite: world.indicators.globalRiskAppetite,
    interestRate: world.interestRate,
    walletAddress: state.player.underground.walletAddress,
    exchanges: listExchanges(state),
    portfolioValue: round2(holdings.reduce((s, r) => s + r.heldValue, 0)),
    portfolioCost: round2(holdings.reduce((s, r) => s + r.heldCost, 0)),
    unrealisedPnl: round2(holdings.reduce((s, r) => s + r.unrealisedPnl, 0)),
    stakedValue: round2(stakedValue),
    stakedApyWeighted: round2(stakedWeightedApy),
    realisedGains: round2(counter(state, 'crypto_gains') - counter(state, 'crypto_losses')),
    minedValue: round2(counter(state, 'crypto_mined_value')),
    assets: filtered,
    holdings,
    movers: {
      up: [...filtered].sort((a, b) => b.change1d - a.change1d).slice(0, 5),
      down: [...filtered].sort((a, b) => a.change1d - b.change1d).slice(0, 5),
    },
    rigs: state.player.miningRigs.map((rig) => {
      const def = CRYPTO_BY_ID[rig.assetId];
      const c = world.cryptoAssets[rig.assetId];
      const blocksPerDay = def?.blockTimeSeconds ? 86400 / def.blockTimeSeconds : 0;
      const reward = def && c ? blockReward(def, c) : 0;
      const share = c ? clamp((rig.hashRate * rig.condition) / Math.max(1, c.networkDifficulty * 1200), 0, 0.35) : 0;
      const units = blocksPerDay * reward * share;
      const property = rig.propertyId ? state.player.properties.find((p) => p.id === rig.propertyId) : null;
      const energyPrice = B.crypto.miningCostPerUnitEnergy * (property ? 1 : 1.55);
      const cost = round2(rig.powerDraw * 24 * energyPrice + rig.powerDraw * 0.4);
      const value = round2(units * (c?.price ?? 0));
      return {
        id: rig.id,
        name: rig.name,
        assetId: rig.assetId,
        symbol: def?.symbol ?? rig.assetId,
        hashRate: rig.hashRate,
        powerDraw: rig.powerDraw,
        condition: rig.condition,
        active: rig.active,
        totalMined: rig.totalMined,
        estimatedDailyUnits: round6(units),
        estimatedDailyValue: value,
        estimatedDailyCost: cost,
        profitability: cost > 0 ? round2((value - cost) / cost) : 0,
        hostedAt: property?.name ?? null,
      };
    }),
    events: world.news.filter((n) => n.tags.includes('crypto')).slice(0, 12).map((n) => ({ day: n.day, headline: n.headline, body: n.body, importance: n.importance })),
    ledger: state.player.underground.onChain.slice(-40).reverse(),
  };
}

export interface CryptoAssetDetail extends CryptoRow {
  history: { day: number; price: number }[];
  supplyHistory: number[];
  bestVenue: { exchangeId: ID; name: string; fee: number; liquidity: number; slippageFor1000: number };
  buyQuote: CryptoQuote | null;
  sellQuote: CryptoQuote | null;
  riskNotes: string[];
  stakingOptions: { lockDays: number; apy: number; dailyYield: number }[];
  rigOptions: RigSpec[];
  worth: number;
}

export function cryptoAssetDetail(state: GameState, assetId: ID, amount = 1): CryptoAssetDetail | null {
  const def = CRYPTO_BY_ID[assetId];
  const c = state.world.cryptoAssets[assetId];
  if (!def || !c) return null;
  const row = toCryptoRow(state, def, c);
  const historyStart = c.history.length > 0 ? state.world.day - c.history.length + 1 : state.world.day;
  const venues = CRYPTO_EXCHANGES.filter((ex) => ex.listsKinds.includes(def.kind) && (!ex.requiresUnderground || state.player.underground.accessUnlocked));
  const best = venues.sort((a, b) => venueLiquidity(c, b) - venueLiquidity(c, a))[0];
  const riskNotes: string[] = [];
  if (c.status !== 'active') riskNotes.push(`Status ${c.status}: trading and liquidity are impaired.`);
  if (def.kind === 'memecoin') riskNotes.push(`Memecoin: no fundamentals, ${(B.crypto.memecoinRugChancePerDay * 100).toFixed(1)}% daily rug risk when sentiment is hot.`);
  if (def.kind === 'stablecoin') riskNotes.push(`Pegged to ${formatMoney(def.peg?.value ?? 1)}; a depeg below ${(B.crypto.depegThreshold * 100).toFixed(0)}% of peg cascades.`);
  if (def.regulatoryRisk > 0.5) riskNotes.push(`Regulatory risk ${(def.regulatoryRisk * 100).toFixed(0)}%: bans and approvals move this asset violently.`);
  if (def.protocolRisk > 0.4) riskNotes.push(`Protocol risk ${(def.protocolRisk * 100).toFixed(0)}%: exploits and contentious forks are common.`);
  if (c.sentiment > 0.85) riskNotes.push(`Sentiment ${(c.sentiment * 100).toFixed(0)}/100 — reflexive buying is the only thing holding the price up.`);
  if (def.mineable && c.networkDifficulty > 2) riskNotes.push(`Network difficulty ${c.networkDifficulty.toFixed(2)}: marginal hash rate is unprofitable.`);
  riskNotes.push('Custodial balances are exposed to exchange failure; self-custody is not, but lost keys are unrecoverable.');

  return {
    ...row,
    history: c.history.map((price, i) => ({ day: historyStart + i, price })),
    supplyHistory: [],
    bestVenue: best
      ? {
          exchangeId: best.id,
          name: best.name,
          fee: best.feeFraction,
          liquidity: round2(venueLiquidity(c, best)),
          slippageFor1000: round2(clamp((1000 / Math.max(1, venueLiquidity(c, best))) * B.crypto.slippagePerDepthFraction, 0, 0.6) * 10000) / 10000,
        }
      : { exchangeId: '', name: 'No accessible venue', fee: 0, liquidity: 0, slippageFor1000: 0 },
    buyQuote: quoteCrypto(state, assetId, amount, 'buy'),
    sellQuote: quoteCrypto(state, assetId, amount, 'sell'),
    riskNotes,
    stakingOptions: def.stakeable
      ? B.crypto.stakingLockDays.map((lockDays) => {
          const apy = round2(clamp(c.currentApy * (1 + (lockDays / 90) * 0.35) * (0.6 + c.sentiment * 0.6), 0.001, 0.6));
          return { lockDays, apy, dailyYield: round6((row.held * apy) / 365) };
        })
      : [],
    rigOptions: def.mineable ? rigCatalogue(state).filter((r) => r.assetId === assetId) : [],
    worth: round2(computeNetWorth(state).crypto),
  };
}

/** Concentration and risk profile of the crypto book. */
export function cryptoPortfolioRisk(state: GameState): {
  value: number;
  custodySplit: { wallet: number; exchange: number };
  byKind: { kind: string; weight: number }[];
  concentration: number;
  weightedVolatility: number;
  exchangeExposure: number;
  largest: { symbol: string; weight: number } | null;
} {
  const holdings = state.player.cryptoHoldings;
  let walletValue = 0;
  let exchangeValue = 0;
  const byKind = new Map<string, number>();
  let total = 0;
  let weightedVol = 0;
  let largest: { symbol: string; weight: number } | null = null;
  for (const h of holdings) {
    const c = state.world.cryptoAssets[h.assetId];
    const def = CRYPTO_BY_ID[h.assetId];
    if (!c || !def) continue;
    const v = h.amount * c.price;
    total += v;
    if (h.custody === 'wallet') walletValue += v;
    else exchangeValue += v;
    byKind.set(def.kind, (byKind.get(def.kind) ?? 0) + v);
    weightedVol += c.volatility * v;
    const weight = v;
    if (!largest || weight > largest.weight) largest = { symbol: def.symbol, weight: v };
  }
  const kinds = [...byKind.entries()].map(([kind, v]) => ({ kind, weight: total > 0 ? round2(v / total) : 0 })).sort((a, b) => b.weight - a.weight);
  const hhi = kinds.reduce((s, k) => s + k.weight * k.weight, 0);
  return {
    value: round2(total),
    custodySplit: { wallet: round2(walletValue), exchange: round2(exchangeValue) },
    byKind: kinds,
    concentration: round2(clamp(hhi, 0, 1)),
    weightedVolatility: total > 0 ? round2(weightedVol / total) : 0,
    exchangeExposure: total > 0 ? round2(exchangeValue / total) : 0,
    largest: largest && total > 0 ? { symbol: largest.symbol, weight: round2(largest.weight / total) } : null,
  };
}

/** Short human-readable hash for UI display. */
export function txShort(hash: ID): string {
  return `${hash.slice(0, 6)}…${shortChecksum(hash)}`;
}
