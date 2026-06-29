"""Unit tests for the multi-objective and diagnosis helpers.

These are pure-data helpers with no dependency on a strategy, so they
live in their own module and stay very fast.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from planiadvance_v2.domain.entities import Schedule, ScheduledOperation
from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.domain.scheduling import (
    Blocker,
    BlockerKind,
    InfeasibilityReport,
    Objective,
    OperationDiagnosis,
    score_schedule,
)
from tests.conftest import make_work_order


class TestObjective:
    def test_default_has_positive_weight(self):
        obj = Objective.default()
        assert obj.total_weight() > 0
        assert obj.makespan > 0

    def test_negative_weight_rejected(self):
        with pytest.raises(ValidationError):
            Objective(makespan=-1)

    def test_zero_weights_rejected(self):
        with pytest.raises(ValidationError):
            Objective(
                makespan=0,
                total_tardiness=0,
                weighted_tardiness=0,
                setup_cost=0,
                idle_penalty=0,
            )

    def test_makespan_only_ignores_tardiness(self):
        obj = Objective.makespan_only()
        assert obj.total_tardiness == 0
        assert obj.weighted_tardiness == 0


class TestScoreSchedule:
    def test_empty_schedule_scores_zero(self):
        schedule = Schedule(id="s", created_at=datetime.utcnow(), assignments=[])
        score = score_schedule(
            schedule, [], Objective.default(), horizon_start=datetime.utcnow()
        )
        assert score == 0

    def test_lateness_contributes_to_score(self):
        start = datetime(2026, 1, 5, 8, 0)
        wo = make_work_order(
            "WO",
            release=start,
            due=start + timedelta(hours=1),
            ops=[("OP", 60, ["M1"], 0)],
        )
        # Schedule OP two hours after the due date → 120 min tardiness.
        assignment = ScheduledOperation(
            operation_id="OP",
            work_order_id="WO",
            machine_id="M1",
            setup_start=start + timedelta(hours=2),
            start=start + timedelta(hours=2),
            end=start + timedelta(hours=3),
        )
        schedule = Schedule(
            id="s", created_at=datetime.utcnow(), assignments=[assignment]
        )
        obj = Objective(makespan=1, total_tardiness=10)
        score = score_schedule(schedule, [wo], obj, horizon_start=start)
        # makespan = 180 min, tardiness = 120 min → 180 + 10*120 = 1380
        assert score == 1380


class TestInfeasibilityReport:
    def test_progress_ratio(self):
        report = InfeasibilityReport(
            strategy="greedy", scheduled_so_far=3, total_operations=10
        )
        assert abs(report.progress_ratio - 0.3) < 1e-9

    def test_summary_lists_blockers(self):
        diag = OperationDiagnosis(
            operation_id="OP",
            work_order_id="WO",
            earliest_possible_start=datetime(2026, 1, 5),
            blockers=[
                Blocker(
                    kind=BlockerKind.MACHINE_OVERLOADED,
                    message="no slot",
                    machine_id="M1",
                )
            ],
        )
        report = InfeasibilityReport(
            strategy="greedy",
            scheduled_so_far=0,
            total_operations=1,
            operations=[diag],
            suggestions=["add capacity"],
        )
        text = report.human_summary()
        assert "OP" in text
        assert "machine_overloaded" in text
        assert "add capacity" in text

    def test_suggest_deduplicates(self):
        report = InfeasibilityReport(
            strategy="greedy", scheduled_so_far=0, total_operations=1
        )
        report.suggest("x")
        report.suggest("x")
        report.suggest("y")
        assert report.suggestions == ["x", "y"]

    def test_as_dict_is_serialisable(self):
        report = InfeasibilityReport(
            strategy="greedy", scheduled_so_far=0, total_operations=1
        )
        report.add(
            OperationDiagnosis(
                operation_id="OP",
                work_order_id="WO",
                earliest_possible_start=None,
                blockers=[
                    Blocker(
                        kind=BlockerKind.HORIZON_TOO_SHORT,
                        message="too short",
                    )
                ],
            )
        )
        data = report.as_dict()
        assert data["strategy"] == "greedy"
        assert data["operations"][0]["blockers"][0]["kind"] == "horizon_too_short"
