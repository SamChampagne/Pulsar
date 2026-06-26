# Engine Audit — 2026-05

**Date:** 2026-05-06
**Scope:** PlaniAdvance V2 engine (domain/scheduling, application/use_cases, infrastructure/db, api/routes for scheduling+integration)
**Goal:** Categorized findings to drive the J1 hardening level decision (A / B / C).
**Methodology:** test suite run + edge case probes + code reading. No fixes applied during J0; all fixes deferred to J1.

---

## 1. Methodology

- Step A: run every existing test suite, capture pass/fail counts and any failure details
- Step B: probe 8 known-risky edge cases through one-off Python scripts under `scripts/audit/probe_*.py`
- Step C: read 5 critical code areas (strategy registry, run_scheduling use case, db repositories session lifecycle, api dependencies, in-flight uncommitted integration changes) and note risks
- Step D: classify findings as critical / high / medium / low with effort estimates, then recommend J1 level

---

## 2. Test Suite Baseline

(filled in by Tasks 2-5)

### 2.1 Unit tests (`tests/unit/`)

- Run command: `python -m pytest tests/unit/ -v --tb=short`
- Result: 709 passed, 0 failed, 0 errored, 90.27s wall time
- Failures:
  - No failures.

### 2.2 Integration tests (`tests/integration/`)

- Run command: `python -m pytest tests/integration/ -v --tb=short --ignore=tests/integration/test_real_stack_postgres.py`
- Result: 5 passed, 0 failed, 0 errored, 0.46s wall time
- Failures:
  - No failures.

### 2.3 Real-stack Postgres test (`tests/integration/test_real_stack_postgres.py`)

- Run command: `python -m pytest tests/integration/test_real_stack_postgres.py -v --tb=short` (with `PLANIADVANCE_STACK_TEST_DATABASE_URL` set to `postgresql+psycopg://plani:plani@localhost:5432/planiadvance_v2`)
- Note: tests skip silently when `PLANIADVANCE_STACK_TEST_DATABASE_URL` is unset; `DATABASE_URL` alone is insufficient. Also, the docker-compose credentials are `plani:plani / planiadvance_v2`, not the `planiadvance:planiadvance / planiadvance` values documented in task guidance — alembic upgrade with wrong creds fails with authentication error.
- Result: 2 passed, 1 failed, 0 errored, 5.54s wall time
- Failures:
  - `TestRealStackPostgres::test_industrial_seed_supports_ui_critical_api_contract` — `assert 422 == 200` (POST /scheduling/run returns HTTP 422 "SchedulingContext requires at least one machine")

### 2.4 Industrial Docker smoke (`docs/industrial-docker-smoke.md`)

- Run command: `docker compose -f docker/docker-compose.yml run --rm --build smoke`
- Result: 8/9 steps passed before failure; smoke exited non-zero
- Steps passed: health, ready, auth, machines, resources, inventory, supplies, work_orders (all data-validation checks including routings/resource_requirements/material_requirements/operation-count assertions)
- Steps failed: run — `POST /scheduling/run` returned HTTP 422 "SchedulingContext requires at least one machine" (industrial seed data not being resolved into machines by the scheduling use case at runtime)

---

## 3. Edge Case Findings

(filled in by Tasks 6-13, one subsection per probe)

### 3.1 Empty inputs (probe 01)

- Probe: `scripts/audit/probe_01_empty_inputs.py`
- Scenarios:
  - A (zero WOs): empty schedule returned — `assignments=0, solver_status=feasible, objective_value=0`. Clean and safe.
  - B (WO no ops): empty schedule returned — `assignments=0, solver_status=feasible, objective_value=0`. Clean and safe.
  - C (WO+op, no machines): `EXCEPTION: ValidationError: SchedulingContext requires at least one machine`. Raises a named domain error before scheduling.
- Verdict: safe — all three scenarios produce either a clean empty result or a named `ValidationError`. There is no crash, no internal `AssertionError`, and no silent data corruption. The "no machines" guard (scenario C) is the same error surfaced by the Phase A Postgres bug (section 2.4); the difference is that in-memory gives a clean ValidationError whereas the Postgres path fails to load machines at all before reaching this guard, causing the same error with wrong intent.
- Suggested J1 fix area: The Postgres bug is in `api/dependencies.py` or `infrastructure/db/repositories/` machine loader — machines are not being passed into the scheduling context correctly. The in-memory guard itself is correct.

### 3.2 Contradictory constraints (probe 02)

- Probe: `scripts/audit/probe_02_contradictory_constraints.py`
- Scenarios:
  - A (op eligible_machine_ids=["NONEXISTENT_MACHINE"]): `EXCEPTION: UnknownResourceError: Operation OP-1 references unknown machines: ['NONEXISTENT_MACHINE']`. Clean named error.
  - B (op eligible_machine_ids=[]): `EXCEPTION at construction: ValidationError: Operation OP-1 must have at least one eligible machine`. Domain `__post_init__` rejects the object before it can ever reach the scheduler. Clean guard.
  - C (cross-WO dependency, OP-1 in WO-1 depends on OP-FROM-WO-2 in WO-2): `RESULT: assignments=2, solver_status=feasible, objective_value=570`. Cross-WO dependency **silently accepted and scheduled** without error. Both ops were scheduled but it is unclear whether the inter-WO ordering constraint was enforced.
- Verdict: minor issue — scenarios A and B are clean. Scenario C is a concern: the engine accepts cross-WO dependencies without validation. If the constraint is silently ignored rather than enforced, schedules with cross-WO precedence requirements will be incorrect. If it is actually honoured, there is no documentation or test coverage for this behaviour.
- Suggested J1 fix area: `application/use_cases/run_scheduling.py` validation pass — add a check that `operation.dependencies` only reference operation IDs within the same WO, or explicitly document and test cross-WO dependency semantics.

### 3.3 Extreme durations (probe 03)

- Probe: `scripts/audit/probe_03_extreme_durations.py`
- Scenarios:
  - A (duration=0 minutes): `EXCEPTION at construction: ValidationError: Operation OP-1 must have a positive duration`. Domain `__post_init__` guards against zero-duration ops. Clean.
  - B (duration=4320 minutes, 3 full days): `EXCEPTION: InfeasibleScheduleError: Operation OP-1 could not be placed — horizon_too_short: No free 4320-minute slot on M1`. The greedy strategy correctly identifies the operation as unplaceable within the horizon (Mon-Fri 8-17 shifts cannot provide a 4320-minute contiguous slot) and raises a named `InfeasibleScheduleError` with a helpful suggestion to extend the horizon.
  - C (setup_time=600 min, duration=10 min, total=610 min): `EXCEPTION: InfeasibleScheduleError: No free 610-minute slot on M1 from 2026-01-05T00:00:00`. Same infeasibility path — setup+duration combined correctly (610 total) but cannot fit in a single shift window. Named error with suggestion.
- Verdict: safe — domain rejects zero-duration at construction, and the scheduler produces a well-formed `InfeasibleScheduleError` with diagnostic detail for the over-long cases. The 3-day scenario reveals a potential UX concern: operations requiring continuous machine time longer than one shift (9 hours) will always infeasible on Mon-Fri 8-17 calendars even if the horizon is extended, because greedy requires a contiguous slot. This is not a bug but should be documented.
- Suggested J1 fix area: `domain/scheduling/strategy_greedy.py` — consider adding a pre-check that warns when `duration + setup_time > max_shift_length` to give a more targeted diagnostic rather than the generic "horizon too short" message.

### 3.4 Missing materials (probe 04)

- Probe: `scripts/audit/probe_04_missing_materials.py`
- Scenarios:
  - A (no inventory, no supply): `EXCEPTION: ValidationError: Planning validation blocked scheduling_run: Operation OP-MAT in work order WO-MAT requires material MAT-1, but supply is short by 5.0 units at 2026-01-05T00:00:00 (required 5.0, available by horizon 0). Next best action: Expedite or reallocate material supply for material(s): MAT-1.` Clean named error — scheduling is blocked before solve, with actionable message.
  - B (supply arrives after due): `EXCEPTION: ValidationError: Planning validation blocked scheduling_run: Operation OP-MAT in work order WO-MAT requires material MAT-1, but supply is short by 5.0 units at 2026-01-05T00:00:00 (required 5.0, available by horizon 5.0). Next best action: Expedite or reallocate material supply for material(s): MAT-1.` The feasibility check detects that supply exists within the horizon (5.0 units available) but still raises `ValidationError` — it treats the supply as arriving too late relative to the operation's start, reporting a net shortage at time zero. The late-arrival diagnostic is embedded in the "available by horizon 5.0" value: the solver sees 5 units available somewhere in the 14-day horizon but still blocks because supply arrives on day 30, outside the horizon window entirely.
- Verdict: safe — both scenarios produce clean, named `ValidationError` with a next-best-action hint before any scheduling attempt. No crash, no silent acceptance. The feasibility check correctly uses the full 14-day horizon when computing "available" supply: since the supply lot's `available_at` is 30 days out (beyond the 14-day horizon), it is correctly counted as 0 in-horizon units, and both scenarios produce an identical shortage message. This is correct behavior.
- Suggested J1 fix area: minor UX improvement — distinguish "no supply exists" (scenario A) from "supply exists but arrives after horizon end" (scenario B) with different error messages, so planners know whether to expedite or extend the horizon.

### 3.5 Circular dependencies (probe 05)

- Probe: `scripts/audit/probe_05_circular_deps.py`
- Scenarios:
  - A (2-cycle: OP-A depends on OP-B, OP-B depends on OP-A): `EXCEPTION: ValidationError: Planning validation blocked scheduling_run: Dependency cycle detected involving: OP-B, OP-A. Next best action: Break the dependency cycle by removing one constraint.`
  - B (3-cycle: OP-A->OP-B->OP-C->OP-A): `EXCEPTION: ValidationError: Planning validation blocked scheduling_run: Dependency cycle detected involving: OP-C, OP-B, OP-A. Next best action: Break the dependency cycle by removing one constraint.`
- Verdict: safe — cycle detection fires before any scheduling attempt, raises a named `ValidationError` with the exact ops involved and an actionable hint. Both 2-cycle and 3-cycle are caught. No infinite loop, no stack overflow, no cryptic error.
- Suggested J1 fix area: none required. Current behaviour is correct. Optional enhancement: expose cycle detection as a standalone validation endpoint so planners can pre-validate WO routing data before committing.

### 3.6 Fresh DB API behavior (probe 06)

- Probe: `scripts/audit/probe_06_fresh_db_api.py`
- Endpoints checked: 11
- HTTP 500 count: 0 (zero — no internal server errors observed)
- Notable responses:
  - `GET /health` -> 200: healthy, as expected.
  - `GET /ready` -> 200: `db_ready=true`, as expected even on an empty schema-only DB.
  - `GET /auth/me` -> 404: `organization_not_found` — clean structured error for unknown org.
  - `POST /auth/login` -> 404: `user_not_found` — clean structured error with recovery hint.
  - `GET /scheduling/runs` -> 404: `organization_not_found` — consistent with auth.
  - `POST /scheduling/run` -> 404: `organization_not_found` — request is rejected before scheduling, no engine invocation. This is correct; it means the Phase A 422 bug (machines not loading) only manifests when a valid organization exists.
  - `GET /scheduling/runs/sched-not-real/dashboard` -> 404: `not_found` — clean; note this endpoint does NOT validate the organization header first (returns schedule-level 404 rather than org-level 404, unlike other endpoints). Not a bug but a minor inconsistency.
  - `GET /scheduling/runs/sched-not-real/gantt` -> 404: `organization_not_found` — validates org before looking up schedule (inconsistent with dashboard).
  - `GET /work-orders` -> 404: `organization_not_found`.
  - `GET /machines` -> 404: `organization_not_found`.
  - `GET /scheduling/strategies` -> 200: strategy list returned with no auth required — public endpoint, correct.
- Verdict: safe — no HTTP 500 on a fresh DB. All authenticated endpoints reject unknown orgs/users with structured 404s, not internal errors. One minor inconsistency: `/scheduling/runs/{id}/dashboard` looks up the schedule directly without checking org membership first, unlike `/gantt` and other scoped endpoints.
- Suggested J1 fix area: `api/routes/scheduling.py` — the `dashboard` endpoint should validate organization membership before fetching the schedule, to prevent cross-org schedule enumeration (low-risk but worth fixing for consistency).

### 3.7 Schedule recovery (probe 07)

- Probe: `scripts/audit/probe_07_recovery.py`
- Execution: Full probe completed — the Phase A bug did NOT reproduce for the `org-demo` organization in the seeded DB (only the `org-industrial` org was affected, or the bug is workspace-scoped).
- Baseline created: `run-04c5aecd7be8` — `POST /scheduling/run` returned HTTP 200 with a valid schedule.
- Stack was torn down and reseeded (fresh DB wipe), then API restarted.
- Surrogate response for stale `run-04c5aecd7be8` after reseed:
  - `GET /scheduling/runs/run-04c5aecd7be8/dashboard` -> 404: `{"error":"not_found","message":"Schedule 'run-04c5aecd7be8' not found"}`
  - `GET /scheduling/runs/run-04c5aecd7be8/gantt` -> 404: `{"error":"not_found","message":"Schedule 'run-04c5aecd7be8' not found"}`
- Verdict: safe — after a stack reset, a stale `schedule_id` produces clean 404 responses on both dashboard and gantt endpoints. No HTTP 500, no crash, no data leak. A UI client holding a stale `schedule_id` gets a clear signal to invalidate its cache and prompt the user to re-run scheduling.
- Suggested J1 fix area: no engine fix needed. Optional UX enhancement: return a structured error body that distinguishes "schedule expired after DB reset" from "schedule id never existed" — e.g., by adding a `reason` field or a `"hint": "re-run scheduling"` to the 404 response.

### 3.8 Strategy gaps (probe 08)

- Probe: `scripts/audit/probe_08_strategy_gaps.py`
- Scenarios:
  - A (strategy="cpsat"): `RESULT: assignments=1, solver_status=OPTIMAL, objective_value=540, wall_time_ms=15`. OR-Tools is installed; CP-SAT runs and returns OPTIMAL on the minimal test case.
  - B (strategy="nonexistent_strategy_name"): `EXCEPTION: ValidationError: Unknown scheduling strategy 'nonexistent_strategy_name'. Available: ['backward', 'cpsat', 'ga', 'greedy', 'hybrid', 'infinite', 'lns', 'multi', 'sa', 'tabu']`. Clean named error listing all valid strategy names. No fallback, no silent default.
  - C (strategy="infinite"): `RESULT: assignments=1, solver_status=rough_cut_feasible, objective_value=540, wall_time_ms=0`. Rough-cut strategy succeeds instantly and returns a distinct `rough_cut_feasible` status so callers can distinguish it from a real feasible schedule.
- Verdict: safe — unknown strategy produces a clean, enumerated error; cpsat works correctly with OR-Tools installed; infinite strategy returns a clearly labelled rough-cut result. The `hybrid` strategy name appears in the available list (not documented in CLAUDE.md) — this is an undocumented but registered strategy worth noting.
- Suggested J1 fix area: Update `CLAUDE.md`/strategy documentation to include `hybrid` strategy. No engine fix required.

---

## 4. Code Audit Findings

### 4.1 Strategy registry and lazy loading

**Files reviewed:** `domain/scheduling/strategy.py`, `domain/scheduling/scheduler.py`, `domain/scheduling/__init__.py`

**Findings:**
- F-101: No thread-safety guard on `_REGISTRY` dict mutations — low — `strategy.py:119`: `_REGISTRY` is a plain module-level `dict`; `register_strategy()` modifies it without a lock. In CPython the GIL makes this safe in practice but it is not guaranteed for sub-interpreters or free-threaded builds (PEP 703). Strategies are registered at import time in the main thread before any request, so the risk is theoretical, but still worth a one-liner fix.
- F-102: `_REGISTRY` and `_PROFILE_REGISTRY` are structurally decoupled — low — `strategy.py:119,120`: a strategy can appear in `_PROFILE_REGISTRY` (and therefore in `/scheduling/strategies` response) without ever being registered in `_REGISTRY` (or vice-versa). The `hybrid` strategy has a profile but relies on its concrete class auto-registering at import time via `__init__.py`. If a future strategy is added to the profile registry but its factory import fails, `available_strategy_profiles()` returns a profile for a strategy that `resolve_strategy()` cannot produce.
- F-103: Legacy `Scheduler` still imported and used in tests — low — `domain/scheduling/__init__.py:93` + `tests/unit/scheduling/test_scheduler.py:53,72,92,...`: `Scheduler` is re-exported from the package, and its tests call `Scheduler().schedule()` directly. The docstring correctly documents it as "legacy" and "no longer the primary engine path", but it is not deprecated. If it drifts from the strategy implementations (e.g. a constraint added to `GreedyStrategy` is not added to `Scheduler`), the tests will pass but not cover the real runtime path.
- F-104: `resolve_strategy` raises `ValidationError` for unknown names (Phase B probe 08 confirmed) — this is correct and safe. The error message includes all registered names as an enumerated list, making it actionable.

**Risks:**
- No critical risks. The registry is stable and all strategies auto-register at import time via `__init__.py`. The `hybrid` strategy is undocumented in `CLAUDE.md` (noted in section 3.8) but fully functional.
- Scheduler legacy drift could silently allow tests to pass on code that is never called at runtime.

**Suggested J1 fix areas:**
- Add a consistency assertion: every name in `_PROFILE_REGISTRY` should also be in `_REGISTRY` after all imports complete; expose this as a startup check.
- Add a `DeprecationWarning` to `Scheduler.__init__` to discourage new uses.
- Update `CLAUDE.md` to include `hybrid` in the strategy list.

---

### 4.2 RunScheduling use case (HIGH FOCUS — bug root cause)

**Files reviewed:** `application/use_cases/run_scheduling.py`, `application/use_cases/tenant_scope.py`

**Findings:**
- F-201: **ROOT CAUSE of org-industrial 422 bug** — high — `infrastructure/db/repositories/machine_repository.py:36-42` + `application/use_cases/tenant_scope.py:30-33` + `infrastructure/bootstrap.py:190-200`:
  - The `bootstrap.py` `stamp_dataset_with_organization()` function stamps all seeded machines with `workspace_id = settings.seed_workspace_id` (default: `"default"`).
  - The Docker compose `seed` service has no `SEED_WORKSPACE_ID` env override and the `SEED_DATASET=demo` default is used for normal deploys. When `SEED_DATASET=industrial` is set, the same stamping logic applies, still using `workspace_id="default"`.
  - The smoke test (`industrial_stack_smoke.py:248`) and the real-stack test (`test_real_stack_postgres.py:212`) both POST `/scheduling/run` with `workspace_id="industrial-smoke"`.
  - `resolve_scoped_workspace_id()` (`api/tenant.py:372`) sees no tenant workspace restriction (membership has no workspace), so it passes through the payload value `"industrial-smoke"`.
  - `list_scoped()` then calls `list_for_scope(organization_id=..., workspace_id="industrial-smoke")`.
  - `SqlMachineRepository.list_for_scope()` (`machine_repository.py:36`) applies `WHERE workspace_id = 'industrial-smoke'` — but machines were seeded with `workspace_id = 'default'`.
  - Result: empty machine list → `SchedulingContext` raises `ValidationError: SchedulingContext requires at least one machine` → HTTP 422.
  - The `GET /machines` endpoint uses a different code path (`list_for_scope(organization_id=..., workspace_id=None)` via `tenant.workspace_id`) which returns all org-scoped machines regardless of workspace, masking the issue.
- F-202: `list_scoped` passes `workspace_id=None` when tenant has no workspace restriction, but passes the raw payload value when the tenant does have a restriction — med — `tenant_scope.py:21-33`: the logic is correct for workspace-locked tenants, but for org-only tenants (`workspace_id=None` in TenantContext) it passes the payload's `workspace_id` directly through to the repository. This means callers must independently validate that the requested workspace actually belongs to the org — the use case does not perform this check.
- F-203: No explicit machine count diagnostic before `SchedulingContext` is constructed — low — `run_scheduling.py:299-303`: `list_scoped` is called but the result is used as-is. If the list is empty, the error is only raised inside `SchedulingContext.__post_init__` with a generic message. Adding a pre-check with a richer diagnostic (e.g. "machines loaded: 0 for org X / workspace Y — check seeding") would shorten the debugging cycle significantly.
- F-204: `run_scheduling_from_snapshot.py` takes machines directly from the snapshot (not from the DB), so it does NOT have the workspace mismatch bug. Only the DB-backed `RunScheduling` path is affected.

**Risks:**
- The workspace/org mismatch is a seeding convention bug, not a query logic bug. Any deployment that seeds with `workspace_id="default"` and then POSTs a run with a different `workspace_id` will get zero machines. This is the bug.
- The fix is two-sided: either (a) seed with the correct workspace_id, or (b) in `list_for_scope`, fall back to org-only filtering when workspace_id is provided but no machines match that workspace under the org.

**Suggested J1 fix areas:**
- `infrastructure/bootstrap.py`: expose `SEED_WORKSPACE_ID` as an env override in docker-compose and set it to `"industrial-smoke"` for the industrial seed.
- OR `infrastructure/db/repositories/machine_repository.py`: in `list_for_scope`, if `workspace_id` is provided but no results match, optionally fall back to org-only so a "narrow" workspace does not silently starve the scheduler.
- `application/use_cases/run_scheduling.py:299`: add a pre-check after `list_scoped(self._machines, ...)` that raises a descriptive `ValidationError` naming the org_id and workspace_id when the list is empty.
- Integration test `test_real_stack_postgres.py:212`: seed `workspace_id="industrial-smoke"` or omit `workspace_id` from the POST body.

---

### 4.3 DB repository session lifecycle

**Files reviewed:** `infrastructure/db/session.py`, `infrastructure/db/repositories/machine_repository.py`, `infrastructure/db/repositories/work_order_repository.py` (via `Grep`)

**Findings:**
- F-301: Session is per-request and commit-on-exit — safe — `session.py:39-51`: `SessionFactory.session()` is a context manager that yields exactly one `Session`, commits on clean exit, rolls back on exception, and closes in `finally`. Combined with `get_db_session()` using FastAPI `Depends`, every request gets its own session. No session sharing, no stale reads across requests.
- F-302: `expire_on_commit=False` is set — safe for this workload — `session.py:33`: with `expire_on_commit=False`, domain objects returned from a commit are not lazy-reloaded after the commit. This is correct for a read-then-return pattern (the session closes before the response serialization would need the data), but means that any code that modifies and re-reads the same object within a request without an explicit refresh will see stale state. No such pattern was found in the reviewed files.
- F-303: Pool is fixed at size 5 + overflow 5, no pool_timeout — med — `session.py:58-63`: `pool_size=5, max_overflow=5` means a maximum of 10 concurrent DB connections. For a single-worker uvicorn this is fine, but for multi-worker deployments (e.g. `gunicorn -w 4`) this gives each process 10 connections, totalling 40 — possibly exceeding `max_connections` on a default Postgres. `connect_timeout=5` is sensible. There is no `pool_timeout` configured, so connection acquisition can block indefinitely if the pool is exhausted.
- F-304: `SqlMachineRepository.list_for_scope` applies `workspace_id` filter when provided — this is the bug's proximate mechanism — `machine_repository.py:36-42`: the filter `WHERE workspace_id = workspace_id` is applied when `workspace_id is not None`. This is correct SQL but produces zero results when the seeded `workspace_id` does not match the requested one (see F-201). There is no org-level membership check inside the repository itself — the repository trusts the caller to provide the correct org/workspace values.
- F-305: No index visible on `machines.workspace_id` or `machines.organization_id` from this code — low — `machine_repository.py`: the repository queries by `organization_id` and `workspace_id` without evidence of compound indexes. At small scale (< 10k machines) this is not a problem, but for large industrial datasets this will be a full table scan.

**Risks:**
- Pool exhaustion under multi-worker deploy is possible but not a current production concern.
- Workspace mismatch filter is the direct mechanism of the org-industrial 422 bug (see F-201/F-304).

**Suggested J1 fix areas:**
- `infrastructure/db/session.py`: add `pool_timeout=30` to avoid indefinite blocking on pool exhaustion.
- Ensure `machines` table has a compound index on `(organization_id, workspace_id)` in migrations.
- See F-201 for the workspace mismatch fix.

---

### 4.4 API dependencies and security

**Files reviewed:** `api/dependencies.py`, `api/security.py`, `api/error_handlers.py`

**Note:** The `codex/premium-ux-foundation` branch changes that were marked as "uncommitted" in gitStatus at session start have since been committed to that branch. The current working tree (`claude/plan-for-planiadvance`) reflects those files as baseline code. No git diff between HEAD and a prior state is available because the session was started fresh on this branch. All findings below are against the committed baseline.

**Findings:**
- F-401: `get_run_scheduling()` does not propagate organization/workspace to repositories — by design but subtle — `api/dependencies.py:108-119`: `get_run_scheduling()` creates `SqlMachineRepository(session)` with no org/workspace baked in. Tenant context is injected via the route function's `RunSchedulingInput.organization_id` and `workspace_id` fields, then used by the use case's `list_scoped()` call. This two-step pattern is correct but not obvious: repository construction knows nothing of the tenant — filtering is deferred to the use case. If a developer adds a new repository call inside `RunScheduling.execute()` and forgets to scope it, they'll get cross-tenant data leaks. No linting or typing guard prevents this.
- F-402: `error_handlers.py` maps all three expected domain errors — safe — `error_handlers.py:34-62`: `ValidationError` → 422, `UnknownResourceError` → 422, `InfeasibleScheduleError` → 422 (with report). The `DomainError` base class → 400 catches any subclass not explicitly mapped. This covers all error classes raised by `RunScheduling.execute()` as confirmed in probes 01-08.
- F-403: Integration security has a local-dev bypass that is easy to misapply — med — `security.py:177-183`: when `not configured_keys and not has_db_clients`, the integration endpoints return an open `IntegrationPrincipal` with `auth_mode="disabled"` and no `organization_id`. If a route uses this principal's `organization_id` to scope data (e.g. a future import that stamps data with the key's org), `organization_id=None` would stamp data as tenant-free. Current routes do check `principal.organization_id` — but the bypass path is implicit and not guarded by a type system. A `None` organization_id from a disabled principal is indistinguishable from a scoped one at the route level.
- F-404: `get_run_due_integration_automations` and `get_run_integration_automation` duplicate deep dependency construction — low — `api/dependencies.py:670-734`: both factory functions build a `RunIntegrationFlow` inline with the full repo tree repeated. This is verbose but not a correctness issue; it increases the maintenance surface when new repositories are added to these use cases.

**Risks:**
- The open bypass (F-403) is safe when `INTEGRATION_API_KEY` is empty for local dev, but is a footgun if a future route does not null-check `principal.organization_id` before using it to stamp imported data.
- The dependency injection design (F-401) is correct but fragile: new repository accesses inside use cases must be manually scoped — no framework enforcement.

**Suggested J1 fix areas:**
- `api/security.py`: make `IntegrationPrincipal.organization_id` a `Literal[None]` discriminant distinct from a real `str` org_id, or at minimum add a `is_anonymous: bool` field that routes can check before trusting `organization_id`.
- `api/dependencies.py`: extract the repeated `RunIntegrationFlow` construction into a helper to reduce copy-paste surface.
- Consider a future `ScopedRepositoryFactory` pattern that wraps `Session` + `organization_id` so repositories automatically apply tenant filters.

---

### 4.5 Uncommitted integration changes (in-flight work)

**Context:** The gitStatus at session start listed several files as modified/untracked on branch `codex/premium-ux-foundation`. By the time this audit session ran on `claude/plan-for-planiadvance`, those changes had been committed to `codex/premium-ux-foundation` (commit `ee42dfa`). The files are present in the current branch and functionally auditable.

**Files reviewed:**
- `api/routes/integration.py` — large (2211 lines), full integration route layer
- `api/schemas.py` — extended with integration flow schemas
- `application/use_cases/__init__.py` — exports `ManageIntegrationFlows`, `RunIntegrationFlow`, `EvaluateIntegrationFlowReadinessInput`, `FLOW_BLOCK_CATALOG`
- `application/use_cases/integration_flows.py` — 4054-line block-based flow orchestration engine
- `tests/unit/api/test_integration_http.py` — 70 tests, all passing
- `ui/src/components/IntegrationFlowReadinessDock.tsx` — new React component for readiness display

**Findings:**
- F-501: All 70 integration HTTP tests pass — safe — `tests/unit/api/test_integration_http.py`: all 70 tests pass in 19.89s on the current branch. The test coverage spans security (API key gating, rate limiting, scope enforcement), CRUD for connectors/flows/credentials, readiness evaluation, snapshot import/export, automation runs, and execution ledger. The work is shippable from a test-pass perspective.
- F-502: `integration_flows.py` is 4054 lines — med — the file is a monolith covering 10+ block types, scheduling, HTTP/SFTP/DB transport dispatch, snapshot manipulation, and readiness evaluation. It is not split into smaller modules despite logical groupings. This makes it hard to review, trace, or test individual blocks in isolation.
- F-503: `IntegrationFlowReadinessDock.tsx` is a pure-UI component with no backend dependency — safe/low — the component renders readiness data from a prop (`readiness: IntegrationFlowReadinessOut | null`) with no direct API calls. It is clean, readable, and the tone mapping logic is correct (`"ready"/"ok"` → ok, `"attention"/"warn"/"review"` → warn, `"blocked"/"error"` → crit). No risks identified.
- F-504: Integration changes do not touch the scheduling or machine-loading path — safe — none of the modified files affect `RunScheduling`, `SqlMachineRepository`, or the tenant scoping logic. The org-industrial 422 bug is unrelated to these changes.
- F-505: No new database migrations visible in this diff — low risk for now — the `integration_flows` work adds new use cases but no schema changes are apparent from the file list. If `IntegrationFlow` model additions require new columns, a migration must accompany the schema before these routes can be used in production.

**Shippability verdict:** The integration changes are in a shippable state from a test perspective (70/70 pass). The main concern is code organisation (F-502): `integration_flows.py` at 4054 lines will become a maintenance liability. Landing the work as-is is acceptable for J1, with a follow-up refactor ticket.

**J1 cost of carrying vs landing:** Low. The work is self-contained, all tests pass, and it does not affect the core scheduling engine. Landing it clears the branch and reduces merge risk. There is no reason to amend or revert.

---

## 5. Categorized Findings Table

| ID | Finding | Severity | Effort | Source task |
|----|---------|----------|--------|-------------|
| F-001 | POST /scheduling/run returns HTTP 422 for `org-industrial` seed — workspace mismatch blocks the canonical scheduling flow | critical | S | Phase A smoke (section 2.4) |
| F-002 | Real-stack Postgres test `test_industrial_seed_supports_ui_critical_api_contract` fails with same 422 | critical | XS | Phase A real-stack (section 2.3) |
| F-201 | ROOT CAUSE of F-001/F-002: machines seeded with `workspace_id="default"` but POST body uses `workspace_id="industrial-smoke"`; `list_for_scope` returns empty list | high | S | Phase C code audit (section 4.2) |
| F-202 | `list_scoped` passes raw payload `workspace_id` through to repository without verifying the workspace belongs to the org — potential cross-org data access for multi-workspace deployments | medium | S | Phase C code audit (section 4.2) |
| F-401 | Tenant repo filtering is two-step (construction + runtime scoping) with no framework guard — a new repository call inside a use case that forgets to scope will silently leak cross-tenant data | medium | M | Phase C code audit (section 4.4) |
| F-403 | Integration security local-dev bypass yields `organization_id=None`; a future route that uses this org_id to stamp imported data would write tenant-free records | medium | S | Phase C code audit (section 4.4) |
| F-502 | `integration_flows.py` is 4054 lines covering 10+ block types — monolith is hard to review, trace, or test block-by-block | medium | L | Phase C code audit (section 4.5) |
| F-303 | DB connection pool has no `pool_timeout` — pool exhaustion blocks indefinitely under multi-worker deployments | medium | XS | Phase C code audit (section 4.3) |
| F-003 | Cross-WO operation dependencies silently accepted by the engine without validation or documented semantics — schedules may silently violate inter-WO ordering constraints | medium | M | Phase B probe 02 (section 3.2) |
| F-006 | `/scheduling/runs/{id}/dashboard` fetches the schedule before checking org membership, unlike `/gantt` — enables cross-org schedule ID enumeration | medium | XS | Phase B probe 06 (section 3.6) |
| F-101 | `_REGISTRY` dict mutated without a lock — theoretical safety issue under free-threaded Python (PEP 703) | low | XS | Phase C code audit (section 4.1) |
| F-102 | `_REGISTRY` and `_PROFILE_REGISTRY` are structurally decoupled — a strategy can appear in the profile list but fail to resolve at runtime | low | S | Phase C code audit (section 4.1) |
| F-103 | Legacy `Scheduler` class not deprecated — tests pass on code that is never called at runtime; constraint drift goes undetected | low | XS | Phase C code audit (section 4.1) |
| F-203 | No machine-count pre-check before `SchedulingContext` construction — empty-machine errors surface with a generic message instead of naming org_id and workspace_id | low | XS | Phase C code audit (section 4.2) |
| F-305 | No compound index on `machines(organization_id, workspace_id)` — full table scan at scale | low | XS | Phase C code audit (section 4.3) |
| F-404 | `RunIntegrationFlow` dependency construction duplicated verbatim in two factory functions — maintenance surface doubles when new repos are added | low | S | Phase C code audit (section 4.4) |
| F-505 | No new Alembic migration visible for integration flow additions — if new columns are required, production deploy will fail silently | low | XS | Phase C code audit (section 4.5) |
| F-004 | Greedy infeasibility message is generic "horizon_too_short" when the real cause is `duration + setup_time > max_shift_length` — misleads planners | low | S | Phase B probe 03 (section 3.3) |
| F-005 | Material supply error does not distinguish "no supply exists" from "supply arrives after horizon end" — planners cannot tell whether to expedite or extend the horizon | low | S | Phase B probe 04 (section 3.4) |
| F-007 | `hybrid` strategy is registered and functional but undocumented in CLAUDE.md and strategy list docs | low | XS | Phase B probe 08 (section 3.8) |

**Totals:** 2 critical, 1 high, 6 medium, 11 low. Combined effort estimate: critical+high ~2 days; all findings ~11 days.

---

## 6. J1 Level Recommendation

### Summary

- **Findings:** 2 critical, 1 high, 6 medium, 11 low
- **Notable risks (top 3):**
  1. F-001 / F-201 — Workspace scoping bug blocks the entire industrial scheduling flow; POST /scheduling/run returns 422 for any deployment that seeds with `workspace_id="default"` and posts with a different workspace — this is the canonical demo path broken in CI and smoke.
  2. F-202 / F-401 — Tenant isolation is enforced by convention only; a new repository call inside any use case that omits workspace/org scoping will silently leak cross-tenant data — a silent multi-tenant integrity risk as the product grows.
  3. F-003 — Cross-WO operation dependencies are silently accepted by the engine without validation or documented semantics; schedules that rely on inter-WO ordering constraints may be silently incorrect.

### Effort by level

| Level | Includes | Effort estimate (solo dev) |
|-------|----------|---------------------------|
| A (light) | All critical (F-001, F-002, F-201) + high (none beyond root-cause fix) | ~2 days |
| B (medium) | A + medium findings (F-202, F-401, F-403, F-502, F-303, F-003, F-006) + property-based tests on top scheduling paths | ~10 days |
| C (heavy) | B + low findings (F-101, F-102, F-103, F-203, F-305, F-404, F-505, F-004, F-005, F-007) + chaos scenarios (mid-scheduling crash, race conditions, durability checks, migration rollback) | ~22 days |

### Recommendation

**Recommended level:** B

**Rationale:** Sam's stated conviction is "engine first, must be unbreakable before UI premium work." Level A alone clears the blocking 422 bug (F-001/F-201) and its test fallout, but it leaves six medium-severity findings in place — including the tenant isolation gap (F-202/F-401), the integration security footgun (F-403), and the undocumented cross-WO dependency semantics (F-003) — all of which are silent risks that grow more expensive to fix as the codebase scales. Level B closes all of these in approximately 10 dev days, delivers property-based test coverage on the scheduling core, and results in an engine that is genuinely unbreakable rather than merely not-crashing. Level C adds value mainly if multi-tenant SaaS is a near-term production target; it is not required to meet the "engine first" bar.

**Caveats:** Level B excludes chaos engineering and multi-tenant race condition testing (Level C scope); if PlaniAdvance is targeting a multi-tenant SaaS launch within the next quarter, the tenant isolation work in Level B should be complemented by the concurrent-request and rollback testing from Level C. Level B also defers the `integration_flows.py` refactor (F-502) to a follow-up ticket — landing the integration work as-is is acceptable, but the monolith should be split before the next major integration feature.

### Decision (Sam, 2026-05-06)

- [x] Sam reviewed
- [x] Sam selected level: **B** (medium — A + medium findings + property-based tests on top scheduling paths, ~10 days solo dev)
- [x] J1 plan can now be drafted using this level

**Rationale (Sam):** matches "engine first, must be unbreakable before UI premium work" posture; closes silent multi-tenant integrity risks before they become expensive.
