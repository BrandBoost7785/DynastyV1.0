/**
 * CommodityRegistry — the data-driven catalogue of every tradeable good.
 *
 * Expansion model: `base good × form` → SKU. Roughly 175 curated bases and
 * ~3 forms each yields 500+ distinct commodities with coherent values,
 * weights, legalities and demand profiles, while remaining fully authored and
 * reviewable at the base level.
 *
 * Everything here is deterministic: the registry is built once at module load
 * from static data plus a seeded RNG, so every process (client, server, test)
 * sees an identical world.
 */

import { Rng } from '../rng';
import type {
  CommodityCategory,
  CommodityDef,
  Legality,
  MarketType,
  StorageRequirement,
  UnlockCondition,
} from '../../sim/types';
import { BASE_COMMODITIES_A, type BaseCommodity, type FormId } from './basesA';
import { BASE_COMMODITIES_B, BASE_COMMODITIES_C } from './basesB';
import { FORMS, mostSevereLegality } from './forms';
import { ARCHETYPE_DEMAND, REGION_BY_ID, REGIONS } from './regions';

export const ALL_BASE_COMMODITIES: BaseCommodity[] = [
  ...BASE_COMMODITIES_A,
  ...BASE_COMMODITIES_B,
  ...BASE_COMMODITIES_C,
];

/**
 * How strongly each commodity category is demanded by each regional economic
 * archetype. This is what makes geographic specialisation and arbitrage real:
 * luxuries clear in financial centres, weapons in conflict zones, staples in
 * agricultural regions.
 */
const CATEGORY_AFFINITY: Record<CommodityCategory, Partial<Record<keyof typeof ARCHETYPE_DEMAND, number>>> = {
  agriculture: { agricultural: 1.35, emerging: 1.15, remote: 0.7, financial: 0.8 },
  livestock: { agricultural: 1.4, emerging: 1.2, remote: 0.8, financial: 0.85 },
  foodstuff: { emerging: 1.3, agricultural: 1.15, conflict: 1.4, remote: 1.2, financial: 0.9 },
  beverage: { financial: 1.25, industrial: 1.1, offshore: 1.2, conflict: 0.7 },
  textile: { manufacturing: 1.4, emerging: 1.2, financial: 1.05, resource: 0.8 },
  raw_material: { manufacturing: 1.45, industrial: 1.3, resource: 1.15, financial: 0.6, remote: 0.9 },
  metal: { manufacturing: 1.4, industrial: 1.35, financial: 1.1, resource: 1.05 },
  energy: { industrial: 1.35, resource: 1.25, manufacturing: 1.3, transit: 1.2, remote: 1.1 },
  chemical: { manufacturing: 1.4, industrial: 1.3, agricultural: 1.15 },
  pharmaceutical: { financial: 1.2, industrial: 1.15, emerging: 1.25, conflict: 1.3, offshore: 1.1 },
  narcotic: { transit: 1.6, offshore: 1.5, conflict: 1.5, financial: 1.25, industrial: 1.1, agricultural: 0.75 },
  medical: { financial: 1.2, emerging: 1.3, conflict: 1.45, industrial: 1.1 },
  manufactured: { manufacturing: 1.3, industrial: 1.35, emerging: 1.2, resource: 1.1 },
  electronics: { industrial: 1.3, financial: 1.35, manufacturing: 1.25, emerging: 1.2, offshore: 1.1 },
  technology: { financial: 1.45, industrial: 1.4, manufacturing: 1.3, remote: 0.6, agricultural: 0.6 },
  luxury: { financial: 1.7, offshore: 1.6, industrial: 1.1, conflict: 0.45, emerging: 0.8, agricultural: 0.7 },
  art: { financial: 1.6, offshore: 1.45, industrial: 1.05, conflict: 0.5 },
  weapon: { conflict: 2.1, transit: 1.4, resource: 1.25, offshore: 1.2, emerging: 1.2, financial: 0.75 },
  equipment: { conflict: 1.5, transit: 1.35, industrial: 1.2, remote: 1.3, offshore: 1.25 },
  vehicle_part: { industrial: 1.3, manufacturing: 1.35, transit: 1.3, emerging: 1.25 },
  construction: { emerging: 1.5, industrial: 1.3, manufacturing: 1.25, resource: 1.2, financial: 0.85 },
  industrial: { manufacturing: 1.4, industrial: 1.4, resource: 1.3, transit: 1.1 },
  information: { financial: 1.7, offshore: 1.5, industrial: 1.25, conflict: 1.2 },
  financial_asset: { financial: 1.9, offshore: 1.8, industrial: 1.0, emerging: 0.7 },
  crypto_asset: { financial: 1.5, offshore: 1.6, industrial: 1.2 },
  contraband_misc: { transit: 1.6, offshore: 1.55, conflict: 1.5, emerging: 1.3, financial: 1.05 },
};

/**
 * Every commodity category, derived from the exhaustive `CATEGORY_AFFINITY`
 * record above. Because that record is typed `Record<CommodityCategory, …>`,
 * TypeScript fails to compile if it ever drifts from the union — so this list
 * is a compile-time-guaranteed, runtime-available enumeration used by
 * validation tests, event effects and UI filters.
 */
export const COMMODITY_CATEGORIES: readonly CommodityCategory[] = Object.freeze(
  Object.keys(CATEGORY_AFFINITY) as CommodityCategory[],
);

/** Categories that actually have tradeable SKUs (crypto is a separate system). */
export const TRADED_CATEGORIES: readonly CommodityCategory[] = Object.freeze(
  COMMODITY_CATEGORIES.filter((c) => c !== 'crypto_asset'),
);

const FORCE_REFRIGERATED_FORMS: FormId[] = ['frozen', 'fresh'];
const FORCE_SECURE_TAGS = ['high_value', 'ultra_high_value', 'store_of_value', 'precious'];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function round(v: number, decimals: number): number {
  const m = 10 ** decimals;
  return Math.round(v * m) / m;
}

function storageFor(base: BaseCommodity, tags: string[], valueDensity: number): StorageRequirement {
  if (FORCE_REFRIGERATED_FORMS.some((f) => tags.includes(`form:${f}`))) return 'refrigerated';
  if (base.storage === 'refrigerated') return 'refrigerated';
  if (base.storage === 'hazardous' || tags.includes('hazmat')) return 'hazardous';
  if (base.storage === 'secure' || FORCE_SECURE_TAGS.some((t) => tags.includes(t))) return 'secure';
  if (valueDensity > 12000) return 'secure';
  if (base.storage === 'climate') return 'climate';
  return 'none';
}

function unlockFor(def: {
  legality: Legality;
  risk: number;
  rarity: number;
  marketTypes: MarketType[];
  category: CommodityCategory;
}): UnlockCondition | undefined {
  const unlock: UnlockCondition = {};
  let needed = false;

  if (def.legality === 'contraband' || def.risk >= 0.9) {
    unlock.minLevel = 8;
    unlock.minReputation = { dimension: 'criminal', value: 15 };
    needed = true;
  } else if (def.legality === 'illegal' || def.risk >= 0.7) {
    unlock.minLevel = 4;
    unlock.minReputation = { dimension: 'criminal', value: 5 };
    needed = true;
  } else if (def.rarity >= 5) {
    unlock.minLevel = 5;
    needed = true;
  } else if (def.rarity === 4) {
    unlock.minLevel = 2;
    needed = true;
  }

  if (def.marketTypes.includes('darknet') && !unlock.minReputation) {
    unlock.minReputation = { dimension: 'underground', value: 10 };
    needed = true;
  }
  if (def.category === 'financial_asset') {
    unlock.minLevel = 3;
    needed = true;
  }
  return needed ? unlock : undefined;
}

function buildCommodities(): CommodityDef[] {
  const out: CommodityDef[] = [];
  const seen = new Set<string>();

  for (const base of ALL_BASE_COMMODITIES) {
    for (const formId of base.forms) {
      const form = FORMS[formId];
      const id = `${base.id}__${formId}`;
      if (seen.has(id)) continue;
      seen.add(id);

      const rng = new Rng(`commodity:${id}`, 'commodity-gen');

      const baseValue = (round(base.baseValue * (base.formValueOverrides?.[formId] ?? form.valueMul), base.baseValue * (base.formValueOverrides?.[formId] ?? form.valueMul) > 1000 ? 0 : 2));
      const weightKg = round(base.weightKg * form.weightMul, base.weightKg * form.weightMul >= 10 ? 1 : 3);
      const volumeL = round(base.volumeL * form.volumeMul, base.volumeL * form.volumeMul >= 10 ? 1 : 3);
      const valueDensity = weightKg > 0 ? baseValue / weightKg : baseValue;

      const legality = mostSevereLegality(base.legality, form.legalityFloor);
      const risk = clamp(base.risk + form.riskShift, 0, 0.99);
      const rarity = clamp(base.rarity + form.rarityShift, 1, 5) as 1 | 2 | 3 | 4 | 5;
      const volatility = clamp(base.volatility * form.volatilityMul, 0.03, 0.9);
      const availability = clamp(base.availability * form.availabilityMul, 0.02, 0.99);
      const elasticity = clamp(base.elasticity * form.elasticityMul, 0.05, 1.6);
      const baseDemand = round(
        Math.max(0.4, base.baseDemand * form.demandMul * (1 + (5 - rarity) * 0.04)),
        2,
      );

      const shelfLifeDays =
        base.shelfLifeDays === null
          ? null
          : form.shelfLifeMul === 0
            ? null
            : Math.max(1, Math.round(base.shelfLifeDays * form.shelfLifeMul));

      const marketTypes: MarketType[] = form.marketTypeOverride
        ? [...form.marketTypeOverride]
        : legality === 'legal'
          ? base.marketTypes.length > 0
            ? [...base.marketTypes]
            : ['public']
          : base.marketTypes.filter((m) => m !== 'public' && m !== 'licensed').length > 0
            ? base.marketTypes.filter((m) => m !== 'public')
            : ['black'];

      // Legality can escalate a restricted good into black-market-only trade.
      if (legality === 'illegal' || legality === 'contraband') {
        if (!marketTypes.includes('black')) marketTypes.push('black');
        const publicIdx = marketTypes.indexOf('public');
        if (publicIdx >= 0 && legality === 'contraband') marketTypes.splice(publicIdx, 1);
      }

      const tags = Array.from(new Set([...base.tags, ...form.tags, `form:${formId}`, `base:${base.id}`]));

      const name = form.prefix
        ? `${form.prefix} ${base.name}`
        : form.suffix
          ? `${base.name} ${form.suffix}`
          : base.name;

      const storage = storageFor(base, tags, valueDensity);

      // ---- regional preference -------------------------------------------
      const affinityMap = CATEGORY_AFFINITY[base.category] ?? {};
      const regionalPreference: Record<string, number> = {};
      for (const region of REGIONS) {
        const archetype = region.archetype as keyof typeof ARCHETYPE_DEMAND;
        const archetypeDemand = ARCHETYPE_DEMAND[archetype] ?? 1;
        const categoryAffinity = affinityMap[archetype] ?? 1;
        const originBonus = base.regions?.includes(region.id) ? 1.5 : 1;
        // Wealthy regions absorb luxuries; poor regions absorb staples. This is
        // already encoded in archetype demand, but scarcity goods invert it.
        const scarcityAdjust = rarity >= 4 ? 1 / clamp(archetypeDemand, 0.6, 1.4) : 1;
        const jitter = rng.float(0.92, 1.08);
        regionalPreference[region.id] = round(
          clamp(archetypeDemand * categoryAffinity * originBonus * scarcityAdjust * jitter, 0.4, 2.8),
          3,
        );
      }

      const def: CommodityDef = {
        id,
        baseId: base.id,
        formId,
        name,
        category: base.category,
        legality,
        baseValue,
        weightKg,
        volumeL,
        rarity,
        volatility,
        risk,
        shelfLifeDays,
        storage,
        availability,
        baseDemand,
        elasticity,
        marketTypes,
        regionalPreference,
        unit: form.unitOverride ?? base.unit,
        tags,
        description: `${base.description} ${form.description}`.trim(),
        unlock: unlockFor({ legality, risk, rarity, marketTypes, category: base.category }),
        isInstrument: base.isInstrument,
      };
      out.push(def);
    }
  }
  return out;
}

export interface CommodityFilter {
  category?: CommodityCategory | CommodityCategory[];
  legality?: Legality | Legality[];
  marketType?: MarketType;
  tag?: string;
  baseId?: string;
  maxWeightKg?: number;
  maxVolumeL?: number;
  minValue?: number;
  maxValue?: number;
  minAvailability?: number;
  search?: string;
  storage?: StorageRequirement;
  tradeableOnly?: boolean;
}

export interface CommoditySort {
  by: 'name' | 'value' | 'weight' | 'volatility' | 'risk' | 'rarity' | 'demand' | 'density';
  dir: 'asc' | 'desc';
}

/**
 * Immutable registry of all commodities.
 *
 * Lookups are O(1) via the id map; filtered browsing is cached per filter key
 * because the market browser is the hottest read path in the UI.
 */
export class CommodityRegistry {
  private readonly items: CommodityDef[];
  private readonly byId: Map<string, CommodityDef>;
  private readonly byCategory: Map<CommodityCategory, CommodityDef[]>;
  private readonly byLegality: Map<Legality, CommodityDef[]>;
  private readonly byBase: Map<string, CommodityDef[]>;
  private readonly filterCache = new Map<string, CommodityDef[]>();

  constructor(items?: CommodityDef[]) {
    this.items = items ?? buildCommodities();
    this.byId = new Map(this.items.map((c) => [c.id, c]));
    this.byCategory = new Map();
    this.byLegality = new Map();
    this.byBase = new Map();
    for (const c of this.items) {
      pushInto(this.byCategory, c.category, c);
      pushInto(this.byLegality, c.legality, c);
      pushInto(this.byBase, c.baseId, c);
    }
  }

  get count(): number {
    return this.items.length;
  }

  all(): readonly CommodityDef[] {
    return this.items;
  }

  get(id: string): CommodityDef | undefined {
    return this.byId.get(id);
  }

  require(id: string): CommodityDef {
    const c = this.byId.get(id);
    if (!c) throw new Error(`Unknown commodity id: ${id}`);
    return c;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  byCategoryList(category: CommodityCategory): readonly CommodityDef[] {
    return this.byCategory.get(category) ?? [];
  }

  categories(): CommodityCategory[] {
    return Array.from(this.byCategory.keys());
  }

  byLegalityList(legality: Legality): readonly CommodityDef[] {
    return this.byLegality.get(legality) ?? [];
  }

  /** All forms/variants of a base good (used by production-chain UI). */
  variantsOf(baseId: string): readonly CommodityDef[] {
    return this.byBase.get(baseId) ?? [];
  }

  baseIds(): string[] {
    return Array.from(this.byBase.keys());
  }

  /** Value per kilogram — the number smugglers and logistics planners care about. */
  valueDensity(c: CommodityDef): number {
    return c.weightKg > 0 ? c.baseValue / c.weightKg : Number.POSITIVE_INFINITY;
  }

  filter(f: CommodityFilter, sort?: CommoditySort): CommodityDef[] {
    const key = JSON.stringify({ f, sort });
    const cached = this.filterCache.get(key);
    if (cached) return cached;

    const cats = f.category ? (Array.isArray(f.category) ? f.category : [f.category]) : null;
    const legs = f.legality ? (Array.isArray(f.legality) ? f.legality : [f.legality]) : null;
    const q = f.search?.trim().toLowerCase() ?? null;

    let result = this.items.filter((c) => {
      if (cats && !cats.includes(c.category)) return false;
      if (legs && !legs.includes(c.legality)) return false;
      if (f.marketType && !c.marketTypes.includes(f.marketType)) return false;
      if (f.tag && !c.tags.includes(f.tag)) return false;
      if (f.baseId && c.baseId !== f.baseId) return false;
      if (f.storage && c.storage !== f.storage) return false;
      if (f.maxWeightKg !== undefined && c.weightKg > f.maxWeightKg) return false;
      if (f.maxVolumeL !== undefined && c.volumeL > f.maxVolumeL) return false;
      if (f.minValue !== undefined && c.baseValue < f.minValue) return false;
      if (f.maxValue !== undefined && c.baseValue > f.maxValue) return false;
      if (f.minAvailability !== undefined && c.availability < f.minAvailability) return false;
      if (f.tradeableOnly && c.availability < 0.03) return false;
      if (q) {
        const hay = `${c.name} ${c.category} ${c.tags.join(' ')} ${c.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sort) {
      const dir = sort.dir === 'asc' ? 1 : -1;
      result = result.slice().sort((a, b) => dir * compareBy(a, b, sort.by, this));
    }

    this.filterCache.set(key, result);
    return result;
  }

  /** Random-but-deterministic sampling used by world generation. */
  sample(rng: Rng, n: number, f: CommodityFilter = {}): CommodityDef[] {
    const pool = Object.keys(f).length === 0 ? this.items : this.filter(f);
    return rng.sample(pool, n);
  }
}

function compareBy(
  a: CommodityDef,
  b: CommodityDef,
  by: NonNullable<CommoditySort['by']>,
  reg: CommodityRegistry,
): number {
  switch (by) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'value':
      return a.baseValue - b.baseValue;
    case 'weight':
      return a.weightKg - b.weightKg;
    case 'volatility':
      return a.volatility - b.volatility;
    case 'risk':
      return a.risk - b.risk;
    case 'rarity':
      return a.rarity - b.rarity;
    case 'demand':
      return a.baseDemand - b.baseDemand;
    case 'density':
      return reg.valueDensity(a) - reg.valueDensity(b);
    default:
      return 0;
  }
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

let registryInstance: CommodityRegistry | null = null;

/** Process-wide singleton registry. */
export function getCommodityRegistry(): CommodityRegistry {
  if (!registryInstance) registryInstance = new CommodityRegistry();
  return registryInstance;
}

/** Test helper: rebuild the registry (e.g. after injecting custom items). */
export function resetCommodityRegistry(): void {
  registryInstance = null;
}

/** Convenience accessor used across the simulation. */
export function getCommodity(id: string): CommodityDef | undefined {
  return getCommodityRegistry().get(id);
}

export function getRegionPreference(commodity: CommodityDef, regionId: string): number {
  const direct = commodity.regionalPreference[regionId];
  if (direct !== undefined) return direct;
  const region = REGION_BY_ID[regionId];
  if (!region) return 1;
  return ARCHETYPE_DEMAND[region.archetype as keyof typeof ARCHETYPE_DEMAND] ?? 1;
}
