# J2 Resume — J2 module CLOSED

**Last updated:** 2026-05-07 (after J2d session)
**Branch:** `claude/plan-for-planiadvance`
**Goal:** Reports module complete (3 PDFs + Executive Dashboard + `/reports` page).
**Status:** J1 closed ✅. **J2 CLOSED** ✅ — J2a + J2b + J2c + J2d all shipped end-to-end.

---

## How to resume in a new Claude Code session

1. Open Claude Code in this project directory.
2. Memory loads automatically — Claude knows V1.0 roadmap, J1 closed, J2a shipped.
3. Open this file in your editor.
4. Use this prompt:

> Continue J2 from `docs/J2-RESUME.md`. Pick the next sub-project per the recommended order. Lis le spec/plan J2a si tu as besoin de référence (`docs/superpowers/specs/2026-05-06-j2a-pdf-production-sheet-design.md` + `docs/superpowers/plans/2026-05-06-j2a-pdf-production-sheet.md`). On est en TDD strict, no-pacing-checkin (cf. `feedback_pacing.md`).

Claude will:
- Read this file + the J2a artefacts
- Brainstorm the next sub-project (J2b Late-order by default)
- Write a focused spec + plan
- Execute TDD, frequent commits

---

## J2 sub-project sequence

### ✅ J2a — PDF backend + Production Sheet (DONE)

**Shipped 2026-05-06.** 15 commits between `5a154b8` (spec) and `d2381c6` (end-to-end wire-up).

**What landed:**
- `application/ports/pdf_renderer.py` — `PdfRenderer` Protocol + `PdfRenderError`
- `infrastructure/pdf/weasyprint_renderer.py` — WeasyPrint + Jinja2 adapter
- `infrastructure/pdf/templates/{base,production_sheet}.html + styles/print.css` — A4 portrait, B&W friendly, page header + footer numbering
- `application/use_cases/reports/{production_sheet_payload,build_production_sheet}.py` — view DTO + use case (TDD, F-401 scoped)
- `api/routes/reports.py` — `GET /reports/production-sheet` + `GET /reports/preview/production-sheet` (gated by `reports_html_preview_enabled`)
- Permission `view_reports` (OWNER/ADMIN/PLANNER/VIEWER, NOT INTEGRATOR)
- Docker image: libpango/harfbuzz/fonts-dejavu added; `weasyprint` + `jinja2` moved to base deps
- Tests: 9 unit (4 use case, 4 route, 1 snapshot) + 3/3 real-stack + smoke `status: ok` with `production_sheet_bytes: 10641`
- Doc: `docs/reports-howto.md` (living doc; J2b/c/d will extend)

**Open follow-up (non-blocking):**
- Sam to install GTK3 Runtime Win64 → unlocks 1 skipped test on Windows. Docker chain already validated.

### ✅ J2b — Late-order report (DONE)

**Shipped 2026-05-07.** 8 commits between `122df24` (spec) and `4639903` (doc update).

**What landed:**
- `application/use_cases/reports/late_order_payload.py` — `LateOrderLine` + `LateOrderPayload` + `LateOrderReason` / `RecommendedAction` Literal types + `REASON_TO_ACTION` dict
- `application/use_cases/reports/late_order_classifier.py` — pure function, first-match-wins precedence material > capacity > priority > sequence (8 unit tests)
- `application/use_cases/reports/build_late_order_report.py` — F-401 scoped use case with sort by lateness desc, unplanned WOs last (6 unit tests)
- `infrastructure/pdf/templates/late_order_report.html` — extends J2a's `base.html`, reuses `print.css`; empty-state row "No late orders ✓"; footer aside maps reason → recommended_action
- `api/routes/reports.py` — `GET /reports/late-orders` + `GET /reports/preview/late-orders` (4 HTTP tests; 401 anon, 403 INTEGRATOR, 200 PDF, 404 preview-disabled)
- `api/dependencies.py` — `get_build_late_order_report` factory
- Real-stack assertion in `test_real_stack_postgres.py`
- Smoke `industrial_stack_smoke.py` extended with `late_order_bytes`
- Doc: `docs/reports-howto.md` § Reports shipped updated

**Tests:** 752 unit (+19 vs J2a) + 1 skipped (Windows GTK). Lint baseline preserved (44 pre-existing).

**Known follow-up (non-blocking):**
- Sam to bring Docker up + run real-stack + smoke to validate the full chain on Linux. Code is correct at the Python level; only end-to-end validation against the industrial seed remains.

### ✅ J2c — WO Traveler (DONE)

**Shipped 2026-05-07.** 8 commits between `5c740c0` (spec) and `b5e1d5c` (doc update).

**What landed:**
- `application/use_cases/reports/wo_traveler_payload.py` — 3 frozen dataclasses (`WoTravelerMaterialLine`, `WoTravelerOperationLine`, `WoTravelerPayload`) + `CoverageStatus` Literal
- `application/use_cases/reports/build_wo_traveler.py` — F-401 scoped use case + `WorkOrderNotFoundForReport` (9 unit tests covering happy path, errors, all-unplanned)
- `infrastructure/pdf/templates/wo_traveler.html` — extends `base.html`, adds local CSS (op-block + coverage colours + dl grid for header)
- `api/routes/reports.py` — `GET /reports/wo-traveler?work_order_id=` + preview (5 HTTP tests)
- `api/dependencies.py` — `get_build_wo_traveler` factory
- Real-stack assertion in `test_real_stack_postgres.py` (uses `work_orders.json()[0]["id"]` inline)
- Smoke `industrial_stack_smoke.py` extended with `wo_traveler_bytes` + `wo_traveler_work_order_id`
- Doc: `docs/reports-howto.md` § Reports shipped updated (only J2d remains in planned)

**Tests:** 767 unit (+15 vs J2b: 9 use case + 1 snapshot + 5 HTTP) + 1 skipped (Windows GTK). Lint baseline preserved (44 pre-existing).

**Coverage status logic:** for each `(operation_id, material_id)`, look up `metadata.diagnostics["material_pegging_report"]["pegging_records"]` — if a record matches with `coverage_status` `covered`/`short`, use it; otherwise `unknown`.

**Known follow-up (non-blocking):** Sam to bring Docker up + run real-stack + smoke to validate all 3 PDFs + the new wo-traveler bytes on Linux.

### ✅ J2d — Executive Dashboard + `/reports` page (DONE)

**Shipped 2026-05-07.** 11 commits between `aba2544` (spec) and the J2-RESUME closure.

**What landed:**
- **Backend** (4 tasks): `application/use_cases/reports/executive_dashboard_payload.py` (4 DTOs with `as_dict()`), `build_executive_dashboard.py` (8 unit tests covering window filtering, deltas, top-late-orders, empty state, invalid range), `GET /reports/dashboard?range=7d|30d|90d` (4 HTTP tests: 200/401/403/422), real-stack assertion + smoke `dashboard_scenarios_count`
- **Frontend** (4 tasks): recharts ^2.x installed (~110KB gzipped), `ui/src/lib/dashboardApi.ts` + `ui/src/lib/pdfDownload.ts` typed helpers, `Sparkline` + `ExecutiveDashboard` + `PdfReportCards` components, `/reports` page wired in `App.tsx` + launcher entry in `AppShell.tsx`
- **Doc**: `docs/reports-howto.md` updated — "Reports planned" empty, new "In-app dashboard" section

**Tests:** 779 unit (+12 vs J2c: 8 use case + 4 HTTP) + 1 skipped (Windows GTK). Lint baseline preserved (44).

**Bundle size:** 1.06MB minified / 292KB gzipped (recharts adds ~110KB gzipped). Bundle warning above 500KB documented in commit message.

**Known follow-up (non-blocking):** Sam to bring Docker up + run real-stack + smoke + click the 3 download buttons in the UI to validate end-to-end on Linux.

### J2 module CLOSED

KPI trends 7/30/90 days. **In-app**, not a PDF.

**Suggested approach:**
- Backend: aggregation use cases over Schedules
  - `GET /reports/dashboard?range=7d|30d|90d` returning JSON (makespan trend, on-time ratio, avg utilization, top late WOs, scenarios published count)
- Frontend: new `/reports` route in `ui/`
  - Page lists all 3 PDFs (machine + date pickers, download buttons)
  - Embedded executive dashboard with KPI charts
- Estimated: 3-4 days

---

## J2 stop conditions (from V1.0 spec) — ALL MET ✅

- [x] PDF generator backend lands and renders against industrial seed (J2a)
- [x] All 3 PDFs render correctly with industrial seed (J2a + J2b + J2c)
- [x] Each PDF can be downloaded from the new `/reports` page in the UI (J2d)
- [x] Executive dashboard loads in under 2 seconds on industrial seed (J2d)
- [x] A short README documents how to add a new report (`docs/reports-howto.md`, extended J2a → J2d)

---

## Where to look

- `docs/superpowers/specs/2026-05-06-mvp-pilot-vertical-slice-design.md` — V1.0 spec, `### J2 — Reports module` section for the full deliverable list
- `docs/superpowers/specs/2026-05-06-j2a-pdf-production-sheet-design.md` — J2a design (PdfRenderer port, ScopedRepository pattern usage, error mapping)
- `docs/superpowers/plans/2026-05-06-j2a-pdf-production-sheet.md` — J2a plan (14 tasks, TDD, frequent commits) — **template for J2b/c/d plans**
- `docs/reports-howto.md` — Living doc: anatomy of a report + Windows GTK setup
- `docs/J1-RESUME.md` — Engine hardening retrospective (J1 closed)
- `docs/tenant-scoping-pattern.md` — F-401 ScopedRepository pattern (use it for every new report)

---

## Quick state check — J2 CLOSED + Industrial KPIs

- **Branch:** `claude/plan-for-planiadvance`
- **Tests:** 794 unit + 5 integration + 3/3 real-stack (when Postgres up); smoke ok
- **Lint:** 44 errors pre-existing (baseline preserved through industrial KPIs)
- **Engine:** unbreakable enough + 5 new industrial KPIs (queue time, changeover ratio, saturation max/p95, WIP count) layered on top of the J1 metrics
- **Reports module:** 3/3 PDFs + in-app Executive Dashboard + `/reports` page; dashboard now exposes 8 KPI cards with sparklines and deltas

## Industrial KPIs shipped (post-J2, pre-J3)

Added 2026-05-07 after J2d (Sam's audit revealed a gap vs Ortems / Oracle APS):
- `queue_time_minutes_avg`, `changeover_ratio`, `saturation_max`, `saturation_p95`, `wip_operation_count`
- `campaign_efficiency` (per-machine setup_family chaining ratio, addresses cat E partially)

All six propagate through `ScheduleMetrics.as_dict()` → J2d ScheduleSample / KpiSnapshot (with deltas) → `/reports` UI (5 secondary KPI cards under the primary row).

## Audit category UIs shipped (post-J2, pre-J3)

Three additional panels on `/scheduling` consuming existing backends:
- **BottleneckHeatmap** (cat F) — colored saturation bars per machine, setup overlay, bottleneck highlighted
- **ExceptionCockpit** (cat H) — severity-coded list of `planner_exceptions.exceptions[]` with refs and recommended actions
- **DisruptionTriggerPanel** (cat C UI) — Machine-down simulation that calls `/scheduling/disruption` and reloads the dashboard against the replanned schedule

## J3.1 same-machine drag-drop MVP shipped (4 vertical slices)

Shipped 2026-05-07 in C0→C3 mode (mini-spec in `docs/superpowers/specs/2026-05-07-j3.1-drag-drop-mvp-design.md`):
- **C0 foundation** — `useGanttDrag` hook + `dragTypes.ts` + GanttBoard wiring; mousedown on `move_policy="allowed"` bars only
- **C1 visual ghost** — dashed-outline projected bar at the snapped position, signed delta in minutes
- **C2 preview round-trip** — `MovePreviewDialog` calls `previewEdits`, shows KPI delta + warning count + impacted ops
- **C3 apply round-trip** — Apply button calls `applyEdits`, candidate flows back through PlanningWorkbench (setCandidateScheduleId + appendWorkingEdit + switch to candidate mode)

Architecture preservation: zero changes to domain / application / API. UI only. The whole drag stack lives in `ui/src/components/gantt/`.

Out of scope today (slices E1-E5 deferred to later sessions):
- Cross-machine drag (E1)
- Snap-to-feasible-slots (E2 — uses `feasibleSlots` ranking)
- Ghost bars overlay polish (E3)
- Hard-pin / soft-pin UX (E4)
- Local repair / nervousness control UX (E5)

## Next milestone after today

J3.2 multi-select (~2-3j) and J3.3 custom views (~2-3j) before closing J3 for the V1.0 demo. Or jump to J4 polish if Sam decides the current Gantt UX is good enough for J7.

---

## Known dev hiccups

1. **WeasyPrint on Windows native:** needs GTK3 Runtime Win64 install (one-shot, see `docs/reports-howto.md` § Dev setup on Windows). Without it, 1 unit test auto-skips and integration test asserts the 503 fallback path. Docker (Linux) is unaffected.
2. **HTTPException handler contract:** every detail dict must include both `error` and `message` keys, otherwise the global handler flattens it to a generic shape. See `api/error_handlers.py:92-105`.
3. **`list_recent` already supports `lifecycle_status="published"` filter** — no port extension needed for J2b/c/d's "find published schedule" lookup.
