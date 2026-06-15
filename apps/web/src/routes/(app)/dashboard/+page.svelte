<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { PageHeader, Card, Skeleton, EmptyState, Badge } from '$lib/components/ui';
  import OpsMap from '$lib/components/OpsMap.svelte';

  interface Metric {
    label: string;
    value: number | string;
    href: string;
  }
  let metrics = $state<Metric[]>([]);
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
      metrics = [
        { label: 'Ordres de transport', value: orders.total, href: '/transport-orders' },
        { label: 'Shipments', value: shipments.total, href: '/shipments' },
        { label: 'Loads', value: loads.total, href: '/loads' },
        { label: 'Transporteurs', value: carriers.total, href: '/carriers' },
      ];
    } catch (e) {
      error = e instanceof Error ? e.message : 'Échec du chargement';
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

  const lateLoads = $derived(mapLoads.filter((l) => l.isLate));
  const activeCount = $derived(mapLoads.length);

  async function loadMap() {
    try {
      mapLoads = await api<MapLoad[]>('/transportation/loads/active-map');
    } catch {
      // map is an enhancement — stats above already surface API errors
    } finally {
      mapLoaded = true;
    }
  }

  const shortcuts = [
    { label: 'Dispatch', href: '/dispatch', hint: 'Planifier & tender' },
    { label: 'Plan de cour', href: '/yard', hint: 'Gate & quais' },
    { label: 'Entrepôt', href: '/wms', hint: 'Stock & flux' },
    { label: 'Workbench', href: '/workbench', hint: 'Tâches' },
    { label: 'Actions agents', href: '/agent-actions', hint: 'À approuver' },
  ];

  $effect(() => {
    void loadStats();
  });

  $effect(() => {
    void loadMap();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadMap();
    }, 45_000);
    return () => clearInterval(timer);
  });
</script>

<PageHeader title="Centre des opérations" />

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

<!-- KPI strip -->
{#if loading}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
    {#each { length: 5 } as _, i (i)}<Card><Skeleton rows={2} /></Card>{/each}
  </div>
{:else}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
    {#each metrics as m (m.label)}
      <a
        href={m.href}
        class="group rounded-card border border-edge-soft bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-accent hover:shadow-card"
      >
        <div class="font-mono text-3xl font-bold text-ink">{m.value}</div>
        <div class="mt-1 text-xs tracking-wide text-ink-muted uppercase">{m.label}</div>
      </a>
    {/each}
    <!-- live attention tile -->
    <a
      href="/loads"
      class="rounded-card border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card {lateLoads.length
        ? 'border-danger/30 bg-danger-soft'
        : 'border-edge-soft bg-surface'}"
    >
      <div class="font-mono text-3xl font-bold {lateLoads.length ? 'text-danger' : 'text-ink'}">
        {lateLoads.length}
      </div>
      <div class="mt-1 text-xs tracking-wide text-ink-muted uppercase">Loads en retard</div>
    </a>
  </div>
{/if}

<div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
  <!-- live map -->
  <Card padded={false}>
    <div class="flex items-center justify-between px-4 pt-3 pb-2">
      <h2 class="text-sm font-bold text-ink">Opérations en direct</h2>
      <span class="font-mono text-xs text-ink-muted">{activeCount} actifs</span>
    </div>
    {#if !mapLoaded}
      <div class="px-4 pb-4"><Skeleton rows={6} /></div>
    {:else if mapLoads.length === 0}
      <div class="px-4 pb-4">
        <EmptyState message="Aucun load actif — les loads dispatchés et en transit apparaissent ici." />
      </div>
    {:else}
      <OpsMap loads={mapLoads} />
    {/if}
  </Card>

  <!-- attention lane -->
  <div class="flex flex-col gap-4">
    <Card padded={false}>
      <h2 class="border-b border-edge-soft px-4 py-3 text-sm font-bold text-ink">À surveiller</h2>
      <div class="max-h-72 overflow-y-auto">
        {#if !mapLoaded}
          <div class="p-4"><Skeleton rows={3} /></div>
        {:else if lateLoads.length === 0}
          <p class="px-4 py-6 text-center text-sm text-ink-muted">Rien en retard. Tout roule.</p>
        {:else}
          {#each lateLoads as l (l.id)}
            <a
              href="/loads/{l.id}"
              class="flex items-center justify-between gap-2 border-b border-edge-soft px-4 py-2.5 transition-colors last:border-0 hover:bg-surface-muted"
            >
              <div class="min-w-0">
                <div class="font-mono text-sm font-semibold text-ink">{l.loadNumber}</div>
                <div class="truncate text-xs text-ink-muted">{l.carrier ?? 'Sans transporteur'}</div>
              </div>
              <Badge tone="danger">Retard</Badge>
            </a>
          {/each}
        {/if}
      </div>
    </Card>

    <Card padded={false}>
      <h2 class="border-b border-edge-soft px-4 py-3 text-sm font-bold text-ink">Raccourcis</h2>
      <div class="p-2">
        {#each shortcuts as s (s.href)}
          <a
            href={s.href}
            class="flex items-center justify-between rounded-inner px-2 py-2 transition-colors hover:bg-surface-muted"
          >
            <span class="text-sm font-medium text-ink">{s.label}</span>
            <span class="text-xs text-ink-faint">{s.hint}</span>
          </a>
        {/each}
      </div>
    </Card>
  </div>
</div>
