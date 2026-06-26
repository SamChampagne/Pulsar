# Engine Decision Layer

This note documents the first automatic planner decision layer.

The core helper is:

- `planiadvance_v2/application/use_cases/planning_decision_layer.py`
- `select_planning_decision(...)`

It does not duplicate solver logic. It chooses between existing strategies and
reschedule modes when callers request `strategy="auto"`.

## Current Signals

The decision layer consumes existing engine outputs:

- feasibility status and dominant issue kind
- planner exception status, when available
- metrics, when available
- persisted baseline metrics and exceptions for baseline-aware replan,
  disruption, and strategy comparison
- baseline schedule presence
- schedule lifecycle context

It intentionally avoids duplicating feasibility, exception, or solver logic.

## Current Modes

The first version emits:

- `normal`: ready shop, no baseline pressure
- `degraded`: warnings or due-date pressure
- `repair`: hard blockers, planner exceptions, or baseline-preserving replan

## Current Strategy Rules

- Explicit strategies are respected as-is.
- `strategy="auto"` uses `greedy` for normal operational dispatch.
- `strategy="auto"` uses `hybrid` when due-date pressure is detected before
  solve, when lateness pressure is available from metrics, or for what-if
  scenario runs.
- `hybrid` runs forward `greedy` and `backward` just-in-time, then keeps the
  best objective. It is a portfolio wrapper, not a duplicated scheduler.
- `strategy="auto"` keeps `greedy` when a baseline schedule is present because
  preserving stability is more important than changing scheduling posture.
- If a baseline is present and the caller left `reschedule_mode` at
  `reschedule_all`, auto mode normalizes it to `repair_local`.

## Current Wiring

The decision report is exposed in:

- top-level diagnostics: `decision_layer`
- planner read model: `planner_diagnostics.decision_layer`

`RunScheduling`, `RunSchedulingFromSnapshot`, `CompareStrategies`, and
`RunDisruption` are wired. `RunScheduling`, `CompareStrategies`, and
`RunDisruption` also pass persisted baseline metrics/exceptions into the
decision evidence when a baseline schedule is involved. Future scenario and
planner-action workflows should reuse this layer rather than embedding
strategy-selection rules directly in API routes.

## Extension Rules

- Add rules only when they consume existing diagnostics or stable planner
  actions.
- Keep every rule explainable through `rules_triggered`, `reason`, and
  `evidence`.
- Do not call solvers from this layer.
- Do not hide explicit caller choices.
