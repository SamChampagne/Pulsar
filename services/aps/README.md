# PlaniAdvance V2

Clean-architecture rewrite of the PlaniAdvance APS (Advanced Planning &
Scheduling) engine. V2 separates the domain (scheduling logic) from the
application, infrastructure and API layers so the engine can be tested,
embedded and evolved independently.

## Architecture

```
planiadvance_v2/
├── domain/                   Pure APS logic - no I/O, no framework
│   ├── entities/             WorkOrder, Operation, Machine, ...
│   ├── value_objects/        Duration, TimeWindow, Shift, ...
│   └── scheduling/           Scheduler, SlotFinder, Heuristics, Constraints, ...
├── application/              Use cases + repository ports
│   ├── ports/                WorkOrderRepository, ...
│   └── use_cases/            RunScheduling, CreateWorkOrder, ...
├── infrastructure/           Adapters for the outside world
│   ├── db/                   SQLAlchemy models, session, SQL repositories
│   ├── in_memory/            In-memory repositories (tests & CLI)
│   ├── seed.py               Demo dataset factory
│   └── bootstrap.py          DB init + demo data loader
├── api/                      FastAPI controllers (thin)
│   └── routes/               health, work_orders, machines, scheduling
└── cli.py                    Typer CLI for standalone scheduling runs
```

**Dependency rule:** `api` / `cli` → `application` → `domain`.
`infrastructure` implements `application.ports`. The domain never imports
from any other layer.

## Running locally

### With Docker

```bash
make up                # postgres -> migrate -> seed industrial -> api + integration-worker
curl localhost:8000/health
curl -X POST localhost:8000/scheduling/run -H "content-type: application/json" \
     -d '{"horizon_days": 14, "heuristic": "priority_edd"}'
```

`make up` is deterministic on a fresh Docker volume: it starts Postgres,
applies migrations, seeds the default industrial demo tenant/workspace/data,
then starts the API and the long-running integration worker. The `seed`
container runs `planiadvance_v2.infrastructure.bootstrap` once and exits.

If you want a different Docker seed profile, override it at startup:

```bash
make STACK_SEED_DATASET=demo up
make STACK_SEED_DATASET=industrial_stress up
```

Integration endpoints stay open by default for local development. To protect
`/integration/*` in Docker, set `INTEGRATION_API_KEY` before starting the API
and send `X-API-Key` on integration requests:

```bash
INTEGRATION_API_KEY=dev-secret make up
curl localhost:8000/integration/journal -H "X-API-Key: dev-secret"
```

Planner login now issues a signed session token instead of relying only on
plain `X-User-Id` / `X-Organization-Id` headers. Local Docker/UI keeps a
public login directory enabled by default so `make up` stays easy to demo.

For a stricter deployment profile, disable the legacy/bootstrap seams:

```bash
AUTH_SELECTOR_LOGIN_ENABLED=false
AUTH_EXPOSE_LOGIN_DIRECTORY=false
AUTH_ALLOW_HEADER_IDENTITY=false
AUTH_SESSION_SECRET=replace-me
```

With those flags, the public selector flow is closed, raw tenant headers are
rejected, and only signed planner sessions should be accepted on protected
account/admin routes.

### Without Docker (CLI only)

The CLI runs the engine against an in-memory dataset - no DB required.

```bash
pip install -e ".[dev]"
planiadvance schedule --demo
planiadvance schedule --demo --heuristic spt --output schedule.json
```

## Running the tests

```bash
make test              # all tests (unit + integration)
make test-unit         # domain + engine unit tests only
```

Unit tests exercise the engine with pure Python objects - no DB, no
FastAPI, no fixtures server. They run in well under a second.

## Output format

The scheduling endpoint and CLI return a consistent JSON shape:

```json
{
  "schedule_id": "run-abcdef012345",
  "created_at": "2026-04-09T08:00:00",
  "assignments": [
    {
      "operation_id": "WO-1001-01",
      "work_order_id": "WO-1001",
      "machine_id": "CNC-02",
      "setup_start": "2026-04-09T08:00:00",
      "start": "2026-04-09T08:10:00",
      "end": "2026-04-09T09:31:49"
    }
  ],
  "metrics": {
    "makespan_minutes": 4320,
    "total_lateness_minutes": 0,
    "on_time_ratio": 1.0,
    "machine_utilization": { "CNC-01": 0.32, "CNC-02": 0.28 }
  }
}
```

## Scheduling features

- **Forward greedy scheduler** with pluggable heuristics (`edd`,
  `priority_edd`, `spt`, `critical_ratio`).
- **Calendar-aware** placement via `CalendarResolver` (working hours,
  weekends).
- **Sequence dependencies** between operations (explicit + implicit
  intra-work-order ordering).
- **Setup + run time** tracked separately per operation.
- **Per-machine efficiency** factor.
- **Pluggable constraints** (`EligibilityConstraint`, `CapabilityConstraint`).
- **KPIs**: makespan, total lateness, on-time ratio, machine utilisation.
- **Deterministic**: same inputs → same schedule every time.

## What changed from V1

| Area                 | V1                                          | V2                                            |
| -------------------- | ------------------------------------------- | --------------------------------------------- |
| Architecture         | UI / logic / DB mixed                       | Strict hexagonal (domain / app / infra / api) |
| Scheduler size       | `scheduler.py` ~1300 LOC                    | `scheduler.py` ~230 LOC + extracted helpers   |
| Operation storage    | JSON blob inside `work_orders` row          | Normalised tables (`operations`, ...)         |
| Resource model       | Dual `Machine` + `Resource` legacy          | Single `Machine` (capacity = 1)               |
| Tests                | Integration-only; hard to isolate bugs      | Unit tests for every engine component         |
| Testing without DB   | Impossible without mocking FastAPI + ORM    | CLI / in-memory repos run the full engine     |
| Backward-compat code | `from_resource`, `eligible_machines` bridge | Removed                                       |

## Status

V2 is a clean baseline. Planned follow-ups:

- Operation splitting across multiple working windows
- Backward scheduling (schedule-from-deadline)
- Sequence-dependent setup matrix
- Multi-resource operations (machine + operator + tool)
- Alembic migrations (schema is created via `init_schema` for now)
