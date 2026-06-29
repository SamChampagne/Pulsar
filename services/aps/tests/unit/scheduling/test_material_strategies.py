from __future__ import annotations

from datetime import timedelta

import pytest

from planiadvance_v2.application.use_cases.material_pegging_report import (
    build_material_pegging_report,
)
from planiadvance_v2.domain.entities import InventoryItem, Machine, SupplyLot
from planiadvance_v2.domain.entities.material import MaterialRequirement
from planiadvance_v2.domain.errors import InfeasibleScheduleError
from planiadvance_v2.domain.scheduling import Objective, SchedulingContext, resolve_strategy
from tests.conftest import make_work_order


@pytest.mark.parametrize("strategy_name", ["greedy", "backward"])
def test_material_shortage_blocks_strategy(
    strategy_name,
    horizon_start,
    horizon_end,
    standard_calendar,
):
    wo = make_work_order(
        "WO-MAT",
        release=horizon_start + timedelta(hours=8),
        due=horizon_start + timedelta(days=2),
        ops=[("OP-MAT", 60, ["M1"], 0)],
    )
    wo.operations[0].material_requirements = [
        MaterialRequirement(material_id="MAT-A", quantity_per_unit=2.0)
    ]
    ctx = SchedulingContext(
        horizon_start=horizon_start,
        horizon_end=horizon_end,
        work_orders=[wo],
        machines=[Machine(id="M1", name="Machine 1", calendar_id=standard_calendar.id)],
        calendars=[standard_calendar],
        inventory_items=[InventoryItem(material_id="MAT-A", quantity_on_hand=1.0)],
    )

    with pytest.raises(InfeasibleScheduleError) as excinfo:
        resolve_strategy(strategy_name).solve(ctx, Objective.default())

    report = excinfo.value.report
    assert report is not None
    assert report.dominant_blocker_kind == "material_shortage"
    assert any("material supply" in suggestion.lower() for suggestion in report.suggestions)


def test_backward_material_reservations_are_time_ordered(
    horizon_start,
    horizon_end,
    standard_calendar,
):
    machines = [Machine(id="M1", name="Machine 1", calendar_id=standard_calendar.id)]
    early = make_work_order(
        "WO-EARLY",
        release=horizon_start + timedelta(hours=8),
        due=horizon_start + timedelta(hours=12),
        ops=[("OP-EARLY", 60, ["M1"], 0)],
    )
    late = make_work_order(
        "WO-LATE",
        release=horizon_start + timedelta(hours=8),
        due=horizon_start + timedelta(days=1, hours=17),
        ops=[("OP-LATE", 60, ["M1"], 0)],
    )
    early.operations[0].material_requirements = [
        MaterialRequirement(material_id="MAT-A", fixed_quantity=1.0)
    ]
    late.operations[0].material_requirements = [
        MaterialRequirement(material_id="MAT-A", fixed_quantity=1.0)
    ]

    supply_time = horizon_start + timedelta(days=1, hours=12)
    ctx = SchedulingContext(
        horizon_start=horizon_start,
        horizon_end=horizon_end,
        work_orders=[early, late],
        machines=machines,
        calendars=[standard_calendar],
        inventory_items=[InventoryItem(material_id="MAT-A", quantity_on_hand=1.0)],
        supplies=[
            SupplyLot(
                id="SUP-1",
                material_id="MAT-A",
                quantity=1.0,
                available_at=supply_time,
            )
        ],
    )

    result = resolve_strategy("backward").solve(ctx, Objective.default())
    assignments = {assignment.operation_id: assignment for assignment in result.schedule.assignments}
    reservations = result.diagnostics.get("material_reservations")

    assert assignments["OP-EARLY"].start < supply_time
    assert assignments["OP-LATE"].start >= supply_time
    assert isinstance(reservations, list)
    assert len(reservations) == 2
    assert {reservation["operation_id"] for reservation in reservations} == {
        "OP-EARLY",
        "OP-LATE",
    }


def test_greedy_exposes_material_reservations_in_diagnostics(
    horizon_start,
    horizon_end,
    standard_calendar,
):
    wo = make_work_order(
        "WO-MAT",
        release=horizon_start + timedelta(hours=8),
        due=horizon_start + timedelta(days=2),
        ops=[("OP-MAT", 60, ["M1"], 0)],
    )
    wo.operations[0].material_requirements = [
        MaterialRequirement(material_id="MAT-A", fixed_quantity=2.0)
    ]
    ctx = SchedulingContext(
        horizon_start=horizon_start,
        horizon_end=horizon_end,
        work_orders=[wo],
        machines=[Machine(id="M1", name="Machine 1", calendar_id=standard_calendar.id)],
        calendars=[standard_calendar],
        inventory_items=[InventoryItem(material_id="MAT-A", quantity_on_hand=5.0)],
    )

    result = resolve_strategy("greedy").solve(ctx, Objective.default())

    reservations = result.diagnostics.get("material_reservations")
    decision_trace = result.diagnostics.get("decision_trace")
    assert isinstance(reservations, list)
    assert len(reservations) == 1
    assert reservations[0]["material_id"] == "MAT-A"
    assert reservations[0]["allocations"][0]["source_id"] == "inventory:MAT-A"
    assert isinstance(decision_trace, list)
    assert decision_trace[0]["material_ready_at"] is not None


def test_material_pegging_trace_spans_inventory_and_supply(
    horizon_start,
    horizon_end,
    standard_calendar,
):
    wo = make_work_order(
        "WO-MAT-MIX",
        release=horizon_start + timedelta(hours=8),
        due=horizon_start + timedelta(days=2),
        ops=[("OP-MAT-MIX", 60, ["M1"], 0)],
    )
    wo.operations[0].material_requirements = [
        MaterialRequirement(material_id="MAT-A", fixed_quantity=7.0)
    ]
    ctx = SchedulingContext(
        horizon_start=horizon_start,
        horizon_end=horizon_end,
        work_orders=[wo],
        machines=[Machine(id="M1", name="Machine 1", calendar_id=standard_calendar.id)],
        calendars=[standard_calendar],
        inventory_items=[InventoryItem(material_id="MAT-A", quantity_on_hand=2.0)],
        supplies=[
            SupplyLot(
                id="SUP-1",
                material_id="MAT-A",
                quantity=5.0,
                available_at=horizon_start + timedelta(hours=6),
            )
        ],
    )

    result = resolve_strategy("greedy").solve(ctx, Objective.default())

    reservations = result.diagnostics.get("material_reservations")
    assert isinstance(reservations, list)
    assert len(reservations) == 1
    allocation_sources = {allocation["source_id"] for allocation in reservations[0]["allocations"]}
    assert allocation_sources == {"inventory:MAT-A", "SUP-1"}
    assert reservations[0]["uncovered_quantity"] == 0.0


def test_material_pegging_report_summarizes_coverage_and_shortage():
    report = build_material_pegging_report(
        [
            {
                "operation_id": "OP-1",
                "material_id": "MAT-A",
                "quantity": 5.0,
                "required_at": "2026-01-05T08:00:00",
                "source": "scheduled",
                "allocations": [
                    {
                        "source_id": "inventory:MAT-A",
                        "source_type": "inventory",
                        "quantity": 2.0,
                        "available_at": "2026-01-05T00:00:00",
                    },
                    {
                        "source_id": "SUP-A",
                        "source_type": "purchase",
                        "quantity": 3.0,
                        "available_at": "2026-01-05T06:00:00",
                    },
                ],
                "uncovered_quantity": 0.0,
            },
            {
                "operation_id": "OP-2",
                "material_id": "MAT-B",
                "quantity": 4.0,
                "required_at": "2026-01-05T10:00:00",
                "source": "scheduled",
                "allocations": [
                    {
                        "source_id": "inventory:MAT-B",
                        "source_type": "inventory",
                        "quantity": 1.0,
                        "available_at": "2026-01-05T00:00:00",
                    },
                ],
                "uncovered_quantity": 3.0,
            },
        ]
    )

    assert report["available"] is True
    assert report["status"] == "short"
    assert report["reservation_count"] == 2
    assert report["material_count"] == 2
    assert report["fully_covered_reservation_count"] == 1
    assert report["uncovered_reservation_count"] == 1
    coverage = {
        item["material_id"]: item for item in report["material_coverage"]
    }
    assert coverage["MAT-A"]["status"] == "covered"
    assert coverage["MAT-A"]["coverage_ratio"] == 1.0
    assert coverage["MAT-B"]["status"] == "short"
    assert coverage["MAT-B"]["uncovered_quantity"] == 3.0
    assert report["blocked_operations"][0]["operation_id"] == "OP-2"
    assert {source["source_id"] for source in report["source_usage"]} == {
        "inventory:MAT-A",
        "SUP-A",
        "inventory:MAT-B",
    }
