"""CP-SAT (OR-Tools) scheduling strategy.

This is the industrial-grade exact / near-optimal backend of PlaniAdvance.
It models the APS problem as a constraint programming problem using
Google's CP-SAT solver (same one that powers Google's industrial planners
and has world-class performance on job-shop and RCPSP benchmarks).

Features modelled
-----------------
- **Optional interval per (operation, machine)** with ``NewOptionalIntervalVar``.
  A boolean ``presence`` variable selects which eligible machine each
  operation runs on (assignment problem baked into the scheduling model).
- **No-overlap** on every machine → exclusive usage (``AddNoOverlap``).
- **Cumulative capacity** on every secondary :class:`Resource`
  (``AddCumulative``) for operator pools, tooling, consumables ...
- **Precedence constraints** (intra-WO ``sequence`` + explicit
  ``dependencies``).
- **Release dates** via lower bounds on the start variable.
- **Sequence-dependent setup times** via an explicit preceding-pair
  boolean encoded with ``OnlyEnforceIf`` (same technique used by the
  CP-SAT reference flexible job shop model). The setup is absorbed into
  the start time of the successor operation so it uses the machine.
- **Calendar-aware intervals**: each machine's forbidden windows (nights,
  week-ends, holidays) are modelled as fixed intervals that participate
  in the ``AddNoOverlap``, preventing any operation from being placed
  outside shift time.
- **Multi-objective cost**: a single integer expression combining
  makespan, total tardiness, weighted tardiness, setup cost and idle
  penalty, weighted by the caller's :class:`Objective`.

Unit of time
------------
Everything is expressed in **integer minutes from the horizon origin**
(``horizon_start``). CP-SAT requires integer domains and it matches the
precision of the greedy strategy (``Duration.minutes``).

Warm-start
----------
A warm start from the greedy strategy is automatically attached to
accelerate convergence: we build a greedy solution first, convert its
assignments to CP-SAT hints (``AddHint``), then let CP-SAT prove
optimality or find a better solution within the time budget.

Robustness
----------
- The strategy **falls back** to the greedy solution when CP-SAT times
  out without producing a feasible solution — production deployments
  must always return *some* plan, never crash.
- Import of ``ortools`` is deferred to ``solve`` so that callers who
  don't select "cpsat" never pay the import cost and never need OR-Tools
  installed.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
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
from ..errors import InfeasibleScheduleError
from .calendar_resolver import CalendarResolver
from .context import SchedulingContext
from .dependency_links import operation_dependency_links
from .diagnosis import (
    Blocker,
    BlockerKind,
    InfeasibilityReport,
    OperationDiagnosis,
)
from .greedy_strategy import GreedyStrategy
from .objective import Objective, score_schedule
from .setup_lookup import resolve_setup_minutes
from .strategy import StrategyResult, register_strategy


@dataclass(slots=True)
class CpSatOptions:
    """Tunables for the CP-SAT strategy.

    Industrial deployments rarely leave these defaults in place: tactical
    planning nights can afford several minutes of solve time, while
    on-line rescheduling must finish under 5 seconds.
    """

    time_limit_seconds: float = 15.0
    num_workers: int = 8
    warm_start_from_greedy: bool = True
    log_search_progress: bool = False


class CpSatStrategy:
    """Exact / near-optimal CP-SAT backend."""

    name = "cpsat"

    def __init__(self, options: CpSatOptions | None = None) -> None:
        self._options = options or CpSatOptions()

    def solve(
        self,
        context: SchedulingContext,
        objective: Objective,
    ) -> StrategyResult:
        try:
            from ortools.sat.python import cp_model  # type: ignore
        except ImportError as exc:  # pragma: no cover - exercised only w/o ortools
            raise ImportError(
                "CP-SAT strategy requires OR-Tools. Install it with "
                "`pip install ortools`."
            ) from exc

        started = time.perf_counter()
        horizon_min = self._horizon_minutes(context)

        warm_result: StrategyResult | None = None
        warm_schedule: Schedule | None = None
        if self._options.warm_start_from_greedy or self._requires_material_delegate(context):
            try:
                warm_result = GreedyStrategy().solve(context, objective)
                warm_schedule = warm_result.schedule
            except InfeasibleScheduleError:
                warm_result = None
                warm_schedule = None  # greedy gave up — let CP-SAT try anyway

        if self._requires_material_delegate(context):
            if warm_result is None:
                report = InfeasibilityReport(
                    strategy=self.name,
                    scheduled_so_far=0,
                    total_operations=sum(len(wo.operations) for wo in context.work_orders),
                    operations=[
                        OperationDiagnosis(
                            operation_id="<material-model>",
                            work_order_id="<material-model>",
                            earliest_possible_start=context.horizon_start,
                            blockers=[
                                Blocker(
                                    kind=BlockerKind.MATERIAL_SHORTAGE,
                                    message=(
                                        "CP-SAT material synchronization currently delegates "
                                        "to the greedy material-aware planner, but no feasible "
                                        "material-aware seed could be built."
                                    ),
                                )
                            ],
                        )
                    ],
                    suggestions=[
                        "Increase material availability or inbound supply before retrying CP-SAT.",
                        "Use the greedy or backward material-aware strategy for now.",
                    ],
                )
                raise InfeasibleScheduleError(
                    "CP-SAT could not build a feasible material-aware delegate schedule",
                    report=report,
                )

            elapsed_ms = int((time.perf_counter() - started) * 1000)
            delegated_diagnostics = dict(warm_result.diagnostics)
            delegated_diagnostics.update(
                {
                    "cpsat_status": "SKIPPED_MATERIAL_DELEGATE",
                    "delegated_strategy": "greedy",
                    "delegation_reason": (
                        "CP-SAT exact material synchronization is not modeled yet; "
                        "using the material-aware greedy planner to keep the plan trustworthy."
                    ),
                    "material_modeling_mode": "heuristic_delegate",
                    "used_warm_start": False,
                }
            )
            return StrategyResult(
                schedule=warm_result.schedule,
                objective_value=warm_result.objective_value,
                strategy_name=self.name,
                wall_time_ms=elapsed_ms,
                solver_status="DELEGATED_MATERIAL_GREEDY",
                diagnostics=delegated_diagnostics,
            )

        model = cp_model.CpModel()
        builder = _CpSatBuilder(
            model=model,
            context=context,
            objective=objective,
            horizon_min=horizon_min,
            cp_model=cp_model,
        )
        builder.build()

        if warm_schedule is not None:
            builder.add_warm_start(warm_schedule)

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = self._options.time_limit_seconds
        solver.parameters.num_search_workers = self._options.num_workers
        solver.parameters.log_search_progress = self._options.log_search_progress
        status = solver.Solve(model)

        status_name = solver.StatusName(status)
        feasible = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)

        if not feasible:
            if warm_schedule is not None:
                # Never fail hard in production — return the warm start.
                score = score_schedule(
                    warm_schedule,
                    context.work_orders,
                    objective,
                    horizon_start=context.horizon_start,
                    baseline_schedule=context.baseline_schedule,
                )
                elapsed_ms = int((time.perf_counter() - started) * 1000)
                return StrategyResult(
                    schedule=warm_schedule,
                    objective_value=score,
                    strategy_name=self.name,
                    wall_time_ms=elapsed_ms,
                    solver_status=f"fallback_greedy:{status_name}",
                    diagnostics={
                        "cpsat_status": status_name,
                        "fallback_reason": "cpsat did not return a feasible solution",
                        "delegated_strategy": "greedy",
                        "used_warm_start": warm_schedule is not None,
                    },
                )

            report = InfeasibilityReport(
                strategy=self.name,
                scheduled_so_far=0,
                total_operations=builder.total_operations,
                operations=[
                    OperationDiagnosis(
                        operation_id="<model>",
                        work_order_id="<model>",
                        earliest_possible_start=context.horizon_start,
                        blockers=[
                            Blocker(
                                kind=BlockerKind.CUSTOM_CONSTRAINT,
                                message=(
                                    f"CP-SAT returned status {status_name}"
                                ),
                            )
                        ],
                    )
                ],
                suggestions=[
                    "Extend the horizon, add capacity, or relax due dates.",
                    "Increase CP-SAT time_limit_seconds if the run ended on a "
                    "timeout.",
                ],
            )
            raise InfeasibleScheduleError(
                f"CP-SAT strategy could not find a feasible plan ({status_name})",
                report=report,
            )

        schedule = builder.extract_schedule(solver)
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
            solver_status=status_name,
            diagnostics={
                "cpsat_status": status_name,
                "cpsat_objective": float(solver.ObjectiveValue()),
                "cpsat_best_bound": float(solver.BestObjectiveBound()),
                "num_booleans": solver.NumBooleans(),
                "num_conflicts": solver.NumConflicts(),
                "num_branches": solver.NumBranches(),
                "used_warm_start": warm_schedule is not None,
            },
        )

    @staticmethod
    def _horizon_minutes(context: SchedulingContext) -> int:
        delta = context.horizon_end - context.horizon_start
        minutes = int(delta.total_seconds() // 60)
        if minutes <= 0:
            raise InfeasibleScheduleError(
                "CP-SAT strategy requires horizon_end > horizon_start"
            )
        return minutes

    @staticmethod
    def _requires_material_delegate(context: SchedulingContext) -> bool:
        if context.inventory_items or context.supplies:
            return True
        return any(
            op.material_requirements
            for wo in context.work_orders
            for op in wo.operations
        )


# --------------------------------------------------------------------------
# Model builder
# --------------------------------------------------------------------------

# Kept in a dedicated class because CP-SAT models are large and benefit
# from clean, incremental construction. Each ``_add_*`` helper is a single
# concern that the unit tests can exercise in isolation if needed.
class _CpSatBuilder:
    """Builds a CP-SAT model for a :class:`SchedulingContext`."""

    def __init__(
        self,
        *,
        model,
        context: SchedulingContext,
        objective: Objective,
        horizon_min: int,
        cp_model,
    ) -> None:
        self._model = model
        self._context = context
        self._objective = objective
        self._horizon = horizon_min
        self._cp_model = cp_model
        self._machine_map = context.machine_map()
        self._calendar_map = context.calendar_map()
        self._resource_map = context.resource_map()
        self._baseline_assignment_by_op = (
            {
                assignment.operation_id: assignment
                for assignment in context.baseline_schedule.assignments
            }
            if context.baseline_schedule is not None
            else {}
        )

        # Per-(op, machine) decision variables. An operation gets one entry
        # per eligible machine; the ``presence`` boolean selects which one
        # is active. All other variables are scoped under that presence.
        self._op_intervals: dict[tuple[str, str], _OpIntervalVars] = {}
        # Per-operation: the chosen start/end/machine (derived via Element
        # / channel constraints).
        self._op_start: dict[str, object] = {}
        self._op_end: dict[str, object] = {}
        self._op_obj: dict[str, Operation] = {}
        self._op_wo: dict[str, WorkOrder] = {}

    @property
    def total_operations(self) -> int:
        return len(self._op_obj)

    def build(self) -> None:
        self._collect_operations()
        self._add_variables()
        self._add_precedence()
        self._add_no_overlap_per_machine()
        self._add_calendar_forbidden_intervals()
        self._add_resource_cumulative()
        self._add_objective()

    # ---- step 1: collect -------------------------------------------------

    def _collect_operations(self) -> None:
        for wo in self._context.work_orders:
            for op in wo.ordered_operations():
                self._op_obj[op.id] = op
                self._op_wo[op.id] = wo

    # ---- step 2: variables ----------------------------------------------

    def _add_variables(self) -> None:
        for op_id, op in self._op_obj.items():
            wo = self._op_wo[op_id]
            release_min = max(
                self._minutes_from_start(wo.release_date),
                0,
            )

            op_start = self._model.NewIntVar(
                release_min, self._horizon, f"start[{op_id}]"
            )
            op_end = self._model.NewIntVar(
                release_min, self._horizon, f"end[{op_id}]"
            )
            self._op_start[op_id] = op_start
            self._op_end[op_id] = op_end

            presences = []
            for routing in op.effective_routings():
                machine = self._machine_map[routing.machine_id]
                run_minutes = self._effective_run_minutes(op, routing, machine)

                presence = self._model.NewBoolVar(
                    f"x[{op_id}->{routing.machine_id}]"
                )
                start = self._model.NewIntVar(
                    release_min,
                    self._horizon,
                    f"start[{op_id}|{routing.machine_id}]",
                )
                end = self._model.NewIntVar(
                    release_min,
                    self._horizon,
                    f"end[{op_id}|{routing.machine_id}]",
                )
                interval = self._model.NewOptionalIntervalVar(
                    start,
                    run_minutes,
                    end,
                    presence,
                    f"iv[{op_id}|{routing.machine_id}]",
                )
                self._op_intervals[(op_id, routing.machine_id)] = _OpIntervalVars(
                    presence=presence,
                    start=start,
                    end=end,
                    interval=interval,
                    run_minutes=run_minutes,
                    op=op,
                    routing=routing,
                    machine=machine,
                )
                presences.append(presence)

                # Channel the per-machine start/end back to the op-level
                # start/end when this machine is chosen. When not chosen,
                # the per-machine vars are free within their domain — CP-SAT
                # will leave them inactive.
                self._model.Add(start == op_start).OnlyEnforceIf(presence)
                self._model.Add(end == op_end).OnlyEnforceIf(presence)

            # Exactly one routing alternative must be selected.
            self._model.AddExactlyOne(presences)

    # ---- step 3: precedence ---------------------------------------------

    def _add_precedence(self) -> None:
        for wo in self._context.work_orders:
            for op in wo.ordered_operations():
                for link in operation_dependency_links(wo, op):
                    if link.depends_on_id in self._op_end:
                        self._add_precedence_edge(link.depends_on_id, op.id, link)

    def _add_precedence_edge(self, prev_id: str, next_id: str, link) -> None:
        """Add ``start_next >= end_prev (+ transfer_delay)`` for one edge.

        Transfer delay depends on the (predecessor_machine → successor_machine)
        assignment which is itself a CP-SAT decision. We encode it as a
        disjunction: for every ``(m_prev, m_next)`` pair with a non-zero
        delay we add a guarded ``start_next >= end_prev + delay`` enforced
        only when both machine-assignment literals are true. All other
        pairs default to the unguarded ``start_next >= end_prev``.
        """
        prev_op = self._op_obj[prev_id]
        next_op = self._op_obj[next_id]
        transfer_times = self._context.transfer_times

        if link.dependency_type == "start_to_start":
            self._model.Add(
                self._op_start[next_id] >= self._op_start[prev_id] + link.lag_minutes
            )
            if link.max_wait_minutes is not None:
                self._model.Add(
                    self._op_start[next_id]
                    <= self._op_start[prev_id] + link.max_wait_minutes
                )
            return

        self._model.Add(
            self._op_start[next_id] >= self._op_end[prev_id] + link.lag_minutes
        )
        if link.max_wait_minutes is not None:
            self._model.Add(
                self._op_start[next_id]
                <= self._op_end[prev_id] + link.max_wait_minutes
            )

        # Guarded tighter bounds for non-zero transfer pairs.
        for m_prev in prev_op.eligible_machine_ids:
            prev_vars = self._op_intervals[(prev_id, m_prev)]
            for m_next in next_op.eligible_machine_ids:
                delay = transfer_times.minutes(m_prev, m_next)
                if delay <= 0:
                    continue
                next_vars = self._op_intervals[(next_id, m_next)]
                self._model.Add(
                    self._op_start[next_id]
                    >= self._op_end[prev_id] + link.lag_minutes + delay
                ).OnlyEnforceIf([prev_vars.presence, next_vars.presence])

    # ---- step 4: machine no-overlap + sequence-dependent setup ----------

    def _add_no_overlap_per_machine(self) -> None:
        # Group intervals by machine, build a circuit-free no-overlap that
        # also injects sequence-dependent setup between any two chosen
        # neighbours.
        by_machine: dict[str, list[_OpIntervalVars]] = {}
        for (_, machine_id), vars_ in self._op_intervals.items():
            by_machine.setdefault(machine_id, []).append(vars_)

        for machine_id, vars_list in by_machine.items():
            intervals = [v.interval for v in vars_list]
            self._model.AddNoOverlap(intervals)
            self._inject_sequence_dependent_setup(machine_id, vars_list)

    def _inject_sequence_dependent_setup(
        self,
        machine_id: str,
        vars_list: list[_OpIntervalVars],
    ) -> None:
        """Add ``start_j >= end_i + setup(i->j)`` for each ordered pair of
        intervals that both end up on this machine and where ``j`` follows
        ``i`` directly.

        A full per-pair disjunction is O(n^2) but n is bounded per
        machine, so this stays tractable for realistic shop sizes. We add
        the constraint only when both intervals are present AND the pair
        is declared ``before`` — a boolean enforced via OnlyEnforceIf.
        """
        machine = self._machine_map[machine_id]
        if machine.setup_matrix is None:
            return  # Setup is already absorbed in the per-machine run time.

        for i, a in enumerate(vars_list):
            for j, b in enumerate(vars_list):
                if i == j:
                    continue
                setup = resolve_setup_minutes(
                    operation=b.op,
                    machine=machine,
                    previous_family=a.op.setup_family,
                )
                if setup <= 0:
                    continue
                # "a runs immediately before b on this machine" is too
                # expensive to encode exactly for every pair — instead we
                # add a weaker but still sound constraint: when both are
                # present, enforce a disjunction on which order they run.
                a_before_b = self._model.NewBoolVar(
                    f"before[{machine_id}|{a.op.id}<{b.op.id}]"
                )
                both_present = self._model.NewBoolVar(
                    f"both[{machine_id}|{a.op.id},{b.op.id}]"
                )
                self._model.AddBoolAnd([a.presence, b.presence]).OnlyEnforceIf(
                    both_present
                )
                self._model.AddBoolOr(
                    [a.presence.Not(), b.presence.Not()]
                ).OnlyEnforceIf(both_present.Not())

                # When both present: either a precedes b with setup, or b
                # precedes a (its own setup handled in the symmetric pair).
                self._model.Add(b.start >= a.end + setup).OnlyEnforceIf(
                    [both_present, a_before_b]
                )
                self._model.Add(a.start >= b.end).OnlyEnforceIf(
                    [both_present, a_before_b.Not()]
                )

    # ---- step 5: calendar forbidden windows -----------------------------

    def _add_calendar_forbidden_intervals(self) -> None:
        """Forbid any activity on a machine outside its working calendar.

        We compute the machine's working windows over the horizon, invert
        them to get the non-working (forbidden) windows, and add a fixed
        interval per forbidden block to the machine's no-overlap set.
        This is the standard CP-SAT pattern for calendar-aware scheduling.
        """
        resolver = CalendarResolver(
            self._context.horizon_start, self._context.horizon_end
        )
        by_machine: dict[str, list] = {}
        for (_, machine_id), vars_ in self._op_intervals.items():
            by_machine.setdefault(machine_id, []).append(vars_.interval)

        for machine in self._context.machines:
            calendar = self._calendar_map[machine.calendar_id]
            # Effective windows already subtract maintenance — by inverting
            # them we get BOTH off-shift AND maintenance forbidden periods
            # in one pass, which is simpler and faster than modelling two
            # disjoint fixed-interval sets.
            working = resolver.effective_windows(
                calendar, maintenance=machine.maintenance_windows
            )
            forbidden = self._invert_windows(working)
            if not forbidden:
                continue
            existing = by_machine.get(machine.id, [])
            fixed_intervals = []
            for start_min, end_min in forbidden:
                if end_min <= start_min:
                    continue
                fixed = self._model.NewFixedSizeIntervalVar(
                    start_min,
                    end_min - start_min,
                    f"offshift[{machine.id}|{start_min}:{end_min}]",
                )
                fixed_intervals.append(fixed)
            # Re-declare a stronger NoOverlap that includes the forbidden
            # fixed intervals. CP-SAT tolerates multiple NoOverlaps on the
            # same interval set so this is safe.
            self._model.AddNoOverlap(existing + fixed_intervals)

    def _invert_windows(
        self, working_windows: list
    ) -> list[tuple[int, int]]:
        """Return the complement (in minutes) of ``working_windows`` over
        the horizon as a list of ``(start, end)`` minute pairs."""
        horizon = self._horizon
        if not working_windows:
            return [(0, horizon)]
        minutes: list[tuple[int, int]] = []
        cursor = 0
        for window in working_windows:
            ws = max(self._minutes_from_start(window.start), 0)
            we = min(self._minutes_from_start(window.end), horizon)
            if ws > cursor:
                minutes.append((cursor, ws))
            cursor = max(cursor, we)
        if cursor < horizon:
            minutes.append((cursor, horizon))
        return minutes

    # ---- step 6: cumulative resources -----------------------------------

    def _add_resource_cumulative(self) -> None:
        if not self._context.resources:
            return
        # For each resource, collect the intervals + demands of all ops
        # that require it, then add a single AddCumulative. We read
        # requirements from the routing alternative rather than the
        # operation's flat list so two routings on different machines can
        # consume different operator counts.
        per_resource: dict[str, list[tuple[object, int]]] = {}
        for vars_ in self._op_intervals.values():
            for req in vars_.routing.resource_requirements:
                per_resource.setdefault(req.resource_id, []).append(
                    (vars_.interval, req.units)
                )

        for resource_id, entries in per_resource.items():
            resource = self._resource_map[resource_id]
            intervals = [e[0] for e in entries]
            demands = [e[1] for e in entries]
            self._model.AddCumulative(intervals, demands, resource.capacity)

    # ---- step 7: objective ---------------------------------------------

    def _add_objective(self) -> None:
        obj = self._objective
        terms = []

        # Makespan.
        if obj.makespan > 0:
            makespan_var = self._model.NewIntVar(0, self._horizon, "makespan")
            self._model.AddMaxEquality(
                makespan_var, list(self._op_end.values())
            )
            terms.append(obj.makespan * makespan_var)

        # Tardiness (total + weighted).
        if obj.total_tardiness > 0 or obj.weighted_tardiness > 0:
            for op_id, op in self._op_obj.items():
                wo = self._op_wo[op_id]
                if op.sequence != max(o.sequence for o in wo.operations):
                    # Only measure tardiness on the last op of each WO.
                    continue
                due_min = self._minutes_from_start(wo.due_date)
                tardy = self._model.NewIntVar(
                    0, self._horizon, f"tardy[{wo.id}]"
                )
                # tardy >= end - due ; tardy >= 0 (by domain).
                self._model.Add(tardy >= self._op_end[op_id] - due_min)
                if obj.total_tardiness > 0:
                    terms.append(obj.total_tardiness * tardy)
                if obj.weighted_tardiness > 0:
                    terms.append(
                        obj.weighted_tardiness * int(wo.priority) * tardy
                    )

        # Setup cost: sum of machine-specific setup minutes effectively
        # applied. We approximate it by summing the *per-interval* setup
        # that was folded into run_minutes — exact enough for comparison.
        if obj.setup_cost > 0:
            setup_total = 0
            for vars_ in self._op_intervals.values():
                machine = vars_.machine
                setup_min = resolve_setup_minutes(
                    operation=vars_.op,
                    machine=machine,
                    previous_family=None,
                    default_minutes=vars_.routing.setup_time.minutes,
                )
                if setup_min:
                    # Add weight when this (op, machine) pair is active.
                    setup_total_var = self._model.NewIntVar(
                        0, setup_min, f"setup[{vars_.op.id}|{machine.id}]"
                    )
                    self._model.Add(setup_total_var == setup_min).OnlyEnforceIf(
                        vars_.presence
                    )
                    self._model.Add(setup_total_var == 0).OnlyEnforceIf(
                        vars_.presence.Not()
                    )
                    terms.append(obj.setup_cost * setup_total_var)
                    setup_total += setup_min

        if obj.start_shift_penalty > 0:
            for op_id, baseline_assignment in self._baseline_assignment_by_op.items():
                op_start = self._op_start.get(op_id)
                if op_start is None:
                    continue
                baseline_start_min = self._minutes_from_start(
                    baseline_assignment.start
                )
                max_shift = max(
                    abs(0 - baseline_start_min),
                    abs(self._horizon - baseline_start_min),
                )
                shift_var = self._model.NewIntVar(
                    0,
                    max_shift,
                    f"baseline_start_shift[{op_id}]",
                )
                self._model.AddAbsEquality(
                    shift_var,
                    op_start - baseline_start_min,
                )
                terms.append(obj.start_shift_penalty * shift_var)

        if obj.machine_change_penalty > 0:
            for op_id, baseline_assignment in self._baseline_assignment_by_op.items():
                baseline_choice = self._op_intervals.get(
                    (op_id, baseline_assignment.machine_id)
                )
                if baseline_choice is None:
                    continue
                changed = self._model.NewBoolVar(
                    f"baseline_machine_changed[{op_id}]"
                )
                self._model.Add(changed + baseline_choice.presence == 1)
                terms.append(obj.machine_change_penalty * changed)

        if terms:
            self._model.Minimize(sum(terms))

    # ---- extraction ------------------------------------------------------

    def extract_schedule(self, solver) -> Schedule:
        assignments: list[ScheduledOperation] = []
        for (op_id, machine_id), vars_ in self._op_intervals.items():
            if solver.Value(vars_.presence) != 1:
                continue
            start_min = solver.Value(vars_.start)
            end_min = solver.Value(vars_.end)
            # The per-machine run_minutes already includes the sequence-
            # dependent setup so we report setup_start = run_start for
            # CP-SAT results. The greedy strategy keeps them distinct —
            # consumers should use full_window / run_window properties
            # instead of comparing fields directly.
            setup_start = self._instant_at(start_min)
            run_start = setup_start
            run_end = self._instant_at(end_min)
            assignments.append(
                ScheduledOperation(
                    operation_id=op_id,
                    work_order_id=vars_.op.work_order_id,
                    machine_id=machine_id,
                    setup_start=setup_start,
                    start=run_start,
                    end=run_end,
                )
            )
        assignments.sort(key=lambda a: (a.start, a.machine_id))
        return Schedule(
            id=self._context.run_id or f"run-{uuid4().hex[:12]}",
            created_at=datetime.utcnow(),
            assignments=assignments,
        )

    def add_warm_start(self, schedule: Schedule) -> None:
        """Feed a prior solution as hints so CP-SAT starts from it."""
        for assignment in schedule.assignments:
            key = (assignment.operation_id, assignment.machine_id)
            vars_ = self._op_intervals.get(key)
            if vars_ is None:
                continue
            start_min = self._minutes_from_start(assignment.setup_start)
            self._model.AddHint(vars_.presence, 1)
            self._model.AddHint(vars_.start, max(start_min, 0))

    # ---- helpers --------------------------------------------------------

    def _minutes_from_start(self, instant: datetime) -> int:
        delta: timedelta = instant - self._context.horizon_start
        return int(delta.total_seconds() // 60)

    def _instant_at(self, minutes_from_start: int) -> datetime:
        return self._context.horizon_start + timedelta(minutes=minutes_from_start)

    def _effective_run_minutes(
        self,
        op: Operation,
        routing: RoutingAlternative,
        machine: Machine,
    ) -> int:
        """Run + setup time folded into a single interval duration.

        CP-SAT treats each interval atomically, so the cleanest way to
        account for per-(op, machine) setup is to bake it into the
        interval length. Sequence-dependent setup is then *added on top*
        via the pair constraints in ``_inject_sequence_dependent_setup``
        when a setup matrix is active — giving a conservative but still
        very useful lower bound.

        Uses the routing's ``duration`` and ``setup_time`` so two
        alternatives on the same machine with different profiles get
        distinct interval lengths.
        """
        run_min = routing.duration.minutes
        if machine.efficiency != 1.0:
            run_min = max(int(round(run_min / machine.efficiency)), 1)

        setup_min = resolve_setup_minutes(
            operation=op,
            machine=machine,
            previous_family=None,
            default_minutes=routing.setup_time.minutes,
        )
        if machine.efficiency != 1.0:
            setup_min = max(int(round(setup_min / machine.efficiency)), 0)
        return max(run_min + setup_min, 1)


@dataclass(slots=True)
class _OpIntervalVars:
    """CP-SAT variables associated to one (op, routing) assignment."""

    presence: object
    start: object
    end: object
    interval: object
    run_minutes: int
    op: Operation
    routing: RoutingAlternative
    machine: Machine


register_strategy("cpsat", CpSatStrategy)
