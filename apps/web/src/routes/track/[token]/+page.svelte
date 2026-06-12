<script lang="ts">
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import PublicShell from '$lib/components/PublicShell.svelte';
  import { Badge, Card } from '$lib/components/ui';
  import { toneFor, labelFor } from '$lib/components/ui';
  import TrackingTimeline, { type TimelineEvent } from '$lib/components/TrackingTimeline.svelte';
  import { formatDate, formatDateTime } from '$lib/format';

  interface TrackingView {
    shipper: string;
    shipmentNumber: string;
    status: string;
    origin: { city: string; state: string | null };
    destination: { city: string; state: string | null };
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

  function fmt(value: string | null): string {
    return value ? formatDateTime(value) : '—';
  }

  $effect(() => {
    if (!token) return;
    api<TrackingView>(`/public/tracking/${token}`)
      .then((v) => (view = v))
      .catch((e) => (error = e instanceof ApiError ? e.message : 'This link is invalid'));
  });
</script>

<PublicShell maxWidth="max-w-2xl">
  {#if error}
    <p class="text-sm text-danger">{error}</p>
  {:else if view}
    <p class="mb-1 text-sm text-ink-muted">Shipment tracking · {view.shipper}</p>

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

    <!-- Dates grid -->
    <Card>
      <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <div>
          <dt class="text-xs font-semibold text-ink-muted uppercase tracking-wide">Planned pickup</dt>
          <dd class="mt-0.5 text-ink">{fmtWindow(view.plannedPickupEarly, view.plannedPickupLate)}</dd>
        </div>
        <div>
          <dt class="text-xs font-semibold text-ink-muted uppercase tracking-wide">Actual pickup</dt>
          <dd class="mt-0.5 text-ink">{fmt(view.actualPickupAt)}</dd>
        </div>
        <div>
          <dt class="text-xs font-semibold text-ink-muted uppercase tracking-wide">Planned delivery</dt>
          <dd class="mt-0.5 text-ink">{fmtWindow(view.plannedDeliveryEarly, view.plannedDeliveryLate)}</dd>
        </div>
        <div>
          <dt class="text-xs font-semibold text-ink-muted uppercase tracking-wide">Actual delivery</dt>
          <dd class="mt-0.5 text-ink">{fmt(view.actualDeliveryAt)}</dd>
        </div>
      </dl>
    </Card>

    <!-- POD block -->
    {#if view.proofOfDelivery}
      <div class="mt-4 rounded-card border border-ok-soft bg-ok-soft px-4 py-3 text-sm text-ok">
        Delivered — signed by
        <strong>{view.proofOfDelivery.signedByName ?? 'receiver'}</strong>
        on {formatDateTime(view.proofOfDelivery.signedAt)}
      </div>
    {/if}

    <!-- Timeline -->
    <h2 class="mb-3 mt-6 text-sm font-semibold text-ink-muted uppercase tracking-wide">History</h2>
    <TrackingTimeline events={view.events} />

    <p class="mt-6 text-center text-xs text-ink-faint">Powered by Pulsar</p>
  {:else}
    <p class="text-sm text-ink-muted">Loading…</p>
  {/if}
</PublicShell>
