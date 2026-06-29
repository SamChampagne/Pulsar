"""Edge case probe 02: contradictory constraints.

Three scenarios:
  A. Operation requires eligible_machine_ids=["NONEXISTENT_MACHINE"] but repo has M1 only.
  B. Operation requires eligible_machine_ids=[] (eligible to nothing).
  C. Operation in WO-1 lists a dependency on an operation in a different WO.

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


def scenario_a_nonexistent_machine() -> None:
    """Op references a machine id that doesn't exist in the repo."""
    cal = make_calendar()
    op = Operation(
        id="OP-1",
        work_order_id="WO-1",
        sequence=1,
        name="OP-1",
        duration=Duration(minutes=60),
        eligible_machine_ids=["NONEXISTENT_MACHINE"],
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
    uc = make_use_case(
        work_orders=[wo],
        machines=[Machine(id="M1", name="M1", calendar_id="CAL")],
        calendars=[cal],
    )
    run_and_report("Scenario A: op eligible_machine_ids=[NONEXISTENT_MACHINE]", uc)


def scenario_b_empty_eligible_machines() -> None:
    """Op has eligible_machine_ids=[] — eligible to nothing.
    Domain __post_init__ may reject this at construction time.
    """
    print("=== Scenario B: op eligible_machine_ids=[] ===")
    try:
        op = Operation(
            id="OP-1",
            work_order_id="WO-1",
            sequence=1,
            name="OP-1",
            duration=Duration(minutes=60),
            eligible_machine_ids=[],
        )
        # If construction succeeds, attempt to schedule it
        cal = make_calendar()
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
        uc = make_use_case(
            work_orders=[wo],
            machines=[Machine(id="M1", name="M1", calendar_id="CAL")],
            calendars=[cal],
        )
        run_and_report("Scenario B (inner): schedule with empty eligible_machine_ids op", uc)
    except Exception as exc:
        print(f"  EXCEPTION at construction: {type(exc).__name__}: {exc}")


def scenario_c_cross_wo_dependency() -> None:
    """Op in WO-1 lists a dependency on an op from a different WO (WO-2)."""
    cal = make_calendar()
    op1 = Operation(
        id="OP-1",
        work_order_id="WO-1",
        sequence=1,
        name="OP-1",
        duration=Duration(minutes=60),
        eligible_machine_ids=["M1"],
        dependencies=["OP-FROM-WO-2"],  # cross-WO dependency — WO-2's op id
    )
    wo1 = WorkOrder(
        id="WO-1",
        name="WO-1",
        product_id="P-1",
        quantity=1,
        due_date=HORIZON_START + timedelta(days=7),
        release_date=HORIZON_START,
        operations=[op1],
        priority=Priority.NORMAL,
    )
    op2 = Operation(
        id="OP-FROM-WO-2",
        work_order_id="WO-2",
        sequence=1,
        name="OP-FROM-WO-2",
        duration=Duration(minutes=30),
        eligible_machine_ids=["M1"],
    )
    wo2 = WorkOrder(
        id="WO-2",
        name="WO-2",
        product_id="P-2",
        quantity=1,
        due_date=HORIZON_START + timedelta(days=7),
        release_date=HORIZON_START,
        operations=[op2],
        priority=Priority.NORMAL,
    )
    uc = make_use_case(
        work_orders=[wo1, wo2],
        machines=[Machine(id="M1", name="M1", calendar_id="CAL")],
        calendars=[cal],
    )
    run_and_report("Scenario C: OP-1 depends on op from different WO (WO-2)", uc)


if __name__ == "__main__":
    scenario_a_nonexistent_machine()
    scenario_b_empty_eligible_machines()
    scenario_c_cross_wo_dependency()
