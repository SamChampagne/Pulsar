"""Snapshot test for production_sheet.html (J2a).

Renders the template against a fixed ProductionSheetPayload and
compares the HTML against a golden file under
``tests/fixtures/golden/production_sheet.html``. On intentional
template changes, replace the golden file's content with the actual
rendered output.

Uses ``render_html`` only - no WeasyPrint binary needed, so this
runs everywhere (Linux, macOS, Windows without GTK).
"""

from __future__ import annotations

from datetime import date, datetime
from pathlib import Path

import pytest

from planiadvance_v2.application.use_cases.reports.production_sheet_payload import (
    ProductionSheetLine,
    ProductionSheetPayload,
)
from planiadvance_v2.infrastructure.pdf.weasyprint_renderer import WeasyprintRenderer

_GOLDEN = (
    Path(__file__).parent.parent.parent.parent
    / "fixtures"
    / "golden"
    / "production_sheet.html"
)


def _payload() -> ProductionSheetPayload:
    return ProductionSheetPayload(
        machine_id="M-A",
        machine_name="Fraiseuse A",
        organization_name="Plant QC",
        workspace_name="Plant A",
        date=date(2026, 5, 11),
        schedule_id="sched-1",
        schedule_published_at=datetime(2026, 5, 11, 7, 30),
        lines=(
            ProductionSheetLine(
                operation_id="WO-1-OP1",
                work_order_ref="WO-1",
                work_order_name="Assembly batch 1",
                sequence=1,
                start=datetime(2026, 5, 11, 8, 0),
                end=datetime(2026, 5, 11, 9, 0),
                setup_minutes=10,
                run_minutes=60,
                notes=None,
            ),
            ProductionSheetLine(
                operation_id="WO-2-OP1",
                work_order_ref="WO-2",
                work_order_name="Assembly batch 2",
                sequence=2,
                start=datetime(2026, 5, 11, 10, 0),
                end=datetime(2026, 5, 11, 11, 0),
                setup_minutes=10,
                run_minutes=60,
                notes=None,
            ),
        ),
        total_setup_minutes=20,
        total_run_minutes=120,
        total_operation_count=2,
    )


@pytest.fixture
def renderer() -> WeasyprintRenderer:
    return WeasyprintRenderer()


def test_production_sheet_html_matches_golden(renderer: WeasyprintRenderer) -> None:
    actual = renderer.render_html("production_sheet.html", _payload())

    if not _GOLDEN.exists():
        _GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        _GOLDEN.write_text(actual, encoding="utf-8")
        pytest.fail(
            f"Golden file generated at {_GOLDEN}. Re-run the test; it will pass."
        )

    expected = _GOLDEN.read_text(encoding="utf-8")
    assert actual == expected, (
        "Production sheet HTML diverged from the golden snapshot. If the "
        f"template change is intentional, replace the contents of {_GOLDEN} "
        "with the actual output (printed below) and re-run.\n\n"
        f"--- ACTUAL ---\n{actual}"
    )
