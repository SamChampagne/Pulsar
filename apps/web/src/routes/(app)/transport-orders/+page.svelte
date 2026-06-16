<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { suggestMode, TransportMode } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    PageHeader,
    Button,
    FilterBar,
    Select,
    Input,
    Field,
    Table,
    Badge,
    EmptyState,
    Panel,
    Modal,
    Card,
    Skeleton,
    ErrorNotice,
    toneFor,
    labelFor,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

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
  let selected = $state<OrderRow | null>(null);
  let showForm = $state(false);
  let loading = $state(true);

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

  const draftCount = $derived(orders.filter((o) => o.status === 'DRAFT').length);
  const confirmedCount = $derived(orders.filter((o) => o.status === 'CONFIRMED').length);
  const plannedCount = $derived(orders.filter((o) => o.status === 'PLANNED').length);

  async function load() {
    try {
      const result = await api<Paginated<OrderRow>>('/transportation/transport-orders', {
        query: { search, pageSize: 50 },
      });
      orders = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load orders';
    } finally {
      loading = false;
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
    try {
      await api(`/transportation/transport-orders/${id}/${name}`, { method: 'POST' });
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : `Failed to ${name} order`);
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader
  title="Transport Orders"
  subtitle="Capture customer demand before it becomes shipments and dispatchable loads."
  count={total}
>
  {#snippet actions()}
    <Button onclick={openForm}>New order</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

<div class="mb-4 grid gap-3 sm:grid-cols-3">
  <Card><div class="text-xl font-bold text-ink">{draftCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Draft</div><p class="mt-1 text-xs text-ink-faint">Needs confirmation before planning.</p></Card>
  <Card><div class="text-xl font-bold text-ink">{confirmedCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Ready to plan</div><p class="mt-1 text-xs text-ink-faint">Can generate shipments for Dispatch.</p></Card>
  <Card><div class="text-xl font-bold text-ink">{plannedCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Planned</div><p class="mt-1 text-xs text-ink-faint">Demand already moved downstream.</p></Card>
</div>

<FilterBar>
  <div class="w-72">
    <input
      placeholder="Search order #, reference, customer…"
      bind:value={search}
      onkeydown={(e) => { if (e.key === 'Enter') void load(); }}
      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
    />
  </div>
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else}
<Table>
  {#snippet head()}
    <th>Order #</th><th>Customer</th><th>Origin → Destination</th>
    <th>Mode</th><th>Requested pickup</th><th>Status</th>
  {/snippet}
  {#snippet body()}
    {#each orders as row (row.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <tr class="cursor-pointer" onclick={() => (selected = row)}>
        <td>
          <a href={`/transport-orders/${row.id}`} class="font-semibold text-accent hover:underline"
             onclick={(e) => e.stopPropagation()}>{row.orderNumber}</a>
        </td>
        <td>{row.customer.name}</td>
        <td>{row.originLocation.city} → {row.destinationLocation.city}</td>
        <td>
          {#if row.mode}
            <span class="rounded border border-edge px-1.5 text-xs text-neutral">{row.mode}</span>
          {:else}
            —
          {/if}
        </td>
        <td>{fmtWindow(row.requestedPickupEarly, row.requestedPickupLate)}</td>
        <td><Badge tone={toneFor(row.status)}>{labelFor(row.status)}</Badge></td>
      </tr>
    {:else}
      <tr><td colspan="6"><EmptyState title="No transport orders yet" message="Create a transport order to capture customer demand, then confirm and plan it into shipments.">
        {#snippet children()}<Button onclick={openForm}>Create first order</Button>{/snippet}
      </EmptyState></td></tr>
    {/each}
  {/snippet}
</Table>
{/if}

{#if selected}
  {@const sel = selected}
  <Panel open={true} title={sel.orderNumber} href={`/transport-orders/${sel.id}`} onclose={() => (selected = null)}>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Status</div>
      <div class="text-sm text-ink"><Badge tone={toneFor(sel.status)}>{labelFor(sel.status)}</Badge></div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Customer</div>
      <div class="text-sm text-ink">{sel.customer.name}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Origin → Destination</div>
      <div class="text-sm text-ink">{sel.originLocation.name}, {sel.originLocation.city} → {sel.destinationLocation.name}, {sel.destinationLocation.city}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Requested pickup</div>
      <div class="text-sm text-ink">{fmtWindow(sel.requestedPickupEarly, sel.requestedPickupLate)}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Requested delivery</div>
      <div class="text-sm text-ink">{fmtWindow(sel.requestedDeliveryEarly, sel.requestedDeliveryLate)}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Mode</div>
      <div class="text-sm text-ink">{sel.mode ?? '—'}</div>
    </div>
    {#if sel.customerReference}
      <div class="mb-3">
        <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Reference</div>
        <div class="text-sm text-ink">{sel.customerReference}</div>
      </div>
    {/if}
  {#snippet footer()}
    {#if sel.status === 'DRAFT'}
      <Button variant="primary" onclick={async () => { await action(sel.id, 'confirm'); selected = null; }}>Confirm</Button>
      <Button variant="danger" onclick={async () => { await action(sel.id, 'cancel'); selected = null; }}>Cancel</Button>
    {:else if sel.status === 'CONFIRMED'}
      <Button variant="primary" onclick={async () => { await action(sel.id, 'plan'); selected = null; }}>Plan</Button>
    {/if}
  {/snippet}
  </Panel>
{/if}

<Modal bind:open={showForm} title="New transport order">
  {#snippet children()}
    <form onsubmit={createOrder}>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Customer">
          <Select bind:value={form.customerId} required>
            <option value="" disabled>Select…</option>
            {#each customers as c (c.id)}
              <option value={c.id}>{c.name}</option>
            {/each}
          </Select>
        </Field>
        <Field label="Customer reference">
          <Input bind:value={form.customerReference} placeholder="PO-12345" />
        </Field>
        <Field label="Origin">
          <Select bind:value={form.originLocationId} required>
            <option value="" disabled>Select…</option>
            {#each locations as l (l.id)}
              <option value={l.id}>{l.name}</option>
            {/each}
          </Select>
        </Field>
        <Field label="Destination">
          <Select bind:value={form.destinationLocationId} required>
            <option value="" disabled>Select…</option>
            {#each locations as l (l.id)}
              <option value={l.id}>{l.name}</option>
            {/each}
          </Select>
        </Field>
        <Field label="Pickup from">
          <Input type="date" bind:value={form.requestedPickupEarly} />
        </Field>
        <Field label="Pickup to (optional)">
          <Input type="date" bind:value={form.requestedPickupLate} />
        </Field>
        <Field label="Delivery from">
          <Input type="date" bind:value={form.requestedDeliveryEarly} />
        </Field>
        <Field label="Delivery to (optional)">
          <Input type="date" bind:value={form.requestedDeliveryLate} />
        </Field>
        <Field label="Weight (kg)">
          <Input type="number" min="0" bind:value={form.totalWeightKg} />
        </Field>
        <Field label="Pallets">
          <Input type="number" min="0" bind:value={form.palletCount} />
        </Field>
        <div class="col-span-2">
          <Field label="Mode">
            <Select bind:value={form.mode}>
              {#each Object.values(TransportMode) as m (m)}
                <option value={m}>{m}</option>
              {/each}
            </Select>
            {#if modeSuggestion()}
              <p class="mt-1 text-xs text-ink-muted">Suggested: {modeSuggestion()} based on weight</p>
            {/if}
          </Field>
        </div>
      </div>
      <div class="mt-4 flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={() => { showForm = false; }}>Cancel</Button>
        <Button variant="primary" type="submit">Create</Button>
      </div>
    </form>
  {/snippet}
</Modal>
