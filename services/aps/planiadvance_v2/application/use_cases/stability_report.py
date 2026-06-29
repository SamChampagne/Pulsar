"""Planner-facing schedule stability report.

The domain metrics already compute stability KPIs. This helper adds the
explainability layer planners need: which operations moved, which stayed frozen,
which were introduced, and why a run should be considered nervous.
"""

from __future__ import annotations

from ...domain.entities import Schedule, ScheduledOperation


def build_stability_report(
    *,
    schedule: Schedule,
    baseline_schedule: Schedule | None,
    frozen_operation_ids: set[str] | None = None,
    impacted_operation_ids: set[str] | None = None,
    max_operations: int = 25,
) -> dict[str, object]:
    """Build an operation-level stability report against a baseline schedule."""

    if baseline_schedule is None:
        return {
            "available": False,
            "reason": "no_baseline_schedule",
            "operation_changes": [],
        }

    frozen_ids = frozen_operation_ids or set()
    impacted_ids = impacted_operation_ids or set()
    baseline_by_op = _assignment_by_operation(baseline_schedule)
    current_by_op = _assignment_by_operation(schedule)
    all_operation_ids = sorted(set(baseline_by_op) | set(current_by_op))

    operation_changes = [
        _operation_change(
            operation_id=operation_id,
            previous=baseline_by_op.get(operation_id),
            current=current_by_op.get(operation_id),
            is_frozen=operation_id in frozen_ids,
            is_impacted=operation_id in impacted_ids,
        )
        for operation_id in all_operation_ids
    ]
    changed = [change for change in operation_changes if change["changed"] is True]
    moved = [change for change in changed if "moved" in change["change_reasons"]]
    machine_changed = [
        change for change in changed if "machine_changed" in change["change_reasons"]
    ]
    introduced = [
        change for change in operation_changes if "introduced" in change["change_reasons"]
    ]
    removed = [
        change for change in operation_changes if "removed" in change["change_reasons"]
    ]
    frozen_changed = [
        change
        for change in changed
        if change["is_frozen"] is True and change["is_impacted"] is False
    ]
    non_impacted_changed = [
        change
        for change in changed
        if change["is_impacted"] is False and change["is_frozen"] is False
    ]
    total_shift_minutes = sum(
        int(change.get("start_shift_minutes") or 0) for change in changed
    )
    nervousness_score = (
        len(moved)
        + (2 * len(machine_changed))
        + (2 * len(introduced))
        + (2 * len(removed))
        + (total_shift_minutes / 60)
    )
    tracked_total = max(len(all_operation_ids), 1)
    stability_ratio = (
        len([change for change in operation_changes if change["changed"] is False])
        / tracked_total
    )

    return {
        "available": True,
        "baseline_schedule_id": baseline_schedule.id,
        "current_schedule_id": schedule.id,
        "operation_count": len(all_operation_ids),
        "changed_operation_count": len(changed),
        "moved_operation_count": len(moved),
        "machine_change_count": len(machine_changed),
        "introduced_operation_count": len(introduced),
        "removed_operation_count": len(removed),
        "frozen_operation_count": len(frozen_ids),
        "frozen_changed_count": len(frozen_changed),
        "non_impacted_changed_count": len(non_impacted_changed),
        "total_start_shift_minutes": total_shift_minutes,
        "nervousness_score": round(nervousness_score, 4),
        "stability_ratio": round(stability_ratio, 4),
        "status": _status(
            frozen_changed_count=len(frozen_changed),
            non_impacted_changed_count=len(non_impacted_changed),
            stability_ratio=stability_ratio,
        ),
        "top_change_reasons": _top_change_reasons(operation_changes),
        "operation_changes": changed[:max_operations],
    }


def _assignment_by_operation(schedule: Schedule) -> dict[str, ScheduledOperation]:
    return {
        assignment.operation_id: assignment
        for assignment in schedule.assignments
    }


def _operation_change(
    *,
    operation_id: str,
    previous: ScheduledOperation | None,
    current: ScheduledOperation | None,
    is_frozen: bool,
    is_impacted: bool,
) -> dict[str, object]:
    reasons: list[str] = []
    if previous is None and current is not None:
        reasons.append("introduced")
    elif previous is not None and current is None:
        reasons.append("removed")
    elif previous is not None and current is not None:
        if previous.machine_id != current.machine_id:
            reasons.append("machine_changed")
        if (
            previous.setup_start != current.setup_start
            or previous.start != current.start
            or previous.end != current.end
        ):
            reasons.append("moved")

    changed = bool(reasons)
    start_shift_minutes = _start_shift_minutes(previous, current)
    if not changed:
        reasons.append("unchanged")
    if is_frozen:
        reasons.append("frozen")
    if is_impacted:
        reasons.append("impacted")

    return {
        "operation_id": operation_id,
        "work_order_id": _first_present(previous, current, "work_order_id"),
        "changed": changed,
        "is_frozen": is_frozen,
        "is_impacted": is_impacted,
        "change_reasons": reasons,
        "previous": _assignment_payload(previous),
        "current": _assignment_payload(current),
        "start_shift_minutes": start_shift_minutes,
    }


def _assignment_payload(
    assignment: ScheduledOperation | None,
) -> dict[str, object] | None:
    if assignment is None:
        return None
    return {
        "machine_id": assignment.machine_id,
        "setup_start": assignment.setup_start.isoformat(),
        "start": assignment.start.isoformat(),
        "end": assignment.end.isoformat(),
    }


def _first_present(
    previous: ScheduledOperation | None,
    current: ScheduledOperation | None,
    field_name: str,
) -> object:
    if current is not None:
        return getattr(current, field_name)
    if previous is not None:
        return getattr(previous, field_name)
    return None


def _start_shift_minutes(
    previous: ScheduledOperation | None,
    current: ScheduledOperation | None,
) -> int | None:
    if previous is None or current is None:
        return None
    return int(abs((current.start - previous.start).total_seconds()) // 60)


def _top_change_reasons(operation_changes: list[dict[str, object]]) -> list[dict[str, object]]:
    counts: dict[str, int] = {}
    for change in operation_changes:
        for reason in change["change_reasons"]:
            if reason in {"unchanged", "frozen", "impacted"}:
                continue
            counts[str(reason)] = counts.get(str(reason), 0) + 1
    return [
        {"reason": reason, "count": count}
        for reason, count in sorted(
            counts.items(),
            key=lambda item: (-item[1], item[0]),
        )
    ]


def _status(
    *,
    frozen_changed_count: int,
    non_impacted_changed_count: int,
    stability_ratio: float,
) -> str:
    if frozen_changed_count > 0:
        return "frozen_changed"
    if non_impacted_changed_count > 0:
        return "nervous"
    if stability_ratio < 0.8:
        return "changed"
    return "stable"
