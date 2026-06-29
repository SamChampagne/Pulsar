from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from planiadvance_v2.application.use_cases.compare_strategies import (
    CompareStrategies,
    CompareStrategiesInput,
)
from planiadvance_v2.application.use_cases.planner_diagnostics import enrich_planner_diagnostics
from planiadvance_v2.application.use_cases.result_summary import build_schedule_summary
from planiadvance_v2.domain.entities import Machine, Operation, WorkOrder
from planiadvance_v2.domain.entities.operation import DependencyLink, DependencyType
from planiadvance_v2.domain.errors import InfeasibleScheduleError
from planiadvance_v2.domain.scheduling import (
    Objective,
    SchedulingContext,
    compute_metrics,
    resolve_strategy,
)
from planiadvance_v2.domain.value_objects import (
    Duration,
    SetupMatrix,
    TimeWindow,
    TransferTimes,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryCalendarRepository,
    InMemoryMachineRepository,
    InMemoryWorkOrderRepository,
)

STRATEGIES = ["greedy", "backward", "cpsat"]


def _ctx(work_orders, machines, calendar, start, end, *, transfer_times=None):
    return SchedulingContext(
        horizon_start=start,
        horizon_end=end,
        work_orders=work_orders,
        machines=machines,
        calendars=[calendar],
        transfer_times=transfer_times or TransferTimes(),
    )


def _op(
    wo_id: str,
    op_id: str,
    sequence: int,
    duration_minutes: int,
    machines: list[str],
    *,
    preemptible: bool = False,
    min_chunk_minutes: int | None = None,
):
    operation = Operation(
        id=op_id,
        work_order_id=wo_id,
        sequence=sequence,
        name=op_id,
        duration=Duration(minutes=duration_minutes),
        eligible_machine_ids=machines,
        preemptible=preemptible,
        min_chunk=Duration(minutes=min_chunk_minutes)
        if min_chunk_minutes is not None
        else None,
    )
    return operation


@pytest.mark.parametrize("strategy_name", STRATEGIES)
def test_start_to_start_dependency_is_honored(
    strategy_name, horizon_start, horizon_end, standard_calendar
):
    machines = [
        Machine(id="M1", name="Machine 1", calendar_id=standard_calendar.id),
        Machine(id="M2", name="Machine 2", calendar_id=standard_calendar.id),
    ]
    wo_a = WorkOrder(
        id="WO-A",
        name="WO-A",
        product_id="P-A",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=2),
        operations=[_op("WO-A", "A1", 1, 180, ["M1"])],
    )
    op_b = _op("WO-B", "B1", 1, 60, ["M2"])
    op_b.dependency_links = [
        DependencyLink(
            depends_on_id="A1",
            dependency_type=DependencyType.START_TO_START,
            lag_minutes=30,
        )
    ]
    wo_b = WorkOrder(
        id="WO-B",
        name="WO-B",
        product_id="P-B",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=2),
        operations=[op_b],
    )

    result = resolve_strategy(strategy_name).solve(
        _ctx([wo_a, wo_b], machines, standard_calendar, horizon_start, horizon_end),
        Objective.default(),
    )
    assignments = {a.operation_id: a for a in result.schedule.assignments}
    assert assignments["B1"].start >= assignments["A1"].start + timedelta(minutes=30)


@pytest.mark.parametrize("strategy_name", STRATEGIES)
def test_negative_finish_to_start_lag_allows_overlap(
    strategy_name, horizon_start, horizon_end, standard_calendar
):
    machines = [
        Machine(id="M1", name="Machine 1", calendar_id=standard_calendar.id),
        Machine(id="M2", name="Machine 2", calendar_id=standard_calendar.id),
    ]
    wo_a = WorkOrder(
        id="WO-A",
        name="WO-A",
        product_id="P-A",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=2),
        operations=[_op("WO-A", "A1", 1, 180, ["M1"])],
    )
    op_b = _op("WO-B", "B1", 1, 60, ["M2"])
    op_b.dependency_links = [
        DependencyLink(
            depends_on_id="A1",
            dependency_type=DependencyType.FINISH_TO_START,
            lag_minutes=-30,
        )
    ]
    wo_b = WorkOrder(
        id="WO-B",
        name="WO-B",
        product_id="P-B",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=2),
        operations=[op_b],
    )

    result = resolve_strategy(strategy_name).solve(
        _ctx([wo_a, wo_b], machines, standard_calendar, horizon_start, horizon_end),
        Objective.default(),
    )
    assignments = {a.operation_id: a for a in result.schedule.assignments}
    assert assignments["B1"].start >= assignments["A1"].end - timedelta(minutes=30)
    assert assignments["B1"].start < assignments["A1"].end


@pytest.mark.parametrize("strategy_name", STRATEGIES)
def test_max_wait_dependency_can_make_schedule_infeasible(
    strategy_name, horizon_start, horizon_end, standard_calendar
):
    end_of_day = datetime(2026, 1, 5, 17, 0)
    machines = [
        Machine(
            id="M1",
            name="Machine 1",
            calendar_id=standard_calendar.id,
            maintenance_windows=[
                TimeWindow(
                    start=datetime(2026, 1, 5, 9, 0),
                    end=datetime(2026, 1, 5, 17, 0),
                )
            ],
        ),
        Machine(
            id="M2",
            name="Machine 2",
            calendar_id=standard_calendar.id,
            maintenance_windows=[
                TimeWindow(
                    start=datetime(2026, 1, 5, 9, 0),
                    end=datetime(2026, 1, 5, 13, 0),
                )
            ],
        ),
    ]
    wo_a = WorkOrder(
        id="WO-A",
        name="WO-A",
        product_id="P-A",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=2),
        operations=[_op("WO-A", "A1", 1, 60, ["M1"])],
    )
    op_b = _op("WO-B", "B1", 1, 60, ["M2"])
    op_b.dependency_links = [
        DependencyLink(
            depends_on_id="A1",
            dependency_type=DependencyType.FINISH_TO_START,
            max_wait_minutes=15,
        )
    ]
    wo_b = WorkOrder(
        id="WO-B",
        name="WO-B",
        product_id="P-B",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=2),
        operations=[op_b],
    )

    with pytest.raises(InfeasibleScheduleError):
        resolve_strategy(strategy_name).solve(
            _ctx([wo_a, wo_b], machines, standard_calendar, horizon_start, end_of_day),
            Objective.default(),
        )


@pytest.mark.parametrize("strategy_name", ["greedy"])
def test_dependency_modes_are_visible_in_planner_outputs(
    strategy_name, horizon_start, horizon_end, standard_calendar
):
    machines = [
        Machine(id="M1", name="Machine 1", calendar_id=standard_calendar.id),
        Machine(id="M2", name="Machine 2", calendar_id=standard_calendar.id),
    ]
    wo_a = WorkOrder(
        id="WO-A",
        name="WO-A",
        product_id="P-A",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=2),
        operations=[_op("WO-A", "A1", 1, 180, ["M1"])],
    )
    op_b = _op("WO-B", "B1", 1, 60, ["M2"])
    op_b.dependency_links = [
        DependencyLink(
            depends_on_id="A1",
            dependency_type=DependencyType.START_TO_START,
            lag_minutes=-15,
            max_wait_minutes=45,
        )
    ]
    wo_b = WorkOrder(
        id="WO-B",
        name="WO-B",
        product_id="P-B",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=2),
        operations=[op_b],
    )

    result = resolve_strategy(strategy_name).solve(
        _ctx([wo_a, wo_b], machines, standard_calendar, horizon_start, horizon_end),
        Objective.default(),
    )
    metrics = compute_metrics(
        result.schedule,
        [wo_a, wo_b],
        horizon_start=horizon_start,
        horizon_end=horizon_end,
    ).as_dict()
    diagnostics = enrich_planner_diagnostics(
        result.diagnostics,
        metrics=metrics,
        strategy=result.strategy_name,
    )
    planner = diagnostics["planner_diagnostics"]
    summary = build_schedule_summary(
        schedule=result.schedule,
        metrics=metrics,
        diagnostics=diagnostics,
        work_orders=[wo_a, wo_b],
    )

    assert set(planner["dependency_modes"]) == {"start_to_start", "overlap", "max_wait"}
    assert any(
        note == "Advanced dependency modes active: start_to_start, overlap, max_wait."
        for note in planner["notes"]
    )
    assert any(
        highlight == "Advanced dependency rules active: start_to_start, overlap, max_wait."
        for highlight in summary.highlights
    )


@pytest.mark.parametrize("strategy_name", ["greedy", "backward"])
def test_max_wait_dependency_report_is_explicit(
    strategy_name, horizon_start, standard_calendar
):
    end_of_day = datetime(2026, 1, 5, 17, 0)
    machines = [
        Machine(
            id="M1",
            name="Machine 1",
            calendar_id=standard_calendar.id,
            maintenance_windows=[
                TimeWindow(
                    start=datetime(2026, 1, 5, 9, 0),
                    end=datetime(2026, 1, 5, 17, 0),
                )
            ],
        ),
        Machine(
            id="M2",
            name="Machine 2",
            calendar_id=standard_calendar.id,
            maintenance_windows=[
                TimeWindow(
                    start=datetime(2026, 1, 5, 9, 0),
                    end=datetime(2026, 1, 5, 13, 0),
                )
            ],
        ),
    ]
    wo_a = WorkOrder(
        id="WO-A",
        name="WO-A",
        product_id="P-A",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=2),
        operations=[_op("WO-A", "A1", 1, 60, ["M1"])],
    )
    op_b = _op("WO-B", "B1", 1, 60, ["M2"])
    op_b.dependency_links = [
        DependencyLink(
            depends_on_id="A1",
            dependency_type=DependencyType.FINISH_TO_START,
            max_wait_minutes=15,
        )
    ]
    wo_b = WorkOrder(
        id="WO-B",
        name="WO-B",
        product_id="P-B",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=2),
        operations=[op_b],
    )

    with pytest.raises(InfeasibleScheduleError) as excinfo:
        resolve_strategy(strategy_name).solve(
            _ctx([wo_a, wo_b], machines, standard_calendar, horizon_start, end_of_day),
            Objective.default(),
        )

    report = excinfo.value.report
    assert report is not None
    assert report.dominant_blocker_kind == "dependency_max_wait"
    assert report.planner_focus == "repair_precedence_or_release"
    assert any(
        blocker.constraint_name == "finish_to_start_max_wait"
        for blocker in report.operations[0].blockers
    )


@pytest.mark.parametrize("strategy_name", STRATEGIES)
def test_transfer_time_can_break_dependency_max_wait(
    strategy_name, horizon_start, horizon_end, standard_calendar
):
    machines = [
        Machine(id="M1", name="Machine 1", calendar_id=standard_calendar.id),
        Machine(id="M2", name="Machine 2", calendar_id=standard_calendar.id),
    ]
    wo_a = WorkOrder(
        id="WO-A",
        name="WO-A",
        product_id="P-A",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=2),
        operations=[_op("WO-A", "A1", 1, 60, ["M1"])],
    )
    op_b = _op("WO-B", "B1", 1, 60, ["M2"])
    op_b.dependency_links = [
        DependencyLink(
            depends_on_id="A1",
            dependency_type=DependencyType.FINISH_TO_START,
            max_wait_minutes=20,
        )
    ]
    wo_b = WorkOrder(
        id="WO-B",
        name="WO-B",
        product_id="P-B",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=2),
        operations=[op_b],
    )

    with pytest.raises(InfeasibleScheduleError):
        resolve_strategy(strategy_name).solve(
            _ctx(
                [wo_a, wo_b],
                machines,
                standard_calendar,
                horizon_start,
                horizon_end,
                transfer_times=TransferTimes(pairs={("M1", "M2"): 30}),
            ),
            Objective.default(),
        )


@pytest.mark.parametrize("strategy_name", ["greedy", "backward"])
def test_preemptive_operation_can_still_honor_advanced_dependencies(
    strategy_name, horizon_start, horizon_end, standard_calendar
):
    sync_due = datetime(2026, 1, 5, 13, 0)
    machines = [
        Machine(
            id="M1",
            name="Machine 1",
            calendar_id=standard_calendar.id,
            maintenance_windows=[
                TimeWindow(
                    start=datetime(2026, 1, 5, 10, 0),
                    end=datetime(2026, 1, 5, 11, 0),
                )
            ],
        ),
        Machine(id="M2", name="Machine 2", calendar_id=standard_calendar.id),
    ]
    wo_a = WorkOrder(
        id="WO-A",
        name="WO-A",
        product_id="P-A",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=3),
        operations=[
                _op(
                    "WO-A",
                    "A1",
                    1,
                    240,
                    ["M1"],
                    preemptible=True,
                    min_chunk_minutes=60,
                )
            ],
    )
    op_b = _op("WO-B", "B1", 1, 60, ["M2"])
    op_b.dependency_links = [
        DependencyLink(
            depends_on_id="A1",
            dependency_type=DependencyType.START_TO_START,
            lag_minutes=120,
            max_wait_minutes=240,
        )
    ]
    wo_b = WorkOrder(
        id="WO-B",
        name="WO-B",
        product_id="P-B",
        quantity=1,
        release_date=horizon_start,
        due_date=sync_due,
        operations=[op_b],
    )

    result = resolve_strategy(strategy_name).solve(
        _ctx([wo_a, wo_b], machines, standard_calendar, horizon_start, horizon_end),
        Objective.default(),
    )
    assignments = {a.operation_id: a for a in result.schedule.assignments}

    assert assignments["A1"].is_preempted
    assert len(assignments["A1"].segments) >= 2
    assert assignments["B1"].start >= assignments["A1"].start + timedelta(minutes=120)
    assert assignments["B1"].start <= assignments["A1"].start + timedelta(minutes=240)


def test_greedy_preemptive_successor_can_fail_on_dependency_max_wait(
    horizon_start, horizon_end, standard_calendar
):
    machines = [
        Machine(id="M1", name="Machine 1", calendar_id=standard_calendar.id),
        Machine(
            id="M2",
            name="Machine 2",
            calendar_id=standard_calendar.id,
            maintenance_windows=[
                TimeWindow(
                    start=datetime(2026, 1, 5, 8, 0),
                    end=datetime(2026, 1, 5, 10, 0),
                )
            ],
        ),
    ]
    wo_a = WorkOrder(
        id="WO-A",
        name="WO-A",
        product_id="P-A",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=2),
        operations=[_op("WO-A", "A1", 1, 60, ["M1"])],
    )
    op_b = _op(
        "WO-B",
        "B1",
        1,
        360,
        ["M2"],
        preemptible=True,
        min_chunk_minutes=60,
    )
    op_b.dependency_links = [
        DependencyLink(
            depends_on_id="A1",
            dependency_type=DependencyType.FINISH_TO_START,
            max_wait_minutes=15,
        )
    ]
    wo_b = WorkOrder(
        id="WO-B",
        name="WO-B",
        product_id="P-B",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=2),
        operations=[op_b],
    )

    with pytest.raises(InfeasibleScheduleError) as excinfo:
        resolve_strategy("greedy").solve(
            _ctx([wo_a, wo_b], machines, standard_calendar, horizon_start, horizon_end),
            Objective.default(),
        )

    report = excinfo.value.report
    assert report is not None
    assert report.dominant_blocker_kind == "dependency_max_wait"
    assert any(
        blocker.constraint_name == "finish_to_start_max_wait"
        for blocker in report.operations[0].blockers
    )


def test_backward_preemptive_predecessor_can_fail_on_dependency_max_wait(
    horizon_start, standard_calendar
):
    horizon_end = datetime(2026, 1, 5, 17, 0)
    machines = [
        Machine(
            id="M1",
            name="Machine 1",
            calendar_id=standard_calendar.id,
            maintenance_windows=[
                TimeWindow(
                    start=datetime(2026, 1, 5, 9, 0),
                    end=datetime(2026, 1, 5, 17, 0),
                )
            ],
        ),
        Machine(id="M2", name="Machine 2", calendar_id=standard_calendar.id),
    ]
    op_a = _op(
        "WO-A",
        "A1",
        1,
        60,
        ["M1"],
        preemptible=True,
        min_chunk_minutes=30,
    )
    wo_a = WorkOrder(
        id="WO-A",
        name="WO-A",
        product_id="P-A",
        quantity=1,
        release_date=horizon_start,
        due_date=datetime(2026, 1, 5, 11, 0),
        operations=[op_a],
    )
    op_b = _op("WO-B", "B1", 1, 60, ["M2"])
    op_b.dependency_links = [
        DependencyLink(
            depends_on_id="A1",
            dependency_type=DependencyType.FINISH_TO_START,
            max_wait_minutes=15,
        )
    ]
    wo_b = WorkOrder(
        id="WO-B",
        name="WO-B",
        product_id="P-B",
        quantity=1,
        release_date=horizon_start,
        due_date=datetime(2026, 1, 5, 11, 0),
        operations=[op_b],
    )

    with pytest.raises(InfeasibleScheduleError) as excinfo:
        resolve_strategy("backward").solve(
            _ctx([wo_a, wo_b], machines, standard_calendar, horizon_start, horizon_end),
            Objective.default(),
        )

    report = excinfo.value.report
    assert report is not None
    assert report.dominant_blocker_kind == "dependency_max_wait"
    assert any(
        blocker.constraint_name == "finish_to_start_max_wait"
        for blocker in report.operations[0].blockers
    )


@pytest.mark.parametrize("strategy_name", STRATEGIES)
def test_same_machine_setup_can_break_dependency_max_wait(
    strategy_name, horizon_start, horizon_end, standard_calendar
):
    setup_matrix = SetupMatrix(
        machine_id="M1",
        default_minutes=0,
        transitions={("A", "B"): 30},
    )
    machines = [
        Machine(
            id="M1",
            name="Machine 1",
            calendar_id=standard_calendar.id,
            setup_matrix=setup_matrix,
        ),
    ]
    op_a = _op("WO-A", "A1", 1, 60, ["M1"])
    op_a.setup_family = "A"
    wo_a = WorkOrder(
        id="WO-A",
        name="WO-A",
        product_id="P-A",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=2),
        operations=[op_a],
    )
    op_b = _op("WO-B", "B1", 1, 60, ["M1"])
    op_b.setup_family = "B"
    op_b.dependency_links = [
        DependencyLink(
            depends_on_id="A1",
            dependency_type=DependencyType.FINISH_TO_START,
            max_wait_minutes=15,
        )
    ]
    wo_b = WorkOrder(
        id="WO-B",
        name="WO-B",
        product_id="P-B",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=2),
        operations=[op_b],
    )

    with pytest.raises(InfeasibleScheduleError):
        resolve_strategy(strategy_name).solve(
            _ctx([wo_a, wo_b], machines, standard_calendar, horizon_start, horizon_end),
            Objective.default(),
        )


def test_compare_exposes_dependency_max_wait_failure_details(
    horizon_start, horizon_end, standard_calendar
):
    machines = [
        Machine(id="M1", name="Machine 1", calendar_id=standard_calendar.id),
        Machine(id="M2", name="Machine 2", calendar_id=standard_calendar.id),
    ]
    wo_a = WorkOrder(
        id="WO-A",
        name="WO-A",
        product_id="P-A",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=2),
        operations=[_op("WO-A", "A1", 1, 180, ["M1"])],
    )
    op_b = _op("WO-B", "B1", 1, 60, ["M2"])
    op_b.dependency_links = [
        DependencyLink(
            depends_on_id="A1",
            dependency_type=DependencyType.START_TO_START,
            lag_minutes=-15,
            max_wait_minutes=45,
        )
    ]
    wo_b = WorkOrder(
        id="WO-B",
        name="WO-B",
        product_id="P-B",
        quantity=1,
        release_date=horizon_start,
        due_date=horizon_start + timedelta(days=2),
        operations=[op_b],
    )

    result = CompareStrategies(
        work_orders=InMemoryWorkOrderRepository([wo_a, wo_b]),
        machines=InMemoryMachineRepository(machines),
        calendars=InMemoryCalendarRepository([standard_calendar]),
    ).execute(
        CompareStrategiesInput(
            strategies=["greedy", "backward"],
            horizon_start=horizon_start,
            horizon_days=int((horizon_end - horizon_start).days),
            parallel=False,
        )
    )

    assert result.summary.failed_strategies == ["backward"]
    assert result.summary.dominant_failure_kind == "dependency_max_wait"
    assert result.summary.planner_focus == "repair_precedence_or_release"
    failure_card = next(
        card for card in result.summary.failure_cards if card["strategy"] == "backward"
    )
    assert failure_card["dominant_blocker_label"] == "Dependency max-wait"
    assert failure_card["dominant_blocker_constraint_name"] == "start_to_start_max_wait"
    assert failure_card["planner_focus"] == "repair_precedence_or_release"
