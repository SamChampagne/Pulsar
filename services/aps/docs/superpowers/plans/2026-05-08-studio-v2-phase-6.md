# Studio v2 Phase 6 — Logic blocks + DAG runner

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add If / Switch / Merge logic blocks to the Studio v2 catalog and replace the linear flow runner with a true DAG runner that supports branching, merging, and cycle detection — without breaking any v1 linear flow.

**Architecture:**
- **Block model extension** — add `inputs: list[FlowBlockInput]` on `IntegrationFlowBlock`. Each entry carries `(source_block_id, edge_type, case_value?)`. Empty `inputs` falls back to legacy `input_block_id` semantics, so existing flows render and execute unchanged.
- **DAG runner** — `_execute_flow` becomes a topological-sort loop. Each block tracks which **outgoing** edge types it activated (e.g. branch_if activates exactly one of `branch_true` / `branch_false`). Downstream blocks are executed only when at least one of their incoming edges was activated; otherwise they emit a `status="skipped"` trace row.
- **Validate-graph endpoint** — `POST /integration/flows/{id}/validate-graph` returns structured issues (cycle / dangling-branch / unreachable / unknown-source) so the UI can refuse Save / surface red dots before Run.
- **Frontend** — branch nodes render two output handles; edges are colored by `edge_type` (data: text-muted, branch_true: ok-green, branch_false: crit-red, branch_case: info-soft); a Validate button in the toolbar populates a new "Issues" tab in the BottomPanel.

**Tech Stack:** Python 3.11 + FastAPI + SQLAlchemy 2.0 (backend); React 19 + @xyflow/react@12 + zustand (frontend). Pytest for tests; ruff for lint.

**Method (locked with Sam, 2026-05-07):** mini-spec → impacts → vertical slice → tests → commit. Hexagonal preserved (domain pure, application use cases, API thin, UI separate). No gratuitous refactor. UI slices verified in Chrome DevTools MCP.

**Out of scope (intentional):**
- Phase 5.5 cron-firing worker + authenticated public webhook (separate batch).
- `error_handler` / `error_retry` blocks → Phase 7.
- Visual graph re-layout (auto-arrange) — manual drag stays the only positioning mechanism.
- Loop / iteration block — not in n8n-parity scope for V1.0.

**Backwards compatibility:**
- Existing v1 flows have only `input_block_id` set; they appear in the DAG as a degenerate linear chain and run identically. **Zero migration required.**
- Block JSON gains `inputs: []` (empty by default); SQL repository writes it as `null`/`[]` — DB schema unchanged.
- API schemas extend with optional `inputs` field; v1 clients that don't send it still work.

---

## File Structure

**Backend — modified:**
- `planiadvance_v2/application/ports/integration_flow_repository.py` — add `FlowBlockInput` dataclass + `inputs` field on `IntegrationFlowBlock`.
- `planiadvance_v2/application/use_cases/integration_flows.py` — add 3 logic catalog entries; new helpers `_build_flow_dag`, `_detect_cycles`, `_topological_order`; new `_execute_block` branches for `logic_branch_if` / `logic_branch_switch` / `logic_merge`; refactor `_execute_flow` body to topo loop; new `ValidateIntegrationFlowGraph` use case.
- `planiadvance_v2/application/use_cases/__init__.py` — export `ValidateIntegrationFlowGraph`, `FlowBlockInput`.
- `planiadvance_v2/api/schemas.py` — add optional `inputs` field to `IntegrationFlowBlockIn` / `IntegrationFlowBlockOut`; add `IntegrationFlowGraphIssueOut` + `IntegrationFlowValidateGraphOut`.
- `planiadvance_v2/api/routes/integration.py` — new endpoint `POST /integration/flows/{flow_id}/validate-graph`.
- `planiadvance_v2/api/dependencies.py` — `get_validate_integration_flow_graph` factory.
- `planiadvance_v2/infrastructure/db/repositories/integration_flow_repository.py` — block JSON serialization for `inputs`.
- `planiadvance_v2/infrastructure/in_memory/repositories.py` — twin in-memory repository (no schema change, just dataclass round-trip).

**Backend — tests created:**
- `tests/unit/application/use_cases/test_flow_dag_runner.py` — DAG topo + cycle + linear-fallback tests.
- `tests/unit/application/use_cases/test_flow_logic_blocks.py` — branch_if / switch / merge runtime tests + skipped-block tracing.
- `tests/unit/application/use_cases/test_validate_flow_graph.py` — validate-graph use case tests.
- `tests/unit/api/test_flow_validate_graph_tenant_isolation.py` — multi-tenant isolation regression test for new endpoint.

**Frontend — modified:**
- `ui/src/types.ts` — add `FlowBlockInput` type + extend `IntegrationFlowBlockIn` / `IntegrationFlowBlockOut` with `inputs?: FlowBlockInput[]`; add `IntegrationFlowGraphIssue` + `IntegrationFlowValidateGraphResult`.
- `ui/src/lib/studio/studioStore.ts` — `connect()` reads `params.sourceHandle` to derive `edge_type`; `serializeStore` emits per-node `inputs[]` from incoming edges (preserves legacy `input_block_id` for first data edge); `hydrateFromFlow` reads `inputs` if present; new `validateState` slice.
- `ui/src/components/studio/StudioNode.tsx` — for `block_type === "logic_branch_if"`, render two output handles (`true` / `false`) with colored dots; switch node renders N handles from `cases` length.
- `ui/src/components/studio/edgeStyles.ts` — new file: `edgeStyleFor(edgeType)` returns stroke color + label.
- `ui/src/components/studio/BottomPanel.tsx` — add "Issues" tab; populated from `validateState`.
- `ui/src/components/studio/StudioToolbar.tsx` — new "Validate" button next to Save/Run.
- `ui/src/pages/IntegrationStudioV2Page.tsx` — wire Validate button → POST /validate-graph; populate validateState.

**Frontend — tests:** none (the existing studio has no JS unit tests; visual review via Chrome MCP is the gate, per Sam's locked method).

This structure puts the catalog + dependency model centrally in `integration_flows.py` (already a 4374-line god-file — splitting is Studio pass 3 cleanup, not Phase 6).

---

## Slice A — Catalog & inputs model

**Files:**
- Modify: `planiadvance_v2/application/ports/integration_flow_repository.py`
- Modify: `planiadvance_v2/application/use_cases/integration_flows.py:77-339` (catalog block)
- Modify: `planiadvance_v2/api/schemas.py:1860-1873`
- Modify: `planiadvance_v2/infrastructure/db/repositories/integration_flow_repository.py`
- Modify: `planiadvance_v2/infrastructure/in_memory/repositories.py`
- Test: `tests/unit/application/use_cases/test_integration_flows.py` (extend existing catalog test)
- Test: `tests/unit/application/use_cases/test_flow_dag_runner.py` (new — round-trip only here)

### Slice A · Step 1 — Failing test: catalog includes 3 logic block types

- [ ] **Edit `tests/unit/application/use_cases/test_integration_flows.py`** — add at the end of the file:

```python
def test_catalog_registers_three_logic_blocks():
    """Phase 6 — Logic / If / Switch / Merge block_types are visible in the catalog."""
    from planiadvance_v2.application.use_cases.integration_flows import FLOW_BLOCK_CATALOG

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
```

- [ ] **Step 2 — Run test, expect failure**

Run: `python -m pytest tests/unit/application/use_cases/test_integration_flows.py::test_catalog_registers_three_logic_blocks -v`
Expected: FAIL with `assert "logic_branch_if" in by_type`.

- [ ] **Step 3 — Add catalog entries**

Edit `planiadvance_v2/application/use_cases/integration_flows.py` — insert before the closing `)` of `FLOW_BLOCK_CATALOG` (after the 3 trigger entries, around line 308):

```python
    # Studio v2 phase 6 — logic blocks (DAG branching / merging).
    # All 3 are dispatched in `_execute_block` and routed by the DAG runner
    # in `_execute_flow`. Branch outputs are activated based on the
    # block's runtime decision; merge takes the first non-null upstream.
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
```

- [ ] **Step 4 — Re-run test, expect pass**

Run: `python -m pytest tests/unit/application/use_cases/test_integration_flows.py::test_catalog_registers_three_logic_blocks -v`
Expected: PASS.

- [ ] **Step 5 — Failing test: FlowBlockInput dataclass exists and round-trips**

Edit `tests/unit/application/use_cases/test_integration_flows.py`, add:

```python
def test_integration_flow_block_supports_inputs_list():
    """Phase 6 — IntegrationFlowBlock carries a structured inputs list (DAG mode)."""
    from planiadvance_v2.application.ports import (
        FlowBlockInput,
        IntegrationFlowBlock,
    )

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


def test_flow_block_input_default_edge_type_is_data():
    from planiadvance_v2.application.ports import FlowBlockInput

    edge = FlowBlockInput(source_block_id="x")
    assert edge.edge_type == "data"
    assert edge.case_value is None
```

- [ ] **Step 6 — Run, expect failure**

Run: `python -m pytest tests/unit/application/use_cases/test_integration_flows.py::test_integration_flow_block_supports_inputs_list tests/unit/application/use_cases/test_integration_flows.py::test_flow_block_input_default_edge_type_is_data -v`
Expected: FAIL with ImportError on `FlowBlockInput`.

- [ ] **Step 7 — Add FlowBlockInput + inputs field**

Edit `planiadvance_v2/application/ports/integration_flow_repository.py` (entirely — short file, OK to overwrite):

```python
"""Port: persisted integration flow definitions for block-based orchestration."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass(slots=True)
class FlowBlockInput:
    """One incoming DAG edge into a flow block.

    Phase 6 introduces typed edges. Legacy linear flows keep using
    `IntegrationFlowBlock.input_block_id` (single edge, edge_type='data');
    DAG-aware blocks (logic_branch_*, logic_merge, and their downstreams)
    populate the `inputs` list instead.
    """

    source_block_id: str
    edge_type: str = "data"  # data | branch_true | branch_false | branch_case
    case_value: str | None = None  # populated for edge_type='branch_case'


@dataclass(slots=True)
class IntegrationFlowBlock:
    id: str
    block_type: str
    name: str | None = None
    input_block_id: str | None = None
    inputs: list[FlowBlockInput] = field(default_factory=list)
    config: dict[str, object] = field(default_factory=dict)


@dataclass(slots=True)
class IntegrationFlow:
    id: str
    name: str
    source_system: str
    organization_id: str | None = None
    workspace_id: str | None = None
    is_enabled: bool = True
    blocks: list[IntegrationFlowBlock] = field(default_factory=list)
    last_status: str | None = None
    last_message: str | None = None
    last_run_at: datetime | None = None
    created_by_user_id: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


class IntegrationFlowRepository(Protocol):
    def save(self, flow: IntegrationFlow) -> IntegrationFlow: ...

    def get(
        self,
        flow_id: str,
        *,
        organization_id: str | None = None,
    ) -> IntegrationFlow | None: ...

    def list_for_scope(
        self,
        *,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        limit: int = 50,
    ) -> list[IntegrationFlow]: ...
```

- [ ] **Step 8 — Re-export FlowBlockInput from `application.ports`**

Open `planiadvance_v2/application/ports/__init__.py` and add `FlowBlockInput` to the `IntegrationFlow*` re-export list. Run the small test below as the verifier:

Run: `python -c "from planiadvance_v2.application.ports import FlowBlockInput; print(FlowBlockInput(source_block_id='x').edge_type)"`
Expected: prints `data`.

- [ ] **Step 9 — Re-run dataclass tests, expect pass**

Run: `python -m pytest tests/unit/application/use_cases/test_integration_flows.py::test_integration_flow_block_supports_inputs_list tests/unit/application/use_cases/test_integration_flows.py::test_flow_block_input_default_edge_type_is_data -v`
Expected: PASS.

- [ ] **Step 10 — Failing test: SQL+API serialization round-trips inputs**

Create `tests/unit/application/use_cases/test_flow_dag_runner.py`:

```python
"""Phase 6 — DAG-aware block model: inputs round-trip through API + SQL."""

from __future__ import annotations

from planiadvance_v2.application.ports import (
    FlowBlockInput,
    IntegrationFlow,
    IntegrationFlowBlock,
)


def test_block_inputs_default_empty():
    block = IntegrationFlowBlock(id="b", block_type="export_snapshot")
    assert block.inputs == []


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
```

- [ ] **Step 11 — Run, expect failure**

Run: `python -m pytest tests/unit/application/use_cases/test_flow_dag_runner.py -v`
Expected: FAIL — InMemory repo discards `inputs` (or AttributeError if dataclass isn't applied — depends on whether the in-memory repo deepcopies vs. dict-roundtrips).

- [ ] **Step 12 — Update InMemory repo to preserve inputs**

Open `planiadvance_v2/infrastructure/in_memory/repositories.py`, find the integration-flow class (search for `IntegrationFlow` or `class InMemoryIntegrationFlowRepository`). Most likely it deep-copies the dataclass already, so the test will pass once the dataclass field exists. If it stores serialized dict, replicate the SQL pattern: serialize/deserialize `inputs` as a list of dicts.

If the in-memory repo currently uses a `copy.deepcopy(flow)` style — Step 11 actually passes after Step 7. If it stores via dict-conversion, mirror SQL serialization (Step 14 below).

Verify by running Step 11 again:
Run: `python -m pytest tests/unit/application/use_cases/test_flow_dag_runner.py -v`
Expected: PASS, OR if it still fails, apply the dict mirror in Step 14 first.

- [ ] **Step 13 — Failing test: SQL repo serializes inputs**

Add to `tests/unit/application/use_cases/test_flow_dag_runner.py`:

```python
def test_sql_repo_serializes_inputs():
    """SQL repo must serialize `inputs` into the JSON blob and deserialize back."""
    from planiadvance_v2.application.ports import FlowBlockInput, IntegrationFlowBlock
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
```

- [ ] **Step 14 — Run, expect failure; then update SQL repo**

Run: `python -m pytest tests/unit/application/use_cases/test_flow_dag_runner.py::test_sql_repo_serializes_inputs -v`
Expected: FAIL — `inputs` key missing.

Edit `planiadvance_v2/infrastructure/db/repositories/integration_flow_repository.py`:

Replace `_block_to_json`:
```python
    @staticmethod
    def _block_to_json(block: IntegrationFlowBlock) -> dict[str, object]:
        return {
            "id": block.id,
            "block_type": block.block_type,
            "name": block.name,
            "input_block_id": block.input_block_id,
            "inputs": [
                {
                    "source_block_id": edge.source_block_id,
                    "edge_type": edge.edge_type,
                    "case_value": edge.case_value,
                }
                for edge in block.inputs
            ],
            "config": dict(block.config),
        }
```

Replace the block re-hydration in `_to_port` (inside the `IntegrationFlowBlock(...)` call):
```python
                IntegrationFlowBlock(
                    id=str(block.get("id", "")),
                    block_type=str(block.get("block_type", "")),
                    name=(
                        str(block["name"])
                        if block.get("name") is not None
                        else None
                    ),
                    input_block_id=(
                        str(block["input_block_id"])
                        if block.get("input_block_id") is not None
                        else None
                    ),
                    inputs=[
                        FlowBlockInput(
                            source_block_id=str(edge.get("source_block_id", "")),
                            edge_type=str(edge.get("edge_type", "data")),
                            case_value=(
                                str(edge["case_value"])
                                if edge.get("case_value") is not None
                                else None
                            ),
                        )
                        for edge in (block.get("inputs") or [])
                        if isinstance(edge, dict)
                    ],
                    config=(
                        dict(block.get("config", {}))
                        if isinstance(block.get("config"), dict)
                        else {}
                    ),
                )
```

Add `FlowBlockInput` to the imports at the top:
```python
from ....application.ports import FlowBlockInput, IntegrationFlow, IntegrationFlowBlock
```

- [ ] **Step 15 — Re-run, expect pass; then full unit suite**

Run: `python -m pytest tests/unit/application/use_cases/test_flow_dag_runner.py -v`
Expected: PASS (3 tests).

Run: `python -m pytest tests/unit -q`
Expected: 858 (baseline) + 5 new = **863 PASSED**, no regressions.

- [ ] **Step 16 — Lint check**

Run: `make lint`
Expected: ruff baseline of 51 errors preserved (same number as before).

- [ ] **Step 17 — Commit Slice A**

```bash
git add planiadvance_v2/application/ports/integration_flow_repository.py \
        planiadvance_v2/application/ports/__init__.py \
        planiadvance_v2/application/use_cases/integration_flows.py \
        planiadvance_v2/infrastructure/db/repositories/integration_flow_repository.py \
        planiadvance_v2/infrastructure/in_memory/repositories.py \
        tests/unit/application/use_cases/test_integration_flows.py \
        tests/unit/application/use_cases/test_flow_dag_runner.py
git commit -m "Studio v2 phase 6 slice A: catalog + FlowBlockInput model

- 3 logic block_types in FLOW_BLOCK_CATALOG (branch_if/switch/merge)
- FlowBlockInput dataclass (source_block_id, edge_type, case_value)
- IntegrationFlowBlock.inputs list (default empty = legacy linear)
- SQL + InMemory repos serialize inputs round-trip"
```

---

## Slice B — DAG runner core + cycle detection

**Files:**
- Modify: `planiadvance_v2/application/use_cases/integration_flows.py`
  - New helpers: `_build_flow_dag`, `_topological_order`, `_detect_cycles`.
  - Refactor `_execute_flow` (lines 1468-1645) — keep the same `_FlowExecution` return shape but iterate in topo order.
- Test: `tests/unit/application/use_cases/test_flow_dag_runner.py` (extend)

### Slice B · Step 1 — Failing test: `_build_flow_dag` from legacy linear input_block_id

- [ ] **Edit `tests/unit/application/use_cases/test_flow_dag_runner.py`**, add:

```python
def test_build_dag_from_legacy_linear_chain():
    """Existing v1 flows have only input_block_id — _build_flow_dag promotes them."""
    from planiadvance_v2.application.ports import IntegrationFlow, IntegrationFlowBlock
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
    from planiadvance_v2.application.ports import (
        FlowBlockInput,
        IntegrationFlow,
        IntegrationFlowBlock,
    )
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
```

- [ ] **Step 2 — Run, expect failure**

Run: `python -m pytest tests/unit/application/use_cases/test_flow_dag_runner.py::test_build_dag_from_legacy_linear_chain -v`
Expected: FAIL — ImportError on `_build_flow_dag`.

- [ ] **Step 3 — Add `_build_flow_dag` helper**

Edit `planiadvance_v2/application/use_cases/integration_flows.py`. Find `_flow_block_dependencies` (line 2996) and **add immediately above it**:

```python
def _build_flow_dag(flow: IntegrationFlow) -> dict[str, list[FlowBlockInput]]:
    """Produce the DAG view of a flow.

    Each block_id maps to a list of FlowBlockInput entries. The list is empty
    for source blocks. Legacy linear flows (only input_block_id set) are
    promoted to a single edge_type='data' entry.

    Blocks that require input but have neither `inputs` nor `input_block_id`
    fall back to the previous block in `flow.blocks` order, matching the v1
    runner's behavior so unmodified v1 flows execute identically.
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
```

Make sure `FlowBlockInput` is imported at the top of the file (it should already be available via `application.ports` — search the imports):

```python
from ..ports.integration_flow_repository import (
    FlowBlockInput,
    IntegrationFlow,
    IntegrationFlowBlock,
)
```

(Adjust to match the existing import style — likely the file already does `from ..ports import IntegrationFlow, IntegrationFlowBlock`. Just add `FlowBlockInput`.)

- [ ] **Step 4 — Re-run, expect pass**

Run: `python -m pytest tests/unit/application/use_cases/test_flow_dag_runner.py::test_build_dag_from_legacy_linear_chain tests/unit/application/use_cases/test_flow_dag_runner.py::test_build_dag_prefers_inputs_when_present -v`
Expected: PASS.

- [ ] **Step 5 — Failing test: cycle detection**

Add to `tests/unit/application/use_cases/test_flow_dag_runner.py`:

```python
def test_detect_cycles_returns_offenders():
    """A 2-block cycle yields both block ids in the result."""
    from planiadvance_v2.application.ports import (
        FlowBlockInput,
        IntegrationFlow,
        IntegrationFlowBlock,
    )
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
    from planiadvance_v2.application.ports import IntegrationFlow, IntegrationFlowBlock
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
```

- [ ] **Step 6 — Run, expect failure**

Run: `python -m pytest tests/unit/application/use_cases/test_flow_dag_runner.py -k cycles -v`
Expected: FAIL — ImportError on `_detect_cycles`.

- [ ] **Step 7 — Add `_detect_cycles` and `_topological_order`**

Add immediately below `_build_flow_dag` in `integration_flows.py`:

```python
def _topological_order(
    block_ids: list[str],
    dag: dict[str, list[FlowBlockInput]],
) -> list[str]:
    """Kahn topological sort. Returns block_ids in execution order.

    Blocks not appearing in `block_ids` (orphan refs in `dag`) are skipped.
    Caller must pre-validate cycles via `_detect_cycles` to avoid an
    incomplete result here.
    """
    block_id_set = set(block_ids)
    indegree: dict[str, int] = {bid: 0 for bid in block_ids}
    successors: dict[str, list[str]] = {bid: [] for bid in block_ids}
    for bid in block_ids:
        for edge in dag.get(bid, []):
            if edge.source_block_id in block_id_set:
                indegree[bid] += 1
                successors[edge.source_block_id].append(bid)
    # Preserve flow.blocks order for ties so existing flows keep their
    # observable execution sequence.
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
    """Return the block ids that participate in any cycle.

    Implementation: classic DFS coloring (white/gray/black). Any node still
    `gray` at the end is in a cycle.
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
```

- [ ] **Step 8 — Re-run, expect pass**

Run: `python -m pytest tests/unit/application/use_cases/test_flow_dag_runner.py -k cycles -v`
Expected: PASS (2 tests).

- [ ] **Step 9 — Failing test: legacy v1 linear flows still execute identically through the new runner**

Add to `tests/unit/application/use_cases/test_flow_dag_runner.py`:

```python
def test_legacy_linear_flow_executes_through_new_dag_runner():
    """Regression: a v1 flow with only input_block_id runs identically.

    Uses the same export → validate path as v1 tests; verifies block_results
    list is in flow.blocks order and the final output kind is validated_snapshot.
    """
    from planiadvance_v2.application.ports import (
        IntegrationFlow,
        IntegrationFlowBlock,
        RunIntegrationFlowInput,
    )
    from planiadvance_v2.application.use_cases.integration_flows import RunIntegrationFlow
    from tests.unit.api.helpers.flow_factories import make_run_use_case_with_repos

    use_case, repos = make_run_use_case_with_repos()
    flow = IntegrationFlow(
        id="f",
        name="linear",
        source_system="erp",
        organization_id="org-A",
        blocks=[
            IntegrationFlowBlock(id="a", block_type="export_snapshot"),
            IntegrationFlowBlock(
                id="b",
                block_type="validate_snapshot",
                input_block_id="a",
            ),
        ],
    )
    repos.flows.save(flow)
    output = use_case.execute(
        RunIntegrationFlowInput(
            flow_id="f",
            organization_id="org-A",
            workspace_id=None,
        )
    )
    block_ids = [r.block_id for r in output.block_results]
    assert block_ids == ["a", "b"]
    assert output.status == "completed"
```

This test references a helper `tests/unit/api/helpers/flow_factories.py`. **Inspect first** — search the codebase:

Run: `grep -rn "make_run_use_case_with_repos\|class _FakeFlowRepos\|def _make_run_flow_use_case" tests/`

If no helper exists yet, **adapt the test** to construct the use case the way other tests in the file do — find the closest existing test that builds `RunIntegrationFlow` and copy its setup pattern.

- [ ] **Step 10 — Run, expect either ImportError (skip) or actual test result**

Run: `python -m pytest tests/unit/application/use_cases/test_flow_dag_runner.py::test_legacy_linear_flow_executes_through_new_dag_runner -v`

If ImportError: replace the helper-based setup with the inline pattern used in the existing `test_run_integration_flow*.py` test files (search `grep -l "RunIntegrationFlow(" tests/unit`).
If FAIL because the runner already runs but produces a different shape: that's the regression we want to catch — proceed to Step 11.
If PASS already: still proceed (Step 11 is the actual refactor).

- [ ] **Step 11 — Refactor `_execute_flow` to topo-iterate (preserves linear semantics)**

Locate `_execute_flow` at line 1468 in `integration_flows.py`. Replace the `for block in flow.blocks:` loop with the topo-driven version. **Show full replacement here** — the surrounding plan / build / scope code stays intact:

Replace (the entire body from `execution_plan = ...` through the end of the for loop, ~ lines 1477-1614):

```python
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
        ordered_ids = _topological_order(
            [b.id for b in flow.blocks],
            dag,
        )
        for block_id in ordered_ids:
            if block_id not in execution_plan["execute_block_ids"]:
                continue
            block = block_by_id[block_id]
            input_value: dict[str, object] | None = None
            block_inputs = dag.get(block_id, [])
            # Single-input blocks (legacy + most types) read upstream output.
            # Merge handling and branch-output activation come in Slice C.
            for edge in block_inputs:
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
                output, status, message = self._execute_block(
                    flow=flow,
                    block=block,
                    input_value=input_value,
                    organization_id=organization_id,
                    workspace_id=workspace_id,
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
```

The rest of `_execute_flow` (the `if not executed_blocks` guard and final `_FlowExecution(...)` construction) stays unchanged.

- [ ] **Step 12 — Run full unit suite, no regressions allowed**

Run: `python -m pytest tests/unit -q`
Expected: 863 (after Slice A) + ~3 new = **866 PASSED**, 0 FAILED.

If any pre-existing flow test fails, **stop and triage** — most likely cause is:
- The topo sort changed observable order vs. `flow.blocks` order. Fix: in `_topological_order`, when multiple blocks have indegree 0, pop them in `flow.blocks` order. The implementation above already does this via `ready = [bid for bid in block_ids if ...]` (preserves input order).
- `dag.get(block_id, [])` returns `[]` for source blocks but legacy code derived `input_block_id` only when needed. The `_build_flow_execution_plan` still uses the legacy `_flow_block_dependencies`, so `input_block_ids` mapping for `start_block_id`/`stop_after_block_id` stays correct.

- [ ] **Step 13 — Lint check**

Run: `make lint`
Expected: baseline 51 errors preserved.

- [ ] **Step 14 — Commit Slice B**

```bash
git add planiadvance_v2/application/use_cases/integration_flows.py \
        tests/unit/application/use_cases/test_flow_dag_runner.py
git commit -m "Studio v2 phase 6 slice B: DAG runner core + cycle detection

- _build_flow_dag promotes legacy linear flows + reads new inputs[]
- _topological_order (Kahn) preserves flow.blocks order for ties
- _detect_cycles raises ValidationError before any block runs
- _execute_flow iterates topo-sorted; legacy v1 flows execute identically"
```

---

## Slice C — Branch_if + switch + merge runtime

**Files:**
- Modify: `planiadvance_v2/application/use_cases/integration_flows.py:1647+` (extend `_execute_block`)
- Modify: `planiadvance_v2/application/use_cases/integration_flows.py` `_execute_flow` (skip-tracking + branch-edge activation logic)
- Test: `tests/unit/application/use_cases/test_flow_logic_blocks.py` (new)

### Slice C · Step 1 — Failing test: branch_if true path

- [ ] **Create `tests/unit/application/use_cases/test_flow_logic_blocks.py`**:

```python
"""Phase 6 — runtime semantics of logic_branch_if / switch / merge."""

from __future__ import annotations

import pytest

from planiadvance_v2.application.ports import (
    FlowBlockInput,
    IntegrationFlow,
    IntegrationFlowBlock,
    RunIntegrationFlowInput,
)


@pytest.fixture
def use_case_factory():
    """Return a callable that builds a configured RunIntegrationFlow + repo set."""
    # Inline the same wiring used by other use-case tests. Search:
    #   grep -l "RunIntegrationFlow(" tests/unit/application/use_cases | head -1
    # and copy its `make_use_case` helper here. If a shared helper already
    # exists in tests/conftest.py, import it instead.
    from tests.unit.application.use_cases.conftest import make_run_flow_use_case  # type: ignore[attr-defined]

    return make_run_flow_use_case


def _save(use_case_pair, flow):
    use_case, repos = use_case_pair
    repos.flows.save(flow)
    return use_case


def test_branch_if_activates_true_branch_when_path_resolves_truthy(use_case_factory):
    pair = use_case_factory()
    use_case, repos = pair

    # Source emits {kind:trigger_event, via:manual, ...} — truthy on any path
    flow = IntegrationFlow(
        id="f-true",
        name="branch true",
        source_system="studio_v2",
        organization_id="org-A",
        blocks=[
            IntegrationFlowBlock(id="t", block_type="trigger_manual"),
            IntegrationFlowBlock(
                id="if1",
                block_type="logic_branch_if",
                inputs=[FlowBlockInput(source_block_id="t", edge_type="data")],
                config={"condition_path": "$.via", "expected_value": "manual"},
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
    repos.flows.save(flow)
    output = use_case.execute(
        RunIntegrationFlowInput(flow_id="f-true", organization_id="org-A", workspace_id=None)
    )
    statuses = {r.block_id: r.status for r in output.block_results}
    assert statuses["t"] == "ready"
    assert statuses["if1"] == "ready"
    assert statuses["t-side"] == "ready"
    assert statuses["f-side"] == "skipped"


def test_branch_if_activates_false_branch_when_expected_value_mismatches(use_case_factory):
    pair = use_case_factory()
    use_case, repos = pair
    flow = IntegrationFlow(
        id="f-false",
        name="branch false",
        source_system="studio_v2",
        organization_id="org-A",
        blocks=[
            IntegrationFlowBlock(id="t", block_type="trigger_manual"),
            IntegrationFlowBlock(
                id="if1",
                block_type="logic_branch_if",
                inputs=[FlowBlockInput(source_block_id="t", edge_type="data")],
                config={"condition_path": "$.via", "expected_value": "schedule"},
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
    repos.flows.save(flow)
    output = use_case.execute(
        RunIntegrationFlowInput(flow_id="f-false", organization_id="org-A", workspace_id=None)
    )
    statuses = {r.block_id: r.status for r in output.block_results}
    assert statuses["t-side"] == "skipped"
    assert statuses["f-side"] == "ready"


def test_merge_forwards_first_non_null_upstream(use_case_factory):
    pair = use_case_factory()
    use_case, repos = pair
    flow = IntegrationFlow(
        id="f-merge",
        name="merge",
        source_system="studio_v2",
        organization_id="org-A",
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
                inputs=[FlowBlockInput(source_block_id="if1", edge_type="branch_false")],
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
    repos.flows.save(flow)
    output = use_case.execute(
        RunIntegrationFlowInput(flow_id="f-merge", organization_id="org-A", workspace_id=None)
    )
    statuses = {r.block_id: r.status for r in output.block_results}
    assert statuses["m"] == "ready", "merge must execute even with a skipped sibling"
```

If `tests/unit/application/use_cases/conftest.py` does **not** define `make_run_flow_use_case`, search the codebase for an equivalent factory:
```bash
grep -rn "RunIntegrationFlow(" tests/unit/application/use_cases | head -5
```
Pick the cleanest existing test, copy its `RunIntegrationFlow(...)` constructor block, and inline it as a local helper inside the test file.

- [ ] **Step 2 — Run, expect failure**

Run: `python -m pytest tests/unit/application/use_cases/test_flow_logic_blocks.py -v`
Expected: FAIL — `_execute_block` doesn't know `logic_branch_if` and raises `ValidationError("Unsupported flow block type ...")`.

- [ ] **Step 3 — Add branch/switch/merge handling in `_execute_block`**

Open `_execute_block` (around line 1647 in `integration_flows.py`). Find the trigger handling block (around line 1660) and **add immediately after the trigger blocks, before any APS/connector logic**:

```python
        # Studio v2 phase 6 — logic blocks. The DAG runner reads the
        # `__branch_decision` key on the output dict to figure out which
        # outgoing edge_type was activated. Merge is a pass-through.
        if block.block_type == "logic_branch_if":
            condition_path = str(block.config.get("condition_path") or "")
            expected = block.config.get("expected_value")
            resolved = _resolve_flow_variable_path(input_value, condition_path)
            if expected is None:
                truthy = bool(resolved)
            else:
                truthy = (
                    resolved == expected
                    or str(resolved) == str(expected)
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
            resolved = _resolve_flow_variable_path(input_value, condition_path)
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
            # Merge is a pass-through: input_value is already the first
            # non-null upstream output picked by `_execute_flow`. We just
            # forward it under a `merge_passthrough` envelope so trace
            # consumers can tell the upstream from the merged record.
            forwarded = input_value if input_value is not None else {}
            return (
                {"kind": "merge_passthrough", "forwarded": forwarded},
                "ready",
                "Merged upstream output forwarded.",
            )
```

- [ ] **Step 4 — Add edge-activation tracking in `_execute_flow`**

Still in `integration_flows.py`. After Slice B's refactor, the topo loop simply assigns `block_outputs[block.id] = output`. Now we need:

1. **Track which outgoing edges each block activates.** Branch blocks activate exactly one edge_type; non-branch blocks activate `data` (their default).
2. **Skip downstream blocks** whose **all** incoming edges are inactive.
3. **Emit a `status="skipped"` trace row** for skipped blocks.

Add a helper near `_build_flow_dag`:

```python
def _activated_edge_types_for_block(
    block_type: str,
    output: dict[str, object] | None,
) -> set[str]:
    """Edge types this block activates downstream.

    Branch blocks pick exactly one (read from output['__branch_decision']);
    everything else activates 'data' (the implicit edge type).
    """
    if block_type == "logic_branch_if":
        decision = (output or {}).get("__branch_decision")
        return {str(decision)} if decision else set()
    if block_type == "logic_branch_switch":
        decision = (output or {}).get("__branch_decision")
        return {str(decision)} if decision else set()
    return {"data"}
```

In `_execute_flow`, **add a tracker** right after the topo init:
```python
        activated_outgoing: dict[str, set[str]] = {bid: set() for bid in ordered_ids}
```

After the successful `block_outputs[block.id] = output` line in the loop, **add**:
```python
            activated_outgoing[block.id] = _activated_edge_types_for_block(
                block.block_type, output
            )
```

**Above** the `input_value = None` line (i.e. before reading inputs), check whether the block should run:
```python
            block = block_by_id[block_id]
            block_inputs_for_skip_check = dag.get(block_id, [])
            if block_inputs_for_skip_check:
                any_active = any(
                    edge.source_block_id in block_outputs
                    and edge.edge_type in activated_outgoing.get(edge.source_block_id, set())
                    for edge in block_inputs_for_skip_check
                )
                if not any_active:
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
```

(Place this **before** the `input_value = None; block_inputs = dag.get(...)` block. Adjust variable names if they collide; the existing flow can keep `block_inputs = dag.get(...)` — both reads are cheap.)

Also, when picking input_value for a multi-input block (e.g. merge), iterate inputs but **only consider those whose source activated the matching edge_type**:

Replace the `for edge in block_inputs:` mini-loop with:
```python
            for edge in block_inputs:
                if edge.edge_type not in activated_outgoing.get(edge.source_block_id, set()):
                    continue
                upstream = block_outputs.get(edge.source_block_id)
                if upstream is not None:
                    input_value = upstream
                    break
```

- [ ] **Step 5 — Run logic block tests**

Run: `python -m pytest tests/unit/application/use_cases/test_flow_logic_blocks.py -v`
Expected: 3 PASS.

- [ ] **Step 6 — Full unit suite — no regressions**

Run: `python -m pytest tests/unit -q`
Expected: 866 (Slice B) + 3 new = **869 PASSED**.

- [ ] **Step 7 — Lint check**

Run: `make lint`
Expected: baseline 51 errors preserved.

- [ ] **Step 8 — Commit Slice C**

```bash
git add planiadvance_v2/application/use_cases/integration_flows.py \
        tests/unit/application/use_cases/test_flow_logic_blocks.py
git commit -m "Studio v2 phase 6 slice C: branch_if/switch/merge runtime

- _execute_block dispatches 3 logic types
- Branch blocks emit __branch_decision; runner activates matching edge_type
- Skipped blocks emit status='skipped' trace row
- Merge forwards first non-null upstream as merge_passthrough envelope"
```

---

## Slice D — Validate-graph endpoint

**Files:**
- Modify: `planiadvance_v2/application/use_cases/integration_flows.py` — new `ValidateIntegrationFlowGraph` class
- Modify: `planiadvance_v2/application/use_cases/__init__.py`
- Modify: `planiadvance_v2/api/schemas.py` — add `IntegrationFlowGraphIssueOut` + `IntegrationFlowValidateGraphOut`
- Modify: `planiadvance_v2/api/routes/integration.py` — new endpoint
- Modify: `planiadvance_v2/api/dependencies.py` — `get_validate_integration_flow_graph`
- Modify: `planiadvance_v2/api/main.py` — register the new router method (only if a separate APIRouter is needed; otherwise just add to existing one)
- Test: `tests/unit/application/use_cases/test_validate_flow_graph.py` (new)
- Test: `tests/unit/api/test_flow_validate_graph_tenant_isolation.py` (new)

### Slice D · Step 1 — Failing test: ValidateIntegrationFlowGraph use case detects cycles

- [ ] **Create `tests/unit/application/use_cases/test_validate_flow_graph.py`**:

```python
"""Phase 6 — POST /flows/{id}/validate-graph use case tests."""

from __future__ import annotations

import pytest

from planiadvance_v2.application.ports import (
    FlowBlockInput,
    IntegrationFlow,
    IntegrationFlowBlock,
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
    from planiadvance_v2.infrastructure.in_memory.repositories import (
        InMemoryIntegrationFlowRepository,
    )
    from planiadvance_v2.application.use_cases.integration_flows import (
        ValidateIntegrationFlowGraph,
        ValidateIntegrationFlowGraphInput,
    )

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
    from planiadvance_v2.infrastructure.in_memory.repositories import (
        InMemoryIntegrationFlowRepository,
    )
    from planiadvance_v2.application.use_cases.integration_flows import (
        ValidateIntegrationFlowGraph,
        ValidateIntegrationFlowGraphInput,
    )

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
    from planiadvance_v2.infrastructure.in_memory.repositories import (
        InMemoryIntegrationFlowRepository,
    )
    from planiadvance_v2.application.use_cases.integration_flows import (
        ValidateIntegrationFlowGraph,
        ValidateIntegrationFlowGraphInput,
    )

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


def test_validate_graph_returns_404_when_flow_missing_or_cross_tenant():
    from planiadvance_v2.infrastructure.in_memory.repositories import (
        InMemoryIntegrationFlowRepository,
    )
    from planiadvance_v2.application.use_cases.integration_flows import (
        ValidateIntegrationFlowGraph,
        ValidateIntegrationFlowGraphInput,
    )
    from planiadvance_v2.application.errors import EntityNotFound  # adjust import path

    repo = InMemoryIntegrationFlowRepository()
    flow = _flow(
        [IntegrationFlowBlock(id="a", block_type="export_snapshot")],
        flow_id="f",
        org_id="org-A",
    )
    repo.save(flow)

    use_case = ValidateIntegrationFlowGraph(repo)
    with pytest.raises(EntityNotFound):
        use_case.execute(
            ValidateIntegrationFlowGraphInput(flow_id="f", organization_id="org-B")
        )
    with pytest.raises(EntityNotFound):
        use_case.execute(
            ValidateIntegrationFlowGraphInput(flow_id="missing", organization_id="org-A")
        )
```

If `EntityNotFound` lives elsewhere — search:
```bash
grep -rn "class EntityNotFound\|class FlowNotFound" planiadvance_v2/ | head -3
```
And update the import path.

- [ ] **Step 2 — Run, expect ImportError failure**

Run: `python -m pytest tests/unit/application/use_cases/test_validate_flow_graph.py -v`
Expected: FAIL on `from ... import ValidateIntegrationFlowGraph`.

- [ ] **Step 3 — Implement ValidateIntegrationFlowGraph use case**

Add **at the end of `integration_flows.py`**, before the helper functions section (or after `RunIntegrationFlow`'s class definition, around line 2716):

```python
@dataclass(frozen=True, slots=True)
class ValidateIntegrationFlowGraphInput:
    flow_id: str
    organization_id: str | None = None


@dataclass(frozen=True, slots=True)
class IntegrationFlowGraphIssue:
    code: str  # cycle | unknown_source | dangling_branch | unreachable
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
    """

    def __init__(self, flows: IntegrationFlowRepository) -> None:
        self._flows = flows

    def execute(
        self, command: ValidateIntegrationFlowGraphInput
    ) -> ValidateIntegrationFlowGraphOutput:
        flow = self._flows.get(command.flow_id, organization_id=command.organization_id)
        if flow is None:
            raise EntityNotFound(
                f"Integration flow {command.flow_id!r} was not found."
            )
        issues: list[IntegrationFlowGraphIssue] = []
        block_ids = {b.id for b in flow.blocks}
        dag = _build_flow_dag(flow)

        # Unknown sources.
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

        # Cycles.
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

        # Dangling branches: a logic_branch_if/switch with zero downstream
        # blocks consuming the branch_true/false/case edge type.
        downstream_edge_types: dict[str, set[str]] = {bid: set() for bid in block_ids}
        for target_id, edges in dag.items():
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
```

Make sure `EntityNotFound` is imported. If the codebase uses a different exception name (`FlowNotFound`, `NotFoundError`, etc.), match it. Most likely the existing flow `get` route already raises something — search:
```bash
grep -rn "EntityNotFound\|FlowNotFound\|raise.*not found" planiadvance_v2/application | head -10
```

- [ ] **Step 4 — Re-run, expect pass**

Run: `python -m pytest tests/unit/application/use_cases/test_validate_flow_graph.py -v`
Expected: 4 PASS.

- [ ] **Step 5 — Add API endpoint**

Edit `planiadvance_v2/api/schemas.py`. Locate `IntegrationFlowReadinessOut` (around line 1925) and add **immediately after**:

```python
class IntegrationFlowGraphIssueOut(BaseModel):
    code: str
    severity: str
    message: str
    block_ids: list[str] = Field(default_factory=list)


class IntegrationFlowValidateGraphOut(BaseModel):
    flow_id: str
    valid: bool
    issues: list[IntegrationFlowGraphIssueOut] = Field(default_factory=list)
```

- [ ] **Step 6 — Add dependency factory**

Open `planiadvance_v2/api/dependencies.py`. Find `get_run_integration_flow` (or similar — the file has one factory per use case). Add:

```python
def get_validate_integration_flow_graph(
    session: Annotated[Session, Depends(get_session)],
) -> ValidateIntegrationFlowGraph:
    return ValidateIntegrationFlowGraph(SqlIntegrationFlowRepository(session))
```

Add `ValidateIntegrationFlowGraph` to the imports at the top of the file.

- [ ] **Step 7 — Add route**

Open `planiadvance_v2/api/routes/integration.py`. Locate the existing `/flows/{flow_id}/run` POST route. **Add immediately after**:

```python
@router.post(
    "/flows/{flow_id}/validate-graph",
    response_model=IntegrationFlowValidateGraphOut,
)
def validate_integration_flow_graph(
    flow_id: str,
    organization_id: str = Header(alias="X-Organization-Id"),
    user_id: str = Header(alias="X-User-Id"),
    use_case: ValidateIntegrationFlowGraph = Depends(get_validate_integration_flow_graph),
    membership: Membership = Depends(require_active_membership),
) -> IntegrationFlowValidateGraphOut:
    """Static DAG validation: cycles, unknown sources, dangling branches."""
    output = use_case.execute(
        ValidateIntegrationFlowGraphInput(
            flow_id=flow_id, organization_id=organization_id
        )
    )
    return IntegrationFlowValidateGraphOut(
        flow_id=output.flow_id,
        valid=output.valid,
        issues=[
            IntegrationFlowGraphIssueOut(
                code=i.code,
                severity=i.severity,
                message=i.message,
                block_ids=list(i.block_ids),
            )
            for i in output.issues
        ],
    )
```

Adjust the imports at the top of the route file to include the new types. Match the **existing pattern** (header dependencies, membership guard) used by the `/run` and `/test-block` routes — copy verbatim, don't invent.

- [ ] **Step 8 — Failing test: multi-tenant isolation**

Create `tests/unit/api/test_flow_validate_graph_tenant_isolation.py`:

```python
"""Phase 6 — /validate-graph endpoint must enforce tenant isolation.

Same pattern as test_flow_test_block_tenant_isolation.py — org-A owns the
flow, org-B sees the same 404 as if the flow didn't exist (no leakage).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.unit.api.helpers.app_factory import build_app_with_in_memory  # adjust


def test_org_a_can_validate_own_flow():
    client, repos = build_app_with_in_memory()
    flow = _seed_flow(repos, "f-A", "org-A")
    response = client.post(
        f"/integration/flows/{flow.id}/validate-graph",
        headers={"X-Organization-Id": "org-A", "X-User-Id": "u-A"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["flow_id"] == "f-A"
    assert body["valid"] is True


def test_org_b_gets_404_on_org_a_flow_without_leakage():
    client, repos = build_app_with_in_memory()
    flow = _seed_flow(repos, "f-A", "org-A")
    response = client.post(
        f"/integration/flows/{flow.id}/validate-graph",
        headers={"X-Organization-Id": "org-B", "X-User-Id": "u-B"},
    )
    assert response.status_code == 404
    body = response.json()
    # No flow content leaked in the 404 body
    assert "blocks" not in body
    assert "name" not in body


def test_validate_graph_unknown_flow_is_404():
    client, _repos = build_app_with_in_memory()
    response = client.post(
        "/integration/flows/missing/validate-graph",
        headers={"X-Organization-Id": "org-A", "X-User-Id": "u-A"},
    )
    assert response.status_code == 404


def _seed_flow(repos, flow_id: str, org_id: str):
    """Seed a 1-block flow under (flow_id, org_id) using whatever helper exists."""
    # See tests/unit/api/test_flow_test_block_tenant_isolation.py for the
    # seeding pattern — copy it verbatim. Membership rows in `repos.memberships`
    # must include both ("u-A", org_id) and ("u-B", "org-B") so the
    # `require_active_membership` guard passes for both calls.
    raise NotImplementedError("Copy seeding from existing isolation test")
```

**Important:** open `tests/unit/api/test_flow_test_block_tenant_isolation.py` (which exists per Phase 4) and copy its app/repo seeding helper directly into the new test. The placeholder `_seed_flow` and `build_app_with_in_memory` import here are pseudo-references — replace with whatever pattern is in use today. Do not invent new helpers.

- [ ] **Step 9 — Run, expect failure (NotImplementedError or wiring)**

Run: `python -m pytest tests/unit/api/test_flow_validate_graph_tenant_isolation.py -v`

Iterate: replace `_seed_flow` and `build_app_with_in_memory` with the verbatim copies from the Phase 4 isolation test. Until that test passes, the work is incomplete.

- [ ] **Step 10 — Re-run until pass**

Run: `python -m pytest tests/unit/api/test_flow_validate_graph_tenant_isolation.py -v`
Expected: 3 PASS.

- [ ] **Step 11 — Full suite check**

Run: `python -m pytest tests/unit -q`
Expected: 869 (Slice C) + 4 + 3 = **876 PASSED**.

Run: `make lint`
Expected: baseline 51 errors preserved.

- [ ] **Step 12 — Commit Slice D**

```bash
git add planiadvance_v2/application/use_cases/integration_flows.py \
        planiadvance_v2/application/use_cases/__init__.py \
        planiadvance_v2/api/schemas.py \
        planiadvance_v2/api/routes/integration.py \
        planiadvance_v2/api/dependencies.py \
        tests/unit/application/use_cases/test_validate_flow_graph.py \
        tests/unit/api/test_flow_validate_graph_tenant_isolation.py
git commit -m "Studio v2 phase 6 slice D: POST /flows/{id}/validate-graph

- ValidateIntegrationFlowGraph use case (cycle, unknown_source, dangling_branch)
- IntegrationFlowGraphIssueOut + IntegrationFlowValidateGraphOut schemas
- Multi-tenant isolation: org-B gets same 404 as missing flow, no body leak
- 4 use-case tests + 3 isolation regression tests"
```

---

## Slice E — Frontend: branch handles + edge colors

**Files:**
- Modify: `ui/src/types.ts`
- Modify: `ui/src/lib/studio/studioStore.ts` — `connect()` reads sourceHandle for edge_type; `serializeStore` emits `inputs[]` per node; `hydrateFromFlow` reads `inputs`
- Modify: `ui/src/components/studio/StudioNode.tsx` — render two output handles for `logic_branch_if`
- Create: `ui/src/components/studio/edgeStyles.ts` — `edgeStyleFor(edgeType)`

### Slice E · Step 1 — Update types

- [ ] **Edit `ui/src/types.ts`** — find `IntegrationFlowBlockIn` and `IntegrationFlowBlockOut`. Add a new `FlowBlockInput` type and add an optional `inputs` field to both:

```typescript
export type FlowBlockInputEdgeType =
  | "data"
  | "branch_true"
  | "branch_false"
  | "branch_case";

export type FlowBlockInput = {
  source_block_id: string;
  edge_type: FlowBlockInputEdgeType;
  case_value?: string | null;
};

// Inside the IntegrationFlowBlockIn type definition, add:
//   inputs?: FlowBlockInput[];
// Same for IntegrationFlowBlockOut.

export type IntegrationFlowGraphIssue = {
  code: "cycle" | "unknown_source" | "dangling_branch" | "unreachable";
  severity: "error" | "warning";
  message: string;
  block_ids: string[];
};

export type IntegrationFlowValidateGraphResult = {
  flow_id: string;
  valid: boolean;
  issues: IntegrationFlowGraphIssue[];
};
```

- [ ] **Step 2 — Failing test (manual)**

There are no JS unit tests for the studio. Verify by typechecking only:
Run: `cd ui && npx tsc --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 3 — Update `studioStore.ts` `serializeStore` to emit inputs[]**

Open `ui/src/lib/studio/studioStore.ts`. Replace the body of `serializeStore` with:

```typescript
export function serializeStore(
  nodes: ReadonlyArray<Node<StudioNodeData>>,
  edges: ReadonlyArray<Edge<StudioEdgeData>>,
  flowName: string,
): IntegrationFlowIn {
  const blocks: IntegrationFlowBlockIn[] = nodes.map((n) => {
    // All non-mismatch incoming edges, in canvas-add order.
    const incoming = edges.filter((e) => e.target === n.id && !e.data?.invalid);

    // Legacy hint for v1 runner: first 'data' edge.
    const firstDataEdge = incoming.find(
      (e) => edgeTypeFromHandle(e.sourceHandle) === "data",
    );

    const inputs: FlowBlockInput[] = incoming.map((e) => ({
      source_block_id: e.source,
      edge_type: edgeTypeFromHandle(e.sourceHandle),
    }));

    return {
      id: n.id,
      block_type: n.data.block_type,
      name: n.data.label,
      input_block_id: firstDataEdge?.source ?? null,
      inputs,
      config: {
        ...(n.data.config ?? {}),
        [UI_POSITION_KEY]: { x: n.position.x, y: n.position.y },
      },
    };
  });
  return {
    name: flowName,
    source_system: "studio_v2",
    is_enabled: true,
    blocks,
  };
}

function edgeTypeFromHandle(handle: string | null | undefined): FlowBlockInputEdgeType {
  if (handle === "out-true") return "branch_true";
  if (handle === "out-false") return "branch_false";
  if (handle === "out-case") return "branch_case";
  return "data";
}
```

Add `FlowBlockInput`, `FlowBlockInputEdgeType` to the existing types import line at the top.

- [ ] **Step 4 — Update `hydrateFromFlow` to read inputs[]**

In the same file, replace the edges build at the bottom of `hydrateFromFlow`:

```typescript
  const edges: Edge<StudioEdgeData>[] = [];
  for (const block of flow.blocks) {
    if (block.inputs && block.inputs.length > 0) {
      for (const edge of block.inputs) {
        edges.push({
          id: `e-${edge.source_block_id}-${block.id}-${edge.edge_type}`,
          source: edge.source_block_id,
          target: block.id,
          sourceHandle: handleFromEdgeType(edge.edge_type),
          data: { invalid: false, edgeType: edge.edge_type },
        });
      }
    } else if (block.input_block_id) {
      edges.push({
        id: `e-${block.input_block_id}-${block.id}`,
        source: block.input_block_id,
        target: block.id,
        data: { invalid: false, edgeType: "data" },
      });
    }
  }
```

Add the helper:
```typescript
function handleFromEdgeType(edgeType: FlowBlockInputEdgeType): string | undefined {
  if (edgeType === "branch_true") return "out-true";
  if (edgeType === "branch_false") return "out-false";
  if (edgeType === "branch_case") return "out-case";
  return undefined;
}
```

Also extend `StudioEdgeData`:
```typescript
export type StudioEdgeData = {
  invalid?: boolean;
  edgeType?: FlowBlockInputEdgeType;
};
```

- [ ] **Step 5 — Update `connect()` to set edge_type from sourceHandle**

Replace the `connect` action in the store:

```typescript
  connect: (params, validate) => {
    if (!params.source || !params.target) return;
    const invalid = !validate(params);
    const edgeType = edgeTypeFromHandle(params.sourceHandle);
    const style = edgeStyleFor(edgeType);
    set((s) => ({
      edges: [
        ...s.edges,
        {
          id: `e-${params.source}-${params.target}-${edgeType}-${Date.now()}`,
          source: params.source!,
          target: params.target!,
          sourceHandle: params.sourceHandle ?? undefined,
          targetHandle: params.targetHandle ?? undefined,
          type: "default",
          data: { invalid, edgeType },
          className: invalid ? "pa-studio-edge--invalid" : undefined,
          label: invalid ? "type mismatch" : style.label,
          labelStyle: invalid
            ? { fill: "var(--crit)", fontSize: 11, fontWeight: 600 }
            : style.labelStyle,
          labelBgStyle: invalid
            ? { fill: "var(--surface)", stroke: "var(--crit)" }
            : undefined,
          style: invalid ? undefined : { stroke: style.stroke, strokeWidth: 2 },
        },
      ],
      dirty: true,
    }));
  },
```

Import `edgeStyleFor` from the new helper file (Step 6).

- [ ] **Step 6 — Create `ui/src/components/studio/edgeStyles.ts`**

```typescript
import type { FlowBlockInputEdgeType } from "../../types";

export type EdgeVisualStyle = {
  stroke: string;
  label?: string;
  labelStyle?: Record<string, string | number>;
};

/**
 * Per-edge-type visual treatment for the Studio v2 canvas.
 *
 * `data` keeps the muted default; branch edges pick up the design-token
 * semantic colors so the planner can read flow direction at a glance.
 */
export function edgeStyleFor(edgeType: FlowBlockInputEdgeType): EdgeVisualStyle {
  if (edgeType === "branch_true") {
    return {
      stroke: "var(--ok)",
      label: "true",
      labelStyle: { fill: "var(--ok)", fontSize: 11, fontWeight: 600 },
    };
  }
  if (edgeType === "branch_false") {
    return {
      stroke: "var(--crit)",
      label: "false",
      labelStyle: { fill: "var(--crit)", fontSize: 11, fontWeight: 600 },
    };
  }
  if (edgeType === "branch_case") {
    return {
      stroke: "var(--info)",
      label: "case",
      labelStyle: { fill: "var(--info)", fontSize: 11, fontWeight: 600 },
    };
  }
  return { stroke: "var(--text-muted)" };
}
```

- [ ] **Step 7 — Update `StudioNode.tsx` to render branch handles**

Open `ui/src/components/studio/StudioNode.tsx`. Find where the output `Handle` is rendered. Wrap it conditionally: for `block_type === "logic_branch_if"`, render two handles labeled `out-true` (top) and `out-false` (bottom); for everything else, render the existing single handle.

Pattern (adapt to the existing node template — don't invent layout that doesn't match):

```tsx
{props.data.block_type === "logic_branch_if" ? (
  <>
    <Handle
      id="out-true"
      type="source"
      position={Position.Right}
      style={{ top: "33%", background: "var(--ok)" }}
    />
    <Handle
      id="out-false"
      type="source"
      position={Position.Right}
      style={{ top: "67%", background: "var(--crit)" }}
    />
  </>
) : (
  <Handle type="source" position={Position.Right} />
)}
```

- [ ] **Step 8 — Typecheck**

Run: `cd ui && npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 9 — Build the UI bundle**

Run: `cd ui && npm run build`
Expected: PASS, dist/ produced. If it fails, fix typescript / vite errors before continuing.

- [ ] **Step 10 — Visual review with Chrome DevTools MCP** *(Sam's locked rule: every UI slice gets a Chrome MCP walkthrough)*

1. Start the API: `cd planiadvance_v2/docker && docker compose up -d api` (or ensure it's running).
2. Start vite: `cd planiadvance_v2/ui && npm run dev`.
3. Open Chrome MCP → navigate to `http://localhost:5173/#/integration/studio-v2`.
4. Drag a `Manual` trigger → drag an `If` block. Connect them.
5. Drag two `Export APS Data` blocks. Connect `out-true` of `If` to one, `out-false` to the other.
6. Take a screenshot saved as `studio-v2-phase6-branch.png` at the repo root.
7. Verify visually:
   - The two outgoing edges have different colors (green/red).
   - The labels "true" / "false" appear on the edges.
   - The If node shows two distinct output handles.
8. Click Save. The toolbar's flow id should populate (POST /flows succeeded).
9. Reload the page with the same `?flow_id=...` query string. Verify both edges + their colors + labels are restored.

- [ ] **Step 11 — Commit Slice E**

```bash
git add ui/src/types.ts \
        ui/src/lib/studio/studioStore.ts \
        ui/src/components/studio/StudioNode.tsx \
        ui/src/components/studio/edgeStyles.ts \
        studio-v2-phase6-branch.png
git commit -m "Studio v2 phase 6 slice E: branch output handles + colored edges

- Two output handles on logic_branch_if (out-true green / out-false red)
- serializeStore emits inputs[] with edge_type from sourceHandle
- hydrateFromFlow reads inputs and restores sourceHandle
- edgeStyleFor() colors and labels edges by type
- Visual verified Chrome MCP — round-trip Save/Load preserves colors"
```

---

## Slice F — Frontend: Validate button + Issues tab

**Files:**
- Modify: `ui/src/lib/studio/studioStore.ts` — add `validateState` slice
- Modify: `ui/src/components/studio/BottomPanel.tsx` — add Issues tab
- Modify: `ui/src/components/studio/StudioToolbar.tsx` — Validate button
- Modify: `ui/src/pages/IntegrationStudioV2Page.tsx` — wire Validate button

### Slice F · Step 1 — Add validateState to store

- [ ] **Edit `ui/src/lib/studio/studioStore.ts`** — add at the top with other type defs:

```typescript
import type { IntegrationFlowGraphIssue } from "../../types";

export type StudioValidateState = {
  running: boolean;
  lastResult: { valid: boolean; issues: IntegrationFlowGraphIssue[] } | null;
  error: string | null;
};
```

Add to the `StudioStore` type:
```typescript
  validateState: StudioValidateState;
  setValidateRunning: (running: boolean) => void;
  setValidateResult: (valid: boolean, issues: IntegrationFlowGraphIssue[]) => void;
  setValidateError: (error: string | null) => void;
```

Initial state:
```typescript
const EMPTY_VALIDATE_STATE: StudioValidateState = {
  running: false,
  lastResult: null,
  error: null,
};
```

In the store factory:
```typescript
  validateState: EMPTY_VALIDATE_STATE,

  setValidateRunning: (running) =>
    set((s) => ({ validateState: { ...s.validateState, running, error: null } })),
  setValidateResult: (valid, issues) =>
    set({ validateState: { running: false, lastResult: { valid, issues }, error: null } }),
  setValidateError: (error) =>
    set((s) => ({ validateState: { ...s.validateState, running: false, error } })),
```

Reset on `resetFlow`:
```typescript
  resetFlow: (flowId, name) =>
    set({
      flowId,
      flowName: name,
      nodes: [],
      edges: [],
      selectedNodeId: null,
      dirty: false,
      runState: EMPTY_RUN_STATE,
      validateState: EMPTY_VALIDATE_STATE,
    }),
```

- [ ] **Step 2 — Add Validate button in toolbar**

Open `ui/src/components/studio/StudioToolbar.tsx`. Add a new button between Save and Run (whatever button ordering exists):

```tsx
<Button
  variant="ghost"
  onClick={onValidate}
  disabled={validateRunning || dirty}
  title={dirty ? "Save before validating" : "Validate the flow graph"}
>
  {validateRunning ? "Validating…" : "Validate"}
</Button>
```

The toolbar already takes props for Save/Run handlers; add `onValidate: () => void` and `validateRunning: boolean` and `dirty: boolean` to the props type.

- [ ] **Step 3 — Wire Validate in IntegrationStudioV2Page**

Open `ui/src/pages/IntegrationStudioV2Page.tsx`. Find where `onSave` and `onRun` are defined. Add:

```tsx
const onValidate = useCallback(async () => {
  if (!flowId) return;
  setValidateRunning(true);
  try {
    const response = await fetch(
      `/integration/flows/${flowId}/validate-graph`,
      {
        method: "POST",
        headers: organizationHeaders(),  // reuse existing header helper
      },
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body: IntegrationFlowValidateGraphResult = await response.json();
    setValidateResult(body.valid, body.issues);
  } catch (err) {
    setValidateError(err instanceof Error ? err.message : String(err));
  }
}, [flowId, setValidateRunning, setValidateResult, setValidateError]);
```

Pass `onValidate`, `validateRunning`, `dirty` to `<StudioToolbar />`.

- [ ] **Step 4 — Add Issues tab in BottomPanel**

Open `ui/src/components/studio/BottomPanel.tsx`. Add a new tab key alongside `Input | Output | Logs | Schema`:

```tsx
<TabsList>
  <TabsTrigger value="input">Input</TabsTrigger>
  <TabsTrigger value="output">Output</TabsTrigger>
  <TabsTrigger value="logs">Logs</TabsTrigger>
  <TabsTrigger value="schema">Schema</TabsTrigger>
  <TabsTrigger value="issues">
    Issues {hasErrors && <span style={{ color: "var(--crit)" }}>●</span>}
  </TabsTrigger>
</TabsList>

<TabsContent value="issues">
  {!validateState.lastResult ? (
    <p style={{ color: "var(--text-muted)" }}>
      Run Validate to check the flow graph.
    </p>
  ) : validateState.lastResult.issues.length === 0 ? (
    <p style={{ color: "var(--ok)" }}>No issues found.</p>
  ) : (
    <ul>
      {validateState.lastResult.issues.map((issue, idx) => (
        <li
          key={idx}
          style={{
            color: issue.severity === "error" ? "var(--crit)" : "var(--warn)",
          }}
        >
          <strong>{issue.code}</strong> — {issue.message}
          {issue.block_ids.length > 0 && (
            <span style={{ color: "var(--text-muted)" }}>
              {" "}({issue.block_ids.join(", ")})
            </span>
          )}
        </li>
      ))}
    </ul>
  )}
</TabsContent>
```

The component must read `validateState` from the store. Adjust imports.

- [ ] **Step 5 — Typecheck and build**

Run: `cd ui && npx tsc --noEmit`
Expected: PASS.

Run: `cd ui && npm run build`
Expected: PASS.

- [ ] **Step 6 — Visual review with Chrome MCP**

1. Open `http://localhost:5173/#/integration/studio-v2?flow_id=<id-from-slice-E>`.
2. Click **Validate** in the toolbar. Verify spinner / disabled state.
3. The Issues tab in BottomPanel populates with "No issues found." (green) for the valid branch flow from Slice E.
4. Now create a cycle manually: drag an extra `logic_merge` block, draw an edge merge → if-block, save, validate.
5. Issues tab should show the cycle issue (red, code="cycle", message includes both block ids).
6. Take screenshot `studio-v2-phase6-validate.png`.

- [ ] **Step 7 — Commit Slice F**

```bash
git add ui/src/lib/studio/studioStore.ts \
        ui/src/components/studio/BottomPanel.tsx \
        ui/src/components/studio/StudioToolbar.tsx \
        ui/src/pages/IntegrationStudioV2Page.tsx \
        studio-v2-phase6-validate.png
git commit -m "Studio v2 phase 6 slice F: Validate button + Issues tab

- Toolbar Validate calls POST /flows/{id}/validate-graph
- BottomPanel Issues tab surfaces cycles / dangling / unknown_source
- Red dot indicator on tab when errors present
- validateState slice in studioStore (running / lastResult / error)
- Visual verified Chrome MCP: cycle detected and flagged"
```

---

## Final Verification

- [ ] **Run the full unit suite once more**

Run: `python -m pytest tests/unit -q`
Expected: **876 PASSED** (Slice D total) — Slices E and F don't add Python tests.

- [ ] **Run integration & real-stack suites**

Run: `python -m pytest tests/integration -q`
Run: `python -m pytest tests/integration/test_real_stack_postgres.py -q`
Expected: same green baseline as before Phase 6.

- [ ] **Lint check**

Run: `make lint`
Expected: baseline 51 errors preserved (or any net delta is documented).

- [ ] **End-to-end smoke**

Walk through, in Chrome MCP:
1. New flow → drag Manual + If + 2 Export APS Data blocks.
2. Wire If's true → first export, false → second export.
3. Save → Validate (no issues) → Run.
4. BottomPanel shows: branch decision in If's trace; one export ran; the other has status="skipped".

This proves the full vertical: catalog → DAG runner → branch logic → trace persistence → Validate endpoint → Issues UI.

- [ ] **Update memory `resume_j1.md`** to reflect Phase 6 completion: 6 commits, ~876 tests, list of new files. Don't recap individual slice steps — just the headline numbers Sam needs at next session start.

---

## Notes on scope discipline (Sam's locked method)

- **Each slice ships independently.** If Slice C uncovers a regression in Slice B's topo order, fix B first as its own commit; do not pile fixes onto C.
- **Frontend slices use Chrome MCP to verify, not "the build is green".** Build-green doesn't catch a black/black branch-edge bug.
- **No gratuitous refactor.** `integration_flows.py` is 4374 lines — splitting is Studio pass 3, not Phase 6. Do not restructure files this phase touches beyond adding the new helpers.
- **Hexagonal preserved.** The new use case `ValidateIntegrationFlowGraph` lives in `application/use_cases/`. The new `FlowBlockInput` lives in `application/ports/`. Routes / API stay thin.
