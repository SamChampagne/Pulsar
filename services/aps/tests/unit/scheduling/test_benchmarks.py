"""OR-library / benchmark harness tests.

Tests the parser, random instance generator, and end-to-end benchmark
runs against the classic ft06 instance (Fisher & Thompson 6x6,
known optimum = 55).
"""

from __future__ import annotations

from planiadvance_v2.domain.scheduling.benchmarks import (
    BenchmarkResult,
    generate_random_instance,
    parse_standard_instance,
    run_benchmark,
)

# --------------------------------------------------------------------------
# Classic ft06 instance (Fisher & Thompson, 1963)
# 6 jobs x 6 machines, optimal makespan = 55
# --------------------------------------------------------------------------

FT06 = """\
6  6
2  1  0  3  1  6  3  7  5  3  4  6
1  8  2  5  4  10  5  10  0  10  3  4
2  5  3  4  5  8  0  9  1  1  4  7
1  5  0  5  2  5  3  3  4  8  5  9
2  9  1  3  4  5  5  4  0  3  3  1
1  3  3  3  5  9  0  10  4  4  2  1
"""

FT06_OPTIMUM = 55


# --------------------------------------------------------------------------
# Parser
# --------------------------------------------------------------------------


class TestParseStandardInstance:
    def test_ft06_dimensions(self):
        ctx, num_jobs, num_machines = parse_standard_instance(FT06)
        assert num_jobs == 6
        assert num_machines == 6
        assert len(ctx.work_orders) == 6
        assert len(ctx.machines) == 6

    def test_ft06_operations_per_job(self):
        ctx, _, _ = parse_standard_instance(FT06)
        for wo in ctx.work_orders:
            assert len(wo.operations) == 6

    def test_ft06_first_job_operations(self):
        ctx, _, _ = parse_standard_instance(FT06)
        job0 = ctx.work_orders[0]
        ops = job0.ordered_operations()
        # First op: machine 2, duration 1
        assert ops[0].eligible_machine_ids == ["M2"]
        assert ops[0].duration.minutes == 1
        # Second op: machine 0, duration 3
        assert ops[1].eligible_machine_ids == ["M0"]
        assert ops[1].duration.minutes == 3

    def test_ft06_dependencies_chain(self):
        ctx, _, _ = parse_standard_instance(FT06)
        for wo in ctx.work_orders:
            ops = wo.ordered_operations()
            for i, op in enumerate(ops):
                if i == 0:
                    assert op.dependencies == []
                else:
                    assert op.dependencies == [ops[i - 1].id]

    def test_comments_and_blank_lines_ignored(self):
        text = "# comment\n\n6  6\n" + "\n".join(FT06.strip().splitlines()[1:])
        ctx, num_jobs, num_machines = parse_standard_instance(text)
        assert num_jobs == 6
        assert num_machines == 6


# --------------------------------------------------------------------------
# Random instance generator
# --------------------------------------------------------------------------


class TestGenerateRandomInstance:
    def test_generates_valid_instance(self):
        text = generate_random_instance(num_jobs=5, num_machines=3, seed=42)
        ctx, num_jobs, num_machines = parse_standard_instance(text)
        assert num_jobs == 5
        assert num_machines == 3
        assert len(ctx.work_orders) == 5
        for wo in ctx.work_orders:
            assert len(wo.operations) == 3

    def test_deterministic_with_same_seed(self):
        a = generate_random_instance(num_jobs=4, num_machines=3, seed=7)
        b = generate_random_instance(num_jobs=4, num_machines=3, seed=7)
        assert a == b

    def test_different_seeds_differ(self):
        a = generate_random_instance(num_jobs=4, num_machines=3, seed=1)
        b = generate_random_instance(num_jobs=4, num_machines=3, seed=2)
        assert a != b


# --------------------------------------------------------------------------
# End-to-end benchmark run
# --------------------------------------------------------------------------


class TestRunBenchmark:
    def test_greedy_on_ft06(self):
        result = run_benchmark(
            FT06,
            strategy_name="greedy",
            instance_name="ft06",
            known_optimum=FT06_OPTIMUM,
        )
        assert isinstance(result, BenchmarkResult)
        assert result.instance_name == "ft06"
        assert result.strategy_name == "greedy"
        assert result.makespan_minutes >= FT06_OPTIMUM  # can't beat optimum
        assert result.known_optimum == FT06_OPTIMUM
        assert result.gap_percent is not None
        assert result.gap_percent >= 0
        assert result.num_jobs == 6
        assert result.num_machines == 6

    def test_backward_on_ft06(self):
        result = run_benchmark(
            FT06,
            strategy_name="backward",
            instance_name="ft06",
            known_optimum=FT06_OPTIMUM,
        )
        assert result.makespan_minutes >= FT06_OPTIMUM

    def test_cpsat_on_ft06(self):
        result = run_benchmark(
            FT06,
            strategy_name="cpsat",
            instance_name="ft06",
            known_optimum=FT06_OPTIMUM,
        )
        # CP-SAT should get close to or hit the optimum on ft06.
        assert result.makespan_minutes >= FT06_OPTIMUM
        # ft06 is small enough that CP-SAT should get within 20%.
        assert result.gap_percent is not None
        assert result.gap_percent <= 20

    def test_random_instance_all_strategies(self):
        text = generate_random_instance(num_jobs=8, num_machines=4, seed=99)
        for name in ["greedy", "backward", "cpsat"]:
            result = run_benchmark(text, strategy_name=name, instance_name="rand_8x4")
            assert result.solver_status in ("feasible", "OPTIMAL", "FEASIBLE")
            assert result.makespan_minutes > 0

    def test_gap_is_none_without_known_optimum(self):
        result = run_benchmark(FT06, strategy_name="greedy", instance_name="ft06")
        assert result.known_optimum is None
        assert result.gap_percent is None
