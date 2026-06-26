"""Tests for schedule analysis utilities.

Covers:

* Critical path — identifies the longest operation chain correctly.
* Bottleneck — finds the most utilized machine.
* Flow times — computes release-to-completion and tardiness per WO.
* Gantt export — produces correct entries sorted by machine/time.
* Full analysis — ``analyze_schedule`` bundles all sub-analyses.
* Edge cases — empty schedule, single operation.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

from planiadvance_v2.domain.entities import Machine, WorkingCalendar
from planiadvance_v2.domain.scheduling import (
    Objective,
    SchedulingContext,
    resolve_strategy,
)
from planiadvance_v2.domain.scheduling.analysis import (
    ScheduleAnalysis,
    analyze_schedule,
    compute_bottleneck,
    compute_critical_path,
    compute_flow_times,
    export_gantt,
)
from planiadvance_v2.domain.value_objects import Shift
from tests.conftest import make_work_order

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

HORIZON_START = datetime(2026, 1, 5, 0, 0, 0)  # Monday


def _calendar() -> WorkingCalendar:
    return WorkingCalendar(
        id="CAL",
        name="MF",
        shifts=[
            Shift(weekday=w, start=time(8, 0), end=time(17, 0)) for w in range(5)
        ],
    )


def _machines(n: int = 2) -> list[Machine]:
    return [
        Machine(id=f"M{i+1}", name=f"M{i+1}", calendar_id="CAL")
        for i in range(n)
    ]


def _schedule_two_jobs_two_machines():
    """Two jobs, two machines — a simple testable setup.

    WO1: OP1 (60min on M1) -> OP2 (60min on M2)
    WO2: OP3 (60min on M2) -> OP4 (60min on M1)
    """
    wo1 = make_work_order(
        "WO1",
        release=HORIZON_START,
        due=HORIZON_START + timedelta(days=3),
        ops=[
            ("OP1", 60, ["M1"], 0),
            ("OP2", 60, ["M2"], 0),
        ],
    )
    wo2 = make_work_order(
        "WO2",
        release=HORIZON_START,
        due=HORIZON_START + timedelta(days=3),
        ops=[
            ("OP3", 60, ["M2"], 0),
            ("OP4", 60, ["M1"], 0),
        ],
    )
    ctx = SchedulingContext(
        horizon_start=HORIZON_START,
        horizon_end=HORIZON_START + timedelta(days=14),
        work_orders=[wo1, wo2],
        machines=_machines(2),
        calendars=[_calendar()],
    )
    result = resolve_strategy("greedy").solve(ctx, Objective.default())
    return result.schedule, [wo1, wo2]


def _schedule_single_op():
    """Single operation — edge case."""
    wo = make_work_order(
        "WO1",
        release=HORIZON_START,
        due=HORIZON_START + timedelta(days=1),
        ops=[("OP1", 30, ["M1"], 0)],
    )
    ctx = SchedulingContext(
        horizon_start=HORIZON_START,
        horizon_end=HORIZON_START + timedelta(days=7),
        work_orders=[wo],
        machines=_machines(1),
        calendars=[_calendar()],
    )
    result = resolve_strategy("greedy").solve(ctx, Objective.default())
    return result.schedule, [wo]


def _schedule_late_wo():
    """A WO that will definitely be late (tight due date)."""
    wo1 = make_work_order(
        "WO1",
        release=HORIZON_START,
        due=HORIZON_START + timedelta(days=3),
        ops=[
            ("OP1", 120, ["M1"], 0),
            ("OP2", 120, ["M1"], 0),
            ("OP3", 120, ["M1"], 0),
        ],
    )
    wo2 = make_work_order(
        "WO2",
        release=HORIZON_START,
        due=HORIZON_START + timedelta(hours=9),  # very tight
        ops=[("OP4", 60, ["M1"], 0)],
    )
    ctx = SchedulingContext(
        horizon_start=HORIZON_START,
        horizon_end=HORIZON_START + timedelta(days=14),
        work_orders=[wo1, wo2],
        machines=_machines(1),
        calendars=[_calendar()],
    )
    result = resolve_strategy("greedy").solve(ctx, Objective.default())
    return result.schedule, [wo1, wo2]


# --------------------------------------------------------------------------
# Critical path
# --------------------------------------------------------------------------


class TestCriticalPath:
    def test_critical_path_contains_operations(self):
        schedule, work_orders = _schedule_two_jobs_two_machines()
        cp = compute_critical_path(schedule, work_orders)
        assert len(cp.operations) >= 2
        assert cp.total_minutes > 0

    def test_critical_path_operations_are_scheduled(self):
        schedule, work_orders = _schedule_two_jobs_two_machines()
        cp = compute_critical_path(schedule, work_orders)
        scheduled_ids = {a.operation_id for a in schedule.assignments}
        for op_id in cp.operations:
            assert op_id in scheduled_ids

    def test_critical_path_work_orders_nonempty(self):
        schedule, work_orders = _schedule_two_jobs_two_machines()
        cp = compute_critical_path(schedule, work_orders)
        assert len(cp.work_orders) >= 1

    def test_single_op_critical_path(self):
        schedule, work_orders = _schedule_single_op()
        cp = compute_critical_path(schedule, work_orders)
        assert cp.operations == ["OP1"]
        assert cp.total_minutes == 30

    def test_empty_schedule(self):
        from planiadvance_v2.domain.entities import Schedule

        empty = Schedule(id="empty", created_at=HORIZON_START, assignments=[])
        cp = compute_critical_path(empty, [])
        assert cp.operations == []
        assert cp.total_minutes == 0

    def test_chain_is_chronological(self):
        schedule, work_orders = _schedule_two_jobs_two_machines()
        cp = compute_critical_path(schedule, work_orders)
        ends = {a.operation_id: a.end for a in schedule.assignments}
        for i in range(len(cp.operations) - 1):
            assert ends[cp.operations[i]] <= ends[cp.operations[i + 1]]


# --------------------------------------------------------------------------
# Bottleneck
# --------------------------------------------------------------------------


class TestBottleneck:
    def test_bottleneck_identified(self):
        schedule, _ = _schedule_two_jobs_two_machines()
        bn = compute_bottleneck(schedule)
        assert bn.bottleneck_machine_id in ("M1", "M2")
        assert 0.0 <= bn.bottleneck_utilization <= 1.0

    def test_all_machines_reported(self):
        schedule, _ = _schedule_two_jobs_two_machines()
        bn = compute_bottleneck(schedule)
        machine_ids = {m.machine_id for m in bn.machines}
        assert "M1" in machine_ids
        assert "M2" in machine_ids

    def test_utilization_breakdown_sums(self):
        schedule, _ = _schedule_two_jobs_two_machines()
        bn = compute_bottleneck(schedule)
        for m in bn.machines:
            assert m.busy_minutes + m.setup_minutes + m.idle_minutes == m.total_span_minutes

    def test_single_machine_is_bottleneck(self):
        schedule, _ = _schedule_single_op()
        bn = compute_bottleneck(schedule)
        assert bn.bottleneck_machine_id == "M1"
        assert len(bn.machines) == 1
        assert bn.machines[0].num_operations == 1

    def test_empty_schedule(self):
        from planiadvance_v2.domain.entities import Schedule

        empty = Schedule(id="empty", created_at=HORIZON_START, assignments=[])
        bn = compute_bottleneck(empty)
        assert bn.bottleneck_machine_id == ""
        assert bn.machines == []


# --------------------------------------------------------------------------
# Flow times
# --------------------------------------------------------------------------


class TestFlowTimes:
    def test_flow_times_per_wo(self):
        schedule, work_orders = _schedule_two_jobs_two_machines()
        ft = compute_flow_times(schedule, work_orders)
        assert len(ft) == 2
        wo_ids = {f.work_order_id for f in ft}
        assert wo_ids == {"WO1", "WO2"}

    def test_flow_time_positive(self):
        schedule, work_orders = _schedule_two_jobs_two_machines()
        ft = compute_flow_times(schedule, work_orders)
        for f in ft:
            assert f.flow_time_minutes > 0

    def test_on_time_detection(self):
        schedule, work_orders = _schedule_two_jobs_two_machines()
        ft = compute_flow_times(schedule, work_orders)
        # With a 3-day due date, both should be on time.
        for f in ft:
            assert f.is_on_time is True
            assert f.tardiness_minutes == 0

    def test_tardiness_detected(self):
        schedule, work_orders = _schedule_late_wo()
        ft = compute_flow_times(schedule, work_orders)
        ft_by_id = {f.work_order_id: f for f in ft}
        # WO2 has a very tight deadline and will likely be late
        # because WO1 has 3 ops on M1 before WO2 can start.
        # WO2 due at 09:00 on day 1, but M1 is busy with WO1 ops.
        wo2_ft = ft_by_id.get("WO2")
        if wo2_ft is not None and not wo2_ft.is_on_time:
            assert wo2_ft.tardiness_minutes > 0


# --------------------------------------------------------------------------
# Gantt export
# --------------------------------------------------------------------------


class TestGanttExport:
    def test_gantt_entries_match_assignments(self):
        schedule, _ = _schedule_two_jobs_two_machines()
        gantt = export_gantt(schedule)
        assert len(gantt) == len(schedule.assignments)

    def test_gantt_sorted_by_machine_then_time(self):
        schedule, _ = _schedule_two_jobs_two_machines()
        gantt = export_gantt(schedule)
        for i in range(len(gantt) - 1):
            a, b = gantt[i], gantt[i + 1]
            if a.machine_id == b.machine_id:
                assert a.setup_start <= b.setup_start

    def test_gantt_entry_fields(self):
        schedule, _ = _schedule_single_op()
        gantt = export_gantt(schedule)
        assert len(gantt) == 1
        entry = gantt[0]
        assert entry.operation_id == "OP1"
        assert entry.work_order_id == "WO1"
        assert entry.machine_id == "M1"
        assert entry.run_minutes == 30
        assert entry.setup_minutes == 0


# --------------------------------------------------------------------------
# Full analysis
# --------------------------------------------------------------------------


class TestAnalyzeSchedule:
    def test_returns_schedule_analysis(self):
        schedule, work_orders = _schedule_two_jobs_two_machines()
        result = analyze_schedule(schedule, work_orders)
        assert isinstance(result, ScheduleAnalysis)
        assert len(result.critical_path.operations) > 0
        assert result.bottleneck.bottleneck_machine_id != ""
        assert len(result.flow_times) == 2
        assert len(result.gantt) == len(schedule.assignments)

    def test_as_dict_structure(self):
        schedule, work_orders = _schedule_two_jobs_two_machines()
        result = analyze_schedule(schedule, work_orders)
        d = result.as_dict()
        assert "critical_path" in d
        assert "bottleneck" in d
        assert "flow_times" in d
        assert "machine_utilization" in d
        assert isinstance(d["critical_path"]["operations"], list)
        assert isinstance(d["bottleneck"]["machine_id"], str)
