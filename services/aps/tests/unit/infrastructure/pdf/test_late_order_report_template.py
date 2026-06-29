"""Snapshot test for late_order_report.html.

Renders the template against a fixed LateOrderPayload covering all four
reasons and compares to the golden HTML. Regenerate the golden by
deleting the file and re-running the test (it will write a fresh
golden and fail once with a clear message).
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest

from planiadvance_v2.application.use_cases.reports.late_order_payload import (
    LateOrderLine,
    LateOrderPayload,
)
from planiadvance_v2.infrastructure.pdf.weasyprint_renderer import WeasyprintRenderer

_GOLDEN = (
    Path(__file__).parent.parent.parent.parent
    / "fixtures"
    / "golden"
    / "late_order_report.html"
)


def _payload() -> LateOrderPayload:
    return LateOrderPayload(
        organization_name="Plant QC",
        workspace_name="Plant A",
        schedule_id="sched-1",
        schedule_published_at=datetime(2026, 5, 7, 9, 14),
        generated_at=datetime(2026, 5, 7, 14, 32),
        horizon_start=datetime(2026, 5, 7),
        horizon_end=datetime(2026, 5, 21),
        lines=(
            LateOrderLine(
                work_order_ref="WO-1",
                work_order_name="Cabinet 12U",
                due_date=datetime(2026, 5, 4, 17, 0),
                planned_end=datetime(2026, 5, 6, 9, 0),
                lateness_minutes=2400,
                priority="HIGH",
                reason="material",
                recommended_action="expedite_material",
            ),
            LateOrderLine(
                work_order_ref="WO-2",
                work_order_name="Steel frame",
                due_date=datetime(2026, 5, 5, 17, 0),
                planned_end=datetime(2026, 5, 8, 12, 0),
                lateness_minutes=4140,
                priority="NORMAL",
                reason="capacity",
                recommended_action="add_overtime_or_reroute",
            ),
            LateOrderLine(
                work_order_ref="WO-3",
                work_order_name="Brackets",
                due_date=datetime(2026, 5, 6, 17, 0),
                planned_end=datetime(2026, 5, 7, 11, 0),
                lateness_minutes=1080,
                priority="LOW",
                reason="priority",
                recommended_action="review_priority",
            ),
            LateOrderLine(
                work_order_ref="WO-4",
                work_order_name="Casings",
                due_date=datetime(2026, 5, 1, 17, 0),
                planned_end=None,
                lateness_minutes=None,
                priority="NORMAL",
                reason="sequence",
                recommended_action="split_lot_or_reroute",
            ),
        ),
        total_late_count=4,
        total_lateness_minutes=7620,
        by_reason={"material": 1, "capacity": 1, "priority": 1, "sequence": 1},
    )


@pytest.fixture
def renderer():
    return WeasyprintRenderer()


def test_late_order_report_html_matches_golden(renderer):
    actual = renderer.render_html("late_order_report.html", _payload())

    if not _GOLDEN.exists():
        _GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        _GOLDEN.write_text(actual, encoding="utf-8")
        pytest.fail(
            f"Golden file generated at {_GOLDEN}. Re-run the test; it will pass."
        )

    expected = _GOLDEN.read_text(encoding="utf-8")
    assert actual == expected, (
        "Late-order template diverged from the golden snapshot. If the "
        f"change is intentional, replace {_GOLDEN} with the actual output "
        f"(printed below) and re-run.\n\n--- ACTUAL ---\n{actual}"
    )
