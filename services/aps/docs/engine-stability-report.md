# Engine Stability Report

This note documents the planner-facing stability diagnostics added on top of
the existing stability KPIs.

The core helper is:

- `planiadvance_v2/application/use_cases/stability_report.py`
- `build_stability_report(...)`

It does not replace `domain/scheduling/metrics.py`. The domain metrics still own
the numeric KPIs such as changed operation count, machine changes, start shift,
and stability ratio. The report adds explainability for humans and support
tools.

## What The Report Explains

The report compares a current schedule to a baseline schedule and returns:

- changed, moved, machine-changed, introduced, and removed operation counts
- frozen operation count
- frozen operation changes, if any
- non-impacted changes, which are a useful nervousness signal
- total start shift minutes
- a simple nervousness score
- top change reasons
- a bounded list of changed operation details

Each changed operation includes previous and current timing/machine data plus
`change_reasons`, such as `moved`, `machine_changed`, `introduced`, `removed`,
`frozen`, or `impacted`.

## Current Wiring

The report is exposed in diagnostics for:

- `RunScheduling` when a baseline schedule is supplied
- `CompareStrategies` when a baseline schedule is supplied
- `RunDisruption` against the disrupted source schedule

This gives the UI and future ERP/MES support tools enough detail to answer:

- What moved?
- Was the movement caused by the disruption or by planning nervousness?
- Did any frozen operation change unexpectedly?
- Which operations were introduced or removed?

## Extension Rules

- Keep numeric KPI logic in `domain/scheduling/metrics.py`.
- Keep planner-facing explanations in `application/use_cases/stability_report.py`.
- If a new rescheduling mode is added, pass its frozen and impacted operation ids
  into `build_stability_report` instead of creating a separate comparison model.
