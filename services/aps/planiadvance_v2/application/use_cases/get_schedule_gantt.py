"""Use case: build a Gantt-ready read model for a persisted schedule.

The dashboard endpoint answers "is this plan good?". This use case answers
"how should an interactive planner UI render and reason about this plan?".
It deliberately stays read-only; planner edits are modeled separately as
actions that create a preview/replan instead of mutating assignments directly.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ...domain.entities import Machine, Schedule, ScheduledOperation, WorkOrder
from ...domain.errors import ValidationError
from ...domain.scheduling.analysis import analyze_schedule
from ..ports import (
    MachineRepository,
    ScheduleRepository,
    WorkOrderRepository,
)
from .planning_disposition import (
    PlanningDisposition,
    classify_planning_disposition,
)
from .planning_validation_gate import validate_schedule_scope
from .tenant_scope import data_workspace_id_from_metadata, list_scoped

INTERACTIVE_EDIT_ACTIONS = (
    "preview_move",
    "pin_operation_window",
    "force_machine",
    "freeze_operation",
    "unfreeze_operation",
    "standby_operation",
    "reinsert_standby_operation",
    "change_priority",
    "override_due_date",
    "exclude_work_order",
)


@dataclass(frozen=True, slots=True)
class GanttSegment:
    start: datetime
    end: datetime
    segment_type: str = "run"


@dataclass(frozen=True, slots=True)
class GanttOperationItem:
    operation_id: str
    work_order_id: str
    machine_id: str
    setup_start: datetime
    start: datetime
    end: datetime
    setup_minutes: int
    run_minutes: int
    operation_name: str | None = None
    work_order_name: str | None = None
    machine_name: str | None = None
    product_id: str | None = None
    sequence: int | None = None
    release_date: datetime | None = None
    due_date: datetime | None = None
    priority: int | None = None
    status: str | None = None
    execution_status: str = "not_started"
    planning_lock: str = "free"
    planning_zone: str = "liquid"
    movable: bool = True
    override_required: bool = False
    lock_reason: str = "Operation is free for interactive planning."
    required_override_action: str | None = None
    override_policy: dict[str, object] = field(default_factory=dict)
    actual_start: datetime | None = None
    actual_machine_id: str | None = None
    actual_end: datetime | None = None
    actual_consumed_minutes: int | None = None
    remaining_duration_minutes: int | None = None
    planned_remaining_minutes: int | None = None
    wip_repair_mode: str | None = None
    firm_until: datetime | None = None
    frozen_until: datetime | None = None
    setup_family: str | None = None
    eligible_machine_ids: tuple[str, ...] = ()
    resource_requirement_ids: tuple[str, ...] = ()
    material_requirement_ids: tuple[str, ...] = ()
    dependency_ids: tuple[str, ...] = ()
    segments: tuple[GanttSegment, ...] = ()
    editable_actions: tuple[str, ...] = INTERACTIVE_EDIT_ACTIONS
    warnings: tuple[str, ...] = ()
    is_late: bool = False
    is_critical: bool = False
    is_preempted: bool = False
    baseline_machine_id: str | None = None
    baseline_start: datetime | None = None
    baseline_end: datetime | None = None
    changed_from_baseline: bool = False
    start_delta_minutes: int | None = None


@dataclass(frozen=True, slots=True)
class GanttMachineLane:
    machine_id: str
    machine_name: str | None
    calendar_id: str | None
    assignment_count: int
    setup_minutes: int
    run_minutes: int
    first_start: datetime | None = None
    last_end: datetime | None = None


@dataclass(frozen=True, slots=True)
class GanttWorkOrderLane:
    work_order_id: str
    work_order_name: str | None
    product_id: str | None
    release_date: datetime | None
    due_date: datetime | None
    priority: int | None
    status: str | None
    operation_count: int
    scheduled_operation_count: int
    is_late: bool
    # V1.2 Cas 2 — surfaced for the Gantt UI to visually distinguish
    # forecast / tentative WOs from firm ones (e.g. dashed bar
    # border). Defaults to "firm" so legacy snapshots without the
    # field render unchanged.
    firmness: str = "firm"


@dataclass(frozen=True, slots=True)
class ScheduleGanttOutput:
    schedule_id: str
    workspace_id: str
    scenario_name: str
    lifecycle_status: str
    organization_id: str | None
    horizon_start: datetime | None
    horizon_end: datetime | None
    strategy: str
    solver_status: str
    input_snapshot_hash: str
    engine_version: str
    baseline_schedule_id: str | None = None
    machine_lanes: tuple[GanttMachineLane, ...] = ()
    work_order_lanes: tuple[GanttWorkOrderLane, ...] = ()
    items: tuple[GanttOperationItem, ...] = ()
    warnings: tuple[str, ...] = ()
    interaction_contract: dict[str, object] = field(default_factory=dict)


class GetScheduleGantt:
    """Load a persisted schedule and return a UI-ready Gantt projection."""

    def __init__(
        self,
        *,
        schedules: ScheduleRepository,
        work_orders: WorkOrderRepository,
        machines: MachineRepository,
    ) -> None:
        self._schedules = schedules
        self._work_orders = work_orders
        self._machines = machines

    def execute(
        self,
        schedule_id: str,
        *,
        organization_id: str | None = None,
        baseline_schedule_id: str | None = None,
    ) -> ScheduleGanttOutput:
        schedule = self._load_schedule(schedule_id)
        metadata = self._schedules.get_metadata(schedule_id)
        validate_schedule_scope(
            metadata,
            expected_organization_id=organization_id,
            schedule_id=schedule_id,
            label="Gantt",
        )

        baseline_schedule = None
        if baseline_schedule_id:
            baseline_schedule = self._load_schedule(baseline_schedule_id)
            validate_schedule_scope(
                self._schedules.get_metadata(baseline_schedule_id),
                expected_organization_id=organization_id,
                schedule_id=baseline_schedule_id,
                label="Baseline",
            )

        return self._build_output(
            schedule=schedule,
            organization_id=organization_id,
            baseline_schedule=baseline_schedule,
            baseline_schedule_id=baseline_schedule_id,
            workspace_id=data_workspace_id_from_metadata(metadata),
            display_workspace_id=metadata.workspace_id if metadata else "default",
            scenario_name=metadata.scenario_name if metadata else "Default Scenario",
            lifecycle_status=metadata.lifecycle_status if metadata else "draft",
            horizon_start=metadata.horizon_start if metadata else None,
            horizon_end=metadata.horizon_end if metadata else None,
            strategy=metadata.strategy if metadata else "unknown",
            solver_status=metadata.solver_status if metadata else "unknown",
            input_snapshot_hash=metadata.input_snapshot_hash if metadata else "",
            engine_version=metadata.engine_version if metadata else "aps-engine.v1",
            metadata_organization_id=metadata.organization_id if metadata else None,
            diagnostics=metadata.diagnostics if metadata else {},
        )

    def build_preview(
        self,
        schedule: Schedule,
        *,
        organization_id: str | None = None,
        baseline_schedule_id: str,
        workspace_id: str | None,
        scenario_name: str,
        lifecycle_status: str,
        horizon_start: datetime | None,
        horizon_end: datetime | None,
        strategy: str,
        solver_status: str,
        input_snapshot_hash: str,
        engine_version: str,
        diagnostics: dict | None = None,
    ) -> ScheduleGanttOutput:
        """Build the same Gantt contract for a non-persisted preview schedule."""

        baseline_schedule = self._load_schedule(baseline_schedule_id)
        validate_schedule_scope(
            self._schedules.get_metadata(baseline_schedule_id),
            expected_organization_id=organization_id,
            schedule_id=baseline_schedule_id,
            label="Baseline",
        )
        return self._build_output(
            schedule=schedule,
            organization_id=organization_id,
            baseline_schedule=baseline_schedule,
            baseline_schedule_id=baseline_schedule_id,
            workspace_id=workspace_id,
            scenario_name=scenario_name,
            lifecycle_status=lifecycle_status,
            horizon_start=horizon_start,
            horizon_end=horizon_end,
            strategy=strategy,
            solver_status=solver_status,
            input_snapshot_hash=input_snapshot_hash,
            engine_version=engine_version,
            metadata_organization_id=organization_id,
            diagnostics=diagnostics or {},
        )

    def _build_output(
        self,
        *,
        schedule: Schedule,
        organization_id: str | None,
        baseline_schedule: Schedule | None,
        baseline_schedule_id: str | None,
        workspace_id: str | None,
        display_workspace_id: str | None = None,
        scenario_name: str,
        lifecycle_status: str,
        horizon_start: datetime | None,
        horizon_end: datetime | None,
        strategy: str,
        solver_status: str,
        input_snapshot_hash: str,
        engine_version: str,
        metadata_organization_id: str | None,
        diagnostics: dict,
    ) -> ScheduleGanttOutput:
        output_workspace_id = display_workspace_id or workspace_id or "default"
        work_orders = list_scoped(self._work_orders, organization_id, workspace_id)
        machines = list_scoped(self._machines, organization_id, workspace_id)
        work_order_by_id = {work_order.id: work_order for work_order in work_orders}
        machine_by_id = {machine.id: machine for machine in machines}
        operation_by_id = {
            operation.id: (work_order, operation)
            for work_order in work_orders
            for operation in work_order.operations
        }
        baseline_by_operation = _assignment_by_operation(baseline_schedule)
        lock_hints = _planning_lock_hints(diagnostics)
        wip_remaining_operation_ids = _wip_remaining_operation_ids(diagnostics)

        analysis = analyze_schedule(schedule, work_orders)
        critical_operation_ids = set(analysis.critical_path.operations)

        items = tuple(
            self._build_item(
                assignment=assignment,
                operation_lookup=operation_by_id,
                work_order_lookup=work_order_by_id,
                machine_lookup=machine_by_id,
                baseline_assignment=baseline_by_operation.get(assignment.operation_id),
                is_critical=assignment.operation_id in critical_operation_ids,
                manual_pinned_operation_ids=lock_hints["manual_pinned"],
                firm_operation_ids=lock_hints["firm"],
                soft_locked_operation_ids=lock_hints["soft_locked"],
                wip_remaining_operation_ids=wip_remaining_operation_ids,
            )
            for assignment in sorted(
                schedule.assignments,
                key=lambda item: (item.machine_id, item.setup_start, item.operation_id),
            )
        )

        warnings = tuple(_schedule_warnings(schedule, operation_by_id, machine_by_id))
        return ScheduleGanttOutput(
            schedule_id=schedule.id,
            workspace_id=output_workspace_id,
            scenario_name=scenario_name,
            lifecycle_status=lifecycle_status,
            organization_id=metadata_organization_id or organization_id,
            horizon_start=horizon_start or _horizon_start(schedule),
            horizon_end=horizon_end or _horizon_end(schedule),
            strategy=strategy,
            solver_status=solver_status,
            input_snapshot_hash=input_snapshot_hash,
            engine_version=engine_version,
            baseline_schedule_id=baseline_schedule_id,
            machine_lanes=tuple(_machine_lanes(items, machine_by_id)),
            work_order_lanes=tuple(_work_order_lanes(items, work_orders)),
            items=items,
            warnings=warnings,
            interaction_contract={
                "version": "interactive-gantt-v1",
                "assignment_mutation": "forbidden",
                "edit_flow": ["preview", "apply_to_scenario", "publish"],
                "planner_action_source": "planner_actions",
                "planning_disposition": "wip-firm-frozen-v1",
                "planner_override_policy": "planner-override-policy-v1",
                "supported_preview_actions": list(INTERACTIVE_EDIT_ACTIONS),
                "planning_locks": [
                    "free",
                    "soft_locked",
                    "manual_pinned",
                    "firm",
                    "started_frozen",
                    "completed_frozen",
                ],
                "planning_zones": ["frozen", "slushy", "liquid"],
            },
        )

    def _load_schedule(self, schedule_id: str) -> Schedule:
        schedule = self._schedules.get(schedule_id)
        if schedule is None:
            raise ValidationError(f"Schedule {schedule_id!r} not found")
        return schedule

    @staticmethod
    def _build_item(
        *,
        assignment: ScheduledOperation,
        operation_lookup,
        work_order_lookup,
        machine_lookup: dict[str, Machine],
        baseline_assignment: ScheduledOperation | None,
        is_critical: bool,
        manual_pinned_operation_ids: set[str],
        firm_operation_ids: set[str],
        soft_locked_operation_ids: set[str],
        wip_remaining_operation_ids: set[str],
    ) -> GanttOperationItem:
        work_order, operation = operation_lookup.get(
            assignment.operation_id,
            (work_order_lookup.get(assignment.work_order_id), None),
        )
        machine = machine_lookup.get(assignment.machine_id)
        setup_minutes = int((assignment.start - assignment.setup_start).total_seconds() // 60)
        run_minutes = assignment.productive_minutes
        warnings = []
        if work_order is None:
            warnings.append("work_order_missing_from_master_data")
        if operation is None:
            warnings.append("operation_missing_from_master_data")
        if machine is None:
            warnings.append("machine_missing_from_master_data")
        is_late = bool(work_order and assignment.end > work_order.due_date)
        if is_late:
            warnings.append("late_against_due_date")
        disposition = classify_planning_disposition(
            operation_status=operation.status if operation else None,
            operation_id=assignment.operation_id,
            actual_start=operation.actual_start if operation else None,
            actual_end=operation.actual_end if operation else None,
            remaining_duration_minutes=(
                operation.remaining_duration.minutes
                if operation and operation.remaining_duration is not None
                else None
            ),
            firm_until=operation.firm_until if operation else None,
            frozen_until=operation.frozen_until if operation else None,
            reference_time=assignment.start,
            manual_pinned_operation_ids=manual_pinned_operation_ids,
            firm_operation_ids=firm_operation_ids,
            soft_locked_operation_ids=soft_locked_operation_ids,
        )

        return GanttOperationItem(
            operation_id=assignment.operation_id,
            work_order_id=assignment.work_order_id,
            machine_id=assignment.machine_id,
            setup_start=assignment.setup_start,
            start=assignment.start,
            end=assignment.end,
            setup_minutes=setup_minutes,
            run_minutes=run_minutes,
            operation_name=operation.name if operation else None,
            work_order_name=work_order.name if work_order else None,
            machine_name=machine.name if machine else None,
            product_id=work_order.product_id if work_order else None,
            sequence=operation.sequence if operation else None,
            release_date=work_order.release_date if work_order else None,
            due_date=work_order.due_date if work_order else None,
            priority=int(work_order.priority) if work_order else None,
            status=operation.status.value if operation else None,
            execution_status=disposition.execution_status.value,
            planning_lock=disposition.planning_lock.value,
            planning_zone=disposition.planning_zone.value,
            movable=disposition.movable,
            override_required=disposition.override_required,
            lock_reason=disposition.lock_reason,
            required_override_action=disposition.required_override_action,
            override_policy=disposition.override_policy,
            actual_start=operation.actual_start if operation else None,
            actual_machine_id=operation.actual_machine_id if operation else None,
            actual_end=operation.actual_end if operation else None,
            actual_consumed_minutes=_actual_consumed_minutes(operation),
            remaining_duration_minutes=(
                operation.remaining_duration.minutes
                if operation and operation.remaining_duration is not None
                else None
            ),
            planned_remaining_minutes=_planned_remaining_minutes(operation),
            wip_repair_mode=_wip_repair_mode(
                operation,
                remaining_schedulable=assignment.operation_id
                in wip_remaining_operation_ids,
            ),
            firm_until=operation.firm_until if operation else None,
            frozen_until=operation.frozen_until if operation else None,
            setup_family=operation.setup_family if operation else None,
            eligible_machine_ids=tuple(operation.eligible_machine_ids) if operation else (),
            resource_requirement_ids=tuple(
                requirement.resource_id
                for requirement in (operation.resource_requirements if operation else [])
            ),
            material_requirement_ids=tuple(
                requirement.material_id
                for requirement in (operation.material_requirements if operation else [])
            ),
            dependency_ids=tuple(operation.dependency_ids()) if operation else (),
            segments=_segments(
                assignment,
                operation,
                remaining_schedulable=assignment.operation_id
                in wip_remaining_operation_ids,
            ),
            editable_actions=_editable_actions(disposition),
            warnings=tuple(warnings),
            is_late=is_late,
            is_critical=is_critical,
            is_preempted=assignment.is_preempted,
            baseline_machine_id=baseline_assignment.machine_id if baseline_assignment else None,
            baseline_start=baseline_assignment.start if baseline_assignment else None,
            baseline_end=baseline_assignment.end if baseline_assignment else None,
            changed_from_baseline=_changed_from_baseline(assignment, baseline_assignment),
            start_delta_minutes=_start_delta_minutes(assignment, baseline_assignment),
        )


def _assignment_by_operation(
    schedule: Schedule | None,
) -> dict[str, ScheduledOperation]:
    if schedule is None:
        return {}
    return {assignment.operation_id: assignment for assignment in schedule.assignments}


def _planning_lock_hints(diagnostics: dict) -> dict[str, set[str]]:
    hints = {
        "manual_pinned": set(),
        "firm": set(),
        "soft_locked": set(),
    }
    planner_actions = (
        diagnostics.get("planner_actions")
        if isinstance(diagnostics.get("planner_actions"), dict)
        else {}
    )
    for item in planner_actions.get("applications", []) or []:
        if not isinstance(item, dict) or item.get("status") != "applied":
            continue
        impact = item.get("impact")
        if not isinstance(impact, dict):
            continue
        operation_id = impact.get("operation_id")
        if not isinstance(operation_id, str) or not operation_id:
            continue
        change_type = impact.get("change_type")
        if change_type == "operation_window_pinned":
            hints["manual_pinned"].add(operation_id)
        elif change_type == "operation_frozen":
            hints["firm"].add(operation_id)
        elif change_type == "machine_forced":
            hints["soft_locked"].add(operation_id)
    return hints


def _wip_remaining_operation_ids(diagnostics: dict) -> set[str]:
    split = diagnostics.get("wip_remaining_split")
    if not isinstance(split, dict) or not split.get("enabled"):
        return set()
    return {
        operation_id
        for operation_id in split.get("operation_ids", []) or []
        if isinstance(operation_id, str) and operation_id
    }


def _editable_actions(disposition: PlanningDisposition) -> tuple[str, ...]:
    if not disposition.movable:
        if disposition.required_override_action is None:
            return ()
        return (disposition.required_override_action,)
    return INTERACTIVE_EDIT_ACTIONS


def _segments(
    assignment: ScheduledOperation,
    operation,
    *,
    remaining_schedulable: bool = False,
) -> tuple[GanttSegment, ...]:
    if operation is not None and operation.actual_start is not None:
        if operation.actual_end is not None:
            return (
                GanttSegment(
                    start=operation.actual_start,
                    end=operation.actual_end,
                    segment_type="actual_consumed",
                ),
            )
        if operation.remaining_duration is not None:
            consumed_minutes = max(
                operation.duration.minutes - operation.remaining_duration.minutes,
                0,
            )
            remaining_start = operation.actual_start + timedelta(minutes=consumed_minutes)
            segments: list[GanttSegment] = []
            if consumed_minutes > 0:
                segments.append(
                    GanttSegment(
                        start=operation.actual_start,
                        end=remaining_start,
                        segment_type="actual_consumed",
                    )
                )
            if operation.remaining_duration.minutes > 0:
                segments.append(
                    GanttSegment(
                        start=remaining_start,
                        end=assignment.end,
                        segment_type=(
                            "remaining_planned"
                            if remaining_schedulable
                            else "remaining_frozen"
                        ),
                    )
                )
            if segments:
                return tuple(segments)
    if assignment.segments:
        return tuple(
            GanttSegment(start=segment.start, end=segment.end)
            for segment in assignment.segments
        )
    return (GanttSegment(start=assignment.start, end=assignment.end),)


def _actual_consumed_minutes(operation) -> int | None:
    if operation is None or operation.actual_start is None:
        return None
    if operation.actual_end is not None:
        return int((operation.actual_end - operation.actual_start).total_seconds() // 60)
    if operation.remaining_duration is not None:
        return max(operation.duration.minutes - operation.remaining_duration.minutes, 0)
    return None


def _planned_remaining_minutes(operation) -> int | None:
    if operation is None or operation.remaining_duration is None:
        return None
    return operation.remaining_duration.minutes


def _wip_repair_mode(
    operation,
    *,
    remaining_schedulable: bool = False,
) -> str | None:
    if operation is None:
        return None
    if operation.actual_start is not None and operation.actual_end is not None:
        return "completed_actual_history"
    if operation.actual_start is not None and operation.remaining_duration is not None:
        if remaining_schedulable:
            return "actual_consumed_frozen_remaining_schedulable"
        return "actual_history_plus_remaining_frozen"
    if operation.actual_start is not None:
        return "full_started_operation_frozen"
    return None


def _changed_from_baseline(
    assignment: ScheduledOperation,
    baseline_assignment: ScheduledOperation | None,
) -> bool:
    if baseline_assignment is None:
        return False
    return (
        assignment.machine_id != baseline_assignment.machine_id
        or assignment.setup_start != baseline_assignment.setup_start
        or assignment.start != baseline_assignment.start
        or assignment.end != baseline_assignment.end
    )


def _start_delta_minutes(
    assignment: ScheduledOperation,
    baseline_assignment: ScheduledOperation | None,
) -> int | None:
    if baseline_assignment is None:
        return None
    return int((assignment.start - baseline_assignment.start).total_seconds() // 60)


def _machine_lanes(
    items: tuple[GanttOperationItem, ...],
    machine_by_id: dict[str, Machine],
) -> list[GanttMachineLane]:
    lanes = []
    for machine_id in sorted({item.machine_id for item in items}):
        machine_items = [item for item in items if item.machine_id == machine_id]
        machine = machine_by_id.get(machine_id)
        lanes.append(
            GanttMachineLane(
                machine_id=machine_id,
                machine_name=machine.name if machine else None,
                calendar_id=machine.calendar_id if machine else None,
                assignment_count=len(machine_items),
                setup_minutes=sum(item.setup_minutes for item in machine_items),
                run_minutes=sum(item.run_minutes for item in machine_items),
                first_start=min((item.setup_start for item in machine_items), default=None),
                last_end=max((item.end for item in machine_items), default=None),
            )
        )
    return lanes


def _work_order_lanes(
    items: tuple[GanttOperationItem, ...],
    work_orders: list[WorkOrder],
) -> list[GanttWorkOrderLane]:
    item_count_by_work_order: dict[str, int] = {}
    late_by_work_order: dict[str, bool] = {}
    for item in items:
        item_count_by_work_order[item.work_order_id] = (
            item_count_by_work_order.get(item.work_order_id, 0) + 1
        )
        late_by_work_order[item.work_order_id] = (
            late_by_work_order.get(item.work_order_id, False) or item.is_late
        )
    return [
        GanttWorkOrderLane(
            work_order_id=work_order.id,
            work_order_name=work_order.name,
            product_id=work_order.product_id,
            release_date=work_order.release_date,
            due_date=work_order.due_date,
            priority=int(work_order.priority),
            status=work_order.status.value,
            operation_count=len(work_order.operations),
            scheduled_operation_count=item_count_by_work_order.get(work_order.id, 0),
            is_late=late_by_work_order.get(work_order.id, False),
            firmness=work_order.firmness.value,
        )
        for work_order in sorted(work_orders, key=lambda item: item.id)
        if work_order.id in item_count_by_work_order
    ]


def _schedule_warnings(
    schedule: Schedule,
    operation_by_id,
    machine_by_id: dict[str, Machine],
) -> list[str]:
    warnings = []
    for assignment in schedule.assignments:
        if assignment.operation_id not in operation_by_id:
            warnings.append(f"operation_missing:{assignment.operation_id}")
        if assignment.machine_id not in machine_by_id:
            warnings.append(f"machine_missing:{assignment.machine_id}")
    return sorted(set(warnings))


def _horizon_start(schedule: Schedule) -> datetime | None:
    if not schedule.assignments:
        return None
    earliest = min(assignment.setup_start for assignment in schedule.assignments)
    return earliest.replace(hour=0, minute=0, second=0, microsecond=0)


def _horizon_end(schedule: Schedule) -> datetime | None:
    if not schedule.assignments:
        return None
    latest = max(assignment.end for assignment in schedule.assignments)
    return (latest + timedelta(days=1)).replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )
