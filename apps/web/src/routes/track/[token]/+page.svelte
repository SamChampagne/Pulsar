<script lang="ts">
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import TrackingTimeline, { type TimelineEvent } from '$lib/components/TrackingTimeline.svelte';

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
      ? new Date(early).toLocaleString() + (late ? ' → ' + new Date(late).toLocaleString() : '')
      : '—';

  const token = $derived(page.params.token);

  let view = $state<TrackingView | null>(null);
  let error = $state('');

  function fmt(value: string | null): string {
    return value ? new Date(value).toLocaleString() : '—';
  }

  $effect(() => {
    if (!token) return;
    api<TrackingView>(`/public/tracking/${token}`)
      .then((v) => (view = v))
      .catch((e) => (error = e instanceof ApiError ? e.message : 'This link is invalid'));
  });
</script>

<div class="public-page">
  <div class="card public-card">
    {#if error}
      <p class="error-text">{error}</p>
    {:else if view}
      <p class="muted" style="margin-top: 0;">Shipment tracking · {view.shipper}</p>
      <div style="display: flex; align-items: center; gap: 10px;">
        <h1>{view.shipmentNumber}</h1>
        <StatusBadge status={view.status} />
      </div>
      <p>
        {view.origin.city}{view.origin.state ? `, ${view.origin.state}` : ''}
        →
        {view.destination.city}{view.destination.state ? `, ${view.destination.state}` : ''}
      </p>

      <table style="margin-bottom: 16px;">
        <tbody>
          <tr><td class="muted">Planned pickup</td><td>{fmtWindow(view.plannedPickupEarly, view.plannedPickupLate)}</td></tr>
          <tr><td class="muted">Actual pickup</td><td>{fmt(view.actualPickupAt)}</td></tr>
          <tr><td class="muted">Planned delivery</td><td>{fmtWindow(view.plannedDeliveryEarly, view.plannedDeliveryLate)}</td></tr>
          <tr><td class="muted">Actual delivery</td><td>{fmt(view.actualDeliveryAt)}</td></tr>
        </tbody>
      </table>

      {#if view.proofOfDelivery}
        <p>
          ✅ Delivered — signed by
          <strong>{view.proofOfDelivery.signedByName ?? 'receiver'}</strong>
          on {new Date(view.proofOfDelivery.signedAt).toLocaleString()}
        </p>
      {/if}

      <h2>History</h2>
      <TrackingTimeline events={view.events} />
    {:else}
      <p class="muted">Loading…</p>
    {/if}
    <p class="muted" style="margin-bottom: 0; font-size: 11px;">Powered by Pulsar</p>
  </div>
</div>

<style>
  .public-page {
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 32px 16px;
  }

  .public-card {
    width: 100%;
    max-width: 560px;
  }
</style>
