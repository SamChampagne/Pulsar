<script lang="ts">
  import { goto } from '$app/navigation';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import { toast } from '$lib/stores/toast';

  interface LoadRow {
    id: string;
    loadNumber: string;
    status: string;
    dispatchedAt: string | null;
    carrier: { name: string } | null;
    driver: { firstName: string; lastName: string } | null;
    shipments: { id: string }[];
  }

  let loads = $state<LoadRow[]>([]);
  let total = $state(0);
  let statusFilter = $state('');
  let error = $state('');

  async function load() {
    try {
      const result = await api<Paginated<LoadRow>>('/transportation/loads', {
        query: { pageSize: 50, status: statusFilter || undefined },
      });
      loads = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load loads';
    }
  }

  async function createLoad() {
    try {
      const created = await api<LoadRow>('/transportation/loads', { method: 'POST', body: {} });
      toast.success(`${created.loadNumber} created`);
      await goto(`/loads/${created.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create load');
    }
  }

  $effect(() => {
    statusFilter;
    void load();
  });
</script>

<div class="page-header">
  <h1>Loads <span class="muted">({total})</span></h1>
  <div style="display: flex; gap: 8px;">
    <select bind:value={statusFilter} style="width: 180px;">
      <option value="">All statuses</option>
      {#each ['OPEN', 'PLANNED', 'DISPATCHED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'] as s (s)}
        <option value={s}>{s.replaceAll('_', ' ')}</option>
      {/each}
    </select>
    <button class="btn" onclick={createLoad}>New load</button>
  </div>
</div>

{#if error}
  <p class="error-text">{error}</p>
{/if}

<div class="card" style="padding: 0;">
  <table>
    <thead>
      <tr>
        <th>Load #</th>
        <th>Carrier</th>
        <th>Driver</th>
        <th>Shipments</th>
        <th>Dispatched</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      {#each loads as row (row.id)}
        <tr>
          <td><a href={`/loads/${row.id}`}><strong>{row.loadNumber}</strong></a></td>
          <td>{row.carrier?.name ?? '—'}</td>
          <td>{row.driver ? `${row.driver.firstName} ${row.driver.lastName}` : '—'}</td>
          <td>{row.shipments.length}</td>
          <td>{row.dispatchedAt ? new Date(row.dispatchedAt).toLocaleString() : '—'}</td>
          <td><StatusBadge status={row.status} /></td>
        </tr>
      {:else}
        <tr><td colspan="6" class="muted">No loads yet.</td></tr>
      {/each}
    </tbody>
  </table>
</div>
