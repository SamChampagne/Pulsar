"""Engine-driven classification of why a work order is late.

Pure function. Reads the diagnostics already attached to a published
schedule's run metadata and applies first-match-wins precedence:

    material > capacity > priority > sequence

No I/O, no repositories. The caller passes everything explicitly.
"""

from __future__ import annotations

from typing import Any

from ....domain.entities import Schedule, WorkOrder
from ...ports.schedule_repository import ScheduleRunMetadata
from .late_order_payload import LateOrderReason

_CAPACITY_KINDS = frozenset(
    {"horizon_too_short", "machine_overload", "no_eligible_machine"}
)


def classify_late_order_reason(
    *,
    wo: WorkOrder,
    schedule: Schedule,
    metadata: ScheduleRunMetadata,
    all_work_orders: list[WorkOrder],
) -> LateOrderReason:
    diagnostics = metadata.diagnostics or {}

    if _has_material_signal(wo, diagnostics):
        return "material"
    if _has_capacity_signal(wo, diagnostics):
        return "capacity"
    if _crowded_out_by_higher_priority(wo, schedule, all_work_orders):
        return "priority"
    return "sequence"


def _has_material_signal(wo: WorkOrder, diagnostics: dict[str, Any]) -> bool:
    if _exception_kinds_for(wo, diagnostics).get("material_shortage"):
        return True
    pegging = diagnostics.get("material_pegging_report")
    if isinstance(pegging, dict):
        wo_op_ids = wo.operation_ids()
        for entry in pegging.get("blocked_operations") or []:
            if isinstance(entry, dict) and entry.get("operation_id") in wo_op_ids:
                return True
    return False


def _has_capacity_signal(wo: WorkOrder, diagnostics: dict[str, Any]) -> bool:
    kinds = _exception_kinds_for(wo, diagnostics)
    return any(kinds.get(k) for k in _CAPACITY_KINDS)


def _crowded_out_by_higher_priority(
    wo: WorkOrder,
    schedule: Schedule,
    all_work_orders: list[WorkOrder],
) -> bool:
    wo_machines = {
        a.machine_id for a in schedule.assignments if a.work_order_id == wo.id
    }
    if not wo_machines:
        return False
    for other in all_work_orders:
        if other.id == wo.id:
            continue
        if other.priority.value <= wo.priority.value:
            continue
        other_machines = {
            a.machine_id
            for a in schedule.assignments
            if a.work_order_id == other.id
        }
        if wo_machines & other_machines:
            return True
    return False


def _exception_kinds_for(wo: WorkOrder, diagnostics: dict[str, Any]) -> dict[str, bool]:
    """Index exception kinds for the given WO id (True if at least one match)."""
    container = diagnostics.get("planner_exceptions")
    if not isinstance(container, dict):
        return {}
    kinds: dict[str, bool] = {}
    for item in container.get("exceptions") or []:
        if not isinstance(item, dict):
            continue
        if item.get("work_order_id") != wo.id:
            continue
        kind = item.get("kind")
        if isinstance(kind, str):
            kinds[kind] = True
    return kinds
