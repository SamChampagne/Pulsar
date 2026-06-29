"""Unit tests for operation-ordering heuristics.

These tests exercise the heuristic implementations in isolation from
the scheduler — each heuristic is a pure function that turns a list of
``(work_order, operation)`` pairs into an ordered list, so we can
assert on the order directly without ever placing anything on a
timeline.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from planiadvance_v2.domain.entities import Operation, WorkOrder
from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.domain.scheduling.heuristics import (
    ApparentTardinessCost,
    EarliestDueDateFirst,
    PriorityWeightedEDD,
    ShortestProcessingTimeFirst,
    resolve_heuristic,
)
from planiadvance_v2.domain.value_objects import Duration, Priority

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

NOW = datetime(2026, 1, 5, 8, 0, 0)  # Monday 08:00


def _op(
    op_id: str, duration_min: int, wo_id: str, sequence: int = 1
) -> Operation:
    return Operation(
        id=op_id,
        work_order_id=wo_id,
        sequence=sequence,
        name=op_id,
        duration=Duration(minutes=duration_min),
        eligible_machine_ids=["M1"],
    )


def _wo(
    wo_id: str,
    *,
    due_hours: int,
    priority: Priority = Priority.NORMAL,
    duration_min: int = 60,
) -> tuple[WorkOrder, Operation]:
    op = _op(f"{wo_id}-OP", duration_min, wo_id)
    wo = WorkOrder(
        id=wo_id,
        name=wo_id,
        product_id=f"PROD-{wo_id}",
        quantity=1,
        release_date=NOW,
        due_date=NOW + timedelta(hours=due_hours),
        operations=[op],
        priority=priority,
    )
    return wo, op


# --------------------------------------------------------------------------
# Registry sanity
# --------------------------------------------------------------------------


def test_resolve_heuristic_returns_atc():
    h = resolve_heuristic("atc")
    assert isinstance(h, ApparentTardinessCost)


def test_atc_rejects_non_positive_k():
    with pytest.raises(ValidationError):
        ApparentTardinessCost(k=0)
    with pytest.raises(ValidationError):
        ApparentTardinessCost(k=-1)


# --------------------------------------------------------------------------
# ATC behaviour
# --------------------------------------------------------------------------


class TestApparentTardinessCost:
    def test_empty_input_returns_empty(self):
        assert ApparentTardinessCost().order([], NOW) == []

    def test_urgent_priority_wins_when_slacks_are_close(self):
        """When two jobs have equal processing time but different weights,
        ATC must schedule the higher-priority one first — that's the
        whole point of the (w/p) term."""
        wo_urgent, op_urgent = _wo("A", due_hours=4, priority=Priority.URGENT)
        wo_normal, op_normal = _wo("B", due_hours=4, priority=Priority.NORMAL)
        ordered = ApparentTardinessCost().order(
            [(wo_normal, op_normal), (wo_urgent, op_urgent)], NOW
        )
        assert ordered[0][0].id == "A"
        assert ordered[1][0].id == "B"

    def test_tighter_slack_overrides_priority_on_equal_weights(self):
        """When both jobs are NORMAL, the one whose slack is smaller
        wins because the exponential pressure term overwhelms the
        weight ratio."""
        wo_loose, op_loose = _wo("LOOSE", due_hours=48, priority=Priority.NORMAL)
        wo_tight, op_tight = _wo("TIGHT", due_hours=2, priority=Priority.NORMAL)
        ordered = ApparentTardinessCost().order(
            [(wo_loose, op_loose), (wo_tight, op_tight)], NOW
        )
        assert ordered[0][0].id == "TIGHT"

    def test_shorter_processing_time_wins_on_equal_slack(self):
        """With equal priority and nearly-identical slack, the job with
        smaller ``p_j`` has a larger ``w/p`` ratio and wins — degenerate
        SPT behaviour when due dates do not discriminate."""
        wo_short, op_short = _wo(
            "SHORT", due_hours=24, priority=Priority.NORMAL, duration_min=30
        )
        wo_long, op_long = _wo(
            "LONG", due_hours=24, priority=Priority.NORMAL, duration_min=240
        )
        ordered = ApparentTardinessCost().order(
            [(wo_long, op_long), (wo_short, op_short)], NOW
        )
        assert ordered[0][0].id == "SHORT"

    def test_deterministic_on_identical_jobs(self):
        """Ties must break on due date then sequence so the order is
        reproducible across runs — flaky heuristics produce flaky
        integration tests and ship dates."""
        wo1, op1 = _wo("A", due_hours=4, priority=Priority.NORMAL)
        wo2, op2 = _wo("B", due_hours=4, priority=Priority.NORMAL)
        ordered_first = ApparentTardinessCost().order(
            [(wo1, op1), (wo2, op2)], NOW
        )
        ordered_second = ApparentTardinessCost().order(
            [(wo2, op2), (wo1, op1)], NOW
        )
        assert [p[0].id for p in ordered_first] == [
            p[0].id for p in ordered_second
        ]


# --------------------------------------------------------------------------
# Greedy auto-pick rule
# --------------------------------------------------------------------------


class TestGreedyAutoPicksAtc:
    def test_atc_selected_when_both_tardiness_weights_active(self):
        from planiadvance_v2.domain.scheduling.greedy_strategy import GreedyStrategy
        from planiadvance_v2.domain.scheduling.objective import Objective

        strategy = GreedyStrategy()
        picked = strategy._pick_heuristic(
            Objective(makespan=1, total_tardiness=5, weighted_tardiness=10)
        )
        assert isinstance(picked, ApparentTardinessCost)

    def test_priority_edd_when_only_weighted_tardiness(self):
        from planiadvance_v2.domain.scheduling.greedy_strategy import GreedyStrategy
        from planiadvance_v2.domain.scheduling.objective import Objective

        strategy = GreedyStrategy()
        picked = strategy._pick_heuristic(
            Objective(makespan=1, total_tardiness=0, weighted_tardiness=10)
        )
        assert isinstance(picked, PriorityWeightedEDD)

    def test_edd_when_no_tardiness_weight(self):
        from planiadvance_v2.domain.scheduling.greedy_strategy import GreedyStrategy
        from planiadvance_v2.domain.scheduling.objective import Objective

        strategy = GreedyStrategy()
        picked = strategy._pick_heuristic(Objective.makespan_only())
        assert isinstance(picked, EarliestDueDateFirst)

    def test_heuristic_override_wins(self):
        from planiadvance_v2.domain.scheduling.greedy_strategy import GreedyStrategy
        from planiadvance_v2.domain.scheduling.objective import Objective

        strategy = GreedyStrategy(heuristic=ShortestProcessingTimeFirst())
        picked = strategy._pick_heuristic(
            Objective(makespan=1, total_tardiness=5, weighted_tardiness=10)
        )
        assert isinstance(picked, ShortestProcessingTimeFirst)
