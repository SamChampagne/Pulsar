"""Parity checks for the forward and backward greedy engines.

These tests do not force identical schedules. They prove something more
important for an APS engine: both strategies must honour the same core
industrial constraints, even if they place work at different moments.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from planiadvance_v2.domain.entities import (
    Machine,
    Operation,
    Resource,
    ResourceRequirement,
    RoutingAlternative,
    WorkOrder,
)
from planiadvance_v2.domain.scheduling import (
    FrozenAssignment,
    Objective,
    SchedulingContext,
    resolve_strategy,
)
from planiadvance_v2.domain.value_objects import (
    Duration,
    SetupMatrix,
    TimeWindow,
    TransferTimes,
)
from tests.conftest import make_work_order

STRATEGIES = ["greedy", "backward"]


def _ctx(work_orders, machines, calendar, start, end, *, resources=None, transfer_times=None, frozen=None):
    return SchedulingContext(
        horizon_start=start,
        horizon_end=end,
        work_orders=work_orders,
        machines=machines,
        calendars=[calendar],
        resources=resources or [],
        transfer_times=transfer_times or TransferTimes(),
        frozen_assignments=frozen or [],
    )


@pytest.mark.parametrize("strategy_name", STRATEGIES)
class TestStrategyConstraintParity:
    def test_transfer_times_delay_successor(
        self, strategy_name, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        wo = make_work_order(
            "WO-XFER",
            release=horizon_start,
            due=horizon_start + timedelta(days=3),
            ops=[
                ("CUT", 60, ["M1"], 0),
                ("ASM", 60, ["M2"], 0),
            ],
        )
        ctx = _ctx(
            [wo],
            two_machines,
            standard_calendar,
            horizon_start,
            horizon_end,
            transfer_times=TransferTimes(pairs={("M1", "M2"): 45}),
        )

        result = resolve_strategy(strategy_name).solve(ctx, Objective.default())
        op1, op2 = result.schedule.by_work_order("WO-XFER")

        assert op2.start - op1.end >= timedelta(minutes=45)

    def test_resource_feasible_routing_wins(
        self, strategy_name, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        operators = Resource(id="OPR", name="Operators", capacity=1)
        wo = WorkOrder(
            id="WO-ROUTE",
            name="WO-ROUTE",
            product_id="P-ROUTE",
            quantity=1,
            release_date=horizon_start,
            due_date=horizon_start + timedelta(days=2),
            operations=[
                Operation(
                    id="ROUTE-1",
                    work_order_id="WO-ROUTE",
                    sequence=1,
                    name="ROUTE-1",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1", "M2"],
                    routings=[
                        RoutingAlternative(
                            machine_id="M1",
                            duration=Duration(minutes=30),
                            resource_requirements=(
                                ResourceRequirement(resource_id="OPR", units=2),
                            ),
                        ),
                        RoutingAlternative(
                            machine_id="M2",
                            duration=Duration(minutes=60),
                            resource_requirements=(
                                ResourceRequirement(resource_id="OPR", units=1),
                            ),
                        ),
                    ],
                )
            ],
        )
        ctx = _ctx(
            [wo],
            two_machines,
            standard_calendar,
            horizon_start,
            horizon_end,
            resources=[operators],
        )

        result = resolve_strategy(strategy_name).solve(ctx, Objective.default())
        assignment = result.schedule.assignments[0]

        assert assignment.machine_id == "M2"

    def test_setup_constraint_creates_real_gap(
        self, strategy_name, horizon_start, horizon_end, standard_calendar
    ):
        matrix = SetupMatrix(
            machine_id="M1",
            default_minutes=30,
            initial_minutes=0,
            transitions={("A", "B"): 30},
        )
        machine = Machine(
            id="M1",
            name="M1",
            calendar_id=standard_calendar.id,
            setup_matrix=matrix,
        )
        wo = make_work_order(
            "WO-SETUP",
            release=horizon_start,
            due=horizon_start + timedelta(days=2),
            ops=[
                ("OP1", 60, ["M1"], 0),
                ("OP2", 60, ["M1"], 0),
            ],
        )
        wo.operations[0].setup_family = "A"
        wo.operations[1].setup_family = "B"

        ctx = _ctx([wo], [machine], standard_calendar, horizon_start, horizon_end)
        result = resolve_strategy(strategy_name).solve(ctx, Objective.default())
        op1, op2 = result.schedule.by_work_order("WO-SETUP")

        assert op2.start >= op1.end + timedelta(minutes=30)

    def test_maintenance_windows_are_respected(
        self, strategy_name, horizon_start, horizon_end, standard_calendar
    ):
        maintenance = TimeWindow(
            start=datetime(2026, 1, 5, 8, 0),
            end=datetime(2026, 1, 5, 12, 0),
        )
        machine = Machine(
            id="M1",
            name="M1",
            calendar_id=standard_calendar.id,
            maintenance_windows=[maintenance],
        )
        wo = make_work_order(
            "WO-MAINT",
            release=horizon_start,
            due=datetime(2026, 1, 5, 17, 0),
            ops=[("OP1", 120, ["M1"], 0)],
        )
        ctx = _ctx([wo], [machine], standard_calendar, horizon_start, horizon_end)

        result = resolve_strategy(strategy_name).solve(ctx, Objective.default())
        op = result.schedule.assignments[0]

        assert op.setup_start >= maintenance.end
        assert not (op.setup_start < maintenance.end and op.end > maintenance.start)

    def test_preemptible_operation_is_split(
        self, strategy_name, horizon_start, horizon_end, standard_calendar
    ):
        machine = Machine(id="M1", name="M1", calendar_id=standard_calendar.id)
        wo = WorkOrder(
            id="WO-PRE",
            name="WO-PRE",
            product_id="P-PRE",
            quantity=1,
            release_date=horizon_start,
            due_date=horizon_start + timedelta(days=2),
            operations=[
                Operation(
                    id="LONG",
                    work_order_id="WO-PRE",
                    sequence=1,
                    name="LONG",
                    duration=Duration(minutes=720),
                    eligible_machine_ids=["M1"],
                    preemptible=True,
                    min_chunk=Duration(minutes=60),
                )
            ],
        )
        ctx = _ctx([wo], [machine], standard_calendar, horizon_start, horizon_end)

        result = resolve_strategy(strategy_name).solve(ctx, Objective.default())
        assignment = result.schedule.assignments[0]

        assert assignment.is_preempted
        assert len(assignment.segments) >= 2
        assert assignment.productive_minutes == 720
        assert all(
            (segment.end - segment.start) >= timedelta(minutes=60)
            for segment in assignment.segments
        )

    def test_frozen_assignments_are_honoured(
        self, strategy_name, horizon_start, horizon_end, standard_calendar
    ):
        machine = Machine(id="M1", name="M1", calendar_id=standard_calendar.id)
        wo = make_work_order(
            "WO-FROZEN",
            release=horizon_start,
            due=horizon_start + timedelta(days=3),
            ops=[
                ("OP1", 60, ["M1"], 0),
                ("OP2", 60, ["M1"], 0),
            ],
        )
        frozen = FrozenAssignment(
            operation_id="OP2",
            work_order_id="WO-FROZEN",
            machine_id="M1",
            setup_start=horizon_start + timedelta(hours=14),
            start=horizon_start + timedelta(hours=14),
            end=horizon_start + timedelta(hours=15),
        )
        ctx = _ctx(
            [wo],
            [machine],
            standard_calendar,
            horizon_start,
            horizon_end,
            frozen=[frozen],
        )

        result = resolve_strategy(strategy_name).solve(ctx, Objective.default())
        assignments = {a.operation_id: a for a in result.schedule.assignments}

        assert assignments["OP2"].setup_start == frozen.setup_start
        assert assignments["OP2"].start == frozen.start
        assert assignments["OP2"].end == frozen.end
        assert assignments["OP1"].end <= frozen.setup_start
