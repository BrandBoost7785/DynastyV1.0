/**
 * Registry facade.
 *
 * The single import surface for authored game content. Everything here is
 * static, deterministic and built once per process; no module outside the
 * registry layer should import the individual data files directly.
 */

export {
  ALL_BASE_COMMODITIES,
  COMMODITY_CATEGORIES,
  CommodityRegistry,
  TRADED_CATEGORIES,
  getCommodityRegistry,
  getCommodity,
  getRegionPreference,
  resetCommodityRegistry,
} from './commodities';

export {
  WorldRegistry,
  getWorldRegistry,
  resetWorldRegistry,
  LAW_PRESETS,
} from './world';
export type { PathLeg, PathResult } from './world';

export { BASE_COMMODITIES_A, type BaseCommodity, type BaseCommoditySeed, type FormId } from './basesA';
export { BASE_COMMODITIES_B, BASE_COMMODITIES_C } from './basesB';
export { BASE_DEFAULTS } from './baseTypes';
export { FORMS, legalitySeverity, mostSevereLegality, type FormDef, type FormDefSeed } from './forms';
export { ARCHETYPE_DEMAND, COUNTRIES, COUNTRY_BY_ID, REGIONS, REGION_BY_ID, type CountryDef, type RegionDef } from './regions';

export {
  COMPANIES,
  COMPANY_BY_ID,
  CRYPTO_ASSETS,
  CRYPTO_BY_ID,
  FACTIONS,
  FACTION_BY_ID,
  SECTORS,
  cryptoSeedFor,
} from './actors';

export {
  BUSINESSES,
  BUSINESS_BY_ID,
  PRODUCTION_TAGS,
  PROPERTIES,
  PROPERTY_BY_ID,
  RECIPES,
  RECIPE_BY_ID,
  VEHICLES,
  VEHICLE_BY_ID,
  VEHICLE_UPGRADES,
  VEHICLE_UPGRADE_BY_ID,
  recipesForProperty,
} from './assets';

export {
  BUSINESS_OBJECTIVES,
  EMPLOYEE_ROLES,
  ENCOUNTER_TABLES,
  ENEMIES,
  ENEMY_BY_ID,
  FIRST_NAMES,
  HANDLES_A,
  HANDLES_B,
  LAST_NAMES,
  MODIFIER_KEYS,
  PERKS,
  PERK_BY_ID,
  ROLE_BY_ID,
  SKILLS,
  SKILL_BY_ID,
  SKILL_TREES,
} from './people';

export {
  EVENTS,
  EVENTS_BY_SCOPE,
  EVENT_BY_ID,
  type EventCondition,
  type EventDef,
  type EventDefSeed,
  type EventEffect,
  type EventChainLink,
} from './events';

export {
  ACHIEVEMENTS,
  ACHIEVEMENT_BY_ID,
  MISSIONS,
  MISSION_BY_ID,
  type MissionDef,
  type MissionDefSeed,
  type ObjectiveTemplate,
} from './missions';

import { getCommodityRegistry } from './commodities';
import { getWorldRegistry } from './world';
import { BUSINESSES, PROPERTIES, RECIPES, VEHICLES } from './assets';
import { COMPANIES, CRYPTO_ASSETS, FACTIONS } from './actors';
import { COUNTRIES, REGIONS } from './regions';
import { EMPLOYEE_ROLES, ENEMIES, PERKS, SKILLS } from './people';
import { EVENTS } from './events';
import { ACHIEVEMENTS, MISSIONS } from './missions';
import { FORMS } from './forms';

/** Content counts — surfaced in the debug panel and used by tests. */
export interface RegistrySummary {
  commodities: number;
  bases: number;
  categories: number;
  forms: number;
  locations: number;
  routes: number;
  regions: number;
  countries: number;
  factions: number;
  companies: number;
  cryptoAssets: number;
  vehicles: number;
  properties: number;
  businesses: number;
  recipes: number;
  skills: number;
  perks: number;
  employeeRoles: number;
  enemies: number;
  events: number;
  missions: number;
  achievements: number;
}

export function registrySummary(): RegistrySummary {
  const commodities = getCommodityRegistry();
  const world = getWorldRegistry();
  return {
    commodities: commodities.count,
    bases: commodities.baseIds().length,
    categories: commodities.categories().length,
    forms: Object.keys(FORMS).length,
    locations: world.locations.length,
    routes: world.routes.length,
    regions: REGIONS.length,
    countries: COUNTRIES.length,
    factions: FACTIONS.length,
    companies: COMPANIES.length,
    cryptoAssets: CRYPTO_ASSETS.length,
    vehicles: VEHICLES.length,
    properties: PROPERTIES.length,
    businesses: BUSINESSES.length,
    recipes: RECIPES.length,
    skills: SKILLS.length,
    perks: PERKS.length,
    employeeRoles: EMPLOYEE_ROLES.length,
    enemies: ENEMIES.length,
    events: EVENTS.length,
    missions: MISSIONS.length,
    achievements: ACHIEVEMENTS.length,
  };
}
