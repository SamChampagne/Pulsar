"""Use case: build the Late-order report for the active tenant.

Loads the latest published Schedule for the tenant scope, finds every
WorkOrder whose planned completion in that schedule overruns its
``due_date`` (or that is unplanned and already past due), classifies the
reason via ``classify_late_order_reason``, maps the reason to its
canonical recommended action, and returns a sorted ``LateOrderPayload``.

All reads honour the F-401 ScopedRepository pattern.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

from ....domain.entities import Schedule, ScheduledOperation, WorkOrder
from ....infrastructure.scoping import TenantScope
from ...ports.account_repository import OrganizationRepository
from ...ports.schedule_repository import ScheduleRepository, ScheduleRunMetadata
from ...ports.work_order_repository import WorkOrderRepository
from ...ports.workspace_repository import WorkspaceRepository
from .build_production_sheet import NoPublishedScheduleForReport
from .late_order_classifier import classify_late_order_reason
from .late_order_payload import (
    REASON_TO_ACTION,
    LateOrderLine,
    LateOrderPayload,
    LateOrderReason,
)

_REASON_KEYS: tuple[LateOrderReason, ...] = (
    "material",
    "capacity",
    "priority",
    "sequence",
)


class BuildLateOrderReport:
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

    def execute(self, *, scope: TenantScope) -> LateOrderPayload:
        organization_id = scope.require_organization()
        generated_at = datetime.now()

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

        work_orders = list(self._work_orders.with_scope(scope).list())

        lines = list(
            self._build_lines(
                work_orders=work_orders,
                schedule=schedule,
                metadata=metadata,
                generated_at=generated_at,
            )
        )
        lines.sort(
            key=lambda line: (
                line.lateness_minutes is None,
                -(line.lateness_minutes or 0),
            )
        )

        total_lateness = sum(
            line.lateness_minutes
            for line in lines
            if line.lateness_minutes is not None
        )
        by_reason: dict[LateOrderReason, int] = {key: 0 for key in _REASON_KEYS}
        for line in lines:
            by_reason[line.reason] += 1

        org = self._organizations.get(organization_id)
        workspace = (
            self._workspaces.get(scope.workspace_id) if scope.workspace_id else None
        )

        return LateOrderPayload(
            organization_name=org.name if org else organization_id,
            workspace_name=workspace.name if workspace else None,
            schedule_id=schedule.id,
            schedule_published_at=schedule.created_at,
            generated_at=generated_at,
            horizon_start=metadata.horizon_start,
            horizon_end=metadata.horizon_end,
            lines=tuple(lines),
            total_late_count=len(lines),
            total_lateness_minutes=total_lateness,
            by_reason=by_reason,
        )

    def _build_lines(
        self,
        *,
        work_orders: list[WorkOrder],
        schedule: Schedule,
        metadata: ScheduleRunMetadata,
        generated_at: datetime,
    ) -> Iterable[LateOrderLine]:
        for wo in work_orders:
            planned_end = _planned_end(wo, schedule.assignments)
            if not _is_late(wo=wo, planned_end=planned_end, now=generated_at):
                continue
            reason = classify_late_order_reason(
                wo=wo,
                schedule=schedule,
                metadata=metadata,
                all_work_orders=work_orders,
            )
            lateness_minutes = (
                int((planned_end - wo.due_date).total_seconds() // 60)
                if planned_end is not None
                else None
            )
            yield LateOrderLine(
                work_order_ref=wo.id,
                work_order_name=wo.name,
                due_date=wo.due_date,
                planned_end=planned_end,
                lateness_minutes=lateness_minutes,
                priority=wo.priority.name,
                reason=reason,
                recommended_action=REASON_TO_ACTION[reason],
            )


def _planned_end(
    wo: WorkOrder,
    assignments: Iterable[ScheduledOperation],
) -> datetime | None:
    ends = [a.end for a in assignments if a.work_order_id == wo.id]
    return max(ends) if ends else None


def _is_late(
    *,
    wo: WorkOrder,
    planned_end: datetime | None,
    now: datetime,
) -> bool:
    if planned_end is None:
        return wo.due_date < now
    return planned_end > wo.due_date
