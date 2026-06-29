"""Tests for the Genetic Algorithm strategy.

Covers:

* option validation — population size, crossover/mutation rates, elitism.
* registry — the ``"ga"`` name resolves to the right class.
* feasibility — GA produces a schedule covering every operation and
  respecting dependencies.
* quality — GA never degrades below the greedy baseline on a
  lopsided instance where ordering matters.
* determinism — same seed produces identical results.
* crossover — Order Crossover (OX) produces valid permutations.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

import pytest

from planiadvance_v2.domain.entities import Machine, WorkingCalendar
from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.domain.scheduling import (
    GeneticAlgorithmOptions,
    GeneticAlgorithmStrategy,
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


class TestGeneticAlgorithmOptions:
    def test_defaults_pass_validation(self):
        GeneticAlgorithmOptions()

    def test_rejects_population_below_two(self):
        with pytest.raises(ValidationError):
            GeneticAlgorithmOptions(population_size=1)

    def test_rejects_zero_generations(self):
        with pytest.raises(ValidationError):
            GeneticAlgorithmOptions(num_generations=0)

    def test_rejects_crossover_out_of_range(self):
        with pytest.raises(ValidationError):
            GeneticAlgorithmOptions(crossover_rate=1.5)

    def test_rejects_mutation_out_of_range(self):
        with pytest.raises(ValidationError):
            GeneticAlgorithmOptions(mutation_rate=-0.1)

    def test_rejects_elite_ge_population(self):
        with pytest.raises(ValidationError):
            GeneticAlgorithmOptions(population_size=5, elite_count=5)

    def test_rejects_negative_elite(self):
        with pytest.raises(ValidationError):
            GeneticAlgorithmOptions(elite_count=-1)

    def test_rejects_tournament_below_two(self):
        with pytest.raises(ValidationError):
            GeneticAlgorithmOptions(tournament_size=1)


# --------------------------------------------------------------------------
# Registry
# --------------------------------------------------------------------------


def test_ga_is_registered():
    assert "ga" in available_strategies()
    strategy = resolve_strategy("ga")
    assert isinstance(strategy, GeneticAlgorithmStrategy)


# --------------------------------------------------------------------------
# Feasibility
# --------------------------------------------------------------------------


class TestGeneticAlgorithmFeasibility:
    def test_all_operations_placed(self):
        ctx = _context()
        strategy = GeneticAlgorithmStrategy(
            options=GeneticAlgorithmOptions(
                population_size=10,
                num_generations=5,
            )
        )
        result = strategy.solve(ctx, Objective.customer_first())
        expected = sum(len(wo.operations) for wo in ctx.work_orders)
        assert len(result.schedule.assignments) == expected
        assert result.solver_status == "feasible"

    def test_dependencies_respected(self):
        ctx = _context()
        strategy = GeneticAlgorithmStrategy(
            options=GeneticAlgorithmOptions(
                population_size=10,
                num_generations=5,
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
        result = GeneticAlgorithmStrategy().solve(ctx, Objective.default())
        assert len(result.schedule.assignments) == 1
        assert result.diagnostics["evaluations"] == 1
        assert result.diagnostics["generations"] == 0


# --------------------------------------------------------------------------
# Quality
# --------------------------------------------------------------------------


class TestGeneticAlgorithmQuality:
    def test_never_worse_than_greedy(self):
        ctx = _context()
        objective = Objective.customer_first()
        greedy = resolve_strategy("greedy").solve(ctx, objective)

        ga = GeneticAlgorithmStrategy(
            options=GeneticAlgorithmOptions(
                population_size=20,
                num_generations=15,
                seed=123,
            )
        ).solve(ctx, objective)

        assert ga.objective_value <= greedy.objective_value

    def test_reproducible_with_same_seed(self):
        ctx = _context()
        objective = Objective.customer_first()
        opts = GeneticAlgorithmOptions(
            population_size=15, num_generations=10, seed=7
        )
        run_a = GeneticAlgorithmStrategy(options=opts).solve(ctx, objective)
        run_b = GeneticAlgorithmStrategy(options=opts).solve(ctx, objective)
        assert run_a.objective_value == run_b.objective_value
        assert [a.operation_id for a in run_a.schedule.assignments] == [
            a.operation_id for a in run_b.schedule.assignments
        ]

    def test_diagnostics_report(self):
        ctx = _context()
        opts = GeneticAlgorithmOptions(
            population_size=10, num_generations=5
        )
        result = GeneticAlgorithmStrategy(options=opts).solve(
            ctx, Objective.customer_first()
        )
        diag = result.diagnostics
        assert diag["evaluations"] >= 1
        assert diag["generations"] == 5
        assert diag["population_size"] == 10
        assert diag["crossover_rate"] == 0.8
        assert diag["mutation_rate"] == 0.15


# --------------------------------------------------------------------------
# Order Crossover (OX) correctness
# --------------------------------------------------------------------------


class TestOrderCrossover:
    def test_ox_produces_valid_permutation(self):
        """OX child contains exactly the same elements as the parents."""
        parent_a = ["A", "B", "C", "D", "E", "F", "G"]
        parent_b = ["E", "F", "G", "A", "B", "C", "D"]
        rng = __import__("random").Random(42)
        child = GeneticAlgorithmStrategy._order_crossover(parent_a, parent_b, rng)
        assert sorted(child) == sorted(parent_a)
        assert len(child) == len(parent_a)
        assert len(set(child)) == len(parent_a)  # no duplicates

    def test_ox_deterministic(self):
        parent_a = list("ABCDEFGH")
        parent_b = list("HGFEDCBA")
        rng1 = __import__("random").Random(99)
        rng2 = __import__("random").Random(99)
        child1 = GeneticAlgorithmStrategy._order_crossover(parent_a, parent_b, rng1)
        child2 = GeneticAlgorithmStrategy._order_crossover(parent_a, parent_b, rng2)
        assert child1 == child2
