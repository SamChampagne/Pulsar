"""Edge case probe 04: missing materials.

Two scenarios:
  A. Operation requires material MAT-1 (qty 5), no inventory and no supply lots.
     Expected: engine should detect infeasibility or raise structured error.
  B. Operation requires material MAT-1 (qty 5), supply lot delivers 5 units
     30 days AFTER the WO release_date (well past due_date).
     Expected: engine should detect late material or return diagnostics.

Verified against planiadvance_v2/domain/entities/material.py and
planiadvance_v2/infrastructure/in_memory/repositories.py on 2026-05-06.
"""
from datetime import datetime, time, timedelta

from planiadvance_v2.application.use_cases.run_scheduling import (
    RunScheduling,
    RunSchedulingInput,
)
from planiadvance_v2.domain.entities import (
    InventoryItem,
    Machine,
    MaterialRequirement,
    Operation,
    SupplyLot,
    WorkingCalendar,
    WorkOrder,
)
from planiadvance_v2.domain.value_objects import Duration, Priority, Shift
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryCalendarRepository,
    InMemoryInventoryRepository,
    InMemoryMachineRepository,
    InMemoryResourceRepository,
    InMemoryScheduleRepository,
    InMemorySupplyRepository,
    InMemoryWorkOrderRepository,
)

HORIZON_START = datetime(2026, 1, 5, 0, 0, 0)


def make_calendar() -> WorkingCalendar:
    return WorkingCalendar(
        id="CAL",
        name="Mon-Fri 08-17",
        shifts=[Shift(weekday=w, start=time(8, 0), end=time(17, 0)) for w in range(5)],
    )


def make_use_case(
    *,
    work_orders: list[WorkOrder] | None = None,
    machines: list[Machine] | None = None,
    calendars: list[WorkingCalendar] | None = None,
    inventory_items: list[InventoryItem] | None = None,
    supply_lots: list[SupplyLot] | None = None,
) -> RunScheduling:
    wo_repo = InMemoryWorkOrderRepository()
    for wo in work_orders or []:
        wo_repo.add(wo)
    machine_repo = InMemoryMachineRepository()
    for m in machines or []:
        machine_repo.add(m)
    cal_repo = InMemoryCalendarRepository()
    for c in calendars or []:
        cal_repo.add(c)
    inv_repo = InMemoryInventoryRepository()
    for item in inventory_items or []:
        inv_repo.add(item)
    supply_repo = InMemorySupplyRepository()
    for lot in supply_lots or []:
        supply_repo.add(lot)
    return RunScheduling(
        work_orders=wo_repo,
        machines=machine_repo,
        calendars=cal_repo,
        resources=InMemoryResourceRepository(),
        inventory=inv_repo,
        supplies=supply_repo,
        schedules=InMemoryScheduleRepository(),
    )


def run_and_report(label: str, uc: RunScheduling) -> None:
    print(f"=== {label} ===")
    try:
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                horizon_days=14,
                strategy="greedy",
                persist=False,
            )
        )
        print(
            f"  RESULT: assignments={len(result.schedule.assignments)}, "
            f"solver_status={result.solver_status}, "
            f"objective_value={result.objective_value}, "
            f"diagnostics={result.diagnostics}"
        )
    except Exception as exc:
        print(f"  EXCEPTION: {type(exc).__name__}: {exc}")


def make_material_op() -> Operation:
    op = Operation(
        id="OP-MAT",
        work_order_id="WO-MAT",
        sequence=1,
        name="OP-MAT",
        duration=Duration(minutes=60),
        setup_time=Duration(minutes=0),
        eligible_machine_ids=["M1"],
        dependencies=[],
    )
    op.material_requirements = [
        MaterialRequirement(material_id="MAT-1", fixed_quantity=5.0)
    ]
    return op


def make_work_order_with_material() -> WorkOrder:
    op = make_material_op()
    return WorkOrder(
        id="WO-MAT",
        name="WO requiring MAT-1",
        product_id="P-1",
        quantity=1,
        due_date=HORIZON_START + timedelta(days=7),
        release_date=HORIZON_START,
        operations=[op],
        priority=Priority.NORMAL,
    )


def scenario_a_no_inventory_no_supply() -> None:
    """Operation needs 5 units of MAT-1 but inventory=0 and no supply lots."""
    cal = make_calendar()
    wo = make_work_order_with_material()
    uc = make_use_case(
        work_orders=[wo],
        machines=[Machine(id="M1", name="Machine 1", calendar_id="CAL")],
        calendars=[cal],
        inventory_items=[],   # no inventory
        supply_lots=[],        # no supply
    )
    run_and_report("Scenario A: no inventory, no supply lots", uc)


def scenario_b_supply_arrives_after_due() -> None:
    """Operation needs 5 units of MAT-1; supply lot of 5 arrives 30 days after release,
    which is well past the WO due date of +7 days."""
    cal = make_calendar()
    wo = make_work_order_with_material()
    late_supply = SupplyLot(
        id="SUP-LATE",
        material_id="MAT-1",
        quantity=5.0,
        available_at=HORIZON_START + timedelta(days=30),  # 30 days after release, due is +7
    )
    uc = make_use_case(
        work_orders=[wo],
        machines=[Machine(id="M1", name="Machine 1", calendar_id="CAL")],
        calendars=[cal],
        inventory_items=[],          # no on-hand stock
        supply_lots=[late_supply],   # supply arrives after due date
    )
    run_and_report("Scenario B: supply arrives 30 days after release (past due)", uc)


if __name__ == "__main__":
    scenario_a_no_inventory_no_supply()
    scenario_b_supply_arrives_after_due()
