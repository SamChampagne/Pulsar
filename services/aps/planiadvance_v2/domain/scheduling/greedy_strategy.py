"""Greedy forward-dispatching scheduling strategy.

This strategy wraps the legacy :class:`Scheduler` behind the
:class:`SchedulerStrategy` contract and layers two industrial-grade
improvements on top:

- **Sequence-dependent setup times** via :class:`SetupMatrix`. When the
  candidate machine has a matrix and the operation declares a
  ``setup_family``, the matrix entry replaces the flat
  ``operation.setup_time`` for that placement. Other strategies (CP-SAT)
  use the same helper so behaviour stays consistent across backends.
- **Structured infeasibility diagnosis**. Instead of a flat
  "no free slot found" string, the strategy builds an
  :class:`InfeasibilityReport` listing, for every candidate machine, the
  specific blocker kind (calendar too tight, machine overloaded, custom
  constraint ...). The report is attached to the raised
  :class:`InfeasibleScheduleError`.

The heuristic used for ordering (EDD, SPT, priority EDD, critical ratio)
remains pluggable via the existing :mod:`heuristics` module — the strategy
simply translates the requested :class:`Objective` into a sensible default
heuristic when the caller does not provide one.
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
from ..value_objects import Duration, TimeWindow, TransferTimes
from .calendar_resolver import CalendarResolver
from .constraints import DEFAULT_CONSTRAINTS, Constraint, PlacementProposal
from .context import SchedulingContext
from .cumulative_timeline import CumulativeResourceTimeline
from .dependency_links import dependency_ids_for_operation, operation_dependency_links
from .dependency_timing import dependency_max_start, dependency_min_start
from .diagnosis import (
    Blocker,
    BlockerKind,
    InfeasibilityReport,
    OperationDiagnosis,
)
from .frozen import apply_frozen_to_timelines
from .heuristics import (
    ApparentTardinessCost,
    EarliestDueDateFirst,
    Heuristic,
    PriorityWeightedEDD,
)
from .material_ledger import MaterialAssessment, MaterialLedger
from .objective import Objective, score_assignment_change, score_schedule
from .placement_helpers import (
    adjust_duration_for_efficiency,
    first_constraint_rejection,
)
from .resource_aligner import (
    align_to_resources,
    book_resources,
    build_resource_timelines,
)
from .setup_lookup import resolve_setup_minutes
from .slot_finder import SlotFinder
from .strategy import StrategyResult, register_strategy
from .timeline import ResourceTimeline


class GreedyStrategy:
    """Fast forward-dispatching strategy.

    Parameters
    ----------
    heuristic:
        Optional heuristic override. When omitted the strategy picks one
        from the supplied :class:`Objective`: priority-weighted EDD when
        ``weighted_tardiness > 0``, plain EDD otherwise.
    constraints:
        Pluggable feasibility rules. Defaults to
        :data:`constraints.DEFAULT_CONSTRAINTS` (eligibility only).
    """

    name = "greedy"

    def __init__(
        self,
        *,
        heuristic: Heuristic | None = None,
        constraints: tuple[Constraint, ...] = DEFAULT_CONSTRAINTS,
    ) -> None:
        self._heuristic_override = heuristic
        self._constraints = constraints
        self._slot_finder = SlotFinder()

    def solve(
        self,
        context: SchedulingContext,
        objective: Objective,
    ) -> StrategyResult:
        heuristic = self._pick_heuristic(objective)
        started = time.perf_counter()

        timelines: dict[str, ResourceTimeline] = {
            m.id: ResourceTimeline(machine_id=m.id) for m in context.machines
        }
        last_family: dict[str, str | None] = {m.id: None for m in context.machines}
        resolver = CalendarResolver(context.horizon_start, context.horizon_end)
        machine_map = context.machine_map()
        calendar_map = context.calendar_map()

        # Cumulative timelines for secondary resources. Off-shift windows
        # are pre-booked at full capacity so calendar enforcement falls
        # through to the same cumulative check as vanilla capacity —
        # one mechanism, no special cases.
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
        # Build a per-operation map once so frozen pre-booking and the
        # placement loop both find the operation's requirements without
        # re-walking every work order.
        op_by_id: dict[str, Operation] = {}
        for wo in context.work_orders:
            for op in wo.ordered_operations():
                op_by_id[op.id] = op

        completed_starts: dict[str, datetime] = {}
        completed_ends: dict[str, datetime] = {}
        # Machine each completed op was placed on — needed to apply the
        # transfer-time delay when a downstream op targets a different
        # machine. Populated for frozen ops too.
        completed_machine: dict[str, str] = {}
        assignments: list[ScheduledOperation] = []
        decision_trace: list[dict[str, object]] = []
        # Rolling-horizon: pin frozen operations on the timelines so the
        # slot finder treats them as immovable, and seed completed_ends
        # so dependent operations downstream wait for their real end.
        frozen_ids: set[str] = set()
        if context.frozen_assignments:
            apply_frozen_to_timelines(context.frozen_assignments, timelines)
            for fa in context.frozen_assignments:
                completed_ends[fa.operation_id] = fa.end
                completed_starts[fa.operation_id] = fa.start
                completed_machine[fa.operation_id] = fa.machine_id
                frozen_ids.add(fa.operation_id)
                assignments.append(fa.to_scheduled_operation())
                # Frozen ops also consume their secondary resources for
                # the full (setup + run) window — otherwise two pinned
                # ops on different machines could silently share an
                # operator that cannot physically be in two places.
                frozen_op = op_by_id.get(fa.operation_id)
                if frozen_op is not None:
                    book_resources(
                        window=fa.full_window,
                        operation=frozen_op,
                        timelines=resource_timelines,
                    )
                    material_ledger.reserve(
                        operation_id=fa.operation_id,
                        requirements=frozen_op.material_requirements,
                        work_order_quantity=next(
                            (
                                wo.quantity
                                for wo in context.work_orders
                                if wo.id == frozen_op.work_order_id
                            ),
                            1,
                        ),
                        required_at=fa.start,
                        reservation_origin="frozen",
                    )

        pending: list[tuple[WorkOrder, Operation]] = [
            (wo, op)
            for wo in context.work_orders
            for op in wo.ordered_operations()
            if op.id not in frozen_ids
        ]
        total_ops = len(pending) + len(frozen_ids)
        self._validate_dag(pending, extra_known=frozen_ids)

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
                if all(
                    dep in completed_ends
                    for dep in dependency_ids_for_operation(wo, op)
                )
            ]
            if not ready:
                raise CircularDependencyError(
                    "No operations are ready to schedule — dependency cycle"
                )

            ready = heuristic.order(ready, context.horizon_start)

            wo, op = ready[0]
            placement = self._place_operation(
                work_order=wo,
                operation=op,
                objective=objective,
                baseline_schedule=context.baseline_schedule,
                machine_map=machine_map,
                calendar_map=calendar_map,
                timelines=timelines,
                resource_timelines=resource_timelines,
                resolver=resolver,
                material_ledger=material_ledger,
                completed_starts=completed_starts,
                completed_ends=completed_ends,
                completed_machine=completed_machine,
                transfer_times=context.transfer_times,
                last_family=last_family,
                scheduled_so_far=len(assignments),
                total_operations=total_ops,
            )
            # Book the setup interval (if any), then each productive segment
            # individually, so the timeline correctly models the idle gaps
            # that a preemptive operation leaves behind.
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
            # Book secondary resources across the full (setup + run)
            # window: operators and tooling are consumed for the entire
            # machine occupancy, not just the productive portion. We pass
            # the chosen routing's requirements explicitly so two
            # alternatives on the same machine with different operator
            # counts are accounted for correctly.
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
            completed_ends[op.id] = placement.run_end
            completed_starts[op.id] = placement.run_start
            completed_machine[op.id] = placement.machine.id
            last_family[placement.machine.id] = op.setup_family
            pending.remove((wo, op))

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
                "heuristic": heuristic.name,
                "operations_placed": len(assignments),
                "decision_trace": decision_trace,
                "material_reservations": material_ledger.build_reservation_trace(),
            },
        )

    # ------------------------------------------------------------------ private

    def _pick_heuristic(self, objective: Objective) -> Heuristic:
        """Auto-select the ordering rule that fits the objective weights.

        Heuristic ladder (strongest match first):

        * ``weighted_tardiness`` + ``total_tardiness`` both active — ATC
          dominates: it blends weighted SPT with due-date pressure and
          beats PriorityWeightedEDD on nearly every realistic instance.
        * ``weighted_tardiness`` only — PriorityWeightedEDD, since ATC's
          tardiness pressure term degenerates without a due-date weight.
        * Otherwise — classical EDD.
        """
        if self._heuristic_override is not None:
            return self._heuristic_override
        if objective.weighted_tardiness > 0 and objective.total_tardiness > 0:
            return ApparentTardinessCost()
        if objective.weighted_tardiness > 0:
            return PriorityWeightedEDD()
        return EarliestDueDateFirst()

    @staticmethod
    def _validate_dag(
        pending: list[tuple[WorkOrder, Operation]],
        extra_known: set[str] | None = None,
    ) -> None:
        """Cheap sanity check that every dependency is a reachable op id.

        ``extra_known`` lets the caller whitelist frozen operation ids
        that are not in ``pending`` because they are already completed;
        without this the rolling-horizon path would wrongly reject a
        run where a pending op still references its finished predecessor.
        """
        known = {op.id for _, op in pending}
        if extra_known:
            known |= extra_known
        for wo, op in pending:
            for dep in dependency_ids_for_operation(wo, op):
                if dep not in known:
                    raise CircularDependencyError(
                        f"Operation {op.id} depends on unknown operation {dep}"
                    )

    def _place_operation(
        self,
        *,
        work_order: WorkOrder,
        operation: Operation,
        objective: Objective,
        baseline_schedule: Schedule | None,
        machine_map: dict[str, Machine],
        calendar_map,
        timelines: dict[str, ResourceTimeline],
        resource_timelines: dict[str, CumulativeResourceTimeline],
        resolver: CalendarResolver,
        material_ledger: MaterialLedger,
        completed_starts: dict[str, datetime],
        completed_ends: dict[str, datetime],
        completed_machine: dict[str, str],
        transfer_times: TransferTimes,
        last_family: dict[str, str | None],
        scheduled_so_far: int,
        total_operations: int,
    ) -> _GreedyPlacement:
        # Baseline earliest start ignoring transfers — used purely for
        # the diagnostic payload. The actual placement loop recomputes a
        # per-candidate-machine earliest start that factors in the
        # predecessor-machine → candidate-machine transfer delay.
        earliest_start, latest_start = self._compute_start_window(
            work_order,
            operation,
            completed_starts,
            completed_ends,
            completed_machine,
            transfer_times,
            candidate_machine_id=None,
        )

        diag = OperationDiagnosis(
            operation_id=operation.id,
            work_order_id=work_order.id,
            earliest_possible_start=earliest_start,
        )

        if not operation.eligible_machine_ids:
            diag.add(
                Blocker(
                    kind=BlockerKind.NO_ELIGIBLE_MACHINE,
                    message=(
                        f"Operation {operation.id} has no eligible machines"
                    ),
                )
            )
            self._raise(diag, scheduled_so_far, total_operations)

        material_assessment = material_ledger.assess(
            requirements=operation.material_requirements,
            work_order_quantity=work_order.quantity,
            not_before=earliest_start,
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
        if (
            latest_start is not None
            and material_assessment.ready_at is not None
            and material_assessment.ready_at > latest_start
        ):
            diag.add(
                Blocker(
                    kind=BlockerKind.DEPENDENCY_MAX_WAIT,
                    message=(
                        f"Operation {operation.id} cannot respect dependency max-wait "
                        f"constraints once material is available."
                    ),
                    constraint_name=self._dependency_max_wait_constraint_name(
                        work_order, operation
                    ),
                )
            )
            self._raise(diag, scheduled_so_far, total_operations)

        best: _GreedyPlacement | None = None
        routings = operation.effective_routings()

        # Enumerate routing alternatives instead of raw eligible machines:
        # ``effective_routings()`` synthesizes one alternative per eligible
        # machine for legacy operations, so the loop body is identical for
        # both flat and multi-routing operations. The chosen routing is
        # carried on the placement so the booking phase consumes *its*
        # secondary resources rather than the operation's flat list.
        for routing in routings:
            machine = machine_map[routing.machine_id]
            # Per-candidate-machine earliest start: a predecessor on a
            # different machine must first be transported to this machine,
            # which pushes the op's earliest start forward by the transfer
            # delay recorded in ``context.transfer_times``.
            machine_earliest_start, machine_latest_start = self._compute_start_window(
                work_order,
                operation,
                completed_starts,
                completed_ends,
                completed_machine,
                transfer_times,
                candidate_machine_id=routing.machine_id,
            )
            if material_assessment.ready_at is not None:
                machine_earliest_start = max(
                    machine_earliest_start,
                    material_assessment.ready_at,
                )
            windows = resolver.effective_windows(
                calendar_map[machine.calendar_id],
                maintenance=machine.maintenance_windows,
            )
            run_minutes = adjust_duration_for_efficiency(
                routing.duration, machine.efficiency
            ).minutes
            setup_minutes_raw = resolve_setup_minutes(
                operation=operation,
                machine=machine,
                previous_family=last_family.get(machine.id),
                default_minutes=routing.setup_time.minutes,
            )
            setup_minutes = max(
                int(round(setup_minutes_raw / machine.efficiency))
                if machine.efficiency
                else 0,
                0,
            )

            if run_minutes == 0:
                diag.add(
                    Blocker(
                        kind=BlockerKind.CUSTOM_CONSTRAINT,
                        message=(
                            f"Operation {operation.id} has zero processing time"
                        ),
                        machine_id=machine.id,
                    )
                )
                continue

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

            candidate = self._try_place_on_machine(
                operation=operation,
                routing=routing,
                machine=machine,
                earliest_start=machine_earliest_start,
                setup_minutes=setup_minutes,
                run_minutes=run_minutes,
                windows=windows,
                timeline=timelines[routing.machine_id],
                resource_timelines=resource_timelines,
                horizon_end=resolver.horizon_end,
                material_assessment=material_assessment,
                diag=diag,
                latest_allowed_start=machine_latest_start,
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

        # Check due-date reachability as a soft warning in diagnostics.
        if best.run_end > work_order.due_date:
            diag.add(
                Blocker(
                    kind=BlockerKind.DUE_DATE_UNREACHABLE,
                    message=(
                        f"Earliest feasible end {best.run_end.isoformat()} "
                        f"exceeds due date {work_order.due_date.isoformat()}"
                    ),
                    machine_id=best.machine.id,
                )
            )
        best.baseline_earliest_start = earliest_start
        best.machine_earliest_start = self._compute_start_window(
            work_order,
            operation,
            completed_starts,
            completed_ends,
            completed_machine,
            transfer_times,
            candidate_machine_id=best.machine.id,
        )[0]
        best.candidate_count = len(routings)
        best.diagnosis = diag
        return best

    def _try_place_on_machine(
        self,
        *,
        operation: Operation,
        routing: RoutingAlternative,
        machine: Machine,
        earliest_start: datetime,
        setup_minutes: int,
        run_minutes: int,
        windows: list[TimeWindow],
        timeline: ResourceTimeline,
        resource_timelines: dict[str, CumulativeResourceTimeline],
        horizon_end: datetime,
        material_assessment: MaterialAssessment,
        diag: OperationDiagnosis,
        latest_allowed_start: datetime | None,
    ) -> _GreedyPlacement | None:
        """Try to place ``operation`` on ``machine``.

        Produces a :class:`_GreedyPlacement` on success. On failure, records
        a structured :class:`Blocker` on ``diag`` and returns ``None`` so the
        caller can try the next eligible machine.

        Preemptive path:
            Setup is always booked in a single contiguous chunk — splitting
            setup adds no value and complicates tooling/operator handover.
            The productive run time is then covered across one or more free
            segments using :meth:`SlotFinder.find_preemptive`, with
            ``operation.min_chunk`` enforcing a minimum slice size.

        Secondary-resource loop:
            After the machine slot finder returns a tentative window, we
            ask :func:`align_to_resources` whether every required resource
            (operators, tooling ...) admits it. If not, we bump
            ``earliest_start`` to the first instant where resources are
            available and re-run the machine search. Because each pass
            strictly advances ``earliest_start``, the retry count is
            bounded — we cap it defensively at 8 to keep diagnostics
            comprehensible when an instance is simply infeasible.
        """
        # ------- Non-preemptive: the classical single-slot path ------------
        if not operation.preemptible:
            needed = Duration(minutes=max(run_minutes + setup_minutes, 1))
            current_start = earliest_start
            slot = None
            for _ in range(8):
                slot = self._slot_finder.find(
                    earliest_start=current_start,
                    required=needed,
                    working_windows=windows,
                    timeline=timeline,
                )
                if slot is None:
                    break
                aligned = align_to_resources(
                    earliest_start=slot.start,
                    duration=needed,
                    operation=operation,
                    timelines=resource_timelines,
                    horizon_end=horizon_end,
                    requirements=routing.resource_requirements,
                )
                if aligned is None:
                    slot = None
                    diag.add(
                        Blocker(
                            kind=BlockerKind.RESOURCE_CAPACITY,
                            message=(
                                f"No resource alignment for {operation.id} "
                                f"on {machine.id} within the horizon"
                            ),
                            machine_id=machine.id,
                        )
                    )
                    break
                if aligned == slot.start:
                    break
                current_start = aligned
                slot = None  # force a re-probe of the machine timeline
            if slot is None:
                if not diag.has(BlockerKind.RESOURCE_CAPACITY, machine_id=machine.id):
                    kind = (
                        BlockerKind.HORIZON_TOO_SHORT
                        if timeline.is_empty()
                        else BlockerKind.MACHINE_OVERLOADED
                    )
                    diag.add(
                        Blocker(
                            kind=kind,
                            message=(
                                f"No free {needed.minutes}-minute slot on "
                                f"{machine.id} from {earliest_start.isoformat()}"
                            ),
                            machine_id=machine.id,
                        )
                    )
                return None

            setup_end = slot.start + Duration(minutes=setup_minutes).as_timedelta()
            run_window = TimeWindow(start=setup_end, end=slot.end)
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
            if latest_allowed_start is not None and run_window.start > latest_allowed_start:
                diag.add(
                    Blocker(
                        kind=BlockerKind.DEPENDENCY_MAX_WAIT,
                        message=(
                            f"Operation {operation.id} would start at "
                            f"{run_window.start.isoformat()} on {machine.id}, beyond "
                            f"its dependency max-wait bound {latest_allowed_start.isoformat()}."
                        ),
                        machine_id=machine.id,
                        constraint_name=self._dependency_max_wait_constraint_name(
                            None,
                            operation,
                        ),
                    )
                )
                return None

            return _GreedyPlacement(
                machine=machine,
                routing=routing,
                setup_start=slot.start,
                run_start=run_window.start,
                run_end=run_window.end,
                segments=[run_window],
                material_assessment=material_assessment,
            )

        # ---------------- Preemptive: multi-chunk placement ----------------
        # Step 1: reserve setup as a single contiguous chunk.
        setup_needed = Duration(minutes=max(setup_minutes, 0))
        if setup_minutes > 0:
            setup_slot = self._slot_finder.find(
                earliest_start=earliest_start,
                required=setup_needed,
                working_windows=windows,
                timeline=timeline,
            )
            if setup_slot is None:
                diag.add(
                    Blocker(
                        kind=BlockerKind.MACHINE_OVERLOADED
                        if not timeline.is_empty()
                        else BlockerKind.HORIZON_TOO_SHORT,
                        message=(
                            f"No {setup_minutes}-minute contiguous slot for "
                            f"setup on {machine.id}"
                        ),
                        machine_id=machine.id,
                    )
                )
                return None
            setup_start = setup_slot.start
            run_search_start = setup_slot.end
        else:
            setup_start = earliest_start
            run_search_start = earliest_start

        # Step 2: cover the productive run time across one or more segments.
        segments = self._slot_finder.find_preemptive(
            earliest_start=run_search_start,
            required=Duration(minutes=run_minutes),
            working_windows=windows,
            timeline=timeline,
            min_chunk=operation.min_chunk,
        )
        if segments is None or not segments:
            diag.add(
                Blocker(
                    kind=BlockerKind.MACHINE_OVERLOADED
                    if not timeline.is_empty()
                    else BlockerKind.HORIZON_TOO_SHORT,
                    message=(
                        f"Cannot fit {run_minutes} preemptible minutes on "
                        f"{machine.id} from {run_search_start.isoformat()}"
                    ),
                    machine_id=machine.id,
                )
            )
            return None

        # Step 3: validate custom constraints against the overall run window.
        run_window = TimeWindow(start=segments[0].start, end=segments[-1].end)
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
        if latest_allowed_start is not None and segments[0].start > latest_allowed_start:
            diag.add(
                Blocker(
                    kind=BlockerKind.DEPENDENCY_MAX_WAIT,
                    message=(
                        f"Preemptive op {operation.id} would start at "
                        f"{segments[0].start.isoformat()} on {machine.id}, beyond "
                        f"its dependency max-wait bound {latest_allowed_start.isoformat()}."
                    ),
                    machine_id=machine.id,
                    constraint_name=self._dependency_max_wait_constraint_name(
                        None,
                        operation,
                    ),
                )
            )
            return None

        # Step 4: verify secondary resources over the overall span. For
        # preemptible ops we treat the resource as held across idle
        # gaps — operators and tooling don't "shift" to another job for
        # a 10-minute window. A more granular per-segment model is
        # possible but rarely desired on shop floors.
        if routing.resource_requirements:
            full_window = TimeWindow(start=setup_start, end=segments[-1].end)
            aligned = align_to_resources(
                earliest_start=setup_start,
                duration=Duration(
                    minutes=int(
                        (full_window.end - full_window.start).total_seconds() // 60
                    )
                    or 1
                ),
                operation=operation,
                timelines=resource_timelines,
                horizon_end=horizon_end,
                requirements=routing.resource_requirements,
            )
            if aligned is None or aligned > setup_start:
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
                return None

        # If the first segment starts later than expected (because the
        # operation's preemptible minimum chunk forced us to skip a tiny
        # leftover), shift setup_start forward so setup immediately precedes
        # the first productive slice.
        if setup_minutes > 0 and segments[0].start > run_search_start:
            setup_start = segments[0].start - Duration(
                minutes=setup_minutes
            ).as_timedelta()

        return _GreedyPlacement(
            machine=machine,
            routing=routing,
            setup_start=setup_start,
            run_start=segments[0].start,
            run_end=segments[-1].end,
            segments=list(segments),
            material_assessment=material_assessment,
        )

    @staticmethod
    def _compute_start_window(
        work_order: WorkOrder,
        operation: Operation,
        completed_starts: dict[str, datetime],
        completed_ends: dict[str, datetime],
        completed_machine: dict[str, str],
        transfer_times: TransferTimes,
        *,
        candidate_machine_id: str | None,
    ) -> tuple[datetime, datetime | None]:
        """Compute the earliest and latest allowed productive start.

        ``candidate_machine_id`` selects the machine the caller is about
        to probe: when a predecessor sits on a *different* machine the
        hand-off cost — ``transfer_times.minutes(src, dst)`` — is added
        to the predecessor's end time. Passing ``None`` disables the
        transfer correction and returns the baseline used for
        diagnostics and heuristic ordering.
        """

        earliest_candidates: list[datetime] = [work_order.release_date]
        latest_candidates: list[datetime] = []

        for link in operation_dependency_links(work_order, operation):
            dep_id = link.depends_on_id
            if dep_id not in completed_starts or dep_id not in completed_ends:
                continue
            transfer = 0
            if candidate_machine_id is not None:
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
            latest_allowed = dependency_max_start(
                link,
                predecessor_start=completed_starts[dep_id],
                predecessor_end=completed_ends[dep_id],
            )
            if latest_allowed is not None:
                latest_candidates.append(latest_allowed)

        return max(earliest_candidates), (
            min(latest_candidates) if latest_candidates else None
        )

    @staticmethod
    def _dependency_max_wait_constraint_name(
        work_order: WorkOrder | None,
        operation: Operation,
    ) -> str:
        links = (
            operation_dependency_links(work_order, operation)
            if work_order is not None
            else operation.effective_dependency_links()
        )
        has_start_to_start = any(
            link.max_wait_minutes is not None
            and link.dependency_type.value == "start_to_start"
            for link in links
        )
        if has_start_to_start:
            return "start_to_start_max_wait"
        has_finish_to_start = any(link.max_wait_minutes is not None for link in links)
        if has_finish_to_start:
            return "finish_to_start_max_wait"
        return "dependency_max_wait"

    @staticmethod
    def _raise(
        diag: OperationDiagnosis,
        scheduled_so_far: int,
        total_operations: int,
    ) -> None:
        report = InfeasibilityReport(
            strategy="greedy",
            scheduled_so_far=scheduled_so_far,
            total_operations=total_operations,
            operations=[diag],
        )
        # Cheap pattern-match over blocker kinds to give the planner an
        # actionable hint without reading source code.
        kinds = {b.kind for b in diag.blockers}
        if BlockerKind.HORIZON_TOO_SHORT in kinds:
            report.suggest("Extend the planning horizon.")
        if BlockerKind.MACHINE_OVERLOADED in kinds:
            report.suggest(
                "Add capacity on overloaded machines or relax due dates."
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
            f"Operation {diag.operation_id} could not be placed",
            report=report,
        )

    @staticmethod
    def _decision_entry(
        *,
        operation: Operation,
        placement: _GreedyPlacement,
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
            "baseline_earliest_start": (
                placement.baseline_earliest_start.isoformat()
                if placement.baseline_earliest_start is not None
                else None
            ),
            "machine_earliest_start": (
                placement.machine_earliest_start.isoformat()
                if placement.machine_earliest_start is not None
                else None
            ),
            "actual_start": placement.run_start.isoformat(),
            "actual_end": placement.run_end.isoformat(),
            "transfer_delay_minutes": max(
                int(
                    (
                        placement.machine_earliest_start
                        - placement.baseline_earliest_start
                    ).total_seconds()
                    // 60
                ),
                0,
            )
            if (
                placement.machine_earliest_start is not None
                and placement.baseline_earliest_start is not None
            )
            else 0,
            "setup_minutes": int(
                (placement.run_start - placement.setup_start).total_seconds() // 60
            ),
            "run_minutes": int(
                (placement.run_end - placement.run_start).total_seconds() // 60
            ),
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
        candidate: _GreedyPlacement,
        incumbent: _GreedyPlacement | None,
        operation: Operation,
        objective: Objective,
        baseline_schedule: Schedule | None,
    ) -> bool:
        if incumbent is None:
            return True
        if candidate.run_end != incumbent.run_end:
            return candidate.run_end < incumbent.run_end
        candidate_penalty = GreedyStrategy._baseline_penalty(
            operation=operation,
            placement=candidate,
            objective=objective,
            baseline_schedule=baseline_schedule,
        )
        incumbent_penalty = GreedyStrategy._baseline_penalty(
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
        placement: _GreedyPlacement,
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


class _GreedyPlacement:
    __slots__ = (
        "machine",
        "routing",
        "setup_start",
        "run_start",
        "run_end",
        "segments",
        "baseline_earliest_start",
        "machine_earliest_start",
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
        baseline_earliest_start: datetime | None = None,
        machine_earliest_start: datetime | None = None,
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
        self.baseline_earliest_start = baseline_earliest_start
        self.machine_earliest_start = machine_earliest_start
        self.candidate_count = candidate_count
        self.diagnosis = diagnosis
        self.material_assessment = material_assessment


register_strategy("greedy", GreedyStrategy)
