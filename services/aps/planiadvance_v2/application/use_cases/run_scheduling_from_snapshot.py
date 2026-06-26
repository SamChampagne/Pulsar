"""Use case: run scheduling directly from a canonical planning snapshot."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ...application.integration import CanonicalPlanningSnapshot, snapshot_to_domain_inputs
from ...domain.errors import InfeasibleScheduleError
from ...domain.scheduling import (
    Objective,
    SchedulingContext,
    analyze_schedule,
    compute_metrics,
    reassemble_schedule,
    resolve_heuristic,
    resolve_strategy,
    split_lots,
)
from ...domain.scheduling.greedy_strategy import GreedyStrategy
from .planner_diagnostics import enrich_planner_diagnostics
from .planner_exceptions import build_planner_exceptions
from .planning_decision_layer import select_planning_decision
from .planning_validation_gate import enforce_planning_validation_gate
from .result_summary import build_schedule_summary
from .run_scheduling import RunSchedulingOutput


@dataclass(slots=True)
class RunSchedulingFromSnapshotInput:
    snapshot: CanonicalPlanningSnapshot
    horizon_start: datetime | None = None
    horizon_days: int = 30
    heuristic: str = "edd"
    strategy: str = "greedy"
    objective: Objective = field(default_factory=Objective.default)


class RunSchedulingFromSnapshot:
    def execute(
        self, command: RunSchedulingFromSnapshotInput
    ) -> RunSchedulingOutput:
        horizon_start = command.horizon_start or datetime.utcnow().replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        horizon_end = horizon_start + timedelta(days=command.horizon_days)

        (
            calendars,
            machines,
            resources,
            raw_work_orders,
            inventory_items,
            supplies,
            transfer_times,
        ) = (
            snapshot_to_domain_inputs(command.snapshot)
        )

        lot_result = split_lots(raw_work_orders)
        effective_work_orders = lot_result.work_orders

        context = SchedulingContext(
            horizon_start=horizon_start,
            horizon_end=horizon_end,
            work_orders=effective_work_orders,
            machines=machines,
            calendars=calendars,
            resources=resources,
            inventory_items=inventory_items,
            supplies=supplies,
            transfer_times=transfer_times,
        )

        validation_gate = enforce_planning_validation_gate(
            context,
            mode="snapshot_scheduling_run",
        )
        feasibility = validation_gate.feasibility

        planning_decision = select_planning_decision(
            requested_strategy=command.strategy,
            requested_reschedule_mode="reschedule_all",
            selected_reschedule_mode="reschedule_all",
            feasibility=feasibility,
        )
        strategy = resolve_strategy(planning_decision.selected_strategy)
        if isinstance(strategy, GreedyStrategy) and command.heuristic:
            strategy = GreedyStrategy(heuristic=resolve_heuristic(command.heuristic))

        try:
            result = strategy.solve(context, command.objective)
        except InfeasibleScheduleError as exc:
            raise exc

        schedule = reassemble_schedule(result.schedule, lot_result)
        metrics = compute_metrics(
            schedule,
            raw_work_orders,
            horizon_start=horizon_start,
            horizon_end=horizon_end,
        ).as_dict()
        analysis = analyze_schedule(schedule, raw_work_orders)
        diagnostics = enrich_planner_diagnostics(
            dict(result.diagnostics),
            metrics=metrics,
            strategy=result.strategy_name,
        )
        diagnostics["decision_layer"] = planning_decision.as_dict()
        diagnostics["validation_gate"] = validation_gate.as_diagnostics()
        diagnostics["planner_exceptions"] = build_planner_exceptions(
            feasibility=feasibility,
            diagnostics=diagnostics,
            metrics=metrics,
        )
        planner = diagnostics.get("planner_diagnostics")
        if isinstance(planner, dict):
            planner["decision_layer"] = diagnostics["decision_layer"]
            planner["exceptions"] = diagnostics["planner_exceptions"]
        summary = build_schedule_summary(
            schedule=schedule,
            metrics=metrics,
            analysis=analysis,
            diagnostics=diagnostics,
            work_orders=raw_work_orders,
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
        )
