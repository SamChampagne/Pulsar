"""Genetic Algorithm (GA) metaheuristic for operation-ordering search.

Population-based metaheuristics explore the permutation landscape from
multiple starting points simultaneously. While SA and Tabu Search walk
a single trajectory, the GA maintains a *population* of candidate
permutations and evolves them through selection, crossover, and
mutation. This diversity makes the GA less likely to get stuck in a
single basin of attraction and lets it discover qualitatively different
schedule structures.

Algorithm
---------
1. **Initialisation**: Generate ``population_size`` random permutations
   of the operation list. The first individual is always the greedy
   baseline to ensure the GA starts from a known-good solution.
2. **Evaluation**: Decode each permutation through the greedy backend
   and score it against the objective.
3. For ``num_generations`` generations:
    a. **Selection**: Binary tournament — pick two individuals at random,
       keep the one with the lower cost. Repeat until the mating pool
       is full.
    b. **Crossover**: Order Crossover (OX) with probability
       ``crossover_rate``. OX preserves relative ordering of elements,
       which maps well to scheduling permutations because subsequence
       order matters more than absolute position.
    c. **Mutation**: Swap mutation with probability ``mutation_rate`` —
       swap two random positions. Low-cost perturbation that maintains
       solution validity.
    d. **Evaluation**: Decode new offspring.
    e. **Elitism**: The best ``elite_count`` individuals survive
       unchanged into the next generation, preventing loss of the
       incumbent best.
4. Return the best schedule observed across all generations.

Order Crossover (OX)
--------------------
Given parents P1 and P2, select a random substring from P1. Copy it
to the child at the same position. Fill the remaining positions with
elements from P2 in the order they appear, skipping elements already
placed. This produces a valid permutation that inherits subsequence
structure from both parents — the scheduling equivalent of inheriting
"machine assignment patterns".

Why GA for JSSP
---------------
GAs have a strong track record on JSSP benchmarks (Bierwirth 1995,
Goncalves 2005). The permutation-with-greedy-decoder representation
(identical to what SA and Tabu use in this engine) is called the
"priority-based" or "random key" representation and guarantees
feasibility by construction. The GA adds *recombination* — something
SA and Tabu cannot do — which lets it combine good sub-sequences from
different parent schedules.
"""

from __future__ import annotations

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
class GeneticAlgorithmOptions:
    """Tunable hyper-parameters for :class:`GeneticAlgorithmStrategy`.

    Defaults produce a fast run (< 2 s on 50-op instances). For overnight
    tactical planning, increase ``population_size`` and
    ``num_generations``.
    """

    population_size: int = 30
    num_generations: int = 40
    crossover_rate: float = 0.8
    mutation_rate: float = 0.15
    elite_count: int = 2
    tournament_size: int = 2
    seed: int | None = 42

    def __post_init__(self) -> None:
        if self.population_size < 2:
            raise ValidationError("population_size must be >= 2")
        if self.num_generations < 1:
            raise ValidationError("num_generations must be >= 1")
        if not 0.0 <= self.crossover_rate <= 1.0:
            raise ValidationError("crossover_rate must be in [0, 1]")
        if not 0.0 <= self.mutation_rate <= 1.0:
            raise ValidationError("mutation_rate must be in [0, 1]")
        if self.elite_count < 0:
            raise ValidationError("elite_count must be >= 0")
        if self.elite_count >= self.population_size:
            raise ValidationError(
                "elite_count must be < population_size"
            )
        if self.tournament_size < 2:
            raise ValidationError("tournament_size must be >= 2")


class GeneticAlgorithmStrategy:
    """Population-based metaheuristic wrapping the greedy decoder.

    Parameters
    ----------
    options:
        Hyper-parameters. Defaults to :class:`GeneticAlgorithmOptions`.
    base_strategy:
        Injected greedy decoder. Defaults to a fresh :class:`GreedyStrategy`.
    """

    name = "ga"

    def __init__(
        self,
        *,
        options: GeneticAlgorithmOptions | None = None,
        base_strategy: GreedyStrategy | None = None,
    ) -> None:
        self._options = options or GeneticAlgorithmOptions()
        self._base = base_strategy or GreedyStrategy()

    def solve(
        self,
        context: SchedulingContext,
        objective: Objective,
    ) -> StrategyResult:
        started = time.perf_counter()
        opts = self._options
        rng = random.Random(opts.seed)

        # Step 1: seed with greedy baseline.
        initial = self._base.solve(context, objective)
        base_order = self._extract_order(initial.schedule)

        if len(base_order) < 2:
            return self._finalise(
                initial.schedule,
                initial.objective_value,
                started,
                evaluations=1,
                generations_run=0,
                context=context,
            )

        # Step 2: build initial population.
        # First individual = greedy baseline; rest are random shuffles.
        population: list[_Individual] = [
            _Individual(order=base_order, cost=initial.objective_value)
        ]
        evaluations = 1

        for _ in range(opts.population_size - 1):
            shuffled = list(base_order)
            rng.shuffle(shuffled)
            try:
                decoded = self._decode(context, objective, shuffled)
                population.append(
                    _Individual(order=shuffled, cost=decoded.objective_value)
                )
            except InfeasibleScheduleError:
                # Extremely rare with greedy decoder. Clone the baseline.
                population.append(
                    _Individual(order=list(base_order), cost=initial.objective_value)
                )
            evaluations += 1

        best = min(population, key=lambda ind: ind.cost)
        best_schedule = initial.schedule  # will be re-decoded at the end

        # Step 3: evolve.
        for _gen in range(opts.num_generations):
            # Sort by cost for elite selection.
            population.sort(key=lambda ind: ind.cost)

            # Elitism: carry over the best individuals unchanged.
            next_gen: list[_Individual] = population[: opts.elite_count]

            # Fill remaining slots via selection + crossover + mutation.
            while len(next_gen) < opts.population_size:
                parent_a = self._tournament_select(population, opts.tournament_size, rng)
                parent_b = self._tournament_select(population, opts.tournament_size, rng)

                if rng.random() < opts.crossover_rate:
                    child_order = self._order_crossover(
                        parent_a.order, parent_b.order, rng
                    )
                else:
                    child_order = list(parent_a.order)

                if rng.random() < opts.mutation_rate:
                    self._swap_mutate(child_order, rng)

                try:
                    decoded = self._decode(context, objective, child_order)
                    child = _Individual(
                        order=child_order, cost=decoded.objective_value
                    )
                except InfeasibleScheduleError:
                    child = _Individual(
                        order=child_order, cost=parent_a.cost
                    )
                evaluations += 1
                next_gen.append(child)

            population = next_gen

            gen_best = min(population, key=lambda ind: ind.cost)
            if gen_best.cost < best.cost:
                best = gen_best

        # Re-decode the best individual to get the actual schedule.
        try:
            final_decoded = self._decode(context, objective, best.order)
            best_schedule = final_decoded.schedule
            best_cost = final_decoded.objective_value
        except InfeasibleScheduleError:
            best_schedule = initial.schedule
            best_cost = initial.objective_value
        evaluations += 1

        return self._finalise(
            best_schedule,
            best_cost,
            started,
            evaluations=evaluations,
            generations_run=opts.num_generations,
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
    def _tournament_select(
        population: list[_Individual],
        tournament_size: int,
        rng: random.Random,
    ) -> _Individual:
        """Binary (or k-ary) tournament selection."""
        contestants = rng.sample(population, min(tournament_size, len(population)))
        return min(contestants, key=lambda ind: ind.cost)

    @staticmethod
    def _order_crossover(
        parent_a: list[str],
        parent_b: list[str],
        rng: random.Random,
    ) -> list[str]:
        """Order Crossover (OX).

        1. Select a random substring [start, end) from parent_a.
        2. Copy that substring to the child at the same position.
        3. Fill remaining positions with elements from parent_b in order,
           skipping those already in the child.
        """
        size = len(parent_a)
        start, end = sorted(rng.sample(range(size), 2))

        child: list[str | None] = [None] * size
        child[start:end] = parent_a[start:end]

        placed = set(parent_a[start:end])
        fill_order = [g for g in parent_b if g not in placed]

        fill_idx = 0
        for i in range(size):
            if child[i] is None:
                child[i] = fill_order[fill_idx]
                fill_idx += 1

        return child  # type: ignore[return-value]

    @staticmethod
    def _swap_mutate(order: list[str], rng: random.Random) -> None:
        """In-place swap mutation."""
        i, j = rng.sample(range(len(order)), 2)
        order[i], order[j] = order[j], order[i]

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
        generations_run: int,
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
                "generations": generations_run,
                "population_size": self._options.population_size,
                "crossover_rate": self._options.crossover_rate,
                "mutation_rate": self._options.mutation_rate,
                "elite_count": self._options.elite_count,
                "seed": self._options.seed,
            },
        )


@dataclass(slots=True)
class _Individual:
    """A single member of the GA population."""

    order: list[str]
    cost: int


register_strategy("ga", GeneticAlgorithmStrategy)
