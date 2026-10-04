<script lang="ts">
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import PublicShell from '$lib/components/PublicShell.svelte';
  import { Badge, Card, Button, ErrorNotice, Skeleton } from '$lib/components/ui';
  import { toneFor, labelFor } from '$lib/components/ui';
  import TrackingTimeline, { type TimelineEvent } from '$lib/components/TrackingTimeline.svelte';
  import TrackMap from '$lib/components/TrackMap.svelte';
  import { formatDateTime } from '$lib/format';
  import RecipientPackagesPanel from '$lib/components/RecipientPackagesPanel.svelte';
  import type { RecipientPackageTracking } from '$lib/components/recipient-packages';

  interface TrackingView {
    packageTracking?: RecipientPackageTracking;
    shipper: string;
    shipmentNumber: string;
    status: string;
    origin: { city: string; state: string | null; latitude: number | null; longitude: number | null };
    destination: { city: string; state: string | null; latitude: number | null; longitude: number | null };
    lastPosition: { latitude: number; longitude: number; occurredAt: string } | null;
    plannedPickupEarly: string | null;
    plannedPickupLate: string | null;
    plannedDeliveryEarly: string | null;
    plannedDeliveryLate: string | null;
    actualPickupAt: string | null;
    actualDeliveryAt: string | null;
    proofOfDelivery: { signedByName: string | null; signedAt: string } | null;
    events: TimelineEvent[];
  }

  const fmtWindow = (early: string | null, late?: string | null) =>
    early
      ? formatDateTime(early) + (late ? ' → ' + formatDateTime(late) : '')
      : '—';

  const token = $derived(page.params.token);

  let view = $state<TrackingView | null>(null);
  let error = $state('');
  let refresh = $state(0);

  function fmt(value: string | null): string {
    return value ? formatDateTime(value) : '—';
  }

  $effect(() => {
    refresh;
    if (!token) return;
    let current = true;
    view = null;
    error = '';
    api<TrackingView>(`/public/tracking/${encodeURIComponent(token)}`)
      .then((v) => { if (current) view = v; })
      .catch((e) => { if (current) error = e instanceof ApiError ? e.message : 'Suivi indisponible. Réessayez.'; });
    return () => { current = false; };
  });
</script>

<svelte:head>
  <title>Suivi de votre expédition · Pulsar</title>
  <meta name="robots" content="noindex, nofollow" />
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<PublicShell maxWidth="max-w-2xl">
  {#if error}
    <h1 class="mb-3 text-xl font-semibold text-ink">Suivi de votre expédition</h1>
    <ErrorNotice message={error} onretry={() => { refresh++; }} />
  {:else if view}
    <div class="mb-3 flex items-center justify-between gap-3">
      <p class="text-sm text-ink-muted">Suivi destinataire · {view.shipper}</p>
      <Button variant="secondary" onclick={() => { refresh++; }}>Actualiser</Button>
    </div>

    <!-- Status hero -->
    <div class="mb-2 flex flex-wrap items-center gap-3">
      <h1 class="text-xl font-bold text-ink">{view.shipmentNumber}</h1>
      <Badge tone={toneFor(view.status)}>{labelFor(view.status)}</Badge>
    </div>

    <!-- Origin → destination -->
    <p class="mb-5 text-base font-medium text-ink">
      {view.origin.city}{view.origin.state ? `, ${view.origin.state}` : ''}
      <span class="mx-2 text-ink-muted">→</span>
      {view.destination.city}{view.destination.state ? `, ${view.destination.state}` : ''}
    </p>

    <div class="mb-5"><RecipientPackagesPanel tracking={view.packageTracking} /></div>

    <div class="mb-5">
      <TrackMap origin={view.origin} destination={view.destination} lastPosition={view.lastPosition} />
    </div>

    <!-- Dates grid -->
    <Card>
      <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <div>
          <dt class="text-xs font-semibold text-ink-muted">Ramassage prévu</dt>
          <dd class="mt-0.5 text-ink">{fmtWindow(view.plannedPickupEarly, view.plannedPickupLate)}</dd>
        </div>
        <div>
          <dt class="text-xs font-semibold text-ink-muted">Ramassage confirmé</dt>
          <dd class="mt-0.5 text-ink">{fmt(view.actualPickupAt)}</dd>
        </div>
        <div>
          <dt class="text-xs font-semibold text-ink-muted">Livraison prévue</dt>
          <dd class="mt-0.5 text-ink">{fmtWindow(view.plannedDeliveryEarly, view.plannedDeliveryLate)}</dd>
        </div>
        <div>
          <dt class="text-xs font-semibold text-ink-muted">Livraison confirmée</dt>
          <dd class="mt-0.5 text-ink">{fmt(view.actualDeliveryAt)}</dd>
        </div>
      </dl>
    </Card>

    <!-- POD block -->
    {#if view.proofOfDelivery}
      <div class="mt-4 rounded-card border border-ok-soft bg-ok-soft px-4 py-3 text-sm text-ok">
        Preuve de livraison enregistrée — signée par
        <strong>{view.proofOfDelivery.signedByName ?? 'le destinataire'}</strong>
        le {formatDateTime(view.proofOfDelivery.signedAt)}
      </div>
    {/if}

    <!-- Timeline -->
    <h2 class="mb-3 mt-6 text-sm font-semibold text-ink-muted">Événements de l’expédition</h2>
    <TrackingTimeline events={view.events} />

    <p class="mt-6 text-center text-xs text-ink-faint">Suivi partagé avec Pulsar</p>
  {:else}
    <div aria-label="Chargement du suivi"><Skeleton rows={8} /></div>
  {/if}
</PublicShell>
