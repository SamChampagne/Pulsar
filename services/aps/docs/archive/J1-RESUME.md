# J1 Resume — Where we are, where to continue

**Last updated:** 2026-05-06 (post-F-401)
**Branch:** `claude/plan-for-planiadvance`
**Goal:** complete Level B hardening before moving to UI premium work (J2-J7).
**Status:** ✅ J1 CLOSED. Move on to J2 (Reports module).

---

## How to resume in a new Claude Code session

1. Open Claude Code in this project directory.
2. Memory loads automatically — Claude knows the v1.0 roadmap, the J1 Level B decision, and the user profile.
3. Open this file (`docs/J1-RESUME.md`) in your editor and tell Claude:
   > "Continue J1 from docs/J1-RESUME.md. Pick up where the checklist left off."
4. Claude will read the audit (`docs/engine-audit-2026-05.md`) for full finding details and propose the next fix.

For the full plan + spec context, see:
- `docs/superpowers/specs/2026-05-06-mvp-pilot-vertical-slice-design.md` — v1.0 sellable roadmap
- `docs/superpowers/plans/2026-05-06-j0-engine-audit.md` — J0 plan (already executed)
- `docs/engine-audit-2026-05.md` — 20 findings, severity, effort, J1 Level B recommendation
- `docs/F-401-design-note.md` — design note for the remaining structural fix

---

## J1 Level B checklist

### Critical (2 / 2 done)

- [x] **F-001 + F-002** — canonical flow blocked on industrial seed (HTTP 422 "no machine"). Resolved by F-201 fix.
- [x] **F-201** — workspace_id mismatch between bootstrap and smoke/test. Fixed `fdd8002`.

### High (1 / 1 done)

- [x] **F-201** itself was the high finding (overlaps with critical).

### Medium (5 / 7 done)

- [x] **F-006** — dashboard endpoint org-check inconsistency. Fixed `31cce18`.
- [x] **F-303** — SQLAlchemy pool_timeout + pool_recycle explicit. Fixed `5696378`.
- [x] **F-403** — IntegrationPrincipal is_anonymous flag + require_organization_id helper. Fixed `8b522d8`.
- [x] **F-202** — verify_payload_workspace_in_org guard, applied to /scheduling/run. Fixed `cf540a7`.
- [x] **F-003** — Cross-WO dependencies semantics now documented on Operation entity. Fixed `4308feb`.
- [x] **F-401** — ScopedRepositoryFactory pattern landed. `TenantScope` + `ScopedReadView` + `ScopedRepositoryMixin` in `infrastructure/scoping.py`; 11 SQL + 11 in-memory repos migrated; regression tests in `tests/unit/infrastructure/test_scoped_repository.py` (9 tests, in-memory + SQL contracts). Doc: `docs/tenant-scoping-pattern.md`.
- [ ] **F-502** — `integration_flows.py` monolith (4054 lines). DEFERRED to follow-up per audit recommendation; landing the integration work as-is is acceptable for J1.

### Property-based tests (3 new + 3 existing = 6 total)

- [x] Existing: `test_greedy_strategy_invariants`, `test_cpsat_strategy_invariants`, `test_cpsat_never_worse_than_greedy_on_makespan`
- [x] **NEW: test_greedy_is_deterministic** — same inputs → same schedule (commit `e808bdb`)
- [x] **NEW: test_total_scheduled_duration_matches_input** — conservation of work (commit `e808bdb`)
- [x] **NEW: test_backward_strategy_invariants** — backward strategy honours all invariants (commit `e808bdb`)
- [ ] Optional more: hybrid/multi/sa/tabu/ga/lns coverage. Not required for Level B; nice-to-have.

---

## Recommended order for what's left

J1 is **closed**. The remaining items below are deferred and explicitly out of J1's scope:

1. **(deferred to post-v1.0) F-502** — split `integration_flows.py` into focused modules.
2. **(optional, nice-to-have) Additional property tests** — add coverage for hybrid/sa/tabu strategies if you find regressions.

Next milestone: **J2 (Reports module)** per the v1.0 spec at `docs/superpowers/specs/2026-05-06-mvp-pilot-vertical-slice-design.md`.

---

## What was accomplished in the 2026-05-06 session

Massive session. 17 commits on the branch:

**Planning + audit:**
- `c7772aa` — Add v1.0 sellable roadmap spec
- `21aa74e` — Add J0 engine audit implementation plan
- `c3309a4` — Add engine audit skeleton for J0
- `e2ed84a` — Audit J0: unit tests baseline
- `8f0e018` — Audit J0: integration + real-stack + smoke baseline
- `339543d` — Audit J0: edge case probes 01,02,03,05,08
- `ab2f9b6` — Audit J0: edge case probes 04, 06, 07
- `6029879` — Audit J0: code-level audit
- `c8b2de3` — Audit J0: synthesis + J1 level recommendation
- `c6448a5` — Audit J0: Sam selected Level B
- `a71797f` — Add J1-RESUME.md

**Engine fixes (J1 Level B):**
- `fdd8002` — Fix F-201: workspace_id alignment (debloque canonical flow)
- `5696378` — Fix F-303: SQLAlchemy pool_timeout + pool_recycle
- `31cce18` — Fix F-006: scope dashboard endpoint by tenant
- `8b522d8` — Fix F-403: IntegrationPrincipal is_anonymous + require_organization_id
- `cf540a7` — Fix F-202: verify_payload_workspace_in_org for /scheduling/run
- `4308feb` — Fix F-003: document cross-WO dependency semantics
- `e808bdb` — Add property-based tests: determinism + duration + backward

**State at end of session:**
- 712 unit tests pass (+3 vs start)
- 3/3 real-stack tests pass (+1 vs start)
- 9/9 industrial Docker smoke (+1 vs start)
- Canonical 8-step flow works end-to-end on industrial seed
- F-401 has a design note ready for next session

---

## Stop condition for J1 — MET

J1 is closed when:
- ✅ All findings selected for Level B are resolved or explicitly deferred (F-001/F-002/F-201/F-006/F-303/F-403/F-202/F-003/F-401 done; F-502 deferred to post-v1.0)
- ✅ Property-based tests on top scheduling paths exist and pass (6 total, 3 added during J1)
- ✅ All test suites green: 721 unit + 5 integration + 3/3 real-stack against Docker postgres (validated 2026-05-06 post-F-401)
- ✅ Industrial Docker smoke passes (`status: ok`, 22 assignments, 8 feasible slots, 1 comparison)
- ⏳ Sam says "engine is unbreakable enough" (subjective gate — pending sign-off)

J2 next: Reports module.
