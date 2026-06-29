"""Scheduling policy for WIP, firm and frozen operation locks.

This module bridges planner/MES operation state into the existing
``FrozenAssignment`` mechanism. It deliberately does not place operations by
itself; it only decides which baseline assignments must remain immovable before
the selected scheduling strategy runs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ...domain.entities import Operation, Schedule, ScheduledOperation, WorkOrder
from ...domain.scheduling import FrozenAssignment
from ...domain.value_objects import OperationStatus, TimeWindow
from .planner_actions import PlannerAction


@dataclass(frozen=True, slots=True)
class WipExecutionProgress:
    actual_consumed_minutes: int | None
    planned_remaining_minutes: int | None
    total_duration_minutes: int
    repair_mode: str

    def as_dict(self) -> dict[str, object]:
        return {
            "actual_consumed_minutes": self.actual_consumed_minutes,
            "planned_remaining_minutes": self.planned_remaining_minutes,
            "total_duration_minutes": self.total_duration_minutes,
            "repair_mode": self.repair_mode,
        }


@dataclass(frozen=True, slots=True)
class PlanningPolicyLock:
    operation_id: str
    lock_type: str
    reason: str
    override_allowed: bool
    baseline_assignment_found: bool
    lock_source: str
    wip_progress: WipExecutionProgress | None = None
    fence_until: datetime | None = None

    def as_dict(self) -> dict[str, object]:
        return {
            "operation_id": self.operation_id,
            "lock_type": self.lock_type,
            "reason": self.reason,
            "override_allowed": self.override_allowed,
            "baseline_assignment_found": self.baseline_assignment_found,
            "lock_source": self.lock_source,
            "wip_progress": (
                self.wip_progress.as_dict()
                if self.wip_progress is not None
                else None
            ),
            "fence_until": self.fence_until.isoformat()
            if self.fence_until is not None
            else None,
        }


@dataclass(frozen=True, slots=True)
class PlanningPolicyResult:
    frozen_assignments: list[FrozenAssignment] = field(default_factory=list)
    locks: tuple[PlanningPolicyLock, ...] = ()
    unfreeze_operation_ids: tuple[str, ...] = ()

    @property
    def active_lock_count(self) -> int:
        return len(self.locks)

    @property
    def frozen_assignment_count(self) -> int:
        return len(self.frozen_assignments)

    def as_dict(self) -> dict[str, object]:
        counts: dict[str, int] = {}
        source_counts: dict[str, int] = {}
        missing_baseline: list[str] = []
        actual_shop_floor: list[str] = []
        wip_progress: dict[str, dict[str, object]] = {}
        for lock in self.locks:
            counts[lock.lock_type] = counts.get(lock.lock_type, 0) + 1
            source_counts[lock.lock_source] = source_counts.get(lock.lock_source, 0) + 1
            if lock.lock_source == "missing_baseline":
                missing_baseline.append(lock.operation_id)
            if lock.lock_source == "actual_shop_floor":
                actual_shop_floor.append(lock.operation_id)
            if lock.wip_progress is not None:
                wip_progress[lock.operation_id] = lock.wip_progress.as_dict()
        return {
            "version": "planning-policy-v1",
            "active_lock_count": self.active_lock_count,
            "frozen_assignment_count": self.frozen_assignment_count,
            "lock_type_counts": counts,
            "lock_source_counts": source_counts,
            "unfreeze_operation_ids": list(self.unfreeze_operation_ids),
            "missing_baseline_assignment_operation_ids": sorted(missing_baseline),
            "actual_shop_floor_assignment_operation_ids": sorted(actual_shop_floor),
            "wip_progress": wip_progress,
            "locks": [lock.as_dict() for lock in self.locks],
        }


def build_planning_policy(
    *,
    work_orders: list[WorkOrder],
    baseline_schedule: Schedule | None,
    planner_actions: list[PlannerAction],
) -> PlanningPolicyResult:
    """Return operation locks that must be enforced by the scheduler.

    Baseline assignments remain the preferred physical placement source. When
    no baseline exists, a WIP/completed operation can still be frozen if the MES
    fed both ``actual_machine_id`` and ``actual_start`` into the operation.
    """

    if baseline_schedule is None:
        locks: list[PlanningPolicyLock] = []
        frozen: list[FrozenAssignment] = []
        for operation in _operations(work_orders):
            reason = _policy_reason(operation, None)
            if reason is None:
                continue
            actual_assignment = _frozen_from_actual(operation)
            lock_source = (
                "actual_shop_floor"
                if actual_assignment is not None
                else "missing_baseline"
            )
            locks.append(
                _lock_from_reason(
                    operation=operation,
                    reason=reason,
                    baseline_assignment_found=False,
                    lock_source=lock_source,
                    missing_baseline_suffix=actual_assignment is None,
                )
            )
            if actual_assignment is not None:
                frozen.append(actual_assignment)
        return PlanningPolicyResult(
            frozen_assignments=_dedupe_frozen(frozen),
            locks=tuple(locks),
        )

    unfreeze_ids = {
        action.operation_id
        for action in planner_actions
        if action.action_type.strip().lower() == "unfreeze_operation"
        and action.operation_id
    }
    baseline_by_operation = {
        assignment.operation_id: assignment
        for assignment in baseline_schedule.assignments
    }

    locks: list[PlanningPolicyLock] = []
    frozen: list[FrozenAssignment] = []
    for operation in _operations(work_orders):
        assignment = baseline_by_operation.get(operation.id)
        reason = _policy_reason(operation, assignment)
        if reason is None:
            continue
        _, _, override_allowed, _ = reason
        if override_allowed and operation.id in unfreeze_ids:
            continue
        actual_assignment = _frozen_from_actual(operation) if assignment is None else None
        lock_source = "baseline_schedule"
        if assignment is None:
            lock_source = (
                "actual_shop_floor"
                if actual_assignment is not None
                else "missing_baseline"
            )
        locks.append(
            _lock_from_reason(
                operation=operation,
                reason=reason,
                baseline_assignment_found=assignment is not None,
                lock_source=lock_source,
                missing_baseline_suffix=(
                    assignment is None and actual_assignment is None
                ),
            )
        )
        if assignment is not None:
            frozen.append(_frozen_from_assignment(assignment))
        elif actual_assignment is not None:
            frozen.append(actual_assignment)

    return PlanningPolicyResult(
        frozen_assignments=_dedupe_frozen(frozen),
        locks=tuple(locks),
        unfreeze_operation_ids=tuple(sorted(unfreeze_ids)),
    )


def _operations(work_orders: list[WorkOrder]) -> list[Operation]:
    return [
        operation
        for work_order in work_orders
        for operation in work_order.operations
    ]


def _policy_reason(
    operation: Operation,
    assignment: ScheduledOperation | None,
) -> tuple[str, str, bool, datetime | None] | None:
    if operation.status is OperationStatus.COMPLETED or operation.actual_end is not None:
        return (
            "completed_frozen",
            "Operation is completed and must stay fixed.",
            False,
            None,
        )
    if (
        operation.status is OperationStatus.IN_PROGRESS
        or (operation.actual_start is not None and operation.actual_end is None)
        or operation.remaining_duration is not None
    ):
        return (
            "started_frozen",
            "Operation has WIP/remaining work and must stay fixed for this solve.",
            False,
            None,
        )
    if assignment is None:
        return None
    if (
        operation.frozen_until is not None
        and assignment.start < operation.frozen_until
    ):
        return (
            "frozen_fence",
            "Operation starts inside the hard frozen planning fence.",
            False,
            operation.frozen_until,
        )
    if operation.firm_until is not None and assignment.start < operation.firm_until:
        return (
            "firm_fence",
            "Operation starts inside the firm planning fence.",
            True,
            operation.firm_until,
        )
    return None


def _lock_from_reason(
    *,
    operation: Operation,
    reason: tuple[str, str, bool, datetime | None],
    baseline_assignment_found: bool,
    lock_source: str,
    missing_baseline_suffix: bool = False,
) -> PlanningPolicyLock:
    lock_type, message, override_allowed, fence_until = reason
    if missing_baseline_suffix:
        message = f"{message} No baseline assignment or actual machine is available to freeze."
    return PlanningPolicyLock(
        operation_id=operation.id,
        lock_type=lock_type,
        reason=message,
        override_allowed=override_allowed,
        baseline_assignment_found=baseline_assignment_found,
        lock_source=lock_source,
        wip_progress=_wip_progress(operation, lock_type),
        fence_until=fence_until,
    )


def _frozen_from_assignment(assignment: ScheduledOperation) -> FrozenAssignment:
    return FrozenAssignment(
        operation_id=assignment.operation_id,
        work_order_id=assignment.work_order_id,
        machine_id=assignment.machine_id,
        setup_start=assignment.setup_start,
        start=assignment.start,
        end=assignment.end,
        segments=assignment.segments,
    )


def _frozen_from_actual(operation: Operation) -> FrozenAssignment | None:
    if operation.actual_start is None or operation.actual_machine_id is None:
        return None
    end = operation.actual_end
    segments: tuple[TimeWindow, ...] = ()
    if end is not None:
        segments = (TimeWindow(start=operation.actual_start, end=end),)
    elif operation.remaining_duration is not None:
        consumed_minutes = max(
            operation.duration.minutes - operation.remaining_duration.minutes,
            0,
        )
        remaining_start = operation.actual_start + timedelta(minutes=consumed_minutes)
        end = remaining_start + timedelta(minutes=operation.remaining_duration.minutes)
        segment_items: list[TimeWindow] = []
        if consumed_minutes > 0:
            segment_items.append(
                TimeWindow(start=operation.actual_start, end=remaining_start)
            )
        if operation.remaining_duration.minutes > 0:
            segment_items.append(TimeWindow(start=remaining_start, end=end))
        segments = tuple(segment_items)
    else:
        end = operation.actual_start + timedelta(minutes=operation.duration.minutes)
        segments = (TimeWindow(start=operation.actual_start, end=end),)
    return FrozenAssignment(
        operation_id=operation.id,
        work_order_id=operation.work_order_id,
        machine_id=operation.actual_machine_id,
        setup_start=operation.actual_start,
        start=operation.actual_start,
        end=end,
        segments=segments,
    )


def _wip_progress(
    operation: Operation,
    lock_type: str,
) -> WipExecutionProgress | None:
    if lock_type not in {"started_frozen", "completed_frozen"}:
        return None
    if operation.actual_start is not None and operation.actual_end is not None:
        consumed = int(
            (operation.actual_end - operation.actual_start).total_seconds() // 60
        )
        return WipExecutionProgress(
            actual_consumed_minutes=consumed,
            planned_remaining_minutes=0,
            total_duration_minutes=operation.duration.minutes,
            repair_mode="completed_actual_history",
        )
    if operation.remaining_duration is not None:
        remaining = operation.remaining_duration.minutes
        return WipExecutionProgress(
            actual_consumed_minutes=max(operation.duration.minutes - remaining, 0),
            planned_remaining_minutes=remaining,
            total_duration_minutes=operation.duration.minutes,
            repair_mode="actual_history_plus_remaining_frozen",
        )
    return WipExecutionProgress(
        actual_consumed_minutes=None,
        planned_remaining_minutes=None,
        total_duration_minutes=operation.duration.minutes,
        repair_mode="full_started_operation_frozen",
    )


def _dedupe_frozen(items: list[FrozenAssignment]) -> list[FrozenAssignment]:
    by_operation: dict[str, FrozenAssignment] = {}
    for item in items:
        by_operation[item.operation_id] = item
    return list(by_operation.values())
