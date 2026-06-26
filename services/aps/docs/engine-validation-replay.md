# Engine Validation Gate And Replay Reports

This note documents the lightweight engine guardrails added around scheduling
runs. The goal is not to duplicate the domain feasibility model; the gate calls
the existing `check_feasibility` function and only decides whether a use case may
continue into a solver.

## Validation Gate

Core implementation:

- `planiadvance_v2/application/use_cases/planning_validation_gate.py`
- `enforce_planning_validation_gate(context, mode=...)`
- `validate_schedule_scope(...)`

The gate blocks only hard feasibility errors, such as material shortage,
dependency cycles, invalid dates, impossible secondary-resource demand, or
operations without a valid machine path. Warnings still flow through the normal
run response as feasibility diagnostics.

Current entry points using the gate:

- `RunScheduling`
- `RunSchedulingFromSnapshot`
- `CompareStrategies`
- `CapableToPromise`
- `HandleDisruption`

Tenant schedule scope is checked before reusing persisted schedules as baselines
or disruption sources. A tenant-scoped run cannot use a schedule captured for a
different organization.

## Replay Report

Core implementation:

- `planiadvance_v2/application/use_cases/replay_schedule_run.py`
- `POST /scheduling/runs/{schedule_id}/replay`

Replay still rebuilds the run from the persisted canonical input snapshot. The
response now reports more than assignment equality:

- `hash_matches`
- `strategy_matches`
- `objective_matches`
- `assignment_delta`
- `metrics_delta`
- `divergence_reasons`
- `replay_report`

This makes replay useful for audit and regression checks. A planner or support
tool can tell whether a difference came from a strategy override, changed
assignments, changed KPIs, or corrupted snapshot payload.

## Extension Rules

- Add new hard blockers in `domain/scheduling/feasibility.py`, not in the gate.
- Keep the gate thin: it should orchestrate and format, not become a second
  validation engine.
- When adding a new scheduling use case, build `SchedulingContext`, call
  `enforce_planning_validation_gate`, then solve.
- When reusing a persisted schedule under a tenant, call `validate_schedule_scope`
  before building frozen assignments or baseline context.
