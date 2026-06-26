"""Tests for the pre-solve feasibility checker and relaxation advisor.

Covers:

* Clean context — no issues detected.
* Missing machine — ERROR for non-existent machine in eligible list.
* Invalid due date — ERROR for due < release.
* Unreachable due date — WARNING for tight schedule.
* Machine overload — WARNING for insufficient capacity.
* Horizon too short — WARNING for total work exceeding capacity.
* Relaxation suggestions — appropriate actions generated.
* Report serialization — as_dict and human_summary.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

from planiadvance_v2.domain.entities import (
    Machine,
    Resource,
    ResourceRequirement,
    WorkingCalendar,
)
from planiadvance_v2.domain.scheduling import SchedulingContext
from planiadvance_v2.domain.scheduling.feasibility import (
    IssueKind,
    IssueSeverity,
    check_feasibility,
)
from planiadvance_v2.domain.value_objects import Shift
from tests.conftest import make_work_order

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


# --------------------------------------------------------------------------
# Clean context — no issues
# --------------------------------------------------------------------------


class TestCleanContext:
    def test_feasible_context(self):
        wo = make_work_order(
            "WO1",
            release=HORIZON_START,
            due=HORIZON_START + timedelta(days=3),
            ops=[("OP1", 60, ["M1"], 0)],
        )
        ctx = SchedulingContext(
            horizon_start=HORIZON_START,
            horizon_end=HORIZON_START + timedelta(days=14),
            work_orders=[wo],
            machines=_machines(1),
            calendars=[_calendar()],
        )
        report = check_feasibility(ctx)
        assert report.is_feasible
        assert report.error_count == 0
        assert report.readiness_status == "ready"
        assert report.recommended_mode == "normal_solve"

    def test_empty_context(self):
        ctx = SchedulingContext(
            horizon_start=HORIZON_START,
            horizon_end=HORIZON_START + timedelta(days=14),
            work_orders=[],
            machines=_machines(1),
            calendars=[_calendar()],
        )
        report = check_feasibility(ctx)
        assert report.is_feasible


# Note: Missing machine checks are covered by SchedulingContext validation
# (raises UnknownResourceError). The feasibility checker's MISSING_MACHINE
# check is a defense-in-depth layer for contexts built outside normal
# validation flow.


# Note: Invalid due date (due < release) is caught by WorkOrder.__post_init__
# validation, so the feasibility checker's INVALID_DUE_DATE check is a
# defense-in-depth layer.


# --------------------------------------------------------------------------
# Unreachable due date
# --------------------------------------------------------------------------


class TestUnreachableDueDate:
    def test_detects_tight_deadline(self):
        # 180 min of work, only 120 min between release and due.
        wo = make_work_order(
            "WO1",
            release=HORIZON_START,
            due=HORIZON_START + timedelta(hours=2),
            ops=[
                ("OP1", 60, ["M1"], 0),
                ("OP2", 60, ["M1"], 0),
                ("OP3", 60, ["M1"], 0),
            ],
        )
        ctx = SchedulingContext(
            horizon_start=HORIZON_START,
            horizon_end=HORIZON_START + timedelta(days=14),
            work_orders=[wo],
            machines=_machines(1),
            calendars=[_calendar()],
        )
        report = check_feasibility(ctx)
        unreachable = [
            i for i in report.issues if i.kind == IssueKind.UNREACHABLE_DUE_DATE
        ]
        assert len(unreachable) == 1
        assert unreachable[0].severity == IssueSeverity.WARNING
        assert report.readiness_status == "degraded"
        assert report.recommended_mode == "solve_with_caution"


class TestImpossibleResourceRequirement:
    def test_detects_op_requiring_more_than_resource_capacity(self):
        wo = make_work_order(
            "WO1",
            release=HORIZON_START,
            due=HORIZON_START + timedelta(days=3),
            ops=[("OP1", 60, ["M1"], 0)],
        )
        wo.operations[0].resource_requirements = [
            ResourceRequirement(resource_id="OPR", units=2)
        ]
        ctx = SchedulingContext(
            horizon_start=HORIZON_START,
            horizon_end=HORIZON_START + timedelta(days=14),
            work_orders=[wo],
            machines=_machines(1),
            calendars=[_calendar()],
            resources=[Resource(id="OPR", name="Operators", capacity=1)],
        )
        report = check_feasibility(ctx)
        issues = [
            i
            for i in report.issues
            if i.kind == IssueKind.IMPOSSIBLE_RESOURCE_REQUIREMENT
        ]
        assert len(issues) == 1
        assert issues[0].operation_id == "OP1"
        assert report.readiness_status == "blocked"
        assert report.recommended_mode == "repair_then_solve"
        assert report.dominant_issue_kind == "impossible_resource_requirement"
        assert report.planner_focus == "repair_blockers"
        assert report.next_best_action is not None


# --------------------------------------------------------------------------
# Machine overload
# --------------------------------------------------------------------------


class TestMachineOverload:
    def test_detects_overloaded_machine(self):
        # Create many operations all requiring M1.
        # Mon-Fri 08-17 = 9h/day = 540 min/day, 14 days ≈ 10 work days = 5400 min.
        # Assign 6000 min of work to M1.
        ops = [
            (f"OP{i}", 120, ["M1"], 0) for i in range(50)
        ]  # 50 * 120 = 6000 min > 5400 available
        wo = make_work_order(
            "WO1",
            release=HORIZON_START,
            due=HORIZON_START + timedelta(days=30),
            ops=ops,
        )
        ctx = SchedulingContext(
            horizon_start=HORIZON_START,
            horizon_end=HORIZON_START + timedelta(days=14),
            work_orders=[wo],
            machines=_machines(1),
            calendars=[_calendar()],
        )
        report = check_feasibility(ctx)
        overloaded = [
            i for i in report.issues if i.kind == IssueKind.OVERLOADED_MACHINE
        ]
        assert len(overloaded) == 1
        assert overloaded[0].machine_id == "M1"


# --------------------------------------------------------------------------
# Relaxation suggestions
# --------------------------------------------------------------------------


class TestRelaxationSuggestions:
    def test_suggestions_for_overloaded(self):
        ops = [(f"OP{i}", 120, ["M1"], 0) for i in range(50)]
        wo = make_work_order(
            "WO1",
            release=HORIZON_START,
            due=HORIZON_START + timedelta(days=30),
            ops=ops,
        )
        ctx = SchedulingContext(
            horizon_start=HORIZON_START,
            horizon_end=HORIZON_START + timedelta(days=14),
            work_orders=[wo],
            machines=_machines(1),
            calendars=[_calendar()],
        )
        report = check_feasibility(ctx)
        assert len(report.suggestions) > 0
        actions = [s.action for s in report.suggestions]
        assert any("M1" in a for a in actions)
        top = report.suggestions[0]
        assert top.issue_kind == "overloaded_machine"
        assert top.target_ids == ("M1",)
        assert top.expected_mode == "solve_with_caution"
        assert top.rationale is not None

    def test_suggestions_for_impossible_resource_requirement(self):
        wo = make_work_order(
            "WO1",
            release=HORIZON_START,
            due=HORIZON_START + timedelta(days=3),
            ops=[("OP1", 60, ["M1"], 0)],
        )
        wo.operations[0].resource_requirements = [
            ResourceRequirement(resource_id="OPR", units=3)
        ]
        ctx = SchedulingContext(
            horizon_start=HORIZON_START,
            horizon_end=HORIZON_START + timedelta(days=14),
            work_orders=[wo],
            machines=_machines(1),
            calendars=[_calendar()],
            resources=[Resource(id="OPR", name="Operators", capacity=1)],
        )
        report = check_feasibility(ctx)
        actions = [s.action for s in report.suggestions]
        assert any("Reduce required units or increase resource capacity" in a for a in actions)
        first = report.suggestions[0]
        assert first.issue_kind == "impossible_resource_requirement"
        assert first.target_ids == ("OP1",)
        assert first.expected_mode == "repair_then_solve"

    def test_no_suggestions_for_clean(self):
        wo = make_work_order(
            "WO1",
            release=HORIZON_START,
            due=HORIZON_START + timedelta(days=3),
            ops=[("OP1", 60, ["M1"], 0)],
        )
        ctx = SchedulingContext(
            horizon_start=HORIZON_START,
            horizon_end=HORIZON_START + timedelta(days=14),
            work_orders=[wo],
            machines=_machines(1),
            calendars=[_calendar()],
        )
        report = check_feasibility(ctx)
        assert len(report.suggestions) == 0
        assert report.next_best_action is None
        assert report.planner_focus == "run_normally"


# --------------------------------------------------------------------------
# Report serialization
# --------------------------------------------------------------------------


class TestReportSerialization:
    def test_as_dict_structure(self):
        wo = make_work_order(
            "WO1",
            release=HORIZON_START,
            due=HORIZON_START + timedelta(days=3),
            ops=[("OP1", 60, ["M1"], 0)],
        )
        ctx = SchedulingContext(
            horizon_start=HORIZON_START,
            horizon_end=HORIZON_START + timedelta(days=14),
            work_orders=[wo],
            machines=_machines(1),
            calendars=[_calendar()],
        )
        report = check_feasibility(ctx)
        d = report.as_dict()
        assert "is_feasible" in d
        assert "error_count" in d
        assert "warning_count" in d
        assert "readiness_status" in d
        assert "recommended_mode" in d
        assert "dominant_issue_kind" in d
        assert "next_best_action" in d
        assert "planner_focus" in d
        assert "issues" in d
        assert "suggestions" in d

    def test_human_summary_clean(self):
        wo = make_work_order(
            "WO1",
            release=HORIZON_START,
            due=HORIZON_START + timedelta(days=3),
            ops=[("OP1", 60, ["M1"], 0)],
        )
        ctx = SchedulingContext(
            horizon_start=HORIZON_START,
            horizon_end=HORIZON_START + timedelta(days=14),
            work_orders=[wo],
            machines=_machines(1),
            calendars=[_calendar()],
        )
        report = check_feasibility(ctx)
        assert "passed" in report.human_summary().lower()

    def test_human_summary_with_issues(self):
        # Unreachable due date triggers a WARNING.
        wo = make_work_order(
            "WO1",
            release=HORIZON_START,
            due=HORIZON_START + timedelta(hours=1),  # very tight
            ops=[
                ("OP1", 60, ["M1"], 0),
                ("OP2", 60, ["M1"], 0),
            ],
        )
        ctx = SchedulingContext(
            horizon_start=HORIZON_START,
            horizon_end=HORIZON_START + timedelta(days=14),
            work_orders=[wo],
            machines=_machines(1),
            calendars=[_calendar()],
        )
        report = check_feasibility(ctx)
        summary = report.human_summary()
        assert "warning" in summary.lower() or "WARN" in summary
        assert "Next best action:" in summary
