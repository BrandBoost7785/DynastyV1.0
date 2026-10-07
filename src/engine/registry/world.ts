/**
 * WorldRegistry — locations, jurisdictions and the route graph.
 *
 * Locations are hand-authored (so the world feels designed rather than
 * procedural noise); their *traded commodity sets* and the *route graph* are
 * derived deterministically from that authoring plus the commodity registry.
 * Adding a location therefore requires no changes to travel, economy or
 * trading code — the derivation supplies everything.
 */

import { Rng } from '../rng';
import type {
  CommodityCategory,
  CommodityDef,
  ID,
  Legality,
  LocationDef,
  LocationKind,
  RouteDef,
  TravelMode,
} from '../../sim/types';
import { getCommodityRegistry } from './commodities';
import { COUNTRY_BY_ID, REGION_BY_ID } from './regions';
import { fnv1aHex } from '../../lib/hash';

/* ------------------------------------------------------------------ */
/* Authoring helpers                                                   */
/* ------------------------------------------------------------------ */

type LawPreset = 'strict' | 'regulated' | 'permissive' | 'corrupt' | 'lawless' | 'offshore' | 'theocratic';

export const LAW_PRESETS: Record<
  LawPreset,
  { taxRate: number; enforcement: number; corruption: number; tolerated: Legality[] }
> = {
  strict: { taxRate: 0.14, enforcement: 0.88, corruption: 0.12, tolerated: ['legal', 'restricted'] },
  regulated: { taxRate: 0.1, enforcement: 0.72, corruption: 0.22, tolerated: ['legal', 'restricted'] },
  permissive: { taxRate: 0.075, enforcement: 0.52, corruption: 0.4, tolerated: ['legal', 'restricted', 'illegal'] },
  corrupt: { taxRate: 0.06, enforcement: 0.34, corruption: 0.78, tolerated: ['legal', 'restricted', 'illegal'] },
  lawless: { taxRate: 0.02, enforcement: 0.14, corruption: 0.9, tolerated: ['legal', 'restricted', 'illegal', 'contraband'] },
  offshore: { taxRate: 0.01, enforcement: 0.4, corruption: 0.55, tolerated: ['legal', 'restricted', 'illegal'] },
  theocratic: { taxRate: 0.09, enforcement: 0.8, corruption: 0.25, tolerated: ['legal', 'restricted'] },
};

interface LocationSeed {
  id: ID;
  name: string;
  countryId: ID;
  regionId: string;
  kind: LocationKind;
  map: { x: number; y: number };
  population: number;
  wealth: number;
  industrial: number;
  service: number;
  unemployment: number;
  law: LawPreset;
  security: number;
  risk: number;
  infrastructure: number;
  costOfLiving: number;
  demand?: Partial<Record<CommodityCategory, number>>;
  legalityOverrides?: Partial<Record<CommodityCategory, Legality>>;
  services?: Partial<LocationDef['financialServices']>;
  factionIds?: ID[];
  hidden?: boolean;
  discovery?: LocationDef['discoveryRequirement'];
  specialties?: string[];
  description: string;
}

function loc(s: LocationSeed): LocationDef {
  const country = COUNTRY_BY_ID[s.countryId];
  const region = REGION_BY_ID[s.regionId];
  if (!country) throw new Error(`Unknown country ${s.countryId} for location ${s.id}`);
  if (!region) throw new Error(`Unknown region ${s.regionId} for location ${s.id}`);
  const preset = LAW_PRESETS[s.law];
  return {
    id: s.id,
    name: s.name,
    countryId: country.id,
    countryName: country.name,
    regionId: region.id,
    regionName: region.name,
    kind: s.kind,
    map: s.map,
    population: s.population,
    economy: {
      wealthIndex: s.wealth,
      industrialIndex: s.industrial,
      serviceIndex: s.service,
      unemployment: s.unemployment,
    },
    laws: {
      legalityOverrides: s.legalityOverrides ?? {},
      taxRate: preset.taxRate,
      enforcement: preset.enforcement,
      corruption: preset.corruption,
      tolerated: [...preset.tolerated],
    },
    security: s.security,
    risk: s.risk,
    demandProfile: s.demand ?? {},
    tradedCommodityIds: [],
    specialties: s.specialties ?? [],
    financialServices: {
      bank: true,
      offshore: false,
      stockExchange: false,
      cryptoExchange: false,
      darknetAccess: false,
      loanSharks: s.risk > 0.5 || s.law === 'corrupt' || s.law === 'lawless',
      auctionHouse: false,
      ...s.services,
    },
    infrastructure: s.infrastructure,
    factionIds: s.factionIds ?? [],
    hidden: s.hidden ?? false,
    discoveryRequirement: s.discovery,
    costOfLivingIndex: s.costOfLiving,
    description: s.description,
  };
}

/* ------------------------------------------------------------------ */
/* The world                                                           */
/* ------------------------------------------------------------------ */

export const LOCATION_SEEDS: LocationSeed[] = [
  /* ---------------------------- Valtreya ---------------------------- */
  {
    id: 'new_avalon', name: 'New Avalon', countryId: 'valtreya', regionId: 'northreach', kind: 'financial_center',
    map: { x: 24, y: 24 }, population: 8_400_000, wealth: 0.96, industrial: 0.42, service: 0.95, unemployment: 0.05,
    law: 'strict', security: 0.92, risk: 0.12, infrastructure: 0.95, costOfLiving: 1.62,
    demand: { luxury: 1.75, financial_asset: 1.9, technology: 1.5, art: 1.7, information: 1.8, beverage: 1.25, pharmaceutical: 1.2 },
    legalityOverrides: { weapon: 'restricted', narcotic: 'illegal' },
    services: { stockExchange: true, cryptoExchange: true, offshore: true, auctionHouse: true, darknetAccess: true },
    factionIds: ['avalon_exchange', 'meridian_bank', 'fifth_family'],
    description: 'The financial capital. Deep liquidity, expensive everything, and surveillance on every corner.',
  },
  {
    id: 'harbor_point', name: 'Harbor Point', countryId: 'valtreya', regionId: 'eastern_seaboard', kind: 'port',
    map: { x: 30, y: 30 }, population: 1_900_000, wealth: 0.62, industrial: 0.78, service: 0.6, unemployment: 0.09,
    law: 'regulated', security: 0.74, risk: 0.34, infrastructure: 0.88, costOfLiving: 1.1,
    demand: { raw_material: 1.4, metal: 1.35, energy: 1.3, manufactured: 1.25, contraband_misc: 1.3 },
    services: { offshore: false, cryptoExchange: true, auctionHouse: true },
    factionIds: ['longshoremen_guild', 'fifth_family'],
    specialties: ['crude_oil__raw', 'copper__concentrate', 'steel__refined'],
    description: 'Container cranes for miles. Customs is thorough but the union knows everything.',
  },
  {
    id: 'ironvale', name: 'Ironvale', countryId: 'valtreya', regionId: 'eastern_seaboard', kind: 'industrial',
    map: { x: 27, y: 34 }, population: 1_100_000, wealth: 0.5, industrial: 0.94, service: 0.35, unemployment: 0.13,
    law: 'regulated', security: 0.68, risk: 0.4, infrastructure: 0.74, costOfLiving: 0.86,
    demand: { metal: 1.5, raw_material: 1.45, energy: 1.4, industrial: 1.5, chemical: 1.4, construction: 1.3 },
    legalityOverrides: { weapon: 'restricted' },
    services: { loanSharks: true },
    factionIds: ['steelworkers_union'],
    specialties: ['steel__refined', 'aluminium__alloy', 'machine_tools__assembled'],
    description: 'Smelters, rolling mills and a workforce that has been on strike twice this decade.',
  },
  {
    id: 'lakeview_junction', name: 'Lakeview Junction', countryId: 'valtreya', regionId: 'midland_plains', kind: 'trading_hub',
    map: { x: 18, y: 32 }, population: 640_000, wealth: 0.55, industrial: 0.5, service: 0.72, unemployment: 0.07,
    law: 'regulated', security: 0.8, risk: 0.2, infrastructure: 0.86, costOfLiving: 0.92,
    demand: { agriculture: 1.4, foodstuff: 1.35, manufactured: 1.2, vehicle_part: 1.25 },
    services: { cryptoExchange: true },
    factionIds: ['grain_board'],
    specialties: ['wheat__raw', 'maize__raw', 'soybean__raw'],
    description: 'Rail crossroads and grain elevators. The cheapest logistics in the country.',
  },
  {
    id: 'gulfport_sud', name: 'Gulfport Sud', countryId: 'valtreya', regionId: 'gulf_arc', kind: 'port',
    map: { x: 16, y: 44 }, population: 980_000, wealth: 0.68, industrial: 0.82, service: 0.5, unemployment: 0.08,
    law: 'permissive', security: 0.6, risk: 0.48, infrastructure: 0.8, costOfLiving: 0.98,
    demand: { energy: 1.7, chemical: 1.45, metal: 1.2, contraband_misc: 1.4 },
    legalityOverrides: { narcotic: 'illegal' },
    services: { offshore: true, loanSharks: true, cryptoExchange: true },
    factionIds: ['gulf_cartel', 'longshoremen_guild'],
    specialties: ['crude_oil__raw', 'diesel__refined', 'lng__refined', 'methanol__industrial_grade'],
    description: 'Refineries, tankers and a customs service that accepts paperwork in envelopes.',
  },
  {
    id: 'cotton_basin', name: 'Cotton Basin', countryId: 'valtreya', regionId: 'midland_plains', kind: 'rural',
    map: { x: 14, y: 38 }, population: 210_000, wealth: 0.32, industrial: 0.28, service: 0.25, unemployment: 0.16,
    law: 'regulated', security: 0.72, risk: 0.22, infrastructure: 0.5, costOfLiving: 0.62,
    demand: { foodstuff: 1.2, equipment: 1.2, vehicle_part: 1.25, pharmaceutical: 1.1 },
    specialties: ['cotton__raw', 'sugarcane__raw', 'cattle__raw', 'poultry__raw'],
    description: 'Flat, hot, poor and productive. Prices here are set by the harvest, not the ticker.',
  },
  {
    id: 'blackridge', name: 'Blackridge', countryId: 'valtreya', regionId: 'eastern_seaboard', kind: 'hidden_market',
    map: { x: 29, y: 37 }, population: 42_000, wealth: 0.38, industrial: 0.4, service: 0.5, unemployment: 0.24,
    law: 'corrupt', security: 0.3, risk: 0.82, infrastructure: 0.36, costOfLiving: 0.7,
    demand: { narcotic: 1.9, weapon: 1.8, contraband_misc: 1.8, pharmaceutical: 1.5, information: 1.4 },
    legalityOverrides: { narcotic: 'restricted', weapon: 'illegal', pharmaceutical: 'restricted' },
    services: { bank: false, loanSharks: true, darknetAccess: true, cryptoExchange: true },
    factionIds: ['fifth_family', 'blackridge_crew'], hidden: true,
    discovery: { minLevel: 3, minUndergroundRep: 12, cost: 2500 },
    description: 'An abandoned mining town that never closed. Nobody here asks where cargo came from.',
  },

  /* --------------------------- Cascadia ----------------------------- */
  {
    id: 'port_cascadia', name: 'Port Cascadia', countryId: 'cascadia_fed', regionId: 'western_maritime', kind: 'port',
    map: { x: 8, y: 26 }, population: 2_400_000, wealth: 0.78, industrial: 0.7, service: 0.82, unemployment: 0.06,
    law: 'regulated', security: 0.82, risk: 0.28, infrastructure: 0.92, costOfLiving: 1.34,
    demand: { electronics: 1.5, technology: 1.55, textile: 1.3, foodstuff: 1.2, luxury: 1.3 },
    services: { cryptoExchange: true, auctionHouse: true, stockExchange: false },
    factionIds: ['pacific_trading_co'],
    specialties: ['consumer_electronics__assembled', 'smartphones__assembled', 'gpus__assembled'],
    description: 'The gateway for everything arriving from the Jade Coast.',
  },
  {
    id: 'vanholm', name: 'Vanholm', countryId: 'cascadia_fed', regionId: 'western_maritime', kind: 'city',
    map: { x: 10, y: 20 }, population: 1_600_000, wealth: 0.82, industrial: 0.48, service: 0.9, unemployment: 0.05,
    law: 'strict', security: 0.86, risk: 0.2, infrastructure: 0.9, costOfLiving: 1.4,
    demand: { technology: 1.6, luxury: 1.45, pharmaceutical: 1.35, information: 1.5, art: 1.3 },
    legalityOverrides: { narcotic: 'restricted' },
    services: { stockExchange: true, cryptoExchange: true, offshore: true },
    factionIds: ['vanholm_bio', 'pacific_trading_co'],
    description: 'Software, biotech and rain. Cannabis is licensed here, which creates an interesting wedge.',
  },
  {
    id: 'silverpine', name: 'Silverpine', countryId: 'cascadia_fed', regionId: 'cordillera', kind: 'rural',
    map: { x: 12, y: 16 }, population: 96_000, wealth: 0.42, industrial: 0.66, service: 0.2, unemployment: 0.11,
    law: 'permissive', security: 0.58, risk: 0.44, infrastructure: 0.46, costOfLiving: 0.74,
    demand: { equipment: 1.4, energy: 1.3, weapon: 1.35, industrial: 1.3 },
    services: { bank: true, loanSharks: true },
    specialties: ['silver__refined', 'copper__concentrate', 'timber__raw', 'gold__raw'],
    description: 'Mines and sawmills at altitude. Winter closes the road for weeks.',
  },
  {
    id: 'frostreach', name: 'Frostreach', countryId: 'cascadia_fed', regionId: 'cordillera', kind: 'special',
    map: { x: 15, y: 8 }, population: 12_000, wealth: 0.5, industrial: 0.3, service: 0.3, unemployment: 0.05,
    law: 'permissive', security: 0.66, risk: 0.4, infrastructure: 0.42, costOfLiving: 1.15,
    demand: { energy: 1.6, equipment: 1.4, foodstuff: 1.3, technology: 1.3 },
    services: { cryptoExchange: true, bank: true },
    specialties: ['lng__refined'],
    description: 'A hydroelectric dam, a datacenter campus and a lot of snow. Cheap power attracts hashing.',
  },

  /* --------------------------- Nueva Solana -------------------------- */
  {
    id: 'santa_mirella', name: 'Santa Mirella', countryId: 'nueva_solana', regionId: 'cordillera', kind: 'city',
    map: { x: 20, y: 60 }, population: 3_100_000, wealth: 0.4, industrial: 0.44, service: 0.5, unemployment: 0.19,
    law: 'corrupt', security: 0.42, risk: 0.72, infrastructure: 0.5, costOfLiving: 0.62,
    demand: { narcotic: 1.7, weapon: 1.75, foodstuff: 1.3, pharmaceutical: 1.45, contraband_misc: 1.5 },
    legalityOverrides: { narcotic: 'restricted', weapon: 'restricted', pharmaceutical: 'restricted' },
    services: { loanSharks: true, darknetAccess: true, cryptoExchange: true, offshore: true },
    factionIds: ['solano_cartel', 'mirella_police'],
    specialties: ['cannabis__raw', 'coca_leaves__raw', 'coffee__raw'],
    description: 'Nine million people, three armies, and a police force that is one of them.',
  },
  {
    id: 'puerto_cenicza', name: 'Puerto Cenizha', countryId: 'nueva_solana', regionId: 'isthmus', kind: 'port',
    map: { x: 22, y: 54 }, population: 720_000, wealth: 0.34, industrial: 0.42, service: 0.44, unemployment: 0.22,
    law: 'corrupt', security: 0.34, risk: 0.8, infrastructure: 0.44, costOfLiving: 0.58,
    demand: { contraband_misc: 1.85, narcotic: 1.8, weapon: 1.7, energy: 1.3 },
    services: { bank: false, loanSharks: true, offshore: true, darknetAccess: true },
    factionIds: ['solano_cartel', 'isthmus_smugglers'],
    specialties: ['crude_oil__raw', 'counterfeit_goods__counterfeit'],
    description: 'The narrowest point between two oceans, and the busiest smuggling corridor on the map.',
  },
  {
    id: 'valle_hoja', name: 'Valle Hoja', countryId: 'nueva_solana', regionId: 'cordillera', kind: 'rural',
    map: { x: 18, y: 64 }, population: 180_000, wealth: 0.2, industrial: 0.2, service: 0.16, unemployment: 0.3,
    law: 'lawless', security: 0.2, risk: 0.9, infrastructure: 0.2, costOfLiving: 0.4,
    demand: { foodstuff: 1.4, weapon: 1.6, pharmaceutical: 1.5, equipment: 1.4 },
    legalityOverrides: { narcotic: 'legal' },
    services: { bank: false, loanSharks: true },
    factionIds: ['solano_cartel'],
    specialties: ['coca_leaves__raw', 'opium__raw', 'coffee__raw'],
    description: 'Terraced slopes above the cloud line. The state does not come here; the buyers do.',
  },
  {
    id: 'la_frontera', name: 'La Frontera', countryId: 'nueva_solana', regionId: 'isthmus', kind: 'border',
    map: { x: 24, y: 50 }, population: 240_000, wealth: 0.3, industrial: 0.34, service: 0.4, unemployment: 0.2,
    law: 'corrupt', security: 0.44, risk: 0.68, infrastructure: 0.48, costOfLiving: 0.56,
    demand: { contraband_misc: 1.6, vehicle_part: 1.4, foodstuff: 1.25, equipment: 1.3 },
    services: { bank: true, loanSharks: true },
    factionIds: ['isthmus_smugglers'],
    description: 'A bridge, a checkpoint and a queue of trucks. Everything crosses here eventually.',
  },

  /* ---------------------------- Isla Verde --------------------------- */
  {
    id: 'palm_city', name: 'Palm City', countryId: 'isla_verde', regionId: 'isle_of_palms', kind: 'offshore',
    map: { x: 32, y: 48 }, population: 310_000, wealth: 0.94, industrial: 0.1, service: 0.98, unemployment: 0.03,
    law: 'offshore', security: 0.8, risk: 0.3, infrastructure: 0.86, costOfLiving: 1.7,
    demand: { luxury: 1.8, financial_asset: 2.0, information: 1.7, art: 1.6, crypto_asset: 1.6 },
    legalityOverrides: { financial_asset: 'legal', crypto_asset: 'legal' },
    services: { bank: true, offshore: true, stockExchange: true, cryptoExchange: true, auctionHouse: true, darknetAccess: true },
    factionIds: ['palm_trust'],
    specialties: ['bearer_bonds__premium', 'treasury_notes__premium'],
    description: 'Zero tax, four hundred banks, and a registry that does not answer questions.',
  },

  /* --------------------------- Aldrich Union ------------------------- */
  {
    id: 'aldrich_capital', name: 'Aldrich Capital', countryId: 'aldrich_union', regionId: 'old_continent', kind: 'financial_center',
    map: { x: 47, y: 20 }, population: 4_200_000, wealth: 0.92, industrial: 0.5, service: 0.94, unemployment: 0.055,
    law: 'strict', security: 0.9, risk: 0.14, infrastructure: 0.94, costOfLiving: 1.58,
    demand: { luxury: 1.7, financial_asset: 1.85, art: 1.65, technology: 1.45, beverage: 1.35, information: 1.5 },
    legalityOverrides: { narcotic: 'illegal', weapon: 'restricted' },
    services: { stockExchange: true, offshore: true, cryptoExchange: true, auctionHouse: true, darknetAccess: true },
    factionIds: ['aldrich_bourse', 'continental_bank'],
    description: 'Old money, old rules, and the deepest art market in the world.',
  },
  {
    id: 'westhaven', name: 'Westhaven', countryId: 'aldrich_union', regionId: 'western_maritime', kind: 'port',
    map: { x: 42, y: 18 }, population: 1_500_000, wealth: 0.7, industrial: 0.84, service: 0.66, unemployment: 0.08,
    law: 'regulated', security: 0.78, risk: 0.3, infrastructure: 0.93, costOfLiving: 1.12,
    demand: { raw_material: 1.35, metal: 1.3, manufactured: 1.35, energy: 1.25, foodstuff: 1.2 },
    services: { cryptoExchange: true, auctionHouse: true },
    factionIds: ['longshoremen_guild', 'continental_bank'],
    specialties: ['steel__refined', 'copper__refined', 'cocoa__raw'],
    description: 'The largest container port on the continent. Bonded warehouses everywhere.',
  },
  {
    id: 'lione', name: 'Lione', countryId: 'aldrich_union', regionId: 'old_continent', kind: 'city',
    map: { x: 48, y: 26 }, population: 1_700_000, wealth: 0.8, industrial: 0.44, service: 0.86, unemployment: 0.07,
    law: 'regulated', security: 0.82, risk: 0.24, infrastructure: 0.88, costOfLiving: 1.32,
    demand: { luxury: 1.65, textile: 1.4, beverage: 1.5, art: 1.5, foodstuff: 1.3 },
    services: { auctionHouse: true, cryptoExchange: true },
    factionIds: ['maison_lione'],
    specialties: ['wine__premium', 'silk__premium', 'designer_handbags__premium'],
    description: 'Fashion, wine and auction houses. Provenance paperwork is a religion here.',
  },

  /* --------------------------- Kessel Confederation ------------------ */
  {
    id: 'kesselstadt', name: 'Kesselstadt', countryId: 'kessel_confed', regionId: 'baltic_shield', kind: 'industrial',
    map: { x: 52, y: 14 }, population: 2_100_000, wealth: 0.84, industrial: 0.96, service: 0.6, unemployment: 0.05,
    law: 'strict', security: 0.88, risk: 0.16, infrastructure: 0.92, costOfLiving: 1.28,
    demand: { metal: 1.5, industrial: 1.6, manufactured: 1.5, technology: 1.5, raw_material: 1.3, chemical: 1.35 },
    services: { stockExchange: true, cryptoExchange: true },
    factionIds: ['kessel_industrial'],
    specialties: ['machine_tools__assembled', 'cnc_machines__assembled', 'bearings__component', 'industrial_robots__assembled'],
    description: 'Precision engineering. If it needs to be accurate to a micron, it is made here.',
  },
  {
    id: 'baltic_freeport', name: 'Baltic Freeport', countryId: 'kessel_confed', regionId: 'baltic_shield', kind: 'port',
    map: { x: 54, y: 9 }, population: 420_000, wealth: 0.76, industrial: 0.6, service: 0.8, unemployment: 0.04,
    law: 'offshore', security: 0.84, risk: 0.22, infrastructure: 0.9, costOfLiving: 1.1,
    demand: { luxury: 1.6, financial_asset: 1.6, art: 1.7, metal: 1.25 },
    services: { offshore: true, auctionHouse: true, bank: true, cryptoExchange: true },
    factionIds: ['baltic_freeport_auth'],
    description: 'A bonded zone where art and gold can change hands without ever technically entering the country.',
  },

  /* ------------------------------- Marenza --------------------------- */
  {
    id: 'porto_marenza', name: 'Porto Marenza', countryId: 'marenza', regionId: 'mediterrane', kind: 'port',
    map: { x: 48, y: 34 }, population: 1_200_000, wealth: 0.56, industrial: 0.58, service: 0.7, unemployment: 0.14,
    law: 'permissive', security: 0.56, risk: 0.56, infrastructure: 0.7, costOfLiving: 0.9,
    demand: { contraband_misc: 1.5, foodstuff: 1.3, textile: 1.3, narcotic: 1.45, luxury: 1.2 },
    services: { loanSharks: true, cryptoExchange: true, darknetAccess: true, auctionHouse: false },
    factionIds: ['marenza_family'],
    specialties: ['olive_oil__raw', 'tuna__raw', 'counterfeit_goods__counterfeit'],
    description: 'Sun, seafood and containers that are never quite full on the manifest.',
  },
  {
    id: 'val_marenza', name: 'Val Marenza', countryId: 'marenza', regionId: 'mediterrane', kind: 'city',
    map: { x: 46, y: 32 }, population: 860_000, wealth: 0.62, industrial: 0.4, service: 0.78, unemployment: 0.12,
    law: 'permissive', security: 0.62, risk: 0.48, infrastructure: 0.72, costOfLiving: 0.98,
    demand: { luxury: 1.4, textile: 1.35, beverage: 1.4, art: 1.3, foodstuff: 1.25 },
    services: { auctionHouse: true },
    factionIds: ['marenza_family', 'artisan_guild'],
    specialties: ['garments__packaged', 'carpets__artisanal', 'wine__vintage'],
    description: 'Workshops and family firms. Quality is high and invoices are negotiable.',
  },

  /* ----------------------------- Tarakhstan -------------------------- */
  {
    id: 'tarak_city', name: 'Tarak City', countryId: 'tarakhstan', regionId: 'highland_marches', kind: 'city',
    map: { x: 62, y: 32 }, population: 1_400_000, wealth: 0.26, industrial: 0.4, service: 0.34, unemployment: 0.31,
    law: 'lawless', security: 0.22, risk: 0.92, infrastructure: 0.3, costOfLiving: 0.42,
    demand: { weapon: 2.2, foodstuff: 1.6, pharmaceutical: 1.7, energy: 1.5, equipment: 1.6, medical: 1.5 },
    legalityOverrides: { weapon: 'legal', narcotic: 'legal', pharmaceutical: 'legal' },
    services: { bank: false, loanSharks: true, darknetAccess: true },
    factionIds: ['tarak_militia', 'highland_warlords'],
    specialties: ['military_surplus__salvaged', 'assault_rifles__military_spec', 'opium__raw'],
    description: 'Shelled every few years, rebuilt every time. Weapons are groceries here.',
  },
  {
    id: 'khabar_pass', name: 'Khabar Pass', countryId: 'tarakhstan', regionId: 'highland_marches', kind: 'border',
    map: { x: 66, y: 36 }, population: 55_000, wealth: 0.2, industrial: 0.2, service: 0.3, unemployment: 0.28,
    law: 'lawless', security: 0.18, risk: 0.94, infrastructure: 0.22, costOfLiving: 0.44,
    demand: { contraband_misc: 2.0, weapon: 1.9, energy: 1.5, foodstuff: 1.4 },
    services: { bank: false, loanSharks: true },
    factionIds: ['highland_warlords', 'isthmus_smugglers'], hidden: false,
    description: 'A mountain track with a checkpoint that changes ownership seasonally.',
  },
  {
    id: 'steppe_crossing', name: 'Steppe Crossing', countryId: 'tarakhstan', regionId: 'steppe_corridor', kind: 'trading_hub',
    map: { x: 70, y: 26 }, population: 320_000, wealth: 0.36, industrial: 0.44, service: 0.5, unemployment: 0.18,
    law: 'corrupt', security: 0.4, risk: 0.66, infrastructure: 0.52, costOfLiving: 0.58,
    demand: { raw_material: 1.5, energy: 1.5, textile: 1.4, contraband_misc: 1.5, metal: 1.3 },
    services: { bank: true, loanSharks: true, offshore: true },
    factionIds: ['steppe_traders'],
    specialties: ['rare_earth_ore__raw', 'uranium_yellowcake__raw', 'wool__raw'],
    description: 'Rail yards where east meets west, and where customs seals are reprinted.',
  },

  /* ------------------------------ Zahr ------------------------------- */
  {
    id: 'zahr_city', name: 'Zahr City', countryId: 'emirate_of_zahr', regionId: 'levant', kind: 'financial_center',
    map: { x: 60, y: 46 }, population: 3_600_000, wealth: 0.95, industrial: 0.6, service: 0.96, unemployment: 0.03,
    law: 'theocratic', security: 0.86, risk: 0.26, infrastructure: 0.96, costOfLiving: 1.66,
    demand: { luxury: 1.9, energy: 1.5, technology: 1.6, financial_asset: 1.7, construction: 1.4, art: 1.4 },
    legalityOverrides: { narcotic: 'contraband', beverage: 'contraband', weapon: 'restricted' },
    services: { stockExchange: true, offshore: true, cryptoExchange: true, auctionHouse: true, bank: true },
    factionIds: ['zahr_sovereign', 'gulf_cartel'],
    specialties: ['crude_oil__raw', 'lng__refined', 'gold__refined'],
    description: 'Glass towers on a petroleum fortune. Alcohol and narcotics are capital offences.',
  },
  {
    id: 'red_sea_terminal', name: 'Red Sea Terminal', countryId: 'emirate_of_zahr', regionId: 'red_sea_coast', kind: 'port',
    map: { x: 58, y: 52 }, population: 480_000, wealth: 0.6, industrial: 0.72, service: 0.6, unemployment: 0.09,
    law: 'regulated', security: 0.7, risk: 0.44, infrastructure: 0.86, costOfLiving: 0.94,
    demand: { energy: 1.6, raw_material: 1.4, foodstuff: 1.35, metal: 1.3 },
    services: { bank: true },
    factionIds: ['zahr_sovereign'],
    specialties: ['crude_oil__raw', 'urea_fertiliser__industrial_grade'],
    description: 'Supertankers queue for miles. A blockade here reprices oil worldwide.',
  },
  {
    id: 'al_miraj_freeport', name: 'Al-Miraj Freeport', countryId: 'emirate_of_zahr', regionId: 'red_sea_coast', kind: 'offshore',
    map: { x: 61, y: 50 }, population: 90_000, wealth: 0.9, industrial: 0.3, service: 0.94, unemployment: 0.02,
    law: 'offshore', security: 0.88, risk: 0.2, infrastructure: 0.94, costOfLiving: 1.5,
    demand: { financial_asset: 1.8, luxury: 1.7, metal: 1.35, technology: 1.4 },
    services: { offshore: true, bank: true, stockExchange: true, cryptoExchange: true, auctionHouse: true },
    factionIds: ['zahr_sovereign', 'palm_trust'],
    description: 'A duty-free vault city. Bullion and bearer instruments move without touching a national ledger.',
  },

  /* ------------------------------ Sudania ---------------------------- */
  {
    id: 'sudania_port', name: 'Sudania Port', countryId: 'sudania', regionId: 'sahel_belt', kind: 'port',
    map: { x: 53, y: 56 }, population: 620_000, wealth: 0.16, industrial: 0.24, service: 0.3, unemployment: 0.38,
    law: 'lawless', security: 0.24, risk: 0.88, infrastructure: 0.28, costOfLiving: 0.38,
    demand: { foodstuff: 1.8, pharmaceutical: 1.7, weapon: 1.8, energy: 1.5, medical: 1.5 },
    legalityOverrides: { weapon: 'legal', pharmaceutical: 'legal' },
    services: { bank: false, loanSharks: true, darknetAccess: true },
    factionIds: ['sahel_militia'],
    specialties: ['gum_arabic__raw', 'mixed_livestock__raw'],
    description: 'Aid ships, arms ships and the same cranes unloading both.',
  },

  /* ---------------------------- Gold Coast --------------------------- */
  {
    id: 'goldport', name: 'Goldport', countryId: 'gold_coast_republic', regionId: 'gold_coast', kind: 'port',
    map: { x: 44, y: 62 }, population: 1_700_000, wealth: 0.38, industrial: 0.46, service: 0.5, unemployment: 0.21,
    law: 'corrupt', security: 0.46, risk: 0.66, infrastructure: 0.52, costOfLiving: 0.6,
    demand: { raw_material: 1.5, metal: 1.5, energy: 1.4, foodstuff: 1.35, contraband_misc: 1.4 },
    services: { bank: true, loanSharks: true, cryptoExchange: true, offshore: false },
    factionIds: ['goldport_syndicate'],
    specialties: ['gold__raw', 'cocoa__raw', 'bauxite__raw', 'timber__raw'],
    description: 'Gold, cocoa and timber leave; machinery and fuel arrive. The scales are rarely honest.',
  },
  {
    id: 'kumasi_hub', name: 'Kumasi Hub', countryId: 'gold_coast_republic', regionId: 'gold_coast', kind: 'trading_hub',
    map: { x: 43, y: 60 }, population: 900_000, wealth: 0.3, industrial: 0.4, service: 0.56, unemployment: 0.24,
    law: 'permissive', security: 0.5, risk: 0.6, infrastructure: 0.48, costOfLiving: 0.54,
    demand: { agriculture: 1.5, textile: 1.4, foodstuff: 1.4, vehicle_part: 1.35, electronics: 1.25 },
    services: { bank: true, loanSharks: true },
    factionIds: ['goldport_syndicate', 'artisan_guild'],
    specialties: ['cocoa__raw', 'cotton__raw', 'cashew__raw'],
    description: 'An inland market city where the whole region comes to trade on Thursdays.',
  },

  /* ------------------------------ Kivu ------------------------------- */
  {
    id: 'kivu_city', name: 'Kivu City', countryId: 'kivu_federation', regionId: 'great_lakes', kind: 'city',
    map: { x: 55, y: 66 }, population: 1_100_000, wealth: 0.18, industrial: 0.3, service: 0.32, unemployment: 0.4,
    law: 'lawless', security: 0.2, risk: 0.94, infrastructure: 0.24, costOfLiving: 0.42,
    demand: { weapon: 2.1, foodstuff: 1.7, pharmaceutical: 1.6, medical: 1.5, equipment: 1.5 },
    legalityOverrides: { weapon: 'legal', raw_material: 'legal' },
    services: { bank: false, loanSharks: true, darknetAccess: true },
    factionIds: ['kivu_militia', 'great_lakes_traders'],
    specialties: ['coltan__raw', 'cobalt_ore__raw', 'gold__raw', 'tin__concentrate'],
    description: 'The minerals under this city power the world\'s phones. The city itself has no power.',
  },
  {
    id: 'mine_ridge', name: 'Mine Ridge', countryId: 'kivu_federation', regionId: 'great_lakes', kind: 'rural',
    map: { x: 57, y: 68 }, population: 120_000, wealth: 0.12, industrial: 0.42, service: 0.1, unemployment: 0.5,
    law: 'lawless', security: 0.14, risk: 0.97, infrastructure: 0.14, costOfLiving: 0.36,
    demand: { foodstuff: 1.8, equipment: 1.6, pharmaceutical: 1.6, weapon: 1.8 },
    services: { bank: false, loanSharks: true },
    factionIds: ['kivu_militia'],
    specialties: ['coltan__raw', 'cobalt_ore__raw', 'rare_earth_ore__raw'],
    description: 'Hand-dug pits on a ridgeline. Ore leaves on motorcycles and never appears on a manifest.',
  },

  /* ---------------------------- Cape Reach --------------------------- */
  {
    id: 'cape_meridian', name: 'Cape Meridian', countryId: 'cape_reach_republic', regionId: 'cape_reach', kind: 'port',
    map: { x: 52, y: 84 }, population: 2_200_000, wealth: 0.58, industrial: 0.6, service: 0.72, unemployment: 0.15,
    law: 'permissive', security: 0.6, risk: 0.56, infrastructure: 0.72, costOfLiving: 0.86,
    demand: { metal: 1.5, raw_material: 1.45, luxury: 1.3, financial_asset: 1.35, contraband_misc: 1.4 },
    services: { stockExchange: true, bank: true, offshore: true, cryptoExchange: true, auctionHouse: true },
    factionIds: ['meridian_bank', 'cape_consortium'],
    specialties: ['platinum__refined', 'palladium__refined', 'gold__refined', 'manganese__raw'],
    description: 'Two oceans meet here, and so do the world\'s most valuable metals.',
  },

  /* ----------------------------- Bharat ------------------------------ */
  {
    id: 'bharat_metro', name: 'Bharat Metro', countryId: 'bharat_union', regionId: 'monsoon_delta', kind: 'city',
    map: { x: 72, y: 48 }, population: 14_000_000, wealth: 0.44, industrial: 0.7, service: 0.78, unemployment: 0.12,
    law: 'regulated', security: 0.66, risk: 0.44, infrastructure: 0.66, costOfLiving: 0.62,
    demand: { technology: 1.5, pharmaceutical: 1.55, electronics: 1.45, textile: 1.4, luxury: 1.4, metal: 1.3 },
    legalityOverrides: { pharmaceutical: 'restricted', narcotic: 'illegal' },
    services: { stockExchange: true, cryptoExchange: true, bank: true, auctionHouse: true },
    factionIds: ['bharat_industrial', 'monsoon_syndicate'],
    specialties: ['statins__pharma_grade', 'garments__packaged', 'gpus__assembled', 'saffron__raw'],
    description: 'Fourteen million people, a world-class generics industry and traffic that defeats logistics.',
  },
  {
    id: 'delta_port', name: 'Delta Port', countryId: 'bharat_union', regionId: 'monsoon_delta', kind: 'port',
    map: { x: 75, y: 52 }, population: 3_400_000, wealth: 0.36, industrial: 0.62, service: 0.5, unemployment: 0.17,
    law: 'corrupt', security: 0.5, risk: 0.62, infrastructure: 0.6, costOfLiving: 0.54,
    demand: { raw_material: 1.45, energy: 1.5, foodstuff: 1.4, contraband_misc: 1.45, metal: 1.3 },
    services: { bank: true, loanSharks: true, cryptoExchange: true },
    factionIds: ['monsoon_syndicate'],
    specialties: ['rice__raw', 'iron_ore__raw', 'shrimp__frozen', 'cotton_yarn__raw'],
    description: 'Monsoon-season throughput halves. Smuggling fills the gap.',
  },

  /* --------------------------- Steppe Khanate ------------------------ */
  {
    id: 'khan_capital', name: 'Khan Capital', countryId: 'steppe_khanate', regionId: 'steppe_corridor', kind: 'city',
    map: { x: 78, y: 22 }, population: 1_000_000, wealth: 0.5, industrial: 0.6, service: 0.5, unemployment: 0.1,
    law: 'corrupt', security: 0.58, risk: 0.5, infrastructure: 0.6, costOfLiving: 0.7,
    demand: { energy: 1.6, raw_material: 1.55, metal: 1.45, weapon: 1.4, construction: 1.35 },
    legalityOverrides: { crypto_asset: 'legal' },
    services: { bank: true, cryptoExchange: true, loanSharks: true, offshore: true },
    factionIds: ['steppe_traders', 'khan_ministry'],
    specialties: ['thermal_coal__raw', 'copper__concentrate', 'uranium_yellowcake__raw', 'cashmere__raw'],
    description: 'Coal, copper and cashmere, sold by a state that runs like a family firm.',
  },
  {
    id: 'polar_station', name: 'Polar Basin Station', countryId: 'steppe_khanate', regionId: 'polar_basin', kind: 'special',
    map: { x: 80, y: 5 }, population: 4_500, wealth: 0.62, industrial: 0.5, service: 0.3, unemployment: 0.02,
    law: 'permissive', security: 0.7, risk: 0.5, infrastructure: 0.55, costOfLiving: 1.6,
    demand: { energy: 1.9, equipment: 1.6, foodstuff: 1.5, technology: 1.4 },
    services: { bank: false, cryptoExchange: true },
    specialties: ['lng__refined', 'rare_earth_ore__concentrate'],
    description: 'A research and extraction outpost where winter is the main antagonist.',
  },

  /* ---------------------------- Jade Coast --------------------------- */
  {
    id: 'jade_harbor', name: 'Jade Harbor', countryId: 'jade_coast_state', regionId: 'jade_coast', kind: 'port',
    map: { x: 86, y: 40 }, population: 9_500_000, wealth: 0.72, industrial: 0.95, service: 0.8, unemployment: 0.04,
    law: 'strict', security: 0.86, risk: 0.28, infrastructure: 0.98, costOfLiving: 1.06,
    demand: { raw_material: 1.7, energy: 1.7, metal: 1.65, electronics: 1.5, foodstuff: 1.4, luxury: 1.35 },
    legalityOverrides: { narcotic: 'contraband', crypto_asset: 'restricted' },
    services: { stockExchange: true, bank: true, auctionHouse: true },
    factionIds: ['jade_state_trading', 'jade_harbor_auth'],
    specialties: ['solar_panels__assembled', 'ev_batteries__assembled', 'circuit_boards__component', 'steel__refined'],
    description: 'The factory of the world. It buys raw materials and sells everything else.',
  },
  {
    id: 'jinwan_city', name: 'Jinwan City', countryId: 'jade_coast_state', regionId: 'jade_coast', kind: 'industrial',
    map: { x: 88, y: 43 }, population: 6_800_000, wealth: 0.66, industrial: 0.98, service: 0.6, unemployment: 0.05,
    law: 'strict', security: 0.84, risk: 0.3, infrastructure: 0.94, costOfLiving: 0.94,
    demand: { metal: 1.6, raw_material: 1.65, industrial: 1.6, electronics: 1.55, energy: 1.6 },
    services: { bank: true },
    factionIds: ['jade_state_trading'],
    specialties: ['aluminium__alloy', 'memory_modules__component', 'displays__component', 'fasteners__component'],
    description: 'Special economic zone. Component prices here set global component prices.',
  },

  /* --------------------------- Archipelago --------------------------- */
  {
    id: 'archipelago_hub', name: 'Archipelago Hub', countryId: 'archipelago_union', regionId: 'archipelago_seas', kind: 'trading_hub',
    map: { x: 84, y: 62 }, population: 5_600_000, wealth: 0.68, industrial: 0.6, service: 0.82, unemployment: 0.06,
    law: 'permissive', security: 0.66, risk: 0.5, infrastructure: 0.8, costOfLiving: 0.96,
    demand: { electronics: 1.5, energy: 1.45, foodstuff: 1.4, contraband_misc: 1.5, raw_material: 1.3 },
    services: { bank: true, cryptoExchange: true, offshore: true, loanSharks: true, darknetAccess: true },
    factionIds: ['archipelago_traders', 'monsoon_syndicate'],
    specialties: ['palm_oil__raw', 'natural_rubber__raw', 'tin__concentrate', 'nickel__concentrate'],
    description: 'Ten thousand islands, one transshipment hub, and endless ways to lose a container.',
  },
  {
    id: 'coral_bay', name: 'Coral Bay', countryId: 'archipelago_union', regionId: 'archipelago_seas', kind: 'hidden_market',
    map: { x: 87, y: 66 }, population: 28_000, wealth: 0.28, industrial: 0.2, service: 0.4, unemployment: 0.3,
    law: 'lawless', security: 0.2, risk: 0.9, infrastructure: 0.24, costOfLiving: 0.5,
    demand: { contraband_misc: 2.0, narcotic: 1.8, weapon: 1.9, electronics: 1.4 },
    services: { bank: false, loanSharks: true, darknetAccess: true, cryptoExchange: true },
    factionIds: ['coral_pirates'], hidden: true,
    discovery: { minLevel: 6, minUndergroundRep: 25, cost: 8000, intelRequired: 2 },
    description: 'An anchorage that does not appear on charts. Pirates refuel here and sell what they take.',
  },

  /* --------------------------- Sunrise Isles ------------------------- */
  {
    id: 'sunrise_capital', name: 'Sunrise Capital', countryId: 'sunrise_empire', regionId: 'sunrise_isles', kind: 'financial_center',
    map: { x: 93, y: 32 }, population: 12_000_000, wealth: 0.9, industrial: 0.86, service: 0.92, unemployment: 0.03,
    law: 'strict', security: 0.94, risk: 0.1, infrastructure: 0.98, costOfLiving: 1.48,
    demand: { technology: 1.7, luxury: 1.6, electronics: 1.55, financial_asset: 1.6, foodstuff: 1.3, art: 1.4 },
    legalityOverrides: { narcotic: 'contraband', weapon: 'restricted' },
    services: { stockExchange: true, bank: true, cryptoExchange: true, auctionHouse: true, offshore: false },
    factionIds: ['sunrise_keiretsu'],
    specialties: ['lithography_parts__industrial_grade', 'quantum_components__industrial_grade', 'sensors__component'],
    description: 'The most automated city on earth, and the most policed. Do not carry anything interesting.',
  },

  /* ----------------------------- Australis --------------------------- */
  {
    id: 'australis_port', name: 'Australis Port', countryId: 'australis', regionId: 'southern_cross', kind: 'port',
    map: { x: 90, y: 82 }, population: 1_300_000, wealth: 0.8, industrial: 0.72, service: 0.6, unemployment: 0.05,
    law: 'strict', security: 0.86, risk: 0.2, infrastructure: 0.9, costOfLiving: 1.24,
    demand: { raw_material: 1.5, metal: 1.45, energy: 1.4, agriculture: 1.35, livestock: 1.4 },
    services: { stockExchange: true, bank: true, cryptoExchange: true },
    factionIds: ['australis_resources'],
    specialties: ['iron_ore__raw', 'lithium_brine__raw', 'gold__refined', 'thermal_coal__raw', 'wool__raw'],
    description: 'Bulk carriers the size of districts. The mine gate price moves the world index.',
  },

  /* ---------------------------- Free Ports --------------------------- */
  {
    id: 'free_port_zero', name: 'Free Port Zero', countryId: 'free_port_authority', regionId: 'free_ports', kind: 'offshore',
    map: { x: 38, y: 54 }, population: 65_000, wealth: 0.88, industrial: 0.2, service: 0.96, unemployment: 0.02,
    law: 'offshore', security: 0.82, risk: 0.24, infrastructure: 0.92, costOfLiving: 1.55,
    demand: { financial_asset: 1.95, luxury: 1.75, crypto_asset: 1.8, information: 1.7, metal: 1.3 },
    legalityOverrides: { financial_asset: 'legal', crypto_asset: 'legal', information: 'restricted' },
    services: { bank: true, offshore: true, stockExchange: true, cryptoExchange: true, auctionHouse: true, darknetAccess: true },
    factionIds: ['palm_trust', 'free_port_authority_faction'],
    description: 'A state constituted as a customs warehouse. Nothing here is taxed, and little is recorded.',
  },
  {
    id: 'the_sprawl', name: 'The Sprawl', countryId: 'free_port_authority', regionId: 'free_ports', kind: 'underground',
    map: { x: 40, y: 57 }, population: 180_000, wealth: 0.42, industrial: 0.3, service: 0.6, unemployment: 0.28,
    law: 'lawless', security: 0.26, risk: 0.9, infrastructure: 0.4, costOfLiving: 0.66,
    demand: { information: 2.1, crypto_asset: 1.9, electronics: 1.6, narcotic: 1.6, contraband_misc: 1.7, technology: 1.5 },
    legalityOverrides: { information: 'legal', crypto_asset: 'legal', technology: 'restricted' },
    services: { bank: false, darknetAccess: true, cryptoExchange: true, loanSharks: true },
    factionIds: ['sprawl_collective'], hidden: true,
    discovery: { minLevel: 4, minUndergroundRep: 18, cost: 4000, intelRequired: 1 },
    description: 'A server farm city under a decommissioned airport. Data is the local currency.',
  },
  {
    id: 'atlas_haven', name: 'Atlas Data Haven', countryId: 'free_port_authority', regionId: 'free_ports', kind: 'special',
    map: { x: 41, y: 51 }, population: 8_000, wealth: 0.86, industrial: 0.5, service: 0.9, unemployment: 0.01,
    law: 'offshore', security: 0.9, risk: 0.3, infrastructure: 0.96, costOfLiving: 1.8,
    demand: { technology: 2.0, information: 1.9, crypto_asset: 1.85, electronics: 1.6 },
    legalityOverrides: { information: 'legal', crypto_asset: 'legal' },
    services: { bank: true, offshore: true, cryptoExchange: true, darknetAccess: true, stockExchange: false },
    factionIds: ['sprawl_collective', 'palm_trust'], hidden: true,
    discovery: { minLevel: 9, minUndergroundRep: 40, cost: 25000, requiresContact: 'sprawl_collective' },
    description: 'Jurisdictionally ambiguous hosting in a decommissioned sea fort. Nothing stored here can be subpoenaed.',
  },
];

/* ------------------------------------------------------------------ */
/* Derived data                                                        */
/* ------------------------------------------------------------------ */

/** How many commodity markets a location of a given profile materialises. */
function tradedCount(l: LocationDef): number {
  const kindBonus: Partial<Record<LocationKind, number>> = {
    financial_center: 34,
    trading_hub: 26,
    port: 24,
    city: 20,
    offshore: 18,
    industrial: 14,
    hidden_market: 12,
    underground: 16,
    special: 10,
    border: 8,
    rural: 6,
    airport: 12,
  };
  const wealth = Math.round(l.economy.wealthIndex * 22);
  const pop = Math.round(Math.log10(Math.max(1000, l.population)) * 4);
  return Math.min(96, Math.max(22, 26 + (kindBonus[l.kind] ?? 0) + wealth + pop));
}

function legalityToleranceFactor(l: LocationDef, c: CommodityDef): number {
  const effective = l.laws.legalityOverrides[c.category] ?? c.legality;
  if (!l.laws.tolerated.includes(effective)) {
    // Untolerated goods may still trade, but only through hidden channels and
    // in much smaller quantity — never zero, so the player is never hard-locked.
    return 0.06;
  }
  switch (effective) {
    case 'legal':
      return 1;
    case 'restricted':
      return 0.62 + (1 - l.laws.enforcement) * 0.5;
    case 'illegal':
      return 0.22 + (1 - l.laws.enforcement) * 0.7 + l.laws.corruption * 0.3;
    case 'contraband':
      return 0.08 + (1 - l.laws.enforcement) * 0.5 + l.laws.corruption * 0.35;
    default:
      return 0.5;
  }
}

/**
 * **Existence** score: does this location's economy have any reason to trade this
 * good at all?
 *
 * This is deliberately *not* a depth score. `availability` and `baseDemand` say how
 * much of a good moves, and they are already used by the economic engine to set
 * supply, demand and therefore price. Letting the same numbers decide *whether* a
 * market carries a good collapsed the catalogue: bulk legal staples out-scored
 * every scarce, processed, restricted or high-value SKU in all 48 cities, so 491 of
 * 765 commodities appeared in no market anywhere — including 21 of the 44
 * production recipes' own inputs and outputs.
 *
 * Depth parameters therefore enter here with their exponent flattened to a
 * near-constant, which preserves a mild preference for goods that move in volume
 * while letting legality, regional preference, category demand and location kind
 * decide the answer — the things that actually make regional economies different.
 */
function existenceScore(l: LocationDef, c: CommodityDef): number {
  const region = REGION_BY_ID[l.regionId];
  const pref = c.regionalPreference[l.regionId] ?? 1;
  const categoryDemand = l.demandProfile[c.category] ?? 1;
  const tolerance = legalityToleranceFactor(l, c);
  const archetype = region ? region.archetype : 'industrial';
  // Financial centres do not stock gravel; rural towns do not stock zero-days.
  const kindFit =
    l.kind === 'rural' && (c.category === 'information' || c.category === 'financial_asset')
      ? 0.05
      : l.kind === 'financial_center' && c.baseValue < 20
        ? 0.25
        : archetype === 'remote' && c.volumeL > 2000
          ? 0.2
          : 1;
  // Flat (0.45 … 1.0 for availability; 0.66 … 1.0 for demand), so volume still
  // nudges the ranking without vetoing scarce goods.
  const depthPreference = Math.pow(Math.max(0.02, c.availability), 0.15) * Math.pow(0.6 + Math.min(4, c.baseDemand) / 400, 0.3);
  return pref * categoryDemand * tolerance * kindFit * depthPreference;
}

/**
 * Per-(market, commodity) taste.
 *
 * Variants of one base good (wheat: bulk / premium / organic) score almost
 * identically, so a deterministic ranking alone would let one grade sweep every
 * city and orphan its siblings. A seeded hash gives every pair its own small
 * preference, which is what spreads grades and forms across the world. The band is
 * ±22%: far too small to move a good across categories (a rural town still prefers
 * staples to zero-days by a factor of twenty) and just wide enough to break ties
 * between siblings deterministically.
 */
function marketTaste(locationId: ID, commodityId: ID): number {
  const h = parseInt(fnv1aHex(`${locationId}|${commodityId}`), 16);
  return 0.78 + ((h % 10_000) / 10_000) * 0.44;
}

/**
 * How many markets a good should reach, by how generally it is traded. Scarce and
 * dangerous goods stay scarce; staples are everywhere. This is what keeps
 * "every good is reachable" from meaning "every good is everywhere".
 */
function targetMarketsFor(c: CommodityDef): number {
  if (c.rarity >= 5) return 2;
  if (c.rarity >= 4) return 3;
  if (c.legality === 'contraband') return 3;
  if (c.rarity >= 3) return 4;
  return 6;
}

export interface MarketCoverage {
  commodities: number;
  reachable: number;
  unreachable: { id: string; category: string; legality: string; rarity: number }[];
  reachableLocations: number;
  marketsTotal: number;
  perMarket: { id: string; lines: number }[];
}

const STAPLE_COMMODITIES = ['flour__bulk', 'canned_goods__packaged', 'bottled_water__packaged', 'diesel__refined', 'gasoline__refined'];

/**
 * Compose every location's open market roster.
 *
 * A greedy "each city takes its own top N" cannot cover a catalogue several times
 * larger than a market: the same elite goods win everywhere and the long tail is
 * never stocked. This runs a quota-respecting deferred-acceptance assignment
 * instead — commodities propose to the markets that want them most, each market
 * keeps the best proposals up to its quota, and rejected commodities fall through to
 * their next-best market until every good has a home or has run out of cities that
 * find it acceptable.
 *
 * Consequences that matter for gameplay:
 *  • every tradeable good is reachable somewhere (no orphaned catalogue entries);
 *  • a good still only appears in the handful of markets that suit it, so regional
 *    specialisation and arbitrage survive;
 *  • market size stays bounded by `tradedCount`, so a city square is still readable.
 *
 * Complexity is O(catalogue × quota) proposals, not O(catalogue × locations), which
 * keeps 1,000 locations × 5,000 SKUs tractable.
 */
function composeMarkets(locations: LocationDef[], registry: ReturnType<typeof getCommodityRegistry>): Map<ID, string[]> {
  const all = registry.all();
  const byId = new Map(all.map((c) => [c.id, c]));

  // Preference lists: for each commodity, locations ranked by its own taste for them.
  interface Proposal { commodityId: ID; locationId: ID; score: number }
  const queues = new Map<ID, Proposal[]>();
  for (const c of all) {
    const ranked: Proposal[] = [];
    for (const l of locations) {
      const score = existenceScore(l, c) * marketTaste(l.id, c.id);
      if (score > 0.02) ranked.push({ commodityId: c.id, locationId: l.id, score });
    }
    ranked.sort((a, b) => b.score - a.score || (a.locationId < b.locationId ? -1 : 1));
    queues.set(c.id, ranked);
  }

  // Each market holds its best proposals, up to its quota; the weakest is evicted
  // when a better one arrives. Deterministic: ties break on commodity id.
  const held = new Map<ID, Proposal[]>();
  // A good that is scarce in a market's taste still deserves a home, so the quota is
  // split: most of a market's lines are the goods it likes best, the remainder is
  // reserved for goods the world has few markets for.
  const quota = new Map<ID, number>();
  for (const l of locations) {
    held.set(l.id, []);
    quota.set(l.id, tradedCount(l));
  }

  const worse = (a: Proposal, b: Proposal): boolean => a.score < b.score || (a.score === b.score && a.commodityId > b.commodityId);
  const covered = new Map<ID, number>();
  for (const c of all) covered.set(c.id, 0);

  // Order commodities from rarest to most common so scarce goods claim their few
  // suitable markets before abundant ones fill them.
  const order = [...all].sort((a, b) => targetMarketsFor(a) - targetMarketsFor(b) || (a.id < b.id ? -1 : 1));

  for (const c of order) {
    const target = targetMarketsFor(c);
    const queue = queues.get(c.id) ?? [];
    for (const proposal of queue) {
      if ((covered.get(c.id) ?? 0) >= target) break;
      const list = held.get(proposal.locationId)!;
      const cap = quota.get(proposal.locationId)!;
      if (list.length < cap) {
        list.push(proposal);
        covered.set(c.id, (covered.get(c.id) ?? 0) + 1);
      } else {
        // Replace the weakest held line only if this good suits the market better.
        let weakestIndex = 0;
        for (let i = 1; i < list.length; i += 1) if (worse(list[i]!, list[weakestIndex]!)) weakestIndex = i;
        const weakest = list[weakestIndex]!;
        if (worse(weakest, proposal)) {
          // Never evict a good on its last market: coverage outranks local taste.
          if ((covered.get(weakest.commodityId) ?? 0) <= 1) continue;
          list[weakestIndex] = proposal;
          covered.set(weakest.commodityId, (covered.get(weakest.commodityId) ?? 0) - 1);
          covered.set(c.id, (covered.get(c.id) ?? 0) + 1);
        }
      }
    }
  }

  const result = new Map<ID, string[]>();
  for (const l of locations) {
    const lines = new Set<string>((held.get(l.id) ?? []).map((p) => p.commodityId));
    // Specialities are always tradeable at home, whatever the taste model says.
    for (const spec of l.specialties) if (byId.has(spec)) lines.add(spec);
    // Staples must exist everywhere or the player can starve in a small town.
    for (const s of STAPLE_COMMODITIES) if (byId.has(s)) lines.add(s);
    /*
     * Top-up pass. A thin market is a bad market: a town whose quota says 22 lines
     * should show 22 lines, not the handful the draft happened to leave it. The
     * shortfall is filled from that location's own best remaining candidates, so the
     * character of the market is preserved — this only restores depth the global
     * assignment spent elsewhere.
     */
    const cap = quota.get(l.id) ?? tradedCount(l);
    if (lines.size < cap) {
      const ranked = all
        .filter((c) => !lines.has(c.id))
        .map((c) => ({ id: c.id, score: existenceScore(l, c) * marketTaste(l.id, c.id) }))
        .filter((x) => x.score > 0.02)
        .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
      for (const candidate of ranked) {
        if (lines.size >= cap) break;
        lines.add(candidate.id);
      }
    }
    result.set(l.id, [...lines].sort());
  }
  return result;
}

/**
 * Builds the route graph from map geography: nearest-neighbour links plus a
 * connectivity repair pass, so the world is always fully traversable without
 * anyone hand-authoring hundreds of edges.
 */
function deriveRoutes(locations: LocationDef[]): RouteDef[] {
  const routes: RouteDef[] = [];
  const seen = new Set<string>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  const distKm = (a: LocationDef, b: LocationDef): number => {
    // 1 map unit ≈ 78 km, giving a world roughly 7,800 km across.
    const dx = (a.map.x - b.map.x) * 78;
    const dy = (a.map.y - b.map.y) * 78;
    return Math.max(24, Math.round(Math.hypot(dx, dy)));
  };

  const modesFor = (a: LocationDef, b: LocationDef, km: number): TravelMode[] => {
    const modes: TravelMode[] = [];
    const waterA = a.kind === 'port' || a.kind === 'offshore' || a.kind === 'underground';
    const waterB = b.kind === 'port' || b.kind === 'offshore' || b.kind === 'underground';
    const airA = a.kind === 'airport' || a.kind === 'financial_center' || a.kind === 'city' || a.population > 900_000;
    const airB = b.kind === 'airport' || b.kind === 'financial_center' || b.kind === 'city' || b.population > 900_000;
    modes.push('foot');
    if (km < 900) modes.push('bus', 'car', 'truck');
    if (km < 1600) modes.push('train');
    if (waterA && waterB) modes.push('cargo_ship', 'ferry');
    else if (waterA || waterB) modes.push('ferry');
    if (airA && airB && km > 300) modes.push('air');
    if (km > 2500 && airA && airB) modes.push('private_jet');
    if (a.infrastructure < 0.35 || b.infrastructure < 0.35) {
      return modes.filter((m) => m !== 'train' && m !== 'air' && m !== 'private_jet');
    }
    return modes;
  };

  const addRoute = (a: LocationDef, b: LocationDef, kmOverride?: number) => {
    const k = key(a.id, b.id);
    if (seen.has(k) || a.id === b.id) return;
    seen.add(k);
    const km = kmOverride ?? distKm(a, b);
    const border = a.countryId !== b.countryId;
    const rng = new Rng(`route:${k}`, 'world-gen');
    const riskBase =
      (a.risk + b.risk) / 2 +
      (border ? 0.06 : 0) +
      (Math.min(a.infrastructure, b.infrastructure) < 0.4 ? 0.08 : 0) +
      rng.float(0, 0.05);
    const customs =
      (border ? 0.45 : 0.12) *
      ((a.laws.enforcement + b.laws.enforcement) / 2) *
      (1 - (a.laws.corruption + b.laws.corruption) / 2.6);
    routes.push({
      id: k,
      from: a.id,
      to: b.id,
      distanceKm: km,
      modes: modesFor(a, b, km),
      borderCrossing: border,
      baseRisk: Math.round(Math.min(0.98, Math.max(0.01, riskBase)) * 1000) / 1000,
      customsIntensity: Math.round(Math.min(1, Math.max(0.02, customs)) * 1000) / 1000,
    });
  };

  const byId = new Map(locations.map((l) => [l.id, l]));

  // k-nearest neighbours, k scaled by how connected the location should be.
  for (const a of locations) {
    const k =
      a.kind === 'financial_center' || a.kind === 'trading_hub' || a.kind === 'port'
        ? 5
        : a.kind === 'city' || a.kind === 'offshore'
          ? 4
          : a.hidden
            ? 2
            : 3;
    const neighbours = locations
      .filter((b) => b.id !== a.id)
      .map((b) => ({ b, d: distKm(a, b) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, k);
    for (const n of neighbours) addRoute(a, n.b);
  }

  // Explicit strategic corridors that geography alone would miss.
  const corridors: [string, string][] = [
    ['new_avalon', 'aldrich_capital'],
    ['new_avalon', 'sunrise_capital'],
    ['aldrich_capital', 'zahr_city'],
    ['zahr_city', 'bharat_metro'],
    ['bharat_metro', 'jade_harbor'],
    ['jade_harbor', 'port_cascadia'],
    ['port_cascadia', 'new_avalon'],
    ['cape_meridian', 'goldport'],
    ['goldport', 'porto_marenza'],
    ['puerto_cenicza', 'archipelago_hub'],
    ['archipelago_hub', 'australis_port'],
    ['palm_city', 'free_port_zero'],
    ['free_port_zero', 'baltic_freeport'],
    ['al_miraj_freeport', 'free_port_zero'],
    ['kivu_city', 'cape_meridian'],
    ['tarak_city', 'khan_capital'],
    ['sudania_port', 'red_sea_terminal'],
    ['delta_port', 'archipelago_hub'],
  ];
  for (const [a, b] of corridors) {
    const la = byId.get(a);
    const lb = byId.get(b);
    if (la && lb) addRoute(la, lb);
  }

  // Hidden locations attach to their nearest non-hidden neighbour.
  for (const a of locations.filter((l) => l.hidden)) {
    const nearest = locations
      .filter((b) => b.id !== a.id && !b.hidden)
      .map((b) => ({ b, d: distKm(a, b) }))
      .sort((x, y) => x.d - y.d)[0];
    if (nearest) addRoute(a, nearest.b);
  }

  // Connectivity repair: union-find, then stitch components together.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const l of locations) parent.set(l.id, l.id);
  for (const r of routes) union(r.from, r.to);

  const components = new Map<string, LocationDef[]>();
  for (const l of locations) {
    const root = find(l.id);
    const arr = components.get(root);
    if (arr) arr.push(l);
    else components.set(root, [l]);
  }
  const groups = Array.from(components.values()).sort((a, b) => b.length - a.length);
  while (groups.length > 1) {
    const main = groups[0]!;
    const other = groups[1]!;
    let best: { a: LocationDef; b: LocationDef; d: number } | null = null;
    for (const a of other) {
      for (const b of main) {
        const d = distKm(a, b);
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    if (!best) break;
    addRoute(best.a, best.b, best.d);
    main.push(...other);
    groups.splice(1, 1);
  }

  return routes;
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export interface PathLeg {
  route: RouteDef;
  from: LocationDef;
  to: LocationDef;
  distanceKm: number;
}

export interface PathResult {
  legs: PathLeg[];
  distanceKm: number;
  borderCrossings: number;
  risk: number;
}

export class WorldRegistry {
  readonly locations: LocationDef[];
  readonly routes: RouteDef[];
  private readonly locById: Map<ID, LocationDef>;
  private readonly routeById: Map<ID, RouteDef>;
  private readonly adjacency: Map<ID, RouteDef[]>;
  private readonly routeKey = new Map<string, RouteDef>();

  constructor(locations?: LocationDef[], routes?: RouteDef[]) {
    const registry = getCommodityRegistry();
    const base = locations ?? LOCATION_SEEDS.map(loc);
    // Rosters are composed for the whole world at once: coverage is a global
    // property, so it cannot be decided one city at a time.
    const composed = composeMarkets(base, registry);
    this.locations = base.map((l) => ({
      ...l,
      tradedCommodityIds: l.tradedCommodityIds.length > 0 ? l.tradedCommodityIds : (composed.get(l.id) ?? []),
    }));
    this.locById = new Map(this.locations.map((l) => [l.id, l]));
    this.routes = routes ?? deriveRoutes(this.locations);
    this.routeById = new Map(this.routes.map((r) => [r.id, r]));
    this.adjacency = new Map();
    for (const r of this.routes) {
      const a = this.adjacency.get(r.from);
      if (a) a.push(r);
      else this.adjacency.set(r.from, [r]);
      const b = this.adjacency.get(r.to);
      if (b) b.push(r);
      else this.adjacency.set(r.to, [r]);
      this.routeKey.set(r.from < r.to ? `${r.from}>${r.to}` : `${r.to}>${r.from}`, r);
    }
  }

  get locationCount(): number {
    return this.locations.length;
  }

  get routeCount(): number {
    return this.routes.length;
  }

  location(id: ID): LocationDef | undefined {
    return this.locById.get(id);
  }

  requireLocation(id: ID): LocationDef {
    const l = this.locById.get(id);
    if (!l) throw new Error(`Unknown location id: ${id}`);
    return l;
  }

  route(id: ID): RouteDef | undefined {
    return this.routeById.get(id);
  }

  routeBetween(a: ID, b: ID): RouteDef | undefined {
    return this.routeKey.get(a < b ? `${a}>${b}` : `${b}>${a}`);
  }

  neighboursOf(id: ID): { route: RouteDef; other: LocationDef }[] {
    const here = this.locById.get(id);
    if (!here) return [];
    return (this.adjacency.get(id) ?? [])
      .map((route) => ({ route, other: this.locById.get(route.from === id ? route.to : route.from)! }))
      .filter((x) => x.other !== undefined);
  }

  /**
   * Shortest path by distance using Dijkstra. Returns null if unreachable
   * (should not happen — the constructor repairs connectivity).
   */
  findPath(fromId: ID, toId: ID, opts: { avoidDisrupted?: Set<ID>; mode?: TravelMode } = {}): PathResult | null {
    if (fromId === toId) return { legs: [], distanceKm: 0, borderCrossings: 0, risk: 0 };
    const dist = new Map<ID, number>([[fromId, 0]]);
    const prev = new Map<ID, { via: RouteDef; from: ID }>();
    const visited = new Set<ID>();

    while (true) {
      let current: ID | null = null;
      let best = Number.POSITIVE_INFINITY;
      for (const [id, d] of dist) {
        if (!visited.has(id) && d < best) {
          best = d;
          current = id;
        }
      }
      if (current === null) break;
      if (current === toId) break;
      visited.add(current);

      for (const { route, other } of this.neighboursOf(current)) {
        if (opts.avoidDisrupted?.has(route.id)) continue;
        if (opts.mode && !route.modes.includes(opts.mode)) continue;
        const nd = best + route.distanceKm * (1 + route.baseRisk * 0.4);
        if (nd < (dist.get(other.id) ?? Number.POSITIVE_INFINITY)) {
          dist.set(other.id, nd);
          prev.set(other.id, { via: route, from: current });
        }
      }
    }

    if (!prev.has(toId) && fromId !== toId) return null;

    const legs: PathLeg[] = [];
    let cursor = toId;
    while (cursor !== fromId) {
      const step = prev.get(cursor);
      if (!step) return null;
      const from = this.locById.get(step.from)!;
      const to = this.locById.get(cursor)!;
      legs.unshift({ route: step.via, from, to, distanceKm: step.via.distanceKm });
      cursor = step.from;
    }

    let distanceKm = 0;
    let borderCrossings = 0;
    let risk = 0;
    for (const leg of legs) {
      distanceKm += leg.distanceKm;
      if (leg.route.borderCrossing) borderCrossings++;
      risk = 1 - (1 - risk) * (1 - leg.route.baseRisk * 0.5);
    }
    return { legs, distanceKm, borderCrossings, risk: Math.round(risk * 1000) / 1000 };
  }

  /** Locations where a commodity is traded — used for arbitrage scanning. */
  locationsTrading(commodityId: ID): LocationDef[] {
    return this.locations.filter((l) => l.tradedCommodityIds.includes(commodityId));
  }

  locationsInRegion(regionId: string): LocationDef[] {
    return this.locations.filter((l) => l.regionId === regionId);
  }

  locationsInCountry(countryId: string): LocationDef[] {
    return this.locations.filter((l) => l.countryId === countryId);
  }

  /** Effective legality of a commodity in a jurisdiction (overrides applied). */
  effectiveLegality(locationId: ID, c: CommodityDef): Legality {
    const l = this.locById.get(locationId);
    if (!l) return c.legality;
    return l.laws.legalityOverrides[c.category] ?? c.legality;
  }

  /**
   * Catalogue reachability, for tests, the economy inspector and operations.
   *
   * Server-side only: it is never part of a DTO. It answers "can a player actually
   * buy and sell this good somewhere, and if not why not", which is what keeps the
   * market composer honest as the catalogue grows.
   */
  coverage(): MarketCoverage {
    const registry = getCommodityRegistry();
    const traded = new Map<string, number>();
    for (const l of this.locations) for (const id of l.tradedCommodityIds) traded.set(id, (traded.get(id) ?? 0) + 1);
    const unreachable = registry
      .all()
      .filter((c) => !traded.has(c.id))
      .map((c) => ({ id: c.id, category: c.category, legality: c.legality, rarity: c.rarity }));
    return {
      commodities: registry.all().length,
      reachable: traded.size,
      unreachable,
      reachableLocations: this.locations.filter((l) => l.tradedCommodityIds.length > 0).length,
      marketsTotal: [...traded.values()].reduce((sum, n) => sum + n, 0),
      perMarket: this.locations.map((l) => ({ id: l.id, lines: l.tradedCommodityIds.length })),
    };
  }

  isTolerated(locationId: ID, c: CommodityDef): boolean {
    const l = this.locById.get(locationId);
    if (!l) return false;
    return l.laws.tolerated.includes(this.effectiveLegality(locationId, c));
  }
}

let worldInstance: WorldRegistry | null = null;

export function getWorldRegistry(): WorldRegistry {
  if (!worldInstance) worldInstance = new WorldRegistry();
  return worldInstance;
}

export function resetWorldRegistry(): void {
  worldInstance = null;
}
