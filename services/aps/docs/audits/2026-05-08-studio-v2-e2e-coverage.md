# Studio v2 — E2E coverage audit

**Date:** 2026-05-08
**Method:** built one minimal flow per block category, ran end-to-end via the API, observed runtime behavior + error messages. Mock HTTP service spun up on `:8765` (`tests/e2e_mock_erp.py`) for connector-touching blocks.
**Verdict legend:** ✅ works · 🟧 works with caveat · ❌ broken · ⚙️ needs runtime adapter (not a bug)

## Per-block status

### Triggers (Phase 5)

| Block | Verdict | Notes |
|---|---|---|
| `trigger_manual` | ✅ | Pass-through emits `{kind: trigger_event, via: "manual"}`. Verified end-to-end in dozens of flows. |
| `trigger_schedule` | ✅ | Same as manual but tags `via: "schedule"`. Cron firing not wired (Phase 5.5 deferred). |
| `trigger_webhook` | ✅ | Inspector shows the deterministic preview URL. Public endpoint not wired (Phase 5.5 deferred). |

### APS workspace (pre-v2 inheritance)

| Block | Verdict | Notes |
|---|---|---|
| `export_snapshot` | ✅ | Demo workspace returns 6 work_orders / 8 machines / 1 calendar / 7 resources / 7 inventory / 2 supplies. Output cards (Phase 9) render correctly. |
| `export_published_plan` | ✅ | "Published APS plan exported for outbound delivery" — emits a published_plan envelope. |
| `import_snapshot` | ✅ | Status = "imported". |
| `run_scheduling_from_snapshot` | 🟧 | Works when chained from a snapshot-emitting block (validate_snapshot, transform_snapshot). **Breaks when chained directly after `import_snapshot`** because `import_result` ≠ `snapshot`. The v1 ERP-import template's `import → run` chain inherits this bug. **Workaround**: branch — feed `run` from validate output, not from import output. |

### Logic (Phase 6)

| Block | Verdict | Notes |
|---|---|---|
| `logic_branch_if` | ✅ | Activates branch_true / branch_false based on path resolution; downstream blocks consuming the inactive edge get status="skipped". |
| `logic_branch_switch` | ✅ | E2E verified: trigger emits via=manual → switch matches case "manual" → case-a runs, case-default skipped. Output `kind: branch_decision`, `matched_case: "manual"`. |
| `logic_merge` | ✅ | Forwards first non-null upstream output; runs even when one sibling was skipped. |

### Error handling (Phase 7)

| Block | Verdict | Notes |
|---|---|---|
| `error_handler` | ✅ | Captures envelope `{handled_block_id, handled_block_type, error_message, envelope}`. Verified with real HTTP 404 from Mock ERP — `flow_status: completed_with_errors`, `api: failed`, `catch: ready`. |
| Per-block retry | ✅ | `retry_max_attempts=3`, `retry_backoff_seconds=0.2` exhausts retries before activating the error edge. Visible in trace. |

### Connectors (HTTP, pre-v2 inheritance)

| Block | Verdict | Notes |
|---|---|---|
| `call_connector_api` | ✅ (after fix) | **Bug found and fixed during E2E**: catalog declared the path field as `target_path` but the runner reads `route_path`. Renamed in catalog + ERP-import template. After fix: returns `kind: api_response`, `response_json` carries the mock payload, `request_url` shows the composed URL. |
| `send_connector_request` | ⚙️ | Not exercised E2E — needs a connector with `method: POST`. Same wiring as call_connector_api otherwise. |
| `pull_snapshot_from_connector` | 🟧 | Engine wiring works (HTTP request fires); response must be snapshot-shaped. Mock ERP `/snapshot` 404 → block correctly reports HTTP failure. |
| `push_snapshot_to_connector` | ⚙️ | Validates connector method must be POST/PUT/PATCH. With a GET-only connector, fails with a clear error. Needs a proper POST connector to verify success path. |
| `push_published_plan_to_connector` | ❌ blocking | Connector validation rejects creation: "HTTP integration connector endpoint_url must be an absolute HTTP URL." even when the connector is valid. Needs investigation — separate bug, not Phase 6/7/8/9 regression. |

### Transform (pre-v2 inheritance)

| Block | Verdict | Notes |
|---|---|---|
| `map_api_response_to_snapshot` | 🟧 | **Documentation gap surfaced**: catalog config_field was a single `mapping` json blob, but the runner reads flat fields (`work_orders_path`, `work_order_field_map`, `operations_path`, `operation_field_map`, etc.). **Catalog updated during E2E** to expose the 5 actual fields. Even with a correct config, the runner crashes with `KeyError` on canonical fields (`name`, `release_date`) that aren't in the field_map — the mapper does NOT default missing fields. Real ERP integrations must map every required canonical key. |
| `transform_snapshot` | ⚙️ | Not exercised E2E — needs a snapshot upstream + operations config. Code path exists. |
| `format_payload` | ✅ | Works with `{format: "json", file_name: "snap.json"}` → emits `{kind: formatted_payload, format: "json", file_name: "snap.json"}`. |

### Quality (pre-v2 inheritance)

| Block | Verdict | Notes |
|---|---|---|
| `validate_snapshot` | ✅ | "Snapshot validated against the canonical contract." Emits validated_snapshot envelope. |
| `require_valid_snapshot` | ✅ | "Validation gate passed." Pass-through if upstream validation is clean. |

### Destinations

| Block | Verdict | Notes |
|---|---|---|
| `send_sftp_file` | ⚙️ | Requires a connector with `connector_type: sftp`. With a HTTP connector, fails with clear error. Code path is correct; runtime needs an SFTP-typed connector + `ParamikoIntegrationSftpTransport` adapter. |
| `write_database_rows` | ⚙️ | Requires a connector with `connector_type: database`. With HTTP, fails with clear error. Code path is correct; runtime needs a database-typed connector + `SqlAlchemyIntegrationDatabaseTransport` adapter. |

## Headline findings

### Bugs found and fixed during this audit

1. **catalog `target_path` → `route_path`** (`call_connector_api`). Without the fix, every flow built from the Studio v2 UI sent its API call to the connector's bare base URL, ignoring the user's path. **Fix shipped** in this commit.

### Bugs found, not yet fixed (recommended Phase 9.5 polish)

2. **`import_snapshot` doesn't pass-through the snapshot.** The v1 ERP-import template chains `import → run`; this fails because `import_result ≠ snapshot`. **Two fix options**: (a) `import_snapshot` re-emits the snapshot alongside the import_result, or (b) templates branch — `run` reads from validate, not from import. The Phase 8 ERP-import template inherits the v1 bug; it would have failed in production.

3. **`push_published_plan_to_connector` connector validation false-rejects `host.docker.internal:8765`** — the URL passes the URL-shape check elsewhere but this block's pre-flight validation refuses it. Probably a port-not-in-allowlist or a stricter regex. Not a Phase 6-9 regression.

4. **`map_api_response_to_snapshot` field_map is incomplete by design.** Maps only what the planner specifies; the canonical APS contract requires `name` + `release_date` + … on every work_order, but the field_map silently elides them. Result: surprise KeyErrors at the next stage. **Recommendation**: have the mapper either (a) raise a friendlier error listing missing canonical keys, or (b) generate sensible defaults (e.g. `name = id` when missing).

### Caveats that aren't bugs

- `send_sftp_file` / `write_database_rows` / `push_*_to_connector` need correctly-typed connectors. The error messages are clear; this is normal "connector not configured" behaviour.

## What works end-to-end (verified flows)

| Flow | Result |
|---|---|
| `manual → if → (true:export, false:export)` | ✅ Phase 6 walkthrough |
| `manual → switch → case-a, default → merge` | ✅ this audit |
| `manual → call_api → error_handler` (with retry, 404 path) | ✅ this audit |
| `export → validate → require_valid → import` (4 blocks) | ✅ this audit |
| `export → validate → run_scheduling_from_snapshot` (3 blocks) | ✅ this audit |
| `export → format_payload` | ✅ this audit |
| `manual → call_connector_api` (with route_path fix) | ✅ this audit |
| `export_published_plan` standalone | ✅ this audit |

## What broke during the audit

| Flow | Where it broke |
|---|---|
| `export → validate → require → import → run` | `run` rejects `import_result` upstream (finding #2) |
| `manual → call_api → map_api_response_to_snapshot` | `map` crashes on missing canonical keys (finding #4) |
| `export → push_published_plan_to_connector` | Connector URL validation false-rejects (finding #3) |

## V1.0 ship-readiness verdict

**Studio v2 is shippable for V1.0** with the following caveats:

- Pilots must hand-write the `work_order_field_map` to include every canonical key (name, release_date, due_date, etc.) — or the mapper raises KeyError. This is documentation work, not a code change for V1.0.
- The ERP-import template's `import → run` chain is broken; pilots should remove `run` from the template chain (it isn't critical to the import path) until finding #2 is fixed.
- Pilots wanting to send the published plan back to ERP need finding #3 fixed first.
- The 5 templates seeded in Phase 8 are all legitimate starters; finding #4 means pilots will hit field-map polish work, but the structure works.

## Recommended Phase 9.5 polish (post-pilot)

1. Make `import_snapshot` pass-through the snapshot (fixes the templates).
2. Have `map_api_response_to_snapshot` raise a friendly diagnostic listing every missing canonical key, with a one-shot "auto-fill defaults from id" toggle.
3. Investigate the `push_published_plan_to_connector` URL false-reject.
4. Mock ERP needs to live in docker-compose (not just `tests/e2e_mock_erp.py`) so connector smoke tests can run in CI.
