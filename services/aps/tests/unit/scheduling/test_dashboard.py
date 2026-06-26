"""Tests for the schedule dashboard use case.

Verifies that GetScheduleDashboard loads a persisted schedule and
produces a complete KPI dashboard with analysis.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

from planiadvance_v2.application.use_cases.get_schedule_dashboard import (
    GetScheduleDashboard,
)
from planiadvance_v2.application.use_cases.run_scheduling import (
    RunScheduling,
    RunSchedulingInput,
)
from planiadvance_v2.domain.entities import Machine, WorkingCalendar
from planiadvance_v2.domain.value_objects import Priority, Shift
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryCalendarRepository,
    InMemoryMachineRepository,
    InMemoryScheduleRepository,
    InMemoryWorkOrderRepository,
)
from tests.conftest import make_work_order

HORIZON_START = datetime(2026, 1, 5, 0, 0, 0)


def _calendar() -> WorkingCalendar:
    return WorkingCalendar(
        id="CAL",
        name="MF",
        shifts=[
            Shift(weekday=w, start=time(8, 0), end=time(17, 0)) for w in range(5)
        ],
    )


def _machines() -> list[Machine]:
    return [
        Machine(id="M1", name="M1", calendar_id="CAL"),
        Machine(id="M2", name="M2", calendar_id="CAL"),
    ]


def _workload():
    return [
        make_work_order(
            "WO1",
            release=HORIZON_START,
            due=HORIZON_START + timedelta(days=3),
            ops=[
                ("OP1", 60, ["M1", "M2"], 0),
                ("OP2", 60, ["M1", "M2"], 0),
            ],
        ),
        make_work_order(
            "WO2",
            release=HORIZON_START,
            due=HORIZON_START + timedelta(days=2),
            ops=[("OP3", 90, ["M1", "M2"], 0)],
            priority=Priority.URGENT,
        ),
    ]


# --------------------------------------------------------------------------
# Tests
# --------------------------------------------------------------------------


class TestGetScheduleDashboard:
    def test_dashboard_for_persisted_schedule(self):
        work_orders = _workload()
        schedule_repo = InMemoryScheduleRepository()

        # First, run a schedule and persist it.
        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository(work_orders),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                strategy="greedy",
                persist=True,
            )
        )
        schedule_id = result.schedule.id

        # Now load the dashboard.
        dashboard_uc = GetScheduleDashboard(
            schedules=schedule_repo,
            work_orders=InMemoryWorkOrderRepository(work_orders),
        )
        dashboard = dashboard_uc.execute(schedule_id)

        assert dashboard.schedule_id == schedule_id
        assert dashboard.work_order_count == 2
        assert dashboard.operation_count == 3
        assert dashboard.machine_count >= 1
        assert "makespan_minutes" in dashboard.metrics
        assert "on_time_ratio" in dashboard.metrics
        assert dashboard.analysis is not None
        assert len(dashboard.analysis.critical_path.operations) > 0

    def test_dashboard_not_found(self):
        import pytest

        from planiadvance_v2.domain.errors import ValidationError

        schedule_repo = InMemoryScheduleRepository()
        work_orders = _workload()

        dashboard_uc = GetScheduleDashboard(
            schedules=schedule_repo,
            work_orders=InMemoryWorkOrderRepository(work_orders),
        )
        with pytest.raises(ValidationError, match="not found"):
            dashboard_uc.execute("nonexistent-id")

    def test_dashboard_analysis_has_gantt(self):
        work_orders = _workload()
        schedule_repo = InMemoryScheduleRepository()

        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository(work_orders),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                strategy="greedy",
                persist=True,
            )
        )

        dashboard_uc = GetScheduleDashboard(
            schedules=schedule_repo,
            work_orders=InMemoryWorkOrderRepository(work_orders),
        )
        dashboard = dashboard_uc.execute(result.schedule.id)

        assert len(dashboard.analysis.gantt) == 3
        assert dashboard.analysis.bottleneck.bottleneck_machine_id in ("M1", "M2")
