"""Snapshot test for wo_traveler.html.

Renders the template against a fixed payload covering planned ops,
an unplanned op, and the three coverage statuses (covered / short /
unknown). Regenerate the golden by deleting the file.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest

from planiadvance_v2.application.use_cases.reports.wo_traveler_payload import (
    WoTravelerMaterialLine,
    WoTravelerOperationLine,
    WoTravelerPayload,
)
from planiadvance_v2.infrastructure.pdf.weasyprint_renderer import WeasyprintRenderer

_GOLDEN = (
    Path(__file__).parent.parent.parent.parent
    / "fixtures"
    / "golden"
    / "wo_traveler.html"
)


def _payload() -> WoTravelerPayload:
    return WoTravelerPayload(
        organization_name="Plant QC",
        workspace_name="Plant A",
        schedule_id="sched-1",
        schedule_published_at=datetime(2026, 5, 7, 9, 14),
        generated_at=datetime(2026, 5, 7, 14, 32),
        work_order_ref="WO-IND-ALPHA",
        work_order_name="Cabinet 12U",
        product_id="PROD-CAB12",
        quantity=5,
        priority="HIGH",
        status="RELEASED",
        due_date=datetime(2026, 5, 10, 17, 0),
        release_date=datetime(2026, 5, 4, 8, 0),
        planned_start=datetime(2026, 5, 5, 8, 0),
        planned_end=datetime(2026, 5, 6, 11, 0),
        operations=(
            WoTravelerOperationLine(
                operation_id="OP-1",
                sequence=1,
                name="Cutting",
                eligible_machine_ids=("CNC-FAST", "CNC-FLEX"),
                planned_machine_id="CNC-FAST",
                planned_start=datetime(2026, 5, 5, 8, 0),
                planned_end=datetime(2026, 5, 5, 9, 30),
                setup_minutes=10,
                run_minutes=80,
                materials=(
                    WoTravelerMaterialLine(
                        material_id="RAW-AL",
                        required_quantity=2.50,
                        coverage_status="covered",
                    ),
                    WoTravelerMaterialLine(
                        material_id="STEEL",
                        required_quantity=1.00,
                        coverage_status="short",
                    ),
                ),
            ),
            WoTravelerOperationLine(
                operation_id="OP-2",
                sequence=2,
                name="Drilling",
                eligible_machine_ids=("CNC-FLEX",),
                planned_machine_id="CNC-FLEX",
                planned_start=datetime(2026, 5, 6, 10, 0),
                planned_end=datetime(2026, 5, 6, 11, 0),
                setup_minutes=5,
                run_minutes=55,
                materials=(
                    WoTravelerMaterialLine(
                        material_id="PAINT-RED",
                        required_quantity=0.50,
                        coverage_status="unknown",
                    ),
                ),
            ),
            WoTravelerOperationLine(
                operation_id="OP-3",
                sequence=3,
                name="QA",
                eligible_machine_ids=("QA-1",),
                planned_machine_id=None,
                planned_start=None,
                planned_end=None,
                setup_minutes=0,
                run_minutes=15,
                materials=(),
            ),
        ),
        total_setup_minutes=15,
        total_run_minutes=150,
        total_operation_count=3,
    )


@pytest.fixture
def renderer():
    return WeasyprintRenderer()


def test_wo_traveler_html_matches_golden(renderer):
    actual = renderer.render_html("wo_traveler.html", _payload())

    if not _GOLDEN.exists():
        _GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        _GOLDEN.write_text(actual, encoding="utf-8")
        pytest.fail(
            f"Golden file generated at {_GOLDEN}. Re-run the test; it will pass."
        )

    expected = _GOLDEN.read_text(encoding="utf-8")
    assert actual == expected, (
        "WO Traveler template diverged from the golden snapshot. If the "
        f"change is intentional, replace {_GOLDEN} with the actual output "
        f"(printed below) and re-run.\n\n--- ACTUAL ---\n{actual}"
    )
