/**
 * People registries: skills, perks, employee roles, enemies and name banks.
 *
 * Skill/perk *effects* are expressed as named numeric modifiers rather than
 * bespoke code paths, so adding a new perk is a data change. The engine reads
 * these keys through `PlayerModifiers` (see `src/sim/modifiers.ts`).
 */

import type { EnemyDef, EmployeeRoleDef, PerkDef, SkillDef } from '../../sim/types';

/* ------------------------------------------------------------------ */
/* Skills                                                              */
/* ------------------------------------------------------------------ */

function sk(
  id: string, name: string, tree: SkillDef['tree'], description: string, effectPerLevel: string,
  prerequisites: SkillDef['prerequisites'] = [], maxLevel = 20,
): SkillDef {
  return { id, name, description, tree, maxLevel, prerequisites, effectPerLevel };
}

export const SKILLS: SkillDef[] = [
  /* trading */
  sk('trading', 'Trading', 'trading', 'Negotiating prices, reading order flow and timing entries.', '−0.45% buy/sell spread and +2% realised margin per level.'),
  sk('market_analysis', 'Market Analysis', 'trading', 'Reading price history, supply/demand and sentiment to forecast moves.', '+3% forecast accuracy and unlocks deeper market analytics per level.', [{ skillId: 'trading', level: 2 }]),
  sk('appraisal', 'Appraisal', 'trading', 'Judging quality, authenticity and true value of graded goods.', '+2% sale price on graded goods and fewer counterfeit losses per level.'),
  sk('negotiation', 'Negotiation', 'diplomacy', 'Getting better terms from vendors, officials and counterparties.', '+2% deal improvement and +1.5% bribe/negotiation success per level.'),

  /* finance */
  sk('finance', 'Finance', 'finance', 'Credit, capital structure, rates and tax efficiency.', '−1.2% effective loan APR and +1.5% investment return per level.'),
  sk('accounting', 'Accounting', 'finance', 'Books, audits and keeping revenue where it belongs.', '−2% tax leakage and −3% laundering fee per level.', [{ skillId: 'finance', level: 2 }]),
  sk('laundering', 'Laundering', 'criminal', 'Converting dirty money into spendable, documented funds.', '−2.5% laundering fee and −2% detection chance per level.', [{ skillId: 'accounting', level: 3 }]),
  sk('law', 'Law', 'finance', 'Regulations, licences and criminal procedure.', '−3% fine severity and −2% prosecution chance per level.', [{ skillId: 'finance', level: 4 }]),

  /* logistics */
  sk('logistics', 'Logistics', 'logistics', 'Routing, freight consolidation and network throughput.', '+3% logistics efficiency and −2% shipping cost per level.'),
  sk('driving', 'Driving', 'logistics', 'Operating road vehicles at speed without attracting attention.', 'Unlocks heavier vehicles; −3% trip risk and −2% vehicle wear per level.'),
  sk('seamanship', 'Seamanship', 'logistics', 'Operating vessels, and knowing which waters to avoid.', 'Unlocks marine vessels; −4% maritime interdiction risk per level.'),
  sk('piloting', 'Piloting', 'logistics', 'Operating aircraft and filing flight plans that get approved.', 'Unlocks aircraft; −3% flight risk and +2% payload per level.', [{ skillId: 'driving', level: 3 }]),
  sk('smuggling', 'Smuggling', 'criminal', 'Concealment, false paperwork and customs behaviour.', '−4% detection chance and +3% concealed capacity per level.', [{ skillId: 'logistics', level: 2 }]),
  sk('storage_management', 'Storage Management', 'logistics', 'Warehouse layout, stock rotation and loss prevention.', '−4% theft/spoilage loss and +2% storage capacity per level.', [{ skillId: 'logistics', level: 3 }]),

  /* production / technology */
  sk('production', 'Production', 'technology', 'Running plants: throughput, yield and uptime.', '+2.5% efficiency and +1.5% quality per level.'),
  sk('engineering', 'Engineering', 'technology', 'Maintaining and upgrading machinery and vehicles.', '−4% breakdown chance and −3% maintenance cost per level.', [{ skillId: 'production', level: 2 }]),
  sk('chemistry', 'Chemistry', 'technology', 'Synthesis, refining and precursor handling.', 'Unlocks chemical/pharma recipes; +3% yield per level.', [{ skillId: 'production', level: 4 }]),
  sk('medicine', 'Medicine', 'technology', 'Clinical production and treating injuries without hospitals.', 'Unlocks pharma recipes; −6% injury recovery time per level.', [{ skillId: 'chemistry', level: 2 }]),
  sk('technology', 'Technology', 'technology', 'Hardware, automation and compute infrastructure.', '+3% automation efficiency and unlocks advanced facilities per level.'),
  sk('hacking', 'Hacking', 'criminal', 'Intrusion, data theft and darknet tradecraft.', '+4% hack success and +5% data value per level.', [{ skillId: 'technology', level: 3 }]),
  sk('automation', 'Automation', 'technology', 'Designing systems that run without you.', '+3% automation uptime and −5% manager error rate per level.', [{ skillId: 'technology', level: 5 }]),

  /* business / management */
  sk('business_management', 'Business Management', 'business', 'Running operating businesses profitably.', '+2.5% business revenue and −1.5% opex per level.'),
  sk('leadership', 'Leadership', 'business', 'Directing managers and holding an organisation together.', '+3% crew effectiveness and +1 span of control every 4 levels.', [{ skillId: 'business_management', level: 3 }]),
  sk('marketing', 'Marketing', 'business', 'Building clientele and moving product.', '+4% marketing effectiveness and +1.5% retail revenue per level.', [{ skillId: 'business_management', level: 2 }]),
  sk('human_resources', 'Human Resources', 'business', 'Hiring, retaining and motivating personnel.', '+2 crew loyalty and −2% salary demands per level.', [{ skillId: 'leadership', level: 2 }]),

  /* combat / criminal */
  sk('combat', 'Combat', 'combat', 'Fighting effectively when fighting is unavoidable.', '+3% damage and +2% accuracy per level.'),
  sk('firearms', 'Firearms', 'combat', 'Ranged weapon handling under pressure.', '+4% ranged accuracy and −3% fumble chance per level.', [{ skillId: 'combat', level: 2 }]),
  sk('tactics', 'Tactics', 'combat', 'Positioning, initiative and commanding a squad.', '+3% squad effectiveness and +1 initiative per level.', [{ skillId: 'combat', level: 4 }]),
  sk('intimidation', 'Intimidation', 'combat', 'Ending encounters without shots being fired.', '+4% intimidation success and −2% encounter escalation per level.', [{ skillId: 'combat', level: 2 }]),
  sk('stealth', 'Stealth', 'criminal', 'Avoiding observation, patrols and cameras.', '−5% patrol detection and −3% raid probability per level.'),
  sk('streetwise', 'Streetwise', 'criminal', 'Knowing who to ask, who to pay and who to avoid.', '−4% black market premium and +3% intel availability per level.'),
  sk('forgery', 'Forgery', 'criminal', 'Documents, manifests and identities that pass inspection.', '−6% document-based detection and unlocks forged paperwork per level.', [{ skillId: 'streetwise', level: 3 }]),
  sk('bribery', 'Bribery', 'criminal', 'Converting money into official indifference.', '+5% bribe success and −4% bribe cost per level.', [{ skillId: 'streetwise', level: 2 }]),
  sk('survival', 'Survival', 'combat', 'Enduring injury, prison and hostile environments.', '+4 max HP and −5% injury severity per level.'),
  sk('diplomacy', 'Diplomacy', 'diplomacy', 'Faction relations, treaties and standing.', '+5% faction standing gains and −3% standing losses per level.', [{ skillId: 'negotiation', level: 3 }]),
];

export const SKILL_BY_ID: Record<string, SkillDef> = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export const SKILL_TREES: SkillDef['tree'][] = [
  'trading', 'finance', 'logistics', 'combat', 'diplomacy', 'technology', 'business', 'criminal',
];

/* ------------------------------------------------------------------ */
/* Perks                                                               */
/* ------------------------------------------------------------------ */

function pk(
  id: string, name: string, tree: PerkDef['tree'], description: string, modifiers: PerkDef['modifiers'],
  extra: Partial<PerkDef> = {},
): PerkDef {
  return { id, name, description, tree, modifiers, ...extra };
}

export const PERKS: PerkDef[] = [
  /* trading */
  pk('sharp_eye', 'Sharp Eye', 'trading', 'You spot mispricing faster than the market corrects it.', { 'market.forecastAccuracy': 0.12, 'trade.spreadReduction': 0.1 }, { requiresSkill: { skillId: 'market_analysis', level: 3 } }),
  pk('volume_trader', 'Volume Trader', 'trading', 'Large orders are sliced to limit impact.', { 'trade.priceImpactReduction': 0.25 }, { requiresSkill: { skillId: 'trading', level: 5 } }),
  pk('local_knowledge', 'Local Knowledge', 'trading', 'You know which districts pay more for what.', { 'market.infoBonus': 0.15, 'trade.marginBonus': 0.04 }),
  pk('market_maker', 'Market Maker', 'trading', 'You quote both sides and keep the spread.', { 'trade.spreadReduction': 0.35, 'trade.feeReduction': 0.2 }, { requiresSkill: { skillId: 'trading', level: 9 }, requiresPerk: 'volume_trader' }),
  pk('contrarian', 'Contrarian', 'trading', 'You buy panic and sell euphoria.', { 'market.sentimentEdge': 0.2, 'trade.xpMultiplier': 1.15 }, { requiresSkill: { skillId: 'market_analysis', level: 6 } }),

  /* finance */
  pk('prime_borrower', 'Prime Borrower', 'finance', 'Lenders compete for your signature.', { 'finance.interestReduction': 0.12, 'finance.loanLimitMultiplier': 1.5 }, { requiresSkill: { skillId: 'finance', level: 4 } }),
  pk('tax_efficient', 'Tax Efficient', 'finance', 'Legally aggressive structuring.', { 'finance.taxReduction': 0.18 }, { requiresSkill: { skillId: 'accounting', level: 4 } }),
  pk('clean_hands', 'Clean Hands', 'finance', 'Your laundering leaves fewer traces.', { 'finance.launderingFeeReduction': 0.2, 'finance.launderingDetectionReduction': 0.3 }, { requiresSkill: { skillId: 'laundering', level: 5 } }),
  pk('offshore_architect', 'Offshore Architect', 'finance', 'Three jurisdictions between you and any subpoena.', { 'finance.taxReduction': 0.3, 'finance.seizureProtection': 0.25 }, { requiresSkill: { skillId: 'finance', level: 10 }, requiresPerk: 'tax_efficient' }),
  pk('margin_master', 'Margin Master', 'finance', 'You use leverage without being liquidated by noise.', { 'stocks.marginEfficiency': 0.2, 'stocks.feeReduction': 0.4 }, { requiresSkill: { skillId: 'finance', level: 7 } }),
  pk('dividend_harvester', 'Dividend Harvester', 'finance', 'You reinvest yield automatically and cheaply.', { 'stocks.dividendBonus': 0.15 }, { requiresSkill: { skillId: 'finance', level: 5 } }),

  /* logistics */
  pk('route_optimiser', 'Route Optimiser', 'logistics', 'Every kilometre is planned.', { 'travel.costReduction': 0.18, 'travel.timeReduction': 0.15 }, { requiresSkill: { skillId: 'logistics', level: 4 } }),
  pk('ghost_manifest', 'Ghost Manifest', 'logistics', 'The paperwork describes a different shipment.', { 'smuggling.detectionReduction': 0.28 }, { requiresSkill: { skillId: 'smuggling', level: 5 } }),
  pk('double_bottom', 'Double Bottom', 'logistics', 'Compartments inspectors do not think to measure.', { 'smuggling.capacityBonus': 0.35, 'smuggling.detectionReduction': 0.12 }, { requiresSkill: { skillId: 'smuggling', level: 7 } }),
  pk('cold_chain_expert', 'Cold Chain Expert', 'logistics', 'Perishables arrive perishable no longer.', { 'logistics.spoilageReduction': 0.6 }, { requiresSkill: { skillId: 'storage_management', level: 4 } }),
  pk('fleet_commander', 'Fleet Commander', 'logistics', 'Your vehicles run themselves, profitably.', { 'logistics.autoEfficiency': 0.15, 'logistics.theftReduction': 0.2 }, { requiresSkill: { skillId: 'logistics', level: 8 } }),
  pk('pack_mule', 'Pack Mule', 'logistics', 'You carry more than you should, comfortably.', { 'inventory.capacityKgBonus': 18, 'inventory.capacityLBonus': 40 }),

  /* production / technology */
  pk('yield_master', 'Yield Master', 'technology', 'Fewer defective units per shift.', { 'production.efficiencyBonus': 0.12, 'production.qualityBonus': 0.1 }, { requiresSkill: { skillId: 'production', level: 5 } }),
  pk('preventive_maintenance', 'Preventive Maintenance', 'technology', 'Machines fail on your schedule, not theirs.', { 'production.breakdownReduction': 0.5, 'production.maintenanceReduction': 0.2 }, { requiresSkill: { skillId: 'engineering', level: 4 } }),
  pk('lights_out', 'Lights Out', 'technology', 'The plant runs with nobody in it.', { 'automation.efficiencyBonus': 0.2, 'automation.errorReduction': 0.4 }, { requiresSkill: { skillId: 'automation', level: 6 } }),
  pk('hash_optimiser', 'Hash Optimiser', 'technology', 'More hashes per kilowatt-hour.', { 'crypto.miningEfficiency': 0.35, 'crypto.energyReduction': 0.2 }, { requiresSkill: { skillId: 'technology', level: 6 } }),
  pk('protocol_insider', 'Protocol Insider', 'technology', 'You read governance proposals before the market does.', { 'crypto.infoBonus': 0.25, 'crypto.feeReduction': 0.3 }, { requiresSkill: { skillId: 'technology', level: 8 } }),

  /* business / management */
  pk('franchise_playbook', 'Franchise Playbook', 'business', 'Every location runs to the same standard.', { 'business.revenueBonus': 0.12, 'business.opexReduction': 0.08 }, { requiresSkill: { skillId: 'business_management', level: 5 } }),
  pk('loyalty_cultivator', 'Loyalty Cultivator', 'business', 'People stay because they want to.', { 'crew.loyaltyBonus': 12, 'crew.betrayalReduction': 0.4 }, { requiresSkill: { skillId: 'human_resources', level: 4 } }),
  pk('span_of_control', 'Span of Control', 'business', 'Managers manage managers.', { 'crew.capacityBonus': 4, 'automation.errorReduction': 0.2 }, { requiresSkill: { skillId: 'leadership', level: 6 } }),
  pk('cost_cutter', 'Cost Cutter', 'business', 'Nothing is spent twice.', { 'crew.salaryReduction': 0.12, 'property.opexReduction': 0.15 }, { requiresSkill: { skillId: 'business_management', level: 7 } }),
  pk('brand_builder', 'Brand Builder', 'business', 'Customers come back and pay more.', { 'business.revenueBonus': 0.18, 'marketing.effectiveness': 0.3 }, { requiresSkill: { skillId: 'marketing', level: 5 } }),

  /* combat */
  pk('steady_hand', 'Steady Hand', 'combat', 'You hit what you aim at.', { 'combat.accuracyBonus': 0.1, 'combat.critBonus': 0.03 }, { requiresSkill: { skillId: 'firearms', level: 4 } }),
  pk('body_armor_habit', 'Armoured Habit', 'combat', 'You never go out unprotected.', { 'combat.hpBonus': 25, 'combat.defenseBonus': 0.08 }),
  pk('tactician', 'Tactician', 'combat', 'Your squad fights as one unit.', { 'combat.squadBonus': 0.15, 'combat.initiativeBonus': 2 }, { requiresSkill: { skillId: 'tactics', level: 5 } }),
  pk('runner', 'Runner', 'combat', 'Discretion is the better part of survival.', { 'combat.fleeBonus': 0.25, 'combat.arrestReduction': 0.2 }, { requiresSkill: { skillId: 'stealth', level: 3 } }),
  pk('feared', 'Feared', 'combat', 'Your name ends fights before they start.', { 'combat.intimidationBonus': 0.25, 'reputation.criminalGain': 1.2 }, { requiresSkill: { skillId: 'intimidation', level: 5 } }),

  /* criminal / underground */
  pk('clean_digital_footprint', 'Clean Digital Footprint', 'criminal', 'Nothing you do online is attributable.', { 'underground.heatReduction': 0.4, 'underground.traceReduction': 0.35 }, { requiresSkill: { skillId: 'hacking', level: 4 } }),
  pk('vendor_network', 'Vendor Network', 'criminal', 'Vendors give you their best price and their honest product.', { 'underground.vendorDiscount': 0.15, 'underground.scamReduction': 0.5 }, { requiresSkill: { skillId: 'streetwise', level: 5 } }),
  pk('plausible_deniability', 'Plausible Deniability', 'criminal', 'Nobody can connect you to anything.', { 'underground.heatReduction': 0.25, 'reputation.legalProtection': 0.2 }, { requiresSkill: { skillId: 'forgery', level: 5 } }),
  pk('untouchable', 'Untouchable', 'criminal', 'Cases against you quietly fall apart.', { 'enforcement.prosecutionReduction': 0.35, 'enforcement.fineReduction': 0.25 }, { requiresSkill: { skillId: 'law', level: 8 }, requiresPerk: 'plausible_deniability' }),

  /* diplomacy */
  pk('trusted_broker', 'Trusted Broker', 'diplomacy', 'Factions believe your word.', { 'reputation.gainMultiplier': 1.25, 'faction.standingBonus': 1.3 }, { requiresSkill: { skillId: 'diplomacy', level: 4 } }),
  pk('neutral_party', 'Neutral Party', 'diplomacy', 'You trade with both sides of a war.', { 'faction.warProtection': 0.3, 'trade.spreadReduction': 0.08 }, { requiresSkill: { skillId: 'diplomacy', level: 7 } }),

  /* progression / meta */
  pk('quick_learner', 'Quick Learner', 'business', 'Experience accumulates faster.', { 'xp.multiplier': 1.25 }),
  pk('iron_stomach', 'Iron Stomach', 'combat', 'You recover from anything.', { 'combat.injuryReduction': 0.4, 'health.regeneration': 0.5 }),
  pk('night_owl', 'Night Owl', 'business', 'You get more done in a single day than most do in two.', { 'action.pointsBonus': 2 }),
];

export const PERK_BY_ID: Record<string, PerkDef> = Object.fromEntries(PERKS.map((p) => [p.id, p]));

/** Every modifier key any perk may grant — the engine implements these. */
export const MODIFIER_KEYS: string[] = Array.from(
  new Set(PERKS.flatMap((p) => Object.keys(p.modifiers))),
).sort();

/* ------------------------------------------------------------------ */
/* Employee roles                                                      */
/* ------------------------------------------------------------------ */

function role(
  id: string, name: string, category: EmployeeRoleDef['category'], baseSalary: number,
  primarySkill: string, secondarySkills: string[], automationCapability: EmployeeRoleDef['automationCapability'],
  description: string,
): EmployeeRoleDef {
  return { id, name, category, baseSalary, primarySkill, secondarySkills, automationCapability, description };
}

export const EMPLOYEE_ROLES: EmployeeRoleDef[] = [
  role('security', 'Security Officer', 'security', 78, 'combat', ['intimidation', 'stealth'], 'combat', 'Guards property, escorts shipments and fights when it comes to that.'),
  role('mercenary', 'Mercenary', 'security', 145, 'firearms', ['tactics', 'survival'], 'combat', 'Expensive, effective and loyal only to the payroll.'),
  role('driver', 'Driver', 'operations', 58, 'driving', ['smuggling', 'streetwise'], 'auto_logistics', 'Moves cargo. A good driver is worth more than a fast vehicle.'),
  role('pilot', 'Pilot', 'operations', 210, 'piloting', ['seamanship', 'technology'], 'auto_logistics', 'Air freight and fast extraction. Licensing makes them hard to replace.'),
  role('trader', 'Trader', 'commerce', 96, 'trading', ['market_analysis', 'negotiation'], 'auto_trade', 'Executes arbitrage within rules you set. Makes mistakes when the rules are bad.'),
  role('broker', 'Broker', 'finance', 132, 'finance', ['negotiation', 'market_analysis'], 'auto_finance', 'Gets better fills and access to markets you could not reach alone.'),
  role('warehouse_worker', 'Warehouse Worker', 'operations', 44, 'storage_management', ['logistics'], 'none', 'Moves, stacks and counts. Throughput depends on how many you have.'),
  role('logistics_manager', 'Logistics Manager', 'operations', 118, 'logistics', ['storage_management', 'leadership'], 'auto_logistics', 'Runs shipments and routing without your involvement.'),
  role('business_manager', 'Business Manager', 'operations', 104, 'business_management', ['leadership', 'marketing'], 'auto_business', 'Operates a business daily, hiring and pricing within your policy.'),
  role('accountant', 'Accountant', 'finance', 122, 'accounting', ['law', 'finance'], 'auto_finance', 'Reduces tax leakage and keeps audits from becoming investigations.'),
  role('lawyer', 'Lawyer', 'finance', 190, 'law', ['negotiation', 'diplomacy'], 'none', 'Reduces fines, shortens sentences and negotiates with authorities.'),
  role('financial_specialist', 'Financial Specialist', 'finance', 165, 'finance', ['accounting', 'market_analysis'], 'auto_finance', 'Structures debt, investments and offshore flows.'),
  role('intelligence_specialist', 'Intelligence', 'technical', 158, 'market_analysis', ['streetwise', 'hacking'], 'intel', 'Produces market and faction intelligence before it is public.'),
  role('technical_specialist', 'Technical Specialist', 'technical', 142, 'engineering', ['technology', 'production'], 'auto_production', 'Keeps plant and vehicles running.'),
  role('researcher', 'Researcher', 'technical', 126, 'technology', ['chemistry', 'market_analysis'], 'intel', 'Generates data assets and improves recipes.'),
  role('production_worker', 'Production Worker', 'production', 52, 'production', ['engineering'], 'auto_production', 'Direct labour on a production line.'),
  role('sales_staff', 'Sales Staff', 'commerce', 48, 'negotiation', ['marketing', 'appraisal'], 'auto_business', 'Converts stock into revenue in retail businesses.'),
  role('marketing_staff', 'Marketing Staff', 'commerce', 66, 'marketing', ['negotiation'], 'auto_business', 'Builds clientele and demand for your businesses.'),
  role('fixer', 'Fixer', 'diplomacy', 138, 'streetwise', ['bribery', 'negotiation'], 'laundering', 'Solves problems that are not legal problems and are not quite criminal ones. Runs clean-up of dirty money without an accountant asking questions.'),
  role('negotiator', 'Negotiator', 'diplomacy', 112, 'negotiation', ['diplomacy', 'intimidation'], 'none', 'Talks down encounters and improves contract terms.'),
  role('faction_contact', 'Faction Contact', 'diplomacy', 96, 'diplomacy', ['streetwise', 'negotiation'], 'intel', 'Maintains standing with a faction and surfaces their offers.'),
  role('contractor', 'Contractor', 'operations', 70, 'logistics', ['driving', 'production'], 'auto_logistics', 'Flexible labour for surges. No loyalty, no notice period.'),
  role('hacker', 'Hacker', 'technical', 186, 'hacking', ['technology', 'stealth'], 'intel', 'Runs intrusions, extracts data and keeps your digital footprint clean.'),
  role('chemist', 'Chemist', 'technical', 174, 'chemistry', ['production', 'medicine'], 'auto_production', 'Unlocks and optimises chemical and pharmaceutical recipes.'),
];

export const ROLE_BY_ID: Record<string, EmployeeRoleDef> = Object.fromEntries(EMPLOYEE_ROLES.map((r) => [r.id, r]));

/* ------------------------------------------------------------------ */
/* Enemies                                                             */
/* ------------------------------------------------------------------ */

function enemy(e: EnemyDef): EnemyDef {
  return e;
}

export const ENEMIES: EnemyDef[] = [
  enemy({ id: 'police_officer', name: 'Police Officer', archetype: 'police', hp: 70, actionPoints: 2, accuracy: 0.55, damage: [8, 16], defense: 0.18, speed: 5, negotiable: 0.72, tier: 'normal', lootTable: [{ cash: [40, 220], xp: 26 }], description: 'Routine patrol. Usually more interested in your paperwork than your cargo.' }),
  enemy({ id: 'police_sergeant', name: 'Police Sergeant', archetype: 'police', hp: 88, actionPoints: 2, accuracy: 0.6, damage: [10, 20], defense: 0.22, speed: 5, negotiable: 0.5, tier: 'normal', lootTable: [{ cash: [80, 400], xp: 34 }], description: 'Experienced, less bribable, and reads manifests properly.' }),
  enemy({ id: 'detective', name: 'Financial Investigator', archetype: 'inspector', hp: 62, actionPoints: 3, accuracy: 0.4, damage: [4, 10], defense: 0.1, speed: 4, negotiable: 0.35, tier: 'normal', lootTable: [{ cash: [0, 120], xp: 48 }], description: 'Does not shoot. Subpoenas your accounts instead, which is worse.' }),
  enemy({ id: 'customs_inspector', name: 'Customs Inspector', archetype: 'inspector', hp: 60, actionPoints: 2, accuracy: 0.35, damage: [4, 9], defense: 0.1, speed: 4, negotiable: 0.68, tier: 'normal', lootTable: [{ cash: [0, 300], xp: 30 }], description: 'Can seize an entire shipment with a signature.' }),
  enemy({ id: 'border_guard', name: 'Border Guard', archetype: 'police', hp: 74, actionPoints: 2, accuracy: 0.52, damage: [9, 17], defense: 0.2, speed: 5, negotiable: 0.6, tier: 'normal', lootTable: [{ cash: [60, 320], xp: 32 }], description: 'Checkpoint staffing. Detection dogs are the real threat.' }),
  enemy({ id: 'swat_team', name: 'Tactical Unit', archetype: 'swat', hp: 130, actionPoints: 3, accuracy: 0.74, damage: [16, 30], defense: 0.42, speed: 7, negotiable: 0.08, tier: 'elite', lootTable: [{ cash: [200, 900], xp: 96 }], description: 'Armoured, coordinated and uninterested in conversation.' }),
  enemy({ id: 'prison_guard', name: 'Prison Guard', archetype: 'police', hp: 80, actionPoints: 2, accuracy: 0.48, damage: [7, 15], defense: 0.24, speed: 4, negotiable: 0.42, tier: 'normal', lootTable: [{ cash: [30, 200], xp: 28 }], description: 'Between you and an early release.' }),
  enemy({ id: 'security_guard', name: 'Security Guard', archetype: 'security_guard', hp: 66, actionPoints: 2, accuracy: 0.46, damage: [7, 14], defense: 0.2, speed: 4, negotiable: 0.62, tier: 'normal', lootTable: [{ cash: [50, 300], xp: 24 }], description: 'Employed to observe and report, occasionally to intervene.' }),
  enemy({ id: 'rival_thug', name: 'Rival Thug', archetype: 'rival_thug', hp: 72, actionPoints: 2, accuracy: 0.5, damage: [9, 18], defense: 0.14, speed: 5, negotiable: 0.3, tier: 'normal', lootTable: [{ cash: [120, 700], xp: 38 }, { commodityId: 'pistols__assembled' }], description: 'Territorial muscle. Comes in numbers.' }),
  enemy({ id: 'rival_enforcer', name: 'Rival Enforcer', archetype: 'rival_elite', hp: 110, actionPoints: 3, accuracy: 0.64, damage: [14, 26], defense: 0.3, speed: 6, negotiable: 0.16, tier: 'elite', lootTable: [{ cash: [500, 2400], xp: 84 }, { commodityId: 'rifles__assembled' }], description: 'A professional. Sent when a message needs to be unambiguous.' }),
  enemy({ id: 'cartel_sicario', name: 'Cartel Sicario', archetype: 'rival_elite', hp: 122, actionPoints: 3, accuracy: 0.7, damage: [16, 30], defense: 0.32, speed: 7, negotiable: 0.06, tier: 'elite', lootTable: [{ cash: [900, 4200], xp: 104 }, { commodityId: 'assault_rifles__military_spec' }], description: 'Well-armed, well-paid and under orders not to negotiate.' }),
  enemy({ id: 'mercenary', name: 'Mercenary', archetype: 'mercenary', hp: 118, actionPoints: 3, accuracy: 0.72, damage: [15, 28], defense: 0.36, speed: 6, negotiable: 0.34, tier: 'elite', lootTable: [{ cash: [700, 3200], xp: 92 }, { commodityId: 'body_armor__military_spec' }], description: 'Works for whoever pays. Can sometimes be paid more, mid-fight.' }),
  enemy({ id: 'faction_boss', name: 'Faction Boss', archetype: 'faction_boss', hp: 190, actionPoints: 4, accuracy: 0.76, damage: [20, 38], defense: 0.44, speed: 6, negotiable: 0.28, tier: 'boss', lootTable: [{ cash: [4000, 18000], xp: 260 }, { commodityId: 'encrypted_ledger__encrypted' }], description: 'Runs an organisation. Killing them changes the balance of power in a city.' }),
  enemy({ id: 'warlord', name: 'Highland Warlord', archetype: 'faction_boss', hp: 220, actionPoints: 4, accuracy: 0.7, damage: [22, 42], defense: 0.4, speed: 5, negotiable: 0.22, tier: 'boss', lootTable: [{ cash: [6000, 26000], xp: 320 }, { commodityId: 'military_surplus__salvaged' }], description: 'Commands several hundred fighters and one mountain road.' }),
  enemy({ id: 'vigilante', name: 'Vigilante', archetype: 'vigilante', hp: 68, actionPoints: 2, accuracy: 0.5, damage: [10, 18], defense: 0.16, speed: 6, negotiable: 0.12, tier: 'normal', lootTable: [{ cash: [40, 300], xp: 30 }], description: 'Neighbourhood defence with no rules of engagement.' }),
  enemy({ id: 'pirate_crew', name: 'Pirate Crew', archetype: 'rival_thug', hp: 96, actionPoints: 3, accuracy: 0.58, damage: [12, 24], defense: 0.2, speed: 7, negotiable: 0.24, tier: 'elite', lootTable: [{ cash: [1200, 8000], xp: 110 }], description: 'Boards vessels in contested waters. They keep whatever they take.' }),
  enemy({ id: 'cyber_daemon', name: 'Intrusion Countermeasure', archetype: 'cyber_daemon', hp: 140, actionPoints: 3, accuracy: 0.66, damage: [10, 22], defense: 0.5, speed: 9, negotiable: 0, tier: 'elite', lootTable: [{ cash: [0, 500], xp: 120 }, { commodityId: 'zero_day_exploit__encrypted' }], description: 'Automated defence during an intrusion. "Damage" here is to your traces and your hardware.' }),
  enemy({ id: 'repo_agent', name: 'Repossession Agent', archetype: 'security_guard', hp: 84, actionPoints: 2, accuracy: 0.5, damage: [8, 16], defense: 0.22, speed: 5, negotiable: 0.4, tier: 'normal', lootTable: [{ cash: [100, 600], xp: 34 }], description: 'Arrives when a loan goes bad. Takes the collateral, not your life — usually.' }),
  enemy({ id: 'rival_trader_crew', name: 'Rival Trader Crew', archetype: 'rival_thug', hp: 78, actionPoints: 2, accuracy: 0.52, damage: [9, 17], defense: 0.18, speed: 5, negotiable: 0.44, tier: 'normal', lootTable: [{ cash: [300, 1800], xp: 44 }], description: 'Competitors who decided your route was theirs.' }),
  enemy({ id: 'militia_fighter', name: 'Militia Fighter', archetype: 'mercenary', hp: 86, actionPoints: 2, accuracy: 0.54, damage: [11, 21], defense: 0.2, speed: 5, negotiable: 0.18, tier: 'normal', lootTable: [{ cash: [150, 900], xp: 46 }, { commodityId: 'ammunition__civilian' }], description: 'Poorly equipped, numerous, and fighting for something they believe in.' }),
];

export const ENEMY_BY_ID: Record<string, EnemyDef> = Object.fromEntries(ENEMIES.map((e) => [e.id, e]));

/** Encounter tables keyed by situation — the event/combat engine draws from these. */
export const ENCOUNTER_TABLES: Record<string, string[]> = {
  police_stop: ['police_officer', 'police_officer', 'police_sergeant', 'border_guard'],
  customs: ['customs_inspector', 'border_guard', 'police_officer'],
  investigation: ['detective', 'detective', 'police_sergeant'],
  raid: ['swat_team', 'swat_team', 'police_sergeant', 'police_officer'],
  rival_territory: ['rival_thug', 'rival_thug', 'rival_enforcer', 'rival_trader_crew'],
  cartel: ['cartel_sicario', 'cartel_sicario', 'rival_enforcer'],
  warzone: ['militia_fighter', 'militia_fighter', 'warlord', 'mercenary'],
  piracy: ['pirate_crew', 'pirate_crew', 'rival_thug'],
  boss: ['faction_boss', 'warlord'],
  cyber: ['cyber_daemon'],
  debt_collection: ['repo_agent', 'rival_thug', 'rival_enforcer'],
  vigilante: ['vigilante', 'vigilante', 'security_guard'],
};

/* ------------------------------------------------------------------ */
/* Name banks (deterministic personnel generation)                     */
/* ------------------------------------------------------------------ */

export const FIRST_NAMES = [
  'Amara', 'Dmitri', 'Yusuf', 'Elena', 'Kwame', 'Mei', 'Tomas', 'Ingrid', 'Rafael', 'Anya',
  'Jonas', 'Priya', 'Malik', 'Sofia', 'Hiro', 'Nadia', 'Emeka', 'Lucia', 'Viktor', 'Zainab',
  'Anders', 'Camila', 'Omar', 'Freya', 'Diego', 'Aisha', 'Nikolai', 'Yara', 'Samuel', 'Leila',
  'Marcus', 'Tereza', 'Idris', 'Hana', 'Paolo', 'Nour', 'Erik', 'Bianca', 'Kaito', 'Amira',
  'Silas', 'Vera', 'Hassan', 'Greta', 'Luca', 'Thandi', 'Ravi', 'Mira', 'Oskar', 'Delphine',
  'Cassius', 'Noor', 'Bakari', 'Iris', 'Mateo', 'Sunita', 'Lev', 'Rosa', 'Kenji', 'Fatima',
  'Andrei', 'Chiara', 'Kofi', 'Ilse', 'Rashid', 'Bea', 'Nils', 'Imani', 'Dario', 'Aoife',
] as const;

export const LAST_NAMES = [
  'Okafor', 'Vasquez', 'Lindqvist', 'Moreau', 'Nakamura', 'Duarte', 'Kovač', 'Bello', 'Haddad', 'Novak',
  'Adeyemi', 'Rossi', 'Bergström', 'Castillo', 'Osei', 'Ferreira', 'Ivanov', 'Mensah', 'Sato', 'Diallo',
  'Marchetti', 'Eriksen', 'Okonkwo', 'Petrova', 'Almeida', 'Haddadi', 'Jansen', 'Silva', 'Kowalski', 'Traoré',
  'Bianchi', 'Larsen', 'Mbeki', 'Costa', 'Reyes', 'Novikov', 'Farrow', 'Suleiman', 'Vogel', 'Achebe',
  'Delgado', 'Halvorsen', 'Nasser', 'Ricci', 'Mokoena', 'Baptiste', 'Kuznetsov', 'Oyelaran', 'Tanaka', 'Duval',
  'Achterberg', 'Zamani', 'Oduya', 'Piranesi', 'Salgado', 'Njoku', 'Weiss', 'Baptista', 'Karanja', 'Rinaldi',
] as const;

/** Handle components for underground digital identities. */
export const HANDLES_A = ['null', 'ghost', 'zero', 'static', 'cipher', 'vector', 'hex', 'onyx', 'pale', 'iron', 'quiet', 'dark', 'signal', 'rust', 'vapor'] as const;
export const HANDLES_B = ['wave', 'market', 'index', 'runner', 'ledger', 'fox', 'crow', 'hand', 'wire', 'port', 'vault', 'eye', 'coin', 'gate', 'trace'] as const;

export const BUSINESS_OBJECTIVES = [
  'Wants a share of the action, not a salary.',
  'Saving to leave the country entirely.',
  'Owes money to people you have not met.',
  'Believes loyalty is earned, never assumed.',
  'Wants to run their own operation one day.',
  'Has family in another city and transfers most of their pay.',
  'Is quietly building a case against someone.',
  'Wants training, and will leave if they do not get it.',
  'Enjoys the work more than the money, for now.',
  'Is being watched by a previous employer.',
] as const;
