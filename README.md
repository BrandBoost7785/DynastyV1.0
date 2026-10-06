# DynastyV1.0

Dynasty is a modular, text-based economic strategy simulation. This repository currently contains the simulation engine, the authoritative application/API layer that fronts it, persistence adapters, Supabase/PostgreSQL migrations, a local SQLite test adapter, and a minimal buildable Next.js shell. The full customer-facing gameplay UI is intentionally deferred to Phase 1B — the API it will consume is implemented and tested.

## Current contents

- 700+ commodity registry and dynamic local markets.
- World graph with routes, travel modes, borders, risk and route planning.
- Inventory, capacity, storage, freight and shipment planning.
- Business, production, crew, automation, finance, stocks, crypto, underground, combat, events, missions and progression modules.
- Server-authoritative intent validation/dispatch: clients submit intentions; money, prices, outcomes, XP and ownership are computed server-side.
- Persistence contract with sealed save blobs, version history, audit rows and ownership scoping.
- Production database target: Supabase/PostgreSQL migrations under `supabase/migrations/`.
- Development/test database target: isolated SQLite adapter using Node's `node:sqlite`.

## Prerequisites

- Node.js `>=22.12.0` (tested locally with Node 22.22.3).
- npm 10+.
- For production persistence: a reachable Supabase/PostgreSQL database and secrets supplied through the environment.

## Install

```bash
npm ci
```

## Environment setup

Copy the safe example and replace placeholders outside Git:

```bash
cp .env.example .env.local
```

Important variables:

- `DYNASTY_APP_SECRET` — server-only session/audit signing secret; required in production.
- `DATABASE_URL` / `POSTGRES_URL` / `SUPABASE_DB_URL` — server-only PostgreSQL connection string; required for production persistence.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — browser-visible Supabase project URL and publishable/anon key.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only; never expose this to browser code.
- `DYNASTY_DB_DRIVER=sqlite` — development/test only. The app refuses SQLite as the production persistence implementation.
- `DYNASTY_SQLITE_PATH=.data/dynasty-dev.sqlite` — local dev database path.

The sandbox used for Phase 0 could not reach Supabase, so live database verification is still required in an environment with network access and production credentials.

## Development commands

```bash
npm run dev          # Next.js dev server on 0.0.0.0:3000
npm run typecheck    # TypeScript strict check
npm run lint         # ESLint
npm run test         # Vitest regression suite
npm run build        # Production Next.js build
npm run verify       # typecheck && lint && test && build
```

Maintenance helpers:

```bash
npm run icons        # generate deterministic local PWA icon PNGs
npm run db:migrate   # apply SQL migrations to DATABASE_URL / Postgres-compatible target
npm run db:seed      # seed local SQLite dev database only
npm run db:reset -- --yes   # delete local SQLite dev database only
npm run sim:inspect  # read-only economy/registry inspection
```

## Persistence model

Production persistence remains Supabase/PostgreSQL. The PostgreSQL adapter uses parameterised queries, owner-scoped loads, compare-and-set writes, version history and audit rows. Database structure and RLS policies are defined by migrations in `supabase/migrations/`.

SQLite exists only for local development, sandbox execution and automated tests. It is isolated from the production configuration and must not be used as the production adapter.

Save blobs are canonical-JSON sealed with an integrity hash. Schema version `2` adds a transaction-ledger eviction checkpoint: retained transaction records carry `seq` and `prevHash`, and the player stores a checkpoint so valid saves remain loadable after ring-buffer eviction while tampering is still detected.

## Phase 1A — application / API layer

The simulation is now behind an authenticated, typed delivery layer. The rules the layer enforces:

```
CLIENT → AUTH → API ROUTES → APPLICATION SERVICES → AUTHORITATIVE INTENTS → SIMULATION → PERSISTENCE (PostgreSQL/Supabase)
```

- **The client never sends authoritative values.** It sends intents (`trade.buy`, `travel.go`, `crew.hire`, …) and the save version it acted on. Money, prices, quantities, XP, odds and outcomes are computed server-side from the loaded state.
- **The client never receives authoritative state.** Every success body is a curated DTO: the state projection drops the RNG state, diagnostics, transaction-integrity chain, unpublished event scheduling, competitor/government internals and event effect payloads. A final redaction pass in the HTTP layer strips a fixed deny-list of internal key names from *every* success body, so a future view function cannot leak one by accident — and command responses assert that the safety net never has to fire.
- **Ownership is proven, not asserted.** A save is loaded by `(gameId, session user)`. Changing an id in a URL is a 404, never another player's empire.
- **State changes are conflict-safe.** Every state-changing intent must carry `expectedVersion` (the `meta.version` the client last read). A stale version is `409 conflict` and nothing is written — two tabs cannot clobber each other.
- **Retries are safe.** With a `requestId` (idempotency key, body field or `x-idempotency-key` header), the outcome is recorded as a receipt. A retry replays the recorded answer instead of executing again; reusing a key for a different payload is refused. Receipts live in their own table (`intent_receipts`, migration `0003`), bounded per save, and the compare-and-set remains the underlying guarantee if a receipt is ever lost.

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness, schema version, driver and configuration presence flags (never values). |
| `POST` | `/api/auth/register` | Create an account and start a session. |
| `POST` | `/api/auth/login` | Exchange credentials for a session cookie. |
| `POST` | `/api/auth/logout` | Revoke every session for the account. |
| `GET` | `/api/auth/session` | Who is signed in; `200` with `authenticated: false` for visitors. |
| `GET` | `/api/games` | The account's saves. |
| `POST` | `/api/games` | Create a game owned by the session. |
| `GET` | `/api/games/:id` | Save summary plus the player-facing state projection. |
| `DELETE` | `/api/games/:id?confirm=true` | Delete a save (explicit confirmation required). |
| `GET` | `/api/games/:id/state` | The state projection and the version to send back as `expectedVersion`. |
| `POST` | `/api/games/:id/intent` | Run one authoritative command. |
| `POST` | `/api/games/:id/advance` | Advance 1–30 days; returns the day report(s). |
| `GET` | `/api/games/:id/views` | The read-model index (self-documenting: name, description, parameters). |
| `GET` | `/api/games/:id/views/:view` | One read model: `market`, `finance`, `stocks`, `crypto`, `automation`, `missions`, `combat`, `underground`, `factions`, `inventory`, `progression`, `businesses`, `properties`, `logistics`, `crew`, `travel`, `world`, `ledger`, `profile`. |
| `GET` | `/api/games/:id/versions` | Save version history (metadata only). |
| `POST` | `/api/games/:id/versions/:version` | Restore a version (`confirm: true`, version-checked, writes forward). |
| `GET` | `/api/leaderboard` | Top empires, public columns only. |
| `GET` | `/api/audit` | The caller's own action trail. |

### Response contract

```json
{ "ok": true,  "data": { … }, "requestId": "req_…" }
{ "ok": false, "error": { "code": "conflict", "message": "…", "details": [ … ] }, "requestId": "req_…" }
```

`error.code` reuses the simulation's own `GameErrorCode` vocabulary; transport failures add `not_authenticated`, `validation_failed`, `rate_limited`, `payload_too_large` and `service_unavailable`. Rate limits publish `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset` and `retry-after`.

#### Server-only report fields

Day reports (the payload of `POST /api/games/:id/advance` and of `time.advance_day` / `time.advance_days` intents) follow one explicit omission rule. `DayReport.elapsedMs` — the wall-clock cost of the tick — is the server's own operations telemetry: no game rule reads it, it moves with server load rather than with the empire, and publishing it would disclose host performance. It is recorded in `state.diagnostics` (itself on the forbidden-key list) and is **not** part of the public contract.

The omission is declared once, in `SERVER_ONLY_REPORT_FIELDS` (`src/server/dto.ts`), which derives both the `DayReportDto` type and the runtime projection, so the public type and the wire payload cannot drift. It is not truncation: the value stays intact server-side, and a day report is delivered whole — `tests/api.test.ts` asserts a real advance returns every day of the batch with no `dataTruncated` marker, while `tests/dto.test.ts` asserts that a public report differs from the engine report by exactly that declaration. A client that wants to time its own work measures with its own clock.

### Client

`src/lib/api-client.ts` is the only way browser code talks to the server: relative URLs (so it works unchanged behind a proxy or in production), `credentials: 'include'`, automatic envelope unwrapping with a typed `ApiError`, and `expectedVersion` + idempotency key on every command.

## Phase 0 verification status

Locally verified:

- Typecheck, lint, Vitest tests and production build via `npm run verify`.
- Transaction-history save/load after 0, 100, 300 and 1,000 real transactions.
- Tamper detection for altered, reordered, duplicated, deleted and anchor-corrupted ledger records.
- Prestige exploit removal and save/load persistence.
- New-game capacity invariants and first-trade smoke flow.
- Travel/shipment success/failure contract.
- 300-day bounded simulation checkpoints.
- Interactive `time.advance_days` limit of 30 days per request.

Still requiring external infrastructure:

- Live Supabase connectivity, migration application and RLS validation against the hosted project.
- Deployment platform checks with production secrets.

## Known limitations after Phase 1A

- The full gameplay UI/dashboard is not implemented; the shell page proves the client→API wiring and lists the endpoints. Phase 1B builds the interface on top of the API contract.
- Authentication in production is Supabase Auth (configured by environment); the local scrypt + signed-cookie path is the development/test fallback and is not a substitute for it.
- Rate limiting is per process (instance-local), intentionally without an external dependency. A horizontally scaled deployment multiplies the budget by the instance count.
- A standalone "last day report" read model is not persisted: day reports are returned by the advance command for the days it ran. A persisted report history would be a simulation-state change and is deferred.
- Phase 0 limitations that still hold:
- Long catch-up simulation beyond 30 days per interactive request needs a future background-job design.
- Live Supabase verification is still pending (the sandbox cannot reach the project host).
- Broad economy rebalancing, unreachable commodity chains, mining-rig pricing, faction/event balance and PWA offline functionality are deferred.
- Live Supabase verification is unverified until run in a network-enabled environment with credentials.
