"""Alternative-routing (process-alternative) tests.

Real shops almost always offer process alternatives: a part can be made on
a big fast machine with more operators, or on a smaller slower one that
needs fewer hands.  The ``RoutingAlternative`` model lets the engine
evaluate every option and pick the best fit for the current load.

Tests cover:

1. **Entity validation** — ``RoutingAlternative`` and ``Operation.routings``
   validation rules: positive duration, no duplicate resources, machine must
   be eligible, and ``effective_routings()`` shim.
2. **Greedy forward** — with two routings offering different durations, the
   engine picks the faster one when capacity allows.
3. **Backward** — symmetric verification.
4. **CP-SAT** — same scenario through the exact backend.
5. **Per-routing resource requirements** — two routings on different machines
   require different operator counts; the engine respects the *selected*
   routing's requirements, not the union.
6. **Legacy compatibility** — operations without explicit ``routings`` still
   work identically (``effective_routings`` shim).
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

import pytest

from planiadvance_v2.domain.entities import (
    Machine,
    Operation,
    Resource,
    ResourceRequirement,
    RoutingAlternative,
    WorkingCalendar,
    WorkOrder,
)
from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.domain.scheduling import (
    Objective,
    SchedulingContext,
    resolve_strategy,
)
from planiadvance_v2.domain.value_objects import Duration, Shift

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


def _machines() -> list[Machine]:
    return [
        Machine(id="M_FAST", name="Fast machine", calendar_id="CAL"),
        Machine(id="M_SLOW", name="Slow machine", calendar_id="CAL"),
    ]


def _ctx(
    work_orders,
    *,
    resources: list[Resource] | None = None,
    machines: list[Machine] | None = None,
):
    return SchedulingContext(
        horizon_start=MONDAY,
        horizon_end=HORIZON_END,
        work_orders=work_orders,
        machines=machines or _machines(),
        calendars=[_calendar()],
        resources=resources or [],
    )


# --------------------------------------------------------------------------
# Entity validation
# --------------------------------------------------------------------------


class TestRoutingAlternativeValidation:
    def test_positive_duration_required(self):
        with pytest.raises(ValidationError, match="duration must be > 0"):
            RoutingAlternative(
                machine_id="M1", duration=Duration(minutes=0)
            )

    def test_machine_id_required(self):
        with pytest.raises(ValidationError, match="machine_id is required"):
            RoutingAlternative(machine_id="", duration=Duration(minutes=10))

    def test_duplicate_resource_rejected(self):
        with pytest.raises(ValidationError, match="duplicate resource"):
            RoutingAlternative(
                machine_id="M1",
                duration=Duration(minutes=10),
                resource_requirements=(
                    ResourceRequirement(resource_id="R1", units=1),
                    ResourceRequirement(resource_id="R1", units=2),
                ),
            )

    def test_valid_routing(self):
        alt = RoutingAlternative(
            machine_id="M1",
            duration=Duration(minutes=30),
            setup_time=Duration(minutes=5),
            resource_requirements=(
                ResourceRequirement(resource_id="R1", units=1),
            ),
        )
        assert alt.machine_id == "M1"
        assert alt.duration.minutes == 30
        assert alt.setup_time.minutes == 5


class TestOperationRoutingValidation:
    def test_routing_machine_must_be_eligible(self):
        with pytest.raises(ValidationError, match="not in eligible_machine_ids"):
            Operation(
                id="OP1",
                work_order_id="WO1",
                sequence=1,
                name="OP1",
                duration=Duration(minutes=60),
                eligible_machine_ids=["M1"],
                routings=[
                    RoutingAlternative(
                        machine_id="M_UNKNOWN",
                        duration=Duration(minutes=30),
                    ),
                ],
            )

    def test_effective_routings_with_explicit_routings(self):
        alt = RoutingAlternative(
            machine_id="M1", duration=Duration(minutes=30)
        )
        op = Operation(
            id="OP1",
            work_order_id="WO1",
            sequence=1,
            name="OP1",
            duration=Duration(minutes=60),
            eligible_machine_ids=["M1"],
            routings=[alt],
        )
        result = op.effective_routings()
        assert len(result) == 1
        assert result[0].machine_id == "M1"
        assert result[0].duration.minutes == 30  # routing overrides op flat duration

    def test_effective_routings_shim_for_legacy(self):
        op = Operation(
            id="OP1",
            work_order_id="WO1",
            sequence=1,
            name="OP1",
            duration=Duration(minutes=60),
            setup_time=Duration(minutes=10),
            eligible_machine_ids=["M1", "M2"],
        )
        routings = op.effective_routings()
        assert len(routings) == 2
        assert routings[0].machine_id == "M1"
        assert routings[0].duration.minutes == 60
        assert routings[0].setup_time.minutes == 10
        assert routings[1].machine_id == "M2"


# --------------------------------------------------------------------------
# Strategy: engine picks the faster routing
# --------------------------------------------------------------------------


@pytest.mark.parametrize("strategy_name", ALL_STRATEGIES)
class TestEnginePicksFasterRouting:
    """When one routing is faster, the engine should pick it (or at least
    produce a schedule where the faster machine is used)."""

    def test_picks_faster_machine_routing(self, strategy_name):
        # OP1 has two routings: M_FAST takes 30min, M_SLOW takes 120min.
        # Both are eligible. Engine should prefer M_FAST for earlier finish.
        op = Operation(
            id="OP1",
            work_order_id="WO1",
            sequence=1,
            name="OP1",
            duration=Duration(minutes=120),  # flat fallback (unused when routings set)
            eligible_machine_ids=["M_FAST", "M_SLOW"],
            routings=[
                RoutingAlternative(
                    machine_id="M_FAST", duration=Duration(minutes=30)
                ),
                RoutingAlternative(
                    machine_id="M_SLOW", duration=Duration(minutes=120)
                ),
            ],
        )
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="PROD",
            quantity=1,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[op],
        )
        context = _ctx([wo])
        result = resolve_strategy(strategy_name).solve(context, Objective.default())

        assignment = result.schedule.assignments[0]
        assert assignment.operation_id == "OP1"
        # Forward greedy and CP-SAT should pick M_FAST for minimum makespan.
        # Backward should also land on M_FAST (latest possible end, shorter
        # duration → later start, same or better due-date fit).
        assert assignment.machine_id == "M_FAST"
        # Duration should be 30 minutes, not 120.
        actual_duration = (assignment.end - assignment.start).total_seconds() / 60
        assert actual_duration == pytest.approx(30, abs=1)


# --------------------------------------------------------------------------
# Per-routing resource requirements
# --------------------------------------------------------------------------


@pytest.mark.parametrize("strategy_name", ALL_STRATEGIES)
class TestPerRoutingResourceRequirements:
    """Two routings on different machines need different operator counts.
    The engine must respect the selected routing's requirements."""

    def test_routing_specific_resources_honoured(self, strategy_name):
        # M_FAST needs 2 operators; M_SLOW needs 1 operator.
        # Pool has 1 operator → M_FAST cannot run, must fall back to M_SLOW.
        op = Operation(
            id="OP1",
            work_order_id="WO1",
            sequence=1,
            name="OP1",
            duration=Duration(minutes=60),
            eligible_machine_ids=["M_FAST", "M_SLOW"],
            routings=[
                RoutingAlternative(
                    machine_id="M_FAST",
                    duration=Duration(minutes=30),
                    resource_requirements=(
                        ResourceRequirement(resource_id="OPR", units=2),
                    ),
                ),
                RoutingAlternative(
                    machine_id="M_SLOW",
                    duration=Duration(minutes=60),
                    resource_requirements=(
                        ResourceRequirement(resource_id="OPR", units=1),
                    ),
                ),
            ],
        )
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="PROD",
            quantity=1,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[op],
        )
        resources = [Resource(id="OPR", name="Operators", capacity=1)]
        context = _ctx([wo], resources=resources)
        result = resolve_strategy(strategy_name).solve(context, Objective.default())

        assignment = result.schedule.assignments[0]
        # Only M_SLOW is feasible with 1 operator.
        assert assignment.machine_id == "M_SLOW"
        actual_duration = (assignment.end - assignment.start).total_seconds() / 60
        assert actual_duration == pytest.approx(60, abs=1)


# --------------------------------------------------------------------------
# Per-routing setup times
# --------------------------------------------------------------------------


@pytest.mark.parametrize("strategy_name", ALL_STRATEGIES)
class TestPerRoutingSetupTimes:
    """Different routings can declare different setup times."""

    def test_routing_setup_time_applied(self, strategy_name):
        # M_FAST: 30min run + 20min setup = 50min total
        # M_SLOW: 60min run + 0min setup = 60min total
        # Engine should pick M_FAST (50 < 60).
        op = Operation(
            id="OP1",
            work_order_id="WO1",
            sequence=1,
            name="OP1",
            duration=Duration(minutes=60),
            eligible_machine_ids=["M_FAST", "M_SLOW"],
            routings=[
                RoutingAlternative(
                    machine_id="M_FAST",
                    duration=Duration(minutes=30),
                    setup_time=Duration(minutes=20),
                ),
                RoutingAlternative(
                    machine_id="M_SLOW",
                    duration=Duration(minutes=60),
                    setup_time=Duration(minutes=0),
                ),
            ],
        )
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="PROD",
            quantity=1,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[op],
        )
        context = _ctx([wo])
        result = resolve_strategy(strategy_name).solve(context, Objective.default())

        assignment = result.schedule.assignments[0]
        assert assignment.machine_id == "M_FAST"
        # setup_start to end should be ~50min
        total_occupancy = (
            assignment.end - assignment.setup_start
        ).total_seconds() / 60
        assert total_occupancy == pytest.approx(50, abs=1)


# --------------------------------------------------------------------------
# Legacy compatibility — no routings field
# --------------------------------------------------------------------------


@pytest.mark.parametrize("strategy_name", ALL_STRATEGIES)
class TestLegacyNoRoutingsField:
    """Operations without explicit routings work identically to before."""

    def test_legacy_flat_operation(self, strategy_name):
        # Plain old Operation with no routings — should run on M_FAST or
        # M_SLOW using the flat duration/setup_time.
        op = Operation(
            id="OP1",
            work_order_id="WO1",
            sequence=1,
            name="OP1",
            duration=Duration(minutes=45),
            setup_time=Duration(minutes=5),
            eligible_machine_ids=["M_FAST", "M_SLOW"],
        )
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="PROD",
            quantity=1,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[op],
        )
        context = _ctx([wo])
        result = resolve_strategy(strategy_name).solve(context, Objective.default())

        assignment = result.schedule.assignments[0]
        assert assignment.operation_id == "OP1"
        # Total occupancy (setup + run) should be 50 minutes (5 + 45).
        total = (assignment.end - assignment.setup_start).total_seconds() / 60
        assert total == pytest.approx(50, abs=1)


# --------------------------------------------------------------------------
# Multi-op work order with mixed routings
# --------------------------------------------------------------------------


@pytest.mark.parametrize("strategy_name", ALL_STRATEGIES)
class TestMultiOpMixedRoutings:
    """A work order where OP1 has explicit routings and OP2 uses the legacy
    flat model — both must schedule correctly with precedence."""

    def test_mixed_routing_and_flat_ops(self, strategy_name):
        op1 = Operation(
            id="OP1",
            work_order_id="WO1",
            sequence=1,
            name="OP1",
            duration=Duration(minutes=60),
            eligible_machine_ids=["M_FAST", "M_SLOW"],
            routings=[
                RoutingAlternative(
                    machine_id="M_FAST", duration=Duration(minutes=20)
                ),
                RoutingAlternative(
                    machine_id="M_SLOW", duration=Duration(minutes=60)
                ),
            ],
        )
        op2 = Operation(
            id="OP2",
            work_order_id="WO1",
            sequence=2,
            name="OP2",
            duration=Duration(minutes=30),
            eligible_machine_ids=["M_FAST", "M_SLOW"],
            dependencies=["OP1"],
        )
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="PROD",
            quantity=1,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[op1, op2],
        )
        context = _ctx([wo])
        result = resolve_strategy(strategy_name).solve(context, Objective.default())

        a1 = next(a for a in result.schedule.assignments if a.operation_id == "OP1")
        a2 = next(a for a in result.schedule.assignments if a.operation_id == "OP2")
        # Precedence must hold.
        assert a2.start >= a1.end
        # OP1 should run 20min on M_FAST.
        assert a1.machine_id == "M_FAST"
        dur1 = (a1.end - a1.start).total_seconds() / 60
        assert dur1 == pytest.approx(20, abs=1)
