"""Use case: reactive disruption handler.

Shop floors are messy — machines break, rush orders arrive, quality holds
freeze a batch, operators call in sick. An APS engine that cannot react
to these events in under a second is useless: the planner will revert to
a whiteboard within a week.

This use case accepts a **disruption event**, inspects the current
schedule to decide which operations are already locked (in-progress or
completed), and re-plans the remaining operations with the locked ones
frozen in place. The result is a new schedule that respects reality on
the ground while still optimising for the objective.

Supported disruption types
--------------------------
``MACHINE_DOWN``
    A machine is unavailable from ``event_start`` until ``event_end``
    (estimated repair time). Operations currently running on it are
    frozen at their start but must be rescheduled if they haven't
    started yet.

``RUSH_ORDER``
    A high-priority work order is injected into the plan. All other
    orders shift as needed.

``OPERATION_DELAY``
    An in-progress operation will take longer than planned. Its end
    time is pushed and successors replan.

The handler is strategy-agnostic: it builds a new
:class:`SchedulingContext` with frozen assignments and delegates to
whatever strategy the caller selects.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum, auto

from ...domain.entities import (
    InventoryItem,
    Machine,
    Resource,
    Schedule,
    SupplyLot,
    WorkingCalendar,
    WorkOrder,
)
from ...domain.errors import ValidationError
from ...domain.scheduling import (
    FrozenAssignment,
    Objective,
    SchedulingContext,
    compute_metrics,
    resolve_strategy,
)
from ...domain.value_objects import TimeWindow, TransferTimes
from .planning_decision_layer import (
    normalize_reschedule_mode_for_decision,
    select_planning_decision,
)
from .planning_validation_gate import enforce_planning_validation_gate


class DisruptionType(Enum):
    MACHINE_DOWN = auto()
    RUSH_ORDER = auto()
    OPERATION_DELAY = auto()


@dataclass(frozen=True, slots=True)
class DisruptionEvent:
    """A shop-floor event that triggers re-planning.

    ``disruption_type``
        What happened.
    ``timestamp``
        When the event was detected (= "now" on the shop floor).
    ``machine_id``
        For MACHINE_DOWN: which machine is affected.
    ``event_end``
        For MACHINE_DOWN: estimated return-to-service time.
    ``operation_id``
        For OPERATION_DELAY: which operation is delayed.
    ``new_end``
        For OPERATION_DELAY: revised completion time.
    ``rush_order``
        For RUSH_ORDER: the new work order to inject.
    """

    disruption_type: DisruptionType
    timestamp: datetime
    machine_id: str | None = None
    event_end: datetime | None = None
    operation_id: str | None = None
    new_end: datetime | None = None
    rush_order: WorkOrder | None = None


@dataclass(slots=True)
class HandleDisruptionInput:
    event: DisruptionEvent
    current_schedule: Schedule
    work_orders: list[WorkOrder]
    machines: list[Machine]
    calendars: list[WorkingCalendar]
    horizon_start: datetime
    horizon_end: datetime
    strategy: str = "greedy"
    objective: Objective = field(default_factory=Objective.default)
    resources: list[Resource] = field(default_factory=list)
    inventory_items: list[InventoryItem] = field(default_factory=list)
    supplies: list[SupplyLot] = field(default_factory=list)
    transfer_times: TransferTimes = field(default_factory=TransferTimes)
    reschedule_mode: str = "repair_local"
    lifecycle_status: str = "draft"
    baseline_metrics: dict = field(default_factory=dict)
    baseline_planner_exceptions: dict | None = None


@dataclass(slots=True)
class HandleDisruptionOutput:
    schedule: Schedule
    metrics: dict
    frozen_count: int
    frozen_operation_ids: list[str]
    rescheduled_count: int
    strategy: str
    solver_status: str
    objective_value: int
    wall_time_ms: int
    diagnostics: dict
    reschedule_mode: str


class HandleDisruption:
    """Reactive disruption handler — re-plans around shop-floor events."""

    @staticmethod
    def _effective_objective(
        objective: Objective,
        *,
        reschedule_mode: str,
    ) -> Objective:
        if (
            reschedule_mode == "reschedule_all"
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
        reschedule_mode: str,
    ) -> bool:
        return reschedule_mode != "reschedule_all" and (
            objective.start_shift_penalty > 0
            or objective.machine_change_penalty > 0
        )

    @staticmethod
    def _net_change_anchor(
        *,
        event: DisruptionEvent,
        horizon_end: datetime,
    ) -> datetime:
        if event.disruption_type == DisruptionType.MACHINE_DOWN:
            return event.event_end or horizon_end
        if event.disruption_type == DisruptionType.OPERATION_DELAY:
            return event.new_end or event.timestamp
        if event.disruption_type == DisruptionType.RUSH_ORDER and event.rush_order is not None:
            return event.rush_order.release_date
        return event.timestamp

    def execute(self, command: HandleDisruptionInput) -> HandleDisruptionOutput:
        event = command.event
        now = event.timestamp
        # Guard against a stale event_end that fell behind the planner's
        # clock. The downstream TimeWindow(start=now, end=event_end)
        # raises an obscure 500; surface a clear validation error instead.
        if event.event_end is not None and event.event_end < event.timestamp:
            raise ValidationError(
                f"Disruption event_end ({event.event_end.isoformat()}) "
                f"must be after the event timestamp "
                f"({event.timestamp.isoformat()})."
            )
        reschedule_mode = command.reschedule_mode.strip().lower()
        if reschedule_mode not in {"repair_local", "reschedule_all", "net_change"}:
            raise ValidationError(
                "reschedule_mode must be one of: repair_local, reschedule_all, net_change"
            )
        reschedule_mode = normalize_reschedule_mode_for_decision(
            requested_strategy=command.strategy,
            requested_reschedule_mode=reschedule_mode,
            baseline_schedule_present=True,
        )

        # Step 1: Identify frozen operations — anything that started
        # before ``now`` is locked in place on the shop floor.
        frozen: list[FrozenAssignment] = []
        reschedulable_op_ids: set[str] = set()

        for assignment in command.current_schedule.assignments:
            if assignment.setup_start <= now:
                # Already started or completed — freeze it.
                frozen.append(
                    FrozenAssignment(
                        operation_id=assignment.operation_id,
                        work_order_id=assignment.work_order_id,
                        machine_id=assignment.machine_id,
                        setup_start=assignment.setup_start,
                        start=assignment.start,
                        end=assignment.end,
                    )
                )
            else:
                reschedulable_op_ids.add(assignment.operation_id)

        # Step 2: Apply disruption-specific adjustments.
        work_orders = list(command.work_orders)
        machines = list(command.machines)

        if event.disruption_type == DisruptionType.MACHINE_DOWN:
            frozen, machines = self._handle_machine_down(
                event, frozen, machines, now, command.horizon_end
            )

        elif event.disruption_type == DisruptionType.RUSH_ORDER:
            if event.rush_order is not None:
                work_orders = list(work_orders) + [event.rush_order]

        elif event.disruption_type == DisruptionType.OPERATION_DELAY:
            frozen = self._handle_operation_delay(event, frozen, work_orders)

        policy_frozen_count = 0
        policy_anchor: datetime | None = None
        if reschedule_mode == "repair_local":
            frozen, policy_frozen_count = self._freeze_unaffected_assignments(
                event=event,
                current_schedule=command.current_schedule,
                work_orders=work_orders,
                frozen=frozen,
                now=now,
            )
        elif reschedule_mode == "net_change":
            policy_anchor = self._net_change_anchor(
                event=event,
                horizon_end=command.horizon_end,
            )
            frozen, policy_frozen_count = self._freeze_net_change_prefix(
                event=event,
                current_schedule=command.current_schedule,
                work_orders=work_orders,
                frozen=frozen,
                anchor=policy_anchor,
            )
        effective_objective = self._effective_objective(
            command.objective,
            reschedule_mode=reschedule_mode,
        )

        # Step 3: Build a new context with frozen assignments and replan.
        context = SchedulingContext(
            horizon_start=command.horizon_start,
            horizon_end=command.horizon_end,
            work_orders=work_orders,
            machines=machines,
            calendars=command.calendars,
            resources=command.resources,
            inventory_items=command.inventory_items,
            supplies=command.supplies,
            frozen_assignments=frozen,
            transfer_times=command.transfer_times,
            baseline_schedule=command.current_schedule,
        )
        validation_gate = enforce_planning_validation_gate(
            context,
            mode="disruption_replan",
        )
        planning_decision = select_planning_decision(
            requested_strategy=command.strategy,
            requested_reschedule_mode=command.reschedule_mode,
            selected_reschedule_mode=reschedule_mode,
            feasibility=validation_gate.feasibility,
            baseline_schedule_present=True,
            lifecycle_status=command.lifecycle_status,
            planner_exceptions=command.baseline_planner_exceptions,
            metrics=command.baseline_metrics,
        )

        strategy = resolve_strategy(planning_decision.selected_strategy)
        result = strategy.solve(context, effective_objective)

        metrics = compute_metrics(
            result.schedule,
            work_orders,
            horizon_start=command.horizon_start,
            horizon_end=command.horizon_end,
        ).as_dict()

        frozen_count = len(frozen)
        rescheduled_count = len(result.schedule.assignments) - frozen_count

        return HandleDisruptionOutput(
            schedule=result.schedule,
            metrics=metrics,
            frozen_count=frozen_count,
            frozen_operation_ids=sorted(fa.operation_id for fa in frozen),
            rescheduled_count=rescheduled_count,
            strategy=result.strategy_name,
            solver_status=result.solver_status,
            objective_value=result.objective_value,
            wall_time_ms=result.wall_time_ms,
            diagnostics={
                **dict(result.diagnostics),
                "reschedule_mode": reschedule_mode,
                "policy_frozen_count": policy_frozen_count,
                "policy_anchor": (
                    policy_anchor.isoformat() if policy_anchor is not None else None
                ),
                "stability_preference_applied": self._uses_stability_preference(
                    effective_objective,
                    reschedule_mode=reschedule_mode,
                ),
                "validation_gate": validation_gate.as_diagnostics(),
                "decision_layer": planning_decision.as_dict(),
            },
            reschedule_mode=reschedule_mode,
        )

    # ---------------------------------------------------------------- private

    @staticmethod
    def _handle_machine_down(
        event: DisruptionEvent,
        frozen: list[FrozenAssignment],
        machines: list[Machine],
        now: datetime,
        horizon_end: datetime,
    ) -> tuple[list[FrozenAssignment], list[Machine]]:
        """Block the broken machine with a maintenance window.

        Instead of removing the machine from the context (which would
        fail validation because operations still reference it as
        eligible), we inject a maintenance window covering ``[now,
        event_end]``. The calendar resolver will exclude that window
        from available slots, so no new operations are placed on the
        machine during the downtime. After the downtime the machine
        becomes available again automatically.

        Operations frozen on the downed machine that haven't completed
        yet are dropped from frozen — they're physically stuck. The
        strategy will reschedule them on other machines.
        """
        if event.machine_id is None:
            return frozen, machines

        down_end = event.event_end or horizon_end
        down_window = TimeWindow(start=now, end=down_end)

        updated_machines: list[Machine] = []
        for m in machines:
            if m.id == event.machine_id:
                updated_machines.append(
                    Machine(
                        id=m.id,
                        name=m.name,
                        calendar_id=m.calendar_id,
                        capabilities=m.capabilities,
                        efficiency=m.efficiency,
                        setup_matrix=m.setup_matrix,
                        maintenance_windows=list(m.maintenance_windows)
                        + [down_window],
                    )
                )
            else:
                updated_machines.append(m)

        # Drop frozen assignments on the downed machine that haven't
        # ended yet — they can't complete. The strategy will reschedule
        # their operations on other machines.
        surviving_frozen = [
            fa for fa in frozen
            if fa.machine_id != event.machine_id or fa.end <= now
        ]
        return surviving_frozen, updated_machines

    @staticmethod
    def _handle_operation_delay(
        event: DisruptionEvent,
        frozen: list[FrozenAssignment],
        work_orders: list[WorkOrder],
    ) -> list[FrozenAssignment]:
        """Push the end time of a delayed operation.

        The frozen assignment keeps its start but gets a new end.
        Any frozen operations in the *same work order* that were
        scheduled to start before the new end are unfrozen so the
        strategy can reschedule them after the delay. Without this,
        successors that were frozen at their original (now-invalid)
        times would stay put and create an impossible schedule.
        """
        if event.operation_id is None or event.new_end is None:
            return frozen

        # Find the work order containing the delayed op so we can
        # identify co-WO operations that must be unfrozen.
        delayed_wo_id: str | None = None
        delayed_sequence: int = 0
        for wo in work_orders:
            for op in wo.operations:
                if op.id == event.operation_id:
                    delayed_wo_id = wo.id
                    delayed_sequence = op.sequence
                    break

        updated: list[FrozenAssignment] = []
        for fa in frozen:
            if fa.operation_id == event.operation_id:
                # Push the delayed op's end.
                updated.append(
                    FrozenAssignment(
                        operation_id=fa.operation_id,
                        work_order_id=fa.work_order_id,
                        machine_id=fa.machine_id,
                        setup_start=fa.setup_start,
                        start=fa.start,
                        end=event.new_end,
                    )
                )
            elif (
                fa.work_order_id == delayed_wo_id
                and fa.setup_start < event.new_end
                and fa.operation_id != event.operation_id
            ):
                # This is a co-WO operation that started before the
                # new delayed end. It may be a successor of the delayed
                # op that needs to be rescheduled. Unfreeze it.
                # Check if it's a successor (higher sequence).
                is_successor = False
                for wo in work_orders:
                    if wo.id == delayed_wo_id:
                        for op in wo.operations:
                            if (
                                op.id == fa.operation_id
                                and op.sequence > delayed_sequence
                            ):
                                is_successor = True
                                break
                if is_successor:
                    continue  # drop from frozen — will be rescheduled
                updated.append(fa)
            else:
                updated.append(fa)
        return updated

    @staticmethod
    def _freeze_unaffected_assignments(
        *,
        event: DisruptionEvent,
        current_schedule: Schedule,
        work_orders: list[WorkOrder],
        frozen: list[FrozenAssignment],
        now: datetime,
        ) -> tuple[list[FrozenAssignment], int]:
        frozen_ids = {assignment.operation_id for assignment in frozen}
        impacted_work_orders: set[str] = set()
        impacted_machines: set[str] = set()

        if event.disruption_type == DisruptionType.MACHINE_DOWN and event.machine_id is not None:
            impacted_machines.add(event.machine_id)
            impacted_work_orders.update(
                assignment.work_order_id
                for assignment in current_schedule.assignments
                if assignment.machine_id == event.machine_id and assignment.setup_start >= now
            )
        elif event.disruption_type == DisruptionType.OPERATION_DELAY and event.operation_id is not None:
            for work_order in work_orders:
                if any(operation.id == event.operation_id for operation in work_order.operations):
                    impacted_work_orders.add(work_order.id)
                    break
        elif event.disruption_type == DisruptionType.RUSH_ORDER and event.rush_order is not None:
            impacted_work_orders.add(event.rush_order.id)

        policy_frozen_count = 0
        updated = list(frozen)
        for assignment in current_schedule.assignments:
            if assignment.operation_id in frozen_ids or assignment.setup_start <= now:
                continue
            if assignment.machine_id in impacted_machines:
                continue
            if assignment.work_order_id in impacted_work_orders:
                continue
            updated.append(
                FrozenAssignment(
                    operation_id=assignment.operation_id,
                    work_order_id=assignment.work_order_id,
                    machine_id=assignment.machine_id,
                    setup_start=assignment.setup_start,
                    start=assignment.start,
                    end=assignment.end,
                )
            )
            frozen_ids.add(assignment.operation_id)
            policy_frozen_count += 1
        return updated, policy_frozen_count

    @staticmethod
    def _freeze_net_change_prefix(
        *,
        event: DisruptionEvent,
        current_schedule: Schedule,
        work_orders: list[WorkOrder],
        frozen: list[FrozenAssignment],
        anchor: datetime,
    ) -> tuple[list[FrozenAssignment], int]:
        frozen_ids = {assignment.operation_id for assignment in frozen}
        impacted_work_orders: set[str] = set()
        impacted_machines: set[str] = set()

        if event.disruption_type == DisruptionType.MACHINE_DOWN and event.machine_id is not None:
            impacted_machines.add(event.machine_id)
            impacted_work_orders.update(
                assignment.work_order_id
                for assignment in current_schedule.assignments
                if assignment.machine_id == event.machine_id
            )
        elif event.disruption_type == DisruptionType.OPERATION_DELAY and event.operation_id is not None:
            for work_order in work_orders:
                if any(operation.id == event.operation_id for operation in work_order.operations):
                    impacted_work_orders.add(work_order.id)
                    break
        elif event.disruption_type == DisruptionType.RUSH_ORDER and event.rush_order is not None:
            impacted_work_orders.add(event.rush_order.id)

        updated = list(frozen)
        policy_frozen_count = 0
        for assignment in current_schedule.assignments:
            if assignment.operation_id in frozen_ids:
                continue
            if assignment.end > anchor:
                continue
            if assignment.machine_id in impacted_machines:
                continue
            if assignment.work_order_id in impacted_work_orders:
                continue
            updated.append(
                FrozenAssignment(
                    operation_id=assignment.operation_id,
                    work_order_id=assignment.work_order_id,
                    machine_id=assignment.machine_id,
                    setup_start=assignment.setup_start,
                    start=assignment.start,
                    end=assignment.end,
                )
            )
            frozen_ids.add(assignment.operation_id)
            policy_frozen_count += 1
        return updated, policy_frozen_count
