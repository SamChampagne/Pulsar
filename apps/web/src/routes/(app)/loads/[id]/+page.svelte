<script lang="ts">
  import { page } from '$app/state';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import TrackingTimeline, { type TimelineEvent } from '$lib/components/TrackingTimeline.svelte';
  import { toast } from '$lib/stores/toast';

  interface ShipmentOnLoad {
    id: string;
    shipmentNumber: string;
    status: string;
    transportOrderId: string;
    originLocationId: string;
    destinationLocationId: string;
    proofOfDelivery: { id: string; signedByName: string | null; signedAt: string } | null;
  }

  interface TenderRow {
    id: string;
    status: string;
    token: string;
    message: string | null;
    declineReason: string | null;
    sentAt: string;
    expiresAt: string;
    carrier: { id: string; name: string };
  }

  interface LoadDetail {
    id: string;
    loadNumber: string;
    status: string;
    notes: string | null;
    estimatedCost: string | null;
    costCurrency: string | null;
    dispatchedAt: string | null;
    completedAt: string | null;
    carrier: { id: string; name: string } | null;
    driver: { id: string; firstName: string; lastName: string } | null;
    vehicle: { id: string; unitNumber: string } | null;
    trailer: { id: string; unitNumber: string } | null;
    rate: { id: string; name: string } | null;
    shipments: ShipmentOnLoad[];
    route: { id: string } | null;
  }

  interface RouteDetail {
    id: string;
    stops: {
      id: string;
      sequence: number;
      type: string;
      status: string;
      plannedArrivalAt: string | null;
      actualArrivalAt: string | null;
      actualDepartureAt: string | null;
      location: { name: string; city: string };
    }[];
  }

  interface Option {
    id: string;
    name?: string;
    code?: string;
    unitNumber?: string;
    firstName?: string;
    lastName?: string;
  }

  const loadId = $derived(page.params.id);

  let detail = $state<LoadDetail | null>(null);
  let route = $state<RouteDetail | null>(null);
  let events = $state<TimelineEvent[]>([]);
  let tenders = $state<TenderRow[]>([]);
  let error = $state('');

  const latestTender = $derived(tenders[0] ?? null);

  // Resource assignment form
  let carriers = $state<Option[]>([]);
  let drivers = $state<Option[]>([]);
  let vehicles = $state<Option[]>([]);
  let trailers = $state<Option[]>([]);
  let rates = $state<Option[]>([]);
  let form = $state({ carrierId: '', driverId: '', vehicleId: '', trailerId: '', rateId: '' });

  // POD form
  let podShipment = $state<ShipmentOnLoad | null>(null);
  let podForm = $state({ signedByName: '', notes: '' });

  const editable = $derived(detail?.status === 'OPEN' || detail?.status === 'PLANNED');
  const executing = $derived(detail?.status === 'DISPATCHED' || detail?.status === 'IN_TRANSIT');

  async function load() {
    try {
      detail = await api<LoadDetail>(`/transportation/loads/${loadId}`);
      form = {
        carrierId: detail.carrier?.id ?? '',
        driverId: detail.driver?.id ?? '',
        vehicleId: detail.vehicle?.id ?? '',
        trailerId: detail.trailer?.id ?? '',
        rateId: detail.rate?.id ?? '',
      };
      route = detail.route
        ? await api<RouteDetail>(`/transportation/routes/${detail.route.id}`)
        : null;
      events = await api<TimelineEvent[]>('/transportation/tracking/events', {
        query: { loadId },
      });
      tenders = await api<TenderRow[]>(`/transportation/loads/${loadId}/tenders`);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load';
    }
  }

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard`);
    } catch {
      toast.error('Could not copy — link: ' + text);
    }
  }

  async function sendTender() {
    try {
      const tender = await api<TenderRow & { responseUrl: string; emailedTo: string | null }>(
        `/transportation/loads/${loadId}/tender`,
        { method: 'POST', body: { carrierId: form.carrierId || undefined } },
      );
      if (tender.emailedTo) toast.success(`Tender emailed to ${tender.emailedTo}`);
      await copyToClipboard(tender.responseUrl, 'Tender link');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to send tender');
    }
  }

  async function autoTender() {
    try {
      const tender = await api<TenderRow & { emailedTo: string | null }>(
        `/transportation/loads/${loadId}/auto-tender`,
        { method: 'POST', body: {} },
      );
      toast.success(
        `Auto-tender started — offered to ${tender.carrier.name}` +
          (tender.emailedTo ? ` (emailed to ${tender.emailedTo})` : ''),
      );
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to auto-tender');
    }
  }

  async function cancelTender() {
    try {
      await api(`/transportation/loads/${loadId}/cancel-tender`, { method: 'POST' });
      toast.success('Tender cancelled');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to cancel tender');
    }
  }

  async function driverLink() {
    try {
      const { url } = await api<{ url: string }>(`/transportation/loads/${loadId}/driver-link`, {
        method: 'POST',
      });
      await copyToClipboard(url, 'Driver link');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create driver link');
    }
  }

  async function loadResourceOptions() {
    const [c, d, v, t, r] = await Promise.all([
      api<Paginated<Option>>('/transportation/carriers', { query: { pageSize: 100 } }),
      api<Paginated<Option>>('/transportation/drivers', { query: { pageSize: 100 } }),
      api<Paginated<Option>>('/transportation/vehicles', { query: { pageSize: 100 } }),
      api<Paginated<Option>>('/transportation/trailers', { query: { pageSize: 100 } }),
      api<Paginated<Option>>('/transportation/rates', { query: { pageSize: 100 } }),
    ]);
    carriers = c.items;
    drivers = d.items;
    vehicles = v.items;
    trailers = t.items;
    rates = r.items;
  }

  async function saveResources() {
    try {
      await api(`/transportation/loads/${loadId}/assign`, {
        method: 'POST',
        body: {
          carrierId: form.carrierId || undefined,
          driverId: form.driverId || undefined,
          vehicleId: form.vehicleId || undefined,
          trailerId: form.trailerId || undefined,
          rateId: form.rateId || undefined,
        },
      });
      toast.success('Resources assigned');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to assign resources');
    }
  }

  async function action(name: 'dispatch' | 'start-transit' | 'complete' | 'cancel') {
    try {
      await api(`/transportation/loads/${loadId}/${name}`, { method: 'POST' });
      toast.success(`Load ${name.replace('-', ' ')} done`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : `Failed to ${name}`);
    }
  }

  /** Builds a simple route: all pickups (order of shipments) then all deliveries. */
  async function generateRoute() {
    if (!detail) return;
    const stops = [
      ...detail.shipments.map((s, i) => ({
        sequence: i + 1,
        type: 'PICKUP',
        locationId: s.originLocationId,
        shipmentId: s.id,
      })),
      ...detail.shipments.map((s, i) => ({
        sequence: detail!.shipments.length + i + 1,
        type: 'DELIVERY',
        locationId: s.destinationLocationId,
        shipmentId: s.id,
      })),
    ];
    try {
      await api('/transportation/routes', { method: 'POST', body: { loadId, stops } });
      toast.success('Route generated');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to generate route');
    }
  }

  async function stopAction(stopId: string, status: 'ARRIVED' | 'DEPARTED') {
    try {
      await api(`/transportation/routes/stops/${stopId}/status`, {
        method: 'POST',
        body: { status },
      });
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update stop');
    }
  }

  async function capturePod() {
    if (!podShipment) return;
    try {
      await api('/transportation/tracking/pod', {
        method: 'POST',
        body: {
          shipmentId: podShipment.id,
          signedByName: podForm.signedByName || undefined,
          notes: podForm.notes || undefined,
        },
      });
      toast.success(`POD captured for ${podShipment.shipmentNumber}`);
      podShipment = null;
      podForm = { signedByName: '', notes: '' };
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to capture POD');
    }
  }

  $effect(() => {
    if (loadId) {
      void load();
      void loadResourceOptions();
    }
  });
</script>

{#if error}
  <p class="error-text">{error}</p>
{:else if detail}
  <div class="page-header">
    <div style="display: flex; align-items: center; gap: 12px;">
      <a href="/loads" class="muted">← Loads</a>
      <h1>{detail.loadNumber}</h1>
      <StatusBadge status={detail.status} />
    </div>
    <div style="display: flex; gap: 8px;">
      {#if detail.status === 'PLANNED'}
        <button class="btn btn-secondary" onclick={autoTender}>Auto-tender (lane)</button>
        <button class="btn btn-secondary" onclick={sendTender}>Tender to carrier</button>
        <button class="btn" onclick={() => action('dispatch')}>Dispatch</button>
        <button class="btn btn-danger" onclick={() => action('cancel')}>Cancel</button>
      {:else if detail.status === 'TENDERED'}
        {#if latestTender?.status === 'ACCEPTED'}
          <button class="btn" onclick={() => action('dispatch')}>Dispatch</button>
        {/if}
        {#if latestTender?.status === 'PENDING'}
          <button class="btn btn-secondary" onclick={cancelTender}>Cancel tender</button>
        {/if}
        <button class="btn btn-danger" onclick={() => action('cancel')}>Cancel load</button>
      {:else if detail.status === 'DISPATCHED'}
        <button class="btn" onclick={() => action('start-transit')}>Start transit</button>
        <button class="btn btn-danger" onclick={() => action('cancel')}>Cancel</button>
      {:else if detail.status === 'IN_TRANSIT'}
        <button class="btn" onclick={() => action('complete')}>Complete (delivered)</button>
      {/if}
      {#if ['PLANNED', 'TENDERED', 'DISPATCHED', 'IN_TRANSIT'].includes(detail.status)}
        <button class="btn btn-secondary" onclick={driverLink}>Driver link</button>
      {/if}
    </div>
  </div>

  <div class="detail-grid">
    <div class="column">
      <div class="card">
        <h2 style="margin-top: 0;">Resources</h2>
        <div class="field">
          <label for="carrier">Carrier</label>
          <select id="carrier" bind:value={form.carrierId} disabled={!editable}>
            <option value="">—</option>
            {#each carriers as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label for="driver">Driver</label>
          <select id="driver" bind:value={form.driverId} disabled={!editable}>
            <option value="">—</option>
            {#each drivers as o (o.id)}<option value={o.id}>{o.firstName} {o.lastName}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label for="vehicle">Vehicle</label>
          <select id="vehicle" bind:value={form.vehicleId} disabled={!editable}>
            <option value="">—</option>
            {#each vehicles as o (o.id)}<option value={o.id}>{o.unitNumber}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label for="trailer">Trailer</label>
          <select id="trailer" bind:value={form.trailerId} disabled={!editable}>
            <option value="">—</option>
            {#each trailers as o (o.id)}<option value={o.id}>{o.unitNumber}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label for="rate">Rate</label>
          <select id="rate" bind:value={form.rateId} disabled={!editable}>
            <option value="">—</option>
            {#each rates as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
          </select>
        </div>
        {#if editable}
          <button class="btn" onclick={saveResources}>Save resources</button>
        {/if}
        {#if detail.estimatedCost !== null}
          <p style="margin-bottom: 0;">
            <span class="muted">Estimated cost:</span>
            <strong>{Number(detail.estimatedCost).toLocaleString()} {detail.costCurrency}</strong>
          </p>
        {/if}
      </div>

      {#if latestTender}
        <div class="card">
          <h2 style="margin-top: 0;">Tender</h2>
          <p style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <StatusBadge status={latestTender.status} />
            <span>{latestTender.carrier.name}</span>
            <span class="muted">
              expires {new Date(latestTender.expiresAt).toLocaleString()}
            </span>
          </p>
          {#if latestTender.declineReason}
            <p class="error-text">Declined: {latestTender.declineReason}</p>
          {/if}
          {#if latestTender.status === 'PENDING'}
            <button
              class="btn btn-secondary btn-sm"
              onclick={() =>
                copyToClipboard(`${location.origin}/tender/${latestTender.token}`, 'Tender link')}
            >
              Copy carrier link
            </button>
          {/if}
        </div>
      {/if}

      <div class="card">
        <h2 style="margin-top: 0;">Route</h2>
        {#if route}
          <table>
            <thead>
              <tr><th>#</th><th>Type</th><th>Location</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {#each route.stops as stop (stop.id)}
                <tr>
                  <td>{stop.sequence}</td>
                  <td>{stop.type}</td>
                  <td>{stop.location.name}, {stop.location.city}</td>
                  <td><StatusBadge status={stop.status} /></td>
                  <td style="white-space: nowrap; text-align: right;">
                    {#if executing && stop.status === 'PENDING'}
                      <button class="btn btn-sm" onclick={() => stopAction(stop.id, 'ARRIVED')}>
                        Arrive
                      </button>
                    {:else if executing && stop.status === 'ARRIVED'}
                      <button class="btn btn-sm" onclick={() => stopAction(stop.id, 'DEPARTED')}>
                        Depart
                      </button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else if editable && detail.shipments.length > 0}
          <p class="muted">No route yet.</p>
          <button class="btn btn-secondary" onclick={generateRoute}>
            Generate route from shipments
          </button>
        {:else}
          <p class="muted">No route. Add shipments first.</p>
        {/if}
      </div>
    </div>

    <div class="column">
      <div class="card">
        <h2 style="margin-top: 0;">Shipments</h2>
        {#if detail.shipments.length === 0}
          <p class="muted">
            Empty load — assign shipments from the <a href="/shipments">Shipments</a> page.
          </p>
        {:else}
          <table>
            <thead>
              <tr><th>Shipment #</th><th>Status</th><th>POD</th><th></th></tr>
            </thead>
            <tbody>
              {#each detail.shipments as shipment (shipment.id)}
                <tr>
                  <td>
                    <a href={`/transport-orders/${shipment.transportOrderId}`}>
                      <strong>{shipment.shipmentNumber}</strong>
                    </a>
                  </td>
                  <td><StatusBadge status={shipment.status} /></td>
                  <td>
                    {#if shipment.proofOfDelivery}
                      <span class="badge badge-success">
                        {shipment.proofOfDelivery.signedByName ?? 'Signed'}
                      </span>
                    {:else}
                      <span class="muted">—</span>
                    {/if}
                  </td>
                  <td style="text-align: right;">
                    {#if !shipment.proofOfDelivery && (shipment.status === 'IN_TRANSIT' || shipment.status === 'DELIVERED')}
                      <button class="btn btn-sm" onclick={() => (podShipment = shipment)}>
                        Capture POD
                      </button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}

        {#if podShipment}
          <div class="pod-form">
            <h2>POD — {podShipment.shipmentNumber}</h2>
            <div class="field">
              <label for="signedBy">Signed by</label>
              <input id="signedBy" bind:value={podForm.signedByName} placeholder="Receiver name" />
            </div>
            <div class="field">
              <label for="podNotes">Notes</label>
              <textarea id="podNotes" rows="2" bind:value={podForm.notes}></textarea>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn" onclick={capturePod}>Save POD</button>
              <button class="btn btn-secondary" onclick={() => (podShipment = null)}>Cancel</button>
            </div>
          </div>
        {/if}
      </div>

      <div class="card">
        <h2 style="margin-top: 0;">Tracking</h2>
        <TrackingTimeline {events} />
      </div>
    </div>
  </div>
{:else}
  <p class="muted">Loading…</p>
{/if}

<style>
  .detail-grid {
    display: grid;
    grid-template-columns: 1fr 1.2fr;
    gap: 16px;
    align-items: start;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .pod-form {
    border-top: 1px solid var(--color-border);
    margin-top: 14px;
    padding-top: 6px;
  }
</style>
