# APS Runtime Foundation — Design (sub-project 1 of the Manufacturing/APS arc)

**Date:** 2026-06-26
**Branch:** `manufacturing-aps` (from `main`)
**Status:** design → plan → implementation

## Context

Pulsar is integrating **PlaniAdvance V2**, a mature industrial **APS (Advanced Planning &
Scheduling)** engine, currently sitting untracked at `PlaniAdvanceV2/` in the working tree. The
engine is Python (FastAPI + SQLAlchemy 2.0 + Alembic), with a clean hexagonal architecture
(`domain` / `application` / `infrastructure` / `api`) and a pluggable scheduler registry: `greedy`
(online dispatch), `backward` (JIT), `hybrid`, **`cpsat`** (exact, OR-Tools CP-SAT), `infinite`
(rough-cut), plus metaheuristics (`sa`, `tabu`, `ga`, `lns`, `multi`). Its scheduling core is the
differentiator and **cannot be reasonably rewritten in TypeScript** (OR-Tools has no serious TS
equivalent).

**Chosen integration architecture** (decided with the user): the APS engine runs as a **managed
Python sidecar**, vendored into the Pulsar monorepo. **Pulsar is the source of truth** for all
manufacturing master-data (built in later sub-projects as native NestJS/Prisma modules). Pulsar
builds a *scheduling problem snapshot*, hands it to the engine (which already exposes a canonical
`/integration/import` + `/scheduling/run` API), reads back a `Schedule`, persists it, and renders
the Gantt in SvelteKit. This mirrors the existing **Hermes agent runtime** precedent
(`scripts/setup-agents.mjs`, `core/agents/agent-runtime.service.ts`, spec
`docs/superpowers/specs/2026-06-13-agents-runtime-managed-design.md`).

This sub-project (#1) builds **only the runtime foundation**: vendor the engine, provision it
turnkey, manage its process from NestJS, and **prove the end-to-end round-trip**. It is the
riskiest architectural bet (a Python service inside a pnpm/TS monorepo) so we de-risk it first on a
small surface, independent of the manufacturing data modules.

## Goals

- Vendor the PlaniAdvance engine into the monorepo at `services/aps/`.
- Turnkey provisioning: `pnpm aps:setup` → uv-provisioned CPython venv with the engine installed
  `[cpsat]` (OR-Tools), mirroring `setup-agents.mjs`.
- A NestJS `core/aps` module that **manages the engine process** (start/stop/health) and exposes a
  **typed HTTP client** (`ApsClient`) to the engine's API.
- **Best-effort + isolated**, exactly like the Hermes runtime (hard rule 24 analog): if the engine
  is not installed/running/healthy, callers get a clean `ServiceUnavailableException` (503) — the
  Pulsar core never crashes because of the APS sidecar.
- A verifiable **smoke round-trip**: Pulsar reaches `/health` + `/scheduling/strategies`, imports a
  tiny canonical snapshot, runs a schedule, and reads back assignments.

## Non-goals (deferred to later sub-projects)

- No manufacturing master-data modules (WorkCenter/Routing/BOM/ManufacturingOrder) — sub-project 2.
- No Pulsar-side snapshot builder from real Pulsar data — sub-project 3.
- No Gantt UI in SvelteKit — sub-project 4.
- No Odoo connector, no agent planning tools, no material↔WMS tie — later.
- We do **not** keep the engine's own React UI, nor its `accounts`/`auth` login flow. Pulsar owns
  auth/RBAC/multi-tenant. (The engine's `/accounts`, `/auth`, `/branding` routers stay in the
  vendored code but are unused by Pulsar; we may disable them via config later.)

## Architecture

```
Pulsar (NestJS)                              services/aps  (vendored Python engine)
  core/aps/
    ApsRuntimeService  ── spawns/manages ──>  uvicorn planiadvance_v2.api.main:app
      (process lifecycle, health)               (FastAPI, :APS_PORT, loopback only)
    ApsClient          ── HTTP (X-API-Key) ──>  /health /scheduling/* /integration/*
      (typed fetch, timeouts, best-effort)
  core/aps engine DB  ── Postgres ──────────>  database `planiadvance` in the SAME
                                                pulsar-db container (separate DB)
```

- **Process model:** a **single long-lived uvicorn process** per Pulsar API process, bound to
  **loopback** (`127.0.0.1:APS_PORT`, default 8099 to avoid the Windows reserved range that bit
  :3000 → :3100 and to avoid the engine's own default 8000). `ApsRuntimeService.onModuleInit`
  starts it best-effort (non-blocking); `onModuleDestroy` tears it down. This differs from Hermes
  (one process *per conversation* via ACP stdio) because APS is a stateless request/response HTTP
  service — a single managed server is the right shape.
- **Engine store:** the engine runs migrations on startup (`init_schema()` in its `lifespan`) and
  needs Postgres. We give it a **dedicated database `planiadvance`** inside the existing
  `pulsar-db` container (created idempotently by `aps:setup` / `db:up`). The engine's DB is a
  **working store only**; Pulsar remains the durable source of truth and (from sub-project 3 on)
  re-pushes snapshots. We do not share tables with Pulsar's Prisma schema.
- **Auth between Pulsar and engine:** the engine's `/integration/*` endpoints are gated by
  `INTEGRATION_API_KEY` (header `X-API-Key`). `aps:setup` generates a local key into the engine's
  `.env`; Pulsar reads the same key from its own env and sends it. Bound to loopback, this is
  defense-in-depth, not the primary boundary.

## Components

### 1. Vendoring (`services/aps/`)
- **Copy-in** (not a git submodule) the engine package subtree
  `PlaniAdvanceV2/planiadvance_v2/` → `services/aps/`. Rationale: it's the user's own code, we want
  it to evolve *with* Pulsar (Prisma-driven mapping changes will touch the snapshot contract on both
  sides), and copy-in avoids submodule friction. (Hermes is a submodule because it's an upstream
  dependency; the APS engine is becoming first-party.)
- Bring: `planiadvance_v2/` (the Python package), `pyproject.toml`, `alembic/`, `alembic.ini`,
  `docker/` (reference), `Makefile` (reference), `.env.example`, `README*`. 
- **Leave behind:** `ui/` (React — rebuilt in SvelteKit later), `node_modules`, `.venv`,
  `.pytest_cache`, `.ruff_cache`, `.hypothesis`, `mock_sftp_root`, `.git` (it must NOT become a
  nested repo inside Pulsar). Tests (`tests/`) are brought along — they're valuable and run under
  the venv.
- `PlaniAdvanceV2/` stays excluded from Pulsar git (already in `.git/info/exclude`) and can be
  deleted once the copy-in is verified.

### 2. Provisioning (`scripts/setup-aps.mjs` + `pnpm aps:setup`)
- Modeled directly on `scripts/setup-agents.mjs`:
  - `uv python install 3.12` → `uv venv services/aps/.venv --python 3.12` →
    `uv pip install --python <venv> -e "./services/aps[cpsat]"`.
  - Same uv-bootstrap and system-Python fallback logic.
  - Idempotent: skip venv creation if present, always re-run pip install.
- Additionally provisions the engine DB (best-effort): create database `planiadvance` in
  `pulsar-db` if absent (via `docker exec pulsar-db createdb` or psql `CREATE DATABASE`), and write
  `services/aps/.env` with `DATABASE_URL`, `API_PORT`, a generated `INTEGRATION_API_KEY`,
  `AUTH_ALLOW_HEADER_IDENTITY=true`. Migrations run automatically on engine startup.
- Add `"aps:setup": "node scripts/setup-aps.mjs"` to root `package.json`.

### 3. NestJS `core/aps` module
- **`runtime-install.ts`** — mirrors `core/agents/runtime-install.ts`: `repoRoot()`, `apsDir()`,
  `venvPython()`, `isInstalled()` (checks venv python + engine manifest exist).
- **`aps-runtime.service.ts`** (`ApsRuntimeService`):
  - `onModuleInit()` — if installed and `APS_AUTOSTART !== 'false'`, spawn
    `<venv-python> -m uvicorn planiadvance_v2.api.main:app --host 127.0.0.1 --port <APS_PORT>` with
    `cwd = services/aps`, `env` carrying the engine `.env` values. **Non-blocking & best-effort**:
    spawn failure or missing install is logged, never thrown at boot.
  - Captures stderr tail (like the Hermes service) for diagnosability; logs unexpected crashes.
  - `onModuleDestroy()` — `child.kill()`.
  - `isRunning()` / `waitForHealthy(ms)` — polls the client's `/health` until ready or timeout.
  - Does **not** auto-restart on crash in v1 (kept simple); a crashed engine surfaces as 503 from
    the client. (Auto-restart can be a later hardening.)
- **`aps.client.ts`** (`ApsClient`): typed `fetch` wrapper to `http://127.0.0.1:<APS_PORT>`, adds
  `X-API-Key`, per-call timeout (default 30 s for `/scheduling/run`, 3 s for `/health`), maps
  network/non-2xx to `ServiceUnavailableException` with a concise message. Methods for v1:
  `health()`, `listStrategies()`, `importSnapshot(snapshot)`, `runScheduling(input)`,
  `getGantt(scheduleId)`. Request/response types are hand-written TS interfaces matching the
  engine's Pydantic schemas (kept minimal — only fields we use).
- **`aps.controller.ts`** (`/api/v1/aps`, platform-scoped, `@RequirePermissions`): a thin
  diagnostics surface for the foundation — `GET /aps/status` (installed? running? healthy?
  strategies list) and `POST /aps/smoke` (runs the canned round-trip and returns the resulting
  schedule summary). These prove the boundary and double as an ops health page. No `@RequireModule`
  yet (the MANUFACTURING module key arrives in sub-project 2; for now gate on a new
  `aps.read`/`aps.admin` permission, platform-level).
- **`aps.module.ts`** — registers the service, client, controller; exported for later modules.
- Wire `ApsModule` into `app.module.ts`.

### 4. Config & env
- New env (documented in `.env.example`): `APS_PORT=8099`, `APS_API_KEY=<generated>`,
  `APS_DATABASE_URL=postgresql+psycopg://pulsar:pulsar@localhost:5432/planiadvance`,
  `APS_AUTOSTART=true`.
- `core/aps` reads these via Nest `ConfigService`.

## Data flow (the smoke round-trip — acceptance criterion)

1. `ApsRuntimeService` boots the uvicorn engine (loopback) at API start; engine runs its
   migrations against the `planiadvance` DB.
2. `POST /api/v1/aps/smoke` (or an e2e test) calls `ApsClient`:
   a. `health()` → `{ status: "ok", db_ready: true }`.
   b. `listStrategies()` → includes at least `greedy` and `cpsat`.
   c. `importSnapshot(tinySnapshot)` — one calendar (1 shift), two machines, one work order with
      two finish-to-start operations — using the engine's canonical snapshot JSON shape.
   d. `runScheduling({ horizon_days: 7, strategy: "greedy", objective: default })`.
   e. Read back the `Schedule`: assert ≥ 2 `ScheduledOperation`s with `start < end` and the
      precedence respected (op2.start ≥ op1.end).
3. Returns a compact summary `{ strategies, scheduleId, assignments, makespanEnd, solverStatus }`.

## Error handling & isolation (hard-rule-24 analog)

- Engine not installed → client/controller return 503 "APS runtime not installed — run
  `pnpm aps:setup`" (never throws at boot).
- Engine down / unreachable / timeout → `ServiceUnavailableException` (503); Pulsar stays up.
- All engine interaction is loopback-only; nothing in the Pulsar request path blocks on the engine
  except explicit APS calls, which are bounded by timeouts.
- The engine process is a child of the Pulsar API process and is killed on shutdown (no zombie).

## Testing & acceptance

- **Unit (Vitest, web/shared not involved):** `ApsClient` maps non-2xx and network errors to 503;
  `runtime-install.isInstalled()` false-path; the canned snapshot builder is well-formed.
- **e2e (`apps/api/test/aps-runtime.e2e-spec.ts`):** gated to run only when the runtime is installed
  (skips cleanly otherwise, like `phase11r1-agent-runtime.e2e-spec.ts`). Boots the engine, runs the
  smoke round-trip, asserts the schedule. Documented as needing `pnpm aps:setup` first.
- **Manual:** `pnpm aps:setup` then `GET /api/v1/aps/status` shows installed+running+healthy with a
  strategy list; `POST /api/v1/aps/smoke` returns a valid mini-schedule.
- Engine's own Python test suite remains runnable under the venv (`services/aps` `make test-unit`)
  as a vendored-integrity check, but is not wired into Pulsar CI in v1.

## Risks / open points

- **Windows process management:** spawning/killing uvicorn under Windows (the dev box) needs the
  same care as the Hermes child (capture stderr, kill on exit). Reuse that code shape.
- **uv download dependency:** `aps:setup` needs network to fetch CPython + OR-Tools wheels (OR-Tools
  is large). Documented; same constraint as `agents:setup`.
- **Engine DB provisioning on Windows:** creating the `planiadvance` DB via `docker exec` is the
  portable path; `aps:setup` does it best-effort and the engine's `init_schema` handles the rest.
- **Port choice:** 8099 chosen to dodge both the engine default (8000) and any reserved Windows
  ranges; configurable via `APS_PORT`.

## Sequencing after this sub-project

2. Manufacturing master-data module (Prisma + NestJS): WorkCenter, WorkingCalendar/Shift, Routing,
   BOM, ManufacturingOrder + Operation; `MODULE_KEYS.MANUFACTURING`; web CRUD.
3. Planning/scheduling module: Pulsar→APS snapshot builder, run, persist `Schedule`,
   candidate/baseline, disruption replanning.
4. Gantt + planning board in SvelteKit (PlaniAdvance React UI as visual reference).
5+. Material feasibility ↔ WMS, Odoo connector reuse, agent planning tools.
