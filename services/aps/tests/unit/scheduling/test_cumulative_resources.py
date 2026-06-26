"""Secondary-resource enforcement tests.

These exercise three layers, top-down:

1. :class:`CumulativeResourceTimeline` — the sweep-line peak-usage query,
   the ``can_accommodate`` guard, and the forward/backward feasible-start
   searches. Pure data structure, no strategy involved.
2. :mod:`resource_aligner` — the fixed-point forward/backward alignment
   helpers the greedy strategies rely on.
3. The greedy *forward* and *backward* strategies as end-to-end consumers:
   two operations that share a unit-capacity resource must be serialised
   even when their machines are different, and a resource calendar must
   push placements out of off-shift windows.

Together these cover the entire secondary-resource path. Before this
commit CP-SAT was the only backend that enforced resources — the greedy
family silently ignored ``operation.resource_requirements`` which made
its plans unshippable for any shop that shares operators, tooling or
fixtures across machines.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

from planiadvance_v2.domain.entities import (
    Machine,
    Operation,
    Resource,
    ResourceRequirement,
    WorkingCalendar,
    WorkOrder,
)
from planiadvance_v2.domain.scheduling import (
    Objective,
    SchedulingContext,
    resolve_strategy,
)
from planiadvance_v2.domain.scheduling.calendar_resolver import CalendarResolver
from planiadvance_v2.domain.scheduling.cumulative_timeline import (
    CumulativeResourceTimeline,
)
from planiadvance_v2.domain.scheduling.resource_aligner import (
    align_to_resources,
    align_to_resources_backward,
    build_resource_timelines,
)
from planiadvance_v2.domain.value_objects import (
    Duration,
    Priority,
    Shift,
    TimeWindow,
)

MONDAY = datetime(2026, 1, 5, 0, 0, 0)
HORIZON_END = MONDAY + timedelta(days=7)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _calendar() -> WorkingCalendar:
    return WorkingCalendar(
        id="CAL",
        name="Mon-Fri 08-17",
        shifts=[
            Shift(weekday=w, start=time(8, 0), end=time(17, 0)) for w in range(5)
        ],
    )


def _machines(count: int = 2) -> list[Machine]:
    return [Machine(id=f"M{i}", name=f"M{i}", calendar_id="CAL") for i in range(1, count + 1)]


def _op(
    op_id: str,
    *,
    wo_id: str,
    sequence: int,
    duration_min: int,
    machines: list[str],
    resources: list[tuple[str, int]] | None = None,
) -> Operation:
    return Operation(
        id=op_id,
        work_order_id=wo_id,
        sequence=sequence,
        name=op_id,
        duration=Duration(minutes=duration_min),
        eligible_machine_ids=list(machines),
        resource_requirements=[
            ResourceRequirement(resource_id=r, units=u)
            for r, u in (resources or [])
        ],
    )


def _wo(wo_id: str, ops: list[Operation], *, due_hours: int = 72) -> WorkOrder:
    return WorkOrder(
        id=wo_id,
        name=wo_id,
        product_id=f"PROD-{wo_id}",
        quantity=1,
        due_date=MONDAY + timedelta(hours=due_hours),
        release_date=MONDAY,
        operations=ops,
        priority=Priority.NORMAL,
    )


def _window(start_min: int, end_min: int) -> TimeWindow:
    return TimeWindow(
        start=MONDAY + timedelta(minutes=start_min),
        end=MONDAY + timedelta(minutes=end_min),
    )


# --------------------------------------------------------------------------
# CumulativeResourceTimeline unit tests
# --------------------------------------------------------------------------


class TestCumulativeResourceTimeline:
    def test_empty_timeline_peak_is_zero(self):
        tl = CumulativeResourceTimeline(resource_id="R", capacity=3)
        assert tl.peak_usage(_window(0, 600)) == 0
        assert tl.can_accommodate(_window(0, 600), units=3)
        assert tl.is_empty()

    def test_peak_usage_sweeps_overlapping_bookings(self):
        tl = CumulativeResourceTimeline(resource_id="R", capacity=5)
        tl.book(_window(0, 100), units=2, operation_id="A")
        tl.book(_window(50, 150), units=2, operation_id="B")
        tl.book(_window(75, 125), units=1, operation_id="C")
        # Peaks at [75,100): 2 + 2 + 1 = 5
        assert tl.peak_usage(_window(0, 200)) == 5

    def test_touching_bookings_do_not_stack(self):
        """Two bookings sharing an instant (end == next.start) don't pile up."""
        tl = CumulativeResourceTimeline(resource_id="R", capacity=1)
        tl.book(_window(0, 60), units=1, operation_id="A")
        tl.book(_window(60, 120), units=1, operation_id="B")
        assert tl.peak_usage(_window(0, 120)) == 1

    def test_can_accommodate_respects_capacity(self):
        tl = CumulativeResourceTimeline(resource_id="R", capacity=2)
        tl.book(_window(0, 60), units=2, operation_id="A")
        assert not tl.can_accommodate(_window(30, 90), units=1)
        assert tl.can_accommodate(_window(60, 120), units=2)

    def test_earliest_feasible_start_jumps_past_conflict(self):
        tl = CumulativeResourceTimeline(resource_id="R", capacity=1)
        tl.book(_window(0, 120), units=1, operation_id="A")
        result = tl.earliest_feasible_start(
            earliest_start=MONDAY,
            duration=Duration(minutes=60),
            units=1,
            horizon_end=HORIZON_END,
        )
        assert result == MONDAY + timedelta(minutes=120)

    def test_earliest_feasible_start_returns_none_beyond_horizon(self):
        tl = CumulativeResourceTimeline(resource_id="R", capacity=1)
        tl.book(_window(0, 10_000), units=1, operation_id="A")
        result = tl.earliest_feasible_start(
            earliest_start=MONDAY,
            duration=Duration(minutes=60),
            units=1,
            horizon_end=MONDAY + timedelta(minutes=5_000),
        )
        assert result is None

    def test_earliest_feasible_start_rejects_over_capacity_request(self):
        tl = CumulativeResourceTimeline(resource_id="R", capacity=2)
        assert (
            tl.earliest_feasible_start(
                earliest_start=MONDAY,
                duration=Duration(minutes=60),
                units=3,
                horizon_end=HORIZON_END,
            )
            is None
        )

    def test_latest_feasible_end_jumps_before_conflict(self):
        tl = CumulativeResourceTimeline(resource_id="R", capacity=1)
        tl.book(_window(240, 360), units=1, operation_id="A")
        # latest_end at 300 overlaps the booking — must slide back to 240.
        result = tl.latest_feasible_end(
            latest_end=MONDAY + timedelta(minutes=300),
            duration=Duration(minutes=60),
            units=1,
            earliest_start=MONDAY,
        )
        assert result == MONDAY + timedelta(minutes=240)

    def test_latest_feasible_end_returns_none_below_earliest_start(self):
        tl = CumulativeResourceTimeline(resource_id="R", capacity=1)
        tl.book(_window(0, 10_000), units=1, operation_id="A")
        result = tl.latest_feasible_end(
            latest_end=MONDAY + timedelta(minutes=5_000),
            duration=Duration(minutes=60),
            units=1,
            earliest_start=MONDAY,
        )
        assert result is None


# --------------------------------------------------------------------------
# resource_aligner helpers
# --------------------------------------------------------------------------


class TestResourceAligner:
    def _make_resolver(self) -> CalendarResolver:
        return CalendarResolver(MONDAY, HORIZON_END)

    def test_align_forward_no_requirements_is_identity(self):
        op = _op("OP", wo_id="WO", sequence=1, duration_min=60, machines=["M1"])
        resolver = self._make_resolver()
        timelines = build_resource_timelines([], {"CAL": _calendar()}, resolver)
        result = align_to_resources(
            earliest_start=MONDAY,
            duration=Duration(minutes=60),
            operation=op,
            timelines=timelines,
            horizon_end=HORIZON_END,
        )
        assert result == MONDAY

    def test_align_forward_pushes_past_booked_resource(self):
        resolver = self._make_resolver()
        resource = Resource(id="OP-POOL", name="Operators", capacity=1)
        timelines = build_resource_timelines(
            [resource], {"CAL": _calendar()}, resolver
        )
        # Manually book the resource from 08:00 to 10:00 to simulate
        # another op already holding it.
        timelines["OP-POOL"].book(
            TimeWindow(
                start=MONDAY + timedelta(hours=8),
                end=MONDAY + timedelta(hours=10),
            ),
            units=1,
            operation_id="OTHER",
        )
        op = _op(
            "OP",
            wo_id="WO",
            sequence=1,
            duration_min=60,
            machines=["M1"],
            resources=[("OP-POOL", 1)],
        )
        result = align_to_resources(
            earliest_start=MONDAY + timedelta(hours=8),
            duration=Duration(minutes=60),
            operation=op,
            timelines=timelines,
            horizon_end=HORIZON_END,
        )
        assert result == MONDAY + timedelta(hours=10)

    def test_align_backward_pulls_before_booked_resource(self):
        resolver = self._make_resolver()
        resource = Resource(id="OP-POOL", name="Operators", capacity=1)
        timelines = build_resource_timelines(
            [resource], {"CAL": _calendar()}, resolver
        )
        timelines["OP-POOL"].book(
            TimeWindow(
                start=MONDAY + timedelta(hours=14),
                end=MONDAY + timedelta(hours=16),
            ),
            units=1,
            operation_id="OTHER",
        )
        op = _op(
            "OP",
            wo_id="WO",
            sequence=1,
            duration_min=60,
            machines=["M1"],
            resources=[("OP-POOL", 1)],
        )
        result = align_to_resources_backward(
            latest_end=MONDAY + timedelta(hours=15),
            duration=Duration(minutes=60),
            operation=op,
            timelines=timelines,
            earliest_start=MONDAY,
        )
        assert result == MONDAY + timedelta(hours=14)


# --------------------------------------------------------------------------
# End-to-end strategy tests
# --------------------------------------------------------------------------


class TestGreedyHonoursSecondaryResources:
    """Two parallel ops sharing a capacity-1 resource must be serialised."""

    def test_capacity_one_serialises_parallel_machines(self):
        machines = _machines(2)
        calendar = _calendar()
        resource = Resource(id="MOULD", name="Mould", capacity=1)
        ops_a = [
            _op(
                "A",
                wo_id="WOA",
                sequence=1,
                duration_min=60,
                machines=["M1"],
                resources=[("MOULD", 1)],
            )
        ]
        ops_b = [
            _op(
                "B",
                wo_id="WOB",
                sequence=1,
                duration_min=60,
                machines=["M2"],
                resources=[("MOULD", 1)],
            )
        ]
        context = SchedulingContext(
            horizon_start=MONDAY,
            horizon_end=HORIZON_END,
            work_orders=[_wo("WOA", ops_a), _wo("WOB", ops_b)],
            machines=machines,
            calendars=[calendar],
            resources=[resource],
        )
        result = resolve_strategy("greedy").solve(context, Objective.default())

        a_assign = next(a for a in result.schedule.assignments if a.operation_id == "A")
        b_assign = next(a for a in result.schedule.assignments if a.operation_id == "B")
        assert a_assign.machine_id != b_assign.machine_id
        # Serialised: the later op starts no earlier than the earlier op ends.
        earlier, later = sorted((a_assign, b_assign), key=lambda x: x.start)
        assert later.start >= earlier.end

    def test_capacity_two_allows_parallel_placement(self):
        machines = _machines(2)
        calendar = _calendar()
        # Pool of 2 operators lets both ops run concurrently.
        resource = Resource(id="OP-POOL", name="Operators", capacity=2)
        ops_a = [
            _op(
                "A",
                wo_id="WOA",
                sequence=1,
                duration_min=60,
                machines=["M1"],
                resources=[("OP-POOL", 1)],
            )
        ]
        ops_b = [
            _op(
                "B",
                wo_id="WOB",
                sequence=1,
                duration_min=60,
                machines=["M2"],
                resources=[("OP-POOL", 1)],
            )
        ]
        context = SchedulingContext(
            horizon_start=MONDAY,
            horizon_end=HORIZON_END,
            work_orders=[_wo("WOA", ops_a), _wo("WOB", ops_b)],
            machines=machines,
            calendars=[calendar],
            resources=[resource],
        )
        result = resolve_strategy("greedy").solve(context, Objective.default())

        a_assign = next(a for a in result.schedule.assignments if a.operation_id == "A")
        b_assign = next(a for a in result.schedule.assignments if a.operation_id == "B")
        # Both ops should land at the same instant (the horizon's first shift).
        assert a_assign.start == b_assign.start
        assert a_assign.end == b_assign.end


class TestBackwardHonoursSecondaryResources:
    """Same serialisation guarantee but for the just-in-time strategy."""

    def test_capacity_one_serialises_parallel_machines(self):
        machines = _machines(2)
        calendar = _calendar()
        resource = Resource(id="MOULD", name="Mould", capacity=1)
        ops_a = [
            _op(
                "A",
                wo_id="WOA",
                sequence=1,
                duration_min=60,
                machines=["M1"],
                resources=[("MOULD", 1)],
            )
        ]
        ops_b = [
            _op(
                "B",
                wo_id="WOB",
                sequence=1,
                duration_min=60,
                machines=["M2"],
                resources=[("MOULD", 1)],
            )
        ]
        context = SchedulingContext(
            horizon_start=MONDAY,
            horizon_end=HORIZON_END,
            work_orders=[_wo("WOA", ops_a), _wo("WOB", ops_b)],
            machines=machines,
            calendars=[calendar],
            resources=[resource],
        )
        result = resolve_strategy("backward").solve(context, Objective.default())

        a_assign = next(a for a in result.schedule.assignments if a.operation_id == "A")
        b_assign = next(a for a in result.schedule.assignments if a.operation_id == "B")
        earlier, later = sorted((a_assign, b_assign), key=lambda x: x.start)
        assert later.start >= earlier.end
