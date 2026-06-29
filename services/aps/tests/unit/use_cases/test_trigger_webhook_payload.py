"""V1.2 P3 webhook ingress slice 2 — trigger_webhook block surfaces
the inbound JSON payload in its output.

Slice 1 proved the route + HMAC + dispatch chain. This test pins the
LAST mile: a flow whose ``trigger_webhook`` block runs under a
``RunIntegrationFlow.execute(trigger_payload=…)`` call must emit the
payload on its ``output_preview`` so downstream blocks can dereference
``$.payload.field``.

Without this, the webhook is "fake": it accepts the POST and runs the
flow but the inbound data never reaches the planner-modeled logic.
That's exactly the "feature not actually wired" case Sam called out.
"""

from __future__ import annotations

from planiadvance_v2.application.use_cases import (
    ExportPlanningSnapshot,
    ExportPublishedPlan,
    ImportPlanningSnapshot,
    RunIntegrationFlow,
    RunIntegrationFlowInput,
    RunSchedulingFromSnapshot,
)
from planiadvance_v2.application.use_cases.integration_flows import (
    IntegrationFlow,
    IntegrationFlowBlock,
)
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryCalendarRepository,
    InMemoryIntegrationBindingRepository,
    InMemoryIntegrationConnectorRepository,
    InMemoryIntegrationCredentialRepository,
    InMemoryIntegrationExecutionRepository,
    InMemoryIntegrationFlowRepository,
    InMemoryIntegrationJournalRepository,
    InMemoryInventoryRepository,
    InMemoryMachineRepository,
    InMemoryResourceRepository,
    InMemoryScheduleRepository,
    InMemorySupplyRepository,
    InMemoryWorkOrderRepository,
)


class _FixedSecretResolver:
    def resolve(self, ref):  # pragma: no cover - unused on this path
        return ""


class _NullHttpTransport:
    def request(self, request):  # pragma: no cover - unused on this path
        raise AssertionError("HTTP transport must not be invoked for trigger_webhook")


def _minimal_runner(flows_repo: InMemoryIntegrationFlowRepository) -> RunIntegrationFlow:
    """Wires the bare minimum a trigger_webhook-only flow needs.

    The block itself touches none of the network / DB adapters. The
    use case's bookkeeping (journal / execution record / flow run
    traces) still expects repo instances to call ``.save(...)`` on,
    so we wire in-memory twins that act as no-op sinks."""

    work_orders = InMemoryWorkOrderRepository([])
    machines = InMemoryMachineRepository([])
    calendars = InMemoryCalendarRepository([])
    resources = InMemoryResourceRepository([])
    inventory = InMemoryInventoryRepository([])
    supplies = InMemorySupplyRepository([])
    schedules = InMemoryScheduleRepository()
    bindings = InMemoryIntegrationBindingRepository()
    journal = InMemoryIntegrationJournalRepository()
    executions = InMemoryIntegrationExecutionRepository()
    connectors = InMemoryIntegrationConnectorRepository()
    credentials = InMemoryIntegrationCredentialRepository()
    return RunIntegrationFlow(
        flows=flows_repo,
        journal=journal,
        exporter=ExportPlanningSnapshot(
            work_orders=work_orders,
            machines=machines,
            calendars=calendars,
            resources=resources,
            inventory=inventory,
            supplies=supplies,
        ),
        plan_exporter=ExportPublishedPlan(schedules),
        importer=ImportPlanningSnapshot(
            work_orders=work_orders,
            machines=machines,
            calendars=calendars,
            resources=resources,
            inventory=inventory,
            supplies=supplies,
            bindings=bindings,
        ),
        scheduler=RunSchedulingFromSnapshot(),
        connectors=connectors,
        secret_resolver=_FixedSecretResolver(),
        http_transport=_NullHttpTransport(),
        credentials=credentials,
        executions=executions,
    )


def _flow_with_only_trigger_webhook() -> IntegrationFlow:
    return IntegrationFlow(
        id="flow-tw",
        name="Webhook trigger only",
        source_system="erp",
        organization_id="org-a",
        workspace_id="ws-a",
        is_enabled=True,
        blocks=[
            IntegrationFlowBlock(
                id="trig-1",
                block_type="trigger_webhook",
                name="Inbound",
                config={"secret": "test-secret-min-16-chars"},
            ),
        ],
    )


def test_trigger_webhook_output_includes_payload_when_provided() -> None:
    flows_repo = InMemoryIntegrationFlowRepository()
    flows_repo.save(_flow_with_only_trigger_webhook())
    runner = _minimal_runner(flows_repo)

    result = runner.execute(
        RunIntegrationFlowInput(
            flow_id="flow-tw",
            organization_id="org-a",
            workspace_id="ws-a",
            actor_details={"source": "test"},
            journal_action=None,
            trigger_payload={
                "work_orders": [{"id": "WO-001", "priority": "rush"}],
                "received_from": "odoo",
            },
        )
    )

    assert result.status == "completed"
    assert len(result.block_results) == 1
    block = result.block_results[0]
    assert block.block_type == "trigger_webhook"
    assert block.status == "ready"
    # The payload made it onto the block's output_preview, ready
    # for any downstream block to read via $.payload.field.
    output = block.output_preview
    assert output is not None
    assert output["kind"] == "trigger_event"
    assert output["via"] == "webhook"
    assert output["payload"] == {
        "work_orders": [{"id": "WO-001", "priority": "rush"}],
        "received_from": "odoo",
    }
    # Message reflects the with-payload branch — the planner reading
    # the trace can tell at a glance whether the trigger had data.
    assert "payload" in block.message.lower()


def test_trigger_webhook_omits_payload_when_none() -> None:
    """Backwards compat: Studio Run clicks + scheduled triggers
    don't carry a payload, so the block output must NOT contain a
    ``payload`` key (existing flows + tests rely on the legacy shape).
    """

    flows_repo = InMemoryIntegrationFlowRepository()
    flows_repo.save(_flow_with_only_trigger_webhook())
    runner = _minimal_runner(flows_repo)

    result = runner.execute(
        RunIntegrationFlowInput(
            flow_id="flow-tw",
            organization_id="org-a",
            workspace_id="ws-a",
            actor_details={"source": "test"},
            journal_action=None,
            # No trigger_payload — simulates a Studio "Run" click.
        )
    )

    block = result.block_results[0]
    output = block.output_preview
    assert output is not None
    assert "payload" not in output
    assert output["kind"] == "trigger_event"
    # Legacy "placeholder" message stays so existing trace UIs that
    # match on it keep working.
    assert "placeholder" in block.message.lower()
