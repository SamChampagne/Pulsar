"""Smoke-level tests for the WeasyPrint adapter.

These tests use a tiny template (``_smoke.html``) shipped alongside
production templates so the adapter is exercised without depending on
report-specific layouts.

The PDF byte test requires WeasyPrint's GTK runtime (Linux/macOS by
default; Windows needs GTK3 Runtime Win64 installed system-wide).
When the runtime is missing, the test is skipped instead of failing —
HTML rendering and template-not-found tests don't depend on GTK and
always run.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from planiadvance_v2.application.ports.pdf_renderer import PdfRenderError
from planiadvance_v2.infrastructure.pdf.weasyprint_renderer import (
    WeasyprintRenderer,
)


def _weasyprint_runtime_available() -> bool:
    """Check whether WeasyPrint's native deps (GTK on Windows) are loadable."""
    try:
        from weasyprint import HTML

        HTML(string="<p>x</p>").write_pdf()
        return True
    except Exception:
        return False


_HAS_WEASYPRINT = _weasyprint_runtime_available()


@dataclass(frozen=True, slots=True)
class _Ctx:
    title: str


@pytest.mark.skipif(
    not _HAS_WEASYPRINT,
    reason="WeasyPrint runtime not available (install GTK3 on Windows)",
)
def test_render_produces_pdf_bytes():
    renderer = WeasyprintRenderer()

    pdf = renderer.render("_smoke.html", _Ctx(title="hello"))

    assert pdf.startswith(b"%PDF-"), f"not a PDF: {pdf[:16]!r}"
    assert len(pdf) > 500


def test_render_html_returns_string_with_context_value():
    renderer = WeasyprintRenderer()

    html = renderer.render_html("_smoke.html", _Ctx(title="brand-x"))

    assert "brand-x" in html
    assert "<html" in html.lower()


def test_unknown_template_raises_pdf_render_error():
    renderer = WeasyprintRenderer()

    with pytest.raises(PdfRenderError):
        renderer.render_html("does_not_exist.html", _Ctx(title="x"))
