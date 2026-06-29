from __future__ import annotations

from datetime import timedelta

from planiadvance_v2.domain.scheduling import (
    Objective,
    SchedulingContext,
    available_strategies,
    get_strategy_profile,
    resolve_strategy,
)
from tests.conftest import make_work_order


def test_infinite_strategy_is_registered():
    assert "infinite" in available_strategies()
    profile = get_strategy_profile("infinite")
    assert profile is not None
    assert profile.planning_mode == "rough_cut"


def test_infinite_capacity_allows_machine_overlap_for_rough_cut(
    horizon_start,
    horizon_end,
    standard_calendar,
    two_machines,
):
    work_orders = [
        make_work_order(
            "WO1",
            release=horizon_start,
            due=horizon_start + timedelta(days=2),
            ops=[("OP1", 60, ["M1"], 0)],
        ),
        make_work_order(
            "WO2",
            release=horizon_start,
            due=horizon_start + timedelta(days=2),
            ops=[("OP2", 60, ["M1"], 0)],
        ),
    ]
    context = SchedulingContext(
        horizon_start=horizon_start,
        horizon_end=horizon_end,
        work_orders=work_orders,
        machines=two_machines,
        calendars=[standard_calendar],
    )

    result = resolve_strategy("infinite").solve(context, Objective.default())

    assignments = sorted(result.schedule.assignments, key=lambda item: item.operation_id)
    assert result.solver_status == "rough_cut_feasible"
    assert result.diagnostics["capacity_mode"] == "infinite"
    assert assignments[0].machine_id == "M1"
    assert assignments[1].machine_id == "M1"
    assert assignments[0].start == assignments[1].start
