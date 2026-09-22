<script lang="ts">
  import { Badge, Button, Card, Field } from '$lib/components/ui';
  import { toneFor, labelFor } from '$lib/components/ui';
  import LoadMap from '$lib/components/LoadMap.svelte';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDateTime } from '$lib/format';
  import type { RouteDetail, EditStop, LoadDetail } from './types';

  interface Props {
    loadId: string;
    detail: LoadDetail;
    route: RouteDetail | null;
    editable: boolean;
    executing: boolean;
    onReload: () => Promise<void>;
  }

  const { loadId, detail, route, editable, executing, onReload }: Props = $props();

  let editingRoute = $state(false);
  let editStops = $state<EditStop[]>([]);
  let editDistance = $state('');
  let editDuration = $state('');

  // Derive map stops from route for LoadMap
  const mapStops = $derived(
    route?.stops.map((s) => ({ sequence: s.sequence, locationId: s.locationId, type: s.type })) ??
      [],
  );

  function toLocalInput(value: string | null): string {
    if (!value) return '';
    const d = new Date(value);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function startEditRoute() {
    if (!route) return;
    editStops = route.stops.map((s) => ({
      type: s.type,
      locationId: s.locationId,
      shipmentId: s.shipmentId,
      plannedArrivalEarly: toLocalInput(s.plannedArrivalEarly),
      plannedArrivalLate: toLocalInput(s.plannedArrivalLate),
      label: `${s.location.name}, ${s.location.city}`,
    }));
    editDistance = route.totalDistanceKm === null ? '' : String(route.totalDistanceKm);
    editDuration = route.estimatedDurationMin === null ? '' : String(route.estimatedDurationMin);
    editingRoute = true;
  }

  function moveStop(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= editStops.length) return;
    const next = [...editStops];
    [next[index], next[target]] = [next[target], next[index]];
    editStops = next;
  }

  async function saveRoute() {
    try {
      await api('/transportation/routes', {
        method: 'POST',
        body: {
          loadId,
          totalDistanceKm: editDistance === '' ? undefined : Number(editDistance),
          estimatedDurationMin: editDuration === '' ? undefined : Number(editDuration),
          stops: editStops.map((s, index) => ({
            sequence: index + 1,
            type: s.type,
            locationId: s.locationId,
            shipmentId: s.shipmentId ?? undefined,
            plannedArrivalEarly: s.plannedArrivalEarly
              ? new Date(s.plannedArrivalEarly).toISOString()
              : undefined,
            plannedArrivalLate: s.plannedArrivalLate
              ? new Date(s.plannedArrivalLate).toISOString()
              : undefined,
          })),
        },
      });
      toast.success('Route updated');
      editingRoute = false;
      await onReload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save route');
    }
  }

  async function generateRoute() {
    const stops = [
      ...detail.shipments.map((s, i) => ({
        sequence: i + 1,
        type: 'PICKUP',
        locationId: s.originLocationId,
        shipmentId: s.id,
      })),
      ...detail.shipments.map((s, i) => ({
        sequence: detail.shipments.length + i + 1,
        type: 'DELIVERY',
        locationId: s.destinationLocationId,
        shipmentId: s.id,
      })),
    ];
    try {
      await api('/transportation/routes', { method: 'POST', body: { loadId, stops } });
      toast.success('Route generated');
      await onReload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to generate route');
    }
  }

  async function stopAction(stopId: string, status: 'ARRIVED' | 'DEPARTED') {
    try {
      await api(`/transportation/routes/stops/${stopId}/status`, {
        method: 'POST',
        body: { status },
      });
      await onReload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update stop');
    }
  }
</script>

<Card>
  <div class="mb-3 flex items-center justify-between">
    <h2 class="font-semibold text-ink">Route</h2>
    {#if route && editable && !editingRoute}
      <Button variant="secondary" onclick={startEditRoute}>Edit route</Button>
    {/if}
  </div>

  {#if editingRoute}
    <div class="mb-3 grid grid-cols-2 gap-3">
      <Field label="Distance (km)">
        <input
          id="distance"
          type="number"
          step="any"
          min="0"
          bind:value={editDistance}
          class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
        />
      </Field>
      <Field label="Duration (min)">
        <input
          id="duration"
          type="number"
          step="any"
          min="0"
          bind:value={editDuration}
          class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
        />
      </Field>
    </div>
    <div class="flex flex-col gap-2">
      {#each editStops as stop, index (index)}
        <div
          class="grid grid-cols-[90px_1fr_auto_80px] items-center gap-2 border-b border-edge py-2 text-sm"
        >
          <span class="text-ink-muted">#{index + 1} {stop.type}</span>
          <span>{stop.label}</span>
          <div class="flex flex-wrap items-center gap-1">
            <span class="text-xs text-ink-muted whitespace-nowrap">Arrival from</span>
            <input
              type="datetime-local"
              bind:value={stop.plannedArrivalEarly}
              class="rounded border border-edge bg-surface px-1.5 py-0.5 text-xs text-ink"
            />
            <span class="text-xs text-ink-muted">to</span>
            <input
              type="datetime-local"
              bind:value={stop.plannedArrivalLate}
              class="rounded border border-edge bg-surface px-1.5 py-0.5 text-xs text-ink"
            />
          </div>
          <span class="flex gap-1">
            <Button variant="secondary" onclick={() => moveStop(index, -1)}>↑</Button>
            <Button variant="secondary" onclick={() => moveStop(index, 1)}>↓</Button>
          </span>
        </div>
      {/each}
    </div>
    <div class="mt-3 flex gap-2">
      <Button variant="primary" onclick={saveRoute}>Save route</Button>
      <Button
        variant="secondary"
        onclick={() => {
          editingRoute = false;
        }}>Cancel</Button
      >
    </div>
  {:else if route}
    {#if route.totalDistanceKm != null || route.estimatedDurationMin != null}
      <div class="mb-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        {#if route.totalDistanceKm != null}
          <span>{route.totalDistanceKm} km</span>
        {/if}
        {#if route.estimatedDurationMin != null}
          <span>{route.estimatedDurationMin} min</span>
        {/if}
        {#if route.distanceSource === 'HAVERSINE'}
          <Badge tone="warn">estimate — straight-line</Badge>
        {:else if route.distanceSource === 'OSRM'}
          <Badge tone="neutral">OSRM</Badge>
        {/if}
      </div>
    {/if}
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-edge text-xs text-ink-muted uppercase tracking-wide">
            <th class="pb-2 text-left font-semibold">#</th>
            <th class="pb-2 text-left font-semibold">Type</th>
            <th class="pb-2 text-left font-semibold">Location</th>
            <th class="pb-2 text-left font-semibold">Arrival window</th>
            <th class="pb-2 text-left font-semibold">Status</th>
            <th class="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {#each route.stops as stop (stop.id)}
            <tr class="border-b border-edge last:border-0">
              <td class="py-2 pr-2">{stop.sequence}</td>
              <td class="py-2 pr-2">{stop.type}</td>
              <td class="py-2 pr-2">{stop.location.name}, {stop.location.city}</td>
              <td class="py-2 pr-2 text-xs text-ink-muted">
                {#if stop.plannedArrivalEarly}
                  {formatDateTime(stop.plannedArrivalEarly)}{stop.plannedArrivalLate
                    ? ' → ' + formatDateTime(stop.plannedArrivalLate)
                    : ''}
                {:else}
                  —
                {/if}
              </td>
              <td class="py-2 pr-2">
                <Badge tone={toneFor(stop.status)}>{labelFor(stop.status)}</Badge>
              </td>
              <td class="py-2 text-right whitespace-nowrap">
                {#if executing && stop.status === 'PENDING'}
                  <Button variant="primary" onclick={() => stopAction(stop.id, 'ARRIVED')}
                    >Arrive</Button
                  >
                {:else if executing && stop.status === 'ARRIVED'}
                  <Button variant="primary" onclick={() => stopAction(stop.id, 'DEPARTED')}
                    >Depart</Button
                  >
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <!-- Map below route table -->
    {#if mapStops.length > 0}
      <div class="mt-3">
        {#key JSON.stringify([mapStops, route?.geometry])}
          <LoadMap stops={mapStops} {loadId} geometry={route?.geometry ?? null} />
        {/key}
      </div>
    {/if}
  {:else if editable && detail.shipments.length > 0}
    <p class="text-sm text-ink-muted">No route yet.</p>
    <div class="mt-2">
      <Button variant="secondary" onclick={generateRoute}>Generate route from shipments</Button>
    </div>
  {:else}
    <p class="text-sm text-ink-muted">No route. Add shipments first.</p>
  {/if}
</Card>
