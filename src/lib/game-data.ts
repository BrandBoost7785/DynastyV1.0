/**
 * Typed contracts for the read models, and the fetchers the screens use.
 *
 * The API client (`src/lib/api-client.ts`) is the only transport; this module names
 * the shapes so a screen can be written against real fields. Every interface below
 * describes a payload that exists in `src/server/services/game-views.ts` — if a field
 * is not in the server projection it is not here, and the UI renders what the server
 * says rather than guessing.
 *
 * Fields the interface declares are the ones the interface consumes; the server sends
 * more (history, diagnostics-free internals, extra counters) and that is fine.
 */
import { api } from './api-client';
import type { GameStateDto } from '../server/dto';
import type { SaveVersionRow, AuditRecord, LeaderboardRow } from '../persistence/types';

export type { SaveVersionRow, AuditRecord, LeaderboardRow, GameStateDto };

/* ------------------------------------------------------------------ */
/* Market                                                              */
/* ------------------------------------------------------------------ */

export interface MarketDriver {
  label: string;
  contributionPct: number;
  kind: string;
}

export interface MarketRow {
  commodityId: string;
  name: string;
  category: string;
  unit: string;
  legality: string;
  rarity: number;
  weightKg: number;
  volumeL: number;
  price: number;
  fundamental: number;
  bid: number;
  ask: number;
  spreadPct: number;
  changePct1d: number;
  changePct7d: number;
  changePct30d: number;
  premiumVsFundamentalPct: number;
  supply: number;
  demand: number;
  scarcityRatio: number;
  sentiment: number;
  volatility: number;
  absorbable: number;
  onHand: number;
  holdingValue: number;
  holdingCostBasis: number;
  unrealisedPnl: number;
  unrealisedPnlPct: number;
  channel: string;
  tradable: boolean;
  drivers: MarketDriver[];
  tags: string[];
  shelfLifeDays: number | null;
  storage: string[];
}

export interface MarketMover {
  commodityId: string;
  name: string;
  changePct?: number;
  premiumPct?: number;
  volatilityPct?: number;
}

export interface MarketSummary {
  locationId: string;
  name: string;
  country: string;
  region: string;
  kind: string;
  tradedCount: number;
  materialisedCount: number;
  hiddenChannelCount: number;
  index: number;
  cheapest: MarketMover[];
  dearest: MarketMover[];
  mostVolatile: MarketMover[];
  biggestMovers1d: MarketMover[];
  taxRate: number;
  enforcement: number;
  lockdown: boolean;
  playerHeat: number;
}

export interface MarketView {
  locationId: string;
  rows: MarketRow[];
  summary: MarketSummary;
}

/* ------------------------------------------------------------------ */
/* Finance                                                             */
/* ------------------------------------------------------------------ */

export interface AccountEntry {
  id: string;
  institution: string;
  kind: string;
  locationName: string;
  balance: number;
  clean: number;
  dirty: number;
  currency: string;
  apy: number;
  dailyInterest: number;
  openedDay: number;
  frozen: boolean;
  frozenUntilDay: number | null;
  freezeReason: string | null;
  dailyLimit: number | null;
  usable: boolean;
  isSettlementAccount: boolean;
  offshore: boolean;
  taxRateApplied: number;
}

export interface LoanView {
  id: string;
  lenderName: string;
  kind: string;
  principal: number;
  balance: number;
  apr: number;
  paymentPerDay: number;
  daysRemaining: number;
  daysOverdue: number;
  collateralValue: number;
  status: string;
  delinquency: number;
}

export interface LoanOffer {
  kind: string;
  lenderName: string;
  amount: number;
  apr: number;
  termDays: number;
  originationFee: number;
  paymentPerDay: number;
  totalRepayment: number;
  totalInterest: number;
  method: string;
  compoundingPeriodDays: number;
  collateralRequired: number;
  collateralHaircut: number;
  approvalChance: number;
  available: boolean;
  maxAmount: number;
  termOptions: number[];
  pressurePerDayOverdue: number;
}

export interface TaxLine {
  label: string;
  amount: number;
  rate?: number;
  note?: string;
}

export interface FinanceCore {
  cash: number;
  clean: number;
  dirty: number;
  netWorth: number;
  debt: number;
  leverage: number;
  creditScore: number;
  creditBand: string;
  accounts: AccountEntry[];
  loans: LoanView[];
  dailyDebtService: number;
  dailyInterestIncome: number;
  laundering: { buffer: number; launderedTotal: number; fronts: { id: string; name: string; capacityPerDay: number; usedPerDay: number; heat: number }[] };
  tax: {
    periodStartDay: number;
    periodEndDay: number;
    lines: TaxLine[];
    taxableIncome: number;
    grossLiability: number;
    reductions: number;
    liability: number;
    paid: number;
    arrears: number;
    effectiveRate: number;
    offshoreShare: number;
    auditRisk: number;
  };
  offers: LoanOffer[];
  collateral: { total: number; lines: { kind: string; refId: string; label: string; value: number; lendable: number }[] };
  bankruptcyRisk: string;
}

export interface CreditView {
  score: number;
  band: string;
  maxBankLoan: number;
  bankApr: number;
  utilisation: number;
  factors: { label: string; impact: number }[];
  history: { day: number; score: number; reason: string }[];
}

export interface DebtSummary {
  totalOutstanding: number;
  byKind: { kind: string; balance: number; count: number }[];
  totalDailyPayments: number;
  totalCollateralValue: number;
  worstDelinquency: number;
  creditScore: number;
  netWorth: number;
  leverage: number;
  bankruptcyDistance: number;
}

export interface FinanceView {
  finance: FinanceCore;
  accounts: AccountEntry[];
  credit: CreditView;
  debt: DebtSummary;
}

/* ------------------------------------------------------------------ */
/* Stocks and crypto                                                   */
/* ------------------------------------------------------------------ */

export interface StockRow {
  companyId: string;
  ticker: string;
  name: string;
  sector: string;
  country: string;
  status: string;
  price: number;
  change1d: number;
  change7d: number;
  change30d: number;
  eps: number;
  pe: number;
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

export interface StockMarket {
  indexLevel: number;
  indexChange1d: number;
  indexChange30d: number;
  indexHistory: { day: number; level: number }[];
  cyclePhase: string;
  sentiment: number;
  interestRate: number;
  brokerageAccountId: string | null;
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
}

export interface StocksView {
  market: StockMarket;
  risk: { value: number; cashWeight: number; weightedBeta: number; concentration: { companyId: string; name: string; weight: number }[]; largestPosition: { companyId: string; name: string; weight: number } | null; diversification: number };
}

export interface CryptoAssetRow {
  assetId: string;
  symbol: string;
  name: string;
  kind: string;
  status: string;
  price: number;
  change1d: number;
  change7d: number;
  change30d: number;
  volatility: number;
  sentiment: number;
  liquidity: number;
  maxNotional: number;
  circulatingSupply: number;
  maxSupply: number;
  issuanceRate: number;
  halvingEpoch: number;
  nextHalvingDay: number;
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
  custody: string | null;
  venues: string[];
  description: string;
}

export interface CryptoExchange {
  id: string;
  name: string;
  kind: string;
  feeFraction: number;
  liquidityMultiplier: number;
  custodyRiskPerDay: number;
  withdrawalFeeFlat: number;
  withdrawalDelayDays: number;
  kycLevel: number;
  listsKinds: string[];
  compliancePressure: number;
  requiresUnderground: boolean;
  homeCountryId: string;
  description: string;
  hasAccount: boolean;
  balance: number;
  frozenUntilDay: number | null;
  accessible: boolean;
  accessReason: string | null;
}

export interface MiningRig {
  defId: string;
  name: string;
  price: number;
  hashRate: number;
  powerKw: number;
  dailyPowerCost: number;
  heat: number;
  expectedYieldPerDay: number;
  paybackDays: number;
  requiresProperty: boolean;
  requiresSkill: string | null;
  skillMet: boolean;
  affordable: boolean;
  description: string;
}

export interface CryptoMarket {
  indexLevel: number;
  indexChange1d: number;
  indexChange30d: number;
  indexHistory: { day: number; level: number }[];
  globalSentiment: number;
  riskAppetite: number;
  interestRate: number;
  walletAddress: string | null;
  exchanges: CryptoExchange[];
  portfolioValue: number;
  portfolioCost: number;
  unrealisedPnl: number;
  stakedValue: number;
  stakedApyWeighted: number;
  realisedGains: number;
  minedValue: number;
  assets: CryptoAssetRow[];
  holdings: CryptoAssetRow[];
  movers: { up: CryptoAssetRow[]; down: CryptoAssetRow[] };
}

export interface CryptoView {
  market: CryptoMarket;
  risk: {
    value: number;
    custodySplit: { wallet: number; exchange: number };
    byKind: { kind: string; value: number; weight: number }[];
    concentration: number;
    weightedVolatility: number;
    exchangeExposure: number;
    largest: { assetId: string; symbol: string; weight: number } | null;
  };
  exchanges: CryptoExchange[];
  rigs: MiningRig[];
}

/* ------------------------------------------------------------------ */
/* Inventory, logistics, properties                                    */
/* ------------------------------------------------------------------ */

export interface StorageUsage {
  storage: {
    id: string;
    kind: string;
    name: string;
    locationId: string;
    propertyId: string | null;
    vehicleId: string | null;
    capacityKg: number;
    capacityL: number;
    security: number;
    refrigerated: boolean;
    hiddenCompartmentKg: number;
    costPerDay: number;
    insured: boolean;
    insuredValue: number;
  };
  usage: {
    kg: number;
    kgCapacity: number;
    litres: number;
    litresCapacity: number;
    kgFree: number;
    litresFree: number;
    kgUtilisation: number;
    litresUtilisation: number;
    bindingConstraint: string;
    hiddenKg: number;
    hiddenKgCapacity: number;
  };
  value: number;
}

export interface InventoryRow {
  stackId: string;
  commodityId: string;
  name: string;
  category: string;
  qty: number;
  unit: string;
  avgCost: number;
  quality: number;
  weightKg: number;
  volumeL: number;
  marketValue: number;
  costBasis: number;
  unrealisedPnl: number;
  pnlFraction: number;
  storageId: string;
  storageName: string;
  storageKind: string;
  atCurrentLocation: boolean;
  concealed: boolean;
  expiresDay: number | null;
  daysUntilExpiry: number | null;
  legality: string;
}

export interface InventoryView {
  rows: InventoryRow[];
  totalQty: number;
  totalWeightKg: number;
  totalVolumeL: number;
  totalMarketValue: number;
  totalCostBasis: number;
  totalUnrealisedPnl: number;
  stacks: number;
  storages: StorageUsage[];
}

export interface ShipmentView {
  id: string;
  trackingCode: string;
  origin: string;
  destination: string;
  mode: string;
  departedDay: number;
  arrivesDay: number;
  daysRemaining: number;
  progress: number;
  status: string;
  delayReason: string | null;
  items: { commodityId: string; name: string; qty: number; value: number; illegal: boolean }[];
  declaredValue: number;
  actualValue: number;
  underDeclared: boolean;
  concealed: boolean;
  insured: boolean;
  vehicle: string | null;
  crew: string[];
}

export interface VehicleListing {
  defId: string;
  name: string;
  kind: string;
  price: number;
  capacityKg: number;
  capacityL: number;
  speedKmPerDay: number;
  fuelPerKm: number;
  maintenancePerKm: number;
  stealth: number;
  armor: number;
  hiddenCompartmentKg: number;
  reliability: number;
  upgradeSlots: number;
  requiredSkill: string | null;
  skillMet: boolean;
  affordable: boolean;
  description: string;
}

export interface LogisticsView {
  view: {
    shipments: ShipmentView[];
    inTransit: number;
    delivered: number;
    seized: number;
    lost: number;
    valueInTransit: number;
    vehicles: {
      id: string;
      defId: string;
      name: string;
      kind: string;
      locationName: string;
      here: boolean;
      capacityKg: number;
      capacityL: number;
      usedKg: number;
      usedL: number;
      fuel: number;
      condition: number;
      stealth: number;
      armor: number;
      insured: boolean;
      upgradeLevel: number;
      value: number;
      inTransit: boolean;
    }[];
    storage: { id: string; name: string; kind: string; locationName: string; here: boolean; capacityKg: number; usedKg: number; capacityL: number; usedL: number; utilisation: number; security: number; refrigerated: boolean; hiddenCompartmentKg: number; costPerDay: number; insured: boolean; stacks: number; value: number }[];
    warehouseRentPerDay: number;
    freightSpend: number;
    deliveredValue: number;
    seizedValue: number;
    catalogue: VehicleListing[];
  };
  shipments: ShipmentView[];
  listings: VehicleListing[];
}

export interface PropertyOwned {
  id: string;
  defId: string;
  name: string;
  kind: string;
  locationName: string;
  locationId: string;
  purchasePrice: number;
  valuation: number;
  /** Valuation against purchase price, as a fraction. */
  valuationChange: number;
  upgradeLevel: number;
  maxUpgradeLevel: number;
  nextUpgradeCost: number;
  condition: number;
  security: number;
  storageKg: number;
  storageL: number;
  usedKg: number;
  usedL: number;
  utilisation: number;
  hiddenCompartmentKg: number;
  refrigerated: boolean;
  opexPerDay: number;
  taxPerDay: number;
  insurancePerDay: number;
  carryPerDay: number;
  rentalIncomePerDay: number;
  netPerDay: number;
  insured: boolean;
  arrears: number;
  staffed: boolean;
  staff: { id: string; name: string; role: string }[];
  businessId: string | null;
  businessName: string | null;
  productionLines: number;
  recipesEnabled: { id: string; output: string }[];
  raidedDay: number | null;
  damagedUntilDay: number | null;
  ownedDays: number;
  storageId: string | null;
}

export interface PropertyListing {
  defId: string;
  name: string;
  kind: string;
  locationId: string;
  locationName: string;
  askingPrice: number;
  storageKg: number;
  storageL: number;
  security: number;
  refrigerated: boolean;
  hiddenCompartmentKg: number;
  maxUpgradeLevel: number;
  upgradeCostBase: number;
  opexPerDay: number;
  staffSlots: number;
  rentYieldAnnual: number;
  estimatedRentPerDay: number;
  propertyTaxPerDay: number;
  insurancePerDay: number;
  totalCarryPerDay: number;
  enablesBusinessId: string | null;
  productionTags: string[];
  recipesEnabled: number;
  description: string;
  affordable: boolean;
  transferTax: number;
  netCost: number;
}

export interface PropertiesView {
  owned: PropertyOwned[];
  portfolio: {
    count: number;
    totalValuation: number;
    totalPurchasePrice: number;
    unrealisedGain: number;
    carryPerDay: number;
    rentPerDay: number;
    netPerDay: number;
    arrears: number;
    averageCondition: number;
    totalStorageKg: number;
    locations: number;
  };
  listings: PropertyListing[];
}

/* ------------------------------------------------------------------ */
/* Businesses and production                                           */
/* ------------------------------------------------------------------ */

export interface BusinessViewRow {
  id: string;
  defId: string;
  name: string;
  kind: string;
  legality: string;
  locationName: string;
  propertyName: string | null;
  level: number;
  openedDay: number;
  daysOperating: number;
  cashbox: number;
  launderingBuffer: number;
  launderedTotal: number;
  launderingCapacityPerDay: number;
  clientele: number;
  marketing: number;
  reputationLocal: number;
  staffCount: number;
  staffSlots: number;
  staff: { id: string; name: string; role: string; skill: number }[];
  manager: { id: string; name: string; skill: number } | null;
  revenue30d: number;
  opex30d: number;
  profit30d: number;
  revenuePerDay: number;
  opexPerDay: number;
  profitPerDay: number;
  taxPerDay: number;
  wagesPerDay: number;
  valuation: number;
  upgradeCost: number;
  maxLevel: number;
  suspended: boolean;
  suspensionReason: string | null;
  condition: number;
  storageUsedKg: number;
  storageCapacityKg: number;
  productPrices: { commodityId: string; name: string; price: number; margin: number }[];
  demandIndex: number;
  demandDrivers: { label: string; value: number }[];
  risks: string[];
}

export interface BusinessListing {
  defId: string;
  name: string;
  kind: string;
  legality: string;
  setupCost: number;
  baseDailyRevenue: number;
  baseDailyOpex: number;
  staffSlots: number;
  launderingCapacityPerDay: number;
  demandSensitivity: number;
  reputationEffect: { dimension: string; perDay: number };
  requiredPropertyKind: string;
  suitableProperties: { id: string; name: string; locationName: string }[];
  requiredSkill: string | null;
  skillMet: boolean;
  estimatedDailyProfit: number;
  estimatedPaybackDays: number;
  canOpen: boolean;
  reason: string | null;
  description: string;
}

export interface BusinessesView {
  businesses: BusinessViewRow[];
  portfolio: {
    count: number;
    legal: number;
    illegal: number;
    dailyRevenue: number;
    dailyOpex: number;
    dailyTax: number;
    dailyWages: number;
    dailyProfit: number;
    profit30d: number;
    cashboxTotal: number;
    launderingBufferTotal: number;
    launderedTotal: number;
    totalValuation: number;
    staffEmployed: number;
    suspended: number;
    bestPerformer: { id: string; name: string; profitPerDay: number } | null;
    worstPerformer: { id: string; name: string; profitPerDay: number } | null;
  };
  catalogue: BusinessListing[];
}

export interface RecipeListing {
  recipeId: string;
  name: string;
  requiresTag: string;
  outputCommodityId: string;
  outputName: string;
  outputQtyPerDay: number;
  inputCostPerDay: number;
  energyCostPerDay: number;
  imputedLabourCostPerDay: number;
  opexPerDay: number;
  maintenancePerDay: number;
  installCapex: number;
  automationCapex: number;
  totalCostPerDay: number;
  revenuePerDayAtBase: number;
  grossMarginAtBase: number;
  netMarginAtBase: number;
  paybackDaysAtBase: number;
  inputs: { commodityId: string; name: string; qtyPerDay: number; unitValue: number; costPerDay: number }[];
  outputs: { commodityId: string; name: string; qtyPerDay: number; unitValue: number; revenuePerDay: number }[];
  byproducts: { commodityId: string; name: string; qtyPerDay: number }[];
  viable: boolean;
  notes: string[];
}

export interface ProductionLine {
  id: string;
  name: string;
  recipeId: string;
  propertyName: string;
  locationName: string;
  status: 'running' | 'idle' | 'broken' | 'suspended' | 'starved';
  automated: boolean;
  automationLevel: number;
  automationCostNext: number;
  efficiency: number;
  quality: number;
  capacityPerDay: number;
  effectiveCapacityPerDay: number;
  workers: { id: string; name: string; skill: number; morale: number }[];
  labourRequired: number;
  labourFactor: number;
  manager: string | null;
  inputs: { commodityId: string; name: string; inBuffer: number; neededPerDay: number; daysOfCover: number; localPrice: number; costPerDay: number }[];
  outputs: { commodityId: string; name: string; inBuffer: number; producedPerDay: number; unitPrice: number; valuePerDay: number }[];
  energyCostPerDay: number;
  opexPerDay: number;
  totalCostPerDay: number;
  outputValuePerDay: number;
  marginPerDay: number;
  blockers: string[];
  alerts: string[];
  producedTotal: number;
  wasteTotal: number;
  condition: number;
}

export interface ProductionView {
  locationId: string;
  lines: ProductionLine[];
  supplyChain: {
    lines: number;
    running: number;
    blocked: number;
    outputValuePerDay: number;
    costPerDay: number;
    marginPerDay: number;
    totalProduced: number;
    totalWaste: number;
    averageEfficiency: number;
    averageQuality: number;
    inputRequirements: { commodityId: string; name: string; neededPerDay: number; buffered: number; shortfallPerDay: number; localPrice: number }[];
    outputProducts: { commodityId: string; name: string; producedPerDay: number; valuePerDay: number }[];
    chains: { recipeId: string; name: string; lines: number; blockers: string[] }[];
  };
  buffers: { inputs: number; outputs: number; value: number };
  recipes: RecipeListing[];
}

/* ------------------------------------------------------------------ */
/* Crew, automation, missions, factions, combat, underground           */
/* ------------------------------------------------------------------ */

export interface EmployeeStats {
  skill: number;
  loyalty: number;
  morale: number;
  health: number;
  initiative: number;
  toughness: number;
  discretion: number;
}

export interface EmployeeRow {
  id: string;
  name: string;
  role: string;
  roleName: string;
  level: number;
  xp: number;
  xpToNext: number;
  status: string;
  hiredDay: number;
  daysEmployed: number;
  salaryPerDay: number;
  salaryShareOfRevenue: number;
  stats: EmployeeStats;
  skills: { skillId: string; name: string; level: number }[];
  injured: boolean;
  injuredUntilDay: number | null;
  trainingUntilDay: number | null;
  daysUnpaid: number;
  betrayalRisk: number;
  assignment: { kind: string; targetName: string; tier: number } | null;
  locationName: string;
  personalObjective: string;
  canPromote: boolean;
  trainingCost: number;
  automatedCapability?: string | null;
}

export interface CandidateRow {
  id: string;
  name: string;
  role: string;
  roleName: string;
  category: string;
  level: number;
  stats: EmployeeStats;
  salaryAskPerDay: number;
  hiringFee: number;
  skills: { skillId: string; name: string; level: number }[];
  personalObjective: string;
  locationName: string;
  here: boolean;
  loyaltyExpectation: number;
  automationCapability: string | null;
  valueScore: number;
}

export interface CrewView {
  employees: EmployeeRow[];
  candidates: CandidateRow[];
  summary: {
    headcount: number;
    active: number;
    injured: number;
    training: number;
    unassigned: number;
    payrollPerDay: number;
    payrollShareOfRevenue: number;
    averageLoyalty: number;
    averageMorale: number;
    averageSkill: number;
    averageLevel: number;
    span: { crew: number; capacity: number; managers: number; managerCapacity: number; overloaded: boolean; moralePenalty: number; explanation: string };
    unpaidWages: number;
    highestRisk: { id: string; name: string; reason: string; risk: number }[];
    byRole: { role: string; count: number; payrollPerDay: number }[];
    byAssignment: { kind: string; count: number }[];
  };
  span: { crew: number; capacity: number; managers: number; managerCapacity: number; overloaded: boolean; moralePenalty: number; explanation: string };
  payrollForecastPerDay: number;
}

/**
 * A policy knob on a rule kind, exactly as the server publishes it.
 *
 * The automation screen renders its create/edit forms from this: a field the server did
 * not describe cannot be invented by the client, and the server re-validates and clamps
 * every value regardless of what the browser sends.
 */
export interface RuleConfigField {
  key: string;
  label: string;
  type: 'number' | 'boolean' | 'select';
  min?: number;
  max?: number;
  step?: number;
  defaultValue: number | boolean | string;
  help: string;
  options?: string[];
}

export interface AutomationRuleView {
  id: string;
  name: string;
  kind: string;
  kindLabel: string;
  enabled: boolean;
  manager: { id: string; name: string; role: string; skill: number; morale: number; loyalty: number; salaryPerDay: number } | null;
  uptime: number;
  errorChance: number;
  errorCostFraction: number;
  config: Record<string, unknown>;
  schema: RuleConfigField[];
  lastRunDay: number | null;
  /** The last thing this rule did, as the dispatcher recorded it. */
  lastResult: {
    day: number;
    success: boolean;
    profit: number;
    message: string;
    actions: string[];
    errorKind?: 'insufficient_funds' | 'no_capacity' | 'market_closed' | 'manager_error' | 'risk_avoided';
  } | null;
  totalRuns: number;
  totalErrors: number;
  totalProfit: number;
  errorRate: number;
  createdDay: number;
  /** Days until this rule may fire again (0 = ready). */
  cooldownDays: number;
}

export interface AutomationView {
  rules: AutomationRuleView[];
  availableKinds: { kind: string; label: string; configured: boolean; managerAvailable: boolean; managerName: string | null; schema: RuleConfigField[] }[];
  delegation: { rules: number; enabled: number; managers: number; rulesPerManager: number; capacity: number; overloaded: boolean; tiers: { tier: string; count: number; description: string }[] };
  totalProfit: number;
  totalRuns: number;
  totalErrors: number;
  profitToday: number;
  automationProfitAllTime: number;
  /** Crew who can hold a rule: role, automation capability and current rule count. */
  managers: { id: string; name: string; role: string; capability: string; skill: number; rules: number }[];
}

export interface MissionObjective {
  id: string;
  description: string;
  current: number;
  required: number;
  progress: number;
  completed: boolean;
}

export interface MissionRow {
  id: string;
  defId: string;
  title: string;
  description: string;
  giverName: string;
  giverFactionId: string | null;
  kind: string;
  difficulty: number;
  status: string;
  acceptedDay: number;
  deadlineDay: number;
  daysRemaining: number;
  rewardCash: number;
  rewardXp: number;
  risk: number;
  progress: number;
  objectives: MissionObjective[];
  reputationRewards: { dimension: string; amount: number }[];
  unlockReason: string | null;
  unlocks: { id: string; title: string }[];
}

export interface MissionsView {
  offers: MissionRow[];
  active: MissionRow[];
  history: MissionRow[];
  nextRefreshDay: number;
  maxActive: number;
  completed: number;
  failed: number;
  locked: { defId: string; title: string; reason: string }[];
}

export interface FactionRow {
  id: string;
  name: string;
  kind: string;
  kindLabel: string;
  description: string;
  goals: string[];
  services: string[];
  resources: number;
  power: number;
  aggression: number;
  mood: number;
  playerStanding: number;
  standingLabel: string;
  recruitmentRequirement: number;
  canUseServices: boolean;
  territory: { id: string; name: string; here: boolean }[];
  atWarWith: { id: string; name: string }[];
  alliedWith: { id: string; name: string }[];
  relations: { id: string; name: string; value: number }[];
  /** Commodity categories this faction cares about. */
  interests: string[];
  offers: {
    id: string;
    kind: string;
    kindLabel: string;
    description: string;
    reward: number;
    standingDelta: number;
    risk: number;
    expiresDay: number;
    daysLeft: number;
    accepted: boolean | null;
  }[];
  tributeOwed: number;
  controlsCurrentLocation: boolean;
}

export interface FactionOverview {
  total: number;
  wars: { a: string; b: string; sinceBalance: number }[];
  controllerHere: { id: string; name: string; kind: string } | null;
  territoryChanges30d: number;
  bestStanding: { name: string; standing: number } | null;
  worstStanding: { name: string; standing: number } | null;
  offersOpen: number;
  tributeDemands: number;
  servicesAvailable: { faction: string; service: string }[];
  /** Pressure the factions currently able to act here place on the player. */
  factionPressure: number;
}

export interface FactionsView {
  factions: FactionRow[];
  overview: FactionOverview;
  /** Keyed by faction id: the categories it buys into, with an indicative value. */
  interests: Record<string, { category: string; commodities: number; exampleValue: number }[]>;
}

export interface CombatParticipant {
  id: string;
  name: string;
  /** `ally` counts as your side; the server's own odds calculation treats anything not `enemy` as friendly. */
  side: 'player' | 'ally' | 'enemy';
  hp: number;
  maxHp: number;
  hpPct: number;
  ap: number;
  maxAp: number;
  accuracy: number;
  /** Damage per hit, as the server's own range — never a single client-chosen number. */
  damage: [number, number];
  defense: number;
  position: { x: number; y: number };
  /** Whether they are behind cover right now. */
  cover: boolean;
  alive: boolean;
  tier?: string;
  description?: string;
}

export interface CombatLogEntry {
  turn: number;
  actorId: string;
  actorName: string;
  action: string;
  targetId: string | null;
  targetName: string | null;
  damage: number;
  detail: string;
  critical: boolean;
}

export interface CombatStakes {
  lossCash: number;
  lossInventoryFraction: number;
  arrestChance: number;
  injuryChance: number;
  deathChance: number;
  xpReward: number;
  reputationReward: { dimension: string; amount: number }[];
  loot: { commodityId?: string; cash?: number }[];
  defendedPropertyId: string | null;
  defendedShipmentId: string | null;
}

/** Mirrors the server's own `combat.take_turn` action union (`src/sim/validation.ts`). */
export type CombatAction =
  | { type: 'attack'; targetId: string }
  | { type: 'move'; x: number; y: number }
  | { type: 'cover' }
  | { type: 'flee' }
  | { type: 'negotiate' }
  | { type: 'intimidate' }
  | { type: 'bribe'; amount: number }
  | { type: 'useItem'; commodityId: string }
  | { type: 'wait' };

export interface CombatEstimate {
  action: CombatAction;
  label: string;
  apCost: number;
  successChance: number;
  /** Rendered text from the server (it may be a range or a sentence). */
  expectedValue: string;
  available: boolean;
  reason?: string;
}

export interface CombatOutcome {
  victory: boolean;
  fled: boolean;
  arrested: boolean;
  bribed: boolean;
  negotiated: boolean;
  casualties: { id: string; name: string; status: 'injured' | 'dead' | 'captured' | 'fled' }[];
  lootCash: number;
  lootItems: { commodityId: string; qty: number }[];
  xpGained: number;
  reputationChanges: { dimension: string; amount: number; reason: string }[];
  heatChange: number;
  summary: string;
}

export interface CombatView {
  id: string;
  kind: string;
  locationName: string;
  turn: number;
  turnLimit: number;
  phase: string;
  autoResolved: boolean;
  grid: { width: number; height: number };
  participants: CombatParticipant[];
  log: CombatLogEntry[];
  stakes: CombatStakes;
  estimates: CombatEstimate[];
  canFlee: boolean;
  canNegotiate: boolean;
  canBribe: boolean;
  bribeAmount: number;
  outcome: CombatOutcome | null;
  /** The server's own read on the fight: a chance plus the reasoning behind it. */
  odds: { victoryChance: number; explanation: string };
}

/**
 * A policy knob on a rule kind, exactly as the server publishes it.
 *
 * The automation screen renders its create/edit forms from this: a field the server did
 * not describe cannot be invented by the client, and the server re-validates and clamps
 * every value regardless of what the browser sends.
 */
export interface RuleConfigField {
  key: string;
  label: string;
  type: 'number' | 'boolean' | 'select';
  min?: number;
  max?: number;
  step?: number;
  defaultValue: number | boolean | string;
  help: string;
  options?: string[];
}

export interface AutomationRuleView {
  id: string;
  name: string;
  kind: string;
  kindLabel: string;
  enabled: boolean;
  manager: { id: string; name: string; role: string; skill: number; morale: number; loyalty: number; salaryPerDay: number } | null;
  uptime: number;
  errorChance: number;
  errorCostFraction: number;
  config: Record<string, unknown>;
  schema: RuleConfigField[];
  lastRunDay: number | null;
  /** The last thing this rule did, as the dispatcher recorded it. */
  lastResult: {
    day: number;
    success: boolean;
    profit: number;
    message: string;
    actions: string[];
    errorKind?: 'insufficient_funds' | 'no_capacity' | 'market_closed' | 'manager_error' | 'risk_avoided';
  } | null;
  totalRuns: number;
  totalErrors: number;
  totalProfit: number;
  errorRate: number;
  createdDay: number;
  /** Days until this rule may fire again (0 = ready). */
  cooldownDays: number;
}

export interface AutomationView {
  rules: AutomationRuleView[];
  availableKinds: { kind: string; label: string; configured: boolean; managerAvailable: boolean; managerName: string | null; schema: RuleConfigField[] }[];
  delegation: { rules: number; enabled: number; managers: number; rulesPerManager: number; capacity: number; overloaded: boolean; tiers: { tier: string; count: number; description: string }[] };
  totalProfit: number;
  totalRuns: number;
  totalErrors: number;
  profitToday: number;
  automationProfitAllTime: number;
  /** Crew who can hold a rule: role, automation capability and current rule count. */
  managers: { id: string; name: string; role: string; capability: string; skill: number; rules: number }[];
}

export interface MissionObjective {
  id: string;
  description: string;
  current: number;
  required: number;
  progress: number;
  completed: boolean;
}

export interface MissionRow {
  id: string;
  defId: string;
  title: string;
  description: string;
  giverName: string;
  giverFactionId: string | null;
  kind: string;
  difficulty: number;
  status: string;
  acceptedDay: number;
  deadlineDay: number;
  daysRemaining: number;
  rewardCash: number;
  rewardXp: number;
  risk: number;
  progress: number;
  objectives: MissionObjective[];
  reputationRewards: { dimension: string; amount: number }[];
  unlockReason: string | null;
  unlocks: { id: string; title: string }[];
}

export interface MissionsView {
  offers: MissionRow[];
  active: MissionRow[];
  history: MissionRow[];
  nextRefreshDay: number;
  maxActive: number;
  completed: number;
  failed: number;
  locked: { defId: string; title: string; reason: string }[];
}

export interface FactionRow {
  id: string;
  name: string;
  kind: string;
  kindLabel: string;
  description: string;
  goals: string[];
  services: string[];
  resources: number;
  power: number;
  aggression: number;
  mood: number;
  playerStanding: number;
  standingLabel: string;
  recruitmentRequirement: number;
  canUseServices: boolean;
  territory: { id: string; name: string; here: boolean }[];
  atWarWith: { id: string; name: string }[];
  alliedWith: { id: string; name: string }[];
  relations: { id: string; name: string; value: number }[];
  /** Commodity categories this faction cares about. */
  interests: string[];
  offers: {
    id: string;
    kind: string;
    kindLabel: string;
    description: string;
    reward: number;
    standingDelta: number;
    risk: number;
    expiresDay: number;
    daysLeft: number;
    accepted: boolean | null;
  }[];
  tributeOwed: number;
  controlsCurrentLocation: boolean;
}

export interface FactionOverview {
  total: number;
  wars: { a: string; b: string; sinceBalance: number }[];
  controllerHere: { id: string; name: string; kind: string } | null;
  territoryChanges30d: number;
  bestStanding: { name: string; standing: number } | null;
  worstStanding: { name: string; standing: number } | null;
  offersOpen: number;
  tributeDemands: number;
  servicesAvailable: { faction: string; service: string }[];
  /** Pressure the factions currently able to act here place on the player. */
  factionPressure: number;
}

export interface FactionsView {
  factions: FactionRow[];
  overview: FactionOverview;
  /** Keyed by faction id: the categories it buys into, with an indicative value. */
  interests: Record<string, { category: string; commodities: number; exampleValue: number }[]>;
}

export interface DarknetMarketView {
  id: string;
  name: string;
  known: boolean;
  vendorReputation: number;
  escrowFeeFraction: number;
  minimumDeposit: number;
  focus: string[];
  minDigitalReputation: number;
  yourReputationWithThem: number;
  listings: number;
  description: string;
  accessible: boolean;
  /** Why it is not accessible — the server's own words, never a client guess. */
  reason?: string;
}

export interface DarknetListing {
  marketId: string;
  marketName: string;
  commodityId: string;
  name: string;
  category: string;
  legality: string;
  unitPrice: number;
  openMarketPrice: number | null;
  premiumVsOpen: number;
  escrowFee: number;
  deliveryChance: number;
  available: number;
  qty: number;
  totalWithFees: number;
  tradable: boolean;
  reason?: string;
  vendorReputation: number;
  heatOnPurchase: number;
}

export interface HackTarget {
  kind: 'company' | 'bank' | 'exchange' | 'faction' | 'venue';
  targetId: string;
  name: string;
  difficulty: number;
  successChance: number;
  rewardEstimate: number;
  heatOnFailure: number;
  traceHeat: number;
  lootKind: string;
  description: string;
}

export interface UndergroundCore {
  accessUnlocked: boolean;
  accessCost: number;
  handle: string;
  digitalReputation: number;
  digitalReputationLabel: string;
  escrowBalance: number;
  traceHeat: number;
  traceHeatLabel: string;
  vpnQuality: number;
  vpnUpgradeCost: number;
  compromised: boolean;
  compromisedUntilDay: number | null;
  hackCooldownUntilDay: number | null;
  markets: DarknetMarketView[];
  assets: {
    id: string;
    name: string;
    kind: string;
    acquiredDay: number;
    ageDays: number;
    freshness: number;
    value: number;
    baseValue: number;
    riskOnHold: number;
    targetId: string | null;
    decayPerDay: number;
  }[];
  /** Data types the player could buy at the current reputation. */
  dataOffers: { kind: string; name: string; price: number; baseValue: number; freshnessPerDay: number; riskOnHold: number; buyers: string; description: string }[];
  hackTargets: HackTarget[];
  hiddenChannelListings: number;
  stats: { dataSold: number; dataRevenue: number; hacksSuccess: number; hacksFailed: number; exitScams: number; hackRevenue: number };
}

export interface UndergroundView {
  view: UndergroundCore;
  /** The same venues, for screens that render the market board on its own. */
  markets: DarknetMarketView[];
  /** Populated only when `marketId` is passed to the view. */
  listings: DarknetListing[];
}

/* ------------------------------------------------------------------ */
/* World, travel, ledger, profile                                      */
/* ------------------------------------------------------------------ */

export interface WorldView {
  indicators: {
    inflationYoY: number;
    interestRate: number;
    unemployment: number;
    consumerConfidence: number;
    gdpGrowth: number;
    stockIndexChange30d: number;
    cryptoIndexChange30d: number;
    cyclePhaseLabel: string;
    averageCommodityPriceIndex: number;
    tradeVolume30d: number;
    globalRiskAppetite: number;
  };
  world: {
    day: number;
    inflationIndex: number;
    inflationRate: number;
    interestRate: number;
    cyclePhase: number;
    cycleFactor: number;
    globalSentiment: number;
    stockIndex: number;
    cryptoIndex: number;
    unemployment: number;
    consumerConfidence: number;
    gdpIndex: number;
    indicators: WorldView['indicators'];
    shocks: { id: string; name: string; scope: string; severity: string; startedDay: number; expiresDay: number | null; priceModifiers: Record<string, number>; demandModifiers: Record<string, number>; supplyModifiers: Record<string, number>; locationIds: string[]; regionIds: string[] }[];
    activeEvents: {
      id: string;
      defId: string;
      name: string;
      description: string;
      scope: string;
      severity: string;
      startedDay: number;
      expiresDay: number | null;
      locationIds: string[];
      regionIds: string[];
      appliedEffects: string[];
      chainDepth: number;
    }[];
    news: { id: string; day: number; read: boolean; scope: string; category: string; headline: string; body?: string; locationId?: string | null; commodityId?: string | null }[];
    stockIndexHistory: { day: number; level: number }[];
    cryptoIndexHistory: { day: number; level: number }[];
  };
}

export interface Destination {
  locationId: string;
  name: string;
  country: string;
  region: string;
  kind: string;
  distanceKm: number;
  days: number;
  cost: number;
  risk: number;
  borders: number;
  reachable: boolean;
  reason?: string;
  discovered: boolean;
  traded: number;
  lockdown: boolean;
}

export interface TravelPlan {
  ok: boolean;
  code?: string;
  reason?: string;
  hint?: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  mode: string;
  legs: { from: string; to: string; distanceKm: number; mode: string; borderCrossing: boolean; risk: number; days: number }[];
  distanceKm: number;
  borderCrossings: number;
  days: number;
  costs: { label: string; amount: number; note?: string }[];
  totalCost: number;
  cashAvailable: number;
  vehicle: { id: string; name: string; capacityKg: number; fuel: number; condition: number } | null;
  cargoKg: number;
  cargoL: number;
  capacityKg: number;
  capacityL: number;
  overCapacityKg: number;
  overCapacityL: number;
  cargo: { commodityId: string; name: string; qty: number; unit: string; weightKg: number; volumeL: number }[];
  contrabandValue: number;
  contrabandUnits: number;
  detectionChancePerBorder: number;
  seizureValueAtRisk: number;
  encounterChancePerLeg: number;
  bribeCostPerBorder: number;
  bribeSuccessChance: number;
  xp: number;
  warnings: string[];
  routeRisk: number;
  discovered: boolean;
}

export interface DestinationsView {
  from: string;
  fromName: string;
  mode: string;
  unchartedLocations: number;
  nodes: {
    id: string;
    name: string;
    country: string;
    region: string;
    kind: string;
    map: { x: number; y: number };
    here: boolean;
    traded: number;
    lockdown: boolean;
    services: { bank: boolean; stockExchange: boolean; cryptoExchange: boolean; darknetAccess: boolean; loanSharks: boolean; auctionHouse: boolean; offshore: boolean };
  }[];
  edges: { id: string; from: string; to: string; distanceKm: number; risk: number; borderCrossing: boolean; customsIntensity: number; modes: string[] }[];
  destinations: Destination[];
  modes: { mode: string; label: string; days: number; cost: number; ok: boolean; reason?: string; requiresVehicle: boolean; vehicleName: string | null }[];
  plan: TravelPlan | null;
}

export interface JourneyView {
  inProgress: boolean;
  mode: string;
  modeLabel: string;
  from: string;
  to: string;
  departedDay: number;
  arrivesDay: number;
  daysRemaining: number;
  progress: number;
  cost: number;
  vehicle: string | null;
  crew: string[];
  risk: number;
  encounterPending: boolean;
}

export interface LedgerView {
  total: number;
  rows: {
    id: string;
    day: number;
    kind: string;
    description: string;
    amount: number;
    balanceAfter: number;
    accountId: string;
    counterparty?: string | null;
    locationId?: string | null;
  }[];
}

export interface ProfileView {
  player: {
    id: string;
    name: string;
    createdDay: number;
    locationId: string;
    accounts: { id: string; institution: string; kind: string; locationId: string; balance: number; dirtyBalance: number; currency: string; apy: number; openedDay: number; frozen: boolean }[];
    loans: unknown[];
    creditScore: number;
    creditHistory: { day: number; score: number; reason: string }[];
    inventory: { id: string; commodityId: string; qty: number; avgCost: number; acquiredDay: number; quality: number; expiresDay: number | null; storageId: string; concealed: boolean }[];
    storages: { id: string; kind: string; name: string; locationId: string; capacityKg: number; capacityL: number }[];
    vehicles: { id: string; defId: string; name: string; locationId: string; fuel: number; condition: number }[];
    properties: { id: string; defId: string; name: string; locationId: string }[];
    businesses: { id: string; defId: string; name: string; locationId: string }[];
    productionLines: { id: string; recipeId: string; propertyId: string; status: string }[];
    crew: { id: string; name: string; role: string; level: number }[];
    hiringPool: { id: string; name: string; role: string; level: number; salaryAskPerDay: number; hiringFee: number }[];
    stockHoldings: unknown[];
    cryptoHoldings: unknown[];
    miningRigs: unknown[];
    notifications: { id: string; day: number; kind: string; title: string; body: string; read: boolean; link: string | null }[];
    netWorthHistory: { day: number; total: number; cash: number; inventory: number; properties: number; businesses: number; stocks: number; crypto: number; vehicles: number; debt: number }[];
  };
  ending: { kind: string; title: string; summary: string; day: number } | null;
  day: number;
}

export interface LocationView {
  id: string;
  name: string;
  country: string;
  region: string;
  kind: string;
  description: string;
  map: { x: number; y: number };
  population: number;
  economy: { wealthIndex: number; industrialIndex: number; serviceIndex: number; unemployment: number };
  security: number;
  risk: number;
  laws: { legalityOverrides: Record<string, string>; taxRate: number; enforcement: number; corruption: number; tolerated: string[] };
  services: { bank: boolean; offshore: boolean; stockExchange: boolean; cryptoExchange: boolean; darknetAccess: boolean; loanSharks: boolean; auctionHouse: boolean };
  specialties: { id: string; name: string }[];
  isCurrent: boolean;
  lockdown: boolean;
  playerHeat: number;
  discovered: boolean;
  market: MarketSummary;
}

/**
 * The save's own bookkeeping.
 *
 * Two server shapes reach the client: the state projection's `meta` (identity plus
 * `config`/`lastTickDay`) and a command response's `meta` (the fuller `SaveMetadata`).
 * Every field the shell reads is present in both, so one structural type covers the
 * pair without either producer having to change.
 */
export interface GameMeta {
  gameId: string;
  name: string;
  status: string;
  version: number;
  turn: number;
  day: number;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  userId?: string;
  level?: number;
  title?: string;
  netWorth?: number;
  empireScore?: number;
  worldSeed?: string;
  difficulty?: string;
  locationId?: string;
  incarcerated?: boolean;
  endingKind?: string | null;
  lastTickDay?: number;
  config?: GameStateDto['meta']['config'];
}

export interface GameSummary {
  meta: {
    gameId: string;
    name: string;
    status: string;
    version: number;
    day: number;
    turn: number;
    level: number;
    title: string;
    netWorth: number;
    empireScore: number;
    worldSeed: string;
    difficulty: string;
    locationId: string;
    incarcerated: boolean;
    endingKind: string | null;
    createdAt: string;
    updatedAt: string;
    schemaVersion: number;
    userId: string;
    name2?: never;
  };
  status: string;
  cash: number;
  actionsLeft: number;
  notificationsUnread: number;
}

/* ------------------------------------------------------------------ */
/* Fetchers                                                            */
/* ------------------------------------------------------------------ */

type Params = Record<string, string | number | boolean>;

/** One read model. Thin wrapper so screens never build URLs by hand. */
export function view<T>(gameId: string, name: string, params: Params = {}): Promise<T> {
  return api.view<T>(gameId, name, params).then((response) => response.data);
}

export const data = {
  market: (gameId: string, params: Params = {}) => view<MarketView>(gameId, 'market', params),
  finance: (gameId: string) => view<FinanceView>(gameId, 'finance'),
  stocks: (gameId: string, params: Params = {}) => view<StocksView>(gameId, 'stocks', params),
  crypto: (gameId: string, params: Params = {}) => view<CryptoView>(gameId, 'crypto', params),
  automation: (gameId: string) => view<AutomationView>(gameId, 'automation'),
  missions: (gameId: string) => view<MissionsView>(gameId, 'missions'),
  combat: (gameId: string) => view<CombatView | null>(gameId, 'combat'),
  underground: (gameId: string, params: Params = {}) => view<UndergroundView>(gameId, 'underground', params),
  factions: (gameId: string) => view<FactionsView>(gameId, 'factions'),
  inventory: (gameId: string, params: Params = {}) => view<InventoryView>(gameId, 'inventory', params),
  progression: (gameId: string) => view<ProgressionView>(gameId, 'progression'),
  businesses: (gameId: string, params: Params = {}) => view<BusinessesView>(gameId, 'businesses', params),
  production: (gameId: string, params: Params = {}) => view<ProductionView>(gameId, 'production', params),
  properties: (gameId: string, params: Params = {}) => view<PropertiesView>(gameId, 'properties', params),
  logistics: (gameId: string) => view<LogisticsView>(gameId, 'logistics'),
  crew: (gameId: string) => view<CrewView>(gameId, 'crew'),
  travel: (gameId: string) => view<JourneyView | null>(gameId, 'travel'),
  destinations: (gameId: string, params: Params = {}) => view<DestinationsView>(gameId, 'destinations', params),
  world: (gameId: string) => view<WorldView>(gameId, 'world'),
  ledger: (gameId: string, params: Params = {}) => view<LedgerView>(gameId, 'ledger', params),
  profile: (gameId: string, params: Params = {}) => view<ProfileView>(gameId, 'profile', params),
  location: (gameId: string, params: Params = {}) => view<LocationView | null>(gameId, 'location', params),
};

/* Progression is defined here because it is the one view with a catalogue payload. */
export interface ProgressionSkill {
  id: string;
  name: string;
  description: string;
  tree: string;
  maxLevel: number;
  level: number;
  effectPerLevel: string;
  prerequisites: { skillId: string; level: number }[];
  canLearn: boolean;
  reason: string | null;
}

export interface ProgressionPerk {
  id: string;
  name: string;
  description: string;
  tree: string;
  modifiers: Record<string, number>;
  requiresSkillId: string | null;
  requiresSkillLevel: number | null;
  taken: boolean;
  canTake: boolean;
  reason: string | null;
}

export interface ProgressionView {
  level: number;
  title: string;
  xp: number;
  xpToNext: number;
  xpProgress: number;
  skillPoints: number;
  perkPoints: number;
  skills: { id: string; name: string; level: number; maxLevel: number; tree: string; effect: string }[];
  perks: { id: string; name: string; description: string; modifiers: Record<string, number> }[];
  achievementsEarned: number;
  achievementsTotal: number;
  prestigeCount: number;
  legacyBonus: number;
  reputation: Record<string, number>;
  resolvedModifiers: Record<string, number>;
  skillCatalogue: ProgressionSkill[];
  perkCatalogue: ProgressionPerk[];
  achievements: { id: string; name: string; description: string; earned: boolean; earnedDay: number | null; metrics: { metric: string; current: number; target: number; op: string }[]; progress: number }[];
  respecCost: number;
  prestigeFacts: {
    count: number;
    lastPrestigeDay: number | null;
    day: number;
    legacyBonus: number;
    legacyBonusCap: number;
    maxPrestiges: number;
    minDaysBetween: number;
    netWorthRequirement: number;
    requireDebtsSettled: boolean;
    netWorth: number;
    outstandingDebt: number;
  };
}
