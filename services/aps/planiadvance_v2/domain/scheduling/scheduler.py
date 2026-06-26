"""Legacy forward APS scheduler.

The :class:`Scheduler` predates the strategy registry and is kept mostly for
backward compatibility with older tests and callers.

Important runtime note
----------------------
The application use cases do **not** call this class directly anymore. The
real runtime entrypoint is now ``resolve_strategy(...)`` which dispatches to
``greedy``, ``backward``, ``cpsat`` and the metaheuristics.

So this module is still valid code, but it is no longer the primary engine
path used by the API / CLI / use cases.

Algorithm (greedy forward scheduling)
-------------------------------------
1. Build per-machine timelines (empty at start).
2. Build per-calendar working-window lists via :class:`CalendarResolver`.
3. Topologically walk operations, respecting:
   - Intra-WO sequence (op.sequence)
   - Cross-op dependencies (op.dependencies)
   - Release dates (wo.release_date)
4. At each step, ask the heuristic to pick the next eligible (WO, operation)
   pair whose dependencies are already scheduled.
5. For that operation, try every eligible machine and pick the earliest
   feasible slot (ties broken by machine id for determinism).
6. Commit the booking and repeat until all operations are scheduled (or we
   run out of horizon, in which case an :class:`InfeasibleScheduleError` is
   raised).

This scheduler is deterministic: given the same inputs it always produces
the same schedule, which is critical for testing, auditing and reproducing
bugs.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import uuid4

from ..entities import Machine, Operation, Schedule, ScheduledOperation, WorkOrder
from ..errors import CircularDependencyError, InfeasibleScheduleError
from ..value_objects import Duration, TimeWindow
from .calendar_resolver import CalendarResolver
from .constraints import DEFAULT_CONSTRAINTS, Constraint, PlacementProposal
from .context import SchedulingContext
from .heuristics import EarliestDueDateFirst, Heuristic, PendingItem
from .slot_finder import SlotFinder
from .timeline import ResourceTimeline


@dataclass(slots=True)
class _Placement:
    machine: Machine
    setup_window: TimeWindow
    run_window: TimeWindow


class Scheduler:
    """Legacy forward scheduler kept for compatibility.

    New runtime integrations should prefer :func:`resolve_strategy` and the
    concrete strategy classes instead of instantiating :class:`Scheduler`
    directly.
    """

    def __init__(
        self,
        *,
        heuristic: Heuristic | None = None,
        constraints: tuple[Constraint, ...] = DEFAULT_CONSTRAINTS,
        slot_finder: SlotFinder | None = None,
    ) -> None:
        self._heuristic = heuristic or EarliestDueDateFirst()
        self._constraints = constraints
        self._slot_finder = slot_finder or SlotFinder()

    def schedule(self, context: SchedulingContext) -> Schedule:
        timelines = {m.id: ResourceTimeline(machine_id=m.id) for m in context.machines}
        resolver = CalendarResolver(context.horizon_start, context.horizon_end)
        machine_map = context.machine_map()
        calendar_map = context.calendar_map()

        completed_ends: dict[str, datetime] = {}  # operation_id -> end datetime
        assignments: list[ScheduledOperation] = []

        pending = self._collect_pending(context.work_orders)
        self._validate_dag(pending)

        safety_counter = len(pending) + 1
        while pending:
            safety_counter -= 1
            if safety_counter < 0:
                raise CircularDependencyError(
                    "Dependency cycle suspected: scheduler made no progress"
                )

            ready = [
                (wo, op)
                for wo, op in pending
                if all(dep in completed_ends for dep in op.dependencies)
            ]
            if not ready:
                raise CircularDependencyError(
                    "No operations are ready to schedule — dependency cycle"
                )

            ready = self._heuristic.order(ready, context.horizon_start)

            for wo, op in ready:
                placement = self._place_operation(
                    work_order=wo,
                    operation=op,
                    machine_map=machine_map,
                    calendar_map=calendar_map,
                    timelines=timelines,
                    resolver=resolver,
                    completed_ends=completed_ends,
                )
                timelines[placement.machine.id].book(
                    TimeWindow(
                        start=placement.setup_window.start,
                        end=placement.run_window.end,
                    ),
                    operation_id=op.id,
                )
                assignments.append(
                    ScheduledOperation(
                        operation_id=op.id,
                        work_order_id=wo.id,
                        machine_id=placement.machine.id,
                        setup_start=placement.setup_window.start,
                        start=placement.run_window.start,
                        end=placement.run_window.end,
                    )
                )
                completed_ends[op.id] = placement.run_window.end
                pending.remove((wo, op))
                # Re-enter the outer loop so the heuristic is re-applied with
                # fresh "ready" information after each placement.
                break

        return Schedule(
            id=context.run_id or f"run-{uuid4().hex[:12]}",
            created_at=datetime.utcnow(),
            assignments=assignments,
        )

    # ------------------------------------------------------------------ private

    @staticmethod
    def _collect_pending(work_orders: list[WorkOrder]) -> list[PendingItem]:
        pending: list[PendingItem] = []
        for wo in work_orders:
            for op in wo.ordered_operations():
                pending.append((wo, op))
        return pending

    @staticmethod
    def _validate_dag(pending: list[PendingItem]) -> None:
        """Cheap sanity check: every declared dependency must exist in the
        same scheduling run. Full cycle detection is deferred to the main
        loop, which progresses monotonically and detects cycles naturally.
        """
        known = {op.id for _, op in pending}
        for _, op in pending:
            for dep in op.dependencies:
                if dep not in known:
                    raise CircularDependencyError(
                        f"Operation {op.id} depends on unknown operation {dep}"
                    )

    def _place_operation(
        self,
        *,
        work_order: WorkOrder,
        operation: Operation,
        machine_map: dict[str, Machine],
        calendar_map,
        timelines: dict[str, ResourceTimeline],
        resolver: CalendarResolver,
        completed_ends: dict[str, datetime],
    ) -> _Placement:
        earliest_start = self._compute_earliest_start(
            work_order, operation, completed_ends
        )
        needed = operation.total_processing_time

        best: _Placement | None = None
        rejections: list[str] = []

        for machine_id in operation.eligible_machine_ids:
            machine = machine_map[machine_id]
            windows = resolver.working_windows(calendar_map[machine.calendar_id])
            adjusted_need = self._adjust_for_efficiency(needed, machine.efficiency)

            slot = self._slot_finder.find(
                earliest_start=earliest_start,
                required=adjusted_need,
                working_windows=windows,
                timeline=timelines[machine_id],
            )
            if slot is None:
                rejections.append(f"{machine_id}: no free slot in horizon")
                continue

            setup_window, run_window = self._split_setup_run(
                slot, operation, machine.efficiency
            )
            proposal = PlacementProposal(operation, machine, run_window)
            reason = self._first_rejection(proposal)
            if reason is not None:
                rejections.append(reason)
                continue

            if best is None or run_window.end < best.run_window.end:
                best = _Placement(
                    machine=machine,
                    setup_window=setup_window,
                    run_window=run_window,
                )

        if best is None:
            raise InfeasibleScheduleError(
                f"Operation {operation.id} could not be placed. "
                f"Tried: {rejections or 'no eligible machines'}"
            )
        return best

    @staticmethod
    def _compute_earliest_start(
        work_order: WorkOrder,
        operation: Operation,
        completed_ends: dict[str, datetime],
    ) -> datetime:
        candidates: list[datetime] = [work_order.release_date]
        for dep_id in operation.dependencies:
            if dep_id in completed_ends:
                candidates.append(completed_ends[dep_id])
        # Previous operation in the WO (by sequence) is also an implicit dep.
        for op in work_order.ordered_operations():
            if op.sequence >= operation.sequence:
                break
            if op.id in completed_ends:
                candidates.append(completed_ends[op.id])
        return max(candidates)

    @staticmethod
    def _adjust_for_efficiency(duration: Duration, efficiency: float) -> Duration:
        if efficiency == 1.0:
            return duration
        adjusted = int(round(duration.minutes / efficiency))
        return Duration(minutes=max(adjusted, 1))

    @staticmethod
    def _split_setup_run(
        slot: TimeWindow, operation: Operation, efficiency: float
    ) -> tuple[TimeWindow, TimeWindow]:
        setup_minutes = Scheduler._adjust_for_efficiency(
            operation.setup_time, efficiency
        ).minutes
        setup_window = TimeWindow(
            start=slot.start,
            end=slot.start + Duration(minutes=setup_minutes).as_timedelta(),
        )
        run_window = TimeWindow(start=setup_window.end, end=slot.end)
        return setup_window, run_window

    def _first_rejection(self, proposal: PlacementProposal) -> str | None:
        for constraint in self._constraints:
            reason = constraint.validate(proposal)
            if reason is not None:
                return reason
        return None
