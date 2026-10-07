/**
 * Game state factory, money primitives and integrity helpers.
 *
 * This module is the *only* place money moves. Every domain (trading, finance,
 * production, combat loot, missions, automation) calls `debitCash` / `creditCash`
 * rather than touching `BankAccount.balance` directly, which gives us:
 *
 *  - a single enforcement point for "never allow a negative balance"
 *    (spec §36: infinite money must be impossible),
 *  - a single place where the clean/dirty money split is respected,
 *  - an append-only, hash-chained transaction log for tamper evidence,
 *  - one implementation of net worth, so the UI, victory conditions and the
 *    exploit tests can never disagree about what the player owns.
 *
 * Nothing here trusts caller-supplied prices, quantities or outcomes: those are
 * computed by the domain modules from registry data and the seeded RNG.
 */

import { Rng } from '../engine/rng';
import { getBalance } from '../config/balance';
import { getCommodityRegistry } from '../engine/registry/commodities';
import { getWorldRegistry } from '../engine/registry/world';
import { HANDLES_A, HANDLES_B, SKILL_BY_ID } from '../engine/registry/people';
import { digestHex } from '../lib/hash';
import { fundamentalPrice, marketKey } from './economy';
import { buildModifiers, personalCapacityKgBonus, personalCapacityLBonus } from './modifiers';
import type {
  BankAccount,
  DiagnosticEntry,
  GameConfig,
  GameEnding,
  GameState,
  ID,
  ItemStack,
  LossCondition,
  NetWorthSnapshot,
  PlayerNotification,
  PlayerSettings,
  PlayerState,
  PlayerStats,
  PrisonState,
  ProgressionState,
  ReputationDimension,
  ReputationState,
  StorageUnit,
  TransactionChainState,
  TransactionRecord,
  UndergroundState,
  VictoryCondition,
} from './types';
import { orderedEntries, orderedKeys } from './ordering';

const B = getBalance();

/* ------------------------------------------------------------------ */
/* Ids                                                                 */
/* ------------------------------------------------------------------ */

/** Deterministic id generator. Ids are reproducible from the save seed. */
export function newId(rng: Rng, prefix: string): ID {
  return `${prefix}_${rng.int(1_000_000, 99_999_999).toString(36)}${rng.int(0, 1295).toString(36)}`;
}

/* ------------------------------------------------------------------ */
/* Difficulty and configuration                                        */
/* ------------------------------------------------------------------ */

export type Difficulty = GameConfig['difficulty'];

export const DIFFICULTY_MODIFIERS: Record<Difficulty, GameConfig['difficultyModifiers']> = {
  relaxed: {
    startingCashMultiplier: 2.0,
    priceVolatilityMultiplier: 0.7,
    enforcementMultiplier: 0.55,
    interestRateMultiplier: 0.8,
    eventSeverityMultiplier: 0.7,
    combatDifficultyMultiplier: 0.7,
    xpMultiplier: 1.35,
  },
  standard: {
    startingCashMultiplier: 1.0,
    priceVolatilityMultiplier: 1.0,
    enforcementMultiplier: 1.0,
    interestRateMultiplier: 1.0,
    eventSeverityMultiplier: 1.0,
    combatDifficultyMultiplier: 1.0,
    xpMultiplier: 1.0,
  },
  hardcore: {
    startingCashMultiplier: 0.55,
    priceVolatilityMultiplier: 1.35,
    enforcementMultiplier: 1.5,
    interestRateMultiplier: 1.25,
    eventSeverityMultiplier: 1.3,
    combatDifficultyMultiplier: 1.4,
    xpMultiplier: 1.2,
  },
  brutal: {
    startingCashMultiplier: 0.3,
    priceVolatilityMultiplier: 1.7,
    enforcementMultiplier: 2.1,
    interestRateMultiplier: 1.5,
    eventSeverityMultiplier: 1.6,
    combatDifficultyMultiplier: 1.9,
    xpMultiplier: 1.5,
  },
};

/**
 * Victory conditions are *plural and independent*: the spec forbids hard-locking
 * the player out of major systems, so no single path is required and reaching any
 * one of them wins the campaign (endless mode continues afterwards).
 */
export function createVictoryConditions(difficulty: Difficulty): VictoryCondition[] {
  const scale = difficulty === 'relaxed' ? 0.6 : difficulty === 'hardcore' ? 1.4 : difficulty === 'brutal' ? 2.2 : 1;
  return [
    {
      id: 'victory_net_worth',
      description: `Build a net worth of ${formatMoney(50_000_000 * scale)}.`,
      kind: 'net_worth',
      target: Math.round(50_000_000 * scale),
      achieved: false,
    },
    {
      id: 'victory_level',
      description: 'Reach level 40 and the title that comes with it.',
      kind: 'level',
      target: 40,
      achieved: false,
    },
    {
      id: 'victory_empire',
      description: 'Run an empire score of 80: properties, businesses, crew and automation combined.',
      kind: 'empire_score',
      target: 80,
      achieved: false,
    },
    {
      id: 'victory_survival',
      description: 'Survive and stay solvent for 1,000 days.',
      kind: 'days_survived',
      target: 1000,
      achieved: false,
    },
    {
      id: 'victory_monopoly',
      description: 'Control 45% of the supply of one commodity in three cities at once.',
      kind: 'monopoly',
      target: 0.45,
      achieved: false,
    },
  ];
}

export function createLossConditions(difficulty: Difficulty, permadeath: boolean): LossCondition[] {
  const out: LossCondition[] = [
    {
      id: 'loss_bankruptcy',
      description: 'Go bankrupt: net worth below the insolvency floor with no way to service debt.',
      kind: 'bankruptcy',
      threshold: B.finance.bankruptcyThreshold * (difficulty === 'relaxed' ? 2 : 1),
      triggered: false,
    },
    {
      id: 'loss_reputation',
      description: 'Lose every relationship that matters — reputation collapse across all dimensions.',
      kind: 'reputation_collapse',
      threshold: B.reputation.collapseThreshold,
      triggered: false,
    },
  ];
  if (permadeath) {
    out.push({
      id: 'loss_death',
      description: 'Die. In this campaign that is final.',
      kind: 'death',
      threshold: 0,
      triggered: false,
    });
  }
  out.push({
    id: 'loss_imprisonment',
    description: 'Receive a life-scale sentence with no route back to operations.',
    kind: 'imprisonment',
    threshold: 3650,
    triggered: false,
  });
  return out;
}

export interface GameConfigOptions {
  worldSeed: string;
  difficulty?: Difficulty;
  mode?: GameConfig['mode'];
  startLocationId?: ID;
  permadeath?: boolean;
  endless?: boolean;
  startDateLabel?: string;
}

export function createGameConfig(opts: GameConfigOptions): GameConfig {
  const difficulty = opts.difficulty ?? 'standard';
  return {
    mode: opts.mode ?? 'campaign',
    difficulty,
    difficultyModifiers: { ...DIFFICULTY_MODIFIERS[difficulty] },
    victoryConditions: createVictoryConditions(difficulty),
    lossConditions: createLossConditions(difficulty, opts.permadeath ?? false),
    startLocationId: opts.startLocationId ?? pickStartLocation(opts.worldSeed),
    worldSeed: opts.worldSeed,
    permadeath: opts.permadeath ?? false,
    endless: opts.endless ?? true,
    startDateLabel: opts.startDateLabel ?? 'Year One, Spring',
  };
}

/**
 * Chooses a beginner-friendly starting city: open, populous, legally permissive
 * enough to trade freely, well connected, and stocked with tradeable goods.
 * Deterministic per seed so a shared seed means a shared start.
 */
export function pickStartLocation(seed: string): ID {
  const world = getWorldRegistry();
  const registry = getCommodityRegistry();
  const rng = new Rng(`${seed}:start`, 'start-location');
  const candidates = world.locations
    .filter((l) => !l.hidden && l.kind === 'city')
    .map((l) => {
      const tradeable = l.tradedCommodityIds.filter((id) => {
        const c = registry.get(id);
        return c !== undefined && (c.legality === 'legal' || c.legality === 'restricted');
      }).length;
      const neighbours = world.neighboursOf(l.id).length;
      const score =
        tradeable * 1.0 +
        neighbours * 22 +
        Math.min(60, Math.log10(Math.max(1000, l.population)) * 9) +
        (1 - l.laws.enforcement) * 14 +
        l.infrastructure * 18 -
        l.laws.taxRate * 40 +
        rng.float(0, 12);
      return { id: l.id, score, tradeable, neighbours };
    })
    .filter((c) => c.tradeable >= 25 && c.neighbours >= 2)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.id ?? world.locations[0]!.id;
}

/* ------------------------------------------------------------------ */
/* Progression helpers                                                 */
/* ------------------------------------------------------------------ */

/** XP required to advance *from* `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  if (level < 1) return B.progression.xpBasePerLevel;
  return Math.round(B.progression.xpBasePerLevel * Math.pow(B.progression.xpGrowthPerLevel, level - 1));
}

export function titleForLevel(level: number): string {
  let title = B.progression.titleThresholds[0]?.title ?? 'Nobody';
  for (const t of B.progression.titleThresholds) {
    if (level >= t.level) title = t.title;
  }
  return title;
}

export function createProgression(): ProgressionState {
  return {
    level: 1,
    xp: 0,
    xpToNext: xpForLevel(1),
    totalXpEarned: 0,
    skillPoints: B.player.startingSkillPoints,
    perkPoints: 0,
    skills: {},
    perks: [],
    titles: [titleForLevel(1)],
    currentTitle: titleForLevel(1),
    specialisation: null,
    prestigeCount: 0,
    legacyBonus: 0,
    lastPrestigeDay: null,
    lastPrestigeNetWorth: 0,
    achievements: [],
    milestones: [],
    recentXp: [],
  };
}

export const REPUTATION_DIMENSIONS: ReputationDimension[] = [
  'global',
  'legal',
  'criminal',
  'business',
  'crew',
  'underground',
  'digital',
];

export function createReputation(): ReputationState {
  const dimensions = {} as Record<ReputationDimension, number>;
  for (const d of REPUTATION_DIMENSIONS) dimensions[d] = B.reputation.start;
  return {
    dimensions,
    regional: {},
    local: {},
    heat: 0,
    investigation: 0,
    investigationStartedDay: null,
    recentChanges: [],
  };
}

export function createUnderground(rng: Rng): UndergroundState {
  return {
    accessUnlocked: false,
    accessGrantedDay: null,
    digitalReputation: 0,
    handle: `${rng.pick(HANDLES_A)}_${rng.pick(HANDLES_B)}${rng.int(10, 99)}`,
    vendorRelationships: {},
    trustedVendors: [],
    escrowBalance: 0,
    traceHeat: 0,
    knownMarketIds: [],
    dataAssets: [],
    hackCooldownUntilDay: null,
    compromised: false,
    compromisedUntilDay: null,
    vpnQuality: 0.2,
    onChain: [],
    walletAddress: null,
    exchangeAccounts: [],
  };
}

export function createPrison(): PrisonState {
  return {
    incarcerated: false,
    incarceratedDay: null,
    releaseDay: null,
    facility: '',
    bailAmount: null,
    bailPaid: false,
    forfeitedCash: 0,
    forfeitedItems: 0,
    sentenceDays: 0,
    escapedDay: null,
    influence: 0,
  };
}

export function createStats(difficulty: Difficulty): PlayerStats {
  const healthBase = B.player.healthBase * (difficulty === 'brutal' ? 0.85 : 1);
  return {
    health: healthBase,
    maxHealth: healthBase,
    stamina: B.player.staminaBase,
    maxStamina: B.player.staminaBase,
    actionsToday: B.player.maxActionsPerDay,
    maxActionsPerDay: B.player.maxActionsPerDay,
    carriedKg: 0,
    carriedL: 0,
    totalTradesExecuted: 0,
    totalDistanceTravelledKm: 0,
    daysSurvived: 0,
    combatsWon: 0,
    combatsLost: 0,
    arrests: 0,
    biggestDealProfit: 0,
    netWorthPeak: 0,
    lastInjuryDay: null,
    counters: {},
  };
}

export function createSettings(): PlayerSettings {
  return {
    autoAdvanceConfirm: true,
    showAdvancedMarketData: true,
    compactTables: false,
    newsFilter: ['local', 'regional', 'national', 'global'],
    combatMode: 'ask',
    currencySymbol: '\u00A4',
    riskTolerance: 0.5,
    notificationsEnabled: true,
  };
}

/* ------------------------------------------------------------------ */
/* Player construction                                                 */
/* ------------------------------------------------------------------ */

export interface CreatePlayerOptions {
  rng: Rng;
  playerId: ID;
  name: string;
  day: number;
  locationId: ID;
  difficulty: Difficulty;
  /** Save identity — the transaction ledger checkpoint is keyed by it. */
  gameId: ID;
  userId: ID;
  worldSeed: string;
  /** Starting cash before the difficulty multiplier. */
  startingCash?: number;
}

export function createPrimaryAccount(rng: Rng, locationId: ID, day: number, balance: number): BankAccount {
  const world = getWorldRegistry();
  const loc = world.location(locationId);
  return {
    id: newId(rng, 'acct'),
    institution: loc ? `${loc.name} Community Bank` : 'Community Bank',
    kind: 'checking',
    locationId,
    balance: round2(balance),
    dirtyBalance: 0,
    currency: 'CR',
    apy: 0,
    openedDay: day,
    frozen: false,
    frozenUntilDay: null,
    freezeReason: null,
    dailyLimit: null,
    lastInterestDay: day,
  };
}

export function createPersonalStorage(rng: Rng, progression: ProgressionState, locationId: ID): StorageUnit {
  const mods = buildModifiers(progression);
  return {
    id: newId(rng, 'store'),
    kind: 'personal',
    name: 'On your person',
    locationId,
    propertyId: null,
    vehicleId: null,
    capacityKg: B.logistics.personalCapacityKg + personalCapacityKgBonus(mods),
    capacityL: B.logistics.personalCapacityLitres + personalCapacityLBonus(mods),
    security: 0.15,
    refrigerated: false,
    hiddenCompartmentKg: 0,
    costPerDay: 0,
    insured: false,
    insuredValue: 0,
  };
}

/**
 * A small starter position so the very first session can complete a full trade
 * loop: sell what you hold, travel, buy cheaper elsewhere.
 */
export function createStartingInventory(
  rng: Rng,
  locationId: ID,
  day: number,
  budget: number,
  storage: StorageUnit,
): ItemStack[] {
  const registry = getCommodityRegistry();
  const world = getWorldRegistry();
  const location = world.location(locationId);
  if (!location || budget <= 0) return [];

  /*
   * The starter position has to fit the container that carries it, on *both*
   * axes, and leave room to trade.
   *
   * It used to be capped by weight alone against the raw config constant, which
   * produced a brand-new player carrying 96 L in a 55 L backpack: an impossible
   * state that `validateState` did not catch and that made the very first
   * purchase fail with "no storage here can hold these goods". The limits now
   * come from the actual storage unit (so perk and skill bonuses count), a
   * configurable fraction of each axis is reserved for the player's first move,
   * and if nothing fits we hand back an empty position rather than an illegal one.
   */
  const fraction = B.player.startingInventoryCapacityFraction;
  const kgBudget = storage.capacityKg * fraction;
  const litreBudget = storage.capacityL * fraction;
  if (kgBudget <= 0 || litreBudget <= 0) return [];

  const candidates = location.tradedCommodityIds
    .map((id) => registry.get(id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .filter((c) => c.legality === 'legal')
    .filter((c) => !c.unlock)
    .filter((c) => c.baseValue > 2 && c.baseValue < 300)
    .filter((c) => c.weightKg <= 12 && c.volumeL <= 25)
    // A single unit has to fit inside the reserved budget, or there is no legal
    // starter position for this commodity at all.
    .filter((c) => c.weightKg <= kgBudget && c.volumeL <= litreBudget)
    /*
     * …and the container that carries it has to be *allowed* to carry it.
     *
     * Weight and volume are not the only constraints a stack is checked against:
     * cold-chain, secure, hazardous and climate-controlled goods each need a facility
     * the starter kit does not have. Handing a new player a crate of frozen shrimp
     * they cannot legally store — and therefore cannot buy more of, and cannot sell
     * without first buying a refrigerated unit — is a trap at the door. Anything the
     * personal storage cannot hold is simply not a candidate for the starting
     * position.
     */
    .filter((c) => {
      switch (c.storage) {
        case 'refrigerated':
          return storage.refrigerated;
        case 'secure':
          return storage.security >= 0.5;
        case 'hazardous':
          return storage.kind !== 'personal';
        case 'climate':
          return storage.refrigerated || storage.kind !== 'personal';
        default:
          return true;
      }
    })
    .sort((a, b) => b.baseDemand - a.baseDemand);

  if (candidates.length === 0) return [];
  const pick = candidates[rng.int(0, Math.min(6, candidates.length - 1))]!;

  // Three independent limits: what the budget buys, what the weight allows and
  // what the volume allows. The smallest wins, so the result always fits.
  const byBudget = Math.min(120, Math.floor(budget / Math.max(1, pick.baseValue)));
  const byWeight = Math.floor(kgBudget / Math.max(0.0001, pick.weightKg));
  const byVolume = Math.floor(litreBudget / Math.max(0.0001, pick.volumeL));
  const finalQty = Math.min(byBudget, byWeight, byVolume);
  if (!Number.isFinite(finalQty) || finalQty < 1) return [];

  return [
    {
      id: newId(rng, 'stack'),
      commodityId: pick.id,
      qty: finalQty,
      avgCost: round2(pick.baseValue * rng.float(0.86, 0.99)),
      acquiredDay: day,
      quality: round2(rng.float(0.62, 0.85)),
      expiresDay: pick.shelfLifeDays !== null ? day + Math.round(pick.shelfLifeDays * rng.float(0.5, 1)) : null,
      storageId: storage.id,
      concealed: false,
      origin: 'purchased',
      acquiredLocationId: locationId,
    },
  ];
}

export function createPlayer(opts: CreatePlayerOptions): PlayerState {
  const { rng, playerId, name, day, locationId, difficulty } = opts;
  const progression = createProgression();
  const startingCash = round2(
    (opts.startingCash ?? B.finance.startingCash) * DIFFICULTY_MODIFIERS[difficulty].startingCashMultiplier,
  );
  const account = createPrimaryAccount(rng, locationId, day, startingCash);
  const personal = createPersonalStorage(rng, progression, locationId);

  const inventory = createStartingInventory(
    rng,
    locationId,
    day,
    startingCash * B.player.startingInventoryValueFraction,
    personal,
  );

  return {
    id: playerId,
    name,
    createdDay: day,
    locationId,
    accounts: [account],
    loans: [],
    creditScore: B.finance.creditScore.start,
    creditHistory: [{ day, score: B.finance.creditScore.start, reason: 'Account opened' }],
    inventory,
    storages: [personal],
    vehicles: [],
    properties: [],
    businesses: [],
    productionLines: [],
    crew: [],
    hiringPool: [],
    hiringPoolRefreshDay: day,
    stockHoldings: [],
    cryptoHoldings: [],
    miningRigs: [],
    brokerageAccountId: null,
    underground: createUnderground(rng),
    progression,
    reputation: createReputation(),
    missions: [],
    missionOffers: [],
    missionRefreshDay: day,
    shipments: [],
    travel: null,
    combat: null,
    prison: createPrison(),
    automation: [],
    stats: createStats(difficulty),
    netWorthHistory: [],
    recentTransactions: [],
    transactionChain: createTransactionChain(opts.gameId, opts.userId, opts.worldSeed),
    notifications: [],
    settings: createSettings(),
  };
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function formatMoney(v: number, symbol = '\u00A4'): string {
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${sign}${symbol}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}${symbol}${(abs / 1_000).toFixed(1)}k`;
  return `${sign}${symbol}${abs.toFixed(2)}`;
}

export function isUsable(account: BankAccount, day: number): boolean {
  return !account.frozen && (account.frozenUntilDay === null || account.frozenUntilDay <= day);
}

/** Money that has been laundered / earned legally and can be spent openly. */
export function cleanBalance(player: PlayerState): number {
  return round2(player.accounts.reduce((sum, a) => sum + Math.max(0, a.balance - a.dirtyBalance), 0));
}

/** Unlaundered money: spendable, but spending it raises heat. */
export function dirtyBalance(player: PlayerState): number {
  return round2(player.accounts.reduce((sum, a) => sum + Math.max(0, a.dirtyBalance), 0));
}

export function totalBalance(player: PlayerState): number {
  return round2(player.accounts.reduce((sum, a) => sum + a.balance, 0));
}

export function spendable(player: PlayerState, day: number, allowDirty: boolean): number {
  return round2(
    player.accounts
      .filter((a) => isUsable(a, day))
      .reduce((sum, a) => sum + (allowDirty ? a.balance : Math.max(0, a.balance - a.dirtyBalance)), 0),
  );
}

export interface MoneyOptions {
  /** Restrict the move to one account. */
  accountId?: ID;
  /** Allow spending/creating unlaundered money (illegal economies). */
  allowDirty?: boolean;
  /** Mark credited money as dirty. */
  dirty?: boolean;
  day?: number;
  turn?: number;
  kind: TransactionRecord['kind'];
  description: string;
  counterparty?: string | null;
  commodityId?: ID | null;
  qty?: number | null;
  unitPrice?: number | null;
  locationId?: ID | null;
  meta?: Record<string, string | number | boolean | null>;
}

export interface MoneyMoveResult {
  ok: boolean;
  amount: number;
  cleanUsed: number;
  dirtyUsed: number;
  accountId: ID | null;
  /** Per-account breakdown so the UI can show exactly where money moved. */
  legs: { accountId: ID; amount: number; clean: number; dirty: number }[];
  reason?: string;
  transaction: TransactionRecord | null;
}

const FAILED_MOVE: MoneyMoveResult = {
  ok: false,
  amount: 0,
  cleanUsed: 0,
  dirtyUsed: 0,
  accountId: null,
  legs: [],
  transaction: null,
};

function failed(reason: string): MoneyMoveResult {
  return { ...FAILED_MOVE, reason };
}

/**
 * Remove money from the player's accounts.
 *
 * Hard invariants, enforced here and nowhere else:
 *  - the amount must be finite and strictly positive,
 *  - no account balance may go negative,
 *  - no account's dirty balance may exceed its balance,
 *  - frozen accounts cannot be debited,
 *  - a daily withdrawal limit, when set, is respected.
 *
 * On failure nothing is mutated (the check pass runs before the apply pass).
 */
export function debitCash(state: GameState, amount: number, opts: MoneyOptions): MoneyMoveResult {
  if (!Number.isFinite(amount) || amount <= 0) return failed('invalid_amount');
  const day = opts.day ?? state.world.day;
  const allowDirty = opts.allowDirty ?? false;
  const rounded = round2(amount);

  const accounts = state.player.accounts.filter(
    (a) => isUsable(a, day) && (opts.accountId === undefined || a.id === opts.accountId),
  );
  if (accounts.length === 0) return failed(opts.accountId ? 'account_unavailable' : 'insufficient_funds');

  const available = accounts.reduce(
    (sum, a) => sum + (allowDirty ? a.balance : Math.max(0, a.balance - a.dirtyBalance)),
    0,
  );
  if (available + 1e-9 < rounded) return failed('insufficient_funds');

  // Plan the legs (clean first: spending clean money never attracts attention).
  let remaining = rounded;
  const legs: MoneyMoveResult['legs'] = [];
  for (const a of accounts) {
    if (remaining <= 1e-9) break;
    const clean = Math.max(0, a.balance - a.dirtyBalance);
    const takeClean = Math.min(clean, remaining);
    remaining = round2(remaining - takeClean);
    let takeDirty = 0;
    if (remaining > 1e-9 && allowDirty) {
      takeDirty = Math.min(a.dirtyBalance, remaining);
      remaining = round2(remaining - takeDirty);
    }
    if (takeClean > 0 || takeDirty > 0) {
      legs.push({ accountId: a.id, amount: round2(takeClean + takeDirty), clean: takeClean, dirty: takeDirty });
    }
  }
  if (remaining > 1e-9) return failed('insufficient_funds');

  // Daily limit check (applies to the whole move, per account).
  for (const leg of legs) {
    const account = state.player.accounts.find((a) => a.id === leg.accountId);
    if (!account || account.dailyLimit === null) continue;
    const alreadyToday = state.player.recentTransactions
      .filter((t) => t.day === day && t.accountId === account.id && t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    if (alreadyToday + leg.amount > account.dailyLimit + 1e-9) return failed('daily_limit_exceeded');
  }

  // Apply.
  let cleanUsed = 0;
  let dirtyUsed = 0;
  for (const leg of legs) {
    const account = state.player.accounts.find((a) => a.id === leg.accountId)!;
    account.balance = round2(account.balance - leg.amount);
    account.dirtyBalance = round2(Math.max(0, Math.min(account.balance, account.dirtyBalance - leg.dirty)));
    cleanUsed += leg.clean;
    dirtyUsed += leg.dirty;
    if (account.balance < -1e-9) {
      // Should be unreachable; roll back defensively rather than persist a
      // negative balance (an infinite-money exploit would look exactly like this).
      account.balance = round2(account.balance + leg.amount);
      account.dirtyBalance = round2(account.dirtyBalance + leg.dirty);
      return failed('internal_error_negative_balance');
    }
  }

  const primary = legs[0]?.accountId ?? null;
  const account = state.player.accounts.find((a) => a.id === primary);
  const tx = recordTransaction(state, {
    day,
    turn: opts.turn ?? state.turn,
    kind: opts.kind,
    amount: -rounded,
    balanceAfter: account ? account.balance : 0,
    accountId: primary,
    description: opts.description,
    counterparty: opts.counterparty ?? null,
    commodityId: opts.commodityId ?? null,
    qty: opts.qty ?? null,
    unitPrice: opts.unitPrice ?? null,
    locationId: opts.locationId ?? state.player.locationId,
    meta: opts.meta,
  });

  return {
    ok: true,
    amount: rounded,
    cleanUsed: round2(cleanUsed),
    dirtyUsed: round2(dirtyUsed),
    accountId: primary,
    legs,
    transaction: tx,
  };
}

/** Add money to the player's accounts. */
export function creditCash(state: GameState, amount: number, opts: MoneyOptions): MoneyMoveResult {
  if (!Number.isFinite(amount) || amount <= 0) return failed('invalid_amount');
  const day = opts.day ?? state.world.day;
  const rounded = round2(amount);

  const candidates = state.player.accounts.filter(
    (a) => isUsable(a, day) && (opts.accountId === undefined || a.id === opts.accountId),
  );
  if (candidates.length === 0) return failed('account_unavailable');

  // Default target: the account with the largest balance (keeps money together),
  // preferring a clean account when the credit is clean.
  const target =
    candidates
      .slice()
      .sort((a, b) => {
        const dirtyA = opts.dirty ? 0 : a.dirtyBalance > 0 ? 1 : 0;
        const dirtyB = opts.dirty ? 0 : b.dirtyBalance > 0 ? 1 : 0;
        if (dirtyA !== dirtyB) return dirtyA - dirtyB;
        return b.balance - a.balance;
      })[0] ?? candidates[0]!;

  target.balance = round2(target.balance + rounded);
  if (opts.dirty) target.dirtyBalance = round2(Math.min(target.balance, target.dirtyBalance + rounded));

  const tx = recordTransaction(state, {
    day,
    turn: opts.turn ?? state.turn,
    kind: opts.kind,
    amount: rounded,
    balanceAfter: target.balance,
    accountId: target.id,
    description: opts.description,
    counterparty: opts.counterparty ?? null,
    commodityId: opts.commodityId ?? null,
    qty: opts.qty ?? null,
    unitPrice: opts.unitPrice ?? null,
    locationId: opts.locationId ?? state.player.locationId,
    meta: opts.meta,
  });

  return {
    ok: true,
    amount: rounded,
    cleanUsed: opts.dirty ? 0 : rounded,
    dirtyUsed: opts.dirty ? rounded : 0,
    accountId: target.id,
    legs: [{ accountId: target.id, amount: rounded, clean: opts.dirty ? 0 : rounded, dirty: opts.dirty ? rounded : 0 }],
    transaction: tx,
  };
}

/** Move money between two of the player's own accounts (e.g. laundering sweep). */
export function transferCash(
  state: GameState,
  fromId: ID,
  toId: ID,
  amount: number,
  opts: { day?: number; turn?: number; dirty?: boolean; description: string; fee?: number },
): MoneyMoveResult {
  const day = opts.day ?? state.world.day;
  const from = state.player.accounts.find((a) => a.id === fromId);
  const to = state.player.accounts.find((a) => a.id === toId);
  if (!from || !to) return failed('account_not_found');
  if (fromId === toId) return failed('same_account');
  if (!isUsable(from, day)) return failed('account_frozen');
  if (!Number.isFinite(amount) || amount <= 0) return failed('invalid_amount');
  const rounded = round2(amount);
  const available = opts.dirty ? from.balance : Math.max(0, from.balance - from.dirtyBalance);
  if (available + 1e-9 < rounded) return failed('insufficient_funds');

  const fee = round2(Math.max(0, opts.fee ?? 0));
  if (available + 1e-9 < rounded + fee) return failed('insufficient_funds_for_fee');

  from.balance = round2(from.balance - rounded - fee);
  const movedDirty = opts.dirty ? Math.min(from.dirtyBalance, rounded) : 0;
  from.dirtyBalance = round2(Math.max(0, from.dirtyBalance - movedDirty));
  to.balance = round2(to.balance + rounded);
  if (movedDirty > 0) to.dirtyBalance = round2(Math.min(to.balance, to.dirtyBalance + movedDirty));

  const tx = recordTransaction(state, {
    day,
    turn: opts.turn ?? state.turn,
    kind: 'transfer',
    amount: -rounded - fee,
    balanceAfter: from.balance,
    accountId: from.id,
    description: opts.description,
    counterparty: to.institution,
    commodityId: null,
    qty: null,
    unitPrice: null,
    locationId: to.locationId,
    meta: { toAccountId: to.id, fee, dirty: movedDirty > 0 },
  });

  return {
    ok: true,
    amount: rounded,
    cleanUsed: round2(rounded - movedDirty),
    dirtyUsed: round2(movedDirty),
    accountId: from.id,
    legs: [
      { accountId: from.id, amount: -rounded - fee, clean: rounded - movedDirty, dirty: movedDirty },
      { accountId: to.id, amount: rounded, clean: rounded - movedDirty, dirty: movedDirty },
    ],
    transaction: tx,
  };
}

/* ------------------------------------------------------------------ */
/* Transaction log                                                     */
/* ------------------------------------------------------------------ */

export interface TransactionInput {
  day: number;
  turn: number;
  kind: TransactionRecord['kind'];
  amount: number;
  balanceAfter: number;
  accountId: ID | null;
  description: string;
  counterparty?: string | null;
  commodityId?: ID | null;
  qty?: number | null;
  unitPrice?: number | null;
  locationId?: ID | null;
  meta?: Record<string, string | number | boolean | null>;
}

/**
 * The canonical string a ledger record's hash is computed over.
 *
 * Shared by `recordTransaction` and `verifyTransactionChain` so the two can never
 * drift apart — a verifier that hashed a different field list would reject every
 * honest save. Field order and formatting are part of the on-disk contract:
 * changing them is a schema migration, not an edit.
 */
function transactionPayload(
  prevHash: string,
  seq: number,
  t: {
    day: number;
    turn: number;
    kind: TransactionRecord['kind'];
    amount: number;
    balanceAfter: number;
    accountId: ID | null;
    description: string;
    counterparty?: string | null;
    commodityId?: ID | null;
    qty?: number | null;
    unitPrice?: number | null;
    locationId?: ID | null;
  },
): string {
  return [
    prevHash,
    seq,
    t.day,
    t.turn,
    t.kind,
    t.amount.toFixed(2),
    t.balanceAfter.toFixed(2),
    t.accountId ?? '-',
    t.description,
    t.counterparty ?? '-',
    t.commodityId ?? '-',
    t.qty ?? '-',
    t.unitPrice ?? '-',
    t.locationId ?? '-',
  ].join('|');
}

/**
 * Per-save domain separator for the ledger.
 *
 * Derived from the save's own identity, so a checkpoint lifted out of one game
 * can never excuse a broken chain in another. It is not a secret — the ledger is
 * an integrity check, and the authoritative protections remain the sealed save
 * document, server-only writes and per-owner scoping in the store.
 */
export function transactionChainSalt(gameId: ID, userId: ID, worldSeed: string): string {
  return digestHex(`dynasty:ledger|${gameId}|${userId}|${worldSeed}`);
}

/** What the first record ever written to a ledger links back to. */
export function genesisAnchor(salt: string): string {
  return digestHex(`${salt}|genesis`);
}

/** Digest committing to the eviction checkpoint itself. */
export function chainAnchorHash(salt: string, evictedCount: number, headPrevHash: string): string {
  return digestHex(`${salt}|evicted:${evictedCount}|head:${headPrevHash}`);
}

/** A brand-new, empty ledger checkpoint. */
export function createTransactionChain(gameId: ID, userId: ID, worldSeed: string): TransactionChainState {
  const salt = transactionChainSalt(gameId, userId, worldSeed);
  const headPrevHash = genesisAnchor(salt);
  return {
    salt,
    evictedCount: 0,
    headPrevHash,
    anchorHash: chainAnchorHash(salt, 0, headPrevHash),
    reanchoredFromSchema: null,
  };
}

/**
 * The checkpoint for a state, creating it if the state predates the field.
 *
 * Ledger writes must never fail because an older in-memory state lacks the block,
 * so it is materialised on demand from the save's identity rather than throwing.
 */
export function requireTransactionChain(state: GameState): TransactionChainState {
  const player = state.player as PlayerState & { transactionChain?: TransactionChainState | null };
  if (!player.transactionChain) {
    player.transactionChain = createTransactionChain(state.gameId, state.userId, state.config.worldSeed);
  }
  return player.transactionChain;
}

/**
 * Re-anchor a ledger written by an older schema onto the current one.
 *
 * The old scheme linked record *i* to `transactions[i-1].integrityHash` with a
 * literal `'genesis'` fallback, and stored neither the link nor a sequence number,
 * so once the ring buffer evicted its oldest entry the retained chain could not be
 * verified at all. This rebuilds the chain from the records that survive:
 *
 *  - every retained record is first checked against the **old** rule, so a save
 *    whose history was genuinely edited is still rejected rather than laundered;
 *  - surviving records are then re-sequenced from 1 and re-hashed under the new
 *    rule, and the checkpoint is anchored to a fresh genesis;
 *  - `reanchoredFromSchema` records that pre-migration evictions are no longer
 *    provable, instead of quietly claiming a guarantee we do not have.
 *
 * Returns `null` when the legacy chain does not verify, with the offending index.
 */
export function adoptLegacyTransactionLedger(
  state: GameState,
  fromSchema: number,
): { ok: true; adopted: number } | { ok: false; brokenAtIndex: number } {
  const history = state.player.recentTransactions;

  for (let i = 0; i < history.length; i++) {
    const t = history[i]!;
    const legacyPrev = i === 0 ? 'genesis' : history[i - 1]!.integrityHash;
    const legacyPayload = [
      legacyPrev,
      t.day,
      t.turn,
      t.kind,
      t.amount.toFixed(2),
      t.balanceAfter.toFixed(2),
      t.accountId ?? '-',
      t.description,
      t.counterparty ?? '-',
      t.commodityId ?? '-',
      t.qty ?? '-',
      t.unitPrice ?? '-',
      t.locationId ?? '-',
    ].join('|');
    if (digestHex(legacyPayload) !== t.integrityHash) return { ok: false, brokenAtIndex: i };
  }

  const chain = createTransactionChain(state.gameId, state.userId, state.config.worldSeed);
  chain.reanchoredFromSchema = fromSchema;

  let prevHash = chain.headPrevHash;
  history.forEach((t, i) => {
    const seq = i + 1;
    const payload = transactionPayload(prevHash, seq, t);
    const integrityHash = digestHex(payload);
    t.prevHash = prevHash;
    t.seq = seq;
    t.integrityHash = integrityHash;
    // `id` is not part of the hashed payload, so it is safe to make it unique:
    // the legacy scheme numbered records by array position and started repeating
    // ids as soon as the buffer filled.
    t.id = `tx_${seq}_${integrityHash.slice(0, 8)}`;
    prevHash = integrityHash;
  });

  chain.evictedCount = 0;
  chain.anchorHash = chainAnchorHash(chain.salt, chain.evictedCount, chain.headPrevHash);
  state.player.transactionChain = chain;
  return { ok: true, adopted: history.length };
}

/**
 * Append a transaction with an integrity hash chained to the previous entry.
 * A client that edits an amount in a save file breaks every following hash,
 * which the server detects on load.
 */
export function recordTransaction(state: GameState, input: TransactionInput): TransactionRecord {
  const chain = requireTransactionChain(state);
  const history = state.player.recentTransactions;
  const prev = history[history.length - 1];
  const prevHash = prev ? prev.integrityHash : chain.headPrevHash;
  const seq = chain.evictedCount + history.length + 1;

  const payload = transactionPayload(prevHash, seq, input);
  const integrityHash = digestHex(payload);

  const tx: TransactionRecord = {
    id: `tx_${seq}_${integrityHash.slice(0, 8)}`,
    day: input.day,
    turn: input.turn,
    kind: input.kind,
    amount: round2(input.amount),
    balanceAfter: round2(input.balanceAfter),
    accountId: input.accountId,
    description: input.description,
    counterparty: input.counterparty ?? null,
    commodityId: input.commodityId ?? null,
    qty: input.qty ?? null,
    unitPrice: input.unitPrice ?? null,
    locationId: input.locationId ?? null,
    integrityHash,
    prevHash,
    seq,
    meta: input.meta ?? {},
  };

  history.push(tx);
  trimTransactionHistory(state);
  return tx;
}

/**
 * Enforce the transaction retention limit.
 *
 * This is the *only* place ledger records are evicted. Every eviction moves the
 * checkpoint forward, so the first retained record always has a `prevHash` the
 * verifier can check against. Evicting anywhere else (a second `splice` in a
 * housekeeping pass, say) silently invalidates the whole retained chain — which
 * is exactly how a full history used to make a valid save permanently unloadable.
 */
export function trimTransactionHistory(state: GameState): void {
  const chain = requireTransactionChain(state);
  const history = state.player.recentTransactions;
  const keep = B.player.transactionHistoryLength;
  if (history.length <= keep) return;

  const drop = history.length - keep;
  const evicted = history.splice(0, drop);
  const lastEvicted = evicted[evicted.length - 1];
  if (!lastEvicted) return;

  chain.evictedCount += drop;
  chain.headPrevHash = lastEvicted.integrityHash;
  chain.anchorHash = chainAnchorHash(chain.salt, chain.evictedCount, chain.headPrevHash);
}

export interface ChainVerification {
  ok: boolean;
  /** Index of the first offending retained record, or -1. */
  brokenAtIndex: number;
  /** `seq` of the offending record when one could be identified, else null. */
  brokenAtSeq: number | null;
  reason: string | null;
}

const CHAIN_OK: ChainVerification = { ok: true, brokenAtIndex: -1, brokenAtSeq: null, reason: null };

function chainFailure(index: number, seq: number | null, reason: string): ChainVerification {
  return { ok: false, brokenAtIndex: index, brokenAtSeq: seq, reason };
}

/**
 * Verify the retained ledger against its eviction checkpoint.
 *
 * Three properties are checked, because one is not enough:
 *
 *  1. **Self-consistency** — each record's `integrityHash` still matches a digest
 *     of its own fields *and* its own `prevHash`, so an edited amount, day, kind
 *     or link is caught.
 *  2. **Continuity** — record *i* must link to record *i−1* and continue its `seq`
 *     by exactly one, so reordering, deletion and duplication are caught.
 *  3. **Anchoring** — the first retained record must link to the checkpoint, and
 *     the checkpoint must match its own digest, so dropping the oldest entries
 *     (legitimate) is distinguishable from rewriting history (not).
 *
 * The reason strings name the failure without echoing balances, counterparties or
 * descriptions, so they are safe to log and to return to a client.
 */
export function verifyTransactionChain(
  transactions: TransactionRecord[],
  chain: TransactionChainState | null | undefined,
): ChainVerification {
  if (!chain) {
    return transactions.length === 0
      ? CHAIN_OK
      : chainFailure(0, transactions[0]?.seq ?? null, 'The ledger has records but no eviction checkpoint.');
  }

  const expectedAnchor = chainAnchorHash(chain.salt, chain.evictedCount, chain.headPrevHash);
  if (expectedAnchor !== chain.anchorHash) {
    return chainFailure(-1, null, 'The transaction checkpoint does not match its own digest.');
  }
  if (!Number.isInteger(chain.evictedCount) || chain.evictedCount < 0) {
    return chainFailure(-1, null, 'The transaction checkpoint has an impossible eviction count.');
  }

  if (transactions.length === 0) {
    // An empty retained ledger is legal only when nothing has ever been evicted;
    // otherwise records were deleted wholesale rather than aged out.
    return chain.evictedCount === 0
      ? CHAIN_OK
      : chainFailure(-1, null, 'The ledger is empty but records were evicted from it.');
  }

  for (let i = 0; i < transactions.length; i++) {
    const t = transactions[i]!;

    if (!Number.isInteger(t.seq) || t.seq < 1) {
      return chainFailure(i, t.seq ?? null, 'A ledger record has no valid sequence number.');
    }
    const expectedSeq = chain.evictedCount + i + 1;
    if (t.seq !== expectedSeq) {
      return chainFailure(i, t.seq, `Ledger sequence is discontinuous: expected ${expectedSeq}, found ${t.seq}.`);
    }

    const expectedPrev = i === 0 ? chain.headPrevHash : transactions[i - 1]!.integrityHash;
    if (t.prevHash !== expectedPrev) {
      return chainFailure(i, t.seq, 'A ledger record does not link to the record before it.');
    }

    if (digestHex(transactionPayload(t.prevHash, t.seq, t)) !== t.integrityHash) {
      return chainFailure(i, t.seq, 'A ledger record no longer matches its own integrity hash.');
    }
  }

  return CHAIN_OK;
}

/* ------------------------------------------------------------------ */
/* Valuation                                                           */
/* ------------------------------------------------------------------ */

export interface PriceQuote {
  price: number;
  /** Where the price came from — shown in the UI so values are explainable. */
  source: 'materialised_market' | 'fundamental_estimate';
  locationId: ID;
}

/**
 * Best available unit price for a commodity at a location.
 *
 * Uses the materialised market when one exists (the player or an actor has
 * traded there) and otherwise falls back to the deterministic fundamental —
 * which is exactly the price the market would open at if materialised. This is
 * what makes the lazy-materialisation strategy invisible to gameplay.
 */
export function priceAt(state: GameState, locationId: ID, commodityId: ID): PriceQuote | null {
  const registry = getCommodityRegistry();
  const worldReg = getWorldRegistry();
  const commodity = registry.get(commodityId);
  const location = worldReg.location(locationId);
  if (!commodity || !location) return null;

  const key = marketKey(locationId, commodityId);
  const market = state.markets[key];
  if (market) return { price: market.price, source: 'materialised_market', locationId };

  const price = fundamentalPrice({
    location,
    locationState: state.world.locations[locationId],
    commodity,
    world: state.world,
    day: state.world.day,
  });
  return { price: round2(price), source: 'fundamental_estimate', locationId };
}

/** Sale-side value of a stack, including quality adjustment. */
export function stackValue(state: GameState, stack: ItemStack, locationId?: ID): number {
  const registry = getCommodityRegistry();
  const commodity = registry.get(stack.commodityId);
  if (!commodity) return 0;
  const quote = priceAt(state, locationId ?? state.player.locationId, stack.commodityId);
  if (!quote) return 0;
  const qualityFactor = 0.72 + stack.quality * 0.4;
  const spoiled = stack.expiresDay !== null && state.world.day > stack.expiresDay ? 0.05 : 1;
  return round2(quote.price * stack.qty * qualityFactor * spoiled);
}

export function inventoryValue(state: GameState, locationId?: ID): number {
  return round2(state.player.inventory.reduce((sum, s) => sum + stackValue(state, s, locationId), 0));
}

export function debtTotal(player: PlayerState): number {
  return round2(
    player.loans
      .filter((l) => l.status === 'active' || l.status === 'defaulted')
      .reduce((sum, l) => sum + Math.max(0, l.balance), 0),
  );
}

export interface NetWorthBreakdown extends NetWorthSnapshot {
  escrow: number;
  cashDirty: number;
}

/**
 * Single source of truth for net worth. Every valuation uses *current* market
 * prices, not purchase prices, so a crash genuinely destroys wealth and the
 * victory/loss conditions cannot be gamed by holding stale cost basis.
 */
export function computeNetWorth(state: GameState): NetWorthBreakdown {
  const player = state.player;
  const day = state.world.day;
  const locationId = player.locationId;

  const cash = totalBalance(player);
  const inventory = inventoryValue(state, locationId);

  const properties = round2(player.properties.reduce((sum, p) => sum + Math.max(0, p.valuation), 0));

  const businesses = round2(
    player.businesses.reduce((sum, b) => {
      // A going concern is worth its cashbox plus a multiple of daily profit.
      const multiple = b.profit30d > 0 ? 180 : 60;
      return sum + Math.max(0, b.cashbox) + Math.max(0, b.profit30d / 30) * multiple;
    }, 0),
  );

  const vehicles = round2(
    player.vehicles.reduce((sum, v) => {
      const ageDays = Math.max(0, day - v.purchasedDay);
      const depreciation = Math.pow(0.9995, ageDays);
      const condition = Math.max(0.15, v.condition - v.damage);
      return sum + Math.max(0, v.purchasePrice * depreciation * condition);
    }, 0),
  );

  const stocks = round2(
    player.stockHoldings.reduce((sum, h) => {
      const company = state.world.companies[h.companyId];
      const price = company?.price ?? h.avgCost;
      return sum + Math.max(0, h.shares * price);
    }, 0),
  );

  const crypto = round2(
    player.cryptoHoldings.reduce((sum, h) => {
      const asset = state.world.cryptoAssets[h.assetId];
      const price = asset?.price ?? h.avgCost;
      return sum + Math.max(0, h.amount * price);
    }, 0),
  );

  const miningRigs = round2(
    player.miningRigs.reduce((sum, r) => sum + Math.max(0, 2400 * r.hashRate * Math.max(0.1, r.condition)), 0),
  );

  const productionLines = round2(
    player.productionLines.reduce((sum, l) => {
      const buffered = orderedEntries(l.outputs).reduce((acc, [id, qty]) => {
        const quote = priceAt(state, l.locationId, id);
        return acc + (quote ? quote.price * qty : 0);
      }, 0);
      const inputs = orderedEntries(l.inputs).reduce((acc, [id, qty]) => {
        const quote = priceAt(state, l.locationId, id);
        return acc + (quote ? quote.price * qty : 0);
      }, 0);
      return sum + buffered + inputs;
    }, 0),
  );

  const dataAssets = round2(
    player.underground.dataAssets.reduce((sum, d) => (d.sold ? sum : sum + d.baseValue * d.freshness), 0),
  );

  const debts = debtTotal(player);
  const total = round2(
    cash + inventory + properties + businesses + vehicles + stocks + crypto + miningRigs +
      productionLines + dataAssets + player.underground.escrowBalance - debts,
  );

  return {
    day,
    total,
    cash,
    inventory,
    properties: round2(properties + businesses),
    businesses: round2(businesses),
    vehicles: round2(vehicles + miningRigs),
    stocks,
    crypto,
    debts,
    escrow: round2(player.underground.escrowBalance),
    cashDirty: dirtyBalance(player),
  };
}

export function pushNetWorthSnapshot(state: GameState): NetWorthBreakdown {
  const snapshot = computeNetWorth(state);
  state.player.netWorthHistory.push(snapshot);
  if (state.player.netWorthHistory.length > B.player.netWorthHistoryLength) {
    state.player.netWorthHistory.splice(0, state.player.netWorthHistory.length - B.player.netWorthHistoryLength);
  }
  if (snapshot.total > state.player.stats.netWorthPeak) state.player.stats.netWorthPeak = snapshot.total;
  return snapshot;
}

/* ------------------------------------------------------------------ */
/* Notifications and diagnostics                                       */
/* ------------------------------------------------------------------ */

export function pushNotification(
  state: GameState,
  n: Omit<PlayerNotification, 'id' | 'day' | 'read'> & { id?: ID; day?: number },
): PlayerNotification {
  const notification: PlayerNotification = {
    id: n.id ?? `ntf_${state.world.day}_${state.player.notifications.length}_${digestHex(n.title + n.body).slice(0, 6)}`,
    day: n.day ?? state.world.day,
    kind: n.kind,
    title: n.title,
    body: n.body,
    read: false,
    link: n.link ?? null,
    ...(n.metrics ? { metrics: n.metrics } : {}),
  };
  state.player.notifications.unshift(notification);
  if (state.player.notifications.length > B.player.notificationHistoryLength) {
    state.player.notifications.length = B.player.notificationHistoryLength;
  }
  return notification;
}

export function pushDiagnostic(
  state: GameState,
  d: Omit<DiagnosticEntry, 'day' | 'turn'> & { day?: number; turn?: number },
): DiagnosticEntry {
  const entry: DiagnosticEntry = {
    day: d.day ?? state.world.day,
    turn: d.turn ?? state.turn,
    system: d.system,
    message: d.message,
    level: d.level,
    ...(d.data ? { data: d.data } : {}),
  };
  state.diagnostics.push(entry);
  if (state.diagnostics.length > B.player.diagnosticHistoryLength) {
    state.diagnostics.splice(0, state.diagnostics.length - B.player.diagnosticHistoryLength);
  }
  return entry;
}

/* ------------------------------------------------------------------ */
/* Actions / stamina                                                   */
/* ------------------------------------------------------------------ */

export function consumeAction(state: GameState, cost = 1, staminaCost = B.player.staminaPerAction): boolean {
  const stats = state.player.stats;
  if (stats.actionsToday < cost) return false;
  stats.actionsToday -= cost;
  stats.stamina = Math.max(0, round2(stats.stamina - staminaCost * cost));
  return true;
}

export function hasActions(state: GameState, cost = 1): boolean {
  return state.player.stats.actionsToday >= cost;
}

/* ------------------------------------------------------------------ */
/* Clone / validate                                                    */
/* ------------------------------------------------------------------ */

/** Deep clone used for simulation previews and "what if" UI panels. */
export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Structural validation run on every load and before every save.
 *
 * Catches the failure modes that would otherwise silently corrupt a long
 * campaign: negative money, negative inventory, impossible days, broken
 * transaction chains, unknown ids, and schema drift.
 */
export function validateState(state: GameState): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (path: string, message: string): void => {
    issues.push({ path, message, severity: 'error' });
  };
  const warn = (path: string, message: string): void => {
    issues.push({ path, message, severity: 'warning' });
  };

  if (state.schemaVersion !== B.saves.schemaVersion) {
    warn('schemaVersion', `expected ${B.saves.schemaVersion}, found ${state.schemaVersion}`);
  }
  if (!Number.isInteger(state.world.day) || state.world.day < 0) err('world.day', 'must be a non-negative integer');
  if (state.lastTickDay > state.world.day) err('lastTickDay', 'ahead of world.day');
  if (state.version < 0) err('version', 'negative save version');

  const registry = getCommodityRegistry();
  const worldReg = getWorldRegistry();

  if (!worldReg.location(state.player.locationId)) {
    err('player.locationId', `unknown location ${state.player.locationId}`);
  }

  for (const account of state.player.accounts) {
    if (!Number.isFinite(account.balance)) err(`accounts.${account.id}.balance`, 'not finite');
    else if (account.balance < -1e-6) err(`accounts.${account.id}.balance`, `negative balance ${account.balance}`);
    if (account.dirtyBalance < -1e-6) err(`accounts.${account.id}.dirtyBalance`, 'negative dirty balance');
    if (account.dirtyBalance > account.balance + 1e-6) {
      err(`accounts.${account.id}.dirtyBalance`, 'dirty balance exceeds total balance');
    }
  }

  for (const stack of state.player.inventory) {
    if (!registry.has(stack.commodityId)) err(`inventory.${stack.id}.commodityId`, `unknown commodity ${stack.commodityId}`);
    if (!Number.isFinite(stack.qty) || stack.qty < 0) err(`inventory.${stack.id}.qty`, `invalid qty ${stack.qty}`);
    if (!Number.isFinite(stack.avgCost) || stack.avgCost < 0) err(`inventory.${stack.id}.avgCost`, 'invalid cost');
    if (!state.player.storages.some((s) => s.id === stack.storageId)) {
      err(`inventory.${stack.id}.storageId`, `points at missing storage ${stack.storageId}`);
    }
  }

  for (const storage of state.player.storages) {
    if (storage.capacityKg < 0 || storage.capacityL < 0) err(`storages.${storage.id}`, 'negative capacity');

    /*
     * Contents must fit the unit that holds them.
     *
     * Every insertion path (`addItem`, `moveItem`, `setConcealed`) is gated by
     * `inventory.canStore`, so an over-full unit means something bypassed that
     * gate — the starting-inventory factory used to, which left a brand-new
     * player carrying 96 L in a 55 L backpack and unable to buy anything.
     * The arithmetic below deliberately mirrors `canStore`/`capacityOf`
     * (same per-stack rounding, same concealed/open split, same 1e-9 tolerance);
     * `tests/state-invariants.test.ts` pins the two implementations together.
     */
    let openKg = 0;
    let hiddenKg = 0;
    let litres = 0;
    for (const stack of state.player.inventory) {
      if (stack.storageId !== storage.id) continue;
      const commodity = registry.get(stack.commodityId);
      if (!commodity) continue;
      const weight = round2(commodity.weightKg * stack.qty);
      if (stack.concealed) hiddenKg += weight;
      else openKg += weight;
      litres += round2(commodity.volumeL * stack.qty);
    }
    if (openKg > storage.capacityKg + 1e-9) {
      err(`storages.${storage.id}`, `holds ${round2(openKg)} kg of open goods against a ${storage.capacityKg} kg limit`);
    }
    if (hiddenKg > storage.hiddenCompartmentKg + 1e-9) {
      err(`storages.${storage.id}`, `holds ${round2(hiddenKg)} kg concealed against a ${storage.hiddenCompartmentKg} kg compartment`);
    }
    if (litres > storage.capacityL + 1e-9) {
      err(`storages.${storage.id}`, `holds ${round2(litres)} L against a ${storage.capacityL} L limit`);
    }
  }

  for (const loan of state.player.loans) {
    if (loan.balance < -1e-6) err(`loans.${loan.id}.balance`, `negative loan balance ${loan.balance}`);
    if (loan.apr < 0) err(`loans.${loan.id}.apr`, 'negative APR');
    if (loan.balance > loan.principal * 6) warn(`loans.${loan.id}.balance`, 'balance far exceeds principal');
  }

  for (const holding of state.player.stockHoldings) {
    if (holding.shares < 0) err(`stockHoldings.${holding.companyId}.shares`, 'negative share count');
    if (!state.world.companies[holding.companyId]) warn(`stockHoldings.${holding.companyId}`, 'company has no world state');
  }
  for (const holding of state.player.cryptoHoldings) {
    if (holding.amount < 0) err(`cryptoHoldings.${holding.assetId}.amount`, 'negative holding');
    if (holding.staked > holding.amount + 1e-9) err(`cryptoHoldings.${holding.assetId}.staked`, 'staked exceeds holdings');
  }

  for (const key of orderedKeys(state.markets)) {
    const market = state.markets[key]!;
    if (!Number.isFinite(market.price) || market.price <= 0) err(`markets.${key}.price`, `invalid price ${market.price}`);
    if (market.supply < 0) err(`markets.${key}.supply`, 'negative supply');
    if (market.demand < 0) err(`markets.${key}.demand`, 'negative demand');
    if (!registry.has(market.commodityId)) err(`markets.${key}.commodityId`, 'unknown commodity');
    if (!worldReg.location(market.locationId)) err(`markets.${key}.locationId`, 'unknown location');
    const sep = key.indexOf('::');
    if (sep <= 0 || `${market.locationId}::${market.commodityId}` !== key) {
      err(`markets.${key}`, 'key does not match its own location/commodity ids');
    }
  }

  for (const skill of orderedKeys(state.player.progression.skills)) {
    const def = SKILL_BY_ID[skill];
    if (!def) err(`progression.skills.${skill}`, 'unknown skill');
    else if (state.player.progression.skills[skill]! > def.maxLevel) {
      err(`progression.skills.${skill}`, 'level above maximum');
    }
  }
  if (state.player.progression.level > B.progression.maxLevel) {
    err('progression.level', 'level above configured maximum');
  }
  if (state.player.progression.skillPoints < 0 || state.player.progression.perkPoints < 0) {
    err('progression.points', 'negative unspent points');
  }
  if (
    !Number.isFinite(state.player.progression.legacyBonus) ||
    state.player.progression.legacyBonus < 0 ||
    state.player.progression.legacyBonus > B.progression.prestige.legacyBonusCap + 1e-9
  ) {
    err('progression.legacyBonus', 'legacy bonus is outside the prestige cap');
  }
  if (
    !Number.isInteger(state.player.progression.prestigeCount) ||
    state.player.progression.prestigeCount < 0 ||
    state.player.progression.prestigeCount > B.progression.prestige.maxPrestiges
  ) {
    err('progression.prestigeCount', 'prestige count is outside the configured range');
  }

  for (const dim of REPUTATION_DIMENSIONS) {
    const v = state.player.reputation.dimensions[dim];
    if (v === undefined) err(`reputation.dimensions.${dim}`, 'missing dimension');
    else if (v < B.reputation.min - 1e-6 || v > B.reputation.max + 1e-6) {
      err(`reputation.dimensions.${dim}`, `out of range: ${v}`);
    }
  }

  const chainCheck = verifyTransactionChain(state.player.recentTransactions, state.player.transactionChain);
  if (!chainCheck.ok) {
    const where = chainCheck.brokenAtIndex >= 0 ? `recentTransactions[${chainCheck.brokenAtIndex}]` : 'transactionChain';
    err(where, `integrity hash chain broken — save may have been tampered with (${chainCheck.reason ?? 'unknown reason'})`);
  }

  if (state.player.stats.health > state.player.stats.maxHealth + 1e-6) {
    warn('stats.health', 'above maximum');
  }
  if (state.player.stats.health < 0) err('stats.health', 'negative health');

  const netWorth = computeNetWorth(state);
  if (!Number.isFinite(netWorth.total)) err('netWorth.total', 'not finite');

  return issues;
}

export function validateStateStrict(state: GameState): void {
  const issues = validateState(state).filter((i) => i.severity === 'error');
  if (issues.length > 0) {
    throw new Error(
      `Invalid game state (${issues.length} error(s)): ${issues
        .slice(0, 6)
        .map((i) => `${i.path}: ${i.message}`)
        .join('; ')}`,
    );
  }
}

/** Final summary produced when a game ends. */
export function buildEnding(state: GameState, kind: GameEnding['kind'], summary: string): GameEnding {
  const worth = computeNetWorth(state);
  const stats = state.player.stats;
  const level = state.player.progression.level;
  const score = Math.round(
    Math.max(0, worth.total) / 1000 +
      level * 250 +
      stats.daysSurvived * 12 +
      stats.combatsWon * 40 +
      state.player.progression.achievements.length * 120 +
      state.player.properties.length * 300 +
      state.player.businesses.length * 450 +
      state.player.crew.length * 90,
  );
  return {
    kind,
    day: state.world.day,
    summary,
    stats: [
      { label: 'Final net worth', value: formatMoney(worth.total) },
      { label: 'Level', value: `${level} (${titleForLevel(level)})` },
      { label: 'Days survived', value: String(stats.daysSurvived) },
      { label: 'Trades executed', value: String(stats.totalTradesExecuted) },
      { label: 'Distance travelled', value: `${Math.round(stats.totalDistanceTravelledKm).toLocaleString('en-US')} km` },
      { label: 'Properties', value: String(state.player.properties.length) },
      { label: 'Businesses', value: String(state.player.businesses.length) },
      { label: 'Crew', value: String(state.player.crew.length) },
      { label: 'Combats won', value: `${stats.combatsWon} / ${stats.combatsWon + stats.combatsLost}` },
      { label: 'Arrests', value: String(stats.arrests) },
      { label: 'Achievements', value: String(state.player.progression.achievements.length) },
    ],
    score,
  };
}

/**
 * Empire score (0…100+): the composite used by the "build an empire" victory
 * condition. Weighted so that no single asset class can win the game alone.
 */
export function empireScore(state: GameState): number {
  const p = state.player;
  const worth = computeNetWorth(state).total;
  const wealth = Math.min(35, (Math.log10(Math.max(1, worth)) / 9) * 35);
  const properties = Math.min(15, p.properties.length * 1.6);
  const businesses = Math.min(18, p.businesses.length * 2.4);
  const crew = Math.min(12, p.crew.length * 0.7);
  const automation = Math.min(10, p.automation.filter((a) => a.enabled).length * 2);
  const production = Math.min(10, p.productionLines.length * 2.5);
  return Math.round((wealth + properties + businesses + crew + automation + production) * 10) / 10;
}
