> **Provenance — preserved copy of the Arena AI master build specification**
>
> - Source filename: `MASTER_GAME_SPEC.md`
> - Source location: remote commit `68db6fa` ("Add files via upload") on `origin/arena/75a7979e-dynastyv1-0`
> - Imported into the repository: 2026-10-12 (UTC)
> - SHA-256 of the original file (verified before import): `a5e78a1b6e5dfaf690cc1f6efb82f80ecf966ae8fd7f9221a4397578c7ccd7c7`
> - Everything below the rule line is byte-identical to the source file (CRLF line endings preserved).
> - This is reference material for the audit in `docs/REQUIREMENTS_MATRIX.md`. It is not evidence that any requirement is implemented.

---

# ARENA AI MASTER BUILD SPECIFICATION
## Next-Generation Economic Strategy Simulation Game

### EXECUTION DIRECTIVE

You are an autonomous senior software engineering team consisting of:

- Principal Software Architect
- Senior Full-Stack Engineer
- TypeScript Engineer
- React Engineer
- Backend Engineer
- PostgreSQL/Supabase Database Engineer
- Game Systems Engineer
- Economic Simulation Engineer
- AI/Simulation Engineer
- UI/UX Designer
- Security Engineer
- QA Engineer
- DevOps Engineer
- Performance Engineer

Your task is to inspect the existing repository and then implement the COMPLETE production-ready game described by this specification.

Do not create a superficial prototype, static mockup, proof of concept, or collection of disconnected screens.

Build the actual functioning game.

You must autonomously make reasonable implementation decisions wherever this specification does not explicitly dictate an implementation detail.

DO NOT ask the user for clarification unless an absolutely blocking repository/environment issue makes implementation impossible.

Execute the entire implementation in ONE autonomous pass.

Internally work through dependency-ordered stages, but do not stop for approval between stages.

After implementation, run available tests, type checks, linting, builds, migrations, and validation. Fix discovered issues before declaring completion.

---

# 1. PRODUCT VISION

Build a next-generation text-based economic strategy simulation game inspired conceptually by classic trading games, but substantially expanded into a deep persistent economic empire simulation.

The player should progress from a small-scale trader into a sophisticated, interconnected economic empire.

The game combines:

- Dynamic commodity trading
- Supply and demand
- Global markets
- Arbitrage
- Inflation
- Economic cycles
- Debt and financing
- Banking
- Investments
- Stocks
- Cryptocurrency
- Digital markets
- Dark-web-style underground markets
- Logistics
- Vehicles
- Warehouses
- Real estate
- Factories
- Businesses
- Supply chains
- Employees
- Managers
- Automation
- Factions
- Reputation
- Combat
- Enforcement
- Travel
- World events
- Technology
- Information markets
- Strategic progression
- Long-term empire building

The game must remain strategically understandable despite its complexity.

Players must be able to analyze markets, recognize trends, identify opportunities, form strategies, and make deliberate decisions.

Randomness should create uncertainty rather than make strategy meaningless.

---

# 2. TARGET PLATFORM

Build a modern full-stack web application.

Required baseline stack:

- React
- TypeScript
- Node.js / TypeScript backend
- PostgreSQL
- Supabase where appropriate
- Tailwind CSS
- Responsive web architecture

Target:

- Desktop
- Mobile
- Tablet
- Responsive browser
- PWA/installable application

Architecture must be prepared for:

- Cloud saves
- Persistent accounts
- Future multiplayer
- Future additional simulation systems
- Future expansion of the world

Do not implement multiplayer unless required by the existing repository/project specification, but design interfaces and domain boundaries so multiplayer can later be introduced without rewriting the core game engine.

---

# 3. CORE ARCHITECTURAL PRINCIPLE

Use a highly modular architecture.

Do NOT build the game as one giant component, one giant server file, or one monolithic game-state object.

Separate domains such as:

```text
economy
markets
commodities
world
locations
travel
events
finance
banking
investments
crypto
stocks
combat
enforcement
progression
inventory
logistics
vehicles
properties
businesses
production
crew
automation
factions
reputation
missions
authentication
saves
notifications
analytics
```

Use clear domain boundaries and service interfaces.

New commodities, locations, businesses, events, skills, factions, and mechanics should be addable without rewriting unrelated systems.

---

# 4. GAME LOOP

Implement a persistent time-based simulation.

Support:

- Days
- Turns/actions
- Time-consuming activities
- Travel time
- Business operations
- Production
- Employee operations
- Investments
- Interest
- Market evolution
- World events
- Logistics
- Passive income
- Competitor activity

Time advancement should trigger appropriate simulation systems.

The world should continue evolving as the player advances time.

Support:

- Campaign-style finite progression
- Endless/sandbox gameplay
- Configurable victory conditions
- Configurable loss conditions

Possible loss conditions include:

- Bankruptcy
- Severe financial failure
- Arrest/imprisonment consequences
- Critical reputation collapse
- Other configurable game-ending conditions

Do not make every negative consequence automatically game-ending.

---

# 5. ECONOMIC SIMULATION

Implement a serious dynamic economy.

The economy must include:

- Supply
- Demand
- Local markets
- Regional markets
- Global market influences
- Price volatility
- Inflation
- Deflation
- Economic cycles
- Booms
- Recessions
- Crashes
- Shortages
- Surpluses
- Market shocks
- Player activity
- NPC activity
- Faction activity
- Geographic specialization
- Arbitrage
- Dynamic scarcity

Every meaningful market should have its own state rather than relying exclusively on a global commodity price.

Player transactions should be capable of influencing markets.

NPC/world activity must also influence markets.

Economic formulas must be configurable through centralized balancing/configuration systems.

Do not scatter magic economic constants throughout the codebase.

---

# 6. ECONOMIC DESIGN PHILOSOPHY

The economy must balance:

RANDOMNESS + PREDICTABILITY.

Players should be able to discover patterns and develop strategies.

Avoid:

- Purely random prices
- Completely deterministic prices
- Arbitrage opportunities that are always guaranteed
- Economies where the optimal strategy is obvious
- Economies where player decisions have no meaningful effect

Use historical price information, trends, indicators, supply/demand information, market news, and other analytical tools so players can make informed decisions.

Where appropriate, expose:

- Current price
- Historical price
- Price trend
- Supply
- Demand
- Volatility
- Market sentiment
- Regional conditions
- Relevant events

---

# 7. COMMODITY SYSTEM

Support 500+ initial commodities with an architecture capable of procedurally expanding beyond that.

Commodity categories should include:

- Legal commodities
- Illegal commodities
- Contraband
- Luxury goods
- Raw materials
- Manufactured goods
- Pharmaceuticals
- Technology
- Weapons/equipment
- Financial assets
- Cryptocurrency
- Information/data
- Event-specific commodities

Each commodity should support configurable attributes including:

- Base value
- Current value
- Weight
- Volume
- Rarity
- Legality
- Risk
- Volatility
- Supply
- Demand
- Regional preferences
- Shelf life
- Storage requirements
- Availability
- Unlock conditions
- Market types
- Event modifiers

Build a commodity registry/data-driven architecture.

Do not hard-code commodity behavior individually where generic systems can handle it.

---

# 8. WORLD AND GEOGRAPHY

Implement an expandable node-based world graph.

Locations may represent:

- Cities
- Ports
- Airports
- Trading hubs
- Industrial centers
- Financial centers
- Rural regions
- Border regions
- Hidden markets
- Underground markets
- Special locations

Locations must be capable of having different:

- Economies
- Commodity availability
- Laws
- Taxes
- Factions
- Security
- Risk
- Demand profiles
- Financial services
- Infrastructure
- Events
- Political conditions

Travel should account for:

- Distance
- Time
- Cost
- Transportation type
- Risk
- Route conditions
- Fuel/maintenance where appropriate
- Borders
- Customs
- Enforcement
- Events
- Route disruptions

Support:

- Discoverable locations
- Hidden locations
- Dynamic routes
- Border closures
- Lockdowns
- Sanctions
- Wars
- Travel events

New locations must be addable without rewriting core travel/economy systems.

---

# 9. FINANCE AND DEBT

Implement a complete financial ecosystem.

Include:

- Traditional banking
- Loans
- Loan sharks
- Criminal lenders
- Credit limits
- Creditworthiness
- Credit scores
- Variable interest rates
- Simple interest where appropriate
- Compound interest
- Payment schedules
- Collateral
- Refinancing
- Multiple loans
- Business financing
- Investor funding
- Investments
- Stocks
- Bonds
- Cryptocurrency
- Passive income
- Offshore financial structures
- Transaction fees
- Taxation
- Financial investigations
- Money laundering systems
- Laundering fees
- Laundering risk
- Financial restrictions

Debt must have escalating consequences.

Possible consequences:

- Increasing interest
- Collection attempts
- Asset seizure
- Reputation damage
- Reduced financial access
- Criminal pressure
- Forced events
- Legal consequences
- Bankruptcy
- Configurable game-ending outcomes

Finance must react to:

- Inflation
- Interest rates
- Player reputation
- Global economic conditions
- Market conditions
- Political/world events

---

# 10. STOCK MARKET

Implement a simulated stock market.

Support:

- Multiple companies
- Industries/sectors
- Share prices
- Market trends
- Dividends
- Corporate performance
- Market sentiment
- Speculation
- Crashes
- Bubbles
- Mergers/acquisitions
- Company failures
- World-event impacts

Stock prices should be connected to broader economic conditions.

---

# 11. CRYPTOCURRENCY

Implement a simulated cryptocurrency ecosystem.

Support:

- Multiple assets
- Different volatility profiles
- Exchanges
- Market prices
- Trading
- Liquidity
- Market sentiment
- Speculation
- Crashes
- Bubbles
- Technological events
- Regulatory events
- Staking/mining-like mechanics where appropriate
- Integration with the wider economy

Crypto must not simply be a reskinned commodity market.

---

# 12. DIGITAL / UNDERGROUND ECONOMY

Implement fictionalized underground digital markets.

Support:

- Anonymous transactions
- Digital currencies
- Information/data markets
- Digital identity/reputation
- Underground marketplaces
- Cybersecurity risk
- Hacking-related gameplay mechanics
- Digital financial networks

Keep these as game mechanics rather than real-world operational instructions for wrongdoing.

---

# 13. INVENTORY AND LOGISTICS

Implement meaningful inventory management.

Support:

- Personal capacity
- Weight
- Volume
- Containers
- Equipment
- Vehicles
- Vehicle upgrades
- Trucks/freighters
- Warehouses
- Safehouses
- Specialized storage
- Refrigerated storage
- Security
- Theft
- Seizure
- Destruction
- Insurance
- Contraband detection
- Hidden compartments
- Supply chains
- Shipment tracking
- Automated transportation
- Logistics managers
- Multiple simultaneous shipments
- Fuel
- Maintenance
- Vehicle damage

The player's progression should naturally evolve:

```text
Small Trader
→ Vehicle Trader
→ Warehouse Operator
→ Multi-location Logistics Network
→ Automated Supply Network
→ Large Economic Empire
```

Inventory management must be a strategic decision rather than an arbitrary item counter.

---

# 14. PERMANENT INFRASTRUCTURE

Implement persistent property and infrastructure ownership.

Include:

- Safehouses
- Warehouses
- Offices
- Commercial properties
- Retail businesses
- Factories
- Farms/resource operations
- Distribution centers
- Transportation hubs
- Financial facilities
- Entertainment businesses
- Research facilities
- Technology facilities
- Underground facilities
- Offshore assets
- Real-estate portfolios

Properties must support:

- Acquisition
- Construction
- Upgrades
- Operating expenses
- Maintenance
- Security
- Staff
- Storage
- Production
- Income
- Dynamic valuation
- Damage
- Raids/seizures
- Insurance
- Location advantages

---

# 15. PRODUCTION AND SUPPLY CHAINS

Support interconnected production.

Example:

```text
Resources
    ↓
Processing
    ↓
Manufacturing
    ↓
Storage
    ↓
Distribution
    ↓
Retail
    ↓
Revenue
```

Production should support:

- Inputs
- Outputs
- Capacity
- Labor
- Energy/resources where appropriate
- Costs
- Efficiency
- Quality
- Storage
- Transportation
- Market demand
- Automation
- Upgrades
- Disruption
- Maintenance

Production chains must interact with the economic simulation.

---

# 16. CREW AND EMPLOYEES

Support a large range of personnel:

- Security
- Mercenaries
- Drivers
- Pilots
- Traders
- Brokers
- Warehouse workers
- Logistics managers
- Business managers
- Accountants
- Lawyers
- Financial specialists
- Intelligence specialists
- Technical specialists
- Researchers
- Production workers
- Sales staff
- Marketing staff
- Fixers
- Negotiators
- Faction contacts
- Contractors

Personnel should have configurable:

- Skills
- Stats
- Experience
- Levels
- Salary
- Upkeep
- Loyalty
- Morale
- Relationships
- Abilities
- Equipment
- Training
- Promotions
- Injuries
- Departure
- Retirement
- Corruption/betrayal risk
- Personal objectives

---

# 17. MANAGEMENT AND AUTOMATION

Implement hierarchical delegation.

Example:

```text
Player
  ↓
Regional Manager
  ↓
Business Manager
  ↓
Warehouse Manager
  ↓
Workers / Drivers
```

Managers should automate operations.

The player should eventually be able to operate a large empire without manually executing every transaction.

Automated operations should produce:

- Profits
- Losses
- Delays
- Errors
- Events
- Market effects
- Resource consumption
- Personnel effects

Operations must continue as time advances.

---

# 18. PROGRESSION

Implement multi-dimensional progression.

Include:

- XP
- Levels
- Skills
- Skill trees
- Perks
- Reputation
- Criminal reputation
- Legitimate reputation
- Regional reputation
- Crew reputation
- Faction standing
- Titles
- Ranks
- Wealth progression
- Empire progression
- Unlocks
- Missions
- Achievements
- Milestones
- Prestige
- Optional New Game+ / legacy progression

Potential specializations include:

- Trading
- Finance
- Logistics
- Combat
- Diplomacy
- Technology
- Legitimate business
- Criminal operations

Player choices should have meaningful consequences.

However:

## NEVER hard-lock the player permanently out of major gameplay systems merely because of an earlier choice.

Choices should alter:

- Costs
- Relationships
- Reputation
- Risk
- Available opportunities
- Event probabilities
- Faction attitudes
- Strategic conditions

But the player should retain the ability to eventually pursue other intended gameplay paths.

---

# 19. COMBAT AND ENFORCEMENT

Implement a hybrid combat system.

Routine encounters can be efficiently resolved.

Major encounters can transition into tactical gameplay.

Support:

- Turn-based tactical combat
- Skill checks
- Automated resolution
- Player-controlled combat
- Police encounters
- Rival organizations
- Faction warfare
- Ambushes
- Warehouse raids
- Safehouse raids
- Vehicle pursuits
- Negotiation
- Bribery
- Intimidation
- Escape
- Arrest
- Imprisonment
- Injuries
- Equipment effects
- Crew participation
- Enemy archetypes
- Difficulty levels
- Elite/boss encounters
- Non-combat resolutions

Combat outcomes should be affected by:

- Skills
- Equipment
- Crew
- Reputation
- Location
- Faction relationships
- World events
- Preparation

---

# 20. EVENT ENGINE

Implement a hybrid intelligent event engine.

Events should combine:

- Simulation conditions
- Probability
- World state
- Player state
- Location
- Faction conditions
- Economic indicators
- Historical event state
- Controlled randomness

Support:

- Local events
- Regional events
- National/global events
- Faction wars
- Government changes
- Border closures
- Crackdowns
- Economic crises
- Shortages
- Surpluses
- Natural disasters
- Supply disruptions
- Strikes
- Sanctions
- Currency crises
- Celebrity-driven demand
- Viral trends
- Technology breakthroughs
- Corporate events
- Bank failures
- Cyber events
- Competitor actions
- Rival wars
- Leadership changes
- New laws
- Market opportunities
- Hidden opportunities
- Player-specific events
- Chain-reaction events

Events must be capable of creating secondary effects.

Example:

```text
Global event
→ Supply disruption
→ Commodity shortage
→ Price increase
→ Consumer behavior change
→ Company revenue changes
→ Stock market reaction
→ Currency movement
→ Financing changes
→ Player opportunities
```

---

# 21. WORLD SIMULATION

Build a simulation layer that continuously tracks:

- Economy
- Markets
- Companies
- Factions
- Governments
- Competitors
- Supply chains
- Production
- Financial systems
- Employment
- Infrastructure
- World events
- Player empire

The world should feel alive rather than existing solely to react to the player.

---

# 22. REPUTATION AND FACTIONS

Support multiple independent reputation dimensions.

Examples:

- Global reputation
- Local reputation
- Legal reputation
- Criminal reputation
- Business reputation
- Faction reputation
- Crew reputation

Factions should have:

- Goals
- Resources
- Relationships
- Territories
- Economic interests
- Rivalries
- Alliances
- Reputation requirements
- Dynamic actions

Faction behavior should react to world conditions and player actions.

---

# 23. USER INTERFACE

The visual design must combine:

## MODERN FINANCIAL DASHBOARD

with

## MODERN STRATEGY GAME

Do NOT make the UI look like a basic CRUD admin panel.

Create a polished commercial game interface.

Primary UI areas should include:

- Main dashboard
- World/map view
- Market browser
- Commodity details
- Price history
- Economic indicators
- Portfolio
- Banking
- Investments
- Crypto
- Inventory
- Vehicles
- Logistics
- Properties
- Businesses
- Production
- Crew
- Factions
- Reputation
- Missions
- Combat
- Event/news feed
- Notifications
- Settings

Use:

- Charts
- Tables
- Cards
- Tooltips
- Data visualization
- Contextual information
- Filters
- Sorting
- Search
- Responsive navigation
- Clear information hierarchy

---

# 24. RESPONSIVE UX

The game must work across:

- Desktop
- Tablet
- Mobile

Do not merely shrink the desktop interface.

Create responsive layouts appropriate for each screen size.

Support:

- Touch
- Mouse
- Keyboard
- Mobile navigation
- Responsive tables
- Collapsible panels
- Mobile-friendly charts
- Accessible controls

Build the interface as a serious responsive application.

---

# 25. PWA

Implement PWA readiness.

Include appropriate:

- Manifest
- Icons
- Installability
- Responsive behavior
- Offline-aware architecture where practical
- Service worker architecture where appropriate

Do not compromise authoritative server state merely to support offline functionality.

---

# 26. DATABASE

Use PostgreSQL/Supabase appropriately.

Design a normalized and scalable schema.

Use:

- Foreign keys
- Constraints
- Indexes
- Transactions
- Migrations
- Appropriate JSON structures only where justified
- Audit/history tables where necessary

Potential domains include:

```text
users
profiles
games
game_states
worlds
locations
routes
commodities
markets
market_history
transactions
inventory
vehicles
properties
businesses
production
employees
crews
factions
reputation
loans
bank_accounts
investments
stocks
crypto_assets
events
missions
combat
progression
skills
achievements
notifications
save_versions
```

Do not blindly use these exact tables if a better normalized design exists.

---

# 27. SAVE SYSTEM

Implement robust save architecture.

Support:

- Cloud saves
- Persistent game state
- Save versions
- Migration
- Recovery
- Validation
- Conflict-safe updates
- Transactional persistence

Game state must not depend exclusively on client-side local state.

Critical state must be validated server-side.

---

# 28. FUTURE MULTIPLAYER ARCHITECTURE

Do not implement unnecessary multiplayer functionality now.

However, separate:

- Player state
- World state
- Simulation state
- Transactions
- Events
- Market state

so future multiplayer can be added.

Avoid assumptions that every game state object belongs permanently to one client.

---

# 29. SECURITY

Implement production-grade security appropriate to the application.

Include:

- Authentication
- Authorization
- Server-side validation
- Input validation
- Secure database policies
- Rate limiting where appropriate
- Secure secrets
- Protection against transaction manipulation
- Protection against client-side economic cheating
- Secure save handling
- Auditability of important financial/game-state operations

Never trust the browser for authoritative calculations.

---

# 30. DETERMINISTIC SIMULATION

Where appropriate, simulation calculations should be reproducible.

Use controlled/random seeds for:

- Events
- Market volatility
- Procedural generation
- Encounters
- Other appropriate random systems

Separate random number generation from business logic where practical.

This will make testing and debugging possible.

---

# 31. BALANCING SYSTEM

Centralize balancing parameters.

Examples:

```text
economic constants
market volatility
interest rates
inflation
commodity rarity
travel costs
travel risk
combat difficulty
employee salaries
property costs
production rates
event probabilities
reputation effects
progression XP
```

Do not scatter these values throughout the application.

Make them configurable and data-driven.

---

# 32. PERFORMANCE

The architecture must support:

- 500+ commodities
- Large location networks
- Many businesses
- Many employees
- Large inventories
- Extensive market history
- Complex event state
- Long-running saves
- Large simulation state

Avoid unnecessary recalculation.

Use:

- Efficient queries
- Indexes
- Caching where appropriate
- Aggregation
- Background processing
- Incremental simulation
- Pagination
- Lazy loading
- Appropriate client state management

Do not prematurely optimize at the expense of maintainability.

---

# 33. STATE MANAGEMENT

Separate:

### Persistent game state

from:

### Simulation state

from:

### UI state

from:

### Temporary interaction state

Use a predictable state architecture.

Avoid prop-drilling and uncontrolled global state.

---

# 34. API ARCHITECTURE

Create clear service/API boundaries.

Use strongly typed contracts.

Validate:

- Requests
- Parameters
- Authentication
- Authorization
- Game-state transitions
- Financial operations
- Inventory changes
- Transactions
- Progression changes

Never allow the client to directly dictate authoritative values such as:

```text
money
XP
inventory quantity
market price
property ownership
loan balance
combat result
reputation
```

---

# 35. TESTING

Do not stop after implementation.

Run:

- Type checks
- Linting
- Unit tests
- Integration tests
- End-to-end tests
- Database tests
- API tests
- Economic simulation tests
- Save/load tests
- Security validation
- Responsive/build validation

Create meaningful tests for critical systems.

Especially test:

- Supply/demand calculations
- Market changes
- Inflation
- Interest
- Loans
- Transactions
- Inventory
- Travel
- Combat
- Progression
- Reputation
- Events
- Production
- Automation
- Save/load
- Server-authoritative validation

If tests reveal failures, fix them.

Do not simply report failures and continue.

---

# 36. ECONOMIC TESTING

Create simulation tests capable of detecting obvious balance failures.

Test scenarios such as:

- Infinite-money exploits
- Guaranteed arbitrage
- Negative-price bugs
- Infinite inventory
- Interest calculation errors
- Impossible production chains
- Broken supply/demand loops
- Currency creation exploits
- Transaction duplication
- Save duplication
- XP duplication
- Automated-business exploits

---

# 37. ERROR HANDLING

Implement robust error handling.

Errors should:

- Be logged appropriately
- Be visible to developers
- Provide useful user feedback
- Avoid exposing sensitive information
- Fail safely
- Preserve save integrity where possible

---

# 38. OBSERVABILITY

Implement useful developer diagnostics.

Include appropriate:

- Structured logging
- Simulation diagnostics
- Transaction logging
- Error reporting hooks
- Development debug tools
- Economy inspection tools
- Event inspection tools

The architecture should make it possible to understand why a market price, event, transaction, or simulation outcome occurred.

---

# 39. DATA-DRIVEN DESIGN

Prefer registries/configuration/data definitions over hard-coded logic.

Examples:

```text
CommodityRegistry
LocationRegistry
FactionRegistry
EventRegistry
SkillRegistry
PerkRegistry
VehicleRegistry
PropertyRegistry
BusinessRegistry
ProductionRecipeRegistry
EnemyRegistry
```

This is essential for future expansion.

---

# 40. UI INFORMATION DESIGN

The player must be able to understand complex systems.

Whenever possible expose:

- Why something changed
- What caused a price movement
- Why a loan changed
- Why a route became dangerous
- Why a business lost money
- Why a reputation score changed
- Why an event occurred
- What an employee is doing
- What an automated system is producing
- What risks are currently active

Do not hide critical strategic information behind unexplained numbers.

---

# 41. NEWS / INFORMATION SYSTEM

Implement a dynamic information/news feed that communicates world changes.

News should surface:

- Market changes
- Political/economic events
- Commodity shortages
- Corporate news
- Faction activity
- Travel disruptions
- Financial changes
- Local events
- Global events

Information should become a strategic resource.

---

# 42. PLAYER EXPERIENCE

The game should create a progression feeling similar to:

```text
"I am trying to survive."
        ↓
"I understand the markets."
        ↓
"I can exploit arbitrage."
        ↓
"I have reliable income."
        ↓
"I own assets."
        ↓
"I control supply chains."
        ↓
"I operate across regions."
        ↓
"I influence markets."
        ↓
"I manage a major economic empire."
```

The player should feel increasingly powerful without eliminating meaningful strategic risk.

---

# 43. EXTENSIBILITY

Every major system must be designed for future expansion.

It should be possible to add:

- More commodities
- More locations
- More factions
- More events
- More businesses
- More properties
- More employees
- More vehicles
- More financial instruments
- More skills
- More missions
- More combat systems
- More world mechanics

without rewriting the fundamental engine.

---

# 44. CODE QUALITY

Use production-quality code.

Requirements:

- Strict TypeScript
- Clear naming
- Small cohesive modules
- Strong domain boundaries
- Reusable components
- Reusable services
- No unnecessary duplication
- No dead code
- No fake implementations
- No placeholder business logic
- No "TODO: implement later" for core functionality
- No mocked functionality presented as complete
- No hard-coded fake backend responses
- No static dashboard pretending to be a functioning simulation

---

# 45. EXISTING REPOSITORY

Before changing the repository:

1. Inspect the existing project.
2. Identify the existing framework.
3. Identify existing database configuration.
4. Identify Supabase configuration.
5. Identify authentication.
6. Identify existing components.
7. Identify existing routes.
8. Identify existing game logic.
9. Reuse existing infrastructure where appropriate.
10. Avoid destroying working functionality unnecessarily.

Adapt this specification to the repository rather than blindly replacing useful existing architecture.

If an existing system already satisfies part of the specification, improve and integrate it rather than duplicating it.

---

# 46. ENVIRONMENT AND SECRETS

Respect existing environment configuration.

Do not hard-code:

- API keys
- Database passwords
- Authentication secrets
- Service-role keys
- Private credentials

Use appropriate environment variables.

Ensure development and production configurations remain separable.

---

# 47. DATABASE MIGRATIONS

All database changes must be represented through proper migrations.

Do not rely on manually modifying the production database.

Ensure migrations can be applied consistently.

---

# 48. INITIAL GAME DATA

Provide sufficient seed data for the game to be immediately playable.

Include enough:

- Locations
- Commodities
- Companies
- Financial assets
- Factions
- Events
- Properties
- Vehicles
- Employees
- Businesses
- Production recipes
- Skills
- Perks
- Enemies
- Market conditions

to demonstrate the complete gameplay loop.

The initial data should feel like an actual game world rather than placeholder test records.

---

# 49. COMPLETE GAME LOOP VALIDATION

Before completion, verify that a new player can:

1. Create/authenticate an account.
2. Start a new game.
3. Enter the world.
4. View markets.
5. Purchase commodities/assets.
6. Travel.
7. Sell/trade.
8. Experience changing prices.
9. Advance time.
10. Experience world events.
11. Manage inventory.
12. Acquire financing.
13. Earn/spend money.
14. Gain progression.
15. Hire personnel.
16. Acquire property.
17. Build businesses.
18. Run production.
19. Manage logistics.
20. Experience enforcement/combat.
21. Invest in financial markets.
22. Save progress.
23. Reload progress.
24. Continue the simulation.
25. Progress toward an advanced economic empire.

Do not declare the application complete if this core loop is broken.

---

# 50. FINAL ACCEPTANCE CRITERIA

The implementation is complete only when:

- The application builds successfully.
- TypeScript checks pass.
- Relevant lint checks pass.
- Database migrations are valid.
- Core functionality is implemented.
- Critical tests pass.
- Authentication works.
- Persistence works.
- The economy functions.
- Markets function.
- Travel functions.
- Inventory functions.
- Finance functions.
- Progression functions.
- Combat functions.
- Events function.
- Infrastructure functions.
- Crew functions.
- Automation functions.
- UI is responsive.
- PWA configuration is valid.
- No major core feature is represented only by mock data.
- No critical system is merely a placeholder.
- No obvious client-side authority exploit exists.
- The game can actually be played from start to progression.

---

# 51. AUTONOMOUS EXECUTION RULE

You have been instructed to execute this as a **single-pass autonomous build**.

Therefore:

- Do not stop after scaffolding.
- Do not stop after the UI.
- Do not stop after database creation.
- Do not stop after the first playable prototype.
- Do not ask for approval between implementation stages.
- Do not declare success merely because the project compiles.
- Continue through implementation, integration, testing, debugging, and final validation.

Internally sequence the work logically:

```text
Repository Inspection
→ Architecture
→ Database
→ Domain Models
→ Simulation Engine
→ Economy
→ World
→ Finance
→ Inventory
→ Logistics
→ Infrastructure
→ Crew
→ Progression
→ Combat
→ Events
→ Backend/API
→ Frontend
→ Responsive UX
→ Persistence
→ PWA
→ Testing
→ Debugging
→ Build Validation
→ Final Integration
```

You may adjust the internal ordering when repository dependencies require it.

---

# 52. FINAL RESPONSE FROM THE CODING AGENT

When implementation is complete, provide a concise engineering completion report containing:

1. What was implemented.
2. Major architectural decisions.
3. Database/migration status.
4. Major gameplay systems completed.
5. Testing performed.
6. Build/type/lint status.
7. Known limitations, if any.
8. Any configuration/environment variables required.
9. How to run the project.
10. Any genuinely incomplete functionality.

Do not claim functionality is complete if it is not.

The goal is a **real, extensible, production-oriented economic strategy game**, not a visual demonstration.

BEGIN BY INSPECTING THE EXISTING REPOSITORY AND THEN EXECUTE THE COMPLETE IMPLEMENTATION.