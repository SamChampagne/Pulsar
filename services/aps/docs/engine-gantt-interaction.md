# Interactive Gantt Engine Contract

PlaniAdvance should treat a Gantt as a planner decision surface, not as a
direct editor of persisted assignments. The UI can suggest moves, pins and
freezes, but the engine remains responsible for validating constraints,
repairing the plan and producing an auditable scenario.

## Current Foundation

- `GET /scheduling/runs/{schedule_id}/gantt` returns a read-only projection for a
  persisted schedule run.
- The projection includes operation bars, machine lanes, work-order lanes,
  master-data labels, late/critical flags, eligible machines, dependencies,
  resource/material requirement ids and optional baseline deltas.
- The response advertises `interaction_contract.version =
  interactive-gantt-v1` and `assignment_mutation = forbidden` so future UI code
  does not accidentally bypass the engine.
- Optional `baseline_schedule_id` lets the UI show what moved between a
  published plan and a what-if candidate.
- `POST /scheduling/runs/{schedule_id}/edits/preview` accepts UI-friendly
  `PlanningEdit` objects, converts supported edits into existing
  `PlannerAction` records and returns a non-persisted candidate plan.

## UI Agent Quick Start

Use these existing tools before creating any new endpoint:

- Load the active plan with `GET /scheduling/runs?workspace_id=...` and pick a
  `schedule_id`.
- Render the Gantt with `GET /scheduling/runs/{schedule_id}/gantt`.
- Before a drag/drop, ask the engine for placement candidates with
  `GET /scheduling/runs/{schedule_id}/operations/{operation_id}/feasible-slots`.
- Preview drag/drop, freeze and priority edits with
  `POST /scheduling/runs/{schedule_id}/edits/preview`.
- Save an accepted preview as a draft candidate with
  `POST /scheduling/runs/{schedule_id}/edits/apply`.
- Compare saved candidates with `POST /scheduling/scenarios/compare`.
- Promote an approved candidate with `POST /scheduling/scenarios/{schedule_id}/publish`.

Do not build UI code against `/scheduling/run` directly for drag/drop. The
interactive route exists so the UI can speak planner intent while the engine
handles repair, diagnostics and auditability.

### Gantt Read Model

`GET /scheduling/runs/{schedule_id}/gantt` returns:

- `machine_lanes`: lane metadata and aggregate setup/run minutes.
- `work_order_lanes`: order metadata, due date, priority and late flag.
- `items`: one bar per scheduled operation with labels, times, setup/run
  minutes, eligible machines, dependencies, material/resource ids, critical/late
  flags and editable action names.
- `interaction_contract`: tells the UI that direct assignment mutation is
  forbidden and that the supported lifecycle is preview, apply-to-scenario,
  publish.

Optional query:

```http
GET /scheduling/runs/{candidate_id}/gantt?baseline_schedule_id={baseline_id}
```

Use this to show baseline/candidate deltas. Each `item` then includes
`baseline_machine_id`, `baseline_start`, `baseline_end`,
`changed_from_baseline` and `start_delta_minutes`.

### Feasible Slot Suggestions

`GET /scheduling/runs/{schedule_id}/operations/{operation_id}/feasible-slots`
returns engine-assisted slots for an operation on the current baseline plan.

Query options:

- `search_start`: optional earliest instant to consider.
- `max_results`: cap the returned slots, default `8`, maximum `50`.

The use case ignores the operation's current baseline assignment, keeps the
rest of the baseline occupied, and checks:

- eligible machines and calendars/maintenance;
- existing machine occupancy;
- dependency timing against already scheduled predecessors;
- secondary-resource capacity;
- material readiness from inventory and inbound supply.

The UI should use these slots to highlight feasible landing zones. A planner
drag still needs to be sent through `POST /edits/preview`, because the preview
is the auditable decision and may trigger local repair around the selected
slot.

Each slot is ranked for assisted UI placement:

- `rank`: 1-based recommendation order.
- `score`: lower is better.
- `score_components`: wait minutes, setup minutes, baseline start shift and
  machine-change penalty.
- `baseline_start_delta_minutes`: time shift versus the baseline assignment.
- `baseline_machine_change`: whether the slot changes the baseline machine.
- `reasons`: explainable tags such as `material_available`,
  `same_machine_as_baseline` or `machine_change_from_baseline`.

### Preview Payloads

Machine-only drag preview:

```json
{
  "horizon_start": "2026-01-05T00:00:00",
  "horizon_days": 5,
  "strategy": "auto",
  "reschedule_mode": "repair_local",
  "edits": [
    {
      "edit_type": "move_operation",
      "operation_id": "OP-10",
      "machine_id": "M2"
    }
  ]
}
```

Exact drag/drop pin preview:

```json
{
  "horizon_start": "2026-01-05T00:00:00",
  "horizon_days": 5,
  "strategy": "auto",
  "reschedule_mode": "repair_local",
  "edits": [
    {
      "edit_type": "move_operation",
      "operation_id": "OP-10",
      "machine_id": "M2",
      "start": "2026-01-05T09:00:00",
      "end": "2026-01-05T10:00:00"
    }
  ]
}
```

The exact form maps to `pin_operation_window`. The engine validates machine
eligibility, routing duration, effective machine calendar/maintenance and
frozen predecessor timing before accepting the pinned assignment. It also
checks secondary-resource capacity against the frozen baseline, so a pinned
operation cannot silently double-book a unique operator/tool/mould already
consumed by another frozen operation. If the pinned window overlaps baseline
operations on the same machine, those operations are unfrozen so `repair_local`
can move them around the planner decision.

Preview response:

- `planner_actions`: the engine-level actions generated from UI edits.
- `unsupported_edits`: UI intents the backend did not understand.
- `warnings`: non-blocking caveats.
- `preview`: a normal `RunScheduleResponse` with assignments, metrics,
  feasibility, diagnostics and planner action impact report.
- `gantt`: the same `ScheduleGanttResponse` contract as
  `GET /scheduling/runs/{schedule_id}/gantt`, generated from the non-persisted
  preview schedule with `baseline_schedule_id` set to the source plan. Use this
  directly for drag/drop visual feedback, changed bars, lane totals and
  baseline deltas.

Apply response:

- `POST /scheduling/runs/{schedule_id}/edits/apply` accepts the same edit
  payload as preview.
- It persists the result as a candidate schedule run with
  `baseline_schedule_id` pointing to the source plan.
- It returns `candidate`, `candidate_schedule_id`, `planner_actions`,
  `unsupported_edits`, `warnings` and a baseline-delta `gantt`.
- The UI should apply, then compare/publish instead of mutating the official
  schedule directly.
- The candidate diagnostics include `repair_scope` and `planner_decisions`.
  Use `repair_scope.impacted_operation_ids` to explain which operations were
  intentionally released from the repair baseline, and use
  `planner_decisions.records` as the auditable action log for the scenario.
- If `repair_scope.repair_strategy` is
  `blocked_until_constraint_resolution`, show
  `repair_scope.recommended_actions` instead of trying to force an apply.
  Resource/material conflicts are hard constraints until the planner changes
  the slot, adds capacity/supply, or explicitly changes the planning inputs.

## Rule

The UI must never mutate `Schedule.assignments` directly.

Planner interaction should follow this lifecycle:

1. `preview`: user action is converted into planner intent and simulated.
2. `apply_to_scenario`: accepted intent is kept in a draft/candidate scenario.
3. `publish`: the scenario is promoted after validations and impact checks.

## Existing Building Blocks

- `RunScheduling` already accepts `baseline_schedule_id` and `planner_actions`.
- `PlannerAction` already supports freeze, force machine, change priority,
  override due date, exclude work order, standby operation, unfreeze operation
  reinsert standby operation and overtime.
- `repair_local` and `net_change` already use the baseline schedule to preserve
  stable assignments.
- `CompareScenarios` and `PublishScenario` already provide scenario review and
  promotion semantics.

## Current Edit Preview

The edit-preview API avoids duplicating solver behavior:

- `PlanningEdit` DTO: UI-friendly intent such as `move_operation`,
  `freeze_operation`, `change_priority` or `override_due_date`.
- Edit mapper: translate supported `PlanningEdit` records into existing
  `PlannerAction` objects.
- `POST /scheduling/runs/{schedule_id}/edits/preview`: run scheduling with
  `persist=false`, `baseline_schedule_id=schedule_id` and
  `reschedule_mode=repair_local`.
- Preview response: return the candidate run, action impact report and warnings
  for partially supported edits, plus a Gantt projection with baseline deltas.

`move_operation` has two levels:

- With only `operation_id` and `machine_id`, it previews a machine constraint by
  mapping to `force_machine`.
- With `operation_id`, `machine_id`, `start` and `end`, it maps to
  `pin_operation_window`, creates a pinned/frozen assignment, and unfreezes any
  baseline operation that overlaps the pinned window so `repair_local` can move
  the conflict.

The exact pin implementation validates the selected routing duration, machine
eligibility, effective working calendar including maintenance, and dependency
timing against frozen predecessors. It also validates secondary-resource
capacity against frozen assignments. Feasible-slot suggestions are available so
the UI can show likely landing zones before the planner drops an operation.

## Next Engine Slice

Harden assisted interactive placement support:

- Calendar, machine-maintenance, frozen-predecessor dependency and
  secondary-resource capacity validation are already done.
- Material availability is validated against frozen/pinned assignments before
  the preview solve, so a planner cannot pin an operation before inbound supply
  exists or double-consume material already reserved by a frozen operation.
- Return a rich Gantt delta from the preview endpoint, not only the candidate
  `RunScheduleResponse`, is already done.
- Material-aware feasible-slot suggestions for the Gantt are available.
- Persisted candidate creation from interactive edits is available through
  `POST /scheduling/runs/{schedule_id}/edits/apply`.
- Scenario compare/publish can now be used as the final approval gate after
  interactive edits.

That keeps the architecture clean: the UI speaks planner intent, the engine
chooses the scheduling strategy, and every accepted change remains replayable.
