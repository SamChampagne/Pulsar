<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { PageHeader, Card, Skeleton, EmptyState } from '$lib/components/ui';
  import OpsMap from '$lib/components/OpsMap.svelte';

  let stats = $state<{ label: string; value: number | string; href: string }[]>([]);
  let error = $state('');
  let loading = $state(true);

  async function loadStats() {
    try {
      const [orders, shipments, loads, carriers] = await Promise.all([
        api<Paginated<unknown>>('/transportation/transport-orders', { query: { pageSize: 1 } }),
        api<Paginated<unknown>>('/transportation/shipments', { query: { pageSize: 1 } }),
        api<Paginated<unknown>>('/transportation/loads', { query: { pageSize: 1 } }),
        api<Paginated<unknown>>('/transportation/carriers', { query: { pageSize: 1 } }),
      ]);
      stats = [
        { label: 'Transport Orders', value: orders.total, href: '/transport-orders' },
        { label: 'Shipments', value: shipments.total, href: '/shipments' },
        { label: 'Loads', value: loads.total, href: '/loads' },
        { label: 'Carriers', value: carriers.total, href: '/carriers' },
      ];
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load stats';
    } finally {
      loading = false;
    }
  }

  interface MapLoad {
    id: string;
    loadNumber: string;
    status: string;
    carrier: string | null;
    isLate: boolean;
    lastPosition: { latitude: number; longitude: number; occurredAt: string } | null;
    stops: {
      sequence: number; type: string; status: string; name: string; city: string;
      latitude: number | null; longitude: number | null;
    }[];
  }

  let mapLoads = $state<MapLoad[]>([]);
  let mapLoaded = $state(false);

  async function loadMap() {
    try {
      mapLoads = await api<MapLoad[]>('/transportation/loads/active-map');
    } catch {
      // map is an enhancement — stats above already surface API errors
    } finally {
      mapLoaded = true;
    }
  }

  $effect(() => {
    void loadStats();
  });

  $effect(() => {
    void loadMap();
    // 45s poll, visible tab only (spec §C)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadMap();
    }, 45_000);
    return () => clearInterval(timer);
  });
</script>

<PageHeader title="Dashboard" />

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if loading}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {#each { length: 4 } as _, i (i)}
      <Card><Skeleton rows={2} /></Card>
    {/each}
  </div>
{:else}
<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
  {#each stats as stat (stat.label)}
    <a
      href={stat.href}
      class="block rounded-card border border-edge bg-surface p-4 transition-colors hover:border-accent"
    >
      <div class="text-2xl font-bold text-ink">{stat.value}</div>
      <div class="text-xs uppercase tracking-wide text-ink-muted mt-1">{stat.label}</div>
    </a>
  {/each}
</div>
{/if}

<div class="mt-4">
  <Card>
    <div class="mb-2 flex items-center justify-between">
      <h2 class="text-sm font-bold text-ink">Live operations</h2>
      {#if mapLoads.some((l) => l.isLate)}
        <span class="text-xs font-semibold text-danger">
          {mapLoads.filter((l) => l.isLate).length} late
        </span>
      {/if}
    </div>
    {#if !mapLoaded}
      <Skeleton rows={4} />
    {:else if mapLoads.length === 0}
      <EmptyState message="No active loads — dispatched and in-transit loads appear here." />
    {:else}
      <OpsMap loads={mapLoads} />
    {/if}
  </Card>
</div>

<div class="mt-4">
  <Card>
    <h2 class="text-sm font-bold text-ink mb-2">Workflow</h2>
    <p class="text-sm text-ink-muted">
      Transport Order → Shipment → Load → Route → Dispatch → In Transit → Delivered → Closed
    </p>
    <p class="text-sm text-ink-muted mt-2">
      Create a transport order, confirm and plan it to generate a shipment, build a load, assign a
      carrier, then dispatch.
    </p>
  </Card>
</div>
