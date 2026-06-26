"""Phase 6 — runtime semantics of logic_branch_if / switch / merge.

Slice C: branch blocks activate one outgoing edge type; the DAG runner
skips downstream blocks whose incoming edge wasn't activated and emits a
status='skipped' trace row. Merge picks the first non-null upstream
whose matching edge_type was activated.
"""

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
    def request(self, request):  # pragma: no cover - never used by these tests
        raise NotImplementedError


@pytest.fixture
def runner_factory():
    """Build a RunIntegrationFlow wired to fresh in-memory repos."""

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


def _branch_flow(*, expected_value: str | None) -> IntegrationFlow:
    """Build a Trigger → If → (true:Export, false:Export) flow."""
    return IntegrationFlow(
        id="flow-branch",
        name="branch test",
        source_system="studio_v2",
        organization_id="org-a",
        blocks=[
            IntegrationFlowBlock(id="t", block_type="trigger_manual"),
            IntegrationFlowBlock(
                id="if1",
                block_type="logic_branch_if",
                inputs=[FlowBlockInput(source_block_id="t", edge_type="data")],
                config={
                    "condition_path": "$.via",
                    **({"expected_value": expected_value} if expected_value else {}),
                },
            ),
            IntegrationFlowBlock(
                id="t-side",
                block_type="export_snapshot",
                inputs=[FlowBlockInput(source_block_id="if1", edge_type="branch_true")],
            ),
            IntegrationFlowBlock(
                id="f-side",
                block_type="export_snapshot",
                inputs=[FlowBlockInput(source_block_id="if1", edge_type="branch_false")],
            ),
        ],
    )


def test_branch_if_activates_true_branch_when_expected_value_matches(runner_factory):
    runner, flows = runner_factory()
    flows.save(_branch_flow(expected_value="manual"))
    output = runner.execute(
        RunIntegrationFlowInput(
            flow_id="flow-branch",
            organization_id="org-a",
            workspace_id=None,
        )
    )
    statuses = {r.block_id: r.status for r in output.block_results}
    assert statuses["t"] == "ready"
    assert statuses["if1"] == "ready"
    assert statuses["t-side"] == "ready"
    assert statuses["f-side"] == "skipped"


def test_branch_if_activates_false_branch_when_expected_value_mismatches(runner_factory):
    runner, flows = runner_factory()
    flows.save(_branch_flow(expected_value="schedule"))
    output = runner.execute(
        RunIntegrationFlowInput(
            flow_id="flow-branch",
            organization_id="org-a",
            workspace_id=None,
        )
    )
    statuses = {r.block_id: r.status for r in output.block_results}
    assert statuses["t-side"] == "skipped"
    assert statuses["f-side"] == "ready"


def test_branch_if_truthy_check_when_expected_value_omitted(runner_factory):
    """No expected_value → truthy check on the resolved path value.

    trigger_manual emits {via: "manual", ...}, so $.via resolves to "manual"
    which is truthy → branch_true wins.
    """
    runner, flows = runner_factory()
    flows.save(_branch_flow(expected_value=None))
    output = runner.execute(
        RunIntegrationFlowInput(
            flow_id="flow-branch",
            organization_id="org-a",
            workspace_id=None,
        )
    )
    statuses = {r.block_id: r.status for r in output.block_results}
    assert statuses["t-side"] == "ready"
    assert statuses["f-side"] == "skipped"


def test_branch_switch_routes_matching_case(runner_factory):
    runner, flows = runner_factory()
    flow = IntegrationFlow(
        id="flow-switch",
        name="switch test",
        source_system="studio_v2",
        organization_id="org-a",
        blocks=[
            IntegrationFlowBlock(id="t", block_type="trigger_manual"),
            IntegrationFlowBlock(
                id="sw",
                block_type="logic_branch_switch",
                inputs=[FlowBlockInput(source_block_id="t", edge_type="data")],
                config={
                    "condition_path": "$.via",
                    "cases": ["manual", "schedule"],
                },
            ),
        ],
    )
    flows.save(flow)
    output = runner.execute(
        RunIntegrationFlowInput(
            flow_id="flow-switch",
            organization_id="org-a",
            workspace_id=None,
        )
    )
    sw = next(r for r in output.block_results if r.block_id == "sw")
    assert sw.status == "ready"
    assert sw.output_summary is not None
    # Switch carries the matched case + branch_decision in its output.
    assert "manual" in (sw.message or "")


def test_merge_forwards_first_non_null_upstream(runner_factory):
    """Merge runs even when one of its upstream branches was skipped."""
    runner, flows = runner_factory()
    flow = IntegrationFlow(
        id="flow-merge",
        name="merge test",
        source_system="studio_v2",
        organization_id="org-a",
        blocks=[
            IntegrationFlowBlock(id="t", block_type="trigger_manual"),
            IntegrationFlowBlock(
                id="if1",
                block_type="logic_branch_if",
                inputs=[FlowBlockInput(source_block_id="t", edge_type="data")],
                config={"condition_path": "$.via", "expected_value": "manual"},
            ),
            IntegrationFlowBlock(
                id="left",
                block_type="export_snapshot",
                inputs=[FlowBlockInput(source_block_id="if1", edge_type="branch_true")],
            ),
            IntegrationFlowBlock(
                id="right",
                block_type="export_snapshot",
                inputs=[
                    FlowBlockInput(source_block_id="if1", edge_type="branch_false")
                ],
            ),
            IntegrationFlowBlock(
                id="m",
                block_type="logic_merge",
                inputs=[
                    FlowBlockInput(source_block_id="left", edge_type="data"),
                    FlowBlockInput(source_block_id="right", edge_type="data"),
                ],
            ),
        ],
    )
    flows.save(flow)
    output = runner.execute(
        RunIntegrationFlowInput(
            flow_id="flow-merge",
            organization_id="org-a",
            workspace_id=None,
        )
    )
    statuses = {r.block_id: r.status for r in output.block_results}
    assert statuses["left"] == "ready"
    assert statuses["right"] == "skipped"
    assert statuses["m"] == "ready", "merge must run even when a sibling is skipped"
