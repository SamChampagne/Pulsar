<script lang="ts">
  import YardRelatedDossiers from '$lib/components/yard/YardRelatedDossiers.svelte';
  import DossierButton from '$lib/components/workflows/DossierButton.svelte';
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { formatDate } from '$lib/format';
  import {
    Badge,
    Button,
    PageHeader,
    RecordHeader,
    RecordNav,
    RecordSection,
    toneFor,
    labelFor,
    Skeleton,
    ErrorNotice,
    RelatedEntities,
    ExceptionBanner,
    type RelatedGroup,
  } from '$lib/components/ui';
  import TrackingTimeline, { type TimelineEvent } from '$lib/components/TrackingTimeline.svelte';
  import { toast } from '$lib/stores/toast';
  import { confirmAction } from '$lib/stores/confirmation';
  import LoadRoutePanel from '$lib/components/loads/LoadRoutePanel.svelte';
  import LoadShipmentsPanel from '$lib/components/loads/LoadShipmentsPanel.svelte';
  import LoadDocumentsPanel from '$lib/components/loads/LoadDocumentsPanel.svelte';
  import LoadAccessorialsPanel from '$lib/components/loads/LoadAccessorialsPanel.svelte';
  import LoadSummaryPanel from '$lib/components/loads/LoadSummaryPanel.svelte';
  import LoadTendersPanel from '$lib/components/loads/LoadTendersPanel.svelte';
  import LoadResourcesPanel from '$lib/components/loads/LoadResourcesPanel.svelte';
  import { Card } from '$lib/components/ui';
  import type {
    LoadDetail,
    RouteDetail,
    LoadDocument,
    CatalogAccessorial,
  } from '$lib/components/loads/types';

  const loadId = $derived(page.params.id as string);

  let detail = $state<LoadDetail | null>(null);
  let route = $state<RouteDetail | null>(null);
  let events = $state<TimelineEvent[]>([]);
  let tenders = $state<
    {
      id: string;
      status: string;
      token: string;
      message: string | null;
      declineReason: string | null;
      sentAt: string;
      expiresAt: string;
      carrier: { id: string; name: string };
    }[]
  >([]);
  let error = $state('');
  let auxLoading = $state(false);
  let sectionErrors = $state({ documents: false, route: false, tracking: false, tenders: false });
  let resourcesError = $state('');
  let resourcesLoading = $state(false);
  let busy = $state(false);
  let loadGeneration = 0;

  const latestTender = $derived(tenders[0] ?? null);

  // Accessorials
  let accessorialCatalog = $state<CatalogAccessorial[]>([]);
  let accessorialChecked = $state<Record<string, boolean>>({});
  let accessorialQty = $state<Record<string, number>>({});

  // Documents
  let documents = $state<LoadDocument[]>([]);

  // Resource assignment form — carrier/driver/vehicle/trailer/rate options are no
  // longer preloaded here: LoadResourcesPanel's EntityPicker fields each search
  // their own endpoint (hard rule 53) instead of a capped page-size-100 list.
  let form = $state({
    carrierId: '',
    driverId: '',
    vehicleId: '',
    trailerId: '',
    rateId: '',
    mode: '',
  });

  const editable = $derived(detail?.status === 'OPEN' || detail?.status === 'PLANNED');
  const executing = $derived(detail?.status === 'DISPATCHED' || detail?.status === 'IN_TRANSIT');
  const canBol = $derived(
    detail?.status === 'DISPATCHED' ||
      detail?.status === 'IN_TRANSIT' ||
      detail?.status === 'COMPLETED',
  );
  /** Simple heuristic: any DELAYED event present and load not COMPLETED → show badge + banner. */
  const isDelayed = $derived(
    detail?.status !== 'COMPLETED' &&
      detail?.status !== 'CANCELLED' &&
      events.some((e) => e.type === 'DELAYED'),
  );
  // Additional exception sources (e.g. capacity warnings, freight-audit disputes on this
  // load) would derive here from data this page already fetches — none cheaply available yet.

  /** "Lié à" panel — only ids actually present in the loaded data become links. */
  const relatedGroups = $derived.by((): RelatedGroup[] => {
    if (!detail) return [];

    const carrierItems = detail.carrier
      ? [{ label: detail.carrier.name, href: `/carriers/${detail.carrier.id}` }]
      : [];

    const byOrder = new Map<string, string[]>();
    for (const s of detail.shipments) {
      const numbers = byOrder.get(s.transportOrderId) ?? [];
      numbers.push(s.shipmentNumber);
      byOrder.set(s.transportOrderId, numbers);
    }
    const orderItems = Array.from(byOrder.entries()).map(([orderId, numbers]) => ({
      label: 'Commande de transport',
      sublabel: numbers.join(', '),
      href: `/transport-orders/${orderId}`,
    }));

    const shipmentItems = detail.shipments.map((s) => ({
      label: s.shipmentNumber,
      sublabel: labelFor(s.status),
      tone: toneFor(s.status),
    }));

    return [
      { label: 'Transporteur', items: carrierItems },
      { label: 'Commandes de transport', items: orderItems },
      { label: 'Expéditions', items: shipmentItems },
    ];
  });

  async function load() {
    const generation = ++loadGeneration;
    const id = loadId;
    error = '';
    auxLoading = true;
    try {
      const result = await api<LoadDetail>(`/transportation/loads/${loadId}`);
      if (generation !== loadGeneration || id !== loadId) return;
      detail = result;
      form = {
        carrierId: detail.carrier?.id ?? '',
        driverId: detail.driver?.id ?? '',
        vehicleId: detail.vehicle?.id ?? '',
        trailerId: detail.trailer?.id ?? '',
        rateId: detail.rate?.id ?? '',
        mode: detail.mode ?? '',
      };
    } catch (e) {
      if (generation !== loadGeneration || id !== loadId) return;
      auxLoading = false;
      error = e instanceof ApiError ? e.message : 'Impossible de charger le chargement';
      return;
    }
    const [docsR, routeR, eventsR, tendersR] = await Promise.allSettled([
      api<LoadDocument[]>(`/transportation/loads/${loadId}/documents`),
      detail.route
        ? api<RouteDetail>(`/transportation/routes/${detail.route.id}`)
        : Promise.resolve(null),
      api<TimelineEvent[]>('/transportation/tracking/events', { query: { loadId } }),
      api<typeof tenders>(`/transportation/loads/${loadId}/tenders`),
    ]);
    if (generation !== loadGeneration || id !== loadId) return;
    documents = docsR.status === 'fulfilled' ? docsR.value : [];
    route = routeR.status === 'fulfilled' ? routeR.value : null;
    events = eventsR.status === 'fulfilled' ? eventsR.value : [];
    tenders = tendersR.status === 'fulfilled' ? tendersR.value : [];
    sectionErrors = {
      documents: docsR.status === 'rejected',
      route: routeR.status === 'rejected',
      tracking: eventsR.status === 'rejected',
      tenders: tendersR.status === 'rejected',
    };
    auxLoading = false;
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
    if (busy) return;
    busy = true;
    try {
      const tender = await api<{
        id: string;
        status: string;
        token: string;
        message: string | null;
        declineReason: string | null;
        sentAt: string;
        expiresAt: string;
        carrier: { id: string; name: string };
        responseUrl: string;
        emailedTo: string | null;
      }>(`/transportation/loads/${loadId}/tender`, {
        method: 'POST',
        body: { carrierId: form.carrierId || undefined },
      });
      if (tender.emailedTo) toast.success(`Tender emailed to ${tender.emailedTo}`);
      await copyToClipboard(tender.responseUrl, 'Tender link');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to send tender');
    } finally {
      busy = false;
    }
  }

  async function autoTender() {
    if (busy) return;
    busy = true;
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
    } finally {
      busy = false;
    }
  }

  async function cancelTender() {
    if (busy) return;
    busy = true;
    try {
      await api(`/transportation/loads/${loadId}/cancel-tender`, { method: 'POST' });
      toast.success('Tender cancelled');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to cancel tender');
    } finally {
      busy = false;
    }
  }

  async function driverLink() {
    if (busy) return;
    busy = true;
    try {
      const { url } = await api<{ url: string }>(`/transportation/loads/${loadId}/driver-link`, {
        method: 'POST',
      });
      await copyToClipboard(url, 'Driver link');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create driver link');
    } finally {
      busy = false;
    }
  }

  async function loadResourceOptions() {
    resourcesError = '';
    resourcesLoading = true;
    try {
      const catalog = await api<Paginated<CatalogAccessorial>>('/transportation/accessorials', {
        query: { pageSize: 100 },
      });
      accessorialCatalog = catalog.items;
      syncAccessorialState();
    } catch (e) {
      resourcesError = e instanceof ApiError ? e.message : 'Ressources et frais indisponibles';
    } finally {
      resourcesLoading = false;
    }
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
    if (busy) return;
    const id = loadId;
    if (
      name === 'cancel' &&
      !(await confirmAction('Annuler ce chargement ?', {
        title: 'Annuler le chargement',
        confirmLabel: 'Annuler le chargement',
      }))
    )
      return;
    if (loadId !== id || busy) return;
    busy = true;
    try {
      await api(`/transportation/loads/${loadId}/${name}`, { method: 'POST' });
      toast.success(`Load ${name.replace('-', ' ')} done`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : `Failed to ${name}`);
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    loadId;
    untrack(() => {
      detail = null;
      void load();
      void loadResourceOptions();
    });
  });
</script>

{#if error}
  <RecordHeader title="Chargement" kind="Transport" backHref="/loads" backLabel="Chargements" />
  <ErrorNotice message={error} onretry={load} />
{:else if detail}
  <!-- Page header with title + status badge + action buttons -->
  <RecordHeader
    title={detail.loadNumber}
    kind="Chargement"
    backHref="/loads"
    backLabel="Chargements"
  >
    {#snippet meta()}<Badge tone={toneFor(detail!.status)}>{labelFor(detail!.status)}</Badge
      >{#if detail!.mode}<Badge tone="info">{detail!.mode}</Badge>{/if}{#if isDelayed}<Badge
          tone="danger">Retard signalé</Badge
        >{/if}<span>{detail!.shipments.length} expédition(s)</span>{/snippet}
    {#snippet actions()}
      <DossierButton entityType="LOAD" entityId={detail!.id} />
      {#if detail!.status === 'PLANNED'}
        <Button disabled={busy} variant="secondary" onclick={autoTender}>Offre automatique</Button>
        <Button disabled={busy} variant="secondary" onclick={sendTender}
          >Offrir au transporteur</Button
        >
        <Button disabled={busy} variant="primary" onclick={() => action('dispatch')}
          >Répartir</Button
        >
        <Button disabled={busy} variant="danger" onclick={() => action('cancel')}>Annuler</Button>
      {:else if detail!.status === 'TENDERED'}
        {#if latestTender?.status === 'ACCEPTED'}
          <Button disabled={busy} variant="primary" onclick={() => action('dispatch')}
            >Répartir</Button
          >
        {/if}
        {#if latestTender?.status === 'PENDING'}
          <Button disabled={busy} variant="secondary" onclick={cancelTender}>Annuler l’offre</Button
          >
        {/if}
        <Button disabled={busy} variant="danger" onclick={() => action('cancel')}
          >Annuler le chargement</Button
        >
      {:else if detail!.status === 'DISPATCHED'}
        <Button disabled={busy} variant="primary" onclick={() => action('start-transit')}
          >Démarrer le transport</Button
        >
        <Button disabled={busy} variant="danger" onclick={() => action('cancel')}>Annuler</Button>
      {:else if detail!.status === 'IN_TRANSIT'}
        <Button disabled={busy} variant="primary" onclick={() => action('complete')}
          >Marquer livré</Button
        >
      {/if}
      {#if ['PLANNED', 'TENDERED', 'DISPATCHED', 'IN_TRANSIT'].includes(detail!.status)}
        <Button disabled={busy} variant="secondary" onclick={driverLink}>Lien chauffeur</Button>
      {/if}
    {/snippet}
  </RecordHeader>
  <RecordNav
    sections={[
      { id: 'record-route', label: 'Itinéraire' },
      { id: 'record-shipments', label: 'Expéditions' },
      { id: 'record-documents', label: 'Documents' },
      { id: 'record-resources', label: 'Ressources' },
      { id: 'record-costs', label: 'Frais' },
      { id: 'record-tracking', label: 'Suivi' },
      { id: 'record-related', label: 'Dossiers liés' },
    ]}
  />

  {#if isDelayed}
    <div class="mb-4">
      <ExceptionBanner
        severity="danger"
        title="Livraison en retard"
        message="Un événement de suivi retardé a été signalé pour cette charge — vérifiez le plan de route et informez le client au besoin."
      />
    </div>
  {/if}

  <!-- Window warnings -->
  {#if detail.windowWarnings && detail.windowWarnings.length > 0}
    <div class="mb-4 flex flex-col gap-2">
      {#each detail.windowWarnings as w (w.shipmentNumber + w.field + w.kind)}
        <div class="rounded-card bg-warn-soft text-warn p-3 text-sm">
          <strong>{w.shipmentNumber}</strong> —
          {w.field === 'pickup' ? 'pickup' : 'delivery'} planifié
          {w.kind === 'BEFORE_EARLY' ? 'avant' : 'après'} la fenêtre demandée (demandé {formatDate(
            w.requested,
          )}, planifié {formatDate(w.planned)})
        </div>
      {/each}
    </div>
  {/if}

  <!-- Main grid: 2 cols on large screens -->
  <div class="grid gap-4 lg:grid-cols-3">
    <!-- Left column: Route + Shipments + Documents + Accessorials + Tracking -->
    <div class="flex flex-col gap-4 lg:col-span-2">
      <RecordSection id="record-route" label="Itinéraire"
        >{#if auxLoading}<Card><Skeleton rows={3} /></Card>{:else if sectionErrors.route}<Card
            ><ErrorNotice message="Itinéraire indisponible" onretry={load} /></Card
          >{:else}<LoadRoutePanel
            {loadId}
            {detail}
            {route}
            {editable}
            {executing}
            onReload={load}
          />{/if}</RecordSection
      >

      <RecordSection id="record-shipments" label="Expéditions"
        ><LoadShipmentsPanel
          shipments={detail.shipments}
          loadStatus={detail.status}
          onReload={load}
        /></RecordSection
      >

      <RecordSection id="record-documents" label="Documents"
        >{#if auxLoading}<Card><Skeleton rows={2} /></Card>{:else if sectionErrors.documents}<Card
            ><ErrorNotice message="Documents indisponibles" onretry={load} /></Card
          >{:else}<LoadDocumentsPanel
            {loadId}
            {documents}
            {canBol}
            onDocumentsChange={(docs) => {
              documents = docs;
            }}
          />
        {/if}</RecordSection
      >
      <RecordSection id="record-costs" label="Frais"
        >{#if resourcesLoading}<Card><Skeleton rows={2} /></Card>{:else if resourcesError}<Card
            ><ErrorNotice message={resourcesError} onretry={loadResourceOptions} /></Card
          >{:else}<LoadAccessorialsPanel
            {loadId}
            loadStatus={detail.status}
            {accessorialCatalog}
            {accessorialChecked}
            {accessorialQty}
            onCheckedChange={(checked) => {
              accessorialChecked = checked;
            }}
            onQtyChange={(qty) => {
              accessorialQty = qty;
            }}
            onReload={load}
          />
        {/if}</RecordSection
      >
      <RecordSection id="record-tracking" label="Suivi">
        <Card>
          <h2 class="mb-3 font-semibold text-ink">Suivi</h2>
          {#if auxLoading}<Skeleton rows={2} />{:else if sectionErrors.tracking}<ErrorNotice
              message="Suivi indisponible. Aucun historique ne peut être confirmé."
              onretry={load}
            />{:else}<TrackingTimeline {events} />{/if}
        </Card></RecordSection
      >
    </div>

    <!-- Right column: Summary + Tender + Resources -->
    <div class="flex flex-col gap-4">
      <LoadSummaryPanel {loadId} {detail} {editable} onReload={load} />

      {#if sectionErrors.tenders}<Card
          ><ErrorNotice message="Offres transporteur indisponibles" onretry={load} /></Card
        >{:else if !auxLoading && latestTender}
        <LoadTendersPanel tender={latestTender} onCopyLink={copyToClipboard} />
      {/if}

      <RecordSection id="record-resources" label="Ressources"
        >{#if resourcesLoading}<Card><Skeleton rows={3} /></Card>{:else if resourcesError}<Card
            ><ErrorNotice message={resourcesError} onretry={loadResourceOptions} /></Card
          >{:else}<LoadResourcesPanel
            {loadId}
            {editable}
            {form}
            onFormChange={(f) => {
              form = f;
            }}
            onReload={load}
          />
        {/if}</RecordSection
      >
      <RecordSection id="record-related" label="Dossiers liés"
        ><Card
          ><RelatedEntities title="Dossiers liés" groups={relatedGroups} /><YardRelatedDossiers
            kind="load"
            targetId={loadId}
          /></Card
        ></RecordSection
      >
    </div>
  </div>
{:else}
  <Card padded={false}><div class="p-4"><Skeleton rows={6} /></div></Card>
{/if}
