import type { Map as LeafletMap } from 'leaflet';

/** Leaflet caches a zero size when mounted in a hidden panel or during a transition. */
export function watchMapSize(element: HTMLElement, map: LeafletMap): () => void {
  let frame = 0;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (element.clientWidth && element.clientHeight) map.invalidateSize({ pan: false });
    });
  };
  const observer = new ResizeObserver(update);
  observer.observe(element);
  update();
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}

/** Leaflet treats string tooltips as HTML. Business labels must stay plain text. */
export function mapLabel(text: string): HTMLElement {
  const el = document.createElement('span');
  el.textContent = text;
  return el;
}
