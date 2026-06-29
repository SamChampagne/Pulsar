"""Integration tests: verify engine features flow through the use case.

These tests don't hit HTTP — they call the use case directly with
in-memory repositories to verify that strategy selection, objective
configuration, feasibility checking, analysis, and lot splitting are
all wired into the scheduling pipeline output.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

from planiadvance_v2.application.use_cases.run_scheduling import (
    RunScheduling,
    RunSchedulingInput,
)
from planiadvance_v2.domain.entities import Machine, WorkingCalendar
from planiadvance_v2.domain.scheduling import Objective
from planiadvance_v2.domain.value_objects import Priority, Shift
from tests.conftest import make_work_order

HORIZON_START = datetime(2026, 1, 5, 0, 0, 0)


# --------------------------------------------------------------------------
# In-memory repository stubs
# --------------------------------------------------------------------------


class _InMemoryWorkOrderRepo:
    def __init__(self, items):
        self._items = items

    def list_all(self):
        return list(self._items)


class _InMemoryMachineRepo:
    def __init__(self, items):
        self._items = items

    def list_all(self):
        return list(self._items)


class _InMemoryCalendarRepo:
    def __init__(self, items):
        self._items = items

    def list_all(self):
        return list(self._items)


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
    return [
        make_work_order(
            "WO1",
            release=HORIZON_START,
            due=HORIZON_START + timedelta(days=3),
            ops=[
                ("OP1", 60, ["M1", "M2"], 0),
                ("OP2", 60, ["M1", "M2"], 0),
            ],
        ),
        make_work_order(
            "WO2",
            release=HORIZON_START,
            due=HORIZON_START + timedelta(days=2),
            ops=[("OP3", 90, ["M1", "M2"], 0)],
            priority=Priority.URGENT,
        ),
    ]


def _build_use_case():
    return RunScheduling(
        work_orders=_InMemoryWorkOrderRepo(_workload()),
        machines=_InMemoryMachineRepo(_machines()),
        calendars=_InMemoryCalendarRepo([_calendar()]),
    )


# --------------------------------------------------------------------------
# Strategy selection
# --------------------------------------------------------------------------


class TestStrategySelection:
    def test_greedy_strategy(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                strategy="greedy",
                persist=False,
            )
        )
        assert result.strategy == "greedy"
        assert result.solver_status == "feasible"

    def test_backward_strategy(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                strategy="backward",
                persist=False,
            )
        )
        assert result.strategy == "backward"

    def test_sa_strategy(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                strategy="sa",
                persist=False,
            )
        )
        assert result.strategy == "sa"

    def test_tabu_strategy(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                strategy="tabu",
                persist=False,
            )
        )
        assert result.strategy == "tabu"

    def test_ga_strategy(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                strategy="ga",
                persist=False,
            )
        )
        assert result.strategy == "ga"

    def test_lns_strategy(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                strategy="lns",
                persist=False,
            )
        )
        assert result.strategy == "lns"

    def test_cpsat_strategy(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                strategy="cpsat",
                persist=False,
            )
        )
        assert result.strategy == "cpsat"

    def test_multi_strategy(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                strategy="multi",
                persist=False,
            )
        )
        assert result.strategy == "multi"


# --------------------------------------------------------------------------
# Objective configuration
# --------------------------------------------------------------------------


class TestObjectiveConfiguration:
    def test_custom_objective(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                strategy="greedy",
                objective=Objective(makespan=1, total_tardiness=0),
                persist=False,
            )
        )
        assert result.objective_value >= 0

    def test_customer_first_objective(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                strategy="greedy",
                objective=Objective.customer_first(),
                persist=False,
            )
        )
        assert result.objective_value >= 0


# --------------------------------------------------------------------------
# Analysis in output
# --------------------------------------------------------------------------


class TestAnalysisInOutput:
    def test_analysis_present(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                strategy="greedy",
                persist=False,
            )
        )
        assert result.analysis is not None

    def test_critical_path_populated(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                persist=False,
            )
        )
        assert len(result.analysis.critical_path.operations) > 0
        assert result.analysis.critical_path.total_minutes > 0

    def test_bottleneck_populated(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                persist=False,
            )
        )
        assert result.analysis.bottleneck.bottleneck_machine_id in ("M1", "M2")
        assert len(result.analysis.bottleneck.machines) == 2

    def test_flow_times_populated(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                persist=False,
            )
        )
        assert len(result.analysis.flow_times) == 2
        wo_ids = {ft.work_order_id for ft in result.analysis.flow_times}
        assert wo_ids == {"WO1", "WO2"}

    def test_gantt_populated(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                persist=False,
            )
        )
        assert len(result.analysis.gantt) == 3  # OP1, OP2, OP3

    def test_analysis_as_dict(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                persist=False,
            )
        )
        d = result.analysis.as_dict()
        assert "critical_path" in d
        assert "bottleneck" in d
        assert "flow_times" in d
        assert "machine_utilization" in d


# --------------------------------------------------------------------------
# Feasibility in output
# --------------------------------------------------------------------------


class TestFeasibilityInOutput:
    def test_feasibility_present(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                persist=False,
            )
        )
        assert result.feasibility is not None

    def test_feasibility_clean(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                persist=False,
            )
        )
        assert result.feasibility.is_feasible
        assert result.feasibility.error_count == 0


# --------------------------------------------------------------------------
# Diagnostics in output
# --------------------------------------------------------------------------


class TestDiagnosticsInOutput:
    def test_diagnostics_present(self):
        uc = _build_use_case()
        result = uc.execute(
            RunSchedulingInput(
                horizon_start=HORIZON_START,
                strategy="sa",
                persist=False,
            )
        )
        assert isinstance(result.diagnostics, dict)
        # SA diagnostics include accepted/rejected moves.
        assert "accepted_moves" in result.diagnostics
