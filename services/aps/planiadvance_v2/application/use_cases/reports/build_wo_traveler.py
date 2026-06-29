"""Use case: build the WO Traveler payload for one work order.

Loads the WO scoped to the active tenant and the latest published
Schedule, looks up each operation's assignment (if planned), reads
material coverage from the pegging report, and assembles a
``WoTravelerPayload``.

All reads honour the F-401 ScopedRepository pattern. Cross-tenant
work_order_id is invisible to the scoped view and surfaces as
``WorkOrderNotFoundForReport``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ....domain.entities import Operation, ScheduledOperation
from ....infrastructure.scoping import TenantScope
from ...ports.account_repository import OrganizationRepository
from ...ports.schedule_repository import ScheduleRepository
from ...ports.work_order_repository import WorkOrderRepository
from ...ports.workspace_repository import WorkspaceRepository
from .build_production_sheet import NoPublishedScheduleForReport, ReportError
from .wo_traveler_payload import (
    CoverageStatus,
    WoTravelerMaterialLine,
    WoTravelerOperationLine,
    WoTravelerPayload,
)


class WorkOrderNotFoundForReport(ReportError):
    pass


class BuildWoTraveler:
    def __init__(
        self,
        *,
        work_orders: WorkOrderRepository,
        organizations: OrganizationRepository,
        workspaces: WorkspaceRepository,
        schedules: ScheduleRepository,
    ) -> None:
        self._work_orders = work_orders
        self._organizations = organizations
        self._workspaces = workspaces
        self._schedules = schedules

    def execute(self, *, work_order_id: str, scope: TenantScope) -> WoTravelerPayload:
        organization_id = scope.require_organization()
        generated_at = datetime.now()

        wo = self._work_orders.with_scope(scope).get(work_order_id)
        if wo is None:
            raise WorkOrderNotFoundForReport(
                f"Work order {work_order_id!r} not found in current tenant."
            )

        published = self._schedules.list_recent(
            limit=1,
            organization_id=organization_id,
            workspace_id=scope.workspace_id,
            lifecycle_status="published",
        )
        if not published:
            raise NoPublishedScheduleForReport(
                "No published schedule for the active tenant. Publish a "
                "scenario before printing reports."
            )
        schedule, metadata = published[0]

        assignments_by_op = {
            a.operation_id: a
            for a in schedule.assignments
            if a.work_order_id == wo.id
        }
        diagnostics = metadata.diagnostics or {}

        op_lines = tuple(
            _build_operation_line(
                op, assignments_by_op.get(op.id), diagnostics, wo.quantity
            )
            for op in wo.ordered_operations()
        )
        planned_starts = [
            line.planned_start for line in op_lines if line.planned_start is not None
        ]
        planned_ends = [
            line.planned_end for line in op_lines if line.planned_end is not None
        ]
        planned_start = min(planned_starts) if planned_starts else None
        planned_end = max(planned_ends) if planned_ends else None

        total_setup = sum(line.setup_minutes for line in op_lines)
        total_run = sum(line.run_minutes for line in op_lines)

        org = self._organizations.get(organization_id)
        workspace = (
            self._workspaces.get(scope.workspace_id) if scope.workspace_id else None
        )

        return WoTravelerPayload(
            organization_name=org.name if org else organization_id,
            workspace_name=workspace.name if workspace else None,
            schedule_id=schedule.id,
            schedule_published_at=schedule.created_at,
            generated_at=generated_at,
            work_order_ref=wo.id,
            work_order_name=wo.name,
            product_id=wo.product_id,
            quantity=wo.quantity,
            priority=wo.priority.name,
            status=wo.status.name,
            due_date=wo.due_date,
            release_date=wo.release_date,
            planned_start=planned_start,
            planned_end=planned_end,
            operations=op_lines,
            total_setup_minutes=total_setup,
            total_run_minutes=total_run,
            total_operation_count=len(op_lines),
        )


def _build_operation_line(
    op: Operation,
    assignment: ScheduledOperation | None,
    diagnostics: dict[str, Any],
    wo_quantity: int,
) -> WoTravelerOperationLine:
    if assignment is not None:
        planned_machine = assignment.machine_id
        planned_start = assignment.start
        planned_end = assignment.end
    else:
        planned_machine = None
        planned_start = None
        planned_end = None

    materials = tuple(
        WoTravelerMaterialLine(
            material_id=req.material_id,
            required_quantity=req.required_quantity(wo_quantity),
            coverage_status=_coverage_status_for(
                op.id, req.material_id, diagnostics
            ),
        )
        for req in op.material_requirements
    )

    return WoTravelerOperationLine(
        operation_id=op.id,
        sequence=op.sequence,
        name=op.name,
        eligible_machine_ids=tuple(op.eligible_machine_ids),
        planned_machine_id=planned_machine,
        planned_start=planned_start,
        planned_end=planned_end,
        setup_minutes=int(op.setup_time.minutes),
        run_minutes=int(op.duration.minutes),
        materials=materials,
    )


def _coverage_status_for(
    operation_id: str,
    material_id: str,
    diagnostics: dict[str, Any],
) -> CoverageStatus:
    pegging = diagnostics.get("material_pegging_report")
    if not isinstance(pegging, dict):
        return "unknown"
    for record in pegging.get("pegging_records") or []:
        if not isinstance(record, dict):
            continue
        if record.get("operation_id") != operation_id:
            continue
        if record.get("material_id") != material_id:
            continue
        status = record.get("coverage_status")
        if status in ("covered", "short"):
            return status  # type: ignore[return-value]
    return "unknown"
