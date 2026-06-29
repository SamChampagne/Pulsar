"""Rolling-horizon / frozen assignment tests.

Real-world APS engines rerun periodically (every hour, every shift change,
after any event). Each rerun has to honour the portion of the previous
plan that is already in progress: operations whose setup has started must
not move, and operations that depend on them must line up with their real
end time. That's exactly what :class:`FrozenAssignment` models.

These tests exercise four layers:

1. :class:`FrozenAssignment` value-object validation (basic invariants).
2. :class:`SchedulingContext` validation of frozen assignments against
   the live set of machines and work orders.
3. The **forward** greedy strategy honours frozen placements (pre-books
   the timeline, seeds ``completed_ends`` so the next op waits for the
   real end, does not re-place the frozen op).
4. The **backward** greedy strategy honours frozen placements (pre-books
   the timeline, tightens the ``latest_end`` of predecessors so the
   predecessor finishes by the frozen setup start).
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

import pytest

from planiadvance_v2.domain.entities import Machine, WorkingCalendar
from planiadvance_v2.domain.errors import (
    UnknownResourceError,
    ValidationError,
)
from planiadvance_v2.domain.scheduling import (
    FrozenAssignment,
    Objective,
    SchedulingContext,
    resolve_strategy,
)
from planiadvance_v2.domain.value_objects import Shift
from tests.conftest import make_work_order

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _calendar() -> WorkingCalendar:
    """Standard Mon–Fri 08-17 calendar matching the shared fixtures."""
    return WorkingCalendar(
        id="CAL",
        name="Mon-Fri 08-17",
        shifts=[Shift(weekday=w, start=time(8, 0), end=time(17, 0)) for w in range(5)],
    )


def _machine(mid: str = "M1") -> Machine:
    return Machine(id=mid, name=mid, calendar_id="CAL")


MONDAY = datetime(2026, 1, 5, 0, 0, 0)  # fixed Monday for deterministic assertions


# --------------------------------------------------------------------------
# FrozenAssignment value object
# --------------------------------------------------------------------------


class TestFrozenAssignmentValidation:
    def test_valid_assignment_builds(self):
        fa = FrozenAssignment(
            operation_id="OP1",
            work_order_id="WO1",
            machine_id="M1",
            setup_start=MONDAY + timedelta(hours=8),
            start=MONDAY + timedelta(hours=8, minutes=15),
            end=MONDAY + timedelta(hours=9),
        )
        assert fa.full_window.start == MONDAY + timedelta(hours=8)
        assert fa.full_window.end == MONDAY + timedelta(hours=9)

    def test_setup_start_after_start_rejected(self):
        with pytest.raises(ValidationError):
            FrozenAssignment(
                operation_id="OP1",
                work_order_id="WO1",
                machine_id="M1",
                setup_start=MONDAY + timedelta(hours=9),
                start=MONDAY + timedelta(hours=8),
                end=MONDAY + timedelta(hours=10),
            )

    def test_end_before_start_rejected(self):
        with pytest.raises(ValidationError):
            FrozenAssignment(
                operation_id="OP1",
                work_order_id="WO1",
                machine_id="M1",
                setup_start=MONDAY + timedelta(hours=8),
                start=MONDAY + timedelta(hours=9),
                end=MONDAY + timedelta(hours=8, minutes=30),
            )

    def test_to_scheduled_operation_round_trip(self):
        fa = FrozenAssignment(
            operation_id="OP1",
            work_order_id="WO1",
            machine_id="M1",
            setup_start=MONDAY + timedelta(hours=8),
            start=MONDAY + timedelta(hours=8, minutes=15),
            end=MONDAY + timedelta(hours=9),
        )
        so = fa.to_scheduled_operation()
        assert so.operation_id == "OP1"
        assert so.work_order_id == "WO1"
        assert so.machine_id == "M1"
        assert so.setup_start == fa.setup_start
        assert so.start == fa.start
        assert so.end == fa.end


# --------------------------------------------------------------------------
# SchedulingContext validation of frozen assignments
# --------------------------------------------------------------------------


class TestFrozenContextValidation:
    def _build_ctx(self, frozen):
        wo = make_work_order(
            "WO1",
            release=MONDAY,
            due=MONDAY + timedelta(days=2),
            ops=[("OP1", 60, ["M1"], 0), ("OP2", 60, ["M1"], 0)],
        )
        return SchedulingContext(
            horizon_start=MONDAY,
            horizon_end=MONDAY + timedelta(days=2),
            work_orders=[wo],
            machines=[_machine()],
            calendars=[_calendar()],
            frozen_assignments=frozen,
        )

    def test_accepts_valid_frozen(self):
        fa = FrozenAssignment(
            operation_id="OP1",
            work_order_id="WO1",
            machine_id="M1",
            setup_start=MONDAY + timedelta(hours=8),
            start=MONDAY + timedelta(hours=8),
            end=MONDAY + timedelta(hours=9),
        )
        ctx = self._build_ctx([fa])
        assert ctx.frozen_assignments == [fa]

    def test_rejects_unknown_operation(self):
        fa = FrozenAssignment(
            operation_id="OP-GHOST",
            work_order_id="WO1",
            machine_id="M1",
            setup_start=MONDAY + timedelta(hours=8),
            start=MONDAY + timedelta(hours=8),
            end=MONDAY + timedelta(hours=9),
        )
        with pytest.raises(UnknownResourceError):
            self._build_ctx([fa])

    def test_rejects_unknown_machine(self):
        fa = FrozenAssignment(
            operation_id="OP1",
            work_order_id="WO1",
            machine_id="M-GHOST",
            setup_start=MONDAY + timedelta(hours=8),
            start=MONDAY + timedelta(hours=8),
            end=MONDAY + timedelta(hours=9),
        )
        with pytest.raises(UnknownResourceError):
            self._build_ctx([fa])

    def test_rejects_duplicate_frozen(self):
        fa1 = FrozenAssignment(
            operation_id="OP1",
            work_order_id="WO1",
            machine_id="M1",
            setup_start=MONDAY + timedelta(hours=8),
            start=MONDAY + timedelta(hours=8),
            end=MONDAY + timedelta(hours=9),
        )
        fa2 = FrozenAssignment(
            operation_id="OP1",
            work_order_id="WO1",
            machine_id="M1",
            setup_start=MONDAY + timedelta(hours=9),
            start=MONDAY + timedelta(hours=9),
            end=MONDAY + timedelta(hours=10),
        )
        with pytest.raises(ValidationError):
            self._build_ctx([fa1, fa2])


# --------------------------------------------------------------------------
# Forward greedy honours frozen assignments
# --------------------------------------------------------------------------


class TestGreedyStrategyFrozen:
    def _ctx_two_ops(self, frozen):
        wo = make_work_order(
            "WO1",
            release=MONDAY,
            due=MONDAY + timedelta(days=2),
            ops=[("OP1", 60, ["M1"], 0), ("OP2", 60, ["M1"], 0)],
        )
        return SchedulingContext(
            horizon_start=MONDAY,
            horizon_end=MONDAY + timedelta(days=2),
            work_orders=[wo],
            machines=[_machine()],
            calendars=[_calendar()],
            frozen_assignments=frozen,
        )

    def test_frozen_op_kept_verbatim(self):
        fa = FrozenAssignment(
            operation_id="OP1",
            work_order_id="WO1",
            machine_id="M1",
            setup_start=MONDAY + timedelta(hours=10),  # 10:00 Monday
            start=MONDAY + timedelta(hours=10),
            end=MONDAY + timedelta(hours=11),
        )
        ctx = self._ctx_two_ops([fa])
        strategy = resolve_strategy("greedy")
        result = strategy.solve(ctx, Objective.default())

        by_op = {a.operation_id: a for a in result.schedule.assignments}
        assert by_op["OP1"].setup_start == fa.setup_start
        assert by_op["OP1"].start == fa.start
        assert by_op["OP1"].end == fa.end
        assert by_op["OP1"].machine_id == "M1"

    def test_dependent_op_starts_after_frozen_end(self):
        # Freeze OP1 to end at 11:00; OP2 must start no earlier.
        fa = FrozenAssignment(
            operation_id="OP1",
            work_order_id="WO1",
            machine_id="M1",
            setup_start=MONDAY + timedelta(hours=10),
            start=MONDAY + timedelta(hours=10),
            end=MONDAY + timedelta(hours=11),
        )
        ctx = self._ctx_two_ops([fa])
        strategy = resolve_strategy("greedy")
        result = strategy.solve(ctx, Objective.default())

        by_op = {a.operation_id: a for a in result.schedule.assignments}
        # OP2 must not overlap the frozen OP1 and must respect dependency.
        assert by_op["OP2"].start >= fa.end

    def test_frozen_time_respected_even_when_shift_would_allow_earlier(self):
        # Freeze OP1 late in the day (14:00); the greedy strategy must
        # *not* re-place it at 08:00 even though shift would allow it.
        fa = FrozenAssignment(
            operation_id="OP1",
            work_order_id="WO1",
            machine_id="M1",
            setup_start=MONDAY + timedelta(hours=14),
            start=MONDAY + timedelta(hours=14),
            end=MONDAY + timedelta(hours=15),
        )
        ctx = self._ctx_two_ops([fa])
        strategy = resolve_strategy("greedy")
        result = strategy.solve(ctx, Objective.default())

        by_op = {a.operation_id: a for a in result.schedule.assignments}
        assert by_op["OP1"].start == fa.start
        # OP2 follows after OP1's real end.
        assert by_op["OP2"].start >= fa.end


# --------------------------------------------------------------------------
# Backward greedy honours frozen assignments
# --------------------------------------------------------------------------


class TestBackwardStrategyFrozen:
    def _ctx_two_ops(self, frozen, *, due_hour: int = 16):
        wo = make_work_order(
            "WO1",
            release=MONDAY,
            due=MONDAY + timedelta(hours=due_hour),
            ops=[("OP1", 60, ["M1"], 0), ("OP2", 60, ["M1"], 0)],
        )
        return SchedulingContext(
            horizon_start=MONDAY,
            horizon_end=MONDAY + timedelta(days=2),
            work_orders=[wo],
            machines=[_machine()],
            calendars=[_calendar()],
            frozen_assignments=frozen,
        )

    def test_frozen_op_kept_verbatim(self):
        # Freeze OP2 at 14:00 on Monday; backward walks successors first
        # and should respect the pin instead of re-placing.
        fa = FrozenAssignment(
            operation_id="OP2",
            work_order_id="WO1",
            machine_id="M1",
            setup_start=MONDAY + timedelta(hours=14),
            start=MONDAY + timedelta(hours=14),
            end=MONDAY + timedelta(hours=15),
        )
        ctx = self._ctx_two_ops([fa])
        strategy = resolve_strategy("backward")
        result = strategy.solve(ctx, Objective.default())

        by_op = {a.operation_id: a for a in result.schedule.assignments}
        assert by_op["OP2"].setup_start == fa.setup_start
        assert by_op["OP2"].start == fa.start
        assert by_op["OP2"].end == fa.end

    def test_predecessor_pulled_back_to_frozen_setup_start(self):
        # Freeze OP2 at 14:00; OP1 (predecessor) must end no later than 14:00.
        fa = FrozenAssignment(
            operation_id="OP2",
            work_order_id="WO1",
            machine_id="M1",
            setup_start=MONDAY + timedelta(hours=14),
            start=MONDAY + timedelta(hours=14),
            end=MONDAY + timedelta(hours=15),
        )
        ctx = self._ctx_two_ops([fa])
        strategy = resolve_strategy("backward")
        result = strategy.solve(ctx, Objective.default())

        by_op = {a.operation_id: a for a in result.schedule.assignments}
        # OP1 must finish on or before OP2's setup start.
        assert by_op["OP1"].end <= fa.setup_start
        # Backward "latest possible" means OP1 ends at exactly 14:00.
        assert by_op["OP1"].end == fa.setup_start
