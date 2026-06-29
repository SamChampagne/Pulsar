# Industrial Validation Roadmap

This branch is about proving the engine/API can support a serious APS UI
without duplicating logic in React. The UI can come after this proof loop is
green because it will consume stable routes instead of inventing planner rules.

## 1. Rich Industrial Dataset

Primary code:

- `planiadvance_v2/infrastructure/industrial_reference.py`
- `planiadvance_v2/infrastructure/seed.py`

The `industrial` seed should remain the canonical demo fixture. It must cover:

- 20+ operations across multiple work orders.
- Alternative machines and routings.
- Secondary resources, including human/tool resources.
- Sequence-dependent setup families.
- Material requirements, inventory and inbound supplies.
- Maintenance downtime and transfer times.

The `industrial_stress` seed must be derived from the same reference builder,
not from a second fake UI-only model. If the UI or engine needs richer data,
enrich this reference builder and let Docker seed expose it through the real
API.

## 2. Real-Stack Smoke Workflow

Primary code:

- `planiadvance_v2/infrastructure/industrial_stack_smoke.py`
- `tests/integration/test_real_stack_postgres.py`
- `docs/industrial-docker-smoke.md`

The smoke must verify the full planner loop:

1. Health/readiness.
2. Login and reusable company/user headers.
3. Industrial master data visibility.
4. Baseline scheduling run.
5. Readiness, dashboard and Gantt read models.
6. Feasible slots for a Gantt operation.
7. Preview/apply planner edit.
8. Compare baseline vs candidate.
9. Publish the accepted candidate.

If this fails, fix the engine/API contract before spending time on UI polish.

## 3. Engine Stress And Scale

Primary code:

- `tests/integration/test_industrial_reference_acceptance.py`
- future stress helpers under `tests/integration/`

Keep the first stress target practical: prove the engine schedules the scaled
industrial dataset deterministically and respects machine/resource/material
constraints. Current baseline is `industrial_stress` with 18 work orders and 66
operations. Later expansion can add 100 and 250 operation profiles with
explicit wall-time budgets.

## 4. APS Quality Gates

Primary code:

- `planiadvance_v2/application/use_cases/run_scheduling.py`
- `planiadvance_v2/application/use_cases/get_schedule_gantt.py`
- `planiadvance_v2/application/use_cases/suggest_operation_slots.py`
- `planiadvance_v2/application/use_cases/compare_scenarios.py`
- `planiadvance_v2/application/use_cases/publish_scenario.py`

Before a big UI sprint, every feature should be connected into this workflow:

- WIP / firm / frozen fields appear in Gantt and readiness.
- Planner edits go through preview/apply, not direct assignment mutation.
- Repair-local produces a candidate schedule.
- Scenario comparison owns KPI/stability/publishability decisions.
- Publish promotes a candidate only through backend guardrails.

Avoid duplicate features. If a concept already exists as diagnostics/readiness,
extend that model instead of adding another response shape.

## 5. UI Handoff

Primary docs:

- `docs/ui-connected-workflow-for-claude.md`
- `docs/ui-mvp-stable-engine-contract.md`

Claude or any UI agent should start from those docs. The UI should provide
forms, Gantt interactions and review screens, but the engine/API remain the
source of truth for decisions, validation, repair, comparison and publishing.
