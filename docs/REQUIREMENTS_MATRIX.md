# Requirements Matrix — Arena AI Master Build Specification

- Source: `docs/MASTER_GAME_SPEC.md` (imported from `MASTER_GAME_SPEC.md`, remote commit `68db6fa`, SHA-256 `a5e78a1b…ccd7c7`, verified 2026-10-12)
- Branch: `arena/75a7979e-dynastyv1-0`. Starting HEAD `fb4083d5095e227070683caf3f3f3ab4d0342d4d`; fast-forwarded to remote `68db6fa` on 2026-10-12, with prior local state preserved in a stash (see `PROJECT_STATUS.md` section 1)
- Audit date: 2026-10-12 (UTC)
- Scope: every requirement in the spec's preamble and sections 1–52. Statuses are based on code and test evidence in this repository and on gate runs recorded in `PROJECT_STATUS.md`. Nothing here was implemented during this audit.

## Status legend

| Status | Meaning |
| --- | --- |
| IMPL | Implemented, and at least one direct behavioural test or gate run covers it. |
| IMPL-THIN | Implemented in code (module, function, data, or route present), but evidence is limited to indirect tests, registry-level tests, or no dedicated test. |
| PARTIAL | Some of the requirement is implemented; a named part is missing, unverified, or only qualitative. |
| MISSING | Not implemented, and no code path was found for it. |
| DEFERRED | The spec says not to build it now (§28 multiplayer). |
| PROCESS | A directive about how the work is done, not a product feature. Assessed as process compliance. |

Evidence paths are relative to the repository root. "Tests" refers to titles in `tests/*.ts(x)`. Counts were taken from `npm run typecheck`, `npm run lint`, `npx vitest run` (full), `npm run build`, and registry counts in `/tmp/specaudit/counts.json`. Gates were re-run after the 2026-10-12 reconciliation, and the PostgreSQL identity suite was run against a disposable local database; exit codes are in `PROJECT_STATUS.md` section 2.

## Matrix

| ID | Spec § | Requirement | Status | Evidence | Gap / note |
| --- | --- | --- | --- | --- | --- |
| S00-01 | Preamble | Execution directive: single-pass autonomous build of the complete game | PROCESS | Directive text in spec | This audit is planning only, as instructed. The directive was not executed. |
| S01-01 | 1 | Text-based economic strategy simulation: trading, markets, persistent empire | IMPL | `src/sim/` (markets, economy, world, tick); `tests/integration.test.ts`; `tests/simulation.test.ts` | |
| S01-02 | 1 | Breadth of named domains: finance, stocks, crypto, underground, logistics, property, production, crew, automation, factions, combat, events, information markets, progression | IMPL-THIN | One module per domain in `src/sim/`; rows S09–S22 | Stocks, crypto, combat, and logistics have thin behavioural tests. |
| S01-03 | 1 | Strategically understandable; randomness creates uncertainty without making strategy meaningless | PARTIAL | Seeded RNG (`src/engine/rng.ts`); factor breakdowns in `src/sim/finance.ts`; `tests/registry.test.ts` | No playtest or balance evidence in the repo. Qualitative. |
| S02-01 | 2 | Stack: React, TypeScript, Node/TypeScript backend, PostgreSQL, Supabase, Tailwind, responsive web | IMPL | `package.json` (next, react, pg, @supabase/ssr, tailwindcss ^4.3.3, zod); `tsconfig.json` `"strict": true`; `npm run build` exit 0 | |
| S02-02 | 2 | Targets: desktop, mobile, tablet, responsive browser | PARTIAL | Mobile nav branch in `src/components/game/shell.tsx` | Known 390px horizontal overflow on the game page (`scrollWidth` 622, earlier browser run). Open defect. |
| S02-03 | 2 | PWA / installable application target | PARTIAL | `public/manifest.webmanifest`; `public/sw.js`; `src/app/providers.tsx:30-31` | See S25 rows. |
| S02-04 | 2 | Architecture prepared for cloud saves, persistent accounts, future multiplayer, and expansion | IMPL-THIN | `src/persistence/` (SQLite and Postgres stores); guest and Supabase auth providers; registries in `src/engine/registry/` | Multiplayer is correctly not built (see S28). |
| S03-01 | 3 | Modular architecture with separated domains (economy … analytics) | PARTIAL | Per-domain modules in `src/sim/*.ts`; `src/server/auth/`; `src/persistence/` | No dedicated `analytics` or `notifications` domain module. Notifications live in `state.ts` and `news`. |
| S03-02 | 3 | Clear domain boundaries and service interfaces | IMPL-THIN | `src/server/services/` (game-service, auth-service, rate-limit); `src/sim/actions.ts` dispatcher | |
| S03-03 | 3 | New commodities, locations, businesses, events, skills, factions, and mechanics addable without rewriting unrelated systems | IMPL-THIN | Registry-driven content in `src/engine/registry/`; `tests/registry.test.ts` "has no duplicate ids within any registry" | No test adds new content and checks that unrelated systems are untouched. |
| S04-01 | 4 | Persistent time-based simulation: days and turns/actions | IMPL | `src/sim/tick.ts` `advanceDay` / `advanceDays`; `src/app/api/games/[gameId]/advance/route.ts` | |
| S04-02 | 4 | Time-consuming activities and travel time | IMPL-THIN | `src/sim/travel.ts` `executeTravel`, `resumeTravel`, `travelSpeedKmPerDay`; `tests/phase0.test.ts` "travel/shipment planning contract" | Travel is covered at contract level only. |
| S04-03 | 4 | Time advancement drives business operations, production, employees, investments, interest, market evolution, events, logistics, passive income, competitor activity | IMPL | `advanceDay` calls `businessTick`, `productionTick`, `crewTick`, `accountsTick`, `loanTick`, `stepMarkets`, `eventTick`, `logisticsTick`, `propertyTick`, `stepCompanies`, `stepCrypto`, `tradeNetworkTick`, `automationTick`, `stepWorld` | Covered by integration tests, not by a per-subsystem tick test. |
| S04-04 | 4 | Campaign-style finite progression and endless/sandbox gameplay | IMPL-THIN | `src/sim/bootstrap.ts` (mode default `'campaign'`, `endless` option); `src/sim/tick.ts` `evaluateVictoryConditions` | No test names the campaign or endless modes. |
| S04-05 | 4 | Configurable victory and loss conditions | IMPL-THIN | `src/sim/tick.ts` `evaluateVictoryConditions`, `evaluateLossConditions`; ending kinds (net_worth, empire_score, monopoly, level, days_survived, success) | Configurability is through difficulty and mode options. |
| S04-06 | 4 | Loss conditions: bankruptcy, severe financial failure, arrest or imprisonment, reputation collapse | IMPL-THIN | Ending kinds bankruptcy, imprisonment, reputation_collapse, death in `src/sim/` | |
| S04-07 | 4 | Negative consequences must not automatically end the game | PARTIAL | Arrest leads to a prison state (`src/sim/combat.ts` `applyArrest`, `prisonTick`) | No test asserts that a negative outcome leaves the game running. |
| S05-01 | 5 | Supply, demand, local and regional markets | IMPL | `src/sim/economy.ts` `computeFundamental`, `baseSupplyUnits`, `baseDemandUnits`; `src/sim/markets.ts` `marketKey` per location; `tests/integration.test.ts` "trade moves the local market, and the move survives a save" | |
| S05-02 | 5 | Price volatility, inflation, and deflation | PARTIAL | `src/sim/world.ts` `inflationIndex`, `inflationRate`; `inflation_surge` event | No explicit deflation state or event found. No direct inflation test. |
| S05-03 | 5 | Economic cycles, booms, recessions, crashes | IMPL-THIN | `src/sim/world.ts` `cycleFactorFor`, `cyclePhaseLabel`; events `economic_boom`, `recession_onset`, `market_crash` | No test names a cycle phase. |
| S05-04 | 5 | Shortages, surpluses, and dynamic scarcity | IMPL-THIN | Events `metal_shortage`, `container_shortage`, `medical_shortage`, `bumper_harvest`, `oil_glut`; supply units in `economy.ts` | |
| S05-05 | 5 | Market shocks | IMPL | `src/sim/world.ts` `createRandomShock`, `addShock`; `tests/integration.test.ts` "creates shocks that move markets in the scopes it names", "lets the impact decay instead of printing free money forever" | |
| S05-06 | 5 | Player transactions influence markets | IMPL | `src/sim/markets.ts` `executeBuy`, `executeSell`; `src/sim/economy.ts` `tradeImpact`; integration "trade moves the local market" | |
| S05-07 | 5 | NPC and world activity influence markets | PARTIAL | `src/sim/trade-network.ts` NPC trade agents (capital, cargo, freight, halt on loss); `markets.ts` `recordRivalTrade`; `tests/trade-network.test.ts` (25 tests) | NPC agents do not produce goods or borrow money. This is the Phase 4 gap. |
| S05-08 | 5 | Faction activity influences markets | IMPL | `src/sim/economy.ts` `factionMarketPressure`; integration "prices war into the markets" | |
| S05-09 | 5 | Each meaningful market has its own state | IMPL | `src/sim/markets.ts` `ensureMarket`, `marketAt`, keyed by location and commodity | |
| S05-10 | 5 | Geographic specialisation | IMPL-THIN | `src/engine/registry/regions.ts` (`ARCHETYPE_DEMAND`); `LocationDef` economy and `demandProfile` | |
| S05-11 | 5 | Arbitrage | IMPL | `src/sim/economy.ts` `scanArbitrage`, `achievableMargin`; `src/sim/markets.ts` `playerArbitrage`; `tests/trade-discovery.test.ts` (19 tests) | |
| S05-12 | 5 | Economic formulas configurable centrally, with no scattered magic constants | PARTIAL | `src/config/balance.ts` (22 sections, including economy, market, finance, travel, combat, crew, events) | Inline literals remain: `src/sim/finance.ts:387` (`0.02` floor), `:488` (`* 0.4`), `:561` (`+ 0.06`). |
| S06-01 | 6 | Balance randomness and predictability; avoid pure randomness, deterministic prices, guaranteed arbitrage, and an obvious optimal strategy | PARTIAL | Seeded RNG; `tests/registry.test.ts` "never produces negative, zero or non-finite prices" | No test asserts that arbitrage is not guaranteed or that a strategy is not obvious. |
| S06-02 | 6 | Expose current price, history, trend, supply, demand, volatility, sentiment, regional conditions, and events | PARTIAL | `src/sim/markets.ts` `marketDetail`; history arrays in `src/sim/types.ts` (lines ~538, 661, 682); sentiment in stocks and crypto; news page | The market page has no price-history chart. Charts exist on stocks, crypto, finance, world, and news pages. |
| S07-01 | 7 | 500+ initial commodities | IMPL | Registry count 765 (`/tmp/specaudit/counts.json`); `tests/registry.test.ts` | |
| S07-02 | 7 | Architecture capable of procedural expansion beyond the initial set | IMPL-THIN | Composition from base commodities and forms: `BASE_COMMODITIES_A/B/C`, `FORMS` (`src/engine/registry/basesA.ts`, `basesB.ts`, `forms.ts`) | Expansion beyond the seed set is not exercised by a test. |
| S07-03 | 7 | Commodity categories: legal, illegal, contraband, luxury, raw, manufactured, pharmaceuticals, technology, weapons, financial assets, crypto, information/data, event-specific | IMPL-THIN | 25 categories in the registry; legality levels in `forms.ts` (`legalitySeverity`) | Each category was not individually verified in this audit. |
| S07-04 | 7 | Per-commodity attributes: base value, weight, volume, rarity, legality, risk, volatility, shelf life, storage, availability, demand, regional preference, unlock, market types | IMPL-THIN | `src/sim/types.ts` `CommodityDef` (baseValue, weightKg, volumeL, rarity, legality, risk, volatility, shelfLifeDays, storage, availability, baseDemand, elasticity, marketTypes, regionalPreference, unlock) | |
| S07-05 | 7 | Event modifiers as commodity attributes | PARTIAL | Events act by scope and category (`src/engine/registry/events.ts`) | Event modifiers are not per-commodity fields. |
| S07-06 | 7 | Data-driven commodity registry; no per-commodity hard-coding | IMPL | `src/engine/registry/commodities.ts`; generic market logic in `src/sim/economy.ts` | |
| S08-01 | 8 | Expandable node-based world graph | IMPL | `LocationDef`, `RouteDef` in `src/sim/types.ts`; `src/engine/registry/world.ts` (48 locations, 135 routes); path types `PathLeg`, `PathResult` | |
| S08-02 | 8 | Location kinds: cities, ports, airports, trading hubs, industrial, financial centres, rural, border, hidden markets, underground, offshore, special | IMPL | `LocationKind` in `src/sim/types.ts` (city, port, airport, trading_hub, industrial, financial_center, rural, border, hidden_market, underground, offshore, special) | |
| S08-03 | 8 | Locations differ in economy, laws, taxes, factions, security, risk, demand profile, financial services, infrastructure, events, politics | IMPL-THIN | `LocationDef`: economy indices, laws, security, risk, demandProfile, financialServices, infrastructure, factionIds | Per-location tax rates were not verified. |
| S08-04 | 8 | Travel accounts for distance, time, cost, mode, risk, route conditions, fuel and maintenance, borders, customs, enforcement, events, disruptions | IMPL-THIN | `src/sim/travel.ts` `planTravel`, `MODE_LABELS`, `refuelVehicle`, `repairVehicle`, `detectionChance`; `RouteDef` (distanceKm, modes, borderCrossing, baseRisk, customsIntensity) | Travel behaviour is tested at contract level only. |
| S08-05 | 8 | Discoverable and hidden locations | IMPL | `LocationDef.hidden` and `discoveryRequirement`; `tests/trade-discovery.test.ts` (19 tests) | |
| S08-06 | 8 | Dynamic routes | IMPL-THIN | `RouteDef` base risk; disruption state `disrupted`, `disruptedUntilDay`, `disruptionReason`; integration "derives route risk from the war map" | |
| S08-07 | 8 | Border closures | IMPL-THIN | Event `border_closure`; event `war_outbreak`; `borderCrossing` on routes | No test names a border closure. |
| S08-08 | 8 | Lockdowns | IMPL-THIN | Location fields `lockdown`, `lockdownUntilDay` (`src/sim/types.ts`); event `crackdown` | |
| S08-09 | 8 | Sanctions | IMPL-THIN | Sanctions state in `src/sim/types.ts`; event `sanctions_package` | |
| S08-10 | 8 | Wars | IMPL | Event `faction_war`; `src/sim/factions.ts` `provokeWar`; integration "faction conflict reaches routes, markets and patrols", "faction conflict re-routes rival cargo" | |
| S08-11 | 8 | Travel events | IMPL-THIN | Events scoped to routes and locations (`customs_inspection_sweep`, `hijacking`, `port_congestion`) | |
| S08-12 | 8 | New locations addable without rewriting travel or economy | IMPL-THIN | `src/engine/registry/world.ts` data-driven | |
| S09-01 | 9 | Traditional banking: accounts, deposit interest, wire fees, daily limits, freezes | IMPL-THIN | `src/sim/finance.ts` `openAccount`, `closeAccount`, `accountsTick`, `financeView`; fee and limit logic | Few direct tests. |
| S09-02 | 9 | Loans in six kinds: bank, loan shark, mortgage, margin, business, faction | IMPL | `src/sim/finance.ts` `takeLoan`, `repayLoan`, `loanTick`; integration "accrues interest, goes delinquent when unpaid, and marks the credit file" | |
| S09-03 | 9 | Loan sharks and criminal lenders | IMPL-THIN | `loan_shark` kind; APR spread config `B.finance.loanShark` (`finance.ts:488`) | Only the loan-shark kind exists; no separate criminal-lender product. |
| S09-04 | 9 | Credit limits, creditworthiness, and credit scores that gate and reprice bank lending | IMPL | `maxBankLoanFor`, `creditScoreView`, `adjustCreditScore`; finance page credit-score sparkline; integration credit-file test | |
| S09-05 | 9 | Variable interest rates | IMPL-THIN | APR = `state.world.interestRate` + spread with modifiers (`finance.ts:387`, `:488`, `:561`); events `central_bank_hike`, `central_bank_cut` | Rates follow the world rate, not a per-loan schedule. |
| S09-06 | 9 | Simple interest where appropriate | IMPL-THIN | Accrual kinds documented in `src/sim/finance.ts` header | |
| S09-07 | 9 | Compound interest | IMPL-THIN | `compoundingPeriodDays` in `src/sim/types.ts`; `loanTick` in `finance.ts` | |
| S09-08 | 9 | Payment schedules | IMPL-THIN | `scheduledPayments` in `loanTick` result | |
| S09-09 | 9 | Collateral | IMPL-THIN | `CollateralRef`, `collateralCapacity`, `inventoryCollateralValue` in `finance.ts` | |
| S09-10 | 9 | Refinancing | MISSING | No refinance function, type, or term in `src/`. Grep count 0. | |
| S09-11 | 9 | Multiple concurrent loans | IMPL-THIN | `debtSummary`; multiple-active-loan logic in `finance.ts` | |
| S09-12 | 9 | Business financing | PARTIAL | Loan kind `business` exists | No business underwriting or financing flow beyond the loan kind. |
| S09-13 | 9 | Investor funding | MISSING | No investor-funding flow. Only an "investor mood" field in `stocks.ts`. | |
| S09-14 | 9 | Investments | IMPL-THIN | `src/sim/stocks.ts` `buyShares`, `sellShares`; `src/sim/crypto.ts` `buyCrypto`, `sellCrypto` | |
| S09-15 | 9 | Bonds | MISSING | No bond instrument in the registry. The only "bond" match is `bonded_warehouse` (`src/engine/registry/assets.ts`). | |
| S09-16 | 9 | Cryptocurrency as a financial instrument | IMPL-THIN | See S11 rows | |
| S09-17 | 9 | Passive income | IMPL-THIN | `businessTick` daily revenue; `rentYieldFor` in `properties.ts`; `storageRentTick` in logistics | |
| S09-18 | 9 | Offshore financial structures | IMPL-THIN | `offshore` account flag and `offshore_entity` property (`src/engine/registry/assets.ts`); `finance.ts` applies a tax reduction to offshore and shell accounts | |
| S09-19 | 9 | Transaction fees | IMPL-THIN | Wire fees and fee logic in `src/sim/finance.ts` | |
| S09-20 | 9 | Taxation | IMPL-THIN | `assessTaxes`, `taxTick`, `payTaxArrears`, `TAX_PERIOD_DAYS` in `finance.ts`; event `tax_audit` | |
| S09-21 | 9 | Financial investigations | IMPL-THIN | `startInvestigation`, `closeInvestigation` in `src/sim/reputation.ts`; accounts can be frozen during an investigation (`finance.ts`) | |
| S09-22 | 9 | Money laundering systems, laundering fees, laundering risk | IMPL-THIN | `launderingFronts`, `launder`, `launderingTick` in `finance.ts` | |
| S09-23 | 9 | Financial restrictions | IMPL-THIN | Account freezes and daily limits in `finance.ts` | |
| S09-24 | 9 | Escalating debt consequences: rising interest, collection, seizure, reputation damage, reduced access, criminal pressure, forced events, legal consequences, bankruptcy | IMPL-THIN | `loanTick` delinquency, defaults, and seizures; events `loan_collection`, `asset_seizure`; ending `bankruptcy` | The escalation ladder is tested only at the delinquency step. |
| S09-25 | 9 | Finance reacts to inflation, interest rates, reputation, global conditions, market conditions, and political events | PARTIAL | Interest rate and reputation feed finance (credit-score factors); events | Inflation's direct effect on loans was not traced. |
| S10-01 | 10 | Multiple companies and sectors | IMPL-THIN | 44 companies in the registry; `stocks.ts` `initCompanies` | |
| S10-02 | 10 | Share prices and market trends | IMPL-THIN | `stocks.ts` `stepCompanies`, `indexLevel`, `quoteShares`; api test "keeps the stock board whole by default and paginates it on request" | |
| S10-03 | 10 | Dividends | IMPL-THIN | Dividend logic in `stocks.ts` | |
| S10-04 | 10 | Corporate performance | IMPL-THIN | Events `earnings_beat`, `earnings_miss`, `corporate_scandal` | |
| S10-05 | 10 | Market sentiment | IMPL-THIN | Sentiment in `stocks.ts` | |
| S10-06 | 10 | Speculation | PARTIAL | No explicit speculation mechanic | Price moves come from sentiment only. |
| S10-07 | 10 | Crashes and bubbles | IMPL-THIN | Crash and bubble logic in `stocks.ts`; events `asset_bubble`, `market_crash` | |
| S10-08 | 10 | Mergers and acquisitions | IMPL-THIN | Merger and acquisition logic in `stocks.ts`; event `merger_announced` | |
| S10-09 | 10 | Company failures | IMPL-THIN | Failure, insolvency, and delisting logic in `stocks.ts` | |
| S10-10 | 10 | World-event impacts, and prices linked to broader economic conditions | IMPL-THIN | Sector references and `indexLevel` in `stocks.ts`; events | Link to macro conditions not separately tested. |
| S11-01 | 11 | Multiple crypto assets with different volatility profiles | IMPL | 20 crypto assets in the registry; `tests/registry.test.ts` "has crypto assets with distinct mechanics rather than commodity clones" | |
| S11-02 | 11 | Exchanges | IMPL-THIN | `src/sim/crypto.ts` `listExchanges`, `openExchangeAccount`, `quoteCrypto` | |
| S11-03 | 11 | Market prices and trading | IMPL-THIN | `crypto.ts` `buyCrypto`, `sellCrypto`, `cryptoIndexLevel`, `anchorPrice`, `stepCrypto` | |
| S11-04 | 11 | Liquidity | IMPL-THIN | Liquidity model in `crypto.ts` | |
| S11-05 | 11 | Market sentiment | IMPL-THIN | Sentiment in `crypto.ts` | |
| S11-06 | 11 | Speculation | PARTIAL | No explicit speculation mechanic | |
| S11-07 | 11 | Crashes and bubbles | IMPL-THIN | Events `crypto_rally`, `crypto_winter`, `exchange_collapse`; `anchorPrice` mean reversion | |
| S11-08 | 11 | Technological and regulatory events | PARTIAL | Event `crypto_regulation`; event `halving`; generic `tech_breakthrough` | No crypto-specific technology event beyond halving. |
| S11-09 | 11 | Staking and mining-like mechanics | IMPL-THIN | `crypto.ts` `stake`, `unstake`, `buyMiningRig`, `miningTick`, `toggleRig`, `repairRig`, `blockReward` | |
| S11-10 | 11 | Integration with the wider economy | IMPL-THIN | Crypto uses the bank account and portfolio risk (`cryptoPortfolioRisk`); `crypto_regulation` event | |
| S11-11 | 11 | Crypto is not a reskinned commodity market | IMPL | `tests/registry.test.ts` "distinct mechanics rather than commodity clones"; separate module `src/sim/crypto.ts` | |
| S12-01 | 12 | Anonymous transactions | PARTIAL | Escrow, `burnHandle`, VPN tiers in `src/sim/underground.ts` | No explicit anonymity model. |
| S12-02 | 12 | Digital currencies | IMPL-THIN | `underground.ts` references crypto (2 matches) | |
| S12-03 | 12 | Information and data markets | IMPL-THIN | `underground.ts` `dataOffers`, `buyDataAsset`, `sellDataAsset`, `assetValue`; `buyLocationIntel` | |
| S12-04 | 12 | Digital identity and reputation | IMPL-THIN | `burnHandle`; `criminal` reputation dimension (`reputation.ts`); `addTraceHeat` | |
| S12-05 | 12 | Underground marketplaces | IMPL | `underground.ts` `discoverMarket`, `darknetListings`, `buyFromVenue`, `sellToVenue`, `depositEscrow`; integration "enforcement pressure shows up in the underground" | |
| S12-06 | 12 | Cybersecurity risk | IMPL-THIN | Trace heat and detection in `underground.ts`; event `cyber_attack` | |
| S12-07 | 12 | Hacking as game mechanics, not operational instructions | IMPL-THIN | `underground.ts` `hackTargets`, `hack` | Content was not reviewed line by line in this audit. Review needed. |
| S12-08 | 12 | Digital financial networks | PARTIAL | Escrow accounts | No network model. |
| S13-01 | 13 | Personal capacity, weight, and volume | IMPL | `tests/phase0.test.ts` "rejects a genuine capacity overflow and preserves invariants over save/load after trade"; `weightKg`, `volumeL` in `CommodityDef` | |
| S13-02 | 13 | Containers and equipment | PARTIAL | Container logic in logistics and the `container_shortage` event; equipment only for weapons (`equippedWeapon`) | Containers and equipment are not generalised. |
| S13-03 | 13 | Vehicles, vehicle upgrades, trucks and freighters | IMPL-THIN | `logistics.ts` `buyVehicle`, `sellVehicle`, `installVehicleUpgrade`, `vehicleListings`; vehicle registry (18 vehicles) | |
| S13-04 | 13 | Warehouses, safehouses, specialised and refrigerated storage | IMPL-THIN | `logistics.ts` `storageRentTick`, `getStorageUnit`; refrigerated storage referenced across the registry (17 files) | |
| S13-05 | 13 | Security for storage and premises | IMPL-THIN | `properties.ts` `raidProperty`; `tick.ts` `theftTick` | |
| S13-06 | 13 | Theft, seizure, and destruction | IMPL-THIN | `theftTick`, `spoilageTick` (`tick.ts`); events `warehouse_theft`, `asset_seizure` | |
| S13-07 | 13 | Insurance | IMPL-THIN | `logistics.ts` `insuredValueAt`; `properties.ts` `insureProperty`; event `insurance_claim` | |
| S13-08 | 13 | Contraband detection and hidden compartments | IMPL-THIN | `travel.ts` `detectionChance`, `contrabandExposure`, `concealCargo` | |
| S13-09 | 13 | Supply chains | IMPL-THIN | `production.ts` `supplyChainSummary`; integration "supply chains are reachable end to end" | |
| S13-10 | 13 | Shipment tracking and multiple simultaneous shipments | IMPL-THIN | `logistics.ts` `planShipment`, `sendShipment`, `shipmentViews`, `logisticsTick` | |
| S13-11 | 13 | Automated transportation and logistics managers | IMPL-THIN | `logisticsTick` in `src/sim/logistics.ts`; `logistics_manager` type (`src/sim/types.ts:1162`); automation rules in `automation.ts`; `auto_logistics` skill | Automated shipment behaviour is not tested directly. |
| S13-12 | 13 | Fuel, maintenance, and vehicle damage | IMPL-THIN | `travel.ts` `refuelVehicle`, `repairVehicle`, `vehicleSummary`; `logistics.ts` `serviceVehicle` | |
| S13-13 | 13 | Progression from small trader to large economic empire | PARTIAL | Capabilities exist across modules | No test or measurement of the progression path. |
| S13-14 | 13 | Inventory management as a strategic decision | PARTIAL | Capacity, weight, and volume constraints present | Qualitative. |
| S14-01 | 14 | Property types: safehouses, warehouses, offices, commercial, retail, factories, farms, distribution centres, transport hubs, financial facilities, entertainment, research, technology, underground, offshore, real-estate portfolios | IMPL-THIN | 38 asset kinds in `src/engine/registry/assets.ts`, covering property and vehicle kinds (for example safehouse, warehouse, office, retail, factory, farm, distribution_center, transport_hub, financial_facility, entertainment, research_facility, tech_facility, underground_facility, offshore_entity, residential) | Real-estate portfolios are represented by `storagePortfolio` and `propertyPortfolioSummary`. |
| S14-02 | 14 | Acquisition, construction, and upgrades | IMPL-THIN | `properties.ts` `buyProperty`, `upgradeProperty`; `businesses.ts` `openBusiness` (setup capex) | Construction as a distinct step was not verified. |
| S14-03 | 14 | Operating expenses, maintenance, security, staff, storage, production, income | IMPL-THIN | `properties.ts` `propertyTick`, `repairProperty`, `assignStaff`, `storagePortfolio`, `rentYieldFor` | |
| S14-04 | 14 | Dynamic valuation | IMPL-THIN | `properties.ts` `currentValuation`, `locationPremium`, `askingPrice` | |
| S14-05 | 14 | Damage, raids, and seizures | IMPL-THIN | `properties.ts` `repairProperty`, `raidProperty` | |
| S14-06 | 14 | Insurance on property | IMPL-THIN | `properties.ts` `insureProperty` | |
| S14-07 | 14 | Location advantages | IMPL-THIN | `properties.ts` `locationPremium` | |
| S15-01 | 15 | Interconnected chain: resources, processing, manufacturing, storage, distribution, retail, revenue | IMPL-THIN | 44 recipes in the registry; `production.ts` `recipeEconomics`, `supplyChainSummary`; integration "can source every input of every recipe"; `tests/simulation.test.ts` "never lets production consume an input the run does not have" | |
| S15-02 | 15 | Inputs, outputs, capacity, labour, energy, costs, efficiency, quality | IMPL-THIN | `ProductionRecipeDef` in `src/sim/types.ts` (inputs, outputs, byproducts, capacityPerDay, labourRequired, energyPerUnit, opexPerDay, skillId for efficiency and quality) | |
| S15-03 | 15 | Storage and transportation of production | IMPL-THIN | `production.ts` `storagesForLine`, `bufferSummary` | |
| S15-04 | 15 | Market demand, automation, and upgrades for production | PARTIAL | `production.ts` `automateLine`, `installLine`, `decommissionLine` | Line upgrades were not verified. |
| S15-05 | 15 | Disruption and maintenance | IMPL-THIN | `production.ts` `repairLine`, `restartLine`; events `factory_fire`, `mine_strike` | |
| S15-06 | 15 | Production chains interact with the economic simulation | IMPL-THIN | `production.ts` `feedInputs`, `collectOutputs` | |
| S16-01 | 16 | Personnel roles: security, mercenaries, drivers, pilots, traders, brokers, warehouse workers, logistics and business managers, accountants, lawyers, financial, intelligence, technical, researchers, production, sales, marketing, fixers, negotiators, faction contacts, contractors | PARTIAL | 24 employee roles in the registry (`EMPLOYEE_ROLES`, `src/engine/registry/people.ts`); roles observed include driver, pilot, trader, broker, and warehouse_worker | Role-by-role mapping to the spec's list was not completed in this audit. |
| S16-02 | 16 | Configurable skills, stats, experience, and levels | IMPL-THIN | `crew.ts` `crewSkillLevel`, `trainEmployee`, employee level and XP | |
| S16-03 | 16 | Salary, upkeep, and payroll | IMPL-THIN | `crew.ts` `payrollForecast`, `payOutstandingWages` | |
| S16-04 | 16 | Loyalty and morale | IMPL-THIN | Loyalty and morale drift in `crew.ts` (loyalty referenced in 14 files; morale in 13) | |
| S16-05 | 16 | Relationships | PARTIAL | One reference in `crew.ts` | Not a developed system. |
| S16-06 | 16 | Abilities and equipment | PARTIAL | One equipment reference in `crew.ts`; `equippedWeapon` in combat | |
| S16-07 | 16 | Training and promotions | IMPL-THIN | `crew.ts` `trainEmployee`, `promoteEmployee` | |
| S16-08 | 16 | Injuries | IMPL-THIN | Injury logic in `crew.ts` (31 references) | |
| S16-09 | 16 | Departure and retirement | IMPL-THIN | `crew.ts` `fire`; retirement at `B.crew.retirementLevel` (`crew.ts:594`); statuses departed and retired | |
| S16-10 | 16 | Corruption and betrayal risk | IMPL-THIN | `betrayed` status and logic in `crew.ts` (line ~486) | |
| S16-11 | 16 | Personal objectives | PARTIAL | Objective logic in `crew.ts` (10 references) | Not verified as player-facing. |
| S17-01 | 17 | Hierarchical delegation: player → regional manager → business manager → warehouse manager → workers | IMPL-THIN | Delegation tiers `player`, `regional_manager`, `business_manager`, `warehouse_manager` in `src/sim/automation.ts` (lines ~300–306, counted per tier); `eligibleManagers`, `delegationLoad`, `delegationBudget`; `production.ts` `assignLineManager` | Tier structure exists. Worker-level behaviour is not tested directly. |
| S17-02 | 17 | Managers automate operations | IMPL-THIN | `automation.ts` `createRule`, `automationTick`, `ruleConfigSchema`; integration "runs a delegated rule" | |
| S17-03 | 17 | Automated operations produce profits, losses, delays, errors, events, market effects, resource consumption, personnel effects | PARTIAL | `automation.ts` `uptimeFor`, `errorChanceFor`, `recordAutomationProfit` | Market and personnel effects of automation were not verified. |
| S17-04 | 17 | Operations continue as time advances | IMPL-THIN | `automationTick` runs inside `advanceDay` | |
| S17-05 | 17 | Large empire can run without manual transactions | PARTIAL | Automation exists | No large-scale test. |
| S18-01 | 18 | XP and levels | IMPL-THIN | `progression.ts` `grantXp`, `xpFromTradeProfit`, `progressionSummary` | |
| S18-02 | 18 | Skills and skill trees | IMPL-THIN | `progression.ts` `learnSkill`, `canLearnSkill`, `respec`; `tree` field; 35 skills in the registry | |
| S18-03 | 18 | Perks | IMPL | `progression.ts` `takePerk`, `canTakePerk`; 41 perks; integration "applies a learned perk" | |
| S18-04 | 18 | Reputation dimensions: criminal, legitimate, regional, crew, faction standing | IMPL-THIN | `reputation.ts` `DIMENSIONS` (global, local, legal, criminal, business, faction, crew); `changeRegionalReputation` | |
| S18-05 | 18 | Titles and ranks | PARTIAL | `progression.ts` `setTitle` | Ranks were not found as a distinct system. |
| S18-06 | 18 | Wealth and empire progression | IMPL-THIN | Endings `net_worth`, `empire_score`; `progressionSummary` | |
| S18-07 | 18 | Unlocks | IMPL-THIN | Commodity `unlock` conditions; location `discoveryRequirement`; `buyDarknetAccess` | |
| S18-08 | 18 | Missions | IMPL-THIN | `missions.ts` `offerMission`, `acceptMission`, `completeMission`, `missionsDailyTick`; 27 missions; missions page | |
| S18-09 | 18 | Achievements | IMPL-THIN | `progression.ts` `checkAchievements`, `achievementProgress`; 31 achievements | |
| S18-10 | 18 | Milestones | PARTIAL | Save milestones exist (`tests/api.test.ts` "withholds a seed-bearing milestone") | Milestone progression was not verified. |
| S18-11 | 18 | Prestige | IMPL | `progression.ts` `prestige`; `tests/phase0.test.ts` "prestige exploit removal" (3 tests) | |
| S18-12 | 18 | Optional New Game+ or legacy progression | PARTIAL | Prestige estate handover carries legacy value | No New Game+ mode. |
| S18-13 | 18 | Specialisations: trading, finance, logistics, combat, diplomacy, technology, legitimate business, criminal operations | PARTIAL | `progression.ts` `specialisationFor` | Not verified against all eight specialisations. |
| S18-14 | 18 | Player choices have meaningful consequences | PARTIAL | Progression affects costs and reputation | No test for choice consequences. |
| S18-15 | 18 | Never hard-lock the player out of major systems permanently | PARTIAL | `progression.ts` `respec`, `respecCost` | No test asserts recovery across systems. |
| S19-01 | 19 | Hybrid combat: routine encounters auto-resolve, major encounters go tactical | IMPL-THIN | `combat.ts` `shouldAutoResolve`, `autoResolve`, `startCombat`, `takeTurn` | |
| S19-02 | 19 | Turn-based tactical combat | IMPL-THIN | `combat.ts` `takeTurn`, `combatView`; `tests/actions.test.ts` "restricts actions to the fight while combat is active" | Single test. |
| S19-03 | 19 | Skill checks | IMPL-THIN | Skill-weighted odds in `combat.ts` (`fleeChance`, `negotiateChance`, `intimidateChance`, `bribeChance`) | |
| S19-04 | 19 | Automated resolution | IMPL-THIN | `combat.ts` `autoResolve` | |
| S19-05 | 19 | Player-controlled combat | IMPL-THIN | `combat.ts` `takeTurn`, `actionEstimates` | |
| S19-06 | 19 | Police encounters | IMPL-THIN | `combat.ts` `enforcementEncounterChance`, `spawnEnforcementEncounter`; event `police_raid` | |
| S19-07 | 19 | Rival organisations | PARTIAL | Enemy registry (20 enemies, `people.ts`) | Rival encounters are not a distinct system. |
| S19-08 | 19 | Faction warfare | IMPL-THIN | Event `faction_war`; `factions.ts` `provokeWar`; integration tests | |
| S19-09 | 19 | Ambushes | IMPL-THIN | Event `ambush`; ambush encounter logic in `combat.ts` | |
| S19-10 | 19 | Warehouse raids | IMPL-THIN | `properties.ts` `raidProperty`; raid logic in `combat.ts` | |
| S19-11 | 19 | Safehouse raids | PARTIAL | Safehouse is a property kind; raid logic applies to properties generally | No safehouse-specific raid path verified. |
| S19-12 | 19 | Vehicle pursuits | PARTIAL | Pursuit references in `combat.ts` (2) | Not a developed system. |
| S19-13 | 19 | Negotiation, bribery, intimidation | IMPL-THIN | `combat.ts` `negotiateChance`, `bribeChance`, `intimidateChance`; `travel.ts` `bribeSuccessBase` | |
| S19-14 | 19 | Escape, arrest, imprisonment | IMPL-THIN | `combat.ts` `fleeChance`, `applyArrest`, `prisonTick`, `attemptPrisonEscape`, `payBail` | |
| S19-15 | 19 | Injuries from combat | IMPL-THIN | Injury logic in `combat.ts` (21 references) | |
| S19-16 | 19 | Equipment effects | IMPL-THIN | `combat.ts` `equippedWeapon` (8 equipment references) | |
| S19-17 | 19 | Crew participation | IMPL-THIN | `combat.ts` `availableAllies` (9 ally references) | |
| S19-18 | 19 | Enemy archetypes | IMPL-THIN | 20 enemies in `people.ts`; `pickEnemies` in `combat.ts` | |
| S19-19 | 19 | Difficulty levels | IMPL-THIN | Difficulty references in `combat.ts` (7); difficulty modifiers in `bootstrap.ts` | |
| S19-20 | 19 | Elite and boss encounters | IMPL-THIN | Boss and elite references in `combat.ts` (6); enemy `faction_boss` | |
| S19-21 | 19 | Non-combat resolutions | IMPL-THIN | Negotiate, bribe, intimidate, and flee in `combat.ts` | |
| S19-22 | 19 | Outcomes affected by skills, equipment, crew, reputation, location, faction, events, and preparation | PARTIAL | `combat.ts` `victoryOdds` | Preparation is not modelled (no references). |
| S20-01 | 20 | Hybrid event engine: simulation conditions, probability, world and player state, location, faction, indicators, history, controlled randomness | IMPL-THIN | `events.ts` `eventTick`, `fireEvent`, `affectedLocationStates`; `tick.ts` `rngForDay` | |
| S20-02 | 20 | Local, regional, and national or global event scopes | IMPL-THIN | Scopes in `src/engine/registry/events.ts`; registry test for player-scope and chained events | |
| S20-03 | 20 | Economic and supply events: crises, shortages, surpluses, supply disruption, natural disasters, strikes, currency crises | IMPL-THIN | `credit_crunch`, `recession_onset`, `metal_shortage`, `bumper_harvest`, `earthquake`, `hurricane`, `flood`, `mine_strike`, `currency_crisis` in `events.ts` | |
| S20-04 | 20 | Political and regulatory events: government changes, border closures, crackdowns, sanctions, new laws, leadership changes | IMPL-THIN | `government_change`, `border_closure`, `crackdown`, `sanctions_package`, `new_law`, `leadership_change_faction` in `events.ts` | Governments are event-driven, not tracked state (see S21-01). |
| S20-05 | 20 | Corporate, bank, cyber, competitor, and rival-war events | IMPL-THIN | `earnings_beat`, `earnings_miss`, `merger_announced`, `bank_failure`, `cyber_attack`, `rival_undercut`, `faction_war` in `events.ts` | |
| S20-06 | 20 | Celebrity-driven demand and viral trends | PARTIAL | Event `viral_trend` exists; a "Celebrity endorsement" headline sits inside an event body (`events.ts:733`) | No standalone celebrity-demand event. |
| S20-07 | 20 | Technology breakthroughs, market and hidden opportunities, player-specific events | IMPL-THIN | `tech_breakthrough`, `investment_opportunity`, `black_market_opportunity` (named "Hidden Opportunity"), player-scope events | |
| S20-08 | 20 | Chain-reaction events and secondary effects | IMPL-THIN | `tests/registry.test.ts` "includes chained multi-stage events and player-scope events"; event chain fields | |
| S20-09 | 20 | Causal chain that includes currency movement, financing changes, and stock reactions | PARTIAL | Stock and financing reactions exist | No FX or currency-movement model. Event `currency_crisis` only. |
| S21-01 | 21 | Continuous tracking of economy, markets, companies, factions, governments, competitors, supply chains, production, finance, employment, infrastructure, events, and the empire | PARTIAL | `world.ts` `stepWorld`; ticks for stocks, crypto, factions, trade network, production, crew | Governments are event-driven, not tracked state. Infrastructure is static scaling (`src/sim/economy.ts:149`, `src/sim/properties.ts:57,82`, `src/sim/state.ts:251`). |
| S21-02 | 21 | Competitor activity | IMPL-THIN | `CompetitorState` (`types.ts:693`); `TradeAgentState` (`types.ts:718`); `tests/trade-network.test.ts` (25 tests) | NPC production and borrowing are absent (Phase 4). |
| S21-03 | 21 | A world that feels alive rather than reacting only to the player | PARTIAL | Background ticks and NPC trade exist | NPC industry is absent. Qualitative. |
| S22-01 | 22 | Multiple reputation dimensions: global, local, legal, criminal, business, faction, crew | IMPL-THIN | `src/sim/reputation.ts` `DIMENSIONS`; `changeReputation`, `changeLocalReputation`, `changeRegionalReputation` | |
| S22-02 | 22 | Factions with goals, resources, relationships, territories, economic interests, rivalries, alliances, reputation requirements, dynamic actions | IMPL-THIN | `FactionDef` fields: goals, resources, power, territoryIds, interests, rivalIds, allyIds, recruitmentRequirement, services (`src/sim/types.ts`) | |
| S22-03 | 22 | Factions react to world conditions and player actions | IMPL-THIN | `factions.ts` `factionTick`, `changeStanding`, `acceptOffer`, `declineOffer`, `requestService`, `provokeWar`; integration "faction conflict re-routes rival cargo" | |
| S23-01 | 23 | Visual design combining a modern financial dashboard with a modern strategy game, not a CRUD admin panel | PARTIAL | 20 game pages; charts via recharts; Tailwind theme (`src/app/globals.css`) | Qualitative. Earlier browser screenshots were not persisted. |
| S23-02 | 23 | Main dashboard | IMPL-THIN | `src/app/games/[gameId]/page.tsx` | No test renders the dashboard page. `tests/screens.test.tsx` and `tests/ui.test.tsx` cover other screens, not this one. |
| S23-03 | 23 | World and map view | IMPL-THIN | `src/app/games/[gameId]/world/page.tsx` (World map tab, SVG node map, reachable and unreachable destinations) | No test renders the world page or its map. |
| S23-04 | 23 | Market browser | IMPL-THIN | `market/page.tsx`; `markets.ts` `marketRows`; sort, filter, and search controls | No test renders the market page. |
| S23-05 | 23 | Commodity details | IMPL-THIN | `markets.ts` `marketDetail`; detail view on the market page | No test references `marketDetail`. |
| S23-06 | 23 | Price history | PARTIAL | History arrays exist in state; charts on stocks, crypto, world, news, and finance pages | No price-history chart on the market page. |
| S23-07 | 23 | Economic indicators | IMPL-THIN | `world.ts` `computeIndicators`; indicators on dashboard and news | No test references `computeIndicators`. |
| S23-08 | 23 | Portfolio | IMPL-THIN | `stocks/page.tsx` `portfolioRisk`; `cryptoPortfolioRisk` | No test references `portfolioRisk` or `cryptoPortfolioRisk`. |
| S23-09 | 23 | Banking | IMPL-THIN | `finance/page.tsx` | No test renders the finance page. |
| S23-10 | 23 | Investments | IMPL-THIN | `stocks/page.tsx`, `crypto/page.tsx` | No test renders the stocks or crypto investment pages. |
| S23-11 | 23 | Crypto | IMPL-THIN | `crypto/page.tsx` | No test renders the crypto page. |
| S23-12 | 23 | Inventory | IMPL-THIN | `inventory/page.tsx` (filters) | No test renders the inventory page. |
| S23-13 | 23 | Vehicles | IMPL-THIN | `logistics/page.tsx` (vehicle listings) | No test renders the logistics page. |
| S23-14 | 23 | Logistics | IMPL-THIN | `logistics/page.tsx` | No test renders the logistics page. |
| S23-15 | 23 | Properties | IMPL-THIN | `properties/page.tsx` | No test renders the properties page. |
| S23-16 | 23 | Businesses | IMPL-THIN | `businesses/page.tsx` | No test renders the businesses page. |
| S23-17 | 23 | Production | IMPL-THIN | `production/page.tsx` | No test renders the production page. |
| S23-18 | 23 | Crew | IMPL-THIN | `crew/page.tsx` | No test renders the crew page. |
| S23-19 | 23 | Factions | IMPL-THIN | `factions/page.tsx` | |
| S23-20 | 23 | Reputation | PARTIAL | Reputation shown on `progression/page.tsx` (7 references) | No dedicated reputation screen. |
| S23-21 | 23 | Missions | IMPL-THIN | `missions/page.tsx` | |
| S23-22 | 23 | Combat | IMPL-THIN | `combat/page.tsx` | |
| S23-23 | 23 | Event and news feed | IMPL-THIN | `news/page.tsx`; `world.ts` `pushNews` | No test renders the news page or references `pushNews`. |
| S23-24 | 23 | Notifications | PARTIAL | `src/components/ui/toast.tsx`; `src/components/game/day-report.tsx` | No notification centre. |
| S23-25 | 23 | Settings | MISSING | No settings route; the 20 navigation destinations in `src/components/game/nav.ts` do not include settings | |
| S23-26 | 23 | Charts, tables, cards, tooltips, and data visualisation | IMPL-THIN | `src/components/game/charts.tsx` (Sparkline and charts) | Tooltips were not verified. |
| S23-27 | 23 | Filters, sorting, and search | PARTIAL | Market (sort and search), stocks (sort and search), crypto (search), inventory and logistics (filters) | Not uniform across pages. |
| S23-28 | 23 | Responsive navigation | IMPL-THIN | `shell.tsx` mobile branch; `nav.ts` navigation groups | |
| S23-29 | 23 | Contextual information and clear information hierarchy | PARTIAL | Qualitative | |
| S24-01 | 24 | Works on desktop, tablet, and mobile | PARTIAL | Mobile nav branch exists | Known 390px overflow on the game page. |
| S24-02 | 24 | Responsive layouts rather than a shrunk desktop UI | PARTIAL | Mobile nav branch exists | Qualitative. |
| S24-03 | 24 | Touch, mouse, and keyboard support | PARTIAL | No input-modality tests | |
| S24-04 | 24 | Responsive tables, collapsible panels, and mobile-friendly charts | PARTIAL | No collapsible-panel component found | Responsive tables not verified. |
| S24-05 | 24 | Accessible controls | PARTIAL | No accessibility test or automated audit in the repo | |
| S25-01 | 25 | Manifest | IMPL | `public/manifest.webmanifest` (name, start_url, display standalone, icons); `<link>` via `metadata` in `src/app/layout.tsx:11` | |
| S25-02 | 25 | Icons | IMPL-THIN | `scripts/generate-icons.ts` runs in `prebuild`, writes `public/icons/generated/` (gitignored). `npm run build` produced `icon-192.png` and `icon-512.png`. | Icons are not committed. They exist only after a build. |
| S25-03 | 25 | Installability | PARTIAL | Manifest and icons present; service worker registered | No install prompt. `public/sw.js` has no fetch handler. Installability was not verified in a browser this session. |
| S25-04 | 25 | Responsive behaviour | PARTIAL | See S24 rows | |
| S25-05 | 25 | Offline-aware architecture where practical | MISSING | `public/sw.js` states "intentionally no offline caching yet" | Deferred in code. |
| S25-06 | 25 | Service worker architecture | PARTIAL | `public/sw.js` (install and activate only); registered in `src/app/providers.tsx:30-31` | |
| S25-07 | 25 | Offline support does not compromise authoritative server state | IMPL-THIN | No offline writes; commands go through the server intent route | |
| S26-01 | 26 | PostgreSQL and Supabase used appropriately | PARTIAL | `src/persistence/postgres-store.ts`; migrations 0001–0004. `tests/postgres-identity.test.ts`: 14 cases (13 PostgreSQL tests and 1 gating test) passed 14/14 on PostgreSQL 18.4, disposable local database, this session; 0 skipped | Only the identity suite has been run on Postgres. Supabase deployment is not verified. Skipped by default without `DYNASTY_DISPOSABLE_POSTGRES_URL`. |
| S26-02 | 26 | Normalised, scalable schema with foreign keys, constraints, indexes, and transactions | PARTIAL | `supabase/migrations/0001_initial_schema.sql` (constraint, index, and foreign-key tokens); 7 tables | Game world state is stored as one sealed JSON document per version (`game_versions`). It is not normalised into the roughly 32 domain tables the spec lists. |
| S26-03 | 26 | Transactions | IMPL-THIN | `postgres-store.ts` BEGIN, COMMIT, ROLLBACK (12 references); `sqlite-store.ts`; compare-and-set on version | Postgres identity suite passed this session, including concurrent creation and compare-and-set tests (14/14, disposable PostgreSQL 18.4). Transaction paths outside that suite are not separately tested. |
| S26-04 | 26 | JSON used only where justified | PARTIAL | Whole game state stored as JSON with a seal | Justification for JSON over tables is not documented. |
| S26-05 | 26 | Audit and history tables | IMPL-THIN | `action_audit`, `game_versions` (history), `intent_receipts` | |
| S26-06 | 26 | Domain tables suggested by the spec (users through save_versions) | PARTIAL | 7 tables present: schema_migrations, profiles, sessions, games, game_versions, action_audit, intent_receipts | Approximately 32 suggested domains are not separate tables. The spec allows a better design, but the sealed-document choice is not yet justified against it. |
| S26-07 | 26 | Row-level security on user-owned tables | PARTIAL | `supabase/migrations/0002_row_level_security.sql` (RLS enabled, 13 policy or enable statements); applied to a disposable PostgreSQL 18.4 this session | Policies applied, not exercised. The identity suite connects as a superuser, which bypasses RLS, so two-owner enforcement under the `authenticated` role is still unverified. Not verified on a live database. |
| S27-01 | 27 | Cloud saves | IMPL-THIN | `src/app/api/games/` routes; persistence stores; `tests/api.test.ts` | |
| S27-02 | 27 | Persistent game state | IMPL | `tests/guest-persistence.test.ts` "resumes the same guest and the same save after the store is closed and reopened"; `tests/persistence.test.ts` | |
| S27-03 | 27 | Save versions; restore forward | IMPL | `tests/api.test.ts` "stores version history and restores forward, not backward"; `tests/persistence.test.ts` "keeps version history and restores forward without rewriting it" | |
| S27-04 | 27 | Migration of save documents | PARTIAL | `tests/game-identity.test.ts` "treats a legacy save as the save it was" | No general save-document migration pipeline verified. |
| S27-05 | 27 | Recovery | PARTIAL | Version restore; corrupted saves refused ("refuses a save whose stored document was edited directly in the database") | No automatic recovery path verified. |
| S27-06 | 27 | Validation of saves | IMPL | `tests/persistence.test.ts` "refuses a save that parses but breaks the game invariants"; `tests/serialize-integrity.test.ts` | |
| S27-07 | 27 | Conflict-safe updates | IMPL | `tests/api.test.ts` "rejects a stale version with a conflict and writes nothing"; `tests/persistence.test.ts` "rejects a stale write and never overwrites a newer save" | |
| S27-08 | 27 | Transactional persistence | IMPL-THIN | SQLite tests run | Postgres identity suite covers creation and compare-and-set on PostgreSQL 18.4 (14/14, this session). Other transactional paths are not separately tested. |
| S27-09 | 27 | Critical state validated server-side; game state not solely client-side | IMPL | Server-authoritative intents; `tests/dto.test.ts`; `tests/api.test.ts` "ignores client-supplied money, price and outcome fields" | |
| S28-01 | 28 | Do not implement unnecessary multiplayer now | DEFERRED | No multiplayer features found | Compliant with the spec. |
| S28-02 | 28 | Separate player, world, simulation, transactions, events, and market state | PARTIAL | State sections in `src/sim/types.ts`; ledger chain for transactions | Stored as one sealed document per version. |
| S28-03 | 28 | No assumption that game state belongs permanently to one client | PARTIAL | Owner-scoped saves (`tests/guest-mode.test.ts`) | No multi-client design beyond compare-and-set. |
| S29-01 | 29 | Authentication | PARTIAL | Guest sessions are server-issued with an HttpOnly cookie (`tests/guest-mode.test.ts` "delivers the credential only as an HttpOnly, SameSite=Lax session cookie"); Supabase provider present | Login and register API routes still exist (`src/app/api/auth/login`, `register`), although the player UI has no login. Live Supabase auth not verified. |
| S29-02 | 29 | Authorisation and ownership | IMPL | `tests/guest-mode.test.ts` "gives a second guest a 404 for the first guest's save, on every game route"; `tests/api.test.ts` "lists only the caller's own saves" | |
| S29-03 | 29 | Server-side validation of requests and state transitions | IMPL | `tests/actions.test.ts` "strips client-supplied money fields"; `tests/api.test.ts` "ignores client-supplied money, price and outcome fields"; zod in 3 files | |
| S29-04 | 29 | Input validation | IMPL-THIN | zod schemas at the API layer; `src/server/api-helpers.ts` | |
| S29-05 | 29 | Secure database policies (RLS) | PARTIAL | `supabase/migrations/0002_row_level_security.sql`; applied to a disposable PostgreSQL 18.4 this session | Two-owner enforcement under the `authenticated` role not verified (the suite runs as superuser). Not verified on a live database. |
| S29-06 | 29 | Rate limiting | PARTIAL | `src/server/services/rate-limit.ts`; `tests/guest-mode.test.ts` rate-limit tests (7); `tests/client-identity.test.ts` | Production trusted-proxy configuration is unverified at the public edge. Deployment blocker. |
| S29-07 | 29 | Secrets handled securely | PARTIAL | `src/config/env.ts`; `.env.example`; no hard-coded credentials found (see S46-01) | `DYNASTY_APP_SECRET` unset gives an ephemeral dev secret (`src/server/auth/tokens.ts:47` warns). Deployment blocker. |
| S29-08 | 29 | Protection against transaction manipulation | IMPL | `tests/idempotency.test.ts`; intent receipts (migration 0003); version compare-and-set | |
| S29-09 | 29 | Protection against client-side economic cheating | IMPL-THIN | `tests/dto.test.ts` "never includes RNG, diagnostics"; `tests/api.test.ts` | |
| S29-10 | 29 | Secure save handling (seal) | IMPL-THIN | `tests/persistence.test.ts` "is deterministic, so the seal is worth checking"; `tests/postgres-identity.test.ts` "rejects a save whose seal was edited in the database" (skipped by default) | `tests/postgres-identity.test.ts` "rejects a save whose seal was edited in the database" passed on PostgreSQL 18.4 (disposable database) this session. |
| S29-11 | 29 | Auditability of important operations | IMPL-THIN | `action_audit` table; `src/app/api/audit/route.ts`; `tests/guest-mode.test.ts` "keeps the audit trail private to the guest that produced it" | |
| S29-12 | 29 | Browser never trusted for authoritative calculations | IMPL-THIN | Server-side simulation; intent-based API | |
| S30-01 | 30 | Controlled seeds for events, volatility, procedural generation, encounters | IMPL | `src/engine/rng.ts`; `src/sim/tick.ts` `rngForDay`, `rngForAction`; `tests/simulation.test.ts`; `tests/game-identity.test.ts` "gives two same-seed games identical simulation output despite different identities" | |
| S30-02 | 30 | Random number generation separated from business logic | IMPL-THIN | `src/engine/rng.ts` module; RNG passed into simulation functions | |
| S31-01 | 31 | Centralised, data-driven balancing parameters (economy, volatility, rates, inflation, rarity, travel, combat difficulty, salaries, property costs, production rates, event probabilities, reputation effects, XP) | IMPL-THIN | `src/config/balance.ts` (economy, market, finance, tradeNetwork, stocks, crypto, underground, travel, logistics, property, business, production, crew, automation, progression, reputation, factions, combat, enforcement, events, missions, world, player, saves, api) | |
| S31-02 | 31 | No scattered values | PARTIAL | Balance sections are central | Inline literals remain (see S05-12). |
| S32-01 | 32 | Architecture supports 500+ commodities, large location networks, many businesses and employees, large inventories, long market history, complex event state, long saves, large simulation state | PARTIAL | Registry counts: 765 commodities, 48 locations, 27 businesses, 44 companies | No performance or load tests in the repo. Saves are whole-document JSON, and growth has not been measured. |
| S32-02 | 32 | Efficient queries and indexes | PARTIAL | Index tokens in `0001_initial_schema.sql` | No query-plan review. |
| S32-03 | 32 | Caching where appropriate | IMPL-THIN | `tests/query-cache.test.tsx`; `src/lib/query.ts` | |
| S32-04 | 32 | Aggregation, background processing, incremental simulation | PARTIAL | `advanceDays` is request-driven; stock board pagination | No background worker. |
| S32-05 | 32 | Pagination | IMPL-THIN | `tests/api.test.ts` "keeps the stock board whole by default and paginates it on request" | |
| S32-06 | 32 | Lazy loading | PARTIAL | Not verified | |
| S32-07 | 32 | Appropriate client state management | IMPL-THIN | `zustand` and `src/lib/game-context.tsx`; `src/lib/query.ts` | |
| S33-01 | 33 | Separate persistent, simulation, UI, and temporary interaction state | PARTIAL | `src/lib/game-context.tsx`; simulation state in `src/sim/types.ts` | No documented state boundary. |
| S33-02 | 33 | Predictable state architecture; avoid prop-drilling and uncontrolled global state | PARTIAL | Context and query layers | Qualitative. |
| S34-01 | 34 | Clear service and API boundaries | IMPL-THIN | `src/app/api/` routes; `src/server/services/`; `src/lib/api-client.ts` | |
| S34-02 | 34 | Strongly typed contracts | IMPL-THIN | TypeScript strict mode; `src/server/dto.ts`; typed `api-client` | |
| S34-03 | 34 | Validate requests, authentication, authorisation, transitions, financial operations, inventory, progression | IMPL-THIN | `tests/api.test.ts`; `tests/actions.test.ts` | |
| S34-04 | 34 | Client cannot dictate money, XP, inventory, prices, ownership, loan balances, combat results, or reputation | IMPL | `tests/actions.test.ts` "strips client-supplied money fields"; `tests/api.test.ts` "ignores client-supplied money, price and outcome fields" | |
| S35-01 | 35 | Type checks | IMPL | `npm run typecheck`: exit 0 | |
| S35-02 | 35 | Linting | IMPL | `npm run lint`: exit 0, 0 errors, 6 warnings | |
| S35-03 | 35 | Unit tests | IMPL | `npx vitest run`: 410 passed, 13 skipped, 0 failed, exit 0 | 13 skipped are the Postgres identity suite. |
| S35-04 | 35 | Integration tests | IMPL-THIN | `tests/integration.test.ts` (7 describe blocks) and others | |
| S35-05 | 35 | End-to-end tests | MISSING | No Playwright or Cypress dependency; no E2E suite in the repo | Browser evidence from earlier sessions lives in `/tmp` and is not persisted. |
| S35-06 | 35 | Database tests | PARTIAL | `tests/postgres-identity.test.ts`: 14 cases (13 PostgreSQL tests and 1 gating test) | Run this session: 14/14 passed, 0 skipped, exit 0, against PostgreSQL 18.4 on a disposable local database. Covers identity, compare-and-set, seal, and ownership. Does not cover the whole database layer. |
| S35-07 | 35 | API tests | IMPL | `tests/api.test.ts`; `tests/route-harness.ts` | |
| S35-08 | 35 | Economic simulation tests | IMPL-THIN | `tests/simulation.test.ts`; `tests/trade-network.test.ts`; `tests/trade-discovery.test.ts` | |
| S35-09 | 35 | Save and load tests | IMPL | `tests/persistence.test.ts`; `tests/guest-persistence.test.ts` | |
| S35-10 | 35 | Security validation tests | IMPL-THIN | `tests/guest-mode.test.ts` (38 tests); `tests/session-hardening.test.ts`; `tests/client-identity.test.ts` | |
| S35-11 | 35 | Responsive and build validation | PARTIAL | `npm run build`: exit 0 | No automated responsive tests. 390px defect known. |
| S35-12 | 35 | Meaningful tests for critical systems (supply and demand, markets, inflation, interest, loans, transactions, inventory, travel, combat, progression, reputation, events, production, automation, save and load, server-side validation) | PARTIAL | Covered: trade, interest, loans, production, save and load, server authority | Thin or absent: inflation (no direct test), combat (one test), stocks and crypto (api board only), logistics (contract test), reputation (indirect). |
| S35-13 | 35 | Fix failing tests rather than report them | PROCESS | Current gate run has no failing tests | |
| S36-01 | 36 | Infinite-money exploits | IMPL-THIN | `tests/simulation.test.ts` "refuses to spend money the player does not have"; `tests/actions.test.ts` "keeps money conserved across a dispatcher round trip" | No scenario test for a money-loop exploit. |
| S36-02 | 36 | Guaranteed arbitrage | PARTIAL | Arbitrage tests in `tests/trade-discovery.test.ts` | No test asserts arbitrage is bounded. |
| S36-03 | 36 | Negative-price bugs | IMPL-THIN | `tests/registry.test.ts` "never produces negative, zero or non-finite prices" | Registry prices only. |
| S36-04 | 36 | Infinite inventory | IMPL-THIN | `tests/phase0.test.ts` "rejects a genuine capacity overflow" | |
| S36-05 | 36 | Interest calculation errors | IMPL-THIN | `tests/integration.test.ts` "accrues interest, goes delinquent when unpaid, and marks the credit file" | |
| S36-06 | 36 | Impossible production chains | IMPL-THIN | `tests/integration.test.ts` "can source every input of every recipe" | |
| S36-07 | 36 | Broken supply and demand loops | PARTIAL | No loop-stability test found | |
| S36-08 | 36 | Currency creation exploits | IMPL-THIN | `tests/registry.test.ts` "never lets a recipe create value from nothing (no free-money production loop)"; ledger chain tests in `tests/phase0.test.ts` | |
| S36-09 | 36 | Transaction duplication | IMPL | `tests/idempotency.test.ts`; `tests/api.test.ts` "requires the version a command was planned against" | |
| S36-10 | 36 | Save duplication | IMPL | `tests/game-identity.test.ts` "creates independent saves under repeated and concurrent creation with one seed" | |
| S36-11 | 36 | XP duplication | PARTIAL | `tests/phase0.test.ts` "does not double-award duplicate prestige requests" | No direct XP-duplication test. |
| S36-12 | 36 | Automated-business exploits | PARTIAL | Production input test in `tests/simulation.test.ts` | No automation-exploit test. |
| S37-01 | 37 | Errors logged appropriately | PARTIAL | `console.warn` and `console.error` in `src/server/http.ts:139` and services | No structured logger. |
| S37-02 | 37 | Errors visible to developers | PARTIAL | Console output only | No error-reporting hook. |
| S37-03 | 37 | Useful user feedback | IMPL-THIN | Error codes via `src/server/api-helpers.ts`; toasts (`src/components/ui/toast.tsx`) | |
| S37-04 | 37 | No sensitive information in errors | IMPL-THIN | `src/server/http.ts` redacts internal keys (line ~99) and logs stack traces server-side only (line ~139); `tests/api.test.ts` "never includes RNG, diagnostics, chain or competitor internals" | |
| S37-05 | 37 | Fail safely and preserve save integrity | IMPL-THIN | Compare-and-set; invalid saves refused (`tests/persistence.test.ts`) | |
| S38-01 | 38 | Structured logging | MISSING | Five `console` calls under `src/server` and `src/app/api`; no logger library in `package.json` | |
| S38-02 | 38 | Simulation diagnostics | IMPL-THIN | Diagnostics kept out of player views (`tests/api.test.ts` "never includes RNG, diagnostics, chain or competitor internals") | |
| S38-03 | 38 | Transaction logging | IMPL-THIN | `action_audit` table; ledger chain | |
| S38-04 | 38 | Error reporting hooks | MISSING | No error-reporting SDK or hook | |
| S38-05 | 38 | Development debug tools | PARTIAL | `scripts/inspect-economy.ts` (`npm run sim:inspect`) | No in-app debug view. |
| S38-06 | 38 | Economy inspection tools | IMPL-THIN | `npm run sim:inspect` script exists | Not run in this session. |
| S38-07 | 38 | Event inspection tools | PARTIAL | `eventsView`, `activeEventViews` in `src/sim/events.ts` | No dedicated inspector. |
| S38-08 | 38 | Explain why a price, event, transaction, or outcome occurred | PARTIAL | Factor breakdowns in `finance.ts`; news copy | Not consistent across systems. |
| S39-01 | 39 | Registries for commodities, locations, factions, events, skills, perks, vehicles, properties, businesses, production recipes, enemies | IMPL-THIN | `src/engine/registry/` (commodities, world, actors, events, assets, people, missions, regions, forms, basesA/B/C) | Registry names differ from the spec (for example, no `CommodityRegistry` symbol). |
| S39-02 | 39 | Registries drive behaviour rather than hard-coded logic | IMPL-THIN | Simulation modules consume registry data; `registrySummary` in `src/engine/registry/index.ts` | |
| S40-01 | 40 | Expose why things changed: prices, loans, route danger, business losses, reputation, events, employee activity, automation output, active risks | PARTIAL | Credit-score factor breakdown (`finance.ts`); event descriptions; portfolio risk | Coverage across all listed topics not verified. |
| S41-01 | 41 | News surfaces market changes, political and economic events, shortages, corporate news, faction activity, travel disruptions, financial changes, local and global events | IMPL-THIN | `world.ts` `pushNews`; event headlines in `events.ts`; `src/app/games/[gameId]/news/page.tsx` | |
| S41-02 | 41 | Information as a strategic resource | IMPL-THIN | `underground.ts` `buyLocationIntel`, `dataOffers`; `tests/trade-network.test.ts` "withholds working capital and profit" | |
| S42-01 | 42 | Progression feeling from survival to managing a major economic empire | PARTIAL | Systems exist along the progression path | Qualitative. No playtest evidence in the repo. |
| S43-01 | 43 | Every major system designed for extension | IMPL-THIN | Registry-driven content; `tests/registry.test.ts` | No test adds new content end to end. |
| S44-01 | 44 | Strict TypeScript | IMPL | `tsconfig.json` `"strict": true`; `npm run typecheck`: exit 0 | |
| S44-02 | 44 | Clear naming, small cohesive modules | PARTIAL | Module per domain; `wc -l` on 2026-10-12: `src/sim/types.ts` 1,961; `markets.ts` 1,786; `state.ts` 1,724; `crypto.ts` 1,724; `finance.ts` 1,639 (total 8,834 lines) | Sizes measured this session, not estimated. No refactor was made in this audit. |
| S44-03 | 44 | No unnecessary duplication; no dead code | PARTIAL | Lint has 0 errors | Dead link to `/leaderboard` in `src/components/games/game-library.tsx:110`. Login and register API routes kept. Full dead-code analysis not run. |
| S44-04 | 44 | No "TODO: implement later" for core functionality | IMPL | Zero TODO or FIXME markers in `src/` | |
| S44-05 | 44 | No placeholder business logic | PARTIAL | No fake backends found by grep | Service worker is an explicit stub (`public/sw.js`). Phase 4 features are absent. |
| S44-06 | 44 | No mocked functionality presented as complete | IMPL-THIN | No mock data files under `src/` found | Not exhaustively audited. |
| S44-07 | 44 | No hard-coded fake backend responses or static dashboards | IMPL-THIN | Views derive from simulation state (`src/server/services/game-views.ts`) | |
| S45-01 | 45 | Inspect the existing repository before changing it | PROCESS | Completed in this audit | |
| S45-02 | 45 | Reuse existing infrastructure and avoid destroying working functionality | PARTIAL | Worktree fast-forwarded to remote `68db6fa` (2026-10-12). Local tracked and untracked content matched the remote tip byte for byte before the fast-forward, so no local-only edit was lost. Prior state kept in `stash@{0}` (`a374aefe35c5e597327f9f5c7e4b553a713f2da8`) and an external backup | Reconciliation complete. The stash is kept as a recovery point and was not dropped. Row stays PARTIAL because the open guest-mode defects in `PROJECT_STATUS.md` section 6 remain. |
| S46-01 | 46 | No hard-coded API keys, database passwords, auth secrets, service-role keys | IMPL-THIN | Pattern scan of tracked and untracked files found no credential. The one match is an integrity hash in `package-lock.json` (false positive). | |
| S46-02 | 46 | Environment variables; dev and production configuration separable | PARTIAL | `.env.example`; `src/config/env.ts` | Production requires `DYNASTY_APP_SECRET` and trusted-proxy declarations. Not verified in deployment. |
| S47-01 | 47 | All database changes represented by migrations | IMPL-THIN | `supabase/migrations/0001` to `0004`; `scripts/migrate.ts` | |
| S47-02 | 47 | Migrations apply consistently | PARTIAL | Migrations exist | `0001` to `0004` applied in order to a fresh disposable PostgreSQL 18.4 this session; a re-run reported all current. Not applied to any live database. |
| S48-01 | 48 | Sufficient seed data for an immediately playable game | IMPL | Registry counts: locations 48, commodities 765, companies 44, crypto assets 20, factions 41, events 71, properties 28, vehicles 18, employee roles 24, businesses 27, recipes 44, skills 35, perks 41, enemies 20, missions 27, achievements 31 | |
| S48-02 | 48 | Seed data feels like a real game world, not test records | PARTIAL | Real-world-style names (cities, companies, commodities) | Qualitative. |
| S49-01 | 49 | New player: create or authenticate an account | PARTIAL | Guest creation is tested (`tests/guest-mode.test.ts`); no login UI | Supabase sign-in not verified end to end. |
| S49-02 | 49 | Start a new game | IMPL | `tests/game-identity.test.ts`; `tests/api.test.ts` | |
| S49-03 | 49 | Enter the world | IMPL-THIN | `src/app/games/[gameId]/world/page.tsx` | No E2E run. |
| S49-04 | 49 | View markets | IMPL-THIN | `market/page.tsx`; `marketRows` | No E2E run. |
| S49-05 | 49 | Purchase commodities or assets | IMPL-THIN | `markets.ts` `executeBuy`; `properties.ts` `buyProperty`; `logistics.ts` `buyVehicle` | No E2E run. |
| S49-06 | 49 | Travel | IMPL-THIN | `travel.ts` `executeTravel` | No E2E run. No test references `executeTravel`. |
| S49-07 | 49 | Sell and trade | IMPL-THIN | `markets.ts` `executeSell`; integration "trade moves the local market" | No E2E run. No test references `executeSell` directly. |
| S49-08 | 49 | Experience changing prices | IMPL-THIN | Integration "trade moves the local market, and the move survives a save" | No E2E run. |
| S49-09 | 49 | Advance time | IMPL-THIN | `advance` route; `tick.ts` `advanceDays` | No E2E run. |
| S49-10 | 49 | Experience world events | IMPL-THIN | `events.ts` `eventTick`; integration "creates shocks that move markets in the scopes it names" | No E2E run. No test references `eventTick` directly. |
| S49-11 | 49 | Manage inventory | IMPL-THIN | `inventory/page.tsx`; capacity tests | No E2E run. |
| S49-12 | 49 | Acquire financing | IMPL-THIN | `finance.ts` `takeLoan`; integration credit-file test | No E2E run. |
| S49-13 | 49 | Earn and spend money | IMPL-THIN | Trading, wages, and interest in the tick loop | No E2E run. No dedicated test cited. |
| S49-14 | 49 | Gain progression | IMPL-THIN | `progression.ts` `grantXp`; integration "applies a learned perk" | No E2E run. |
| S49-15 | 49 | Hire personnel | IMPL-THIN | `crew.ts` `hire`, `generateCandidate` | No E2E run. |
| S49-16 | 49 | Acquire property | IMPL-THIN | `properties.ts` `buyProperty` | No E2E run. |
| S49-17 | 49 | Build businesses | IMPL-THIN | `businesses.ts` `openBusiness` | No E2E run. |
| S49-18 | 49 | Run production | IMPL-THIN | `production.ts` `installLine`, `productionTick` | No E2E run. |
| S49-19 | 49 | Manage logistics | IMPL-THIN | `logistics.ts` `planShipment`, `sendShipment` | No E2E run. No test references `sendShipment`. |
| S49-20 | 49 | Experience enforcement and combat | PARTIAL | Enforcement integration test; combat is thin (one action test) | Combat path not verified end to end. |
| S49-21 | 49 | Invest in financial markets | IMPL-THIN | `stocks.ts` `buyShares`; `crypto.ts` `buyCrypto` | No E2E run. No test references `buyShares` or `buyCrypto`. |
| S49-22 | 49 | Save progress | IMPL | `tests/api.test.ts`; `tests/persistence.test.ts` | |
| S49-23 | 49 | Reload progress | IMPL | `tests/guest-mode.test.ts` "keeps the same guest across a reload, with the same cookie" and "lets a guest play a game it owns, and reload the same save" | |
| S49-24 | 49 | Continue the simulation | IMPL | `tests/game-identity.test.ts` "save and restore preserve the simulation continuation" | |
| S49-25 | 49 | Progress toward an advanced economic empire | PARTIAL | Systems exist along the path | No long-run playthrough verified. |
| S49-26 | 49 | Verify the full loop end to end in a browser before completion | MISSING | No committed E2E suite; no browser run in this session | Required by §49 ("Do not declare the application complete if this core loop is broken"). |
| S50-01 | 50 | The application builds successfully | IMPL | `npm run build`: exit 0 | |
| S50-02 | 50 | TypeScript checks pass | IMPL | `npm run typecheck`: exit 0 | |
| S50-03 | 50 | Relevant lint checks pass | IMPL | `npm run lint`: exit 0 (0 errors, 6 warnings) | |
| S50-04 | 50 | Database migrations are valid | PARTIAL | Four migration files present; applied to a disposable PostgreSQL 18.4 this session | `0001`–`0004` applied in order, exit 0, health ok. Supabase `auth` schema and roles were stood up as stand-ins in that disposable database only. Not applied to any live database. |
| S50-05 | 50 | Core functionality implemented | PARTIAL | Most domains implemented | Phase 4 absent; bonds, refinancing, and investor funding missing; settings missing. |
| S50-06 | 50 | Critical tests pass | IMPL | `npx vitest run`: 410 passed, 0 failed, 13 skipped | |
| S50-07 | 50 | Authentication works | PARTIAL | Guest authentication is tested | Supabase path not verified. |
| S50-08 | 50 | Persistence works | IMPL-THIN | SQLite persistence tested | Postgres identity suite passed 14/14 this session on a disposable database. Full application flow on Postgres not run. |
| S50-09 | 50 | The economy functions | IMPL-THIN | Economy tests and integration tests | No E2E. |
| S50-10 | 50 | Markets function | IMPL-THIN | Trade and market tests | No E2E. |
| S50-11 | 50 | Travel functions | IMPL-THIN | `tests/phase0.test.ts` travel contract | Thin. |
| S50-12 | 50 | Inventory functions | IMPL-THIN | Capacity tests | |
| S50-13 | 50 | Finance functions | PARTIAL | Loans, interest, accounts, tax, and laundering exist | Refinancing, bonds, and investor funding missing. |
| S50-14 | 50 | Progression functions | IMPL-THIN | Perk and prestige tests | |
| S50-15 | 50 | Combat functions | IMPL-THIN | Combat module present | Thin test evidence. |
| S50-16 | 50 | Events function | IMPL-THIN | Event engine and integration tests | |
| S50-17 | 50 | Infrastructure functions | IMPL-THIN | `properties.ts` | Static scaling in parts (see S21-01). |
| S50-18 | 50 | Crew functions | IMPL-THIN | `crew.ts` | |
| S50-19 | 50 | Automation functions | IMPL-THIN | `automation.ts`; integration "runs a delegated rule" | |
| S50-20 | 50 | UI is responsive | PARTIAL | Mobile nav exists | 390px overflow defect. |
| S50-21 | 50 | PWA configuration is valid | PARTIAL | Manifest valid; icons generated at build; service worker registered | No install prompt; service worker has no fetch handler; installability not browser-verified. |
| S50-22 | 50 | No major core feature represented only by mock data | IMPL-THIN | No mock data in `src/` | Not exhaustively audited. |
| S50-23 | 50 | No critical system is merely a placeholder | PARTIAL | Most systems are substantive | Phase 4 absent. Stocks and crypto thin. Service worker is a stub. |
| S50-24 | 50 | No obvious client-side authority exploit | IMPL-THIN | Server-authoritative tests (S34-04, S29-03) | No penetration test. |
| S50-25 | 50 | The game can be played from start to progression | PARTIAL | Engine and API paths exist | No E2E run (S49-26). |
| S51-01 | 51 | Single-pass autonomous build rule | PROCESS | Not applicable to this audit | The task was scoped to audit and planning. |
| S52-01 | 52 | Final completion report format | PROCESS | Report delivered in chat; `docs/PROJECT_STATUS.md` records items 1–10 | Items that are not complete are stated as such. |

## Totals

Generated from the matrix rows above. The checker run for this file counted every `| Sxx-nn |` row (no duplicate IDs, no unknown status, all 53 section keys present).

| Status | Rows |
| --- | ---: |
| IMPL | 53 |
| IMPL-THIN | 225 |
| PARTIAL | 108 |
| MISSING | 9 |
| DEFERRED | 1 |
| PROCESS | 5 |
| **Total rows** | **401** |

Sections covered: 53 of 53 (preamble plus §1–§52). Rows with status MISSING: S09-10 (refinancing), S09-13 (investor funding), S09-15 (bonds), S23-25 (settings), S25-05 (offline caching), S35-05 (end-to-end tests), S38-01 (structured logging), S38-04 (error reporting hooks), S49-26 (browser verification of the full loop).
