<!--
  Shipment tracking, portal side: the same projection the public tracking page
  renders (`GET /portal/shipments/:id` — rule 20: one position, never a history,
  never the other stops of the load), plus the documents, the POD and the
  comment thread the customer can answer on.
-->
<script lang="ts">
  import TrackMap from '$lib/components/TrackMap.svelte';
  import TrackingTimeline from '$lib/components/TrackingTimeline.svelte';
  import {
    Badge,
    Card,
    Drawer,
    ErrorNotice,
    Skeleton,
    labelFor,
    toneFor,
  } from '$lib/components/ui';
  import { formatDateTime } from '$lib/format';
  import { PortalApiError } from '../api';
  import type { PortalClient } from '../client';
  import { positionAt, type PortalDocument, type PortalShipmentTracking } from '../types';
  import CommentsThread from './CommentsThread.svelte';

  let {
    client,
    shipmentId,
    shipmentNumber = '',
    onclose,
  }: {
    client: PortalClient;
    /** `null` keeps the drawer closed. */
    shipmentId: string | null;
    /** Known upfront, so the header has a title before the payload lands. */
    shipmentNumber?: string;
    onclose: () => void;
  } = $props();

  let tracking = $state<PortalShipmentTracking | null>(null);
  let documents = $state<PortalDocument[]>([]);
  let loading = $state(false);
  let error = $state('');
  /** The id the loaded payload belongs to — guards a stale response. */
  let loadedId = $state<string | null>(null);

  const emptyPoint = { city: '', state: null, latitude: null, longitude: null };

  const mapPosition = $derived.by(() => {
    const p = tracking?.lastPosition;
    const at = positionAt(p);
    return p && at ? { latitude: p.latitude, longitude: p.longitude, occurredAt: at } : null;
  });

  async function load(id: string) {
    loading = true;
    error = '';
    try {
      const [view, docs] = await Promise.all([
        client.get<PortalShipmentTracking>(`/shipments/${id}`),
        // Documents are a bonus: a failure there must not hide the tracking.
        client.get<PortalDocument[]>(`/shipments/${id}/documents`).catch(() => []),
      ]);
      tracking = view;
      documents = docs;
      loadedId = id;
    } catch (e) {
      tracking = null;
      documents = [];
      error = e instanceof PortalApiError ? e.message : 'Suivi indisponible.';
    } finally {
      loading = false;
    }
  }

  async function download(doc: PortalDocument) {
    try {
      const blob = await client.download(`/documents/${doc.id}/download`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      error = e instanceof PortalApiError ? e.message : 'Téléchargement impossible.';
    }
  }

  $effect(() => {
    const id = shipmentId;
    if (!id) {
      tracking = null;
      documents = [];
      loadedId = null;
      error = '';
      return;
    }
    if (id !== loadedId && !loading) void load(id);
  });
</script>

<Drawer
  open={!!shipmentId}
  title={`Suivi ${tracking?.shipmentNumber ?? shipmentNumber}`}
  width="xl"
  {onclose}
>
  {#if loading && !tracking}
    <Card padded={false}><Skeleton rows={8} /></Card>
  {:else}
    <ErrorNotice message={error} onretry={shipmentId ? () => load(shipmentId) : undefined} />
    {#if tracking}
      <div class="flex flex-col gap-5">
        <!-- Status hero -->
        <div class="flex flex-wrap items-center gap-3">
          <Badge tone={toneFor(tracking.status)}>{labelFor(tracking.status)}</Badge>
          <span class="text-sm text-ink-muted">
            {tracking.origin?.city ?? '—'} → {tracking.destination?.city ?? '—'}
          </span>
          {#if mapPosition}
            <span class="text-xs text-ink-faint">
              dernière position {formatDateTime(mapPosition.occurredAt)}
            </span>
          {/if}
        </div>

        <!-- Map (re-created when the drawer switches shipment: Leaflet reads its
             props once, on mount). -->
        {#key tracking.shipmentNumber}
          <TrackMap
            origin={tracking.origin ?? emptyPoint}
            destination={tracking.destination ?? emptyPoint}
            lastPosition={mapPosition}
          />
        {/key}

        <!-- Planned vs actual -->
        <section>
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Prévu vs réel
          </h3>
          <dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-xs text-ink-muted">Enlèvement prévu</dt>
              <dd class="text-ink">
                {formatDateTime(tracking.plannedPickupEarly)}
                {#if tracking.plannedPickupLate}
                  → {formatDateTime(tracking.plannedPickupLate)}
                {/if}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-ink-muted">Enlèvement réel</dt>
              <dd class="text-ink">{formatDateTime(tracking.actualPickupAt)}</dd>
            </div>
            <div>
              <dt class="text-xs text-ink-muted">Livraison prévue</dt>
              <dd class="text-ink">
                {formatDateTime(tracking.plannedDeliveryEarly)}
                {#if tracking.plannedDeliveryLate}
                  → {formatDateTime(tracking.plannedDeliveryLate)}
                {/if}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-ink-muted">Livraison réelle</dt>
              <dd class="text-ink">{formatDateTime(tracking.actualDeliveryAt)}</dd>
            </div>
          </dl>
        </section>

        <!-- Proof of delivery -->
        {#if tracking.proofOfDelivery}
          <section>
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Preuve de livraison
            </h3>
            <Card>
              <p class="text-sm text-ink">
                Signée par
                <span class="font-semibold">{tracking.proofOfDelivery.signedByName ?? '—'}</span>
                le {formatDateTime(tracking.proofOfDelivery.signedAt)}
              </p>
              {#if tracking.proofOfDelivery.notes}
                <p class="mt-1 whitespace-pre-wrap text-sm text-ink-muted">
                  {tracking.proofOfDelivery.notes}
                </p>
              {/if}
            </Card>
          </section>
        {/if}

        <!-- Documents -->
        <section>
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Documents
          </h3>
          {#if documents.length === 0}
            <p class="text-sm text-ink-muted">Aucun document pour cette expédition.</p>
          {:else}
            <ul class="flex flex-col gap-1">
              {#each documents as doc (doc.id)}
                <li class="flex items-center gap-2 text-sm">
                  <span class="text-ink">{doc.fileName}</span>
                  <button
                    type="button"
                    class="text-xs text-accent hover:underline"
                    onclick={() => download(doc)}
                  >
                    Télécharger
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <!-- Timeline -->
        <section>
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Événements
          </h3>
          <TrackingTimeline events={tracking.events} />
        </section>

        <!-- Comments -->
        <section>
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Commentaires
          </h3>
          {#if shipmentId}
            <CommentsThread {client} {shipmentId} open={true} />
          {/if}
        </section>
      </div>
    {/if}
  {/if}
</Drawer>
