# J2c — WO Traveler (design)

**Status:** ready for plan
**Parent:** J2 Reports module (see `2026-05-06-mvp-pilot-vertical-slice-design.md` §J2)
**Sub-projects sequence:** J2a (DONE) → J2b (DONE) → **J2c** → J2d (Executive Dashboard + `/reports` frontend page)
**Estimated effort:** 1-2 days

## Goal

Ship the third printable report — the WO Traveler. One PDF per work order, printable
for the shop floor: order header (product, quantity, priority, due/release dates,
planned span) followed by every operation in sequence with its eligible machines,
planned machine and dates, setup/run minutes, and material requirements with coverage
status.

The infrastructure landed in J2a + J2b is reused as-is. J2c adds one DTO module, one
use case, one Jinja2 template, two endpoints, and the matching tests.

## Why this scope

- A traveler is what an operator picks up at the start of a job. It's the report a
  shop-floor lead would ask for first; without it the V1.0 reports module is missing
  its most "field-facing" deliverable.
- Coverage status (`covered` / `short` / `unknown`) is read from the
  `material_pegging_report` the engine already emits. No new domain code needed.
- Single WO per request keeps the scope small and the route's URL printable. Multi-WO
  bundling is deferred to J2d / future enhancements.

## Architecture

```
api/routes/reports.py                                    (UPDATE: + wo-traveler routes)
  GET /reports/wo-traveler?work_order_id=                → application/pdf
  GET /reports/preview/wo-traveler?work_order_id=        → text/html (dev-only)
            ↓ Depends
application/use_cases/reports/
  wo_traveler_payload.py                                 (NEW DTOs)
  build_wo_traveler.py                                   (NEW use case)
            ↓ uses
application/ports/{schedule,work_order,...}_repository.py     (existing)
infrastructure/pdf/templates/wo_traveler.html            (NEW)
tests/fixtures/golden/wo_traveler.html                   (NEW snapshot golden)
```

Hexagonal layering preserved:
- `domain/` untouched.
- `wo_traveler_payload.py` declares three frozen dataclasses (
  `WoTravelerMaterialLine`, `WoTravelerOperationLine`, `WoTravelerPayload`) — view
  DTOs with no domain semantics.
- `build_wo_traveler.py` orchestrates aggregation via F-401 ScopedRepository. Reuses
  the `NoPublishedScheduleForReport` error from J2a/J2b and adds a new
  `WorkOrderNotFoundForReport`.
- `wo_traveler.html` extends J2a's `base.html`; reuses `print.css` classes and adds
  per-operation block styling local to the template.

## Data model

```python
CoverageStatus = Literal["covered", "short", "unknown"]


@dataclass(frozen=True, slots=True)
class WoTravelerMaterialLine:
    material_id: str
    required_quantity: float
    coverage_status: CoverageStatus


@dataclass(frozen=True, slots=True)
class WoTravelerOperationLine:
    operation_id: str
    sequence: int
    name: str
    eligible_machine_ids: tuple[str, ...]
    planned_machine_id: str | None      # from schedule, None if not planned
    planned_start: datetime | None
    planned_end: datetime | None
    setup_minutes: int                  # from Operation.setup_time
    run_minutes: int                    # from Operation.duration
    materials: tuple[WoTravelerMaterialLine, ...]


@dataclass(frozen=True, slots=True)
class WoTravelerPayload:
    organization_name: str
    workspace_name: str | None
    schedule_id: str
    schedule_published_at: datetime
    generated_at: datetime
    work_order_ref: str
    work_order_name: str
    product_id: str
    quantity: int
    priority: str                       # WO.priority.name
    status: str                         # WO.status.name
    due_date: datetime
    release_date: datetime
    planned_start: datetime | None      # min start across planned operations
    planned_end: datetime | None        # max end across planned operations
    operations: tuple[WoTravelerOperationLine, ...]    # sorted by sequence
    total_setup_minutes: int
    total_run_minutes: int
    total_operation_count: int
```

`generated_at` is set by the use case (UTC `datetime.now()`) so the rendered PDF
carries its own freshness stamp distinct from `schedule_published_at`.

## Data flow

1. Route receives `work_order_id` (str, required) + `TenantContext` from headers.
2. Permission check: `ensure_authenticated_permission(tenant, "view_reports")`.
3. Use case `BuildWoTraveler.execute(work_order_id, scope)`:
   - `organization_id = scope.require_organization()`.
   - `wo = work_orders.with_scope(scope).get(work_order_id)`. None →
     `WorkOrderNotFoundForReport`.
   - Fetch latest published schedule via `schedule_repo.list_recent(limit=1, ...,
     lifecycle_status="published")`. None → `NoPublishedScheduleForReport`.
   - Index assignments by `operation_id` for O(1) lookup.
   - For each operation in `wo.ordered_operations()`:
     - Look up the assignment by op id; capture `planned_machine_id`, `planned_start`,
       `planned_end` (or `None` if not assigned).
     - For each material requirement: compute
       `required_quantity = req.required_quantity(wo.quantity)` and resolve
       `coverage_status` via `_coverage_status_for(op_id, material_id, diagnostics)`
       (see below).
   - Compute WO planned_start / planned_end across planned operations.
   - Aggregate setup/run totals across all operations (regardless of planned status).
4. Route calls `pdf_renderer.render("wo_traveler.html", payload) → bytes`.
5. Route returns `Response(content=bytes, media_type="application/pdf",
   headers={"Content-Disposition": f"attachment;
   filename=wo-traveler-{work_order_id}.pdf"})`.

### Coverage status resolution

Pure helper. Reads `metadata.diagnostics["material_pegging_report"]["pegging_records"]`
and looks up `(operation_id, material_id)`.

```python
def _coverage_status_for(
    operation_id: str,
    material_id: str,
    diagnostics: dict[str, object],
) -> CoverageStatus:
    pegging = diagnostics.get("material_pegging_report")
    if not isinstance(pegging, dict):
        return "unknown"
    for record in pegging.get("pegging_records") or []:
        if not isinstance(record, dict):
            continue
        if record.get("operation_id") != operation_id:
            continue
        if record.get("material_id") != material_id:
            continue
        status = record.get("coverage_status")
        if status in ("covered", "short"):
            return status  # type: ignore[return-value]
    return "unknown"
```

`unknown` covers two cases: pegging not produced for this op (engine didn't track
it), or the material is required but no reservation entry exists. Both render as
`?` in the template — explicitly *not* false-positive `covered`.

## Tenant scoping

Every read goes through `repo.with_scope(scope).get/list()`. Cross-tenant
`work_order_id` is invisible to the scoped view → `WorkOrderNotFoundForReport`.

## Permissions

Reuse the J2a `view_reports` permission. No matrix change.

## API surface (J2c only)

```
GET /reports/wo-traveler
    Query: work_order_id (str, required)
    Headers: standard tenant context (X-Organization-Id, X-User-Id, X-Workspace-Id)
    Returns: 200 application/pdf  (Content-Disposition: attachment)
             401 if not authenticated
             403 if missing view_reports permission
             404 if work_order not in scope OR no published schedule
             503 if PDF render fails

GET /reports/preview/wo-traveler
    Same query+headers as above
    Returns: 200 text/html (the same rendered template, for dev preview)
    Gated by Settings.reports_html_preview_enabled (False in production)
```

The route URL contains the `work_order_id` so a planner can bookmark/print
deterministically. Filename: `wo-traveler-<work_order_id>.pdf`.

## Template structure

`wo_traveler.html` extends `base.html`. Layout (A4 portrait):

```
┌────────────────────────────────────────────────────────────────────┐
│ [Org] · Workspace · WO Traveler                  2026-05-07 14:32  │
│ Work Order Traveler — WO-IND-ALPHA                                  │
├────────────────────────────────────────────────────────────────────┤
│ Name:     Cabinet 12U                                               │
│ Product:  PROD-CAB12 · Qty: 5 · Priority: HIGH · Status: RELEASED  │
│ Release:  2026-05-04 08:00       Due: 2026-05-10 17:00              │
│ Planned:  2026-05-05 08:00  →  2026-05-08 17:00                     │
├────────────────────────────────────────────────────────────────────┤
│ ─── Op 1 · Cutting ─────────────────────────────────────────────── │
│ Eligible:  CNC-FAST, CNC-FLEX                                       │
│ Planned:   CNC-FAST   2026-05-05 08:00 → 09:30                      │
│ Setup:     10 min · Run: 80 min                                     │
│ Materials: RAW-AL  ×2.5  [covered]                                  │
│            STEEL   ×1.0  [short]                                    │
│ ─── Op 2 · Drilling ────────────────────────────────────────────── │
│ ...                                                                 │
├────────────────────────────────────────────────────────────────────┤
│ Total ops: 4 · Setup: 35 min · Run: 320 min                         │
│ Schedule sched-1 · published 2026-05-07 09:14                       │
└────────────────────────────────────────────────────────────────────┘
```

Print CSS reuses `.header-row`, `.footer-totals` from J2a's `print.css`. The
per-operation block uses a local `.op-block` class defined inline in the template
(scoped to this report; no `print.css` change so J2a / J2b are unaffected).

## Error handling

Reuses J2a's error mapping. All `detail` dicts include both `error` and `message`.

- `WorkOrderNotFoundForReport` → 404 `{"error": "work_order_not_found", "message":
  "Work order WO-X not found in current tenant."}`
- `NoPublishedScheduleForReport` → 404 (reused from J2a/J2b)
- `PdfRenderError` → 503

## Performance

Target: P95 < 2s on industrial seed (matches J2 stop condition).
- One DB query per repo (work_orders scoped by id, schedule list_recent). No N+1.
- Pegging records are already in memory (`metadata.diagnostics`). Materials lookup
  is O(P × M) where P = pegging records, M = WO materials — negligible at industrial
  seed scale.

## Tests (TDD)

1. **Unit — `BuildWoTraveler`** (`tests/unit/use_cases/reports/test_build_wo_traveler.py`):
   - happy path: WO with 2 ops, both planned, with materials → operations sorted by
     sequence, planned start/end set, totals correct
   - cross-tenant `work_order_id` → `WorkOrderNotFoundForReport`
   - no published schedule → `NoPublishedScheduleForReport`
   - unplanned operations: planned_machine/start/end = None for those ops, WO
     planned_start/end = None when ALL ops are unplanned, set to the planned subset
     when only some ops are planned
   - material coverage: `covered` / `short` / `unknown` resolved correctly via
     `material_pegging_report.pegging_records`
   - WO with zero materials: `operations[i].materials == ()` (empty tuple)

2. **Snapshot — wo_traveler template** (`tests/unit/infrastructure/pdf/test_wo_traveler_template.py`):
   - golden HTML at `tests/fixtures/golden/wo_traveler.html`
   - rendered against a fixed payload covering 2 operations, with one mat each in
     `covered` / `short` status, plus an unplanned third op
   - failure prints diff

3. **Unit — HTTP route** (`tests/unit/api/test_reports_http.py`, extend the J2a/b file):
   - 200 with valid auth, content-type `application/pdf`, `Content-Disposition`
     attachment with `wo-traveler-<id>.pdf` in filename
   - 401 anonymous
   - 403 INTEGRATOR
   - 404 when work_order_id not found
   - 200 HTML preview when feature flag enabled, 404 when disabled

4. **Integration — real-stack** (`tests/integration/test_real_stack_postgres.py` extension):
   - GET /reports/wo-traveler?work_order_id=WO-IND-ALPHA → 200, content-type PDF,
     length > 1KB, starts `%PDF-`
   - WeasyPrint-on-Windows fallback: 503 with `pdf_render_failed` (consistent with
     J2a's pattern)

5. **Smoke** — extend `industrial_stack_smoke.py`:
   - call `/reports/wo-traveler?work_order_id=<seeded WO id>`; assert HTTP 200 and
     `%PDF-` prefix; log `wo_traveler_bytes` byte count

## Risks and mitigations

1. **WO with no operations** (theoretically allowed by the entity?) — produce an
   empty `operations` tuple; template's `{% else %}` row reads "No operations
   defined.". Mitigation: covered by an explicit unit test path.

2. **WO with operations but none materials** — render an explicit "—" placeholder
   in the materials column rather than nothing. Mitigation: tested.

3. **WO has operations but schedule was published *before* a routing change** —
   the assignment may reference an op id that no longer exists on the WO (or the
   WO has new ops not in the schedule). The use case treats:
   - assignment whose op id is NOT on the WO: ignored (it belongs to a different
     run snapshot or a deleted op)
   - WO op without assignment: rendered with `planned_*` = None
   This avoids a confusing partial render. Documented as a known limitation:
   the traveler reflects the *current* WO + the *latest* published schedule; if
   they have drifted, the planner should re-publish.

4. **Pegging records not produced** (engine variant or seed without materials): all
   materials get `coverage_status = "unknown"`. Template renders `?`. Tested.

## Out of scope (J2c)

- Executive Dashboard + `/reports` frontend page (J2d)
- Multi-WO traveler (one PDF with N pages)
- Async / queued PDF generation
- Branding (logo) — defer to J2d
- Multi-language (FR/EN) — defer to J2d
- Routing alternatives (`Operation.routings`) — show only `eligible_machine_ids` +
  the planned machine. Listing every alternative would clutter the print without
  helping the operator who only cares about the planned route.
- Resource requirements (operators, tools) — out of scope for V1.0; future addition

## Stop conditions for J2c

- WO Traveler PDF renders end-to-end against industrial seed via real-stack test.
- All listed unit + integration + snapshot tests pass.
- `industrial_stack_smoke.py` includes the new endpoint and reports `status: ok`
  with a `wo_traveler_bytes` byte count > 1KB.
- `docs/reports-howto.md` § "Reports shipped" updated to add the WO Traveler entry.
- 752+ unit tests still green (no regression). Lint baseline (44 pre-existing)
  preserved.
