/**
 * Shared types and defaults for the commodity base catalogue.
 *
 * Kept in its own module so `basesA`, `basesB`, `forms` and the registry can all
 * depend on the same definitions without import cycles.
 */

import type { CommodityCategory, Legality, MarketType, StorageRequirement } from '../../sim/types';

export type FormId =
  | 'raw'
  | 'unsorted'
  | 'concentrate'
  | 'refined'
  | 'industrial_grade'
  | 'pharma_grade'
  | 'food_grade'
  | 'powdered'
  | 'processed'
  | 'packaged'
  | 'bulk'
  | 'premium'
  | 'artisanal'
  | 'organic'
  | 'frozen'
  | 'canned'
  | 'extract'
  | 'synthetic'
  | 'scrap'
  | 'salvaged'
  | 'counterfeit'
  | 'component'
  | 'assembled'
  | 'vintage'
  | 'military_spec'
  | 'civilian'
  | 'encrypted'
  | 'redacted'
  | 'weaponised'
  | 'untaxed'
  | 'sanctioned'
  | 'alloy'
  | 'smoked'
  | 'generic'
  | 'cut'
  | 'fresh'
  | 'medical_grade';

export interface BaseCommodity {

  id: string;
  name: string;
  category: CommodityCategory;
  /** Value per unit in the standard (first) form. */
  baseValue: number;
  weightKg: number;
  volumeL: number;
  rarity: 1 | 2 | 3 | 4 | 5;
  volatility: number;
  risk: number;
  legality: Legality;
  shelfLifeDays: number | null;
  storage: StorageRequirement;
  availability: number;
  baseDemand: number;
  elasticity: number;
  marketTypes: MarketType[];
  tags: string[];
  description: string;
  unit: string;
  /** Forms this base is traded in. The first entry is the "standard" form. */
  forms: FormId[];
  /**
   * Per-base overrides of a form's `valueMul`.
   *
   * The generic form multipliers are correct for most goods (raw wheat ≈ wheat)
   * but wrong for ore bodies, where the raw material is a low-grade rock and the
   * refined product is a metal: 1% copper ore is worth ~5% of cathode per tonne,
   * not 58%. Without this the beneficiation/smelting chains could never pay for
   * themselves, so production would be dead content. Overrides are authored per
   * base and per form and leave every other base untouched.
   */
  formValueOverrides?: Partial<Record<FormId, number>>;
  /** True for commodities that are financial instruments rather than physical goods. */
  isInstrument?: boolean;
  /** Regions with a taste/supply bias for this good. */
  regions?: string[];
}

/**
 * Shorthand seed type: only identity, physical and value fields are required;
 * everything else takes a sensible default that individual entries override.
 */
export type BaseCommoditySeed = Pick<
  BaseCommodity,
  'id' | 'name' | 'category' | 'baseValue' | 'weightKg' | 'volumeL' | 'description'
> &
  Partial<Omit<BaseCommodity, 'id' | 'name' | 'category' | 'baseValue' | 'weightKg' | 'volumeL' | 'description'>>;

export const BASE_DEFAULTS: Omit<
  BaseCommodity,
  'id' | 'name' | 'category' | 'baseValue' | 'weightKg' | 'volumeL' | 'description'
> = {
  rarity: 2,
  volatility: 0.18,
  risk: 0,
  legality: 'legal',
  shelfLifeDays: null,
  storage: 'none',
  availability: 0.6,
  baseDemand: 100,
  elasticity: 0.8,
  marketTypes: ['public'],
  tags: [],
  unit: 't',
  forms: ['raw'],
};

/** Catalogue constructor — fills defaults, then applies the authored overrides. */
export function c(b: BaseCommoditySeed): BaseCommodity {
  return { ...BASE_DEFAULTS, ...b } as BaseCommodity;
}
