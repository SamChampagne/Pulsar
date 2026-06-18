
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
