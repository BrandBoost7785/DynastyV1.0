/**
 * MissionRegistry — contract/job templates.
 *
 * Missions are authored as templates; concrete objectives (which commodity,
 * which location, how many) are instantiated at offer time using the seeded
 * RNG so the same save always sees the same offers. This keeps the mission
 * system data-driven while making each game's job board feel specific.
 */

import type { MissionObjective, ReputationDimension } from '../../sim/types';
import type { EventCondition } from './events';

export type MissionObjectiveKind = MissionObjective['kind'];

export interface ObjectiveTemplate {
  kind: MissionObjectiveKind;
  /** How the concrete target is chosen when the mission is instantiated. */
  target:
    | { kind: 'none' }
    | { kind: 'random_commodity'; filter?: { legality?: string[]; minBaseValue?: number; maxBaseValue?: number; category?: string[] } }
    | { kind: 'random_location'; filter?: { kinds?: string[]; minDistanceKm?: number; maxRisk?: number; hidden?: boolean } }
    | { kind: 'random_role' }
    | { kind: 'random_property' }
    | { kind: 'fixed'; id: string }
    | { kind: 'random_faction' };
  /** Amount, optionally scaled by difficulty. */
  amount: number | [number, number];
  amountScalePerDifficulty?: number;
  description: string;
}

export interface MissionDef {
  id: string;
  title: string;
  description: string;
  giverName: string;
  giverFactionId: string | null;
  kind:
    | 'delivery'
    | 'acquisition'
    | 'transport'
    | 'elimination'
    | 'intel'
    | 'finance'
    | 'production'
    | 'escort'
    | 'laundering'
    | 'expansion';
  /** 1 (errand) … 5 (campaign-defining). */
  difficulty: 1 | 2 | 3 | 4 | 5;
  minLevel: number;
  rewardCash: number;
  rewardXp: number;
  reputation: { dimension: ReputationDimension; amount: number }[];
  deadlineDays: [number, number];
  objectives: ObjectiveTemplate[];
  /** Risk of the mission going wrong (combat, seizure, betrayal). */
  risk: number;
  /** Missions unlocked after completing this one. Always present (possibly empty). */
  unlocks: string[];
  /** Availability predicates, evaluated when the job board is rolled. */
  conditions: EventCondition[];
  tags: string[];
}

export type MissionDefSeed = Pick<
  MissionDef,
  | 'id'
  | 'title'
  | 'description'
  | 'giverName'
  | 'kind'
  | 'difficulty'
  | 'minLevel'
  | 'rewardCash'
  | 'rewardXp'
  | 'deadlineDays'
  | 'objectives'
> &
  Partial<Omit<MissionDef,
    | 'id' | 'title' | 'description' | 'giverName' | 'kind' | 'difficulty'
    | 'minLevel' | 'rewardCash' | 'rewardXp' | 'deadlineDays' | 'objectives'>>;

const MISSION_DEFAULTS: Omit<MissionDef,
  | 'id' | 'title' | 'description' | 'giverName' | 'kind' | 'difficulty'
  | 'minLevel' | 'rewardCash' | 'rewardXp' | 'deadlineDays' | 'objectives'> = {
  giverFactionId: null,
  reputation: [],
  unlocks: [],
  conditions: [],
  tags: [],
  risk: 0.15,
};

function m(d: MissionDefSeed): MissionDef {
  return { ...MISSION_DEFAULTS, ...d } as MissionDef;
}

export const MISSIONS: MissionDef[] = [
  /* ---------------------------- early game ---------------------------- */
  m({
    id: 'first_delivery', title: 'A Package Across Town',
    description: 'A shopkeeper needs a box moved to the other side of the city and does not want to use a courier service that keeps records.',
    giverName: 'Corner Store Owner', kind: 'delivery', difficulty: 1, minLevel: 1,
    rewardCash: 900, rewardXp: 90, deadlineDays: [3, 6], risk: 0.08,
    objectives: [
      { kind: 'buy_commodity', target: { kind: 'random_commodity', filter: { legality: ['legal', 'restricted'], maxBaseValue: 400 } }, amount: [4, 12], description: 'Buy {amount} units of {target}' },
      { kind: 'deliver_commodity', target: { kind: 'random_location', filter: { minDistanceKm: 40, maxRisk: 0.5 } }, amount: [4, 12], description: 'Deliver the goods to {target}' },
    ],
    reputation: [{ dimension: 'business', amount: 3 }],
    unlocks: ['regular_supplier', 'night_run'], tags: ['tutorial', 'delivery'],
  }),
  m({
    id: 'market_scout', title: 'Read the Market',
    description: 'A broker wants to know what a good is actually selling for in three cities, not what the ticker says.',
    giverName: 'Independent Broker', kind: 'intel', difficulty: 1, minLevel: 1,
    rewardCash: 1200, rewardXp: 120, deadlineDays: [5, 10], risk: 0.05,
    objectives: [
      { kind: 'travel_to', target: { kind: 'random_location' }, amount: 3, description: 'Visit {amount} different markets and record prices' },
    ],
    reputation: [{ dimension: 'business', amount: 4 }],
    unlocks: ['arbitrage_contract'], tags: ['tutorial', 'intel', 'trading'],
  }),
  m({
    id: 'regular_supplier', title: 'Standing Order',
    description: 'A restaurant group wants a weekly supply of a perishable at a fixed price. Miss a delivery and the contract ends.',
    giverName: 'Restaurant Group Buyer', kind: 'delivery', difficulty: 2, minLevel: 2,
    rewardCash: 3400, rewardXp: 220, deadlineDays: [8, 16], risk: 0.14,
    objectives: [
      { kind: 'buy_commodity', target: { kind: 'random_commodity', filter: { category: ['foodstuff', 'agriculture', 'livestock'] } }, amount: [20, 60], description: 'Source {amount} units of {target}' },
      { kind: 'deliver_commodity', target: { kind: 'fixed', id: 'player_location' }, amount: 1, description: 'Deliver to the buyer at {target}' },
    ],
    reputation: [{ dimension: 'business', amount: 6 }], tags: ['delivery', 'perishable'],
  }),
  m({
    id: 'night_run', title: 'Night Run',
    description: 'Somebody needs a vehicle moved between cities after dark, with the paperwork already in the glovebox.',
    giverName: 'Used Car Dealer', kind: 'transport', difficulty: 2, minLevel: 2,
    rewardCash: 2800, rewardXp: 180, deadlineDays: [4, 9], risk: 0.2,
    objectives: [
      { kind: 'travel_to', target: { kind: 'random_location', filter: { minDistanceKm: 200 } }, amount: 1, description: 'Drive the vehicle to {target}' },
    ],
    reputation: [{ dimension: 'criminal', amount: 3 }], tags: ['transport', 'vehicles'],
  }),

  /* ---------------------------- trading ------------------------------ */
  m({
    id: 'arbitrage_contract', title: 'Spread Work',
    description: 'A trading desk wants a specific spread captured. They do not care how you do it, only that the margin is real.',
    giverName: 'Trading Desk', giverFactionId: 'avalon_exchange', kind: 'acquisition', difficulty: 2, minLevel: 3,
    rewardCash: 6000, rewardXp: 320, deadlineDays: [8, 18], risk: 0.12,
    objectives: [
      { kind: 'buy_commodity', target: { kind: 'random_commodity', filter: { minBaseValue: 200, maxBaseValue: 20000 } }, amount: [10, 40], description: 'Buy {amount} units of {target} cheaply' },
      { kind: 'sell_commodity', target: { kind: 'none' }, amount: 1, description: 'Sell the position for at least 18% over cost' },
    ],
    reputation: [{ dimension: 'business', amount: 8 }],
    conditions: [{ kind: 'player_level_min', level: 3 }], tags: ['trading', 'arbitrage'],
  }),
  m({
    id: 'shortage_fill', title: 'Fill the Shortage',
    description: 'A regional buyer is desperate. Anything you can land in a shortage market sells immediately, at their price.',
    giverName: 'Regional Buyer', kind: 'delivery', difficulty: 3, minLevel: 5,
    rewardCash: 14000, rewardXp: 520, deadlineDays: [10, 22], risk: 0.22,
    objectives: [
      { kind: 'buy_commodity', target: { kind: 'random_commodity', filter: { minBaseValue: 500 } }, amount: [30, 120], description: 'Source {amount} units of {target}' },
      { kind: 'deliver_commodity', target: { kind: 'random_location', filter: { minDistanceKm: 400 } }, amount: 1, description: 'Deliver to the shortage market at {target}' },
    ],
    reputation: [{ dimension: 'business', amount: 10 }], tags: ['trading', 'logistics'],
  }),
  m({
    id: 'bulk_tender', title: 'Government Tender',
    description: 'A public tender for staple goods. Winning it means volume, thin margins and an audit trail you will have to live with.',
    giverName: 'Procurement Office', kind: 'delivery', difficulty: 3, minLevel: 6,
    rewardCash: 22000, rewardXp: 640, deadlineDays: [14, 30], risk: 0.16,
    objectives: [
      { kind: 'buy_commodity', target: { kind: 'random_commodity', filter: { category: ['foodstuff', 'agriculture', 'medical', 'construction'], legality: ['legal'] } }, amount: [200, 800], description: 'Supply {amount} units of {target}' },
      { kind: 'deliver_commodity', target: { kind: 'random_location' }, amount: 1, description: 'Deliver against the tender at {target}' },
    ],
    reputation: [{ dimension: 'legal', amount: 12 }, { dimension: 'business', amount: 8 }],
    tags: ['trading', 'legal', 'volume'],
  }),

  /* ---------------------------- underground --------------------------- */
  m({
    id: 'quiet_cargo', title: 'Quiet Cargo',
    description: 'A crate that must not be inspected, moved between two points. You will not be told what is inside.',
    giverName: 'Anonymous Contact', kind: 'transport', difficulty: 3, minLevel: 5,
    rewardCash: 18000, rewardXp: 580, deadlineDays: [6, 14], risk: 0.45,
    objectives: [
      { kind: 'buy_commodity', target: { kind: 'random_commodity', filter: { legality: ['illegal', 'restricted'] } }, amount: [5, 25], description: 'Collect {amount} units of {target}' },
      { kind: 'deliver_commodity', target: { kind: 'random_location', filter: { minDistanceKm: 300 } }, amount: 1, description: 'Deliver to the contact at {target}' },
    ],
    reputation: [{ dimension: 'criminal', amount: 12 }, { dimension: 'underground', amount: 6 }],
    tags: ['smuggling', 'illegal'],
  }),
  m({
    id: 'precursor_run', title: 'Precursor Run',
    description: 'A chemistry operation needs controlled precursors moved past a checkpoint that is specifically looking for them.',
    giverName: 'Lab Operator', kind: 'transport', difficulty: 4, minLevel: 8,
    rewardCash: 46000, rewardXp: 1100, deadlineDays: [8, 18], risk: 0.62,
    objectives: [
      { kind: 'buy_commodity', target: { kind: 'random_commodity', filter: { category: ['chemical', 'pharmaceutical'], legality: ['restricted', 'illegal'] } }, amount: [10, 40], description: 'Source {amount} units of {target}' },
      { kind: 'deliver_commodity', target: { kind: 'random_location', filter: { kinds: ['hidden_market', 'underground', 'rural'] } }, amount: 1, description: 'Deliver to the lab at {target}' },
    ],
    reputation: [{ dimension: 'criminal', amount: 16 }, { dimension: 'underground', amount: 10 }],
    tags: ['smuggling', 'illegal', 'high_risk'],
  }),
  m({
    id: 'laundering_request', title: 'Clean Money',
    description: 'A business with too much cash needs it in a bank account with a plausible story attached.',
    giverName: 'Nightclub Owner', kind: 'laundering', difficulty: 3, minLevel: 6,
    rewardCash: 12000, rewardXp: 460, deadlineDays: [10, 24], risk: 0.35,
    objectives: [
      { kind: 'launder_amount', target: { kind: 'none' }, amount: [40000, 160000], amountScalePerDifficulty: 0.4, description: 'Launder {amount} through a front' },
    ],
    reputation: [{ dimension: 'criminal', amount: 10 }, { dimension: 'underground', amount: 6 }],
    conditions: [{ kind: 'player_owns_business' }], tags: ['finance', 'laundering'],
  }),
  m({
    id: 'data_broker', title: 'Information Broker',
    description: 'A buyer wants a specific dataset extracted from a target organisation. Do not get caught holding it.',
    giverName: 'Data Broker', giverFactionId: 'sprawl_collective', kind: 'intel', difficulty: 4, minLevel: 9,
    rewardCash: 52000, rewardXp: 1250, deadlineDays: [8, 20], risk: 0.55,
    objectives: [
      { kind: 'buy_commodity', target: { kind: 'fixed', id: 'market_intel__encrypted' }, amount: [1, 3], description: 'Acquire {amount} intelligence assets' },
      { kind: 'deliver_commodity', target: { kind: 'random_location', filter: { kinds: ['underground', 'offshore', 'financial_center'] } }, amount: 1, description: 'Deliver the data to the buyer at {target}' },
    ],
    reputation: [{ dimension: 'underground', amount: 14 }, { dimension: 'digital', amount: 10 }],
    conditions: [{ kind: 'player_has_underground_access' }], tags: ['underground', 'intel', 'cyber'],
  }),
  m({
    id: 'exit_strategy', title: 'Exit Strategy',
    description: 'Someone needs to disappear. Documents, a route and a vehicle that is not registered to them.',
    giverName: 'Nervous Accountant', kind: 'escort', difficulty: 4, minLevel: 10,
    rewardCash: 68000, rewardXp: 1400, deadlineDays: [7, 16], risk: 0.6,
    objectives: [
      { kind: 'buy_commodity', target: { kind: 'fixed', id: 'forged_documents__premium' }, amount: [1, 2], description: 'Obtain {amount} sets of documents' },
      { kind: 'travel_to', target: { kind: 'random_location', filter: { minDistanceKm: 800, hidden: false } }, amount: 1, description: 'Escort the client to {target}' },
    ],
    reputation: [{ dimension: 'criminal', amount: 14 }, { dimension: 'crew', amount: 8 }],
    tags: ['underground', 'escort', 'high_risk'],
  }),

  /* ------------------------------ faction ----------------------------- */
  m({
    id: 'faction_favour', title: 'A Favour',
    description: 'An organisation you have dealings with wants something moved, and wants it done by someone outside their own structure.',
    giverName: 'Faction Lieutenant', kind: 'delivery', difficulty: 3, minLevel: 5,
    rewardCash: 16000, rewardXp: 520, deadlineDays: [6, 14], risk: 0.4,
    objectives: [
      { kind: 'buy_commodity', target: { kind: 'random_commodity', filter: { minBaseValue: 300 } }, amount: [15, 60], description: 'Acquire {amount} units of {target}' },
      { kind: 'deliver_commodity', target: { kind: 'random_location' }, amount: 1, description: 'Deliver to the faction at {target}' },
    ],
    reputation: [{ dimension: 'criminal', amount: 8 }], tags: ['faction', 'delivery'],
  }),
  m({
    id: 'tribute_run', title: 'Tribute',
    description: 'A faction expects a payment. Delivering it personally buys standing that money alone cannot.',
    giverName: 'Faction Collector', kind: 'delivery', difficulty: 2, minLevel: 4,
    rewardCash: 4000, rewardXp: 260, deadlineDays: [5, 12], risk: 0.25,
    objectives: [
      { kind: 'acquire_cash', target: { kind: 'none' }, amount: [10000, 40000], description: 'Raise {amount} and deliver it' },
      { kind: 'reach_faction_standing', target: { kind: 'random_faction' }, amount: 25, description: 'Reach standing 25 with {target}' },
    ],
    reputation: [{ dimension: 'criminal', amount: 6 }], tags: ['faction', 'finance'],
  }),
  m({
    id: 'turf_war_contract', title: 'Turf War Contract',
    description: 'Two organisations are contesting a district. One of them is paying for the other to have a bad week.',
    giverName: 'Faction Capo', kind: 'elimination', difficulty: 5, minLevel: 14,
    rewardCash: 180000, rewardXp: 3200, deadlineDays: [10, 25], risk: 0.78,
    objectives: [
      { kind: 'complete_combat', target: { kind: 'none' }, amount: 3, description: 'Win {amount} engagements against rival forces' },
      { kind: 'travel_to', target: { kind: 'random_location', filter: { maxRisk: 1 } }, amount: 1, description: 'Operate in the contested district' },
    ],
    reputation: [{ dimension: 'criminal', amount: 26 }, { dimension: 'crew', amount: 10 }],
    tags: ['faction', 'combat', 'high_risk'],
  }),

  /* ------------------------------ empire ------------------------------ */
  m({
    id: 'warehouse_contract', title: 'Storage Contract',
    description: 'A trading house needs bonded storage it does not have to build. Owning it makes you indispensable.',
    giverName: 'Trading House', kind: 'expansion', difficulty: 3, minLevel: 7,
    rewardCash: 24000, rewardXp: 700, deadlineDays: [20, 45], risk: 0.1,
    objectives: [
      { kind: 'own_property', target: { kind: 'random_property' }, amount: 1, description: 'Acquire a warehouse or distribution property' },
    ],
    reputation: [{ dimension: 'business', amount: 14 }], tags: ['empire', 'property'],
  }),
  m({
    id: 'fleet_contract', title: 'Fleet Contract',
    description: 'A logistics firm is outsourcing a lane. They want vehicles, drivers and on-time performance.',
    giverName: 'Logistics Director', kind: 'expansion', difficulty: 4, minLevel: 9,
    rewardCash: 58000, rewardXp: 1300, deadlineDays: [25, 60], risk: 0.18,
    objectives: [
      { kind: 'hire_role', target: { kind: 'random_role' }, amount: 3, description: 'Hire {amount} operations staff' },
      { kind: 'deliver_commodity', target: { kind: 'random_location', filter: { minDistanceKm: 500 } }, amount: 5, description: 'Complete {amount} long-haul deliveries' },
    ],
    reputation: [{ dimension: 'business', amount: 16 }, { dimension: 'crew', amount: 8 }],
    tags: ['empire', 'logistics'],
  }),
  m({
    id: 'production_contract', title: 'Industrial Supply Contract',
    description: 'A manufacturer wants a guaranteed input supply. Producing it yourself beats buying it.',
    giverName: 'Plant Manager', kind: 'production', difficulty: 4, minLevel: 11,
    rewardCash: 92000, rewardXp: 1800, deadlineDays: [30, 70], risk: 0.2,
    objectives: [
      { kind: 'produce_commodity', target: { kind: 'random_commodity', filter: { minBaseValue: 400 } }, amount: [40, 200], description: 'Produce {amount} units of {target}' },
      { kind: 'deliver_commodity', target: { kind: 'random_location' }, amount: 1, description: 'Deliver the output to the plant' },
    ],
    reputation: [{ dimension: 'business', amount: 18 }],
    conditions: [{ kind: 'player_owns_property' }], tags: ['empire', 'production'],
  }),
  m({
    id: 'private_placement', title: 'Private Placement',
    description: 'A distressed seller is offering an asset below value. Diligence is your problem, and so is the seller\'s temper.',
    giverName: 'Distressed Seller', kind: 'finance', difficulty: 3, minLevel: 6,
    rewardCash: 34000, rewardXp: 800, deadlineDays: [6, 16], risk: 0.3,
    objectives: [
      { kind: 'acquire_cash', target: { kind: 'none' }, amount: [25000, 120000], description: 'Raise {amount} to fund the placement' },
      { kind: 'reach_net_worth', target: { kind: 'none' }, amount: 1, description: 'Complete the acquisition' },
    ],
    reputation: [{ dimension: 'business', amount: 10 }], tags: ['finance', 'opportunity'],
  }),
  m({
    id: 'credit_repair', title: 'Credit Repair',
    description: 'A bank will extend serious capital, but only to someone whose record is clean. Settle what is outstanding.',
    giverName: 'Relationship Manager', giverFactionId: 'meridian_bank', kind: 'finance', difficulty: 2, minLevel: 4,
    rewardCash: 8000, rewardXp: 380, deadlineDays: [15, 40], risk: 0.08,
    objectives: [
      { kind: 'acquire_cash', target: { kind: 'none' }, amount: [15000, 60000], description: 'Settle outstanding obligations' },
    ],
    reputation: [{ dimension: 'legal', amount: 10 }, { dimension: 'business', amount: 6 }],
    conditions: [{ kind: 'player_has_loans' }], tags: ['finance', 'legal'],
  }),
  m({
    id: 'exchange_access', title: 'Exchange Access',
    description: 'A broker will sponsor your exchange membership if you can demonstrate you will not blow up their clearing account.',
    giverName: 'Prime Broker', kind: 'finance', difficulty: 4, minLevel: 10,
    rewardCash: 46000, rewardXp: 1100, deadlineDays: [20, 50], risk: 0.25,
    objectives: [
      { kind: 'reach_net_worth', target: { kind: 'none' }, amount: [250000, 1000000], description: 'Reach a net worth of {amount}' },
    ],
    reputation: [{ dimension: 'business', amount: 14 }, { dimension: 'legal', amount: 8 }],
    tags: ['finance', 'stocks', 'empire'],
  }),
  m({
    id: 'humanitarian_supply', title: 'Humanitarian Supply',
    description: 'An aid organisation needs staples delivered into a crisis zone. Payment is modest; access and reputation are not.',
    giverName: 'Aid Coordinator', kind: 'delivery', difficulty: 3, minLevel: 6,
    rewardCash: 18000, rewardXp: 620, deadlineDays: [12, 30], risk: 0.4,
    objectives: [
      { kind: 'buy_commodity', target: { kind: 'random_commodity', filter: { category: ['foodstuff', 'medical', 'pharmaceutical'] } }, amount: [100, 400], description: 'Source {amount} units of relief supplies' },
      { kind: 'deliver_commodity', target: { kind: 'random_location', filter: { kinds: ['city', 'port', 'rural'] } }, amount: 1, description: 'Deliver into the crisis zone' },
    ],
    reputation: [{ dimension: 'legal', amount: 20 }, { dimension: 'global', amount: 8 }],
    tags: ['delivery', 'legal', 'reputation'],
  }),
  m({
    id: 'arms_broker', title: 'Arms Brokerage',
    description: 'A militia needs equipment and has cash from somewhere you do not want to know about.',
    giverName: 'Militia Quartermaster', kind: 'delivery', difficulty: 5, minLevel: 13,
    rewardCash: 210000, rewardXp: 3600, deadlineDays: [10, 24], risk: 0.8,
    objectives: [
      { kind: 'buy_commodity', target: { kind: 'random_commodity', filter: { category: ['weapon', 'equipment'] } }, amount: [20, 120], description: 'Source {amount} units of equipment' },
      { kind: 'deliver_commodity', target: { kind: 'random_location', filter: { kinds: ['city', 'border', 'rural'] } }, amount: 1, description: 'Deliver to the buyer' },
    ],
    reputation: [{ dimension: 'criminal', amount: 22 }, { dimension: 'legal', amount: -10 }],
    tags: ['smuggling', 'combat', 'high_risk', 'illegal'],
  }),
  m({
    id: 'cold_chain_contract', title: 'Cold Chain Contract',
    description: 'A hospital network needs temperature-controlled deliveries on a fixed schedule. Failure kills people and contracts.',
    giverName: 'Hospital Procurement', kind: 'delivery', difficulty: 4, minLevel: 9,
    rewardCash: 74000, rewardXp: 1500, deadlineDays: [15, 40], risk: 0.28,
    objectives: [
      { kind: 'buy_commodity', target: { kind: 'random_commodity', filter: { category: ['pharmaceutical', 'medical'] } }, amount: [30, 150], description: 'Source {amount} units of medical product' },
      { kind: 'deliver_commodity', target: { kind: 'random_location' }, amount: 1, description: 'Deliver under cold chain' },
    ],
    reputation: [{ dimension: 'legal', amount: 16 }, { dimension: 'business', amount: 12 }],
    tags: ['delivery', 'cold_chain', 'legal'],
  }),
  m({
    id: 'rival_intel', title: 'Know Your Rival',
    description: 'A competitor is moving product through your territory. Find out what, how much, and who is buying.',
    giverName: 'Concerned Operator', kind: 'intel', difficulty: 3, minLevel: 7,
    rewardCash: 26000, rewardXp: 700, deadlineDays: [8, 20], risk: 0.32,
    objectives: [
      { kind: 'travel_to', target: { kind: 'random_location' }, amount: 4, description: 'Survey {amount} markets for rival activity' },
      { kind: 'buy_commodity', target: { kind: 'fixed', id: 'shipping_manifests__encrypted' }, amount: [1, 2], description: 'Acquire shipping intelligence' },
    ],
    reputation: [{ dimension: 'underground', amount: 8 }], tags: ['intel', 'competition'],
  }),
  m({
    id: 'monopoly_push', title: 'Corner the Market',
    description: 'Buy enough of one commodity in one region that you set the price. Everyone will notice.',
    giverName: 'Your Own Ambition', kind: 'acquisition', difficulty: 5, minLevel: 16,
    rewardCash: 320000, rewardXp: 5200, deadlineDays: [25, 60], risk: 0.5,
    objectives: [
      { kind: 'buy_commodity', target: { kind: 'random_commodity', filter: { minBaseValue: 1000 } }, amount: [300, 1500], description: 'Accumulate {amount} units of {target}' },
      { kind: 'reach_net_worth', target: { kind: 'none' }, amount: [2000000, 10000000], description: 'Reach a net worth of {amount}' },
    ],
    reputation: [{ dimension: 'business', amount: 26 }, { dimension: 'global', amount: 14 }],
    tags: ['empire', 'trading', 'endgame'],
  }),
  m({
    id: 'dynasty_legacy', title: 'The Dynasty',
    description: 'Build something that outlives you: a network of businesses, properties and people that runs itself.',
    giverName: 'Your Own Ambition', kind: 'expansion', difficulty: 5, minLevel: 22,
    rewardCash: 1000000, rewardXp: 12000, deadlineDays: [60, 180], risk: 0.3,
    objectives: [
      { kind: 'own_property', target: { kind: 'random_property' }, amount: 8, description: 'Own {amount} properties' },
      { kind: 'hire_role', target: { kind: 'random_role' }, amount: 15, description: 'Employ {amount} personnel' },
      { kind: 'reach_net_worth', target: { kind: 'none' }, amount: [25000000, 100000000], description: 'Reach a net worth of {amount}' },
    ],
    reputation: [{ dimension: 'global', amount: 30 }, { dimension: 'business', amount: 30 }],
    tags: ['empire', 'endgame', 'legacy'],
  }),
];

export const MISSION_BY_ID: Record<string, MissionDef> = Object.fromEntries(MISSIONS.map((m2) => [m2.id, m2]));

export const ACHIEVEMENTS: { id: string; name: string; description: string; check: string; xp: number }[] = [
  { id: 'first_trade', name: 'First Trade', description: 'Complete your first buy or sell.', check: 'trades>=1', xp: 60 },
  { id: 'first_arbitrage', name: 'Spread Hunter', description: 'Sell a commodity for more than you paid in a different city.', check: 'arbitrage>=1', xp: 140 },
  { id: 'ten_thousand', name: 'Five Figures', description: 'Reach a net worth of 10,000.', check: 'net_worth>=10000', xp: 180 },
  { id: 'hundred_thousand', name: 'Serious Money', description: 'Reach a net worth of 100,000.', check: 'net_worth>=100000', xp: 400 },
  { id: 'millionaire', name: 'Millionaire', description: 'Reach a net worth of 1,000,000.', check: 'net_worth>=1000000', xp: 1200 },
  { id: 'ten_million', name: 'Regional Power', description: 'Reach a net worth of 10,000,000.', check: 'net_worth>=10000000', xp: 3000 },
  { id: 'hundred_million', name: 'National Interest', description: 'Reach a net worth of 100,000,000.', check: 'net_worth>=100000000', xp: 8000 },
  { id: 'billionaire', name: 'Dynasty', description: 'Reach a net worth of 1,000,000,000.', check: 'net_worth>=1000000000', xp: 25000 },
  { id: 'first_property', name: 'Keys', description: 'Acquire your first property.', check: 'properties>=1', xp: 200 },
  { id: 'first_business', name: 'Open For Business', description: 'Establish your first operating business.', check: 'businesses>=1', xp: 260 },
  { id: 'first_employee', name: 'Payroll', description: 'Hire your first employee.', check: 'crew>=1', xp: 160 },
  { id: 'ten_employees', name: 'Organisation', description: 'Employ ten people.', check: 'crew>=10', xp: 600 },
  { id: 'first_production', name: 'Value Added', description: 'Produce your first output on a production line.', check: 'produced>=1', xp: 320 },
  { id: 'first_loan', name: 'Leverage', description: 'Take out your first loan.', check: 'loans>=1', xp: 120 },
  { id: 'debt_free', name: 'Debt Free', description: 'Repay every outstanding loan.', check: 'loans==0&&loans_taken>=1', xp: 700 },
  { id: 'first_stock', name: 'Shareholder', description: 'Buy your first share.', check: 'stocks>=1', xp: 180 },
  { id: 'first_crypto', name: 'Self Custody', description: 'Buy your first digital asset.', check: 'crypto>=1', xp: 180 },
  { id: 'darknet_access', name: 'Onion Router', description: 'Gain access to underground digital markets.', check: 'underground==1', xp: 400 },
  { id: 'first_combat', name: 'Bad Night', description: 'Survive your first combat encounter.', check: 'combats>=1', xp: 240 },
  { id: 'ten_combats', name: 'Hard Target', description: 'Win ten combat encounters.', check: 'combats_won>=10', xp: 1000 },
  { id: 'arrested', name: 'Booking Photo', description: 'Be arrested.', check: 'arrests>=1', xp: 300 },
  { id: 'escaped_prison', name: 'Absent Without Leave', description: 'Escape custody.', check: 'escapes>=1', xp: 2000 },
  { id: 'globetrotter', name: 'Globetrotter', description: 'Visit fifteen different locations.', check: 'locations_visited>=15', xp: 700 },
  { id: 'smuggler', name: 'Customs Evasion', description: 'Complete ten successful illegal deliveries.', check: 'smuggled>=10', xp: 900 },
  { id: 'launderer', name: 'Clean Cycle', description: 'Launder 1,000,000 in total.', check: 'laundered>=1000000', xp: 1500 },
  { id: 'automator', name: 'Hands Off', description: 'Have automation generate 100,000 in profit.', check: 'auto_profit>=100000', xp: 1800 },
  { id: 'level_10', name: 'Established', description: 'Reach level 10.', check: 'level>=10', xp: 500 },
  { id: 'level_25', name: 'Operator', description: 'Reach level 25.', check: 'level>=25', xp: 2000 },
  { id: 'level_50', name: 'Legend', description: 'Reach level 50.', check: 'level>=50', xp: 10000 },
  { id: 'survivor_365', name: 'One Year', description: 'Survive 365 days.', check: 'days>=365', xp: 1200 },
  { id: 'monopolist', name: 'Price Setter', description: 'Hold more than 40% of a market\'s supply in one city.', check: 'market_share>=0.4', xp: 2500 },
];

export const ACHIEVEMENT_BY_ID: Record<string, (typeof ACHIEVEMENTS)[number]> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
);
