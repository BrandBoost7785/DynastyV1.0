/**
 * Read models — the query side of the API.
 *
 * Every entry here is a *projection* over the authoritative state that already
 * exists in `src/sim/**`. Nothing in this file computes an economic value, rolls a
 * die, or invents a number: it calls the same view function the simulation itself
 * uses to describe itself, and returns the result under a typed key.
 *
 * That is the whole point of the registry. The UI never needs to be trusted with
 * game rules, and it never needs to re-derive a market price, a portfolio
 * valuation or a mission board — it asks the server for the view and renders it.
 *
 * Views that need a parameter (`market` wants a location, `stocks` wants a filter)
 * read it from the query string; anything malformed falls back to the player's own
 * context rather than erroring, because a bad filter should not break a screen.
 */
import type { GameState } from '../../sim/types';
import { automationView } from '../../sim/automation';
import { businessCatalogue, businessPortfolioSummary, businessViews } from '../../sim/businesses';
import { combatView } from '../../sim/combat';
import { candidateViews, crewSummary, employeeViews, payrollForecast, spanOfControl } from '../../sim/crew';
import { cryptoMarketView, cryptoPortfolioRisk, listExchanges, rigCatalogue } from '../../sim/crypto';
import { accountViews, creditScoreView, debtSummary, financeView } from '../../sim/finance';
import { factionInterestSummary, factionOverview, factionViews } from '../../sim/factions';
import { inventorySummary } from '../../sim/inventory';
import { logisticsView, shipmentViews, vehicleListings } from '../../sim/logistics';
import { tradeNetworkView } from '../../sim/trade-network';
import { locationMarketSummary, marketRows, type MarketListOptions } from '../../sim/markets';
import { getCommodityRegistry } from '../../engine/registry';
import { missionBoard } from '../../sim/missions';
import { achievementProgress, canLearnSkill, canTakePerk, progressionSummary, respecCost } from '../../sim/progression';
import { PERKS, SKILLS } from '../../engine/registry/people';
import { propertyListings, propertyPortfolioSummary, propertyViews } from '../../sim/properties';
import { portfolioRisk, stockMarketView } from '../../sim/stocks';
import { availableModes, destinationList, journeyView, planTravel } from '../../sim/travel';
import { availableRecipes, bufferSummary, lineViews, supplyChainSummary } from '../../sim/production';
import { getWorldRegistry } from '../../engine/registry';
import { computeNetWorth } from '../../sim/state';
import { BALANCE } from '../../config/balance';
import type { TravelMode } from '../../sim/types';
import { darknetListings, darknetMarketViews, undergroundView } from '../../sim/underground';
import { computeIndicators } from '../../sim/world';
import { DTO_LIMITS, publicPlayer, publicTradeNetwork, publicTransaction, worldDto } from '../dto';

/** Query parameters accepted by a view. Values arrive as strings and are parsed here. */
export type ViewParams = URLSearchParams;

function str(params: ViewParams, key: string): string | undefined {
  const value = params.get(key)?.trim();
  return value ? value.slice(0, 64) : undefined;
}

/**
 * Read an integer query parameter.
 *
 * A missing (or blank) parameter must fall back: `Number(null)` is `0`, which is
 * finite, so a naive implementation silently clamps every defaulted limit down to
 * its minimum — `?limit` absent meant one row on the market, the ledger, the stock
 * list and a *zero-length* notification tail on the profile. Treating absence as
 * absence is the only correct reading, and `tests/api.test.ts` pins it.
 */
function int(params: ViewParams, key: string, fallback: number, min: number, max: number): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function bool(params: ViewParams, key: string): boolean | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

export interface ViewContext {
  /** The location the view is scoped to; defaults to where the player is standing. */
  locationId: string;
}

export interface ViewDefinition {
  /** One-line description, surfaced by the view index so the client can discover them. */
  description: string;
  /** Query parameters the view understands, for self-documentation. */
  params?: readonly string[];
  /** Builds the payload. Must be pure: no mutation of `state`. */
  build: (state: GameState, params: ViewParams, ctx: ViewContext) => unknown;
}

/**
 * Every read model the API exposes.
 *
 * Adding a view is a one-line change here — deliberately, because the alternative
 * (a bespoke route per screen) is how an API drifts away from its own domain layer.
 */
export const VIEWS: Record<string, ViewDefinition> = {
  market: {
    description: 'Tradeable commodities at a location, with the server\'s own price, spread and holdings columns.',
    params: ['locationId', 'category', 'search', 'legality', 'sort', 'limit', 'onlyTradable', 'onlyHoldings', 'includeHidden'],
    build: (state, params, ctx) => {
      const locationId = str(params, 'locationId') ?? ctx.locationId;
      const options: MarketListOptions = {
        sort: (str(params, 'sort') as MarketListOptions['sort']) ?? 'name',
        limit: int(params, 'limit', 120, 1, 400),
      };
      const category = str(params, 'category');
      const search = str(params, 'search');
      const legality = str(params, 'legality');
      const onlyTradable = bool(params, 'onlyTradable');
      const onlyHoldings = bool(params, 'onlyHoldings');
      const includeHidden = bool(params, 'includeHidden') === true && state.player.underground.accessUnlocked;
      if (category) options.category = category;
      if (search) options.search = search;
      if (legality) options.legality = legality;
      if (onlyTradable !== undefined) options.onlyTradable = onlyTradable;
      if (onlyHoldings !== undefined) options.onlyHoldings = onlyHoldings;
      // Hidden channels are only revealed once darknet access has been bought; the
      // client cannot opt into a channel the player has not unlocked.
      if (includeHidden) options.includeHidden = true;
      return {
        locationId,
        rows: marketRows(state, locationId, options),
        summary: locationMarketSummary(state, locationId),
      };
    },
  },

  location: {
    description: 'Where the player stands: the location profile, its services, its laws and its local market conditions.',
    params: ['locationId'],
    build: (state, params, ctx) => {
      const id = str(params, 'locationId') ?? ctx.locationId;
      const def = getWorldRegistry().location(id);
      if (!def) return null;
      const live = state.world.locations[id];
      return {
        id: def.id,
        name: def.name,
        country: def.countryName,
        region: def.regionName,
        kind: def.kind,
        description: def.description,
        map: def.map,
        population: def.population,
        economy: def.economy,
        security: def.security,
        risk: def.risk,
        laws: def.laws,
        services: def.financialServices,
        specialties: def.specialties.map((sid) => ({ id: sid, name: getCommodityRegistry().get(sid)?.name ?? sid })),
        isCurrent: id === state.player.locationId,
        lockdown: live?.lockdown ?? false,
        playerHeat: live?.playerHeat ?? 0,
        discovered: !def.hidden || (live?.discovered ?? false),
        market: locationMarketSummary(state, id),
      };
    },
  },

  finance: {
    description: 'Accounts, loans, credit, laundering fronts, tax position and net worth.',
    build: (state) => ({
      finance: financeView(state),
      accounts: accountViews(state),
      credit: creditScoreView(state),
      debt: debtSummary(state),
    }),
  },

  stocks: {
    description: 'Listed companies, the player\'s holdings, and portfolio risk.',
    params: ['sector', 'search', 'limit'],
    build: (state, params) => {
      const sector = str(params, 'sector');
      const search = str(params, 'search');
      return {
        market: stockMarketView(state, {
          ...(sector ? { sector } : {}),
          ...(search ? { search } : {}),
          limit: int(params, 'limit', 60, 1, 200),
        }),
        risk: portfolioRisk(state),
      };
    },
  },

  crypto: {
    description: 'Crypto market, holdings, exchanges, mining rigs and portfolio risk.',
    params: ['kind', 'search'],
    build: (state, params) => {
      const kind = str(params, 'kind');
      const search = str(params, 'search');
      return {
        market: cryptoMarketView(state, { ...(kind ? { kind } : {}), ...(search ? { search } : {}) }),
        risk: cryptoPortfolioRisk(state),
        exchanges: listExchanges(state),
        rigs: rigCatalogue(state),
      };
    },
  },

  automation: {
    description: 'Delegation rules, their managers, uptime and projected budget.',
    build: (state) => automationView(state),
  },

  missions: {
    description: 'Contract board: offers, active contract, history and locked opportunities.',
    build: (state) => missionBoard(state),
  },

  combat: {
    description: 'The live tactical encounter, or null when nothing is in progress.',
    build: (state) => combatView(state),
  },

  underground: {
    description: 'Darknet access, markets the player has discovered, data assets and escrow.',
    params: ['marketId', 'search', 'category', 'qty'],
    build: (state, params) => {
      const marketId = str(params, 'marketId');
      const search = str(params, 'search');
      const category = str(params, 'category');
      return {
        view: undergroundView(state),
        markets: darknetMarketViews(state),
        listings: marketId
          ? darknetListings(state, marketId, {
              ...(search ? { search } : {}),
              ...(category ? { category } : {}),
              qty: int(params, 'qty', 1, 1, 10_000),
            })
          : [],
      };
    },
  },

  factions: {
    description: 'Faction standing, offers, services and the player\'s interests.',
    build: (state) => ({
      factions: factionViews(state),
      overview: factionOverview(state),
      interests: Object.fromEntries(factionViews(state).map((f) => [f.id, factionInterestSummary(f.id)])),
    }),
  },

  inventory: {
    description: 'Every stack the player owns, with per-storage capacity usage.',
    params: ['search', 'category'],
    build: (state, params) => {
      const summary = inventorySummary(state);
      const search = str(params, 'search')?.toLowerCase();
      const category = str(params, 'category');
      return search || category
        ? { ...summary, rows: summary.rows.filter((row) => (!category || row.category === category) && (!search || row.name.toLowerCase().includes(search))) }
        : summary;
    },
  },

  progression: {
    description: 'Level, XP, skills, perks, titles, achievements and prestige state, with the learnable catalogue.',
    build: (state) => {
      const summary = progressionSummary(state);
      const learned = new Map(summary.skills.map((s) => [s.id, s.level]));
      const taken = new Set(summary.perks.map((p) => p.id));
      const cfg = BALANCE.progression.prestige;
      return {
        ...summary,
        // The catalogue carries the server's own verdict (`canLearnSkill` / `canTakePerk`)
        // so the UI never has to re-implement a prerequisite rule to grey out a button.
        skillCatalogue: SKILLS.map((def) => {
          const check = canLearnSkill(state, def.id);
          return {
            id: def.id,
            name: def.name,
            description: def.description,
            tree: def.tree,
            maxLevel: def.maxLevel,
            level: learned.get(def.id) ?? 0,
            effectPerLevel: def.effectPerLevel,
            prerequisites: def.prerequisites.map((pre) => ({ skillId: pre.skillId, level: pre.level })),
            canLearn: check.ok,
            reason: check.reason ?? null,
          };
        }),
        perkCatalogue: PERKS.map((def) => ({
          id: def.id,
          name: def.name,
          description: def.description,
          tree: def.tree,
          modifiers: def.modifiers,
          requiresSkillId: def.requiresSkill?.skillId ?? null,
          requiresSkillLevel: def.requiresSkill?.level ?? null,
          taken: taken.has(def.id),
          canTake: canTakePerk(state, def.id).ok,
          reason: canTakePerk(state, def.id).reason ?? null,
        })),
        achievements: achievementProgress(state),
        respecCost: respecCost(state),
        // Facts and configured thresholds, never a client-side eligibility decision:
        // the handover itself is validated by the `progression.prestige` intent.
        prestigeFacts: {
          count: summary.prestigeCount,
          lastPrestigeDay: state.player.progression.lastPrestigeDay,
          day: state.world.day,
          legacyBonus: summary.legacyBonus,
          legacyBonusCap: cfg.legacyBonusCap,
          maxPrestiges: cfg.maxPrestiges,
          minDaysBetween: cfg.minDaysBetween,
          netWorthRequirement: cfg.netWorthRequirement,
          requireDebtsSettled: cfg.requireDebtsSettled,
          netWorth: computeNetWorth(state).total,
          outstandingDebt: state.player.loans.reduce((sum, loan) => sum + loan.balance, 0),
        },
      };
    },
  },

  destinations: {
    description: 'The world graph as the player knows it: map nodes, route edges, priced destinations and the mode picker.',
    params: ['mode', 'search', 'toId', 'limit'],
    build: (state, params, ctx) => {
      const registry = getWorldRegistry();
      const mode = (str(params, 'mode') as TravelMode | undefined) ?? 'bus';
      const search = str(params, 'search');
      const toId = str(params, 'toId');
      const limit = int(params, 'limit', 0, 0, 200);
      // `travelling` is what the player already knows about; hidden locations only appear
      // once discovered, so the map never reveals a route the character has not found.
      const discoveries = state.world.locations;
      const known = (id: string): boolean => {
        const def = registry.location(id);
        if (!def || !def.hidden) return true;
        return discoveries[id]?.discovered ?? false;
      };
      const nodes = registry.locations
        .filter((l) => known(l.id))
        .map((l) => ({
          id: l.id,
          name: l.name,
          country: l.countryName,
          region: l.regionName,
          kind: l.kind,
          map: l.map,
          here: l.id === state.player.locationId,
          traded: l.tradedCommodityIds.length,
          lockdown: discoveries[l.id]?.lockdown ?? false,
          services: {
            bank: l.financialServices.bank,
            stockExchange: l.financialServices.stockExchange,
            cryptoExchange: l.financialServices.cryptoExchange,
            darknetAccess: l.financialServices.darknetAccess,
            loanSharks: l.financialServices.loanSharks,
            auctionHouse: l.financialServices.auctionHouse,
            offshore: l.financialServices.offshore,
          },
        }));
      const knownSet = new Set(nodes.map((n) => n.id));
      const edges = registry.routes
        .filter((r) => knownSet.has(r.from) && knownSet.has(r.to))
        .map((r) => ({
          id: r.id,
          from: r.from,
          to: r.to,
          distanceKm: r.distanceKm,
          risk: r.baseRisk,
          borderCrossing: r.borderCrossing,
          customsIntensity: r.customsIntensity,
          modes: r.modes,
        }));
      const destinations = destinationList(state, { mode, ...(search ? { search } : {}), ...(limit ? { limit } : {}) });
      const plan = toId ? planFor(state, toId, mode) : null;
      return {
        from: ctx.locationId,
        fromName: registry.location(ctx.locationId)?.name ?? ctx.locationId,
        mode,
        unchartedLocations: registry.locations.length - nodes.length,
        nodes,
        edges,
        destinations,
        modes: toId ? availableModes(state, toId) : [],
        plan,
      };
    },
  },

  businesses: {
    description: 'Owned businesses with their daily result, the portfolio summary and the local franchise catalogue.',
    params: ['locationId'],
    build: (state, params, ctx) => ({
      businesses: businessViews(state),
      portfolio: businessPortfolioSummary(state),
      catalogue: businessCatalogue(state, str(params, 'locationId') ?? ctx.locationId),
    }),
  },

  production: {
    description: 'Production lines, their supply chain and buffers, and the recipes installable at a location.',
    params: ['locationId', 'onlyInstallable'],
    build: (state, params, ctx) => {
      const locationId = str(params, 'locationId') ?? ctx.locationId;
      const onlyInstallable = bool(params, 'onlyInstallable');
      return {
        locationId,
        lines: lineViews(state),
        supplyChain: supplyChainSummary(state),
        buffers: bufferSummary(state),
        recipes: availableRecipes(state, { locationId, ...(onlyInstallable === undefined ? {} : { onlyInstallable }) }),
      };
    },
  },

  properties: {
    description: 'Owned property, listings at a location and the portfolio valuation.',
    params: ['locationId', 'kind', 'search'],
    build: (state, params, ctx) => {
      const locationId = str(params, 'locationId') ?? ctx.locationId;
      const kind = str(params, 'kind');
      const search = str(params, 'search');
      return {
        owned: propertyViews(state),
        portfolio: propertyPortfolioSummary(state),
        listings: propertyListings(state, locationId, { ...(kind ? { kind } : {}), ...(search ? { search } : {}) }),
      };
    },
  },

  logistics: {
    description: 'Vehicles, shipments in transit, the freight overview and rival cargo on the same routes.',
    build: (state) => ({
      view: logisticsView(state),
      shipments: shipmentViews(state),
      listings: vehicleListings(state),
      /*
       * Rival firms' cargo, on the same routes the player uses.
       *
       * Deliberately the *same* view the trade-network system produces, so the
       * number of units inbound to a market is exactly what the simulation will
       * land — never a separate, drifting read model. What is omitted is equally
       * deliberate: an agent's working capital, its profit and its internal scan are
       * server-side competitive state.
       */
      rival: publicTradeNetwork(tradeNetworkView(state)),
    }),
  },

  crew: {
    description: 'Employees, hiring pool, payroll forecast and span of control.',
    build: (state) => ({
      employees: employeeViews(state),
      candidates: candidateViews(state),
      summary: crewSummary(state),
      span: spanOfControl(state),
      payrollForecastPerDay: payrollForecast(state),
    }),
  },

  travel: {
    description: 'The journey in progress, if any.',
    build: (state) => journeyView(state),
  },

  world: {
    description: 'Macro indicators, shocks, active events and recent headlines.',
    build: (state) => ({ indicators: computeIndicators(state.world), world: worldDto(state) }),
  },

  ledger: {
    description: 'The player\'s recent bank ledger, newest last, without integrity internals.',
    params: ['limit'],
    build: (state, params) => {
      const limit = int(params, 'limit', 50, 1, 200);
      const records = state.player.recentTransactions;
      return { total: records.length, rows: records.slice(Math.max(0, records.length - limit)).map(publicTransaction) };
    },
  },

  profile: {
    description: 'The player\'s own state (public projection), their net worth and notifications.',
    params: ['notifications'],
    build: (state, params) => {
      const player = publicPlayer(state.player);
      const notifications = int(params, 'notifications', DTO_LIMITS.notifications, 0, 200);
      return {
        player: { ...player, notifications: player.notifications.slice(Math.max(0, player.notifications.length - notifications)) },
        ending: state.ending,
        day: state.world.day,
      };
    },
  },
};

/**
 * A full travel plan for one destination, or `null` when it cannot be built.
 *
 * `planTravel` is pure and returns a structured refusal (`ok:false` + reason) for an
 * impossible route, so the refusal travels to the client as data rather than as an
 * error — the travel screen needs to *show* why a destination is out of reach.
 */
function planFor(state: GameState, toId: string, mode: TravelMode): ReturnType<typeof planTravel> | null {
  if (!getWorldRegistry().location(toId)) return null;
  return planTravel(state, toId, mode);
}

export type ViewName = keyof typeof VIEWS;

/** Names of every registered view, sorted, with their descriptions. */
export function viewIndex(): { name: string; description: string; params: string[] }[] {
  return Object.entries(VIEWS)
    .map(([name, def]) => ({ name, description: def.description, params: [...(def.params ?? [])] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function isViewName(name: string): name is ViewName {
  return Object.prototype.hasOwnProperty.call(VIEWS, name);
}

/**
 * Build a view. The caller has already authenticated and loaded the state; this
 * function never touches persistence or the network.
 */
export function buildView(state: GameState, name: ViewName, params: ViewParams, ctx: ViewContext): unknown {
  const definition: ViewDefinition | undefined = VIEWS[name];
  if (!definition) throw new Error(`Unknown view "${name}".`);
  return definition.build(state, params, ctx);
}
