<script lang="ts">
  import { page } from '$app/state';
  import type { Paginated } from '@pulsar/shared';
  import { TransportMode } from '@pulsar/shared';
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

  interface AccessorialOnLoad {
    id: string;
    quantity: number | null;
    accessorial: { id: string; code: string; name: string; unit: string };
  }

  interface CostLine {
    type: string;
    code?: string;
    label: string;
    amount: number;
  }

  interface AppliedBreak {
    upToKg: number;
    amount: number;
    asIfApplied: boolean;
    asIfWeightKg?: number;
  }

  interface CostDetail {
    version: number;
    computedAt: string;
    referenceDate: string;
    rate: {
      id: string;
      name: string;
      rateType: string;
      currency: string;
      baseAmount: number;
      minCharge: number | null;
      laneId: string | null;
      validFrom: string | null;
      validTo: string | null;
      validAtReference: boolean;
      breaks: unknown[];
      accessorialPrices: { code: string; amount: number }[];
      fuel: { pct: number; source: 'TABLE' | 'STATIC' | 'NONE'; tableId?: string; effectiveFrom?: string };
    };
    inputs: {
      distanceKm: number | null;
      weightKg: number | null;
      palletCount: number | null;
      accessorials: { code: string; unit: string; quantity: number }[];
    };
    result: {
      lines: CostLine[];
      base: number;
      fuelSurcharge: number;
      accessorialsTotal: number;
      total: number;
      appliedBreak: AppliedBreak | null;
      missingAccessorials: string[];
    };
  }

  interface WindowWarning {
    shipmentNumber: string;
    field: 'pickup' | 'delivery';
    kind: 'BEFORE_EARLY' | 'AFTER_LATE';
    requested: string;
    planned: string;
  }

  interface LoadDocument {
    id: string;
    fileName: string;
    createdAt: string;
  }

  interface LoadDetail {
    id: string;
    loadNumber: string;
    status: string;
    mode: string | null;
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
    accessorials: AccessorialOnLoad[];
    costDetail: CostDetail | null;
    windowWarnings?: WindowWarning[];
  }

  interface RouteDetail {
    id: string;
    totalDistanceKm: number | null;
    estimatedDurationMin: number | null;
    stops: {
      id: string;
      sequence: number;
      type: string;
      status: string;
      locationId: string;
      shipmentId: string | null;
      plannedArrivalEarly: string | null;
      plannedArrivalLate: string | null;
      actualArrivalAt: string | null;
      actualDepartureAt: string | null;
      location: { name: string; city: string };
    }[];
  }

  interface EditStop {
    type: string;
    locationId: string;
    shipmentId: string | null;
    plannedArrivalEarly: string;
    plannedArrivalLate: string;
    label: string;
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

  // Accessorials
  interface CatalogAccessorial {
    id: string;
    code: string;
    name: string;
    unit: string;
  }
  let accessorialCatalog = $state<CatalogAccessorial[]>([]);
  let accessorialChecked = $state<Record<string, boolean>>({});
  let accessorialQty = $state<Record<string, number>>({});

  // Rate comparison panel
  interface RateOption {
    rateId: string;
    rateName: string;
    currency: string;
    carrier: { id: string; code: string; name: string } | null;
    laneSpecificity: { originType: string; destinationType: string; total: number } | null;
    breakdown: {
      lines: { type: string; code?: string; label: string; amount: number }[];
      total: number;
      appliedBreak: { upToKg: number; amount: number; asIfApplied: boolean } | null;
      missingAccessorials: string[];
    };
    missingAccessorials: string[];
  }
  let rateOptions = $state<RateOption[]>([]);
  let rateOptionsOpen = $state(false);
  let rateOptionsLoading = $state(false);
  let rateOptionsError = $state('');
  let expandedRateId = $state<string | null>(null);

  interface CapacityExcess {
    axis: string;
    capacity: number;
    requested: number;
    excess: number;
  }

  // Documents
  let documents = $state<LoadDocument[]>([]);

  // Resource assignment form
  let carriers = $state<Option[]>([]);
  let drivers = $state<Option[]>([]);
  let vehicles = $state<Option[]>([]);
  let trailers = $state<Option[]>([]);
  let rates = $state<Option[]>([]);
  let form = $state({ carrierId: '', driverId: '', vehicleId: '', trailerId: '', rateId: '', mode: '' });
  let resourcesCapacityExcesses = $state<CapacityExcess[]>([]);
  let resourcesForce = $state(false);

  // POD form
  let podShipment = $state<ShipmentOnLoad | null>(null);
  let podForm = $state({ signedByName: '', notes: '' });

  // Route editor
  let editingRoute = $state(false);
  let editStops = $state<EditStop[]>([]);
  let editDistance = $state('');
  let editDuration = $state('');

  function toLocalInput(value: string | null): string {
    if (!value) return '';
    const d = new Date(value);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function startEditRoute() {
    if (!route) return;
    editStops = route.stops.map((s) => ({
      type: s.type,
      locationId: s.locationId,
      shipmentId: s.shipmentId,
      plannedArrivalEarly: toLocalInput(s.plannedArrivalEarly),
      plannedArrivalLate: toLocalInput(s.plannedArrivalLate),
      label: `${s.location.name}, ${s.location.city}`,
    }));
    editDistance = route.totalDistanceKm === null ? '' : String(route.totalDistanceKm);
    editDuration = route.estimatedDurationMin === null ? '' : String(route.estimatedDurationMin);
    editingRoute = true;
  }

  function moveStop(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= editStops.length) return;
    const next = [...editStops];
    [next[index], next[target]] = [next[target], next[index]];
    editStops = next;
  }

  async function saveRoute() {
    try {
      await api('/transportation/routes', {
        method: 'POST',
        body: {
          loadId,
          totalDistanceKm: editDistance === '' ? undefined : Number(editDistance),
          estimatedDurationMin: editDuration === '' ? undefined : Number(editDuration),
          stops: editStops.map((s, index) => ({
            sequence: index + 1,
            type: s.type,
            locationId: s.locationId,
            shipmentId: s.shipmentId ?? undefined,
            plannedArrivalEarly: s.plannedArrivalEarly
              ? new Date(s.plannedArrivalEarly).toISOString()
              : undefined,
            plannedArrivalLate: s.plannedArrivalLate
              ? new Date(s.plannedArrivalLate).toISOString()
              : undefined,
          })),
        },
      });
      toast.success('Route updated');
      editingRoute = false;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save route');
    }
  }

  const editable = $derived(detail?.status === 'OPEN' || detail?.status === 'PLANNED');
  const executing = $derived(detail?.status === 'DISPATCHED' || detail?.status === 'IN_TRANSIT');
  const canBol = $derived(
    detail?.status === 'DISPATCHED' ||
    detail?.status === 'IN_TRANSIT' ||
    detail?.status === 'COMPLETED',
  );
  /** Simple heuristic: any DELAYED event present and load not COMPLETED → show badge. */
  const isDelayed = $derived(
    detail?.status !== 'COMPLETED' &&
    detail?.status !== 'CANCELLED' &&
    events.some((e) => e.type === 'DELAYED'),
  );

  async function load() {
    try {
      detail = await api<LoadDetail>(`/transportation/loads/${loadId}`);
      form = {
        carrierId: detail.carrier?.id ?? '',
        driverId: detail.driver?.id ?? '',
        vehicleId: detail.vehicle?.id ?? '',
        trailerId: detail.trailer?.id ?? '',
        rateId: detail.rate?.id ?? '',
        mode: detail.mode ?? '',
      };
      documents = await api<LoadDocument[]>(`/transportation/loads/${loadId}/documents`);
      route = detail.route
        ? await api<RouteDetail>(`/transportation/routes/${detail.route.id}`)
        : null;
      events = await api<TimelineEvent[]>('/transportation/tracking/events', {
        query: { loadId },
      });
      tenders = await api<TenderRow[]>(`/transportation/loads/${loadId}/tenders`);
      syncAccessorialState();
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

    const catalog = await api<Paginated<CatalogAccessorial>>('/transportation/accessorials', {
      query: { pageSize: 100 },
    });
    accessorialCatalog = catalog.items;
    syncAccessorialState();
  }

  function syncAccessorialState() {
    if (!detail) return;
    const checked: Record<string, boolean> = {};
    const qty: Record<string, number> = {};
    for (const cat of accessorialCatalog) {
      const onLoad = detail.accessorials.find((a) => a.accessorial.id === cat.id);
      checked[cat.id] = !!onLoad;
      qty[cat.id] = onLoad?.quantity ?? 1;
    }
    accessorialChecked = checked;
    accessorialQty = qty;
  }

  async function saveAccessorials() {
    try {
      const items = accessorialCatalog
        .filter((cat) => accessorialChecked[cat.id])
        .map((cat) => ({
          accessorialId: cat.id,
          quantity: cat.unit === 'FLAT' ? undefined : (accessorialQty[cat.id] ?? 1),
        }));
      await api(`/transportation/loads/${loadId}/accessorials`, {
        method: 'PUT',
        body: { items },
      });
      toast.success('Accessorials updated — cost recomputed');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update accessorials');
    }
  }

  async function openRateOptions() {
    rateOptionsOpen = true;
    rateOptionsLoading = true;
    rateOptionsError = '';
    try {
      const result = await api<{ referenceDate: string; options: RateOption[] }>(
        `/transportation/loads/${loadId}/rate-options`,
      );
      rateOptions = result.options;
    } catch (e) {
      rateOptionsError = e instanceof ApiError ? e.message : 'Failed to load rate options';
    } finally {
      rateOptionsLoading = false;
    }
  }

  async function assignRate(rateId: string) {
    try {
      await api(`/transportation/loads/${loadId}/assign`, {
        method: 'POST',
        body: { rateId },
      });
      toast.success('Rate assigned');
      rateOptionsOpen = false;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to assign rate');
    }
  }

  async function saveResources() {
    try {
      const resp = await api<{ modeWarning?: { loadMode: string; orderMode: string } }>(
        `/transportation/loads/${loadId}/assign`,
        {
          method: 'POST',
          body: {
            carrierId: form.carrierId || undefined,
            driverId: form.driverId || undefined,
            vehicleId: form.vehicleId || undefined,
            trailerId: form.trailerId || undefined,
            rateId: form.rateId || undefined,
            mode: form.mode || undefined,
            ...(resourcesForce ? { force: true } : {}),
          },
        },
      );
      if (resp?.modeWarning) {
        const { loadMode, orderMode } = resp.modeWarning;
        toast.error(`Mode mismatch: load ${loadMode} / order ${orderMode} — assigned anyway`);
      }
      toast.success('Resources assigned');
      resourcesCapacityExcesses = [];
      resourcesForce = false;
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 400) {
        const body = e.body as { excesses?: CapacityExcess[] } | null;
        if (body?.excesses?.length) {
          resourcesCapacityExcesses = body.excesses;
          return;
        }
      }
      toast.error(e instanceof ApiError ? e.message : 'Failed to assign resources');
    }
  }

  async function generateBol() {
    try {
      await api(`/transportation/loads/${loadId}/bol`, { method: 'POST' });
      toast.success('BOL generated');
      documents = await api<LoadDocument[]>(`/transportation/loads/${loadId}/documents`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to generate BOL');
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
      {#if detail.mode}
        <span class="badge-mode">{detail.mode}</span>
      {/if}
      {#if isDelayed}
        <span class="badge-delayed">Delayed</span>
      {/if}
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
        <div class="field">
          <label for="load-mode">Mode</label>
          <select id="load-mode" bind:value={form.mode} disabled={!editable}>
            <option value="">— inherit —</option>
            {#each Object.values(TransportMode) as m (m)}
              <option value={m}>{m}</option>
            {/each}
          </select>
        </div>
        {#if editable}
          <button class="btn" onclick={saveResources}>Save resources</button>
        {/if}

        {#if resourcesCapacityExcesses.length > 0}
          <div class="capacity-alert">
            <strong>Trailer capacity exceeded</strong>
            <table class="breakdown-table" style="margin-top: 6px;">
              <thead>
                <tr>
                  <th style="text-align: left; font-size: 12px;">Axis</th>
                  <th style="text-align: right; font-size: 12px;">Capacity</th>
                  <th style="text-align: right; font-size: 12px;">Requested</th>
                  <th style="text-align: right; font-size: 12px;">Excess</th>
                </tr>
              </thead>
              <tbody>
                {#each resourcesCapacityExcesses as ex (ex.axis)}
                  <tr>
                    <td style="font-size: 12px;">{ex.axis}</td>
                    <td style="text-align: right; font-size: 12px;">{ex.capacity}</td>
                    <td style="text-align: right; font-size: 12px;">{ex.requested}</td>
                    <td style="text-align: right; font-size: 12px; color: var(--color-danger, #dc3545);">+{ex.excess}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
            {#if editable}
              <label style="display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 13px; cursor: pointer;">
                <input type="checkbox" bind:checked={resourcesForce} />
                Force assignment (audited)
              </label>
              {#if resourcesForce}
                <button class="btn btn-danger" style="margin-top: 6px;" onclick={saveResources}>
                  Confirm force assign
                </button>
              {/if}
            {/if}
          </div>
        {/if}

        {#if detail.estimatedCost !== null}
          <p style="margin-bottom: 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <span class="muted">Estimated cost:</span>
            <strong>{Number(detail.estimatedCost).toLocaleString()} {detail.costCurrency}</strong>
            {#if editable}
              <button class="btn btn-secondary btn-sm" onclick={openRateOptions}>
                Compare rates
              </button>
            {/if}
          </p>
        {:else if editable}
          <p style="margin-bottom: 0;">
            <button class="btn btn-secondary btn-sm" onclick={openRateOptions}>
              Compare rates
            </button>
          </p>
        {/if}

        {#if rateOptionsOpen}
          <div class="rate-options-panel">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <strong>Rate options</strong>
              <button class="btn btn-secondary btn-sm" onclick={() => (rateOptionsOpen = false)}>
                Close
              </button>
            </div>
            {#if rateOptionsLoading}
              <p class="muted">Loading…</p>
            {:else if rateOptionsError}
              <p class="error-text">{rateOptionsError}</p>
            {:else if rateOptions.length === 0}
              <p class="muted">No rate options available.</p>
            {:else}
              {@const firstCompleteByCurrency = (() => {
                const seen = new Set<string>();
                const result = new Set<string>();
                for (const opt of rateOptions) {
                  if (opt.missingAccessorials.length === 0 && !seen.has(opt.currency)) {
                    seen.add(opt.currency);
                    result.add(opt.rateId);
                  }
                }
                return result;
              })()}
              <table class="rate-options-table">
                <thead>
                  <tr>
                    <th>Rate</th>
                    <th>Carrier</th>
                    <th>Lane</th>
                    <th>Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {#each rateOptions as opt (opt.rateId)}
                    <tr
                      class="rate-options-row"
                      onclick={() =>
                        (expandedRateId = expandedRateId === opt.rateId ? null : opt.rateId)}
                    >
                      <td>
                        {opt.rateName}
                        {#if firstCompleteByCurrency.has(opt.rateId)}
                          <span class="badge badge-success" style="margin-left: 4px;">best</span>
                        {/if}
                      </td>
                      <td>{opt.carrier?.name ?? '—'}</td>
                      <td class="muted" style="font-size: 12px;">
                        {opt.laneSpecificity
                          ? `${opt.laneSpecificity.originType}→${opt.laneSpecificity.destinationType} (${opt.laneSpecificity.total})`
                          : 'catch-all'}
                      </td>
                      <td>
                        <strong>{opt.breakdown.total.toLocaleString()} {opt.currency}</strong>
                        {#if opt.missingAccessorials.length > 0}
                          <span class="badge badge-warn" style="margin-left: 4px;">
                            missing: {opt.missingAccessorials.length}
                          </span>
                        {/if}
                      </td>
                      <td style="text-align: right;" onclick={(e) => e.stopPropagation()}>
                        <button class="btn btn-sm" onclick={() => assignRate(opt.rateId)}>
                          Assign
                        </button>
                      </td>
                    </tr>
                    {#if expandedRateId === opt.rateId}
                      <tr class="rate-breakdown-row">
                        <td colspan="5">
                          <table class="breakdown-table">
                            <tbody>
                              {#each opt.breakdown.lines as line}
                                <tr>
                                  <td class="muted" style="font-size: 12px;">{line.label}</td>
                                  <td style="text-align: right; font-size: 12px;">
                                    {line.amount.toLocaleString()} {opt.currency}
                                  </td>
                                </tr>
                              {/each}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    {/if}
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>
        {/if}

        {#if detail.costDetail}
          {@const cd = detail.costDetail}
          <div class="cost-snapshot">
            <div class="cost-snapshot-header">
              <span class="muted" style="font-size: 12px;">
                Cost snapshot — ref. {new Date(cd.referenceDate).toLocaleDateString()}
              </span>
              {#if !cd.rate.validAtReference}
                <span class="badge badge-warn">rate outside validity window at reference date</span>
              {/if}
            </div>
            <table class="breakdown-table">
              <tbody>
                {#each cd.result.lines as line}
                  <tr>
                    <td style="font-size: 13px;">{line.label}</td>
                    <td style="text-align: right; font-size: 13px;">
                      {line.amount.toLocaleString()} {cd.rate.currency}
                    </td>
                  </tr>
                {/each}
                <tr>
                  <td><strong>Total</strong></td>
                  <td style="text-align: right;">
                    <strong>{cd.result.total.toLocaleString()} {cd.rate.currency}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
            {#if cd.result.appliedBreak}
              {@const br = cd.result.appliedBreak}
              <p style="font-size: 12px; margin: 4px 0;">
                <span class="muted">Break applied:</span>
                ≤ {br.upToKg} kg @ {br.amount} $/CWT
                {#if br.asIfApplied}
                  <span class="badge badge-warn">as-if</span>
                {/if}
              </p>
            {/if}
            <p style="font-size: 12px; margin: 4px 0;">
              <span class="muted">Fuel:</span>
              {cd.rate.fuel.pct}% — {cd.rate.fuel.source}
              {#if cd.rate.fuel.source === 'TABLE' && cd.rate.fuel.effectiveFrom}
                <span class="muted">(eff. {new Date(cd.rate.fuel.effectiveFrom).toLocaleDateString()})</span>
              {/if}
            </p>
            {#if cd.result.missingAccessorials.length > 0}
              <p class="error-text" style="font-size: 12px; margin: 4px 0;">
                Missing accessorials: {cd.result.missingAccessorials.join(', ')}
              </p>
            {/if}
          </div>
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
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin-top: 0;">Route</h2>
          {#if route && editable && !editingRoute}
            <button class="btn btn-secondary btn-sm" onclick={startEditRoute}>Edit route</button>
          {/if}
        </div>
        {#if editingRoute}
          <div class="route-meta">
            <div class="field">
              <label for="distance">Distance (km)</label>
              <input id="distance" type="number" min="0" bind:value={editDistance} />
            </div>
            <div class="field">
              <label for="duration">Duration (min)</label>
              <input id="duration" type="number" min="0" bind:value={editDuration} />
            </div>
          </div>
          {#each editStops as stop, index (index)}
            <div class="edit-stop">
              <span class="muted">#{index + 1} {stop.type}</span>
              <span>{stop.label}</span>
              <div class="arrival-window">
                <span class="arrival-label">Arrival from</span>
                <input type="datetime-local" bind:value={stop.plannedArrivalEarly} />
                <span class="arrival-label">to</span>
                <input type="datetime-local" bind:value={stop.plannedArrivalLate} />
              </div>
              <span class="row-actions">
                <button class="btn btn-secondary btn-sm" type="button" onclick={() => moveStop(index, -1)}>↑</button>
                <button class="btn btn-secondary btn-sm" type="button" onclick={() => moveStop(index, 1)}>↓</button>
              </span>
            </div>
          {/each}
          <div style="display: flex; gap: 8px; margin-top: 10px;">
            <button class="btn" onclick={saveRoute}>Save route</button>
            <button class="btn btn-secondary" onclick={() => (editingRoute = false)}>Cancel</button>
          </div>
        {:else if route}
          <table>
            <thead>
              <tr><th>#</th><th>Type</th><th>Location</th><th>Arrival window</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {#each route.stops as stop (stop.id)}
                <tr>
                  <td>{stop.sequence}</td>
                  <td>{stop.type}</td>
                  <td>{stop.location.name}, {stop.location.city}</td>
                  <td class="muted" style="font-size: 12px;">
                    {#if stop.plannedArrivalEarly}
                      {new Date(stop.plannedArrivalEarly).toLocaleString()}{stop.plannedArrivalLate ? ' → ' + new Date(stop.plannedArrivalLate).toLocaleString() : ''}
                    {:else}
                      —
                    {/if}
                  </td>
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

      <div class="card">
        <h2 style="margin-top: 0;">Accessorials</h2>
        {#if accessorialCatalog.length === 0}
          <p class="muted">No accessorials configured.</p>
        {:else}
          <table>
            <thead>
              <tr><th></th><th>Code</th><th>Name</th><th>Qty</th><th>Unit</th></tr>
            </thead>
            <tbody>
              {#each accessorialCatalog as cat (cat.id)}
                <tr>
                  <td>
                    <input
                      type="checkbox"
                      checked={accessorialChecked[cat.id] ?? false}
                      disabled={detail.status === 'COMPLETED' || detail.status === 'CANCELLED'}
                      onchange={(e) => {
                        accessorialChecked = {
                          ...accessorialChecked,
                          [cat.id]: (e.currentTarget as HTMLInputElement).checked,
                        };
                      }}
                    />
                  </td>
                  <td class="muted" style="font-size: 12px;">{cat.code}</td>
                  <td>{cat.name}</td>
                  <td>
                    <input
                      type="number"
                      min="1"
                      style="width: 60px;"
                      value={accessorialQty[cat.id] ?? 1}
                      disabled={cat.unit === 'FLAT' ||
                        !(accessorialChecked[cat.id] ?? false) ||
                        detail.status === 'COMPLETED' ||
                        detail.status === 'CANCELLED'}
                      oninput={(e) => {
                        const v = Number((e.currentTarget as HTMLInputElement).value);
                        if (!isNaN(v) && v > 0) {
                          accessorialQty = { ...accessorialQty, [cat.id]: v };
                        }
                      }}
                    />
                  </td>
                  <td class="muted" style="font-size: 12px;">{cat.unit}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if detail.status !== 'COMPLETED' && detail.status !== 'CANCELLED'}
            <button class="btn" style="margin-top: 8px;" onclick={saveAccessorials}>
              Save accessorials
            </button>
          {/if}
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

      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin-top: 0;">Documents</h2>
          {#if canBol}
            <button class="btn btn-secondary btn-sm" onclick={generateBol}>Generate BOL</button>
          {/if}
        </div>
        {#if documents.length === 0}
          <p class="muted">No documents yet.</p>
        {:else}
          <table>
            <thead>
              <tr><th>File</th><th>Date</th><th></th></tr>
            </thead>
            <tbody>
              {#each documents as doc (doc.id)}
                <tr>
                  <td>{doc.fileName}</td>
                  <td class="muted" style="font-size: 12px;">{new Date(doc.createdAt).toLocaleString()}</td>
                  <td style="text-align: right;">
                    <a href={`/api/v1/documents/${doc.id}/download`} target="_blank" class="btn btn-secondary btn-sm">Download</a>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </div>
  </div>

  {#if detail.windowWarnings && detail.windowWarnings.length > 0}
    <div class="card" style="margin-top: 16px; border-left: 3px solid var(--color-warning, #f59e0b);">
      <h2 style="margin-top: 0;">
        ⚠ Avertissements de fenêtre
        <span class="badge-warning">{detail.windowWarnings.length}</span>
      </h2>
      <ul style="margin: 0; padding-left: 20px;">
        {#each detail.windowWarnings as w (w.shipmentNumber + w.field + w.kind)}
          <li style="margin-bottom: 6px;">
            {w.shipmentNumber} — {w.field === 'pickup' ? 'pickup' : 'delivery'} planifié {w.kind === 'BEFORE_EARLY' ? 'avant' : 'après'} la fenêtre demandée
            (demandé {new Date(w.requested).toLocaleDateString()}, planifié {new Date(w.planned).toLocaleDateString()})
          </li>
        {/each}
      </ul>
    </div>
  {/if}
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

  .route-meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 16px;
  }

  .edit-stop {
    display: grid;
    grid-template-columns: 90px 1fr auto 80px;
    gap: 8px;
    align-items: center;
    padding: 6px 0;
    border-bottom: 1px solid var(--color-border);
    font-size: 13px;
  }

  .arrival-window {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .arrival-label {
    font-size: 11px;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .capacity-alert {
    margin-top: 10px;
    padding: 10px 12px;
    background: #fff3cd;
    border: 1px solid #ffc107;
    border-radius: 6px;
  }

  .badge-warning {
    display: inline-block;
    background: var(--color-warning, #f59e0b);
    color: #fff;
    border-radius: 10px;
    padding: 1px 8px;
    font-size: 12px;
    font-weight: 600;
    margin-left: 8px;
  }

  .row-actions {
    display: flex;
    gap: 4px;
  }

  .rate-options-panel {
    margin-top: 12px;
    padding: 12px;
    background: var(--color-surface, #f8f9fa);
    border: 1px solid var(--color-border);
    border-radius: 6px;
  }

  .rate-options-table {
    width: 100%;
    font-size: 13px;
  }

  .rate-options-row {
    cursor: pointer;
  }

  .rate-options-row:hover td {
    background: var(--color-hover, rgba(0, 0, 0, 0.03));
  }

  .rate-breakdown-row td {
    padding: 4px 8px 8px;
    background: var(--color-surface, #f8f9fa);
  }

  .breakdown-table {
    width: 100%;
    font-size: 12px;
    border-collapse: collapse;
  }

  .breakdown-table td {
    padding: 2px 4px;
  }

  .cost-snapshot {
    margin-top: 12px;
    padding: 10px;
    background: var(--color-surface, #f8f9fa);
    border: 1px solid var(--color-border);
    border-radius: 6px;
  }

  .cost-snapshot-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }

  .badge-warn {
    background: #fff3cd;
    color: #856404;
    border: 1px solid #ffc107;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11px;
  }

  .badge-mode {
    background: #e0e7ff;
    color: #3730a3;
    border: 1px solid #c7d2fe;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
  }

  .badge-delayed {
    background: #fee2e2;
    color: #b91c1c;
    border: 1px solid #fca5a5;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
  }
</style>
