<script lang="ts">
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import StatusBadge from '$lib/components/StatusBadge.svelte';

  interface PortalView {
    shipper: string;
    customer: string;
    orders: {
      orderNumber: string;
      customerReference: string | null;
      status: string;
      requestedPickupDate: string | null;
      requestedDeliveryDate: string | null;
      originLocation: { city: string; state: string | null };
      destinationLocation: { city: string; state: string | null };
      shipments: {
        shipmentNumber: string;
        status: string;
        actualDeliveryAt: string | null;
        trackingUrl: string | null;
      }[];
    }[];
  }

  const token = $derived(page.params.token);

  let view = $state<PortalView | null>(null);
  let error = $state('');

  function fmt(value: string | null): string {
    return value ? new Date(value).toLocaleDateString() : '—';
  }

  $effect(() => {
    if (!token) return;
    api<PortalView>(`/public/portal/${token}`)
      .then((v) => (view = v))
      .catch((e) => (error = e instanceof ApiError ? e.message : 'This link is invalid'));
  });
</script>

<div class="public-page">
  <div class="card public-card">
    {#if error}
      <p class="error-text">{error}</p>
    {:else if view}
      <p class="muted" style="margin-top: 0;">Customer portal · {view.shipper}</p>
      <h1>{view.customer}</h1>

      {#each view.orders as order (order.orderNumber)}
        <div class="order">
          <div class="order-head">
            <strong>{order.orderNumber}</strong>
            {#if order.customerReference}
              <span class="muted">ref {order.customerReference}</span>
            {/if}
            <StatusBadge status={order.status} />
          </div>
          <div class="muted">
            {order.originLocation.city} → {order.destinationLocation.city}
            · pickup {fmt(order.requestedPickupDate)} · delivery {fmt(order.requestedDeliveryDate)}
          </div>
          {#if order.shipments.length > 0}
            <table>
              <tbody>
                {#each order.shipments as shipment (shipment.shipmentNumber)}
                  <tr>
                    <td>{shipment.shipmentNumber}</td>
                    <td><StatusBadge status={shipment.status} /></td>
                    <td>{shipment.actualDeliveryAt ? `delivered ${fmt(shipment.actualDeliveryAt)}` : ''}</td>
                    <td style="text-align: right;">
                      {#if shipment.trackingUrl}
                        <a href={shipment.trackingUrl}>Track</a>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
      {:else}
        <p class="muted">No orders yet.</p>
      {/each}
    {:else}
      <p class="muted">Loading…</p>
    {/if}
    <p class="muted" style="margin-bottom: 0; font-size: 11px;">Powered by Pulsar</p>
  </div>
</div>

<style>
  .public-page {
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 32px 16px;
  }

  .public-card {
    width: 100%;
    max-width: 720px;
  }

  .order {
    border-top: 1px solid var(--color-border);
    padding: 14px 0;
  }

  .order-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
</style>
