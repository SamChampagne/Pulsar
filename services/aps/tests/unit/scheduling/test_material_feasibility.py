from __future__ import annotations

from datetime import datetime, time, timedelta

from planiadvance_v2.domain.entities import (
    InventoryItem,
    Machine,
    MaterialRequirement,
    SupplyLot,
    WorkingCalendar,
)
from planiadvance_v2.domain.scheduling import SchedulingContext
from planiadvance_v2.domain.scheduling.feasibility import IssueKind, check_feasibility
from planiadvance_v2.domain.value_objects import Shift
from tests.conftest import make_work_order


def _calendar() -> WorkingCalendar:
    return WorkingCalendar(
        id="CAL",
        name="Mon-Fri",
        shifts=[Shift(weekday=w, start=time(8, 0), end=time(17, 0)) for w in range(5)],
    )


def test_detects_material_shortage_before_solve() -> None:
    horizon_start = datetime(2026, 1, 5, 0, 0, 0)
    wo = make_work_order(
        "WO-MAT",
        release=horizon_start + timedelta(hours=8),
        due=horizon_start + timedelta(days=2),
        ops=[("OP-MAT", 60, ["M1"], 0)],
    )
    wo.operations[0].material_requirements = [
        MaterialRequirement(material_id="MAT-A", quantity_per_unit=6.0)
    ]

    context = SchedulingContext(
        horizon_start=horizon_start,
        horizon_end=horizon_start + timedelta(days=5),
        work_orders=[wo],
        machines=[Machine(id="M1", name="M1", calendar_id="CAL")],
        calendars=[_calendar()],
        inventory_items=[InventoryItem(material_id="MAT-A", quantity_on_hand=5.0)],
    )

    report = check_feasibility(context)

    issues = [issue for issue in report.issues if issue.kind == IssueKind.MATERIAL_SHORTAGE]
    assert len(issues) == 1
    assert issues[0].material_id == "MAT-A"
    assert issues[0].operation_id == "OP-MAT"
    assert report.readiness_status == "blocked"
    assert report.next_best_action is not None


def test_inbound_supply_can_clear_shortage() -> None:
    horizon_start = datetime(2026, 1, 5, 0, 0, 0)
    wo = make_work_order(
        "WO-MAT",
        release=horizon_start + timedelta(days=1, hours=8),
        due=horizon_start + timedelta(days=3),
        ops=[("OP-MAT", 60, ["M1"], 0)],
    )
    wo.operations[0].material_requirements = [
        MaterialRequirement(material_id="MAT-A", quantity_per_unit=2.0)
    ]

    context = SchedulingContext(
        horizon_start=horizon_start,
        horizon_end=horizon_start + timedelta(days=5),
        work_orders=[wo],
        machines=[Machine(id="M1", name="M1", calendar_id="CAL")],
        calendars=[_calendar()],
        inventory_items=[InventoryItem(material_id="MAT-A", quantity_on_hand=5.0)],
        supplies=[
            SupplyLot(
                id="SUP-1",
                material_id="MAT-A",
                quantity=10.0,
                available_at=horizon_start + timedelta(days=1),
            )
        ],
    )

    report = check_feasibility(context)

    assert not [issue for issue in report.issues if issue.kind == IssueKind.MATERIAL_SHORTAGE]
