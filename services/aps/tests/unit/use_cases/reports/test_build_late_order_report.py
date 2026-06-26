"""TDD tests for BuildLateOrderReport.

Uses in-memory repositories. The schedule contains 2 late WOs with
different reasons and one on-time WO to verify filtering. A WO from
another organization confirms F-401 scoping.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from planiadvance_v2.application.use_cases.reports import (
    NoPublishedScheduleForReport,
)
from planiadvance_v2.application.use_cases.reports.build_late_order_report import (
    BuildLateOrderReport,
)
from planiadvance_v2.domain.entities import (
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


def _op(op_id: str, wo_id: str) -> Operation:
    return Operation(
        id=op_id,
        work_order_id=wo_id,
        sequence=1,
        name=op_id,
        duration=Duration(minutes=60),
        setup_time=Duration(minutes=0),
        eligible_machine_ids=["M-A"],
        dependencies=[],
    )


def _wo(
    wo_id: str,
    *,
    due: datetime,
    organization_id: str = _ORG_A,
    workspace_id: str | None = _WS_A,
    priority: Priority = Priority.NORMAL,
) -> WorkOrder:
    return WorkOrder(
        id=wo_id,
        name=f"WO {wo_id}",
        product_id=f"PROD-{wo_id}",
        quantity=1,
        due_date=due,
        release_date=datetime(2026, 5, 1),
        operations=[_op(f"{wo_id}-OP1", wo_id)],
        priority=priority,
        organization_id=organization_id,
        workspace_id=workspace_id,
    )


def _scheduled_op(
    op_id: str,
    wo_id: str,
    *,
    end: datetime,
    start: datetime | None = None,
) -> ScheduledOperation:
    actual_start = start or end - timedelta(hours=1)
    return ScheduledOperation(
        operation_id=op_id,
        work_order_id=wo_id,
        machine_id="M-A",
        setup_start=actual_start - timedelta(minutes=10),
        start=actual_start,
        end=end,
    )


@pytest.fixture
def fixture():
    work_orders_repo = InMemoryWorkOrderRepository(
        [
            # Late: planned end after due date.
            _wo("WO-LATE-1", due=datetime(2026, 5, 11, 17, 0)),
            _wo("WO-LATE-2", due=datetime(2026, 5, 11, 12, 0)),
            # On time.
            _wo("WO-OK", due=datetime(2026, 5, 20, 17, 0)),
            # Cross-tenant — should be filtered out by F-401.
            _wo(
                "WO-OTHER",
                due=datetime(2026, 5, 11, 17, 0),
                organization_id=_ORG_B,
                workspace_id=None,
            ),
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

    schedule = Schedule(
        id="sched-1",
        created_at=datetime(2026, 5, 7, 9, 14),
        assignments=[
            _scheduled_op("WO-LATE-1-OP1", "WO-LATE-1", end=datetime(2026, 5, 12, 9, 0)),
            _scheduled_op("WO-LATE-2-OP1", "WO-LATE-2", end=datetime(2026, 5, 14, 9, 0)),
            _scheduled_op("WO-OK-OP1", "WO-OK", end=datetime(2026, 5, 19, 17, 0)),
        ],
    )
    schedules = InMemoryScheduleRepository()
    schedules.save(
        schedule,
        metrics={},
        organization_id=_ORG_A,
        workspace_id=_WS_A,
        lifecycle_status="published",
        horizon_start=datetime(2026, 5, 11, 0, 0),
        horizon_end=datetime(2026, 5, 18, 0, 0),
        diagnostics={
            "planner_exceptions": {
                "exceptions": [
                    {"work_order_id": "WO-LATE-1", "kind": "material_shortage"},
                ],
            },
        },
    )

    return BuildLateOrderReport(
        work_orders=work_orders_repo,
        organizations=organizations,
        workspaces=workspaces,
        schedules=schedules,
    )


class TestBuildLateOrderReportHappyPath:
    def test_lists_late_wos_sorted_by_lateness_desc(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        payload = fixture.execute(scope=scope)

        assert payload.organization_name == "Plant QC"
        assert payload.workspace_name == "Plant A"
        assert payload.schedule_id == "sched-1"
        assert len(payload.lines) == 2
        # WO-LATE-2 is later by ~3 days; WO-LATE-1 only ~16 hours.
        assert payload.lines[0].work_order_ref == "WO-LATE-2"
        assert payload.lines[1].work_order_ref == "WO-LATE-1"
        # WO-OK (on time) and WO-OTHER (cross-tenant) excluded.
        refs = {line.work_order_ref for line in payload.lines}
        assert "WO-OK" not in refs
        assert "WO-OTHER" not in refs

    def test_classification_and_action_propagated(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        payload = fixture.execute(scope=scope)

        late_1 = next(line for line in payload.lines if line.work_order_ref == "WO-LATE-1")
        # Diagnostics flagged WO-LATE-1 as material_shortage.
        assert late_1.reason == "material"
        assert late_1.recommended_action == "expedite_material"

        late_2 = next(line for line in payload.lines if line.work_order_ref == "WO-LATE-2")
        # No signal for WO-LATE-2 -> sequence (default).
        assert late_2.reason == "sequence"
        assert late_2.recommended_action == "split_lot_or_reroute"

    def test_aggregates_totals_and_by_reason(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        payload = fixture.execute(scope=scope)

        assert payload.total_late_count == 2
        assert payload.total_lateness_minutes > 0
        assert payload.by_reason["material"] == 1
        assert payload.by_reason["sequence"] == 1
        assert payload.by_reason["capacity"] == 0
        assert payload.by_reason["priority"] == 0


class TestBuildLateOrderReportEmpty:
    def test_no_late_wos_returns_empty_payload(self):
        wos = InMemoryWorkOrderRepository(
            [_wo("WO-OK", due=datetime(2026, 5, 20, 17, 0))]
        )
        organizations = InMemoryOrganizationRepository(
            [Organization(id=_ORG_A, name="Plant QC", slug="plant-qc")]
        )
        workspaces = InMemoryWorkspaceRepository([])
        schedule = Schedule(
            id="sched-1",
            created_at=datetime(2026, 5, 7, 9, 14),
            assignments=[
                _scheduled_op("WO-OK-OP1", "WO-OK", end=datetime(2026, 5, 19, 17, 0)),
            ],
        )
        schedules = InMemoryScheduleRepository()
        schedules.save(
            schedule,
            metrics={},
            organization_id=_ORG_A,
            workspace_id=None,
            lifecycle_status="published",
            horizon_start=datetime(2026, 5, 11, 0, 0),
            horizon_end=datetime(2026, 5, 22, 0, 0),
        )

        builder = BuildLateOrderReport(
            work_orders=wos,
            organizations=organizations,
            workspaces=workspaces,
            schedules=schedules,
        )
        payload = builder.execute(scope=TenantScope.for_organization(_ORG_A))

        assert payload.lines == ()
        assert payload.total_late_count == 0
        assert payload.total_lateness_minutes == 0
        assert payload.by_reason == {
            "material": 0,
            "capacity": 0,
            "priority": 0,
            "sequence": 0,
        }


class TestBuildLateOrderReportErrors:
    def test_no_published_schedule_raises(self):
        wos = InMemoryWorkOrderRepository([])
        organizations = InMemoryOrganizationRepository(
            [Organization(id=_ORG_A, name="Plant QC", slug="plant-qc")]
        )
        workspaces = InMemoryWorkspaceRepository([])
        schedules = InMemoryScheduleRepository()  # empty

        builder = BuildLateOrderReport(
            work_orders=wos,
            organizations=organizations,
            workspaces=workspaces,
            schedules=schedules,
        )

        with pytest.raises(NoPublishedScheduleForReport):
            builder.execute(scope=TenantScope.for_organization(_ORG_A))


class TestBuildLateOrderReportUnplanned:
    def test_unplanned_overdue_wo_included_with_none_lateness(self):
        wos = InMemoryWorkOrderRepository(
            [_wo("WO-NEVER", due=datetime(2026, 5, 5, 17, 0))]
        )
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
            horizon_start=datetime(2026, 5, 1, 0, 0),
            horizon_end=datetime(2026, 5, 30, 0, 0),
        )

        builder = BuildLateOrderReport(
            work_orders=wos,
            organizations=organizations,
            workspaces=workspaces,
            schedules=schedules,
        )
        payload = builder.execute(scope=TenantScope.for_organization(_ORG_A))

        assert payload.total_late_count == 1
        assert len(payload.lines) == 1
        line = payload.lines[0]
        assert line.work_order_ref == "WO-NEVER"
        assert line.planned_end is None
        assert line.lateness_minutes is None
        assert line.reason == "sequence"
