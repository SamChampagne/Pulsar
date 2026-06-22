<script lang="ts">
  import { page } from '$app/state';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge, Button, PageHeader,
    toneFor, labelFor,
  } from '$lib/components/ui';
  import TrackingTimeline, { type TimelineEvent } from '$lib/components/TrackingTimeline.svelte';
  import { toast } from '$lib/stores/toast';
  import LoadRoutePanel from '$lib/components/loads/LoadRoutePanel.svelte';
  import LoadShipmentsPanel from '$lib/components/loads/LoadShipmentsPanel.svelte';
  import LoadDocumentsPanel from '$lib/components/loads/LoadDocumentsPanel.svelte';
  import LoadAccessorialsPanel from '$lib/components/loads/LoadAccessorialsPanel.svelte';
  import LoadSummaryPanel from '$lib/components/loads/LoadSummaryPanel.svelte';
  import LoadTendersPanel from '$lib/components/loads/LoadTendersPanel.svelte';
  import LoadResourcesPanel from '$lib/components/loads/LoadResourcesPanel.svelte';
  import { Card } from '$lib/components/ui';
  import type {
    LoadDetail, RouteDetail, LoadDocument, CatalogAccessorial, Option,
  } from '$lib/components/loads/types';

  const loadId = $derived(page.params.id as string);

  let detail = $state<LoadDetail | null>(null);
  let route = $state<RouteDetail | null>(null);
  let events = $state<TimelineEvent[]>([]);
  let tenders = $state<{ id: string; status: string; token: string; message: string | null; declineReason: string | null; sentAt: string; expiresAt: string; carrier: { id: string; name: string } }[]>([]);
  let error = $state('');
  let auxError = $state(false);

  const latestTender = $derived(tenders[0] ?? null);

  // Accessorials
  let accessorialCatalog = $state<CatalogAccessorial[]>([]);
  let accessorialChecked = $state<Record<string, boolean>>({});
  let accessorialQty = $state<Record<string, number>>({});

  // Documents
  let documents = $state<LoadDocument[]>([]);

  // Resource assignment form
  let carriers = $state<Option[]>([]);
  let drivers = $state<Option[]>([]);
  let vehicles = $state<Option[]>([]);
  let trailers = $state<Option[]>([]);
  let rates = $state<Option[]>([]);
  let form = $state({ carrierId: '', driverId: '', vehicleId: '', trailerId: '', rateId: '', mode: '' });

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
      api<typeof tenders>(`/transportation/loads/${loadId}/tenders`),
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
      const tender = await api<{ id: string; status: string; token: string; message: string | null; declineReason: string | null; sentAt: string; expiresAt: string; carrier: { id: string; name: string }; responseUrl: string; emailedTo: string | null }>(
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
      const tender = await api<{ carrier: { name: string }; emailedTo: string | null }>(
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

  async function action(name: 'dispatch' | 'start-transit' | 'complete' | 'cancel') {
    try {
      await api(`/transportation/loads/${loadId}/${name}`, { method: 'POST' });
      toast.success(`Load ${name.replace('-', ' ')} done`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : `Failed to ${name}`);
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
    <!-- Left column: Route + Shipments + Documents + Accessorials + Tracking -->
    <div class="flex flex-col gap-4 lg:col-span-2">
      <LoadRoutePanel
        {loadId}
        {detail}
        {route}
        {editable}
        {executing}
        onReload={load}
      />

      <LoadShipmentsPanel
        shipments={detail.shipments}
        loadStatus={detail.status}
        onReload={load}
      />

      <LoadDocumentsPanel
        {loadId}
        {documents}
        {canBol}
        onDocumentsChange={(docs) => { documents = docs; }}
      />

      <LoadAccessorialsPanel
        {loadId}
        loadStatus={detail.status}
        {accessorialCatalog}
        {accessorialChecked}
        {accessorialQty}
        onCheckedChange={(checked) => { accessorialChecked = checked; }}
        onQtyChange={(qty) => { accessorialQty = qty; }}
        onReload={load}
      />

      <!-- Tracking card -->
      <Card>
        <h2 class="mb-3 font-semibold text-ink">Tracking</h2>
        <TrackingTimeline {events} />
      </Card>
    </div>

    <!-- Right column: Summary + Tender + Resources -->
    <div class="flex flex-col gap-4">
      <LoadSummaryPanel
        {loadId}
        {detail}
        {editable}
        onReload={load}
      />

      {#if latestTender}
        <LoadTendersPanel
          tender={latestTender}
          onCopyLink={copyToClipboard}
        />
      {/if}

      <LoadResourcesPanel
        {loadId}
        {editable}
        {carriers}
        {drivers}
        {vehicles}
        {trailers}
        {rates}
        {form}
        onFormChange={(f) => { form = f; }}
        onReload={load}
      />
    </div>
  </div>
{:else}
  <p class="text-sm text-ink-muted">Loading…</p>
{/if}
