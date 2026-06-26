# Engine Material Pegging Report

This note documents the planner-facing material pegging report added on top of
the existing `MaterialLedger` reservation trace.

The core helper is:

- `planiadvance_v2/application/use_cases/material_pegging_report.py`
- `build_material_pegging_report(...)`

The solver still owns material timing and reservation through
`domain/scheduling/material_ledger.py`. The report is a read model built from
the existing `material_reservations` diagnostics.

## What The Report Explains

The report consolidates:

- reservation count
- material count
- operation count
- required, covered, and uncovered quantity by material
- coverage ratio by material
- source usage across inventory and inbound supply
- blocked operations when a reservation is not fully covered
- normalized pegging records for API/UI drill-down

Main status values:

- `none`: no material reservations were emitted
- `covered`: every reservation is fully covered by inventory/supply
- `short`: at least one reservation has uncovered quantity

## Current Wiring

`enrich_planner_diagnostics` now attaches the report in two places:

- top-level diagnostics: `material_pegging_report`
- planner read model: `planner_diagnostics.material_pegging_report`

`result_summary` also uses the report to surface concise highlights such as
fully covered materials or uncovered material reservations.

## Extension Rules

- Keep reservation logic in `MaterialLedger`.
- Keep report aggregation in `material_pegging_report.py`.
- If the engine adds substitutions, shelf-life, batch constraints, or material
  reservations by lot/serial, extend the report records rather than replacing
  `material_reservations`.
