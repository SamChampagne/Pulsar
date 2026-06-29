"""HTTP proof tests for the scheduling API.

These tests close the loop from request payloads to route responses using
the real FastAPI app with dependency overrides. They intentionally keep the
repositories in memory so the assertions stay focused on API wiring and
business behaviour rather than SQL plumbing.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import UTC, datetime, time, timedelta

import pytest
from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import (
    get_capable_to_promise,
    get_compare_scenarios,
    get_compare_strategies,
    get_db_session,
    get_list_schedules,
    get_planner_readiness,
    get_planning_control_plane,
    get_publish_scenario,
    get_replay_schedule_run,
    get_run_disruption,
    get_run_scheduling,
    get_schedule_dashboard,
    get_schedule_gantt,
    get_schedule_repository,
    get_schedule_risk,
    get_suggest_operation_slots,
    get_update_schedule_context,
)
from planiadvance_v2.api.main import create_app
from planiadvance_v2.application.use_cases.capable_to_promise import CapableToPromise
from planiadvance_v2.application.use_cases.compare_scenarios import CompareScenarios
from planiadvance_v2.application.use_cases.compare_strategies import CompareStrategies
from planiadvance_v2.application.use_cases.get_schedule_dashboard import (
    GetScheduleDashboard,
)
from planiadvance_v2.application.use_cases.get_schedule_gantt import GetScheduleGantt
from planiadvance_v2.application.use_cases.get_schedule_risk import GetScheduleRisk
from planiadvance_v2.application.use_cases.list_schedules import ListSchedules
from planiadvance_v2.application.use_cases.planner_readiness import GetPlannerReadiness
from planiadvance_v2.application.use_cases.planning_control import PlanningControlPlane
from planiadvance_v2.application.use_cases.publish_scenario import PublishScenario
from planiadvance_v2.application.use_cases.replay_schedule_run import ReplayScheduleRun
from planiadvance_v2.application.use_cases.run_disruption import RunDisruption
from planiadvance_v2.application.use_cases.run_scheduling import RunScheduling
from planiadvance_v2.application.use_cases.suggest_operation_slots import (
    SuggestOperationSlots,
)
from planiadvance_v2.application.use_cases.update_schedule_context import (
    UpdateScheduleContext,
)
from planiadvance_v2.domain.entities import (
    InventoryItem,
    Machine,
    Operation,
    Resource,
    Schedule,
    ScheduledOperation,
    SupplyLot,
    WorkingCalendar,
    WorkOrder,
)
from planiadvance_v2.domain.entities.material import MaterialRequirement
from planiadvance_v2.domain.entities.operation import DependencyLink, DependencyType
from planiadvance_v2.domain.entities.resource import ResourceRequirement
from planiadvance_v2.domain.value_objects import (
    Duration,
    OperationStatus,
    Priority,
    Shift,
    TimeWindow,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryCalendarRepository,
    InMemoryInventoryRepository,
    InMemoryMachineRepository,
    InMemoryPlanningControlRepository,
    InMemoryResourceRepository,
    InMemoryScheduleRepository,
    InMemorySupplyRepository,
    InMemoryWorkOrderRepository,
)
from tests.support.reference_scenarios import (
    build_reference_workshop,
    build_stressed_reference_workshop,
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
    inventory = InMemoryInventoryRepository([])
    supplies = InMemorySupplyRepository([])
    schedules = InMemoryScheduleRepository()
    planning = InMemoryPlanningControlRepository()
    class _DummySession:
        def commit(self):
            return None

    def _dummy_session():
        yield _DummySession()

    app = create_app()
    # These tests prove HTTP wiring with in-memory repos; they do not need
    # the real DB startup hook from the production lifespan.
    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_run_scheduling] = lambda: RunScheduling(
        work_orders=work_orders,
        machines=machines,
        calendars=calendars,
        resources=resources,
        inventory=inventory,
        supplies=supplies,
        schedules=schedules,
    )
    app.dependency_overrides[get_compare_strategies] = lambda: CompareStrategies(
        work_orders=work_orders,
        machines=machines,
        calendars=calendars,
        resources=resources,
        inventory=inventory,
        supplies=supplies,
        schedules=schedules,
    )
    app.dependency_overrides[get_compare_scenarios] = lambda: CompareScenarios(
        schedules
    )
    app.dependency_overrides[get_publish_scenario] = lambda: PublishScenario(
        schedules
    )
    app.dependency_overrides[get_planning_control_plane] = lambda: PlanningControlPlane(
        schedules=schedules,
        planning=planning,
    )
    app.dependency_overrides[get_planner_readiness] = lambda: GetPlannerReadiness(
        schedules
    )
    app.dependency_overrides[get_capable_to_promise] = lambda: CapableToPromise(
        work_orders=work_orders,
        machines=machines,
        calendars=calendars,
        resources=resources,
        inventory=inventory,
        supplies=supplies,
    )
    app.dependency_overrides[get_run_disruption] = lambda: RunDisruption(
        work_orders=work_orders,
        machines=machines,
        calendars=calendars,
        schedules=schedules,
        resources=resources,
        inventory=inventory,
        supplies=supplies,
    )
    app.dependency_overrides[get_list_schedules] = lambda: ListSchedules(schedules)
    app.dependency_overrides[get_schedule_repository] = lambda: schedules
    app.dependency_overrides[get_update_schedule_context] = lambda: UpdateScheduleContext(
        schedules
    )
    app.dependency_overrides[get_schedule_dashboard] = lambda: GetScheduleDashboard(
        schedules=schedules,
        work_orders=work_orders,
    )
    app.dependency_overrides[get_schedule_gantt] = lambda: GetScheduleGantt(
        schedules=schedules,
        work_orders=work_orders,
        machines=machines,
    )
    app.dependency_overrides[get_schedule_risk] = lambda: GetScheduleRisk(
        GetScheduleGantt(
            schedules=schedules,
            work_orders=work_orders,
            machines=machines,
        )
    )
    app.dependency_overrides[get_suggest_operation_slots] = (
        lambda: SuggestOperationSlots(
            schedules=schedules,
            work_orders=work_orders,
            machines=machines,
            calendars=calendars,
            resources=resources,
            inventory=inventory,
            supplies=supplies,
        )
    )
    app.dependency_overrides[get_replay_schedule_run] = lambda: ReplayScheduleRun(
        schedules
    )
    app.dependency_overrides[get_db_session] = _dummy_session

    with TestClient(app) as client:
        yield {
            "client": client,
            "work_orders": work_orders,
            "machines": machines,
            "calendars": calendars,
            "resources": resources,
            "inventory": inventory,
            "supplies": supplies,
            "schedules": schedules,
            "planning": planning,
            "app": app,
        }

    app.dependency_overrides.clear()


def _add_transfer_work_order(repo: InMemoryWorkOrderRepository) -> None:
    repo.add(
        WorkOrder(
            id="WO1",
            name="WO1",
            product_id="P1",
            quantity=1,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="OP1",
                    work_order_id="WO1",
                    sequence=1,
                    name="OP1",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                ),
                Operation(
                    id="OP2",
                    work_order_id="WO1",
                    sequence=2,
                    name="OP2",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M2"],
                    dependencies=["OP1"],
                ),
            ],
        )
    )


def _seed_workshop(api, workshop) -> None:
    for calendar in workshop.calendars:
        api["calendars"].add(calendar)
    for machine in workshop.machines:
        api["machines"].add(machine)
    for resource in workshop.resources:
        api["resources"].add(resource)
    for work_order in workshop.work_orders:
        api["work_orders"].add(work_order)


class TestSchedulingHttpProofs:
    def test_strategy_capabilities_contract_feeds_ui(self, api):
        response = api["client"].get("/scheduling/strategies")

        assert response.status_code == 200
        data = response.json()
        assert data["version"] == "strategy-capabilities-v1"
        assert data["default_strategy"] == "auto"
        strategies = {item["name"]: item for item in data["strategies"]}
        assert strategies["auto"]["kind"] == "decision_layer"
        assert strategies["auto"]["default_for_baseline"] is True
        assert "baseline" in strategies["auto"]["ui_groups"]
        assert strategies["greedy"]["available"] is True
        assert "baseline" in strategies["greedy"]["ui_groups"]
        assert strategies["backward"]["supports_frozen_assignments"] is True
        assert strategies["cpsat"]["maturity"] == "specialized"
        assert isinstance(strategies["cpsat"]["available"], bool)

    def test_replay_route_uses_persisted_run_snapshot(self, api):
        _add_transfer_work_order(api["work_orders"])
        run = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert run.status_code == 200
        run_data = run.json()
        assert run_data["input_snapshot_hash"]

        replay = api["client"].post(
            f"/scheduling/runs/{run_data['schedule_id']}/replay",
            json={},
        )

        assert replay.status_code == 200
        replay_data = replay.json()
        assert replay_data["input_snapshot_hash"] == run_data["input_snapshot_hash"]
        assert replay_data["replay_matches_original"] is True
        assert replay_data["assignment_delta"]["changed_count"] == 0

    def test_ctp_route_returns_infinite_capacity_promise_date(self, api):
        response = api["client"].post(
            "/scheduling/ctp",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "infinite",
                "candidate_order": {
                    "id": "WO-CTP",
                    "name": "WO-CTP",
                    "product_id": "P-CTP",
                    "quantity": 1,
                    "due_date": (MONDAY + timedelta(days=1)).isoformat(),
                    "release_date": MONDAY.isoformat(),
                    "priority": 2,
                    "operations": [
                        {
                            "id": "CTP-OP",
                            "sequence": 1,
                            "name": "CTP-OP",
                            "duration_minutes": 60,
                            "eligible_machine_ids": ["M1"],
                        }
                    ],
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["feasible"] is True
        assert data["strategy"] == "infinite"
        assert data["solver_status"] == "rough_cut_feasible"
        assert data["promise_delta_minutes"] <= 0
        assert data["assignments"][0]["operation_id"] == "CTP-OP"
        assert data["recommendation"] == "promise"
        assert data["insertion_impact"]["candidate_operation_count"] == 1
        assert data["insertion_impact"]["candidate_assignments"][0]["operation_id"] == "CTP-OP"
        assert data["insertion_impact"]["moved_existing_operation_count"] == 0
        assert data["insertion_impact"]["existing_work_order_impacts"] == []
        assert data["insertion_impact"]["rough_cut_overlap_count"] == 0
        assert data["diagnostics"]["recommended_mode"] == "promise"
        assert data["rough_cut_capacity"][0]["capacity_minutes"] == 540
        assert data["planner_explanation"]["risk_level"] == "low"
        assert data["planner_explanation"]["primary_reason"] == "date_feasible"
        assert data["diagnostics"]["planner_explanation"] == data["planner_explanation"]

    def test_ctp_route_exposes_available_quantity_by_requested_dates(self, api):
        response = api["client"].post(
            "/scheduling/ctp",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "infinite",
                "promise_dates": [
                    (MONDAY + timedelta(hours=8, minutes=30)).isoformat(),
                    (MONDAY + timedelta(hours=9)).isoformat(),
                ],
                "candidate_order": {
                    "id": "WO-CTP-QTY",
                    "name": "WO-CTP-QTY",
                    "product_id": "P-CTP",
                    "quantity": 10,
                    "due_date": (MONDAY + timedelta(days=1)).isoformat(),
                    "release_date": MONDAY.isoformat(),
                    "priority": 2,
                    "operations": [
                        {
                            "id": "CTP-QTY-OP",
                            "sequence": 1,
                            "name": "CTP-QTY-OP",
                            "duration_minutes": 60,
                            "eligible_machine_ids": ["M1"],
                        }
                    ],
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        availability = {
            row["date"]: row for row in data["available_quantity_by_date"]
        }
        early = availability[(MONDAY + timedelta(hours=8, minutes=30)).isoformat()]
        on_completion = availability[(MONDAY + timedelta(hours=9)).isoformat()]
        assert early["available_quantity"] == 0
        assert early["short_quantity"] == 10
        assert early["is_full_quantity_available"] is False
        assert on_completion["available_quantity"] == 10
        assert on_completion["short_quantity"] == 0
        assert on_completion["is_full_quantity_available"] is True
        assert on_completion["mode"] == "all_or_none"
        assert data["diagnostics"]["available_quantity_by_date"][0]["mode"] == "all_or_none"

    def test_ctp_route_explains_negotiated_date_when_candidate_is_late(self, api):
        response = api["client"].post(
            "/scheduling/ctp",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "infinite",
                "candidate_order": {
                    "id": "WO-CTP-LATE",
                    "name": "WO-CTP-LATE",
                    "product_id": "P-CTP",
                    "quantity": 2,
                    "due_date": (MONDAY + timedelta(hours=8, minutes=30)).isoformat(),
                    "release_date": MONDAY.isoformat(),
                    "priority": 1,
                    "operations": [
                        {
                            "id": "CTP-LATE-OP",
                            "sequence": 1,
                            "name": "CTP-LATE-OP",
                            "duration_minutes": 90,
                            "eligible_machine_ids": ["M1"],
                        }
                    ],
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["recommendation"] == "negotiate_date"
        assert data["promise_delta_minutes"] == 60
        assert data["planner_explanation"]["risk_level"] == "high"
        assert data["planner_explanation"]["primary_reason"] == "projected_lateness"
        assert "Negotiate date" in data["planner_explanation"]["recommended_action"]
        due_bucket = next(
            row
            for row in data["available_quantity_by_date"]
            if row["date"] == (MONDAY + timedelta(hours=8, minutes=30)).isoformat()
        )
        assert due_bucket["available_quantity"] == 0
        assert due_bucket["short_quantity"] == 2

    def test_ctp_route_flags_finite_validation_when_rough_cut_overlaps(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-EXISTING",
                name="WO-EXISTING",
                product_id="P-EXISTING",
                quantity=1,
                due_date=MONDAY + timedelta(days=1),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="EXISTING-OP",
                        work_order_id="WO-EXISTING",
                        sequence=1,
                        name="EXISTING-OP",
                        duration=Duration(minutes=120),
                        eligible_machine_ids=["M1"],
                    )
                ],
            )
        )

        response = api["client"].post(
            "/scheduling/ctp",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "infinite",
                "candidate_order": {
                    "id": "WO-CTP-OVERLAP",
                    "name": "WO-CTP-OVERLAP",
                    "product_id": "P-CTP",
                    "quantity": 1,
                    "due_date": (MONDAY + timedelta(days=1)).isoformat(),
                    "release_date": MONDAY.isoformat(),
                    "priority": 2,
                    "operations": [
                        {
                            "id": "CTP-OVERLAP-OP",
                            "sequence": 1,
                            "name": "CTP-OVERLAP-OP",
                            "duration_minutes": 60,
                            "eligible_machine_ids": ["M1"],
                        }
                    ],
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["recommendation"] == "finite_validation_required"
        assert data["diagnostics"]["recommended_mode"] == "finite_validation_required"
        assert data["insertion_impact"]["rough_cut_overlap_count"] >= 1
        assert data["insertion_impact"]["machine_load_delta_minutes"]["M1"] == 60
        assert data["insertion_impact"]["impacted_machine_ids"] == ["M1"]
        assert data["insertion_impact"]["moved_existing_operation_count"] == 0
        capacity = next(
            row
            for row in data["rough_cut_capacity"]
            if row["machine_id"] == "M1" and row["date"] == MONDAY.date().isoformat()
        )
        assert capacity["capacity_minutes"] == 540
        assert capacity["baseline_load_minutes"] == 120
        assert capacity["new_load_minutes"] == 180
        assert capacity["candidate_load_minutes"] == 60
        assert capacity["load_delta_minutes"] == 60
        assert capacity["rough_utilization"] == 0.3333
        assert capacity["overlap_count"] == 1
        assert capacity["pressure"] == "normal"
        assert data["diagnostics"]["rough_cut_capacity"] == data["rough_cut_capacity"]
        explanation = data["planner_explanation"]
        assert explanation["risk_level"] == "medium"
        assert explanation["primary_reason"] == "rough_cut_overlap"
        assert explanation["capacity_hotspot"]["machine_id"] == "M1"
        assert "finite_validation=true" in explanation["recommended_action"]

    def test_ctp_route_can_run_finite_validation_after_rough_cut_overlap(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-EXISTING",
                name="WO-EXISTING",
                product_id="P-EXISTING",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="EXISTING-OP",
                        work_order_id="WO-EXISTING",
                        sequence=1,
                        name="EXISTING-OP",
                        duration=Duration(minutes=120),
                        eligible_machine_ids=["M1"],
                    )
                ],
            )
        )

        response = api["client"].post(
            "/scheduling/ctp",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "infinite",
                "finite_validation": True,
                "finite_strategy": "greedy",
                "candidate_order": {
                    "id": "WO-CTP-FINITE",
                    "name": "WO-CTP-FINITE",
                    "product_id": "P-CTP",
                    "quantity": 1,
                    "due_date": (MONDAY + timedelta(days=1)).isoformat(),
                    "release_date": MONDAY.isoformat(),
                    "priority": 2,
                    "operations": [
                        {
                            "id": "CTP-FINITE-OP",
                            "sequence": 1,
                            "name": "CTP-FINITE-OP",
                            "duration_minutes": 60,
                            "eligible_machine_ids": ["M1"],
                        }
                    ],
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["insertion_impact"]["rough_cut_overlap_count"] >= 1
        assert data["finite_validation"]["enabled"] is True
        assert data["finite_validation"]["strategy"] == "greedy"
        assert data["finite_validation"]["promise_delta_minutes"] <= 0
        finite_impact = data["finite_validation"]["insertion_impact"]
        assert finite_impact["moved_existing_operation_count"] == 1
        assert finite_impact["delayed_existing_operation_count"] == 1
        assert finite_impact["existing_work_order_impacts"][0]["work_order_id"] == "WO-EXISTING"
        assert (
            finite_impact["existing_operation_movements"][0]["operation_id"]
            == "EXISTING-OP"
        )
        assert finite_impact["existing_operation_movements"][0]["end_shift_minutes"] == 60
        assert data["recommendation"] == "promise"
        assert data["diagnostics"]["recommended_mode"] == "promise"
        assert data["planner_explanation"]["primary_reason"] == "capacity_validated"
        assert data["planner_explanation"]["risk_level"] == "medium"
        assert any(
            "Finite validation moves 1 existing operation" in note
            for note in data["planner_explanation"]["notes"]
        )

    def test_run_route_exposes_advanced_dependency_modes(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-A",
                name="WO-A",
                product_id="P-A",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="A1",
                        work_order_id="WO-A",
                        sequence=1,
                        name="A1",
                        duration=Duration(minutes=180),
                        eligible_machine_ids=["M1"],
                    )
                ],
            )
        )
        op_b = Operation(
            id="B1",
            work_order_id="WO-B",
            sequence=1,
            name="B1",
            duration=Duration(minutes=60),
            eligible_machine_ids=["M2"],
        )
        op_b.dependency_links = [
            DependencyLink(
                depends_on_id="A1",
                dependency_type=DependencyType.START_TO_START,
                lag_minutes=-15,
                max_wait_minutes=45,
            )
        ]
        api["work_orders"].add(
            WorkOrder(
                id="WO-B",
                name="WO-B",
                product_id="P-B",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[op_b],
            )
        )

        response = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": False,
            },
        )

        assert response.status_code == 200
        data = response.json()
        planner = data["diagnostics"]["planner_diagnostics"]
        assert set(planner["dependency_modes"]) == {"start_to_start", "overlap", "max_wait"}
        assert any(
            note == "Advanced dependency modes active: start_to_start, overlap, max_wait."
            for note in planner["notes"]
        )
        assert any(
            highlight == "Advanced dependency rules active: start_to_start, overlap, max_wait."
            for highlight in data["summary"]["highlights"]
        )
        dependency_entry = next(
            entry
            for entry in data["diagnostics"]["decision_trace"]
            if entry["operation_id"] == "B1"
        )
        assert dependency_entry["dependency_links"][0]["dependency_type"] == "start_to_start"
        assert dependency_entry["dependency_links"][0]["lag_minutes"] == -15
        assert dependency_entry["dependency_links"][0]["max_wait_minutes"] == 45

    def test_run_route_applies_transfer_time(self, api):
        _add_transfer_work_order(api["work_orders"])

        response = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": False,
                "transfer_times": {
                    "pairs": [
                        {
                            "from_machine": "M1",
                            "to_machine": "M2",
                            "minutes": 45,
                        }
                    ]
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assignments = {a["operation_id"]: a for a in data["assignments"]}
        op1_end = datetime.fromisoformat(assignments["OP1"]["end"])
        op2_start = datetime.fromisoformat(assignments["OP2"]["start"])
        assert op2_start - op1_end >= timedelta(minutes=45)
        assert data["summary"]["scheduled_operation_count"] == 2
        assert any("Makespan is" in h for h in data["summary"]["highlights"])
        assert data["feasibility"]["readiness_status"] == "ready"
        assert data["feasibility"]["recommended_mode"] == "normal_solve"
        assert data["feasibility"]["dominant_issue_kind"] is None

    def test_run_route_accepts_force_machine_planner_action(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-ACTION",
                name="WO-ACTION",
                product_id="P-ACTION",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="ACTION-OP",
                        work_order_id="WO-ACTION",
                        sequence=1,
                        name="ACTION-OP",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1", "M2"],
                    )
                ],
            )
        )

        response = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": False,
                "planner_actions": [
                    {
                        "action_type": "force_machine",
                        "operation_id": "ACTION-OP",
                        "machine_id": "M2",
                        "reason": "Planner override from API.",
                    }
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assignment = next(
            item for item in data["assignments"] if item["operation_id"] == "ACTION-OP"
        )
        assert assignment["machine_id"] == "M2"
        planner_actions = data["diagnostics"]["planner_actions"]
        assert planner_actions["applied_count"] == 1
        assert (
            planner_actions["impact_report"]["items"][0]["impact"]["change_type"]
            == "machine_forced"
        )

    def test_run_route_accepts_add_overtime_planner_action(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-OT-API",
                name="WO-OT-API",
                product_id="P-OT",
                quantity=1,
                due_date=MONDAY + timedelta(hours=20),
                release_date=MONDAY + timedelta(hours=17),
                operations=[
                    Operation(
                        id="OT-API-OP",
                        work_order_id="WO-OT-API",
                        sequence=1,
                        name="OT-API-OP",
                        duration=Duration(minutes=120),
                        eligible_machine_ids=["M1"],
                    )
                ],
            )
        )

        response = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 1,
                "strategy": "greedy",
                "persist": False,
                "planner_actions": [
                    {
                        "action_type": "add_overtime",
                        "machine_id": "M1",
                        "start": (MONDAY + timedelta(hours=17)).isoformat(),
                        "end": (MONDAY + timedelta(hours=20)).isoformat(),
                    }
                ],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assignment = next(
            item for item in data["assignments"] if item["operation_id"] == "OT-API-OP"
        )
        assert assignment["start"] == (MONDAY + timedelta(hours=17)).isoformat()
        assert assignment["end"] == (MONDAY + timedelta(hours=19)).isoformat()
        impact = data["diagnostics"]["planner_actions"]["impact_report"]["items"][0][
            "impact"
        ]
        assert impact["change_type"] == "machine_overtime_added"
        assert impact["window"]["duration_minutes"] == 180

    def test_run_route_uses_repo_backed_material_inventory(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-MAT",
                name="WO-MAT",
                product_id="P-MAT",
                quantity=2,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY + timedelta(hours=8),
                priority=Priority.NORMAL,
                operations=[
                    Operation(
                        id="MAT-OP",
                        work_order_id="WO-MAT",
                        sequence=1,
                        name="MAT-OP",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1"],
                        material_requirements=[
                            MaterialRequirement(
                                material_id="MAT-A",
                                quantity_per_unit=1.0,
                            )
                        ],
                    )
                ],
            )
        )
        api["inventory"].add(InventoryItem(material_id="MAT-A", quantity_on_hand=5.0))
        api["supplies"].add(
            SupplyLot(
                id="SUP-A",
                material_id="MAT-A",
                quantity=5.0,
                available_at=MONDAY + timedelta(hours=6),
            )
        )

        response = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": False,
            },
        )

        assert response.status_code == 200
        data = response.json()
        planner = data["diagnostics"]["planner_diagnostics"]
        assert data["summary"]["scheduled_operation_count"] == 1
        assert planner["material_reservation_count"] == 1
        assert planner["material_pressure"][0]["material_id"] == "MAT-A"
        assert planner["material_pegging_preview"][0]["material_id"] == "MAT-A"
        assert planner["material_pegging_preview"][0]["allocations"][0]["source_id"] == "inventory:MAT-A"
        report = data["diagnostics"]["material_pegging_report"]
        assert report["available"] is True
        assert report["status"] == "covered"
        assert report["material_count"] == 1
        assert report["uncovered_reservation_count"] == 0
        assert report["material_coverage"][0]["material_id"] == "MAT-A"
        assert report["material_coverage"][0]["coverage_ratio"] == 1.0
        assert planner["material_pegging_report"]["source_usage"][0]["source_id"] == "inventory:MAT-A"
        assert any(
            "Material pegging fully covers" in highlight
            for highlight in data["summary"]["highlights"]
        )

    def test_run_route_exposes_stability_against_baseline_schedule(self, api):
        _add_transfer_work_order(api["work_orders"])

        baseline = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert baseline.status_code == 200
        baseline_id = baseline.json()["schedule_id"]

        api["machines"].add(
            Machine(
                id="M2",
                name="M2",
                calendar_id="CAL",
                maintenance_windows=[
                    TimeWindow(
                        start=MONDAY + timedelta(hours=8),
                        end=MONDAY + timedelta(hours=11),
                    )
                ],
            )
        )

        response = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": False,
                "baseline_schedule_id": baseline_id,
            },
        )

        assert response.status_code == 200
        data = response.json()
        stability = data["metrics"]["stability"]
        assert stability["changed_operation_count"] >= 1
        assert stability["moved_operation_count"] >= 1
        assert any(
            "Plan stability kept" in highlight
            for highlight in data["summary"]["highlights"]
        )

    def test_run_route_supports_repair_local_against_baseline(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-BASE",
                name="WO-BASE",
                product_id="P-BASE",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="BASE-OP",
                        work_order_id="WO-BASE",
                        sequence=1,
                        name="BASE-OP",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1"],
                    )
                ],
            )
        )

        baseline = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert baseline.status_code == 200
        baseline_id = baseline.json()["schedule_id"]

        api["work_orders"].add(
            WorkOrder(
                id="WO-NEW",
                name="WO-NEW",
                product_id="P-NEW",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="NEW-OP",
                        work_order_id="WO-NEW",
                        sequence=1,
                        name="NEW-OP",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M2"],
                    )
                ],
            )
        )

        response = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": False,
                "baseline_schedule_id": baseline_id,
                "reschedule_mode": "repair_local",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["diagnostics"]["reschedule_mode"] == "repair_local"
        assert data["diagnostics"]["policy_frozen_count"] == 1
        assignments = {assignment["operation_id"] for assignment in data["assignments"]}
        assert assignments == {"BASE-OP", "NEW-OP"}

    def test_run_route_supports_net_change_without_hard_freeze(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-BASE",
                name="WO-BASE",
                product_id="P-BASE",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="BASE-OP",
                        work_order_id="WO-BASE",
                        sequence=1,
                        name="BASE-OP",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1"],
                    )
                ],
            )
        )

        baseline = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert baseline.status_code == 200
        baseline_id = baseline.json()["schedule_id"]

        api["work_orders"].add(
            WorkOrder(
                id="WO-NEW",
                name="WO-NEW",
                product_id="P-NEW",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="NEW-OP",
                        work_order_id="WO-NEW",
                        sequence=1,
                        name="NEW-OP",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M2"],
                    )
                ],
            )
        )

        response = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": False,
                "baseline_schedule_id": baseline_id,
                "reschedule_mode": "net_change",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["diagnostics"]["reschedule_mode"] == "net_change"
        assert data["diagnostics"]["policy_frozen_count"] == 0
        assert data["diagnostics"]["stability_preference_applied"] is True
        assert any(
            "Net-change mode kept unaffected operations flexible" in highlight
            for highlight in data["summary"]["highlights"]
        )

    def test_run_route_net_change_freezes_stable_prefix_before_new_order_release(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-BASE",
                name="WO-BASE",
                product_id="P-BASE",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="BASE-OP",
                        work_order_id="WO-BASE",
                        sequence=1,
                        name="BASE-OP",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1"],
                    )
                ],
            )
        )

        baseline = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert baseline.status_code == 200
        baseline_id = baseline.json()["schedule_id"]

        api["work_orders"].add(
            WorkOrder(
                id="WO-LATE",
                name="WO-LATE",
                product_id="P-LATE",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY + timedelta(hours=12),
                operations=[
                    Operation(
                        id="LATE-OP",
                        work_order_id="WO-LATE",
                        sequence=1,
                        name="LATE-OP",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M2"],
                    )
                ],
            )
        )

        response = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": False,
                "baseline_schedule_id": baseline_id,
                "reschedule_mode": "net_change",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["diagnostics"]["reschedule_mode"] == "net_change"
        assert data["diagnostics"]["policy_frozen_count"] == 1
        assert data["diagnostics"]["policy_anchor"] == (
            MONDAY + timedelta(hours=12)
        ).isoformat()
        assert any(
            "Net-change mode preserved 1 stable prefix operation" in highlight
            for highlight in data["summary"]["highlights"]
        )

    def test_run_route_enforces_firm_fence_until_unfrozen(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-FIRM-FENCE",
                name="WO-FIRM-FENCE",
                product_id="P-FIRM",
                quantity=1,
                due_date=MONDAY + timedelta(days=1),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="FIRM-FENCE-OP",
                        work_order_id="WO-FIRM-FENCE",
                        sequence=1,
                        name="Firm fence op",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1", "M2"],
                        firm_until=MONDAY + timedelta(hours=12),
                    )
                ],
            )
        )
        baseline = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 1,
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert baseline.status_code == 200
        baseline_data = baseline.json()
        baseline_id = baseline_data["schedule_id"]
        baseline_machine = baseline_data["assignments"][0]["machine_id"]
        alternate_machine = "M2" if baseline_machine == "M1" else "M1"

        blocked_move = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 1,
                "strategy": "greedy",
                "persist": False,
                "baseline_schedule_id": baseline_id,
                "reschedule_mode": "reschedule_all",
                "planner_actions": [
                    {
                        "action_type": "force_machine",
                        "operation_id": "FIRM-FENCE-OP",
                        "machine_id": alternate_machine,
                    }
                ],
            },
        )
        assert blocked_move.status_code == 200
        blocked_data = blocked_move.json()
        assert blocked_data["assignments"][0]["machine_id"] == baseline_machine
        assert blocked_data["diagnostics"]["policy_firm_fence_count"] == 1
        assert blocked_data["diagnostics"]["planning_policy"]["lock_type_counts"] == {
            "firm_fence": 1
        }

        unfrozen_move = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 1,
                "strategy": "greedy",
                "persist": False,
                "baseline_schedule_id": baseline_id,
                "reschedule_mode": "reschedule_all",
                "planner_actions": [
                    {
                        "action_type": "unfreeze_operation",
                        "operation_id": "FIRM-FENCE-OP",
                    },
                    {
                        "action_type": "force_machine",
                        "operation_id": "FIRM-FENCE-OP",
                        "machine_id": alternate_machine,
                    },
                ],
            },
        )
        assert unfrozen_move.status_code == 200
        unfrozen_data = unfrozen_move.json()
        assert unfrozen_data["assignments"][0]["machine_id"] == alternate_machine
        assert unfrozen_data["diagnostics"]["policy_firm_fence_count"] == 0
        assert (
            unfrozen_data["diagnostics"]["planning_policy"]["unfreeze_operation_ids"]
            == ["FIRM-FENCE-OP"]
        )

    def test_run_route_freezes_actual_wip_without_baseline(self, api):
        actual_start = MONDAY + timedelta(hours=8, minutes=15)
        api["work_orders"].add(
            WorkOrder(
                id="WO-ACTUAL-WIP",
                name="WO-ACTUAL-WIP",
                product_id="P-WIP",
                quantity=1,
                due_date=MONDAY + timedelta(days=1),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="ACTUAL-WIP-OP",
                        work_order_id="WO-ACTUAL-WIP",
                        sequence=1,
                        name="Running from MES",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1", "M2"],
                        status=OperationStatus.IN_PROGRESS,
                        actual_start=actual_start,
                        actual_machine_id="M2",
                        remaining_duration=Duration(minutes=25),
                    )
                ],
            )
        )

        response = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 1,
                "strategy": "greedy",
                "persist": True,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assignment = data["assignments"][0]
        assert assignment["operation_id"] == "ACTUAL-WIP-OP"
        assert assignment["machine_id"] == "M2"
        assert assignment["start"] == actual_start.isoformat()
        assert assignment["end"] == (
            actual_start + timedelta(minutes=60)
        ).isoformat()
        policy = data["diagnostics"]["planning_policy"]
        assert policy["lock_type_counts"] == {}
        assert policy["lock_source_counts"] == {}
        wip_split = data["diagnostics"]["wip_remaining_split"]
        assert wip_split["enabled"] is True
        assert wip_split["operation_ids"] == ["ACTUAL-WIP-OP"]
        assert wip_split["synthetic_operation_ids"] == [
            "ACTUAL-WIP-OP__actual_consumed"
        ]
        assert wip_split["splits"][0] == {
            "operation_id": "ACTUAL-WIP-OP",
            "synthetic_operation_id": "ACTUAL-WIP-OP__actual_consumed",
            "work_order_id": "WO-ACTUAL-WIP",
            "actual_machine_id": "M2",
            "actual_start": actual_start.isoformat(),
            "actual_consumed_minutes": 35,
            "remaining_minutes": 25,
            "total_duration_minutes": 60,
            "repair_mode": "actual_consumed_frozen_remaining_schedulable",
        }
        assert policy["actual_shop_floor_assignment_operation_ids"] == []
        assert policy["missing_baseline_assignment_operation_ids"] == []
        assert policy["locks"] == []
        assert data["diagnostics"]["policy_wip_frozen_count"] == 1

        gantt = api["client"].get(f"/scheduling/runs/{data['schedule_id']}/gantt")
        assert gantt.status_code == 200
        gantt_item = gantt.json()["items"][0]
        assert gantt_item["operation_id"] == "ACTUAL-WIP-OP"
        assert gantt_item["wip_repair_mode"] == (
            "actual_consumed_frozen_remaining_schedulable"
        )
        assert [segment["segment_type"] for segment in gantt_item["segments"]] == [
            "actual_consumed",
            "remaining_planned",
        ]

        readiness = api["client"].get(f"/scheduling/runs/{data['schedule_id']}/readiness")
        assert readiness.status_code == 200
        readiness_summary = readiness.json()["diagnostics"][
            "planning_policy_summary"
        ]
        assert readiness_summary["partial_wip_repair_count"] == 1
        assert "review_wip_remaining_segments" in readiness_summary[
            "recommended_review_actions"
        ]

    def test_run_route_exposes_degraded_feasibility_on_stressed_workshop(self, api):
        workshop = build_stressed_reference_workshop()
        _seed_workshop(api, workshop)

        response = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": workshop.horizon_start.isoformat(),
                "horizon_days": 5,
                "strategy": "greedy",
                "persist": False,
                "transfer_times": {
                    "default_minutes": workshop.transfer_times.default_minutes,
                    "pairs": [
                        {
                            "from_machine": src,
                            "to_machine": dst,
                            "minutes": minutes,
                        }
                        for (src, dst), minutes in workshop.transfer_times.pairs.items()
                    ],
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["summary"]["scheduled_operation_count"] == 6
        assert data["feasibility"]["readiness_status"] == "degraded"
        assert data["feasibility"]["recommended_mode"] == "solve_with_caution"
        assert data["feasibility"]["dominant_issue_kind"] == "overloaded_machine"
        assert data["feasibility"]["planner_focus"] == "monitor_risks"
        assert data["feasibility"]["next_best_action"] is not None
        assert data["feasibility"]["suggestions"][0]["issue_kind"] == "overloaded_machine"
        assert data["feasibility"]["suggestions"][0]["target_ids"] == ["ASM-2"]
        assert data["feasibility"]["suggestions"][0]["expected_mode"] == "solve_with_caution"
        assert any(
            issue["machine_id"] == "ASM-2"
            for issue in data["feasibility"]["issues"]
        )

    def test_compare_route_exposes_transfer_impact_in_metrics(self, api):
        _add_transfer_work_order(api["work_orders"])

        response = api["client"].post(
            "/scheduling/compare",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategies": ["greedy", "backward"],
                "transfer_times": {
                    "pairs": [
                        {
                            "from_machine": "M1",
                            "to_machine": "M2",
                            "minutes": 45,
                        }
                    ]
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["best_strategy"] in {"greedy", "backward"}
        assert data["summary"]["best_strategy"] == data["best_strategy"]
        assert data["summary"]["successful_runs"] == 2
        assert data["summary"]["fastest_strategy"] in {"greedy", "backward"}
        assert data["summary"]["shortest_makespan_strategy"] in {"greedy", "backward"}
        assert data["summary"]["lowest_lateness_strategy"] in {"greedy", "backward"}
        assert data["summary"]["best_on_time_ratio_strategy"] in {"greedy", "backward"}
        assert set(data["summary"]["qualified_strategies"]) == {"greedy", "backward"}
        assert data["summary"]["experimental_strategies"] == []
        assert data["summary"]["recommended_for_disruption"] == "greedy"
        assert any(
            "safest successful strategy for disruption handling" in h
            for h in data["summary"]["qualification_highlights"]
        )
        assert any(
            "stronger operational default" in h
            for h in data["summary"]["qualification_highlights"]
        )
        assert any("Best strategy is" in h for h in data["summary"]["highlights"])
        assert any(card["dimension"] == "makespan" for card in data["summary"]["tradeoff_cards"])
        assert len(data["runs"]) == 2
        assert all(run["solver_status"] == "feasible" for run in data["runs"])
        assert all(run["metrics"]["makespan_minutes"] >= 165 for run in data["runs"])
        assert data["runs"][0]["summary"]["scheduled_operation_count"] == 2
        assert isinstance(data["runs"][0]["diagnostics"], dict)
        assert all(run["profile"]["maturity"] == "production" for run in data["runs"])
        assert all(isinstance(run["diagnostics"].get("decision_trace"), list) for run in data["runs"])
        operational_card = next(
            card for card in data["summary"]["qualification_cards"] if card["context"] == "operational_default"
        )
        assert operational_card["recommended_strategy"] == "greedy"
        assert operational_card["evidence"]["reference_strategy"] == "backward"
        assert operational_card["evidence"]["objective_gap"] > 0

    def test_compare_route_exposes_most_stable_strategy_against_baseline(self, api):
        _add_transfer_work_order(api["work_orders"])

        baseline = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert baseline.status_code == 200
        baseline_id = baseline.json()["schedule_id"]

        response = api["client"].post(
            "/scheduling/compare",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategies": ["greedy", "backward"],
                "baseline_schedule_id": baseline_id,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["summary"]["most_stable_strategy"] == "greedy"
        greedy_run = next(run for run in data["runs"] if run["strategy"] == "greedy")
        backward_run = next(run for run in data["runs"] if run["strategy"] == "backward")
        assert greedy_run["metrics"]["stability"]["unchanged_operation_count"] >= backward_run["metrics"]["stability"]["unchanged_operation_count"]

    def test_compare_route_exposes_infeasible_strategy(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-TIGHT",
                name="WO-TIGHT",
                product_id="P-TIGHT",
                quantity=1,
                due_date=datetime(2026, 1, 5, 9, 0, 0),
                release_date=datetime(2026, 1, 5, 8, 0, 0),
                priority=Priority.URGENT,
                operations=[
                    Operation(
                        id="TIGHT-1",
                        work_order_id="WO-TIGHT",
                        sequence=1,
                        name="TIGHT-1",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1"],
                    ),
                    Operation(
                        id="TIGHT-2",
                        work_order_id="WO-TIGHT",
                        sequence=2,
                        name="TIGHT-2",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1"],
                        dependencies=["TIGHT-1"],
                    ),
                ],
            )
        )

        response = api["client"].post(
            "/scheduling/compare",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 2,
                "strategies": ["greedy", "backward"],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["best_strategy"] == "greedy"
        assert data["summary"]["successful_runs"] == 1
        assert data["summary"]["failed_strategies"] == ["backward"]
        assert data["summary"]["infeasible_strategies"] == ["backward"]
        assert data["summary"]["error_strategies"] == []
        assert data["summary"]["dominant_failure_kind"] == "machine_overloaded"
        assert data["summary"]["planner_focus"] == "add_or_shift_capacity"
        assert data["summary"]["next_best_recovery_action"] is not None
        assert data["summary"]["recommended_for_disruption"] == "greedy"
        assert any(
            "Infeasible under current constraints" in h
            for h in data["summary"]["highlights"]
        )
        assert any(
            card["strategy"] == "backward" for card in data["summary"]["failure_cards"]
        )
        failure_card = next(
            card for card in data["summary"]["failure_cards"] if card["strategy"] == "backward"
        )
        assert failure_card["dominant_blocker_label"] == "Machine overload"
        assert failure_card["planner_focus"] == "add_or_shift_capacity"
        assert failure_card["recovery_mode"] == "repair_then_retry"
        backward = next(run for run in data["runs"] if run["strategy"] == "backward")
        assert backward["solver_status"] == "infeasible"
        assert backward["infeasibility"] is not None
        assert backward["infeasibility"]["operations"][0]["operation_id"] == "TIGHT-1"
        assert backward["infeasibility"]["dominant_blocker_kind"] == "machine_overloaded"
        assert backward["infeasibility"]["planner_focus"] == "add_or_shift_capacity"
        assert backward["infeasibility"]["next_best_action"] is not None

    def test_compare_route_exposes_dependency_max_wait_failure(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-A",
                name="WO-A",
                product_id="P-A",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="A1",
                        work_order_id="WO-A",
                        sequence=1,
                        name="A1",
                        duration=Duration(minutes=180),
                        eligible_machine_ids=["M1"],
                    )
                ],
            )
        )
        op_b = Operation(
            id="B1",
            work_order_id="WO-B",
            sequence=1,
            name="B1",
            duration=Duration(minutes=60),
            eligible_machine_ids=["M2"],
        )
        op_b.dependency_links = [
            DependencyLink(
                depends_on_id="A1",
                dependency_type=DependencyType.START_TO_START,
                lag_minutes=-15,
                max_wait_minutes=45,
            )
        ]
        api["work_orders"].add(
            WorkOrder(
                id="WO-B",
                name="WO-B",
                product_id="P-B",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[op_b],
            )
        )

        response = api["client"].post(
            "/scheduling/compare",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 14,
                "strategies": ["greedy", "backward"],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["summary"]["failed_strategies"] == ["backward"]
        assert data["summary"]["dominant_failure_kind"] == "dependency_max_wait"
        assert data["summary"]["planner_focus"] == "repair_precedence_or_release"
        failure_card = next(
            card for card in data["summary"]["failure_cards"] if card["strategy"] == "backward"
        )
        assert failure_card["dominant_blocker_label"] == "Dependency max-wait"
        assert failure_card["dominant_blocker_constraint_name"] == "start_to_start_max_wait"
        assert failure_card["planner_focus"] == "repair_precedence_or_release"
        backward = next(run for run in data["runs"] if run["strategy"] == "backward")
        assert backward["infeasibility"]["dominant_blocker_kind"] == "dependency_max_wait"

    def test_disruption_route_persists_new_run_and_history(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="BASE",
                name="BASE",
                product_id="P-BASE",
                quantity=1,
                due_date=MONDAY + timedelta(days=3),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="BASE_OP",
                        work_order_id="BASE",
                        sequence=1,
                        name="BASE_OP",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1", "M2"],
                    )
                ],
            )
        )

        initial = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert initial.status_code == 200
        initial_id = initial.json()["schedule_id"]

        disruption = api["client"].post(
            "/scheduling/disruption",
            json={
                "schedule_id": initial_id,
                "strategy": "greedy",
                "event": {
                    "disruption_type": "rush_order",
                    "timestamp": "2026-01-05T10:00:00",
                    "rush_order": {
                        "id": "RUSH",
                        "name": "RUSH",
                        "product_id": "P-RUSH",
                        "quantity": 1,
                        "due_date": "2026-01-06T00:00:00",
                        "release_date": "2026-01-05T10:00:00",
                        "priority": 1,
                        "operations": [
                            {
                                "id": "RUSH_OP",
                                "sequence": 1,
                                "name": "RUSH_OP",
                                "duration_minutes": 45,
                                "eligible_machine_ids": ["M1", "M2"],
                            }
                        ],
                    },
                },
            },
        )

        assert disruption.status_code == 200
        disruption_data = disruption.json()
        assert disruption_data["schedule_id"] != initial_id
        assert {a["operation_id"] for a in disruption_data["assignments"]} >= {
            "BASE_OP",
            "RUSH_OP",
        }
        assert disruption_data["summary"]["scheduled_operation_count"] >= 2
        assert any("Disruption rush_order applied" in h for h in disruption_data["summary"]["highlights"])
        assert disruption_data["analysis"] is not None
        assert len(disruption_data["analysis"]["gantt"]) >= 2
        impact = disruption_data["diagnostics"]["disruption_impact"]
        assert impact["introduced_operation_count"] == 1
        assert impact["new_schedule_id"] == disruption_data["schedule_id"]
        assert "RUSH_OP" in impact["introduced_operations"]

        history = api["client"].get("/scheduling/runs")
        assert history.status_code == 200
        history_data = history.json()
        run_ids = [run["schedule_id"] for run in history_data]
        assert disruption_data["schedule_id"] in run_ids
        assert initial_id in run_ids
        assert all(run["summary"]["scheduled_operation_count"] >= 1 for run in history_data)

    def test_disruption_route_exposes_stability_against_current_schedule(self, api):
        _add_transfer_work_order(api["work_orders"])

        initial = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert initial.status_code == 200
        schedule_id = initial.json()["schedule_id"]

        disruption = api["client"].post(
            "/scheduling/disruption",
            json={
                "schedule_id": schedule_id,
                "strategy": "greedy",
                "persist": False,
                "event": {
                    "disruption_type": "machine_down",
                    "timestamp": "2026-01-05T07:00:00",
                    "machine_id": "M2",
                    "event_end": "2026-01-05T14:00:00",
                },
            },
        )

        assert disruption.status_code == 200
        data = disruption.json()
        stability = data["metrics"]["stability"]
        impact = data["diagnostics"]["disruption_impact"]
        assert stability["changed_operation_count"] >= 1
        assert stability["changed_operation_count"] == impact["changed_operation_count"]

    def test_disruption_route_exposes_repair_local_mode(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-DOWN",
                name="WO-DOWN",
                product_id="P-DOWN",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="DOWN-OP",
                        work_order_id="WO-DOWN",
                        sequence=1,
                        name="DOWN-OP",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1"],
                    )
                ],
            )
        )
        api["work_orders"].add(
            WorkOrder(
                id="WO-KEEP",
                name="WO-KEEP",
                product_id="P-KEEP",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="KEEP-OP",
                        work_order_id="WO-KEEP",
                        sequence=1,
                        name="KEEP-OP",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M2"],
                    )
                ],
            )
        )

        initial = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert initial.status_code == 200
        schedule_id = initial.json()["schedule_id"]

        response = api["client"].post(
            "/scheduling/disruption",
            json={
                "schedule_id": schedule_id,
                "strategy": "greedy",
                "reschedule_mode": "repair_local",
                "persist": False,
                "event": {
                    "disruption_type": "machine_down",
                    "timestamp": "2026-01-05T07:00:00",
                    "machine_id": "M1",
                    "event_end": "2026-01-05T14:00:00",
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["reschedule_mode"] == "repair_local"
        assert data["diagnostics"]["reschedule_mode"] == "repair_local"
        assert data["diagnostics"]["policy_frozen_count"] == 1
        assert data["frozen_count"] == 1

    def test_disruption_route_keeps_advanced_dependency_modes_visible(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-A",
                name="WO-A",
                product_id="P-A",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="A1",
                        work_order_id="WO-A",
                        sequence=1,
                        name="A1",
                        duration=Duration(minutes=180),
                        eligible_machine_ids=["M1"],
                    )
                ],
            )
        )
        op_b = Operation(
            id="B1",
            work_order_id="WO-B",
            sequence=1,
            name="B1",
            duration=Duration(minutes=60),
            eligible_machine_ids=["M2"],
        )
        op_b.dependency_links = [
            DependencyLink(
                depends_on_id="A1",
                dependency_type=DependencyType.START_TO_START,
                lag_minutes=-15,
                max_wait_minutes=45,
            )
        ]
        api["work_orders"].add(
            WorkOrder(
                id="WO-B",
                name="WO-B",
                product_id="P-B",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[op_b],
            )
        )

        initial = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert initial.status_code == 200

        disruption = api["client"].post(
            "/scheduling/disruption",
            json={
                "schedule_id": initial.json()["schedule_id"],
                "strategy": "greedy",
                "persist": False,
                "event": {
                    "disruption_type": "machine_down",
                    "timestamp": "2026-01-05T07:00:00",
                    "machine_id": "M1",
                    "event_end": "2026-01-05T10:00:00",
                },
            },
        )

        assert disruption.status_code == 200
        data = disruption.json()
        planner = data["diagnostics"]["planner_diagnostics"]
        assert set(planner["dependency_modes"]) == {"start_to_start", "overlap", "max_wait"}
        assert any(
            note == "Advanced dependency modes active: start_to_start, overlap, max_wait."
            for note in planner["notes"]
        )
        dependency_entry = next(
            entry
            for entry in data["diagnostics"]["decision_trace"]
            if entry["operation_id"] == "B1"
        )
        assert dependency_entry["dependency_links"][0]["dependency_type"] == "start_to_start"

    def test_dashboard_route_reads_persisted_metadata(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-DASH",
                name="WO-DASH",
                product_id="P-DASH",
                quantity=1,
                due_date=MONDAY + timedelta(days=3),
                release_date=MONDAY,
                priority=Priority.URGENT,
                operations=[
                    Operation(
                        id="DASH-1",
                        work_order_id="WO-DASH",
                        sequence=1,
                        name="DASH-1",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1", "M2"],
                    ),
                    Operation(
                        id="DASH-2",
                        work_order_id="WO-DASH",
                        sequence=2,
                        name="DASH-2",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1", "M2"],
                        dependencies=["DASH-1"],
                    ),
                ],
            )
        )

        run = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert run.status_code == 200
        schedule_id = run.json()["schedule_id"]

        dashboard = api["client"].get(f"/scheduling/runs/{schedule_id}/dashboard")
        assert dashboard.status_code == 200
        data = dashboard.json()
        assert data["strategy"] == "greedy"
        assert data["solver_status"] == "feasible"
        assert data["objective_value"] >= 0
        assert data["wall_time_ms"] >= 0
        assert data["workspace_id"] == "default"
        assert data["scenario_name"] == "Default Scenario"
        assert data["lifecycle_status"] == "draft"
        assert "makespan_minutes" in data["metrics"]
        assert data["summary"]["scheduled_operation_count"] == 2

    def test_gantt_route_returns_interactive_read_model(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-GANTT",
                name="Gantt WO",
                product_id="P-GANTT",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                priority=Priority.HIGH,
                operations=[
                    Operation(
                        id="GANTT-1",
                        work_order_id="WO-GANTT",
                        sequence=1,
                        name="Cut for Gantt",
                        duration=Duration(minutes=75),
                        setup_time=Duration(minutes=15),
                        eligible_machine_ids=["M1", "M2"],
                        setup_family="FAM-A",
                    )
                ],
            )
        )

        run = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert run.status_code == 200
        schedule_id = run.json()["schedule_id"]

        gantt = api["client"].get(f"/scheduling/runs/{schedule_id}/gantt")

        assert gantt.status_code == 200
        data = gantt.json()
        assert data["schedule_id"] == schedule_id
        assert data["interaction_contract"]["version"] == "interactive-gantt-v1"
        assert data["interaction_contract"]["assignment_mutation"] == "forbidden"
        assert data["interaction_contract"]["edit_flow"] == [
            "preview",
            "apply_to_scenario",
            "publish",
        ]
        assert data["interaction_contract"]["planning_disposition"] == (
            "wip-firm-frozen-v1"
        )
        assert data["interaction_contract"]["planner_override_policy"] == (
            "planner-override-policy-v1"
        )
        assert data["interaction_contract"]["supported_preview_actions"] == [
            "preview_move",
            "pin_operation_window",
            "force_machine",
            "freeze_operation",
            "unfreeze_operation",
            "standby_operation",
            "reinsert_standby_operation",
            "change_priority",
            "override_due_date",
            "exclude_work_order",
        ]
        assert data["machine_lanes"][0]["assignment_count"] == 1
        assert data["work_order_lanes"][0]["work_order_name"] == "Gantt WO"
        item = data["items"][0]
        assert item["operation_name"] == "Cut for Gantt"
        assert item["work_order_name"] == "Gantt WO"
        assert item["machine_name"] in {"M1", "M2"}
        assert item["setup_family"] == "FAM-A"
        assert item["eligible_machine_ids"] == ["M1", "M2"]
        assert item["setup_minutes"] == 15
        assert item["run_minutes"] == 75
        assert item["priority"] == int(Priority.HIGH)
        assert item["execution_status"] == "not_started"
        assert item["planning_lock"] == "free"
        assert item["planning_zone"] == "liquid"
        assert item["movable"] is True
        assert item["override_required"] is False
        assert item["required_override_action"] is None
        assert item["override_policy"]["move_policy"] == "allowed"
        assert item["override_policy"]["review_required"] is False
        assert item["segments"][0]["segment_type"] == "run"
        assert "preview_move" in item["editable_actions"]
        assert item["changed_from_baseline"] is False

    def test_gantt_route_exposes_wip_and_frozen_lock_metadata(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-WIP",
                name="WIP WO",
                product_id="P-WIP",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="WIP-RUNNING",
                        work_order_id="WO-WIP",
                        sequence=1,
                        name="Already running",
                        duration=Duration(minutes=45),
                        eligible_machine_ids=["M1"],
                        status=OperationStatus.IN_PROGRESS,
                        actual_start=MONDAY + timedelta(hours=8),
                        actual_machine_id="M1",
                        remaining_duration=Duration(minutes=20),
                    ),
                    Operation(
                        id="WIP-DONE",
                        work_order_id="WO-WIP",
                        sequence=2,
                        name="Already done",
                        duration=Duration(minutes=30),
                        eligible_machine_ids=["M1"],
                        status=OperationStatus.COMPLETED,
                        actual_start=MONDAY + timedelta(hours=7),
                        actual_machine_id="M1",
                        actual_end=MONDAY + timedelta(hours=7, minutes=30),
                    ),
                    Operation(
                        id="WIP-FIRM",
                        work_order_id="WO-WIP",
                        sequence=3,
                        name="Firmed fence",
                        duration=Duration(minutes=30),
                        eligible_machine_ids=["M1"],
                        status=OperationStatus.SCHEDULED,
                        firm_until=MONDAY + timedelta(hours=12),
                    ),
                    Operation(
                        id="WIP-FROZEN",
                        work_order_id="WO-WIP",
                        sequence=4,
                        name="Hard frozen fence",
                        duration=Duration(minutes=30),
                        eligible_machine_ids=["M1"],
                        status=OperationStatus.SCHEDULED,
                        frozen_until=MONDAY + timedelta(hours=11),
                        firm_until=MONDAY + timedelta(hours=12),
                    ),
                ],
            )
        )
        schedule = Schedule(
            id="schedule-wip-locks",
            created_at=MONDAY,
            assignments=[
                ScheduledOperation(
                    operation_id="WIP-RUNNING",
                    work_order_id="WO-WIP",
                    machine_id="M1",
                    setup_start=MONDAY + timedelta(hours=8),
                    start=MONDAY + timedelta(hours=8),
                    end=MONDAY + timedelta(hours=8, minutes=45),
                ),
                ScheduledOperation(
                    operation_id="WIP-DONE",
                    work_order_id="WO-WIP",
                    machine_id="M1",
                    setup_start=MONDAY + timedelta(hours=9),
                    start=MONDAY + timedelta(hours=9),
                    end=MONDAY + timedelta(hours=9, minutes=30),
                ),
                ScheduledOperation(
                    operation_id="WIP-FIRM",
                    work_order_id="WO-WIP",
                    machine_id="M1",
                    setup_start=MONDAY + timedelta(hours=10),
                    start=MONDAY + timedelta(hours=10),
                    end=MONDAY + timedelta(hours=10, minutes=30),
                ),
                ScheduledOperation(
                    operation_id="WIP-FROZEN",
                    work_order_id="WO-WIP",
                    machine_id="M1",
                    setup_start=MONDAY + timedelta(hours=10, minutes=30),
                    start=MONDAY + timedelta(hours=10, minutes=30),
                    end=MONDAY + timedelta(hours=11),
                ),
            ],
        )
        api["schedules"].save(
            schedule,
            metrics={"makespan_minutes": 90},
            strategy="manual-proof",
            solver_status="feasible",
        )

        gantt = api["client"].get("/scheduling/runs/schedule-wip-locks/gantt")

        assert gantt.status_code == 200
        items = {item["operation_id"]: item for item in gantt.json()["items"]}
        running = items["WIP-RUNNING"]
        assert running["execution_status"] == "in_progress"
        assert running["planning_lock"] == "started_frozen"
        assert running["planning_zone"] == "frozen"
        assert running["actual_start"] == (MONDAY + timedelta(hours=8)).isoformat()
        assert running["actual_machine_id"] == "M1"
        assert running["actual_consumed_minutes"] == 25
        assert running["remaining_duration_minutes"] == 20
        assert running["planned_remaining_minutes"] == 20
        assert running["wip_repair_mode"] == "actual_history_plus_remaining_frozen"
        assert running["override_policy"]["move_policy"] == "blocked"
        assert running["override_policy"]["severity"] == "actual_wip"
        assert [segment["segment_type"] for segment in running["segments"]] == [
            "actual_consumed",
            "remaining_frozen",
        ]
        assert running["movable"] is False
        assert running["editable_actions"] == []

        done = items["WIP-DONE"]
        assert done["execution_status"] == "completed"
        assert done["planning_lock"] == "completed_frozen"
        assert done["planning_zone"] == "frozen"
        assert done["actual_end"] == (
            MONDAY + timedelta(hours=7, minutes=30)
        ).isoformat()
        assert done["movable"] is False
        assert done["editable_actions"] == []

        firm = items["WIP-FIRM"]
        assert firm["execution_status"] == "queued"
        assert firm["planning_lock"] == "firm"
        assert firm["planning_zone"] == "frozen"
        assert firm["firm_until"] == (MONDAY + timedelta(hours=12)).isoformat()
        assert firm["override_required"] is True
        assert firm["editable_actions"] == ["unfreeze_operation"]
        assert firm["override_policy"]["move_policy"] == "override_required"
        assert firm["override_policy"]["required_action"] == "unfreeze_operation"

        frozen = items["WIP-FROZEN"]
        assert frozen["execution_status"] == "queued"
        assert frozen["planning_lock"] == "firm"
        assert frozen["planning_zone"] == "frozen"
        assert frozen["frozen_until"] == (MONDAY + timedelta(hours=11)).isoformat()
        assert frozen["override_required"] is False
        assert frozen["editable_actions"] == []

    def test_schedule_risk_route_flags_late_critical_and_locked_work(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-RISK",
                name="Risk WO",
                product_id="P-RISK",
                quantity=1,
                due_date=MONDAY + timedelta(hours=8, minutes=30),
                release_date=MONDAY,
                priority=Priority.URGENT,
                operations=[
                    Operation(
                        id="RISK-LATE",
                        work_order_id="WO-RISK",
                        sequence=1,
                        name="Late risk operation",
                        duration=Duration(minutes=120),
                        eligible_machine_ids=["M1"],
                        firm_until=MONDAY + timedelta(hours=12),
                    )
                ],
            )
        )

        run = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 2,
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert run.status_code == 200
        schedule_id = run.json()["schedule_id"]

        risk = api["client"].get(
            f"/scheduling/runs/{schedule_id}/risk",
            params={
                "window_start": (
                    MONDAY.replace(tzinfo=UTC)
                    .isoformat()
                    .replace("+00:00", "Z")
                ),
                "window_end": (
                    (MONDAY + timedelta(days=1))
                    .replace(tzinfo=UTC)
                    .isoformat()
                    .replace("+00:00", "Z")
                ),
            },
        )

        assert risk.status_code == 200
        data = risk.json()
        assert data["schedule_id"] == schedule_id
        assert data["status"] == "blocked"
        assert data["risk_score"] > 0
        assert data["summary"]["visible_operation_count"] == 1
        assert data["summary"]["late_operation_count"] == 1
        assert data["summary"]["critical_operation_count"] == 1
        assert data["summary"]["constraint_count"] == 1
        assert data["late_operations"][0]["operation_id"] == "RISK-LATE"
        assert data["critical_operations"][0]["operation_id"] == "RISK-LATE"
        assert data["at_risk_work_orders"][0]["work_order_id"] == "WO-RISK"
        assert data["firm_frozen_constraints"][0]["operation_id"] == "RISK-LATE"
        assert data["recommended_actions"][0]["action"] == "review_late_operations"

    def test_gantt_route_exposes_baseline_deltas_for_candidate_plan(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-GANTT-DELTA",
                name="Gantt Delta WO",
                product_id="P-GANTT",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="GANTT-DELTA-1",
                        work_order_id="WO-GANTT-DELTA",
                        sequence=1,
                        name="Delta Op",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1", "M2"],
                    )
                ],
            )
        )

        baseline = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "greedy",
                "persist": True,
                "scenario_name": "Baseline",
            },
        )
        assert baseline.status_code == 200
        baseline_id = baseline.json()["schedule_id"]

        candidate = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "greedy",
                "persist": True,
                "baseline_schedule_id": baseline_id,
                "scenario_name": "Candidate",
                "planner_actions": [
                    {
                        "action_type": "force_machine",
                        "operation_id": "GANTT-DELTA-1",
                        "machine_id": "M2",
                    }
                ],
            },
        )
        assert candidate.status_code == 200
        candidate_id = candidate.json()["schedule_id"]

        gantt = api["client"].get(
            f"/scheduling/runs/{candidate_id}/gantt",
            params={"baseline_schedule_id": baseline_id},
        )

        assert gantt.status_code == 200
        data = gantt.json()
        item = data["items"][0]
        assert data["baseline_schedule_id"] == baseline_id
        assert item["machine_id"] == "M2"
        assert item["baseline_machine_id"] == "M1"
        assert item["changed_from_baseline"] is True
        assert item["start_delta_minutes"] == 0
        assert item["planning_lock"] == "soft_locked"
        assert item["planning_zone"] == "slushy"
        assert item["override_policy"]["move_policy"] == "review_required"
        assert item["override_policy"]["publish_review_required"] is True

        readiness = api["client"].get(f"/scheduling/runs/{candidate_id}/readiness")
        assert readiness.status_code == 200
        readiness_data = readiness.json()
        summary = readiness_data["diagnostics"]["planning_policy_summary"]
        assert summary["slushy_review_count"] == 1
        assert "review_slushy_overrides" in summary["recommended_review_actions"]

    def test_feasible_slots_route_respects_material_readiness(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-SLOT-MAT",
                name="Slot Material WO",
                product_id="P-SLOT",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY + timedelta(hours=10),
                operations=[
                    Operation(
                        id="SLOT-MAT-1",
                        work_order_id="WO-SLOT-MAT",
                        sequence=1,
                        name="Material-aware slot",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1", "M2"],
                        material_requirements=[
                            MaterialRequirement(
                                material_id="MAT-SLOT",
                                fixed_quantity=1,
                            )
                        ],
                    )
                ],
            )
        )
        api["supplies"].add(
            SupplyLot(
                id="SUP-SLOT",
                material_id="MAT-SLOT",
                quantity=1,
                available_at=MONDAY + timedelta(hours=10),
            )
        )
        baseline = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert baseline.status_code == 200
        baseline_id = baseline.json()["schedule_id"]

        response = api["client"].get(
            f"/scheduling/runs/{baseline_id}/operations/SLOT-MAT-1/feasible-slots",
            params={
                "search_start": (MONDAY + timedelta(hours=8)).isoformat(),
                "max_results": 2,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["schedule_id"] == baseline_id
        assert data["operation_id"] == "SLOT-MAT-1"
        assert data["interaction_contract"]["version"] == "interactive-gantt-v1"
        assert data["interaction_contract"]["assignment_mutation"] == "forbidden"
        assert (
            data["interaction_contract"]["slot_usage"]
            == "preview_move_before_apply"
        )
        assert data["baseline_assignment"]["operation_id"] == "SLOT-MAT-1"
        assert len(data["slots"]) == 2
        assert {slot["machine_id"] for slot in data["slots"]} == {"M1", "M2"}
        assert all(
            slot["start"] >= (MONDAY + timedelta(hours=10)).isoformat()
            for slot in data["slots"]
        )
        assert all(
            slot["material_ready_at"] == (MONDAY + timedelta(hours=10)).isoformat()
            for slot in data["slots"]
        )
        assert all("material_available" in slot["reasons"] for slot in data["slots"])

    def test_feasible_slots_route_returns_ranked_multiple_candidates(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-SLOT-RANK",
                name="Slot Ranking WO",
                product_id="P-SLOT",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="SLOT-RANK-1",
                        work_order_id="WO-SLOT-RANK",
                        sequence=1,
                        name="Ranked slot op",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1"],
                    )
                ],
            )
        )
        baseline = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert baseline.status_code == 200
        baseline_id = baseline.json()["schedule_id"]

        response = api["client"].get(
            f"/scheduling/runs/{baseline_id}/operations/SLOT-RANK-1/feasible-slots",
            params={
                "search_start": (MONDAY + timedelta(hours=8)).isoformat(),
                "max_results": 3,
            },
        )

        assert response.status_code == 200
        data = response.json()
        slots = data["slots"]
        assert len(slots) == 3
        assert [slot["rank"] for slot in slots] == [1, 2, 3]
        assert [slot["score"] for slot in slots] == sorted(
            slot["score"] for slot in slots
        )
        assert {slot["machine_id"] for slot in slots} == {"M1"}
        assert slots[0]["start"] < slots[1]["start"] < slots[2]["start"]
        assert all(
            "baseline_start_shift_minutes" in slot["score_components"]
            for slot in slots
        )
        assert all(slot["baseline_machine_change"] is False for slot in slots)
        assert all("same_machine_as_baseline" in slot["reasons"] for slot in slots)

    def test_edit_preview_route_converts_gantt_move_to_planner_action(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-EDIT-PREVIEW",
                name="Edit Preview WO",
                product_id="P-EDIT",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="EDIT-PREVIEW-1",
                        work_order_id="WO-EDIT-PREVIEW",
                        sequence=1,
                        name="Preview Move Op",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1", "M2"],
                    )
                ],
            )
        )
        baseline = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert baseline.status_code == 200
        baseline_id = baseline.json()["schedule_id"]

        preview = api["client"].post(
            f"/scheduling/runs/{baseline_id}/edits/preview",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "auto",
                "edits": [
                    {
                        "edit_type": "move_operation",
                        "operation_id": "EDIT-PREVIEW-1",
                        "machine_id": "M2",
                        "start": (MONDAY + timedelta(hours=9)).isoformat(),
                        "end": (MONDAY + timedelta(hours=10)).isoformat(),
                    }
                ],
            },
        )

        assert preview.status_code == 200
        data = preview.json()
        assert data["baseline_schedule_id"] == baseline_id
        assert data["planner_actions"] == [
            {
                "action_type": "pin_operation_window",
                "operation_id": "EDIT-PREVIEW-1",
                "work_order_id": None,
                "machine_id": "M2",
                "calendar_id": None,
                "due_date": None,
                "setup_start": None,
                "start": (MONDAY + timedelta(hours=9)).isoformat(),
                "end": (MONDAY + timedelta(hours=10)).isoformat(),
                "priority": None,
                "reason": None,
            }
        ]
        assert data["preview"]["lifecycle_status"] == "simulation"
        assert data["preview"]["assignments"][0]["machine_id"] == "M2"
        assert data["preview"]["assignments"][0]["start"] == (
            MONDAY + timedelta(hours=9)
        ).isoformat()
        assert data["preview"]["assignments"][0]["end"] == (
            MONDAY + timedelta(hours=10)
        ).isoformat()
        assert data["preview"]["diagnostics"]["planner_actions"]["applied_count"] == 1
        assert data["warnings"] == []
        assert data["gantt"]["schedule_id"] == data["preview"]["schedule_id"]
        assert data["gantt"]["baseline_schedule_id"] == baseline_id
        assert data["gantt"]["lifecycle_status"] == "simulation"
        gantt_item = data["gantt"]["items"][0]
        assert gantt_item["operation_id"] == "EDIT-PREVIEW-1"
        assert gantt_item["machine_id"] == "M2"
        assert gantt_item["baseline_machine_id"] == "M1"
        assert gantt_item["changed_from_baseline"] is True
        assert gantt_item["start_delta_minutes"] == 60
        assert gantt_item["planning_lock"] == "manual_pinned"
        assert gantt_item["planning_zone"] == "frozen"
        assert gantt_item["movable"] is False
        assert gantt_item["override_required"] is True
        assert gantt_item["editable_actions"] == ["unfreeze_operation"]
        history = api["client"].get("/scheduling/runs")
        assert [item["schedule_id"] for item in history.json()] == [baseline_id]

    def test_apply_edits_route_persists_candidate_scenario(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-APPLY-EDIT",
                name="Apply Edit WO",
                product_id="P-EDIT",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="APPLY-EDIT-1",
                        work_order_id="WO-APPLY-EDIT",
                        sequence=1,
                        name="Apply Move Op",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1", "M2"],
                    )
                ],
            )
        )
        baseline = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "greedy",
                "persist": True,
                "scenario_name": "Baseline",
            },
        )
        assert baseline.status_code == 200
        baseline_id = baseline.json()["schedule_id"]

        applied = api["client"].post(
            f"/scheduling/runs/{baseline_id}/edits/apply",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "auto",
                "scenario_name": "Planner candidate",
                "lifecycle_status": "draft",
                "edits": [
                    {
                        "edit_type": "move_operation",
                        "operation_id": "APPLY-EDIT-1",
                        "machine_id": "M2",
                        "start": (MONDAY + timedelta(hours=9)).isoformat(),
                        "end": (MONDAY + timedelta(hours=10)).isoformat(),
                    }
                ],
            },
        )

        assert applied.status_code == 200
        data = applied.json()
        candidate_id = data["candidate_schedule_id"]
        assert data["baseline_schedule_id"] == baseline_id
        assert candidate_id != baseline_id
        assert data["candidate"]["scenario_name"] == "Planner candidate"
        assert data["candidate"]["lifecycle_status"] == "draft"
        assert data["candidate"]["assignments"][0]["machine_id"] == "M2"
        assert data["gantt"]["baseline_schedule_id"] == baseline_id
        assert data["gantt"]["items"][0]["changed_from_baseline"] is True
        assert data["gantt"]["items"][0]["planning_lock"] == "manual_pinned"

        history = api["client"].get("/scheduling/runs")
        assert [item["schedule_id"] for item in history.json()] == [
            candidate_id,
            baseline_id,
        ]
        state = api["client"].get("/planning/state")
        assert state.status_code == 200
        state_data = state.json()
        assert state_data["active_baseline_schedule_id"] == baseline_id
        assert state_data["active_candidate_schedule_id"] == candidate_id
        assert state_data["candidate_edit_count"] == 1
        assert state_data["recent_events"][0]["event_type"] == "candidate_edit_applied"

    def test_apply_edits_route_supports_non_move_planner_actions(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-PRIORITY-EDIT",
                name="Priority Edit WO",
                product_id="P-EDIT",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                priority=Priority.NORMAL,
                operations=[
                    Operation(
                        id="PRIORITY-EDIT-1",
                        work_order_id="WO-PRIORITY-EDIT",
                        sequence=1,
                        name="Priority Edit Op",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1"],
                    )
                ],
            )
        )
        baseline = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "greedy",
                "persist": True,
                "scenario_name": "Baseline",
            },
        )
        assert baseline.status_code == 200
        baseline_id = baseline.json()["schedule_id"]

        applied = api["client"].post(
            f"/scheduling/runs/{baseline_id}/edits/apply",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "auto",
                "scenario_name": "Priority candidate",
                "lifecycle_status": "draft",
                "edits": [
                    {
                        "edit_type": "change_priority",
                        "work_order_id": "WO-PRIORITY-EDIT",
                        "priority": 4,
                        "reason": "Planner raised priority from Gantt",
                    }
                ],
            },
        )

        assert applied.status_code == 200
        data = applied.json()
        assert data["baseline_schedule_id"] == baseline_id
        assert data["candidate_schedule_id"] != baseline_id
        assert data["planner_actions"][0]["action_type"] == "change_priority"
        assert data["planner_actions"][0]["priority"] == 4
        assert data["candidate"]["scenario_name"] == "Priority candidate"
        actions = data["candidate"]["diagnostics"]["planner_actions"]
        assert actions["applied_count"] == 1
        impact = actions["applications"][0]["impact"]
        assert impact["change_type"] == "priority_changed"
        assert impact["work_order_id"] == "WO-PRIORITY-EDIT"
        assert impact["from_priority"] == "normal"
        assert impact["to_priority"] == "urgent"
        assert data["planner_guidance"]["next_step"] == "compare_and_publish"

    def test_interactive_gantt_flow_suggests_applies_compares_and_publishes(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-GANTT-FLOW",
                name="Interactive Gantt Flow WO",
                product_id="P-GANTT",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="GANTT-FLOW-1",
                        work_order_id="WO-GANTT-FLOW",
                        sequence=1,
                        name="Interactive move op",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1", "M2"],
                    )
                ],
            )
        )
        baseline = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "greedy",
                "persist": True,
                "scenario_name": "Official baseline",
                "lifecycle_status": "published",
            },
        )
        assert baseline.status_code == 200
        baseline_id = baseline.json()["schedule_id"]

        readiness = api["client"].get(f"/scheduling/runs/{baseline_id}/readiness")
        assert readiness.status_code == 200
        readiness_data = readiness.json()
        assert readiness_data["ui_contract"]["version"] == "planner-readiness-v1"
        assert readiness_data["status"] in {"ready", "attention"}
        assert readiness_data["ready"] is (readiness_data["status"] == "ready")

        suggestions = api["client"].get(
            f"/scheduling/runs/{baseline_id}/operations/GANTT-FLOW-1/feasible-slots",
            params={
                "search_start": (MONDAY + timedelta(hours=8)).isoformat(),
                "max_results": 10,
            },
        )
        assert suggestions.status_code == 200
        m2_slot = next(
            slot for slot in suggestions.json()["slots"] if slot["machine_id"] == "M2"
        )
        assert m2_slot["baseline_machine_change"] is True
        assert m2_slot["rank"] >= 1

        applied = api["client"].post(
            f"/scheduling/runs/{baseline_id}/edits/apply",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "auto",
                "reschedule_mode": "repair_local",
                "scenario_name": "Planner machine-change candidate",
                "lifecycle_status": "draft",
                "edits": [
                    {
                        "edit_type": "move_operation",
                        "operation_id": "GANTT-FLOW-1",
                        "machine_id": "M2",
                        "start": m2_slot["start"],
                        "end": m2_slot["end"],
                    }
                ],
            },
        )
        assert applied.status_code == 200
        candidate_id = applied.json()["candidate_schedule_id"]
        assert applied.json()["gantt"]["items"][0]["changed_from_baseline"] is True
        assert applied.json()["planner_guidance"]["version"] == (
            "interactive-edit-guidance-v1"
        )
        assert applied.json()["planner_guidance"]["next_step"] in {
            "compare_and_publish",
            "review_warnings_then_compare",
        }

        compared = api["client"].post(
            "/scheduling/scenarios/compare",
            json={
                "baseline_schedule_id": baseline_id,
                "candidate_schedule_ids": [candidate_id],
            },
        )
        assert compared.status_code == 200
        comparison = compared.json()["comparisons"][0]
        assert comparison["candidate"]["schedule_id"] == candidate_id
        assert comparison["publish_status"] in {"publishable", "review"}
        assert comparison["stability_report"]["changed_operation_count"] >= 1

        published = api["client"].post(
            f"/scheduling/scenarios/{candidate_id}/publish",
            json={
                "baseline_schedule_id": baseline_id,
                "scenario_name": "Approved Gantt candidate",
                "allow_review": True,
            },
        )
        assert published.status_code == 200
        publish_data = published.json()
        assert publish_data["schedule_id"] == candidate_id
        assert publish_data["lifecycle_status"] == "published"
        assert publish_data["publish_status"] in {"publishable", "review"}
        state = api["client"].get("/planning/state")
        assert state.status_code == 200
        assert state.json()["active_baseline_schedule_id"] == candidate_id
        assert state.json()["active_candidate_schedule_id"] is None

    def test_edit_preview_pin_unfreezes_overlapping_baseline_operation(self, api):
        for work_order_id, operation_id, name in [
            ("WO-PIN-A", "PIN-A", "Pinned conflict A"),
            ("WO-PIN-B", "PIN-B", "Pinned operation B"),
        ]:
            api["work_orders"].add(
                WorkOrder(
                    id=work_order_id,
                    name=work_order_id,
                    product_id="P-PIN",
                    quantity=1,
                    due_date=MONDAY + timedelta(days=2),
                    release_date=MONDAY,
                    operations=[
                        Operation(
                            id=operation_id,
                            work_order_id=work_order_id,
                            sequence=1,
                            name=name,
                            duration=Duration(minutes=60),
                            eligible_machine_ids=["M1"],
                        )
                    ],
                )
            )

        baseline = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert baseline.status_code == 200
        baseline_id = baseline.json()["schedule_id"]

        preview = api["client"].post(
            f"/scheduling/runs/{baseline_id}/edits/preview",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "greedy",
                "edits": [
                    {
                        "edit_type": "move_operation",
                        "operation_id": "PIN-B",
                        "machine_id": "M1",
                        "start": (MONDAY + timedelta(hours=8)).isoformat(),
                        "end": (MONDAY + timedelta(hours=9)).isoformat(),
                    }
                ],
            },
        )

        assert preview.status_code == 200
        assignments = {
            item["operation_id"]: item
            for item in preview.json()["preview"]["assignments"]
        }
        assert assignments["PIN-B"]["start"] == (
            MONDAY + timedelta(hours=8)
        ).isoformat()
        assert assignments["PIN-B"]["end"] == (
            MONDAY + timedelta(hours=9)
        ).isoformat()
        assert assignments["PIN-A"]["start"] >= (
            MONDAY + timedelta(hours=9)
        ).isoformat()
        diagnostics = preview.json()["preview"]["diagnostics"]
        assert diagnostics["planner_actions"]["frozen_count"] == 1
        assert diagnostics["stability_report"]["changed_operation_count"] >= 1
        gantt_items = {
            item["operation_id"]: item
            for item in preview.json()["gantt"]["items"]
        }
        assert gantt_items["PIN-B"]["changed_from_baseline"] is True
        assert gantt_items["PIN-A"]["changed_from_baseline"] is True

    def test_edit_preview_contract_blocks_secondary_resource_double_booking(
        self, api
    ):
        api["resources"].add(
            Resource(id="TOOL-UI", name="Shared UI fixture", capacity=1)
        )
        for work_order_id, operation_id in [
            ("WO-UI-RESOURCE-A", "UI-RESOURCE-A"),
            ("WO-UI-RESOURCE-B", "UI-RESOURCE-B"),
        ]:
            api["work_orders"].add(
                WorkOrder(
                    id=work_order_id,
                    name=work_order_id,
                    product_id="P-UI",
                    quantity=1,
                    due_date=MONDAY + timedelta(days=2),
                    release_date=MONDAY,
                    operations=[
                        Operation(
                            id=operation_id,
                            work_order_id=work_order_id,
                            sequence=1,
                            name=operation_id,
                            duration=Duration(minutes=60),
                            eligible_machine_ids=["M1", "M2"],
                            resource_requirements=[
                                ResourceRequirement(resource_id="TOOL-UI")
                            ],
                        )
                    ],
                )
            )

        baseline = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "greedy",
                "persist": True,
            },
        )
        assert baseline.status_code == 200
        baseline_id = baseline.json()["schedule_id"]

        preview = api["client"].post(
            f"/scheduling/runs/{baseline_id}/edits/preview",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "auto",
                "reschedule_mode": "repair_local",
                "edits": [
                    {
                        "edit_type": "move_operation",
                        "operation_id": "UI-RESOURCE-B",
                        "machine_id": "M2",
                        "start": (MONDAY + timedelta(hours=8)).isoformat(),
                        "end": (MONDAY + timedelta(hours=9)).isoformat(),
                    }
                ],
            },
        )

        assert preview.status_code == 422
        error = preview.json()
        assert error["error"] == "invalid_request"
        assert (
            "pin_operation_window for operation 'UI-RESOURCE-B' overbooks"
            in error["message"]
        )
        assert "secondary resource 'TOOL-UI'" in error["message"]
        assert "Suggested action: move_or_delay_pin." in error["message"]
        assert (
            "Candidate actions: move_operation, pin_operation_window, add_overtime."
            in error["message"]
        )

    def test_run_history_persists_workspace_and_scenario_context(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-CONTEXT",
                name="WO-CONTEXT",
                product_id="P-CONTEXT",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="CTX-1",
                        work_order_id="WO-CONTEXT",
                        sequence=1,
                        name="CTX-1",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1"],
                    )
                ],
            )
        )

        run = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": True,
                "workspace_id": "plant-montreal",
                "scenario_name": "Week 02 baseline",
                "lifecycle_status": "candidate",
            },
        )

        assert run.status_code == 200
        run_data = run.json()
        assert run_data["workspace_id"] == "plant-montreal"
        assert run_data["scenario_name"] == "Week 02 baseline"
        assert run_data["lifecycle_status"] == "candidate"

        history = api["client"].get(
            "/scheduling/runs",
            params={"workspace_id": "plant-montreal", "lifecycle_status": "candidate"},
        )
        assert history.status_code == 200
        history_data = history.json()
        assert len(history_data) == 1
        assert history_data[0]["schedule_id"] == run_data["schedule_id"]
        assert history_data[0]["workspace_id"] == "plant-montreal"
        assert history_data[0]["scenario_name"] == "Week 02 baseline"
        assert history_data[0]["lifecycle_status"] == "candidate"

    def test_disruption_inherits_schedule_product_context(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-DISR",
                name="WO-DISR",
                product_id="P-DISR",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="DISR-1",
                        work_order_id="WO-DISR",
                        sequence=1,
                        name="DISR-1",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1"],
                    )
                ],
            )
        )

        initial = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": True,
                "workspace_id": "plant-quebec",
                "scenario_name": "Published weekly plan",
                "lifecycle_status": "published",
            },
        )
        assert initial.status_code == 200
        initial_id = initial.json()["schedule_id"]

        disruption = api["client"].post(
            "/scheduling/disruption",
            json={
                "schedule_id": initial_id,
                "strategy": "greedy",
                "persist": True,
                "event": {
                    "disruption_type": "machine_down",
                    "timestamp": (MONDAY + timedelta(hours=9)).isoformat(),
                    "machine_id": "M1",
                    "event_end": (MONDAY + timedelta(hours=11)).isoformat(),
                },
            },
        )
        assert disruption.status_code == 200
        disruption_data = disruption.json()
        assert disruption_data["workspace_id"] == "plant-quebec"
        assert disruption_data["scenario_name"] == "Published weekly plan"
        assert disruption_data["lifecycle_status"] == "draft"
        assert "planner_diagnostics" in disruption_data["diagnostics"]
        assert disruption_data["analysis"] is not None
        assert len(disruption_data["analysis"]["gantt"]) == 1

    def test_run_context_can_be_promoted_after_creation(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-LIFECYCLE",
                name="WO-LIFECYCLE",
                product_id="P-LIFECYCLE",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="LIFE-1",
                        work_order_id="WO-LIFECYCLE",
                        sequence=1,
                        name="LIFE-1",
                        duration=Duration(minutes=45),
                        eligible_machine_ids=["M1"],
                    )
                ],
            )
        )

        run = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": True,
                "workspace_id": "plant-montreal",
                "scenario_name": "Weekly freeze",
                "lifecycle_status": "draft",
            },
        )
        assert run.status_code == 200
        schedule_id = run.json()["schedule_id"]

        update = api["client"].patch(
            f"/scheduling/runs/{schedule_id}/context",
            json={
                "lifecycle_status": "published",
                "scenario_name": "Weekly freeze approved",
            },
        )
        assert update.status_code == 200
        update_data = update.json()
        assert update_data["workspace_id"] == "plant-montreal"
        assert update_data["scenario_name"] == "Weekly freeze approved"
        assert update_data["lifecycle_status"] == "published"

    def test_scenario_compare_route_compares_persisted_runs(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-SCENARIO",
                name="WO-SCENARIO",
                product_id="P-SCENARIO",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="SCENARIO-1",
                        work_order_id="WO-SCENARIO",
                        sequence=1,
                        name="SCENARIO-1",
                        duration=Duration(minutes=45),
                        eligible_machine_ids=["M1"],
                    )
                ],
            )
        )

        baseline = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": True,
                "scenario_name": "Baseline plan",
            },
        )
        candidate = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": True,
                "scenario_name": "What-if plan",
            },
        )
        assert baseline.status_code == 200
        assert candidate.status_code == 200
        baseline_id = baseline.json()["schedule_id"]
        candidate_id = candidate.json()["schedule_id"]

        comparison = api["client"].post(
            "/scheduling/scenarios/compare",
            json={
                "baseline_schedule_id": baseline_id,
                "candidate_schedule_ids": [candidate_id],
            },
        )

        assert comparison.status_code == 200
        data = comparison.json()
        assert data["baseline"]["schedule_id"] == baseline_id
        assert data["baseline"]["workspace_id"] == "default"
        assert data["baseline"]["horizon_start"] == MONDAY.isoformat()
        assert data["baseline"]["input_snapshot_hash"]
        assert data["baseline"]["engine_version"] == "aps-engine.v1"
        assert data["comparisons"][0]["candidate"]["schedule_id"] == candidate_id
        assert data["comparisons"][0]["publish_status"] == "publishable"
        assert data["recommended_schedule_id"] == candidate_id
        assert data["publishable_schedule_ids"] == [candidate_id]
        assert data["summary"]["comparison_count"] == 1

    def test_publish_scenario_route_promotes_persisted_run(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-PUBLISH",
                name="WO-PUBLISH",
                product_id="P-PUBLISH",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="PUBLISH-1",
                        work_order_id="WO-PUBLISH",
                        sequence=1,
                        name="PUBLISH-1",
                        duration=Duration(minutes=45),
                        eligible_machine_ids=["M1"],
                    )
                ],
            )
        )
        run = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "strategy": "greedy",
                "persist": True,
                "scenario_name": "Candidate plan",
            },
        )
        assert run.status_code == 200
        schedule_id = run.json()["schedule_id"]

        publish = api["client"].post(
            f"/scheduling/scenarios/{schedule_id}/publish",
            json={"scenario_name": "Approved plan"},
        )

        assert publish.status_code == 200
        data = publish.json()
        assert data["schedule_id"] == schedule_id
        assert data["scenario_name"] == "Approved plan"
        assert data["lifecycle_status"] == "published"
        assert data["publish_status"] == "publishable"
        assert data["metadata"]["input_snapshot_hash"]
        assert data["metadata"]["engine_version"] == "aps-engine.v1"

        history = api["client"].get("/scheduling/runs")
        published = next(
            item for item in history.json() if item["schedule_id"] == schedule_id
        )
        assert published["scenario_name"] == "Approved plan"
        assert published["lifecycle_status"] == "published"

    def test_run_route_handles_reference_workshop(self, api):
        workshop = build_reference_workshop()
        for work_order in workshop.work_orders:
            api["work_orders"].add(work_order)
        for calendar in workshop.calendars:
            api["calendars"].add(calendar)
        for machine in workshop.machines:
            api["machines"].add(machine)
        for resource in workshop.resources:
            api["resources"].add(resource)

        response = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": workshop.horizon_start.isoformat(),
                "horizon_days": 5,
                "strategy": "greedy",
                "persist": False,
                "transfer_times": {
                    "default_minutes": workshop.transfer_times.default_minutes,
                    "pairs": [
                        {
                            "from_machine": src,
                            "to_machine": dst,
                            "minutes": minutes,
                        }
                        for (src, dst), minutes in workshop.transfer_times.pairs.items()
                    ],
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["summary"]["scheduled_operation_count"] == 4
        assert data["summary"]["work_order_count"] == 2
        assert any("Bottleneck is" in h for h in data["summary"]["highlights"])
        assert isinstance(data["diagnostics"]["decision_trace"], list)
        assert "planner_diagnostics" in data["diagnostics"]
        assert data["diagnostics"]["planner_diagnostics"]["language_version"] == "planner-v1"
        assert isinstance(data["diagnostics"]["planner_diagnostics"]["notes"], list)
        assert any(
            entry["operation_id"] == "RED-ASM"
            for entry in data["diagnostics"]["decision_trace"]
        )

    def test_auto_what_if_run_uses_hybrid_forward_backward_strategy(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-AUTO-WHATIF",
                name="WO-AUTO-WHATIF",
                product_id="P-AUTO",
                quantity=1,
                due_date=MONDAY + timedelta(days=2),
                release_date=MONDAY,
                operations=[
                    Operation(
                        id="AUTO-WHATIF-1",
                        work_order_id="WO-AUTO-WHATIF",
                        sequence=1,
                        name="AUTO-WHATIF-1",
                        duration=Duration(minutes=60),
                        eligible_machine_ids=["M1", "M2"],
                    )
                ],
            )
        )

        response = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 5,
                "strategy": "auto",
                "persist": False,
                "lifecycle_status": "what_if",
            },
        )

        assert response.status_code == 200
        data = response.json()
        decision = data["diagnostics"]["decision_layer"]
        assert data["strategy"] == "hybrid"
        assert decision["selected_strategy"] == "hybrid"
        assert decision["rules_triggered"] == ["scenario_forward_backward"]
        assert data["diagnostics"]["hybrid_mode"] == "forward_backward"
        assert data["diagnostics"]["winner_strategy"] in {"greedy", "backward"}

    def test_compare_route_handles_reference_workshop(self, api):
        workshop = build_reference_workshop()
        for work_order in workshop.work_orders:
            api["work_orders"].add(work_order)
        for calendar in workshop.calendars:
            api["calendars"].add(calendar)
        for machine in workshop.machines:
            api["machines"].add(machine)
        for resource in workshop.resources:
            api["resources"].add(resource)

        response = api["client"].post(
            "/scheduling/compare",
            json={
                "horizon_start": workshop.horizon_start.isoformat(),
                "horizon_days": 5,
                "strategies": ["greedy", "backward"],
                "transfer_times": {
                    "default_minutes": workshop.transfer_times.default_minutes,
                    "pairs": [
                        {
                            "from_machine": src,
                            "to_machine": dst,
                            "minutes": minutes,
                        }
                        for (src, dst), minutes in workshop.transfer_times.pairs.items()
                    ],
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["runs"]) == 2
        assert data["summary"]["successful_runs"] == 2
        assert data["summary"]["shortest_makespan_strategy"] in {"greedy", "backward"}
        assert any(
            "Shortest makespan comes from" in h
            for h in data["summary"]["highlights"]
        )
        assert any(
            card["dimension"] == "on_time_ratio"
            for card in data["summary"]["tradeoff_cards"]
        )
        assert all(run["summary"]["scheduled_operation_count"] == 4 for run in data["runs"])
        assert all("planner_diagnostics" in run["diagnostics"] for run in data["runs"])
        assert all(run["profile"]["planning_mode"] in {"online_dispatch", "just_in_time"} for run in data["runs"])
        assert all(
            run["diagnostics"]["planner_diagnostics"]["language_version"] == "planner-v1"
            for run in data["runs"]
        )
        assert all(isinstance(run["diagnostics"].get("decision_trace"), list) for run in data["runs"])
        assert any(
            card["context"] == "operational_default"
            for card in data["summary"]["qualification_cards"]
        )

    def test_compare_route_qualifies_operational_vs_strategic_strategies(self, api):
        workshop = build_reference_workshop()
        for work_order in workshop.work_orders:
            api["work_orders"].add(work_order)
        for calendar in workshop.calendars:
            api["calendars"].add(calendar)
        for machine in workshop.machines:
            api["machines"].add(machine)
        for resource in workshop.resources:
            api["resources"].add(resource)

        response = api["client"].post(
            "/scheduling/compare",
            json={
                "horizon_start": workshop.horizon_start.isoformat(),
                "horizon_days": 5,
                "strategies": ["greedy", "backward", "cpsat"],
                "transfer_times": {
                    "default_minutes": workshop.transfer_times.default_minutes,
                    "pairs": [
                        {
                            "from_machine": src,
                            "to_machine": dst,
                            "minutes": minutes,
                        }
                        for (src, dst), minutes in workshop.transfer_times.pairs.items()
                    ],
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["runs"]) == 3
        assert data["summary"]["recommended_for_disruption"] == "greedy"
        assert data["summary"]["recommended_for_what_if"] == "cpsat"
        assert any(
            "improves objective by" in h
            for h in data["summary"]["qualification_highlights"]
        )
        cpsat = next(run for run in data["runs"] if run["strategy"] == "cpsat")
        assert cpsat["profile"]["planning_mode"] == "strategic_what_if"
        assert cpsat["profile"]["recommended_for_disruption"] is False
        disruption_card = next(
            card for card in data["summary"]["qualification_cards"] if card["context"] == "disruption"
        )
        assert disruption_card["recommended_strategy"] == "greedy"
        assert disruption_card["evidence"]["reference_strategy"] == "greedy"
        what_if_card = next(
            card for card in data["summary"]["qualification_cards"] if card["context"] == "what_if"
        )
        assert what_if_card["recommended_strategy"] == "cpsat"
        assert what_if_card["evidence"]["reference_strategy"] == "greedy"
        assert what_if_card["evidence"]["objective_gap_vs_best_operational"] == 5
        assert what_if_card["evidence"]["makespan_delta_vs_best_operational"] == 5

    def test_compare_route_recommends_backward_for_just_in_time_when_kpis_tie(self, api):
        api["work_orders"].add(
            WorkOrder(
                id="WO-JIT",
                name="WO-JIT",
                product_id="P-JIT",
                quantity=1,
                due_date=MONDAY + timedelta(days=1, hours=17),
                release_date=MONDAY + timedelta(hours=8),
                priority=Priority.NORMAL,
                operations=[
                    Operation(
                        id="JIT-1",
                        work_order_id="WO-JIT",
                        sequence=1,
                        name="JIT-1",
                        duration=Duration(minutes=120),
                        eligible_machine_ids=["M1"],
                    ),
                    Operation(
                        id="JIT-2",
                        work_order_id="WO-JIT",
                        sequence=2,
                        name="JIT-2",
                        duration=Duration(minutes=120),
                        eligible_machine_ids=["M1"],
                        dependencies=["JIT-1"],
                    ),
                ],
            )
        )

        response = api["client"].post(
            "/scheduling/compare",
            json={
                "horizon_start": MONDAY.isoformat(),
                "horizon_days": 3,
                "strategies": ["greedy", "backward"],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["summary"]["recommended_for_disruption"] == "greedy"
        assert data["summary"]["recommended_for_just_in_time"] == "backward"
        assert any(
            "without sacrificing due-date service" in h
            for h in data["summary"]["qualification_highlights"]
        )
        jit_card = next(
            card for card in data["summary"]["qualification_cards"] if card["context"] == "just_in_time"
        )
        assert jit_card["recommended_strategy"] == "backward"
        assert jit_card["evidence"]["reference_strategy"] == "greedy"
        assert jit_card["evidence"]["objective_gap_vs_best_operational"] > 0
        assert jit_card["evidence"]["lateness_gap_vs_best_operational"] == 0
        assert jit_card["evidence"]["on_time_ratio_gap_vs_best_operational"] == 0.0

    def test_disruption_route_handles_reference_workshop(self, api):
        workshop = build_reference_workshop()
        for work_order in workshop.work_orders:
            api["work_orders"].add(work_order)
        for calendar in workshop.calendars:
            api["calendars"].add(calendar)
        for machine in workshop.machines:
            api["machines"].add(machine)
        for resource in workshop.resources:
            api["resources"].add(resource)

        initial = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": workshop.horizon_start.isoformat(),
                "horizon_days": 5,
                "strategy": "greedy",
                "persist": True,
                "transfer_times": {
                    "default_minutes": workshop.transfer_times.default_minutes,
                    "pairs": [
                        {
                            "from_machine": src,
                            "to_machine": dst,
                            "minutes": minutes,
                        }
                        for (src, dst), minutes in workshop.transfer_times.pairs.items()
                    ],
                },
            },
        )
        assert initial.status_code == 200

        disruption = api["client"].post(
            "/scheduling/disruption",
            json={
                "schedule_id": initial.json()["schedule_id"],
                "strategy": "greedy",
                "event": {
                    "disruption_type": "machine_down",
                    "timestamp": "2026-01-05T12:00:00",
                    "machine_id": "ASM-1",
                    "event_end": "2026-01-05T17:00:00",
                },
            },
        )

        assert disruption.status_code == 200
        data = disruption.json()
        assert data["summary"]["scheduled_operation_count"] == 4
        assert data["analysis"] is not None
        assert any("Disruption machine_down applied" in h for h in data["summary"]["highlights"])
        impact = data["diagnostics"]["disruption_impact"]
        assert impact["changed_operation_count"] >= 0
        assert impact["machine_change_count"] >= 0
        assert any(
            "No scheduled operations needed to move after disruption." in h
            or "changed timing or machine after disruption." in h
            for h in data["summary"]["highlights"]
        )

    def test_disruption_route_accepts_transfer_times_and_persist_false(self, api):
        workshop = build_reference_workshop()
        for work_order in workshop.work_orders:
            api["work_orders"].add(work_order)
        for calendar in workshop.calendars:
            api["calendars"].add(calendar)
        for machine in workshop.machines:
            api["machines"].add(machine)
        for resource in workshop.resources:
            api["resources"].add(resource)

        transfer_payload = {
            "default_minutes": workshop.transfer_times.default_minutes,
            "pairs": [
                {
                    "from_machine": src,
                    "to_machine": dst,
                    "minutes": minutes,
                }
                for (src, dst), minutes in workshop.transfer_times.pairs.items()
            ],
        }

        initial = api["client"].post(
            "/scheduling/run",
            json={
                "horizon_start": workshop.horizon_start.isoformat(),
                "horizon_days": 5,
                "strategy": "greedy",
                "persist": True,
                "transfer_times": transfer_payload,
            },
        )
        assert initial.status_code == 200
        initial_id = initial.json()["schedule_id"]

        history_before = api["client"].get("/scheduling/runs")
        assert history_before.status_code == 200
        assert len(history_before.json()) == 1

        disruption = api["client"].post(
            "/scheduling/disruption",
            json={
                "schedule_id": initial_id,
                "horizon_days": 5,
                "strategy": "greedy",
                "persist": False,
                "transfer_times": transfer_payload,
                "event": {
                    "disruption_type": "rush_order",
                    "timestamp": "2026-01-05T11:00:00",
                    "rush_order": {
                        "id": workshop.rush_order.id,
                        "name": workshop.rush_order.name,
                        "product_id": workshop.rush_order.product_id,
                        "quantity": workshop.rush_order.quantity,
                        "due_date": workshop.rush_order.due_date.isoformat(),
                        "release_date": workshop.rush_order.release_date.isoformat(),
                        "priority": int(workshop.rush_order.priority.value),
                        "operations": [
                            {
                                "id": operation.id,
                                "sequence": operation.sequence,
                                "name": operation.name,
                                "duration_minutes": operation.duration.minutes,
                                "setup_minutes": operation.setup_time.minutes,
                                "eligible_machine_ids": list(operation.eligible_machine_ids),
                                "dependencies": list(operation.dependencies),
                                "setup_family": operation.setup_family,
                                "preemptible": operation.preemptible,
                                "min_chunk_minutes": operation.min_chunk.minutes,
                                "resource_requirements": [
                                    {
                                        "resource_id": req.resource_id,
                                        "units": req.units,
                                    }
                                    for req in operation.resource_requirements
                                ],
                                "routings": [
                                    {
                                        "machine_id": routing.machine_id,
                                        "duration_minutes": routing.duration.minutes,
                                        "setup_minutes": routing.setup_time.minutes,
                                        "resource_requirements": [
                                            {
                                                "resource_id": req.resource_id,
                                                "units": req.units,
                                            }
                                            for req in routing.resource_requirements
                                        ],
                                    }
                                    for routing in operation.routings
                                ],
                            }
                            for operation in workshop.rush_order.operations
                        ],
                    },
                },
            },
        )

        assert disruption.status_code == 200
        data = disruption.json()
        assert any(
            entry.get("transfer_delay_minutes", 0) > 0
            for entry in data["diagnostics"]["decision_trace"]
        )
        assert "disruption_impact" in data["diagnostics"]
        assert data["diagnostics"]["disruption_impact"]["introduced_operation_count"] == 2

        history_after = api["client"].get("/scheduling/runs")
        assert history_after.status_code == 200
        after_runs = history_after.json()
        assert len(after_runs) == 1
        assert after_runs[0]["schedule_id"] == initial_id
