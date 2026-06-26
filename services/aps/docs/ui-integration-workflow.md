# UI Integration Workflow

This document is the UI-facing contract for ERP/MES data import in PlaniAdvance.
Use it before creating new integration screens so the UI stays connected to the
engine instead of inventing duplicate JSON forms.

## Existing Backend Routes

All routes are under `/integration`.

- `POST /planning-snapshot/csv/validate`
- `POST /planning-snapshot/csv/import`
- `POST /planning-snapshot/validate`
- `POST /planning-snapshot/import`
- `POST /planning-snapshot/export`
- `POST /published-plan/export`
- `GET /automations`
- `POST /automations`
- `GET /automations/health`
- `POST /automations/run-due`
- `POST /automations/{job_id}/run`
- `GET /journal`

The local development API is open when no integration key is configured. If
`INTEGRATION_API_KEY`, `INTEGRATION_READ_API_KEY`, or `INTEGRATION_RUN_API_KEY`
is set, the UI must send `X-API-Key`.

The browser client already wraps these routes in `ui/src/lib/api.ts`.

## Tenant Behavior

When the UI is logged in, `tenantHeaders()` sends:

- `X-Organization-Id`
- `X-User-Id`

Integration import now uses that active organization when headers are present.
That means imported ERP data is visible in the normal scoped Data, Scheduling
and Gantt pages. If an API client omits tenant headers, the import remains
global/local-dev compatible.

Export also respects the active organization when tenant headers are present.

## UI Page

The current UI page is `ui/src/pages/IntegrationPage.tsx`.

It supports:

- CSV pilot imports using `calendars_csv`, `machines_csv`, `work_orders_csv`,
  and `operations_csv`.
- Canonical JSON file import for full APS depth.
- Validate before import.
- Import into the active company context.
- Export current company snapshot.
- Export the current published APS plan as a full or delta ERP return.
- Persist workspace-scoped automation jobs for inbound/outbound ERP/MES flows.
- Inspect automation health across due jobs, retry backoff, exhausted retries,
  validation blockers and worker locks.
- Run supported automation jobs and record the execution result in the journal.
- Execute due scheduled automations from the same contract a future worker will use.
- Integration journal review.
- ERP automation loop guidance for inbound pull, planner approval and outbound
  publish/export.

Do not add a separate unconnected ERP form unless it calls the same API methods.

## Automation Pattern

The Integration UI is a manual control panel over the same API contract that an
ERP connector or scheduled job should use. A production integration should not
write directly into planner tables or bypass validation.

Automation jobs are now persisted through:

- `GET /integration/automations?workspace_id={id}`
- `POST /integration/automations`
- `GET /integration/automations/health?workspace_id={id}`
- `POST /integration/automations/run-due`
- `POST /integration/automations/{job_id}/run`

The API now executes supported jobs synchronously when `run` is called:

- Outbound `snapshot_export` jobs export the current scoped planning snapshot.
- Outbound `published_plan_export` jobs export a published APS plan.
- Outbound `connector_published_plan_export` jobs push that published plan to a connector.
- Inbound `snapshot_import` jobs validate and import a canonical snapshot from
  `config.snapshot`.
- Inbound `csv_import` jobs validate and import CSV content from
  `config.csv_bundle`.

Scheduled jobs can be evaluated through `POST /integration/automations/run-due`.
The endpoint checks enabled workspace jobs with `trigger_type = "scheduled"` and
a configured interval, then executes only the jobs that are due. It supports
`dry_run` for worker health checks and uses the same execution use case as
manual `Run now`, so SaaS and self-hosted deployments can share the same
contract.

Supported interval config examples:

```json
{
  "mode": "snapshot_export",
  "schedule": { "interval_minutes": 60 },
  "retry": {
    "max_attempts": 5,
    "base_delay_seconds": 60,
    "max_delay_seconds": 3600,
    "multiplier": 2
  }
}
```

```json
{ "mode": "snapshot_export", "cadence": "hourly" }
```

The repository now includes a thin self-hostable worker for this loop:

```powershell
planiadvance automations run-due --loop
```

The worker opens a database session per pass, calls the same
`RunDueIntegrationAutomations` use case as the API route, then sleeps according
to `INTEGRATION_WORKER_INTERVAL_SECONDS`. Hosted SaaS deployments can run the
same command as a background service, while self-hosted deployments can use the
`integration-worker` Docker Compose service.

Scheduled execution uses a persisted runtime lock on each automation job:

- `lock_owner`
- `locked_until`

Before executing a due job, the runner must claim it. If another worker already
holds a non-expired claim, the job is reported as `locked` and skipped for that
pass. `INTEGRATION_WORKER_LOCK_TTL_SECONDS` controls the claim expiry, so a
crashed worker does not block the job permanently.

Failed executions update retry state on the automation job:

- `attempt_count`
- `next_attempt_at`
- `last_error_code`
- `last_error_at`

While `next_attempt_at` is in the future, the due runner reports the job as
`backoff`. When `max_attempts` is reached, the job reports `retry_exhausted`
until an operator updates the job/config or runs it manually after fixing the
connector issue.

Operators can inspect `GET /integration/automations/health` or the UI Health
tab before touching data. The health contract summarizes due jobs, active
backoff, exhausted retries, current locks, stale locks, failed jobs and
validation blockers, then returns prioritized next actions.

Webhook and ERP pull loops should continue to call the same import/export
contracts rather than writing directly to planner tables.

In the UI and product copy, keep this language split clear:

- `snapshot` = the inbound planning dataset APS reads and validates
- `published plan` = the planner-approved outbound result ERP should receive

Recommended loop:

1. External connector reads ERP/MES data.
2. Connector maps it to the canonical planning snapshot.
3. Connector calls `POST /integration/planning-snapshot/validate`.
4. If valid, connector calls `POST /integration/planning-snapshot/import`.
5. Scheduled workers call `POST /integration/automations/run-due`.
6. Planner runs or repairs the schedule through the scheduling API/Gantt.
7. Planner publishes a candidate with `POST /scheduling/scenarios/{id}/publish`.
8. Connector or flow calls `POST /integration/published-plan/export`.
9. Connector pushes approved dates/resources/statuses back to ERP/MES.

The key product rule: import and export are automated, but publish is the
business approval point. Until publish, Gantt edits are candidate scenarios and
should not be treated as official ERP commitments.

Normal outbound ERP behavior should support two modes:

- `full`: send the whole published plan for bootstrap, reconciliation, or recovery
- `delta`: send only operations changed by APS since the last or selected publish

## CSV Scope

The CSV adapter is intentionally minimal for pilots:

- calendars
- machines
- work orders
- operations

It does not currently express secondary resources, inventory, supplies,
material requirements, setup matrices, routings, or WIP fields. Use canonical
JSON import/export for those fields until a richer CSV or XLSX adapter exists.

## Recommended UI Flow

1. Login/select company.
2. Open Integration.
3. Load CSV files or a canonical JSON snapshot file.
4. Validate.
5. Fix validation issues when blocked.
6. Import.
7. Open Data and confirm counts.
8. Run Scheduling.
9. Open Gantt and use candidate/preview/apply/publish workflow.

## Next UI Improvement

The next useful improvement is an import wizard:

- Step 1: choose source type (`CSV pilot`, `canonical JSON`, future `ERP API`).
- Step 2: validate and show row-level issues.
- Step 3: show data profile delta before import.
- Step 4: import and optionally launch scheduling.

Keep this wizard as a thin client over the existing integration and scheduling
API contracts.

For the broader product workflow, including working candidates and publish
rules, see `docs/productization-workflow.md`.
