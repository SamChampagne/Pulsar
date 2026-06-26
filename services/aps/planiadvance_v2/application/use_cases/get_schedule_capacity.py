"""Use case: expose the engine machine capacity ledger for a run."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ...domain.errors import ValidationError
from ...domain.scheduling import (
    MachineCapacityBucket,
    MachineCapacitySummary,
    build_machine_capacity_ledger,
)
from ..ports import CalendarRepository, MachineRepository, ScheduleRepository
from .planning_validation_gate import validate_schedule_scope
from .tenant_scope import data_workspace_id_from_metadata, list_scoped


@dataclass(frozen=True, slots=True)
class ScheduleCapacityOutput:
    schedule_id: str
    workspace_id: str
    scenario_name: str
    lifecycle_status: str
    organization_id: str | None
    horizon_start: datetime
    horizon_end: datetime
    bucket: str
    status: str
    generated_at: datetime
    total_capacity_minutes: int
    total_scheduled_load_minutes: int
    total_setup_minutes: int
    total_run_minutes: int
    total_idle_minutes: int
    total_overload_minutes: int
    average_utilization: float | None
    peak_utilization: float | None
    bottleneck_machine_id: str | None
    machines: tuple[MachineCapacitySummary, ...] = ()
    buckets: tuple[MachineCapacityBucket, ...] = ()
    warnings: tuple[str, ...] = ()
    diagnostics: dict[str, object] = field(default_factory=dict)
    contract_version: str = "machine-capacity-ledger-v1"


class GetScheduleCapacity:
    """Load a persisted schedule and compute reusable capacity buckets."""

    def __init__(
        self,
        *,
        schedules: ScheduleRepository,
        machines: MachineRepository,
        calendars: CalendarRepository,
    ) -> None:
        self._schedules = schedules
        self._machines = machines
        self._calendars = calendars

    def execute(
        self,
        schedule_id: str,
        *,
        organization_id: str | None = None,
        bucket: str = "day",
        window_start: datetime | None = None,
        window_end: datetime | None = None,
    ) -> ScheduleCapacityOutput:
        schedule = self._schedules.get(schedule_id)
        if schedule is None:
            raise ValidationError(f"Schedule {schedule_id!r} not found")

        metadata = self._schedules.get_metadata(schedule_id)
        validate_schedule_scope(
            metadata,
            expected_organization_id=organization_id,
            schedule_id=schedule_id,
            label="Capacity",
        )

        workspace_id = data_workspace_id_from_metadata(metadata)
        horizon_start, horizon_end = _resolve_horizon(
            schedule=schedule,
            metadata_horizon_start=metadata.horizon_start if metadata else None,
            metadata_horizon_end=metadata.horizon_end if metadata else None,
            window_start=window_start,
            window_end=window_end,
        )
        machines = list_scoped(self._machines, organization_id, workspace_id)
        calendars = list_scoped(self._calendars, organization_id, workspace_id)

        try:
            ledger = build_machine_capacity_ledger(
                schedule=schedule,
                machines=machines,
                calendars=calendars,
                horizon_start=horizon_start,
                horizon_end=horizon_end,
                bucket=bucket,
            )
        except ValueError as exc:
            raise ValidationError(str(exc)) from exc

        return ScheduleCapacityOutput(
            schedule_id=schedule.id,
            workspace_id=metadata.workspace_id if metadata else "default",
            scenario_name=metadata.scenario_name if metadata else "Default Scenario",
            lifecycle_status=metadata.lifecycle_status if metadata else "draft",
            organization_id=metadata.organization_id if metadata else organization_id,
            horizon_start=ledger.horizon_start,
            horizon_end=ledger.horizon_end,
            bucket=ledger.bucket,
            status=ledger.status,
            generated_at=datetime.utcnow(),
            total_capacity_minutes=ledger.total_capacity_minutes,
            total_scheduled_load_minutes=ledger.total_scheduled_load_minutes,
            total_setup_minutes=ledger.total_setup_minutes,
            total_run_minutes=ledger.total_run_minutes,
            total_idle_minutes=ledger.total_idle_minutes,
            total_overload_minutes=ledger.total_overload_minutes,
            average_utilization=ledger.average_utilization,
            peak_utilization=ledger.peak_utilization,
            bottleneck_machine_id=ledger.bottleneck_machine_id,
            machines=ledger.machines,
            buckets=ledger.buckets,
            warnings=ledger.warnings,
            diagnostics={
                "capacity_basis": "calendar_effective_minutes",
                "machine_capacity_model": "unary_primary_machine",
                "bucket_count": len(ledger.buckets),
                "machine_count": len(ledger.machines),
                "source": "schedule_assignments_plus_machine_calendars",
            },
            contract_version=ledger.contract_version,
        )


def _resolve_horizon(
    *,
    schedule,
    metadata_horizon_start: datetime | None,
    metadata_horizon_end: datetime | None,
    window_start: datetime | None,
    window_end: datetime | None,
) -> tuple[datetime, datetime]:
    base_start, base_end = _default_horizon(
        schedule=schedule,
        metadata_horizon_start=metadata_horizon_start,
        metadata_horizon_end=metadata_horizon_end,
    )
    start = window_start or base_start
    end = window_end or base_end
    if end <= start:
        raise ValidationError("Capacity window_end must be after window_start.")
    return start, end


def _default_horizon(
    *,
    schedule,
    metadata_horizon_start: datetime | None,
    metadata_horizon_end: datetime | None,
) -> tuple[datetime, datetime]:
    if metadata_horizon_start is not None and metadata_horizon_end is not None:
        return metadata_horizon_start, metadata_horizon_end
    if schedule.assignments:
        earliest = min(a.setup_start for a in schedule.assignments)
        latest = max(a.end for a in schedule.assignments)
        start = earliest.replace(hour=0, minute=0, second=0, microsecond=0)
        end = latest + timedelta(days=1)
        return start, end.replace(hour=0, minute=0, second=0, microsecond=0)
    start = schedule.created_at.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)
