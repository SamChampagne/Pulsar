# Industrial Reference Acceptance Scenario

This scenario is the engine-first acceptance test for PlaniAdvance as an
industrial APS foundation. It is not UI code. It proves that the engine and API
contracts can support a future planner UI without duplicating scheduling logic.

## Scenario Scope

The dataset lives in `planiadvance_v2/infrastructure/industrial_reference.py` as
`build_industrial_acceptance_workshop()`. Tests import the same builder instead
of maintaining a test-only copy.

It models:

- 6 baseline work orders, 22 scheduled operations and 1 rush-order template.
- 8 primary resources/cells: laser, fast CNC, flexible CNC, paint booth,
  two assembly benches, packing and quality gate.
- 7 secondary resources: operators, a unique fixture, tooling kit, electrical
  technician, paint crew, packing crew and QA inspector.
- Sequence-dependent setup matrices for CNC and paint.
- Maintenance downtime on the fast CNC.
- Alternative routings with different durations and secondary-resource needs.
- Inventory plus inbound supply lots for aluminum and electronics.
- Transfer times between shop cells.

The companion stress builder `build_industrial_stress_workshop()` repeats this
same model into deterministic demand waves. Use it when validating engine scale:
`industrial` stays readable for demos and UI work, while `industrial_stress`
proves the same constraints survive a larger volume.

## Acceptance Workflow

`tests/integration/test_industrial_reference_acceptance.py` validates two
product-level loops.

First loop: baseline solve.

1. Build the industrial reference workshop.
2. Run `RunScheduling` with `strategy="auto"`.
3. Assert every operation is scheduled.
4. Assert machine capacity has no overlaps.
5. Assert secondary-resource capacity is respected.
6. Assert material pegging is covered.
7. Assert supply-gated Delta and Epsilon operations respect inbound supply.

Second loop: planner interaction.

1. Persist a published baseline.
2. Load the Gantt read model.
3. Ask the engine for feasible slots on `GAMMA-CNC`.
4. Apply a planner machine-change candidate through the same repair flow used
   by interactive Gantt edits.
5. Compare candidate vs baseline.
6. Publish the accepted candidate.

Third loop: stress solve.

1. Build the scaled industrial workshop with 3 repetitions.
2. Assert ids and dependencies remain unique after remapping.
3. Schedule 66 operations with the same machines/resources/materials.
4. Assert machine and secondary-resource constraints still hold.

## How To Test

Fast acceptance test:

```powershell
python -m pytest tests/integration/test_industrial_reference_acceptance.py -q
```

Broader engine/API confidence pass:

```powershell
python -m pytest tests/integration/test_industrial_reference_acceptance.py tests/unit/scheduling tests/unit/api/test_scheduling_http_proofs.py -q
```

Full suite:

```powershell
python -m pytest -q
```

Expected result today:

- Industrial acceptance: `2 passed`.
- Full suite before this branch: `614 passed, 2 skipped`.

The recurring `.pytest_cache` warning on this workstation is a local file
permission warning, not a product failure.

## How To Load It As Demo Data

CLI shape check:

```powershell
python -m planiadvance_v2.cli seed --dataset industrial
```

CLI schedule run:

```powershell
python -m planiadvance_v2.cli schedule --demo --dataset industrial --strategy auto --horizon-days 7
```

Docker seed:

```powershell
$env:SEED_DATASET="industrial"
$env:SEED_RESET="true"
docker compose -f docker/docker-compose.yml run --rm --build seed
```

Docker stress seed:

```powershell
$env:SEED_DATASET="industrial_stress"
$env:SEED_RESET="true"
docker compose -f docker/docker-compose.yml run --rm --build seed
```

Expected rough shape:

- `industrial`: 6 work orders, 22 operations, 8 machines, 7 resources.
- `industrial_stress`: 18 work orders, 66 operations, same machines/resources.

Then run the API and smoke the real stack:

```powershell
docker compose -f docker/docker-compose.yml up --build -d api
docker compose -f docker/docker-compose.yml run --rm --build smoke
```

The smoke service calls:

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

Full procedure: `docs/industrial-docker-smoke.md`.

## Why This Matters

This is the reference scenario to run before expanding the UI. If a future UI
breaks the Gantt/edit workflow, this test should catch it at the engine/API
level. If the engine gains a new industrial feature, extend this scenario only
when the feature is part of the core planner workflow.
