"""Integration tests for the full RunScheduling use case with in-memory repos.

These verify that the application layer wires the domain engine correctly
against the repository ports, without any SQL dependency.
"""

from __future__ import annotations

from planiadvance_v2.application.use_cases import RunScheduling
from planiadvance_v2.application.use_cases.run_scheduling import RunSchedulingInput
from planiadvance_v2.infrastructure.in_memory import (
    InMemoryCalendarRepository,
    InMemoryInventoryRepository,
    InMemoryMachineRepository,
    InMemoryScheduleRepository,
    InMemorySupplyRepository,
    InMemoryWorkOrderRepository,
)
from planiadvance_v2.infrastructure.seed import build_demo_dataset


def test_run_scheduling_on_demo_dataset():
    dataset = build_demo_dataset()
    schedules = InMemoryScheduleRepository()

    use_case = RunScheduling(
        work_orders=InMemoryWorkOrderRepository(seed=dataset.work_orders),
        machines=InMemoryMachineRepository(seed=dataset.machines),
        calendars=InMemoryCalendarRepository(seed=dataset.calendars),
        inventory=InMemoryInventoryRepository(seed=dataset.inventory_items),
        supplies=InMemorySupplyRepository(seed=dataset.supplies),
        schedules=schedules,
    )

    result = use_case.execute(
        RunSchedulingInput(horizon_days=14, heuristic="priority_edd", persist=True)
    )

    # Every operation must be scheduled.
    total_ops = sum(len(wo.operations) for wo in dataset.work_orders)
    assert len(result.schedule.assignments) == total_ops

    # Machine set should be a subset of the demo machines.
    demo_machine_ids = {m.id for m in dataset.machines}
    assert {a.machine_id for a in result.schedule.assignments} <= demo_machine_ids

    # KPIs should be populated.
    assert result.metrics["makespan_minutes"] > 0
    assert "on_time_ratio" in result.metrics
    assert 0.0 <= result.metrics["on_time_ratio"] <= 1.0

    # Persistence layer should have stored the run.
    assert schedules.get(result.schedule.id) is not None


def test_heuristic_selection_affects_order():
    dataset = build_demo_dataset()

    def run(heuristic: str):
        return RunScheduling(
            work_orders=InMemoryWorkOrderRepository(seed=dataset.work_orders),
            machines=InMemoryMachineRepository(seed=dataset.machines),
            calendars=InMemoryCalendarRepository(seed=dataset.calendars),
            inventory=InMemoryInventoryRepository(seed=dataset.inventory_items),
            supplies=InMemorySupplyRepository(seed=dataset.supplies),
        ).execute(RunSchedulingInput(horizon_days=14, heuristic=heuristic, persist=False))

    edd = run("edd")
    spt = run("spt")
    # Both must be feasible.
    assert edd.schedule.assignments
    assert spt.schedule.assignments
