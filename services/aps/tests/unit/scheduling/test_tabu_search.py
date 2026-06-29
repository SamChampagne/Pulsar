"""Tests for the Tabu Search strategy.

Covers:

* option validation — positive integers, sensible defaults.
* registry — the ``"tabu"`` name resolves to the right class.
* feasibility — TS produces a schedule covering every operation and
  respecting dependencies.
* quality — TS never degrades below the greedy baseline on a
  lopsided instance where ordering matters.
* determinism — same seed produces identical results.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

import pytest

from planiadvance_v2.domain.entities import Machine, WorkingCalendar
from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.domain.scheduling import (
    Objective,
    SchedulingContext,
    TabuSearchOptions,
    TabuSearchStrategy,
    available_strategies,
    resolve_strategy,
)
from planiadvance_v2.domain.value_objects import Priority, Shift
from tests.conftest import make_work_order

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

HORIZON_START = datetime(2026, 1, 5, 0, 0, 0)  # Monday


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
    """Five mixed-priority 3-op work orders sharing two machines."""
    work_orders = []
    for i in range(5):
        work_orders.append(
            make_work_order(
                f"WO{i}",
                release=HORIZON_START,
                due=HORIZON_START + timedelta(days=2 + (i % 2)),
                ops=[
                    (f"O{i}-1", 60 + i * 10, ["M1", "M2"], 0),
                    (f"O{i}-2", 60 + i * 10, ["M1", "M2"], 0),
                    (f"O{i}-3", 60 + i * 10, ["M1", "M2"], 0),
                ],
                priority=Priority.URGENT if i % 2 else Priority.NORMAL,
            )
        )
    return work_orders


def _context():
    return SchedulingContext(
        horizon_start=HORIZON_START,
        horizon_end=HORIZON_START + timedelta(days=14),
        work_orders=_workload(),
        machines=_machines(),
        calendars=[_calendar()],
    )


# --------------------------------------------------------------------------
# Options validation
# --------------------------------------------------------------------------


class TestTabuSearchOptions:
    def test_defaults_pass_validation(self):
        TabuSearchOptions()

    def test_rejects_zero_iterations(self):
        with pytest.raises(ValidationError):
            TabuSearchOptions(max_iterations=0)

    def test_rejects_zero_neighbourhood(self):
        with pytest.raises(ValidationError):
            TabuSearchOptions(neighbourhood_size=0)

    def test_rejects_zero_tenure(self):
        with pytest.raises(ValidationError):
            TabuSearchOptions(tabu_tenure=0)

    def test_rejects_zero_stagnation(self):
        with pytest.raises(ValidationError):
            TabuSearchOptions(stagnation_limit=0)


# --------------------------------------------------------------------------
# Registry
# --------------------------------------------------------------------------


def test_tabu_is_registered():
    assert "tabu" in available_strategies()
    strategy = resolve_strategy("tabu")
    assert isinstance(strategy, TabuSearchStrategy)


# --------------------------------------------------------------------------
# Feasibility
# --------------------------------------------------------------------------


class TestTabuSearchFeasibility:
    def test_all_operations_placed(self):
        ctx = _context()
        strategy = TabuSearchStrategy(
            options=TabuSearchOptions(
                max_iterations=30,
                neighbourhood_size=5,
            )
        )
        result = strategy.solve(ctx, Objective.customer_first())
        expected = sum(len(wo.operations) for wo in ctx.work_orders)
        assert len(result.schedule.assignments) == expected
        assert result.solver_status == "feasible"

    def test_dependencies_respected(self):
        ctx = _context()
        strategy = TabuSearchStrategy(
            options=TabuSearchOptions(
                max_iterations=30,
                neighbourhood_size=5,
            )
        )
        result = strategy.solve(ctx, Objective.customer_first())
        ends = {a.operation_id: a.end for a in result.schedule.assignments}
        starts = {a.operation_id: a.start for a in result.schedule.assignments}
        for wo in ctx.work_orders:
            for op in wo.operations:
                for dep in op.dependencies:
                    assert ends[dep] <= starts[op.id], (
                        f"{op.id} starts before dep {dep}"
                    )

    def test_single_op_bypasses_search(self):
        ctx = SchedulingContext(
            horizon_start=HORIZON_START,
            horizon_end=HORIZON_START + timedelta(days=2),
            work_orders=[
                make_work_order(
                    "WO",
                    release=HORIZON_START,
                    due=HORIZON_START + timedelta(days=1),
                    ops=[("OP", 60, ["M1"], 0)],
                )
            ],
            machines=_machines(),
            calendars=[_calendar()],
        )
        result = TabuSearchStrategy().solve(ctx, Objective.default())
        assert len(result.schedule.assignments) == 1
        assert result.diagnostics["accepted_moves"] == 0
        assert result.diagnostics["evaluations"] == 1


# --------------------------------------------------------------------------
# Quality
# --------------------------------------------------------------------------


class TestTabuSearchQuality:
    def test_never_worse_than_greedy(self):
        ctx = _context()
        objective = Objective.customer_first()
        greedy = resolve_strategy("greedy").solve(ctx, objective)

        tabu = TabuSearchStrategy(
            options=TabuSearchOptions(
                max_iterations=60,
                neighbourhood_size=8,
                seed=123,
            )
        ).solve(ctx, objective)

        assert tabu.objective_value <= greedy.objective_value

    def test_reproducible_with_same_seed(self):
        ctx = _context()
        objective = Objective.customer_first()
        opts = TabuSearchOptions(max_iterations=40, seed=7)
        run_a = TabuSearchStrategy(options=opts).solve(ctx, objective)
        run_b = TabuSearchStrategy(options=opts).solve(ctx, objective)
        assert run_a.objective_value == run_b.objective_value
        assert [a.operation_id for a in run_a.schedule.assignments] == [
            a.operation_id for a in run_b.schedule.assignments
        ]

    def test_diagnostics_report_evaluations(self):
        ctx = _context()
        result = TabuSearchStrategy(
            options=TabuSearchOptions(max_iterations=20, neighbourhood_size=5)
        ).solve(ctx, Objective.customer_first())
        diag = result.diagnostics
        assert diag["evaluations"] >= 1  # at least the baseline
        assert diag["accepted_moves"] >= 0
        assert diag["restarts"] >= 0
