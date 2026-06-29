# Engine WIP, Firm And Frozen Zones

This is the next engine gap after the industrial Docker smoke is green. The
goal is not to add another "frozen" flag. The goal is to formalize shop-floor
execution state and planning time fences so the solver, API and future Gantt UI
all speak the same language.

## Current Baseline

PlaniAdvance already has:

- baseline schedules persisted as immutable runs
- planner actions such as `freeze_operation`, `pin_operation_window`,
  `standby_operation` and `reinsert_standby_operation`
- rolling-horizon behavior through frozen assignments
- stability checks that detect frozen operation changes
- scenario compare/publish gates

Keep these. The next slice should connect them through a clearer domain model,
not duplicate them.

## Target Concepts

- `execution_status`: `not_started`, `queued`, `in_progress`, `paused`,
  `completed`, `blocked`, `scrapped`, `partially_completed`
- `planning_lock`: `free`, `soft_locked`, `manual_pinned`, `firm`,
  `started_frozen`, `completed_frozen`
- `planning_zone`: `frozen`, `slushy`, `liquid`
- `firm_until`: timestamp fence where moves require explicit planner override
- `frozen_until`: timestamp fence where moves are blocked except for hard
  disruption repair
- `actual_start` / `actual_machine_id` / `actual_end` /
  `remaining_duration_minutes`

## Engine Rules

- Completed operations are never rescheduled.
- In-progress operations keep their actual start and only remaining work can be
  reasoned about.
- Firm operations can block a candidate unless the planner passes an explicit
  override action.
- Manual pins are planner decisions and must appear in diagnostics/action logs.
- Soft locks are stability preferences, not hard constraints.
- Slushy-zone moves should carry nervousness penalties and clear explanations.

## API Readiness

Future UI/API endpoints should be able to show:

- why an operation cannot be dragged
- whether a move violates frozen, firm, WIP, material or resource constraints
- which override action would be required
- what downstream operations become impacted
- whether the plan can be published after the edit

## First Implementation Slice

Implemented:

- added explicit domain enums for execution status, planning lock and planning
  zone
- mapped existing operation statuses and planner action diagnostics into those
  concepts
- extended Gantt items with lock/zone/override metadata
- extended readiness UI contract with the same disposition version
- added API proof tests for default free operations, WIP/completed frozen
  operations, and manual pinned planner edits
- persisted execution/time-fence fields on operations in domain, SQL, CRUD,
  canonical integration and CSV/JSON snapshot codecs
- used `actual_start`, `actual_end`, `remaining_duration_minutes`,
  `firm_until` and `frozen_until` directly in Gantt disposition
- added `planning-policy-v1` in `RunScheduling` so WIP/fence locks become
  real `FrozenAssignment` inputs before the selected strategy solves
- added `actual_machine_id` so MES/imported shop-floor state can freeze WIP
  operations without a previously persisted baseline schedule
- added `wip_remaining_split` so partial WIP is represented to the solver as
  actual consumed history plus schedulable remaining work, then merged back to
  the canonical operation id before persistence/API output

## Gantt Fields

Each Gantt operation item now includes:

- `execution_status`
- `planning_lock`
- `planning_zone`
- `movable`
- `override_required`
- `lock_reason`
- `required_override_action`
- `override_policy` with `move_policy = allowed | review_required |
  override_required | blocked`
- `actual_start`
- `actual_machine_id`
- `actual_end`
- `actual_consumed_minutes`
- `remaining_duration_minutes`
- `planned_remaining_minutes`
- `wip_repair_mode`
- `firm_until`
- `frozen_until`

The current mapping is intentionally conservative for manual interaction, but
the run path can now repair partial WIP:

- completed operations -> `completed_frozen`, not movable
- in-progress operations -> `started_frozen`, not movable
- operations with remaining actual work -> the consumed segment is frozen as
  actual history; the remaining segment is solved as schedulable work on the
  actual machine and appears in persisted Gantt as `remaining_planned`
- operations inside `frozen_until` -> `firm`, frozen, not movable and no UI
  override action
- operations inside `firm_until` -> `firm`, frozen, requires
  `unfreeze_operation`
- `pin_operation_window` -> `manual_pinned`, frozen, requires
  `unfreeze_operation`
- `freeze_operation` -> `firm`, frozen, requires `unfreeze_operation`
- `force_machine` -> `soft_locked`, slushy, still movable with review
- default scheduled work -> `free`, liquid, movable

`override_policy` is the stable UI contract:

- `blocked`: engine says no direct move.
- `override_required`: move needs the listed `required_action`.
- `review_required`: move is allowed but must be reviewed before publish.
- `allowed`: normal preview/apply workflow.

## Next Slice

The next slice should deepen the same model instead of duplicating it:

- decide whether remaining WIP may move to an alternate machine, and if yes,
  expose multi-machine actual/remaining bars instead of a single merged bar
- split material/resource consumption proportionally between consumed and
  remaining WIP where the master data supports it
- turn readiness review counts into richer action-specific recommendations if
  planners need more than the current summary cards
