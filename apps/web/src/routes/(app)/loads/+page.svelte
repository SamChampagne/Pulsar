<script lang="ts">
  import { goto } from '$app/navigation';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Button,
    FilterBar,
    Select,
    Table,
    Badge,
    EmptyState,
    Panel,
    toneFor,
    labelFor,
  } from '$lib/components/ui';

  interface LoadRow {
    id: string;
    loadNumber: string;
    status: string;
    mode: string | null;
    dispatchedAt: string | null;
    carrier: { name: string } | null;
    driver: { firstName: string; lastName: string } | null;
    shipments: { id: string }[];
  }

  let loads = $state<LoadRow[]>([]);
  let total = $state(0);
  let statusFilter = $state('');
  let error = $state('');
  let selected = $state<LoadRow | null>(null);

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

<PageHeader title="Loads" count={total}>
  {#snippet actions()}
    <Button onclick={createLoad}>New load</Button>
  {/snippet}
</PageHeader>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

<FilterBar>
  <div class="w-44">
    <Select bind:value={statusFilter}>
      <option value="">All statuses</option>
      {#each ['OPEN', 'PLANNED', 'DISPATCHED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'] as s (s)}
        <option value={s}>{s.replaceAll('_', ' ')}</option>
      {/each}
    </Select>
  </div>
</FilterBar>

<Table>
  {#snippet head()}
    <th>Load #</th><th>Carrier</th><th>Driver</th><th>Shipments</th>
    <th>Dispatched</th><th>Mode</th><th>Status</th>
  {/snippet}
  {#snippet body()}
    {#each loads as row (row.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <tr class="cursor-pointer" onclick={() => (selected = row)}>
        <td>
          <a href={`/loads/${row.id}`} class="font-semibold text-accent hover:underline"
             onclick={(e) => e.stopPropagation()}>{row.loadNumber}</a>
        </td>
        <td>{row.carrier?.name ?? '—'}</td>
        <td>{row.driver ? `${row.driver.firstName} ${row.driver.lastName}` : '—'}</td>
        <td>{row.shipments.length}</td>
        <td>{row.dispatchedAt ? new Date(row.dispatchedAt).toLocaleString() : '—'}</td>
        <td>{#if row.mode}<span class="rounded border border-edge px-1.5 text-xs text-neutral">{row.mode}</span>{:else}—{/if}</td>
        <td><Badge tone={toneFor(row.status)}>{labelFor(row.status)}</Badge></td>
      </tr>
    {:else}
      <tr><td colspan="7"><EmptyState message="No loads yet." /></td></tr>
    {/each}
  {/snippet}
</Table>

{#if selected}
  {@const sel = selected}
  <Panel open={true} title={sel.loadNumber} href={`/loads/${sel.id}`} onclose={() => (selected = null)}>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Status</div>
      <div class="text-sm text-ink"><Badge tone={toneFor(sel.status)}>{labelFor(sel.status)}</Badge></div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Carrier</div>
      <div class="text-sm text-ink">{sel.carrier?.name ?? 'Unassigned'}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Driver</div>
      <div class="text-sm text-ink">{sel.driver ? `${sel.driver.firstName} ${sel.driver.lastName}` : 'Unassigned'}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Shipments</div>
      <div class="text-sm text-ink">{sel.shipments.length}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Dispatched</div>
      <div class="text-sm text-ink">{sel.dispatchedAt ? new Date(sel.dispatchedAt).toLocaleString() : '—'}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Mode</div>
      <div class="text-sm text-ink">{sel.mode ?? 'All modes'}</div>
    </div>
  </Panel>
{/if}
