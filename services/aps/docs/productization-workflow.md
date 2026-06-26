# PlaniAdvance Product Workflow

This document captures the product-level workflow now expected by the UI and
engine. Use it before adding new pages or planner actions so the product stays
coherent and avoids duplicate scheduling features.

## 1. Baseline, Working Candidate, Publish

The official plan is the baseline. It should not be mutated directly by Gantt
actions.

Interactive planner actions follow this path:

1. Preview the edit through `POST /scheduling/runs/{id}/edits/preview`.
2. Apply the edit through `POST /scheduling/runs/{id}/edits/apply`.
3. Store the result as the current working candidate in the UI state.
4. Continue future Gantt edits from that working candidate.
5. Archive superseded intermediate candidates with `PATCH /scheduling/runs/{id}/context`.
6. Compare the working candidate against the baseline.
7. Publish the candidate through `POST /scheduling/scenarios/{id}/publish` or discard it.

This keeps the engine audit trail intact while avoiding a noisy planner
experience where every small action appears as an active scenario.

## 2. Planner Explanation Contract

Every schedule should expose `diagnostics.decision_layer`.

The UI expects:

- `requested_strategy`
- `selected_strategy`
- `requested_reschedule_mode`
- `selected_reschedule_mode`
- `engine_mode`
- `reason`
- `operator_explanation`
- `rules_triggered`
- `recommended_actions`
- `evidence`

The UI must show this when planners ask why strategies look similar or why auto
selected a specific engine posture. Do not reimplement strategy selection in the
frontend.

## 3. Scenario Page Shape

The Scenarios page should focus on decisions, not raw run storage.

Primary concepts:

- active baseline
- current working candidate
- comparison and publish action
- active run history
- archived intermediate candidates in a collapsed section

Archived runs remain available for audit but should not be promoted as the main
planner workflow.

## 3.1 Gantt Operator Window

The Gantt should remain a planner workbench, not a static chart. Operators can
inspect the full horizon or focus on day, week and month windows while staying
on the same persisted Gantt contract.

The Gantt already has a timeline selector. Keep one control for
`Horizon/Day/Week/Month/Quarter`; it controls both the visible window and the
time density. Do not add a second segmented control with duplicate
`Day/Week/Month` labels. If another time concept is needed later, first verify
whether it belongs in the existing timeline selector, the work-order/machine
filters, or the Plan Risk side panel.

The selected timeline mode and anchor are workbench state. Keep them above any
Gantt subcomponent that can unmount during loading, refresh or edit apply, so a
planner who is working in `Day` or `Week` does not get reset to `Horizon` after
moving an operation.

The UI should derive period counts from `GET /scheduling/runs/{id}/gantt`:

- visible versus hidden operations
- late operations
- critical operations
- changed operations versus baseline
- blocked/frozen operations
- active machines in the selected window

Do not add separate Gantt APIs for simple viewing windows unless the backend
needs server-side pagination for very large plans.

When a selected window needs operational risk guidance, use
`GET /scheduling/runs/{id}/risk` with `window_start`, `window_end` and optional
`baseline_schedule_id`. This keeps late operations, critical path signals,
machine pressure and firm/frozen constraints in the engine/API contract instead
of recomputing planner risk in the UI.

Risk recommendations should be action bridges, not direct hidden mutations:

- operation recommendations open the operation inspector so planners can run
  existing preview/apply actions such as find slots or unfreeze;
- work-order recommendations focus the affected work order in the Gantt;
- machine-pressure recommendations focus the affected machine lane;
- any real change still goes through `POST /scheduling/runs/{id}/edits/preview`
  and `POST /scheduling/runs/{id}/edits/apply`.

## 3.2 Planning Control Plane

Workspace planning state must live in the backend, not only in UI memory. The
API owns:

- active baseline schedule for the workspace;
- active working candidate, if any;
- candidate edit count and status;
- planner events that explain baseline selection, candidate edits, discard and
  publish.

Do not duplicate the scheduling/scenario workflow. The control plane observes
and records the existing engine contracts:

- `POST /scheduling/runs/{id}/edits/apply` creates the candidate schedule and
  records `candidate_edit_applied`;
- `POST /scheduling/scenarios/{id}/publish` remains the only publish command
  and records `candidate_published`;
- `POST /planning/baseline/select` selects an already persisted schedule as the
  active workspace baseline;
- `POST /planning/candidate/discard` archives and clears the active candidate;
- `GET /planning/state` and `GET /planning/events` let API clients resume the
  planner workflow without relying on a browser session.

## 3.3 Machine Capacity Ledger

Machine load and capacity must come from the engine, not from UI-side Gantt
math. The shared contract is:

- `GET /scheduling/runs/{id}/capacity`

The endpoint returns effective machine calendar minutes, scheduled setup/run
load, idle minutes, overload minutes, utilization, pressure and bottleneck by
`day`, `week` or full `horizon`. It uses the same central engine calculation as
rough-cut CTP, so the planner, dashboard and future ERP/MES consumers do not
drift into different definitions of capacity.

Keep the current machine model explicit: primary machines are unary capacity
resources (`capacity_units = 1`). Higher-capacity pools such as operators,
tools and crews stay in secondary `Resource` capacity until a real work-center
parallel-capacity model is added.

## 4. ERP/MES Integration Shape

Integration stays a thin UI over existing API routes:

- CSV pilot import for calendars, machines, work orders and operations.
- Canonical JSON import/export for full APS depth.
- Validate before import.
- Import into the active company/tenant.
- Persist automation jobs per workspace.
- Execute supported automation jobs on demand.
- Execute due scheduled jobs through `POST /integration/automations/run-due`,
  so SaaS cron workers and self-hosted workers share the same API/use case.
- Run the optional worker with `planiadvance automations run-due --loop` or the
  Docker Compose `integration-worker` service.
- Use persisted automation locks (`lock_owner`, `locked_until`) to prevent two
  workers from executing the same due job at the same time.
- Use retry state (`attempt_count`, `next_attempt_at`, `last_error_code`) so
  temporary connector failures back off instead of looping tightly.
- Use integration health (`GET /integration/automations/health`) to show due
  jobs, backoff, exhausted retries, failed jobs and worker locks before an
  operator changes data.
- Review the integration journal.

Do not create a separate ERP form that bypasses:

- `POST /integration/planning-snapshot/csv/validate`
- `POST /integration/planning-snapshot/csv/import`
- `POST /integration/planning-snapshot/validate`
- `POST /integration/planning-snapshot/import`
- `POST /integration/planning-snapshot/export`
- `GET /integration/automations`
- `POST /integration/automations`
- `GET /integration/automations/health`
- `POST /integration/automations/run-due`
- `POST /integration/automations/{id}/run`

## 5. Stability Gates

Before calling the product stable for demo or handoff:

- Build the UI with `npm run build` from `ui/`.
- Run targeted API tests for scheduling/integration changes.
- Run the industrial Docker smoke from `docs/industrial-docker-smoke.md`.
- Confirm `/health`, `/ready`, `/scheduling/run`, `/dashboard`, `/gantt`,
  `/capacity`, `/feasible-slots`, edit preview/apply, compare and publish all
  work on the industrial dataset.

The engine must remain usable through the API without the UI.
