<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import { toast } from '$lib/stores/toast';

  interface ShipmentRow {
    id: string;
    shipmentNumber: string;
    status: string;
    plannedPickupEarly: string | null;
    plannedPickupLate: string | null;
    plannedDeliveryEarly: string | null;
    plannedDeliveryLate: string | null;
    transportOrder: { id: string; orderNumber: string };
    originLocation: { name: string; city: string };
    destinationLocation: { name: string; city: string };
    load: { id: string; loadNumber: string; status: string } | null;
  }

  const fmtWindow = (early: string | null, late?: string | null) =>
    early
      ? new Date(early).toLocaleDateString() + (late ? ' → ' + new Date(late).toLocaleDateString() : '')
      : '—';

  interface LoadOption {
    id: string;
    loadNumber: string;
    status: string;
  }

  interface CapacityExcess {
    axis: string;
    capacity: number;
    requested: number;
    excess: number;
  }

  let shipments = $state<ShipmentRow[]>([]);
  let total = $state(0);
  let statusFilter = $state('');
  let error = $state('');

  // "Assign to load" picker state
  let assigning = $state<ShipmentRow | null>(null);
  let openLoads = $state<LoadOption[]>([]);
  let selectedLoadId = $state('');
  let assignCapacityExcesses = $state<CapacityExcess[]>([]);
  let assignForce = $state(false);
  let pendingLoadId = $state('');

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
    assignCapacityExcesses = [];
    assignForce = false;
    pendingLoadId = '';
    const result = await api<Paginated<LoadOption>>('/transportation/loads', {
      query: { pageSize: 100 },
    });
    openLoads = result.items.filter((l) => l.status === 'OPEN' || l.status === 'PLANNED');
  }

  async function assign(force = false) {
    if (!assigning) return;
    try {
      let loadId = force ? pendingLoadId : selectedLoadId;
      if (!loadId) {
        const created = await api<LoadOption>('/transportation/loads', { method: 'POST', body: {} });
        loadId = created.id;
      }
      const resp = await api<{ modeWarning?: { loadMode: string; orderMode: string } }>(
        `/transportation/shipments/${assigning.id}/assign-load`,
        {
          method: 'POST',
          body: force ? { loadId, force: true } : { loadId },
        },
      );
      if (resp?.modeWarning) {
        const { loadMode, orderMode } = resp.modeWarning;
        toast.error(`Mode mismatch: load ${loadMode} / order ${orderMode} — assigned anyway`);
      } else {
        toast.success(`${assigning.shipmentNumber} assigned to load`);
      }
      assigning = null;
      assignCapacityExcesses = [];
      assignForce = false;
      pendingLoadId = '';
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 400) {
        const body = e.body as { excesses?: CapacityExcess[] } | null;
        if (body?.excesses?.length) {
          // Resolve the load id we were trying to assign to (for force retry)
          if (!force) {
            let resolvedId = selectedLoadId;
            if (!resolvedId) {
              // A new load was created inside the try before the error; we can't recover it here.
              // Re-open assign so user picks an existing load for force.
              assignCapacityExcesses = body.excesses;
              assignForce = false;
              pendingLoadId = '';
              return;
            }
            pendingLoadId = resolvedId;
          }
          assignCapacityExcesses = body.excesses;
          return;
        }
      }
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
      <select id="load" bind:value={selectedLoadId} onchange={() => { assignCapacityExcesses = []; assignForce = false; }}>
        <option value="">+ Create a new load</option>
        {#each openLoads as l (l.id)}
          <option value={l.id}>{l.loadNumber} ({l.status})</option>
        {/each}
      </select>
    </div>

    {#if assignCapacityExcesses.length > 0}
      <div class="capacity-alert">
        <strong>Trailer capacity exceeded</strong>
        <table style="width: 100%; margin-top: 6px; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr>
              <th style="text-align: left;">Axis</th>
              <th style="text-align: right;">Capacity</th>
              <th style="text-align: right;">Requested</th>
              <th style="text-align: right;">Excess</th>
            </tr>
          </thead>
          <tbody>
            {#each assignCapacityExcesses as ex (ex.axis)}
              <tr>
                <td>{ex.axis}</td>
                <td style="text-align: right;">{ex.capacity}</td>
                <td style="text-align: right;">{ex.requested}</td>
                <td style="text-align: right; color: var(--color-danger, #dc3545);">+{ex.excess}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <label style="display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 13px; cursor: pointer;">
          <input type="checkbox" bind:checked={assignForce} />
          Force assignment (audited)
        </label>
      </div>
    {/if}

    <div style="display: flex; gap: 8px; margin-top: 10px;">
      {#if assignCapacityExcesses.length > 0 && assignForce}
        <button class="btn btn-danger" onclick={() => assign(true)}>Confirm force assign</button>
      {:else}
        <button class="btn" onclick={() => assign()}>Assign</button>
      {/if}
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
        <th>Pickup</th>
        <th>Delivery</th>
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
          <td>{fmtWindow(shipment.plannedPickupEarly, shipment.plannedPickupLate)}</td>
          <td>{fmtWindow(shipment.plannedDeliveryEarly, shipment.plannedDeliveryLate)}</td>
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
        <tr><td colspan="9" class="muted">No shipments. Plan a confirmed transport order to create one.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .capacity-alert {
    margin-top: 10px;
    padding: 10px 12px;
    background: #fff3cd;
    border: 1px solid #ffc107;
    border-radius: 6px;
  }
</style>
