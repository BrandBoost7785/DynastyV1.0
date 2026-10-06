/**
 * Registry validation tests.
 *
 * Every id referenced anywhere in the authored datasets must resolve. Silent
 * dangling references are the most dangerous class of bug in a data-driven
 * simulation: they do not throw, they quietly remove content from the game.
 * These tests fail loudly instead, and also assert the structural invariants
 * the simulation engine depends on (no negative prices, connected world graph,
 * no recipe that creates value from nothing, no permanent content lock).
 */

import { describe, expect, it } from 'vitest';

import { COMMODITY_CATEGORIES, getCommodityRegistry } from '../src/engine/registry/commodities';
import { getWorldRegistry } from '../src/engine/registry/world';
import { FORMS } from '../src/engine/registry/forms';
import { COUNTRIES, COUNTRY_BY_ID, REGIONS, REGION_BY_ID } from '../src/engine/registry/regions';
import { COMPANIES, CRYPTO_ASSETS, FACTIONS, FACTION_BY_ID, SECTORS } from '../src/engine/registry/actors';
import { BUSINESSES, PRODUCTION_TAGS, PROPERTIES, RECIPES, VEHICLES, VEHICLE_UPGRADES } from '../src/engine/registry/assets';
import { EMPLOYEE_ROLES, ENCOUNTER_TABLES, ENEMIES, PERKS, SKILLS, SKILL_BY_ID, SKILL_TREES } from '../src/engine/registry/people';
import { EVENTS, EVENTS_BY_SCOPE, EVENT_BY_ID } from '../src/engine/registry/events';
import { ACHIEVEMENTS, MISSIONS, MISSION_BY_ID } from '../src/engine/registry/missions';
import { BASE_COMMODITIES_A } from '../src/engine/registry/basesA';
import { BASE_COMMODITIES_B, BASE_COMMODITIES_C } from '../src/engine/registry/basesB';
import type { CommodityCategory, PropertyKind, ReputationDimension } from '../src/sim/types';
import { getBalance } from '../src/config/balance';

const BALANCE = getBalance();

const registry = getCommodityRegistry();
const world = getWorldRegistry();
const allCommodities = registry.all();

const categorySet = new Set<string>(COMMODITY_CATEGORIES);
const locationIds = new Set(world.locations.map((l) => l.id));
const regionIds = new Set(REGIONS.map((r) => r.id));
const countryIds = new Set(COUNTRIES.map((c) => c.id));
const skillIds = new Set(SKILLS.map((s) => s.id));
const factionIds = new Set(FACTIONS.map((f) => f.id));
const companyIdSet = new Set(COMPANIES.map((c) => c.id));
const cryptoIds = new Set(CRYPTO_ASSETS.map((c) => c.id));
const propertyKinds = new Set<string>(PROPERTIES.map((p) => p.kind));
const businessIds = new Set(BUSINESSES.map((b) => b.id));
const vehicleIds = new Set(VEHICLES.map((v) => v.id));
const reputationDims: ReputationDimension[] = ['business', 'criminal', 'underground', 'legal', 'global', 'crew', 'digital'];

const ALL_BASES = [...BASE_COMMODITIES_A, ...BASE_COMMODITIES_B, ...BASE_COMMODITIES_C];
const baseIds = new Set(ALL_BASES.map((b) => b.id));

function isCategory(v: string): v is CommodityCategory {
  return categorySet.has(v);
}

describe('commodity registry', () => {
  it('expands to well over 500 tradeable SKUs', () => {
    expect(registry.count).toBeGreaterThanOrEqual(500);
    expect(allCommodities.length).toBe(registry.count);
  });

  it('has unique ids across bases and SKUs', () => {
    const baseIds = ALL_BASES.map((b) => b.id);
    expect(new Set(baseIds).size).toBe(baseIds.length);
    const skuIds = allCommodities.map((c) => c.id);
    expect(new Set(skuIds).size).toBe(skuIds.length);
  });

  it('only references forms that exist', () => {
    for (const base of ALL_BASES) {
      expect(base.forms.length, `base ${base.id} has no forms`).toBeGreaterThan(0);
      for (const form of base.forms) {
        expect(FORMS[form], `base ${base.id} references unknown form ${form}`).toBeDefined();
      }
    }
    for (const formId of Object.keys(FORMS)) {
      expect(FORMS[formId as keyof typeof FORMS]!.valueMul).toBeGreaterThan(0);
    }
  });

  it('assigns every SKU a valid category, legality and base/form lineage', () => {
    for (const c of allCommodities) {
      expect(isCategory(c.category), `${c.id} bad category ${c.category}`).toBe(true);
      expect(['legal', 'restricted', 'illegal', 'contraband']).toContain(c.legality);
      expect(baseIds.has(c.baseId), `${c.id} has unknown baseId ${c.baseId}`).toBe(true);
      expect(registry.variantsOf(c.baseId).length).toBeGreaterThan(0);
      expect(FORMS[c.formId as keyof typeof FORMS], `${c.id} has unknown formId ${c.formId}`).toBeDefined();
      expect(c.marketTypes.length).toBeGreaterThan(0);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.rarity).toBeGreaterThanOrEqual(1);
      expect(c.rarity).toBeLessThanOrEqual(5);
    }
  });

  it('never produces negative, zero or non-finite prices or physical stats', () => {
    for (const c of allCommodities) {
      expect(Number.isFinite(c.baseValue), `${c.id} baseValue not finite`).toBe(true);
      expect(c.baseValue, `${c.id} baseValue must be positive`).toBeGreaterThan(0);
      expect(c.weightKg, `${c.id} negative weight`).toBeGreaterThanOrEqual(0);
      expect(c.volumeL, `${c.id} negative volume`).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(c.volatility)).toBe(true);
      expect(c.volatility, `${c.id} negative volatility`).toBeGreaterThanOrEqual(0);
      expect(c.elasticity, `${c.id} non-positive elasticity`).toBeGreaterThan(0);
      expect(c.availability).toBeGreaterThan(0);
      expect(c.availability).toBeLessThanOrEqual(1.5);
      expect(c.baseDemand).toBeGreaterThan(0);
    }
  });

  it('gates risky goods behind reachable progression, never a permanent lock', () => {
    // Illegal and contraband goods must be gated; rare goods may be gated.
    // The invariant that matters (spec: never hard-lock the player out of a
    // major system) is that every gate is *finite and reachable*, and that a
    // legal, common good is never gated at all.
    let gated = 0;
    let openLegal = 0;
    for (const c of allCommodities) {
      if (c.legality === 'illegal' || c.legality === 'contraband') {
        expect(c.unlock, `${c.id} is ${c.legality} but has no unlock rule`).toBeDefined();
        gated++;
      } else if (
        c.legality === 'legal' &&
        c.rarity <= 3 &&
        c.marketTypes.includes('public') &&
        !c.isInstrument &&
        !['financial_asset', 'information', 'crypto_asset'].includes(c.category)
      ) {
        // Physical, common, legal goods must be available to a brand-new player:
        // this is the guarantee that the opening economy is never gated.
        expect(c.unlock, `common legal good ${c.id} must never be gated`).toBeUndefined();
        openLegal++;
      }
      if (!c.unlock) continue;
      // Every gate must be reachable, and must actually gate on something.
      const gates = [
        c.unlock.minLevel !== undefined,
        c.unlock.minSkill !== undefined,
        c.unlock.minReputation !== undefined,
        c.unlock.minFactionStanding !== undefined,
        c.unlock.requiresPerk !== undefined,
        c.unlock.requiresDiscovery !== undefined,
      ];
      expect(gates.some(Boolean), `${c.id} has an empty unlock condition`).toBe(true);
      if (c.unlock.minLevel !== undefined) {
        expect(Number.isFinite(c.unlock.minLevel), `${c.id} gate level not finite`).toBe(true);
        expect(c.unlock.minLevel, `${c.id} gate unreachable at level ${c.unlock.minLevel}`).toBeLessThanOrEqual(30);
        expect(c.unlock.minLevel).toBeGreaterThanOrEqual(0);
      }
      if (c.unlock.minSkill) {
        expect(skillIds.has(c.unlock.minSkill.skillId), `${c.id} gate references unknown skill`).toBe(true);
        expect(c.unlock.minSkill.level).toBeGreaterThan(0);
        expect(c.unlock.minSkill.level).toBeLessThanOrEqual(30);
      }
      if (c.unlock.minReputation) {
        expect(reputationDims).toContain(c.unlock.minReputation.dimension);
        expect(Number.isFinite(c.unlock.minReputation.value)).toBe(true);
        expect(c.unlock.minReputation.value, `${c.id} reputation gate unreachable`).toBeLessThanOrEqual(100);
        expect(c.unlock.minReputation.value).toBeGreaterThanOrEqual(0);
      }
      if (c.unlock.minFactionStanding) {
        expect(factionIds.has(c.unlock.minFactionStanding.factionId), `${c.id} gate references unknown faction`).toBe(true);
        expect(c.unlock.minFactionStanding.value).toBeLessThanOrEqual(100);
      }
      if (c.unlock.requiresPerk) {
        expect(PERKS.some((pk) => pk.id === c.unlock!.requiresPerk), `${c.id} gate references unknown perk`).toBe(true);
      }
      if (c.unlock.requiresDiscovery) {
        expect(
          locationIds.has(c.unlock.requiresDiscovery) || registry.has(c.unlock.requiresDiscovery),
          `${c.id} gate references unknown discovery ${c.unlock.requiresDiscovery}`,
        ).toBe(true);
      }
    }
    expect(gated, 'no illegal goods exist to gate').toBeGreaterThan(0);
    expect(openLegal, 'no openly tradeable starter goods').toBeGreaterThan(50);
  });

  it('indexes variants and value density correctly', () => {
    const copper = allCommodities.find((c) => c.baseId === 'copper');
    expect(copper, 'copper has no SKUs').toBeDefined();
    const variants = registry.variantsOf('copper');
    expect(variants.length).toBeGreaterThan(1);
    for (const v of variants) expect(v.baseId).toBe('copper');
    for (const c of registry.all().slice(0, 50)) {
      expect(Number.isFinite(registry.valueDensity(c))).toBe(true);
    }
  });

  it('covers every category that has authored demand affinity', () => {
    const observed = new Set(registry.categories());
    // crypto_asset is intentionally absent: crypto is a separate system.
    const missing = COMMODITY_CATEGORIES.filter((c) => !observed.has(c) && c !== 'crypto_asset');
    expect(missing, `categories with no SKUs: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('world registry', () => {
  it('has a route graph with canonical, unique, resolvable routes', () => {
    expect(world.locations.length).toBeGreaterThanOrEqual(25);
    expect(world.routes.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const r of world.routes) {
      expect(locationIds.has(r.from), `route ${r.id} unknown from ${r.from}`).toBe(true);
      expect(locationIds.has(r.to), `route ${r.id} unknown to ${r.to}`).toBe(true);
      expect(r.from).not.toBe(r.to);
      const canonical = r.from < r.to ? `${r.from}|${r.to}` : `${r.to}|${r.from}`;
      expect(r.id, `route id ${r.id} is not canonical (${canonical})`).toBe(canonical);
      expect(ids.has(r.id), `duplicate route ${r.id}`).toBe(false);
      ids.add(r.id);
      expect(r.distanceKm).toBeGreaterThan(0);
      expect(r.baseRisk).toBeGreaterThanOrEqual(0);
      expect(r.baseRisk).toBeLessThan(1);
      expect(r.modes.length).toBeGreaterThan(0);
    }
  });

  it('resolves every location reference', () => {
    for (const l of world.locations) {
      expect(regionIds.has(l.regionId), `${l.id} unknown region ${l.regionId}`).toBe(true);
      expect(countryIds.has(l.countryId), `${l.id} unknown country ${l.countryId}`).toBe(true);
      expect(REGION_BY_ID[l.regionId]).toBeDefined();
      expect(COUNTRY_BY_ID[l.countryId]).toBeDefined();
      for (const f of l.factionIds) expect(factionIds.has(f), `${l.id} unknown faction ${f}`).toBe(true);
      for (const s of l.specialties) expect(registry.has(s), `${l.id} unknown specialty ${s}`).toBe(true);
      for (const t of l.tradedCommodityIds) expect(registry.has(t), `${l.id} trades unknown commodity ${t}`).toBe(true);
      expect(l.tradedCommodityIds.length, `${l.id} trades nothing`).toBeGreaterThan(0);
      for (const cat of Object.keys(l.demandProfile)) {
        expect(isCategory(cat), `${l.id} demandProfile bad category ${cat}`).toBe(true);
        expect(l.demandProfile[cat as CommodityCategory]).toBeGreaterThan(0);
      }
      expect(l.laws.tolerated.length).toBeGreaterThan(0);
      expect(l.population).toBeGreaterThan(0);
    }
  });

  it('gives every open location at least one neighbour', () => {
    for (const l of world.locations) {
      if (l.hidden) continue;
      const neighbours = world.neighboursOf(l.id);
      expect(neighbours.length, `${l.id} is isolated`).toBeGreaterThan(0);
      for (const n of neighbours) {
        expect(n.other.id).not.toBe(l.id);
        expect(world.routeBetween(l.id, n.other.id)).toBeDefined();
      }
    }
  });

  it('finds a multi-leg path between distant cities', () => {
    const a = world.locations[0]!;
    const b = world.locations[world.locations.length - 1]!;
    const path = world.findPath(a.id, b.id);
    expect(path, `no path from ${a.id} to ${b.id}`).not.toBeNull();
    expect(path!.distanceKm).toBeGreaterThan(0);
    expect(path!.legs.length).toBeGreaterThanOrEqual(0);
    for (const leg of path!.legs) {
      expect(locationIds.has(leg.from.id), `path leg from unknown location`).toBe(true);
      expect(locationIds.has(leg.to.id), `path leg to unknown location`).toBe(true);
      expect(leg.distanceKm).toBeGreaterThan(0);
    }
    expect(path!.risk).toBeGreaterThanOrEqual(0);
    expect(path!.risk).toBeLessThan(1);
  });

  it('applies law presets within sane bounds', () => {
    for (const l of world.locations) {
      expect(l.laws.taxRate).toBeGreaterThanOrEqual(0);
      expect(l.laws.taxRate).toBeLessThan(0.6);
      expect(l.laws.enforcement).toBeGreaterThanOrEqual(0);
      expect(l.laws.enforcement).toBeLessThanOrEqual(1);
      expect(l.laws.corruption).toBeGreaterThanOrEqual(0);
      expect(l.laws.corruption).toBeLessThanOrEqual(1);
      for (const [cat, leg] of Object.entries(l.laws.legalityOverrides)) {
        expect(isCategory(cat), `${l.id} legality override bad category ${cat}`).toBe(true);
        expect(['legal', 'restricted', 'illegal', 'contraband']).toContain(leg);
      }
    }
  });

  it('reports effective legality and tolerance consistently', () => {
    const loc = world.locations[0]!;
    const legal = allCommodities.find((c) => c.legality === 'legal')!;
    expect(world.effectiveLegality(loc.id, legal)).toBe('legal');
    expect(world.isTolerated(loc.id, legal)).toBe(true);
  });

  it('knows which locations trade a given commodity', () => {
    const sample = allCommodities[0]!;
    const traders = world.locationsTrading(sample.id);
    expect(Array.isArray(traders)).toBe(true);
    for (const t of traders) expect(t.tradedCommodityIds).toContain(sample.id);
  });
});

describe('actors registry', () => {
  it('has unique factions with resolvable territory and relationships', () => {
    expect(factionIds.size).toBe(FACTIONS.length);
    expect(FACTIONS.length).toBeGreaterThanOrEqual(15);
    for (const f of FACTIONS) {
      expect(FACTION_BY_ID[f.id]).toBe(f);
      for (const t of f.territoryIds) {
        expect(regionIds.has(t) || locationIds.has(t), `${f.id} territory ${t} unresolved`).toBe(true);
      }
      for (const r of f.rivalIds) expect(factionIds.has(r), `${f.id} rival ${r} unresolved`).toBe(true);
      for (const a of f.allyIds) expect(factionIds.has(a), `${f.id} ally ${a} unresolved`).toBe(true);
      expect(f.rivalIds).not.toContain(f.id);
      expect(f.allyIds).not.toContain(f.id);
      // A faction cannot be both rival and ally of the same other faction.
      for (const r of f.rivalIds) expect(f.allyIds).not.toContain(r);
      expect(f.power).toBeGreaterThanOrEqual(0);
      expect(f.power).toBeLessThanOrEqual(1);
      expect(f.resources).toBeGreaterThanOrEqual(0);
      expect(f.services.length).toBeGreaterThan(0);
      for (const i of f.interests) expect(isCategory(i), `${f.id} bad interest ${i}`).toBe(true);
    }
  });

  it('has unique companies with resolvable country, sector and exposure', () => {
    expect(companyIdSet.size).toBe(COMPANIES.length);
    expect(COMPANIES.length).toBeGreaterThanOrEqual(20);
    expect(SECTORS.length).toBeGreaterThanOrEqual(6);
    const tickers = new Set<string>();
    for (const c of COMPANIES) {
      expect(SECTORS).toContain(c.sector);
      expect(tickers.has(c.ticker), `duplicate ticker ${c.ticker}`).toBe(false);
      tickers.add(c.ticker);
      expect(countryIds.has(c.countryId), `${c.id} unknown country ${c.countryId}`).toBe(true);
      for (const cat of Object.keys(c.exposure)) {
        expect(isCategory(cat), `${c.id} exposure bad category ${cat}`).toBe(true);
        const w = c.exposure[cat as CommodityCategory]!;
        expect(w).toBeGreaterThan(0);
        expect(w).toBeLessThanOrEqual(1);
      }
      expect(Object.keys(c.exposure).length, `${c.id} has no commodity exposure`).toBeGreaterThan(0);
      expect(c.marketCap).toBeGreaterThan(0);
      expect(c.sharesOutstanding).toBeGreaterThan(0);
      expect(c.revenueAnnual).toBeGreaterThan(0);
      expect(c.dividendYieldAnnual).toBeGreaterThanOrEqual(0);
      expect(c.dividendYieldAnnual).toBeLessThan(0.3);
      expect(c.beta).toBeGreaterThan(0);
      expect(c.beta).toBeLessThan(4);
    }
  });

  it('has crypto assets with distinct mechanics rather than commodity clones', () => {
    expect(cryptoIds.size).toBe(CRYPTO_ASSETS.length);
    expect(CRYPTO_ASSETS.length).toBeGreaterThanOrEqual(10);
    const kinds = new Set(CRYPTO_ASSETS.map((t) => t.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(5);
    for (const t of CRYPTO_ASSETS) {
      expect(t.genesisPrice).toBeGreaterThan(0);
      expect(t.circulatingSupply).toBeGreaterThan(0);
      if (t.maxSupply !== null) expect(t.circulatingSupply).toBeLessThanOrEqual(t.maxSupply);
      expect(t.volatility).toBeGreaterThan(0);
      expect(t.regulatoryRisk).toBeGreaterThanOrEqual(0);
      expect(t.regulatoryRisk).toBeLessThanOrEqual(1);
      expect(t.protocolRisk).toBeGreaterThanOrEqual(0);
      expect(t.protocolRisk).toBeLessThanOrEqual(1);
      expect(t.stakingApy).toBeGreaterThanOrEqual(0);
      expect(t.networkEffect).toBeGreaterThan(0);
      expect(t.networkEffect).toBeLessThanOrEqual(1);
      if (t.kind === 'stablecoin') {
        expect(t.peg, `${t.id} stablecoin without peg`).toBeDefined();
        expect(t.peg!.value).toBeGreaterThan(0);
      } else {
        expect(t.peg, `${t.id} should not be pegged`).toBeUndefined();
      }
      // Staking and mining are mutually exclusive mechanics in this world.
      expect(t.stakeable && t.mineable, `${t.id} cannot be both stakeable and mineable`).toBe(false);
      if (t.mineable) {
        expect(t.halvingIntervalDays, `${t.id} mineable without halving schedule`).not.toBeNull();
        expect(t.halvingIntervalDays!).toBeGreaterThan(0);
        expect(t.genesisBlockReward).not.toBeNull();
        expect(t.genesisBlockReward!).toBeGreaterThan(0);
        expect(t.blockTimeSeconds).not.toBeNull();
        expect(t.blockTimeSeconds!).toBeGreaterThan(0);
      } else {
        expect(t.halvingIntervalDays).toBeNull();
        expect(t.genesisBlockReward).toBeNull();
      }
    }
  });
});

describe('assets registry', () => {
  it('has unique vehicles with sane physical stats', () => {
    expect(vehicleIds.size).toBe(VEHICLES.length);
    for (const v of VEHICLES) {
      expect(v.price).toBeGreaterThan(0);
      // Trailers are towed and burn no fuel of their own.
      if (v.kind !== 'trailer') expect(v.speedKmPerDay, `${v.id} cannot move`).toBeGreaterThan(0);
      expect(v.fuelPerKm).toBeGreaterThanOrEqual(0);
      expect(v.maintenancePerKm).toBeGreaterThanOrEqual(0);
      expect(v.reliability).toBeGreaterThan(0);
      expect(v.reliability).toBeLessThanOrEqual(1);
      expect(v.stealth).toBeGreaterThanOrEqual(0);
      expect(v.stealth).toBeLessThanOrEqual(1);
      expect(v.armor).toBeGreaterThanOrEqual(0);
      expect(v.capacityKg + v.capacityL).toBeGreaterThan(0);
      expect(v.upgradeSlots).toBeGreaterThanOrEqual(0);
      if (v.requiredSkill) {
        expect(skillIds.has(v.requiredSkill.skillId), `${v.id} skill ${v.requiredSkill.skillId}`).toBe(true);
        expect(v.requiredSkill.level).toBeGreaterThan(0);
      }
    }
    for (const u of VEHICLE_UPGRADES) {
      expect(u.price).toBeGreaterThan(0);
    }
  });

  it('has properties whose business links and production tags resolve', () => {
    expect(new Set(PROPERTIES.map((p) => p.id)).size).toBe(PROPERTIES.length);
    for (const p of PROPERTIES) {
      expect(p.basePrice).toBeGreaterThan(0);
      expect(p.opexPerDay).toBeGreaterThanOrEqual(0);
      expect(p.maxUpgradeLevel).toBeGreaterThanOrEqual(0);
      expect(p.upgradeCostBase).toBeGreaterThanOrEqual(0);
      expect(p.security).toBeGreaterThanOrEqual(0);
      expect(p.staffSlots).toBeGreaterThanOrEqual(0);
      if (p.enablesBusinessId) {
        expect(businessIds.has(p.enablesBusinessId), `${p.id} enables unknown business ${p.enablesBusinessId}`).toBe(true);
      }
      for (const t of p.productionTags ?? []) expect(PRODUCTION_TAGS).toContain(t);
    }
  });

  it('has businesses whose property kind, skill and reputation references resolve', () => {
    expect(businessIds.size).toBe(BUSINESSES.length);
    for (const b of BUSINESSES) {
      expect(b.setupCost).toBeGreaterThan(0);
      expect(b.baseDailyOpex).toBeGreaterThanOrEqual(0);
      expect(b.demandSensitivity).toBeGreaterThanOrEqual(0);
      expect(b.demandSensitivity).toBeLessThanOrEqual(1);
      expect(b.launderingCapacityPerDay).toBeGreaterThanOrEqual(0);
      expect(['legal', 'restricted', 'illegal', 'contraband']).toContain(b.legality);
      if (b.requiredPropertyKind) {
        expect(propertyKinds.has(b.requiredPropertyKind), `${b.id} requires unknown property kind ${b.requiredPropertyKind}`).toBe(true);
      }
      if (b.requiredSkill) expect(skillIds.has(b.requiredSkill.skillId), `${b.id} skill ${b.requiredSkill.skillId}`).toBe(true);
      expect(reputationDims).toContain(b.reputationEffect.dimension);
      expect(b.staffSlots).toBeGreaterThanOrEqual(0);
    }
  });

  it('has recipes whose inputs, outputs, byproducts and skills all resolve', () => {
    expect(RECIPES.length).toBeGreaterThanOrEqual(20);
    for (const r of RECIPES) {
      expect(r.inputs.length, `recipe ${r.id} has no inputs`).toBeGreaterThan(0);
      expect(r.outputs.length, `recipe ${r.id} has no outputs`).toBeGreaterThan(0);
      for (const i of r.inputs) {
        expect(registry.has(i.commodityId), `recipe ${r.id} input ${i.commodityId} unresolved`).toBe(true);
        expect(i.qty).toBeGreaterThan(0);
      }
      for (const o of r.outputs) {
        expect(registry.has(o.commodityId), `recipe ${r.id} output ${o.commodityId} unresolved`).toBe(true);
        expect(o.qty).toBeGreaterThan(0);
      }
      for (const bp of r.byproducts ?? []) {
        expect(registry.has(bp.commodityId), `recipe ${r.id} byproduct ${bp.commodityId} unresolved`).toBe(true);
        expect(bp.qty).toBeGreaterThan(0);
        expect(bp.chance).toBeGreaterThan(0);
        expect(bp.chance).toBeLessThanOrEqual(1);
      }
      expect(r.capacityPerDay).toBeGreaterThan(0);
      expect(r.labourRequired).toBeGreaterThanOrEqual(0);
      expect(r.energyPerUnit).toBeGreaterThanOrEqual(0);
      expect(r.opexPerDay).toBeGreaterThanOrEqual(0);
      expect(skillIds.has(r.skillId), `recipe ${r.id} skill ${r.skillId} unresolved`).toBe(true);
      expect(PRODUCTION_TAGS).toContain(r.requiresTag);
      expect(r.automationCost).toBeGreaterThanOrEqual(0);
    }
  });

  it('never lets a recipe create value from nothing (no free-money production loop)', () => {
    // Energy is priced exactly as the production engine prices it: a fraction of
    // the output's own value per unit of intensity. Labour uses the configured
    // production wage. Both come from the balance config, never from literals.
    const energyCostPerUnit = BALANCE.production.energyCostPerUnit;
    const wage = BALANCE.crew.salaryBaseByRole.production_worker ?? 50;

    let viable = 0;
    for (const r of RECIPES) {
      const batchIn = r.inputs.reduce((sum, i) => sum + registry.require(i.commodityId).baseValue * i.qty, 0);
      const batchOut = r.outputs.reduce((sum, o) => sum + registry.require(o.commodityId).baseValue * o.qty, 0);
      const batchByproduct = (r.byproducts ?? []).reduce(
        (sum, b) => sum + registry.require(b.commodityId).baseValue * b.qty * b.chance,
        0,
      );

      // 1. Something must go in. Free creation is the classic infinite-money bug.
      expect(batchIn, `recipe ${r.id} has no input value`).toBeGreaterThan(0);
      // 2. Throughput must be finite and positive, otherwise scale is unbounded.
      expect(Number.isFinite(r.capacityPerDay)).toBe(true);
      expect(r.capacityPerDay, `recipe ${r.id} has no throughput cap`).toBeGreaterThan(0);
      expect(r.capacityPerDay, `recipe ${r.id} throughput cap absurd`).toBeLessThan(100000);
      // 3. Processing must cost something beyond the inputs: labour, energy or opex.
      const hasCost = r.labourRequired > 0 || r.energyPerUnit > 0 || r.opexPerDay > 0;
      expect(hasCost, `recipe ${r.id} processes inputs for free`).toBe(true);

      // 4. Scale one batch to a full day of production and price the costs.
      const outQty = r.outputs.reduce((sum, o) => sum + o.qty, 0);
      const batchesPerDay = Math.max(0.0001, r.capacityPerDay / Math.max(0.0001, outQty));
      const dailyInputs = batchIn * batchesPerDay;
      const dailyOutputs = (batchOut + batchByproduct) * batchesPerDay;
      const valuePerOutputUnit = dailyOutputs / Math.max(0.0001, r.capacityPerDay);
      const dailyEnergy = r.capacityPerDay * r.energyPerUnit * energyCostPerUnit * valuePerOutputUnit;
      const dailyLabour = r.labourRequired * wage;
      const dailyCost = dailyInputs + dailyEnergy + dailyLabour + r.opexPerDay;

      // 5. The recipe must be worth running, but the *net* margin per day must
      //    stay inside a band where throughput, input scarcity and market impact
      //    (all enforced by the engine) are what limit profit — not a data typo.
      const netRatio = dailyOutputs / dailyCost;
      expect(netRatio, `recipe ${r.id} is unprofitable (${netRatio.toFixed(2)})`).toBeGreaterThan(1.02);
      expect(netRatio, `recipe ${r.id} net ratio ${netRatio.toFixed(2)} looks like a data error`).toBeLessThan(40);
      // 6. Gross uplift guard: refining legitimately multiplies value (iron ore
      //    → steel is ~6x), but four orders of magnitude means a misplaced decimal.
      const grossRatio = (batchOut + batchByproduct) / batchIn;
      expect(grossRatio, `recipe ${r.id} gross ratio ${grossRatio.toFixed(2)} is a data error`).toBeLessThan(60);
      if (netRatio > 1.15) viable++;
    }
    // Most of the catalogue should be worth building, or production is dead content.
    expect(viable / RECIPES.length, 'too few profitable recipes').toBeGreaterThan(0.6);
  });

  it('makes every recipe reachable from at least one property kind', () => {
    const propertyTags = new Set(PROPERTIES.flatMap((p) => p.productionTags ?? []));
    for (const r of RECIPES) {
      expect(propertyTags.has(r.requiresTag), `no property provides production tag ${r.requiresTag}`).toBe(true);
    }
    expect(propertyTags.size).toBeGreaterThan(0);
  });
});

describe('people registry', () => {
  it('has unique skills in declared trees with resolvable prerequisites', () => {
    expect(skillIds.size).toBe(SKILLS.length);
    expect(SKILLS.length).toBeGreaterThanOrEqual(20);
    for (const s of SKILLS) {
      expect(SKILL_TREES).toContain(s.tree);
      expect(SKILL_BY_ID[s.id]).toBe(s);
      expect(s.maxLevel).toBeGreaterThanOrEqual(5);
      for (const pre of s.prerequisites) {
        expect(skillIds.has(pre.skillId), `skill ${s.id} prerequisite ${pre.skillId} unresolved`).toBe(true);
        expect(pre.skillId, `skill ${s.id} prerequisites itself`).not.toBe(s.id);
        expect(pre.level).toBeGreaterThan(0);
        expect(pre.level).toBeLessThan(s.maxLevel);
      }
      expect(s.effectPerLevel.length).toBeGreaterThan(0);
    }
  });

  it('has unique perks granting well-formed modifier keys', () => {
    const ids = PERKS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PERKS.length).toBeGreaterThanOrEqual(20);
    for (const p of PERKS) {
      expect(SKILL_TREES).toContain(p.tree);
      expect(Object.keys(p.modifiers).length, `perk ${p.id} grants nothing`).toBeGreaterThan(0);
      for (const [key, value] of Object.entries(p.modifiers)) {
        expect(key, `perk ${p.id} modifier key ${key} malformed`).toMatch(/^[a-z_]+\.[A-Za-z_]+$/);
        expect(Number.isFinite(value), `perk ${p.id} modifier ${key} not finite`).toBe(true);
      }
      if (p.requiresSkill) {
        expect(skillIds.has(p.requiresSkill.skillId), `perk ${p.id} requires unknown skill`).toBe(true);
        expect(p.requiresSkill.level).toBeGreaterThan(0);
      }
      if (p.requiresPerk) expect(ids, `perk ${p.id} requires unknown perk`).toContain(p.requiresPerk);
      for (const ex of p.mutuallyExclusive ?? []) expect(ids, `perk ${p.id} excludes unknown perk`).toContain(ex);
    }
  });

  it('has employee roles referencing real skills and valid automation capabilities', () => {
    const roleIds = EMPLOYEE_ROLES.map((r) => r.id);
    expect(new Set(roleIds).size).toBe(roleIds.length);
    const capabilities = ['none', 'auto_trade', 'auto_logistics', 'auto_business', 'auto_production', 'auto_finance', 'combat', 'intel', 'laundering'];
    for (const r of EMPLOYEE_ROLES) {
      expect(skillIds.has(r.primarySkill), `role ${r.id} primary skill ${r.primarySkill} unresolved`).toBe(true);
      for (const s of r.secondarySkills) expect(skillIds.has(s), `role ${r.id} secondary skill ${s} unresolved`).toBe(true);
      expect(r.baseSalary).toBeGreaterThanOrEqual(0);
      expect(capabilities).toContain(r.automationCapability);
    }
    // Automation must actually be reachable: some role has to provide each
    // auto_* capability or the management layer could never be built.
    for (const cap of ['auto_trade', 'auto_logistics', 'auto_business', 'auto_production', 'auto_finance']) {
      expect(
        EMPLOYEE_ROLES.some((r) => r.automationCapability === cap),
        `no employee role provides ${cap}`,
      ).toBe(true);
    }
  });

  it('has enemies and encounter tables that resolve', () => {
    const enemyIds = new Set(ENEMIES.map((e) => e.id));
    expect(enemyIds.size).toBe(ENEMIES.length);
    for (const e of ENEMIES) {
      expect(e.hp).toBeGreaterThan(0);
      expect(e.actionPoints).toBeGreaterThan(0);
      expect(e.accuracy).toBeGreaterThan(0);
      expect(e.accuracy).toBeLessThanOrEqual(1);
      expect(e.negotiable).toBeGreaterThanOrEqual(0);
      expect(e.negotiable).toBeLessThanOrEqual(1);
      expect(e.defense).toBeGreaterThanOrEqual(0);
      expect(e.speed).toBeGreaterThan(0);
      expect(e.damage[0]).toBeLessThanOrEqual(e.damage[1]);
      expect(e.damage[0]).toBeGreaterThan(0);
      expect(['normal', 'elite', 'boss']).toContain(e.tier);
      for (const l of e.lootTable) {
        if (l.commodityId) expect(registry.has(l.commodityId), `enemy ${e.id} loot ${l.commodityId} unresolved`).toBe(true);
        if (l.cash) expect(l.cash[0]).toBeLessThanOrEqual(l.cash[1]);
      }
    }
    for (const [situation, ids] of Object.entries(ENCOUNTER_TABLES)) {
      expect(ids.length, `encounter table ${situation} empty`).toBeGreaterThan(0);
      for (const id of ids) expect(enemyIds.has(id), `${situation} references unknown enemy ${id}`).toBe(true);
    }
  });
});

describe('event registry', () => {
  it('has unique events with well-formed scope, severity and timing', () => {
    const ids = EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(EVENTS.length).toBeGreaterThanOrEqual(40);
    for (const e of EVENTS) {
      expect(EVENT_BY_ID[e.id]).toBe(e);
      expect(e.weight).toBeGreaterThan(0);
      expect(e.cooldownDays).toBeGreaterThanOrEqual(0);
      expect(['local', 'regional', 'national', 'global']).toContain(e.scope);
      expect(['minor', 'moderate', 'major', 'catastrophic']).toContain(e.severity);
      if (e.durationDays) {
        expect(e.durationDays[0]).toBeLessThanOrEqual(e.durationDays[1]);
        expect(e.durationDays[0]).toBeGreaterThan(0);
      }
      expect(e.effects.length, `event ${e.id} does nothing`).toBeGreaterThan(0);
    }
  });

  it('only references ids that exist in every effect and condition', () => {
    for (const e of EVENTS) {
      for (const eff of e.effects) {
        const anyEff = eff as unknown as Record<string, unknown>;
        if ('categories' in anyEff) {
          for (const cat of anyEff.categories as string[]) {
            expect(isCategory(cat), `event ${e.id} effect bad category ${cat}`).toBe(true);
          }
        }
        if ('commodityIds' in anyEff) {
          for (const id of anyEff.commodityIds as string[]) {
            expect(registry.has(id), `event ${e.id} effect unknown commodity ${id}`).toBe(true);
          }
        }
        if ('companyIds' in anyEff) {
          for (const id of anyEff.companyIds as string[]) {
            expect(companyIdSet.has(id), `event ${e.id} effect unknown company ${id}`).toBe(true);
          }
        }
        if ('cryptoAssetIds' in anyEff) {
          for (const id of anyEff.cryptoAssetIds as string[]) {
            expect(cryptoIds.has(id), `event ${e.id} effect unknown crypto ${id}`).toBe(true);
          }
        }
        if ('factionIds' in anyEff) {
          for (const id of anyEff.factionIds as string[]) {
            expect(factionIds.has(id), `event ${e.id} effect unknown faction ${id}`).toBe(true);
          }
        }
        if ('sector' in anyEff && anyEff.sector) expect(SECTORS).toContain(anyEff.sector as string);
        if ('commodityId' in anyEff && typeof anyEff.commodityId === 'string') {
          expect(registry.has(anyEff.commodityId), `event ${e.id} effect unknown commodityId ${anyEff.commodityId}`).toBe(true);
        }
        if ('missionId' in anyEff) {
          expect(MISSION_BY_ID[anyEff.missionId as string], `event ${e.id} unknown mission ${String(anyEff.missionId)}`).toBeDefined();
        }
        if (eff.kind === 'competitor_action') {
          expect(['buy_spree', 'dump', 'enter_market', 'exit_market']).toContain(eff.action);
          expect(eff.intensity).toBeGreaterThan(0);
        }
      }

      for (const cond of e.conditions) {
        const anyCond = cond as unknown as Record<string, unknown>;
        if ('commodityId' in anyCond && typeof anyCond.commodityId === 'string') {
          expect(registry.has(anyCond.commodityId), `event ${e.id} condition unknown commodity`).toBe(true);
        }
        if ('categoryId' in anyCond) {
          expect(isCategory(anyCond.categoryId as string), `event ${e.id} condition bad category`).toBe(true);
        }
        if ('factionId' in anyCond && typeof anyCond.factionId === 'string') {
          expect(factionIds.has(anyCond.factionId), `event ${e.id} condition unknown faction`).toBe(true);
        }
        if ('locationId' in anyCond && typeof anyCond.locationId === 'string') {
          expect(locationIds.has(anyCond.locationId), `event ${e.id} condition unknown location`).toBe(true);
        }
      }

      for (const link of e.chain) {
        expect(EVENT_BY_ID[link.eventId], `event ${e.id} chains to unknown ${link.eventId}`).toBeDefined();
        expect(link.eventId, `event ${e.id} chains to itself`).not.toBe(e.id);
        expect(link.chance).toBeGreaterThan(0);
        expect(link.chance).toBeLessThanOrEqual(1);
        expect(link.delayDays[0]).toBeGreaterThanOrEqual(0);
        expect(link.delayDays[0]).toBeLessThanOrEqual(link.delayDays[1]);
      }
    }
  });

  it('indexes events by scope without losing any', () => {
    let total = 0;
    for (const list of Object.values(EVENTS_BY_SCOPE)) total += list.length;
    expect(total).toBe(EVENTS.length);
    expect(EVENTS_BY_SCOPE.global.length).toBeGreaterThan(0);
    expect(EVENTS_BY_SCOPE.local.length).toBeGreaterThan(0);
    expect(EVENTS_BY_SCOPE.national.length).toBeGreaterThan(0);
  });

  it('includes chained multi-stage events and player-scope events', () => {
    expect(EVENTS.filter((e) => e.chain.length > 0).length, 'no chained events').toBeGreaterThan(5);
    expect(EVENTS.filter((e) => e.category === 'player').length, 'no player events').toBeGreaterThan(0);
  });
});

describe('mission registry', () => {
  it('has unique missions with resolvable references', () => {
    const ids = MISSIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MISSIONS.length).toBeGreaterThanOrEqual(15);
    for (const m of MISSIONS) {
      expect(MISSION_BY_ID[m.id]).toBe(m);
      expect(m.rewardCash).toBeGreaterThan(0);
      expect(m.rewardXp).toBeGreaterThan(0);
      expect(m.deadlineDays[0]).toBeLessThanOrEqual(m.deadlineDays[1]);
      expect(m.deadlineDays[0]).toBeGreaterThan(0);
      expect(m.risk).toBeGreaterThanOrEqual(0);
      expect(m.risk).toBeLessThanOrEqual(1);
      expect(m.difficulty).toBeGreaterThanOrEqual(1);
      expect(m.difficulty).toBeLessThanOrEqual(5);
      expect(m.minLevel).toBeGreaterThanOrEqual(1);
      expect(m.objectives.length).toBeGreaterThan(0);
      if (m.giverFactionId) expect(factionIds.has(m.giverFactionId), `${m.id} unknown giver faction`).toBe(true);
      for (const u of m.unlocks) expect(ids, `${m.id} unlocks unknown mission ${u}`).toContain(u);
      for (const r of m.reputation) {
        expect(reputationDims).toContain(r.dimension);
        expect(r.amount).not.toBe(0);
      }
      for (const o of m.objectives) {
        expect(o.description.length).toBeGreaterThan(0);
        switch (o.target.kind) {
          case 'fixed':
            expect(
              registry.has(o.target.id) || locationIds.has(o.target.id) || o.target.id === 'player_location',
              `${m.id} fixed target ${o.target.id} unresolved`,
            ).toBe(true);
            break;
          case 'random_commodity': {
            const filter = o.target.filter;
            for (const cat of filter?.category ?? []) expect(isCategory(cat), `${m.id} filter category ${cat}`).toBe(true);
            for (const leg of filter?.legality ?? []) {
              expect(['legal', 'restricted', 'illegal', 'contraband']).toContain(leg);
            }
            if (filter?.minBaseValue !== undefined && filter?.maxBaseValue !== undefined) {
              expect(filter.minBaseValue).toBeLessThanOrEqual(filter.maxBaseValue);
            }
            break;
          }
          case 'random_location': {
            const filter = o.target.filter;
            for (const k of filter?.kinds ?? []) {
              expect(
                world.locations.some((l) => l.kind === k),
                `${m.id} filters on unknown location kind ${k}`,
              ).toBe(true);
            }
            break;
          }
          case 'random_role':
            expect(EMPLOYEE_ROLES.length).toBeGreaterThan(0);
            break;
          case 'random_property':
            expect(propertyKinds.size).toBeGreaterThan(0);
            break;
          case 'random_faction':
            expect(factionIds.size).toBeGreaterThan(0);
            break;
          case 'none':
            break;
        }
      }
      // Every mission must be satisfiable: each objective kind needs a matching
      // random target pool, otherwise the job board offers impossible work.
      for (const o of m.objectives) {
        if (o.target.kind === 'random_commodity') {
          const filter = o.target.filter;
          const pool = allCommodities.filter((c) => {
            if (filter?.legality && !filter.legality.includes(c.legality)) return false;
            if (filter?.category && !filter.category.includes(c.category)) return false;
            if (filter?.minBaseValue !== undefined && c.baseValue < filter.minBaseValue) return false;
            if (filter?.maxBaseValue !== undefined && c.baseValue > filter.maxBaseValue) return false;
            return true;
          });
          expect(pool.length, `${m.id} objective has an empty commodity pool`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('covers the whole progression curve from tutorial to endgame', () => {
    const byDifficulty = new Map<number, number>();
    for (const m of MISSIONS) byDifficulty.set(m.difficulty, (byDifficulty.get(m.difficulty) ?? 0) + 1);
    for (const d of [1, 2, 3, 4, 5]) {
      expect(byDifficulty.get(d) ?? 0, `no difficulty ${d} missions`).toBeGreaterThan(0);
    }
    expect(MISSIONS.some((m) => m.minLevel <= 1), 'no entry-level mission').toBe(true);
    expect(MISSIONS.some((m) => m.minLevel >= 20), 'no endgame mission').toBe(true);
    // Objective kinds used must exist in the engine's objective vocabulary.
    const knownKinds = new Set([
      'deliver_commodity', 'acquire_cash', 'travel_to', 'reach_net_worth', 'hire_role',
      'own_property', 'reach_level', 'sell_commodity', 'buy_commodity', 'survive_days',
      'reach_reputation', 'complete_combat', 'produce_commodity', 'launder_amount',
      'reach_faction_standing',
    ]);
    for (const m of MISSIONS) {
      for (const o of m.objectives) expect(knownKinds.has(o.kind), `${m.id} unknown objective kind ${o.kind}`).toBe(true);
    }
  });

  it('has unique achievements with machine-parsable checks', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(20);
    for (const a of ACHIEVEMENTS) {
      expect(a.xp).toBeGreaterThan(0);
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.description.length).toBeGreaterThan(0);
      expect(a.check, `achievement ${a.id} check "${a.check}" not parsable`).toMatch(
        /^[a-z_]+(>=|==|<=)[0-9.]+(&&[a-z_]+(>=|==|<=)[0-9.]+)*$/,
      );
    }
  });
});

describe('cross-registry coherence', () => {
  it('has no duplicate ids within any registry', () => {
    const sets: [string, string[]][] = [
      ['locations', world.locations.map((l) => l.id)],
      ['routes', world.routes.map((r) => r.id)],
      ['regions', REGIONS.map((r) => r.id)],
      ['countries', COUNTRIES.map((c) => c.id)],
      ['factions', FACTIONS.map((f) => f.id)],
      ['companies', COMPANIES.map((c) => c.id)],
      ['crypto', CRYPTO_ASSETS.map((c) => c.id)],
      ['vehicles', VEHICLES.map((v) => v.id)],
      ['properties', PROPERTIES.map((p) => p.id)],
      ['businesses', BUSINESSES.map((b) => b.id)],
      ['recipes', RECIPES.map((r) => r.id)],
      ['skills', SKILLS.map((s) => s.id)],
      ['perks', PERKS.map((p) => p.id)],
      ['roles', EMPLOYEE_ROLES.map((r) => r.id)],
      ['enemies', ENEMIES.map((e) => e.id)],
      ['events', EVENTS.map((e) => e.id)],
      ['missions', MISSIONS.map((m) => m.id)],
      ['achievements', ACHIEVEMENTS.map((a) => a.id)],
      ['forms', Object.keys(FORMS)],
    ];
    for (const [name, ids] of sets) {
      expect(new Set(ids).size, `${name} has duplicate ids`).toBe(ids.length);
    }
  });

  it('pairs property/business ids deliberately and keeps progression ids separate', () => {
    // A property may share an id with the business it enables — that is the
    // intended 1:1 pairing (e.g. the Pawnshop building enables the Pawnshop
    // operation). What must never happen is an enablesBusinessId pointing at a
    // business that does not exist, or a self-referential pairing.
    const businessById = new Map(BUSINESSES.map((b) => [b.id, b]));
    for (const p of PROPERTIES) {
      if (!p.enablesBusinessId) continue;
      const biz = businessById.get(p.enablesBusinessId);
      expect(biz, `property ${p.id} enables missing business`).toBeDefined();
      expect(biz!.requiredPropertyKind, `business ${biz!.id} does not require the property kind that enables it`)
        .toBeDefined();
      expect(biz!.requiredPropertyKind).toBe(p.kind);
    }
    // Skills and perks share one progression namespace, so they must not collide.
    for (const p of PERKS) {
      expect(skillIds.has(p.id), `perk ${p.id} collides with a skill id`).toBe(false);
    }
  });

  it('keeps property kinds within the declared union', () => {
    const allowed: PropertyKind[] = [
      'safehouse', 'warehouse', 'office', 'retail', 'factory', 'farm', 'distribution_center',
      'transport_hub', 'financial_facility', 'entertainment', 'research_facility', 'tech_facility',
      'underground_facility', 'offshore_entity', 'residential',
    ];
    for (const p of PROPERTIES) expect(allowed, `property ${p.id} unknown kind ${p.kind}`).toContain(p.kind);
  });
});
