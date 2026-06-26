"""Multi-start strategy: run N strategies and keep the best.

Production APS systems rarely rely on a single algorithm. The standard
industrial pattern is to run several strategies (or the same strategy
with different random seeds) and pick the best result:

- **Cross-strategy**: run greedy, SA, tabu, GA, LNS in parallel and
  keep the winner. Each algorithm has different strengths, so the
  ensemble is more robust than any single one.
- **Multi-seed**: run the same metaheuristic (e.g. SA) with multiple
  random seeds. Because metaheuristics are stochastic, different seeds
  explore different regions of the search space.
- **Mixed**: combine both — run greedy + SA(seed=1) + SA(seed=2) +
  tabu(seed=3) + LNS.

This strategy wraps the pattern in a clean interface so callers get a
single :class:`StrategyResult` with diagnostics showing which run won
and how all runs compared.

The runs are sequential (Python GIL makes true parallelism tricky for
CPU-bound work), but the interface is ready for a thread-pool upgrade.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from ..errors import InfeasibleScheduleError, ValidationError
from .context import SchedulingContext
from .objective import Objective
from .strategy import StrategyResult, register_strategy, resolve_strategy


@dataclass(frozen=True, slots=True)
class MultiStartConfig:
    """Configuration for a single run in the multi-start ensemble.

    ``strategy_name``
        Name of the strategy to use (e.g. "greedy", "sa", "tabu").
    ``label``
        Human-readable label for diagnostics (e.g. "sa-seed-42").
        Defaults to ``strategy_name`` if not provided.
    """

    strategy_name: str
    label: str = ""

    def effective_label(self) -> str:
        return self.label or self.strategy_name


@dataclass(frozen=True, slots=True)
class MultiStartOptions:
    """Configuration for :class:`MultiStartStrategy`.

    ``configs``
        List of strategy configurations to run. Must have at least one.
    ``fallback_strategy``
        If all runs fail (raise InfeasibleScheduleError), fall back to
        this strategy as a last resort. Defaults to "greedy".
    """

    configs: tuple[MultiStartConfig, ...] = (
        MultiStartConfig(strategy_name="greedy", label="greedy"),
        MultiStartConfig(strategy_name="sa", label="sa"),
        MultiStartConfig(strategy_name="tabu", label="tabu"),
    )
    fallback_strategy: str = "greedy"

    def __post_init__(self) -> None:
        if not self.configs:
            raise ValidationError("MultiStartOptions must have at least one config")


class MultiStartStrategy:
    """Ensemble strategy: run N algorithms and keep the best.

    Parameters
    ----------
    options:
        Which strategies to run. Defaults to greedy + SA + tabu.
    """

    name = "multi"

    def __init__(
        self,
        *,
        options: MultiStartOptions | None = None,
    ) -> None:
        self._options = options or MultiStartOptions()

    def solve(
        self,
        context: SchedulingContext,
        objective: Objective,
    ) -> StrategyResult:
        started = time.perf_counter()
        opts = self._options

        results: list[tuple[str, StrategyResult]] = []
        failures: list[tuple[str, str]] = []

        for config in opts.configs:
            label = config.effective_label()
            try:
                strategy = resolve_strategy(config.strategy_name)
                result = strategy.solve(context, objective)
                results.append((label, result))
            except (InfeasibleScheduleError, Exception) as exc:  # noqa: BLE001
                failures.append((label, str(exc)))

        if not results:
            # All runs failed — try the fallback.
            strategy = resolve_strategy(opts.fallback_strategy)
            result = strategy.solve(context, objective)
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            return StrategyResult(
                schedule=result.schedule,
                objective_value=result.objective_value,
                strategy_name=self.name,
                wall_time_ms=elapsed_ms,
                solver_status=result.solver_status,
                diagnostics={
                    "winner": opts.fallback_strategy,
                    "all_runs": [],
                    "failures": failures,
                    "note": "all primary runs failed, used fallback",
                },
            )

        # Pick the best by objective value.
        best_label, best_result = min(results, key=lambda x: x[1].objective_value)

        elapsed_ms = int((time.perf_counter() - started) * 1000)

        run_summaries = [
            {
                "label": label,
                "objective_value": r.objective_value,
                "wall_time_ms": r.wall_time_ms,
                "solver_status": r.solver_status,
            }
            for label, r in results
        ]

        return StrategyResult(
            schedule=best_result.schedule,
            objective_value=best_result.objective_value,
            strategy_name=self.name,
            wall_time_ms=elapsed_ms,
            solver_status=best_result.solver_status,
            diagnostics={
                "winner": best_label,
                "winner_objective": best_result.objective_value,
                "num_runs": len(results),
                "num_failures": len(failures),
                "all_runs": run_summaries,
                "failures": failures,
            },
        )


register_strategy("multi", MultiStartStrategy)
