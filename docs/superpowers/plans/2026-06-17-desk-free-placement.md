# Desk Free Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `/apps` springboard from a reflowing grid into a free pixel-positioned canvas — each icon keeps the exact `(x,y)` where it's dropped, no auto-reflow, dwell-to-folder preserved.

**Architecture:** Add an optional `pos {x,y}` to top-level desk items in `@pulsar/shared` (with pure default/reconcile position assignment, unit-tested), rewrite the drag action from grid-index reorder to absolute move, and render `/apps` as an absolutely-positioned canvas of fixed width.

**Tech Stack:** `@pulsar/shared` (Vitest), SvelteKit SPA (Svelte 5 runes), Tailwind, native pointer drag. Backend unchanged (deskLayout JSON already persists items; it now carries `pos`).

**Spec:** `docs/superpowers/specs/2026-06-17-desk-free-placement-design.md`

**Branch:** continue on `ux-polish-pass`.

**Verification reality:** `@pulsar/shared` has Vitest (Task 1 = TDD). `apps/web` has NO component runner → `pnpm --filter @pulsar/web typecheck` (0/0) + manual + chrome-devtools browser verification. The desk dev server runs at localhost:5173 (`/apps`, admin@pulsar.dev / admin123).

**Regression guard:** A prior bug (`each_key_duplicate`) crashed the desk when a keyed `{#each}` had duplicate keys. Keep `{#each}` keys unique (include index). Do not reintroduce.

---

## File Structure

**Modified**
- `packages/shared/src/desk/desk-layout.ts` — `DeskPosition`, `pos?` on items, layout constants, `defaultPosition()`, position assignment in `defaultDeskLayout`/`reconcileDeskLayout`.
- `packages/shared/src/desk/desk-layout.spec.ts` — position tests.
- `apps/web/src/lib/actions/dnd.ts` — absolute-move drag (replaces grid-index reorder), keeps dwell→folder, drag enabled anytime.
- `apps/web/src/routes/(app)/apps/+page.svelte` — absolute canvas + scroll-x + clamp + positioned render + search-grid fallback.

---

## Task 1: Position model in `@pulsar/shared` (TDD)

**Files:**
- Modify: `packages/shared/src/desk/desk-layout.ts`
- Test: `packages/shared/src/desk/desk-layout.spec.ts`

- [ ] **Step 1: Write the failing tests** — append to `desk-layout.spec.ts`:

```ts
import {
  defaultPosition,
  DESK_COLS,
  DESK_TILE,
  DESK_GAP,
} from './desk-layout';

describe('positions', () => {
  it('defaultPosition lays out in a grid by index', () => {
    expect(defaultPosition(0)).toEqual({ x: DESK_GAP, y: DESK_GAP });
    expect(defaultPosition(1)).toEqual({ x: DESK_GAP + (DESK_TILE + DESK_GAP), y: DESK_GAP });
    // first item of second row (index === DESK_COLS)
    expect(defaultPosition(DESK_COLS)).toEqual({ x: DESK_GAP, y: DESK_GAP + (DESK_TILE + DESK_GAP) });
  });

  it('defaultDeskLayout assigns a pos to every top-level item', () => {
    const layout = defaultDeskLayout([{ key: 'transport' }, { key: 'wms' }]);
    expect(layout.items.every((i) => i.pos && typeof i.pos.x === 'number')).toBe(true);
    expect(layout.items[0].pos).toEqual(defaultPosition(0));
  });

  it('reconcileDeskLayout preserves existing pos', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      items: [{ type: 'module', moduleKey: 'transport', pos: { x: 500, y: 300 } }],
    };
    const out = reconcileDeskLayout(saved, [{ key: 'transport' }]);
    const t = out.items.find((i) => i.type === 'module' && (i as any).moduleKey === 'transport');
    expect(t?.pos).toEqual({ x: 500, y: 300 });
  });

  it('reconcileDeskLayout assigns a pos to items lacking one and to newly-visible modules', () => {
    const saved: DeskLayout = {
      version: DESK_LAYOUT_VERSION,
      items: [{ type: 'module', moduleKey: 'transport' }], // no pos (old layout)
    };
    const out = reconcileDeskLayout(saved, [{ key: 'transport' }, { key: 'wms' }]);
    // every item ends up with a pos
    expect(out.items.every((i) => i.pos && typeof i.pos.x === 'number')).toBe(true);
    // wms is newly visible and was appended with a default pos
    const wms = out.items.find((i) => i.type === 'module' && (i as any).moduleKey === 'wms');
    expect(wms?.pos).toBeTruthy();
  });

  it('reconcileDeskLayout is deterministic (no Math.random/Date.now)', () => {
    const saved: DeskLayout = { version: DESK_LAYOUT_VERSION, items: [{ type: 'module', moduleKey: 'transport' }] };
    expect(reconcileDeskLayout(saved, [{ key: 'transport' }])).toEqual(
      reconcileDeskLayout(saved, [{ key: 'transport' }]),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pulsar/shared test -- desk-layout`
Expected: FAIL — `defaultPosition`/`DESK_COLS`/`DESK_TILE`/`DESK_GAP` not exported; `pos` missing.

- [ ] **Step 3: Add the position model + constants**

In `packages/shared/src/desk/desk-layout.ts`, add near the top (after `DESK_LAYOUT_VERSION`):

```ts
export interface DeskPosition {
  x: number;
  y: number;
}

export const DESK_TILE = 96;
export const DESK_GAP = 28;
export const DESK_COLS = 6;
export const DESK_CANVAS_W = DESK_COLS * (DESK_TILE + DESK_GAP) + DESK_GAP;

export function defaultPosition(index: number): DeskPosition {
  const col = index % DESK_COLS;
  const row = Math.floor(index / DESK_COLS);
  return {
    x: DESK_GAP + col * (DESK_TILE + DESK_GAP),
    y: DESK_GAP + row * (DESK_TILE + DESK_GAP),
  };
}
```

Add `pos?: DeskPosition` to each `DeskItem` variant (module / link / folder). Leave `DeskFolderChild` unchanged.

- [ ] **Step 4: Assign positions in `defaultDeskLayout`**

Update `defaultDeskLayout` so each top-level item gets `pos`:

```ts
export function defaultDeskLayout(domains: { key: string }[]): DeskLayout {
  const base: DeskItem[] = [
    ...domains
      .filter((d) => d.key !== 'dashboard')
      .map((d): DeskItem => ({ type: 'module', moduleKey: d.key })),
    { type: 'folder', id: FRAMEWORK_FOLDER_ID, name: 'Framework', items: [...FRAMEWORK_LINKS] },
  ];
  return {
    version: DESK_LAYOUT_VERSION,
    items: base.map((it, i) => ({ ...it, pos: defaultPosition(i) })),
  };
}
```

- [ ] **Step 5: Assign/preserve positions in `reconcileDeskLayout`**

In the existing `reconcileDeskLayout`, after the final `items` array is built (top-level items kept + newly-appended modules), ensure every item has a `pos`: preserve existing, else assign `defaultPosition` by a running counter. Add just before the final `return`:

```ts
  // Ensure every top-level item has a position (preserve saved, default the rest).
  const positioned = items.map((it, i) => (it.pos ? it : { ...it, pos: defaultPosition(i) }));
  return { version: DESK_LAYOUT_VERSION, items: positioned };
```

(Keep the module-stripping/dedup logic above unchanged. The `pos` on preserved items flows through because the kept `raw` items are spread as-is; confirm the kept `module`/`link`/`folder` items retain their `pos` — they do, since you push the original `raw` objects which include `pos`.)

NOTE: the existing tests do `toEqual(defaultDeskLayout(domains))` for the invalid-input case — since both now assign positions deterministically, they still match. Verify.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @pulsar/shared test -- desk-layout`
Expected: PASS (all prior + new position tests). If the "falls back to default" equality test breaks, ensure `reconcileDeskLayout(invalid)` returns exactly `defaultDeskLayout(domains)` (same positions).

- [ ] **Step 7: Build shared**

Run: `pnpm --filter @pulsar/shared build`
Expected: success.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/desk
git commit -m "feat(shared): desk items carry pos{x,y}; default/reconcile assign grid positions (tested)"
```

---

## Task 2: Absolute-move drag action

**Files:**
- Modify: `apps/web/src/lib/actions/dnd.ts`

The current `gridDrag` reports `onpick(index)`, `onhover(over, folderIntent)`, `ondrop(from, over, folderIntent)` — index-based. Rewrite to absolute movement while keeping the dwell-to-folder detection.

- [ ] **Step 1: Replace the action with a free-move version**

```ts
export interface FreeDragParams {
  /** Stable id of THIS tile (data-desk-id), used to skip self when detecting dwell target. */
  id: string;
  /** Current position of the tile (top-left), used as the drag start origin. */
  pos: { x: number; y: number };
  /** Master switch — drag is allowed at any time on the desk, so usually true. */
  enabled: boolean;
  onstart: () => void;
  /** Live position while dragging (tile top-left, in canvas coords). */
  onmove: (x: number, y: number) => void;
  /** Dwell target highlight: the data-desk-id under the pointer after 500ms, or null. */
  onfolderintent: (targetId: string | null) => void;
  /** Drop: final position + the folder-target id if a dwell was armed. */
  ondrop: (x: number, y: number, folderTargetId: string | null) => void;
}

export function freeDrag(node: HTMLElement, params: FreeDragParams) {
  let p = params;
  let startX = 0, startY = 0;          // pointer down position
  let originX = 0, originY = 0;        // tile pos at drag start
  let armed = false, dragging = false;
  let folderTargetId: string | null = null;
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTargetId: string | null = null;
  const THRESH = 6, DWELL_MS = 500;

  function clearDwell() { if (dwellTimer !== null) { clearTimeout(dwellTimer); dwellTimer = null; } }

  function targetUnder(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const host = el?.closest('[data-desk-id]') as HTMLElement | null;
    const id = host?.getAttribute('data-desk-id') ?? null;
    return id && id !== p.id ? id : null;
  }

  function onpointerdown(e: PointerEvent) {
    if (!p.enabled || e.button !== 0) return;
    armed = true;
    startX = e.clientX; startY = e.clientY;
    originX = p.pos.x; originY = p.pos.y;
    node.setPointerCapture(e.pointerId);
  }
  function onpointermove(e: PointerEvent) {
    if (!armed) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESH) return;
      dragging = true;
      p.onstart();
    }
    const nx = originX + (e.clientX - startX);
    const ny = originY + (e.clientY - startY);
    p.onmove(nx, ny);
    const t = targetUnder(e.clientX, e.clientY);
    if (t !== lastTargetId) {
      clearDwell();
      folderTargetId = null;
      p.onfolderintent(null);
      lastTargetId = t;
      if (t) dwellTimer = setTimeout(() => { folderTargetId = t; dwellTimer = null; p.onfolderintent(t); }, DWELL_MS);
    }
  }
  function finish(e: PointerEvent, commit: boolean) {
    try { node.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    clearDwell();
    if (dragging && commit) p.ondrop(originX + (e.clientX - startX), originY + (e.clientY - startY), folderTargetId);
    armed = false; dragging = false; folderTargetId = null; lastTargetId = null;
    p.onfolderintent(null);
  }
  function onpointerup(e: PointerEvent) { finish(e, true); }
  function onpointercancel(e: PointerEvent) { finish(e, false); }

  node.addEventListener('pointerdown', onpointerdown);
  node.addEventListener('pointermove', onpointermove);
  node.addEventListener('pointerup', onpointerup);
  node.addEventListener('pointercancel', onpointercancel);
  return {
    update(next: FreeDragParams) { p = next; },
    destroy() {
      clearDwell();
      node.removeEventListener('pointerdown', onpointerdown);
      node.removeEventListener('pointermove', onpointermove);
      node.removeEventListener('pointerup', onpointerup);
      node.removeEventListener('pointercancel', onpointercancel);
    },
  };
}

/** True briefly after a drag so the subsequent click can be suppressed. */
export function justDragged(node: HTMLElement) {
  // helper not needed — the page tracks a `moved` flag from onstart/ondrop. (kept intentionally minimal)
}
```

Remove the old `gridDrag`/`GridDragParams` exports (or leave them unused — but the page will stop importing them; delete to avoid dead code).

- [ ] **Step 2: Typecheck (will fail at the page until Task 3)**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: errors only in `apps/web/src/routes/(app)/apps/+page.svelte` (still importing `gridDrag`). That's fine — fixed in Task 3. (If you prefer a green checkpoint, do Task 2 + Task 3 before committing; commit message below assumes you commit after Task 3 compiles. So: do NOT commit Task 2 alone if it leaves the build red — proceed to Task 3 and commit together, or temporarily keep `gridDrag` exported until Task 3 removes its usage.)

Recommended: keep BOTH `gridDrag` (old) and `freeDrag` (new) exported in this commit so typecheck stays green, then remove `gridDrag` in Task 3 once the page no longer imports it.

- [ ] **Step 3: Commit (green)**

```bash
git add apps/web/src/lib/actions/dnd.ts
git commit -m "feat(web): add freeDrag pointer action (absolute move + dwell-to-folder)"
```

---

## Task 3: `/apps` absolute canvas

**Files:**
- Modify: `apps/web/src/routes/(app)/apps/+page.svelte`

- [ ] **Step 1: Import constants + free drag**

Add to imports:
```ts
import { DESK_CANVAS_W, DESK_TILE, defaultPosition } from '@pulsar/shared';
import { freeDrag } from '$lib/actions/dnd';
```
Remove the `gridDrag` import.

- [ ] **Step 2: Replace drag state with position-move handlers**

Remove `dragIndex`/`hoverIndex`/`folderTargetIndex` index state and `onpick`/`onhover`/`ondrop(from,over,...)`. Add:

```ts
let movingId = $state<string | null>(null);     // id being dragged
let movingPos = $state<{ x: number; y: number } | null>(null);
let folderTargetId = $state<string | null>(null);
let suppressClick = false;                       // set on drag, blocks the click after a move

function deskId(item: DeskItem): string {
  if (item.type === 'folder') return `folder:${item.id}`;
  if (item.type === 'module') return `module:${item.moduleKey}`;
  return `link:${item.href}`;
}
function itemById(id: string): DeskItem | undefined {
  return layout.items.find((it) => deskId(it) === id);
}

function onDragStart(id: string) { movingId = id; suppressClick = true; }
function onDragMove(x: number, y: number) { movingPos = { x, y }; }
function onFolderIntent(id: string | null) { folderTargetId = id; }

function clampX(x: number) { return Math.max(0, Math.min(x, DESK_CANVAS_W - DESK_TILE)); }

function onDragDrop(id: string, x: number, y: number, targetId: string | null) {
  movingId = null; movingPos = null; folderTargetId = null;
  const dragged = itemById(id);
  if (!dragged) return;
  if (targetId) {
    // dwell on another tile → folder (reuse existing makeFolderFrom logic)
    foldInto(id, targetId);
  } else {
    // free move → set clamped position
    const nx = clampX(x), ny = Math.max(0, y);
    layout = { ...layout, items: layout.items.map((it) => (deskId(it) === id ? { ...it, pos: { x: nx, y: ny } } : it)) };
  }
  persist();
  // release click suppression on next tick
  setTimeout(() => { suppressClick = false; }, 0);
}
```

Implement `foldInto(dragId, targetId)` adapting the EXISTING folder-create/append logic (from the old `ondrop`) but resolving items by id instead of index: if target is a folder and dragged is non-folder → append `toChild(dragged)` to that folder and remove dragged; if both non-folder → replace target with a new folder `{ type:'folder', id: crypto.randomUUID(), name:'Dossier', pos: target.pos, items:[toChild(target), toChild(dragged)] }` and remove dragged. Folder keeps the target's `pos`. (Keep `toChild` as-is.)

- [ ] **Step 3: Gate click after drag**

In each tile's `onactivate`/`onopen`, guard with `if (!suppressClick && !editing) …` for navigation/open. (When `suppressClick` is true — just dragged — the click is ignored; normal clicks still work.)

- [ ] **Step 4: Render the absolute canvas**

Replace the grid container. Compute canvas height:
```ts
const canvasHeight = $derived(
  Math.max(
    420,
    ...layout.items.map((it) => (it.pos?.y ?? 0) + DESK_TILE + 56),
  ),
);
```
Render (when NOT searching):
```svelte
{#if search}
  <!-- search results: simple centered grid, no positioning, no drag -->
  <div class="mx-auto grid max-w-[780px] grid-cols-3 justify-items-center gap-x-10 gap-y-11 sm:grid-cols-4 lg:grid-cols-6">
    {#each visibleItems as item, i (deskId(item) + '#' + i)}
      <!-- same DeskIcon/DeskFolderTile, onactivate/onopen only (no drag) -->
    {/each}
  </div>
{:else}
  <div class="overflow-x-auto">
    <div class="relative mx-auto" style={`width:${DESK_CANVAS_W}px; height:${canvasHeight}px`}>
      {#each layout.items as item, i (deskId(item) + '#' + i)}
        {@const id = deskId(item)}
        {@const pos = movingId === id && movingPos ? movingPos : (item.pos ?? defaultPosition(i))}
        <div
          data-desk-id={id}
          class="absolute"
          style={`left:${pos.x}px; top:${pos.y}px; touch-action:none; ${movingId === id ? 'z-index:20;' : ''}`}
          use:freeDrag={{ id, pos: item.pos ?? defaultPosition(i), enabled: !search, onstart: () => onDragStart(id), onmove: onDragMove, onfolderintent: onFolderIntent, ondrop: (x, y, t) => onDragDrop(id, x, y, t) }}
        >
          <!-- existing module/link/folder tile, plus: when folderTargetId === id show ring-2 ring-accent; pass editing + onremove + oncontext as before -->
        </div>
      {/each}
    </div>
  </div>
{/if}
```
Keep the `+ Ajouter un lien` affordance available in edit mode (it can sit in a fixed corner of the canvas or above it — place it above the canvas as a normal button when `editing`).

- [ ] **Step 5: Keep `{#each}` keys unique**

Both loops key by `deskId(item) + '#' + i` (regression guard against `each_key_duplicate`).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @pulsar/web typecheck` → 0 errors, 0 warnings. Remove the now-unused old `gridDrag` export from `dnd.ts` if nothing imports it (grep first).

- [ ] **Step 7: Browser verification (chrome-devtools)**

Reload `http://localhost:5173/apps` (ignoreCache). Verify with evaluate_script + snapshot:
- icons render at absolute positions (not a reflow grid);
- dragging an icon moves only that icon and it stays where dropped (read its `style.left/top` before/after);
- dwell ~500ms over another icon then drop → a folder is created (no `each_key_duplicate` error in console);
- reload → positions persisted (came from backend);
- typing in the top-bar search → centered results grid; clearing → canvas returns;
- **console has zero errors** throughout.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/routes/(app)/apps/+page.svelte" apps/web/src/lib/actions/dnd.ts
git commit -m "feat(web): /apps free pixel-positioned canvas (drag anywhere, persisted)"
```

---

## Final verification

- [ ] `pnpm test` — shared tests pass (incl. new position tests).
- [ ] `pnpm --filter @pulsar/web typecheck` → 0/0; `pnpm --filter @pulsar/web build` → clean.
- [ ] Browser: free placement works end-to-end, positions persist, folders still form via dwell, search grid works, no console errors.
- [ ] `grep -rn "gridDrag" apps/web/src` → no stale references.

## Self-review notes

- **Spec coverage:** position model + default/reconcile → Task 1. Free-move drag + dwell→folder + drag-anytime → Task 2. Absolute canvas + clamp + scroll-x + search grid + click-vs-drag guard → Task 3. All covered.
- **Types:** `DeskPosition`, `pos?`, `DESK_CANVAS_W/DESK_TILE/DESK_GAP/DESK_COLS`, `defaultPosition` defined in Task 1 and consumed in Task 3. `FreeDragParams`/`freeDrag` defined in Task 2 and used in Task 3.
- **Regression:** `{#each}` keys include index (no `each_key_duplicate`); `pointercancel` aborts cleanly.
- **Determinism:** position assignment uses an index counter (no `Math.random`/`Date.now`) so shared tests' `toEqual` holds; runtime folder ids still use `crypto.randomUUID()` in the web layer only.
- **Risk:** click-vs-drag suppression (Task 3 Step 3) is the fiddly part — verified in-browser (Step 7).
