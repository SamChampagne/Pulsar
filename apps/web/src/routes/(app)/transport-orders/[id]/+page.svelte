<script lang="ts">
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import TrackingTimeline, { type TimelineEvent } from '$lib/components/TrackingTimeline.svelte';
  import { toast } from '$lib/stores/toast';

  interface OrderDetail {
    id: string;
    orderNumber: string;
    status: string;
    customerReference: string | null;
    requestedPickupDate: string | null;
    requestedDeliveryDate: string | null;
    totalWeightKg: number | null;
    totalVolumeM3: number | null;
    palletCount: number | null;
    notes: string | null;
    createdAt: string;
    customer: { id: string; code: string; name: string };
    originLocation: { id: string; code: string; name: string; city: string };
    destinationLocation: { id: string; code: string; name: string; city: string };
    shipments: { id: string; shipmentNumber: string; status: string; loadId: string | null }[];
  }

  const orderId = $derived(page.params.id);

  let order = $state<OrderDetail | null>(null);
  let events = $state<TimelineEvent[]>([]);
  let error = $state('');

  async function load() {
    try {
      order = await api<OrderDetail>(`/transportation/transport-orders/${orderId}`);
      const lists = await Promise.all(
        order.shipments.map((s) =>
          api<TimelineEvent[]>('/transportation/tracking/events', { query: { shipmentId: s.id } }),
        ),
      );
      events = lists.flat().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load order';
    }
  }

  async function action(name: 'confirm' | 'plan' | 'cancel' | 'close') {
    try {
      await api(`/transportation/transport-orders/${orderId}/${name}`, { method: 'POST' });
      toast.success(`Order ${name === 'plan' ? 'planned' : name + 'ed'}`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : `Failed to ${name}`);
    }
  }

  function fmtDate(value: string | null): string {
    return value ? new Date(value).toLocaleDateString() : '—';
  }

  $effect(() => {
    if (orderId) void load();
  });
</script>

{#if error}
  <p class="error-text">{error}</p>
{:else if order}
  <div class="page-header">
    <div style="display: flex; align-items: center; gap: 12px;">
      <a href="/transport-orders" class="muted">← Orders</a>
      <h1>{order.orderNumber}</h1>
      <StatusBadge status={order.status} />
    </div>
    <div style="display: flex; gap: 8px;">
      {#if order.status === 'DRAFT'}
        <button class="btn" onclick={() => action('confirm')}>Confirm</button>
        <button class="btn btn-danger" onclick={() => action('cancel')}>Cancel</button>
      {:else if order.status === 'CONFIRMED'}
        <button class="btn" onclick={() => action('plan')}>Plan</button>
        <button class="btn btn-danger" onclick={() => action('cancel')}>Cancel</button>
      {:else if order.status === 'COMPLETED'}
        <button class="btn" onclick={() => action('close')}>Close</button>
      {/if}
    </div>
  </div>

  <div class="detail-grid">
    <div class="card">
      <h2 style="margin-top: 0;">Order</h2>
      <dl>
        <dt>Customer</dt>
        <dd>{order.customer.name} <span class="muted">({order.customer.code})</span></dd>
        <dt>Customer reference</dt>
        <dd>{order.customerReference ?? '—'}</dd>
        <dt>Origin</dt>
        <dd>{order.originLocation.name}, {order.originLocation.city}</dd>
        <dt>Destination</dt>
        <dd>{order.destinationLocation.name}, {order.destinationLocation.city}</dd>
        <dt>Requested pickup</dt>
        <dd>{fmtDate(order.requestedPickupDate)}</dd>
        <dt>Requested delivery</dt>
        <dd>{fmtDate(order.requestedDeliveryDate)}</dd>
        <dt>Weight / Volume / Pallets</dt>
        <dd>
          {order.totalWeightKg ?? '—'} kg / {order.totalVolumeM3 ?? '—'} m³ /
          {order.palletCount ?? '—'}
        </dd>
        {#if order.notes}
          <dt>Notes</dt>
          <dd>{order.notes}</dd>
        {/if}
      </dl>
    </div>

    <div class="card">
      <h2 style="margin-top: 0;">Shipments</h2>
      {#if order.shipments.length === 0}
        <p class="muted">No shipments yet — confirm then plan the order.</p>
      {:else}
        <table>
          <thead>
            <tr><th>Shipment #</th><th>Status</th><th>Load</th></tr>
          </thead>
          <tbody>
            {#each order.shipments as shipment (shipment.id)}
              <tr>
                <td><strong>{shipment.shipmentNumber}</strong></td>
                <td><StatusBadge status={shipment.status} /></td>
                <td>
                  {#if shipment.loadId}
                    <a href={`/loads/${shipment.loadId}`}>View load</a>
                  {:else}
                    <a href="/shipments">Assign via Shipments</a>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

      <h2>Tracking</h2>
      <TrackingTimeline {events} />
    </div>
  </div>
{:else}
  <p class="muted">Loading…</p>
{/if}

<style>
  .detail-grid {
    display: grid;
    grid-template-columns: 1fr 1.2fr;
    gap: 16px;
    align-items: start;
  }

  dl {
    display: grid;
    grid-template-columns: 160px 1fr;
    row-gap: 8px;
    margin: 0;
  }

  dt {
    color: var(--color-text-muted);
    font-size: 12px;
  }

  dd {
    margin: 0;
    font-size: 13px;
  }
</style>
