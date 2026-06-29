"""KPIs computed from a finished :class:`Schedule`."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from ..entities import Schedule, WorkOrder


@dataclass(slots=True)
class ScheduleStability:
    compared_operation_count: int
    unchanged_operation_count: int
    changed_operation_count: int
    moved_operation_count: int
    machine_change_count: int
    introduced_operation_count: int
    removed_operation_count: int
    total_start_shift_minutes: int
    max_start_shift_minutes: int
    stability_ratio: float

    def as_dict(self) -> dict[str, object]:
        return {
            "compared_operation_count": self.compared_operation_count,
            "unchanged_operation_count": self.unchanged_operation_count,
            "changed_operation_count": self.changed_operation_count,
            "moved_operation_count": self.moved_operation_count,
            "machine_change_count": self.machine_change_count,
            "introduced_operation_count": self.introduced_operation_count,
            "removed_operation_count": self.removed_operation_count,
            "total_start_shift_minutes": self.total_start_shift_minutes,
            "max_start_shift_minutes": self.max_start_shift_minutes,
            "stability_ratio": round(self.stability_ratio, 4),
        }


@dataclass(slots=True)
class ScheduleMetrics:
    makespan_minutes: int
    total_lateness_minutes: int
    on_time_ratio: float
    machine_utilization: dict[str, float]  # machine_id -> fraction [0, 1]
    queue_time_minutes_avg: int
    changeover_ratio: float
    saturation_max: float
    saturation_p95: float
    wip_operation_count: int
    campaign_efficiency: float
    stability: ScheduleStability | None = None

    def as_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "makespan_minutes": self.makespan_minutes,
            "total_lateness_minutes": self.total_lateness_minutes,
            "on_time_ratio": round(self.on_time_ratio, 4),
            "machine_utilization": {
                m: round(u, 4) for m, u in self.machine_utilization.items()
            },
            "queue_time_minutes_avg": self.queue_time_minutes_avg,
            "changeover_ratio": round(self.changeover_ratio, 4),
            "saturation_max": round(self.saturation_max, 4),
            "saturation_p95": round(self.saturation_p95, 4),
            "wip_operation_count": self.wip_operation_count,
            "campaign_efficiency": round(self.campaign_efficiency, 4),
        }
        if self.stability is not None:
            payload["stability"] = self.stability.as_dict()
        return payload


def compute_stability(
    schedule: Schedule,
    baseline_schedule: Schedule,
) -> ScheduleStability:
    baseline_by_op = {
        assignment.operation_id: assignment
        for assignment in baseline_schedule.assignments
    }
    current_by_op = {
        assignment.operation_id: assignment
        for assignment in schedule.assignments
    }

    unchanged = 0
    changed = 0
    moved = 0
    machine_changed = 0
    total_start_shift_minutes = 0
    max_start_shift_minutes = 0

    for operation_id in sorted(set(baseline_by_op) & set(current_by_op)):
        previous = baseline_by_op[operation_id]
        current = current_by_op[operation_id]
        same_machine = current.machine_id == previous.machine_id
        same_timing = (
            current.setup_start == previous.setup_start
            and current.start == previous.start
            and current.end == previous.end
        )
        if same_machine and same_timing:
            unchanged += 1
            continue

        changed += 1
        if not same_machine:
            machine_changed += 1
        if (
            current.setup_start != previous.setup_start
            or current.start != previous.start
            or current.end != previous.end
        ):
            moved += 1
            shift_minutes = int(abs((current.start - previous.start).total_seconds()) // 60)
            total_start_shift_minutes += shift_minutes
            if shift_minutes > max_start_shift_minutes:
                max_start_shift_minutes = shift_minutes

    introduced = len(set(current_by_op) - set(baseline_by_op))
    removed = len(set(baseline_by_op) - set(current_by_op))
    tracked_total = max(len(set(current_by_op) | set(baseline_by_op)), 1)

    return ScheduleStability(
        compared_operation_count=len(set(current_by_op) & set(baseline_by_op)),
        unchanged_operation_count=unchanged,
        changed_operation_count=changed,
        moved_operation_count=moved,
        machine_change_count=machine_changed,
        introduced_operation_count=introduced,
        removed_operation_count=removed,
        total_start_shift_minutes=total_start_shift_minutes,
        max_start_shift_minutes=max_start_shift_minutes,
        stability_ratio=unchanged / tracked_total,
    )


def compute_metrics(
    schedule: Schedule,
    work_orders: list[WorkOrder],
    *,
    horizon_start: datetime,
    horizon_end: datetime,
    baseline_schedule: Schedule | None = None,
) -> ScheduleMetrics:
    wip_count = _wip_count(work_orders)

    if not schedule.assignments:
        return ScheduleMetrics(
            makespan_minutes=0,
            total_lateness_minutes=0,
            on_time_ratio=1.0,
            machine_utilization={},
            queue_time_minutes_avg=0,
            changeover_ratio=0.0,
            saturation_max=0.0,
            saturation_p95=0.0,
            wip_operation_count=wip_count,
            campaign_efficiency=1.0,
            stability=(
                compute_stability(schedule, baseline_schedule)
                if baseline_schedule is not None
                else None
            ),
        )

    # Makespan: longest end - earliest start.
    earliest = min(a.setup_start for a in schedule.assignments)
    latest = max(a.end for a in schedule.assignments)
    makespan = int((latest - earliest).total_seconds() // 60)

    # Lateness: per WO, compare the WO's latest op.end with its due date.
    wo_ends: dict[str, datetime] = {}
    wo_first_starts: dict[str, datetime] = {}
    for a in schedule.assignments:
        current = wo_ends.get(a.work_order_id)
        if current is None or a.end > current:
            wo_ends[a.work_order_id] = a.end
        first = wo_first_starts.get(a.work_order_id)
        if first is None or a.start < first:
            wo_first_starts[a.work_order_id] = a.start

    total_lateness = 0
    on_time_count = 0
    for wo in work_orders:
        end = wo_ends.get(wo.id)
        if end is None:
            continue
        if end <= wo.due_date:
            on_time_count += 1
        else:
            total_lateness += int((end - wo.due_date).total_seconds() // 60)

    on_time_ratio = on_time_count / len(work_orders) if work_orders else 1.0

    # Utilization: sum of booked minutes per machine divided by horizon.
    horizon_minutes = max(int((horizon_end - horizon_start).total_seconds() // 60), 1)
    util: dict[str, float] = {}
    setup_minutes_total = 0
    booked_minutes_total = 0
    for a in schedule.assignments:
        busy = int((a.end - a.setup_start).total_seconds() // 60)
        util[a.machine_id] = util.get(a.machine_id, 0.0) + busy
        setup_minutes_total += int((a.start - a.setup_start).total_seconds() // 60)
        booked_minutes_total += busy
    machine_utilization = {m: (mins / horizon_minutes) for m, mins in util.items()}

    # Queue time: avg(first_op.start - wo.release_date) over scheduled WOs.
    queue_total = 0
    queue_samples = 0
    wo_by_id = {wo.id: wo for wo in work_orders}
    for wo_id, first_start in wo_first_starts.items():
        wo = wo_by_id.get(wo_id)
        if wo is None:
            continue
        delta = int((first_start - wo.release_date).total_seconds() // 60)
        queue_total += max(delta, 0)
        queue_samples += 1
    queue_time_minutes_avg = (
        queue_total // queue_samples if queue_samples > 0 else 0
    )

    # Changeover ratio: setup minutes over total booked minutes.
    changeover_ratio = (
        setup_minutes_total / booked_minutes_total
        if booked_minutes_total > 0
        else 0.0
    )

    # Saturation aggregates over machines.
    util_values = list(machine_utilization.values())
    saturation_max = max(util_values) if util_values else 0.0
    saturation_p95 = _percentile(util_values, 0.95) if util_values else 0.0

    # Campaign efficiency: per-machine setup-family chaining ratio.
    campaign_efficiency = _campaign_efficiency(schedule, work_orders)

    return ScheduleMetrics(
        makespan_minutes=makespan,
        total_lateness_minutes=total_lateness,
        on_time_ratio=on_time_ratio,
        machine_utilization=machine_utilization,
        queue_time_minutes_avg=queue_time_minutes_avg,
        changeover_ratio=changeover_ratio,
        saturation_max=saturation_max,
        saturation_p95=saturation_p95,
        wip_operation_count=wip_count,
        campaign_efficiency=campaign_efficiency,
        stability=(
            compute_stability(schedule, baseline_schedule)
            if baseline_schedule is not None
            else None
        ),
    )


def _wip_count(work_orders: list[WorkOrder]) -> int:
    count = 0
    for wo in work_orders:
        for op in wo.operations:
            if op.actual_start is not None and op.actual_end is None:
                count += 1
    return count


def _campaign_efficiency(
    schedule: Schedule,
    work_orders: list[WorkOrder],
) -> float:
    """Ratio of operations that share a setup_family with a neighbour
    on the same machine (sorted by start). Operations without a
    setup_family never count as chained.
    """
    family_by_op: dict[str, str | None] = {}
    for wo in work_orders:
        for op in wo.operations:
            family_by_op[op.id] = op.setup_family

    by_machine: dict[str, list] = {}
    for a in schedule.assignments:
        by_machine.setdefault(a.machine_id, []).append(a)

    total = 0
    chained = 0
    for ops in by_machine.values():
        ops.sort(key=lambda a: a.start)
        n = len(ops)
        for i, a in enumerate(ops):
            family = family_by_op.get(a.operation_id)
            total += 1
            if family is None:
                continue
            prev_family = (
                family_by_op.get(ops[i - 1].operation_id) if i > 0 else None
            )
            next_family = (
                family_by_op.get(ops[i + 1].operation_id) if i < n - 1 else None
            )
            if prev_family == family or next_family == family:
                chained += 1

    return chained / total if total > 0 else 1.0


def _percentile(values: list[float], q: float) -> float:
    """Linear-interpolation percentile. q in [0, 1]."""
    if not values:
        return 0.0
    sorted_values = sorted(values)
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = q * (len(sorted_values) - 1)
    lower_index = int(rank)
    upper_index = min(lower_index + 1, len(sorted_values) - 1)
    fraction = rank - lower_index
    return sorted_values[lower_index] + fraction * (
        sorted_values[upper_index] - sorted_values[lower_index]
    )
