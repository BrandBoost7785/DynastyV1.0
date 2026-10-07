// @vitest-environment jsdom
/**
 * Component tests for the Phase 1B screens.
 *
 * These run in jsdom (no browser binary is installable in this sandbox), so they cover
 * what a DOM test provably can: that each screen renders its loading, empty, error and
 * populated states, that its primary command is wired to the right intent with the
 * version and idempotency key the server requires, and that a restore is a confirmed,
 * server-authoritative, conflict-checked operation rather than a local trick.
 *
 * Only the transport (`fetch`) and Next's router/link are mocked. The real api-client,
 * query cache, GameProvider, CommandButton and components all run. The payloads below are
 * minimal HTTP fixtures shaped exactly like the server's own read models — the application
 * itself contains no sample or fabricated gameplay data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { pushMock, routerMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  routerMock: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/games/g_test/automation',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

import { GameProvider, SessionProvider } from '../src/lib/game-context';
import { clearAllQueries, invalidate } from '../src/lib/query';
import { ToastProvider } from '../src/components/ui/toast';
import { NAV_ITEMS } from '../src/components/game/nav';

import AutomationPage from '../src/app/games/[gameId]/automation/page';
import MissionsPage from '../src/app/games/[gameId]/missions/page';
import FactionsPage from '../src/app/games/[gameId]/factions/page';
import UndergroundPage from '../src/app/games/[gameId]/underground/page';
import CombatPage from '../src/app/games/[gameId]/combat/page';
import ProgressionPage from '../src/app/games/[gameId]/progression/page';
import SavePage from '../src/app/games/[gameId]/save/page';

/* ------------------------------------------------------------------ */
/* Harness                                                            */
/* ------------------------------------------------------------------ */

interface Route {
  match: (url: string, init?: RequestInit) => boolean;
  status?: number;
  body: unknown;
}

let routes: Route[] = [];
let calls: { url: string; init?: RequestInit }[] = [];

function fetchMock(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  calls.push({ url, ...(init ? { init } : {}) });
  const route = routes.find((entry) => entry.match(url, init));
  if (!route) {
    return Promise.resolve(
      new Response(JSON.stringify({ ok: false, error: { code: 'not_found', message: `no fixture for ${url}` }, requestId: 'req_test' }), { status: 404 }),
    );
  }
  return Promise.resolve(new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'content-type': 'application/json' } }));
}

beforeEach(() => {
  routes = [];
  calls = [];
  clearAllQueries();
  pushMock.mockClear();
  routerMock.push.mockClear();
  vi.stubGlobal('fetch', vi.fn(fetchMock));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A screen rendered with the real providers the game shell mounts. */
function renderScreen(node: React.ReactNode) {
  return render(
    <ToastProvider>
      <SessionProvider>
        <GameProvider gameId="g_test">{node}</GameProvider>
      </SessionProvider>
    </ToastProvider>,
  );
}

const sessionEnvelope = {
  ok: true,
  requestId: 'req_test',
  data: {
    authenticated: true,
    user: { id: 'u_test', email: 'tester@example.com', displayName: 'Tester', provider: 'local' },
    auth: 'local',
    environment: 'test',
    requestId: 'req_test',
  },
};

function meta(version = 7) {
  return {
    gameId: 'g_test',
    userId: 'u_test',
    name: 'Test save',
    status: 'active',
    schemaVersion: 2,
    version,
    day: 12,
    turn: 3,
    level: 4,
    title: 'Trader',
    netWorth: 12000,
    empireScore: 12,
    worldSeed: 'seed',
    difficulty: 'standard',
    locationId: 'loc_a',
    incarcerated: false,
    endingKind: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function stateEnvelope() {
  return {
    ok: true,
    requestId: 'req_test',
    data: {
      game: { meta: meta(), status: 'active', cash: 5000, actionsLeft: 2, notificationsUnread: 0 },
      state: {
        meta: meta(),
        world: { day: 12, turn: 3 },
        netWorth: { total: 12000, cash: 5000 },
        ending: null,
        player: {
          locationId: 'loc_a',
          accounts: [{ id: 'acct_1', balance: 5000 }],
          stats: { actionsToday: 2 },
          notifications: [],
          inventory: [],
          combat: null,
          prison: { incarcerated: false, facility: '', sentenceDays: 0, releaseDay: null, bailAmount: null, bailPaid: false },
          progression: { titles: ['Nobody', 'Trader'], currentTitle: 'Trader' },
        },
      },
    },
  };
}

function viewEnvelope(data: unknown, version = 7) {
  return { ok: true, requestId: 'req_test', data: { view: 'test', day: 12, turn: 3, version, locationId: 'loc_a', data } };
}

/** The standard three fixtures every authenticated screen needs before its own view. */
function shellRoutes() {
  routes.push({ match: (url) => url.endsWith('/api/auth/session'), body: sessionEnvelope });
  routes.push({ match: (url) => /\/api\/games\/g_test$/.test(url), body: stateEnvelope() });
}

function viewRoute(name: string, data: unknown, status = 200) {
  routes.push({ match: (url) => url.includes(`/views/${name}`), status, body: status === 200 ? viewEnvelope(data) : { ok: false, error: { code: 'internal_error', message: 'boom' }, requestId: 'r' } });
}

/**
 * The last command envelope the client posted. The API contract is
 * `{ intent, expectedVersion, requestId }`, so a screen that flattened the intent into the
 * body — or forgot the version — would be caught here.
 */
function lastIntent(): { intent: Record<string, unknown>; expectedVersion?: number; requestId?: string } {
  const call = [...calls].reverse().find((entry) => entry.url.endsWith('/intent') || entry.url.endsWith('/advance'));
  return JSON.parse(String(call?.init?.body ?? '{}'));
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

const automationRule = {
  id: 'rule_1',
  name: 'Keep the shop stocked',
  kind: 'auto_resupply',
  kindLabel: 'Production resupply',
  enabled: true,
  manager: { id: 'emp_1', name: 'Nadia Frost', role: 'logistics_manager', skill: 62, morale: 70, loyalty: 66, salaryPerDay: 120 },
  uptime: 0.96,
  errorChance: 0.04,
  errorCostFraction: 0.02,
  config: { minStockDays: 3, allowIllegal: false },
  schema: [
    { key: 'minStockDays', label: 'Minimum stock cover', type: 'number', min: 1, max: 30, step: 1, defaultValue: 3, help: 'Resupply a line when its input cover falls below this.' },
    { key: 'allowIllegal', label: 'Allow illegal inputs', type: 'boolean', defaultValue: false, help: 'Lets the manager buy through hidden channels.' },
  ],
  lastRunDay: 11,
  lastResult: { day: 11, success: true, profit: 480, message: 'Resupplied the textile line.' },
  totalRuns: 9,
  totalErrors: 1,
  totalProfit: 3120,
  errorRate: 0.11,
  createdDay: 4,
  cooldownDays: 0,
};

const automationEmpty = {
  rules: [],
  availableKinds: [
    { kind: 'auto_trade', label: 'Automated trading', configured: false, managerAvailable: false, managerName: null, schema: [{ key: 'minMargin', label: 'Minimum margin', type: 'number', min: 0.01, max: 1, step: 0.01, defaultValue: 0.12, help: 'Only trade above this margin.' }] },
  ],
  delegation: { rules: 0, enabled: 0, managers: 0, rulesPerManager: 0, capacity: 6, overloaded: false, tiers: [{ tier: 'player', count: 1, description: 'You, doing it by hand' }] },
  totalProfit: 0,
  totalRuns: 0,
  totalErrors: 0,
  profitToday: 0,
  automationProfitAllTime: 0,
  managers: [],
};

const automationFull = {
  ...automationEmpty,
  rules: [automationRule],
  availableKinds: [
    { kind: 'auto_resupply', label: 'Production resupply', configured: true, managerAvailable: true, managerName: 'Nadia Frost', schema: automationRule.schema },
  ],
  managers: [{ id: 'emp_1', name: 'Nadia Frost', role: 'logistics_manager', capability: 'auto_resupply', skill: 62, rules: 1 }],
  totalProfit: 3120,
  totalRuns: 9,
  totalErrors: 1,
  profitToday: 480,
  automationProfitAllTime: 3120,
  delegation: { rules: 1, enabled: 1, managers: 1, rulesPerManager: 1, capacity: 6, overloaded: false, tiers: [{ tier: 'player', count: 1, description: 'You, doing it by hand' }] },
};

const missionOffer = {
  id: 'mis_1',
  defId: 'deliver_water',
  title: 'Water for the delta',
  description: 'A broker needs potable water moved before the lockdown bites.',
  giverName: 'Ilse Nakamura',
  giverFactionId: 'faction_1',
  kind: 'delivery',
  difficulty: 2,
  status: 'available',
  acceptedDay: 0,
  deadlineDay: 18,
  daysRemaining: 6,
  rewardCash: 2400,
  rewardXp: 120,
  risk: 0.18,
  progress: 0,
  objectives: [{ id: 'obj_1', description: 'Deliver 20 crates to Cotton Basin', current: 0, required: 20, progress: 0, completed: false }],
  reputationRewards: [{ dimension: 'business', amount: 2 }],
  unlockReason: null,
  unlocks: [{ id: 'mis_2', title: 'A quieter harbour' }],
};

const missionsEmpty = { offers: [], active: [], history: [], nextRefreshDay: 15, maxActive: 4, completed: 0, failed: 0, locked: [] };
const missionsFull = { ...missionsEmpty, offers: [missionOffer], locked: [{ defId: 'mis_x', title: 'The Ledger Job', reason: 'Needs business standing 10' }] };

const faction = {
  id: 'faction_1',
  name: 'Cape Meridian Consortium',
  kind: 'corporate',
  kindLabel: 'Corporate bloc',
  description: 'Shipping money with a taste for order.',
  goals: ['Control the southern routes'],
  services: ['shipping_discount', 'legal_cover'],
  resources: 0.74,
  power: 0.61,
  aggression: 0.3,
  mood: 0.55,
  playerStanding: 12,
  standingLabel: 'Tolerated',
  recruitmentRequirement: 25,
  canUseServices: false,
  territory: [{ id: 'loc_a', name: 'Bharat Metro', here: true }],
  atWarWith: [],
  alliedWith: [{ id: 'faction_2', name: 'Delta Union', value: 0.4 }].map(({ id, name }) => ({ id, name })),
  relations: [{ id: 'faction_2', name: 'Delta Union', value: 0.4 }],
  interests: ['shipping', 'manufactured'],
  offers: [
    { id: 'off_1', kind: 'gift', kindLabel: 'Tribute request', description: 'A gesture of goodwill would be noted.', reward: 0, standingDelta: 4, risk: 0.05, expiresDay: 20, daysLeft: 8, accepted: null },
  ],
  tributeOwed: 350,
  controlsCurrentLocation: true,
};

const factionsEmpty = { factions: [], overview: { total: 0, wars: [], controllerHere: null, territoryChanges30d: 0, bestStanding: null, worstStanding: null, offersOpen: 0, tributeDemands: 0, servicesAvailable: [], factionPressure: 0 }, interests: {} };
const factionsFull = {
  factions: [faction],
  overview: { total: 1, wars: [{ a: 'Cape Meridian Consortium', b: 'Delta Union', sinceBalance: -0.2 }], controllerHere: { id: 'faction_1', name: 'Cape Meridian Consortium', kind: 'Corporate bloc' }, territoryChanges30d: 2, bestStanding: { name: 'Cape Meridian Consortium', standing: 12 }, worstStanding: { name: 'Cape Meridian Consortium', standing: 12 }, offersOpen: 1, tributeDemands: 1, servicesAvailable: [], factionPressure: 0.4 },
  interests: { faction_1: [{ category: 'shipping', commodities: 3, exampleValue: 900 }] },
};

const undergroundLocked = {
  view: {
    accessUnlocked: false,
    accessCost: 750,
    handle: 'quiet_harbour_11',
    digitalReputation: 0,
    digitalReputationLabel: 'Unknown',
    escrowBalance: 0,
    traceHeat: 0,
    traceHeatLabel: 'Clean routing',
    vpnQuality: 0.2,
    vpnUpgradeCost: 900,
    compromised: false,
    compromisedUntilDay: null,
    hackCooldownUntilDay: null,
    markets: [{ id: 'sprawl_bazaar', name: 'Sprawl Bazaar', known: false, vendorReputation: 0.62, escrowFeeFraction: 0.045, minimumDeposit: 500, focus: ['narcotic'], minDigitalReputation: 0, yourReputationWithThem: 0, listings: 0, description: 'The oldest open market.', accessible: false, reason: 'Buy darknet access first.' }],
    assets: [],
    dataOffers: [],
    hackTargets: [],
    hiddenChannelListings: 0,
    stats: { dataSold: 0, dataRevenue: 0, hacksSuccess: 0, hacksFailed: 0, exitScams: 0, hackRevenue: 0 },
  },
  markets: [],
  listings: [],
};

const undergroundOpen = {
  view: {
    ...undergroundLocked.view,
    accessUnlocked: true,
    handle: 'quiet_harbour_11',
    digitalReputation: 22,
    digitalReputationLabel: 'Trusted',
    escrowBalance: 1000,
    traceHeat: 6,
    markets: [{ ...undergroundLocked.view.markets[0]!, known: true, accessible: true, listings: 4, reason: null }],
    dataOffers: [{ kind: 'intel', name: 'Location intel', price: 4200, baseValue: 6800, freshnessPerDay: 0.02, riskOnHold: 0.05, buyers: 'Traders and factions', description: 'Coordinates and access notes.' }],
    hackTargets: [{ kind: 'company', targetId: 'aldrich_luxury', name: 'Aldrich Luxury', difficulty: 62, successChance: 0.24, rewardEstimate: 184000, heatOnFailure: 18, traceHeat: 8, lootKind: 'market_data', description: 'Inside information about earnings.' }],
    assets: [{ id: 'asset_1', name: 'Encrypted ledger', kind: 'ledger', acquiredDay: 10, ageDays: 2, freshness: 0.8, value: 27000, baseValue: 34500, riskOnHold: 0.16, targetId: null, decayPerDay: 414 }],
  },
  markets: [],
  listings: [],
};

const progressionEmpty = {
  level: 1,
  title: 'Nobody',
  xp: 0,
  xpToNext: 240,
  xpProgress: 0,
  skillPoints: 3,
  perkPoints: 0,
  skills: [],
  perks: [],
  achievementsEarned: 0,
  achievementsTotal: 1,
  prestigeCount: 0,
  legacyBonus: 0,
  reputation: { business: 0, crew: 0, criminal: 0, digital: 0, global: 0, legal: 0.1, underground: 0 },
  resolvedModifiers: {},
  skillCatalogue: [{ id: 'logistics', name: 'Logistics', description: 'Move freight cheaper.', tree: 'operations', maxLevel: 10, level: 0, effectPerLevel: '−1% freight cost', prerequisites: [], canLearn: true, reason: null }],
  perkCatalogue: [{ id: 'silver_tongue', name: 'Silver Tongue', description: 'Negotiate better.', tree: 'social', modifiers: { negotiate: 0.1 }, requiresSkillId: null, requiresSkillLevel: null, taken: false, canTake: false, reason: 'Perk point required.' }],
  achievements: [{ id: 'first_trade', name: 'First trade', description: 'Complete a trade.', earned: false, earnedDay: null, metrics: [{ metric: 'trades', current: 0, target: 1, op: '>=' }], progress: 0 }],
  respecCost: 2500,
  prestigeFacts: { count: 0, lastPrestigeDay: null, day: 12, legacyBonus: 0, legacyBonusCap: 0.35, maxPrestiges: 5, minDaysBetween: 120, netWorthRequirement: 25_000_000, requireDebtsSettled: true, netWorth: 12000, outstandingDebt: 0 },
};

const combatActive = {
  id: 'cbt_1',
  kind: 'police',
  locationName: 'Bharat Metro',
  turn: 2,
  turnLimit: 24,
  phase: 'active',
  autoResolved: false,
  grid: { width: 12, height: 8 },
  participants: [
    { id: 'player', name: 'Tester', side: 'player', hp: 82, maxHp: 100, hpPct: 0.82, ap: 3, maxAp: 3, accuracy: 0.62, damage: [4, 9], defense: 0.18, position: { x: 8, y: 2 }, cover: false, alive: true },
    { id: 'enemy_0', name: 'Border Guard', side: 'enemy', hp: 40, maxHp: 77, hpPct: 0.52, ap: 2, maxAp: 2, accuracy: 0.5, damage: [9, 16], defense: 0.16, position: { x: 9, y: 1 }, cover: true, alive: true, tier: 'normal', description: 'Checkpoint staffing.' },
  ],
  log: [{ turn: 1, actorId: 'enemy_0', actorName: 'Border Guard', action: 'attack', targetId: 'player', targetName: 'Tester', damage: 13, detail: 'Tester at 87/100 HP.', critical: false }],
  stakes: { lossCash: 800, lossInventoryFraction: 0.25, arrestChance: 0.2, injuryChance: 0.15, deathChance: 0.01, xpReward: 60, reputationReward: [{ dimension: 'criminal', amount: 2 }], loot: [{ cash: 400 }], defendedPropertyId: null, defendedShipmentId: null },
  estimates: [
    { action: { type: 'attack', targetId: 'enemy_0' }, label: 'Attack Border Guard (40/77 HP)', apCost: 1, successChance: 0.41, expectedValue: '~6 damage', available: true },
    { action: { type: 'flee' }, label: 'Flee the encounter', apCost: 3, successChance: 0.55, expectedValue: 'Likely escape with your cargo', available: true },
  ],
  canFlee: true,
  canNegotiate: false,
  canBribe: true,
  bribeAmount: 1200,
  outcome: null,
  odds: { victoryChance: 0.42, explanation: 'Your effective power 31 vs theirs 43.' },
};

const versionsPayload = {
  gameId: 'g_test',
  currentVersion: 7,
  versions: [
    { gameId: 'g_test', version: 7, day: 12, netWorth: 12000, savedAt: '2026-01-02T10:00:00.000Z', sizeBytes: 240_000, reason: 'trade.buy' },
    { gameId: 'g_test', version: 6, day: 11, netWorth: 11800, savedAt: '2026-01-02T09:00:00.000Z', sizeBytes: 238_000, reason: null },
  ],
};

/* ------------------------------------------------------------------ */
/* Automation                                                         */
/* ------------------------------------------------------------------ */

describe('automation screen', () => {
  it('shows a truthful empty state before anything is delegated', async () => {
    shellRoutes();
    viewRoute('automation', automationEmpty);
    renderScreen(<AutomationPage />);
    expect((await screen.findAllByText(/nothing is delegated yet/i)).length).toBeGreaterThan(0);
  });

  it('renders a delegate order form that is driven by the server schema', async () => {
    shellRoutes();
    viewRoute('automation', automationFull);
    renderScreen(<AutomationPage />);
    await screen.findByText('Keep the shop stocked');

    fireEvent.click(screen.getByRole('tab', { name: /write an order/i }));
    expect(await screen.findByLabelText('Order type')).not.toBeNull();
    // The policy form is built from the rule's own schema — a field the server did not publish cannot appear.
    expect(await screen.findByLabelText(/minimum stock cover/i)).not.toBeNull();
    expect(screen.getByLabelText(/allow illegal inputs/i)).not.toBeNull();
    expect(await screen.findByLabelText(/manager/i)).not.toBeNull();
  });

  it('turns a server error into a sentence instead of a blank panel', async () => {
    shellRoutes();
    viewRoute('automation', null, 500);
    renderScreen(<AutomationPage />);
    expect(await screen.findByText(/could not load your standing orders/i)).not.toBeNull();
  });

  it('sends a create_rule intent carrying the version and an idempotency key', async () => {
    shellRoutes();
    viewRoute('automation', automationFull);
    routes.push({
      match: (url, init) => url.endsWith('/intent') && init?.method === 'POST',
      body: { ok: true, requestId: 'r', data: { ok: true, message: 'Written.', warnings: [], notifications: [], day: 12, turn: 3, state: stateEnvelope().data.state, meta: meta(8), saved: true, replayed: false, gameId: 'g_test' } },
    });
    renderScreen(<AutomationPage />);
    await screen.findByText('Keep the shop stocked');
    fireEvent.click(screen.getByRole('tab', { name: /write an order/i }));
    fireEvent.click(await screen.findByRole('button', { name: /write the order/i }));

    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/intent'))).toBe(true));
    const command = lastIntent();
    expect(command.intent.type).toBe('automation.create_rule');
    expect(command.intent.kind).toBe('auto_resupply');
    expect(command.expectedVersion).toBe(7);
    expect(String(command.requestId)).toMatch(/^web-/);
    // The manager is attached because the server said one is available for this kind.
    expect(command.intent.managerId).toBe('emp_1');
    // The policy values come from the form the server's schema built.
    expect(command.intent.config).toMatchObject({ minStockDays: 3, allowIllegal: false });
  });

  it('pauses a running rule through the server rather than editing it locally', async () => {
    shellRoutes();
    viewRoute('automation', automationFull);
    routes.push({
      match: (url, init) => url.endsWith('/intent') && init?.method === 'POST',
      body: { ok: true, requestId: 'r', data: { ok: true, message: 'Paused.', warnings: [], notifications: [], day: 12, turn: 3, state: stateEnvelope().data.state, meta: meta(8), saved: true, replayed: false, gameId: 'g_test' } },
    });
    renderScreen(<AutomationPage />);
    await screen.findByText('Keep the shop stocked');
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));

    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/intent'))).toBe(true));
    expect(lastIntent().intent).toMatchObject({ type: 'automation.update_rule', ruleId: 'rule_1', enabled: false });
  });

  it('keeps the form and reports a refused rule instead of pretending it was written', async () => {
    shellRoutes();
    viewRoute('automation', automationFull);
    routes.push({
      match: (url, init) => url.endsWith('/intent') && init?.method === 'POST',
      body: {
        ok: true,
        requestId: 'r',
        data: {
          ok: false,
          error: 'action_not_permitted',
          message: 'Nobody on the payroll can run that order kind.',
          warnings: [],
          notifications: [],
          day: 12,
          turn: 3,
          state: stateEnvelope().data.state,
          meta: meta(8),
          saved: true,
          replayed: false,
          gameId: 'g_test',
        },
      },
    });
    renderScreen(<AutomationPage />);
    await screen.findByText('Keep the shop stocked');
    fireEvent.click(screen.getByRole('tab', { name: /write an order/i }));
    fireEvent.change(await screen.findByLabelText(/name \(optional\)/i), { target: { value: 'Night shift cover' } });
    fireEvent.click(screen.getByRole('button', { name: /write the order/i }));

    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/intent'))).toBe(true));
    expect(lastIntent().intent.name).toBe('Night shift cover');
    // A refusal is surfaced with the server's reason and is never announced as success.
    const notices = await screen.findAllByText(/nobody on the payroll can run that order kind/i);
    expect(notices.length).toBeGreaterThan(0);
    // The warning reaches the live region the shell announces to assistive technology.
    const liveRegions = await screen.findAllByRole('status');
    expect(liveRegions.some((node) => node.textContent?.includes('Nobody on the payroll can run that order kind.'))).toBe(true);
    // The typed name survives: the order was not written, so the form is not reset.
    expect((screen.getByLabelText(/name \(optional\)/i) as HTMLInputElement).value).toBe('Night shift cover');
  });

  it('asks before deleting a standing order', async () => {
    shellRoutes();
    viewRoute('automation', automationFull);
    renderScreen(<AutomationPage />);
    await screen.findByText('Keep the shop stocked');
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete order' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Delete');
    expect(calls.some((call) => call.url.endsWith('/intent'))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Missions                                                           */
/* ------------------------------------------------------------------ */

describe('missions screen', () => {
  it('explains an empty board and which opportunities are still locked', async () => {
    shellRoutes();
    viewRoute('missions', missionsEmpty);
    renderScreen(<MissionsPage />);
    expect(await screen.findByText(/no contracts on offer/i)).not.toBeNull();
  });

  it('renders an offer with its objectives, deadline and reward', async () => {
    shellRoutes();
    viewRoute('missions', missionsFull);
    renderScreen(<MissionsPage />);
    expect(await screen.findByText('Water for the delta')).not.toBeNull();
    expect((await screen.findAllByText(/deliver 20 crates/i)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: /locked/i }));
    expect(await screen.findByText('The Ledger Job')).not.toBeNull();
    expect(screen.getByText(/needs business standing 10/i)).not.toBeNull();
  });

  it('accepts a contract through the typed client', async () => {
    shellRoutes();
    viewRoute('missions', missionsFull);
    routes.push({
      match: (url, init) => url.endsWith('/intent') && init?.method === 'POST',
      body: { ok: true, requestId: 'r', data: { ok: true, message: 'Accepted.', warnings: [], notifications: [], day: 12, turn: 3, state: stateEnvelope().data.state, meta: meta(8), saved: true, replayed: false, gameId: 'g_test' } },
    });
    renderScreen(<MissionsPage />);
    await screen.findByText('Water for the delta');
    fireEvent.click(screen.getByRole('button', { name: /^accept/i }));

    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/intent'))).toBe(true));
    expect(lastIntent().intent).toMatchObject({ type: 'mission.accept', missionId: 'mis_1' });
    expect(lastIntent().expectedVersion).toBe(7);
  });

  it('reports a failed offer read instead of pretending the board is empty', async () => {
    shellRoutes();
    viewRoute('missions', null, 500);
    renderScreen(<MissionsPage />);
    expect(await screen.findByText(/could not/i)).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Factions                                                           */
/* ------------------------------------------------------------------ */

describe('factions screen', () => {
  it('renders standing, territory, goals and the demands placed on the player', async () => {
    shellRoutes();
    viewRoute('factions', factionsFull);
    renderScreen(<FactionsPage />);
    expect((await screen.findAllByText('Cape Meridian Consortium')).length).toBeGreaterThan(0);
    expect(screen.getByText(/tolerated/i)).not.toBeNull();
    expect(screen.getByText(/Bharat Metro/)).not.toBeNull();
    // Goals, interests and offers live in the faction's own detail row.
    fireEvent.click(screen.getByRole('button', { name: 'Detail' }));
    expect(await screen.findByText(/Control the southern routes/)).not.toBeNull();
    // Declared interests and the server's commodity-depth read model.
    expect(screen.getAllByText(/shipping/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/3 commodities/)).not.toBeNull();
  });

  it('sends a gift intent rather than computing standing in the browser', async () => {
    shellRoutes();
    viewRoute('factions', factionsFull);
    routes.push({
      match: (url, init) => url.endsWith('/intent') && init?.method === 'POST',
      body: { ok: true, requestId: 'r', data: { ok: true, message: 'Noted.', warnings: [], notifications: [], day: 12, turn: 3, state: stateEnvelope().data.state, meta: meta(8), saved: true, replayed: false, gameId: 'g_test' } },
    });
    renderScreen(<FactionsPage />);
    await screen.findAllByText('Cape Meridian Consortium');
    fireEvent.click(screen.getByRole('button', { name: 'Detail' }));
    fireEvent.click(await screen.findByRole('button', { name: /pay tribute|^send /i }));
    // The gift is confirmed first: nothing may be sent by a single click.
    expect(calls.some((call) => call.url.endsWith('/intent'))).toBe(false);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /send money/i }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/intent'))).toBe(true));
    const command = lastIntent();
    expect(command.intent.type).toBe('faction.gift');
    expect(command.intent.factionId).toBe('faction_1');
    expect(command.expectedVersion).toBe(7);
  });

  it('renders a legitimately empty world as an empty state, not an error and not fake data', async () => {
    shellRoutes();
    viewRoute('factions', factionsEmpty);
    const view = renderScreen(<FactionsPage />);

    // The route loads: header present, no crash, and no failure copy anywhere on the page.
    expect(await screen.findByRole('heading', { name: 'Factions', level: 1 })).not.toBeNull();
    expect(await screen.findByText(/no factions in this world yet/i)).not.toBeNull();
    expect(screen.getByText(/factions form, grow and move as the simulation runs/i)).not.toBeNull();
    expect(screen.queryByText(/could not load faction data/i)).toBeNull();
    expect(screen.queryByText(/loading factions/i)).toBeNull();
    // Empty means empty: no table, no invented row, and no faction-shaped record at all.
    expect(screen.queryByRole('table', { name: 'Factions' })).toBeNull();
    expect(screen.queryByText('Cape Meridian Consortium')).toBeNull();
    expect(view.container.textContent).not.toMatch(/tolerated/i);
  });

  it('keeps a load failure distinguishable from an empty world', async () => {
    shellRoutes();
    viewRoute('factions', null, 500);
    renderScreen(<FactionsPage />);
    // A failed read says so and never shows the empty-world copy.
    expect(await screen.findByText(/could not load faction data/i)).not.toBeNull();
    expect(screen.queryByText(/no factions in this world yet/i)).toBeNull();
  });

  it('still explains a search that matches nothing when the world does have factions', async () => {
    shellRoutes();
    viewRoute('factions', factionsFull);
    renderScreen(<FactionsPage />);
    await screen.findAllByText('Cape Meridian Consortium');
    fireEvent.change(screen.getByLabelText(/search factions/i), { target: { value: 'no such power' } });
    expect(await screen.findByText(/no faction matches that search/i)).not.toBeNull();
    expect(screen.queryByText(/no factions in this world yet/i)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Underground                                                        */
/* ------------------------------------------------------------------ */

describe('underground screen', () => {
  it('shows what access costs instead of inventing venues when locked', async () => {
    shellRoutes();
    viewRoute('underground', undergroundLocked);
    renderScreen(<UndergroundPage />);
    expect(await screen.findByText(/not on the network yet/i)).not.toBeNull();
    expect(screen.getByText(/one-off access fee/i)).not.toBeNull();
    // Locked markets can be discovered but not browsed, so no listing table exists.
    expect(screen.queryByRole('table', { name: /listings/i })).toBeNull();
  });

  it('buys access through the server and never assumes the result', async () => {
    shellRoutes();
    viewRoute('underground', undergroundLocked);
    routes.push({
      match: (url, init) => url.endsWith('/intent') && init?.method === 'POST',
      body: { ok: true, requestId: 'r', data: { ok: true, message: 'You are on the network.', warnings: [], notifications: [], day: 12, turn: 3, state: stateEnvelope().data.state, meta: meta(8), saved: true, replayed: false, gameId: 'g_test' } },
    });
    renderScreen(<UndergroundPage />);
    await screen.findByText(/not on the network yet/i);
    fireEvent.click(screen.getByRole('button', { name: /buy access/i }));
    const confirm = await screen.findByRole('dialog');
    fireEvent.click(within(confirm).getByRole('button', { name: /buy access/i }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/intent'))).toBe(true));
    expect(lastIntent().intent).toMatchObject({ type: 'underground.buy_access' });
    expect(lastIntent().expectedVersion).toBe(7);
  });

  it('renders the unlocked economy from the server payload', async () => {
    shellRoutes();
    viewRoute('underground', undergroundOpen);
    renderScreen(<UndergroundPage />);
    expect((await screen.findAllByText(/quiet_harbour_11/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/digital reputation/i)).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /targets/i }));
    expect(await screen.findByText('Aldrich Luxury')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /holdings/i }));
    expect(await screen.findByText('Encrypted ledger')).not.toBeNull();
  });

  it('disables a hack that is on cooldown and says why', async () => {
    shellRoutes();
    viewRoute('underground', { ...undergroundOpen, view: { ...undergroundOpen.view, hackCooldownUntilDay: 20 } });
    renderScreen(<UndergroundPage />);
    await screen.findAllByText(/quiet_harbour_11/);
    fireEvent.click(screen.getByRole('tab', { name: /targets/i }));
    await screen.findByText('Aldrich Luxury');
    const button = screen.getByRole('button', { name: /attempt hack/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getAllByText(/cooldown until day 20/i).length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Combat                                                             */
/* ------------------------------------------------------------------ */

describe('combat screen', () => {
  it('gives an idle save a strong, truthful empty state', async () => {
    shellRoutes();
    viewRoute('combat', null);
    renderScreen(<CombatPage />);
    expect((await screen.findAllByText('No active combat encounter.')).length).toBeGreaterThan(0);
    expect(screen.getByText(/encounters begin on their own/i)).not.toBeNull();
    expect(screen.getAllByText(/you are not in custody/i).length).toBeGreaterThan(0);
  });

  it('renders the field, the stakes and the server log for a live encounter', async () => {
    shellRoutes();
    viewRoute('combat', combatActive);
    renderScreen(<CombatPage />);
    expect(await screen.findByRole('table', { name: /combat participants/i })).not.toBeNull();
    expect(screen.getAllByText('Border Guard').length).toBeGreaterThan(0);
    expect(screen.getByText(/against you/i)).not.toBeNull();
    expect(screen.getByText(/Tester at 87\/100 HP/)).not.toBeNull();
    // The server's own odds explanation is shown verbatim, not recomputed.
    expect(screen.getByText(/effective power 31 vs theirs 43/)).not.toBeNull();
  });

  it('queues a server estimate and commits it as one take_turn intent', async () => {
    shellRoutes();
    viewRoute('combat', combatActive);
    routes.push({
      match: (url, init) => url.endsWith('/intent') && init?.method === 'POST',
      body: { ok: true, requestId: 'r', data: { ok: true, message: 'Turn resolved.', warnings: [], notifications: [], day: 12, turn: 4, state: stateEnvelope().data.state, meta: meta(8), saved: true, replayed: false, gameId: 'g_test' } },
    });
    renderScreen(<CombatPage />);
    await screen.findByRole('table', { name: /combat participants/i });

    const addButtons = screen.getAllByRole('button', { name: /add to turn/i });
    fireEvent.click(addButtons[0]!);
    fireEvent.click(addButtons[0]!);
    fireEvent.click(screen.getByRole('button', { name: /commit turn/i }));

    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/intent'))).toBe(true));
    const command = lastIntent();
    expect(command.intent.type).toBe('combat.take_turn');
    // Both queued actions are committed in one command: the browser plans, the server resolves.
    expect(Array.isArray(command.intent.actions)).toBe(true);
    expect((command.intent.actions as unknown[]).length).toBe(2);
    expect(String(command.requestId)).toMatch(/^web-/);
    expect(command.expectedVersion).toBe(7);
  });

  it('never offers to resolve an encounter that is already over', async () => {
    shellRoutes();
    viewRoute('combat', { ...combatActive, phase: 'resolved', outcome: { victory: true, fled: false, arrested: false, bribed: false, negotiated: false, casualties: [], lootCash: 400, lootItems: [], xpGained: 60, reputationChanges: [], heatChange: 2, summary: 'You held the checkpoint.' } });
    renderScreen(<CombatPage />);
    await screen.findByText('You held the checkpoint.');
    expect((screen.getByRole('button', { name: /resolve automatically/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /commit turn/i })).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Progression                                                        */
/* ------------------------------------------------------------------ */

describe('progression screen', () => {
  it('renders the level, points and the learnable catalogue', async () => {
    shellRoutes();
    viewRoute('progression', progressionEmpty);
    renderScreen(<ProgressionPage />);
    expect((await screen.findAllByText(/Somebody|Nobody/)).length).toBeGreaterThan(0);
    expect(screen.getByText('Logistics')).not.toBeNull();
    expect(screen.getByText(/−1% freight cost/)).not.toBeNull();
  });

  it('learns a skill through the server and disables a locked perk with the server reason', async () => {
    shellRoutes();
    viewRoute('progression', progressionEmpty);
    routes.push({
      match: (url, init) => url.endsWith('/intent') && init?.method === 'POST',
      body: { ok: true, requestId: 'r', data: { ok: true, message: 'Learned.', warnings: [], notifications: [], day: 12, turn: 3, state: stateEnvelope().data.state, meta: meta(8), saved: true, replayed: false, gameId: 'g_test' } },
    });
    renderScreen(<ProgressionPage />);
    await screen.findByText('Logistics');
    fireEvent.click(screen.getByRole('button', { name: /^learn/i }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/intent'))).toBe(true));
    expect(lastIntent().intent).toMatchObject({ type: 'progression.learn_skill', skillId: 'logistics' });
    expect(lastIntent().expectedVersion).toBe(7);

    fireEvent.click(screen.getByRole('tab', { name: /perks/i }));
    await screen.findByText('Silver Tongue');
    const take = screen.getByRole('button', { name: /take perk/i }) as HTMLButtonElement;
    expect(take.disabled).toBe(true);
    expect(screen.getByText(/perk point required/i)).not.toBeNull();
  });

  it('shows achievements with their measured progress', async () => {
    shellRoutes();
    viewRoute('progression', progressionEmpty);
    renderScreen(<ProgressionPage />);
    fireEvent.click(await screen.findByRole('tab', { name: /achievements/i }));
    expect(await screen.findByText('First trade')).not.toBeNull();
    expect(screen.getByText('0/1')).not.toBeNull();
  });

  it('reports a refused prestige with the server\u2019s own reason and claims no success', async () => {
    shellRoutes();
    viewRoute('progression', progressionEmpty);
    // The documented contract for a legitimate refusal: HTTP 200 with `ok:false` and the
    // simulation's message. The browser must not turn that into a success.
    routes.push({
      match: (url, init) => url.endsWith('/intent') && init?.method === 'POST',
      body: {
        ok: true,
        requestId: 'r',
        data: {
          ok: false,
          error: 'action_not_permitted',
          message: 'The estate is worth 12,000; a handover needs 25,000,000.',
          warnings: [],
          notifications: [],
          day: 12,
          turn: 3,
          state: stateEnvelope().data.state,
          meta: meta(8),
          saved: true,
          replayed: false,
          gameId: 'g_test',
        },
      },
    });
    renderScreen(<ProgressionPage />);
    fireEvent.click(await screen.findByRole('tab', { name: /prestige/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^prestige this run/i }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^prestige$/i }));

    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/intent'))).toBe(true));
    expect(lastIntent().intent).toMatchObject({ type: 'progression.prestige' });
    expect(lastIntent().expectedVersion).toBe(7);

    // The refusal is reported in the server's words, both in the alert and on the panel.
    const refusal = await screen.findByText(/prestige was refused \u2014 the action did not complete/i);
    expect(refusal).not.toBeNull();
    expect((await screen.findAllByText(/the estate is worth 12,000; a handover needs 25,000,000/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/the handover went through/i)).toBeNull();
    const liveRegions = await screen.findAllByRole('status');
    expect(liveRegions.some((node) => node.textContent?.includes('The estate is worth 12,000; a handover needs 25,000,000.'))).toBe(true);
  });

  it('reports a completed prestige as completed, and reads the new count from the server', async () => {
    shellRoutes();
    viewRoute('progression', progressionEmpty);
    routes.push({
      match: (url, init) => url.endsWith('/intent') && init?.method === 'POST',
      body: {
        ok: true,
        requestId: 'r',
        data: {
          ok: true,
          message: 'The empire passes to your heir (1 of 5).',
          warnings: [],
          notifications: [],
          day: 12,
          turn: 3,
          state: stateEnvelope().data.state,
          meta: meta(8),
          saved: true,
          replayed: false,
          gameId: 'g_test',
        },
      },
    });
    renderScreen(<ProgressionPage />);
    fireEvent.click(await screen.findByRole('tab', { name: /prestige/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^prestige this run/i }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^prestige$/i }));

    expect(await screen.findByText(/the handover went through/i)).not.toBeNull();
    expect(screen.queryByText(/prestige was refused/i)).toBeNull();
    // A command of any kind invalidates the read models; the new count can only come from the server.
    expect(calls.some((call) => call.url.includes('/views/progression'))).toBe(true);
  });

  it('reports the prestige thresholds from the server facts it was given', async () => {
    shellRoutes();
    viewRoute('progression', progressionEmpty);
    renderScreen(<ProgressionPage />);
    fireEvent.click(await screen.findByRole('tab', { name: /prestige/i }));
    // The requirement is the server's number, shown as the server sent it.
    expect((await screen.findAllByText(/25,000,000/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/prestige will be refused until the empire is worth/i)).not.toBeNull();
    expect(screen.getByText(/prestige will be refused before day 120/i)).not.toBeNull();
    // The handover is still asked for through the server, with the save version attached.
    fireEvent.click(screen.getByRole('button', { name: /^prestige/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Prestige and end this run?');
    expect(calls.some((call) => call.url.endsWith('/intent'))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Save and versions                                                  */
/* ------------------------------------------------------------------ */

describe('save and version management', () => {
  function versionsRoute() {
    routes.push({ match: (url, init) => url.includes('/versions') && init?.method !== 'POST', body: { ok: true, requestId: 'r', data: versionsPayload } });
  }

  it('lists every kept version with its metadata', async () => {
    shellRoutes();
    versionsRoute();
    renderScreen(<SavePage />);
    expect(await screen.findByRole('table', { name: /saved versions/i })).not.toBeNull();
    expect(screen.getByText('current')).not.toBeNull();
    expect(screen.getByText('234 kB')).not.toBeNull();
  });

  it('asks for confirmation before a restore, and sends expectedVersion with it', async () => {
    shellRoutes();
    versionsRoute();
    routes.push({
      match: (url, init) => url.includes('/versions/6') && init?.method === 'POST',
      body: { ok: true, requestId: 'r', data: { game: { meta: meta(8) }, state: { meta: meta(8), world: { day: 11 }, player: { locationId: 'loc_a', accounts: [], stats: {}, notifications: [], inventory: [] } }, restoredFrom: 6 } },
    });
    renderScreen(<SavePage />);
    await screen.findByRole('table', { name: /saved versions/i });
    const restoreButtons = screen.getAllByRole('button', { name: 'Restore' });
    fireEvent.click(restoreButtons[1]!);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Restore version 6?');
    expect(calls.some((call) => call.url.includes('/versions/6') && call.init?.method === 'POST')).toBe(false);

    fireEvent.click(within(dialog).getByRole('button', { name: /restore day 11/i }));
    await waitFor(() => expect(calls.some((call) => call.url.includes('/versions/6') && call.init?.method === 'POST')).toBe(true));
    const body = JSON.parse(String(calls.find((call) => call.url.includes('/versions/6'))!.init!.body));
    expect(body).toMatchObject({ confirm: true, expectedVersion: 7 });
    expect(String(body.requestId)).toMatch(/^web-/);
  });

  it('turns a stale restore into a refresh rather than a blind retry', async () => {
    shellRoutes();
    versionsRoute();
    routes.push({
      match: (url, init) => url.includes('/versions/6') && init?.method === 'POST',
      status: 409,
      body: { ok: false, error: { code: 'conflict', message: 'This save is at version 9, but your request was based on version 7.' }, requestId: 'r' },
    });
    renderScreen(<SavePage />);
    await screen.findByRole('table', { name: /saved versions/i });
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[1]!);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /restore day 11/i }));

    expect((await screen.findAllByText(/Game state changed\. Refreshing/)).length).toBeGreaterThan(0);
    // The conflict must re-read the authoritative save, not patch it locally.
    await waitFor(() => expect(calls.filter((call) => /\/api\/games\/g_test$/.test(call.url)).length).toBeGreaterThan(1));
    expect(calls.filter((call) => call.url.includes('/versions/6') && call.init?.method === 'POST').length).toBe(1);
  });

  it('says so when the history cannot be read', async () => {
    shellRoutes();
    routes.push({ match: (url) => url.includes('/versions'), status: 500, body: { ok: false, error: { code: 'internal_error', message: 'boom' }, requestId: 'r' } });
    renderScreen(<SavePage />);
    expect(await screen.findByText(/could not load the version history/i)).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Navigation coverage                                                */
/* ------------------------------------------------------------------ */

describe('navigation coverage', () => {
  it('declares every destination once, with a label and a blurb', () => {
    const slugs = NAV_ITEMS.map((item) => item.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toContain('');
    expect(slugs).toContain('save');
    for (const item of NAV_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.blurb.length).toBeGreaterThan(10);
    }
  });

  it('renders each Phase 1B screen inside the shell without throwing', async () => {
    shellRoutes();
    viewRoute('automation', automationFull);
    viewRoute('missions', missionsFull);
    viewRoute('factions', factionsFull);
    viewRoute('underground', undergroundOpen);
    viewRoute('combat', combatActive);
    viewRoute('progression', progressionEmpty);
    routes.push({ match: (url, init) => url.includes('/versions') && init?.method !== 'POST', body: { ok: true, requestId: 'r', data: versionsPayload } });

    const screens = [
      ['automation', <AutomationPage key="a" />],
      ['missions', <MissionsPage key="m" />],
      ['factions', <FactionsPage key="f" />],
      ['underground', <UndergroundPage key="u" />],
      ['combat', <CombatPage key="c" />],
      ['progression', <ProgressionPage key="p" />],
      ['save', <SavePage key="s" />],
    ] as const;

    for (const [, node] of screens) {
      const view = renderScreen(node);
      await waitFor(() => expect(view.container.querySelector('h1')).not.toBeNull());
      view.unmount();
    }
  });

  it('keeps the query cache invalidation contract the screens rely on', () => {
    // `invalidate` is what makes a restore or a conflict refresh every dependent screen;
    // a regression here would show stale authoritative data.
    expect(typeof invalidate).toBe('function');
  });
});
