/**
 * Asset registries: vehicles, vehicle upgrades, properties, businesses and
 * production recipes.
 *
 * These define the player's *physical* empire — the progression from
 * "carrying a backpack" to "automated multi-site supply network" is expressed
 * entirely through this data, not through special-case code.
 */

import type {
  BusinessDef,
  PropertyDef,
  ProductionRecipeDef,
  VehicleDef,
  VehicleUpgradeDef,
} from '../../sim/types';

/* ------------------------------------------------------------------ */
/* Vehicles                                                            */
/* ------------------------------------------------------------------ */

export const VEHICLES: VehicleDef[] = [
  {
    id: 'bicycle', name: 'Cargo Bicycle', kind: 'motorcycle', price: 320, capacityKg: 28, capacityL: 60,
    speedKmPerDay: 65, fuelPerKm: 0, maintenancePerKm: 0.008, stealth: 0.82, armor: 0.02,
    hiddenCompartmentKg: 3, reliability: 0.9, upgradeSlots: 1,
    description: 'Silent, cheap and invisible in traffic. The first real logistics upgrade.',
  },
  {
    id: 'scooter', name: 'Delivery Scooter', kind: 'motorcycle', price: 1450, capacityKg: 60, capacityL: 130,
    speedKmPerDay: 240, fuelPerKm: 0.022, maintenancePerKm: 0.02, stealth: 0.7, armor: 0.05,
    hiddenCompartmentKg: 8, reliability: 0.82, upgradeSlots: 2,
    description: 'Urban workhorse. Filters through checkpoints nobody bothers to search.',
  },
  {
    id: 'sedan', name: 'Used Sedan', kind: 'car', price: 6800, capacityKg: 240, capacityL: 480,
    speedKmPerDay: 620, fuelPerKm: 0.062, maintenancePerKm: 0.045, stealth: 0.55, armor: 0.18,
    hiddenCompartmentKg: 20, reliability: 0.74, upgradeSlots: 3,
    description: 'Unremarkable, which is the point. Trunk plus whatever a body shop will build.',
  },
  {
    id: 'pickup', name: 'Pickup Truck', kind: 'car', price: 18500, capacityKg: 900, capacityL: 1800,
    speedKmPerDay: 680, fuelPerKm: 0.11, maintenancePerKm: 0.062, stealth: 0.48, armor: 0.22,
    hiddenCompartmentKg: 60, reliability: 0.8, upgradeSlots: 4,
    description: 'Rough-road capable and endlessly repairable in any village.',
  },
  {
    id: 'panel_van', name: 'Panel Van', kind: 'van', price: 26500, capacityKg: 1400, capacityL: 5200,
    speedKmPerDay: 640, fuelPerKm: 0.1, maintenancePerKm: 0.058, stealth: 0.62, armor: 0.16,
    hiddenCompartmentKg: 180, reliability: 0.78, upgradeSlots: 5,
    description: 'A plumber\'s van is the best camouflage ever invented. False floors are standard practice.',
  },
  {
    id: 'box_truck', name: 'Box Truck', kind: 'truck', price: 74000, capacityKg: 6500, capacityL: 28000,
    speedKmPerDay: 560, fuelPerKm: 0.29, maintenancePerKm: 0.14, stealth: 0.4, armor: 0.3,
    hiddenCompartmentKg: 600, reliability: 0.76, upgradeSlots: 6,
    requiredSkill: { skillId: 'driving', level: 3 },
    description: 'Palletised freight. Requires weighbridge paperwork that must match the load.',
  },
  {
    id: 'semi_truck', name: 'Semi-Trailer Rig', kind: 'truck', price: 210000, capacityKg: 24000, capacityL: 96000,
    speedKmPerDay: 720, fuelPerKm: 0.42, maintenancePerKm: 0.21, stealth: 0.3, armor: 0.42,
    hiddenCompartmentKg: 2400, reliability: 0.72, upgradeSlots: 8,
    requiredSkill: { skillId: 'driving', level: 6 },
    description: 'Full-size freight. Border inspections are thorough but predictable.',
  },
  {
    id: 'refrigerated_truck', name: 'Refrigerated Truck', kind: 'truck', price: 268000, capacityKg: 18000, capacityL: 82000,
    speedKmPerDay: 660, fuelPerKm: 0.5, maintenancePerKm: 0.26, stealth: 0.32, armor: 0.4,
    hiddenCompartmentKg: 1200, reliability: 0.66, upgradeSlots: 7,
    requiredSkill: { skillId: 'driving', level: 6 },
    description: 'Cold chain on wheels. Without it, perishables are a donation to the roadside.',
  },
  {
    id: 'armored_car', name: 'Armored Cash Carrier', kind: 'armored', price: 340000, capacityKg: 2200, capacityL: 6000,
    speedKmPerDay: 580, fuelPerKm: 0.24, maintenancePerKm: 0.19, stealth: 0.1, armor: 0.88,
    hiddenCompartmentKg: 300, reliability: 0.84, upgradeSlots: 6,
    requiredSkill: { skillId: 'driving', level: 5 },
    description: 'Invites attention, survives ambushes. Designed for bullion and banknotes.',
  },
  {
    id: 'fishing_boat', name: 'Fishing Boat', kind: 'boat', price: 96000, capacityKg: 8000, capacityL: 30000,
    speedKmPerDay: 420, fuelPerKm: 0.19, maintenancePerKm: 0.12, stealth: 0.68, armor: 0.14,
    hiddenCompartmentKg: 900, reliability: 0.7, upgradeSlots: 5,
    requiredSkill: { skillId: 'seamanship', level: 3 },
    description: 'Coastal capacity with a plausible reason to be anywhere near the water.',
  },
  {
    id: 'fast_boat', name: 'Offshore Speedboat', kind: 'boat', price: 285000, capacityKg: 4200, capacityL: 14000,
    speedKmPerDay: 900, fuelPerKm: 0.62, maintenancePerKm: 0.3, stealth: 0.5, armor: 0.12,
    hiddenCompartmentKg: 500, reliability: 0.6, upgradeSlots: 5,
    requiredSkill: { skillId: 'seamanship', level: 5 },
    description: 'Fast enough that interception is a coin flip. Fuel range is not.',
  },
  {
    id: 'coastal_freighter', name: 'Coastal Freighter', kind: 'boat', price: 2_400_000, capacityKg: 480000, capacityL: 1600000,
    speedKmPerDay: 620, fuelPerKm: 2.4, maintenancePerKm: 1.1, stealth: 0.14, armor: 0.55,
    hiddenCompartmentKg: 40000, reliability: 0.74, upgradeSlots: 8,
    requiredSkill: { skillId: 'seamanship', level: 9 },
    description: 'Real tonnage. Real crew costs. Real customs inspections at every port.',
  },
  {
    id: 'light_aircraft', name: 'Light Aircraft', kind: 'aircraft', price: 480000, capacityKg: 420, capacityL: 2400,
    speedKmPerDay: 2200, fuelPerKm: 0.85, maintenancePerKm: 0.95, stealth: 0.24, armor: 0.08,
    hiddenCompartmentKg: 60, reliability: 0.68, upgradeSlots: 5,
    requiredSkill: { skillId: 'piloting', level: 6 },
    description: 'Range and speed at the cost of payload. Flight plans are filed and read.',
  },
  {
    id: 'cargo_plane', name: 'Cargo Aircraft', kind: 'aircraft', price: 4_800_000, capacityKg: 42000, capacityL: 210000,
    speedKmPerDay: 4800, fuelPerKm: 6.2, maintenancePerKm: 4.4, stealth: 0.08, armor: 0.3,
    hiddenCompartmentKg: 3000, reliability: 0.7, upgradeSlots: 7,
    requiredSkill: { skillId: 'piloting', level: 10 },
    description: 'Continental freight on demand. Landing slots are the scarce resource.',
  },
  {
    id: 'private_jet', name: 'Private Jet', kind: 'aircraft', price: 12_500_000, capacityKg: 2400, capacityL: 12000,
    speedKmPerDay: 6400, fuelPerKm: 4.1, maintenancePerKm: 6.8, stealth: 0.3, armor: 0.2,
    hiddenCompartmentKg: 200, reliability: 0.86, upgradeSlots: 6,
    requiredSkill: { skillId: 'piloting', level: 12 },
    description: 'Private terminals mean private customs. Prestige and logistics in one asset.',
  },
  {
    id: 'utility_trailer', name: 'Utility Trailer', kind: 'trailer', price: 4200, capacityKg: 1800, capacityL: 7000,
    speedKmPerDay: 0, fuelPerKm: 0, maintenancePerKm: 0.01, stealth: 0.5, armor: 0.1,
    hiddenCompartmentKg: 400, reliability: 0.94, upgradeSlots: 3,
    description: 'Static storage that can be towed away when a warehouse stops being safe.',
  },
  {
    id: 'forklift', name: 'Warehouse Forklift', kind: 'truck', price: 22000, capacityKg: 2500, capacityL: 6000,
    speedKmPerDay: 90, fuelPerKm: 0.08, maintenancePerKm: 0.05, stealth: 0.2, armor: 0.3,
    hiddenCompartmentKg: 0, reliability: 0.88, upgradeSlots: 2,
    description: 'Doubles effective warehouse throughput. Useless outside a facility.',
  },
  {
    id: 'delivery_drone_fleet', name: 'Delivery Drone Fleet', kind: 'aircraft', price: 145000, capacityKg: 260, capacityL: 900,
    speedKmPerDay: 1100, fuelPerKm: 0.09, maintenancePerKm: 0.22, stealth: 0.74, armor: 0.04,
    hiddenCompartmentKg: 20, reliability: 0.6, upgradeSlots: 6,
    requiredSkill: { skillId: 'technology', level: 6 },
    description: 'Low-payload, high-stealth last-mile delivery that ignores roads entirely.',
  },
];

export const VEHICLE_UPGRADES: VehicleUpgradeDef[] = [
  { id: 'roof_rack', name: 'Roof Rack & Cargo Frame', price: 1800, description: 'External load capacity.', modifiers: { capacityKg: 180, capacityL: 600 } },
  { id: 'false_floor', name: 'False Floor Compartment', price: 6400, description: 'Concealed storage that survives a casual search.', modifiers: { stealth: 0.14 } },
  { id: 'lead_lining', name: 'Lead-Lined Panel', price: 14800, description: 'Defeats density scanners. Heavy, and suspicious in itself.', modifiers: { stealth: 0.22, capacityKg: -120 } },
  { id: 'run_flat_tyres', name: 'Run-Flat Tyres', price: 3200, description: 'Keeps a vehicle moving after a puncture or a shot.', modifiers: { reliability: 0.08, armor: 0.06 } },
  { id: 'uprated_suspension', name: 'Uprated Suspension', price: 5400, description: 'Carries weight without sagging visibly at a weighbridge.', modifiers: { capacityKg: 900, reliability: 0.05 } },
  { id: 'turbo', name: 'Forced Induction', price: 7800, description: 'More speed, more fuel, more maintenance.', modifiers: { speed: 0.18, fuelEfficiency: -0.14, reliability: -0.06 } },
  { id: 'fuel_tank', name: 'Extended Fuel Tank', price: 4200, description: 'Longer range without stopping — and without being seen stopping.', modifiers: { speed: 0.06, reliability: 0.03 } },
  { id: 'armor_plate', name: 'Armor Plating', price: 38000, description: 'Survives small arms. Drastically slower and thirstier.', modifiers: { armor: 0.32, speed: -0.12, fuelEfficiency: -0.18 } },
  { id: 'refrigeration_unit', name: 'Refrigeration Unit', price: 24500, description: 'Converts cargo space to cold chain.', modifiers: { capacityL: -1200, reliability: -0.03 } },
  { id: 'gps_jammer', name: 'GPS Jammer', price: 19500, description: 'Denies trackers. Illegal in most jurisdictions.', modifiers: { stealth: 0.18 } },
  { id: 'fleet_telematics', name: 'Fleet Telematics', price: 12800, description: 'Enables a logistics manager to route this vehicle optimally.', modifiers: { reliability: 0.09, speed: 0.05 } },
  { id: 'cargo_netting', name: 'Cargo Netting & Racking', price: 2600, description: 'Stops loose load shifting and being damaged.', modifiers: { capacityL: 400, reliability: 0.04 } },
];

export const VEHICLE_BY_ID: Record<string, VehicleDef> = Object.fromEntries(VEHICLES.map((v) => [v.id, v]));
export const VEHICLE_UPGRADE_BY_ID: Record<string, VehicleUpgradeDef> = Object.fromEntries(
  VEHICLE_UPGRADES.map((u) => [u.id, u]),
);
export const UPGRADE_BY_ID: Record<string, VehicleUpgradeDef> = Object.fromEntries(VEHICLE_UPGRADES.map((u) => [u.id, u]));

/* ------------------------------------------------------------------ */
/* Properties                                                          */
/* ------------------------------------------------------------------ */

export const PROPERTIES: PropertyDef[] = [
  { id: 'studio_apartment', name: 'Studio Apartment', kind: 'residential', basePrice: 145000, storageKg: 200, storageL: 600, security: 0.3, refrigerated: false, hiddenCompartmentKg: 10, maxUpgradeLevel: 1, upgradeCostBase: 12000, opexPerDay: 14, staffSlots: 0, description: 'A place to sleep and a lock on the door. Appreciates slowly.' },
  { id: 'safehouse_small', name: 'Safehouse', kind: 'safehouse', basePrice: 320000, storageKg: 1200, storageL: 4000, security: 0.62, refrigerated: false, hiddenCompartmentKg: 180, maxUpgradeLevel: 3, upgradeCostBase: 48000, opexPerDay: 34, staffSlots: 2, description: 'Unmarked, cash-purchased, and useful when a home address becomes inconvenient.' },
  { id: 'safehouse_fortified', name: 'Fortified Safehouse', kind: 'safehouse', basePrice: 1250000, storageKg: 4000, storageL: 14000, security: 0.86, refrigerated: false, hiddenCompartmentKg: 700, maxUpgradeLevel: 3, upgradeCostBase: 180000, opexPerDay: 120, staffSlots: 6, description: 'Reinforced doors, cameras, a panic room and a second exit nobody knows about.' },
  { id: 'small_warehouse', name: 'Small Warehouse', kind: 'warehouse', basePrice: 480000, storageKg: 60000, storageL: 220000, security: 0.44, refrigerated: false, hiddenCompartmentKg: 0, maxUpgradeLevel: 3, upgradeCostBase: 95000, opexPerDay: 86, staffSlots: 6, enablesBusinessId: 'freight_depot', productionTags: ['packaging'], description: 'Racking, a roller door and a forklift. The first real logistics asset.' },
  { id: 'large_warehouse', name: 'Distribution Warehouse', kind: 'distribution_center', basePrice: 2400000, storageKg: 480000, storageL: 1800000, security: 0.58, refrigerated: false, hiddenCompartmentKg: 0, maxUpgradeLevel: 4, upgradeCostBase: 420000, opexPerDay: 340, staffSlots: 24, enablesBusinessId: 'logistics_firm', productionTags: ['packaging', 'assembly'], description: 'Dock levellers, pallet racking and shift workers. Throughput becomes a competitive weapon.' },
  { id: 'cold_store', name: 'Cold Storage Facility', kind: 'warehouse', basePrice: 1850000, storageKg: 220000, storageL: 800000, security: 0.52, refrigerated: true, hiddenCompartmentKg: 0, maxUpgradeLevel: 3, upgradeCostBase: 320000, opexPerDay: 420, staffSlots: 14, productionTags: ['food_processing'], description: 'Perishables at scale. Power failure is the only real risk, and it is total.' },
  { id: 'bonded_warehouse', name: 'Bonded Warehouse', kind: 'warehouse', basePrice: 4200000, storageKg: 620000, storageL: 2400000, security: 0.72, refrigerated: false, hiddenCompartmentKg: 2000, maxUpgradeLevel: 4, upgradeCostBase: 700000, opexPerDay: 520, staffSlots: 28, enablesBusinessId: 'import_export', productionTags: ['packaging', 'assembly'], description: 'Customs-bonded space. Duties are deferred until goods leave — a genuine financing advantage.' },
  { id: 'office_small', name: 'Small Office', kind: 'office', basePrice: 620000, storageKg: 400, storageL: 2000, security: 0.5, refrigerated: false, hiddenCompartmentKg: 20, maxUpgradeLevel: 2, upgradeCostBase: 110000, opexPerDay: 62, staffSlots: 12, enablesBusinessId: 'consultancy', description: 'A legitimate address. Necessary for contracts, banking and being taken seriously.' },
  { id: 'office_floor', name: 'Office Floor', kind: 'office', basePrice: 2800000, storageKg: 1200, storageL: 6000, security: 0.66, refrigerated: false, hiddenCompartmentKg: 60, maxUpgradeLevel: 3, upgradeCostBase: 480000, opexPerDay: 280, staffSlots: 60, enablesBusinessId: 'brokerage', productionTags: ['research'], description: 'Trading floor, meeting rooms and a receptionist who screens visitors.' },
  { id: 'retail_shop', name: 'Retail Shop', kind: 'retail', basePrice: 380000, storageKg: 4000, storageL: 18000, security: 0.36, refrigerated: false, hiddenCompartmentKg: 40, maxUpgradeLevel: 3, upgradeCostBase: 70000, opexPerDay: 74, staffSlots: 6, enablesBusinessId: 'corner_store', description: 'Foot traffic, cash sales and a plausible reason to hold inventory.' },
  { id: 'pawnshop', name: 'Pawnshop', kind: 'retail', basePrice: 540000, storageKg: 8000, storageL: 24000, security: 0.7, refrigerated: false, hiddenCompartmentKg: 200, maxUpgradeLevel: 3, upgradeCostBase: 95000, opexPerDay: 88, staffSlots: 5, enablesBusinessId: 'pawnshop', productionTags: ['refining'], description: 'Buys anything, asks little, sells for more. An excellent laundering front.' },
  { id: 'laundromat', name: 'Laundromat', kind: 'retail', basePrice: 290000, storageKg: 900, storageL: 4000, security: 0.34, refrigerated: false, hiddenCompartmentKg: 30, maxUpgradeLevel: 2, upgradeCostBase: 55000, opexPerDay: 52, staffSlots: 4, enablesBusinessId: 'laundromat', description: 'Cash-intensive, low-margin, and the oldest money-laundering cliché because it works.' },
  { id: 'restaurant', name: 'Restaurant', kind: 'retail', basePrice: 720000, storageKg: 3000, storageL: 12000, security: 0.4, refrigerated: true, hiddenCompartmentKg: 60, maxUpgradeLevel: 3, upgradeCostBase: 130000, opexPerDay: 165, staffSlots: 18, enablesBusinessId: 'restaurant', productionTags: ['food_processing'], description: 'Perishable supply chain, cash takings and a kitchen that always needs ingredients.' },
  { id: 'nightclub', name: 'Nightclub', kind: 'entertainment', basePrice: 2100000, storageKg: 6000, storageL: 22000, security: 0.58, refrigerated: true, hiddenCompartmentKg: 260, maxUpgradeLevel: 3, upgradeCostBase: 380000, opexPerDay: 420, staffSlots: 40, enablesBusinessId: 'nightclub', description: 'Enormous cash revenue, a door staff you can deploy elsewhere, and constant low-level scrutiny.' },
  { id: 'casino', name: 'Casino', kind: 'entertainment', basePrice: 14500000, storageKg: 20000, storageL: 60000, security: 0.9, refrigerated: false, hiddenCompartmentKg: 900, maxUpgradeLevel: 4, upgradeCostBase: 2400000, opexPerDay: 2400, staffSlots: 120, enablesBusinessId: 'casino', description: 'The most efficient laundering machine ever built, and correspondingly well regulated.' },
  { id: 'small_factory', name: 'Light Factory', kind: 'factory', basePrice: 3200000, storageKg: 180000, storageL: 700000, security: 0.5, refrigerated: false, hiddenCompartmentKg: 0, maxUpgradeLevel: 4, upgradeCostBase: 560000, opexPerDay: 620, staffSlots: 40, enablesBusinessId: 'factory', productionTags: ['assembly', 'processing', 'refining'], description: 'Turns raw material into finished goods. Where manufacturing margin actually lives.' },
  { id: 'heavy_factory', name: 'Heavy Industrial Plant', kind: 'factory', basePrice: 16800000, storageKg: 1400000, storageL: 4200000, security: 0.62, refrigerated: false, hiddenCompartmentKg: 0, maxUpgradeLevel: 5, upgradeCostBase: 2900000, opexPerDay: 2800, staffSlots: 180, enablesBusinessId: 'heavy_industry', productionTags: ['smelting', 'assembly', 'processing', 'refining', 'chemical'], description: 'Smelters, presses and a power bill that appears on the regional grid.' },
  { id: 'chemical_plant', name: 'Chemical Plant', kind: 'factory', basePrice: 22500000, storageKg: 900000, storageL: 2600000, security: 0.7, refrigerated: false, hiddenCompartmentKg: 0, maxUpgradeLevel: 4, upgradeCostBase: 3600000, opexPerDay: 3400, staffSlots: 140, enablesBusinessId: 'chemical_works', productionTags: ['chemical', 'processing', 'refining'], description: 'Licensed chemistry. The same equipment makes fertiliser and other things.' },
  { id: 'farm_small', name: 'Small Farm', kind: 'farm', basePrice: 680000, storageKg: 90000, storageL: 300000, security: 0.24, refrigerated: true, hiddenCompartmentKg: 0, maxUpgradeLevel: 3, upgradeCostBase: 140000, opexPerDay: 96, staffSlots: 12, enablesBusinessId: 'farm', productionTags: ['agriculture'], description: 'Produces staples at the mercy of weather and world prices.' },
  { id: 'farm_estate', name: 'Agricultural Estate', kind: 'farm', basePrice: 5400000, storageKg: 900000, storageL: 3000000, security: 0.34, refrigerated: true, hiddenCompartmentKg: 0, maxUpgradeLevel: 4, upgradeCostBase: 900000, opexPerDay: 640, staffSlots: 90, enablesBusinessId: 'plantation', productionTags: ['agriculture', 'food_processing'], description: 'Industrial-scale cultivation with on-site processing.' },
  { id: 'greenhouse_complex', name: 'Greenhouse Complex', kind: 'farm', basePrice: 2900000, storageKg: 140000, storageL: 600000, security: 0.6, refrigerated: true, hiddenCompartmentKg: 400, maxUpgradeLevel: 4, upgradeCostBase: 520000, opexPerDay: 380, staffSlots: 24, enablesBusinessId: 'horticulture', productionTags: ['agriculture', 'horticulture'], description: 'Climate-controlled cultivation. Grows anything, anywhere, all year — discreetly.' },
  { id: 'distribution_center', name: 'Regional Distribution Center', kind: 'distribution_center', basePrice: 9800000, storageKg: 2200000, storageL: 8000000, security: 0.68, refrigerated: true, hiddenCompartmentKg: 1200, maxUpgradeLevel: 5, upgradeCostBase: 1600000, opexPerDay: 1450, staffSlots: 120, enablesBusinessId: 'logistics_firm', productionTags: ['packaging', 'assembly'], description: 'The hub of a multi-location network. Automating this is the empire endgame.' },
  { id: 'transport_hub', name: 'Transport Hub', kind: 'transport_hub', basePrice: 18500000, storageKg: 3000000, storageL: 12000000, security: 0.72, refrigerated: false, hiddenCompartmentKg: 800, maxUpgradeLevel: 5, upgradeCostBase: 3100000, opexPerDay: 2600, staffSlots: 160, enablesBusinessId: 'freight_operator', productionTags: ['packaging'], description: 'Rail siding, truck yard and craneage. Whoever owns the node sets the price.' },
  { id: 'bank_branch', name: 'Financial Services Branch', kind: 'financial_facility', basePrice: 7400000, storageKg: 20000, storageL: 40000, security: 0.94, refrigerated: false, hiddenCompartmentKg: 500, maxUpgradeLevel: 3, upgradeCostBase: 1200000, opexPerDay: 900, staffSlots: 40, enablesBusinessId: 'money_service', description: 'Currency exchange, remittance and a vault. Regulated, inspected and extremely useful.' },
  { id: 'research_lab', name: 'Research Laboratory', kind: 'research_facility', basePrice: 6200000, storageKg: 40000, storageL: 120000, security: 0.8, refrigerated: true, hiddenCompartmentKg: 100, maxUpgradeLevel: 4, upgradeCostBase: 1100000, opexPerDay: 780, staffSlots: 30, enablesBusinessId: 'research_firm', productionTags: ['research', 'chemical', 'pharma'], description: 'Produces intelligence, patents and — with the right staff — chemistry that is hard to buy.' },
  { id: 'datacenter', name: 'Datacenter', kind: 'tech_facility', basePrice: 11500000, storageKg: 30000, storageL: 90000, security: 0.86, refrigerated: true, hiddenCompartmentKg: 0, maxUpgradeLevel: 5, upgradeCostBase: 2000000, opexPerDay: 1900, staffSlots: 22, enablesBusinessId: 'hosting_firm', productionTags: ['research', 'mining'], description: 'Compute and connectivity. Hosts your mining rigs and your darker infrastructure.' },
  { id: 'underground_bunker', name: 'Underground Bunker', kind: 'underground_facility', basePrice: 4600000, storageKg: 320000, storageL: 900000, security: 0.9, refrigerated: true, hiddenCompartmentKg: 4000, maxUpgradeLevel: 4, upgradeCostBase: 820000, opexPerDay: 460, staffSlots: 16, productionTags: ['processing', 'chemical', 'refining'], description: 'Below ground, off records. Raids are possible; discovery is unlikely.' },
  { id: 'offshore_shell', name: 'Offshore Shell Entity', kind: 'offshore_entity', basePrice: 1850000, storageKg: 0, storageL: 0, security: 0.6, refrigerated: false, hiddenCompartmentKg: 0, maxUpgradeLevel: 3, upgradeCostBase: 420000, opexPerDay: 180, staffSlots: 2, enablesBusinessId: 'holding_company', description: 'A jurisdiction, a registered agent and a bank account. Halves the tax rate on routed income.' },
];

export const PROPERTY_BY_ID: Record<string, PropertyDef> = Object.fromEntries(PROPERTIES.map((p) => [p.id, p]));

/* ------------------------------------------------------------------ */
/* Businesses                                                          */
/* ------------------------------------------------------------------ */

export const BUSINESSES: BusinessDef[] = [
  { id: 'corner_store', name: 'Corner Store', kind: 'retail', setupCost: 45000, baseDailyRevenue: 1450, baseDailyOpex: 980, staffSlots: 4, demandSensitivity: 0.85, launderingCapacityPerDay: 1200, legality: 'legal', requiredPropertyKind: 'retail', reputationEffect: { dimension: 'business', perDay: 0.05 }, description: 'Cash-heavy neighbourhood retail. Modest revenue, excellent laundering throughput.' },
  { id: 'pawnshop', name: 'Pawnshop', kind: 'pawnshop', setupCost: 120000, baseDailyRevenue: 3200, baseDailyOpex: 1900, staffSlots: 5, demandSensitivity: 0.6, launderingCapacityPerDay: 4200, legality: 'legal', requiredPropertyKind: 'retail', reputationEffect: { dimension: 'business', perDay: 0.04 }, description: 'Buys distressed goods and sells them back at a premium. Also a fence, if you let it be.' },
  { id: 'laundromat', name: 'Laundromat', kind: 'laundromat', setupCost: 68000, baseDailyRevenue: 980, baseDailyOpex: 720, staffSlots: 3, demandSensitivity: 0.5, launderingCapacityPerDay: 3400, legality: 'legal', requiredPropertyKind: 'retail', reputationEffect: { dimension: 'business', perDay: 0.03 }, description: 'Almost pure laundering vehicle. Revenue is mostly whatever you declare it to be.' },
  { id: 'restaurant', name: 'Restaurant', kind: 'restaurant', setupCost: 260000, baseDailyRevenue: 6400, baseDailyOpex: 4900, staffSlots: 16, demandSensitivity: 0.8, launderingCapacityPerDay: 5200, legality: 'legal', requiredPropertyKind: 'retail', requiredSkill: { skillId: 'business_management', level: 2 }, reputationEffect: { dimension: 'business', perDay: 0.09 }, description: 'Thin margins, high reputation value, and a constant need for food inventory.' },
  { id: 'nightclub', name: 'Nightclub', kind: 'nightclub', setupCost: 900000, baseDailyRevenue: 24000, baseDailyOpex: 17500, staffSlots: 38, demandSensitivity: 0.75, launderingCapacityPerDay: 22000, legality: 'legal', requiredPropertyKind: 'entertainment', requiredSkill: { skillId: 'business_management', level: 4 }, reputationEffect: { dimension: 'business', perDay: 0.16 }, description: 'Large cash takings, a security team, and a clientele that buys whatever is sold behind the bar.' },
  { id: 'casino', name: 'Casino', kind: 'casino', setupCost: 8500000, baseDailyRevenue: 240000, baseDailyOpex: 165000, staffSlots: 110, demandSensitivity: 0.6, launderingCapacityPerDay: 420000, legality: 'restricted', requiredPropertyKind: 'entertainment', requiredSkill: { skillId: 'finance', level: 6 }, reputationEffect: { dimension: 'business', perDay: 0.3 }, description: 'Chip purchase and redemption converts cash into documented winnings at scale.' },
  { id: 'import_export', name: 'Import/Export Firm', kind: 'import_export', setupCost: 640000, baseDailyRevenue: 18500, baseDailyOpex: 13200, staffSlots: 22, demandSensitivity: 0.7, launderingCapacityPerDay: 26000, legality: 'legal', requiredPropertyKind: 'warehouse', requiredSkill: { skillId: 'trading', level: 4 }, reputationEffect: { dimension: 'business', perDay: 0.14 }, description: 'Trade finance, bonded storage and customs relationships. Under-invoicing is a competitive art.' },
  { id: 'logistics_firm', name: 'Logistics Firm', kind: 'logistics_firm', setupCost: 1450000, baseDailyRevenue: 42000, baseDailyOpex: 33000, staffSlots: 60, demandSensitivity: 0.65, launderingCapacityPerDay: 18000, legality: 'legal', requiredPropertyKind: 'distribution_center', requiredSkill: { skillId: 'logistics', level: 5 }, reputationEffect: { dimension: 'business', perDay: 0.18 }, description: 'Contract freight. Revenue scales with the vehicles and routes you control.' },
  { id: 'freight_depot', name: 'Freight Depot', kind: 'logistics_firm', setupCost: 320000, baseDailyRevenue: 9800, baseDailyOpex: 7400, staffSlots: 18, demandSensitivity: 0.7, launderingCapacityPerDay: 6000, legality: 'legal', requiredPropertyKind: 'warehouse', reputationEffect: { dimension: 'business', perDay: 0.08 }, description: 'Local haulage and cross-docking. A dependable, unglamorous income.' },
  { id: 'freight_operator', name: 'National Freight Operator', kind: 'logistics_firm', setupCost: 6200000, baseDailyRevenue: 165000, baseDailyOpex: 138000, staffSlots: 180, demandSensitivity: 0.6, launderingCapacityPerDay: 60000, legality: 'legal', requiredPropertyKind: 'transport_hub', requiredSkill: { skillId: 'logistics', level: 8 }, reputationEffect: { dimension: 'business', perDay: 0.26 }, description: 'Rail and road network operating at national scale. Automation pays for itself here.' },
  { id: 'factory', name: 'Light Manufacturing', kind: 'factory', setupCost: 1900000, baseDailyRevenue: 52000, baseDailyOpex: 41000, staffSlots: 44, demandSensitivity: 0.55, launderingCapacityPerDay: 14000, legality: 'legal', requiredPropertyKind: 'factory', requiredSkill: { skillId: 'production', level: 4 }, reputationEffect: { dimension: 'business', perDay: 0.12 }, description: 'Converts purchased inputs into finished goods with a manufacturing margin.' },
  { id: 'heavy_industry', name: 'Heavy Industry', kind: 'factory', setupCost: 12500000, baseDailyRevenue: 320000, baseDailyOpex: 268000, staffSlots: 200, demandSensitivity: 0.6, launderingCapacityPerDay: 40000, legality: 'legal', requiredPropertyKind: 'factory', requiredSkill: { skillId: 'production', level: 7 }, reputationEffect: { dimension: 'business', perDay: 0.2 }, description: 'Smelting and fabrication. Enormous revenue, enormous energy bill, real political weight.' },
  { id: 'chemical_works', name: 'Chemical Works', kind: 'factory', setupCost: 16000000, baseDailyRevenue: 410000, baseDailyOpex: 340000, staffSlots: 150, demandSensitivity: 0.5, launderingCapacityPerDay: 30000, legality: 'restricted', requiredPropertyKind: 'factory', requiredSkill: { skillId: 'production', level: 8 }, reputationEffect: { dimension: 'business', perDay: 0.18 }, description: 'Licensed chemical processing. Inspectors visit, and their reports matter.' },
  { id: 'farm', name: 'Family Farm', kind: 'farm', setupCost: 210000, baseDailyRevenue: 5400, baseDailyOpex: 4100, staffSlots: 12, demandSensitivity: 0.7, launderingCapacityPerDay: 3000, legality: 'legal', requiredPropertyKind: 'farm', reputationEffect: { dimension: 'business', perDay: 0.06 }, description: 'Weather-dependent staple production with thin but stable margins.' },
  { id: 'plantation', name: 'Plantation', kind: 'farm', setupCost: 3200000, baseDailyRevenue: 78000, baseDailyOpex: 58000, staffSlots: 110, demandSensitivity: 0.75, launderingCapacityPerDay: 22000, legality: 'legal', requiredPropertyKind: 'farm', requiredSkill: { skillId: 'production', level: 5 }, reputationEffect: { dimension: 'business', perDay: 0.14 }, description: 'Export crops at scale. World soft-commodity prices set your year.' },
  { id: 'horticulture', name: 'Horticulture Operation', kind: 'farm', setupCost: 1150000, baseDailyRevenue: 34000, baseDailyOpex: 26000, staffSlots: 26, demandSensitivity: 0.5, launderingCapacityPerDay: 12000, legality: 'legal', requiredPropertyKind: 'farm', requiredSkill: { skillId: 'production', level: 3 }, reputationEffect: { dimension: 'business', perDay: 0.08 }, description: 'Climate-controlled high-value cultivation, legal or otherwise depending on the crop.' },
  { id: 'consultancy', name: 'Consultancy', kind: 'consultancy', setupCost: 180000, baseDailyRevenue: 8600, baseDailyOpex: 6100, staffSlots: 14, demandSensitivity: 0.45, launderingCapacityPerDay: 9000, legality: 'legal', requiredPropertyKind: 'office', requiredSkill: { skillId: 'business_management', level: 3 }, reputationEffect: { dimension: 'legal', perDay: 0.08 }, description: 'Sells expertise. Invoicing is discretionary, which is the point.' },
  { id: 'law_firm', name: 'Law Firm', kind: 'law_firm', setupCost: 950000, baseDailyRevenue: 42000, baseDailyOpex: 34000, staffSlots: 26, demandSensitivity: 0.35, launderingCapacityPerDay: 24000, legality: 'legal', requiredPropertyKind: 'office', requiredSkill: { skillId: 'negotiation', level: 5 }, reputationEffect: { dimension: 'legal', perDay: 0.22 }, description: 'Reduces fines, shortens sentences and makes arrests considerably less final.' },
  { id: 'clinic', name: 'Private Clinic', kind: 'clinic', setupCost: 1400000, baseDailyRevenue: 58000, baseDailyOpex: 47000, staffSlots: 34, demandSensitivity: 0.5, launderingCapacityPerDay: 16000, legality: 'legal', requiredPropertyKind: 'office', requiredSkill: { skillId: 'medicine', level: 4 }, reputationEffect: { dimension: 'legal', perDay: 0.18 }, description: 'Treats injuries that would otherwise involve a hospital and a police report.' },
  { id: 'brokerage', name: 'Brokerage', kind: 'brokerage', setupCost: 4200000, baseDailyRevenue: 145000, baseDailyOpex: 118000, staffSlots: 48, demandSensitivity: 0.55, launderingCapacityPerDay: 90000, legality: 'legal', requiredPropertyKind: 'office', requiredSkill: { skillId: 'finance', level: 7 }, reputationEffect: { dimension: 'business', perDay: 0.2 }, description: 'Commission on every trade, direct exchange access, and much better prices.' },
  { id: 'money_service', name: 'Money Service Business', kind: 'brokerage', setupCost: 2600000, baseDailyRevenue: 78000, baseDailyOpex: 62000, staffSlots: 30, demandSensitivity: 0.5, launderingCapacityPerDay: 120000, legality: 'restricted', requiredPropertyKind: 'financial_facility', requiredSkill: { skillId: 'finance', level: 6 }, reputationEffect: { dimension: 'business', perDay: 0.1 }, description: 'Remittance and currency exchange. Cash in, wire out, questions minimal.' },
  { id: 'holding_company', name: 'Holding Company', kind: 'consultancy', setupCost: 640000, baseDailyRevenue: 12000, baseDailyOpex: 9000, staffSlots: 4, demandSensitivity: 0.2, launderingCapacityPerDay: 180000, legality: 'legal', requiredPropertyKind: 'offshore_entity', requiredSkill: { skillId: 'finance', level: 5 }, reputationEffect: { dimension: 'business', perDay: 0.06 }, description: 'Routes subsidiary income through a low-tax jurisdiction. Purely a tax and laundering instrument.' },
  { id: 'research_firm', name: 'Research Firm', kind: 'consultancy', setupCost: 3800000, baseDailyRevenue: 96000, baseDailyOpex: 84000, staffSlots: 32, demandSensitivity: 0.4, launderingCapacityPerDay: 20000, legality: 'legal', requiredPropertyKind: 'research_facility', requiredSkill: { skillId: 'technology', level: 6 }, reputationEffect: { dimension: 'legal', perDay: 0.16 }, description: 'Generates intelligence, patents and data assets that can be sold repeatedly.' },
  { id: 'hosting_firm', name: 'Hosting & Compute Provider', kind: 'tech_startup', setupCost: 5600000, baseDailyRevenue: 165000, baseDailyOpex: 142000, staffSlots: 24, demandSensitivity: 0.5, launderingCapacityPerDay: 30000, legality: 'legal', requiredPropertyKind: 'tech_facility', requiredSkill: { skillId: 'technology', level: 7 }, reputationEffect: { dimension: 'business', perDay: 0.14 }, description: 'Sells compute and connectivity. Also powers your own mining and darknet operations for free.' },
  { id: 'security_firm', name: 'Private Security Firm', kind: 'security_firm', setupCost: 1250000, baseDailyRevenue: 48000, baseDailyOpex: 41000, staffSlots: 40, demandSensitivity: 0.5, launderingCapacityPerDay: 14000, legality: 'legal', requiredPropertyKind: 'office', requiredSkill: { skillId: 'combat', level: 5 }, reputationEffect: { dimension: 'business', perDay: 0.1 }, description: 'Contracts for protection — and a legitimate payroll for people who are good at violence.' },
  { id: 'media_outlet', name: 'Media Outlet', kind: 'media', setupCost: 2100000, baseDailyRevenue: 62000, baseDailyOpex: 57000, staffSlots: 30, demandSensitivity: 0.4, launderingCapacityPerDay: 18000, legality: 'legal', requiredPropertyKind: 'office', requiredSkill: { skillId: 'negotiation', level: 4 }, reputationEffect: { dimension: 'legal', perDay: 0.24 }, description: 'Shapes news coverage. Reputation moves markets, and you get to move reputation.' },
  { id: 'darknet_front', name: 'Anonymous Marketplace Front', kind: 'darknet_front', setupCost: 780000, baseDailyRevenue: 34000, baseDailyOpex: 26000, staffSlots: 8, demandSensitivity: 0.6, launderingCapacityPerDay: 64000, legality: 'illegal', requiredPropertyKind: 'tech_facility', requiredSkill: { skillId: 'hacking', level: 6 }, reputationEffect: { dimension: 'underground', perDay: 0.3 }, description: 'Runs escrow for underground vendors. Fees are excellent and the legal exposure is total.' },
];

export const BUSINESS_BY_ID: Record<string, BusinessDef> = Object.fromEntries(BUSINESSES.map((b) => [b.id, b]));

/* ------------------------------------------------------------------ */
/* Production recipes                                                  */
/* ------------------------------------------------------------------ */

function recipe(r: ProductionRecipeDef): ProductionRecipeDef {
  return r;
}

export const RECIPES: ProductionRecipeDef[] = [
  recipe({
    id: 'mill_flour', name: 'Milling: Wheat → Flour', requiresTag: 'food_processing',
    inputs: [{ commodityId: 'wheat__raw', qty: 1.35 }], outputs: [{ commodityId: 'flour__food_grade', qty: 1 }],
    byproducts: [{ commodityId: 'mixed_livestock__raw', qty: 0.12, chance: 0.6 }],
    capacityPerDay: 120, labourRequired: 6, energyPerUnit: 2.4, opexPerDay: 640, skillId: 'production',
    automationCost: 850000, description: 'Grinds grain into food-grade flour; bran goes to feed.',
  }),
  recipe({
    id: 'refine_sugar', name: 'Refining: Sugarcane → Sugar', requiresTag: 'food_processing',
    inputs: [{ commodityId: 'sugarcane__raw', qty: 8 }], outputs: [{ commodityId: 'sugar__refined', qty: 1 }],
    capacityPerDay: 60, labourRequired: 10, energyPerUnit: 6, opexPerDay: 1100, skillId: 'production',
    automationCost: 1600000, description: 'Crushing and crystallisation. Energy-hungry and seasonal.',
  }),
  recipe({
    id: 'press_palm_oil', name: 'Pressing: Palm Fruit → Oil', requiresTag: 'food_processing',
    inputs: [{ commodityId: 'palm_oil__raw', qty: 1 }], outputs: [{ commodityId: 'palm_oil__refined', qty: 0.82 }],
    capacityPerDay: 90, labourRequired: 8, energyPerUnit: 3.2, opexPerDay: 720, skillId: 'production',
    automationCost: 900000, description: 'Clarifies and deodorises crude palm oil for food use.',
  }),
  recipe({
    id: 'roast_coffee', name: 'Roasting: Green → Artisanal Coffee', requiresTag: 'food_processing',
    inputs: [{ commodityId: 'coffee__raw', qty: 1.18 }], outputs: [{ commodityId: 'coffee__artisanal', qty: 1 }],
    capacityPerDay: 14, labourRequired: 4, energyPerUnit: 1.8, opexPerDay: 420, skillId: 'production',
    automationCost: 380000, description: 'Roasting and grading multiplies value several times over.',
  }),
  recipe({
    id: 'process_cocoa', name: 'Processing: Cocoa → Premium Cocoa', requiresTag: 'food_processing',
    inputs: [{ commodityId: 'cocoa__raw', qty: 1.25 }], outputs: [{ commodityId: 'cocoa__premium', qty: 1 }],
    byproducts: [{ commodityId: 'cocoa__processed', qty: 0.15, chance: 0.5 }],
    capacityPerDay: 22, labourRequired: 7, energyPerUnit: 2.6, opexPerDay: 620, skillId: 'production',
    automationCost: 720000, description: 'Fermentation, roasting and grading for export markets.',
  }),
  recipe({
    id: 'concentrate_copper', name: 'Beneficiation: Copper Ore → Concentrate', requiresTag: 'processing',
    inputs: [{ commodityId: 'copper__raw', qty: 3.4 }], outputs: [{ commodityId: 'copper__concentrate', qty: 1 }],
    byproducts: [{ commodityId: 'gold__raw', qty: 0.004, chance: 0.35 }, { commodityId: 'silver__raw', qty: 0.02, chance: 0.4 }],
    capacityPerDay: 200, labourRequired: 22, energyPerUnit: 8, opexPerDay: 2600, skillId: 'production',
    automationCost: 4200000, description: 'Crushing, grinding and flotation. Acid-consuming and power-hungry.',
  }),
  recipe({
    id: 'smelt_copper', name: 'Smelting: Concentrate → Cathode', requiresTag: 'smelting',
    inputs: [{ commodityId: 'copper__concentrate', qty: 3.2 }, { commodityId: 'sulfuric_acid__industrial_grade', qty: 0.4 }],
    outputs: [{ commodityId: 'copper__refined', qty: 1 }],
    byproducts: [{ commodityId: 'sulfuric_acid__industrial_grade', qty: 1.6, chance: 0.9 }],
    capacityPerDay: 90, labourRequired: 30, energyPerUnit: 3, opexPerDay: 4800, skillId: 'production',
    automationCost: 9500000, description: 'Smelting and electrorefining to 99.99% cathode. By-product acid often pays the bills.',
  }),
  recipe({
    id: 'smelt_steel', name: 'Steelmaking: Iron Ore → Steel', requiresTag: 'smelting',
    inputs: [{ commodityId: 'iron_ore__raw', qty: 1.6 }, { commodityId: 'thermal_coal__raw', qty: 0.78 }],
    outputs: [{ commodityId: 'steel__refined', qty: 1 }],
    byproducts: [{ commodityId: 'steel__scrap', qty: 0.08, chance: 0.7 }],
    capacityPerDay: 140, labourRequired: 40, energyPerUnit: 18, opexPerDay: 6200, skillId: 'production',
    automationCost: 12000000, description: 'Blast furnace or electric arc, depending on your power costs.',
  }),
  recipe({
    id: 'refine_aluminium', name: 'Refining: Bauxite → Aluminium', requiresTag: 'smelting',
    inputs: [{ commodityId: 'bauxite__raw', qty: 4.2 }, { commodityId: 'caustic_soda__industrial_grade', qty: 0.18 }],
    outputs: [{ commodityId: 'aluminium__refined', qty: 1 }],
    capacityPerDay: 60, labourRequired: 26, energyPerUnit: 42, opexPerDay: 5400, skillId: 'production',
    automationCost: 14000000, description: 'Electrolysis. Your electricity price decides whether this is a business or a bonfire.',
  }),
  recipe({
    id: 'alloy_aluminium', name: 'Alloying: Aluminium → Alloy', requiresTag: 'processing',
    inputs: [{ commodityId: 'aluminium__refined', qty: 1.05 }, { commodityId: 'copper__refined', qty: 0.045 }],
    outputs: [{ commodityId: 'aluminium__alloy', qty: 1 }],
    capacityPerDay: 45, labourRequired: 12, energyPerUnit: 4, opexPerDay: 1800, skillId: 'production',
    automationCost: 3400000, description: 'Specification alloy for aerospace and automotive buyers.',
  }),
  recipe({
    id: 'recycle_scrap_metal', name: 'Recycling: Scrap → Refined Metal', requiresTag: 'refining',
    inputs: [{ commodityId: 'copper__scrap', qty: 1.15 }], outputs: [{ commodityId: 'copper__refined', qty: 0.92 }],
    byproducts: [{ commodityId: 'gold__scrap', qty: 0.002, chance: 0.3 }],
    capacityPerDay: 70, labourRequired: 14, energyPerUnit: 7, opexPerDay: 1500, skillId: 'production',
    automationCost: 2800000, description: 'Secondary smelting is far cheaper than primary — if you can source the scrap.',
  }),
  recipe({
    id: 'refine_gold', name: 'Refining: Raw Gold → Bullion', requiresTag: 'refining',
    inputs: [{ commodityId: 'gold__raw', qty: 1.28 }], outputs: [{ commodityId: 'gold__refined', qty: 1 }],
    capacityPerDay: 12, labourRequired: 6, energyPerUnit: 4, opexPerDay: 900, skillId: 'production',
    automationCost: 1900000, description: 'Assay and refine to investment grade. Certification is what creates the premium.',
  }),
  recipe({
    id: 'distil_fuel', name: 'Refining: Crude → Diesel', requiresTag: 'chemical',
    inputs: [{ commodityId: 'crude_oil__raw', qty: 1.32 }],
    outputs: [{ commodityId: 'diesel__refined', qty: 0.58 }, { commodityId: 'gasoline__refined', qty: 0.42 }],
    byproducts: [{ commodityId: 'propane__refined', qty: 0.06, chance: 0.8 }, { commodityId: 'sulfur__raw', qty: 0.02, chance: 0.7 }],
    capacityPerDay: 110, labourRequired: 34, energyPerUnit: 12, opexPerDay: 7400, skillId: 'production',
    automationCost: 18000000, description: 'Atmospheric distillation. The crack spread is your margin.',
  }),
  recipe({
    id: 'make_fertiliser', name: 'Chemicals: Ammonia → Urea', requiresTag: 'chemical',
    inputs: [{ commodityId: 'ammonia__industrial_grade', qty: 0.57 }, { commodityId: 'lng__refined', qty: 0.02 }],
    outputs: [{ commodityId: 'urea_fertiliser__industrial_grade', qty: 1 }],
    capacityPerDay: 130, labourRequired: 20, energyPerUnit: 9, opexPerDay: 3900, skillId: 'production',
    automationCost: 8200000, description: 'Haber-Bosch downstream. Farmers buy whatever you can make in spring.',
  }),
  recipe({
    id: 'make_plastics', name: 'Chemicals: Ethylene → Resin', requiresTag: 'chemical',
    inputs: [{ commodityId: 'ethylene__industrial_grade', qty: 1.08 }], outputs: [{ commodityId: 'epoxy_resin__industrial_grade', qty: 1 }],
    capacityPerDay: 80, labourRequired: 16, energyPerUnit: 9, opexPerDay: 2600, skillId: 'production',
    automationCost: 6400000, description: 'Polymerisation. Demand tracks construction and packaging.',
  }),
  recipe({
    id: 'assemble_pcb', name: 'Assembly: Boards → Electronics', requiresTag: 'assembly',
    inputs: [{ commodityId: 'circuit_boards__component', qty: 0.8 }, { commodityId: 'memory_modules__component', qty: 1.2 }, { commodityId: 'copper__component', qty: 0.02 }],
    outputs: [{ commodityId: 'consumer_electronics__assembled', qty: 1 }],
    capacityPerDay: 260, labourRequired: 48, energyPerUnit: 1.6, opexPerDay: 4200, skillId: 'production',
    automationCost: 11000000, description: 'Pick-and-place lines. Labour cost and yield decide profitability.',
  }),
  recipe({
    id: 'assemble_smartphones', name: 'Assembly: Components → Smartphones', requiresTag: 'assembly',
    inputs: [{ commodityId: 'displays__component', qty: 1 }, { commodityId: 'circuit_boards__component', qty: 1 }, { commodityId: 'memory_modules__component', qty: 1.5 }, { commodityId: 'lithium_brine__refined', qty: 0.004 }],
    outputs: [{ commodityId: 'smartphones__assembled', qty: 1 }],
    capacityPerDay: 180, labourRequired: 60, energyPerUnit: 2.2, opexPerDay: 5600, skillId: 'production',
    automationCost: 16000000, description: 'Final assembly at volume. Margins are thin unless you own the brand.',
  }),
  recipe({
    id: 'make_solar_panels', name: 'Assembly: Cells → Solar Panels', requiresTag: 'assembly',
    inputs: [{ commodityId: 'semiconductor_wafers__industrial_grade', qty: 0.01 }, { commodityId: 'aluminium__alloy', qty: 0.008 }, { commodityId: 'glass_panels__industrial_grade', qty: 0.02 }],
    outputs: [{ commodityId: 'solar_panels__assembled', qty: 1 }],
    capacityPerDay: 90, labourRequired: 28, energyPerUnit: 5, opexPerDay: 3200, skillId: 'production',
    automationCost: 9800000, description: 'Module lamination. Policy subsidies arrive and vanish without warning.',
  }),
  recipe({
    id: 'make_ev_batteries', name: 'Assembly: Lithium → EV Battery Packs', requiresTag: 'assembly',
    inputs: [{ commodityId: 'lithium_brine__refined', qty: 0.09 }, { commodityId: 'cobalt_ore__refined', qty: 0.02 }, { commodityId: 'nickel__refined', qty: 0.06 }, { commodityId: 'copper__refined', qty: 0.03 }],
    outputs: [{ commodityId: 'ev_batteries__assembled', qty: 1 }],
    capacityPerDay: 40, labourRequired: 34, energyPerUnit: 11, opexPerDay: 4800, skillId: 'production',
    automationCost: 22000000, description: 'Cell manufacturing and pack assembly. The most capital-intensive chain in the game.',
  }),
  recipe({
    id: 'spin_yarn', name: 'Textiles: Cotton → Yarn', requiresTag: 'processing',
    inputs: [{ commodityId: 'cotton__raw', qty: 1.1 }], outputs: [{ commodityId: 'cotton_yarn__raw', qty: 1 }],
    capacityPerDay: 70, labourRequired: 24, energyPerUnit: 3.4, opexPerDay: 1600, skillId: 'production',
    automationCost: 3600000, description: 'Carding and spinning. Commodity margin, steady demand.',
  }),
  recipe({
    id: 'weave_denim', name: 'Textiles: Yarn → Denim', requiresTag: 'processing',
    inputs: [{ commodityId: 'cotton_yarn__raw', qty: 1.15 }], outputs: [{ commodityId: 'denim__raw', qty: 1 }],
    capacityPerDay: 55, labourRequired: 20, energyPerUnit: 3, opexPerDay: 1400, skillId: 'production',
    automationCost: 3200000, description: 'Weaving and indigo dyeing.',
  }),
  recipe({
    id: 'sew_garments', name: 'Apparel: Denim → Garments', requiresTag: 'assembly',
    inputs: [{ commodityId: 'denim__raw', qty: 0.0012 }], outputs: [{ commodityId: 'garments__packaged', qty: 1 }],
    capacityPerDay: 900, labourRequired: 70, energyPerUnit: 0.15, opexPerDay: 2400, skillId: 'production',
    automationCost: 5200000, description: 'Cut-make-trim. Labour arbitrage is the entire industry.',
  }),
  recipe({
    id: 'distil_whiskey', name: 'Distilling: Grain → Whiskey', requiresTag: 'food_processing',
    inputs: [{ commodityId: 'wheat__raw', qty: 0.006 }, { commodityId: 'bottled_water__packaged', qty: 6 }],
    outputs: [{ commodityId: 'whiskey__packaged', qty: 1 }],
    capacityPerDay: 220, labourRequired: 10, energyPerUnit: 0.9, opexPerDay: 1200, skillId: 'production',
    automationCost: 2400000, description: 'Distillation and bottling. Ageing would take years; you sell it young.',
  }),
  recipe({
    id: 'brew_beer', name: 'Brewing: Grain → Beer', requiresTag: 'food_processing',
    inputs: [{ commodityId: 'maize__raw', qty: 0.0018 }, { commodityId: 'bottled_water__packaged', qty: 0.55 }],
    outputs: [{ commodityId: 'beer__packaged', qty: 1 }],
    capacityPerDay: 1400, labourRequired: 12, energyPerUnit: 0.3, opexPerDay: 1100, skillId: 'production',
    automationCost: 1800000, description: 'High-volume, low-margin, and a reliable local cash business.',
  }),
  recipe({
    id: 'pack_canned_goods', name: 'Canning: Produce → Canned Goods', requiresTag: 'food_processing',
    inputs: [{ commodityId: 'poultry__raw', qty: 0.06 }, { commodityId: 'steel__refined', qty: 0.00003 }],
    outputs: [{ commodityId: 'canned_goods__packaged', qty: 1 }],
    capacityPerDay: 1800, labourRequired: 26, energyPerUnit: 0.4, opexPerDay: 1500, skillId: 'production',
    automationCost: 2600000, description: 'Shelf-stable protein. Disaster demand makes this a hedge as much as a business.',
  }),
  recipe({
    id: 'formulate_pharma', name: 'Pharma: API → Packaged Medicines', requiresTag: 'pharma',
    inputs: [{ commodityId: 'acetone__pharma_grade', qty: 0.004 }, { commodityId: 'statins__pharma_grade', qty: 1.05 }],
    outputs: [{ commodityId: 'statins__packaged', qty: 4.6 }],
    capacityPerDay: 1200, labourRequired: 22, energyPerUnit: 0.8, opexPerDay: 2200, skillId: 'medicine',
    automationCost: 6800000, description: 'Tableting, blistering and serialization. Regulation is the moat.',
  }),
  recipe({
    id: 'make_ammunition', name: 'Munitions: Lead & Brass → Ammunition', requiresTag: 'processing',
    inputs: [{ commodityId: 'lead__refined', qty: 0.00001 }, { commodityId: 'copper__refined', qty: 0.000005 }],
    outputs: [{ commodityId: 'ammunition__civilian', qty: 1 }],
    capacityPerDay: 20000, labourRequired: 18, energyPerUnit: 0.02, opexPerDay: 1800, skillId: 'production',
    automationCost: 3900000, description: 'Licensed munitions production. Inspections are frequent and unforgiving.',
  }),
  recipe({
    id: 'make_cement', name: 'Kiln: Limestone → Cement', requiresTag: 'processing',
    inputs: [{ commodityId: 'limestone__raw', qty: 1.4 }, { commodityId: 'thermal_coal__raw', qty: 0.2 }],
    outputs: [{ commodityId: 'cement__raw', qty: 1 }],
    capacityPerDay: 400, labourRequired: 24, energyPerUnit: 6, opexPerDay: 2800, skillId: 'production',
    automationCost: 7200000, description: 'Rotary kiln. Heavy, local, and booming wherever construction booms.',
  }),
  recipe({
    id: 'make_glass', name: 'Float Glass: Sand → Glass', requiresTag: 'smelting',
    inputs: [{ commodityId: 'industrial_sand__raw', qty: 1.25 }, { commodityId: 'limestone__raw', qty: 0.1 }],
    outputs: [{ commodityId: 'glass_panels__industrial_grade', qty: 1 }],
    capacityPerDay: 150, labourRequired: 18, energyPerUnit: 12, opexPerDay: 2400, skillId: 'production',
    automationCost: 6400000, description: 'Continuous float process. Energy is most of the cost.',
  }),
  recipe({
    id: 'refine_rare_earth', name: 'Separation: RE Ore → Concentrate', requiresTag: 'chemical',
    inputs: [{ commodityId: 'rare_earth_ore__raw', qty: 6.5 }, { commodityId: 'sulfuric_acid__industrial_grade', qty: 1.8 }],
    outputs: [{ commodityId: 'rare_earth_ore__concentrate', qty: 1 }],
    byproducts: [{ commodityId: 'uranium_yellowcake__raw', qty: 0.0008, chance: 0.25 }],
    capacityPerDay: 34, labourRequired: 28, energyPerUnit: 16, opexPerDay: 5200, skillId: 'production',
    automationCost: 15000000, description: 'Solvent extraction. Radioactive tailings are a liability that follows you.',
  }),
  recipe({
    id: 'process_coltan', name: 'Beneficiation: Coltan → Tantalum Concentrate', requiresTag: 'processing',
    inputs: [{ commodityId: 'coltan__raw', qty: 4.6 }], outputs: [{ commodityId: 'coltan__concentrate', qty: 1 }],
    capacityPerDay: 60, labourRequired: 16, energyPerUnit: 5, opexPerDay: 1900, skillId: 'production',
    automationCost: 4400000, description: 'Gravimetric and magnetic separation. Origin documentation is the hard part.',
  }),
  recipe({
    id: 'refine_lithium', name: 'Refining: Brine → Battery-Grade Lithium', requiresTag: 'chemical',
    inputs: [{ commodityId: 'lithium_brine__raw', qty: 8.5 }], outputs: [{ commodityId: 'lithium_brine__refined', qty: 1 }],
    capacityPerDay: 40, labourRequired: 20, energyPerUnit: 10, opexPerDay: 3600, skillId: 'production',
    automationCost: 11500000, description: 'Evaporation ponds and precipitation. Months of lead time compressed into a shift.',
  }),
  recipe({
    id: 'process_vanilla', name: 'Curing: Vanilla → Premium', requiresTag: 'food_processing',
    inputs: [{ commodityId: 'vanilla__raw', qty: 1.35 }], outputs: [{ commodityId: 'vanilla__premium', qty: 1 }],
    capacityPerDay: 6, labourRequired: 8, energyPerUnit: 0.4, opexPerDay: 380, skillId: 'production',
    automationCost: 420000, description: 'Hand-curing over months. Labour-intensive and enormously profitable per kilo.',
  }),
  recipe({
    id: 'make_counterfeits', name: 'Counterfeiting: Textiles → Fake Luxury', requiresTag: 'assembly',
    inputs: [{ commodityId: 'denim__raw', qty: 0.0008 }, { commodityId: 'garments__packaged', qty: 1 }],
    outputs: [{ commodityId: 'designer_handbags__counterfeit', qty: 1 }],
    capacityPerDay: 120, labourRequired: 22, energyPerUnit: 0.2, opexPerDay: 1400, skillId: 'forgery',
    automationCost: 1200000, description: 'Illicit manufacturing. Margins are excellent until the raid.',
  }),
  recipe({
    id: 'assemble_mining_rigs', name: 'Assembly: Components → Mining Rigs', requiresTag: 'assembly',
    inputs: [
      { commodityId: 'consumer_electronics__assembled', qty: 0.6 },
      { commodityId: 'copper__refined', qty: 0.006 },
      { commodityId: 'aluminium__alloy', qty: 0.012 },
    ],
    outputs: [{ commodityId: 'mining_rigs__assembled', qty: 1 }],
    capacityPerDay: 4, labourRequired: 8, energyPerUnit: 2, opexPerDay: 1400, skillId: 'technology',
    automationCost: 3200000,
    description: 'Hash boards, frames and power delivery assembled into a working rig. Rigs are consumed by the crypto mining system — digital issuance itself is not a production recipe.',
  }),
  /* ---------------- packaging (warehouses and distribution centres) ------- */
  recipe({
    id: 'package_canned_goods', name: 'Packaging: Canned Goods Bulk → Retail', requiresTag: 'packaging',
    inputs: [{ commodityId: 'canned_goods__bulk', qty: 1 }], outputs: [{ commodityId: 'canned_goods__packaged', qty: 1 }],
    capacityPerDay: 6000, labourRequired: 6, energyPerUnit: 0.35, opexPerDay: 850, skillId: 'storage_management',
    automationCost: 120000, description: 'Repacking bulk tins into retail cases with labelling and barcodes. Thin per-unit work, enormous volume.',
  }),
  recipe({
    id: 'package_poultry', name: 'Processing: Poultry → Retail Packs', requiresTag: 'packaging',
    inputs: [{ commodityId: 'poultry__raw', qty: 1 }], outputs: [{ commodityId: 'poultry__packaged', qty: 1 }],
    byproducts: [{ commodityId: 'mixed_livestock__raw', qty: 0.08, chance: 0.5 }],
    capacityPerDay: 1200, labourRequired: 8, energyPerUnit: 0.9, opexPerDay: 1400, skillId: 'storage_management',
    automationCost: 420000, description: 'Cold-chain portioning and packing. Energy-hungry and unforgiving of downtime.',
  }),

  /* ------------------------- agriculture (farms) -------------------------- */
  recipe({
    id: 'grow_wheat', name: 'Cultivation: Fertiliser → Wheat', requiresTag: 'agriculture',
    inputs: [{ commodityId: 'urea_fertiliser__bulk', qty: 0.4 }], outputs: [{ commodityId: 'wheat__raw', qty: 1 }],
    byproducts: [{ commodityId: 'mixed_livestock__raw', qty: 0.1, chance: 0.4 }],
    capacityPerDay: 200, labourRequired: 8, energyPerUnit: 0.5, opexPerDay: 1200, skillId: 'production',
    automationCost: 600000, description: 'Sowing, spraying and harvesting. Yield follows fertiliser, weather and diesel prices.',
  }),
  recipe({
    id: 'graze_cattle', name: 'Ranching: Feed → Cattle', requiresTag: 'agriculture',
    inputs: [{ commodityId: 'maize__raw', qty: 1.6 }, { commodityId: 'soybean__raw', qty: 0.3 }],
    outputs: [{ commodityId: 'cattle__raw', qty: 1 }],
    capacityPerDay: 40, labourRequired: 10, energyPerUnit: 0.2, opexPerDay: 900, skillId: 'production',
    automationCost: 480000, description: 'Feedlot finishing. Slow, land-hungry and very sensitive to grain prices.',
  }),

  /* --------------------- horticulture (greenhouses) ----------------------- */
  recipe({
    id: 'cultivate_cannabis', name: 'Horticulture: Nutrients → Cannabis', requiresTag: 'horticulture',
    inputs: [{ commodityId: 'urea_fertiliser__processed', qty: 0.9 }, { commodityId: 'ammonia__industrial_grade', qty: 0.35 }],
    outputs: [{ commodityId: 'cannabis__raw', qty: 1 }],
    capacityPerDay: 30, labourRequired: 14, energyPerUnit: 2.2, opexPerDay: 3600, skillId: 'production',
    automationCost: 1400000, description: 'Sealed grow rooms under lights. Enormous power bills, and every kilowatt is a signature.',
  }),
  recipe({
    id: 'cultivate_coca', name: 'Horticulture: Fertiliser → Coca Leaf', requiresTag: 'horticulture',
    inputs: [{ commodityId: 'urea_fertiliser__bulk', qty: 0.35 }], outputs: [{ commodityId: 'coca_leaves__raw', qty: 1 }],
    capacityPerDay: 120, labourRequired: 9, energyPerUnit: 0.6, opexPerDay: 1500, skillId: 'production',
    automationCost: 700000, description: 'Terraced cultivation under netting. The leaf is legal-ish; the buyers are not.',
  }),

  /* ---------------------- research (offices and labs) --------------------- */
  recipe({
    id: 'analyse_market_data', name: 'Research: Manifests → Market Intel', requiresTag: 'research',
    inputs: [{ commodityId: 'shipping_manifests__encrypted', qty: 1 }, { commodityId: 'software_licenses__encrypted', qty: 0.06 }],
    outputs: [{ commodityId: 'market_intel__encrypted', qty: 1 }],
    capacityPerDay: 4, labourRequired: 6, energyPerUnit: 1.8, opexPerDay: 2200, skillId: 'market_analysis',
    automationCost: 900000, description: 'Analysts cross-reference shipment data into tradable intelligence about who is moving what.',
  }),
  recipe({
    id: 'process_satellite_imagery', name: 'Research: Imagery → Premium Analysis', requiresTag: 'research',
    inputs: [{ commodityId: 'satellite_imagery__encrypted', qty: 1 }], outputs: [{ commodityId: 'satellite_imagery__premium', qty: 1 }],
    capacityPerDay: 3, labourRequired: 7, energyPerUnit: 2.5, opexPerDay: 3000, skillId: 'technology',
    automationCost: 1100000, description: 'Turning raw orbital passes into annotated imagery that traders and governments will pay for.',
  }),

  /* ------------------------- mining (datacentres) ------------------------- */
  recipe({
    id: 'mine_data_ledgers', name: 'Datacentre: Hardware → Encrypted Ledgers', requiresTag: 'mining',
    inputs: [{ commodityId: 'gpus__assembled', qty: 0.35 }, { commodityId: 'ssd_drives__component', qty: 1 }],
    outputs: [{ commodityId: 'encrypted_ledger__encrypted', qty: 1 }],
    capacityPerDay: 2, labourRequired: 5, energyPerUnit: 9, opexPerDay: 4800, skillId: 'hacking',
    automationCost: 1600000, description: 'Grinding hardware into verified ledger sets. Power and cooling are most of the cost.',
  }),
];

export const RECIPE_BY_ID: Record<string, ProductionRecipeDef> = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

/** All production tags available across properties. */
export const PRODUCTION_TAGS: string[] = Array.from(
  new Set(PROPERTIES.flatMap((p) => p.productionTags ?? [])),
);

/** Recipes enabled by a given property definition. */
export function recipesForProperty(propertyId: string): ProductionRecipeDef[] {
  const prop = PROPERTY_BY_ID[propertyId];
  if (!prop?.productionTags) return [];
  return RECIPES.filter((r) => prop.productionTags!.includes(r.requiresTag));
}
