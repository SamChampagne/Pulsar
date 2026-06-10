<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api } from '$lib/api/client';

  let stats = $state<{ label: string; value: number | string; href: string }[]>([]);
  let error = $state('');

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
        { label: 'Shipments', value: shipments.total, href: '/transport-orders' },
        { label: 'Loads', value: loads.total, href: '/transport-orders' },
        { label: 'Carriers', value: carriers.total, href: '/carriers' },
      ];
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load stats';
    }
  }

  $effect(() => {
    void loadStats();
  });
</script>

<div class="page-header">
  <h1>Dashboard</h1>
</div>

{#if error}
  <p class="error-text">{error}</p>
{/if}

<div class="stats-grid">
  {#each stats as stat (stat.label)}
    <a class="card stat" href={stat.href}>
      <div class="stat-value">{stat.value}</div>
      <div class="stat-label">{stat.label}</div>
    </a>
  {/each}
</div>

<div class="card" style="margin-top: 20px;">
  <h2>Workflow</h2>
  <p class="muted">
    Transport Order → Shipment → Load → Route → Dispatch → In Transit → Delivered → Closed
  </p>
  <p class="muted">
    Create a transport order, confirm and plan it to generate a shipment, build a load, assign a
    carrier, then dispatch.
  </p>
</div>

<style>
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
  }

  .stat {
    display: block;
    color: inherit;
  }

  .stat:hover {
    border-color: var(--color-primary);
  }

  .stat-value {
    font-size: 1.8rem;
    font-weight: 700;
  }

  .stat-label {
    color: var(--color-text-muted);
    font-size: 12px;
  }
</style>
