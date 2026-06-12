<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { suggestMode, TransportMode } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import StatusBadge from '$lib/components/StatusBadge.svelte';

  interface OrderRow {
    id: string;
    orderNumber: string;
    status: string;
    mode: string | null;
    customerReference: string | null;
    requestedPickupEarly: string | null;
    requestedPickupLate: string | null;
    requestedDeliveryEarly: string | null;
    requestedDeliveryLate: string | null;
    customer: { id: string; name: string };
    originLocation: { name: string; city: string };
    destinationLocation: { name: string; city: string };
  }

  interface Option {
    id: string;
    name: string;
  }

  let orders = $state<OrderRow[]>([]);
  let total = $state(0);
  let search = $state('');
  let error = $state('');
  let showForm = $state(false);

  // Create form state
  let customers = $state<Option[]>([]);
  let locations = $state<Option[]>([]);
  let form = $state({
    customerId: '',
    originLocationId: '',
    destinationLocationId: '',
    customerReference: '',
    requestedPickupEarly: '',
    requestedPickupLate: '',
    requestedDeliveryEarly: '',
    requestedDeliveryLate: '',
    totalWeightKg: '',
    palletCount: '',
    mode: TransportMode.FTL,
  });

  const modeSuggestion = $derived(() => {
    const w = form.totalWeightKg ? Number(form.totalWeightKg) : null;
    const suggested = suggestMode(w);
    return suggested && suggested !== form.mode ? suggested : null;
  });

  const fmtWindow = (early: string | null, late?: string | null) =>
    early
      ? new Date(early).toLocaleDateString() + (late ? ' → ' + new Date(late).toLocaleDateString() : '')
      : '—';

  async function load() {
    try {
      const result = await api<Paginated<OrderRow>>('/transportation/transport-orders', {
        query: { search, pageSize: 50 },
      });
      orders = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load orders';
    }
  }

  async function openForm() {
    showForm = true;
    const [customersResult, locationsResult] = await Promise.all([
      api<Paginated<Option>>('/transportation/customers', { query: { pageSize: 100 } }),
      api<Paginated<Option>>('/transportation/locations', { query: { pageSize: 100 } }),
    ]);
    customers = customersResult.items;
    locations = locationsResult.items;
  }

  async function createOrder(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    try {
      await api('/transportation/transport-orders', {
        method: 'POST',
        body: {
          customerId: form.customerId,
          originLocationId: form.originLocationId,
          destinationLocationId: form.destinationLocationId,
          customerReference: form.customerReference || undefined,
          requestedPickupEarly: form.requestedPickupEarly
            ? new Date(form.requestedPickupEarly).toISOString()
            : undefined,
          requestedPickupLate: form.requestedPickupLate
            ? new Date(form.requestedPickupLate).toISOString()
            : undefined,
          requestedDeliveryEarly: form.requestedDeliveryEarly
            ? new Date(form.requestedDeliveryEarly).toISOString()
            : undefined,
          requestedDeliveryLate: form.requestedDeliveryLate
            ? new Date(form.requestedDeliveryLate).toISOString()
            : undefined,
          totalWeightKg: form.totalWeightKg ? Number(form.totalWeightKg) : undefined,
          palletCount: form.palletCount ? Number(form.palletCount) : undefined,
          mode: form.mode,
        },
      });
      showForm = false;
      await load();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to create order';
    }
  }

  async function action(id: string, name: 'confirm' | 'plan' | 'cancel') {
    error = '';
    try {
      await api(`/transportation/transport-orders/${id}/${name}`, { method: 'POST' });
      await load();
    } catch (e) {
      error = e instanceof ApiError ? e.message : `Failed to ${name} order`;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="page-header">
  <h1>Transport Orders <span class="muted">({total})</span></h1>
  <button class="btn" onclick={openForm}>New order</button>
</div>

{#if error}
  <p class="error-text">{error}</p>
{/if}

{#if showForm}
  <form class="card" style="margin-bottom: 20px;" onsubmit={createOrder}>
    <h2 style="margin-top: 0;">New transport order</h2>
    <div class="form-grid">
      <div class="field">
        <label for="customer">Customer</label>
        <select id="customer" bind:value={form.customerId} required>
          <option value="" disabled>Select…</option>
          {#each customers as c (c.id)}
            <option value={c.id}>{c.name}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="reference">Customer reference</label>
        <input id="reference" bind:value={form.customerReference} placeholder="PO-12345" />
      </div>
      <div class="field">
        <label for="origin">Origin</label>
        <select id="origin" bind:value={form.originLocationId} required>
          <option value="" disabled>Select…</option>
          {#each locations as l (l.id)}
            <option value={l.id}>{l.name}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="destination">Destination</label>
        <select id="destination" bind:value={form.destinationLocationId} required>
          <option value="" disabled>Select…</option>
          {#each locations as l (l.id)}
            <option value={l.id}>{l.name}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="pickup-from">Pickup from</label>
        <input id="pickup-from" type="date" bind:value={form.requestedPickupEarly} />
      </div>
      <div class="field">
        <label for="pickup-to">Pickup to (optional)</label>
        <input id="pickup-to" type="date" bind:value={form.requestedPickupLate} />
      </div>
      <div class="field">
        <label for="delivery-from">Delivery from</label>
        <input id="delivery-from" type="date" bind:value={form.requestedDeliveryEarly} />
      </div>
      <div class="field">
        <label for="delivery-to">Delivery to (optional)</label>
        <input id="delivery-to" type="date" bind:value={form.requestedDeliveryLate} />
      </div>
      <div class="field">
        <label for="weight">Weight (kg)</label>
        <input id="weight" type="number" min="0" bind:value={form.totalWeightKg} />
      </div>
      <div class="field">
        <label for="pallets">Pallets</label>
        <input id="pallets" type="number" min="0" bind:value={form.palletCount} />
      </div>
      <div class="field">
        <label for="mode">Mode</label>
        <select id="mode" bind:value={form.mode}>
          {#each Object.values(TransportMode) as m (m)}
            <option value={m}>{m}</option>
          {/each}
        </select>
        {#if modeSuggestion()}
          <small class="muted">Suggested: {modeSuggestion()} based on weight</small>
        {/if}
      </div>
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="btn" type="submit">Create</button>
      <button class="btn btn-secondary" type="button" onclick={() => (showForm = false)}>
        Cancel
      </button>
    </div>
  </form>
{/if}

<div class="card" style="padding: 0;">
  <div style="padding: 14px 12px;">
    <input
      placeholder="Search order #, reference, customer…"
      bind:value={search}
      onkeydown={(e) => e.key === 'Enter' && load()}
      style="max-width: 320px;"
    />
  </div>
  <table>
    <thead>
      <tr>
        <th>Order #</th>
        <th>Customer</th>
        <th>Origin</th>
        <th>Destination</th>
        <th>Pickup</th>
        <th>Mode</th>
        <th>Status</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each orders as order (order.id)}
        <tr>
          <td><a href={`/transport-orders/${order.id}`}><strong>{order.orderNumber}</strong></a></td>
          <td>{order.customer.name}</td>
          <td>{order.originLocation.city}</td>
          <td>{order.destinationLocation.city}</td>
          <td>{fmtWindow(order.requestedPickupEarly, order.requestedPickupLate)}</td>
          <td>
            {#if order.mode}
              <span class="badge badge-mode">{order.mode}</span>
            {:else}
              <span class="muted">—</span>
            {/if}
          </td>
          <td><StatusBadge status={order.status} /></td>
          <td style="text-align: right; white-space: nowrap;">
            {#if order.status === 'DRAFT'}
              <button class="btn btn-sm" onclick={() => action(order.id, 'confirm')}>Confirm</button>
              <button class="btn btn-secondary btn-sm" onclick={() => action(order.id, 'cancel')}>
                Cancel
              </button>
            {:else if order.status === 'CONFIRMED'}
              <button class="btn btn-sm" onclick={() => action(order.id, 'plan')}>Plan</button>
            {/if}
          </td>
        </tr>
      {:else}
        <tr><td colspan="8" class="muted">No transport orders yet.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 20px;
  }

  .badge-mode {
    background: #e0e7ff;
    color: #3730a3;
    border: 1px solid #c7d2fe;
    padding: 1px 7px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
  }
</style>
