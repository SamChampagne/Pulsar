# J2d — Executive Dashboard + `/reports` page (design)

**Status:** ready for plan
**Parent:** J2 Reports module (see `2026-05-06-mvp-pilot-vertical-slice-design.md` §J2)
**Sub-projects sequence:** J2a (DONE) → J2b (DONE) → J2c (DONE) → **J2d** (closes J2)
**Estimated effort:** 3-4 days

## Goal

Close the J2 Reports module with the in-app deliverable: an Executive Dashboard
backend (`GET /reports/dashboard`) returning KPIs aggregated over a 7/30/90-day
window, and a new frontend page at `/reports` exposing the dashboard and the three
shipped PDFs (Production Sheet, Late-order, WO Traveler) behind their own download
controls.

## Why this scope

- The V1.0 spec lists "Executive dashboard — KPI trends 7/30/90 days" and "Each PDF
  can be downloaded from the new `/reports` page in the UI" as the two remaining
  J2 stop conditions.
- The 3 PDFs are already wired (J2a/b/c). They need a UI surface to be consumed
  by a planner without remembering the URL conventions.
- The dashboard answers "is the engine producing better plans over time?" — a
  selling-point KPI screen for the V1.0 demo / marketing video (J7).

## Architecture

```
Backend
─────────────────────────────────────────────────────────────────
api/routes/reports.py                                    (UPDATE: + dashboard route)
  GET /reports/dashboard?range=7d|30d|90d                → application/json
            ↓ Depends
application/use_cases/reports/
  executive_dashboard_payload.py                         (NEW DTOs)
  build_executive_dashboard.py                           (NEW use case)
            ↓ uses
application/ports/{schedule, work_order}_repository.py   (existing)
domain/scheduling/metrics.py                             (existing compute_metrics)

Frontend
─────────────────────────────────────────────────────────────────
ui/src/App.tsx                                           (UPDATE: + /reports route)
ui/src/components/AppShell.tsx                           (UPDATE: + nav entry)
ui/src/pages/ReportsPage.tsx                             (NEW)
ui/src/pages/ReportsPage.css                             (NEW)
ui/src/components/ExecutiveDashboard.tsx                 (NEW: KPI cards + sparklines)
ui/src/components/PdfReportCards.tsx                     (NEW: 3 download cards)
ui/src/lib/dashboardApi.ts                               (NEW: typed fetch helper)
ui/package.json                                          (+recharts dep)
```

Hexagonal layering preserved. The dashboard use case reuses `compute_metrics` from
`domain/scheduling/metrics.py` to derive a per-schedule snapshot — no new metrics
code in `domain/`.

## Backend data model

```python
@dataclass(frozen=True, slots=True)
class TopLateOrder:
    work_order_ref: str
    work_order_name: str
    due_date: datetime
    planned_end: datetime | None
    lateness_minutes: int | None


@dataclass(frozen=True, slots=True)
class ScheduleSample:
    schedule_id: str
    published_at: datetime
    makespan_minutes: int
    on_time_ratio: float           # [0, 1]
    avg_utilization: float         # [0, 1] — mean of machine_utilization values


@dataclass(frozen=True, slots=True)
class KpiSnapshot:
    """Latest values + previous-period delta when available."""
    makespan_minutes: int
    on_time_ratio: float
    avg_utilization: float
    makespan_delta_minutes: int | None       # vs previous sample
    on_time_delta: float | None
    avg_utilization_delta: float | None


@dataclass(frozen=True, slots=True)
class ExecutiveDashboardOutput:
    range_label: str               # "7d" | "30d" | "90d"
    range_start: datetime
    range_end: datetime
    generated_at: datetime
    scenarios_published_count: int
    schedule_samples: tuple[ScheduleSample, ...]    # ordered by published_at asc
    current_kpis: KpiSnapshot                       # zero-snapshot when no data
    top_late_orders: tuple[TopLateOrder, ...]       # max 5
```

`KpiSnapshot.*_delta_*` is `None` when there is no previous sample to compare
against (e.g. only one published schedule in the range).

## Backend data flow

1. Route receives optional `range` query param. Default `"30d"`.
2. Permission check: `ensure_authenticated_permission(tenant, "view_reports")`.
3. Use case `BuildExecutiveDashboard.execute(range_label, scope)`:
   - `organization_id = scope.require_organization()`.
   - Parse `range_label` to `timedelta`. Invalid → `ReportError` →
     422 `{"error": "invalid_range", "message": "range must be 7d|30d|90d"}`.
   - `range_end = datetime.now()`; `range_start = range_end - delta`.
   - `schedules = schedule_repo.list_recent(limit=200, organization_id=…,
     workspace_id=…, lifecycle_status="published")`. Filter to those with
     `created_at >= range_start`. Sort by `created_at` asc.
   - For each filtered schedule:
     - Reuse `metadata.metrics` if present, else `compute_metrics(schedule,
       work_orders, horizon_start, horizon_end)`.
     - Build `ScheduleSample` (avg_utilization = mean of metric's
       `machine_utilization.values()`; 0 when empty).
   - Compute `current_kpis`:
     - latest sample → primary values; previous sample (if any) → deltas.
     - Empty samples → zero-snapshot (all zeros, all deltas None).
   - Compute `top_late_orders`:
     - Latest sample's schedule + scoped WOs.
     - For each WO: planned_end = max(assignment.end where work_order_id = wo.id),
       or None.
     - Late = (planned_end > due_date) OR (planned_end is None AND due_date < now).
     - Sort by lateness desc; take top 5. Unplanned (lateness_minutes None) sort
       last.
4. Route returns `ExecutiveDashboardOutput.as_dict()` JSON.

### Tenant scoping

`work_orders.with_scope(scope).list()` for the top-late-orders pass.
`schedule_repo.list_recent(organization_id=..., workspace_id=...)` already
honours scoping (existing port behaviour, used by J2a/b/c).

## Backend API surface

```
GET /reports/dashboard
    Query: range=7d|30d|90d (optional, default 30d)
    Headers: standard tenant context
    Returns: 200 application/json (ExecutiveDashboardOutput.as_dict())
             401 if not authenticated
             403 if missing view_reports permission
             422 if range is not in the allowed set
```

`scenarios_published_count` returns 0 (and `schedule_samples = []`,
`current_kpis = zero-snapshot`, `top_late_orders = ()`) when no published
schedule exists in the range — empty state is a valid 200 response.

## Frontend architecture

### New route

`/reports` mounted in `App.tsx` after `/scenarios`. Wrapped in `RequireSession`.
Added to `AppShell` left nav with the Lucide `FileBarChart` icon (or whichever
matches the existing icon family).

### Page composition

```
ReportsPage (state owner: range tab + dashboard fetch state)
  ├─ SectionHeader: "Reports & Dashboard"
  ├─ Tabs: [7d | 30d | 90d]   (uses existing Tabs primitive)
  ├─ ExecutiveDashboard
  │    ├─ KPI grid (4 cards: makespan, on-time, avg util, scenarios published)
  │    │    Each KPI card uses existing KPI primitive + an embedded
  │    │    <Sparkline /> from recharts (small LineChart, no axes).
  │    └─ Top late orders list (5 rows max, plain divs styled like the
  │         dashboard cards in CompanyHubPage)
  └─ PdfReportCards
       ├─ Card: Production Sheet (machine select + date input + Download)
       ├─ Card: Late-order (Download only)
       └─ Card: WO Traveler (work order select + Download)
```

### Data layer

`ui/src/lib/dashboardApi.ts` exports:
- Typed fetcher `fetchDashboard(range): Promise<DashboardData>` using existing
  tenant header conventions (look at how `SchedulingPage` calls the API).
- TS types mirroring the backend DTO.

For the PDF download buttons we use a plain anchor `<a href={url} download>`
with the tenant headers passed via a runtime fetch + Blob URL fallback (because
`<a download>` cannot inject custom headers). The fallback pattern is:

```ts
async function downloadPdf(url: string) {
  const res = await fetch(url, { headers: tenantHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filenameFromContentDisposition(res.headers) ?? "report.pdf";
  a.click();
  URL.revokeObjectURL(objectUrl);
}
```

This lives in `ui/src/lib/pdfDownload.ts` (NEW). Errors surface as a Flash banner.

### Form state

- Production Sheet: `machineId` (required) + `date` (required, default = today).
  Machine select fetches `/machines` once on mount; date is a native
  `<input type="date">`.
- Late-order: no inputs.
- WO Traveler: `workOrderId` (required). WO select fetches `/work-orders` once
  on mount.

### Loading + empty states

- Dashboard fetch in flight → KPI cards show `Skeleton` (existing primitive).
- Empty range (no published schedule) → KPI cards show "—" with hint
  "Publish a scenario to populate this dashboard."
- Top late orders empty → "No late orders ✓".

### Charts

Install `recharts@^2.x` as a `dependencies` entry in `ui/package.json`.

A small `<Sparkline data={[…number]} />` wrapper component lives in
`ui/src/components/Sparkline.tsx` (NEW) and renders a `<ResponsiveContainer>`
+ `<LineChart>` with no axes / no tooltip — just the trend line. Width 100%,
height 32px, line colour from CSS variables.

## Permissions

Reuse `view_reports` (J2a). No matrix change.

## Performance

Target: P95 < 2s on industrial seed (matches J2 stop condition).

- Dashboard endpoint: O(N) over published schedules in range. At industrial
  seed scale (~3-4 published schedules) this is < 100ms. Worst-case at 200
  schedules (the `list_recent` cap): < 500ms — well within budget.
- Frontend: dashboard fetch is one HTTP call; the page is otherwise static.
  Recharts mounts 3 sparklines (16 points each at 7d / hourly buckets); no
  perceptible cost.

## Tests

### Backend (TDD)

1. **Unit — `BuildExecutiveDashboard`**
   (`tests/unit/use_cases/reports/test_build_executive_dashboard.py`):
   - happy path: 3 published schedules in range → samples sorted, current
     KPIs from latest, deltas computed against previous
   - range "7d" / "30d" / "90d" parsed correctly; invalid range → ReportError
   - empty range (no published schedule) → zero-snapshot, empty samples,
     empty top-late-orders
   - cross-tenant published schedules excluded
   - top late orders sorted by lateness desc, max 5; unplanned overdue WOs
     sort last with lateness_minutes=None

2. **Unit — HTTP route** (extend `test_reports_http.py`):
   - 200 with valid auth, content-type `application/json`, body has the
     expected top-level keys
   - 401 anonymous
   - 403 INTEGRATOR
   - 422 with `range=invalid`

3. **Integration — real-stack** (extend `test_real_stack_postgres.py`):
   - GET `/reports/dashboard?range=7d` → 200, JSON with
     `scenarios_published_count >= 1` (the seed publishes one), schedule
     samples non-empty.

4. **Smoke** — extend `industrial_stack_smoke.py`:
   - call `/reports/dashboard?range=7d`; assert 200 + JSON + non-zero
     `scenarios_published_count`. Add `dashboard_scenarios_count` field to
     `SmokeResult`.

### Frontend (manual + build)

The codebase has no UI test framework (per pattern of other pages).
Validation:

- `npm --prefix ui run build` succeeds (TS strict + Vite production build)
- `npm --prefix ui run dev` launches; navigating to `/reports` renders the
  page on the industrial seed without errors in the console
- Each PDF download button produces a valid PDF file when clicked
- Range tab switching re-fetches and updates KPIs
- Loading/empty states visually correct

## Error handling

Backend (route layer):
- `ReportError("invalid_range")` → 422 `{"error": "invalid_range",
  "message": "..."}`
- Use-case-internal errors are unexpected (no NoPublishedScheduleForReport
  here — empty state is a valid response). Any other exception bubbles up
  to the global handler.

Frontend:
- Dashboard fetch errors → `Flash` banner above the dashboard with a Retry
  button.
- PDF download errors → `Flash` near the corresponding PDF card.

## Risks and mitigations

1. **Schedule.created_at timezone** — `created_at` is naive UTC by
   convention in the codebase. The dashboard uses naive `datetime.now()` for
   `range_end`. Mitigation: stay consistent with the rest of the codebase;
   document the assumption in the use-case docstring.

2. **`list_recent` doesn't expose a `since` filter** — current contract is
   `(limit, organization_id, workspace_id, lifecycle_status)`. We ask for
   `limit=200` then post-filter by `created_at`. Mitigation: 200 is far above
   the realistic published-schedule count for V1.0; if it ever caps in
   practice, extending the port with a `created_after` parameter is a small
   additive change.

3. **Recharts bundle weight** — adds ~250 KB gzipped to the UI bundle.
   Mitigation: the user explicitly chose this option in brainstorming;
   document the bundle delta in the PR description for the next reviewer.

4. **PDF download CORS / auth** — `<a download>` cannot inject the
   `X-Organization-Id` / `X-User-Id` headers, so the implementation goes
   through `fetch` + Blob URL. Mitigation: documented in the spec; covered
   by the `pdfDownload.ts` helper.

## Out of scope (J2d)

- Drilldown from a KPI card into a per-schedule detail page
- Historical trend over > 90 days
- Multi-organization comparison
- CSV / Excel export of the dashboard
- Customisable KPI selection (always the same 4)
- Scheduled email delivery of the dashboard
- Frontend tests (no test framework yet; UI testing is a J4 concern)

## Stop conditions for J2d

- `GET /reports/dashboard?range=…` returns valid JSON against the industrial
  seed via real-stack.
- All listed unit + integration tests pass; HTTP tests count up by 4
  (3 J2d-specific + 1 invalid-range).
- `industrial_stack_smoke.py` reports `status: ok` with
  `dashboard_scenarios_count >= 1`.
- `npm --prefix ui run build` succeeds with zero TS errors.
- `npm --prefix ui run dev` shows the `/reports` page rendering correctly:
  4 KPI cards with sparklines, top-late-orders list, 3 PDF download cards
  each producing a valid PDF when clicked.
- `docs/reports-howto.md` updated to point at `/reports` as the canonical
  consumer of the PDFs and to document the new dashboard endpoint.
- 767+ unit tests still green. Lint baseline (44 pre-existing) preserved.
- J2 module CLOSED — all 4 V1.0 stop conditions met.
