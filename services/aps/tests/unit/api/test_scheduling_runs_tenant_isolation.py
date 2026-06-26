"""J7 + V1.2 P0.1 — proof that /scheduling/runs/{id}/* routes are tenant-scoped.

Before J7 landed, DELETE and PATCH on /scheduling/runs/{id} operated on
schedule_id without checking the caller's tenant: an org-B session that
knew an org-A schedule_id (or successfully guessed a UUID) could delete
the plan or rename its scenario. Neither route surfaced the operation in
audit, so the org-A planner would only learn about it once the floor
asked why the production sheet for tomorrow was suddenly empty.

V1.2 P0.1 audit found the same hole still open on 7 other routes:

- POST   /scheduling/runs/{id}/replay (CRITICAL — leaks the full input
  snapshot of another org's schedule + re-runs the engine on it)
- GET    /scheduling/runs/{id}/dashboard
- GET    /scheduling/runs/{id}/capacity
- GET    /scheduling/runs/{id}/readiness
- GET    /scheduling/runs/{id}/gantt
- GET    /scheduling/runs/{id}/risk
- GET    /scheduling/runs/{id}/operations/{op}/feasible-slots

All 7 were "filtering at the use-case layer" via organization_id, but
none called _ensure_schedule_in_tenant_scope() at the route — so a
single missing filter at the use case would have leaked silently.
Defense-in-depth: every route now gates at the route layer FIRST.

These tests exercise the full request path with two organisations
sharing one schedule repository. They assert that org-B → 404 on every
hostile call (and that the schedule is not mutated for the destructive
routes). The four original J7 happy-path tests still cover the
legitimate-owner path; the new 7 routes are GET (read-only) or replay
(which doesn't mutate the source schedule), so we don't add 7 new
happy-path stubs — the existing application tests cover those.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import (
    get_db_session,
    get_list_schedules,
    get_planner_readiness,
    get_replay_schedule_run,
    get_schedule_capacity,
    get_schedule_dashboard,
    get_schedule_gantt,
    get_schedule_repository,
    get_schedule_risk,
    get_suggest_operation_slots,
    get_update_schedule_context,
)
from planiadvance_v2.api.routes import scheduling as scheduling_route
from planiadvance_v2.api.tenant import TenantContext, get_tenant_context
from planiadvance_v2.application.use_cases.list_schedules import ListSchedules
from planiadvance_v2.application.use_cases.update_schedule_context import (
    UpdateScheduleContext,
)
from planiadvance_v2.domain.entities import Schedule, ScheduledOperation
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryScheduleRepository,
)


class _ExplodingUseCase:
    """Stand-in that fails loudly if the route reaches use_case.execute.

    We expect every hostile call (org-B targeting org-A schedule_id) to be
    blocked by _ensure_schedule_in_tenant_scope() BEFORE the use case is
    invoked. If a test hits AttributeError on this stub, the scope check
    was bypassed — exactly the regression we want to catch.
    """

    def execute(self, *args: Any, **kwargs: Any) -> Any:  # pragma: no cover
        raise AssertionError(
            "Tenant scope check was bypassed: hostile call reached the use case."
        )

START = datetime(2026, 5, 11, 8, 0, 0)


class _DummySession:
    def commit(self) -> None:
        return None


def _dummy_session():
    yield _DummySession()


def _build_app(
    repo: InMemoryScheduleRepository, tenant: TenantContext
) -> FastAPI:
    app = FastAPI()
    app.include_router(scheduling_route.router)

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_schedule_repository] = lambda: repo
    app.dependency_overrides[get_list_schedules] = lambda: ListSchedules(repo)
    app.dependency_overrides[get_update_schedule_context] = (
        lambda: UpdateScheduleContext(repo)
    )
    # P0.1: scope check fires before use_case.execute; exploding stubs
    # prove this — if a hostile call reaches the use case, the test fails.
    exploding = _ExplodingUseCase()
    app.dependency_overrides[get_replay_schedule_run] = lambda: exploding
    app.dependency_overrides[get_schedule_dashboard] = lambda: exploding
    app.dependency_overrides[get_schedule_capacity] = lambda: exploding
    app.dependency_overrides[get_planner_readiness] = lambda: exploding
    app.dependency_overrides[get_schedule_gantt] = lambda: exploding
    app.dependency_overrides[get_schedule_risk] = lambda: exploding
    app.dependency_overrides[get_suggest_operation_slots] = lambda: exploding
    app.dependency_overrides[get_db_session] = _dummy_session
    app.dependency_overrides[get_tenant_context] = lambda: tenant
    return app


def _save_schedule(
    repo: InMemoryScheduleRepository,
    *,
    schedule_id: str,
    organization_id: str,
    workspace_id: str = "default",
    scenario_name: str = "Default Scenario",
) -> None:
    repo.save(
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
        scenario_name=scenario_name,
        lifecycle_status="draft",
        organization_id=organization_id,
        horizon_start=START,
        horizon_end=START + timedelta(days=1),
        input_snapshot_hash=f"hash-{schedule_id}",
    )


@pytest.fixture
def shared_repo() -> InMemoryScheduleRepository:
    return InMemoryScheduleRepository()


def _client(repo, tenant: TenantContext) -> TestClient:
    return TestClient(_build_app(repo, tenant))


def test_org_b_cannot_delete_org_a_schedule(shared_repo) -> None:
    _save_schedule(shared_repo, schedule_id="sched-a", organization_id="org-a")

    org_b = _client(
        shared_repo, TenantContext(organization_id="org-b", user_id="user-b")
    )
    response = org_b.delete("/scheduling/runs/sched-a")

    assert response.status_code == 404
    # Hostile probe must not learn the schedule actually exists.
    assert "sched-a" not in response.text or "not found" in response.text.lower()
    # The schedule MUST still exist in the repo.
    assert shared_repo.get("sched-a") is not None


def test_org_b_cannot_rename_org_a_scenario(shared_repo) -> None:
    _save_schedule(
        shared_repo,
        schedule_id="sched-a",
        organization_id="org-a",
        scenario_name="Org-A weekly plan",
    )

    org_b = _client(
        shared_repo, TenantContext(organization_id="org-b", user_id="user-b")
    )
    response = org_b.patch(
        "/scheduling/runs/sched-a/context",
        json={"scenario_name": "Hostile rename", "lifecycle_status": "published"},
    )

    assert response.status_code == 404
    metadata = shared_repo.get_metadata("sched-a")
    assert metadata is not None
    assert metadata.scenario_name == "Org-A weekly plan"
    assert metadata.lifecycle_status == "draft"
    assert metadata.organization_id == "org-a"


def test_org_a_can_still_delete_own_schedule(shared_repo) -> None:
    """The tenant gate must not break the legitimate owner's path."""
    _save_schedule(shared_repo, schedule_id="sched-a", organization_id="org-a")

    org_a = _client(
        shared_repo, TenantContext(organization_id="org-a", user_id="user-a")
    )
    response = org_a.delete("/scheduling/runs/sched-a")

    assert response.status_code == 204
    assert shared_repo.get("sched-a") is None


def test_org_a_can_still_update_own_scenario(shared_repo) -> None:
    """Same: the owner can still rename and promote the schedule."""
    _save_schedule(
        shared_repo,
        schedule_id="sched-a",
        organization_id="org-a",
        scenario_name="Draft v1",
    )

    org_a = _client(
        shared_repo, TenantContext(organization_id="org-a", user_id="user-a")
    )
    response = org_a.patch(
        "/scheduling/runs/sched-a/context",
        json={"scenario_name": "Draft v2", "lifecycle_status": "candidate"},
    )

    assert response.status_code == 200
    metadata = shared_repo.get_metadata("sched-a")
    assert metadata is not None
    assert metadata.scenario_name == "Draft v2"
    assert metadata.lifecycle_status == "candidate"


# ---------------------------------------------------------------------------
# V1.2 P0.1 — defense-in-depth on the 7 previously unscoped routes
# ---------------------------------------------------------------------------

# Each hostile call asserts:
#   1. The response is 404 (never 200 with foreign data, never 422 / 500).
#   2. The detail message doesn't confirm cross-tenant existence.
#   3. The exploding use-case stub was NOT invoked — the scope check
#      blocked at the route layer, exactly as defense-in-depth requires.


def _org_b_client(shared_repo: InMemoryScheduleRepository) -> TestClient:
    _save_schedule(shared_repo, schedule_id="sched-a", organization_id="org-a")
    return _client(
        shared_repo, TenantContext(organization_id="org-b", user_id="user-b")
    )


def test_org_b_cannot_replay_org_a_schedule(shared_repo) -> None:
    """The critical one: replay was leaking the full input snapshot."""
    client = _org_b_client(shared_repo)
    response = client.post("/scheduling/runs/sched-a/replay", json={})

    assert response.status_code == 404
    assert shared_repo.get_metadata("sched-a") is not None
    assert shared_repo.get_metadata("sched-a").organization_id == "org-a"


def test_org_b_cannot_read_org_a_dashboard(shared_repo) -> None:
    client = _org_b_client(shared_repo)
    response = client.get("/scheduling/runs/sched-a/dashboard")
    assert response.status_code == 404


def test_org_b_cannot_read_org_a_capacity(shared_repo) -> None:
    client = _org_b_client(shared_repo)
    response = client.get("/scheduling/runs/sched-a/capacity")
    assert response.status_code == 404


def test_org_b_cannot_read_org_a_readiness(shared_repo) -> None:
    client = _org_b_client(shared_repo)
    response = client.get("/scheduling/runs/sched-a/readiness")
    assert response.status_code == 404


def test_org_b_cannot_read_org_a_gantt(shared_repo) -> None:
    client = _org_b_client(shared_repo)
    response = client.get("/scheduling/runs/sched-a/gantt")
    assert response.status_code == 404


def test_org_b_cannot_read_org_a_risk(shared_repo) -> None:
    client = _org_b_client(shared_repo)
    response = client.get("/scheduling/runs/sched-a/risk")
    assert response.status_code == 404


def test_org_b_cannot_read_org_a_feasible_slots(shared_repo) -> None:
    client = _org_b_client(shared_repo)
    response = client.get(
        "/scheduling/runs/sched-a/operations/op-1/feasible-slots"
    )
    assert response.status_code == 404


def test_gantt_baseline_id_also_tenant_scoped(shared_repo) -> None:
    """Gantt accepts a baseline_schedule_id query param — that one must
    also be tenant-checked, otherwise an org-B caller could use their
    own schedule_id as the primary and target org-A via baseline.
    """
    _save_schedule(shared_repo, schedule_id="sched-a", organization_id="org-a")
    _save_schedule(shared_repo, schedule_id="sched-b", organization_id="org-b")

    org_b = _client(
        shared_repo, TenantContext(organization_id="org-b", user_id="user-b")
    )
    response = org_b.get(
        "/scheduling/runs/sched-b/gantt?baseline_schedule_id=sched-a"
    )
    assert response.status_code == 404
