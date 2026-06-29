"""Use cases for persisted block-based integration flows."""

from __future__ import annotations

import csv
import io
import json
import re
import time
from dataclasses import dataclass, field, replace
from datetime import datetime
from hashlib import sha256
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from uuid import uuid4
from xml.sax.saxutils import escape as xml_escape

from ...application.integration import validate_snapshot_report
from ...application.integration.canonical_mapper import (
    CONTRACT_VERSION as APS_SNAPSHOT_CONTRACT_VERSION,
)
from ...application.integration.odoo_client import OdooClient, OdooClientError
from ...application.integration.odoo_planning_mapper import (
    published_plan_to_odoo_writes,
)
from ...application.integration.snapshot_codec import (
    planning_snapshot_from_json,
    planning_snapshot_hash,
    planning_snapshot_to_json,
)
from ...domain.errors import ValidationError
from ..ports import (
    FlowBlockInput,
    FlowRunTrace,
    FlowRunTraceRepository,
    IntegrationAutomationJob,
    IntegrationAutomationRepository,
    IntegrationBindingRepository,
    IntegrationConnector,
    IntegrationConnectorRepository,
    IntegrationCredentialRepository,
    IntegrationDatabaseTableSchema,
    IntegrationDatabaseTransport,
    IntegrationExecutionRepository,
    IntegrationFlow,
    IntegrationFlowBlock,
    IntegrationFlowRepository,
    IntegrationHttpTransport,
    IntegrationJournalEntry,
    IntegrationJournalRepository,
    IntegrationSecretResolver,
    IntegrationSftpTransport,
)
from ._flow_trace_masking import mask_payload
from .export_planning_snapshot import ExportPlanningSnapshot, ExportPlanningSnapshotInput
from .export_published_plan import ExportPublishedPlan, ExportPublishedPlanInput
from .import_planning_snapshot import ImportPlanningSnapshot, ImportPlanningSnapshotInput
from .integration_connectors import (
    build_connector_database_schema_request,
    build_connector_database_write_request,
    build_connector_http_request,
    build_connector_sftp_put_request,
    parse_odoo_endpoint,
    validate_integration_connector,
)
from .integration_credentials import (
    apply_integration_credential,
    validate_integration_credential,
)
from .integration_execution_support import (
    ensure_integration_correlation_id,
    save_integration_execution,
)
from .integration_snapshot_support import (
    clone_json,
    extract_snapshot,
    extract_snapshot_json,
    http_body_from_config,
    optional_datetime,
    snapshot_envelope,
    transfer_times_from_config,
)
from .run_scheduling_from_snapshot import (
    RunSchedulingFromSnapshot,
    RunSchedulingFromSnapshotInput,
)
from .webhook_token import webhook_token_for

FLOW_BLOCK_CATALOG: tuple[dict[str, object], ...] = (
    {
        "block_type": "export_snapshot",
        "label": "Export APS Data",
        "category": "aps",
        "description": "Export planning data already loaded in the active APS workspace.",
        # Source block: pulls from the workspace itself, but accepts an
        # upstream connection so a planner can chain it after a trigger.
        # The upstream output (e.g. trigger_event) is ignored at runtime.
        "accepts_input": True,
        "output_kind": "snapshot",
    },
    {
        "block_type": "export_published_plan",
        "label": "Export Published Plan",
        "category": "aps",
        "description": "Export the planner-approved APS plan in full or delta mode.",
        # Source block: see export_snapshot rationale above.
        "accepts_input": True,
        "output_kind": "published_plan",
    },
    {
        "block_type": "pull_snapshot_from_connector",
        "label": "Get APS-Ready Data",
        "category": "connector",
        "description": "Call an API route that already returns APS planning data.",
        # Source block: pulls from a connector, but accepts an upstream
        # trigger so it can be chained downstream of trigger_*.
        "accepts_input": True,
        "output_kind": "snapshot",
        "config_fields": (
            {
                "key": "connector_id",
                "label": "Connector",
                "field_type": "connector",
                "connector_type": "http",
                "required": True,
                "placeholder": "erp-prod",
                "help": "ID of a saved connector (with base URL + auth).",
            },
            {
                "key": "route_path",
                "label": "API path",
                "field_type": "text",
                "required": False,
                "placeholder": "/aps-snapshot",
                "help": "Path appended to the connector base URL (must start with '/'). Leave blank to use the connector default.",
            },
            {
                "key": "query_params",
                "label": "Query params",
                "field_type": "json",
                "required": False,
                "placeholder": '{"since": "2026-05-07"}',
            },
            {
                "key": "request_headers",
                "label": "Headers",
                "field_type": "json",
                "required": False,
                "placeholder": '{"X-Locale": "fr"}',
            },
            {
                "key": "retry_max_attempts",
                "label": "Retry attempts",
                "field_type": "number",
                "required": False,
                "placeholder": "1",
                "help": "Total attempts on failure (1 = no retry).",
            },
            {
                "key": "retry_backoff_seconds",
                "label": "Backoff seconds",
                "field_type": "number",
                "required": False,
                "placeholder": "0",
                "help": "Linear backoff: sleep (backoff × attempt) before each retry.",
            },
        ),
    },
    {
        "block_type": "call_connector_api",
        "label": "Call API",
        "category": "connector",
        "description": "Call an ERP, MES, or middleware API route and keep the JSON response for mapping.",
        "accepts_input": True,
        "output_kind": "api_response",
        "config_fields": (
            {
                "key": "connector_id",
                "label": "Connector",
                "field_type": "connector",
                "connector_type": "http",
                "required": True,
                "placeholder": "erp-prod",
                "help": "ID of a saved connector (with base URL + auth).",
            },
            {
                "key": "route_path",
                "label": "API path",
                "field_type": "text",
                "required": True,
                "placeholder": "/work-orders",
                "help": "Path appended to the connector base URL (must start with '/').",
            },
            {
                "key": "query_params",
                "label": "Query params",
                "field_type": "json",
                "required": False,
                "placeholder": '{"since": "2026-05-07"}',
            },
            {
                "key": "request_headers",
                "label": "Headers",
                "field_type": "json",
                "required": False,
                "placeholder": '{"X-Locale": "fr"}',
            },
            {
                "key": "retry_max_attempts",
                "label": "Retry attempts",
                "field_type": "number",
                "required": False,
                "placeholder": "1",
                "help": "Total attempts on failure (1 = no retry).",
            },
            {
                "key": "retry_backoff_seconds",
                "label": "Backoff seconds",
                "field_type": "number",
                "required": False,
                "placeholder": "0",
                "help": "Linear backoff: sleep (backoff × attempt) before each retry.",
            },
        ),
        "expected_input_kinds": ("api_response", "snapshot", "connector_delivery"),
    },
    {
        "block_type": "odoo_planning_snapshot",
        "label": "Odoo: Pull Planning Snapshot",
        "category": "connector",
        "description": "Pull MOs + workorders + workcenters + calendars from Odoo and map them into the APS canonical snapshot in one step.",
        "accepts_input": True,
        "output_kind": "snapshot",
        "config_fields": (
            {
                "key": "connector_id",
                "label": "Odoo connector",
                "field_type": "connector",
                "connector_type": "odoo",
                "required": True,
                "placeholder": "odoo-local",
                "help": "ID of a saved Odoo connector (URL + database + API key).",
            },
            {
                "key": "mo_domain",
                "label": "MO domain filter",
                "field_type": "json",
                "required": False,
                "placeholder": '[["state", "in", ["confirmed", "progress"]]]',
                "help": "Odoo domain to filter mrp.production. Empty = all MOs.",
            },
            {
                "key": "default_operation_duration_minutes",
                "label": "Default operation duration (minutes)",
                "field_type": "number",
                "required": False,
                "placeholder": "60",
                "help": "Used when an MO has no routings: synthesizes one operation with this duration.",
            },
            {
                "key": "mo_limit",
                "label": "Max MOs to pull",
                "field_type": "number",
                "required": False,
                "placeholder": "200",
                "help": "Cap on the mrp.production search. Keeps the snapshot small for big sites.",
            },
        ),
        "expected_input_kinds": ("api_response", "snapshot", "connector_delivery"),
    },
    {
        "block_type": "odoo_push_schedule",
        "label": "Odoo: Push Scheduled Dates",
        "category": "connector",
        "description": "Write the scheduled start/end dates of a published APS plan back to Odoo (mrp.production + mrp.workorder).",
        "accepts_input": True,
        "output_kind": "connector_delivery",
        "config_fields": (
            {
                "key": "connector_id",
                "label": "Odoo connector",
                "field_type": "connector",
                "connector_type": "odoo",
                "required": True,
                "placeholder": "odoo-local",
                "help": "ID of a saved Odoo connector (URL + database + API key).",
            },
        ),
        "expected_input_kinds": ("published_plan",),
    },
    {
        "block_type": "odoo_search_read",
        "label": "Odoo: Read Records",
        "category": "connector",
        "description": "Read records from an Odoo model (e.g. mrp.production) via JSON-RPC search_read.",
        "accepts_input": True,
        "output_kind": "api_response",
        "config_fields": (
            {
                "key": "connector_id",
                "label": "Odoo connector",
                "field_type": "connector",
                "connector_type": "odoo",
                "required": True,
                "placeholder": "odoo-local",
                "help": "ID of a saved Odoo connector (URL + database + API key).",
            },
            {
                "key": "model",
                "label": "Odoo model",
                "field_type": "text",
                "required": True,
                "placeholder": "mrp.production",
                "help": "Technical name of the Odoo model, e.g. mrp.production, mrp.workcenter.",
            },
            {
                "key": "domain",
                "label": "Domain filter",
                "field_type": "json",
                "required": False,
                "placeholder": '[["state", "=", "confirmed"]]',
                "help": "Odoo domain expression as a JSON list. Empty array = all records.",
            },
            {
                "key": "fields",
                "label": "Fields to fetch",
                "field_type": "json",
                "required": False,
                "placeholder": '["name", "product_id", "product_qty", "state"]',
                "help": "List of field names. Empty = Odoo default field set.",
            },
            {
                "key": "limit",
                "label": "Limit",
                "field_type": "number",
                "required": False,
                "placeholder": "100",
                "help": "Maximum number of records to return.",
            },
        ),
        "expected_input_kinds": ("api_response", "snapshot", "connector_delivery"),
    },
    {
        "block_type": "send_connector_request",
        "label": "Send Data To API",
        "category": "connector",
        "description": "Send JSON or text to a connector route. It can use variables from an earlier block.",
        "accepts_input": True,
        "output_kind": "connector_delivery",
        "config_fields": (
            {
                "key": "connector_id",
                "label": "Connector",
                "field_type": "connector",
                "connector_type": "http",
                "required": True,
                "placeholder": "erp-prod",
                "help": "ID of a saved connector (with base URL + auth).",
            },
            {
                "key": "route_path",
                "label": "API path",
                "field_type": "text",
                "required": True,
                "placeholder": "/inbound/orders",
                "help": "Path appended to the connector base URL (must start with '/').",
            },
            {
                "key": "request_method",
                "label": "HTTP method",
                "field_type": "select",
                "required": True,
                "placeholder": "Select an HTTP verb…",
                "options": (
                    {"value": "POST", "label": "POST"},
                    {"value": "PUT", "label": "PUT"},
                    {"value": "PATCH", "label": "PATCH"},
                ),
                "help": "GET is not allowed; pick the verb the destination expects.",
            },
            {
                "key": "request_body",
                "label": "Body",
                "field_type": "textarea",
                "required": True,
                "placeholder": '{"order_id": "{{ snapshot.work_orders[0].id }}"}',
                "help": "JSON object/array or raw text. Variables from earlier blocks can be templated in.",
            },
            {
                "key": "query_params",
                "label": "Query params",
                "field_type": "json",
                "required": False,
                "placeholder": '{"site": "plant-a"}',
            },
            {
                "key": "request_headers",
                "label": "Headers",
                "field_type": "json",
                "required": False,
                "placeholder": '{"X-Locale": "fr"}',
            },
            {
                "key": "retry_max_attempts",
                "label": "Retry attempts",
                "field_type": "number",
                "required": False,
                "placeholder": "1",
                "help": "Total attempts on failure (1 = no retry).",
            },
            {
                "key": "retry_backoff_seconds",
                "label": "Backoff seconds",
                "field_type": "number",
                "required": False,
                "placeholder": "0",
                "help": "Linear backoff: sleep (backoff × attempt) before each retry.",
            },
        ),
    },
    {
        "block_type": "map_api_response_to_snapshot",
        "label": "Map API To APS",
        "category": "transform",
        "description": "Map ERP or MES JSON into the canonical APS dataset so PlaniAdvance can validate, import, and schedule it.",
        "accepts_input": True,
        "output_kind": "snapshot",
        "config_fields": (
            {
                "key": "work_orders_path",
                "label": "Work orders path",
                "field_type": "text",
                "required": True,
                "placeholder": "orders",
                "help": "Dot-path inside the API response JSON pointing at the work-order list.",
            },
            {
                "key": "work_order_field_map",
                "label": "Work order field map",
                "field_type": "json",
                "required": False,
                "placeholder": '{"id": "id", "qty": "quantity"}',
                "help": "Map of canonical APS keys to the keys present on each ERP work-order.",
            },
            {
                "key": "operations_path",
                "label": "Operations path (optional)",
                "field_type": "text",
                "required": False,
                "placeholder": "operations",
                "help": "Top-level array path; leave blank to nest operations inside each work-order.",
            },
            {
                "key": "operation_field_map",
                "label": "Operation field map",
                "field_type": "json",
                "required": False,
                "placeholder": '{"id": "id", "work_order_id": "wo_id"}',
            },
            {
                "key": "response_root",
                "label": "Response root (optional)",
                "field_type": "text",
                "required": False,
                "placeholder": "data",
                "help": "Walk into a nested JSON envelope before reading the lists above.",
            },
        ),
        "expected_input_kinds": ("api_response",),
    },
    {
        "block_type": "transform_snapshot",
        "label": "Transform Data",
        "category": "transform",
        "description": "Set defaults, filter orders, and normalize planning data before APS uses it.",
        "accepts_input": True,
        "output_kind": "snapshot",
        "config_fields": (
            {
                "key": "operations",
                "label": "Operations",
                "field_type": "json",
                "required": True,
                "placeholder": '[{"op": "set_metadata", "key": "site", "value": "plant-a"}]',
                "help": "Ordered list of mutations applied to the snapshot.",
            },
        ),
        "expected_input_kinds": ("snapshot",),
    },
    {
        "block_type": "format_payload",
        "label": "Format Data",
        "category": "transform",
        "description": "Convert incoming flow data to JSON, XML, CSV, or text for a destination.",
        "accepts_input": True,
        "output_kind": "formatted_payload",
        "config_fields": (
            {
                "key": "format",
                "label": "Format",
                "field_type": "select",
                "required": True,
                "placeholder": "Select a format…",
                "options": (
                    {"value": "json", "label": "JSON"},
                    {"value": "xml", "label": "XML"},
                    {"value": "csv", "label": "CSV"},
                    {"value": "text", "label": "Plain text"},
                ),
            },
            {
                "key": "source_path",
                "label": "Source path (optional)",
                "field_type": "text",
                "required": False,
                "placeholder": "snapshot.work_orders",
                "help": "Dot-path into the upstream payload to format. Default: the full payload.",
            },
            {
                "key": "file_name",
                "label": "File name (optional)",
                "field_type": "text",
                "required": False,
                "placeholder": "orders.json",
                "help": "Used by destination blocks (e.g. SFTP) when delivering this payload.",
            },
            {
                "key": "root_name",
                "label": "Root tag (XML only)",
                "field_type": "text",
                "required": False,
                "placeholder": "work_orders",
                "help": "XML root element name. Ignored for non-XML formats.",
            },
            {
                "key": "item_name",
                "label": "Item tag (XML only)",
                "field_type": "text",
                "required": False,
                "placeholder": "work_order",
                "help": "XML element name for each list item. Ignored for non-XML formats.",
            },
        ),
    },
    {
        "block_type": "enrich_with_master_data",
        "label": "Add Workspace Master Data",
        "category": "transform",
        "description": (
            "Merge the active workspace's machines, calendars, and resources "
            "into the snapshot. Use this when the upstream source (e.g. an ERP "
            "API) only ships work-order data and the master data lives in APS."
        ),
        "accepts_input": True,
        "output_kind": "snapshot",
        "config_fields": (),
        "expected_input_kinds": ("snapshot",),
    },
    {
        "block_type": "validate_snapshot",
        "label": "Validate Data",
        "category": "quality",
        "description": "Run APS data validation and attach readiness diagnostics before import or scheduling.",
        "accepts_input": True,
        "output_kind": "validated_snapshot",
        "config_fields": (),
        "expected_input_kinds": ("snapshot",),
    },
    {
        "block_type": "require_valid_snapshot",
        "label": "Stop On Bad Data",
        "category": "quality",
        "description": "Stop the flow immediately when the previous validation still contains blockers.",
        "accepts_input": True,
        "output_kind": "validated_snapshot",
    },
    {
        "block_type": "import_snapshot",
        "label": "Import To APS",
        "category": "aps",
        "description": "Load the validated planning dataset into the active APS workspace repositories.",
        "accepts_input": True,
        "output_kind": "import_result",
        "config_fields": (),
        "expected_input_kinds": ("validated_snapshot", "snapshot"),
    },
    {
        "block_type": "run_scheduling_from_snapshot",
        "label": "Run APS",
        "category": "aps",
        "description": "Run the APS engine directly from the incoming planning dataset without depending on UI state.",
        "accepts_input": True,
        "output_kind": "schedule_result",
        "config_fields": (
            {
                "key": "horizon_days",
                "label": "Horizon (days)",
                "field_type": "number",
                "required": False,
                "placeholder": "30",
                "help": "Planning horizon length in days. Defaults to 30.",
            },
            {
                "key": "strategy",
                "label": "Strategy",
                "field_type": "select",
                "required": False,
                "placeholder": "Use engine default",
                "options": (
                    {"value": "auto", "label": "Auto decision layer"},
                    {"value": "greedy", "label": "Greedy finite scheduler"},
                    {"value": "backward", "label": "Backward just-in-time"},
                    {"value": "hybrid", "label": "Hybrid forward/backward"},
                ),
                "help": "Engine strategy to use. Default: greedy.",
            },
            {
                "key": "heuristic",
                "label": "Heuristic",
                "field_type": "select",
                "required": False,
                "placeholder": "Use engine default",
                "options": (
                    {"value": "edd", "label": "Earliest due date"},
                    {"value": "spt", "label": "Shortest processing time"},
                    {"value": "atc", "label": "Apparent tardiness cost"},
                    {"value": "cr", "label": "Critical ratio"},
                ),
                "help": "Dispatching heuristic. Default: edd.",
            },
        ),
    },
    {
        "block_type": "push_snapshot_to_connector",
        "label": "Send Planning Data",
        "category": "connector",
        "description": "Send the planning dataset to an external connector when another system needs the raw APS input contract.",
        "accepts_input": True,
        "output_kind": "connector_delivery",
        "config_fields": (
            {
                "key": "connector_id",
                "label": "Connector",
                "field_type": "connector",
                "connector_type": "http",
                "required": True,
                "placeholder": "erp-prod",
                "help": "ID of a saved connector (with base URL + auth).",
            },
            {
                "key": "route_path",
                "label": "API path",
                "field_type": "text",
                "required": False,
                "placeholder": "/inbound/snapshot",
                "help": "Path appended to the connector base URL (must start with '/').",
            },
            {
                "key": "request_method",
                "label": "HTTP method",
                "field_type": "select",
                "required": False,
                "placeholder": "Default: POST",
                "options": (
                    {"value": "POST", "label": "POST"},
                    {"value": "PUT", "label": "PUT"},
                    {"value": "PATCH", "label": "PATCH"},
                ),
                "help": "GET is not allowed for outbound delivery; defaults to POST.",
            },
            {
                "key": "retry_max_attempts",
                "label": "Retry attempts",
                "field_type": "number",
                "required": False,
                "placeholder": "1",
                "help": "Total attempts on failure (1 = no retry).",
            },
            {
                "key": "retry_backoff_seconds",
                "label": "Backoff seconds",
                "field_type": "number",
                "required": False,
                "placeholder": "0",
                "help": "Linear backoff: sleep (backoff × attempt) before each retry.",
            },
        ),
    },
    {
        "block_type": "push_published_plan_to_connector",
        "label": "Send Published Plan",
        "category": "connector",
        "description": "Send the published APS plan back to ERP or MES through a persisted connector.",
        "accepts_input": True,
        "output_kind": "connector_delivery",
        "config_fields": (
            {
                "key": "connector_id",
                "label": "Connector",
                "field_type": "connector",
                "connector_type": "http",
                "required": True,
                "placeholder": "erp-prod",
                "help": "ID of a saved connector (with base URL + auth).",
            },
            {
                "key": "route_path",
                "label": "API path",
                "field_type": "text",
                "required": False,
                "placeholder": "/inbound/published-plan",
                "help": "Path appended to the connector base URL (must start with '/').",
            },
            {
                "key": "request_method",
                "label": "HTTP method",
                "field_type": "select",
                "required": False,
                "placeholder": "Default: POST",
                "options": (
                    {"value": "POST", "label": "POST"},
                    {"value": "PUT", "label": "PUT"},
                    {"value": "PATCH", "label": "PATCH"},
                ),
                "help": "GET is not allowed for outbound delivery; defaults to POST.",
            },
            {
                "key": "retry_max_attempts",
                "label": "Retry attempts",
                "field_type": "number",
                "required": False,
                "placeholder": "1",
                "help": "Total attempts on failure (1 = no retry).",
            },
            {
                "key": "retry_backoff_seconds",
                "label": "Backoff seconds",
                "field_type": "number",
                "required": False,
                "placeholder": "0",
                "help": "Linear backoff: sleep (backoff × attempt) before each retry.",
            },
        ),
    },
    {
        "block_type": "send_sftp_file",
        "label": "Send To SFTP",
        "category": "destination",
        "description": "Send a formatted file to SFTP once a SFTP runtime adapter is configured.",
        "accepts_input": True,
        "output_kind": "destination_delivery",
        "config_fields": (
            {
                "key": "connector_id",
                "label": "Connector",
                "field_type": "connector",
                "connector_type": "sftp",
                "required": True,
                "placeholder": "sftp-dropzone",
                "help": "ID of a saved SFTP connector (host, port, credentials).",
            },
            {
                "key": "file_name",
                "label": "File name (optional)",
                "field_type": "text",
                "required": False,
                "placeholder": "orders.json",
                "help": "Override the file name. Must not contain path separators.",
            },
            {
                "key": "preview_only",
                "label": "Preview only (don't actually send)",
                "field_type": "bool",
                "required": False,
                "help": "Tick to log the delivery without uploading. Useful for dry runs.",
            },
        ),
        "expected_input_kinds": ("formatted_payload",),
    },
    {
        "block_type": "write_database_rows",
        "label": "Write To Database",
        "category": "destination",
        "description": "Write rows to an external database once a database runtime adapter is configured.",
        "accepts_input": True,
        "output_kind": "destination_delivery",
        "config_fields": (
            {
                "key": "connector_id",
                "label": "Connector",
                "field_type": "connector",
                "connector_type": "database",
                "required": True,
                "placeholder": "warehouse-db",
                "help": "ID of a saved database connector.",
            },
            {
                "key": "table",
                "label": "Table",
                "field_type": "text",
                "required": True,
                "placeholder": "work_orders",
            },
            {
                "key": "operation",
                "label": "Operation",
                "field_type": "select",
                "required": False,
                "placeholder": "Default: Insert",
                "options": (
                    {"value": "insert", "label": "Insert"},
                    {"value": "update", "label": "Update"},
                    {"value": "upsert", "label": "Upsert"},
                ),
                "help": "Defaults to insert. Update and upsert require match_columns.",
            },
            {
                "key": "rows_path",
                "label": "Rows path (optional)",
                "field_type": "text",
                "required": False,
                "placeholder": "snapshot.work_orders",
                "help": "Dot-path inside the upstream payload that points at the row list.",
            },
            {
                "key": "match_columns",
                "label": "Match columns (for update/upsert)",
                "field_type": "json",
                "required": False,
                "placeholder": '["id"]',
                "help": "List of column names that identify a row. Required for update and upsert.",
            },
            {
                "key": "column_map",
                "label": "Column map (optional)",
                "field_type": "json",
                "required": False,
                "placeholder": '{"id": "wo_id", "qty": "quantity"}',
                "help": "Map row keys to column names when they differ from the table schema.",
            },
            {
                "key": "preview_only",
                "label": "Preview only (don't actually write)",
                "field_type": "bool",
                "required": False,
                "help": "Tick to log the rows without writing them. Useful for dry runs.",
            },
        ),
    },
    # Studio v2 phase 5 — trigger blocks (no input, produce trigger_event).
    # Cron-firing worker + authenticated public webhook endpoint are
    # deferred to Phase 5.5; today these blocks act as pass-through
    # producers exercised by the Run / Test buttons just like any other.
    {
        "block_type": "trigger_manual",
        "label": "Manual",
        "category": "trigger",
        "description": "Entry point of the flow when launched from the Studio Run button.",
        "accepts_input": False,
        "output_kind": "trigger_event",
        "config_fields": (),
        "expected_input_kinds": None,
    },
    {
        "block_type": "trigger_schedule",
        "label": "Schedule",
        "category": "trigger",
        "description": "Run the flow on a cron schedule. The worker that fires this trigger ships in a future polish slice.",
        "accepts_input": False,
        "output_kind": "trigger_event",
        "config_fields": (
            {
                "key": "cron_expression",
                "label": "Cron expression",
                "field_type": "text",
                "required": True,
                "placeholder": "*/15 * * * *",
                "help": "Standard 5-field cron — e.g. */15 * * * * for every 15 minutes.",
            },
        ),
        "expected_input_kinds": None,
    },
    {
        "block_type": "trigger_webhook",
        "label": "Webhook",
        "category": "trigger",
        "description": "Trigger the flow from an inbound HTTP POST. The URL appears in the Inspector once the flow is saved.",
        "accepts_input": False,
        "output_kind": "trigger_event",
        "config_fields": (
            # V1.2 P3 webhook ingress — shared secret used by the
            # public POST /integration/webhooks/{token} route to
            # HMAC-verify inbound payloads. When unset, the route
            # rejects calls with 403 (fail-closed; never run an
            # unauthenticated trigger that could write to the plant).
            {
                "key": "secret",
                "label": "Shared secret",
                "field_type": "secret",
                "required": False,
                "placeholder": "min. 16 chars; rotate after a leak",
                "help": "HMAC-SHA256 key. The sender must POST the payload with header 'X-Webhook-Signature: sha256=<hex>'. Empty = the public endpoint is disabled for this block.",
            },
        ),
        "expected_input_kinds": None,
    },
    # Studio v2 phase 6 — logic blocks (DAG branching / merging).
    # Dispatched in `_execute_block`, routed by the DAG runner in
    # `_execute_flow`. Branch outputs are activated based on the runtime
    # decision; merge takes the first non-null upstream.
    {
        "block_type": "logic_branch_if",
        "label": "If",
        "category": "logic",
        "description": "Send the flow down the true branch when the condition holds, false otherwise.",
        "accepts_input": True,
        "output_kind": "branch_decision",
        "config_fields": (
            {
                "key": "condition_path",
                "label": "Field path",
                "field_type": "text",
                "required": True,
                "placeholder": "$.work_orders[0].priority",
                "help": "Dot/JSONPath into the upstream output. The value at that path is compared to expected_value.",
            },
            {
                "key": "expected_value",
                "label": "Expected value",
                "field_type": "text",
                "required": False,
                "placeholder": "high",
                "help": "When omitted, the branch is true if the path resolves to a truthy value.",
            },
        ),
        "expected_input_kinds": None,
    },
    {
        "block_type": "logic_branch_switch",
        "label": "Switch",
        "category": "logic",
        "description": "Route the flow to the matching case based on the field value, or to the default branch.",
        "accepts_input": True,
        "output_kind": "branch_decision",
        "config_fields": (
            {
                "key": "condition_path",
                "label": "Field path",
                "field_type": "text",
                "required": True,
                "placeholder": "$.status",
            },
            {
                "key": "cases",
                "label": "Cases",
                "field_type": "json",
                "required": True,
                "placeholder": '["new", "approved", "rejected"]',
                "help": "Ordered list of case values. The first match wins; non-matches go to the default branch.",
            },
        ),
        "expected_input_kinds": None,
    },
    {
        "block_type": "logic_merge",
        "label": "Merge",
        "category": "logic",
        "description": "Combine multiple branches into one. Forwards the first upstream that produced an output.",
        "accepts_input": True,
        "output_kind": "merge_passthrough",
        "config_fields": (),
        "expected_input_kinds": None,
    },
    # Studio v2 phase 7 — error blocks. error_handler accepts input from
    # an outgoing 'error' edge (activated when its upstream raised) and
    # forwards a structured `{kind: error_handled, ...}` envelope.
    {
        "block_type": "error_handler",
        "label": "On Error",
        "category": "error",
        "description": "Catches the error from an upstream block (via an error edge) and forwards a structured envelope downstream — typically into a notify connector.",
        "accepts_input": True,
        "output_kind": "error_handled",
        "config_fields": (),
        "expected_input_kinds": None,
    },
)

SUPPORTED_FLOW_BLOCK_TYPES = {
    str(item["block_type"]) for item in FLOW_BLOCK_CATALOG
}
FLOW_BLOCK_OUTPUT_KIND = {
    str(item["block_type"]): str(item["output_kind"]) for item in FLOW_BLOCK_CATALOG
}
FLOW_BLOCK_LABELS = {
    str(item["block_type"]): str(item["label"]) for item in FLOW_BLOCK_CATALOG
}
HTTP_FLOW_BLOCK_TYPES = {
    "call_connector_api",
    "send_connector_request",
    "pull_snapshot_from_connector",
    "push_snapshot_to_connector",
    "push_published_plan_to_connector",
}
# V1.2 P1.1b — Odoo blocks need their own readiness path: the HTTP
# readiness checks `expected_type="http"`, but Odoo connectors live
# under connector_type="odoo" and the runtime needs a JSON-RPC
# endpoint shape + (optional) API key secret. Same connector picker
# affordance, different expected_type lookup.
ODOO_FLOW_BLOCK_TYPES = {
    "odoo_search_read",
    "odoo_planning_snapshot",
    "odoo_push_schedule",
}
FLOW_BLOCK_TYPES_REQUIRING_INPUT = {
    "map_api_response_to_snapshot",
    "transform_snapshot",
    "enrich_with_master_data",
    "validate_snapshot",
    "require_valid_snapshot",
    "import_snapshot",
    "run_scheduling_from_snapshot",
    "push_snapshot_to_connector",
    "push_published_plan_to_connector",
    "odoo_push_schedule",
    "format_payload",
    "send_sftp_file",
    "write_database_rows",
}
SUPPORTED_TRANSFORM_OPERATIONS = {
    "set_metadata",
    "set_source_system",
    "default_work_order_field",
    "map_work_order_field",
    "rename_work_order_field",
    "copy_work_order_field",
    "wrap_work_order_field_in_list",
    "filter_work_orders_by_field",
    "default_operation_field",
    "map_operation_field",
    "rename_operation_field",
    "copy_operation_field",
    "wrap_operation_field_in_list",
}

VALID_BLOCK_HTTP_METHODS = {"GET", "POST", "PUT", "PATCH"}


class RunIntegrationFlowRejected(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class _FlowBlocked(Exception):
    def __init__(self, message: str, result: dict[str, object]) -> None:
        super().__init__(message)
        self.message = message
        self.result = result


@dataclass(frozen=True, slots=True)
class CreateIntegrationFlowInput:
    name: str
    source_system: str
    blocks: list[IntegrationFlowBlock]
    organization_id: str | None = None
    workspace_id: str | None = None
    is_enabled: bool = True
    created_by_user_id: str | None = None


@dataclass(frozen=True, slots=True)
class UpdateIntegrationFlowInput:
    flow_id: str
    name: str
    source_system: str
    blocks: list[IntegrationFlowBlock]
    organization_id: str | None = None
    workspace_id: str | None = None
    is_enabled: bool = True


@dataclass(frozen=True, slots=True)
class EvaluateIntegrationFlowReadinessInput:
    name: str
    source_system: str
    blocks: list[IntegrationFlowBlock]
    organization_id: str | None = None
    workspace_id: str | None = None
    is_enabled: bool = True


@dataclass(frozen=True, slots=True)
class IntegrationFlowReadinessIssue:
    code: str
    severity: str
    message: str
    block_id: str | None = None
    suggested_action: str | None = None


@dataclass(frozen=True, slots=True)
class IntegrationFlowReadinessBlock:
    block_id: str
    block_type: str
    status: str
    message: str
    issues: tuple[IntegrationFlowReadinessIssue, ...] = ()


@dataclass(frozen=True, slots=True)
class IntegrationFlowReadinessOutput:
    status: str
    message: str
    blocks: tuple[IntegrationFlowReadinessBlock, ...] = ()
    blockers: tuple[IntegrationFlowReadinessIssue, ...] = ()
    warnings: tuple[IntegrationFlowReadinessIssue, ...] = ()
    summary: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RunIntegrationFlowInput:
    flow_id: str
    organization_id: str | None = None
    workspace_id: str | None = None
    start_block_id: str | None = None
    stop_after_block_id: str | None = None
    actor_details: dict[str, object] = field(default_factory=dict)
    journal_action: str | None = "flow_run"
    # V1.2 P3 webhook ingress slice 2 — JSON payload that arrived in
    # the webhook POST body. When set, the ``trigger_webhook`` block
    # surfaces it under ``output.payload`` so downstream blocks
    # (import_snapshot, logic_branch_if, …) can route on the inbound
    # data. ``None`` for Studio "Run" clicks and scheduled triggers,
    # which keep the legacy placeholder behaviour.
    trigger_payload: dict[str, object] | None = None


@dataclass(frozen=True, slots=True)
class TestFlowBlockInput:
    """Studio v2 phase 4 — single-block dry-run command."""

    flow_id: str
    block_id: str
    organization_id: str | None = None
    workspace_id: str | None = None
    input_value: dict[str, object] | None = None


@dataclass(frozen=True, slots=True)
class TestFlowBlockOutput:
    """Studio v2 phase 4 — single-block dry-run result, never persisted."""

    block_id: str
    block_type: str
    status: str  # ok | failed | blocked
    message: str
    input_preview: dict[str, object] | None = None
    output_preview: dict[str, object] | None = None
    duration_ms: int = 0


@dataclass(frozen=True, slots=True)
class FlowBlockExecutionResult:
    block_id: str
    block_type: str
    status: str
    message: str
    input_preview: dict[str, object] | None = None
    output_preview: dict[str, object] | None = None
    output_summary: dict[str, object] = field(default_factory=dict)


@dataclass(slots=True)
class RunIntegrationFlowOutput:
    flow: IntegrationFlow
    status: str
    message: str
    block_results: list[FlowBlockExecutionResult] = field(default_factory=list)
    result: dict[str, object] = field(default_factory=dict)
    execution_scope: dict[str, object] = field(default_factory=dict)
    journal_entry: IntegrationJournalEntry | None = None


@dataclass(frozen=True, slots=True)
class _FlowExecution:
    status: str
    message: str
    result: dict[str, object]
    block_results: list[FlowBlockExecutionResult]
    execution_scope: dict[str, object] = field(default_factory=dict)
    journal_details: dict[str, object] = field(default_factory=dict)


class ManageIntegrationFlows:
    def __init__(
        self,
        flows: IntegrationFlowRepository,
        *,
        connectors: IntegrationConnectorRepository | None = None,
        credentials: IntegrationCredentialRepository | None = None,
        database_transport: IntegrationDatabaseTransport | None = None,
        sftp_transport: IntegrationSftpTransport | None = None,
        secret_resolver: IntegrationSecretResolver | None = None,
        automations: IntegrationAutomationRepository | None = None,
    ) -> None:
        self._flows = flows
        self._connectors = connectors
        self._credentials = credentials
        self._database_transport = database_transport
        self._sftp_transport = sftp_transport
        self._secret_resolver = secret_resolver
        self._automations = automations

    def create(self, command: CreateIntegrationFlowInput) -> IntegrationFlow:
        flow = _validated_flow(
            IntegrationFlow(
                id=f"ifl-{uuid4().hex[:12]}",
                name=command.name.strip(),
                source_system=command.source_system.strip(),
                organization_id=command.organization_id,
                workspace_id=command.workspace_id,
                is_enabled=command.is_enabled,
                blocks=list(command.blocks),
                created_by_user_id=command.created_by_user_id,
            ),
            strict=False,
        )
        saved = self._flows.save(flow)
        self._sync_schedule_automations(saved)
        return saved

    def update(self, command: UpdateIntegrationFlowInput) -> IntegrationFlow:
        existing = self._flows.get(
            command.flow_id,
            organization_id=command.organization_id,
        )
        if existing is None:
            raise ValidationError(f"Integration flow {command.flow_id!r} not found")
        existing.name = command.name.strip()
        existing.source_system = command.source_system.strip()
        existing.workspace_id = command.workspace_id
        existing.is_enabled = command.is_enabled
        existing.blocks = list(command.blocks)
        existing.updated_at = datetime.utcnow()
        saved = self._flows.save(_validated_flow(existing, strict=False))
        self._sync_schedule_automations(saved)
        return saved

    def _sync_schedule_automations(self, flow: IntegrationFlow) -> None:
        """Phase 5.5 — bridge trigger_schedule blocks to the existing
        automation worker.

        For each `trigger_schedule` block in the flow, upsert an
        IntegrationAutomationJob with mode='flow', trigger_type='scheduled'
        and an `interval_minutes` parsed from the block's cron_expression.
        The worker (run_due_integration_automations) picks the job up on
        its next tick and fires `RunIntegrationFlow.execute()` for the
        bound flow.
        """
        if self._automations is None:
            return
        for block in flow.blocks:
            if block.block_type != "trigger_schedule":
                continue
            cron = str(block.config.get("cron_expression") or "").strip()
            interval_minutes = _cron_to_interval_minutes(cron)
            if interval_minutes is None:
                continue
            job_id = f"iaj-flow-{flow.id}-{block.id}"
            existing_job = self._automations.get(
                job_id, organization_id=flow.organization_id
            )
            now = datetime.utcnow()
            job = IntegrationAutomationJob(
                id=job_id,
                name=f"{flow.name} ({block.id})",
                direction="inbound",
                trigger_type="scheduled",
                source_system=flow.source_system,
                organization_id=flow.organization_id,
                workspace_id=flow.workspace_id,
                is_enabled=flow.is_enabled,
                config={
                    "mode": "flow",
                    "flow_id": flow.id,
                    "block_id": block.id,
                    "cron_expression": cron,
                    "interval_minutes": interval_minutes,
                },
                last_status=existing_job.last_status if existing_job else None,
                last_message=existing_job.last_message if existing_job else None,
                last_run_at=existing_job.last_run_at if existing_job else None,
                attempt_count=existing_job.attempt_count if existing_job else 0,
                next_attempt_at=(
                    existing_job.next_attempt_at if existing_job else now
                ),
                created_at=existing_job.created_at if existing_job else now,
                updated_at=now,
            )
            self._automations.save(job)

    def get(
        self,
        flow_id: str,
        *,
        organization_id: str | None = None,
    ) -> IntegrationFlow | None:
        flow = self._flows.get(flow_id, organization_id=organization_id)
        # Read paths only need normalisation (whitespace, structural shape).
        # Runtime validation is the caller's responsibility (run / readiness).
        return _validated_flow(flow, strict=False) if flow is not None else None

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationFlow]:
        limit = max(1, min(limit, 200))
        return [
            _validated_flow(flow, strict=False)
            for flow in self._flows.list_for_scope(
                organization_id=organization_id,
                workspace_id=workspace_id,
                limit=limit,
            )
        ]

    def evaluate_readiness(
        self,
        command: EvaluateIntegrationFlowReadinessInput,
    ) -> IntegrationFlowReadinessOutput:
        flow = IntegrationFlow(
            id="draft-readiness",
            name=command.name,
            source_system=command.source_system,
            organization_id=command.organization_id,
            workspace_id=command.workspace_id,
            is_enabled=command.is_enabled,
            blocks=[
                IntegrationFlowBlock(
                    id=raw_block.id,
                    block_type=raw_block.block_type,
                    name=raw_block.name,
                    input_block_id=raw_block.input_block_id,
                    config=dict(raw_block.config),
                )
                for raw_block in command.blocks
            ],
        )

        flow_level_blockers: list[IntegrationFlowReadinessIssue] = []
        flow_level_warnings: list[IntegrationFlowReadinessIssue] = []
        if not flow.name.strip():
            flow_level_blockers.append(
                IntegrationFlowReadinessIssue(
                    code="flow_name_missing",
                    severity="blocked",
                    message="Give this flow a name before saving or running it.",
                    suggested_action="Set Flow name at the top of the studio.",
                )
            )
        if not flow.source_system.strip():
            flow_level_blockers.append(
                IntegrationFlowReadinessIssue(
                    code="flow_source_system_missing",
                    severity="blocked",
                    message="Set the source system so this flow can be traced to ERP, MES, or another source.",
                    suggested_action="Fill Source system before running the flow.",
                )
            )
        if not flow.blocks:
            flow_level_blockers.append(
                IntegrationFlowReadinessIssue(
                    code="flow_blocks_missing",
                    severity="blocked",
                    message="Add at least one block before saving or running this flow.",
                    suggested_action="Use Recipes or Add block to start the flow.",
                )
            )
        if not flow.is_enabled:
            flow_level_warnings.append(
                IntegrationFlowReadinessIssue(
                    code="flow_disabled",
                    severity="attention",
                    message="This flow is disabled, so the engine will not run it until it is enabled again.",
                    suggested_action="Enable the flow before using it in production.",
                )
            )

        seen_ids: set[str] = set()
        blocks: list[IntegrationFlowBlock] = []
        block_issues: list[list[IntegrationFlowReadinessIssue]] = []
        block_lookup: dict[str, IntegrationFlowBlock] = {}
        for index, raw_block in enumerate(flow.blocks):
            block = IntegrationFlowBlock(
                id=raw_block.id.strip(),
                block_type=raw_block.block_type.strip().lower(),
                name=raw_block.name.strip() if raw_block.name else None,
                input_block_id=raw_block.input_block_id.strip() if raw_block.input_block_id else None,
                config=dict(raw_block.config),
            )
            issues: list[IntegrationFlowReadinessIssue] = []
            block_ref = block.id or f"block-{index + 1}"
            if not block.id:
                issues.append(
                    IntegrationFlowReadinessIssue(
                        code="block_id_missing",
                        severity="blocked",
                        message="Every flow block needs an id.",
                        block_id=block_ref,
                        suggested_action="Give this block a stable id in the step inspector.",
                    )
                )
            elif block.id in seen_ids:
                issues.append(
                    IntegrationFlowReadinessIssue(
                        code="block_id_duplicate",
                        severity="blocked",
                        message=f"Block id {block.id!r} is duplicated in this flow.",
                        block_id=block.id,
                        suggested_action="Rename one of the duplicated blocks.",
                    )
                )
            if block.block_type not in SUPPORTED_FLOW_BLOCK_TYPES:
                issues.append(
                    IntegrationFlowReadinessIssue(
                        code="block_type_unsupported",
                        severity="blocked",
                        message=(
                            f"Block {block_ref!r} uses unsupported type "
                            f"{block.block_type or '<empty>'!r}."
                        ),
                        block_id=block_ref,
                        suggested_action="Pick a block from the studio catalog or refresh the block library.",
                    )
                )
            if block.input_block_id is not None and block.input_block_id not in seen_ids:
                issues.append(
                    IntegrationFlowReadinessIssue(
                        code="input_block_missing",
                        severity="blocked",
                        message=(
                            f"Block {block_ref!r} references input block "
                            f"{block.input_block_id!r}, which is not available earlier in the flow."
                        ),
                        block_id=block_ref,
                        suggested_action="Reconnect the step to an earlier block in the canvas.",
                    )
                )
            if (
                block.block_type in FLOW_BLOCK_TYPES_REQUIRING_INPUT
                and block.input_block_id is None
                and index == 0
            ):
                issues.append(
                    IntegrationFlowReadinessIssue(
                        code="input_block_required",
                        severity="blocked",
                        message=f"{_flow_block_display_name(block)} needs data from an earlier block.",
                        block_id=block_ref,
                        suggested_action="Place this step after a block that produces JSON or APS data.",
                    )
                )
            try:
                _validate_block_config(block)
            except ValidationError as exc:
                issues.append(
                    IntegrationFlowReadinessIssue(
                        code="block_config_invalid",
                        severity="blocked",
                        message=str(exc),
                        block_id=block_ref,
                        suggested_action="Open this step and complete the missing settings.",
                    )
                )
            blocks.append(block)
            block_issues.append(issues)
            if block.id and block.id not in seen_ids:
                seen_ids.add(block.id)
                block_lookup[block.id] = block

        flow.blocks = blocks
        dependencies = _flow_block_dependencies(flow) if blocks else {}
        readiness_blocks: list[IntegrationFlowReadinessBlock] = []
        blockers = list(flow_level_blockers)
        warnings = list(flow_level_warnings)
        for block, issues in zip(blocks, block_issues, strict=True):
            if not any(issue.severity == "blocked" for issue in issues):
                issues.extend(
                    self._readiness_issues_for_block(
                        flow=flow,
                        block=block,
                        dependencies=dependencies,
                        block_lookup=block_lookup,
                    )
                )
            block_blockers = [issue for issue in issues if issue.severity == "blocked"]
            block_warnings = [issue for issue in issues if issue.severity != "blocked"]
            blockers.extend(block_blockers)
            warnings.extend(block_warnings)
            if block_blockers:
                status = "blocked"
                message = block_blockers[0].message
            elif block_warnings:
                status = "attention"
                message = block_warnings[0].message
            else:
                status = "ready"
                message = f"{_flow_block_display_name(block)} is ready."
            readiness_blocks.append(
                IntegrationFlowReadinessBlock(
                    block_id=block.id,
                    block_type=block.block_type,
                    status=status,
                    message=message,
                    issues=tuple(issues),
                )
            )

        status = "ready"
        message = "Flow is ready for save, test, and runtime execution."
        if blockers:
            status = "blocked"
            message = "Flow is blocked until the required steps, connectors, or mappings are fixed."
        elif warnings:
            status = "attention"
            message = "Flow can move forward, but a few areas still need review before production use."

        summary = {
            "block_count": len(blocks),
            "ready_block_count": sum(1 for item in readiness_blocks if item.status == "ready"),
            "attention_block_count": sum(
                1 for item in readiness_blocks if item.status == "attention"
            ),
            "blocked_block_count": sum(
                1 for item in readiness_blocks if item.status == "blocked"
            ),
            "blocker_count": len(blockers),
            "warning_count": len(warnings),
        }
        return IntegrationFlowReadinessOutput(
            status=status,
            message=message,
            blocks=tuple(readiness_blocks),
            blockers=tuple(blockers),
            warnings=tuple(warnings),
            summary=summary,
        )

    def _readiness_issues_for_block(
        self,
        *,
        flow: IntegrationFlow,
        block: IntegrationFlowBlock,
        dependencies: dict[str, str | None],
        block_lookup: dict[str, IntegrationFlowBlock],
    ) -> list[IntegrationFlowReadinessIssue]:
        if block.block_type in HTTP_FLOW_BLOCK_TYPES:
            return self._http_readiness_issues(flow=flow, block=block)
        if block.block_type in ODOO_FLOW_BLOCK_TYPES:
            return self._odoo_readiness_issues(flow=flow, block=block)
        if block.block_type == "send_sftp_file":
            return self._sftp_readiness_issues(
                flow=flow,
                block=block,
                dependencies=dependencies,
                block_lookup=block_lookup,
            )
        if block.block_type == "write_database_rows":
            return self._database_readiness_issues(
                flow=flow,
                block=block,
                dependencies=dependencies,
                block_lookup=block_lookup,
            )
        return []

    def _odoo_readiness_issues(
        self,
        *,
        flow: IntegrationFlow,
        block: IntegrationFlowBlock,
    ) -> list[IntegrationFlowReadinessIssue]:
        """V1.2 P1.1b — surface broken Odoo connector references before
        the engine dispatches the block.

        Before this method existed, an `odoo_push_schedule` flow that
        pointed at a deleted or wrong-type connector only failed at
        engine dispatch — same root cause, but no pre-flight gate and
        no actionable blocker in the readiness payload that the Studio
        readiness panel shows to the planner.

        The check piggy-backs on the existing `_connector_readiness`
        helper with `expected_type="odoo"`, so the same codes that
        already gate HTTP / SFTP / database blocks (connector_missing,
        connector_type_mismatch, …) fire identically for Odoo. The
        route's pre-flight allowlist (P1.1) catches them and refuses
        the run with 422.
        """

        issues: list[IntegrationFlowReadinessIssue] = []
        connector_id = str(block.config.get("connector_id") or "").strip()
        if not connector_id:
            # `_connector_readiness("")` returns silently — it can't tell
            # whether the empty string is a deliberate "no connector
            # needed" or a missing required setting. For Odoo blocks the
            # connector_id is always required (catalog config_fields
            # marks it required: True), so flag it here explicitly.
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="block_config_invalid",
                    severity="blocked",
                    message=(
                        f"{_flow_block_display_name(block)} requires an Odoo "
                        "connector — pick one from the dropdown."
                    ),
                    block_id=block.id,
                    suggested_action="Open this step and select the Odoo connector to use.",
                )
            )
            return issues
        _, connector_issues = self._connector_readiness(
            connector_id=connector_id,
            expected_type="odoo",
            organization_id=flow.organization_id,
            workspace_id=flow.workspace_id,
            block_id=block.id,
            label=_flow_block_display_name(block),
        )
        issues.extend(connector_issues)
        return issues

    def _http_readiness_issues(
        self,
        *,
        flow: IntegrationFlow,
        block: IntegrationFlowBlock,
    ) -> list[IntegrationFlowReadinessIssue]:
        issues: list[IntegrationFlowReadinessIssue] = []
        connector: IntegrationConnector | None = None
        request_mode = _http_request_mode(block.config)
        if request_mode == "profile":
            connector_id = str(block.config.get("connector_id") or "").strip()
            connector, connector_issues = self._connector_readiness(
                connector_id=connector_id,
                expected_type="http",
                organization_id=flow.organization_id,
                workspace_id=flow.workspace_id,
                block_id=block.id,
                label=_flow_block_display_name(block),
            )
            issues.extend(connector_issues)
        else:
            try:
                connector = _validated_direct_http_connector(
                    block_config=block.config,
                    block_id=block.id,
                    default_source_system=flow.source_system,
                )
            except ValidationError as exc:
                issues.append(
                    IntegrationFlowReadinessIssue(
                        code="direct_http_invalid",
                        severity="blocked",
                        message=str(exc),
                        block_id=block.id,
                        suggested_action="Complete the direct URL and request settings for this block.",
                    )
                )
        if issues:
            return issues
        credential_id = (
            _optional_str(block.config.get("credential_id"))
            or _optional_str(connector.credential_id if connector is not None else None)
        )
        if credential_id is not None:
            issues.extend(
                self._credential_readiness(
                    credential_id=credential_id,
                    organization_id=flow.organization_id,
                    workspace_id=flow.workspace_id,
                    block_id=block.id,
                    label=_flow_block_display_name(block),
                )
            )
        return issues

    def _sftp_readiness_issues(
        self,
        *,
        flow: IntegrationFlow,
        block: IntegrationFlowBlock,
        dependencies: dict[str, str | None],
        block_lookup: dict[str, IntegrationFlowBlock],
    ) -> list[IntegrationFlowReadinessIssue]:
        issues: list[IntegrationFlowReadinessIssue] = []
        dependency_id = dependencies.get(block.id)
        dependency_block = block_lookup.get(dependency_id or "")
        if dependency_block is None or FLOW_BLOCK_OUTPUT_KIND.get(dependency_block.block_type) != "formatted_payload":
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="sftp_input_requires_format",
                    severity="blocked",
                    message=f"{_flow_block_display_name(block)} requires formatted data from a Format Data block.",
                    block_id=block.id,
                    suggested_action="Insert Format Data immediately before Send To SFTP.",
                )
            )
        connector_id = str(block.config.get("connector_id") or "").strip()
        _, connector_issues = self._connector_readiness(
            connector_id=connector_id,
            expected_type="sftp",
            organization_id=flow.organization_id,
            workspace_id=flow.workspace_id,
            block_id=block.id,
            label=_flow_block_display_name(block),
        )
        issues.extend(connector_issues)
        if self._sftp_transport is None:
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="sftp_runtime_unavailable",
                    severity="blocked",
                    message="The SFTP runtime adapter is not configured on this server.",
                    block_id=block.id,
                    suggested_action="Install and configure the SFTP runtime before using this destination.",
                )
            )
        return issues

    def _database_readiness_issues(
        self,
        *,
        flow: IntegrationFlow,
        block: IntegrationFlowBlock,
        dependencies: dict[str, str | None],
        block_lookup: dict[str, IntegrationFlowBlock],
    ) -> list[IntegrationFlowReadinessIssue]:
        issues: list[IntegrationFlowReadinessIssue] = []
        dependency_id = dependencies.get(block.id)
        dependency_block = block_lookup.get(dependency_id or "")
        dependency_kind = (
            FLOW_BLOCK_OUTPUT_KIND.get(dependency_block.block_type) if dependency_block is not None else None
        )
        if dependency_kind not in {"formatted_payload", "snapshot", "published_plan", "api_response"}:
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="database_input_invalid",
                    severity="blocked",
                    message=(
                        f"{_flow_block_display_name(block)} needs JSON rows, a snapshot, "
                        "a published plan, or a JSON API response upstream."
                    ),
                    block_id=block.id,
                    suggested_action="Place this block after Call API, Export APS Data, Export Published Plan, or Format Data.",
                )
            )
        if dependency_block is not None and dependency_kind == "formatted_payload":
            payload_format = str(dependency_block.config.get("format") or "json").strip().lower()
            if payload_format != "json":
                issues.append(
                    IntegrationFlowReadinessIssue(
                        code="database_input_not_json",
                        severity="blocked",
                        message=f"{_flow_block_display_name(block)} requires a JSON formatted payload upstream.",
                        block_id=block.id,
                        suggested_action="Set the upstream Format Data block to JSON for database delivery.",
                    )
                )
        connector_id = str(block.config.get("connector_id") or "").strip()
        connector, connector_issues = self._connector_readiness(
            connector_id=connector_id,
            expected_type="database",
            organization_id=flow.organization_id,
            workspace_id=flow.workspace_id,
            block_id=block.id,
            label=_flow_block_display_name(block),
        )
        issues.extend(connector_issues)
        if self._database_transport is None:
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="database_runtime_unavailable",
                    severity="blocked",
                    message="The database runtime adapter is not configured on this server.",
                    block_id=block.id,
                    suggested_action="Configure the database runtime before writing rows from this flow.",
                )
            )
            return issues
        if connector is None or self._secret_resolver is None:
            return issues

        table_name = _optional_str(block.config.get("table")) or ""
        operation = (_optional_str(block.config.get("operation")) or "insert").strip().lower()
        match_columns = _string_tuple_config(block.config, "match_columns")
        try:
            inspected = self._database_transport.inspect_schema(
                build_connector_database_schema_request(
                    connector,
                    secret_resolver=self._secret_resolver,
                )
            )
        except Exception as exc:
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="database_schema_lookup_failed",
                    severity="attention",
                    message=f"Live database schema lookup failed for {_flow_block_display_name(block)}: {exc}",
                    block_id=block.id,
                    suggested_action="Check that the database connector can be reached, then retry readiness.",
                )
            )
            return issues

        table_schema = _find_database_table_schema(inspected.tables, table_name)
        if table_schema is None:
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="database_table_missing",
                    severity="blocked",
                    message=f"Destination table {table_name!r} was not found in the selected database connector.",
                    block_id=block.id,
                    suggested_action="Choose a table exposed by the connector or refresh the live schema.",
                )
            )
            return issues

        table_columns = [column.name for column in table_schema.columns if column.name]
        primary_key_columns = [
            column.name for column in table_schema.columns if column.name and column.is_primary_key
        ]
        column_map = _field_map_config(block.config, "column_map")
        mapped_columns = list(column_map.keys())
        if mapped_columns:
            unknown_columns = [column for column in mapped_columns if column not in table_columns]
            if unknown_columns:
                issues.append(
                    IntegrationFlowReadinessIssue(
                        code="database_columns_unknown",
                        severity="attention",
                        message=(
                            f"{_flow_block_display_name(block)} maps columns that are not in "
                            f"{table_schema.full_name or table_schema.name}: {', '.join(unknown_columns)}."
                        ),
                        block_id=block.id,
                        suggested_action="Align Database columns with the live schema before production delivery.",
                    )
                )
        else:
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="database_mapping_needs_preview",
                    severity="attention",
                    message=(
                        f"{table_schema.full_name or table_schema.name} is reachable, but row-to-column "
                        "mapping still needs a preview run."
                    ),
                    block_id=block.id,
                    suggested_action="Run this block in Preview only mode to confirm the outgoing rows.",
                )
            )
        if operation in {"update", "upsert"} and not match_columns and primary_key_columns:
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="database_match_columns_suggested",
                    severity="attention",
                    message=(
                        f"{_flow_block_display_name(block)} can reuse primary key columns "
                        f"for matching: {', '.join(primary_key_columns)}."
                    ),
                    block_id=block.id,
                    suggested_action="Set Table match columns to the live primary key columns for safer upserts.",
                )
            )
        invalid_match_columns = [column for column in match_columns if column not in table_columns]
        if invalid_match_columns:
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="database_match_columns_invalid",
                    severity="blocked",
                    message=(
                        f"{_flow_block_display_name(block)} references match columns outside the live table: "
                        f"{', '.join(invalid_match_columns)}."
                    ),
                    block_id=block.id,
                    suggested_action="Pick match columns from the live database schema.",
                )
            )
        return issues

    def _connector_readiness(
        self,
        *,
        connector_id: str,
        expected_type: str,
        organization_id: str | None,
        workspace_id: str | None,
        block_id: str,
        label: str,
    ) -> tuple[IntegrationConnector | None, list[IntegrationFlowReadinessIssue]]:
        issues: list[IntegrationFlowReadinessIssue] = []
        if not connector_id:
            return None, issues
        if self._connectors is None:
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="connector_registry_unavailable",
                    severity="blocked",
                    message=f"{label} references a saved connector, but connector lookup is unavailable in this runtime.",
                    block_id=block_id,
                    suggested_action="Restart the backend with integration connector support enabled.",
                )
            )
            return None, issues
        connector = self._connectors.get(connector_id, organization_id=organization_id)
        if connector is None:
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="connector_missing",
                    severity="blocked",
                    message=f"{label} references connector {connector_id!r}, which was not found.",
                    block_id=block_id,
                    suggested_action="Choose an existing connector or create one in Resources.",
                )
            )
            return None, issues
        try:
            connector = validate_integration_connector(connector)
        except ValidationError as exc:
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="connector_invalid",
                    severity="blocked",
                    message=str(exc),
                    block_id=block_id,
                    suggested_action="Repair the saved connector before using it in this flow.",
                )
            )
            return None, issues
        if not connector.is_enabled:
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="connector_disabled",
                    severity="blocked",
                    message=f"Connector {connector.id!r} is disabled.",
                    block_id=block_id,
                    suggested_action="Enable the connector in Resources or pick another one.",
                )
            )
        if (
            workspace_id is not None
            and connector.workspace_id is not None
            and connector.workspace_id != workspace_id
        ):
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="connector_workspace_mismatch",
                    severity="blocked",
                    message=f"Connector {connector.id!r} does not match the active workspace.",
                    block_id=block_id,
                    suggested_action="Select a connector from this workspace or switch workspace scope.",
                )
            )
        if connector.connector_type != expected_type:
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="connector_type_mismatch",
                    severity="blocked",
                    message=(
                        f"{label} requires a {expected_type} connector, but "
                        f"{connector.id!r} is {connector.connector_type!r}."
                    ),
                    block_id=block_id,
                    suggested_action="Choose a connector with the matching transport type.",
                )
            )
        return connector, issues

    def _credential_readiness(
        self,
        *,
        credential_id: str,
        organization_id: str | None,
        workspace_id: str | None,
        block_id: str,
        label: str,
    ) -> list[IntegrationFlowReadinessIssue]:
        issues: list[IntegrationFlowReadinessIssue] = []
        if self._credentials is None:
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="credential_registry_unavailable",
                    severity="blocked",
                    message=f"{label} references a saved credential, but credential lookup is unavailable in this runtime.",
                    block_id=block_id,
                    suggested_action="Restart the backend with saved credential support enabled.",
                )
            )
            return issues
        credential = self._credentials.get(credential_id, organization_id=organization_id)
        if credential is None:
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="credential_missing",
                    severity="blocked",
                    message=f"{label} references credential {credential_id!r}, which was not found.",
                    block_id=block_id,
                    suggested_action="Pick an existing saved credential or remove it from this block.",
                )
            )
            return issues
        try:
            credential = validate_integration_credential(credential)
        except ValidationError as exc:
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="credential_invalid",
                    severity="blocked",
                    message=str(exc),
                    block_id=block_id,
                    suggested_action="Repair the saved credential before using it in this block.",
                )
            )
            return issues
        if not credential.is_enabled:
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="credential_disabled",
                    severity="blocked",
                    message=f"Credential {credential.id!r} is disabled.",
                    block_id=block_id,
                    suggested_action="Enable the saved credential or pick another one.",
                )
            )
        if (
            workspace_id is not None
            and credential.workspace_id is not None
            and credential.workspace_id != workspace_id
        ):
            issues.append(
                IntegrationFlowReadinessIssue(
                    code="credential_workspace_mismatch",
                    severity="blocked",
                    message=f"Credential {credential.id!r} does not match the active workspace.",
                    block_id=block_id,
                    suggested_action="Select a credential from this workspace or switch workspace scope.",
                )
            )
        return issues


class RunIntegrationFlow:
    def __init__(
        self,
        *,
        flows: IntegrationFlowRepository,
        journal: IntegrationJournalRepository,
        exporter: ExportPlanningSnapshot,
        plan_exporter: ExportPublishedPlan,
        importer: ImportPlanningSnapshot,
        scheduler: RunSchedulingFromSnapshot,
        connectors: IntegrationConnectorRepository,
        credentials: IntegrationCredentialRepository | None = None,
        secret_resolver: IntegrationSecretResolver,
        http_transport: IntegrationHttpTransport,
        database_transport: IntegrationDatabaseTransport | None = None,
        sftp_transport: IntegrationSftpTransport | None = None,
        executions: IntegrationExecutionRepository | None = None,
        flow_run_traces: FlowRunTraceRepository | None = None,
        bindings: IntegrationBindingRepository | None = None,
    ) -> None:
        self._flows = flows
        self._journal = journal
        self._exporter = exporter
        self._plan_exporter = plan_exporter
        self._importer = importer
        self._flow_run_traces = flow_run_traces
        self._scheduler = scheduler
        self._connectors = connectors
        self._credentials = credentials
        self._secret_resolver = secret_resolver
        self._http_transport = http_transport
        self._database_transport = database_transport
        self._sftp_transport = sftp_transport
        self._executions = executions
        self._bindings = bindings

    def execute(self, command: RunIntegrationFlowInput) -> RunIntegrationFlowOutput:
        flow = self._flows.get(command.flow_id, organization_id=command.organization_id)
        if flow is None:
            raise RunIntegrationFlowRejected(
                "flow_not_found",
                f"Integration flow {command.flow_id!r} was not found.",
            )
        flow = _validated_flow(flow)
        if not flow.is_enabled:
            raise RunIntegrationFlowRejected(
                "flow_disabled",
                f"Integration flow {command.flow_id!r} is disabled.",
            )
        if (
            command.workspace_id is not None
            and flow.workspace_id is not None
            and flow.workspace_id != command.workspace_id
        ):
            raise RunIntegrationFlowRejected(
                "cross_workspace_forbidden",
                "Integration flow workspace does not match the active workspace.",
            )

        actor_details = dict(command.actor_details)
        ensure_integration_correlation_id(actor_details)
        started_at = datetime.utcnow()
        execution = self._execute_flow(
            flow,
            organization_id=flow.organization_id or command.organization_id,
            workspace_id=flow.workspace_id or command.workspace_id,
            start_block_id=_optional_str(command.start_block_id),
            stop_after_block_id=_optional_str(command.stop_after_block_id),
            trigger_payload=command.trigger_payload,
        )
        now = datetime.utcnow()
        flow.last_status = execution.status
        flow.last_message = execution.message
        flow.last_run_at = now
        flow.updated_at = now
        saved_flow = self._flows.save(flow)
        journal_entry = None
        if command.journal_action:
            journal_entry = self._save_journal_entry(
                flow=saved_flow,
                execution=execution,
                action=command.journal_action,
                actor_details=actor_details,
                organization_id=flow.organization_id or command.organization_id,
                workspace_id=flow.workspace_id or command.workspace_id,
            )
        self._save_execution_record(
            flow=saved_flow,
            execution=execution,
            actor_details=actor_details,
            journal_entry=journal_entry,
            organization_id=flow.organization_id or command.organization_id,
            workspace_id=flow.workspace_id or command.workspace_id,
            started_at=started_at,
            finished_at=now,
        )
        run_id = self._persist_flow_run_traces(
            flow=saved_flow,
            execution=execution,
            organization_id=flow.organization_id or command.organization_id,
            workspace_id=flow.workspace_id or command.workspace_id,
            started_at=started_at,
        )
        execution_scope = dict(execution.execution_scope)
        if run_id is not None:
            execution_scope["run_id"] = run_id
        return RunIntegrationFlowOutput(
            flow=saved_flow,
            status=execution.status,
            message=execution.message,
            block_results=execution.block_results,
            result=execution.result,
            execution_scope=execution_scope,
            journal_entry=journal_entry,
        )

    def test_block(self, command: TestFlowBlockInput) -> TestFlowBlockOutput:
        """Studio v2 phase 4 — single-block dry-run.

        Reuses the same `_execute_block` runtime as a real flow run, but
        skips the orchestration around it: no `_FlowExecution`, no journal
        entry, no trace persistence, no flow.last_status update. Tenant
        scope enforced via `flows.get(...)` + workspace check (mirrors
        the get_integration_flow route pattern).
        """
        flow = self._flows.get(
            command.flow_id, organization_id=command.organization_id
        )
        if flow is None:
            raise ValidationError(
                f"Integration flow {command.flow_id!r} not found."
            )
        if (
            command.workspace_id is not None
            and flow.workspace_id is not None
            and flow.workspace_id != command.workspace_id
        ):
            raise ValidationError(
                f"Integration flow {command.flow_id!r} not found."
            )
        block = next(
            (b for b in flow.blocks if b.id == command.block_id), None
        )
        if block is None:
            raise ValidationError(
                f"Block {command.block_id!r} is not part of flow "
                f"{command.flow_id!r}."
            )
        if (
            command.input_value is None
            and block.block_type in FLOW_BLOCK_TYPES_REQUIRING_INPUT
        ):
            raise ValidationError(
                f"Block type {block.block_type!r} needs an input value to "
                "test in isolation. Provide one in the request body or run "
                "the full flow."
            )
        started = datetime.utcnow()
        try:
            output, status, message = self._execute_block(
                flow=flow,
                block=block,
                input_value=command.input_value,
                organization_id=command.organization_id,
                workspace_id=command.workspace_id,
            )
        except _FlowBlocked as exc:
            duration_ms = max(
                int((datetime.utcnow() - started).total_seconds() * 1000), 0
            )
            return TestFlowBlockOutput(
                block_id=block.id,
                block_type=block.block_type,
                status="blocked",
                message=exc.message,
                input_preview=_preview_flow_output(command.input_value),
                output_preview=None,
                duration_ms=duration_ms,
            )
        duration_ms = max(
            int((datetime.utcnow() - started).total_seconds() * 1000), 0
        )
        return TestFlowBlockOutput(
            block_id=block.id,
            block_type=block.block_type,
            status=status,
            message=message,
            input_preview=_preview_flow_output(command.input_value),
            output_preview=_preview_flow_output(output),
            duration_ms=duration_ms,
        )

    def _persist_flow_run_traces(
        self,
        *,
        flow: IntegrationFlow,
        execution: _FlowExecution,
        organization_id: str | None,
        workspace_id: str | None,
        started_at: datetime,
    ) -> str | None:
        """Studio v2 phase 3: write one trace row per executed block,
        masked server-side. Returns the run_id that was assigned (also
        echoed in execution_scope so the UI can hit /trace by id).
        Silent no-op when no FlowRunTraceRepository was wired in."""
        if self._flow_run_traces is None or not execution.block_results:
            return None
        run_id = f"run-{uuid4().hex[:12]}"
        traces: list[FlowRunTrace] = [
            FlowRunTrace(
                id=f"trace-{run_id}-{idx}",
                flow_id=flow.id,
                run_id=run_id,
                block_id=br.block_id,
                block_type=br.block_type,
                status=br.status,
                duration_ms=0,
                error_message=br.message if br.status != "ok" else None,
                organization_id=organization_id,
                workspace_id=workspace_id,
                input_payload=mask_payload(br.input_preview or {}),
                output_payload=mask_payload(br.output_preview or {}),
                started_at=started_at,
            )
            for idx, br in enumerate(execution.block_results)
        ]
        self._flow_run_traces.save_many(traces)
        return run_id

    def _execute_flow(
        self,
        flow: IntegrationFlow,
        *,
        organization_id: str | None,
        workspace_id: str | None,
        start_block_id: str | None = None,
        stop_after_block_id: str | None = None,
        trigger_payload: dict[str, object] | None = None,
    ) -> _FlowExecution:
        execution_plan = _build_flow_execution_plan(
            flow,
            start_block_id=start_block_id,
            stop_after_block_id=stop_after_block_id,
        )
        dag = _build_flow_dag(flow)
        cycle_offenders = _detect_cycles(dag)
        if cycle_offenders:
            raise ValidationError(
                "Integration flow has a cycle involving blocks: "
                + ", ".join(repr(b) for b in cycle_offenders)
            )
        block_outputs: dict[str, dict[str, object]] = {}
        block_results: list[FlowBlockExecutionResult] = []
        executed_blocks: list[IntegrationFlowBlock] = []
        block_by_id = {b.id: b for b in flow.blocks}
        ordered_ids = _topological_order([b.id for b in flow.blocks], dag)
        activated_outgoing: dict[str, set[str]] = {bid: set() for bid in ordered_ids}
        for block_id in ordered_ids:
            if block_id not in execution_plan["execute_block_ids"]:
                continue
            block = block_by_id[block_id]
            block_inputs = dag.get(block_id, [])
            # Skip downstream blocks whose incoming branch was never activated.
            if block_inputs:
                any_active_incoming = any(
                    edge.source_block_id in block_outputs
                    and edge.edge_type
                    in activated_outgoing.get(edge.source_block_id, set())
                    for edge in block_inputs
                )
                if not any_active_incoming:
                    block_results.append(
                        FlowBlockExecutionResult(
                            block_id=block.id,
                            block_type=block.block_type,
                            status="skipped",
                            message="Skipped — no incoming branch was activated.",
                            input_preview=None,
                        )
                    )
                    continue
            input_value: dict[str, object] | None = None
            for edge in block_inputs:
                if (
                    edge.edge_type
                    not in activated_outgoing.get(edge.source_block_id, set())
                ):
                    continue
                upstream = block_outputs.get(edge.source_block_id)
                if upstream is not None:
                    input_value = upstream
                    break
            if block_inputs and input_value is None:
                missing = block_inputs[0].source_block_id
                message = (
                    f"Flow block {block.id!r} requires output from "
                    f"{missing!r}, but it is not available."
                )
                block_results.append(
                    FlowBlockExecutionResult(
                        block_id=block.id,
                        block_type=block.block_type,
                        status="failed",
                        message=message,
                        input_preview=_preview_flow_output(input_value),
                    )
                )
                return _FlowExecution(
                    status="failed",
                    message=message,
                    result={
                        "kind": "flow_error",
                        "block_id": block.id,
                        "block_type": block.block_type,
                        "error": message,
                    },
                    block_results=block_results,
                    execution_scope=_flow_execution_scope(
                        flow=flow,
                        executed_blocks=executed_blocks,
                        start_block_id=start_block_id,
                        stop_after_block_id=stop_after_block_id,
                        final_block=None,
                    ),
                    journal_details={
                        "failed_block_id": block.id,
                        "failed_block_type": block.block_type,
                    },
                )
            try:
                output, status, message = _run_block_with_retry(
                    self,
                    flow=flow,
                    block=block,
                    input_value=input_value,
                    organization_id=organization_id,
                    workspace_id=workspace_id,
                    trigger_payload=trigger_payload,
                )
            except _FlowBlocked as exc:
                block_results.append(
                    FlowBlockExecutionResult(
                        block_id=block.id,
                        block_type=block.block_type,
                        status="blocked",
                        message=exc.message,
                        input_preview=_preview_flow_output(input_value),
                        output_preview=_preview_flow_output(exc.result),
                        output_summary=_summarize_flow_output(exc.result),
                    )
                )
                return _FlowExecution(
                    status="blocked",
                    message=exc.message,
                    result=exc.result,
                    block_results=block_results,
                    execution_scope=_flow_execution_scope(
                        flow=flow,
                        executed_blocks=executed_blocks + [block],
                        start_block_id=start_block_id,
                        stop_after_block_id=stop_after_block_id,
                        final_block=block,
                    ),
                    journal_details={
                        "blocked_block_id": block.id,
                        "blocked_block_type": block.block_type,
                        "requested_start_block_id": start_block_id,
                        "requested_stop_after_block_id": stop_after_block_id,
                    },
                )
            except Exception as exc:
                message = f"Flow block {block.id!r} failed: {exc}"
                error_envelope = {
                    "kind": "error_envelope",
                    "failed_block_id": block.id,
                    "failed_block_type": block.block_type,
                    "error_message": str(exc),
                }
                if _block_has_error_edge(block.id, dag):
                    block_outputs[block.id] = error_envelope
                    activated_outgoing[block.id] = _activated_edge_types_for_block(
                        block.block_type, error_envelope, failed=True
                    )
                    block_results.append(
                        FlowBlockExecutionResult(
                            block_id=block.id,
                            block_type=block.block_type,
                            status="failed",
                            message=message,
                            input_preview=_preview_flow_output(input_value),
                            output_preview=_preview_flow_output(error_envelope),
                            output_summary=_summarize_flow_output(error_envelope),
                        )
                    )
                    executed_blocks.append(block)
                    continue
                # No error consumer — preserve the v1 hard-fail contract.
                block_results.append(
                    FlowBlockExecutionResult(
                        block_id=block.id,
                        block_type=block.block_type,
                        status="failed",
                        message=message,
                        input_preview=_preview_flow_output(input_value),
                    )
                )
                return _FlowExecution(
                    status="failed",
                    message=message,
                    result={
                        "kind": "flow_error",
                        "block_id": block.id,
                        "block_type": block.block_type,
                        "error": str(exc),
                    },
                    block_results=block_results,
                    execution_scope=_flow_execution_scope(
                        flow=flow,
                        executed_blocks=executed_blocks,
                        start_block_id=start_block_id,
                        stop_after_block_id=stop_after_block_id,
                        final_block=None,
                    ),
                    journal_details={
                        "failed_block_id": block.id,
                        "failed_block_type": block.block_type,
                        "requested_start_block_id": start_block_id,
                        "requested_stop_after_block_id": stop_after_block_id,
                    },
                )
            block_outputs[block.id] = output
            activated_outgoing[block.id] = _activated_edge_types_for_block(
                block.block_type, output
            )
            executed_blocks.append(block)
            block_results.append(
                FlowBlockExecutionResult(
                    block_id=block.id,
                    block_type=block.block_type,
                    status=status,
                    message=message,
                    input_preview=_preview_flow_output(input_value),
                    output_preview=_preview_flow_output(output),
                    output_summary=_summarize_flow_output(output),
                )
            )

        if not executed_blocks:
            raise ValidationError("Integration flow preview did not select any executable block.")

        had_errors = any(r.status == "failed" for r in block_results)
        flow_status = "completed_with_errors" if had_errors else "completed"
        final_block = executed_blocks[-1]
        final_result = block_outputs[final_block.id]
        return _FlowExecution(
            status=flow_status,
            message=_flow_completion_message(
                flow=flow,
                start_block_id=start_block_id,
                stop_after_block_id=stop_after_block_id,
            ),
            result=final_result,
            block_results=block_results,
            execution_scope=_flow_execution_scope(
                flow=flow,
                executed_blocks=executed_blocks,
                start_block_id=start_block_id,
                stop_after_block_id=stop_after_block_id,
                final_block=final_block,
            ),
            journal_details={
                "final_block_id": final_block.id,
                "final_block_type": final_block.block_type,
                "final_output": _summarize_flow_output(final_result),
                "requested_start_block_id": start_block_id,
                "requested_stop_after_block_id": stop_after_block_id,
                "executed_block_ids": [block.id for block in executed_blocks],
                "had_errors": had_errors,
            },
        )

    def _execute_block(
        self,
        *,
        flow: IntegrationFlow,
        block: IntegrationFlowBlock,
        input_value: dict[str, object] | None,
        organization_id: str | None,
        workspace_id: str | None,
        trigger_payload: dict[str, object] | None = None,
    ) -> tuple[dict[str, object], str, str]:
        # Studio v2 phase 5 — trigger blocks act as pass-through producers.
        # They emit a small `trigger_event` payload that downstream blocks
        # can consume. Cron-firing + authenticated public webhook endpoint
        # ship in Phase 5.5.
        if block.block_type == "trigger_manual":
            return (
                {
                    "kind": "trigger_event",
                    "via": "manual",
                    "triggered_at": datetime.utcnow().isoformat(),
                },
                "ready",
                "Manual trigger fired.",
            )
        if block.block_type == "trigger_schedule":
            cron = str(block.config.get("cron_expression") or "").strip()
            return (
                {
                    "kind": "trigger_event",
                    "via": "schedule",
                    "cron_expression": cron,
                    "triggered_at": datetime.utcnow().isoformat(),
                },
                "ready",
                (
                    f"Schedule trigger placeholder (cron={cron or '<unset>'}). "
                    "Worker firing not wired yet."
                ),
            )
        if block.block_type == "trigger_webhook":
            token = _webhook_token_for(flow_id=flow.id, block_id=block.id)
            output: dict[str, object] = {
                "kind": "trigger_event",
                "via": "webhook",
                "webhook_token": token,
                "triggered_at": datetime.utcnow().isoformat(),
            }
            if trigger_payload is not None:
                # V1.2 P3 webhook ingress slice 2 — the inbound JSON
                # body is exposed on the block's output so downstream
                # blocks (logic_branch_if reading $.payload.priority,
                # import_snapshot using the body as its source, etc.)
                # can route on the data the external system pushed.
                output["payload"] = trigger_payload
                message = "Webhook received with payload."
            else:
                # Manual / scheduled trigger, or a webhook POST with a
                # non-JSON body — the existing placeholder behavior is
                # preserved so flows that don't depend on inbound data
                # keep working unchanged.
                message = "Webhook trigger placeholder (no payload)."
            return (output, "ready", message)
        # Studio v2 phase 6 — logic blocks. The DAG runner reads the
        # `__branch_decision` key on the output dict to figure out which
        # outgoing edge_type was activated. Merge is a pass-through.
        if block.block_type == "logic_branch_if":
            condition_path = str(block.config.get("condition_path") or "")
            expected_raw = block.config.get("expected_value")
            resolved = _resolve_branch_value(input_value, condition_path)
            if expected_raw is None or expected_raw == "":
                truthy = bool(resolved)
            else:
                truthy = (
                    resolved == expected_raw
                    or str(resolved) == str(expected_raw)
                )
            decision = "branch_true" if truthy else "branch_false"
            return (
                {
                    "kind": "branch_decision",
                    "decision": decision,
                    "evaluated_path": condition_path,
                    "evaluated_value": resolved,
                    "__branch_decision": decision,
                },
                "ready",
                f"Branch decision: {decision}",
            )
        if block.block_type == "logic_branch_switch":
            condition_path = str(block.config.get("condition_path") or "")
            cases_raw = block.config.get("cases") or []
            cases: list[str] = (
                [str(c) for c in cases_raw] if isinstance(cases_raw, list) else []
            )
            resolved = _resolve_branch_value(input_value, condition_path)
            resolved_str = "" if resolved is None else str(resolved)
            matched_case: str | None = next(
                (c for c in cases if c == resolved_str),
                None,
            )
            decision = "branch_case" if matched_case is not None else "branch_default"
            return (
                {
                    "kind": "branch_decision",
                    "decision": decision,
                    "matched_case": matched_case,
                    "evaluated_path": condition_path,
                    "evaluated_value": resolved,
                    "__branch_decision": decision,
                    "__branch_case_value": matched_case,
                },
                "ready",
                (
                    f"Switch matched case {matched_case!r}"
                    if matched_case is not None
                    else "Switch fell through to default"
                ),
            )
        if block.block_type == "logic_merge":
            forwarded = input_value if input_value is not None else {}
            return (
                {"kind": "merge_passthrough", "forwarded": forwarded},
                "ready",
                "Merged upstream output forwarded.",
            )
        # Phase 7 — error_handler is a passthrough that wraps the upstream
        # failure envelope so downstream blocks (notify connector, audit
        # writer, ...) can consume a structured value.
        if block.block_type == "error_handler":
            envelope = (
                input_value
                if isinstance(input_value, dict)
                else {"kind": "error_envelope", "error": str(input_value)}
            )
            return (
                {
                    "kind": "error_handled",
                    "handled_block_id": envelope.get("failed_block_id"),
                    "handled_block_type": envelope.get("failed_block_type"),
                    "error_message": envelope.get("error_message"),
                    "envelope": envelope,
                },
                "ready",
                "Error envelope captured.",
            )
        if block.block_type == "export_snapshot":
            snapshot = self._exporter.execute(
                ExportPlanningSnapshotInput(
                    source_system=str(block.config.get("source_system") or flow.source_system),
                    transfer_times=transfer_times_from_config(block.config),
                    metadata=_dict_config(block.config, "metadata"),
                    organization_id=organization_id,
                    workspace_id=workspace_id,
                )
            )
            return (
                snapshot_envelope(snapshot),
                "ready",
                "Snapshot exported from the active workspace.",
            )
        if block.block_type == "export_published_plan":
            published_plan = self._plan_exporter.execute(
                ExportPublishedPlanInput(
                    source_system=str(
                        block.config.get("source_system") or flow.source_system
                    ),
                    organization_id=organization_id,
                    workspace_id=workspace_id,
                    schedule_id=_optional_str(block.config.get("schedule_id")),
                    compare_to_schedule_id=_optional_str(
                        block.config.get("compare_to_schedule_id")
                    ),
                    mode=str(block.config.get("mode") or "full"),
                    metadata=_dict_config(block.config, "metadata"),
                )
            )
            return (
                {
                    "kind": "published_plan",
                    "plan": published_plan.as_dict(),
                    "plan_hash": published_plan.export_hash,
                    "entity_counts": dict(published_plan.entity_counts),
                    "change_counts": dict(published_plan.change_counts),
                    "mode": published_plan.mode,
                },
                "ready",
                "Published APS plan exported for outbound delivery.",
            )
        if block.block_type == "call_connector_api":
            resolved_config = _resolve_flow_config_variables(block.config, input_value)
            connector = self._resolve_http_request_connector(
                block_id=block.id,
                block_config=resolved_config,
                organization_id=organization_id,
                workspace_id=workspace_id,
                default_source_system=flow.source_system,
            )
            target_label = _http_target_label(connector, resolved_config)
            request = _build_flow_http_request(
                connector=connector,
                block_config=resolved_config,
                flow_id=flow.id,
                block_id=block.id,
                default_source_system=flow.source_system,
                secret_resolver=self._secret_resolver,
                body=http_body_from_config(resolved_config),
            )
            response = self._http_transport.send(request)
            preview = response.body.decode("utf-8", errors="replace")[:500]
            if response.status_code < 200 or response.status_code >= 300:
                raise ValidationError(
                    f"{target_label} responded with HTTP {response.status_code}."
                )
            try:
                response_json = json.loads(response.body.decode("utf-8"))
            except json.JSONDecodeError as exc:
                raise ValidationError(
                    f"{target_label} did not return valid JSON."
                ) from exc
            payload_json = _extract_json_path(
                response_json,
                _optional_str(resolved_config.get("response_root")),
                label=f"Flow block {block.id}",
            )
            return (
                {
                    "kind": "api_response",
                    "response_json": payload_json,
                    "connector_id": connector.id if connector.id.startswith("icn-") else None,
                    "connector_name": connector.name if connector.id.startswith("icn-") else None,
                    "request_target": target_label,
                    "request_url": request.url,
                    "route_path": _optional_str(resolved_config.get("route_path")),
                    "http_method": request.method,
                    "http_status": response.status_code,
                    "response_preview": preview,
                },
                "received",
                "Connector API response received.",
            )
        if block.block_type == "odoo_search_read":
            resolved_config = _resolve_flow_config_variables(block.config, input_value)
            connector_id = _optional_str(resolved_config.get("connector_id"))
            if not connector_id:
                raise ValidationError(
                    f"Flow block {block.id!r} (odoo_search_read) requires config.connector_id."
                )
            if self._connectors is None:
                raise ValidationError(
                    f"Flow block {block.id!r} references a connector, but connector "
                    "lookup is unavailable in this runtime."
                )
            connector = self._connectors.get(
                connector_id, organization_id=organization_id
            )
            if connector is None:
                raise ValidationError(
                    f"Odoo connector {connector_id!r} not found."
                )
            if connector.connector_type != "odoo":
                raise ValidationError(
                    f"Connector {connector_id!r} is type "
                    f"{connector.connector_type!r}, expected 'odoo'."
                )
            if not connector.secret_ref or self._secret_resolver is None:
                raise ValidationError(
                    f"Odoo connector {connector_id!r} has no API key secret configured."
                )
            model = _optional_str(resolved_config.get("model"))
            if not model:
                raise ValidationError(
                    f"Flow block {block.id!r} (odoo_search_read) requires config.model."
                )
            base_url, database = parse_odoo_endpoint(connector)
            api_key = self._secret_resolver.resolve(connector.secret_ref)
            client = OdooClient(
                self._http_transport,
                base_url=base_url,
                database=database,
                username=connector.username or "",
                api_key=api_key,
                timeout_seconds=connector.timeout_seconds,
            )
            domain_raw = resolved_config.get("domain") or []
            fields_raw = resolved_config.get("fields") or []
            try:
                limit = int(resolved_config.get("limit") or 100)
            except (TypeError, ValueError) as exc:
                raise ValidationError(
                    f"Flow block {block.id!r} (odoo_search_read) config.limit must be an integer."
                ) from exc
            try:
                records = client.search_read(
                    model,
                    domain=list(domain_raw),
                    fields=list(fields_raw),
                    limit=limit,
                )
            except OdooClientError as exc:
                raise ValidationError(
                    f"Odoo {model} search_read failed: {exc}"
                ) from exc
            return (
                {
                    "kind": "api_response",
                    "response_json": records,
                    "connector_id": connector.id if connector.id.startswith("icn-") else None,
                    "connector_name": connector.name if connector.id.startswith("icn-") else None,
                    "odoo_model": model,
                    "odoo_database": database,
                    "record_count": len(records),
                },
                "received",
                f"{len(records)} record(s) read from Odoo {model}.",
            )
        if block.block_type == "odoo_planning_snapshot":
            resolved_config = _resolve_flow_config_variables(block.config, input_value)
            connector_id = _optional_str(resolved_config.get("connector_id"))
            if not connector_id:
                raise ValidationError(
                    f"Flow block {block.id!r} (odoo_planning_snapshot) requires config.connector_id."
                )
            if self._connectors is None:
                raise ValidationError(
                    f"Flow block {block.id!r} references a connector, but connector "
                    "lookup is unavailable in this runtime."
                )
            connector = self._connectors.get(
                connector_id, organization_id=organization_id
            )
            if connector is None:
                raise ValidationError(f"Odoo connector {connector_id!r} not found.")
            if connector.connector_type != "odoo":
                raise ValidationError(
                    f"Connector {connector_id!r} is type "
                    f"{connector.connector_type!r}, expected 'odoo'."
                )
            if not connector.secret_ref or self._secret_resolver is None:
                raise ValidationError(
                    f"Odoo connector {connector_id!r} has no API key secret configured."
                )
            base_url, database = parse_odoo_endpoint(connector)
            api_key = self._secret_resolver.resolve(connector.secret_ref)
            client = OdooClient(
                self._http_transport,
                base_url=base_url,
                database=database,
                username=connector.username or "",
                api_key=api_key,
                timeout_seconds=connector.timeout_seconds,
            )
            mo_domain_raw = resolved_config.get("mo_domain") or []
            try:
                default_duration = int(
                    resolved_config.get("default_operation_duration_minutes") or 60
                )
            except (TypeError, ValueError) as exc:
                raise ValidationError(
                    f"Flow block {block.id!r} config.default_operation_duration_minutes must be an integer."
                ) from exc
            try:
                mo_limit = int(resolved_config.get("mo_limit") or 200)
            except (TypeError, ValueError) as exc:
                raise ValidationError(
                    f"Flow block {block.id!r} config.mo_limit must be an integer."
                ) from exc
            try:
                snapshot = client.pull_planning_snapshot(
                    mo_domain=list(mo_domain_raw),
                    mo_limit=mo_limit,
                    default_operation_duration_minutes=default_duration,
                    source_system=connector.source_system or "odoo",
                )
            except OdooClientError as exc:
                raise ValidationError(
                    f"Odoo planning snapshot pull failed: {exc}"
                ) from exc
            return (
                snapshot_envelope(
                    snapshot,
                    mapped_from="odoo",
                    connector_id=connector.id if connector.id.startswith("icn-") else None,
                    connector_name=connector.name if connector.id.startswith("icn-") else None,
                    odoo_database=database,
                ),
                "mapped",
                f"Pulled {len(snapshot.work_orders)} MO(s) from Odoo into the APS dataset.",
            )
        if block.block_type == "odoo_push_schedule":
            plan_json = _extract_plan_json(
                input_value, label=f"Flow block {block.id}"
            )
            resolved_config = _resolve_flow_config_variables(block.config, input_value)
            connector_id = _optional_str(resolved_config.get("connector_id"))
            if not connector_id:
                raise ValidationError(
                    f"Flow block {block.id!r} (odoo_push_schedule) requires config.connector_id."
                )
            if self._connectors is None:
                raise ValidationError(
                    f"Flow block {block.id!r} references a connector, but connector "
                    "lookup is unavailable in this runtime."
                )
            connector = self._connectors.get(
                connector_id, organization_id=organization_id
            )
            if connector is None:
                raise ValidationError(f"Odoo connector {connector_id!r} not found.")
            if connector.connector_type != "odoo":
                raise ValidationError(
                    f"Connector {connector_id!r} is type "
                    f"{connector.connector_type!r}, expected 'odoo'."
                )
            if not connector.secret_ref or self._secret_resolver is None:
                raise ValidationError(
                    f"Odoo connector {connector_id!r} has no API key secret configured."
                )
            base_url, database = parse_odoo_endpoint(connector)
            api_key = self._secret_resolver.resolve(connector.secret_ref)
            client = OdooClient(
                self._http_transport,
                base_url=base_url,
                database=database,
                username=connector.username or "",
                api_key=api_key,
                timeout_seconds=connector.timeout_seconds,
            )
            external_ref_lookup = None
            if self._bindings is not None:
                bindings_repo = self._bindings
                source_system_for_lookup = connector.source_system

                def external_ref_lookup(entity_type: str, internal_ids):
                    return bindings_repo.find_external_refs(
                        entity_type=entity_type,
                        source_system=source_system_for_lookup,
                        internal_ids=internal_ids,
                    )

            writes = published_plan_to_odoo_writes(
                plan_json,
                external_ref_lookup=external_ref_lookup,
            )
            if not writes:
                return (
                    {
                        "kind": "connector_delivery",
                        "connector_id": connector.id if connector.id.startswith("icn-") else None,
                        "connector_name": connector.name if connector.id.startswith("icn-") else None,
                        "odoo_database": database,
                        "written_records": 0,
                        "production_writes": 0,
                        "workorder_writes": 0,
                    },
                    "delivered",
                    "Published plan had no Odoo-bound records to push (no external_ref or no planned dates).",
                )
            # V1.2 P0.3b — per-record breakdown. Previously the loop
            # aborted on the first OdooClientError, leaving the planner
            # with "Odoo push failed: <opaque>" and no idea which MOs
            # had already been written to Odoo. Now we attempt every
            # write, collect per-record results, and surface the full
            # breakdown in both the success path and the error message.
            # The block still raises when ANY record fails (preserves
            # the existing "all-or-nothing fail" contract for retry +
            # error-edge logic), but with a message the planner can
            # actually act on: "5/7 written, 2 failed: MO 42 (date_start
            # invalid), workorder 99 (not found)".
            production_count = 0
            workorder_count = 0
            per_record: list[dict[str, object]] = []
            for op in writes:
                target_id = op.ids[0] if op.ids else None
                try:
                    client.write(op.model, list(op.ids), op.vals)
                    if op.model == "mrp.production":
                        production_count += 1
                    elif op.model == "mrp.workorder":
                        workorder_count += 1
                    per_record.append(
                        {
                            "model": op.model,
                            "id": target_id,
                            "status": "written",
                        }
                    )
                except OdooClientError as exc:
                    per_record.append(
                        {
                            "model": op.model,
                            "id": target_id,
                            "status": "failed",
                            "error": str(exc),
                        }
                    )
            failed = [r for r in per_record if r["status"] == "failed"]
            if failed:
                # Render the first 3 failure causes inline so the planner
                # sees a useful summary at the top; the full list lives
                # in the journal and trace via the original exception.
                preview = "; ".join(
                    f"{r['model']} {r['id']}: {r['error']}" for r in failed[:3]
                )
                more = (
                    f" (+{len(failed) - 3} more)"
                    if len(failed) > 3
                    else ""
                )
                raise ValidationError(
                    f"Odoo push partially failed: {len(per_record) - len(failed)} "
                    f"OK, {len(failed)} failed — {preview}{more}"
                )
            return (
                {
                    "kind": "connector_delivery",
                    "connector_id": connector.id if connector.id.startswith("icn-") else None,
                    "connector_name": connector.name if connector.id.startswith("icn-") else None,
                    "odoo_database": database,
                    "written_records": len(writes),
                    "production_writes": production_count,
                    "workorder_writes": workorder_count,
                    "per_record_results": per_record,
                },
                "delivered",
                f"Pushed {production_count} MO + {workorder_count} workorder date(s) back to Odoo.",
            )
        if block.block_type == "send_connector_request":
            resolved_config = _resolve_flow_config_variables(block.config, input_value)
            connector = self._resolve_http_request_connector(
                block_id=block.id,
                block_config=resolved_config,
                organization_id=organization_id,
                workspace_id=workspace_id,
                default_source_system=flow.source_system,
            )
            method = _resolved_http_method(connector, resolved_config)
            if method == "GET":
                raise ValidationError(
                    f"Flow block {block.id!r} must use POST, PUT, or PATCH to send a payload."
                )
            request_body = http_body_from_config(resolved_config)
            if request_body is None:
                raise ValidationError(
                    f"Flow block {block.id!r} requires config.request_body to send a payload."
                )
            target_label = _http_target_label(connector, resolved_config)
            request = _build_flow_http_request(
                connector=connector,
                block_config=resolved_config,
                flow_id=flow.id,
                block_id=block.id,
                default_source_system=flow.source_system,
                secret_resolver=self._secret_resolver,
                body=request_body,
                payload_kind="custom_payload",
            )
            response = self._http_transport.send(request)
            preview = response.body.decode("utf-8", errors="replace")[:500]
            if response.status_code < 200 or response.status_code >= 300:
                raise ValidationError(
                    f"{target_label} responded with HTTP {response.status_code}."
                )
            return (
                {
                    "kind": "connector_delivery",
                    "connector_id": connector.id if connector.id.startswith("icn-") else None,
                    "connector_name": connector.name if connector.id.startswith("icn-") else None,
                    "request_target": target_label,
                    "request_url": request.url,
                    "route_path": _optional_str(resolved_config.get("route_path")),
                    "http_method": request.method,
                    "http_status": response.status_code,
                    "response_preview": preview,
                    "payload_hash": sha256(request_body).hexdigest(),
                },
                "delivered",
                "Custom API payload delivered to the external connector.",
            )
        if block.block_type == "pull_snapshot_from_connector":
            resolved_config = _resolve_flow_config_variables(block.config, input_value)
            connector = self._resolve_http_request_connector(
                block_id=block.id,
                block_config=resolved_config,
                organization_id=organization_id,
                workspace_id=workspace_id,
                default_source_system=flow.source_system,
            )
            target_label = _http_target_label(connector, resolved_config)
            request = _build_flow_http_request(
                connector=connector,
                block_config=resolved_config,
                flow_id=flow.id,
                block_id=block.id,
                default_source_system=flow.source_system,
                secret_resolver=self._secret_resolver,
                body=http_body_from_config(resolved_config),
            )
            response = self._http_transport.send(request)
            preview = response.body.decode("utf-8", errors="replace")[:500]
            if response.status_code < 200 or response.status_code >= 300:
                raise ValidationError(
                    f"{target_label} responded with HTTP {response.status_code}."
                )
            try:
                snapshot_payload = json.loads(response.body.decode("utf-8"))
            except json.JSONDecodeError as exc:
                raise ValidationError(
                    f"{target_label} did not return valid JSON."
                ) from exc
            snapshot_json = _extract_json_path(
                snapshot_payload,
                _optional_str(resolved_config.get("response_root")),
                label=f"Flow block {block.id}",
            )
            if not isinstance(snapshot_json, dict):
                raise ValidationError(
                    f"Flow block {block.id!r} did not resolve a JSON object for the APS dataset."
                )
            snapshot = planning_snapshot_from_json(dict(snapshot_json))
            return (
                snapshot_envelope(
                    snapshot,
                    connector_id=connector.id if connector.id.startswith("icn-") else None,
                    connector_name=connector.name if connector.id.startswith("icn-") else None,
                    http_status=response.status_code,
                    response_preview=preview,
                    request_target=target_label,
                    request_url=request.url,
                ),
                "received",
                "Snapshot pulled from the external connector.",
            )
        if block.block_type == "map_api_response_to_snapshot":
            api_response_json = _extract_api_response_json(
                input_value,
                label=f"Flow block {block.id}",
            )
            snapshot_json = _map_api_response_to_snapshot(
                api_response_json=api_response_json,
                config=block.config,
                source_system=flow.source_system,
            )
            snapshot = planning_snapshot_from_json(snapshot_json)
            return (
                snapshot_envelope(
                    snapshot,
                    mapped_from="api_response",
                    mapped_sections=_mapped_section_counts(snapshot_json),
                ),
                "mapped",
                "API response mapped into the APS dataset contract.",
            )
        if block.block_type == "transform_snapshot":
            snapshot_json = extract_snapshot_json(
                input_value,
                label=f"Flow block {block.id}",
            )
            transformed_json = _apply_snapshot_operations(
                snapshot_json=snapshot_json,
                operations=_list_config(block.config, "operations"),
            )
            snapshot = planning_snapshot_from_json(transformed_json)
            return (
                snapshot_envelope(
                    snapshot,
                    transform_count=len(_list_config(block.config, "operations")),
                ),
                "transformed",
                "Snapshot transformations applied.",
            )
        if block.block_type == "format_payload":
            formatted = _format_flow_payload(
                input_value,
                block.config,
                label=f"Flow block {block.id}",
            )
            return (
                formatted,
                "formatted",
                f"Payload formatted as {formatted['format']}.",
            )
        if block.block_type == "enrich_with_master_data":
            snapshot = extract_snapshot(
                input_value,
                label=f"Flow block {block.id}",
            )
            workspace_snapshot = self._exporter.execute(
                ExportPlanningSnapshotInput(
                    source_system=snapshot.source_system,
                    organization_id=organization_id,
                    workspace_id=workspace_id,
                )
            )
            # Only fill collections that the upstream snapshot left empty —
            # so a source that already ships master data wins, and a source
            # that only ships transactional data (typical ERP → APS) borrows
            # machines / calendars / resources from the active workspace.
            enriched = replace(
                snapshot,
                machines=snapshot.machines or workspace_snapshot.machines,
                calendars=snapshot.calendars or workspace_snapshot.calendars,
                resources=snapshot.resources or workspace_snapshot.resources,
                inventory_items=(
                    snapshot.inventory_items or workspace_snapshot.inventory_items
                ),
                supplies=snapshot.supplies or workspace_snapshot.supplies,
            )
            added = {
                "machines": len(enriched.machines) - len(snapshot.machines),
                "calendars": len(enriched.calendars) - len(snapshot.calendars),
                "resources": len(enriched.resources) - len(snapshot.resources),
            }
            return (
                snapshot_envelope(enriched),
                "ready",
                (
                    f"Workspace master data merged "
                    f"(+{added['machines']} machines, "
                    f"+{added['calendars']} calendars, "
                    f"+{added['resources']} resources)."
                ),
            )
        if block.block_type == "validate_snapshot":
            snapshot = extract_snapshot(
                input_value,
                label=f"Flow block {block.id}",
            )
            report = validate_snapshot_report(snapshot)
            output = snapshot_envelope(
                snapshot,
                kind="validated_snapshot",
                validation=report.as_dict(),
                valid=report.valid,
                readiness_status=report.readiness_status,
                error_count=report.error_count,
                warning_count=report.warning_count,
            )
            # The Logs tab in Studio v2 surfaces this message when the
            # planner clicks a failed/blocked block. A generic "validated"
            # string is misleading when the report flagged real errors,
            # so we summarise counts and quote the first error to point
            # at the root cause instead.
            if report.valid:
                message = "Snapshot validated against the canonical contract."
            else:
                first_error = next(
                    (i.message for i in report.issues if i.severity == "error"),
                    None,
                )
                detail = f" First: {first_error}" if first_error else ""
                message = (
                    f"Validation found {report.error_count} error(s) "
                    f"and {report.warning_count} warning(s).{detail}"
                )
            return (output, report.readiness_status, message)
        if block.block_type == "require_valid_snapshot":
            validated = _require_validated_snapshot(
                input_value,
                label=f"Flow block {block.id}",
            )
            validation = _validation_payload(validated)
            if not bool(validation.get("valid")):
                raise _FlowBlocked(
                    "Snapshot validation blocked the flow.",
                    validated,
                )
            return (
                validated,
                "ready",
                "Validation gate passed.",
            )
        if block.block_type == "import_snapshot":
            snapshot = extract_snapshot(
                input_value,
                label=f"Flow block {block.id}",
            )
            report = validate_snapshot_report(snapshot)
            if not report.valid:
                raise _FlowBlocked(
                    "Snapshot import is blocked by canonical validation.",
                    snapshot_envelope(
                        snapshot,
                        kind="validated_snapshot",
                        validation=report.as_dict(),
                        valid=False,
                        readiness_status=report.readiness_status,
                        error_count=report.error_count,
                        warning_count=report.warning_count,
                    ),
                )
            imported = self._importer.execute(
                ImportPlanningSnapshotInput(
                    snapshot=snapshot,
                    organization_id=organization_id,
                    workspace_id=workspace_id,
                )
            )
            # Phase 9.5 fix: also embed the snapshot under `snapshot` so a
            # downstream block (e.g. run_scheduling_from_snapshot) can chain
            # directly off `import → run`. The block result kind stays
            # `import_result` so consumers expecting it keep working.
            snapshot_payload = clone_json(planning_snapshot_to_json(snapshot))
            return (
                {
                    "kind": "import_result",
                    "snapshot": snapshot_payload,
                    "source_system": imported.source_system,
                    "imported_at": imported.imported_at.isoformat(),
                    "created": imported.created,
                    "updated": imported.updated,
                    "binding_count": imported.binding_count,
                    "validation": report.as_dict(),
                },
                "imported",
                "Snapshot imported into the workspace.",
            )
        if block.block_type == "run_scheduling_from_snapshot":
            snapshot = extract_snapshot(
                input_value,
                label=f"Flow block {block.id}",
            )
            result = self._scheduler.execute(
                RunSchedulingFromSnapshotInput(
                    snapshot=snapshot,
                    horizon_start=optional_datetime(block.config.get("horizon_start")),
                    horizon_days=int(block.config.get("horizon_days", 30)),
                    heuristic=str(block.config.get("heuristic") or "edd"),
                    strategy=str(block.config.get("strategy") or "greedy"),
                )
            )
            return (
                {
                    "kind": "schedule_result",
                    "schedule_id": result.schedule.id,
                    "strategy": result.strategy,
                    "solver_status": result.solver_status,
                    "objective_value": result.objective_value,
                    "wall_time_ms": result.wall_time_ms,
                    "summary": result.summary.as_dict(),
                    "feasibility": (
                        {
                            "is_feasible": result.feasibility.is_feasible,
                            "error_count": result.feasibility.error_count,
                            "warning_count": result.feasibility.warning_count,
                            "readiness_status": result.feasibility.readiness_status,
                        }
                        if result.feasibility is not None
                        else {}
                    ),
                },
                "scheduled",
                "Scheduling run completed from the canonical snapshot.",
            )
        if block.block_type == "push_snapshot_to_connector":
            snapshot_json = extract_snapshot_json(
                input_value,
                label=f"Flow block {block.id}",
            )
            resolved_config = _resolve_flow_config_variables(block.config, input_value)
            connector = self._resolve_http_request_connector(
                block_id=block.id,
                block_config=resolved_config,
                organization_id=organization_id,
                workspace_id=workspace_id,
                default_source_system=flow.source_system,
            )
            target_label = _http_target_label(connector, resolved_config)
            method = _resolved_http_method(connector, resolved_config)
            if method == "GET":
                raise ValidationError(
                    f"{target_label} must use POST/PUT/PATCH to receive a snapshot."
                )
            request = _build_flow_http_request(
                connector=connector,
                block_config=resolved_config,
                flow_id=flow.id,
                block_id=block.id,
                default_source_system=flow.source_system,
                secret_resolver=self._secret_resolver,
                body=json.dumps(snapshot_json).encode("utf-8"),
            )
            response = self._http_transport.send(request)
            preview = response.body.decode("utf-8", errors="replace")[:500]
            if response.status_code < 200 or response.status_code >= 300:
                raise ValidationError(
                    f"{target_label} responded with HTTP {response.status_code}."
                )
            return (
                {
                    "kind": "connector_delivery",
                    "connector_id": connector.id if connector.id.startswith("icn-") else None,
                    "connector_name": connector.name if connector.id.startswith("icn-") else None,
                    "request_target": target_label,
                    "request_url": request.url,
                    "http_status": response.status_code,
                    "response_preview": preview,
                    "snapshot_hash": planning_snapshot_hash(snapshot_json),
                },
                "delivered",
                "Snapshot delivered to the external connector.",
            )
        if block.block_type == "push_published_plan_to_connector":
            plan_json = _extract_plan_json(
                input_value,
                label=f"Flow block {block.id}",
            )
            resolved_config = _resolve_flow_config_variables(block.config, input_value)
            connector = self._resolve_http_request_connector(
                block_id=block.id,
                block_config=resolved_config,
                organization_id=organization_id,
                workspace_id=workspace_id,
                default_source_system=flow.source_system,
            )
            target_label = _http_target_label(connector, resolved_config)
            method = _resolved_http_method(connector, resolved_config)
            if method == "GET":
                raise ValidationError(
                    f"{target_label} must use POST/PUT/PATCH to receive a published plan."
                )
            request = _build_flow_http_request(
                connector=connector,
                block_config=resolved_config,
                flow_id=flow.id,
                block_id=block.id,
                default_source_system=flow.source_system,
                secret_resolver=self._secret_resolver,
                body=json.dumps(plan_json).encode("utf-8"),
                payload_kind="published_plan",
            )
            response = self._http_transport.send(request)
            preview = response.body.decode("utf-8", errors="replace")[:500]
            if response.status_code < 200 or response.status_code >= 300:
                raise ValidationError(
                    f"{target_label} responded with HTTP {response.status_code}."
                )
            return (
                {
                    "kind": "connector_delivery",
                    "connector_id": connector.id if connector.id.startswith("icn-") else None,
                    "connector_name": connector.name if connector.id.startswith("icn-") else None,
                    "request_target": target_label,
                    "request_url": request.url,
                    "http_status": response.status_code,
                    "response_preview": preview,
                    "plan_hash": _json_hash(plan_json),
                },
                "delivered",
                "Published plan delivered to the external connector.",
            )
        if block.block_type == "send_sftp_file":
            formatted_payload = _require_formatted_payload(
                input_value,
                label=f"Flow block {block.id}",
            )
            resolved_config = _resolve_flow_config_variables(block.config, input_value)
            connector = self._require_connector(
                connector_id=str(resolved_config.get("connector_id") or "").strip(),
                organization_id=organization_id,
                workspace_id=workspace_id,
            )
            connector = validate_integration_connector(connector)
            if connector.connector_type != "sftp":
                raise ValidationError(
                    f"Flow block {block.id!r} requires a connector with connector_type 'sftp'."
            )
            file_name = _optional_str(resolved_config.get("file_name")) or str(
                formatted_payload.get("file_name") or "payload.dat"
            )
            directory = _optional_str(resolved_config.get("directory")) or "/"
            preview_only = bool(_optional_bool(resolved_config.get("preview_only")))
            resolved_path = _sftp_target_path(directory, file_name)
            delivery_summary = {
                "kind": "destination_delivery",
                "destination_type": "sftp",
                "connector_id": connector.id,
                "connector_name": connector.name,
                "directory": directory,
                "file_name": file_name,
                "path": resolved_path,
                "byte_length": len(formatted_payload["text"].encode("utf-8")),
                "format": formatted_payload.get("format"),
                "mime_type": formatted_payload.get("mime_type"),
                "content_hash": formatted_payload.get("content_hash"),
                "text_preview": formatted_payload["text"][:240],
                "preview_only": preview_only,
            }
            if preview_only:
                return (
                    {
                        **delivery_summary,
                        "status": "preview_only",
                    },
                    "ready",
                    (
                        f"SFTP preview ready for {resolved_path} "
                        "(no file sent yet)."
                    ),
                )
            if self._sftp_transport is None:
                raise ValidationError(
                    "SFTP delivery requires a SFTP integration runtime adapter. "
                    f"Connector {connector.id!r} is configured for {resolved_path}."
                )
            put_request = build_connector_sftp_put_request(
                connector,
                secret_resolver=self._secret_resolver,
                directory=directory,
                file_name=file_name,
                body=formatted_payload["text"].encode("utf-8"),
            )
            delivered = self._sftp_transport.put_file(put_request)
            return (
                {
                    **delivery_summary,
                    "path": delivered.path,
                    "byte_length": delivered.bytes_written,
                    "preview_only": False,
                    "status": "delivered",
                },
                "delivered",
                f"Formatted payload delivered to SFTP at {delivered.path}.",
            )
        if block.block_type == "write_database_rows":
            resolved_config = _resolve_flow_config_variables(block.config, input_value)
            connector = self._require_connector(
                connector_id=str(resolved_config.get("connector_id") or "").strip(),
                organization_id=organization_id,
                workspace_id=workspace_id,
            )
            connector = validate_integration_connector(connector)
            if connector.connector_type != "database":
                raise ValidationError(
                    f"Flow block {block.id!r} requires a connector with connector_type 'database'."
                )
            table_name = _optional_str(resolved_config.get("table")) or ""
            if not table_name:
                raise ValidationError(
                    f"Flow block {block.id!r} requires config.table for database delivery."
                )
            operation = (
                _optional_str(resolved_config.get("operation")) or "insert"
            ).strip().lower()
            match_columns = _string_tuple_config(resolved_config, "match_columns")
            source_rows = _database_rows_from_input(
                input_value,
                rows_path=_optional_str(resolved_config.get("rows_path")),
                label=f"Flow block {block.id}",
            )
            column_map = _field_map_config(resolved_config, "column_map")
            rows = (
                [_map_record(row, column_map) for row in source_rows]
                if column_map
                else [dict(row) for row in source_rows]
            )
            preview_only = bool(_optional_bool(resolved_config.get("preview_only")))
            mapped_fields = _row_field_names(rows, limit=None)
            database_schema_feedback = self._database_schema_feedback(
                connector=connector,
                table_name=table_name,
                operation=operation,
                mapped_fields=mapped_fields,
                match_columns=match_columns,
            )
            delivery_summary = {
                "kind": "destination_delivery",
                "destination_type": "database",
                "connector_id": connector.id,
                "connector_name": connector.name,
                "table": table_name,
                "operation": operation,
                "rows_path": _optional_str(resolved_config.get("rows_path")),
                "source_row_count": len(source_rows),
                "source_fields": _row_field_names(source_rows),
                "source_rows_preview": _row_preview(source_rows),
                "mapped_row_count": len(rows),
                "mapped_fields": mapped_fields[:32],
                "mapped_rows_preview": _row_preview(rows),
                "match_columns": list(match_columns),
                "mapped_columns": list(column_map.keys()),
                "preview_only": preview_only,
                **database_schema_feedback,
            }
            if preview_only:
                return (
                    {
                        **delivery_summary,
                        "rows_received": len(rows),
                        "rows_written": 0,
                        "rows_inserted": 0,
                        "rows_updated": 0,
                        "status": "preview_only",
                    },
                    "ready",
                    (
                        f"Database preview ready for {table_name} "
                        f"({len(rows)} row(s) prepared, no write executed)."
                    ),
                )
            if self._database_transport is None:
                raise ValidationError(
                    "Database delivery requires a database integration runtime adapter. "
                    f"Connector {connector.id!r} is configured for table {table_name!r}."
                )
            write_request = build_connector_database_write_request(
                connector,
                secret_resolver=self._secret_resolver,
                table_name=table_name,
                operation=operation,
                rows=rows,
                match_columns=match_columns,
            )
            delivered = self._database_transport.write_rows(write_request)
            return (
                {
                    **delivery_summary,
                    "table": delivered.table_name,
                    "operation": delivered.operation,
                    "rows_received": delivered.rows_received,
                    "rows_written": delivered.rows_written,
                    "rows_inserted": delivered.rows_inserted,
                    "rows_updated": delivered.rows_updated,
                    "dialect": delivered.dialect,
                    "database": delivered.database,
                    "status": "delivered",
                },
                "delivered",
                (
                    f"Database delivery completed for {delivered.table_name} "
                    f"({delivered.rows_written} row(s) written)."
                ),
            )
        raise ValidationError(f"Unsupported integration flow block {block.block_type!r}.")

    def _require_connector(
        self,
        *,
        connector_id: str,
        organization_id: str | None,
        workspace_id: str | None,
    ):
        if not connector_id:
            raise ValidationError("Connector-backed flow block requires connector_id.")
        connector = self._connectors.get(
            connector_id,
            organization_id=organization_id,
        )
        if connector is None:
            raise ValidationError(f"Integration connector {connector_id!r} not found")
        if not connector.is_enabled:
            raise ValidationError(f"Integration connector {connector.id!r} is disabled.")
        if (
            workspace_id is not None
            and connector.workspace_id is not None
            and connector.workspace_id != workspace_id
        ):
            raise ValidationError(
                f"Integration connector {connector.id!r} does not match the active workspace."
            )
        return connector

    def _database_schema_feedback(
        self,
        *,
        connector: IntegrationConnector,
        table_name: str,
        operation: str,
        mapped_fields: list[str],
        match_columns: tuple[str, ...],
    ) -> dict[str, object]:
        if self._database_transport is None:
            return {
                "table_schema_checked": False,
                "table_schema_found": False,
                "table_schema_name": table_name,
                "table_schema_columns": [],
                "table_required_columns": [],
                "table_primary_key_columns": [],
                "required_columns_missing": [],
                "extra_mapped_fields": [],
                "suggested_match_columns": [],
                "missing_match_columns": [],
                "invalid_match_columns": [],
                "schema_readiness": "schema_unavailable",
                "schema_readiness_message": (
                    "Live schema checks are unavailable until a database runtime adapter is configured."
                ),
            }
        try:
            inspected = self._database_transport.inspect_schema(
                build_connector_database_schema_request(
                    connector,
                    secret_resolver=self._secret_resolver,
                )
            )
        except Exception as exc:
            return {
                "table_schema_checked": False,
                "table_schema_found": False,
                "table_schema_name": table_name,
                "table_schema_columns": [],
                "table_required_columns": [],
                "table_primary_key_columns": [],
                "required_columns_missing": [],
                "extra_mapped_fields": [],
                "suggested_match_columns": [],
                "missing_match_columns": [],
                "invalid_match_columns": [],
                "table_schema_lookup_error": str(exc),
                "schema_readiness": "schema_unavailable",
                "schema_readiness_message": (
                    "Live schema lookup failed, so the row preview could not compare against the destination table."
                ),
            }

        table_schema = _find_database_table_schema(inspected.tables, table_name)
        if table_schema is None:
            return {
                "table_schema_checked": True,
                "table_schema_found": False,
                "table_schema_name": table_name,
                "table_schema_columns": [],
                "table_required_columns": [],
                "table_primary_key_columns": [],
                "required_columns_missing": [],
                "extra_mapped_fields": [],
                "suggested_match_columns": [],
                "missing_match_columns": [],
                "invalid_match_columns": [],
                "schema_dialect": inspected.dialect,
                "schema_database": inspected.database,
                "schema_readiness": "table_missing",
                "schema_readiness_message": (
                    f"The selected connector did not expose table {table_name!r} during schema discovery."
                ),
            }

        table_columns = [column.name for column in table_schema.columns if column.name]
        required_columns = [
            column.name
            for column in table_schema.columns
            if column.name and (column.is_primary_key or not column.nullable)
        ]
        primary_key_columns = [
            column.name
            for column in table_schema.columns
            if column.name and column.is_primary_key
        ]
        mapped_field_set = set(mapped_fields)
        table_column_set = set(table_columns)
        required_columns_missing = [
            column for column in required_columns if column not in mapped_field_set
        ]
        extra_mapped_fields = [
            field for field in mapped_fields if field not in table_column_set
        ]
        missing_match_columns = [
            column for column in match_columns if column not in mapped_field_set
        ]
        invalid_match_columns = [
            column for column in match_columns if column not in table_column_set
        ]
        suggested_match_columns = list(primary_key_columns)
        needs_match_columns = operation in {"update", "upsert"}
        missing_suggested_match_columns = (
            needs_match_columns and not match_columns and bool(suggested_match_columns)
        )

        readiness = "ready"
        readiness_message = (
            f"Mapped rows line up with {table_schema.full_name or table_schema.name}."
        )
        if required_columns_missing or missing_match_columns or invalid_match_columns:
            readiness = "mapping_incomplete"
            details: list[str] = []
            if required_columns_missing:
                details.append(
                    "missing required columns " + ", ".join(required_columns_missing)
                )
            if missing_match_columns:
                details.append(
                    "missing mapped match columns " + ", ".join(missing_match_columns)
                )
            if invalid_match_columns:
                details.append(
                    "unknown match columns " + ", ".join(invalid_match_columns)
                )
            readiness_message = (
                f"Schema check found {', '.join(details)} for "
                f"{table_schema.full_name or table_schema.name}."
            )
        elif extra_mapped_fields:
            readiness = "mapping_review"
            readiness_message = (
                f"Mapped rows include fields outside {table_schema.full_name or table_schema.name}: "
                f"{', '.join(extra_mapped_fields)}."
            )
        elif missing_suggested_match_columns:
            readiness = "match_columns_suggested"
            readiness_message = (
                "This table exposes primary key columns that are good candidates for upsert matching."
            )

        return {
            "table_schema_checked": True,
            "table_schema_found": True,
            "table_schema_name": table_schema.full_name or table_schema.name or table_name,
            "table_schema_columns": table_columns,
            "table_required_columns": required_columns,
            "table_primary_key_columns": primary_key_columns,
            "required_columns_missing": required_columns_missing,
            "extra_mapped_fields": extra_mapped_fields,
            "suggested_match_columns": suggested_match_columns,
            "missing_match_columns": missing_match_columns,
            "invalid_match_columns": invalid_match_columns,
            "schema_dialect": inspected.dialect,
            "schema_database": inspected.database,
            "schema_readiness": readiness,
            "schema_readiness_message": readiness_message,
        }

    def _resolve_http_profile_connector(
        self,
        *,
        block_id: str,
        block_config: dict[str, object],
        organization_id: str | None,
        workspace_id: str | None,
    ) -> IntegrationConnector | None:
        if _http_request_mode(block_config) != "profile":
            return None
        connector = self._require_connector(
            connector_id=str(block_config.get("connector_id") or "").strip(),
            organization_id=organization_id,
            workspace_id=workspace_id,
        )
        connector = validate_integration_connector(connector)
        if connector.connector_type != "http":
            raise ValidationError(
                f"Flow block {block_id!r} requires a connector with connector_type 'http'."
            )
        return connector

    def _resolve_http_request_connector(
        self,
        *,
        block_id: str,
        block_config: dict[str, object],
        organization_id: str | None,
        workspace_id: str | None,
        default_source_system: str,
    ) -> IntegrationConnector:
        connector = self._resolve_http_profile_connector(
            block_id=block_id,
            block_config=block_config,
            organization_id=organization_id,
            workspace_id=workspace_id,
        )
        if connector is None:
            connector = _validated_direct_http_connector(
                block_config=block_config,
                block_id=block_id,
                default_source_system=default_source_system,
            )
        credential = self._resolve_http_credential(
            block_config=block_config,
            connector=connector,
            organization_id=organization_id,
        )
        if credential is not None:
            connector = apply_integration_credential(
                connector=connector,
                credential=credential,
            )
        return connector

    def _resolve_http_credential(
        self,
        *,
        block_config: dict[str, object],
        connector: IntegrationConnector,
        organization_id: str | None,
    ):
        credential_id = (
            _optional_str(block_config.get("credential_id"))
            or _optional_str(connector.credential_id)
        )
        if credential_id is None:
            return None
        if self._credentials is None:
            raise ValidationError(
                "Saved integration credentials are not available in this runtime."
            )
        credential = self._credentials.get(
            credential_id,
            organization_id=organization_id,
        )
        if credential is None:
            raise ValidationError(
                f"Integration credential {credential_id!r} not found."
            )
        return credential

    def _save_journal_entry(
        self,
        *,
        flow: IntegrationFlow,
        execution: _FlowExecution,
        action: str,
        actor_details: dict[str, object],
        organization_id: str | None,
        workspace_id: str | None,
    ) -> IntegrationJournalEntry:
        validation = execution.result.get("validation")
        entity_counts = execution.result.get("entity_counts")
        entry = IntegrationJournalEntry(
            id=f"ij-{uuid4().hex[:12]}",
            action=action,
            source_system=flow.source_system,
            status=execution.status,
            valid=execution.status == "completed",
            organization_id=organization_id,
            workspace_id=workspace_id,
            error_count=(
                int(validation.get("error_count", 0))
                if isinstance(validation, dict)
                else (1 if execution.status == "failed" else 0)
            ),
            warning_count=(
                int(validation.get("warning_count", 0))
                if isinstance(validation, dict)
                else 0
            ),
            entity_counts=dict(entity_counts) if isinstance(entity_counts, dict) else {},
            details={
                "flow_id": flow.id,
                "flow_name": flow.name,
                "block_count": len(flow.blocks),
                "message": execution.message,
                "blocks": [
                    {
                        "block_id": item.block_id,
                        "block_type": item.block_type,
                        "status": item.status,
                    }
                    for item in execution.block_results
                ],
                **execution.journal_details,
                **dict(actor_details),
            },
        )
        self._journal.save(entry)
        return entry

    def _save_execution_record(
        self,
        *,
        flow: IntegrationFlow,
        execution: _FlowExecution,
        actor_details: dict[str, object],
        journal_entry: IntegrationJournalEntry | None,
        organization_id: str | None,
        workspace_id: str | None,
        started_at: datetime,
        finished_at: datetime,
    ) -> None:
        entity_counts = execution.result.get("entity_counts")
        block_status_counts: dict[str, int] = {}
        for item in execution.block_results:
            block_status_counts[item.status] = block_status_counts.get(item.status, 0) + 1
        save_integration_execution(
            self._executions,
            execution_kind="flow_run",
            target_type="flow",
            target_id=flow.id,
            target_name=flow.name,
            source_system=flow.source_system,
            status=execution.status,
            valid=execution.status == "completed",
            organization_id=organization_id,
            workspace_id=workspace_id,
            trigger_type=str(actor_details.get("triggered_by") or "manual"),
            attempt_number=1,
            message=execution.message,
            error_code=_flow_error_code(execution),
            entity_counts=dict(entity_counts) if isinstance(entity_counts, dict) else {},
            details={
                "block_count": len(flow.blocks),
                "block_status_counts": block_status_counts,
                "automation_job_id": actor_details.get("automation_job_id"),
                "final_output": _summarize_flow_output(execution.result),
                "blocks": [
                    {
                        "block_id": item.block_id,
                        "block_type": item.block_type,
                        "status": item.status,
                        "message": item.message,
                        "output_summary": dict(item.output_summary),
                    }
                    for item in execution.block_results
                ],
                **execution.journal_details,
            },
            journal_entry_id=journal_entry.id if journal_entry is not None else None,
            started_at=started_at,
            finished_at=finished_at,
            actor_details=actor_details,
        )


# ---------------------------------------------------------------------------
# Studio v2 phase 6 — POST /integration/flows/{id}/validate-graph
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ValidateIntegrationFlowGraphInput:
    flow_id: str
    organization_id: str | None = None
    workspace_id: str | None = None


@dataclass(frozen=True, slots=True)
class IntegrationFlowGraphIssue:
    code: str  # cycle | unknown_source | dangling_branch
    severity: str  # error | warning
    message: str
    block_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ValidateIntegrationFlowGraphOutput:
    flow_id: str
    valid: bool
    issues: list[IntegrationFlowGraphIssue]


class ValidateIntegrationFlowGraph:
    """Static analysis for a flow's DAG.

    Runs cycle detection + dangling-branch + unknown-source checks without
    executing any block. Used by the Studio v2 toolbar's Validate button.
    Tenant scope mirrors RunIntegrationFlow.test_block — the same 404 is
    returned for a missing flow as for one that exists in another tenant.
    """

    def __init__(self, flows: IntegrationFlowRepository) -> None:
        self._flows = flows

    def execute(
        self, command: ValidateIntegrationFlowGraphInput
    ) -> ValidateIntegrationFlowGraphOutput:
        flow = self._flows.get(
            command.flow_id, organization_id=command.organization_id
        )
        if flow is None:
            raise ValidationError(
                f"Integration flow {command.flow_id!r} not found."
            )
        if (
            command.workspace_id is not None
            and flow.workspace_id is not None
            and flow.workspace_id != command.workspace_id
        ):
            raise ValidationError(
                f"Integration flow {command.flow_id!r} not found."
            )
        issues: list[IntegrationFlowGraphIssue] = []
        block_ids = {b.id for b in flow.blocks}
        dag = _build_flow_dag(flow)

        for block_id, edges in dag.items():
            for edge in edges:
                if edge.source_block_id not in block_ids:
                    issues.append(
                        IntegrationFlowGraphIssue(
                            code="unknown_source",
                            severity="error",
                            message=(
                                f"Block {block_id!r} references missing source "
                                f"{edge.source_block_id!r}."
                            ),
                            block_ids=(block_id, edge.source_block_id),
                        )
                    )

        cycle_offenders = _detect_cycles(dag)
        if cycle_offenders:
            issues.append(
                IntegrationFlowGraphIssue(
                    code="cycle",
                    severity="error",
                    message=(
                        "Flow contains a cycle through blocks: "
                        + ", ".join(repr(b) for b in cycle_offenders)
                    ),
                    block_ids=tuple(cycle_offenders),
                )
            )

        downstream_edge_types: dict[str, set[str]] = {bid: set() for bid in block_ids}
        for _target_id, edges in dag.items():
            for edge in edges:
                downstream_edge_types.setdefault(edge.source_block_id, set()).add(
                    edge.edge_type
                )
        for block in flow.blocks:
            if block.block_type == "logic_branch_if":
                expected = {"branch_true", "branch_false"}
                actual = downstream_edge_types.get(block.id, set())
                missing = expected - actual
                if missing:
                    issues.append(
                        IntegrationFlowGraphIssue(
                            code="dangling_branch",
                            severity="warning",
                            message=(
                                f"Branch block {block.id!r} has no downstream block "
                                f"for edges: {sorted(missing)}."
                            ),
                            block_ids=(block.id,),
                        )
                    )

        valid = not any(issue.severity == "error" for issue in issues)
        return ValidateIntegrationFlowGraphOutput(
            flow_id=flow.id, valid=valid, issues=issues
        )


def _validated_flow(
    flow: IntegrationFlow, *, strict: bool = True
) -> IntegrationFlow:
    """Run flow integrity checks.

    When ``strict`` is True (the default, used at run time), every block's
    runtime config is required — e.g. a Send To Connector block must
    already point at a saved connector. When ``strict`` is False (used by
    Save), only the structural shape is enforced so a planner can
    persist a draft template before wiring up connectors. The graph
    /validate-graph + /readiness endpoints remain the authoritative
    "is the flow runnable" answer.
    """

    flow.name = flow.name.strip()
    flow.source_system = flow.source_system.strip()
    if not flow.name:
        raise ValidationError("Integration flow name is required.")
    if not flow.source_system:
        raise ValidationError("Integration flow source_system is required.")
    if not flow.blocks:
        raise ValidationError("Integration flow requires at least one block.")

    seen_ids: set[str] = set()
    all_block_ids = {b.id.strip() for b in flow.blocks}
    for index, raw_block in enumerate(flow.blocks):
        block = IntegrationFlowBlock(
            id=raw_block.id.strip(),
            block_type=raw_block.block_type.strip().lower(),
            name=raw_block.name.strip() if raw_block.name else None,
            input_block_id=raw_block.input_block_id.strip() if raw_block.input_block_id else None,
            inputs=[
                FlowBlockInput(
                    source_block_id=edge.source_block_id.strip(),
                    edge_type=edge.edge_type,
                    case_value=edge.case_value,
                )
                for edge in raw_block.inputs
            ],
            config=dict(raw_block.config),
        )
        if not block.id:
            raise ValidationError("Integration flow block id is required.")
        if block.id in seen_ids:
            raise ValidationError(f"Duplicate integration flow block id {block.id!r}.")
        if block.block_type not in SUPPORTED_FLOW_BLOCK_TYPES:
            raise ValidationError(
                f"Unsupported integration flow block type {block.block_type!r}."
            )
        if block.input_block_id is not None and block.input_block_id == block.id:
            raise ValidationError(
                f"Integration flow block {block.id!r} cannot use itself as input block."
            )
        if block.input_block_id is not None and block.input_block_id not in all_block_ids:
            raise ValidationError(
                f"Integration flow block {block.id!r} references unknown input block "
                f"{block.input_block_id!r}."
            )
        for edge in block.inputs:
            if edge.source_block_id not in all_block_ids:
                raise ValidationError(
                    f"Integration flow block {block.id!r} references unknown source block "
                    f"{edge.source_block_id!r}."
                )
        if (
            block.block_type in FLOW_BLOCK_TYPES_REQUIRING_INPUT
            and block.input_block_id is None
            and not block.inputs
            and index == 0
        ):
            raise ValidationError(
                f"Integration flow block {block.id!r} requires an input block."
            )
        _validate_block_config(block, strict=strict)
        flow.blocks[index] = block
        seen_ids.add(block.id)
    return flow


def _validate_block_config(
    block: IntegrationFlowBlock, *, strict: bool = True
) -> None:
    """Validate a block's config.

    Structural checks (invalid value types, unsupported operations, bad
    formats, paths with separators) always run. "Field X is required to
    actually run this block" checks only run when ``strict`` is True;
    Save bypasses them so a planner can persist a draft template before
    wiring up a connector.
    """

    if block.block_type in {
        "call_connector_api",
        "send_connector_request",
        "pull_snapshot_from_connector",
        "push_snapshot_to_connector",
        "push_published_plan_to_connector",
    }:
        if strict:
            _validate_http_block_target(block.id, block.config)
            _validate_connector_block_transport(block.id, block.config)
    # V1.2 P1.1b NOTE — we intentionally do NOT add Odoo's missing-
    # connector_id check here. The engine's per-block dispatch
    # (lines ~2728 / 2803 / 2879) catches it gracefully and surfaces
    # a per-block failed status instead of aborting the whole flow.
    # That graceful path matters for runs of mixed-config flows where
    # the planner wants per-block diagnostics. The readiness layer
    # (`_odoo_readiness_issues`) flags the missing id at design time
    # so the route's pre-flight gate refuses the run before any
    # block executes — see P1.1.
    if block.block_type == "send_sftp_file":
        if strict:
            connector_id = str(block.config.get("connector_id") or "").strip()
            if not connector_id:
                raise ValidationError(
                    f"Integration flow block {block.id!r} requires config.connector_id."
                )
        file_name = _optional_str(block.config.get("file_name"))
        if file_name is not None and "/" in file_name.replace("\\", "/"):
            raise ValidationError(
                f"Integration flow block {block.id!r} requires file_name without path separators."
            )
        preview_only = block.config.get("preview_only")
        if preview_only is not None:
            _optional_bool(preview_only)
    if block.block_type == "write_database_rows":
        if strict:
            connector_id = str(block.config.get("connector_id") or "").strip()
            if not connector_id:
                raise ValidationError(
                    f"Integration flow block {block.id!r} requires config.connector_id."
                )
            table_name = _optional_str(block.config.get("table")) or ""
            if not table_name:
                raise ValidationError(
                    f"Integration flow block {block.id!r} requires config.table."
                )
        operation = (_optional_str(block.config.get("operation")) or "insert").strip().lower()
        if operation not in {"insert", "update", "upsert"}:
            raise ValidationError(
                f"Integration flow block {block.id!r} uses unsupported database operation {operation!r}."
            )
        rows_path = block.config.get("rows_path")
        if rows_path is not None and not isinstance(rows_path, str):
            raise ValidationError(
                f"Integration flow block {block.id!r} requires rows_path to be a string path."
            )
        match_columns = block.config.get("match_columns")
        if match_columns is not None and not (
            isinstance(match_columns, str) or isinstance(match_columns, list)
        ):
            raise ValidationError(
                f"Integration flow block {block.id!r} requires match_columns as a string or list."
            )
        if operation in {"update", "upsert"} and not _string_tuple_config(
            block.config, "match_columns"
        ):
            raise ValidationError(
                f"Integration flow block {block.id!r} requires match_columns for database {operation} operations."
            )
        column_map = block.config.get("column_map")
        if column_map is not None and not isinstance(column_map, dict):
            raise ValidationError(
                f"Integration flow block {block.id!r} requires column_map to be a JSON object."
            )
        preview_only = block.config.get("preview_only")
        if preview_only is not None:
            _optional_bool(preview_only)
    if block.block_type == "send_connector_request":
        method = str(block.config.get("request_method") or "").strip().upper()
        if method == "GET":
            raise ValidationError(
                f"Integration flow block {block.id!r} must use POST, PUT, or PATCH to send a payload."
            )
        if strict and http_body_from_config(block.config) is None:
            raise ValidationError(
                f"Integration flow block {block.id!r} requires config.request_body."
            )
    if block.block_type in {
        "push_snapshot_to_connector",
        "push_published_plan_to_connector",
    }:
        method = str(block.config.get("request_method") or "").strip().upper()
        if method == "GET":
            raise ValidationError(
                f"Integration flow block {block.id!r} must use POST, PUT, or PATCH to send outbound data."
            )
    if block.block_type == "map_api_response_to_snapshot":
        _validate_api_mapping_config(block.id, block.config)
    if block.block_type == "transform_snapshot":
        operations = _list_config(block.config, "operations")
        if not operations:
            raise ValidationError(
                f"Integration flow block {block.id!r} requires config.operations."
            )
        for operation in operations:
            _validate_transform_operation(block.id, operation)
    if block.block_type == "format_payload":
        format_name = str(block.config.get("format") or "json").strip().lower()
        if format_name not in SUPPORTED_PAYLOAD_FORMATS:
            allowed = ", ".join(sorted(SUPPORTED_PAYLOAD_FORMATS))
            raise ValidationError(
                f"Integration flow block {block.id!r} requires format one of: {allowed}."
            )
    if block.block_type == "run_scheduling_from_snapshot":
        horizon_days = int(block.config.get("horizon_days", 30))
        if horizon_days <= 0 or horizon_days > 365:
            raise ValidationError(
                f"Integration flow block {block.id!r} requires horizon_days between 1 and 365."
            )
    if block.block_type == "export_published_plan":
        mode = str(block.config.get("mode") or "full").strip().lower()
        if mode not in {"full", "delta"}:
            raise ValidationError(
                f"Integration flow block {block.id!r} requires mode full or delta."
            )


def _validate_connector_block_transport(
    block_id: str,
    config: dict[str, object],
) -> None:
    method = _optional_str(config.get("request_method"))
    if method is not None and method.upper() not in VALID_BLOCK_HTTP_METHODS:
        allowed = ", ".join(sorted(VALID_BLOCK_HTTP_METHODS))
        raise ValidationError(
            f"Integration flow block {block_id!r} uses unsupported request_method {method!r}. "
            f"Allowed methods: {allowed}."
        )
    route_path = _optional_str(config.get("route_path"))
    if route_path is not None and not route_path.startswith("/"):
        raise ValidationError(
            f"Integration flow block {block_id!r} requires route_path to start with '/'."
        )
    # E2E walkthrough finding: an empty textbox in the Studio sends
    # `query_params: ""` / `request_headers: ""`. Treat empty string
    # and None as "no params / headers" so a planner who clears the
    # field doesn't have to type `{}` to satisfy the validator.
    raw_query = config.get("query_params")
    if "query_params" in config and raw_query not in (None, "") and not isinstance(raw_query, dict):
        raise ValidationError(
            f"Integration flow block {block_id!r} requires query_params to be a JSON object."
        )
    raw_headers = config.get("request_headers")
    if (
        "request_headers" in config
        and raw_headers not in (None, "")
        and not isinstance(raw_headers, dict)
    ):
        raise ValidationError(
            f"Integration flow block {block_id!r} requires request_headers to be a JSON object."
        )


def _validate_http_block_target(
    block_id: str,
    config: dict[str, object],
) -> None:
    request_mode = _http_request_mode(config)
    connector_id = str(config.get("connector_id") or "").strip()
    direct_url = _optional_str(config.get("url"))
    if request_mode == "profile":
        if not connector_id and not direct_url:
            raise ValidationError(
                f"Integration flow block {block_id!r} requires config.connector_id or config.url."
            )
        if connector_id:
            return
        raise ValidationError(
            f"Integration flow block {block_id!r} requires config.connector_id."
        )
    _validated_direct_http_connector(
        block_config=config,
        block_id=block_id,
        default_source_system="flow",
    )


def _build_flow_execution_plan(
    flow: IntegrationFlow,
    *,
    start_block_id: str | None,
    stop_after_block_id: str | None,
) -> dict[str, object]:
    dependencies = _flow_block_dependencies(flow)
    block_ids = [block.id for block in flow.blocks]
    block_id_set = set(block_ids)
    if start_block_id is not None and start_block_id not in block_id_set:
        raise ValidationError(
            f"Integration flow block {start_block_id!r} was not found in this flow."
        )
    if stop_after_block_id is not None and stop_after_block_id not in block_id_set:
        raise ValidationError(
            f"Integration flow block {stop_after_block_id!r} was not found in this flow."
        )
    if start_block_id is None and stop_after_block_id is None:
        return {
            "execute_block_ids": block_id_set,
            "input_block_ids": dependencies,
        }

    reverse_dependencies: dict[str, set[str]] = {block_id: set() for block_id in block_ids}
    for block_id, dependency_id in dependencies.items():
        if dependency_id is not None:
            reverse_dependencies.setdefault(dependency_id, set()).add(block_id)

    if start_block_id is not None and stop_after_block_id is not None:
        descendants = _collect_block_descendants(
            start_block_id,
            reverse_dependencies=reverse_dependencies,
        )
        if stop_after_block_id not in descendants:
            raise ValidationError(
                f"Integration flow block {stop_after_block_id!r} is not downstream of "
                f"{start_block_id!r}."
            )
        target_block_ids = {stop_after_block_id}
    elif stop_after_block_id is not None:
        target_block_ids = {stop_after_block_id}
    else:
        target_block_ids = _collect_block_descendants(
            start_block_id or "",
            reverse_dependencies=reverse_dependencies,
        )

    execute_block_ids = set(target_block_ids)
    for block_id in list(target_block_ids):
        execute_block_ids.update(
            _collect_block_ancestors(block_id, dependencies=dependencies)
        )
    return {
        "execute_block_ids": execute_block_ids,
        "input_block_ids": dependencies,
    }


def _retry_policy_for_block(block: IntegrationFlowBlock) -> tuple[int, float]:
    """Read (max_attempts, backoff_seconds) from a block's config.

    Defaults: max_attempts=1 (= no retry), backoff_seconds=0.0.
    """
    raw_attempts = block.config.get("retry_max_attempts")
    raw_backoff = block.config.get("retry_backoff_seconds")
    try:
        max_attempts = max(1, int(raw_attempts)) if raw_attempts is not None else 1
    except (TypeError, ValueError):
        max_attempts = 1
    try:
        backoff_seconds = (
            float(raw_backoff) if raw_backoff is not None else 0.0
        )
    except (TypeError, ValueError):
        backoff_seconds = 0.0
    return max_attempts, max(0.0, backoff_seconds)


def _run_block_with_retry(
    runner,
    *,
    flow: IntegrationFlow,
    block: IntegrationFlowBlock,
    input_value: dict[str, object] | None,
    organization_id: str | None,
    workspace_id: str | None,
    trigger_payload: dict[str, object] | None = None,
) -> tuple[dict[str, object], str, str]:
    """Execute a block with linear-backoff retry on `Exception`.

    `_FlowBlocked` is **not** retried (a blocked status is by design, not
    a flake). The retry policy comes from the block's config; defaults to
    a single attempt so existing flows are unaffected.
    """
    max_attempts, backoff_seconds = _retry_policy_for_block(block)
    last_exception: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return runner._execute_block(
                flow=flow,
                block=block,
                input_value=input_value,
                organization_id=organization_id,
                workspace_id=workspace_id,
                trigger_payload=trigger_payload,
            )
        except _FlowBlocked:
            raise
        except Exception as exc:
            last_exception = exc
            if attempt < max_attempts and backoff_seconds > 0.0:
                time.sleep(backoff_seconds * attempt)
    assert last_exception is not None  # invariant: max_attempts >= 1
    raise last_exception


def _block_has_error_edge(
    block_id: str, dag: dict[str, list[FlowBlockInput]]
) -> bool:
    """True when at least one downstream block consumes an `error` edge
    originating from `block_id`."""
    for _target_id, edges in dag.items():
        for edge in edges:
            if edge.source_block_id == block_id and edge.edge_type == "error":
                return True
    return False


def _activated_edge_types_for_block(
    block_type: str,
    output: dict[str, object] | None,
    *,
    failed: bool = False,
) -> set[str]:
    """Edge types this block activates downstream.

    A failed block activates `error`; branch blocks pick exactly one of
    branch_true/branch_false/branch_case; everything else activates `data`.
    """
    if failed:
        return {"error"}
    if block_type in {"logic_branch_if", "logic_branch_switch"}:
        decision = (output or {}).get("__branch_decision")
        return {str(decision)} if decision else set()
    return {"data"}


def _resolve_branch_value(input_value: object | None, path: str) -> object:
    """Resolve a dot/bracket path against the upstream output.

    Accepts ``$.foo.bar``, ``foo.bar``, ``$.list[0]``, ``$.dict["key"]``.
    Returns ``None`` on miss so callers can treat the path as falsy.
    """
    if input_value is None or not path:
        return None
    cleaned = path.strip()
    if cleaned.startswith("$"):
        cleaned = cleaned[1:]
    if cleaned.startswith("."):
        cleaned = cleaned[1:]
    if not cleaned:
        return input_value
    current: object = input_value
    i = 0
    while i < len(cleaned):
        ch = cleaned[i]
        if ch == ".":
            i += 1
            continue
        if ch == "[":
            close = cleaned.find("]", i)
            if close < 0:
                return None
            selector = cleaned[i + 1 : close].strip()
            if selector.isdigit():
                idx = int(selector)
                if not isinstance(current, list) or idx < 0 or idx >= len(current):
                    return None
                current = current[idx]
            elif (
                len(selector) >= 2
                and selector[0] in {"'", '"'}
                and selector[-1] == selector[0]
            ):
                key = selector[1:-1]
                if not isinstance(current, dict) or key not in current:
                    return None
                current = current[key]
            else:
                return None
            i = close + 1
            continue
        start = i
        while i < len(cleaned) and (cleaned[i].isalnum() or cleaned[i] == "_"):
            i += 1
        key = cleaned[start:i]
        if not key:
            return None
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current


def _build_flow_dag(flow: IntegrationFlow) -> dict[str, list[FlowBlockInput]]:
    """Produce the DAG view of a flow.

    Each block_id maps to a list of FlowBlockInput entries. The list is empty
    for source blocks. Legacy linear flows (only input_block_id set) are
    promoted to a single edge_type='data' entry.

    Blocks that require input but have neither `inputs` nor `input_block_id`
    fall back to the previous block in `flow.blocks` order, matching the v1
    runner's behaviour so unmodified v1 flows execute identically.
    """
    dag: dict[str, list[FlowBlockInput]] = {}
    previous_block_id: str | None = None
    for block in flow.blocks:
        if block.inputs:
            dag[block.id] = list(block.inputs)
        elif block.input_block_id is not None:
            dag[block.id] = [
                FlowBlockInput(source_block_id=block.input_block_id, edge_type="data")
            ]
        elif (
            block.block_type in FLOW_BLOCK_TYPES_REQUIRING_INPUT
            and previous_block_id is not None
        ):
            dag[block.id] = [
                FlowBlockInput(source_block_id=previous_block_id, edge_type="data")
            ]
        else:
            dag[block.id] = []
        previous_block_id = block.id
    return dag


def _topological_order(
    block_ids: list[str],
    dag: dict[str, list[FlowBlockInput]],
) -> list[str]:
    """Kahn topological sort. Returns block_ids in execution order.

    Ties are broken by `block_ids` (= flow.blocks) order so existing flows
    keep their observable execution sequence.
    """
    block_id_set = set(block_ids)
    indegree: dict[str, int] = {bid: 0 for bid in block_ids}
    successors: dict[str, list[str]] = {bid: [] for bid in block_ids}
    for bid in block_ids:
        for edge in dag.get(bid, []):
            if edge.source_block_id in block_id_set:
                indegree[bid] += 1
                successors[edge.source_block_id].append(bid)
    ready = [bid for bid in block_ids if indegree[bid] == 0]
    ordered: list[str] = []
    while ready:
        current = ready.pop(0)
        ordered.append(current)
        for nxt in successors[current]:
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                ready.append(nxt)
    return ordered


def _detect_cycles(dag: dict[str, list[FlowBlockInput]]) -> list[str]:
    """Return block ids participating in any cycle.

    DFS coloring (white/gray/black). When the visit walks back into a gray
    ancestor, every node from that ancestor to the current is in a cycle.
    """
    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {bid: WHITE for bid in dag}
    in_cycle: set[str] = set()

    def visit(node: str, stack: list[str]) -> None:
        color[node] = GRAY
        stack.append(node)
        for edge in dag.get(node, []):
            child = edge.source_block_id
            if child not in color:
                continue
            if color[child] == GRAY:
                idx = stack.index(child)
                in_cycle.update(stack[idx:])
            elif color[child] == WHITE:
                visit(child, stack)
        stack.pop()
        color[node] = BLACK

    for bid in list(dag.keys()):
        if color[bid] == WHITE:
            visit(bid, [])
    return sorted(in_cycle)


def _flow_block_dependencies(flow: IntegrationFlow) -> dict[str, str | None]:
    dependencies: dict[str, str | None] = {}
    previous_block_id: str | None = None
    for block in flow.blocks:
        input_block_id = block.input_block_id
        if input_block_id is None and block.block_type in FLOW_BLOCK_TYPES_REQUIRING_INPUT:
            input_block_id = previous_block_id
        dependencies[block.id] = input_block_id
        previous_block_id = block.id
    return dependencies


def _collect_block_ancestors(
    block_id: str,
    *,
    dependencies: dict[str, str | None],
) -> set[str]:
    ancestors: set[str] = set()
    current = dependencies.get(block_id)
    while current is not None and current not in ancestors:
        ancestors.add(current)
        current = dependencies.get(current)
    return ancestors


def _collect_block_descendants(
    block_id: str,
    *,
    reverse_dependencies: dict[str, set[str]],
) -> set[str]:
    descendants: set[str] = set()
    pending = [block_id]
    while pending:
        current = pending.pop()
        if current in descendants:
            continue
        descendants.add(current)
        pending.extend(sorted(reverse_dependencies.get(current, set())))
    return descendants


def _flow_completion_message(
    *,
    flow: IntegrationFlow,
    start_block_id: str | None,
    stop_after_block_id: str | None,
) -> str:
    if start_block_id is not None and stop_after_block_id is not None:
        if start_block_id == stop_after_block_id:
            return (
                f"Integration flow {flow.name!r} completed a live run for block "
                f"{start_block_id!r}."
            )
        return (
            f"Integration flow {flow.name!r} completed from block {start_block_id!r} "
            f"through {stop_after_block_id!r}."
        )
    if stop_after_block_id is not None:
        return (
            f"Integration flow {flow.name!r} completed through block "
            f"{stop_after_block_id!r}."
        )
    if start_block_id is not None:
        return f"Integration flow {flow.name!r} completed from block {start_block_id!r}."
    return f"Integration flow {flow.name!r} completed successfully."


def _flow_execution_scope(
    *,
    flow: IntegrationFlow,
    executed_blocks: list[IntegrationFlowBlock],
    start_block_id: str | None,
    stop_after_block_id: str | None,
    final_block: IntegrationFlowBlock | None,
) -> dict[str, object]:
    if start_block_id is not None and stop_after_block_id is not None:
        mode = "step" if start_block_id == stop_after_block_id else "range"
    elif stop_after_block_id is not None:
        mode = "through"
    elif start_block_id is not None:
        mode = "from"
    else:
        mode = "full"
    return {
        "mode": mode,
        "flow_id": flow.id,
        "requested_start_block_id": start_block_id,
        "requested_stop_after_block_id": stop_after_block_id,
        "executed_block_ids": [block.id for block in executed_blocks],
        "final_block_id": final_block.id if final_block is not None else None,
        "final_block_type": final_block.block_type if final_block is not None else None,
    }


def _validate_api_mapping_config(block_id: str, config: dict[str, object]) -> None:
    for key in (
        "work_order_field_map",
        "operation_field_map",
        "machine_field_map",
        "calendar_field_map",
        "resource_field_map",
        "inventory_field_map",
        "supply_field_map",
    ):
        value = config.get(key)
        if value is not None and not isinstance(value, dict):
            raise ValidationError(
                f"Integration flow block {block_id!r} requires {key} to be a JSON object."
            )
    for key in (
        "work_orders_path",
        "operations_path",
        "machines_path",
        "calendars_path",
        "resources_path",
        "inventory_items_path",
        "supplies_path",
        "work_order_operations_path",
        "response_root",
    ):
        value = config.get(key)
        if value is not None and not isinstance(value, str):
            raise ValidationError(
                f"Integration flow block {block_id!r} requires {key} to be a string path."
            )


def _validate_transform_operation(block_id: str, operation: object) -> None:
    if not isinstance(operation, dict):
        raise ValidationError(
            f"Integration flow block {block_id!r} requires transform operations to be objects."
        )
    op_name = str(operation.get("op") or "").strip().lower()
    if op_name not in SUPPORTED_TRANSFORM_OPERATIONS:
        raise ValidationError(
            f"Integration flow block {block_id!r} uses unsupported transform op {op_name!r}."
        )
    if op_name == "set_metadata":
        if not str(operation.get("key") or "").strip():
            raise ValidationError(
                f"Integration flow block {block_id!r} requires key for set_metadata."
            )
    if op_name == "set_source_system":
        if not str(operation.get("value") or "").strip():
            raise ValidationError(
                f"Integration flow block {block_id!r} requires value for set_source_system."
            )
    if op_name in {
        "default_work_order_field",
        "map_work_order_field",
        "rename_work_order_field",
        "copy_work_order_field",
        "wrap_work_order_field_in_list",
        "filter_work_orders_by_field",
    }:
        if not str(operation.get("field") or "").strip():
            raise ValidationError(
                f"Integration flow block {block_id!r} requires field for {op_name}."
            )
    if op_name in {
        "default_operation_field",
        "map_operation_field",
        "rename_operation_field",
        "copy_operation_field",
        "wrap_operation_field_in_list",
    }:
        if not str(operation.get("field") or "").strip():
            raise ValidationError(
                f"Integration flow block {block_id!r} requires field for {op_name}."
            )
    if op_name in {
        "rename_work_order_field",
        "copy_work_order_field",
        "rename_operation_field",
        "copy_operation_field",
        "wrap_work_order_field_in_list",
        "wrap_operation_field_in_list",
    } and not str(operation.get("target_field") or "").strip():
        raise ValidationError(
            f"Integration flow block {block_id!r} requires target_field for {op_name}."
        )
    if op_name in {"map_work_order_field", "map_operation_field"} and not isinstance(
        operation.get("mapping"),
        dict,
    ):
        raise ValidationError(
            f"Integration flow block {block_id!r} requires mapping for {op_name}."
        )
    if op_name == "filter_work_orders_by_field":
        if not isinstance(operation.get("allowed_values"), list):
            raise ValidationError(
                f"Integration flow block {block_id!r} requires allowed_values for filter_work_orders_by_field."
            )


def _apply_snapshot_operations(
    *,
    snapshot_json: dict[str, Any],
    operations: list[dict[str, object]],
) -> dict[str, Any]:
    working = clone_json(snapshot_json)
    metadata = working.setdefault("metadata", {})
    if not isinstance(metadata, dict):
        metadata = {}
        working["metadata"] = metadata
    work_orders = working.setdefault("work_orders", [])
    if not isinstance(work_orders, list):
        raise ValidationError("Snapshot JSON work_orders must be a list.")

    for operation in operations:
        op_name = str(operation.get("op") or "").strip().lower()
        if op_name == "set_metadata":
            metadata[str(operation["key"])] = clone_json(operation.get("value"))
            continue
        if op_name == "set_source_system":
            working["source_system"] = str(operation["value"])
            continue
        if op_name == "default_work_order_field":
            field_name = str(operation["field"])
            value = clone_json(operation.get("value"))
            for work_order in work_orders:
                if not isinstance(work_order, dict):
                    continue
                if _is_missing(work_order.get(field_name)):
                    work_order[field_name] = value
            continue
        if op_name == "map_work_order_field":
            field_name = str(operation["field"])
            target_field = str(operation.get("target_field") or field_name)
            mapping = {
                str(key): clone_json(value)
                for key, value in dict(operation.get("mapping", {})).items()
            }
            default = clone_json(operation.get("default")) if "default" in operation else None
            has_default = "default" in operation
            for work_order in work_orders:
                if not isinstance(work_order, dict):
                    continue
                source_value = work_order.get(field_name)
                mapped = mapping.get("" if source_value is None else str(source_value))
                if mapped is not None:
                    work_order[target_field] = mapped
                elif has_default:
                    work_order[target_field] = default
            continue
        if op_name == "rename_work_order_field":
            field_name = str(operation["field"])
            target_field = str(operation["target_field"])
            for work_order in work_orders:
                if not isinstance(work_order, dict) or field_name not in work_order:
                    continue
                work_order[target_field] = work_order.pop(field_name)
            continue
        if op_name == "copy_work_order_field":
            field_name = str(operation["field"])
            target_field = str(operation["target_field"])
            for work_order in work_orders:
                if not isinstance(work_order, dict) or field_name not in work_order:
                    continue
                work_order[target_field] = clone_json(work_order.get(field_name))
            continue
        if op_name == "wrap_work_order_field_in_list":
            field_name = str(operation["field"])
            target_field = str(operation["target_field"])
            for work_order in work_orders:
                if not isinstance(work_order, dict):
                    continue
                value = work_order.get(field_name)
                if _is_missing(value):
                    continue
                if isinstance(value, list):
                    work_order[target_field] = clone_json(value)
                else:
                    work_order[target_field] = [clone_json(value)]
            continue
        if op_name == "filter_work_orders_by_field":
            field_name = str(operation["field"])
            allowed = {str(value) for value in operation.get("allowed_values", [])}
            working["work_orders"] = [
                work_order
                for work_order in work_orders
                if isinstance(work_order, dict)
                and str(work_order.get(field_name)) in allowed
            ]
            work_orders = working["work_orders"]
            continue
        if op_name == "default_operation_field":
            field_name = str(operation["field"])
            value = clone_json(operation.get("value"))
            for work_order in work_orders:
                if not isinstance(work_order, dict):
                    continue
                for op_payload in _list_from_dict(work_order, "operations"):
                    if _is_missing(op_payload.get(field_name)):
                        op_payload[field_name] = value
            continue
        if op_name == "map_operation_field":
            field_name = str(operation["field"])
            target_field = str(operation.get("target_field") or field_name)
            mapping = {
                str(key): clone_json(value)
                for key, value in dict(operation.get("mapping", {})).items()
            }
            default = clone_json(operation.get("default")) if "default" in operation else None
            has_default = "default" in operation
            for work_order in work_orders:
                if not isinstance(work_order, dict):
                    continue
                for op_payload in _list_from_dict(work_order, "operations"):
                    source_value = op_payload.get(field_name)
                    mapped = mapping.get("" if source_value is None else str(source_value))
                    if mapped is not None:
                        op_payload[target_field] = mapped
                    elif has_default:
                        op_payload[target_field] = default
            continue
        if op_name == "rename_operation_field":
            field_name = str(operation["field"])
            target_field = str(operation["target_field"])
            for work_order in work_orders:
                if not isinstance(work_order, dict):
                    continue
                for op_payload in _list_from_dict(work_order, "operations"):
                    if field_name not in op_payload:
                        continue
                    op_payload[target_field] = op_payload.pop(field_name)
            continue
        if op_name == "copy_operation_field":
            field_name = str(operation["field"])
            target_field = str(operation["target_field"])
            for work_order in work_orders:
                if not isinstance(work_order, dict):
                    continue
                for op_payload in _list_from_dict(work_order, "operations"):
                    if field_name not in op_payload:
                        continue
                    op_payload[target_field] = clone_json(op_payload.get(field_name))
            continue
        if op_name == "wrap_operation_field_in_list":
            field_name = str(operation["field"])
            target_field = str(operation["target_field"])
            for work_order in work_orders:
                if not isinstance(work_order, dict):
                    continue
                for op_payload in _list_from_dict(work_order, "operations"):
                    value = op_payload.get(field_name)
                    if _is_missing(value):
                        continue
                    if isinstance(value, list):
                        op_payload[target_field] = clone_json(value)
                    else:
                        op_payload[target_field] = [clone_json(value)]
            continue
        raise ValidationError(f"Unsupported transform op {op_name!r}.")
    return working


SUPPORTED_PAYLOAD_FORMATS = {"json", "xml", "csv", "text"}


def _format_flow_payload(
    input_value: dict[str, object] | None,
    config: dict[str, object],
    *,
    label: str,
) -> dict[str, object]:
    if input_value is None:
        raise ValidationError(f"{label} requires input data to format.")
    format_name = str(config.get("format") or "json").strip().lower()
    if format_name not in SUPPORTED_PAYLOAD_FORMATS:
        allowed = ", ".join(sorted(SUPPORTED_PAYLOAD_FORMATS))
        raise ValidationError(f"{label} requires format one of: {allowed}.")
    data = _select_format_source(input_value, config, label=label)
    file_name = _optional_str(config.get("file_name")) or f"payload.{format_name}"

    if format_name == "json":
        indent_value = int(config.get("indent") or 2)
        text = json.dumps(data, ensure_ascii=False, indent=indent_value)
        mime_type = "application/json"
    elif format_name == "xml":
        root_name = _xml_tag_name(_optional_str(config.get("root_name")) or "payload")
        item_name = _xml_tag_name(_optional_str(config.get("item_name")) or "item")
        body = _xml_render(root_name, data, item_name=item_name)
        declaration = '<?xml version="1.0" encoding="UTF-8"?>\n'
        text = declaration + body if config.get("include_declaration") is not False else body
        mime_type = "application/xml"
    elif format_name == "csv":
        records = _csv_records(data, config, label=label)
        fields = _csv_fields(records, config)
        output = io.StringIO(newline="")
        writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
        if config.get("include_header") is not False:
            writer.writeheader()
        for record in records:
            writer.writerow({field: _csv_cell(record.get(field)) for field in fields})
        text = output.getvalue()
        mime_type = "text/csv"
    else:
        text = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
        mime_type = "text/plain"

    encoded = text.encode("utf-8")
    return {
        "kind": "formatted_payload",
        "format": format_name,
        "mime_type": mime_type,
        "encoding": "utf-8",
        "file_name": file_name,
        "text": text,
        "byte_length": len(encoded),
        "content_hash": sha256(encoded).hexdigest(),
        "source_kind": input_value.get("kind"),
    }


def _require_formatted_payload(
    input_value: dict[str, object] | None,
    *,
    label: str,
) -> dict[str, object]:
    if not isinstance(input_value, dict) or input_value.get("kind") != "formatted_payload":
        raise ValidationError(f"{label} requires formatted data from a Format Data block.")
    if not isinstance(input_value.get("text"), str):
        raise ValidationError(f"{label} formatted payload must include text content.")
    return input_value


def _select_format_source(
    input_value: dict[str, object],
    config: dict[str, object],
    *,
    label: str,
) -> object:
    source_path = _optional_str(config.get("source_path"))
    if source_path:
        return _extract_json_path(input_value, source_path, label=f"{label} format source")
    kind = input_value.get("kind")
    if kind in {"snapshot", "validated_snapshot"} and isinstance(
        input_value.get("snapshot"), dict
    ):
        return clone_json(input_value["snapshot"])
    if kind == "published_plan" and isinstance(input_value.get("plan"), dict):
        return clone_json(input_value["plan"])
    if kind == "api_response" and isinstance(input_value.get("response_json"), dict):
        return clone_json(input_value["response_json"])
    if kind == "formatted_payload" and isinstance(input_value.get("text"), str):
        return input_value["text"]
    return clone_json(input_value)


def _xml_render(name: str, value: object, *, item_name: str) -> str:
    if isinstance(value, dict):
        children = "".join(
            _xml_render(_xml_tag_name(str(key)), item, item_name=item_name)
            for key, item in value.items()
        )
        return f"<{name}>{children}</{name}>"
    if isinstance(value, list):
        children = "".join(_xml_render(item_name, item, item_name=item_name) for item in value)
        return f"<{name}>{children}</{name}>"
    if value is None:
        return f"<{name} />"
    return f"<{name}>{xml_escape(str(value))}</{name}>"


def _xml_tag_name(value: str) -> str:
    tag = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip())
    if not tag:
        return "item"
    if not re.match(r"^[A-Za-z_]", tag):
        tag = f"item_{tag}"
    return tag


def _csv_records(
    data: object,
    config: dict[str, object],
    *,
    label: str,
) -> list[dict[str, object]]:
    record_path = _optional_str(config.get("record_path"))
    if record_path:
        data = _extract_json_path(data, record_path, label=f"{label} CSV records")
    if isinstance(data, list):
        records = [dict(item) for item in data if isinstance(item, dict)]
    elif isinstance(data, dict):
        records = [dict(data)]
    else:
        records = [{"value": data}]
    if not records:
        raise ValidationError(f"{label} could not find records to format as CSV.")
    return records


def _csv_fields(
    records: list[dict[str, object]],
    config: dict[str, object],
) -> list[str]:
    raw_fields = config.get("fields")
    if isinstance(raw_fields, list):
        fields = [str(field).strip() for field in raw_fields if str(field).strip()]
        if fields:
            return fields
    seen: set[str] = set()
    fields: list[str] = []
    for record in records:
        for key in record.keys():
            field = str(key)
            if field not in seen:
                fields.append(field)
                seen.add(field)
    return fields or ["value"]


def _csv_cell(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


_FLOW_VARIABLE_PATTERN = re.compile(r"{{\s*([^{}]+?)\s*}}")
_FLOW_VARIABLE_MISSING = object()


def _resolve_flow_config_variables(
    config: dict[str, object],
    input_value: dict[str, object] | None,
) -> dict[str, object]:
    return {
        key: _resolve_flow_template_value(value, input_value)
        for key, value in config.items()
    }


def _resolve_flow_template_value(value: object, input_value: object | None) -> object:
    if isinstance(value, str):
        return _resolve_flow_template_string(value, input_value)
    if isinstance(value, list):
        return [_resolve_flow_template_value(item, input_value) for item in value]
    if isinstance(value, dict):
        return {
            str(key): _resolve_flow_template_value(item, input_value)
            for key, item in value.items()
        }
    return value


def _resolve_flow_template_string(text: str, input_value: object | None) -> object:
    matches = list(_FLOW_VARIABLE_PATTERN.finditer(text))
    if not matches:
        return text
    if input_value is None:
        raise ValidationError("Flow variable templates require an input block.")

    def resolve_expression(expression: str) -> object:
        expression = expression.strip()
        if expression == "input":
            return input_value
        if not expression.startswith("input"):
            raise ValidationError(
                f"Unsupported flow variable {expression!r}; use variables starting with input."
            )
        resolved = _resolve_flow_variable_path(input_value, expression)
        if resolved is _FLOW_VARIABLE_MISSING:
            raise ValidationError(f"Flow variable {expression!r} could not be resolved.")
        return clone_json(resolved)

    if len(matches) == 1 and matches[0].group(0) == text.strip():
        return resolve_expression(matches[0].group(1))

    def replace(match: re.Match[str]) -> str:
        return _stringify_flow_template_value(resolve_expression(match.group(1)))

    return _FLOW_VARIABLE_PATTERN.sub(replace, text)


def _resolve_flow_variable_path(root: object, expression: str) -> object:
    current: object = root
    index = len("input")
    while index < len(expression):
        char = expression[index]
        if char == ".":
            index += 1
            start = index
            while index < len(expression) and (
                expression[index].isalnum() or expression[index] == "_"
            ):
                index += 1
            if start == index:
                return _FLOW_VARIABLE_MISSING
            key = expression[start:index]
            if not isinstance(current, dict) or key not in current:
                return _FLOW_VARIABLE_MISSING
            current = current[key]
            continue
        if char == "[":
            closing = expression.find("]", index)
            if closing < 0:
                return _FLOW_VARIABLE_MISSING
            selector = expression[index + 1 : closing].strip()
            if selector.isdigit():
                item_index = int(selector)
                if (
                    not isinstance(current, list)
                    or item_index < 0
                    or item_index >= len(current)
                ):
                    return _FLOW_VARIABLE_MISSING
                current = current[item_index]
            elif (
                len(selector) >= 2
                and selector[0] in {"'", '"'}
                and selector[-1] == selector[0]
            ):
                key = selector[1:-1]
                if not isinstance(current, dict) or key not in current:
                    return _FLOW_VARIABLE_MISSING
                current = current[key]
            else:
                return _FLOW_VARIABLE_MISSING
            index = closing + 1
            continue
        return _FLOW_VARIABLE_MISSING
    return current


def _stringify_flow_template_value(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _http_request_mode(config: dict[str, object]) -> str:
    request_mode = _optional_str(config.get("request_mode"))
    if request_mode in {"direct", "profile"}:
        return request_mode
    # Phase 9.5: prefer the connector when both connector_id and url are
    # set — pre-fix, a planner who picked a connector AND wrote a path
    # like "/published-plan" in `url` got "url must be absolute HTTP URL"
    # because the `url` heuristic kicked in first.
    if _optional_str(config.get("connector_id")):
        return "profile"
    if _optional_str(config.get("url")):
        return "direct"
    return "profile"


def _flow_block_display_name(block: IntegrationFlowBlock) -> str:
    if block.name:
        return block.name
    label = FLOW_BLOCK_LABELS.get(block.block_type)
    if label:
        return label
    if block.id:
        return block.id
    return "This block"


def _http_target_label(
    connector: IntegrationConnector | None,
    config: dict[str, object],
) -> str:
    if connector is not None:
        if connector.id.startswith("inline-http-"):
            url = _optional_str(config.get("url")) or connector.endpoint_url
            return f"HTTP target {url!r}"
        return f"Connector {connector.id!r}"
    url = _optional_str(config.get("url")) or "direct HTTP URL"
    return f"HTTP target {url!r}"


def _http_timeout_seconds(config: dict[str, object], *, label: str) -> int:
    raw_value = config.get("timeout_seconds")
    if raw_value is None or raw_value == "":
        return 30
    try:
        timeout_seconds = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{label} requires timeout_seconds to be an integer.") from exc
    if timeout_seconds <= 0:
        raise ValidationError(f"{label} requires timeout_seconds to be positive.")
    return timeout_seconds


def _validated_direct_http_connector(
    *,
    block_config: dict[str, object],
    block_id: str,
    default_source_system: str,
) -> IntegrationConnector:
    endpoint_url = _optional_str(block_config.get("url"))
    if endpoint_url is None:
        raise ValidationError(f"Integration flow block {block_id!r} requires config.url.")
    return validate_integration_connector(
        IntegrationConnector(
            id=f"inline-http-{block_id}",
            name=f"Flow {block_id} direct HTTP target",
            endpoint_url=endpoint_url,
            source_system=(
                _optional_str(block_config.get("source_system")) or default_source_system or "flow"
            ),
            connector_type="http",
            method=str(block_config.get("request_method") or "GET").strip().upper() or "GET",
            auth_type=str(block_config.get("auth_type") or "none").strip().lower() or "none",
            auth_header_name=_optional_str(block_config.get("auth_header_name")),
            username=_optional_str(block_config.get("username")),
            secret_ref=_optional_str(block_config.get("secret_ref")),
            static_headers=_string_dict_config(block_config, "static_headers"),
            timeout_seconds=_http_timeout_seconds(
                block_config,
                label=f"Integration flow block {block_id!r}",
            ),
        )
    )


def _build_flow_http_request(
    *,
    connector: IntegrationConnector | None,
    block_config: dict[str, object],
    flow_id: str,
    block_id: str,
    default_source_system: str,
    secret_resolver: IntegrationSecretResolver,
    body: bytes | None,
    payload_kind: str | None = None,
):
    target_connector = connector or _validated_direct_http_connector(
        block_config=block_config,
        block_id=block_id,
        default_source_system=default_source_system,
    )
    method = _resolved_http_method(connector, block_config)
    request_body = None if method == "GET" else body
    extra_headers = {
        "X-PlaniAdvance-Flow-Id": flow_id,
        "X-PlaniAdvance-Block-Id": block_id,
        **_string_dict_config(block_config, "request_headers"),
    }
    if request_body is not None:
        extra_headers.setdefault("Content-Type", "application/json")
    if payload_kind:
        extra_headers["X-PlaniAdvance-Payload-Kind"] = payload_kind
    return build_connector_http_request(
        target_connector,
        secret_resolver=secret_resolver,
        body=request_body,
        extra_headers=extra_headers,
        url_override=_connector_url_override(target_connector, block_config),
        method_override=method,
    )


def _resolved_http_method(
    connector: IntegrationConnector | None,
    config: dict[str, object],
) -> str:
    default_method = connector.method if connector is not None else "GET"
    return str(config.get("request_method") or default_method).strip().upper()


def _connector_url_override(
    connector: IntegrationConnector,
    config: dict[str, object],
) -> str | None:
    route_path = _optional_str(config.get("route_path"))
    query_params = _string_dict_config(config, "query_params")
    if route_path is None and not query_params:
        return None
    parsed = urlparse(connector.endpoint_url)
    path = parsed.path or ""
    if route_path is not None:
        normalized_route = route_path if route_path.startswith("/") else f"/{route_path}"
        base_path = (parsed.path or "").rstrip("/")
        if base_path and base_path != "/":
            path = f"{base_path}{normalized_route}"
        else:
            path = normalized_route
    existing_query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    existing_query.update(query_params)
    query = urlencode(existing_query, doseq=False)
    return urlunparse(parsed._replace(path=path, query=query))


def _extract_json_path(
    payload: object,
    path: str | None,
    *,
    label: str,
) -> object:
    if path is None or not path.strip():
        return payload
    current = payload
    for segment in [item for item in path.split(".") if item]:
        if isinstance(current, dict):
            if segment not in current:
                raise ValidationError(
                    f"{label} could not find response path {path!r}."
                )
            current = current[segment]
            continue
        if isinstance(current, list) and segment.isdigit():
            index = int(segment)
            if index < 0 or index >= len(current):
                raise ValidationError(
                    f"{label} response path {path!r} points outside the array bounds."
                )
            current = current[index]
            continue
        raise ValidationError(
            f"{label} could not resolve response path {path!r}."
        )
    return clone_json(current)


def _extract_api_response_json(
    value: object,
    *,
    label: str,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError(f"{label} must receive an API response envelope.")
    response_json = value.get("response_json")
    if not isinstance(response_json, dict):
        raise ValidationError(f"{label} does not include a JSON API response.")
    return clone_json(response_json)


def _map_api_response_to_snapshot(
    *,
    api_response_json: dict[str, Any],
    config: dict[str, object],
    source_system: str,
) -> dict[str, Any]:
    response_root = _optional_str(config.get("response_root"))
    payload = _extract_json_path(
        api_response_json,
        response_root,
        label="API response mapping",
    )
    if not isinstance(payload, dict):
        raise ValidationError("API response mapping requires a JSON object payload.")

    work_orders = _list_at_path(
        payload,
        _optional_str(config.get("work_orders_path")) or "work_orders",
        required=True,
    )
    operations = _list_at_path(payload, _optional_str(config.get("operations_path")))
    work_order_operations_path = (
        _optional_str(config.get("work_order_operations_path")) or "operations"
    )

    mapped_work_orders = [
        _map_record(work_order, _field_map_config(config, "work_order_field_map"))
        for work_order in work_orders
    ]
    # Phase 9.5 fix: raise a friendly diagnostic listing every canonical
    # field missing on the mapped records, so the planner doesn't see
    # a bare KeyError ('name') downstream in planning_snapshot_from_json.
    _check_required_canonical_fields(
        mapped_work_orders,
        required={"id", "name", "product_id", "quantity", "due_date", "release_date"},
        record_label="work_order",
        field_map_key="work_order_field_map",
    )
    operations_by_work_order: dict[str, list[dict[str, Any]]] = {}

    if operations:
        mapped_operations = [
            _map_record(operation, _field_map_config(config, "operation_field_map"))
            for operation in operations
        ]
        for operation in mapped_operations:
            work_order_id = str(operation.get("work_order_id") or "").strip()
            if not work_order_id:
                continue
            operations_by_work_order.setdefault(work_order_id, []).append(operation)
    else:
        for work_order in work_orders:
            mapped_work_order = _map_record(
                work_order,
                _field_map_config(config, "work_order_field_map"),
            )
            work_order_id = str(mapped_work_order.get("id") or "").strip()
            nested_operations = _list_at_path(work_order, work_order_operations_path)
            if not work_order_id or not nested_operations:
                continue
            operations_by_work_order[work_order_id] = [
                _map_record(
                    operation,
                    _field_map_config(config, "operation_field_map"),
                    defaults={"work_order_id": work_order_id},
                )
                for operation in nested_operations
            ]

    for work_order in mapped_work_orders:
        work_order_id = str(work_order.get("id") or "").strip()
        work_order["operations"] = operations_by_work_order.get(work_order_id, [])

    snapshot_json: dict[str, Any] = {
        "contract_version": str(
            config.get("contract_version") or APS_SNAPSHOT_CONTRACT_VERSION
        ),
        "exported_at": datetime.utcnow().isoformat(),
        "source_system": str(config.get("source_system") or source_system or "erp"),
        "calendars": [
            _map_record(item, _field_map_config(config, "calendar_field_map"))
            for item in _list_at_path(
                payload,
                _optional_str(config.get("calendars_path")) or "calendars",
                required=False,
            )
        ],
        "machines": [
            _map_record(item, _field_map_config(config, "machine_field_map"))
            for item in _list_at_path(
                payload,
                _optional_str(config.get("machines_path")) or "machines",
                required=False,
            )
        ],
        "resources": [
            _map_record(item, _field_map_config(config, "resource_field_map"))
            for item in _list_at_path(
                payload,
                _optional_str(config.get("resources_path")) or "resources",
                required=False,
            )
        ],
        "work_orders": mapped_work_orders,
        "inventory_items": [
            _map_record(item, _field_map_config(config, "inventory_field_map"))
            for item in _list_at_path(
                payload,
                _optional_str(config.get("inventory_items_path")) or "inventory_items",
                required=False,
            )
        ],
        "supplies": [
            _map_record(item, _field_map_config(config, "supply_field_map"))
            for item in _list_at_path(
                payload,
                _optional_str(config.get("supplies_path")) or "supplies",
                required=False,
            )
        ],
        "transfer_times": clone_json(config.get("transfer_times") or {}),
        "metadata": _metadata_from_mapping(payload, config),
    }
    return snapshot_json


def _metadata_from_mapping(
    payload: dict[str, Any],
    config: dict[str, object],
) -> dict[str, Any]:
    metadata = clone_json(_dict_config(config, "metadata"))
    metadata_path = _optional_str(config.get("metadata_path"))
    if metadata_path:
        extracted = _extract_json_path(payload, metadata_path, label="API response metadata")
        if isinstance(extracted, dict):
            metadata.update(dict(extracted))
    return metadata


def _database_rows_from_input(
    value: object,
    *,
    rows_path: str | None,
    label: str,
) -> list[dict[str, Any]]:
    payload: object = value
    if isinstance(value, dict):
        kind = str(value.get("kind") or "").strip().lower()
        if kind == "formatted_payload":
            if str(value.get("format") or "").strip().lower() != "json":
                raise ValidationError(
                    f"{label} requires a JSON formatted payload or upstream JSON rows."
                )
            try:
                payload = json.loads(str(value.get("text") or "null"))
            except json.JSONDecodeError as exc:
                raise ValidationError(
                    f"{label} could not parse the formatted JSON payload."
                ) from exc
        elif kind == "snapshot":
            payload = extract_snapshot_json(value, label=label)
        elif kind == "published_plan":
            payload = _extract_plan_json(value, label=label)
        elif kind == "api_response":
            response_json = value.get("response_json")
            if not isinstance(response_json, (dict, list)):
                raise ValidationError(
                    f"{label} requires a JSON API response payload."
                )
            payload = clone_json(response_json)
    extracted = _extract_database_rows_path(
        payload,
        rows_path,
        label=f"{label} database rows",
    )
    if isinstance(extracted, list):
        rows = [dict(item) for item in extracted if isinstance(item, dict)]
        if len(rows) != len(extracted):
            raise ValidationError(
                f"{label} requires database rows to be a list of JSON objects."
            )
        return rows
    if isinstance(extracted, dict):
        return [dict(extracted)]
    raise ValidationError(
        f"{label} requires rows_path to resolve to a JSON object or a list of JSON objects."
    )


def _extract_database_rows_path(
    payload: object,
    path: str | None,
    *,
    label: str,
) -> object:
    if path is None or not path.strip():
        return clone_json(payload)

    segments = [item for item in path.split(".") if item]
    if "*" not in segments:
        return _extract_json_path(payload, path, label=label)

    current_values = [payload]
    for segment in segments:
        next_values: list[object] = []
        for current in current_values:
            if isinstance(current, dict):
                if segment == "*":
                    next_values.extend(current.values())
                    continue
                if segment in current:
                    next_values.append(current[segment])
                    continue
                continue
            if isinstance(current, list):
                if segment == "*":
                    next_values.extend(current)
                    continue
                if segment.isdigit():
                    index = int(segment)
                    if 0 <= index < len(current):
                        next_values.append(current[index])
                    continue
                continue
        if not next_values:
            raise ValidationError(
                f"{label} could not resolve response path {path!r}."
            )
        current_values = next_values

    flattened: list[object] = []
    for value in current_values:
        if isinstance(value, list):
            flattened.extend(value)
        else:
            flattened.append(value)
    return clone_json(flattened)


def _list_at_path(
    payload: object,
    path: str | None,
    *,
    required: bool = False,
) -> list[dict[str, Any]]:
    if path is None:
        return []
    try:
        value = _extract_json_path(payload, path, label="API response mapping")
    except ValidationError:
        if not required:
            return []
        raise
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _string_tuple_config(config: dict[str, object], key: str) -> tuple[str, ...]:
    value = config.get(key)
    if value is None:
        return ()
    if isinstance(value, str):
        return tuple(item.strip() for item in value.split(",") if item.strip())
    if isinstance(value, list):
        return tuple(str(item).strip() for item in value if str(item).strip())
    raise ValidationError(f"Integration flow config {key!r} must be a string or list.")


def _field_map_config(config: dict[str, object], key: str) -> dict[str, str]:
    value = config.get(key)
    if not isinstance(value, dict):
        return {}
    return {str(target): str(source) for target, source in value.items()}


def _check_required_canonical_fields(
    records: list[dict[str, Any]],
    *,
    required: set[str],
    record_label: str,
    field_map_key: str,
) -> None:
    """Raise a friendly diagnostic if any mapped record is missing a
    canonical field required downstream (planning_snapshot_from_json).

    Phase 9.5 fix — the v1 mapper let bare KeyErrors bubble up out of
    snapshot_codec, leaving planners with messages like "'name'" with
    no context. This pre-checks all records and surfaces the missing
    fields + the field_map config key the planner needs to populate.
    """
    if not records:
        return
    sample = records[0]
    missing_fields = sorted(required - set(sample.keys()))
    if not missing_fields:
        return
    raise ValidationError(
        f"Mapped {record_label} record is missing canonical fields: "
        f"{', '.join(missing_fields)}. Add them to "
        f"`{field_map_key}` in the block config (e.g. `{{\"name\": "
        f"\"id\"}}` to copy id into name). Required canonical "
        f"{record_label} fields: {sorted(required)}."
    )


def _map_record(
    item: dict[str, Any],
    field_map: dict[str, str],
    *,
    defaults: dict[str, object] | None = None,
) -> dict[str, Any]:
    mapped = clone_json(item)
    if field_map:
        mapped = {}
        for target_field, source_field in field_map.items():
            if source_field in item:
                mapped[target_field] = clone_json(item[source_field])
    if defaults:
        for key, value in defaults.items():
            mapped.setdefault(key, clone_json(value))
    return mapped


def _mapped_section_counts(snapshot_json: dict[str, Any]) -> dict[str, int]:
    return {
        "calendars": len(snapshot_json.get("calendars", [])),
        "machines": len(snapshot_json.get("machines", [])),
        "resources": len(snapshot_json.get("resources", [])),
        "work_orders": len(snapshot_json.get("work_orders", [])),
        "inventory_items": len(snapshot_json.get("inventory_items", [])),
        "supplies": len(snapshot_json.get("supplies", [])),
    }


def _find_database_table_schema(
    tables: list[IntegrationDatabaseTableSchema],
    table_name: str,
) -> IntegrationDatabaseTableSchema | None:
    normalized = table_name.strip()
    if not normalized:
        return None
    for table in tables:
        if (table.full_name or "").strip() == normalized:
            return table
    for table in tables:
        if table.name.strip() == normalized:
            return table
    return None


def _row_field_names(
    rows: list[dict[str, Any]],
    *,
    limit: int | None = 32,
) -> list[str]:
    fields: list[str] = []
    seen: set[str] = set()
    for row in rows[:25]:
        for key in row.keys():
            normalized = str(key)
            if normalized in seen:
                continue
            seen.add(normalized)
            fields.append(normalized)
            if limit is not None and len(fields) >= limit:
                return fields
    return fields


def _row_preview(rows: list[dict[str, Any]], *, limit: int = 3) -> list[dict[str, object]]:
    preview: list[dict[str, object]] = []
    for row in rows[:limit]:
        rendered = _preview_flow_value(dict(row))
        if isinstance(rendered, dict):
            preview.append(rendered)
    return preview


def _cron_to_interval_minutes(cron: str) -> int | None:
    """Phase 5.5 — best-effort cron → interval-minutes parser.

    The existing automation worker schedules on `interval_minutes`, not
    full cron. Real cron support is V1.0+ scope. For V1.0 pilots we
    cover the common patterns:
      * `*/N * * * *` → N minutes
      * `0 */N * * *` → N * 60 minutes
      * `N * * * *`  (single value, '*' minute spread) → 60
      * `0 H * * *` (daily at H:00) → 1440

    Returns None when the expression is unrecognised; caller skips
    registration in that case.
    """
    if not cron:
        return None
    parts = cron.strip().split()
    if len(parts) != 5:
        return None
    minute, hour, dom, mon, dow = parts
    if dom != "*" or mon != "*" or dow != "*":
        return None
    if minute.startswith("*/") and minute[2:].isdigit() and hour == "*":
        n = int(minute[2:])
        if 1 <= n <= 60:
            return n
    if minute == "0" and hour.startswith("*/") and hour[2:].isdigit():
        n = int(hour[2:])
        if 1 <= n <= 24:
            return n * 60
    if minute == "0" and hour.isdigit():
        return 1440
    if minute.isdigit() and hour == "*":
        return 60
    return None


def _webhook_token_for(*, flow_id: str, block_id: str) -> str:
    """Studio v2 phase 5 — deterministic short token for the webhook URL.

    Same (flow_id, block_id) → same token across reloads + across runs,
    so the URL the planner sees in the Inspector stays stable. The
    canonical token also flows through the trace's output_payload, so
    the UI can read it back from a real run.

    Thin wrapper around :func:`webhook_token.webhook_token_for` so
    legacy call sites keep working while the new ingress route shares
    the same derivation.
    """

    return webhook_token_for(flow_id=flow_id, block_id=block_id)


def _preview_flow_output(
    output: dict[str, object] | None,
) -> dict[str, object] | None:
    if output is None:
        return None
    preview = _preview_flow_value(output)
    return preview if isinstance(preview, dict) else {"value": preview}


def _preview_flow_value(value: object, *, depth: int = 0) -> object:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:500] + ("..." if len(value) > 500 else "")
    if depth >= 4:
        if isinstance(value, dict):
            return {"__preview_truncated__": f"{len(value)} key(s)"}
        if isinstance(value, list):
            return [f"... {len(value)} item(s)"]
        return str(value)
    if isinstance(value, list):
        items = [_preview_flow_value(item, depth=depth + 1) for item in value[:8]]
        if len(value) > 8:
            items.append(f"... {len(value) - 8} more item(s)")
        return items
    if isinstance(value, dict):
        preview: dict[str, object] = {}
        for index, (key, item) in enumerate(value.items()):
            if index >= 20:
                preview["__preview_truncated__"] = f"{len(value) - 20} more key(s)"
                break
            preview[str(key)] = _preview_flow_value(item, depth=depth + 1)
        return preview
    return str(value)


def _summarize_flow_output(output: dict[str, object]) -> dict[str, object]:
    summary = dict(output)
    formatted_text = summary.pop("text", None)
    if isinstance(formatted_text, str):
        summary["text"] = formatted_text[:1000]
        summary["text_truncated"] = len(formatted_text) > 1000
        summary["text_preview"] = formatted_text[:240]
    api_response = summary.pop("response_json", None)
    if isinstance(api_response, dict):
        summary["response_keys"] = sorted(str(key) for key in api_response.keys())
        response_samples = _response_field_samples(api_response)
        if response_samples:
            summary["response_samples"] = response_samples
    snapshot = summary.pop("snapshot", None)
    if isinstance(snapshot, dict):
        summary["source_system"] = snapshot.get("source_system")
        summary["metadata_keys"] = sorted(
            str(key) for key in dict(snapshot.get("metadata", {})).keys()
        )
    plan = summary.pop("plan", None)
    if isinstance(plan, dict):
        summary["plan_mode"] = plan.get("mode")
        summary["schedule_id"] = plan.get("schedule_id")
        summary["scenario_name"] = plan.get("scenario_name")
        summary["work_order_count"] = len(plan.get("work_orders", []))
    validation = summary.get("validation")
    if isinstance(validation, dict):
        summary["validation"] = {
            "valid": validation.get("valid"),
            "readiness_status": validation.get("readiness_status"),
            "error_count": validation.get("error_count"),
            "warning_count": validation.get("warning_count"),
        }
    return summary


def _response_field_samples(payload: dict[str, object]) -> dict[str, list[str]]:
    samples: dict[str, list[str]] = {}
    for key, value in payload.items():
        sample_fields: list[str] = []
        if isinstance(value, dict):
            sample_fields = sorted(str(item) for item in value.keys())[:12]
        elif isinstance(value, list) and value and isinstance(value[0], dict):
            sample_fields = sorted(str(item) for item in value[0].keys())[:12]
        if sample_fields:
            samples[str(key)] = sample_fields
    return samples


def _require_validated_snapshot(
    value: object,
    *,
    label: str,
) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValidationError(f"{label} must receive a validated snapshot envelope.")
    validation = value.get("validation")
    if not isinstance(validation, dict):
        raise ValidationError(f"{label} requires a validated snapshot input.")
    extract_snapshot_json(value, label=label)
    return dict(value)


def _validation_payload(value: dict[str, object]) -> dict[str, object]:
    validation = value.get("validation")
    return dict(validation) if isinstance(validation, dict) else {}


def _dict_config(config: dict[str, object], key: str) -> dict[str, object]:
    value = config.get(key)
    return dict(value) if isinstance(value, dict) else {}


def _string_dict_config(config: dict[str, object], key: str) -> dict[str, str]:
    value = config.get(key)
    if not isinstance(value, dict):
        return {}
    return {str(header): str(item) for header, item in value.items()}


def _list_config(config: dict[str, object], key: str) -> list[dict[str, object]]:
    value = config.get(key)
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _list_from_dict(payload: dict[str, Any], key: str) -> list[dict[str, Any]]:
    value = payload.get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _extract_plan_json(
    value: object,
    *,
    label: str,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError(f"{label} must receive a published plan envelope.")
    plan = value.get("plan")
    if not isinstance(plan, dict):
        raise ValidationError(f"{label} does not include a published plan payload.")
    return clone_json(plan)


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _optional_bool(value: object) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if not text:
        return None
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    raise ValidationError(
        f"Integration flow boolean value must be true/false, yes/no, on/off, or 1/0, got {value!r}."
    )


def _sftp_target_path(directory: str, file_name: str) -> str:
    normalized_directory = directory.strip() or "/"
    if normalized_directory == "/":
        return f"/{file_name.lstrip('/')}"
    return f"{normalized_directory.rstrip('/')}/{file_name.lstrip('/')}"


def _is_missing(value: object) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _json_hash(value: dict[str, Any]) -> str:
    encoded = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")
    return sha256(encoded).hexdigest()


def _flow_error_code(execution: _FlowExecution) -> str | None:
    if execution.status == "completed":
        return None
    if execution.status == "blocked":
        return "validation_blocked"
    value = execution.result.get("error")
    if value is not None and str(value).strip():
        return str(value)[:64]
    return "execution_failed"
