# Industrial Docker Smoke

This is the real-stack check before trusting the API as a UI backend. It runs
Postgres, applies migrations, seeds the industrial dataset, starts the API, and
then validates the routes a planner UI needs.

For the product-level baseline/candidate/publish workflow this smoke supports,
see `docs/productization-workflow.md`.

## Run It

From the repository root:

```powershell
docker compose -f docker/docker-compose.yml down
$env:SEED_DATASET="industrial"
$env:SEED_RESET="true"
docker compose -f docker/docker-compose.yml up --build -d postgres
docker compose -f docker/docker-compose.yml run --rm --build migrate
docker compose -f docker/docker-compose.yml run --rm --build seed
docker compose -f docker/docker-compose.yml up --build -d api
docker compose -f docker/docker-compose.yml run --rm --build smoke
```

The integration automation worker is optional for the smoke, but it is now
available as the long-running self-host service:

```powershell
docker compose -f docker/docker-compose.yml up --build -d integration-worker
```

Run it after migrations and seed. It polls due workspace automation jobs through
the same application use case as `POST /integration/automations/run-due`.
Multiple workers can be deployed, but each due job is claimed with
`lock_owner`/`locked_until` before execution. Tune
`INTEGRATION_WORKER_LOCK_TTL_SECONDS` if a connector needs longer execution
windows. Failed connector executions update `attempt_count`, `next_attempt_at`
and `last_error_code`, so retries back off instead of looping on every poll.
Operators can inspect the same runtime state through
`GET /integration/automations/health` or the Integration Health UI tab.

If you prefer not to keep shell env vars around, the seed step can be explicit:

```powershell
docker compose -f docker/docker-compose.yml run --rm --build -e SEED_DATASET=industrial seed
```

For scale testing rather than UI demo data, seed the derived stress profile:

```powershell
docker compose -f docker/docker-compose.yml run --rm --build -e SEED_DATASET=industrial_stress -e SEED_RESET=true seed
```

`industrial` is the UI-readable demo shape. `industrial_stress` repeats the same
industrial model into 18 work orders and 66 operations, so it is better for
engine timing and stability checks.

If local port `5432` is already used:

```powershell
$env:POSTGRES_PORT="5555"
```

The API container still talks to Postgres through Docker networking at
`postgres:5432`; `POSTGRES_PORT` only changes the host port.

## What It Validates

The smoke module calls the API over HTTP and fails non-zero if any contract is
missing:

- `GET /health`
- `GET /ready`
- `POST /auth/login`
- `GET /auth/me`
- `GET /machines`
- `GET /resources`
- `GET /inventory`
- `GET /supplies`
- `GET /work-orders`
- `POST /scheduling/run`
- `GET /scheduling/runs/{schedule_id}/readiness`
- `GET /scheduling/runs/{schedule_id}/dashboard`
- `GET /scheduling/runs/{schedule_id}/gantt`
- `GET /scheduling/runs/{schedule_id}/operations/{operation_id}/feasible-slots`
- `POST /scheduling/runs/{schedule_id}/edits/preview`
- `POST /scheduling/runs/{schedule_id}/edits/apply`
- `POST /scheduling/scenarios/compare`
- `POST /scheduling/scenarios/{candidate_schedule_id}/publish`

It also verifies that `SEED_DATASET=industrial` reaches the API with industrial
machines, secondary resources, inventory, inbound supplies, material
requirements, routing alternatives and persisted work orders. The current
industrial seed intentionally includes at least 6 work orders, 20+ operations,
multi-cell alternatives and material-gated operations. The Gantt check expects
operation bars under the current UI contract field `items`, then proves a
planner can preview/apply a Gantt move, compare the candidate and publish it.

## Why `SEED_RESET=true`

The seed command is meant for demo/test data. With `SEED_RESET=true`, it clears
planning runtime/master demo tables before inserting the requested dataset, so
switching from `demo` to `industrial` cannot leave mixed data behind.

Do not use the seed service against production data.

## Pytest Variant

For a live Postgres database outside Docker Compose, set:

```powershell
$env:PLANIADVANCE_STACK_TEST_DATABASE_URL="postgresql+psycopg://plani:plani@localhost:5432/planiadvance_v2"
python -m pytest tests/integration/test_real_stack_postgres.py -q
```

If you exposed Docker Postgres on `5555`, use:

```powershell
$env:PLANIADVANCE_STACK_TEST_DATABASE_URL="postgresql+psycopg://plani:plani@localhost:5555/planiadvance_v2"
```

The integration test is opt-in and skipped when the environment variable is not
provided.

## Next Engine Gap

Once this smoke is green, the next recommended engine chantier is deeper
industrial validation: WIP / firm / frozen scenarios at larger scale, stability
budgets and repair-local behavior under planner edits. See
`docs/engine-wip-firm-frozen-zones.md`.
