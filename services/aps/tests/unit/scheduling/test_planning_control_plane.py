from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from planiadvance_v2.application.use_cases.planning_control import (
    DiscardPlanningCandidateInput,
    GetPlanningStateInput,
    PlanningControlPlane,
    RecordPlanningCandidateInput,
    RecordPlanningPublishInput,
    SelectPlanningBaselineInput,
)
from planiadvance_v2.domain.entities import Schedule, ScheduledOperation
from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryPlanningControlRepository,
    InMemoryScheduleRepository,
)

START = datetime(2026, 1, 5, 8, 0, 0)


def _schedule(schedule_id: str, *, minutes: int = 0) -> Schedule:
    offset = timedelta(minutes=minutes)
    return Schedule(
        id=schedule_id,
        created_at=START + offset,
        assignments=[
            ScheduledOperation(
                operation_id=f"OP-{schedule_id}",
                work_order_id="WO-1",
                machine_id="M1",
                setup_start=START + offset,
                start=START + offset,
                end=START + offset + timedelta(minutes=60),
            )
        ],
    )


def _save(
    schedules: InMemoryScheduleRepository,
    schedule_id: str,
    *,
    workspace_id: str = "plant-a",
    organization_id: str | None = "org-a",
    lifecycle_status: str = "draft",
) -> None:
    schedules.save(
        _schedule(schedule_id),
        metrics={"makespan_minutes": 60},
        strategy="greedy",
        solver_status="feasible",
        objective_value=10,
        wall_time_ms=5,
        workspace_id=workspace_id,
        scenario_name=schedule_id,
        lifecycle_status=lifecycle_status,
        organization_id=organization_id,
        horizon_start=START,
        horizon_end=START + timedelta(days=1),
        input_snapshot_hash=f"hash-{schedule_id}",
    )


def _use_case() -> tuple[
    PlanningControlPlane,
    InMemoryScheduleRepository,
    InMemoryPlanningControlRepository,
]:
    schedules = InMemoryScheduleRepository()
    planning = InMemoryPlanningControlRepository()
    return PlanningControlPlane(schedules=schedules, planning=planning), schedules, planning


def test_select_baseline_persists_workspace_state_and_event():
    use_case, schedules, _planning = _use_case()
    _save(schedules, "baseline-1")

    result = use_case.select_baseline(
        SelectPlanningBaselineInput(
            schedule_id="baseline-1",
            organization_id="org-a",
            workspace_id="plant-a",
            user_id="user-1",
            scenario_name="Official baseline",
        )
    )

    metadata = schedules.get_metadata("baseline-1")
    assert metadata is not None
    assert metadata.lifecycle_status == "published"
    assert metadata.scenario_name == "Official baseline"
    assert result.active_baseline_schedule_id == "baseline-1"
    assert result.active_candidate_schedule_id is None
    assert result.recent_events[0].event_type == "baseline_selected"
    assert result.recent_events[0].created_by_user_id == "user-1"


def test_record_candidate_keeps_official_baseline_and_archives_previous_candidate():
    use_case, schedules, _planning = _use_case()
    _save(schedules, "baseline", lifecycle_status="published")
    _save(schedules, "candidate-1")
    _save(schedules, "candidate-2")
    use_case.select_baseline(
        SelectPlanningBaselineInput(
            schedule_id="baseline",
            organization_id="org-a",
            workspace_id="plant-a",
        )
    )

    first = use_case.record_candidate(
        RecordPlanningCandidateInput(
            source_schedule_id="baseline",
            candidate_schedule_id="candidate-1",
            organization_id="org-a",
            workspace_id="plant-a",
            planner_actions=[{"action_type": "force_machine", "operation_id": "OP"}],
        )
    )
    second = use_case.record_candidate(
        RecordPlanningCandidateInput(
            source_schedule_id="candidate-1",
            candidate_schedule_id="candidate-2",
            organization_id="org-a",
            workspace_id="plant-a",
            planner_actions=[{"action_type": "change_priority", "work_order_id": "WO"}],
        )
    )

    previous = schedules.get_metadata("candidate-1")
    assert previous is not None
    assert previous.lifecycle_status == "archived"
    assert first.candidate_edit_count == 1
    assert second.active_baseline_schedule_id == "baseline"
    assert second.active_candidate_schedule_id == "candidate-2"
    assert second.candidate_edit_count == 2
    assert second.recent_events[0].event_type == "candidate_edit_applied"
    assert second.recent_events[0].baseline_schedule_id == "baseline"


def test_publish_promotes_candidate_to_active_baseline():
    use_case, schedules, _planning = _use_case()
    _save(schedules, "baseline", lifecycle_status="published")
    _save(schedules, "candidate")
    use_case.select_baseline(
        SelectPlanningBaselineInput(
            schedule_id="baseline",
            organization_id="org-a",
            workspace_id="plant-a",
        )
    )
    use_case.record_candidate(
        RecordPlanningCandidateInput(
            source_schedule_id="baseline",
            candidate_schedule_id="candidate",
            organization_id="org-a",
            workspace_id="plant-a",
        )
    )

    result = use_case.record_publish(
        RecordPlanningPublishInput(
            schedule_id="candidate",
            previous_baseline_schedule_id="baseline",
            organization_id="org-a",
            workspace_id="plant-a",
            publish_status="publishable",
        )
    )

    assert result.active_baseline_schedule_id == "candidate"
    assert result.active_candidate_schedule_id is None
    assert result.candidate_status == "published"
    assert result.recent_events[0].event_type == "candidate_published"


def test_discard_candidate_archives_and_clears_active_candidate():
    use_case, schedules, _planning = _use_case()
    _save(schedules, "baseline", lifecycle_status="published")
    _save(schedules, "candidate")
    use_case.select_baseline(
        SelectPlanningBaselineInput(
            schedule_id="baseline",
            organization_id="org-a",
            workspace_id="plant-a",
        )
    )
    use_case.record_candidate(
        RecordPlanningCandidateInput(
            source_schedule_id="baseline",
            candidate_schedule_id="candidate",
            organization_id="org-a",
            workspace_id="plant-a",
        )
    )

    result = use_case.discard_candidate(
        DiscardPlanningCandidateInput(
            organization_id="org-a",
            workspace_id="plant-a",
            reason="planner rejected the move",
        )
    )

    metadata = schedules.get_metadata("candidate")
    assert metadata is not None
    assert metadata.lifecycle_status == "archived"
    assert result.active_baseline_schedule_id == "baseline"
    assert result.active_candidate_schedule_id is None
    assert result.recent_events[0].payload["reason"] == "planner rejected the move"


def test_control_plane_rejects_cross_workspace_schedule():
    use_case, schedules, _planning = _use_case()
    _save(schedules, "wrong-workspace", workspace_id="plant-b")

    with pytest.raises(ValidationError, match="belongs to workspace"):
        use_case.select_baseline(
            SelectPlanningBaselineInput(
                schedule_id="wrong-workspace",
                organization_id="org-a",
                workspace_id="plant-a",
            )
        )


def test_get_state_infers_latest_published_baseline_when_state_not_created():
    use_case, schedules, _planning = _use_case()
    _save(schedules, "old", lifecycle_status="published")
    _save(schedules, "new", lifecycle_status="published")

    result = use_case.get_state(
        GetPlanningStateInput(organization_id="org-a", workspace_id="plant-a")
    )

    assert result.active_baseline_schedule_id == "new"
    assert result.active_candidate_schedule_id is None
