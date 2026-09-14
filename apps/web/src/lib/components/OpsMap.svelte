<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import 'leaflet/dist/leaflet.css';

  interface MapStop {
    sequence: number;
    type: string;
    status: string;
    name: string;
    city: string;
    latitude: number | null;
    longitude: number | null;
  }
  interface MapLoad {
    id: string;
    loadNumber: string;
    status: string;
    carrier: string | null;
    isLate: boolean;
    lastPosition: { latitude: number; longitude: number; occurredAt: string } | null;
    stops: MapStop[];
  }

  let { loads = [] }: { loads: MapLoad[] } = $props();

  let el: HTMLDivElement;
  let leaflet = $state<typeof import('leaflet') | null>(null);
  let map: import('leaflet').Map | null = null;
  let markers: import('leaflet').LayerGroup | null = null;
  let fitted = false; // fit bounds on first data only — don't yank the user's pan/zoom on each poll

  onMount(() => {
    let destroyed = false;
    void import('leaflet').then((L) => {
      if (destroyed) return;
      map = L.map(el, { attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
      }).addTo(map);
      markers = L.layerGroup().addTo(map);
      map.setView([46.0, -72.5], 6); // sensible default until data lands
      leaflet = L; // set last: triggers the $effect below once ready
    });
    return () => {
      destroyed = true;
      map?.remove();
    };
  });

  /** Marker anchor: last known position, else first pending stop with coords. */
  function anchorOf(load: MapLoad): [number, number] | null {
    if (load.lastPosition) return [load.lastPosition.latitude, load.lastPosition.longitude];
    const next =
      load.stops.find((s) => s.status === 'PENDING' && s.latitude != null && s.longitude != null) ??
      load.stops.find((s) => s.latitude != null && s.longitude != null);
    return next ? [next.latitude!, next.longitude!] : null;
  }

  $effect(() => {
    const L = leaflet;
    if (!L || !map || !markers) return;
    markers.clearLayers();
    const anchors: [number, number][] = [];
    for (const load of loads) {
      const at = anchorOf(load);
      if (!at) continue;
      anchors.push(at);
      // Leaflet draws outside the CSS cascade — literal colors accepted here.
      const color = load.isLate ? '#dc2626' : '#1d4ed8';
      L.circleMarker(at, { radius: 9, color, fillColor: color, fillOpacity: 0.85 })
        .addTo(markers)
        .bindTooltip(
          `${load.loadNumber} — ${load.carrier ?? 'aucun transporteur'} · ${load.status}${load.isLate ? ' · RETARD' : ''}`,
        )
        .on('click', () => void goto(`/loads/${load.id}`));
    }
    if (!fitted && anchors.length > 0) {
      fitted = true;
      if (anchors.length === 1) map.setView(anchors[0], 9);
      else map.fitBounds(L.latLngBounds(anchors).pad(0.2));
    }
  });
</script>

<div bind:this={el} class="h-80 w-full rounded-card border border-edge"></div>
