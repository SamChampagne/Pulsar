<script lang="ts">
  import { page } from '$app/state';
  import { suggestMode, TransportMode } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import PublicShell from '$lib/components/PublicShell.svelte';
  import { Badge, Button, Card, Field, Input, Select, Textarea } from '$lib/components/ui';
  import { toneFor, labelFor } from '$lib/components/ui';
  import { formatDate } from '$lib/format';

  interface PortalView {
    shipper: string;
    customer: string;
    locations: { id: string; name: string; city: string }[];
    orders: {
      orderNumber: string;
      customerReference: string | null;
      status: string;
      requestedPickupEarly: string | null;
      requestedPickupLate: string | null;
      requestedDeliveryEarly: string | null;
      requestedDeliveryLate: string | null;
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
    requestedPickupEarly: '',
    requestedPickupLate: '',
    requestedDeliveryEarly: '',
    requestedDeliveryLate: '',
    palletCount: '',
    totalWeightKg: '',
    notes: '',
    mode: TransportMode.FTL as string,
  });

  const portalModeSuggestion = $derived(() => {
    const w = request.totalWeightKg ? Number(request.totalWeightKg) : null;
    const suggested = suggestMode(w);
    return suggested && suggested !== request.mode ? suggested : null;
  });

  const fmtWindow = (early: string | null, late?: string | null) =>
    early
      ? formatDate(early) + (late ? ' → ' + formatDate(late) : '')
      : '—';

  function fmt(value: string | null): string {
    return value ? formatDate(value) : '—';
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
          requestedPickupEarly: request.requestedPickupEarly
            ? new Date(request.requestedPickupEarly).toISOString()
            : undefined,
          requestedPickupLate: request.requestedPickupLate
            ? new Date(request.requestedPickupLate).toISOString()
            : undefined,
          requestedDeliveryEarly: request.requestedDeliveryEarly
            ? new Date(request.requestedDeliveryEarly).toISOString()
            : undefined,
          requestedDeliveryLate: request.requestedDeliveryLate
            ? new Date(request.requestedDeliveryLate).toISOString()
            : undefined,
          palletCount: request.palletCount ? Number(request.palletCount) : undefined,
          totalWeightKg: request.totalWeightKg ? Number(request.totalWeightKg) : undefined,
          notes: request.notes || undefined,
          mode: request.mode || undefined,
        },
      });
      requestNotice = `Request submitted — order ${created.orderNumber} awaits confirmation.`;
      showRequest = false;
      request = {
        originLocationId: '',
        destinationLocationId: '',
        customerReference: '',
        requestedPickupEarly: '',
        requestedPickupLate: '',
        requestedDeliveryEarly: '',
        requestedDeliveryLate: '',
        palletCount: '',
        totalWeightKg: '',
        notes: '',
        mode: TransportMode.FTL,
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

<PublicShell maxWidth="max-w-3xl">
  {#if error}
    <p class="text-sm text-danger">{error}</p>
  {:else if view}
    <p class="mb-1 text-sm text-ink-muted">Customer portal · {view.shipper}</p>
    <div class="mb-4 flex items-center justify-between gap-4">
      <h1 class="text-xl font-bold text-ink">{view.customer}</h1>
      <Button onclick={() => { showRequest = !showRequest; }}>Request a transport</Button>
    </div>

    {#if requestNotice}
      <p class="mb-4 text-sm text-ok">{requestNotice}</p>
    {/if}

    <!-- New request form -->
    {#if showRequest}
      <Card>
        <h2 class="mb-4 text-base font-semibold text-ink">New transport request</h2>
        <form onsubmit={submitRequest} class="flex flex-col gap-4">
          <!-- Route section -->
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Origin">
              <Select bind:value={request.originLocationId} required>
                <option value="" disabled>Select…</option>
                {#each view.locations as l (l.id)}
                  <option value={l.id}>{l.name} ({l.city})</option>
                {/each}
              </Select>
            </Field>
            <Field label="Destination">
              <Select bind:value={request.destinationLocationId} required>
                <option value="" disabled>Select…</option>
                {#each view.locations as l (l.id)}
                  <option value={l.id}>{l.name} ({l.city})</option>
                {/each}
              </Select>
            </Field>
          </div>

          <!-- Reference + dates section -->
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Your reference">
              <Input bind:value={request.customerReference} placeholder="PO-12345" />
            </Field>
            <Field label="Pickup from">
              <Input type="date" bind:value={request.requestedPickupEarly} />
            </Field>
            <Field label="Pickup to (optional)">
              <Input type="date" bind:value={request.requestedPickupLate} />
            </Field>
            <Field label="Delivery from">
              <Input type="date" bind:value={request.requestedDeliveryEarly} />
            </Field>
            <Field label="Delivery to (optional)">
              <Input type="date" bind:value={request.requestedDeliveryLate} />
            </Field>
          </div>

          <!-- Load section -->
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Pallets">
              <Input type="number" min="0" bind:value={request.palletCount} />
            </Field>
            <Field label="Weight (kg)">
              <Input type="number" min="0" bind:value={request.totalWeightKg} />
            </Field>
            <div>
              <Field label="Mode">
                <Select bind:value={request.mode}>
                  {#each Object.values(TransportMode) as m (m)}
                    <option value={m}>{m}</option>
                  {/each}
                </Select>
              </Field>
              {#if portalModeSuggestion()}
                <p class="mt-1 text-xs text-ink-muted">Suggested: {portalModeSuggestion()} based on weight</p>
              {/if}
            </div>
          </div>

          <Field label="Notes">
            <Textarea bind:value={request.notes} rows={2} />
          </Field>

          <div class="flex justify-end">
            <Button type="submit">Submit request</Button>
          </div>
        </form>
      </Card>
    {/if}

    <!-- Orders list -->
    {#if view.orders.length === 0}
      <p class="mt-4 text-sm text-ink-muted">No orders yet.</p>
    {:else}
      <div class="mt-2 flex flex-col divide-y divide-edge">
        {#each view.orders as order (order.orderNumber)}
          <div class="py-4">
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <strong class="text-ink">{order.orderNumber}</strong>
              {#if order.customerReference}
                <span class="text-sm text-ink-muted">ref {order.customerReference}</span>
              {/if}
              <Badge tone={toneFor(order.status)}>{labelFor(order.status)}</Badge>
            </div>
            <p class="mb-2 text-sm text-ink-muted">
              {order.originLocation.city}{order.originLocation.state ? `, ${order.originLocation.state}` : ''}
              → {order.destinationLocation.city}{order.destinationLocation.state ? `, ${order.destinationLocation.state}` : ''}
              · pickup {fmtWindow(order.requestedPickupEarly, order.requestedPickupLate)}
              · delivery {fmtWindow(order.requestedDeliveryEarly, order.requestedDeliveryLate)}
            </p>
            {#if order.shipments.length > 0}
              <table class="w-full text-sm">
                <tbody>
                  {#each order.shipments as shipment (shipment.shipmentNumber)}
                    <tr class="border-b border-edge last:border-0">
                      <td class="py-1.5 pr-3 text-ink">{shipment.shipmentNumber}</td>
                      <td class="py-1.5 pr-3">
                        <Badge tone={toneFor(shipment.status)}>{labelFor(shipment.status)}</Badge>
                      </td>
                      <td class="py-1.5 pr-3 text-ink-muted">
                        {shipment.actualDeliveryAt ? `delivered ${fmt(shipment.actualDeliveryAt)}` : ''}
                      </td>
                      <td class="py-1.5 text-right">
                        {#if shipment.trackingUrl}
                          <a href={shipment.trackingUrl} class="text-accent hover:underline">Track</a>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <p class="mt-6 text-center text-xs text-ink-faint">Powered by Pulsar</p>
  {:else}
    <p class="text-sm text-ink-muted">Loading…</p>
  {/if}
</PublicShell>
