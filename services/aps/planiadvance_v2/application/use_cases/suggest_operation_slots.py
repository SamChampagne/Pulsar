"""Suggest feasible Gantt slots for an operation on a persisted plan."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ...domain.entities import (
    Machine,
    Operation,
    RoutingAlternative,
    Schedule,
    ScheduledOperation,
    WorkOrder,
)
from ...domain.errors import ValidationError
from ...domain.scheduling import CalendarResolver, MaterialLedger, SlotFinder
from ...domain.scheduling.dependency_links import operation_dependency_links
from ...domain.scheduling.dependency_timing import (
    dependency_max_start,
    dependency_min_start,
)
from ...domain.scheduling.placement_helpers import adjust_duration_for_efficiency
from ...domain.scheduling.resource_aligner import (
    align_to_resources,
    book_resources,
    build_resource_timelines,
)
from ...domain.scheduling.setup_lookup import resolve_setup_minutes
from ...domain.scheduling.timeline import ResourceTimeline
from ...domain.value_objects import Duration, TransferTimes
from ..ports import (
    CalendarRepository,
    InventoryRepository,
    MachineRepository,
    ResourceRepository,
    ScheduleRepository,
    SupplyRepository,
    WorkOrderRepository,
)
from .planning_validation_gate import validate_schedule_scope
from .tenant_scope import data_workspace_id_from_metadata, list_scoped


@dataclass(frozen=True, slots=True)
class SuggestedOperationSlot:
    rank: int
    machine_id: str
    machine_name: str | None
    setup_start: datetime
    start: datetime
    end: datetime
    setup_minutes: int
    run_minutes: int
    material_ready_at: datetime | None = None
    resource_checked: bool = False
    score: int = 0
    baseline_start_delta_minutes: int | None = None
    baseline_machine_change: bool = False
    score_components: dict[str, int] = field(default_factory=dict)
    reasons: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class SlotMachineRejection:
    machine_id: str
    reason: str
    blocker: str


@dataclass(frozen=True, slots=True)
class SuggestOperationSlotsOutput:
    schedule_id: str
    operation_id: str
    generated_at: datetime
    horizon_start: datetime
    horizon_end: datetime
    baseline_assignment: dict[str, object] | None = None
    slots: tuple[SuggestedOperationSlot, ...] = ()
    rejected_machines: tuple[SlotMachineRejection, ...] = ()
    warnings: tuple[str, ...] = ()
    interaction_contract: dict[str, object] = field(default_factory=dict)


class SuggestOperationSlots:
    """Return assisted placement candidates for interactive Gantt moves."""

    def __init__(
        self,
        *,
        schedules: ScheduleRepository,
        work_orders: WorkOrderRepository,
        machines: MachineRepository,
        calendars: CalendarRepository,
        resources: ResourceRepository | None = None,
        inventory: InventoryRepository | None = None,
        supplies: SupplyRepository | None = None,
    ) -> None:
        self._schedules = schedules
        self._work_orders = work_orders
        self._machines = machines
        self._calendars = calendars
        self._resources = resources
        self._inventory = inventory
        self._supplies = supplies
        self._slot_finder = SlotFinder()

    def execute(
        self,
        schedule_id: str,
        operation_id: str,
        *,
        organization_id: str | None = None,
        search_start: datetime | None = None,
        max_results: int = 8,
    ) -> SuggestOperationSlotsOutput:
        schedule = self._load_schedule(schedule_id)
        metadata = self._schedules.get_metadata(schedule_id)
        workspace_id = data_workspace_id_from_metadata(metadata)
        validate_schedule_scope(
            metadata,
            expected_organization_id=organization_id,
            schedule_id=schedule_id,
            label="Slot suggestion",
        )
        horizon_start = metadata.horizon_start if metadata else None
        horizon_end = metadata.horizon_end if metadata else None
        horizon_start = horizon_start or _horizon_start(schedule)
        horizon_end = horizon_end or _horizon_end(schedule)
        if horizon_start is None or horizon_end is None:
            raise ValidationError("Cannot suggest slots for an empty schedule horizon")

        work_orders = list_scoped(self._work_orders, organization_id, workspace_id)
        machines = list_scoped(self._machines, organization_id, workspace_id)
        calendars = list_scoped(self._calendars, organization_id, workspace_id)
        resources = (
            list_scoped(self._resources, organization_id, workspace_id)
            if self._resources is not None
            else []
        )
        inventory_items = (
            list_scoped(self._inventory, organization_id, workspace_id)
            if self._inventory is not None
            else []
        )
        supplies = (
            list_scoped(self._supplies, organization_id, workspace_id)
            if self._supplies is not None
            else []
        )

        work_order, operation = _find_operation(work_orders, operation_id)
        calendar_by_id = {calendar.id: calendar for calendar in calendars}
        machine_by_id = {machine.id: machine for machine in machines}
        operation_by_id = {
            op.id: op for wo in work_orders for op in wo.operations
        }
        assignment_by_operation = {
            assignment.operation_id: assignment for assignment in schedule.assignments
        }
        baseline_assignment = assignment_by_operation.get(operation_id)
        base_start = max(
            search_start or horizon_start,
            horizon_start,
            work_order.release_date,
        )
        transfer_times = _transfer_times_from_metadata(metadata.transfer_times if metadata else {})

        material_ready_at, material_rejection = self._material_ready_at(
            schedule=schedule,
            target_operation=operation,
            work_order=work_order,
            work_orders=work_orders,
            inventory_items=inventory_items,
            supplies=supplies,
            horizon_start=horizon_start,
            horizon_end=horizon_end,
        )
        if material_rejection is not None:
            return SuggestOperationSlotsOutput(
                schedule_id=schedule_id,
                operation_id=operation_id,
                generated_at=datetime.utcnow(),
                horizon_start=horizon_start,
                horizon_end=horizon_end,
                baseline_assignment=_baseline_assignment_dict(baseline_assignment),
                rejected_machines=tuple(
                    SlotMachineRejection(
                        machine_id=routing.machine_id,
                        reason=material_rejection,
                        blocker="material_shortage",
                    )
                    for routing in operation.effective_routings()
                ),
                interaction_contract=_interaction_contract(),
            )
        if material_ready_at is not None:
            base_start = max(base_start, material_ready_at)

        machine_timelines = _machine_timelines(schedule, operation_id)
        resolver = CalendarResolver(horizon_start, horizon_end)
        resource_timelines = build_resource_timelines(
            resources,
            calendar_by_id,
            resolver,
        )
        _book_baseline_resources(
            schedule=schedule,
            target_operation_id=operation_id,
            operation_by_id=operation_by_id,
            resource_timelines=resource_timelines,
        )

        slots: list[SuggestedOperationSlot] = []
        rejected: list[SlotMachineRejection] = []
        for routing in operation.effective_routings():
            machine = machine_by_id.get(routing.machine_id)
            if machine is None:
                rejected.append(
                    SlotMachineRejection(
                        machine_id=routing.machine_id,
                        reason="Eligible machine is missing from master data.",
                        blocker="missing_machine",
                    )
                )
                continue
            calendar = calendar_by_id.get(machine.calendar_id)
            if calendar is None:
                rejected.append(
                    SlotMachineRejection(
                        machine_id=machine.id,
                        reason="Machine calendar is missing from master data.",
                        blocker="missing_calendar",
                    )
                )
                continue
            dependency_start, dependency_end, dependency_rejection = (
                _dependency_window_for_machine(
                    work_order=work_order,
                    operation=operation,
                    target_machine_id=machine.id,
                    assignment_by_operation=assignment_by_operation,
                    transfer_times=transfer_times,
                )
            )
            if dependency_rejection is not None:
                rejected.append(
                    SlotMachineRejection(
                        machine_id=machine.id,
                        reason=dependency_rejection,
                        blocker="dependency",
                    )
                )
                continue
            earliest = max(base_start, dependency_start)
            machine_slots = self._suggest_on_machine(
                schedule=schedule,
                operation=operation,
                routing=routing,
                machine=machine,
                calendar=calendar,
                earliest_start=earliest,
                latest_run_start=dependency_end,
                horizon_end=horizon_end,
                resolver=resolver,
                machine_timeline=machine_timelines.setdefault(
                    machine.id, ResourceTimeline(machine_id=machine.id)
                ),
                resource_timelines=resource_timelines,
                material_ready_at=material_ready_at,
                operation_by_id=operation_by_id,
                baseline_assignment=baseline_assignment,
                max_slots=max_results,
            )
            if not machine_slots:
                rejected.append(
                    SlotMachineRejection(
                        machine_id=machine.id,
                        reason="No machine/resource slot fits inside the horizon.",
                        blocker="capacity",
                    )
                )
                continue
            slots.extend(machine_slots)

        slots.sort(key=lambda item: (item.setup_start, item.machine_id))
        slots = [
            _ranked_slot(slot, rank=index + 1)
            for index, slot in enumerate(
                sorted(slots, key=lambda item: (item.score, item.setup_start, item.machine_id))
            )
        ]
        return SuggestOperationSlotsOutput(
            schedule_id=schedule_id,
            operation_id=operation_id,
            generated_at=datetime.utcnow(),
            horizon_start=horizon_start,
            horizon_end=horizon_end,
            baseline_assignment=_baseline_assignment_dict(baseline_assignment),
            slots=tuple(slots[:max_results]),
            rejected_machines=tuple(rejected),
            warnings=(
                ("preemptive_slot_suggestions_are_contiguous_only",)
                if operation.preemptible
                else ()
            ),
            interaction_contract=_interaction_contract(),
        )

    def _load_schedule(self, schedule_id: str) -> Schedule:
        schedule = self._schedules.get(schedule_id)
        if schedule is None:
            raise ValidationError(f"Schedule {schedule_id!r} not found")
        return schedule

    def _material_ready_at(
        self,
        *,
        schedule: Schedule,
        target_operation: Operation,
        work_order: WorkOrder,
        work_orders: list[WorkOrder],
        inventory_items,
        supplies,
        horizon_start: datetime,
        horizon_end: datetime,
    ) -> tuple[datetime | None, str | None]:
        ledger = MaterialLedger(
            inventory_items=inventory_items,
            supplies=supplies,
            horizon_start=horizon_start,
        )
        operation_by_id = {
            operation.id: operation
            for item in work_orders
            for operation in item.operations
        }
        quantity_by_operation = {
            operation.id: item.quantity
            for item in work_orders
            for operation in item.operations
        }
        for assignment in sorted(
            schedule.assignments,
            key=lambda item: (item.start, item.operation_id),
        ):
            if assignment.operation_id == target_operation.id:
                continue
            operation = operation_by_id.get(assignment.operation_id)
            if operation is None or not operation.material_requirements:
                continue
            ledger.reserve(
                operation_id=assignment.operation_id,
                requirements=operation.material_requirements,
                work_order_quantity=quantity_by_operation.get(operation.id, 1),
                required_at=assignment.start,
                reservation_origin="baseline",
            )
        assessment = ledger.assess(
            requirements=target_operation.material_requirements,
            work_order_quantity=work_order.quantity,
            not_before=max(horizon_start, work_order.release_date),
            horizon_end=horizon_end,
        )
        if assessment.ready_at is None:
            return (
                None,
                f"Material {assessment.blocking_material_id!r} is not available inside the horizon.",
            )
        return assessment.ready_at, None

    def _suggest_on_machine(
        self,
        *,
        schedule: Schedule,
        operation: Operation,
        routing: RoutingAlternative,
        machine: Machine,
        calendar,
        earliest_start: datetime,
        latest_run_start: datetime | None,
        horizon_end: datetime,
        resolver: CalendarResolver,
        machine_timeline: ResourceTimeline,
        resource_timelines,
        material_ready_at: datetime | None,
        operation_by_id: dict[str, Operation],
        baseline_assignment: ScheduledOperation | None,
        max_slots: int,
    ) -> list[SuggestedOperationSlot]:
        if routing.duration.minutes <= 0:
            return []
        run_minutes = adjust_duration_for_efficiency(
            routing.duration,
            machine.efficiency,
        ).minutes
        windows = resolver.effective_windows(
            calendar,
            maintenance=machine.maintenance_windows,
        )
        slots: list[SuggestedOperationSlot] = []
        current_start = earliest_start
        attempts = 0
        while len(slots) < max_slots and attempts < max(max_slots * 8, 8):
            attempts += 1
            setup_minutes = _setup_minutes_for_slot(
                schedule=schedule,
                operation=operation,
                routing=routing,
                machine=machine,
                candidate_start=current_start,
                target_operation_id=operation.id,
                operation_by_id=operation_by_id,
            )
            needed = Duration(minutes=max(run_minutes + setup_minutes, 1))
            slot = self._slot_finder.find(
                earliest_start=current_start,
                required=needed,
                working_windows=windows,
                timeline=machine_timeline,
            )
            if slot is None:
                return slots
            actual_setup_minutes = _setup_minutes_for_slot(
                schedule=schedule,
                operation=operation,
                routing=routing,
                machine=machine,
                candidate_start=slot.start,
                target_operation_id=operation.id,
                operation_by_id=operation_by_id,
            )
            if actual_setup_minutes != setup_minutes:
                current_start = slot.start
                continue
            aligned = align_to_resources(
                earliest_start=slot.start,
                duration=needed,
                operation=operation,
                timelines=resource_timelines,
                horizon_end=horizon_end,
                requirements=routing.resource_requirements,
            )
            if aligned is None:
                return slots
            if aligned != slot.start:
                current_start = aligned
                continue
            run_start = slot.start + timedelta(minutes=setup_minutes)
            if latest_run_start is not None and run_start > latest_run_start:
                return slots
            baseline_delta = (
                int((run_start - baseline_assignment.start).total_seconds() // 60)
                if baseline_assignment is not None
                else None
            )
            components = _score_components(
                setup_start=slot.start,
                earliest_start=earliest_start,
                setup_minutes=setup_minutes,
                baseline_start_delta_minutes=baseline_delta,
                baseline_machine_change=(
                    baseline_assignment is not None
                    and baseline_assignment.machine_id != machine.id
                ),
            )
            slots.append(SuggestedOperationSlot(
                rank=0,
                machine_id=machine.id,
                machine_name=machine.name,
                setup_start=slot.start,
                start=run_start,
                end=slot.end,
                setup_minutes=setup_minutes,
                run_minutes=run_minutes,
                material_ready_at=material_ready_at,
                resource_checked=bool(routing.resource_requirements),
                score=sum(components.values()),
                baseline_start_delta_minutes=baseline_delta,
                baseline_machine_change=(
                    baseline_assignment is not None
                    and baseline_assignment.machine_id != machine.id
                ),
                score_components=components,
                reasons=tuple(
                    reason
                    for reason in [
                        "machine_calendar_available",
                        "baseline_conflicts_avoided",
                        "machine_change_from_baseline"
                        if baseline_assignment is not None
                        and baseline_assignment.machine_id != machine.id
                        else "same_machine_as_baseline"
                        if baseline_assignment is not None
                        else "",
                        "secondary_resources_checked"
                        if routing.resource_requirements
                        else "",
                        "material_available"
                        if operation.material_requirements
                        else "",
                    ]
                    if reason
                ),
            ))
            current_start = slot.end
        return slots


def _find_operation(
    work_orders: list[WorkOrder],
    operation_id: str,
) -> tuple[WorkOrder, Operation]:
    for work_order in work_orders:
        for operation in work_order.operations:
            if operation.id == operation_id:
                return work_order, operation
    raise ValidationError(f"Operation {operation_id!r} not found")


def _machine_timelines(
    schedule: Schedule,
    target_operation_id: str,
) -> dict[str, ResourceTimeline]:
    timelines: dict[str, ResourceTimeline] = {}
    for assignment in schedule.assignments:
        timeline = timelines.setdefault(
            assignment.machine_id,
            ResourceTimeline(machine_id=assignment.machine_id),
        )
        if assignment.operation_id == target_operation_id:
            continue
        timeline.book(assignment.full_window, assignment.operation_id)
    return timelines


def _book_baseline_resources(
    *,
    schedule: Schedule,
    target_operation_id: str,
    operation_by_id: dict[str, Operation],
    resource_timelines,
) -> None:
    for assignment in schedule.assignments:
        if assignment.operation_id == target_operation_id:
            continue
        operation = operation_by_id.get(assignment.operation_id)
        if operation is None:
            continue
        book_resources(
            window=assignment.full_window,
            operation=operation,
            timelines=resource_timelines,
            requirements=_requirements_for_assignment(operation, assignment),
        )


def _requirements_for_assignment(
    operation: Operation,
    assignment: ScheduledOperation,
):
    routing = next(
        (
            candidate
            for candidate in operation.effective_routings()
            if candidate.machine_id == assignment.machine_id
        ),
        None,
    )
    if routing is not None:
        return routing.resource_requirements
    return operation.resource_requirements


def _dependency_window_for_machine(
    *,
    work_order: WorkOrder,
    operation: Operation,
    target_machine_id: str,
    assignment_by_operation: dict[str, ScheduledOperation],
    transfer_times: TransferTimes,
) -> tuple[datetime, datetime | None, str | None]:
    earliest = work_order.release_date
    latest: datetime | None = None
    for link in operation_dependency_links(work_order, operation):
        predecessor = assignment_by_operation.get(link.depends_on_id)
        if predecessor is None:
            return (
                earliest,
                latest,
                f"Predecessor operation {link.depends_on_id!r} is not scheduled.",
            )
        transfer = transfer_times.minutes(predecessor.machine_id, target_machine_id)
        min_start = dependency_min_start(
            link,
            predecessor_start=predecessor.start,
            predecessor_end=predecessor.end,
            transfer_minutes=transfer,
        )
        earliest = max(earliest, min_start)
        max_start = dependency_max_start(
            link,
            predecessor_start=predecessor.start,
            predecessor_end=predecessor.end,
        )
        if max_start is not None:
            latest = max_start if latest is None else min(latest, max_start)
    return earliest, latest, None


def _setup_minutes_for_slot(
    *,
    schedule: Schedule,
    operation: Operation,
    routing: RoutingAlternative,
    machine: Machine,
    candidate_start: datetime,
    target_operation_id: str,
    operation_by_id: dict[str, Operation],
) -> int:
    previous_family = _previous_family_on_machine(
        schedule=schedule,
        machine_id=machine.id,
        before=candidate_start,
        target_operation_id=target_operation_id,
        operation_by_id=operation_by_id,
    )
    raw = resolve_setup_minutes(
        operation=operation,
        machine=machine,
        previous_family=previous_family,
        default_minutes=routing.setup_time.minutes,
    )
    return max(int(round(raw / machine.efficiency)) if machine.efficiency else 0, 0)


def _previous_family_on_machine(
    *,
    schedule: Schedule,
    machine_id: str,
    before: datetime,
    target_operation_id: str,
    operation_by_id: dict[str, Operation],
) -> str | None:
    candidates = [
        assignment
        for assignment in schedule.assignments
        if assignment.machine_id == machine_id
        and assignment.operation_id != target_operation_id
        and assignment.end <= before
    ]
    if not candidates:
        return None
    previous = max(candidates, key=lambda item: item.end)
    operation = operation_by_id.get(previous.operation_id)
    return operation.setup_family if operation is not None else None


def _baseline_assignment_dict(
    assignment: ScheduledOperation | None,
) -> dict[str, object] | None:
    if assignment is None:
        return None
    return {
        "operation_id": assignment.operation_id,
        "work_order_id": assignment.work_order_id,
        "machine_id": assignment.machine_id,
        "setup_start": assignment.setup_start.isoformat(),
        "start": assignment.start.isoformat(),
        "end": assignment.end.isoformat(),
    }


def _interaction_contract() -> dict[str, object]:
    return {
        "version": "interactive-gantt-v1",
        "assignment_mutation": "forbidden",
        "slot_usage": "preview_move_before_apply",
        "preview_endpoint": "POST /scheduling/runs/{schedule_id}/edits/preview",
        "apply_endpoint": "POST /scheduling/runs/{schedule_id}/edits/apply",
        "ranking": {
            "score": "lower_is_better",
            "components": [
                "wait_minutes",
                "setup_minutes",
                "baseline_start_shift_minutes",
                "baseline_machine_change_penalty",
            ],
        },
    }


def _ranked_slot(slot: SuggestedOperationSlot, *, rank: int) -> SuggestedOperationSlot:
    return SuggestedOperationSlot(
        rank=rank,
        machine_id=slot.machine_id,
        machine_name=slot.machine_name,
        setup_start=slot.setup_start,
        start=slot.start,
        end=slot.end,
        setup_minutes=slot.setup_minutes,
        run_minutes=slot.run_minutes,
        material_ready_at=slot.material_ready_at,
        resource_checked=slot.resource_checked,
        score=slot.score,
        baseline_start_delta_minutes=slot.baseline_start_delta_minutes,
        baseline_machine_change=slot.baseline_machine_change,
        score_components=dict(slot.score_components),
        reasons=slot.reasons,
    )


def _score_components(
    *,
    setup_start: datetime,
    earliest_start: datetime,
    setup_minutes: int,
    baseline_start_delta_minutes: int | None,
    baseline_machine_change: bool,
) -> dict[str, int]:
    wait_minutes = max(
        int((setup_start - earliest_start).total_seconds() // 60),
        0,
    )
    start_shift = (
        abs(baseline_start_delta_minutes)
        if baseline_start_delta_minutes is not None
        else 0
    )
    return {
        "wait_minutes": wait_minutes,
        "setup_minutes": max(setup_minutes, 0),
        "baseline_start_shift_minutes": start_shift,
        "baseline_machine_change_penalty": 120 if baseline_machine_change else 0,
    }


def _transfer_times_from_metadata(data: dict) -> TransferTimes:
    if not isinstance(data, dict):
        return TransferTimes()
    pairs = {}
    for item in data.get("pairs", []):
        if not isinstance(item, dict):
            continue
        source = item.get("from_machine") or item.get("from")
        target = item.get("to_machine") or item.get("to")
        minutes = item.get("minutes")
        if source and target and minutes is not None:
            pairs[(str(source), str(target))] = int(minutes)
    return TransferTimes(
        default_minutes=int(data.get("default_minutes", 0) or 0),
        pairs=pairs,
    )


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
