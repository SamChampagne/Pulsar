from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, time, timedelta

import pytest
from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import (
    get_compare_strategies,
    get_list_schedules,
    get_run_disruption,
    get_run_scheduling,
    get_schedule_dashboard,
)
from planiadvance_v2.api.main import create_app
from planiadvance_v2.application.use_cases.compare_strategies import CompareStrategies
from planiadvance_v2.application.use_cases.get_schedule_dashboard import (
    GetScheduleDashboard,
)
from planiadvance_v2.application.use_cases.list_schedules import ListSchedules
from planiadvance_v2.application.use_cases.run_disruption import RunDisruption
from planiadvance_v2.application.use_cases.run_scheduling import RunScheduling
from planiadvance_v2.domain.entities import Machine, Operation, WorkingCalendar, WorkOrder
from planiadvance_v2.domain.value_objects import Duration, Priority, Shift
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryCalendarRepository,
    InMemoryMachineRepository,
    InMemoryResourceRepository,
    InMemoryScheduleRepository,
    InMemoryWorkOrderRepository,
)

MONDAY = datetime(2026, 1, 5, 0, 0, 0)


def _calendar() -> WorkingCalendar:
    return WorkingCalendar(
        id="CAL",
        name="Mon-Fri 08-17",
        shifts=[Shift(weekday=w, start=time(8, 0), end=time(17, 0)) for w in range(5)],
    )


def _machines() -> list[Machine]:
    return [
        Machine(id="M1", name="M1", calendar_id="CAL"),
        Machine(id="M2", name="M2", calendar_id="CAL"),
    ]


@pytest.fixture
def api():
    work_orders = InMemoryWorkOrderRepository()
    machines = InMemoryMachineRepository(_machines())
    calendars = InMemoryCalendarRepository([_calendar()])
    resources = InMemoryResourceRepository([])
    schedules = InMemoryScheduleRepository()

    app = create_app()

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_run_scheduling] = lambda: RunScheduling(
        work_orders=work_orders,
        machines=machines,
        calendars=calendars,
        resources=resources,
        schedules=schedules,
    )
    app.dependency_overrides[get_compare_strategies] = lambda: CompareStrategies(
        work_orders=work_orders,
        machines=machines,
        calendars=calendars,
        resources=resources,
    )
    app.dependency_overrides[get_run_disruption] = lambda: RunDisruption(
        work_orders=work_orders,
        machines=machines,
        calendars=calendars,
        resources=resources,
        schedules=schedules,
    )
    app.dependency_overrides[get_list_schedules] = lambda: ListSchedules(schedules)
    app.dependency_overrides[get_schedule_dashboard] = lambda: GetScheduleDashboard(
        schedules=schedules,
        work_orders=work_orders,
    )

    with TestClient(app) as client:
        yield {"client": client, "app": app, "work_orders": work_orders}

    app.dependency_overrides.clear()


def _add_base_work_order(repo: InMemoryWorkOrderRepository) -> None:
    repo.add(
        WorkOrder(
            id="WO1",
            name="WO1",
            product_id="P1",
            quantity=1,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            priority=Priority.NORMAL,
            operations=[
                Operation(
                    id="OP1",
                    work_order_id="WO1",
                    sequence=1,
                    name="OP1",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                )
            ],
        )
    )


class TestApiProductReadiness:
    def test_unknown_transfer_machine_returns_422_with_structured_error(self, api):
        _add_base_work_order(api["work_orders"])

        response = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": False,
                "transfer_times": {
                    "pairs": [
                        {
                            "from_machine": "UNKNOWN-MACHINE",
                            "to_machine": "M2",
                            "minutes": 15,
                        }
                    ]
                },
            },
        )

        assert response.status_code == 422
        data = response.json()
        assert data["error"] == "invalid_reference"
        assert "UNKNOWN-MACHINE" in data["message"]

    def test_invalid_payload_returns_request_validation_details(self, api):
        response = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 0,
                "strategy": "greedy",
            },
        )

        assert response.status_code == 422
        data = response.json()
        assert data["error"] == "request_validation_error"
        assert data["message"] == "Request payload validation failed."
        assert any(detail["loc"][-1] == "horizon_days" for detail in data["details"])

    def test_missing_dashboard_run_uses_normalized_not_found_shape(self, api):
        response = api["client"].get("/scheduling/runs/unknown-run/dashboard")

        assert response.status_code == 404
        data = response.json()
        assert data["error"] == "not_found"
        assert "unknown-run" in data["message"]

    def test_openapi_exposes_real_examples_for_planner_routes(self, api):
        schema = api["app"].openapi()

        run_examples = (
            schema["paths"]["/scheduling/run"]["post"]["requestBody"]["content"][
                "application/json"
            ]["examples"]
        )
        compare_examples = (
            schema["paths"]["/scheduling/compare"]["post"]["requestBody"]["content"][
                "application/json"
            ]["examples"]
        )
        disruption_examples = (
            schema["paths"]["/scheduling/disruption"]["post"]["requestBody"]["content"][
                "application/json"
            ]["examples"]
        )

        assert "baselineGreedyRun" in run_examples
        assert (
            run_examples["baselineGreedyRun"]["value"]["transfer_times"]["pairs"][0][
                "from_machine"
            ]
            == "CUT-1"
        )
        assert "operationalVsStrategic" in compare_examples
        assert compare_examples["operationalVsStrategic"]["value"]["strategies"] == [
            "greedy",
            "backward",
            "cpsat",
        ]
        assert "machineDown" in disruption_examples
        assert disruption_examples["machineDown"]["value"]["event"]["machine_id"] == "ASM-1"
