"""End-to-end unit tests for the Scheduler.

These exercise the full engine with in-memory inputs — no DB, no API.
They cover the behaviours that matter most for an APS system:

1. Sequential dependencies are respected.
2. Multiple machines are used in parallel.
3. No two operations overlap on the same machine.
4. The heuristic changes the placement order.
5. Infeasible inputs raise a clear error.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from planiadvance_v2.domain.errors import InfeasibleScheduleError
from planiadvance_v2.domain.scheduling import (
    Scheduler,
    SchedulingContext,
    resolve_heuristic,
)
from planiadvance_v2.domain.value_objects import Priority
from tests.conftest import make_work_order


def _context(work_orders, machines, calendar, start, end) -> SchedulingContext:
    return SchedulingContext(
        horizon_start=start,
        horizon_end=end,
        work_orders=work_orders,
        machines=machines,
        calendars=[calendar],
    )


class TestSequentialDependencies:
    def test_operations_run_in_sequence(
        self, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        wo = make_work_order(
            "WO1",
            release=horizon_start,
            due=horizon_start + timedelta(days=3),
            ops=[
                ("OP1", 60, ["M1"], 0),
                ("OP2", 60, ["M1"], 0),
            ],
        )
        ctx = _context([wo], two_machines, standard_calendar, horizon_start, horizon_end)
        schedule = Scheduler().schedule(ctx)

        by_wo = schedule.by_work_order("WO1")
        assert [a.operation_id for a in by_wo] == ["OP1", "OP2"]
        assert by_wo[1].start >= by_wo[0].end

    def test_cross_machine_chain(
        self, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        wo = make_work_order(
            "WO1",
            release=horizon_start,
            due=horizon_start + timedelta(days=3),
            ops=[
                ("OP1", 60, ["M1"], 0),
                ("OP2", 60, ["M2"], 0),
            ],
        )
        ctx = _context([wo], two_machines, standard_calendar, horizon_start, horizon_end)
        schedule = Scheduler().schedule(ctx)
        ops = schedule.by_work_order("WO1")
        assert ops[0].machine_id == "M1"
        assert ops[1].machine_id == "M2"
        assert ops[1].start >= ops[0].end


class TestParallelism:
    def test_two_work_orders_use_both_machines(
        self, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        wo1 = make_work_order(
            "WO1", release=horizon_start, due=horizon_start + timedelta(days=3),
            ops=[("A1", 120, ["M1", "M2"], 0)],
        )
        wo2 = make_work_order(
            "WO2", release=horizon_start, due=horizon_start + timedelta(days=3),
            ops=[("B1", 120, ["M1", "M2"], 0)],
        )
        ctx = _context([wo1, wo2], two_machines, standard_calendar, horizon_start, horizon_end)
        schedule = Scheduler().schedule(ctx)

        machine_ids = {a.machine_id for a in schedule.assignments}
        assert machine_ids == {"M1", "M2"}

    def test_no_machine_conflicts(
        self, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        work_orders = [
            make_work_order(
                f"WO{i}",
                release=horizon_start,
                due=horizon_start + timedelta(days=5),
                ops=[(f"OP{i}", 90, ["M1", "M2"], 10)],
            )
            for i in range(6)
        ]
        ctx = _context(work_orders, two_machines, standard_calendar, horizon_start, horizon_end)
        schedule = Scheduler().schedule(ctx)

        for machine_id in ("M1", "M2"):
            windows = [a.full_window for a in schedule.by_machine(machine_id)]
            for i in range(len(windows) - 1):
                assert not windows[i].overlaps(windows[i + 1])


class TestHeuristics:
    def test_edd_orders_by_due_date(
        self, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        late = make_work_order(
            "LATE", release=horizon_start, due=horizon_start + timedelta(days=8),
            ops=[("L", 60, ["M1"], 0)],
        )
        early = make_work_order(
            "EARLY", release=horizon_start, due=horizon_start + timedelta(days=2),
            ops=[("E", 60, ["M1"], 0)],
        )
        ctx = _context([late, early], two_machines, standard_calendar, horizon_start, horizon_end)
        schedule = Scheduler(heuristic=resolve_heuristic("edd")).schedule(ctx)
        first = min(schedule.assignments, key=lambda a: a.start)
        assert first.work_order_id == "EARLY"

    def test_priority_beats_due_date(
        self, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        early_low = make_work_order(
            "EARLY", release=horizon_start, due=horizon_start + timedelta(days=2),
            ops=[("E", 60, ["M1"], 0)], priority=Priority.LOW,
        )
        late_urgent = make_work_order(
            "URGENT", release=horizon_start, due=horizon_start + timedelta(days=8),
            ops=[("U", 60, ["M1"], 0)], priority=Priority.URGENT,
        )
        ctx = _context(
            [early_low, late_urgent], two_machines, standard_calendar,
            horizon_start, horizon_end,
        )
        schedule = Scheduler(heuristic=resolve_heuristic("priority_edd")).schedule(ctx)
        first = min(schedule.assignments, key=lambda a: a.start)
        assert first.work_order_id == "URGENT"


class TestInfeasible:
    def test_insufficient_horizon_raises(
        self, horizon_start, standard_calendar, two_machines
    ):
        wo = make_work_order(
            "WO1", release=horizon_start, due=horizon_start + timedelta(days=1),
            ops=[("OP1", 60, ["M1"], 0)],
        )
        ctx = _context(
            [wo], two_machines, standard_calendar,
            horizon_start, horizon_start + timedelta(hours=1),  # too short
        )
        with pytest.raises(InfeasibleScheduleError):
            Scheduler().schedule(ctx)


class TestDeterminism:
    def test_same_inputs_same_output(
        self, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        wo = make_work_order(
            "WO1", release=horizon_start, due=horizon_start + timedelta(days=5),
            ops=[
                ("OP1", 60, ["M1", "M2"], 10),
                ("OP2", 90, ["M1", "M2"], 5),
            ],
        )
        ctx = _context([wo], two_machines, standard_calendar, horizon_start, horizon_end)
        first = Scheduler().schedule(ctx)
        second = Scheduler().schedule(ctx)
        assert [
            (a.operation_id, a.machine_id, a.start) for a in first.assignments
        ] == [
            (a.operation_id, a.machine_id, a.start) for a in second.assignments
        ]
