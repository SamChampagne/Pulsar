"""Planner-facing WIP / firm / frozen classification helpers."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from ...domain.value_objects import (
    ExecutionStatus,
    OperationStatus,
    PlanningLock,
    PlanningZone,
)


@dataclass(frozen=True, slots=True)
class PlanningDisposition:
    execution_status: ExecutionStatus
    planning_lock: PlanningLock
    planning_zone: PlanningZone
    movable: bool
    override_required: bool
    lock_reason: str
    required_override_action: str | None = None
    override_policy: dict[str, object] = field(default_factory=dict)

    def as_dict(self) -> dict[str, object]:
        return {
            "execution_status": self.execution_status.value,
            "planning_lock": self.planning_lock.value,
            "planning_zone": self.planning_zone.value,
            "movable": self.movable,
            "override_required": self.override_required,
            "lock_reason": self.lock_reason,
            "required_override_action": self.required_override_action,
            "override_policy": dict(self.override_policy),
        }


def classify_planning_disposition(
    *,
    operation_status: OperationStatus | None,
    operation_id: str,
    actual_start: datetime | None = None,
    actual_end: datetime | None = None,
    remaining_duration_minutes: int | None = None,
    firm_until: datetime | None = None,
    frozen_until: datetime | None = None,
    reference_time: datetime | None = None,
    manual_pinned_operation_ids: set[str] | None = None,
    firm_operation_ids: set[str] | None = None,
    soft_locked_operation_ids: set[str] | None = None,
) -> PlanningDisposition:
    """Return a normalized planner interaction policy for one operation."""

    manual_pinned_operation_ids = manual_pinned_operation_ids or set()
    firm_operation_ids = firm_operation_ids or set()
    soft_locked_operation_ids = soft_locked_operation_ids or set()
    execution_status = _execution_status(
        operation_status,
        actual_start=actual_start,
        actual_end=actual_end,
        remaining_duration_minutes=remaining_duration_minutes,
    )
    reference_time = reference_time or actual_start

    if execution_status is ExecutionStatus.COMPLETED:
        return PlanningDisposition(
            execution_status=execution_status,
            planning_lock=PlanningLock.COMPLETED_FROZEN,
            planning_zone=PlanningZone.FROZEN,
            movable=False,
            override_required=False,
            lock_reason="Operation is completed and cannot be rescheduled.",
            override_policy=_override_policy(
                move_policy="blocked",
                severity="completed_history",
                message="Completed operations are immutable history.",
            ),
        )
    if execution_status in {
        ExecutionStatus.IN_PROGRESS,
        ExecutionStatus.PARTIALLY_COMPLETED,
    }:
        remaining_text = (
            f" Remaining work: {remaining_duration_minutes} minutes."
            if remaining_duration_minutes is not None
            else ""
        )
        return PlanningDisposition(
            execution_status=execution_status,
            planning_lock=PlanningLock.STARTED_FROZEN,
            planning_zone=PlanningZone.FROZEN,
            movable=False,
            override_required=False,
            lock_reason=(
                "Operation has started; only disruption/WIP repair may reason "
                f"about remaining work.{remaining_text}"
            ),
            override_policy=_override_policy(
                move_policy="blocked",
                severity="actual_wip",
                message=(
                    "Started operations cannot be dragged directly; use WIP "
                    "repair/disruption workflows."
                ),
            ),
        )
    if _fence_active(frozen_until, reference_time):
        return PlanningDisposition(
            execution_status=execution_status,
            planning_lock=PlanningLock.FIRM,
            planning_zone=PlanningZone.FROZEN,
            movable=False,
            override_required=False,
            lock_reason=(
                "Operation is inside the frozen planning fence until "
                f"{frozen_until.isoformat()}."
            ),
            override_policy=_override_policy(
                move_policy="blocked",
                severity="hard_frozen_fence",
                message="Hard frozen fence blocks planner moves.",
            ),
        )
    if operation_id in manual_pinned_operation_ids:
        return PlanningDisposition(
            execution_status=execution_status,
            planning_lock=PlanningLock.MANUAL_PINNED,
            planning_zone=PlanningZone.FROZEN,
            movable=False,
            override_required=True,
            lock_reason="Operation was manually pinned by a planner action.",
            required_override_action="unfreeze_operation",
            override_policy=_override_policy(
                move_policy="override_required",
                severity="manual_pin",
                message="Manual pin must be released before moving this operation.",
                required_action="unfreeze_operation",
            ),
        )
    if operation_id in firm_operation_ids or _fence_active(firm_until, reference_time):
        reason = (
            f"Operation is firmed until {firm_until.isoformat()}."
            if _fence_active(firm_until, reference_time)
            else "Operation was firmed from the baseline schedule."
        )
        return PlanningDisposition(
            execution_status=execution_status,
            planning_lock=PlanningLock.FIRM,
            planning_zone=PlanningZone.FROZEN,
            movable=False,
            override_required=True,
            lock_reason=reason,
            required_override_action="unfreeze_operation",
            override_policy=_override_policy(
                move_policy="override_required",
                severity="firm_fence",
                message="Firm operations require an explicit unfreeze action.",
                required_action="unfreeze_operation",
            ),
        )
    if operation_id in soft_locked_operation_ids:
        return PlanningDisposition(
            execution_status=execution_status,
            planning_lock=PlanningLock.SOFT_LOCKED,
            planning_zone=PlanningZone.SLUSHY,
            movable=True,
            override_required=False,
            lock_reason="Operation carries a planner preference; moves should be reviewed for nervousness.",
            override_policy=_override_policy(
                move_policy="review_required",
                severity="slushy_soft_lock",
                message=(
                    "Soft-locked/slushy operations can move, but the UI should "
                    "surface stability impact before publish."
                ),
                review_required=True,
                publish_review_required=True,
            ),
        )
    return PlanningDisposition(
        execution_status=execution_status,
        planning_lock=PlanningLock.FREE,
        planning_zone=PlanningZone.LIQUID,
        movable=True,
        override_required=False,
        lock_reason="Operation is free for interactive planning.",
        override_policy=_override_policy(
            move_policy="allowed",
            severity="none",
            message="Operation can be moved through preview/apply workflows.",
        ),
    )


def _execution_status(
    operation_status: OperationStatus | None,
    *,
    actual_start: datetime | None,
    actual_end: datetime | None,
    remaining_duration_minutes: int | None,
) -> ExecutionStatus:
    if operation_status is OperationStatus.COMPLETED or actual_end is not None:
        return ExecutionStatus.COMPLETED
    if (
        operation_status is OperationStatus.IN_PROGRESS
        or (actual_start is not None and actual_end is None)
    ):
        return ExecutionStatus.IN_PROGRESS
    if remaining_duration_minutes is not None:
        return ExecutionStatus.PARTIALLY_COMPLETED
    if operation_status is OperationStatus.SCHEDULED:
        return ExecutionStatus.QUEUED
    return ExecutionStatus.NOT_STARTED


def _fence_active(fence_until: datetime | None, reference_time: datetime | None) -> bool:
    if fence_until is None or reference_time is None:
        return False
    return reference_time < fence_until


def _override_policy(
    *,
    move_policy: str,
    severity: str,
    message: str,
    required_action: str | None = None,
    review_required: bool = False,
    publish_review_required: bool = False,
) -> dict[str, object]:
    return {
        "version": "planner-override-policy-v1",
        "move_policy": move_policy,
        "severity": severity,
        "required_action": required_action,
        "review_required": review_required,
        "publish_review_required": publish_review_required,
        "message": message,
    }
