from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import get_db_session, get_planning_control_plane
from planiadvance_v2.api.main import create_app
from planiadvance_v2.application.use_cases.planning_control import PlanningControlPlane
from planiadvance_v2.domain.entities import Schedule, ScheduledOperation
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryPlanningControlRepository,
    InMemoryScheduleRepository,
)

START = datetime(2026, 1, 5, 8, 0, 0)


class _DummySession:
    def commit(self) -> None:
        return None


def _dummy_session():
    yield _DummySession()


@pytest.fixture
def api():
    schedules = InMemoryScheduleRepository()
    planning = InMemoryPlanningControlRepository()
    app = create_app()

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_planning_control_plane] = lambda: PlanningControlPlane(
        schedules=schedules,
        planning=planning,
    )
    app.dependency_overrides[get_db_session] = _dummy_session

    with TestClient(app) as client:
        yield {"client": client, "schedules": schedules, "planning": planning}

    app.dependency_overrides.clear()


def _save(schedules: InMemoryScheduleRepository, schedule_id: str) -> None:
    schedules.save(
        Schedule(
            id=schedule_id,
            created_at=START,
            assignments=[
                ScheduledOperation(
                    operation_id="OP-1",
                    work_order_id="WO-1",
                    machine_id="M1",
                    setup_start=START,
                    start=START,
                    end=START + timedelta(minutes=60),
                )
            ],
        ),
        metrics={"makespan_minutes": 60},
        strategy="greedy",
        solver_status="feasible",
        objective_value=10,
        wall_time_ms=5,
        workspace_id="default",
        scenario_name=schedule_id,
        lifecycle_status="draft",
        horizon_start=START,
        horizon_end=START + timedelta(days=1),
        input_snapshot_hash=f"hash-{schedule_id}",
    )


def test_planning_state_starts_empty(api):
    response = api["client"].get("/planning/state")

    assert response.status_code == 200
    data = response.json()
    assert data["workspace_id"] == "default"
    assert data["active_baseline_schedule_id"] is None
    assert data["active_candidate_schedule_id"] is None


def test_select_baseline_exposes_state_and_event(api):
    _save(api["schedules"], "baseline")

    selected = api["client"].post(
        "/planning/baseline/select",
        json={"schedule_id": "baseline", "scenario_name": "Official baseline"},
    )
    state = api["client"].get("/planning/state")
    events = api["client"].get("/planning/events")

    assert selected.status_code == 200
    assert selected.json()["active_baseline_schedule_id"] == "baseline"
    assert selected.json()["active_baseline"]["lifecycle_status"] == "published"
    assert state.json()["active_baseline"]["scenario_name"] == "Official baseline"
    assert events.json()[0]["event_type"] == "baseline_selected"


def test_discard_candidate_is_idempotent_without_active_candidate(api):
    response = api["client"].post(
        "/planning/candidate/discard",
        json={"reason": "nothing to discard"},
    )

    assert response.status_code == 200
    assert response.json()["active_candidate_schedule_id"] is None
    assert response.json()["candidate_status"] == "none"
