"""Unified planner exception read model.

The engine already emits specialized diagnostics: feasibility reports,
infeasibility reports, material pegging, stability, disruption impact, and
metrics. This module does not replace them. It builds a compact exception list
that a planner or UI can scan quickly.
"""

from __future__ import annotations

from typing import Any

from ...domain.scheduling.diagnosis import InfeasibilityReport
from ...domain.scheduling.feasibility import FeasibilityReport


def build_planner_exceptions(
    *,
    feasibility: FeasibilityReport | None = None,
    infeasibility: InfeasibilityReport | None = None,
    diagnostics: dict[str, Any] | None = None,
    metrics: dict[str, Any] | None = None,
    max_items: int = 25,
) -> dict[str, object]:
    """Aggregate specialized diagnostics into planner exception cards."""

    diagnostics = diagnostics or {}
    metrics = metrics or {}
    exceptions: list[dict[str, object]] = []
    exceptions.extend(_from_feasibility(feasibility))
    exceptions.extend(_from_infeasibility(infeasibility))
    exceptions.extend(_from_material_pegging(diagnostics.get("material_pegging_report")))
    exceptions.extend(_from_stability(diagnostics.get("stability_report")))
    exceptions.extend(_from_disruption(diagnostics.get("disruption_impact")))
    exceptions.extend(_from_metrics(metrics))

    deduped = _dedupe(exceptions)
    deduped.sort(
        key=lambda item: (
            _severity_rank(str(item.get("severity") or "")),
            str(item.get("kind") or ""),
            str(item.get("operation_id") or ""),
            str(item.get("message") or ""),
        )
    )
    limited = deduped[:max_items]
    return {
        "version": "planner-exceptions-v1",
        "status": _status(limited),
        "exception_count": len(deduped),
        "error_count": sum(1 for item in deduped if item.get("severity") == "error"),
        "warning_count": sum(
            1 for item in deduped if item.get("severity") == "warning"
        ),
        "dominant_kind": _dominant_kind(deduped),
        "next_best_action": _next_best_action(limited),
        "exceptions": limited,
    }


def _from_feasibility(
    feasibility: FeasibilityReport | None,
) -> list[dict[str, object]]:
    if feasibility is None:
        return []
    cards: list[dict[str, object]] = []
    suggestions_by_kind = {
        suggestion.issue_kind: suggestion.action
        for suggestion in feasibility.suggestions
        if suggestion.issue_kind
    }
    for issue in feasibility.issues:
        cards.append(
            {
                "source": "feasibility",
                "kind": issue.kind.value,
                "severity": issue.severity.value,
                "message": issue.message,
                "operation_id": issue.operation_id,
                "work_order_id": issue.work_order_id,
                "machine_id": issue.machine_id,
                "material_id": issue.material_id,
                "recommended_action": suggestions_by_kind.get(issue.kind.value)
                or feasibility.next_best_action,
            }
        )
    return cards


def _from_infeasibility(
    infeasibility: InfeasibilityReport | None,
) -> list[dict[str, object]]:
    if infeasibility is None:
        return []
    cards: list[dict[str, object]] = []
    for operation in infeasibility.operations:
        for blocker in operation.blockers:
            cards.append(
                {
                    "source": "infeasibility",
                    "kind": blocker.kind.value,
                    "severity": "error",
                    "message": blocker.message,
                    "operation_id": operation.operation_id,
                    "work_order_id": operation.work_order_id,
                    "machine_id": blocker.machine_id,
                    "resource_id": blocker.resource_id,
                    "material_id": blocker.material_id,
                    "constraint_name": blocker.constraint_name,
                    "recommended_action": infeasibility.next_best_action,
                }
            )
    return cards


def _from_material_pegging(value: object) -> list[dict[str, object]]:
    if not isinstance(value, dict) or value.get("status") != "short":
        return []
    blocked = value.get("blocked_operations")
    if not isinstance(blocked, list):
        return []
    cards: list[dict[str, object]] = []
    for item in blocked:
        if not isinstance(item, dict):
            continue
        material_id = item.get("material_id")
        operation_id = item.get("operation_id")
        uncovered = item.get("uncovered_quantity")
        cards.append(
            {
                "source": "material_pegging",
                "kind": "material_shortage",
                "severity": "error",
                "message": (
                    f"Operation {operation_id} has {uncovered} uncovered units "
                    f"of material {material_id}."
                ),
                "operation_id": operation_id,
                "material_id": material_id,
                "uncovered_quantity": uncovered,
                "required_at": item.get("required_at"),
                "recommended_action": item.get("suggested_action"),
            }
        )
    return cards


def _from_stability(value: object) -> list[dict[str, object]]:
    if not isinstance(value, dict) or value.get("available") is not True:
        return []
    cards: list[dict[str, object]] = []
    frozen_changed = value.get("frozen_changed_count")
    non_impacted_changed = value.get("non_impacted_changed_count")
    if isinstance(frozen_changed, int) and frozen_changed > 0:
        cards.append(
            {
                "source": "stability",
                "kind": "frozen_changed",
                "severity": "error",
                "message": f"{frozen_changed} frozen operation(s) changed.",
                "recommended_action": "Inspect frozen assignments before releasing the plan.",
            }
        )
    if isinstance(non_impacted_changed, int) and non_impacted_changed > 0:
        cards.append(
            {
                "source": "stability",
                "kind": "schedule_nervousness",
                "severity": "warning",
                "message": (
                    f"{non_impacted_changed} non-impacted operation(s) changed "
                    "versus baseline."
                ),
                "recommended_action": "Review whether the replan moved more work than intended.",
            }
        )
    return cards


def _from_disruption(value: object) -> list[dict[str, object]]:
    if not isinstance(value, dict):
        return []
    cards: list[dict[str, object]] = []
    for field, kind, label in [
        ("removed_operation_count", "operation_removed", "removed"),
        ("delayed_operation_count", "operation_delayed", "delayed"),
        ("machine_change_count", "machine_changed", "changed machine"),
    ]:
        count = value.get(field)
        if isinstance(count, int) and count > 0:
            cards.append(
                {
                    "source": "disruption",
                    "kind": kind,
                    "severity": "warning",
                    "message": f"{count} operation(s) {label} after disruption.",
                    "recommended_action": "Review disruption impact before publishing the new plan.",
                }
            )
    return cards


def _from_metrics(metrics: dict[str, Any]) -> list[dict[str, object]]:
    cards: list[dict[str, object]] = []
    lateness = metrics.get("total_lateness_minutes")
    if isinstance(lateness, int) and lateness > 0:
        cards.append(
            {
                "source": "metrics",
                "kind": "lateness",
                "severity": "warning",
                "message": f"Plan carries {lateness} minutes of total lateness.",
                "recommended_action": "Review late work orders, priorities, and capacity.",
            }
        )
    return cards


def _dedupe(items: list[dict[str, object]]) -> list[dict[str, object]]:
    seen: set[tuple[object, ...]] = set()
    deduped: list[dict[str, object]] = []
    for item in items:
        key = (
            item.get("source"),
            item.get("kind"),
            item.get("operation_id"),
            item.get("work_order_id"),
            item.get("machine_id"),
            item.get("material_id"),
            item.get("message"),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _severity_rank(severity: str) -> int:
    if severity == "error":
        return 0
    if severity == "warning":
        return 1
    return 2


def _status(items: list[dict[str, object]]) -> str:
    if any(item.get("severity") == "error" for item in items):
        return "blocked"
    if any(item.get("severity") == "warning" for item in items):
        return "attention"
    return "clear"


def _dominant_kind(items: list[dict[str, object]]) -> str | None:
    if not items:
        return None
    counts: dict[str, int] = {}
    for item in items:
        kind = item.get("kind")
        if isinstance(kind, str):
            counts[kind] = counts.get(kind, 0) + 1
    if not counts:
        return None
    return max(counts.items(), key=lambda item: (item[1], item[0]))[0]


def _next_best_action(items: list[dict[str, object]]) -> str | None:
    for item in items:
        action = item.get("recommended_action")
        if isinstance(action, str) and action:
            return action
    return None
