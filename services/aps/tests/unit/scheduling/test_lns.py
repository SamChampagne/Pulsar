"""Tests for the Large Neighbourhood Search (LNS) strategy.

Covers:

* option validation — fraction bounds, temperature, cooling rate.
* registry — the ``"lns"`` name resolves to the right class.
* feasibility — LNS produces a schedule covering every operation and
  respecting dependencies.
* quality — LNS never degrades below the greedy baseline.
* determinism — same seed produces identical results.
* destroy operators — each operator produces valid index sets.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

import pytest

from planiadvance_v2.domain.entities import Machine, WorkingCalendar
from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.domain.scheduling import (
    LNSOptions,
    LNSStrategy,
    Objective,
    SchedulingContext,
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


class TestLNSOptions:
    def test_defaults_pass_validation(self):
        LNSOptions()

    def test_rejects_zero_iterations(self):
        with pytest.raises(ValidationError):
            LNSOptions(max_iterations=0)

    def test_rejects_destroy_fraction_zero(self):
        with pytest.raises(ValidationError):
            LNSOptions(destroy_fraction=0.0)

    def test_rejects_destroy_fraction_one(self):
        with pytest.raises(ValidationError):
            LNSOptions(destroy_fraction=1.0)

    def test_rejects_negative_temperature(self):
        with pytest.raises(ValidationError):
            LNSOptions(accept_temperature=-1)

    def test_rejects_cooling_out_of_range(self):
        with pytest.raises(ValidationError):
            LNSOptions(cooling_rate=1.0)


# --------------------------------------------------------------------------
# Registry
# --------------------------------------------------------------------------


def test_lns_is_registered():
    assert "lns" in available_strategies()
    strategy = resolve_strategy("lns")
    assert isinstance(strategy, LNSStrategy)


# --------------------------------------------------------------------------
# Feasibility
# --------------------------------------------------------------------------


class TestLNSFeasibility:
    def test_all_operations_placed(self):
        ctx = _context()
        strategy = LNSStrategy(
            options=LNSOptions(max_iterations=15)
        )
        result = strategy.solve(ctx, Objective.customer_first())
        expected = sum(len(wo.operations) for wo in ctx.work_orders)
        assert len(result.schedule.assignments) == expected
        assert result.solver_status == "feasible"

    def test_dependencies_respected(self):
        ctx = _context()
        strategy = LNSStrategy(
            options=LNSOptions(max_iterations=15)
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
        result = LNSStrategy().solve(ctx, Objective.default())
        assert len(result.schedule.assignments) == 1
        assert result.diagnostics["evaluations"] == 1
        assert result.diagnostics["accepted_moves"] == 0


# --------------------------------------------------------------------------
# Quality
# --------------------------------------------------------------------------


class TestLNSQuality:
    def test_never_worse_than_greedy(self):
        ctx = _context()
        objective = Objective.customer_first()
        greedy = resolve_strategy("greedy").solve(ctx, objective)

        lns = LNSStrategy(
            options=LNSOptions(max_iterations=30, seed=123)
        ).solve(ctx, objective)

        assert lns.objective_value <= greedy.objective_value

    def test_reproducible_with_same_seed(self):
        ctx = _context()
        objective = Objective.customer_first()
        opts = LNSOptions(max_iterations=20, seed=7)
        run_a = LNSStrategy(options=opts).solve(ctx, objective)
        run_b = LNSStrategy(options=opts).solve(ctx, objective)
        assert run_a.objective_value == run_b.objective_value
        assert [a.operation_id for a in run_a.schedule.assignments] == [
            a.operation_id for a in run_b.schedule.assignments
        ]

    def test_diagnostics_report(self):
        ctx = _context()
        opts = LNSOptions(max_iterations=15)
        result = LNSStrategy(options=opts).solve(ctx, Objective.customer_first())
        diag = result.diagnostics
        assert diag["evaluations"] >= 1
        assert diag["accepted_moves"] >= 0
        assert "destroy_counts" in diag
        assert diag["destroy_fraction"] == 0.3

    def test_all_destroy_operators_used(self):
        """With enough iterations, all three destroy operators fire."""
        ctx = _context()
        # 6 iterations = 2 full cycles of the 3 operators.
        opts = LNSOptions(max_iterations=6, seed=42)
        result = LNSStrategy(options=opts).solve(ctx, Objective.default())
        counts = result.diagnostics["destroy_counts"]
        assert counts["random"] == 2
        assert counts["worst"] == 2
        assert counts["related"] == 2
