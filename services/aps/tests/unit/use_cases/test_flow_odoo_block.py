"""Odoo slice 1C: odoo_search_read catalog entry + dispatch runtime.

The block reads records from an Odoo model via JSON-RPC search_read.
It re-uses the existing IntegrationHttpTransport for the actual HTTP
call and the SecretResolver to unseal the API key out of the saved
connector. Output shape mirrors call_connector_api ("api_response")
so map_api_response_to_snapshot downstream still works unchanged.
"""

from __future__ import annotations

import json

import pytest

from planiadvance_v2.application.ports import (
    FlowBlockInput,
    IntegrationConnector,
    IntegrationFlow,
    IntegrationFlowBlock,
    IntegrationHttpResponse,
)
from planiadvance_v2.application.use_cases import (
    ExportPlanningSnapshot,
    ExportPublishedPlan,
    ImportPlanningSnapshot,
    RunIntegrationFlow,
    RunSchedulingFromSnapshot,
)
from planiadvance_v2.application.use_cases.integration_flows import (
    FLOW_BLOCK_CATALOG,
    FLOW_BLOCK_TYPES_REQUIRING_INPUT,
    RunIntegrationFlowInput,
    TestFlowBlockInput,
)
from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryCalendarRepository,
    InMemoryIntegrationBindingRepository,
    InMemoryIntegrationConnectorRepository,
    InMemoryIntegrationFlowRepository,
    InMemoryIntegrationJournalRepository,
    InMemoryInventoryRepository,
    InMemoryMachineRepository,
    InMemoryResourceRepository,
    InMemoryScheduleRepository,
    InMemorySupplyRepository,
    InMemoryWorkOrderRepository,
)
from planiadvance_v2.infrastructure.integration_http import EnvIntegrationSecretResolver


class _RecordingHttpTransport:
    def __init__(self) -> None:
        self.requests: list = []
        self._responses: list[IntegrationHttpResponse] = []

    def queue_json(self, payload: object, *, status_code: int = 200) -> None:
        self._responses.append(
            IntegrationHttpResponse(
                status_code=status_code,
                headers={"content-type": "application/json"},
                body=json.dumps(payload).encode("utf-8"),
            )
        )

    def send(self, request):
        self.requests.append(request)
        if not self._responses:
            raise AssertionError(
                f"No response queued for {request.method} {request.url}"
            )
        return self._responses.pop(0)


@pytest.fixture
def odoo_runner(monkeypatch):
    monkeypatch.setenv("ODOO_API_KEY", "test-api-key")

    flows = InMemoryIntegrationFlowRepository()
    connectors = InMemoryIntegrationConnectorRepository()
    transport = _RecordingHttpTransport()

    journal = InMemoryIntegrationJournalRepository()
    calendars = InMemoryCalendarRepository()
    machines = InMemoryMachineRepository()
    work_orders = InMemoryWorkOrderRepository()
    resources = InMemoryResourceRepository()
    inventory = InMemoryInventoryRepository()
    supplies = InMemorySupplyRepository()
    bindings = InMemoryIntegrationBindingRepository()
    schedules = InMemoryScheduleRepository()
    runner = RunIntegrationFlow(
        flows=flows,
        journal=journal,
        exporter=ExportPlanningSnapshot(
            work_orders=work_orders,
            machines=machines,
            calendars=calendars,
            resources=resources,
            inventory=inventory,
            supplies=supplies,
        ),
        plan_exporter=ExportPublishedPlan(schedules=schedules),
        importer=ImportPlanningSnapshot(
            calendars=calendars,
            machines=machines,
            resources=resources,
            work_orders=work_orders,
            inventory=inventory,
            supplies=supplies,
            bindings=bindings,
        ),
        scheduler=RunSchedulingFromSnapshot(),
        connectors=connectors,
        secret_resolver=EnvIntegrationSecretResolver(),
        http_transport=transport,
    )
    return runner, flows, connectors, transport


def _seed_odoo_connector(
    connectors,
    *,
    connector_id: str = "icn-odoo-test",
    endpoint_url: str = "http://odoo:8069/planiadvance_test",
    connector_type: str = "odoo",
) -> IntegrationConnector:
    connector = IntegrationConnector(
        id=connector_id,
        name="Odoo test",
        endpoint_url=endpoint_url,
        source_system="odoo-17",
        organization_id="org-a",
        connector_type=connector_type,
        method="POST",
        auth_type="basic",
        username="admin",
        secret_ref="env:ODOO_API_KEY",
    )
    connectors.save(connector)
    return connector


def _flow_with_odoo_read(*, config: dict) -> IntegrationFlow:
    return IntegrationFlow(
        id="flow-odoo",
        name="odoo read",
        source_system="studio_v2",
        organization_id="org-a",
        blocks=[
            IntegrationFlowBlock(id="t", block_type="trigger_manual"),
            IntegrationFlowBlock(
                id="odoo",
                block_type="odoo_search_read",
                inputs=[FlowBlockInput(source_block_id="t", edge_type="data")],
                config=config,
            ),
        ],
    )


class TestOdooSearchReadCatalog:
    def test_block_is_registered_in_catalog(self):
        entries = [e for e in FLOW_BLOCK_CATALOG if e["block_type"] == "odoo_search_read"]
        assert len(entries) == 1

    def test_catalog_entry_uses_connector_picker_constrained_to_odoo(self):
        entry = next(
            e for e in FLOW_BLOCK_CATALOG if e["block_type"] == "odoo_search_read"
        )
        connector_field = next(
            f for f in entry["config_fields"] if f["key"] == "connector_id"
        )
        assert connector_field["field_type"] == "connector"
        assert connector_field["connector_type"] == "odoo"
        assert connector_field["required"] is True

    def test_catalog_entry_has_model_required_field(self):
        entry = next(
            e for e in FLOW_BLOCK_CATALOG if e["block_type"] == "odoo_search_read"
        )
        model_field = next(f for f in entry["config_fields"] if f["key"] == "model")
        assert model_field["required"] is True

    def test_catalog_entry_outputs_api_response_kind(self):
        entry = next(
            e for e in FLOW_BLOCK_CATALOG if e["block_type"] == "odoo_search_read"
        )
        assert entry["output_kind"] == "api_response"
        assert entry["category"] == "connector"


class TestOdooSearchReadDispatch:
    def test_happy_path_returns_records_from_odoo(self, odoo_runner):
        runner, flows, connectors, transport = odoo_runner
        _seed_odoo_connector(connectors)
        transport.queue_json({"jsonrpc": "2.0", "result": 7})  # authenticate
        transport.queue_json(
            {
                "jsonrpc": "2.0",
                "result": [
                    {"id": 1, "name": "WH/MO/00001", "product_qty": 5.0, "state": "confirmed"},
                    {"id": 2, "name": "WH/MO/00002", "product_qty": 5.0, "state": "confirmed"},
                ],
            }
        )
        flows.save(
            _flow_with_odoo_read(
                config={
                    "connector_id": "icn-odoo-test",
                    "model": "mrp.production",
                    "domain": [["state", "=", "confirmed"]],
                    "fields": ["name", "product_qty", "state"],
                    "limit": 50,
                }
            )
        )

        output = runner.execute(
            RunIntegrationFlowInput(
                flow_id="flow-odoo",
                organization_id="org-a",
                workspace_id=None,
            )
        )

        odoo_result = next(r for r in output.block_results if r.block_id == "odoo")
        assert odoo_result.status == "received"  # mirrors call_connector_api
        assert "mrp.production" in odoo_result.message
        assert "2" in odoo_result.message  # "2 record(s) read..."
        # 2 HTTP calls: 1 authenticate + 1 search_read
        assert len(transport.requests) == 2
        # Verify the search_read body addresses the right model with the right domain
        search_body = json.loads(transport.requests[1].body)
        args = search_body["params"]["args"]
        assert args[3] == "mrp.production"
        assert args[4] == "search_read"
        assert args[5] == [[["state", "=", "confirmed"]]]
        assert args[6]["fields"] == ["name", "product_qty", "state"]
        assert args[6]["limit"] == 50

    def test_rejects_missing_connector_id(self, odoo_runner):
        runner, flows, _connectors, _transport = odoo_runner
        flows.save(
            _flow_with_odoo_read(
                config={"model": "mrp.production"}
            )
        )

        output = runner.execute(
            RunIntegrationFlowInput(
                flow_id="flow-odoo",
                organization_id="org-a",
                workspace_id=None,
            )
        )
        odoo_result = next(r for r in output.block_results if r.block_id == "odoo")
        assert odoo_result.status == "failed"
        assert "connector_id" in (odoo_result.message or "").lower()

    def test_rejects_missing_model(self, odoo_runner):
        runner, flows, connectors, _transport = odoo_runner
        _seed_odoo_connector(connectors)
        flows.save(
            _flow_with_odoo_read(config={"connector_id": "icn-odoo-test"})
        )

        output = runner.execute(
            RunIntegrationFlowInput(
                flow_id="flow-odoo",
                organization_id="org-a",
                workspace_id=None,
            )
        )
        odoo_result = next(r for r in output.block_results if r.block_id == "odoo")
        assert odoo_result.status == "failed"
        assert "model" in (odoo_result.message or "").lower()

    def test_rejects_wrong_connector_type(self, odoo_runner):
        runner, flows, connectors, _transport = odoo_runner
        # Save an HTTP connector but reference it from the odoo block
        connectors.save(
            IntegrationConnector(
                id="icn-http-wrong",
                name="Wrong",
                endpoint_url="http://example.com",
                source_system="erp",
                organization_id="org-a",
                connector_type="http",
            )
        )
        flows.save(
            _flow_with_odoo_read(
                config={"connector_id": "icn-http-wrong", "model": "mrp.production"}
            )
        )

        output = runner.execute(
            RunIntegrationFlowInput(
                flow_id="flow-odoo",
                organization_id="org-a",
                workspace_id=None,
            )
        )
        odoo_result = next(r for r in output.block_results if r.block_id == "odoo")
        assert odoo_result.status == "failed"
        assert "odoo" in (odoo_result.message or "").lower()

    def test_rejects_missing_connector(self, odoo_runner):
        runner, flows, _connectors, _transport = odoo_runner
        flows.save(
            _flow_with_odoo_read(
                config={"connector_id": "icn-does-not-exist", "model": "mrp.production"}
            )
        )

        output = runner.execute(
            RunIntegrationFlowInput(
                flow_id="flow-odoo",
                organization_id="org-a",
                workspace_id=None,
            )
        )
        odoo_result = next(r for r in output.block_results if r.block_id == "odoo")
        assert odoo_result.status == "failed"
        assert "not found" in (odoo_result.message or "").lower()

    def test_propagates_odoo_rpc_error_as_block_failure(self, odoo_runner):
        runner, flows, connectors, transport = odoo_runner
        _seed_odoo_connector(connectors)
        transport.queue_json({"jsonrpc": "2.0", "result": 7})  # authenticate
        transport.queue_json(
            {
                "jsonrpc": "2.0",
                "error": {
                    "code": 200,
                    "message": "Odoo Server",
                    "data": {"name": "ValidationError", "message": "model not found"},
                },
            }
        )
        flows.save(
            _flow_with_odoo_read(
                config={"connector_id": "icn-odoo-test", "model": "bad.model"}
            )
        )

        output = runner.execute(
            RunIntegrationFlowInput(
                flow_id="flow-odoo",
                organization_id="org-a",
                workspace_id=None,
            )
        )
        odoo_result = next(r for r in output.block_results if r.block_id == "odoo")
        assert odoo_result.status == "failed"
        assert "validationerror" in (odoo_result.message or "").lower() \
            or "model not found" in (odoo_result.message or "").lower()


def _flow_with_planning_snapshot(*, config: dict) -> IntegrationFlow:
    return IntegrationFlow(
        id="flow-odoo-snap",
        name="odoo planning snapshot",
        source_system="studio_v2",
        organization_id="org-a",
        blocks=[
            IntegrationFlowBlock(id="t", block_type="trigger_manual"),
            IntegrationFlowBlock(
                id="snap",
                block_type="odoo_planning_snapshot",
                inputs=[FlowBlockInput(source_block_id="t", edge_type="data")],
                config=config,
            ),
        ],
    )


class TestOdooPlanningSnapshotCatalog:
    def test_block_is_registered_in_catalog(self):
        entries = [
            e for e in FLOW_BLOCK_CATALOG if e["block_type"] == "odoo_planning_snapshot"
        ]
        assert len(entries) == 1

    def test_outputs_snapshot_kind_so_downstream_validate_block_fits(self):
        entry = next(
            e for e in FLOW_BLOCK_CATALOG if e["block_type"] == "odoo_planning_snapshot"
        )
        assert entry["output_kind"] == "snapshot"

    def test_connector_picker_filtered_to_odoo(self):
        entry = next(
            e for e in FLOW_BLOCK_CATALOG if e["block_type"] == "odoo_planning_snapshot"
        )
        connector_field = next(
            f for f in entry["config_fields"] if f["key"] == "connector_id"
        )
        assert connector_field["connector_type"] == "odoo"
        assert connector_field["required"] is True


class TestOdooPlanningSnapshotDispatch:
    def test_pulls_minimal_odoo_and_emits_snapshot_envelope(self, odoo_runner):
        runner, flows, connectors, transport = odoo_runner
        _seed_odoo_connector(connectors)
        # 5 search_reads + 1 authenticate
        transport.queue_json({"jsonrpc": "2.0", "result": 7})  # authenticate
        transport.queue_json(  # mrp.production
            {
                "jsonrpc": "2.0",
                "result": [
                    {
                        "id": 1,
                        "name": "WH/MO/00001",
                        "product_id": [42, "Palette"],
                        "product_qty": 5.0,
                        "state": "confirmed",
                        "date_start": "2026-05-15 08:00:00",
                        "date_finished": "2026-05-15 17:00:00",
                        "priority": "0",
                    }
                ],
            }
        )
        transport.queue_json({"jsonrpc": "2.0", "result": []})  # no workorders
        transport.queue_json({"jsonrpc": "2.0", "result": []})  # no workcenters
        transport.queue_json(  # resource.calendar
            {"jsonrpc": "2.0", "result": [{"id": 1000, "name": "Standard"}]}
        )
        transport.queue_json({"jsonrpc": "2.0", "result": []})  # no attendances
        flows.save(
            _flow_with_planning_snapshot(
                config={
                    "connector_id": "icn-odoo-test",
                    "mo_domain": [],
                    "default_operation_duration_minutes": 120,
                }
            )
        )

        output = runner.execute(
            RunIntegrationFlowInput(
                flow_id="flow-odoo-snap",
                organization_id="org-a",
                workspace_id=None,
            )
        )

        snap_result = next(r for r in output.block_results if r.block_id == "snap")
        assert snap_result.status == "mapped"
        assert "1 MO" in (snap_result.message or "")
        # 1 auth + 5 search_reads = 6
        assert len(transport.requests) == 6

    def test_rejects_missing_connector_id(self, odoo_runner):
        runner, flows, _connectors, _transport = odoo_runner
        flows.save(
            _flow_with_planning_snapshot(config={"default_operation_duration_minutes": 60})
        )
        output = runner.execute(
            RunIntegrationFlowInput(
                flow_id="flow-odoo-snap",
                organization_id="org-a",
                workspace_id=None,
            )
        )
        snap_result = next(r for r in output.block_results if r.block_id == "snap")
        assert snap_result.status == "failed"
        assert "connector_id" in (snap_result.message or "").lower()

    def test_rejects_wrong_connector_type(self, odoo_runner):
        runner, flows, connectors, _transport = odoo_runner
        connectors.save(
            IntegrationConnector(
                id="icn-http-wrong",
                name="Wrong",
                endpoint_url="http://example.com",
                source_system="erp",
                organization_id="org-a",
                connector_type="http",
            )
        )
        flows.save(
            _flow_with_planning_snapshot(
                config={"connector_id": "icn-http-wrong"}
            )
        )
        output = runner.execute(
            RunIntegrationFlowInput(
                flow_id="flow-odoo-snap",
                organization_id="org-a",
                workspace_id=None,
            )
        )
        snap_result = next(r for r in output.block_results if r.block_id == "snap")
        assert snap_result.status == "failed"
        assert "odoo" in (snap_result.message or "").lower()


# ---------------------------------------------------------------------------
# Slice 3: PUSH back — odoo_push_schedule
# ---------------------------------------------------------------------------


def _flow_with_push_schedule(*, config: dict) -> IntegrationFlow:
    return IntegrationFlow(
        id="flow-odoo-push",
        name="odoo push schedule",
        source_system="studio_v2",
        organization_id="org-a",
        blocks=[
            IntegrationFlowBlock(id="t", block_type="trigger_manual"),
            IntegrationFlowBlock(
                id="push",
                block_type="odoo_push_schedule",
                inputs=[FlowBlockInput(source_block_id="t", edge_type="data")],
                config=config,
            ),
        ],
    )


def _published_plan_envelope() -> dict:
    return {
        "kind": "published_plan",
        "plan": {
            "work_orders": [
                {
                    "work_order_id": "wo-1",
                    "external_ref": "1",
                    "operations": [
                        {
                            "operation_id": "op-1",
                            "external_ref": "10",
                            "planned_start": "2026-05-15T08:00:00",
                            "planned_end": "2026-05-15T10:00:00",
                        },
                        {
                            "operation_id": "op-2",
                            "external_ref": "11",
                            "planned_start": "2026-05-15T10:00:00",
                            "planned_end": "2026-05-15T12:00:00",
                        },
                    ],
                }
            ]
        },
        "plan_hash": "deadbeef",
    }


class TestOdooPushScheduleCatalog:
    def test_block_is_registered(self):
        entries = [
            e for e in FLOW_BLOCK_CATALOG if e["block_type"] == "odoo_push_schedule"
        ]
        assert len(entries) == 1

    def test_outputs_connector_delivery(self):
        entry = next(
            e for e in FLOW_BLOCK_CATALOG if e["block_type"] == "odoo_push_schedule"
        )
        assert entry["output_kind"] == "connector_delivery"

    def test_requires_input_so_test_block_validates_published_plan(self):
        assert "odoo_push_schedule" in FLOW_BLOCK_TYPES_REQUIRING_INPUT

    def test_connector_picker_filtered_to_odoo(self):
        entry = next(
            e for e in FLOW_BLOCK_CATALOG if e["block_type"] == "odoo_push_schedule"
        )
        connector_field = next(
            f for f in entry["config_fields"] if f["key"] == "connector_id"
        )
        assert connector_field["connector_type"] == "odoo"
        assert connector_field["required"] is True


class TestOdooPushScheduleDispatch:
    def test_writes_one_mo_and_two_workorders_back_to_odoo(self, odoo_runner):
        runner, flows, connectors, transport = odoo_runner
        _seed_odoo_connector(connectors)
        # authenticate + 3 writes (1 MO + 2 workorders)
        transport.queue_json({"jsonrpc": "2.0", "result": 7})
        transport.queue_json({"jsonrpc": "2.0", "result": True})
        transport.queue_json({"jsonrpc": "2.0", "result": True})
        transport.queue_json({"jsonrpc": "2.0", "result": True})
        flows.save(_flow_with_push_schedule(config={"connector_id": "icn-odoo-test"}))

        result = runner.test_block(
            TestFlowBlockInput(
                flow_id="flow-odoo-push",
                block_id="push",
                organization_id="org-a",
                input_value=_published_plan_envelope(),
            )
        )

        assert result.status == "delivered"
        assert "1 MO" in (result.message or "") and "2 workorder" in (result.message or "")
        # 1 auth + 3 writes
        assert len(transport.requests) == 4
        # First write target should be mrp.production
        write1_body = json.loads(transport.requests[1].body.decode("utf-8"))
        assert write1_body["params"]["args"][3] == "mrp.production"
        assert write1_body["params"]["args"][4] == "write"
        # Vals for the MO carry the min/max window
        vals = write1_body["params"]["args"][5][1]
        assert vals.get("date_start") == "2026-05-15 08:00:00"
        assert vals.get("date_finished") == "2026-05-15 12:00:00"

    def test_succeeds_with_zero_writes_when_plan_has_no_external_refs(self, odoo_runner):
        runner, flows, connectors, transport = odoo_runner
        _seed_odoo_connector(connectors)
        flows.save(_flow_with_push_schedule(config={"connector_id": "icn-odoo-test"}))

        plan = _published_plan_envelope()
        for wo in plan["plan"]["work_orders"]:
            wo["external_ref"] = None
            for op in wo["operations"]:
                op["external_ref"] = None

        result = runner.test_block(
            TestFlowBlockInput(
                flow_id="flow-odoo-push",
                block_id="push",
                organization_id="org-a",
                input_value=plan,
            )
        )

        assert result.status == "delivered"
        assert "no Odoo-bound records" in (result.message or "")
        # No HTTP call at all (not even authenticate)
        assert transport.requests == []

    def test_rejects_missing_connector_id(self, odoo_runner):
        runner, flows, _connectors, _transport = odoo_runner
        flows.save(_flow_with_push_schedule(config={}))

        with pytest.raises(ValidationError) as exc_info:
            runner.test_block(
                TestFlowBlockInput(
                    flow_id="flow-odoo-push",
                    block_id="push",
                    organization_id="org-a",
                    input_value=_published_plan_envelope(),
                )
            )
        assert "connector_id" in str(exc_info.value).lower()

    def test_rejects_wrong_connector_type(self, odoo_runner):
        runner, flows, connectors, _transport = odoo_runner
        connectors.save(
            IntegrationConnector(
                id="icn-http-wrong",
                name="Wrong",
                endpoint_url="http://example.com",
                source_system="erp",
                organization_id="org-a",
                connector_type="http",
            )
        )
        flows.save(_flow_with_push_schedule(config={"connector_id": "icn-http-wrong"}))

        with pytest.raises(ValidationError) as exc_info:
            runner.test_block(
                TestFlowBlockInput(
                    flow_id="flow-odoo-push",
                    block_id="push",
                    organization_id="org-a",
                    input_value=_published_plan_envelope(),
                )
            )
        assert "odoo" in str(exc_info.value).lower()

    def test_surfaces_odoo_rpc_failure_clearly(self, odoo_runner):
        """V1.2 P0.3b — every record's outcome is collected before the
        block raises, so the planner sees a per-record breakdown instead
        of just the first opaque OdooClientError. Here all 3 writes
        (1 production + 2 workorders) fail with the same error."""

        runner, flows, connectors, transport = odoo_runner
        _seed_odoo_connector(connectors)
        # authenticate ok, then 3 failed writes (the loop runs to
        # completion instead of bailing on the first failure).
        transport.queue_json({"jsonrpc": "2.0", "result": 7})
        for _ in range(3):
            transport.queue_json(
                {
                    "jsonrpc": "2.0",
                    "error": {
                        "code": 200,
                        "message": "Odoo Server",
                        "data": {"name": "ValidationError", "message": "field locked"},
                    },
                }
            )
        flows.save(_flow_with_push_schedule(config={"connector_id": "icn-odoo-test"}))

        with pytest.raises(ValidationError) as exc_info:
            runner.test_block(
                TestFlowBlockInput(
                    flow_id="flow-odoo-push",
                    block_id="push",
                    organization_id="org-a",
                    input_value=_published_plan_envelope(),
                )
            )
        message = str(exc_info.value).lower()
        # Per-record summary: 0 OK, 3 failed, with the first cause
        # rendered inline.
        assert "partially failed" in message
        assert "0 ok" in message
        assert "3 failed" in message
        assert "field locked" in message

    def test_partial_failure_surfaces_breakdown(self, odoo_runner):
        """V1.2 P0.3b — when only some writes fail, the message gives
        the planner enough info to act: count of OK vs failed plus
        which records broke. This is the realistic ERP failure mode
        (a stale ID or a freeze flag on one MO out of many)."""

        runner, flows, connectors, transport = odoo_runner
        _seed_odoo_connector(connectors)
        transport.queue_json({"jsonrpc": "2.0", "result": 7})
        # 3 writes total: production succeeds, first workorder fails,
        # second workorder succeeds. The block still raises (preserves
        # the existing "any failure fails the block" contract for
        # retry + error-edge handling), but the message is informative.
        transport.queue_json({"jsonrpc": "2.0", "result": True})  # MO write
        transport.queue_json(
            {
                "jsonrpc": "2.0",
                "error": {
                    "code": 200,
                    "data": {"name": "ValidationError", "message": "date_start invalid"},
                },
            }
        )
        transport.queue_json({"jsonrpc": "2.0", "result": True})  # second WO write
        flows.save(_flow_with_push_schedule(config={"connector_id": "icn-odoo-test"}))

        with pytest.raises(ValidationError) as exc_info:
            runner.test_block(
                TestFlowBlockInput(
                    flow_id="flow-odoo-push",
                    block_id="push",
                    organization_id="org-a",
                    input_value=_published_plan_envelope(),
                )
            )
        message = str(exc_info.value).lower()
        assert "partially failed" in message
        assert "2 ok" in message
        assert "1 failed" in message
        # The actual failing op is identified by model + id so the
        # planner doesn't have to dig through the journal.
        assert "mrp.workorder" in message
        assert "date_start invalid" in message

    def test_success_path_surfaces_per_record_results(self, odoo_runner):
        """V1.2 P0.3b — the success payload now includes a per_record_results
        list so the audit/journal shows exactly which Odoo IDs were
        touched, even when nothing failed. The pilot replay tool relies
        on this to reconstruct what hit Odoo on a given flow run."""

        runner, flows, connectors, transport = odoo_runner
        _seed_odoo_connector(connectors)
        transport.queue_json({"jsonrpc": "2.0", "result": 7})
        # All 3 writes succeed.
        for _ in range(3):
            transport.queue_json({"jsonrpc": "2.0", "result": True})
        flows.save(_flow_with_push_schedule(config={"connector_id": "icn-odoo-test"}))

        result = runner.test_block(
            TestFlowBlockInput(
                flow_id="flow-odoo-push",
                block_id="push",
                organization_id="org-a",
                input_value=_published_plan_envelope(),
            )
        )
        output = result.output_preview
        assert output is not None
        assert output["written_records"] == 3
        per_record = output["per_record_results"]
        assert len(per_record) == 3
        assert all(r["status"] == "written" for r in per_record)
        # Both models are present: 1 production + 2 workorders.
        models = [r["model"] for r in per_record]
        assert models.count("mrp.production") == 1
        assert models.count("mrp.workorder") == 2
