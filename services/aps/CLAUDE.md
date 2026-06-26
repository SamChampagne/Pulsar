# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common commands

All commands are run from `planiadvance_v2/` (the project root that contains `Makefile` and `pyproject.toml`).

```bash
# Install (editable, dev extras incl. ortools, hypothesis, ruff, mypy)
make install-dev

# Tests
make test                  # everything
make test-unit             # unit only (tests/unit) — pure Python, no DB, sub-second
make test-integration      # tests/integration (incl. real Postgres stack test)
make test-real-stack       # tests/integration/test_real_stack_postgres.py
python -m pytest tests/unit/scheduling/test_greedy_strategy.py::test_name -v   # single test

# Lint / format (ruff configured in pyproject.toml — line-length 100, py311)
make lint
make format

# Run the API locally (hot reload)
make run                   # uvicorn planiadvance_v2.api.main:app :8000

# CLI, no DB required (uses in-memory demo dataset)
planiadvance schedule --demo
planiadvance schedule --demo --heuristic spt --output schedule.json

# Alembic migrations
make migrate               # alembic upgrade head against DATABASE_URL
make migrate-docker        # same, but inside the docker compose "migrate" service

# Full docker stack (postgres + migrate + seed + api)
make up                    # start
make down                  # stop (and remove volumes)
make stack-up / stack-down # granular build order (postgres → migrate → seed → api)

# UI (Vite + React 19, in ui/)
make ui-install
make ui-dev
make ui-build
```

Python >= 3.11. CP-SAT strategy requires the `cpsat` extra (`pip install -e ".[cpsat]"`); it's already in `dev`.

## Architecture — hexagonal layering

The dependency rule is strict and enforced by convention:

```
api / cli  →  application  →  domain
                   ↑
           infrastructure implements application.ports
```

`domain/` never imports from any other layer. `application/` depends only on `domain/` and its own `ports/` (repository Protocols). `infrastructure/` provides adapters (`db/`, `in_memory/`) for those ports. `api/` and `cli.py` wire adapters into use cases — routes never touch SQLAlchemy directly.

### Layer responsibilities

- **`domain/`** — pure APS logic. `entities/` (WorkOrder, Operation, Machine, Schedule, …), `value_objects/` (Duration, TimeWindow, Shift, Priority), and `scheduling/` (the engine).
- **`application/`** — `use_cases/` orchestrate a workflow; `ports/` declare repository Protocols (`WorkOrderRepository`, `MachineRepository`, …); `integration/` has the canonical snapshot + CSV adapter used by `/integration` endpoints.
- **`infrastructure/`** — `db/` (SQLAlchemy 2.0 models + `SqlXRepository` implementations + `session.py` factory + `init_schema`), `in_memory/` (same port contracts, used by tests and the CLI), `seed.py` (demo dataset), `bootstrap.py` (one-shot schema + demo loader for the docker `seed` service).
- **`api/`** — FastAPI app factory (`main.create_app`), dependency wiring (`dependencies.py` — one `get_*` factory per use case), `routes/` (thin controllers), `security.py` (integration API-key scopes), `error_handlers.py` (maps `DomainError` → HTTP).

### Scheduler strategy registry

The engine is **not** a single algorithm. `domain/scheduling/strategy.py` defines `SchedulerStrategy` (Protocol) and a lazy registry — strategies register a factory so heavy deps (e.g. OR-Tools) don't trigger at import time.

Available: `greedy` (default, online dispatch), `backward` (JIT), `cpsat` (exact, needs OR-Tools), `infinite` (rough-cut), plus metaheuristics `sa`, `tabu`, `ga`, `lns`, `multi`. `resolve_strategy(name)` is the runtime entry point; `scheduler.py` is legacy but still works and is used by some older tests.

Every strategy takes a `SchedulingContext` + `Objective` and returns a `StrategyResult` (`schedule`, `objective_value`, `wall_time_ms`, `solver_status`, `diagnostics`). Strategies are stateless and deterministic — same inputs → same schedule.

`StrategyProfile` in the same module is a capability contract (maturity, planning_mode, supports_frozen_assignments, …) the UI/planners query. When adding a strategy, register both a factory and a profile.

### Use-case wiring pattern

Each API route calls a single use case injected via `Depends`. See `api/dependencies.py` — there's one `get_<use_case>` function per use case that builds the needed `SqlXRepository` adapters around a per-request `Session`. When adding a use case:

1. Define repository port(s) in `application/ports/`.
2. Implement the use case in `application/use_cases/`, taking ports in `__init__`.
3. Implement the SQL adapter in `infrastructure/db/repositories/` and the in-memory twin in `infrastructure/in_memory/repositories.py`.
4. Add a `get_*` dependency factory in `api/dependencies.py` and a route in `api/routes/`.
5. Register the router in `api/main.py`.
6. Unit-test with in-memory repos; integration-test (optional) against real Postgres via `test_real_stack_postgres.py`.

### Multi-tenant foundation

`Organization`, `UserAccount`, `Membership` (roles: owner/admin/planner/viewer), and tenant-owned workspaces/machines/work orders exist (`/accounts/*` routes). This is still an account *foundation* - no passwords, sessions, JWT, or login flow yet - but scoped requests must include both `X-Organization-Id` and `X-User-Id` with an active membership. The domain engine is intentionally tenant-agnostic; tenant boundaries live in API/repositories. See `docs/accounts-multitenant.md`.

### Integration endpoints

`/integration/*` (canonical snapshot import/export, journaling) is gated by `INTEGRATION_API_KEY` (full) or scoped `INTEGRATION_READ_API_KEY` / `INTEGRATION_RUN_API_KEY` via the `X-API-Key` header. Left open by default for local dev. Safety limits (CSV bytes, max work orders/operations, rate limit/min) are in `Settings` — see `config.py` and `.env.example`.

## Config

`planiadvance_v2/config.py` is the single `Settings` source — `pydantic-settings` reads `.env`. Never scatter `os.environ` lookups; import `get_settings()` instead.

## Tests

- `tests/unit/` — pure Python, no DB, no FastAPI, no fixtures server. Run in < 1s. Shared builders in `tests/conftest.py` (`horizon_start`, `two_machines`, `make_work_order`).
- `tests/integration/` — marked `integration` (see `pyproject.toml`); `test_real_stack_postgres.py` requires a running Postgres (use `make stack-up` or `DATABASE_URL` pointing to one).
- Hypothesis is used in some domain tests (`hypothesis` is in dev deps).
