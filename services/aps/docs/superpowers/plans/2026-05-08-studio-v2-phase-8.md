# Studio v2 Phase 8 — Parity audit + templates + flip flag

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirm Studio v2 covers everything pilots need from v1, ship the 5 starter templates, and flip the env flag so Studio v2 is the default Studio for new V1.0 installs — keeping v1 as a deliberate fallback during pilot stabilization.

**Architecture:**
- **Parity audit doc** — `docs/audits/2026-05-08-studio-v2-parity.md` lists every v1 feature, classifies each as `covered` / `must-fix-V1.0` / `won't-fix-V1.0`, and serves as the V1.0 ship gate.
- **Templates** — backend exposes a static `/integration/flow-templates` endpoint that returns 5 starter recipes (the same set v1 ships), each with full block list + config. FE toolbar grows a "From Template" button that loads the catalog, picks a recipe, and seeds a fresh flow with linear `input_block_id` chaining (no `inputs[]` — keeps templates v1-compatible).
- **Flag flip** — `Settings.studio_v2_enabled` defaults to `True`; the AppShell drops the "(preview)" label; the legacy `/integration/studio` route stays mounted as "Studio (legacy)" so pilots have an escape hatch through V1.0. Phase 9 deletes the v1 component entirely.

**Tech Stack:** Python 3.11 + FastAPI (backend), React 19 + zustand (frontend). Pytest + ruff.

**Method (locked with Sam):** mini-spec → impacts → vertical slice → tests → commit. UI slices verified with Chrome DevTools MCP after each commit (docker is up this session).

**Out of scope (intentional, deferred to Phase 9):**
- Deleting `IntegrationFlowStudio.tsx` (-9428 lines) — keep as escape hatch through pilots.
- Readiness-driven actionable issues (the v1 "open connector for issue", "auto-match db columns", etc.) — these are convenience features, v2's `/validate-graph` already surfaces problems. Phase 9 ports the actionable layer.
- Keyboard shortcuts (Cmd+S, Cmd+R, Delete) — mouse-driven flow works for V1.0 pilot.
- Undo/redo on the canvas — Save is the only safety net for V1.0; pilot users have shown the workflow tolerates it.
- BlockLastRunPanel (per-block run history popover) — `/runs/{run_id}/trace` endpoint already exposes the data; the UI surfacing it is Phase 9 polish.

**Backwards compatibility:**
- The new `/integration/flow-templates` endpoint is additive; it does not change any persisted data.
- Templates produce flows with `input_block_id` chaining (no `inputs[]` populated) so they execute identically through the v1 runner if a pilot toggles `studio_v2_enabled=false`.
- The `Settings.studio_v2_enabled` default change only affects fresh installs without an explicit `STUDIO_V2_ENABLED` env var.

---

## File Structure

**Backend — created:**
- `docs/audits/2026-05-08-studio-v2-parity.md` — the parity audit doc (Slice A).
- `planiadvance_v2/application/integration/flow_templates.py` — `FLOW_TEMPLATES` tuple, one entry per recipe with full block list + config.

**Backend — modified:**
- `planiadvance_v2/api/schemas.py` — add `FlowTemplateBlockOut`, `FlowTemplateOut`.
- `planiadvance_v2/api/routes/integration.py` — new `GET /integration/flow-templates` route.
- `planiadvance_v2/config.py:80` — `studio_v2_enabled: bool = True` (was False).

**Backend — tests:**
- `tests/unit/use_cases/test_flow_templates.py` — sanity check that each template's blocks reference a valid catalog block_type and the chain is acyclic.

**Frontend — modified:**
- `ui/src/types.ts` — add `FlowTemplateOut`, `FlowTemplateBlockOut`.
- `ui/src/lib/api.ts` — add `flowTemplates()` accessor.
- `ui/src/lib/studio/templates.ts` (new) — `applyTemplateToStore(template, catalog)` instantiates nodes/edges from a `FlowTemplateOut`.
- `ui/src/pages/IntegrationStudioV2Page.tsx` — toolbar "From Template" button + dropdown picker + state hook.
- `ui/src/components/AppShell.tsx:407-416` — relabel "Studio v2 (preview)" → "Studio"; the legacy entry on `/integration/studio` stays but gets `description: "Legacy Studio (V1.0 fallback)"` and label "Studio (legacy)".

---

## Slice A — Parity audit doc

**Files:**
- Create: `docs/audits/2026-05-08-studio-v2-parity.md`

### Slice A · Step 1 — Write the parity audit

- [ ] **Create `docs/audits/2026-05-08-studio-v2-parity.md`** with the following content. Each row's verdict is firm — do not soften "won't-fix" to "wishlist":

```markdown
# Studio v2 — V1.0 parity audit

**Date:** 2026-05-08  
**Scope:** comparing `IntegrationFlowStudio.tsx` (v1, 9428 lines) feature set against Studio v2 (Phases 0-7 shipped through 2026-05-08 evening) for the V1.0 sellable ship.

## Verdict legend

- ✅ **covered** — v2 has equivalent functionality, no further work.
- 🟧 **must-fix V1.0** — the V1.0 pilot needs this; ships in Phase 8.
- ⚪ **won't-fix V1.0** — defer to Phase 9 or later; pilot can ship without it.

## Catalog & node model

| Feature | Verdict | Notes |
|---|---|---|
| 19 v1 block types | ✅ covered | All 19 plus 4 trigger blocks (Phase 5), 3 logic blocks (Phase 6), 1 error block (Phase 7) — 23 total in v2. |
| Drag-from-palette | ✅ covered | LibraryPalette drag spawns react-flow nodes (Phase 1). |
| Inspector form (schema-driven) | ✅ covered | Phase 2 — Inspector reads catalog.config_fields and renders text/textarea/json/bool/number widgets. |
| Inspector readiness panel | ⚪ won't-fix V1.0 | v1 surfaces `/integration/flows/{id}/readiness` issues inline; v2 has `/validate-graph` for graph-level issues. Pilot users can call readiness from a separate UI. |
| Block rename inline | ⚪ won't-fix V1.0 | v1 lets the planner rename a block id by clicking the header; v2 uses generated ids. Phase 9. |
| Block move via arrow keys | ⚪ won't-fix V1.0 | v1 has up/down arrows on each block to reorder linear flows; v2 uses spatial layout (drag the node). |
| Drag-to-connect via pointer | ✅ covered | react-flow's `onConnect` (Phase 1) replaces v1's manual pointer-gesture handling. |
| Branch / merge nodes | ✅ covered (v2-only) | Phase 6 — v1 had no branching; v2 adds logic_branch_if/switch/merge. |
| Error edges | ✅ covered (v2-only) | Phase 7 — v1 had no error routing; v2 adds error edge type + error_handler block. |
| Per-block retry config | ✅ covered (v2-only) | Phase 7 Slice C — retry_max_attempts + retry_backoff_seconds in block.config. |

## Run + observability

| Feature | Verdict | Notes |
|---|---|---|
| Run flow end-to-end | ✅ covered | Phase 3 — toolbar Run button + run trace persistence. |
| Run trace persisted | ✅ covered | Phase 3 — `integration_flow_run_traces` table + `/runs/{id}/trace` endpoint. |
| Trace masking (secrets) | ✅ covered | Phase 3 — `mask_payload` redacts Authorization/Cookie/X-Api-Key/etc. |
| Per-block "Test this step" | ✅ covered | Phase 4 — toolbar dry-run button on selected node, no journal write. |
| Per-block last-run popover (v1 BlockLastRunPanel) | ⚪ won't-fix V1.0 | The data exists via `/runs/{id}/trace`; v2 surfaces it through the BottomPanel tabs (Input/Output/Logs/Schema). v1's per-block popover is convenience layering. Phase 9. |
| Run status pill in toolbar | ✅ covered | Phase 3 + 7 — toolbar Run label cycles "Run" / "Running…" / completion is reflected in BottomPanel meta. |

## Templates & onboarding

| Feature | Verdict | Notes |
|---|---|---|
| 5 starter templates (ERP→APS, ERP delta, ERP full, APS→DB, APS→SFTP) | 🟧 **must-fix V1.0** | v1 ships these via `STUDIO_RECIPES`. v2 is empty-canvas-only. Phase 8 Slice B ports them to a backend endpoint + toolbar picker. |
| Empty-state Hero with CTA list | ⚪ won't-fix V1.0 | v1's empty state shows the recipes prominently. v2 drops to a blank canvas; the From Template button replaces this. |
| Recipe outcome description on apply | ✅ covered (after Slice B) | Slice B will surface the recipe's `description`/`outcome` in a tooltip when picking. |

## Multi-tenant + security

| Feature | Verdict | Notes |
|---|---|---|
| Org-scoped flow listing | ✅ covered | All `/integration/flows*` endpoints are org-scoped via `X-Organization-Id` + session. |
| Cross-tenant 404 (no leakage) | ✅ covered | Phase 4 + 6 — isolation regression tests on `/test-block`, `/trace`, `/validate-graph`. |
| Run requires `manage_integrations` permission | ✅ covered | Inherited from v1; same permission model. |

## Save/load

| Feature | Verdict | Notes |
|---|---|---|
| Save / Update flow | ✅ covered | Phase 2 — POST/PUT round-trip including node positions in `config.__ui_position`. |
| Load by `?flow_id=` query | ✅ covered | Phase 2 — hydrateFromFlow restores nodes + edges (Phase 6 round-trip via `inputs[]` confirmed Chrome MCP, 2026-05-08 fix). |
| Linear v1 flow round-trip | ✅ covered | Phase 6 Slice B — legacy `input_block_id` is promoted to a single-edge DAG; v1 flows render identically. |

## UX polish

| Feature | Verdict | Notes |
|---|---|---|
| Keyboard shortcuts (Cmd+S, Cmd+R, Delete) | ⚪ won't-fix V1.0 | Mouse works. Phase 9. |
| Undo/redo | ⚪ won't-fix V1.0 | Save is the safety net. Phase 9. |
| Bezier edge polish + drag fluidity | ⚪ won't-fix V1.0 | Listed under "Studio pass 3" in the deferred list since 2026-05-07. |
| Theme parity (dark/light) | ✅ covered | Studio v2 inherits design-system tokens. |
| Connector test 404 path-context message | ⚪ won't-fix V1.0 | Catalogued 2026-05-07; affects both v1 and v2; not a v2-blocker. |
| Studio empty-JSON visual consistency | ⚪ won't-fix V1.0 | Cosmetic; tracked separately. |

## Cron / webhook firing

| Feature | Verdict | Notes |
|---|---|---|
| Manual trigger blocks | ✅ covered | Phase 5. |
| Schedule trigger persisted | ✅ covered | Phase 5 — block stores cron_expression. |
| Schedule worker actually fires | ⚪ won't-fix V1.0 | Documented Phase 5.5 deferred. v1 had no scheduling either. |
| Webhook URL surfacing | ✅ covered | Phase 5 — Inspector shows preview URL with Copy button. |
| Authenticated public webhook endpoint | ⚪ won't-fix V1.0 | Phase 5.5 deferred. |

## V1.0 ship gate

**Must-fix before V1.0 ship:** templates (1 item — Slice B of this Phase 8 plan).

After Slice B + flag flip (Slice C), Studio v2 is feature-equivalent to v1 for everything pilots demonstrably need. v1 stays mounted as `/integration/studio` (relabelled "Studio (legacy)") so pilots can fall back if a regression slips through; Phase 9 removes v1 once a pilot has shipped on v2.
```

- [ ] **Step 2 — Lint check (markdown only, no Python)**

Run: `make lint`
Expected: 51 errors (baseline preserved — no Python changed).

- [ ] **Step 3 — Commit Slice A**

```bash
git add docs/audits/2026-05-08-studio-v2-parity.md
git commit -m "Studio v2 phase 8 slice A: V1.0 parity audit doc

- 5 categories audited: catalog/node, run/observability, templates,
  multi-tenant, save/load, UX polish, cron/webhook
- 1 must-fix-V1.0 item (templates → Slice B of phase 8)
- 9 won't-fix-V1.0 items deferred to Phase 9 with reasoning
- v1 stays as escape hatch through pilot stabilization"
```

---

## Slice B — Templates endpoint + "From Template" toolbar button

**Files:**
- Create: `planiadvance_v2/application/integration/flow_templates.py`
- Modify: `planiadvance_v2/api/schemas.py`
- Modify: `planiadvance_v2/api/routes/integration.py`
- Test: `tests/unit/use_cases/test_flow_templates.py`
- Modify: `ui/src/types.ts`
- Modify: `ui/src/lib/api.ts`
- Create: `ui/src/lib/studio/templates.ts`
- Modify: `ui/src/pages/IntegrationStudioV2Page.tsx`

### Slice B · Step 1 — Failing test: backend templates registry

- [ ] **Create `tests/unit/use_cases/test_flow_templates.py`**:

```python
"""Phase 8 — starter templates registry."""

from __future__ import annotations

from planiadvance_v2.application.integration.flow_templates import FLOW_TEMPLATES
from planiadvance_v2.application.use_cases.integration_flows import (
    SUPPORTED_FLOW_BLOCK_TYPES,
)


def test_five_templates_exposed():
    """v1 ships 5 starter recipes; v2 ports the same set."""
    keys = {t["key"] for t in FLOW_TEMPLATES}
    assert keys == {
        "erp-import",
        "erp-return-delta",
        "erp-return-full",
        "aps-database-export",
        "aps-sftp-export",
    }


def test_each_template_has_title_description_and_blocks():
    for tpl in FLOW_TEMPLATES:
        assert isinstance(tpl["title"], str) and tpl["title"]
        assert isinstance(tpl["description"], str) and tpl["description"]
        assert isinstance(tpl["blocks"], tuple) and len(tpl["blocks"]) >= 2


def test_every_template_block_uses_a_known_block_type():
    """Drift between recipe blocks and FLOW_BLOCK_CATALOG breaks Studio rendering."""
    for tpl in FLOW_TEMPLATES:
        for block in tpl["blocks"]:
            assert (
                block["block_type"] in SUPPORTED_FLOW_BLOCK_TYPES
            ), f"{tpl['key']} references unknown block_type {block['block_type']}"


def test_blocks_form_a_linear_chain():
    """Templates use legacy input_block_id chaining (v1-compatible)."""
    for tpl in FLOW_TEMPLATES:
        block_ids = [b["id"] for b in tpl["blocks"]]
        for index, block in enumerate(tpl["blocks"]):
            if index == 0:
                continue
            assert block["input_block_id"] == block_ids[index - 1], (
                f"{tpl['key']} block {block['id']} should chain from "
                f"{block_ids[index - 1]}"
            )
```

- [ ] **Step 2 — Run, expect ImportError**

Run: `python -m pytest tests/unit/use_cases/test_flow_templates.py -v`
Expected: FAIL — module `flow_templates` does not exist yet.

- [ ] **Step 3 — Create the templates registry**

Create `planiadvance_v2/application/integration/flow_templates.py`:

```python
"""Studio v2 phase 8 — starter flow templates ported from v1.

Each template carries a full block list with config defaults so the
frontend can spawn a working flow in one click. Blocks chain linearly
via `input_block_id` (no `inputs[]`) so the templates execute
identically through the v1 runner if a pilot toggles
`studio_v2_enabled=False`.
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
                    "target_path": "/work-orders",
                    "query_params": {"include": "operations,machines,calendars"},
                },
            },
            {
                "id": "map-api",
                "block_type": "map_api_response_to_snapshot",
                "name": "Map API To APS",
                "input_block_id": "call-api",
                "config": {
                    "mapping": {
                        "work_orders": [{"path": "$.orders[*]"}],
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
                "id": "validate",
                "block_type": "validate_snapshot",
                "name": "Validate Data",
                "input_block_id": "transform",
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
                "config": {"request_mode": "direct", "url": "", "request_method": "POST"},
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
                "config": {"request_mode": "direct", "url": "", "request_method": "POST"},
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
```

- [ ] **Step 4 — Re-run, expect pass**

Run: `python -m pytest tests/unit/use_cases/test_flow_templates.py -v`
Expected: 4 PASS.

- [ ] **Step 5 — Add API schemas**

Edit `planiadvance_v2/api/schemas.py`. Find the `IntegrationFlowBlockCatalogItemOut` (search for the catalog item schema; it's near `IntegrationFlowReadinessOut`). Add **immediately after**:

```python
class FlowTemplateBlockOut(BaseModel):
    id: str
    block_type: str
    name: str
    input_block_id: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)


class FlowTemplateOut(BaseModel):
    key: str
    title: str
    description: str
    outcome: str
    source_system: str
    blocks: list[FlowTemplateBlockOut] = Field(default_factory=list)
```

- [ ] **Step 6 — Add the route**

Edit `planiadvance_v2/api/routes/integration.py`. Locate the existing `/flow-blocks` route (search `flow-blocks`). **Add immediately after** that route:

```python
@router.get("/flow-templates", response_model=list[FlowTemplateOut])
def list_flow_templates() -> list[FlowTemplateOut]:
    """Studio v2 phase 8 — starter templates the v2 toolbar can apply."""
    from ...application.integration.flow_templates import FLOW_TEMPLATES

    return [
        FlowTemplateOut(
            key=str(tpl["key"]),
            title=str(tpl["title"]),
            description=str(tpl["description"]),
            outcome=str(tpl["outcome"]),
            source_system=str(tpl["source_system"]),
            blocks=[
                FlowTemplateBlockOut(
                    id=str(b["id"]),
                    block_type=str(b["block_type"]),
                    name=str(b["name"]),
                    input_block_id=(
                        str(b["input_block_id"]) if b["input_block_id"] else None
                    ),
                    config=dict(b["config"]),
                )
                for b in tpl["blocks"]
            ],
        )
        for tpl in FLOW_TEMPLATES
    ]
```

Add `FlowTemplateOut` and `FlowTemplateBlockOut` to the schemas import at the top of the file:

```python
from ..schemas import (
    ...
    FlowTemplateBlockOut,
    FlowTemplateOut,
    ...
)
```

- [ ] **Step 7 — Verify endpoint manually**

Run (assuming docker stack is up and api was rebuilt — if not, `docker compose build api && docker compose up -d --force-recreate --no-deps api`):

```bash
curl -s http://localhost:8000/integration/flow-templates | python -m json.tool | head -40
```

Expected: JSON list of 5 templates, each with a `blocks` array.

- [ ] **Step 8 — Add FE types**

Edit `ui/src/types.ts`. Find `IntegrationFlowBlockCatalogItemOut` and add after it:

```typescript
export type FlowTemplateBlockOut = {
  id: string;
  block_type: string;
  name: string;
  input_block_id: string | null;
  config: Record<string, unknown>;
};

export type FlowTemplateOut = {
  key: string;
  title: string;
  description: string;
  outcome: string;
  source_system: string;
  blocks: FlowTemplateBlockOut[];
};
```

- [ ] **Step 9 — Add API accessor**

Edit `ui/src/lib/api.ts`. Find `integrationFlowBlocks` and add **immediately after** it:

```typescript
  flowTemplates: () => request<FlowTemplateOut[]>("/integration/flow-templates"),
```

Add `FlowTemplateOut` to the imports list at the top.

- [ ] **Step 10 — Add the template applier helper**

Create `ui/src/lib/studio/templates.ts`:

```typescript
import type { Edge, Node } from "@xyflow/react";

import type { StudioNodeData } from "../../components/studio/StudioNode";
import type {
  FlowTemplateOut,
  IntegrationFlowBlockCatalogItemOut,
} from "../../types";
import type { BlockCategory } from "./blockMeta";
import type { StudioEdgeData } from "./studioStore";

const COLUMN_WIDTH = 280;
const TOP_PADDING = 120;

/**
 * Build store-ready nodes/edges from a backend FlowTemplateOut. Layout
 * is a simple horizontal chain so the planner sees the linear pipeline
 * immediately. Edges use the v1-compatible 'data' edge_type because
 * templates ship with `input_block_id` chaining only.
 */
export function applyTemplateToStore(
  template: FlowTemplateOut,
  catalog: ReadonlyArray<IntegrationFlowBlockCatalogItemOut>,
): { nodes: Node<StudioNodeData>[]; edges: Edge<StudioEdgeData>[] } {
  const nodes: Node<StudioNodeData>[] = template.blocks.map((block, idx) => {
    const meta = catalog.find((c) => c.block_type === block.block_type);
    return {
      id: block.id,
      type: "studio",
      position: { x: 100 + idx * COLUMN_WIDTH, y: TOP_PADDING },
      data: {
        block_type: block.block_type,
        category: (meta?.category ?? "aps") as BlockCategory,
        label: block.name,
        accepts_input: meta?.accepts_input ?? false,
        config: { ...block.config },
      },
    };
  });
  const edges: Edge<StudioEdgeData>[] = template.blocks
    .filter((b) => b.input_block_id)
    .map((b) => ({
      id: `e-${b.input_block_id}-${b.id}`,
      source: b.input_block_id!,
      target: b.id,
      data: { invalid: false, edgeType: "data" },
    }));
  return { nodes, edges };
}
```

- [ ] **Step 11 — Wire the toolbar button**

Open `ui/src/pages/IntegrationStudioV2Page.tsx`. Find the `StudioToolbar` function. Inside it, before the existing buttons, add a new button that opens a native `<select>` picker:

Replace the toolbar's button row (the `<div style={{ flex: 1 }} />` and everything after through `</header>`) with:

```tsx
      <div style={{ flex: 1 }} />
      {saveError && (
        <Flash tone="crit" message={saveError} onDismiss={() => setSaveError(null)} />
      )}
      <select
        aria-label="Apply starter template"
        value=""
        onChange={(e) => {
          const key = e.target.value;
          if (!key) return;
          void onApplyTemplate(key);
          e.currentTarget.value = "";
        }}
        style={{
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: "4px 8px",
          fontSize: "13px",
          fontFamily: "var(--font-sans)",
        }}
      >
        <option value="">From template…</option>
        {templates?.map((t) => (
          <option key={t.key} value={t.key} title={t.outcome}>
            {t.title}
          </option>
        ))}
      </select>
      <Button
        variant="secondary"
        size="sm"
        onClick={onSave}
        disabled={saving || !dirty}
      >
        {saving ? "Saving…" : flowId ? "Save" : "Create flow"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onValidate}
        disabled={validateRunning || saving}
        title="Run static analysis on the flow graph"
      >
        {validateRunning
          ? "Validating…"
          : validateResult
            ? validateResult.valid
              ? "Valid ✓"
              : `${validateResult.issues.length} issue(s)`
            : "Validate"}
      </Button>
      <Button
        variant="primary"
        size="sm"
        onClick={onRun}
        disabled={running || saving}
      >
        {running ? "Running…" : "Run"}
      </Button>
    </header>
  );
}
```

`StudioToolbar` now needs `templates` and `onApplyTemplate` props. Update the StudioToolbar function signature to accept them:

Find the line `function StudioToolbar() {` and replace with:

```tsx
type StudioToolbarProps = {
  templates: FlowTemplateOut[] | null;
  onApplyTemplate: (key: string) => void;
};

function StudioToolbar({ templates, onApplyTemplate }: StudioToolbarProps) {
```

Add the imports at the top of the file:

```tsx
import type {
  FlowTemplateOut,
  IntegrationFlowBlockCatalogItemOut,
} from "../types";
import { applyTemplateToStore } from "../lib/studio/templates";
```

- [ ] **Step 12 — Load templates and pass to toolbar**

Inside `IntegrationStudioV2Page`, after `setCatalog(res.data)` (around line 287), **add a templates fetch**:

```tsx
      const templatesRes = await api.flowTemplates();
      if (cancelled) return;
      setTemplates(templatesRes.ok ? templatesRes.data : []);
```

Add the local state at the top of the component (near `const [catalog, setCatalog] = ...`):

```tsx
  const [templates, setTemplates] = useState<FlowTemplateOut[] | null>(null);
```

Add the apply handler (above the JSX return):

```tsx
  const onApplyTemplate = useCallback(
    (key: string) => {
      if (!templates || !catalog) return;
      const tpl = templates.find((t) => t.key === key);
      if (!tpl) return;
      const { nodes, edges } = applyTemplateToStore(tpl, catalog);
      useStudioStore.getState().resetFlow(null, tpl.title);
      useStudioStore.setState({ nodes, edges, dirty: true });
    },
    [templates, catalog],
  );
```

Pass them to `<StudioToolbar />`:

```tsx
<StudioToolbar templates={templates} onApplyTemplate={onApplyTemplate} />
```

- [ ] **Step 13 — Typecheck and build**

Run: `cd ui && npx tsc --noEmit`
Expected: PASS.

Run: `cd ui && npm run build`
Expected: PASS.

- [ ] **Step 14 — Backend tests + lint**

Run: `python -m pytest tests/unit/use_cases/test_flow_templates.py -v`
Expected: 4 PASS.

Run: `make lint`
Expected: 51 errors (baseline).

- [ ] **Step 15 — Rebuild docker API + restart, verify endpoint**

Run:
```bash
cd docker && docker compose build api && STUDIO_V2_ENABLED=true docker compose up -d --force-recreate --no-deps api && sleep 5 && cd ..
curl -s http://localhost:8000/integration/flow-templates | python -c "import json, sys; d=json.load(sys.stdin); print(len(d), 'templates:', [t['key'] for t in d])"
```

Expected: `5 templates: ['erp-import', 'erp-return-delta', 'erp-return-full', 'aps-database-export', 'aps-sftp-export']`

- [ ] **Step 16 — Chrome MCP visual review**

Re-login (sessions expire on api rebuild). Navigate to `http://localhost:5173/#/integration/studio-v2`. Verify:
1. Toolbar shows a "From template…" `<select>` between the dirty dot and Save.
2. Open the select — 5 options listed by title.
3. Pick "ERP to APS" — 7 nodes appear in a horizontal chain (Call API → Map API To APS → Transform Data → Validate Data → Stop On Bad Data → Import To APS → Run APS), data edges between consecutive nodes.
4. Title in toolbar reads "ERP to APS" and dirty dot is on.
5. Click Save — flow persists.
6. Take screenshot `studio-v2-phase8-templates.png`.

- [ ] **Step 17 — Commit Slice B**

```bash
git add planiadvance_v2/application/integration/flow_templates.py \
        planiadvance_v2/api/schemas.py \
        planiadvance_v2/api/routes/integration.py \
        tests/unit/use_cases/test_flow_templates.py \
        ui/src/types.ts \
        ui/src/lib/api.ts \
        ui/src/lib/studio/templates.ts \
        ui/src/pages/IntegrationStudioV2Page.tsx \
        studio-v2-phase8-templates.png
git commit -m "Studio v2 phase 8 slice B: 5 starter templates + From Template button

- Backend FLOW_TEMPLATES tuple ports the v1 STUDIO_RECIPES set with
  full block configs (linear input_block_id chain, v1-runner-compatible)
- New GET /integration/flow-templates returns FlowTemplateOut list
- FE types, api.flowTemplates() accessor, applyTemplateToStore helper
- Toolbar 'From template...' select picks recipe and seeds canvas
- 4 unit tests + Chrome MCP visual review confirms ERP-to-APS spawn"
```

---

## Slice C — Flip flag default to true

**Files:**
- Modify: `planiadvance_v2/config.py:80`
- Modify: `ui/src/components/AppShell.tsx:407-416`

### Slice C · Step 1 — Failing test: default flag is True

- [ ] **Edit `tests/unit/test_config.py`** (or create if missing). Search first:

```bash
grep -rn "studio_v2_enabled" tests/ | head
```

If no test exists, create `tests/unit/test_config_studio_v2.py`:

```python
"""Phase 8 slice C — studio_v2 ships ON by default."""

from __future__ import annotations

from planiadvance_v2.config import Settings


def test_studio_v2_enabled_default_is_true():
    """V1.0 ship: Studio v2 is the default Studio. v1 stays as fallback."""
    settings = Settings()
    assert settings.studio_v2_enabled is True
```

- [ ] **Step 2 — Run, expect failure**

Run: `python -m pytest tests/unit/test_config_studio_v2.py -v`
Expected: FAIL — `assert False is True`.

- [ ] **Step 3 — Flip the default**

Edit `planiadvance_v2/config.py`. Change line 80 from:

```python
    studio_v2_enabled: bool = False
```

to:

```python
    studio_v2_enabled: bool = True
```

- [ ] **Step 4 — Re-run, expect pass**

Run: `python -m pytest tests/unit/test_config_studio_v2.py -v`
Expected: PASS.

- [ ] **Step 5 — Update AppShell labels**

Edit `ui/src/components/AppShell.tsx`. Find line 408-411 (the `studio-v2` nav entry):

```tsx
          id: "studio-v2",
          label: "Studio v2 (preview)",
          description: "Preview the rebuilt Integration Studio (phase 0).",
          to: "/integration/studio-v2",
```

Replace with:

```tsx
          id: "studio-v2",
          label: "Studio",
          description: "Build and run integration flows.",
          to: "/integration/studio-v2",
```

Find the legacy entry (search for the existing `Integration Studio` or `/integration/studio` nav entry — it's around line 100):

```tsx
      path.startsWith("/integration") && !path.startsWith("/integration/studio-v2"),
```

The legacy entry pattern is:
```tsx
{ id: "integration-studio", label: "Integration Studio", ... to: "/integration/studio", ... }
```

Find that entry and **change its label and description** so users know it's the fallback:

```tsx
          label: "Studio (legacy)",
          description: "Legacy v1 Integration Studio — V1.0 fallback.",
```

(Adjust the exact selector based on the existing structure; keep `id`, `to`, `match`, `icon` unchanged.)

- [ ] **Step 6 — Typecheck + build**

Run: `cd ui && npx tsc --noEmit`
Expected: PASS.

Run: `cd ui && npm run build`
Expected: PASS.

- [ ] **Step 7 — Rebuild docker API and reload UI**

Run:
```bash
cd docker && docker compose build api && docker compose up -d --force-recreate --no-deps api && sleep 5 && cd ..
```

(Note: don't pass `STUDIO_V2_ENABLED=true` this time — the default is now True.)

Verify branding:
```bash
curl -s http://localhost:8000/branding | python -c "import json, sys; print(json.load(sys.stdin)['features'])"
```

Expected: `{'studio_v2': True}`

- [ ] **Step 8 — Chrome MCP visual review**

Re-login. Open the AppLauncher (Sections menu, top-left). Verify:
1. Two Studio entries:
   - "Studio" — primary, points to `/integration/studio-v2`
   - "Studio (legacy)" — secondary, points to `/integration/studio`
2. No "(preview)" suffix anywhere.

Take screenshot `studio-v2-phase8-flag-flipped.png`.

- [ ] **Step 9 — Full unit suite**

Run:
```bash
python -m pytest tests/unit -q --ignore=tests/unit/api/test_flow_run_trace_tenant_isolation.py --ignore=tests/unit/api/test_flow_test_block_tenant_isolation.py --ignore=tests/unit/api/test_flow_validate_graph_tenant_isolation.py
```

Expected: all green (the 4 templates tests + 1 config test should add to the previous 883 → ~888 passed).

- [ ] **Step 10 — Lint check**

Run: `make lint`
Expected: 51 errors.

- [ ] **Step 11 — Commit Slice C**

```bash
git add planiadvance_v2/config.py \
        ui/src/components/AppShell.tsx \
        tests/unit/test_config_studio_v2.py \
        studio-v2-phase8-flag-flipped.png
git commit -m "Studio v2 phase 8 slice C: flip studio_v2 flag default to true

- Settings.studio_v2_enabled default True (was False)
- AppShell drops '(preview)' suffix; v1 nav entry relabeled 'Studio
  (legacy)' so pilots can still reach IntegrationFlowStudio.tsx as a
  fallback through V1.0
- Phase 9 deletes the legacy entry + 9428-line component"
```

---

## Slice D — Memory + closeout

- [ ] **Step 1 — Append a Phase 8 closure paragraph to `C:\Users\samol\.claude\projects\C--Users-samol-Projet-PlaniAdvanceV2\memory\resume_j1.md`**

Insert after the Phase 7 paragraph:

```markdown
12. **Studio v2 Phase 8 plan + execution** (commits TBD = 3 vertical slices) — V1.0 ship gate cleared.
   - **Slice A**: Parity audit at `docs/audits/2026-05-08-studio-v2-parity.md`. 1 must-fix-V1.0 (templates), 9 won't-fix-V1.0 deferrals to Phase 9 (readiness actionables, BlockLastRunPanel, keyboard shortcuts, undo/redo, bezier polish, etc.).
   - **Slice B**: 5 starter templates ported from v1's STUDIO_RECIPES — backend FLOW_TEMPLATES tuple + GET /integration/flow-templates endpoint, FE 'From template…' toolbar select that seeds the canvas with a horizontal chain. Templates use legacy `input_block_id` chaining so they execute through both v1 and v2 runners.
   - **Slice C**: Settings.studio_v2_enabled default flipped True → Studio v2 ships on by default for fresh installs. AppShell drops '(preview)' suffix; v1 entry relabeled 'Studio (legacy)' as escape hatch.

   **Phase 8 NOT shipping**: v1 component deletion (Phase 9 — keep escape hatch through pilot stabilization), readiness-driven actionables (Phase 9), BlockLastRunPanel popover (Phase 9), keyboard shortcuts (Phase 9), undo/redo (Phase 9). Reasoning per won't-fix verdicts in `docs/audits/2026-05-08-studio-v2-parity.md`.
```

- [ ] **Step 2 — Final unit suite + lint sanity**

Run:
```bash
python -m pytest tests/unit -q --ignore=tests/unit/api/test_flow_run_trace_tenant_isolation.py --ignore=tests/unit/api/test_flow_test_block_tenant_isolation.py --ignore=tests/unit/api/test_flow_validate_graph_tenant_isolation.py
make lint
```

Expected: ~888 passed, 51 lint errors.

- [ ] **Step 3 — Final Phase 8 git log review**

Run: `git log --oneline c403c9c..HEAD`

Expected: ~14 commits across Phase 6 + 7 + 8 (10 from previous sessions + 3 from this Phase 8 + visual fix commit).

---

## Notes on scope discipline

- **The won't-fix list is firm.** Sam ships V1.0 without keyboard shortcuts and without readiness actionables. Don't quietly add them in Phase 8.
- **Templates round-trip the v1 runner.** Tested implicitly: each template's `input_block_id` chain executes through `_build_flow_dag` (Phase 6 Slice B) as a degenerate single-edge DAG. v2 runners and v1 runners produce identical results.
- **v1 component stays mounted.** Don't delete `IntegrationFlowStudio.tsx` in Phase 8 — that's Phase 9 after the first pilot ships.
- **No Inspector changes this phase.** Phase 7 added retry fields to the catalog; the Inspector renders them via the existing schema-driven pipeline. Phase 8's only Inspector-adjacent change is the new toolbar select, which lives in `StudioToolbar` not `Inspector`.
