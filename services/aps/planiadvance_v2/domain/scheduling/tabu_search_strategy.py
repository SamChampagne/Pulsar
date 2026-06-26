"""Tabu Search metaheuristic for operation-ordering search.

Tabu Search (TS) is the go-to improvement metaheuristic for job-shop
scheduling in industrial OR.  Like :class:`SimulatedAnnealingStrategy` it
wraps the greedy decoder and searches the permutation space, but the
acceptance mechanism is fundamentally different:

- **Best-neighbour steepest descent**: every iteration evaluates a
  *sample* of the neighbourhood and picks the best non-tabu move — even
  if it degrades the objective (hill climbing when stuck).
- **Short-term memory (tabu list)**: recently reversed swaps are
  forbidden for ``tabu_tenure`` iterations, which prevents cycling.
- **Aspiration criterion**: a tabu move is accepted anyway if it
  improves the global best, because blocking a record-setting move
  would be self-defeating.
- **Diversification restart**: after ``stagnation_limit`` iterations
  without improvement, the search restarts from a randomly shuffled
  permutation to escape a plateau.

This combination makes TS more aggressive than SA — it always takes the
best available step rather than gambling on acceptance probability — and
empirically it dominates SA on JSSP benchmarks (Taillard, Lawrence).

Algorithm
---------
1. Seed with the greedy baseline (same as SA).
2. Extract the implicit permutation from the schedule.
3. For ``max_iterations`` steps:
    a. Sample ``neighbourhood_size`` random swaps.
    b. Decode each through the greedy backend, score it.
    c. Pick the best candidate that is either:
       - not tabu, OR
       - tabu but beats the global best (aspiration).
    d. Apply the move, record the *reverse* swap in the tabu list.
    e. If no improvement for ``stagnation_limit`` iterations,
       restart from a random permutation.
4. Return the global best schedule.

Complexity
----------
Each iteration evaluates ``neighbourhood_size`` decodings. With defaults
(``max_iterations=200``, ``neighbourhood_size=10``), that is ≤ 2 000
greedy evaluations — well under 2 seconds on a 50-op instance.
"""

from __future__ import annotations

import random
import time
from collections import deque
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
class TabuSearchOptions:
    """Tunable hyper-parameters for :class:`TabuSearchStrategy`.

    Defaults produce a fast run suitable for interactive scheduling.
    For tactical overnight planning, increase ``max_iterations`` and
    ``neighbourhood_size``.
    """

    max_iterations: int = 200
    neighbourhood_size: int = 10
    tabu_tenure: int = 15
    stagnation_limit: int = 50
    seed: int | None = 42

    def __post_init__(self) -> None:
        if self.max_iterations < 1:
            raise ValidationError("max_iterations must be >= 1")
        if self.neighbourhood_size < 1:
            raise ValidationError("neighbourhood_size must be >= 1")
        if self.tabu_tenure < 1:
            raise ValidationError("tabu_tenure must be >= 1")
        if self.stagnation_limit < 1:
            raise ValidationError("stagnation_limit must be >= 1")


class TabuSearchStrategy:
    """Tabu Search metaheuristic wrapping the greedy decoder.

    Parameters
    ----------
    options:
        Hyper-parameters. Defaults to :class:`TabuSearchOptions`.
    base_strategy:
        Injected greedy decoder. Defaults to a fresh :class:`GreedyStrategy`.
    """

    name = "tabu"

    def __init__(
        self,
        *,
        options: TabuSearchOptions | None = None,
        base_strategy: GreedyStrategy | None = None,
    ) -> None:
        self._options = options or TabuSearchOptions()
        self._base = base_strategy or GreedyStrategy()

    def solve(
        self,
        context: SchedulingContext,
        objective: Objective,
    ) -> StrategyResult:
        started = time.perf_counter()
        rng = random.Random(self._options.seed)
        opts = self._options

        # Step 1: seed with the greedy baseline.
        initial = self._base.solve(context, objective)
        current_order = self._extract_order(initial.schedule)
        current_cost = initial.objective_value

        best_schedule = initial.schedule
        best_cost = current_cost

        evaluations = 1
        accepted = 0
        restarts = 0
        stagnation_counter = 0

        if len(current_order) < 2:
            return self._finalise(
                best_schedule,
                best_cost,
                started,
                accepted=0,
                evaluations=evaluations,
                restarts=0,
                context=context,
            )

        # Tabu list: stores (i, j) swap pairs that are forbidden.
        # Using a deque with maxlen automatically evicts old entries.
        tabu_list: deque[tuple[int, int]] = deque(maxlen=opts.tabu_tenure)

        for _iteration in range(opts.max_iterations):
            # Generate neighbourhood: sample random swaps.
            candidates: list[tuple[list[str], int, tuple[int, int]]] = []
            for _ in range(opts.neighbourhood_size):
                i, j = rng.sample(range(len(current_order)), 2)
                if i > j:
                    i, j = j, i  # canonical form

                neighbour = list(current_order)
                neighbour[i], neighbour[j] = neighbour[j], neighbour[i]

                try:
                    decoded = self._decode(context, objective, neighbour)
                except InfeasibleScheduleError:
                    continue

                evaluations += 1
                candidates.append((neighbour, decoded.objective_value, (i, j)))

                # Track the decoded schedule for the best candidate.
                if not hasattr(self, "_last_decoded"):
                    pass
                # We'll pick the schedule after selecting the best.

            if not candidates:
                # All neighbours were infeasible — bump stagnation.
                stagnation_counter += 1
                if stagnation_counter >= opts.stagnation_limit:
                    current_order = self._random_permutation(current_order, rng)
                    stagnation_counter = 0
                    restarts += 1
                continue

            # Pick the best non-tabu candidate, or best tabu that beats
            # global best (aspiration criterion).
            best_candidate = None
            best_candidate_cost = float("inf")
            best_candidate_swap = (0, 0)

            for neighbour, cost, swap in candidates:
                is_tabu = swap in tabu_list
                aspirates = cost < best_cost
                if (not is_tabu or aspirates) and cost < best_candidate_cost:
                    best_candidate = neighbour
                    best_candidate_cost = cost
                    best_candidate_swap = swap

            if best_candidate is None:
                # All candidates were tabu and none aspirates.
                stagnation_counter += 1
                if stagnation_counter >= opts.stagnation_limit:
                    current_order = self._random_permutation(current_order, rng)
                    stagnation_counter = 0
                    restarts += 1
                continue

            # Apply the move.
            current_order = best_candidate
            current_cost = int(best_candidate_cost)
            accepted += 1

            # Record the reverse swap as tabu.
            tabu_list.append(best_candidate_swap)

            # Decode the winning candidate to get its schedule.
            try:
                decoded = self._decode(context, objective, current_order)
                if decoded.objective_value <= best_cost:
                    best_schedule = decoded.schedule
                    best_cost = decoded.objective_value
                    stagnation_counter = 0
                else:
                    stagnation_counter += 1
            except InfeasibleScheduleError:
                stagnation_counter += 1

            evaluations += 1

            # Diversification restart on stagnation.
            if stagnation_counter >= opts.stagnation_limit:
                current_order = self._random_permutation(current_order, rng)
                stagnation_counter = 0
                restarts += 1

        return self._finalise(
            best_schedule,
            best_cost,
            started,
            accepted=accepted,
            evaluations=evaluations,
            restarts=restarts,
            context=context,
        )

    # ------------------------------------------------------------------ private

    @staticmethod
    def _extract_order(schedule: Schedule) -> list[str]:
        return [
            a.operation_id
            for a in sorted(schedule.assignments, key=lambda x: x.setup_start)
        ]

    @staticmethod
    def _random_permutation(order: list[str], rng: random.Random) -> list[str]:
        """Diversification: shuffle for a fresh start."""
        shuffled = list(order)
        rng.shuffle(shuffled)
        return shuffled

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
        accepted: int,
        evaluations: int,
        restarts: int,
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
                "accepted_moves": accepted,
                "evaluations": evaluations,
                "restarts": restarts,
                "max_iterations": self._options.max_iterations,
                "neighbourhood_size": self._options.neighbourhood_size,
                "tabu_tenure": self._options.tabu_tenure,
                "seed": self._options.seed,
            },
        )


register_strategy("tabu", TabuSearchStrategy)
