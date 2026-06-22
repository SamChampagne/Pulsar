<script lang="ts">
  import { page } from '$app/state';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge, Card, PageHeader, ErrorNotice,
    toneFor, labelFor,
  } from '$lib/components/ui';

  interface CustomerDetail {
    id: string;
    code: string;
    name: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    isActive: boolean;
    createdAt: string;
    locations: { id: string; code: string; name: string; city: string }[];
  }

  interface OrderRow {
    id: string;
    orderNumber: string;
    status: string;
    createdAt: string;
    customer: { id: string; code: string; name: string };
    originLocation: { id: string; code: string; name: string; city: string };
    destinationLocation: { id: string; code: string; name: string; city: string };
    shipments: { id: string }[];
  }

  const customerId = $derived(page.params.id);

  let customer = $state<CustomerDetail | null>(null);
  let orders = $state<OrderRow[]>([]);
  let error = $state('');
  let ordersError = $state('');

  function fmtDate(v: string | null): string {
    return v ? new Date(v).toLocaleDateString() : '—';
  }

  async function load() {
    error = '';
    ordersError = '';
    try {
      customer = await api<CustomerDetail>(`/transportation/customers/${customerId}`);
    } catch (e) {
      error = e instanceof ApiError ? e.message : `Failed to load customer — ${String(e)}`;
      return;
    }

    // Transport orders: search by customer name (no server-side customerId filter),
    // then keep only orders belonging to this customer.
    try {
      const result = await api<Paginated<OrderRow>>('/transportation/transport-orders', {
        query: { pageSize: 100, search: customer.name },
      });
      orders = result.items.filter((o) => o.customer.id === customerId);
    } catch (e) {
      ordersError =
        e instanceof ApiError ? e.message : `Failed to load orders — ${String(e)}`;
      orders = [];
    }
  }

  $effect(() => {
    if (customerId) void load();
  });
</script>

{#if error}
  <ErrorNotice message={error} onretry={load} />
{:else if customer}
  <PageHeader title={customer.name}>
    {#snippet actions()}
      <Badge tone={customer!.isActive ? 'ok' : 'danger'}>
        {customer!.isActive ? 'Active' : 'Inactive'}
      </Badge>
    {/snippet}
  </PageHeader>

  <div class="grid gap-4 lg:grid-cols-3">
    <!-- Left 2/3 -->
    <div class="flex flex-col gap-4 lg:col-span-2">

      <!-- Recent transport orders -->
      <Card>
        <h2 class="mb-3 font-semibold text-ink">Transport Orders</h2>
        {#if ordersError}
          <ErrorNotice message={ordersError} onretry={load} />
        {:else if orders.length === 0}
          <p class="text-sm text-ink-muted">No transport orders found for this customer.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-edge text-xs text-ink-muted uppercase tracking-wide">
                  <th class="pb-2 text-left font-semibold">Order #</th>
                  <th class="pb-2 text-left font-semibold">Status</th>
                  <th class="pb-2 text-left font-semibold">Origin</th>
                  <th class="pb-2 text-left font-semibold">Destination</th>
                  <th class="pb-2 text-left font-semibold">Shipments</th>
                  <th class="pb-2 text-left font-semibold">Created</th>
                </tr>
              </thead>
              <tbody>
                {#each orders as o (o.id)}
                  <tr class="border-b border-edge last:border-0 hover:bg-canvas/60">
                    <td class="py-2 pr-3">
                      <a
                        href={`/transport-orders/${o.id}`}
                        class="font-mono font-semibold text-accent hover:underline"
                      >
                        {o.orderNumber}
                      </a>
                    </td>
                    <td class="py-2 pr-3">
                      <Badge tone={toneFor(o.status)}>{labelFor(o.status)}</Badge>
                    </td>
                    <td class="py-2 pr-3 text-ink-muted">
                      {o.originLocation.city}
                    </td>
                    <td class="py-2 pr-3 text-ink-muted">
                      {o.destinationLocation.city}
                    </td>
                    <td class="py-2 pr-3 text-ink-muted">{o.shipments.length}</td>
                    <td class="py-2 text-ink-muted">{fmtDate(o.createdAt)}</td>
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
            <dd class="font-mono font-semibold">{customer.code}</dd>
          </div>
          {#if customer.contactName}
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">Contact</dt>
              <dd class="font-medium">{customer.contactName}</dd>
            </div>
          {/if}
          {#if customer.email}
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">Email</dt>
              <dd class="font-medium">{customer.email}</dd>
            </div>
          {/if}
          {#if customer.phone}
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">Phone</dt>
              <dd class="font-mono">{customer.phone}</dd>
            </div>
          {/if}
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Locations</dt>
            <dd class="font-medium">{customer.locations.length}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Orders</dt>
            <dd class="font-medium">{orders.length}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Since</dt>
            <dd class="font-medium">{fmtDate(customer.createdAt)}</dd>
          </div>
        </dl>
      </Card>

      {#if customer.locations.length > 0}
        <Card>
          <h2 class="mb-3 font-semibold text-ink">Locations ({customer.locations.length})</h2>
          <ul class="flex flex-col gap-1 text-sm">
            {#each customer.locations as loc (loc.id)}
              <li class="flex items-center justify-between gap-2">
                <span class="font-mono text-xs text-ink-muted">{loc.code}</span>
                <span class="text-ink">{loc.name}, {loc.city}</span>
              </li>
            {/each}
          </ul>
        </Card>
      {/if}
    </div>
  </div>
{:else}
  <p class="text-sm text-ink-muted">Loading…</p>
{/if}
