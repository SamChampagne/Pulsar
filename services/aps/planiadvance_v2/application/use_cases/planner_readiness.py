"""Planner-ready validation read model for persisted schedules."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ...domain.errors import ValidationError
from ..ports import ScheduleRepository, ScheduleRunMetadata
from .planning_validation_gate import validate_schedule_scope


@dataclass(frozen=True, slots=True)
class PlannerReadinessOutput:
    schedule_id: str
    status: str
    ready: bool
    recommendation: str
    blockers: list[dict[str, object]] = field(default_factory=list)
    warnings: list[dict[str, object]] = field(default_factory=list)
    recommended_actions: list[str] = field(default_factory=list)
    diagnostics: dict[str, Any] = field(default_factory=dict)
    ui_contract: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, object]:
        return {
            "schedule_id": self.schedule_id,
            "status": self.status,
            "ready": self.ready,
            "recommendation": self.recommendation,
            "blockers": list(self.blockers),
            "warnings": list(self.warnings),
            "recommended_actions": list(self.recommended_actions),
            "diagnostics": dict(self.diagnostics),
            "ui_contract": dict(self.ui_contract),
        }


class GetPlannerReadiness:
    """Summarize whether a persisted plan is ready for planner/UI use."""

    def __init__(self, schedules: ScheduleRepository) -> None:
        self._schedules = schedules

    def execute(
        self,
        schedule_id: str,
        *,
        organization_id: str | None = None,
    ) -> PlannerReadinessOutput:
        schedule = self._schedules.get(schedule_id)
        metadata = self._schedules.get_metadata(schedule_id)
        if schedule is None or metadata is None:
            raise ValidationError(f"Schedule {schedule_id!r} not found")
        validate_schedule_scope(
            metadata,
            expected_organization_id=organization_id,
            schedule_id=schedule_id,
            label="Planner readiness",
        )
        return _build_output(schedule_id=schedule_id, metadata=metadata)


def _build_output(
    *,
    schedule_id: str,
    metadata: ScheduleRunMetadata,
) -> PlannerReadinessOutput:
    diagnostics = metadata.diagnostics or {}
    planner_exceptions = _dict(diagnostics.get("planner_exceptions"))
    repair_scope = _dict(diagnostics.get("repair_scope"))
    planning_policy = _dict(diagnostics.get("planning_policy"))
    planner_decisions = _dict(diagnostics.get("planner_decisions"))
    material_pegging = _dict(diagnostics.get("material_pegging_report"))
    stability_report = _dict(diagnostics.get("stability_report"))
    policy_summary = _planning_policy_summary(
        diagnostics=diagnostics,
        planning_policy=planning_policy,
        planner_decisions=planner_decisions,
    )

    blockers = _blockers(
        metadata=metadata,
        planner_exceptions=planner_exceptions,
        repair_scope=repair_scope,
        material_pegging=material_pegging,
    )
    warnings = _warnings(
        planner_exceptions=planner_exceptions,
        repair_scope=repair_scope,
        planning_policy=planning_policy,
        stability_report=stability_report,
        policy_summary=policy_summary,
    )
    actions = _recommended_actions(
        planner_exceptions=planner_exceptions,
        repair_scope=repair_scope,
        planner_decisions=planner_decisions,
    )
    status = "blocked" if blockers else "attention" if warnings else "ready"
    return PlannerReadinessOutput(
        schedule_id=schedule_id,
        status=status,
        ready=status == "ready",
        recommendation=_recommendation(status),
        blockers=blockers,
        warnings=warnings,
        recommended_actions=actions,
        diagnostics={
            "solver_status": metadata.solver_status,
            "lifecycle_status": metadata.lifecycle_status,
            "strategy": metadata.strategy,
            "planner_exception_status": planner_exceptions.get("status"),
            "repair_strategy": repair_scope.get("repair_strategy"),
            "planning_policy_status": _planning_policy_status(planning_policy),
            "planning_policy_lock_type_counts": planning_policy.get(
                "lock_type_counts",
                {},
            ),
            "planning_policy_summary": policy_summary,
            "material_status": material_pegging.get("status"),
            "changed_operation_count": stability_report.get("changed_operation_count"),
        },
        ui_contract={
            "version": "planner-readiness-v1",
            "planning_disposition": "wip-firm-frozen-v1",
            "planner_override_policy": "planner-override-policy-v1",
            "next_routes": [
                f"GET /scheduling/runs/{schedule_id}/dashboard",
                f"GET /scheduling/runs/{schedule_id}/gantt",
                f"GET /scheduling/runs/{schedule_id}/operations/{{operation_id}}/feasible-slots",
                f"POST /scheduling/runs/{schedule_id}/edits/preview",
            ],
            "hard_blockers_are_actionable": True,
        },
    )


def _blockers(
    *,
    metadata: ScheduleRunMetadata,
    planner_exceptions: dict[str, Any],
    repair_scope: dict[str, Any],
    material_pegging: dict[str, Any],
) -> list[dict[str, object]]:
    blockers: list[dict[str, object]] = []
    if metadata.solver_status != "feasible":
        blockers.append(
            {
                "kind": "solver_status",
                "message": f"Solver status is {metadata.solver_status!r}.",
                "recommended_action": "rerun_or_fix_inputs",
            }
        )
    if planner_exceptions.get("status") == "blocked":
        blockers.append(
            {
                "kind": "planner_exception",
                "message": "Planner exceptions contain blockers.",
                "recommended_action": planner_exceptions.get(
                    "next_best_action",
                    "resolve_planner_exceptions",
                ),
            }
        )
    if repair_scope.get("repair_strategy") == "blocked_until_constraint_resolution":
        blockers.append(
            {
                "kind": "repair_scope",
                "message": "Repair is blocked until hard constraints change.",
                "operation_ids": repair_scope.get("blocking_operation_ids", []),
                "recommended_action": "show_repair_recommendations",
            }
        )
    if material_pegging.get("status") == "short":
        blockers.append(
            {
                "kind": "material_pegging",
                "message": "Material pegging has uncovered demand.",
                "recommended_action": "expedite_or_reallocate_material",
            }
        )
    return blockers


def _warnings(
    *,
    planner_exceptions: dict[str, Any],
    repair_scope: dict[str, Any],
    planning_policy: dict[str, Any],
    stability_report: dict[str, Any],
    policy_summary: dict[str, Any],
) -> list[dict[str, object]]:
    warnings: list[dict[str, object]] = []
    if planner_exceptions.get("status") == "attention":
        warnings.append(
            {
                "kind": "planner_exception",
                "message": "Planner exceptions need review.",
                "recommended_action": planner_exceptions.get(
                    "next_best_action",
                    "review_exceptions",
                ),
            }
        )
    changed = stability_report.get("changed_operation_count")
    if isinstance(changed, int) and changed > 0:
        warnings.append(
            {
                "kind": "stability",
                "message": f"{changed} operation(s) changed versus baseline.",
                "recommended_action": "review_stability_delta",
            }
        )
    if repair_scope.get("repair_strategy") == "full_reschedule":
        warnings.append(
            {
                "kind": "repair_scope",
                "message": "This plan used a full reschedule.",
                "recommended_action": "review_plan_nervousness",
            }
        )
    active_locks = planning_policy.get("active_lock_count")
    if isinstance(active_locks, int) and active_locks > 0:
        warnings.append(
            {
                "kind": "planning_policy",
                "message": f"{active_locks} WIP/firm/frozen lock(s) shaped this plan.",
                "lock_type_counts": planning_policy.get("lock_type_counts", {}),
                "recommended_action": "review_gantt_locks",
            }
        )
    partial_wip = policy_summary.get("partial_wip_repair_count")
    if isinstance(partial_wip, int) and partial_wip > 0:
        warnings.append(
            {
                "kind": "partial_wip_repair",
                "message": (
                    f"{partial_wip} operation(s) used actual-consumed plus "
                    "remaining-work repair."
                ),
                "recommended_action": "review_wip_remaining_segments",
            }
        )
    firm_locks = policy_summary.get("firm_fence_count")
    if isinstance(firm_locks, int) and firm_locks > 0:
        warnings.append(
            {
                "kind": "firm_fence",
                "message": f"{firm_locks} operation(s) are inside a firm fence.",
                "recommended_action": "review_firm_overrides",
            }
        )
    hard_frozen = policy_summary.get("hard_frozen_count")
    if isinstance(hard_frozen, int) and hard_frozen > 0:
        warnings.append(
            {
                "kind": "hard_frozen",
                "message": f"{hard_frozen} operation(s) are hard frozen.",
                "recommended_action": "review_frozen_zone",
            }
        )
    slushy = policy_summary.get("slushy_review_count")
    if isinstance(slushy, int) and slushy > 0:
        warnings.append(
            {
                "kind": "slushy_review",
                "message": (
                    f"{slushy} soft-locked operation(s) can move but require "
                    "planner stability review."
                ),
                "recommended_action": "review_slushy_overrides",
            }
        )
    return warnings


def _recommended_actions(
    *,
    planner_exceptions: dict[str, Any],
    repair_scope: dict[str, Any],
    planner_decisions: dict[str, Any],
) -> list[str]:
    actions: list[str] = []
    for source in (planner_exceptions, planner_decisions):
        for action in source.get("recommended_actions", []) or []:
            if isinstance(action, str) and action:
                actions.append(action)
        action = source.get("next_best_action")
        if isinstance(action, str) and action:
            actions.append(action)
    for item in repair_scope.get("recommended_actions", []) or []:
        if isinstance(item, dict):
            action = item.get("recommended_action")
            if isinstance(action, str) and action:
                actions.append(action)
    return list(dict.fromkeys(actions))


def _recommendation(status: str) -> str:
    if status == "ready":
        return "Plan is ready for planner review and Gantt interaction."
    if status == "attention":
        return "Plan is usable, but planners should review warnings before publishing."
    return "Resolve blockers before using or publishing this plan."


def _planning_policy_status(policy: dict[str, Any]) -> str:
    active_locks = policy.get("active_lock_count")
    if isinstance(active_locks, int) and active_locks > 0:
        return "locks_active"
    return "none"


def _planning_policy_summary(
    *,
    diagnostics: dict[str, Any],
    planning_policy: dict[str, Any],
    planner_decisions: dict[str, Any],
) -> dict[str, Any]:
    lock_type_counts = _dict(planning_policy.get("lock_type_counts"))
    wip_remaining = _dict(diagnostics.get("wip_remaining_split"))
    partial_wip_count = wip_remaining.get("split_count")
    if not isinstance(partial_wip_count, int):
        partial_wip_count = 0
    slushy_review_count = _planner_decision_count(
        planner_decisions,
        {"machine_forced"},
    )
    manual_pinned_count = _planner_decision_count(
        planner_decisions,
        {"operation_window_pinned"},
    )
    hard_frozen_count = diagnostics.get("policy_hard_frozen_count")
    if not isinstance(hard_frozen_count, int):
        hard_frozen_count = sum(
            int(lock_type_counts.get(key, 0) or 0)
            for key in ("completed_frozen", "started_frozen", "frozen_fence")
        )
    firm_fence_count = diagnostics.get("policy_firm_fence_count")
    if not isinstance(firm_fence_count, int):
        firm_fence_count = int(lock_type_counts.get("firm_fence", 0) or 0)
    wip_frozen_count = diagnostics.get("policy_wip_frozen_count")
    if not isinstance(wip_frozen_count, int):
        wip_frozen_count = sum(
            int(lock_type_counts.get(key, 0) or 0)
            for key in ("completed_frozen", "started_frozen")
        )
    return {
        "version": "planning-policy-summary-v1",
        "active_lock_count": planning_policy.get("active_lock_count", 0),
        "frozen_assignment_count": planning_policy.get(
            "frozen_assignment_count",
            0,
        ),
        "lock_type_counts": lock_type_counts,
        "wip_frozen_count": wip_frozen_count,
        "partial_wip_repair_count": partial_wip_count,
        "firm_fence_count": firm_fence_count,
        "hard_frozen_count": hard_frozen_count,
        "manual_pinned_count": manual_pinned_count,
        "slushy_review_count": slushy_review_count,
        "recommended_review_actions": [
            action
            for action, count in (
                ("review_wip_remaining_segments", partial_wip_count),
                ("review_firm_overrides", firm_fence_count),
                ("review_frozen_zone", hard_frozen_count),
                ("review_slushy_overrides", slushy_review_count),
            )
            if count
        ],
    }


def _planner_decision_count(
    planner_decisions: dict[str, Any],
    change_types: set[str],
) -> int:
    count = 0
    for item in planner_decisions.get("records", []) or []:
        if not isinstance(item, dict):
            continue
        impact = _dict(item.get("impact"))
        if impact.get("change_type") in change_types:
            count += 1
    return count


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}
