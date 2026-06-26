"""Phase 6 — POST /flows/{id}/validate-graph use case tests."""

from __future__ import annotations

import pytest

from planiadvance_v2.application.ports import (
    FlowBlockInput,
    IntegrationFlow,
    IntegrationFlowBlock,
)
from planiadvance_v2.application.use_cases import (
    ValidateIntegrationFlowGraph,
    ValidateIntegrationFlowGraphInput,
)
from planiadvance_v2.domain.errors import ValidationError
from planiadvance_v2.infrastructure.in_memory.repositories import (
    InMemoryIntegrationFlowRepository,
)


def _flow(blocks, *, flow_id="f", org_id="org-A"):
    return IntegrationFlow(
        id=flow_id,
        name=flow_id,
        source_system="studio_v2",
        organization_id=org_id,
        blocks=blocks,
    )


def test_validate_graph_returns_no_issues_for_simple_dag():
    repo = InMemoryIntegrationFlowRepository()
    flow = _flow(
        [
            IntegrationFlowBlock(id="a", block_type="export_snapshot"),
            IntegrationFlowBlock(
                id="b",
                block_type="validate_snapshot",
                input_block_id="a",
            ),
        ]
    )
    repo.save(flow)

    use_case = ValidateIntegrationFlowGraph(repo)
    output = use_case.execute(
        ValidateIntegrationFlowGraphInput(flow_id="f", organization_id="org-A")
    )
    assert output.valid is True
    assert output.issues == []


def test_validate_graph_flags_cycle():
    repo = InMemoryIntegrationFlowRepository()
    flow = _flow(
        [
            IntegrationFlowBlock(
                id="a",
                block_type="logic_merge",
                inputs=[FlowBlockInput(source_block_id="b", edge_type="data")],
            ),
            IntegrationFlowBlock(
                id="b",
                block_type="logic_merge",
                inputs=[FlowBlockInput(source_block_id="a", edge_type="data")],
            ),
        ]
    )
    repo.save(flow)

    use_case = ValidateIntegrationFlowGraph(repo)
    output = use_case.execute(
        ValidateIntegrationFlowGraphInput(flow_id="f", organization_id="org-A")
    )
    assert output.valid is False
    cycle_issues = [i for i in output.issues if i.code == "cycle"]
    assert len(cycle_issues) >= 1
    assert {b for issue in cycle_issues for b in issue.block_ids} == {"a", "b"}


def test_validate_graph_flags_unknown_source():
    repo = InMemoryIntegrationFlowRepository()
    flow = _flow(
        [
            IntegrationFlowBlock(
                id="a",
                block_type="logic_merge",
                inputs=[FlowBlockInput(source_block_id="ghost", edge_type="data")],
            ),
        ]
    )
    repo.save(flow)

    use_case = ValidateIntegrationFlowGraph(repo)
    output = use_case.execute(
        ValidateIntegrationFlowGraphInput(flow_id="f", organization_id="org-A")
    )
    assert output.valid is False
    assert any(i.code == "unknown_source" for i in output.issues)


def test_validate_graph_flags_dangling_branch():
    """A branch_if with only one downstream branch consumer is a warning."""
    repo = InMemoryIntegrationFlowRepository()
    flow = _flow(
        [
            IntegrationFlowBlock(id="t", block_type="trigger_manual"),
            IntegrationFlowBlock(
                id="if1",
                block_type="logic_branch_if",
                inputs=[FlowBlockInput(source_block_id="t", edge_type="data")],
                config={"condition_path": "$.via"},
            ),
            IntegrationFlowBlock(
                id="t-side",
                block_type="export_snapshot",
                inputs=[
                    FlowBlockInput(source_block_id="if1", edge_type="branch_true")
                ],
            ),
            # Note: no block consumes branch_false → dangling.
        ]
    )
    repo.save(flow)

    use_case = ValidateIntegrationFlowGraph(repo)
    output = use_case.execute(
        ValidateIntegrationFlowGraphInput(flow_id="f", organization_id="org-A")
    )
    dangling = [i for i in output.issues if i.code == "dangling_branch"]
    assert len(dangling) == 1
    assert dangling[0].severity == "warning"
    # Warnings alone don't fail the graph.
    assert output.valid is True


def test_validate_graph_returns_404_on_cross_tenant_or_missing_flow():
    repo = InMemoryIntegrationFlowRepository()
    flow = _flow(
        [IntegrationFlowBlock(id="a", block_type="export_snapshot")],
        flow_id="f",
        org_id="org-A",
    )
    repo.save(flow)

    use_case = ValidateIntegrationFlowGraph(repo)
    with pytest.raises(ValidationError):
        use_case.execute(
            ValidateIntegrationFlowGraphInput(flow_id="f", organization_id="org-B")
        )
    with pytest.raises(ValidationError):
        use_case.execute(
            ValidateIntegrationFlowGraphInput(
                flow_id="missing", organization_id="org-A"
            )
        )
