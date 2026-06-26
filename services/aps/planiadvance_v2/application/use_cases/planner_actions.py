"""Planner action language.

This module applies explicit planner choices before a scheduling run without
duplicating solver logic. It converts user/planner intent into normal engine
inputs: adjusted work orders and frozen assignments.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from typing import Any

from ...domain.entities import Machine, Operation, Schedule, WorkingCalendar, WorkOrder
from ...domain.errors import ValidationError
from ...domain.scheduling import FrozenAssignment
from ...domain.scheduling.calendar_resolver import CalendarResolver
from ...domain.scheduling.placement_helpers import adjust_duration_for_efficiency
from ...domain.value_objects import Priority, TimeWindow


@dataclass(frozen=True, slots=True)
class PlannerAction:
    action_type: str
    operation_id: str | None = None
    work_order_id: str | None = None
    machine_id: str | None = None
    calendar_id: str | None = None
    due_date: datetime | None = None
    setup_start: datetime | None = None
    start: datetime | None = None
    end: datetime | None = None
    priority: int | str | Priority | None = None
    reason: str | None = None

    def as_dict(self) -> dict[str, object]:
        return {
            "action_type": self.action_type,
            "operation_id": self.operation_id,
            "work_order_id": self.work_order_id,
            "machine_id": self.machine_id,
            "calendar_id": self.calendar_id,
            "due_date": self.due_date.isoformat() if self.due_date else None,
            "setup_start": self.setup_start.isoformat() if self.setup_start else None,
            "start": self.start.isoformat() if self.start else None,
            "end": self.end.isoformat() if self.end else None,
            "priority": (
                int(self.priority)
                if isinstance(self.priority, Priority)
                else self.priority
            ),
            "reason": self.reason,
        }


@dataclass(frozen=True, slots=True)
class PlannerActionApplication:
    action: PlannerAction
    status: str
    message: str
    target_ids: tuple[str, ...] = ()
    impact: dict[str, object] = field(default_factory=dict)

    def as_dict(self) -> dict[str, object]:
        return {
            "action": self.action.as_dict(),
            "status": self.status,
            "message": self.message,
            "target_ids": list(self.target_ids),
            "impact": self.impact,
        }


@dataclass(frozen=True, slots=True)
class PlannerActionResult:
    work_orders: list[WorkOrder]
    machines: list[Machine] = field(default_factory=list)
    calendars: list[WorkingCalendar] = field(default_factory=list)
    frozen_assignments: list[FrozenAssignment] = field(default_factory=list)
    applications: list[PlannerActionApplication] = field(default_factory=list)

    @property
    def applied_count(self) -> int:
        return sum(1 for item in self.applications if item.status == "applied")

    @property
    def ignored_count(self) -> int:
        return sum(1 for item in self.applications if item.status == "ignored")

    def as_diagnostics(self) -> dict[str, object]:
        return {
            "version": "planner-actions-v1",
            "action_count": len(self.applications),
            "applied_count": self.applied_count,
            "ignored_count": self.ignored_count,
            "frozen_count": len(self.frozen_assignments),
            "machine_count": len(self.machines),
            "calendar_count": len(self.calendars),
            "standby_operation_ids": _applied_operation_ids(
                self.applications,
                "operation_standby",
            ),
            "reinserted_operation_ids": _applied_operation_ids(
                self.applications,
                "operation_reinserted_from_standby",
            ),
            "impact_report": self.impact_report(),
            "applications": [item.as_dict() for item in self.applications],
        }

    def impact_report(self) -> dict[str, object]:
        items = [
            {
                "action_type": item.action.action_type,
                "status": item.status,
                "target_ids": list(item.target_ids),
                "message": item.message,
                "impact": item.impact,
            }
            for item in self.applications
            if item.impact
        ]
        return {
            "version": "planner-action-impact-v1",
            "impact_count": len(items),
            "items": items,
        }


def _applied_operation_ids(
    applications: list[PlannerActionApplication],
    change_type: str,
) -> list[str]:
    return sorted(
        str(item.impact["operation_id"])
        for item in applications
        if item.status == "applied"
        and item.impact.get("change_type") == change_type
        and item.impact.get("operation_id")
    )


def apply_planner_actions(
    *,
    work_orders: list[WorkOrder],
    actions: list[PlannerAction],
    machines: list[Machine] | None = None,
    calendars: list[WorkingCalendar] | None = None,
    baseline_schedule: Schedule | None = None,
) -> PlannerActionResult:
    """Apply planner actions to copies of the scheduling inputs."""

    copied = [_copy_work_order(work_order) for work_order in work_orders]
    source_work_orders = [_copy_work_order(work_order) for work_order in work_orders]
    copied_machines = [_copy_machine(machine) for machine in (machines or [])]
    copied_calendars = [_copy_calendar(calendar) for calendar in (calendars or [])]
    frozen: list[FrozenAssignment] = []
    applications: list[PlannerActionApplication] = []
    for action in actions:
        action_type = action.action_type.strip().lower()
        if action_type == "exclude_work_order":
            copied, application = _exclude_work_order(copied, action)
        elif action_type == "standby_operation":
            copied, application = _standby_operation(copied, action)
        elif action_type == "reinsert_standby_operation":
            copied, application = _reinsert_standby_operation(
                copied,
                source_work_orders,
                action,
            )
        elif action_type == "change_priority":
            copied, application = _change_priority(copied, action)
        elif action_type == "override_due_date":
            copied, application = _override_due_date(copied, action)
        elif action_type == "force_machine":
            copied, application = _force_machine(copied, action)
        elif action_type == "unfreeze_operation":
            application = _unfreeze_operation(action)
        elif action_type == "freeze_operation":
            application, frozen_assignment = _freeze_operation(
                action,
                baseline_schedule=baseline_schedule,
            )
            if frozen_assignment is not None:
                frozen.append(frozen_assignment)
        elif action_type == "pin_operation_window":
            application, frozen_assignment = _pin_operation_window(
                copied,
                copied_machines,
                copied_calendars,
                action,
            )
            if frozen_assignment is not None:
                frozen.append(frozen_assignment)
        elif action_type == "add_overtime":
            copied_machines, copied_calendars, application = _add_overtime(
                copied_machines,
                copied_calendars,
                action,
            )
        else:
            application = PlannerActionApplication(
                action=action,
                status="ignored",
                message=f"Unsupported planner action {action.action_type!r}.",
            )
        applications.append(application)
    return PlannerActionResult(
        work_orders=copied,
        machines=copied_machines,
        calendars=copied_calendars,
        frozen_assignments=_dedupe_frozen(frozen),
        applications=applications,
    )


def _pin_operation_window(
    work_orders: list[WorkOrder],
    machines: list[Machine],
    calendars: list[WorkingCalendar],
    action: PlannerAction,
) -> tuple[PlannerActionApplication, FrozenAssignment | None]:
    if not action.operation_id:
        return _ignored(action, "pin_operation_window requires operation_id."), None
    if not action.machine_id:
        return _ignored(action, "pin_operation_window requires machine_id."), None
    if action.start is None or action.end is None:
        return _ignored(action, "pin_operation_window requires start and end."), None

    operation, work_order = _find_operation(work_orders, action.operation_id)
    if operation is None or work_order is None:
        return _ignored(action, f"Operation {action.operation_id!r} not found."), None

    machine = next((item for item in machines if item.id == action.machine_id), None)
    if machine is None:
        return _ignored(action, f"Machine {action.machine_id!r} not found."), None

    routing = next(
        (
            candidate
            for candidate in operation.effective_routings()
            if candidate.machine_id == action.machine_id
        ),
        None,
    )
    if routing is None:
        return _ignored(
            action,
            f"Operation {operation.id!r} cannot run on machine {action.machine_id!r}.",
        ), None

    try:
        run_window = TimeWindow(start=action.start, end=action.end)
    except ValidationError as exc:
        return _ignored(action, str(exc)), None
    if run_window.is_empty():
        return _ignored(action, "pin_operation_window requires a non-empty run window."), None

    expected_run_minutes = adjust_duration_for_efficiency(
        routing.duration,
        machine.efficiency,
    ).minutes
    if run_window.duration.minutes < expected_run_minutes:
        return _ignored(
            action,
            "pin_operation_window run window is shorter than the selected routing.",
        ), None

    setup_minutes = 0
    if routing.setup_time.minutes:
        setup_minutes = adjust_duration_for_efficiency(
            routing.setup_time,
            machine.efficiency,
        ).minutes
    setup_start = action.setup_start or (
        action.start - timedelta(minutes=setup_minutes)
    )
    try:
        frozen = FrozenAssignment(
            operation_id=operation.id,
            work_order_id=work_order.id,
            machine_id=machine.id,
            setup_start=setup_start,
            start=action.start,
            end=action.end,
        )
    except ValidationError as exc:
        return _ignored(action, str(exc)), None
    calendar_rejection = _validate_pinned_window_calendar(
        frozen=frozen,
        machine=machine,
        calendars=calendars,
    )
    if calendar_rejection is not None:
        return _ignored(action, calendar_rejection), None

    return PlannerActionApplication(
        action=action,
        status="applied",
        message=(
            f"Pinned operation {operation.id} on machine {machine.id} "
            f"from {action.start.isoformat()} to {action.end.isoformat()}."
        ),
        target_ids=(operation.id, machine.id),
        impact={
            "change_type": "operation_window_pinned",
            "operation_id": operation.id,
            "work_order_id": work_order.id,
            "machine_id": machine.id,
            "setup_start": _iso(frozen.setup_start),
            "start": _iso(frozen.start),
            "end": _iso(frozen.end),
            "expected_run_minutes": expected_run_minutes,
            "pinned_run_minutes": run_window.duration.minutes,
            "setup_minutes": int(
                (frozen.start - frozen.setup_start).total_seconds() // 60
            ),
        },
    ), frozen


def _validate_pinned_window_calendar(
    *,
    frozen: FrozenAssignment,
    machine: Machine,
    calendars: list[WorkingCalendar],
) -> str | None:
    calendar = next((item for item in calendars if item.id == machine.calendar_id), None)
    if calendar is None:
        return (
            f"pin_operation_window requires calendar {machine.calendar_id!r} "
            f"for machine {machine.id!r}."
        )
    full_window = frozen.full_window
    resolver = CalendarResolver(full_window.start, full_window.end)
    effective_windows = resolver.effective_windows(
        calendar,
        maintenance=machine.maintenance_windows,
    )
    if any(
        window.start <= full_window.start and window.end >= full_window.end
        for window in effective_windows
    ):
        return None
    return (
        "pin_operation_window must fit inside a single effective working "
        "window after machine maintenance is applied."
    )


def _exclude_work_order(
    work_orders: list[WorkOrder],
    action: PlannerAction,
) -> tuple[list[WorkOrder], PlannerActionApplication]:
    if not action.work_order_id:
        return work_orders, _ignored(action, "exclude_work_order requires work_order_id.")
    remaining = [wo for wo in work_orders if wo.id != action.work_order_id]
    if len(remaining) == len(work_orders):
        return work_orders, _ignored(action, f"Work order {action.work_order_id!r} not found.")
    removed = next(wo for wo in work_orders if wo.id == action.work_order_id)
    return remaining, PlannerActionApplication(
        action=action,
        status="applied",
        message=f"Excluded work order {action.work_order_id}.",
        target_ids=(action.work_order_id,),
        impact={
            "change_type": "work_order_excluded",
            "work_order_id": removed.id,
            "operation_count_removed": len(removed.operations),
            "removed_operation_ids": [operation.id for operation in removed.operations],
        },
    )


def _standby_operation(
    work_orders: list[WorkOrder],
    action: PlannerAction,
) -> tuple[list[WorkOrder], PlannerActionApplication]:
    if not action.operation_id:
        return work_orders, _ignored(action, "standby_operation requires operation_id.")
    updated_orders: list[WorkOrder] = []
    removed: Operation | None = None
    source_work_order: WorkOrder | None = None
    for work_order in work_orders:
        operations = []
        for operation in work_order.operations:
            if operation.id == action.operation_id:
                removed = operation
                source_work_order = work_order
                continue
            operations.append(operation)
        updated_orders.append(replace(work_order, operations=operations))
    if removed is None or source_work_order is None:
        return work_orders, _ignored(
            action,
            f"Operation {action.operation_id!r} not found.",
        )
    downstream_operation_ids = sorted(
        operation.id
        for work_order in work_orders
        for operation in work_order.operations
        if removed.id in operation.dependency_ids()
    )
    if downstream_operation_ids:
        return work_orders, _ignored(
            action,
            (
                f"Operation {removed.id!r} cannot be put on standby alone because "
                f"downstream operations still depend on it: "
                f"{', '.join(downstream_operation_ids)}. Put the whole work order "
                "or downstream chain on standby instead."
            ),
        )
    return updated_orders, PlannerActionApplication(
        action=action,
        status="applied",
        message=f"Moved operation {removed.id} to standby for this scenario.",
        target_ids=(removed.id, source_work_order.id),
        impact={
            "change_type": "operation_standby",
            "operation_id": removed.id,
            "work_order_id": source_work_order.id,
            "sequence": removed.sequence,
            "eligible_machine_ids": list(removed.eligible_machine_ids),
        },
    )


def _reinsert_standby_operation(
    work_orders: list[WorkOrder],
    source_work_orders: list[WorkOrder],
    action: PlannerAction,
) -> tuple[list[WorkOrder], PlannerActionApplication]:
    if not action.operation_id:
        return work_orders, _ignored(
            action,
            "reinsert_standby_operation requires operation_id.",
        )
    active_operation, active_work_order = _find_operation(
        work_orders,
        action.operation_id,
    )
    if active_operation is not None and active_work_order is not None:
        return work_orders, _ignored(
            action,
            f"Operation {action.operation_id!r} is already active in the scenario.",
        )
    source_operation, source_work_order = _find_operation(
        source_work_orders,
        action.operation_id,
    )
    if source_operation is None or source_work_order is None:
        return work_orders, _ignored(
            action,
            f"Operation {action.operation_id!r} not found in source work orders.",
        )

    updated_orders: list[WorkOrder] = []
    changed = False
    for work_order in work_orders:
        if work_order.id != source_work_order.id:
            updated_orders.append(work_order)
            continue
        operations = [*work_order.operations, _copy_operation(source_operation)]
        operations.sort(key=lambda item: (item.sequence, item.id))
        updated_orders.append(replace(work_order, operations=operations))
        changed = True
    if not changed:
        updated_orders.append(
            replace(
                source_work_order,
                operations=[_copy_operation(source_operation)],
            )
        )

    return updated_orders, PlannerActionApplication(
        action=action,
        status="applied",
        message=f"Reinserted standby operation {source_operation.id} into this scenario.",
        target_ids=(source_operation.id, source_work_order.id),
        impact={
            "change_type": "operation_reinserted_from_standby",
            "operation_id": source_operation.id,
            "work_order_id": source_work_order.id,
            "sequence": source_operation.sequence,
            "eligible_machine_ids": list(source_operation.eligible_machine_ids),
        },
    )


def _change_priority(
    work_orders: list[WorkOrder],
    action: PlannerAction,
) -> tuple[list[WorkOrder], PlannerActionApplication]:
    if not action.work_order_id:
        return work_orders, _ignored(action, "change_priority requires work_order_id.")
    priority = _parse_priority(action.priority)
    if priority is None:
        return work_orders, _ignored(action, "change_priority requires valid priority.")
    changed = False
    updated: list[WorkOrder] = []
    previous_priority: Priority | None = None
    for work_order in work_orders:
        if work_order.id != action.work_order_id:
            updated.append(work_order)
            continue
        previous_priority = work_order.priority
        updated.append(replace(work_order, priority=priority))
        changed = True
    if not changed:
        return work_orders, _ignored(action, f"Work order {action.work_order_id!r} not found.")
    return updated, PlannerActionApplication(
        action=action,
        status="applied",
        message=f"Changed priority for work order {action.work_order_id}.",
        target_ids=(action.work_order_id,),
        impact={
            "change_type": "priority_changed",
            "work_order_id": action.work_order_id,
            "from_priority": _priority_value(previous_priority),
            "to_priority": _priority_value(priority),
        },
    )


def _override_due_date(
    work_orders: list[WorkOrder],
    action: PlannerAction,
) -> tuple[list[WorkOrder], PlannerActionApplication]:
    if not action.work_order_id:
        return work_orders, _ignored(action, "override_due_date requires work_order_id.")
    if action.due_date is None:
        return work_orders, _ignored(action, "override_due_date requires due_date.")
    changed = False
    updated: list[WorkOrder] = []
    previous_due_date: datetime | None = None
    for work_order in work_orders:
        if work_order.id != action.work_order_id:
            updated.append(work_order)
            continue
        previous_due_date = work_order.due_date
        updated.append(replace(work_order, due_date=action.due_date))
        changed = True
    if not changed:
        return work_orders, _ignored(action, f"Work order {action.work_order_id!r} not found.")
    return updated, PlannerActionApplication(
        action=action,
        status="applied",
        message=f"Overrode due date for work order {action.work_order_id}.",
        target_ids=(action.work_order_id,),
        impact={
            "change_type": "due_date_overridden",
            "work_order_id": action.work_order_id,
            "from_due_date": _iso(previous_due_date),
            "to_due_date": _iso(action.due_date),
        },
    )


def _force_machine(
    work_orders: list[WorkOrder],
    action: PlannerAction,
) -> tuple[list[WorkOrder], PlannerActionApplication]:
    if not action.operation_id:
        return work_orders, _ignored(action, "force_machine requires operation_id.")
    if not action.machine_id:
        return work_orders, _ignored(action, "force_machine requires machine_id.")
    changed = False
    updated_orders: list[WorkOrder] = []
    previous_machine_ids: list[str] = []
    previous_routing_machine_ids: list[str] = []
    for work_order in work_orders:
        operations: list[Operation] = []
        for operation in work_order.operations:
            if operation.id != action.operation_id:
                operations.append(operation)
                continue
            previous_machine_ids = list(operation.eligible_machine_ids)
            previous_routing_machine_ids = [
                routing.machine_id for routing in operation.routings
            ]
            operations.append(_force_operation_machine(operation, action.machine_id))
            changed = True
        updated_orders.append(replace(work_order, operations=operations))
    if not changed:
        return work_orders, _ignored(action, f"Operation {action.operation_id!r} not found.")
    return updated_orders, PlannerActionApplication(
        action=action,
        status="applied",
        message=f"Forced operation {action.operation_id} to machine {action.machine_id}.",
        target_ids=(action.operation_id, action.machine_id),
        impact={
            "change_type": "machine_forced",
            "operation_id": action.operation_id,
            "from_eligible_machine_ids": previous_machine_ids,
            "to_eligible_machine_ids": [action.machine_id],
            "from_routing_machine_ids": previous_routing_machine_ids,
            "to_routing_machine_ids": [
                machine_id
                for machine_id in previous_routing_machine_ids
                if machine_id == action.machine_id
            ],
        },
    )


def _freeze_operation(
    action: PlannerAction,
    *,
    baseline_schedule: Schedule | None,
) -> tuple[PlannerActionApplication, FrozenAssignment | None]:
    if not action.operation_id:
        return _ignored(action, "freeze_operation requires operation_id."), None
    if baseline_schedule is None:
        return _ignored(action, "freeze_operation requires a baseline schedule."), None
    assignment = next(
        (
            item
            for item in baseline_schedule.assignments
            if item.operation_id == action.operation_id
        ),
        None,
    )
    if assignment is None:
        return _ignored(
            action,
            f"Operation {action.operation_id!r} not found in baseline schedule.",
        ), None
    frozen = FrozenAssignment(
        operation_id=assignment.operation_id,
        work_order_id=assignment.work_order_id,
        machine_id=assignment.machine_id,
        setup_start=assignment.setup_start,
        start=assignment.start,
        end=assignment.end,
    )
    return PlannerActionApplication(
        action=action,
        status="applied",
        message=f"Froze operation {action.operation_id} from baseline schedule.",
        target_ids=(action.operation_id,),
        impact={
            "change_type": "operation_frozen",
            "operation_id": assignment.operation_id,
            "work_order_id": assignment.work_order_id,
            "machine_id": assignment.machine_id,
            "setup_start": _iso(assignment.setup_start),
            "start": _iso(assignment.start),
            "end": _iso(assignment.end),
        },
    ), frozen


def _unfreeze_operation(action: PlannerAction) -> PlannerActionApplication:
    if not action.operation_id:
        return _ignored(action, "unfreeze_operation requires operation_id.")
    return PlannerActionApplication(
        action=action,
        status="applied",
        message=f"Released operation {action.operation_id} from repair baseline lock.",
        target_ids=(action.operation_id,),
        impact={
            "change_type": "operation_unfrozen",
            "operation_id": action.operation_id,
        },
    )


def _add_overtime(
    machines: list[Machine],
    calendars: list[WorkingCalendar],
    action: PlannerAction,
) -> tuple[list[Machine], list[WorkingCalendar], PlannerActionApplication]:
    if action.start is None or action.end is None:
        return machines, calendars, _ignored(
            action,
            "add_overtime requires start and end.",
        )
    try:
        window = TimeWindow(start=action.start, end=action.end)
    except ValidationError as exc:
        return machines, calendars, _ignored(action, str(exc))
    if window.is_empty():
        return machines, calendars, _ignored(
            action,
            "add_overtime requires a non-empty time window.",
        )
    if not action.machine_id and not action.calendar_id:
        return machines, calendars, _ignored(
            action,
            "add_overtime requires machine_id or calendar_id.",
        )
    if action.machine_id:
        return _add_machine_overtime(machines, calendars, action, window)
    return _add_calendar_overtime(machines, calendars, action, window)


def _add_machine_overtime(
    machines: list[Machine],
    calendars: list[WorkingCalendar],
    action: PlannerAction,
    window: TimeWindow,
) -> tuple[list[Machine], list[WorkingCalendar], PlannerActionApplication]:
    machine_index = next(
        (index for index, machine in enumerate(machines) if machine.id == action.machine_id),
        None,
    )
    if machine_index is None:
        return machines, calendars, _ignored(
            action,
            f"Machine {action.machine_id!r} not found.",
        )
    machine = machines[machine_index]
    calendar = next(
        (item for item in calendars if item.id == machine.calendar_id),
        None,
    )
    if calendar is None:
        return machines, calendars, _ignored(
            action,
            f"Calendar {machine.calendar_id!r} for machine {machine.id!r} not found.",
        )

    cloned_calendar_id = _unique_calendar_id(
        calendars,
        f"{calendar.id}__overtime__{machine.id}",
    )
    cloned_calendar = replace(
        calendar,
        id=cloned_calendar_id,
        name=f"{calendar.name} + overtime for {machine.id}",
        shifts=list(calendar.shifts),
        extra_windows=[*calendar.extra_windows, window],
    )
    updated_machines = list(machines)
    updated_machines[machine_index] = replace(
        machine,
        capabilities=list(machine.capabilities),
        maintenance_windows=list(machine.maintenance_windows),
        calendar_id=cloned_calendar_id,
    )
    return updated_machines, [*calendars, cloned_calendar], PlannerActionApplication(
        action=action,
        status="applied",
        message=(
            f"Added overtime window for machine {machine.id} by cloning calendar "
            f"{calendar.id}."
        ),
        target_ids=(machine.id, cloned_calendar_id),
        impact={
            "change_type": "machine_overtime_added",
            "machine_id": machine.id,
            "base_calendar_id": calendar.id,
            "effective_calendar_id": cloned_calendar_id,
            "calendar_cloned": True,
            "window": _time_window_dict(window),
            "unaffected_machine_ids": [
                item.id
                for item in machines
                if item.calendar_id == calendar.id and item.id != machine.id
            ],
        },
    )


def _add_calendar_overtime(
    machines: list[Machine],
    calendars: list[WorkingCalendar],
    action: PlannerAction,
    window: TimeWindow,
) -> tuple[list[Machine], list[WorkingCalendar], PlannerActionApplication]:
    calendar_index = next(
        (
            index
            for index, calendar in enumerate(calendars)
            if calendar.id == action.calendar_id
        ),
        None,
    )
    if calendar_index is None:
        return machines, calendars, _ignored(
            action,
            f"Calendar {action.calendar_id!r} not found.",
        )
    calendar = calendars[calendar_index]
    updated_calendars = list(calendars)
    updated_calendars[calendar_index] = replace(
        calendar,
        shifts=list(calendar.shifts),
        extra_windows=[*calendar.extra_windows, window],
    )
    affected_machines = tuple(
        machine.id for machine in machines if machine.calendar_id == calendar.id
    )
    return machines, updated_calendars, PlannerActionApplication(
        action=action,
        status="applied",
        message=f"Added overtime window to calendar {calendar.id}.",
        target_ids=(calendar.id, *affected_machines),
        impact={
            "change_type": "calendar_overtime_added",
            "calendar_id": calendar.id,
            "calendar_cloned": False,
            "window": _time_window_dict(window),
            "affected_machine_ids": list(affected_machines),
        },
    )


def _force_operation_machine(operation: Operation, machine_id: str) -> Operation:
    routings = [routing for routing in operation.routings if routing.machine_id == machine_id]
    return replace(
        operation,
        eligible_machine_ids=[machine_id],
        routings=routings,
    )


def _find_operation(
    work_orders: list[WorkOrder],
    operation_id: str,
) -> tuple[Operation | None, WorkOrder | None]:
    for work_order in work_orders:
        for operation in work_order.operations:
            if operation.id == operation_id:
                return operation, work_order
    return None, None


def _copy_work_order(work_order: WorkOrder) -> WorkOrder:
    return replace(
        work_order,
        operations=[_copy_operation(operation) for operation in work_order.operations],
    )


def _copy_machine(machine: Machine) -> Machine:
    return replace(
        machine,
        capabilities=list(machine.capabilities),
        maintenance_windows=list(machine.maintenance_windows),
    )


def _copy_calendar(calendar: WorkingCalendar) -> WorkingCalendar:
    return replace(
        calendar,
        shifts=list(calendar.shifts),
        extra_windows=list(calendar.extra_windows),
    )


def _copy_operation(operation: Operation) -> Operation:
    return replace(
        operation,
        eligible_machine_ids=list(operation.eligible_machine_ids),
        dependencies=list(operation.dependencies),
        dependency_links=list(operation.dependency_links),
        resource_requirements=list(operation.resource_requirements),
        material_requirements=list(operation.material_requirements),
        routings=list(operation.routings),
    )


def _parse_priority(value: Any) -> Priority | None:
    if isinstance(value, Priority):
        return value
    if isinstance(value, int):
        try:
            return Priority(value)
        except ValueError:
            return None
    if isinstance(value, str):
        normalized = value.strip().upper()
        try:
            return Priority[normalized]
        except KeyError:
            try:
                return Priority(int(value))
            except (TypeError, ValueError):
                return None
    return None


def _ignored(action: PlannerAction, message: str) -> PlannerActionApplication:
    return PlannerActionApplication(action=action, status="ignored", message=message)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _priority_value(value: Priority | None) -> str | None:
    return value.name.lower() if value is not None else None


def _time_window_dict(window: TimeWindow) -> dict[str, object]:
    return {
        "start": window.start.isoformat(),
        "end": window.end.isoformat(),
        "duration_minutes": window.duration.minutes,
    }


def _dedupe_frozen(items: list[FrozenAssignment]) -> list[FrozenAssignment]:
    by_operation: dict[str, FrozenAssignment] = {}
    for item in items:
        by_operation[item.operation_id] = item
    return list(by_operation.values())


def _unique_calendar_id(calendars: list[WorkingCalendar], base: str) -> str:
    existing = {calendar.id for calendar in calendars}
    if base not in existing:
        return base
    counter = 2
    while f"{base}__{counter}" in existing:
        counter += 1
    return f"{base}__{counter}"
