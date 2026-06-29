"""Phase 7 — error edges activate downstream handlers when a block fails."""

from __future__ import annotations

import pytest

from planiadvance_v2.application.ports import (
    FlowBlockInput,
    IntegrationFlow,
    IntegrationFlowBlock,
)
from planiadvance_v2.application.use_cases import (
    ExportPlanningSnapshot,
    ExportPublishedPlan,
    ImportPlanningSnapshot,
    RunIntegrationFlow,
    RunSchedulingFromSnapshot,
)
from planiadvance_v2.application.use_cases.integration_flows import (
    RunIntegrationFlowInput,
)
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
from planiadvance_v2.infrastructure.integration_http import (
    EnvIntegrationSecretResolver,
)


class _NullHttpTransport:
    def request(self, request):  # pragma: no cover
        raise NotImplementedError


@pytest.fixture
def runner_factory():
    """Build RunIntegrationFlow wired to fresh in-memory repos."""

    def _build():
        flows = InMemoryIntegrationFlowRepository()
        journal = InMemoryIntegrationJournalRepository()
        calendars = InMemoryCalendarRepository()
        machines = InMemoryMachineRepository()
        work_orders = InMemoryWorkOrderRepository()
        resources = InMemoryResourceRepository()
        inventory = InMemoryInventoryRepository()
        supplies = InMemorySupplyRepository()
        bindings = InMemoryIntegrationBindingRepository()
        connectors = InMemoryIntegrationConnectorRepository()
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
            http_transport=_NullHttpTransport(),
        )
        return runner, flows

    return _build


def _failing_call_api_block(block_id: str, *, source_block_id: str) -> IntegrationFlowBlock:
    """A call_connector_api block referencing a connector that does not exist
    in the in-memory store. The runner raises during its readiness probe."""
    return IntegrationFlowBlock(
        id=block_id,
        block_type="call_connector_api",
        inputs=[FlowBlockInput(source_block_id=source_block_id, edge_type="data")],
        config={
            "connector_id": "missing-connector",
            "target_path": "/whatever",
        },
    )


def test_block_failure_with_error_edge_runs_handler_and_completes(runner_factory):
    """When the upstream block raises and there is an outgoing error edge,
    the runner activates that edge instead of failing the flow."""
    runner, flows = runner_factory()
    flow = IntegrationFlow(
        id="flow-err-1",
        name="error edge happy path",
        source_system="studio_v2",
        organization_id="org-a",
        blocks=[
            IntegrationFlowBlock(id="t", block_type="trigger_manual"),
            _failing_call_api_block("boom", source_block_id="t"),
            IntegrationFlowBlock(
                id="catch",
                block_type="error_handler",
                inputs=[FlowBlockInput(source_block_id="boom", edge_type="error")],
            ),
        ],
    )
    flows.save(flow)
    out = runner.execute(
        RunIntegrationFlowInput(
            flow_id="flow-err-1",
            organization_id="org-a",
            workspace_id=None,
        )
    )
    statuses = {r.block_id: r.status for r in out.block_results}
    assert statuses["t"] == "ready"
    assert statuses["boom"] == "failed"
    assert statuses["catch"] == "ready", "error edge must activate the handler"
    assert out.status == "completed_with_errors"


def test_block_failure_without_error_edge_fails_the_flow(runner_factory):
    """No error consumer → today's behaviour: flow status='failed'."""
    runner, flows = runner_factory()
    flow = IntegrationFlow(
        id="flow-err-2",
        name="error path bare",
        source_system="studio_v2",
        organization_id="org-a",
        blocks=[
            IntegrationFlowBlock(id="t", block_type="trigger_manual"),
            _failing_call_api_block("boom", source_block_id="t"),
        ],
    )
    flows.save(flow)
    out = runner.execute(
        RunIntegrationFlowInput(
            flow_id="flow-err-2",
            organization_id="org-a",
            workspace_id=None,
        )
    )
    assert out.status == "failed"


def test_retry_exhausted_routes_to_error_edge(runner_factory):
    """A block configured to retry 3x still fails → error edge fires once."""
    runner, flows = runner_factory()
    flow = IntegrationFlow(
        id="flow-retry-fail",
        name="retry then error",
        source_system="studio_v2",
        organization_id="org-a",
        blocks=[
            IntegrationFlowBlock(id="t", block_type="trigger_manual"),
            IntegrationFlowBlock(
                id="boom",
                block_type="call_connector_api",
                inputs=[FlowBlockInput(source_block_id="t", edge_type="data")],
                config={
                    "connector_id": "missing-connector",
                    "target_path": "/whatever",
                    "retry_max_attempts": 3,
                    "retry_backoff_seconds": 0.0,
                },
            ),
            IntegrationFlowBlock(
                id="catch",
                block_type="error_handler",
                inputs=[FlowBlockInput(source_block_id="boom", edge_type="error")],
            ),
        ],
    )
    flows.save(flow)
    out = runner.execute(
        RunIntegrationFlowInput(
            flow_id="flow-retry-fail",
            organization_id="org-a",
            workspace_id=None,
        )
    )
    statuses = {r.block_id: r.status for r in out.block_results}
    assert statuses["boom"] == "failed"
    assert statuses["catch"] == "ready"
    assert out.status == "completed_with_errors"


def test_error_handler_emits_envelope_with_failing_block_id(runner_factory):
    runner, flows = runner_factory()
    flow = IntegrationFlow(
        id="flow-err-3",
        name="error envelope",
        source_system="studio_v2",
        organization_id="org-a",
        blocks=[
            IntegrationFlowBlock(id="t", block_type="trigger_manual"),
            _failing_call_api_block("boom", source_block_id="t"),
            IntegrationFlowBlock(
                id="catch",
                block_type="error_handler",
                inputs=[FlowBlockInput(source_block_id="boom", edge_type="error")],
            ),
        ],
    )
    flows.save(flow)
    out = runner.execute(
        RunIntegrationFlowInput(
            flow_id="flow-err-3",
            organization_id="org-a",
            workspace_id=None,
        )
    )
    catch = next(r for r in out.block_results if r.block_id == "catch")
    assert catch.status == "ready"
    # The handler's input is the upstream error envelope.
    preview = catch.input_preview or {}
    assert preview.get("kind") == "error_envelope"
    assert preview.get("failed_block_id") == "boom"
    assert preview.get("failed_block_type") == "call_connector_api"
