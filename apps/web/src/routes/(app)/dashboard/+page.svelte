<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { PageHeader, Card, Skeleton, EmptyState, Button, ErrorNotice } from '$lib/components/ui';
  import OpsMap from '$lib/components/OpsMap.svelte';

  interface CountStat { total: number }

  let stats = $state<{ label: string; value: number | string; href: string; hint: string }[]>([]);
  let error = $state('');
  let loading = $state(true);

  async function loadStats() {
    loading = true;
    error = '';
    try {
      const [orders, shipments, loads, carriers, agentActions, workbench] = await Promise.all([
        api<Paginated<unknown>>('/transportation/transport-orders', { query: { pageSize: 1 } }),
        api<Paginated<unknown>>('/transportation/shipments', { query: { pageSize: 1, status: 'PENDING' } }),
        api<Paginated<unknown>>('/transportation/loads', { query: { pageSize: 1, status: 'OPEN' } }),
        api<Paginated<unknown>>('/transportation/carriers', { query: { pageSize: 1 } }),
        api<unknown[]>('/agent-actions').catch(() => []),
        api<Paginated<unknown> | CountStat>('/operating-tasks', { query: { pageSize: 1, status: 'OPEN' } }).catch(() => ({ total: 0 })),
      ]);
      stats = [
        { label: 'Orders in system', value: orders.total, href: '/transport-orders', hint: 'Demand entering the workflow' },
        { label: 'Unplanned shipments', value: shipments.total, href: '/shipments', hint: 'Freight waiting for Dispatch' },
        { label: 'Open loads', value: loads.total, href: '/loads', hint: 'Loads ready to tender or dispatch' },
        { label: 'Agent approvals', value: agentActions.length, href: '/agent-actions', hint: 'Human decisions waiting' },
        { label: 'Open exceptions', value: workbench.total, href: '/workbench', hint: 'Operational tasks to triage' },
        { label: 'Carrier network', value: carriers.total, href: '/carriers', hint: 'Partners available for tender' },
      ];
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load dashboard';
      stats = [
        { label: 'Unplanned shipments', value: '—', href: '/shipments', hint: 'Plan freight into loads' },
        { label: 'Open loads', value: '—', href: '/loads', hint: 'Tender or dispatch loads' },
        { label: 'Agent approvals', value: '—', href: '/agent-actions', hint: 'Review governed changes' },
        { label: 'Open exceptions', value: '—', href: '/workbench', hint: 'Triage operating work' },
      ];
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
      // map is an enhancement — dashboard signals and error notice carry the main state
    } finally {
      mapLoaded = true;
    }
  }

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

<PageHeader
  title="Today’s operating desk"
  eyebrow="Dashboard"
  subtitle="See what needs attention now: unplanned freight, open loads, exceptions, and governed agent actions."
>
  {#snippet actions()}
    <Button variant="secondary" href="/workbench">Open workbench</Button>
    <Button href="/dispatch">Plan dispatch</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={loadStats} />

{#if loading}
  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
    {#each { length: 6 } as _, i (i)}
      <Card><Skeleton rows={2} /></Card>
    {/each}
  </div>
{:else}
  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
    {#each stats as stat (stat.label)}
      <a href={stat.href} class="block rounded-card border border-edge bg-surface p-4 transition-colors hover:border-accent">
        <div class="text-2xl font-bold text-ink">{stat.value}</div>
        <div class="mt-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{stat.label}</div>
        <div class="mt-2 text-xs text-ink-faint">{stat.hint}</div>
      </a>
    {/each}
  </div>
{/if}

<div class="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
  <Card>
    <div class="mb-3 flex items-center justify-between">
      <div>
        <h2 class="text-sm font-bold text-ink">Live operations</h2>
        <p class="text-xs text-ink-muted">Active dispatched and in-transit loads appear here.</p>
      </div>
      {#if mapLoads.some((l) => l.isLate)}
        <span class="text-xs font-semibold text-danger">{mapLoads.filter((l) => l.isLate).length} late</span>
      {/if}
    </div>
    {#if !mapLoaded}
      <Skeleton rows={4} />
    {:else if mapLoads.length === 0}
      <EmptyState title="No active loads" message="Dispatched and in-transit loads will appear here. Start in Dispatch when shipments are ready to consolidate.">
        {#snippet children()}
          <Button variant="secondary" href="/dispatch">Open Dispatch</Button>
        {/snippet}
      </EmptyState>
    {:else}
      <OpsMap loads={mapLoads} />
    {/if}
  </Card>

  <Card>
    <h2 class="text-sm font-bold text-ink">Next best actions</h2>
    <div class="mt-3 space-y-3 text-sm">
      <a href="/shipments" class="block rounded-md border border-edge p-3 hover:border-accent">
        <div class="font-semibold text-ink">Plan unassigned shipments</div>
        <div class="text-xs text-ink-muted">Move confirmed freight into loads from Dispatch.</div>
      </a>
      <a href="/agent-actions" class="block rounded-md border border-edge p-3 hover:border-accent">
        <div class="font-semibold text-ink">Review governed agent changes</div>
        <div class="text-xs text-ink-muted">Approve or reject sensitive mutations with evidence.</div>
      </a>
      <a href="/workbench" class="block rounded-md border border-edge p-3 hover:border-accent">
        <div class="font-semibold text-ink">Triage operating exceptions</div>
        <div class="text-xs text-ink-muted">Resolve overdue, approval, review, and notification tasks.</div>
      </a>
    </div>
  </Card>
</div>

<div class="mt-4">
  <Card>
    <h2 class="mb-2 text-sm font-bold text-ink">Workflow</h2>
    <p class="text-sm text-ink-muted">Transport Order → Shipment → Load → Route → Dispatch → In Transit → Delivered → Closed</p>
    <p class="mt-2 text-sm text-ink-muted">Create demand as a transport order, confirm it into shipments, consolidate those shipments into loads, then tender and dispatch.</p>
  </Card>
</div>
