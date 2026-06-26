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
