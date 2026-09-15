"""Use case: run a full scheduling pass.

This is the single orchestration point between the outside world (API / CLI)
and the APS engine. It:

1. Loads inputs from repositories (or accepts them directly for tests).
2. Runs a **pre-solve feasibility check** and returns issues/suggestions.
3. Applies **lot splitting** if any work order has a lot-sizing policy.
4. Builds a :class:`SchedulingContext`.
5. Runs the selected scheduling **strategy** (greedy, cpsat, sa, tabu,
   ga, lns, backward, multi) with a multi-objective cost.
6. Computes KPI metrics and **schedule analysis** (critical path,
   bottleneck, flow times, Gantt data).
7. **Reassembles** lot-split assignments back to parent work orders.
8. Persists the resulting schedule (if a repository is provided).
9. Returns a complete DTO including analysis, feasibility, and diagnostics.

Because repositories are injected via ports, the same use case runs against
PostgreSQL in production and against in-memory fakes in tests.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ...application.integration import (
    export_planning_snapshot,
    planning_snapshot_hash,
    planning_snapshot_to_json,
)
from ...domain.entities import (
    InventoryItem,
    Resource,
    Schedule,
    SupplyLot,
    WorkingCalendar,
    WorkOrder,
)
from ...domain.errors import InfeasibleScheduleError, ValidationError
from ...domain.scheduling import (
    CalendarResolver,
    FrozenAssignment,
    MaterialLedger,
    Objective,
    SchedulingContext,
    analyze_schedule,
    compute_metrics,
    reassemble_schedule,
    resolve_heuristic,
    resolve_strategy,
    split_lots,
)
from ...domain.scheduling.analysis import ScheduleAnalysis
from ...domain.scheduling.dependency_links import operation_dependency_links
from ...domain.scheduling.dependency_timing import (
    dependency_max_start,
    dependency_min_start,
)
from ...domain.scheduling.feasibility import FeasibilityReport
from ...domain.scheduling.greedy_strategy import GreedyStrategy
from ...domain.scheduling.resource_aligner import build_resource_timelines
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
from .planner_actions import PlannerAction, apply_planner_actions
from .planner_decision_log import build_planner_decision_log
from .planner_diagnostics import enrich_planner_diagnostics
from .planner_exceptions import build_planner_exceptions
from .planning_decision_layer import (
    normalize_reschedule_mode_for_decision,
    select_planning_decision,
)
from .planning_policy import build_planning_policy
from .planning_validation_gate import (
    enforce_planning_validation_gate,
    validate_schedule_scope,
)
from .repair_scope import build_repair_scope
from .result_summary import SchedulingSummary, build_schedule_summary
from .stability_report import build_stability_report
from .tenant_scope import list_scoped
from .wip_remaining_split import (
    merge_wip_remaining_schedule,
    split_wip_remaining,
)

ENGINE_VERSION = "aps-engine.v1"


def _metrics_from_metadata(metadata) -> dict | None:
    if metadata is None:
        return None
    return metadata.metrics


def _planner_exceptions_from_metadata(metadata) -> dict | None:
    if metadata is None:
        return None
    exceptions = metadata.diagnostics.get("planner_exceptions")
    return exceptions if isinstance(exceptions, dict) else None


@dataclass(slots=True)
class RunSchedulingInput:
    horizon_start: datetime | None = None
    horizon_days: int = 30
    # "heuristic" is kept for backwards compatibility with V2.0 callers;
    # ``strategy`` is the new primary knob — pick "greedy" (fast), "cpsat"
    # (exact/OR-Tools), or any future pluggable backend.
    heuristic: str = "edd"
    strategy: str = "greedy"
    objective: Objective = field(default_factory=Objective.default)
    transfer_times: TransferTimes = field(default_factory=TransferTimes)
    persist: bool = True
    workspace_id: str | None = None
    scenario_name: str = "Default Scenario"
    lifecycle_status: str = "draft"
    baseline_schedule_id: str | None = None
    reschedule_mode: str = "reschedule_all"
    organization_id: str | None = None
    planner_actions: list[PlannerAction] = field(default_factory=list)
    # Optional explicit UTC end: a local calendar day may have 23 or 25 hours.
    horizon_end: datetime | None = None
    snapshot_exported_at: datetime | None = None


@dataclass(slots=True)
class RunSchedulingOutput:
    schedule: Schedule
    metrics: dict
    strategy: str
    solver_status: str
    objective_value: int
    wall_time_ms: int
    diagnostics: dict
    summary: SchedulingSummary
    analysis: ScheduleAnalysis | None = None
    feasibility: FeasibilityReport | None = None
    organization_id: str | None = None
    horizon_start: datetime | None = None
    horizon_end: datetime | None = None
    objective: dict = field(default_factory=dict)
    transfer_times: dict = field(default_factory=dict)
    input_snapshot_hash: str = ""
    engine_version: str = ENGINE_VERSION


class RunScheduling:
    def __init__(
        self,
        *,
        work_orders: WorkOrderRepository,
        machines: MachineRepository,
        calendars: CalendarRepository,
        resources: ResourceRepository | None = None,
        inventory: InventoryRepository | None = None,
        supplies: SupplyRepository | None = None,
        schedules: ScheduleRepository | None = None,
    ) -> None:
        self._work_orders = work_orders
        self._machines = machines
        self._calendars = calendars
        self._resources = resources
        self._inventory = inventory
        self._supplies = supplies
        self._schedules = schedules

    @staticmethod
    def _effective_objective(
        objective: Objective,
        *,
        baseline_schedule: Schedule | None,
        reschedule_mode: str,
    ) -> Objective:
        if (
            baseline_schedule is None
            or reschedule_mode == "reschedule_all"
            or objective.start_shift_penalty > 0
            or objective.machine_change_penalty > 0
        ):
            return objective
        return Objective(
            makespan=objective.makespan,
            total_tardiness=objective.total_tardiness,
            weighted_tardiness=objective.weighted_tardiness,
            setup_cost=objective.setup_cost,
            idle_penalty=objective.idle_penalty,
            start_shift_penalty=1,
            machine_change_penalty=60,
        )

    @staticmethod
    def _uses_stability_preference(
        objective: Objective,
        *,
        baseline_schedule: Schedule | None,
        reschedule_mode: str,
    ) -> bool:
        return (
            baseline_schedule is not None
            and reschedule_mode != "reschedule_all"
            and (
                objective.start_shift_penalty > 0
                or objective.machine_change_penalty > 0
            )
        )

    @staticmethod
    def _net_change_anchor(
        *,
        work_orders,
        baseline_schedule: Schedule | None,
    ) -> datetime | None:
        if baseline_schedule is None:
            return None
        baseline_work_order_ids = {
            assignment.work_order_id for assignment in baseline_schedule.assignments
        }
        new_work_orders = [
            work_order
            for work_order in work_orders
            if work_order.id not in baseline_work_order_ids
        ]
        if not new_work_orders:
            return None
        return min(work_order.release_date for work_order in new_work_orders)

    @staticmethod
    def _objective_to_json(objective: Objective) -> dict[str, int]:
        return {
            "makespan": objective.makespan,
            "total_tardiness": objective.total_tardiness,
            "weighted_tardiness": objective.weighted_tardiness,
            "setup_cost": objective.setup_cost,
            "idle_penalty": objective.idle_penalty,
            "start_shift_penalty": objective.start_shift_penalty,
            "machine_change_penalty": objective.machine_change_penalty,
        }

    @staticmethod
    def _entity_counts(
        *,
        calendars,
        machines,
        resources,
        work_orders,
        inventory_items,
        supplies,
    ) -> dict[str, int]:
        return {
            "calendars": len(calendars),
            "machines": len(machines),
            "resources": len(resources),
            "work_orders": len(work_orders),
            "operations": sum(len(work_order.operations) for work_order in work_orders),
            "inventory_items": len(inventory_items),
            "supplies": len(supplies),
        }

    def execute(self, command: RunSchedulingInput) -> RunSchedulingOutput:
        horizon_start = command.horizon_start or datetime.utcnow().replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        horizon_end = command.horizon_end or horizon_start + timedelta(days=command.horizon_days)
        if horizon_end <= horizon_start:
            raise ValidationError("Planning horizon must end after its start")
        display_workspace_id = command.workspace_id or "default"

        raw_work_orders = list_scoped(
            self._work_orders,
            command.organization_id,
            command.workspace_id,
        )

        # Step 1: Lot splitting — expand work orders with lot-sizing policies
        # into sub-lot work orders. The split result lets us map assignments
        # back to parent work orders after solving.
        lot_result = split_lots(raw_work_orders)
        effective_work_orders = lot_result.work_orders

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

        input_snapshot = export_planning_snapshot(
            calendars=calendars,
            machines=machines,
            resources=resources,
            work_orders=raw_work_orders,
            inventory_items=inventory_items,
            supplies=supplies,
            transfer_times=command.transfer_times,
            source_system="repository",
            exported_at=command.snapshot_exported_at or datetime.utcnow(),
            metadata={
                "organization_id": command.organization_id,
                "workspace_id": command.workspace_id,
                "display_workspace_id": display_workspace_id,
                "scenario_name": command.scenario_name,
                "lifecycle_status": command.lifecycle_status,
                "horizon_start": horizon_start.isoformat(),
                "horizon_end": horizon_end.isoformat(),
                "engine_version": ENGINE_VERSION,
            },
        )
        input_snapshot_json = planning_snapshot_to_json(input_snapshot)
        input_snapshot_hash = planning_snapshot_hash(input_snapshot_json)
        objective_json = self._objective_to_json(command.objective)
        transfer_times_json = input_snapshot_json["transfer_times"]

        baseline_schedule = None
        baseline_metadata = None
        reschedule_mode = command.reschedule_mode.strip().lower()
        if reschedule_mode not in {"reschedule_all", "repair_local", "net_change"}:
            raise ValidationError(
                "reschedule_mode must be one of: reschedule_all, repair_local, net_change"
            )
        if command.baseline_schedule_id is not None:
            if self._schedules is None:
                raise ValidationError(
                    "Baseline schedule lookup requires a schedule repository"
                )
            baseline_schedule = self._schedules.get(command.baseline_schedule_id)
            if baseline_schedule is None:
                raise ValidationError(
                    f"Baseline schedule {command.baseline_schedule_id!r} not found"
                )
            baseline_metadata = self._schedules.get_metadata(command.baseline_schedule_id)
            validate_schedule_scope(
                baseline_metadata,
                expected_organization_id=command.organization_id,
                schedule_id=command.baseline_schedule_id,
                label="Baseline",
            )
        planner_action_result = apply_planner_actions(
            work_orders=raw_work_orders,
            actions=command.planner_actions,
            machines=machines,
            calendars=calendars,
            baseline_schedule=baseline_schedule,
        )
        raw_work_orders = planner_action_result.work_orders
        machines = planner_action_result.machines
        calendars = planner_action_result.calendars
        lot_result = split_lots(raw_work_orders)
        wip_split_result = split_wip_remaining(lot_result.work_orders)
        effective_work_orders = wip_split_result.work_orders
        input_snapshot = export_planning_snapshot(
            calendars=calendars,
            machines=machines,
            resources=resources,
            work_orders=raw_work_orders,
            inventory_items=inventory_items,
            supplies=supplies,
            transfer_times=command.transfer_times,
            source_system="repository",
            exported_at=command.snapshot_exported_at or datetime.utcnow(),
            metadata={
                "organization_id": command.organization_id,
                "workspace_id": command.workspace_id,
                "display_workspace_id": display_workspace_id,
                "scenario_name": command.scenario_name,
                "lifecycle_status": command.lifecycle_status,
                "horizon_start": horizon_start.isoformat(),
                "horizon_end": horizon_end.isoformat(),
                "engine_version": ENGINE_VERSION,
                "planner_actions": planner_action_result.as_diagnostics(),
            },
        )
        input_snapshot_json = planning_snapshot_to_json(input_snapshot)
        input_snapshot_hash = planning_snapshot_hash(input_snapshot_json)
        transfer_times_json = input_snapshot_json["transfer_times"]
        reschedule_mode = normalize_reschedule_mode_for_decision(
            requested_strategy=command.strategy,
            requested_reschedule_mode=reschedule_mode,
            baseline_schedule_present=baseline_schedule is not None,
        )

        baseline_frozen: list[FrozenAssignment] = []
        net_change_anchor: datetime | None = None
        if baseline_schedule is not None and reschedule_mode in {"repair_local", "net_change"}:
            known_operation_ids = {
                operation.id
                for work_order in effective_work_orders
                for operation in work_order.operations
            }
            if reschedule_mode == "repair_local":
                baseline_frozen = [
                    FrozenAssignment(
                        operation_id=assignment.operation_id,
                        work_order_id=assignment.work_order_id,
                        machine_id=assignment.machine_id,
                        setup_start=assignment.setup_start,
                        start=assignment.start,
                        end=assignment.end,
                    )
                    for assignment in baseline_schedule.assignments
                    if assignment.operation_id in known_operation_ids
                ]
            else:
                net_change_anchor = self._net_change_anchor(
                    work_orders=effective_work_orders,
                    baseline_schedule=baseline_schedule,
                )
                if net_change_anchor is not None:
                    baseline_frozen = [
                        FrozenAssignment(
                            operation_id=assignment.operation_id,
                            work_order_id=assignment.work_order_id,
                            machine_id=assignment.machine_id,
                            setup_start=assignment.setup_start,
                            start=assignment.start,
                            end=assignment.end,
                        )
                        for assignment in baseline_schedule.assignments
                        if assignment.operation_id in known_operation_ids
                        and assignment.end <= net_change_anchor
                    ]
        known_operation_ids = {
            operation.id
            for work_order in effective_work_orders
            for operation in work_order.operations
        }
        frozen_by_operation = {
            item.operation_id: item
            for item in baseline_frozen
            if item.operation_id in known_operation_ids
        }
        for split in wip_split_result.splits:
            frozen_by_operation.pop(split.original_operation_id, None)
        repair_scope = build_repair_scope(
            actions=command.planner_actions,
            work_orders=effective_work_orders,
            requested_mode=command.reschedule_mode,
            effective_mode=reschedule_mode,
            baseline_schedule=baseline_schedule,
        )
        planning_policy = build_planning_policy(
            work_orders=effective_work_orders,
            baseline_schedule=baseline_schedule,
            planner_actions=command.planner_actions,
        )
        planner_impacted_operation_ids = set(repair_scope.impacted_operation_ids)
        for operation_id in planner_impacted_operation_ids:
                frozen_by_operation.pop(operation_id, None)
        for item in planner_action_result.frozen_assignments:
            if item.operation_id in known_operation_ids:
                for operation_id, existing in list(frozen_by_operation.items()):
                    if operation_id == item.operation_id:
                        continue
                    if existing.machine_id != item.machine_id:
                        continue
                    if existing.full_window.overlaps(item.full_window):
                        frozen_by_operation.pop(operation_id, None)
                frozen_by_operation[item.operation_id] = item
        for item in wip_split_result.frozen_assignments:
            if item.operation_id in known_operation_ids:
                frozen_by_operation[item.operation_id] = item
        for item in planning_policy.frozen_assignments:
            if item.operation_id in known_operation_ids:
                frozen_by_operation[item.operation_id] = item
        baseline_frozen = list(frozen_by_operation.values())
        _validate_frozen_precedence(
            frozen_assignments=baseline_frozen,
            work_orders=effective_work_orders,
            transfer_times=command.transfer_times,
            planner_actions=command.planner_actions,
        )
        _validate_frozen_secondary_resources(
            frozen_assignments=baseline_frozen,
            work_orders=effective_work_orders,
            resources=resources,
            calendars=calendars,
            horizon_start=horizon_start,
            horizon_end=horizon_end,
            planner_actions=command.planner_actions,
            repair_scope=repair_scope,
        )
        _validate_frozen_materials(
            frozen_assignments=baseline_frozen,
            work_orders=effective_work_orders,
            inventory_items=inventory_items,
            supplies=supplies,
            horizon_start=horizon_start,
            horizon_end=horizon_end,
            planner_actions=command.planner_actions,
            repair_scope=repair_scope,
        )
        effective_objective = self._effective_objective(
            command.objective,
            baseline_schedule=baseline_schedule,
            reschedule_mode=reschedule_mode,
        )

        context = SchedulingContext(
            horizon_start=horizon_start,
            horizon_end=horizon_end,
            work_orders=effective_work_orders,
            machines=machines,
            calendars=calendars,
            resources=resources,
            inventory_items=inventory_items,
            supplies=supplies,
            frozen_assignments=baseline_frozen,
            transfer_times=command.transfer_times,
            baseline_schedule=baseline_schedule,
        )

        # Step 2: Pre-solve validation gate.
        validation_gate = enforce_planning_validation_gate(
            context,
            mode="scheduling_run",
        )
        feasibility = validation_gate.feasibility

        # Step 3: Resolve strategy.
        planning_decision = select_planning_decision(
            requested_strategy=command.strategy,
            requested_reschedule_mode=command.reschedule_mode,
            selected_reschedule_mode=reschedule_mode,
            feasibility=feasibility,
            baseline_schedule_present=baseline_schedule is not None,
            lifecycle_status=command.lifecycle_status,
            planner_exceptions=_planner_exceptions_from_metadata(baseline_metadata),
            metrics=_metrics_from_metadata(baseline_metadata),
        )
        strategy = resolve_strategy(planning_decision.selected_strategy)
        # Backwards-compat: when the caller still uses the legacy greedy
        # + heuristic pair, honour the requested heuristic.
        if isinstance(strategy, GreedyStrategy) and command.heuristic:
            strategy = GreedyStrategy(heuristic=resolve_heuristic(command.heuristic))

        try:
            result = strategy.solve(context, effective_objective)
        except InfeasibleScheduleError as exc:
            raise exc

        # Step 4: Fold WIP-repair synthetic ops, then map lot-split assignments
        # back to parent WO ids.
        schedule = merge_wip_remaining_schedule(result.schedule, wip_split_result)
        schedule = reassemble_schedule(schedule, lot_result)

        # Step 5: Compute metrics and analysis.
        metrics = compute_metrics(
            schedule,
            raw_work_orders,
            horizon_start=horizon_start,
            horizon_end=horizon_end,
            baseline_schedule=baseline_schedule,
        ).as_dict()

        analysis = analyze_schedule(schedule, raw_work_orders)
        diagnostics = enrich_planner_diagnostics(
            dict(result.diagnostics),
            metrics=metrics,
            strategy=result.strategy_name,
        )
        diagnostics["decision_layer"] = planning_decision.as_dict()
        diagnostics["planner_actions"] = planner_action_result.as_diagnostics()
        diagnostics["planner_decisions"] = build_planner_decision_log(
            planner_action_result.applications
        )
        diagnostics["repair_scope"] = repair_scope.as_dict()
        diagnostics["planning_policy"] = planning_policy.as_dict()
        diagnostics["wip_remaining_split"] = wip_split_result.as_diagnostics()
        diagnostics["reschedule_mode"] = reschedule_mode
        diagnostics["policy_frozen_count"] = len(baseline_frozen)
        diagnostics["policy_wip_frozen_count"] = sum(
            1
            for lock in planning_policy.locks
            if lock.lock_type in {"completed_frozen", "started_frozen"}
        ) + len(wip_split_result.splits)
        diagnostics["policy_firm_fence_count"] = sum(
            1 for lock in planning_policy.locks if lock.lock_type == "firm_fence"
        )
        diagnostics["policy_hard_frozen_count"] = sum(
            1
            for lock in planning_policy.locks
            if lock.lock_type in {"completed_frozen", "started_frozen", "frozen_fence"}
        )
        diagnostics["stability_preference_applied"] = self._uses_stability_preference(
            effective_objective,
            baseline_schedule=baseline_schedule,
            reschedule_mode=reschedule_mode,
        )
        diagnostics["policy_anchor"] = (
            net_change_anchor.isoformat() if net_change_anchor is not None else None
        )
        if baseline_schedule is not None:
            diagnostics["stability_report"] = build_stability_report(
                schedule=schedule,
                baseline_schedule=baseline_schedule,
                frozen_operation_ids={
                    assignment.operation_id for assignment in baseline_frozen
                },
                impacted_operation_ids=planner_impacted_operation_ids,
            )
        diagnostics["input_snapshot_hash"] = input_snapshot_hash
        diagnostics["engine_version"] = ENGINE_VERSION
        diagnostics["validation_gate"] = validation_gate.as_diagnostics()
        diagnostics["input_entity_counts"] = self._entity_counts(
            calendars=calendars,
            machines=machines,
            resources=resources,
            work_orders=raw_work_orders,
            inventory_items=inventory_items,
            supplies=supplies,
        )
        diagnostics["planner_exceptions"] = build_planner_exceptions(
            feasibility=feasibility,
            diagnostics=diagnostics,
            metrics=metrics,
        )
        planner = diagnostics.get("planner_diagnostics")
        if isinstance(planner, dict):
            planner["decision_layer"] = diagnostics["decision_layer"]
            planner["planner_actions"] = diagnostics["planner_actions"]
            planner["planner_decisions"] = diagnostics["planner_decisions"]
            planner["repair_scope"] = diagnostics["repair_scope"]
            planner["planning_policy"] = diagnostics["planning_policy"]
            planner["wip_remaining_split"] = diagnostics["wip_remaining_split"]
            planner["exceptions"] = diagnostics["planner_exceptions"]
        summary = build_schedule_summary(
            schedule=schedule,
            metrics=metrics,
            analysis=analysis,
            diagnostics=diagnostics,
            work_orders=raw_work_orders,
        )

        # Step 6: Persist.
        if command.persist and self._schedules is not None:
            self._schedules.save(
                schedule,
                metrics=metrics,
                workspace_id=display_workspace_id,
                scenario_name=command.scenario_name,
                lifecycle_status=command.lifecycle_status,
                strategy=result.strategy_name,
                solver_status=result.solver_status,
                objective_value=result.objective_value,
                wall_time_ms=result.wall_time_ms,
                diagnostics=diagnostics,
                organization_id=command.organization_id,
                horizon_start=horizon_start,
                horizon_end=horizon_end,
                objective=objective_json,
                transfer_times=transfer_times_json,
                input_snapshot=input_snapshot_json,
                input_snapshot_hash=input_snapshot_hash,
                engine_version=ENGINE_VERSION,
            )

        return RunSchedulingOutput(
            schedule=schedule,
            metrics=metrics,
            strategy=result.strategy_name,
            solver_status=result.solver_status,
            objective_value=result.objective_value,
            wall_time_ms=result.wall_time_ms,
            diagnostics=diagnostics,
            summary=summary,
            analysis=analysis,
            feasibility=feasibility,
            organization_id=command.organization_id,
            horizon_start=horizon_start,
            horizon_end=horizon_end,
            objective=objective_json,
            transfer_times=transfer_times_json,
            input_snapshot_hash=input_snapshot_hash,
            engine_version=ENGINE_VERSION,
        )


def _validate_frozen_precedence(
    *,
    frozen_assignments: list[FrozenAssignment],
    work_orders: list[WorkOrder],
    transfer_times: TransferTimes,
    planner_actions: list[PlannerAction],
) -> None:
    """Reject pinned/frozen combinations that violate operation dependencies."""

    pinned_operation_ids = {
        action.operation_id
        for action in planner_actions
        if action.action_type.strip().lower() == "pin_operation_window"
        and action.operation_id is not None
    }
    if not pinned_operation_ids:
        return

    frozen_by_operation = {
        assignment.operation_id: assignment for assignment in frozen_assignments
    }
    work_order_by_id = {work_order.id: work_order for work_order in work_orders}
    operations_by_id = {
        operation.id: operation
        for work_order in work_orders
        for operation in work_order.operations
    }

    for operation_id in sorted(pinned_operation_ids):
        operation = operations_by_id.get(operation_id)
        if operation is None:
            continue
        work_order = work_order_by_id.get(operation.work_order_id)
        if work_order is None:
            continue
        successor_assignment = frozen_by_operation.get(operation_id)
        if successor_assignment is None:
            continue
        for link in operation_dependency_links(work_order, operation):
            predecessor_assignment = frozen_by_operation.get(link.depends_on_id)
            if predecessor_assignment is None:
                raise ValidationError(
                    f"pin_operation_window for operation {operation_id!r} depends "
                    f"on {link.depends_on_id!r}, but that predecessor is not locked "
                    "in the repair baseline. Freeze or pin the predecessor first."
                )
            transfer = transfer_times.minutes(
                predecessor_assignment.machine_id,
                successor_assignment.machine_id,
            )
            min_start = dependency_min_start(
                link,
                predecessor_start=predecessor_assignment.start,
                predecessor_end=predecessor_assignment.end,
                transfer_minutes=transfer,
            )
            if successor_assignment.start < min_start:
                raise ValidationError(
                    f"pin_operation_window for operation {operation_id!r} violates "
                    f"dependency on {link.depends_on_id!r}: starts at "
                    f"{successor_assignment.start.isoformat()}, earliest allowed is "
                    f"{min_start.isoformat()}."
                )
            max_start = dependency_max_start(
                link,
                predecessor_start=predecessor_assignment.start,
                predecessor_end=predecessor_assignment.end,
            )
            if max_start is not None and successor_assignment.start > max_start:
                raise ValidationError(
                    f"pin_operation_window for operation {operation_id!r} violates "
                    f"max-wait dependency on {link.depends_on_id!r}: starts at "
                    f"{successor_assignment.start.isoformat()}, latest allowed is "
                    f"{max_start.isoformat()}."
                )


def _validate_frozen_secondary_resources(
    *,
    frozen_assignments: list[FrozenAssignment],
    work_orders: list[WorkOrder],
    resources: list[Resource],
    calendars: list[WorkingCalendar],
    horizon_start: datetime,
    horizon_end: datetime,
    planner_actions: list[PlannerAction],
    repair_scope=None,
) -> None:
    """Reject exact pins that overbook frozen secondary-resource capacity."""

    pinned_operation_ids = {
        action.operation_id
        for action in planner_actions
        if action.action_type.strip().lower() == "pin_operation_window"
        and action.operation_id is not None
    }
    if not pinned_operation_ids or not resources:
        return

    calendar_by_id = {calendar.id: calendar for calendar in calendars}
    resolver = CalendarResolver(horizon_start, horizon_end)
    timelines = build_resource_timelines(resources, calendar_by_id, resolver)
    operations_by_id = {
        operation.id: operation
        for work_order in work_orders
        for operation in work_order.operations
    }
    for assignment in sorted(
        frozen_assignments,
        key=lambda item: (item.setup_start, item.operation_id),
    ):
        operation = operations_by_id.get(assignment.operation_id)
        if operation is None:
            continue
        requirements = _requirements_for_assignment(operation, assignment)
        for requirement in requirements:
            timeline = timelines.get(requirement.resource_id)
            if timeline is None:
                continue
            if not timeline.can_accommodate(
                assignment.full_window,
                requirement.units,
            ):
                if assignment.operation_id in pinned_operation_ids:
                    raise ValidationError(
                        "pin_operation_window for operation "
                        f"{assignment.operation_id!r} overbooks secondary resource "
                        f"{requirement.resource_id!r}."
                        f"{_repair_scope_hint(repair_scope, 'resource_conflict')}"
                    )
                raise ValidationError(
                    "pin_operation_window conflicts with frozen operation "
                    f"{assignment.operation_id!r} on secondary resource "
                    f"{requirement.resource_id!r}."
                    f"{_repair_scope_hint(repair_scope, 'resource_conflict')}"
                )
        for requirement in requirements:
            timeline = timelines.get(requirement.resource_id)
            if timeline is not None:
                timeline.book(
                    assignment.full_window,
                    requirement.units,
                    assignment.operation_id,
                )


def _requirements_for_assignment(operation, assignment: FrozenAssignment):
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


def _validate_frozen_materials(
    *,
    frozen_assignments: list[FrozenAssignment],
    work_orders: list[WorkOrder],
    inventory_items: list[InventoryItem],
    supplies: list[SupplyLot],
    horizon_start: datetime,
    horizon_end: datetime,
    planner_actions: list[PlannerAction],
    repair_scope=None,
) -> None:
    """Reject exact pins that consume material before it is available."""

    pinned_operation_ids = {
        action.operation_id
        for action in planner_actions
        if action.action_type.strip().lower() == "pin_operation_window"
        and action.operation_id is not None
    }
    if not pinned_operation_ids:
        return

    operations_by_id = {}
    quantity_by_operation: dict[str, int] = {}
    for work_order in work_orders:
        for operation in work_order.operations:
            operations_by_id[operation.id] = operation
            quantity_by_operation[operation.id] = work_order.quantity

    ledger = MaterialLedger(
        inventory_items=inventory_items,
        supplies=supplies,
        horizon_start=horizon_start,
    )
    for assignment in sorted(
        frozen_assignments,
        key=lambda item: (item.start, item.operation_id),
    ):
        operation = operations_by_id.get(assignment.operation_id)
        if operation is None or not operation.material_requirements:
            continue
        assessment = ledger.assess(
            requirements=operation.material_requirements,
            work_order_quantity=quantity_by_operation.get(operation.id, 1),
            not_before=assignment.start,
            horizon_end=horizon_end,
        )
        is_pinned = assignment.operation_id in pinned_operation_ids
        if assessment.ready_at is None or assessment.ready_at > assignment.start:
            if not is_pinned:
                # The op is not the one being pinned: its material was
                # already reserved in the baseline run that produced
                # this schedule. The current run is only adding a new
                # pin elsewhere; we don't re-reject the baseline just
                # because SupplyLot timestamps have drifted since it
                # was generated. Skip the reservation for this op and
                # keep iterating.
                continue
            material_id = assessment.blocking_material_id or next(
                req.material_id for req in operation.material_requirements
            )
            if assessment.ready_at is None:
                availability = "not available inside the planning horizon"
            else:
                availability = f"ready at {assessment.ready_at.isoformat()}"
            raise ValidationError(
                "pin_operation_window for operation "
                f"{assignment.operation_id!r} requires material "
                f"{material_id!r}, but it is {availability}; pinned start is "
                f"{assignment.start.isoformat()}."
                f"{_repair_scope_hint(repair_scope, 'material_conflict')}"
            )
        ledger.reserve(
            operation_id=assignment.operation_id,
            requirements=operation.material_requirements,
            work_order_quantity=quantity_by_operation.get(operation.id, 1),
            required_at=assignment.start,
            reservation_origin="frozen",
        )


def _repair_scope_hint(repair_scope, kind: str) -> str:
    if repair_scope is None:
        return ""
    recommendations = getattr(repair_scope, "recommended_actions", ())
    for item in recommendations:
        if item.get("kind") != kind:
            continue
        action = item.get("recommended_action")
        candidates = item.get("planner_action_candidates")
        if not isinstance(action, str):
            return ""
        candidate_text = ""
        if isinstance(candidates, list) and candidates:
            candidate_text = f" Candidate actions: {', '.join(str(value) for value in candidates)}."
        return f" Suggested action: {action}.{candidate_text}"
    return ""
