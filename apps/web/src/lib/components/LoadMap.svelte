<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { formatDateTime } from '$lib/format';
  import 'leaflet/dist/leaflet.css';

  interface StopIn {
    sequence: number;
    locationId: string;
    type: string;
  }
  let { stops = [] as StopIn[], loadId, geometry = null as unknown } = $props();

  let el: HTMLDivElement;
  let hasPoints = $state(false);

  interface Loc {
    id: string;
    latitude: number | null;
    longitude: number | null;
    name: string;
  }
  interface TrackingEvent {
    type: string;
    latitude: number | null;
    longitude: number | null;
    occurredAt: string;
  }

  onMount(() => {
    let map: import('leaflet').Map | null = null;
    let destroyed = false;

    void (async () => {
      const L = await import('leaflet');
      if (destroyed) return;

      const locs = await Promise.all(
        [...new Set(stops.map((s) => s.locationId))].map((id) =>
          api<Loc>(`/locations/${id}`).catch(() => null),
        ),
      );
      if (destroyed) return;

      const byId = new Map(locs.filter(Boolean).map((l) => [l!.id, l!]));
      const points = stops
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map((s) => ({ s, loc: byId.get(s.locationId) }))
        .filter((p) => p.loc?.latitude != null && p.loc?.longitude != null);

      if (points.length === 0) return; // graceful degradation: map stays hidden
      hasPoints = true;

      map = L.map(el, { attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
      }).addTo(map);

      const latlngs = points.map((p) => [p.loc!.latitude!, p.loc!.longitude!] as [number, number]);
      // Leaflet draws outside the CSS cascade — literal brand colors accepted here.
      points.forEach((p, i) => {
        // Using circleMarker instead of marker to avoid default icon 404 under bundlers.
        L.circleMarker(latlngs[i], {
          radius: 8,
          color: '#1d4ed8',
          fillColor: '#1d4ed8',
          fillOpacity: 0.8,
        })
          .addTo(map!)
          .bindTooltip(`${i + 1}. ${p.loc!.name} (${p.s.type})`);
      });
      if (geometry) {
        // OSRM GeoJSON is [lng, lat]; L.geoJSON handles the order natively.
        // NEVER feed raw GeoJSON coords to L.polyline (expects [lat, lng]) —
        // the route would draw in the ocean (spec §C).
        L.geoJSON(geometry as GeoJSON.GeoJsonObject, {
          style: { color: '#1d4ed8', weight: 3, opacity: 0.8 },
        }).addTo(map);
      } else {
        // Fallback: straight dashed lines between stops.
        L.polyline(latlngs, { color: '#1d4ed8', dashArray: '6 6' }).addTo(map);
      }

      try {
        const events = await api<TrackingEvent[]>('/transportation/tracking/events', {
          query: { loadId },
        });
        if (destroyed) return;
        const pos = events.find((e) => e.latitude != null && e.longitude != null);
        if (pos) {
          L.circleMarker([pos.latitude!, pos.longitude!], {
            radius: 7,
            color: '#15803d',
            fillColor: '#15803d',
            fillOpacity: 0.9,
          })
            .addTo(map!)
            .bindTooltip(`Dernière position — ${formatDateTime(pos.occurredAt)}`);
        }
      } catch {
        /* tracking optional */
      }

      if (latlngs.length === 1) {
        map.setView(latlngs[0], 12);
      } else {
        map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
      }
    })();

    return () => {
      destroyed = true;
      map?.remove();
    };
  });
</script>

<div
  bind:this={el}
  class={`h-64 w-full rounded-card border border-edge ${hasPoints ? '' : 'hidden'}`}
></div>
