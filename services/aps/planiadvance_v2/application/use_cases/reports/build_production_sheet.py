"""Use case: build the Production Sheet payload for one machine and one day.

Given a machine id, a calendar date, and an active tenant scope, this
use case finds the latest published Schedule for the tenant, picks
the assignments on that machine whose start falls on the requested
date, and assembles a ``ProductionSheetPayload`` ready for the
PdfRenderer.

All reads honour the F-401 ScopedRepository pattern: a use case that
forgets the scope cannot leak rows from another tenant because the
scoped view raises ``MissingTenantScopeError``.
"""

from __future__ import annotations

from datetime import date, datetime

from ....infrastructure.scoping import TenantScope
from ...ports.account_repository import OrganizationRepository
from ...ports.machine_repository import MachineRepository
from ...ports.schedule_repository import ScheduleRepository
from ...ports.work_order_repository import WorkOrderRepository
from ...ports.workspace_repository import WorkspaceRepository
from .production_sheet_payload import ProductionSheetLine, ProductionSheetPayload


class ReportError(RuntimeError):
    """Base for J2a reporting use-case errors."""


class MachineNotFoundForReport(ReportError):
    pass


class NoPublishedScheduleForReport(ReportError):
    pass


class RequestedDateOutsideHorizon(ReportError):
    def __init__(
        self,
        requested: date,
        horizon_start: datetime | None,
        horizon_end: datetime | None,
    ) -> None:
        super().__init__(
            f"Date {requested} is outside the published horizon "
            f"[{horizon_start}, {horizon_end}]."
        )
        self.requested = requested
        self.horizon_start = horizon_start
        self.horizon_end = horizon_end


class BuildProductionSheet:
    def __init__(
        self,
        *,
        machines: MachineRepository,
        work_orders: WorkOrderRepository,
        organizations: OrganizationRepository,
        workspaces: WorkspaceRepository,
        schedules: ScheduleRepository,
    ) -> None:
        self._machines = machines
        self._work_orders = work_orders
        self._organizations = organizations
        self._workspaces = workspaces
        self._schedules = schedules

    def execute(
        self,
        *,
        machine_id: str,
        target_date: date,
        scope: TenantScope,
    ) -> ProductionSheetPayload:
        organization_id = scope.require_organization()

        machine = self._machines.with_scope(scope).get(machine_id)
        if machine is None:
            raise MachineNotFoundForReport(
                f"Machine {machine_id!r} not in tenant scope."
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

        if metadata.horizon_start and metadata.horizon_end:
            day_start = datetime.combine(target_date, datetime.min.time())
            day_end = datetime.combine(target_date, datetime.max.time())
            if day_end < metadata.horizon_start or day_start > metadata.horizon_end:
                raise RequestedDateOutsideHorizon(
                    target_date, metadata.horizon_start, metadata.horizon_end
                )

        assignments = sorted(
            (
                a
                for a in schedule.assignments
                if a.machine_id == machine_id and a.start.date() == target_date
            ),
            key=lambda a: a.start,
        )

        wo_index = {wo.id: wo for wo in self._work_orders.with_scope(scope).list()}
        op_index: dict[str, tuple] = {}
        for wo in wo_index.values():
            for op in wo.operations:
                op_index[op.id] = (op, wo)

        lines: list[ProductionSheetLine] = []
        total_setup = 0
        total_run = 0
        for idx, assignment in enumerate(assignments, start=1):
            entry = op_index.get(assignment.operation_id)
            if entry is None:
                # Operation has no parent WO in this tenant - skip silently.
                # This can happen if the schedule outlives a WO deletion.
                continue
            operation, work_order = entry
            setup_min = int(operation.setup_time.minutes)
            run_min = int(operation.duration.minutes)
            total_setup += setup_min
            total_run += run_min
            lines.append(
                ProductionSheetLine(
                    operation_id=operation.id,
                    work_order_ref=work_order.id,
                    work_order_name=work_order.name,
                    sequence=idx,
                    start=assignment.start,
                    end=assignment.end,
                    setup_minutes=setup_min,
                    run_minutes=run_min,
                    notes=None,
                )
            )

        org = self._organizations.get(organization_id)
        workspace = (
            self._workspaces.get(scope.workspace_id) if scope.workspace_id else None
        )

        return ProductionSheetPayload(
            machine_id=machine_id,
            machine_name=machine.name,
            organization_name=org.name if org else organization_id,
            workspace_name=workspace.name if workspace else None,
            date=target_date,
            schedule_id=schedule.id,
            schedule_published_at=schedule.created_at,
            lines=tuple(lines),
            total_setup_minutes=total_setup,
            total_run_minutes=total_run,
            total_operation_count=len(lines),
        )
