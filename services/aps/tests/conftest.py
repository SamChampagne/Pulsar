"""Shared test fixtures."""

from __future__ import annotations

from datetime import datetime, time, timedelta

import pytest

from planiadvance_v2.domain.entities import (
    Machine,
    Operation,
    WorkingCalendar,
    WorkOrder,
)
from planiadvance_v2.domain.value_objects import Duration, Priority, Shift


@pytest.fixture
def horizon_start() -> datetime:
    """A fixed Monday at midnight for deterministic tests."""
    return datetime(2026, 1, 5, 0, 0, 0)  # 2026-01-05 is a Monday


@pytest.fixture
def horizon_end(horizon_start: datetime) -> datetime:
    return horizon_start + timedelta(days=14)


@pytest.fixture
def standard_calendar() -> WorkingCalendar:
    return WorkingCalendar(
        id="CAL",
        name="Mon-Fri 08-17",
        shifts=[Shift(weekday=w, start=time(8, 0), end=time(17, 0)) for w in range(5)],
    )


@pytest.fixture
def two_machines(standard_calendar: WorkingCalendar) -> list[Machine]:
    return [
        Machine(id="M1", name="Machine 1", calendar_id=standard_calendar.id),
        Machine(id="M2", name="Machine 2", calendar_id=standard_calendar.id),
    ]


def make_work_order(
    wo_id: str,
    *,
    release: datetime,
    due: datetime,
    ops: list[tuple[str, int, list[str], int]],
    priority: Priority = Priority.NORMAL,
) -> WorkOrder:
    """Convenience builder used by many tests.

    Each ``ops`` entry is (operation_id, duration_minutes, eligible_machines,
    setup_minutes).
    """
    operations: list[Operation] = []
    prev_id: str | None = None
    for idx, (op_id, dur, machines, setup) in enumerate(ops, start=1):
        operations.append(
            Operation(
                id=op_id,
                work_order_id=wo_id,
                sequence=idx,
                name=op_id,
                duration=Duration(minutes=dur),
                setup_time=Duration(minutes=setup),
                eligible_machine_ids=list(machines),
                dependencies=[prev_id] if prev_id else [],
            )
        )
        prev_id = op_id

    return WorkOrder(
        id=wo_id,
        name=wo_id,
        product_id=f"PROD-{wo_id}",
        quantity=1,
        due_date=due,
        release_date=release,
        operations=operations,
        priority=priority,
    )
