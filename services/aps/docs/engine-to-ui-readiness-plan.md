# Engine To UI Readiness Plan

Goal: make the engine/API complete enough that a real planner UI can be built
without manual JSON entry and without duplicating scheduling logic in React.

The engine must remain usable by itself through API, Docker smoke tests and
integration workflows. The UI is a consumer of engine workflows, not the owner
of planning rules.

## Current State

Already available:

- finite scheduling with greedy/backward/auto strategy selection
- calendars, maintenance, setup matrices, alternative routings
- secondary resources, material readiness, supplies and inventory
- planner actions: move/pin/freeze/unfreeze/standby/reinsert/change priority
- scenario lifecycle: baseline, candidate, compare, publish
- Gantt read model with lanes, bars, deltas, warnings and editable actions
- feasible slot suggestions for assisted drag/drop
- WIP / firm / frozen read model and planning policy
- MES actual machine state for WIP locking without a baseline schedule
- industrial Docker smoke validating API, DB, seed, run, readiness, dashboard,
  Gantt and feasible slots
- UI handoff workflow in `docs/ui-connected-workflow-for-claude.md`

## Stop Condition

We are ready to start a serious UI when these are true:

- A seeded industrial dataset can be migrated, seeded, scheduled and smoke
  tested in Docker.
- `/scheduling/run`, `/readiness`, `/dashboard`, `/gantt`,
  `/feasible-slots`, `/edits/preview`, `/edits/apply`, `/scenarios/compare`
  and `/publish` are green.
- Planner actions are accessible through typed UI flows, not raw JSON.
- WIP/firm/frozen rules are enforced by the engine and visible in Gantt/readiness.
- The UI can create a baseline, inspect it, preview an edit, apply a candidate,
  compare and publish without the user writing JSON.

## Phase 1 - WIP Without Baseline

Purpose: support MES/shop-floor state even when there is no prior persisted
baseline schedule.

Add:

- `actual_machine_id` on operation domain/API/DB/canonical snapshots.
- Validation that `actual_machine_id` is known, eligible and paired with
  `actual_start`.
- Gantt display of `actual_machine_id`.
- Planning policy fallback: if `actual_machine_id + actual_start` exists and no
  baseline assignment exists, create a frozen WIP assignment from actual data.

Acceptance:

- A work order imported from MES with `actual_start`, `actual_machine_id` and
  `remaining_duration_minutes` can run through `/scheduling/run`.
- Diagnostics explain whether the lock came from baseline or actual shop-floor
  state.
- Gantt/readiness consumers can distinguish `baseline_schedule`,
  `actual_shop_floor` and `missing_baseline` lock sources.

## Phase 2 - Partial WIP Repair

Purpose: avoid treating every started operation as fully frozen when only part
of the work remains.

Implemented engine path:

- `RunScheduling` applies `split_wip_remaining()` after planner actions and
  lot splitting.
- The consumed shop-floor portion becomes a synthetic frozen operation
  `{operation_id}__actual_consumed`.
- The canonical operation id keeps only the remaining duration and is solved by
  the selected strategy.
- Before metrics/persistence/API output, `merge_wip_remaining_schedule()` folds
  the synthetic segment back into the canonical operation id.
- Diagnostics expose `diagnostics.wip_remaining_split` with original id,
  synthetic id, consumed minutes, remaining minutes and repair mode.
- Persisted Gantt reads those diagnostics and renders `actual_consumed` plus
  `remaining_planned` segments.

Still to add:

- Optional future machine-change policy for remaining WIP. Today remaining work
  stays on the actual machine to keep the merged Gantt/output unambiguous.
- Material/resource proportional consumption for the consumed segment. Today the
  remaining canonical operation keeps the original requirements conservatively.

Acceptance:

- A started operation can keep actual history while the remaining work is
  repaired after a disruption.
- Gantt can show actual segment plus planned remaining segment.

## Phase 3 - No-JSON UI API Helpers

Purpose: make frontend implementation straightforward and avoid debug-style JSON
forms.

Add or verify typed endpoints/read models for:

- baseline creation defaults
- move operation preview/apply
- freeze/unfreeze operation
- change priority
- add overtime
- standby/reinsert
- compare candidate vs baseline
- publish candidate

Acceptance:

- UI can call explicit helper functions for every planner button.
- Debug JSON editors are optional developer tools only.
- `docs/ui-connected-workflow-for-claude.md` matches actual route contracts.
- Gantt exposes `override_policy.move_policy` so the UI does not infer move
  behaviour from raw lock fields.

## Phase 4 - Planner Diagnostics Cards

Purpose: give the UI direct cards/messages instead of raw diagnostics digging.

Add:

- normalized readiness cards for WIP locks, firm locks, material blockers,
  resource conflicts, late orders and nervousness.
- stable `recommended_action` values matching UI buttons.
- Gantt item explanations for "why cannot move".
- `diagnostics.planning_policy_summary` with WIP, firm, frozen, manual-pinned
  and slushy review counts.

Acceptance:

- `/readiness` can power a planner sidebar.
- `/gantt` can power operation popovers.
- No frontend rule inference is needed.

## Phase 5 - Industrial Smoke Coverage For UI Loop

Purpose: protect the UI contract before UI work accelerates.

Add smoke coverage for:

- create baseline
- get dashboard/readiness/gantt
- get feasible slots
- preview move
- apply candidate
- compare baseline/candidate
- publish candidate

Acceptance:

- One Docker smoke proves the complete UI workflow against Postgres.

## Phase 6 - UI Start Gate

Start the real UI once Phases 1-5 are green.

UI requirements:

- API client layer with typed functions.
- No raw JSON for common actions.
- Gantt consumes `items`, `machine_lanes`, `work_order_lanes`.
- Planner actions are generated by buttons/forms.
- Candidate compare/publish flow is first-class.
- Debug JSON drawer allowed only behind a developer toggle.

## Work Discipline

- Do not duplicate existing concepts.
- Before adding a feature, search existing use cases, planner actions and
  diagnostics.
- Prefer extending current contracts over creating parallel endpoints.
- Keep Docker smoke green after every major engine slice.
- Commit after each coherent slice before starting the next one.
