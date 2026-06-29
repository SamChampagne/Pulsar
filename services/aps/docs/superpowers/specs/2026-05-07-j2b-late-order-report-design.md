# J2b — Late-order report (design)

**Status:** ready for plan
**Parent:** J2 Reports module (see `2026-05-06-mvp-pilot-vertical-slice-design.md` §J2)
**Sub-projects sequence:** J2a (DONE) → **J2b** → J2c (WO Traveler) → J2d (Executive Dashboard + `/reports` frontend page)
**Estimated effort:** 1.5-2 days

## Goal

Ship the second of three printable reports — the Late-order report. List every work
order whose planned completion in the latest published schedule overruns its due date,
sorted by lateness, with an engine-classified reason and a canonical recommended action.

The infrastructure landed in J2a (PdfRenderer port, WeasyprintRenderer adapter,
`base.html`, `print.css`, `view_reports` permission, route module, smoke harness, doc
template) is reused as-is. J2b adds one DTO, one use case, one Jinja2 template, one
route, and the matching tests.

## Why this scope

- A serious APS must surface "what is late and why". The MVP spec lists this as the
  second of three printable reports.
- The classification is built on top of diagnostics the engine already emits
  (`material_pegging_report`, `planner_exceptions`, infeasibility blockers). No new
  domain code is required — we read what the schedule already produced.
- A canonical `reason → recommended_action` enum keeps the UI and template simple,
  translatable later, and consistent with the engine's existing recommendation
  vocabulary.

## Architecture

```
api/routes/reports.py                                    (UPDATE: + late-orders route)
  GET /reports/late-orders                               → application/pdf
  GET /reports/preview/late-orders                       → text/html (dev-only)
            ↓ Depends
application/use_cases/reports/
  late_order_payload.py                                  (NEW DTO)
  build_late_order_report.py                             (NEW use case)
  late_order_classifier.py                               (NEW pure helper)
            ↓ uses
application/ports/{schedule,work_order,machine,...}_repository.py    (existing)
infrastructure/pdf/templates/late_order_report.html      (NEW)
tests/fixtures/golden/late_order_report.html             (NEW snapshot golden)
```

Hexagonal layering preserved:
- `domain/` untouched.
- `late_order_classifier.py` is a pure function in `application/use_cases/reports/`
  (no I/O); it accepts schedule + WO + diagnostics and returns a typed `LateOrderReason`
  literal. Lives in application because its taxonomy is print-specific.
- `build_late_order_report.py` orchestrates aggregation via F-401 ScopedRepository.
- `late_order_report.html` extends the J2a `base.html`; reuses `print.css` classes
  (`.header-row`, `.lines`, `.footer-totals`, `.numeric`).
- `api/routes/reports.py` adds two thin endpoints calling the use case.

## Data model

```python
LateOrderReason = Literal["material", "capacity", "priority", "sequence"]
RecommendedAction = Literal[
    "expedite_material",
    "add_overtime_or_reroute",
    "review_priority",
    "split_lot_or_reroute",
]

REASON_TO_ACTION: dict[LateOrderReason, RecommendedAction] = {
    "material": "expedite_material",
    "capacity": "add_overtime_or_reroute",
    "priority": "review_priority",
    "sequence": "split_lot_or_reroute",
}


@dataclass(frozen=True, slots=True)
class LateOrderLine:
    work_order_ref: str          # WO id (e.g. "WO-2026-001")
    work_order_name: str
    due_date: datetime
    planned_end: datetime | None # None when the WO has no assignment yet
    lateness_minutes: int | None # planned_end - due_date, or None when unplanned
    priority: str                # CRITICAL/HIGH/NORMAL/LOW (Priority.name)
    reason: LateOrderReason
    recommended_action: RecommendedAction


@dataclass(frozen=True, slots=True)
class LateOrderPayload:
    organization_name: str
    workspace_name: str | None
    schedule_id: str
    schedule_published_at: datetime
    generated_at: datetime
    horizon_start: datetime | None
    horizon_end: datetime | None
    lines: tuple[LateOrderLine, ...]   # sorted: lateness desc, unplanned last
    total_late_count: int
    total_lateness_minutes: int        # sum across planned + late lines
    by_reason: dict[LateOrderReason, int]  # {"material": 3, "capacity": 2, ...}
```

`generated_at` is set by the use case (UTC `datetime.now()`) so the rendered PDF carries
its own freshness stamp distinct from `schedule_published_at`.

## Data flow

1. Route receives `TenantContext` from headers (no query params).
2. Permission check: `ensure_authenticated_permission(tenant, "view_reports")`.
3. Use case `BuildLateOrderReport.execute(scope=...)`:
   - `organization_id = scope.require_organization()`.
   - Fetch latest published schedule via `schedule_repo.list_recent(limit=1,
     organization_id=..., workspace_id=..., lifecycle_status="published")`. None →
     `NoPublishedScheduleForReport` (same error class as J2a, raised from the
     reports module).
   - Pull all WOs in scope: `work_orders = work_repo.with_scope(scope).list()`.
   - For each WO, compute `planned_end = max(a.end for a in schedule.assignments if
     a.operation_id in wo.operation_ids())` (or `None` if no assignment).
   - Filter to late WOs: `planned_end is None and due_date < generated_at` (unplanned,
     overdue) OR `planned_end > due_date`.
   - For each late WO call `classify_late_order_reason(wo, schedule, metadata,
     all_work_orders)` → `LateOrderReason`. Map to `RecommendedAction` via
     `REASON_TO_ACTION`.
   - Sort: `lateness_minutes is None` last; otherwise descending.
   - Aggregate totals + `by_reason`.
4. Route calls `pdf_renderer.render("late_order_report.html", payload) → bytes`.
5. Route returns `Response(content=bytes, media_type="application/pdf",
   headers={"Content-Disposition": "attachment;
   filename=late-orders-<schedule_id>-<YYYYMMDD>.pdf"})`.

### Classification logic (`classify_late_order_reason`)

Pure function. Accepts:
- `wo`: the late WorkOrder
- `schedule`: the published Schedule
- `metadata`: `ScheduleRunMetadata` (carries `diagnostics`)
- `all_work_orders`: list of WOs in tenant scope (for priority comparison)

Algorithm — first match wins:

1. **`material`** — `metadata.diagnostics["planner_exceptions"]["exceptions"]` contains
   any item where `work_order_id == wo.id` AND `kind == "material_shortage"`.
   Fallback: `metadata.diagnostics["material_pegging_report"]["blocked_operations"]`
   has any item whose `operation_id` is in `wo.operation_ids()` (the report keys
   blocked operations by `operation_id`, not WO id, so the classifier translates
   via the WO's own operation set). We probe both paths defensively because
   strategies emit one or the other depending on the failure mode.
2. **`capacity`** — exception with `work_order_id == wo.id` AND `kind in
   {"horizon_too_short", "machine_overload", "no_eligible_machine"}`. Capacity
   bottleneck.
3. **`priority`** — at least one *other* WO in `all_work_orders` is on-time AND has
   strictly higher `Priority` AND shares at least one machine in its assignments with
   this WO's assignments. Means a higher-priority WO crowded this one out.
4. **`sequence`** — default fallback. The WO is late because of routing/precedence with
   no explicit material/capacity/priority signal.

Unplanned WOs (no assignment) skip the schedule-dependent steps and go directly to
classification by signals from `metadata.diagnostics`; if nothing matches they default
to `sequence` (the engine could not place them in routing order).

The classifier returns a single `LateOrderReason` literal; callers do not need to
inspect underlying signals.

## Tenant scoping

Every read goes through `repo.with_scope(scope).list()` / `.get()` (F-401). Cross-tenant
WOs and machines are invisible to the scoped view; cross-tenant schedule IDs are not
addressable by the route (the route uses the tenant's latest published schedule, not a
client-supplied id).

## Permissions

Reuse the J2a `view_reports` permission. No matrix change.

| Role | view_reports |
|------|--------------|
| OWNER | ✅ |
| ADMIN | ✅ |
| PLANNER | ✅ |
| VIEWER | ✅ |
| INTEGRATOR | ❌ |

## API surface (J2b only)

```
GET /reports/late-orders
    Query: (none)
    Headers: standard tenant context (X-Organization-Id, X-User-Id, X-Workspace-Id)
    Returns: 200 application/pdf  (Content-Disposition: attachment)
             401 if not authenticated
             403 if missing view_reports permission
             404 if no published schedule for the tenant
             503 if PDF render fails (WeasyPrint exception)

GET /reports/preview/late-orders
    Same headers as above
    Returns: 200 text/html (the same rendered template, for dev preview)
    Gated by Settings.reports_html_preview_enabled (False in production)
```

A schedule with zero late WOs returns 200 with a non-empty PDF that displays a
celebratory empty state ("No late orders ✓"). This is by design — the report's value
also lies in confirming that nothing is late.

## Template structure

`late_order_report.html` extends `base.html`. Layout (A4 portrait):

```
┌────────────────────────────────────────────────────────────────────┐
│ [Org]  Workspace · Late-order Report               2026-05-07 14:32 │
│ Late-order Report                                                    │
├────────────────────────────────────────────────────────────────────┤
│ WO       Name             Due       Planned   Late  Pri  Reason     │
│ WO-001   Cabinet 12U      05-04 17  05-06 09  +16h  HIGH material   │
│ WO-014   Steel frame      05-05 17  05-08 12  +43h  NORM capacity   │
│ ...                                                                  │
├────────────────────────────────────────────────────────────────────┤
│ By reason: material 3 · capacity 2 · priority 1 · sequence 0         │
│ Total late: 6     Total lateness: 154 hours                          │
│ Schedule abc123 · published 2026-05-07 09:14                         │
└────────────────────────────────────────────────────────────────────┘
```

`Reason` cell shows the literal (`material` / `capacity` / `priority` / `sequence`).
`Action` line below the table footer summarizes recommended actions per reason — keeps
the per-row width manageable on A4 portrait.

Print CSS (already in `print.css`, no additions expected):
- A4 portrait, 15mm margins, 11pt body
- Header repeats per page; page numbering bottom-right
- B&W friendly — the reason column uses text only (no colour codes)

## Error handling

Reuses J2a's error mapping (`api/error_handlers.py`). All `detail` dicts include both
`error` and `message` keys (see hiccup #2 in `J2-RESUME.md`).

- `NoPublishedScheduleForReport` → 404 `{"error": "no_published_schedule",
  "message": "Publish a scenario before printing reports."}`
- `PdfRenderError` → 503 `{"error": "pdf_render_failed", "message": ...}`

J2a's `MachineNotFoundForReport` and `RequestedDateOutsideHorizon` do not apply — this
report has no machine or date input.

## Performance

Target: P95 < 2s on industrial seed (matches J2 stop condition).
- One DB query per repo (schedule, work_orders batch). No N+1.
- The diagnostics dict is already in memory once `metadata` is fetched.
- Classification is O(N) per WO with a constant number of signal lookups, plus the
  priority comparison which is O(N²) in the worst case (each WO compared to others on
  shared machines). At industrial seed scale (~50 WOs) this is < 10ms.

## Tests (TDD)

1. **Unit — `classify_late_order_reason`** (`tests/unit/use_cases/reports/test_late_order_classifier.py`):
   - material signal → "material"
   - capacity signal (horizon_too_short / machine_overload / no_eligible_machine) → "capacity"
   - higher-priority neighbour on shared machine → "priority"
   - no signals → "sequence"
   - signal precedence: material beats capacity beats priority beats sequence
   - WO id mismatch in diagnostics is ignored (no false positive)

2. **Unit — `BuildLateOrderReport`** (`tests/unit/use_cases/reports/test_build_late_order_report.py`):
   - happy path: 3 late WOs, sorted by lateness desc, totals correct, by_reason correct
   - empty: no late WOs → empty `lines`, `total_late_count=0`, by_reason all zero
   - cross-tenant WO not included (F-401 scoped repo behaviour)
   - no published schedule → `NoPublishedScheduleForReport`
   - unplanned WO with past due date → included with `planned_end=None`,
     `lateness_minutes=None`, sorted last
   - assignment crossing midnight: `planned_end` taken as the actual `assignment.end`
     (not the date)

3. **Snapshot — late-order template** (`tests/unit/infrastructure/pdf/test_late_order_report_template.py`):
   - golden HTML at `tests/fixtures/golden/late_order_report.html`
   - rendered against a fixed payload covering all four reasons
   - failure prints diff

4. **Unit — HTTP route** (`tests/unit/api/test_reports_http.py`, extend the J2a file):
   - 200 with valid auth, content-type `application/pdf`, `Content-Disposition`
     attachment header
   - 401 anonymous
   - 403 INTEGRATOR
   - 404 when no published schedule
   - HTML preview returns 200 text/html when feature flag enabled, 404 when disabled

5. **Integration — real-stack** (`tests/integration/test_real_stack_postgres.py` extension):
   - GET /reports/late-orders → 200, content-type PDF, length > 1KB, starts `%PDF-`
   - GET without auth → 401
   - GET with cross-tenant headers → 401/404 per existing scoping behaviour

6. **Smoke** — extend `industrial_stack_smoke.py`:
   - call `/reports/late-orders`; assert HTTP 200 and `%PDF-` prefix
   - log byte count under a `late_order_bytes` key alongside `production_sheet_bytes`

## Risks and mitigations

1. **Industrial seed has zero late WOs** — the empty-state path may be the only one
   exercised by smoke. Mitigation: assert smoke renders > 1KB regardless (the empty
   template still produces a multi-page header/footer scaffold). The "many late WOs"
   path is covered by unit tests with synthetic schedules.

2. **Diagnostics shape varies between strategies** — greedy/backward/cpsat all emit
   `material_shortage` but the dict path differs slightly
   (`material_pegging_report` vs `planner_exceptions.exceptions`). Mitigation: the
   classifier probes both paths defensively and treats absence as "no signal" (falls
   through to next rule). Existing unit tests cover at least 2 strategy outputs.

3. **Priority classification is heuristic** — declaring "priority" requires inferring
   that another WO crowded this one out. With many machines this is noisy. Mitigation:
   we require BOTH higher priority AND shared machine; if the heuristic produces
   too many false positives in practice, drop step 3 and treat all unsignalled
   lateness as `sequence`. Documented as a known follow-up for J2d/J3.

4. **Unplanned WO handling** — a WO that the engine could not place at all has no
   `planned_end`. Mitigation: include with `lateness_minutes=None`, render `—` in the
   template's lateness column, sort to bottom. Counts as "1 late" in `total_late_count`
   when its due date has passed.

## Out of scope (J2b)

- WO Traveler, Executive Dashboard (J2c/d)
- Frontend `/reports` page (J2d)
- Async / queued PDF generation
- Email delivery, scheduled reports
- Branding (org logo, custom header colour) — defer to J2d
- Multi-language (FR/EN) — defer to J2d
- Drilling into the actual short material id or machine id in the report — only the
  reason and the canonical action are shown. Per-row diagnostic detail is a future
  enhancement.

## Stop conditions for J2b

- Late-order PDF renders end-to-end against industrial seed via real-stack test.
- All listed unit + integration + snapshot tests pass.
- `industrial_stack_smoke.py` includes the new endpoint and reports `status: ok` with a
  `late_order_bytes` byte count > 1KB.
- `docs/reports-howto.md` § "Reports shipped" updated to add the Late-order entry.
- 733+ unit tests still green (no regression). Lint baseline (44 pre-existing errors)
  preserved.
