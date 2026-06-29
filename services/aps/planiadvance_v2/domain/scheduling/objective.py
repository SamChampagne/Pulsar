"""Multi-objective cost function for scheduling.

Industrial-grade APS engines never optimise for a single metric. They let
the caller blend several weighted objectives (makespan, tardiness, setup
cost, resource utilisation ...) to match the current business situation.

This module exposes:

- :class:`Objective` — an immutable bundle of weights that defines the
  optimisation direction. It is strategy-agnostic: the greedy strategy
  uses it to rank heuristics, the CP-SAT strategy uses it to build the
  solver's objective expression.
- :func:`score_schedule` — evaluate a finished :class:`Schedule` against
  the objective so strategies can be compared on a level playing field.

The weights are integers (not floats) because CP-SAT objective
coefficients must be integral, and using the same unit everywhere removes
rounding mismatches between strategies.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from ..entities import Schedule, ScheduledOperation, WorkOrder
from ..errors import ValidationError
from .metrics import compute_stability


@dataclass(frozen=True, slots=True)
class Objective:
    """Weighted multi-objective cost function.

    All weights are non-negative integers. A weight of ``0`` disables the
    term entirely. The default reproduces the V2 behaviour: minimise
    makespan with a strong tardiness penalty.

    Parameters
    ----------
    makespan:
        Weight for ``max(end_i) - horizon_start`` (in minutes). Drives the
        solver to finish as early as possible.
    total_tardiness:
        Weight for ``sum(max(0, end_i - due_i))`` (in minutes). Drives the
        solver to respect due dates.
    weighted_tardiness:
        Weight for ``sum(priority_i * tardiness_i)``. Lets strategic
        customers preempt others automatically.
    setup_cost:
        Weight for total minutes spent in sequence-dependent setups. Lets
        the solver trade a bit of makespan for better batching.
    idle_penalty:
        Weight for total machine idle minutes within the horizon. Useful
        when you prefer compact plans even if it doesn't strictly reduce
        makespan.
    start_shift_penalty:
        Weight for each minute an operation's start shifts versus the
        baseline schedule. Lets re-planning favour less nervous plans.
    machine_change_penalty:
        Weight for every operation that moves to another machine versus
        the baseline schedule.
    """

    makespan: int = 1
    total_tardiness: int = 10
    weighted_tardiness: int = 0
    setup_cost: int = 0
    idle_penalty: int = 0
    start_shift_penalty: int = 0
    machine_change_penalty: int = 0

    def __post_init__(self) -> None:
        for name in (
            "makespan",
            "total_tardiness",
            "weighted_tardiness",
            "setup_cost",
            "idle_penalty",
            "start_shift_penalty",
            "machine_change_penalty",
        ):
            value = getattr(self, name)
            if value < 0:
                raise ValidationError(
                    f"Objective.{name} must be >= 0, got {value}"
                )
        if self.total_weight() == 0:
            raise ValidationError(
                "Objective must have at least one non-zero weight"
            )

    def total_weight(self) -> int:
        return (
            self.makespan
            + self.total_tardiness
            + self.weighted_tardiness
            + self.setup_cost
            + self.idle_penalty
            + self.start_shift_penalty
            + self.machine_change_penalty
        )

    @classmethod
    def default(cls) -> Objective:
        return cls()

    @classmethod
    def makespan_only(cls) -> Objective:
        return cls(makespan=1, total_tardiness=0)

    @classmethod
    def customer_first(cls) -> Objective:
        """Prioritise due dates and strategic customers above all."""
        return cls(makespan=1, total_tardiness=5, weighted_tardiness=20)


def score_schedule(
    schedule: Schedule,
    work_orders: list[WorkOrder],
    objective: Objective,
    *,
    horizon_start: datetime,
    baseline_schedule: Schedule | None = None,
) -> int:
    """Compute the integer cost of a finished schedule under an objective.

    Strategies return ``Schedule`` instances; the caller can use this
    helper to compare them head-to-head regardless of which strategy
    produced them. Lower score = better plan.
    """
    if not schedule.assignments:
        return 0

    wo_by_id = {wo.id: wo for wo in work_orders}

    # Makespan relative to the horizon origin so the value is meaningful
    # even when only a subset of the horizon is used.
    latest_end = max(a.end for a in schedule.assignments)
    makespan_min = max(
        int((latest_end - horizon_start).total_seconds() // 60), 0
    )

    # Tardiness is measured per-work-order on the last operation.
    wo_end: dict[str, datetime] = {}
    for a in schedule.assignments:
        current = wo_end.get(a.work_order_id)
        if current is None or a.end > current:
            wo_end[a.work_order_id] = a.end

    # V1.2 Cas 2 — firmness modulates the tardiness penalty so a
    # forecast WO doesn't fight for capacity as hard as a firm
    # customer order. Same numbers Stripe / OptaPlanner use for
    # demand-driven planning:
    #   firm      → 1.0  (full weight, default)
    #   forecast  → 0.3  (yields when capacity is tight)
    #   tentative → 0.1  (planning-only what-if)
    firmness_weight = {
        "firm": 1.0,
        "forecast": 0.3,
        "tentative": 0.1,
    }

    total_tardiness = 0
    weighted_tardiness = 0
    for wo_id, end in wo_end.items():
        wo = wo_by_id.get(wo_id)
        if wo is None:
            continue
        if end > wo.due_date:
            late_min = int((end - wo.due_date).total_seconds() // 60)
            weight = firmness_weight.get(wo.firmness.value, 1.0)
            total_tardiness += int(late_min * weight)
            weighted_tardiness += int(int(wo.priority) * late_min * weight)

    # Setup minutes: difference between full window and run window.
    setup_cost = 0
    for a in schedule.assignments:
        setup_cost += int((a.start - a.setup_start).total_seconds() // 60)

    # Idle = machine busy span minus busy minutes, summed across machines.
    idle_penalty = 0
    per_machine: dict[str, list] = {}
    for a in schedule.assignments:
        per_machine.setdefault(a.machine_id, []).append(a)
    for assignments in per_machine.values():
        assignments.sort(key=lambda a: a.setup_start)
        first = assignments[0].setup_start
        last = assignments[-1].end
        span = int((last - first).total_seconds() // 60)
        busy = sum(
            int((a.end - a.setup_start).total_seconds() // 60) for a in assignments
        )
        idle_penalty += max(span - busy, 0)

    start_shift_penalty = 0
    machine_change_penalty = 0
    if baseline_schedule is not None and (
        objective.start_shift_penalty > 0 or objective.machine_change_penalty > 0
    ):
        stability = compute_stability(schedule, baseline_schedule)
        start_shift_penalty = stability.total_start_shift_minutes
        machine_change_penalty = stability.machine_change_count

    return (
        objective.makespan * makespan_min
        + objective.total_tardiness * total_tardiness
        + objective.weighted_tardiness * weighted_tardiness
        + objective.setup_cost * setup_cost
        + objective.idle_penalty * idle_penalty
        + objective.start_shift_penalty * start_shift_penalty
        + objective.machine_change_penalty * machine_change_penalty
    )


def score_assignment_change(
    *,
    baseline_assignment: ScheduledOperation | None,
    candidate_machine_id: str,
    candidate_start: datetime,
    objective: Objective,
) -> int:
    """Compute a local nervousness penalty for a candidate placement."""
    if baseline_assignment is None:
        return 0
    start_shift_minutes = int(
        abs((candidate_start - baseline_assignment.start).total_seconds()) // 60
    )
    machine_changed = int(candidate_machine_id != baseline_assignment.machine_id)
    return (
        objective.start_shift_penalty * start_shift_minutes
        + objective.machine_change_penalty * machine_changed
    )
