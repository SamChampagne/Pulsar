<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { PageHeader, Card, Skeleton } from '$lib/components/ui';

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

  $effect(() => {
    void loadStats();
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
