"""Lot-splitting (batch sizing) tests.

Industrial shops split large orders into sub-lots for parallel processing.
These tests verify:

1. **LotSizingPolicy** value object — FIXED and MIN_MAX compute_lots
   arithmetic, validation rules, edge cases.
2. **split_lots** preprocessor — expands work orders into sub-lot WOs
   with correct ids, durations, dependencies, and quantities.
3. **reassemble_schedule** — maps sub-lot assignments back to parent ids.
4. **End-to-end** through all strategies — a 100-unit order split into
   two 50-unit lots schedules correctly with both lots running in
   parallel when two machines are available.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

import pytest

from planiadvance_v2.domain.entities import (
    Machine,
    Operation,
    Schedule,
    ScheduledOperation,
    WorkingCalendar,
    WorkOrder,
)
from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.domain.scheduling import (
    Objective,
    SchedulingContext,
    reassemble_schedule,
    resolve_strategy,
    split_lots,
)
from planiadvance_v2.domain.value_objects import (
    Duration,
    LotSizingMode,
    LotSizingPolicy,
    Shift,
)

MONDAY = datetime(2026, 1, 5, 0, 0, 0)
HORIZON_END = MONDAY + timedelta(days=7)

ALL_STRATEGIES = ["greedy", "backward", "cpsat"]


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


def _two_machines() -> list[Machine]:
    return [
        Machine(id="M1", name="M1", calendar_id="CAL"),
        Machine(id="M2", name="M2", calendar_id="CAL"),
    ]


def _ctx(work_orders, *, machines=None):
    return SchedulingContext(
        horizon_start=MONDAY,
        horizon_end=HORIZON_END,
        work_orders=work_orders,
        machines=machines or _two_machines(),
        calendars=[_calendar()],
    )


# --------------------------------------------------------------------------
# LotSizingPolicy value object
# --------------------------------------------------------------------------


class TestLotSizingPolicyValueObject:
    def test_none_returns_single_lot(self):
        policy = LotSizingPolicy.none()
        assert policy.compute_lots(100) == [100]

    def test_fixed_even_split(self):
        policy = LotSizingPolicy.fixed(25)
        assert policy.compute_lots(100) == [25, 25, 25, 25]

    def test_fixed_with_remainder(self):
        policy = LotSizingPolicy.fixed(30)
        lots = policy.compute_lots(100)
        assert lots == [30, 30, 30, 10]
        assert sum(lots) == 100

    def test_fixed_quantity_smaller_than_lot_size(self):
        policy = LotSizingPolicy.fixed(50)
        assert policy.compute_lots(20) == [20]

    def test_fixed_lot_size_zero_rejected(self):
        with pytest.raises(ValidationError):
            LotSizingPolicy.fixed(0)

    def test_min_max_basic(self):
        policy = LotSizingPolicy.min_max(20, 60)
        lots = policy.compute_lots(100)
        assert sum(lots) == 100
        assert all(20 <= lot <= 60 for lot in lots)

    def test_min_max_quantity_within_range(self):
        policy = LotSizingPolicy.min_max(10, 50)
        assert policy.compute_lots(30) == [30]

    def test_min_max_invalid_range(self):
        with pytest.raises(ValidationError):
            LotSizingPolicy.min_max(50, 20)

    def test_min_max_zero_min_rejected(self):
        with pytest.raises(ValidationError):
            LotSizingPolicy.min_max(0, 10)


# --------------------------------------------------------------------------
# split_lots preprocessor
# --------------------------------------------------------------------------


class TestSplitLots:
    def test_no_splitting_when_none_policy(self):
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="PROD",
            quantity=100,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="OP1",
                    work_order_id="WO1",
                    sequence=1,
                    name="OP1",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                )
            ],
        )
        result = split_lots([wo])
        assert len(result.work_orders) == 1
        assert result.work_orders[0].id == "WO1"
        assert result.lot_map == {}
        assert result.op_map == {}

    def test_fixed_split_creates_sub_lots(self):
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="PROD",
            quantity=100,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="OP1",
                    work_order_id="WO1",
                    sequence=1,
                    name="OP1",
                    duration=Duration(minutes=120),
                    eligible_machine_ids=["M1", "M2"],
                ),
                Operation(
                    id="OP2",
                    work_order_id="WO1",
                    sequence=2,
                    name="OP2",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1", "M2"],
                    dependencies=["OP1"],
                ),
            ],
            lot_sizing=LotSizingPolicy.fixed(50),
        )
        result = split_lots([wo])

        # Should create 2 sub-lot WOs.
        assert len(result.work_orders) == 2
        assert result.work_orders[0].id == "WO1/lot-1"
        assert result.work_orders[1].id == "WO1/lot-2"

        # Quantities correct.
        assert result.work_orders[0].quantity == 50
        assert result.work_orders[1].quantity == 50

        # Operations have sub-lot ids.
        lot1_ops = result.work_orders[0].ordered_operations()
        assert lot1_ops[0].id == "OP1/lot-1"
        assert lot1_ops[1].id == "OP2/lot-1"
        assert lot1_ops[1].dependencies == ["OP1/lot-1"]

        # Duration scaled: 120 * 50/100 = 60 minutes.
        assert lot1_ops[0].duration.minutes == 60
        assert lot1_ops[1].duration.minutes == 30

        # Lot map and op map populated.
        assert result.lot_map["WO1/lot-1"] == "WO1"
        assert result.lot_map["WO1/lot-2"] == "WO1"
        assert result.op_map["OP1/lot-1"] == "OP1"
        assert result.op_map["OP2/lot-2"] == "OP2"

    def test_mixed_splittable_and_non_splittable(self):
        wo1 = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="PROD",
            quantity=100,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="OP1",
                    work_order_id="WO1",
                    sequence=1,
                    name="OP1",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                ),
            ],
            lot_sizing=LotSizingPolicy.fixed(50),
        )
        wo2 = WorkOrder(
            id="WO2",
            name="WO2",
            product_id="PROD",
            quantity=10,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="OP2",
                    work_order_id="WO2",
                    sequence=1,
                    name="OP2",
                    duration=Duration(minutes=30),
                    eligible_machine_ids=["M1"],
                ),
            ],
        )
        result = split_lots([wo1, wo2])
        # WO1 split into 2, WO2 unchanged.
        assert len(result.work_orders) == 3
        ids = {wo.id for wo in result.work_orders}
        assert ids == {"WO1/lot-1", "WO1/lot-2", "WO2"}

    def test_sub_lots_are_not_re_split(self):
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="PROD",
            quantity=100,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="OP1",
                    work_order_id="WO1",
                    sequence=1,
                    name="OP1",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                ),
            ],
            lot_sizing=LotSizingPolicy.fixed(50),
        )
        result = split_lots([wo])
        # Sub-lots should have mode=NONE so re-splitting is impossible.
        for sub_wo in result.work_orders:
            assert sub_wo.lot_sizing.mode == LotSizingMode.NONE


# --------------------------------------------------------------------------
# reassemble_schedule
# --------------------------------------------------------------------------


class TestReassembleSchedule:
    def test_maps_sub_lot_wo_ids_back_to_parent(self):
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="PROD",
            quantity=100,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="OP1",
                    work_order_id="WO1",
                    sequence=1,
                    name="OP1",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                ),
            ],
            lot_sizing=LotSizingPolicy.fixed(50),
        )
        result = split_lots([wo])

        # Fake schedule with sub-lot assignments.
        schedule = Schedule(
            id="run-1",
            created_at=MONDAY,
            assignments=[
                ScheduledOperation(
                    operation_id="OP1/lot-1",
                    work_order_id="WO1/lot-1",
                    machine_id="M1",
                    setup_start=MONDAY,
                    start=MONDAY,
                    end=MONDAY + timedelta(minutes=30),
                ),
                ScheduledOperation(
                    operation_id="OP1/lot-2",
                    work_order_id="WO1/lot-2",
                    machine_id="M1",
                    setup_start=MONDAY + timedelta(minutes=30),
                    start=MONDAY + timedelta(minutes=30),
                    end=MONDAY + timedelta(minutes=60),
                ),
            ],
        )

        reassembled = reassemble_schedule(schedule, result)
        # Both assignments should map back to WO1.
        for a in reassembled.assignments:
            assert a.work_order_id == "WO1"

    def test_passthrough_when_no_splitting(self):
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="PROD",
            quantity=10,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="OP1",
                    work_order_id="WO1",
                    sequence=1,
                    name="OP1",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                ),
            ],
        )
        result = split_lots([wo])
        schedule = Schedule(
            id="run-1",
            created_at=MONDAY,
            assignments=[
                ScheduledOperation(
                    operation_id="OP1",
                    work_order_id="WO1",
                    machine_id="M1",
                    setup_start=MONDAY,
                    start=MONDAY,
                    end=MONDAY + timedelta(minutes=60),
                ),
            ],
        )
        reassembled = reassemble_schedule(schedule, result)
        assert reassembled is schedule  # identity — no copy needed


# --------------------------------------------------------------------------
# End-to-end: strategy runs on split lots
# --------------------------------------------------------------------------


@pytest.mark.parametrize("strategy_name", ALL_STRATEGIES)
class TestLotSplittingEndToEnd:
    """A 100-unit order split into two 50-unit lots with 2 machines
    available should schedule both lots in parallel, halving makespan."""

    def test_lots_run_in_parallel(self, strategy_name):
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="PROD",
            quantity=100,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="OP1",
                    work_order_id="WO1",
                    sequence=1,
                    name="OP1",
                    duration=Duration(minutes=120),
                    eligible_machine_ids=["M1", "M2"],
                ),
            ],
            lot_sizing=LotSizingPolicy.fixed(50),
        )

        # Step 1: split lots.
        lot_result = split_lots([wo])
        assert len(lot_result.work_orders) == 2

        # Step 2: schedule the expanded work orders.
        context = _ctx(lot_result.work_orders)
        result = resolve_strategy(strategy_name).solve(context, Objective.default())

        # Step 3: verify both lots are scheduled.
        assert len(result.schedule.assignments) == 2

        # Both lots should have 60-min duration (120 * 50/100).
        for a in result.schedule.assignments:
            dur = (a.end - a.start).total_seconds() / 60
            assert dur == pytest.approx(60, abs=1)

        # With two machines, the lots should run on different machines.
        machines_used = {a.machine_id for a in result.schedule.assignments}
        assert len(machines_used) == 2, (
            f"{strategy_name}: expected parallel on 2 machines, "
            f"got {machines_used}"
        )

        # Step 4: reassemble and verify parent WO id restored.
        reassembled = reassemble_schedule(result.schedule, lot_result)
        for a in reassembled.assignments:
            assert a.work_order_id == "WO1"

    def test_multi_op_lots_maintain_precedence(self, strategy_name):
        """Each sub-lot's operations must respect internal precedence."""
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="PROD",
            quantity=100,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="OP1",
                    work_order_id="WO1",
                    sequence=1,
                    name="OP1",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1", "M2"],
                ),
                Operation(
                    id="OP2",
                    work_order_id="WO1",
                    sequence=2,
                    name="OP2",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1", "M2"],
                    dependencies=["OP1"],
                ),
            ],
            lot_sizing=LotSizingPolicy.fixed(50),
        )

        lot_result = split_lots([wo])
        context = _ctx(lot_result.work_orders)
        result = resolve_strategy(strategy_name).solve(context, Objective.default())

        # 2 lots x 2 ops = 4 assignments.
        assert len(result.schedule.assignments) == 4

        # Check precedence within each lot.
        for lot_idx in [1, 2]:
            op1_id = f"OP1/lot-{lot_idx}"
            op2_id = f"OP2/lot-{lot_idx}"
            a1 = next(
                a for a in result.schedule.assignments if a.operation_id == op1_id
            )
            a2 = next(
                a for a in result.schedule.assignments if a.operation_id == op2_id
            )
            assert a2.start >= a1.end, (
                f"{strategy_name}: lot-{lot_idx} OP2 starts before OP1 ends"
            )
