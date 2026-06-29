"""Use case: run disruption handling with repository-backed context.

Thin orchestration layer that loads the current schedule and context
from repositories, builds the HandleDisruptionInput, and delegates
to the domain-level HandleDisruption handler.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta

from ...domain.entities import Schedule, WorkOrder
from ...domain.errors import ValidationError
from ...domain.scheduling import Objective, analyze_schedule, compute_metrics
from ...domain.scheduling.analysis import ScheduleAnalysis
from ...domain.value_objects import TransferTimes
from ..ports import (
    CalendarRepository,
    InventoryRepository,
    MachineRepository,
    ResourceRepository,
    ScheduleRepository,
    SupplyRepository,
    WorkOrderRepository,
)
from .handle_disruption import (
    DisruptionEvent,
    HandleDisruption,
    HandleDisruptionInput,
)
from .planner_diagnostics import enrich_planner_diagnostics
from .planner_exceptions import build_planner_exceptions
from .planning_validation_gate import validate_schedule_scope
from .result_summary import SchedulingSummary, build_schedule_summary
from .stability_report import build_stability_report
from .tenant_scope import data_workspace_id_from_metadata, list_scoped


def _safe_metric_delta(
    baseline: dict,
    current: dict,
    key: str,
) -> int | None:
    before = baseline.get(key)
    after = current.get(key)
    if not isinstance(before, int) or not isinstance(after, int):
        return None
    return after - before


def _planner_exceptions_from_metadata(metadata) -> dict | None:
    if metadata is None:
        return None
    exceptions = metadata.diagnostics.get("planner_exceptions")
    return exceptions if isinstance(exceptions, dict) else None


def _build_disruption_impact(
    *,
    baseline_schedule: Schedule,
    new_schedule: Schedule,
    baseline_metrics: dict,
    new_metrics: dict,
    frozen_count: int,
    rescheduled_count: int,
) -> dict[str, object]:
    baseline_by_op = {
        assignment.operation_id: assignment
        for assignment in baseline_schedule.assignments
    }
    new_by_op = {
        assignment.operation_id: assignment
        for assignment in new_schedule.assignments
    }

    moved_operations: list[str] = []
    delayed_operations: list[str] = []
    machine_changed_operations: list[str] = []
    unchanged_operations: list[str] = []
    introduced_operations = sorted(
        op_id for op_id in new_by_op if op_id not in baseline_by_op
    )
    removed_operations = sorted(
        op_id for op_id in baseline_by_op if op_id not in new_by_op
    )

    for op_id, previous in baseline_by_op.items():
        current = new_by_op.get(op_id)
        if current is None:
            continue
        machine_changed = current.machine_id != previous.machine_id
        timing_changed = (
            current.setup_start != previous.setup_start
            or current.start != previous.start
            or current.end != previous.end
        )
        if machine_changed:
            machine_changed_operations.append(op_id)
        if timing_changed:
            moved_operations.append(op_id)
        if current.end > previous.end:
            delayed_operations.append(op_id)
        if not machine_changed and not timing_changed:
            unchanged_operations.append(op_id)

    return {
        "baseline_schedule_id": baseline_schedule.id,
        "new_schedule_id": new_schedule.id,
        "frozen_count": frozen_count,
        "rescheduled_count": rescheduled_count,
        "changed_operation_count": len(moved_operations),
        "unchanged_operation_count": len(unchanged_operations),
        "introduced_operation_count": len(introduced_operations),
        "removed_operation_count": len(removed_operations),
        "machine_change_count": len(machine_changed_operations),
        "delayed_operation_count": len(delayed_operations),
        "moved_operations": moved_operations[:10],
        "unchanged_operations": unchanged_operations[:10],
        "machine_changed_operations": machine_changed_operations[:10],
        "delayed_operations": delayed_operations[:10],
        "introduced_operations": introduced_operations[:10],
        "removed_operations": removed_operations[:10],
        "baseline_makespan_minutes": baseline_metrics.get("makespan_minutes"),
        "new_makespan_minutes": new_metrics.get("makespan_minutes"),
        "makespan_delta_minutes": _safe_metric_delta(
            baseline_metrics,
            new_metrics,
            "makespan_minutes",
        ),
        "baseline_total_lateness_minutes": baseline_metrics.get(
            "total_lateness_minutes"
        ),
        "new_total_lateness_minutes": new_metrics.get("total_lateness_minutes"),
        "lateness_delta_minutes": _safe_metric_delta(
            baseline_metrics,
            new_metrics,
            "total_lateness_minutes",
        ),
    }


def _impacted_operation_ids(
    event: DisruptionEvent,
    current_schedule: Schedule,
) -> set[str]:
    if event.machine_id is not None:
        return {
            assignment.operation_id
            for assignment in current_schedule.assignments
            if assignment.machine_id == event.machine_id
        }
    if event.operation_id is not None:
        return {event.operation_id}
    if event.rush_order is not None:
        return {operation.id for operation in event.rush_order.operations}
    return set()


@dataclass(slots=True)
class RunDisruptionInput:
    event: DisruptionEvent
    schedule_id: str
    horizon_days: int = 30
    strategy: str = "greedy"
    objective: Objective = field(default_factory=Objective.default)
    transfer_times: TransferTimes = field(default_factory=TransferTimes)
    persist: bool = True
    workspace_id: str | None = None
    scenario_name: str | None = None
    lifecycle_status: str | None = None
    reschedule_mode: str = "repair_local"
    organization_id: str | None = None


@dataclass(slots=True)
class RunDisruptionOutput:
    schedule: Schedule
    metrics: dict
    analysis: ScheduleAnalysis | None
    frozen_count: int
    rescheduled_count: int
    strategy: str
    solver_status: str
    objective_value: int
    wall_time_ms: int
    diagnostics: dict
    summary: SchedulingSummary
    workspace_id: str
    scenario_name: str
    lifecycle_status: str
    reschedule_mode: str


class RunDisruption:
    """Load context from repos and run disruption handling."""

    def __init__(
        self,
        *,
        work_orders: WorkOrderRepository,
        machines: MachineRepository,
        calendars: CalendarRepository,
        schedules: ScheduleRepository,
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
        self._schedules = schedules

    def execute(self, command: RunDisruptionInput) -> RunDisruptionOutput:
        current_schedule = self._schedules.get(command.schedule_id)
        if current_schedule is None:
            raise ValidationError(
                f"Schedule {command.schedule_id!r} not found"
            )
        current_metadata = self._schedules.get_metadata(command.schedule_id)
        validate_schedule_scope(
            current_metadata,
            expected_organization_id=command.organization_id,
            schedule_id=command.schedule_id,
            label="Current",
        )
        current_workspace_id = command.workspace_id
        if current_workspace_id is None:
            current_workspace_id = data_workspace_id_from_metadata(current_metadata)

        work_orders = list_scoped(
            self._work_orders,
            command.organization_id,
            current_workspace_id,
        )
        machines = list_scoped(
            self._machines,
            command.organization_id,
            current_workspace_id,
        )
        calendars = list_scoped(
            self._calendars,
            command.organization_id,
            current_workspace_id,
        )
        resources = (
            list_scoped(self._resources, command.organization_id, current_workspace_id)
            if self._resources is not None
            else []
        )
        inventory_items = (
            list_scoped(self._inventory, command.organization_id, current_workspace_id)
            if self._inventory is not None
            else []
        )
        supplies = (
            list_scoped(self._supplies, command.organization_id, current_workspace_id)
            if self._supplies is not None
            else []
        )

        horizon_start = command.event.timestamp.replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        horizon_end = horizon_start + timedelta(days=command.horizon_days)

        handler = HandleDisruption()
        result = handler.execute(
            HandleDisruptionInput(
                event=command.event,
                current_schedule=current_schedule,
                work_orders=work_orders,
                machines=machines,
                calendars=calendars,
                horizon_start=horizon_start,
                horizon_end=horizon_end,
                strategy=command.strategy,
                objective=command.objective,
                resources=resources,
                inventory_items=inventory_items,
                supplies=supplies,
                transfer_times=command.transfer_times,
                reschedule_mode=command.reschedule_mode,
                lifecycle_status=(
                    current_metadata.lifecycle_status
                    if current_metadata is not None
                    else "draft"
                ),
                baseline_metrics=(
                    current_metadata.metrics if current_metadata is not None else {}
                ),
                baseline_planner_exceptions=_planner_exceptions_from_metadata(
                    current_metadata
                ),
            )
        )

        # Build the effective work order list that includes a rush order
        # (if any) so metrics are computed against the complete set.
        effective_work_orders = list(work_orders)
        if (
            command.event.rush_order is not None
            and command.event.rush_order.id
            not in {wo.id for wo in effective_work_orders}
        ):
            effective_work_orders.append(command.event.rush_order)

        baseline_metrics = compute_metrics(
            current_schedule,
            work_orders,
            horizon_start=horizon_start,
            horizon_end=horizon_end,
        ).as_dict()
        metrics = compute_metrics(
            result.schedule,
            effective_work_orders,
            horizon_start=horizon_start,
            horizon_end=horizon_end,
            baseline_schedule=current_schedule,
        ).as_dict()
        analysis = analyze_schedule(result.schedule, effective_work_orders)
        event_highlight = (
            f"Disruption {command.event.disruption_type.name.lower()} applied at "
            f"{command.event.timestamp.isoformat()}."
        )
        diagnostics = enrich_planner_diagnostics(
            result.diagnostics,
            metrics=metrics,
            strategy=result.strategy,
        )
        planner = diagnostics.setdefault("planner_diagnostics", {})
        if isinstance(planner, dict) and not planner.get("dependency_modes"):
            dependency_modes = _dependency_modes_from_work_orders(effective_work_orders)
            planner["dependency_modes"] = dependency_modes
            notes = planner.setdefault("notes", [])
            if dependency_modes and isinstance(notes, list):
                note = (
                    "Advanced dependency modes active: "
                    f"{', '.join(dependency_modes)}."
                )
                if note not in notes:
                    notes.append(note)
        _append_dependency_trace_fallbacks(diagnostics, effective_work_orders)
        disruption_impact = _build_disruption_impact(
            baseline_schedule=current_schedule,
            new_schedule=result.schedule,
            baseline_metrics=baseline_metrics,
            new_metrics=metrics,
            frozen_count=result.frozen_count,
            rescheduled_count=result.rescheduled_count,
        )
        diagnostics["disruption_impact"] = disruption_impact
        diagnostics["stability_report"] = build_stability_report(
            schedule=result.schedule,
            baseline_schedule=current_schedule,
            frozen_operation_ids=set(result.frozen_operation_ids),
            impacted_operation_ids=_impacted_operation_ids(
                command.event,
                current_schedule,
            ),
        )
        diagnostics["planner_exceptions"] = build_planner_exceptions(
            diagnostics=diagnostics,
            metrics=metrics,
        )
        planner = diagnostics.get("planner_diagnostics")
        if isinstance(planner, dict):
            decision_layer = diagnostics.get("decision_layer")
            if isinstance(decision_layer, dict):
                planner["decision_layer"] = decision_layer
            planner["exceptions"] = diagnostics["planner_exceptions"]

        impact_highlights: list[str] = []
        changed_count = disruption_impact["changed_operation_count"]
        if isinstance(changed_count, int) and changed_count > 0:
            impact_highlights.append(
                f"{changed_count} operation(s) changed timing or machine after disruption."
            )
        elif isinstance(changed_count, int):
            impact_highlights.append(
                "No scheduled operations needed to move after disruption."
            )
        machine_change_count = disruption_impact["machine_change_count"]
        if isinstance(machine_change_count, int) and machine_change_count > 0:
            impact_highlights.append(
                f"{machine_change_count} operation(s) moved to a different machine."
            )
        introduced_count = disruption_impact["introduced_operation_count"]
        if isinstance(introduced_count, int) and introduced_count > 0:
            impact_highlights.append(
                f"{introduced_count} new operation(s) were injected into the plan."
            )
        makespan_delta = disruption_impact["makespan_delta_minutes"]
        if isinstance(makespan_delta, int) and makespan_delta != 0:
            direction = "up" if makespan_delta > 0 else "down"
            impact_highlights.append(
                f"Makespan moved {direction} by {abs(makespan_delta)} minutes."
            )
        lateness_delta = disruption_impact["lateness_delta_minutes"]
        if isinstance(lateness_delta, int) and lateness_delta != 0:
            direction = "up" if lateness_delta > 0 else "down"
            impact_highlights.append(
                f"Total lateness moved {direction} by {abs(lateness_delta)} minutes."
            )
        summary = build_schedule_summary(
            schedule=result.schedule,
            metrics=metrics,
            analysis=analysis,
            diagnostics=diagnostics,
            work_orders=effective_work_orders,
            extra_highlights=[
                event_highlight,
                f"{result.frozen_count} operation(s) stayed frozen and "
                f"{result.rescheduled_count} were rescheduled.",
                *impact_highlights,
            ],
        )

        # Persist the disruption-rescheduled plan as a new run so it is
        # visible in the history alongside regular scheduling runs.
        workspace_id = (
            command.workspace_id
            or (current_metadata.workspace_id if current_metadata else None)
            or "default"
        )
        scenario_name = (
            command.scenario_name
            or (current_metadata.scenario_name if current_metadata else None)
            or "Default Scenario"
        )
        lifecycle_status = command.lifecycle_status or "draft"

        if command.persist:
            self._schedules.save(
                result.schedule,
                metrics=metrics,
                workspace_id=workspace_id,
                scenario_name=scenario_name,
                lifecycle_status=lifecycle_status,
                strategy=result.strategy,
                solver_status=result.solver_status,
                objective_value=result.objective_value,
                wall_time_ms=result.wall_time_ms,
                diagnostics=diagnostics,
            )

        return RunDisruptionOutput(
            schedule=result.schedule,
            metrics=metrics,
            analysis=analysis,
            frozen_count=result.frozen_count,
            rescheduled_count=result.rescheduled_count,
            strategy=result.strategy,
            solver_status=result.solver_status,
            objective_value=result.objective_value,
            wall_time_ms=result.wall_time_ms,
            diagnostics=diagnostics,
            summary=summary,
            workspace_id=workspace_id,
            scenario_name=scenario_name,
            lifecycle_status=lifecycle_status,
            reschedule_mode=result.reschedule_mode,
        )


def _dependency_modes_from_work_orders(work_orders: list[WorkOrder]) -> list[str]:
    modes: list[str] = []
    for work_order in work_orders:
        for operation in work_order.operations:
            for link in operation.effective_dependency_links():
                dep_type = link.dependency_type.value
                if dep_type == "start_to_start" and "start_to_start" not in modes:
                    modes.append("start_to_start")
                if link.lag_minutes < 0 and "overlap" not in modes:
                    modes.append("overlap")
                if link.max_wait_minutes is not None and "max_wait" not in modes:
                    modes.append("max_wait")
    return modes


def _append_dependency_trace_fallbacks(
    diagnostics: dict,
    work_orders: list[WorkOrder],
) -> None:
    trace = diagnostics.setdefault("decision_trace", [])
    if not isinstance(trace, list):
        return
    seen_operation_ids = {
        entry.get("operation_id")
        for entry in trace
        if isinstance(entry, dict) and isinstance(entry.get("operation_id"), str)
    }
    for work_order in work_orders:
        for operation in work_order.operations:
            if operation.id in seen_operation_ids:
                continue
            links = operation.effective_dependency_links()
            if not links:
                continue
            trace.append(
                {
                    "operation_id": operation.id,
                    "work_order_id": work_order.id,
                    "dependency_links": [
                        {
                            "depends_on_id": link.depends_on_id,
                            "dependency_type": link.dependency_type.value,
                            "lag_minutes": link.lag_minutes,
                            "max_wait_minutes": link.max_wait_minutes,
                        }
                        for link in links
                    ],
                    "trace_source": "dependency_fallback",
                }
            )
