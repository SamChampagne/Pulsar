"""Hybrid forward/backward scheduling strategy.

This strategy intentionally does not implement a third placement algorithm.
It runs the two production heuristic postures already supported by the engine:

- forward greedy dispatching for fast earliest-feasible placement;
- backward greedy scheduling for just-in-time due-date pressure.

The best result by objective value is returned with diagnostics that explain
which posture won. This gives planners a stable "try both operational modes"
entrypoint without duplicating solver logic.
"""

from __future__ import annotations

import time

from ..errors import InfeasibleScheduleError
from .context import SchedulingContext
from .objective import Objective
from .strategy import StrategyResult, register_strategy, resolve_strategy


class HybridForwardBackwardStrategy:
    """Run forward and backward heuristics, then keep the best objective."""

    name = "hybrid"

    def solve(
        self,
        context: SchedulingContext,
        objective: Objective,
    ) -> StrategyResult:
        started = time.perf_counter()
        results: list[tuple[str, StrategyResult]] = []
        failures: list[tuple[str, str]] = []

        for label, strategy_name in (
            ("forward_greedy", "greedy"),
            ("backward_jit", "backward"),
        ):
            try:
                result = resolve_strategy(strategy_name).solve(context, objective)
            except InfeasibleScheduleError as exc:
                failures.append((label, str(exc)))
                continue
            results.append((label, result))

        if not results:
            # Re-run the forward strategy so callers receive its structured
            # infeasibility report instead of a generic hybrid failure.
            resolve_strategy("greedy").solve(context, objective)

        winner_label, winner = min(results, key=lambda item: item[1].objective_value)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return StrategyResult(
            schedule=winner.schedule,
            objective_value=winner.objective_value,
            strategy_name=self.name,
            wall_time_ms=elapsed_ms,
            solver_status=winner.solver_status,
            diagnostics={
                **dict(winner.diagnostics),
                "hybrid_mode": "forward_backward",
                "winner": winner_label,
                "winner_strategy": winner.strategy_name,
                "winner_objective": winner.objective_value,
                "num_runs": len(results),
                "num_failures": len(failures),
                "all_runs": [
                    {
                        "label": label,
                        "strategy": result.strategy_name,
                        "objective_value": result.objective_value,
                        "solver_status": result.solver_status,
                        "wall_time_ms": result.wall_time_ms,
                    }
                    for label, result in results
                ],
                "failures": [
                    {"label": label, "error": error}
                    for label, error in failures
                ],
            },
        )


register_strategy("hybrid", HybridForwardBackwardStrategy)
