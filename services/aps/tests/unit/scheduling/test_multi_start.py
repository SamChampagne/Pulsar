"""Tests for the Multi-Start ensemble strategy.

Covers:

* option validation — at least one config required.
* registry — the ``"multi"`` name resolves to the right class.
* feasibility — ensemble produces a valid schedule.
* quality — ensemble is at least as good as the worst individual run.
* diagnostics — winner label, all_runs, failures reported correctly.
* custom configs — user-specified strategy ensemble.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

import pytest

from planiadvance_v2.domain.entities import Machine, WorkingCalendar
from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.domain.scheduling import (
    MultiStartConfig,
    MultiStartOptions,
    MultiStartStrategy,
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

HORIZON_START = datetime(2026, 1, 5, 0, 0, 0)


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
    work_orders = []
    for i in range(4):
        work_orders.append(
            make_work_order(
                f"WO{i}",
                release=HORIZON_START,
                due=HORIZON_START + timedelta(days=2 + (i % 2)),
                ops=[
                    (f"O{i}-1", 60 + i * 10, ["M1", "M2"], 0),
                    (f"O{i}-2", 60 + i * 10, ["M1", "M2"], 0),
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


class TestMultiStartOptions:
    def test_defaults_pass_validation(self):
        MultiStartOptions()

    def test_rejects_empty_configs(self):
        with pytest.raises(ValidationError):
            MultiStartOptions(configs=())


# --------------------------------------------------------------------------
# Registry
# --------------------------------------------------------------------------


def test_multi_is_registered():
    assert "multi" in available_strategies()
    strategy = resolve_strategy("multi")
    assert isinstance(strategy, MultiStartStrategy)


# --------------------------------------------------------------------------
# Feasibility
# --------------------------------------------------------------------------


class TestMultiStartFeasibility:
    def test_all_operations_placed(self):
        ctx = _context()
        strategy = MultiStartStrategy(
            options=MultiStartOptions(
                configs=(
                    MultiStartConfig(strategy_name="greedy"),
                    MultiStartConfig(strategy_name="backward"),
                ),
            )
        )
        result = strategy.solve(ctx, Objective.default())
        expected = sum(len(wo.operations) for wo in ctx.work_orders)
        assert len(result.schedule.assignments) == expected

    def test_dependencies_respected(self):
        ctx = _context()
        strategy = MultiStartStrategy()
        result = strategy.solve(ctx, Objective.customer_first())
        ends = {a.operation_id: a.end for a in result.schedule.assignments}
        starts = {a.operation_id: a.start for a in result.schedule.assignments}
        for wo in ctx.work_orders:
            for op in wo.operations:
                for dep in op.dependencies:
                    assert ends[dep] <= starts[op.id]


# --------------------------------------------------------------------------
# Quality
# --------------------------------------------------------------------------


class TestMultiStartQuality:
    def test_at_least_as_good_as_greedy(self):
        ctx = _context()
        objective = Objective.customer_first()
        greedy = resolve_strategy("greedy").solve(ctx, objective)

        multi = MultiStartStrategy(
            options=MultiStartOptions(
                configs=(
                    MultiStartConfig(strategy_name="greedy"),
                    MultiStartConfig(strategy_name="sa"),
                    MultiStartConfig(strategy_name="tabu"),
                ),
            )
        ).solve(ctx, objective)

        # The ensemble picks the best, so it must be <= greedy.
        assert multi.objective_value <= greedy.objective_value

    def test_best_of_two_greedy_and_backward(self):
        ctx = _context()
        objective = Objective.default()

        greedy = resolve_strategy("greedy").solve(ctx, objective)
        backward = resolve_strategy("backward").solve(ctx, objective)
        expected_best = min(greedy.objective_value, backward.objective_value)

        multi = MultiStartStrategy(
            options=MultiStartOptions(
                configs=(
                    MultiStartConfig(strategy_name="greedy"),
                    MultiStartConfig(strategy_name="backward"),
                ),
            )
        ).solve(ctx, objective)

        assert multi.objective_value == expected_best


# --------------------------------------------------------------------------
# Diagnostics
# --------------------------------------------------------------------------


class TestMultiStartDiagnostics:
    def test_winner_label_reported(self):
        ctx = _context()
        result = MultiStartStrategy(
            options=MultiStartOptions(
                configs=(
                    MultiStartConfig(strategy_name="greedy", label="g1"),
                    MultiStartConfig(strategy_name="backward", label="b1"),
                ),
            )
        ).solve(ctx, Objective.default())
        diag = result.diagnostics
        assert diag["winner"] in ("g1", "b1")
        assert diag["num_runs"] == 2
        assert diag["num_failures"] == 0

    def test_all_runs_reported(self):
        ctx = _context()
        result = MultiStartStrategy(
            options=MultiStartOptions(
                configs=(
                    MultiStartConfig(strategy_name="greedy", label="run-A"),
                    MultiStartConfig(strategy_name="greedy", label="run-B"),
                ),
            )
        ).solve(ctx, Objective.default())
        labels = [r["label"] for r in result.diagnostics["all_runs"]]
        assert "run-A" in labels
        assert "run-B" in labels

    def test_strategy_name_is_multi(self):
        ctx = _context()
        result = MultiStartStrategy().solve(ctx, Objective.default())
        assert result.strategy_name == "multi"

    def test_failure_reported_for_bad_strategy(self):
        ctx = _context()
        result = MultiStartStrategy(
            options=MultiStartOptions(
                configs=(
                    MultiStartConfig(strategy_name="greedy", label="good"),
                    MultiStartConfig(strategy_name="nonexistent_xyz", label="bad"),
                ),
            )
        ).solve(ctx, Objective.default())
        diag = result.diagnostics
        assert diag["num_failures"] == 1
        assert diag["failures"][0][0] == "bad"
        assert diag["num_runs"] == 1
