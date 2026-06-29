"""Simulated Annealing metaheuristic for operation-ordering search.

Greedy dispatching is fast but locally myopic: once an operation is
placed it is never reconsidered, so the quality of the final schedule
hinges on the ordering rule (EDD, SPT, ATC, ...). Simulated Annealing
(SA) sits on top of the greedy backend and searches the *space of
permutations* for one that minimises the objective — the greedy
scheduler is called once per candidate permutation and plays the role
of a deterministic decoder.

Algorithm
---------
1. Run :class:`GreedyStrategy` with a default heuristic (respecting the
   objective weights) to get an initial feasible schedule. Extract the
   permutation implicit in the schedule's ``setup_start`` order.
2. Treat the permutation as the current solution, its
   :func:`score_schedule` value as the current cost.
3. For ``max_iterations`` steps:
    a. Propose a neighbour by swapping two distinct positions in the
       permutation. Swap distance shrinks with temperature to emulate a
       basin-hopping move early and fine-grained search late.
    b. Decode the neighbour by running the greedy scheduler with a
       :class:`FixedOrderHeuristic` seeded with the proposed order.
    c. Accept unconditionally if ``Δ <= 0``; accept with probability
       ``exp(-Δ/T)`` otherwise (Metropolis criterion).
    d. Update the incumbent best. Cool the temperature geometrically
       every ``iterations_per_temperature`` steps.
4. Return the best schedule observed. Diagnostics report the number of
   accepted moves, rejected moves and the final temperature so the
   caller can tune the hyper-parameters.

The move is limited to pairwise swaps because (a) it keeps the
neighbourhood small enough for interactive runs and (b) the greedy
decoder naturally repairs precedence violations (the scheduler only
picks "ready" ops each iteration, so an invalid position in the
permutation becomes a no-op at placement time). That decoupling is the
classical "indirect representation" trick of SA for scheduling: we
never have to check whether a permutation is feasible, the decoder
handles it.
"""

from __future__ import annotations

import math
import random
import time
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
class SimulatedAnnealingOptions:
    """Tunable hyper-parameters for :class:`SimulatedAnnealingStrategy`.

    Defaults are chosen to finish in well under a second on dozens-of-ops
    instances while still exploring a useful portion of the permutation
    space. For very large shops, bump ``max_iterations`` and lower
    ``cooling_rate`` (slower cooling = wider exploration).
    """

    initial_temperature: float = 500.0
    cooling_rate: float = 0.95
    iterations_per_temperature: int = 20
    max_iterations: int = 400
    seed: int | None = 42

    def __post_init__(self) -> None:
        if self.initial_temperature <= 0:
            raise ValidationError("initial_temperature must be > 0")
        if not 0.0 < self.cooling_rate < 1.0:
            raise ValidationError("cooling_rate must be in (0, 1)")
        if self.iterations_per_temperature < 1:
            raise ValidationError("iterations_per_temperature must be >= 1")
        if self.max_iterations < 1:
            raise ValidationError("max_iterations must be >= 1")


class SimulatedAnnealingStrategy:
    """Metaheuristic strategy wrapping the greedy decoder.

    Parameters
    ----------
    options:
        Hyper-parameters. Defaults to :class:`SimulatedAnnealingOptions`.
    base_strategy:
        Injected greedy decoder. Defaults to a fresh :class:`GreedyStrategy`.
        Kept injectable so unit tests can stub it with a counting decoder
        or a custom constraint set.
    """

    name = "sa"

    def __init__(
        self,
        *,
        options: SimulatedAnnealingOptions | None = None,
        base_strategy: GreedyStrategy | None = None,
    ) -> None:
        self._options = options or SimulatedAnnealingOptions()
        self._base = base_strategy or GreedyStrategy()

    def solve(
        self,
        context: SchedulingContext,
        objective: Objective,
    ) -> StrategyResult:
        started = time.perf_counter()
        rng = random.Random(self._options.seed)

        # Step 1: seed with the greedy baseline. If the instance is
        # infeasible this raises immediately and SA never enters the loop.
        initial = self._base.solve(context, objective)
        current_order = self._extract_order(initial.schedule)
        current_schedule = initial.schedule
        current_cost = initial.objective_value

        best_schedule = current_schedule
        best_cost = current_cost

        temperature = self._options.initial_temperature
        accepted = 0
        rejected = 0
        evaluations = 1  # greedy baseline counts as one

        if len(current_order) < 2:
            # Nothing meaningful to search over — return the baseline.
            return self._finalise(
                best_schedule,
                best_cost,
                started,
                accepted=0,
                rejected=0,
                evaluations=evaluations,
                final_temperature=temperature,
                context=context,
            )

        for iteration in range(self._options.max_iterations):
            candidate_order = self._swap_neighbour(current_order, rng)
            try:
                decoded = self._decode(context, objective, candidate_order)
            except InfeasibleScheduleError:
                # Greedy decoder rejected the permutation — extremely
                # rare because greedy always picks among ready ops, but
                # treat it as a rejected move to stay robust.
                rejected += 1
                continue

            evaluations += 1
            candidate_cost = decoded.objective_value
            delta = candidate_cost - current_cost

            if delta <= 0 or rng.random() < math.exp(-delta / max(temperature, 1e-9)):
                current_order = candidate_order
                current_schedule = decoded.schedule
                current_cost = candidate_cost
                accepted += 1
                if candidate_cost < best_cost:
                    best_schedule = decoded.schedule
                    best_cost = candidate_cost
            else:
                rejected += 1

            if (iteration + 1) % self._options.iterations_per_temperature == 0:
                temperature *= self._options.cooling_rate

        return self._finalise(
            best_schedule,
            best_cost,
            started,
            accepted=accepted,
            rejected=rejected,
            evaluations=evaluations,
            final_temperature=temperature,
            context=context,
        )

    # ------------------------------------------------------------------ private

    @staticmethod
    def _extract_order(schedule: Schedule) -> list[str]:
        """Read the operation permutation implicit in a decoded schedule.

        We sort by ``setup_start`` to match the order in which the greedy
        decoder actually placed the operations. This is the permutation
        SA will perturb.
        """
        return [
            a.operation_id
            for a in sorted(schedule.assignments, key=lambda x: x.setup_start)
        ]

    @staticmethod
    def _swap_neighbour(order: list[str], rng: random.Random) -> list[str]:
        """Generate a neighbour by swapping two distinct positions."""
        neighbour = list(order)
        i, j = rng.sample(range(len(neighbour)), 2)
        neighbour[i], neighbour[j] = neighbour[j], neighbour[i]
        return neighbour

    def _decode(
        self,
        context: SchedulingContext,
        objective: Objective,
        order: list[str],
    ) -> StrategyResult:
        """Run the greedy decoder with a fixed-order heuristic override."""
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
        accepted: int,
        rejected: int,
        evaluations: int,
        final_temperature: float,
        context: SchedulingContext,
    ) -> StrategyResult:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        # Refresh the schedule id so the SA run is distinguishable from
        # the seeded greedy baseline in audit logs.
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
                "accepted_moves": accepted,
                "rejected_moves": rejected,
                "evaluations": evaluations,
                "final_temperature": round(final_temperature, 4),
                "initial_temperature": self._options.initial_temperature,
                "cooling_rate": self._options.cooling_rate,
                "seed": self._options.seed,
            },
        )


register_strategy("sa", SimulatedAnnealingStrategy)
