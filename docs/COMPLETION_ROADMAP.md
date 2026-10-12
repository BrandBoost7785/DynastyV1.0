# Completion Roadmap — Arena AI / Dynasty

- Audit date: 2026-10-12 (UTC)
- Baseline: `docs/REQUIREMENTS_MATRIX.md` (401 requirement rows: 53 IMPL, 225 IMPL-THIN, 108 PARTIAL, 9 MISSING, 1 DEFERRED, 5 PROCESS)
- Current status and blockers: `docs/PROJECT_STATUS.md`
- Branch: `arena/75a7979e-dynastyv1-0`

This roadmap is a plan. Nothing in it has been started, except the audit itself. Phase names other than "Phase 3" are proposals, because the spec does not define phases. Phase 4 and Phase 5 are **not started**, and this document does not authorise starting them.

## Where things stand

- **Implemented in code:** the trade and market engine, the world graph, factions and war, debt and interest, enforcement and underground markets, progression and prestige, supply chains, the persistence and save system with versioning and compare-and-set, and guest identity. Gates pass on 2026-10-12 (exit 0): typecheck; lint (0 errors, 6 warnings); the full test run (410 passed, 13 skipped); and the production build. The PostgreSQL identity suite passes 14 of 14 on a disposable PostgreSQL 18.4 (`PROJECT_STATUS.md` section 2a).
- **Not implemented:** Phase 4 (NPC production, NPC borrowing, dynamic infrastructure). Refinancing, bonds, investor funding, a settings screen, and any E2E or browser test suite.
- **Not verified:** RLS under a non-superuser role; TLS to Postgres; Supabase `auth`; migration `0004` on any live database; production auth and proxy configuration; PWA installability; responsive layout.

## Phase sequence

### R0 — Reconcile the repository (COMPLETE on 2026-10-12; documentation commit pending)

**Goal:** a single, clean, verifiable state of the branch.

- Done: the local worktree was verified against the remote and backed up. It was preserved in `stash@{0}` (`a374aefe…`) and an external backup, and the branch was fast-forwarded (`--ff-only`) to `origin/arena/75a7979e-dynastyv1-0` at `68db6fa`. Commits brought in: `625bf60`, `5dc9b76`, `2bb2a69`, `820e4da`, `9c97056`, `68db6fa`. No reset, rebase, or force-push was used.
- Remaining: commit the four `docs/` audit files on this branch, after verification.

**Exit:** `git status` clean after the documentation commit; HEAD equals the remote tip; the spec is recorded in `docs/MASTER_GAME_SPEC.md` with its checksum.

**Matrix rows:** S45-02.

### R1 — Verify persistence and auth on a disposable database (partly complete)

**Goal:** show the Postgres path behaves like the SQLite path.

- Done: `tests/postgres-identity.test.ts` (14 cases: 13 PostgreSQL tests and 1 gating test) passed 14 of 14 with `DYNASTY_DISPOSABLE_POSTGRES_URL` set to a disposable local database (PostgreSQL 18.4, loopback only). Exit 0, 0 skipped.
- Done: migrations `0001`–`0004` applied in order to that disposable database only. Never to a live database.
- Open: verify RLS policies from `0002` with two owners under a non-superuser role (`authenticated`). The identity suite connects as a superuser, which bypasses RLS.
- Open: exercise TLS to Postgres, or record that the production TLS path is unverified.
- Triage any failure without weakening tests, CAS, version, auth, ownership, or RLS checks. No failures so far.

**Exit:** all 14 identity tests pass on Postgres with the command and exit code recorded (done), and the two-owner RLS check is passing with its command and exit code recorded (open).

**Matrix rows:** S26-01, S26-03, S26-07, S27-08, S29-05, S29-10, S35-06, S47-02, S50-04, S50-08.

### R2 — Close the known guest-mode and UX defects

**Goal:** the player journey matches the guest-mode constraints without open defects.

- Remove the dead `/leaderboard` link (`src/components/games/game-library.tsx:110`), or add the page.
- Decide on the login and register API routes (`src/app/api/auth/login`, `register`). Remove them, or record why they stay.
- Fix the 390px horizontal overflow on the game page (`scrollWidth` 622).
- Add a cleanup for expired guest session rows.
- Resolve the `refetchQuery` in-flight join behaviour and the `verify-live` count variance.
- The dev preview was restarted on 2026-10-12 and serves the reconciled code. Hot reload still blocks cross-origin `/_next/hmr` from the preview host until it is listed in `allowedDevOrigins`. Decide whether to authorise that config change.

**Exit:** new tests for each fix, shown to fail before the fix and pass after. No existing test changed to make it pass.

**Matrix rows:** S02-02, S24-01, S24-02, S29-01, S44-03, S50-20.

### R3 — Close the test gaps (engine and browser)

**Goal:** the thin areas get direct evidence, and the core loop is verified end to end.

- Stocks: dividends, mergers, failures, crashes, bubbles.
- Crypto: exchanges, liquidity, staking, mining, crashes.
- Combat: skill checks, escape, arrest, injuries, pursuits, raids.
- Logistics: shipments, theft, insurance, refrigerated storage, fuel, maintenance.
- Inflation and cycles, and a test that arbitrage is bounded.
- A browser test suite covering the 25-step core loop in §49. This needs a new dependency; it needs authorisation first.

**Exit:** a passing E2E run of the §49 loop recorded in the status document, and a test for each thin row.

**Matrix rows:** S10-*, S11-*, S13-*, S19-*, S35-04, S35-05, S35-08, S35-12, S36-02, S36-07, S36-11, S36-12, S49-*, S50-25, S49-26.

### R4 — Close the finance and UI gaps

**Goal:** the missing features in §9 and §23 exist, or are formally descoped.

- Refinancing (S09-10), investor funding (S09-13), and bonds (S09-15). Each needs a design decision first, because they touch the save model and the balance config.
- A settings screen (S23-25).
- A price-history chart on the market page (S23-06).
- A notification centre (S23-24).
- Dedicated reputation view (S23-20).
- Explicit speculation mechanics in stocks and crypto (S10-06, S11-06).
- Crypto-specific technology events (S11-08).
- Standalone celebrity-demand event (S20-06).
- Currency-movement model, or formal descoping, for the event causal chain (S20-09).
- Explicit deflation state (S05-02).

**Exit:** each row is either IMPL with tests or formally marked as out of scope by the user.

### R5 — Operations, observability, and PWA

**Goal:** the app can be deployed, diagnosed, and installed.

- Structured logging to replace ad hoc `console` calls (S38-01), and an error-reporting hook (S38-04). Choose the library first; a dependency change needs authorisation.
- Development inspection tools (S38-05, S38-07), building on `scripts/inspect-economy.ts`.
- Explanations of why a price, event, or outcome occurred (S38-08, S40-01).
- Rate limiting and trusted-proxy configuration verified at the real edge (S29-06).
- Secrets and deployment environment verified, including `DYNASTY_APP_SECRET` (S29-07, S46-02).
- npm: production dependencies have 0 vulnerabilities (`npm audit --omit=dev`, exit 0). The five high findings (GHSA-vfj7-8cjw-p6xm, `braces`) sit in the devDependency `eslint-config-next`. The suggested fix is a semver-major downgrade, so it needs user authorisation.
- PWA: a fetch handler or an explicit offline decision (S25-03, S25-05, S44-05). Verify installability in a real browser.
- Lint: fix the six `react-hooks/exhaustive-deps` warnings.

**Exit:** deployment checklist in `PROJECT_STATUS.md` section 8 is fully ticked, each item with evidence.

### R6 — Persistence model decision (§26)

**Goal:** a recorded decision on the save model before scaling work.

- Keep the sealed JSON document per version, with the reasons written down, or plan normalisation into domain tables.
- The decision affects save size (S32-01), query efficiency (S32-02), and multiplayer readiness (S28-02).

**Exit:** an architecture decision record in `docs/`, agreed with the user.

### Phase 4 — NPC production, NPC borrowing, dynamic infrastructure (NOT STARTED; on hold)

**Scope (as recorded in the audit):**

- NPC trade agents that produce goods (S05-07, S21-02).
- NPC agents that borrow (S05-07, S21-02).
- Infrastructure that responds to events and usage, not static scaling (S21-01; `src/sim/economy.ts:149`, `src/sim/properties.ts:57,82`, `src/sim/state.ts:251`).
- A world that feels alive (S21-03).

**Entry criteria** (all required before Phase 4 starts):

1. R0 complete, so the branch is clean and reconciled.
2. R1 complete, so the Postgres path is verified.
3. The Phase 4 scope confirmed by the user, since the repository does not define it.
4. Balance parameters for NPC production and borrowing added to `src/config/balance.ts`. The 360 market-book cap stays as it is unless the user changes it explicitly.

**Note:** Phase 4 is not complete if the tests pass. Completion needs the spec rows above to be IMPL with evidence.

### Phase 5 (NOT STARTED; not defined in the repository)

No scope was found in the spec or the repository. Do not start it until the user defines it.

## Recommended next step

R0 is complete apart from the documentation commit. Finish **R1**: the two-owner RLS check under the `authenticated` role, and the TLS decision. Those unblock R2 onward. Do not start Phase 4 yet.

## Constraints that apply to every phase

- Work only on `arena/75a7979e-dynastyv1-0`. Push only to that branch.
- Do not weaken tests, CAS, version, auth, ownership, or RLS checks.
- Do not loosen TypeScript or add suppressions.
- Do not apply migrations to a live database.
- Do not raise the 360 market-book cap silently.
- Do not claim production readiness from SQLite results.
- Do not print or commit secrets, and do not expose session tokens or `worldSeed`.
