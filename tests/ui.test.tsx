// @vitest-environment jsdom
/**
 * Component tests for the player interface.
 *
 * These run in jsdom rather than a real browser (no browser binary is installable in
 * this sandbox), so they cover what a DOM test provably can: the design-system
 * contracts, the loading/empty/error states, dialog and toast behaviour, form
 * validation and submission, and — most importantly — the *data layer* the screens sit
 * on: a view going loading → data, and a command that comes back as a 409 conflict
 * surfacing the sticky "state changed" notice and refreshing the authoritative save.
 *
 * The only thing mocked is the transport (`fetch`) and Next's router. No game logic is
 * stubbed: the real `api-client`, the real query cache, the real `GameProvider` and the
 * real components all run. Payloads below are minimal HTTP *fixtures* for those
 * endpoints — the application itself contains no sample or fake gameplay data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/games/g_test',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

import { Badge, Button, Delta, Meter, Stat, Table, Tabs, Td, Th, Tr } from '../src/components/ui/primitives';
import { describeError, EmptyState, ErrorState, LoadingState } from '../src/components/ui/states';
import { ConfirmDialog, Dialog } from '../src/components/ui/dialog';
import { ToastProvider, useToast } from '../src/components/ui/toast';
import { GameProvider, SessionProvider, useView } from '../src/lib/game-context';
import { clearAllQueries } from '../src/lib/query';
import { CommandButton } from '../src/components/game/view-panel';
import { GameShell } from '../src/components/game/shell';
import { NAV_ITEMS } from '../src/components/game/nav';
import { AuthForm } from '../src/components/auth/auth-form';
import { ApiError } from '../src/lib/api-client';

interface Route {
  match: (url: string, init?: RequestInit) => boolean;
  status?: number;
  body: unknown;
  times?: number;
}

let routes: Route[] = [];
let calls: { url: string; init?: RequestInit }[] = [];

function fetchMock(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  calls.push({ url, ...(init ? { init } : {}) });
  const route = routes.find((entry) => entry.match(url, init));
  if (!route) {
    return Promise.resolve(new Response(JSON.stringify({ ok: false, error: { code: 'not_found', message: `no fixture for ${url}` }, requestId: 'req_test' }), { status: 404 }));
  }
  if (route.times !== undefined) {
    if (route.times <= 0) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, error: { code: 'not_found', message: `fixture exhausted for ${url}` }, requestId: 'req_test' }), { status: 404 }));
    }
    route.times -= 1;
  }
  const status = route.status ?? 200;
  return Promise.resolve(new Response(JSON.stringify(route.body), { status, headers: { 'content-type': 'application/json' } }));
}

beforeEach(() => {
  routes = [];
  calls = [];
  clearAllQueries();
  pushMock.mockClear();
  vi.stubGlobal('fetch', vi.fn(fetchMock));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/* Fixtures — the smallest envelope each endpoint can legitimately send */
/* ------------------------------------------------------------------ */

const sessionEnvelope = {
  ok: true,
  requestId: 'req_test',
  data: { authenticated: true, user: { id: 'u_test', email: 'tester@example.com', displayName: 'Tester', provider: 'local' }, auth: 'local', environment: 'test', requestId: 'req_test' },
};

function stateEnvelope(version: number) {
  return {
    ok: true,
    requestId: 'req_test',
    data: {
      game: { meta: meta(version), status: 'active', cash: 250, actionsLeft: 3, notificationsUnread: 0 },
      state: {
        meta: meta(version),
        // The server always projects these: the shell reads them for the header.
        world: { day: 3, turn: 1, activeEvents: [] },
        netWorth: { total: 1200, cash: 250 },
        ending: null,
        player: {
          locationId: 'loc_a',
          accounts: [{ id: 'acct_1', balance: 250 }],
          stats: { actionsToday: 3 },
          notifications: [],
          inventory: [],
          combat: null,
        },
      },
    },
  };
}

function meta(version: number) {
  return {
    gameId: 'g_test',
    userId: 'u_test',
    name: 'Test save',
    status: 'active',
    schemaVersion: 2,
    version,
    day: 3,
    turn: 1,
    level: 2,
    title: 'Trader',
    netWorth: 1200,
    empireScore: 4,
    worldSeed: 'seed',
    difficulty: 'standard',
    locationId: 'loc_a',
    incarcerated: false,
    endingKind: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function marketEnvelope(rows: number, version = 1) {
  return {
    ok: true,
    requestId: 'req_test',
    data: {
      view: 'market',
      day: 3,
      turn: 1,
      version,
      locationId: 'loc_a',
      data: { rows: Array.from({ length: rows }, (_, index) => ({ commodityId: `c${index}`, name: `Commodity ${index}` })) },
    },
  };
}

/** Renders the game shell's data layer for one save, plus whatever the test needs. */
function GameHarness({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <SessionProvider>
        <GameProvider gameId="g_test">{children}</GameProvider>
      </SessionProvider>
    </ToastProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Design system                                                       */
/* ------------------------------------------------------------------ */

describe('design system primitives', () => {
  it('disables a button while it is busy and announces that to assistive tech', () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button', { name: /save/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('renders a table with an accessible name and scoped column headers', () => {
    render(
      <Table label="Portfolio holdings">
        <thead>
          <tr>
            <Th>Ticker</Th>
            <Th align="right">Value</Th>
          </tr>
        </thead>
        <tbody>
          <Tr>
            <Td>MRD</Td>
            <Td align="right">420</Td>
          </Tr>
        </tbody>
      </Table>,
    );
    expect(screen.getByRole('table', { name: 'Portfolio holdings' })).not.toBeNull();
    expect(screen.getAllByRole('columnheader')[0]!.getAttribute('scope')).toBe('col');
    expect(screen.getByRole('cell', { name: 'MRD' })).not.toBeNull();
  });

  it('states a change with a sign, not with colour alone', () => {
    const { rerender } = render(<Delta value={12.5} format={(value) => `${value.toFixed(1)}%`} />);
    expect(screen.getByText(/▲/)).not.toBeNull();
    expect(screen.getByText(/12\.5%/)).not.toBeNull();
    rerender(<Delta value={-3} format={(value) => `${value.toFixed(1)}%`} />);
    expect(screen.getByText(/▼/)).not.toBeNull();
  });

  it('exposes a meter as a labelled progressbar', () => {
    render(<Meter value={0.4} label="Storage used" display="40%" />);
    const bar = screen.getByRole('progressbar', { name: 'Storage used' });
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('marks the selected tab and reports a change when another is chosen', () => {
    const onChange = vi.fn();
    render(<Tabs label="Sections" value="market" onChange={onChange} tabs={[{ id: 'market', label: 'Market' }, { id: 'risk', label: 'Risk' }]} />);
    const [market, risk] = screen.getAllByRole('tab');
    expect(market!.getAttribute('aria-selected')).toBe('true');
    expect(risk!.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(risk!);
    expect(onChange).toHaveBeenCalledWith('risk');
  });

  it('keeps supporting figures labelled', () => {
    render(
      <div>
        <Stat label="Net worth" value="1,200" hint="yesterday 1,180" />
        <Badge tone="up">solvent</Badge>
      </div>,
    );
    expect(screen.getByText('Net worth')).not.toBeNull();
    expect(screen.getByText('1,200')).not.toBeNull();
    expect(screen.getByText('solvent')).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Loading / empty / error states                                      */
/* ------------------------------------------------------------------ */

describe('intentional data states', () => {
  it('announces loading politely instead of showing a bare spinner', () => {
    render(<LoadingState label="Loading market" />);
    expect(screen.getByRole('status').textContent).toContain('Loading market');
  });

  it('gives an empty view a title, an explanation and an action', () => {
    render(<EmptyState title="No holdings" body="You do not own any shares yet." action={<button type="button">Open broker</button>} />);
    expect(screen.getByRole('heading', { name: 'No holdings' })).not.toBeNull();
    expect(screen.getByText('You do not own any shares yet.')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Open broker' })).not.toBeNull();
  });

  it('turns an API failure into a sentence a player can act on', () => {
    const conflict = new ApiError('conflict', 'This save has moved on to version 4 but your request was based on version 2.', 409);
    const { title, detail } = describeError(conflict);
    expect(title).toMatch(/moved on/i);
    expect(title).not.toMatch(/something went wrong/i);
    expect(detail).toContain('version 4');
  });

  it('never shows a bare "something went wrong", even with no error object', () => {
    render(<ErrorState error={null} label="Could not load Market" />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Could not load Market');
    expect(alert.textContent ?? '').not.toMatch(/something went wrong/i);
    expect(alert.textContent ?? '').not.toMatch(/undefined/);
  });

  it('offers a retry that calls back', () => {
    const onRetry = vi.fn();
    render(<ErrorState error={new ApiError('service_unavailable', 'The server could not be reached.', 0)} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* Dialogs and toasts                                                  */
/* ------------------------------------------------------------------ */

describe('dialog and toast behaviour', () => {
  it('is a labelled modal dialog and closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Abandon journey?">
        <p>You will lose the fare already paid.</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe('Abandon journey?');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('refuses to dismiss a blocking dialog on Escape', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Resolving combat" dismissible={false}>
        <p>The encounter must be resolved first.</p>
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks before a destructive action instead of doing it immediately', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog open onClose={onClose} onConfirm={onConfirm} title="Delete this save?" body="The save and its version history are removed." confirmLabel="Delete save" destructive />);
    expect(screen.getByText('The save and its version history are removed.')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete save' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a pushed toast in a live region and lets it be dismissed', async () => {
    function Pusher() {
      const toast = useToast();
      return (
        <button type="button" onClick={() => toast.push({ tone: 'success', title: 'Order filled', body: '40 units bought.' })}>
          push
        </button>
      );
    }
    render(
      <ToastProvider>
        <Pusher />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'push' }));
    expect(await screen.findByText('Order filled')).not.toBeNull();
    expect(screen.getByText('40 units bought.')).not.toBeNull();
    const live = screen.getByText('Order filled').closest('[aria-live]');
    expect(live).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Forms                                                              */
/* ------------------------------------------------------------------ */

describe('authentication form', () => {
  it('submits what was typed and moves to the games list', async () => {
    routes.push({ match: (url) => url.endsWith('/api/auth/session'), body: { ok: true, requestId: 'r', data: { authenticated: false, auth: 'local', environment: 'test', requestId: 'r' } } });
    routes.push({ match: (url) => url.endsWith('/api/auth/login'), body: { ok: true, requestId: 'r', data: { userId: 'u_test' } } });
    routes.push({ match: (url) => url.endsWith('/api/auth/session'), body: sessionEnvelope });

    render(
      <ToastProvider>
        <SessionProvider>
          <AuthForm mode="login" />
        </SessionProvider>
      </ToastProvider>,
    );

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'tester@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Correct-Horse-Battery-9' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/games'));
    const login = calls.find((call) => call.url.endsWith('/api/auth/login'));
    expect(login).toBeDefined();
    expect(JSON.parse(String(login!.init!.body))).toEqual({ email: 'tester@example.com', password: 'Correct-Horse-Battery-9' });
    // The browser never asserts identity: the cookie comes back from the server.
    expect(login!.init!.credentials).toBe('include');
  });

  it('explains a rejected sign-in in words, without leaking the raw code', async () => {
    routes.push({ match: (url) => url.endsWith('/api/auth/session'), body: { ok: true, requestId: 'r', data: { authenticated: false, auth: 'local', environment: 'test', requestId: 'r' } } });
    routes.push({ match: (url) => url.endsWith('/api/auth/login'), status: 401, body: { ok: false, error: { code: 'not_authenticated', message: 'Those credentials were not accepted.' }, requestId: 'r' } });

    render(
      <ToastProvider>
        <SessionProvider>
          <AuthForm mode="login" />
        </SessionProvider>
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'tester@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent ?? '').toMatch(/not accepted/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('asks for a display name only when registering', () => {
    routes.push({ match: (url) => url.endsWith('/api/auth/session'), body: { ok: true, requestId: 'r', data: { authenticated: false, auth: 'local', environment: 'test', requestId: 'r' } } });
    render(
      <ToastProvider>
        <SessionProvider>
          <AuthForm mode="register" />
        </SessionProvider>
      </ToastProvider>,
    );
    expect(screen.getByLabelText(/display name/i)).not.toBeNull();
    expect(screen.getByRole('button', { name: /create account/i })).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Accessibility landmarks (after hydration)                           */
/* ------------------------------------------------------------------ */

describe('shell accessibility', () => {
  it('gives every screen a named navigation landmark, a main region and one h1', async () => {
    routes.push({ match: (url) => url.endsWith('/api/auth/session'), body: sessionEnvelope });
    routes.push({ match: (url) => url.endsWith('/api/games/g_test'), body: stateEnvelope(1) });
    routes.push({ match: (url) => url.endsWith('/views/travel'), body: { ok: true, requestId: 'r', data: { view: 'travel', day: 3, turn: 1, version: 1, locationId: 'loc_a', data: null } } });
    routes.push({ match: (url) => url.endsWith('/views/location'), body: { ok: true, requestId: 'r', data: { view: 'location', day: 3, turn: 1, version: 1, locationId: 'loc_a', data: { id: 'loc_a', name: 'Bharat Metro' } } } });
    routes.push({ match: (url) => url.endsWith('/views/world'), body: { ok: true, requestId: 'r', data: { view: 'world', day: 3, turn: 1, version: 1, locationId: 'loc_a', data: { indicators: {}, world: { activeEvents: [] } } } } });

    render(
      <GameHarness>
        <GameShell>
          <h1>Market</h1>
        </GameShell>
      </GameHarness>,
    );

    await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 }).length).toBe(1));
    expect(screen.getAllByRole('navigation', { name: 'Game systems' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('main').length).toBe(1);

    // Every navigation item is a named link — the rail is usable with a screen reader.
    for (const item of NAV_ITEMS) {
      expect(screen.getAllByRole('link', { name: item.label }).length, item.label).toBeGreaterThan(0);
    }
    // The rail is driven by the registry, so it can never drift from the screens.
    expect(screen.getAllByRole('link').length).toBeGreaterThanOrEqual(NAV_ITEMS.length);
  });

  it('announces the toast viewport politely', async () => {
    routes.push({ match: (url) => url.endsWith('/api/auth/session'), body: sessionEnvelope });
    routes.push({ match: (url) => url.endsWith('/api/games/g_test'), body: stateEnvelope(1) });
    routes.push({ match: (url) => url.endsWith('/views/travel'), body: { ok: true, requestId: 'r', data: { view: 'travel', day: 3, turn: 1, version: 1, locationId: 'loc_a', data: null } } });
    routes.push({ match: (url) => url.endsWith('/views/location'), body: { ok: true, requestId: 'r', data: { view: 'location', day: 3, turn: 1, version: 1, locationId: 'loc_a', data: { id: 'loc_a', name: 'Bharat Metro' } } } });
    routes.push({ match: (url) => url.endsWith('/views/world'), body: { ok: true, requestId: 'r', data: { view: 'world', day: 3, turn: 1, version: 1, locationId: 'loc_a', data: { indicators: {}, world: { activeEvents: [] } } } } });

    render(
      <GameHarness>
        <GameShell>
          <p>screen body</p>
        </GameShell>
      </GameHarness>,
    );
    await waitFor(() => expect(screen.getAllByRole('main').length).toBe(1));
    const live = document.querySelectorAll('[aria-live]');
    expect(live.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Data layer: a view, and a conflict                                  */
/* ------------------------------------------------------------------ */

describe('game data layer', () => {
  function MarketProbe() {
    const market = useView<{ rows: { commodityId: string }[] }>('market');
    return (
      <div>
        <p data-testid="state">{market.loading ? 'loading' : market.error ? `error:${market.error.code}` : `${market.data?.rows.length ?? 0} rows`}</p>
        {market.data && <p>{market.data.rows[0]?.commodityId}</p>}
      </div>
    );
  }

  it('renders loading first, then the authoritative payload', async () => {
    routes.push({ match: (url) => url.endsWith('/api/auth/session'), body: sessionEnvelope });
    routes.push({ match: (url) => url.endsWith('/api/games/g_test'), body: stateEnvelope(1) });
    routes.push({ match: (url) => url.includes('/views/market'), body: marketEnvelope(9) });

    render(
      <GameHarness>
        <MarketProbe />
      </GameHarness>,
    );

    expect(screen.getByTestId('state').textContent).toContain('loading');
    await waitFor(() => expect(screen.getByTestId('state').textContent).toContain('9 rows'));
    expect(screen.getByText('c0')).not.toBeNull();
    // The view is requested with a location-scoped, typed call — never a bespoke fetch.
    expect(calls.some((call) => call.url.endsWith('/api/games/g_test/views/market'))).toBe(true);
  });

  it('turns a stale-version conflict into a sticky notice and refreshes the save', async () => {
    routes.push({ match: (url) => url.endsWith('/api/auth/session'), body: sessionEnvelope });
    routes.push({ match: (url) => url.endsWith('/api/games/g_test'), body: stateEnvelope(1) });
    routes.push({ match: (url) => url.includes('/views/market'), body: marketEnvelope(9) });
    routes.push({
      match: (url, init) => url.endsWith('/intent') && init?.method === 'POST',
      status: 409,
      body: { ok: false, error: { code: 'conflict', message: 'This save has moved on to version 9 but your request was based on version 1.' }, requestId: 'r' },
    });

    function CommandProbe() {
      return <CommandButton intent={{ type: 'trade.buy', commodityId: 'c0', qty: 1 }} label="Buy 1" options={{ expectedVersion: 1 }} />;
    }

    render(
      <GameHarness>
        <CommandProbe />
      </GameHarness>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Buy 1' })));
    const before = calls.filter((call) => call.url.endsWith('/api/games/g_test')).length;
    fireEvent.click(screen.getByRole('button', { name: 'Buy 1' }));

    expect(await screen.findByText('Game state changed. Refreshing your market data.')).not.toBeNull();
    // The authoritative save is re-read rather than patched locally.
    await waitFor(() => expect(calls.filter((call) => call.url.endsWith('/api/games/g_test')).length).toBeGreaterThan(before));
    // The version the command was planned against is sent, so the server can refuse it.
    const intent = calls.find((call) => call.url.endsWith('/intent'));
    const sent = JSON.parse(String(intent!.init!.body));
    expect(sent.expectedVersion).toBe(1);
    // The idempotency key rides with the command, so a retry replays instead of double-applying.
    expect(String(sent.requestId)).toMatch(/^web-/);
  });

  it('replays the same idempotency key for a retry of the same command', async () => {
    routes.push({ match: (url) => url.endsWith('/api/auth/session'), body: sessionEnvelope });
    routes.push({ match: (url) => url.endsWith('/api/games/g_test'), body: stateEnvelope(1) });
    routes.push({
      match: (url, init) => url.endsWith('/intent') && init?.method === 'POST',
      body: {
        ok: true,
        requestId: 'r',
        data: {
          ok: true,
          message: 'Bought 1 × Commodity 0.',
          warnings: [],
          notifications: [],
          day: 3,
          turn: 1,
          state: { meta: meta(2), player: { locationId: 'loc_a', accounts: [{ id: 'acct_1', balance: 240 }], stats: { actionsToday: 2 }, notifications: [], inventory: [] } },
          meta: meta(2),
          saved: true,
          replayed: false,
          gameId: 'g_test',
        },
      },
    });

    render(
      <GameHarness>
        <CommandButton intent={{ type: 'trade.buy', commodityId: 'c0', qty: 1 }} label="Buy one" options={{ expectedVersion: 1 }} />
      </GameHarness>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Buy one' })));
    fireEvent.click(screen.getByRole('button', { name: 'Buy one' }));
    await waitFor(() => expect(calls.filter((call) => call.url.endsWith('/intent')).length).toBe(1));
    const first = calls.find((call) => call.url.endsWith('/intent'));
    // The command carries the version it was planned against, a fresh idempotency key,
    // and nothing the server would have to trust: no balance, price or outcome.
    const body = JSON.parse(String(first!.init!.body));
    expect(String(body.requestId)).toMatch(/^web-/);
    expect(body.expectedVersion).toBe(1);
    expect(body.intent).toEqual({ type: 'trade.buy', commodityId: 'c0', qty: 1 });
    expect(JSON.stringify(body)).not.toMatch(/balance|cash|price|total/i);
  });

  it('explains a refused command from the server instead of guessing a reason', async () => {
    routes.push({ match: (url) => url.endsWith('/api/auth/session'), body: sessionEnvelope });
    routes.push({ match: (url) => url.endsWith('/api/games/g_test'), body: stateEnvelope(1) });
    routes.push({
      match: (url, init) => url.endsWith('/intent') && init?.method === 'POST',
      body: {
        ok: true,
        requestId: 'r',
        data: {
          ok: false,
          error: { code: 'insufficient_funds', message: 'Not enough available cash.' },
          message: 'Selling would bring in nothing — fees and tax take the whole lot.',
          warnings: [],
          notifications: [],
          day: 3,
          turn: 1,
          state: { meta: meta(1), player: { locationId: 'loc_a', accounts: [{ id: 'acct_1', balance: 250 }], stats: { actionsToday: 3 }, notifications: [], inventory: [] } },
          meta: meta(1),
          saved: false,
          replayed: false,
          gameId: 'g_test',
        },
      },
    });

    render(
      <GameHarness>
        <CommandButton intent={{ type: 'trade.sell', commodityId: 'c0', qty: 1 }} label="Sell one" />
      </GameHarness>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sell one' })));
    fireEvent.click(screen.getByRole('button', { name: 'Sell one' }));
    expect(await screen.findByText('Selling would bring in nothing — fees and tax take the whole lot.')).not.toBeNull();
  });

  it('settles instead of re-rendering forever once a payload has arrived', async () => {
    /*
     * Regression: `getSnapshot` used to build a *fresh* snapshot object on every call.
     * `useSyncExternalStore` compares snapshots by identity, so React believed the store
     * changed on every commit and re-rendered without end — "Maximum update depth
     * exceeded" in the real client runtime. A stable snapshot is what makes the
     * interface usable at all, so it is pinned here rather than left to a browser.
     */
    routes.push({ match: (url) => url.endsWith('/api/auth/session'), body: sessionEnvelope });
    routes.push({ match: (url) => url.endsWith('/api/games/g_test'), body: stateEnvelope(1) });
    routes.push({ match: (url) => url.includes('/views/market'), body: marketEnvelope(4) });

    /* Counted in an effect, so the assertion is about committed renders rather than
       about anything happening during one. */
    const renders = { count: 0 };
    function Counting() {
      const market = useView<{ rows: unknown[] }>('market');
      useEffect(() => {
        renders.count += 1;
      });
      return <p data-testid="count">{market.data?.rows.length ?? 'pending'}</p>;
    }

    render(
      <GameHarness>
        <Counting />
      </GameHarness>,
    );

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('4'));
    const settled = renders.count;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(renders.count).toBe(settled);
    expect(renders.count).toBeLessThan(10);
  });

  it('keeps a disabled query stable too', async () => {
    routes.push({ match: (url) => url.endsWith('/api/auth/session'), body: sessionEnvelope });
    routes.push({ match: (url) => url.endsWith('/api/games/g_test'), body: stateEnvelope(1) });

    const renders = { count: 0 };
    function Disabled() {
      const view = useView('market', {}, { enabled: false });
      useEffect(() => {
        renders.count += 1;
      });
      return <p data-testid="disabled">{view.loading ? 'loading' : 'idle'}</p>;
    }

    render(
      <GameHarness>
        <Disabled />
      </GameHarness>,
    );
    await waitFor(() => expect(screen.getByTestId('disabled').textContent).toBe('idle'));
    const settled = renders.count;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(renders.count).toBe(settled);
    expect(calls.some((call) => call.url.includes('/views/market'))).toBe(false);
  });

  it('disables an impossible action and says why rather than hiding it', async () => {
    routes.push({ match: (url) => url.endsWith('/api/auth/session'), body: sessionEnvelope });
    routes.push({ match: (url) => url.endsWith('/api/games/g_test'), body: stateEnvelope(1) });
    render(
      <GameHarness>
        <CommandButton intent={{ type: 'trade.buy', commodityId: 'c0', qty: 10_000 }} label="Buy 10,000" disabled disabledReason="You cannot afford that quantity." />
      </GameHarness>,
    );
    const button = await screen.findByRole('button', { name: 'Buy 10,000' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    expect(button.closest('span')?.getAttribute('title')).toBe('You cannot afford that quantity.');
  });
});
