"""OR-library / Taillard benchmark harness.

The OR-library (Beasley, 1990) and Taillard instances (Taillard, 1993)
are the standard benchmarks for job-shop scheduling research. Every new
algorithm in the literature reports results on these instances, so an
industrial APS engine that cannot run them is impossible to compare.

This module provides:

1. :func:`parse_standard_instance` — parses the classic text format used
   by OR-library (``ft06``, ``la01–la40``, ``ta01–ta80`` etc.) into a
   :class:`SchedulingContext` that any strategy can solve.

2. :func:`generate_random_instance` — generates random JSSP instances
   with controlled parameters (num_jobs, num_machines, duration range).
   Useful for stress testing and scalability profiling.

3. :class:`BenchmarkResult` — captures the strategy result plus metadata
   (instance name, known optimum, gap to optimum).

4. :func:`run_benchmark` — convenience wrapper that parses, solves, and
   computes the gap in one call.

Standard format
---------------
The classic OR-library JSSP format is::

    num_jobs  num_machines
    machine_id  duration  machine_id  duration  ...   (job 0)
    machine_id  duration  machine_id  duration  ...   (job 1)
    ...

Each line after the header describes a job's operations in order.
Each operation is a ``(machine, duration)`` pair. Machine ids are
zero-indexed integers.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from random import Random

from ..entities import Machine, Operation, WorkingCalendar, WorkOrder
from ..value_objects import Duration, Shift
from .context import SchedulingContext
from .objective import Objective
from .strategy import StrategyResult, resolve_strategy


@dataclass(frozen=True, slots=True)
class BenchmarkResult:
    """Result of running a strategy on a benchmark instance."""

    instance_name: str
    strategy_name: str
    makespan_minutes: int
    known_optimum: int | None
    gap_percent: float | None
    wall_time_ms: int
    solver_status: str
    num_jobs: int
    num_machines: int


def parse_standard_instance(
    text: str,
    *,
    instance_name: str = "unknown",
) -> tuple[SchedulingContext, int, int]:
    """Parse a standard OR-library JSSP instance into a SchedulingContext.

    Returns ``(context, num_jobs, num_machines)``.

    The generated context uses:
    - A 24/7 calendar (no off-shifts) so the benchmark is pure JSSP.
    - One machine per machine index in the instance.
    - One work order per job, with one operation per step.
    - Horizon = sum of all durations (generous upper bound).
    """
    lines = [
        line.strip()
        for line in text.strip().splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]

    # First non-comment line: num_jobs num_machines.
    header = lines[0].split()
    num_jobs = int(header[0])
    num_machines = int(header[1])

    # Generate a 24/7 calendar (00:00 → 23:59 each day).
    from datetime import time as dt_time

    calendar = WorkingCalendar(
        id="BENCH_CAL",
        name="24/7",
        shifts=[
            Shift(weekday=w, start=dt_time(0, 0), end=dt_time(23, 59))
            for w in range(7)
        ],
    )

    machines = [
        Machine(id=f"M{i}", name=f"Machine {i}", calendar_id="BENCH_CAL")
        for i in range(num_machines)
    ]

    horizon_start = datetime(2026, 1, 1, 0, 0, 0)
    total_duration = 0
    work_orders: list[WorkOrder] = []

    for job_idx in range(num_jobs):
        line = lines[1 + job_idx]
        tokens = list(map(int, line.split()))
        ops: list[Operation] = []
        prev_id: str | None = None

        for step_idx in range(num_machines):
            machine_idx = tokens[2 * step_idx]
            duration = tokens[2 * step_idx + 1]
            total_duration += duration

            op_id = f"J{job_idx}_O{step_idx}"
            ops.append(
                Operation(
                    id=op_id,
                    work_order_id=f"J{job_idx}",
                    sequence=step_idx + 1,
                    name=op_id,
                    duration=Duration(minutes=duration),
                    eligible_machine_ids=[f"M{machine_idx}"],
                    dependencies=[prev_id] if prev_id else [],
                )
            )
            prev_id = op_id

        work_orders.append(
            WorkOrder(
                id=f"J{job_idx}",
                name=f"Job {job_idx}",
                product_id=f"PROD-{job_idx}",
                quantity=1,
                due_date=horizon_start + timedelta(minutes=total_duration * 2),
                release_date=horizon_start,
                operations=ops,
            )
        )

    horizon_end = horizon_start + timedelta(minutes=total_duration * 2)

    context = SchedulingContext(
        horizon_start=horizon_start,
        horizon_end=horizon_end,
        work_orders=work_orders,
        machines=machines,
        calendars=[calendar],
    )
    return context, num_jobs, num_machines


def generate_random_instance(
    *,
    num_jobs: int = 10,
    num_machines: int = 5,
    min_duration: int = 1,
    max_duration: int = 100,
    seed: int = 42,
) -> str:
    """Generate a random JSSP instance in standard OR-library format.

    Each job visits every machine exactly once in a random order —
    the classic ``n x m`` rectangular JSSP.
    """
    rng = Random(seed)
    lines = [f"{num_jobs}  {num_machines}"]
    for _ in range(num_jobs):
        machine_order = list(range(num_machines))
        rng.shuffle(machine_order)
        parts = []
        for m in machine_order:
            d = rng.randint(min_duration, max_duration)
            parts.append(f"{m}  {d}")
        lines.append("  ".join(parts))
    return "\n".join(lines)


def run_benchmark(
    text: str,
    *,
    strategy_name: str = "greedy",
    instance_name: str = "unknown",
    known_optimum: int | None = None,
    objective: Objective | None = None,
) -> BenchmarkResult:
    """Parse, solve, and report a benchmark instance in one call."""
    context, num_jobs, num_machines = parse_standard_instance(
        text, instance_name=instance_name
    )
    obj = objective or Objective(makespan=1)
    strategy = resolve_strategy(strategy_name)
    result: StrategyResult = strategy.solve(context, obj)

    # Compute makespan as the max end time minus horizon start.
    makespan = 0
    for a in result.schedule.assignments:
        minutes = int(
            (a.end - context.horizon_start).total_seconds() // 60
        )
        if minutes > makespan:
            makespan = minutes

    gap: float | None = None
    if known_optimum is not None and known_optimum > 0:
        gap = round((makespan - known_optimum) / known_optimum * 100, 2)

    return BenchmarkResult(
        instance_name=instance_name,
        strategy_name=result.strategy_name,
        makespan_minutes=makespan,
        known_optimum=known_optimum,
        gap_percent=gap,
        wall_time_ms=result.wall_time_ms,
        solver_status=result.solver_status,
        num_jobs=num_jobs,
        num_machines=num_machines,
    )
