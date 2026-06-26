# Manufacturing Scheduling — Design (sub-project 3 of the Manufacturing/APS arc)

**Date:** 2026-06-26
**Branch:** `manufacturing-aps`
**Depends on:** SP1 (ApsClient / runtime), SP2 (manufacturing master-data)

## Context

SP1 gave Pulsar a managed APS engine + typed client; SP2 gave it manufacturing master-data
(work centers, calendars, manufacturing orders + operations). SP3 closes the loop: project the
Pulsar data into the engine's canonical snapshot, run a schedule, and **persist the result** so the
Gantt (SP4) and downstream consumers read Pulsar-owned assignments. This is the first point where
the platform actually *plans production*.

## Goals

- A **pure snapshot builder** (`buildManufacturingSnapshot`) that maps Pulsar rows → `ApsSnapshot`
  (the canonical contract validated in SP1): WorkingCalendar+shifts → calendar, WorkCenter →
  machine, ManufacturingOrder → work order, ManufacturingOperation → operation. Deterministic and
  unit-testable (no DB).
- A **SchedulingService** that loads a tenant's schedulable data, builds the snapshot, calls
  `ApsClient.runFromSnapshot`, and persists a `SchedulingRun` + its `ScheduledManufacturingOperation`
  rows in one transaction. Best-effort w.r.t. the engine (a down engine → 503, no partial writes).
- **Candidate / baseline**: every run is a candidate; publishing one marks it the tenant's single
  baseline (the others lose the flag) — the rolling-horizon anchor for future runs.
- REST endpoints under `/manufacturing/scheduling/*`, gated `@RequireModule(MANUFACTURING)` +
  `manufacturing.read|manage`, tenant-scoped, audited.

## Non-goals (later)

- No Gantt UI (SP4) — `GET runs/:id` returns assignments; SP4 renders them.
- No frozen-assignment / true disruption replanning yet — v1 re-runs from scratch each time and
  produces a fresh candidate. (Frozen zones + baseline-diff come in a later refinement.)
- No material feasibility (WMS), no secondary resources / setup matrices in the mapping yet — the
  common fields only; the engine tolerates their absence.

## Snapshot mapping (`buildManufacturingSnapshot`, pure)

Input: `{ calendars, workCenters, orders }` (plain row objects, tenant pre-filtered). Output:
`ApsSnapshot` with `contract_version = APS_CONTRACT_VERSION` ('aps.canonical.v1'), `source_system =
'pulsar-manufacturing'`, `exported_at` (caller passes the timestamp — keep the fn pure).

- **Calendar** → `{ id, name, shifts: [{ weekday, start: startTime, end: endTime }] }`.
- **WorkCenter** → `{ id, name, calendar_id: calendarId, capabilities, efficiency }`.
- **ManufacturingOrder** (only `RELEASED` + `IN_PROGRESS`) → `{ id, name, product_id: productRef,
  quantity, due_date, release_date, priority: APS_PRIORITY_WIRE[priority], firmness:
  APS_FIRMNESS_WIRE[firmness], operations: [...] }`.
- **ManufacturingOperation** → `{ id, work_order_id: orderId, sequence, name, duration_minutes,
  eligible_machine_ids: eligibleWorkCenterIds, setup_minutes, dependencies }`. **dependencies**:
  if `dependsOn` non-empty use it; else derive a finish-to-start chain from `sequence` (op N depends
  on op N-1's id) so an unordered-but-sequenced routing still schedules correctly.

Orders with no operations, or operations whose `eligibleWorkCenterIds` is empty, are skipped with a
recorded warning (so a run never silently drops demand).

## Persistence (Prisma — new models + migration `manufacturing_scheduling`)

- **SchedulingRun**: id, tenantId, apsScheduleId?, strategy, solverStatus, objectiveValue (Int),
  wallTimeMs (Int), horizonStart?, horizonEnd?, orderCount, operationCount, assignmentCount,
  isBaseline (Boolean @default false), snapshotHash?, warnings (String[]), diagnostics (Json?),
  createdById?, createdAt. Indexes `[tenantId, createdAt]`, `[tenantId, isBaseline]`.
- **ScheduledManufacturingOperation**: id, tenantId, runId (FK cascade), operationId, orderId,
  workCenterId, setupStart, start, end. Index `[tenantId, runId]`. (APS `machine_id` is the
  WorkCenter id and `operation_id`/`work_order_id` are Pulsar ids — everything round-trips because
  the snapshot uses Pulsar ids.)
- Tenant back-relation `schedulingRuns`.

## API (`/manufacturing/scheduling/*`)

- `POST /run` — body `{ strategy?, horizonStart?, horizonDays?, objective? }`. Loads data, builds
  snapshot, calls the engine, persists run + assignments in a transaction, returns the run with
  assignments. `manufacturing.manage`. Audited (`@Audit('scheduling-run', CREATE)`). If there is no
  schedulable demand → 400 with a clear message. If the engine is unavailable → 503 (from ApsClient).
- `GET /runs` — paginated list (newest first), `manufacturing.read`.
- `GET /runs/:id` — run + assignments (joined with operation/order/work-center names for display),
  `manufacturing.read`.
- `POST /runs/:id/publish` — set this run as the tenant baseline (unset others in a transaction),
  `manufacturing.manage`, audited.
- `GET /baseline` — the current baseline run (or null), `manufacturing.read`.
- `GET /strategies` — passthrough to `ApsClient.listStrategies()` so the UI can offer valid choices.

## Testing

- Unit (shared or api): `buildManufacturingSnapshot` — calendar/machine/order/operation mapping,
  FS-chain derivation from sequence when `dependsOn` empty, priority/firmness wire mapping, skip +
  warn on empty-operations / empty-eligibility.
- e2e (`apps/api/test/manufacturing-scheduling.e2e-spec.ts`, gated on APS install like
  aps-runtime): seed a calendar + 2 work centers + a RELEASED MO with 2 FS operations, `POST /run`,
  assert a run with 2 assignments, precedence respected (op2.start ≥ op1.end) and each assignment
  on an eligible work center; then `publish` and assert `GET /baseline` returns it.

## Sequencing within SP3

3a. Prisma models + migration; pure `buildManufacturingSnapshot` + unit test.
3b. SchedulingService + controller + wire ApsModule into ManufacturingModule.
3c. e2e (gated on APS install) + verify the full loop.
