/**
 * World geography primitives shared by the commodity, location and route
 * registries. Defining regions and countries in one module keeps the
 * registries acyclic and lets commodity regional-preference data reference the
 * same identifiers the world graph uses.
 */

export interface RegionDef {
  id: string;
  name: string;
  /** Broad economic archetype — drives default demand and price behaviour. */
  archetype:
    | 'industrial'
    | 'financial'
    | 'agricultural'
    | 'resource'
    | 'manufacturing'
    | 'transit'
    | 'conflict'
    | 'offshore'
    | 'emerging'
    | 'remote';
}

export interface CountryDef {
  id: string;
  name: string;
  regionIds: string[];
  /** 0…1 governance quality; drives enforcement and corruption defaults. */
  governance: number;
  /** 0…1 economic development. */
  development: number;
  currency: string;
  currencySymbol: string;
  /** 0…1 tolerance for grey/black commerce in practice. */
  tolerance: number;
}

export const REGIONS: RegionDef[] = [
  { id: 'northreach', name: 'Northreach', archetype: 'financial' },
  { id: 'eastern_seaboard', name: 'Eastern Seaboard', archetype: 'industrial' },
  { id: 'gulf_arc', name: 'Gulf Arc', archetype: 'resource' },
  { id: 'midland_plains', name: 'Midland Plains', archetype: 'agricultural' },
  { id: 'cordillera', name: 'Cordillera', archetype: 'resource' },
  { id: 'isthmus', name: 'Isthmus', archetype: 'transit' },
  { id: 'isle_of_palms', name: 'Isle of Palms', archetype: 'offshore' },
  { id: 'western_maritime', name: 'Western Maritime', archetype: 'manufacturing' },
  { id: 'old_continent', name: 'Old Continent', archetype: 'industrial' },
  { id: 'baltic_shield', name: 'Baltic Shield', archetype: 'resource' },
  { id: 'mediterrane', name: 'Mediterrane', archetype: 'transit' },
  { id: 'highland_marches', name: 'Highland Marches', archetype: 'conflict' },
  { id: 'levant', name: 'Levant', archetype: 'resource' },
  { id: 'red_sea_coast', name: 'Red Sea Coast', archetype: 'transit' },
  { id: 'sahel_belt', name: 'Sahel Belt', archetype: 'emerging' },
  { id: 'gold_coast', name: 'Gold Coast', archetype: 'resource' },
  { id: 'great_lakes', name: 'Great Lakes', archetype: 'conflict' },
  { id: 'cape_reach', name: 'Cape Reach', archetype: 'resource' },
  { id: 'monsoon_delta', name: 'Monsoon Delta', archetype: 'agricultural' },
  { id: 'steppe_corridor', name: 'Steppe Corridor', archetype: 'transit' },
  { id: 'jade_coast', name: 'Jade Coast', archetype: 'manufacturing' },
  { id: 'archipelago_seas', name: 'Archipelago Seas', archetype: 'transit' },
  { id: 'sunrise_isles', name: 'Sunrise Isles', archetype: 'industrial' },
  { id: 'southern_cross', name: 'Southern Cross', archetype: 'resource' },
  { id: 'polar_basin', name: 'Polar Basin', archetype: 'remote' },
  { id: 'free_ports', name: 'Free Ports', archetype: 'offshore' },
];

export const COUNTRIES: CountryDef[] = [
  { id: 'valtreya', name: 'Republic of Valtreya', regionIds: ['northreach', 'eastern_seaboard', 'midland_plains', 'gulf_arc'], governance: 0.82, development: 0.9, currency: 'VCU', currencySymbol: '$', tolerance: 0.22 },
  { id: 'cascadia_fed', name: 'Cascadian Federation', regionIds: ['western_maritime', 'cordillera'], governance: 0.79, development: 0.88, currency: 'CFD', currencySymbol: '₡', tolerance: 0.26 },
  { id: 'nueva_solana', name: 'Nueva Solana', regionIds: ['cordillera', 'isthmus'], governance: 0.44, development: 0.52, currency: 'SOL', currencySymbol: '₴', tolerance: 0.68 },
  { id: 'isla_verde', name: 'Isla Verde', regionIds: ['isle_of_palms'], governance: 0.6, development: 0.74, currency: 'IVD', currencySymbol: '¤', tolerance: 0.82 },
  { id: 'aldrich_union', name: 'Aldrich Union', regionIds: ['old_continent', 'western_maritime'], governance: 0.86, development: 0.91, currency: 'AUD', currencySymbol: '€', tolerance: 0.18 },
  { id: 'kessel_confed', name: 'Kessel Confederation', regionIds: ['baltic_shield', 'old_continent'], governance: 0.84, development: 0.89, currency: 'KMK', currencySymbol: '₭', tolerance: 0.2 },
  { id: 'marenza', name: 'Marenza', regionIds: ['mediterrane'], governance: 0.62, development: 0.72, currency: 'MRZ', currencySymbol: '₤', tolerance: 0.55 },
  { id: 'tarakhstan', name: 'Tarakhstan', regionIds: ['highland_marches', 'steppe_corridor'], governance: 0.24, development: 0.34, currency: 'TKA', currencySymbol: '₮', tolerance: 0.86 },
  { id: 'emirate_of_zahr', name: 'Emirate of Zahr', regionIds: ['levant', 'red_sea_coast'], governance: 0.7, development: 0.86, currency: 'ZHR', currencySymbol: '﷼', tolerance: 0.4 },
  { id: 'sudania', name: 'Sudania', regionIds: ['sahel_belt', 'red_sea_coast'], governance: 0.3, development: 0.28, currency: 'SUD', currencySymbol: '₷', tolerance: 0.78 },
  { id: 'gold_coast_republic', name: 'Gold Coast Republic', regionIds: ['gold_coast'], governance: 0.52, development: 0.5, currency: 'GCR', currencySymbol: '₲', tolerance: 0.62 },
  { id: 'kivu_federation', name: 'Kivu Federation', regionIds: ['great_lakes'], governance: 0.26, development: 0.3, currency: 'KVF', currencySymbol: '₭', tolerance: 0.84 },
  { id: 'cape_reach_republic', name: 'Cape Reach Republic', regionIds: ['cape_reach'], governance: 0.6, development: 0.62, currency: 'CRR', currencySymbol: 'R', tolerance: 0.5 },
  { id: 'bharat_union', name: 'Bharat Union', regionIds: ['monsoon_delta'], governance: 0.56, development: 0.58, currency: 'BHU', currencySymbol: '₹', tolerance: 0.6 },
  { id: 'steppe_khanate', name: 'Steppe Khanate', regionIds: ['steppe_corridor', 'polar_basin'], governance: 0.36, development: 0.44, currency: 'SKT', currencySymbol: '₸', tolerance: 0.7 },
  { id: 'jade_coast_state', name: 'Jade Coast State', regionIds: ['jade_coast'], governance: 0.68, development: 0.8, currency: 'JCS', currencySymbol: '¥', tolerance: 0.42 },
  { id: 'archipelago_union', name: 'Archipelago Union', regionIds: ['archipelago_seas'], governance: 0.5, development: 0.56, currency: 'ARU', currencySymbol: '₳', tolerance: 0.66 },
  { id: 'sunrise_empire', name: 'Sunrise Isles Dominion', regionIds: ['sunrise_isles'], governance: 0.88, development: 0.93, currency: 'SID', currencySymbol: '円', tolerance: 0.16 },
  { id: 'australis', name: 'Commonwealth of Australis', regionIds: ['southern_cross'], governance: 0.83, development: 0.87, currency: 'AUS', currencySymbol: 'A$', tolerance: 0.24 },
  { id: 'free_port_authority', name: 'Free Port Authority', regionIds: ['free_ports'], governance: 0.58, development: 0.8, currency: 'FPT', currencySymbol: '₣', tolerance: 0.9 },
];

export const REGION_BY_ID: Record<string, RegionDef> = Object.fromEntries(
  REGIONS.map((r) => [r.id, r]),
);

export const COUNTRY_BY_ID: Record<string, CountryDef> = Object.fromEntries(
  COUNTRIES.map((c) => [c.id, c]),
);

/** Default demand multiplier applied to a commodity in a region archetype. */
export const ARCHETYPE_DEMAND: Record<RegionDef['archetype'], number> = {
  industrial: 1.12,
  financial: 1.24,
  agricultural: 0.86,
  resource: 0.9,
  manufacturing: 1.16,
  transit: 1.05,
  conflict: 0.72,
  offshore: 1.3,
  emerging: 0.94,
  remote: 0.62,
};
