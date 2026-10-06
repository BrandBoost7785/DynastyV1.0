/**
 * EventRegistry — declarative world event definitions.
 *
 * Events are *data*: a list of declarative `conditions` (predicates evaluated
 * against world/player state) and `effects` (operations applied by the generic
 * effect applier in `src/sim/events.ts`). Adding a new event never requires
 * touching engine code, and effects can chain into secondary events, which is
 * what produces the multi-stage consequences the design calls for:
 *
 *   global shock → supply disruption → shortage → price spike → stock reaction
 *   → currency move → financing cost change → player opportunity
 */

import type { CommodityCategory, EventScope, Severity } from '../../sim/types';

/* ------------------------------------------------------------------ */
/* Declarative condition / effect vocabulary                           */
/* ------------------------------------------------------------------ */

export type EventCondition =
  | { kind: 'min_day'; day: number }
  | { kind: 'max_day'; day: number }
  | { kind: 'probability'; chance: number }
  | { kind: 'player_level_min'; level: number }
  | { kind: 'player_level_max'; level: number }
  | { kind: 'player_net_worth_min'; amount: number }
  | { kind: 'player_net_worth_max'; amount: number }
  | { kind: 'player_cash_min'; amount: number }
  | { kind: 'player_heat_min'; value: number }
  | { kind: 'player_heat_max'; value: number }
  | { kind: 'player_reputation_min'; dimension: string; value: number }
  | { kind: 'player_reputation_max'; dimension: string; value: number }
  | { kind: 'player_owns_property' }
  | { kind: 'player_owns_business' }
  | { kind: 'player_has_crew'; min: number }
  | { kind: 'player_has_loans' }
  | { kind: 'player_has_delinquent_loan' }
  | { kind: 'player_holds_illegal_inventory' }
  | { kind: 'player_in_location_kind'; kinds: string[] }
  | { kind: 'player_in_location'; locationIds: string[] }
  | { kind: 'player_has_underground_access' }
  | { kind: 'player_has_inventory_category'; category: CommodityCategory }
  | { kind: 'player_stock_holdings_min'; amount: number }
  | { kind: 'player_crypto_holdings_min'; amount: number }
  | { kind: 'inflation_above'; value: number }
  | { kind: 'inflation_below'; value: number }
  | { kind: 'interest_rate_above'; value: number }
  | { kind: 'cycle_phase_in'; phases: string[] }
  | { kind: 'global_sentiment_below'; value: number }
  | { kind: 'global_sentiment_above'; value: number }
  | { kind: 'stock_index_change_below'; value: number }
  | { kind: 'faction_at_war' }
  | { kind: 'active_shock_max'; count: number }
  | { kind: 'no_active_event'; defId: string };

export type EventEffect =
  | { kind: 'demand_shift'; categories: CommodityCategory[]; multiplier: number; locationScope?: 'here' | 'region' | 'country' | 'global'; durationDays?: number }
  | { kind: 'supply_shift'; categories: CommodityCategory[]; multiplier: number; locationScope?: 'here' | 'region' | 'country' | 'global'; durationDays?: number }
  | { kind: 'price_shift'; categories: CommodityCategory[]; multiplier: number; locationScope?: 'here' | 'region' | 'country' | 'global'; durationDays?: number }
  | { kind: 'commodity_demand_shift'; commodityIds: string[]; multiplier: number; durationDays?: number }
  | { kind: 'inflation'; delta: number }
  | { kind: 'interest_rate'; delta: number }
  | { kind: 'global_sentiment'; delta: number }
  | { kind: 'cycle_shock'; delta: number }
  | { kind: 'stock_market'; delta: number; sectors?: string[] }
  | { kind: 'crypto_market'; delta: number; assets?: string[] }
  | { kind: 'company_event'; companyIds: string[]; priceDelta: number; reason: string }
  | { kind: 'location_lockdown'; durationDays: number; scope?: 'here' | 'random_tradeable' }
  | { kind: 'border_closure'; durationDays: number; scope?: 'here' | 'country' }
  | { kind: 'route_disruption'; durationDays: number; costMultiplier: number; reason: string }
  | { kind: 'faction_war'; chance: number }
  | { kind: 'faction_relation'; factionId: string; delta: number }
  | { kind: 'faction_standing'; delta: number; scope?: 'all' | 'criminal' | 'legitimate' }
  | { kind: 'player_cash'; amount: number; dirty?: boolean; reason: string }
  | { kind: 'player_heat'; delta: number }
  | { kind: 'player_reputation'; dimension: string; delta: number }
  | { kind: 'player_xp'; amount: number }
  | { kind: 'property_damage'; fraction: number }
  | { kind: 'inventory_spoilage'; fraction: number; perishableOnly?: boolean }
  | { kind: 'theft'; fraction: number; target?: 'personal' | 'warehouse' | 'vehicle' }
  | { kind: 'seizure'; chance: number; fraction: number; illegalOnly?: boolean }
  | { kind: 'arrest_chance'; chance: number; days: [number, number] }
  | { kind: 'business_suspension'; days: number; chance: number }
  | { kind: 'business_revenue'; multiplier: number; days: number }
  | { kind: 'production_disruption'; days: number; chance: number }
  | { kind: 'crew_effect'; loyaltyDelta: number; moraleDelta: number; injuryChance: number }
  | { kind: 'spawn_combat'; table: string; enemyCount: [number, number]; stakes: 'low' | 'medium' | 'high' }
  | { kind: 'spawn_mission'; missionId: string }
  | { kind: 'unlock_location'; locationId: string }
  | { kind: 'tax_change'; delta: number; countryId?: string }
  | { kind: 'currency_crisis'; countryId?: string; severity: number }
  | { kind: 'competitor_action'; action: 'buy_spree' | 'dump' | 'enter_market' | 'exit_market'; intensity: number }
  | { kind: 'cyber_event'; target: 'player' | 'exchange' | 'bank'; severity: number }
  | { kind: 'bank_failure'; chance: number }
  | { kind: 'technology_breakthrough'; category: CommodityCategory; supplyMultiplier: number }
  | { kind: 'news'; headline: string; body: string; importance: 1 | 2 | 3 | 4 | 5 };

export interface EventChainLink {
  eventId: string;
  chance: number;
  delayDays: [number, number];
}

export interface EventDef {
  id: string;
  name: string;
  scope: EventScope;
  severity: Severity;
  category:
    | 'economic'
    | 'political'
    | 'natural'
    | 'crime'
    | 'corporate'
    | 'technology'
    | 'social'
    | 'financial'
    | 'faction'
    | 'player';
  /** Base selection weight before conditions and modifiers. */
  weight: number;
  cooldownDays: number;
  durationDays: [number, number] | null;
  conditions: EventCondition[];
  effects: EventEffect[];
  /** Follow-on events, rolled when this event fires. Always present (possibly empty). */
  chain: EventChainLink[];
  /** Optional standing news copy; `{location}` is substituted by the applier.
   *  Most events instead emit a `news` effect so copy can vary per effect. */
  headline?: string;
  body?: string;
  tags: string[];
  /** If true, one location is chosen as the epicentre. */
  targetsLocation?: boolean;
}

export type EventDefSeed = Pick<EventDef, 'id' | 'name' | 'scope' | 'severity' | 'category'> &
  Partial<Omit<EventDef, 'id' | 'name' | 'scope' | 'severity' | 'category'>>;

const EVENT_DEFAULTS: Omit<EventDef, 'id' | 'name' | 'scope' | 'severity' | 'category'> = {
  weight: 1,
  cooldownDays: 25,
  durationDays: null,
  conditions: [],
  effects: [],
  chain: [],
  tags: [],
};

function ev(e: EventDefSeed): EventDef {
  return { ...EVENT_DEFAULTS, ...e } as EventDef;
}

/* ------------------------------------------------------------------ */
/* The event catalogue                                                 */
/* ------------------------------------------------------------------ */

export const EVENTS: EventDef[] = [
  /* =========================== ECONOMIC / MACRO =========================== */
  ev({
    id: 'inflation_surge', name: 'Inflation Surge', scope: 'global', severity: 'major', category: 'economic',
    weight: 1.5, cooldownDays: 60, durationDays: [40, 120],
    conditions: [{ kind: 'inflation_below', value: 0.12 }, { kind: 'min_day', day: 20 }],
    effects: [
      { kind: 'inflation', delta: 0.05 },
      { kind: 'price_shift', categories: ['foodstuff', 'agriculture', 'energy'], multiplier: 1.14, locationScope: 'global', durationDays: 60 },
      { kind: 'global_sentiment', delta: -0.1 },
      { kind: 'stock_market', delta: -0.04 },
      { kind: 'news', headline: 'Inflation runs hot as food and energy lead', body: 'Headline inflation accelerated again this quarter. Central bankers insist the move is transitory; market pricing says otherwise.', importance: 4 },
    ],
    chain: [{ eventId: 'central_bank_hike', chance: 0.65, delayDays: [8, 30] }],
    tags: ['macro', 'inflation'],
  }),
  ev({
    id: 'central_bank_hike', name: 'Central Bank Rate Hike', scope: 'global', severity: 'moderate', category: 'financial',
    weight: 1.4, cooldownDays: 45, durationDays: null,
    conditions: [{ kind: 'inflation_above', value: 0.07 }],
    effects: [
      { kind: 'interest_rate', delta: 0.022 },
      { kind: 'stock_market', delta: -0.035 },
      { kind: 'crypto_market', delta: -0.06 },
      { kind: 'global_sentiment', delta: -0.06 },
      { kind: 'news', headline: 'Central bank raises base rate by 220 basis points', body: 'Borrowing costs rise across the economy. Mortgages, trade finance and margin lending all reprice immediately.', importance: 4 },
    ],
    chain: [{ eventId: 'recession_onset', chance: 0.3, delayDays: [40, 120] }],
    tags: ['macro', 'rates'],
  }),
  ev({
    id: 'central_bank_cut', name: 'Central Bank Rate Cut', scope: 'global', severity: 'moderate', category: 'financial',
    weight: 1.2, cooldownDays: 45, durationDays: null,
    conditions: [{ kind: 'global_sentiment_below', value: 0.35 }],
    effects: [
      { kind: 'interest_rate', delta: -0.018 },
      { kind: 'stock_market', delta: 0.05 },
      { kind: 'crypto_market', delta: 0.08 },
      { kind: 'global_sentiment', delta: 0.09 },
      { kind: 'news', headline: 'Easing cycle begins as central bank cuts rates', body: 'Cheap money is back. Risk assets rallied within minutes of the announcement.', importance: 4 },
    ],
    tags: ['macro', 'rates'],
  }),
  ev({
    id: 'recession_onset', name: 'Recession', scope: 'global', severity: 'major', category: 'economic',
    weight: 1.0, cooldownDays: 120, durationDays: [90, 220],
    conditions: [{ kind: 'global_sentiment_below', value: 0.3 }, { kind: 'min_day', day: 60 }],
    effects: [
      { kind: 'cycle_shock', delta: -0.22 },
      { kind: 'demand_shift', categories: ['luxury', 'art', 'beverage', 'technology', 'electronics'], multiplier: 0.74, locationScope: 'global', durationDays: 150 },
      { kind: 'demand_shift', categories: ['foodstuff', 'agriculture', 'pharmaceutical'], multiplier: 1.05, locationScope: 'global', durationDays: 150 },
      { kind: 'stock_market', delta: -0.16 },
      { kind: 'global_sentiment', delta: -0.18 },
      { kind: 'interest_rate', delta: -0.012 },
      { kind: 'news', headline: 'Economy enters recession as consumption contracts', body: 'Discretionary spending has fallen for a second quarter. Discretionary goods are being destocked across every port.', importance: 5 },
    ],
    chain: [{ eventId: 'bank_failure', chance: 0.3, delayDays: [20, 70] }, { eventId: 'unrest_strikes', chance: 0.4, delayDays: [10, 45] }],
    tags: ['macro', 'cycle'],
  }),
  ev({
    id: 'economic_boom', name: 'Economic Boom', scope: 'global', severity: 'moderate', category: 'economic',
    weight: 1.1, cooldownDays: 120, durationDays: [90, 200],
    conditions: [{ kind: 'global_sentiment_above', value: 0.72 }, { kind: 'inflation_below', value: 0.1 }],
    effects: [
      { kind: 'cycle_shock', delta: 0.18 },
      { kind: 'demand_shift', categories: ['luxury', 'art', 'technology', 'electronics', 'beverage', 'construction'], multiplier: 1.28, locationScope: 'global', durationDays: 160 },
      { kind: 'stock_market', delta: 0.12 },
      { kind: 'global_sentiment', delta: 0.1 },
      { kind: 'news', headline: 'Boom conditions: confidence at multi-year high', body: 'Construction, luxury and technology orders are surging. Freight rates are rising with them.', importance: 4 },
    ],
    chain: [{ eventId: 'asset_bubble', chance: 0.4, delayDays: [40, 100] }],
    tags: ['macro', 'cycle'],
  }),
  ev({
    id: 'asset_bubble', name: 'Asset Bubble', scope: 'global', severity: 'major', category: 'financial',
    weight: 0.8, cooldownDays: 150, durationDays: [60, 160],
    conditions: [{ kind: 'global_sentiment_above', value: 0.8 }, { kind: 'min_day', day: 120 }],
    effects: [
      { kind: 'stock_market', delta: 0.22 },
      { kind: 'crypto_market', delta: 0.35 },
      { kind: 'global_sentiment', delta: 0.06 },
      { kind: 'news', headline: 'Valuation stretch reaches historic extremes', body: 'Analysts note that current multiples require growth nobody can evidence. Nobody is selling yet.', importance: 4 },
    ],
    chain: [{ eventId: 'market_crash', chance: 0.6, delayDays: [25, 90] }],
    tags: ['macro', 'bubble'],
  }),
  ev({
    id: 'market_crash', name: 'Market Crash', scope: 'global', severity: 'catastrophic', category: 'financial',
    weight: 0.7, cooldownDays: 180, durationDays: [30, 90],
    conditions: [{ kind: 'global_sentiment_above', value: 0.6 }, { kind: 'min_day', day: 100 }, { kind: 'probability', chance: 0.4 }],
    effects: [
      { kind: 'stock_market', delta: -0.32 },
      { kind: 'crypto_market', delta: -0.44 },
      { kind: 'global_sentiment', delta: -0.32 },
      { kind: 'cycle_shock', delta: -0.16 },
      { kind: 'interest_rate', delta: -0.02 },
      { kind: 'news', headline: 'Global markets crash as leverage unwinds', body: 'Margin calls cascaded through the session. Two brokerages suspended withdrawals before the close.', importance: 5 },
    ],
    chain: [{ eventId: 'bank_failure', chance: 0.5, delayDays: [2, 20] }, { eventId: 'recession_onset', chance: 0.55, delayDays: [20, 80] }],
    tags: ['macro', 'crash'],
  }),
  ev({
    id: 'currency_crisis', name: 'Currency Crisis', scope: 'national', severity: 'major', category: 'financial',
    weight: 0.9, cooldownDays: 90, durationDays: [30, 90],
    conditions: [{ kind: 'probability', chance: 0.5 }],
    effects: [
      { kind: 'currency_crisis', severity: 0.3 },
      { kind: 'price_shift', categories: ['foodstuff', 'energy', 'pharmaceutical'], multiplier: 1.35, locationScope: 'country', durationDays: 70 },
      { kind: 'demand_shift', categories: ['luxury', 'metal'], multiplier: 1.4, locationScope: 'country', durationDays: 45 },
      { kind: 'news', headline: 'Currency collapse drives import prices up a third', body: 'Importers are demanding hard currency. Gold and dollar assets are being bought at any price.', importance: 4 },
    ],
    targetsLocation: true,
    chain: [{ eventId: 'unrest_strikes', chance: 0.45, delayDays: [3, 25] }],
    tags: ['macro', 'fx'],
  }),
  ev({
    id: 'bank_failure', name: 'Bank Failure', scope: 'national', severity: 'major', category: 'financial',
    weight: 0.7, cooldownDays: 120, durationDays: [10, 40],
    conditions: [{ kind: 'global_sentiment_below', value: 0.4 }],
    effects: [
      { kind: 'bank_failure', chance: 0.5 },
      { kind: 'global_sentiment', delta: -0.08 },
      { kind: 'news', headline: 'Regional bank placed into resolution', body: 'Depositors queued from before dawn. Authorities promise insured deposits will be made whole.', importance: 4 },
    ],
    targetsLocation: true,
    tags: ['financial'],
  }),
  ev({
    id: 'credit_crunch', name: 'Credit Crunch', scope: 'global', severity: 'moderate', category: 'financial',
    weight: 1.0, cooldownDays: 80, durationDays: [40, 110],
    conditions: [{ kind: 'interest_rate_above', value: 0.1 }, { kind: 'min_day', day: 40 }],
    effects: [
      { kind: 'interest_rate', delta: 0.03 },
      { kind: 'demand_shift', categories: ['construction', 'vehicle_part', 'technology'], multiplier: 0.82, locationScope: 'global', durationDays: 90 },
      { kind: 'news', headline: 'Lenders tighten standards as funding costs climb', body: 'Trade finance lines are being cut. Borrowers with weak covenants are being asked for collateral.', importance: 3 },
    ],
    tags: ['financial', 'credit'],
  }),

  /* ============================ SUPPLY / TRADE ============================ */
  ev({
    id: 'mine_strike', name: 'Mine Strike', scope: 'regional', severity: 'moderate', category: 'economic',
    weight: 1.6, cooldownDays: 35, durationDays: [12, 45],
    conditions: [{ kind: 'min_day', day: 10 }],
    effects: [
      { kind: 'supply_shift', categories: ['metal', 'raw_material'], multiplier: 0.55, locationScope: 'region', durationDays: 40 },
      { kind: 'price_shift', categories: ['metal'], multiplier: 1.24, locationScope: 'global', durationDays: 35 },
      { kind: 'news', headline: 'Strike halts output at major mine complex', body: 'Union members voted overwhelmingly for industrial action. Smelters are already short of feedstock.', importance: 3 },
    ],
    targetsLocation: true,
    chain: [{ eventId: 'metal_shortage', chance: 0.5, delayDays: [5, 20] }],
    tags: ['supply', 'labour'],
  }),
  ev({
    id: 'metal_shortage', name: 'Industrial Metal Shortage', scope: 'global', severity: 'moderate', category: 'economic',
    weight: 1.2, cooldownDays: 45, durationDays: [20, 60],
    conditions: [],
    effects: [
      { kind: 'supply_shift', categories: ['metal'], multiplier: 0.75, locationScope: 'global', durationDays: 50 },
      { kind: 'price_shift', categories: ['metal', 'manufactured', 'construction'], multiplier: 1.18, locationScope: 'global', durationDays: 45 },
      { kind: 'stock_market', delta: -0.02, sectors: ['Materials'] },
      { kind: 'news', headline: 'Fabricators ration output as metal inventories run down', body: 'Order books are full and material is not. Whoever holds stock is setting their own price.', importance: 3 },
    ],
    tags: ['supply', 'shortage'],
  }),
  ev({
    id: 'drought', name: 'Drought', scope: 'regional', severity: 'major', category: 'natural',
    weight: 1.4, cooldownDays: 60, durationDays: [40, 120],
    conditions: [{ kind: 'min_day', day: 15 }],
    effects: [
      { kind: 'supply_shift', categories: ['agriculture', 'livestock', 'foodstuff'], multiplier: 0.5, locationScope: 'region', durationDays: 100 },
      { kind: 'price_shift', categories: ['agriculture', 'foodstuff'], multiplier: 1.4, locationScope: 'global', durationDays: 80 },
      { kind: 'demand_shift', categories: ['foodstuff'], multiplier: 1.8, locationScope: 'region', durationDays: 90 },
      { kind: 'news', headline: 'Drought destroys harvest across the region', body: 'Reservoirs are at record lows. Export licences for staple grains are being suspended.', importance: 4 },
    ],
    targetsLocation: true,
    chain: [{ eventId: 'food_riots', chance: 0.45, delayDays: [15, 50] }],
    tags: ['supply', 'weather', 'food'],
  }),
  ev({
    id: 'bumper_harvest', name: 'Bumper Harvest', scope: 'regional', severity: 'minor', category: 'natural',
    weight: 1.5, cooldownDays: 55, durationDays: [30, 90],
    conditions: [{ kind: 'min_day', day: 15 }],
    effects: [
      { kind: 'supply_shift', categories: ['agriculture', 'foodstuff'], multiplier: 1.65, locationScope: 'region', durationDays: 75 },
      { kind: 'price_shift', categories: ['agriculture', 'foodstuff'], multiplier: 0.78, locationScope: 'global', durationDays: 50 },
      { kind: 'news', headline: 'Record harvest sends grain prices lower', body: 'Storage is full and elevators are paying less. Producers are holding back what they can.', importance: 2 },
    ],
    targetsLocation: true,
    tags: ['supply', 'surplus', 'food'],
  }),
  ev({
    id: 'oil_supply_shock', name: 'Oil Supply Shock', scope: 'global', severity: 'major', category: 'economic',
    weight: 1.1, cooldownDays: 70, durationDays: [25, 80],
    conditions: [{ kind: 'min_day', day: 25 }],
    effects: [
      { kind: 'supply_shift', categories: ['energy'], multiplier: 0.7, locationScope: 'global', durationDays: 60 },
      { kind: 'price_shift', categories: ['energy', 'chemical'], multiplier: 1.45, locationScope: 'global', durationDays: 55 },
      { kind: 'inflation', delta: 0.022 },
      { kind: 'stock_market', delta: -0.05 },
      { kind: 'news', headline: 'Oil spikes on supply disruption', body: 'A pipeline outage and an unplanned refinery shutdown have removed significant barrels from the market. Freight and chemical costs follow.', importance: 5 },
    ],
    chain: [{ eventId: 'inflation_surge', chance: 0.4, delayDays: [10, 40] }],
    tags: ['supply', 'energy', 'geopolitical'],
  }),
  ev({
    id: 'oil_glut', name: 'Oil Glut', scope: 'global', severity: 'moderate', category: 'economic',
    weight: 0.9, cooldownDays: 80, durationDays: [40, 110],
    conditions: [{ kind: 'min_day', day: 40 }],
    effects: [
      { kind: 'supply_shift', categories: ['energy'], multiplier: 1.5, locationScope: 'global', durationDays: 90 },
      { kind: 'price_shift', categories: ['energy'], multiplier: 0.68, locationScope: 'global', durationDays: 80 },
      { kind: 'inflation', delta: -0.014 },
      { kind: 'stock_market', delta: -0.03, sectors: ['Energy'] },
      { kind: 'news', headline: 'Storage fills as producers refuse to cut output', body: 'Tankers are being chartered as floating storage. Refining margins are the only thing holding up.', importance: 3 },
    ],
    tags: ['supply', 'energy', 'surplus'],
  }),
  ev({
    id: 'port_congestion', name: 'Port Congestion', scope: 'local', severity: 'moderate', category: 'economic',
    weight: 2.0, cooldownDays: 28, durationDays: [8, 30],
    conditions: [{ kind: 'min_day', day: 5 }],
    effects: [
      { kind: 'route_disruption', durationDays: 18, costMultiplier: 1.7, reason: 'Port congestion' },
      { kind: 'supply_shift', categories: ['manufactured', 'electronics', 'textile'], multiplier: 0.82, locationScope: 'region', durationDays: 25 },
      { kind: 'news', headline: 'Vessels wait weeks at {location}', body: 'Berth congestion and a chassis shortage have backed up the terminal. Importers are paying premiums for anything already onshore.', importance: 3 },
    ],
    targetsLocation: true,
    tags: ['logistics', 'supply'],
  }),
  ev({
    id: 'container_shortage', name: 'Container Shortage', scope: 'global', severity: 'moderate', category: 'economic',
    weight: 1.0, cooldownDays: 90, durationDays: [30, 90],
    conditions: [{ kind: 'min_day', day: 30 }],
    effects: [
      { kind: 'price_shift', categories: ['manufactured', 'electronics', 'textile', 'foodstuff'], multiplier: 1.12, locationScope: 'global', durationDays: 70 },
      { kind: 'route_disruption', durationDays: 45, costMultiplier: 1.55, reason: 'Container shortage' },
      { kind: 'news', headline: 'Freight rates triple as containers sit in the wrong places', body: 'Empty boxes are stranded inland. Shippers are booking months ahead.', importance: 3 },
    ],
    tags: ['logistics', 'supply'],
  }),
  ev({
    id: 'export_ban', name: 'Export Ban', scope: 'national', severity: 'major', category: 'political',
    weight: 1.0, cooldownDays: 70, durationDays: [30, 100],
    conditions: [{ kind: 'min_day', day: 20 }],
    effects: [
      { kind: 'supply_shift', categories: ['agriculture', 'foodstuff', 'raw_material'], multiplier: 0.55, locationScope: 'global', durationDays: 80 },
      { kind: 'price_shift', categories: ['agriculture', 'foodstuff', 'raw_material'], multiplier: 1.3, locationScope: 'global', durationDays: 75 },
      { kind: 'news', headline: 'Government bans exports of staple commodities', body: 'Domestic prices are being protected at the expense of every importing country. Panicked buying has begun.', importance: 4 },
    ],
    targetsLocation: true,
    chain: [{ eventId: 'food_riots', chance: 0.25, delayDays: [10, 40] }],
    tags: ['political', 'trade', 'supply'],
  }),
  ev({
    id: 'sanctions_package', name: 'New Sanctions Package', scope: 'global', severity: 'major', category: 'political',
    weight: 0.9, cooldownDays: 100, durationDays: [60, 200],
    conditions: [{ kind: 'min_day', day: 45 }],
    effects: [
      { kind: 'supply_shift', categories: ['energy', 'metal', 'raw_material'], multiplier: 0.72, locationScope: 'global', durationDays: 150 },
      { kind: 'price_shift', categories: ['energy', 'metal'], multiplier: 1.28, locationScope: 'global', durationDays: 120 },
      { kind: 'tax_change', delta: 0.02 },
      { kind: 'news', headline: 'Sanctions announced on major commodity exporter', body: 'Compliance teams are already blocking shipments. Sanctioned-origin material now trades at a large discount in the wrong hands.', importance: 4 },
    ],
    targetsLocation: true,
    tags: ['political', 'trade', 'sanctions'],
  }),
  ev({
    id: 'trade_agreement', name: 'Trade Agreement', scope: 'regional', severity: 'minor', category: 'political',
    weight: 1.1, cooldownDays: 90, durationDays: null,
    conditions: [{ kind: 'min_day', day: 30 }],
    effects: [
      { kind: 'tax_change', delta: -0.025 },
      { kind: 'demand_shift', categories: ['manufactured', 'agriculture', 'electronics'], multiplier: 1.15, locationScope: 'region', durationDays: 120 },
      { kind: 'news', headline: 'Tariffs slashed under new trade agreement', body: 'Cross-border trade costs fall immediately. Established arbitrage routes will narrow.', importance: 3 },
    ],
    targetsLocation: true,
    tags: ['political', 'trade'],
  }),

  /* ============================== NATURAL ================================= */
  ev({
    id: 'earthquake', name: 'Earthquake', scope: 'local', severity: 'catastrophic', category: 'natural',
    weight: 0.6, cooldownDays: 120, durationDays: [20, 70],
    conditions: [{ kind: 'min_day', day: 30 }, { kind: 'probability', chance: 0.5 }],
    effects: [
      { kind: 'supply_shift', categories: ['construction', 'manufactured', 'foodstuff'], multiplier: 0.4, locationScope: 'region', durationDays: 60 },
      { kind: 'demand_shift', categories: ['construction', 'medical', 'foodstuff', 'energy'], multiplier: 2.2, locationScope: 'region', durationDays: 70 },
      { kind: 'price_shift', categories: ['construction', 'medical', 'manufactured'], multiplier: 1.8, locationScope: 'region', durationDays: 50 },
      { kind: 'route_disruption', durationDays: 25, costMultiplier: 2.1, reason: 'Earthquake damage' },
      { kind: 'property_damage', fraction: 0.18 },
      { kind: 'news', headline: 'Major earthquake strikes {location}', body: 'Buildings collapsed and roads are impassable. Reconstruction materials and generators are being bought at any price.', importance: 5 },
    ],
    targetsLocation: true,
    chain: [{ eventId: 'humanitarian_crisis', chance: 0.6, delayDays: [1, 8] }],
    tags: ['disaster', 'opportunity'],
  }),
  ev({
    id: 'hurricane', name: 'Hurricane', scope: 'regional', severity: 'major', category: 'natural',
    weight: 1.0, cooldownDays: 60, durationDays: [6, 25],
    conditions: [{ kind: 'min_day', day: 20 }],
    effects: [
      { kind: 'route_disruption', durationDays: 12, costMultiplier: 1.9, reason: 'Storm closure' },
      { kind: 'supply_shift', categories: ['agriculture', 'energy', 'foodstuff'], multiplier: 0.55, locationScope: 'region', durationDays: 30 },
      { kind: 'demand_shift', categories: ['manufactured', 'foodstuff', 'medical', 'construction'], multiplier: 1.9, locationScope: 'region', durationDays: 35 },
      { kind: 'property_damage', fraction: 0.08 },
      { kind: 'inventory_spoilage', fraction: 0.15, perishableOnly: true },
      { kind: 'news', headline: 'Hurricane closes ports across the region', body: 'Terminals are shut and power is down. Perishable cargo is spoiling in unrefrigerated holds.', importance: 4 },
    ],
    targetsLocation: true,
    tags: ['disaster', 'weather'],
  }),
  ev({
    id: 'flood', name: 'Flooding', scope: 'local', severity: 'moderate', category: 'natural',
    weight: 1.2, cooldownDays: 50, durationDays: [8, 30],
    conditions: [{ kind: 'min_day', day: 15 }],
    effects: [
      { kind: 'route_disruption', durationDays: 14, costMultiplier: 1.6, reason: 'Flooded roads' },
      { kind: 'supply_shift', categories: ['agriculture', 'raw_material'], multiplier: 0.7, locationScope: 'region', durationDays: 35 },
      { kind: 'inventory_spoilage', fraction: 0.1, perishableOnly: false },
      { kind: 'news', headline: 'Flooding closes roads and inundates warehouses', body: 'Low-lying storage took water. Inspectors are already arguing about what was covered.', importance: 3 },
    ],
    targetsLocation: true,
    tags: ['disaster', 'weather'],
  }),
  ev({
    id: 'pandemic', name: 'Disease Outbreak', scope: 'global', severity: 'major', category: 'natural',
    weight: 0.5, cooldownDays: 200, durationDays: [60, 180],
    conditions: [{ kind: 'min_day', day: 60 }, { kind: 'probability', chance: 0.35 }],
    effects: [
      { kind: 'demand_shift', categories: ['pharmaceutical', 'medical'], multiplier: 2.8, locationScope: 'global', durationDays: 140 },
      { kind: 'demand_shift', categories: ['luxury', 'beverage', 'art'], multiplier: 0.5, locationScope: 'global', durationDays: 120 },
      { kind: 'supply_shift', categories: ['manufactured', 'textile'], multiplier: 0.7, locationScope: 'global', durationDays: 100 },
      { kind: 'location_lockdown', durationDays: 45 },
      { kind: 'stock_market', delta: -0.09 },
      { kind: 'news', headline: 'Outbreak declared a public health emergency', body: 'Borders are tightening. Pharmaceutical and medical supply is now the most valuable cargo anywhere.', importance: 5 },
    ],
    targetsLocation: true,
    chain: [{ eventId: 'medical_shortage', chance: 0.7, delayDays: [5, 25] }],
    tags: ['disaster', 'health', 'opportunity'],
  }),
  ev({
    id: 'medical_shortage', name: 'Medical Supply Shortage', scope: 'global', severity: 'major', category: 'economic',
    weight: 1.0, cooldownDays: 80, durationDays: [30, 90],
    conditions: [],
    effects: [
      { kind: 'supply_shift', categories: ['pharmaceutical', 'medical'], multiplier: 0.45, locationScope: 'global', durationDays: 75 },
      { kind: 'price_shift', categories: ['pharmaceutical', 'medical'], multiplier: 1.9, locationScope: 'global', durationDays: 70 },
      { kind: 'news', headline: 'Hospitals ration supplies as shortages deepen', body: 'Governments are invoking emergency procurement. Anyone holding certified stock has unprecedented pricing power.', importance: 4 },
    ],
    tags: ['shortage', 'health', 'opportunity'],
  }),
  ev({
    id: 'humanitarian_crisis', name: 'Humanitarian Crisis', scope: 'regional', severity: 'major', category: 'social',
    weight: 0.8, cooldownDays: 90, durationDays: [40, 120],
    conditions: [],
    effects: [
      { kind: 'demand_shift', categories: ['foodstuff', 'medical', 'pharmaceutical'], multiplier: 2.4, locationScope: 'region', durationDays: 100 },
      { kind: 'price_shift', categories: ['foodstuff', 'medical'], multiplier: 1.55, locationScope: 'region', durationDays: 90 },
      { kind: 'faction_standing', delta: 6, scope: 'all' },
      { kind: 'news', headline: 'Aid agencies cannot meet demand at {location}', body: 'Relief convoys are being bid against by private traders. Prices for staples have detached from fundamentals.', importance: 4 },
    ],
    targetsLocation: true,
    tags: ['social', 'opportunity'],
  }),
  ev({
    id: 'food_riots', name: 'Food Riots', scope: 'local', severity: 'major', category: 'social',
    weight: 0.9, cooldownDays: 60, durationDays: [5, 25],
    conditions: [],
    effects: [
      { kind: 'location_lockdown', durationDays: 12, scope: 'here' },
      { kind: 'demand_shift', categories: ['foodstuff', 'weapon'], multiplier: 1.5, locationScope: 'here', durationDays: 20 },
      { kind: 'theft', fraction: 0.12, target: 'warehouse' },
      { kind: 'property_damage', fraction: 0.06 },
      { kind: 'news', headline: 'Riots over food prices at {location}', body: 'Shops were looted before police formed lines. Warehouses are being guarded at private expense.', importance: 4 },
    ],
    targetsLocation: true,
    tags: ['social', 'unrest'],
  }),
  ev({
    id: 'unrest_strikes', name: 'General Strikes', scope: 'national', severity: 'moderate', category: 'social',
    weight: 1.1, cooldownDays: 55, durationDays: [6, 30],
    conditions: [{ kind: 'min_day', day: 20 }],
    effects: [
      { kind: 'route_disruption', durationDays: 16, costMultiplier: 1.5, reason: 'General strike' },
      { kind: 'supply_shift', categories: ['manufactured', 'raw_material', 'energy'], multiplier: 0.75, locationScope: 'country', durationDays: 25 },
      { kind: 'business_revenue', multiplier: 0.7, days: 14 },
      { kind: 'news', headline: 'Nationwide strike paralyses transport', body: 'Rail, port and haulage workers have walked out. Goods are not moving and contracts are being missed.', importance: 3 },
    ],
    targetsLocation: true,
    tags: ['labour', 'logistics'],
  }),

  /* ============================== POLITICAL =============================== */
  ev({
    id: 'government_change', name: 'Government Change', scope: 'national', severity: 'moderate', category: 'political',
    weight: 0.9, cooldownDays: 100, durationDays: null,
    conditions: [{ kind: 'min_day', day: 40 }],
    effects: [
      { kind: 'tax_change', delta: 0.02 },
      { kind: 'global_sentiment', delta: -0.04 },
      { kind: 'news', headline: 'Government falls; new administration promises reform', body: 'Policy uncertainty is repricing local assets. Nobody knows yet whether the reforms help or hurt traders.', importance: 3 },
    ],
    targetsLocation: true,
    tags: ['political'],
  }),
  ev({
    id: 'crackdown', name: 'Enforcement Crackdown', scope: 'national', severity: 'major', category: 'political',
    weight: 1.1, cooldownDays: 70, durationDays: [30, 90],
    conditions: [{ kind: 'player_heat_min', value: 25 }],
    effects: [
      { kind: 'player_heat', delta: 14 },
      { kind: 'supply_shift', categories: ['narcotic', 'contraband_misc', 'weapon'], multiplier: 0.5, locationScope: 'country', durationDays: 70 },
      { kind: 'price_shift', categories: ['narcotic', 'contraband_misc', 'weapon'], multiplier: 1.55, locationScope: 'country', durationDays: 60 },
      { kind: 'seizure', chance: 0.22, fraction: 0.5, illegalOnly: true },
      { kind: 'news', headline: 'National crackdown on contraband announced', body: 'Checkpoint staffing doubled and inspectors were rotated. Underground prices have jumped on the news alone.', importance: 4 },
    ],
    targetsLocation: true,
    tags: ['enforcement', 'crime'],
  }),
  ev({
    id: 'new_law', name: 'New Regulation', scope: 'national', severity: 'minor', category: 'political',
    weight: 1.4, cooldownDays: 45, durationDays: null,
    conditions: [{ kind: 'min_day', day: 15 }],
    effects: [
      { kind: 'tax_change', delta: 0.015 },
      { kind: 'price_shift', categories: ['electronics', 'technology', 'pharmaceutical'], multiplier: 1.08, locationScope: 'country', durationDays: 60 },
      { kind: 'news', headline: 'New licensing regime takes effect', body: 'Compliance costs rise for importers. Established operators benefit; newcomers are locked out.', importance: 2 },
    ],
    targetsLocation: true,
    tags: ['political', 'regulation'],
  }),
  ev({
    id: 'border_closure', name: 'Border Closure', scope: 'regional', severity: 'major', category: 'political',
    weight: 0.8, cooldownDays: 80, durationDays: [10, 45],
    conditions: [{ kind: 'min_day', day: 25 }],
    effects: [
      { kind: 'border_closure', durationDays: 28 },
      { kind: 'route_disruption', durationDays: 28, costMultiplier: 2.4, reason: 'Border closed' },
      { kind: 'price_shift', categories: ['foodstuff', 'energy', 'manufactured'], multiplier: 1.25, locationScope: 'region', durationDays: 30 },
      { kind: 'news', headline: 'Border closed following diplomatic breakdown', body: 'Official crossings are shut. Smuggling routes are charging several times normal rates.', importance: 4 },
    ],
    targetsLocation: true,
    tags: ['political', 'logistics'],
  }),
  ev({
    id: 'war_outbreak', name: 'War Outbreak', scope: 'regional', severity: 'catastrophic', category: 'political',
    weight: 0.5, cooldownDays: 150, durationDays: [90, 260],
    conditions: [{ kind: 'min_day', day: 60 }, { kind: 'probability', chance: 0.4 }],
    effects: [
      { kind: 'demand_shift', categories: ['weapon', 'medical', 'pharmaceutical', 'energy', 'foodstuff'], multiplier: 2.6, locationScope: 'region', durationDays: 200 },
      { kind: 'supply_shift', categories: ['manufactured', 'agriculture', 'luxury'], multiplier: 0.45, locationScope: 'region', durationDays: 200 },
      { kind: 'price_shift', categories: ['weapon', 'medical', 'metal'], multiplier: 1.7, locationScope: 'global', durationDays: 180 },
      { kind: 'route_disruption', durationDays: 120, costMultiplier: 2.8, reason: 'Active conflict' },
      { kind: 'global_sentiment', delta: -0.14 },
      { kind: 'stock_market', delta: -0.08 },
      { kind: 'faction_war', chance: 0.6 },
      { kind: 'news', headline: 'War breaks out; arms and medicine prices spike', body: 'Conscripts are mobilising and the civilian economy has stopped. Anything that shoots, heals or burns is being bought on arrival.', importance: 5 },
    ],
    targetsLocation: true,
    chain: [{ eventId: 'refugee_flows', chance: 0.6, delayDays: [10, 40] }, { eventId: 'sanctions_package', chance: 0.4, delayDays: [5, 30] }],
    tags: ['war', 'opportunity'],
  }),
  ev({
    id: 'refugee_flows', name: 'Refugee Flows', scope: 'regional', severity: 'moderate', category: 'social',
    weight: 0.9, cooldownDays: 90, durationDays: [40, 140],
    conditions: [],
    effects: [
      { kind: 'demand_shift', categories: ['foodstuff', 'construction', 'textile', 'medical'], multiplier: 1.5, locationScope: 'region', durationDays: 120 },
      { kind: 'price_shift', categories: ['construction'], multiplier: 1.2, locationScope: 'region', durationDays: 100 },
      { kind: 'news', headline: 'Displacement strains regional housing and food supply', body: 'Construction materials and staples are in sustained demand across host communities.', importance: 3 },
    ],
    targetsLocation: true,
    tags: ['social'],
  }),

  /* ============================== CORPORATE =============================== */
  ev({
    id: 'earnings_beat', name: 'Earnings Beat', scope: 'global', severity: 'minor', category: 'corporate',
    weight: 2.2, cooldownDays: 12, durationDays: null,
    conditions: [{ kind: 'min_day', day: 10 }],
    effects: [
      { kind: 'stock_market', delta: 0.018 },
      { kind: 'news', headline: 'Blue chips beat estimates as margins hold', body: 'Guidance was raised for the second consecutive quarter. Cyclical names led the advance.', importance: 2 },
    ],
    tags: ['corporate', 'equities'],
  }),
  ev({
    id: 'earnings_miss', name: 'Earnings Miss', scope: 'global', severity: 'minor', category: 'corporate',
    weight: 2.0, cooldownDays: 12, durationDays: null,
    conditions: [{ kind: 'min_day', day: 10 }],
    effects: [
      { kind: 'stock_market', delta: -0.022 },
      { kind: 'news', headline: 'Guidance withdrawn as demand softens', body: 'Inventory is building across the industrial complex. Management would not commit to a forecast.', importance: 2 },
    ],
    tags: ['corporate', 'equities'],
  }),
  ev({
    id: 'merger_announced', name: 'Merger Announced', scope: 'global', severity: 'moderate', category: 'corporate',
    weight: 0.9, cooldownDays: 50, durationDays: null,
    conditions: [{ kind: 'min_day', day: 30 }],
    effects: [
      { kind: 'stock_market', delta: 0.012 },
      { kind: 'news', headline: 'Sector consolidation: merger announced at a premium', body: 'The acquirer is paying a substantial premium. Competitors in the sector are being re-rated on takeover speculation.', importance: 3 },
    ],
    tags: ['corporate', 'ma'],
  }),
  ev({
    id: 'corporate_scandal', name: 'Corporate Scandal', scope: 'global', severity: 'major', category: 'corporate',
    weight: 0.7, cooldownDays: 70, durationDays: [20, 60],
    conditions: [{ kind: 'min_day', day: 40 }],
    effects: [
      { kind: 'stock_market', delta: -0.05 },
      { kind: 'global_sentiment', delta: -0.05 },
      { kind: 'news', headline: 'Accounting fraud uncovered at listed group', body: 'Auditors resigned overnight. Counterparties are reviewing exposure to the whole sector.', importance: 4 },
    ],
    tags: ['corporate', 'fraud'],
  }),
  ev({
    id: 'factory_fire', name: 'Factory Fire', scope: 'local', severity: 'moderate', category: 'corporate',
    weight: 1.2, cooldownDays: 45, durationDays: [20, 70],
    conditions: [{ kind: 'min_day', day: 12 }],
    effects: [
      { kind: 'supply_shift', categories: ['manufactured', 'electronics', 'chemical'], multiplier: 0.72, locationScope: 'global', durationDays: 55 },
      { kind: 'price_shift', categories: ['manufactured', 'electronics'], multiplier: 1.14, locationScope: 'global', durationDays: 45 },
      { kind: 'news', headline: 'Fire shuts major component plant', body: 'The facility will not restart for months. Buyers are scrambling for alternative supply.', importance: 3 },
    ],
    targetsLocation: true,
    tags: ['corporate', 'supply'],
  }),

  /* ============================= TECHNOLOGY ============================== */
  ev({
    id: 'tech_breakthrough', name: 'Technology Breakthrough', scope: 'global', severity: 'moderate', category: 'technology',
    weight: 0.9, cooldownDays: 80, durationDays: null,
    conditions: [{ kind: 'min_day', day: 40 }],
    effects: [
      { kind: 'technology_breakthrough', category: 'technology', supplyMultiplier: 1.6 },
      { kind: 'stock_market', delta: 0.04, sectors: ['Technology'] },
      { kind: 'price_shift', categories: ['technology', 'electronics'], multiplier: 0.85, locationScope: 'global', durationDays: 90 },
      { kind: 'news', headline: 'Process breakthrough collapses production costs', body: 'Yields improved dramatically. Incumbent inventory is worth less than it was yesterday.', importance: 3 },
    ],
    tags: ['technology', 'supply'],
  }),
  ev({
    id: 'chip_shortage', name: 'Semiconductor Shortage', scope: 'global', severity: 'major', category: 'technology',
    weight: 1.0, cooldownDays: 110, durationDays: [60, 180],
    conditions: [{ kind: 'min_day', day: 35 }],
    effects: [
      { kind: 'supply_shift', categories: ['electronics', 'technology'], multiplier: 0.5, locationScope: 'global', durationDays: 150 },
      { kind: 'price_shift', categories: ['electronics', 'technology', 'vehicle_part'], multiplier: 1.5, locationScope: 'global', durationDays: 140 },
      { kind: 'stock_market', delta: 0.05, sectors: ['Technology'] },
      { kind: 'news', headline: 'Chip shortage halts assembly lines worldwide', body: 'Automakers are parking unfinished vehicles in fields. Anyone holding components is being paid in advance.', importance: 4 },
    ],
    tags: ['technology', 'shortage', 'opportunity'],
  }),
  ev({
    id: 'cyber_attack', name: 'Major Cyber Attack', scope: 'global', severity: 'major', category: 'technology',
    weight: 0.8, cooldownDays: 90, durationDays: [5, 30],
    conditions: [{ kind: 'min_day', day: 30 }],
    effects: [
      { kind: 'cyber_event', target: 'exchange', severity: 0.4 },
      { kind: 'crypto_market', delta: -0.09 },
      { kind: 'stock_market', delta: -0.025 },
      { kind: 'news', headline: 'Ransomware attack disrupts financial infrastructure', body: 'Withdrawals were suspended at a major venue. Security-related equities rose on the news.', importance: 4 },
    ],
    tags: ['technology', 'cyber', 'crypto'],
  }),
  ev({
    id: 'viral_trend', name: 'Viral Consumer Trend', scope: 'global', severity: 'minor', category: 'social',
    weight: 1.6, cooldownDays: 35, durationDays: [12, 45],
    conditions: [{ kind: 'min_day', day: 8 }],
    effects: [
      { kind: 'demand_shift', categories: ['luxury', 'electronics', 'foodstuff'], multiplier: 1.85, locationScope: 'global', durationDays: 35 },
      { kind: 'price_shift', categories: ['luxury', 'electronics'], multiplier: 1.22, locationScope: 'global', durationDays: 30 },
      { kind: 'news', headline: 'Celebrity endorsement sends one product vertical', body: 'Retailers sold out within hours. Secondary-market prices are multiples of retail.', importance: 2 },
    ],
    tags: ['demand', 'fashion', 'opportunity'],
  }),

  /* ================================ CRYPTO ================================ */
  ev({
    id: 'crypto_rally', name: 'Crypto Rally', scope: 'global', severity: 'moderate', category: 'financial',
    weight: 1.5, cooldownDays: 25, durationDays: [15, 50],
    conditions: [{ kind: 'min_day', day: 10 }],
    effects: [
      { kind: 'crypto_market', delta: 0.18 },
      { kind: 'global_sentiment', delta: 0.05 },
      { kind: 'news', headline: 'Digital assets rally on institutional inflows', body: 'Custodians report record deposits. Funding rates suggest the move is leveraged.', importance: 3 },
    ],
    tags: ['crypto'],
  }),
  ev({
    id: 'crypto_winter', name: 'Crypto Winter', scope: 'global', severity: 'major', category: 'financial',
    weight: 0.9, cooldownDays: 90, durationDays: [60, 180],
    conditions: [{ kind: 'global_sentiment_below', value: 0.45 }, { kind: 'min_day', day: 40 }],
    effects: [
      { kind: 'crypto_market', delta: -0.35 },
      { kind: 'global_sentiment', delta: -0.06 },
      { kind: 'news', headline: 'Digital assets enter sustained drawdown', body: 'Volumes have collapsed and miners are capitulating. Long-term holders are not selling yet.', importance: 3 },
    ],
    tags: ['crypto', 'bear'],
  }),
  ev({
    id: 'exchange_collapse', name: 'Exchange Collapse', scope: 'global', severity: 'catastrophic', category: 'financial',
    weight: 0.45, cooldownDays: 150, durationDays: [30, 90],
    conditions: [{ kind: 'min_day', day: 50 }, { kind: 'probability', chance: 0.4 }],
    effects: [
      { kind: 'crypto_market', delta: -0.28 },
      { kind: 'cyber_event', target: 'exchange', severity: 0.8 },
      { kind: 'global_sentiment', delta: -0.1 },
      { kind: 'news', headline: 'Major exchange halts withdrawals amid solvency fears', body: 'Customer funds appear to have been lent to an affiliated trading desk. Self-custody demand has spiked.', importance: 5 },
    ],
    tags: ['crypto', 'crisis'],
  }),
  ev({
    id: 'crypto_regulation', name: 'Crypto Regulation', scope: 'national', severity: 'moderate', category: 'political',
    weight: 1.1, cooldownDays: 60, durationDays: null,
    conditions: [{ kind: 'min_day', day: 25 }],
    effects: [
      { kind: 'crypto_market', delta: -0.12 },
      { kind: 'price_shift', categories: ['crypto_asset'], multiplier: 0.9, locationScope: 'country', durationDays: 40 },
      { kind: 'news', headline: 'Regulators impose licensing on digital asset venues', body: 'Several exchanges announced withdrawals from the jurisdiction. Privacy tokens were delisted outright.', importance: 3 },
    ],
    targetsLocation: true,
    tags: ['crypto', 'regulation'],
  }),
  ev({
    id: 'halving', name: 'Issuance Halving', scope: 'global', severity: 'moderate', category: 'financial',
    weight: 0.7, cooldownDays: 180, durationDays: null,
    conditions: [{ kind: 'min_day', day: 90 }],
    effects: [
      { kind: 'crypto_market', delta: 0.14 },
      { kind: 'news', headline: 'Block reward halved; new supply cuts in half', body: 'Miner revenue per block has dropped. Historically this precedes extended appreciation, and extended miner capitulation.', importance: 3 },
    ],
    tags: ['crypto', 'supply'],
  }),

  /* ============================== FACTIONS ================================ */
  ev({
    id: 'faction_war', name: 'Faction War', scope: 'regional', severity: 'major', category: 'faction',
    weight: 1.0, cooldownDays: 60, durationDays: [30, 120],
    conditions: [{ kind: 'min_day', day: 25 }],
    effects: [
      { kind: 'faction_war', chance: 0.8 },
      { kind: 'demand_shift', categories: ['weapon', 'medical', 'equipment'], multiplier: 1.9, locationScope: 'region', durationDays: 90 },
      { kind: 'price_shift', categories: ['weapon', 'narcotic'], multiplier: 1.35, locationScope: 'region', durationDays: 80 },
      { kind: 'player_heat', delta: 6 },
      { kind: 'news', headline: 'Rival organisations go to war over territory', body: 'Shootings overnight at {location}. Rivals are buying protection and weapons at any price.', importance: 4 },
    ],
    targetsLocation: true,
    chain: [{ eventId: 'turf_vacuum', chance: 0.5, delayDays: [10, 40] }],
    tags: ['faction', 'war', 'opportunity'],
  }),
  ev({
    id: 'turf_vacuum', name: 'Turf Vacuum', scope: 'local', severity: 'moderate', category: 'faction',
    weight: 1.0, cooldownDays: 50, durationDays: [20, 70],
    conditions: [],
    effects: [
      { kind: 'demand_shift', categories: ['narcotic', 'contraband_misc', 'weapon'], multiplier: 1.6, locationScope: 'here', durationDays: 55 },
      { kind: 'faction_standing', delta: 4, scope: 'criminal' },
      { kind: 'news', headline: 'Power vacuum at {location} after leadership losses', body: 'Nobody is in charge, which means anybody can move product. For now.', importance: 3 },
    ],
    targetsLocation: true,
    tags: ['faction', 'opportunity'],
  }),
  ev({
    id: 'faction_alliance', name: 'Faction Alliance', scope: 'regional', severity: 'minor', category: 'faction',
    weight: 1.0, cooldownDays: 70, durationDays: null,
    conditions: [{ kind: 'faction_at_war' }],
    effects: [
      { kind: 'faction_relation', factionId: 'random', delta: 25 },
      { kind: 'price_shift', categories: ['narcotic', 'weapon'], multiplier: 0.9, locationScope: 'region', durationDays: 40 },
      { kind: 'news', headline: 'Rival groups announce a truce', body: 'Prices for contested goods fell immediately. Enforcement is redirecting resources elsewhere.', importance: 2 },
    ],
    targetsLocation: true,
    tags: ['faction'],
  }),
  ev({
    id: 'leadership_change_faction', name: 'Faction Leadership Change', scope: 'regional', severity: 'moderate', category: 'faction',
    weight: 0.9, cooldownDays: 80, durationDays: [15, 60],
    conditions: [{ kind: 'player_reputation_min', dimension: 'criminal', value: 10 }],
    effects: [
      { kind: 'faction_standing', delta: -8, scope: 'criminal' },
      { kind: 'faction_war', chance: 0.3 },
      { kind: 'news', headline: 'Leadership change reshuffles criminal alliances', body: 'Old agreements are being renegotiated. Standing with several organisations has been reset.', importance: 3 },
    ],
    targetsLocation: true,
    tags: ['faction'],
  }),
  ev({
    id: 'protection_demand', name: 'Protection Demand', scope: 'local', severity: 'moderate', category: 'crime',
    weight: 1.2, cooldownDays: 40, durationDays: null,
    conditions: [{ kind: 'player_owns_business' }],
    effects: [
      { kind: 'player_cash', amount: -2400, reason: 'Protection payment' },
      { kind: 'faction_standing', delta: 3, scope: 'criminal' },
      { kind: 'news', headline: 'Local organisation collects on your businesses', body: 'A representative visited each premises and explained the arrangement. Payment was recorded.', importance: 3 },
    ],
    targetsLocation: true,
    tags: ['crime', 'faction', 'player'],
  }),

  /* ================================ CRIME ================================= */
  ev({
    id: 'warehouse_theft', name: 'Warehouse Theft', scope: 'local', severity: 'moderate', category: 'crime',
    weight: 1.4, cooldownDays: 25, durationDays: null,
    conditions: [{ kind: 'player_owns_property' }],
    effects: [
      { kind: 'theft', fraction: 0.14, target: 'warehouse' },
      { kind: 'news', headline: 'Break-in at your storage facility', body: 'Entry was through a door that should have been alarmed. Inventory is missing.', importance: 3 },
    ],
    targetsLocation: true,
    tags: ['crime', 'logistics', 'player'],
  }),
  ev({
    id: 'hijacking', name: 'Shipment Hijacking', scope: 'local', severity: 'moderate', category: 'crime',
    weight: 1.2, cooldownDays: 30, durationDays: null,
    conditions: [{ kind: 'min_day', day: 10 }],
    effects: [
      { kind: 'route_disruption', durationDays: 10, costMultiplier: 1.45, reason: 'Hijacking risk' },
      { kind: 'news', headline: 'Convoy hijacked on the route out of {location}', body: 'Other operators are rerouting or paying for armed escorts. Transit costs are up.', importance: 3 },
    ],
    targetsLocation: true,
    tags: ['crime', 'logistics'],
  }),
  ev({
    id: 'police_raid', name: 'Police Raid', scope: 'local', severity: 'major', category: 'crime',
    weight: 1.1, cooldownDays: 45, durationDays: null,
    conditions: [{ kind: 'player_heat_min', value: 45 }, { kind: 'player_holds_illegal_inventory' }],
    effects: [
      { kind: 'seizure', chance: 0.7, fraction: 0.8, illegalOnly: true },
      { kind: 'player_heat', delta: -18 },
      { kind: 'arrest_chance', chance: 0.25, days: [20, 120] },
      { kind: 'property_damage', fraction: 0.1 },
      { kind: 'spawn_combat', table: 'raid', enemyCount: [2, 4], stakes: 'high' },
      { kind: 'news', headline: 'Premises searched by tactical officers', body: 'Warrants were executed at first light. Anything undocumented has been seized.', importance: 4 },
    ],
    targetsLocation: true,
    tags: ['enforcement', 'crime', 'player'],
  }),
  ev({
    id: 'customs_inspection_sweep', name: 'Customs Sweep', scope: 'regional', severity: 'moderate', category: 'crime',
    weight: 1.3, cooldownDays: 35, durationDays: [7, 25],
    conditions: [{ kind: 'min_day', day: 12 }],
    effects: [
      { kind: 'seizure', chance: 0.3, fraction: 0.6, illegalOnly: true },
      { kind: 'route_disruption', durationDays: 14, costMultiplier: 1.4, reason: 'Enhanced inspections' },
      { kind: 'price_shift', categories: ['contraband_misc', 'narcotic'], multiplier: 1.2, locationScope: 'region', durationDays: 20 },
      { kind: 'news', headline: 'Enhanced inspection regime at regional crossings', body: 'Scanners are running and dogs are working every vehicle. Contraband prices have risen on the news.', importance: 3 },
    ],
    targetsLocation: true,
    tags: ['enforcement', 'logistics'],
  }),
  ev({
    id: 'informant', name: 'Informant', scope: 'local', severity: 'moderate', category: 'crime',
    weight: 0.9, cooldownDays: 60, durationDays: null,
    conditions: [{ kind: 'player_heat_min', value: 30 }, { kind: 'player_has_crew', min: 1 }],
    effects: [
      { kind: 'player_heat', delta: 16 },
      { kind: 'crew_effect', loyaltyDelta: -12, moraleDelta: -8, injuryChance: 0 },
      { kind: 'news', headline: 'Someone close to you is talking', body: 'An investigation has accelerated. Your people know it, and they are nervous.', importance: 3 },
    ],
    tags: ['enforcement', 'crew', 'player'],
  }),
  ev({
    id: 'rival_undercut', name: 'Rival Undercutting', scope: 'local', severity: 'minor', category: 'crime',
    weight: 1.8, cooldownDays: 20, durationDays: [10, 35],
    conditions: [{ kind: 'min_day', day: 8 }],
    effects: [
      { kind: 'competitor_action', action: 'dump', intensity: 0.5 },
      { kind: 'price_shift', categories: ['narcotic', 'contraband_misc', 'electronics'], multiplier: 0.88, locationScope: 'here', durationDays: 25 },
      { kind: 'news', headline: 'New supplier floods the local market', body: 'Someone is selling below cost to take share. Margins at {location} have compressed.', importance: 2 },
    ],
    targetsLocation: true,
    tags: ['competition'],
  }),
  ev({
    id: 'black_market_opportunity', name: 'Hidden Opportunity', scope: 'local', severity: 'minor', category: 'crime',
    weight: 1.6, cooldownDays: 18, durationDays: [4, 14],
    conditions: [{ kind: 'min_day', day: 5 }],
    effects: [
      { kind: 'demand_shift', categories: ['luxury', 'electronics', 'weapon', 'pharmaceutical'], multiplier: 1.7, locationScope: 'here', durationDays: 10 },
      { kind: 'news', headline: 'Acute local demand for high-value goods', body: 'A buyer at {location} is paying well above market and is not asking about provenance.', importance: 3 },
    ],
    targetsLocation: true,
    tags: ['opportunity'],
  }),

  /* =============================== PLAYER ================================= */
  ev({
    id: 'loan_collection', name: 'Debt Collection', scope: 'local', severity: 'moderate', category: 'player',
    weight: 1.6, cooldownDays: 20, durationDays: null,
    conditions: [{ kind: 'player_has_delinquent_loan' }],
    effects: [
      { kind: 'player_reputation', dimension: 'business', delta: -6 },
      { kind: 'spawn_combat', table: 'debt_collection', enemyCount: [1, 3], stakes: 'medium' },
      { kind: 'news', headline: 'Collectors arrive', body: 'Your lenders have stopped writing letters and started sending people.', importance: 3 },
    ],
    tags: ['finance', 'player'],
  }),
  ev({
    id: 'asset_seizure', name: 'Asset Seizure', scope: 'local', severity: 'major', category: 'player',
    weight: 0.8, cooldownDays: 60, durationDays: null,
    conditions: [{ kind: 'player_has_delinquent_loan' }, { kind: 'player_owns_property' }, { kind: 'min_day', day: 20 }],
    effects: [
      { kind: 'property_damage', fraction: 0.25 },
      { kind: 'player_cash', amount: -8000, reason: 'Repossession costs' },
      { kind: 'player_reputation', dimension: 'business', delta: -12 },
      { kind: 'news', headline: 'Creditors move against your assets', body: 'A receiver has been appointed over part of the portfolio. Costs and legal fees were deducted.', importance: 4 },
    ],
    tags: ['finance', 'player'],
  }),
  ev({
    id: 'investment_opportunity', name: 'Private Opportunity', scope: 'local', severity: 'minor', category: 'player',
    weight: 1.4, cooldownDays: 22, durationDays: [3, 12],
    conditions: [{ kind: 'player_net_worth_min', amount: 25000 }],
    effects: [
      { kind: 'spawn_mission', missionId: 'private_placement' },
      { kind: 'news', headline: 'A distressed seller needs cash today', body: 'Someone with a liquidity problem is offering an asset well below value. It is either the deal of the year or a trap.', importance: 3 },
    ],
    targetsLocation: true,
    tags: ['opportunity', 'player'],
  }),
  ev({
    id: 'crew_poached', name: 'Crew Poached', scope: 'local', severity: 'minor', category: 'player',
    weight: 1.1, cooldownDays: 30, durationDays: null,
    conditions: [{ kind: 'player_has_crew', min: 3 }],
    effects: [
      { kind: 'crew_effect', loyaltyDelta: -8, moraleDelta: -5, injuryChance: 0 },
      { kind: 'news', headline: 'A competitor is offering your people more money', body: 'Two of your staff have been approached. Loyalty is falling across the organisation.', importance: 2 },
    ],
    tags: ['crew', 'player'],
  }),
  ev({
    id: 'darknet_vendor_exit_scam', name: 'Vendor Exit Scam', scope: 'global', severity: 'moderate', category: 'crime',
    weight: 1.2, cooldownDays: 40, durationDays: null,
    conditions: [{ kind: 'player_has_underground_access' }],
    effects: [
      { kind: 'player_cash', amount: -1800, dirty: true, reason: 'Escrow lost to exit scam' },
      { kind: 'player_reputation', dimension: 'underground', delta: -3 },
      { kind: 'news', headline: 'A major underground vendor disappeared with escrow', body: 'Finalised orders were never shipped. Trust scores across the market have reset downward.', importance: 3 },
    ],
    tags: ['underground', 'player', 'crime'],
  }),
  ev({
    id: 'insurance_claim', name: 'Insurance Settlement', scope: 'local', severity: 'minor', category: 'player',
    weight: 0.9, cooldownDays: 45, durationDays: null,
    conditions: [{ kind: 'player_owns_property' }, { kind: 'min_day', day: 25 }],
    effects: [
      { kind: 'player_cash', amount: 6500, reason: 'Insurance settlement' },
      { kind: 'news', headline: 'Claim settled', body: 'Adjusters argued about the schedule for weeks, then paid.', importance: 2 },
    ],
    tags: ['player', 'finance'],
  }),
  ev({
    id: 'tax_audit', name: 'Tax Audit', scope: 'national', severity: 'moderate', category: 'player',
    weight: 0.9, cooldownDays: 80, durationDays: [10, 40],
    conditions: [{ kind: 'player_net_worth_min', amount: 150000 }, { kind: 'min_day', day: 30 }],
    effects: [
      { kind: 'player_cash', amount: -12000, reason: 'Tax assessment and penalties' },
      { kind: 'player_heat', delta: 8 },
      { kind: 'news', headline: 'Revenue authorities open an audit', body: 'They want three years of records and an explanation of lifestyle versus declared income.', importance: 4 },
    ],
    tags: ['finance', 'enforcement', 'player'],
  }),
  ev({
    id: 'windfall', name: 'Windfall', scope: 'local', severity: 'minor', category: 'player',
    weight: 0.7, cooldownDays: 60, durationDays: null,
    conditions: [{ kind: 'min_day', day: 20 }],
    effects: [
      { kind: 'player_cash', amount: 4200, reason: 'Windfall' },
      { kind: 'player_xp', amount: 40 },
      { kind: 'news', headline: 'An old debt is repaid', body: 'Someone remembered a favour and settled it in cash.', importance: 2 },
    ],
    targetsLocation: true,
    tags: ['player'],
  }),
  ev({
    id: 'ambush', name: 'Ambush', scope: 'local', severity: 'major', category: 'crime',
    weight: 1.0, cooldownDays: 30, durationDays: null,
    conditions: [{ kind: 'player_net_worth_min', amount: 40000 }, { kind: 'player_heat_min', value: 20 }],
    effects: [
      { kind: 'spawn_combat', table: 'rival_territory', enemyCount: [2, 4], stakes: 'high' },
      { kind: 'news', headline: 'Ambushed in transit', body: 'They knew the route and the schedule. Someone is talking, or someone is watching.', importance: 4 },
    ],
    targetsLocation: true,
    tags: ['combat', 'crime', 'player'],
  }),
  ev({
    id: 'spoilage_event', name: 'Cold Chain Failure', scope: 'local', severity: 'moderate', category: 'player',
    weight: 1.2, cooldownDays: 28, durationDays: null,
    conditions: [{ kind: 'player_has_inventory_category', category: 'foodstuff' }],
    effects: [
      { kind: 'inventory_spoilage', fraction: 0.3, perishableOnly: true },
      { kind: 'news', headline: 'Refrigeration failure destroys perishable stock', body: 'The compressor failed overnight. Everything temperature-sensitive is a write-off.', importance: 3 },
    ],
    tags: ['logistics', 'player'],
  }),
];

export const EVENT_BY_ID: Record<string, EventDef> = Object.fromEntries(EVENTS.map((e) => [e.id, e]));

/** Events grouped by scope for the news filter UI. */
export const EVENTS_BY_SCOPE: Record<EventScope, EventDef[]> = {
  local: EVENTS.filter((e) => e.scope === 'local'),
  regional: EVENTS.filter((e) => e.scope === 'regional'),
  national: EVENTS.filter((e) => e.scope === 'national'),
  global: EVENTS.filter((e) => e.scope === 'global'),
};
