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

  node.addEventListener('pointerdown', onpointerdown);
  node.addEventListener('pointermove', onpointermove);
  node.addEventListener('pointerup', onpointerup);

  return {
    update(next: GridDragParams) { p = next; },
    destroy() {
      clearDwell();
      node.removeEventListener('pointerdown', onpointerdown);
      node.removeEventListener('pointermove', onpointermove);
      node.removeEventListener('pointerup', onpointerup);
    },
  };
}
