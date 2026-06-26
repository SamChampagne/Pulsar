from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, time, timedelta

from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import (
    get_db_session,
    get_schedule_capacity,
    get_schedule_repository,
)
from planiadvance_v2.api.main import create_app
from planiadvance_v2.application.use_cases.get_schedule_capacity import (
    GetScheduleCapacity,
)
from planiadvance_v2.domain.entities import (
    Machine,
    Schedule,
    ScheduledOperation,
    WorkingCalendar,
)
from planiadvance_v2.domain.value_objects import Shift
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryCalendarRepository,
    InMemoryMachineRepository,
    InMemoryScheduleRepository,
)

MONDAY = datetime(2026, 1, 5, 0, 0, 0)


def test_schedule_capacity_endpoint_returns_engine_capacity_contract():
    schedules = InMemoryScheduleRepository()
    machines = InMemoryMachineRepository(
        [Machine(id="M1", name="Cut", calendar_id="CAL")]
    )
    calendars = InMemoryCalendarRepository(
        [
            WorkingCalendar(
                id="CAL",
                name="Day shift",
                shifts=[Shift(weekday=0, start=time(8, 0), end=time(17, 0))],
            )
        ]
    )
    schedule = Schedule(
        id="RUN-CAP",
        created_at=MONDAY,
        assignments=[
            ScheduledOperation(
                operation_id="OP-1",
                work_order_id="WO-1",
                machine_id="M1",
                setup_start=MONDAY.replace(hour=8),
                start=MONDAY.replace(hour=8, minute=30),
                end=MONDAY.replace(hour=10),
            )
        ],
    )
    schedules.save(
        schedule,
        metrics={},
        workspace_id="WS-1",
        scenario_name="Baseline",
        lifecycle_status="baseline",
        horizon_start=MONDAY,
        horizon_end=MONDAY + timedelta(days=1),
    )

    app = create_app()

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    class _DummySession:
        def commit(self):
            return None

    def _dummy_session():
        yield _DummySession()

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_schedule_capacity] = lambda: GetScheduleCapacity(
        schedules=schedules,
        machines=machines,
        calendars=calendars,
    )
    # V1.2 P0.1: capacity route now scope-checks via _ensure_schedule_in_tenant_scope
    # before invoking the use case, so the test must hand it the same repo.
    app.dependency_overrides[get_schedule_repository] = lambda: schedules
    app.dependency_overrides[get_db_session] = _dummy_session

    with TestClient(app) as client:
        response = client.get("/scheduling/runs/RUN-CAP/capacity?bucket=day")

    assert response.status_code == 200
    data = response.json()
    assert data["contract_version"] == "machine-capacity-ledger-v1"
    assert data["workspace_id"] == "WS-1"
    assert data["total_capacity_minutes"] == 540
    assert data["total_scheduled_load_minutes"] == 120
    assert data["bottleneck_machine_id"] == "M1"
    assert data["buckets"][0]["setup_minutes"] == 30
    assert data["buckets"][0]["run_minutes"] == 90
    assert data["buckets"][0]["pressure"] == "normal"
