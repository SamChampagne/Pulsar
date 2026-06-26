"""Repair-scope explainability for planner-driven replans.

The solver still receives the same normal inputs. This helper only decides
which baseline assignments are intentionally impacted by planner intent, and
why, so repair-local replans are auditable instead of feeling magical.
"""

from __future__ import annotations

from dataclasses import dataclass

from ...domain.entities import Schedule, ScheduledOperation, WorkOrder
from ...domain.errors import ValidationError
from ...domain.scheduling.dependency_links import operation_dependency_links
from ...domain.value_objects import TimeWindow
from .planner_actions import PlannerAction


@dataclass(frozen=True, slots=True)
class RepairScope:
    requested_mode: str
    effective_mode: str
    baseline_schedule_id: str | None = None
    repair_strategy: str = "reschedule_all"
    direct_operation_ids: tuple[str, ...] = ()
    work_order_scope_operation_ids: tuple[str, ...] = ()
    downstream_operation_ids: tuple[str, ...] = ()
    machine_conflict_operation_ids: tuple[str, ...] = ()
    resource_conflict_operation_ids: tuple[str, ...] = ()
    material_conflict_operation_ids: tuple[str, ...] = ()
    blocking_operation_ids: tuple[str, ...] = ()
    impacted_operation_ids: tuple[str, ...] = ()
    explanation_cards: tuple[dict[str, object], ...] = ()
    recommended_actions: tuple[dict[str, object], ...] = ()

    def as_dict(self) -> dict[str, object]:
        return {
            "version": "repair-scope-v1",
            "requested_mode": self.requested_mode,
            "effective_mode": self.effective_mode,
            "baseline_schedule_id": self.baseline_schedule_id,
            "repair_strategy": self.repair_strategy,
            "direct_operation_ids": list(self.direct_operation_ids),
            "work_order_scope_operation_ids": list(self.work_order_scope_operation_ids),
            "downstream_operation_ids": list(self.downstream_operation_ids),
            "machine_conflict_operation_ids": list(self.machine_conflict_operation_ids),
            "resource_conflict_operation_ids": list(self.resource_conflict_operation_ids),
            "material_conflict_operation_ids": list(self.material_conflict_operation_ids),
            "blocking_operation_ids": list(self.blocking_operation_ids),
            "impacted_operation_ids": list(self.impacted_operation_ids),
            "impacted_operation_count": len(self.impacted_operation_ids),
            "blocking_operation_count": len(self.blocking_operation_ids),
            "explanation_cards": [dict(card) for card in self.explanation_cards],
            "recommended_actions": [
                dict(action) for action in self.recommended_actions
            ],
        }


def build_repair_scope(
    *,
    actions: list[PlannerAction],
    work_orders: list[WorkOrder],
    requested_mode: str,
    effective_mode: str,
    baseline_schedule: Schedule | None = None,
) -> RepairScope:
    """Return operations intentionally released from policy-frozen baseline."""

    operations_by_work_order = {
        work_order.id: {operation.id for operation in work_order.operations}
        for work_order in work_orders
    }
    operation_by_id = {
        operation.id: operation
        for work_order in work_orders
        for operation in work_order.operations
    }
    baseline_by_operation = (
        {
            assignment.operation_id: assignment
            for assignment in baseline_schedule.assignments
        }
        if baseline_schedule is not None
        else {}
    )
    direct: set[str] = set()
    work_order_scope: set[str] = set()
    machine_conflicts: set[str] = set()
    resource_conflicts: set[str] = set()
    material_conflicts: set[str] = set()
    cards: list[dict[str, object]] = []

    for action in actions:
        action_type = action.action_type.strip().lower()
        if action_type == "freeze_operation":
            continue
        if action_type in {
            "force_machine",
            "pin_operation_window",
            "standby_operation",
            "reinsert_standby_operation",
            "unfreeze_operation",
        } and action.operation_id:
            direct.add(action.operation_id)
            cards.append(_card(action_type, action.operation_id, "direct_planner_action"))
        if action_type in {
            "change_priority",
            "override_due_date",
            "exclude_work_order",
        } and action.work_order_id:
            scoped = operations_by_work_order.get(action.work_order_id, set())
            work_order_scope.update(scoped)
            if scoped:
                cards.append(
                    _card(
                        action_type,
                        action.work_order_id,
                        "work_order_planner_action",
                        operation_ids=sorted(scoped),
                    )
                )
        if action_type == "pin_operation_window":
            conflicts = _pin_conflicts(
                action=action,
                baseline_by_operation=baseline_by_operation,
                operation_by_id=operation_by_id,
            )
            machine_conflicts.update(conflicts["machine"])
            resource_conflicts.update(conflicts["resource"])
            material_conflicts.update(conflicts["material"])
            for kind, operation_ids in conflicts.items():
                if operation_ids:
                    cards.append(
                        _card(
                            "pin_operation_window",
                            action.operation_id or "",
                            f"{kind}_conflict",
                            operation_ids=sorted(operation_ids),
                        )
                    )

    downstream = _downstream_operations(
        seeds=direct | work_order_scope | machine_conflicts,
        work_orders=work_orders,
    )
    if downstream:
        cards.append(
            {
                "reason": "downstream_dependency",
                "target_id": "dependency_graph",
                "operation_ids": sorted(downstream),
            }
        )
    impacted = (
        direct
        | work_order_scope
        | downstream
        | machine_conflicts
    )
    blocking = resource_conflicts | material_conflicts
    recommendations = _recommended_actions(
        resource_conflicts=resource_conflicts,
        material_conflicts=material_conflicts,
        machine_conflicts=machine_conflicts,
        downstream=downstream,
    )
    return RepairScope(
        requested_mode=requested_mode,
        effective_mode=effective_mode,
        baseline_schedule_id=baseline_schedule.id if baseline_schedule else None,
        repair_strategy=_repair_strategy(
            effective_mode=effective_mode,
            blocking=blocking,
            impacted=impacted,
        ),
        direct_operation_ids=tuple(sorted(direct)),
        work_order_scope_operation_ids=tuple(sorted(work_order_scope)),
        downstream_operation_ids=tuple(sorted(downstream)),
        machine_conflict_operation_ids=tuple(sorted(machine_conflicts)),
        resource_conflict_operation_ids=tuple(sorted(resource_conflicts)),
        material_conflict_operation_ids=tuple(sorted(material_conflicts)),
        blocking_operation_ids=tuple(sorted(blocking)),
        impacted_operation_ids=tuple(sorted(impacted)),
        explanation_cards=tuple(cards),
        recommended_actions=tuple(recommendations),
    )


def _pin_conflicts(
    *,
    action: PlannerAction,
    baseline_by_operation: dict[str, ScheduledOperation],
    operation_by_id,
) -> dict[str, set[str]]:
    conflicts: dict[str, set[str]] = {
        "machine": set(),
        "resource": set(),
        "material": set(),
    }
    if (
        not action.operation_id
        or not action.machine_id
        or action.start is None
        or action.end is None
    ):
        return conflicts
    try:
        pinned_window = TimeWindow(start=action.setup_start or action.start, end=action.end)
    except ValidationError:
        return conflicts
    target_operation = operation_by_id.get(action.operation_id)
    target_resources = _resource_ids(target_operation)
    target_materials = _material_ids(target_operation)
    for assignment in baseline_by_operation.values():
        if assignment.operation_id == action.operation_id:
            continue
        if not assignment.full_window.overlaps(pinned_window):
            continue
        candidate_operation = operation_by_id.get(assignment.operation_id)
        if assignment.machine_id == action.machine_id:
            conflicts["machine"].add(assignment.operation_id)
        if target_resources and target_resources & _resource_ids(candidate_operation):
            conflicts["resource"].add(assignment.operation_id)
        if target_materials and target_materials & _material_ids(candidate_operation):
            conflicts["material"].add(assignment.operation_id)
    return conflicts


def _downstream_operations(
    *,
    seeds: set[str],
    work_orders: list[WorkOrder],
) -> set[str]:
    successors: dict[str, set[str]] = {}
    for work_order in work_orders:
        for operation in work_order.operations:
            for link in operation_dependency_links(work_order, operation):
                successors.setdefault(link.depends_on_id, set()).add(operation.id)
    downstream: set[str] = set()
    pending = list(seeds)
    while pending:
        operation_id = pending.pop(0)
        for successor_id in successors.get(operation_id, set()):
            if successor_id in downstream or successor_id in seeds:
                continue
            downstream.add(successor_id)
            pending.append(successor_id)
    return downstream


def _resource_ids(operation) -> set[str]:
    if operation is None:
        return set()
    ids = {requirement.resource_id for requirement in operation.resource_requirements}
    for routing in operation.effective_routings():
        ids.update(requirement.resource_id for requirement in routing.resource_requirements)
    return ids


def _material_ids(operation) -> set[str]:
    if operation is None:
        return set()
    return {requirement.material_id for requirement in operation.material_requirements}


def _card(
    action_type: str,
    target_id: str,
    reason: str,
    *,
    operation_ids: list[str] | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "action_type": action_type,
        "target_id": target_id,
        "reason": reason,
    }
    if operation_ids is not None:
        payload["operation_ids"] = operation_ids
    return payload


def _repair_strategy(
    *,
    effective_mode: str,
    blocking: set[str],
    impacted: set[str],
) -> str:
    if blocking:
        return "blocked_until_constraint_resolution"
    if effective_mode in {"repair_local", "net_change"} and impacted:
        return "targeted_repair"
    if effective_mode in {"repair_local", "net_change"}:
        return "stability_preserving_repair"
    return "full_reschedule"


def _recommended_actions(
    *,
    resource_conflicts: set[str],
    material_conflicts: set[str],
    machine_conflicts: set[str],
    downstream: set[str],
) -> list[dict[str, object]]:
    recommendations: list[dict[str, object]] = []
    if resource_conflicts:
        recommendations.append(
            {
                "kind": "resource_conflict",
                "severity": "blocking",
                "operation_ids": sorted(resource_conflicts),
                "recommended_action": "move_or_delay_pin",
                "planner_action_candidates": [
                    "move_operation",
                    "pin_operation_window",
                    "add_overtime",
                ],
                "rationale": (
                    "The exact pin overlaps a frozen operation using the same "
                    "secondary resource. The engine will not silently unfreeze "
                    "scarce tools/operators; move the pin, add capacity, or "
                    "explicitly replan the conflicting work."
                ),
            }
        )
    if material_conflicts:
        recommendations.append(
            {
                "kind": "material_conflict",
                "severity": "blocking",
                "operation_ids": sorted(material_conflicts),
                "recommended_action": "delay_until_material_ready",
                "planner_action_candidates": [
                    "move_operation",
                    "pin_operation_window",
                    "add_supply",
                ],
                "rationale": (
                    "The exact pin would consume material before the frozen "
                    "baseline allocation is safe. Use feasible-slot suggestions "
                    "or add supply before pinning earlier."
                ),
            }
        )
    if machine_conflicts:
        recommendations.append(
            {
                "kind": "machine_conflict",
                "severity": "repairable",
                "operation_ids": sorted(machine_conflicts),
                "recommended_action": "repair_local",
                "planner_action_candidates": [
                    "pin_operation_window",
                    "unfreeze_operation",
                ],
                "rationale": (
                    "Machine overlaps are intentionally released from the "
                    "policy-frozen baseline so repair_local can move them."
                ),
            }
        )
    if downstream:
        recommendations.append(
            {
                "kind": "downstream_dependency",
                "severity": "repairable",
                "operation_ids": sorted(downstream),
                "recommended_action": "downstream_repair",
                "planner_action_candidates": ["repair_local", "net_change"],
                "rationale": (
                    "Successor operations are in scope because the planner "
                    "changed an upstream operation."
                ),
            }
        )
    return recommendations
