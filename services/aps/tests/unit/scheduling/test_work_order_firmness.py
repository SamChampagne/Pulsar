"""V1.2 Cas 2 — WorkOrder.firmness drives scheduling priority.

These tests pin the contract that firm WOs win capacity contention
over forecast / tentative ones. The mechanism is two-fold:
  - Heuristics tiebreak by firmness rank (firm < forecast < tentative)
  - Objective function multiplies tardiness by a firmness weight
    (firm 1.0, forecast 0.3, tentative 0.1) so the optimiser is
    less aggressive about hitting forecast due dates.

Single-machine, two-WO setup with a deliberately tight capacity
window so only ONE WO can finish on time. The test verifies the
firm WO ALWAYS gets scheduled before the forecast one regardless
of which order they were submitted to the planner.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from datetime import time as dtime

from planiadvance_v2.domain.entities import (
    Machine,
    Operation,
    WorkingCalendar,
    WorkOrder,
)
from planiadvance_v2.domain.scheduling import SchedulingContext, resolve_strategy
from planiadvance_v2.domain.scheduling.objective import Objective, score_schedule
from planiadvance_v2.domain.value_objects import (
    Duration,
    Priority,
    Shift,
    WorkOrderFirmness,
)

HORIZON = datetime(2026, 6, 1, 0, 0, 0)


def _wo(
    wo_id: str,
    *,
    due_offset_hours: int,
    firmness: WorkOrderFirmness,
    priority: Priority = Priority.NORMAL,
) -> WorkOrder:
    operations = [
        Operation(
            id=f"{wo_id}-OP1",
            work_order_id=wo_id,
            sequence=1,
            name="op",
            duration=Duration(minutes=240),
            setup_time=Duration(minutes=0),
            eligible_machine_ids=["M1"],
        ),
    ]
    return WorkOrder(
        id=wo_id,
        name=wo_id,
        product_id=f"P-{wo_id}",
        quantity=1,
        release_date=HORIZON,
        due_date=HORIZON + timedelta(hours=due_offset_hours),
        operations=operations,
        priority=priority,
        firmness=firmness,
    )


def _context(work_orders: list[WorkOrder]) -> SchedulingContext:
    calendar = WorkingCalendar(
        id="CAL",
        name="24h",
        shifts=[
            Shift(weekday=w, start=dtime(0, 0), end=dtime(23, 59))
            for w in range(7)
        ],
    )
    machines = [Machine(id="M1", name="M1", calendar_id="CAL")]
    return SchedulingContext(
        work_orders=work_orders,
        machines=machines,
        calendars=[calendar],
        resources=[],
        inventory_items=[],
        supplies=[],
        horizon_start=HORIZON,
        horizon_end=HORIZON + timedelta(days=7),
    )


def test_edd_heuristic_orders_firm_before_forecast_on_equal_due_dates() -> None:
    """When two WOs share a due date, the firm one MUST schedule first.
    Without this tiebreak the engine picks arbitrarily and the
    planner sees a forecast order locked in ahead of a real customer
    commitment."""

    firm = _wo("WO-FIRM", due_offset_hours=24, firmness=WorkOrderFirmness.FIRM)
    forecast = _wo(
        "WO-FORECAST", due_offset_hours=24, firmness=WorkOrderFirmness.FORECAST
    )
    # Submit forecast FIRST so a regression that just keeps input
    # order would put forecast ahead. The heuristic must override.
    ctx = _context([forecast, firm])

    result = resolve_strategy("greedy").solve(ctx, Objective.customer_first())
    starts = {a.work_order_id: a.start for a in result.schedule.assignments}

    assert starts["WO-FIRM"] < starts["WO-FORECAST"], (
        f"Firm WO must start before forecast WO when due dates tie. "
        f"Got firm={starts['WO-FIRM']} forecast={starts['WO-FORECAST']}"
    )


def test_objective_weights_forecast_tardiness_lighter() -> None:
    """Two synthetic schedules: same lateness on the same op, but one
    schedule attributes it to a firm WO and the other to a forecast
    WO. The forecast scenario must score BETTER (lower penalty)
    because the engine should not fight as hard for forecast due
    dates."""

    firm = _wo("WO-X", due_offset_hours=2, firmness=WorkOrderFirmness.FIRM)
    forecast = _wo("WO-X", due_offset_hours=2, firmness=WorkOrderFirmness.FORECAST)

    # Build a single late assignment by hand (8h after due date).
    from planiadvance_v2.domain.entities import Schedule, ScheduledOperation

    late_end = firm.due_date + timedelta(hours=8)
    late_start = late_end - timedelta(hours=4)
    assignment = ScheduledOperation(
        operation_id="WO-X-OP1",
        work_order_id="WO-X",
        machine_id="M1",
        setup_start=late_start,
        start=late_start,
        end=late_end,
    )
    schedule = Schedule(id="sched-test", created_at=HORIZON, assignments=[assignment])

    obj = Objective.customer_first()
    firm_score = score_schedule(
        schedule, [firm], obj, horizon_start=HORIZON, baseline_schedule=None
    )
    forecast_score = score_schedule(
        schedule, [forecast], obj, horizon_start=HORIZON, baseline_schedule=None
    )
    assert forecast_score < firm_score, (
        f"Forecast tardiness must score lower than firm tardiness "
        f"on the same delay. Got firm={firm_score} forecast={forecast_score}"
    )


def test_tentative_weighted_even_lighter_than_forecast() -> None:
    """Hierarchy: firm > forecast > tentative. A tentative WO with
    the same lateness as a forecast WO must score LESS penalty
    than the forecast one (10 % vs 30 % weight)."""

    forecast = _wo("WO-Y", due_offset_hours=2, firmness=WorkOrderFirmness.FORECAST)
    tentative = _wo("WO-Y", due_offset_hours=2, firmness=WorkOrderFirmness.TENTATIVE)

    from planiadvance_v2.domain.entities import Schedule, ScheduledOperation

    late_end = forecast.due_date + timedelta(hours=10)
    assignment = ScheduledOperation(
        operation_id="WO-Y-OP1",
        work_order_id="WO-Y",
        machine_id="M1",
        setup_start=late_end - timedelta(hours=4),
        start=late_end - timedelta(hours=4),
        end=late_end,
    )
    schedule = Schedule(id="sched-test", created_at=HORIZON, assignments=[assignment])

    obj = Objective.customer_first()
    forecast_score = score_schedule(
        schedule, [forecast], obj, horizon_start=HORIZON, baseline_schedule=None
    )
    tentative_score = score_schedule(
        schedule, [tentative], obj, horizon_start=HORIZON, baseline_schedule=None
    )
    assert tentative_score < forecast_score


def test_default_firmness_is_firm_no_silent_demotion() -> None:
    """A WO constructed without an explicit firmness must default to
    FIRM. Otherwise legacy code that builds WOs (test fixtures,
    integration importers, CLI demos) would silently produce
    forecast / tentative WOs and demote real customer orders."""

    bare_op = Operation(
        id="WO-BARE-OP1",
        work_order_id="WO-BARE",
        sequence=1,
        name="op",
        duration=Duration(minutes=60),
        setup_time=Duration(minutes=0),
        eligible_machine_ids=["M1"],
    )
    bare_wo = WorkOrder(
        id="WO-BARE",
        name="bare",
        product_id="P",
        quantity=1,
        release_date=HORIZON,
        due_date=HORIZON + timedelta(hours=24),
        operations=[bare_op],
    )
    assert bare_wo.firmness == WorkOrderFirmness.FIRM
