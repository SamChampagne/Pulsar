"""Use case: summarize operational schedule risk for a planning window."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from ...domain.errors import ValidationError
from .get_schedule_gantt import (
    GanttOperationItem,
    GetScheduleGantt,
    ScheduleGanttOutput,
)


@dataclass(slots=True)
class ScheduleRiskOperation:
    operation_id: str
    work_order_id: str
    machine_id: str
    start: datetime
    end: datetime
    due_date: datetime | None
    severity: str
    reasons: list[str] = field(default_factory=list)
    lateness_minutes: int = 0


@dataclass(slots=True)
class ScheduleRiskWorkOrder:
    work_order_id: str
    work_order_name: str | None
    due_date: datetime | None
    severity: str
    operation_count: int
    late_operation_count: int
    critical_operation_count: int
    last_end: datetime | None
    reasons: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ScheduleRiskMachinePressure:
    machine_id: str
    machine_name: str | None
    assignment_count: int
    load_minutes: int
    utilization: float
    pressure: str
    late_count: int
    critical_count: int


@dataclass(slots=True)
class ScheduleRiskConstraint:
    operation_id: str
    work_order_id: str
    machine_id: str
    planning_lock: str
    planning_zone: str
    move_policy: str
    severity: str
    reason: str


@dataclass(slots=True)
class ScheduleRiskAction:
    action: str
    label: str
    reason: str
    priority: int
    target_ids: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ScheduleRiskOutput:
    schedule_id: str
    generated_at: datetime
    window_start: datetime
    window_end: datetime
    status: str
    risk_score: int
    summary: dict[str, int | float | str | None] = field(default_factory=dict)
    late_operations: list[ScheduleRiskOperation] = field(default_factory=list)
    critical_operations: list[ScheduleRiskOperation] = field(default_factory=list)
    at_risk_work_orders: list[ScheduleRiskWorkOrder] = field(default_factory=list)
    machine_pressure: list[ScheduleRiskMachinePressure] = field(default_factory=list)
    firm_frozen_constraints: list[ScheduleRiskConstraint] = field(default_factory=list)
    recommended_actions: list[ScheduleRiskAction] = field(default_factory=list)


class GetScheduleRisk:
    def __init__(self, gantt: GetScheduleGantt) -> None:
        self._gantt = gantt

    def execute(
        self,
        schedule_id: str,
        *,
        organization_id: str | None = None,
        baseline_schedule_id: str | None = None,
        window_start: datetime | None = None,
        window_end: datetime | None = None,
    ) -> ScheduleRiskOutput:
        gantt = self._gantt.execute(
            schedule_id,
            organization_id=organization_id,
            baseline_schedule_id=baseline_schedule_id,
        )
        start = (
            _normalize_window_datetime(window_start)
            or gantt.horizon_start
            or _first_item_start(gantt)
        )
        end = (
            _normalize_window_datetime(window_end)
            or gantt.horizon_end
            or _last_item_end(gantt)
        )
        if start is None or end is None:
            raise ValidationError(f"Schedule {schedule_id!r} has no planning window")
        if end <= start:
            raise ValidationError("risk window_end must be after window_start")

        visible_items = [
            item for item in gantt.items if _item_overlaps_window(item, start, end)
        ]
        late_operations = [
            _risk_operation(item)
            for item in visible_items
            if item.is_late
        ]
        critical_operations = [
            _risk_operation(item)
            for item in visible_items
            if item.is_critical
        ]
        constraints = [
            _risk_constraint(item)
            for item in visible_items
            if _is_constrained(item)
        ]
        machine_pressure = _machine_pressure(visible_items, start, end)
        work_orders = _work_order_risks(visible_items)
        score = _risk_score(
            late_count=len(late_operations),
            critical_count=len(critical_operations),
            work_order_count=len(work_orders),
            constraint_count=len(constraints),
            pressure_count=sum(1 for item in machine_pressure if item.pressure == "high"),
            changed_count=sum(1 for item in visible_items if item.changed_from_baseline),
        )
        status = _risk_status(
            score=score,
            late_count=len(late_operations),
            constraint_count=len(constraints),
            pressure_count=sum(1 for item in machine_pressure if item.pressure == "high"),
        )

        return ScheduleRiskOutput(
            schedule_id=gantt.schedule_id,
            generated_at=datetime.utcnow(),
            window_start=start,
            window_end=end,
            status=status,
            risk_score=score,
            summary={
                "visible_operation_count": len(visible_items),
                "hidden_operation_count": max(0, len(gantt.items) - len(visible_items)),
                "late_operation_count": len(late_operations),
                "critical_operation_count": len(critical_operations),
                "changed_operation_count": sum(
                    1 for item in visible_items if item.changed_from_baseline
                ),
                "constraint_count": len(constraints),
                "at_risk_work_order_count": len(work_orders),
                "high_pressure_machine_count": sum(
                    1 for item in machine_pressure if item.pressure == "high"
                ),
                "active_machine_count": len(machine_pressure),
                "window_hours": round((end - start).total_seconds() / 3600, 2),
            },
            late_operations=sorted(
                late_operations,
                key=lambda item: (-item.lateness_minutes, item.operation_id),
            ),
            critical_operations=sorted(
                critical_operations,
                key=lambda item: (item.end, item.operation_id),
            ),
            at_risk_work_orders=work_orders,
            machine_pressure=machine_pressure,
            firm_frozen_constraints=constraints,
            recommended_actions=_recommended_actions(
                late_operations=late_operations,
                critical_operations=critical_operations,
                work_orders=work_orders,
                machine_pressure=machine_pressure,
                constraints=constraints,
            ),
        )


def _first_item_start(gantt: ScheduleGanttOutput) -> datetime | None:
    return min((item.setup_start for item in gantt.items), default=None)


def _last_item_end(gantt: ScheduleGanttOutput) -> datetime | None:
    return max((item.end for item in gantt.items), default=None)


def _normalize_window_datetime(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _item_overlaps_window(
    item: GanttOperationItem,
    start: datetime,
    end: datetime,
) -> bool:
    return item.setup_start < end and item.end > start


def _risk_operation(item: GanttOperationItem) -> ScheduleRiskOperation:
    reasons: list[str] = []
    lateness_minutes = 0
    if item.due_date is not None and item.end > item.due_date:
        lateness_minutes = int((item.end - item.due_date).total_seconds() // 60)
        reasons.append("late_against_due_date")
    if item.is_critical:
        reasons.append("critical_path")
    if item.changed_from_baseline:
        reasons.append("changed_from_baseline")
    if _is_constrained(item):
        reasons.append("constrained_by_planning_policy")
    severity = "critical" if lateness_minutes > 0 else "warning"
    return ScheduleRiskOperation(
        operation_id=item.operation_id,
        work_order_id=item.work_order_id,
        machine_id=item.machine_id,
        start=item.start,
        end=item.end,
        due_date=item.due_date,
        severity=severity,
        reasons=reasons,
        lateness_minutes=lateness_minutes,
    )


def _is_constrained(item: GanttOperationItem) -> bool:
    move_policy = str(item.override_policy.get("move_policy", "allowed"))
    return (
        item.planning_lock != "free"
        or move_policy in {"blocked", "override_required", "review_required"}
        or item.override_required
    )


def _risk_constraint(item: GanttOperationItem) -> ScheduleRiskConstraint:
    move_policy = str(item.override_policy.get("move_policy", "allowed"))
    severity = "critical" if move_policy == "blocked" else "warning"
    return ScheduleRiskConstraint(
        operation_id=item.operation_id,
        work_order_id=item.work_order_id,
        machine_id=item.machine_id,
        planning_lock=item.planning_lock,
        planning_zone=item.planning_zone,
        move_policy=move_policy,
        severity=severity,
        reason=item.lock_reason,
    )


def _machine_pressure(
    items: list[GanttOperationItem],
    start: datetime,
    end: datetime,
) -> list[ScheduleRiskMachinePressure]:
    window_minutes = max(1, int((end - start).total_seconds() // 60))
    rows: list[ScheduleRiskMachinePressure] = []
    for machine_id in sorted({item.machine_id for item in items}):
        machine_items = [item for item in items if item.machine_id == machine_id]
        load_minutes = sum(
            _overlap_minutes(item, start, end) for item in machine_items
        )
        utilization = round(min(load_minutes / window_minutes, 1.0), 4)
        if utilization >= 0.85:
            pressure = "high"
        elif utilization >= 0.6 or len(machine_items) >= 4:
            pressure = "medium"
        else:
            pressure = "normal"
        rows.append(
            ScheduleRiskMachinePressure(
                machine_id=machine_id,
                machine_name=machine_items[0].machine_name,
                assignment_count=len(machine_items),
                load_minutes=load_minutes,
                utilization=utilization,
                pressure=pressure,
                late_count=sum(1 for item in machine_items if item.is_late),
                critical_count=sum(1 for item in machine_items if item.is_critical),
            )
        )
    return sorted(
        rows,
        key=lambda row: (
            {"high": 0, "medium": 1, "normal": 2}.get(row.pressure, 9),
            -row.utilization,
            row.machine_id,
        ),
    )


def _overlap_minutes(
    item: GanttOperationItem,
    start: datetime,
    end: datetime,
) -> int:
    overlap_start = max(item.setup_start, start)
    overlap_end = min(item.end, end)
    if overlap_end <= overlap_start:
        return 0
    return int((overlap_end - overlap_start).total_seconds() // 60)


def _work_order_risks(items: list[GanttOperationItem]) -> list[ScheduleRiskWorkOrder]:
    risks: list[ScheduleRiskWorkOrder] = []
    for work_order_id in sorted({item.work_order_id for item in items}):
        wo_items = [item for item in items if item.work_order_id == work_order_id]
        due_dates = [item.due_date for item in wo_items if item.due_date is not None]
        due_date = min(due_dates) if due_dates else None
        last_end = max((item.end for item in wo_items), default=None)
        late_count = sum(1 for item in wo_items if item.is_late)
        critical_count = sum(1 for item in wo_items if item.is_critical)
        reasons: list[str] = []
        if late_count:
            reasons.append("late_operation")
        if critical_count:
            reasons.append("critical_path")
        if due_date is not None and last_end is not None and last_end > due_date:
            reasons.append("projected_due_date_miss")
        if not reasons:
            continue
        severity = "critical" if late_count or "projected_due_date_miss" in reasons else "warning"
        risks.append(
            ScheduleRiskWorkOrder(
                work_order_id=work_order_id,
                work_order_name=wo_items[0].work_order_name,
                due_date=due_date,
                severity=severity,
                operation_count=len(wo_items),
                late_operation_count=late_count,
                critical_operation_count=critical_count,
                last_end=last_end,
                reasons=reasons,
            )
        )
    return sorted(
        risks,
        key=lambda row: (
            0 if row.severity == "critical" else 1,
            row.due_date or datetime.max,
            row.work_order_id,
        ),
    )


def _risk_score(
    *,
    late_count: int,
    critical_count: int,
    work_order_count: int,
    constraint_count: int,
    pressure_count: int,
    changed_count: int,
) -> int:
    score = (
        late_count * 20
        + work_order_count * 15
        + critical_count * 8
        + constraint_count * 6
        + pressure_count * 10
        + changed_count * 2
    )
    return min(100, score)


def _risk_status(
    *,
    score: int,
    late_count: int,
    constraint_count: int,
    pressure_count: int,
) -> str:
    if late_count > 0 or score >= 70:
        return "blocked"
    if constraint_count > 0 or pressure_count > 0 or score >= 25:
        return "attention"
    return "healthy"


def _recommended_actions(
    *,
    late_operations: list[ScheduleRiskOperation],
    critical_operations: list[ScheduleRiskOperation],
    work_orders: list[ScheduleRiskWorkOrder],
    machine_pressure: list[ScheduleRiskMachinePressure],
    constraints: list[ScheduleRiskConstraint],
) -> list[ScheduleRiskAction]:
    actions: list[ScheduleRiskAction] = []
    if late_operations:
        actions.append(
            ScheduleRiskAction(
                action="review_late_operations",
                label="Review late operations",
                reason="At least one operation in the window finishes after its due date.",
                priority=1,
                target_ids=[item.operation_id for item in late_operations[:8]],
            )
        )
    if work_orders:
        actions.append(
            ScheduleRiskAction(
                action="protect_at_risk_work_orders",
                label="Protect at-risk work orders",
                reason="Work orders in this window are late or on the critical path.",
                priority=2,
                target_ids=[item.work_order_id for item in work_orders[:8]],
            )
        )
    high_pressure = [item for item in machine_pressure if item.pressure == "high"]
    if high_pressure:
        actions.append(
            ScheduleRiskAction(
                action="relieve_machine_pressure",
                label="Relieve machine pressure",
                reason="One or more machines carry high load in the selected window.",
                priority=3,
                target_ids=[item.machine_id for item in high_pressure[:8]],
            )
        )
    if constraints:
        actions.append(
            ScheduleRiskAction(
                action="review_firm_frozen_constraints",
                label="Review firm/frozen constraints",
                reason="Locked or review-required operations limit repair choices.",
                priority=4,
                target_ids=[item.operation_id for item in constraints[:8]],
            )
        )
    if critical_operations and not late_operations:
        actions.append(
            ScheduleRiskAction(
                action="monitor_critical_path",
                label="Monitor critical path",
                reason="Critical operations are present even though the window is not late.",
                priority=5,
                target_ids=[item.operation_id for item in critical_operations[:8]],
            )
        )
    if not actions:
        actions.append(
            ScheduleRiskAction(
                action="continue_monitoring",
                label="Continue monitoring",
                reason="No major schedule risk was detected in this window.",
                priority=9,
                target_ids=[],
            )
        )
    return actions
