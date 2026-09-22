<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { watchMapSize, mapLabel } from '$lib/maps/lifecycle';
  import { formatDateTime } from '$lib/format';
  import 'leaflet/dist/leaflet.css';

  interface Point {
    latitude: number | null;
    longitude: number | null;
  }
  let {
    origin,
    destination,
    lastPosition = null,
  }: {
    origin: Point;
    destination: Point;
    lastPosition: { latitude: number; longitude: number; occurredAt: string } | null;
  } = $props();

  let el: HTMLDivElement;
  let hasPoints = $state(false);

  onMount(() => {
    let map: import('leaflet').Map | null = null;
    let destroyed = false;
    let stopResize = () => {};

    void (async () => {
      const L = await import('leaflet');
      if (destroyed) return;

      if (
        (origin.latitude == null || origin.longitude == null) &&
        (destination.latitude == null || destination.longitude == null) &&
        !lastPosition
      ) {
        return; // nothing to draw: map stays hidden (graceful degradation)
      }
      hasPoints = true;
      await tick();
      if (destroyed) return;

      map = L.map(el, { attributionControl: true });
      stopResize = watchMapSize(el, map);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
      }).addTo(map);

      const pts: [number, number][] = [];
      const add = (p: Point | null, color: string, label: string) => {
        if (p?.latitude == null || p?.longitude == null) return;
        const at: [number, number] = [p.latitude, p.longitude];
        pts.push(at);
        // Leaflet draws outside the CSS cascade — literal brand colors accepted here.
        L.circleMarker(at, { radius: 8, color, fillColor: color, fillOpacity: 0.85 })
          .addTo(map!)
          .bindTooltip(mapLabel(label));
      };

      add(origin, '#1d4ed8', 'Origine');
      add(destination, '#1d4ed8', 'Destination');
      if (lastPosition) {
        add(
          lastPosition,
          '#15803d',
          `Dernière position — ${formatDateTime(lastPosition.occurredAt)}`,
        );
      }

      if (pts.length === 1) map.setView(pts[0], 9);
      else map.fitBounds(L.latLngBounds(pts).pad(0.2));
    })();

    return () => {
      destroyed = true;
      stopResize();
      map?.remove();
    };
  });
</script>

<div
  bind:this={el}
  class={`h-56 w-full rounded-card border border-edge ${hasPoints ? '' : 'hidden'}`}
></div>
