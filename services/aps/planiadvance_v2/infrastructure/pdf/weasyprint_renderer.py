"""WeasyPrint + Jinja2 adapter for the PdfRenderer port.

Templates live in ``planiadvance_v2/infrastructure/pdf/templates/`` and
are loaded via Jinja2's ``FileSystemLoader``. WeasyPrint is imported
lazily so non-PDF code paths (HTML preview, unit tests with a fake
renderer) don't pay the cost of loading the GTK-dependent libs.
"""

from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, TemplateNotFound, select_autoescape

from ...application.ports.pdf_renderer import PdfRenderError

_TEMPLATES_DIR = Path(__file__).parent / "templates"


class WeasyprintRenderer:
    """Concrete PdfRenderer using WeasyPrint to produce PDFs.

    A single Jinja2 environment is reused for every render so template
    parsing happens once per process. WeasyPrint itself is imported
    lazily inside ``render()`` so HTML-only callers (preview routes,
    snapshot tests) don't trigger the GTK runtime requirement on
    Windows.
    """

    def __init__(self, *, templates_dir: Path | None = None) -> None:
        self._env = Environment(
            loader=FileSystemLoader(str(templates_dir or _TEMPLATES_DIR)),
            autoescape=select_autoescape(["html"]),
            trim_blocks=True,
            lstrip_blocks=True,
        )

    def render(self, template_name: str, context: object) -> bytes:
        try:
            from weasyprint import HTML  # lazy import - GTK loaded here
        except (OSError, ImportError) as exc:
            # Native deps missing (Windows without GTK runtime, or a broken
            # Linux image without libpango). Surface as a clean PdfRenderError
            # so the route layer maps it to HTTP 503 instead of bubbling a
            # raw OSError up to the framework.
            raise PdfRenderError(
                f"WeasyPrint native runtime unavailable: {exc}"
            ) from exc

        html = self._render_html(template_name, context)
        try:
            return HTML(string=html, base_url=str(_TEMPLATES_DIR)).write_pdf()
        except Exception as exc:  # pragma: no cover - defensive
            raise PdfRenderError(
                f"WeasyPrint failed to render {template_name!r}: {exc}"
            ) from exc

    def render_html(self, template_name: str, context: object) -> str:
        return self._render_html(template_name, context)

    def _render_html(self, template_name: str, context: object) -> str:
        try:
            template = self._env.get_template(template_name)
        except TemplateNotFound as exc:
            raise PdfRenderError(f"Template {template_name!r} not found") from exc
        return template.render(ctx=context)
