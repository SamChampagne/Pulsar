"""J7 — proof that /planning/* endpoints are tenant-scoped.

Planning state holds the active baseline + candidate per workspace. If
one tenant could read or mutate another tenant's baseline, that would
let a peer org silently flip what the floor is running. These tests
exercise the HTTP layer:

- org-A's selected baseline must not appear in org-B's GET /planning/state
- org-A's planning events must not appear in org-B's GET /planning/events
- A cross-tenant POST /planning/baseline/select must fail and not mutate
  the target schedule (no lifecycle promotion across tenants)

Failure here is a real cross-tenant integrity leak.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import (
    get_db_session,
    get_planning_control_plane,
)
from planiadvance_v2.api.routes import planning as planning_route
from planiadvance_v2.api.tenant import TenantContext, get_tenant_context
from planiadvance_v2.application.use_cases.planning_control import (
    PlanningControlPlane,
)
from planiadvance_v2.domain.entities import Schedule, ScheduledOperation
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryPlanningControlRepository,
    InMemoryScheduleRepository,
)

START = datetime(2026, 5, 11, 8, 0, 0)


class _DummySession:
    def commit(self) -> None:
        return None


def _dummy_session():
    yield _DummySession()


def _build_app(
    schedules: InMemoryScheduleRepository,
    planning: InMemoryPlanningControlRepository,
    tenant: TenantContext,
) -> FastAPI:
    app = FastAPI()
    app.include_router(planning_route.router)
    app.dependency_overrides[get_planning_control_plane] = (
        lambda: PlanningControlPlane(schedules=schedules, planning=planning)
    )
    app.dependency_overrides[get_db_session] = _dummy_session
    app.dependency_overrides[get_tenant_context] = lambda: tenant
    return app


def _save_schedule(
    schedules: InMemoryScheduleRepository,
    *,
    schedule_id: str,
    organization_id: str,
    workspace_id: str = "default",
) -> None:
    schedules.save(
        Schedule(
            id=schedule_id,
            created_at=START,
            assignments=[
                ScheduledOperation(
                    operation_id=f"OP-{schedule_id}",
                    work_order_id=f"WO-{schedule_id}",
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
        workspace_id=workspace_id,
        scenario_name=schedule_id,
        lifecycle_status="draft",
        organization_id=organization_id,
        horizon_start=START,
        horizon_end=START + timedelta(days=1),
        input_snapshot_hash=f"hash-{schedule_id}",
    )


@pytest.fixture
def shared_repos():
    return {
        "schedules": InMemoryScheduleRepository(),
        "planning": InMemoryPlanningControlRepository(),
    }


@pytest.fixture
def org_a_session(shared_repos):
    tenant = TenantContext(organization_id="org-a", user_id="user-a")
    app = _build_app(shared_repos["schedules"], shared_repos["planning"], tenant)
    with TestClient(app) as client:
        yield client


@pytest.fixture
def org_b_session(shared_repos):
    tenant = TenantContext(organization_id="org-b", user_id="user-b")
    app = _build_app(shared_repos["schedules"], shared_repos["planning"], tenant)
    with TestClient(app) as client:
        yield client


def test_org_a_baseline_is_invisible_to_org_b(
    shared_repos, org_a_session, org_b_session
) -> None:
    _save_schedule(
        shared_repos["schedules"],
        schedule_id="sched-a",
        organization_id="org-a",
    )

    selected = org_a_session.post(
        "/planning/baseline/select",
        json={"schedule_id": "sched-a", "scenario_name": "Org-A baseline"},
    )
    assert selected.status_code == 200
    assert selected.json()["active_baseline_schedule_id"] == "sched-a"

    state_b = org_b_session.get("/planning/state")
    assert state_b.status_code == 200
    body = state_b.json()
    # org-B has no state of its own, and crucially must not see org-A's.
    assert body["active_baseline_schedule_id"] is None
    assert body["active_candidate_schedule_id"] is None
    assert body.get("active_baseline") in (None, {})
    assert "sched-a" not in state_b.text


def test_org_a_planning_events_do_not_leak_to_org_b(
    shared_repos, org_a_session, org_b_session
) -> None:
    _save_schedule(
        shared_repos["schedules"],
        schedule_id="sched-a",
        organization_id="org-a",
    )
    org_a_session.post(
        "/planning/baseline/select",
        json={"schedule_id": "sched-a", "scenario_name": "Org-A baseline"},
    )

    events_a = org_a_session.get("/planning/events")
    events_b = org_b_session.get("/planning/events")

    assert events_a.status_code == 200
    assert any(e["event_type"] == "baseline_selected" for e in events_a.json())

    assert events_b.status_code == 200
    assert events_b.json() == []
    # Defence in depth: serialised body must contain no trace of org-a state.
    assert "sched-a" not in events_b.text
    assert "org-a" not in events_b.text


def test_cross_tenant_select_baseline_is_rejected(
    shared_repos, org_a_session, org_b_session
) -> None:
    """org-B knows org-A's schedule id and tries to publish it.

    The use case must reject this with a validation error AND not
    mutate the target schedule's lifecycle (no silent promotion).
    """
    _save_schedule(
        shared_repos["schedules"],
        schedule_id="sched-a",
        organization_id="org-a",
    )

    response = org_b_session.post(
        "/planning/baseline/select",
        json={"schedule_id": "sched-a", "scenario_name": "Hostile takeover"},
    )

    assert response.status_code == 422
    metadata = shared_repos["schedules"].get_metadata("sched-a")
    assert metadata is not None
    assert metadata.lifecycle_status == "draft"
    assert metadata.scenario_name == "sched-a"
    assert metadata.organization_id == "org-a"
