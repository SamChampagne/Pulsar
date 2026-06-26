"""Phase 6 — DAG-aware block model + runner.

Slice A covers the catalog additions, the new FlowBlockInput dataclass,
and the round-trip through both InMemory and SQL repositories.
"""

from __future__ import annotations

from planiadvance_v2.application.ports import (
    FlowBlockInput,
    IntegrationFlow,
    IntegrationFlowBlock,
)
from planiadvance_v2.application.use_cases.integration_flows import FLOW_BLOCK_CATALOG

# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------


def test_catalog_registers_three_logic_blocks():
    """Phase 6 — Logic / If / Switch / Merge block_types are visible in the catalog."""
    by_type = {item["block_type"]: item for item in FLOW_BLOCK_CATALOG}

    assert "logic_branch_if" in by_type
    assert by_type["logic_branch_if"]["category"] == "logic"
    assert by_type["logic_branch_if"]["accepts_input"] is True
    assert by_type["logic_branch_if"]["output_kind"] == "branch_decision"

    assert "logic_branch_switch" in by_type
    assert by_type["logic_branch_switch"]["category"] == "logic"
    assert by_type["logic_branch_switch"]["accepts_input"] is True

    assert "logic_merge" in by_type
    assert by_type["logic_merge"]["category"] == "logic"
    assert by_type["logic_merge"]["accepts_input"] is True
    assert by_type["logic_merge"]["output_kind"] == "merge_passthrough"


# ---------------------------------------------------------------------------
# FlowBlockInput dataclass
# ---------------------------------------------------------------------------


def test_flow_block_input_default_edge_type_is_data():
    edge = FlowBlockInput(source_block_id="x")
    assert edge.edge_type == "data"
    assert edge.case_value is None


def test_integration_flow_block_supports_inputs_list():
    """Phase 6 — IntegrationFlowBlock carries a structured inputs list (DAG mode)."""
    block = IntegrationFlowBlock(
        id="b1",
        block_type="logic_merge",
        inputs=[
            FlowBlockInput(source_block_id="a", edge_type="data"),
            FlowBlockInput(source_block_id="b", edge_type="branch_true"),
        ],
    )
    assert len(block.inputs) == 2
    assert block.inputs[0].edge_type == "data"
    assert block.inputs[1].edge_type == "branch_true"
    assert block.input_block_id is None  # legacy field stays optional


def test_block_inputs_default_empty():
    block = IntegrationFlowBlock(id="b", block_type="export_snapshot")
    assert block.inputs == []


# ---------------------------------------------------------------------------
# Round-trip through repositories
# ---------------------------------------------------------------------------


def test_block_inputs_round_trip_through_in_memory_repo():
    """The InMemory repo must preserve `inputs` so DAG runs reload identical."""
    from planiadvance_v2.infrastructure.in_memory.repositories import (
        InMemoryIntegrationFlowRepository,
    )

    repo = InMemoryIntegrationFlowRepository()
    flow = IntegrationFlow(
        id="flow-1",
        name="Branch sample",
        source_system="studio_v2",
        blocks=[
            IntegrationFlowBlock(id="src", block_type="export_snapshot"),
            IntegrationFlowBlock(
                id="if1",
                block_type="logic_branch_if",
                inputs=[FlowBlockInput(source_block_id="src", edge_type="data")],
                config={"condition_path": "$.kind"},
            ),
            IntegrationFlowBlock(
                id="m",
                block_type="logic_merge",
                inputs=[
                    FlowBlockInput(source_block_id="if1", edge_type="branch_true"),
                    FlowBlockInput(source_block_id="if1", edge_type="branch_false"),
                ],
            ),
        ],
    )
    repo.save(flow)
    loaded = repo.get("flow-1")
    assert loaded is not None
    merge_block = next(b for b in loaded.blocks if b.id == "m")
    assert len(merge_block.inputs) == 2
    assert {e.edge_type for e in merge_block.inputs} == {"branch_true", "branch_false"}


def test_sql_repo_serializes_inputs():
    """SQL repo must serialize `inputs` into the JSON blob and deserialize back."""
    from planiadvance_v2.infrastructure.db.repositories.integration_flow_repository import (
        SqlIntegrationFlowRepository,
    )

    block = IntegrationFlowBlock(
        id="b1",
        block_type="logic_branch_if",
        inputs=[
            FlowBlockInput(source_block_id="up", edge_type="data"),
        ],
    )
    serialized = SqlIntegrationFlowRepository._block_to_json(block)
    assert serialized["inputs"] == [
        {"source_block_id": "up", "edge_type": "data", "case_value": None}
    ]


# ---------------------------------------------------------------------------
# Slice B — DAG construction + cycle detection
# ---------------------------------------------------------------------------


def test_build_dag_from_legacy_linear_chain():
    """Existing v1 flows have only input_block_id — _build_flow_dag promotes them."""
    from planiadvance_v2.application.use_cases.integration_flows import _build_flow_dag

    flow = IntegrationFlow(
        id="f",
        name="legacy",
        source_system="erp",
        blocks=[
            IntegrationFlowBlock(id="a", block_type="export_snapshot"),
            IntegrationFlowBlock(
                id="b",
                block_type="validate_snapshot",
                input_block_id="a",
            ),
        ],
    )
    dag = _build_flow_dag(flow)
    assert list(dag.keys()) == ["a", "b"]
    assert dag["a"] == []
    assert len(dag["b"]) == 1
    assert dag["b"][0].source_block_id == "a"
    assert dag["b"][0].edge_type == "data"


def test_build_dag_prefers_inputs_when_present():
    """When `inputs` is non-empty, it takes precedence over the legacy field."""
    from planiadvance_v2.application.use_cases.integration_flows import _build_flow_dag

    flow = IntegrationFlow(
        id="f",
        name="dag",
        source_system="studio_v2",
        blocks=[
            IntegrationFlowBlock(id="a", block_type="export_snapshot"),
            IntegrationFlowBlock(id="b", block_type="export_snapshot"),
            IntegrationFlowBlock(
                id="m",
                block_type="logic_merge",
                input_block_id="a",  # legacy hint, ignored when inputs present
                inputs=[
                    FlowBlockInput(source_block_id="a", edge_type="data"),
                    FlowBlockInput(source_block_id="b", edge_type="data"),
                ],
            ),
        ],
    )
    dag = _build_flow_dag(flow)
    assert {edge.source_block_id for edge in dag["m"]} == {"a", "b"}


def test_build_dag_falls_back_to_previous_block_when_input_required():
    """A v1 flow that uses implicit linear chaining (no input_block_id) keeps working."""
    from planiadvance_v2.application.use_cases.integration_flows import _build_flow_dag

    flow = IntegrationFlow(
        id="f",
        name="implicit",
        source_system="erp",
        blocks=[
            IntegrationFlowBlock(id="a", block_type="export_snapshot"),
            # No input_block_id, no inputs[] — but block_type requires input.
            IntegrationFlowBlock(id="b", block_type="validate_snapshot"),
        ],
    )
    dag = _build_flow_dag(flow)
    assert len(dag["b"]) == 1
    assert dag["b"][0].source_block_id == "a"


def test_detect_cycles_returns_offenders():
    """A 2-block cycle yields both block ids in the result."""
    from planiadvance_v2.application.use_cases.integration_flows import (
        _build_flow_dag,
        _detect_cycles,
    )

    flow = IntegrationFlow(
        id="f",
        name="cycle",
        source_system="studio_v2",
        blocks=[
            IntegrationFlowBlock(
                id="a",
                block_type="logic_merge",
                inputs=[FlowBlockInput(source_block_id="b")],
            ),
            IntegrationFlowBlock(
                id="b",
                block_type="logic_merge",
                inputs=[FlowBlockInput(source_block_id="a")],
            ),
        ],
    )
    dag = _build_flow_dag(flow)
    offenders = _detect_cycles(dag)
    assert set(offenders) == {"a", "b"}


def test_detect_cycles_returns_empty_for_acyclic():
    from planiadvance_v2.application.use_cases.integration_flows import (
        _build_flow_dag,
        _detect_cycles,
    )

    flow = IntegrationFlow(
        id="f",
        name="acyclic",
        source_system="erp",
        blocks=[
            IntegrationFlowBlock(id="a", block_type="export_snapshot"),
            IntegrationFlowBlock(
                id="b",
                block_type="validate_snapshot",
                input_block_id="a",
            ),
        ],
    )
    assert _detect_cycles(_build_flow_dag(flow)) == []


def test_topological_order_preserves_flow_blocks_order_for_ties():
    """Source blocks with no inputs keep their flow.blocks order."""
    from planiadvance_v2.application.use_cases.integration_flows import (
        _build_flow_dag,
        _topological_order,
    )

    flow = IntegrationFlow(
        id="f",
        name="ties",
        source_system="studio_v2",
        blocks=[
            IntegrationFlowBlock(id="a", block_type="export_snapshot"),
            IntegrationFlowBlock(id="b", block_type="export_snapshot"),
            IntegrationFlowBlock(id="c", block_type="export_snapshot"),
            IntegrationFlowBlock(
                id="m",
                block_type="logic_merge",
                inputs=[
                    FlowBlockInput(source_block_id="a"),
                    FlowBlockInput(source_block_id="b"),
                    FlowBlockInput(source_block_id="c"),
                ],
            ),
        ],
    )
    dag = _build_flow_dag(flow)
    ordered = _topological_order([b.id for b in flow.blocks], dag)
    # Sources keep flow.blocks order; merge comes after them.
    assert ordered == ["a", "b", "c", "m"]


def test_catalog_registers_error_handler_block():
    """Phase 7 — error_handler is the entry point for error edges."""
    by_type = {item["block_type"]: item for item in FLOW_BLOCK_CATALOG}
    assert "error_handler" in by_type
    assert by_type["error_handler"]["category"] == "error"
    assert by_type["error_handler"]["accepts_input"] is True
    assert by_type["error_handler"]["output_kind"] == "error_handled"
