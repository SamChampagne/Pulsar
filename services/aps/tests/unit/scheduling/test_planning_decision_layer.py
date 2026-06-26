from __future__ import annotations

from datetime import timedelta

from planiadvance_v2.application.use_cases.compare_strategies import (
    CompareStrategies,
    CompareStrategiesInput,
)
from planiadvance_v2.application.use_cases.planning_decision_layer import (
    normalize_reschedule_mode_for_decision,
    select_planning_decision,
)
from planiadvance_v2.application.use_cases.run_scheduling import (
    RunScheduling,
    RunSchedulingInput,
)
from planiadvance_v2.domain.scheduling.feasibility import (
    FeasibilityIssue,
    FeasibilityReport,
    IssueKind,
    IssueSeverity,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryCalendarRepository,
    InMemoryMachineRepository,
    InMemoryWorkOrderRepository,
)
from tests.conftest import make_work_order


def test_auto_decision_uses_greedy_for_ready_shop():
    decision = select_planning_decision(
        requested_strategy="auto",
        requested_reschedule_mode="reschedule_all",
        selected_reschedule_mode="reschedule_all",
        feasibility=FeasibilityReport(),
    )

    assert decision.selected_strategy == "greedy"
    assert decision.engine_mode == "normal"
    assert decision.rules_triggered == ("normal_dispatch",)
    assert decision.auto_selected is True


def test_auto_decision_uses_backward_for_due_date_pressure():
    feasibility = FeasibilityReport(
        issues=[
            FeasibilityIssue(
                kind=IssueKind.UNREACHABLE_DUE_DATE,
                severity=IssueSeverity.WARNING,
                message="Due date is tight.",
                work_order_id="WO-TIGHT",
            )
        ]
    )

    decision = select_planning_decision(
        requested_strategy="auto",
        requested_reschedule_mode="reschedule_all",
        selected_reschedule_mode="reschedule_all",
        feasibility=feasibility,
    )

    assert decision.selected_strategy == "hybrid"
    assert decision.engine_mode == "degraded"
    assert decision.rules_triggered == ("due_date_pressure",)


def test_auto_decision_preserves_baseline_with_repair_local_mode():
    selected_mode = normalize_reschedule_mode_for_decision(
        requested_strategy="auto",
        requested_reschedule_mode="reschedule_all",
        baseline_schedule_present=True,
    )

    decision = select_planning_decision(
        requested_strategy="auto",
        requested_reschedule_mode="reschedule_all",
        selected_reschedule_mode=selected_mode,
        feasibility=FeasibilityReport(),
        baseline_schedule_present=True,
    )

    assert selected_mode == "repair_local"
    assert decision.selected_strategy == "greedy"
    assert decision.engine_mode == "repair"
    assert decision.rules_triggered == ("baseline_stability",)


def test_run_scheduling_auto_exposes_decision_layer(
    horizon_start,
    standard_calendar,
    two_machines,
):
    work_order = make_work_order(
        "WO-AUTO",
        release=horizon_start,
        due=horizon_start + timedelta(days=2),
        ops=[("OP-AUTO", 60, ["M1"], 0)],
    )
    use_case = RunScheduling(
        work_orders=InMemoryWorkOrderRepository([work_order]),
        machines=InMemoryMachineRepository(two_machines),
        calendars=InMemoryCalendarRepository([standard_calendar]),
    )

    result = use_case.execute(
        RunSchedulingInput(
            horizon_start=horizon_start,
            horizon_days=3,
            strategy="auto",
            persist=False,
        )
    )

    decision = result.diagnostics["decision_layer"]
    planner = result.diagnostics["planner_diagnostics"]
    assert result.strategy == "greedy"
    assert decision["auto_selected"] is True
    assert decision["selected_strategy"] == "greedy"
    assert decision["engine_mode"] == "normal"
    assert planner["decision_layer"] == decision


def test_auto_decision_uses_hybrid_for_what_if_scenarios():
    decision = select_planning_decision(
        requested_strategy="auto",
        requested_reschedule_mode="reschedule_all",
        selected_reschedule_mode="reschedule_all",
        feasibility=FeasibilityReport(),
        lifecycle_status="what_if",
    )

    assert decision.selected_strategy == "hybrid"
    assert decision.rules_triggered == ("scenario_forward_backward",)


def test_decision_evidence_keeps_baseline_metrics_and_exceptions():
    decision = select_planning_decision(
        requested_strategy="auto",
        requested_reschedule_mode="reschedule_all",
        selected_reschedule_mode="repair_local",
        feasibility=FeasibilityReport(),
        baseline_schedule_present=True,
        lifecycle_status="published",
        metrics={
            "makespan_minutes": 240,
            "total_lateness_minutes": 30,
            "on_time_ratio": 0.8,
        },
        planner_exceptions={
            "status": "attention",
            "dominant_kind": "lateness",
        },
    )

    assert decision.selected_strategy == "greedy"
    assert decision.engine_mode == "repair"
    assert decision.evidence["lifecycle_status"] == "published"
    assert decision.evidence["makespan_minutes"] == 240
    assert decision.evidence["total_lateness_minutes"] == 30
    assert decision.evidence["planner_exception_status"] == "attention"


def test_compare_strategies_auto_run_exposes_decision_layer(
    horizon_start,
    standard_calendar,
    two_machines,
):
    work_order = make_work_order(
        "WO-COMPARE-AUTO",
        release=horizon_start,
        due=horizon_start + timedelta(days=2),
        ops=[("OP-COMPARE-AUTO", 60, ["M1"], 0)],
    )
    use_case = CompareStrategies(
        work_orders=InMemoryWorkOrderRepository([work_order]),
        machines=InMemoryMachineRepository(two_machines),
        calendars=InMemoryCalendarRepository([standard_calendar]),
    )

    result = use_case.execute(
        CompareStrategiesInput(
            strategies=["auto"],
            horizon_start=horizon_start,
            horizon_days=3,
            parallel=False,
        )
    )

    run = result.runs[0]
    decision = run.diagnostics["decision_layer"]
    planner = run.diagnostics["planner_diagnostics"]
    assert run.strategy == "greedy"
    assert decision["requested_strategy"] == "auto"
    assert decision["selected_strategy"] == "greedy"
    assert decision["auto_selected"] is True
    assert planner["decision_layer"] == decision
