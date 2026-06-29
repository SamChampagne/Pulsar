"""Port: render a templated HTML page to PDF bytes.

The use cases never know which library does the rendering. The
infrastructure layer plugs in a WeasyPrint adapter (see
``infrastructure/pdf/weasyprint_renderer.py``) but tests can supply a
fake renderer that just returns a marker payload.
"""

from __future__ import annotations

from typing import Protocol


class PdfRenderError(RuntimeError):
    """Raised when the PDF renderer cannot produce output."""


class PdfRenderer(Protocol):
    def render(self, template_name: str, context: object) -> bytes:
        """Render the named template with ``context`` and return PDF bytes.

        ``context`` is typically a frozen view DTO. The renderer should
        accept any object whose attributes the template references.

        Raises ``PdfRenderError`` if the template is missing, the context
        is invalid, or the underlying engine fails.
        """
        ...

    def render_html(self, template_name: str, context: object) -> str:
        """Render the named template to HTML (for dev preview routes).

        Same context semantics as ``render``. Used by
        ``/reports/preview/...`` routes when the feature flag is on.
        """
        ...
