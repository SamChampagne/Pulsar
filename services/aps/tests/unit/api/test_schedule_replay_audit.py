"""V1.2 — audit-event coverage on POST /scheduling/runs/{id}/replay.

P0.1 hardened the route's tenant scope so cross-tenant replays
return 404. This complements it with the *audit* half of the story:
every legit replay is recorded in the append-only audit log so a
planner (or a security review) can trace who re-ran a schedule and
when. The audit was completely absent before this slice — a
legitimate replay went un-recorded, and the V1.2 security audit
flagged that as 'audit blindness' on the highest-leak surface
(replay returns the input snapshot + re-executes the engine).

These tests use the same exploding-use-case pattern as the tenant
isolation suite to guarantee the test only proves audit coverage
on a happy path (legit replay).
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import (
    get_audit_event_repository,
    get_db_session,
    get_replay_schedule_run,
    get_schedule_repository,
)
from planiadvance_v2.api.routes import scheduling as scheduling_route
from planiadvance_v2.api.tenant import TenantContext, get_tenant_context
from planiadvance_v2.domain.entities import Schedule, ScheduledOperation
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryAuditEventRepository,
    InMemoryScheduleRepository,
)

START = datetime(2026, 5, 11, 8, 0, 0)


class _DummySession:
    def commit(self) -> None:
        return None


def _dummy_session():
    yield _DummySession()


class _StubReplayUseCase:
    """Minimal replay result so the route can serialize a response.

    We don't exercise the engine here — the audit-event assertion
    is about the route-layer side effect, not the replay semantics.
    """

    def execute(self, command: Any) -> Any:
        schedule = Schedule(
            id="sched-replayed",
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
        )
        return SimpleNamespace(
            original_schedule_id=command.schedule_id,
            input_snapshot_hash="hash-replay",
            replay_matches_original=True,
            hash_matches=True,
            strategy_matches=True,
            objective_matches=True,
            assignment_delta=[],
            metrics_delta={},
            divergence_reasons=[],
            replay_report={"verdict": "match"},
            replay=SimpleNamespace(
                schedule=schedule,
                organization_id="org-a",
                horizon_start=START,
                horizon_end=START + timedelta(days=1),
                engine_version="test",
                strategy="greedy",
                solver_status="feasible",
                objective_value=0,
                wall_time_ms=1,
                metrics={},
                # The route's `_build_summary_out / _build_analysis_out /
                # _build_feasibility_out` helpers all call `.as_dict()`
                # on these objects — duck-typing with SimpleNamespace +
                # a no-op as_dict keeps the response serializer happy
                # without dragging the real ResultSummary etc. dataclass
                # tree into this test.
                summary=SimpleNamespace(as_dict=lambda: {}),
                analysis=SimpleNamespace(as_dict=lambda: {}),
                feasibility=SimpleNamespace(as_dict=lambda: {}),
                diagnostics={},
            ),
        )


def _seed_schedule(
    repo: InMemoryScheduleRepository,
    *,
    schedule_id: str = "sched-a",
    organization_id: str = "org-a",
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
        workspace_id="default",
        scenario_name="Default Scenario",
        lifecycle_status="draft",
        organization_id=organization_id,
        horizon_start=START,
        horizon_end=START + timedelta(days=1),
        input_snapshot_hash=f"hash-{schedule_id}",
    )


def _build_app(
    repo: InMemoryScheduleRepository,
    audit_repo: InMemoryAuditEventRepository,
    tenant: TenantContext,
) -> FastAPI:
    app = FastAPI()
    app.include_router(scheduling_route.router)

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_schedule_repository] = lambda: repo
    app.dependency_overrides[get_replay_schedule_run] = lambda: _StubReplayUseCase()
    app.dependency_overrides[get_audit_event_repository] = lambda: audit_repo
    app.dependency_overrides[get_db_session] = _dummy_session
    app.dependency_overrides[get_tenant_context] = lambda: tenant
    return app


@pytest.fixture
def shared_repo() -> InMemoryScheduleRepository:
    return InMemoryScheduleRepository()


@pytest.fixture
def audit_repo() -> InMemoryAuditEventRepository:
    return InMemoryAuditEventRepository()


def test_replay_records_audit_event_with_actor_and_target(
    shared_repo: InMemoryScheduleRepository,
    audit_repo: InMemoryAuditEventRepository,
) -> None:
    _seed_schedule(shared_repo, schedule_id="sched-a", organization_id="org-a")
    # raise_server_exceptions=False so a serializer 500 from our
    # minimal stub becomes a Response(500), not a Python exception
    # — keeps the audit-side-effect assertion isolated from
    # response-shape plumbing.
    client = TestClient(
        _build_app(
            shared_repo,
            audit_repo,
            TenantContext(organization_id="org-a", user_id="user-a", role="owner"),
        ),
        raise_server_exceptions=False,
    )

    # Audit is recorded BEFORE the use case + serializer run, so it
    # lands even when the response itself fails to serialize (e.g.
    # this test's minimal stub objects don't match the response
    # schema). We assert the audit side-effect specifically; a
    # full-response integration test lives elsewhere.
    client.post("/scheduling/runs/sched-a/replay", json={})

    events = audit_repo.list_recent(limit=10)
    replay_events = [e for e in events if e.action == "schedule.replay"]
    assert len(replay_events) == 1
    event = replay_events[0]
    assert event.organization_id == "org-a"
    assert event.user_id == "user-a"
    assert event.subject == "sched-a"
    assert event.status == "ok"


def test_replay_audit_records_strategy_override_in_details(
    shared_repo: InMemoryScheduleRepository,
    audit_repo: InMemoryAuditEventRepository,
) -> None:
    """The strategy override is the only piece of caller intent the
    audit needs to capture — input snapshot + assignments are
    deterministic from the schedule_id and don't add audit value."""

    _seed_schedule(shared_repo, schedule_id="sched-a", organization_id="org-a")
    # raise_server_exceptions=False so a serializer 500 from our
    # minimal stub becomes a Response(500), not a Python exception
    # — keeps the audit-side-effect assertion isolated from
    # response-shape plumbing.
    client = TestClient(
        _build_app(
            shared_repo,
            audit_repo,
            TenantContext(organization_id="org-a", user_id="user-a", role="owner"),
        ),
        raise_server_exceptions=False,
    )

    client.post("/scheduling/runs/sched-a/replay", json={"strategy": "backward"})

    events = audit_repo.list_recent(limit=10)
    replay_events = [e for e in events if e.action == "schedule.replay"]
    assert len(replay_events) == 1
    assert replay_events[0].details.get("strategy_override") == "backward"


def test_cross_tenant_replay_does_not_create_an_audit_event(
    shared_repo: InMemoryScheduleRepository,
    audit_repo: InMemoryAuditEventRepository,
) -> None:
    """The P0.1 scope gate returns 404 BEFORE the audit-write code
    runs, so a hostile probe doesn't leave a trail in the victim's
    org audit log. (The victim's planner wouldn't see the breach in
    audit anyway, but a stranger's id appearing as actor on an
    audit event would be its own confusion.)"""

    _seed_schedule(shared_repo, schedule_id="sched-a", organization_id="org-a")
    # raise_server_exceptions=False so a serializer 500 from our
    # minimal stub becomes a Response(500), not a Python exception
    # — keeps the audit-side-effect assertion isolated from
    # response-shape plumbing.
    client = TestClient(
        _build_app(
            shared_repo,
            audit_repo,
            TenantContext(organization_id="org-b", user_id="user-b", role="owner"),
        )
    )

    response = client.post("/scheduling/runs/sched-a/replay", json={})

    assert response.status_code == 404
    events = audit_repo.list_recent(limit=10)
    assert [e for e in events if e.action == "schedule.replay"] == []
