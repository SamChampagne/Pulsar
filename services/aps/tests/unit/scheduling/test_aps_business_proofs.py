"""Business-proof tests: APS features influence end-to-end scheduling.

Each test in this module verifies that one advanced APS feature has a
**measurable impact** on the resulting schedule.  They are deliberately
minimal (1-2 work orders, 2 machines) so failures are easy to diagnose.

Tests are grouped in a single file because they share the same helpers
and together form a cohesive proof battery for a planner reviewing the
engine's industrial capabilities.

Non-redundancy notes
--------------------
* Resource enforcement at the engine level is already covered in
  ``test_cumulative_resources.py``; the test here proves the impact
  through the ``RunScheduling`` use-case pipeline.
* Transfer times at the engine level are covered in
  ``test_transfer_times.py``; the test here proves the delay flows
  through ``RunScheduling``.
* Lot-splitting mechanics are covered in ``test_lot_splitting.py``;
  the test here proves reassembly restores the parent work-order id
  through the full use-case.
* Setup-matrix *scheduling impact* is **new** — no existing test
  exercises a sequence-dependent transition through the engine.
* Maintenance-window *scheduling impact* is **new** — no existing test
  verifies that an operation is pushed past a maintenance window.
* Disruption persistence is covered in ``test_connected_wiring.py`` from
  a wiring angle; the test here proves the newly-created schedule
  contains the rush-order operation with post-disruption timing.
* Metadata round-trip is covered in ``test_connected_wiring.py``; the
  test here validates the full 5-field read-back through the dashboard
  in a single assertion.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

from planiadvance_v2.application.use_cases.compare_strategies import (
    CompareStrategies,
    CompareStrategiesInput,
)
from planiadvance_v2.application.use_cases.get_schedule_dashboard import (
    GetScheduleDashboard,
)
from planiadvance_v2.application.use_cases.handle_disruption import (
    DisruptionEvent,
    DisruptionType,
)
from planiadvance_v2.application.use_cases.run_disruption import (
    RunDisruption,
    RunDisruptionInput,
)
from planiadvance_v2.application.use_cases.run_scheduling import (
    RunScheduling,
    RunSchedulingInput,
)
from planiadvance_v2.domain.entities import (
    Machine,
    Operation,
    Resource,
    WorkingCalendar,
    WorkOrder,
)
from planiadvance_v2.domain.entities.operation import RoutingAlternative
from planiadvance_v2.domain.entities.resource import ResourceRequirement
from planiadvance_v2.domain.scheduling import Objective, SchedulingContext, resolve_strategy
from planiadvance_v2.domain.value_objects import (
    Duration,
    LotSizingPolicy,
    Priority,
    SetupMatrix,
    Shift,
    TimeWindow,
    TransferTimes,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryCalendarRepository,
    InMemoryMachineRepository,
    InMemoryResourceRepository,
    InMemoryScheduleRepository,
    InMemoryWorkOrderRepository,
)

# --------------------------------------------------------------------------
# Shared constants & helpers
# --------------------------------------------------------------------------

MONDAY = datetime(2026, 1, 5, 0, 0, 0)  # Monday
HORIZON_END = MONDAY + timedelta(days=7)


def _calendar() -> WorkingCalendar:
    return WorkingCalendar(
        id="CAL",
        name="Mon-Fri 08-17",
        shifts=[
            Shift(weekday=w, start=time(8, 0), end=time(17, 0)) for w in range(5)
        ],
    )


def _machines(count: int = 2, **overrides) -> list[Machine]:
    return [
        Machine(id=f"M{i}", name=f"M{i}", calendar_id="CAL", **overrides)
        for i in range(1, count + 1)
    ]


def _ctx(work_orders, *, machines=None, **kwargs):
    return SchedulingContext(
        horizon_start=MONDAY,
        horizon_end=HORIZON_END,
        work_orders=work_orders,
        machines=machines or _machines(),
        calendars=[_calendar()],
        **kwargs,
    )


# ==========================================================================
# 1. Resource conflict changes the real schedule
# ==========================================================================


class TestResourceConflictImpact:
    """Two WOs on different machines sharing a capacity-1 resource must be
    serialized — through the full RunScheduling pipeline."""

    def test_resource_constraint_serialises_parallel_ops(self):
        resource = Resource(id="TOOL", name="Shared Tool", capacity=1)
        wo_a = WorkOrder(
            id="WOA",
            name="WOA",
            product_id="PA",
            quantity=1,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="OPA",
                    work_order_id="WOA",
                    sequence=1,
                    name="OPA",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                    resource_requirements=[ResourceRequirement(resource_id="TOOL", units=1)],
                ),
            ],
        )
        wo_b = WorkOrder(
            id="WOB",
            name="WOB",
            product_id="PB",
            quantity=1,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="OPB",
                    work_order_id="WOB",
                    sequence=1,
                    name="OPB",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M2"],
                    resource_requirements=[ResourceRequirement(resource_id="TOOL", units=1)],
                ),
            ],
        )

        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([wo_a, wo_b]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            resources=InMemoryResourceRepository([resource]),
        )
        result = uc.execute(
            RunSchedulingInput(horizon_start=MONDAY, strategy="greedy", persist=False)
        )

        a = next(a for a in result.schedule.assignments if a.operation_id == "OPA")
        b = next(a for a in result.schedule.assignments if a.operation_id == "OPB")
        # Different machines but same tool → must be serialized.
        assert a.machine_id != b.machine_id
        earlier, later = sorted([a, b], key=lambda x: x.start)
        assert later.start >= earlier.end, (
            "Resource conflict did not serialize ops on different machines"
        )


# ==========================================================================
# 2. Transfer time delays cross-machine successor
# ==========================================================================


class TestTransferTimeImpact:
    """A 45-minute transfer cost between M1→M2 must delay the successor
    by at least 45 minutes, verified through the RunScheduling use case."""

    def test_transfer_delay_through_use_case(self):
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="P1",
            quantity=1,
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
                Operation(
                    id="OP2",
                    work_order_id="WO1",
                    sequence=2,
                    name="OP2",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M2"],
                    dependencies=["OP1"],
                ),
            ],
        )

        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
        )
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=MONDAY,
                strategy="greedy",
                transfer_times=TransferTimes(pairs={("M1", "M2"): 45}),
                persist=False,
            )
        )

        op1 = next(a for a in result.schedule.assignments if a.operation_id == "OP1")
        op2 = next(a for a in result.schedule.assignments if a.operation_id == "OP2")
        gap = op2.start - op1.end
        assert gap >= timedelta(minutes=45), (
            f"Transfer time not applied: gap={gap}, expected >= 45 min"
        )


# ==========================================================================
# 3. Lot sizing splits and reassembles correctly
# ==========================================================================


class TestLotSizingImpact:
    """A 200-unit WO with fixed(100) lot sizing must produce two sub-lots
    on different machines, and reassembly must restore the parent WO id.
    Tested through the full RunScheduling pipeline."""

    def test_lot_sizing_parallel_and_reassembled(self):
        wo = WorkOrder(
            id="WO-LOT",
            name="WO-LOT",
            product_id="P1",
            quantity=200,
            due_date=MONDAY + timedelta(days=5),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="OP1",
                    work_order_id="WO-LOT",
                    sequence=1,
                    name="OP1",
                    duration=Duration(minutes=120),
                    eligible_machine_ids=["M1", "M2"],
                ),
            ],
            lot_sizing=LotSizingPolicy.fixed(100),
        )

        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
        )
        result = uc.execute(
            RunSchedulingInput(horizon_start=MONDAY, strategy="greedy", persist=False)
        )

        # Two sub-lots should produce 2 assignments.
        assert len(result.schedule.assignments) == 2
        # After reassembly, all assignments belong to the parent WO.
        assert all(a.work_order_id == "WO-LOT" for a in result.schedule.assignments)
        # Sub-lots should run in parallel on different machines.
        machines_used = {a.machine_id for a in result.schedule.assignments}
        assert len(machines_used) == 2, "Lot splitting did not enable parallel execution"


# ==========================================================================
# 4. Setup matrix: sequence-dependent setup changes the schedule
# ==========================================================================


class TestSetupMatrixImpact:
    """When a machine has a setup matrix and operations declare families,
    the setup time depends on the actual sequence.  A changeover from
    family 'A' to family 'B' (30 min) must be longer than 'A' to 'A' (0 min),
    and this must show up as a real gap in the schedule."""

    def test_cross_family_setup_creates_gap(self):
        matrix = SetupMatrix(
            machine_id="M1",
            default_minutes=15,
            initial_minutes=5,
            transitions={("A", "A"): 0, ("A", "B"): 30, ("B", "A"): 20},
        )
        machine = Machine(id="M1", name="M1", calendar_id="CAL", setup_matrix=matrix)

        wo1 = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="P1",
            quantity=1,
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
                    setup_family="A",
                ),
            ],
            priority=Priority.URGENT,
        )
        wo2 = WorkOrder(
            id="WO2",
            name="WO2",
            product_id="P2",
            quantity=1,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="OP2",
                    work_order_id="WO2",
                    sequence=1,
                    name="OP2",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                    setup_family="B",
                ),
            ],
        )

        context = SchedulingContext(
            horizon_start=MONDAY,
            horizon_end=HORIZON_END,
            work_orders=[wo1, wo2],
            machines=[machine],
            calendars=[_calendar()],
        )
        result = resolve_strategy("greedy").solve(context, Objective.default())

        op1 = next(a for a in result.schedule.assignments if a.operation_id == "OP1")
        op2 = next(a for a in result.schedule.assignments if a.operation_id == "OP2")

        # OP1 runs first (higher priority / EDD equal → first in order).
        # OP1 has family 'A', machine's initial setup = 5 min.
        # OP2 has family 'B', transition A→B = 30 min.
        # So the gap between OP1.end and OP2.start must include the 30 min
        # setup (the setup_start is at OP1.end, and run starts 30 min later).
        assert op2.setup_start >= op1.end, "OP2 setup must start after OP1 ends"
        setup_duration = op2.start - op2.setup_start
        assert setup_duration >= timedelta(minutes=30), (
            f"Cross-family setup should be >= 30 min, got {setup_duration}"
        )

    def test_same_family_has_zero_setup(self):
        """Two ops with the same family should have 0-minute changeover."""
        matrix = SetupMatrix(
            machine_id="M1",
            default_minutes=15,
            initial_minutes=0,
            transitions={("A", "A"): 0, ("A", "B"): 30},
        )
        machine = Machine(id="M1", name="M1", calendar_id="CAL", setup_matrix=matrix)

        wo1 = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="P1",
            quantity=1,
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
                    setup_family="A",
                ),
            ],
            priority=Priority.URGENT,
        )
        wo2 = WorkOrder(
            id="WO2",
            name="WO2",
            product_id="P2",
            quantity=1,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="OP2",
                    work_order_id="WO2",
                    sequence=1,
                    name="OP2",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                    setup_family="A",
                ),
            ],
        )

        context = SchedulingContext(
            horizon_start=MONDAY,
            horizon_end=HORIZON_END,
            work_orders=[wo1, wo2],
            machines=[machine],
            calendars=[_calendar()],
        )
        result = resolve_strategy("greedy").solve(context, Objective.default())

        op1 = next(a for a in result.schedule.assignments if a.operation_id == "OP1")
        op2 = next(a for a in result.schedule.assignments if a.operation_id == "OP2")
        # Same family → 0-minute changeover → OP2 starts immediately after OP1.
        assert op2.start == op1.end, (
            f"Same-family ops should be back-to-back, gap={op2.start - op1.end}"
        )


# ==========================================================================
# 5. Maintenance window: no operation during downtime
# ==========================================================================


class TestMaintenanceWindowImpact:
    """A 4-hour maintenance window on Monday morning must push operations
    past the window — nothing may overlap it."""

    def test_operation_pushed_past_maintenance(self):
        # Maintenance blocks M1 from 08:00 to 12:00 on Monday.
        maint = TimeWindow(
            start=datetime(2026, 1, 5, 8, 0),
            end=datetime(2026, 1, 5, 12, 0),
        )
        machine_with_maint = Machine(
            id="M1", name="M1", calendar_id="CAL", maintenance_windows=[maint],
        )
        machine_clear = Machine(id="M2", name="M2", calendar_id="CAL")

        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="P1",
            quantity=1,
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

        context = SchedulingContext(
            horizon_start=MONDAY,
            horizon_end=HORIZON_END,
            work_orders=[wo],
            machines=[machine_with_maint, machine_clear],
            calendars=[_calendar()],
        )
        result = resolve_strategy("greedy").solve(context, Objective.default())

        op1 = next(a for a in result.schedule.assignments if a.operation_id == "OP1")
        # OP1 is only eligible on M1 → it must start after maintenance ends.
        assert op1.start >= maint.end, (
            f"Op scheduled during maintenance: start={op1.start}, "
            f"maintenance ends={maint.end}"
        )
        # The operation must not overlap the maintenance window at all.
        op_window = TimeWindow(start=op1.setup_start, end=op1.end)
        overlaps = op_window.start < maint.end and op_window.end > maint.start
        assert not overlaps, "Operation overlaps the maintenance window"

    def test_op_placed_on_clear_machine_when_other_blocked(self):
        """When M1 is blocked by maintenance but M2 is free, the op
        should land on M2 immediately (no delay)."""
        maint = TimeWindow(
            start=datetime(2026, 1, 5, 8, 0),
            end=datetime(2026, 1, 5, 17, 0),  # full day
        )
        machine_blocked = Machine(
            id="M1", name="M1", calendar_id="CAL", maintenance_windows=[maint],
        )
        machine_clear = Machine(id="M2", name="M2", calendar_id="CAL")

        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="P1",
            quantity=1,
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
            ],
        )

        context = SchedulingContext(
            horizon_start=MONDAY,
            horizon_end=HORIZON_END,
            work_orders=[wo],
            machines=[machine_blocked, machine_clear],
            calendars=[_calendar()],
        )
        result = resolve_strategy("greedy").solve(context, Objective.default())

        op1 = next(a for a in result.schedule.assignments if a.operation_id == "OP1")
        # M1 is blocked all day → greedy picks M2 where the op starts at 08:00.
        assert op1.machine_id == "M2"
        assert op1.start == datetime(2026, 1, 5, 8, 0)


# ==========================================================================
# 6. Compare: enriched context changes every compared run
# ==========================================================================


class TestCompareStrategiesImpact:
    """Compared strategies must honour the same enriched context.

    Here the measurable effect is a 45-minute cross-machine transfer:
    every compared strategy must delay the successor by at least that gap.
    """

    def test_compare_applies_transfer_delay_to_all_runs(self):
        wo = WorkOrder(
            id="WO-CMP",
            name="WO-CMP",
            product_id="P-CMP",
            quantity=1,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="CMP-1",
                    work_order_id="WO-CMP",
                    sequence=1,
                    name="CMP-1",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M1"],
                ),
                Operation(
                    id="CMP-2",
                    work_order_id="WO-CMP",
                    sequence=2,
                    name="CMP-2",
                    duration=Duration(minutes=60),
                    eligible_machine_ids=["M2"],
                    dependencies=["CMP-1"],
                ),
            ],
        )

        uc = CompareStrategies(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
        )
        result = uc.execute(
            CompareStrategiesInput(
                strategies=["greedy", "backward"],
                horizon_start=MONDAY,
                transfer_times=TransferTimes(pairs={("M1", "M2"): 45}),
                parallel=False,
            )
        )

        assert len(result.runs) == 2
        assert all(run.succeeded for run in result.runs)
        for run in result.runs:
            op1 = next(a for a in run.schedule.assignments if a.operation_id == "CMP-1")
            op2 = next(a for a in run.schedule.assignments if a.operation_id == "CMP-2")
            assert op2.start - op1.end >= timedelta(minutes=45), (
                f"{run.strategy} ignored the 45-minute transfer delay"
            )


# ==========================================================================
# 7. Preemption: RunScheduling preserves split execution and min chunk
# ==========================================================================


class TestPreemptibleImpact:
    """A long preemptible operation should be split by the real use case.

    This proves the preemption capability is not just present in the
    slot finder, but reaches the scheduled output returned by RunScheduling.
    """

    def test_run_scheduling_splits_long_preemptible_operation(self):
        wo = WorkOrder(
            id="WO-PREEMPT",
            name="WO-PREEMPT",
            product_id="P-PREEMPT",
            quantity=1,
            due_date=MONDAY + timedelta(days=5),
            release_date=MONDAY,
            operations=[
                Operation(
                    id="LONG",
                    work_order_id="WO-PREEMPT",
                    sequence=1,
                    name="LONG",
                    duration=Duration(minutes=720),
                    eligible_machine_ids=["M1"],
                    preemptible=True,
                    min_chunk=Duration(minutes=60),
                ),
            ],
        )

        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository([Machine(id="M1", name="M1", calendar_id="CAL")]),
            calendars=InMemoryCalendarRepository([_calendar()]),
        )
        result = uc.execute(
            RunSchedulingInput(horizon_start=MONDAY, strategy="greedy", persist=False)
        )

        assignment = next(a for a in result.schedule.assignments if a.operation_id == "LONG")
        assert assignment.is_preempted, "Expected a split schedule for the 12-hour operation"
        assert len(assignment.segments) >= 2
        assert assignment.productive_minutes == 720
        assert any(
            "operation(s) were split across multiple working windows." in h
            for h in result.summary.highlights
        )
        assert all(
            (segment.end - segment.start) >= timedelta(minutes=60)
            for segment in assignment.segments
        ), "A segment was shorter than the declared min_chunk"


# ==========================================================================
# 8. Routing alternatives: a feasible routing wins through the use case
# ==========================================================================


class TestRoutingAlternativeImpact:
    """Routing alternatives must affect the real scheduled choice.

    The faster route on M1 needs 2 operators, while the slower route on
    M2 needs only 1. With a pool capacity of 1, the engine must choose
    the slower but feasible routing through RunScheduling.
    """

    def test_use_case_picks_resource_feasible_routing(self):
        operators = Resource(id="OPR", name="Operators", capacity=1)
        wo = WorkOrder(
            id="WO-ROUTE",
            name="WO-ROUTE",
            product_id="P-ROUTE",
            quantity=1,
            due_date=MONDAY + timedelta(days=3),
            release_date=MONDAY,
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
                ),
            ],
        )

        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            resources=InMemoryResourceRepository([operators]),
        )
        result = uc.execute(
            RunSchedulingInput(horizon_start=MONDAY, strategy="greedy", persist=False)
        )

        assignment = next(
            a for a in result.schedule.assignments if a.operation_id == "ROUTE-1"
        )
        assert assignment.machine_id == "M2"
        assert assignment.end - assignment.start == timedelta(minutes=60)
        assert result.summary.scheduled_operation_count == 1
        assert any(
            "ROUTE-1 ran on M2 because M1 was rejected for resource_capacity."
            == highlight
            for highlight in result.summary.highlights
        )
        trace = result.diagnostics["decision_trace"][0]
        planner = result.diagnostics["planner_diagnostics"]
        assert trace["machine_id"] == "M2"
        assert trace["rejected_candidates"][0]["kind"] == "resource_capacity"
        assert planner["top_constraints"][0]["kind"] == "resource_capacity"
        assert planner["top_constraints"][0]["label"] == "Resource capacity"
        assert planner["key_decisions"][0]["reason"].endswith(
            "M1 was blocked by resource capacity."
        )
        assert planner["decision_cards"][0]["selected_reason_label"] == "Resource capacity"
        assert planner["decision_cards"][0]["selected_reason_text"].endswith(
            "M1 was blocked by resource capacity."
        )


# ==========================================================================
# 9. Disruption: new schedule with rush order, persisted as new run
# ==========================================================================


class TestDisruptionNewRun:
    """A rush-order disruption must produce a brand-new schedule that
    contains the rush operation, persisted with a different id."""

    def test_disruption_creates_new_run_with_rush_op(self):
        schedule_repo = InMemoryScheduleRepository()
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="P1",
            quantity=1,
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
            ],
        )

        # Initial scheduling run.
        uc_init = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )
        initial = uc_init.execute(
            RunSchedulingInput(horizon_start=MONDAY, strategy="greedy", persist=True)
        )

        # Disruption: rush order arrives at 10:00 Monday.
        now = datetime(2026, 1, 5, 10, 0, 0)
        rush = WorkOrder(
            id="RUSH",
            name="RUSH",
            product_id="P-RUSH",
            quantity=1,
            due_date=MONDAY + timedelta(days=1),
            release_date=now,
            priority=Priority.URGENT,
            operations=[
                Operation(
                    id="RUSH_OP",
                    work_order_id="RUSH",
                    sequence=1,
                    name="RUSH_OP",
                    duration=Duration(minutes=45),
                    eligible_machine_ids=["M1", "M2"],
                ),
            ],
        )

        uc = RunDisruption(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )
        result = uc.execute(
            RunDisruptionInput(
                event=DisruptionEvent(
                    disruption_type=DisruptionType.RUSH_ORDER,
                    timestamp=now,
                    rush_order=rush,
                ),
                schedule_id=initial.schedule.id,
                persist=True,
            )
        )

        # New schedule id, different from initial.
        assert result.schedule.id != initial.schedule.id
        # Both runs persisted.
        assert schedule_repo.get(initial.schedule.id) is not None
        assert schedule_repo.get(result.schedule.id) is not None
        # Rush operation present in the new schedule.
        op_ids = {a.operation_id for a in result.schedule.assignments}
        assert "RUSH_OP" in op_ids
        # Rush op starts no earlier than the disruption timestamp.
        rush_a = next(a for a in result.schedule.assignments if a.operation_id == "RUSH_OP")
        assert rush_a.start >= now


# ==========================================================================
# 10. Dashboard: metadata round-trip (strategy, status, objective, time, metrics)
# ==========================================================================


class TestDashboardMetadataRoundTrip:
    """All five metadata fields must survive the persist → dashboard read cycle."""

    def test_all_metadata_fields_readable(self):
        schedule_repo = InMemoryScheduleRepository()
        wo = WorkOrder(
            id="WO1",
            name="WO1",
            product_id="P1",
            quantity=1,
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
        )

        uc = RunScheduling(
            work_orders=InMemoryWorkOrderRepository([wo]),
            machines=InMemoryMachineRepository(_machines()),
            calendars=InMemoryCalendarRepository([_calendar()]),
            schedules=schedule_repo,
        )
        result = uc.execute(
            RunSchedulingInput(horizon_start=MONDAY, strategy="greedy", persist=True)
        )

        # Read back through the dashboard use case.
        dashboard = GetScheduleDashboard(
            schedules=schedule_repo,
            work_orders=InMemoryWorkOrderRepository([wo]),
        ).execute(result.schedule.id)

        # All 5 metadata fields must be populated.
        assert dashboard.strategy == "greedy"
        assert dashboard.solver_status == "feasible"
        assert dashboard.objective_value >= 0
        assert dashboard.wall_time_ms >= 0
        assert "makespan_minutes" in dashboard.metrics
        assert dashboard.summary.scheduled_operation_count == 2
        assert any("Critical path spans" in h for h in dashboard.summary.highlights)
        assert "on_time_ratio" in dashboard.metrics
        assert "planner_diagnostics" in dashboard.diagnostics
        assert isinstance(dashboard.diagnostics["planner_diagnostics"]["notes"], list)
        # Analysis (Gantt, critical path) must be populated.
        assert dashboard.analysis is not None
        assert len(dashboard.analysis.gantt) == 2
