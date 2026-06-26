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
   `base.html`. Accesses the DTO as `{{ ctx.field }}`. Style via
   `styles/print.css`.
4. **Route** — `api/routes/reports.py`. Calls the use case, asks the
   `PdfRenderer` to render, returns `application/pdf`. Permission gate:
   `view_reports`.

Plus the supporting tests:

- Unit test of the use case with in-memory repos (TDD).
- Snapshot test of the template
  (`tests/unit/infrastructure/pdf/test_<report>_template.py`).
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
9. Extend the smoke to call the new endpoint and assert the PDF prefix.
10. Update this doc's "Reports shipped" section.

## Reports shipped

- **Production Sheet** — `/reports/production-sheet?machine_id=&date=` —
  J2a, 2026-05-06. PDF per machine per day. Table of operations sorted by
  start time with setup/run minutes. Footer totals. Schedule traceability.
- **Late-order report** — `/reports/late-orders` — J2b, 2026-05-07. PDF
  listing every late WO in the latest published schedule with an
  engine-classified reason (`material` / `capacity` / `priority` /
  `sequence`) and a canonical recommended action. Sorted by lateness desc;
  unplanned overdue WOs sort last with `planned_end=—`. Empty state
  ("No late orders ✓") is a valid render.
- **WO Traveler** — `/reports/wo-traveler?work_order_id=` — J2c, 2026-05-07.
  One PDF per work order: header (product/qty/priority/dates), operations
  in sequence with eligible + planned machines, planned start/end, setup/
  run minutes, and per-op materials with coverage status (`covered` /
  `short` / `unknown` from `material_pegging_report`). Unplanned operations
  render with `Planned: —`. Returns 404 on cross-tenant or unknown WO id.

## Reports planned

(none — J2 module closed)

## In-app dashboard

- **Executive Dashboard** — `/reports` page (UI) + `GET /reports/dashboard?range=`
  (backend) — J2d, 2026-05-07. KPI trends over a 7d/30d/90d window: makespan,
  on-time ratio, average utilization, top late orders, scenarios published count.
  Sparklines via recharts. The same `/reports` page also exposes download buttons
  for the three PDF reports.

## Conventions

- All PDF routes return `application/pdf` with
  `Content-Disposition: attachment; filename="<report>-<key>.pdf"`.
- HTML preview routes mirror the PDF route under
  `/reports/preview/<report>`. They are gated by
  `Settings.reports_html_preview_enabled` (default off, dev-only).
- All routes require the `view_reports` permission. Granted to OWNER,
  ADMIN, PLANNER, VIEWER. INTEGRATOR is excluded.
- Templates are A4 portrait, 15mm margins, B&W friendly, header repeats
  per page, page numbering at the bottom-right.
- WeasyPrint is the only renderer. ReportLab is the documented fallback
  if a packaging issue arises (see J2a spec § Risks).

## Dev setup on Windows

WeasyPrint requires GTK runtime DLLs that are NOT bundled in pre-built
wheels for Windows (Linux/macOS wheels do bundle them).

**One-shot per dev machine:**

1. Download the GTK3 Runtime Win64 installer from
   <https://github.com/tschoonj/GTK-for-Windows-Runtime-Environment-Installer/releases/latest>.
2. Run the installer with default options. Make sure "Set up PATH
   environment variable" is checked.
3. Restart any open terminal windows to pick up the new PATH.
4. Verify with:
   ```python
   from weasyprint import HTML
   HTML(string="<p>x</p>").write_pdf()
   ```

In CI / Docker (Linux), WeasyPrint installs cleanly via
`pip install weasyprint` plus `apt-get install libpango-1.0-0
libpangoft2-1.0-0` in the base image. The pilot Docker image (J6)
will set this up.

The PDF byte test in `tests/unit/infrastructure/pdf/test_weasyprint_renderer.py`
auto-skips when the GTK runtime is not loadable, so dev machines without
GTK installed can still run the rest of the unit suite. The HTML render
path uses Jinja2 only and runs everywhere.
