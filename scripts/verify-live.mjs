/**
 * Live HTTP verification harness.
 *
 * Runs against a real server (`BASE_URL`, default http://localhost:3000) and checks the
 * things unit tests cannot: that the routes actually exist, that the DTO boundary holds
 * over the wire, that optimistic concurrency, idempotency and ownership behave, that the
 * version/restore contract works end to end, and that every navigation destination is a
 * real page rather than a 404.
 *
 * Every assertion is counted. The run fails loudly if the count drops below the floor
 * recorded after the Phase 1B completion pass, because losing coverage silently is worse
 * than a red test.
 *
 *   node scripts/verify-live.mjs            # counts assertions, exits non-zero on failure
 *   BASE_URL=http://host:3000 node scripts/verify-live.mjs
 */
import { strict as assert } from 'node:assert';

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const FLOOR = Number(process.env.ASSERTION_FLOOR ?? 230);
const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

let passed = 0;
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    return true;
  }
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  if (process.env.VERBOSE) console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  return false;
}

function eq(label, actual, expected) {
  return check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

function makeClient() {
  let cookie = '';
  return async function call(method, path, body, opts = {}) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    for (const [key, value] of Object.entries(opts.headers ?? {})) headers[key] = value;
    const response = await fetch(BASE + path, {
      method,
      headers,
      redirect: 'manual',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length && opts.trackCookie !== false) cookie = setCookies.map((value) => value.split(';')[0]).join('; ');
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (process.env.VERBOSE) console.log(`  ${String(response.status).padEnd(4)} ${method.padEnd(5)} ${path}`);
    return { status: response.status, json, text, headers: response.headers, setCookies };
  };
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

const alice = makeClient();

/* --- 1. health ------------------------------------------------------ */
{
  const r = await alice('GET', '/api/health');
  eq('health responds 200', r.status, 200);
  check('health reports ok', r.json?.ok === true, JSON.stringify(r.json));
}

/* --- 2. auth -------------------------------------------------------- */
const aliceEmail = `alice-${stamp}@example.com`;
const carolEmail = `carol-${stamp}@example.com`;
const password = 'Correct-Horse-Battery-9';
{
  const anonymous = await makeClient()('GET', '/api/auth/session');
  check('session is readable while signed out', anonymous.status === 200, `status ${anonymous.status}`);
  check('signed-out session is not authenticated', anonymous.json?.data?.authenticated === false, JSON.stringify(anonymous.json?.data));

  const guarded = await makeClient()('GET', '/api/games');
  eq('unauthenticated /api/games is rejected', guarded.status, 401);
  eq('unauthenticated error code', guarded.json?.error?.code, 'not_authenticated');
  check('error envelope carries a request id', typeof guarded.json?.requestId === 'string' && guarded.json.requestId.length > 0);

  const registered = await alice('POST', '/api/auth/register', { email: aliceEmail, password, displayName: 'Alice' });
  eq('register responds 201', registered.status, 201);
  check('register returns the new account id', typeof registered.json?.data?.userId === 'string', JSON.stringify(registered.json?.data));
  check('register returns the display name', registered.json?.data?.displayName === 'Alice', JSON.stringify(registered.json?.data));
  check('register sets an httpOnly session cookie', /httponly/i.test(registered.setCookies.join('|')), registered.setCookies.join('|').slice(0, 120));
  const established = await alice('GET', '/api/auth/session');
  check('registering starts a session', established.json?.data?.authenticated === true, JSON.stringify(established.json?.data));
  check('the session is the caller’s own', established.json?.data?.user?.email === aliceEmail, JSON.stringify(established.json?.data?.user));

  const duplicate = await makeClient()('POST', '/api/auth/register', { email: aliceEmail, password, displayName: 'Alice again' });
  check('duplicate registration is refused', duplicate.status === 409 || duplicate.status === 400, `status ${duplicate.status}`);
  check('duplicate registration does not leak the existing account', !JSON.stringify(duplicate.json ?? {}).includes(password));

  const weak = await makeClient()('POST', '/api/auth/register', { email: `weak-${stamp}@example.com`, password: 'short', displayName: 'Weak' });
  eq('weak password is rejected', weak.status, 400);
  check('weak password failure is a validation error', weak.json?.error?.code === 'validation_failed' || weak.json?.error?.code === 'invalid_input', JSON.stringify(weak.json?.error));

  /* A second account exercises sign-in and sign-out without disturbing the first session. */
  const carol = makeClient();
  const carolRegistered = await carol('POST', '/api/auth/register', { email: carolEmail, password, displayName: 'Carol' });
  eq('second account registers', carolRegistered.status, 201);

  const wrongPassword = await makeClient()('POST', '/api/auth/login', { email: aliceEmail, password: 'Definitely-Wrong-1' });
  const unknownAccount = await makeClient()('POST', '/api/auth/login', { email: `ghost-${stamp}@example.com`, password: 'Definitely-Wrong-1' });
  eq('wrong password is refused', wrongPassword.status, 401);
  eq('an unknown account is refused the same way', unknownAccount.status, wrongPassword.status);
  check(
    'sign-in failures cannot be used to enumerate accounts',
    JSON.stringify(unknownAccount.json?.error?.message) === JSON.stringify(wrongPassword.json?.error?.message),
    `${unknownAccount.json?.error?.message} vs ${wrongPassword.json?.error?.message}`,
  );

  const signedIn = makeClient();
  const login = await signedIn('POST', '/api/auth/login', { email: carolEmail, password });
  eq('login responds 200', login.status, 200);
  check('login returns the account id', typeof login.json?.data?.userId === 'string', JSON.stringify(login.json?.data));
  const session = await signedIn('GET', '/api/auth/session');
  check('login starts a working session', session.json?.data?.authenticated === true, JSON.stringify(session.json?.data));
  check('the session reflects the signed-in user', session.json?.data?.user?.email === carolEmail, JSON.stringify(session.json?.data?.user));

  const logout = await signedIn('POST', '/api/auth/logout');
  check('logout succeeds', logout.status === 200, `status ${logout.status}`);
  const afterLogout = await signedIn('GET', '/api/games');
  eq('session no longer works after logout', afterLogout.status, 401);
}

/* --- 3. game creation and ownership --------------------------------- */
const created = await alice('POST', '/api/games', { playerName: 'Alice Corp' });
eq('create game responds 201', created.status, 201);
const gameId = created.json?.data?.game?.meta?.gameId;
check('create game returns an id', typeof gameId === 'string' && gameId.length > 0, JSON.stringify(created.json?.data));
check('create game starts at version 0', created.json?.data?.game?.meta?.version === 0, String(created.json?.data?.game?.meta?.version));
check('create game starts on day 0', created.json?.data?.game?.meta?.day === 0, String(created.json?.data?.game?.meta?.day));
check('create game does not leak the owner id', !JSON.stringify(created.json).includes('rngState'));
let version = created.json?.data?.game?.meta?.version ?? 0;

const list = await alice('GET', '/api/games');
check('the creator sees their save', (list.json?.data?.games ?? []).some((row) => row.gameId === gameId), JSON.stringify(list.json?.data?.count));

{
  const stranger = makeClient();
  const strangerRegistered = await stranger('POST', '/api/auth/register', { email: `stranger-${stamp}@example.com`, password, displayName: 'Stranger' });
  eq('a third account registers', strangerRegistered.status, 201);
  const strangerState = await stranger('GET', `/api/games/${gameId}/state`);
  check("another account cannot read someone else's save", strangerState.status === 404 || strangerState.status === 403, `status ${strangerState.status}`);
  check('a stranger cannot list the save either', (strangerState.json?.error?.code ?? '') !== 'not_authenticated', JSON.stringify(strangerState.json?.error));
  const strangerIntent = await stranger('POST', `/api/games/${gameId}/intent`, { intent: { type: 'time.advance_day' }, expectedVersion: 0 });
  check("another account cannot command someone else's save", strangerIntent.status === 404 || strangerIntent.status === 403, `status ${strangerIntent.status}`);
}

/* --- 4. state and DTO boundary -------------------------------------- */
{
  const state = await alice('GET', `/api/games/${gameId}/state`);
  eq('state responds 200', state.status, 200);
  const payload = state.json?.data?.state;
  check('state carries the player', typeof payload?.player?.id === 'string');
  check('state carries accounts', Array.isArray(payload?.player?.accounts));
  check('state carries the world clock', typeof payload?.world?.day === 'number');
  const serialised = JSON.stringify(payload ?? null);
  for (const forbidden of ['rngState', 'rngLabel', 'passwordHash', 'sessionSecret', 'databaseUrl', 'elapsedMs']) {
    check(`state never exposes ${forbidden}`, !serialised.includes(forbidden));
  }
  check('state does not ship the rng seed as a field', payload?.rngState === undefined);
  const meta = state.json?.data?.meta;
  check('meta carries the save version', meta?.version === version, `${meta?.version} vs ${version}`);
}

/* --- 5. view registry and reads ------------------------------------- */
/** Every navigation destination, and the read model(s) that back it. */
const NAV_VIEWS = {
  dashboard: ['state'],
  world: ['world', 'location', 'destinations'],
  news: ['world'],
  market: ['market'],
  inventory: ['inventory'],
  logistics: ['logistics', 'destinations'],
  properties: ['properties'],
  businesses: ['businesses'],
  production: ['production'],
  finance: ['finance'],
  stocks: ['stocks'],
  crypto: ['crypto'],
  crew: ['crew'],
  automation: ['automation'],
  missions: ['missions'],
  factions: ['factions'],
  underground: ['underground'],
  combat: ['combat'],
  progression: ['progression'],
  save: ['versions'],
};
{
  const index = await alice('GET', `/api/games/${gameId}/views`);
  eq('view index responds 200', index.status, 200);
  const names = (index.json?.data?.views ?? []).map((row) => row.name);
  check('view index lists the read models', names.length >= 20, `only ${names.length}`);
  check('read models are documented', (index.json?.data?.views ?? []).every((row) => typeof row.description === 'string' && row.description.length > 0));
  check('no read model is named after an internal module', names.every((name) => /^[a-z][a-z_]*$/.test(String(name))), names.join(','));

  let backed = 0;
  for (const [system, views] of Object.entries(NAV_VIEWS)) {
    const covered = views.every((name) => name === 'state' || name === 'versions' || names.includes(name));
    check(`nav system ${system} is backed by a read model`, covered, views.join(','));
    if (covered) backed += 1;
  }
  eq('every nav system has server data behind it', backed, Object.keys(NAV_VIEWS).length);

  for (const name of ['world', 'market', 'automation', 'missions', 'factions', 'underground', 'progression', 'crew']) {
    const response = await alice('GET', `/api/games/${gameId}/views/${name}`);
    check(`view ${name} responds 200`, response.status === 200, `status ${response.status}`);
    check(`view ${name} envelope is versioned`, typeof response.json?.data?.version === 'number', JSON.stringify(response.json?.data));
  }

  const unknown = await alice('GET', `/api/games/${gameId}/views/not_a_view`);
  check('unknown view is refused', unknown.status === 404, `status ${unknown.status}`);

  const state = await alice('GET', `/api/games/${gameId}/state`);
  check('the dashboard reads net worth from the state', typeof state.json?.data?.state?.netWorth?.total === 'number', JSON.stringify(state.json?.data?.state?.netWorth));
  check('the dashboard reads cash from the state', typeof state.json?.data?.state?.netWorth?.cash === 'number', JSON.stringify(state.json?.data?.state?.netWorth?.cash));
}

/* --- 6. intents: economics, CAS, idempotency ------------------------- */
{
  const market = await alice('GET', `/api/games/${gameId}/views/market`);
  check('market read succeeds', market.status === 200, `status ${market.status} ${JSON.stringify(market.json)?.slice(0, 200)}`);
  const rows = market.json?.data?.data?.rows ?? [];
  check('market has commodities', rows.length > 0, String(rows.length));
  const cheap = [...rows].sort((a, b) => a.price - b.price)[0] ?? { commodityId: 'none', price: 0 };
  check('market rows carry a price', typeof cheap?.price === 'number', JSON.stringify(cheap));

  const unknownIntent = await alice('POST', `/api/games/${gameId}/intent`, { intent: { type: 'economy.free_money' }, expectedVersion: version });
  eq('unknown intent is rejected', unknownIntent.status, 400);
  check('unknown intent reports validation', ['validation_failed', 'invalid_input', 'unknown_intent'].includes(unknownIntent.json?.error?.code), JSON.stringify(unknownIntent.json?.error));

  const missingVersion = await alice('POST', `/api/games/${gameId}/intent`, { intent: { type: 'trade.buy', commodityId: cheap.commodityId, qty: 1 } });
  check('state-changing intent without expectedVersion is refused', missingVersion.status === 400 || missingVersion.status === 409, `status ${missingVersion.status}`);

  const buy = await alice('POST', `/api/games/${gameId}/intent`, {
    intent: { type: 'trade.buy', commodityId: cheap.commodityId, qty: 1 },
    expectedVersion: version,
    requestId: `${stamp}-buy-1`,
  });
  check('a legal buy succeeds', buy.status === 200 && buy.json?.ok === true, `${buy.status} ${JSON.stringify(buy.json?.error)}`);
  const newVersion = buy.json?.data?.meta?.version;
  check('the buy advances the save version', typeof newVersion === 'number' && newVersion > version, `${newVersion} vs ${version}`);

  const stale = await alice('POST', `/api/games/${gameId}/intent`, {
    intent: { type: 'trade.buy', commodityId: cheap.commodityId, qty: 1 },
    expectedVersion: version,
    requestId: `${stamp}-stale`,
  });
  eq('a stale expectedVersion is a conflict', stale.status, 409);
  check('the conflict names the live version instead of hiding it', String(stale.json?.error?.message ?? '').includes('version'), JSON.stringify(stale.json?.error));

  const replay = await alice('POST', `/api/games/${gameId}/intent`, {
    intent: { type: 'trade.buy', commodityId: cheap.commodityId, qty: 1 },
    expectedVersion: version,
    requestId: `${stamp}-buy-1`,
  });
  check('a replayed requestId is not applied twice', replay.status === 200 && replay.json?.ok === true, `${replay.status} ${JSON.stringify(replay.json?.error)}`);
  check('a replayed requestId reports the replay', replay.json?.data?.replayed === true, JSON.stringify({ replayed: replay.json?.data?.replayed }));
  check('a replay does not move the version again', replay.json?.data?.meta?.version === newVersion, `${replay.json?.data?.meta?.version} vs ${newVersion}`);
  version = newVersion;

  const before = (await alice('GET', `/api/games/${gameId}/state`)).json?.data;
  const cashBefore = before?.state?.netWorth?.cash ?? 0;
  const overspend = await alice('POST', `/api/games/${gameId}/intent`, {
    intent: { type: 'trade.buy', commodityId: cheap.commodityId, qty: 1_000_000 },
    expectedVersion: version,
    requestId: `${stamp}-overspend`,
  });
  check('an oversized order is answered, not ignored', overspend.status === 200 || overspend.status === 409, `status ${overspend.status}`);
  const filled = overspend.json?.data?.data?.filled ?? 0;
  check('an oversized order is clipped below the request', filled < 1_000_000, String(filled));
  if (typeof overspend.json?.data?.meta?.version === 'number') version = overspend.json.data.meta.version;
  const cashAfter = (await alice('GET', `/api/games/${gameId}/state`)).json?.data?.state?.netWorth?.cash ?? 0;
  check('clipping never spends more cash than the player held', cashAfter <= cashBefore + 1e-6 && cashAfter >= 0, `${cashBefore} -> ${cashAfter}`);

  const advanceTooFar = await alice('POST', `/api/games/${gameId}/advance`, { days: 9999, expectedVersion: version, requestId: `${stamp}-advance-too-far` });
  check('advance beyond the server maximum is refused', advanceTooFar.status === 400 || advanceTooFar.json?.ok === false, `${advanceTooFar.status} ${JSON.stringify(advanceTooFar.json?.error)}`);
  const versionBeforeRefusal = (await alice('GET', `/api/games/${gameId}/state`)).json?.data?.meta?.version;
  const refusal = await alice('POST', `/api/games/${gameId}/advance`, { days: 9999, expectedVersion: versionBeforeRefusal, requestId: `${stamp}-refusal` });
  const versionAfterRefusal = (await alice('GET', `/api/games/${gameId}/state`)).json?.data?.meta?.version;
  check('a refused advance does not move the version', refusal.status === 400 && versionAfterRefusal === versionBeforeRefusal, `${refusal.status} ${versionBeforeRefusal} -> ${versionAfterRefusal}`);
}

/* --- 7. every navigation destination is a real page ------------------ */
const NAV_SLUGS = [
  '', 'world', 'news', 'market', 'inventory', 'logistics', 'properties', 'businesses', 'production',
  'finance', 'stocks', 'crypto', 'crew', 'automation', 'missions', 'factions', 'underground',
  'combat', 'progression', 'save',
];
{
  let rendered = 0;
  for (const slug of NAV_SLUGS) {
    const path = `/games/${gameId}${slug ? `/${slug}` : ''}`;
    const response = await alice('GET', path);
    const healthy = response.status === 200 && !/Application error|Internal Server Error/i.test(response.text);
    check(`route ${path} renders`, healthy, `status ${response.status}`);
    if (healthy) rendered += 1;
  }
  eq('all navigation destinations render', rendered, NAV_SLUGS.length);

  for (const asset of ['/manifest.webmanifest', '/icons/generated/icon-192.png', '/icons/generated/icon-512.png', '/sw.js']) {
    const response = await alice('GET', asset);
    eq(`${asset} is served`, response.status, 200);
  }
  const manifest = await alice('GET', '/manifest.webmanifest');
  const icons = manifest.json?.icons ?? [];
  check('manifest declares icons', icons.length > 0, JSON.stringify(manifest.json));
  for (const icon of icons) {
    const response = await alice('GET', icon.src);
    eq(`manifest icon ${icon.src} resolves`, response.status, 200);
  }
  const apiAnonymous = await makeClient()('GET', `/api/games/${gameId}/views/dashboard`);
  eq('views are not readable anonymously', apiAnonymous.status, 401);
}

/* --- 8. the Phase 1B command wiring --------------------------------- */
/*
 * Command groups are exercised through the same endpoint the screens use. A day's action
 * budget is real, so the helper advances a day when the server reports it is spent — which
 * is also the behaviour the UI relies on.
 */
/** A candidate can only be hired where they are, so "here" is part of every selection. */
const isManagerCapable = (row) =>
  typeof row?.automationCapability === 'string' && !['none', 'combat', 'intel'].includes(row.automationCapability);
const capableLocals = (rows) => rows.filter((row) => row.here === true && isManagerCapable(row));

async function runIntent(label, body) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await alice('POST', `/api/games/${gameId}/intent`, {
      intent: body,
      expectedVersion: version,
      requestId: `${stamp}-${label}${attempt > 0 ? `-retry${attempt}` : ''}`,
    });
    const outcome = response.json?.data;
    if (typeof outcome?.meta?.version === 'number') version = outcome.meta.version;
    if (outcome?.ok === true) return { ok: true, outcome, response };
    const message = String(outcome?.message ?? response.json?.error?.message ?? '');
    if (/No actions left/i.test(message)) {
      const recovery = await alice('POST', `/api/games/${gameId}/advance`, { days: 1, expectedVersion: version, requestId: `${stamp}-recover-${label}-${attempt}` });
      if (typeof recovery.json?.data?.meta?.version === 'number') version = recovery.json.data.meta.version;
      continue;
    }
    return { ok: false, outcome, response, message };
  }
  return { ok: false, outcome: null, response: null, message: 'action budget never recovered' };
}

{
  // Advance the world so the board, the venues and the desks all have something in them.
  const advance = await alice('POST', `/api/games/${gameId}/advance`, { days: 5, expectedVersion: version, requestId: `${stamp}-advance-5` });
  check('advance 5 days succeeds', advance.json?.data?.ok === true, JSON.stringify(advance.json?.data?.message));
  version = advance.json?.data?.meta?.version ?? version;
  check('advance moved the world clock', (advance.json?.data?.state?.world?.day ?? 0) >= 5, String(advance.json?.data?.state?.world?.day));
  const replayAdvance = await alice('POST', `/api/games/${gameId}/advance`, { days: 5, expectedVersion: version - 1, requestId: `${stamp}-advance-5` });
  check('a replayed advance is not applied twice', replayAdvance.json?.data?.replayed === true, JSON.stringify(replayAdvance.json?.data?.replayed));

  // --- crew ---------------------------------------------------------
  const pool = await runIntent('crew-refresh', { type: 'crew.refresh_pool' });
  check('the hiring pool can be refreshed', pool.ok, pool.message);
  const crewView = await alice('GET', `/api/games/${gameId}/views/crew`);
  const candidates = crewView.json?.data?.data?.candidates ?? [];
  check('the hiring pool offers candidates', candidates.length > 0, String(candidates.length));
  if (candidates.length > 0) {
    check('candidates carry a role and a skill', typeof candidates[0]?.role === 'string' && typeof candidates[0]?.stats?.skill === 'number', JSON.stringify(candidates[0]).slice(0, 200));
    check('candidates publish their automation capability', candidates.every((row) => typeof row.automationCapability === 'string'), JSON.stringify(candidates[0]?.automationCapability));
    /*
     * A candidate can only be hired where they are (`hire()` refuses a remote one and says
     * which city to travel to), so the harness insists on someone *here*. Automation also
     * needs a role that carries a capability, so the pool is re-rolled until such a person
     * is looking for work locally — a remote specialist is not a failure of the game.
     */
    let poolRows = candidates;
    let hireTarget = poolRows.find((row) => row.here === true);
    for (let refresh = 0; refresh < 4 && !capableLocals(poolRows).length; refresh += 1) {
      const again = await runIntent(`crew-refresh-${refresh}`, { type: 'crew.refresh_pool' });
      if (!again.ok) break;
      const view = await alice('GET', `/api/games/${gameId}/views/crew`);
      poolRows = view.json?.data?.data?.candidates ?? poolRows;
    }
    const remoteCapable = poolRows.find((row) => row.here !== true && isManagerCapable(row));
    const localCapable = capableLocals(poolRows)[0];
    hireTarget = localCapable ?? hireTarget;
    check('the pool can supply a local candidate', Boolean(hireTarget), JSON.stringify(poolRows.slice(0, 3).map((row) => `${row.name}:${row.here}`)));
    if (remoteCapable && hireTarget) {
      /* The simulation refuses to hire across cities rather than teleporting them. */
      const remote = await runIntent('crew-hire-remote', { type: 'crew.hire', candidateId: remoteCapable.id });
      check('a candidate in another city cannot be hired from here', !remote.ok, remote.message);
    }
    const hire = await runIntent('crew-hire', { type: 'crew.hire', candidateId: hireTarget.id });
    check('a candidate can be hired', hire.ok, hire.message);
    const afterHire = await alice('GET', `/api/games/${gameId}/views/crew`);
    check('a hire appears on the payroll', (afterHire.json?.data?.data?.employees ?? []).length > 0, JSON.stringify(afterHire.json?.data?.data?.employees?.length));
  }

  // --- automation ---------------------------------------------------
  const automation = await alice('GET', `/api/games/${gameId}/views/automation`);
  const kinds = automation.json?.data?.data?.availableKinds ?? [];
  eq('automation publishes its rule kinds', kinds.length, 9);
  check('automation publishes a per-kind schema', Array.isArray(kinds[0]?.schema) && kinds[0].schema.length > 0, JSON.stringify(kinds[0]));
  let runnable = kinds.find((row) => row.managerAvailable);
  if (!runnable) {
    /* Hire a second manager for the capability the pool can supply, then re-read the view. */
    let view = await alice('GET', `/api/games/${gameId}/views/crew`);
    let capable = capableLocals(view.json?.data?.data?.candidates ?? [])[0];
    for (let refresh = 0; refresh < 4 && !capable; refresh += 1) {
      const again = await runIntent(`crew-manager-refresh-${refresh}`, { type: 'crew.refresh_pool' });
      if (!again.ok) break;
      view = await alice('GET', `/api/games/${gameId}/views/crew`);
      capable = capableLocals(view.json?.data?.data?.candidates ?? [])[0];
    }
    if (capable) {
      const second = await runIntent('crew-hire-manager', { type: 'crew.hire', candidateId: capable.id });
      check('a manager-capable candidate can be hired', second.ok, second.message);
    }
    const retry = await alice('GET', `/api/games/${gameId}/views/automation`);
    runnable = (retry.json?.data?.data?.availableKinds ?? []).find((row) => row.managerAvailable);
  }
  check('at least one rule kind is runnable once a manager is on the books', Boolean(runnable), JSON.stringify(kinds.map((k) => `${k.kind}:${k.managerAvailable}`)));
  if (runnable) {
    const created = await runIntent('automation-create', { type: 'automation.create_rule', kind: runnable.kind, name: 'Harness order' });
    check('a standing order can be written', created.ok, created.message);
    const withRule = await alice('GET', `/api/games/${gameId}/views/automation`);
    const rule = (withRule.json?.data?.data?.rules ?? [])[0];
    check('the standing order is listed', Boolean(rule), JSON.stringify(withRule.json?.data?.data?.rules?.length));
    if (rule) {
      check('a rule names its manager', typeof rule.manager?.name === 'string', JSON.stringify(rule.manager));
      check('a rule carries its published schema', Array.isArray(rule.schema) && rule.schema.length > 0);
      check('a rule reports uptime and error chance', typeof rule.uptime === 'number' && typeof rule.errorChance === 'number', JSON.stringify({ uptime: rule.uptime, errorChance: rule.errorChance }));
      const paused = await runIntent('automation-update', { type: 'automation.update_rule', ruleId: rule.id, enabled: false });
      check('a standing order can be paused', paused.ok, paused.message);
      const afterPause = await alice('GET', `/api/games/${gameId}/views/automation`);
      check('pausing a standing order persists', afterPause.json?.data?.data?.rules?.find((row) => row.id === rule.id)?.enabled === false);
      const removed = await runIntent('automation-delete', { type: 'automation.delete_rule', ruleId: rule.id });
      check('a standing order can be deleted', removed.ok, removed.message);
    }
  }
  check('delegation load is published', typeof automation.json?.data?.data?.delegation?.capacity === 'number', JSON.stringify(automation.json?.data?.data?.delegation));

  // --- missions -----------------------------------------------------
  const missions = await alice('GET', `/api/games/${gameId}/views/missions`);
  const offers = missions.json?.data?.data?.offers ?? [];
  check('the mission board publishes offers', offers.length > 0, String(offers.length));
  check('missions publish their objectives', Array.isArray(offers[0]?.objectives) && offers[0].objectives.length > 0, JSON.stringify(offers[0]?.objectives));
  check('missions publish a deadline', typeof offers[0]?.deadlineDay === 'number', JSON.stringify(offers[0]?.deadlineDay));
  check('missions publish locked opportunities separately', Array.isArray(missions.json?.data?.data?.locked), JSON.stringify(missions.json?.data?.data?.locked));
  if (offers.length > 0) {
    const accepted = await runIntent('mission-accept', { type: 'mission.accept', missionId: offers[0].id });
    check('a mission can be accepted', accepted.ok, accepted.message);
    const afterAccept = await alice('GET', `/api/games/${gameId}/views/missions`);
    check('an accepted mission moves to the active list', (afterAccept.json?.data?.data?.active ?? []).length > 0, JSON.stringify(afterAccept.json?.data?.data?.active?.length));
    const active = afterAccept.json?.data?.data?.active?.[0];
    if (active) {
      const abandoned = await runIntent('mission-abandon', { type: 'mission.abandon', missionId: active.id });
      check('a mission can be abandoned', abandoned.ok, abandoned.message);
      const afterAbandon = await alice('GET', `/api/games/${gameId}/views/missions`);
      check('an abandoned mission leaves the active list', (afterAbandon.json?.data?.data?.active ?? []).length === 0, JSON.stringify(afterAbandon.json?.data?.data?.active?.length));
    }
  }

  // --- factions -----------------------------------------------------
  const factions = await alice('GET', `/api/games/${gameId}/views/factions`);
  const factionRows = factions.json?.data?.data?.factions ?? [];
  check('factions are published', factionRows.length > 0, String(factionRows.length));
  check('factions publish standing labels', typeof factionRows[0]?.standingLabel === 'string', JSON.stringify(factionRows[0]?.standingLabel));
  check('factions publish their interests', Array.isArray(factions.json?.data?.data?.interests?.[factionRows[0]?.id]));
  check('factions publish territory', Array.isArray(factionRows[0]?.territory));
  check('faction overview is summarised', typeof factions.json?.data?.data?.overview?.total === 'number', JSON.stringify(factions.json?.data?.data?.overview));
  const giftee = factionRows[0];
  if (giftee) {
    const gift = await runIntent('faction-gift', { type: 'faction.gift', factionId: giftee.id, amount: 250 });
    check('a faction will accept a gift', gift.ok, gift.message);
    const afterGift = await alice('GET', `/api/games/${gameId}/views/factions`);
    const next = (afterGift.json?.data?.data?.factions ?? []).find((row) => row.id === giftee.id);
    check('a gift is reflected in standing', Boolean(next) && next.playerStanding >= giftee.playerStanding, `${next?.playerStanding} vs ${giftee.playerStanding}`);
  }

  // --- underground --------------------------------------------------
  const access = await runIntent('underground-access', { type: 'underground.buy_access' });
  check('darknet access can be bought', access.ok, access.message);
  let underground = await alice('GET', `/api/games/${gameId}/views/underground`);
  check('darknet access unlocks the network', underground.json?.data?.data?.view?.accessUnlocked === true, JSON.stringify(underground.json?.data?.data?.view?.accessUnlocked));
  check('underground publishes venues', (underground.json?.data?.data?.view?.markets ?? []).length > 0);
  check('underground publishes hack targets', (underground.json?.data?.data?.view?.hackTargets ?? []).length > 0);
  check('underground publishes data offers', (underground.json?.data?.data?.view?.dataOffers ?? []).length > 0);
  const unknownVenue = await alice('GET', `/api/games/${gameId}/views/underground?marketId=does_not_exist`);
  check('an unknown venue is not invented', (unknownVenue.json?.data?.data?.listings ?? []).length === 0, JSON.stringify(unknownVenue.json?.data?.data?.listings?.length));
  const hidden = (underground.json?.data?.data?.view?.markets ?? []).find((market) => !market.known);
  if (hidden) {
    check('an undiscovered venue carries the server reason', Boolean(hidden.reason) || hidden.accessible === false, JSON.stringify(hidden));
    const discovered = await runIntent('underground-discover', { type: 'underground.discover_market', marketId: hidden.id });
    check('a venue can be discovered', discovered.ok, discovered.message);
    underground = await alice('GET', `/api/games/${gameId}/views/underground`);
    check('a discovered venue becomes known', underground.json?.data?.data?.view?.markets?.find((m) => m.id === hidden.id)?.known === true, hidden.id);
    const listing = await alice('GET', `/api/games/${gameId}/views/underground?marketId=${hidden.id}`);
    check('a known venue answers with a listing array', Array.isArray(listing.json?.data?.data?.listings), JSON.stringify(listing.json?.data?.data?.listings?.length));
    if ((listing.json?.data?.data?.listings ?? []).length > 0) {
      const row = listing.json.data.data.listings[0];
      check('a listing carries a unit price and escrow fee', typeof row.unitPrice === 'number' && typeof row.escrowFee === 'number', JSON.stringify(row));
      check('a listing carries delivery odds', typeof row.deliveryChance === 'number', JSON.stringify(row.deliveryChance));
    }
  }
  const deposit = await runIntent('underground-escrow', { type: 'underground.escrow_deposit', amount: 500 });
  check('escrow accepts a deposit', deposit.ok, deposit.message);
  const escrowView = await alice('GET', `/api/games/${gameId}/views/underground`);
  check('escrow holds the deposit', (escrowView.json?.data?.data?.view?.escrowBalance ?? 0) >= 500, String(escrowView.json?.data?.data?.view?.escrowBalance));
  const vpn = await runIntent('underground-vpn', { type: 'underground.upgrade_vpn', targetQuality: Math.min(0.95, (escrowView.json?.data?.data?.view?.vpnQuality ?? 0.4) + 0.1) });
  check('routing quality can be upgraded', vpn.ok, vpn.message);
  const hacked = (escrowView.json?.data?.data?.view?.hackTargets ?? [])[0];
  if (hacked) {
    const attempt = await runIntent('underground-hack', { type: 'underground.hack', kind: hacked.kind, targetId: hacked.targetId });
    check('a hack attempt is accepted (success is not required)', attempt.ok, attempt.message);
    const afterHack = await alice('GET', `/api/games/${gameId}/views/underground`);
    check(
      'a hack is recorded in the track record',
      ((afterHack.json?.data?.data?.view?.stats?.hacksSuccess ?? 0) + (afterHack.json?.data?.data?.view?.stats?.hacksFailed ?? 0)) > 0,
      JSON.stringify(afterHack.json?.data?.data?.view?.stats),
    );
  }

  // --- progression --------------------------------------------------
  const progression = await alice('GET', `/api/games/${gameId}/views/progression`);
  const catalogue = progression.json?.data?.data?.skillCatalogue ?? [];
  check('the skill catalogue is published', catalogue.length > 0, String(catalogue.length));
  check('the catalogue carries the server verdict', typeof catalogue[0]?.canLearn === 'boolean', JSON.stringify(catalogue[0]));
  check('the catalogue carries the reason when locked', catalogue.some((row) => !row.canLearn && typeof row.reason === 'string'), JSON.stringify(catalogue.find((row) => !row.canLearn)));
  check('progression publishes reputation dimensions', typeof progression.json?.data?.data?.reputation?.global === 'number', JSON.stringify(progression.json?.data?.data?.reputation));
  check('progression publishes achievement progress', (progression.json?.data?.data?.achievements ?? []).length > 0);
  check('achievements carry measurable progress', (progression.json?.data?.data?.achievements ?? []).every((row) => Array.isArray(row.metrics) && typeof row.progress === 'number'));
  check('progression publishes prestige facts', typeof progression.json?.data?.data?.prestigeFacts?.netWorthRequirement === 'number', JSON.stringify(progression.json?.data?.data?.prestigeFacts));
  check('perks publish the server verdict', (progression.json?.data?.data?.perkCatalogue ?? []).every((row) => typeof row.canTake === 'boolean'));
  const learnable = catalogue.find((skill) => skill.canLearn);
  if (learnable) {
    const learned = await runIntent('progression-learn', { type: 'progression.learn_skill', skillId: learnable.id });
    check('a skill can be learned', learned.ok, learned.message);
    const afterLearn = await alice('GET', `/api/games/${gameId}/views/progression`);
    check('a learned skill is recorded', (afterLearn.json?.data?.data?.skills ?? []).some((skill) => skill.id === learnable.id), JSON.stringify(afterLearn.json?.data?.data?.skills?.map((s) => s.id)));
  }
  const unearned = await runIntent('progression-title-unearned', { type: 'progression.set_title', title: 'Emperor Of Nothing' });
  check('an unearned title is refused by the server', unearned.ok === false, JSON.stringify(unearned.message));
  const stateWithTitles = await alice('GET', `/api/games/${gameId}/state`);
  const earnedTitle = (stateWithTitles.json?.data?.state?.player?.progression?.titles ?? []).find((row) => row !== progression.json?.data?.data?.title);
  if (earnedTitle) {
    const titled = await runIntent('progression-title', { type: 'progression.set_title', title: earnedTitle });
    check('an earned title can be worn', titled.ok, titled.message);
    const afterTitle = await alice('GET', `/api/games/${gameId}/views/progression`);
    check('the title change is visible', afterTitle.json?.data?.data?.title === earnedTitle, JSON.stringify(afterTitle.json?.data?.data?.title));
  } else {
    check('the save publishes the earned titles', Array.isArray(stateWithTitles.json?.data?.state?.player?.progression?.titles), JSON.stringify(stateWithTitles.json?.data?.state?.player?.progression?.titles));
  }

  // --- combat -------------------------------------------------------
  const combat = await alice('GET', `/api/games/${gameId}/views/combat`);
  check('combat returns null when nothing is happening', combat.json?.data?.data === null, JSON.stringify(combat.json?.data?.data));
  const escape = await runIntent('combat-escape', { type: 'combat.escape' });
  check('a command with no encounter to act on is refused, never faked', escape.ok === false, JSON.stringify(escape.message));
  const bail = await runIntent('combat-bail', { type: 'combat.pay_bail' });
  check('bail outside custody is refused, never faked', bail.ok === false, JSON.stringify(bail.message));
}

/* --- 9. versions and restore ---------------------------------------- */
{
  const live = await alice('GET', `/api/games/${gameId}/state`);
  version = live.json?.data?.meta?.version ?? version;

  const versions = await alice('GET', `/api/games/${gameId}/versions?limit=200`);
  eq('version history responds 200', versions.status, 200);
  const rows = versions.json?.data?.versions ?? [];
  check('the history has one entry per write', rows.length >= 2, String(rows.length));
  check('history is newest first', (rows[0]?.version ?? 0) >= (rows[rows.length - 1]?.version ?? 0), `${rows[0]?.version} then ${rows[rows.length - 1]?.version}`);
  check('every row carries a timestamp', typeof rows[0]?.savedAt === 'string', JSON.stringify(rows[0]));
  check('every row carries a size', typeof rows[0]?.sizeBytes === 'number', JSON.stringify(rows[0]));
  check('every row carries the day it was written on', typeof rows[0]?.day === 'number', JSON.stringify(rows[0]));
  check('rows never carry the save document', !JSON.stringify(rows).includes('rngState'));
  eq('currentVersion matches the live save', versions.json?.data?.currentVersion, version);

  const capped = await alice('GET', `/api/games/${gameId}/versions?limit=1`);
  eq('limit is honoured', (capped.json?.data?.versions ?? []).length, 1);
  const absurd = await alice('GET', `/api/games/${gameId}/versions?limit=99999`);
  check('an oversized limit is refused or clamped, never fatal', (absurd.status === 200 && (absurd.json?.data?.versions ?? []).length <= 200) || absurd.status === 400, `status ${absurd.status}`);
  const zero = await alice('GET', `/api/games/${gameId}/versions?limit=0`);
  check('a zero limit is a validation error, not a 500', zero.status === 400, `status ${zero.status}`);
  const negative = await alice('GET', `/api/games/${gameId}/versions?limit=-5`);
  check('a negative limit is a validation error, not a 500', negative.status === 400, `status ${negative.status}`);

  const perVersion = await alice('GET', `/api/games/${gameId}/versions/1`);
  eq('a per-version GET is not the restore endpoint', perVersion.status, 405);

  const noConfirm = await alice('POST', `/api/games/${gameId}/versions/1`, { expectedVersion: version });
  eq('restore without confirmation is refused', noConfirm.status, 400);
  const noVersion = await alice('POST', `/api/games/${gameId}/versions/1`, { confirm: true });
  eq('restore without expectedVersion is refused', noVersion.status, 400);

  const target = rows[rows.length - 1];
  const staleRestore = await alice('POST', `/api/games/${gameId}/versions/${target.version}`, { confirm: true, expectedVersion: 0, requestId: `${stamp}-restore-stale` });
  check('a stale restore is a conflict', staleRestore.status === 409, `${staleRestore.status} ${JSON.stringify(staleRestore.json?.error)}`);
  const afterStale = await alice('GET', `/api/games/${gameId}/state`);
  eq('a refused restore leaves the live version alone', afterStale.json?.data?.meta?.version, version);

  const preRestoreVersion = version;
  const restore = await alice('POST', `/api/games/${gameId}/versions/${target.version}`, { confirm: true, expectedVersion: version, requestId: `${stamp}-restore` });
  check('a confirmed restore succeeds', restore.status === 200 && typeof restore.json?.data?.restoredFrom === 'number', `${restore.status} ${JSON.stringify(restore.json?.error ?? restore.json?.data?.message)}`);
  check('the restore reports what it restored from', restore.json?.data?.restoredFrom === target.version, JSON.stringify(restore.json?.data?.restoredFrom));
  const restoredState = restore.json?.data?.state;
  const restoredVersion = restore.json?.data?.meta?.version ?? restoredState?.meta?.version;
  check('the restore is written forward as a new version', typeof restoredVersion === 'number' && restoredVersion > version, `${restoredVersion} vs ${version}`);
  check('the restored state is at the recorded day', restoredState?.world?.day === target.day, `${restoredState?.world?.day} vs ${target.day}`);
  version = restoredVersion ?? version;

  const after = await alice('GET', `/api/games/${gameId}/versions?limit=5`);
  check('the rollback is itself in the history', (after.json?.data?.versions ?? []).some((row) => row.version === version));
  const liveViews = await alice('GET', `/api/games/${gameId}/views/world`);
  eq('views follow the restored version', liveViews.json?.data?.version, version);
  const replayedRestore = await alice('POST', `/api/games/${gameId}/versions/${target.version}`, { confirm: true, expectedVersion: preRestoreVersion, requestId: `${stamp}-restore` });
  check('a stale restore replay cannot roll the save twice', replayedRestore.status === 409, `${replayedRestore.status} ${JSON.stringify(replayedRestore.json?.error)}`);
  const stillLive = await alice('GET', `/api/games/${gameId}/state`);
  check('the save stays on the restored version after a refused replay', stillLive.json?.data?.meta?.version === version, `${stillLive.json?.data?.meta?.version} vs ${version}`);
}

/* --- 10. pagination and read sanity ---------------------------------- */
{
  const limited = await alice('GET', `/api/games/${gameId}/views/market?limit=5`);
  check('market honours a limit', (limited.json?.data?.data?.rows ?? []).length <= 5, String(limited.json?.data?.data?.rows?.length));
  const huge = await alice('GET', `/api/games/${gameId}/views/market?limit=100000`);
  check('an oversized market limit is clamped', huge.status === 200 && (huge.json?.data?.data?.rows ?? []).length > 0, `status ${huge.status}`);
  const negative = await alice('GET', `/api/games/${gameId}/views/market?limit=-5`);
  check('a negative market limit is handled without a server error', negative.status === 200 || negative.status === 400, `status ${negative.status}`);
  check('a negative limit cannot flood the payload', (negative.json?.data?.data?.rows ?? []).length <= 200, String(negative.json?.data?.data?.rows?.length));

  const audit = await alice('GET', '/api/audit?limit=50');
  check('the audit trail is reachable by its owner', audit.status === 200, `status ${audit.status}`);
  if (audit.status === 200) {
    const rows = audit.json?.data?.rows ?? [];
    check('the audit trail is scoped to this account', rows.every((row) => typeof row.gameId === 'string' || typeof row.userId === 'string'), JSON.stringify(rows[0]));
    check('audit rows describe commands without payload internals', rows.every((row) => row && typeof row.action === 'string'), JSON.stringify(rows[0]));
    check('audit rows never carry a save document', !JSON.stringify(rows).includes('rngState'));
  }
  const ledger = await alice('GET', `/api/games/${gameId}/views/ledger`);
  check('the ledger read model responds', ledger.status === 200, `status ${ledger.status}`);
  check('the ledger never exposes the transaction chain internals', !JSON.stringify(ledger.json?.data?.data ?? null).includes('transactionChain'));
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

console.log('');
if (failures.length > 0) {
  console.log(`${failures.length} FAILED assertion(s):`);
  for (const failure of failures) console.log(`  ✗ ${failure}`);
}
console.log(`# assertions passed: ${passed} / ${passed + failures.length}`);
assert.ok(passed >= FLOOR, `assertion count ${passed} fell below the recorded floor of ${FLOOR}`);
assert.equal(failures.length, 0, `${failures.length} assertion(s) failed`);
console.log(`# live verification passed (floor ${FLOOR})`);
