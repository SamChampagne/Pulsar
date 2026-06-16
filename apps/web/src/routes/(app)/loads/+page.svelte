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
    Card,
    Skeleton,
    ErrorNotice,
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
  let loading = $state(true);

  async function load() {
    try {
      const result = await api<Paginated<LoadRow>>('/transportation/loads', {
        query: { pageSize: 50, status: statusFilter || undefined },
      });
      loads = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load loads';
    } finally {
      loading = false;
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

  const openCount = $derived(loads.filter((l) => l.status === 'OPEN').length);
  const plannedCount = $derived(loads.filter((l) => l.status === 'PLANNED').length);
  const movingCount = $derived(loads.filter((l) => ['DISPATCHED', 'IN_TRANSIT'].includes(l.status)).length);

  $effect(() => {
    statusFilter;
    void load();
  });
</script>

<PageHeader
  title="Loads"
  subtitle="Consolidate shipments, tender carriers, and track execution through delivery."
  count={total}
>
  {#snippet actions()}
    <Button onclick={createLoad}>New load</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

<div class="mb-4 grid gap-3 sm:grid-cols-3">
  <Card><div class="text-xl font-bold text-ink">{plannedCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Planned</div><p class="mt-1 text-xs text-ink-faint">Built but not open for tender yet.</p></Card>
  <Card><div class="text-xl font-bold text-ink">{openCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Open</div><p class="mt-1 text-xs text-ink-faint">Ready for carrier assignment/tender.</p></Card>
  <Card><div class="text-xl font-bold text-ink">{movingCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Moving</div><p class="mt-1 text-xs text-ink-faint">Dispatched or in transit.</p></Card>
</div>

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

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else}
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
      <tr><td colspan="7"><EmptyState title="No loads yet" message="Build loads from shipments in Dispatch, then tender carriers and track execution.">
        {#snippet children()}<Button variant="secondary" href="/dispatch">Build in Dispatch</Button><Button onclick={createLoad}>Create empty load</Button>{/snippet}
      </EmptyState></td></tr>
    {/each}
  {/snippet}
</Table>
{/if}

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
