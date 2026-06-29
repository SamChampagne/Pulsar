# Studio v2 Phase 9 — UX polish (resizable bottom panel + output cards + connector picker)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three concrete UX polish items the planner asked for after the Phase 8 visual review — make the bottom panel resizable (VS Code terminal style), surface human-readable summary cards above the raw JSON output, and replace the `connector_id` free-text input with a real dropdown picker.

**Architecture:**
- **Resizable bottom panel** — pure-CSS draggable top edge that updates a `bottomPanelHeight` slice on the studio store; double-click resets to default. No external library.
- **Output summary cards** — small `OutputSummaryCards` component reads the trace's `output_payload.kind` and renders a row of metric cards (e.g. "Snapshot · 12 work orders · 3 machines · 5 calendars") above the existing `<pre>` JSON dump. Falls back to nothing when the kind is unknown so we don't regress the JSON view.
- **Connector picker** — extend the Inspector's schema-driven `ConfigFieldInput` with a new `field_type: "connector"` that fetches `/integration/connectors` once at mount and renders a `<select>` of `{name} — {base_url}`. The catalog is updated to declare `connector_id` as `field_type: "connector"` for the 6 block types that already use it, so the change is purely declarative.

**Tech Stack:** React 19 + zustand (FE only). No backend changes — the connector list endpoint already exists and the snapshot envelope already carries the metrics we want to surface.

**Method (locked with Sam):** mini-spec → impacts → vertical slice → tests → commit. UI slices verified with Chrome DevTools MCP after each commit.

**Out of scope (intentional, deferred):**
- Deleting v1 `IntegrationFlowStudio.tsx` — Sam confirmed v1 stays mounted because there are still v1 features to port (scheduling controls, etc.). Deletion blocked until those are migrated.
- Keyboard shortcuts (Cmd+S / Cmd+R / Delete) — separate polish slice; not what Sam asked for in this round.
- Undo/redo — separate slice; not what Sam asked for in this round.
- Output cards for `api_response` (raw HTTP response) — keep raw JSON for now; the planner needs to see headers/body verbatim during connector debugging.
- Connector creation inside the picker (inline new-connector form) — link to `/integration/connectors` instead.

**Backwards compatibility:**
- New `field_type: "connector"` is opt-in; existing text-typed `connector_id` fields keep working until the catalog is migrated.
- BottomPanel height is stored in the zustand store only (not persisted across reloads); resetting the page goes back to the default height.

---

## File Structure

**Frontend — modified:**
- `ui/src/lib/studio/studioStore.ts` — add `bottomPanelHeight: number` slice + `setBottomPanelHeight(n)` setter; default 240 px (current fixed height).
- `ui/src/components/studio/BottomPanel.tsx` — render the resize handle at the top edge; subscribe to `bottomPanelHeight`; render `OutputSummaryCards` above the JSON pre.
- `ui/src/components/studio/BottomPanel.css` — handle styling (cursor: ns-resize on top edge, hover highlight).
- `ui/src/components/studio/OutputSummaryCards.tsx` (new) — small component that takes `unknown` payload and renders cards keyed off `kind`.
- `ui/src/components/studio/Inspector.tsx` — extend `ConfigFieldInput` to handle `field_type: "connector"` (fetches connectors once, renders `<select>`).

**Backend — modified:**
- `planiadvance_v2/application/use_cases/integration_flows.py` — flip `connector_id` field_type from `"text"` to `"connector"` for the 6 block types that use it (call_connector_api, send_connector_request, push_snapshot_to_connector, push_published_plan_to_connector, write_database_rows, send_sftp_file).
- (No new endpoint or schema — `/integration/connectors` GET already exists.)

**Tests:**
- `tests/unit/use_cases/test_catalog_field_types.py` (new) — 1 regression test that every `connector_id` field uses `field_type=connector`.

---

## Slice A — Resizable BottomPanel (VS Code terminal style)

**Files:**
- Modify: `ui/src/lib/studio/studioStore.ts`
- Modify: `ui/src/components/studio/BottomPanel.tsx`
- Modify: `ui/src/components/studio/BottomPanel.css`

### Slice A · Step 1 — Add the height slice to the store

- [ ] **Edit `ui/src/lib/studio/studioStore.ts`**, find the type `StudioStore = {` block, **add** these two members:

```typescript
  bottomPanelHeight: number;
  setBottomPanelHeight: (height: number) => void;
```

In the `create<StudioStore>` factory, **add** these initial value + setter near the top (next to other simple setters):

```typescript
  bottomPanelHeight: 240,
  setBottomPanelHeight: (height) =>
    set({ bottomPanelHeight: Math.max(120, Math.min(720, height)) }),
```

The clamp `[120, 720]` keeps the panel usable: ≥120 always shows the tab strip, ≤720 stops it from eating the canvas on a 1080p screen.

### Slice A · Step 2 — Render the resize handle in BottomPanel

- [ ] **Edit `ui/src/components/studio/BottomPanel.tsx`**. Replace the top of the component (the imports + first lines of `BottomPanel()`) with:

```tsx
import { useCallback, useRef, useState } from "react";
import { Tabs } from "../../design";
import { useStudioStore } from "../../lib/studio/studioStore";
import { OutputSummaryCards } from "./OutputSummaryCards";
import "./BottomPanel.css";

type TraceTab = "input" | "output" | "logs" | "schema" | "issues";

const TAB_ITEMS = [
  { id: "input" as const, label: "Input" },
  { id: "output" as const, label: "Output" },
  { id: "logs" as const, label: "Logs" },
  { id: "schema" as const, label: "Schema" },
  { id: "issues" as const, label: "Issues" },
];

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return "(empty)";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
```

(The OutputSummaryCards import is set up here; the component is created in Slice B Step 1, but TS won't error on the import once the file exists. If you do Slice A standalone first, create a stub `OutputSummaryCards.tsx` that exports a no-op component to keep the build green — Slice B replaces it.)

For Slice A only, create the stub `ui/src/components/studio/OutputSummaryCards.tsx`:

```tsx
export function OutputSummaryCards({ payload }: { payload: unknown }) {
  void payload;
  return null;
}
```

(Slice B turns this into the real component.)

- [ ] **Step 3 — Wrap the existing `<section>` with the resize handle**

In the same file, locate the *very last* `return <section className="pa-studio-bottom" ...>` (the success path). Replace **all** five `<section className="pa-studio-bottom...">` JSX returns with a single shared wrapper that always renders the handle. The cleanest path is to extract a `BottomShell` inner component:

```tsx
function BottomShell({ children, ariaLabel }: { children: React.ReactNode; ariaLabel: string }) {
  const height = useStudioStore((s) => s.bottomPanelHeight);
  const setHeight = useStudioStore((s) => s.setBottomPanelHeight);
  const dragStartRef = useRef<{ y: number; startHeight: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragStartRef.current = { y: e.clientY, startHeight: height };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [height],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStartRef.current;
      if (!start) return;
      // Drag UP grows the panel (y decreases).
      const delta = start.y - e.clientY;
      setHeight(start.startHeight + delta);
    },
    [setHeight],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStartRef.current) return;
      dragStartRef.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    [],
  );

  const onDoubleClick = useCallback(() => {
    // Toggle: if non-default, snap back to 240; if at 240, grow to 480.
    setHeight(height === 240 ? 480 : 240);
  }, [height, setHeight]);

  return (
    <section
      className="pa-studio-bottom"
      aria-label={ariaLabel}
      style={{ height: `${height}px` }}
    >
      <div
        className="pa-studio-bottom__resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize bottom panel"
        title="Drag to resize · double-click to snap"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
      />
      {children}
    </section>
  );
}
```

Then **change every** `<section className="pa-studio-bottom...">...</section>` in the existing component to:

```tsx
<BottomShell ariaLabel="Run trace">
  ...existing children...
</BottomShell>
```

The 5 different render branches keep their conditional structure; only the outer `<section>` wrapper changes.

For the `pa-studio-bottom--empty` and `pa-studio-bottom--error` variants, pass the modifier via children context (or just keep the variant as an extra inner div — the resize behaviour applies to all states, including the empty/error state, because the planner may want to grow the panel to read a long error message).

### Slice A · Step 4 — CSS for the resize handle

- [ ] **Edit `ui/src/components/studio/BottomPanel.css`** (or create if missing — search for it first). **Append**:

```css
.pa-studio-bottom {
  position: relative;
  /* Height is now driven by the inline style attribute set by the store. */
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  background: var(--surface);
  overflow: hidden;
  flex-shrink: 0;
}

.pa-studio-bottom__resize {
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  cursor: ns-resize;
  z-index: 2;
  background: transparent;
  transition: background 120ms ease;
}

.pa-studio-bottom__resize:hover,
.pa-studio-bottom__resize:active {
  background: color-mix(in srgb, var(--brand) 24%, transparent);
}
```

(If `BottomPanel.css` already declares `.pa-studio-bottom { height: 240px; ... }`, **remove** the `height` rule — it's now driven by inline style.)

### Slice A · Step 5 — Typecheck and build

Run: `cd ui && npx tsc --noEmit`
Expected: PASS, no errors.

Run: `cd ui && npm run build`
Expected: PASS, dist/ produced.

### Slice A · Step 6 — Chrome MCP visual review

1. Navigate to `http://localhost:5173/#/integration/studio-v2?flow_id=ifl-d18278a20da1` (the Phase 6 branch flow you visualized earlier).
2. Hover the very top edge of the bottom panel — cursor changes to `ns-resize` and the edge highlights.
3. Drag up — panel grows. Drag down — panel shrinks. Verify `Math.max(120, Math.min(720, ...))` clamp.
4. Double-click the handle on a panel that's at 240 — it grows to 480. Double-click again — it returns to 240.
5. Take screenshot `studio-v2-phase9-resize.png`.

### Slice A · Step 7 — Commit Slice A

```bash
git add ui/src/lib/studio/studioStore.ts \
        ui/src/components/studio/BottomPanel.tsx \
        ui/src/components/studio/BottomPanel.css \
        ui/src/components/studio/OutputSummaryCards.tsx \
        studio-v2-phase9-resize.png
git commit -m "Studio v2 phase 9 slice A: resizable BottomPanel (VS Code terminal style)

- bottomPanelHeight slice on studioStore (clamped 120-720, default 240)
- top-edge drag handle on BottomPanel resizes the panel; double-click
  toggles between 240 and 480
- OutputSummaryCards stub created (Slice B turns it into the real
  component)
- Visual Chrome MCP review confirmed (studio-v2-phase9-resize.png)"
```

---

## Slice B — Output summary cards

**Files:**
- Modify: `ui/src/components/studio/OutputSummaryCards.tsx` (turn the stub into a real component)
- Modify: `ui/src/components/studio/BottomPanel.tsx` (render the cards above the JSON pre when tab=output)
- Modify: `ui/src/components/studio/BottomPanel.css` (card styling)

### Slice B · Step 1 — Write the OutputSummaryCards component

Replace `ui/src/components/studio/OutputSummaryCards.tsx` with:

```tsx
import "./OutputSummaryCards.css";

type Card = { label: string; value: string | number };

/**
 * Render a row of metric cards above the raw JSON in the BottomPanel
 * Output tab. The cards are derived from the trace payload's `kind`.
 *
 * Unknown / null payloads render nothing — callers still show the
 * raw JSON below as a fallback.
 */
export function OutputSummaryCards({ payload }: { payload: unknown }) {
  const cards = cardsFromPayload(payload);
  if (cards.length === 0) return null;
  return (
    <div className="pa-studio-output-cards" aria-label="Output summary">
      {cards.map((card, idx) => (
        <div key={idx} className="pa-studio-output-card">
          <span className="pa-studio-output-card__label">{card.label}</span>
          <span className="pa-studio-output-card__value">{card.value}</span>
        </div>
      ))}
    </div>
  );
}

function cardsFromPayload(payload: unknown): Card[] {
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  const kind = typeof obj.kind === "string" ? obj.kind : "";

  if (kind === "snapshot" || kind === "validated_snapshot") {
    const snap = (obj.snapshot ?? obj) as Record<string, unknown>;
    return countSnapshotEntities(snap);
  }
  if (kind === "import_result") {
    return [
      { label: "Status", value: String(obj.status ?? "ok") },
      ...countImportTotals(obj),
    ];
  }
  if (kind === "schedule_result") {
    return [
      { label: "Operations scheduled", value: numberAt(obj, "operations_count") },
      { label: "Wall time (ms)", value: numberAt(obj, "wall_time_ms") },
      { label: "Solver", value: String(obj.solver_status ?? "—") },
    ];
  }
  if (kind === "branch_decision") {
    return [
      { label: "Decision", value: String(obj.decision ?? "—") },
      { label: "Path", value: String(obj.evaluated_path ?? "—") },
    ];
  }
  if (kind === "trigger_event") {
    return [{ label: "Triggered via", value: String(obj.via ?? "—") }];
  }
  if (kind === "error_handled" || kind === "error_envelope") {
    return [
      { label: "Failed block", value: String(obj.handled_block_id ?? obj.failed_block_id ?? "—") },
      { label: "Error", value: short(String(obj.error_message ?? "—"), 60) },
    ];
  }
  return [];
}

function countSnapshotEntities(snap: Record<string, unknown>): Card[] {
  const cards: Card[] = [];
  for (const key of [
    "work_orders",
    "operations",
    "machines",
    "calendars",
    "resources",
    "inventory_items",
    "supplies",
  ]) {
    const arr = snap[key];
    if (Array.isArray(arr)) {
      cards.push({ label: key.replace(/_/g, " "), value: arr.length });
    }
  }
  return cards;
}

function countImportTotals(obj: Record<string, unknown>): Card[] {
  const summary = obj.summary as Record<string, unknown> | undefined;
  if (!summary) return [];
  const cards: Card[] = [];
  for (const [key, value] of Object.entries(summary)) {
    if (typeof value === "number") {
      cards.push({ label: key.replace(/_/g, " "), value });
    }
  }
  return cards;
}

function numberAt(obj: Record<string, unknown>, key: string): string | number {
  const v = obj[key];
  return typeof v === "number" ? v : "—";
}

function short(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
```

### Slice B · Step 2 — CSS for cards

Create `ui/src/components/studio/OutputSummaryCards.css`:

```css
.pa-studio-output-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 96%, var(--brand) 4%);
}

.pa-studio-output-card {
  display: flex;
  flex-direction: column;
  min-width: 100px;
  padding: 6px 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.pa-studio-output-card__label {
  font-size: 10px;
  font-weight: var(--fw-semi);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: var(--ls-wider);
  line-height: 1.2;
}

.pa-studio-output-card__value {
  font-size: var(--fs-body);
  font-weight: var(--fw-medium);
  color: var(--text);
  margin-top: 2px;
}
```

### Slice B · Step 3 — Render cards in the Output tab

In `ui/src/components/studio/BottomPanel.tsx`, find the `tab === "output"` rendering inside the success path (`<pre className="pa-studio-bottom__body">{tab === "output" && formatJson(trace?.output_payload)}</pre>`).

Replace the `<pre>` block with:

```tsx
{tab === "output" ? (
  <>
    <OutputSummaryCards payload={trace?.output_payload} />
    <pre className="pa-studio-bottom__body">
      {formatJson(trace?.output_payload)}
    </pre>
  </>
) : (
  <pre className="pa-studio-bottom__body">
    {tab === "input" && formatJson(trace?.input_payload)}
    {tab === "logs" &&
      (trace?.error_message
        ? trace.error_message
        : trace?.status === "ok"
          ? "(no logs — block ran ok)"
          : "(no logs)")}
    {tab === "schema" && "(schema view — Phase 4)"}
  </pre>
)}
```

### Slice B · Step 4 — Typecheck + build

Run: `cd ui && npx tsc --noEmit && npm run build`
Expected: PASS.

### Slice B · Step 5 — Chrome MCP visual review

1. Open the existing Phase 6 demo flow `ifl-d18278a20da1` (Manual + If + Format true / Format false).
2. Click Run.
3. Click on `t` (the Manual trigger) — the BottomPanel Output tab now shows a card "Triggered via · manual" above the JSON.
4. Click on `if1` (the branch_if) — Output tab shows "Decision · branch_true" and "Path · $.via".
5. Open the ERP-to-APS template (Phase 8 demo). Save. Run with org-demo. The Run will fail at the first `call_connector_api` since `connector_id=""`, but earlier blocks emit useful payloads — test on whichever block produced output.
6. **Easier validation path**: drag a single `Export APS Data` (export_snapshot) onto the canvas with no upstream, save, run. The Output tab should show a row of cards: "work orders · 0", "machines · 0", "calendars · 0", etc. (zeros are fine for the demo workspace.)
7. Take screenshot `studio-v2-phase9-output-cards.png`.

### Slice B · Step 6 — Commit Slice B

```bash
git add ui/src/components/studio/OutputSummaryCards.tsx \
        ui/src/components/studio/OutputSummaryCards.css \
        ui/src/components/studio/BottomPanel.tsx \
        studio-v2-phase9-output-cards.png
git commit -m "Studio v2 phase 9 slice B: output summary cards

- OutputSummaryCards renders metric cards keyed off payload.kind:
  snapshot / validated_snapshot → entity counts (work_orders, machines, ...)
  import_result → status + summary totals
  schedule_result → ops count + solver + wall_time
  branch_decision → decision + evaluated path
  trigger_event → 'via' label
  error_envelope / error_handled → failed block id + truncated message
- Cards render above the raw JSON in the BottomPanel Output tab so
  the planner sees the gist before drilling into the JSON dump
- Chrome MCP review confirmed (studio-v2-phase9-output-cards.png)"
```

---

## Slice C — Connector picker dropdown

**Files:**
- Modify: `planiadvance_v2/application/use_cases/integration_flows.py` (catalog `field_type` flip)
- Modify: `ui/src/components/studio/Inspector.tsx` (handle `field_type: "connector"`)
- Test: `tests/unit/use_cases/test_catalog_field_types.py` (new — 1 regression assertion)

### Slice C · Step 1 — Failing test: catalog declares connector field as connector type

- [ ] **Create `tests/unit/use_cases/test_catalog_field_types.py`**:

```python
"""Phase 9 — connector_id config fields use field_type='connector'.

The Inspector renders a dropdown picker for connector fields; if the
catalog drifts back to 'text', the picker falls through to the free-text
input (which is the source of the bad UX Sam flagged on 2026-05-08).
"""

from __future__ import annotations

from planiadvance_v2.application.use_cases.integration_flows import FLOW_BLOCK_CATALOG


def test_connector_id_fields_use_connector_field_type():
    offenders: list[str] = []
    for item in FLOW_BLOCK_CATALOG:
        for field in item.get("config_fields") or ():
            if field.get("key") == "connector_id" and field.get("field_type") != "connector":
                offenders.append(
                    f"{item['block_type']} → connector_id has "
                    f"field_type={field.get('field_type')!r}"
                )
    assert not offenders, "Found connector_id fields not using field_type='connector':\n" + "\n".join(offenders)
```

- [ ] **Step 2 — Run, expect failure (or pass — depends on current state)**

Run: `python -m pytest tests/unit/use_cases/test_catalog_field_types.py -v`

If it passes: there's no `connector_id` config field in the catalog yet (only `call_connector_api` declares connector_id, others rely on workflow inference). Skip to Step 4 — the Inspector change is still useful for the one block that has it.

If it fails: at least one offender — flip the offending entries.

- [ ] **Step 3 — Update catalog entries that have a `connector_id` config field**

In `planiadvance_v2/application/use_cases/integration_flows.py`, find every `"key": "connector_id"` line. For each, **change**:

```python
            {
                "key": "connector_id",
                "label": "Connector",
                "field_type": "text",
                ...
            },
```

to:

```python
            {
                "key": "connector_id",
                "label": "Connector",
                "field_type": "connector",
                ...
            },
```

(The only currently affected block is `call_connector_api`. Apply to it; future block types that add `connector_id` should follow the same convention.)

- [ ] **Step 4 — Run test to verify it passes**

Run: `python -m pytest tests/unit/use_cases/test_catalog_field_types.py -v`
Expected: PASS.

### Slice C · Step 5 — Inspector renders the connector picker

Open `ui/src/components/studio/Inspector.tsx`. Read the file first (it's small, < 200 lines). Find `ConfigFieldInput` — the component that switches on `field_type` and renders the right input.

**Add** a new branch above the `default` case for `"connector"`:

```tsx
if (field.field_type === "connector") {
  return <ConnectorSelectInput field={field} value={value} onChange={onChange} />;
}
```

**Add** the new `ConnectorSelectInput` component at the bottom of the same file:

```tsx
function ConnectorSelectInput({
  field,
  value,
  onChange,
}: {
  field: ConfigFieldOut;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const [connectors, setConnectors] = useState<IntegrationConnectorOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await api.integrationConnectors();
      if (cancelled) return;
      if (res.ok) setConnectors(res.data);
      else setError(res.error);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const current = typeof value === "string" ? value : "";

  return (
    <div className="pa-inspector-field">
      <label className="pa-inspector-field__label" htmlFor={`field-${field.key}`}>
        {field.label}
        {field.required ? " *" : null}
      </label>
      {connectors === null && !error && (
        <p className="pa-inspector-field__hint">Loading connectors…</p>
      )}
      {error && (
        <p className="pa-inspector-field__hint" style={{ color: "var(--crit)" }}>
          {error}
        </p>
      )}
      {connectors !== null && (
        <>
          <select
            id={`field-${field.key}`}
            value={current}
            onChange={(e) => onChange(e.target.value)}
            className="pa-inspector-field__input"
          >
            <option value="">Select a connector…</option>
            {connectors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.base_url || c.id}
              </option>
            ))}
          </select>
          <p className="pa-inspector-field__hint">
            <a href="#/integration/connectors" target="_blank" rel="noreferrer">
              + New connector
            </a>
            {connectors.length === 0 ? " (none configured yet)" : null}
          </p>
        </>
      )}
      {field.help && <p className="pa-inspector-field__hint">{field.help}</p>}
    </div>
  );
}
```

Add the imports at the top of `Inspector.tsx` (next to the existing imports):

```tsx
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { IntegrationConnectorOut } from "../../types";
```

**Verify** that the existing `ConfigFieldOut` type already lives somewhere reachable (likely re-exported from `types.ts` as `IntegrationFlowBlockCatalogConfigFieldOut`). Adjust the prop type if needed.

### Slice C · Step 6 — Verify api.integrationConnectors exists

Search for it in `ui/src/lib/api.ts`:

```bash
grep -n "integrationConnectors" ui/src/lib/api.ts
```

If the accessor doesn't exist, add it next to `integrationFlowBlocks`:

```typescript
  integrationConnectors: () =>
    request<IntegrationConnectorOut[]>("/integration/connectors"),
```

And confirm `IntegrationConnectorOut` is in the imports list at the top of `api.ts` (it should be — v1 already calls this endpoint).

### Slice C · Step 7 — Backend rebuild + FE rebuild

Backend: `cd docker && docker compose build api && docker compose up -d --force-recreate --no-deps api && sleep 5 && cd ..`

FE typecheck + build: `cd ui && npx tsc --noEmit && npm run build`

Verify the catalog now declares `field_type=connector`:

```bash
curl -s http://localhost:8000/integration/flow-blocks | python -c "import json, sys
catalog = json.load(sys.stdin)
for item in catalog:
    for f in item.get('config_fields') or []:
        if f.get('key') == 'connector_id':
            print(f'{item[\"block_type\"]}: connector_id field_type={f[\"field_type\"]!r}')"
```

Expected: at least `call_connector_api: connector_id field_type='connector'`.

### Slice C · Step 8 — Chrome MCP visual review

1. Re-login (api was rebuilt). Navigate to the studio.
2. Drop a `Call API` block onto the canvas.
3. Click the block.
4. Inspector should now render a `<select>` for the Connector field with placeholder "Select a connector…" and a "+ New connector" link below.
5. If a connector is configured (via the legacy `/integration/connectors` route), it appears in the dropdown.
6. Take screenshot `studio-v2-phase9-connector-picker.png`.

### Slice C · Step 9 — Full unit suite + lint

Run: `python -m pytest tests/unit -q --ignore=tests/unit/api/test_flow_run_trace_tenant_isolation.py --ignore=tests/unit/api/test_flow_test_block_tenant_isolation.py --ignore=tests/unit/api/test_flow_validate_graph_tenant_isolation.py`
Expected: 889 passed (888 + 1 catalog test).

Run: `make lint`
Expected: 51 errors (baseline).

### Slice C · Step 10 — Commit Slice C

```bash
git add planiadvance_v2/application/use_cases/integration_flows.py \
        ui/src/components/studio/Inspector.tsx \
        ui/src/lib/api.ts \
        tests/unit/use_cases/test_catalog_field_types.py \
        studio-v2-phase9-connector-picker.png
git commit -m "Studio v2 phase 9 slice C: connector_id dropdown picker

- catalog connector_id field_type 'text' → 'connector' (call_connector_api)
- Inspector renders ConnectorSelectInput which fetches /integration/connectors
  and shows a select of {name} — {base_url}
- '+ New connector' link to the legacy /integration/connectors page
  (no inline create form for V1.0; Sam can extend later)
- 1 regression test: any future connector_id field stays connector-typed
- Chrome MCP review confirmed (studio-v2-phase9-connector-picker.png)"
```

---

## Slice D — Phase 9 closeout

- [ ] **Step 1 — Update memory**

Append to `C:\Users\samol\.claude\projects\C--Users-samol-Projet-PlaniAdvanceV2\memory\resume_j1.md` after the Phase 8 paragraph:

```markdown
14. **Studio v2 Phase 9 plan + execution** (commits TBD = 3 vertical slices) — UX polish round 1.
   - **Slice A**: BottomPanel resizable like a VS Code terminal — top-edge drag handle, double-click toggles 240/480, height clamped 120–720.
   - **Slice B**: OutputSummaryCards above the raw JSON in the Output tab — keyed off payload.kind (snapshot / validated_snapshot / import_result / schedule_result / branch_decision / trigger_event / error_envelope). Falls back to nothing for unknown kinds so the JSON view never regresses.
   - **Slice C**: connector_id field renders a real `<select>` populated from `/integration/connectors` instead of a free-text input. Catalog `field_type` flipped to `"connector"` (with a regression test); Inspector grew a `ConnectorSelectInput` branch.

   **v1 Studio NOT deleted.** Sam confirmed v1 has features still to port (scheduling controls, etc.). v1 stays mounted; deletion blocked until those features ship in v2.
```

- [ ] **Step 2 — Final unit suite + lint sanity**

Run: `python -m pytest tests/unit -q --ignore=tests/unit/api/test_flow_run_trace_tenant_isolation.py --ignore=tests/unit/api/test_flow_test_block_tenant_isolation.py --ignore=tests/unit/api/test_flow_validate_graph_tenant_isolation.py`
Expected: 889 PASSED.

Run: `make lint`
Expected: 51 errors.

- [ ] **Step 3 — Commit memory**

```bash
git add C:/Users/samol/.claude/projects/C--Users-samol-Projet-PlaniAdvanceV2/memory/resume_j1.md
# Memory lives outside the repo; just push the in-repo changes.
git log --oneline c403c9c..HEAD | head -25
```

(If the memory file lives outside the repo — which it does, since it's under `~/.claude/projects/` — there's no commit needed; the file is just persisted to disk.)

---

## Notes on scope discipline

- **No v1 deletion in this phase.** Sam's call: keep `IntegrationFlowStudio.tsx` mounted because it has scheduling features Studio v2 still needs to inherit. The deletion is blocked until those land.
- **Output cards are additive.** They render above the JSON; they never replace it. If a planner needs the raw payload (e.g. for debugging), one scroll past the cards gets them there.
- **Connector picker is opt-in via `field_type`.** Other text inputs are unchanged. Future "smart" field types (workspace, machine, etc.) can follow the same pattern without touching unrelated config fields.
- **Resizable panel is non-persistent.** Reload returns to the default 240 px. Persistence is a Phase 10 polish item if Sam asks.
