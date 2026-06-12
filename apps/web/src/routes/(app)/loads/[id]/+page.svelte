<script lang="ts">
  import { page } from '$app/state';
  import type { Paginated } from '@pulsar/shared';
  import { TransportMode } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge, Button, Card, Field, PageHeader, Select,
    toneFor, labelFor,
  } from '$lib/components/ui';
  import TrackingTimeline, { type TimelineEvent } from '$lib/components/TrackingTimeline.svelte';
  import LoadMap from '$lib/components/LoadMap.svelte';
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
    distanceSource: 'MANUAL' | 'OSRM' | 'HAVERSINE' | null;
    geometry: unknown;
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
  let auxError = $state(false);

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
    } catch (e) {
      error = e instanceof ApiError ? e.message : `Failed to load — ${String(e)}`;
      return;
    }
    auxError = false;
    const [docsR, routeR, eventsR, tendersR] = await Promise.allSettled([
      api<LoadDocument[]>(`/transportation/loads/${loadId}/documents`),
      detail.route ? api<RouteDetail>(`/transportation/routes/${detail.route.id}`) : Promise.resolve(null),
      api<TimelineEvent[]>('/transportation/tracking/events', { query: { loadId } }),
      api<TenderRow[]>(`/transportation/loads/${loadId}/tenders`),
    ]);
    documents = docsR.status === 'fulfilled' ? docsR.value : [];
    route = routeR.status === 'fulfilled' ? routeR.value : null;
    events = eventsR.status === 'fulfilled' ? eventsR.value : [];
    tenders = tendersR.status === 'fulfilled' ? tendersR.value : [];
    auxError = [docsR, routeR, eventsR, tendersR].some((r) => r.status === 'rejected');
    syncAccessorialState();
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

  // Derive map stops from route for LoadMap
  const mapStops = $derived(
    route?.stops.map((s) => ({ sequence: s.sequence, locationId: s.locationId, type: s.type })) ?? [],
  );
</script>

{#if error}
  <p class="text-sm text-danger">{error}</p>
{:else if detail}
  <!-- Page header with title + status badge + action buttons -->
  <PageHeader title={detail.loadNumber}>
    {#snippet actions()}
      <Badge tone={toneFor(detail!.status)}>{labelFor(detail!.status)}</Badge>
      {#if detail!.mode}
        <Badge tone="info">{detail!.mode}</Badge>
      {/if}
      {#if isDelayed}
        <Badge tone="danger">Delayed</Badge>
      {/if}

      {#if detail!.status === 'PLANNED'}
        <Button variant="secondary" onclick={autoTender}>Auto-tender (lane)</Button>
        <Button variant="secondary" onclick={sendTender}>Tender to carrier</Button>
        <Button variant="primary" onclick={() => action('dispatch')}>Dispatch</Button>
        <Button variant="danger" onclick={() => action('cancel')}>Cancel</Button>
      {:else if detail!.status === 'TENDERED'}
        {#if latestTender?.status === 'ACCEPTED'}
          <Button variant="primary" onclick={() => action('dispatch')}>Dispatch</Button>
        {/if}
        {#if latestTender?.status === 'PENDING'}
          <Button variant="secondary" onclick={cancelTender}>Cancel tender</Button>
        {/if}
        <Button variant="danger" onclick={() => action('cancel')}>Cancel load</Button>
      {:else if detail!.status === 'DISPATCHED'}
        <Button variant="primary" onclick={() => action('start-transit')}>Start transit</Button>
        <Button variant="danger" onclick={() => action('cancel')}>Cancel</Button>
      {:else if detail!.status === 'IN_TRANSIT'}
        <Button variant="primary" onclick={() => action('complete')}>Complete (delivered)</Button>
      {/if}
      {#if ['PLANNED', 'TENDERED', 'DISPATCHED', 'IN_TRANSIT'].includes(detail!.status)}
        <Button variant="secondary" onclick={driverLink}>Driver link</Button>
      {/if}
    {/snippet}
  </PageHeader>

  <!-- Window warnings -->
  {#if detail.windowWarnings && detail.windowWarnings.length > 0}
    <div class="mb-4 flex flex-col gap-2">
      {#each detail.windowWarnings as w (w.shipmentNumber + w.field + w.kind)}
        <div class="rounded-card bg-warn-soft text-warn p-3 text-sm">
          <strong>{w.shipmentNumber}</strong> —
          {w.field === 'pickup' ? 'pickup' : 'delivery'} planifié
          {w.kind === 'BEFORE_EARLY' ? 'avant' : 'après'} la fenêtre demandée
          (demandé {new Date(w.requested).toLocaleDateString()}, planifié {new Date(w.planned).toLocaleDateString()})
        </div>
      {/each}
    </div>
  {/if}

  {#if auxError}
    <div class="mb-4 rounded-card bg-warn-soft p-3 text-sm text-warn">Some sections failed to load (documents, route, tracking or tenders) — reload to retry.</div>
  {/if}

  <!-- Main grid: 2 cols on large screens -->
  <div class="grid gap-4 lg:grid-cols-3">
    <!-- Left column: Route + Shipments + Documents + Accessorials -->
    <div class="flex flex-col gap-4 lg:col-span-2">

      <!-- Route card -->
      <Card>
        <div class="mb-3 flex items-center justify-between">
          <h2 class="font-semibold text-ink">Route</h2>
          {#if route && editable && !editingRoute}
            <Button variant="secondary" onclick={startEditRoute}>Edit route</Button>
          {/if}
        </div>

        {#if editingRoute}
          <div class="mb-3 grid grid-cols-2 gap-3">
            <Field label="Distance (km)">
              <input
                id="distance"
                type="number"
                min="0"
                bind:value={editDistance}
                class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </Field>
            <Field label="Duration (min)">
              <input
                id="duration"
                type="number"
                min="0"
                bind:value={editDuration}
                class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </Field>
          </div>
          <div class="flex flex-col gap-2">
            {#each editStops as stop, index (index)}
              <div class="grid grid-cols-[90px_1fr_auto_80px] items-center gap-2 border-b border-edge py-2 text-sm">
                <span class="text-ink-muted">#{index + 1} {stop.type}</span>
                <span>{stop.label}</span>
                <div class="flex flex-wrap items-center gap-1">
                  <span class="text-xs text-ink-muted whitespace-nowrap">Arrival from</span>
                  <input type="datetime-local" bind:value={stop.plannedArrivalEarly} class="rounded border border-edge bg-surface px-1.5 py-0.5 text-xs text-ink" />
                  <span class="text-xs text-ink-muted">to</span>
                  <input type="datetime-local" bind:value={stop.plannedArrivalLate} class="rounded border border-edge bg-surface px-1.5 py-0.5 text-xs text-ink" />
                </div>
                <span class="flex gap-1">
                  <Button variant="secondary" onclick={() => moveStop(index, -1)}>↑</Button>
                  <Button variant="secondary" onclick={() => moveStop(index, 1)}>↓</Button>
                </span>
              </div>
            {/each}
          </div>
          <div class="mt-3 flex gap-2">
            <Button variant="primary" onclick={saveRoute}>Save route</Button>
            <Button variant="secondary" onclick={() => { editingRoute = false; }}>Cancel</Button>
          </div>
        {:else if route}
          {#if route.totalDistanceKm != null || route.estimatedDurationMin != null}
            <div class="mb-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              {#if route.totalDistanceKm != null}
                <span>{route.totalDistanceKm} km</span>
              {/if}
              {#if route.estimatedDurationMin != null}
                <span>{route.estimatedDurationMin} min</span>
              {/if}
              {#if route.distanceSource === 'HAVERSINE'}
                <Badge tone="warn">estimate — straight-line</Badge>
              {:else if route.distanceSource === 'OSRM'}
                <Badge tone="neutral">OSRM</Badge>
              {/if}
            </div>
          {/if}
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-edge text-xs text-ink-muted uppercase tracking-wide">
                  <th class="pb-2 text-left font-semibold">#</th>
                  <th class="pb-2 text-left font-semibold">Type</th>
                  <th class="pb-2 text-left font-semibold">Location</th>
                  <th class="pb-2 text-left font-semibold">Arrival window</th>
                  <th class="pb-2 text-left font-semibold">Status</th>
                  <th class="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {#each route.stops as stop (stop.id)}
                  <tr class="border-b border-edge last:border-0">
                    <td class="py-2 pr-2">{stop.sequence}</td>
                    <td class="py-2 pr-2">{stop.type}</td>
                    <td class="py-2 pr-2">{stop.location.name}, {stop.location.city}</td>
                    <td class="py-2 pr-2 text-xs text-ink-muted">
                      {#if stop.plannedArrivalEarly}
                        {new Date(stop.plannedArrivalEarly).toLocaleString()}{stop.plannedArrivalLate ? ' → ' + new Date(stop.plannedArrivalLate).toLocaleString() : ''}
                      {:else}
                        —
                      {/if}
                    </td>
                    <td class="py-2 pr-2">
                      <Badge tone={toneFor(stop.status)}>{labelFor(stop.status)}</Badge>
                    </td>
                    <td class="py-2 text-right whitespace-nowrap">
                      {#if executing && stop.status === 'PENDING'}
                        <Button variant="primary" onclick={() => stopAction(stop.id, 'ARRIVED')}>Arrive</Button>
                      {:else if executing && stop.status === 'ARRIVED'}
                        <Button variant="primary" onclick={() => stopAction(stop.id, 'DEPARTED')}>Depart</Button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <!-- Map below route table -->
          {#if mapStops.length > 0}
            <div class="mt-3">
              <LoadMap stops={mapStops} {loadId} geometry={route?.geometry ?? null} />
            </div>
          {/if}
        {:else if editable && detail.shipments.length > 0}
          <p class="text-sm text-ink-muted">No route yet.</p>
          <div class="mt-2">
            <Button variant="secondary" onclick={generateRoute}>Generate route from shipments</Button>
          </div>
        {:else}
          <p class="text-sm text-ink-muted">No route. Add shipments first.</p>
        {/if}
      </Card>

      <!-- Shipments card -->
      <Card>
        <h2 class="mb-3 font-semibold text-ink">Shipments</h2>
        {#if detail.shipments.length === 0}
          <p class="text-sm text-ink-muted">
            Empty load — assign shipments from the <a href="/shipments" class="text-accent hover:underline">Shipments</a> page.
          </p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-edge text-xs text-ink-muted uppercase tracking-wide">
                  <th class="pb-2 text-left font-semibold">Shipment #</th>
                  <th class="pb-2 text-left font-semibold">Status</th>
                  <th class="pb-2 text-left font-semibold">POD</th>
                  <th class="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {#each detail.shipments as shipment (shipment.id)}
                  <tr class="border-b border-edge last:border-0">
                    <td class="py-2 pr-2">
                      <a href={`/transport-orders/${shipment.transportOrderId}`} class="font-semibold text-accent hover:underline">
                        {shipment.shipmentNumber}
                      </a>
                    </td>
                    <td class="py-2 pr-2">
                      <Badge tone={toneFor(shipment.status)}>{labelFor(shipment.status)}</Badge>
                    </td>
                    <td class="py-2 pr-2">
                      {#if shipment.proofOfDelivery}
                        <Badge tone="ok">{shipment.proofOfDelivery.signedByName ?? 'Signed'}</Badge>
                      {:else}
                        <span class="text-ink-muted">—</span>
                      {/if}
                    </td>
                    <td class="py-2 text-right">
                      {#if !shipment.proofOfDelivery && (shipment.status === 'IN_TRANSIT' || shipment.status === 'DELIVERED')}
                        <Button variant="secondary" onclick={() => { podShipment = shipment; }}>Capture POD</Button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        {#if podShipment}
          <div class="mt-4 border-t border-edge pt-4">
            <h3 class="mb-3 font-semibold text-ink">POD — {podShipment.shipmentNumber}</h3>
            <div class="flex flex-col gap-3">
              <Field label="Signed by">
                <input
                  id="signedBy"
                  bind:value={podForm.signedByName}
                  placeholder="Receiver name"
                  class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                />
              </Field>
              <Field label="Notes">
                <textarea
                  id="podNotes"
                  rows="2"
                  bind:value={podForm.notes}
                  class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                ></textarea>
              </Field>
              <div class="flex gap-2">
                <Button variant="primary" onclick={capturePod}>Save POD</Button>
                <Button variant="secondary" onclick={() => { podShipment = null; }}>Cancel</Button>
              </div>
            </div>
          </div>
        {/if}
      </Card>

      <!-- Documents card -->
      <Card>
        <div class="mb-3 flex items-center justify-between">
          <h2 class="font-semibold text-ink">Documents</h2>
          {#if canBol}
            <Button variant="secondary" onclick={generateBol}>Generate BOL</Button>
          {/if}
        </div>
        {#if documents.length === 0}
          <p class="text-sm text-ink-muted">No documents yet.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-edge text-xs text-ink-muted uppercase tracking-wide">
                  <th class="pb-2 text-left font-semibold">File</th>
                  <th class="pb-2 text-left font-semibold">Date</th>
                  <th class="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {#each documents as doc (doc.id)}
                  <tr class="border-b border-edge last:border-0">
                    <td class="py-2 pr-2">{doc.fileName}</td>
                    <td class="py-2 pr-2 text-xs text-ink-muted">{new Date(doc.createdAt).toLocaleString()}</td>
                    <td class="py-2 text-right">
                      <a href={`/api/v1/documents/${doc.id}/download`} target="_blank" class="inline-flex items-center justify-center gap-1.5 rounded-md border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-surface-muted">Download</a>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </Card>

      <!-- Accessorials card -->
      <Card>
        <h2 class="mb-3 font-semibold text-ink">Accessorials</h2>
        {#if accessorialCatalog.length === 0}
          <p class="text-sm text-ink-muted">No accessorials configured.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-edge text-xs text-ink-muted uppercase tracking-wide">
                  <th class="pb-2"></th>
                  <th class="pb-2 text-left font-semibold">Code</th>
                  <th class="pb-2 text-left font-semibold">Name</th>
                  <th class="pb-2 text-left font-semibold">Qty</th>
                  <th class="pb-2 text-left font-semibold">Unit</th>
                </tr>
              </thead>
              <tbody>
                {#each accessorialCatalog as cat (cat.id)}
                  <tr class="border-b border-edge last:border-0">
                    <td class="py-2 pr-2">
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
                    <td class="py-2 pr-2 text-xs text-ink-muted">{cat.code}</td>
                    <td class="py-2 pr-2">{cat.name}</td>
                    <td class="py-2 pr-2">
                      <input
                        type="number"
                        min="1"
                        class="w-16 rounded-md border border-edge bg-surface px-2 py-1 text-sm text-ink"
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
                    <td class="py-2 text-xs text-ink-muted">{cat.unit}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if detail.status !== 'COMPLETED' && detail.status !== 'CANCELLED'}
            <div class="mt-3">
              <Button variant="primary" onclick={saveAccessorials}>Save accessorials</Button>
            </div>
          {/if}
        {/if}
      </Card>

      <!-- Tracking card -->
      <Card>
        <h2 class="mb-3 font-semibold text-ink">Tracking</h2>
        <TrackingTimeline {events} />
      </Card>
    </div>

    <!-- Right column: Summary + Tender + Resources -->
    <div class="flex flex-col gap-4">

      <!-- Summary card -->
      <Card>
        <h2 class="mb-3 font-semibold text-ink">Summary</h2>
        <dl class="flex flex-col gap-2 text-sm">
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Carrier</dt>
            <dd class="font-medium">{detail.carrier?.name ?? '—'}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Driver</dt>
            <dd class="font-medium">{detail.driver ? `${detail.driver.firstName} ${detail.driver.lastName}` : '—'}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Vehicle</dt>
            <dd class="font-medium">{detail.vehicle?.unitNumber ?? '—'}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Trailer</dt>
            <dd class="font-medium">{detail.trailer?.unitNumber ?? '—'}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Mode</dt>
            <dd class="font-medium">{detail.mode ?? '—'}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Rate</dt>
            <dd class="font-medium">{detail.rate?.name ?? '—'}</dd>
          </div>
          {#if detail.estimatedCost !== null}
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">Estimated cost</dt>
              <dd class="font-semibold">{Number(detail.estimatedCost).toLocaleString()} {detail.costCurrency}</dd>
            </div>
          {/if}
        </dl>

        {#if editable}
          <div class="mt-3">
            <Button variant="secondary" onclick={openRateOptions}>Compare rates</Button>
          </div>
        {/if}

        {#if detail.costDetail}
          {@const cd = detail.costDetail}
          <div class="mt-4 rounded-card border border-edge bg-surface-muted p-3">
            <div class="mb-2 flex flex-wrap items-center gap-2">
              <span class="text-xs text-ink-muted">Cost snapshot — ref. {new Date(cd.referenceDate).toLocaleDateString()}</span>
              {#if !cd.rate.validAtReference}
                <Badge tone="warn">rate outside validity window</Badge>
              {/if}
            </div>
            <table class="w-full text-xs">
              <tbody>
                {#each cd.result.lines as line}
                  <tr class="border-b border-edge last:border-0">
                    <td class="py-1">{line.label}</td>
                    <td class="py-1 text-right">{line.amount.toLocaleString()} {cd.rate.currency}</td>
                  </tr>
                {/each}
                <tr>
                  <td class="pt-2 font-semibold">Total</td>
                  <td class="pt-2 text-right font-semibold">{cd.result.total.toLocaleString()} {cd.rate.currency}</td>
                </tr>
              </tbody>
            </table>
            {#if cd.result.appliedBreak}
              {@const br = cd.result.appliedBreak}
              <p class="mt-1 text-xs text-ink-muted">
                Break: ≤ {br.upToKg} kg @ {br.amount} $/CWT
                {#if br.asIfApplied}<Badge tone="warn">as-if</Badge>{/if}
              </p>
            {/if}
            <p class="mt-1 text-xs text-ink-muted">
              Fuel: {cd.rate.fuel.pct}% — {cd.rate.fuel.source}
              {#if cd.rate.fuel.source === 'TABLE' && cd.rate.fuel.effectiveFrom}
                (eff. {new Date(cd.rate.fuel.effectiveFrom).toLocaleDateString()})
              {/if}
            </p>
            {#if cd.result.missingAccessorials.length > 0}
              <p class="mt-1 text-xs text-danger">
                Missing accessorials: {cd.result.missingAccessorials.join(', ')}
              </p>
            {/if}
          </div>
        {/if}

        {#if rateOptionsOpen}
          <div class="mt-4 rounded-card border border-edge bg-surface-muted p-3">
            <div class="mb-2 flex items-center justify-between">
              <strong class="text-sm">Rate options</strong>
              <Button variant="ghost" onclick={() => { rateOptionsOpen = false; }}>Close</Button>
            </div>
            {#if rateOptionsLoading}
              <p class="text-sm text-ink-muted">Loading…</p>
            {:else if rateOptionsError}
              <p class="text-sm text-danger">{rateOptionsError}</p>
            {:else if rateOptions.length === 0}
              <p class="text-sm text-ink-muted">No rate options available.</p>
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
              <div class="flex flex-col gap-2">
                {#each rateOptions as opt (opt.rateId)}
                  <div
                    class="cursor-pointer rounded-md border border-edge bg-surface p-2 hover:bg-surface-muted"
                    role="button"
                    tabindex="0"
                    onclick={() => { expandedRateId = expandedRateId === opt.rateId ? null : opt.rateId; }}
                    onkeydown={(e) => { if (e.key === 'Enter') expandedRateId = expandedRateId === opt.rateId ? null : opt.rateId; }}
                  >
                    <div class="flex items-center justify-between gap-2 text-sm">
                      <div class="flex items-center gap-1 flex-wrap">
                        <span class="font-medium">{opt.rateName}</span>
                        {#if firstCompleteByCurrency.has(opt.rateId)}
                          <Badge tone="ok">best</Badge>
                        {/if}
                        {#if opt.missingAccessorials.length > 0}
                          <Badge tone="warn">missing: {opt.missingAccessorials.length}</Badge>
                        {/if}
                      </div>
                      <span class="font-semibold whitespace-nowrap">{opt.breakdown.total.toLocaleString()} {opt.currency}</span>
                    </div>
                    <div class="mt-0.5 text-xs text-ink-muted">
                      {opt.carrier?.name ?? '—'} ·
                      {opt.laneSpecificity
                        ? `${opt.laneSpecificity.originType}→${opt.laneSpecificity.destinationType} (${opt.laneSpecificity.total})`
                        : 'catch-all'}
                    </div>
                    {#if expandedRateId === opt.rateId}
                      <table class="mt-2 w-full text-xs">
                        <tbody>
                          {#each opt.breakdown.lines as line}
                            <tr>
                              <td class="py-0.5 text-ink-muted">{line.label}</td>
                              <td class="py-0.5 text-right">{line.amount.toLocaleString()} {opt.currency}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    {/if}
                    <div class="mt-2" onclick={(e) => e.stopPropagation()} role="none">
                      <Button variant="primary" onclick={() => assignRate(opt.rateId)}>Assign</Button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </Card>

      <!-- Tender card (only when a tender exists) -->
      {#if latestTender}
        <Card>
          <h2 class="mb-3 font-semibold text-ink">Tender</h2>
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={toneFor(latestTender.status)}>{labelFor(latestTender.status)}</Badge>
            <span>{latestTender.carrier.name}</span>
            <span class="text-ink-muted">expires {new Date(latestTender.expiresAt).toLocaleString()}</span>
          </div>
          {#if latestTender.declineReason}
            <p class="mt-2 text-sm text-danger">Declined: {latestTender.declineReason}</p>
          {/if}
          {#if latestTender.status === 'PENDING'}
            <div class="mt-3">
              <Button
                variant="secondary"
                onclick={() => copyToClipboard(`${location.origin}/tender/${latestTender!.token}`, 'Tender link')}
              >
                Copy carrier link
              </Button>
            </div>
          {/if}
        </Card>
      {/if}

      <!-- Resources assignment card -->
      <Card>
        <h2 class="mb-3 font-semibold text-ink">Resources</h2>
        <div class="flex flex-col gap-3">
          <Field label="Carrier">
            <Select bind:value={form.carrierId} disabled={!editable}>
              <option value="">—</option>
              {#each carriers as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
            </Select>
          </Field>
          <Field label="Driver">
            <Select bind:value={form.driverId} disabled={!editable}>
              <option value="">—</option>
              {#each drivers as o (o.id)}<option value={o.id}>{o.firstName} {o.lastName}</option>{/each}
            </Select>
          </Field>
          <Field label="Vehicle">
            <Select bind:value={form.vehicleId} disabled={!editable}>
              <option value="">—</option>
              {#each vehicles as o (o.id)}<option value={o.id}>{o.unitNumber}</option>{/each}
            </Select>
          </Field>
          <Field label="Trailer">
            <Select bind:value={form.trailerId} disabled={!editable}>
              <option value="">—</option>
              {#each trailers as o (o.id)}<option value={o.id}>{o.unitNumber}</option>{/each}
            </Select>
          </Field>
          <Field label="Rate">
            <Select bind:value={form.rateId} disabled={!editable}>
              <option value="">—</option>
              {#each rates as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
            </Select>
          </Field>
          <Field label="Mode">
            <Select bind:value={form.mode} disabled={!editable}>
              <option value="">— inherit —</option>
              {#each Object.values(TransportMode) as m (m)}
                <option value={m}>{m}</option>
              {/each}
            </Select>
          </Field>
        </div>
        {#if editable}
          <div class="mt-3">
            <Button variant="primary" onclick={saveResources}>Save resources</Button>
          </div>
        {/if}

        {#if resourcesCapacityExcesses.length > 0}
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
                {#each resourcesCapacityExcesses as ex (ex.axis)}
                  <tr>
                    <td class="py-0.5">{ex.axis}</td>
                    <td class="py-0.5 text-right">{ex.capacity}</td>
                    <td class="py-0.5 text-right">{ex.requested}</td>
                    <td class="py-0.5 text-right text-danger">+{ex.excess}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
            {#if editable}
              <label class="mt-2 flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input type="checkbox" bind:checked={resourcesForce} />
                Force assignment (audited)
              </label>
              {#if resourcesForce}
                <div class="mt-2">
                  <Button variant="danger" onclick={saveResources}>Confirm force assign</Button>
                </div>
              {/if}
            {/if}
          </div>
        {/if}
      </Card>
    </div>
  </div>
{:else}
  <p class="text-sm text-ink-muted">Loading…</p>
{/if}
