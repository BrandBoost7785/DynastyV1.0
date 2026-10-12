# Project Status — Arena AI / Dynasty

- Audit date: 2026-10-12 (UTC)
- Branch: `arena/75a7979e-dynastyv1-0` (this session's branch; the session is fixed to it)
- Starting HEAD of this task: `fb4083d5095e227070683caf3f3f3ab4d0342d4d`
- HEAD after reconciliation, before the documentation commit: `68db6fabb457d0c9cd6da0af96be76715288c4c4` (fast-forward to the remote tip)
- Ending HEAD: the documentation commit on this branch. Its hash is reported in the final report and is the output of `git log -1`. It cannot be written into this file, because the file is part of that commit.
- Remote tip `origin/arena/75a7979e-dynastyv1-0`: `68db6fabb457d0c9cd6da0af96be76715288c4c4` at the time of reconciliation.
- Scope: spec recovery, reconciliation, verification, and documentation. No gameplay feature was implemented. Phase 4 and Phase 5 were not started.

> This document describes what the code and gate runs show today. It does not claim the game or the project is production-ready. Passing tests do not establish that Phase 4 is complete.

## 1. Spec recovery and reconciliation

| Step | Command or check | Exit / result |
| --- | --- | --- |
| Verify branch | `git rev-parse --abbrev-ref HEAD` | `arena/75a7979e-dynastyv1-0` |
| Fetch remote | `git fetch origin` | exit 0 |
| Divergence before reconciliation | `git rev-list --left-right --count HEAD...origin/arena/75a7979e-dynastyv1-0` | `0 6`: local was 0 ahead and 6 behind. Fast-forward only. |
| Local work verified against remote | Byte comparison of the worktree with the remote tree | 43 modified tracked files matched the remote byte for byte. 17 untracked source and test files matched. The 4 locally deleted auth pages are absent from the remote, so the deletions match. |
| External backup | `/tmp/arena-recon-20261012T193919Z/` (pointer in `/tmp/arena-recon-latest.txt`) | Contains the tracked-changes patch (47 files), an untracked-files tar (20 files), copies of the four docs, the gitignored `.data/` SQLite database, and `SHA256SUMS`. `sha256sum -c SHA256SUMS` passed. The patch reverse-applies cleanly. |
| Recovery stash | `git stash push --include-untracked -m "recon-20261012 pre-ff preserve (fb4083d)"` | exit 0. `stash@{0}` = `a374aefe35c5e597327f9f5c7e4b553a713f2da8`. Kept; not dropped. The untracked files are in `stash@{0}^3`. |
| Fast-forward | `git merge --ff-only origin/arena/75a7979e-dynastyv1-0` | exit 0. 64 files changed (5,423 insertions, 428 deletions). `package.json` and `package-lock.json` were not changed by the fast-forward. |
| Post-merge check | Stash tracked tree compared with HEAD; 20 stashed untracked files compared with HEAD | No tracked differences apart from the remote-only spec. All 20 untracked files identical to HEAD. |
| Locate spec | `git show 68db6fa:MASTER_GAME_SPEC.md` | Present in the remote commit (`Add files via upload`). Not in `/home/user/uploads/`, which does not exist. |
| Spec checksum | `sha256sum MASTER_GAME_SPEC.md` | exit 0. `a5e78a1b6e5dfaf690cc1f6efb82f80ecf966ae8fd7f9221a4397578c7ccd7c7`. Matches the value recorded before import. |
| Preserve spec | `docs/MASTER_GAME_SPEC.md` | Provenance block (source filename, source commit, import date, checksum), then the original bytes. The body after the rule line is byte-identical to the root file. |
| Reconstruction | None | The spec was not reconstructed from memory. |

**Status of the reconciliation.** Complete. The session branch now equals the remote tip. The remote commits brought in are `625bf60` (keep world seed out of public responses), `5dc9b76` (separate game identity from seed; insert-only creation), `2bb2a69` (verify Postgres save seal), `820e4da` (guest-first entry), `9c97056` (harden rate-limit identity and guest replacement), and `68db6fa` (adds the spec). No local-only edit was lost. The stash is kept as a recovery point.

**Branches.** Only `arena/75a7979e-dynastyv1-0` was changed. `main` and other remote branches were not updated. The session is fixed to this branch, so no other branch was created or pushed.

## 2. Gate results and verification log

All commands ran from the repository root on 2026-10-12. Logs are in `/tmp/arena-gates-20261012/` unless noted.

| Command | Exit | Result |
| --- | --- | --- |
| `npm run typecheck` (`tsc --noEmit`) | 0 | No type errors. |
| `npm run lint` | 0 | **0 errors, 6 warnings** (`react-hooks/exhaustive-deps` in production, world, properties, and charts pages). |
| `npm test` (`vitest run`, full) | 0 | 23 test files. **410 passed, 13 skipped (423 total).** The 13 skipped are the PostgreSQL identity suite, which runs only with `DYNASTY_DISPOSABLE_POSTGRES_URL` set. |
| `npm run build` (`prebuild` runs icon generation, then `next build`) | 0 | Compiled successfully. Routes include `/api/auth/login` and `/api/auth/register`. |
| `node /tmp/specaudit/check-matrix.mjs` | 0 | 401 rows, 401 unique IDs, 53 of 53 sections covered. Counts match the matrix Totals block. |
| `npm run db:migrate` against the disposable database (section 2a) | 0 | Applied `0001_initial_schema`, `0002_row_level_security`, `0003_intent_receipts`, `0004_guest_identity`. Health ok. |
| `npm run db:migrate` re-run | 0 | All four already current. Idempotent. |
| `npx vitest run tests/postgres-identity.test.ts` with the disposable URL (section 2a) | 0 | **14 passed, 0 skipped (14).** |
| `npm audit --omit=dev` | 0 | 0 vulnerabilities in production dependencies (section 2b). |
| `npm audit` (full) | 1 | 5 high-severity findings, all in development dependencies (section 2b). Exit 1 reports the findings; it is not a tool failure. |

Not re-run in this session: `npm ci`. An earlier `npm ci` (logged in `/tmp/specaudit/npm-ci.log`) added 526 packages and reported the same 5 high findings. The lockfile is unchanged, so the installed tree was used for these gates.

Not run: an end-to-end browser run (no committed E2E suite exists), and `npm run sim:inspect`.

Earlier notes cited a PostgreSQL run at `/tmp/arena-final-pgid.log` (14/14). That file is not present in this sandbox, so it is not used as evidence. The result in section 2a is from this session.

### 2a. PostgreSQL identity suite on a disposable database

Setup, all outside the repository:

- **Server:** PostgreSQL 18.4, from the `embedded-postgres@18.4.0-beta.17` npm package, installed in `/tmp/arena-pgtools/`. The repository's `package.json` and lockfile were not changed. The cluster is at `/tmp/arena-pg-data/`.
- **Listening:** `127.0.0.1:54329` only, with trust authentication on that loopback interface. No password was created, and no credential is stored in any file.
- **Database:** `dynasty_disposable_test`. The name contains `_test`, which satisfies the suite's disposable-name guard. No production or live database was contacted.
- **Supabase stand-ins (this disposable database only):** the roles `authenticated` and `anon`, an `auth` schema, and `auth.uid()` returning text. Migration `0002` needs these. They are not the Supabase implementation.
- **Transport:** `DYNASTY_DB_SSL=disable`, the adapter's documented setting, because the local server has no TLS. The TLS path that production would use was **not** exercised.
- **Environment:** `DATABASE_URL` and the process-level `DYNASTY_DISPOSABLE_POSTGRES_URL` were set only for the specific commands. The URL contains no password.

Results:

- Migrations applied in order on a fresh database, exit 0. Re-run, exit 0.
- `npx vitest run tests/postgres-identity.test.ts --reporter=verbose` with `DYNASTY_DISPOSABLE_POSTGRES_URL` set, exit 0: **14 passed, 0 skipped.** The 14 cases are 13 PostgreSQL tests (creation, insert-only and id-conflict handling, cross-owner refusal, compare-and-set, delete protection, load-back, versioned save and restore, stored-content tamper detection, guest with no email, provider check, save-seal tamper detection) and one gating test.

Not verified by this run:

- **RLS under a non-superuser role.** The suite connects as the `postgres` superuser, which bypasses RLS. Two-owner enforcement under `authenticated` is still open (roadmap R1).
- **TLS to Postgres.** Not exercised (see `DYNASTY_DB_SSL` above).
- **Supabase.** Not verified. Stand-ins only.
- **Any live database.** None was touched. Migration `0004` has not been applied to production.

### 2b. npm audit

- `npm audit --omit=dev` (production dependencies only): exit 0. **0 vulnerabilities** (info 0, low 0, moderate 0, high 0, critical 0).
- `npm audit` (full): exit 1. **5 high, 0 critical.** All five entries trace to one advisory, **GHSA-vfj7-8cjw-p6xm** (`braces` ≤ 3.0.3, stack-exhaustion denial of service through deeply nested patterns). The chain is `eslint-config-next@16.3.8` (a direct **devDependency**) → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces@3.0.3`. It is not in the production dependency tree (`npm ls eslint-config-next --omit=dev` is empty).
- npm's suggested fix is `eslint-config-next@14.2.35`. That is a semver-major **downgrade** from 16.3.8, so it was **not applied**. `npm audit fix` was not run, and `package.json` and the lockfile were not changed.
- Triage: development-tooling only; no production exposure found. Any change to `eslint-config-next` needs the user's authorisation.

Raw outputs: `/tmp/arena-gates-20261012/audit-prod.json` and `audit-full.json`.

## 3. Requirements status

The full matrix is `docs/REQUIREMENTS_MATRIX.md`. Counts below are its Totals block. Statuses were not changed by the reconciliation or the verification run. The verification run added evidence to some rows, and it is recorded in those rows' gap column.

| Status | Rows |
| --- | ---: |
| IMPL | 53 |
| IMPL-THIN | 225 |
| PARTIAL | 108 |
| MISSING | 9 |
| DEFERRED | 1 |
| PROCESS | 5 |
| **Total rows** | **401** |

Sections covered: 53 of 53 (preamble plus §1–§52). Every section has at least one row.

**MISSING (9):** refinancing (S09-10), investor funding (S09-13), bonds (S09-15), settings screen (S23-25), offline caching (S25-05), end-to-end tests (S35-05), structured logging (S38-01), error-reporting hooks (S38-04), browser verification of the full loop (S49-26).

**IMPL-THIN** means the code exists, but the evidence is limited to indirect tests, registry-level checks, or none. The matrix now states, row by row, which page or function has no direct test. In particular, no test renders the dashboard, world, market, finance, stocks, crypto, inventory, logistics, properties, businesses, production, crew, or news pages. Automation, progression, factions, underground, save, missions, and combat pages are rendered by `tests/screens.test.tsx`.

## 4. Phase 4 recovery status

**Phase 4 is not implemented.**

- The spec does not define phases. The Phase 4 scope used here comes from the audit: NPC industrial production, NPC borrowing, and dynamic infrastructure coupling.
- NPC trade agents exist (`src/sim/trade-network.ts`: capital, cargo, freight, halt on loss). They do **not** produce goods and do **not** borrow.
- Infrastructure is static scaling: `src/sim/economy.ts:149`, `src/sim/properties.ts:57,82`, `src/sim/state.ts:251`.
- No Phase 4 code, tests, or documents were found in the repository (`grep -rliE "phase ?4"` over `*.md` returned nothing).
- Passing tests cover the Phase 3 trade-network behaviour. They do not establish Phase 4.

**Action needed:** confirm the Phase 4 scope with the user. It is not written in the spec or in any repo document.

## 5. Registry and test counts

| Item | Count | Source |
| --- | ---: | --- |
| Commodities | 765 | `src/engine/registry` (`/tmp/specaudit/counts.json`) |
| Base commodities | 251 | same |
| Categories | 25 | same |
| Forms | 37 | same |
| Locations | 48 | same |
| Routes | 135 | same |
| Regions | 26 | same |
| Countries | 20 | same |
| Factions | 41 | same |
| Companies | 44 | same |
| Crypto assets | 20 | same |
| Vehicles | 18 | same |
| Properties | 28 | same |
| Businesses | 27 | same |
| Recipes | 44 | same |
| Skills | 35 | same |
| Perks | 41 | same |
| Employee roles | 24 | same |
| Enemies | 20 | same |
| Events | 71 | same |
| Missions | 27 | same |
| Achievements | 31 | same |
| Test files | 23 | `vitest run` |
| Tests (full run) | 423 total: 410 passed, 13 skipped | `npm test` (exit 0) |
| Tests (PostgreSQL identity, disposable DB) | 14 total: 14 passed, 0 skipped | section 2a (exit 0) |
| Literal `it()` calls | 416 | grep. The difference from 423 is parameterised loops. |

Spec §7 requires 500+ commodities; 765 meets it. Documentation drift: the header of `src/sim/markets.ts` says 763 SKUs; the registry gives 765.

## 6. Guest-mode status

Guest-mode is the most recent body of work. The constraints below were checked against code, tests, and grep.

| Constraint | Evidence | Status |
| --- | --- | --- |
| No login, signup, password, email, or verify in the player journey | `src/app/page.tsx:36` says no account or email is needed. The login and register pages are absent from HEAD. Shell shows email only for non-guests (`shell.tsx:344`). | Met in the UI. **Login and register API routes still exist** (`src/app/api/auth/login`, `register`), and the build includes them. Kept by owner decision. |
| No protected page redirects a guest to login | Grep for `redirect(` to `/login` or `/signup` in `src/` found nothing. | Met (grep). |
| Server-issued guest sessions | `tests/guest-mode.test.ts` "issues a server-side guest with no email and no password" | Met (test). |
| Credential is an HttpOnly cookie, never in the body | `tests/guest-mode.test.ts` "delivers the credential only as an HttpOnly, SameSite=Lax session cookie, never in the body" | Met (test). |
| Persists across reloads | `tests/guest-mode.test.ts` "keeps the same guest across a reload, with the same cookie" | Met (test). |
| Not recoverable after sign-out | `tests/guest-mode.test.ts` "does not recover the old guest after sign-out: the next start is a new identity"; "revokes the cookie server-side so a copy of it stops working" | Met (test). |
| Not recoverable on another device | Follows from the cookie-only design. No direct cross-device test. | Partly evidenced. |
| Does not auto-create a game or guest on a bare page load | `tests/guest-mode.test.ts` "does not create a guest or a game on a bare page-load session check" | Met (test). |
| `worldSeed` never exposed | `src/server/dto.ts:267,270,574` strips it. `tests/dto.test.ts` "world seed is never public"; `tests/api.test.ts` "never appears in any success body across the game lifecycle". | Met (tests). |
| Cross-owner isolation | `tests/guest-mode.test.ts` "gives a second guest a 404 for the first guest's save, on every game route" | Met (test). Also tested at the adapter level on PostgreSQL (section 2a). |
| Origin checks and rate limits | `tests/guest-mode.test.ts` origin and rate-limit groups; `tests/client-identity.test.ts` | Met (tests). Production trusted-proxy setup is unverified (section 8). |

**Known guest-mode issues (open)**

1. Dead `/leaderboard` link in `src/components/games/game-library.tsx:110`. The API route `/api/leaderboard` exists, but there is no page.
2. Login and register API routes remain (`src/app/api/auth/login/route.ts`, `register/route.ts`) although the player UI no longer uses them. Kept per the owner's decision. Removing them needs a separate compatibility and security analysis.
3. Game page overflows at 390px width (`scrollWidth` 622). Earlier browser evidence; not re-run this session.
4. Expired guest session rows are never cleaned up.
5. `refetchQuery` in-flight join behaviour is unresolved (noted in the prior audit).
6. The dev preview was restarted on 2026-10-12 after the fast-forward, so it serves the reconciled code. Its log shows a Next.js warning that cross-origin hot-reload (`/_next/hmr`) requests from the preview host are blocked until the host is listed in `allowedDevOrigins`. Pages still return 200. The config was not changed in this audit (section 9, item 12).
7. `scripts/verify-live.mjs` count variance is unresolved (noted in the prior audit; not reproduced this session).

## 7. Constraints observed in this task

- Reconciliation was a normal fast-forward. Nothing was reset, rebased, cherry-picked, cleaned, force-pushed, or discarded. Local work is preserved in `stash@{0}` and the external backup.
- `package.json`, `package-lock.json`, and `src/config/balance.ts` are unchanged. `npm audit fix` was not run. The 360 market-book cap is intact (`src/config/balance.ts:236`, `liveMarketCap: 360`).
- Test files were not weakened or edited. No suppressions were added and TypeScript was not loosened.
- No migration was applied to any live database. The only database touched was the disposable local PostgreSQL 18.4 instance described in section 2a.
- Secrets: no credential was printed, stored, or committed. The disposable database has no password. One secret-pattern match in `package-lock.json` is an integrity hash (false positive).
- Phase 4 and Phase 5 were not started.

## 8. Deployment blockers

These must be resolved before any deployment. They are not all code defects.

1. **Worktree and remote divergence.** Resolved on the session branch by the fast-forward to `68db6fa` (section 1). Other branches, including `main`, were not updated.
2. **Migration `0004_guest_identity.sql` is verified on a disposable database only.** It applied in order on a fresh PostgreSQL 18.4 (section 2a). It is not applied to any live database. A production rollout is a separate, authorised step.
3. **PostgreSQL identity suite: run, 14/14, on a disposable database.** Still open: RLS two-owner enforcement under the `authenticated` role, and a TLS connection to Postgres. The suite connects as a superuser, and the local run did not use TLS.
4. **`DYNASTY_APP_SECRET` must be set in production.** If it is unset, the server uses an ephemeral dev secret, so sessions do not survive restarts (`src/server/auth/tokens.ts:47` warns).
5. **Trusted-proxy declaration must match the real edge.** Production refuses to attribute callers without a declared proxy (`tests/client-identity.test.ts`). The public edge configuration is unverified.
6. **Supabase deployment unverified.** Locally, `auth.uid()` and the roles were stand-ins in the disposable database (section 2a). The real Supabase `auth` schema has not been exercised.
7. **npm: production tree clean; five high-severity findings in development dependencies not yet triaged for change.** `npm audit --omit=dev` exits 0 with 0 findings. The full audit reports 5 high findings for GHSA-vfj7-8cjw-p6xm through `eslint-config-next` (section 2b). The suggested fix is a semver-major devDependency change that needs authorisation.

## 9. Unresolved issues and decisions needed

| # | Issue | Decision needed from user |
| --- | --- | --- |
| 1 | Reconciliation of the worktree and remote. | **Resolved** by fast-forward to `68db6fa`. The stash `a374aefe…` is kept. Decide when to drop it. |
| 2 | Disposable PostgreSQL. | **Resolved for the identity suite** using a local embedded PostgreSQL 18.4 on loopback. No production URL was requested or used. |
| 3 | Login and register API routes still present. | Kept, per the owner's decision. A separate compatibility and security analysis is needed before any removal. |
| 4 | Phase 4 scope is not in the spec or repo. | Confirm the scope before Phase 4 begins. |
| 5 | Matrix `MISSING` items: refinancing, investor funding, bonds, settings screen, offline caching, E2E suite, structured logging, error hooks, full-loop browser run. | Which are in scope for the next phase? Some (bonds, investor funding) may need design decisions. |
| 6 | Persistence model: one sealed JSON document per version, not the ~32 domain tables suggested in §26. | Keep the sealed-document model (and document why), or plan normalisation? Decide before scaling work. |
| 7 | No E2E tests and no committed browser evidence. | Approve adding a browser-test dependency (for example Playwright). Not added here. |
| 8 | Dead `/leaderboard` link; 390px overflow; no settings screen; no price-history chart on the market page. | Confirm for the next phase. |
| 9 | Five high npm findings, all in `eslint-config-next` (dev-only). | Authorise a devDependency change (the suggested fix is a major downgrade), or accept the risk for dev tooling. |
| 10 | Minor doc drift: `src/sim/markets.ts` header says 763 SKUs; registry has 765. | Fix in the next code change. |
| 11 | Six lint warnings (exhaustive-deps). | Fix in the next code change. |
| 12 | Dev preview blocks cross-origin HMR from the preview host. | Authorise adding the preview host to `allowedDevOrigins` in `next.config.ts`. Not changed in this audit. |

## 10. Recommended next phase

**Recommended: R1 (remaining items), not Phase 4.**

R1 is partly complete. The identity suite ran 14/14 on a disposable PostgreSQL 18.4 with migrations `0001`–`0004` applied (section 2a). What is left is the RLS check, which the suite does not perform because it runs as a superuser.

Requirements for the next phase (from `docs/COMPLETION_ROADMAP.md`, R1):

1. Add tests, written first and shown to fail for the right reason if they expose a gap, that connect as the `authenticated` role on the disposable database. Use two owners and check that each can read and write only its own games and versions, and that cross-owner reads and writes are refused. Do not weaken any RLS, CAS, version, auth, or ownership check to make them pass.
2. Run them on a disposable database only, and record the command and exit code. Never apply migrations to a live database.
3. Either exercise a TLS connection to the disposable database, or record that TLS is unverified for the production path.
4. Re-run `tests/postgres-identity.test.ts` with `DYNASTY_DISPOSABLE_POSTGRES_URL` set, and record the exit code and the 14-of-14 result.

Phase 4 has not been started and should not start until the user confirms its scope (section 9, item 4). Phase 5 has not been defined in the repository.
