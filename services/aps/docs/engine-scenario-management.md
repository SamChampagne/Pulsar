# Engine Scenario Management

This note documents the first scenario-management layer.

The core helper is:

- `planiadvance_v2/application/use_cases/compare_scenarios.py`
- `CompareScenarios`
- `planiadvance_v2/application/use_cases/publish_scenario.py`
- `PublishScenario`

It does not create a duplicate scenario store. It uses persisted schedule runs
as scenario candidates because runs already carry:

- `scenario_name`
- `lifecycle_status`
- metrics
- diagnostics
- input snapshot hash
- organization/workspace context

## What It Does

`CompareScenarios` compares one baseline schedule against one or more candidate
schedules and returns:

- baseline scenario card
- candidate scenario cards
- workspace, organization, horizon, input snapshot hash and engine version for
  audit/replay context
- KPI deltas
- stability/nervousness report
- publish status: `publishable`, `review`, or `blocked`
- recommendation text
- recommended candidate schedule id
- publishable candidate ids

## Publish Assessment Rules

The first version marks a candidate:

- `blocked` if the solver did not produce a feasible schedule
- `blocked` if planner exceptions are blocked
- `blocked` if frozen operations changed versus baseline
- `review` if total lateness increased
- `review` if the stability report detects nervousness
- `publishable` otherwise

This gives the future UI/API a stable decision surface without hiding the
underlying metrics or stability details.

## Publishing

`PublishScenario` promotes an existing schedule run to `lifecycle_status =
published`.

Rules:

- If a baseline is provided, publishing reuses `CompareScenarios`.
- `blocked` candidates cannot be published.
- `review` candidates require `allow_review=True`.
- `publishable` candidates are promoted directly.
- Promotion uses the schedule repository's context update method, so schedule
  assignments stay immutable.

## API Surface

The scenario layer is exposed through scheduling endpoints without adding a
second scenario persistence model:

- `POST /scheduling/runs/{schedule_id}/edits/apply`
- Payload: interactive `edits`, horizon, strategy/reschedule mode and optional
  candidate `scenario_name` / `lifecycle_status`
- Response: persisted candidate schedule id, generated planner actions,
  candidate run response and a Gantt projection with baseline deltas
- Candidate diagnostics: `repair_scope` for impacted-operation explainability
  and `planner_decisions` for the versioned action log

- `POST /scheduling/scenarios/compare`
- Payload: `baseline_schedule_id`, `candidate_schedule_ids`,
  `max_operation_changes`
- Response: baseline card, candidate comparisons, KPI deltas, stability report,
  publish status, recommended schedule id, publishable candidate ids and replay
  audit fields

- `POST /scheduling/scenarios/{schedule_id}/publish`
- Payload: optional `baseline_schedule_id`, optional `scenario_name`,
  `allow_review`
- Response: promoted schedule id, lifecycle status, publish status,
  recommendation, optional baseline comparison and metadata including the input
  snapshot hash

## Extension Rules

- Keep persisted schedule runs as the source of truth until a dedicated scenario
  table is required by workflow needs.
- Do not duplicate schedule persistence.
- Add publish rules only when they can be explained through diagnostics,
  metrics, or stability reports.
- Future scenario tables should link to schedule ids instead of copying
  assignments.
