from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from planiadvance_v2.application.use_cases.compare_scenarios import (
    CompareScenarios,
    CompareScenariosInput,
)
from planiadvance_v2.application.use_cases.publish_scenario import (
    PublishScenario,
    PublishScenarioInput,
)
from planiadvance_v2.domain.entities import Schedule, ScheduledOperation
from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryScheduleRepository,
)

START = datetime(2026, 1, 5, 8, 0, 0)


def _schedule(schedule_id: str, *, shift_minutes: int = 0) -> Schedule:
    offset = timedelta(minutes=shift_minutes)
    return Schedule(
        id=schedule_id,
        created_at=START,
        assignments=[
            ScheduledOperation(
                operation_id="OP-1",
                work_order_id="WO-1",
                machine_id="M1",
                setup_start=START + offset,
                start=START + offset,
                end=START + timedelta(minutes=60) + offset,
            ),
            ScheduledOperation(
                operation_id="OP-2",
                work_order_id="WO-2",
                machine_id="M1",
                setup_start=START + timedelta(minutes=60) + offset,
                start=START + timedelta(minutes=60) + offset,
                end=START + timedelta(minutes=120) + offset,
            ),
        ],
    )


def _save(
    repo: InMemoryScheduleRepository,
    schedule: Schedule,
    *,
    scenario_name: str,
    lifecycle_status: str = "candidate",
    objective_value: int = 100,
    lateness: int = 0,
    organization_id: str | None = None,
    diagnostics: dict | None = None,
) -> None:
    repo.save(
        schedule,
        metrics={
            "makespan_minutes": 120,
            "total_lateness_minutes": lateness,
            "on_time_ratio": 1.0 if lateness == 0 else 0.5,
            "machine_utilization": {"M1": 0.2},
        },
        strategy="greedy",
        solver_status="feasible",
        objective_value=objective_value,
        wall_time_ms=5,
        diagnostics=diagnostics or {},
        scenario_name=scenario_name,
        lifecycle_status=lifecycle_status,
        organization_id=organization_id,
        horizon_start=START,
        horizon_end=START + timedelta(days=1),
        input_snapshot_hash=f"hash-{schedule.id}",
        engine_version="aps-test.v1",
    )


def test_compare_scenarios_recommends_publishable_candidate():
    repo = InMemoryScheduleRepository()
    baseline = _schedule("baseline")
    publishable = _schedule("candidate-publishable")
    nervous = _schedule("candidate-review", shift_minutes=30)
    _save(repo, baseline, scenario_name="Baseline", lifecycle_status="published", objective_value=100)
    _save(repo, publishable, scenario_name="Overtime", objective_value=80)
    _save(repo, nervous, scenario_name="Rush order", objective_value=75, lateness=30)

    result = CompareScenarios(repo).execute(
        CompareScenariosInput(
            baseline_schedule_id="baseline",
            candidate_schedule_ids=["candidate-review", "candidate-publishable"],
        )
    )

    assert result.baseline.scenario_name == "Baseline"
    assert result.baseline.workspace_id == "default"
    assert result.baseline.horizon_start == START
    assert result.baseline.input_snapshot_hash == "hash-baseline"
    assert result.baseline.engine_version == "aps-test.v1"
    assert result.recommended_schedule_id == "candidate-publishable"
    assert result.publishable_schedule_ids == ["candidate-publishable"]
    assert result.summary["comparison_count"] == 2
    by_id = {
        item.candidate.schedule_id: item
        for item in result.comparisons
    }
    assert by_id["candidate-publishable"].publish_status == "publishable"
    assert by_id["candidate-review"].publish_status == "review"
    assert by_id["candidate-review"].metric_delta["total_lateness_minutes"] == 30
    assert by_id["candidate-review"].stability_report["available"] is True


def test_compare_scenarios_blocks_candidate_with_planner_exceptions():
    repo = InMemoryScheduleRepository()
    _save(repo, _schedule("baseline"), scenario_name="Baseline")
    _save(
        repo,
        _schedule("candidate-blocked"),
        scenario_name="Material shortage scenario",
        diagnostics={"planner_exceptions": {"status": "blocked"}},
    )

    result = CompareScenarios(repo).execute(
        CompareScenariosInput(
            baseline_schedule_id="baseline",
            candidate_schedule_ids=["candidate-blocked"],
        )
    )

    comparison = result.comparisons[0]
    assert comparison.publish_status == "blocked"
    assert comparison.recommendation == "Resolve planner exceptions before publishing."
    assert result.recommended_schedule_id is None
    assert result.publishable_schedule_ids == []


def test_compare_scenarios_rejects_cross_org_candidate():
    repo = InMemoryScheduleRepository()
    _save(repo, _schedule("baseline"), scenario_name="Baseline", organization_id="org-a")
    _save(
        repo,
        _schedule("candidate"),
        scenario_name="Other org",
        organization_id="org-b",
    )

    with pytest.raises(ValidationError, match="belongs to organization"):
        CompareScenarios(repo).execute(
            CompareScenariosInput(
                baseline_schedule_id="baseline",
                candidate_schedule_ids=["candidate"],
                organization_id="org-a",
            )
        )


def test_publish_scenario_promotes_publishable_candidate():
    repo = InMemoryScheduleRepository()
    _save(repo, _schedule("baseline"), scenario_name="Baseline", lifecycle_status="published")
    _save(repo, _schedule("candidate"), scenario_name="Overtime candidate")

    result = PublishScenario(repo).execute(
        PublishScenarioInput(
            schedule_id="candidate",
            baseline_schedule_id="baseline",
            scenario_name="Overtime approved",
        )
    )

    metadata = repo.get_metadata("candidate")
    assert metadata is not None
    assert result.lifecycle_status == "published"
    assert result.scenario_name == "Overtime approved"
    assert result.publish_status == "publishable"
    assert metadata.lifecycle_status == "published"
    assert metadata.scenario_name == "Overtime approved"
    assert result.comparison is not None
    assert result.metadata.input_snapshot_hash == "hash-candidate"
    assert result.as_dict()["metadata"]["input_snapshot_hash"] == "hash-candidate"
    assert result.as_dict()["metadata"]["engine_version"] == "aps-test.v1"


def test_publish_scenario_blocks_blocked_candidate():
    repo = InMemoryScheduleRepository()
    _save(repo, _schedule("baseline"), scenario_name="Baseline")
    _save(
        repo,
        _schedule("candidate-blocked"),
        scenario_name="Blocked candidate",
        diagnostics={"planner_exceptions": {"status": "blocked"}},
    )

    with pytest.raises(ValidationError, match="Resolve planner exceptions"):
        PublishScenario(repo).execute(
            PublishScenarioInput(
                schedule_id="candidate-blocked",
                baseline_schedule_id="baseline",
            )
        )

    metadata = repo.get_metadata("candidate-blocked")
    assert metadata is not None
    assert metadata.lifecycle_status == "candidate"


def test_publish_scenario_requires_review_override_for_review_candidate():
    repo = InMemoryScheduleRepository()
    _save(repo, _schedule("baseline"), scenario_name="Baseline")
    _save(
        repo,
        _schedule("candidate-review", shift_minutes=30),
        scenario_name="Review candidate",
        lateness=30,
    )

    with pytest.raises(ValidationError, match="allow_review=True"):
        PublishScenario(repo).execute(
            PublishScenarioInput(
                schedule_id="candidate-review",
                baseline_schedule_id="baseline",
            )
        )

    result = PublishScenario(repo).execute(
        PublishScenarioInput(
            schedule_id="candidate-review",
            baseline_schedule_id="baseline",
            allow_review=True,
        )
    )

    assert result.publish_status == "review"
    assert result.lifecycle_status == "published"
