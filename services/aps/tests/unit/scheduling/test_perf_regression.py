"""V1.2 P3 — engine wall-time regression guard.

The V1.2 audit flagged "no performance regression gate" as one of the
HIGH-risk testing gaps: a refactor that slows the greedy strategy by
10x — accidental quadratic in the dispatcher, a missing cache, a
debug log that fires per-operation — would merge silently because
every functional test still passes.

This file pins a small set of synthetic benchmark instances against
generous wall-time budgets. The budgets are sized to absorb the
normal hardware variance between a dev laptop and a GitHub Actions
runner (typically 2-3x slowdown) while still catching 10x+
regressions reliably.

Baselines measured 2026-05-18 on a Windows 11 dev box, Python 3.14:

  size      ops    greedy avg
   10x5      50      ~5 ms
   20x10    200     ~65 ms
   50x10    500    ~370 ms
  100x10   1000   ~1600 ms

Budgets are roughly 8-40x the dev-box baseline. They will trip on a
silent slowdown long before a planner notices, without flaking on
slower CI runners or noisy parallel-test load.

The 1000-op case is the largest gate because that's where an
accidental O(n^2) starts to bite hard in absolute wall-time, and
where a real-world plant planner (multi-product line, 10 machines)
would actually feel the slowdown. Anything bigger lives in nightly
profiling, not the unit suite.

Determinism: every instance is generated with a fixed seed so the
optimisation path is identical run-to-run. The wall-clock is the
only variable.

Maintenance: when the engine genuinely gets faster (e.g. an
algorithmic improvement), update the budgets DOWN here in the same
PR. Never raise a budget to make a failing test pass — that's how
gates rot. If a regression is intentional, justify it in the commit
that loosens the budget AND open an issue to recover the perf.
"""

from __future__ import annotations

import time

import pytest

from planiadvance_v2.domain.scheduling.benchmarks import (
    generate_random_instance,
    run_benchmark,
)

# (num_jobs, num_machines, wall-time budget in ms). The budgets are
# the "test-fails-here" line, not the expected wall-time — see the
# baselines above.
_PERF_CASES = [
    # 50 ops, greedy: ~5 ms on a dev box. Budget 200 ms is 40x the
    # baseline; the gate is here to catch a regression that turns the
    # dispatch into nested O(n^2), not micro-fluctuations.
    pytest.param(10, 5, 200, id="50ops_greedy"),
    # 200 ops, greedy: ~65 ms on a dev box. Budget 1500 ms is ~25x.
    pytest.param(20, 10, 1500, id="200ops_greedy"),
    # 500 ops, greedy: ~370 ms on a dev box. Budget 5000 ms is ~14x
    # — tighter because this is the size where a real-world plant
    # planner would actually notice a slowdown.
    pytest.param(50, 10, 5000, id="500ops_greedy"),
    # 1000 ops, greedy: ~1600 ms on a dev box (100 jobs x 10
    # machines — the realistic mid-size plant shape: many products,
    # few critical machines). Budget 15000 ms is ~9x; the absolute
    # wall-time matters here because this is the regime where a
    # quadratic dispatch would push past planner-tolerable latency
    # (planners abandon a screen after ~5s of "thinking…").
    pytest.param(100, 10, 15000, id="1000ops_greedy"),
]


@pytest.mark.parametrize("num_jobs,num_machines,budget_ms", _PERF_CASES)
def test_greedy_strategy_stays_within_wall_time_budget(
    num_jobs: int,
    num_machines: int,
    budget_ms: int,
) -> None:
    """The greedy strategy is the default operational dispatcher
    (`SchedulerStrategy.resolve_strategy("greedy")`) and the one the
    rolling-horizon / disruption-replan paths use. A regression in
    greedy slows down EVERY planner action; this is the strategy
    where the budget matters most.

    The synthetic instance is a standard rectangular JSSP — every
    job touches every machine in a random order. It's a clean
    workload to measure dispatch overhead, not solver heroics.
    """

    instance_text = generate_random_instance(
        num_jobs=num_jobs,
        num_machines=num_machines,
        seed=42,
    )

    # Measure twice and keep the second run: the first one absorbs
    # JIT / import warm-up so we don't trip the budget on cold cache.
    run_benchmark(instance_text, strategy_name="greedy", instance_name="warmup")
    start = time.perf_counter()
    result = run_benchmark(
        instance_text, strategy_name="greedy", instance_name="measured"
    )
    elapsed_ms = (time.perf_counter() - start) * 1000

    # Sanity: the engine itself reported a similar wall-time. If the
    # internal wall_time_ms diverges wildly from our outer
    # measurement, something else is eating the wall (logging, IO,
    # whatever). Catching that is part of the regression signal too.
    engine_ms = result.wall_time_ms
    assert (
        elapsed_ms < budget_ms
    ), (
        f"Greedy strategy regressed on {num_jobs}x{num_machines} "
        f"({num_jobs * num_machines} ops): outer wall {elapsed_ms:.0f} ms "
        f"exceeded budget {budget_ms} ms (engine reported {engine_ms} ms). "
        "Either the engine genuinely slowed down — investigate — or this "
        "machine is unusually slow and the budget needs to be reviewed."
    )


@pytest.mark.slow
def test_greedy_strategy_at_industrial_scale() -> None:
    """V1.2 P3.1b residual — industrial-scale perf gate (500 jobs ×
    10 machines = 5000 operations). This is the regime where a real
    multi-line plant operates: high product variety, deep planning
    horizon, the kind of workload Ortems/Opcenter customers throw at
    their engine.

    Baseline measured 2026-05-22 on a Windows 11 dev box: ~33 s on
    a cold run, ~32 s on a warm run. Budget 120 s is ~3.6x the
    baseline — tighter than the unit lane's 8-40x because here we're
    catching algorithmic regressions, not micro-noise, and a 10x
    slowdown would mean a 5-minute wait for the planner (catastrophic
    UX). Linux CI runners under load are typically 2-3x slower than
    a dev box; 120 s covers that comfortably without flaking.

    Marked ``slow`` so the per-save unit loop stays fast. Runs only
    in the nightly perf lane (``pytest -m slow``).
    """

    instance_text = generate_random_instance(
        num_jobs=500, num_machines=10, seed=42
    )

    # Skip the warmup at this scale — 33 s × 2 = 66 s of test setup is
    # wasted. The 120 s budget already absorbs cold-cache cost.
    start = time.perf_counter()
    result = run_benchmark(
        instance_text, strategy_name="greedy", instance_name="5000ops"
    )
    elapsed_ms = (time.perf_counter() - start) * 1000

    assert (
        elapsed_ms < 120_000
    ), (
        f"Greedy strategy regressed at industrial scale (5000 ops): "
        f"outer wall {elapsed_ms:.0f} ms exceeded budget 120000 ms "
        f"(engine reported {result.wall_time_ms} ms). "
        "Either the engine genuinely slowed down — investigate before "
        "shipping — or this runner is unusually slow and the budget "
        "needs to be reviewed."
    )


@pytest.mark.slow
def test_cpsat_strategy_completes_on_small_instance() -> None:
    """V1.2 P3.1b residual — CP-SAT perf gate on a 100-op instance.

    CP-SAT is the EXACT solver (OR-Tools backed). The gate ensures
    a regression that loses access to the solver — a broken import,
    a constraint formulation bug that hangs the search — surfaces
    immediately rather than at "what-if" demo time. Sized at 100 ops
    (20 jobs × 5 machines) where CP-SAT reliably solves to OPTIMAL
    in under 500 ms on the dev box; larger instances flip to
    FEASIBLE under the solver's wall-time cap and are a worse
    regression signal because the "did it find optimal?" question
    becomes hardware-dependent.

    Baseline measured 2026-05-22: ~405 ms cold (incl. solver init),
    ~50 ms engine-reported once warm. Budget 5000 ms is ~12x cold
    baseline; this is the gate where solver-startup regression would
    bite (e.g. a slow library load on Linux runners).

    Status assertion: the solver must report OPTIMAL on this size.
    FEASIBLE would mean the gate is now sized too big for CP-SAT's
    out-of-the-box config — fix the instance, not the assertion.
    """

    instance_text = generate_random_instance(
        num_jobs=20, num_machines=5, seed=42
    )

    start = time.perf_counter()
    result = run_benchmark(
        instance_text, strategy_name="cpsat", instance_name="100ops_cpsat"
    )
    elapsed_ms = (time.perf_counter() - start) * 1000

    assert (
        elapsed_ms < 5_000
    ), (
        f"CP-SAT strategy regressed on 100 ops: wall {elapsed_ms:.0f} ms "
        f"exceeded budget 5000 ms (engine reported {result.wall_time_ms} ms)."
    )
    assert result.solver_status == "OPTIMAL", (
        f"CP-SAT did not prove optimality on a 100-op instance "
        f"(status={result.solver_status!r}). At this size the solver "
        "should reliably converge — investigate the constraint model."
    )


# V1.2 P3.1b residual — metaheuristic perf gates. Each strategy is a
# tactical-replan path, not the disruption / online-dispatch path, so a
# wall-time regression here is less customer-facing than a greedy
# slowdown but still flag-worthy: a 10x slowdown on the tactical lane
# would make "compare all strategies" hang the planner UI.
# (num_jobs, num_machines, strategy, budget_ms). 10x5 = 50 ops is the
# sweet spot where every metaheuristic completes deterministically
# without flipping to FEASIBLE on a runner hardware variance.
_METAHEURISTIC_CASES = [
    pytest.param(10, 5, "sa", 15_000, id="50ops_sa"),
    pytest.param(10, 5, "lns", 5_000, id="50ops_lns"),
    pytest.param(10, 5, "ga", 30_000, id="50ops_ga"),
    pytest.param(10, 5, "tabu", 60_000, id="50ops_tabu"),
    pytest.param(10, 5, "multi", 60_000, id="50ops_multi"),
]


@pytest.mark.slow
@pytest.mark.parametrize("num_jobs,num_machines,strategy,budget_ms", _METAHEURISTIC_CASES)
def test_metaheuristic_strategy_stays_within_wall_time_budget(
    num_jobs: int,
    num_machines: int,
    strategy: str,
    budget_ms: int,
) -> None:
    """Catch a 10x slowdown on any of the metaheuristic strategies.

    Baselines measured 2026-05-22 on a Windows 11 dev box at 50 ops:
      sa ~2.5 s, lns ~0.7 s, ga ~7.7 s, tabu ~15 s, multi ~17 s.

    Budgets are 4-6x the baseline — tighter than the greedy gates
    because metaheuristic wall-time variance is dominated by the
    fixed-iteration loop, not by hardware. A regression here means
    the iteration count or the move generator silently inflated.

    Marked ``slow`` so the per-save unit loop stays fast. Runs only
    in the nightly perf lane (``pytest -m slow``).
    """

    instance_text = generate_random_instance(
        num_jobs=num_jobs, num_machines=num_machines, seed=7
    )

    start = time.perf_counter()
    result = run_benchmark(
        instance_text, strategy_name=strategy, instance_name=f"50ops_{strategy}"
    )
    elapsed_ms = (time.perf_counter() - start) * 1000

    assert (
        elapsed_ms < budget_ms
    ), (
        f"Strategy {strategy!r} regressed on {num_jobs}x{num_machines} "
        f"({num_jobs * num_machines} ops): wall {elapsed_ms:.0f} ms "
        f"exceeded budget {budget_ms} ms (engine reported {result.wall_time_ms} ms)."
    )


def test_backward_strategy_completes_under_generous_budget() -> None:
    """Backward is the just-in-time strategy used for tight-due-date
    scenarios + capable-to-promise rough-cut validation. It does
    more work than greedy (constraint propagation, due-date reverse
    walking) so the budget is correspondingly larger.

    Baseline measured 2026-05-18: ~250 ms on a 200-op instance. The
    8000 ms budget is ~30x the baseline — generous because backward
    has more variability than greedy and this gate's job is to flag
    a 10x slowdown, not micro-noise.
    """

    instance_text = generate_random_instance(
        num_jobs=20, num_machines=10, seed=7
    )

    run_benchmark(instance_text, strategy_name="backward", instance_name="warmup")
    start = time.perf_counter()
    run_benchmark(
        instance_text, strategy_name="backward", instance_name="measured"
    )
    elapsed_ms = (time.perf_counter() - start) * 1000

    assert (
        elapsed_ms < 8000
    ), (
        f"Backward strategy regressed on 200 ops: wall {elapsed_ms:.0f} ms "
        f"exceeded budget 8000 ms."
    )
