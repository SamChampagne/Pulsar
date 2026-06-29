# J2a — PDF backend + Production Sheet (design)

**Status:** ready for plan
**Parent:** J2 Reports module (see `2026-05-06-mvp-pilot-vertical-slice-design.md` §J2)
**Sub-projects sequence:** **J2a** → J2b (Late-order) → J2c (WO Traveler) → J2d (Executive Dashboard + `/reports` frontend page)
**Estimated effort:** 2-3 days

## Goal

Land the PDF generator backend end-to-end with the simplest of the three printable reports (Production Sheet). Validate WeasyPrint + Jinja2 against the industrial seed. Establish the patterns that the next three sub-projects (J2b/c/d) will reuse.

## Why this scope first

- Production Sheet is the simplest report (one machine, one day, ops sorted by start time). No ranking, no classification, no multi-page-per-WO.
- It exercises the full stack: tenant scoping (F-401), schedule publication, WeasyPrint rendering, Jinja2 templating, route + permission, smoke.
- A failure on this report (e.g. WeasyPrint Windows packaging) surfaces here before we invest in three more reports.

## Architecture

```
api/routes/reports.py                                    (NEW)
  GET /reports/production-sheet?machine_id=&date=        → application/pdf
  GET /reports/preview/production-sheet?machine_id=&date= → text/html (dev-only)
            ↓ Depends
application/use_cases/reports/build_production_sheet.py  (NEW)
            ↓ uses
application/ports/pdf_renderer.py                        (NEW Protocol)
            ↓ implemented by
infrastructure/pdf/
  __init__.py                                            (NEW)
  weasyprint_renderer.py                                 (NEW)
  templates/
    base.html                                            (NEW)
    production_sheet.html                                (NEW)
    styles/print.css                                     (NEW)
```

Hexagonal layering preserved:
- `domain/` untouched (no domain change for J2a).
- `application/use_cases/reports/build_production_sheet.py` orchestrates aggregation.
- `application/ports/pdf_renderer.py` declares the Protocol used by use cases — decouples WeasyPrint.
- `infrastructure/pdf/` holds the WeasyPrint adapter + Jinja2 templates.
- `api/routes/reports.py` is a thin controller calling the use case.

## Data model

`ProductionSheetPayload` is a printable view DTO (frozen dataclass), NOT a domain entity. Keeping it close to the use case avoids polluting the domain with print-specific concerns.

```python
@dataclass(frozen=True, slots=True)
class ProductionSheetLine:
    operation_id: str
    work_order_ref: str          # human-friendly (e.g. "WO-2026-001")
    work_order_name: str
    sequence: int
    start: datetime
    end: datetime
    setup_minutes: int
    run_minutes: int
    notes: str | None            # operator-facing notes if present


@dataclass(frozen=True, slots=True)
class ProductionSheetPayload:
    machine_id: str
    machine_name: str
    organization_name: str
    workspace_name: str | None
    date: date                   # the requested day (in the workspace's local TZ)
    schedule_id: str             # the published schedule used to build the sheet
    schedule_published_at: datetime
    lines: tuple[ProductionSheetLine, ...]
    total_setup_minutes: int     # convenience aggregates for the footer
    total_run_minutes: int
    total_operation_count: int
```

## Data flow

1. Route receives `machine_id` (str), `date` (YYYY-MM-DD), `TenantContext` from headers.
2. Permission check: `ensure_authenticated_permission(tenant, "view_reports")`.
3. Use case `BuildProductionSheet.execute(machine_id, date, tenant)`:
   - Build `TenantScope.for_workspace(...)` from `tenant.organization_id` + `tenant.workspace_id`.
   - Resolve `Machine` via `machine_repo.with_scope(scope).get(machine_id)`. None → raise `MachineNotFound`.
   - Resolve latest published `Schedule` for the tenant via `schedule_repo` (uses existing `list_recent` filtered by org/workspace + `is_published=True`). None → raise `NoPublishedSchedule`.
   - Filter assignments in that schedule belonging to `machine_id`, with `start.date()` matching the requested date (or overlapping when the assignment crosses midnight). Sort by `start`.
   - For each assignment, look up the parent `WorkOrder` (one batch lookup keyed by ID) and its `Operation` (already in the WO).
   - Assemble `ProductionSheetPayload`.
4. Route calls `pdf_renderer.render("production_sheet.html", payload) → bytes`.
5. Route returns `Response(content=bytes, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename=production-sheet-{machine_id}-{date}.pdf"})`.

## Tenant scoping

Every read in the use case goes through `repo.with_scope(scope).list()` or `.get()` — F-401 pattern. The route requires authenticated tenant (`ensure_authenticated_permission`); anonymous calls get 401. Cross-tenant `machine_id` returns 404 (the scoped `get` hides it).

## Permissions

New permission string: `view_reports`.

Role mapping update in `api/tenant.py`:
| Role | view_reports |
|------|--------------|
| OWNER | ✅ |
| ADMIN | ✅ |
| PLANNER | ✅ |
| VIEWER | ✅ |
| INTEGRATOR | ❌ |

Rationale: VIEWER includes supervisors and shop-floor printable-doc consumers. INTEGRATOR is a system role, not a person.

## API surface (J2a only)

```
GET /reports/production-sheet
    Query: machine_id (str, required), date (YYYY-MM-DD, required)
    Headers: standard tenant context (X-Organization-Id, X-User-Id, X-Workspace-Id)
    Returns: 200 application/pdf  (Content-Disposition: attachment)
             401 if not authenticated
             403 if missing view_reports permission
             404 if machine not in scope OR no published schedule
             422 if date outside published horizon

GET /reports/preview/production-sheet
    Same query+headers as above
    Returns: 200 text/html  (the same rendered template, for dev preview)
    Gated by Settings.reports_html_preview_enabled (False in production)
```

The HTML preview route exists to iterate templates fast in a browser without re-rendering PDFs every time. It must be off by default in production.

## Template structure

`production_sheet.html` extends `base.html`. Layout:

```
┌────────────────────────────────────────────────────┐
│ [Org]  Workspace · Machine name      Date          │
│ Production Sheet                                    │
├────────────────────────────────────────────────────┤
│ Seq  WO     Op           Start  End   Setup  Run   │
│ 001  W-..   Cutting      08:00  09:30 10     80    │
│ 002  W-..   Drilling     09:30  10:15 5      40    │
│ ...                                                 │
├────────────────────────────────────────────────────┤
│ Total ops: N    Setup: 25 min   Run: 380 min       │
│ Schedule: <id> · Published 2026-05-06 14:32        │
└────────────────────────────────────────────────────┘
```

Print CSS:
- A4 portrait, 15mm margins
- 11pt body, 14pt header, 9pt footer
- Header repeats on each page (`@top-center`)
- Page number footer (`@bottom-right`)
- Strict B&W friendly (no color-coded info; printers may be monochrome)

## Error handling

- `MachineNotFoundForReport` → 404 `{"error": "machine_not_found", ...}`
- `NoPublishedScheduleForReport` → 404 `{"error": "no_published_schedule", "message": "Publish a scenario before printing reports."}`
- `RequestedDateOutsideHorizon` → 422 `{"error": "date_out_of_horizon", "horizon_start": ..., "horizon_end": ...}`
- WeasyPrint exception → 503 `{"error": "pdf_render_failed", "diagnostic": "..."}` (logged at ERROR level)

## Performance

Target: P95 < 2s on industrial seed (matches J2 stop condition).
- One DB query per repo (machine, schedule, work_orders batch). No N+1.
- WeasyPrint cold render of an A4 page is ~200-500ms in our experience; well within budget.
- No caching introduced in J2a. Add only if measured perf demands it.

## Tests (TDD)

1. **Unit — `BuildProductionSheet`** with in-memory repos (`tests/unit/use_cases/reports/test_build_production_sheet.py`):
   - happy path: returns expected payload sorted by start time
   - cross-tenant machine → `MachineNotFoundForReport`
   - no published schedule → `NoPublishedScheduleForReport`
   - date outside horizon → `RequestedDateOutsideHorizon`
   - assignments crossing midnight included on both days

2. **Unit — `WeasyprintRenderer`** (`tests/unit/infrastructure/pdf/test_weasyprint_renderer.py`):
   - produces bytes starting with `%PDF-`
   - non-empty for valid template + payload
   - propagates template errors as `PdfRenderError`

3. **Snapshot — production sheet HTML** (`tests/unit/infrastructure/pdf/test_production_sheet_template.py`):
   - golden HTML file under `tests/fixtures/golden/production_sheet.html`
   - renders against a fixed `ProductionSheetPayload`; compared via plain text diff
   - failure prints the diff so template review is easy

4. **Integration — real-stack** (`tests/integration/test_real_stack_postgres.py` → new test):
   - GET /reports/production-sheet?machine_id=...&date=... → 200, content-type PDF, length > 1KB
   - GET without auth → 401
   - GET with cross-tenant machine_id → 404

5. **Smoke** — extend `industrial_stack_smoke.py`:
   - call /reports/production-sheet against the seeded machine; assert HTTP 200 and `%PDF-` prefix

## Risks and mitigations

1. **WeasyPrint Windows packaging — ACTUAL OUTCOME (2026-05-06)**
   - WeasyPrint 68.x on Python 3.14 / Windows 11 fails to load GTK runtime libs (`libgobject-2.0-0`). Pre-built wheels do NOT bundle GTK on Windows; they bundle on Linux/macOS only.
   - **Resolution:** keep WeasyPrint, install GTK3 Runtime Win64 system-wide on dev machines:
     - Installer: https://github.com/tschoonj/GTK-for-Windows-Runtime-Environment-Installer/releases/latest
     - Adds `libgobject-2.0-0.dll` and friends to `C:\Program Files\GTK3-Runtime Win64\bin\` and to `PATH`.
     - One-shot install per dev machine. Documented in `docs/reports-howto.md` § "Dev setup on Windows".
   - **Production deployment** uses Docker Linux images (J6 packaging plan); WeasyPrint installs cleanly there with `apt-get install libpango-1.0-0 libpangoft2-1.0-0` (already standard in WeasyPrint Docker examples).
   - **Sam's machine status:** Sam ran the installer 2026-05-06 after the spike confirmed the failure mode. Subsequent spike runs are expected to succeed.

2. **No clear "published schedule" lookup**
   - `ScheduleRepository.list_recent` is the only listing surface; existing `PublishScenario` use case sets `is_published`. The use case will use `list_recent(...)` with a `published_only=True` filter (we may need to add this filter).
   - **Mitigation:** verify `ScheduleRepository` shape before plan; extend if needed (small additive change).

3. **Time zones**
   - Schedules store `datetime` without explicit TZ today. The "date" query parameter is interpreted in the workspace's local TZ.
   - **Mitigation:** for J2a we treat the schedule's datetimes as workspace-local (matches today's behaviour). Document this assumption. Multi-TZ correctness is out of scope.

## Out of scope (J2a)

- Late-order report, WO Traveler, Executive Dashboard (J2b/c/d)
- Frontend `/reports` page (J2d)
- Async / queued PDF generation
- Email delivery, scheduled reports
- Branding (org logo, custom header colour) — defer to J2d
- Multi-language (FR/EN) — defer to J2d
- Custom paper sizes — A4 only

## Stop conditions for J2a

- Production Sheet PDF renders end-to-end against industrial seed via real-stack test
- All listed unit + integration + snapshot tests pass
- `industrial_stack_smoke.py` includes the new endpoint and reports `status: ok`
- A short doc `docs/reports-howto.md` explains how to add a new report (template + use case + route + tests). Live document; J2b/c/d will extend it.
- 721+ unit tests still green (no regression)
