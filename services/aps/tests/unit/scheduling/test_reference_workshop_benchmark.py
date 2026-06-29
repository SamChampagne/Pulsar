"""Light performance smoke tests for the reference workshop.

These are not strict micro-benchmarks. They simply protect us from obvious
performance regressions on the small reference dataset that powers the core
maturity sprint.
"""

from __future__ import annotations

import time

from planiadvance_v2.application.use_cases.compare_strategies import (
    CompareStrategies,
    CompareStrategiesInput,
)
from planiadvance_v2.application.use_cases.run_scheduling import (
    RunScheduling,
    RunSchedulingInput,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryCalendarRepository,
    InMemoryMachineRepository,
    InMemoryResourceRepository,
    InMemoryWorkOrderRepository,
)
from tests.support.reference_scenarios import (
    build_reference_workshop,
    build_stressed_reference_workshop,
)


def test_reference_workshop_run_stays_fast():
    workshop = build_reference_workshop()
    uc = RunScheduling(
        work_orders=InMemoryWorkOrderRepository(workshop.work_orders),
        machines=InMemoryMachineRepository(workshop.machines),
        calendars=InMemoryCalendarRepository(workshop.calendars),
        resources=InMemoryResourceRepository(workshop.resources),
    )

    started = time.perf_counter()
    result = uc.execute(
        RunSchedulingInput(
            horizon_start=workshop.horizon_start,
            horizon_days=5,
            strategy="greedy",
            transfer_times=workshop.transfer_times,
            persist=False,
        )
    )
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    assert result.wall_time_ms < 2000
    assert elapsed_ms < 2000


def test_reference_workshop_compare_stays_reasonable():
    workshop = build_reference_workshop()
    uc = CompareStrategies(
        work_orders=InMemoryWorkOrderRepository(workshop.work_orders),
        machines=InMemoryMachineRepository(workshop.machines),
        calendars=InMemoryCalendarRepository(workshop.calendars),
        resources=InMemoryResourceRepository(workshop.resources),
    )

    started = time.perf_counter()
    result = uc.execute(
        CompareStrategiesInput(
            strategies=["greedy", "backward"],
            horizon_start=workshop.horizon_start,
            horizon_days=5,
            transfer_times=workshop.transfer_times,
            parallel=False,
        )
    )
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    assert all(run.wall_time_ms < 3000 for run in result.runs)
    assert elapsed_ms < 5000


def test_stressed_reference_workshop_run_stays_reasonable():
    workshop = build_stressed_reference_workshop()
    uc = RunScheduling(
        work_orders=InMemoryWorkOrderRepository(workshop.work_orders),
        machines=InMemoryMachineRepository(workshop.machines),
        calendars=InMemoryCalendarRepository(workshop.calendars),
        resources=InMemoryResourceRepository(workshop.resources),
    )

    started = time.perf_counter()
    result = uc.execute(
        RunSchedulingInput(
            horizon_start=workshop.horizon_start,
            horizon_days=5,
            strategy="greedy",
            transfer_times=workshop.transfer_times,
            persist=False,
        )
    )
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    assert result.wall_time_ms < 3000
    assert elapsed_ms < 3000
