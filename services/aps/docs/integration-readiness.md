# Integration Readiness

PlaniAdvance uses a canonical planning snapshot so ERP, MES, CSV imports, and
future UI workflows do not need to couple directly to internal persistence
tables.

## Recommended ERP Flow

1. ERP exports master and transactional planning data as a canonical snapshot.
2. Client sends `X-API-Key` when an integration API key is configured.
3. Client calls `POST /integration/planning-snapshot/validate`.
4. If `valid=false`, fix the blocking references before importing.
5. If `valid=true` and `readiness_status=degraded`, import is allowed but warnings should be shown to the planner.
6. Client calls `POST /integration/planning-snapshot/import`.
7. Planner runs `/scheduling/run`, `/scheduling/ctp`, or `/integration/scheduling/run-from-snapshot`.
8. Client or support team can inspect `GET /integration/journal` to audit recent exchanges.

## Snapshot vs Published Plan

PlaniAdvance now separates two contracts that used to be easy to confuse:

- `planning snapshot`: the inbound or diagnostic APS dataset
- `published plan export`: the outbound ERP-facing plan after planner approval

Use a planning snapshot when ERP or MES needs to send PlaniAdvance the data
required to build or validate a schedule:

- work orders
- operations
- machines
- calendars
- resources
- inventory and supplies

Use a published plan export when PlaniAdvance needs to send approved scheduling
results back to ERP. This payload is based on a `published` schedule, not on a
draft candidate and not on UI state.

That means the business flow is now:

1. import or refresh the planning snapshot
2. run or repair APS scheduling
3. publish the approved scenario
4. export the published plan to ERP as `full` or `delta`

## Published Plan Export

Read/export route:

- `POST /integration/published-plan/export`

Request example:

```json
{
  "source_system": "erp-rest",
  "workspace_id": "ws-plant-1",
  "schedule_id": "sched-published-current",
  "mode": "delta"
}
```

Supported modes:

- `full`: send the full published plan for the selected schedule
- `delta`: send only operations that changed compared with the previous or
  explicitly selected published schedule

If `mode = delta` and `compare_to_schedule_id` is omitted, PlaniAdvance uses
the previous published schedule in the same tenant/workspace when one exists.

The published plan contract includes:

- work order and operation identity
- planned machine
- planned setup start, start, and end
- previous machine/start/end when exporting a delta
- `change_type`: `created`, `updated`, `removed`, or `unchanged`
- `changed_fields` for updated operations

Normal ERP behavior should be:

- use `full` for first sync, recovery, or reconciliation
- use `delta` for day-to-day planner-approved changes

This matches the common APS loop where ERP may send 100 work orders into APS,
but only the subset actually changed by planning should be pushed back out.

## Integration Security

Integration endpoints are open by default for local development. In Docker,
staging, or production, set:

```env
INTEGRATION_API_KEY=change-me
```

When at least one integration key is configured, every `/integration/*` route
requires:

```http
X-API-Key: change-me
```

The API key header is declared in OpenAPI, so Swagger UI can authorize
integration calls with the same `X-API-Key` value.

Key scopes:

- `INTEGRATION_API_KEY`: full access to read, import, and run endpoints.
- `INTEGRATION_READ_API_KEY`: read-only access to export, validate, and journal endpoints.
- `INTEGRATION_RUN_API_KEY`: access to `/integration/scheduling/run-from-snapshot`.

For commercial deployments, prefer persisted integration API clients over
shared environment keys. Environment keys remain useful as a self-hosted
bootstrap or break-glass fallback; API clients are tenant/workspace scoped,
revocable, auditable, and return the raw secret only once at creation time.

Management endpoints:

- `GET /integration/api-clients`
- `POST /integration/api-clients`
- `POST /integration/api-clients/{client_id}/revoke`

Create request:

```json
{
  "name": "ERP inbound connector",
  "scopes": ["read", "write"],
  "workspace_id": "ws-plant-1",
  "source_system": "erp",
  "expires_at": null
}
```

Create response includes `api_key` once. The stored client record exposes
`key_prefix`, `scopes`, `is_active`, `last_used_at`, and audit fields, but never
the full key or hash. Clients call integration endpoints with the same
`X-API-Key` header used by environment keys.

Persisted scopes:

- `read`: export snapshots, validate snapshots, list journal/read endpoints.
- `write`: import snapshots.
- `run`: run scheduling from snapshot and trigger automation runs.
- `full`: all integration endpoint capabilities, including automation configuration.

When any persisted API client exists, integration endpoints require `X-API-Key`
even if all clients are later revoked or expired. This keeps revocation closed by
default while the management routes can still create a replacement through the
normal tenant/user permission path.

Missing keys return `401 missing_api_key`; incorrect keys return
`403 invalid_api_key`; valid keys without the needed scope return
`403 insufficient_scope`.

## Persisted Connectors

PlaniAdvance now supports persisted outbound and inbound HTTP connectors that
are scoped by tenant and workspace, just like integration API clients and the
journal.

Management endpoints:

- `GET /integration/connectors`
- `POST /integration/connectors`
- `POST /integration/connectors/{connector_id}/test`

These routes are part of the normal tenant/user management flow and require the
`manage_integrations` permission. They are not meant to be managed through
shared `X-API-Key` automation credentials.

Create request example:

```json
{
  "name": "ERP production REST",
  "workspace_id": "ws-plant-1",
  "source_system": "erp-rest",
  "endpoint_url": "https://erp.example.com/api/planning/snapshot",
  "connector_type": "http",
  "method": "POST",
  "auth_type": "bearer",
  "secret_ref": "env:ERP_TOKEN",
  "static_headers": {
    "X-Site": "plant-1"
  },
  "timeout_seconds": 30,
  "is_enabled": true
}
```

Supported connector fields today:

- `connector_type`: currently `http`
- `method`: `GET`, `POST`, `PUT`, `PATCH`
- `auth_type`: `none`, `bearer`, `api_key_header`, `basic`
- `auth_header_name`: required for `api_key_header`
- `username`: required for `basic`
- `secret_ref`: currently `env:NAME` only
- `static_headers`: extra headers added to every request

Connector secrets are never persisted as clear values in the database. The
record stores only the `secret_ref`, and the runtime resolves it when the job
executes or when `/test` is called.

`POST /integration/connectors/{connector_id}/test` performs a lightweight HTTP
call with the configured method, headers, and resolved secret. The response is
stored on the connector record as:

- `last_tested_at`
- `last_test_status`
- `last_test_message`

## Connector-Backed Automation Modes

The existing automation runner can now execute connector-backed snapshot flows
without introducing a second execution path.

Outbound modes:

- `connector_snapshot_export`
- `http_snapshot_export` (alias)
- `published_plan_export`
- `export_published_plan` (alias)
- `connector_published_plan_export`
- `http_published_plan_export` (alias)

Inbound modes:

- `connector_snapshot_import`
- `http_snapshot_import` (alias)

Automation config must include:

```json
{
  "mode": "connector_snapshot_export",
  "connector_id": "ic-123"
}
```

For inbound connectors, `GET` requests send no request body. Non-`GET` inbound
calls may include an optional `request_body` in the job config when the external
system expects a pull trigger payload.

Connector execution reuses the canonical snapshot contract:

- outbound export builds the same canonical snapshot returned by
  `POST /integration/planning-snapshot/export`
- inbound import expects the response body to be a canonical planning snapshot
  JSON payload

Published-plan outbound execution uses the planner-approved contract instead:

- `published_plan_export` returns a `published-plan-export-v1` payload
- `connector_published_plan_export` pushes that published plan JSON directly to
  a persisted connector endpoint

Journal entries for connector executions stay tenant/workspace scoped and record
connector metadata, HTTP status, and payload size without storing connector
secrets or large raw responses.

## Integration Execution Ledger

PlaniAdvance now keeps a separate append-only execution ledger for orchestration
attempts. This complements the journal instead of replacing it:

- the journal answers "what exchange happened?"
- the execution ledger answers "what attempt ran, against which target, by whom,
  and how did it finish?"

Read entries with:

- `GET /integration/executions`
- `GET /integration/executions?execution_kind=automation_run`
- `GET /integration/executions?target_type=flow`
- `GET /integration/executions?workspace_id=ws-plant-1`

Current execution kinds:

- `connector_test`
- `flow_run`
- `automation_run`

Each record includes:

- `execution_kind`, `target_type`, `target_id`, `target_name`
- `status`, `valid`, `message`, `error_code`
- `actor_mode`, `actor_id`, `trigger_type`
- `correlation_id` to stitch nested runs together
- `attempt_number`, `started_at`, `finished_at`, `duration_ms`
- `journal_entry_id` when the attempt also produced a journal event

This route is part of the authenticated integration control plane and requires a
human planner/admin session with `manage_integrations`. Persisted API clients
remain runtime identities; they do not manage or browse the control-plane
execution history.

## Block-Based Integration Flows

PlaniAdvance now exposes persisted block-based integration flows. This is the
backend contract that a future visual flow builder can edit directly without
moving orchestration logic into the UI.

Management endpoints:

- `GET /integration/flow-blocks`
- `GET /integration/flows`
- `GET /integration/flows/{flow_id}`
- `POST /integration/flows`
- `PUT /integration/flows/{flow_id}`
- `POST /integration/flows/{flow_id}/run`

Supported block types today:

- `export_snapshot`
- `export_published_plan`
- `pull_snapshot_from_connector`
- `transform_snapshot`
- `validate_snapshot`
- `require_valid_snapshot`
- `import_snapshot`
- `run_scheduling_from_snapshot`
- `push_snapshot_to_connector`
- `push_published_plan_to_connector`

Example flow definition:

```json
{
  "name": "ERP inbound APS flow",
  "source_system": "erp-rest",
  "workspace_id": "ws-plant-1",
  "blocks": [
    {
      "id": "pull",
      "block_type": "pull_snapshot_from_connector",
      "config": {
        "connector_id": "icn-123"
      }
    },
    {
      "id": "transform",
      "block_type": "transform_snapshot",
      "config": {
        "operations": [
          {
            "op": "default_work_order_field",
            "field": "quantity_uom",
            "value": "ea"
          }
        ]
      }
    },
    {
      "id": "validate",
      "block_type": "validate_snapshot"
    },
    {
      "id": "gate",
      "block_type": "require_valid_snapshot"
    },
    {
      "id": "import",
      "block_type": "import_snapshot"
    }
  ]
}
```

`block_type` and `config` are persisted server-side, validated on create/update,
and executed by the backend. The UI can later render these blocks visually, but
it should not fork the orchestration rules.

Current transform operations:

- `set_metadata`
- `set_source_system`
- `default_work_order_field`
- `map_work_order_field`
- `filter_work_orders_by_field`
- `default_operation_field`
- `map_operation_field`

This keeps data transformation explicit, testable, and auditable without
introducing an unbounded scripting surface into the product.

Published-plan blocks are intentionally separate from snapshot blocks:

- snapshot blocks move APS input data into or out of the engine
- published-plan blocks move planner-approved scheduling results back to ERP

This keeps inbound planning data and outbound commitments as two different
contracts, which is important for commercial ERP integrations.

## Flow-Backed Automations

Integration automation jobs can now trigger a persisted flow instead of a
single snapshot mode.

Automation config:

```json
{
  "mode": "flow",
  "flow_id": "ifl-123"
}
```

This reuses the existing automation runner, retry policy, worker entrypoint, and
journaling contract. A manual or scheduled automation can now execute the same
flow definition that the future visual builder edits.

## Integration Safety Limits

Integration payloads are bounded before expensive validation, import, or
scheduling work starts. Defaults:

- `INTEGRATION_MAX_CSV_BYTES=2000000`
- `INTEGRATION_MAX_WORK_ORDERS=10000`
- `INTEGRATION_MAX_OPERATIONS=50000`

Payloads above these limits return `413 payload_too_large` with the limit name,
actual value, and configured limit. This protects the API from accidental ERP
bulk loads that should be split or imported asynchronously.

Valid API keys are also rate-limited with:

- `INTEGRATION_RATE_LIMIT_PER_MINUTE=120`

Requests above the limit return `429 rate_limit_exceeded`. The response includes
a hashed `client_id`, never the raw API key.

The current limiter is process-local and intentionally lightweight for the MVP.
For multi-replica deployments, move this policy to an API gateway, Redis-backed
limiter, or identity service so all API instances share the same counters.

## Validation Contract

`POST /integration/planning-snapshot/validate` always returns a structured
validation response for syntactically valid snapshots:

```json
{
  "valid": false,
  "readiness_status": "blocked",
  "error_count": 2,
  "warning_count": 1,
  "issues": [
    {
      "kind": "unknown_machine",
      "severity": "error",
      "message": "Operation OP-10 references unknown machine MISSING",
      "entity_type": "operation",
      "entity_id": "OP-10",
      "field": "eligible_machine_ids",
      "reference": "MISSING",
      "source_file": "operations.csv",
      "source_row": 12
    }
  ]
}
```

`readiness_status` values:

- `ready`: no errors or warnings.
- `degraded`: import can continue, but warnings should be reviewed.
- `blocked`: import must not continue until errors are fixed.

## ERP Identity Fields

The canonical contract keeps planning fields separate from external identity
fields so ERP mappings stay stable while the engine evolves.

Important optional fields:

- `site_id` on calendars, machines, resources, and work orders.
- `external_ref` on master data and work orders for idempotent ERP bindings.
- `item_id` on work orders for ERP item identity; `product_id` remains the planning product identity.
- `quantity_uom` on work orders; defaults to `ea` and is required for import readiness.
- `requested_date` and `promised_date` on work orders for customer/ERP promise workflows.
- `erp_status` and `order_type` on work orders for source-system lifecycle context.

When PlaniAdvance exports from its internal model, it fills what it can:
`item_id` mirrors `product_id`, `requested_date` mirrors `due_date`, `erp_status`
mirrors the internal work order status, and `site_id` is read from export metadata
`site_id` or `plant` when present.

## Import Guard

`POST /integration/planning-snapshot/import` runs the same validation before
writing data. If the snapshot is blocked, the endpoint returns `422` with:

```json
{
  "error": "snapshot_validation_error",
  "message": "Planning snapshot validation failed.",
  "details": [
    {
      "valid": false,
      "readiness_status": "blocked",
      "error_count": 1,
      "warning_count": 0,
      "issues": []
    }
  ]
}
```

If the snapshot is valid, the import response includes a `validation` object so
callers can log exactly what was accepted.

## Integration Journal

Every export, validation, and import writes an append-only journal entry:

```json
{
  "id": "ij-4f7c4c6f2a11",
  "action": "import",
  "source_system": "erp-http",
  "status": "ready",
  "valid": true,
  "error_count": 0,
  "warning_count": 0,
  "entity_counts": {
    "work_orders": 3,
    "operations": 6,
    "machines": 3
  },
  "details": {
    "validation": {
      "readiness_status": "ready"
    }
  },
  "created_at": "2026-04-14T12:00:00"
}
```

Read entries with:

- `GET /integration/journal`
- `GET /integration/journal?action=import`
- `GET /integration/journal?source_system=erp-http`
- `GET /integration/journal?workspace_id=ws-plant-1`

The journal is not meant to replace full observability, but it gives planners,
support, and ERP implementers a quick answer to “what did we receive, was it
accepted, and why?”.

Journal entries are tenant/workspace scoped when the request is scoped by
headers or by a persisted integration API client. `GET /integration/journal`
applies that same effective context, so a workspace-scoped connector only sees
its own exchange history. Existing unscoped local-dev entries remain readable in
unscoped local-dev mode.

When API key security is enabled, journal `details` include:

- `auth_mode`: `api_key`, `api_client`, or `disabled`.
- `access_scope`: `read`, `write`, or `run`.
- `key_type`: `full`, `read`, `run`, `client`, or `none`.
- `client_id`: a stable hash-derived identifier such as `full:abc123...`.
- `scopes`: persisted API client or environment key scope labels.
- `client_name`, `organization_id`, `workspace_id`, and `client_source_system`
  when a persisted API client provided them.

The API key value itself is never written to the journal. Runs launched through
`/integration/scheduling/run-from-snapshot` are journaled as `run_from_snapshot`
with schedule id, strategy, solver status, objective value, and wall time.

## Phase 6 Operation Checklist

Before exposing integration endpoints beyond local development:

- Set `INTEGRATION_API_KEY` for trusted full-access automation only.
- Create one persisted integration API client per external system whenever a
  tenant/workspace-scoped key is available.
- Store the generated API client secret in the external system immediately; it
  cannot be retrieved again from PlaniAdvance.
- Prefer `INTEGRATION_READ_API_KEY` for reporting, validation, and support tools.
- Prefer `INTEGRATION_RUN_API_KEY` for clients that can simulate schedules but should not import data.
- Tune `INTEGRATION_MAX_CSV_BYTES`, `INTEGRATION_MAX_WORK_ORDERS`, and `INTEGRATION_MAX_OPERATIONS` from pilot data volumes.
- Monitor `payload_too_large`, `rate_limit_exceeded`, `insufficient_scope`, and `invalid_api_key` errors.
- Review `/integration/journal` after every pilot import to confirm `source_system`, entity counts, validation status, and access scope.

## Minimal CSV Adapter

The application layer includes a small CSV adapter that converts CSV content to
the same canonical snapshot used by the API. This is useful for pilots where the
ERP cannot yet call REST directly.

Minimal files:

- `calendars.csv`: `id,name,weekday,start,end,site_id`
- `machines.csv`: `id,name,calendar_id,capabilities,efficiency,site_id`
- `work_orders.csv`: `id,name,product_id,item_id,quantity,quantity_uom,release_date,due_date,requested_date,priority,status,site_id,erp_status,order_type`
- `operations.csv`: `id,work_order_id,sequence,name,duration_minutes,eligible_machine_ids,setup_minutes,dependencies,status`

List fields such as `capabilities`, `eligible_machine_ids`, and `dependencies`
use `;` or `|` separators.

The CSV adapter does not bypass validation. It produces a
`CanonicalPlanningSnapshot`, then callers should run `validate_snapshot_report`
or the normal `/integration/planning-snapshot/validate` endpoint before import.
When possible, validation issues include `source_file` and `source_row` so the
bad spreadsheet row can be corrected directly.

REST endpoints for pilot integrations:

- `POST /integration/planning-snapshot/csv/validate`
- `POST /integration/planning-snapshot/csv/import`

Both endpoints accept JSON with the same CSV string fields as
`CanonicalCsvBundle`. This keeps the MVP dependency-light; multipart file upload
can be added later without changing the canonical snapshot contract.

## Current Checks

- Unsupported contract version.
- Duplicate calendars, machines, resources, work orders, operations, and supplies.
- Machines/resources referencing unknown calendars.
- Operations referencing unknown machines, resources, or dependencies.
- Routings targeting unknown or ineligible machines.
- Invalid work order quantities and date order.
- Invalid inventory or supply quantities.
- Warning when an operation requires material with no inventory or supply in the snapshot.
- Blocking error when a work order has a blank `quantity_uom`.

## Next Improvements

- Add authenticated multipart CSV uploads for browser-based imports.
