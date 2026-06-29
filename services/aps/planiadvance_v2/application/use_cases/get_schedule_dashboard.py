"""Use case: compute a KPI dashboard for a persisted schedule.

Loads the schedule by ID, re-runs the analysis and metrics pipeline,
and returns a rich summary suitable for dashboard display.

Persisted metrics are used as the primary source for KPI values and
run metadata (strategy, solver status, etc.) when available, while
analysis (critical path, bottleneck, Gantt) is always recomputed from
the live schedule data — it depends on work order due dates which may
have changed since the run was persisted.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from ...domain.errors import ValidationError
from ...domain.scheduling import compute_metrics
from ...domain.scheduling.analysis import ScheduleAnalysis, analyze_schedule
from ..ports import ScheduleRepository, WorkOrderRepository
from .planner_diagnostics import enrich_planner_diagnostics
from .planning_validation_gate import validate_schedule_scope
from .result_summary import SchedulingSummary, build_schedule_summary


@dataclass(slots=True)
class DashboardOutput:
    schedule_id: str
    metrics: dict
    analysis: ScheduleAnalysis | None
    summary: SchedulingSummary
    diagnostics: dict
    work_order_count: int
    operation_count: int
    machine_count: int
    strategy: str = "unknown"
    solver_status: str = "unknown"
    objective_value: int = 0
    wall_time_ms: int = 0
    workspace_id: str = "default"
    scenario_name: str = "Default Scenario"
    lifecycle_status: str = "draft"


class GetScheduleDashboard:
    """Load schedule + work orders and compute full KPI dashboard."""

    def __init__(
        self,
        *,
        schedules: ScheduleRepository,
        work_orders: WorkOrderRepository,
    ) -> None:
        self._schedules = schedules
        self._work_orders = work_orders

    def execute(
        self,
        schedule_id: str,
        *,
        organization_id: str | None = None,
    ) -> DashboardOutput:
        schedule = self._schedules.get(schedule_id)
        if schedule is None:
            raise ValidationError(f"Schedule {schedule_id!r} not found")

        # Load persisted run metadata (strategy, status, etc.)
        metadata = self._schedules.get_metadata(schedule_id)
        validate_schedule_scope(
            metadata,
            expected_organization_id=organization_id,
            schedule_id=schedule_id,
            label="Schedule dashboard",
        )

        work_orders = self._work_orders.list_all()

        # Derive horizon from assignments.
        if schedule.assignments:
            earliest = min(a.setup_start for a in schedule.assignments)
            latest = max(a.end for a in schedule.assignments)
            horizon_start = earliest.replace(hour=0, minute=0, second=0, microsecond=0)
            horizon_end = latest + timedelta(days=1)
            horizon_end = horizon_end.replace(hour=0, minute=0, second=0, microsecond=0)
        else:
            from datetime import datetime

            horizon_start = datetime(2026, 1, 1)
            horizon_end = datetime(2026, 1, 2)

        # Use persisted metrics when available; recompute as fallback.
        if metadata is not None and metadata.metrics:
            metrics = metadata.metrics
        else:
            metrics = compute_metrics(
                schedule,
                work_orders,
                horizon_start=horizon_start,
                horizon_end=horizon_end,
            ).as_dict()

        analysis = analyze_schedule(schedule, work_orders)
        diagnostics = enrich_planner_diagnostics(
            metadata.diagnostics if metadata else {},
            metrics=metrics,
            strategy=metadata.strategy if metadata else None,
        )
        summary = build_schedule_summary(
            schedule=schedule,
            metrics=metrics,
            analysis=analysis,
            diagnostics=diagnostics,
            work_orders=work_orders,
        )

        machine_ids = {a.machine_id for a in schedule.assignments}

        return DashboardOutput(
            schedule_id=schedule.id,
            metrics=metrics,
            analysis=analysis,
            summary=summary,
            diagnostics=diagnostics,
            work_order_count=len(work_orders),
            operation_count=len(schedule.assignments),
            machine_count=len(machine_ids),
            strategy=metadata.strategy if metadata else "unknown",
            solver_status=metadata.solver_status if metadata else "unknown",
            objective_value=metadata.objective_value if metadata else 0,
            wall_time_ms=metadata.wall_time_ms if metadata else 0,
            workspace_id=metadata.workspace_id if metadata else "default",
            scenario_name=metadata.scenario_name if metadata else "Default Scenario",
            lifecycle_status=metadata.lifecycle_status if metadata else "draft",
        )
