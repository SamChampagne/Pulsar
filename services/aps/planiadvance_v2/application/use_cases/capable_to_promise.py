"""Capable-to-promise rough-cut use case."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ...domain.entities import Machine, Schedule, ScheduledOperation, WorkingCalendar, WorkOrder
from ...domain.scheduling import (
    Objective,
    SchedulingContext,
    build_machine_capacity_ledger,
    compute_metrics,
    resolve_strategy,
)
from ...domain.value_objects import TransferTimes
from ..ports import (
    CalendarRepository,
    InventoryRepository,
    MachineRepository,
    ResourceRepository,
    SupplyRepository,
    WorkOrderRepository,
)
from .planning_validation_gate import enforce_planning_validation_gate
from .tenant_scope import list_scoped


@dataclass(slots=True)
class CapableToPromiseInput:
    candidate_order: WorkOrder
    horizon_start: datetime | None = None
    horizon_days: int = 30
    strategy: str = "infinite"
    finite_validation: bool = False
    finite_strategy: str = "greedy"
    promise_dates: tuple[datetime, ...] = field(default_factory=tuple)
    objective: Objective = field(default_factory=Objective.default)
    transfer_times: TransferTimes = field(default_factory=TransferTimes)
    organization_id: str | None = None
    workspace_id: str | None = None


@dataclass(slots=True)
class CapableToPromiseOutput:
    feasible: bool
    strategy: str
    solver_status: str
    earliest_completion: datetime | None
    due_date: datetime
    promise_delta_minutes: int | None
    schedule: Schedule
    metrics: dict
    insertion_impact: dict
    available_quantity_by_date: list[dict[str, object]]
    rough_cut_capacity: list[dict[str, object]]
    planner_explanation: dict[str, object]
    recommendation: str
    finite_validation: dict | None
    diagnostics: dict


class CapableToPromise:
    """Simulate insertion of a candidate order without persisting a run."""

    def __init__(
        self,
        *,
        work_orders: WorkOrderRepository,
        machines: MachineRepository,
        calendars: CalendarRepository,
        resources: ResourceRepository | None = None,
        inventory: InventoryRepository | None = None,
        supplies: SupplyRepository | None = None,
    ) -> None:
        self._work_orders = work_orders
        self._machines = machines
        self._calendars = calendars
        self._resources = resources
        self._inventory = inventory
        self._supplies = supplies

    def execute(self, command: CapableToPromiseInput) -> CapableToPromiseOutput:
        horizon_start = command.horizon_start or datetime.utcnow().replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        horizon_end = horizon_start + timedelta(days=command.horizon_days)
        source_work_orders = list_scoped(
            self._work_orders,
            command.organization_id,
            command.workspace_id,
        )
        existing = [
            work_order
            for work_order in source_work_orders
            if work_order.id != command.candidate_order.id
        ]
        work_orders = existing + [command.candidate_order]
        resources = (
            list_scoped(self._resources, command.organization_id, command.workspace_id)
            if self._resources is not None
            else []
        )
        inventory_items = (
            list_scoped(self._inventory, command.organization_id, command.workspace_id)
            if self._inventory is not None
            else []
        )
        supplies = (
            list_scoped(self._supplies, command.organization_id, command.workspace_id)
            if self._supplies is not None
            else []
        )
        machines = list_scoped(
            self._machines,
            command.organization_id,
            command.workspace_id,
        )
        calendars = list_scoped(
            self._calendars,
            command.organization_id,
            command.workspace_id,
        )
        baseline_schedule: Schedule | None = None
        baseline_metrics: dict = {}
        if existing:
            baseline_context = SchedulingContext(
                horizon_start=horizon_start,
                horizon_end=horizon_end,
                work_orders=existing,
                machines=machines,
                calendars=calendars,
                resources=resources,
                inventory_items=inventory_items,
                supplies=supplies,
                transfer_times=command.transfer_times,
            )
            enforce_planning_validation_gate(
                baseline_context,
                mode="ctp_baseline",
            )
            baseline_result = resolve_strategy(command.strategy).solve(
                baseline_context, command.objective
            )
            baseline_schedule = baseline_result.schedule
            baseline_metrics = compute_metrics(
                baseline_schedule,
                existing,
                horizon_start=horizon_start,
                horizon_end=horizon_end,
            ).as_dict()

        context = SchedulingContext(
            horizon_start=horizon_start,
            horizon_end=horizon_end,
            work_orders=work_orders,
            machines=machines,
            calendars=calendars,
            resources=resources,
            inventory_items=inventory_items,
            supplies=supplies,
            transfer_times=command.transfer_times,
        )
        validation_gate = enforce_planning_validation_gate(
            context,
            mode="capable_to_promise",
        )
        result = resolve_strategy(command.strategy).solve(context, command.objective)
        candidate_assignments = result.schedule.by_work_order(command.candidate_order.id)
        earliest_completion = (
            max(assignment.end for assignment in candidate_assignments)
            if candidate_assignments
            else None
        )
        promise_delta = (
            int((earliest_completion - command.candidate_order.due_date).total_seconds() // 60)
            if earliest_completion is not None
            else None
        )
        metrics = compute_metrics(
            result.schedule,
            work_orders,
            horizon_start=horizon_start,
            horizon_end=horizon_end,
        ).as_dict()
        insertion_impact = self._build_insertion_impact(
            baseline_schedule=baseline_schedule,
            new_schedule=result.schedule,
            baseline_metrics=baseline_metrics,
            new_metrics=metrics,
            candidate_order_id=command.candidate_order.id,
        )
        available_quantity_by_date = self._build_available_quantity_by_date(
            candidate_order=command.candidate_order,
            completion=earliest_completion,
            promise_dates=command.promise_dates,
        )
        rough_cut_capacity = self._build_rough_cut_capacity(
            baseline_schedule=baseline_schedule,
            new_schedule=result.schedule,
            candidate_order_id=command.candidate_order.id,
            machines=machines,
            calendars=calendars,
            horizon_start=horizon_start,
            horizon_end=horizon_end,
        )
        recommendation = self._recommendation(
            promise_delta=promise_delta,
            insertion_impact=insertion_impact,
        )
        finite_validation = None
        if command.finite_validation and recommendation == "finite_validation_required":
            finite_validation = self._run_finite_validation(
                command=command,
                context=context,
                baseline_work_orders=existing,
                horizon_start=horizon_start,
                horizon_end=horizon_end,
                work_orders=work_orders,
            )
            finite_recommendation = finite_validation.get("recommendation")
            if isinstance(finite_recommendation, str):
                recommendation = finite_recommendation
        planner_explanation = self._build_planner_explanation(
            recommendation=recommendation,
            promise_delta=promise_delta,
            insertion_impact=insertion_impact,
            rough_cut_capacity=rough_cut_capacity,
            finite_validation=finite_validation,
        )
        diagnostics = {
            **dict(result.diagnostics),
            "ctp": True,
            "candidate_order_id": command.candidate_order.id,
            "earliest_completion": (
                earliest_completion.isoformat() if earliest_completion else None
            ),
            "promise_delta_minutes": promise_delta,
            "recommended_mode": recommendation,
            "insertion_impact": insertion_impact,
            "available_quantity_by_date": available_quantity_by_date,
            "rough_cut_capacity": rough_cut_capacity,
            "planner_explanation": planner_explanation,
            "finite_validation": finite_validation,
            "validation_gate": validation_gate.as_diagnostics(),
        }
        return CapableToPromiseOutput(
            feasible=earliest_completion is not None,
            strategy=result.strategy_name,
            solver_status=result.solver_status,
            earliest_completion=earliest_completion,
            due_date=command.candidate_order.due_date,
            promise_delta_minutes=promise_delta,
            schedule=result.schedule,
            metrics=metrics,
            insertion_impact=insertion_impact,
            available_quantity_by_date=available_quantity_by_date,
            rough_cut_capacity=rough_cut_capacity,
            planner_explanation=planner_explanation,
            recommendation=recommendation,
            finite_validation=finite_validation,
            diagnostics=diagnostics,
        )

    @staticmethod
    def _machine_load(assignments: list[ScheduledOperation]) -> dict[str, int]:
        load: dict[str, int] = {}
        for assignment in assignments:
            minutes = int((assignment.end - assignment.setup_start).total_seconds() // 60)
            load[assignment.machine_id] = load.get(assignment.machine_id, 0) + minutes
        return load

    @staticmethod
    def _overlap_count(assignments: list[ScheduledOperation]) -> int:
        overlaps = 0
        by_machine: dict[str, list[ScheduledOperation]] = {}
        for assignment in assignments:
            by_machine.setdefault(assignment.machine_id, []).append(assignment)
        for machine_assignments in by_machine.values():
            ordered = sorted(machine_assignments, key=lambda item: item.setup_start)
            for previous, current in zip(ordered, ordered[1:], strict=False):
                if previous.end > current.setup_start:
                    overlaps += 1
        return overlaps

    @classmethod
    def _build_insertion_impact(
        cls,
        *,
        baseline_schedule: Schedule | None,
        new_schedule: Schedule,
        baseline_metrics: dict,
        new_metrics: dict,
        candidate_order_id: str,
    ) -> dict[str, object]:
        candidate_assignments = new_schedule.by_work_order(candidate_order_id)
        baseline_assignments = baseline_schedule.assignments if baseline_schedule else []
        existing_movements = cls._build_existing_operation_movements(
            baseline_assignments=baseline_assignments,
            new_assignments=[
                assignment
                for assignment in new_schedule.assignments
                if assignment.work_order_id != candidate_order_id
            ],
        )
        existing_work_order_impacts = cls._build_existing_work_order_impacts(
            existing_movements
        )
        baseline_load = cls._machine_load(baseline_assignments)
        new_load = cls._machine_load(new_schedule.assignments)
        all_machines = sorted(set(baseline_load) | set(new_load))
        load_delta = {
            machine_id: new_load.get(machine_id, 0) - baseline_load.get(machine_id, 0)
            for machine_id in all_machines
        }
        candidate_load = cls._machine_load(candidate_assignments)
        delayed_movements = [
            movement for movement in existing_movements if movement["end_shift_minutes"] > 0
        ]
        accelerated_movements = [
            movement for movement in existing_movements if movement["end_shift_minutes"] < 0
        ]
        machine_changed_movements = [
            movement for movement in existing_movements if movement["machine_changed"]
        ]
        baseline_makespan = baseline_metrics.get("makespan_minutes")
        new_makespan = new_metrics.get("makespan_minutes")
        makespan_delta = (
            new_makespan - baseline_makespan
            if isinstance(new_makespan, int) and isinstance(baseline_makespan, int)
            else None
        )
        return {
            "candidate_operation_count": len(candidate_assignments),
            "candidate_assignments": [
                cls._assignment_impact_dict(assignment)
                for assignment in candidate_assignments
            ],
            "existing_operation_count": len(baseline_assignments),
            "retained_existing_operation_count": len(
                [
                    movement
                    for movement in existing_movements
                    if movement["status"] == "retained"
                ]
            ),
            "moved_existing_operation_count": len(
                [
                    movement
                    for movement in existing_movements
                    if movement["moved"]
                ]
            ),
            "delayed_existing_operation_count": len(delayed_movements),
            "accelerated_existing_operation_count": len(accelerated_movements),
            "machine_changed_existing_operation_count": len(machine_changed_movements),
            "max_existing_operation_end_delay_minutes": (
                max(
                    movement["end_shift_minutes"]
                    for movement in delayed_movements
                )
                if delayed_movements
                else 0
            ),
            "total_existing_operation_end_delay_minutes": sum(
                movement["end_shift_minutes"] for movement in delayed_movements
            ),
            "rough_cut_overlap_count": cls._overlap_count(new_schedule.assignments),
            "baseline_makespan_minutes": baseline_makespan,
            "new_makespan_minutes": new_makespan,
            "makespan_delta_minutes": makespan_delta,
            "machine_load_delta_minutes": load_delta,
            "candidate_machine_load_minutes": candidate_load,
            "impacted_machine_ids": sorted(
                {
                    machine_id
                    for machine_id, delta in load_delta.items()
                    if delta != 0
                }
                | {
                    movement["new_machine_id"]
                    for movement in machine_changed_movements
                    if isinstance(movement.get("new_machine_id"), str)
                }
            ),
            "existing_operation_movements": existing_movements,
            "existing_work_order_impacts": existing_work_order_impacts,
        }

    @staticmethod
    def _minutes_between(new_value: datetime, old_value: datetime) -> int:
        return int((new_value - old_value).total_seconds() // 60)

    @classmethod
    def _build_existing_operation_movements(
        cls,
        *,
        baseline_assignments: list[ScheduledOperation],
        new_assignments: list[ScheduledOperation],
    ) -> list[dict[str, object]]:
        baseline_by_operation = {
            assignment.operation_id: assignment for assignment in baseline_assignments
        }
        new_by_operation = {
            assignment.operation_id: assignment for assignment in new_assignments
        }
        movements: list[dict[str, object]] = []
        for operation_id in sorted(baseline_by_operation):
            baseline = baseline_by_operation[operation_id]
            current = new_by_operation.get(operation_id)
            if current is None:
                movements.append(
                    {
                        "operation_id": operation_id,
                        "work_order_id": baseline.work_order_id,
                        "status": "missing_after_insertion",
                        "moved": True,
                        "machine_changed": True,
                        "baseline_machine_id": baseline.machine_id,
                        "new_machine_id": None,
                        "setup_start_shift_minutes": None,
                        "start_shift_minutes": None,
                        "end_shift_minutes": None,
                    }
                )
                continue
            setup_shift = cls._minutes_between(current.setup_start, baseline.setup_start)
            start_shift = cls._minutes_between(current.start, baseline.start)
            end_shift = cls._minutes_between(current.end, baseline.end)
            machine_changed = current.machine_id != baseline.machine_id
            movements.append(
                {
                    "operation_id": operation_id,
                    "work_order_id": baseline.work_order_id,
                    "status": "retained",
                    "moved": (
                        setup_shift != 0
                        or start_shift != 0
                        or end_shift != 0
                        or machine_changed
                    ),
                    "machine_changed": machine_changed,
                    "baseline_machine_id": baseline.machine_id,
                    "new_machine_id": current.machine_id,
                    "baseline_setup_start": baseline.setup_start.isoformat(),
                    "new_setup_start": current.setup_start.isoformat(),
                    "baseline_start": baseline.start.isoformat(),
                    "new_start": current.start.isoformat(),
                    "baseline_end": baseline.end.isoformat(),
                    "new_end": current.end.isoformat(),
                    "setup_start_shift_minutes": setup_shift,
                    "start_shift_minutes": start_shift,
                    "end_shift_minutes": end_shift,
                }
            )
        return sorted(
            movements,
            key=lambda movement: (
                0 if movement["moved"] else 1,
                -abs(int(movement.get("end_shift_minutes") or 0)),
                str(movement["operation_id"]),
            ),
        )

    @staticmethod
    def _build_existing_work_order_impacts(
        movements: list[dict[str, object]],
    ) -> list[dict[str, object]]:
        by_work_order: dict[str, list[dict[str, object]]] = {}
        for movement in movements:
            work_order_id = movement.get("work_order_id")
            if isinstance(work_order_id, str):
                by_work_order.setdefault(work_order_id, []).append(movement)
        impacts: list[dict[str, object]] = []
        for work_order_id, items in sorted(by_work_order.items()):
            moved_items = [item for item in items if item["moved"]]
            delayed_minutes = [
                int(item["end_shift_minutes"])
                for item in items
                if isinstance(item.get("end_shift_minutes"), int)
                and int(item["end_shift_minutes"]) > 0
            ]
            end_shifts = [
                int(item["end_shift_minutes"])
                for item in items
                if isinstance(item.get("end_shift_minutes"), int)
            ]
            impacts.append(
                {
                    "work_order_id": work_order_id,
                    "operation_count": len(items),
                    "moved_operation_count": len(moved_items),
                    "delayed_operation_count": len(delayed_minutes),
                    "machine_changed_operation_count": len(
                        [item for item in items if item["machine_changed"]]
                    ),
                    "max_end_delay_minutes": max(delayed_minutes)
                    if delayed_minutes
                    else 0,
                    "completion_shift_minutes": max(end_shifts) if end_shifts else 0,
                }
            )
        return [
            impact
            for impact in impacts
            if impact["moved_operation_count"] > 0
        ]

    @staticmethod
    def _assignment_impact_dict(
        assignment: ScheduledOperation,
    ) -> dict[str, object]:
        return {
            "operation_id": assignment.operation_id,
            "work_order_id": assignment.work_order_id,
            "machine_id": assignment.machine_id,
            "setup_start": assignment.setup_start.isoformat(),
            "start": assignment.start.isoformat(),
            "end": assignment.end.isoformat(),
            "duration_minutes": int(
                (assignment.end - assignment.setup_start).total_seconds() // 60
            ),
        }

    @staticmethod
    def _recommendation(
        *,
        promise_delta: int | None,
        insertion_impact: dict,
    ) -> str:
        if promise_delta is None:
            return "not_feasible"
        if promise_delta > 0:
            return "negotiate_date"
        if int(insertion_impact.get("rough_cut_overlap_count", 0)) > 0:
            return "finite_validation_required"
        return "promise"

    @classmethod
    def _build_available_quantity_by_date(
        cls,
        *,
        candidate_order: WorkOrder,
        completion: datetime | None,
        promise_dates: tuple[datetime, ...],
    ) -> list[dict[str, object]]:
        target_dates = sorted({candidate_order.due_date, *promise_dates})
        return [
            cls._quantity_availability(
                target_date=target_date,
                requested_quantity=candidate_order.quantity,
                completion=completion,
            )
            for target_date in target_dates
        ]

    @staticmethod
    def _quantity_availability(
        *,
        target_date: datetime,
        requested_quantity: int,
        completion: datetime | None,
    ) -> dict[str, object]:
        available = requested_quantity if completion is not None and completion <= target_date else 0
        delta = (
            int((completion - target_date).total_seconds() // 60)
            if completion is not None
            else None
        )
        return {
            "date": target_date,
            "available_quantity": available,
            "short_quantity": requested_quantity - available,
            "requested_quantity": requested_quantity,
            "is_full_quantity_available": available == requested_quantity,
            "promise_delta_minutes": delta,
            "mode": "all_or_none",
        }

    @classmethod
    def _build_rough_cut_capacity(
        cls,
        *,
        baseline_schedule: Schedule | None,
        new_schedule: Schedule,
        candidate_order_id: str,
        machines: list[Machine],
        calendars: list[WorkingCalendar],
        horizon_start: datetime,
        horizon_end: datetime,
    ) -> list[dict[str, object]]:
        ledger = build_machine_capacity_ledger(
            schedule=new_schedule,
            baseline_schedule=baseline_schedule,
            candidate_work_order_id=candidate_order_id,
            machines=machines,
            calendars=calendars,
            horizon_start=horizon_start,
            horizon_end=horizon_end,
            bucket="day",
        )
        return [
            {
                "machine_id": bucket.machine_id,
                "date": bucket.bucket_start.date().isoformat(),
                "capacity_minutes": bucket.capacity_minutes,
                "baseline_load_minutes": bucket.baseline_load_minutes,
                "new_load_minutes": bucket.scheduled_load_minutes,
                "candidate_load_minutes": bucket.candidate_load_minutes,
                "load_delta_minutes": bucket.load_delta_minutes,
                "rough_utilization": bucket.utilization,
                "overlap_count": bucket.overlap_count,
                "pressure": bucket.pressure,
            }
            for bucket in ledger.buckets
        ]

    @staticmethod
    def _build_planner_explanation(
        *,
        recommendation: str,
        promise_delta: int | None,
        insertion_impact: dict,
        rough_cut_capacity: list[dict[str, object]],
        finite_validation: dict | None,
    ) -> dict[str, object]:
        hotspot = CapableToPromise._top_capacity_hotspot(rough_cut_capacity)
        overlap_count = int(insertion_impact.get("rough_cut_overlap_count", 0))
        moved_count = int(insertion_impact.get("moved_existing_operation_count", 0))
        delayed_count = int(insertion_impact.get("delayed_existing_operation_count", 0))
        notes: list[str] = []
        if hotspot is not None:
            notes.append(
                "Highest rough-cut pressure is "
                f"{hotspot['machine_id']} on {hotspot['date']} "
                f"at {hotspot['rough_utilization']} utilization."
            )
        if overlap_count > 0:
            notes.append(
                f"Rough-cut places {overlap_count} overlapping machine window(s); "
                "run finite validation before committing shop-floor dates."
            )
        if moved_count > 0:
            notes.append(
                f"Insertion moves {moved_count} existing operation(s); "
                f"{delayed_count} are delayed."
            )
        if isinstance(finite_validation, dict):
            finite_impact = finite_validation.get("insertion_impact")
            if isinstance(finite_impact, dict):
                finite_moved_count = int(
                    finite_impact.get("moved_existing_operation_count", 0)
                )
                finite_delayed_count = int(
                    finite_impact.get("delayed_existing_operation_count", 0)
                )
                if finite_moved_count > 0:
                    notes.append(
                        "Finite validation moves "
                        f"{finite_moved_count} existing operation(s); "
                        f"{finite_delayed_count} are delayed."
                    )

        if recommendation == "promise":
            finite_note = (
                " after finite validation"
                if finite_validation is not None
                else " under rough-cut assumptions"
            )
            summary = f"Candidate can be promised on or before due date{finite_note}."
            risk_level = "low" if overlap_count == 0 else "medium"
            primary_reason = "capacity_validated" if finite_validation else "date_feasible"
            action = "Confirm promise date."
        elif recommendation == "finite_validation_required":
            summary = (
                "Candidate meets the requested date in rough-cut, but capacity overlap "
                "means the promise needs finite validation."
            )
            risk_level = "medium"
            primary_reason = "rough_cut_overlap"
            action = "Re-run CTP with finite_validation=true before confirming."
        elif recommendation == "negotiate_date":
            late_by = promise_delta if promise_delta is not None else 0
            summary = f"Candidate is projected late by {late_by} minute(s)."
            risk_level = "high"
            primary_reason = "projected_lateness"
            action = "Negotiate date, add capacity, or change priority before confirming."
        else:
            summary = "Candidate could not be promised in the selected horizon."
            risk_level = "high"
            primary_reason = "not_schedulable"
            action = "Extend horizon or review routings, calendars, and material availability."

        return {
            "summary": summary,
            "risk_level": risk_level,
            "primary_reason": primary_reason,
            "recommended_action": action,
            "capacity_hotspot": hotspot,
            "notes": notes,
        }

    @staticmethod
    def _top_capacity_hotspot(
        rough_cut_capacity: list[dict[str, object]],
    ) -> dict[str, object] | None:
        if not rough_cut_capacity:
            return None
        return max(
            rough_cut_capacity,
            key=lambda row: (
                int(row.get("overlap_count", 0)),
                float(row.get("rough_utilization") or 0),
                int(row.get("new_load_minutes", 0)),
            ),
        )

    @classmethod
    def _run_finite_validation(
        cls,
        *,
        command: CapableToPromiseInput,
        context: SchedulingContext,
        baseline_work_orders: list[WorkOrder],
        horizon_start: datetime,
        horizon_end: datetime,
        work_orders: list[WorkOrder],
    ) -> dict[str, object]:
        baseline_schedule = None
        baseline_metrics: dict = {}
        if baseline_work_orders:
            baseline_context = SchedulingContext(
                horizon_start=context.horizon_start,
                horizon_end=context.horizon_end,
                work_orders=baseline_work_orders,
                machines=context.machines,
                calendars=context.calendars,
                resources=context.resources,
                inventory_items=context.inventory_items,
                supplies=context.supplies,
                transfer_times=context.transfer_times,
            )
            baseline_result = resolve_strategy(command.finite_strategy).solve(
                baseline_context,
                command.objective,
            )
            baseline_schedule = baseline_result.schedule
            baseline_metrics = compute_metrics(
                baseline_schedule,
                baseline_work_orders,
                horizon_start=horizon_start,
                horizon_end=horizon_end,
            ).as_dict()
        result = resolve_strategy(command.finite_strategy).solve(
            context,
            command.objective,
        )
        candidate_assignments = result.schedule.by_work_order(command.candidate_order.id)
        finite_completion = (
            max(assignment.end for assignment in candidate_assignments)
            if candidate_assignments
            else None
        )
        finite_delta = (
            int((finite_completion - command.candidate_order.due_date).total_seconds() // 60)
            if finite_completion is not None
            else None
        )
        finite_metrics = compute_metrics(
            result.schedule,
            work_orders,
            horizon_start=horizon_start,
            horizon_end=horizon_end,
        ).as_dict()
        insertion_impact = cls._build_insertion_impact(
            baseline_schedule=baseline_schedule,
            new_schedule=result.schedule,
            baseline_metrics=baseline_metrics,
            new_metrics=finite_metrics,
            candidate_order_id=command.candidate_order.id,
        )
        recommendation = (
            "promise"
            if finite_delta is not None and finite_delta <= 0
            else "negotiate_date"
        )
        return {
            "enabled": True,
            "strategy": result.strategy_name,
            "solver_status": result.solver_status,
            "earliest_completion": (
                finite_completion.isoformat() if finite_completion else None
            ),
            "promise_delta_minutes": finite_delta,
            "recommendation": recommendation,
            "insertion_impact": insertion_impact,
            "available_quantity_by_date": cls._build_available_quantity_by_date(
                candidate_order=command.candidate_order,
                completion=finite_completion,
                promise_dates=command.promise_dates,
            ),
            "metrics": finite_metrics,
        }
