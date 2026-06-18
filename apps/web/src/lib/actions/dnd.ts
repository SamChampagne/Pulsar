export interface GridDragParams {
  index: number;
  enabled: boolean;
  onpick: (index: number) => void;
  onhover: (overIndex: number) => void;
  ondrop: (fromIndex: number, overIndex: number | null) => void;
}

/**
 * Pointer-based drag for a grid of tiles. Each draggable host must carry
 * `data-desk-index`. On pointerdown (when enabled) we arm; after the pointer
 * moves past a small threshold we start dragging (onpick). On move we resolve the
 * tile under the pointer via elementFromPoint and report its index (onhover).
 * On pointerup we report ondrop(fromIndex, overIndex|null).
 */
export function gridDrag(node: HTMLElement, params: GridDragParams) {
  let p = params;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let armed = false;
  let overIndex: number | null = null;
  const THRESH = 6;

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
    overIndex = indexUnder(e.clientX, e.clientY);
    if (overIndex !== null) p.onhover(overIndex);
  }
  function onpointerup(e: PointerEvent) {
    try { node.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (dragging) p.ondrop(p.index, overIndex);
    armed = false;
    dragging = false;
    overIndex = null;
  }

  node.addEventListener('pointerdown', onpointerdown);
  node.addEventListener('pointermove', onpointermove);
  node.addEventListener('pointerup', onpointerup);

  return {
    update(next: GridDragParams) { p = next; },
    destroy() {
      node.removeEventListener('pointerdown', onpointerdown);
      node.removeEventListener('pointermove', onpointermove);
      node.removeEventListener('pointerup', onpointerup);
    },
  };
}
