"""Edge case probe 08: strategy gaps.

Three scenarios:
  A. Run with strategy="cpsat". Outcome depends on whether OR-Tools is installed.
  B. Run with strategy="nonexistent_strategy_name". Expected: clean error.
  C. Run with strategy="infinite". Document the outcome (rough-cut strategy).

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


def run_and_report(label: str, uc: RunScheduling, strategy: str) -> None:
    print(f"=== {label} ===")
    try:
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                horizon_days=14,
                strategy=strategy,
                persist=False,
            )
        )
        print(
            f"  RESULT: assignments={len(result.schedule.assignments)}, "
            f"solver_status={result.solver_status}, "
            f"objective_value={result.objective_value}, "
            f"wall_time_ms={result.wall_time_ms}"
        )
    except Exception as exc:
        print(f"  EXCEPTION: {type(exc).__name__}: {exc}")


def make_minimal_uc() -> RunScheduling:
    """Create a minimal use case with one machine and one WO+op."""
    cal = make_calendar()
    op = Operation(
        id="OP-1",
        work_order_id="WO-1",
        sequence=1,
        name="OP-1",
        duration=Duration(minutes=60),
        eligible_machine_ids=["M1"],
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
    return make_use_case(
        work_orders=[wo],
        machines=[Machine(id="M1", name="M1", calendar_id="CAL")],
        calendars=[cal],
    )


def scenario_a_cpsat() -> None:
    """Run with strategy='cpsat'. Depends on OR-Tools availability."""
    uc = make_minimal_uc()
    run_and_report("Scenario A: strategy=cpsat", uc, strategy="cpsat")


def scenario_b_nonexistent_strategy() -> None:
    """Run with a completely invalid strategy name."""
    uc = make_minimal_uc()
    run_and_report("Scenario B: strategy=nonexistent_strategy_name", uc, strategy="nonexistent_strategy_name")


def scenario_c_infinite_strategy() -> None:
    """Run with strategy='infinite' (rough-cut capacity)."""
    uc = make_minimal_uc()
    run_and_report("Scenario C: strategy=infinite", uc, strategy="infinite")


if __name__ == "__main__":
    scenario_a_cpsat()
    scenario_b_nonexistent_strategy()
    scenario_c_infinite_strategy()
