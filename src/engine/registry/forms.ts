/**
 * Commodity "forms" — the processing/grading/packaging variants that turn a
 * base good into several distinct tradeable SKUs.
 *
 * This mirrors how real commodity markets are structured (copper trades as
 * concentrate, cathode, scrap and wire rod; coffee trades as green, premium
 * and roasted) and is the mechanism by which a compact, hand-authored dataset
 * of ~175 base goods expands into 500+ genuinely distinct commodities with
 * different values, weights, risks, legalities and demand curves.
 *
 * Crucially, forms create *production chains*: concentrate → refined → alloy
 * is exactly what the production system consumes and outputs, so the same data
 * drives both trading and manufacturing.
 */

import type { Legality, MarketType } from '../../sim/types';
import type { FormId } from './basesA';

export interface FormDef {
  id: FormId;
  /** Name fragments — exactly one of prefix/suffix is used per form. */
  prefix?: string;
  suffix?: string;
  valueMul: number;
  weightMul: number;
  volumeMul: number;
  demandMul: number;
  volatilityMul: number;
  availabilityMul: number;
  rarityShift: number;
  riskShift: number;
  elasticityMul: number;
  shelfLifeMul: number;
  /** Legality floor imposed by this form (most severe wins). */
  legalityFloor?: Legality;
  marketTypeOverride?: MarketType[];
  tags: string[];
  unitOverride?: string;
  description: string;
}

const LEGALITY_SEVERITY: Record<Legality, number> = {
  legal: 0,
  restricted: 1,
  illegal: 2,
  contraband: 3,
};

/**
 * Seed type for a form: only `id`, `valueMul` and `description` are required;
 * every other multiplier defaults to neutral.
 */
export type FormDefSeed = Pick<FormDef, 'id' | 'valueMul' | 'description'> &
  Partial<Omit<FormDef, 'id' | 'valueMul' | 'description'>>;

const FORM_DEFAULTS: Omit<FormDef, 'id' | 'valueMul' | 'description'> = {
  weightMul: 1,
  volumeMul: 1,
  demandMul: 1,
  volatilityMul: 1,
  availabilityMul: 1,
  rarityShift: 0,
  riskShift: 0,
  elasticityMul: 1,
  shelfLifeMul: 1,
  tags: [],
};

function f(d: FormDefSeed): FormDef {
  return { ...FORM_DEFAULTS, ...d } as FormDef;
}

export const FORMS: Record<FormId, FormDef> = {
  raw: f({
    id: 'raw', prefix: 'Raw', valueMul: 0.74, demandMul: 1.05, volatilityMul: 1.05,
    availabilityMul: 1.15, description: 'Unprocessed as-extracted/harvested material.',
  }),
  unsorted: f({
    id: 'unsorted', prefix: 'Unsorted', valueMul: 0.58, demandMul: 1.1, volatilityMul: 1.15,
    availabilityMul: 1.3, rarityShift: -1, riskShift: 0.03, elasticityMul: 1.1,
    description: 'Mixed grade, unscreened. Cheapest form, needs processing to be useful.',
  }),
  concentrate: f({
    id: 'concentrate', suffix: 'Concentrate', valueMul: 1.42, weightMul: 0.42, volumeMul: 0.45,
    demandMul: 0.8, volatilityMul: 1.1, availabilityMul: 0.75, rarityShift: 1,
    tags: ['processing_output'], description: 'Beneficiated material; several tonnes of ore per tonne of concentrate.',
  }),
  refined: f({
    id: 'refined', prefix: 'Refined', valueMul: 1.68, weightMul: 0.7, volumeMul: 0.72,
    demandMul: 1.1, volatilityMul: 0.95, availabilityMul: 0.85, tags: ['processing_output'],
    description: 'Fully processed to tradeable standard.',
  }),
  industrial_grade: f({
    id: 'industrial_grade', suffix: '(Industrial Grade)', valueMul: 1.12, demandMul: 1.25,
    availabilityMul: 1.05, tags: ['industrial'], description: 'Bulk specification for factory consumption.',
  }),
  pharma_grade: f({
    id: 'pharma_grade', suffix: '(Pharma Grade)', valueMul: 2.7, weightMul: 0.5, volumeMul: 0.55,
    demandMul: 0.62, volatilityMul: 1.15, availabilityMul: 0.5, rarityShift: 1, riskShift: 0.12,
    legalityFloor: 'restricted', tags: ['regulated', 'high_margin'],
    description: 'Purified and certified for medical use. Requires licensed handling.',
  }),
  medical_grade: f({
    id: 'medical_grade', suffix: '(Medical Grade)', valueMul: 2.2, demandMul: 0.7, availabilityMul: 0.55,
    rarityShift: 1, riskShift: 0.1, legalityFloor: 'restricted', tags: ['regulated', 'hospital'],
    description: 'Certified for clinical use.',
  }),
  food_grade: f({
    id: 'food_grade', suffix: '(Food Grade)', valueMul: 1.26, demandMul: 1.2, availabilityMul: 1.05,
    elasticityMul: 0.95, tags: ['food'], description: 'Certified safe for consumption.',
  }),
  powdered: f({
    id: 'powdered', suffix: 'Powder', valueMul: 1.34, weightMul: 0.85, volumeMul: 1.1,
    demandMul: 0.9, shelfLifeMul: 2.2, tags: ['processed', 'shelf_stable'],
    description: 'Dried and milled; stores far longer than the raw good.',
  }),
  processed: f({
    id: 'processed', prefix: 'Processed', valueMul: 1.46, demandMul: 1.15, tags: ['processing_output'],
    description: 'Value-added intermediate product.',
  }),
  packaged: f({
    id: 'packaged', suffix: '(Packaged)', valueMul: 1.72, volumeMul: 1.18, demandMul: 1.35,
    availabilityMul: 1.1, shelfLifeMul: 1.15, elasticityMul: 0.9, tags: ['retail'],
    description: 'Retail-ready. Commands a consumer premium.',
  }),
  bulk: f({
    id: 'bulk', suffix: '(Bulk)', valueMul: 0.86, demandMul: 1.4, volatilityMul: 0.88,
    availabilityMul: 1.25, elasticityMul: 1.12, rarityShift: -1, tags: ['wholesale', 'volume'],
    description: 'Wholesale lots. Thin margin, high turnover.',
  }),
  premium: f({
    id: 'premium', prefix: 'Premium', valueMul: 2.45, demandMul: 0.48, volatilityMul: 1.18,
    availabilityMul: 0.55, rarityShift: 1, elasticityMul: 0.72, tags: ['luxury', 'graded'],
    description: 'Top grade for discerning buyers. Inelastic and illiquid.',
  }),
  artisanal: f({
    id: 'artisanal', prefix: 'Artisanal', valueMul: 3.1, demandMul: 0.34, volatilityMul: 1.25,
    availabilityMul: 0.4, rarityShift: 2, elasticityMul: 0.6, tags: ['luxury', 'craft'],
    description: 'Hand-made in small batches. Provenance is the product.',
  }),
  organic: f({
    id: 'organic', prefix: 'Organic', valueMul: 1.58, demandMul: 0.7, availabilityMul: 0.6,
    tags: ['certified', 'fashion_driven'], description: 'Certified production. Premium follows consumer fashion.',
  }),
  frozen: f({
    id: 'frozen', prefix: 'Frozen', valueMul: 1.16, volumeMul: 1.12, demandMul: 1.15,
    shelfLifeMul: 3.2, volatilityMul: 0.95, tags: ['cold_chain'],
    description: 'Frozen for transport. Requires refrigeration at every hop.',
  }),
  canned: f({
    id: 'canned', prefix: 'Canned', valueMul: 1.38, weightMul: 1.4, volumeMul: 0.85,
    demandMul: 1.3, shelfLifeMul: 4, tags: ['durable', 'shelf_stable'],
    description: 'Sealed and shelf-stable for years.',
  }),
  smoked: f({
    id: 'smoked', prefix: 'Smoked', valueMul: 1.55, demandMul: 0.8, shelfLifeMul: 2.4,
    tags: ['processed', 'gourmet'], description: 'Preserved and flavoured; a gourmet premium.',
  }),
  fresh: f({
    id: 'fresh', prefix: 'Fresh', valueMul: 1.28, demandMul: 1.25, shelfLifeMul: 0.22,
    volatilityMul: 1.3, availabilityMul: 0.7, tags: ['perishable', 'cold_chain'],
    description: 'Unpreserved. Enormous premium, and it rots in days.',
  }),
  extract: f({
    id: 'extract', suffix: 'Extract', valueMul: 3.6, weightMul: 0.12, volumeMul: 0.16,
    demandMul: 0.55, volatilityMul: 1.25, availabilityMul: 0.6, rarityShift: 1,
    tags: ['processing_output', 'high_density'],
    description: 'Concentrated essence. Extreme value density per kilogram.',
  }),
  synthetic: f({
    id: 'synthetic', prefix: 'Synthetic', valueMul: 1.52, demandMul: 0.95, volatilityMul: 1.2,
    availabilityMul: 0.85, riskShift: 0.08, tags: ['lab_made'],
    description: 'Laboratory-produced equivalent of a natural good.',
  }),
  scrap: f({
    id: 'scrap', prefix: 'Scrap', valueMul: 0.42, demandMul: 1.5, volatilityMul: 1.2,
    availabilityMul: 1.45, rarityShift: -1, riskShift: 0.06, elasticityMul: 1.15,
    tags: ['recycled', 'volume'], description: 'Recovered material. Cheap, plentiful, feeds smelters.',
  }),
  salvaged: f({
    id: 'salvaged', prefix: 'Salvaged', valueMul: 0.52, demandMul: 1.2, volatilityMul: 1.25,
    availabilityMul: 0.9, riskShift: 0.18, legalityFloor: 'restricted', tags: ['second_hand', 'provenance_risk'],
    description: 'Recovered from wrecks, demolition or conflict. Provenance is often unclear.',
  }),
  counterfeit: f({
    id: 'counterfeit', prefix: 'Counterfeit', valueMul: 0.13, demandMul: 2.4, volatilityMul: 1.45,
    availabilityMul: 1.5, rarityShift: -1, riskShift: 0.4, elasticityMul: 1.2,
    legalityFloor: 'illegal', marketTypeOverride: ['black', 'darknet'], tags: ['ip_crime', 'fraud'],
    description: 'Fake goods sold as genuine. Volume business with legal exposure.',
  }),
  component: f({
    id: 'component', suffix: 'Components', valueMul: 0.92, demandMul: 1.3, availabilityMul: 1.1,
    tags: ['manufacturing_input'], description: 'Sub-assemblies for manufacturing.',
  }),
  assembled: f({
    id: 'assembled', suffix: '(Assembled)', valueMul: 1.95, weightMul: 1.15, volumeMul: 1.25,
    demandMul: 0.9, availabilityMul: 0.85, tags: ['manufactured', 'processing_output'],
    description: 'Finished assembly, ready for use.',
  }),
  vintage: f({
    id: 'vintage', prefix: 'Vintage', valueMul: 3.8, demandMul: 0.26, volatilityMul: 1.3,
    availabilityMul: 0.3, rarityShift: 2, elasticityMul: 0.55, shelfLifeMul: 0,
    tags: ['collectible', 'appreciating', 'illiquid'],
    description: 'Aged and graded. Supply is fixed and permanently shrinking.',
  }),
  military_spec: f({
    id: 'military_spec', suffix: '(Mil-Spec)', valueMul: 2.9, demandMul: 0.5, volatilityMul: 1.2,
    availabilityMul: 0.35, rarityShift: 1, riskShift: 0.2, legalityFloor: 'restricted',
    tags: ['defence', 'export_controlled'], description: 'Military specification. Export licensing applies.',
  }),
  civilian: f({
    id: 'civilian', prefix: 'Civilian', valueMul: 0.84, demandMul: 1.35, availabilityMul: 1.2,
    riskShift: -0.12, elasticityMul: 1.1, tags: ['consumer'],
    description: 'De-militarised or consumer specification.',
  }),
  encrypted: f({
    id: 'encrypted', suffix: '(Encrypted)', valueMul: 1.25, demandMul: 0.8, availabilityMul: 0.75,
    riskShift: 0.2, legalityFloor: 'restricted', marketTypeOverride: ['darknet', 'licensed'],
    tags: ['digital', 'intangible'], description: 'Cryptographically protected delivery.',
  }),
  redacted: f({
    id: 'redacted', prefix: 'Redacted', valueMul: 0.72, demandMul: 1.2, availabilityMul: 1.25,
    riskShift: 0.12, legalityFloor: 'restricted', tags: ['partial', 'intangible'],
    description: 'Partially withheld content. Cheaper, less useful.',
  }),
  weaponised: f({
    id: 'weaponised', suffix: '(Weaponised)', valueMul: 3.2, demandMul: 0.42, volatilityMul: 1.3,
    availabilityMul: 0.22, rarityShift: 2, riskShift: 0.35, legalityFloor: 'contraband',
    marketTypeOverride: ['black', 'darknet'], tags: ['weapon', 'extreme_risk'],
    description: 'Modified for combat use. Highest-tier enforcement priority.',
  }),
  untaxed: f({
    id: 'untaxed', prefix: 'Untaxed', valueMul: 0.8, demandMul: 1.6, volatilityMul: 1.05,
    availabilityMul: 1.15, riskShift: 0.32, legalityFloor: 'illegal',
    marketTypeOverride: ['black'], tags: ['excise_evasion', 'smuggling'],
    description: 'Duty-free stock moved outside the tax system. The tax wedge is the margin.',
  }),
  sanctioned: f({
    id: 'sanctioned', prefix: 'Sanctioned-Origin', valueMul: 0.66, demandMul: 1.1, volatilityMul: 1.3,
    availabilityMul: 0.4, riskShift: 0.42, legalityFloor: 'contraband',
    marketTypeOverride: ['black', 'darknet'], tags: ['sanctions_evasion', 'geopolitical'],
    description: 'Origin-blocked by international sanctions. Heavy penalties.',
  }),
  alloy: f({
    id: 'alloy', suffix: 'Alloy', valueMul: 2.45, demandMul: 1.15, availabilityMul: 0.9,
    tags: ['processing_output', 'industrial'], description: 'Blended to specification for industry.',
  }),
  generic: f({
    id: 'generic', prefix: 'Generic', valueMul: 0.52, demandMul: 1.7, availabilityMul: 1.3,
    elasticityMul: 1.15, tags: ['high_volume', 'low_margin'],
    description: 'Off-patent equivalent. Volume over margin.',
  }),
  cut: f({
    id: 'cut', prefix: 'Cut', valueMul: 0.44, demandMul: 1.5, volatilityMul: 1.1,
    availabilityMul: 1.25, riskShift: 0.08, elasticityMul: 1.15,
    tags: ['adulterated', 'street_level'], description: 'Adulterated to street strength. More units, less purity.',
  }),
};

export function mostSevereLegality(a: Legality, b?: Legality): Legality {
  if (!b) return a;
  return LEGALITY_SEVERITY[b] > LEGALITY_SEVERITY[a] ? b : a;
}

export function legalitySeverity(l: Legality): number {
  return LEGALITY_SEVERITY[l];
}
