"""Large Neighbourhood Search (LNS) metaheuristic.

LNS (Shaw 1998, Ropke & Pisinger 2006) is a destroy-and-repair
metaheuristic that has become the method of choice for large-scale
combinatorial optimisation in vehicle routing, scheduling, and
resource allocation.

The key idea is simple: instead of making small local moves (swap two
operations), LNS *destroys* a significant portion of the current
solution and *repairs* it from scratch. This produces a much larger
"neighbourhood" than pairwise swaps, allowing the search to escape
local optima that SA and Tabu cannot.

Algorithm
---------
1. Seed with the greedy baseline (same as all other metaheuristics).
2. Extract the implicit permutation.
3. For ``max_iterations`` steps:
    a. **Destroy**: select a fraction ``destroy_fraction`` of operations
       to remove. Three destroy operators are used in round-robin:
       - *Random destroy*: remove operations uniformly at random.
       - *Worst destroy*: remove operations on the most loaded machine
         (bottleneck relief).
       - *Related destroy*: remove operations from the same work order
         (keeps job-level coherence for the repair step).
    b. **Repair**: reinsert the removed operations by running the
       greedy decoder on a permutation where the kept operations appear
       first (in their current order) and the removed ones are appended
       in random order. The decoder naturally interleaves them based on
       readiness.
    c. **Acceptance**: accept the repaired solution if it improves the
       current cost (greedy acceptance) or with a simulated-annealing
       style probability to allow limited worsening for escape.
    d. Update the global best.
4. Return the best schedule observed.

Destroy operators
-----------------
Using multiple destroy operators is called Adaptive LNS (ALNS) in the
literature. Here we use a simpler round-robin rotation, which is
effective for JSSP where no single destroy heuristic dominates.

Why LNS for JSSP
-----------------
LNS is especially powerful when the search space has deep valleys that
small moves cannot bridge. In JSSP this happens when a bottleneck
machine creates a "wall" — swapping two operations on a non-bottleneck
machine does nothing, but removing several operations from the
bottleneck and replanning them simultaneously can break through.
"""

from __future__ import annotations

import math
import random
import time
from collections import Counter
from dataclasses import dataclass
from uuid import uuid4

from ..entities import Schedule
from ..errors import InfeasibleScheduleError, ValidationError
from .context import SchedulingContext
from .greedy_strategy import GreedyStrategy
from .heuristics import FixedOrderHeuristic
from .objective import Objective
from .strategy import StrategyResult, register_strategy


@dataclass(frozen=True, slots=True)
class LNSOptions:
    """Tunable hyper-parameters for :class:`LNSStrategy`.

    Defaults produce a fast run (< 2 s on 50-op instances). For larger
    instances, increase ``max_iterations`` and lower ``destroy_fraction``.
    """

    max_iterations: int = 100
    destroy_fraction: float = 0.3
    accept_temperature: float = 50.0
    cooling_rate: float = 0.98
    seed: int | None = 42

    def __post_init__(self) -> None:
        if self.max_iterations < 1:
            raise ValidationError("max_iterations must be >= 1")
        if not 0.0 < self.destroy_fraction < 1.0:
            raise ValidationError("destroy_fraction must be in (0, 1)")
        if self.accept_temperature <= 0:
            raise ValidationError("accept_temperature must be > 0")
        if not 0.0 < self.cooling_rate < 1.0:
            raise ValidationError("cooling_rate must be in (0, 1)")


class LNSStrategy:
    """Large Neighbourhood Search wrapping the greedy decoder.

    Parameters
    ----------
    options:
        Hyper-parameters. Defaults to :class:`LNSOptions`.
    base_strategy:
        Injected greedy decoder.
    """

    name = "lns"

    def __init__(
        self,
        *,
        options: LNSOptions | None = None,
        base_strategy: GreedyStrategy | None = None,
    ) -> None:
        self._options = options or LNSOptions()
        self._base = base_strategy or GreedyStrategy()

    def solve(
        self,
        context: SchedulingContext,
        objective: Objective,
    ) -> StrategyResult:
        started = time.perf_counter()
        opts = self._options
        rng = random.Random(opts.seed)

        # Step 1: seed.
        initial = self._base.solve(context, objective)
        current_order = self._extract_order(initial.schedule)
        current_cost = initial.objective_value

        best_schedule = initial.schedule
        best_cost = current_cost

        evaluations = 1
        accepted = 0
        temperature = opts.accept_temperature

        if len(current_order) < 2:
            return self._finalise(
                best_schedule,
                best_cost,
                started,
                evaluations=evaluations,
                accepted=0,
                destroy_counts={"random": 0, "worst": 0, "related": 0},
                context=context,
            )

        # Pre-compute op→work_order and op→machine mappings for destroy
        # operators. Machine mapping comes from the current schedule.
        op_to_wo = self._build_op_to_wo(context)
        op_to_machine = self._build_op_to_machine(initial.schedule)

        destroy_operators = ["random", "worst", "related"]
        destroy_counts: dict[str, int] = {k: 0 for k in destroy_operators}

        for iteration in range(opts.max_iterations):
            # Round-robin destroy operator selection.
            operator = destroy_operators[iteration % len(destroy_operators)]
            destroy_counts[operator] += 1

            num_destroy = max(2, int(len(current_order) * opts.destroy_fraction))

            if operator == "random":
                removed_indices = self._random_destroy(
                    current_order, num_destroy, rng
                )
            elif operator == "worst":
                removed_indices = self._worst_destroy(
                    current_order, num_destroy, op_to_machine, rng
                )
            else:
                removed_indices = self._related_destroy(
                    current_order, num_destroy, op_to_wo, rng
                )

            # Repair: keep order of surviving ops, append removed in random order.
            removed_set = set(removed_indices)
            kept = [
                current_order[i]
                for i in range(len(current_order))
                if i not in removed_set
            ]
            removed_ops = [current_order[i] for i in removed_indices]
            rng.shuffle(removed_ops)
            candidate_order = kept + removed_ops

            try:
                decoded = self._decode(context, objective, candidate_order)
            except InfeasibleScheduleError:
                continue

            evaluations += 1
            candidate_cost = decoded.objective_value
            delta = candidate_cost - current_cost

            # SA-style acceptance.
            if delta <= 0 or rng.random() < math.exp(
                -delta / max(temperature, 1e-9)
            ):
                current_order = candidate_order
                current_cost = candidate_cost
                accepted += 1

                # Update machine mapping from new schedule.
                op_to_machine = self._build_op_to_machine(decoded.schedule)

                if candidate_cost < best_cost:
                    best_schedule = decoded.schedule
                    best_cost = candidate_cost

            # Cool.
            temperature *= opts.cooling_rate

        return self._finalise(
            best_schedule,
            best_cost,
            started,
            evaluations=evaluations,
            accepted=accepted,
            destroy_counts=destroy_counts,
            context=context,
        )

    # ------------------------------------------------------------------ destroy

    @staticmethod
    def _random_destroy(
        order: list[str],
        num_destroy: int,
        rng: random.Random,
    ) -> list[int]:
        """Remove operations uniformly at random."""
        return rng.sample(range(len(order)), min(num_destroy, len(order)))

    @staticmethod
    def _worst_destroy(
        order: list[str],
        num_destroy: int,
        op_to_machine: dict[str, str],
        rng: random.Random,
    ) -> list[int]:
        """Remove operations from the most loaded machine (bottleneck).

        Count how many operations each machine handles, then remove
        operations assigned to the busiest machine. If that's not enough,
        continue with the second-busiest.
        """
        machine_counts: Counter[str] = Counter()
        for op_id in order:
            m = op_to_machine.get(op_id)
            if m:
                machine_counts[m] += 1

        if not machine_counts:
            return rng.sample(range(len(order)), min(num_destroy, len(order)))

        # Rank machines by load (descending).
        ranked_machines = [m for m, _ in machine_counts.most_common()]

        removed: list[int] = []
        for machine_id in ranked_machines:
            if len(removed) >= num_destroy:
                break
            for i, op_id in enumerate(order):
                if len(removed) >= num_destroy:
                    break
                if i not in removed and op_to_machine.get(op_id) == machine_id:
                    removed.append(i)

        return removed

    @staticmethod
    def _related_destroy(
        order: list[str],
        num_destroy: int,
        op_to_wo: dict[str, str],
        rng: random.Random,
    ) -> list[int]:
        """Remove operations from the same work order(s).

        Pick a seed operation at random, then greedily add operations
        from the same work order. If the WO is exhausted, pick another
        seed.
        """
        removed: list[int] = []
        removed_set: set[int] = set()
        available = list(range(len(order)))
        rng.shuffle(available)

        for seed_idx in available:
            if len(removed) >= num_destroy:
                break
            if seed_idx in removed_set:
                continue
            wo_id = op_to_wo.get(order[seed_idx])
            if wo_id is None:
                continue
            for i, op_id in enumerate(order):
                if len(removed) >= num_destroy:
                    break
                if i not in removed_set and op_to_wo.get(op_id) == wo_id:
                    removed.append(i)
                    removed_set.add(i)

        return removed

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _extract_order(schedule: Schedule) -> list[str]:
        return [
            a.operation_id
            for a in sorted(schedule.assignments, key=lambda x: x.setup_start)
        ]

    @staticmethod
    def _build_op_to_wo(context: SchedulingContext) -> dict[str, str]:
        mapping: dict[str, str] = {}
        for wo in context.work_orders:
            for op in wo.operations:
                mapping[op.id] = wo.id
        return mapping

    @staticmethod
    def _build_op_to_machine(schedule: Schedule) -> dict[str, str]:
        return {a.operation_id: a.machine_id for a in schedule.assignments}

    def _decode(
        self,
        context: SchedulingContext,
        objective: Objective,
        order: list[str],
    ) -> StrategyResult:
        decoder = GreedyStrategy(
            heuristic=FixedOrderHeuristic(order),
            constraints=self._base._constraints,  # noqa: SLF001
        )
        return decoder.solve(context, objective)

    def _finalise(
        self,
        schedule: Schedule,
        cost: int,
        started: float,
        *,
        evaluations: int,
        accepted: int,
        destroy_counts: dict[str, int],
        context: SchedulingContext,
    ) -> StrategyResult:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        final_schedule = Schedule(
            id=context.run_id or f"run-{uuid4().hex[:12]}",
            created_at=schedule.created_at,
            assignments=schedule.assignments,
        )
        return StrategyResult(
            schedule=final_schedule,
            objective_value=cost,
            strategy_name=self.name,
            wall_time_ms=elapsed_ms,
            solver_status="feasible",
            diagnostics={
                "evaluations": evaluations,
                "accepted_moves": accepted,
                "destroy_counts": destroy_counts,
                "destroy_fraction": self._options.destroy_fraction,
                "accept_temperature": self._options.accept_temperature,
                "cooling_rate": self._options.cooling_rate,
                "seed": self._options.seed,
            },
        )


register_strategy("lns", LNSStrategy)
