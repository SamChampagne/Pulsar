"""Machine capacity ledger.

This module keeps machine capacity/load math in the engine layer so API,
CTP, dashboards and future integrations can share one definition instead
of each screen recomputing its own version.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta

from ..entities import Machine, Schedule, ScheduledOperation, WorkingCalendar
from .calendar_resolver import CalendarResolver

SUPPORTED_CAPACITY_BUCKETS = {"day", "week", "horizon"}


@dataclass(frozen=True, slots=True)
class MachineCapacityBucket:
    machine_id: str
    machine_name: str | None
    calendar_id: str | None
    bucket_start: datetime
    bucket_end: datetime
    capacity_minutes: int
    scheduled_load_minutes: int
    setup_minutes: int
    run_minutes: int
    idle_minutes: int
    overload_minutes: int
    utilization: float | None
    operation_count: int
    overlap_count: int
    pressure: str
    baseline_load_minutes: int = 0
    candidate_load_minutes: int = 0
    load_delta_minutes: int = 0
    capacity_units: int = 1


@dataclass(frozen=True, slots=True)
class MachineCapacitySummary:
    machine_id: str
    machine_name: str | None
    calendar_id: str | None
    capacity_minutes: int
    scheduled_load_minutes: int
    setup_minutes: int
    run_minutes: int
    idle_minutes: int
    overload_minutes: int
    utilization: float | None
    peak_utilization: float | None
    operation_count: int
    overlap_count: int
    bucket_count: int
    pressure: str
    bottleneck: bool = False
    capacity_units: int = 1


@dataclass(frozen=True, slots=True)
class MachineCapacityLedger:
    horizon_start: datetime
    horizon_end: datetime
    bucket: str
    buckets: tuple[MachineCapacityBucket, ...]
    machines: tuple[MachineCapacitySummary, ...]
    total_capacity_minutes: int
    total_scheduled_load_minutes: int
    total_setup_minutes: int
    total_run_minutes: int
    total_idle_minutes: int
    total_overload_minutes: int
    average_utilization: float | None
    peak_utilization: float | None
    bottleneck_machine_id: str | None
    status: str
    warnings: tuple[str, ...] = ()
    contract_version: str = "machine-capacity-ledger-v1"


def build_machine_capacity_ledger(
    *,
    schedule: Schedule,
    machines: list[Machine],
    calendars: list[WorkingCalendar],
    horizon_start: datetime,
    horizon_end: datetime,
    bucket: str = "day",
    baseline_schedule: Schedule | None = None,
    candidate_work_order_id: str | None = None,
    include_empty: bool = False,
) -> MachineCapacityLedger:
    """Build finite machine capacity/load buckets for a schedule."""

    if bucket not in SUPPORTED_CAPACITY_BUCKETS:
        supported = ", ".join(sorted(SUPPORTED_CAPACITY_BUCKETS))
        raise ValueError(f"Unsupported capacity bucket {bucket!r}; use one of {supported}.")
    if horizon_end <= horizon_start:
        raise ValueError("Capacity horizon_end must be after horizon_start.")

    calendar_by_id = {calendar.id: calendar for calendar in calendars}
    machine_by_id = {machine.id: machine for machine in machines}
    schedule_machine_ids = {assignment.machine_id for assignment in schedule.assignments}
    all_machine_ids = sorted(set(machine_by_id) | schedule_machine_ids)
    resolver = CalendarResolver(horizon_start, horizon_end)
    baseline_assignments = (
        baseline_schedule.assignments if baseline_schedule is not None else []
    )
    candidate_assignments = (
        schedule.by_work_order(candidate_work_order_id)
        if candidate_work_order_id is not None
        else []
    )
    warnings: set[str] = set()
    buckets: list[MachineCapacityBucket] = []

    for bucket_start, bucket_end in _iter_buckets(
        horizon_start=horizon_start,
        horizon_end=horizon_end,
        bucket=bucket,
    ):
        for machine_id in all_machine_ids:
            machine = machine_by_id.get(machine_id)
            if machine is None:
                warnings.add(f"machine {machine_id!r} is scheduled but missing from master data")
            calendar = (
                calendar_by_id.get(machine.calendar_id)
                if machine is not None
                else None
            )
            if machine is not None and calendar is None:
                warnings.add(
                    f"machine {machine.id!r} references missing calendar "
                    f"{machine.calendar_id!r}"
                )
            capacity_minutes = _capacity_minutes(
                resolver=resolver,
                calendar=calendar,
                machine=machine,
                bucket_start=bucket_start,
                bucket_end=bucket_end,
            )
            load = _load_breakdown(
                schedule.assignments,
                machine_id=machine_id,
                bucket_start=bucket_start,
                bucket_end=bucket_end,
            )
            baseline_load = _load_breakdown(
                baseline_assignments,
                machine_id=machine_id,
                bucket_start=bucket_start,
                bucket_end=bucket_end,
            )
            candidate_load = _load_breakdown(
                candidate_assignments,
                machine_id=machine_id,
                bucket_start=bucket_start,
                bucket_end=bucket_end,
            )
            if (
                not include_empty
                and capacity_minutes == 0
                and load.scheduled_load_minutes == 0
                and baseline_load.scheduled_load_minutes == 0
            ):
                continue
            utilization = (
                round(load.scheduled_load_minutes / capacity_minutes, 4)
                if capacity_minutes > 0
                else None
            )
            buckets.append(
                MachineCapacityBucket(
                    machine_id=machine_id,
                    machine_name=machine.name if machine is not None else None,
                    calendar_id=machine.calendar_id if machine is not None else None,
                    bucket_start=bucket_start,
                    bucket_end=bucket_end,
                    capacity_minutes=capacity_minutes,
                    scheduled_load_minutes=load.scheduled_load_minutes,
                    setup_minutes=load.setup_minutes,
                    run_minutes=load.run_minutes,
                    idle_minutes=max(capacity_minutes - load.scheduled_load_minutes, 0),
                    overload_minutes=max(load.scheduled_load_minutes - capacity_minutes, 0),
                    utilization=utilization,
                    operation_count=load.operation_count,
                    overlap_count=load.overlap_count,
                    pressure=_capacity_pressure(
                        load_minutes=load.scheduled_load_minutes,
                        capacity_minutes=capacity_minutes,
                    ),
                    baseline_load_minutes=baseline_load.scheduled_load_minutes,
                    candidate_load_minutes=candidate_load.scheduled_load_minutes,
                    load_delta_minutes=(
                        load.scheduled_load_minutes
                        - baseline_load.scheduled_load_minutes
                    ),
                )
            )

    summaries = _summarize_machines(
        buckets=buckets,
        machines=machines,
        assignments=schedule.assignments,
        horizon_start=horizon_start,
        horizon_end=horizon_end,
        scheduled_machine_ids=schedule_machine_ids,
    )
    bottleneck = _find_bottleneck(summaries)
    summaries = tuple(
        replace(
            summary,
            bottleneck=(
                bottleneck is not None
                and summary.machine_id == bottleneck.machine_id
            ),
        )
        for summary in summaries
    )
    total_capacity = sum(bucket.capacity_minutes for bucket in buckets)
    total_load = sum(bucket.scheduled_load_minutes for bucket in buckets)
    total_setup = sum(bucket.setup_minutes for bucket in buckets)
    total_run = sum(bucket.run_minutes for bucket in buckets)
    total_idle = sum(bucket.idle_minutes for bucket in buckets)
    total_overload = sum(bucket.overload_minutes for bucket in buckets)
    peak_utilization = max(
        (bucket.utilization for bucket in buckets if bucket.utilization is not None),
        default=None,
    )

    return MachineCapacityLedger(
        horizon_start=horizon_start,
        horizon_end=horizon_end,
        bucket=bucket,
        buckets=tuple(
            sorted(
                buckets,
                key=lambda item: (item.bucket_start, item.machine_id),
            )
        ),
        machines=summaries,
        total_capacity_minutes=total_capacity,
        total_scheduled_load_minutes=total_load,
        total_setup_minutes=total_setup,
        total_run_minutes=total_run,
        total_idle_minutes=total_idle,
        total_overload_minutes=total_overload,
        average_utilization=round(total_load / total_capacity, 4)
        if total_capacity > 0
        else None,
        peak_utilization=peak_utilization,
        bottleneck_machine_id=bottleneck.machine_id if bottleneck is not None else None,
        status=_ledger_status(
            total_capacity_minutes=total_capacity,
            total_load_minutes=total_load,
            total_overload_minutes=total_overload,
            peak_utilization=peak_utilization,
        ),
        warnings=tuple(sorted(warnings)),
    )


@dataclass(frozen=True, slots=True)
class _LoadBreakdown:
    scheduled_load_minutes: int
    setup_minutes: int
    run_minutes: int
    operation_count: int
    overlap_count: int


def _iter_buckets(
    *,
    horizon_start: datetime,
    horizon_end: datetime,
    bucket: str,
) -> list[tuple[datetime, datetime]]:
    if bucket == "horizon":
        return [(horizon_start, horizon_end)]

    if bucket == "week":
        start = _floor_to_day(horizon_start) - timedelta(days=horizon_start.weekday())
        step = timedelta(days=7)
    else:
        start = _floor_to_day(horizon_start)
        step = timedelta(days=1)

    buckets: list[tuple[datetime, datetime]] = []
    current = start
    while current < horizon_end:
        bucket_end = min(current + step, horizon_end)
        if bucket_end > horizon_start:
            buckets.append((current, bucket_end))
        current += step
    return buckets


def _floor_to_day(value: datetime) -> datetime:
    return value.replace(hour=0, minute=0, second=0, microsecond=0)


def _capacity_minutes(
    *,
    resolver: CalendarResolver,
    calendar: WorkingCalendar | None,
    machine: Machine | None,
    bucket_start: datetime,
    bucket_end: datetime,
) -> int:
    if calendar is None or machine is None:
        return 0
    return sum(
        _overlap_minutes(
            start=window.start,
            end=window.end,
            bucket_start=bucket_start,
            bucket_end=bucket_end,
        )
        for window in resolver.effective_windows(
            calendar,
            maintenance=machine.maintenance_windows,
        )
    )


def _load_breakdown(
    assignments: list[ScheduledOperation],
    *,
    machine_id: str,
    bucket_start: datetime,
    bucket_end: datetime,
) -> _LoadBreakdown:
    active = [
        assignment
        for assignment in assignments
        if assignment.machine_id == machine_id
        and assignment.setup_start < bucket_end
        and assignment.end > bucket_start
    ]
    setup_minutes = sum(
        _overlap_minutes(
            start=assignment.setup_start,
            end=assignment.start,
            bucket_start=bucket_start,
            bucket_end=bucket_end,
        )
        for assignment in active
    )
    run_minutes = sum(
        _productive_overlap_minutes(
            assignment=assignment,
            bucket_start=bucket_start,
            bucket_end=bucket_end,
        )
        for assignment in active
    )
    return _LoadBreakdown(
        scheduled_load_minutes=setup_minutes + run_minutes,
        setup_minutes=setup_minutes,
        run_minutes=run_minutes,
        operation_count=len(active),
        overlap_count=_overlap_count(active),
    )


def _productive_overlap_minutes(
    *,
    assignment: ScheduledOperation,
    bucket_start: datetime,
    bucket_end: datetime,
) -> int:
    if assignment.segments:
        return sum(
            _overlap_minutes(
                start=segment.start,
                end=segment.end,
                bucket_start=bucket_start,
                bucket_end=bucket_end,
            )
            for segment in assignment.segments
        )
    return _overlap_minutes(
        start=assignment.start,
        end=assignment.end,
        bucket_start=bucket_start,
        bucket_end=bucket_end,
    )


def _overlap_count(assignments: list[ScheduledOperation]) -> int:
    windows = sorted(
        (assignment.full_window for assignment in assignments),
        key=lambda window: window.start,
    )
    overlaps = 0
    for previous, current in zip(windows, windows[1:], strict=False):
        if previous.end > current.start:
            overlaps += 1
    return overlaps


def _overlap_minutes(
    *,
    start: datetime,
    end: datetime,
    bucket_start: datetime,
    bucket_end: datetime,
) -> int:
    overlap_start = max(start, bucket_start)
    overlap_end = min(end, bucket_end)
    if overlap_end <= overlap_start:
        return 0
    return int((overlap_end - overlap_start).total_seconds() // 60)


def _summarize_machines(
    *,
    buckets: list[MachineCapacityBucket],
    machines: list[Machine],
    assignments: list[ScheduledOperation],
    horizon_start: datetime,
    horizon_end: datetime,
    scheduled_machine_ids: set[str],
) -> tuple[MachineCapacitySummary, ...]:
    buckets_by_machine: dict[str, list[MachineCapacityBucket]] = {}
    for bucket in buckets:
        buckets_by_machine.setdefault(bucket.machine_id, []).append(bucket)
    machine_by_id = {machine.id: machine for machine in machines}
    all_machine_ids = sorted(set(machine_by_id) | scheduled_machine_ids)
    summaries: list[MachineCapacitySummary] = []
    for machine_id in all_machine_ids:
        machine = machine_by_id.get(machine_id)
        rows = buckets_by_machine.get(machine_id, [])
        capacity = sum(row.capacity_minutes for row in rows)
        load = sum(row.scheduled_load_minutes for row in rows)
        setup = sum(row.setup_minutes for row in rows)
        run = sum(row.run_minutes for row in rows)
        idle = sum(row.idle_minutes for row in rows)
        overload = sum(row.overload_minutes for row in rows)
        machine_operation_ids = {
            assignment.operation_id
            for assignment in assignments
            if assignment.machine_id == machine_id
            and assignment.setup_start < horizon_end
            and assignment.end > horizon_start
        }
        peak = max(
            (row.utilization for row in rows if row.utilization is not None),
            default=None,
        )
        summaries.append(
            MachineCapacitySummary(
                machine_id=machine_id,
                machine_name=machine.name if machine is not None else None,
                calendar_id=machine.calendar_id if machine is not None else None,
                capacity_minutes=capacity,
                scheduled_load_minutes=load,
                setup_minutes=setup,
                run_minutes=run,
                idle_minutes=idle,
                overload_minutes=overload,
                utilization=round(load / capacity, 4) if capacity > 0 else None,
                peak_utilization=peak,
                operation_count=len(machine_operation_ids),
                overlap_count=sum(row.overlap_count for row in rows),
                bucket_count=len(rows),
                pressure=_summary_pressure(
                    capacity_minutes=capacity,
                    load_minutes=load,
                    overload_minutes=overload,
                    peak_utilization=peak,
                ),
            )
        )
    return tuple(summaries)


def _find_bottleneck(
    summaries: tuple[MachineCapacitySummary, ...],
) -> MachineCapacitySummary | None:
    if not summaries:
        return None
    loaded = [
        summary
        for summary in summaries
        if summary.scheduled_load_minutes > 0 or summary.capacity_minutes > 0
    ]
    if not loaded:
        return None
    return max(
        loaded,
        key=lambda summary: (
            summary.overload_minutes > 0,
            summary.utilization or 0,
            summary.scheduled_load_minutes,
        ),
    )


def _capacity_pressure(
    *,
    load_minutes: int,
    capacity_minutes: int,
) -> str:
    if capacity_minutes <= 0:
        return "unavailable" if load_minutes > 0 else "closed"
    ratio = load_minutes / capacity_minutes
    if ratio > 1:
        return "over_capacity"
    if ratio >= 0.8:
        return "loaded"
    return "normal"


def _summary_pressure(
    *,
    capacity_minutes: int,
    load_minutes: int,
    overload_minutes: int,
    peak_utilization: float | None,
) -> str:
    if overload_minutes > 0:
        return "over_capacity"
    if capacity_minutes <= 0:
        return "unavailable" if load_minutes > 0 else "closed"
    if peak_utilization is not None and peak_utilization >= 0.8:
        return "loaded"
    return "normal"


def _ledger_status(
    *,
    total_capacity_minutes: int,
    total_load_minutes: int,
    total_overload_minutes: int,
    peak_utilization: float | None,
) -> str:
    if total_overload_minutes > 0:
        return "over_capacity"
    if total_capacity_minutes <= 0:
        return "no_capacity" if total_load_minutes > 0 else "empty"
    if peak_utilization is not None and peak_utilization >= 0.8:
        return "loaded"
    return "normal"
