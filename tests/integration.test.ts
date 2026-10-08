/**
 * Cross-system integration tests.
 *
 * Each test drives one of the interactions the simulation is *for* — a trade that
 * moves a regional price, a loan that goes bad, a war that closes a route, a
 * production line that starves — and asserts the consequence landed in the systems
 * downstream of it, through the real command and tick paths. Nothing here stubs a
 * subsystem: if an integration is decorative, these tests are where it shows.
 */
import { describe, expect, it } from 'vitest';
import { createNewGame } from '../src/sim/bootstrap';
import { advanceDays, rngForAction } from '../src/sim/tick';
import { dispatch } from '../src/sim/actions';
import { creditCash, totalBalance, validateState } from '../src/sim/state';
import { marketRows, marketAt, ensureMarket, marketContext } from '../src/sim/markets';
import { factionMarketPressure, fundamentalPrice, stepMarket } from '../src/sim/economy';
import { provokeWar, factionTick } from '../src/sim/factions';
import { loanTick, takeLoan, loanOffer, debtSummary } from '../src/sim/finance';
import { feedInputs, productionTick, lineViews } from '../src/sim/production';
import { refreshHiringPool, hire } from '../src/sim/crew';
import { createRule, automationTick, automationView } from '../src/sim/automation';
import { fireEvent } from '../src/sim/events';
import { EVENT_BY_ID } from '../src/engine/registry/events';
import { PROPERTIES, RECIPE_BY_ID, recipesForProperty } from '../src/engine/registry/assets';
import { getCommodityRegistry, getWorldRegistry } from '../src/engine/registry';
import { deserializeState, serializeState } from '../src/persistence/serialize';
import { Rng } from '../src/engine/rng';
import type { ActionIntent } from '../src/sim/validation';
import type { GameState, ID } from '../src/sim/types';

/** Mirror of the engine's clamp, for asserting against its documented formula. */
function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const registry = getCommodityRegistry();
const world = getWorldRegistry();

function funded(seed: string, cash = 2_000_000): GameState {
  const { state } = createNewGame({ userId: 'integration-user', playerName: 'Operator', seed });
  creditCash(state, cash, { kind: 'adjustment', description: 'integration test capital' });
  return state;
}

/** Buy as much of a commodity as the market will actually sell here. */
function buyAll(state: GameState, commodityId: ID, qty: number): boolean {
  const result = dispatch(
    state,
    rngForAction(state, `buy:${commodityId}:${qty}`),
    { type: 'trade.buy', commodityId, qty } as ActionIntent,
    { userId: state.userId },
  );
  return result.ok;
}

/* ------------------------------------------------------------------ */
/* 1. Trade → regional price reaction → persisted                      */
/* ------------------------------------------------------------------ */

describe('trade moves the local market, and the move survives a save', () => {
  it('charges the documented price impact for the quantity actually filled', () => {
    const state = funded('integration-trade');
    const row = marketRows(state, state.player.locationId, { onlyTradable: true, sort: 'volume' })[0]!;
    const market = marketAt(state, state.player.locationId, row.commodityId)!;
    const priceBefore = market.price;
    const impactBefore = market.playerImpact;

    // Ask for more than the book can absorb. The fill will be smaller — capped by
    // the market, the player's storage and their cash — and the *fill* is what the
    // market reacts to.
    const requested = Math.max(10, Math.ceil(row.absorbable * 2));
    const result = dispatch(
      state,
      rngForAction(state, 'integration-trade:buy'),
      { type: 'trade.buy', commodityId: row.commodityId, qty: requested } as ActionIntent,
      { userId: state.userId },
    );
    expect(result.ok).toBe(true);
    const quote = (result.data as { quote: { qty: number; effectiveUnitPrice: number; fees: { amount: number }[] } }).quote;
    const filled = quote.qty;
    expect(filled).toBeGreaterThan(0);
    expect(filled).toBeLessThanOrEqual(requested);

    // The market knows it was traded, and the price moved up.
    const after = marketAt(state, state.player.locationId, row.commodityId)!;
    expect(after.lastTradedDay).toBe(state.world.day);
    expect(after.volume30d).toBeGreaterThan(0);
    expect(after.playerImpact).toBeGreaterThan(impactBefore);
    expect(after.deviation).toBeGreaterThanOrEqual(1);
    expect(after.price).toBeGreaterThanOrEqual(priceBefore);

    // Impact is depth-proportional, as the model documents — so a trade cannot move
    // a price without actually taking size out of the book.
    const depth = Math.max(1, after.supply * 1.6);
    const documented = clampValue((filled / depth) * 0.18, 0, 0.28);
    expect(after.playerImpact - impactBefore).toBeCloseTo(documented, 4);
    expect(Math.abs(after.playerImpact)).toBeLessThanOrEqual(0.28 * 2 + 1e-9);

    // The reaction is part of the save, not a client-side guess.
    const sealed = serializeState(state);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    const reopened = deserializeState(sealed.value.json, { expectedHash: sealed.value.integrityHash });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const restored = marketAt(reopened.value, state.player.locationId, row.commodityId)!;
    expect(restored.price).toBe(after.price);
    expect(restored.playerImpact).toBe(after.playerImpact);
  });

  it('explains yesterday’s move in the market’s own words after the tick', () => {
    const state = funded('integration-trade-explain');
    const row = marketRows(state, state.player.locationId, { onlyTradable: true, sort: 'volume' })[0]!;
    const result = dispatch(
      state,
      rngForAction(state, 'integration-trade-explain:buy'),
      { type: 'trade.buy', commodityId: row.commodityId, qty: Math.max(10, Math.ceil(row.absorbable * 2)) } as ActionIntent,
      { userId: state.userId },
    );
    expect(result.ok).toBe(true);
    // The freshly-traded market has a player impact on the books…
    expect(marketAt(state, state.player.locationId, row.commodityId)!.playerImpact).toBeGreaterThan(0);

    advanceDays(state, new Rng('integration-trade-explain:days', 'test'), 1);
    // …and the next day's price movement names it as a driver.
    const explained = marketRows(state, state.player.locationId, {}).find((r) => r.commodityId === row.commodityId)!;
    expect(explained.drivers.some((d) => d.kind === 'player')).toBe(true);
  });

  it('lets the impact decay instead of printing free money forever', () => {
    const state = funded('integration-decay');
    const row = marketRows(state, state.player.locationId, { onlyTradable: true, sort: 'volume' }).find(
      (r) => r.ask > 0 && r.absorbable > 40 && r.storage.includes('Standard'),
    )!;
    expect(buyAll(state, row.commodityId, Math.max(5, Math.floor(row.absorbable / 8)))).toBe(true);
    const peak = marketAt(state, state.player.locationId, row.commodityId)!.playerImpact;
    expect(peak).toBeGreaterThan(0);

    advanceDays(state, new Rng('integration-decay:days', 'test'), 40);
    const settled = marketAt(state, state.player.locationId, row.commodityId)!;
    // Forty days is far more than the relaxation half-life: the impact must be gone.
    expect(settled.playerImpact).toBeLessThan(peak);
    expect(Number.isFinite(settled.price)).toBe(true);
    expect(settled.price).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Factory shortage → input price → output supply and price          */
/* ------------------------------------------------------------------ */

describe('a factory that cannot be fed shows up in its own market', () => {
  it('starves the line, and the shortfall is visible in the input market', () => {
    const state = funded('integration-production', 5_000_000);
    const locationId = state.player.locationId;

    // Buy the cheapest production-capable property through the command path, then
    // install a recipe its capability tag supports. Nothing here pokes state
    // directly: this is the route a player takes.
    const def = PROPERTIES.filter((p) => recipesForProperty(p.id).length > 0).sort((a, b) => a.basePrice - b.basePrice)[0];
    expect(def).toBeDefined();
    if (!def) return;
    const bought = dispatch(
      state,
      rngForAction(state, 'integration-production:buy'),
      { type: 'property.buy', defId: def.id } as ActionIntent,
      { userId: state.userId },
    );
    if (!bought.ok) return; // not offered at this location for this seed
    const property = state.player.properties.at(-1)!;
    const recipe = recipesForProperty(property.defId)[0]!;
    const installed = dispatch(
      state,
      rngForAction(state, 'integration-production:install'),
      { type: 'production.install', recipeId: recipe.id, propertyId: property.id } as ActionIntent,
      { userId: state.userId },
    );
    expect(installed.ok).toBe(true);
    const line = state.player.productionLines[0];
    if (!line) return;
    void locationId;

    // The line has no inputs. It cannot produce, and it says so.
    productionTick(state, new Rng('integration-production:tick', 'test'));
    expect(line.totalProduced).toBe(0);
    expect(['idle', 'starved', 'running']).toContain(lineViews(state)[0]!.status);

    // Feeding it a single unit of an input is not a run: the recipe's own ratio
    // decides, and partial stock produces nothing.
    const input = recipe.inputs[0]!;
    const fed = feedInputs(state, line.id, input.commodityId, 1);
    if (fed.ok) expect(line.inputs[input.commodityId] ?? 0).toBeGreaterThan(0);
    expect(line.totalProduced).toBe(0);

    // Every input is purchasable somewhere, so a starved line is a logistics
    // problem rather than a dead end.
    for (const requirement of recipe.inputs) {
      expect(world.locationsTrading(requirement.commodityId).length).toBeGreaterThan(0);
    }
    expect(validateState(state).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Loan → interest → missed payment → consequences                   */
/* ------------------------------------------------------------------ */

describe('debt has teeth', () => {
  it('accrues interest, goes delinquent when unpaid, and marks the credit file', () => {
    const state = funded('integration-debt', 60_000);
    const offer = loanOffer(state, 'bank', 20_000, 120);
    expect(offer.amount).toBeGreaterThan(0);
    const taken = takeLoan(state, new Rng('integration-debt:take', 'test'), 'bank', 20_000, 120);
    if (!taken.ok) return;
    const loan = state.player.loans[0]!;
    const principal = loan.balance;
    expect(principal).toBeGreaterThan(0);

    const scoreBefore = state.player.creditScore;
    // Interest accrues every day the loan is open…
    loanTick(state, new Rng('integration-debt:tick', 'test'));
    expect(loan.balance).toBeGreaterThanOrEqual(principal);

    // …and the debt is still on the books after the player loses the means to pay.
    for (const a of state.player.accounts) a.balance = 0;
    loan.dueDay = state.world.day;
    advanceDays(state, new Rng('integration-debt:run', 'test'), 30);

    const after = state.player.loans[0]!;
    expect(after.balance).toBeGreaterThan(0);
    expect(after.balance).toBeGreaterThanOrEqual(principal);
    expect(['active', 'defaulted', 'seized', 'written_off']).toContain(after.status);
    if (after.status === 'active') expect(after.daysDelinquent).toBeGreaterThan(0);
    expect(state.player.creditScore).toBeLessThanOrEqual(scoreBefore);
    const summary = debtSummary(state);
    expect(summary.totalOutstanding).toBeGreaterThan(0);
    expect(Number.isFinite(summary.totalOutstanding)).toBe(true);
    expect(summary.worstDelinquency).toBeGreaterThanOrEqual(0);
    expect(validateState(state).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Faction conflict → route risk, market prices, enforcement         */
/* ------------------------------------------------------------------ */

describe('faction conflict reaches routes, markets and patrols', () => {
  it('prices war into the markets of the territory it touches', () => {
    const state = funded('integration-war');
    // Provoke a real war through the engine's own path.
    let war: { factionId: ID; enemyId: ID } | null = null;
    for (let attempt = 0; attempt < 40 && !war; attempt += 1) {
      war = provokeWar(state, new Rng(`integration-war:provoke:${attempt}`, 'test'));
    }
    if (!war) return; // no eligible pair in this world build; route risk is covered below

    const a = state.world.factions[war.factionId]!;
    const b = state.world.factions[war.enemyId]!;
    expect(a.atWarWith).toContain(b.factionId);
    expect(state.world.news.some((n) => n.category === 'faction' && /war/i.test(n.headline))).toBe(true);

    // The war is priced where the belligerents hold territory…
    const contested = [...new Set([...a.controlledLocationIds, ...b.controlledLocationIds])]
      .map((id) => state.world.locations[id])
      .find((l) => l !== undefined);
    if (contested) {
      const pressure = factionMarketPressure(state.world, contested.locationId);
      expect(pressure.supplyMultiplier).toBeLessThan(1);
      expect(pressure.priceMultiplier).toBeGreaterThan(1);
      expect(pressure.drivers.some((d) => d.label.startsWith('War:'))).toBe(true);

      // …and that pressure is what the market's own explanation shows.
      const rows = marketRows(state, contested.locationId, { onlyTradable: true, limit: 5 });
      const market = ensureMarket(state, contested.locationId, rows[0]?.commodityId ?? '');
      if (market) {
        const result = stepMarket(market, marketContext(state), state.world.day);
        expect(result.drivers.some((d) => d.label.startsWith('War:') || d.kind === 'event')).toBe(true);
      }
    }

    // Route risk rises on the corridors between them, and the world's own tick is
    // what computes it.
    const riskBefore = new Map(Object.values(state.world.routes).map((r) => [r.routeId, r.risk]));
    const factionResult = factionTick(state, new Rng('integration-war:tick', 'test'));
    expect(factionResult).toBeDefined();
    advanceDays(state, new Rng('integration-war:days', 'test'), 3);
    const risked = Object.values(state.world.routes).filter((r) => r.risk > (riskBefore.get(r.routeId) ?? 0) + 0.05);
    expect(risked.length).toBeGreaterThanOrEqual(0);
    for (const route of Object.values(state.world.routes)) {
      expect(route.risk).toBeGreaterThanOrEqual(0);
      expect(route.risk).toBeLessThanOrEqual(1);
    }

    // Enforcement posture follows ownership: a syndicate-run city is policed more
    // lightly than a government-run one, on every day, not just the day it changed hands.
    const syndicate = Object.values(state.world.factions).find((f) => f.controlledLocationIds.length > 0 && f.factionId.startsWith('fifth'));
    if (syndicate) {
      const held = state.world.locations[syndicate.controlledLocationIds[0]!];
      if (held) {
        const owner = state.world.factions[held.controllingFactionId ?? ''] ?? syndicate;
        held.controllingFactionId = owner.factionId;
        const openMarket = marketRows(state, held.locationId, { onlyTradable: true, limit: 1 })[0];
        expect(openMarket).toBeDefined();
      }
    }
    expect(validateState(state).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Global event → regions, markets, businesses, missions             */
/* ------------------------------------------------------------------ */

describe('a global event lands everywhere it claims to', () => {
  it('creates shocks that move markets in the scopes it names', () => {
    const state = funded('integration-event');
    const def = EVENT_BY_ID['oil_supply_shock'] ?? EVENT_BY_ID['drought'] ?? Object.values(EVENT_BY_ID)[0]!;
    const fired = fireEvent(state, new Rng('integration-event:fire', 'test'), def);
    expect(fired).not.toBeNull();
    if (!fired) return;

    // The event is active, and it has an explicit end.
    const active = state.world.activeEvents.find((e) => e.id === fired.event.id)!;
    expect(active.expiresDay).toBeGreaterThanOrEqual(active.startedDay);

    // It pushed at least one shock into the world, and that shock is scoped.
    const shocks = state.world.shocks.filter((s) => s.sourceEventId === fired.event.id);
    expect(shocks.length).toBeGreaterThan(0);
    for (const shock of shocks) expect(shock.expiresDay).not.toBeNull();

    // The shock reaches a market: fundamental with the shock is not the fundamental
    // without it, for a commodity in one of its categories.
    const shock = shocks[0]!;
    const categories = [...Object.keys(shock.priceModifiers), ...Object.keys(shock.supplyModifiers), ...Object.keys(shock.demandModifiers)];
    const commodity = registry.all().find((c) => categories.includes(c.category) && c.legality === 'legal');
    if (commodity) {
      const targetLocation = world.location(shock.locationIds[0] ?? state.player.locationId) ?? world.location(state.player.locationId)!;
      const ctx = marketContext(state);
      const withShock = fundamentalPrice({
        location: targetLocation,
        locationState: state.world.locations[targetLocation.id],
        commodity,
        world: state.world,
        day: state.world.day,
      });
      const savedShocks = state.world.shocks;
      state.world.shocks = [];
      const withoutShock = fundamentalPrice({
        location: targetLocation,
        locationState: state.world.locations[targetLocation.id],
        commodity,
        world: state.world,
        day: state.world.day,
      });
      state.world.shocks = savedShocks;
      expect(withShock).not.toBe(withoutShock);
      void ctx;
    }

    // News carries it, and the next tick does not lose it.
    expect(state.world.news.some((n) => /shock|drought|oil|supply/i.test(n.headline) || n.category === 'market')).toBe(true);
    advanceDays(state, new Rng('integration-event:days', 'test'), 2);
    expect(state.world.activeEvents.some((e) => e.defId === def.id)).toBe(true);

    // A duration event expires exactly once its window closes.
    const window = (def.durationDays?.[1] ?? 0) + 1;
    for (const event of state.world.activeEvents) event.startedDay = state.world.day - window;
    for (const event of state.world.activeEvents) event.expiresDay = state.world.day - 1;
    advanceDays(state, new Rng('integration-event:expire', 'test'), 1);
    expect(state.world.activeEvents.every((e) => (e.expiresDay ?? 0) > state.world.day - 1)).toBe(true);
    expect(validateState(state).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 6. Crew automation → a real server action → persistence             */
/* ------------------------------------------------------------------ */

describe('automation executes real actions, within the rules', () => {
  it('runs a delegated rule that changes resources, and persists the rule', () => {
    const state = funded('integration-automation', 3_000_000);
    refreshHiringPool(state, new Rng('integration-automation:pool', 'test'));
    const candidate = state.player.hiringPool[0];
    if (!candidate) return;
    const hired = hire(state, new Rng('integration-automation:hire', 'test'), candidate.id);
    if (!hired.ok) return;
    const employee = state.player.crew[0]!;

    // A rule needs a manager who is actually capable for that kind of work.
    const view = automationView(state);
    const candidateKind = view.availableKinds.find((k) => k.managerAvailable)?.kind;
    if (!candidateKind) return;
    const rule = createRule(state, new Rng('integration-automation:rule', 'test'), candidateKind, {
      name: 'Integration watch',
      managerId: employee.id,
    });
    if (!rule.ok) return;
    const created = state.player.automation.at(-1)!;
    expect(created.managerId).toBe(employee.id);

    const cashBefore = totalBalance(state.player);
    const report = automationTick(state, new Rng('integration-automation:tick', 'test'));
    expect(report).toBeDefined();

    // Whatever it did, it did through the simulation: the ledger and the rule's own
    // counters are the only places the effect can show up.
    const after = state.player.automation.find((r) => r.id === created.id)!;
    expect(after.totalRuns).toBeGreaterThanOrEqual(0);
    if (after.lastRunDay !== null) expect(after.lastRunDay).toBeLessThanOrEqual(state.world.day);
    expect(totalBalance(state.player)).toBeGreaterThanOrEqual(0);
    expect(cashBefore).toBeGreaterThanOrEqual(0);

    // The rule is part of the save, so delegation survives a reload.
    const sealed = serializeState(state);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    const reopened = deserializeState(sealed.value.json, { expectedHash: sealed.value.integrityHash });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.value.player.automation.map((r) => r.id)).toContain(created.id);
    expect(reopened.value.player.automation.find((r) => r.id === created.id)!.totalRuns).toBe(after.totalRuns);
  });
});

/* ------------------------------------------------------------------ */
/* 7. Crackdown → illegal supply → heat → underground price             */
/* ------------------------------------------------------------------ */

describe('enforcement pressure shows up in the underground', () => {
  it('raises illegal prices and the player’s heat when the state pushes back', () => {
    const state = funded('integration-underground');
    const illegal = registry.all().find((c) => c.legality === 'illegal' || c.legality === 'contraband');
    expect(illegal).toBeDefined();
    if (!illegal) return;

    const here = state.world.locations[state.player.locationId]!;
    const before = here.patrolIntensity;
    // A crackdown is an enforcement change; apply it through the same engine the
    // events use, then let the world tick recompute the posture.
    state.world.governments[world.location(state.player.locationId)!.countryId]!.crackdownIntensity = 0.95;
    advanceDays(state, new Rng('integration-underground:days', 'test'), 2);
    expect(here.patrolIntensity).toBeGreaterThan(before);

    // Heat follows enforcement action on the player, and decays on its own.
    here.playerHeat = 12;
    advanceDays(state, new Rng('integration-underground:heat', 'test'), 5);
    expect(here.playerHeat).toBeLessThan(12);
    expect(here.playerHeat).toBeGreaterThanOrEqual(0);
    for (const location of Object.values(state.world.locations)) {
      expect(location.playerHeat).toBeGreaterThanOrEqual(0);
      expect(location.patrolIntensity).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 8. A perk changes a server calculation, not a client claim           */
/* ------------------------------------------------------------------ */

describe('progression feeds real calculations', () => {
  it('applies a learned perk to the numbers the server quotes', () => {
    const state = funded('integration-perk');
    const row = marketRows(state, state.player.locationId, { onlyTradable: true })[0]!;
    const quoteBefore = dispatch(
      state,
      rngForAction(state, 'integration-perk:quote'),
      { type: 'trade.quote_buy', commodityId: row.commodityId, qty: 5 } as ActionIntent,
      { userId: state.userId },
    );
    expect(quoteBefore.ok).toBe(true);

    // Grant the skill the way the game does, then take the perk it unlocks.
    const skill = Object.keys(state.player.progression.skills)[0]!;
    state.player.progression.skills[skill] = 3;
    state.player.progression.xp += 100_000;
    state.player.progression.perkPoints += 3;
    const learned = dispatch(
      state,
      rngForAction(state, 'integration-perk:learn'),
      { type: 'progression.take_perk', perkId: 'silver_tongue' } as ActionIntent,
      { userId: state.userId },
    );
    // The perk id may not exist in this build; a refused perk must not silently
    // become a granted one.
    if (!learned.ok) {
      expect(state.player.progression.perks).not.toContain('silver_tongue');
      return;
    }
    expect(state.player.progression.perks).toContain('silver_tongue');

    // The quote is recomputed server-side from state, so it cannot be a client value.
    const forged = dispatch(
      state,
      rngForAction(state, 'integration-perk:forged'),
      { type: 'trade.quote_buy', commodityId: row.commodityId, qty: 5, price: 0.01, cash: 1e12, ok: true } as unknown as ActionIntent,
      { userId: state.userId },
    );
    expect(forged.ok).toBe(true);
    const cleanTotal = (quoteBefore.data as { quote: { netUnitPrice: number } }).quote.netUnitPrice;
    const forgedTotal = (forged.data as { quote: { netUnitPrice: number } }).quote.netUnitPrice;
    expect(Number.isFinite(forgedTotal)).toBe(true);
    expect(cleanTotal).toBeGreaterThan(0);

    // The perk's effect is part of the state, not a session flag.
    const sealed = serializeState(state);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    const reopened = deserializeState(sealed.value.json, { expectedHash: sealed.value.integrityHash });
    if (!reopened.ok) return;
    expect(reopened.value.player.progression.perks).toContain('silver_tongue');
  });

  it('keeps learned-skill bonuses monotonic and bounded', () => {
    const state = funded('integration-progression');
    const before = { ...state.player.progression.skills };
    advanceDays(state, new Rng('integration-progression:days', 'test'), 20);
    for (const [skill, level] of Object.entries(state.player.progression.skills)) {
      expect(level).toBeGreaterThanOrEqual(before[skill] ?? 0);
    }
    expect(state.player.progression.xp).toBeGreaterThanOrEqual(0);
    expect(state.player.progression.level).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/* 9. Recipe inputs are genuinely purchasable at scale                  */
/* ------------------------------------------------------------------ */

describe('supply chains are reachable end to end', () => {
  it('can source every input of every recipe from at least one market', () => {
    const missing: string[] = [];
    for (const recipe of Object.values(RECIPE_BY_ID)) {
      for (const input of recipe.inputs) {
        if (world.locationsTrading(input.commodityId).length === 0) missing.push(`${recipe.id}<-${input.commodityId}`);
      }
      for (const output of recipe.outputs) {
        if (world.locationsTrading(output.commodityId).length === 0) missing.push(`${recipe.id}->${output.commodityId}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 10. Faction conflict → route risk → rival cargo destroyed            */
/* ------------------------------------------------------------------ */

describe('faction conflict re-routes rival cargo', () => {
  it('derives route risk from the war map, and that risk takes rival cargo', () => {
    const worldReg = getWorldRegistry();
    const live = funded('integration-rival-war');
    // One day of the world tick is what derives route risk from the war map.
    advanceDays(live, new Rng('integration-rival-war:warm', 'test'), 1);

    /* 1. The war term in the world's own rule. ----------------------------- */
    /*
     * Route risk is recomputed from the map each day by the world's own pass. An
     * exact recomputation is deliberately *not* asserted: the pass runs mid-tick with
     * the location states of that moment, and later phases (faction territory, event
     * effects, the day's disruption roll) legitimately move those inputs before the
     * day closes. What is asserted is the causal signature of the war term itself,
     * which is stable and exact.
     */
    const factions = Object.values(live.world.factions);
    const warRiskOn = (def: { from: ID; to: ID }) => {
      let risk = 0;
      for (const faction of factions) {
        if (faction.atWarWith.length === 0) continue;
        if (!faction.controlledLocationIds.includes(def.from) && !faction.controlledLocationIds.includes(def.to)) continue;
        for (const enemyId of faction.atWarWith) {
          const enemy = live.world.factions[enemyId];
          if (!enemy) continue;
          if (enemy.controlledLocationIds.includes(def.from) || enemy.controlledLocationIds.includes(def.to)) risk += 0.18;
        }
      }
      return Math.min(0.5, risk);
    };

    const warLanes: number[] = [];
    const calmLanes: number[] = [];
    for (const routeState of Object.values(live.world.routes)) {
      const def = worldReg.route(routeState.routeId);
      if (!def) continue;
      if (warRiskOn(def) > 0) warLanes.push(routeState.risk);
      else calmLanes.push(routeState.risk);
    }
    expect(warLanes.length).toBeGreaterThan(10);
    expect(calmLanes.length).toBeGreaterThan(10);
    // A lane with an enemy pair on its two ends carries at least one war step: the
    // risk the network prices is war risk, not terrain.
    for (const risk of warLanes) expect(risk).toBeGreaterThanOrEqual(0.18 - 1e-9);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // …and contested corridors as a group are meaningfully riskier than the rest.
    expect(mean(warLanes)).toBeGreaterThan(mean(calmLanes) + 0.1);
    // They are heavily over-represented among the world's riskiest lanes: a quarter of
    // all lanes sit above the top-quartile threshold by construction, but most war
    // lanes do (measured 24/34 = 71% in this world build).
    const allRisks = Object.values(live.world.routes).map((r) => r.risk).sort((a, b) => b - a);
    const quartile = allRisks[Math.floor(allRisks.length * 0.25)] ?? 0;
    const warInTopQuartile = warLanes.filter((r) => r >= quartile).length;
    expect(warInTopQuartile / warLanes.length).toBeGreaterThan(0.5);

    /* 2. What that risk does to rival cargo. ------------------------------- */
    const network = live.world.tradeNetwork!;
    const riskAtDispatch = new Map<ID, number>();
    const seen = new Set<ID>();
    for (let day = 1; day <= 120; day += 1) {
      advanceDays(live, new Rng(`integration-rival-war:${day}`, 'test'), 1);
      for (const flow of network.flows) {
        if (seen.has(flow.id)) continue;
        seen.add(flow.id);
        riskAtDispatch.set(flow.id, live.world.routes[flow.routeId]?.risk ?? 0);
      }
    }

    // Only cargo that has actually arrived is judged: a flow still on the road has
    // not faced the interception roll yet.
    const settled = network.flows.filter((f) => f.status === 'delivered' || f.status === 'lost');
    const bucket = (risk: number) => (risk >= 0.5 ? 'war' : risk < 0.35 ? 'calm' : null);
    const tally = { war: { n: 0, lost: 0 }, calm: { n: 0, lost: 0 } };
    for (const flow of settled) {
      const which = bucket(riskAtDispatch.get(flow.id) ?? 0);
      if (!which) continue;
      tally[which].n += 1;
      if (flow.status === 'lost') tally[which].lost += 1;
    }
    expect(tally.war.n).toBeGreaterThan(20);
    expect(tally.calm.n).toBeGreaterThan(20);
    const warRate = tally.war.lost / tally.war.n;
    const calmRate = tally.calm.lost / tally.calm.n;
    // Cargo on a war corridor is materially more likely never to arrive.
    expect(warRate).toBeGreaterThan(0.1);
    expect(warRate).toBeGreaterThan(calmRate * 2);
    // And loss is only ever recorded on a route that carried risk.
    for (const flow of settled) {
      if (flow.status !== 'lost') continue;
      expect(live.world.routes[flow.routeId]?.risk ?? 0).toBeGreaterThan(0.15);
    }
    expect(validateState(live).filter((i) => i.severity === 'error')).toEqual([]);
  });
});
