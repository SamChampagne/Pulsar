from __future__ import annotations

from datetime import datetime, time, timedelta

from planiadvance_v2.domain.entities import (
    Machine,
    Schedule,
    ScheduledOperation,
    WorkingCalendar,
)
from planiadvance_v2.domain.scheduling import build_machine_capacity_ledger
from planiadvance_v2.domain.value_objects import Shift, TimeWindow

MONDAY = datetime(2026, 1, 5, 0, 0, 0)


def _calendar() -> WorkingCalendar:
    return WorkingCalendar(
        id="CAL",
        name="Day shift",
        shifts=[Shift(weekday=0, start=time(8, 0), end=time(17, 0))],
    )


def test_machine_capacity_bucket_splits_setup_run_and_idle_minutes():
    schedule = Schedule(
        id="RUN-1",
        created_at=MONDAY,
        assignments=[
            ScheduledOperation(
                operation_id="OP-1",
                work_order_id="WO-1",
                machine_id="M1",
                setup_start=MONDAY.replace(hour=8),
                start=MONDAY.replace(hour=8, minute=30),
                end=MONDAY.replace(hour=10),
            )
        ],
    )

    ledger = build_machine_capacity_ledger(
        schedule=schedule,
        machines=[Machine(id="M1", name="Cut", calendar_id="CAL")],
        calendars=[_calendar()],
        horizon_start=MONDAY,
        horizon_end=MONDAY + timedelta(days=1),
        bucket="day",
    )

    assert ledger.status == "normal"
    assert ledger.total_capacity_minutes == 540
    assert ledger.total_scheduled_load_minutes == 120
    bucket = ledger.buckets[0]
    assert bucket.setup_minutes == 30
    assert bucket.run_minutes == 90
    assert bucket.idle_minutes == 420
    assert bucket.utilization == 0.2222
    assert ledger.machines[0].operation_count == 1
    assert ledger.bottleneck_machine_id == "M1"


def test_machine_capacity_subtracts_machine_maintenance_windows():
    machine = Machine(
        id="M1",
        name="Cut",
        calendar_id="CAL",
        maintenance_windows=[
            TimeWindow(
                start=MONDAY.replace(hour=13),
                end=MONDAY.replace(hour=15),
            )
        ],
    )
    schedule = Schedule(id="RUN-1", created_at=MONDAY, assignments=[])

    ledger = build_machine_capacity_ledger(
        schedule=schedule,
        machines=[machine],
        calendars=[_calendar()],
        horizon_start=MONDAY,
        horizon_end=MONDAY + timedelta(days=1),
        bucket="day",
    )

    assert ledger.buckets[0].capacity_minutes == 420
    assert ledger.buckets[0].pressure == "normal"


def test_machine_capacity_flags_over_capacity_load():
    schedule = Schedule(
        id="RUN-1",
        created_at=MONDAY,
        assignments=[
            ScheduledOperation(
                operation_id="OP-LONG",
                work_order_id="WO-1",
                machine_id="M1",
                setup_start=MONDAY.replace(hour=8),
                start=MONDAY.replace(hour=8),
                end=MONDAY.replace(hour=18),
            )
        ],
    )

    ledger = build_machine_capacity_ledger(
        schedule=schedule,
        machines=[Machine(id="M1", name="Cut", calendar_id="CAL")],
        calendars=[_calendar()],
        horizon_start=MONDAY,
        horizon_end=MONDAY + timedelta(days=1),
        bucket="day",
    )

    assert ledger.status == "over_capacity"
    assert ledger.total_overload_minutes == 60
    assert ledger.buckets[0].pressure == "over_capacity"
