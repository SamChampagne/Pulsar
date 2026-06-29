"""Post-hoc schedule analysis utilities.

After a strategy produces a :class:`Schedule`, planners need more than
raw KPIs — they need to understand *why* the schedule looks the way it
does and *where* to intervene. This module provides:

1. **Critical path** — the longest chain of dependent operations that
   determines the makespan. Any delay on this chain delays the entire
   schedule. Planners use it to decide where overtime or extra capacity
   is justified.

2. **Bottleneck identification** — which machine(s) have the highest
   utilization or the largest queue? The bottleneck constrains
   throughput; improving it improves the whole shop.

3. **Per-machine utilization breakdown** — busy, setup, and idle
   minutes for each machine, ready for dashboard display.

4. **Work-order flow times** — release-to-completion time per WO,
   useful for lead-time analysis and customer SLA tracking.

5. **Gantt data export** — a flat list of dicts suitable for direct
   rendering in a Gantt chart library (Plotly, Matplotlib, etc.).

All functions are pure — they take a finished :class:`Schedule` and
context objects as input and return plain data structures. No side
effects, no database access.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from ..entities import Schedule, WorkOrder
from .dependency_links import dependency_ids_for_operation

# -----------------------------------------------------------------------
# Data structures
# -----------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class CriticalPathResult:
    """The critical path through a schedule.

    ``operations``
        Operation IDs on the critical path, in chronological order.
    ``total_minutes``
        End-to-end duration of the critical path (= makespan if the
        path starts at the first operation and ends at the last).
    ``work_orders``
        Unique work order IDs touched by the critical path.
    """

    operations: list[str]
    total_minutes: int
    work_orders: list[str]


@dataclass(frozen=True, slots=True)
class MachineAnalysis:
    """Per-machine utilization breakdown."""

    machine_id: str
    busy_minutes: int
    setup_minutes: int
    idle_minutes: int
    total_span_minutes: int
    utilization: float  # busy / span, in [0, 1]
    num_operations: int


@dataclass(frozen=True, slots=True)
class BottleneckResult:
    """Bottleneck identification result.

    The bottleneck is the machine with the highest utilization. When
    multiple machines tie, the one with the most operations wins.
    """

    bottleneck_machine_id: str
    bottleneck_utilization: float
    machines: list[MachineAnalysis]


@dataclass(frozen=True, slots=True)
class WorkOrderFlowTime:
    """Flow-time analysis for a single work order."""

    work_order_id: str
    release: datetime
    due: datetime
    completion: datetime
    flow_time_minutes: int  # completion - release
    tardiness_minutes: int  # max(0, completion - due)
    is_on_time: bool


@dataclass(frozen=True, slots=True)
class GanttEntry:
    """A single bar in a Gantt chart."""

    operation_id: str
    work_order_id: str
    machine_id: str
    setup_start: datetime
    start: datetime
    end: datetime
    setup_minutes: int
    run_minutes: int


@dataclass(frozen=True, slots=True)
class ScheduleAnalysis:
    """Complete analysis bundle."""

    critical_path: CriticalPathResult
    bottleneck: BottleneckResult
    flow_times: list[WorkOrderFlowTime]
    gantt: list[GanttEntry]

    def as_dict(self) -> dict:
        return {
            "critical_path": {
                "operations": self.critical_path.operations,
                "total_minutes": self.critical_path.total_minutes,
                "work_orders": self.critical_path.work_orders,
            },
            "bottleneck": {
                "machine_id": self.bottleneck.bottleneck_machine_id,
                "utilization": round(self.bottleneck.bottleneck_utilization, 4),
            },
            "flow_times": [
                {
                    "work_order_id": ft.work_order_id,
                    "flow_time_minutes": ft.flow_time_minutes,
                    "tardiness_minutes": ft.tardiness_minutes,
                    "is_on_time": ft.is_on_time,
                }
                for ft in self.flow_times
            ],
            "machine_utilization": [
                {
                    "machine_id": m.machine_id,
                    "busy_minutes": m.busy_minutes,
                    "setup_minutes": m.setup_minutes,
                    "idle_minutes": m.idle_minutes,
                    "utilization": round(m.utilization, 4),
                    "num_operations": m.num_operations,
                }
                for m in self.bottleneck.machines
            ],
        }


# -----------------------------------------------------------------------
# Critical path computation
# -----------------------------------------------------------------------


def compute_critical_path(
    schedule: Schedule,
    work_orders: list[WorkOrder],
) -> CriticalPathResult:
    """Find the critical path through a schedule.

    The critical path is the longest chain of operations where each
    operation either:
    - depends on the previous via a precedence constraint (same WO), or
    - is blocked by the previous because they share the same machine
      and run back-to-back.

    We build a DAG of (operation → successors) and find the longest
    path using dynamic programming on the topological order (by end
    time).
    """
    if not schedule.assignments:
        return CriticalPathResult(operations=[], total_minutes=0, work_orders=[])

    # Build lookup structures.
    op_end: dict[str, datetime] = {}
    op_start: dict[str, datetime] = {}
    op_wo: dict[str, str] = {}
    op_machine: dict[str, str] = {}

    for a in schedule.assignments:
        op_end[a.operation_id] = a.end
        op_start[a.operation_id] = a.start
        op_wo[a.operation_id] = a.work_order_id
        op_machine[a.operation_id] = a.machine_id

    # Build precedence successors from work order dependencies.
    dep_successors: dict[str, list[str]] = {}
    for wo in work_orders:
        for op in wo.operations:
            for dep_id in dependency_ids_for_operation(wo, op):
                dep_successors.setdefault(dep_id, []).append(op.id)

    # Build machine successors: on each machine, operations are ordered
    # by start time. Each op's machine-successor is the next op on that
    # machine.
    machine_ops: dict[str, list[str]] = {}
    for a in sorted(schedule.assignments, key=lambda x: x.start):
        machine_ops.setdefault(a.machine_id, []).append(a.operation_id)

    machine_successors: dict[str, list[str]] = {}
    for ops in machine_ops.values():
        for i in range(len(ops) - 1):
            machine_successors.setdefault(ops[i], []).append(ops[i + 1])

    # Merge successor lists.
    all_ops = list(op_end.keys())
    successors: dict[str, set[str]] = {}
    for op_id in all_ops:
        succs: set[str] = set()
        succs.update(dep_successors.get(op_id, []))
        succs.update(machine_successors.get(op_id, []))
        successors[op_id] = succs

    # Longest path via DP. Process operations in reverse topological
    # order (by descending end time). For each op, the longest path
    # from it = its own duration + max(longest path from each successor).
    sorted_ops = sorted(all_ops, key=lambda x: op_end[x], reverse=True)

    longest_from: dict[str, int] = {}
    next_on_path: dict[str, str | None] = {}

    for op_id in sorted_ops:
        own_duration = int((op_end[op_id] - op_start[op_id]).total_seconds() // 60)
        best_continuation = 0
        best_next: str | None = None

        for succ_id in successors.get(op_id, set()):
            if succ_id in longest_from:
                candidate = longest_from[succ_id]
                if candidate > best_continuation:
                    best_continuation = candidate
                    best_next = succ_id

        longest_from[op_id] = own_duration + best_continuation
        next_on_path[op_id] = best_next

    # Find the starting operation of the critical path.
    if not longest_from:
        return CriticalPathResult(operations=[], total_minutes=0, work_orders=[])

    start_op = max(longest_from, key=lambda x: longest_from[x])
    total_minutes = longest_from[start_op]

    # Trace the path.
    path: list[str] = []
    current: str | None = start_op
    while current is not None:
        path.append(current)
        current = next_on_path.get(current)

    wo_ids = list(dict.fromkeys(op_wo[op_id] for op_id in path))

    return CriticalPathResult(
        operations=path,
        total_minutes=total_minutes,
        work_orders=wo_ids,
    )


# -----------------------------------------------------------------------
# Bottleneck identification
# -----------------------------------------------------------------------


def compute_bottleneck(schedule: Schedule) -> BottleneckResult:
    """Identify the bottleneck machine and return per-machine analysis."""
    if not schedule.assignments:
        return BottleneckResult(
            bottleneck_machine_id="",
            bottleneck_utilization=0.0,
            machines=[],
        )

    # Group assignments by machine.
    by_machine: dict[str, list] = {}
    for a in schedule.assignments:
        by_machine.setdefault(a.machine_id, []).append(a)

    analyses: list[MachineAnalysis] = []
    for machine_id, assignments in sorted(by_machine.items()):
        assignments.sort(key=lambda a: a.setup_start)

        busy = 0
        setup = 0
        for a in assignments:
            setup_min = int((a.start - a.setup_start).total_seconds() // 60)
            run_min = int((a.end - a.start).total_seconds() // 60)
            setup += setup_min
            busy += run_min

        first_start = assignments[0].setup_start
        last_end = assignments[-1].end
        span = max(int((last_end - first_start).total_seconds() // 60), 1)
        idle = max(span - busy - setup, 0)
        utilization = (busy + setup) / span if span > 0 else 0.0

        analyses.append(
            MachineAnalysis(
                machine_id=machine_id,
                busy_minutes=busy,
                setup_minutes=setup,
                idle_minutes=idle,
                total_span_minutes=span,
                utilization=utilization,
                num_operations=len(assignments),
            )
        )

    # Bottleneck = highest utilization, tie-break by num_operations.
    bottleneck = max(analyses, key=lambda m: (m.utilization, m.num_operations))

    return BottleneckResult(
        bottleneck_machine_id=bottleneck.machine_id,
        bottleneck_utilization=bottleneck.utilization,
        machines=analyses,
    )


# -----------------------------------------------------------------------
# Work-order flow times
# -----------------------------------------------------------------------


def compute_flow_times(
    schedule: Schedule,
    work_orders: list[WorkOrder],
) -> list[WorkOrderFlowTime]:
    """Compute release-to-completion flow time for each work order."""
    wo_completion: dict[str, datetime] = {}
    for a in schedule.assignments:
        current = wo_completion.get(a.work_order_id)
        if current is None or a.end > current:
            wo_completion[a.work_order_id] = a.end

    wo_by_id = {wo.id: wo for wo in work_orders}
    result: list[WorkOrderFlowTime] = []

    for wo_id, completion in sorted(wo_completion.items()):
        wo = wo_by_id.get(wo_id)
        if wo is None:
            continue
        flow_min = int((completion - wo.release_date).total_seconds() // 60)
        tardiness = max(
            int((completion - wo.due_date).total_seconds() // 60), 0
        )
        result.append(
            WorkOrderFlowTime(
                work_order_id=wo_id,
                release=wo.release_date,
                due=wo.due_date,
                completion=completion,
                flow_time_minutes=flow_min,
                tardiness_minutes=tardiness,
                is_on_time=completion <= wo.due_date,
            )
        )

    return result


# -----------------------------------------------------------------------
# Gantt data export
# -----------------------------------------------------------------------


def export_gantt(schedule: Schedule) -> list[GanttEntry]:
    """Export schedule as a flat list of Gantt chart entries.

    Sorted by machine, then by start time — ready for rendering.
    """
    entries: list[GanttEntry] = []
    for a in sorted(
        schedule.assignments,
        key=lambda x: (x.machine_id, x.setup_start),
    ):
        setup_min = int((a.start - a.setup_start).total_seconds() // 60)
        run_min = int((a.end - a.start).total_seconds() // 60)
        entries.append(
            GanttEntry(
                operation_id=a.operation_id,
                work_order_id=a.work_order_id,
                machine_id=a.machine_id,
                setup_start=a.setup_start,
                start=a.start,
                end=a.end,
                setup_minutes=setup_min,
                run_minutes=run_min,
            )
        )
    return entries


# -----------------------------------------------------------------------
# Convenience: full analysis in one call
# -----------------------------------------------------------------------


def analyze_schedule(
    schedule: Schedule,
    work_orders: list[WorkOrder],
) -> ScheduleAnalysis:
    """Run all analyses and return a consolidated result."""
    return ScheduleAnalysis(
        critical_path=compute_critical_path(schedule, work_orders),
        bottleneck=compute_bottleneck(schedule),
        flow_times=compute_flow_times(schedule, work_orders),
        gantt=export_gantt(schedule),
    )
