# UI MVP Stable Engine Contract

This document is the handoff contract for building a UI on top of the
PlaniAdvance engine without duplicating scheduling logic in the frontend.
For a concrete UI implementation guide without manual JSON editors, see
`docs/ui-connected-workflow-for-claude.md`.

The engine must remain usable without a UI. A future Gantt, data screen or ERP
connector should call these API workflows and let the engine own validation,
repair, decisions, diagnostics and publishing.

## Stable Workflow

Use this sequence for the first serious UI MVP:

1. Load system status with `GET /health` and `GET /ready`.
2. Resolve user/company context with `GET /auth/me` or `POST /auth/login`.
3. Load strategy capabilities with `GET /scheduling/strategies`.
4. Load or create master data through the existing CRUD routes.
5. Create a baseline plan with `POST /scheduling/run`.
6. Render planner summary with `GET /scheduling/runs/{schedule_id}/dashboard`.
7. Validate planner readiness with `GET /scheduling/runs/{schedule_id}/readiness`.
8. Render the Gantt with `GET /scheduling/runs/{schedule_id}/gantt`.
9. Ask for landing zones with `GET /scheduling/runs/{schedule_id}/operations/{operation_id}/feasible-slots`.
10. Simulate planner edits with `POST /scheduling/runs/{schedule_id}/edits/preview`.
11. Save an accepted simulation with `POST /scheduling/runs/{schedule_id}/edits/apply`.
12. Compare candidates with `POST /scheduling/scenarios/compare`.
13. Publish the accepted candidate with `POST /scheduling/scenarios/{schedule_id}/publish`.

Do not mutate persisted assignments from the UI. Any drag/drop, freeze, pin,
priority change or standby/reinsert decision must go through edit preview/apply.

## Core Routes

| Route | UI purpose | Engine ownership |
| --- | --- | --- |
| `GET /health` | API process check | Fast availability |
| `GET /ready` | DB/readiness check | Persistence availability |
| `POST /auth/login` | Create user/company session context | Membership validation and permissions |
| `GET /auth/me` | Recover current session from headers | Central tenant context |
| `POST /auth/switch-organization` | Switch active company for same user | Membership validation and permissions |
| `POST /auth/logout` | Clear local session | Stateless logout acknowledgement |
| `GET /scheduling/strategies` | Strategy dropdowns and capability help text | Strategy registry, maturity and runtime availability |
| `POST /scheduling/run` | Build baseline or full scenario | Solver, decisions, KPI, diagnostics |
| `GET /scheduling/runs` | Scenario/run picker | Persisted run history |
| `GET /scheduling/runs/{id}/dashboard` | Planner summary cards | KPI/read model |
| `GET /scheduling/runs/{id}/readiness` | Planner-ready status | Blockers/warnings/recommended actions |
| `GET /scheduling/runs/{id}/gantt` | Gantt bars and lanes | Read-only schedule projection |
| `GET /scheduling/runs/{id}/operations/{op}/feasible-slots` | Assisted drag landing zones | Capacity/material/resource checks |
| `POST /scheduling/runs/{id}/edits/preview` | Non-persisted simulation | Planner action mapping and repair |
| `POST /scheduling/runs/{id}/edits/apply` | Persist draft candidate | Scenario creation and deltas |
| `POST /scheduling/scenarios/compare` | Baseline vs candidate review | KPI/stability/publishability |
| `POST /scheduling/scenarios/{id}/publish` | Officialize candidate | Publish guardrails |
| `POST /scheduling/disruption` | Event-driven replan | Disruption analysis and repair |
| `POST /scheduling/ctp` | Promise-date check | Rough-cut/finite promise logic |

## Account And Company Boundary

`Organization` is the company/tenant boundary in the current codebase. Keep
that domain name in the API and database for now, but label it as Company in
the UI when that is clearer for users.

The model is:

- `Organization`: company / tenant
- `UserAccount`: login identity
- `Membership`: user-to-company role
- `Workspace`: planning workspace inside a company

The engine does not know about login state. The API resolves the acting
company/user context and scopes repositories before calling engine use cases.
This keeps the APS engine usable from CLI, tests, integration jobs and future
ERP adapters without UI auth.

MVP roles and permissions:

- `owner` / `admin`: company, accounts, data, scheduling, Gantt edits, publishing and integrations
- `planner`: data view, schedules, Gantt edits and publishing
- `viewer`: read-only planning/data views
- `integrator`: data/planning read access plus integration management

Frontend rule: call `/auth/login` once, store the returned company/user context,
and let the shared API client attach `X-Organization-Id` and `X-User-Id`.
Do not make each page manage headers separately.

UX rule: expose `/login` as a first-class route. Planner pages should require
an active local session context and redirect to `/login` when no user/company
context exists. The current MVP is not password/JWT authentication yet; it is a
validated company-user session seam that can later be replaced with real auth
without changing scheduling workflows.

## Gantt Contract

`GET /scheduling/runs/{schedule_id}/gantt` exposes
`interaction_contract.version = interactive-gantt-v1`.

The UI can depend on:

- `assignment_mutation = forbidden`
- `edit_flow = ["preview", "apply_to_scenario", "publish"]`
- `supported_preview_actions`
- `machine_lanes`
- `work_order_lanes`
- `items`

Each Gantt item should be enough to render a rich bar without extra lookups:

- operation and work-order IDs/names
- machine ID/name
- setup/run start and end
- setup/run minutes
- product, sequence, release date, due date, priority and status
- eligible machines
- secondary resource IDs
- material requirement IDs
- dependency IDs
- late/critical/preempted flags
- baseline delta fields when comparing against a baseline
- WIP / firm / frozen disposition fields: `execution_status`,
  `planning_lock`, `planning_zone`, `movable`, `override_required`,
  `lock_reason`, `required_override_action`
- execution/time-fence source fields: `actual_start`, `actual_machine_id`,
  `actual_end`, `actual_consumed_minutes`, `remaining_duration_minutes`,
  `planned_remaining_minutes`, `wip_repair_mode`, `firm_until`, `frozen_until`
- editable action names

If a UI needs a field not listed here, add it to the Gantt read model rather
than building a second frontend-side scheduling model.

Planner UI rule: use `movable`, `override_required`,
`required_override_action`, `firm_until` and `frozen_until` from the API to
enable or block drag/drop. Do not duplicate WIP/fence rules in React.
When `planning_lock` is WIP/completed, show `actual_machine_id` as the source
machine if present; the engine uses it to freeze shop-floor state when no
baseline schedule exists.
For partial WIP, render `segments` by `segment_type`: `actual_consumed` is
history, `remaining_planned` is the engine-solved remaining segment, and
`remaining_frozen` can still appear on older/manual schedules that did not come
from the WIP repair split. UI actions should always target the canonical
operation id, not the diagnostic synthetic `__actual_consumed` id.

## Planner Edit Contract

The UI sends `PlanningEdit` records. The API maps them into the existing
`PlannerAction` language.

Supported UI edit intents:

- `move_operation`
- `freeze_operation`
- `unfreeze_operation`
- `standby_operation`
- `reinsert_standby_operation`
- `change_priority`
- `override_due_date`
- `exclude_work_order`

The Gantt UI should render action controls from `items[].editable_actions`.
Supported first-class controls are:

- operation move through feasible-slot suggestions
- force machine from eligible machine IDs
- freeze / unfreeze
- standby operation
- change work-order priority
- override work-order due date
- exclude work order

Every control must use preview/apply and create a candidate scenario. The UI
should not patch assignments, work orders or lifecycle metadata directly.

`move_operation` has two levels:

- With `machine_id` only, it maps to `force_machine`.
- With `machine_id`, `start` and `end`, it maps to `pin_operation_window`.

Exact pins are intentionally stricter. They can release machine conflicts for
local repair, but they do not silently release hard secondary-resource or
material conflicts. In those cases the API returns `422` with a planner-facing
recommendation such as `move_or_delay_pin` or `delay_until_material_ready`.

## Diagnostics The UI Should Surface

Every scheduling response should be treated as a decision object, not just a
list of bars.

Important diagnostics:

- `planner_actions`: action impact, frozen counts and action log.
- `planner_decisions`: why the engine chose a strategy/mode.
- `repair_scope`: direct, downstream, conflict and blocking operation IDs.
- `repair_scope.repair_strategy`: whether the replan is targeted, stable,
  full, or blocked until constraints change.
- `repair_scope.recommended_actions`: next-best actions for the planner.
- `planner_guidance`: edit-preview/apply guidance with status, next step,
  repair strategy and impacted/blocking operations.
- `planner_exceptions`: normalized exception list for cards/alerts.
- `planning_disposition`: Gantt/readiness contract version for WIP, firm and
  frozen-zone behavior.
- `stability_report`: what moved compared with the baseline.
- `material_pegging`: demand/supply/material explanation.
- `input_snapshot_hash`: replay/audit anchor.

The UI should show hard blockers as decisions to resolve, not as generic API
errors.

## Strategy Capability Contract

`GET /scheduling/strategies` exposes
`version = strategy-capabilities-v1`.

The frontend must treat this as the source of truth for scheduling strategy
choices. Do not hardcode `greedy`, `backward`, `hybrid`, `cpsat` or future
strategies in React.

Selection rules:

- Use `available = true` before enabling a strategy.
- Use `ui_groups` to decide where a strategy appears: `baseline`, `compare`,
  `advanced` or `api`.
- Use `default_for_baseline = true` for the first baseline run. This should
  normally choose `auto`.
- Show `availability_reason` only in advanced/debug or disabled option help.

Important semantics:

- `auto` is the engine decision layer. It lets the backend select the concrete
  production-safe strategy from data, planner policy and disruption context.
- Experimental/specialized strategies can remain API-visible without being
  exposed in baseline planner forms.
- Runtime dependency checks belong in the API. For example, `cpsat` is
  unavailable when OR-Tools is missing, so the UI should not launch it.

## Multi-Tenant Headers

For account-aware flows, send:

- `X-Organization-Id`
- `X-User-Id`

The backend validates active membership before scoped data is returned or
mutated. For local demo work, seed data should include a valid organization,
user and workspace before running protected scheduling/data flows.

## Local Stable Stack

Recommended local path for API + engine validation:

```powershell
docker compose -f docker/docker-compose.yml down
$env:SEED_DATASET="industrial"
$env:SEED_RESET="true"
docker compose -f docker/docker-compose.yml up --build -d postgres
docker compose -f docker/docker-compose.yml run --rm --build migrate
docker compose -f docker/docker-compose.yml run --rm --build seed
docker compose -f docker/docker-compose.yml up --build -d api
docker compose -f docker/docker-compose.yml run --rm --build smoke
```

Use `SEED_DATASET=industrial` for UI development. Use
`SEED_DATASET=industrial_stress` only when validating larger engine volume; it
contains 18 work orders / 66 operations and is intentionally less convenient for
manual UI review.

The smoke step calls `/health`, `/ready`, `/auth/login`, `/auth/me`,
`/scheduling/run`, `/readiness`, `/dashboard`, `/gantt`, `/feasible-slots`,
`/edits/preview`, `/edits/apply`, `/scenarios/compare` and `/publish` against
the running API. Full procedure: `docs/industrial-docker-smoke.md`.

For local UI development, run the frontend from the `ui` directory:

```powershell
cd ui
npm install
npm run dev
```

The Vite dev server proxies API calls to the backend. If the UI shows
`ECONNREFUSED`, the API is not reachable on the expected backend port.

## Stability Checklist Before UI Expansion

Before a larger UI sprint, keep these tests green:

- API route proof tests for scheduling/Gantt/scenario workflows.
- Unit tests for planner actions, repair scope, validation and replay.
- Integration tests for demo scheduling and seeded data.
- Docker stack smoke test: industrial seed, auth context, API health/readiness,
  run schedule, planner readiness, dashboard, Gantt, feasible-slot read,
  edit preview/apply, scenario compare and publish.

The UI can start once this contract is green because the core product loop is
stable: data in, baseline plan, Gantt read model, edit preview, candidate apply,
compare, publish.

## Scenario UI Guardrails

The UI must represent scenario lifecycle as a first-class workflow:

- Baseline: the active reference plan, preferably the latest feasible published
  run.
- Candidate: a different run created from a what-if baseline run or an
  interactive Gantt edit.
- Compare: `POST /scheduling/scenarios/compare` is the source of truth for KPI
  deltas, stability impact and publishability.
- Publish: `POST /scheduling/scenarios/{id}/publish` promotes the candidate;
  after success the UI should set that `schedule_id` as the active baseline.

Important response fields:

- `comparisons[].metric_delta`: makespan, lateness, on-time and objective
  deltas.
- `comparisons[].stability_report`: moved operations, machine changes,
  nervousness, stability ratio and top operation changes.
- `comparisons[].publish_status`: `publishable`, `review` or `blocked`.
- `comparisons[].recommendation`: planner-facing decision text.
- `recommended_schedule_id` and `publishable_schedule_ids`: button gating and
  recommendation badges.

Do not infer publishability from raw KPIs in the frontend. Review/publish rules
belong to the engine because they depend on solver status, planner exceptions,
frozen changes and stability.

## Runtime Recovery Guardrails

The frontend may persist active schedule IDs, but the API remains the source of
truth. A valid UI must recover from DB reset, Docker reseed, deleted schedules
and tenant changes.

Guardrails:

- Reconcile active baseline/candidate IDs against `GET /scheduling/runs`.
- Keep baseline and candidate distinct.
- Clear active IDs when `/scheduling/runs` returns no records.
- Clear stale IDs when schedule-specific routes return `404`.
- Disable navigation that requires a missing baseline or candidate.
- Treat every Gantt action as asynchronous: show preview/apply busy states and
  prevent duplicate submissions while requests are in flight.
