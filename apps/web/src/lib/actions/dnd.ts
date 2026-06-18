export interface GridDragParams {
  index: number;
  enabled: boolean;
  onpick: (index: number) => void;
  onhover: (overIndex: number | null, folderIntent: boolean) => void;
  ondrop: (fromIndex: number, overIndex: number | null, folderIntent: boolean) => void;
}

/**
 * Pointer-based drag for a grid of tiles. Each draggable host must carry
 * `data-desk-index`. On pointerdown (when enabled) we arm; after the pointer
 * moves past a small threshold we start dragging (onpick). On move we resolve the
 * tile under the pointer via elementFromPoint and report its index (onhover).
 * On pointerup we report ondrop(fromIndex, overIndex|null, folderIntent).
 *
 * Dwell detection: if the pointer rests on the SAME target tile for ≥500 ms without
 * moving to a different tile, `folderIntent` becomes true and onhover is called again
 * with folderIntent=true. Moving away cancels the dwell and resets folderIntent.
 */
export function gridDrag(node: HTMLElement, params: GridDragParams) {
  let p = params;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let armed = false;
  let lastOver: number | null = null;
  let folderIntent = false;
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;
  const THRESH = 6;
  const DWELL_MS = 500;

  function clearDwell() {
    if (dwellTimer !== null) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
  }

  function indexUnder(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const host = el?.closest('[data-desk-index]') as HTMLElement | null;
    if (!host) return null;
    const v = host.getAttribute('data-desk-index');
    return v === null ? null : Number(v);
  }

  function onpointerdown(e: PointerEvent) {
    if (!p.enabled || e.button !== 0) return;
    armed = true;
    startX = e.clientX;
    startY = e.clientY;
    node.setPointerCapture(e.pointerId);
  }

  function onpointermove(e: PointerEvent) {
    if (!armed) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESH) return;
      dragging = true;
      p.onpick(p.index);
    }

    const over = indexUnder(e.clientX, e.clientY);

    if (over !== lastOver) {
      // Target changed — cancel any pending dwell and reset folder intent
      clearDwell();
      folderIntent = false;
      lastOver = over;

      // Start dwell timer only when hovering a distinct, valid tile
      if (over !== null && over !== p.index) {
        dwellTimer = setTimeout(() => {
          folderIntent = true;
          dwellTimer = null;
          p.onhover(over, true);
        }, DWELL_MS);
      }
    }

    // Always report current hover position (folderIntent reflects current state)
    p.onhover(over, folderIntent);
  }

  function onpointerup(e: PointerEvent) {
    try { node.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    clearDwell();
    if (dragging) p.ondrop(p.index, lastOver, folderIntent);
    armed = false;
    dragging = false;
    folderIntent = false;
    lastOver = null;
  }

  function onpointercancel() {
    // OS gesture / palm rejection aborted the drag: reset state, do NOT commit a drop.
    clearDwell();
    const wasDragging = dragging;
    armed = false;
    dragging = false;
    folderIntent = false;
    lastOver = null;
    if (wasDragging) p.onhover(null, false);
  }

  node.addEventListener('pointerdown', onpointerdown);
  node.addEventListener('pointermove', onpointermove);
  node.addEventListener('pointerup', onpointerup);
  node.addEventListener('pointercancel', onpointercancel);

  return {
    update(next: GridDragParams) { p = next; },
    destroy() {
      clearDwell();
      node.removeEventListener('pointerdown', onpointerdown);
      node.removeEventListener('pointermove', onpointermove);
      node.removeEventListener('pointerup', onpointerup);
      node.removeEventListener('pointercancel', onpointercancel);
    },
  };
}

export interface FreeDragParams {
  /** Stable id of THIS tile (matches data-desk-id), used to skip self when detecting a dwell target. */
  id: string;
  /** Current top-left position of the tile, used as the drag origin. */
  pos: { x: number; y: number };
  /** Master switch (drag allowed at any time on the desk → usually true; false while searching). */
  enabled: boolean;
  onstart: () => void;
  /** Live top-left position while dragging (canvas coords). */
  onmove: (x: number, y: number) => void;
  /** data-desk-id under the pointer after a 500ms dwell, or null. */
  onfolderintent: (targetId: string | null) => void;
  /** Final top-left position + folder-target id if a dwell was armed. */
  ondrop: (x: number, y: number, folderTargetId: string | null) => void;
}

export function freeDrag(node: HTMLElement, params: FreeDragParams) {
  let p = params;
  let startX = 0, startY = 0;
  let originX = 0, originY = 0;
  let armed = false, dragging = false;
  let folderTargetId: string | null = null;
  let lastTargetId: string | null = null;
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;
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
    p.onmove(originX + (e.clientX - startX), originY + (e.clientY - startY));
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
    if (dragging && commit) {
      p.ondrop(originX + (e.clientX - startX), originY + (e.clientY - startY), folderTargetId);
    }
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
