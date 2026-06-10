<script lang="ts">
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import StatusBadge from '$lib/components/StatusBadge.svelte';

  interface PortalView {
    shipper: string;
    customer: string;
    locations: { id: string; name: string; city: string }[];
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
  let showRequest = $state(false);
  let requestNotice = $state('');
  let request = $state({
    originLocationId: '',
    destinationLocationId: '',
    customerReference: '',
    requestedPickupDate: '',
    palletCount: '',
    totalWeightKg: '',
    notes: '',
  });

  function fmt(value: string | null): string {
    return value ? new Date(value).toLocaleDateString() : '—';
  }

  async function load() {
    try {
      view = await api<PortalView>(`/public/portal/${token}`);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'This link is invalid';
    }
  }

  async function submitRequest(event: SubmitEvent) {
    event.preventDefault();
    requestNotice = '';
    try {
      const created = await api<{ orderNumber: string }>(`/public/portal/${token}/orders`, {
        method: 'POST',
        body: {
          originLocationId: request.originLocationId,
          destinationLocationId: request.destinationLocationId,
          customerReference: request.customerReference || undefined,
          requestedPickupDate: request.requestedPickupDate
            ? new Date(request.requestedPickupDate).toISOString()
            : undefined,
          palletCount: request.palletCount ? Number(request.palletCount) : undefined,
          totalWeightKg: request.totalWeightKg ? Number(request.totalWeightKg) : undefined,
          notes: request.notes || undefined,
        },
      });
      requestNotice = `Request submitted — order ${created.orderNumber} awaits confirmation.`;
      showRequest = false;
      request = {
        originLocationId: '',
        destinationLocationId: '',
        customerReference: '',
        requestedPickupDate: '',
        palletCount: '',
        totalWeightKg: '',
        notes: '',
      };
      await load();
    } catch (e) {
      requestNotice = e instanceof ApiError ? e.message : 'Failed to submit the request';
    }
  }

  $effect(() => {
    if (token) void load();
  });
</script>

<div class="public-page">
  <div class="card public-card">
    {#if error}
      <p class="error-text">{error}</p>
    {:else if view}
      <p class="muted" style="margin-top: 0;">Customer portal · {view.shipper}</p>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h1>{view.customer}</h1>
        <button class="btn" onclick={() => (showRequest = !showRequest)}>Request a transport</button>
      </div>

      {#if requestNotice}
        <p class="muted">{requestNotice}</p>
      {/if}

      {#if showRequest}
        <form class="request-form" onsubmit={submitRequest}>
          <div class="grid2">
            <div class="field">
              <label for="origin">Origin</label>
              <select id="origin" bind:value={request.originLocationId} required>
                <option value="" disabled>Select…</option>
                {#each view.locations as l (l.id)}<option value={l.id}>{l.name} ({l.city})</option>{/each}
              </select>
            </div>
            <div class="field">
              <label for="destination">Destination</label>
              <select id="destination" bind:value={request.destinationLocationId} required>
                <option value="" disabled>Select…</option>
                {#each view.locations as l (l.id)}<option value={l.id}>{l.name} ({l.city})</option>{/each}
              </select>
            </div>
            <div class="field">
              <label for="ref">Your reference</label>
              <input id="ref" bind:value={request.customerReference} placeholder="PO-12345" />
            </div>
            <div class="field">
              <label for="pickup">Requested pickup</label>
              <input id="pickup" type="date" bind:value={request.requestedPickupDate} />
            </div>
            <div class="field">
              <label for="pallets">Pallets</label>
              <input id="pallets" type="number" min="0" bind:value={request.palletCount} />
            </div>
            <div class="field">
              <label for="weight">Weight (kg)</label>
              <input id="weight" type="number" min="0" bind:value={request.totalWeightKg} />
            </div>
          </div>
          <div class="field">
            <label for="notes">Notes</label>
            <textarea id="notes" rows="2" bind:value={request.notes}></textarea>
          </div>
          <button class="btn" type="submit">Submit request</button>
        </form>
      {/if}

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

  .request-form {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: 14px;
    margin-bottom: 16px;
    background: var(--color-bg);
  }

  .grid2 {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 16px;
  }
</style>
