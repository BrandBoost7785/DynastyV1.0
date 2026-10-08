/**
 * Core domain types for the Dynasty simulation.
 *
 * Two families of types live here:
 *
 *  1. `*Def`   — immutable, data-driven **definitions** loaded from registries
 *                (commodities, locations, factions, vehicles, …). These are the
 *                "static" world data and are never mutated at runtime.
 *  2. `*State` — mutable **simulation state** persisted with a save.
 *
 * Keeping them separate is what allows the world to be extended (more
 * commodities, locations, factions) by adding registry data without touching
 * engine code, and it is the boundary a future multiplayer layer would split
 * along: `WorldState` is shared/authoritative, `PlayerState` is per-player.
 */

import type { RngState } from '../engine/rng';

export type ID = string;

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export type Legality = 'legal' | 'restricted' | 'illegal' | 'contraband';

export type CommodityCategory =
  | 'agriculture'
  | 'livestock'
  | 'foodstuff'
  | 'beverage'
  | 'textile'
  | 'raw_material'
  | 'metal'
  | 'energy'
  | 'chemical'
  | 'pharmaceutical'
  | 'narcotic'
  | 'medical'
  | 'manufactured'
  | 'electronics'
  | 'technology'
  | 'luxury'
  | 'art'
  | 'weapon'
  | 'equipment'
  | 'vehicle_part'
  | 'construction'
  | 'industrial'
  | 'information'
  | 'financial_asset'
  | 'crypto_asset'
  | 'contraband_misc';

export type MarketType = 'public' | 'licensed' | 'black' | 'darknet' | 'exchange';

export type StorageRequirement = 'none' | 'refrigerated' | 'hazardous' | 'secure' | 'climate';

export type TravelMode =
  | 'foot'
  | 'bus'
  | 'car'
  | 'truck'
  | 'train'
  | 'ferry'
  | 'air'
  | 'private_jet'
  | 'cargo_ship';

export type LocationKind =
  | 'city'
  | 'port'
  | 'airport'
  | 'trading_hub'
  | 'industrial'
  | 'financial_center'
  | 'rural'
  | 'border'
  | 'hidden_market'
  | 'underground'
  | 'offshore'
  | 'special';

export type Severity = 'minor' | 'moderate' | 'major' | 'catastrophic';

export type EventScope = 'local' | 'regional' | 'national' | 'global';

/* ------------------------------------------------------------------ */
/* Definitions (registry data — immutable)                             */
/* ------------------------------------------------------------------ */

export interface UnlockCondition {
  minLevel?: number;
  minSkill?: { skillId: string; level: number };
  minReputation?: { dimension: ReputationDimension; value: number };
  minFactionStanding?: { factionId: string; value: number };
  requiresPerk?: string;
  requiresDiscovery?: string;
}

export interface CommodityDef {
  id: ID;
  /** Base good this SKU is a variant of (see `forms.ts`). */
  baseId: ID;
  /** Processing/grading form of the base good. */
  formId: string;
  name: string;
  category: CommodityCategory;
  legality: Legality;
  /** Long-run fundamental value per unit, in game currency. */
  baseValue: number;
  weightKg: number;
  volumeL: number;
  /** 1 (common) … 5 (exotic). Drives availability and price ceiling. */
  rarity: 1 | 2 | 3 | 4 | 5;
  /** 0…1 — how violently price moves day to day. */
  volatility: number;
  /** 0…1 — legal/enforcement risk of holding or moving it. */
  risk: number;
  shelfLifeDays: number | null;
  storage: StorageRequirement;
  /** 0…1 — how often it is stocked anywhere at all. */
  availability: number;
  /** Baseline daily consumer demand in units, before modifiers. */
  baseDemand: number;
  /** Demand response to price. Higher = demand falls faster as price rises. */
  elasticity: number;
  marketTypes: MarketType[];
  /** Region-specific demand multipliers (regional specialisation/taste). */
  regionalPreference: Record<string, number>;
  unit: string;
  tags: string[];
  description: string;
  unlock?: UnlockCondition;
  /** True for commodities that only exist as tradeable financial instruments. */
  isInstrument?: boolean;
}

export interface LocationLaws {
  /** Category-level legality overrides for this jurisdiction. */
  legalityOverrides: Partial<Record<CommodityCategory, Legality>>;
  /** Sales/import tax rate applied to legal transactions here. */
  taxRate: number;
  /** 0…1 — how aggressively enforcement operates. */
  enforcement: number;
  /** 0…1 — how easily officials can be bribed. */
  corruption: number;
  /** Whether a given legality is tolerated at all. */
  tolerated: Legality[];
}

export interface LocationDef {
  id: ID;
  name: string;
  countryId: ID;
  countryName: string;
  regionId: ID;
  regionName: string;
  kind: LocationKind;
  /** Abstract map coordinates (0…100) used by the world map view. */
  map: { x: number; y: number };
  population: number;
  economy: {
    /** 0…1 relative wealth — drives demand for luxuries and price levels. */
    wealthIndex: number;
    industrialIndex: number;
    serviceIndex: number;
    unemployment: number;
  };
  laws: LocationLaws;
  /** 0…1 — general safety for the player. */
  security: number;
  /** 0…1 — baseline danger of operating here. */
  risk: number;
  /** Demand multipliers per commodity category. */
  demandProfile: Partial<Record<CommodityCategory, number>>;
  /** Commodities actually traded here (materialised market set). */
  tradedCommodityIds: ID[];
  /** Commodities produced cheaply/abundantly here (geographic specialisation). */
  specialties: ID[];
  financialServices: {
    bank: boolean;
    offshore: boolean;
    stockExchange: boolean;
    cryptoExchange: boolean;
    darknetAccess: boolean;
    loanSharks: boolean;
    auctionHouse: boolean;
  };
  infrastructure: number;
  factionIds: ID[];
  /** Hidden locations must be discovered before travel/trade. */
  hidden: boolean;
  discoveryRequirement?: {
    minUndergroundRep?: number;
    minLevel?: number;
    cost?: number;
    requiresContact?: string;
    intelRequired?: number;
  };
  costOfLivingIndex: number;
  description: string;
}

export interface RouteDef {
  id: ID;
  from: ID;
  to: ID;
  distanceKm: number;
  modes: TravelMode[];
  borderCrossing: boolean;
  /** 0…1 additional risk from the route itself (terrain, policing, pirates). */
  baseRisk: number;
  /** Customs scrutiny applied on this route. */
  customsIntensity: number;
}

export interface FactionDef {
  id: ID;
  name: string;
  kind:
    | 'criminal_syndicate'
    | 'corporation'
    | 'government'
    | 'guild'
    | 'militia'
    | 'cartel'
    | 'bank'
    | 'intelligence'
    | 'cult'
    | 'union';
  description: string;
  goals: string[];
  resources: number;
  /** 0…1 combat/economic power. */
  power: number;
  territoryIds: ID[];
  interests: CommodityCategory[];
  rivalIds: ID[];
  allyIds: ID[];
  /** Standing required to access faction services. */
  recruitmentRequirement: number;
  services: ('loans' | 'protection' | 'intel' | 'smuggling' | 'contracts' | 'laundering' | 'mercenary' | 'legal' | 'logistics')[];
}

export interface SkillDef {
  id: ID;
  name: string;
  description: string;
  tree: 'trading' | 'finance' | 'logistics' | 'combat' | 'diplomacy' | 'technology' | 'business' | 'criminal';
  maxLevel: number;
  /** Skill ids that must reach `prerequisiteLevel` first. */
  prerequisites: { skillId: ID; level: number }[];
  /** Per-level effect description shown in the UI (why it matters). */
  effectPerLevel: string;
}

export interface PerkDef {
  id: ID;
  name: string;
  description: string;
  tree: SkillDef['tree'];
  requiresSkill?: { skillId: ID; level: number };
  requiresPerk?: ID;
  minLevel?: number;
  /** Numeric modifiers applied by the engine, keyed by well-known names. */
  modifiers: Record<string, number>;
  mutuallyExclusive?: ID[];
}

export interface VehicleDef {
  id: ID;
  name: string;
  kind: 'car' | 'van' | 'truck' | 'motorcycle' | 'boat' | 'aircraft' | 'trailer' | 'armored';
  price: number;
  capacityKg: number;
  capacityL: number;
  speedKmPerDay: number;
  fuelPerKm: number;
  maintenancePerKm: number;
  /** 0…1 — how well it evades inspection. */
  stealth: number;
  /** 0…1 — resistance to damage/boarding. */
  armor: number;
  hiddenCompartmentKg: number;
  reliability: number;
  upgradeSlots: number;
  requiredSkill?: { skillId: ID; level: number };
  description: string;
}

export interface VehicleUpgradeDef {
  id: ID;
  name: string;
  price: number;
  description: string;
  modifiers: {
    capacityKg?: number;
    capacityL?: number;
    stealth?: number;
    armor?: number;
    speed?: number;
    fuelEfficiency?: number;
    reliability?: number;
  };
}

export type PropertyKind =
  | 'safehouse'
  | 'warehouse'
  | 'office'
  | 'retail'
  | 'factory'
  | 'farm'
  | 'distribution_center'
  | 'transport_hub'
  | 'financial_facility'
  | 'entertainment'
  | 'research_facility'
  | 'tech_facility'
  | 'underground_facility'
  | 'offshore_entity'
  | 'residential';

export interface PropertyDef {
  id: ID;
  name: string;
  kind: PropertyKind;
  basePrice: number;
  /** Multiplied by the location's property index. */
  storageKg: number;
  storageL: number;
  security: number;
  refrigerated: boolean;
  hiddenCompartmentKg: number;
  /** 0…3 buildable upgrade tiers. */
  maxUpgradeLevel: number;
  upgradeCostBase: number;
  opexPerDay: number;
  staffSlots: number;
  /** Enables a business of this type on the property. */
  enablesBusinessId?: ID;
  /** Enables production recipes with this tag. */
  productionTags?: string[];
  description: string;
}

export type BusinessKind =
  | 'retail'
  | 'restaurant'
  | 'nightclub'
  | 'pawnshop'
  | 'import_export'
  | 'logistics_firm'
  | 'factory'
  | 'farm'
  | 'consultancy'
  | 'law_firm'
  | 'clinic'
  | 'casino'
  | 'laundromat'
  | 'tech_startup'
  | 'media'
  | 'security_firm'
  | 'brokerage'
  | 'darknet_front';

export interface BusinessDef {
  id: ID;
  name: string;
  kind: BusinessKind;
  setupCost: number;
  baseDailyRevenue: number;
  baseDailyOpex: number;
  staffSlots: number;
  /** 0…1 how much revenue depends on local demand vs. global conditions. */
  demandSensitivity: number;
  /** Can this business be used to launder money? */
  launderingCapacityPerDay: number;
  legality: Legality;
  requiredPropertyKind?: PropertyKind;
  requiredSkill?: { skillId: ID; level: number };
  reputationEffect: { dimension: ReputationDimension; perDay: number };
  description: string;
}

export interface ProductionRecipeDef {
  id: ID;
  name: string;
  /** Required property production tag. */
  requiresTag: string;
  inputs: { commodityId: ID; qty: number }[];
  outputs: { commodityId: ID; qty: number }[];
  byproducts?: { commodityId: ID; qty: number; chance: number }[];
  /** Units produced per day at 100% efficiency with full labour. */
  capacityPerDay: number;
  labourRequired: number;
  energyPerUnit: number;
  opexPerDay: number;
  /** Skill that raises efficiency/quality. */
  skillId: ID;
  /** Automation capex; enables unattended running. */
  automationCost: number;
  description: string;
}

export interface EmployeeRoleDef {
  id: string;
  name: string;
  category:
    | 'security'
    | 'operations'
    | 'finance'
    | 'technical'
    | 'diplomacy'
    | 'production'
    | 'commerce';
  baseSalary: number;
  primarySkill: ID;
  secondarySkills: ID[];
  /** What the role automates when assigned to a target. */
  automationCapability:
    | 'none'
    | 'auto_trade'
    | 'auto_logistics'
    | 'auto_business'
    | 'auto_production'
    | 'auto_finance'
    | 'combat'
    | 'intel'
    | 'laundering';
  description: string;
}

export interface EnemyDef {
  id: ID;
  name: string;
  archetype:
    | 'police'
    | 'swat'
    | 'rival_thug'
    | 'rival_elite'
    | 'mercenary'
    | 'faction_boss'
    | 'security_guard'
    | 'vigilante'
    | 'inspector'
    | 'cyber_daemon';
  hp: number;
  actionPoints: number;
  accuracy: number;
  damage: [number, number];
  defense: number;
  speed: number;
  /** 0…1 — can be bribed/talked down. */
  negotiable: number;
  tier: 'normal' | 'elite' | 'boss';
  /** Loot rolled on defeat. XP defaults to a tier-derived value when omitted. */
  lootTable: { commodityId?: ID; cash?: [number, number]; xp?: number }[];
  description: string;
}

export interface CompanyDef {
  id: ID;
  name: string;
  ticker: string;
  sector: string;
  countryId: ID;
  /** Baseline fundamentals used to seed the simulation. */
  marketCap: number;
  sharesOutstanding: number;
  revenueAnnual: number;
  margin: number;
  growth: number;
  dividendYieldAnnual: number;
  /** 0…1 sensitivity to the global economic cycle. */
  beta: number;
  /** Commodity categories whose prices feed this company's costs/revenue. */
  exposure: Partial<Record<CommodityCategory, number>>;
  description: string;
}

export interface CryptoAssetDef {
  id: ID;
  symbol: string;
  name: string;
  kind: 'store_of_value' | 'smart_contract' | 'stablecoin' | 'memecoin' | 'privacy' | 'exchange_token' | 'infrastructure';
  genesisPrice: number;
  maxSupply: number | null;
  circulatingSupply: number;
  /** Annual issuance as a fraction of circulating supply. */
  issuanceRate: number;
  volatility: number;
  /** 0…1 — how exposed to regulatory action. */
  regulatoryRisk: number;
  /** 0…1 — probability profile for protocol failure/exploit. */
  protocolRisk: number;
  peg?: { to: 'fiat'; value: number };
  stakeable: boolean;
  mineable: boolean;
  stakingApy: number;
  networkEffect: number;
  /** Days between issuance halvings; null when there is no halving schedule. */
  halvingIntervalDays: number | null;
  /** Units issued per block at genesis; null when the asset is not mineable. */
  genesisBlockReward: number | null;
  /** Target seconds between blocks; null when the asset is not mineable. */
  blockTimeSeconds: number | null;
  description: string;
}

/* ------------------------------------------------------------------ */
/* Dynamic world state                                                 */
/* ------------------------------------------------------------------ */

export interface MarketState {
  /** `${locationId}:${commodityId}` */
  key: string;
  locationId: ID;
  commodityId: ID;
  /** Current mid price. */
  price: number;
  /** Deterministic fundamental value for the current day (pre-deviation). */
  fundamental: number;
  supply: number;
  demand: number;
  /** 0…1 market mood; feeds news and UI sentiment gauges. */
  sentiment: number;
  /** Realised daily volatility (EWMA). */
  volatility: number;
  /** Multiplicative deviation from fundamental caused by actors/shocks. */
  deviation: number;
  /** Residual price impact from recent player trades, decays daily. */
  playerImpact: number;
  /** Active shock modifiers keyed by event id. */
  shocks: Record<ID, number>;
  /** Daily close ring buffer, oldest → newest (length ≤ configured history). */
  history: number[];
  /** Day the history buffer started. */
  historyStartDay: number;
  lastTradedDay: number;
  /** Cumulative units traded here (used by analytics + competitor AI). */
  volume30d: number;
  /** Human-readable reasons for the last price movement (UI "why"). */
  drivers: PriceDriver[];
}

export interface PriceDriver {
  label: string;
  /** Signed contribution to today's price change, as a fraction. */
  contribution: number;
  kind:
    | 'supply'
    | 'demand'
    | 'shock'
    | 'player'
    | 'competitor'
    | 'inflation'
    | 'cycle'
    | 'sentiment'
    | 'regional'
    | 'noise'
    | 'event';
  eventId?: ID;
}

export interface ActiveShock {
  id: ID;
  name: string;
  scope: EventScope;
  severity: Severity;
  startedDay: number;
  expiresDay: number | null;
  /** Multiplier applied to demand for matching categories. */
  demandModifiers: Partial<Record<CommodityCategory, number>>;
  /** Multiplier applied to supply for matching categories. */
  supplyModifiers: Partial<Record<CommodityCategory, number>>;
  locationIds: ID[];
  regionIds: ID[];
  /** Extra multiplier on price for affected categories. */
  priceModifiers: Partial<Record<CommodityCategory, number>>;
  sourceEventId?: ID;
}

export interface LocationState {
  locationId: ID;
  discovered: boolean;
  /** 0…1 political stability of the jurisdiction. */
  stability: number;
  lockdown: boolean;
  lockdownUntilDay: number | null;
  borderClosed: boolean;
  borderClosedUntilDay: number | null;
  sanctions: boolean;
  /** Local price level multiplier (cost of living + wealth drift). */
  priceLevel: number;
  controllingFactionId: ID | null;
  /** Enforcement heat directed at the player here. */
  playerHeat: number;
  /** 0…1 chance-per-day scaling of patrols. */
  patrolIntensity: number;
  disasterUntilDay: number | null;
  /** Local demand surge/decline per category from recent events. */
  demandShift: Partial<Record<CommodityCategory, number>>;
  /** Days since the player last visited. */
  lastVisitedDay: number | null;
}

export interface RouteState {
  routeId: ID;
  disrupted: boolean;
  disruptedUntilDay: number | null;
  disruptionReason: string | null;
  /** Current risk after events/patrols. */
  risk: number;
  costMultiplier: number;
}

export interface FactionState {
  factionId: ID;
  resources: number;
  power: number;
  aggression: number;
  /** Relationships to other factions, −100…100. */
  relations: Record<ID, number>;
  atWarWith: ID[];
  alliedWith: ID[];
  controlledLocationIds: ID[];
  /** Player standing with this faction, −100…100. */
  playerStanding: number;
  mood: number;
  lastActionDay: number;
  pendingOffers: FactionOffer[];
}

export interface FactionOffer {
  id: ID;
  kind: 'contract' | 'tribute' | 'alliance' | 'warning' | 'trade_access';
  description: string;
  /** Set on contract offers that map onto an authored mission. */
  missionId?: ID;
  createdDay: number;
  expiresDay: number;
  reward: number;
  standingDelta: number;
  risk: number;
  accepted: boolean | null;
}

export interface CompanyState {
  companyId: ID;
  /** Current share price. */
  price: number;
  /** Trailing twelve-month earnings per share. */
  eps: number;
  revenue: number;
  /** 0…1 investor mood for this name. */
  sentiment: number;
  sharesOutstanding: number;
  /** Ring buffer of daily closes. */
  history: number[];
  historyStartDay: number;
  dividendPerShareAnnual: number;
  lastDividendDay: number;
  status: 'active' | 'acquired' | 'bankrupt' | 'delisted';
  acquiredBy?: ID;
  /** Pending corporate action surfaced in the news feed. */
  pendingAction: string | null;
  fundamentalsQuality: number;
}

export interface CryptoAssetState {
  assetId: ID;
  price: number;
  circulatingSupply: number;
  /** 0…1 network/market sentiment. */
  sentiment: number;
  /** Relative mining/staking difficulty. */
  networkDifficulty: number;
  /** Liquidity depth in currency; drives slippage. */
  liquidity: number;
  history: number[];
  historyStartDay: number;
  /** Epoch count for halving-style issuance cuts. */
  halvingEpoch: number;
  status: 'active' | 'depegged' | 'rugged' | 'delisted' | 'forked';
  /** Staking/mining yield currently offered. */
  currentApy: number;
  lastEventDay: number | null;
  volatility: number;
}

export interface CompetitorState {
  id: ID;
  name: string;
  kind: 'trader' | 'syndicate' | 'corporation' | 'logistics';
  homeLocationId: ID;
  capital: number;
  aggression: number;
  /** Categories the competitor focuses on. */
  focus: CommodityCategory[];
  /** Locations they operate in — their activity moves those markets. */
  operatingLocationIds: ID[];
  reputation: number;
  lastActionDay: number;
  hostileToPlayer: boolean;
}

/**
 * One rival firm's balance sheet and standing in the trade network.
 *
 * Deliberately *not* the same record as `CompetitorState`: that one is the
 * world's coarse, regional presence (used for pressure on local books), while
 * this is the agent that actually buys, ships and sells. Keeping them separate
 * means a save written before Phase 3 migrates without ambiguity, and it keeps
 * the "who is moving this cargo" question answerable by id.
 */
export interface TradeAgentState {
  id: ID;
  name: string;
  homeLocationId: ID;
  /** Spendable working capital. Cargo and freight are paid from here. */
  capital: number;
  /** Commodity categories the firm specialises in. */
  focus: CommodityCategory[];
  /** Locations it is willing to buy or sell in. */
  operatingLocationIds: ID[];
  dispatched: number;
  delivered: number;
  lost: number;
  volume: number;
  realisedProfit: number;
  lastDispatchDay: number;
  status: 'active' | 'insolvent';
  /** Consecutive losing cargoes; reaching a threshold halts the firm. */
  losses: number;
}

/** A cargo in the world: bought at origin, in transit or settled. */
export interface TradeFlowState {
  id: ID;
  agentId: ID;
  commodityId: ID;
  originLocationId: ID;
  destinationLocationId: ID;
  routeId: ID;
  mode: TravelMode;
  qty: number;
  /** Landed cost per unit including freight, so profit is honest. */
  unitCost: number;
  /** Value at the destination's price when the leg was priced. */
  notionalValue: number;
  dispatchedDay: number;
  arrivesDay: number;
  status: 'in_transit' | 'delivered' | 'lost';
  detail: string | null;
}

export interface TradeNetworkState {
  agents: Record<ID, TradeAgentState>;
  flows: TradeFlowState[];
  stats: { dispatched: number; delivered: number; lost: number; volume: number; realisedProfit: number };
  lastScanDay: number;
}

export interface GovernmentState {
  countryId: ID;
  stability: number;
  /** 0…1 hostility toward illegal commerce. */
  crackdownIntensity: number;
  taxRate: number;
  currencyIndex: number;
  sanctionsTargetIds: ID[];
  policy: 'open' | 'protectionist' | 'austerity' | 'stimulus' | 'martial_law';
  electionInDays: number | null;
}

export interface ActiveEvent {
  id: ID;
  defId: ID;
  name: string;
  description: string;
  scope: EventScope;
  severity: Severity;
  startedDay: number;
  expiresDay: number | null;
  locationIds: ID[];
  regionIds: ID[];
  /** Serialized effects already applied (for auditing "why did this happen"). */
  appliedEffects: string[];
  chainDepth: number;
  sourceEventId?: ID;
  /** Arbitrary payload read by the effect applier. */
  payload: Record<string, number | string | boolean | string[]>;
}

export interface NewsItem {
  id: ID;
  day: number;
  scope: EventScope;
  category:
    | 'market'
    | 'politics'
    | 'corporate'
    | 'faction'
    | 'crime'
    | 'economy'
    | 'technology'
    | 'travel'
    | 'player'
    | 'finance';
  headline: string;
  body: string;
  locationIds: ID[];
  /** Optional actionable context for the UI (deep link + numbers). */
  tags: string[];
  importance: 1 | 2 | 3 | 4 | 5;
  read: boolean;
  eventId?: ID;
  /** Structured "why" data so the UI can explain the change. */
  metrics?: { label: string; value: string; delta?: number }[];
}

export interface WorldState {
  day: number;
  /** Cumulative price level; 1.0 at world start. */
  inflationIndex: number;
  /** Current annual inflation rate (fraction). */
  inflationRate: number;
  /** Central bank annual base rate. */
  interestRate: number;
  /** 0…1 position within the business cycle. */
  cyclePhase: number;
  /** Demand/price multiplier from the cycle (≈1 ± amplitude). */
  cycleFactor: number;
  /** 0…1 global risk appetite. */
  globalSentiment: number;
  stockIndex: number;
  stockIndexHistory: number[];
  cryptoIndex: number;
  cryptoIndexHistory: number[];
  unemployment: number;
  consumerConfidence: number;
  gdpIndex: number;
  shocks: ActiveShock[];
  locations: Record<ID, LocationState>;
  routes: Record<ID, RouteState>;
  factions: Record<ID, FactionState>;
  companies: Record<ID, CompanyState>;
  cryptoAssets: Record<ID, CryptoAssetState>;
  competitors: Record<ID, CompetitorState>;
  /**
   * Rival firms' physical trade. Absent on saves written before Phase 3 and
   * adopted on load (`adoptTradeNetwork`), so every reader must handle `undefined`.
   */
  tradeNetwork?: TradeNetworkState;
  governments: Record<ID, GovernmentState>;
  activeEvents: ActiveEvent[];
  news: NewsItem[];
  /** Cooldowns preventing the same event definition refiring. */
  eventCooldowns: Record<ID, number>;
  /** Follow-on events rolled by a fired event, waiting for their day. */
  scheduledEvents: ScheduledEvent[];
  /** Aggregate indicators exposed in the "Economic indicators" UI. */
  indicators: EconomicIndicators;
}

export interface ScheduledEvent {
  id: ID;
  defId: ID;
  /** Day the follow-on event fires. */
  day: number;
  sourceEventId: ID;
  chainDepth: number;
}

export interface EconomicIndicators {
  inflationYoY: number;
  interestRate: number;
  unemployment: number;
  consumerConfidence: number;
  gdpGrowth: number;
  stockIndexChange30d: number;
  cryptoIndexChange30d: number;
  cyclePhaseLabel: 'recession' | 'recovery' | 'expansion' | 'boom' | 'contraction';
  averageCommodityPriceIndex: number;
  tradeVolume30d: number;
  globalRiskAppetite: number;
}

/* ------------------------------------------------------------------ */
/* Player state                                                        */
/* ------------------------------------------------------------------ */

export type ReputationDimension =
  | 'global'
  | 'legal'
  | 'criminal'
  | 'business'
  | 'crew'
  | 'underground'
  | 'digital';

export interface ReputationState {
  dimensions: Record<ReputationDimension, number>;
  /** Regional reputation keyed by regionId. */
  regional: Record<ID, number>;
  /** Local reputation keyed by locationId. */
  local: Record<ID, number>;
  /** Aggregate enforcement attention. */
  heat: number;
  /** Active financial investigation intensity, 0…100. */
  investigation: number;
  investigationStartedDay: number | null;
  /** Explanation trail for the UI ("why did this change"). */
  recentChanges: { day: number; dimension: string; delta: number; reason: string }[];
}

export interface BankAccount {
  id: ID;
  institution: string;
  kind: 'checking' | 'savings' | 'offshore' | 'crypto_backed' | 'shell';
  locationId: ID;
  balance: number;
  /** Money that has not been laundered; cannot be used for legal purchases. */
  dirtyBalance: number;
  currency: string;
  apy: number;
  openedDay: number;
  /** Frozen by authorities/creditors. */
  frozen: boolean;
  frozenUntilDay: number | null;
  freezeReason: string | null;
  dailyLimit: number | null;
  lastInterestDay: number;
}

export type LoanKind = 'bank' | 'loan_shark' | 'business' | 'mortgage' | 'margin' | 'faction';

export interface Loan {
  id: ID;
  kind: LoanKind;
  lenderName: string;
  principal: number;
  /** Outstanding balance. */
  balance: number;
  /** Annual percentage rate (fraction). */
  apr: number;
  /** Extra rate applied while delinquent. */
  penaltyApr: number;
  openedDay: number;
  dueDay: number;
  termDays: number;
  /** Minimum payment due each period. */
  paymentPerDay: number;
  lastPaymentDay: number;
  daysDelinquent: number;
  /** 'simple' | 'compound' | 'amortized' */
  method: 'simple' | 'compound' | 'amortized';
  compoundingPeriodDays: number;
  collateral: CollateralRef[];
  /** 0…1 loan-shark pressure; drives enforcement events. */
  pressure: number;
  status: 'active' | 'repaid' | 'defaulted' | 'seized' | 'written_off';
  totalRepaid: number;
  totalInterestPaid: number;
  creditLineLimit: number | null;
}

export interface CollateralRef {
  kind: 'property' | 'vehicle' | 'stock' | 'crypto' | 'inventory';
  refId: ID;
  valuedAt: number;
}

export interface ItemStack {
  id: ID;
  commodityId: ID;
  qty: number;
  /** Volume-weighted average purchase cost, used for P/L and taxes. */
  avgCost: number;
  acquiredDay: number;
  /** 0…1 quality — affects sale price for graded goods. */
  quality: number;
  expiresDay: number | null;
  storageId: ID;
  /** True if hidden in a compartment (reduces detection, limits qty). */
  concealed: boolean;
  /** Provenance, used by investigations. */
  origin: 'purchased' | 'produced' | 'looted' | 'received' | 'smuggled';
  /**
   * Where the goods were acquired. Provenance drives arbitrage statistics
   * (selling in a different city than you bought) and investigation evidence.
   */
  acquiredLocationId: ID | null;
}

export type StorageKind = 'personal' | 'warehouse' | 'safehouse' | 'vehicle' | 'property' | 'cold' | 'deposit_box';

export interface StorageUnit {
  id: ID;
  kind: StorageKind;
  name: string;
  locationId: ID;
  /** Null for the player's person (moves with them). */
  propertyId: ID | null;
  vehicleId: ID | null;
  capacityKg: number;
  capacityL: number;
  security: number;
  refrigerated: boolean;
  hiddenCompartmentKg: number;
  /** Extra daily cost (rent/insurance). */
  costPerDay: number;
  insured: boolean;
  insuredValue: number;
}

export interface VehicleInstance {
  id: ID;
  defId: ID;
  name: string;
  purchasedDay: number;
  purchasePrice: number;
  condition: number;
  /** 0…1 fuel tank state. */
  fuel: number;
  odometerKm: number;
  locationId: ID;
  upgrades: ID[];
  /** Effective values after upgrades — recomputed on change. */
  capacityKg: number;
  capacityL: number;
  stealth: number;
  armor: number;
  speedKmPerDay: number;
  hiddenCompartmentKg: number;
  inUseBy: 'player' | 'logistics' | 'crew' | 'idle';
  assignedCrewId: ID | null;
  maintenanceDueDay: number;
  damage: number;
}

export interface PropertyInstance {
  id: ID;
  defId: ID;
  name: string;
  locationId: ID;
  purchasedDay: number;
  purchasePrice: number;
  /** Current market valuation. */
  valuation: number;
  upgradeLevel: number;
  condition: number;
  security: number;
  storageKg: number;
  storageL: number;
  refrigerated: boolean;
  hiddenCompartmentKg: number;
  opexPerDay: number;
  staffed: boolean;
  insured: boolean;
  insurancePremiumPerDay: number;
  /** Accumulated unpaid tax/opex. */
  arrears: number;
  damagedUntilDay: number | null;
  raidedDay: number | null;
  rentalIncomePerDay: number;
  businessId: ID | null;
  productionLineIds: ID[];
}

export interface BusinessInstance {
  id: ID;
  defId: ID;
  name: string;
  locationId: ID;
  propertyId: ID | null;
  openedDay: number;
  /** Cash generated but not yet swept to an account. */
  cashbox: number;
  /** Dirty money currently being laundered through it. */
  launderingBuffer: number;
  launderedTotal: number;
  staffIds: ID[];
  managerId: ID | null;
  level: number;
  /** 0…1 customer base health. */
  clientele: number;
  marketing: number;
  reputationLocal: number;
  revenue30d: number;
  opex30d: number;
  profit30d: number;
  lastOperatedDay: number;
  /** Explanation of yesterday's P/L for the UI. */
  lastDailyReport: DailyBusinessReport | null;
  legality: Legality;
  suspended: boolean;
  suspendedUntilDay: number | null;
}

export interface DailyBusinessReport {
  day: number;
  revenue: number;
  opex: number;
  wages: number;
  tax: number;
  profit: number;
  drivers: { label: string; contribution: number }[];
}

export interface ProductionLineInstance {
  id: ID;
  recipeId: ID;
  name: string;
  propertyId: ID;
  locationId: ID;
  installedDay: number;
  /** Input buffer keyed by commodityId. */
  inputs: Record<ID, number>;
  /** Output buffer keyed by commodityId. */
  outputs: Record<ID, number>;
  workerIds: ID[];
  managerId: ID | null;
  automated: boolean;
  automationLevel: number;
  efficiency: number;
  quality: number;
  /** Current realised capacity per day. */
  capacityPerDay: number;
  broken: boolean;
  brokenUntilDay: number | null;
  lastRunDay: number;
  totalProduced: number;
  totalWaste: number;
  energyCostPerDay: number;
  opexPerDay: number;
  lastReport: ProductionReport | null;
  suspended: boolean;
}

export interface ProductionReport {
  day: number;
  produced: { commodityId: ID; qty: number }[];
  consumed: { commodityId: ID; qty: number }[];
  waste: number;
  efficiency: number;
  quality: number;
  cost: number;
  blockedBy: string | null;
}

export type EmployeeRole =
  | 'security'
  | 'mercenary'
  | 'driver'
  | 'pilot'
  | 'trader'
  | 'broker'
  | 'warehouse_worker'
  | 'logistics_manager'
  | 'business_manager'
  | 'accountant'
  | 'lawyer'
  | 'financial_specialist'
  | 'intelligence_specialist'
  | 'technical_specialist'
  | 'researcher'
  | 'production_worker'
  | 'sales_staff'
  | 'marketing_staff'
  | 'fixer'
  | 'negotiator'
  | 'faction_contact'
  | 'contractor'
  | 'hacker'
  | 'chemist';

export interface EmployeeInstance {
  id: ID;
  name: string;
  role: EmployeeRole;
  hiredDay: number;
  level: number;
  xp: number;
  /** 0…100 core stats. */
  stats: {
    skill: number;
    loyalty: number;
    morale: number;
    health: number;
    initiative: number;
    toughness: number;
    discretion: number;
  };
  salaryPerDay: number;
  lastPaidDay: number;
  daysUnpaid: number;
  assignment: EmployeeAssignment | null;
  skills: Record<ID, number>;
  injured: boolean;
  injuredUntilDay: number | null;
  trainingUntilDay: number | null;
  /** 0…1 — rises with mistreatment, unpaid wages, rival offers. */
  betrayalRisk: number;
  relationships: Record<ID, number>;
  personalObjective: string;
  locationId: ID;
  equipmentIds: ID[];
  status: 'active' | 'injured' | 'training' | 'deployed' | 'departed' | 'betrayed' | 'retired' | 'captured';
  contractEndDay: number | null;
}

export interface EmployeeAssignment {
  kind:
    | 'business'
    | 'production'
    | 'logistics'
    | 'security'
    | 'warehouse'
    | 'trading'
    | 'finance'
    | 'intel'
    | 'manager_of_managers';
  targetId: ID;
  /** Delegation tier this employee occupies. */
  tier: number;
  reportsTo: ID | null;
}

export interface StockHolding {
  companyId: ID;
  shares: number;
  avgCost: number;
  acquiredDay: number;
  dividendsReceived: number;
  /** Account the shares are held in (brokerage). */
  accountId: ID;
}

export interface CryptoHolding {
  assetId: ID;
  amount: number;
  avgCost: number;
  acquiredDay: number;
  /** 'wallet' (self-custody) or exchange custody. */
  custody: 'wallet' | 'exchange';
  walletAddress: string;
  staked: number;
  stakedUntilDay: number | null;
  stakingApy: number;
  rewardsAccrued: number;
  miningRigId: ID | null;
}

export interface MiningRig {
  id: ID;
  name: string;
  assetId: ID;
  hashRate: number;
  powerDraw: number;
  purchasedDay: number;
  locationId: ID;
  propertyId: ID | null;
  condition: number;
  totalMined: number;
  active: boolean;
}

export interface UndergroundState {
  /** Has the player bought darknet access? */
  accessUnlocked: boolean;
  accessGrantedDay: number | null;
  /** Digital identity reputation, 0…100. */
  digitalReputation: number;
  /** Pseudonym + keyring. */
  handle: string;
  vendorRelationships: Record<ID, number>;
  trustedVendors: ID[];
  escrowBalance: number;
  /** Accumulated law-enforcement tracing of digital activity. */
  traceHeat: number;
  knownMarketIds: ID[];
  dataAssets: DataAsset[];
  hackCooldownUntilDay: number | null;
  compromised: boolean;
  compromisedUntilDay: number | null;
  vpnQuality: number;
  /** Chained on-chain ledger of the player's crypto activity. */
  onChain: OnChainEntry[];
  /** Primary self-custody address (null until a wallet is created). */
  walletAddress: string | null;
  /** Exchange accounts the player has opened, by exchange id. */
  exchangeAccounts: { exchangeId: ID; openedDay: number; balance: number; frozenUntilDay: number | null; kycLevel: number }[];
}

/**
 * One entry in the player's on-chain history. Hashes are chained (each entry
 * commits to the previous hash) so a tampered save is detectable — the digital
 * analogue of the bank transaction chain, with crypto-native semantics.
 */
export interface OnChainEntry {
  hash: ID;
  prevHash: ID;
  day: number;
  assetId: ID;
  side: 'buy' | 'sell' | 'transfer' | 'stake' | 'unstake' | 'reward' | 'mine' | 'fee' | 'loss';
  amount: number;
  price: number;
  address: string;
  counterparty: string;
  note: string;
}

export interface DataAsset {
  id: ID;
  name: string;
  kind: 'intel' | 'credentials' | 'market_data' | 'blueprint' | 'blackmail' | 'exploit' | 'ledger';
  acquiredDay: number;
  /** Value decays as information becomes stale. */
  baseValue: number;
  freshness: number;
  targetId: ID | null;
  sold: boolean;
  riskOnHold: number;
}

export interface Shipment {
  id: ID;
  originLocationId: ID;
  destinationLocationId: ID;
  routeId: ID;
  mode: TravelMode;
  departedDay: number;
  arrivesDay: number;
  items: { stackId: ID; commodityId: ID; qty: number }[];
  vehicleId: ID | null;
  crewIds: ID[];
  /** Value declared to customs. */
  declaredValue: number;
  actualValue: number;
  concealed: boolean;
  status: 'in_transit' | 'delayed' | 'intercepted' | 'delivered' | 'lost';
  insuranceId: ID | null;
  trackingCode: string;
  managedBy: ID | null;
  delayReason: string | null;
}

export interface TravelState {
  mode: TravelMode;
  fromLocationId: ID;
  toLocationId: ID;
  routeId: ID;
  departedDay: number;
  arrivesDay: number;
  cost: number;
  vehicleId: ID | null;
  crewIds: ID[];
  risk: number;
  encounterPending: boolean;
}

export interface ProgressionState {
  level: number;
  xp: number;
  xpToNext: number;
  totalXpEarned: number;
  skillPoints: number;
  perkPoints: number;
  skills: Record<ID, number>;
  perks: ID[];
  titles: string[];
  currentTitle: string;
  specialisation: string | null;
  prestigeCount: number;
  legacyBonus: number;
  /** Day the empire was last handed over; `null` when it never has been. */
  lastPrestigeDay: number | null;
  /** Net worth at the last handover — the estate must be rebuilt from here. */
  lastPrestigeNetWorth: number;
  achievements: ID[];
  milestones: ID[];
  /** XP explanation trail for the UI. */
  recentXp: { day: number; amount: number; reason: string }[];
}

export interface MissionState {
  id: ID;
  defId: ID;
  title: string;
  description: string;
  giverName: string;
  giverFactionId: ID | null;
  acceptedDay: number;
  deadlineDay: number;
  objectives: MissionObjective[];
  rewardCash: number;
  rewardXp: number;
  rewardReputation: { dimension: ReputationDimension; amount: number }[];
  rewardItems: { commodityId: ID; qty: number }[];
  risk: number;
  status: 'available' | 'active' | 'completed' | 'failed' | 'expired';
  chainId: ID | null;
  completedDay: number | null;
}

export interface MissionObjective {
  id: ID;
  description: string;
  kind:
    | 'deliver_commodity'
    | 'acquire_cash'
    | 'travel_to'
    | 'reach_net_worth'
    | 'hire_role'
    | 'own_property'
    | 'reach_level'
    | 'sell_commodity'
    | 'buy_commodity'
    | 'survive_days'
    | 'reach_reputation'
    | 'complete_combat'
    | 'produce_commodity'
    | 'launder_amount'
    | 'reach_faction_standing';
  targetId: ID | null;
  requiredAmount: number;
  currentAmount: number;
  completed: boolean;
}

export interface Combatant {
  id: ID;
  name: string;
  side: 'player' | 'ally' | 'enemy';
  hp: number;
  maxHp: number;
  actionPoints: number;
  maxActionPoints: number;
  accuracy: number;
  damage: [number, number];
  defense: number;
  speed: number;
  /** Grid position for tactical play. */
  position: { x: number; y: number };
  cover: boolean;
  statusEffects: CombatStatusEffect[];
  enemyDefId?: ID;
  employeeId?: ID;
  alive: boolean;
  morale: number;
}

export interface CombatStatusEffect {
  id: string;
  name: string;
  turnsRemaining: number;
  modifiers: Record<string, number>;
}

export interface ActiveCombat {
  id: ID;
  kind: 'police' | 'rival' | 'faction_war' | 'ambush' | 'raid' | 'pursuit' | 'boss' | 'cyber';
  locationId: ID;
  startedDay: number;
  turn: number;
  phase: 'active' | 'resolved';
  participants: Combatant[];
  /** Grid dimensions for the tactical view. */
  grid: { width: number; height: number };
  log: CombatLogEntry[];
  stakes: CombatStakes;
  enemyGroupId: string;
  canFlee: boolean;
  canNegotiate: boolean;
  canBribe: boolean;
  bribeAmount: number;
  outcome: CombatOutcome | null;
  /** Set when the encounter is auto-resolved rather than played tactically. */
  autoResolved: boolean;
  seed: string;
}

export interface CombatStakes {
  /** Cash/asset loss if the player loses. */
  lossCash: number;
  lossInventoryFraction: number;
  arrestChance: number;
  injuryChance: number;
  deathChance: number;
  xpReward: number;
  reputationReward: { dimension: ReputationDimension; amount: number }[];
  loot: { commodityId?: ID; cash?: number }[];
  /** What the player is defending. */
  defendedPropertyId: ID | null;
  defendedShipmentId: ID | null;
}

export interface CombatLogEntry {
  turn: number;
  actorId: ID;
  actorName: string;
  action: string;
  targetId: ID | null;
  targetName: string | null;
  damage: number;
  detail: string;
  critical: boolean;
}

export interface CombatOutcome {
  victory: boolean;
  fled: boolean;
  arrested: boolean;
  bribed: boolean;
  negotiated: boolean;
  casualties: { id: ID; name: string; status: 'injured' | 'dead' | 'captured' | 'fled' }[];
  lootCash: number;
  lootItems: { commodityId: ID; qty: number }[];
  xpGained: number;
  reputationChanges: { dimension: ReputationDimension; amount: number; reason: string }[];
  heatChange: number;
  summary: string;
}

export interface PrisonState {
  incarcerated: boolean;
  incarceratedDay: number | null;
  releaseDay: number | null;
  facility: string;
  bailAmount: number | null;
  bailPaid: boolean;
  /** Assets forfeited on sentencing. */
  forfeitedCash: number;
  forfeitedItems: number;
  sentenceDays: number;
  escapedDay: number | null;
  /** Progress toward a parole/bribe/escape opportunity. */
  influence: number;
}

export interface AutomationRule {
  id: ID;
  name: string;
  enabled: boolean;
  /** Delegation tier that executes it. */
  managerId: ID | null;
  kind:
    | 'auto_trade'
    | 'auto_resupply'
    | 'auto_ship'
    | 'auto_loan_repay'
    | 'auto_invest'
    | 'auto_launder'
    | 'auto_produce'
    | 'auto_business_sweep'
    | 'auto_hire';
  config: Record<string, string | number | boolean | string[]>;
  createdDay: number;
  lastRunDay: number | null;
  lastResult: AutomationResult | null;
  totalProfit: number;
  totalRuns: number;
  totalErrors: number;
  /**
   * Tracking codes whose freight loss has already been charged to this rule, so a
   * seized shipment hits the delegating manager's P/L exactly once.
   */
  settledTrackingCodes?: string[];
}

export interface AutomationResult {
  day: number;
  success: boolean;
  profit: number;
  message: string;
  actions: string[];
  errorKind?: 'insufficient_funds' | 'no_capacity' | 'market_closed' | 'manager_error' | 'risk_avoided';
}

export interface PlayerStats {
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  /** Actions available today. */
  actionsToday: number;
  maxActionsPerDay: number;
  /** Encumbrance carried personally. */
  carriedKg: number;
  carriedL: number;
  totalTradesExecuted: number;
  totalDistanceTravelledKm: number;
  daysSurvived: number;
  combatsWon: number;
  combatsLost: number;
  arrests: number;
  biggestDealProfit: number;
  netWorthPeak: number;
  lastInjuryDay: number | null;
  /**
   * Open-ended counters used by the data-driven achievement system
   * (`ACHIEVEMENTS[].check` expressions such as `laundered>=1000000`).
   * Adding a new achievement never requires a schema change.
   */
  counters: Record<string, number>;
}

export interface NetWorthSnapshot {
  day: number;
  total: number;
  cash: number;
  inventory: number;
  properties: number;
  businesses: number;
  vehicles: number;
  stocks: number;
  crypto: number;
  debts: number;
}

export interface PlayerState {
  id: ID;
  name: string;
  createdDay: number;
  locationId: ID;
  accounts: BankAccount[];
  loans: Loan[];
  creditScore: number;
  creditHistory: { day: number; score: number; reason: string }[];
  inventory: ItemStack[];
  storages: StorageUnit[];
  vehicles: VehicleInstance[];
  properties: PropertyInstance[];
  businesses: BusinessInstance[];
  productionLines: ProductionLineInstance[];
  crew: EmployeeInstance[];
  hiringPool: HiringCandidate[];
  hiringPoolRefreshDay: number;
  stockHoldings: StockHolding[];
  cryptoHoldings: CryptoHolding[];
  miningRigs: MiningRig[];
  brokerageAccountId: ID | null;
  underground: UndergroundState;
  progression: ProgressionState;
  reputation: ReputationState;
  missions: MissionState[];
  missionOffers: MissionState[];
  missionRefreshDay: number;
  shipments: Shipment[];
  travel: TravelState | null;
  combat: ActiveCombat | null;
  prison: PrisonState;
  automation: AutomationRule[];
  stats: PlayerStats;
  netWorthHistory: NetWorthSnapshot[];
  /** Transactions log (also mirrored to the DB audit trail). */
  recentTransactions: TransactionRecord[];
  /** Eviction checkpoint that keeps `recentTransactions` verifiable once it is full. */
  transactionChain: TransactionChainState;
  notifications: PlayerNotification[];
  settings: PlayerSettings;
}

export interface HiringCandidate {
  id: ID;
  name: string;
  role: EmployeeRole;
  level: number;
  stats: EmployeeInstance['stats'];
  salaryAskPerDay: number;
  hiringFee: number;
  skills: Record<ID, number>;
  personalObjective: string;
  locationId: ID;
  loyaltyExpectation: number;
}

export interface TransactionRecord {
  id: ID;
  day: number;
  turn: number;
  kind:
    | 'buy'
    | 'sell'
    | 'travel'
    | 'loan_take'
    | 'loan_repay'
    | 'interest'
    | 'deposit'
    | 'withdraw'
    | 'transfer'
    | 'stock_buy'
    | 'stock_sell'
    | 'crypto_buy'
    | 'crypto_sell'
    | 'crypto_stake'
    | 'crypto_unstake'
    | 'property_buy'
    | 'property_upgrade'
    | 'business_setup'
    | 'business_revenue'
    | 'business_opex'
    | 'wages'
    | 'hire'
    | 'production'
    | 'launder'
    | 'tax'
    | 'fine'
    | 'bribe'
    | 'combat_loot'
    | 'mission_reward'
    | 'insurance'
    | 'dividend'
    | 'staking_reward'
    | 'mining_reward'
    | 'fee'
    | 'theft'
    | 'seizure'
    | 'adjustment';
  amount: number;
  balanceAfter: number;
  accountId: ID | null;
  description: string;
  counterparty: string | null;
  commodityId: ID | null;
  qty: number | null;
  unitPrice: number | null;
  locationId: ID | null;
  /** Server-computed hash chain entry for tamper evidence. */
  integrityHash: string;
  /**
   * The `integrityHash` of the transaction that came immediately before this one.
   *
   * Stored on the record rather than looked up from `transactions[i - 1]` so a
   * record stays verifiable after the ring buffer evicts its predecessor — the
   * missing case that used to make every full history fail verification.
   */
  prevHash: string;
  /**
   * Lifetime position of this record in the ledger, starting at 1 and never
   * reused. Eviction removes records from the array but not from the count, so
   * `seq` continuity is what proves nothing was deleted, duplicated or reordered.
   */
  seq: number;
  meta: Record<string, string | number | boolean | null>;
}

/**
 * The eviction checkpoint for the transaction ledger.
 *
 * `recentTransactions` is a bounded ring buffer, so the record that anchors the
 * retained chain is eventually thrown away. This block remembers enough to keep
 * verifying what is left, and is itself digest-committed so it cannot be quietly
 * rewritten to excuse a broken chain.
 */
export interface TransactionChainState {
  /** Per-game domain separator, derived from the save's identity at creation. */
  salt: string;
  /** Records evicted so far. `evictedCount + recentTransactions.length` = lifetime total. */
  evictedCount: number;
  /** `integrityHash` of the most recently evicted record; the genesis anchor when nothing has been evicted. */
  headPrevHash: string;
  /** Digest committing to `salt`, `evictedCount` and `headPrevHash`. */
  anchorHash: string;
  /**
   * Schema version this ledger was re-anchored from, or `null` when it was born
   * on the current schema. A re-anchored ledger proves its own records but can no
   * longer prove what was evicted before the migration — recorded rather than
   * hidden, so a diagnosis never overstates the guarantee.
   */
  reanchoredFromSchema: number | null;
}

export interface PlayerNotification {
  id: ID;
  day: number;
  kind: 'info' | 'success' | 'warning' | 'danger' | 'opportunity';
  title: string;
  body: string;
  read: boolean;
  link: string | null;
  metrics?: { label: string; value: string }[];
}

export interface PlayerSettings {
  autoAdvanceConfirm: boolean;
  showAdvancedMarketData: boolean;
  compactTables: boolean;
  newsFilter: EventScope[];
  combatMode: 'auto' | 'tactical' | 'ask';
  currencySymbol: string;
  riskTolerance: number;
  notificationsEnabled: boolean;
}

/* ------------------------------------------------------------------ */
/* Game configuration and root state                                   */
/* ------------------------------------------------------------------ */

export type GameMode = 'campaign' | 'sandbox';

export interface VictoryCondition {
  id: string;
  description: string;
  kind: 'net_worth' | 'level' | 'locations_controlled' | 'empire_score' | 'days_survived' | 'faction_standing' | 'monopoly';
  target: number;
  targetId?: string;
  achieved: boolean;
  achievedDay?: number;
}

export interface LossCondition {
  id: string;
  description: string;
  kind: 'bankruptcy' | 'imprisonment' | 'reputation_collapse' | 'death' | 'net_worth_floor' | 'debt_floor';
  threshold: number;
  triggered: boolean;
  triggeredDay?: number;
}

export interface GameConfig {
  mode: GameMode;
  difficulty: 'relaxed' | 'standard' | 'hardcore' | 'brutal';
  /** Difficulty multipliers resolved at creation time. */
  difficultyModifiers: {
    startingCashMultiplier: number;
    priceVolatilityMultiplier: number;
    enforcementMultiplier: number;
    interestRateMultiplier: number;
    eventSeverityMultiplier: number;
    combatDifficultyMultiplier: number;
    xpMultiplier: number;
  };
  victoryConditions: VictoryCondition[];
  lossConditions: LossCondition[];
  startLocationId: ID;
  worldSeed: string;
  /** Allow permadeath? */
  permadeath: boolean;
  /** Endless mode continues after victory. */
  endless: boolean;
  startDateLabel: string;
}

export type GameStatus = 'active' | 'won' | 'lost' | 'paused' | 'archived' | 'ended_imprisoned';

export interface GameState {
  schemaVersion: number;
  gameId: ID;
  userId: ID;
  name: string;
  status: GameStatus;
  /** Monotonic save version for conflict-safe writes. */
  version: number;
  turn: number;
  config: GameConfig;
  world: WorldState;
  player: PlayerState;
  /** Markets that have been materialised (see lazy materialisation notes). */
  markets: Record<string, MarketState>;
  /** Deterministic RNG state so simulation is reproducible. */
  rng: RngState;
  rngLabel: string;
  createdAt: string;
  updatedAt: string;
  /** Last simulated day (equals world.day; kept for save validation). */
  lastTickDay: number;
  /** Diagnostics ring buffer surfaced in the dev tools panel. */
  diagnostics: DiagnosticEntry[];
  /** Ending summary when status != active. */
  ending: GameEnding | null;
}

export interface GameEnding {
  kind: 'victory' | 'bankruptcy' | 'imprisonment' | 'reputation_collapse' | 'death' | 'retired';
  day: number;
  summary: string;
  stats: { label: string; value: string }[];
  score: number;
}

export interface DiagnosticEntry {
  day: number;
  turn: number;
  system: string;
  message: string;
  data?: Record<string, number | string | boolean | null>;
  level: 'debug' | 'info' | 'warn' | 'error';
}

/* ------------------------------------------------------------------ */
/* Shared result envelope                                              */
/* ------------------------------------------------------------------ */

export interface ActionWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'danger';
}

/**
 * Standard envelope returned by every authoritative server action.
 *
 * The client never computes money, prices or outcomes; it renders this.
 */
export interface ActionResult<T = undefined> {
  ok: boolean;
  /** Machine-readable failure code (see `GameErrorCode`). */
  error?: GameErrorCode;
  message?: string;
  warnings: ActionWarning[];
  /** State delta the client should apply (full player/world snapshot). */
  state?: GameState;
  data?: T;
  day: number;
  turn: number;
  /** News/notifications produced by this action. */
  notifications: PlayerNotification[];
  /** Server-side audit id for the operation. */
  auditId?: string;
  /** Explanation trail for UI "why did this happen". */
  explanations?: { label: string; detail: string }[];
}

export type GameErrorCode =
  | 'invalid_input'
  | 'not_authenticated'
  | 'not_found'
  | 'conflict'
  | 'insufficient_funds'
  | 'insufficient_capacity'
  | 'insufficient_goods'
  | 'market_unavailable'
  | 'illegal_in_jurisdiction'
  | 'locked'
  | 'in_transit'
  | 'incarcerated'
  | 'rate_limited'
  | 'combat_active'
  | 'no_route'
  | 'max_loans'
  | 'credit_denied'
  | 'validation_failed'
  | 'state_corrupt'
  | 'save_conflict'
  | 'internal_error'
  | 'action_not_permitted'
  | 'cooldown_active'
  | 'capacity_exceeded'
  | 'unlocked_required'
  | 'storage_unsuitable';
