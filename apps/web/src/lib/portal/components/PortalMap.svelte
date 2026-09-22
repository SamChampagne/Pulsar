<script module lang="ts">
  export interface PortalMapPoint {
    id: string;
    label: string;
    latitude: number;
    longitude: number;
    /** Free-form second line of the tooltip (e.g. "position à 14:02"). */
    detail?: string | null;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { watchMapSize, mapLabel } from '$lib/maps/lifecycle';
  import 'leaflet/dist/leaflet.css';

  /**
   * Public-safe live map for the customer portal: it plots ONLY the single last
   * known position the API exposes per moving shipment (rule 20 — no history,
   * no other stops of the tour, no route geometry). Leaflet is imported
   * dynamically so the portal bundle stays small for customers who never open
   * the dashboard.
   */
  let { points = [], height = 'h-72' }: { points?: PortalMapPoint[]; height?: string } = $props();

  let el: HTMLDivElement;
  let leaflet = $state<typeof import('leaflet') | null>(null);
  let map: import('leaflet').Map | null = null;
  let markers: import('leaflet').LayerGroup | null = null;
  // Fit once per data shape: re-fitting on every poll would fight the visitor's pan/zoom.
  let fittedKey = '';

  onMount(() => {
    let destroyed = false;
    let stopResize = () => {};
    void import('leaflet').then((L) => {
      if (destroyed) return;
      map = L.map(el, { attributionControl: true });
      stopResize = watchMapSize(el, map);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
      }).addTo(map);
      markers = L.layerGroup().addTo(map);
      map.setView([46.0, -72.5], 5); // sensible default until data lands
      leaflet = L; // set last: triggers the $effect below once ready
    });
    return () => {
      destroyed = true;
      stopResize();
      map?.remove();
      map = null;
    };
  });

  $effect(() => {
    const L = leaflet;
    if (!L || !map || !markers) return;
    markers.clearLayers();
    const anchors: [number, number][] = [];
    for (const point of points) {
      const at: [number, number] = [point.latitude, point.longitude];
      anchors.push(at);
      // Leaflet draws outside the CSS cascade — literal colors accepted here.
      L.circleMarker(at, { radius: 8, color: '#1d4ed8', fillColor: '#1d4ed8', fillOpacity: 0.85 })
        .addTo(markers)
        .bindTooltip(mapLabel(point.detail ? `${point.label} — ${point.detail}` : point.label));
    }
    const key = anchors.map((a) => a.join(',')).join('|');
    if (key && key !== fittedKey) {
      fittedKey = key;
      if (anchors.length === 1) map.setView(anchors[0], 8);
      else map.fitBounds(L.latLngBounds(anchors).pad(0.25));
    }
  });
</script>

<div
  bind:this={el}
  class={`${height} w-full overflow-hidden rounded-card border border-edge`}
  role="img"
  aria-label={`Carte des expéditions en transit (${points.length})`}
></div>
