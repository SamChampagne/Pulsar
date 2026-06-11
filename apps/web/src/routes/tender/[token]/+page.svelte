<script lang="ts">
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import StatusBadge from '$lib/components/StatusBadge.svelte';

  interface TenderView {
    status: string;
    shipper: string;
    carrier: string;
    message: string | null;
    expiresAt: string;
    load: {
      loadNumber: string;
      notes: string | null;
      shipments: { shipmentNumber: string; weightKg: number | null; palletCount: number | null }[];
      route: {
        totalDistanceKm: number | null;
        stops: {
          sequence: number;
          type: string;
          plannedArrivalEarly: string | null;
          plannedArrivalLate: string | null;
          location: { name: string; city: string; state: string | null };
        }[];
      } | null;
    };
  }

  const token = $derived(page.params.token);

  let tender = $state<TenderView | null>(null);
  let error = $state('');
  let declineReason = $state('');
  let showDecline = $state(false);
  let busy = $state(false);

  async function load() {
    try {
      tender = await api<TenderView>(`/public/tenders/${token}`);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'This link is invalid';
    }
  }

  async function respond(accept: boolean) {
    busy = true;
    try {
      await api(`/public/tenders/${token}/${accept ? 'accept' : 'decline'}`, {
        method: 'POST',
        body: accept ? undefined : { reason: declineReason || undefined },
      });
      await load();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to respond';
    } finally {
      busy = false;
    }
  }

  const fmtWindow = (early: string | null, late?: string | null) =>
    early
      ? new Date(early).toLocaleString() + (late ? ' → ' + new Date(late).toLocaleString() : '')
      : '—';

  const totalWeight = $derived(
    tender?.load.shipments.reduce((acc, s) => acc + (s.weightKg ?? 0), 0) ?? 0,
  );
  const totalPallets = $derived(
    tender?.load.shipments.reduce((acc, s) => acc + (s.palletCount ?? 0), 0) ?? 0,
  );

  $effect(() => {
    if (token) void load();
  });
</script>

<div class="public-page">
  <div class="card public-card">
    {#if error}
      <p class="error-text">{error}</p>
    {:else if tender}
      <p class="muted" style="margin-top: 0;">Transport offer from <strong>{tender.shipper}</strong></p>
      <div style="display: flex; align-items: center; gap: 10px;">
        <h1>{tender.load.loadNumber}</h1>
        <StatusBadge status={tender.status} />
      </div>
      <p class="muted">For {tender.carrier} · expires {new Date(tender.expiresAt).toLocaleString()}</p>

      {#if tender.message}
        <p>{tender.message}</p>
      {/if}

      <p>
        <strong>{tender.load.shipments.length}</strong> shipment(s) ·
        <strong>{totalWeight.toLocaleString()}</strong> kg ·
        <strong>{totalPallets}</strong> pallets
        {#if tender.load.route?.totalDistanceKm}
          · {tender.load.route.totalDistanceKm} km
        {/if}
      </p>

      {#if tender.load.route}
        <table>
          <thead>
            <tr><th>#</th><th>Type</th><th>Location</th><th>Planned</th></tr>
          </thead>
          <tbody>
            {#each tender.load.route.stops as stop (stop.sequence)}
              <tr>
                <td>{stop.sequence}</td>
                <td>{stop.type}</td>
                <td>{stop.location.name}, {stop.location.city}{stop.location.state ? `, ${stop.location.state}` : ''}</td>
                <td>{fmtWindow(stop.plannedArrivalEarly, stop.plannedArrivalLate)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

      {#if tender.status === 'PENDING'}
        <div style="display: flex; gap: 10px; margin-top: 20px;">
          <button class="btn" disabled={busy} onclick={() => respond(true)}>Accept</button>
          <button class="btn btn-danger" disabled={busy} onclick={() => (showDecline = !showDecline)}>
            Decline
          </button>
        </div>
        {#if showDecline}
          <div style="margin-top: 12px;">
            <div class="field">
              <label for="reason">Reason (optional)</label>
              <input id="reason" bind:value={declineReason} placeholder="No capacity this week" />
            </div>
            <button class="btn btn-danger" disabled={busy} onclick={() => respond(false)}>
              Confirm decline
            </button>
          </div>
        {/if}
      {:else if tender.status === 'ACCEPTED'}
        <p class="muted">✅ Offer accepted. The shipper will dispatch the load.</p>
      {:else if tender.status === 'DECLINED'}
        <p class="muted">This offer was declined.</p>
      {:else}
        <p class="muted">This offer is no longer open ({tender.status.toLowerCase()}).</p>
      {/if}
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
    max-width: 640px;
  }
</style>
