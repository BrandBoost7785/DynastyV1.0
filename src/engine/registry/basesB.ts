/**
 * Curated commodity base catalogue — part B (pharmaceuticals, narcotics,
 * technology, luxuries, weapons, information and instruments).
 */

import { c } from './baseTypes';
import type { BaseCommodity } from './baseTypes';

export const BASE_COMMODITIES_B: BaseCommodity[] = [
  /* ----------------------------- pharmaceutical ----------------------------- */
  c({
    id: 'antibiotics', name: 'Antibiotics', category: 'pharmaceutical', baseValue: 38, weightKg: 0.05, volumeL: 0.12,
    volatility: 0.26, availability: 0.75, baseDemand: 220, elasticity: 0.28, shelfLifeDays: 900, storage: 'climate',
    legality: 'restricted', risk: 0.2, tags: ['essential', 'regulated', 'inelastic'], unit: 'course',
    forms: ['pharma_grade', 'packaged', 'bulk', 'generic', 'counterfeit'],
    description: 'Demand does not respond to price when people are infected.',
  }),
  c({
    id: 'insulin', name: 'Insulin', category: 'pharmaceutical', baseValue: 96, weightKg: 0.03, volumeL: 0.06,
    rarity: 3, volatility: 0.3, availability: 0.5, baseDemand: 140, elasticity: 0.12, shelfLifeDays: 540,
    storage: 'refrigerated', legality: 'restricted', risk: 0.22, tags: ['essential', 'cold_chain', 'inelastic'], unit: 'vial',
    forms: ['pharma_grade', 'packaged'], description: 'Perfectly inessential to skip. Cold chain is mandatory.',
  }),
  c({
    id: 'painkillers', name: 'Analgesics', category: 'pharmaceutical', baseValue: 14, weightKg: 0.03, volumeL: 0.08,
    volatility: 0.22, availability: 0.9, baseDemand: 520, elasticity: 0.34, shelfLifeDays: 1080,
    legality: 'restricted', risk: 0.24, tags: ['medical', 'regulated', 'diversion_risk'], unit: 'pack',
    forms: ['pharma_grade', 'packaged', 'bulk', 'counterfeit'], description: 'Legal in pharmacies, diverted everywhere else.',
  }),
  c({
    id: 'opioid_painkillers', name: 'Opioid Analgesics', category: 'pharmaceutical', baseValue: 62, weightKg: 0.02, volumeL: 0.05,
    rarity: 3, volatility: 0.34, availability: 0.4, baseDemand: 180, elasticity: 0.18, shelfLifeDays: 1080,
    legality: 'restricted', risk: 0.88, storage: 'secure', tags: ['controlled', 'diversion_risk', 'addictive'], unit: 'pack',
    forms: ['pharma_grade', 'packaged'], description: 'Prescription-only. Diversion is a serious felony with high margins.',
  }),
  c({
    id: 'vaccines', name: 'Vaccines', category: 'pharmaceutical', baseValue: 24, weightKg: 0.02, volumeL: 0.04,
    rarity: 3, volatility: 0.44, availability: 0.4, baseDemand: 260, elasticity: 0.1, shelfLifeDays: 360,
    storage: 'refrigerated', legality: 'restricted', risk: 0.2, tags: ['essential', 'cold_chain', 'government_contract'], unit: 'dose',
    forms: ['pharma_grade', 'packaged'], description: 'Demand arrives in waves with outbreaks; governments are the buyer.',
  }),
  c({
    id: 'antivirals', name: 'Antivirals', category: 'pharmaceutical', baseValue: 88, weightKg: 0.04, volumeL: 0.1,
    volatility: 0.4, availability: 0.45, baseDemand: 150, elasticity: 0.16, shelfLifeDays: 720, storage: 'climate',
    legality: 'restricted', risk: 0.24, tags: ['medical', 'pandemic_linked'], unit: 'course',
    forms: ['pharma_grade', 'packaged', 'bulk'], description: 'Outbreak-driven demand spikes.',
  }),
  c({
    id: 'statins', name: 'Generic Statins', category: 'pharmaceutical', baseValue: 6.5, weightKg: 0.02, volumeL: 0.05,
    volatility: 0.14, availability: 0.9, baseDemand: 640, elasticity: 0.4, shelfLifeDays: 1080,
    tags: ['medical', 'chronic', 'generic'], unit: 'pack', forms: ['pharma_grade', 'packaged', 'bulk'],
    description: 'High-volume chronic medication with thin margins.',
  }),
  c({
    id: 'anesthetics', name: 'Anesthetics', category: 'pharmaceutical', baseValue: 210, weightKg: 0.06, volumeL: 0.12,
    rarity: 3, volatility: 0.3, availability: 0.4, baseDemand: 70, elasticity: 0.2, shelfLifeDays: 720,
    storage: 'secure', legality: 'restricted', risk: 0.72, tags: ['controlled', 'hospital'], unit: 'kit',
    forms: ['pharma_grade', 'packaged'], description: 'Hospital-only, strictly controlled, extremely valuable in the wrong hands.',
  }),
  c({
    id: 'adhd_medication', name: 'ADHD Medication', category: 'pharmaceutical', baseValue: 74, weightKg: 0.02, volumeL: 0.05,
    rarity: 3, volatility: 0.32, availability: 0.45, baseDemand: 190, elasticity: 0.2, shelfLifeDays: 900,
    legality: 'restricted', risk: 0.78, storage: 'secure', tags: ['controlled', 'diversion_risk', 'student_demand'], unit: 'pack',
    forms: ['pharma_grade', 'packaged'], description: 'Chronic shortage plus a recreational market.',
  }),
  c({
    id: 'sedatives', name: 'Sedatives', category: 'pharmaceutical', baseValue: 42, weightKg: 0.02, volumeL: 0.05,
    volatility: 0.26, availability: 0.6, baseDemand: 240, elasticity: 0.24, shelfLifeDays: 1080,
    legality: 'restricted', risk: 0.66, storage: 'secure', tags: ['controlled', 'diversion_risk'], unit: 'pack',
    forms: ['pharma_grade', 'packaged', 'counterfeit'], description: 'Prescribed widely, diverted constantly.',
  }),
  c({
    id: 'experimental_drug', name: 'Experimental Compound', category: 'pharmaceutical', baseValue: 4200, weightKg: 0.05, volumeL: 0.1,
    rarity: 5, volatility: 0.6, availability: 0.06, baseDemand: 12, elasticity: 0.12, shelfLifeDays: 180,
    storage: 'refrigerated', legality: 'illegal', risk: 0.9, tags: ['unapproved', 'biotech', 'black_market'], unit: 'vial',
    forms: ['pharma_grade'], description: 'Unapproved trial material. Enormous value, enormous liability.',
  }),
  c({
    id: 'veterinary_meds', name: 'Veterinary Medicine', category: 'pharmaceutical', baseValue: 28, weightKg: 0.1, volumeL: 0.25,
    volatility: 0.2, availability: 0.72, baseDemand: 180, elasticity: 0.42, shelfLifeDays: 900,
    legality: 'restricted', risk: 0.35, tags: ['medical', 'agricultural', 'diversion_risk'], unit: 'pack',
    forms: ['pharma_grade', 'packaged', 'bulk'], description: 'Livestock and pets — and a known diversion channel.',
  }),

  /* -------------------------------- narcotic -------------------------------- */
  c({
    id: 'cannabis', name: 'Cannabis', category: 'narcotic', baseValue: 3400, weightKg: 1, volumeL: 8,
    volatility: 0.32, availability: 0.7, baseDemand: 420, elasticity: 0.42, shelfLifeDays: 540,
    legality: 'illegal', risk: 0.42, storage: 'climate', marketTypes: ['black', 'darknet', 'licensed'],
    tags: ['drug', 'bulky', 'decriminalising'], unit: 'kg', forms: ['raw', 'premium', 'extract', 'packaged'],
    description: 'Legal in some jurisdictions and criminal in others — a jurisdictional arbitrage classic.',
  }),
  c({
    id: 'cocaine', name: 'Cocaine', category: 'narcotic', baseValue: 42000, weightKg: 1, volumeL: 1.4,
    rarity: 4, volatility: 0.38, availability: 0.3, baseDemand: 120, elasticity: 0.22, shelfLifeDays: null,
    legality: 'illegal', risk: 0.94, storage: 'secure', marketTypes: ['black', 'darknet'],
    tags: ['drug', 'high_value', 'precursor_tracked', 'cartel'], unit: 'kg',
    forms: ['raw', 'refined', 'premium', 'cut'], description: 'Production concentrated in three countries; interdiction drives price.',
  }),
  c({
    id: 'heroin', name: 'Heroin', category: 'narcotic', baseValue: 38000, weightKg: 1, volumeL: 1.5,
    rarity: 4, volatility: 0.42, availability: 0.24, baseDemand: 90, elasticity: 0.16, shelfLifeDays: null,
    legality: 'illegal', risk: 0.96, storage: 'secure', marketTypes: ['black'], tags: ['drug', 'high_value', 'opiate'], unit: 'kg',
    forms: ['raw', 'refined', 'premium', 'cut'], description: 'Opium-derived; harvest failure in one valley moves global price.',
  }),
  c({
    id: 'methamphetamine', name: 'Methamphetamine', category: 'narcotic', baseValue: 26000, weightKg: 1, volumeL: 1.3,
    rarity: 3, volatility: 0.44, availability: 0.35, baseDemand: 110, elasticity: 0.2, legality: 'illegal', risk: 0.93,
    storage: 'secure', marketTypes: ['black'], tags: ['drug', 'synthetic', 'precursor_tracked'], unit: 'kg',
    forms: ['raw', 'refined', 'premium', 'cut'], description: 'Made anywhere precursors arrive — supply is a chemistry problem.',
  }),
  c({
    id: 'mdma', name: 'MDMA', category: 'narcotic', baseValue: 21000, weightKg: 1, volumeL: 1.6,
    rarity: 3, volatility: 0.4, availability: 0.35, baseDemand: 130, elasticity: 0.26, legality: 'illegal', risk: 0.88,
    storage: 'secure', marketTypes: ['black', 'darknet'], tags: ['drug', 'synthetic', 'nightlife'], unit: 'kg',
    forms: ['raw', 'premium', 'packaged'], description: 'Demand is seasonal and event-driven — festivals are a business cycle.',
  }),
  c({
    id: 'lsd', name: 'LSD', category: 'narcotic', baseValue: 220000, weightKg: 1, volumeL: 6,
    rarity: 5, volatility: 0.5, availability: 0.1, baseDemand: 22, elasticity: 0.24, legality: 'illegal', risk: 0.9,
    storage: 'refrigerated', marketTypes: ['black', 'darknet'], tags: ['drug', 'synthetic', 'ultra_high_value'], unit: 'kg',
    forms: ['raw', 'premium'], description: 'Absurd value density; a kilo is a lifetime of supply.',
  }),
  c({
    id: 'ketamine', name: 'Ketamine', category: 'narcotic', baseValue: 18000, weightKg: 1, volumeL: 1.5,
    rarity: 3, volatility: 0.36, availability: 0.32, baseDemand: 95, elasticity: 0.28, legality: 'illegal', risk: 0.84,
    storage: 'secure', marketTypes: ['black', 'darknet'], tags: ['drug', 'medical_diversion'], unit: 'kg',
    forms: ['raw', 'pharma_grade', 'premium'], description: 'A legitimate anesthetic with a large parallel market.',
  }),
  c({
    id: 'psilocybin', name: 'Psilocybin Truffles', category: 'narcotic', baseValue: 9000, weightKg: 1, volumeL: 4,
    rarity: 3, volatility: 0.34, availability: 0.3, baseDemand: 80, elasticity: 0.3, legality: 'illegal', risk: 0.62,
    shelfLifeDays: 90, storage: 'refrigerated', marketTypes: ['black', 'darknet'], tags: ['drug', 'natural', 'decriminalising'], unit: 'kg',
    forms: ['raw', 'premium', 'packaged'], description: 'Perishable and increasingly tolerated in some jurisdictions.',
  }),
  c({
    id: 'opium', name: 'Raw Opium', category: 'narcotic', baseValue: 4200, weightKg: 1, volumeL: 1.6,
    rarity: 3, volatility: 0.4, availability: 0.22, baseDemand: 60, elasticity: 0.3, legality: 'illegal', risk: 0.9,
    tags: ['drug', 'agricultural', 'precursor'], unit: 'kg', forms: ['raw', 'unsorted'],
    description: 'The upstream input; processing it multiplies value and risk.',
  }),
  c({
    id: 'fentanyl_analogue', name: 'Synthetic Opioid', category: 'narcotic', baseValue: 340000, weightKg: 1, volumeL: 1.4,
    rarity: 5, volatility: 0.55, availability: 0.08, baseDemand: 30, elasticity: 0.14, legality: 'contraband', risk: 0.99,
    storage: 'secure', marketTypes: ['darknet'], tags: ['drug', 'synthetic', 'extreme_risk', 'lethal'], unit: 'kg',
    forms: ['raw', 'refined'], description: 'Catastrophic legal and physical risk. Enforcement prioritises it above all else.',
  }),
  c({
    id: 'designer_stims', name: 'Designer Stimulants', category: 'narcotic', baseValue: 15000, weightKg: 1, volumeL: 1.6,
    rarity: 3, volatility: 0.52, availability: 0.2, baseDemand: 70, elasticity: 0.26, legality: 'illegal', risk: 0.9,
    marketTypes: ['black', 'darknet'], tags: ['drug', 'synthetic', 'novel_psychoactive'], unit: 'kg',
    forms: ['raw', 'premium', 'packaged'], description: 'New analogues appear, get scheduled, and vanish from legal trade.',
  }),
  c({
    id: 'khat', name: 'Khat', category: 'narcotic', baseValue: 1200, weightKg: 1, volumeL: 6,
    volatility: 0.3, availability: 0.35, baseDemand: 120, elasticity: 0.36, shelfLifeDays: 3, legality: 'restricted', risk: 0.5,
    storage: 'refrigerated', marketTypes: ['public', 'black'], tags: ['drug', 'perishable', 'regional'], unit: 'kg',
    forms: ['raw', 'fresh'], description: 'Legal in some countries, banned in others, spoils in 72 hours.',
    regions: ['east_africa', 'arabia'],
  }),

  /* --------------------------------- medical -------------------------------- */
  c({
    id: 'surgical_equipment', name: 'Surgical Equipment', category: 'medical', baseValue: 4200, weightKg: 45, volumeL: 220,
    rarity: 3, volatility: 0.22, availability: 0.45, baseDemand: 26, elasticity: 0.34, tags: ['hospital', 'high_value'], unit: 'unit',
    forms: ['assembled', 'medical_grade', 'salvaged'],
    description: 'Hospital capital equipment; procurement cycles are long and political.',
  }),
  c({
    id: 'diagnostic_kits', name: 'Diagnostic Kits', category: 'medical', baseValue: 24, weightKg: 0.3, volumeL: 0.8,
    volatility: 0.36, availability: 0.65, baseDemand: 300, elasticity: 0.3, shelfLifeDays: 540, storage: 'climate',
    tags: ['medical', 'outbreak_linked'], unit: 'kit', forms: ['medical_grade', 'packaged'],
    description: 'Demand explodes during outbreaks and collapses afterwards.',
  }),
  c({
    id: 'lab_reagents', name: 'Laboratory Reagents', category: 'medical', baseValue: 380, weightKg: 1, volumeL: 1.2,
    rarity: 3, volatility: 0.28, availability: 0.45, baseDemand: 70, elasticity: 0.36, shelfLifeDays: 360,
    storage: 'refrigerated', legality: 'restricted', risk: 0.24, tags: ['research', 'cold_chain', 'dual_use'], unit: 'kit',
    forms: ['pharma_grade', 'packaged'], description: 'Research and diagnostics; several reagents are dual-use controlled.',
  }),
  c({
    id: 'medical_isotopes', name: 'Medical Isotopes', category: 'medical', baseValue: 22000, weightKg: 0.4, volumeL: 0.6,
    rarity: 5, volatility: 0.4, availability: 0.1, baseDemand: 12, elasticity: 0.18, shelfLifeDays: 12,
    storage: 'hazardous', legality: 'restricted', risk: 0.6, tags: ['nuclear', 'cold_chain', 'hospital'], unit: 'dose',
    forms: ['pharma_grade'], description: 'Decays in days and needs a reactor. Supply is two or three facilities deep.',
  }),
  c({
    id: 'prosthetics', name: 'Prosthetic Limbs', category: 'medical', baseValue: 8600, weightKg: 6, volumeL: 34,
    rarity: 3, volatility: 0.2, availability: 0.35, baseDemand: 18, elasticity: 0.3, tags: ['medical', 'high_value'], unit: 'unit',
    forms: ['assembled', 'premium', 'medical_grade'], description: 'Demand rises after conflicts and disasters.',
  }),
  c({
    id: 'blood_plasma', name: 'Blood Plasma', category: 'medical', baseValue: 190, weightKg: 0.7, volumeL: 0.7,
    rarity: 4, volatility: 0.3, availability: 0.25, baseDemand: 60, elasticity: 0.2, shelfLifeDays: 365,
    storage: 'refrigerated', legality: 'restricted', risk: 0.5, tags: ['medical', 'cold_chain', 'regulated'], unit: 'unit',
    forms: ['pharma_grade'], description: 'Donor-dependent, cold-chain-bound, strictly regulated.',
  }),

  /* ------------------------------- manufactured ----------------------------- */
  c({
    id: 'machine_tools', name: 'Machine Tools', category: 'manufactured', baseValue: 34000, weightKg: 2200, volumeL: 6000,
    rarity: 3, volatility: 0.2, availability: 0.4, baseDemand: 8, elasticity: 0.4, tags: ['capital_goods', 'industrial'], unit: 'unit',
    forms: ['assembled', 'industrial_grade', 'military_spec', 'salvaged'],
    description: 'The machines that make machines; export-controlled at the high end.',
  }),
  c({
    id: 'bearings', name: 'Precision Bearings', category: 'manufactured', baseValue: 145, weightKg: 1.2, volumeL: 1.4,
    volatility: 0.18, availability: 0.8, baseDemand: 220, elasticity: 0.5, tags: ['industrial', 'component'], unit: 'unit',
    forms: ['component', 'industrial_grade', 'military_spec'], description: 'Small, essential, and a classic bottleneck part.',
  }),
  c({
    id: 'pumps', name: 'Industrial Pumps', category: 'manufactured', baseValue: 2400, weightKg: 120, volumeL: 400,
    volatility: 0.19, availability: 0.7, baseDemand: 40, elasticity: 0.48, tags: ['industrial'], unit: 'unit',
    forms: ['assembled', 'industrial_grade', 'salvaged'], description: 'Water, oil and chemical handling.',
  }),
  c({
    id: 'generators', name: 'Diesel Generators', category: 'manufactured', baseValue: 8600, weightKg: 900, volumeL: 3200,
    volatility: 0.26, availability: 0.6, baseDemand: 30, elasticity: 0.42, tags: ['industrial', 'disaster_demand'], unit: 'unit',
    forms: ['assembled', 'industrial_grade', 'salvaged'], description: 'Demand spikes violently after grid failures and storms.',
  }),
  c({
    id: 'power_cables', name: 'Power Cables', category: 'manufactured', baseValue: 3200, weightKg: 1000, volumeL: 900,
    volatility: 0.24, availability: 0.75, baseDemand: 90, elasticity: 0.5, tags: ['infrastructure', 'copper_linked'], unit: 't',
    forms: ['assembled', 'industrial_grade', 'scrap'], description: 'Copper price flows straight through, and theft is endemic.',
  }),
  c({
    id: 'transformers', name: 'Grid Transformers', category: 'manufactured', baseValue: 62000, weightKg: 8000, volumeL: 22000,
    rarity: 4, volatility: 0.28, availability: 0.3, baseDemand: 5, elasticity: 0.3, tags: ['infrastructure', 'long_lead'], unit: 'unit',
    forms: ['assembled', 'industrial_grade', 'salvaged'], description: 'Multi-year lead times; a shortage blackouts a region.',
  }),
  c({
    id: 'solar_panels', name: 'Solar Panels', category: 'manufactured', baseValue: 180, weightKg: 22, volumeL: 60,
    volatility: 0.32, availability: 0.75, baseDemand: 120, elasticity: 0.5, tags: ['renewable', 'policy_driven'], unit: 'panel',
    forms: ['assembled', 'premium', 'salvaged'], description: 'Policy subsidies and tariff walls swing demand wildly.',
  }),
  c({
    id: 'wind_turbine_parts', name: 'Wind Turbine Components', category: 'manufactured', baseValue: 240000, weightKg: 42000, volumeL: 90000,
    rarity: 4, volatility: 0.26, availability: 0.25, baseDemand: 2, elasticity: 0.34, tags: ['renewable', 'oversized'], unit: 'set',
    forms: ['assembled', 'industrial_grade'], description: 'Oversized cargo; only certain ports and routes can handle it.',
  }),
  c({
    id: 'hvac_units', name: 'HVAC Units', category: 'manufactured', baseValue: 3400, weightKg: 180, volumeL: 900,
    volatility: 0.22, availability: 0.72, baseDemand: 60, elasticity: 0.5, tags: ['construction', 'climate_driven'], unit: 'unit',
    forms: ['assembled', 'industrial_grade', 'salvaged'], description: 'Heatwaves turn a slow market into a shortage.',
  }),
  c({
    id: 'fasteners', name: 'Industrial Fasteners', category: 'manufactured', baseValue: 2900, weightKg: 1000, volumeL: 240,
    volatility: 0.16, availability: 0.88, baseDemand: 150, elasticity: 0.52, tags: ['industrial', 'component'], unit: 't',
    forms: ['component', 'industrial_grade', 'bulk'], description: 'Unremarkable until an assembly line stops without them.',
  }),
  c({
    id: 'packaging_material', name: 'Packaging Material', category: 'manufactured', baseValue: 1400, weightKg: 1000, volumeL: 3600,
    volatility: 0.2, availability: 0.85, baseDemand: 200, elasticity: 0.54, tags: ['industrial', 'bulky'], unit: 't',
    forms: ['processed', 'bulk'], description: 'Consumer demand derivative; extremely bulky.',
  }),

  /* ------------------------------- electronics ------------------------------ */
  c({
    id: 'smartphones', name: 'Smartphones', category: 'electronics', baseValue: 420, weightKg: 0.22, volumeL: 0.5,
    volatility: 0.22, availability: 0.9, baseDemand: 320, elasticity: 0.58, tags: ['consumer', 'high_value_density'], unit: 'unit',
    forms: ['assembled', 'premium', 'salvaged', 'counterfeit'],
    description: 'High value per kilo — ideal cargo, and a magnet for theft.',
  }),
  c({
    id: 'laptops', name: 'Laptops', category: 'electronics', baseValue: 780, weightKg: 1.8, volumeL: 3.4,
    volatility: 0.2, availability: 0.85, baseDemand: 190, elasticity: 0.58, tags: ['consumer', 'technology'], unit: 'unit',
    forms: ['assembled', 'premium', 'salvaged', 'counterfeit'], description: 'Enterprise refresh cycles drive bulk demand.',
  }),
  c({
    id: 'gpus', name: 'Graphics Processors', category: 'electronics', baseValue: 1400, weightKg: 1.4, volumeL: 3.2,
    rarity: 4, volatility: 0.52, availability: 0.4, baseDemand: 90, elasticity: 0.3, tags: ['ai', 'shortage_prone', 'export_controlled'], unit: 'unit',
    forms: ['assembled', 'premium', 'military_spec'], description: 'AI demand and export controls create chronic shortages.',
  }),
  c({
    id: 'cpus', name: 'Server CPUs', category: 'electronics', baseValue: 2400, weightKg: 0.25, volumeL: 0.4,
    rarity: 4, volatility: 0.4, availability: 0.45, baseDemand: 60, elasticity: 0.32, tags: ['datacenter', 'export_controlled'], unit: 'unit',
    forms: ['assembled', 'premium'], description: 'Tiny, valuable, and licensable.',
  }),
  c({
    id: 'memory_modules', name: 'Memory Modules', category: 'electronics', baseValue: 180, weightKg: 0.06, volumeL: 0.15,
    volatility: 0.5, availability: 0.75, baseDemand: 260, elasticity: 0.44, tags: ['component', 'cyclical'], unit: 'unit',
    forms: ['component', 'premium'], description: 'A textbook cyclical: boom, glut, crash, repeat.',
  }),
  c({
    id: 'ssd_drives', name: 'Solid State Drives', category: 'electronics', baseValue: 220, weightKg: 0.1, volumeL: 0.2,
    volatility: 0.46, availability: 0.75, baseDemand: 240, elasticity: 0.46, tags: ['component', 'cyclical'], unit: 'unit',
    forms: ['component', 'premium', 'salvaged'], description: 'NAND cycles make this a trader\'s favourite.',
  }),
  c({
    id: 'server_racks', name: 'Server Racks', category: 'electronics', baseValue: 18000, weightKg: 420, volumeL: 1800,
    rarity: 3, volatility: 0.3, availability: 0.45, baseDemand: 14, elasticity: 0.36, tags: ['datacenter', 'ai'], unit: 'rack',
    forms: ['assembled', 'premium', 'salvaged'], description: 'Datacenter capex arrives in racks.',
  }),
  c({
    id: 'network_switches', name: 'Network Switches', category: 'electronics', baseValue: 3400, weightKg: 9, volumeL: 24,
    volatility: 0.24, availability: 0.65, baseDemand: 45, elasticity: 0.44, tags: ['networking', 'datacenter'], unit: 'unit',
    forms: ['assembled', 'premium', 'salvaged'], description: 'Backbone infrastructure with vendor lock-in premiums.',
  }),
  c({
    id: 'drones', name: 'Commercial Drones', category: 'electronics', baseValue: 2200, weightKg: 4.5, volumeL: 22,
    rarity: 3, volatility: 0.36, availability: 0.5, baseDemand: 55, elasticity: 0.4, legality: 'restricted', risk: 0.3,
    tags: ['aviation', 'dual_use', 'regulated'], unit: 'unit', forms: ['assembled', 'premium', 'military_spec', 'weaponised'],
    description: 'Civilian, survey and — where tolerated — militarised variants.',
  }),
  c({
    id: 'sensors', name: 'Industrial Sensors', category: 'electronics', baseValue: 320, weightKg: 0.3, volumeL: 0.6,
    volatility: 0.22, availability: 0.7, baseDemand: 180, elasticity: 0.5, tags: ['component', 'automation'], unit: 'unit',
    forms: ['component', 'premium', 'military_spec'], description: 'Automation demand grows steadily.',
  }),
  c({
    id: 'circuit_boards', name: 'Printed Circuit Boards', category: 'electronics', baseValue: 95, weightKg: 0.4, volumeL: 0.8,
    volatility: 0.24, availability: 0.78, baseDemand: 300, elasticity: 0.52, tags: ['component', 'electronics_input'], unit: 'unit',
    forms: ['component', 'industrial_grade', 'premium'], description: 'The universal substrate of electronics manufacturing.',
  }),
  c({
    id: 'displays', name: 'Display Panels', category: 'electronics', baseValue: 260, weightKg: 2.6, volumeL: 12,
    volatility: 0.34, availability: 0.7, baseDemand: 200, elasticity: 0.5, tags: ['component', 'cyclical', 'fragile'], unit: 'unit',
    forms: ['component', 'premium'], description: 'Fragile, cyclical, and priced by fab utilisation.',
  }),
  c({
    id: 'satellite_phones', name: 'Satellite Phones', category: 'electronics', baseValue: 1800, weightKg: 0.5, volumeL: 1.2,
    rarity: 4, volatility: 0.3, availability: 0.3, baseDemand: 25, elasticity: 0.36, legality: 'restricted', risk: 0.55,
    tags: ['comms', 'regulated', 'remote'], unit: 'unit', forms: ['assembled', 'military_spec'],
    description: 'Banned or licensed in many jurisdictions; indispensable in others.',
  }),

  /* ------------------------------- technology ------------------------------- */
  c({
    id: 'semiconductor_wafers', name: 'Semiconductor Wafers', category: 'technology', baseValue: 12000, weightKg: 5, volumeL: 8,
    rarity: 5, volatility: 0.42, availability: 0.22, baseDemand: 22, elasticity: 0.26, legality: 'restricted', risk: 0.3,
    storage: 'climate', tags: ['strategic', 'export_controlled', 'technology'], unit: 'lot',
    forms: ['industrial_grade', 'premium', 'military_spec'], description: 'The most strategically sensitive cargo in the world economy.',
  }),
  c({
    id: 'lithography_parts', name: 'Lithography Components', category: 'technology', baseValue: 420000, weightKg: 240, volumeL: 900,
    rarity: 5, volatility: 0.34, availability: 0.08, baseDemand: 3, elasticity: 0.18, legality: 'restricted', risk: 0.5,
    tags: ['strategic', 'export_controlled', 'monopoly'], unit: 'set', forms: ['industrial_grade', 'military_spec'],
    description: 'One supplier on earth. Export licences are geopolitical instruments.',
  }),
  c({
    id: 'ai_accelerators', name: 'AI Accelerators', category: 'technology', baseValue: 28000, weightKg: 3.2, volumeL: 6,
    rarity: 5, volatility: 0.58, availability: 0.18, baseDemand: 30, elasticity: 0.22, legality: 'restricted', risk: 0.35,
    tags: ['ai', 'export_controlled', 'shortage_prone'], unit: 'unit', forms: ['assembled', 'premium', 'military_spec'],
    description: 'Demand outstrips supply in every cycle; smuggling is lucrative.',
  }),
  c({
    id: 'industrial_robots', name: 'Industrial Robot Arms', category: 'technology', baseValue: 68000, weightKg: 900, volumeL: 4200,
    rarity: 4, volatility: 0.26, availability: 0.3, baseDemand: 6, elasticity: 0.38, tags: ['automation', 'capital_goods'], unit: 'unit',
    forms: ['assembled', 'industrial_grade', 'salvaged'], description: 'The physical engine of production automation.',
  }),
  c({
    id: 'lidar_units', name: 'LiDAR Units', category: 'technology', baseValue: 4200, weightKg: 1.6, volumeL: 4,
    rarity: 4, volatility: 0.4, availability: 0.35, baseDemand: 30, elasticity: 0.34, legality: 'restricted', risk: 0.2,
    tags: ['autonomy', 'sensor', 'dual_use'], unit: 'unit', forms: ['assembled', 'premium', 'military_spec'],
    description: 'Autonomous vehicle and defence sensing.',
  }),
  c({
    id: 'encryption_hardware', name: 'Hardware Security Modules', category: 'technology', baseValue: 22000, weightKg: 8, volumeL: 16,
    rarity: 4, volatility: 0.3, availability: 0.3, baseDemand: 18, elasticity: 0.32, legality: 'restricted', risk: 0.35,
    tags: ['security', 'finance', 'export_controlled'], unit: 'unit', forms: ['assembled', 'encrypted', 'military_spec'],
    description: 'Banks, exchanges and governments need them; exports are controlled.',
  }),
  c({
    id: 'quantum_components', name: 'Quantum Components', category: 'technology', baseValue: 950000, weightKg: 120, volumeL: 600,
    rarity: 5, volatility: 0.5, availability: 0.05, baseDemand: 1.4, elasticity: 0.2, legality: 'restricted', risk: 0.45,
    storage: 'climate', tags: ['frontier', 'strategic', 'research'], unit: 'cryostat',
    forms: ['industrial_grade'], description: 'Cryogenic research hardware. A handful of buyers worldwide.',
  }),
  c({
    id: 'software_licenses', name: 'Industrial Software Licences', category: 'technology', baseValue: 14000, weightKg: 0, volumeL: 0,
    rarity: 3, volatility: 0.22, availability: 0.6, baseDemand: 26, elasticity: 0.4, legality: 'restricted', risk: 0.3,
    tags: ['intangible', 'piracy_risk'], unit: 'seat', forms: ['encrypted', 'redacted'],
    description: 'Zero weight, high value — and a thriving grey market in keys.',
  }),
  c({
    id: 'biotech_cultures', name: 'Biotech Cultures', category: 'technology', baseValue: 86000, weightKg: 2, volumeL: 6,
    rarity: 5, volatility: 0.44, availability: 0.1, baseDemand: 8, elasticity: 0.22, shelfLifeDays: 60,
    storage: 'refrigerated', legality: 'restricted', risk: 0.6, tags: ['biotech', 'dual_use', 'cold_chain'], unit: 'vial',
    forms: ['pharma_grade'], description: 'Export-controlled biological material with obvious dual-use concerns.',
  }),
  c({
    id: 'industrial_3d_printers', name: 'Industrial 3D Printers', category: 'technology', baseValue: 46000, weightKg: 620, volumeL: 2400,
    rarity: 4, volatility: 0.28, availability: 0.35, baseDemand: 9, elasticity: 0.4, tags: ['automation', 'capital_goods', 'dual_use'], unit: 'unit',
    forms: ['assembled', 'industrial_grade', 'salvaged'], description: 'Manufacturing flexibility — and untraceable parts production.',
  }),

  /* --------------------------------- luxury --------------------------------- */
  c({
    id: 'luxury_watches', name: 'Luxury Watches', category: 'luxury', baseValue: 18000, weightKg: 0.18, volumeL: 0.4,
    rarity: 4, volatility: 0.26, availability: 0.4, baseDemand: 22, elasticity: 0.3, storage: 'secure',
    tags: ['luxury', 'store_of_value', 'counterfeit_target'], unit: 'piece',
    forms: ['premium', 'vintage', 'counterfeit', 'salvaged'],
    description: 'Portable wealth. Grey-market spreads between cities are wide.',
  }),
  c({
    id: 'diamonds', name: 'Rough Diamonds', category: 'luxury', baseValue: 320000, weightKg: 1, volumeL: 0.28,
    rarity: 5, volatility: 0.3, availability: 0.14, baseDemand: 14, elasticity: 0.26, storage: 'secure',
    legality: 'restricted', risk: 0.62, tags: ['luxury', 'conflict_mineral', 'kimberley'], unit: 'kg',
    forms: ['raw', 'premium', 'salvaged'], description: 'Certification regimes exist precisely because provenance is dangerous.',
  }),
  c({
    id: 'cut_diamonds', name: 'Cut Diamonds', category: 'luxury', baseValue: 1400000, weightKg: 1, volumeL: 0.28,
    rarity: 5, volatility: 0.24, availability: 0.12, baseDemand: 8, elasticity: 0.24, storage: 'secure',
    tags: ['luxury', 'high_value_density'], unit: 'kg', forms: ['premium', 'vintage'],
    description: 'Cutting multiplies value several times over.',
  }),
  c({
    id: 'emeralds', name: 'Emeralds', category: 'luxury', baseValue: 620000, weightKg: 1, volumeL: 0.3,
    rarity: 5, volatility: 0.34, availability: 0.1, baseDemand: 7, elasticity: 0.28, storage: 'secure',
    tags: ['luxury', 'gemstone', 'origin_premium'], unit: 'kg', forms: ['raw', 'premium'],
    description: 'Origin determines value more than carat.',
  }),
  c({
    id: 'rubies', name: 'Rubies', category: 'luxury', baseValue: 540000, weightKg: 1, volumeL: 0.3,
    rarity: 5, volatility: 0.32, availability: 0.1, baseDemand: 7, elasticity: 0.28, storage: 'secure',
    tags: ['luxury', 'gemstone', 'sanctioned'], unit: 'kg', forms: ['raw', 'premium', 'sanctioned'],
    description: 'Certain origins are embargoed outright.',
  }),
  c({
    id: 'designer_handbags', name: 'Designer Handbags', category: 'luxury', baseValue: 4200, weightKg: 1.2, volumeL: 8,
    rarity: 3, volatility: 0.24, availability: 0.5, baseDemand: 60, elasticity: 0.34, tags: ['luxury', 'counterfeit_target', 'fashion'], unit: 'piece',
    forms: ['premium', 'counterfeit', 'vintage'], description: 'Counterfeits can outsell the genuine article.',
  }),
  c({
    id: 'fine_art', name: 'Fine Art', category: 'art', baseValue: 240000, weightKg: 24, volumeL: 240,
    rarity: 5, volatility: 0.3, availability: 0.1, baseDemand: 3, elasticity: 0.22, storage: 'climate',
    tags: ['luxury', 'illiquid', 'provenance', 'theft_target'], unit: 'piece', forms: ['vintage', 'premium', 'salvaged'],
    description: 'Provenance is everything; looted works are unsellable in the open.',
  }),
  c({
    id: 'antiquities', name: 'Antiquities', category: 'art', baseValue: 96000, weightKg: 40, volumeL: 300,
    rarity: 5, volatility: 0.32, availability: 0.08, baseDemand: 3.5, elasticity: 0.24, legality: 'restricted', risk: 0.7,
    tags: ['luxury', 'cultural_heritage', 'looting_risk'], unit: 'piece', forms: ['vintage', 'salvaged'],
    description: 'Legal provenance required; conflict-zone looting is a serious crime.',
  }),
  c({
    id: 'rare_coins', name: 'Rare Coins', category: 'art', baseValue: 42000, weightKg: 0.4, volumeL: 0.3,
    rarity: 4, volatility: 0.22, availability: 0.2, baseDemand: 12, elasticity: 0.3, storage: 'secure',
    tags: ['collectible', 'numismatic'], unit: 'set', forms: ['premium', 'vintage', 'counterfeit'],
    description: 'A collector market with its own grading economy.',
  }),
  c({
    id: 'vintage_wine_cases', name: 'Vintage Wine Cases', category: 'luxury', baseValue: 6800, weightKg: 14, volumeL: 22,
    rarity: 4, volatility: 0.26, availability: 0.24, baseDemand: 14, elasticity: 0.28, storage: 'climate',
    tags: ['luxury', 'collectible', 'appreciating'], unit: 'case', forms: ['vintage', 'premium', 'counterfeit'],
    description: 'Appreciates with age if stored correctly — and collapses if not.',
  }),
  c({
    id: 'furs', name: 'Furs', category: 'luxury', baseValue: 3800, weightKg: 3, volumeL: 24,
    rarity: 3, volatility: 0.3, availability: 0.2, baseDemand: 14, elasticity: 0.36, legality: 'restricted', risk: 0.4,
    tags: ['luxury', 'controversial', 'banned_in_some_regions'], unit: 'piece', forms: ['premium', 'vintage'],
    description: 'Banned in some markets, prized in others.',
  }),
  c({
    id: 'ivory', name: 'Ivory', category: 'contraband_misc', baseValue: 900, weightKg: 1, volumeL: 1.1,
    rarity: 4, volatility: 0.36, availability: 0.06, baseDemand: 12, elasticity: 0.2, legality: 'contraband', risk: 0.97,
    storage: 'secure', marketTypes: ['black', 'darknet'], tags: ['wildlife', 'banned', 'cites'], unit: 'kg',
    forms: ['raw', 'salvaged'], description: 'Internationally banned. Trafficking carries severe sentences worldwide.',
  }),
  c({
    id: 'rhino_horn', name: 'Rhino Horn', category: 'contraband_misc', baseValue: 62000, weightKg: 1, volumeL: 1.2,
    rarity: 5, volatility: 0.44, availability: 0.03, baseDemand: 6, elasticity: 0.16, legality: 'contraband', risk: 0.98,
    storage: 'secure', marketTypes: ['black'], tags: ['wildlife', 'banned', 'organised_crime'], unit: 'kg',
    forms: ['raw'], description: 'The most lucrative wildlife contraband, and the most aggressively prosecuted.',
  }),
  c({
    id: 'endangered_specimens', name: 'Endangered Specimens', category: 'contraband_misc', baseValue: 24000, weightKg: 8, volumeL: 40,
    rarity: 5, volatility: 0.4, availability: 0.05, baseDemand: 4, elasticity: 0.2, legality: 'contraband', risk: 0.95,
    shelfLifeDays: 14, storage: 'climate', marketTypes: ['black'], tags: ['wildlife', 'banned', 'perishable'], unit: 'specimen',
    forms: ['raw'], description: 'Exotic pet and collection trade. Live cargo dies in customs delays.',
  }),

  /* ---------------------------------- weapon -------------------------------- */
  c({
    id: 'pistols', name: 'Pistols', category: 'weapon', baseValue: 620, weightKg: 1.1, volumeL: 2.4,
    rarity: 2, volatility: 0.26, availability: 0.45, baseDemand: 90, elasticity: 0.4, legality: 'restricted', risk: 0.72,
    storage: 'secure', marketTypes: ['licensed', 'black'], tags: ['firearm', 'self_defence', 'regulated'], unit: 'unit',
    forms: ['assembled', 'civilian', 'military_spec', 'salvaged'],
    description: 'Legal with a licence in some jurisdictions, contraband in others.',
  }),
  c({
    id: 'rifles', name: 'Rifles', category: 'weapon', baseValue: 1450, weightKg: 3.6, volumeL: 9,
    rarity: 3, volatility: 0.28, availability: 0.4, baseDemand: 70, elasticity: 0.4, legality: 'restricted', risk: 0.82,
    storage: 'secure', marketTypes: ['licensed', 'black'], tags: ['firearm', 'regulated', 'conflict_demand'], unit: 'unit',
    forms: ['assembled', 'civilian', 'military_spec', 'salvaged'], description: 'Demand surges around conflicts and legislative panics.',
  }),
  c({
    id: 'assault_rifles', name: 'Assault Rifles', category: 'weapon', baseValue: 3800, weightKg: 4.2, volumeL: 10,
    rarity: 4, volatility: 0.34, availability: 0.18, baseDemand: 40, elasticity: 0.3, legality: 'illegal', risk: 0.95,
    storage: 'secure', marketTypes: ['black'], tags: ['firearm', 'military', 'warzone'], unit: 'unit',
    forms: ['military_spec', 'salvaged'], description: 'Military-grade. Possession is a major felony in nearly every jurisdiction.',
  }),
  c({
    id: 'ammunition', name: 'Ammunition', category: 'weapon', baseValue: 1.8, weightKg: 0.03, volumeL: 0.03,
    volatility: 0.3, availability: 0.6, baseDemand: 900, elasticity: 0.38, legality: 'restricted', risk: 0.6,
    storage: 'hazardous', marketTypes: ['licensed', 'black'], tags: ['consumable', 'firearm', 'heavy_demand'], unit: 'round',
    forms: ['civilian', 'military_spec', 'bulk'], description: 'Consumable, heavy, and always in demand where guns are legal.',
  }),
  c({
    id: 'body_armor', name: 'Body Armor', category: 'weapon', baseValue: 880, weightKg: 4.5, volumeL: 22,
    volatility: 0.24, availability: 0.55, baseDemand: 70, elasticity: 0.42, legality: 'restricted', risk: 0.4,
    storage: 'secure', tags: ['protection', 'regulated'], unit: 'unit', forms: ['civilian', 'military_spec', 'premium'],
    description: 'Restricted for civilians in some places; combat multiplies demand.',
  }),
  c({
    id: 'explosives', name: 'Commercial Explosives', category: 'weapon', baseValue: 2400, weightKg: 1000, volumeL: 700,
    rarity: 3, volatility: 0.3, availability: 0.3, baseDemand: 40, elasticity: 0.36, legality: 'restricted', risk: 0.92,
    storage: 'hazardous', marketTypes: ['licensed', 'black'], tags: ['mining_input', 'dual_use', 'hazmat'], unit: 't',
    forms: ['industrial_grade', 'military_spec'], description: 'Mining and quarrying need it legally; diversion is a terrorism concern.',
  }),
  c({
    id: 'detonators', name: 'Detonators', category: 'weapon', baseValue: 145, weightKg: 0.4, volumeL: 0.6,
    rarity: 3, volatility: 0.32, availability: 0.28, baseDemand: 90, elasticity: 0.34, legality: 'restricted', risk: 0.93,
    storage: 'hazardous', tags: ['dual_use', 'controlled'], unit: 'unit', forms: ['industrial_grade', 'military_spec'],
    description: 'The controlled half of the explosives supply chain.',
  }),
  c({
    id: 'night_vision', name: 'Night Vision Optics', category: 'weapon', baseValue: 4200, weightKg: 0.8, volumeL: 2,
    rarity: 4, volatility: 0.3, availability: 0.3, baseDemand: 26, elasticity: 0.36, legality: 'restricted', risk: 0.6,
    storage: 'secure', tags: ['optics', 'dual_use', 'export_controlled'], unit: 'unit',
    forms: ['civilian', 'military_spec', 'premium'], description: 'Export-controlled; huge premium in conflict zones.',
  }),
  c({
    id: 'military_surplus', name: 'Military Surplus', category: 'weapon', baseValue: 340, weightKg: 12, volumeL: 60,
    volatility: 0.26, availability: 0.45, baseDemand: 110, elasticity: 0.46, legality: 'restricted', risk: 0.45,
    tags: ['surplus', 'post_conflict'], unit: 'lot', forms: ['salvaged', 'military_spec', 'civilian'],
    description: 'Floods the market after every demobilisation.',
  }),
  c({
    id: 'suppressors', name: 'Suppressors', category: 'weapon', baseValue: 1200, weightKg: 0.6, volumeL: 1.4,
    rarity: 3, volatility: 0.28, availability: 0.3, baseDemand: 45, elasticity: 0.38, legality: 'illegal', risk: 0.85,
    storage: 'secure', marketTypes: ['black'], tags: ['firearm_accessory', 'regulated'], unit: 'unit',
    forms: ['assembled', 'military_spec'], description: 'Heavily restricted; a strong indicator of intent for enforcement.',
  }),

  /* -------------------------------- equipment ------------------------------- */
  c({
    id: 'lockpicking_tools', name: 'Lockpicking Sets', category: 'equipment', baseValue: 220, weightKg: 0.5, volumeL: 1,
    volatility: 0.2, availability: 0.5, baseDemand: 60, elasticity: 0.5, legality: 'restricted', risk: 0.5,
    tags: ['tools', 'criminal_utility'], unit: 'set', forms: ['assembled', 'premium'],
    description: 'Sold openly to locksmiths; carrying one is suspicious.',
  }),
  c({
    id: 'faraday_bags', name: 'Faraday Bags', category: 'equipment', baseValue: 95, weightKg: 0.3, volumeL: 1.5,
    volatility: 0.22, availability: 0.6, baseDemand: 80, elasticity: 0.5, legality: 'legal', risk: 0.2,
    tags: ['counter_surveillance', 'digital'], unit: 'unit', forms: ['assembled', 'premium'],
    description: 'Blocks device tracking. Legal, but tells a story at a border.',
  }),
  c({
    id: 'radio_scanners', name: 'Police Scanners', category: 'equipment', baseValue: 340, weightKg: 0.8, volumeL: 2,
    volatility: 0.2, availability: 0.55, baseDemand: 70, elasticity: 0.48, legality: 'restricted', risk: 0.4,
    tags: ['surveillance', 'comms'], unit: 'unit', forms: ['assembled', 'premium', 'military_spec'],
    description: 'Encrypted channels defeated it; analogue traffic still pays.',
  }),
  c({
    id: 'climbing_gear', name: 'Climbing Gear', category: 'equipment', baseValue: 480, weightKg: 8, volumeL: 40,
    volatility: 0.16, availability: 0.75, baseDemand: 40, elasticity: 0.55, tags: ['outdoor', 'utility'], unit: 'set',
    forms: ['assembled', 'premium'], description: 'Useful for warehouses as well as mountains.',
  }),
  c({
    id: 'diving_gear', name: 'Diving Equipment', category: 'equipment', baseValue: 1200, weightKg: 22, volumeL: 120,
    volatility: 0.18, availability: 0.6, baseDemand: 26, elasticity: 0.52, tags: ['marine', 'utility'], unit: 'set',
    forms: ['assembled', 'premium'], description: 'Port work, salvage, and less legitimate harbour activity.',
  }),
  c({
    id: 'forged_documents', name: 'Forged Documents', category: 'equipment', baseValue: 2800, weightKg: 0.2, volumeL: 0.5,
    rarity: 4, volatility: 0.34, availability: 0.2, baseDemand: 34, elasticity: 0.28, legality: 'illegal', risk: 0.92,
    storage: 'secure', marketTypes: ['black', 'darknet'], tags: ['identity', 'document', 'border'], unit: 'set',
    forms: ['premium', 'counterfeit'], description: 'Passports, licences and permits. Quality determines whether you walk or sit.',
  }),
  c({
    id: 'uniforms', name: 'Official Uniforms', category: 'equipment', baseValue: 260, weightKg: 2, volumeL: 8,
    volatility: 0.2, availability: 0.55, baseDemand: 55, elasticity: 0.5, legality: 'restricted', risk: 0.55,
    tags: ['disguise', 'impersonation'], unit: 'set', forms: ['assembled', 'military_spec'],
    description: 'Security, police and military patterns. Wearing the wrong one is a crime.',
  }),
  c({
    id: 'breaching_tools', name: 'Breaching Tools', category: 'equipment', baseValue: 900, weightKg: 14, volumeL: 40,
    rarity: 3, volatility: 0.24, availability: 0.3, baseDemand: 22, elasticity: 0.44, legality: 'restricted', risk: 0.7,
    tags: ['tactical', 'tools'], unit: 'set', forms: ['assembled', 'military_spec'], description: 'Raid utility for both sides of the law.',
  }),

  /* ------------------------------ vehicle parts ----------------------------- */
  c({
    id: 'engines', name: 'Engines', category: 'vehicle_part', baseValue: 5400, weightKg: 220, volumeL: 900,
    volatility: 0.24, availability: 0.6, baseDemand: 34, elasticity: 0.46, tags: ['automotive', 'component'], unit: 'unit',
    forms: ['assembled', 'salvaged', 'premium', 'military_spec'], description: 'New, rebuilt and stolen all trade side by side.',
  }),
  c({
    id: 'transmissions', name: 'Transmissions', category: 'vehicle_part', baseValue: 3200, weightKg: 90, volumeL: 300,
    volatility: 0.22, availability: 0.62, baseDemand: 40, elasticity: 0.48, tags: ['automotive', 'component'], unit: 'unit',
    forms: ['assembled', 'salvaged', 'premium'], description: 'Failure-prone, always needed.',
  }),
  c({
    id: 'tyres', name: 'Tyres', category: 'vehicle_part', baseValue: 145, weightKg: 12, volumeL: 90,
    volatility: 0.2, availability: 0.85, baseDemand: 220, elasticity: 0.52, tags: ['automotive', 'consumable', 'rubber_linked'], unit: 'unit',
    forms: ['assembled', 'premium', 'salvaged'], description: 'Consumable tied to rubber prices and vehicle fleet size.',
  }),
  c({
    id: 'ev_batteries', name: 'EV Battery Packs', category: 'vehicle_part', baseValue: 12000, weightKg: 480, volumeL: 1400,
    rarity: 4, volatility: 0.44, availability: 0.4, baseDemand: 24, elasticity: 0.34, storage: 'hazardous',
    tags: ['ev', 'battery', 'lithium_linked', 'recyclable'], unit: 'pack', forms: ['assembled', 'premium', 'salvaged'],
    description: 'Lithium and nickel prices flow through; second-life demand is growing.',
  }),
  c({
    id: 'catalytic_converters', name: 'Catalytic Converters', category: 'vehicle_part', baseValue: 380, weightKg: 6, volumeL: 18,
    rarity: 3, volatility: 0.4, availability: 0.5, baseDemand: 120, elasticity: 0.38, legality: 'restricted', risk: 0.62,
    tags: ['pgm_content', 'theft_target', 'recyclable'], unit: 'unit', forms: ['salvaged', 'assembled'],
    description: 'Platinum-group content makes these a theft epidemic.',
  }),
  c({
    id: 'marine_engines', name: 'Marine Engines', category: 'vehicle_part', baseValue: 34000, weightKg: 900, volumeL: 3000,
    rarity: 3, volatility: 0.24, availability: 0.4, baseDemand: 8, elasticity: 0.42, tags: ['marine', 'capital_goods'], unit: 'unit',
    forms: ['assembled', 'salvaged', 'premium'], description: 'Ports, fishing fleets and smugglers all compete for these.',
  }),
  c({
    id: 'aircraft_parts', name: 'Aircraft Parts', category: 'vehicle_part', baseValue: 28000, weightKg: 120, volumeL: 900,
    rarity: 4, volatility: 0.28, availability: 0.28, baseDemand: 6, elasticity: 0.3, legality: 'restricted', risk: 0.35,
    tags: ['aviation', 'certified', 'traceable'], unit: 'lot', forms: ['assembled', 'salvaged', 'military_spec'],
    description: 'Every part is serialised and traceable — unapproved parts are lethal and illegal.',
  }),

  /* ------------------------------ construction ------------------------------ */
  c({
    id: 'cement', name: 'Cement', category: 'construction', baseValue: 125, weightKg: 1000, volumeL: 780,
    volatility: 0.18, availability: 0.92, baseDemand: 380, elasticity: 0.5, tags: ['bulk', 'construction'], unit: 't',
    forms: ['raw', 'bulk', 'packaged'], description: 'Local, heavy, and booming wherever construction booms.',
  }),
  c({
    id: 'rebar', name: 'Reinforcing Steel', category: 'construction', baseValue: 720, weightKg: 1000, volumeL: 128,
    volatility: 0.26, availability: 0.85, baseDemand: 260, elasticity: 0.52, tags: ['construction', 'steel_linked'], unit: 't',
    forms: ['industrial_grade', 'bulk', 'scrap'], description: 'Concrete\'s skeleton; tracks steel and housing starts.',
  }),
  c({
    id: 'bricks', name: 'Bricks', category: 'construction', baseValue: 95, weightKg: 1000, volumeL: 480,
    volatility: 0.14, availability: 0.9, baseDemand: 420, elasticity: 0.5, tags: ['bulk', 'construction'], unit: 't',
    forms: ['raw', 'bulk', 'premium'], description: 'Cheap, heavy, regional.',
  }),
  c({
    id: 'glass_panels', name: 'Architectural Glass', category: 'construction', baseValue: 640, weightKg: 1000, volumeL: 400,
    volatility: 0.22, availability: 0.7, baseDemand: 120, elasticity: 0.54, tags: ['construction', 'fragile', 'energy_linked'], unit: 't',
    forms: ['industrial_grade', 'premium'], description: 'Fragile and energy-intensive to produce.',
  }),
  c({
    id: 'insulation', name: 'Insulation Material', category: 'construction', baseValue: 480, weightKg: 1000, volumeL: 4200,
    volatility: 0.2, availability: 0.78, baseDemand: 150, elasticity: 0.54, tags: ['construction', 'bulky'], unit: 't',
    forms: ['industrial_grade', 'bulk'], description: 'Extremely bulky relative to value.',
  }),
  c({
    id: 'structural_steel', name: 'Structural Steel', category: 'construction', baseValue: 1150, weightKg: 1000, volumeL: 128,
    volatility: 0.28, availability: 0.75, baseDemand: 140, elasticity: 0.48, tags: ['construction', 'steel_linked'], unit: 't',
    forms: ['industrial_grade', 'processed'], description: 'Skyscrapers, bridges and stadiums.',
  }),
  c({
    id: 'treated_lumber', name: 'Treated Lumber', category: 'construction', baseValue: 540, weightKg: 1000, volumeL: 2100,
    volatility: 0.4, availability: 0.8, baseDemand: 200, elasticity: 0.5, tags: ['construction', 'housing_linked'], unit: 't',
    forms: ['processed', 'premium', 'bulk'], description: 'Famously volatile; futures traders lose fortunes here.',
  }),
  c({
    id: 'prefab_panels', name: 'Prefab Panels', category: 'construction', baseValue: 1900, weightKg: 1000, volumeL: 1400,
    volatility: 0.22, availability: 0.55, baseDemand: 60, elasticity: 0.5, tags: ['construction', 'modular'], unit: 't',
    forms: ['assembled', 'industrial_grade'], description: 'Fast construction in housing emergencies.',
  }),

  /* -------------------------------- industrial ------------------------------ */
  c({
    id: 'cnc_machines', name: 'CNC Machines', category: 'industrial', baseValue: 86000, weightKg: 3200, volumeL: 12000,
    rarity: 4, volatility: 0.24, availability: 0.32, baseDemand: 5, elasticity: 0.4, legality: 'restricted', risk: 0.2,
    tags: ['capital_goods', 'automation', 'dual_use'], unit: 'unit', forms: ['assembled', 'industrial_grade', 'salvaged', 'military_spec'],
    description: 'Five-axis machines are export-controlled for good reason.',
  }),
  c({
    id: 'air_compressors', name: 'Air Compressors', category: 'industrial', baseValue: 6400, weightKg: 320, volumeL: 1400,
    volatility: 0.2, availability: 0.65, baseDemand: 22, elasticity: 0.48, tags: ['industrial', 'capital_goods'], unit: 'unit',
    forms: ['assembled', 'industrial_grade', 'salvaged'], description: 'Every workshop needs one.',
  }),
  c({
    id: 'conveyor_belts', name: 'Conveyor Systems', category: 'industrial', baseValue: 18000, weightKg: 1800, volumeL: 8000,
    volatility: 0.2, availability: 0.55, baseDemand: 12, elasticity: 0.46, tags: ['industrial', 'logistics'], unit: 'set',
    forms: ['assembled', 'industrial_grade'], description: 'Mining, ports and warehouses.',
  }),
  c({
    id: 'welding_gas', name: 'Welding Gas', category: 'industrial', baseValue: 240, weightKg: 60, volumeL: 90,
    volatility: 0.18, availability: 0.75, baseDemand: 90, elasticity: 0.48, storage: 'hazardous',
    tags: ['industrial', 'hazmat', 'consumable'], unit: 'cylinder', forms: ['industrial_grade', 'bulk'],
    description: 'Consumable industrial gas; pressure vessels complicate freight.',
  }),
  c({
    id: 'hydraulic_fluid', name: 'Hydraulic Fluid', category: 'industrial', baseValue: 1800, weightKg: 1000, volumeL: 1120,
    volatility: 0.18, availability: 0.8, baseDemand: 110, elasticity: 0.5, tags: ['industrial', 'consumable'], unit: 't',
    forms: ['industrial_grade', 'bulk'], description: 'Machinery lifeblood.',
  }),
  c({
    id: 'industrial_filters', name: 'Industrial Filters', category: 'industrial', baseValue: 220, weightKg: 4, volumeL: 12,
    volatility: 0.16, availability: 0.8, baseDemand: 180, elasticity: 0.52, tags: ['industrial', 'consumable'], unit: 'unit',
    forms: ['component', 'industrial_grade'], description: 'Recurring replacement demand from every plant.',
  }),

  /* -------------------------------- information ----------------------------- */
  c({
    id: 'market_intel', name: 'Market Intelligence Report', category: 'information', baseValue: 4200, weightKg: 0, volumeL: 0,
    rarity: 3, volatility: 0.4, availability: 0.4, baseDemand: 40, elasticity: 0.3, legality: 'restricted', risk: 0.45,
    marketTypes: ['darknet', 'licensed'], tags: ['intangible', 'intel', 'time_sensitive'], unit: 'report',
    forms: ['encrypted', 'redacted'], description: 'Advance knowledge of supply shocks. Value decays within days.',
  }),
  c({
    id: 'corporate_espionage', name: 'Corporate Dossier', category: 'information', baseValue: 22000, weightKg: 0, volumeL: 0,
    rarity: 4, volatility: 0.44, availability: 0.2, baseDemand: 12, elasticity: 0.24, legality: 'illegal', risk: 0.9,
    marketTypes: ['darknet'], tags: ['intangible', 'espionage', 'illegal'], unit: 'dossier',
    forms: ['encrypted', 'redacted'], description: 'Trade secrets and internal financials. Buying this is a felony.',
  }),
  c({
    id: 'shipping_manifests', name: 'Shipping Manifests', category: 'information', baseValue: 1800, weightKg: 0, volumeL: 0,
    volatility: 0.3, availability: 0.45, baseDemand: 55, elasticity: 0.34, legality: 'restricted', risk: 0.5,
    marketTypes: ['darknet', 'black'], tags: ['intangible', 'logistics_intel'], unit: 'batch',
    forms: ['encrypted', 'redacted'], description: 'Tells you what is moving where — invaluable for interception or avoidance.',
  }),
  c({
    id: 'satellite_imagery', name: 'Satellite Imagery', category: 'information', baseValue: 8600, weightKg: 0, volumeL: 0,
    rarity: 3, volatility: 0.26, availability: 0.4, baseDemand: 30, elasticity: 0.36, legality: 'restricted', risk: 0.3,
    marketTypes: ['licensed', 'darknet'], tags: ['intangible', 'recon', 'dual_use'], unit: 'scene',
    forms: ['encrypted', 'premium'], description: 'Port stockpiles, mine activity, convoy movements.',
  }),
  c({
    id: 'zero_day_exploit', name: 'Zero-Day Exploit', category: 'information', baseValue: 480000, weightKg: 0, volumeL: 0,
    rarity: 5, volatility: 0.55, availability: 0.04, baseDemand: 3, elasticity: 0.2, legality: 'illegal', risk: 0.95,
    marketTypes: ['darknet'], tags: ['intangible', 'cyber', 'weapon'], unit: 'exploit',
    forms: ['encrypted'], description: 'Patched the moment it is used publicly — value evaporates instantly.',
  }),
  c({
    id: 'blackmail_dossier', name: 'Compromising Material', category: 'information', baseValue: 62000, weightKg: 0, volumeL: 0,
    rarity: 4, volatility: 0.5, availability: 0.1, baseDemand: 6, elasticity: 0.2, legality: 'illegal', risk: 0.96,
    marketTypes: ['darknet', 'black'], tags: ['intangible', 'leverage', 'criminal'], unit: 'file',
    forms: ['encrypted', 'redacted'], description: 'Leverage over officials and executives. Using it makes enemies for life.',
  }),
  c({
    id: 'blueprint_documents', name: 'Technical Blueprints', category: 'information', baseValue: 34000, weightKg: 0, volumeL: 0,
    rarity: 4, volatility: 0.36, availability: 0.18, baseDemand: 14, elasticity: 0.28, legality: 'restricted', risk: 0.7,
    marketTypes: ['darknet'], tags: ['intangible', 'manufacturing', 'espionage'], unit: 'set',
    forms: ['encrypted', 'redacted'], description: 'Unlocks production recipes without the R&D bill.',
  }),
  c({
    id: 'encrypted_ledger', name: 'Encrypted Ledger', category: 'information', baseValue: 18000, weightKg: 0, volumeL: 0,
    rarity: 3, volatility: 0.42, availability: 0.2, baseDemand: 20, elasticity: 0.3, legality: 'illegal', risk: 0.85,
    marketTypes: ['darknet'], tags: ['intangible', 'laundering', 'financial_crime'], unit: 'ledger',
    forms: ['encrypted'], description: 'Off-book accounts of organisations that would pay to keep them private.',
  }),

  /* ----------------------------- financial assets --------------------------- */
  c({
    id: 'bearer_bonds', name: 'Bearer Bonds', category: 'financial_asset', baseValue: 10000, weightKg: 0.05, volumeL: 0.1,
    rarity: 4, volatility: 0.16, availability: 0.14, baseDemand: 8, elasticity: 0.3, legality: 'restricted', risk: 0.75,
    storage: 'secure', marketTypes: ['black', 'licensed'], tags: ['instrument', 'anonymous', 'legacy'], unit: 'bond',
    forms: ['premium', 'salvaged'], description: 'Unregistered ownership — the classic instrument of anonymous wealth transfer.',
  }),
  c({
    id: 'treasury_notes', name: 'Government Treasury Notes', category: 'financial_asset', baseValue: 9800, weightKg: 0.02, volumeL: 0.05,
    rarity: 3, volatility: 0.08, availability: 0.5, baseDemand: 30, elasticity: 0.4, tags: ['instrument', 'safe_asset', 'rate_sensitive'], unit: 'note',
    forms: ['premium'], description: 'Sovereign debt. Yields move inversely to the central bank rate.',
  }),
  c({
    id: 'corporate_bonds', name: 'Corporate Bonds', category: 'financial_asset', baseValue: 9400, weightKg: 0.02, volumeL: 0.05,
    rarity: 3, volatility: 0.14, availability: 0.4, baseDemand: 24, elasticity: 0.42, tags: ['instrument', 'credit_risk'], unit: 'bond',
    forms: ['premium', 'salvaged'], description: 'Credit spreads widen in a downturn; defaults are total losses.',
  }),
  c({
    id: 'municipal_bonds', name: 'Municipal Bonds', category: 'financial_asset', baseValue: 9600, weightKg: 0.02, volumeL: 0.05,
    volatility: 0.1, availability: 0.42, baseDemand: 20, elasticity: 0.44, tags: ['instrument', 'tax_advantaged'], unit: 'bond',
    forms: ['premium'], description: 'Local government debt with tax advantages and occasional defaults.',
  }),
  c({
    id: 'promissory_notes', name: 'Private Promissory Notes', category: 'financial_asset', baseValue: 8000, weightKg: 0.02, volumeL: 0.05,
    rarity: 3, volatility: 0.2, availability: 0.24, baseDemand: 12, elasticity: 0.36, legality: 'restricted', risk: 0.5,
    marketTypes: ['black', 'licensed'], tags: ['instrument', 'private_credit'], unit: 'note',
    forms: ['premium', 'redacted'], description: 'Private debt, tradeable at a discount that reflects default risk.',
  }),
  c({
    id: 'commodity_futures', name: 'Commodity Futures Contracts', category: 'financial_asset', baseValue: 5000, weightKg: 0, volumeL: 0,
    rarity: 3, volatility: 0.34, availability: 0.5, baseDemand: 40, elasticity: 0.4, legality: 'restricted', risk: 0.2,
    marketTypes: ['exchange'], tags: ['instrument', 'derivative', 'leveraged'], unit: 'contract',
    forms: ['premium'], isInstrument: true, description: 'Exchange-traded exposure to physical prices with margin requirements.',
  }),

  /* ------------------------------- crypto hardware -------------------------- */
  c({
    id: 'mining_rigs', name: 'Crypto Mining Rigs', category: 'electronics', baseValue: 6800, weightKg: 24, volumeL: 90,
    rarity: 3, volatility: 0.52, availability: 0.4, baseDemand: 26, elasticity: 0.34,
    tags: ['crypto_linked', 'power_hungry', 'cyclical'], unit: 'rig', forms: ['assembled', 'premium', 'salvaged'],
    description: 'Demand tracks coin price with a lag; second-hand rigs flood every crash.',
  }),
  c({
    id: 'hardware_wallets', name: 'Hardware Wallets', category: 'electronics', baseValue: 240, weightKg: 0.12, volumeL: 0.3,
    volatility: 0.3, availability: 0.7, baseDemand: 140, elasticity: 0.44, tags: ['crypto_linked', 'security'], unit: 'unit',
    forms: ['assembled', 'premium', 'encrypted'], description: 'Self-custody demand rises after every exchange collapse.',
  }),
  c({
    id: 'cold_storage_vaults', name: 'Cold Storage Vaults', category: 'technology', baseValue: 42000, weightKg: 380, volumeL: 1200,
    rarity: 4, volatility: 0.26, availability: 0.28, baseDemand: 5, elasticity: 0.36, storage: 'secure',
    tags: ['crypto_linked', 'security', 'capital_goods'], unit: 'unit', forms: ['assembled', 'premium'],
    description: 'Institutional custody infrastructure.',
  }),

  /* ------------------------------- contraband misc -------------------------- */
  c({
    id: 'counterfeit_currency', name: 'Counterfeit Currency', category: 'contraband_misc', baseValue: 340, weightKg: 1, volumeL: 2,
    rarity: 3, volatility: 0.3, availability: 0.2, baseDemand: 60, elasticity: 0.3, legality: 'contraband', risk: 0.98,
    marketTypes: ['black', 'darknet'], tags: ['financial_crime', 'high_risk'], unit: 'bundle',
    forms: ['counterfeit', 'premium'], description: 'Sold at a fraction of face value. Passing it is a serious felony.',
  }),
  c({
    id: 'counterfeit_goods', name: 'Counterfeit Luxury Goods', category: 'contraband_misc', baseValue: 180, weightKg: 1.2, volumeL: 6,
    volatility: 0.26, availability: 0.5, baseDemand: 320, elasticity: 0.42, legality: 'illegal', risk: 0.6,
    marketTypes: ['black'], tags: ['ip_crime', 'consumer', 'luxury_linked'], unit: 'piece',
    forms: ['counterfeit', 'premium'], description: 'Enormous volume, modest risk, steady margins.',
  }),
  c({
    id: 'untaxed_cigarettes', name: 'Untaxed Cigarettes', category: 'contraband_misc', baseValue: 32, weightKg: 0.5, volumeL: 1.4,
    volatility: 0.22, availability: 0.6, baseDemand: 520, elasticity: 0.36, legality: 'illegal', risk: 0.55,
    marketTypes: ['black'], tags: ['excise_evasion', 'consumer'], unit: 'carton',
    forms: ['untaxed', 'packaged', 'counterfeit'], description: 'The tax wedge is the entire business model.',
  }),
  c({
    id: 'pirated_software', name: 'Pirated Software Keys', category: 'contraband_misc', baseValue: 90, weightKg: 0, volumeL: 0,
    volatility: 0.34, availability: 0.6, baseDemand: 260, elasticity: 0.44, legality: 'illegal', risk: 0.5,
    marketTypes: ['darknet', 'black'], tags: ['ip_crime', 'intangible', 'digital'], unit: 'key',
    forms: ['encrypted'], description: 'Zero logistics cost, pure legal risk.',
  }),
  c({
    id: 'sanctioned_goods', name: 'Sanctioned-Origin Goods', category: 'contraband_misc', baseValue: 4200, weightKg: 40, volumeL: 120,
    rarity: 3, volatility: 0.4, availability: 0.2, baseDemand: 30, elasticity: 0.3, legality: 'contraband', risk: 0.9,
    marketTypes: ['black'], tags: ['sanctions_evasion', 'geopolitical'], unit: 'crate',
    forms: ['sanctioned', 'salvaged'], description: 'Legally produced goods that become contraband by their origin.',
  }),
  c({
    id: 'stolen_art', name: 'Stolen Art', category: 'contraband_misc', baseValue: 180000, weightKg: 20, volumeL: 200,
    rarity: 5, volatility: 0.34, availability: 0.05, baseDemand: 2, elasticity: 0.2, legality: 'contraband', risk: 0.97,
    storage: 'climate', marketTypes: ['black', 'darknet'], tags: ['theft', 'unfenceable', 'cultural'], unit: 'piece',
    forms: ['salvaged'], description: 'Registered and watched. Almost impossible to sell openly.',
  }),
  c({
    id: 'bootleg_media', name: 'Bootleg Media', category: 'contraband_misc', baseValue: 12, weightKg: 0.2, volumeL: 0.4,
    volatility: 0.24, availability: 0.7, baseDemand: 600, elasticity: 0.48, legality: 'illegal', risk: 0.35,
    marketTypes: ['black'], tags: ['ip_crime', 'consumer', 'low_risk'], unit: 'disc',
    forms: ['counterfeit', 'packaged'], description: 'Low-value, high-volume, low-priority enforcement.',
  }),
];

/* -------------------- additional bases referenced by world ------------------ */
export const BASE_COMMODITIES_C: BaseCommodity[] = [
  c({
    id: 'coca_leaves', name: 'Coca Leaves', category: 'narcotic', baseValue: 620, weightKg: 1, volumeL: 6,
    rarity: 3, volatility: 0.3, availability: 0.3, baseDemand: 90, elasticity: 0.3, shelfLifeDays: 60,
    legality: 'restricted', risk: 0.7, storage: 'climate', marketTypes: ['public', 'black'],
    tags: ['drug_input', 'traditional', 'precursor'], unit: 'kg', forms: ['raw', 'unsorted', 'extract'],
    description: 'Chewed legally in the highlands, and the first step of a very illegal chain.',
    regions: ['cordillera'],
  }),
  c({
    id: 'olive_oil', name: 'Olive Oil', category: 'foodstuff', baseValue: 5400, weightKg: 1000, volumeL: 1090,
    volatility: 0.34, availability: 0.7, baseDemand: 110, elasticity: 0.44, shelfLifeDays: 540,
    tags: ['food', 'mediterranean', 'harvest_driven'], unit: 't', forms: ['raw', 'premium', 'artisanal', 'organic', 'packaged'],
    description: 'Alternate-bearing trees make harvests boom and bust; adulteration is endemic.',
    regions: ['mediterrane'],
  }),
  c({
    id: 'gum_arabic', name: 'Gum Arabic', category: 'agriculture', baseValue: 9800, weightKg: 1000, volumeL: 1800,
    rarity: 4, volatility: 0.42, availability: 0.22, baseDemand: 22, elasticity: 0.3, shelfLifeDays: 1080,
    tags: ['soft', 'strategic', 'food_input'], unit: 't', forms: ['raw', 'unsorted', 'processed', 'premium'],
    description: 'Essential emulsifier for soft drinks, sourced almost entirely from one unstable belt.',
    regions: ['sahel_belt'],
  }),
  c({
    id: 'cashew', name: 'Cashew Nuts', category: 'agriculture', baseValue: 2100, weightKg: 1000, volumeL: 1700,
    volatility: 0.28, availability: 0.55, baseDemand: 60, elasticity: 0.5, shelfLifeDays: 540,
    tags: ['soft', 'export', 'nut'], unit: 't', forms: ['raw', 'processed', 'premium', 'organic', 'packaged'],
    description: 'Exported raw, processed abroad — the value-add always leaves the country.',
    regions: ['gold_coast'],
  }),
  c({
    id: 'manganese', name: 'Manganese Ore', category: 'raw_material', baseValue: 210, weightKg: 1000, volumeL: 640,
    volatility: 0.26, availability: 0.55, baseDemand: 120, elasticity: 0.5, tags: ['bulk', 'steel_input', 'battery_input'], unit: 't',
    forms: ['raw', 'concentrate', 'bulk', 'refined'], description: 'Steel needs it, and so do battery cathodes.',
    regions: ['cape_reach'],
  }),
  c({
    id: 'shrimp', name: 'Shrimp', category: 'livestock', baseValue: 14.5, weightKg: 1, volumeL: 1.2,
    volatility: 0.3, availability: 0.72, baseDemand: 260, elasticity: 0.5, shelfLifeDays: 4,
    storage: 'refrigerated', tags: ['seafood', 'perishable', 'aquaculture'], unit: 'kg',
    forms: ['raw', 'frozen', 'processed', 'premium'], description: 'Farmed in deltas; disease and tariffs both bite.',
    regions: ['monsoon_delta', 'archipelago_seas'],
  }),
  c({
    id: 'mixed_livestock', name: 'Mixed Livestock', category: 'livestock', baseValue: 480, weightKg: 220, volumeL: 420,
    volatility: 0.22, availability: 0.6, baseDemand: 70, elasticity: 0.5, tags: ['animal', 'protein', 'pastoral'], unit: 'head',
    forms: ['raw', 'premium', 'organic'], description: 'Goats, sheep and cattle moved on the hoof across dry borders.',
    regions: ['sahel_belt', 'red_sea_coast'],
  }),
  c({
    id: 'consumer_electronics', name: 'Consumer Electronics Bundle', category: 'electronics', baseValue: 320, weightKg: 2.4, volumeL: 9,
    volatility: 0.24, availability: 0.85, baseDemand: 300, elasticity: 0.56, tags: ['consumer', 'mixed_lot', 'retail'], unit: 'lot',
    forms: ['assembled', 'premium', 'salvaged', 'counterfeit'],
    description: 'Mixed retail lots — the standard unit of containerised electronics trade.',
  }),
];
