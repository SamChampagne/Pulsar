"""Infinite-capacity rough-cut scheduling strategy.

This strategy answers a different question than the finite schedulers:
"when could the work complete if capacity were not the bottleneck?"  It
keeps precedence, calendars, transfer delays and material availability,
but deliberately does not book machine timelines. Multiple operations may
therefore overlap on the same machine, which is exactly what rough-cut and
early CTP flows need before committing to a finite schedule.
"""

from __future__ import annotations

import time
from datetime import datetime
from uuid import uuid4

from ..entities import (
    Machine,
    Operation,
    RoutingAlternative,
    Schedule,
    ScheduledOperation,
    WorkOrder,
)
from ..errors import CircularDependencyError, InfeasibleScheduleError
from ..value_objects import Duration, TransferTimes
from .calendar_resolver import CalendarResolver
from .context import SchedulingContext
from .dependency_links import dependency_ids_for_operation, operation_dependency_links
from .dependency_timing import dependency_max_start, dependency_min_start
from .diagnosis import Blocker, BlockerKind, InfeasibilityReport, OperationDiagnosis
from .material_ledger import MaterialLedger
from .objective import Objective, score_schedule
from .placement_helpers import adjust_duration_for_efficiency
from .setup_lookup import resolve_setup_minutes
from .slot_finder import SlotFinder
from .strategy import StrategyResult, register_strategy
from .timeline import ResourceTimeline


class InfiniteCapacityStrategy:
    """Rough-cut strategy that ignores finite machine contention."""

    name = "infinite"

    def __init__(self) -> None:
        self._slot_finder = SlotFinder()

    def solve(
        self,
        context: SchedulingContext,
        objective: Objective,
    ) -> StrategyResult:
        started = time.perf_counter()
        resolver = CalendarResolver(context.horizon_start, context.horizon_end)
        machine_map = context.machine_map()
        calendar_map = context.calendar_map()
        material_ledger = MaterialLedger(
            inventory_items=context.inventory_items,
            supplies=context.supplies,
            horizon_start=context.horizon_start,
        )

        completed_starts: dict[str, datetime] = {}
        completed_ends: dict[str, datetime] = {}
        completed_machine: dict[str, str] = {}
        assignments: list[ScheduledOperation] = []
        decision_trace: list[dict[str, object]] = []

        pending: list[tuple[WorkOrder, Operation]] = [
            (work_order, operation)
            for work_order in context.work_orders
            for operation in work_order.ordered_operations()
        ]
        known = {operation.id for _, operation in pending}
        for work_order, operation in pending:
            for dependency_id in dependency_ids_for_operation(work_order, operation):
                if dependency_id not in known:
                    raise CircularDependencyError(
                        f"Operation {operation.id} depends on unknown operation {dependency_id}"
                    )

        safety = len(pending) + 1
        while pending:
            safety -= 1
            if safety < 0:
                raise CircularDependencyError(
                    "Dependency cycle suspected: infinite scheduler made no progress"
                )

            ready = [
                (work_order, operation)
                for work_order, operation in pending
                if all(
                    dependency_id in completed_ends
                    for dependency_id in dependency_ids_for_operation(work_order, operation)
                )
            ]
            if not ready:
                raise CircularDependencyError(
                    "No operations are ready to rough-cut schedule"
                )

            ready.sort(
                key=lambda pair: (
                    pair[0].release_date,
                    pair[0].due_date,
                    pair[1].sequence,
                    pair[1].id,
                )
            )
            work_order, operation = ready[0]
            placement = self._place_operation(
                context=context,
                work_order=work_order,
                operation=operation,
                machine_map=machine_map,
                calendar_map=calendar_map,
                resolver=resolver,
                material_ledger=material_ledger,
                completed_starts=completed_starts,
                completed_ends=completed_ends,
                completed_machine=completed_machine,
            )
            assignments.append(
                ScheduledOperation(
                    operation_id=operation.id,
                    work_order_id=work_order.id,
                    machine_id=placement.machine.id,
                    setup_start=placement.setup_start,
                    start=placement.start,
                    end=placement.end,
                )
            )
            material_ledger.reserve(
                operation_id=operation.id,
                requirements=operation.material_requirements,
                work_order_quantity=work_order.quantity,
                required_at=placement.start,
            )
            completed_starts[operation.id] = placement.start
            completed_ends[operation.id] = placement.end
            completed_machine[operation.id] = placement.machine.id
            decision_trace.append(
                {
                    "operation_id": operation.id,
                    "work_order_id": work_order.id,
                    "machine_id": placement.machine.id,
                    "actual_start": placement.start.isoformat(),
                    "actual_end": placement.end.isoformat(),
                    "capacity_mode": "infinite",
                    "selected_routing": {
                        "machine_id": placement.routing.machine_id,
                        "duration_minutes": placement.routing.duration.minutes,
                        "setup_minutes": placement.routing.setup_time.minutes,
                    },
                }
            )
            pending.remove((work_order, operation))

        schedule = Schedule(
            id=context.run_id or f"run-{uuid4().hex[:12]}",
            created_at=datetime.utcnow(),
            assignments=assignments,
        )
        score = score_schedule(
            schedule,
            context.work_orders,
            objective,
            horizon_start=context.horizon_start,
            baseline_schedule=context.baseline_schedule,
        )
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return StrategyResult(
            schedule=schedule,
            objective_value=score,
            strategy_name=self.name,
            wall_time_ms=elapsed_ms,
            solver_status="rough_cut_feasible",
            diagnostics={
                "capacity_mode": "infinite",
                "rough_cut": True,
                "operations_placed": len(assignments),
                "decision_trace": decision_trace,
                "material_reservations": material_ledger.build_reservation_trace(),
            },
        )

    def _place_operation(
        self,
        *,
        context: SchedulingContext,
        work_order: WorkOrder,
        operation: Operation,
        machine_map: dict[str, Machine],
        calendar_map,
        resolver: CalendarResolver,
        material_ledger: MaterialLedger,
        completed_starts: dict[str, datetime],
        completed_ends: dict[str, datetime],
        completed_machine: dict[str, str],
    ) -> _InfinitePlacement:
        if not operation.eligible_machine_ids:
            self._raise(
                OperationDiagnosis(
                    operation_id=operation.id,
                    work_order_id=work_order.id,
                    earliest_possible_start=work_order.release_date,
                    blockers=[
                        Blocker(
                            kind=BlockerKind.NO_ELIGIBLE_MACHINE,
                            message=f"Operation {operation.id} has no eligible machines",
                        )
                    ],
                )
            )

        best: _InfinitePlacement | None = None
        for routing in operation.effective_routings():
            machine = machine_map[routing.machine_id]
            earliest_start, latest_start = self._compute_start_window(
                work_order,
                operation,
                completed_starts,
                completed_ends,
                completed_machine,
                context.transfer_times,
                candidate_machine_id=machine.id,
            )
            material = material_ledger.assess(
                requirements=operation.material_requirements,
                work_order_quantity=work_order.quantity,
                not_before=earliest_start,
                horizon_end=context.horizon_end,
            )
            if material.ready_at is None:
                continue
            earliest_start = max(earliest_start, material.ready_at)
            if latest_start is not None and earliest_start > latest_start:
                continue

            run_minutes = adjust_duration_for_efficiency(
                routing.duration, machine.efficiency
            ).minutes
            setup_minutes = resolve_setup_minutes(
                operation=operation,
                machine=machine,
                previous_family=None,
                default_minutes=routing.setup_time.minutes,
            )
            if machine.efficiency != 1.0:
                setup_minutes = max(int(round(setup_minutes / machine.efficiency)), 0)
            needed = Duration(minutes=max(run_minutes + setup_minutes, 1))
            windows = resolver.effective_windows(
                calendar_map[machine.calendar_id],
                maintenance=machine.maintenance_windows,
            )
            slot = self._slot_finder.find(
                earliest_start=earliest_start,
                required=needed,
                working_windows=windows,
                timeline=ResourceTimeline(machine_id=machine.id),
            )
            if slot is None:
                continue
            start = slot.start + Duration(minutes=setup_minutes).as_timedelta()
            if latest_start is not None and start > latest_start:
                continue
            placement = _InfinitePlacement(
                machine=machine,
                routing=routing,
                setup_start=slot.start,
                start=start,
                end=slot.end,
            )
            if (
                best is None
                or placement.end < best.end
                or (
                    placement.end == best.end
                    and placement.machine.id < best.machine.id
                )
            ):
                best = placement

        if best is None:
            self._raise(
                OperationDiagnosis(
                    operation_id=operation.id,
                    work_order_id=work_order.id,
                    earliest_possible_start=work_order.release_date,
                    blockers=[
                        Blocker(
                            kind=BlockerKind.HORIZON_TOO_SHORT,
                            message=(
                                f"Operation {operation.id} could not be placed "
                                "even under infinite capacity rough-cut assumptions"
                            ),
                        )
                    ],
                )
            )
        return best

    @staticmethod
    def _compute_start_window(
        work_order: WorkOrder,
        operation: Operation,
        completed_starts: dict[str, datetime],
        completed_ends: dict[str, datetime],
        completed_machine: dict[str, str],
        transfer_times: TransferTimes,
        *,
        candidate_machine_id: str,
    ) -> tuple[datetime, datetime | None]:
        earliest_candidates = [work_order.release_date]
        latest_candidates: list[datetime] = []
        for link in operation_dependency_links(work_order, operation):
            dep_id = link.depends_on_id
            if dep_id not in completed_starts or dep_id not in completed_ends:
                continue
            transfer = transfer_times.minutes(
                completed_machine.get(dep_id),
                candidate_machine_id,
            )
            earliest_candidates.append(
                dependency_min_start(
                    link,
                    predecessor_start=completed_starts[dep_id],
                    predecessor_end=completed_ends[dep_id],
                    transfer_minutes=transfer,
                )
            )
            latest = dependency_max_start(
                link,
                predecessor_start=completed_starts[dep_id],
                predecessor_end=completed_ends[dep_id],
            )
            if latest is not None:
                latest_candidates.append(latest)
        return max(earliest_candidates), (
            min(latest_candidates) if latest_candidates else None
        )

    @staticmethod
    def _raise(diag: OperationDiagnosis) -> None:
        report = InfeasibilityReport(
            strategy="infinite",
            scheduled_so_far=0,
            total_operations=0,
            operations=[diag],
            suggestions=[
                "Extend the rough-cut horizon, add a routing candidate, or review material dates."
            ],
        )
        raise InfeasibleScheduleError(
            f"Operation {diag.operation_id} could not be rough-cut scheduled",
            report=report,
        )


class _InfinitePlacement:
    __slots__ = ("machine", "routing", "setup_start", "start", "end")

    def __init__(
        self,
        *,
        machine: Machine,
        routing: RoutingAlternative,
        setup_start: datetime,
        start: datetime,
        end: datetime,
    ) -> None:
        self.machine = machine
        self.routing = routing
        self.setup_start = setup_start
        self.start = start
        self.end = end


register_strategy("infinite", InfiniteCapacityStrategy)
