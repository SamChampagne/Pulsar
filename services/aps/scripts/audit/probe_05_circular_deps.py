"""Edge case probe 05: circular dependencies.

Two scenarios:
  A. Op-A.dependencies=[Op-B], Op-B.dependencies=[Op-A] — direct 2-cycle within same WO.
  B. Op-A -> Op-B -> Op-C -> Op-A — 3-cycle within same WO.

Verified against planiadvance_v2/infrastructure/in_memory/repositories.py and
planiadvance_v2/application/use_cases/run_scheduling.py on 2026-05-06.
"""
from datetime import datetime, time, timedelta

from planiadvance_v2.application.use_cases.run_scheduling import (
    RunScheduling,
    RunSchedulingInput,
)
from planiadvance_v2.domain.entities import (
    Machine,
    Operation,
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
    return RunScheduling(
        work_orders=wo_repo,
        machines=machine_repo,
        calendars=cal_repo,
        resources=InMemoryResourceRepository(),
        inventory=InMemoryInventoryRepository(),
        supplies=InMemorySupplyRepository(),
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
            f"objective_value={result.objective_value}"
        )
    except Exception as exc:
        print(f"  EXCEPTION: {type(exc).__name__}: {exc}")


def scenario_a_two_cycle() -> None:
    """Op-A depends on Op-B and Op-B depends on Op-A (direct 2-cycle)."""
    cal = make_calendar()
    # Use sequence to differentiate; dependency lists create the cycle
    op_a = Operation(
        id="OP-A",
        work_order_id="WO-1",
        sequence=1,
        name="OP-A",
        duration=Duration(minutes=60),
        eligible_machine_ids=["M1"],
        dependencies=["OP-B"],
    )
    op_b = Operation(
        id="OP-B",
        work_order_id="WO-1",
        sequence=2,
        name="OP-B",
        duration=Duration(minutes=60),
        eligible_machine_ids=["M1"],
        dependencies=["OP-A"],
    )
    wo = WorkOrder(
        id="WO-1",
        name="WO-1",
        product_id="P-1",
        quantity=1,
        due_date=HORIZON_START + timedelta(days=7),
        release_date=HORIZON_START,
        operations=[op_a, op_b],
        priority=Priority.NORMAL,
    )
    uc = make_use_case(
        work_orders=[wo],
        machines=[Machine(id="M1", name="M1", calendar_id="CAL")],
        calendars=[cal],
    )
    run_and_report("Scenario A: 2-cycle (OP-A->OP-B->OP-A)", uc)


def scenario_b_three_cycle() -> None:
    """Op-A -> Op-B -> Op-C -> Op-A (3-cycle within same WO)."""
    cal = make_calendar()
    op_a = Operation(
        id="OP-A",
        work_order_id="WO-1",
        sequence=1,
        name="OP-A",
        duration=Duration(minutes=60),
        eligible_machine_ids=["M1"],
        dependencies=["OP-C"],
    )
    op_b = Operation(
        id="OP-B",
        work_order_id="WO-1",
        sequence=2,
        name="OP-B",
        duration=Duration(minutes=60),
        eligible_machine_ids=["M1"],
        dependencies=["OP-A"],
    )
    op_c = Operation(
        id="OP-C",
        work_order_id="WO-1",
        sequence=3,
        name="OP-C",
        duration=Duration(minutes=60),
        eligible_machine_ids=["M1"],
        dependencies=["OP-B"],
    )
    wo = WorkOrder(
        id="WO-1",
        name="WO-1",
        product_id="P-1",
        quantity=1,
        due_date=HORIZON_START + timedelta(days=7),
        release_date=HORIZON_START,
        operations=[op_a, op_b, op_c],
        priority=Priority.NORMAL,
    )
    uc = make_use_case(
        work_orders=[wo],
        machines=[Machine(id="M1", name="M1", calendar_id="CAL")],
        calendars=[cal],
    )
    run_and_report("Scenario B: 3-cycle (OP-A->OP-B->OP-C->OP-A)", uc)


if __name__ == "__main__":
    scenario_a_two_cycle()
    scenario_b_three_cycle()
