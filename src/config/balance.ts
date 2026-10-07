/**
 * Centralised balancing configuration.
 *
 * EVERY tunable number in the simulation lives here. Domain code must never
 * embed its own economic/combat/progression constants — it reads them from
 * `BALANCE`. This keeps the game balancable from one file, allows tests to
 * assert invariants against the configured values, and lets a future build
 * ship alternative balance profiles (hardcore / relaxed / campaign) without
 * touching simulation logic.
 *
 * Overrides: set `DYNASTY_BALANCE_OVERRIDES` to a JSON object whose shape
 * mirrors this file (deep-merged, unknown keys rejected in dev).
 */

export const BALANCE = {
  /** Global economic backdrop. */
  economy: {
    /** Daily drift applied to the global price index (fraction, e.g. 0.0004 ≈ 16%/yr). */
    baseInflationPerDay: 0.00014,
    inflationVolatility: 0.00022,
    inflationFloor: 0.75,
    inflationCeiling: 2.6,
    /** Business-cycle period in days (boom → recession → recovery). */
    cycleLengthDays: 210,
    cycleAmplitude: 0.16,
    /** Probability per day of a discrete market shock. */
    shockChancePerDay: 0.035,
    shockSeverityRange: [0.06, 0.34] as [number, number],
    shockDecayPerDay: 0.055,
    /** Mean reversion strength pulling prices toward fundamental value. */
    meanReversion: 0.085,
    /** Momentum carry-over of yesterday's price change. */
    momentum: 0.32,
    /** Fraction of a market's supply consumed by NPC buyers each day. */
    npcDemandDrainPerDay: 0.055,
    /** Fraction of a market's supply replenished by producers each day. */
    supplyReplenishPerDay: 0.075,
    /** How strongly a supply/demand imbalance moves price (elasticity). */
    priceElasticity: 0.62,
    scarcityClamp: [0.35, 3.2] as [number, number],
    /** Global tax baseline applied to legal sales. */
    salesTaxBaseline: 0.06,
  },

  /** Per-market price behaviour. */
  market: {
    baseNoise: 0.012,
    /** Extra noise multiplier for illegal/contraband goods. */
    illegalNoiseMultiplier: 2.6,
    cryptoNoiseMultiplier: 4.2,
    /** Premium charged on illegal markets relative to base value. */
    illegalRiskPremium: 0.42,
    /** Price impact of a single player trade (fraction of depth). */
    playerImpactFactor: 0.18,
    /** Units of "depth" — larger depth means a trade moves price less. */
    depthPerSupplyUnit: 0.0016,
    maxImpactPerTrade: 0.28,
    impactRelaxationPerDay: 0.12,
    /** Days of price history retained per market (ring buffer). */
    historyLengthDays: 120,
    /** Spread (buy above mid, sell below mid) as a fraction of price. */
    legalSpread: 0.035,
    illegalSpread: 0.085,
    cryptoSpread: 0.012,
    /** Minimum price so markets can never go negative or to zero. */
    priceFloorFraction: 0.02,
    priceCeilingMultiple: 40,
    arbitrageGuardMaxMargin: 0.55,
  },

  /** Banking, loans and money movement. */
  finance: {
    startingCash: 4200,
    /** Central bank base rate; loan/interest rates derive from it. */
    baseInterestRateAnnual: 0.045,
    rateVolatilityPerDay: 0.0006,
    rateFloor: 0.015,
    rateCeiling: 0.42,
    savingsApyAnnual: 0.031,
    bankTransactionFee: 0.004,
    bankTransactionFeeMin: 1.5,
    wireFeeFlat: 12,
    bankLoan: {
      minAmount: 1000,
      maxAmountByCreditScore: [
        { minScore: 0, max: 2500 },
        { minScore: 520, max: 15000 },
        { minScore: 620, max: 60000 },
        { minScore: 700, max: 250000 },
        { minScore: 760, max: 1200000 },
      ] as { minScore: number; max: number }[],
      aprSpreadOverBase: 0.055,
      termDaysOptions: [30, 90, 180, 365, 730] as number[],
      originationFee: 0.012,
      collateralHaircut: 0.62,
      lateFeeFraction: 0.03,
      lateRatePenaltyAnnual: 0.09,
      creditScoreHitPerMissedDay: 1.6,
      seizureAfterDaysDelinquent: 45,
    },
    loanShark: {
      aprSpreadOverBase: 0.42,
      maxAmountByReputation: 80000,
      termDaysOptions: [7, 14, 30, 60] as number[],
      originationFee: 0.06,
      /** Daily escalation of pressure while overdue. */
      pressurePerDayOverdue: 0.07,
      violenceChanceAtMaxPressure: 0.55,
      reputationDamageOnDefault: 14,
    },
    creditScore: {
      start: 640,
      min: 300,
      max: 850,
      onTimeRepaymentPerLoan: 9,
      fullRepaymentBonus: 22,
      defaultPenalty: 130,
      utilisationPenaltyPerFraction: 60,
      /** Fraction of the score decaying toward the mean each day. */
      dailyDriftTowardMean: 0.0008,
      mean: 640,
    },
    laundering: {
      feeFraction: 0.185,
      feeVariance: 0.05,
      /** Base chance per operation of drawing a financial investigation. */
      detectionChance: 0.055,
      detectionScaleByAmount: 0.0000012,
      minCleanableAmount: 500,
      throughputPerFrontPerDay: 8500,
      investigationHeatDecayPerDay: 0.02,
    },
    tax: {
      incomeTaxRate: 0.21,
      capitalGainsRate: 0.16,
      taxAuditChancePerDayByWealth: 0.00000004,
      evasionPenaltyMultiplier: 1.6,
    },
    /** Net worth below which the campaign declares bankruptcy. */
    bankruptcyThreshold: -25000,
  },

  /** Equity markets. */
  stocks: {
    indexBaseLevel: 1000,
    marketBetaNoise: 0.0075,
    dividendYieldAnnualRange: [0.004, 0.048] as [number, number],
    earningsDriftAnnual: 0.062,
    earningsVolatility: 0.09,
    peRange: [6, 42] as [number, number],
    bubbleThresholdSentiment: 0.86,
    crashThresholdSentiment: 0.14,
    crashSeverityRange: [0.18, 0.52] as [number, number],
    bubbleInflationPerDay: 0.0035,
    tradingFeeFraction: 0.0022,
    tradingFeeMin: 2,
    mergerChancePerCompanyPerDay: 0.00018,
    failureChancePerCompanyPerDay: 0.00022,
    sectorCorrelation: 0.55,
    maxPortfolioHistoryDays: 120,
  },

  /** Digital assets — deliberately NOT a reskinned commodity market. */
  crypto: {
    volatilityScale: 3.1,
    /** Bitcoin-style supply halving interval, in days. */
    halvingIntervalDays: 180,
    halvingSupplyCut: 0.5,
    /** Network yield for staked assets (annual, per-asset overrides apply). */
    stakingApyRange: [0.02, 0.14] as [number, number],
    stakingLockDays: [7, 30, 90] as number[],
    stakingSlashOnExitEarly: 0.02,
    miningCostPerUnitEnergy: 0.09,
    networkDifficultyDriftPerDay: 0.004,
    /** Exchange mechanics. */
    exchangeFeeFraction: 0.0018,
    exchangeFeeMin: 1,
    liquidityDepthBase: 250000,
    slippagePerDepthFraction: 0.4,
    withdrawalFeeFlat: 2.5,
    /** Probability per day of a protocol-level event (exploit, fork, upgrade). */
    protocolEventChancePerDay: 0.012,
    regulatoryShockChancePerDay: 0.008,
    memecoinRugChancePerDay: 0.021,
    /** Sentiment mean-reverts toward this value. */
    sentimentMean: 0.5,
    sentimentReversion: 0.045,
    depegThreshold: 0.86,
  },

  /** Underground / darknet digital economy. */
  underground: {
    accessCostOneTime: 750,
    escrowFeeFraction: 0.045,
    exitScamChancePerVendorPerDay: 0.0021,
    vendorReputationRange: [0.2, 0.99] as [number, number],
    dataBreachChancePerDay: 0.006,
    traceHeatPerIllegalTransaction: 0.9,
    heatDecayPerDay: 1.1,
    heatArrestThreshold: 100,
    hackingBaseDifficulty: 42,
    hackingSkillWeight: 0.85,
    hackingRewardMultiplier: 1.9,
    digitalReputationDecayPerDay: 0.15,
    marketFeeFraction: 0.03,
  },

  /** World geography and travel. */
  travel: {
    /** Cost per kilometre, by mode (currency/km). */
    costPerKm: {
      foot: 0.0,
      bus: 0.09,
      car: 0.34,
      truck: 0.72,
      train: 0.16,
      ferry: 0.42,
      air: 1.65,
      private_jet: 6.4,
      cargo_ship: 0.21,
    } as Record<string, number>,
    /** Average km/day, by mode. */
    speedKmPerDay: {
      foot: 28,
      bus: 420,
      car: 780,
      truck: 560,
      train: 900,
      ferry: 480,
      air: 5200,
      private_jet: 6400,
      cargo_ship: 620,
    } as Record<string, number>,
    fixedCostByMode: {
      foot: 0,
      bus: 14,
      car: 45,
      truck: 120,
      train: 60,
      ferry: 95,
      air: 340,
      private_jet: 4200,
      cargo_ship: 260,
    } as Record<string, number>,
    /** Base interception risk per border crossing. */
    borderRiskBase: 0.045,
    borderRiskPerRiskUnit: 0.0016,
    contrabandDetectionBase: 0.055,
    contrabandDetectionPerUnit: 0.0009,
    hiddenCompartmentDetectionReduction: 0.62,
    seizureFractionOnCaught: 1.0,
    bribeCostMultiplier: 3.2,
    bribeSuccessBase: 0.62,
    fuelCostPerKm: 0.11,
    maintenancePerKm: 0.045,
    vehicleDamageChancePerTrip: 0.035,
    routeDisruptionChancePerDay: 0.008,
    routeDisruptionDurationDays: [2, 9] as [number, number],
    routeDisruptionCostMultiplier: 1.65,
  },

  /** Inventory, storage and logistics. */
  logistics: {
    personalCapacityKg: 24,
    personalCapacityLitres: 55,
    personalSecureSlots: 2,
    /** Warehouse theft/seizure risk drivers. */
    theftChancePerDayBase: 0.0022,
    theftReductionPerSecurityLevel: 0.00034,
    seizureChancePerDayPerRiskUnit: 0.00028,
    spoilageCheckPerDay: true,
    insurancePremiumPerDayFraction: 0.00075,
    insurancePayoutFraction: 0.88,
    shipmentDelayChancePerDay: 0.06,
    shipmentDelayDays: [1, 4] as [number, number],
    autoLogisticsEfficiency: 0.9,
    logisticsManagerSalaryMultiplier: 1.35,
  },

  /** Real estate and infrastructure. */
  property: {
    priceAppreciationAnnual: 0.058,
    priceVolatility: 0.031,
    maintenancePerDayFraction: 0.00032,
    propertyTaxAnnualFraction: 0.011,
    transferTaxFraction: 0.045,
    upgradeCostMultiplier: 1.0,
    raidChancePerDayByHeat: 0.00042,
    damageFractionOnRaid: [0.08, 0.42] as [number, number],
    insurancePremiumAnnualFraction: 0.0072,
    valuationLocationPremiumRange: [0.72, 1.9] as [number, number],
    rentYieldAnnualRange: [0.045, 0.13] as [number, number],
  },

  /** Operating businesses. */
  business: {
    dailyRevenueVolatility: 0.16,
    staffCostPerDayBase: 42,
    opexPerDayFraction: 0.0009,
    reputationElasticity: 0.4,
    demandElasticity: 0.55,
    marketingBoostPerSpend: 0.000018,
    marketingDecayPerDay: 0.09,
    failureChancePerDayIfUnprofitable: 0.0011,
    growthCapPerDay: 0.035,
    launderingIntegrationFraction: 0.35,
  },

  /** Production chains. */
  production: {
    efficiencyBase: 0.82,
    efficiencyPerWorkerSkill: 0.021,
    automationEfficiencyBonus: 0.24,
    automationCapexMultiple: 2.6,
    /**
     * Energy cost as a fraction of the *output's* value per unit of energy
     * intensity: `cost = outputValuePerUnit × energyPerUnit × energyCostPerUnit`.
     * Pricing energy off output value keeps every recipe in the same units
     * (per-tonne metals, per-bottle beverages, per-panel assemblies) without a
     * separate unit-conversion table, and it means energy shocks scale with the
     * product rather than with an arbitrary currency constant.
     */
    energyCostPerUnit: 0.014,
    qualityBase: 0.7,
    qualityPerSkill: 0.03,
    breakdownChancePerDay: 0.011,
    breakdownDowntimeDays: [1, 5] as [number, number],
    maintenanceCostPerDayFraction: 0.0016,
    byproductChance: 0.12,
    wasteFractionRange: [0.02, 0.14] as [number, number],
  },

  /** Personnel. */
  crew: {
    hiringPoolSize: 26,
    poolRefreshDays: 6,
    hiringFeeFraction: 0.08,
    salaryBaseByRole: {
      security: 78,
      mercenary: 145,
      driver: 58,
      pilot: 210,
      trader: 96,
      broker: 132,
      warehouse_worker: 44,
      logistics_manager: 118,
      business_manager: 104,
      accountant: 122,
      lawyer: 190,
      financial_specialist: 165,
      intelligence_specialist: 158,
      technical_specialist: 142,
      researcher: 126,
      production_worker: 52,
      sales_staff: 48,
      marketing_staff: 66,
      fixer: 138,
      negotiator: 112,
      faction_contact: 96,
      contractor: 70,
      hacker: 186,
      chemist: 174,
    } as Record<string, number>,
    loyaltyBase: 58,
    loyaltyPerDayPaid: 0.09,
    loyaltyPenaltyPerDayUnpaid: 1.9,
    moraleBase: 62,
    betrayalChanceAtZeroLoyalty: 0.085,
    betrayalLoyaltyExponent: 2.4,
    xpPerDayWorked: 6.5,
    levelXpBase: 120,
    levelXpGrowth: 1.32,
    injuryChancePerCombat: 0.22,
    injuryRecoveryDays: [3, 21] as [number, number],
    trainingCostPerLevel: 480,
    trainingDaysPerLevel: 2,
    maxLevel: 30,
    retirementLevel: 26,
    promotionLoyaltyBonus: 12,
  },

  /** Automation / delegation. */
  automation: {
    /** Manager competence scales with level; error chance falls with it. */
    errorChanceBase: 0.11,
    errorChancePerLevel: 0.0075,
    errorCostFraction: 0.02,
    autoTradeMarginThreshold: 0.14,
    autoTradeMaxFractionOfCash: 0.22,
    autoTradeCooldownDays: 1,
    /**
     * Combined interception + theft risk a delegated shipment may carry.
     * A manager committing a quarter of the treasury down a hot route is how an
     * empire loses a month of profit in one day, so automation is risk-averse by
     * default and the player can dial it up deliberately.
     */
    autoShipMaxRisk: 0.35,
    delegationLevels: ['player', 'regional_manager', 'business_manager', 'warehouse_manager', 'worker'] as string[],
    managerSpanOfControl: 6,
    automationUptimeBase: 0.93,
  },

  /** Player progression. */
  progression: {
    xpBasePerLevel: 240,
    xpGrowthPerLevel: 1.28,
    maxLevel: 60,
    skillPointsPerLevel: 2,
    perkPointsPerLevel: 1,
    perkPointEveryNthLevel: 5,
    xpTradeFractionOfProfit: 0.9,
    xpTradeMin: 4,
    /** Rebuilding a skill/perk loadout costs a consultant, and gets dearer each time. */
    respecBaseCost: 2500,
    respecCostGrowth: 1.6,
    xpTravelBase: 12,
    xpEventBase: 25,
    xpCombatPerEnemy: 34,
    xpProductionPerDay: 8,
    xpMissionBase: 160,
    titleThresholds: [
      { level: 1, title: 'Nobody' },
      { level: 3, title: 'Hustler' },
      { level: 6, title: 'Peddler' },
      { level: 9, title: 'Street Trader' },
      { level: 13, title: 'Merchant' },
      { level: 17, title: 'Operator' },
      { level: 22, title: 'Distributor' },
      { level: 27, title: 'Supplier' },
      { level: 33, title: 'Executive' },
      { level: 39, title: 'Magnate' },
      { level: 45, title: 'Cartel Architect' },
      { level: 52, title: 'Tycoon' },
      { level: 60, title: 'Dynasty' },
    ] as { level: number; title: string }[],
    /**
     * Prestige — hand the empire to your heir and restart with a legacy bonus.
     *
     * The bonus is a *reward for a completed empire*, not a tap: it costs the
     * whole estate, it is capped, it diminishes, and the same empire can only be
     * cashed in a bounded number of times. Every one of those limits exists
     * because an uncapped repeatable multiplier is an XP exploit, not a feature.
     */
    prestige: {
      /** Net worth the estate must be worth to be handed over at all. */
      netWorthRequirement: 25_000_000,
      /** Fraction of the starting XP rate granted by the first prestige. */
      legacyBonusFraction: 0.06,
      /** Each further prestige adds less than the last (0.25 → +25% of base, then compounding down). */
      diminishingPerPrestige: 0.25,
      /** Hard ceiling on the total XP multiplier bonus, however many prestiges. */
      legacyBonusCap: 0.35,
      /** How many times one character may hand over the empire. */
      maxPrestiges: 5,
      /** Days of play required between handovers, so it cannot be repeated in one sitting. */
      minDaysBetween: 120,
      /**
       * The estate is liquidated at this fraction of assessed value and the
       * proceeds are forfeit — the cost of the reset. Below 1 it is a real cost.
       */
      liquidationFraction: 0,
      /** Debts must be covered by the estate; prestige is not a bankruptcy escape. */
      requireDebtsSettled: true,
    },
    achievementNetWorthTiers: [10000, 100000, 1000000, 10000000, 100000000, 1000000000] as number[],
  },

  /** Reputation dimensions. */
  reputation: {
    start: 0,
    min: -100,
    max: 100,
    decayPerDayTowardZero: 0.06,
    criminalHeatPerIllegalDeal: 1.4,
    heatDecayPerDay: 0.55,
    legalRepPerLegalDeal: 0.12,
    businessRepPerProfitUnit: 0.00006,
    collapseThreshold: -85,
    factionStandingDriftPerDay: 0.02,
  },

  /** Factions. */
  factions: {
    relationshipRange: [-100, 100] as [number, number],
    warDeclarationThreshold: -55,
    allianceThreshold: 62,
    tributeFractionOfRevenue: 0.045,
    territoryContestChancePerDay: 0.012,
    standingGainPerFavour: 9,
    standingLossPerTransgression: 14,
    recruitmentRequirementStanding: 25,
  },

  /** Combat. */
  combat: {
    playerBaseHp: 100,
    playerBaseActionPoints: 3,
    accuracyBase: 0.62,
    accuracyPerWeaponSkill: 0.021,
    damageVariance: 0.28,
    critChanceBase: 0.06,
    critMultiplier: 2.05,
    defenseBase: 0.18,
    coverBonus: 0.14,
    fleeBaseChance: 0.42,
    fleeChancePerSpeed: 0.012,
    arrestChanceOnDefeat: 0.48,
    injuryChanceOnDefeat: 0.62,
    deathChanceOnDefeatInWarzone: 0.18,
    intimidationBase: 0.35,
    briberyBase: 0.45,
    negotiationBase: 0.4,
    turnLimit: 24,
    autoResolveThresholdEnemies: 3,
    tacticalThresholdEnemies: 4,
    enemyScalingPerPlayerLevel: 0.035,
    eliteMultiplier: 1.85,
    bossMultiplier: 3.1,
    xpPerRoundWon: 6,
    policeResponseEscalationPerDay: 0.08,
  },

  /** Enforcement / police pressure. */
  enforcement: {
    patrolChancePerDayByLocation: 0.022,
    investigationOpenHeatThreshold: 62,
    investigationCloseHeatThreshold: 18,
    investigationProgressPerDay: 3.4,
    raidChancePerDayAtMaxInvestigation: 0.28,
    fineFractionOfDirtyCash: 0.35,
    prisonDaysBase: [25, 220] as [number, number],
    prisonDaysPerHeatUnit: 1.1,
    prisonEscapeChancePerDay: 0.011,
    bailFractionOfNetWorth: 0.18,
    lawyerReductionFraction: 0.34,
    assetForfeitureFraction: 0.28,
  },

  /** Event engine. */
  events: {
    /** Max events evaluated/fired per simulated day. */
    maxEventsPerDay: 4,
    baseEventChancePerDay: 0.42,
    localEventChance: 0.55,
    regionalEventChance: 0.28,
    globalEventChance: 0.17,
    chainReactionChance: 0.38,
    maxChainDepth: 3,
    cooldownDaysDefault: 22,
    newsRetentionDays: 90,
    effectDurationDaysDefault: 12,
    /**
     * Ceiling on `world.activeEvents`. Instantaneous events leave the list at the
     * end of the day they fire, so this only ever binds when a burst of duration
     * events overlaps — but it is the guarantee that the list (which is shown in the
     * UI and stored in every save) cannot grow without bound.
     */
    maxActiveEvents: 36,
    severityWeights: { minor: 0.5, moderate: 0.32, major: 0.14, catastrophic: 0.04 } as Record<string, number>,
  },

  /** Missions. */
  missions: {
    maxActiveMissions: 4,
    offerRefreshDays: 5,
    rewardVariance: 0.22,
    failurePenaltyFraction: 0.25,
    deadlineDaysRange: [3, 22] as [number, number],
    reputationRewardMultiplier: 1.0,
  },

  /** World simulation (NPC actors). */
  world: {
    competitorCount: 14,
    competitorTradeChancePerDay: 0.68,
    competitorGrowthPerDay: 0.0042,
    governmentStabilityDriftPerDay: 0.006,
    populationGrowthPerDay: 0.00011,
    infrastructureDecayPerDay: 0.0009,
    regionalSpecialisationStrength: 0.85,
  },

  /** Per-day player limits, starting stats and history buffer sizes. */
  player: {
    /** Actions the player may take per day before resting/advancing. */
    maxActionsPerDay: 8,
    healthBase: 100,
    staminaBase: 100,
    /** Stamina spent per deliberate action (trading, travel prep, meetings). */
    staminaPerAction: 3,
    healthRegenPerDay: 6,
    staminaRegenPerDay: 24,
    /** Skill points granted on a brand-new character. */
    startingSkillPoints: 3,
    /** Fraction of starting cash pre-spent on a starter inventory, so the first
     *  game loop (sell → travel → buy cheaper) is immediately playable. */
    startingInventoryValueFraction: 0.25,
    /**
     * Fraction of the starter container's weight *and* volume the starter
     * inventory may occupy. Below 1 on purpose: a brand-new character who is
     * already carrying a full load cannot make a first purchase, which is the
     * exact loop this position exists to teach.
     */
    startingInventoryCapacityFraction: 0.4,
    /** Days of transaction/notification history kept inside the save blob. */
    transactionHistoryLength: 240,
    notificationHistoryLength: 60,
    diagnosticHistoryLength: 300,
    netWorthHistoryLength: 400,
  },

  saves: {
    maxSaveVersions: 24,
    autosaveEveryDays: 1,
    /**
     * State schema version — bump when GameState shape changes.
     *
     * 1 → 2: transaction records gained `seq`/`prevHash` and the player gained a
     * `transactionChain` eviction checkpoint, so a full transaction history no
     * longer invalidates itself when the ring buffer drops its oldest entries.
     * Every bump needs a matching step in `persistence/serialize.ts:migrateState`.
     */
    schemaVersion: 2,
    maxStateBytes: 12_000_000,
  },

  /** API protection. */
  api: {
    rateLimitWindowMs: 60_000,
    rateLimitMaxRequests: 240,
    actionRateLimitWindowMs: 10_000,
    actionRateLimitMaxRequests: 40,
    maxActionsPerTurn: 25,
    /**
     * Days one interactive request may simulate.
     *
     * A day tick costs roughly 9–21 ms, so 365 days was 3–8 s of synchronous CPU
     * inside a single HTTP request — enough to stall the event loop for every
     * other player on the instance and to exceed serverless limits. The bound is
     * a validation error, never a silent truncation: the client is told the
     * largest advance it may ask for. Longer catch-ups belong to a background
     * job (deferred; see README "Known limitations").
     */
    maxAdvanceDaysPerRequest: 30,
    /**
     * How many idempotency receipts are kept per save.
     *
     * Receipts exist so a retried command replays instead of executing twice. They
     * are pruned to a bounded window (the newest N per game), because the permanent
     * record of what happened is the audit trail — this table is a replay cache, and
     * keeping it small keeps the operational footprint predictable.
     */
    maxIntentReceiptsPerGame: 400,
  },
} as const;

export type Balance = typeof BALANCE;

/** Recursive partial used for overrides. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, override: unknown, path: string, strict: boolean): T {
  if (!isPlainObject(override)) return base;
  if (!isPlainObject(base)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const childPath = path ? `${path}.${key}` : key;
    if (!(key in base)) {
      if (strict) {
        throw new Error(`Unknown balance override key: "${childPath}"`);
      }
      continue;
    }
    const current = (base as Record<string, unknown>)[key];
    out[key] = isPlainObject(current) ? deepMerge(current, value, childPath, strict) : value;
  }
  return out as T;
}

let cached: Balance | null = null;

/** Returns BALANCE with `DYNASTY_BALANCE_OVERRIDES` applied (memoised). */
export function getBalance(): Balance {
  if (cached) return cached;
  const raw = process.env.DYNASTY_BALANCE_OVERRIDES;
  if (!raw) {
    cached = BALANCE;
    return cached;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    cached = deepMerge(BALANCE, parsed, '', process.env.NODE_ENV !== 'production');
  } catch (err) {
    // Never let a bad override string take the server down: log and fall back.
    console.error('[balance] failed to apply DYNASTY_BALANCE_OVERRIDES:', err);
    cached = BALANCE;
  }
  return cached;
}

/** Test/dev helper: clear the memo so overrides are re-read. */
export function resetBalanceCache(): void {
  cached = null;
}
