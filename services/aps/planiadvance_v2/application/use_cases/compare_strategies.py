"""Use case: compare multiple scheduling strategies side-by-side.

What-if analysis is a core capability of any industrial APS: the planner
wants to know whether running CP-SAT for 30 seconds would beat the fast
greedy by enough to justify the extra wait, or whether a backward pass
would reduce inventory without missing any due dates.

This use case runs several strategies on *the same* context and returns
a ranked summary — no persistence, no side effects. Individual runs are
guaranteed to be independent: a failure in one strategy (e.g. CP-SAT
time-out or OR-Tools missing) does not abort the others; the failure is
captured as a :class:`StrategyComparison` entry with
``solver_status == "error"`` and the relevant message.

The strategies can run either sequentially (``parallel=False``) or in
a :class:`ThreadPoolExecutor` (``parallel=True``, the default). Parallel
execution is the right choice in production: CP-SAT releases the GIL
from its C++ solver, SA is I/O-bound (just math + allocations) and the
greedy strategies are fast enough that a few extra threads cost nothing.
For unit tests or for debugging a single strategy, sequential mode is
easier to trace.

The returned output is deliberately minimal (scores + metrics + wall
times) so the caller can render a comparison table. The actual schedules
are also included so the planner can drill down into any candidate.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ...domain.entities import Schedule
from ...domain.errors import InfeasibleScheduleError, ValidationError
from ...domain.scheduling import (
    InfeasibilityReport,
    Objective,
    SchedulingContext,
    compute_metrics,
    get_strategy_profile,
    resolve_strategy,
)
from ...domain.value_objects import TransferTimes
from ..ports import (
    CalendarRepository,
    InventoryRepository,
    MachineRepository,
    ResourceRepository,
    ScheduleRepository,
    ScheduleRunMetadata,
    SupplyRepository,
    WorkOrderRepository,
)
from .planner_diagnostics import enrich_planner_diagnostics
from .planner_exceptions import build_planner_exceptions
from .planning_decision_layer import select_planning_decision
from .planning_validation_gate import (
    enforce_planning_validation_gate,
    validate_schedule_scope,
)
from .result_summary import SchedulingSummary, build_schedule_summary
from .stability_report import build_stability_report
from .tenant_scope import list_scoped

_FAILURE_LABELS: dict[str, str] = {
    "resource_capacity": "Resource capacity",
    "machine_overloaded": "Machine overload",
    "calendar_too_tight": "Calendar window",
    "horizon_too_short": "Planning horizon",
    "dependency_window": "Dependency window",
    "dependency_max_wait": "Dependency max-wait",
    "custom_constraint": "Custom rule",
    "due_date_unreachable": "Due-date risk",
    "no_eligible_machine": "Machine eligibility",
    "dependency_not_ready": "Dependency readiness",
}


def _metrics_from_metadata(metadata: ScheduleRunMetadata | None) -> dict | None:
    if metadata is None:
        return None
    return metadata.metrics


def _planner_exceptions_from_metadata(
    metadata: ScheduleRunMetadata | None,
) -> dict | None:
    if metadata is None:
        return None
    exceptions = metadata.diagnostics.get("planner_exceptions")
    return exceptions if isinstance(exceptions, dict) else None


def _failure_label(kind: str | None) -> str | None:
    if kind is None:
        return None
    return _FAILURE_LABELS.get(kind, kind.replace("_", " ").capitalize())


@dataclass(slots=True)
class CompareStrategiesInput:
    strategies: list[str]
    horizon_start: datetime | None = None
    horizon_days: int = 30
    objective: Objective = field(default_factory=Objective.default)
    transfer_times: TransferTimes = field(default_factory=TransferTimes)
    parallel: bool = True
    max_workers: int | None = None
    baseline_schedule_id: str | None = None
    organization_id: str | None = None
    workspace_id: str | None = None


def _disruption_recommendation_rank(profile: dict[str, object] | None) -> int:
    if not isinstance(profile, dict):
        return 99
    mode = profile.get("planning_mode")
    if mode == "online_dispatch":
        return 0
    if mode == "repair_search":
        return 1
    if mode == "just_in_time":
        return 2
    return 10


@dataclass(slots=True)
class StrategyComparison:
    """Result of a single strategy run within a comparison."""

    strategy: str
    solver_status: str
    objective_value: int | None
    wall_time_ms: int
    metrics: dict
    schedule: Schedule | None
    diagnostics: dict
    summary: SchedulingSummary | None = None
    infeasibility: InfeasibilityReport | None = None
    profile: dict[str, object] | None = None
    error: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.schedule is not None and self.solver_status not in {
            "error",
            "infeasible",
        }


@dataclass(slots=True)
class ComparisonSummary:
    best_strategy: str | None
    fastest_strategy: str | None
    successful_runs: int
    most_stable_strategy: str | None = None
    shortest_makespan_strategy: str | None = None
    lowest_lateness_strategy: str | None = None
    best_on_time_ratio_strategy: str | None = None
    failed_strategies: list[str] = field(default_factory=list)
    infeasible_strategies: list[str] = field(default_factory=list)
    error_strategies: list[str] = field(default_factory=list)
    objective_spread: int | None = None
    dominant_failure_kind: str | None = None
    next_best_recovery_action: str | None = None
    planner_focus: str | None = None
    qualified_strategies: list[str] = field(default_factory=list)
    experimental_strategies: list[str] = field(default_factory=list)
    recommended_for_disruption: str | None = None
    recommended_for_what_if: str | None = None
    recommended_for_just_in_time: str | None = None
    qualification_highlights: list[str] = field(default_factory=list)
    qualification_cards: list[dict[str, object]] = field(default_factory=list)
    highlights: list[str] = field(default_factory=list)
    tradeoff_cards: list[dict[str, object]] = field(default_factory=list)
    failure_cards: list[dict[str, object]] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "best_strategy": self.best_strategy,
            "fastest_strategy": self.fastest_strategy,
            "successful_runs": self.successful_runs,
            "most_stable_strategy": self.most_stable_strategy,
            "shortest_makespan_strategy": self.shortest_makespan_strategy,
            "lowest_lateness_strategy": self.lowest_lateness_strategy,
            "best_on_time_ratio_strategy": self.best_on_time_ratio_strategy,
            "failed_strategies": list(self.failed_strategies),
            "infeasible_strategies": list(self.infeasible_strategies),
            "error_strategies": list(self.error_strategies),
            "objective_spread": self.objective_spread,
            "dominant_failure_kind": self.dominant_failure_kind,
            "next_best_recovery_action": self.next_best_recovery_action,
            "planner_focus": self.planner_focus,
            "qualified_strategies": list(self.qualified_strategies),
            "experimental_strategies": list(self.experimental_strategies),
            "recommended_for_disruption": self.recommended_for_disruption,
            "recommended_for_what_if": self.recommended_for_what_if,
            "recommended_for_just_in_time": self.recommended_for_just_in_time,
            "qualification_highlights": list(self.qualification_highlights),
            "qualification_cards": list(self.qualification_cards),
            "highlights": list(self.highlights),
            "tradeoff_cards": list(self.tradeoff_cards),
            "failure_cards": list(self.failure_cards),
        }


@dataclass(slots=True)
class CompareStrategiesOutput:
    """Ranked side-by-side comparison of multiple strategies."""

    runs: list[StrategyComparison]

    @property
    def best(self) -> StrategyComparison | None:
        """The successful run with the lowest objective value, or ``None``.

        Ties are broken by wall time (faster first) and then by the
        natural ordering of strategy names, for determinism.
        """
        successful = [r for r in self.runs if r.succeeded and r.objective_value is not None]
        if not successful:
            return None
        successful.sort(
            key=lambda r: (r.objective_value, r.wall_time_ms, r.strategy)
        )
        return successful[0]

    @property
    def summary(self) -> ComparisonSummary:
        successful = [r for r in self.runs if r.succeeded and r.objective_value is not None]
        fastest = min(successful, key=lambda r: (r.wall_time_ms, r.strategy)) if successful else None
        best = self.best
        failed = [r.strategy for r in self.runs if not r.succeeded]
        infeasible = [
            r.strategy for r in self.runs if r.solver_status == "infeasible"
        ]
        errors = [r.strategy for r in self.runs if r.solver_status == "error"]
        shortest_makespan: StrategyComparison | None = None
        lowest_lateness: StrategyComparison | None = None
        best_on_time_ratio: StrategyComparison | None = None
        most_stable: StrategyComparison | None = None

        objective_spread: int | None = None
        if successful:
            values = [r.objective_value for r in successful if r.objective_value is not None]
            if values:
                objective_spread = max(values) - min(values)
            makespan_runs = [
                r for r in successful if isinstance(r.metrics.get("makespan_minutes"), int)
            ]
            if makespan_runs:
                shortest_makespan = min(
                    makespan_runs,
                    key=lambda r: (r.metrics["makespan_minutes"], r.wall_time_ms, r.strategy),
                )
            lateness_runs = [
                r
                for r in successful
                if isinstance(r.metrics.get("total_lateness_minutes"), int)
            ]
            if lateness_runs:
                lowest_lateness = min(
                    lateness_runs,
                    key=lambda r: (
                        r.metrics["total_lateness_minutes"],
                        r.wall_time_ms,
                        r.strategy,
                    ),
                )
            on_time_runs = [
                r
                for r in successful
                if isinstance(r.metrics.get("on_time_ratio"), (int, float))
            ]
            if on_time_runs:
                best_on_time_ratio = max(
                    on_time_runs,
                    key=lambda r: (
                        float(r.metrics["on_time_ratio"]),
                        -r.wall_time_ms,
                        r.strategy,
                    ),
                )
            stability_runs = [
                r
                for r in successful
                if isinstance(r.metrics.get("stability"), dict)
                and isinstance(r.metrics["stability"].get("stability_ratio"), (int, float))
            ]
            if stability_runs:
                most_stable = max(
                    stability_runs,
                    key=lambda r: (
                        float(r.metrics["stability"]["stability_ratio"]),
                        -int(r.metrics["stability"].get("unchanged_operation_count", 0)),
                        -r.wall_time_ms,
                        r.strategy,
                    ),
                )

        highlights: list[str] = []
        tradeoff_cards: list[dict[str, object]] = []
        failure_cards: list[dict[str, object]] = []
        qualification_highlights: list[str] = []
        qualification_cards: list[dict[str, object]] = []
        failure_kinds: list[str] = []
        recovery_actions: list[str] = []
        planner_focuses: list[str] = []
        best_production_run: StrategyComparison | None = None
        qualified_strategies = [
            r.strategy
            for r in self.runs
            if isinstance(r.profile, dict)
            and r.profile.get("maturity") in {"production", "specialized"}
        ]
        experimental_strategies = [
            r.strategy
            for r in self.runs
            if isinstance(r.profile, dict)
            and r.profile.get("maturity") == "experimental"
        ]
        disruption_candidates = [
            r
            for r in successful
            if isinstance(r.profile, dict)
            and r.profile.get("recommended_for_disruption") is True
        ]
        just_in_time_candidates = [
            r
            for r in successful
            if isinstance(r.profile, dict)
            and r.profile.get("planning_mode") == "just_in_time"
        ]
        production_candidates = [
            r
            for r in successful
            if isinstance(r.profile, dict)
            and r.profile.get("maturity") == "production"
        ]
        if production_candidates:
            best_production_run = min(
                production_candidates,
                key=lambda r: (
                    r.objective_value if r.objective_value is not None else 10**9,
                    r.wall_time_ms,
                    r.strategy,
                ),
            )
            dominated_production = [
                r
                for r in production_candidates
                if best_production_run.objective_value is not None
                and r.strategy != best_production_run.strategy
                and r.objective_value is not None
                and best_production_run.objective_value < r.objective_value
                and (
                    not isinstance(best_production_run.metrics.get("makespan_minutes"), int)
                    or not isinstance(r.metrics.get("makespan_minutes"), int)
                    or best_production_run.metrics["makespan_minutes"]
                    <= r.metrics["makespan_minutes"]
                )
            ]
            if dominated_production:
                laggard = max(
                    dominated_production,
                    key=lambda r: (
                        r.objective_value if r.objective_value is not None else -1,
                        r.strategy,
                    ),
                )
                qualification_highlights.append(
                    f"{best_production_run.strategy} is the stronger operational default here, outperforming {laggard.strategy} on both objective and schedule shape."
                )
                qualification_cards.append(
                    {
                        "context": "operational_default",
                        "recommended_strategy": best_production_run.strategy,
                        "label": "Operational default",
                        "reason": (
                            f"{best_production_run.strategy} beats {laggard.strategy} among production strategies on this scenario."
                        ),
                        "evidence": {
                            "reference_strategy": laggard.strategy,
                            "objective_gap": (
                                laggard.objective_value - best_production_run.objective_value
                            ),
                            "makespan_delta": (
                                laggard.metrics.get("makespan_minutes", 0)
                                - best_production_run.metrics.get("makespan_minutes", 0)
                            ),
                        },
                    }
                )
        recommended_for_disruption = (
            min(
                disruption_candidates,
                key=lambda r: (
                    _disruption_recommendation_rank(r.profile),
                    r.wall_time_ms,
                    r.objective_value if r.objective_value is not None else 10**9,
                    r.strategy,
                ),
            ).strategy
            if disruption_candidates
            else None
        )
        what_if_candidates = [
            r
            for r in successful
            if isinstance(r.profile, dict)
            and r.profile.get("planning_mode") == "strategic_what_if"
        ]
        recommended_for_what_if = (
            min(
                what_if_candidates,
                key=lambda r: (
                    r.objective_value if r.objective_value is not None else 10**9,
                    r.wall_time_ms,
                    r.strategy,
                ),
            ).strategy
            if what_if_candidates
            else (best.strategy if best is not None else None)
        )
        recommended_for_just_in_time = None
        if just_in_time_candidates and best_production_run is not None:
            best_jit_run = min(
                just_in_time_candidates,
                key=lambda r: (
                    r.objective_value if r.objective_value is not None else 10**9,
                    r.wall_time_ms,
                    r.strategy,
                ),
            )
            if (
                best_jit_run.metrics.get("total_lateness_minutes")
                == best_production_run.metrics.get("total_lateness_minutes")
                and best_jit_run.metrics.get("on_time_ratio")
                == best_production_run.metrics.get("on_time_ratio")
            ):
                recommended_for_just_in_time = best_jit_run.strategy
        if best is not None:
            highlights.append(
                f"Best strategy is {best.strategy} with objective {best.objective_value}."
            )
            tradeoff_cards.append(
                {
                    "dimension": "objective",
                    "winner_strategy": best.strategy,
                    "winner_value": best.objective_value,
                    "label": "Best weighted objective",
                    "reason": (
                        f"{best.strategy} delivers the best overall score on the configured objective."
                    ),
                }
            )
        if fastest is not None:
            highlights.append(
                f"Fastest successful strategy is {fastest.strategy} in {fastest.wall_time_ms} ms."
            )
            tradeoff_cards.append(
                {
                    "dimension": "wall_time",
                    "winner_strategy": fastest.strategy,
                    "winner_value": fastest.wall_time_ms,
                    "label": "Fastest runtime",
                    "reason": f"{fastest.strategy} returns the quickest answer.",
                }
            )
        if most_stable is not None:
            stability = (
                most_stable.metrics.get("stability")
                if isinstance(most_stable.metrics.get("stability"), dict)
                else {}
            )
            highlights.append(
                f"Most stable strategy is {most_stable.strategy} with {stability.get('unchanged_operation_count', 0)} unchanged operation(s) versus baseline."
            )
            tradeoff_cards.append(
                {
                    "dimension": "stability",
                    "winner_strategy": most_stable.strategy,
                    "winner_value": stability.get("stability_ratio"),
                    "label": "Most stable plan",
                    "reason": (
                        f"{most_stable.strategy} preserves the most of the baseline schedule."
                    ),
                }
            )
        if (
            best is not None
            and fastest is not None
            and best.strategy != fastest.strategy
        ):
            highlights.append(
                f"{best.strategy} gives the best score, while {fastest.strategy} is the fastest option."
            )
        if failed:
            highlights.append(
                f"{len(failed)} strategy(ies) failed or were infeasible: {', '.join(failed[:3])}."
            )
        if infeasible:
            highlights.append(
                f"Infeasible under current constraints: {', '.join(infeasible[:3])}."
            )
        if errors:
            highlights.append(
                f"Execution error on: {', '.join(errors[:3])}."
            )
        if shortest_makespan is not None:
            highlights.append(
                "Shortest makespan comes from "
                f"{shortest_makespan.strategy} at "
                f"{shortest_makespan.metrics['makespan_minutes']} minutes."
            )
            tradeoff_cards.append(
                {
                    "dimension": "makespan",
                    "winner_strategy": shortest_makespan.strategy,
                    "winner_value": shortest_makespan.metrics["makespan_minutes"],
                    "label": "Shortest makespan",
                    "reason": (
                        f"{shortest_makespan.strategy} finishes the overall plan earliest."
                    ),
                }
            )
        if lowest_lateness is not None:
            highlights.append(
                "Lowest lateness comes from "
                f"{lowest_lateness.strategy} at "
                f"{lowest_lateness.metrics['total_lateness_minutes']} minutes."
            )
            tradeoff_cards.append(
                {
                    "dimension": "lateness",
                    "winner_strategy": lowest_lateness.strategy,
                    "winner_value": lowest_lateness.metrics["total_lateness_minutes"],
                    "label": "Lowest lateness",
                    "reason": (
                        f"{lowest_lateness.strategy} best protects due-date performance."
                    ),
                }
            )
        if best_on_time_ratio is not None:
            ratio = round(float(best_on_time_ratio.metrics["on_time_ratio"]), 4)
            highlights.append(
                f"Best on-time ratio comes from {best_on_time_ratio.strategy} at {ratio}."
            )
            tradeoff_cards.append(
                {
                    "dimension": "on_time_ratio",
                    "winner_strategy": best_on_time_ratio.strategy,
                    "winner_value": ratio,
                    "label": "Best on-time ratio",
                    "reason": (
                        f"{best_on_time_ratio.strategy} keeps the highest share of work orders on time."
                    ),
                }
            )
        if objective_spread is not None:
            highlights.append(f"Objective spread across successful runs is {objective_spread}.")
        if recommended_for_disruption is not None:
            qualification_highlights.append(
                f"{recommended_for_disruption} is the safest successful strategy for disruption handling."
            )
            disruption_run = next(
                r for r in successful if r.strategy == recommended_for_disruption
            )
            qualification_cards.append(
                {
                    "context": "disruption",
                    "recommended_strategy": recommended_for_disruption,
                    "label": "Operational replanning",
                    "reason": (
                        f"{recommended_for_disruption} is qualified for rolling-horizon disruption flows and succeeded on this scenario."
                    ),
                    "evidence": {
                        "wall_time_ms": disruption_run.wall_time_ms,
                        "objective_value": disruption_run.objective_value,
                        "solver_status": disruption_run.solver_status,
                        "reference_strategy": (
                            best_production_run.strategy
                            if best_production_run is not None
                            else None
                        ),
                    },
                }
            )
        if recommended_for_what_if is not None:
            what_if_run = next(
                r for r in successful if r.strategy == recommended_for_what_if
            )
            objective_gap_vs_operational = None
            makespan_delta_vs_operational = None
            if (
                best_production_run is not None
                and what_if_run.objective_value is not None
                and best_production_run.objective_value is not None
            ):
                objective_gap_vs_operational = (
                    best_production_run.objective_value - what_if_run.objective_value
                )
            if (
                best_production_run is not None
                and isinstance(what_if_run.metrics.get("makespan_minutes"), int)
                and isinstance(best_production_run.metrics.get("makespan_minutes"), int)
            ):
                makespan_delta_vs_operational = (
                    best_production_run.metrics["makespan_minutes"]
                    - what_if_run.metrics["makespan_minutes"]
                )
            qualification_highlights.append(
                f"{recommended_for_what_if} is the strongest candidate for strategic what-if analysis here."
            )
            if (
                objective_gap_vs_operational is not None
                and objective_gap_vs_operational > 0
                and best_production_run is not None
            ):
                qualification_highlights.append(
                    f"{recommended_for_what_if} improves objective by {objective_gap_vs_operational} versus best operational strategy {best_production_run.strategy}."
                )
            qualification_cards.append(
                {
                    "context": "what_if",
                    "recommended_strategy": recommended_for_what_if,
                    "label": "Strategic what-if",
                    "reason": (
                        f"{recommended_for_what_if} is the best fit for deeper optimization or exact study on this scenario."
                    ),
                    "evidence": {
                        "objective_value": what_if_run.objective_value,
                        "wall_time_ms": what_if_run.wall_time_ms,
                        "reference_strategy": (
                            best_production_run.strategy
                            if best_production_run is not None
                            else None
                        ),
                        "objective_gap_vs_best_operational": objective_gap_vs_operational,
                        "makespan_delta_vs_best_operational": makespan_delta_vs_operational,
                    },
                }
            )
        if recommended_for_just_in_time is not None:
            just_in_time_run = next(
                r for r in successful if r.strategy == recommended_for_just_in_time
            )
            qualification_highlights.append(
                f"{recommended_for_just_in_time} is the cleanest just-in-time option here without sacrificing due-date service."
            )
            qualification_cards.append(
                {
                    "context": "just_in_time",
                    "recommended_strategy": recommended_for_just_in_time,
                    "label": "Low-WIP / just-in-time",
                    "reason": (
                        f"{recommended_for_just_in_time} preserves due-date service while following a just-in-time planning mode."
                    ),
                    "evidence": {
                        "objective_value": just_in_time_run.objective_value,
                        "wall_time_ms": just_in_time_run.wall_time_ms,
                        "reference_strategy": (
                            best_production_run.strategy
                            if best_production_run is not None
                            else None
                        ),
                        "objective_gap_vs_best_operational": (
                            (
                                just_in_time_run.objective_value
                                - best_production_run.objective_value
                            )
                            if (
                                best_production_run is not None
                                and just_in_time_run.objective_value is not None
                                and best_production_run.objective_value is not None
                            )
                            else None
                        ),
                        "lateness_gap_vs_best_operational": (
                            just_in_time_run.metrics.get("total_lateness_minutes", 0)
                            - best_production_run.metrics.get("total_lateness_minutes", 0)
                        ),
                        "on_time_ratio_gap_vs_best_operational": round(
                            float(just_in_time_run.metrics.get("on_time_ratio", 0.0))
                            - float(best_production_run.metrics.get("on_time_ratio", 0.0)),
                            4,
                        ),
                    },
                }
            )
        if experimental_strategies:
            qualification_highlights.append(
                f"Experimental strategies in this comparison: {', '.join(experimental_strategies[:3])}."
            )
        if qualified_strategies:
            qualification_highlights.append(
                f"Qualified strategies available here: {', '.join(qualified_strategies[:3])}."
            )

        for failed_run in [r for r in self.runs if not r.succeeded]:
            blocked_operation = None
            blocker_kind = None
            blocker_message = None
            blocker_constraint_name = None
            first_suggestion = None
            planner_focus = None
            if (
                failed_run.infeasibility is not None
                and failed_run.infeasibility.operations
            ):
                first_op = failed_run.infeasibility.operations[0]
                blocked_operation = first_op.operation_id
                blocker_kind = failed_run.infeasibility.dominant_blocker_kind
                if first_op.blockers:
                    preferred = next(
                        (
                            blocker
                            for blocker in first_op.blockers
                            if blocker.kind.value == blocker_kind
                        ),
                        first_op.blockers[0],
                    )
                    blocker_message = preferred.message
                    blocker_constraint_name = preferred.constraint_name
                first_suggestion = failed_run.infeasibility.next_best_action
                planner_focus = failed_run.infeasibility.planner_focus
                if blocker_kind:
                    failure_kinds.append(blocker_kind)
                if first_suggestion:
                    recovery_actions.append(first_suggestion)
                if planner_focus:
                    planner_focuses.append(planner_focus)
            failure_cards.append(
                {
                    "strategy": failed_run.strategy,
                    "solver_status": failed_run.solver_status,
                    "blocked_operation": blocked_operation,
                    "dominant_blocker_kind": blocker_kind,
                    "dominant_blocker_label": _failure_label(blocker_kind),
                    "dominant_blocker_message": blocker_message,
                    "dominant_blocker_constraint_name": blocker_constraint_name,
                    "suggested_action": first_suggestion,
                    "planner_focus": planner_focus,
                    "recovery_mode": (
                        "repair_then_retry"
                        if failed_run.solver_status == "infeasible"
                        else "inspect_solver_or_inputs"
                    ),
                    "error": failed_run.error,
                }
            )

        dominant_failure_kind = failure_kinds[0] if failure_kinds else None
        next_best_recovery_action = recovery_actions[0] if recovery_actions else None
        planner_focus = planner_focuses[0] if planner_focuses else None
        if dominant_failure_kind is not None:
            highlights.append(
                f"Dominant failure mode is {_failure_label(dominant_failure_kind)}."
            )
        if next_best_recovery_action is not None:
            highlights.append(
                f"Next best recovery action: {next_best_recovery_action}"
            )

        return ComparisonSummary(
            best_strategy=best.strategy if best else None,
            fastest_strategy=fastest.strategy if fastest else None,
            successful_runs=len(successful),
            most_stable_strategy=most_stable.strategy if most_stable else None,
            shortest_makespan_strategy=(
                shortest_makespan.strategy if shortest_makespan else None
            ),
            lowest_lateness_strategy=(
                lowest_lateness.strategy if lowest_lateness else None
            ),
            best_on_time_ratio_strategy=(
                best_on_time_ratio.strategy if best_on_time_ratio else None
            ),
            failed_strategies=failed,
            infeasible_strategies=infeasible,
            error_strategies=errors,
            objective_spread=objective_spread,
            dominant_failure_kind=dominant_failure_kind,
            next_best_recovery_action=next_best_recovery_action,
            planner_focus=planner_focus,
            qualified_strategies=qualified_strategies,
            experimental_strategies=experimental_strategies,
            recommended_for_disruption=recommended_for_disruption,
            recommended_for_what_if=recommended_for_what_if,
            recommended_for_just_in_time=recommended_for_just_in_time,
            qualification_highlights=qualification_highlights[:4],
            qualification_cards=qualification_cards[:4],
            highlights=highlights[:6],
            tradeoff_cards=tradeoff_cards[:5],
            failure_cards=failure_cards[:5],
        )

    def as_dict(self) -> dict:
        return {
            "runs": [
                {
                    "strategy": r.strategy,
                    "solver_status": r.solver_status,
                    "objective_value": r.objective_value,
                    "wall_time_ms": r.wall_time_ms,
                    "metrics": r.metrics,
                    "diagnostics": r.diagnostics,
                    "profile": r.profile,
                    "error": r.error,
                    "infeasibility": (
                        r.infeasibility.as_dict() if r.infeasibility else None
                    ),
                }
                for r in self.runs
            ],
            "best": self.best.strategy if self.best else None,
            "summary": self.summary.as_dict(),
        }


class CompareStrategies:
    """Run several strategies on the same context and return the ranked results."""

    def __init__(
        self,
        *,
        work_orders: WorkOrderRepository,
        machines: MachineRepository,
        calendars: CalendarRepository,
        resources: ResourceRepository | None = None,
        inventory: InventoryRepository | None = None,
        supplies: SupplyRepository | None = None,
        schedules: ScheduleRepository | None = None,
    ) -> None:
        self._work_orders = work_orders
        self._machines = machines
        self._calendars = calendars
        self._resources = resources
        self._inventory = inventory
        self._supplies = supplies
        self._schedules = schedules

    def execute(self, command: CompareStrategiesInput) -> CompareStrategiesOutput:
        if not command.strategies:
            raise ValidationError("At least one strategy is required")
        # Drop duplicates while preserving order so a user asking for
        # ["greedy","greedy","cpsat"] gets ["greedy","cpsat"] and avoids
        # paying the cost twice.
        seen: set[str] = set()
        unique_strategies: list[str] = []
        for s in command.strategies:
            key = s.lower().strip()
            if key and key not in seen:
                seen.add(key)
                unique_strategies.append(key)

        horizon_start = command.horizon_start or datetime.utcnow().replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        horizon_end = horizon_start + timedelta(days=command.horizon_days)

        # Build the context ONCE so every strategy sees exactly the same
        # inputs — otherwise the comparison would be meaningless.
        resources = (
            list_scoped(self._resources, command.organization_id, command.workspace_id)
            if self._resources is not None
            else []
        )
        inventory_items = (
            list_scoped(self._inventory, command.organization_id, command.workspace_id)
            if self._inventory is not None
            else []
        )
        supplies = (
            list_scoped(self._supplies, command.organization_id, command.workspace_id)
            if self._supplies is not None
            else []
        )

        baseline_schedule = None
        baseline_metadata = None
        if command.baseline_schedule_id is not None:
            if self._schedules is None:
                raise ValidationError(
                    "Baseline schedule lookup requires a schedule repository"
                )
            baseline_schedule = self._schedules.get(command.baseline_schedule_id)
            if baseline_schedule is None:
                raise ValidationError(
                    f"Baseline schedule {command.baseline_schedule_id!r} not found"
                )
            baseline_metadata = self._schedules.get_metadata(command.baseline_schedule_id)
            validate_schedule_scope(
                baseline_metadata,
                expected_organization_id=command.organization_id,
                schedule_id=command.baseline_schedule_id,
                label="Baseline",
            )
        context = SchedulingContext(
            horizon_start=horizon_start,
            horizon_end=horizon_end,
            work_orders=list_scoped(
                self._work_orders,
                command.organization_id,
                command.workspace_id,
            ),
            machines=list_scoped(
                self._machines,
                command.organization_id,
                command.workspace_id,
            ),
            calendars=list_scoped(
                self._calendars,
                command.organization_id,
                command.workspace_id,
            ),
            resources=resources,
            inventory_items=inventory_items,
            supplies=supplies,
            transfer_times=command.transfer_times,
            baseline_schedule=baseline_schedule,
        )
        validation_gate = enforce_planning_validation_gate(
            context,
            mode="strategy_comparison",
        )

        runs = self._dispatch(
            unique_strategies,
            context,
            command.objective,
            horizon_start,
            horizon_end,
            feasibility=validation_gate.feasibility,
            baseline_schedule=baseline_schedule,
            baseline_metadata=baseline_metadata,
            parallel=command.parallel,
            max_workers=command.max_workers,
        )
        return CompareStrategiesOutput(runs=runs)

    def _dispatch(
        self,
        strategy_names: list[str],
        context: SchedulingContext,
        objective: Objective,
        horizon_start: datetime,
        horizon_end: datetime,
        feasibility,
        baseline_schedule: Schedule | None,
        baseline_metadata: ScheduleRunMetadata | None,
        *,
        parallel: bool,
        max_workers: int | None,
    ) -> list[StrategyComparison]:
        """Execute every strategy and return results in input order.

        Sequential mode is trivial; the parallel mode uses a
        :class:`ThreadPoolExecutor` sized to ``max_workers`` (or the
        number of strategies when ``None``). The result list preserves
        the input order regardless of which strategy finishes first, so
        downstream code can rely on index-based access for deterministic
        tests and UI rendering.
        """
        if not parallel or len(strategy_names) < 2:
            return [
                self._run_one(
                    name,
                    context,
                    objective,
                    horizon_start,
                    horizon_end,
                    feasibility=feasibility,
                    baseline_schedule=baseline_schedule,
                    baseline_metadata=baseline_metadata,
                )
                for name in strategy_names
            ]

        workers = max_workers if max_workers and max_workers > 0 else len(strategy_names)
        workers = min(workers, len(strategy_names))
        results: list[StrategyComparison | None] = [None] * len(strategy_names)
        with ThreadPoolExecutor(
            max_workers=workers, thread_name_prefix="compare-strategies"
        ) as pool:
            futures = {
                pool.submit(
                    self._run_one,
                    name,
                    context,
                    objective,
                    horizon_start,
                    horizon_end,
                    feasibility,
                    baseline_schedule,
                    baseline_metadata,
                ): idx
                for idx, name in enumerate(strategy_names)
            }
            for future in futures:
                idx = futures[future]
                results[idx] = future.result()
        # Every slot was populated above; mypy/pyright still want help.
        return [r for r in results if r is not None]

    def _run_one(
        self,
        name: str,
        context: SchedulingContext,
        objective: Objective,
        horizon_start: datetime,
        horizon_end: datetime,
        feasibility,
        baseline_schedule: Schedule | None = None,
        baseline_metadata: ScheduleRunMetadata | None = None,
    ) -> StrategyComparison:
        planning_decision = select_planning_decision(
            requested_strategy=name,
            requested_reschedule_mode="reschedule_all",
            selected_reschedule_mode="reschedule_all",
            feasibility=feasibility,
            baseline_schedule_present=baseline_schedule is not None,
            lifecycle_status=(
                baseline_metadata.lifecycle_status
                if baseline_metadata is not None
                else "draft"
            ),
            planner_exceptions=_planner_exceptions_from_metadata(baseline_metadata),
            metrics=_metrics_from_metadata(baseline_metadata),
        )
        selected_name = planning_decision.selected_strategy
        profile = get_strategy_profile(selected_name)
        profile_payload = profile.as_dict() if profile is not None else None
        try:
            strategy = resolve_strategy(selected_name)
        except ValidationError as exc:
            return StrategyComparison(
                strategy=name,
                solver_status="error",
                objective_value=None,
                wall_time_ms=0,
                metrics={},
                schedule=None,
                diagnostics={},
                summary=None,
                profile=profile_payload,
                error=str(exc),
            )
        except ImportError as exc:
            return StrategyComparison(
                strategy=name,
                solver_status="error",
                objective_value=None,
                wall_time_ms=0,
                metrics={},
                schedule=None,
                diagnostics={},
                summary=None,
                profile=profile_payload,
                error=f"{name} strategy unavailable: {exc}",
            )

        try:
            result = strategy.solve(context, objective)
        except InfeasibleScheduleError as exc:
            diagnostics = {
                "decision_layer": planning_decision.as_dict(),
                "planner_exceptions": build_planner_exceptions(
                    infeasibility=exc.report,
                    diagnostics={},
                    metrics={},
                )
            }
            diagnostics["planner_diagnostics"] = {
                "language_version": "planner-v1",
                "strategy": selected_name,
                "decision_layer": diagnostics["decision_layer"],
                "exceptions": diagnostics["planner_exceptions"],
                "notes": [],
            }
            return StrategyComparison(
                strategy=name,
                solver_status="infeasible",
                objective_value=None,
                wall_time_ms=0,
                metrics={},
                schedule=None,
                diagnostics=diagnostics,
                summary=None,
                infeasibility=exc.report,
                profile=profile_payload,
                error=str(exc),
            )
        except Exception as exc:  # noqa: BLE001 — surfaces solver errors to the caller
            return StrategyComparison(
                strategy=name,
                solver_status="error",
                objective_value=None,
                wall_time_ms=0,
                metrics={},
                schedule=None,
                diagnostics={},
                summary=None,
                profile=profile_payload,
                error=f"{type(exc).__name__}: {exc}",
            )

        metrics = compute_metrics(
            result.schedule,
            context.work_orders,
            horizon_start=horizon_start,
            horizon_end=horizon_end,
            baseline_schedule=baseline_schedule,
        ).as_dict()
        diagnostics = enrich_planner_diagnostics(
            dict(result.diagnostics),
            metrics=metrics,
            strategy=result.strategy_name,
        )
        diagnostics["decision_layer"] = planning_decision.as_dict()
        if baseline_schedule is not None:
            diagnostics["stability_report"] = build_stability_report(
                schedule=result.schedule,
                baseline_schedule=baseline_schedule,
            )
        diagnostics["planner_exceptions"] = build_planner_exceptions(
            diagnostics=diagnostics,
            metrics=metrics,
        )
        planner = diagnostics.get("planner_diagnostics")
        if isinstance(planner, dict):
            planner["decision_layer"] = diagnostics["decision_layer"]
            planner["exceptions"] = diagnostics["planner_exceptions"]
        return StrategyComparison(
            strategy=result.strategy_name,
            solver_status=result.solver_status,
            objective_value=result.objective_value,
            wall_time_ms=result.wall_time_ms,
            metrics=metrics,
            schedule=result.schedule,
            diagnostics=diagnostics,
            summary=build_schedule_summary(
                schedule=result.schedule,
                metrics=metrics,
                diagnostics=diagnostics,
                work_orders=context.work_orders,
            ),
            profile=(
                get_strategy_profile(result.strategy_name).as_dict()
                if get_strategy_profile(result.strategy_name) is not None
                else profile_payload
            ),
        )
