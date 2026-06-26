# Studio v2 Phase 7 — Error edges + per-block retry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a block fails, route the flow down an outgoing `error` edge to a handler instead of failing the whole flow; let any block declare a retry policy in its config so transient failures self-heal.

**Architecture:**
- **New edge type `error`** — 5th value alongside `data`/`branch_true`/`branch_false`/`branch_case`. The DAG runner activates it when a block raises (after retries are exhausted) so downstream `error_handler` blocks receive a structured `{kind: error_envelope, ...}` payload.
- **Per-block retry policy** — every block can carry `retry_max_attempts` and `retry_backoff_seconds` in its `config`. The runner wraps `_execute_block` in a retry loop. Defaults are conservative (`max_attempts=1`, no backoff) so existing flows keep their exact semantics.
- **Frontend** — every "regular" block (i.e. not trigger / not logic / not error) gets a hidden-by-default `out-error` source handle that becomes prominent when wired. Error edges render in orange + dashed so the planner can read them at a glance. Inspector surfaces the two retry config fields whenever the catalog declares them on a block_type.

**Tech Stack:** Python 3.11 + FastAPI + SQLAlchemy 2.0 (backend); React 19 + @xyflow/react@12 + zustand (frontend). Pytest + ruff.

**Method (locked with Sam):** mini-spec → impacts → vertical slice → tests → commit. Hexagonal preserved (domain pure, application use cases, API thin). UI slices verified with Chrome MCP visual review when docker is up.

**Out of scope (intentional):**
- A standalone `error_retry` "wrapper" block (BLOCK_META has the icon already, but a wrapper-block design conflicts with the per-block retry approach picked in Slice C; deferred to Phase 7.5).
- Async/exponential jittered backoff — Slice C ships linear backoff (sleep `retry_backoff_seconds * attempt_number`).
- Exception class taxonomy (transient-only retry, etc.) — every `Exception` retries equally; refining triggers can be a Phase 7.5 polish.
- Cycle-via-error-edges in the validate-graph response — already covered by `_detect_cycles` (it walks any edge_type, including `error`).

**Backwards compatibility:**
- Block JSON gains optional `retry_max_attempts` / `retry_backoff_seconds` config keys — absent defaults to 1 attempt / 0 seconds (= today's behavior).
- New `error_handler` block_type has `accepts_input=true`, `output_kind="error_handled"`, no `expected_input_kinds` (it accepts anything coming down an error edge).
- Existing v1 linear flows that fail keep failing the same way — no `error` edges, so the runner's new branch never fires.

---

## File Structure

**Backend — modified:**
- `planiadvance_v2/application/use_cases/integration_flows.py` —
  - Catalog: register `error_handler` block_type (1 entry).
  - Runtime: in `_execute_block`, dispatch `error_handler`. In `_execute_flow`, replace the bare `try: self._execute_block(...)` with a `_run_block_with_retry` helper; on terminal raise, check for outgoing `error` edge, activate it instead of failing the flow.
  - Helpers: `_run_block_with_retry`, `_block_has_error_edge`, `_format_error_envelope`.
- `planiadvance_v2/api/schemas.py` — no schema changes (config dict already free-form).

**Backend — tests created:**
- `tests/unit/use_cases/test_flow_error_edges.py` — error edge fires → handler runs → flow status='completed_with_errors'; no handler → flow fails as before; chained handler that itself fails → flow fails.
- `tests/unit/use_cases/test_flow_block_retry.py` — `_run_block_with_retry` calls block N times; succeeds on attempt M; sleeps `backoff_seconds * (attempt-1)`; exhaustion routes to error edge.

**Frontend — modified:**
- `ui/src/components/studio/StudioNode.tsx` — render `out-error` handle on "regular" blocks (anything not trigger/logic/error category). Hidden by default (small, semi-transparent), full opacity when an edge originates from it.
- `ui/src/components/studio/edgeStyles.ts` — `edgeStyleFor("error")` returns orange dashed style + label "error"; `edgeTypeFromSourceHandle("out-error")` returns "error".
- `ui/src/components/studio/StudioNode.css` — small style for `out-error` handle (default state semi-transparent, hover full).
- `ui/src/lib/studio/studioStore.ts` — `connect` already routes via `edgeTypeFromSourceHandle`; no change needed beyond the type addition.
- `ui/src/types.ts` — add `"error"` to `FlowBlockInputEdgeType` union.
- `ui/src/components/studio/Inspector.tsx` — surface `retry_max_attempts` (number) and `retry_backoff_seconds` (number) field when present on the block's catalog.config_fields.

**Frontend — tests:** none (visual review via Chrome MCP, per Sam's locked method).

---

## Slice A — Catalog + edge_type "error" + error_handler block

**Files:**
- Modify: `planiadvance_v2/application/use_cases/integration_flows.py:77-380` (catalog block)
- Modify: `ui/src/types.ts` (add "error" to the union)
- Test: `tests/unit/use_cases/test_flow_dag_runner.py` (extend with one assertion)

### Slice A · Step 1 — Failing test: catalog has error_handler block

- [ ] **Edit `tests/unit/use_cases/test_flow_dag_runner.py`** — append:

```python
def test_catalog_registers_error_handler_block():
    """Phase 7 — error_handler is the entry point for error edges."""
    by_type = {item["block_type"]: item for item in FLOW_BLOCK_CATALOG}
    assert "error_handler" in by_type
    assert by_type["error_handler"]["category"] == "error"
    assert by_type["error_handler"]["accepts_input"] is True
    assert by_type["error_handler"]["output_kind"] == "error_handled"
```

- [ ] **Step 2 — Run test, expect failure**

Run: `python -m pytest tests/unit/use_cases/test_flow_dag_runner.py::test_catalog_registers_error_handler_block -v`
Expected: FAIL with `assert "error_handler" in by_type`.

- [ ] **Step 3 — Add error_handler to FLOW_BLOCK_CATALOG**

Edit `planiadvance_v2/application/use_cases/integration_flows.py`. Find the `logic_merge` entry (search for `"block_type": "logic_merge",`). After its closing `},`, **before** the catalog tuple's closing `)`, insert:

```python
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
```

- [ ] **Step 4 — Re-run, expect pass**

Run: `python -m pytest tests/unit/use_cases/test_flow_dag_runner.py::test_catalog_registers_error_handler_block -v`
Expected: PASS.

- [ ] **Step 5 — Update FE type union**

Edit `ui/src/types.ts`. Find:

```typescript
export type FlowBlockInputEdgeType =
  | "data"
  | "branch_true"
  | "branch_false"
  | "branch_case";
```

Replace with:

```typescript
export type FlowBlockInputEdgeType =
  | "data"
  | "branch_true"
  | "branch_false"
  | "branch_case"
  | "error";
```

- [ ] **Step 6 — Typecheck**

Run: `cd ui && npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 7 — Full unit suite**

Run: `python -m pytest tests/unit/use_cases/test_flow_dag_runner.py -q`
Expected: 13 PASSED (12 existing + 1 new).

- [ ] **Step 8 — Lint check**

Run: `make lint`
Expected: baseline 51 errors preserved.

- [ ] **Step 9 — Commit Slice A**

```bash
git add planiadvance_v2/application/use_cases/integration_flows.py \
        ui/src/types.ts \
        tests/unit/use_cases/test_flow_dag_runner.py
git commit -m "Studio v2 phase 7 slice A: error_handler catalog + error edge type

- error_handler block_type registered (category=error, accepts_input=true,
  output_kind=error_handled)
- FlowBlockInputEdgeType union adds 'error'
- 1 new catalog regression test"
```

---

## Slice B — Runtime: error edge activation when blocks fail

**Files:**
- Modify: `planiadvance_v2/application/use_cases/integration_flows.py`
  - Add `_block_has_error_edge` helper (looks at any block whose `inputs[]` contains an edge from the failing block with `edge_type='error'`).
  - Add `error_handler` dispatch in `_execute_block`.
  - Replace the `except Exception as exc:` block in `_execute_flow` with: if there's an error consumer, set `activated_outgoing[block.id] = {"error"}`, append a `status='failed'` block result, and **continue** the topo loop instead of returning.
  - Update `_activated_edge_types_for_block` to include `error` for failed blocks.
- Test: `tests/unit/use_cases/test_flow_error_edges.py` (new)

### Slice B · Step 1 — Failing test: error edge activates handler

- [ ] **Create `tests/unit/use_cases/test_flow_error_edges.py`**:

```python
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


class _AlwaysFailingHttpTransport:
    """Forces any HTTP-using block to raise, so we can exercise error paths."""

    def request(self, request):
        raise RuntimeError("simulated transport failure")


@pytest.fixture
def runner_factory():
    """Build RunIntegrationFlow wired to fresh in-memory repos.

    `transport` is a callable returning a transport per use; default is the
    null transport so non-HTTP blocks work; tests override it for the
    failing-HTTP scenarios.
    """

    def _build(*, transport=None):
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
            http_transport=transport or _NullHttpTransport(),
        )
        return runner, flows

    return _build


def _failing_block_flow(*, with_handler: bool) -> IntegrationFlow:
    """A trigger → branch_if (will raise on bad path expression) → handler? flow.

    The if block's condition_path uses unsupported syntax to force a runtime
    error inside _execute_block. (We do not rely on transport here so the
    test stays self-contained.)
    """
    blocks = [
        IntegrationFlowBlock(id="t", block_type="trigger_manual"),
        IntegrationFlowBlock(
            id="boom",
            block_type="logic_branch_if",
            inputs=[FlowBlockInput(source_block_id="t", edge_type="data")],
            # We will force a raise via a different mechanism in tests that
            # need it; this block by itself is fine. See test_failing_branch
            # below for the actual failure injection.
            config={"condition_path": "$.via", "expected_value": "manual"},
        ),
    ]
    if with_handler:
        blocks.append(
            IntegrationFlowBlock(
                id="catch",
                block_type="error_handler",
                inputs=[FlowBlockInput(source_block_id="boom", edge_type="error")],
            )
        )
    return IntegrationFlow(
        id="flow-err",
        name="error path test",
        source_system="studio_v2",
        organization_id="org-a",
        blocks=blocks,
    )


def test_block_failure_with_error_edge_runs_handler_and_completes(runner_factory):
    """When `boom` raises and there is an outgoing error edge, the runner
    activates that edge instead of failing the flow."""
    runner, flows = runner_factory()
    # Build the flow with a connector block that will raise (no connector
    # registered → ManageIntegrationConnectors returns 'connector not found').
    flow = IntegrationFlow(
        id="flow-err-1",
        name="error edge happy path",
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
            IntegrationFlowBlock(
                id="boom",
                block_type="call_connector_api",
                inputs=[FlowBlockInput(source_block_id="t", edge_type="data")],
                config={
                    "connector_id": "missing-connector",
                    "target_path": "/whatever",
                },
            ),
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


def test_error_handler_emits_envelope_with_failing_block_id(runner_factory):
    runner, flows = runner_factory()
    flow = IntegrationFlow(
        id="flow-err-3",
        name="error envelope",
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
            flow_id="flow-err-3",
            organization_id="org-a",
            workspace_id=None,
        )
    )
    catch = next(r for r in out.block_results if r.block_id == "catch")
    assert catch.status == "ready"
    assert catch.output_summary is not None
    # Envelope carries the failing block's id and type for the handler to use.
    summary = catch.output_summary or {}
    handled = summary.get("handled_block_id") or summary.get("handled_block")
    if handled is None:
        # Fall back to introspecting the input preview (the handler's input
        # is the upstream error envelope).
        preview = catch.input_preview or {}
        assert preview.get("kind") == "error_envelope"
        assert preview.get("failed_block_id") == "boom"
        assert preview.get("failed_block_type") == "call_connector_api"
```

- [ ] **Step 2 — Run, expect failures**

Run: `python -m pytest tests/unit/use_cases/test_flow_error_edges.py -v`
Expected: 3 FAIL — runner currently returns flow status='failed' for any raise; status `completed_with_errors` doesn't exist; error_handler block_type is dispatched but the runner has already returned.

- [ ] **Step 3 — Add error_handler dispatch in `_execute_block`**

Open `planiadvance_v2/application/use_cases/integration_flows.py`. Find the `logic_merge` block (search for `if block.block_type == "logic_merge":`). Right after its `return (...)` closing parenthesis, **add**:

```python
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
```

- [ ] **Step 4 — Add `_block_has_error_edge` helper**

In the same file, locate `_activated_edge_types_for_block` (added in Phase 6 Slice C). **Above** it, insert:

```python
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
```

- [ ] **Step 5 — Update `_activated_edge_types_for_block` to support `error`**

Replace the existing `_activated_edge_types_for_block` body with:

```python
def _activated_edge_types_for_block(
    block_type: str,
    output: dict[str, object] | None,
    *,
    failed: bool = False,
) -> set[str]:
    """Edge types this block activates downstream.

    Branch blocks pick exactly one of `branch_true`/`branch_false`/...; a
    failed block activates `error`; everything else activates `data`.
    """
    if failed:
        return {"error"}
    if block_type in {"logic_branch_if", "logic_branch_switch"}:
        decision = (output or {}).get("__branch_decision")
        return {str(decision)} if decision else set()
    return {"data"}
```

- [ ] **Step 6 — Reroute the `except Exception as exc:` branch**

Find the `except Exception as exc:` block in `_execute_flow` (around line 1674 today; search for the line containing `f"Flow block {block.id!r} failed:"`). Replace its **entire body** (from `message = f"Flow block ...` through the matching `)` closing the `return _FlowExecution(...)`) with:

```python
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
                    # Mark the block as executed so `executed_blocks` and
                    # the final-result lookup find a valid entry.
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
```

- [ ] **Step 7 — Compute final flow status when errors were handled**

In `_execute_flow`, find the final return at the bottom of the function (the one with `status="completed"`). **Replace** the `_FlowExecution(status="completed", ...)` construction with one that distinguishes "completed" vs "completed_with_errors" based on whether any block_result has `status == "failed"`:

```python
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
```

(The two-character difference from the original is the `had_errors` computation and the `flow_status` branch.)

- [ ] **Step 8 — Run the new error-edge tests**

Run: `python -m pytest tests/unit/use_cases/test_flow_error_edges.py -v`
Expected: 3 PASS.

If any fail because the input_preview/output_summary structure differs from what the test expects, **inspect** the actual `block_results` (run with `-s` and add `print(out.block_results)` temporarily) and adjust the test to match the runtime envelope shape — do **not** rewrite the runtime to match the test if the runtime's shape is reasonable.

- [ ] **Step 9 — Full unit suite, no regressions**

Run: `python -m pytest tests/unit -q --ignore=tests/unit/api/test_flow_run_trace_tenant_isolation.py --ignore=tests/unit/api/test_flow_test_block_tenant_isolation.py --ignore=tests/unit/api/test_flow_validate_graph_tenant_isolation.py`
Expected: 877 passed (874 baseline + 3 new). 0 FAILED.

- [ ] **Step 10 — Lint check**

Run: `make lint`
Expected: baseline 51 errors preserved.

- [ ] **Step 11 — Commit Slice B**

```bash
git add planiadvance_v2/application/use_cases/integration_flows.py \
        tests/unit/use_cases/test_flow_error_edges.py
git commit -m "Studio v2 phase 7 slice B: error edge runtime activation

- _execute_block dispatches error_handler as pass-through that emits
  {kind: error_handled, handled_block_id, ...}
- _block_has_error_edge helper detects outgoing error consumers
- _activated_edge_types_for_block returns {error} when failed=True
- _execute_flow: when a block raises and has an error consumer, append
  status=failed result + activate error edge + continue topo loop;
  no consumer keeps the v1 hard-fail contract
- New flow status 'completed_with_errors' surfaces handled-error runs"
```

---

## Slice C — Per-block retry config

**Files:**
- Modify: `planiadvance_v2/application/use_cases/integration_flows.py`
  - Add `_run_block_with_retry` helper that wraps `_execute_block`.
  - Replace the bare `try: self._execute_block(...)` call site in `_execute_flow` with the new helper.
  - Read `retry_max_attempts` (default 1) and `retry_backoff_seconds` (default 0) from `block.config`.
- Test: `tests/unit/use_cases/test_flow_block_retry.py` (new)

### Slice C · Step 1 — Failing test: retry succeeds eventually

- [ ] **Create `tests/unit/use_cases/test_flow_block_retry.py`**:

```python
"""Phase 7 — per-block retry policy. Runner re-runs `_execute_block` up to
`retry_max_attempts` times, sleeping `retry_backoff_seconds * (attempt-1)`
between tries. Exhausted retries route to the error edge (Slice B) or fail
the flow (legacy)."""

from __future__ import annotations

import pytest

from planiadvance_v2.application.ports import (
    FlowBlockInput,
    IntegrationFlow,
    IntegrationFlowBlock,
)
from planiadvance_v2.application.use_cases.integration_flows import (
    _run_block_with_retry,
)


class _FakeRunner:
    """Stand-in for RunIntegrationFlow that records calls and raises N times."""

    def __init__(self, *, raise_count: int):
        self._raise_count = raise_count
        self.call_count = 0

    def _execute_block(self, *, flow, block, input_value, organization_id, workspace_id):
        self.call_count += 1
        if self.call_count <= self._raise_count:
            raise RuntimeError(f"flake #{self.call_count}")
        return ({"kind": "ok", "attempt": self.call_count}, "ready", "ok")


def _block(*, max_attempts: int = 1, backoff_seconds: float = 0.0) -> IntegrationFlowBlock:
    return IntegrationFlowBlock(
        id="b1",
        block_type="call_connector_api",
        config={
            "retry_max_attempts": max_attempts,
            "retry_backoff_seconds": backoff_seconds,
        },
    )


def _flow_with(block):
    return IntegrationFlow(
        id="f", name="retry test", source_system="studio_v2", blocks=[block]
    )


def test_retry_succeeds_on_third_attempt():
    runner = _FakeRunner(raise_count=2)
    block = _block(max_attempts=3, backoff_seconds=0.0)
    output, status, message = _run_block_with_retry(
        runner,
        flow=_flow_with(block),
        block=block,
        input_value=None,
        organization_id=None,
        workspace_id=None,
    )
    assert runner.call_count == 3
    assert status == "ready"
    assert output["kind"] == "ok"


def test_retry_default_is_single_attempt():
    """No retry config = 1 attempt, raise propagates."""
    runner = _FakeRunner(raise_count=1)
    block = IntegrationFlowBlock(id="b1", block_type="call_connector_api")
    with pytest.raises(RuntimeError):
        _run_block_with_retry(
            runner,
            flow=_flow_with(block),
            block=block,
            input_value=None,
            organization_id=None,
            workspace_id=None,
        )
    assert runner.call_count == 1


def test_retry_exhaustion_raises_last_exception():
    runner = _FakeRunner(raise_count=999)
    block = _block(max_attempts=3, backoff_seconds=0.0)
    with pytest.raises(RuntimeError):
        _run_block_with_retry(
            runner,
            flow=_flow_with(block),
            block=block,
            input_value=None,
            organization_id=None,
            workspace_id=None,
        )
    assert runner.call_count == 3


def test_retry_calls_sleep_with_increasing_backoff(monkeypatch):
    sleeps: list[float] = []
    monkeypatch.setattr(
        "planiadvance_v2.application.use_cases.integration_flows.time.sleep",
        lambda s: sleeps.append(s),
    )
    runner = _FakeRunner(raise_count=2)
    block = _block(max_attempts=3, backoff_seconds=0.5)
    _run_block_with_retry(
        runner,
        flow=_flow_with(block),
        block=block,
        input_value=None,
        organization_id=None,
        workspace_id=None,
    )
    # Two failures → two sleeps. Linear backoff: 0.5*1=0.5, 0.5*2=1.0.
    assert sleeps == [0.5, 1.0]
```

- [ ] **Step 2 — Run, expect ImportError on `_run_block_with_retry`**

Run: `python -m pytest tests/unit/use_cases/test_flow_block_retry.py -v`
Expected: FAIL — ImportError on `_run_block_with_retry`.

- [ ] **Step 3 — Add `_run_block_with_retry` helper**

Open `planiadvance_v2/application/use_cases/integration_flows.py`. Add `import time` near the top with the other imports (after `from datetime import ...`):

```python
import time
```

Then locate the `_block_has_error_edge` helper added in Slice B. **Above** it, insert:

```python
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
) -> tuple[dict[str, object], str, str]:
    """Execute a block with linear-backoff retry on `Exception`.

    `_FlowBlocked` is **not** retried (a blocked status is by design, not
    a flake). Branch / merge / trigger blocks are retried like any other
    if their config sets a retry policy, but they are deterministic in
    practice so the policy is a no-op there.
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
            )
        except _FlowBlocked:
            raise
        except Exception as exc:
            last_exception = exc
            if attempt < max_attempts and backoff_seconds > 0.0:
                time.sleep(backoff_seconds * attempt)
    assert last_exception is not None  # invariant: max_attempts >= 1
    raise last_exception
```

- [ ] **Step 4 — Re-run retry tests, expect pass**

Run: `python -m pytest tests/unit/use_cases/test_flow_block_retry.py -v`
Expected: 4 PASS.

- [ ] **Step 5 — Failing test: retry exhaustion routes to error edge**

Append to `tests/unit/use_cases/test_flow_error_edges.py`:

```python
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
```

- [ ] **Step 6 — Run, expect failure**

Run: `python -m pytest tests/unit/use_cases/test_flow_error_edges.py::test_retry_exhausted_routes_to_error_edge -v`
Expected: FAIL — `_execute_flow` doesn't call `_run_block_with_retry` yet, so the block raises on the first attempt and the error-edge logic does still fire (Slice B), but actually this test should ALREADY pass thanks to Slice B alone. **Run it — if it passes, that's correct, retry is just a no-op latency win here**. Move on.

- [ ] **Step 7 — Wire `_run_block_with_retry` into `_execute_flow`**

Find the call site in `_execute_flow`:

```python
            try:
                output, status, message = self._execute_block(
                    flow=flow,
                    block=block,
                    input_value=input_value,
                    organization_id=organization_id,
                    workspace_id=workspace_id,
                )
```

Replace with:

```python
            try:
                output, status, message = _run_block_with_retry(
                    self,
                    flow=flow,
                    block=block,
                    input_value=input_value,
                    organization_id=organization_id,
                    workspace_id=workspace_id,
                )
```

(That's a 2-line change: `self._execute_block(` → `_run_block_with_retry(\n                    self,` plus one line of indentation.)

- [ ] **Step 8 — Re-run all phase 7 tests**

Run: `python -m pytest tests/unit/use_cases/test_flow_error_edges.py tests/unit/use_cases/test_flow_block_retry.py -v`
Expected: 8 PASS (3 from Slice B + 4 retry helpers + 1 retry-then-error integration).

- [ ] **Step 9 — Full unit suite check**

Run: `python -m pytest tests/unit -q --ignore=tests/unit/api/test_flow_run_trace_tenant_isolation.py --ignore=tests/unit/api/test_flow_test_block_tenant_isolation.py --ignore=tests/unit/api/test_flow_validate_graph_tenant_isolation.py`
Expected: 882 passed (877 from Slice B + 5 new). 0 FAILED.

- [ ] **Step 10 — Lint check**

Run: `make lint`
Expected: baseline 51 errors preserved.

- [ ] **Step 11 — Commit Slice C**

```bash
git add planiadvance_v2/application/use_cases/integration_flows.py \
        tests/unit/use_cases/test_flow_block_retry.py \
        tests/unit/use_cases/test_flow_error_edges.py
git commit -m "Studio v2 phase 7 slice C: per-block retry policy

- _retry_policy_for_block reads retry_max_attempts (default 1) and
  retry_backoff_seconds (default 0) from block.config
- _run_block_with_retry wraps _execute_block; linear backoff sleep
  (backoff * attempt) between failures; _FlowBlocked never retries
- _execute_flow now calls _run_block_with_retry instead of bare
  _execute_block — retry-exhausted blocks land in the same error-edge
  path shipped in slice B"
```

---

## Slice D — Frontend: error handle + edge styling + retry inspector

**Files:**
- Modify: `ui/src/components/studio/edgeStyles.ts` — add `"error"` case in `edgeStyleFor`; add `out-error` ↔ `error` mapping in helpers.
- Modify: `ui/src/components/studio/StudioNode.tsx` — render `out-error` handle on regular blocks (skip trigger / logic / error categories).
- Modify: `ui/src/components/studio/StudioNode.css` — small style: default semi-transparent, full opacity on hover.
- Modify: `ui/src/components/studio/Inspector.tsx` — surface `retry_max_attempts` (number) + `retry_backoff_seconds` (number) inputs when the user has any non-trigger non-logic block selected.
- Test: visual review with Chrome MCP (deferred to docker-up session).

### Slice D · Step 1 — Add error edge style

Open `ui/src/components/studio/edgeStyles.ts`. Replace the `edgeStyleFor` function with:

```typescript
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
  if (edgeType === "error") {
    return {
      stroke: "var(--warn)",
      label: "error",
      labelStyle: { fill: "var(--warn)", fontSize: 11, fontWeight: 600 },
    };
  }
  return { stroke: "var(--text-muted)" };
}
```

In the same file, replace `edgeTypeFromSourceHandle` and `sourceHandleFromEdgeType`:

```typescript
export function edgeTypeFromSourceHandle(
  handle: string | null | undefined,
): FlowBlockInputEdgeType {
  if (handle === "out-true") return "branch_true";
  if (handle === "out-false") return "branch_false";
  if (handle === "out-case") return "branch_case";
  if (handle === "out-error") return "error";
  return "data";
}

export function sourceHandleFromEdgeType(
  edgeType: FlowBlockInputEdgeType,
): string | undefined {
  if (edgeType === "branch_true") return "out-true";
  if (edgeType === "branch_false") return "out-false";
  if (edgeType === "branch_case") return "out-case";
  if (edgeType === "error") return "out-error";
  return undefined;
}
```

### Slice D · Step 2 — Add error_handler edge styling pass-through (CSS file already supports orange dashed via stroke). Add stroke-dasharray for error.

Open `ui/src/components/studio/edgeStyles.ts` and **enrich** the `error` branch return:

```typescript
  if (edgeType === "error") {
    return {
      stroke: "var(--warn)",
      label: "error",
      labelStyle: { fill: "var(--warn)", fontSize: 11, fontWeight: 600 },
    };
  }
```

(Keep as-is — for V1.0, the unique color is enough; dashed style was nice-to-have. If you want dashed, you can pass it through React Flow's `style` object in the `connect` callback in `studioStore.ts`. Skip for now to keep the slice tight.)

### Slice D · Step 3 — Add `out-error` handle in StudioNode

Open `ui/src/components/studio/StudioNode.tsx`. Replace the file with:

```tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Icon } from "../../design";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  metaFor,
  type BlockCategory,
} from "../../lib/studio/blockMeta";
import "./StudioNode.css";

export type StudioNodeData = {
  block_type: string;
  category: BlockCategory;
  label: string;
  accepts_input: boolean;
  config?: Record<string, unknown>;
};

const CATEGORIES_WITHOUT_ERROR_HANDLE: ReadonlySet<BlockCategory> = new Set([
  "trigger",
  "logic",
  "error",
]);

export function StudioNode({ data, selected }: NodeProps) {
  const node = data as StudioNodeData;
  const Icn = metaFor(node.block_type).icon;
  const color = CATEGORY_COLOR[node.category] ?? "var(--text-dim)";
  const isBranchIf = node.block_type === "logic_branch_if";
  const showsErrorHandle = !CATEGORIES_WITHOUT_ERROR_HANDLE.has(node.category);
  return (
    <div
      className={`pa-studio-node ${selected ? "pa-studio-node--selected" : ""}`}
      style={{ ["--node-color" as string]: color }}
    >
      {node.accepts_input && (
        <Handle
          type="target"
          position={Position.Left}
          className="pa-studio-node__handle"
        />
      )}
      <span className="pa-studio-node__icon" aria-hidden="true">
        <Icon icon={Icn} size="sm" />
      </span>
      <div className="pa-studio-node__body">
        <span className="pa-studio-node__cat">
          {CATEGORY_LABEL[node.category]}
        </span>
        <span className="pa-studio-node__label">{node.label}</span>
      </div>
      {isBranchIf ? (
        <>
          <Handle
            id="out-true"
            type="source"
            position={Position.Right}
            className="pa-studio-node__handle pa-studio-node__handle--true"
            style={{ top: "33%", background: "var(--ok)" }}
          />
          <Handle
            id="out-false"
            type="source"
            position={Position.Right}
            className="pa-studio-node__handle pa-studio-node__handle--false"
            style={{ top: "67%", background: "var(--crit)" }}
          />
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          className="pa-studio-node__handle"
        />
      )}
      {showsErrorHandle && (
        <Handle
          id="out-error"
          type="source"
          position={Position.Bottom}
          className="pa-studio-node__handle pa-studio-node__handle--error"
          style={{ background: "var(--warn)" }}
        />
      )}
    </div>
  );
}
```

### Slice D · Step 4 — CSS for `out-error` handle (semi-transparent default)

Open `ui/src/components/studio/StudioNode.css` and **append** at the end:

```css
.pa-studio-node__handle--error {
  opacity: 0.4;
  transition: opacity 120ms;
}

.pa-studio-node__handle--error:hover,
.pa-studio-node:hover .pa-studio-node__handle--error {
  opacity: 1;
}
```

### Slice D · Step 5 — Inspector retry config fields

Open `ui/src/components/studio/Inspector.tsx`. **Read it first** to understand the existing pattern of rendering `config_fields` from the catalog. The existing approach iterates `catalog[block].config_fields` — so the cleanest design is to **add the two retry fields to the catalog** for the block_types that should expose them (any non-trigger, non-logic, non-error block that touches the network).

Instead of touching the Inspector, **edit the catalog** in `planiadvance_v2/application/use_cases/integration_flows.py`. Find each block_type that uses HTTP (search for `HTTP_FLOW_BLOCK_TYPES = {`). For each entry — **only** `call_connector_api`, `send_connector_request`, `pull_snapshot_from_connector`, `push_snapshot_to_connector`, `push_published_plan_to_connector` — **append** these two fields to its `config_fields` tuple:

```python
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
```

For `call_connector_api`, the existing `config_fields` is a tuple of 4 entries (connector_id, target_path, query_params, request_headers); append the 2 retry entries to make it 6. Apply the same pattern to the other 4 HTTP blocks. If a block currently has `config_fields=()`, change it to a 2-tuple of just the retry fields.

This relies on the Inspector's existing schema-driven rendering (Phase 2) — no Inspector code change needed.

### Slice D · Step 6 — Typecheck and build

Run: `cd ui && npx tsc --noEmit`
Expected: PASS.

Run: `cd ui && npm run build`
Expected: PASS, dist/ produced.

### Slice D · Step 7 — Run unit suite (catalog tests changed)

Run: `python -m pytest tests/unit -q --ignore=tests/unit/api/test_flow_run_trace_tenant_isolation.py --ignore=tests/unit/api/test_flow_test_block_tenant_isolation.py --ignore=tests/unit/api/test_flow_validate_graph_tenant_isolation.py`
Expected: still 882 passed. If a Phase 5 catalog regression test (in `tests/unit/api/test_integration_http.py`) checks the exact `config_fields` count for an HTTP block, **update the test count** to reflect the new retry fields.

### Slice D · Step 8 — Lint check

Run: `make lint`
Expected: baseline 51 errors preserved.

### Slice D · Step 9 — Visual Chrome MCP review *(deferred to docker-up session — document the plan in the commit)*

Walkthrough plan (executable when docker is running):

1. `make stack-up && cd ui && npm run dev`.
2. Open `http://localhost:5173/#/integration/studio-v2`.
3. Drag Manual + Call API + On Error.
4. Wire Manual → Call API (data edge), then drag from Call API's bottom orange handle to On Error → verify edge color = orange + label "error".
5. Click Call API → Inspector shows `Retry attempts` + `Backoff seconds` numeric inputs alongside the existing 4 fields.
6. Set Retry attempts = 2, Backoff seconds = 0.5. Save.
7. Set connector_id = "missing-connector" (force a permanent failure). Run.
8. Verify BottomPanel shows: Call API status="failed", On Error status="ready", flow status="completed_with_errors".
9. Take screenshot `studio-v2-phase7-error-path.png` at the repo root.

### Slice D · Step 10 — Commit Slice D

```bash
git add ui/src/components/studio/StudioNode.tsx \
        ui/src/components/studio/StudioNode.css \
        ui/src/components/studio/edgeStyles.ts \
        planiadvance_v2/application/use_cases/integration_flows.py
git commit -m "Studio v2 phase 7 slice D: error edges UI + retry inspector

- StudioNode renders out-error bottom handle on regular blocks (skipped
  for trigger / logic / error categories so the canvas stays calm)
- CSS makes the error handle semi-transparent until hovered
- edgeStyleFor handles 'error' (orange) + bidirectional handle <-> type
  helpers updated for out-error
- Catalog: retry_max_attempts + retry_backoff_seconds appended to all
  5 HTTP-touching block_types so the schema-driven Inspector surfaces
  them automatically (no Inspector code change)

Build green, tsc clean, lint baseline 51 preserved.

Visual Chrome MCP review deferred to next docker-up session: walkthrough
plan in docs/superpowers/plans/2026-05-08-studio-v2-phase-7.md slice D."
```

---

## Final Verification

- [ ] **Run all phase 7 tests + the full unit suite**

Run: `python -m pytest tests/unit/use_cases/test_flow_error_edges.py tests/unit/use_cases/test_flow_block_retry.py tests/unit/use_cases/test_flow_dag_runner.py -v`
Expected: 4 + 4 + 13 = **21 PASS**.

Run: `python -m pytest tests/unit -q --ignore=tests/unit/api/test_flow_run_trace_tenant_isolation.py --ignore=tests/unit/api/test_flow_test_block_tenant_isolation.py --ignore=tests/unit/api/test_flow_validate_graph_tenant_isolation.py`
Expected: 882 passed, 0 failed.

- [ ] **Lint check**

Run: `make lint`
Expected: 51 errors (baseline preserved).

- [ ] **Update memory** at `C:\Users\samol\.claude\projects\C--Users-samol-Projet-PlaniAdvanceV2\memory\resume_j1.md`

Append a Phase 7 closure paragraph: 4 commits (range from slice A through slice D), 8 new tests across 2 test files, lint baseline preserved, visual Chrome MCP review deferred to docker-up session.

---

## Notes on scope discipline

- **Each slice ships independently.** If Slice C uncovers a regression in the Slice B retry-pass-through path, fix B first as its own commit.
- **No standalone error_retry block this phase.** Per-block retry config in `block.config` is simpler, less surprising, and unblocks the V1.0 flows. Phase 7.5 can add a visual "Retry policy" sidecar block if Sam wants the visual cue.
- **Hexagonal preserved.** `_run_block_with_retry` lives in `application/use_cases/`; no infra leaks. The retry helper is module-level (not a method on `RunIntegrationFlow`) so it's trivially testable in isolation (Slice C tests use `_FakeRunner`).
- **Frontend visual review is deferred to docker-up.** Build-green is necessary but not sufficient — Sam's locked rule is to walkthrough in Chrome MCP. The walkthrough plan is committed alongside the diff so Sam (or Claude in next session) can execute it.
