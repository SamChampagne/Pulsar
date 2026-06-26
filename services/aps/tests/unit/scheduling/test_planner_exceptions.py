from __future__ import annotations

from datetime import datetime

from planiadvance_v2.application.use_cases.planner_exceptions import (
    build_planner_exceptions,
)
from planiadvance_v2.domain.scheduling.diagnosis import (
    Blocker,
    BlockerKind,
    InfeasibilityReport,
    OperationDiagnosis,
)
from planiadvance_v2.domain.scheduling.feasibility import (
    FeasibilityIssue,
    FeasibilityReport,
    IssueKind,
    IssueSeverity,
    RelaxationSuggestion,
)


def test_planner_exceptions_aggregate_feasibility_material_stability_and_metrics():
    feasibility = FeasibilityReport(
        issues=[
            FeasibilityIssue(
                kind=IssueKind.OVERLOADED_MACHINE,
                severity=IssueSeverity.WARNING,
                message="Machine M1 is overloaded.",
                machine_id="M1",
            )
        ],
        suggestions=[
            RelaxationSuggestion(
                action="Add overtime to M1.",
                impact="Adds capacity.",
                priority=1,
                issue_kind=IssueKind.OVERLOADED_MACHINE.value,
            )
        ],
    )
    diagnostics = {
        "material_pegging_report": {
            "status": "short",
            "blocked_operations": [
                {
                    "operation_id": "OP-MAT",
                    "material_id": "MAT-A",
                    "uncovered_quantity": 2.0,
                    "required_at": "2026-01-05T08:00:00",
                    "suggested_action": "Expedite supply.",
                }
            ],
        },
        "stability_report": {
            "available": True,
            "frozen_changed_count": 0,
            "non_impacted_changed_count": 1,
        },
    }

    report = build_planner_exceptions(
        feasibility=feasibility,
        diagnostics=diagnostics,
        metrics={"total_lateness_minutes": 30},
    )

    assert report["version"] == "planner-exceptions-v1"
    assert report["status"] == "blocked"
    assert report["error_count"] == 1
    assert report["warning_count"] == 3
    kinds = {item["kind"] for item in report["exceptions"]}
    assert kinds == {
        "material_shortage",
        "overloaded_machine",
        "schedule_nervousness",
        "lateness",
    }
    assert report["next_best_action"] == "Expedite supply."


def test_planner_exceptions_include_infeasibility_blockers():
    op = OperationDiagnosis(
        operation_id="OP-BLOCKED",
        work_order_id="WO-BLOCKED",
        earliest_possible_start=datetime(2026, 1, 5, 8, 0),
        blockers=[
            Blocker(
                kind=BlockerKind.MACHINE_OVERLOADED,
                message="M1 has no slot.",
                machine_id="M1",
            )
        ],
    )
    infeasibility = InfeasibilityReport(
        strategy="greedy",
        scheduled_so_far=0,
        total_operations=1,
        operations=[op],
        suggestions=["Add capacity to M1."],
    )

    report = build_planner_exceptions(infeasibility=infeasibility)

    assert report["status"] == "blocked"
    assert report["error_count"] == 1
    assert report["exceptions"][0]["source"] == "infeasibility"
    assert report["exceptions"][0]["operation_id"] == "OP-BLOCKED"
    assert report["exceptions"][0]["recommended_action"] == "Add capacity to M1."
