from __future__ import annotations

from datetime import datetime, timedelta

from planiadvance_v2.application.use_cases.stability_report import (
    build_stability_report,
)
from planiadvance_v2.domain.entities import Schedule, ScheduledOperation, WorkOrder
from planiadvance_v2.domain.scheduling import Objective, compute_metrics, score_schedule


def _assignment(
    operation_id: str,
    work_order_id: str,
    machine_id: str,
    start: datetime,
    duration_minutes: int,
) -> ScheduledOperation:
    end = start + timedelta(minutes=duration_minutes)
    return ScheduledOperation(
        operation_id=operation_id,
        work_order_id=work_order_id,
        machine_id=machine_id,
        setup_start=start,
        start=start,
        end=end,
    )


def test_compute_metrics_exposes_stability_against_baseline():
    horizon_start = datetime(2026, 1, 5, 0, 0)
    horizon_end = horizon_start + timedelta(days=2)
    baseline = Schedule(
        id="baseline",
        created_at=horizon_start,
        assignments=[
            _assignment("OP1", "WO1", "M1", datetime(2026, 1, 5, 8, 0), 60),
            _assignment("OP2", "WO1", "M2", datetime(2026, 1, 5, 10, 0), 60),
        ],
    )
    current = Schedule(
        id="current",
        created_at=horizon_start,
        assignments=[
            _assignment("OP1", "WO1", "M1", datetime(2026, 1, 5, 8, 0), 60),
            _assignment("OP2", "WO1", "M2", datetime(2026, 1, 5, 11, 30), 60),
            _assignment("OP3", "WO2", "M3", datetime(2026, 1, 5, 13, 0), 30),
        ],
    )
    work_orders = [
        WorkOrder(
            id="WO1",
            name="WO1",
            product_id="P1",
            quantity=1,
            release_date=horizon_start,
            due_date=horizon_start + timedelta(days=1),
            operations=[],
        ),
        WorkOrder(
            id="WO2",
            name="WO2",
            product_id="P2",
            quantity=1,
            release_date=horizon_start,
            due_date=horizon_start + timedelta(days=1),
            operations=[],
        ),
    ]

    metrics = compute_metrics(
        current,
        work_orders,
        horizon_start=horizon_start,
        horizon_end=horizon_end,
        baseline_schedule=baseline,
    ).as_dict()

    stability = metrics["stability"]
    assert stability["compared_operation_count"] == 2
    assert stability["unchanged_operation_count"] == 1
    assert stability["changed_operation_count"] == 1
    assert stability["moved_operation_count"] == 1
    assert stability["machine_change_count"] == 0
    assert stability["introduced_operation_count"] == 1
    assert stability["removed_operation_count"] == 0
    assert stability["total_start_shift_minutes"] == 90
    assert stability["max_start_shift_minutes"] == 90
    assert stability["stability_ratio"] == 0.3333


def test_score_schedule_penalizes_start_shift_and_machine_change_against_baseline():
    horizon_start = datetime(2026, 1, 5, 0, 0)
    baseline = Schedule(
        id="baseline",
        created_at=horizon_start,
        assignments=[
            _assignment("OP1", "WO1", "M1", datetime(2026, 1, 5, 8, 0), 60),
        ],
    )
    stable = Schedule(
        id="stable",
        created_at=horizon_start,
        assignments=[
            _assignment("OP1", "WO1", "M1", datetime(2026, 1, 5, 8, 0), 60),
        ],
    )
    nervous = Schedule(
        id="nervous",
        created_at=horizon_start,
        assignments=[
            _assignment("OP1", "WO1", "M2", datetime(2026, 1, 5, 9, 30), 60),
        ],
    )
    work_orders = [
        WorkOrder(
            id="WO1",
            name="WO1",
            product_id="P1",
            quantity=1,
            release_date=horizon_start,
            due_date=horizon_start + timedelta(days=1),
            operations=[],
        )
    ]

    objective = Objective(
        makespan=1,
        total_tardiness=10,
        start_shift_penalty=1,
        machine_change_penalty=60,
    )

    stable_score = score_schedule(
        stable,
        work_orders,
        objective,
        horizon_start=horizon_start,
        baseline_schedule=baseline,
    )
    nervous_score = score_schedule(
        nervous,
        work_orders,
        objective,
        horizon_start=horizon_start,
        baseline_schedule=baseline,
    )

    assert nervous_score > stable_score


def test_stability_report_explains_operation_level_changes():
    horizon_start = datetime(2026, 1, 5, 0, 0)
    baseline = Schedule(
        id="baseline",
        created_at=horizon_start,
        assignments=[
            _assignment("OP1", "WO1", "M1", datetime(2026, 1, 5, 8, 0), 60),
            _assignment("OP2", "WO1", "M2", datetime(2026, 1, 5, 10, 0), 60),
        ],
    )
    current = Schedule(
        id="current",
        created_at=horizon_start,
        assignments=[
            _assignment("OP1", "WO1", "M1", datetime(2026, 1, 5, 8, 0), 60),
            _assignment("OP2", "WO1", "M1", datetime(2026, 1, 5, 11, 0), 60),
            _assignment("OP3", "WO2", "M3", datetime(2026, 1, 5, 13, 0), 30),
        ],
    )

    report = build_stability_report(
        schedule=current,
        baseline_schedule=baseline,
        frozen_operation_ids={"OP1"},
        impacted_operation_ids={"OP2"},
    )

    assert report["available"] is True
    assert report["changed_operation_count"] == 2
    assert report["moved_operation_count"] == 1
    assert report["machine_change_count"] == 1
    assert report["introduced_operation_count"] == 1
    assert report["frozen_changed_count"] == 0
    assert report["non_impacted_changed_count"] == 1
    assert report["status"] == "nervous"
    by_op = {
        change["operation_id"]: change for change in report["operation_changes"]
    }
    assert by_op["OP2"]["start_shift_minutes"] == 60
    assert "machine_changed" in by_op["OP2"]["change_reasons"]
    assert "impacted" in by_op["OP2"]["change_reasons"]
    assert "introduced" in by_op["OP3"]["change_reasons"]
