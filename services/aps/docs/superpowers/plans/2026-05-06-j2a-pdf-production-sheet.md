# J2a — PDF backend + Production Sheet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land WeasyPrint + Jinja2 backend end-to-end with the Production Sheet PDF, validated against the industrial seed via real-stack + smoke.

**Architecture:** Hexagonal — `application/ports/pdf_renderer.py` declares the rendering contract; `infrastructure/pdf/weasyprint_renderer.py` implements it; `application/use_cases/reports/build_production_sheet.py` orchestrates the data; `api/routes/reports.py` exposes one PDF route + one HTML preview route gated by a feature flag.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0, SQLite (test) / PostgreSQL (real-stack), WeasyPrint ≥ 65, Jinja2, pytest, hypothesis (existing).

**Spec:** `docs/superpowers/specs/2026-05-06-j2a-pdf-production-sheet-design.md`

**Tenant safety:** all reads in the use case go through the F-401 `repo.with_scope(scope)` pattern from `docs/tenant-scoping-pattern.md`. Anonymous calls are rejected at the route via `ensure_authenticated_permission`.

---

## Task 1: WeasyPrint install spike (RISK MITIGATION — DO FIRST)

**Goal:** Confirm WeasyPrint installs and renders on Sam's Windows 11 dev machine before structuring templates. If KO → STOP and switch the spec to ReportLab.

**Files:**
- Create (throwaway): `scratch/spike_weasyprint.py`
- Modify: `pyproject.toml` (`dev` extras add `weasyprint>=65`, `jinja2>=3.1`)

- [ ] **Step 1: Add dependencies to pyproject.toml**

In `pyproject.toml`, find the `[project.optional-dependencies] dev = [...]` block and add (alphabetically sorted):

```toml
"jinja2>=3.1",
"weasyprint>=65",
```

- [ ] **Step 2: Reinstall dev extras**

Run:
```bash
pip install -e ".[dev]"
```

Expected: `Successfully installed weasyprint-65.X jinja2-3.X.X` (or newer). On Windows the wheel should install without GTK runtime — bundled in modern wheels.

If it fails with `OSError: cannot load library 'libgobject-2.0-0'` or similar GTK errors → STOP. Open an issue in the J2a spec, switch backend to ReportLab, abandon this plan.

- [ ] **Step 3: Run a 5-line render spike**

Create `scratch/spike_weasyprint.py`:

```python
"""Throwaway spike: confirm WeasyPrint renders on this machine."""
from weasyprint import HTML

pdf_bytes = HTML(string="<h1>PlaniAdvance J2a spike</h1><p>If you can read this in a PDF, we are good.</p>").write_pdf()
assert pdf_bytes.startswith(b"%PDF-"), f"Output is not a PDF: starts with {pdf_bytes[:8]!r}"
print(f"OK — rendered {len(pdf_bytes)} bytes")
```

Run:
```bash
python scratch/spike_weasyprint.py
```

Expected: `OK — rendered NNNN bytes` with NNNN > 1000.

- [ ] **Step 4: Delete the spike file**

```bash
rm scratch/spike_weasyprint.py
```

(Spike is one-off proof; keeping it would invite drift.)

- [ ] **Step 5: Commit dependency bump**

```bash
git add pyproject.toml
git commit -m "Add weasyprint + jinja2 to dev deps for J2a Reports

Validated locally on Windows 11: bundled wheel renders %PDF- bytes
without external GTK runtime."
```

---

## Task 2: Define the PdfRenderer port

**Files:**
- Create: `planiadvance_v2/application/ports/pdf_renderer.py`
- Modify: `planiadvance_v2/application/ports/__init__.py` (export)

- [ ] **Step 1: Write the port**

Create `planiadvance_v2/application/ports/pdf_renderer.py`:

```python
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
```

- [ ] **Step 2: Export from the ports package**

Edit `planiadvance_v2/application/ports/__init__.py` — find the existing exports and add `PdfRenderer`, `PdfRenderError` in alphabetical order. (Read the file first to mirror its style; ports/__init__.py is the central re-export hub.)

- [ ] **Step 3: Commit**

```bash
git add planiadvance_v2/application/ports/pdf_renderer.py planiadvance_v2/application/ports/__init__.py
git commit -m "Add PdfRenderer port for J2a reports backend

Protocol declares render() -> PDF bytes and render_html() -> HTML
for dev preview. Implementations live in infrastructure/pdf/."
```

---

## Task 3: Implement WeasyprintRenderer adapter (TDD)

**Files:**
- Create: `planiadvance_v2/infrastructure/pdf/__init__.py`
- Create: `planiadvance_v2/infrastructure/pdf/weasyprint_renderer.py`
- Create: `planiadvance_v2/infrastructure/pdf/templates/_smoke.html`
- Test: `tests/unit/infrastructure/pdf/__init__.py` (empty)
- Test: `tests/unit/infrastructure/pdf/test_weasyprint_renderer.py`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/infrastructure/pdf/__init__.py` (empty file).

Create `tests/unit/infrastructure/pdf/test_weasyprint_renderer.py`:

```python
"""Smoke-level tests for the WeasyPrint adapter.

These tests use a tiny template (``_smoke.html``) shipped alongside
production templates so the adapter is exercised without depending on
report-specific layouts.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from planiadvance_v2.application.ports.pdf_renderer import PdfRenderError
from planiadvance_v2.infrastructure.pdf.weasyprint_renderer import (
    WeasyprintRenderer,
)


@dataclass(frozen=True, slots=True)
class _Ctx:
    title: str


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
        renderer.render("does_not_exist.html", _Ctx(title="x"))
```

- [ ] **Step 2: Run the test, watch it fail**

```bash
python -m pytest tests/unit/infrastructure/pdf/test_weasyprint_renderer.py -v
```

Expected: `ModuleNotFoundError: No module named 'planiadvance_v2.infrastructure.pdf.weasyprint_renderer'`. This is the right RED — the feature is missing, not a typo.

- [ ] **Step 3: Add the smoke template**

Create `planiadvance_v2/infrastructure/pdf/templates/_smoke.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{{ title }}</title>
    <style>body { font-family: sans-serif; }</style>
  </head>
  <body>
    <h1>{{ title }}</h1>
    <p>This template exists only to exercise the PDF adapter in tests.</p>
  </body>
</html>
```

- [ ] **Step 4: Implement the adapter**

Create `planiadvance_v2/infrastructure/pdf/__init__.py` (empty file).

Create `planiadvance_v2/infrastructure/pdf/weasyprint_renderer.py`:

```python
"""WeasyPrint + Jinja2 adapter for the PdfRenderer port.

Templates live in ``planiadvance_v2/infrastructure/pdf/templates/`` and
are loaded via Jinja2's ``PackageLoader`` so they are bundled with the
distributable.
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
    lazily so non-PDF code paths do not pay the import cost.
    """

    def __init__(self, *, templates_dir: Path | None = None) -> None:
        self._env = Environment(
            loader=FileSystemLoader(str(templates_dir or _TEMPLATES_DIR)),
            autoescape=select_autoescape(["html"]),
            trim_blocks=True,
            lstrip_blocks=True,
        )

    def render(self, template_name: str, context: object) -> bytes:
        from weasyprint import HTML  # lazy import

        html = self._render_html(template_name, context)
        try:
            return HTML(string=html).write_pdf()
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
```

Note the template references `{{ title }}` directly, but the renderer passes `ctx=context`. Update the smoke template to use `ctx.title`:

Edit `planiadvance_v2/infrastructure/pdf/templates/_smoke.html` — replace `{{ title }}` with `{{ ctx.title }}` in both places.

- [ ] **Step 5: Run the tests, verify they pass**

```bash
python -m pytest tests/unit/infrastructure/pdf/test_weasyprint_renderer.py -v
```

Expected: 3 PASSED.

- [ ] **Step 6: Commit**

```bash
git add planiadvance_v2/infrastructure/pdf/ tests/unit/infrastructure/pdf/
git commit -m "Add WeasyprintRenderer adapter for PdfRenderer port (J2a)

Jinja2 PackageLoader looks templates up under
infrastructure/pdf/templates/. Templates access the context object as
{{ ctx.attribute }}. WeasyPrint is imported lazily so non-PDF code
paths skip the import cost.

Tests: bytes start with %PDF-, render_html includes context values,
unknown template raises PdfRenderError."
```

---

## Task 4: Build base.html + production_sheet.html + print.css

**Files:**
- Create: `planiadvance_v2/infrastructure/pdf/templates/base.html`
- Create: `planiadvance_v2/infrastructure/pdf/templates/production_sheet.html`
- Create: `planiadvance_v2/infrastructure/pdf/templates/styles/print.css`

This task has no tests of its own — templates are exercised via the snapshot test in Task 8 and the integration test in Task 11.

- [ ] **Step 1: Write print.css**

Create `planiadvance_v2/infrastructure/pdf/templates/styles/print.css`:

```css
@page {
  size: A4;
  margin: 15mm 15mm 18mm 15mm;
  @top-center {
    content: string(report-header);
    font-family: 'Helvetica', 'Arial', sans-serif;
    font-size: 9pt;
    color: #555;
  }
  @bottom-right {
    content: counter(page) " / " counter(pages);
    font-family: 'Helvetica', 'Arial', sans-serif;
    font-size: 8pt;
    color: #888;
  }
}

body {
  font-family: 'Helvetica', 'Arial', sans-serif;
  font-size: 10pt;
  color: #111;
  margin: 0;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 1pt solid #222;
  padding-bottom: 4mm;
  margin-bottom: 6mm;
}

.header-row h1 {
  font-size: 14pt;
  margin: 0;
  string-set: report-header attr(data-header-string);
}

.header-row .meta {
  text-align: right;
  font-size: 9pt;
  color: #444;
}

table.lines {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

table.lines th,
table.lines td {
  border-bottom: 0.5pt solid #ccc;
  padding: 3pt 4pt;
  text-align: left;
  vertical-align: top;
}

table.lines thead th {
  background: #f2f2f2;
  font-weight: bold;
  font-size: 9pt;
  border-bottom: 1pt solid #222;
}

table.lines td.numeric,
table.lines th.numeric {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

table.lines td.time {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.footer-totals {
  margin-top: 6mm;
  padding-top: 4mm;
  border-top: 1pt solid #222;
  display: flex;
  justify-content: space-between;
  font-size: 9pt;
}

.footer-totals .schedule-info {
  color: #555;
}
```

- [ ] **Step 2: Write base.html**

Create `planiadvance_v2/infrastructure/pdf/templates/base.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{% block title %}PlaniAdvance Report{% endblock %}</title>
    <link rel="stylesheet" href="styles/print.css" />
    {% block head_extra %}{% endblock %}
  </head>
  <body>
    {% block body %}{% endblock %}
  </body>
</html>
```

- [ ] **Step 3: Write production_sheet.html**

Create `planiadvance_v2/infrastructure/pdf/templates/production_sheet.html`:

```html
{% extends "base.html" %}
{% block title %}Production Sheet — {{ ctx.machine_name }} — {{ ctx.date }}{% endblock %}
{% block body %}
<header class="header-row">
  <h1 data-header-string="{{ ctx.organization_name }} · {{ ctx.machine_name }} · {{ ctx.date }}">
    Production Sheet
  </h1>
  <div class="meta">
    <div>{{ ctx.organization_name }}{% if ctx.workspace_name %} · {{ ctx.workspace_name }}{% endif %}</div>
    <div>Machine: <strong>{{ ctx.machine_name }}</strong></div>
    <div>Date: <strong>{{ ctx.date }}</strong></div>
  </div>
</header>

<table class="lines">
  <thead>
    <tr>
      <th class="numeric" style="width: 8%">#</th>
      <th style="width: 16%">Work Order</th>
      <th>Operation</th>
      <th class="time" style="width: 12%">Start</th>
      <th class="time" style="width: 12%">End</th>
      <th class="numeric" style="width: 10%">Setup (min)</th>
      <th class="numeric" style="width: 10%">Run (min)</th>
    </tr>
  </thead>
  <tbody>
    {% for line in ctx.lines %}
    <tr>
      <td class="numeric">{{ line.sequence }}</td>
      <td>{{ line.work_order_ref }}</td>
      <td>
        {{ line.work_order_name }}
        {% if line.notes %}<br><small>{{ line.notes }}</small>{% endif %}
      </td>
      <td class="time">{{ line.start.strftime('%H:%M') }}</td>
      <td class="time">{{ line.end.strftime('%H:%M') }}</td>
      <td class="numeric">{{ line.setup_minutes }}</td>
      <td class="numeric">{{ line.run_minutes }}</td>
    </tr>
    {% else %}
    <tr><td colspan="7" style="text-align:center; color:#888; padding:6mm">No operations scheduled for this machine on this day.</td></tr>
    {% endfor %}
  </tbody>
</table>

<footer class="footer-totals">
  <div>
    <strong>Total ops:</strong> {{ ctx.total_operation_count }} ·
    <strong>Setup:</strong> {{ ctx.total_setup_minutes }} min ·
    <strong>Run:</strong> {{ ctx.total_run_minutes }} min
  </div>
  <div class="schedule-info">
    Schedule {{ ctx.schedule_id }} · published {{ ctx.schedule_published_at.strftime('%Y-%m-%d %H:%M') }}
  </div>
</footer>
{% endblock %}
```

- [ ] **Step 4: Sanity check by re-running renderer tests**

```bash
python -m pytest tests/unit/infrastructure/pdf/ -v
```

Expected: 3 PASSED. (We didn't add tests yet — Task 8 adds the snapshot — but the existing 3 still pass with the new templates next to `_smoke.html`.)

- [ ] **Step 5: Commit**

```bash
git add planiadvance_v2/infrastructure/pdf/templates/
git commit -m "Add J2a print templates: base.html, production_sheet.html, print.css

A4 portrait, 15mm margins. Header repeats per page via @top-center
and string-set. Page numbering at @bottom-right. Strict B&W friendly
(no colour-coded info, monochrome printers OK)."
```

---

## Task 5: ProductionSheetPayload DTO + reports module skeleton

**Files:**
- Create: `planiadvance_v2/application/use_cases/reports/__init__.py`
- Create: `planiadvance_v2/application/use_cases/reports/production_sheet_payload.py`

This task introduces only data structures. Tests for the use case come in Task 6.

- [ ] **Step 1: Create the package + payload DTO**

Create `planiadvance_v2/application/use_cases/reports/__init__.py`:

```python
"""Use cases that build report payloads consumed by the PdfRenderer."""

from .production_sheet_payload import ProductionSheetLine, ProductionSheetPayload

__all__ = ["ProductionSheetLine", "ProductionSheetPayload"]
```

Create `planiadvance_v2/application/use_cases/reports/production_sheet_payload.py`:

```python
"""View DTOs for the Production Sheet PDF.

These are NOT domain entities — they exist purely to feed Jinja2
templates. Keeping them next to the use case keeps print-specific
concerns out of ``domain/``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime


@dataclass(frozen=True, slots=True)
class ProductionSheetLine:
    operation_id: str
    work_order_ref: str
    work_order_name: str
    sequence: int
    start: datetime
    end: datetime
    setup_minutes: int
    run_minutes: int
    notes: str | None = None


@dataclass(frozen=True, slots=True)
class ProductionSheetPayload:
    machine_id: str
    machine_name: str
    organization_name: str
    workspace_name: str | None
    date: date
    schedule_id: str
    schedule_published_at: datetime
    lines: tuple[ProductionSheetLine, ...]
    total_setup_minutes: int
    total_run_minutes: int
    total_operation_count: int
```

- [ ] **Step 2: Commit**

```bash
git add planiadvance_v2/application/use_cases/reports/
git commit -m "Add ProductionSheetPayload DTOs for J2a

View dataclasses (not domain entities). Live next to the use case to
keep print-specific concerns out of domain/."
```

---

## Task 6: Implement BuildProductionSheet use case (TDD)

**Files:**
- Create: `planiadvance_v2/application/use_cases/reports/build_production_sheet.py`
- Modify: `planiadvance_v2/application/use_cases/reports/__init__.py` (export)
- Test: `tests/unit/use_cases/__init__.py` (if missing)
- Test: `tests/unit/use_cases/reports/__init__.py`
- Test: `tests/unit/use_cases/reports/test_build_production_sheet.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/use_cases/__init__.py` if missing (empty file).
Create `tests/unit/use_cases/reports/__init__.py` (empty file).
Create `tests/unit/use_cases/reports/test_build_production_sheet.py`:

```python
"""TDD tests for BuildProductionSheet use case.

Uses in-memory repositories. Schedule is seeded with two assignments
on machine M-A across one day, plus one assignment on a sibling
machine to prove filtering. Cross-tenant rows are seeded to prove
F-401 scoping is honoured.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest

from planiadvance_v2.application.use_cases.reports.build_production_sheet import (
    BuildProductionSheet,
    MachineNotFoundForReport,
    NoPublishedScheduleForReport,
    RequestedDateOutsideHorizon,
)
from planiadvance_v2.domain.entities import (
    Machine,
    Operation,
    Organization,
    Schedule,
    ScheduledAssignment,
    Workspace,
    WorkOrder,
)
from planiadvance_v2.domain.value_objects import Duration
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryMachineRepository,
    InMemoryOrganizationRepository,
    InMemoryScheduleRepository,
    InMemoryWorkOrderRepository,
    InMemoryWorkspaceRepository,
)
from planiadvance_v2.infrastructure.scoping import TenantScope


_ORG_A = "org-a"
_ORG_B = "org-b"
_WS_A = "plant-a"
_DAY = date(2026, 5, 11)


def _make_op(op_id: str, wo_id: str, dur_min: int, setup_min: int = 0) -> Operation:
    return Operation(
        id=op_id,
        work_order_id=wo_id,
        sequence=1,
        name=op_id,
        duration=Duration(minutes=dur_min),
        setup_time=Duration(minutes=setup_min),
        eligible_machine_ids=["M-A"],
        dependencies=[],
    )


def _make_wo(wo_id: str, name: str, *, organization_id: str, workspace_id: str | None) -> WorkOrder:
    return WorkOrder(
        id=wo_id,
        name=name,
        product_id=f"PROD-{wo_id}",
        quantity=1,
        due_date=datetime(2026, 5, 12),
        release_date=datetime(2026, 5, 1),
        operations=[_make_op(f"{wo_id}-OP1", wo_id, 60, setup_min=10)],
        organization_id=organization_id,
        workspace_id=workspace_id,
    )


@pytest.fixture
def fixture():
    machines = InMemoryMachineRepository(
        [
            Machine(
                id="M-A",
                name="Fraiseuse A",
                calendar_id="CAL",
                organization_id=_ORG_A,
                workspace_id=_WS_A,
            ),
            Machine(
                id="M-B-OTHER-ORG",
                name="EU Press",
                calendar_id="CAL",
                organization_id=_ORG_B,
                workspace_id=None,
            ),
        ]
    )
    work_orders = InMemoryWorkOrderRepository(
        [
            _make_wo("WO-1", "Assembly batch 1", organization_id=_ORG_A, workspace_id=_WS_A),
            _make_wo("WO-2", "Assembly batch 2", organization_id=_ORG_A, workspace_id=_WS_A),
        ]
    )
    organizations = InMemoryOrganizationRepository(
        [
            Organization(id=_ORG_A, name="Plant QC", slug="plant-qc"),
            Organization(id=_ORG_B, name="Plant EU", slug="plant-eu"),
        ]
    )
    workspaces = InMemoryWorkspaceRepository(
        [
            Workspace(id=_WS_A, name="Plant A", organization_id=_ORG_A),
        ]
    )
    schedules = InMemoryScheduleRepository()

    horizon_start = datetime(2026, 5, 11, 0, 0)
    horizon_end = datetime(2026, 5, 18, 0, 0)

    schedule = Schedule(
        id="sched-1",
        assignments=[
            ScheduledAssignment(
                operation_id="WO-1-OP1",
                machine_id="M-A",
                start=datetime(2026, 5, 11, 8, 0),
                end=datetime(2026, 5, 11, 9, 0),
                setup_start=datetime(2026, 5, 11, 7, 50),
            ),
            ScheduledAssignment(
                operation_id="WO-2-OP1",
                machine_id="M-A",
                start=datetime(2026, 5, 11, 10, 0),
                end=datetime(2026, 5, 11, 11, 0),
                setup_start=datetime(2026, 5, 11, 9, 50),
            ),
        ],
    )
    schedules.save(
        schedule,
        metrics={},
        organization_id=_ORG_A,
        workspace_id=_WS_A,
        lifecycle_status="published",
        horizon_start=horizon_start,
        horizon_end=horizon_end,
    )

    return BuildProductionSheet(
        machines=machines,
        work_orders=work_orders,
        organizations=organizations,
        workspaces=workspaces,
        schedules=schedules,
    )


class TestBuildProductionSheetHappyPath:
    def test_returns_sorted_lines_for_machine_and_day(self, fixture):
        scope = TenantScope.for_workspace(organization_id=_ORG_A, workspace_id=_WS_A)

        payload = fixture.execute(machine_id="M-A", target_date=_DAY, scope=scope)

        assert payload.machine_id == "M-A"
        assert payload.machine_name == "Fraiseuse A"
        assert payload.organization_name == "Plant QC"
        assert payload.workspace_name == "Plant A"
        assert payload.date == _DAY
        assert payload.schedule_id == "sched-1"
        assert len(payload.lines) == 2
        assert payload.lines[0].operation_id == "WO-1-OP1"
        assert payload.lines[1].operation_id == "WO-2-OP1"
        assert payload.lines[0].setup_minutes == 10
        assert payload.lines[0].run_minutes == 60
        assert payload.total_operation_count == 2
        assert payload.total_run_minutes == 120
        assert payload.total_setup_minutes == 20


class TestBuildProductionSheetErrors:
    def test_cross_tenant_machine_raises_machine_not_found(self, fixture):
        scope = TenantScope.for_organization(_ORG_A)

        with pytest.raises(MachineNotFoundForReport):
            fixture.execute(machine_id="M-B-OTHER-ORG", target_date=_DAY, scope=scope)

    def test_no_published_schedule_raises(self, fixture):
        # Drop the only schedule by mutating the repo (test convenience)
        fixture._schedules._data.clear()  # pragma: no cover
        scope = TenantScope.for_organization(_ORG_A)

        with pytest.raises(NoPublishedScheduleForReport):
            fixture.execute(machine_id="M-A", target_date=_DAY, scope=scope)

    def test_date_outside_horizon_raises(self, fixture):
        scope = TenantScope.for_organization(_ORG_A)

        with pytest.raises(RequestedDateOutsideHorizon):
            fixture.execute(
                machine_id="M-A",
                target_date=date(2025, 1, 1),
                scope=scope,
            )
```

NOTE: this test references `InMemoryScheduleRepository.save(...)` and the `Schedule`/`ScheduledAssignment` shapes. Before writing the implementation, open `planiadvance_v2/infrastructure/in_memory/repositories.py` around `InMemoryScheduleRepository` to confirm the `save` signature and the entities' field names. Adapt the test if the real shapes differ. (Do this in Step 2 below.)

- [ ] **Step 2: Verify entity shapes match the test**

Read `planiadvance_v2/infrastructure/in_memory/repositories.py` lines around `class InMemoryScheduleRepository` and `planiadvance_v2/domain/entities/__init__.py` to confirm:
- `Schedule` exposes `id` and `assignments` list.
- `ScheduledAssignment` exposes `operation_id`, `machine_id`, `start`, `end`, `setup_start` (or equivalent).
- `InMemoryScheduleRepository.save(...)` accepts `lifecycle_status`, `horizon_start`, `horizon_end`, `organization_id`, `workspace_id`, `metrics`.

If field names differ (e.g. `setup_start_at` vs `setup_start`), adjust the test before proceeding. Do not invent fields.

- [ ] **Step 3: Run the test, watch it fail (RED)**

```bash
python -m pytest tests/unit/use_cases/reports/test_build_production_sheet.py -v
```

Expected: `ModuleNotFoundError: No module named 'planiadvance_v2.application.use_cases.reports.build_production_sheet'`.

- [ ] **Step 4: Implement the use case**

Create `planiadvance_v2/application/use_cases/reports/build_production_sheet.py`:

```python
"""Use case: build the Production Sheet payload for one machine and one day.

Given a machine id, a calendar date, and an active tenant scope, this
use case finds the latest published Schedule for the tenant, picks
the assignments on that machine whose start falls on the requested
date (in the schedule's local interpretation), and assembles a
``ProductionSheetPayload`` ready for the PdfRenderer.

All reads honour the F-401 ScopedRepository pattern: a use case that
forgets the scope cannot leak rows from another tenant because the
scoped view raises ``MissingTenantScopeError``.
"""

from __future__ import annotations

from datetime import date, datetime

from ...ports.schedule_repository import ScheduleRepository
from ...ports.workspace_repository import WorkspaceRepository
from ....infrastructure.scoping import TenantScope
from .production_sheet_payload import ProductionSheetLine, ProductionSheetPayload


class ReportError(RuntimeError):
    """Base for J2a reporting use-case errors."""


class MachineNotFoundForReport(ReportError):
    pass


class NoPublishedScheduleForReport(ReportError):
    pass


class RequestedDateOutsideHorizon(ReportError):
    def __init__(
        self,
        requested: date,
        horizon_start: datetime | None,
        horizon_end: datetime | None,
    ) -> None:
        super().__init__(
            f"Date {requested} is outside the published horizon "
            f"[{horizon_start}, {horizon_end}]."
        )
        self.requested = requested
        self.horizon_start = horizon_start
        self.horizon_end = horizon_end


class BuildProductionSheet:
    def __init__(
        self,
        *,
        machines,
        work_orders,
        organizations,
        workspaces: WorkspaceRepository,
        schedules: ScheduleRepository,
    ) -> None:
        self._machines = machines
        self._work_orders = work_orders
        self._organizations = organizations
        self._workspaces = workspaces
        self._schedules = schedules

    def execute(
        self,
        *,
        machine_id: str,
        target_date: date,
        scope: TenantScope,
    ) -> ProductionSheetPayload:
        organization_id = scope.require_organization()

        machine = self._machines.with_scope(scope).get(machine_id)
        if machine is None:
            raise MachineNotFoundForReport(
                f"Machine {machine_id!r} not in tenant scope."
            )

        published = self._schedules.list_recent(
            limit=1,
            organization_id=organization_id,
            workspace_id=scope.workspace_id,
            lifecycle_status="published",
        )
        if not published:
            raise NoPublishedScheduleForReport(
                "No published schedule for the active tenant. Publish a "
                "scenario before printing reports."
            )
        schedule, metadata = published[0]

        if metadata.horizon_start and metadata.horizon_end:
            day_start = datetime.combine(target_date, datetime.min.time())
            day_end = datetime.combine(target_date, datetime.max.time())
            if day_end < metadata.horizon_start or day_start > metadata.horizon_end:
                raise RequestedDateOutsideHorizon(
                    target_date, metadata.horizon_start, metadata.horizon_end
                )

        assignments = [
            a
            for a in schedule.assignments
            if a.machine_id == machine_id and a.start.date() == target_date
        ]
        assignments.sort(key=lambda a: a.start)

        wo_index = {wo.id: wo for wo in self._work_orders.with_scope(scope).list()}
        op_index: dict[str, tuple] = {}  # op_id -> (op, work_order)
        for wo in wo_index.values():
            for op in wo.operations:
                op_index[op.id] = (op, wo)

        lines: list[ProductionSheetLine] = []
        total_setup = 0
        total_run = 0
        for idx, assignment in enumerate(assignments, start=1):
            entry = op_index.get(assignment.operation_id)
            if entry is None:
                # Operation has no parent WO in this tenant — skip silently.
                # This can happen if the schedule outlives a WO deletion.
                continue
            operation, work_order = entry
            setup_min = int(operation.setup_time.minutes)
            run_min = int(operation.duration.minutes)
            total_setup += setup_min
            total_run += run_min
            lines.append(
                ProductionSheetLine(
                    operation_id=operation.id,
                    work_order_ref=work_order.id,
                    work_order_name=work_order.name,
                    sequence=idx,
                    start=assignment.start,
                    end=assignment.end,
                    setup_minutes=setup_min,
                    run_minutes=run_min,
                    notes=None,
                )
            )

        org = self._organizations.get(organization_id)
        workspace = (
            self._workspaces.get(scope.workspace_id) if scope.workspace_id else None
        )

        return ProductionSheetPayload(
            machine_id=machine_id,
            machine_name=machine.name,
            organization_name=org.name if org else organization_id,
            workspace_name=workspace.name if workspace else None,
            date=target_date,
            schedule_id=schedule.id,
            schedule_published_at=metadata.horizon_start or datetime.utcnow(),
            lines=tuple(lines),
            total_setup_minutes=total_setup,
            total_run_minutes=total_run,
            total_operation_count=len(lines),
        )
```

- [ ] **Step 5: Export from the reports package**

Edit `planiadvance_v2/application/use_cases/reports/__init__.py` to add:

```python
from .build_production_sheet import (
    BuildProductionSheet,
    MachineNotFoundForReport,
    NoPublishedScheduleForReport,
    ReportError,
    RequestedDateOutsideHorizon,
)
```

And extend `__all__` accordingly.

- [ ] **Step 6: Run the tests, verify GREEN**

```bash
python -m pytest tests/unit/use_cases/reports/test_build_production_sheet.py -v
```

Expected: 4 PASSED.

- [ ] **Step 7: Commit**

```bash
git add planiadvance_v2/application/use_cases/reports/build_production_sheet.py planiadvance_v2/application/use_cases/reports/__init__.py tests/unit/use_cases/
git commit -m "Add BuildProductionSheet use case (J2a, TDD)

Reads via the F-401 ScopedRepository pattern. Looks up the latest
published Schedule for the active tenant, filters assignments by
machine + day, joins each to its parent WorkOrder, and returns a
ProductionSheetPayload ready for the PdfRenderer.

Errors: MachineNotFoundForReport, NoPublishedScheduleForReport,
RequestedDateOutsideHorizon."
```

---

## Task 7: Add `view_reports` permission

**Files:**
- Modify: `planiadvance_v2/api/tenant.py:63-102` (the ROLE_PERMISSIONS dict)
- Test: `tests/unit/api/test_tenant_context.py` (extend existing)

- [ ] **Step 1: Write a failing permission test**

Open `tests/unit/api/test_tenant_context.py`. At the bottom, add:

```python
def test_view_reports_permission_matrix():
    from planiadvance_v2.api.tenant import permissions_for_role
    from planiadvance_v2.domain.entities import MembershipRole

    assert "view_reports" in permissions_for_role(MembershipRole.OWNER)
    assert "view_reports" in permissions_for_role(MembershipRole.ADMIN)
    assert "view_reports" in permissions_for_role(MembershipRole.PLANNER)
    assert "view_reports" in permissions_for_role(MembershipRole.VIEWER)
    assert "view_reports" not in permissions_for_role(MembershipRole.INTEGRATOR)
```

Run:
```bash
python -m pytest tests/unit/api/test_tenant_context.py::test_view_reports_permission_matrix -v
```

Expected: FAIL — `view_reports` not in any role's permission list.

- [ ] **Step 2: Add the permission**

Edit `planiadvance_v2/api/tenant.py` ROLE_PERMISSIONS:
- Append `"view_reports"` to OWNER's tuple.
- Append `"view_reports"` to ADMIN's tuple.
- Append `"view_reports"` to PLANNER's tuple.
- Append `"view_reports"` to VIEWER's tuple.
- Do NOT add to INTEGRATOR.

- [ ] **Step 3: Run the test, verify GREEN**

```bash
python -m pytest tests/unit/api/test_tenant_context.py::test_view_reports_permission_matrix -v
```

Expected: PASS.

- [ ] **Step 4: Run the full unit suite to confirm no regression**

```bash
python -m pytest tests/unit -q
```

Expected: 721+ PASS (current baseline + new tests from this plan so far).

- [ ] **Step 5: Commit**

```bash
git add planiadvance_v2/api/tenant.py tests/unit/api/test_tenant_context.py
git commit -m "Add view_reports permission for J2a reports backend

Granted to OWNER, ADMIN, PLANNER, VIEWER. INTEGRATOR (system role)
does not get it. Test asserts the matrix to lock the policy."
```

---

## Task 8: Snapshot test for production_sheet.html

**Files:**
- Create: `tests/fixtures/golden/production_sheet.html`
- Create: `tests/unit/infrastructure/pdf/test_production_sheet_template.py`

The snapshot test renders `production_sheet.html` against a fixed payload and compares against a golden HTML file. When the template intentionally changes, the test fails with a diff and the engineer regenerates the golden file (committed deliberately).

- [ ] **Step 1: Write the snapshot test**

Create `tests/unit/infrastructure/pdf/test_production_sheet_template.py`:

```python
"""Snapshot test for production_sheet.html.

Renders the template against a fixed ProductionSheetPayload and
compares the HTML against a golden file. On intentional template
changes, regenerate the golden file with:

    pytest tests/unit/infrastructure/pdf/test_production_sheet_template.py \\
        --snapshot-update

(Manual regeneration: copy the actual output into the golden file.)
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


_GOLDEN = Path(__file__).parent.parent.parent.parent / "fixtures" / "golden" / "production_sheet.html"


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
def renderer():
    return WeasyprintRenderer()


def test_production_sheet_html_matches_golden(renderer):
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
```

- [ ] **Step 2: Run the test once to generate the golden**

```bash
python -m pytest tests/unit/infrastructure/pdf/test_production_sheet_template.py -v
```

Expected on first run: FAIL with `Golden file generated at ...`. The file `tests/fixtures/golden/production_sheet.html` is now created.

- [ ] **Step 3: Run the test again — should pass**

```bash
python -m pytest tests/unit/infrastructure/pdf/test_production_sheet_template.py -v
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/infrastructure/pdf/test_production_sheet_template.py tests/fixtures/golden/production_sheet.html
git commit -m "Add snapshot test for production_sheet.html template (J2a)

Renders against a fixed ProductionSheetPayload and compares to a
golden HTML file. On intentional template changes, replace the
golden file's content with the actual rendered output."
```

---

## Task 9: Add `reports_html_preview_enabled` setting

**Files:**
- Modify: `planiadvance_v2/config.py`
- Modify: `.env.example`

- [ ] **Step 1: Read current Settings shape**

Read `planiadvance_v2/config.py` to identify the existing `Settings(BaseSettings)` class and its fields. Find an existing boolean field for syntax reference (e.g. `auth_allow_header_identity`).

- [ ] **Step 2: Add the new setting**

Add the field to `Settings` (alphabetical order):

```python
reports_html_preview_enabled: bool = False
```

- [ ] **Step 3: Document in .env.example**

Append to `.env.example`:

```
# Reports — enable HTML preview routes (dev only). MUST stay False in prod.
REPORTS_HTML_PREVIEW_ENABLED=false
```

- [ ] **Step 4: Commit**

```bash
git add planiadvance_v2/config.py .env.example
git commit -m "Add reports_html_preview_enabled feature flag (J2a)

Gates GET /reports/preview/* HTML routes used during template
iteration. Default False; production deployments leave it off."
```

---

## Task 10: Add /reports route + dependency wiring

**Files:**
- Create: `planiadvance_v2/api/routes/reports.py`
- Modify: `planiadvance_v2/api/main.py` (register router)
- Modify: `planiadvance_v2/api/dependencies.py` (factories)
- Test: `tests/unit/api/test_reports_http.py`

- [ ] **Step 1: Write the failing route tests**

Create `tests/unit/api/test_reports_http.py`:

```python
"""HTTP-level tests for /reports endpoints (J2a)."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient

from planiadvance_v2.api.dependencies import (
    get_build_production_sheet,
    get_pdf_renderer,
)
from planiadvance_v2.api.main import create_app
from planiadvance_v2.api.tenant import (
    get_tenant_membership_repository,
    get_tenant_organization_repository,
    get_tenant_workspace_repository,
)
from planiadvance_v2.application.use_cases import ListAccessibleWorkspaces
from planiadvance_v2.application.use_cases.reports import BuildProductionSheet
from planiadvance_v2.application.use_cases.reports.production_sheet_payload import (
    ProductionSheetLine,
    ProductionSheetPayload,
)
from planiadvance_v2.domain.entities import (
    Machine,
    Membership,
    MembershipRole,
    Organization,
    Workspace,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryMachineRepository,
    InMemoryMembershipRepository,
    InMemoryOrganizationRepository,
    InMemoryWorkspaceAccessGrantRepository,
    InMemoryWorkspaceRepository,
)


_TENANT_HEADERS = {"X-Organization-Id": "org-1", "X-User-Id": "user-1"}


def _payload() -> ProductionSheetPayload:
    return ProductionSheetPayload(
        machine_id="M-A",
        machine_name="Fraiseuse A",
        organization_name="Plant QC",
        workspace_name=None,
        date=date(2026, 5, 11),
        schedule_id="sched-1",
        schedule_published_at=datetime(2026, 5, 11, 7, 30),
        lines=(
            ProductionSheetLine(
                operation_id="OP-1",
                work_order_ref="WO-1",
                work_order_name="Batch",
                sequence=1,
                start=datetime(2026, 5, 11, 8, 0),
                end=datetime(2026, 5, 11, 9, 0),
                setup_minutes=10,
                run_minutes=60,
            ),
        ),
        total_setup_minutes=10,
        total_run_minutes=60,
        total_operation_count=1,
    )


class _FakeUseCase:
    def __init__(self, payload: ProductionSheetPayload) -> None:
        self._payload = payload

    def execute(self, **_kwargs) -> ProductionSheetPayload:
        return self._payload


class _FakeRenderer:
    def render(self, template_name: str, context) -> bytes:
        return b"%PDF-1.4 stub-from-fake-renderer"

    def render_html(self, template_name: str, context) -> str:
        return f"<html><body>preview {template_name}</body></html>"


@pytest.fixture
def api():
    organizations = InMemoryOrganizationRepository(
        [Organization(id="org-1", name="Plant QC", slug="plant-qc")]
    )
    memberships = InMemoryMembershipRepository(
        [
            Membership(
                organization_id="org-1",
                user_id="user-1",
                role=MembershipRole.PLANNER,
            ),
            Membership(
                organization_id="org-1",
                user_id="integrator-1",
                role=MembershipRole.INTEGRATOR,
            ),
        ]
    )
    workspaces = InMemoryWorkspaceRepository([])
    grants = InMemoryWorkspaceAccessGrantRepository()
    InMemoryMachineRepository([])  # not used; route is fake-injected

    app = create_app()

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    app.router.lifespan_context = _noop_lifespan
    app.dependency_overrides[get_tenant_organization_repository] = lambda: organizations
    app.dependency_overrides[get_tenant_membership_repository] = lambda: memberships
    app.dependency_overrides[get_tenant_workspace_repository] = lambda: workspaces
    app.dependency_overrides[ListAccessibleWorkspaces] = (
        lambda: ListAccessibleWorkspaces(workspaces=workspaces, grants=grants)
    )
    app.dependency_overrides[get_build_production_sheet] = lambda: _FakeUseCase(_payload())
    app.dependency_overrides[get_pdf_renderer] = lambda: _FakeRenderer()

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()


def test_production_sheet_returns_pdf_bytes(api):
    response = api.get(
        "/reports/production-sheet?machine_id=M-A&date=2026-05-11",
        headers=_TENANT_HEADERS,
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF-")
    assert "attachment" in response.headers["content-disposition"]
    assert "production-sheet-M-A-2026-05-11.pdf" in response.headers["content-disposition"]


def test_production_sheet_anonymous_is_unauthorized(api):
    response = api.get("/reports/production-sheet?machine_id=M-A&date=2026-05-11")

    assert response.status_code == 401


def test_production_sheet_integrator_is_forbidden(api):
    response = api.get(
        "/reports/production-sheet?machine_id=M-A&date=2026-05-11",
        headers={"X-Organization-Id": "org-1", "X-User-Id": "integrator-1"},
    )

    assert response.status_code == 403


def test_html_preview_disabled_by_default(api):
    response = api.get(
        "/reports/preview/production-sheet?machine_id=M-A&date=2026-05-11",
        headers=_TENANT_HEADERS,
    )

    # Feature flag off -> 404
    assert response.status_code == 404
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
python -m pytest tests/unit/api/test_reports_http.py -v
```

Expected: `ImportError: cannot import name 'get_build_production_sheet' from 'planiadvance_v2.api.dependencies'`. Right RED.

- [ ] **Step 3: Add dependency factories**

Edit `planiadvance_v2/api/dependencies.py`. After the existing imports (alphabetical order), add:

```python
from ..application.use_cases.reports import BuildProductionSheet
from ..application.ports.pdf_renderer import PdfRenderer
from ..infrastructure.pdf.weasyprint_renderer import WeasyprintRenderer
```

At the end of the file, append:

```python
def get_pdf_renderer() -> PdfRenderer:
    return WeasyprintRenderer()


def get_build_production_sheet(
    session: Session = Depends(get_db_session),
) -> BuildProductionSheet:
    return BuildProductionSheet(
        machines=SqlMachineRepository(session),
        work_orders=SqlWorkOrderRepository(session),
        organizations=SqlOrganizationRepository(session),
        workspaces=SqlWorkspaceRepository(session),
        schedules=SqlScheduleRepository(session),
    )
```

- [ ] **Step 4: Implement the route**

Create `planiadvance_v2/api/routes/reports.py`:

```python
"""HTTP routes for the J2a Reports module.

Currently exposes Production Sheet (PDF + HTML preview gated by
the ``reports_html_preview_enabled`` feature flag).
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response

from ..config import get_settings
from ..application.ports.pdf_renderer import PdfRenderError, PdfRenderer
from ..application.use_cases.reports import (
    BuildProductionSheet,
    MachineNotFoundForReport,
    NoPublishedScheduleForReport,
    RequestedDateOutsideHorizon,
)
from ..dependencies import get_build_production_sheet, get_pdf_renderer
from ..tenant import (
    TenantContext,
    ensure_authenticated_permission,
    get_tenant_context,
)
from ..dependencies import get_tenant_scope_from_context

# planiadvance_v2.config import is the canonical Settings source.
# Re-import via an absolute path is needed because this file lives under api/.
from ...config import get_settings as _get_settings  # noqa: F401  pylint: disable=reimported


router = APIRouter(prefix="/reports", tags=["reports"])


def _scope_from_tenant(tenant: TenantContext):
    return get_tenant_scope_from_context(
        organization_id=tenant.organization_id,
        workspace_id=tenant.workspace_id,
    )


@router.get("/production-sheet")
def production_sheet_pdf(
    machine_id: str,
    date: date,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: BuildProductionSheet = Depends(get_build_production_sheet),
    renderer: PdfRenderer = Depends(get_pdf_renderer),
) -> Response:
    ensure_authenticated_permission(tenant, "view_reports")

    payload = _build_payload(machine_id, date, tenant, use_case)
    try:
        pdf_bytes = renderer.render("production_sheet.html", payload)
    except PdfRenderError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "pdf_render_failed",
                "diagnostic": str(exc),
            },
        ) from exc

    filename = f"production-sheet-{machine_id}-{date.isoformat()}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/preview/production-sheet")
def production_sheet_preview(
    machine_id: str,
    date: date,
    tenant: TenantContext = Depends(get_tenant_context),
    use_case: BuildProductionSheet = Depends(get_build_production_sheet),
    renderer: PdfRenderer = Depends(get_pdf_renderer),
) -> Response:
    if not _get_settings().reports_html_preview_enabled:
        raise HTTPException(status_code=404, detail={"error": "not_found"})
    ensure_authenticated_permission(tenant, "view_reports")

    payload = _build_payload(machine_id, date, tenant, use_case)
    try:
        html = renderer.render_html("production_sheet.html", payload)
    except PdfRenderError as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "pdf_render_failed", "diagnostic": str(exc)},
        ) from exc

    return Response(content=html, media_type="text/html")


def _build_payload(
    machine_id: str,
    target_date: date,
    tenant: TenantContext,
    use_case: BuildProductionSheet,
):
    scope = _scope_from_tenant(tenant)
    try:
        return use_case.execute(
            machine_id=machine_id,
            target_date=target_date,
            scope=scope,
        )
    except MachineNotFoundForReport as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": "machine_not_found", "message": str(exc)},
        ) from exc
    except NoPublishedScheduleForReport as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": "no_published_schedule", "message": str(exc)},
        ) from exc
    except RequestedDateOutsideHorizon as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "date_out_of_horizon",
                "horizon_start": exc.horizon_start.isoformat() if exc.horizon_start else None,
                "horizon_end": exc.horizon_end.isoformat() if exc.horizon_end else None,
            },
        ) from exc
```

- [ ] **Step 5: Register the router**

Open `planiadvance_v2/api/main.py` and find where other routers are registered (look for `app.include_router(...)` calls or a list of routers). Add:

```python
from .routes import reports as reports_routes
app.include_router(reports_routes.router)
```

(Mirror the existing convention: if other routers are imported at the top, do the same. If they are inside `create_app()`, follow that pattern.)

- [ ] **Step 6: Run the test, verify GREEN**

```bash
python -m pytest tests/unit/api/test_reports_http.py -v
```

Expected: 4 PASSED.

- [ ] **Step 7: Run the full unit suite**

```bash
python -m pytest tests/unit -q
```

Expected: all green, count up by 4 + new tests above (~730).

- [ ] **Step 8: Commit**

```bash
git add planiadvance_v2/api/routes/reports.py planiadvance_v2/api/main.py planiadvance_v2/api/dependencies.py tests/unit/api/test_reports_http.py
git commit -m "Add /reports/production-sheet route + dependency wiring (J2a)

Permissions enforced via view_reports. /reports/preview/* route
gated by reports_html_preview_enabled flag (404 when off).
Use-case errors map to 404/422; renderer errors map to 503."
```

---

## Task 11: Real-stack integration test for /reports/production-sheet

**Files:**
- Modify: `tests/integration/test_real_stack_postgres.py`

- [ ] **Step 1: Read the existing real-stack test for headers/seed conventions**

Read `tests/integration/test_real_stack_postgres.py` to see how existing tests construct the auth headers and identify a seeded machine + schedule. Reuse those conventions.

- [ ] **Step 2: Add a test method to the existing class**

Append inside `class TestRealStackPostgres`:

```python
def test_production_sheet_pdf_renders_against_industrial_seed(self, real_stack_client):
    # Use a seeded machine + a date inside the published horizon.
    response = real_stack_client.get(
        "/reports/production-sheet",
        params={"machine_id": "M-FRAISE-01", "date": "2026-05-11"},
    )
    # Adjust machine_id + date to match the real industrial seed if needed.

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.content[:4] == b"%PDF"
    assert len(response.content) > 1024
```

NOTE: substitute `real_stack_client` with the actual fixture name used in this file. If no published schedule exists in the seed, run a publish step earlier in the test (mirror what other real-stack tests do).

- [ ] **Step 3: Bring up the stack**

```bash
make stack-up
```

Wait for the API to respond (loop on `/health` until 200, or sleep ~10s).

- [ ] **Step 4: Run the new test**

```bash
PLANIADVANCE_STACK_TEST_DATABASE_URL="postgresql+psycopg://plani:plani@localhost:5432/planiadvance_v2" \
  python -m pytest tests/integration/test_real_stack_postgres.py::TestRealStackPostgres::test_production_sheet_pdf_renders_against_industrial_seed -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/test_real_stack_postgres.py
git commit -m "Add real-stack test: /reports/production-sheet renders PDF (J2a)

Hits the running API against the industrial seed, asserts 200 +
application/pdf + non-trivial byte length."
```

---

## Task 12: Extend industrial_stack_smoke.py

**Files:**
- Modify: `planiadvance_v2/infrastructure/industrial_stack_smoke.py`

- [ ] **Step 1: Read current smoke shape**

Read `planiadvance_v2/infrastructure/industrial_stack_smoke.py` end-to-end. Identify the `SmokeResult` dataclass and the request helper.

- [ ] **Step 2: Add the new field + call**

Extend `SmokeResult` with:
```python
production_sheet_bytes: int
```

Add a new step in the smoke flow that calls `GET /reports/production-sheet?machine_id=<seeded>&date=<seed-day>` and asserts:
- status 200
- content-type starts with `application/pdf`
- response body starts with `b"%PDF"`
- non-zero byte length

Set `production_sheet_bytes` to the response length. Print it as part of the final JSON (the smoke prints `SmokeResult` as JSON).

If the seed doesn't have an obvious "machine to print" + "day to print", document a TODO in the smoke saying which seed values it expects (and update the seed file in the same task if necessary).

- [ ] **Step 3: Run the smoke against the running stack**

```bash
docker compose -f docker/docker-compose.yml exec -T api python -m planiadvance_v2.infrastructure.industrial_stack_smoke
```

Expected: JSON output with `"status": "ok"` and `"production_sheet_bytes": NNNN` where NNNN > 1000.

- [ ] **Step 4: Commit**

```bash
git add planiadvance_v2/infrastructure/industrial_stack_smoke.py
git commit -m "Smoke: assert /reports/production-sheet returns valid PDF (J2a)

Adds production_sheet_bytes to SmokeResult and calls the new
endpoint after the publish step. Status remains 'ok' if the byte
count is non-zero and the body starts with %PDF."
```

---

## Task 13: Write docs/reports-howto.md

**Files:**
- Create: `docs/reports-howto.md`

This is the J2 living document — J2b/c/d will extend it.

- [ ] **Step 1: Write the doc**

Create `docs/reports-howto.md`:

```markdown
# Adding a new report

This guide describes how to add a new printable report (PDF) or in-app
report to PlaniAdvance V2. The pattern was established by **J2a — Production
Sheet** (see `docs/superpowers/specs/2026-05-06-j2a-pdf-production-sheet-design.md`).

## Anatomy of a report

A report has four moving parts:

1. **View DTO** — `application/use_cases/reports/<report>_payload.py`. Frozen
   dataclass(es). Not a domain entity. Holds exactly the data the template
   renders, no more.
2. **Use case** — `application/use_cases/reports/build_<report>.py`. Reads
   via the F-401 ScopedRepository pattern (`repo.with_scope(scope).list()`),
   raises `ReportError` subclasses for known failure modes, returns the DTO.
3. **Template** — `infrastructure/pdf/templates/<report>.html`, extending
   `base.html`. Accesses the DTO as `{{ ctx.field }}`. Style via `styles/print.css`.
4. **Route** — `api/routes/reports.py`. Calls the use case, asks the
   `PdfRenderer` to render, returns `application/pdf`. Permission gate:
   `view_reports`.

Plus the supporting tests:

- Unit test of the use case with in-memory repos (TDD).
- Snapshot test of the template (`tests/unit/infrastructure/pdf/test_<report>_template.py`).
- HTTP test of the route (`tests/unit/api/test_reports_http.py`).
- Real-stack integration test (`tests/integration/test_real_stack_postgres.py`).
- Smoke entry in `industrial_stack_smoke.py`.

## Minimal recipe

1. Define the payload DTO. Aim for everything the printer needs and
   nothing else. Use `tuple` for sequences (frozen dataclasses are not
   compatible with `list` defaults).
2. Write the use case test first (TDD). Drive failures: cross-tenant
   resource, missing dependency, out-of-horizon.
3. Implement the use case using `repo.with_scope(scope).get/list()`. Raise
   a typed error per failure; never return `None` silently for a leak.
4. Add the Jinja2 template. Keep print-specific CSS in `print.css`. Reuse
   classes from existing reports (`table.lines`, `.header-row`,
   `.footer-totals`).
5. Generate the snapshot golden by running the template test once; commit
   the golden file alongside the template.
6. Add the route — copy the production-sheet route as a starting point,
   change the path and the use case.
7. Add HTTP tests covering: anonymous → 401, INTEGRATOR → 403, valid →
   200 + correct content-type.
8. Add a real-stack integration test against the seeded data.
9. Extend the smoke to call the new endpoint and assert the PDF
   prefix.
10. Update this doc's "Reports shipped" section.

## Reports shipped

- **Production Sheet** — `/reports/production-sheet?machine_id=&date=` — J2a, 2026-05-06

## Reports planned

- **Late-order report** — J2b
- **WO Traveler** — J2c
- **Executive Dashboard** — J2d (in-app, not PDF)

## Conventions

- All PDF routes return `application/pdf` with
  `Content-Disposition: attachment; filename="<report>-<key>.pdf"`.
- HTML preview routes mirror the PDF route under
  `/reports/preview/<report>`. They are gated by
  `Settings.reports_html_preview_enabled` (default off).
- All routes require the `view_reports` permission.
- Templates are A4 portrait, 15mm margins, B&W friendly, header repeats
  per page, page numbering at the bottom-right.
- WeasyPrint is the only renderer. ReportLab is the documented fallback
  if a packaging issue arises (see J2a spec).
```

- [ ] **Step 2: Commit**

```bash
git add docs/reports-howto.md
git commit -m "Add docs/reports-howto.md: how to add a new report (J2a)

Living document. J2b/c/d will extend the 'Reports shipped' section
as each ships."
```

---

## Task 14: Final validation pass

This is a verification task — no new code.

- [ ] **Step 1: Run the full unit + integration suite**

```bash
python -m pytest tests/unit tests/integration -q
```

Expected: 730+ unit + 5 integration PASS, 3 real-stack SKIPPED (or 8 PASS if Postgres still up).

- [ ] **Step 2: Run lint and confirm no new errors vs baseline**

```bash
ruff check planiadvance_v2 tests --output-format=concise | wc -l
```

Expected: same count as baseline (44 errors at start of J2a). If higher, fix the new ones with `ruff check <file> --fix`.

- [ ] **Step 3: Run the smoke against the running stack**

```bash
docker compose -f docker/docker-compose.yml exec -T api python -m planiadvance_v2.infrastructure.industrial_stack_smoke
```

Expected: `"status": "ok"`, includes `production_sheet_bytes` > 1000.

- [ ] **Step 4: Manually save a Production Sheet PDF for sanity-check**

```bash
curl -o /tmp/production-sheet.pdf \
     -H "X-Organization-Id: org-demo" \
     -H "X-User-Id: user-1" \
     "http://localhost:8000/reports/production-sheet?machine_id=<machine>&date=<date>"
```

Open the PDF in a viewer. Sanity-check: header reads correctly, table rows align, page footer shows numbering.

(Substitute `<machine>` and `<date>` with actual seed values.)

- [ ] **Step 5: Update J1-RESUME or write J2-RESUME**

If progressing into J2b right after, append a "J2 progress" section to `docs/J1-RESUME.md` (or fork a new `docs/J2-RESUME.md`). Otherwise, leave a note in MEMORY.md pointing to the next sub-project.

- [ ] **Step 6: Bring stack down**

```bash
make stack-down
```

- [ ] **Step 7: Final commit (if J1-RESUME / docs were touched)**

```bash
git add docs/
git commit -m "Update progress docs: J2a complete, next is J2b Late-order"
```

---

## Self-review checklist (run once before handing off)

- [ ] Spec coverage: every section of `2026-05-06-j2a-pdf-production-sheet-design.md` has at least one task.
- [ ] No "TBD" / "TODO" / "implement later" / "fill in" in any step.
- [ ] Type names match across tasks (`ProductionSheetPayload`, `BuildProductionSheet`, `WeasyprintRenderer`).
- [ ] Tenant scoping used in every read (Task 6 explicit, Task 11 indirect via use case).
- [ ] Each task ends with a commit. Frequent commits = bisectable history.
- [ ] WeasyPrint risk addressed in Task 1 (explicit STOP if Windows packaging fails).
- [ ] No frontend work — explicitly out of scope per spec.
