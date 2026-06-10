<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import { toast } from '$lib/stores/toast';

  interface ShipmentRow {
    id: string;
    shipmentNumber: string;
    status: string;
    plannedPickupAt: string | null;
    plannedDeliveryAt: string | null;
    transportOrder: { id: string; orderNumber: string };
    originLocation: { name: string; city: string };
    destinationLocation: { name: string; city: string };
    load: { id: string; loadNumber: string; status: string } | null;
  }

  interface LoadOption {
    id: string;
    loadNumber: string;
    status: string;
  }

  let shipments = $state<ShipmentRow[]>([]);
  let total = $state(0);
  let statusFilter = $state('');
  let error = $state('');

  // "Assign to load" picker state
  let assigning = $state<ShipmentRow | null>(null);
  let openLoads = $state<LoadOption[]>([]);
  let selectedLoadId = $state('');

  async function load() {
    try {
      const result = await api<Paginated<ShipmentRow>>('/transportation/shipments', {
        query: { pageSize: 50, status: statusFilter || undefined },
      });
      shipments = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load shipments';
    }
  }

  async function openAssign(shipment: ShipmentRow) {
    assigning = shipment;
    selectedLoadId = '';
    const result = await api<Paginated<LoadOption>>('/transportation/loads', {
      query: { pageSize: 100 },
    });
    openLoads = result.items.filter((l) => l.status === 'OPEN' || l.status === 'PLANNED');
  }

  async function assign() {
    if (!assigning) return;
    try {
      let loadId = selectedLoadId;
      if (!loadId) {
        const created = await api<LoadOption>('/transportation/loads', { method: 'POST', body: {} });
        loadId = created.id;
      }
      await api(`/transportation/shipments/${assigning.id}/assign-load`, {
        method: 'POST',
        body: { loadId },
      });
      toast.success(`${assigning.shipmentNumber} assigned to load`);
      assigning = null;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to assign');
    }
  }

  async function shareTracking(shipment: ShipmentRow) {
    try {
      const { url } = await api<{ url: string }>(`/transportation/shipments/${shipment.id}/share`, {
        method: 'POST',
      });
      await navigator.clipboard.writeText(url);
      toast.success(`Tracking link for ${shipment.shipmentNumber} copied`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create tracking link');
    }
  }

  async function cancelShipment(shipment: ShipmentRow) {
    try {
      await api(`/transportation/shipments/${shipment.id}/cancel`, { method: 'POST' });
      toast.success(`${shipment.shipmentNumber} cancelled`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to cancel shipment');
    }
  }

  async function removeFromLoad(shipment: ShipmentRow) {
    try {
      await api(`/transportation/shipments/${shipment.id}/remove-load`, { method: 'POST' });
      toast.success(`${shipment.shipmentNumber} returned to planning pool`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to remove from load');
    }
  }

  $effect(() => {
    statusFilter;
    void load();
  });
</script>

<div class="page-header">
  <h1>Shipments <span class="muted">({total})</span></h1>
  <select bind:value={statusFilter} style="width: 180px;">
    <option value="">All statuses</option>
    {#each ['PENDING', 'PLANNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CLOSED', 'CANCELLED'] as s (s)}
      <option value={s}>{s.replaceAll('_', ' ')}</option>
    {/each}
  </select>
</div>

{#if error}
  <p class="error-text">{error}</p>
{/if}

{#if assigning}
  <div class="card" style="margin-bottom: 20px;">
    <h2 style="margin-top: 0;">Assign {assigning.shipmentNumber} to a load</h2>
    <div class="field" style="max-width: 360px;">
      <label for="load">Load</label>
      <select id="load" bind:value={selectedLoadId}>
        <option value="">+ Create a new load</option>
        {#each openLoads as l (l.id)}
          <option value={l.id}>{l.loadNumber} ({l.status})</option>
        {/each}
      </select>
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="btn" onclick={assign}>Assign</button>
      <button class="btn btn-secondary" onclick={() => (assigning = null)}>Cancel</button>
    </div>
  </div>
{/if}

<div class="card" style="padding: 0;">
  <table>
    <thead>
      <tr>
        <th>Shipment #</th>
        <th>Order</th>
        <th>Origin</th>
        <th>Destination</th>
        <th>Status</th>
        <th>Load</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each shipments as shipment (shipment.id)}
        <tr>
          <td><strong>{shipment.shipmentNumber}</strong></td>
          <td>
            <a href={`/transport-orders/${shipment.transportOrder.id}`}>
              {shipment.transportOrder.orderNumber}
            </a>
          </td>
          <td>{shipment.originLocation.city}</td>
          <td>{shipment.destinationLocation.city}</td>
          <td><StatusBadge status={shipment.status} /></td>
          <td>
            {#if shipment.load}
              <a href={`/loads/${shipment.load.id}`}>{shipment.load.loadNumber}</a>
            {:else}
              <span class="muted">—</span>
            {/if}
          </td>
          <td style="text-align: right; white-space: nowrap;">
            {#if shipment.status === 'PENDING'}
              <button class="btn btn-sm" onclick={() => openAssign(shipment)}>Assign to load</button>
              <button class="btn btn-danger btn-sm" onclick={() => cancelShipment(shipment)}>
                Cancel
              </button>
            {:else if shipment.status === 'PLANNED'}
              <button class="btn btn-secondary btn-sm" onclick={() => removeFromLoad(shipment)}>
                Remove from load
              </button>
            {/if}
            <button class="btn btn-secondary btn-sm" onclick={() => shareTracking(shipment)}>
              Share tracking
            </button>
          </td>
        </tr>
      {:else}
        <tr><td colspan="7" class="muted">No shipments. Plan a confirmed transport order to create one.</td></tr>
      {/each}
    </tbody>
  </table>
</div>
