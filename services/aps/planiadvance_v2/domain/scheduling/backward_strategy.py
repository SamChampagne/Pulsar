"""Backward (just-in-time) greedy scheduling strategy.

Forward dispatching packs operations as early as possible, which is the
safe choice when demand is uncertain. When due dates are firm — contracts
with late penalties, perishable intermediates, limited WIP storage — a
*backward* schedule is preferable: every operation is placed as late as
possible while still meeting its successor's start, down to the release
date. This minimizes inventory holding, reduces WIP and makes the plan
naturally robust to early disruptions (buffer lives on the left of the
schedule rather than sprinkled everywhere).

Algorithm
---------
1. Build the reverse dependency graph.
2. For each operation, the ``latest_end`` constraint is the minimum of:
    - the work order's due date;
    - the start time already assigned to any successor in the DAG;
    - the start time already assigned to the operation with
      ``sequence == self.sequence + 1`` in the same work order
      (implicit linear chain).
3. Walk operations in reverse topological order (successors first). For
   each operation, pick the machine whose latest feasible slot starts as
   late as possible — that's the machine :meth:`SlotFinder.find_latest_end`
   returns — and book it.
4. Keep track of ``last_family`` per machine *in forward time*, which in
   the backward walk means "family of the next op already placed". Setup
   minutes depend on the *predecessor* family — and since we haven't
   placed predecessors yet, we conservatively use the machine's
   ``default_minutes`` matrix entry. This slightly overstates setup in
   exchange for keeping the algorithm strictly single-pass. A two-pass
   refinement pass is left as a future improvement.

Failure handling mirrors the forward strategy: a structured
:class:`InfeasibilityReport` with per-machine blockers.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta
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
from ..value_objects import Duration, TimeWindow, TransferTimes
from .calendar_resolver import CalendarResolver
from .constraints import DEFAULT_CONSTRAINTS, Constraint, PlacementProposal
from .context import SchedulingContext
from .cumulative_timeline import CumulativeResourceTimeline
from .dependency_links import dependency_ids_for_operation, operation_dependency_links
from .diagnosis import (
    Blocker,
    BlockerKind,
    InfeasibilityReport,
    OperationDiagnosis,
)
from .frozen import apply_frozen_to_timelines
from .material_ledger import MaterialAssessment, MaterialLedger
from .objective import Objective, score_assignment_change, score_schedule
from .placement_helpers import (
    adjust_duration_for_efficiency,
    first_constraint_rejection,
)
from .resource_aligner import (
    align_to_resources_backward,
    book_resources,
    build_resource_timelines,
)
from .setup_lookup import resolve_setup_minutes
from .slot_finder import SlotFinder
from .strategy import StrategyResult, register_strategy
from .timeline import ResourceTimeline


class BackwardGreedyStrategy:
    """Just-in-time backward dispatching strategy.

    Parameters
    ----------
    constraints:
        Pluggable feasibility rules (identical contract to the forward
        :class:`GreedyStrategy`).
    """

    name = "backward"

    def __init__(
        self,
        *,
        constraints: tuple[Constraint, ...] = DEFAULT_CONSTRAINTS,
    ) -> None:
        self._constraints = constraints
        self._slot_finder = SlotFinder()

    def solve(
        self,
        context: SchedulingContext,
        objective: Objective,
    ) -> StrategyResult:
        started = time.perf_counter()

        timelines: dict[str, ResourceTimeline] = {
            m.id: ResourceTimeline(machine_id=m.id) for m in context.machines
        }
        resolver = CalendarResolver(context.horizon_start, context.horizon_end)
        machine_map = context.machine_map()
        calendar_map = context.calendar_map()

        # Cumulative timelines for secondary resources — same construction
        # as the forward strategy so both paths share semantics and tests.
        resource_timelines: dict[str, CumulativeResourceTimeline] = (
            build_resource_timelines(
                context.resources, calendar_map, resolver
            )
        )
        material_ledger = MaterialLedger(
            inventory_items=context.inventory_items,
            supplies=context.supplies,
            horizon_start=context.horizon_start,
        )

        # For every operation, track the earliest start its successors have
        # been placed at. Initialized from the work order's due date so the
        # last operation naturally must finish by then.
        #
        # ``successor_limits`` stores per-op the full list of
        # ``(successor_setup_start, successor_machine_id)`` pairs so the
        # placement loop can compute a transfer-aware effective latest
        # end per candidate machine. ``latest_end_for`` is the tightest
        # raw successor start (no transfer correction) and serves solely
        # as the ordering key.
        latest_end_for: dict[str, datetime] = {}
        successor_limits: dict[str, list[_SuccessorLimit]] = {}
        wo_for: dict[str, WorkOrder] = {}
        op_for: dict[str, Operation] = {}
        all_ops: list[Operation] = []
        for wo in context.work_orders:
            for op in wo.ordered_operations():
                wo_for[op.id] = wo
                op_for[op.id] = op
                all_ops.append(op)
                latest_end_for[op.id] = wo.due_date
                successor_limits[op.id] = []

        # Build successor map: for every op, the list of ops that must start
        # AFTER it ends. This is the reverse of the dependency graph *plus*
        # the implicit "sequence + 1" linear chain inside a work order.
        successors: dict[str, set[str]] = {op.id: set() for op in all_ops}
        for wo in context.work_orders:
            for op in wo.ordered_operations():
                for dep in dependency_ids_for_operation(wo, op):
                    if dep in successors:
                        successors[dep].add(op.id)

        self._validate_dag(all_ops, successors)

        placed_setup_start: dict[str, datetime] = {}
        placed_run_start: dict[str, datetime] = {}
        placed_run_end: dict[str, datetime] = {}
        assignments: list[ScheduledOperation] = []
        decision_trace: list[dict[str, object]] = []
        # Rolling-horizon: seed frozen operations as pre-placed. Their
        # predecessors must end by ``setup_start`` (because setup is part
        # of the frozen op's machine occupancy), so propagate that bound
        # via ``latest_end_for`` just like a regular placement would.
        frozen_ids: set[str] = set()
        if context.frozen_assignments:
            apply_frozen_to_timelines(context.frozen_assignments, timelines)
            for fa in context.frozen_assignments:
                frozen_ids.add(fa.operation_id)
                placed_setup_start[fa.operation_id] = fa.setup_start
                placed_run_start[fa.operation_id] = fa.start
                placed_run_end[fa.operation_id] = fa.end
                assignments.append(fa.to_scheduled_operation())
                # Frozen ops also consume their secondary resources — same
                # rationale as the forward strategy.
                frozen_op = op_for.get(fa.operation_id)
                if frozen_op is not None:
                    book_resources(
                        window=fa.full_window,
                        operation=frozen_op,
                        timelines=resource_timelines,
                    )
                    material_ledger.reserve(
                        operation_id=fa.operation_id,
                        requirements=frozen_op.material_requirements,
                        work_order_quantity=wo_for[frozen_op.id].quantity
                        if frozen_op.id in wo_for
                        else 1,
                        required_at=fa.start,
                        reservation_origin="frozen",
                    )
                for other in all_ops:
                    if fa.operation_id in successors[other.id]:
                        latest_end_for[other.id] = min(
                            latest_end_for[other.id], fa.setup_start
                        )
                        successor_limits[other.id].extend(
                            self._build_successor_limits_for_predecessor(
                                predecessor_id=other.id,
                                successor=frozen_op,
                                successor_work_order=wo_for[fa.operation_id],
                                successor_id=fa.operation_id,
                                successor_setup_start=fa.setup_start,
                                successor_run_start=fa.start,
                                successor_end=fa.end,
                                successor_machine_id=fa.machine_id,
                            )
                        )

        pending = [op for op in all_ops if op.id not in frozen_ids]
        total_ops = len(all_ops)

        safety = len(pending) + 1
        while pending:
            safety -= 1
            if safety < 0:
                raise CircularDependencyError(
                    "Dependency cycle suspected: backward scheduler made no progress"
                )

            ready = [
                op
                for op in pending
                if all(s in placed_setup_start for s in successors[op.id])
            ]
            if not ready:
                raise CircularDependencyError(
                    "No operations are ready (backward) — dependency cycle"
                )

            # Latest-first: place the op with the tightest latest_end first,
            # which mirrors EDD in spirit and keeps the critical chain packed.
            ready.sort(key=lambda o: latest_end_for[o.id], reverse=True)
            op = ready[0]
            wo = wo_for[op.id]

            placement = self._place_operation(
                work_order=wo,
                operation=op,
                objective=objective,
                baseline_schedule=context.baseline_schedule,
                successor_limits=successor_limits[op.id],
                transfer_times=context.transfer_times,
                machine_map=machine_map,
                op_map=op_for,
                calendar_map=calendar_map,
                timelines=timelines,
                resource_timelines=resource_timelines,
                resolver=resolver,
                material_ledger=material_ledger,
                scheduled_so_far=len(assignments),
                total_operations=total_ops,
            )
            if placement.setup_start < placement.run_start:
                timelines[placement.machine.id].book(
                    TimeWindow(
                        start=placement.setup_start,
                        end=placement.run_start,
                    ),
                    operation_id=f"{op.id}#setup",
                )
            for idx, seg in enumerate(placement.segments):
                timelines[placement.machine.id].book(
                    seg,
                    operation_id=(
                        f"{op.id}#{idx}" if len(placement.segments) > 1 else op.id
                    ),
                )
            book_resources(
                window=TimeWindow(
                    start=placement.setup_start,
                    end=placement.run_end,
                ),
                operation=op,
                timelines=resource_timelines,
                requirements=placement.routing.resource_requirements,
            )
            assignments.append(
                ScheduledOperation(
                    operation_id=op.id,
                    work_order_id=wo.id,
                    machine_id=placement.machine.id,
                    setup_start=placement.setup_start,
                    start=placement.run_start,
                    end=placement.run_end,
                    segments=tuple(placement.segments)
                    if len(placement.segments) > 1
                    else (),
                )
            )
            material_ledger.reserve(
                operation_id=op.id,
                requirements=op.material_requirements,
                work_order_quantity=wo.quantity,
                required_at=placement.run_start,
            )
            decision_trace.append(
                self._decision_entry(
                    operation=op,
                    placement=placement,
                    due_date=wo.due_date,
                )
            )
            placed_setup_start[op.id] = placement.setup_start
            placed_run_start[op.id] = placement.run_start
            placed_run_end[op.id] = placement.run_end

            # Propagate latest_end to predecessors: they must end by the
            # time this op's setup starts (setup is still part of this op's
            # machine occupancy, but predecessors finish before setup).
            # We also record the successor's machine so the per-candidate
            # transfer delay can be applied when the predecessor itself is
            # placed further back in the scan.
            for other in all_ops:
                if op.id in successors[other.id]:
                    latest_end_for[other.id] = min(
                        latest_end_for[other.id], placement.setup_start
                    )
                    successor_limits[other.id].extend(
                        self._build_successor_limits_for_predecessor(
                            predecessor_id=other.id,
                            successor=op,
                            successor_work_order=wo,
                            successor_id=op.id,
                            successor_setup_start=placement.setup_start,
                            successor_run_start=placement.run_start,
                            successor_end=placement.run_end,
                            successor_machine_id=placement.machine.id,
                        )
                    )
            pending.remove(op)

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
            solver_status="feasible",
            diagnostics={
                "operations_placed": len(assignments),
                "decision_trace": decision_trace,
                "material_reservations": material_ledger.build_reservation_trace(),
            },
        )

    # ------------------------------------------------------------------ private

    @staticmethod
    def _validate_dag(
        all_ops: list[Operation], successors: dict[str, set[str]]
    ) -> None:
        known = {op.id for op in all_ops}
        for op in all_ops:
            for dep in op.dependency_ids():
                if dep not in known:
                    raise CircularDependencyError(
                        f"Operation {op.id} depends on unknown operation {dep}"
                    )
        # Cheap Kahn-style cycle check on the successor graph.
        indeg: dict[str, int] = {op.id: 0 for op in all_ops}
        for preds in successors.values():
            for s in preds:
                indeg[s] += 1
        queue = [oid for oid, d in indeg.items() if d == 0]
        visited = 0
        while queue:
            current = queue.pop()
            visited += 1
            for s in successors[current]:
                indeg[s] -= 1
                if indeg[s] == 0:
                    queue.append(s)
        if visited != len(all_ops):
            raise CircularDependencyError(
                "Dependency cycle detected in backward scheduler"
            )

    @staticmethod
    def _build_successor_limits_for_predecessor(
        *,
        predecessor_id: str,
        successor: Operation,
        successor_work_order: WorkOrder,
        successor_id: str,
        successor_setup_start: datetime,
        successor_run_start: datetime,
        successor_end: datetime,
        successor_machine_id: str | None,
    ) -> list[_SuccessorLimit]:
        links: list[_SuccessorLimit] = []
        for link in operation_dependency_links(successor_work_order, successor):
            if link.depends_on_id != predecessor_id:
                continue
            links.append(
                _SuccessorLimit(
                    depends_on_id=predecessor_id,
                    dependency_type=link.dependency_type.value,
                    lag_minutes=link.lag_minutes,
                    max_wait_minutes=link.max_wait_minutes,
                    successor_setup_start=successor_setup_start,
                    successor_run_start=successor_run_start,
                    successor_end=successor_end,
                    successor_machine_id=successor_machine_id,
                    successor_operation_id=successor_id,
                )
            )
        return links

    def _place_operation(
        self,
        *,
        work_order: WorkOrder,
        operation: Operation,
        objective: Objective,
        baseline_schedule: Schedule | None,
        successor_limits: list[_SuccessorLimit],
        transfer_times: TransferTimes,
        machine_map: dict[str, Machine],
        op_map: dict[str, Operation],
        calendar_map,
        timelines: dict[str, ResourceTimeline],
        resource_timelines: dict[str, CumulativeResourceTimeline],
        resolver: CalendarResolver,
        material_ledger: MaterialLedger,
        scheduled_so_far: int,
        total_operations: int,
    ) -> _BackwardPlacement:
        # Raw upper bound ignoring transfers — used for diagnostic
        # messages so planners see a value that matches the ordering
        # heuristic. Per-candidate-machine bounds are computed below.
        latest_end = work_order.due_date

        diag = OperationDiagnosis(
            operation_id=operation.id,
            work_order_id=work_order.id,
            earliest_possible_start=work_order.release_date,
        )

        if not operation.eligible_machine_ids:
            diag.add(
                Blocker(
                    kind=BlockerKind.NO_ELIGIBLE_MACHINE,
                    message=f"Operation {operation.id} has no eligible machines",
                )
            )
            self._raise(diag, scheduled_so_far, total_operations)

        material_assessment = material_ledger.assess(
            requirements=operation.material_requirements,
            work_order_quantity=work_order.quantity,
            not_before=work_order.release_date,
            horizon_end=resolver.horizon_end,
        )
        if material_assessment.ready_at is None:
            diag.add(
                Blocker(
                    kind=BlockerKind.MATERIAL_SHORTAGE,
                    message=(
                        f"Material {material_assessment.blocking_material_id} is not "
                        f"available in time for operation {operation.id}"
                    ),
                    material_id=material_assessment.blocking_material_id,
                )
            )
            self._raise(diag, scheduled_so_far, total_operations)

        best: _BackwardPlacement | None = None
        routings = operation.effective_routings()

        # Enumerate routing alternatives — ``effective_routings()``
        # synthesizes one entry per eligible machine for legacy ops, so
        # both flat and multi-routing operations share this code path.
        if not operation.preemptible:
            for routing in routings:
                machine = machine_map[routing.machine_id]
                # Per-candidate-machine effective latest end: every successor
                # that will run on a different machine needs the part
                # transported to it, which pulls the allowed end time
                # backward by ``transfer_times.minutes(machine_id, succ)``.
                effective_latest_end = latest_end
                latest_allowed_run_start: datetime | None = None
                earliest_allowed_run_start: datetime | None = None
                earliest_allowed_run_end: datetime | None = None
                for limit in successor_limits:
                    if limit.dependency_type == "start_to_start":
                        bound = limit.successor_run_start - timedelta(
                            minutes=limit.lag_minutes
                        )
                        if latest_allowed_run_start is None or bound < latest_allowed_run_start:
                            latest_allowed_run_start = bound
                        if limit.max_wait_minutes is not None:
                            lower = limit.successor_run_start - timedelta(
                                minutes=limit.max_wait_minutes
                            )
                            if (
                                earliest_allowed_run_start is None
                                or lower > earliest_allowed_run_start
                            ):
                                earliest_allowed_run_start = lower
                        continue

                    delta = transfer_times.minutes(
                        routing.machine_id, limit.successor_machine_id
                    )
                    bound = limit.successor_run_start - timedelta(
                        minutes=delta + limit.lag_minutes
                    )
                    if (
                        limit.successor_machine_id == routing.machine_id
                        and limit.successor_operation_id is not None
                    ):
                        successor_op = op_map[limit.successor_operation_id]
                        successor_setup = resolve_setup_minutes(
                            operation=successor_op,
                            machine=machine,
                            previous_family=operation.setup_family,
                            default_minutes=successor_op.setup_time.minutes,
                        )
                        same_machine_bound = limit.successor_run_start - timedelta(
                            minutes=successor_setup
                        )
                        if same_machine_bound < bound:
                            bound = same_machine_bound
                    if bound < effective_latest_end:
                        effective_latest_end = bound
                    if limit.max_wait_minutes is not None:
                        lower = limit.successor_run_start - timedelta(
                            minutes=limit.max_wait_minutes
                        )
                        if (
                            earliest_allowed_run_end is None
                            or lower > earliest_allowed_run_end
                        ):
                            earliest_allowed_run_end = lower
                windows = resolver.effective_windows(
                    calendar_map[machine.calendar_id],
                    maintenance=machine.maintenance_windows,
                )
                earliest_allowed_start = max(
                    work_order.release_date,
                    material_assessment.ready_at or work_order.release_date,
                )
                run_minutes = adjust_duration_for_efficiency(
                    routing.duration, machine.efficiency
                ).minutes
                # Backward scheduling doesn't know the "previous" op yet (we
                # place successors first). Use the default matrix entry as a
                # conservative upper bound.
                setup_raw = resolve_setup_minutes(
                    operation=operation,
                    machine=machine,
                    previous_family=None,
                    default_minutes=routing.setup_time.minutes,
                )
                setup_minutes = max(
                    int(round(setup_raw / machine.efficiency))
                    if machine.efficiency
                    else 0,
                    0,
                )
                needed = Duration(minutes=max(run_minutes + setup_minutes, 1))

                if not windows:
                    diag.add(
                        Blocker(
                            kind=BlockerKind.CALENDAR_TOO_TIGHT,
                            message=(
                                f"Calendar {machine.calendar_id} has no working "
                                f"window within the horizon"
                            ),
                            machine_id=machine.id,
                        )
                    )
                    continue

                # Secondary-resource loop: probe the latest machine slot, then
                # ask resources to align it backward. If resources push the
                # placement earlier, re-probe the machine with the tighter
                # ``latest_end``. Each pass strictly decreases the upper bound
                # so the loop terminates; cap at 8 for diagnostic clarity.
                current_latest_end = effective_latest_end
                slot = None
                for _ in range(8):
                    slot = self._slot_finder.find_latest_end(
                        latest_end=current_latest_end,
                        earliest_start=earliest_allowed_start,
                        required=needed,
                        working_windows=windows,
                        timeline=timelines[routing.machine_id],
                    )
                    if slot is None:
                        break
                    aligned_end = align_to_resources_backward(
                        latest_end=slot.end,
                        duration=needed,
                        operation=operation,
                        timelines=resource_timelines,
                        earliest_start=work_order.release_date,
                        requirements=routing.resource_requirements,
                    )
                    if aligned_end is None:
                        slot = None
                        diag.add(
                            Blocker(
                                kind=BlockerKind.RESOURCE_CAPACITY,
                                message=(
                                    f"No backward resource alignment for "
                                    f"{operation.id} on {machine.id} above "
                                    f"{work_order.release_date.isoformat()}"
                                ),
                                machine_id=machine.id,
                            )
                        )
                        break
                    if aligned_end == slot.end:
                        break
                    current_latest_end = aligned_end
                    slot = None  # force a re-probe with the tighter bound
                if slot is None:
                    if not diag.has(
                        BlockerKind.RESOURCE_CAPACITY, machine_id=machine.id
                    ):
                        kind = (
                            BlockerKind.HORIZON_TOO_SHORT
                            if timelines[routing.machine_id].is_empty()
                            else BlockerKind.MACHINE_OVERLOADED
                        )
                        diag.add(
                            Blocker(
                                kind=kind,
                                message=(
                                    f"No free {needed.minutes}-minute slot on "
                                    f"{machine.id} ending before "
                                    f"{effective_latest_end.isoformat()}"
                                ),
                                machine_id=machine.id,
                            )
                        )
                    continue

                setup_end = slot.start + Duration(minutes=setup_minutes).as_timedelta()
                run_window = TimeWindow(start=setup_end, end=slot.end)
                if (
                    latest_allowed_run_start is not None
                    and run_window.start > latest_allowed_run_start
                ):
                    current_latest_end = latest_allowed_run_start + timedelta(
                        minutes=run_minutes
                    )
                    slot = None
                    continue
                if (
                    earliest_allowed_run_start is not None
                    and run_window.start < earliest_allowed_run_start
                ):
                    diag.add(
                        Blocker(
                            kind=BlockerKind.DEPENDENCY_MAX_WAIT,
                            message=(
                                f"Operation {operation.id} would start at "
                                f"{run_window.start.isoformat()} on {machine.id}, earlier "
                                f"than its allowed synchronization window "
                                f"{earliest_allowed_run_start.isoformat()}."
                            ),
                            machine_id=machine.id,
                            constraint_name="start_to_start_max_wait",
                        )
                    )
                    continue
                if (
                    earliest_allowed_run_end is not None
                    and run_window.end < earliest_allowed_run_end
                ):
                    diag.add(
                        Blocker(
                            kind=BlockerKind.DEPENDENCY_MAX_WAIT,
                            message=(
                                f"Operation {operation.id} would end at "
                                f"{run_window.end.isoformat()} on {machine.id}, earlier "
                                f"than the maximum-wait bound "
                                f"{earliest_allowed_run_end.isoformat()}."
                            ),
                            machine_id=machine.id,
                            constraint_name="finish_to_start_max_wait",
                        )
                    )
                    continue
                proposal = PlacementProposal(operation, machine, run_window)
                rejection = first_constraint_rejection(self._constraints, proposal)
                if rejection is not None:
                    reason, constraint_name = rejection
                    diag.add(
                        Blocker(
                            kind=BlockerKind.CUSTOM_CONSTRAINT,
                            message=reason,
                            machine_id=machine.id,
                            constraint_name=constraint_name,
                        )
                    )
                    continue

                candidate = _BackwardPlacement(
                    machine=machine,
                    routing=routing,
                    setup_start=slot.start,
                    run_start=run_window.start,
                    run_end=run_window.end,
                    segments=[run_window],
                    baseline_latest_end=latest_end,
                    machine_latest_end=effective_latest_end,
                    material_assessment=material_assessment,
                )
                # Prefer the placement whose run_end is *latest* — that's the
                # whole point of backward scheduling. Among ties, the smaller
                # machine id wins for determinism.
                if self._is_better_candidate(
                    candidate=candidate,
                    incumbent=best,
                    operation=operation,
                    objective=objective,
                    baseline_schedule=baseline_schedule,
                ):
                    best = candidate

        if operation.preemptible:
            for routing in routings:
                machine = machine_map[routing.machine_id]
                effective_latest_end = latest_end
                latest_allowed_run_start: datetime | None = None
                earliest_allowed_run_start: datetime | None = None
                earliest_allowed_run_end: datetime | None = None
                for limit in successor_limits:
                    if limit.dependency_type == "start_to_start":
                        bound = limit.successor_run_start - timedelta(
                            minutes=limit.lag_minutes
                        )
                        if latest_allowed_run_start is None or bound < latest_allowed_run_start:
                            latest_allowed_run_start = bound
                        if limit.max_wait_minutes is not None:
                            lower = limit.successor_run_start - timedelta(
                                minutes=limit.max_wait_minutes
                            )
                            if (
                                earliest_allowed_run_start is None
                                or lower > earliest_allowed_run_start
                            ):
                                earliest_allowed_run_start = lower
                        continue

                    delta = transfer_times.minutes(
                        routing.machine_id, limit.successor_machine_id
                    )
                    bound = limit.successor_run_start - timedelta(
                        minutes=delta + limit.lag_minutes
                    )
                    if (
                        limit.successor_machine_id == routing.machine_id
                        and limit.successor_operation_id is not None
                    ):
                        successor_op = op_map[limit.successor_operation_id]
                        successor_setup = resolve_setup_minutes(
                            operation=successor_op,
                            machine=machine,
                            previous_family=operation.setup_family,
                            default_minutes=successor_op.setup_time.minutes,
                        )
                        same_machine_bound = limit.successor_run_start - timedelta(
                            minutes=successor_setup
                        )
                        if same_machine_bound < bound:
                            bound = same_machine_bound
                    if bound < effective_latest_end:
                        effective_latest_end = bound
                    if limit.max_wait_minutes is not None:
                        lower = limit.successor_run_start - timedelta(
                            minutes=limit.max_wait_minutes
                        )
                        if (
                            earliest_allowed_run_end is None
                            or lower > earliest_allowed_run_end
                        ):
                            earliest_allowed_run_end = lower

                windows = resolver.effective_windows(
                    calendar_map[machine.calendar_id],
                    maintenance=machine.maintenance_windows,
                )
                run_minutes = adjust_duration_for_efficiency(
                    routing.duration, machine.efficiency
                ).minutes
                setup_raw = resolve_setup_minutes(
                    operation=operation,
                    machine=machine,
                    previous_family=None,
                    default_minutes=routing.setup_time.minutes,
                )
                setup_minutes = max(
                    int(round(setup_raw / machine.efficiency))
                    if machine.efficiency
                    else 0,
                    0,
                )

                candidate = self._try_place_preemptive(
                    work_order=work_order,
                    operation=operation,
                    routing=routing,
                    machine=machine,
                    latest_end=effective_latest_end,
                    baseline_latest_end=latest_end,
                    setup_minutes=setup_minutes,
                    run_minutes=run_minutes,
                    windows=windows,
                    timeline=timelines[routing.machine_id],
                    resource_timelines=resource_timelines,
                    material_assessment=material_assessment,
                    diag=diag,
                    latest_allowed_run_start=latest_allowed_run_start,
                    earliest_allowed_run_start=earliest_allowed_run_start,
                    earliest_allowed_run_end=earliest_allowed_run_end,
                )
                if candidate is None:
                    continue
                if self._is_better_candidate(
                    candidate=candidate,
                    incumbent=best,
                    operation=operation,
                    objective=objective,
                    baseline_schedule=baseline_schedule,
                ):
                    best = candidate

        if best is None:
            self._raise(diag, scheduled_so_far, total_operations)
        best.latest_end_target = latest_end
        best.candidate_count = len(routings)
        best.diagnosis = diag
        return best

    @staticmethod
    def _raise(
        diag: OperationDiagnosis,
        scheduled_so_far: int,
        total_operations: int,
    ) -> None:
        report = InfeasibilityReport(
            strategy="backward",
            scheduled_so_far=scheduled_so_far,
            total_operations=total_operations,
            operations=[diag],
        )
        kinds = {b.kind for b in diag.blockers}
        if BlockerKind.HORIZON_TOO_SHORT in kinds:
            report.suggest(
                "Extend the planning horizon or pull due dates forward."
            )
        if BlockerKind.MACHINE_OVERLOADED in kinds:
            report.suggest(
                "Add capacity or try the forward greedy strategy instead."
            )
        if BlockerKind.CALENDAR_TOO_TIGHT in kinds:
            report.suggest("Widen the working calendars (shifts, overtime).")
        if BlockerKind.RESOURCE_CAPACITY in kinds:
            report.suggest(
                "Increase secondary-resource capacity or choose an alternative routing."
            )
        if BlockerKind.MATERIAL_SHORTAGE in kinds:
            report.suggest(
                "Expedite or reallocate material supply before scheduling the blocked operation."
            )
        if BlockerKind.NO_ELIGIBLE_MACHINE in kinds:
            report.suggest(
                "Add an eligible machine or routing alternative for the blocked operation."
            )
        if BlockerKind.DUE_DATE_UNREACHABLE in kinds:
            report.suggest(
                "Relax due dates, shorten setup/transfer times, or allow overtime."
            )
        if (
            BlockerKind.DEPENDENCY_WINDOW in kinds
            or BlockerKind.DEPENDENCY_MAX_WAIT in kinds
        ):
            report.suggest(
                "Relax dependency windows, overlap/max-wait rules, or release timing for the blocked operation."
            )
        if BlockerKind.CUSTOM_CONSTRAINT in kinds:
            report.suggest("Review custom constraints attached to the strategy.")
        raise InfeasibleScheduleError(
            f"Operation {diag.operation_id} could not be placed backwards",
            report=report,
        )

    def _try_place_preemptive(
        self,
        *,
        work_order: WorkOrder,
        operation: Operation,
        routing: RoutingAlternative,
        machine: Machine,
        latest_end: datetime,
        baseline_latest_end: datetime,
        setup_minutes: int,
        run_minutes: int,
        windows: list[TimeWindow],
        timeline: ResourceTimeline,
        resource_timelines: dict[str, CumulativeResourceTimeline],
        material_assessment: MaterialAssessment,
        diag: OperationDiagnosis,
        latest_allowed_run_start: datetime | None,
        earliest_allowed_run_start: datetime | None,
        earliest_allowed_run_end: datetime | None,
    ) -> _BackwardPlacement | None:
        if not windows:
            diag.add(
                Blocker(
                    kind=BlockerKind.CALENDAR_TOO_TIGHT,
                    message=(
                        f"Calendar {machine.calendar_id} has no working "
                        f"window within the horizon"
                    ),
                    machine_id=machine.id,
                )
            )
            return None

        current_latest_end = latest_end
        segments: list[TimeWindow] | None = None
        setup_start: datetime | None = None

        for _ in range(8):
            segments = self._slot_finder.find_preemptive_latest_end(
                latest_end=current_latest_end,
                earliest_start=max(
                    work_order.release_date,
                    material_assessment.ready_at or work_order.release_date,
                ),
                required=Duration(minutes=run_minutes),
                working_windows=windows,
                timeline=timeline,
                min_chunk=operation.min_chunk,
            )
            if not segments:
                break

            first_segment = segments[0]
            if setup_minutes > 0:
                setup_slot = self._slot_finder.find_latest_end(
                    latest_end=first_segment.start,
                    earliest_start=work_order.release_date,
                    required=Duration(minutes=setup_minutes),
                    working_windows=windows,
                    timeline=timeline,
                )
                if setup_slot is None:
                    segments = None
                    diag.add(
                        Blocker(
                            kind=BlockerKind.MACHINE_OVERLOADED,
                            message=(
                                f"No {setup_minutes}-minute contiguous slot for "
                                f"setup on {machine.id} before {operation.id}"
                            ),
                            machine_id=machine.id,
                        )
                    )
                    break
                setup_start = setup_slot.start
            else:
                setup_start = first_segment.start

            full_duration = int(
                (segments[-1].end - setup_start).total_seconds() // 60
            ) or 1
            aligned_end = align_to_resources_backward(
                latest_end=segments[-1].end,
                duration=Duration(minutes=full_duration),
                operation=operation,
                timelines=resource_timelines,
                earliest_start=work_order.release_date,
                requirements=routing.resource_requirements,
            )
            if aligned_end is None:
                segments = None
                diag.add(
                    Blocker(
                        kind=BlockerKind.RESOURCE_CAPACITY,
                        message=(
                            f"Preemptive op {operation.id} cannot hold its "
                            f"secondary resources on {machine.id}"
                        ),
                        machine_id=machine.id,
                    )
                )
                break
            if aligned_end == segments[-1].end:
                if (
                    latest_allowed_run_start is not None
                    and first_segment.start > latest_allowed_run_start
                ):
                    # When a start-to-start window requires the predecessor
                    # to begin earlier, do not fail immediately on the first
                    # just-in-time placement. Pull the latest-end target
                    # backward by the exact overshoot and retry so the
                    # preemptive search can land on an earlier pattern.
                    overshoot = first_segment.start - latest_allowed_run_start
                    current_latest_end = current_latest_end - overshoot
                    segments = None
                    continue
                break
            current_latest_end = aligned_end
            segments = None

        if not segments or setup_start is None:
            if not diag.has(BlockerKind.RESOURCE_CAPACITY, machine_id=machine.id):
                diag.add(
                    Blocker(
                        kind=BlockerKind.MACHINE_OVERLOADED
                        if not timeline.is_empty()
                        else BlockerKind.HORIZON_TOO_SHORT,
                        message=(
                            f"Cannot fit {run_minutes} preemptible minutes on "
                            f"{machine.id} before {latest_end.isoformat()}"
                        ),
                        machine_id=machine.id,
                    )
                )
            return None

        run_window = TimeWindow(start=segments[0].start, end=segments[-1].end)
        if latest_allowed_run_start is not None and run_window.start > latest_allowed_run_start:
            diag.add(
                Blocker(
                    kind=BlockerKind.DEPENDENCY_WINDOW,
                    message=(
                        f"Operation {operation.id} would start at "
                        f"{run_window.start.isoformat()} on {machine.id}, beyond "
                        f"its latest successor-linked start "
                        f"{latest_allowed_run_start.isoformat()}."
                    ),
                    machine_id=machine.id,
                    constraint_name="start_to_start_sync",
                )
            )
            return None
        if (
            earliest_allowed_run_start is not None
            and run_window.start < earliest_allowed_run_start
        ):
            diag.add(
                Blocker(
                    kind=BlockerKind.DEPENDENCY_MAX_WAIT,
                    message=(
                        f"Operation {operation.id} would start at "
                        f"{run_window.start.isoformat()} on {machine.id}, earlier "
                        f"than its allowed synchronization window "
                        f"{earliest_allowed_run_start.isoformat()}."
                    ),
                    machine_id=machine.id,
                    constraint_name="start_to_start_max_wait",
                )
            )
            return None
        if earliest_allowed_run_end is not None and run_window.end < earliest_allowed_run_end:
            diag.add(
                Blocker(
                    kind=BlockerKind.DEPENDENCY_MAX_WAIT,
                    message=(
                        f"Operation {operation.id} would end at "
                        f"{run_window.end.isoformat()} on {machine.id}, earlier "
                        f"than the maximum-wait bound "
                        f"{earliest_allowed_run_end.isoformat()}."
                    ),
                    machine_id=machine.id,
                    constraint_name="finish_to_start_max_wait",
                )
            )
            return None
        proposal = PlacementProposal(operation, machine, run_window)
        rejection = first_constraint_rejection(self._constraints, proposal)
        if rejection is not None:
            reason, constraint_name = rejection
            diag.add(
                Blocker(
                    kind=BlockerKind.CUSTOM_CONSTRAINT,
                    message=reason,
                    machine_id=machine.id,
                    constraint_name=constraint_name,
                )
            )
            return None

        return _BackwardPlacement(
            machine=machine,
            routing=routing,
            setup_start=setup_start,
            run_start=segments[0].start,
            run_end=segments[-1].end,
            segments=segments,
            baseline_latest_end=baseline_latest_end,
            machine_latest_end=current_latest_end,
            material_assessment=material_assessment,
        )

    @staticmethod
    def _decision_entry(
        *,
        operation: Operation,
        placement: _BackwardPlacement,
        due_date: datetime,
    ) -> dict[str, object]:
        rejected_by_machine: dict[str, dict[str, str | None]] = {}
        if placement.diagnosis is not None:
            for blocker in placement.diagnosis.blockers:
                if blocker.machine_id is None or blocker.machine_id == placement.machine.id:
                    continue
                rejected_by_machine.setdefault(
                    blocker.machine_id,
                    {
                        "machine_id": blocker.machine_id,
                        "kind": blocker.kind.value,
                        "message": blocker.message,
                        "constraint_name": blocker.constraint_name,
                    },
                )

        return {
            "operation_id": operation.id,
            "work_order_id": operation.work_order_id,
            "machine_id": placement.machine.id,
            "candidate_count": placement.candidate_count,
            "baseline_latest_end": (
                placement.baseline_latest_end.isoformat()
                if placement.baseline_latest_end is not None
                else None
            ),
            "machine_latest_end": (
                placement.machine_latest_end.isoformat()
                if placement.machine_latest_end is not None
                else None
            ),
            "latest_end_target": (
                placement.latest_end_target.isoformat()
                if placement.latest_end_target is not None
                else None
            ),
            "actual_start": placement.run_start.isoformat(),
            "actual_end": placement.run_end.isoformat(),
            "setup_minutes": int(
                (placement.run_start - placement.setup_start).total_seconds() // 60
            ),
            "run_minutes": int(
                (placement.run_end - placement.run_start).total_seconds() // 60
            ),
            "transfer_delay_minutes": max(
                int(
                    (
                        placement.baseline_latest_end
                        - placement.machine_latest_end
                    ).total_seconds()
                    // 60
                ),
                0,
            )
            if (
                placement.baseline_latest_end is not None
                and placement.machine_latest_end is not None
            )
            else 0,
            "preempted": len(placement.segments) > 1,
            "selected_routing": {
                "machine_id": placement.routing.machine_id,
                "duration_minutes": placement.routing.duration.minutes,
                "setup_minutes": placement.routing.setup_time.minutes,
                "resource_requirements": [
                    {
                        "resource_id": req.resource_id,
                        "units": req.units,
                    }
                    for req in placement.routing.resource_requirements
                ],
            },
            "material_ready_at": (
                placement.material_assessment.ready_at.isoformat()
                if placement.material_assessment is not None
                and placement.material_assessment.ready_at is not None
                else None
            ),
            "material_requirements": [
                {
                    "material_id": req.material_id,
                    "quantity_per_unit": req.quantity_per_unit,
                    "fixed_quantity": req.fixed_quantity,
                }
                for req in operation.material_requirements
            ],
            "dependency_links": [
                {
                    "depends_on_id": link.depends_on_id,
                    "dependency_type": link.dependency_type.value,
                    "lag_minutes": link.lag_minutes,
                    "max_wait_minutes": link.max_wait_minutes,
                }
                for link in operation.effective_dependency_links()
            ],
            "rejected_candidates": list(rejected_by_machine.values()),
            "late_against_due_date": placement.run_end > due_date,
        }

    @staticmethod
    def _is_better_candidate(
        *,
        candidate: _BackwardPlacement,
        incumbent: _BackwardPlacement | None,
        operation: Operation,
        objective: Objective,
        baseline_schedule: Schedule | None,
    ) -> bool:
        if incumbent is None:
            return True
        if candidate.run_end != incumbent.run_end:
            return candidate.run_end > incumbent.run_end
        candidate_penalty = BackwardGreedyStrategy._baseline_penalty(
            operation=operation,
            placement=candidate,
            objective=objective,
            baseline_schedule=baseline_schedule,
        )
        incumbent_penalty = BackwardGreedyStrategy._baseline_penalty(
            operation=operation,
            placement=incumbent,
            objective=objective,
            baseline_schedule=baseline_schedule,
        )
        if candidate_penalty != incumbent_penalty:
            return candidate_penalty < incumbent_penalty
        return candidate.machine.id < incumbent.machine.id

    @staticmethod
    def _baseline_penalty(
        *,
        operation: Operation,
        placement: _BackwardPlacement,
        objective: Objective,
        baseline_schedule: Schedule | None,
    ) -> int:
        if baseline_schedule is None:
            return 0
        baseline_assignment = next(
            (
                assignment
                for assignment in baseline_schedule.assignments
                if assignment.operation_id == operation.id
            ),
            None,
        )
        return score_assignment_change(
            baseline_assignment=baseline_assignment,
            candidate_machine_id=placement.machine.id,
            candidate_start=placement.run_start,
            objective=objective,
        )


class _BackwardPlacement:
    __slots__ = (
        "machine",
        "routing",
        "setup_start",
        "run_start",
        "run_end",
        "segments",
        "latest_end_target",
        "baseline_latest_end",
        "machine_latest_end",
        "candidate_count",
        "diagnosis",
        "material_assessment",
    )

    def __init__(
        self,
        *,
        machine: Machine,
        routing: RoutingAlternative,
        setup_start: datetime,
        run_start: datetime,
        run_end: datetime,
        segments: list[TimeWindow],
        latest_end_target: datetime | None = None,
        baseline_latest_end: datetime | None = None,
        machine_latest_end: datetime | None = None,
        candidate_count: int = 0,
        diagnosis: OperationDiagnosis | None = None,
        material_assessment: MaterialAssessment | None = None,
    ) -> None:
        self.machine = machine
        self.routing = routing
        self.setup_start = setup_start
        self.run_start = run_start
        self.run_end = run_end
        self.segments = segments
        self.latest_end_target = latest_end_target
        self.baseline_latest_end = baseline_latest_end
        self.machine_latest_end = machine_latest_end
        self.candidate_count = candidate_count
        self.diagnosis = diagnosis
        self.material_assessment = material_assessment


class _SuccessorLimit:
    __slots__ = (
        "depends_on_id",
        "dependency_type",
        "lag_minutes",
        "max_wait_minutes",
        "successor_setup_start",
        "successor_run_start",
        "successor_end",
        "successor_machine_id",
        "successor_operation_id",
    )

    def __init__(
        self,
        *,
        depends_on_id: str,
        dependency_type: str,
        lag_minutes: int,
        max_wait_minutes: int | None,
        successor_setup_start: datetime,
        successor_run_start: datetime,
        successor_end: datetime,
        successor_machine_id: str | None,
        successor_operation_id: str | None,
    ) -> None:
        self.depends_on_id = depends_on_id
        self.dependency_type = dependency_type
        self.lag_minutes = lag_minutes
        self.max_wait_minutes = max_wait_minutes
        self.successor_setup_start = successor_setup_start
        self.successor_run_start = successor_run_start
        self.successor_end = successor_end
        self.successor_machine_id = successor_machine_id
        self.successor_operation_id = successor_operation_id


register_strategy("backward", BackwardGreedyStrategy)
