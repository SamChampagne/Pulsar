"""Split actual WIP into frozen history plus schedulable remaining work.

This is an application-level transform, not a new scheduling strategy. The
domain strategies already know how to honour frozen assignments; this module
uses that capability to model an operation that has started on the shop floor:

1. Insert a synthetic frozen "actual consumed" operation.
2. Replace the original operation with the remaining duration only.
3. Merge the synthetic assignment back into the original operation before the
   schedule is returned or persisted.

The API/UI still sees the canonical operation id, while the solver gets the
smaller, more realistic repair problem.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import timedelta

from ...domain.entities import (
    DependencyLink,
    DependencyType,
    Operation,
    Schedule,
    ScheduledOperation,
    WorkOrder,
)
from ...domain.scheduling import FrozenAssignment
from ...domain.value_objects import Duration, OperationStatus, TimeWindow

_ACTUAL_CONSUMED_SUFFIX = "__actual_consumed"


@dataclass(frozen=True, slots=True)
class WipRemainingSplit:
    original_operation_id: str
    synthetic_operation_id: str
    work_order_id: str
    actual_machine_id: str
    actual_start_iso: str
    actual_consumed_minutes: int
    remaining_minutes: int
    total_duration_minutes: int
    repair_mode: str = "actual_consumed_frozen_remaining_schedulable"

    def as_dict(self) -> dict:
        return {
            "operation_id": self.original_operation_id,
            "synthetic_operation_id": self.synthetic_operation_id,
            "work_order_id": self.work_order_id,
            "actual_machine_id": self.actual_machine_id,
            "actual_start": self.actual_start_iso,
            "actual_consumed_minutes": self.actual_consumed_minutes,
            "remaining_minutes": self.remaining_minutes,
            "total_duration_minutes": self.total_duration_minutes,
            "repair_mode": self.repair_mode,
        }


@dataclass(frozen=True, slots=True)
class WipRemainingSplitResult:
    work_orders: list[WorkOrder]
    frozen_assignments: list[FrozenAssignment]
    splits: tuple[WipRemainingSplit, ...]

    @property
    def has_splits(self) -> bool:
        return bool(self.splits)

    @property
    def synthetic_operation_ids(self) -> set[str]:
        return {split.synthetic_operation_id for split in self.splits}

    def as_diagnostics(self) -> dict:
        return {
            "enabled": self.has_splits,
            "split_count": len(self.splits),
            "operation_ids": [
                split.original_operation_id for split in self.splits
            ],
            "synthetic_operation_ids": [
                split.synthetic_operation_id for split in self.splits
            ],
            "splits": [split.as_dict() for split in self.splits],
        }


def split_wip_remaining(work_orders: list[WorkOrder]) -> WipRemainingSplitResult:
    """Return work orders where partial WIP is repair-ready.

    Only partial operations are transformed. Completed operations, operations
    without actual machine evidence, and operations whose remaining duration is
    zero/full keep flowing through the existing planning policy.
    """

    transformed: list[WorkOrder] = []
    frozen_assignments: list[FrozenAssignment] = []
    splits: list[WipRemainingSplit] = []

    for work_order in work_orders:
        new_operations: list[Operation] = []
        for operation in work_order.operations:
            split = _build_split(work_order, operation)
            if split is None:
                new_operations.append(operation)
                continue

            frozen_assignments.append(split[0])
            new_operations.extend(split[1])
            splits.append(split[2])

        transformed.append(replace(work_order, operations=new_operations))

    return WipRemainingSplitResult(
        work_orders=transformed,
        frozen_assignments=frozen_assignments,
        splits=tuple(splits),
    )


def merge_wip_remaining_schedule(
    schedule: Schedule,
    split_result: WipRemainingSplitResult,
) -> Schedule:
    """Fold synthetic actual-consumed assignments back into canonical ops."""

    if not split_result.has_splits:
        return schedule

    split_by_synthetic = {
        split.synthetic_operation_id: split for split in split_result.splits
    }
    split_by_original = {
        split.original_operation_id: split for split in split_result.splits
    }
    consumed_by_original: dict[str, ScheduledOperation] = {}
    passthrough: list[ScheduledOperation] = []

    for assignment in schedule.assignments:
        split = split_by_synthetic.get(assignment.operation_id)
        if split is not None:
            consumed_by_original[split.original_operation_id] = assignment
            continue
        passthrough.append(assignment)

    merged: list[ScheduledOperation] = []
    for assignment in passthrough:
        split = split_by_original.get(assignment.operation_id)
        consumed = consumed_by_original.get(assignment.operation_id)
        if split is None or consumed is None:
            merged.append(assignment)
            continue

        merged.append(
            ScheduledOperation(
                operation_id=assignment.operation_id,
                work_order_id=assignment.work_order_id,
                machine_id=assignment.machine_id,
                setup_start=consumed.setup_start,
                start=consumed.start,
                end=assignment.end,
                segments=_merge_segments(consumed, assignment),
            )
        )

    return Schedule(
        id=schedule.id,
        created_at=schedule.created_at,
        assignments=merged,
    )


def _build_split(
    work_order: WorkOrder,
    operation: Operation,
) -> tuple[FrozenAssignment, tuple[Operation, Operation], WipRemainingSplit] | None:
    if operation.status != OperationStatus.IN_PROGRESS:
        return None
    if operation.actual_start is None or operation.actual_machine_id is None:
        return None
    if operation.actual_end is not None:
        return None
    if operation.remaining_duration is None:
        return None

    remaining_minutes = operation.remaining_duration.minutes
    total_minutes = operation.duration.minutes
    consumed_minutes = total_minutes - remaining_minutes
    if consumed_minutes <= 0 or remaining_minutes <= 0:
        return None
    if remaining_minutes >= total_minutes:
        return None

    consumed_id = _actual_consumed_id(operation.id)
    actual_end = operation.actual_start + timedelta(minutes=consumed_minutes)
    consumed_window = TimeWindow(start=operation.actual_start, end=actual_end)

    consumed_operation = replace(
        operation,
        id=consumed_id,
        name=f"{operation.name} (actual consumed)",
        duration=Duration(minutes=consumed_minutes),
        eligible_machine_ids=[operation.actual_machine_id],
        setup_time=Duration.zero(),
        dependencies=list(operation.dependencies),
        dependency_links=list(operation.dependency_links),
        status=OperationStatus.SCHEDULED,
        resource_requirements=[],
        material_requirements=[],
        routings=[],
        preemptible=False,
        min_chunk=Duration.zero(),
        actual_start=None,
        actual_machine_id=None,
        actual_end=None,
        remaining_duration=None,
        firm_until=None,
        frozen_until=None,
    )
    remaining_operation = replace(
        operation,
        duration=Duration(minutes=remaining_minutes),
        setup_time=Duration.zero(),
        eligible_machine_ids=[operation.actual_machine_id],
        dependencies=list(operation.dependencies),
        dependency_links=[
            *operation.dependency_links,
            DependencyLink(
                depends_on_id=consumed_id,
                dependency_type=DependencyType.FINISH_TO_START,
            ),
        ],
        status=OperationStatus.SCHEDULED,
        routings=[],
        actual_start=None,
        actual_machine_id=None,
        actual_end=None,
        remaining_duration=None,
        frozen_until=None,
    )
    frozen = FrozenAssignment(
        operation_id=consumed_id,
        work_order_id=work_order.id,
        machine_id=operation.actual_machine_id,
        setup_start=operation.actual_start,
        start=operation.actual_start,
        end=actual_end,
        segments=(consumed_window,),
    )
    split = WipRemainingSplit(
        original_operation_id=operation.id,
        synthetic_operation_id=consumed_id,
        work_order_id=work_order.id,
        actual_machine_id=operation.actual_machine_id,
        actual_start_iso=operation.actual_start.isoformat(),
        actual_consumed_minutes=consumed_minutes,
        remaining_minutes=remaining_minutes,
        total_duration_minutes=total_minutes,
    )
    return frozen, (consumed_operation, remaining_operation), split


def _actual_consumed_id(operation_id: str) -> str:
    return f"{operation_id}{_ACTUAL_CONSUMED_SUFFIX}"


def _merge_segments(
    consumed: ScheduledOperation,
    remaining: ScheduledOperation,
) -> tuple[TimeWindow, ...]:
    consumed_segments = consumed.segments or (
        TimeWindow(start=consumed.start, end=consumed.end),
    )
    remaining_segments = remaining.segments or (
        TimeWindow(start=remaining.start, end=remaining.end),
    )
    return (*consumed_segments, *remaining_segments)
