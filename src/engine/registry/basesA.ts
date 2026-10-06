/**
 * Curated commodity base catalogue — part A.
 *
 * These are the *base* goods of the world (copper, coffee, crude oil…). Each
 * base is expanded into several tradeable SKUs by the form system in
 * `forms.ts` (e.g. copper → copper concentrate, cathode, scrap, wire rod),
 * which mirrors how real commodity markets actually structure themselves and
 * lets the registry exceed 500 tradeable commodities from a compact,
 * human-authored, reviewable dataset.
 */

import { c } from './baseTypes';
import type { BaseCommodity } from './baseTypes';

export type { FormId, BaseCommodity, BaseCommoditySeed } from './baseTypes';


export const BASE_COMMODITIES_A: BaseCommodity[] = [
  /* ------------------------------- agriculture ------------------------------- */
  c({
    id: 'wheat', name: 'Wheat', category: 'agriculture', baseValue: 310, weightKg: 1000, volumeL: 1300,
    volatility: 0.16, availability: 0.95, baseDemand: 240, elasticity: 0.55, shelfLifeDays: 540,
    storage: 'climate', tags: ['staple', 'grain', 'futures'], unit: 't',
    forms: ['raw', 'bulk', 'organic', 'premium', 'processed'],
    description: 'The most-traded staple grain. Prices move with weather, war and export quotas.',
  }),
  c({
    id: 'rice', name: 'Rice', category: 'agriculture', baseValue: 425, weightKg: 1000, volumeL: 1400,
    volatility: 0.19, availability: 0.92, baseDemand: 220, elasticity: 0.5, shelfLifeDays: 720,
    storage: 'climate', tags: ['staple', 'grain'], unit: 't', forms: ['raw', 'bulk', 'premium', 'organic', 'processed'],
    description: 'Half the world eats it. Export bans can double the price in a week.',
    regions: ['southeast_asia', 'south_asia'],
  }),
  c({
    id: 'maize', name: 'Maize', category: 'agriculture', baseValue: 265, weightKg: 1000, volumeL: 1350,
    volatility: 0.2, availability: 0.93, baseDemand: 260, elasticity: 0.6, shelfLifeDays: 480,
    storage: 'climate', tags: ['staple', 'feed', 'ethanol'], unit: 't', forms: ['raw', 'bulk', 'processed', 'organic'],
    description: 'Food, feed and fuel. Demand is hostage to energy policy.',
  }),
  c({
    id: 'soybean', name: 'Soybean', category: 'agriculture', baseValue: 385, weightKg: 1000, volumeL: 1300,
    volatility: 0.21, availability: 0.9, baseDemand: 200, elasticity: 0.62, shelfLifeDays: 400,
    storage: 'climate', tags: ['oilseed', 'feed'], unit: 't', forms: ['raw', 'bulk', 'extract', 'processed', 'organic'],
    description: 'Crushed for meal and oil; the bellwether of the protein complex.',
  }),
  c({
    id: 'coffee', name: 'Coffee Beans', category: 'agriculture', baseValue: 4800, weightKg: 1000, volumeL: 1600,
    volatility: 0.28, availability: 0.8, baseDemand: 90, elasticity: 0.42, shelfLifeDays: 540,
    storage: 'climate', tags: ['soft', 'beverage', 'export'], unit: 't',
    forms: ['raw', 'premium', 'organic', 'artisanal', 'processed'],
    description: 'Arabica and robusta. Frost in one hemisphere moves prices worldwide.',
    regions: ['south_america', 'east_africa', 'southeast_asia'],
  }),
  c({
    id: 'cocoa', name: 'Cocoa Beans', category: 'agriculture', baseValue: 5600, weightKg: 1000, volumeL: 1500,
    volatility: 0.34, availability: 0.62, baseDemand: 62, elasticity: 0.38, shelfLifeDays: 480,
    storage: 'climate', tags: ['soft', 'export', 'luxury_input'], unit: 't',
    forms: ['raw', 'premium', 'organic', 'processed', 'bulk'],
    description: 'Concentrated supply, inelastic demand — a classic squeeze candidate.',
    regions: ['west_africa'],
  }),
  c({
    id: 'cotton', name: 'Cotton', category: 'agriculture', baseValue: 1950, weightKg: 1000, volumeL: 2200,
    volatility: 0.24, availability: 0.82, baseDemand: 110, elasticity: 0.66, shelfLifeDays: null,
    tags: ['fibre', 'textile_input'], unit: 't', forms: ['raw', 'bulk', 'premium', 'organic', 'processed'],
    description: 'Bulky and cheap per tonne; freight is often the real cost.',
  }),
  c({
    id: 'sugarcane', name: 'Sugarcane', category: 'agriculture', baseValue: 145, weightKg: 1000, volumeL: 1600,
    volatility: 0.22, availability: 0.85, baseDemand: 180, elasticity: 0.58, shelfLifeDays: 21,
    storage: 'climate', tags: ['soft', 'ethanol'], unit: 't', forms: ['raw', 'bulk', 'processed'],
    description: 'Spoils fast. Only worth moving if a mill is close.',
  }),
  c({
    id: 'palm_oil', name: 'Palm Oil', category: 'agriculture', baseValue: 980, weightKg: 1000, volumeL: 1100,
    volatility: 0.26, availability: 0.8, baseDemand: 150, elasticity: 0.6, shelfLifeDays: 360,
    storage: 'climate', tags: ['oil', 'food_input', 'biofuel'], unit: 't', forms: ['raw', 'refined', 'bulk', 'processed'],
    description: 'The world\'s most-consumed vegetable oil, and politically contentious.',
  }),
  c({
    id: 'tea', name: 'Tea', category: 'agriculture', baseValue: 3200, weightKg: 1000, volumeL: 2400,
    volatility: 0.2, availability: 0.72, baseDemand: 85, elasticity: 0.48, shelfLifeDays: 720,
    tags: ['soft', 'beverage'], unit: 't', forms: ['raw', 'premium', 'artisanal', 'organic', 'packaged'],
    description: 'Auction-driven market with strong regional taste preferences.',
  }),
  c({
    id: 'tobacco', name: 'Tobacco Leaf', category: 'agriculture', baseValue: 4100, weightKg: 1000, volumeL: 2600,
    volatility: 0.23, availability: 0.7, baseDemand: 95, elasticity: 0.35, shelfLifeDays: 900,
    tags: ['soft', 'excise', 'addictive'], unit: 't', forms: ['raw', 'premium', 'processed', 'untaxed', 'packaged'],
    description: 'Heavily taxed everywhere, which is precisely why smuggling pays.',
  }),
  c({
    id: 'natural_rubber', name: 'Natural Rubber', category: 'agriculture', baseValue: 1650, weightKg: 1000, volumeL: 1400,
    volatility: 0.29, availability: 0.66, baseDemand: 70, elasticity: 0.55, tags: ['industrial_input'], unit: 't',
    forms: ['raw', 'processed', 'bulk', 'premium'], description: 'Tyres, gloves, conveyor belts. Trees take seven years to tap.',
  }),
  c({
    id: 'hemp', name: 'Industrial Hemp', category: 'agriculture', baseValue: 1250, weightKg: 1000, volumeL: 2800,
    volatility: 0.3, availability: 0.55, baseDemand: 48, elasticity: 0.7, legality: 'restricted', risk: 0.18,
    shelfLifeDays: 540, tags: ['fibre', 'regulated'], unit: 't', forms: ['raw', 'processed', 'extract', 'organic'],
    description: 'Legal in some jurisdictions, treated as contraband in others.',
  }),
  c({
    id: 'vanilla', name: 'Vanilla Beans', category: 'agriculture', baseValue: 62000, weightKg: 1000, volumeL: 3000,
    rarity: 4, volatility: 0.52, availability: 0.24, baseDemand: 6, elasticity: 0.3, shelfLifeDays: 720,
    tags: ['soft', 'high_value', 'export'], unit: 't', forms: ['raw', 'premium', 'artisanal', 'organic', 'extract'],
    description: 'Hand-pollinated and cyclone-exposed. Enormous value density.',
    regions: ['indian_ocean'],
  }),
  c({
    id: 'saffron', name: 'Saffron', category: 'agriculture', baseValue: 380000, weightKg: 1000, volumeL: 4000,
    rarity: 5, volatility: 0.44, availability: 0.12, baseDemand: 2.4, elasticity: 0.26, shelfLifeDays: 1080,
    tags: ['soft', 'ultra_high_value'], unit: 't', forms: ['raw', 'premium', 'artisanal', 'counterfeit'],
    description: 'The most valuable spice by weight, and one of the most-counterfeited.',
  }),
  c({
    id: 'quinoa', name: 'Quinoa', category: 'agriculture', baseValue: 2400, weightKg: 1000, volumeL: 1500,
    volatility: 0.31, availability: 0.5, baseDemand: 40, elasticity: 0.72, shelfLifeDays: 540,
    tags: ['soft', 'health_food'], unit: 't', forms: ['raw', 'organic', 'premium', 'processed'],
    description: 'A demand story driven by fashion rather than necessity.',
  }),

  /* -------------------------------- livestock -------------------------------- */
  c({
    id: 'cattle', name: 'Live Cattle', category: 'livestock', baseValue: 1850, weightKg: 620, volumeL: 900,
    volatility: 0.2, availability: 0.7, baseDemand: 38, elasticity: 0.5, shelfLifeDays: null,
    tags: ['animal', 'protein'], unit: 'head', forms: ['raw', 'premium', 'organic'],
    description: 'Walks itself to market, but dies of drought and disease.',
  }),
  c({
    id: 'poultry', name: 'Poultry', category: 'livestock', baseValue: 34, weightKg: 2.4, volumeL: 5,
    volatility: 0.24, availability: 0.9, baseDemand: 420, elasticity: 0.58, shelfLifeDays: 9,
    storage: 'refrigerated', tags: ['animal', 'protein', 'perishable'], unit: 'bird', forms: ['raw', 'frozen', 'processed', 'packaged'],
    description: 'Cheap protein. Avian flu can wipe out regional supply overnight.',
  }),
  c({
    id: 'pork', name: 'Pork Carcass', category: 'livestock', baseValue: 2100, weightKg: 95, volumeL: 130,
    volatility: 0.27, availability: 0.78, baseDemand: 120, elasticity: 0.55, shelfLifeDays: 12,
    storage: 'refrigerated', tags: ['animal', 'protein', 'perishable'], unit: 'carcass', forms: ['raw', 'frozen', 'processed', 'premium'],
    description: 'Disease-driven cycles make this a volatile staple.',
  }),
  c({
    id: 'wool', name: 'Wool', category: 'livestock', baseValue: 8200, weightKg: 1000, volumeL: 4200,
    volatility: 0.22, availability: 0.6, baseDemand: 30, elasticity: 0.6, tags: ['fibre', 'textile_input'], unit: 't',
    forms: ['raw', 'unsorted', 'premium', 'processed'], description: 'Bulky, stable, and graded obsessively at auction.',
  }),
  c({
    id: 'hides', name: 'Animal Hides', category: 'livestock', baseValue: 3400, weightKg: 1000, volumeL: 1800,
    volatility: 0.25, availability: 0.55, baseDemand: 34, elasticity: 0.6, shelfLifeDays: 90,
    tags: ['leather_input', 'perishable'], unit: 't', forms: ['raw', 'unsorted', 'premium', 'processed'],
    description: 'By-product of meat, input to leather. Salt it or lose it.',
  }),
  c({
    id: 'tuna', name: 'Bluefin Tuna', category: 'livestock', baseValue: 42, weightKg: 1, volumeL: 1.1,
    rarity: 4, volatility: 0.46, availability: 0.3, baseDemand: 120, elasticity: 0.34, shelfLifeDays: 5,
    storage: 'refrigerated', risk: 0.22, legality: 'restricted', tags: ['seafood', 'luxury', 'quota'], unit: 'kg',
    forms: ['raw', 'frozen', 'premium', 'artisanal'],
    description: 'Quota-limited luxury protein. Individual fish have sold for six figures.',
  }),
  c({
    id: 'salmon', name: 'Salmon', category: 'livestock', baseValue: 12.5, weightKg: 1, volumeL: 1.1,
    volatility: 0.24, availability: 0.75, baseDemand: 380, elasticity: 0.56, shelfLifeDays: 7,
    storage: 'refrigerated', tags: ['seafood', 'perishable'], unit: 'kg', forms: ['raw', 'frozen', 'smoked', 'premium'],
    description: 'Farmed and wild, with very different price curves.',
  }),
  c({
    id: 'lobster', name: 'Live Lobster', category: 'livestock', baseValue: 38, weightKg: 1, volumeL: 2.4,
    rarity: 3, volatility: 0.35, availability: 0.4, baseDemand: 60, elasticity: 0.4, shelfLifeDays: 3,
    storage: 'refrigerated', tags: ['seafood', 'luxury', 'perishable'], unit: 'kg', forms: ['raw', 'frozen', 'premium'],
    description: 'Dies in transit. Cold chain is the entire business.',
  }),
  c({
    id: 'caviar', name: 'Caviar', category: 'livestock', baseValue: 4200, weightKg: 1, volumeL: 1.2,
    rarity: 5, volatility: 0.4, availability: 0.18, baseDemand: 9, elasticity: 0.3, shelfLifeDays: 120,
    storage: 'refrigerated', tags: ['luxury', 'high_value', 'perishable'], unit: 'kg', forms: ['raw', 'premium', 'artisanal', 'counterfeit'],
    description: 'Tiny, cold, absurdly valuable — the smuggler\'s favourite luxury.',
  }),
  c({
    id: 'honey', name: 'Honey', category: 'livestock', baseValue: 6.4, weightKg: 1, volumeL: 0.7,
    volatility: 0.18, availability: 0.72, baseDemand: 210, elasticity: 0.6, shelfLifeDays: 1800,
    tags: ['food', 'organic'], unit: 'kg', forms: ['raw', 'organic', 'premium', 'packaged', 'artisanal'],
    description: 'Never spoils, and is routinely adulterated with syrup.',
  }),
  c({
    id: 'eggs', name: 'Eggs', category: 'livestock', baseValue: 2.1, weightKg: 1, volumeL: 1.7,
    volatility: 0.33, availability: 0.9, baseDemand: 620, elasticity: 0.52, shelfLifeDays: 28,
    storage: 'refrigerated', tags: ['protein', 'perishable', 'staple'], unit: 'kg', forms: ['raw', 'organic', 'powdered', 'packaged'],
    description: 'Disease outbreaks cause violent, short-lived price spikes.',
  }),

  /* ------------------------------- foodstuff -------------------------------- */
  c({
    id: 'flour', name: 'Flour', category: 'foodstuff', baseValue: 520, weightKg: 1000, volumeL: 1500,
    volatility: 0.17, availability: 0.93, baseDemand: 300, elasticity: 0.5, shelfLifeDays: 300,
    tags: ['staple', 'processed'], unit: 't', forms: ['raw', 'bulk', 'packaged', 'food_grade', 'premium'],
    description: 'Milled from wheat; the first thing to run out in a crisis.',
  }),
  c({
    id: 'sugar', name: 'Sugar', category: 'foodstuff', baseValue: 610, weightKg: 1000, volumeL: 1300,
    volatility: 0.26, availability: 0.9, baseDemand: 260, elasticity: 0.56, shelfLifeDays: 1080,
    tags: ['staple', 'soft'], unit: 't', forms: ['raw', 'refined', 'bulk', 'packaged', 'food_grade'],
    description: 'Ethanol policy and monsoon rainfall both live in this price.',
  }),
  c({
    id: 'cooking_oil', name: 'Cooking Oil', category: 'foodstuff', baseValue: 1250, weightKg: 1000, volumeL: 1100,
    volatility: 0.24, availability: 0.9, baseDemand: 240, elasticity: 0.52, shelfLifeDays: 540,
    tags: ['staple', 'processed'], unit: 't', forms: ['raw', 'refined', 'bulk', 'packaged', 'food_grade'],
    description: 'Export restrictions here cause real-world unrest.',
  }),
  c({
    id: 'canned_goods', name: 'Canned Goods', category: 'foodstuff', baseValue: 2.4, weightKg: 0.45, volumeL: 0.5,
    volatility: 0.14, availability: 0.95, baseDemand: 900, elasticity: 0.48, shelfLifeDays: 1460,
    tags: ['staple', 'durable', 'relief'], unit: 'can', forms: ['packaged', 'bulk', 'premium'],
    description: 'Long shelf life, universal demand, and a disaster-hedge staple.',
  }),
  c({
    id: 'powdered_milk', name: 'Powdered Milk', category: 'foodstuff', baseValue: 3400, weightKg: 1000, volumeL: 1900,
    volatility: 0.22, availability: 0.8, baseDemand: 130, elasticity: 0.5, shelfLifeDays: 720,
    tags: ['staple', 'durable'], unit: 't', forms: ['raw', 'food_grade', 'packaged', 'bulk', 'premium'],
    description: 'Dairy without the cold chain.',
  }),
  c({
    id: 'baby_formula', name: 'Infant Formula', category: 'foodstuff', baseValue: 14, weightKg: 0.85, volumeL: 1.4,
    rarity: 3, volatility: 0.36, availability: 0.6, baseDemand: 260, elasticity: 0.22, shelfLifeDays: 540,
    storage: 'climate', tags: ['essential', 'inelastic', 'regulated'], unit: 'tin',
    forms: ['packaged', 'food_grade', 'premium', 'counterfeit'],
    description: 'Perfectly inelastic demand — shortages become front-page news.',
  }),
  c({
    id: 'bottled_water', name: 'Bottled Water', category: 'foodstuff', baseValue: 0.55, weightKg: 1, volumeL: 1,
    volatility: 0.12, availability: 0.97, baseDemand: 2400, elasticity: 0.4, shelfLifeDays: 720,
    tags: ['essential', 'bulky', 'relief'], unit: 'bottle', forms: ['packaged', 'bulk'],
    description: 'Worthless per unit until a drought or earthquake makes it priceless.',
  }),
  c({
    id: 'spice_blend', name: 'Spice Blend', category: 'foodstuff', baseValue: 18, weightKg: 1, volumeL: 2.2,
    volatility: 0.27, availability: 0.7, baseDemand: 240, elasticity: 0.55, shelfLifeDays: 720,
    tags: ['food', 'regional'], unit: 'kg', forms: ['packaged', 'artisanal', 'premium', 'bulk'],
    description: 'Regional tastes make this a reliable arbitrage good.',
  }),
  c({
    id: 'pasta', name: 'Dried Pasta', category: 'foodstuff', baseValue: 1.9, weightKg: 1, volumeL: 2.4,
    volatility: 0.15, availability: 0.92, baseDemand: 480, elasticity: 0.5, shelfLifeDays: 900,
    tags: ['staple', 'durable'], unit: 'kg', forms: ['packaged', 'bulk', 'premium', 'artisanal'],
    description: 'Cheap calories that survive any warehouse.',
  }),
  c({
    id: 'frozen_meat', name: 'Frozen Meat', category: 'foodstuff', baseValue: 6.8, weightKg: 1, volumeL: 1.1,
    volatility: 0.25, availability: 0.85, baseDemand: 520, elasticity: 0.55, shelfLifeDays: 240,
    storage: 'refrigerated', tags: ['protein', 'perishable', 'cold_chain'], unit: 'kg', forms: ['frozen', 'processed', 'packaged', 'premium'],
    description: 'Requires refrigeration at every hop or the load is worthless.',
  }),

  /* -------------------------------- beverage -------------------------------- */
  c({
    id: 'whiskey', name: 'Whiskey', category: 'beverage', baseValue: 42, weightKg: 1.4, volumeL: 1.2,
    volatility: 0.22, availability: 0.72, baseDemand: 160, elasticity: 0.44, shelfLifeDays: null,
    tags: ['spirits', 'excise', 'luxury'], unit: 'bottle', forms: ['packaged', 'premium', 'vintage', 'artisanal', 'untaxed'],
    description: 'Ages into an investment asset. Untaxed stock is pure margin.',
  }),
  c({
    id: 'wine', name: 'Wine', category: 'beverage', baseValue: 26, weightKg: 1.3, volumeL: 1.1,
    volatility: 0.24, availability: 0.75, baseDemand: 190, elasticity: 0.46, shelfLifeDays: null,
    tags: ['alcohol', 'luxury', 'vintage'], unit: 'bottle', forms: ['packaged', 'premium', 'vintage', 'artisanal', 'counterfeit'],
    description: 'Vintage and provenance drive 100× spreads between bottles.',
  }),
  c({
    id: 'beer', name: 'Beer', category: 'beverage', baseValue: 1.6, weightKg: 0.62, volumeL: 0.55,
    volatility: 0.13, availability: 0.95, baseDemand: 1400, elasticity: 0.5, shelfLifeDays: 270,
    tags: ['alcohol', 'bulky', 'staple'], unit: 'bottle', forms: ['packaged', 'bulk', 'premium', 'artisanal'],
    description: 'Low margin, high volume, heavy freight.',
  }),
  c({
    id: 'champagne', name: 'Champagne', category: 'beverage', baseValue: 180, weightKg: 1.6, volumeL: 1.3,
    rarity: 4, volatility: 0.2, availability: 0.34, baseDemand: 26, elasticity: 0.32,
    tags: ['luxury', 'status'], unit: 'bottle', forms: ['packaged', 'premium', 'vintage'],
    description: 'Demand tracks confidence among the wealthy, not thirst.',
  }),
  c({
    id: 'vodka', name: 'Vodka', category: 'beverage', baseValue: 18, weightKg: 1.3, volumeL: 1.1,
    volatility: 0.18, availability: 0.85, baseDemand: 260, elasticity: 0.5, tags: ['spirits', 'excise'], unit: 'bottle',
    forms: ['packaged', 'premium', 'untaxed', 'bulk'], description: 'Cheap to make, easy to counterfeit, always in demand.',
  }),
  c({
    id: 'rum', name: 'Rum', category: 'beverage', baseValue: 22, weightKg: 1.3, volumeL: 1.1,
    volatility: 0.2, availability: 0.72, baseDemand: 150, elasticity: 0.48, tags: ['spirits', 'export'], unit: 'bottle',
    forms: ['packaged', 'premium', 'artisanal', 'untaxed', 'vintage'], description: 'Caribbean production, global consumption.',
  }),

  /* --------------------------------- textile -------------------------------- */
  c({
    id: 'cotton_yarn', name: 'Cotton Yarn', category: 'textile', baseValue: 3100, weightKg: 1000, volumeL: 2000,
    volatility: 0.22, availability: 0.78, baseDemand: 90, elasticity: 0.62, tags: ['textile_input'], unit: 't',
    forms: ['raw', 'processed', 'premium', 'bulk'], description: 'The first processing step from bale to garment.',
  }),
  c({
    id: 'silk', name: 'Silk', category: 'textile', baseValue: 68000, weightKg: 1000, volumeL: 3200,
    rarity: 4, volatility: 0.28, availability: 0.3, baseDemand: 12, elasticity: 0.38, tags: ['luxury_input', 'fibre'], unit: 't',
    forms: ['raw', 'premium', 'artisanal', 'processed'], description: 'Low volume, high value, fragile supply.',
  }),
  c({
    id: 'denim', name: 'Denim Fabric', category: 'textile', baseValue: 4200, weightKg: 1000, volumeL: 1800,
    volatility: 0.2, availability: 0.72, baseDemand: 80, elasticity: 0.6, tags: ['textile'], unit: 't',
    forms: ['raw', 'processed', 'premium', 'bulk'], description: 'Cotton in, jeans out; demand follows fast fashion cycles.',
  }),
  c({
    id: 'cashmere', name: 'Cashmere', category: 'textile', baseValue: 145000, weightKg: 1000, volumeL: 4400,
    rarity: 5, volatility: 0.33, availability: 0.18, baseDemand: 6, elasticity: 0.32, tags: ['luxury_input', 'fibre'], unit: 't',
    forms: ['raw', 'premium', 'artisanal', 'counterfeit'], description: 'Goat down from a few high plateaus. Counterfeits flood the market.',
  }),
  c({
    id: 'garments', name: 'Ready Garments', category: 'textile', baseValue: 9.5, weightKg: 0.4, volumeL: 1.6,
    volatility: 0.17, availability: 0.9, baseDemand: 700, elasticity: 0.64, tags: ['consumer', 'retail'], unit: 'piece',
    forms: ['packaged', 'premium', 'counterfeit', 'bulk'], description: 'Manufactured output; margins live in logistics and season.',
  }),
  c({
    id: 'carpets', name: 'Hand-Knotted Carpets', category: 'textile', baseValue: 1400, weightKg: 28, volumeL: 90,
    rarity: 4, volatility: 0.24, availability: 0.3, baseDemand: 8, elasticity: 0.36, tags: ['luxury', 'artisanal', 'export'], unit: 'piece',
    forms: ['artisanal', 'premium', 'vintage', 'counterfeit'], description: 'Provenance and age decide value more than material.',
  }),

  /* ------------------------------ raw material ------------------------------ */
  c({
    id: 'iron_ore', name: 'Iron Ore', category: 'raw_material', baseValue: 118, weightKg: 1000, volumeL: 640,
    volatility: 0.26, availability: 0.85, baseDemand: 260, elasticity: 0.58, tags: ['bulk', 'steel_input'], unit: 't',
    forms: ['raw', 'concentrate', 'bulk', 'unsorted'], description: 'The single most-shipped dry bulk commodity on earth.',
  }),
  c({
    id: 'bauxite', name: 'Bauxite', category: 'raw_material', baseValue: 62, weightKg: 1000, volumeL: 780,
    volatility: 0.2, availability: 0.7, baseDemand: 150, elasticity: 0.6, tags: ['bulk', 'aluminium_input'], unit: 't',
    forms: ['raw', 'bulk', 'unsorted'], description: 'Aluminium\'s starting point; export bans are a recurring shock.',
  }),
  c({
    id: 'limestone', name: 'Limestone', category: 'raw_material', baseValue: 18, weightKg: 1000, volumeL: 700,
    volatility: 0.11, availability: 0.95, baseDemand: 400, elasticity: 0.5, tags: ['bulk', 'construction_input'], unit: 't',
    forms: ['raw', 'bulk', 'processed'], description: 'Cheap, heavy, local. Only worth moving short distances.',
  }),
  c({
    id: 'industrial_sand', name: 'Industrial Sand', category: 'raw_material', baseValue: 26, weightKg: 1000, volumeL: 620,
    volatility: 0.15, availability: 0.9, baseDemand: 520, elasticity: 0.5, tags: ['bulk', 'construction_input', 'glass_input'], unit: 't',
    forms: ['raw', 'bulk', 'processed'], description: 'Desert sand is useless; river sand is fought over.',
  }),
  c({
    id: 'timber', name: 'Softwood Timber', category: 'raw_material', baseValue: 240, weightKg: 1000, volumeL: 1600,
    volatility: 0.28, availability: 0.8, baseDemand: 190, elasticity: 0.58, tags: ['construction_input', 'bulk'], unit: 't',
    forms: ['raw', 'processed', 'premium', 'bulk'], description: 'Housing starts and beetle kill both move this.',
  }),
  c({
    id: 'wood_pulp', name: 'Wood Pulp', category: 'raw_material', baseValue: 690, weightKg: 1000, volumeL: 2400,
    volatility: 0.23, availability: 0.72, baseDemand: 110, elasticity: 0.6, tags: ['paper_input'], unit: 't',
    forms: ['raw', 'processed', 'bulk', 'premium'], description: 'Paper, packaging and viscose all start here.',
  }),
  c({
    id: 'phosphate_rock', name: 'Phosphate Rock', category: 'raw_material', baseValue: 135, weightKg: 1000, volumeL: 700,
    volatility: 0.31, availability: 0.55, baseDemand: 160, elasticity: 0.45, tags: ['fertiliser_input', 'strategic'], unit: 't',
    forms: ['raw', 'concentrate', 'bulk'], description: 'Geologically concentrated; a genuine food-security chokepoint.',
  }),
  c({
    id: 'salt', name: 'Industrial Salt', category: 'raw_material', baseValue: 42, weightKg: 1000, volumeL: 760,
    volatility: 0.1, availability: 0.95, baseDemand: 300, elasticity: 0.5, tags: ['bulk', 'chemical_input'], unit: 't',
    forms: ['raw', 'bulk', 'food_grade', 'processed'], description: 'Chemical feedstock, de-icer and preservative.',
  }),
  c({
    id: 'sulfur', name: 'Sulfur', category: 'raw_material', baseValue: 95, weightKg: 1000, volumeL: 640,
    volatility: 0.24, availability: 0.7, baseDemand: 140, elasticity: 0.55, storage: 'hazardous',
    tags: ['chemical_input', 'fertiliser_input'], unit: 't', forms: ['raw', 'bulk', 'refined'],
    description: 'By-product of refining; essential for sulfuric acid and fertiliser.',
  }),
  c({
    id: 'rare_earth_ore', name: 'Rare Earth Ore', category: 'raw_material', baseValue: 3400, weightKg: 1000, volumeL: 700,
    rarity: 4, volatility: 0.42, availability: 0.3, baseDemand: 40, elasticity: 0.4, risk: 0.1, legality: 'restricted',
    tags: ['strategic', 'technology_input', 'sanctioned'], unit: 't', forms: ['raw', 'concentrate', 'refined', 'sanctioned'],
    formValueOverrides: { raw: 0.08, unsorted: 0.1 },
    description: 'Export controls make this a geopolitical football.',
  }),
  c({
    id: 'coltan', name: 'Coltan', category: 'raw_material', baseValue: 260, weightKg: 1, volumeL: 0.28,
    rarity: 4, volatility: 0.44, availability: 0.28, baseDemand: 120, elasticity: 0.42, risk: 0.55, legality: 'restricted',
    tags: ['conflict_mineral', 'technology_input', 'strategic'], unit: 'kg', forms: ['raw', 'concentrate', 'refined', 'unsorted'],
    formValueOverrides: { raw: 0.08, unsorted: 0.1 },
    description: 'Tantalum ore. Conflict-region sourcing carries legal and moral risk.',
    regions: ['central_africa'],
  }),
  c({
    id: 'cobalt_ore', name: 'Cobalt Ore', category: 'raw_material', baseValue: 96, weightKg: 1, volumeL: 0.3,
    rarity: 3, volatility: 0.46, availability: 0.34, baseDemand: 220, elasticity: 0.4, risk: 0.35, legality: 'restricted',
    tags: ['battery_input', 'conflict_mineral', 'strategic'], unit: 'kg', forms: ['raw', 'concentrate', 'refined'],
    description: 'Battery chemistry\'s most politically exposed metal.',
  }),
  c({
    id: 'lithium_brine', name: 'Lithium Brine', category: 'raw_material', baseValue: 1200, weightKg: 1000, volumeL: 900,
    rarity: 3, volatility: 0.52, availability: 0.4, baseDemand: 90, elasticity: 0.38,
    tags: ['battery_input', 'strategic', 'ev'], unit: 't', forms: ['raw', 'concentrate', 'refined', 'industrial_grade'],
    formValueOverrides: { raw: 0.11 },
    description: 'Boom-bust pricing tied directly to electric-vehicle demand.',
  }),
  c({
    id: 'gravel', name: 'Crushed Gravel', category: 'raw_material', baseValue: 14, weightKg: 1000, volumeL: 640,
    volatility: 0.09, availability: 0.97, baseDemand: 700, elasticity: 0.48, tags: ['bulk', 'construction_input'], unit: 't',
    forms: ['raw', 'bulk'], description: 'Almost worthless, except where construction is booming and quarries are not.',
  }),

  /* ---------------------------------- metal --------------------------------- */
  c({
    id: 'copper', name: 'Copper', category: 'metal', baseValue: 9400, weightKg: 1000, volumeL: 112,
    volatility: 0.24, availability: 0.85, baseDemand: 130, elasticity: 0.5, tags: ['industrial', 'electrification', 'futures'], unit: 't',
    forms: ['raw', 'concentrate', 'refined', 'industrial_grade', 'scrap', 'component'],
    formValueOverrides: { raw: 0.05, concentrate: 0.34, unsorted: 0.07, bulk: 0.09 },
    description: 'Doctor Copper diagnoses the global economy. Mine strikes move it fast.',
  }),
  c({
    id: 'aluminium', name: 'Aluminium', category: 'metal', baseValue: 2450, weightKg: 1000, volumeL: 370,
    volatility: 0.23, availability: 0.85, baseDemand: 160, elasticity: 0.52, tags: ['industrial', 'energy_intensive'], unit: 't',
    forms: ['refined', 'industrial_grade', 'scrap', 'alloy', 'component'],
    description: 'Solid electricity; smelter outages repricing the whole chain.',
  }),
  c({
    id: 'steel', name: 'Steel', category: 'metal', baseValue: 780, weightKg: 1000, volumeL: 128,
    volatility: 0.25, availability: 0.9, baseDemand: 320, elasticity: 0.55, tags: ['industrial', 'construction_input'], unit: 't',
    forms: ['refined', 'industrial_grade', 'scrap', 'processed', 'component'],
    description: 'Tariffs and capacity cuts dominate; construction demand sets the floor.',
  }),
  c({
    id: 'nickel', name: 'Nickel', category: 'metal', baseValue: 17200, weightKg: 1000, volumeL: 112,
    volatility: 0.44, availability: 0.6, baseDemand: 70, elasticity: 0.44, tags: ['industrial', 'battery_input', 'squeeze'], unit: 't',
    forms: ['refined', 'industrial_grade', 'concentrate', 'scrap'],
    description: 'Notorious for short squeezes; a single corner can break the market.',
  }),
  c({
    id: 'zinc', name: 'Zinc', category: 'metal', baseValue: 2900, weightKg: 1000, volumeL: 140,
    volatility: 0.27, availability: 0.78, baseDemand: 95, elasticity: 0.52, tags: ['industrial', 'galvanising'], unit: 't',
    forms: ['refined', 'concentrate', 'industrial_grade', 'scrap'], description: 'Galvanising steel keeps demand structural.',
  }),
  c({
    id: 'lead', name: 'Lead', category: 'metal', baseValue: 2150, weightKg: 1000, volumeL: 88,
    volatility: 0.2, availability: 0.75, baseDemand: 80, elasticity: 0.54, risk: 0.12, storage: 'hazardous',
    tags: ['industrial', 'battery_input', 'toxic'], unit: 't', forms: ['refined', 'scrap', 'industrial_grade'],
    description: 'Batteries and ammunition; recycling is cheaper than mining.',
  }),
  c({
    id: 'tin', name: 'Tin', category: 'metal', baseValue: 27500, weightKg: 1000, volumeL: 137,
    rarity: 3, volatility: 0.38, availability: 0.45, baseDemand: 34, elasticity: 0.42, tags: ['industrial', 'electronics_input'], unit: 't',
    forms: ['refined', 'concentrate', 'industrial_grade', 'scrap'], description: 'Solder for every circuit board; supply is tiny and concentrated.',
  }),
  c({
    id: 'titanium', name: 'Titanium Sponge', category: 'metal', baseValue: 16500, weightKg: 1000, volumeL: 220,
    rarity: 4, volatility: 0.33, availability: 0.32, baseDemand: 26, elasticity: 0.4, tags: ['aerospace', 'strategic', 'sanctioned'], unit: 't',
    forms: ['refined', 'industrial_grade', 'military_spec', 'component'], description: 'Aerospace and defence; export controls apply.',
  }),
  c({
    id: 'tungsten', name: 'Tungsten', category: 'metal', baseValue: 38000, weightKg: 1000, volumeL: 52,
    rarity: 4, volatility: 0.34, availability: 0.3, baseDemand: 22, elasticity: 0.38, legality: 'restricted', risk: 0.14,
    tags: ['strategic', 'tooling', 'sanctioned'], unit: 't', forms: ['refined', 'concentrate', 'industrial_grade', 'military_spec'],
    description: 'Hard tooling and armour-piercing applications; quota-controlled.',
  }),
  c({
    id: 'gold', name: 'Gold', category: 'metal', baseValue: 72000, weightKg: 1, volumeL: 0.052,
    rarity: 5, volatility: 0.14, availability: 0.5, baseDemand: 60, elasticity: 0.28, storage: 'secure',
    tags: ['precious', 'store_of_value', 'safe_haven', 'futures'], unit: 'kg',
    forms: ['raw', 'refined', 'bulk', 'scrap', 'premium', 'salvaged'],
    description: 'The safe haven. Rises when confidence in everything else falls.',
  }),
  c({
    id: 'silver', name: 'Silver', category: 'metal', baseValue: 880, weightKg: 1, volumeL: 0.095,
    rarity: 4, volatility: 0.3, availability: 0.6, baseDemand: 140, elasticity: 0.38, storage: 'secure',
    tags: ['precious', 'industrial', 'solar_input'], unit: 'kg', forms: ['raw', 'refined', 'bulk', 'scrap', 'industrial_grade'],
    description: 'Half money, half industrial input — which makes it violently volatile.',
  }),
  c({
    id: 'platinum', name: 'Platinum', category: 'metal', baseValue: 32000, weightKg: 1, volumeL: 0.047,
    rarity: 5, volatility: 0.26, availability: 0.28, baseDemand: 24, elasticity: 0.34, storage: 'secure',
    tags: ['precious', 'catalyst', 'industrial'], unit: 'kg', forms: ['refined', 'industrial_grade', 'scrap', 'component'],
    description: 'Catalytic converters and hydrogen electrolysers; mine supply is one country deep.',
  }),
  c({
    id: 'palladium', name: 'Palladium', category: 'metal', baseValue: 41000, weightKg: 1, volumeL: 0.083,
    rarity: 5, volatility: 0.48, availability: 0.2, baseDemand: 14, elasticity: 0.3, storage: 'secure',
    tags: ['precious', 'catalyst', 'squeeze'], unit: 'kg', forms: ['refined', 'scrap', 'component', 'salvaged'],
    description: 'Structural deficit and theft from catalytic converters keep it tight.',
  }),
  c({
    id: 'uranium_yellowcake', name: 'Uranium Yellowcake', category: 'metal', baseValue: 190, weightKg: 1, volumeL: 0.3,
    rarity: 5, volatility: 0.36, availability: 0.14, baseDemand: 18, elasticity: 0.24, legality: 'restricted', risk: 0.82,
    storage: 'hazardous', tags: ['nuclear', 'strategic', 'sanctioned', 'controlled'], unit: 'kg',
    forms: ['raw', 'refined', 'sanctioned'], description: 'Trade is licensed, monitored and politically explosive.',
  }),

  /* ---------------------------------- energy -------------------------------- */
  c({
    id: 'crude_oil', name: 'Crude Oil', category: 'energy', baseValue: 620, weightKg: 1000, volumeL: 1170,
    volatility: 0.36, availability: 0.85, baseDemand: 210, elasticity: 0.36, storage: 'hazardous',
    tags: ['energy', 'futures', 'strategic', 'geopolitical'], unit: 't',
    forms: ['raw', 'bulk', 'premium', 'sanctioned'],
    description: 'The macro variable. Wars, cartels and inventories all price through it.',
  }),
  c({
    id: 'diesel', name: 'Diesel', category: 'energy', baseValue: 890, weightKg: 1000, volumeL: 1190,
    volatility: 0.3, availability: 0.92, baseDemand: 320, elasticity: 0.4, storage: 'hazardous',
    tags: ['energy', 'freight', 'refined_product'], unit: 't', forms: ['refined', 'bulk', 'untaxed', 'sanctioned'],
    description: 'The fuel of logistics. Its spread to crude is the refining margin.',
  }),
  c({
    id: 'gasoline', name: 'Gasoline', category: 'energy', baseValue: 940, weightKg: 1000, volumeL: 1350,
    volatility: 0.32, availability: 0.92, baseDemand: 340, elasticity: 0.38, storage: 'hazardous',
    tags: ['energy', 'consumer', 'refined_product'], unit: 't', forms: ['refined', 'bulk', 'untaxed'],
    description: 'Politically sensitive; governments intervene when it spikes.',
  }),
  c({
    id: 'jet_fuel', name: 'Jet Fuel', category: 'energy', baseValue: 980, weightKg: 1000, volumeL: 1250,
    volatility: 0.33, availability: 0.7, baseDemand: 110, elasticity: 0.42, storage: 'hazardous',
    tags: ['energy', 'aviation', 'refined_product'], unit: 't', forms: ['refined', 'bulk'],
    description: 'Demand collapses in a pandemic and snaps back with travel.',
  }),
  c({
    id: 'lng', name: 'Liquefied Natural Gas', category: 'energy', baseValue: 540, weightKg: 1000, volumeL: 2220,
    volatility: 0.55, availability: 0.5, baseDemand: 130, elasticity: 0.3, storage: 'hazardous',
    tags: ['energy', 'geopolitical', 'cryogenic'], unit: 't', forms: ['refined', 'bulk'],
    description: 'Weather and pipeline politics produce violent seasonal swings.',
  }),
  c({
    id: 'thermal_coal', name: 'Thermal Coal', category: 'energy', baseValue: 135, weightKg: 1000, volumeL: 740,
    volatility: 0.34, availability: 0.82, baseDemand: 240, elasticity: 0.44,
    tags: ['energy', 'bulk', 'declining'], unit: 't', forms: ['raw', 'bulk', 'sanctioned'],
    description: 'Structurally declining, cyclically essential.',
  }),
  c({
    id: 'ethanol', name: 'Ethanol', category: 'energy', baseValue: 720, weightKg: 1000, volumeL: 1270,
    volatility: 0.35, availability: 0.65, baseDemand: 100, elasticity: 0.5, storage: 'hazardous',
    tags: ['energy', 'biofuel', 'agri_linked'], unit: 't', forms: ['refined', 'bulk', 'industrial_grade'],
    description: 'Links crop prices to energy policy.',
  }),
  c({
    id: 'propane', name: 'Propane', category: 'energy', baseValue: 610, weightKg: 1000, volumeL: 1960,
    volatility: 0.3, availability: 0.78, baseDemand: 140, elasticity: 0.46, storage: 'hazardous',
    tags: ['energy', 'petrochemical_input'], unit: 't', forms: ['refined', 'bulk'], description: 'Heating, cooking and plastics feedstock.',
  }),

  /* -------------------------------- chemical -------------------------------- */
  c({
    id: 'sulfuric_acid', name: 'Sulfuric Acid', category: 'chemical', baseValue: 145, weightKg: 1000, volumeL: 545,
    volatility: 0.22, availability: 0.8, baseDemand: 180, elasticity: 0.5, storage: 'hazardous', risk: 0.15,
    tags: ['industrial_chemical', 'mining_input'], unit: 't', forms: ['industrial_grade', 'bulk', 'refined'],
    description: 'The most-produced industrial chemical; copper leaching consumes it.',
  }),
  c({
    id: 'ammonia', name: 'Ammonia', category: 'chemical', baseValue: 420, weightKg: 1000, volumeL: 1460,
    volatility: 0.4, availability: 0.75, baseDemand: 200, elasticity: 0.46, storage: 'hazardous',
    tags: ['fertiliser_input', 'gas_linked'], unit: 't', forms: ['industrial_grade', 'bulk', 'refined'],
    description: 'Made from gas; food production depends on it.',
  }),
  c({
    id: 'urea_fertiliser', name: 'Urea Fertiliser', category: 'chemical', baseValue: 385, weightKg: 1000, volumeL: 780,
    volatility: 0.42, availability: 0.8, baseDemand: 230, elasticity: 0.44,
    tags: ['agriculture_input', 'food_security'], unit: 't', forms: ['industrial_grade', 'bulk', 'processed'],
    description: 'Export restrictions here translate directly into harvest outcomes.',
  }),
  c({
    id: 'methanol', name: 'Methanol', category: 'chemical', baseValue: 340, weightKg: 1000, volumeL: 1260,
    volatility: 0.3, availability: 0.75, baseDemand: 150, elasticity: 0.5, storage: 'hazardous',
    tags: ['solvent', 'chemical_input'], unit: 't', forms: ['industrial_grade', 'bulk', 'refined'],
    description: 'Solvent and feedstock — also a controlled precursor in some jurisdictions.',
  }),
  c({
    id: 'ethylene', name: 'Ethylene', category: 'chemical', baseValue: 1050, weightKg: 1000, volumeL: 1760,
    volatility: 0.28, availability: 0.68, baseDemand: 130, elasticity: 0.48, storage: 'hazardous',
    tags: ['plastics_input'], unit: 't', forms: ['industrial_grade', 'bulk'], description: 'The base of the plastics pyramid.',
  }),
  c({
    id: 'benzene', name: 'Benzene', category: 'chemical', baseValue: 980, weightKg: 1000, volumeL: 1140,
    volatility: 0.3, availability: 0.7, baseDemand: 110, elasticity: 0.5, storage: 'hazardous', risk: 0.18,
    tags: ['aromatic', 'chemical_input'], unit: 't', forms: ['industrial_grade', 'bulk', 'refined'],
    description: 'Aromatics chain starter, tightly regulated for toxicity.',
  }),
  c({
    id: 'chlorine', name: 'Chlorine', category: 'chemical', baseValue: 210, weightKg: 1000, volumeL: 700,
    volatility: 0.2, availability: 0.8, baseDemand: 160, elasticity: 0.48, storage: 'hazardous', risk: 0.2,
    tags: ['water_treatment', 'chemical_input'], unit: 't', forms: ['industrial_grade', 'bulk'], description: 'Water treatment and PVC; a hazard to transport.',
  }),
  c({
    id: 'caustic_soda', name: 'Caustic Soda', category: 'chemical', baseValue: 340, weightKg: 1000, volumeL: 760,
    volatility: 0.22, availability: 0.8, baseDemand: 150, elasticity: 0.5, storage: 'hazardous',
    tags: ['industrial_chemical'], unit: 't', forms: ['industrial_grade', 'bulk'], description: 'Co-product of chlorine; alumina and pulp demand it.',
  }),
  c({
    id: 'acetone', name: 'Acetone', category: 'chemical', baseValue: 1150, weightKg: 1000, volumeL: 1270,
    volatility: 0.28, availability: 0.72, baseDemand: 95, elasticity: 0.52, storage: 'hazardous',
    tags: ['solvent'], unit: 't', forms: ['industrial_grade', 'pharma_grade', 'bulk'], description: 'Solvent with pharma and plastics demand.',
  }),
  c({
    id: 'toluene', name: 'Toluene', category: 'chemical', baseValue: 900, weightKg: 1000, volumeL: 1150,
    volatility: 0.3, availability: 0.7, baseDemand: 90, elasticity: 0.52, storage: 'hazardous', risk: 0.25, legality: 'restricted',
    tags: ['solvent', 'precursor'], unit: 't', forms: ['industrial_grade', 'refined', 'bulk'],
    description: 'Monitored in many countries because of its diversion potential.',
  }),
  c({
    id: 'pseudoephedrine', name: 'Pseudoephedrine Bulk', category: 'chemical', baseValue: 62, weightKg: 1, volumeL: 1.4,
    rarity: 3, volatility: 0.36, availability: 0.3, baseDemand: 90, elasticity: 0.34, legality: 'restricted', risk: 0.72,
    storage: 'secure', tags: ['precursor', 'pharma', 'controlled'], unit: 'kg', forms: ['pharma_grade', 'raw'],
    description: 'Legitimate decongestant, tightly tracked precursor. Paperwork is everything.',
  }),
  c({
    id: 'ephedrine', name: 'Ephedrine', category: 'chemical', baseValue: 145, weightKg: 1, volumeL: 1.5,
    rarity: 4, volatility: 0.4, availability: 0.18, baseDemand: 40, elasticity: 0.3, legality: 'illegal', risk: 0.86,
    storage: 'secure', tags: ['precursor', 'controlled', 'narcotics_input'], unit: 'kg', forms: ['pharma_grade', 'raw'],
    description: 'Schedule-controlled. Possession without licence is a felony nearly everywhere.',
  }),
  c({
    id: 'acetic_anhydride', name: 'Acetic Anhydride', category: 'chemical', baseValue: 2400, weightKg: 1000, volumeL: 920,
    rarity: 3, volatility: 0.38, availability: 0.3, baseDemand: 34, elasticity: 0.3, legality: 'restricted', risk: 0.8,
    storage: 'hazardous', tags: ['precursor', 'controlled'], unit: 't', forms: ['industrial_grade', 'refined'],
    description: 'Heroin processing precursor; international tracking regime applies.',
  }),
  c({
    id: 'potassium_permanganate', name: 'Potassium Permanganate', category: 'chemical', baseValue: 2900, weightKg: 1000, volumeL: 470,
    volatility: 0.26, availability: 0.55, baseDemand: 44, elasticity: 0.44, legality: 'restricted', risk: 0.6,
    tags: ['precursor', 'water_treatment'], unit: 't', forms: ['industrial_grade', 'raw'], description: 'Water treatment oxidiser, watched as a cocaine precursor.',
  }),
  c({
    id: 'epoxy_resin', name: 'Epoxy Resin', category: 'chemical', baseValue: 3800, weightKg: 1000, volumeL: 900,
    volatility: 0.24, availability: 0.7, baseDemand: 60, elasticity: 0.54, tags: ['industrial', 'composites'], unit: 't',
    forms: ['industrial_grade', 'processed'], description: 'Wind blades, boats and aerospace composites.',
  }),
  c({
    id: 'industrial_adhesives', name: 'Industrial Adhesives', category: 'chemical', baseValue: 2600, weightKg: 1000, volumeL: 950,
    volatility: 0.18, availability: 0.8, baseDemand: 90, elasticity: 0.56, tags: ['industrial', 'manufacturing_input'], unit: 't',
    forms: ['industrial_grade', 'packaged'], description: 'Every assembly line consumes it.',
  }),
  c({
    id: 'lubricants', name: 'Industrial Lubricants', category: 'chemical', baseValue: 2100, weightKg: 1000, volumeL: 1100,
    volatility: 0.2, availability: 0.85, baseDemand: 120, elasticity: 0.5, tags: ['industrial', 'maintenance'], unit: 't',
    forms: ['industrial_grade', 'packaged', 'bulk'], description: 'Machinery upkeep; demand tracks industrial output.',
  }),
];
