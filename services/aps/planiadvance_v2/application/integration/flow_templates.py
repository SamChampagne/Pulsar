"""Studio v2 phase 8 — starter flow templates ported from v1.

Each template carries a full block list with config defaults so the
frontend can spawn a working flow in one click. Blocks chain linearly
via ``input_block_id`` (no ``inputs[]``) so the templates execute
identically through the v1 runner if a pilot toggles
``studio_v2_enabled=False``.
"""

from __future__ import annotations

# Default transform operations the v1 ERP→APS recipe seeds. Kept here
# (not imported from v1) so the v2 catalog is a self-contained source
# of truth — Phase 9's v1 deletion can drop the whole import without
# breaking templates.
_DEFAULT_TRANSFORM_OPERATIONS: tuple[dict[str, object], ...] = (
    {"op": "set_metadata", "key": "site", "value": "default"},
)


FLOW_TEMPLATES: tuple[dict[str, object], ...] = (
    {
        "key": "erp-import",
        "title": "ERP to APS",
        "description": (
            "Call an API, map the response to APS data, transform it, "
            "validate it, then run APS."
        ),
        "outcome": (
            "Planning data is ready in APS and the APS engine runs from the flow."
        ),
        "source_system": "erp",
        "blocks": (
            {
                "id": "call-api",
                "block_type": "call_connector_api",
                "name": "Call API",
                "input_block_id": None,
                "config": {
                    "connector_id": "",
                    "route_path": "/work-orders",
                    "query_params": {"include": "operations,machines,calendars"},
                },
            },
            {
                "id": "map-api",
                "block_type": "map_api_response_to_snapshot",
                "name": "Map API To APS",
                "input_block_id": "call-api",
                "config": {
                    "work_orders_path": "orders",
                    "work_order_field_map": {
                        "id": "id",
                        "name": "name",
                        "product_id": "product_id",
                        "quantity": "quantity",
                        "release_date": "release_date",
                        "due_date": "due_date",
                        "status": "status",
                    },
                    "work_order_operations_path": "operations",
                    "operation_field_map": {
                        "id": "id",
                        "work_order_id": "work_order_id",
                        "sequence": "sequence",
                        "name": "name",
                        "duration_minutes": "duration_minutes",
                        "eligible_machine_ids": "eligible_machine_ids",
                    },
                },
            },
            {
                "id": "transform",
                "block_type": "transform_snapshot",
                "name": "Transform Data",
                "input_block_id": "map-api",
                "config": {"operations": list(_DEFAULT_TRANSFORM_OPERATIONS)},
            },
            {
                "id": "enrich",
                "block_type": "enrich_with_master_data",
                "name": "Add Workspace Master Data",
                "input_block_id": "transform",
                "config": {},
            },
            {
                "id": "validate",
                "block_type": "validate_snapshot",
                "name": "Validate Data",
                "input_block_id": "enrich",
                "config": {},
            },
            {
                "id": "stop-on-bad",
                "block_type": "require_valid_snapshot",
                "name": "Stop On Bad Data",
                "input_block_id": "validate",
                "config": {},
            },
            {
                "id": "import",
                "block_type": "import_snapshot",
                "name": "Import To APS",
                "input_block_id": "stop-on-bad",
                "config": {},
            },
            {
                "id": "run-aps",
                "block_type": "run_scheduling_from_snapshot",
                "name": "Run APS",
                "input_block_id": "import",
                "config": {"horizon_days": 30, "heuristic": "edd", "strategy": "greedy"},
            },
        ),
    },
    {
        "key": "erp-return-delta",
        "title": "Send changed plan",
        "description": (
            "Export the latest published APS plan and send only changed "
            "orders back to ERP or MES."
        ),
        "outcome": (
            "Only changed planned orders and operations are sent to the "
            "external system."
        ),
        "source_system": "aps",
        "blocks": (
            {
                "id": "export-plan",
                "block_type": "export_published_plan",
                "name": "Export Published Plan",
                "input_block_id": None,
                "config": {"mode": "delta"},
            },
            {
                "id": "push-plan",
                "block_type": "push_published_plan_to_connector",
                "name": "Send Published Plan",
                "input_block_id": "export-plan",
                "config": {"connector_id": "", "request_method": "POST"},
            },
        ),
    },
    {
        "key": "erp-return-full",
        "title": "Send full plan",
        "description": (
            "Export the full published APS plan and send it to ERP or MES."
        ),
        "outcome": (
            "The full planner-approved schedule is sent to the external system."
        ),
        "source_system": "aps",
        "blocks": (
            {
                "id": "export-plan",
                "block_type": "export_published_plan",
                "name": "Export Published Plan",
                "input_block_id": None,
                "config": {"mode": "full"},
            },
            {
                "id": "push-plan",
                "block_type": "push_published_plan_to_connector",
                "name": "Send Published Plan",
                "input_block_id": "export-plan",
                "config": {"connector_id": "", "request_method": "POST"},
            },
        ),
    },
    {
        "key": "aps-database-export",
        "title": "APS to Database",
        "description": (
            "Export APS data, pick a row collection, map columns, then "
            "write it into a database table."
        ),
        "outcome": (
            "APS rows are delivered to a target database with a guided column map."
        ),
        "source_system": "aps",
        "blocks": (
            {
                "id": "export-snapshot",
                "block_type": "export_snapshot",
                "name": "Export APS Data",
                "input_block_id": None,
                "config": {},
            },
            {
                "id": "write-db",
                "block_type": "write_database_rows",
                "name": "Write To Database",
                "input_block_id": "export-snapshot",
                "config": {
                    "connector_id": "",
                    "table": "planned_orders",
                    "operation": "upsert",
                    "rows_path": "work_orders",
                    "match_columns": "order_id",
                    "preview_only": True,
                    "column_map": {
                        "order_id": "id",
                        "item_code": "product_id",
                        "qty": "quantity",
                        "due_at": "due_date",
                        "release_at": "release_date",
                        "status": "status",
                    },
                },
            },
        ),
    },
    {
        "key": "aps-sftp-export",
        "title": "APS to SFTP",
        "description": (
            "Export APS data, format it as a file, then drop it to an SFTP destination."
        ),
        "outcome": (
            "A JSON, XML, CSV, or text file is delivered to an SFTP folder."
        ),
        "source_system": "aps",
        "blocks": (
            {
                "id": "export-snapshot",
                "block_type": "export_snapshot",
                "name": "Export APS Data",
                "input_block_id": None,
                "config": {},
            },
            {
                "id": "format",
                "block_type": "format_payload",
                "name": "Format Data",
                "input_block_id": "export-snapshot",
                "config": {"format": "json", "file_name": "aps-snapshot.json"},
            },
            {
                "id": "send-sftp",
                "block_type": "send_sftp_file",
                "name": "Send To SFTP",
                "input_block_id": "format",
                "config": {
                    "connector_id": "",
                    "directory": "/outbound",
                    "file_name": "{{ input.file_name }}",
                    "preview_only": True,
                },
            },
        ),
    },
)
