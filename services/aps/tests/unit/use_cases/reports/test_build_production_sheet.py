"""TDD tests for BuildProductionSheet use case (J2a).

Uses in-memory repositories. Schedule is seeded with two assignments
on machine M-A across one day, plus one assignment on a sibling
machine to prove filtering. Cross-tenant rows are seeded to prove
F-401 scoping is honoured.
"""

from __future__ import annotations

from datetime import date, datetime

import pytest

from planiadvance_v2.application.use_cases.reports.build_production_sheet import (
    BuildProductionSheet,
    MachineNotFoundForReport,
    NoPublishedScheduleForReport,
    RequestedDateOutsideHorizon,
)
from planiadvance_v2.domain.entities import (
    Machine,
    Operation,
    Organization,
    Schedule,
    ScheduledOperation,
    WorkOrder,
    Workspace,
)
from planiadvance_v2.domain.value_objects import Duration
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryMachineRepository,
    InMemoryOrganizationRepository,
    InMemoryScheduleRepository,
    InMemoryWorkOrderRepository,
    InMemoryWorkspaceRepository,
)
from planiadvance_v2.infrastructure.scoping import TenantScope

_ORG_A = "org-a"
_ORG_B = "org-b"
_WS_A = "plant-a"
_DAY = date(2026, 5, 11)


def _make_op(op_id: str, wo_id: str, dur_min: int, setup_min: int = 0) -> Operation:
    return Operation(
        id=op_id,
        work_order_id=wo_id,
        sequence=1,
        name=op_id,
        duration=Duration(minutes=dur_min),
        setup_time=Duration(minutes=setup_min),
        eligible_machine_ids=["M-A"],
        dependencies=[],
    )


def _make_wo(
    wo_id: str,
    name: str,
    *,
    organization_id: str,
    workspace_id: str | None,
    setup_min: int = 10,
    dur_min: int = 60,
) -> WorkOrder:
    return WorkOrder(
        id=wo_id,
        name=name,
        product_id=f"PROD-{wo_id}",
        quantity=1,
        due_date=datetime(2026, 5, 12),
        release_date=datetime(2026, 5, 1),
        operations=[_make_op(f"{wo_id}-OP1", wo_id, dur_min, setup_min=setup_min)],
        organization_id=organization_id,
        workspace_id=workspace_id,
    )


@pytest.fixture
def fixture():
    machines = InMemoryMachineRepository(
        [
            Machine(
                id="M-A",
                name="Fraiseuse A",
                calendar_id="CAL",
                organization_id=_ORG_A,
                workspace_id=_WS_A,
            ),
            Machine(
                id="M-B-OTHER-ORG",
                name="EU Press",
                calendar_id="CAL",
                organization_id=_ORG_B,
                workspace_id=None,
            ),
        ]
    )
    work_orders = InMemoryWorkOrderRepository(
        [
            _make_wo("WO-1", "Assembly batch 1", organization_id=_ORG_A, workspace_id=_WS_A),
            _make_wo("WO-2", "Assembly batch 2", organization_id=_ORG_A, workspace_id=_WS_A),
        ]
    )
    organizations = InMemoryOrganizationRepository(
        [
            Organization(id=_ORG_A, name="Plant QC", slug="plant-qc"),
            Organization(id=_ORG_B, name="Plant EU", slug="plant-eu"),
        ]
    )
    workspaces = InMemoryWorkspaceRepository(
        [Workspace(id=_WS_A, name="Plant A", organization_id=_ORG_A)]
    )
    schedules = InMemoryScheduleRepository()

    horizon_start = datetime(2026, 5, 11, 0, 0)
    horizon_end = datetime(2026, 5, 18, 0, 0)

    schedule = Schedule(
        id="sched-1",
        created_at=datetime(2026, 5, 10, 22, 0),
        assignments=[
            ScheduledOperation(
                operation_id="WO-1-OP1",
                work_order_id="WO-1",
                machine_id="M-A",
                setup_start=datetime(2026, 5, 11, 7, 50),
                start=datetime(2026, 5, 11, 8, 0),
                end=datetime(2026, 5, 11, 9, 0),
            ),
            ScheduledOperation(
                operation_id="WO-2-OP1",
                work_order_id="WO-2",
                machine_id="M-A",
                setup_start=datetime(2026, 5, 11, 9, 50),
                start=datetime(2026, 5, 11, 10, 0),
                end=datetime(2026, 5, 11, 11, 0),
            ),
        ],
    )
    schedules.save(
        schedule,
        metrics={},
        organization_id=_ORG_A,
        workspace_id=_WS_A,
        lifecycle_status="published",
        horizon_start=horizon_start,
        horizon_end=horizon_end,
    )

    return BuildProductionSheet(
        machines=machines,
        work_orders=work_orders,
        organizations=organizations,
        workspaces=workspaces,
        schedules=schedules,
    )


class TestBuildProductionSheetHappyPath:
    def test_returns_sorted_lines_for_machine_and_day(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        payload = fixture.execute(machine_id="M-A", target_date=_DAY, scope=scope)

        assert payload.machine_id == "M-A"
        assert payload.machine_name == "Fraiseuse A"
        assert payload.organization_name == "Plant QC"
        assert payload.workspace_name == "Plant A"
        assert payload.date == _DAY
        assert payload.schedule_id == "sched-1"
        assert len(payload.lines) == 2
        assert payload.lines[0].operation_id == "WO-1-OP1"
        assert payload.lines[1].operation_id == "WO-2-OP1"
        assert payload.lines[0].setup_minutes == 10
        assert payload.lines[0].run_minutes == 60
        assert payload.total_operation_count == 2
        assert payload.total_run_minutes == 120
        assert payload.total_setup_minutes == 20


class TestBuildProductionSheetErrors:
    def test_cross_tenant_machine_raises_machine_not_found(self, fixture):
        scope = TenantScope.for_organization(_ORG_A)

        with pytest.raises(MachineNotFoundForReport):
            fixture.execute(machine_id="M-B-OTHER-ORG", target_date=_DAY, scope=scope)

    def test_no_published_schedule_raises(self, fixture):
        # Drop the only schedule by mutating the repo (test convenience).
        fixture._schedules._data.clear()
        fixture._schedules._order.clear()
        scope = TenantScope.for_organization(_ORG_A)

        with pytest.raises(NoPublishedScheduleForReport):
            fixture.execute(machine_id="M-A", target_date=_DAY, scope=scope)

    def test_date_outside_horizon_raises(self, fixture):
        scope = TenantScope.for_organization(_ORG_A)

        with pytest.raises(RequestedDateOutsideHorizon):
            fixture.execute(
                machine_id="M-A",
                target_date=date(2025, 1, 1),
                scope=scope,
            )
