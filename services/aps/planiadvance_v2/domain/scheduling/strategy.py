"""Pluggable scheduling strategies.

The V2.0 scheduler was a single greedy forward implementation. For an
industrial-grade engine we need to be able to swap the algorithm without
rewriting the callers — typical production deployments use:

- a fast **dispatching** strategy for on-line rescheduling (< 100 ms),
- a **metaheuristic** (tabu / SA / GRASP) for tactical planning,
- an **exact** CP-SAT strategy for strategic what-if studies.

A :class:`SchedulerStrategy` is a pure function of the context: given a
:class:`SchedulingContext` and an :class:`Objective`, return a
:class:`StrategyResult` (schedule + metadata). Strategies are stateless
and can be cached, serialized or parallelised freely.

The registry (:func:`resolve_strategy`) lets the API/CLI layer pick a
strategy by short name ("greedy", "cpsat", ...) without importing every
backend eagerly — critical for deployments where, for example, OR-Tools
is not installed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from ..entities import Schedule
from ..errors import ValidationError
from .context import SchedulingContext
from .objective import Objective


@dataclass(slots=True)
class StrategyResult:
    """Output of a scheduling strategy.

    Strategies return more than just a :class:`Schedule` so the caller can
    reason about *how* the plan was produced:

    - ``objective_value`` lets two strategies be compared head-to-head.
    - ``wall_time_ms`` feeds SLO dashboards.
    - ``solver_status`` exposes whether the run found an optimal solution,
      a feasible one, or timed out (CP-SAT terminology).
    - ``diagnostics`` is a free-form dict used by explainability UIs.
    """

    schedule: Schedule
    objective_value: int
    strategy_name: str
    wall_time_ms: int = 0
    solver_status: str = "feasible"
    diagnostics: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class StrategyProfile:
    """Planner-facing description of what a strategy is good at.

    This is not solver logic. It is a stable capability contract so the
    rest of the system can answer practical APS questions such as:

    - Is this strategy safe for disruption / rolling-horizon replanning?
    - Does it support preemption and frozen assignments?
    - Is it production-ready or still experimental?
    """

    name: str
    maturity: str
    planning_mode: str
    optimization_mode: str
    recommended_for_disruption: bool
    supports_secondary_resources: bool
    supports_transfer_times: bool
    supports_routings: bool
    supports_setup_matrix: bool
    supports_maintenance_windows: bool
    supports_preemption: bool
    supports_frozen_assignments: bool
    notes: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "maturity": self.maturity,
            "planning_mode": self.planning_mode,
            "optimization_mode": self.optimization_mode,
            "recommended_for_disruption": self.recommended_for_disruption,
            "supports_secondary_resources": self.supports_secondary_resources,
            "supports_transfer_times": self.supports_transfer_times,
            "supports_routings": self.supports_routings,
            "supports_setup_matrix": self.supports_setup_matrix,
            "supports_maintenance_windows": self.supports_maintenance_windows,
            "supports_preemption": self.supports_preemption,
            "supports_frozen_assignments": self.supports_frozen_assignments,
            "notes": list(self.notes),
        }


class SchedulerStrategy(Protocol):
    """The single contract every scheduling algorithm must implement."""

    name: str

    def solve(
        self,
        context: SchedulingContext,
        objective: Objective,
    ) -> StrategyResult: ...


# --------------------------------------------------------------------------
# Registry
# --------------------------------------------------------------------------

# Strategies register themselves lazily: the map stores **factories** rather
# than instances so that importing a strategy with a heavy dependency (e.g.
# OR-Tools) never fails at package import time. This matches how the
# ``heuristics`` module already works.
_REGISTRY: dict[str, _StrategyFactory] = {}
_PROFILE_REGISTRY: dict[str, StrategyProfile] = {
    "greedy": StrategyProfile(
        name="greedy",
        maturity="production",
        planning_mode="online_dispatch",
        optimization_mode="heuristic",
        recommended_for_disruption=True,
        supports_secondary_resources=True,
        supports_transfer_times=True,
        supports_routings=True,
        supports_setup_matrix=True,
        supports_maintenance_windows=True,
        supports_preemption=True,
        supports_frozen_assignments=True,
        notes=(
            "Fast default for shop-floor replanning.",
            "Best fit when planners need a robust answer immediately.",
        ),
    ),
    "backward": StrategyProfile(
        name="backward",
        maturity="production",
        planning_mode="just_in_time",
        optimization_mode="heuristic",
        recommended_for_disruption=True,
        supports_secondary_resources=True,
        supports_transfer_times=True,
        supports_routings=True,
        supports_setup_matrix=True,
        supports_maintenance_windows=True,
        supports_preemption=True,
        supports_frozen_assignments=True,
        notes=(
            "Useful when WIP reduction matters more than earliest-start packing.",
            "Can become infeasible earlier than forward greedy on very tight due dates.",
        ),
    ),
    "hybrid": StrategyProfile(
        name="hybrid",
        maturity="production",
        planning_mode="operational_portfolio",
        optimization_mode="forward_backward_heuristic",
        recommended_for_disruption=True,
        supports_secondary_resources=True,
        supports_transfer_times=True,
        supports_routings=True,
        supports_setup_matrix=True,
        supports_maintenance_windows=True,
        supports_preemption=True,
        supports_frozen_assignments=True,
        notes=(
            "Runs forward greedy and backward just-in-time, then keeps the best objective.",
            "Good default for due-date pressure and what-if scenarios where both postures are useful.",
        ),
    ),
    "cpsat": StrategyProfile(
        name="cpsat",
        maturity="specialized",
        planning_mode="strategic_what_if",
        optimization_mode="exact_or_near_exact",
        recommended_for_disruption=False,
        supports_secondary_resources=True,
        supports_transfer_times=True,
        supports_routings=True,
        supports_setup_matrix=True,
        supports_maintenance_windows=True,
        supports_preemption=False,
        supports_frozen_assignments=False,
        notes=(
            "Best suited to offline what-if studies and exact small/medium instances.",
            "Not the first choice for rolling-horizon disruption flows.",
        ),
    ),
    "infinite": StrategyProfile(
        name="infinite",
        maturity="specialized",
        planning_mode="rough_cut",
        optimization_mode="infinite_capacity_projection",
        recommended_for_disruption=False,
        supports_secondary_resources=False,
        supports_transfer_times=True,
        supports_routings=True,
        supports_setup_matrix=True,
        supports_maintenance_windows=True,
        supports_preemption=False,
        supports_frozen_assignments=False,
        notes=(
            "Fast rough-cut projection that ignores finite machine contention.",
            "Best fit for early CTP/date promise and capacity sanity checks before finite scheduling.",
        ),
    ),
    "sa": StrategyProfile(
        name="sa",
        maturity="experimental",
        planning_mode="tactical_search",
        optimization_mode="metaheuristic",
        recommended_for_disruption=False,
        supports_secondary_resources=True,
        supports_transfer_times=True,
        supports_routings=True,
        supports_setup_matrix=True,
        supports_maintenance_windows=True,
        supports_preemption=False,
        supports_frozen_assignments=False,
        notes=("Exploration-oriented strategy for tactical what-if comparison.",),
    ),
    "tabu": StrategyProfile(
        name="tabu",
        maturity="experimental",
        planning_mode="tactical_search",
        optimization_mode="metaheuristic",
        recommended_for_disruption=False,
        supports_secondary_resources=True,
        supports_transfer_times=True,
        supports_routings=True,
        supports_setup_matrix=True,
        supports_maintenance_windows=True,
        supports_preemption=False,
        supports_frozen_assignments=False,
        notes=("Search-heavy option for tactical comparison, not primary disruption path.",),
    ),
    "ga": StrategyProfile(
        name="ga",
        maturity="experimental",
        planning_mode="tactical_search",
        optimization_mode="metaheuristic",
        recommended_for_disruption=False,
        supports_secondary_resources=True,
        supports_transfer_times=True,
        supports_routings=True,
        supports_setup_matrix=True,
        supports_maintenance_windows=True,
        supports_preemption=False,
        supports_frozen_assignments=False,
        notes=("Population-based search, useful for experimentation rather than online use.",),
    ),
    "lns": StrategyProfile(
        name="lns",
        maturity="specialized",
        planning_mode="repair_search",
        optimization_mode="metaheuristic",
        recommended_for_disruption=False,
        supports_secondary_resources=True,
        supports_transfer_times=True,
        supports_routings=True,
        supports_setup_matrix=True,
        supports_maintenance_windows=True,
        supports_preemption=False,
        supports_frozen_assignments=False,
        notes=("Promising repair-oriented search, but still not the default shop-floor engine.",),
    ),
    "multi": StrategyProfile(
        name="multi",
        maturity="specialized",
        planning_mode="portfolio",
        optimization_mode="multi_start",
        recommended_for_disruption=False,
        supports_secondary_resources=True,
        supports_transfer_times=True,
        supports_routings=True,
        supports_setup_matrix=True,
        supports_maintenance_windows=True,
        supports_preemption=False,
        supports_frozen_assignments=False,
        notes=("Portfolio search for broad comparison, not the simplest operational path.",),
    ),
}


class _StrategyFactory(Protocol):
    def __call__(self) -> SchedulerStrategy: ...


def register_strategy(name: str, factory: _StrategyFactory) -> None:
    key = name.lower().strip()
    if not key:
        raise ValidationError("Strategy name cannot be empty")
    _REGISTRY[key] = factory


def available_strategies() -> list[str]:
    """Return the sorted list of strategy names currently registered."""
    return sorted(_REGISTRY)


def available_strategy_profiles() -> list[StrategyProfile]:
    return [
        _PROFILE_REGISTRY[name]
        for name in sorted(_PROFILE_REGISTRY)
    ]


def get_strategy_profile(name: str) -> StrategyProfile | None:
    return _PROFILE_REGISTRY.get(name.lower().strip())


def resolve_strategy(name: str) -> SchedulerStrategy:
    """Look up a strategy by short name.

    Raises :class:`ValidationError` if the name is unknown, and re-raises
    any import error triggered by the factory as a plain ``ImportError``
    (so e.g. "cpsat" selected without OR-Tools installed gives a clear
    message).
    """
    key = name.lower().strip()
    factory = _REGISTRY.get(key)
    if factory is None:
        raise ValidationError(
            f"Unknown scheduling strategy {name!r}. "
            f"Available: {available_strategies()}"
        )
    return factory()
