<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    PageHeader,
    Button,
    FilterBar,
    Select,
    Field,
    Table,
    Badge,
    EmptyState,
    Panel,
    Card,
    Skeleton,
    ErrorNotice,
    toneFor,
    labelFor,
  } from '$lib/components/ui';
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
    totalWeightKg?: number | null;
    totalVolumeM3?: number | null;
    palletCount?: number | null;
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
  let selected = $state<ShipmentRow | null>(null);
  let loading = $state(true);

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
    } finally {
      loading = false;
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

  function fmtDims(row: ShipmentRow): string {
    const parts: string[] = [];
    if (row.totalWeightKg != null) parts.push(`${row.totalWeightKg.toLocaleString()} kg`);
    if (row.totalVolumeM3 != null) parts.push(`${row.totalVolumeM3} m³`);
    if (row.palletCount != null) parts.push(`${row.palletCount} pal`);
    return parts.length > 0 ? parts.join(' · ') : '—';
  }

  const unplannedCount = $derived(shipments.filter((s) => !s.load).length);
  const assignedCount = $derived(shipments.filter((s) => s.load).length);
  const movingCount = $derived(shipments.filter((s) => ['DISPATCHED', 'IN_TRANSIT'].includes(s.status)).length);

  $effect(() => {
    statusFilter;
    void load();
  });
</script>

<PageHeader
  title="Shipments"
  subtitle="Plan confirmed freight into loads and keep unplanned work visible."
  count={total}
/>

<ErrorNotice message={error} onretry={load} />

<div class="mb-4 grid gap-3 sm:grid-cols-3">
  <Card><div class="text-xl font-bold text-ink">{unplannedCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Unplanned</div><p class="mt-1 text-xs text-ink-faint">Ready to consolidate in Dispatch.</p></Card>
  <Card><div class="text-xl font-bold text-ink">{assignedCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Assigned</div><p class="mt-1 text-xs text-ink-faint">Already attached to a load.</p></Card>
  <Card><div class="text-xl font-bold text-ink">{movingCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Moving</div><p class="mt-1 text-xs text-ink-faint">Dispatched or in transit.</p></Card>
</div>

<FilterBar>
  <div class="w-44">
    <Select bind:value={statusFilter}>
      <option value="">All statuses</option>
      {#each ['PENDING', 'PLANNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CLOSED', 'CANCELLED'] as s (s)}
        <option value={s}>{s.replaceAll('_', ' ')}</option>
      {/each}
    </Select>
  </div>
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else}
<Table>
  {#snippet head()}
    <th>Shipment #</th><th>Order #</th><th>Origin → Destination</th>
    <th>Weight / Vol / Pal</th><th>Load</th><th>Status</th>
  {/snippet}
  {#snippet body()}
    {#each shipments as row (row.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <tr class="cursor-pointer" onclick={() => (selected = row)}>
        <td class="font-semibold">{row.shipmentNumber}</td>
        <td>
          <a href={`/transport-orders/${row.transportOrder.id}`} class="font-semibold text-accent hover:underline"
             onclick={(e) => e.stopPropagation()}>{row.transportOrder.orderNumber}</a>
        </td>
        <td>{row.originLocation.city} → {row.destinationLocation.city}</td>
        <td class="text-sm text-ink-muted">{fmtDims(row)}</td>
        <td>
          {#if row.load}
            <a href={`/loads/${row.load.id}`} class="font-semibold text-accent hover:underline"
               onclick={(e) => e.stopPropagation()}>{row.load.loadNumber}</a>
          {:else}
            —
          {/if}
        </td>
        <td><Badge tone={toneFor(row.status)}>{labelFor(row.status)}</Badge></td>
      </tr>
    {:else}
      <tr><td colspan="6"><EmptyState title="No shipments ready to plan" message="Confirm and plan a transport order first, then send generated shipments into Dispatch for consolidation.">
        {#snippet children()}<Button variant="secondary" href="/transport-orders">Open transport orders</Button><Button href="/dispatch">Open Dispatch</Button>{/snippet}
      </EmptyState></td></tr>
    {/each}
  {/snippet}
</Table>
{/if}

{#if selected}
  {@const sel = selected}
  <Panel open={true} title={sel.shipmentNumber} onclose={() => { selected = null; assigning = null; }}>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Status</div>
      <div class="text-sm text-ink"><Badge tone={toneFor(sel.status)}>{labelFor(sel.status)}</Badge></div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Order</div>
      <div class="text-sm text-ink">
        <a href={`/transport-orders/${sel.transportOrder.id}`} class="text-accent hover:underline">{sel.transportOrder.orderNumber}</a>
      </div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Origin → Destination</div>
      <div class="text-sm text-ink">{sel.originLocation.name}, {sel.originLocation.city} → {sel.destinationLocation.name}, {sel.destinationLocation.city}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Pickup window</div>
      <div class="text-sm text-ink">{fmtWindow(sel.plannedPickupEarly, sel.plannedPickupLate)}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Delivery window</div>
      <div class="text-sm text-ink">{fmtWindow(sel.plannedDeliveryEarly, sel.plannedDeliveryLate)}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Weight / Vol / Pal</div>
      <div class="text-sm text-ink">{fmtDims(sel)}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Load</div>
      <div class="text-sm text-ink">
        {#if sel.load}
          <a href={`/loads/${sel.load.id}`} class="text-accent hover:underline">{sel.load.loadNumber}</a>
        {:else}
          —
        {/if}
      </div>
    </div>

    <!-- Assign / unassign controls in the panel -->
    <div class="mt-4 border-t border-edge pt-4">
      {#if sel.status === 'PENDING'}
        {#if !assigning || assigning.id !== sel.id}
          <Button variant="primary" onclick={() => openAssign(sel)}>Assign to load</Button>
          <div class="mt-2">
            <Button variant="danger" onclick={() => cancelShipment(sel)}>Cancel shipment</Button>
          </div>
        {:else}
          <Field label="Load">
            <select
              bind:value={selectedLoadId}
              onchange={() => { assignCapacityExcesses = []; assignForce = false; }}
              class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            >
              <option value="">+ Create a new load</option>
              {#each openLoads as l (l.id)}
                <option value={l.id}>{l.loadNumber} ({l.status})</option>
              {/each}
            </select>
          </Field>

          {#if assignCapacityExcesses.length > 0}
            <div class="mt-3 rounded-card border border-warn bg-warn-soft p-3">
              <p class="mb-2 text-sm font-semibold text-warn">Trailer capacity exceeded</p>
              <table class="w-full text-xs">
                <thead>
                  <tr class="text-ink-muted">
                    <th class="pb-1 text-left">Axis</th>
                    <th class="pb-1 text-right">Capacity</th>
                    <th class="pb-1 text-right">Requested</th>
                    <th class="pb-1 text-right">Excess</th>
                  </tr>
                </thead>
                <tbody>
                  {#each assignCapacityExcesses as ex (ex.axis)}
                    <tr>
                      <td class="py-0.5">{ex.axis}</td>
                      <td class="py-0.5 text-right">{ex.capacity}</td>
                      <td class="py-0.5 text-right">{ex.requested}</td>
                      <td class="py-0.5 text-right text-danger">+{ex.excess}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
              <label class="mt-2 flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input type="checkbox" bind:checked={assignForce} />
                Force assignment (audited)
              </label>
            </div>
          {/if}

          <div class="mt-3 flex gap-2">
            {#if assignCapacityExcesses.length > 0 && assignForce}
              <Button variant="danger" onclick={() => assign(true)}>Confirm force assign</Button>
            {:else}
              <Button variant="primary" onclick={() => assign()}>Assign</Button>
            {/if}
            <Button variant="secondary" onclick={() => { assigning = null; }}>Cancel</Button>
          </div>
        {/if}
      {:else if sel.status === 'PLANNED'}
        <Button variant="secondary" onclick={() => removeFromLoad(sel)}>Remove from load</Button>
      {/if}
      <div class="mt-2">
        <Button variant="secondary" onclick={() => shareTracking(sel)}>Share tracking</Button>
      </div>
    </div>
  </Panel>
{/if}
