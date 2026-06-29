"""Tests for the Simulated Annealing strategy.

Four angles:

* option validation — cooling rate in (0, 1), positive temperature etc.
* registry — the ``"sa"`` name resolves to the right class.
* feasibility — SA produces a schedule whose assignments cover every
  operation and do not violate dependencies.
* quality — SA never degrades the initial greedy baseline on a
  deliberately lopsided instance where dispatching order matters.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

import pytest

from planiadvance_v2.domain.entities import Machine, WorkingCalendar
from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.domain.scheduling import (
    Objective,
    SchedulingContext,
    SimulatedAnnealingOptions,
    SimulatedAnnealingStrategy,
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
        shifts=[Shift(weekday=w, start=time(8, 0), end=time(17, 0)) for w in range(5)],
    )


def _machines() -> list[Machine]:
    return [
        Machine(id="M1", name="M1", calendar_id="CAL"),
        Machine(id="M2", name="M2", calendar_id="CAL"),
    ]


def _workload():
    """Five mixed-priority 3-op work orders sharing two identical machines.

    The lopsided priorities (URGENT interleaved with NORMAL) give SA
    room to find an ordering that the default EDD cannot discover.
    """
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


class TestSimulatedAnnealingOptions:
    def test_defaults_pass_validation(self):
        SimulatedAnnealingOptions()

    def test_rejects_non_positive_temperature(self):
        with pytest.raises(ValidationError):
            SimulatedAnnealingOptions(initial_temperature=0)
        with pytest.raises(ValidationError):
            SimulatedAnnealingOptions(initial_temperature=-1)

    def test_rejects_out_of_range_cooling(self):
        with pytest.raises(ValidationError):
            SimulatedAnnealingOptions(cooling_rate=0)
        with pytest.raises(ValidationError):
            SimulatedAnnealingOptions(cooling_rate=1.0)
        with pytest.raises(ValidationError):
            SimulatedAnnealingOptions(cooling_rate=1.5)

    def test_rejects_zero_iterations(self):
        with pytest.raises(ValidationError):
            SimulatedAnnealingOptions(iterations_per_temperature=0)
        with pytest.raises(ValidationError):
            SimulatedAnnealingOptions(max_iterations=0)


# --------------------------------------------------------------------------
# Registry wiring
# --------------------------------------------------------------------------


def test_sa_is_registered():
    assert "sa" in available_strategies()
    strategy = resolve_strategy("sa")
    assert isinstance(strategy, SimulatedAnnealingStrategy)


# --------------------------------------------------------------------------
# Feasibility
# --------------------------------------------------------------------------


class TestSimulatedAnnealingFeasibility:
    def test_all_operations_are_placed(self):
        ctx = _context()
        # Use a small budget so the test stays fast.
        strategy = SimulatedAnnealingStrategy(
            options=SimulatedAnnealingOptions(
                max_iterations=60,
                iterations_per_temperature=10,
            )
        )
        result = strategy.solve(ctx, Objective.customer_first())
        expected = sum(len(wo.operations) for wo in ctx.work_orders)
        assert len(result.schedule.assignments) == expected
        assert result.solver_status == "feasible"

    def test_dependencies_are_respected(self):
        ctx = _context()
        strategy = SimulatedAnnealingStrategy(
            options=SimulatedAnnealingOptions(
                max_iterations=60, iterations_per_temperature=10
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

    def test_single_operation_context_bypasses_loop(self):
        """Empty search space → SA must return the greedy baseline
        unchanged without touching the Metropolis loop."""
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
        result = SimulatedAnnealingStrategy().solve(ctx, Objective.default())
        assert len(result.schedule.assignments) == 1
        assert result.diagnostics["accepted_moves"] == 0
        assert result.diagnostics["rejected_moves"] == 0
        assert result.diagnostics["evaluations"] == 1


# --------------------------------------------------------------------------
# Quality
# --------------------------------------------------------------------------


class TestSimulatedAnnealingQuality:
    def test_sa_never_worse_than_greedy_baseline(self):
        """SA accepts every improving move and only the baseline itself
        as fallback, so the reported objective_value must be <= the
        greedy cost on the same instance."""
        ctx = _context()
        objective = Objective.customer_first()
        greedy = resolve_strategy("greedy").solve(ctx, objective)

        sa = SimulatedAnnealingStrategy(
            options=SimulatedAnnealingOptions(
                max_iterations=150,
                iterations_per_temperature=15,
                seed=123,
            )
        ).solve(ctx, objective)

        assert sa.objective_value <= greedy.objective_value

    def test_sa_is_reproducible_with_same_seed(self):
        ctx = _context()
        objective = Objective.customer_first()
        opts = SimulatedAnnealingOptions(max_iterations=80, seed=7)
        run_a = SimulatedAnnealingStrategy(options=opts).solve(ctx, objective)
        run_b = SimulatedAnnealingStrategy(options=opts).solve(ctx, objective)
        assert run_a.objective_value == run_b.objective_value
        assert [a.operation_id for a in run_a.schedule.assignments] == [
            a.operation_id for a in run_b.schedule.assignments
        ]

    def test_diagnostics_report_move_counts(self):
        ctx = _context()
        result = SimulatedAnnealingStrategy(
            options=SimulatedAnnealingOptions(max_iterations=30)
        ).solve(ctx, Objective.customer_first())
        diag = result.diagnostics
        assert diag["accepted_moves"] + diag["rejected_moves"] == 30
        assert diag["evaluations"] == 31  # baseline + 30 candidates
        assert diag["final_temperature"] < diag["initial_temperature"]
