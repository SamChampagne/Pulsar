"""Edge case probe 01: empty inputs.

Three scenarios:
  A. Schedule with zero work orders.
  B. Schedule with WOs but zero operations.
  C. Schedule with WOs+operations but zero machines.

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


def scenario_a_no_work_orders() -> None:
    uc = make_use_case(calendars=[make_calendar()], machines=[
        Machine(id="M1", name="Machine 1", calendar_id="CAL"),
    ])
    run_and_report("Scenario A: zero work orders", uc)


def scenario_b_no_operations() -> None:
    cal = make_calendar()
    wo = WorkOrder(
        id="WO-1",
        name="Empty WO",
        product_id="P-1",
        quantity=1,
        due_date=HORIZON_START + timedelta(days=7),
        release_date=HORIZON_START,
        operations=[],
        priority=Priority.NORMAL,
    )
    uc = make_use_case(
        work_orders=[wo],
        machines=[Machine(id="M1", name="M1", calendar_id="CAL")],
        calendars=[cal],
    )
    run_and_report("Scenario B: WO with zero operations", uc)


def scenario_c_no_machines() -> None:
    cal = make_calendar()
    op = Operation(
        id="OP-1",
        work_order_id="WO-1",
        sequence=1,
        name="OP-1",
        duration=Duration(minutes=60),
        setup_time=Duration(minutes=10),
        eligible_machine_ids=["M1"],
        dependencies=[],
    )
    wo = WorkOrder(
        id="WO-1",
        name="WO-1",
        product_id="P-1",
        quantity=1,
        due_date=HORIZON_START + timedelta(days=7),
        release_date=HORIZON_START,
        operations=[op],
        priority=Priority.NORMAL,
    )
    uc = make_use_case(work_orders=[wo], machines=[], calendars=[cal])
    run_and_report("Scenario C: ops reference machine but no machines exist", uc)


if __name__ == "__main__":
    scenario_a_no_work_orders()
    scenario_b_no_operations()
    scenario_c_no_machines()
