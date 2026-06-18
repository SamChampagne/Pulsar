# Desk Display Modes + Full-Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `/apps` desk three switchable layout modes — `auto` (tidy grid), `free` (full-screen pixel canvas), `reorder` (iPhone-style draggable grid) — chosen in Personnaliser and persisted, with the desk filling the full screen below the top bar.

**Architecture:** Add `mode: DeskMode` to the layout in `@pulsar/shared` (default `auto`, unit-tested). Extend `freeDrag` to report the hovered tile at drop. Rewrite `/apps` to render per mode (grid for auto/reorder, absolute full-screen canvas for free), branch drop behaviour by mode, clamp to the measured container, and show a mode segmented control while editing.

**Tech Stack:** `@pulsar/shared` (Vitest), SvelteKit SPA (Svelte 5 runes), Tailwind, native pointer drag (`freeDrag`). Backend unchanged (deskLayout JSON now also carries `mode`).

**Spec:** `docs/superpowers/specs/2026-06-17-desk-display-modes-design.md`

**Branch:** continue on `ux-polish-pass`.

**Verification:** `@pulsar/shared` Vitest (Task 1 TDD). `apps/web` no component runner → `pnpm --filter @pulsar/web typecheck` (0/0) + chrome-devtools browser checks (the controller runs these). Dev server: localhost:5173 `/apps` (admin@pulsar.dev / admin123).

**Regression guards:** (a) keep `{#each}` keys unique (id + index) — do not reintroduce `each_key_duplicate`; (b) pointer capture happens only after the drag threshold (preserves tap-to-open) — do not move it back to pointerdown.

---

## File Structure

**Modified**
- `packages/shared/src/desk/desk-layout.ts` — `DeskMode`, `DESK_MODES`, `mode` on `DeskLayout`, default/preserve in builders.
- `packages/shared/src/desk/desk-layout.spec.ts` — mode tests.
- `apps/web/src/lib/actions/dnd.ts` — `freeDrag.ondrop` gains `overTargetId`.
- `apps/web/src/routes/(app)/apps/+page.svelte` — per-mode render, full-screen + measured clamp, per-mode drop, mode selector in edit.

---

## Task 1: `mode` in the layout model (TDD)

**Files:**
- Modify: `packages/shared/src/desk/desk-layout.ts`
- Test: `packages/shared/src/desk/desk-layout.spec.ts`

- [ ] **Step 1: Append failing tests** to `desk-layout.spec.ts` (add `DESK_MODES`, `type DeskMode` to the existing import from './desk-layout'):

```ts
describe('mode', () => {
  it('defaultDeskLayout defaults to auto', () => {
    expect(defaultDeskLayout([{ key: 'transport' }]).mode).toBe('auto');
  });

  it('reconcileDeskLayout preserves a valid saved mode', () => {
    const saved: DeskLayout = { version: DESK_LAYOUT_VERSION, mode: 'free', items: [] };
    expect(reconcileDeskLayout(saved, [{ key: 'transport' }]).mode).toBe('free');
  });

  it('reconcileDeskLayout falls back to auto for missing/invalid mode', () => {
    const noMode = { version: DESK_LAYOUT_VERSION, items: [] } as unknown;
    expect(reconcileDeskLayout(noMode, [{ key: 'transport' }]).mode).toBe('auto');
    const bad = { version: DESK_LAYOUT_VERSION, mode: 'nope', items: [] } as unknown;
    expect(reconcileDeskLayout(bad, [{ key: 'transport' }]).mode).toBe('auto');
  });

  it('DESK_MODES lists the three modes', () => {
    expect(DESK_MODES).toEqual(['auto', 'free', 'reorder']);
  });
});
```

Note: the existing `DeskLayout` literals in this spec file (e.g. `{ version: DESK_LAYOUT_VERSION, items: [...] }`) will become type errors once `mode` is required. Fix them by adding `mode: 'auto'` (or `'free'` where relevant) to each existing `DeskLayout` literal in the spec, OR make `mode` optional on input — see Step 3 (the reconcile input is `unknown`, so only the explicitly-typed `DeskLayout` literals need `mode`). Add `mode: 'auto'` to those literals.

- [ ] **Step 2: Run, verify FAIL**

Run: `pnpm --filter @pulsar/shared test -- desk-layout`
Expected: FAIL — `DESK_MODES`/`DeskMode` missing; `mode` not on output.

- [ ] **Step 3: Implement**

In `desk-layout.ts`, after `DESK_LAYOUT_VERSION`:
```ts
export type DeskMode = 'auto' | 'free' | 'reorder';
export const DESK_MODES: DeskMode[] = ['auto', 'free', 'reorder'];
```
Add `mode: DeskMode;` to the `DeskLayout` interface (required on the output type).

In `defaultDeskLayout`, return `{ version: DESK_LAYOUT_VERSION, mode: 'auto', items: ... }`.

In `reconcileDeskLayout`, compute the mode from the saved object defensively and include it in the return:
```ts
  const savedMode = (s && typeof s === 'object' && (s as { mode?: unknown }).mode) as unknown;
  const mode: DeskMode = DESK_MODES.includes(savedMode as DeskMode) ? (savedMode as DeskMode) : 'auto';
  // ... existing positioned items ...
  return { version: DESK_LAYOUT_VERSION, mode, items: positioned };
```
Also the early `return defaultDeskLayout(domains)` (invalid input path) already yields `mode:'auto'` — good.

- [ ] **Step 4: Run, verify PASS**

Run: `pnpm --filter @pulsar/shared test -- desk-layout`
Expected: PASS (all, incl. prior position tests and the `toEqual(defaultDeskLayout(...))` fallback case — both now carry `mode:'auto'`).

- [ ] **Step 5: Build shared**

Run: `pnpm --filter @pulsar/shared build` → success.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/desk
git commit -m "feat(shared): DeskLayout.mode (auto|free|reorder), default auto, preserved on reconcile (tested)"
```

---

## Task 2: `freeDrag` reports the hovered tile at drop

**Files:**
- Modify: `apps/web/src/lib/actions/dnd.ts`

- [ ] **Step 1: Extend the `ondrop` signature + call**

In `FreeDragParams`, change `ondrop` to:
```ts
  ondrop: (x: number, y: number, folderTargetId: string | null, overTargetId: string | null) => void;
```
In the `finish` function, pass `lastTargetId` as the new 4th arg:
```ts
    if (dragging && commit) {
      p.ondrop(originX + (e.clientX - startX), originY + (e.clientY - startY), folderTargetId, lastTargetId);
    }
```
(`lastTargetId` is the tile id currently under the pointer — already tracked. `folderTargetId` stays the dwell-armed target.)

- [ ] **Step 2: Typecheck (page will error until Task 3)**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: an arity error at the `/apps` page `ondrop` callback. To keep this commit green, make the page's existing `ondrop` callback accept the extra arg now (it can ignore it): in `apps/web/src/routes/(app)/apps/+page.svelte`, change the `use:freeDrag` `ondrop` to `ondrop: (x, y, t) => onDragDrop(id, x, y, t)` → `ondrop: (x, y, t, _over) => onDragDrop(id, x, y, t)`. That single-line tweak keeps typecheck green; Task 3 rewrites it fully.

- [ ] **Step 3: Typecheck green + commit**

Run: `pnpm --filter @pulsar/web typecheck` → 0/0.
```bash
git add apps/web/src/lib/actions/dnd.ts "apps/web/src/routes/(app)/apps/+page.svelte"
git commit -m "feat(web): freeDrag.ondrop reports the hovered tile id at drop (for reorder mode)"
```

---

## Task 3: Per-mode render, full-screen canvas, mode selector

**Files:**
- Modify: `apps/web/src/routes/(app)/apps/+page.svelte`

Read the whole file first. It already has: load/reconcile, persist (debounced), edit mode, add-link picker, rename, right-click menu, folder overlay + framework hub, search store, the absolute canvas + `freeDrag` wiring, `deskId`, `foldInto`, `toChild`, `onDragStart/Move/FolderIntent`, `clampX`, `removeItem`, `addQuickLink`, `makeEmptyFolder`. PRESERVE all of it. Changes below.

- [ ] **Step 1: Import mode helpers + measure the container**

Add to imports: `import { DESK_MODES, type DeskMode } from '@pulsar/shared';` (keep existing `DESK_CANVAS_W, DESK_TILE, defaultPosition`).
Add measured size state:
```ts
let canvasW = $state(0);
let canvasH = $state(0);
```
(These bind to the desk container — Step 4.) The current `clampX` uses `DESK_CANVAS_W`; replace with measured width, with a fallback:
```ts
function clampX(x: number) {
  const w = canvasW || DESK_CANVAS_W;
  return Math.max(0, Math.min(x, w - DESK_TILE));
}
function clampY(y: number) {
  const h = canvasH || 600;
  return Math.max(0, Math.min(y, h - DESK_TILE));
}
```

- [ ] **Step 2: Mode-aware drop handler**

`layout.mode` is the current mode. Update `onDragDrop` to branch by mode (signature gains `overTargetId`):
```ts
function onDragDrop(id: string, x: number, y: number, folderTargetId: string | null, overTargetId: string | null) {
  movingId = null; movingPos = null; folderTargetId_state = null; // reset highlight (see note)
  const dragged = itemById(id);
  if (!dragged) return;

  if (folderTargetId && dragged.type !== 'folder') {
    foldInto(id, folderTargetId);            // dwell → folder (both free & reorder)
  } else if (layout.mode === 'free') {
    const nx = clampX(x), ny = clampY(y);
    layout = { ...layout, items: layout.items.map((it) => (deskId(it) === id ? { ...it, pos: { x: nx, y: ny } } : it)) };
  } else if (layout.mode === 'reorder' && overTargetId && overTargetId !== id) {
    reorderBefore(id, overTargetId);         // drop on a tile → reinsert before it
  }
  // mode 'auto' never attaches freeDrag, so it won't reach here via drag
  persist();
  setTimeout(() => { suppressClick = false; }, 0);
}
```
Note on the highlight reset: keep using the existing `folderTargetId` page state for the dwell ring — rename the local param to avoid shadowing. Concretely: the page state is `let folderTargetId = $state<string|null>(null)`; the drop callback param coming from `freeDrag` is the dwell id. To avoid confusion, name the callback param `dwellId`:
```ts
function onDragDrop(id, x, y, dwellId, overId) { ... folderTargetId = null; ... if (dwellId && dragged.type!=='folder') foldInto(id, dwellId); else if (mode==='free') ... else if (mode==='reorder' && overId && overId!==id) reorderBefore(id, overId); ... }
```
Add `reorderBefore`:
```ts
function reorderBefore(dragId: string, targetId: string) {
  const items = [...layout.items];
  const from = items.findIndex((it) => deskId(it) === dragId);
  const to = items.findIndex((it) => deskId(it) === targetId);
  if (from === -1 || to === -1 || from === to) return;
  const [moved] = items.splice(from, 1);
  const insertAt = items.findIndex((it) => deskId(it) === targetId); // recompute after removal
  items.splice(insertAt, 0, moved);
  layout = { ...layout, items };
}
```

- [ ] **Step 3: Mode selector (in edit mode)**

Near the "Personnaliser/OK" button, when `editing` is true, render a segmented control:
```svelte
{#if editing}
  <div class="inline-flex items-center gap-1 rounded-md border border-edge bg-surface p-0.5">
    {#each DESK_MODES as m (m)}
      <button type="button"
        class={`rounded px-2.5 py-1 text-sm font-medium transition-colors ${layout.mode === m ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'}`}
        onclick={() => { layout = { ...layout, mode: m }; persist(); }}
      >{m === 'auto' ? 'Grille auto' : m === 'free' ? 'Libre' : 'Réordonnable'}</button>
    {/each}
  </div>
{/if}
```

- [ ] **Step 4: Full-screen + per-mode render**

Remove the `max-w-5xl` / `max-w-[780px]` width constraints on the desk content so it fills the width. Bind the measured size on the layout container:
```svelte
<div class="relative w-full" bind:clientWidth={canvasW} bind:clientHeight={canvasH} style="min-height: calc(100vh - 7rem)">
  {#if search}
    <!-- centered results grid (existing markup), keyed deskId+'#'+i, no drag -->
  {:else if layout.mode === 'free'}
    <!-- absolute canvas: each item position:absolute left/top = (movingId===id&&movingPos)?movingPos:(item.pos ?? defaultPosition(i)); use:freeDrag with enabled:true; moving tile pointer-events:none; folderTargetId ring; keyed deskId+'#'+i -->
  {:else}
    <!-- auto OR reorder: flowing grid -->
    <div class="flex flex-wrap gap-x-10 gap-y-11 px-2 py-2">
      {#each layout.items as item, i (deskId(item) + '#' + i)}
        {@const id = deskId(item)}
        <div
          data-desk-id={id}
          style={layout.mode === 'reorder' ? 'touch-action:none;' : ''}
          class={folderTargetId === id ? 'ring-2 ring-accent rounded-2xl' : ''}
          use:freeDrag={layout.mode === 'reorder'
            ? { id, pos: { x: 0, y: 0 }, enabled: true, onstart: () => onDragStart(id), onmove: () => {}, onfolderintent: onFolderIntent, ondrop: (x, y, d, o) => onDragDrop(id, x, y, d, o) }
            : { id, pos: { x: 0, y: 0 }, enabled: false, onstart: () => {}, onmove: () => {}, onfolderintent: () => {}, ondrop: () => {} }}
        >
          <!-- same module/link/folder tile rendering as the free branch (DeskIcon/DeskFolderTile with editing/onremove/oncontext + rename input), but NO absolute positioning -->
        </div>
      {/each}
    </div>
  {/if}
</div>
```
Key points:
- `auto` mode: `enabled:false` on freeDrag (no movement); tiles still clickable + right-clickable + removable in edit.
- `reorder` mode: `enabled:true`, `onmove` is a no-op (the tile doesn't follow the pointer — it stays in the grid; only the drop reorders). Do NOT set `movingPos` in reorder mode, so the tile isn't absolutely moved. (If you want a drag visual later, that's a follow-up; keep it simple now.)
- `free` mode: unchanged from current (absolute, onmove sets movingPos, pointer-events:none on moving tile).
- The moving-tile `pointer-events:none` only applies in `free` (where the tile follows the cursor). In `reorder` the tile stays put, so dwell/over detection via elementFromPoint still works (the dragged tile is in place but `targetUnder` skips its own id).

To avoid duplicating the tile markup across the free and auto/reorder branches, extract a `{#snippet tile(item, i)}` Svelte snippet that renders the module/link/folder `DeskIcon`/`DeskFolderTile` (with `editing`, `onremove`, `oncontext`, rename input, and the per-type `onactivate`/`onopen` guarded by `!suppressClick && !editing`), and call it from both branches. The absolute wrapper (free) and the flex child (auto/reorder) each render `{@render tile(item, i)}` inside their positioned/static `<div>`.

- [ ] **Step 5: Keep tap-to-open + click guard**

`onactivate`/`onopen` keep the `if (!suppressClick && !editing)` guard. In `auto` mode there's no drag so `suppressClick` stays false → clicks open normally. Do NOT reintroduce pointer capture on pointerdown (regression guard).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @pulsar/web typecheck` → 0 errors, 0 warnings. Resolve any unused-var (`DESK_CANVAS_W` still used by `clampX` fallback; `canvasH` used by `clampY`).

- [ ] **Step 7: Browser verification (chrome-devtools)** — controller will drive; the implementer should still self-check the logic for:
  - default `auto`: tidy grid, full width, no drag, click opens.
  - switch to `free` in Personnaliser: absolute canvas, drag places (clamped to viewport, no scrollbar, icon can't leave), dwell→folder, persists on reload.
  - switch to `reorder`: dragging a tile onto another reinserts it (order changes), dwell→folder.
  - mode persists across reload; `each_key_duplicate` never thrown; clicks work in all modes.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/routes/(app)/apps/+page.svelte"
git commit -m "feat(web): desk display modes (auto/free/reorder) + full-screen canvas + mode selector"
```

---

## Final verification

- [ ] `pnpm test` — shared tests pass (incl. mode tests).
- [ ] `pnpm --filter @pulsar/web typecheck` → 0/0; `pnpm --filter @pulsar/web build` → clean.
- [ ] Browser: all three modes behave per spec; full-screen; mode persists; clicks work; no console errors.

## Self-review notes

- **Spec coverage:** mode model + default/preserve → Task 1. `overTargetId` at drop → Task 2. Per-mode render + full-screen measured clamp + mode selector + per-mode drop → Task 3. All covered.
- **Types:** `DeskMode`/`DESK_MODES`/`mode` defined in Task 1, consumed in Task 3. `freeDrag.ondrop(x,y,dwellId,overId)` defined in Task 2, consumed in Task 3.
- **Regression guards restated in-plan:** unique `{#each}` keys (id+index); capture only after threshold (Task 2/3 do not touch pointerdown capture).
- **Risk:** Task 3 is large (per-mode render + snippet extraction). The snippet extraction (Step 4) is the main complexity — keep the tile markup identical to today's, just relocated into a `{#snippet}`. Reorder's no-op `onmove` means no drag-follow visual (acceptable; can polish later).
- **Migration:** existing saved layouts (no `mode`) → `auto`; their `pos` values are retained for when the user switches to `free`.
