"""Planner decision layer for automatic strategy/mode selection.

This module intentionally does not duplicate solver logic. It consumes
planner-facing signals already produced by the engine and chooses which
existing strategy/mode should be used when callers request ``strategy="auto"``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ...domain.scheduling.feasibility import FeasibilityReport

AUTO_STRATEGY = "auto"


@dataclass(frozen=True, slots=True)
class PlanningDecision:
    requested_strategy: str
    selected_strategy: str
    requested_reschedule_mode: str
    selected_reschedule_mode: str
    engine_mode: str
    auto_selected: bool
    reason: str
    rules_triggered: tuple[str, ...] = ()
    recommended_actions: tuple[str, ...] = ()
    evidence: dict[str, object] = field(default_factory=dict)

    def as_dict(self) -> dict[str, object]:
        return {
            "version": "planning-decision-v1",
            "requested_strategy": self.requested_strategy,
            "selected_strategy": self.selected_strategy,
            "requested_reschedule_mode": self.requested_reschedule_mode,
            "selected_reschedule_mode": self.selected_reschedule_mode,
            "engine_mode": self.engine_mode,
            "auto_selected": self.auto_selected,
            "reason": self.reason,
            "rules_triggered": list(self.rules_triggered),
            "recommended_actions": list(self.recommended_actions),
            "evidence": dict(self.evidence),
            "operator_explanation": _operator_explanation(
                selected_strategy=self.selected_strategy,
                rules_triggered=self.rules_triggered,
                evidence=self.evidence,
            ),
        }


def normalize_reschedule_mode_for_decision(
    *,
    requested_strategy: str,
    requested_reschedule_mode: str,
    baseline_schedule_present: bool,
) -> str:
    """Pick a safer default reschedule mode before building the context."""

    strategy = requested_strategy.strip().lower()
    mode = requested_reschedule_mode.strip().lower()
    if strategy == AUTO_STRATEGY and baseline_schedule_present and mode == "reschedule_all":
        return "repair_local"
    return mode


def select_planning_decision(
    *,
    requested_strategy: str,
    requested_reschedule_mode: str,
    selected_reschedule_mode: str,
    feasibility: FeasibilityReport,
    baseline_schedule_present: bool = False,
    lifecycle_status: str = "draft",
    planner_exceptions: dict[str, Any] | None = None,
    metrics: dict[str, Any] | None = None,
) -> PlanningDecision:
    """Select a scheduling strategy/mode from existing planner signals."""

    normalized_strategy = requested_strategy.strip().lower()
    normalized_lifecycle = lifecycle_status.strip().lower()
    auto = normalized_strategy == AUTO_STRATEGY
    evidence = _evidence(
        feasibility=feasibility,
        planner_exceptions=planner_exceptions,
        metrics=metrics,
        baseline_schedule_present=baseline_schedule_present,
        lifecycle_status=normalized_lifecycle,
    )
    engine_mode = _engine_mode(
        feasibility=feasibility,
        planner_exceptions=planner_exceptions,
        baseline_schedule_present=baseline_schedule_present,
    )
    if not auto:
        return PlanningDecision(
            requested_strategy=normalized_strategy,
            selected_strategy=normalized_strategy,
            requested_reschedule_mode=requested_reschedule_mode.strip().lower(),
            selected_reschedule_mode=selected_reschedule_mode,
            engine_mode=engine_mode,
            auto_selected=False,
            reason="Caller selected an explicit strategy.",
            rules_triggered=("explicit_strategy",),
            recommended_actions=_recommended_actions(feasibility, planner_exceptions),
            evidence=evidence,
        )

    selected_strategy, reason, rules = _select_auto_strategy(
        feasibility=feasibility,
        baseline_schedule_present=baseline_schedule_present,
        lifecycle_status=normalized_lifecycle,
        metrics=metrics,
        planner_exceptions=planner_exceptions,
    )
    return PlanningDecision(
        requested_strategy=normalized_strategy,
        selected_strategy=selected_strategy,
        requested_reschedule_mode=requested_reschedule_mode.strip().lower(),
        selected_reschedule_mode=selected_reschedule_mode,
        engine_mode=engine_mode,
        auto_selected=True,
        reason=reason,
        rules_triggered=rules,
        recommended_actions=_recommended_actions(feasibility, planner_exceptions),
        evidence=evidence,
    )


def _select_auto_strategy(
    *,
    feasibility: FeasibilityReport,
    baseline_schedule_present: bool,
    lifecycle_status: str,
    metrics: dict[str, Any] | None,
    planner_exceptions: dict[str, Any] | None,
) -> tuple[str, str, tuple[str, ...]]:
    exception_status = (
        planner_exceptions.get("status")
        if isinstance(planner_exceptions, dict)
        else None
    )
    if feasibility.error_count > 0 or exception_status == "blocked":
        return (
            "greedy",
            "Hard blockers require a fast repair-oriented operational pass.",
            ("blocked_repair",),
        )
    if baseline_schedule_present:
        return (
            "greedy",
            "A baseline is present, so auto mode preserves stability with the operational strategy.",
            ("baseline_stability",),
        )
    lateness = (metrics or {}).get("total_lateness_minutes")
    if isinstance(lateness, int) and lateness > 0:
        return (
            "hybrid",
            "Existing lateness pressure favors trying both forward dispatch and backward just-in-time.",
            ("lateness_pressure",),
        )
    if feasibility.dominant_issue_kind in {"unreachable_due_date", "horizon_too_short"}:
        return (
            "hybrid",
            "Due-date pressure was detected, so auto mode compares forward and backward operational postures.",
            ("due_date_pressure",),
        )
    if lifecycle_status in {"candidate", "what_if", "simulation"}:
        return (
            "hybrid",
            "What-if scenarios benefit from comparing forward and backward operational postures.",
            ("scenario_forward_backward",),
        )
    return (
        "greedy",
        "Workshop signals are ready, so auto mode uses the fast operational default.",
        ("normal_dispatch",),
    )


def _engine_mode(
    *,
    feasibility: FeasibilityReport,
    planner_exceptions: dict[str, Any] | None,
    baseline_schedule_present: bool,
) -> str:
    exception_status = (
        planner_exceptions.get("status")
        if isinstance(planner_exceptions, dict)
        else None
    )
    if feasibility.error_count > 0 or exception_status == "blocked":
        return "repair"
    if baseline_schedule_present:
        return "repair"
    if feasibility.warning_count > 0 or exception_status == "attention":
        return "degraded"
    return "normal"


def _recommended_actions(
    feasibility: FeasibilityReport,
    planner_exceptions: dict[str, Any] | None,
) -> tuple[str, ...]:
    actions: list[str] = []
    if feasibility.next_best_action:
        actions.append(feasibility.next_best_action)
    if isinstance(planner_exceptions, dict):
        action = planner_exceptions.get("next_best_action")
        if isinstance(action, str) and action:
            actions.append(action)
    return tuple(dict.fromkeys(actions))


def _evidence(
    *,
    feasibility: FeasibilityReport,
    planner_exceptions: dict[str, Any] | None,
    metrics: dict[str, Any] | None,
    baseline_schedule_present: bool,
    lifecycle_status: str,
) -> dict[str, object]:
    evidence: dict[str, object] = {
        "readiness_status": feasibility.readiness_status,
        "feasibility_errors": feasibility.error_count,
        "feasibility_warnings": feasibility.warning_count,
        "dominant_issue_kind": feasibility.dominant_issue_kind,
        "baseline_schedule_present": baseline_schedule_present,
        "lifecycle_status": lifecycle_status,
    }
    if isinstance(planner_exceptions, dict):
        evidence["planner_exception_status"] = planner_exceptions.get("status")
        evidence["dominant_exception_kind"] = planner_exceptions.get("dominant_kind")
    if isinstance(metrics, dict):
        for key in (
            "makespan_minutes",
            "total_lateness_minutes",
            "on_time_ratio",
            "schedule_stability_score",
        ):
            value = metrics.get(key)
            if isinstance(value, (int, float)):
                evidence[key] = value
    return evidence


def _operator_explanation(
    *,
    selected_strategy: str,
    rules_triggered: tuple[str, ...],
    evidence: dict[str, object],
) -> str:
    """Human-facing explanation for planners and UI consumers."""

    rules = set(rules_triggered)
    if "baseline_stability" in rules:
        return (
            "The engine is intentionally prioritizing stability because an existing "
            "baseline/candidate is being repaired. Similar Gantt output is expected "
            "when the edit does not unlock a better local placement."
        )
    if "scenario_forward_backward" in rules:
        return (
            "The engine is treating this as a what-if scenario and may compare forward "
            "and backward postures. If the Gantt remains similar, current due dates and "
            "resource constraints lead both postures to the same feasible sequence."
        )
    if "due_date_pressure" in rules or "lateness_pressure" in rules:
        return (
            "Due-date pressure is present, so the engine favors a hybrid posture. "
            "Different strategies can still converge when the bottleneck, material, "
            "or precedence constraints dominate the plan."
        )
    if "explicit_strategy" in rules:
        return (
            "The caller selected the strategy explicitly. If two explicit strategies "
            "produce the same Gantt, the dataset likely has a single dominant feasible "
            "sequence for the active constraints."
        )
    if evidence.get("feasibility_warnings"):
        return (
            "The plan is feasible with warnings. Review planner readiness before "
            "publishing, especially if the warning comes from repair scope or data quality."
        )
    return (
        f"The engine selected {selected_strategy} because current workshop signals are "
        "simple enough for the operational default. Similar-looking strategy outputs are "
        "normal when constraints do not create a meaningful alternative sequence."
    )
