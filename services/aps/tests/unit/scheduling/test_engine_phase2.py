"""Phase-2 engine tests: preemption, maintenance, backward, compare.

These tests cover the four industrial-grade axes added on top of the
pluggable-strategy foundation:

* preemption — long operations split across working windows;
* maintenance — planned downtime carved out of a machine's calendar;
* backward scheduling — just-in-time placement from the due date;
* strategy comparison — the what-if runner for side-by-side analysis.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

import pytest

from planiadvance_v2.application.use_cases import (
    CompareStrategies,
    CompareStrategiesInput,
)
from planiadvance_v2.domain.entities import (
    Machine,
    Operation,
    WorkingCalendar,
    WorkOrder,
)
from planiadvance_v2.domain.errors import InfeasibleScheduleError, ValidationError
from planiadvance_v2.domain.scheduling import (
    CalendarResolver,
    Objective,
    ResourceTimeline,
    SchedulingContext,
    SlotFinder,
    available_strategies,
    resolve_strategy,
)
from planiadvance_v2.domain.value_objects import Duration, Priority, Shift, TimeWindow
from tests.conftest import make_work_order

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _ctx(work_orders, machines, calendars, start, end):
    return SchedulingContext(
        horizon_start=start,
        horizon_end=end,
        work_orders=work_orders,
        machines=machines,
        calendars=calendars,
    )


def _daily_calendar() -> WorkingCalendar:
    """8h–17h Mon–Fri — same as the shared fixture but kept local for
    readability of the tests that rely on exact shift boundaries."""
    return WorkingCalendar(
        id="CAL",
        name="Mon-Fri 08-17",
        shifts=[Shift(weekday=w, start=time(8, 0), end=time(17, 0)) for w in range(5)],
    )


def _stub_repo(items):
    class _Repo:
        def list_all(self):
            return list(items)

    return _Repo()


# --------------------------------------------------------------------------
# Preemption
# --------------------------------------------------------------------------


class TestPreemptionSlotFinder:
    def test_single_free_chunk_returns_one_segment(self):
        finder = SlotFinder()
        windows = [TimeWindow(datetime(2026, 1, 5, 8, 0), datetime(2026, 1, 5, 17, 0))]
        segments = finder.find_preemptive(
            earliest_start=datetime(2026, 1, 5, 8, 0),
            required=Duration(minutes=120),
            working_windows=windows,
            timeline=ResourceTimeline(machine_id="M1"),
            min_chunk=Duration(minutes=30),
        )
        assert segments is not None
        assert len(segments) == 1
        assert segments[0].start == datetime(2026, 1, 5, 8, 0)
        assert segments[0].end == datetime(2026, 1, 5, 10, 0)

    def test_spans_two_working_windows(self):
        finder = SlotFinder()
        # Two disjoint 4h windows — request 6h total => must split 4h + 2h.
        windows = [
            TimeWindow(datetime(2026, 1, 5, 8, 0), datetime(2026, 1, 5, 12, 0)),
            TimeWindow(datetime(2026, 1, 5, 13, 0), datetime(2026, 1, 5, 17, 0)),
        ]
        segments = finder.find_preemptive(
            earliest_start=datetime(2026, 1, 5, 8, 0),
            required=Duration(minutes=360),
            working_windows=windows,
            timeline=ResourceTimeline(machine_id="M1"),
            min_chunk=Duration(minutes=60),
        )
        assert segments is not None
        assert len(segments) == 2
        total = sum(
            (s.end - s.start).total_seconds() // 60 for s in segments
        )
        assert total == 360

    def test_returns_none_when_insufficient_capacity(self):
        finder = SlotFinder()
        windows = [TimeWindow(datetime(2026, 1, 5, 8, 0), datetime(2026, 1, 5, 10, 0))]
        assert (
            finder.find_preemptive(
                earliest_start=datetime(2026, 1, 5, 8, 0),
                required=Duration(minutes=300),
                working_windows=windows,
                timeline=ResourceTimeline(machine_id="M1"),
                min_chunk=Duration(minutes=30),
            )
            is None
        )


class TestPreemptionGreedy:
    def test_long_preemptible_op_splits_across_two_days(self, horizon_start, horizon_end):
        calendar = _daily_calendar()
        machine = Machine(id="M1", name="M1", calendar_id="CAL")
        # 12h run on a machine that only works 9h/day — must split across
        # at least two calendar days.
        op = Operation(
            id="LONG",
            work_order_id="WO1",
            sequence=1,
            name="long",
            duration=Duration(minutes=720),
            eligible_machine_ids=["M1"],
            preemptible=True,
            min_chunk=Duration(minutes=60),
        )
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="P",
            quantity=1,
            release_date=horizon_start,
            due_date=horizon_start + timedelta(days=5),
            operations=[op],
            priority=Priority.NORMAL,
        )
        ctx = _ctx([wo], [machine], [calendar], horizon_start, horizon_end)

        result = resolve_strategy("greedy").solve(ctx, Objective.default())
        assert len(result.schedule.assignments) == 1
        assignment = result.schedule.assignments[0]
        assert assignment.is_preempted, "expected preempted schedule"
        assert assignment.productive_minutes == 720
        # At least two segments — 12h cannot fit in one 9h window.
        assert len(assignment.segments) >= 2

    def test_non_preemptible_op_rejects_long_placement(self, horizon_start, horizon_end):
        calendar = _daily_calendar()
        machine = Machine(id="M1", name="M1", calendar_id="CAL")
        op = Operation(
            id="LONG",
            work_order_id="WO1",
            sequence=1,
            name="long",
            duration=Duration(minutes=720),
            eligible_machine_ids=["M1"],
        )
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="P",
            quantity=1,
            release_date=horizon_start,
            due_date=horizon_start + timedelta(days=5),
            operations=[op],
            priority=Priority.NORMAL,
        )
        ctx = _ctx([wo], [machine], [calendar], horizon_start, horizon_end)
        with pytest.raises(InfeasibleScheduleError):
            resolve_strategy("greedy").solve(ctx, Objective.default())


# --------------------------------------------------------------------------
# Maintenance windows
# --------------------------------------------------------------------------


class TestMaintenanceWindows:
    def test_calendar_resolver_subtracts_maintenance(self, horizon_start, horizon_end):
        cal = _daily_calendar()
        resolver = CalendarResolver(horizon_start, horizon_end)
        maintenance = [
            TimeWindow(
                start=datetime(2026, 1, 5, 10, 0),
                end=datetime(2026, 1, 5, 13, 0),
            )
        ]
        effective = resolver.effective_windows(cal, maintenance=maintenance)
        # Monday should now be split 08–10 + 13–17.
        monday = [w for w in effective if w.start.date() == datetime(2026, 1, 5).date()]
        assert len(monday) == 2
        assert monday[0] == TimeWindow(
            start=datetime(2026, 1, 5, 8, 0), end=datetime(2026, 1, 5, 10, 0)
        )
        assert monday[1] == TimeWindow(
            start=datetime(2026, 1, 5, 13, 0), end=datetime(2026, 1, 5, 17, 0)
        )

    @pytest.mark.parametrize("strategy", ["greedy"])
    def test_strategy_never_places_over_maintenance(
        self, strategy, horizon_start, horizon_end
    ):
        calendar = _daily_calendar()
        maintenance = TimeWindow(
            start=datetime(2026, 1, 5, 10, 0),
            end=datetime(2026, 1, 5, 14, 0),
        )
        machine = Machine(
            id="M1",
            name="M1",
            calendar_id="CAL",
            maintenance_windows=[maintenance],
        )
        work_orders = [
            make_work_order(
                f"WO{i}",
                release=horizon_start,
                due=horizon_start + timedelta(days=5),
                ops=[(f"OP{i}", 60, ["M1"], 0)],
            )
            for i in range(5)
        ]
        ctx = _ctx(work_orders, [machine], [calendar], horizon_start, horizon_end)
        result = resolve_strategy(strategy).solve(ctx, Objective.default())

        for a in result.schedule.assignments:
            placed = TimeWindow(start=a.setup_start, end=a.end)
            assert not placed.overlaps(maintenance), (
                f"{a.operation_id} overlaps maintenance"
            )

    def test_maintenance_validation_rejects_empty_window(self):
        instant = datetime(2026, 1, 5, 10, 0)
        with pytest.raises(ValidationError):
            Machine(
                id="M1",
                name="M1",
                calendar_id="CAL",
                maintenance_windows=[TimeWindow(start=instant, end=instant)],
            )


# --------------------------------------------------------------------------
# Backward scheduling
# --------------------------------------------------------------------------


class TestBackwardStrategy:
    def test_registered_in_registry(self):
        assert "backward" in available_strategies()

    def test_last_operation_finishes_on_due_date(self, horizon_start, horizon_end):
        calendar = _daily_calendar()
        machine = Machine(id="M1", name="M1", calendar_id="CAL")
        due = datetime(2026, 1, 6, 16, 0)  # Tuesday 16:00 — within work shift
        wo = make_work_order(
            "WO1",
            release=horizon_start,
            due=due,
            ops=[("A", 60, ["M1"], 0), ("B", 60, ["M1"], 0)],
        )
        ctx = _ctx([wo], [machine], [calendar], horizon_start, horizon_end)
        result = resolve_strategy("backward").solve(ctx, Objective.default())

        by_op = {a.operation_id: a for a in result.schedule.assignments}
        assert by_op["B"].end == due, (
            f"backward should place the last op at the due date, got {by_op['B'].end}"
        )
        # Predecessor must finish no later than successor's setup_start.
        assert by_op["A"].end <= by_op["B"].setup_start

    def test_pulls_back_to_release_date_limit(self, horizon_start, horizon_end):
        calendar = _daily_calendar()
        machine = Machine(id="M1", name="M1", calendar_id="CAL")
        # Very tight release/due: a single 60min op with due exactly at 9:00
        # on a release day — the backward strategy should still place it
        # between 8:00 and 9:00, not refuse the placement.
        release = datetime(2026, 1, 5, 8, 0)
        due = datetime(2026, 1, 5, 9, 0)
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="P",
            quantity=1,
            release_date=release,
            due_date=due,
            operations=[
                Operation(
                    id="OP",
                    work_order_id="WO1",
                    sequence=1,
                    name="op",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                )
            ],
        )
        ctx = _ctx([wo], [machine], [calendar], horizon_start, horizon_end)
        result = resolve_strategy("backward").solve(ctx, Objective.default())
        a = result.schedule.assignments[0]
        assert a.start == release
        assert a.end == due

    def test_infeasible_backward_raises_report(self, horizon_start, horizon_end):
        calendar = _daily_calendar()
        machine = Machine(id="M1", name="M1", calendar_id="CAL")
        # Due date BEFORE the duration fits between release and due.
        release = datetime(2026, 1, 5, 8, 0)
        due = datetime(2026, 1, 5, 8, 30)  # 30min window for 60min op
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="P",
            quantity=1,
            release_date=release,
            due_date=due,
            operations=[
                Operation(
                    id="OP",
                    work_order_id="WO1",
                    sequence=1,
                    name="op",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                )
            ],
        )
        ctx = _ctx([wo], [machine], [calendar], horizon_start, horizon_end)
        with pytest.raises(InfeasibleScheduleError) as exc_info:
            resolve_strategy("backward").solve(ctx, Objective.default())
        assert exc_info.value.report is not None
        assert exc_info.value.report.strategy == "backward"


# --------------------------------------------------------------------------
# CompareStrategies use case
# --------------------------------------------------------------------------


class TestCompareStrategies:
    def _run(self, strategies, horizon_start, horizon_end, calendar, machines, work_orders):
        use_case = CompareStrategies(
            work_orders=_stub_repo(work_orders),
            machines=_stub_repo(machines),
            calendars=_stub_repo([calendar]),
        )
        return use_case.execute(
            CompareStrategiesInput(
                strategies=strategies,
                horizon_start=horizon_start,
                horizon_days=(horizon_end - horizon_start).days,
                objective=Objective.default(),
            )
        )

    def test_compares_multiple_strategies(
        self, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        work_orders = [
            make_work_order(
                f"WO{i}",
                release=horizon_start,
                due=horizon_start + timedelta(days=5),
                ops=[(f"A{i}", 60, ["M1", "M2"], 0), (f"B{i}", 60, ["M1", "M2"], 0)],
            )
            for i in range(3)
        ]
        output = self._run(
            ["greedy", "backward"],
            horizon_start,
            horizon_end,
            standard_calendar,
            two_machines,
            work_orders,
        )
        assert len(output.runs) == 2
        assert {r.strategy for r in output.runs} == {"greedy", "backward"}
        assert all(r.succeeded for r in output.runs)
        assert output.best is not None

    def test_deduplicates_strategies(
        self, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        work_orders = [
            make_work_order(
                "WO1",
                release=horizon_start,
                due=horizon_start + timedelta(days=5),
                ops=[("A", 60, ["M1"], 0)],
            )
        ]
        output = self._run(
            ["greedy", "GREEDY", "greedy"],
            horizon_start,
            horizon_end,
            standard_calendar,
            two_machines,
            work_orders,
        )
        assert len(output.runs) == 1

    def test_unknown_strategy_captured_as_error_not_raised(
        self, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        work_orders = [
            make_work_order(
                "WO1",
                release=horizon_start,
                due=horizon_start + timedelta(days=5),
                ops=[("A", 60, ["M1"], 0)],
            )
        ]
        output = self._run(
            ["greedy", "nonexistent"],
            horizon_start,
            horizon_end,
            standard_calendar,
            two_machines,
            work_orders,
        )
        statuses = {r.strategy: r.solver_status for r in output.runs}
        assert statuses["greedy"] == "feasible"
        assert statuses["nonexistent"] == "error"
        # Best is the single successful one.
        assert output.best is not None
        assert output.best.strategy == "greedy"

    def test_infeasible_strategy_captured_in_results(
        self, horizon_start, standard_calendar, two_machines
    ):
        # Weekend-only calendar so nothing fits in a Monday horizon.
        weekend_only = WorkingCalendar(
            id="WKN",
            name="Sat-Sun",
            shifts=[
                Shift(weekday=5, start=time(8, 0), end=time(17, 0)),
                Shift(weekday=6, start=time(8, 0), end=time(17, 0)),
            ],
        )
        machine = Machine(id="M1", name="M1", calendar_id="WKN")
        release = horizon_start
        due = horizon_start + timedelta(hours=2)  # Monday 02:00 — no shift
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="P",
            quantity=1,
            release_date=release,
            due_date=due,
            operations=[
                Operation(
                    id="OP",
                    work_order_id="WO1",
                    sequence=1,
                    name="op",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                )
            ],
        )
        use_case = CompareStrategies(
            work_orders=_stub_repo([wo]),
            machines=_stub_repo([machine]),
            calendars=_stub_repo([weekend_only]),
        )
        out = use_case.execute(
            CompareStrategiesInput(
                strategies=["greedy"],
                horizon_start=horizon_start,
                # Horizon ends on the same Monday — no Sat/Sun, no shift.
                horizon_days=1,
                objective=Objective.default(),
            )
        )
        run = out.runs[0]
        assert run.solver_status == "infeasible"
        assert run.infeasibility is not None
        assert run.diagnostics["planner_exceptions"]["status"] == "blocked"
        assert run.diagnostics["planner_exceptions"]["error_count"] >= 1
        assert (
            run.diagnostics["planner_diagnostics"]["exceptions"]
            == run.diagnostics["planner_exceptions"]
        )
        assert out.best is None

    def test_parallel_and_sequential_agree(
        self, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        """Parallel execution must be observationally identical to the
        sequential path — same strategies, same order, same objective
        values — otherwise downstream ranking logic would be flaky."""
        work_orders = [
            make_work_order(
                f"WO{i}",
                release=horizon_start,
                due=horizon_start + timedelta(days=5),
                ops=[(f"A{i}", 60, ["M1", "M2"], 0), (f"B{i}", 60, ["M1", "M2"], 0)],
            )
            for i in range(4)
        ]
        use_case = CompareStrategies(
            work_orders=_stub_repo(work_orders),
            machines=_stub_repo(two_machines),
            calendars=_stub_repo([standard_calendar]),
        )
        sequential = use_case.execute(
            CompareStrategiesInput(
                strategies=["greedy", "backward"],
                horizon_start=horizon_start,
                horizon_days=(horizon_end - horizon_start).days,
                objective=Objective.default(),
                parallel=False,
            )
        )
        parallel = use_case.execute(
            CompareStrategiesInput(
                strategies=["greedy", "backward"],
                horizon_start=horizon_start,
                horizon_days=(horizon_end - horizon_start).days,
                objective=Objective.default(),
                parallel=True,
                max_workers=2,
            )
        )
        # Preserve input order in both modes.
        assert [r.strategy for r in sequential.runs] == ["greedy", "backward"]
        assert [r.strategy for r in parallel.runs] == ["greedy", "backward"]
        # Same objective values (wall time is allowed to differ).
        assert [r.objective_value for r in sequential.runs] == [
            r.objective_value for r in parallel.runs
        ]

    def test_parallel_single_strategy_skips_thread_pool(
        self, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        """A single strategy should not pay the thread-pool overhead:
        the dispatcher must fall back to the sequential path when only
        one name is submitted, even with ``parallel=True``."""
        work_orders = [
            make_work_order(
                "WO",
                release=horizon_start,
                due=horizon_start + timedelta(days=5),
                ops=[("A", 60, ["M1"], 0)],
            )
        ]
        output = CompareStrategies(
            work_orders=_stub_repo(work_orders),
            machines=_stub_repo(two_machines),
            calendars=_stub_repo([standard_calendar]),
        ).execute(
            CompareStrategiesInput(
                strategies=["greedy"],
                horizon_start=horizon_start,
                horizon_days=(horizon_end - horizon_start).days,
                parallel=True,
            )
        )
        assert len(output.runs) == 1
        assert output.runs[0].solver_status == "feasible"
