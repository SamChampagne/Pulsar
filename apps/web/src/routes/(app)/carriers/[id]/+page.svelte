<script lang="ts">
  import { page } from '$app/state';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge, Card, PageHeader, ErrorNotice, Skeleton,
    toneFor, labelFor,
  } from '$lib/components/ui';

  interface CarrierDetail {
    id: string;
    code: string;
    name: string;
    scacCode: string | null;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    status: string;
    createdAt: string;
    drivers: { id: string; firstName: string; lastName: string }[];
    vehicles: { id: string; unitNumber: string }[];
    trailers: { id: string; unitNumber: string }[];
  }

  interface LoadRow {
    id: string;
    loadNumber: string;
    status: string;
    createdAt: string;
    carrier: { id: string; code: string; name: string } | null;
    dispatchedAt: string | null;
    completedAt: string | null;
    estimatedCost: number | null;
    currency: string | null;
  }

  const carrierId = $derived(page.params.id);

  let carrier = $state<CarrierDetail | null>(null);
  let loads = $state<LoadRow[]>([]);
  let error = $state('');
  let loadsError = $state('');

  function fmtDate(v: string | null): string {
    return v ? new Date(v).toLocaleDateString() : '—';
  }

  // Derive simple performance stats from fetched loads
  const completedLoads = $derived(loads.filter((l) => l.status === 'COMPLETED'));
  const activeLoads = $derived(
    loads.filter((l) => ['DISPATCHED', 'IN_TRANSIT'].includes(l.status)),
  );

  async function load() {
    error = '';
    loadsError = '';
    try {
      carrier = await api<CarrierDetail>(`/transportation/carriers/${carrierId}`);
    } catch (e) {
      error = e instanceof ApiError ? e.message : `Failed to load carrier — ${String(e)}`;
      return;
    }

    // Loads: no server-side carrierId filter — fetch recent loads and filter by carrier.id
    try {
      const result = await api<Paginated<LoadRow>>('/transportation/loads', {
        query: { pageSize: 100, search: carrier.name },
      });
      // Filter to only loads actually assigned to this carrier
      loads = result.items.filter((l) => l.carrier?.id === carrierId);
    } catch (e) {
      loadsError = e instanceof ApiError ? e.message : `Failed to load loads — ${String(e)}`;
      loads = [];
    }
  }

  $effect(() => {
    if (carrierId) void load();
  });
</script>

{#if error}
  <ErrorNotice message={error} onretry={load} />
{:else if carrier}
  <PageHeader title={carrier.name}>
    {#snippet actions()}
      <Badge tone={toneFor(carrier!.status)}>{labelFor(carrier!.status)}</Badge>
    {/snippet}
  </PageHeader>

  <div class="grid gap-4 lg:grid-cols-3">
    <!-- Left 2/3 -->
    <div class="flex flex-col gap-4 lg:col-span-2">

      <!-- Performance snapshot derived from loads -->
      <Card>
        <h2 class="mb-3 font-semibold text-ink">Performance</h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div class="flex flex-col gap-1">
            <span class="text-xs text-ink-muted uppercase tracking-wide">Total loads</span>
            <span class="text-2xl font-bold text-ink">{loads.length}</span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs text-ink-muted uppercase tracking-wide">Active</span>
            <span class="text-2xl font-bold text-ink">{activeLoads.length}</span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs text-ink-muted uppercase tracking-wide">Completed</span>
            <span class="text-2xl font-bold text-ink">{completedLoads.length}</span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs text-ink-muted uppercase tracking-wide">Drivers</span>
            <span class="text-2xl font-bold text-ink">{carrier.drivers.length}</span>
          </div>
        </div>
        {#if loads.length === 0 && !loadsError}
          <p class="mt-3 text-sm text-ink-muted">No loads data yet for this carrier.</p>
        {/if}
      </Card>

      <!-- Recent loads -->
      <Card>
        <h2 class="mb-3 font-semibold text-ink">Recent Loads</h2>
        {#if loadsError}
          <ErrorNotice message={loadsError} onretry={load} />
        {:else if loads.length === 0}
          <p class="text-sm text-ink-muted">No loads assigned to this carrier yet.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-edge text-xs text-ink-muted uppercase tracking-wide">
                  <th class="pb-2 text-left font-semibold">Load #</th>
                  <th class="pb-2 text-left font-semibold">Status</th>
                  <th class="pb-2 text-left font-semibold">Created</th>
                  <th class="pb-2 text-left font-semibold">Dispatched</th>
                </tr>
              </thead>
              <tbody>
                {#each loads as l (l.id)}
                  <tr class="border-b border-edge last:border-0 hover:bg-canvas/60">
                    <td class="py-2 pr-3">
                      <a href={`/loads/${l.id}`} class="font-mono font-semibold text-accent hover:underline">
                        {l.loadNumber}
                      </a>
                    </td>
                    <td class="py-2 pr-3">
                      <Badge tone={toneFor(l.status)}>{labelFor(l.status)}</Badge>
                    </td>
                    <td class="py-2 pr-3 text-ink-muted">{fmtDate(l.createdAt)}</td>
                    <td class="py-2 text-ink-muted">{fmtDate(l.dispatchedAt)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </Card>
    </div>

    <!-- Right 1/3: Summary -->
    <div class="flex flex-col gap-4">
      <Card>
        <h2 class="mb-3 font-semibold text-ink">Details</h2>
        <dl class="flex flex-col gap-2 text-sm">
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted shrink-0">Code</dt>
            <dd class="font-mono font-semibold">{carrier.code}</dd>
          </div>
          {#if carrier.scacCode}
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">SCAC</dt>
              <dd class="font-mono">{carrier.scacCode}</dd>
            </div>
          {/if}
          {#if carrier.contactName}
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">Contact</dt>
              <dd class="font-medium">{carrier.contactName}</dd>
            </div>
          {/if}
          {#if carrier.phone}
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">Phone</dt>
              <dd class="font-mono">{carrier.phone}</dd>
            </div>
          {/if}
          {#if carrier.email}
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">Email</dt>
              <dd class="font-medium">{carrier.email}</dd>
            </div>
          {/if}
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Vehicles</dt>
            <dd class="font-medium">{carrier.vehicles.length}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Trailers</dt>
            <dd class="font-medium">{carrier.trailers.length}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Since</dt>
            <dd class="font-medium">{fmtDate(carrier.createdAt)}</dd>
          </div>
        </dl>
      </Card>

      {#if carrier.drivers.length > 0}
        <Card>
          <h2 class="mb-3 font-semibold text-ink">Drivers ({carrier.drivers.length})</h2>
          <ul class="flex flex-col gap-1 text-sm">
            {#each carrier.drivers as d (d.id)}
              <li class="text-ink">{d.firstName} {d.lastName}</li>
            {/each}
          </ul>
        </Card>
      {/if}
    </div>
  </div>
{:else}
  <Card padded={false}><div class="p-4"><Skeleton rows={6} /></div></Card>
{/if}
