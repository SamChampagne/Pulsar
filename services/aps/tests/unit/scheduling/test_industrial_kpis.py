"""TDD tests for the J3 industrial KPIs added to ScheduleMetrics.

Five new KPIs:
- queue_time_minutes_avg: average wait between WO release_date and the
  start of its first scheduled operation.
- changeover_ratio: fraction of total booked machine time spent in
  setup (vs productive run).
- saturation_max / saturation_p95: aggregates over machine_utilization.
- wip_operation_count: operations actually in progress (actual_start
  set, actual_end not yet).
"""

from __future__ import annotations

from datetime import datetime, timedelta

from planiadvance_v2.domain.entities import (
    Operation,
    Schedule,
    ScheduledOperation,
    WorkOrder,
)
from planiadvance_v2.domain.scheduling.metrics import compute_metrics
from planiadvance_v2.domain.value_objects import Duration

_HORIZON_START = datetime(2026, 5, 11, 0, 0)
_HORIZON_END = datetime(2026, 5, 18, 0, 0)


def _op(
    op_id: str,
    wo_id: str,
    *,
    duration_min: int = 60,
    setup_min: int = 10,
    actual_start: datetime | None = None,
    actual_end: datetime | None = None,
    setup_family: str | None = None,
) -> Operation:
    return Operation(
        id=op_id,
        work_order_id=wo_id,
        sequence=1,
        name=op_id,
        duration=Duration(minutes=duration_min),
        setup_time=Duration(minutes=setup_min),
        eligible_machine_ids=["M-A"],
        dependencies=[],
        actual_start=actual_start,
        actual_machine_id="M-A" if actual_start is not None else None,
        actual_end=actual_end,
        setup_family=setup_family,
    )


def _wo(
    wo_id: str,
    *,
    release: datetime = datetime(2026, 5, 11, 0, 0),
    due: datetime = datetime(2026, 5, 18, 0, 0),
    operations: list[Operation] | None = None,
) -> WorkOrder:
    return WorkOrder(
        id=wo_id,
        name=f"WO {wo_id}",
        product_id=f"PROD-{wo_id}",
        quantity=1,
        due_date=due,
        release_date=release,
        operations=operations
        or [_op(f"{wo_id}-OP1", wo_id)],
    )


def _scheduled(
    op_id: str,
    wo_id: str,
    *,
    start: datetime,
    duration_min: int = 60,
    setup_min: int = 10,
    machine: str = "M-A",
) -> ScheduledOperation:
    return ScheduledOperation(
        operation_id=op_id,
        work_order_id=wo_id,
        machine_id=machine,
        setup_start=start - timedelta(minutes=setup_min),
        start=start,
        end=start + timedelta(minutes=duration_min),
    )


def _schedule(*assignments: ScheduledOperation) -> Schedule:
    return Schedule(
        id="sched-1",
        created_at=_HORIZON_START,
        assignments=list(assignments),
    )


# ---------------------------------------------------------------------------
# queue_time_minutes_avg
# ---------------------------------------------------------------------------


def test_queue_time_avg_uses_first_op_start_minus_release_per_wo():
    # WO-1 released at 09:00 starts at 09:30 -> 30 min queue
    # WO-2 released at 10:00 starts at 14:00 -> 240 min queue
    # avg = (30 + 240) / 2 = 135
    wos = [
        _wo("WO-1", release=datetime(2026, 5, 11, 9, 0)),
        _wo("WO-2", release=datetime(2026, 5, 11, 10, 0)),
    ]
    schedule = _schedule(
        _scheduled("WO-1-OP1", "WO-1", start=datetime(2026, 5, 11, 9, 30)),
        _scheduled("WO-2-OP1", "WO-2", start=datetime(2026, 5, 11, 14, 0)),
    )

    metrics = compute_metrics(
        schedule, wos, horizon_start=_HORIZON_START, horizon_end=_HORIZON_END
    )

    assert metrics.queue_time_minutes_avg == 135


def test_queue_time_avg_excludes_unscheduled_wos():
    # Only WO-1 is scheduled. WO-2 has no assignment - it shouldn't
    # contribute to the average.
    wos = [
        _wo("WO-1", release=datetime(2026, 5, 11, 9, 0)),
        _wo("WO-2", release=datetime(2026, 5, 11, 10, 0)),
    ]
    schedule = _schedule(
        _scheduled("WO-1-OP1", "WO-1", start=datetime(2026, 5, 11, 10, 0)),
    )

    metrics = compute_metrics(
        schedule, wos, horizon_start=_HORIZON_START, horizon_end=_HORIZON_END
    )

    assert metrics.queue_time_minutes_avg == 60


def test_queue_time_avg_zero_when_no_assignments():
    wos = [_wo("WO-1")]
    schedule = _schedule()  # empty

    metrics = compute_metrics(
        schedule, wos, horizon_start=_HORIZON_START, horizon_end=_HORIZON_END
    )

    assert metrics.queue_time_minutes_avg == 0


def test_queue_time_avg_uses_earliest_op_when_wo_has_multiple():
    op1 = _op("WO-1-OP1", "WO-1")
    op2 = _op("WO-1-OP2", "WO-1")
    wos = [_wo("WO-1", release=datetime(2026, 5, 11, 9, 0), operations=[op1, op2])]
    schedule = _schedule(
        _scheduled("WO-1-OP1", "WO-1", start=datetime(2026, 5, 11, 10, 0)),
        _scheduled("WO-1-OP2", "WO-1", start=datetime(2026, 5, 11, 11, 0)),
    )

    metrics = compute_metrics(
        schedule, wos, horizon_start=_HORIZON_START, horizon_end=_HORIZON_END
    )

    # First op starts at 10:00, released at 09:00 -> 60 min
    assert metrics.queue_time_minutes_avg == 60


# ---------------------------------------------------------------------------
# changeover_ratio
# ---------------------------------------------------------------------------


def test_changeover_ratio_is_setup_over_total():
    # Two assignments, each 10 min setup + 60 min run = 70 total.
    # changeover = 20 / 140 = 0.1428...
    wos = [_wo("WO-1"), _wo("WO-2")]
    schedule = _schedule(
        _scheduled(
            "WO-1-OP1", "WO-1", start=datetime(2026, 5, 11, 10, 0),
            duration_min=60, setup_min=10,
        ),
        _scheduled(
            "WO-2-OP1", "WO-2", start=datetime(2026, 5, 11, 12, 0),
            duration_min=60, setup_min=10,
        ),
    )

    metrics = compute_metrics(
        schedule, wos, horizon_start=_HORIZON_START, horizon_end=_HORIZON_END
    )

    assert abs(metrics.changeover_ratio - (20 / 140)) < 1e-6


def test_changeover_ratio_zero_when_no_setup():
    wos = [_wo("WO-1")]
    op = _op("WO-1-OP1", "WO-1", setup_min=0)
    wos = [_wo("WO-1", operations=[op])]
    schedule = _schedule(
        _scheduled(
            "WO-1-OP1", "WO-1", start=datetime(2026, 5, 11, 10, 0),
            duration_min=60, setup_min=0,
        ),
    )

    metrics = compute_metrics(
        schedule, wos, horizon_start=_HORIZON_START, horizon_end=_HORIZON_END
    )

    assert metrics.changeover_ratio == 0.0


def test_changeover_ratio_zero_for_empty_schedule():
    metrics = compute_metrics(
        _schedule(), [], horizon_start=_HORIZON_START, horizon_end=_HORIZON_END
    )

    assert metrics.changeover_ratio == 0.0


# ---------------------------------------------------------------------------
# saturation_max / saturation_p95
# ---------------------------------------------------------------------------


def test_saturation_max_is_max_machine_utilization():
    # 3 machines: M-A heavy, M-B medium, M-C light.
    # We rig durations to produce specific utilizations across a 7-day
    # horizon (10080 minutes). Assignment durations: 5040 (50%), 2520
    # (25%), 1008 (10%).
    wos = [
        _wo("WO-A"),
        _wo("WO-B"),
        _wo("WO-C"),
    ]
    schedule = _schedule(
        _scheduled(
            "WO-A-OP1", "WO-A", start=datetime(2026, 5, 11, 1, 0),
            duration_min=5030, setup_min=10, machine="M-A",
        ),
        _scheduled(
            "WO-B-OP1", "WO-B", start=datetime(2026, 5, 11, 1, 0),
            duration_min=2510, setup_min=10, machine="M-B",
        ),
        _scheduled(
            "WO-C-OP1", "WO-C", start=datetime(2026, 5, 11, 1, 0),
            duration_min=998, setup_min=10, machine="M-C",
        ),
    )

    metrics = compute_metrics(
        schedule, wos, horizon_start=_HORIZON_START, horizon_end=_HORIZON_END
    )

    assert metrics.saturation_max == max(metrics.machine_utilization.values())
    assert 0.49 < metrics.saturation_max < 0.51


def test_saturation_p95_equals_max_for_single_machine():
    wos = [_wo("WO-1")]
    schedule = _schedule(
        _scheduled(
            "WO-1-OP1", "WO-1", start=datetime(2026, 5, 11, 1, 0),
            duration_min=600, setup_min=10,
        ),
    )

    metrics = compute_metrics(
        schedule, wos, horizon_start=_HORIZON_START, horizon_end=_HORIZON_END
    )

    assert metrics.saturation_p95 == metrics.saturation_max


def test_saturation_zero_for_empty_schedule():
    metrics = compute_metrics(
        _schedule(), [], horizon_start=_HORIZON_START, horizon_end=_HORIZON_END
    )

    assert metrics.saturation_max == 0.0
    assert metrics.saturation_p95 == 0.0


# ---------------------------------------------------------------------------
# wip_operation_count
# ---------------------------------------------------------------------------


def test_wip_count_includes_only_in_progress_operations():
    op_in_progress = _op(
        "WO-1-OP1",
        "WO-1",
        actual_start=datetime(2026, 5, 11, 9, 0),
        actual_end=None,
    )
    op_completed = _op(
        "WO-1-OP2",
        "WO-1",
        actual_start=datetime(2026, 5, 11, 7, 0),
        actual_end=datetime(2026, 5, 11, 8, 0),
    )
    op_pending = _op("WO-1-OP3", "WO-1")
    wos = [
        _wo(
            "WO-1",
            operations=[op_in_progress, op_completed, op_pending],
        )
    ]

    metrics = compute_metrics(
        _schedule(),
        wos,
        horizon_start=_HORIZON_START,
        horizon_end=_HORIZON_END,
    )

    assert metrics.wip_operation_count == 1


def test_wip_count_zero_when_no_actuals():
    wos = [_wo("WO-1")]
    metrics = compute_metrics(
        _schedule(),
        wos,
        horizon_start=_HORIZON_START,
        horizon_end=_HORIZON_END,
    )

    assert metrics.wip_operation_count == 0


# ---------------------------------------------------------------------------
# as_dict
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# campaign_efficiency
# ---------------------------------------------------------------------------


def test_campaign_efficiency_one_when_all_same_family_chained():
    # 3 ops on M-A, all family RED. All chained -> 1.0
    op1 = _op("WO-1-OP1", "WO-1", setup_family="RED")
    op2 = _op("WO-2-OP1", "WO-2", setup_family="RED")
    op3 = _op("WO-3-OP1", "WO-3", setup_family="RED")
    wos = [
        _wo("WO-1", operations=[op1]),
        _wo("WO-2", operations=[op2]),
        _wo("WO-3", operations=[op3]),
    ]
    schedule = _schedule(
        _scheduled("WO-1-OP1", "WO-1", start=datetime(2026, 5, 11, 8, 0)),
        _scheduled("WO-2-OP1", "WO-2", start=datetime(2026, 5, 11, 10, 0)),
        _scheduled("WO-3-OP1", "WO-3", start=datetime(2026, 5, 11, 12, 0)),
    )

    metrics = compute_metrics(
        schedule, wos, horizon_start=_HORIZON_START, horizon_end=_HORIZON_END
    )

    assert metrics.campaign_efficiency == 1.0


def test_campaign_efficiency_zero_when_alternating_families():
    # 3 ops on M-A: RED, BLUE, RED. None has a same-family neighbour.
    op1 = _op("WO-1-OP1", "WO-1", setup_family="RED")
    op2 = _op("WO-2-OP1", "WO-2", setup_family="BLUE")
    op3 = _op("WO-3-OP1", "WO-3", setup_family="RED")
    wos = [
        _wo("WO-1", operations=[op1]),
        _wo("WO-2", operations=[op2]),
        _wo("WO-3", operations=[op3]),
    ]
    schedule = _schedule(
        _scheduled("WO-1-OP1", "WO-1", start=datetime(2026, 5, 11, 8, 0)),
        _scheduled("WO-2-OP1", "WO-2", start=datetime(2026, 5, 11, 10, 0)),
        _scheduled("WO-3-OP1", "WO-3", start=datetime(2026, 5, 11, 12, 0)),
    )

    metrics = compute_metrics(
        schedule, wos, horizon_start=_HORIZON_START, horizon_end=_HORIZON_END
    )

    assert metrics.campaign_efficiency == 0.0


def test_campaign_efficiency_partial_when_some_chained():
    # 4 ops on M-A: RED, RED, BLUE, BLUE. All 4 chained -> 1.0
    op1 = _op("WO-1-OP1", "WO-1", setup_family="RED")
    op2 = _op("WO-2-OP1", "WO-2", setup_family="RED")
    op3 = _op("WO-3-OP1", "WO-3", setup_family="BLUE")
    op4 = _op("WO-4-OP1", "WO-4", setup_family="BLUE")
    wos = [
        _wo("WO-1", operations=[op1]),
        _wo("WO-2", operations=[op2]),
        _wo("WO-3", operations=[op3]),
        _wo("WO-4", operations=[op4]),
    ]
    schedule = _schedule(
        _scheduled("WO-1-OP1", "WO-1", start=datetime(2026, 5, 11, 8, 0)),
        _scheduled("WO-2-OP1", "WO-2", start=datetime(2026, 5, 11, 10, 0)),
        _scheduled("WO-3-OP1", "WO-3", start=datetime(2026, 5, 11, 12, 0)),
        _scheduled("WO-4-OP1", "WO-4", start=datetime(2026, 5, 11, 14, 0)),
    )

    metrics = compute_metrics(
        schedule, wos, horizon_start=_HORIZON_START, horizon_end=_HORIZON_END
    )

    assert metrics.campaign_efficiency == 1.0


def test_campaign_efficiency_ignores_no_family_ops():
    # 3 ops on M-A: setup_family None for all. None chained -> 0.0
    op1 = _op("WO-1-OP1", "WO-1", setup_family=None)
    op2 = _op("WO-2-OP1", "WO-2", setup_family=None)
    op3 = _op("WO-3-OP1", "WO-3", setup_family=None)
    wos = [
        _wo("WO-1", operations=[op1]),
        _wo("WO-2", operations=[op2]),
        _wo("WO-3", operations=[op3]),
    ]
    schedule = _schedule(
        _scheduled("WO-1-OP1", "WO-1", start=datetime(2026, 5, 11, 8, 0)),
        _scheduled("WO-2-OP1", "WO-2", start=datetime(2026, 5, 11, 10, 0)),
        _scheduled("WO-3-OP1", "WO-3", start=datetime(2026, 5, 11, 12, 0)),
    )

    metrics = compute_metrics(
        schedule, wos, horizon_start=_HORIZON_START, horizon_end=_HORIZON_END
    )

    assert metrics.campaign_efficiency == 0.0


def test_campaign_efficiency_one_for_empty_schedule():
    # Empty schedule -> 1.0 (vacuous: no penalty when nothing to plan)
    metrics = compute_metrics(
        _schedule(), [], horizon_start=_HORIZON_START, horizon_end=_HORIZON_END
    )

    assert metrics.campaign_efficiency == 1.0


def test_campaign_efficiency_chains_per_machine_independently():
    # M-A: RED RED (both chained). M-B: BLUE GREEN (none chained).
    # Total chained = 2 / 4 = 0.5
    op1 = _op("WO-1-OP1", "WO-1", setup_family="RED")
    op2 = _op("WO-2-OP1", "WO-2", setup_family="RED")
    op3 = _op("WO-3-OP1", "WO-3", setup_family="BLUE")
    op4 = _op("WO-4-OP1", "WO-4", setup_family="GREEN")
    wos = [
        _wo("WO-1", operations=[op1]),
        _wo("WO-2", operations=[op2]),
        _wo("WO-3", operations=[op3]),
        _wo("WO-4", operations=[op4]),
    ]
    schedule = _schedule(
        _scheduled(
            "WO-1-OP1", "WO-1", start=datetime(2026, 5, 11, 8, 0), machine="M-A"
        ),
        _scheduled(
            "WO-2-OP1", "WO-2", start=datetime(2026, 5, 11, 10, 0), machine="M-A"
        ),
        _scheduled(
            "WO-3-OP1", "WO-3", start=datetime(2026, 5, 11, 8, 0), machine="M-B"
        ),
        _scheduled(
            "WO-4-OP1", "WO-4", start=datetime(2026, 5, 11, 10, 0), machine="M-B"
        ),
    )

    metrics = compute_metrics(
        schedule, wos, horizon_start=_HORIZON_START, horizon_end=_HORIZON_END
    )

    assert abs(metrics.campaign_efficiency - 0.5) < 1e-6


# ---------------------------------------------------------------------------
# as_dict
# ---------------------------------------------------------------------------


def test_as_dict_includes_new_kpis():
    wos = [_wo("WO-1")]
    schedule = _schedule(
        _scheduled("WO-1-OP1", "WO-1", start=datetime(2026, 5, 11, 10, 0)),
    )

    metrics = compute_metrics(
        schedule, wos, horizon_start=_HORIZON_START, horizon_end=_HORIZON_END
    )
    payload = metrics.as_dict()

    assert "queue_time_minutes_avg" in payload
    assert "changeover_ratio" in payload
    assert "saturation_max" in payload
    assert "saturation_p95" in payload
    assert "wip_operation_count" in payload
    assert "campaign_efficiency" in payload
