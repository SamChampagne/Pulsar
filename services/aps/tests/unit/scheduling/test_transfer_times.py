"""Transfer-time (material handling) tests.

Shop floors rarely have zero-cost hand-off between stations: a part has
to be moved by AGV, forklift or operator from machine A to machine B.
Ignoring that delay is the #1 academic shortcut that makes a schedule
unshippable in the plant. These tests pin the behaviour down across
the whole strategy family:

1. :class:`TransferTimes` value-object basics — self-loops and None
   endpoints resolve to zero, default applies to unknown pairs, explicit
   overrides win, negative values are rejected.
2. :class:`SchedulingContext` rejects transfer entries pointing at
   unknown machines (typo guard).
3. Greedy forward, greedy backward and CP-SAT all delay the successor's
   start by the transfer delta when the WO straddles two distinct
   machines, and charge nothing when it stays on the same machine.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

import pytest

from planiadvance_v2.domain.entities import Machine, WorkingCalendar
from planiadvance_v2.domain.errors import UnknownResourceError, ValidationError
from planiadvance_v2.domain.scheduling import (
    Objective,
    SchedulingContext,
    resolve_strategy,
)
from planiadvance_v2.domain.value_objects import Shift, TransferTimes
from tests.conftest import make_work_order

MONDAY = datetime(2026, 1, 5, 0, 0, 0)  # fixed Monday for deterministic asserts
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


def _ctx(work_orders, *, transfer_times: TransferTimes | None = None):
    return SchedulingContext(
        horizon_start=MONDAY,
        horizon_end=HORIZON_END,
        work_orders=work_orders,
        machines=_two_machines(),
        calendars=[_calendar()],
        transfer_times=transfer_times or TransferTimes.zero(),
    )


# --------------------------------------------------------------------------
# TransferTimes value object
# --------------------------------------------------------------------------


class TestTransferTimesValueObject:
    def test_self_loop_is_zero(self):
        tt = TransferTimes.uniform(30)
        assert tt.minutes("M1", "M1") == 0

    def test_none_endpoints_are_zero(self):
        tt = TransferTimes.uniform(30)
        assert tt.minutes(None, "M1") == 0
        assert tt.minutes("M1", None) == 0
        assert tt.minutes(None, None) == 0

    def test_default_applies_to_unknown_pair(self):
        tt = TransferTimes(default_minutes=15)
        assert tt.minutes("M1", "M2") == 15

    def test_explicit_override_wins_over_default(self):
        tt = TransferTimes(
            default_minutes=5,
            pairs={("M1", "M2"): 45, ("M2", "M1"): 20},
        )
        assert tt.minutes("M1", "M2") == 45
        assert tt.minutes("M2", "M1") == 20
        # Pair not listed falls back to the default.
        assert tt.minutes("M1", "M3") == 5

    def test_negative_default_rejected(self):
        with pytest.raises(ValidationError):
            TransferTimes(default_minutes=-1)

    def test_negative_pair_rejected(self):
        with pytest.raises(ValidationError):
            TransferTimes(pairs={("M1", "M2"): -7})


# --------------------------------------------------------------------------
# SchedulingContext validation
# --------------------------------------------------------------------------


class TestSchedulingContextTransferValidation:
    def test_rejects_unknown_source_machine(self):
        wo = make_work_order(
            "WO1",
            release=MONDAY,
            due=MONDAY + timedelta(days=3),
            ops=[("OP1", 60, ["M1"], 0)],
        )
        with pytest.raises(UnknownResourceError):
            _ctx(
                [wo],
                transfer_times=TransferTimes(pairs={("GHOST", "M1"): 10}),
            )

    def test_rejects_unknown_target_machine(self):
        wo = make_work_order(
            "WO1",
            release=MONDAY,
            due=MONDAY + timedelta(days=3),
            ops=[("OP1", 60, ["M1"], 0)],
        )
        with pytest.raises(UnknownResourceError):
            _ctx(
                [wo],
                transfer_times=TransferTimes(pairs={("M1", "GHOST"): 10}),
            )


# --------------------------------------------------------------------------
# Strategy behaviour: every backend must honour transfer delays
# --------------------------------------------------------------------------


@pytest.mark.parametrize("strategy_name", ALL_STRATEGIES)
class TestStrategiesHonourTransferTimes:
    """Transfer delay shows up between ops on *different* machines only."""

    def test_transfer_delay_gaps_successor_on_other_machine(self, strategy_name):
        # OP1 must run on M1 and OP2 must run on M2 — the only way to
        # satisfy both is for the engine to inject the 45-minute transfer.
        wo = make_work_order(
            "WO1",
            release=MONDAY,
            due=MONDAY + timedelta(days=3),
            ops=[
                ("OP1", 60, ["M1"], 0),
                ("OP2", 60, ["M2"], 0),
            ],
        )
        context = _ctx(
            [wo],
            transfer_times=TransferTimes(pairs={("M1", "M2"): 45}),
        )
        result = resolve_strategy(strategy_name).solve(context, Objective.default())

        op1 = next(a for a in result.schedule.assignments if a.operation_id == "OP1")
        op2 = next(a for a in result.schedule.assignments if a.operation_id == "OP2")
        assert op1.machine_id == "M1"
        assert op2.machine_id == "M2"
        gap = op2.start - op1.end
        assert gap >= timedelta(minutes=45), (
            f"{strategy_name}: expected >= 45min transfer gap, got {gap}"
        )

    def test_no_delay_when_both_ops_stay_on_same_machine(self, strategy_name):
        # Both ops are eligible only on M1 — transfer delay must not apply.
        wo = make_work_order(
            "WO1",
            release=MONDAY,
            due=MONDAY + timedelta(days=3),
            ops=[
                ("OP1", 60, ["M1"], 0),
                ("OP2", 60, ["M1"], 0),
            ],
        )
        context = _ctx(
            [wo],
            transfer_times=TransferTimes(pairs={("M1", "M2"): 120}),
        )
        result = resolve_strategy(strategy_name).solve(context, Objective.default())

        op1 = next(a for a in result.schedule.assignments if a.operation_id == "OP1")
        op2 = next(a for a in result.schedule.assignments if a.operation_id == "OP2")
        # Same machine → no transport → ops run back-to-back.
        assert op2.start == op1.end

    def test_zero_transfer_matrix_matches_legacy_behaviour(self, strategy_name):
        """Default empty TransferTimes must not delay anything."""
        wo = make_work_order(
            "WO1",
            release=MONDAY,
            due=MONDAY + timedelta(days=3),
            ops=[
                ("OP1", 60, ["M1"], 0),
                ("OP2", 60, ["M2"], 0),
            ],
        )
        context = _ctx([wo])  # no transfer_times
        result = resolve_strategy(strategy_name).solve(context, Objective.default())

        op1 = next(a for a in result.schedule.assignments if a.operation_id == "OP1")
        op2 = next(a for a in result.schedule.assignments if a.operation_id == "OP2")
        assert op2.start >= op1.end  # precedence always holds
        # When both machines belong to the same calendar and no shift
        # boundary gets in the way, the successor should start exactly
        # when the predecessor ends.
        assert op2.start == op1.end
