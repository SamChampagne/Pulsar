from __future__ import annotations

from datetime import datetime, time, timedelta

from planiadvance_v2.application.integration import CONTRACT_VERSION, snapshot_to_context
from planiadvance_v2.application.integration.canonical_snapshot import (
    CanonicalCalendar,
    CanonicalInventoryItem,
    CanonicalMachine,
    CanonicalMaterialRequirement,
    CanonicalOperation,
    CanonicalPlanningSnapshot,
    CanonicalShift,
    CanonicalSupplyLot,
    CanonicalTransferTimes,
    CanonicalWorkOrder,
)


def test_snapshot_round_trip_keeps_material_inputs() -> None:
    horizon_start = datetime(2026, 1, 5, 0, 0, 0)
    snapshot = CanonicalPlanningSnapshot(
        contract_version=CONTRACT_VERSION,
        exported_at=horizon_start,
        source_system="erp-material",
        calendars=(
            CanonicalCalendar(
                id="CAL",
                name="Mon-Fri",
                shifts=tuple(
                    CanonicalShift(weekday=weekday, start=time(8, 0), end=time(17, 0))
                    for weekday in range(5)
                ),
            ),
        ),
        machines=(
            CanonicalMachine(
                id="M1",
                name="Machine 1",
                calendar_id="CAL",
            ),
        ),
        resources=(),
        work_orders=(
            CanonicalWorkOrder(
                id="WO-1",
                name="WO-1",
                product_id="P-1",
                quantity=4,
                due_date=horizon_start + timedelta(days=2),
                release_date=horizon_start + timedelta(hours=8),
                operations=(
                    CanonicalOperation(
                        id="OP-1",
                        work_order_id="WO-1",
                        sequence=1,
                        name="Cut",
                        duration_minutes=60,
                        eligible_machine_ids=("M1",),
                        material_requirements=(
                            CanonicalMaterialRequirement(
                                material_id="MAT-A",
                                quantity_per_unit=1.5,
                            ),
                        ),
                    ),
                ),
            ),
        ),
        inventory_items=(
            CanonicalInventoryItem(material_id="MAT-A", quantity_on_hand=2.0),
        ),
        supplies=(
            CanonicalSupplyLot(
                id="SUP-1",
                material_id="MAT-A",
                quantity=10.0,
                available_at=horizon_start + timedelta(hours=6),
            ),
        ),
        transfer_times=CanonicalTransferTimes(),
    )

    context = snapshot_to_context(
        snapshot,
        horizon_start=horizon_start,
        horizon_end=horizon_start + timedelta(days=5),
    )

    assert context.inventory_items[0].material_id == "MAT-A"
    assert context.supplies[0].id == "SUP-1"
    assert context.work_orders[0].operations[0].material_requirements[0].material_id == "MAT-A"
