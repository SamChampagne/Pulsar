# Engine Planner Exceptions

This note documents the unified planner exception read model.

The core helper is:

- `planiadvance_v2/application/use_cases/planner_exceptions.py`
- `build_planner_exceptions(...)`

It does not replace the specialized engine diagnostics. It aggregates them into
a compact planner-facing list that an API, UI, or ERP/MES integration can scan
without knowing every internal report format.

## What The Report Explains

The report consolidates exception cards from:

- feasibility warnings and errors
- infeasibility blockers
- material pegging shortages
- stability and nervousness signals
- disruption impact summaries
- lateness metrics

Top-level fields:

- `status`: `clear`, `attention`, or `blocked`
- `exception_count`
- `error_count`
- `warning_count`
- `dominant_kind`
- `next_best_action`
- `exceptions`

Each exception keeps the source report, kind, severity, message, related ids,
and recommended action when available.

## Current Wiring

The unified report is exposed in diagnostics for:

- `RunScheduling`
- `RunSchedulingFromSnapshot`
- `CompareStrategies`
- `RunDisruption`

It is available in two places:

- top-level diagnostics: `planner_exceptions`
- planner read model: `planner_diagnostics.exceptions`

This gives callers a stable entry point for exception management while keeping
the richer source reports available for drill-down.

## Extension Rules

- Keep detailed domain facts in their original reports.
- Add new aggregation logic in `planner_exceptions.py` only when a planner needs
  a cross-report exception card.
- Do not duplicate scheduling logic in this read model.
- Prefer stable `kind` values because UI filters, ERP mappings, and tests can
  depend on them.
- Keep `recommended_action` short and operational.
