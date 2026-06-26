"""Use case: aggregate KPIs over a 7/30/90-day window of published schedules.

Pulls every published schedule for the active tenant whose
``created_at`` falls in [now-range, now], computes a per-schedule KPI
sample (makespan, on-time ratio, average utilization), and returns
the time series plus a delta-aware current snapshot. Top late orders
come from the latest schedule.

All reads honour F-401 scoping. ``list_recent`` already filters by
organization_id/workspace_id; the work-order pass uses the scoped view.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta

from ....domain.entities import Schedule, WorkOrder
from ....domain.scheduling import compute_metrics
from ....infrastructure.scoping import TenantScope
from ...ports.schedule_repository import ScheduleRepository, ScheduleRunMetadata
from ...ports.work_order_repository import WorkOrderRepository
from .build_production_sheet import ReportError
from .executive_dashboard_payload import (
    ExecutiveDashboardOutput,
    KpiSnapshot,
    ScheduleSample,
    TopLateOrder,
)

_RANGE_TO_DELTA: dict[str, timedelta] = {
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
    "90d": timedelta(days=90),
}

_LIST_RECENT_LIMIT = 200
_TOP_LATE_ORDERS_LIMIT = 5


class BuildExecutiveDashboard:
    def __init__(
        self,
        *,
        work_orders: WorkOrderRepository,
        schedules: ScheduleRepository,
        now_provider: Callable[[], datetime] = datetime.now,
    ) -> None:
        self._work_orders = work_orders
        self._schedules = schedules
        self._now = now_provider

    def execute(
        self,
        *,
        range_label: str,
        scope: TenantScope,
    ) -> ExecutiveDashboardOutput:
        delta = _RANGE_TO_DELTA.get(range_label)
        if delta is None:
            raise ReportError(
                f"range must be one of {sorted(_RANGE_TO_DELTA)}; got {range_label!r}"
            )
        organization_id = scope.require_organization()
        now = self._now()
        range_start = now - delta

        recent = self._schedules.list_recent(
            limit=_LIST_RECENT_LIMIT,
            organization_id=organization_id,
            workspace_id=scope.workspace_id,
            lifecycle_status="published",
        )
        in_window = sorted(
            ((s, m) for s, m in recent if s.created_at >= range_start),
            key=lambda pair: pair[0].created_at,
        )

        work_orders = list(self._work_orders.with_scope(scope).list())

        samples = tuple(
            _to_sample(schedule, metadata, work_orders, now)
            for schedule, metadata in in_window
        )
        current_kpis = _kpi_snapshot(samples)

        top_late_orders: tuple[TopLateOrder, ...] = ()
        if in_window:
            latest_schedule, _ = in_window[-1]
            top_late_orders = _top_late_orders(latest_schedule, work_orders, now)

        return ExecutiveDashboardOutput(
            range_label=range_label,
            range_start=range_start,
            range_end=now,
            generated_at=now,
            scenarios_published_count=len(samples),
            schedule_samples=samples,
            current_kpis=current_kpis,
            top_late_orders=top_late_orders,
        )


def _to_sample(
    schedule: Schedule,
    metadata: ScheduleRunMetadata,
    work_orders: list[WorkOrder],
    now: datetime,
) -> ScheduleSample:
    if metadata.metrics:
        metrics = metadata.metrics
    else:
        metrics = compute_metrics(
            schedule,
            work_orders,
            horizon_start=metadata.horizon_start or now,
            horizon_end=metadata.horizon_end or now,
        ).as_dict()
    util = metrics.get("machine_utilization") or {}
    avg_util = sum(util.values()) / len(util) if util else 0.0
    return ScheduleSample(
        schedule_id=schedule.id,
        published_at=schedule.created_at,
        makespan_minutes=int(metrics.get("makespan_minutes", 0)),
        on_time_ratio=float(metrics.get("on_time_ratio", 1.0)),
        avg_utilization=avg_util,
        queue_time_minutes_avg=int(metrics.get("queue_time_minutes_avg", 0)),
        changeover_ratio=float(metrics.get("changeover_ratio", 0.0)),
        saturation_max=float(metrics.get("saturation_max", 0.0)),
        saturation_p95=float(metrics.get("saturation_p95", 0.0)),
        wip_operation_count=int(metrics.get("wip_operation_count", 0)),
        campaign_efficiency=float(metrics.get("campaign_efficiency", 1.0)),
    )


def _kpi_snapshot(samples: tuple[ScheduleSample, ...]) -> KpiSnapshot:
    if not samples:
        return KpiSnapshot(
            makespan_minutes=0,
            on_time_ratio=1.0,
            avg_utilization=0.0,
            queue_time_minutes_avg=0,
            changeover_ratio=0.0,
            saturation_max=0.0,
            saturation_p95=0.0,
            wip_operation_count=0,
            campaign_efficiency=1.0,
            makespan_delta_minutes=None,
            on_time_delta=None,
            avg_utilization_delta=None,
            queue_time_delta_minutes=None,
            changeover_delta=None,
            saturation_max_delta=None,
            saturation_p95_delta=None,
            wip_delta=None,
            campaign_efficiency_delta=None,
        )
    latest = samples[-1]
    previous = samples[-2] if len(samples) >= 2 else None
    return KpiSnapshot(
        makespan_minutes=latest.makespan_minutes,
        on_time_ratio=latest.on_time_ratio,
        avg_utilization=latest.avg_utilization,
        queue_time_minutes_avg=latest.queue_time_minutes_avg,
        changeover_ratio=latest.changeover_ratio,
        saturation_max=latest.saturation_max,
        saturation_p95=latest.saturation_p95,
        wip_operation_count=latest.wip_operation_count,
        campaign_efficiency=latest.campaign_efficiency,
        makespan_delta_minutes=(
            latest.makespan_minutes - previous.makespan_minutes
            if previous
            else None
        ),
        on_time_delta=(
            latest.on_time_ratio - previous.on_time_ratio if previous else None
        ),
        avg_utilization_delta=(
            latest.avg_utilization - previous.avg_utilization if previous else None
        ),
        queue_time_delta_minutes=(
            latest.queue_time_minutes_avg - previous.queue_time_minutes_avg
            if previous
            else None
        ),
        changeover_delta=(
            latest.changeover_ratio - previous.changeover_ratio
            if previous
            else None
        ),
        saturation_max_delta=(
            latest.saturation_max - previous.saturation_max if previous else None
        ),
        saturation_p95_delta=(
            latest.saturation_p95 - previous.saturation_p95 if previous else None
        ),
        wip_delta=(
            latest.wip_operation_count - previous.wip_operation_count
            if previous
            else None
        ),
        campaign_efficiency_delta=(
            latest.campaign_efficiency - previous.campaign_efficiency
            if previous
            else None
        ),
    )


def _top_late_orders(
    schedule: Schedule,
    work_orders: list[WorkOrder],
    now: datetime,
) -> tuple[TopLateOrder, ...]:
    late: list[TopLateOrder] = []
    for wo in work_orders:
        ends = [a.end for a in schedule.assignments if a.work_order_id == wo.id]
        planned_end = max(ends) if ends else None
        if planned_end is None:
            if wo.due_date >= now:
                continue
            late.append(
                TopLateOrder(
                    work_order_ref=wo.id,
                    work_order_name=wo.name,
                    due_date=wo.due_date,
                    planned_end=None,
                    lateness_minutes=None,
                )
            )
            continue
        if planned_end <= wo.due_date:
            continue
        lateness = int((planned_end - wo.due_date).total_seconds() // 60)
        late.append(
            TopLateOrder(
                work_order_ref=wo.id,
                work_order_name=wo.name,
                due_date=wo.due_date,
                planned_end=planned_end,
                lateness_minutes=lateness,
            )
        )
    late.sort(
        key=lambda t: (
            t.lateness_minutes is None,
            -(t.lateness_minutes or 0),
        )
    )
    return tuple(late[:_TOP_LATE_ORDERS_LIMIT])
