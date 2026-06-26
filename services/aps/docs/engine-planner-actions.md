# Engine Planner Actions

This note documents the first planner action layer.

The core helper is:

- `planiadvance_v2/application/use_cases/planner_actions.py`
- `apply_planner_actions(...)`

Planner actions do not schedule by themselves. They convert planner intent into
normal engine inputs before the solver runs.

## Supported Actions

Supported now:

- `freeze_operation`: pin an operation to its baseline schedule assignment
- `unfreeze_operation`: release an operation from a repair-local baseline lock
- `force_machine`: restrict an operation to one machine
- `change_priority`: change a work order priority for the run
- `exclude_work_order`: remove a work order from the run
- `standby_operation`: remove one operation from the candidate scenario without
  deleting the source work order/master data
- `reinsert_standby_operation`: explicitly put a previously stand-by operation
  back into the candidate scenario when replaying a cumulative decision log
- `override_due_date`: change a work order due date for the run
- `add_overtime`: add a one-off working window to a calendar or a specific
  machine for the run

## Overtime Behavior

`add_overtime` requires:

- `start`
- `end`
- either `machine_id` or `calendar_id`

When `machine_id` is provided, the engine clones that machine's calendar and
adds the overtime window only to the clone. This avoids silently adding
overtime to other machines that happen to share the same base calendar.

When `calendar_id` is provided, the overtime window applies to every machine
using that calendar.

## Current Wiring

`RunSchedulingInput` accepts `planner_actions`.

The HTTP `/scheduling/run` request also accepts `planner_actions`, so API,
ERP, and future UI callers can drive the same action language without calling
the application layer directly.

`RunScheduling` applies actions before:

- lot splitting
- validation gate
- strategy selection
- input snapshot hashing

The result is exposed in:

- top-level diagnostics: `planner_actions`
- top-level diagnostics: `planner_decisions`
- top-level diagnostics: `repair_scope`
- planner read model: `planner_diagnostics.planner_actions`
- input snapshot metadata: `planner_actions`

## Impact Report

Every applied action can now attach an `impact` payload to explain the exact
input mutation made before the solver runs. `PlannerActionResult` aggregates
these payloads under `impact_report`.

Examples:

- `force_machine`: previous eligible machines and the forced machine.
- `change_priority`: previous and new priority.
- `override_due_date`: previous and new due date.
- `exclude_work_order`: removed work order and operation ids.
- `standby_operation`: removed operation id, source work order and original
  sequence for the scenario.
- `reinsert_standby_operation`: restored operation id, source work order and
  original sequence for the scenario.
- `freeze_operation`: frozen machine/start/end copied from the baseline.
- `unfreeze_operation`: operation released from baseline repair lock.
- `add_overtime`: added window, affected machine/calendar, and whether a
  machine-specific calendar clone was created.

The impact report is deliberately about planner intent transformed into engine
inputs. Schedule-level movement after the solver still belongs in the stability
report and scenario comparison layer.

## Planner Decision Log

`planner_decisions` is a versioned log derived from action applications. It is
stored with schedule diagnostics and therefore with persisted scenario runs.

Each record includes:

- `decision_id`: deterministic hash for the decision payload
- `decision_version`: currently `1`
- `sequence`: planner action order
- `action`: normalized planner action payload
- `status`, `message`, `target_ids`
- `impact`: same explanation payload used by `planner_actions.impact_report`

This gives future UI/API code an audit surface without creating a second
scenario persistence model too early.

Reinsertion exists specifically for replayable workflows: an API/CLI can submit
a cumulative decision list such as `standby_operation` followed later by
`reinsert_standby_operation`, and the engine can rebuild the current candidate
state without needing UI-local memory.

## Repair Scope

`repair_scope` explains which operations were intentionally released from the
baseline during `repair_local` / `net_change`.

It separates:

- direct planner actions
- work-order scoped actions
- downstream dependency impact
- machine conflicts from exact pins
- secondary-resource conflicts from exact pins
- material conflicts from exact pins

It also exposes:

- `repair_strategy`: `targeted_repair`,
  `stability_preserving_repair`, `full_reschedule`, or
  `blocked_until_constraint_resolution`
- `blocking_operation_ids`: operations that are intentionally not auto-released
  because a hard resource/material rule must be resolved first
- `recommended_actions`: structured next-best actions that API/CLI/UI callers
  can show without inventing planner logic outside the engine

`repair_scope.impacted_operation_ids` is also passed into the stability report,
so a planner-approved move is not misclassified as an accidental frozen-zone
violation.

Resource and material conflicts are reported in `repair_scope`, but they are
not automatically released from the frozen baseline. They remain blockers unless
a future explicit planner action chooses how to resolve them. This preserves the
industrial safety rule that exact pins must not silently double-book scarce
tools/operators or consume material before it is available.

When such a hard conflict blocks validation, the engine appends a short
suggestion to the `ValidationError`, for example `move_or_delay_pin` or
`delay_until_material_ready`, plus candidate action names already supported by
the APS workflow.

## Extension Rules

- Keep actions explicit and auditable.
- Apply actions to copied inputs, not repository objects.
- Use existing engine concepts whenever possible: work orders, operation
  eligibility, priorities, due dates, and frozen assignments.
- Do not embed solver-specific behavior in actions.
- Add overtime by modifying effective calendars/capacity, not by changing
  operation durations.
- Keep standby/unfreeze scoped to the candidate scenario; they are planning
  decisions, not destructive master-data edits.
