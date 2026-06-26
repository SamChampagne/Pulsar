"""Strategy-level tests.

These exercise the pluggable strategy registry and every built-in backend
on the same battery of scenarios. Any new strategy should ideally pass
this suite unchanged — it is the contract a strategy must honour.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from planiadvance_v2.application.use_cases.planner_diagnostics import enrich_planner_diagnostics
from planiadvance_v2.domain.entities import (
    InventoryItem,
    Machine,
    Resource,
    ResourceRequirement,
    Schedule,
    ScheduledOperation,
    SupplyLot,
)
from planiadvance_v2.domain.entities.material import MaterialRequirement
from planiadvance_v2.domain.errors import InfeasibleScheduleError, ValidationError
from planiadvance_v2.domain.scheduling import (
    Objective,
    SchedulingContext,
    available_strategies,
    get_strategy_profile,
    resolve_strategy,
    score_schedule,
)
from planiadvance_v2.domain.value_objects import (
    SetupMatrix,
)
from tests.conftest import make_work_order

STRATEGIES = ["greedy", "cpsat"]


def _ctx(work_orders, machines, calendar, start, end, *, resources=None, baseline_schedule=None):
    return SchedulingContext(
        horizon_start=start,
        horizon_end=end,
        work_orders=work_orders,
        machines=machines,
        calendars=[calendar],
        resources=resources or [],
        baseline_schedule=baseline_schedule,
    )


class TestStrategyRegistry:
    def test_registry_exposes_builtin_strategies(self):
        names = available_strategies()
        assert "greedy" in names
        assert "hybrid" in names
        assert "cpsat" in names

    def test_resolve_unknown_strategy_raises(self):
        with pytest.raises(ValidationError):
            resolve_strategy("nope")

    def test_hybrid_profile_documents_forward_backward_mode(self):
        profile = get_strategy_profile("hybrid")
        assert profile is not None
        assert profile.planning_mode == "operational_portfolio"
        assert profile.optimization_mode == "forward_backward_heuristic"


def test_greedy_prefers_baseline_machine_when_candidates_tie(
    horizon_start, horizon_end, standard_calendar, two_machines
):
    work_order = make_work_order(
        "WO-STABLE",
        release=horizon_start,
        due=horizon_start + timedelta(days=2),
        ops=[("OP-STABLE", 60, ["M1", "M2"], 0)],
    )
    baseline_schedule = Schedule(
        id="baseline",
        created_at=horizon_start,
        assignments=[
            ScheduledOperation(
                operation_id="OP-STABLE",
                work_order_id="WO-STABLE",
                machine_id="M2",
                setup_start=horizon_start,
                start=horizon_start,
                end=horizon_start + timedelta(minutes=60),
            )
        ],
    )
    context = _ctx(
        [work_order],
        two_machines,
        standard_calendar,
        horizon_start,
        horizon_end,
        baseline_schedule=baseline_schedule,
    )
    result = resolve_strategy("greedy").solve(
        context,
        Objective(
            makespan=1,
            total_tardiness=10,
            start_shift_penalty=1,
            machine_change_penalty=60,
        ),
    )

    assert result.schedule.assignments[0].machine_id == "M2"


def test_hybrid_runs_forward_and_backward_then_reports_winner(
    horizon_start, horizon_end, standard_calendar, two_machines
):
    work_order = make_work_order(
        "WO-HYBRID",
        release=horizon_start,
        due=horizon_start + timedelta(days=2),
        ops=[("OP-HYBRID", 60, ["M1", "M2"], 0)],
    )
    ctx = _ctx([work_order], two_machines, standard_calendar, horizon_start, horizon_end)

    result = resolve_strategy("hybrid").solve(ctx, Objective.default())

    assert result.strategy_name == "hybrid"
    assert len(result.schedule.assignments) == 1
    assert result.diagnostics["hybrid_mode"] == "forward_backward"
    assert result.diagnostics["winner_strategy"] in {"greedy", "backward"}
    assert {run["strategy"] for run in result.diagnostics["all_runs"]} == {
        "greedy",
        "backward",
    }


@pytest.mark.parametrize("strategy_name", STRATEGIES)
class TestStrategyContract:
    """Behaviours that every backend must satisfy."""

    def test_places_every_operation(
        self, strategy_name, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        work_orders = [
            make_work_order(
                f"WO{i}",
                release=horizon_start,
                due=horizon_start + timedelta(days=5),
                ops=[
                    (f"A{i}", 60, ["M1", "M2"], 0),
                    (f"B{i}", 90, ["M1", "M2"], 0),
                ],
            )
            for i in range(3)
        ]
        ctx = _ctx(work_orders, two_machines, standard_calendar, horizon_start, horizon_end)
        result = resolve_strategy(strategy_name).solve(ctx, Objective.default())
        total_ops = sum(len(wo.operations) for wo in work_orders)
        assert len(result.schedule.assignments) == total_ops
        assert result.strategy_name == strategy_name

    def test_no_machine_conflict(
        self, strategy_name, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        work_orders = [
            make_work_order(
                f"WO{i}",
                release=horizon_start,
                due=horizon_start + timedelta(days=5),
                ops=[(f"OP{i}", 90, ["M1", "M2"], 0)],
            )
            for i in range(4)
        ]
        ctx = _ctx(work_orders, two_machines, standard_calendar, horizon_start, horizon_end)
        result = resolve_strategy(strategy_name).solve(ctx, Objective.default())

        for machine_id in ("M1", "M2"):
            windows = [
                a.full_window for a in result.schedule.by_machine(machine_id)
            ]
            for a, b in zip(windows, windows[1:], strict=False):
                assert not a.overlaps(b), (
                    f"{strategy_name}: overlap on {machine_id}: {a} vs {b}"
                )

    def test_precedence_is_respected(
        self, strategy_name, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        wo = make_work_order(
            "WO1",
            release=horizon_start,
            due=horizon_start + timedelta(days=3),
            ops=[
                ("OP1", 60, ["M1", "M2"], 0),
                ("OP2", 60, ["M1", "M2"], 0),
                ("OP3", 60, ["M1", "M2"], 0),
            ],
        )
        ctx = _ctx([wo], two_machines, standard_calendar, horizon_start, horizon_end)
        result = resolve_strategy(strategy_name).solve(ctx, Objective.default())
        ops = result.schedule.by_work_order("WO1")
        assert [a.operation_id for a in ops] == ["OP1", "OP2", "OP3"]
        assert ops[1].start >= ops[0].end
        assert ops[2].start >= ops[1].end

    def test_respects_release_date(
        self, strategy_name, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        release = horizon_start + timedelta(days=2)
        wo = make_work_order(
            "WO1",
            release=release,
            due=horizon_start + timedelta(days=10),
            ops=[("OP1", 60, ["M1"], 0)],
        )
        ctx = _ctx([wo], two_machines, standard_calendar, horizon_start, horizon_end)
        result = resolve_strategy(strategy_name).solve(ctx, Objective.default())
        assert result.schedule.assignments[0].start >= release

    def test_infeasible_horizon_raises_with_report(
        self, strategy_name, horizon_start, standard_calendar, two_machines
    ):
        wo = make_work_order(
            "WO1",
            release=horizon_start,
            due=horizon_start + timedelta(days=1),
            ops=[("OP1", 60, ["M1"], 0)],
        )
        ctx = _ctx(
            [wo], two_machines, standard_calendar,
            horizon_start, horizon_start + timedelta(hours=1),
        )
        with pytest.raises(InfeasibleScheduleError) as excinfo:
            resolve_strategy(strategy_name).solve(ctx, Objective.default())
        err = excinfo.value
        # Both strategies must surface a structured report so callers
        # can drive an actionable UI instead of parsing strings.
        assert err.report is not None
        assert err.report.strategy == strategy_name

    def test_strategy_result_reports_wall_time(
        self, strategy_name, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        wo = make_work_order(
            "WO1",
            release=horizon_start,
            due=horizon_start + timedelta(days=3),
            ops=[("OP1", 60, ["M1"], 0)],
        )
        ctx = _ctx([wo], two_machines, standard_calendar, horizon_start, horizon_end)
        result = resolve_strategy(strategy_name).solve(ctx, Objective.default())
        assert result.wall_time_ms >= 0
        assert result.objective_value == score_schedule(
            result.schedule,
            [wo],
            Objective.default(),
            horizon_start=horizon_start,
        )


@pytest.mark.parametrize("strategy_name", ["greedy", "backward"])
class TestStrategyInfeasibilitySuggestions:
    def test_resource_capacity_failure_suggests_capacity_or_routing(
        self, strategy_name, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        operators = Resource(id="OP_POOL", name="Operators", capacity=1)
        wo = make_work_order(
            "WO-RCAP",
            release=horizon_start,
            due=horizon_start + timedelta(days=2),
            ops=[("OP1", 120, ["M1"], 0)],
        )
        wo.operations[0].resource_requirements = [
            ResourceRequirement(resource_id="OP_POOL", units=2)
        ]
        ctx = _ctx(
            [wo],
            [two_machines[0]],
            standard_calendar,
            horizon_start,
            horizon_end,
            resources=[operators],
        )

        with pytest.raises(InfeasibleScheduleError) as excinfo:
            resolve_strategy(strategy_name).solve(ctx, Objective.default())

        report = excinfo.value.report
        assert report is not None
        assert any("secondary-resource capacity" in s for s in report.suggestions)


class TestCpSatSpecifics:
    """Tests that only make sense for the exact solver."""

    def test_cpsat_finds_optimal_on_small_instance(
        self, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        # A two-WO instance where optimal makespan requires parallelism.
        work_orders = [
            make_work_order(
                "WO1",
                release=horizon_start,
                due=horizon_start + timedelta(days=3),
                ops=[("A", 180, ["M1", "M2"], 0)],
            ),
            make_work_order(
                "WO2",
                release=horizon_start,
                due=horizon_start + timedelta(days=3),
                ops=[("B", 180, ["M1", "M2"], 0)],
            ),
        ]
        ctx = _ctx(
            work_orders, two_machines, standard_calendar, horizon_start, horizon_end
        )
        result = resolve_strategy("cpsat").solve(ctx, Objective.makespan_only())
        # The two operations must land on distinct machines (parallel).
        machine_ids = {a.machine_id for a in result.schedule.assignments}
        assert machine_ids == {"M1", "M2"}
        assert result.solver_status == "OPTIMAL"

    def test_cpsat_uses_warm_start(
        self, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        wo = make_work_order(
            "WO1",
            release=horizon_start,
            due=horizon_start + timedelta(days=3),
            ops=[("OP1", 60, ["M1", "M2"], 0)],
        )
        ctx = _ctx([wo], two_machines, standard_calendar, horizon_start, horizon_end)
        result = resolve_strategy("cpsat").solve(ctx, Objective.default())
        assert result.diagnostics.get("used_warm_start") is True

    def test_cpsat_prefers_baseline_machine_when_stability_weighted(
        self, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        wo = make_work_order(
            "WO-STABLE-CP",
            release=horizon_start,
            due=horizon_start + timedelta(days=3),
            ops=[("OP1", 60, ["M1", "M2"], 0)],
        )
        baseline_schedule = Schedule(
            id="baseline-cpsat",
            created_at=horizon_start,
            assignments=[
                ScheduledOperation(
                    operation_id="OP1",
                    work_order_id="WO-STABLE-CP",
                    machine_id="M2",
                    setup_start=horizon_start,
                    start=horizon_start,
                    end=horizon_start + timedelta(minutes=60),
                )
            ],
        )
        ctx = _ctx(
            [wo],
            two_machines,
            standard_calendar,
            horizon_start,
            horizon_end,
            baseline_schedule=baseline_schedule,
        )

        result = resolve_strategy("cpsat").solve(
            ctx,
            Objective(
                makespan=1,
                total_tardiness=10,
                start_shift_penalty=1,
                machine_change_penalty=60,
            ),
        )

        assert result.schedule.assignments[0].machine_id == "M2"

    def test_cpsat_delegates_material_constrained_context_to_greedy(
        self, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        wo = make_work_order(
            "WO-MAT",
            release=horizon_start,
            due=horizon_start + timedelta(days=3),
            ops=[("OP1", 60, ["M1", "M2"], 0)],
        )
        wo.operations[0].material_requirements = [
            MaterialRequirement(material_id="MAT-A", fixed_quantity=3.0)
        ]
        ctx = SchedulingContext(
            horizon_start=horizon_start,
            horizon_end=horizon_end,
            work_orders=[wo],
            machines=two_machines,
            calendars=[standard_calendar],
            inventory_items=[InventoryItem(material_id="MAT-A", quantity_on_hand=1.0)],
            supplies=[
                SupplyLot(
                    id="SUP-1",
                    material_id="MAT-A",
                    quantity=2.0,
                    available_at=horizon_start + timedelta(hours=6),
                )
            ],
        )

        result = resolve_strategy("cpsat").solve(ctx, Objective.default())

        assert result.strategy_name == "cpsat"
        assert result.solver_status == "DELEGATED_MATERIAL_GREEDY"
        assert result.diagnostics["delegated_strategy"] == "greedy"
        assert result.diagnostics["material_modeling_mode"] == "heuristic_delegate"
        assert result.diagnostics["material_reservations"][0]["allocations"]
        planner = enrich_planner_diagnostics(
            result.diagnostics,
            metrics={},
            strategy=result.strategy_name,
        )["planner_diagnostics"]
        assert any("delegated to greedy" in note.lower() for note in planner["notes"])


class TestSetupMatrix:
    def test_greedy_applies_sequence_dependent_setup(
        self, horizon_start, horizon_end, standard_calendar
    ):
        # Two ops on the same machine with different families: the second
        # must start at least 30 minutes after the first finishes.
        matrix = SetupMatrix(
            machine_id="M1",
            default_minutes=0,
            transitions={("A", "B"): 30},
        )
        m1 = Machine(
            id="M1", name="M1", calendar_id=standard_calendar.id, setup_matrix=matrix
        )
        wo = make_work_order(
            "WO",
            release=horizon_start,
            due=horizon_start + timedelta(days=3),
            ops=[
                ("OP1", 60, ["M1"], 0),
                ("OP2", 60, ["M1"], 0),
            ],
        )
        wo.operations[0].setup_family = "A"
        wo.operations[1].setup_family = "B"
        ctx = _ctx([wo], [m1], standard_calendar, horizon_start, horizon_end)
        result = resolve_strategy("greedy").solve(ctx, Objective.default())
        ops = result.schedule.by_work_order("WO")
        # OP2's setup runs between setup_start and start; the matrix says
        # the A->B transition takes 30 minutes.
        setup_duration = (ops[1].start - ops[1].setup_start).total_seconds() / 60
        assert setup_duration == 30
        # And OP2 cannot start productive work before OP1 finished + 30 min.
        assert (ops[1].start - ops[0].end).total_seconds() / 60 >= 30


class TestCumulativeResources:
    def test_cpsat_respects_resource_capacity(
        self, horizon_start, horizon_end, standard_calendar, two_machines
    ):
        # A pool of 1 operator shared by 2 WOs that would otherwise run
        # in parallel — capacity 1 should serialise them.
        operator = Resource(id="OP_POOL", name="Operators", capacity=1)
        work_orders = []
        for i in range(2):
            wo = make_work_order(
                f"WO{i}",
                release=horizon_start,
                due=horizon_start + timedelta(days=3),
                ops=[(f"OP{i}", 120, ["M1", "M2"], 0)],
            )
            wo.operations[0].resource_requirements = [
                ResourceRequirement(resource_id="OP_POOL", units=1)
            ]
            work_orders.append(wo)
        ctx = _ctx(
            work_orders,
            two_machines,
            standard_calendar,
            horizon_start,
            horizon_end,
            resources=[operator],
        )
        result = resolve_strategy("cpsat").solve(ctx, Objective.default())
        windows = sorted(
            (a.full_window for a in result.schedule.assignments),
            key=lambda w: w.start,
        )
        # With capacity 1, the two intervals must not overlap even though
        # they run on different machines.
        assert not windows[0].overlaps(windows[1])
