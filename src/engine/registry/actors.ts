/**
 * Actor registries: factions, listed companies and crypto assets.
 *
 * These are the non-player agents that make the world move independently of
 * the player — faction wars shift territory and market access, corporate
 * fundamentals drive equity prices, and crypto network dynamics drive digital
 * asset prices.
 */

import { Rng } from '../rng';
import type { CompanyDef, CryptoAssetDef, FactionDef } from '../../sim/types';

/* ------------------------------------------------------------------ */
/* Factions                                                            */
/* ------------------------------------------------------------------ */

interface FactionSeed {
  id: string;
  name: string;
  kind: FactionDef['kind'];
  description: string;
  goals: string[];
  resources: number;
  power: number;
  territoryIds: string[];
  interests: FactionDef['interests'];
  rivals?: string[];
  allies?: string[];
  recruitment?: number;
  services?: FactionDef['services'];
}

function fac(s: FactionSeed): FactionDef {
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    description: s.description,
    goals: s.goals,
    resources: s.resources,
    power: s.power,
    territoryIds: s.territoryIds,
    interests: s.interests,
    rivalIds: s.rivals ?? [],
    allyIds: s.allies ?? [],
    recruitmentRequirement: s.recruitment ?? 25,
    services: s.services ?? ['contracts'],
  };
}

export const FACTIONS: FactionDef[] = [
  /* ------------------------- legitimate institutions ------------------------ */
  fac({
    id: 'avalon_exchange', name: 'New Avalon Exchange', kind: 'guild',
    description: 'The listing authority and clearing house for the continent\'s deepest equity market.',
    goals: ['Maintain market integrity', 'Attract listings', 'Expand derivative products'],
    resources: 82_000_000, power: 0.62, territoryIds: ['new_avalon'],
    interests: ['financial_asset', 'information', 'technology'],
    allies: ['meridian_bank', 'continental_bank'], rivals: ['sprawl_collective'],
    recruitment: 40, services: ['contracts', 'intel', 'legal'],
  }),
  fac({
    id: 'meridian_bank', name: 'Meridian Commercial Bank', kind: 'bank',
    description: 'A century-old commercial bank with branches in every major port and a very conservative credit committee.',
    goals: ['Grow deposits', 'Limit defaults', 'Expand trade finance'],
    resources: 640_000_000, power: 0.7, territoryIds: ['new_avalon', 'cape_meridian'],
    interests: ['financial_asset'], allies: ['avalon_exchange', 'cape_consortium'], rivals: ['gulf_cartel'],
    recruitment: 30, services: ['loans', 'legal', 'contracts'],
  }),
  fac({
    id: 'continental_bank', name: 'Continental Bank of Aldrich', kind: 'bank',
    description: 'The Old Continent\'s largest lender, and the quiet owner of several governments\' debt.',
    goals: ['Preserve capital', 'Sovereign lending', 'Currency stability'],
    resources: 910_000_000, power: 0.76, territoryIds: ['aldrich_capital', 'westhaven', 'lione'],
    interests: ['financial_asset', 'metal'], allies: ['avalon_exchange', 'aldrich_bourse'], rivals: ['marenza_family'],
    recruitment: 35, services: ['loans', 'legal'],
  }),
  fac({
    id: 'aldrich_bourse', name: 'Aldrich Bourse', kind: 'guild',
    description: 'Old-money exchange where dividends are paid in person and membership is hereditary in all but name.',
    goals: ['Preserve member privileges', 'Attract foreign capital'],
    resources: 61_000_000, power: 0.5, territoryIds: ['aldrich_capital'],
    interests: ['financial_asset', 'art', 'luxury'], allies: ['continental_bank', 'maison_lione'],
    recruitment: 55, services: ['contracts', 'intel', 'legal'],
  }),
  fac({
    id: 'zahr_sovereign', name: 'Zahr Sovereign Authority', kind: 'government',
    description: 'The state itself: a sovereign wealth fund, a national oil company and a very large police force.',
    goals: ['Defend the currency peg', 'Diversify beyond hydrocarbons', 'Suppress narcotics absolutely'],
    resources: 2_400_000_000, power: 0.94, territoryIds: ['zahr_city', 'red_sea_terminal', 'al_miraj_freeport'],
    interests: ['energy', 'financial_asset', 'construction'], allies: ['gulf_cartel'], rivals: ['solano_cartel', 'isthmus_smugglers'],
    recruitment: 60, services: ['contracts', 'protection', 'legal'],
  }),
  fac({
    id: 'khan_ministry', name: 'Steppe Ministry of Trade', kind: 'government',
    description: 'A state trading monopoly that sells minerals to whoever pays, and answers to no auditor.',
    goals: ['Maximise mineral revenue', 'Avoid sanctions', 'Keep the rail corridor open'],
    resources: 380_000_000, power: 0.68, territoryIds: ['khan_capital', 'steppe_crossing'],
    interests: ['raw_material', 'metal', 'energy'], allies: ['steppe_traders', 'jade_state_trading'],
    rivals: ['avalon_exchange'], recruitment: 45, services: ['contracts', 'laundering', 'smuggling'],
  }),
  fac({
    id: 'jade_state_trading', name: 'Jade State Trading Corporation', kind: 'corporation',
    description: 'The export arm of the world\'s largest manufacturing economy. It sets prices by decree.',
    goals: ['Grow export share', 'Secure raw material supply', 'Dominate components'],
    resources: 1_800_000_000, power: 0.92, territoryIds: ['jade_harbor', 'jinwan_city'],
    interests: ['manufactured', 'electronics', 'raw_material', 'metal'], allies: ['jade_harbor_auth', 'khan_ministry'],
    rivals: ['sunrise_keiretsu', 'kessel_industrial'], recruitment: 50, services: ['contracts', 'smuggling'],
  }),
  fac({
    id: 'jade_harbor_auth', name: 'Jade Harbor Port Authority', kind: 'government',
    description: 'Controls the largest container terminal on earth and every crane in it.',
    goals: ['Maximise throughput', 'Maintain customs discipline'],
    resources: 240_000_000, power: 0.7, territoryIds: ['jade_harbor'], interests: ['manufactured', 'raw_material'],
    allies: ['jade_state_trading'], recruitment: 40, services: ['smuggling', 'contracts'],
  }),
  fac({
    id: 'sunrise_keiretsu', name: 'Sunrise Keiretsu', kind: 'corporation',
    description: 'An interlocking group of manufacturers and banks that together outsize most national economies.',
    goals: ['Technological supremacy', 'Export discipline', 'Defend domestic market'],
    resources: 2_100_000_000, power: 0.9, territoryIds: ['sunrise_capital'],
    interests: ['technology', 'electronics', 'manufactured', 'financial_asset'], allies: ['australis_resources'],
    rivals: ['jade_state_trading'], recruitment: 55, services: ['contracts', 'intel'],
  }),
  fac({
    id: 'australis_resources', name: 'Australis Resources Consortium', kind: 'corporation',
    description: 'Four mining houses that coordinate shipments closely enough to attract antitrust attention.',
    goals: ['Sustain bulk prices', 'Expand lithium position', 'Control shipping capacity'],
    resources: 760_000_000, power: 0.74, territoryIds: ['australis_port'],
    interests: ['raw_material', 'metal', 'energy'], allies: ['sunrise_keiretsu', 'kessel_industrial'],
    rivals: ['jade_state_trading'], recruitment: 45, services: ['contracts', 'intel'],
  }),
  fac({
    id: 'kessel_industrial', name: 'Kessel Industrial Federation', kind: 'corporation',
    description: 'Precision engineering cartel that licenses its machine tools to everyone and its best ones to nobody.',
    goals: ['Protect export licences', 'Maintain precision monopoly'],
    resources: 540_000_000, power: 0.72, territoryIds: ['kesselstadt', 'baltic_freeport'],
    interests: ['industrial', 'manufactured', 'technology', 'metal'], allies: ['australis_resources', 'continental_bank'],
    rivals: ['jade_state_trading'], recruitment: 45, services: ['contracts', 'intel'],
  }),
  fac({
    id: 'baltic_freeport_auth', name: 'Baltic Freeport Authority', kind: 'government',
    description: 'Runs a bonded zone where ownership changes hands without goods ever moving.',
    goals: ['Grow vault occupancy', 'Stay off sanctions lists'],
    resources: 96_000_000, power: 0.48, territoryIds: ['baltic_freeport'], interests: ['luxury', 'art', 'metal'],
    allies: ['kessel_industrial', 'palm_trust'], recruitment: 40, services: ['laundering', 'contracts'],
  }),
  fac({
    id: 'palm_trust', name: 'Palm Trust & Registry', kind: 'corporation',
    description: 'Incorporates twenty thousand shell companies a year and asks precisely one question: cash or wire?',
    goals: ['Grow registry fees', 'Maintain banking secrecy', 'Avoid international blacklisting'],
    resources: 310_000_000, power: 0.58, territoryIds: ['palm_city', 'free_port_zero', 'al_miraj_freeport'],
    interests: ['financial_asset', 'information'], allies: ['baltic_freeport_auth', 'free_port_authority_faction'],
    rivals: ['avalon_exchange'], recruitment: 35, services: ['laundering', 'loans', 'legal', 'contracts'],
  }),
  fac({
    id: 'free_port_authority_faction', name: 'Free Port Authority', kind: 'government',
    description: 'A microstate whose entire constitution is a customs schedule.',
    goals: ['Preserve zero-tax status', 'Attract digital finance'],
    resources: 140_000_000, power: 0.5, territoryIds: ['free_port_zero'],
    interests: ['financial_asset', 'crypto_asset', 'information'], allies: ['palm_trust', 'sprawl_collective'],
    recruitment: 40, services: ['laundering', 'legal', 'contracts'],
  }),
  fac({
    id: 'vanholm_bio', name: 'Vanholm Biosciences', kind: 'corporation',
    description: 'A biotech firm whose pipeline is worth more than its revenue and whose trial data leaks suspiciously often.',
    goals: ['Advance clinical trials', 'Protect patents', 'Acquire competitors'],
    resources: 220_000_000, power: 0.5, territoryIds: ['vanholm'], interests: ['pharmaceutical', 'technology', 'medical'],
    allies: ['pacific_trading_co'], rivals: ['bharat_industrial'], recruitment: 45, services: ['contracts', 'intel'],
  }),
  fac({
    id: 'bharat_industrial', name: 'Bharat Industrial Group', kind: 'corporation',
    description: 'Generic pharmaceuticals at scale. Its margins are thin and its volumes are enormous.',
    goals: ['Win generic tenders', 'Expand into biologics', 'Undercut Western pricing'],
    resources: 410_000_000, power: 0.66, territoryIds: ['bharat_metro', 'delta_port'],
    interests: ['pharmaceutical', 'chemical', 'textile', 'technology'], allies: ['monsoon_syndicate'],
    rivals: ['vanholm_bio'], recruitment: 40, services: ['contracts', 'smuggling'],
  }),
  fac({
    id: 'maison_lione', name: 'Maison Lione', kind: 'corporation',
    description: 'A luxury house whose brand is worth more than its factories and whose counterfeits outsell it three to one.',
    goals: ['Protect brand', 'Expand into new wealth', 'Sue counterfeiters'],
    resources: 260_000_000, power: 0.46, territoryIds: ['lione'], interests: ['luxury', 'textile', 'art'],
    allies: ['aldrich_bourse', 'artisan_guild'], rivals: ['marenza_family'], recruitment: 50, services: ['contracts', 'intel'],
  }),
  fac({
    id: 'artisan_guild', name: 'Artisan Guild', kind: 'guild',
    description: 'A federation of workshops that certifies provenance — and, for a fee, certifies almost anything.',
    goals: ['Protect certification monopoly', 'Keep small workshops alive'],
    resources: 38_000_000, power: 0.34, territoryIds: ['val_marenza', 'kumasi_hub'],
    interests: ['textile', 'art', 'luxury'], allies: ['maison_lione'], rivals: ['marenza_family'],
    recruitment: 30, services: ['contracts', 'intel'],
  }),
  fac({
    id: 'cape_consortium', name: 'Cape Meridian Consortium', kind: 'corporation',
    description: 'Platinum, palladium and the port that ships them. Labour relations are permanently tense.',
    goals: ['Secure mineral concessions', 'Expand port capacity', 'Manage labour unrest'],
    resources: 480_000_000, power: 0.7, territoryIds: ['cape_meridian'], interests: ['metal', 'raw_material', 'energy'],
    allies: ['meridian_bank'], rivals: ['goldport_syndicate'], recruitment: 45, services: ['contracts', 'protection'],
  }),
  fac({
    id: 'pacific_trading_co', name: 'Pacific Trading Company', kind: 'corporation',
    description: 'An old import-export house that moves legal cargo eastbound and interesting cargo westbound.',
    goals: ['Grow freight volume', 'Maintain customs relationships'],
    resources: 190_000_000, power: 0.54, territoryIds: ['port_cascadia', 'vanholm'],
    interests: ['electronics', 'technology', 'textile', 'manufactured'], allies: ['vanholm_bio'],
    rivals: ['jade_state_trading'], recruitment: 35, services: ['contracts', 'smuggling', 'logistics'],
  }),
  fac({
    id: 'archipelago_traders', name: 'Archipelago Traders Association', kind: 'guild',
    description: 'A shipping association whose members know every anchorage between ten thousand islands.',
    goals: ['Control transshipment', 'Keep routes open'],
    resources: 120_000_000, power: 0.5, territoryIds: ['archipelago_hub'], interests: ['energy', 'raw_material', 'electronics'],
    allies: ['monsoon_syndicate'], rivals: ['coral_pirates'], recruitment: 30, services: ['smuggling', 'contracts', 'intel'],
  }),
  fac({
    id: 'steppe_traders', name: 'Steppe Traders Union', kind: 'guild',
    description: 'Caravan descendants running rail freight across a corridor that three governments claim.',
    goals: ['Keep the corridor open', 'Avoid customs harmonisation'],
    resources: 74_000_000, power: 0.46, territoryIds: ['steppe_crossing', 'khan_capital'],
    interests: ['raw_material', 'textile', 'energy'], allies: ['khan_ministry'], rivals: ['highland_warlords'],
    recruitment: 25, services: ['smuggling', 'contracts'],
  }),
  fac({
    id: 'great_lakes_traders', name: 'Great Lakes Traders', kind: 'guild',
    description: 'Mineral buying networks operating where no state effectively does.',
    goals: ['Keep ore flowing', 'Avoid traceability schemes'],
    resources: 42_000_000, power: 0.42, territoryIds: ['kivu_city'], interests: ['raw_material', 'metal'],
    allies: ['goldport_syndicate'], rivals: ['kivu_militia'], recruitment: 20, services: ['smuggling', 'contracts', 'laundering'],
  }),
  fac({
    id: 'grain_board', name: 'Midland Grain Board', kind: 'guild',
    description: 'A producer cartel that stores, grades and exports the region\'s harvest.',
    goals: ['Stabilise farmer income', 'Expand storage capacity'],
    resources: 88_000_000, power: 0.4, territoryIds: ['lakeview_junction', 'cotton_basin'],
    interests: ['agriculture', 'foodstuff'], allies: ['meridian_bank'], recruitment: 20, services: ['contracts'],
  }),
  fac({
    id: 'steelworkers_union', name: 'Steelworkers Union of Ironvale', kind: 'union',
    description: 'Forty thousand members who can stop the country\'s steel supply by voting on a Tuesday.',
    goals: ['Protect wages', 'Resist automation', 'Keep the mills open'],
    resources: 26_000_000, power: 0.52, territoryIds: ['ironvale'], interests: ['metal', 'industrial'],
    allies: ['grain_board'], rivals: ['kessel_industrial'], recruitment: 15, services: ['protection', 'contracts'],
  }),
  fac({
    id: 'longshoremen_guild', name: 'Longshoremen\'s Guild', kind: 'union',
    description: 'Controls the cranes at three major ports. Everything moves when they say it moves.',
    goals: ['Protect dockwork', 'Control overtime rates'],
    resources: 54_000_000, power: 0.6, territoryIds: ['harbor_point', 'westhaven', 'gulfport_sud'],
    interests: ['manufactured', 'raw_material'], allies: ['steelworkers_union'], rivals: ['fifth_family'],
    recruitment: 20, services: ['smuggling', 'contracts', 'protection'],
  }),
  fac({
    id: 'mirella_police', name: 'Santa Mirella Metropolitan Police', kind: 'government',
    description: 'Underfunded, outgunned, and half on somebody\'s payroll. The honest half is famous locally.',
    goals: ['Reduce homicide rate', 'Interdict narcotics', 'Survive budget cuts'],
    resources: 34_000_000, power: 0.56, territoryIds: ['santa_mirella'], interests: ['weapon', 'equipment'],
    rivals: ['solano_cartel'], allies: ['avalon_exchange'], recruitment: 30, services: ['protection', 'intel'],
  }),

  /* --------------------------- criminal factions ---------------------------- */
  fac({
    id: 'fifth_family', name: 'The Fifth Family', kind: 'criminal_syndicate',
    description: 'An organised crime dynasty with interests in docks, construction, waste and city politics.',
    goals: ['Control the harbor', 'Expand into narcotics distribution', 'Keep indictments stalled'],
    resources: 96_000_000, power: 0.66, territoryIds: ['new_avalon', 'harbor_point', 'blackridge'],
    interests: ['contraband_misc', 'narcotic', 'construction', 'financial_asset'],
    allies: ['blackridge_crew'], rivals: ['longshoremen_guild', 'meridian_bank', 'marenza_family'],
    recruitment: 30, services: ['protection', 'laundering', 'smuggling', 'mercenary', 'loans'],
  }),
  fac({
    id: 'blackridge_crew', name: 'Blackridge Crew', kind: 'criminal_syndicate',
    description: 'A rural outfit running guns and narcotics out of abandoned mine workings.',
    goals: ['Hold the ridge', 'Move product east'],
    resources: 12_000_000, power: 0.4, territoryIds: ['blackridge'], interests: ['narcotic', 'weapon'],
    allies: ['fifth_family'], rivals: ['mirella_police'], recruitment: 10,
    services: ['smuggling', 'mercenary', 'loans', 'protection'],
  }),
  fac({
    id: 'gulf_cartel', name: 'Gulf Cartel', kind: 'cartel',
    description: 'Refinery-adjacent smuggling at industrial scale, with genuine logistics competence.',
    goals: ['Control fuel smuggling', 'Move product north', 'Corrupt customs'],
    resources: 240_000_000, power: 0.8, territoryIds: ['gulfport_sud'], interests: ['energy', 'narcotic', 'contraband_misc'],
    allies: ['zahr_sovereign'], rivals: ['solano_cartel', 'meridian_bank'], recruitment: 35,
    services: ['smuggling', 'laundering', 'mercenary', 'loans', 'protection'],
  }),
  fac({
    id: 'solano_cartel', name: 'Solano Cartel', kind: 'cartel',
    description: 'Controls the mountain valleys and the ports beneath them. Its accountants are better than its gunmen.',
    goals: ['Control the isthmus corridor', 'Diversify into precursor chemicals', 'Neutralise extradition'],
    resources: 520_000_000, power: 0.9, territoryIds: ['santa_mirella', 'puerto_cenicza', 'valle_hoja'],
    interests: ['narcotic', 'chemical', 'contraband_misc', 'weapon'], allies: ['isthmus_smugglers'],
    rivals: ['mirella_police', 'gulf_cartel', 'zahr_sovereign'], recruitment: 40,
    services: ['smuggling', 'laundering', 'mercenary', 'loans', 'protection', 'contracts'],
  }),
  fac({
    id: 'isthmus_smugglers', name: 'Isthmus Smugglers\' Union', kind: 'criminal_syndicate',
    description: 'A logistics business that happens to move contraband. Extremely good at paperwork.',
    goals: ['Keep the crossing open', 'Undercut cartel rates', 'Avoid interdiction'],
    resources: 68_000_000, power: 0.58, territoryIds: ['la_frontera', 'puerto_cenicza', 'khabar_pass'],
    interests: ['contraband_misc', 'narcotic', 'vehicle_part'], allies: ['solano_cartel'],
    rivals: ['zahr_sovereign', 'mirella_police'], recruitment: 20, services: ['smuggling', 'laundering', 'contracts'],
  }),
  fac({
    id: 'marenza_family', name: 'Marenza Family', kind: 'criminal_syndicate',
    description: 'Port-side racketeering, counterfeit goods and a very long relationship with the judiciary.',
    goals: ['Control the port', 'Expand counterfeit distribution'],
    resources: 82_000_000, power: 0.62, territoryIds: ['porto_marenza', 'val_marenza'],
    interests: ['contraband_misc', 'narcotic', 'textile', 'foodstuff'], allies: ['goldport_syndicate'],
    rivals: ['continental_bank', 'fifth_family', 'maison_lione'], recruitment: 25,
    services: ['smuggling', 'laundering', 'protection', 'loans'],
  }),
  fac({
    id: 'goldport_syndicate', name: 'Goldport Syndicate', kind: 'criminal_syndicate',
    description: 'Gold smuggling and misweighing at a port where the scales are calibrated by the smugglers.',
    goals: ['Control gold exports', 'Own the weighbridge'],
    resources: 58_000_000, power: 0.56, territoryIds: ['goldport', 'kumasi_hub'], interests: ['metal', 'raw_material', 'agriculture'],
    allies: ['marenza_family', 'great_lakes_traders'], rivals: ['cape_consortium'], recruitment: 20,
    services: ['smuggling', 'laundering', 'protection'],
  }),
  fac({
    id: 'monsoon_syndicate', name: 'Monsoon Syndicate', kind: 'criminal_syndicate',
    description: 'Container-level smuggling through the delta, disguised as legitimate rice trade.',
    goals: ['Control delta containers', 'Expand into pharmaceuticals diversion'],
    resources: 110_000_000, power: 0.64, territoryIds: ['delta_port', 'bharat_metro', 'archipelago_hub'],
    interests: ['contraband_misc', 'pharmaceutical', 'agriculture', 'electronics'], allies: ['archipelago_traders', 'bharat_industrial'],
    rivals: ['jade_harbor_auth'], recruitment: 25, services: ['smuggling', 'laundering', 'contracts'],
  }),
  fac({
    id: 'coral_pirates', name: 'Coral Bay Pirates', kind: 'militia',
    description: 'They take ships, they sell what is aboard, and they refuel where no navy goes.',
    goals: ['Interdict shipping', 'Hold the anchorage', 'Sell seized cargo'],
    resources: 24_000_000, power: 0.54, territoryIds: ['coral_bay'], interests: ['contraband_misc', 'electronics', 'energy'],
    rivals: ['archipelago_traders', 'jade_harbor_auth'], recruitment: 15, services: ['smuggling', 'mercenary', 'loans'],
  }),
  fac({
    id: 'tarak_militia', name: 'Tarak Militia Council', kind: 'militia',
    description: 'A coalition of neighbourhood armies that jointly control a city nobody wants to govern.',
    goals: ['Hold the city', 'Secure weapons supply', 'Extract customs revenue'],
    resources: 30_000_000, power: 0.68, territoryIds: ['tarak_city'], interests: ['weapon', 'foodstuff', 'energy', 'medical'],
    allies: ['highland_warlords'], rivals: ['sahel_militia', 'zahr_sovereign'], recruitment: 15,
    services: ['mercenary', 'smuggling', 'protection'],
  }),
  fac({
    id: 'highland_warlords', name: 'Highland Warlords', kind: 'militia',
    description: 'Control the mountain passes and tax everything that crosses them, legally or otherwise.',
    goals: ['Control the pass', 'Expand opium cultivation'],
    resources: 22_000_000, power: 0.6, territoryIds: ['khabar_pass'], interests: ['narcotic', 'weapon', 'contraband_misc'],
    allies: ['tarak_militia', 'solano_cartel'], rivals: ['steppe_traders', 'khan_ministry'], recruitment: 12,
    services: ['smuggling', 'mercenary', 'protection'],
  }),
  fac({
    id: 'sahel_militia', name: 'Sahel Militia', kind: 'militia',
    description: 'Controls the port approaches and charges "security fees" on every convoy.',
    goals: ['Control the port', 'Divert aid shipments', 'Expand territory north'],
    resources: 18_000_000, power: 0.58, territoryIds: ['sudania_port'], interests: ['weapon', 'foodstuff', 'medical', 'contraband_misc'],
    rivals: ['tarak_militia', 'zahr_sovereign'], recruitment: 12, services: ['smuggling', 'mercenary', 'protection'],
  }),
  fac({
    id: 'kivu_militia', name: 'Kivu Militia', kind: 'militia',
    description: 'Armed groups controlling mining pits and taxing ore at the pithead.',
    goals: ['Control the pits', 'Export untraceable ore', 'Resist army offensives'],
    resources: 16_000_000, power: 0.62, territoryIds: ['kivu_city', 'mine_ridge'],
    interests: ['raw_material', 'metal', 'weapon'], allies: ['goldport_syndicate'], rivals: ['great_lakes_traders', 'cape_consortium'],
    recruitment: 10, services: ['smuggling', 'mercenary', 'protection', 'loans'],
  }),
  fac({
    id: 'sprawl_collective', name: 'The Sprawl Collective', kind: 'intelligence',
    description: 'A decentralised network of operators trading data, exploits and laundered crypto across the darknet.',
    goals: ['Stay anonymous', 'Accumulate data leverage', 'Undermine financial surveillance'],
    resources: 44_000_000, power: 0.52, territoryIds: ['the_sprawl', 'atlas_haven'],
    interests: ['information', 'crypto_asset', 'technology'], allies: ['free_port_authority_faction'],
    rivals: ['avalon_exchange', 'sunrise_keiretsu'], recruitment: 30,
    services: ['intel', 'laundering', 'contracts', 'smuggling'],
  }),
];

export const FACTION_BY_ID: Record<string, FactionDef> = Object.fromEntries(FACTIONS.map((f) => [f.id, f]));

/* ------------------------------------------------------------------ */
/* Listed companies                                                    */
/* ------------------------------------------------------------------ */

/**
 * Sector-typical opening P/E multiples.
 *
 * Revenue is derived from market cap, margin and this multiple, so every listed
 * company starts at a believable valuation. Getting this wrong is not cosmetic:
 * the equity model re-rates prices toward a sentiment-implied multiple, so absurd
 * opening multiples make the whole index fall for the entire game.
 */
const SECTOR_PE: Record<string, number> = {
  Financials: 13,
  Energy: 11,
  Materials: 16,
  Industrials: 17,
  'Consumer Staples': 20,
  'Consumer Discretionary': 19,
  Healthcare: 18,
  Technology: 28,
};
const DEFAULT_SECTOR_PE = 16;

function co(
  id: string, name: string, ticker: string, sector: string, countryId: string,
  marketCap: number, margin: number, growth: number, beta: number,
  exposure: CompanyDef['exposure'], description: string, dividend = 0.02,
): CompanyDef {
  // Fast growers earn a premium multiple; the result is clamped into the band the
  // simulation's sentiment curve can actually express (see balance.stocks.peRange).
  const growthPremium = 1 + Math.max(0, growth) * 2.6;
  const raw = (SECTOR_PE[sector] ?? DEFAULT_SECTOR_PE) * growthPremium;
  const targetPe = Math.min(45, Math.max(7, raw));
  const revenueAnnual = Math.round(marketCap / (targetPe * Math.max(0.005, margin)));
  return {
    id, name, ticker, sector, countryId, marketCap,
    sharesOutstanding: 100_000_000,
    revenueAnnual,
    margin, growth, dividendYieldAnnual: dividend, beta, exposure, description,
  };
}

export const COMPANIES: CompanyDef[] = [
  co('meridian_holdings', 'Meridian Holdings', 'MRD', 'Financials', 'valtreya', 42_000_000_000, 0.28, 0.05, 1.1, { financial_asset: 0.8 }, 'Diversified banking group with a large trade-finance book.', 0.034),
  co('avalon_capital', 'Avalon Capital Group', 'AVC', 'Financials', 'valtreya', 18_500_000_000, 0.34, 0.06, 1.35, { financial_asset: 0.9, information: 0.2 }, 'Investment bank and asset manager; earnings are market-sensitive.', 0.021),
  co('harbor_logistics', 'Harbor Logistics Inc', 'HBL', 'Industrials', 'valtreya', 6_400_000_000, 0.09, 0.045, 1.0, { manufactured: 0.5, energy: 0.4 }, 'Container terminal and trucking network.', 0.028),
  co('ironvale_steel', 'Ironvale Steel', 'IRV', 'Materials', 'valtreya', 4_100_000_000, 0.06, 0.01, 1.5, { metal: 0.7, energy: 0.5, raw_material: 0.4 }, 'Integrated steelmaker exposed to ore and power costs.', 0.018),
  co('gulf_energy', 'Gulf Energy Partners', 'GEP', 'Energy', 'valtreya', 31_000_000_000, 0.16, 0.03, 1.25, { energy: 0.95, chemical: 0.2 }, 'Upstream and refining; earnings track the crack spread.', 0.045),
  co('midland_agri', 'Midland Agribusiness', 'MAG', 'Consumer Staples', 'valtreya', 9_800_000_000, 0.07, 0.035, 0.8, { agriculture: 0.85, chemical: 0.3 }, 'Grain handling, fertiliser and food processing.', 0.031),
  co('avalon_pharma', 'Avalon Pharmaceuticals', 'AVP', 'Healthcare', 'valtreya', 54_000_000_000, 0.26, 0.055, 0.7, { pharmaceutical: 0.9, chemical: 0.25 }, 'Patent-driven drugmaker with three blockbusters nearing expiry.', 0.024),
  co('vanholm_bio', 'Vanholm Biosciences', 'VHB', 'Healthcare', 'cascadia_fed', 12_600_000_000, 0.12, 0.14, 1.6, { pharmaceutical: 0.8, technology: 0.3 }, 'Clinical-stage biotech; the share price is a probability distribution.', 0.0),
  co('pacific_freight', 'Pacific Freight Corp', 'PFC', 'Industrials', 'cascadia_fed', 7_900_000_000, 0.11, 0.04, 1.15, { manufactured: 0.5, energy: 0.4 }, 'Transpacific shipping and port operations.', 0.026),
  co('cascade_software', 'Cascade Software', 'CSW', 'Technology', 'cascadia_fed', 88_000_000_000, 0.3, 0.16, 1.3, { technology: 0.7, electronics: 0.3 }, 'Cloud infrastructure and enterprise software.', 0.006),
  co('silverpine_mining', 'Silverpine Mining', 'SPM', 'Materials', 'cascadia_fed', 3_600_000_000, 0.19, 0.02, 1.55, { metal: 0.9, energy: 0.3 }, 'Polymetallic miner in difficult terrain.', 0.022),
  co('aldrich_luxury', 'Aldrich Luxury Group', 'ALX', 'Consumer Discretionary', 'aldrich_union', 46_000_000_000, 0.22, 0.07, 1.05, { luxury: 0.9, textile: 0.4 }, 'Maison portfolio; earnings follow global wealth sentiment.', 0.019),
  co('westhaven_shipping', 'Westhaven Shipping', 'WHS', 'Industrials', 'aldrich_union', 11_200_000_000, 0.13, 0.03, 1.2, { raw_material: 0.5, energy: 0.4 }, 'Bulk and container carrier with a large orderbook.', 0.036),
  co('continental_motors', 'Continental Motors', 'CTM', 'Consumer Discretionary', 'aldrich_union', 24_000_000_000, 0.07, 0.02, 1.3, { vehicle_part: 0.8, metal: 0.5, energy: 0.2 }, 'Mass-market automaker mid-transition to electric.', 0.03),
  co('lione_fashion', 'Maison Lione SA', 'LIO', 'Consumer Discretionary', 'aldrich_union', 16_800_000_000, 0.19, 0.08, 1.1, { luxury: 0.85, textile: 0.5 }, 'Heritage fashion house with aggressive licensing.', 0.021),
  co('kessel_precision', 'Kessel Precision AG', 'KPR', 'Industrials', 'kessel_confed', 28_500_000_000, 0.14, 0.045, 1.25, { industrial: 0.85, metal: 0.4, technology: 0.3 }, 'Machine tools and industrial automation.', 0.025),
  co('baltic_chem', 'Baltic Chemicals', 'BCH', 'Materials', 'kessel_confed', 14_400_000_000, 0.1, 0.02, 1.45, { chemical: 0.9, energy: 0.5 }, 'Commodity chemicals; margins invert when gas spikes.', 0.033),
  co('marenza_foods', 'Marenza Foods SpA', 'MRF', 'Consumer Staples', 'marenza', 5_200_000_000, 0.08, 0.03, 0.75, { foodstuff: 0.8, agriculture: 0.5 }, 'Olive oil, pasta and canned goods across three continents.', 0.041),
  co('zahr_petroleum', 'Zahr National Petroleum', 'ZNP', 'Energy', 'emirate_of_zahr', 120_000_000_000, 0.24, 0.02, 1.1, { energy: 1.0 }, 'State-linked oil major with the lowest lifting costs on earth.', 0.052),
  co('zahr_air', 'Zahr Airways', 'ZAW', 'Industrials', 'emirate_of_zahr', 9_600_000_000, 0.06, 0.07, 1.5, { energy: 0.7 }, 'Hub carrier; fuel is 30% of costs and traffic is cyclical.', 0.012),
  co('miraj_finance', 'Al-Miraj Financial', 'MIR', 'Financials', 'emirate_of_zahr', 38_000_000_000, 0.3, 0.09, 1.2, { financial_asset: 0.9 }, 'Freeport-based private bank and asset manager.', 0.028),
  co('sudania_shipping', 'Sudania Bulk Shipping', 'SBS', 'Industrials', 'sudania', 1_400_000_000, 0.05, -0.02, 1.7, { energy: 0.4, raw_material: 0.5 }, 'Distressed bulk carrier with aging tonnage.', 0.0),
  co('goldport_gold', 'Goldport Gold Fields', 'GGF', 'Materials', 'gold_coast_republic', 6_800_000_000, 0.21, 0.03, 1.4, { metal: 0.95, energy: 0.3 }, 'Open-pit gold miner; a direct leveraged play on bullion.', 0.017),
  co('kivu_minerals', 'Kivu Minerals', 'KVM', 'Materials', 'kivu_federation', 900_000_000, 0.14, 0.06, 1.9, { raw_material: 0.9, metal: 0.5 }, 'Artisanal ore aggregator with severe governance problems.', 0.0),
  co('cape_platinum', 'Cape Platinum Ltd', 'CPT', 'Materials', 'cape_reach_republic', 15_600_000_000, 0.23, 0.025, 1.5, { metal: 0.95, energy: 0.25 }, 'Platinum group metals; labour disputes are an annual event.', 0.043),
  co('bharat_generics', 'Bharat Generics Ltd', 'BGL', 'Healthcare', 'bharat_union', 21_000_000_000, 0.15, 0.11, 0.9, { pharmaceutical: 0.95, chemical: 0.35 }, 'World\'s largest generic manufacturer by volume.', 0.014),
  co('delta_textiles', 'Delta Textiles', 'DTX', 'Consumer Discretionary', 'bharat_union', 3_200_000_000, 0.06, 0.05, 1.1, { textile: 0.9, agriculture: 0.4 }, 'Spinning and garment exporter with thin margins.', 0.02),
  co('steppe_energy', 'Steppe Energy Corp', 'SEC', 'Energy', 'steppe_khanate', 8_400_000_000, 0.18, 0.02, 1.3, { energy: 0.9, raw_material: 0.3 }, 'Coal and uranium producer with state-directed pricing.', 0.038),
  co('khan_copper', 'Khan Copper', 'KCU', 'Materials', 'steppe_khanate', 5_600_000_000, 0.2, 0.04, 1.6, { metal: 0.9, energy: 0.3 }, 'Low-cost copper miner expanding into lithium.', 0.024),
  co('jade_electronics', 'Jade Electronics', 'JDE', 'Technology', 'jade_coast_state', 142_000_000_000, 0.12, 0.09, 1.35, { electronics: 0.9, technology: 0.6, metal: 0.25 }, 'Contract manufacturer for every major consumer brand.', 0.011),
  co('jade_solar', 'Jade Solar Technologies', 'JST', 'Industrials', 'jade_coast_state', 19_500_000_000, 0.08, 0.18, 1.7, { electronics: 0.5, metal: 0.4, energy: 0.3 }, 'Module maker in a brutal price war it is currently winning.', 0.0),
  co('jinwan_components', 'Jinwan Components', 'JWC', 'Technology', 'jade_coast_state', 34_000_000_000, 0.17, 0.12, 1.5, { electronics: 0.85, technology: 0.5 }, 'Memory and display fabrication.', 0.008),
  co('archipelago_palm', 'Archipelago Palm & Rubber', 'APR', 'Materials', 'archipelago_union', 4_700_000_000, 0.11, 0.03, 1.25, { agriculture: 0.9 }, 'Plantation group facing deforestation scrutiny.', 0.027),
  co('coral_freight', 'Coral Bay Freight', 'CBF', 'Industrials', 'archipelago_union', 2_100_000_000, 0.09, 0.04, 1.4, { energy: 0.5, manufactured: 0.4 }, 'Regional feeder shipping with a piracy problem.', 0.015),
  co('sunrise_robotics', 'Sunrise Robotics', 'SNR', 'Technology', 'sunrise_empire', 62_000_000_000, 0.16, 0.08, 1.25, { technology: 0.8, industrial: 0.5, electronics: 0.4 }, 'Industrial robots and precision optics.', 0.013),
  co('sunrise_semis', 'Sunrise Semiconductors', 'SNS', 'Technology', 'sunrise_empire', 168_000_000_000, 0.29, 0.13, 1.45, { technology: 0.95, electronics: 0.5, metal: 0.2 }, 'Lithography and advanced logic. The most strategically important company on earth.', 0.007),
  co('sunrise_motors', 'Sunrise Motors', 'SNM', 'Consumer Discretionary', 'sunrise_empire', 58_000_000_000, 0.09, 0.025, 1.2, { vehicle_part: 0.85, metal: 0.4 }, 'Hybrid pioneer now betting everything on batteries.', 0.029),
  co('australis_iron', 'Australis Iron Ore', 'AIO', 'Materials', 'australis', 76_000_000_000, 0.31, 0.015, 1.4, { raw_material: 0.9, metal: 0.6, energy: 0.3 }, 'Lowest-cost iron ore producer; dividends are enormous and cyclical.', 0.061),
  co('australis_lithium', 'Australis Lithium', 'ALI', 'Materials', 'australis', 12_800_000_000, 0.22, 0.15, 2.0, { raw_material: 0.85, metal: 0.5 }, 'Brine and hard-rock lithium; the purest EV bet available.', 0.0),
  co('freeport_reinsurance', 'Free Port Reinsurance', 'FPR', 'Financials', 'free_port_authority', 26_000_000_000, 0.2, 0.04, 1.15, { financial_asset: 0.7 }, 'Catastrophe reinsurer domiciled where regulation is optional.', 0.032),
  co('atlas_data', 'Atlas Data Havens', 'ADH', 'Technology', 'free_port_authority', 8_900_000_000, 0.24, 0.22, 1.6, { technology: 0.8, information: 0.6, electronics: 0.3 }, 'Sovereign-ambiguous hosting and custody infrastructure.', 0.004),
  co('sprawl_networks', 'Sprawl Networks Ltd', 'SPW', 'Technology', 'free_port_authority', 3_400_000_000, 0.18, 0.28, 2.1, { information: 0.9, crypto_asset: 0.5, technology: 0.4 }, 'Darknet-adjacent security and analytics firm with an opaque client list.', 0.0),
  co('tarak_reconstruction', 'Tarak Reconstruction Co', 'TRC', 'Industrials', 'tarakhstan', 700_000_000, 0.04, 0.09, 1.85, { construction: 0.9, metal: 0.4 }, 'Rebuilds what the last war destroyed, at whatever the government pays.', 0.0),
  co('palm_island_hotels', 'Palm Island Hotels', 'PIH', 'Consumer Discretionary', 'isla_verde', 4_300_000_000, 0.14, 0.06, 1.3, { beverage: 0.2, luxury: 0.3 }, 'Resort operator dependent on wealthy tourists and their discretion.', 0.023),
];

export const COMPANY_BY_ID: Record<string, CompanyDef> = Object.fromEntries(COMPANIES.map((c) => [c.id, c]));

export const SECTORS: string[] = Array.from(new Set(COMPANIES.map((c) => c.sector)));

/* ------------------------------------------------------------------ */
/* Crypto assets                                                       */
/* ------------------------------------------------------------------ */

function tok(
  id: string, symbol: string, name: string, kind: CryptoAssetDef['kind'], genesisPrice: number,
  maxSupply: number | null, circulating: number, issuance: number, volatility: number,
  regRisk: number, protoRisk: number, stakeable: boolean, mineable: boolean, stakingApy: number,
  networkEffect: number, description: string, peg?: { to: 'fiat'; value: number },
  opts?: Partial<Pick<CryptoAssetDef, 'halvingIntervalDays' | 'genesisBlockReward' | 'blockTimeSeconds'>>,
): CryptoAssetDef {
  // Proof-of-work assets have a halving schedule; the genesis block reward is
  // derived from the annual issuance rate so the two stay consistent.
  const blockTimeSeconds = opts?.blockTimeSeconds ?? (mineable ? 600 : null);
  const blocksPerYear = blockTimeSeconds ? (365 * 24 * 3600) / blockTimeSeconds : 0;
  const genesisBlockReward = opts?.genesisBlockReward
    ?? (mineable && blocksPerYear > 0
      ? Math.max(0.0001, (Math.max(0, issuance) * circulating) / blocksPerYear)
      : null);
  return {
    id, symbol, name, kind, genesisPrice, maxSupply, circulatingSupply: circulating,
    issuanceRate: issuance, volatility, regulatoryRisk: regRisk, protocolRisk: protoRisk,
    peg, stakeable, mineable, stakingApy, networkEffect, description,
    halvingIntervalDays: opts?.halvingIntervalDays ?? (mineable ? 1460 : null),
    genesisBlockReward,
    blockTimeSeconds,
  };
}

export const CRYPTO_ASSETS: CryptoAssetDef[] = [
  tok('aureus', 'AUR', 'Aureus', 'store_of_value', 42_000, 21_000_000, 19_400_000, 0.017, 0.42, 0.35, 0.08, false, true, 0, 0.94,
    'The reserve asset of the crypto economy. Halvings cut issuance every four years; its price is a referendum on fiat.',
    undefined, { halvingIntervalDays: 1460, blockTimeSeconds: 600, genesisBlockReward: 50 }),
  tok('secondium', 'SEC', 'Secondium', 'store_of_value', 1_800, 84_000_000, 71_000_000, 0.045, 0.5, 0.4, 0.12, false, true, 0, 0.7,
    'The smaller sibling. Higher beta, worse security budget, perpetual "flippening" narrative.',
    undefined, { halvingIntervalDays: 1095, blockTimeSeconds: 150, genesisBlockReward: 12.5 }),
  tok('nexus', 'NEX', 'Nexus Chain', 'smart_contract', 320, null, 120_000_000, 0.02, 0.62, 0.45, 0.16, true, false, 0.042, 0.88,
    'The dominant smart-contract platform. Fees spike with usage, which is simultaneously its strength and its problem.'),
  tok('veil', 'VEL', 'Veil Protocol', 'smart_contract', 95, null, 340_000_000, 0.035, 0.7, 0.5, 0.2, true, false, 0.061, 0.6,
    'Low-fee rival chain. Grows fast in bull markets and empties faster in bear markets.'),
  tok('orbital', 'ORB', 'Orbital Layer-2', 'infrastructure', 12, null, 1_200_000_000, 0.06, 0.78, 0.5, 0.26, true, false, 0.035, 0.52,
    'Scaling network settling transactions for the two largest chains.'),
  tok('paritas', 'PAR', 'Paritas USD', 'stablecoin', 1, null, 68_000_000_000, 0.01, 0.06, 0.62, 0.18, false, false, 0.048, 0.9,
    'Fiat-collateralised dollar token. The plumbing of every exchange — until the reserves are questioned.',
    { to: 'fiat', value: 1 }),
  tok('paritas_eur', 'PEUR', 'Paritas EUR', 'stablecoin', 1.08, null, 9_000_000_000, 0.01, 0.06, 0.6, 0.16, false, false, 0.038, 0.66,
    'Euro-denominated sibling with a fraction of the liquidity.', { to: 'fiat', value: 1.08 }),
  tok('reserve_x', 'RSV', 'ReserveX', 'stablecoin', 1, null, 21_000_000_000, 0.012, 0.09, 0.7, 0.3, false, false, 0.055, 0.58,
    'Algorithmic reserve token. Its peg has held for two years, which its critics consider the concerning part.',
    { to: 'fiat', value: 1 }),
  tok('moneta', 'MON', 'Moneta', 'privacy', 148, 18_400_000, 18_100_000, 0.004, 0.66, 0.85, 0.22, false, true, 0, 0.44,
    'Untraceable by design. Delisted from every regulated exchange, which is exactly why it is used.',
    undefined, { halvingIntervalDays: 1825, blockTimeSeconds: 120, genesisBlockReward: 3.2 }),
  tok('umbra', 'UMB', 'Umbra', 'privacy', 62, null, 41_000_000, 0.03, 0.74, 0.88, 0.3, true, false, 0.028, 0.36,
    'Privacy layer on a public chain. Regulators consider it a money-laundering appliance.'),
  tok('helios', 'HEL', 'Helios Exchange Token', 'exchange_token', 24, 200_000_000, 148_000_000, -0.02, 0.68, 0.55, 0.34, true, false, 0.072, 0.62,
    'Fee-discount token of the largest exchange. Burns reduce supply; the exchange\'s solvency is the whole thesis.'),
  tok('basalt', 'BSL', 'Basalt Exchange Token', 'exchange_token', 9, 400_000_000, 260_000_000, -0.01, 0.72, 0.6, 0.4, true, false, 0.084, 0.4,
    'Second-tier exchange token with a history of "temporary" withdrawal freezes.'),
  tok('quantia', 'QNT', 'Quantia', 'infrastructure', 78, null, 62_000_000, 0.025, 0.8, 0.48, 0.36, true, false, 0.051, 0.4,
    'Oracle network feeding off-chain prices into on-chain contracts.'),
  tok('ferrum', 'FRM', 'Ferrum DeFi', 'infrastructure', 4.2, null, 890_000_000, 0.07, 0.86, 0.62, 0.5, true, false, 0.098, 0.34,
    'Lending protocol whose utilisation rate determines whether its yield is sustainable.'),
  tok('doge_of_isthmus', 'DOGI', 'Isthmus Doge', 'memecoin', 0.0000084, null, 142_000_000_000_000, 0.12, 1.0, 0.35, 0.7, false, false, 0, 0.3,
    'A joke with a market cap. Pure sentiment, zero fundamentals, and occasionally a 40× week.'),
  tok('pepe_cape', 'PPC', 'Cape Pepe', 'memecoin', 0.000021, null, 68_000_000_000_000, 0.14, 1.0, 0.3, 0.78, false, false, 0, 0.24,
    'Community token launched by an anonymous team that has since gone quiet.'),
  tok('lunar_yield', 'LNY', 'Lunar Yield', 'memecoin', 0.42, null, 1_000_000_000, 0.2, 1.0, 0.42, 0.92, true, false, 0.42, 0.12,
    'Advertises 42% staking. The yield is paid in more of itself, which is how these end.'),
  tok('sprawl_coin', 'SPR', 'Sprawl Coin', 'infrastructure', 1.85, null, 480_000_000, 0.05, 0.9, 0.66, 0.55, true, false, 0.11, 0.28,
    'Darknet settlement token. Its price is a direct read on underground activity.'),
  tok('grid_power', 'GRD', 'Grid Power Token', 'infrastructure', 6.4, null, 210_000_000, 0.04, 0.72, 0.5, 0.32, true, false, 0.066, 0.38,
    'Coordinates decentralised energy markets around the Frostreach datacenters.'),
  tok('jade_digital', 'JDC', 'Jade Digital Currency', 'infrastructure', 1.4, null, 3_400_000_000, 0.008, 0.55, 0.9, 0.15, true, false, 0.024, 0.5,
    'State-issued digital currency. Fully traceable, mandatory adoption, no exit.'),
];

export const CRYPTO_BY_ID: Record<string, CryptoAssetDef> = Object.fromEntries(CRYPTO_ASSETS.map((c) => [c.id, c]));

/** Deterministic per-asset seed used by the crypto simulator. */
export function cryptoSeedFor(assetId: string): Rng {
  return new Rng(`crypto:${assetId}`, `crypto/${assetId}`);
}

/* ------------------------------------------------------------------ */
/* Crypto exchanges                                                    */
/* ------------------------------------------------------------------ */

/**
 * Venues where crypto is actually traded. Exchanges are distinct from assets:
 * they set fees, depth, custody risk and withdrawal friction. A centralised
 * exchange can fail and take custodial balances with it — a risk that has no
 * analogue in the commodity or equity systems, and one the player must manage by
 * choosing self-custody.
 */
export interface CryptoExchangeDef {
  id: string;
  name: string;
  kind: 'cex' | 'dex' | 'otc' | 'darknet';
  /** Taker fee as a fraction of notional. */
  feeFraction: number;
  /** Multiplier on an asset's intrinsic liquidity when traded here. */
  liquidityMultiplier: number;
  /** 0…1 daily probability of insolvency/hack taking custodial balances. */
  custodyRiskPerDay: number;
  /** Flat fee to move coins from the exchange to self-custody. */
  withdrawalFeeFlat: number;
  /** Days a withdrawal is held for review. */
  withdrawalDelayDays: number;
  /** 0 = no KYC, 3 = full identity verification. */
  kycLevel: number;
  /** Asset kinds the venue lists. */
  listsKinds: CryptoAssetDef['kind'][];
  /** 0…1 — how likely the venue is to freeze accounts under pressure. */
  compliancePressure: number;
  /** Darknet venues require underground access. */
  requiresUnderground: boolean;
  homeCountryId: string;
  description: string;
}

function ex(e: CryptoExchangeDef): CryptoExchangeDef {
  return e;
}

export const CRYPTO_EXCHANGES: CryptoExchangeDef[] = [
  ex({
    id: 'avalon_digital', name: 'Avalon Digital Exchange', kind: 'cex', feeFraction: 0.0018, liquidityMultiplier: 2.4,
    custodyRiskPerDay: 0.00035, withdrawalFeeFlat: 2.5, withdrawalDelayDays: 1, kycLevel: 3,
    listsKinds: ['store_of_value', 'smart_contract', 'stablecoin', 'exchange_token', 'infrastructure'],
    compliancePressure: 0.85, requiresUnderground: false, homeCountryId: 'valtreya',
    description: 'The regulated incumbent. Deep books, fast settlement, and a complete record of everything you do.',
  }),
  ex({
    id: 'jinwan_bit', name: 'Jinwan Bit', kind: 'cex', feeFraction: 0.0012, liquidityMultiplier: 2.9,
    custodyRiskPerDay: 0.00055, withdrawalFeeFlat: 1.8, withdrawalDelayDays: 1, kycLevel: 2,
    listsKinds: ['store_of_value', 'smart_contract', 'memecoin', 'exchange_token', 'infrastructure', 'stablecoin'],
    compliancePressure: 0.55, requiresUnderground: false, homeCountryId: 'jinwan',
    description: 'Highest volume venue in the world. Lists everything, audits nothing, and has survived three bank runs.',
  }),
  ex({
    id: 'isthmus_swap', name: 'Isthmus Swap', kind: 'dex', feeFraction: 0.003, liquidityMultiplier: 1.1,
    custodyRiskPerDay: 0.0009, withdrawalFeeFlat: 0.4, withdrawalDelayDays: 0, kycLevel: 0,
    listsKinds: ['smart_contract', 'memecoin', 'infrastructure', 'exchange_token', 'privacy'],
    compliancePressure: 0.1, requiresUnderground: false, homeCountryId: 'isthmus',
    description: 'Non-custodial pools. You keep your keys, you keep your risk, and slippage on size is brutal.',
  }),
  ex({
    id: 'polar_otc', name: 'Polar OTC Desk', kind: 'otc', feeFraction: 0.0075, liquidityMultiplier: 0.8,
    custodyRiskPerDay: 0.0002, withdrawalFeeFlat: 6, withdrawalDelayDays: 2, kycLevel: 1,
    listsKinds: ['store_of_value', 'stablecoin', 'privacy'],
    compliancePressure: 0.3, requiresUnderground: false, homeCountryId: 'polaris',
    description: 'Block trades by voice. Wide spreads, no market impact, and nobody asks where the coins came from.',
  }),
  ex({
    id: 'sprawl_market', name: 'Sprawl Market', kind: 'darknet', feeFraction: 0.0045, liquidityMultiplier: 0.55,
    custodyRiskPerDay: 0.0031, withdrawalFeeFlat: 0.2, withdrawalDelayDays: 0, kycLevel: 0,
    listsKinds: ['privacy', 'memecoin', 'infrastructure', 'store_of_value'],
    compliancePressure: 0.02, requiresUnderground: true, homeCountryId: 'isthmus',
    description: 'Escrowed darknet venue settling in Sprawl Coin. Anonymous, cheap, and occasionally it simply disappears.',
  }),
  ex({
    id: 'jade_gateway', name: 'Jade Gateway', kind: 'cex', feeFraction: 0.0009, liquidityMultiplier: 1.9,
    custodyRiskPerDay: 0.00015, withdrawalFeeFlat: 0, withdrawalDelayDays: 3, kycLevel: 3,
    listsKinds: ['infrastructure', 'stablecoin', 'store_of_value'],
    compliancePressure: 0.95, requiresUnderground: false, homeCountryId: 'jade',
    description: 'State-linked gateway. Cheapest fees in the world, three-day withdrawal holds, and total transaction visibility.',
  }),
];

export const EXCHANGE_BY_ID: Record<string, CryptoExchangeDef> = Object.fromEntries(CRYPTO_EXCHANGES.map((e) => [e.id, e]));
