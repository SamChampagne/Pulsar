"""TDD tests for BuildWoTraveler.

Uses in-memory repositories. The schedule contains assignments for
two operations of the target WO; a third op is left unplanned to
exercise the partial-plan path. A WO from another organization
confirms F-401 scoping.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from planiadvance_v2.application.use_cases.reports import (
    NoPublishedScheduleForReport,
)
from planiadvance_v2.application.use_cases.reports.build_wo_traveler import (
    BuildWoTraveler,
    WorkOrderNotFoundForReport,
)
from planiadvance_v2.domain.entities import (
    MaterialRequirement,
    Operation,
    Organization,
    Schedule,
    ScheduledOperation,
    WorkOrder,
    Workspace,
)
from planiadvance_v2.domain.value_objects import Duration, Priority
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryOrganizationRepository,
    InMemoryScheduleRepository,
    InMemoryWorkOrderRepository,
    InMemoryWorkspaceRepository,
)
from planiadvance_v2.infrastructure.scoping import TenantScope

_ORG_A = "org-a"
_ORG_B = "org-b"
_WS_A = "ws-a"


def _op(
    op_id: str,
    wo_id: str,
    *,
    sequence: int,
    eligible: tuple[str, ...] = ("M-A",),
    materials: tuple[MaterialRequirement, ...] = (),
    duration_min: int = 60,
    setup_min: int = 10,
) -> Operation:
    return Operation(
        id=op_id,
        work_order_id=wo_id,
        sequence=sequence,
        name=f"Op {sequence}",
        duration=Duration(minutes=duration_min),
        setup_time=Duration(minutes=setup_min),
        eligible_machine_ids=list(eligible),
        dependencies=[],
        material_requirements=list(materials),
    )


def _wo(
    wo_id: str,
    *,
    operations: list[Operation],
    organization_id: str = _ORG_A,
    workspace_id: str | None = _WS_A,
    quantity: int = 5,
    priority: Priority = Priority.HIGH,
) -> WorkOrder:
    return WorkOrder(
        id=wo_id,
        name=f"WO {wo_id}",
        product_id=f"PROD-{wo_id}",
        quantity=quantity,
        due_date=datetime(2026, 5, 12, 17, 0),
        release_date=datetime(2026, 5, 4, 8, 0),
        operations=operations,
        priority=priority,
        organization_id=organization_id,
        workspace_id=workspace_id,
    )


def _scheduled(
    op_id: str,
    wo_id: str,
    *,
    machine: str = "M-A",
    start: datetime,
    duration_min: int = 60,
) -> ScheduledOperation:
    return ScheduledOperation(
        operation_id=op_id,
        work_order_id=wo_id,
        machine_id=machine,
        setup_start=start - timedelta(minutes=10),
        start=start,
        end=start + timedelta(minutes=duration_min),
    )


@pytest.fixture
def fixture():
    target_ops = [
        _op(
            "WO-1-OP1",
            "WO-1",
            sequence=1,
            eligible=("M-A", "M-B"),
            materials=(
                MaterialRequirement(material_id="RAW-AL", quantity_per_unit=0.5),
                MaterialRequirement(material_id="STEEL", fixed_quantity=1.0),
            ),
        ),
        _op(
            "WO-1-OP2",
            "WO-1",
            sequence=2,
            eligible=("M-C",),
            materials=(
                MaterialRequirement(material_id="PAINT-RED", quantity_per_unit=0.1),
            ),
        ),
        _op("WO-1-OP3", "WO-1", sequence=3, eligible=("M-D",)),
    ]
    target_wo = _wo("WO-1", operations=target_ops)

    other_tenant_wo = _wo(
        "WO-OTHER",
        operations=[_op("WO-OTHER-OP1", "WO-OTHER", sequence=1)],
        organization_id=_ORG_B,
        workspace_id=None,
    )

    work_orders_repo = InMemoryWorkOrderRepository([target_wo, other_tenant_wo])
    organizations = InMemoryOrganizationRepository(
        [
            Organization(id=_ORG_A, name="Plant QC", slug="plant-qc"),
            Organization(id=_ORG_B, name="Plant EU", slug="plant-eu"),
        ]
    )
    workspaces = InMemoryWorkspaceRepository(
        [Workspace(id=_WS_A, name="Plant A", organization_id=_ORG_A)]
    )

    schedule = Schedule(
        id="sched-1",
        created_at=datetime(2026, 5, 7, 9, 14),
        assignments=[
            _scheduled(
                "WO-1-OP1", "WO-1", machine="M-A", start=datetime(2026, 5, 5, 8, 0)
            ),
            _scheduled(
                "WO-1-OP2", "WO-1", machine="M-C", start=datetime(2026, 5, 6, 10, 0)
            ),
        ],
    )
    schedules = InMemoryScheduleRepository()
    schedules.save(
        schedule,
        metrics={},
        organization_id=_ORG_A,
        workspace_id=_WS_A,
        lifecycle_status="published",
        horizon_start=datetime(2026, 5, 5, 0, 0),
        horizon_end=datetime(2026, 5, 12, 0, 0),
        diagnostics={
            "material_pegging_report": {
                "status": "short",
                "pegging_records": [
                    {
                        "operation_id": "WO-1-OP1",
                        "material_id": "RAW-AL",
                        "coverage_status": "covered",
                    },
                    {
                        "operation_id": "WO-1-OP1",
                        "material_id": "STEEL",
                        "coverage_status": "short",
                    },
                ],
            },
        },
    )

    return BuildWoTraveler(
        work_orders=work_orders_repo,
        organizations=organizations,
        workspaces=workspaces,
        schedules=schedules,
    )


class TestBuildWoTravelerHappyPath:
    def test_returns_full_payload_with_planned_and_unplanned_ops(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        payload = fixture.execute(work_order_id="WO-1", scope=scope)

        assert payload.organization_name == "Plant QC"
        assert payload.workspace_name == "Plant A"
        assert payload.schedule_id == "sched-1"
        assert payload.work_order_ref == "WO-1"
        assert payload.product_id == "PROD-WO-1"
        assert payload.quantity == 5
        assert payload.priority == "HIGH"
        assert payload.due_date == datetime(2026, 5, 12, 17, 0)
        assert payload.release_date == datetime(2026, 5, 4, 8, 0)
        assert len(payload.operations) == 3
        assert [op.sequence for op in payload.operations] == [1, 2, 3]
        assert payload.planned_start == datetime(2026, 5, 5, 8, 0)
        assert payload.planned_end == datetime(2026, 5, 6, 11, 0)

    def test_planned_op_has_machine_and_dates(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        payload = fixture.execute(work_order_id="WO-1", scope=scope)

        op1 = next(op for op in payload.operations if op.operation_id == "WO-1-OP1")
        assert op1.planned_machine_id == "M-A"
        assert op1.planned_start == datetime(2026, 5, 5, 8, 0)
        assert op1.planned_end == datetime(2026, 5, 5, 9, 0)
        assert op1.eligible_machine_ids == ("M-A", "M-B")
        assert op1.setup_minutes == 10
        assert op1.run_minutes == 60

    def test_unplanned_op_has_none_dates(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        payload = fixture.execute(work_order_id="WO-1", scope=scope)

        op3 = next(op for op in payload.operations if op.operation_id == "WO-1-OP3")
        assert op3.planned_machine_id is None
        assert op3.planned_start is None
        assert op3.planned_end is None
        assert op3.eligible_machine_ids == ("M-D",)

    def test_material_coverage_resolved_from_pegging(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        payload = fixture.execute(work_order_id="WO-1", scope=scope)

        op1 = next(op for op in payload.operations if op.operation_id == "WO-1-OP1")
        materials = {m.material_id: m for m in op1.materials}
        assert materials["RAW-AL"].coverage_status == "covered"
        assert materials["RAW-AL"].required_quantity == pytest.approx(2.5)
        assert materials["STEEL"].coverage_status == "short"
        assert materials["STEEL"].required_quantity == pytest.approx(1.0)

        op2 = next(op for op in payload.operations if op.operation_id == "WO-1-OP2")
        materials_op2 = {m.material_id: m for m in op2.materials}
        assert materials_op2["PAINT-RED"].coverage_status == "unknown"

    def test_aggregates_setup_and_run_totals(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        payload = fixture.execute(work_order_id="WO-1", scope=scope)

        assert payload.total_setup_minutes == 30
        assert payload.total_run_minutes == 180
        assert payload.total_operation_count == 3


class TestBuildWoTravelerErrors:
    def test_unknown_work_order_raises(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        with pytest.raises(WorkOrderNotFoundForReport):
            fixture.execute(work_order_id="WO-DOES-NOT-EXIST", scope=scope)

    def test_cross_tenant_work_order_raises_not_found(self, fixture):
        scope = TenantScope.for_organization(_ORG_A)

        with pytest.raises(WorkOrderNotFoundForReport):
            fixture.execute(work_order_id="WO-OTHER", scope=scope)


class TestBuildWoTravelerNoSchedule:
    def test_no_published_schedule_raises(self):
        wo = _wo(
            "WO-1",
            operations=[_op("WO-1-OP1", "WO-1", sequence=1)],
        )
        wos = InMemoryWorkOrderRepository([wo])
        organizations = InMemoryOrganizationRepository(
            [Organization(id=_ORG_A, name="Plant QC", slug="plant-qc")]
        )
        workspaces = InMemoryWorkspaceRepository([])
        schedules = InMemoryScheduleRepository()

        builder = BuildWoTraveler(
            work_orders=wos,
            organizations=organizations,
            workspaces=workspaces,
            schedules=schedules,
        )

        with pytest.raises(NoPublishedScheduleForReport):
            builder.execute(
                work_order_id="WO-1",
                scope=TenantScope.for_organization(_ORG_A),
            )


class TestBuildWoTravelerAllUnplanned:
    def test_wo_with_zero_planned_ops_has_none_planned_span(self):
        wo = _wo(
            "WO-1",
            operations=[
                _op("WO-1-OP1", "WO-1", sequence=1),
                _op("WO-1-OP2", "WO-1", sequence=2),
            ],
        )
        wos = InMemoryWorkOrderRepository([wo])
        organizations = InMemoryOrganizationRepository(
            [Organization(id=_ORG_A, name="Plant QC", slug="plant-qc")]
        )
        workspaces = InMemoryWorkspaceRepository([])
        schedule = Schedule(
            id="sched-1",
            created_at=datetime(2026, 5, 7, 9, 14),
            assignments=[],
        )
        schedules = InMemoryScheduleRepository()
        schedules.save(
            schedule,
            metrics={},
            organization_id=_ORG_A,
            workspace_id=None,
            lifecycle_status="published",
            horizon_start=datetime(2026, 5, 5, 0, 0),
            horizon_end=datetime(2026, 5, 12, 0, 0),
        )

        builder = BuildWoTraveler(
            work_orders=wos,
            organizations=organizations,
            workspaces=workspaces,
            schedules=schedules,
        )
        payload = builder.execute(
            work_order_id="WO-1",
            scope=TenantScope.for_organization(_ORG_A),
        )

        assert payload.planned_start is None
        assert payload.planned_end is None
        assert all(op.planned_machine_id is None for op in payload.operations)
        assert all(op.planned_start is None for op in payload.operations)
