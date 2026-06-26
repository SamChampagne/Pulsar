"""TDD tests for ``classify_late_order_reason``.

The classifier reads engine diagnostics already attached to a published
schedule's metadata. We synthesise minimal schedules + diagnostics that
cover one signal each, then test signal precedence (material > capacity
> priority > sequence).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from planiadvance_v2.application.ports.schedule_repository import ScheduleRunMetadata
from planiadvance_v2.application.use_cases.reports.late_order_classifier import (
    classify_late_order_reason,
)
from planiadvance_v2.domain.entities import (
    Operation,
    Schedule,
    ScheduledOperation,
    WorkOrder,
)
from planiadvance_v2.domain.value_objects import Duration, Priority


def _op(op_id: str, wo_id: str, eligible: tuple[str, ...] = ("M-A",)) -> Operation:
    return Operation(
        id=op_id,
        work_order_id=wo_id,
        sequence=1,
        name=op_id,
        duration=Duration(minutes=60),
        setup_time=Duration(minutes=0),
        eligible_machine_ids=list(eligible),
        dependencies=[],
    )


def _wo(
    wo_id: str,
    *,
    priority: Priority = Priority.NORMAL,
    op_ids: tuple[str, ...] = ("OP1",),
) -> WorkOrder:
    return WorkOrder(
        id=wo_id,
        name=f"WO {wo_id}",
        product_id=f"PROD-{wo_id}",
        quantity=1,
        due_date=datetime(2026, 5, 12),
        release_date=datetime(2026, 5, 1),
        operations=[_op(f"{wo_id}-{op}", wo_id) for op in op_ids],
        priority=priority,
    )


def _scheduled_op(op_id: str, wo_id: str, machine_id: str = "M-A") -> ScheduledOperation:
    return ScheduledOperation(
        operation_id=op_id,
        work_order_id=wo_id,
        machine_id=machine_id,
        setup_start=datetime(2026, 5, 11, 7, 50),
        start=datetime(2026, 5, 11, 8, 0),
        end=datetime(2026, 5, 11, 9, 0),
    )


def _schedule(*assignments: ScheduledOperation) -> Schedule:
    return Schedule(
        id="sched-1",
        created_at=datetime(2026, 5, 10, 22, 0),
        assignments=list(assignments),
    )


def _metadata(diagnostics: dict[str, Any]) -> ScheduleRunMetadata:
    return ScheduleRunMetadata(
        metrics={},
        strategy="greedy",
        solver_status="feasible",
        objective_value=0,
        wall_time_ms=0,
        diagnostics=diagnostics,
        workspace_id="ws-a",
        scenario_name="Default",
        lifecycle_status="published",
        organization_id="org-a",
        horizon_start=datetime(2026, 5, 11),
        horizon_end=datetime(2026, 5, 18),
    )


def test_material_via_planner_exceptions():
    wo = _wo("WO-1")
    schedule = _schedule(_scheduled_op("WO-1-OP1", "WO-1"))
    diagnostics = {
        "planner_exceptions": {
            "exceptions": [
                {"work_order_id": "WO-1", "kind": "material_shortage"},
            ],
        },
    }

    reason = classify_late_order_reason(
        wo=wo,
        schedule=schedule,
        metadata=_metadata(diagnostics),
        all_work_orders=[wo],
    )

    assert reason == "material"


def test_material_via_pegging_blocked_operations():
    wo = _wo("WO-1")
    schedule = _schedule(_scheduled_op("WO-1-OP1", "WO-1"))
    diagnostics = {
        "material_pegging_report": {
            "status": "short",
            "blocked_operations": [
                {"operation_id": "WO-1-OP1", "material_id": "MAT-X"},
            ],
        },
    }

    reason = classify_late_order_reason(
        wo=wo,
        schedule=schedule,
        metadata=_metadata(diagnostics),
        all_work_orders=[wo],
    )

    assert reason == "material"


def test_capacity_via_horizon_too_short():
    wo = _wo("WO-1")
    schedule = _schedule(_scheduled_op("WO-1-OP1", "WO-1"))
    diagnostics = {
        "planner_exceptions": {
            "exceptions": [
                {"work_order_id": "WO-1", "kind": "horizon_too_short"},
            ],
        },
    }

    reason = classify_late_order_reason(
        wo=wo,
        schedule=schedule,
        metadata=_metadata(diagnostics),
        all_work_orders=[wo],
    )

    assert reason == "capacity"


def test_capacity_via_machine_overload():
    wo = _wo("WO-1")
    schedule = _schedule(_scheduled_op("WO-1-OP1", "WO-1"))
    diagnostics = {
        "planner_exceptions": {
            "exceptions": [
                {"work_order_id": "WO-1", "kind": "machine_overload"},
            ],
        },
    }

    reason = classify_late_order_reason(
        wo=wo,
        schedule=schedule,
        metadata=_metadata(diagnostics),
        all_work_orders=[wo],
    )

    assert reason == "capacity"


def test_priority_when_higher_priority_neighbour_shares_machine():
    late = _wo("WO-LATE", priority=Priority.NORMAL)
    other = _wo("WO-VIP", priority=Priority.URGENT)
    schedule = _schedule(
        _scheduled_op("WO-LATE-OP1", "WO-LATE", machine_id="M-A"),
        _scheduled_op("WO-VIP-OP1", "WO-VIP", machine_id="M-A"),
    )
    diagnostics: dict[str, Any] = {}

    reason = classify_late_order_reason(
        wo=late,
        schedule=schedule,
        metadata=_metadata(diagnostics),
        all_work_orders=[late, other],
    )

    assert reason == "priority"


def test_sequence_default_when_no_signal():
    wo = _wo("WO-1")
    schedule = _schedule(_scheduled_op("WO-1-OP1", "WO-1"))
    diagnostics: dict[str, Any] = {}

    reason = classify_late_order_reason(
        wo=wo,
        schedule=schedule,
        metadata=_metadata(diagnostics),
        all_work_orders=[wo],
    )

    assert reason == "sequence"


def test_signal_precedence_material_beats_capacity():
    wo = _wo("WO-1")
    schedule = _schedule(_scheduled_op("WO-1-OP1", "WO-1"))
    diagnostics = {
        "planner_exceptions": {
            "exceptions": [
                {"work_order_id": "WO-1", "kind": "material_shortage"},
                {"work_order_id": "WO-1", "kind": "horizon_too_short"},
            ],
        },
    }

    reason = classify_late_order_reason(
        wo=wo,
        schedule=schedule,
        metadata=_metadata(diagnostics),
        all_work_orders=[wo],
    )

    assert reason == "material"


def test_unrelated_work_order_id_in_diagnostics_is_ignored():
    wo = _wo("WO-1")
    schedule = _schedule(_scheduled_op("WO-1-OP1", "WO-1"))
    diagnostics = {
        "planner_exceptions": {
            "exceptions": [
                {"work_order_id": "WO-OTHER", "kind": "material_shortage"},
            ],
        },
    }

    reason = classify_late_order_reason(
        wo=wo,
        schedule=schedule,
        metadata=_metadata(diagnostics),
        all_work_orders=[wo],
    )

    assert reason == "sequence"
