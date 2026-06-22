<script lang="ts">
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge, Button, Card, Field, PageHeader,
    toneFor, labelFor,
  } from '$lib/components/ui';
  import TrackingTimeline, { type TimelineEvent } from '$lib/components/TrackingTimeline.svelte';
  import CustomFieldInputs from '$lib/components/CustomFieldInputs.svelte';
  import { fmtCustomValue } from '$lib/format';
  import { toast } from '$lib/stores/toast';

  interface CustomFieldDef {
    key: string;
    label: string;
    type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';
    options?: { value: string; label: string }[];
    required: boolean;
    showInList?: boolean;
  }

  interface WindowWarning {
    shipmentNumber: string;
    field: 'pickup' | 'delivery';
    kind: 'BEFORE_EARLY' | 'AFTER_LATE';
    requested: string;
    planned: string;
  }

  interface OrderDetail {
    id: string;
    orderNumber: string;
    status: string;
    mode: string | null;
    customerReference: string | null;
    requestedPickupEarly: string | null;
    requestedPickupLate: string | null;
    requestedDeliveryEarly: string | null;
    requestedDeliveryLate: string | null;
    totalWeightKg: number | null;
    totalVolumeM3: number | null;
    palletCount: number | null;
    notes: string | null;
    createdAt: string;
    customer: { id: string; code: string; name: string };
    originLocation: { id: string; code: string; name: string; city: string };
    destinationLocation: { id: string; code: string; name: string; city: string };
    shipments: { id: string; shipmentNumber: string; status: string; loadId: string | null }[];
    windowWarnings?: WindowWarning[];
    customData?: Record<string, unknown>;
  }

  const orderId = $derived(page.params.id);

  let order = $state<OrderDetail | null>(null);
  let events = $state<TimelineEvent[]>([]);
  let error = $state('');
  let eventsError = $state(false);

  // Plan-with-split form
  let showPlanForm = $state(false);
  let splitRows = $state<{ weightKg: string; palletCount: string }[]>([
    { weightKg: '', palletCount: '' },
  ]);

  // Shipment custom fields
  let shipmentFieldDefs = $state<CustomFieldDef[]>([]);
  let shipmentCustomData = $state<Record<string, unknown>>({});
  let orderFieldDefs = $state<CustomFieldDef[]>([]);

  async function submitPlan(event: SubmitEvent) {
    event.preventDefault();
    const customDataPayload =
      Object.keys(shipmentCustomData).length > 0 ? shipmentCustomData : undefined;
    const rows = splitRows.map((r) => ({
      weightKg: r.weightKg === '' ? undefined : Number(r.weightKg),
      palletCount: r.palletCount === '' ? undefined : Number(r.palletCount),
      customData: customDataPayload,
    }));
    try {
      if (order?.status === 'PLANNED') {
        // Post-planning re-split: each row appends one shipment.
        for (const row of rows) {
          await api(`/transportation/transport-orders/${orderId}/shipments`, {
            method: 'POST',
            body: row,
          });
        }
        toast.success(`${rows.length} shipment${rows.length > 1 ? 's' : ''} added`);
      } else {
        const meaningful = rows.filter((r) => r.weightKg !== undefined || r.palletCount !== undefined);
        const body = splitRows.length > 1 || meaningful.length > 0 ? { shipments: rows } : {};
        await api(`/transportation/transport-orders/${orderId}/plan`, { method: 'POST', body });
        toast.success(`Order planned (${rows.length} shipment${rows.length > 1 ? 's' : ''})`);
      }
      showPlanForm = false;
      splitRows = [{ weightKg: '', palletCount: '' }];
      shipmentCustomData = {};
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to plan');
    }
  }

  async function load() {
    error = '';
    let detail: OrderDetail;
    try {
      [detail, orderFieldDefs] = await Promise.all([
        api<OrderDetail>(`/transportation/transport-orders/${orderId}`),
        api<CustomFieldDef[]>('/transportation/custom-fields', {
          query: { entityType: 'TRANSPORT_ORDER' },
        }).catch(() => [] as CustomFieldDef[]),
      ]);
    } catch (e) {
      error = e instanceof ApiError ? e.message : `Failed to load order — ${String(e)}`;
      return;
    }
    order = detail;
    eventsError = false;
    try {
      const lists = await Promise.all(
        detail.shipments.map((s) =>
          api<TimelineEvent[]>('/transportation/tracking/events', { query: { shipmentId: s.id } }),
        ),
      );
      events = lists.flat().sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''));
    } catch {
      events = [];
      eventsError = true;
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

  const fmtWindow = (early: string | null, late?: string | null) =>
    early
      ? new Date(early).toLocaleDateString() + (late ? ' → ' + new Date(late).toLocaleDateString() : '')
      : '—';

  function warningText(w: WindowWarning): string {
    const kindLabel = w.kind === 'BEFORE_EARLY' ? 'avant' : 'après';
    const fieldLabel = w.field === 'pickup' ? 'pickup' : 'delivery';
    const bound = w.kind === 'BEFORE_EARLY' ? 'la borne minimale' : 'la fenêtre demandée';
    return `${w.shipmentNumber} — ${fieldLabel} planifié ${kindLabel} ${bound} (demandé ${fmtDate(w.requested)}, planifié ${fmtDate(w.planned)})`;
  }

  async function openPlanForm() {
    shipmentCustomData = {};
    shipmentFieldDefs = await api<CustomFieldDef[]>('/transportation/custom-fields', {
      query: { entityType: 'SHIPMENT' },
    }).catch(() => [] as CustomFieldDef[]);
    showPlanForm = !showPlanForm;
  }

  $effect(() => {
    if (orderId) void load();
  });
</script>

{#if error}
  <p class="text-sm text-danger">{error}</p>
{:else if order}
  <PageHeader title={order.orderNumber}>
    {#snippet actions()}
      <Badge tone={toneFor(order!.status)}>{labelFor(order!.status)}</Badge>
      {#if order!.mode}
        <Badge tone="info">{order!.mode}</Badge>
      {/if}

      {#if order!.status === 'DRAFT'}
        <Button variant="primary" onclick={() => { void action('confirm'); }}>Confirm</Button>
        <Button variant="danger" onclick={() => { void action('cancel'); }}>Cancel</Button>
      {:else if order!.status === 'CONFIRMED'}
        <Button variant="primary" onclick={() => { void openPlanForm(); }}>Plan…</Button>
        <Button variant="danger" onclick={() => { void action('cancel'); }}>Cancel</Button>
      {:else if order!.status === 'PLANNED'}
        <Button variant="secondary" onclick={() => { void openPlanForm(); }}>Add shipment…</Button>
      {:else if order!.status === 'COMPLETED'}
        <Button variant="primary" onclick={() => { void action('close'); }}>Close</Button>
      {/if}
    {/snippet}
  </PageHeader>

  {#if order.windowWarnings && order.windowWarnings.length > 0}
    <div class="mb-4 flex flex-col gap-2">
      {#each order.windowWarnings as w (w.shipmentNumber + w.field + w.kind)}
        <div class="rounded-card bg-warn-soft text-warn p-3 text-sm">
          {warningText(w)}
        </div>
      {/each}
    </div>
  {/if}

  <div class="grid gap-4 lg:grid-cols-3">
    <!-- Left 2/3: Shipments + Plan form -->
    <div class="flex flex-col gap-4 lg:col-span-2">

      <!-- Plan / Add shipment card -->
      {#if showPlanForm}
        <Card>
          <h2 class="mb-1 font-semibold text-ink">
            {order.status === 'PLANNED' ? 'Add shipment' : 'Plan — split into shipments'}
          </h2>
          <p class="mb-3 text-xs text-ink-muted">
            One shipment per row. Leave a single empty row to create one shipment with the full order quantities.
          </p>
          <form onsubmit={submitPlan}>
            <div class="flex flex-col gap-2">
              {#each splitRows as row, index (index)}
                <div class="grid grid-cols-[32px_1fr_1fr_40px] items-center gap-2">
                  <span class="text-xs text-ink-muted">#{index + 1}</span>
                  <Field label="Weight (kg)">
                    <input
                      type="number"
                      min="0"
                      placeholder="Weight (kg)"
                      bind:value={row.weightKg}
                      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                    />
                  </Field>
                  <Field label="Pallets">
                    <input
                      type="number"
                      min="0"
                      placeholder="Pallets"
                      bind:value={row.palletCount}
                      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                    />
                  </Field>
                  {#if splitRows.length > 1}
                    <div class="mt-5">
                      <Button variant="danger" onclick={() => { splitRows = splitRows.filter((_, i) => i !== index); }}>✕</Button>
                    </div>
                  {:else}
                    <span></span>
                  {/if}
                </div>
              {/each}
            </div>
            {#if shipmentFieldDefs.length > 0}
              <div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
                <CustomFieldInputs definitions={shipmentFieldDefs} bind:data={shipmentCustomData} />
              </div>
            {/if}
            <div class="mt-3 flex gap-2">
              <Button
                variant="secondary"
                type="button"
                onclick={() => { splitRows = [...splitRows, { weightKg: '', palletCount: '' }]; }}
              >
                Add shipment
              </Button>
              <Button variant="primary" type="submit">
                {order.status === 'PLANNED' ? 'Add' : 'Plan order'}
              </Button>
              <Button variant="secondary" type="button" onclick={() => { showPlanForm = false; }}>Cancel</Button>
            </div>
          </form>
        </Card>
      {/if}

      <!-- Shipments card -->
      <Card>
        <h2 class="mb-3 font-semibold text-ink">Shipments</h2>
        {#if order.shipments.length === 0}
          <p class="text-sm text-ink-muted">No shipments yet — confirm then plan the order.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-edge text-xs text-ink-muted uppercase tracking-wide">
                  <th class="pb-2 text-left font-semibold">Shipment #</th>
                  <th class="pb-2 text-left font-semibold">Status</th>
                  <th class="pb-2 text-left font-semibold">Load</th>
                </tr>
              </thead>
              <tbody>
                {#each order.shipments as shipment (shipment.id)}
                  <tr class="border-b border-edge last:border-0">
                    <td class="py-2 pr-2 font-semibold">{shipment.shipmentNumber}</td>
                    <td class="py-2 pr-2">
                      <Badge tone={toneFor(shipment.status)}>{labelFor(shipment.status)}</Badge>
                    </td>
                    <td class="py-2">
                      {#if shipment.loadId}
                        <a href={`/loads/${shipment.loadId}`} class="text-accent hover:underline">View load</a>
                      {:else}
                        <a href="/shipments" class="text-accent hover:underline">Assign via Shipments</a>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </Card>

      <!-- Tracking card -->
      <Card>
        <h2 class="mb-3 font-semibold text-ink">Tracking</h2>
        {#if eventsError}
          <p class="text-sm text-warn">Tracking events unavailable — reload to retry.</p>
        {/if}
        <TrackingTimeline {events} />
      </Card>
    </div>

    <!-- Right 1/3: Summary + warnings -->
    <div class="flex flex-col gap-4">

      <!-- Summary card -->
      <Card>
        <h2 class="mb-3 font-semibold text-ink">Summary</h2>
        <dl class="flex flex-col gap-2 text-sm">
          <div class="flex items-start justify-between gap-2">
            <dt class="text-ink-muted shrink-0">Customer</dt>
            <dd class="font-medium text-right">{order.customer.name} <span class="text-xs text-ink-muted">({order.customer.code})</span></dd>
          </div>
          {#if order.customerReference}
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">Reference</dt>
              <dd class="font-medium">{order.customerReference}</dd>
            </div>
          {/if}
          <div class="flex items-start justify-between gap-2">
            <dt class="text-ink-muted shrink-0">Origin</dt>
            <dd class="font-medium text-right">{order.originLocation.name}, {order.originLocation.city}</dd>
          </div>
          <div class="flex items-start justify-between gap-2">
            <dt class="text-ink-muted shrink-0">Destination</dt>
            <dd class="font-medium text-right">{order.destinationLocation.name}, {order.destinationLocation.city}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Pickup window</dt>
            <dd class="font-medium">{fmtWindow(order.requestedPickupEarly, order.requestedPickupLate)}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Delivery window</dt>
            <dd class="font-medium">{fmtWindow(order.requestedDeliveryEarly, order.requestedDeliveryLate)}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Mode</dt>
            <dd class="font-medium">{order.mode ?? '—'}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Weight</dt>
            <dd class="font-medium">{order.totalWeightKg != null ? `${order.totalWeightKg} kg` : '—'}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Volume</dt>
            <dd class="font-medium">{order.totalVolumeM3 != null ? `${order.totalVolumeM3} m³` : '—'}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Pallets</dt>
            <dd class="font-medium">{order.palletCount ?? '—'}</dd>
          </div>
          {#if order.notes}
            <div class="flex items-start justify-between gap-2">
              <dt class="text-ink-muted shrink-0">Notes</dt>
              <dd class="font-medium text-right">{order.notes}</dd>
            </div>
          {/if}
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Created</dt>
            <dd class="font-medium">{fmtDate(order.createdAt)}</dd>
          </div>
          {#if order.customData && orderFieldDefs.length > 0}
            {#each orderFieldDefs as d (d.key)}
              {#if order.customData[d.key] !== undefined && order.customData[d.key] !== null}
                <div class="flex items-center justify-between gap-2">
                  <dt class="text-ink-muted">{d.label}</dt>
                  <dd class="font-medium">{fmtCustomValue(order.customData[d.key], d.type)}</dd>
                </div>
              {/if}
            {/each}
          {/if}
        </dl>
      </Card>

      {#if order.windowWarnings && order.windowWarnings.length > 0}
        <div class="rounded-card bg-warn-soft text-warn p-3 text-sm">
          <p class="mb-2 font-semibold">Window warnings ({order.windowWarnings.length})</p>
          <ul class="flex flex-col gap-1">
            {#each order.windowWarnings as w (w.shipmentNumber + w.field + w.kind)}
              <li>{warningText(w)}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </div>
{:else}
  <p class="text-sm text-ink-muted">Loading…</p>
{/if}
