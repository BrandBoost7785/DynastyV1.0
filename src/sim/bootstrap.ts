/**
 * Bootstrap — assembling a new game from registries and factories.
 *
 * This is the only place where the whole state tree is constructed, which keeps
 * module boundaries acyclic: `state.ts` builds the player, `world.ts` the macro
 * world, `stocks.ts` and `crypto.ts` their own asset universes, and `markets.ts`
 * materialises the commodity markets the player can actually see on day one.
 *
 * Creation is deterministic: the same seed always produces the same world, the
 * same start city, the same opening prices and the same job board.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { registrySummary, type RegistrySummary } from '../engine/registry';
import { getWorldRegistry } from '../engine/registry/world';
import { initCryptoAssets } from './crypto';
import { materialiseLocation } from './markets';
import { rollMissionOffers } from './missions';
import { bumpCounter, counter, setCounter } from './progression';
import {
  createGameConfig,
  createPlayer,
  formatMoney,
  pushDiagnostic,
  pushNetWorthSnapshot,
  pushNotification,
  round2,
  validateState,
  newId,
} from './state';
import { initCompanies } from './stocks';
import { createWorldState, pushNews } from './world';
import type { Difficulty } from './state';
import type { GameConfig, GameMode, GameState, ID } from './types';

const B = getBalance();
const worldReg = getWorldRegistry();
const registry = getCommodityRegistry();

export interface NewGameOptions {
  userId: ID;
  playerName: string;
  gameName?: string;
  /** World seed; shared seeds produce identical starting conditions. */
  seed?: string;
  difficulty?: Difficulty;
  mode?: GameMode;
  startLocationId?: ID;
  permadeath?: boolean;
  endless?: boolean;
  startingCash?: number;
  startDateLabel?: string;
}

export interface NewGameResult {
  state: GameState;
  seed: string;
  issues: string[];
  summary: RegistrySummary;
  materialisedMarkets: number;
  companies: number;
  cryptoAssets: number;
  missionOffers: number;
}

/** Deterministic seed derived from the user and the current time bucket. */
export function deriveSeed(userId: ID, nonce = Date.now()): string {
  return `dyn-${userId}-${nonce.toString(36)}`;
}

export function createNewGame(opts: NewGameOptions): NewGameResult {
  const seed = opts.seed ?? deriveSeed(opts.userId);
  const difficulty = opts.difficulty ?? 'standard';
  const rng = new Rng(`${seed}:player`, 'bootstrap');

  /* ------------------------------ world ------------------------------ */
  const world = createWorldState(seed, 0);
  const companies = initCompanies(world, rng, 0);
  const cryptoAssets = initCryptoAssets(world, rng, 0);

  /* ------------------------------ config ----------------------------- */
  const config: GameConfig = createGameConfig({
    worldSeed: seed,
    difficulty,
    mode: opts.mode ?? 'campaign',
    ...(opts.startLocationId ? { startLocationId: opts.startLocationId } : {}),
    permadeath: opts.permadeath ?? false,
    endless: opts.endless ?? true,
    ...(opts.startDateLabel ? { startDateLabel: opts.startDateLabel } : {}),
  });

  /* ------------------------------ player ----------------------------- */
  // The ledger checkpoint is keyed by the save's identity, so the game id has to
  // exist before the player is built.
  const gameId = newId(rng, 'game');
  const playerId = newId(rng, 'plr');
  const player = createPlayer({
    rng,
    playerId,
    name: opts.playerName,
    day: 0,
    locationId: config.startLocationId,
    difficulty,
    gameId,
    userId: opts.userId,
    worldSeed: seed,
    ...(opts.startingCash !== undefined ? { startingCash: opts.startingCash } : {}),
  });

  const state: GameState = {
    schemaVersion: B.saves.schemaVersion,
    gameId,
    userId: opts.userId,
    name: opts.gameName ?? `${opts.playerName}'s Dynasty`,
    status: 'active',
    version: 1,
    turn: 0,
    config,
    world,
    player,
    markets: {},
    rng: rng.getState(),
    rngLabel: rng.label,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastTickDay: 0,
    diagnostics: [],
    ending: null,
  };

  /* --------------------------- materialisation ------------------------ */
  const startLocation = worldReg.requireLocation(config.startLocationId);
  const startState = state.world.locations[config.startLocationId];
  if (startState) {
    startState.discovered = true;
    startState.lastVisitedDay = 0;
  }
  const materialised = materialiseLocation(state, config.startLocationId, { neighbours: true });
  // Neighbouring cities are visible on the map from day one so the arbitrage
  // scanner has something to work with.
  for (const { other } of worldReg.neighboursOf(config.startLocationId)) {
    const ls = state.world.locations[other.id];
    if (ls && !other.hidden) ls.discovered = true;
  }

  /* ------------------------------ contracts --------------------------- */
  const offers = rollMissionOffers(state, rng);

  /* ------------------------------- status ----------------------------- */
  setCounter(state, 'locations_visited', 1);
  setCounter(state, `visited:${config.startLocationId}`, 1);
  player.progression.milestones.push(`visited:${config.startLocationId}`);
  player.progression.milestones.push(`started:${seed}`);
  bumpCounter(state, 'games_started');
  setCounter(state, 'trade_volume', counter(state, 'trade_volume'));

  const worth = pushNetWorthSnapshot(state);

  pushNews(world, {
    scope: 'national',
    category: 'economy',
    headline: `${startLocation.countryName} opens the year with ${(world.inflationRate * 100).toFixed(1)}% inflation`,
    body: `The central bank holds its base rate at ${(world.interestRate * 100).toFixed(2)}% while the economy sits in ${world.indicators.cyclePhaseLabel}. Traders in ${startLocation.name} are watching ${startLocation.tradedCommodityIds.length} commodity lines.`,
    locationIds: [config.startLocationId],
    tags: ['economy', 'inflation', startLocation.countryId],
    importance: 3,
  });
  pushNews(world, {
    scope: 'global',
    category: 'market',
    headline: `Equity index at ${world.stockIndex.toFixed(0)}, crypto index at ${world.cryptoIndex.toFixed(0)}`,
    body: `Global risk appetite is ${(world.globalSentiment * 100).toFixed(0)}/100. ${companies} listed companies and ${cryptoAssets} digital assets are trading.`,
    locationIds: [],
    tags: ['stocks', 'crypto'],
    importance: 2,
  });

  pushNotification(state, {
    kind: 'info',
    title: `Welcome to ${startLocation.name}`,
    body: `You have ${formatMoney(worth.cash)} in cash, ${player.inventory.length} stack(s) of starting goods, ${player.stats.actionsToday} actions per day and ${offers.offered.length} contract offer(s). Prices differ between cities — that difference is your business model.`,
    link: '/game',
    metrics: [
      { label: 'Cash', value: formatMoney(worth.cash) },
      { label: 'Net worth', value: formatMoney(worth.total) },
      { label: 'Carrying capacity', value: `${B.logistics.personalCapacityKg} kg / ${B.logistics.personalCapacityLitres} L` },
      { label: 'Markets here', value: String(startLocation.tradedCommodityIds.length) },
    ],
  });

  pushDiagnostic(state, {
    system: 'bootstrap',
    level: 'info',
    message: `New game "${state.name}" (seed ${seed}, difficulty ${difficulty}): ${materialised.total} markets materialised, ${companies} companies, ${cryptoAssets} crypto assets, ${offers.offered.length} contract offers`,
    data: {
      seed,
      difficulty,
      markets: materialised.total,
      companies,
      cryptoAssets,
      offers: offers.offered.length,
      netWorth: round2(worth.total),
      registryCommodities: registry.count,
      registryLocations: worldReg.locationCount,
    },
  });

  const issues = validateState(state).map((i) => `${i.path}: ${i.message}`);
  const summary = registrySummary();

  return {
    state,
    seed,
    issues,
    summary,
    materialisedMarkets: materialised.total,
    companies,
    cryptoAssets,
    missionOffers: offers.offered.length,
  };
}

/** Compact projection used by the save-list UI. */
export interface GameListItem {
  gameId: ID;
  name: string;
  userId: ID;
  status: GameState['status'];
  day: number;
  level: number;
  title: string;
  netWorth: number;
  location: string;
  difficulty: Difficulty;
  version: number;
  updatedAt: string;
  schemaVersion: number;
}

export function gameListItem(state: GameState): GameListItem {
  const worth = state.player.netWorthHistory.length > 0 ? state.player.netWorthHistory[state.player.netWorthHistory.length - 1]!.total : 0;
  return {
    gameId: state.gameId,
    name: state.name,
    userId: state.userId,
    status: state.status,
    day: state.world.day,
    level: state.player.progression.level,
    title: state.player.progression.currentTitle,
    netWorth: round2(worth),
    location: worldReg.location(state.player.locationId)?.name ?? state.player.locationId,
    difficulty: state.config.difficulty,
    version: state.version,
    updatedAt: state.updatedAt,
    schemaVersion: state.schemaVersion,
  };
}
