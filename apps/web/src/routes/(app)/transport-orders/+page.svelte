<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import StatusBadge from '$lib/components/StatusBadge.svelte';

  interface OrderRow {
    id: string;
    orderNumber: string;
    status: string;
    customerReference: string | null;
    requestedPickupDate: string | null;
    requestedDeliveryDate: string | null;
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
    requestedPickupDate: '',
    requestedDeliveryDate: '',
    totalWeightKg: '',
    palletCount: '',
  });

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
          requestedPickupDate: form.requestedPickupDate
            ? new Date(form.requestedPickupDate).toISOString()
            : undefined,
          requestedDeliveryDate: form.requestedDeliveryDate
            ? new Date(form.requestedDeliveryDate).toISOString()
            : undefined,
          totalWeightKg: form.totalWeightKg ? Number(form.totalWeightKg) : undefined,
          palletCount: form.palletCount ? Number(form.palletCount) : undefined,
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
        <label for="pickup">Requested pickup</label>
        <input id="pickup" type="date" bind:value={form.requestedPickupDate} />
      </div>
      <div class="field">
        <label for="delivery">Requested delivery</label>
        <input id="delivery" type="date" bind:value={form.requestedDeliveryDate} />
      </div>
      <div class="field">
        <label for="weight">Weight (kg)</label>
        <input id="weight" type="number" min="0" bind:value={form.totalWeightKg} />
      </div>
      <div class="field">
        <label for="pallets">Pallets</label>
        <input id="pallets" type="number" min="0" bind:value={form.palletCount} />
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
          <td>
            {order.requestedPickupDate
              ? new Date(order.requestedPickupDate).toLocaleDateString()
              : '—'}
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
        <tr><td colspan="7" class="muted">No transport orders yet.</td></tr>
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
</style>
