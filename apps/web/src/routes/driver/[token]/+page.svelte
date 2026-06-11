<script lang="ts">
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import StatusBadge from '$lib/components/StatusBadge.svelte';

  interface DriverView {
    shipper: string;
    carrier: string | null;
    loadNumber: string;
    status: string;
    notes: string | null;
    shipments: {
      id: string;
      shipmentNumber: string;
      status: string;
      proofOfDelivery: { id: string } | null;
    }[];
    stops: {
      id: string;
      sequence: number;
      type: string;
      status: string;
      plannedArrivalEarly: string | null;
      plannedArrivalLate: string | null;
      actualArrivalAt: string | null;
      actualDepartureAt: string | null;
      location: { name: string; addressLine1: string; city: string; state: string | null };
    }[];
  }

  const token = $derived(page.params.token);

  let view = $state<DriverView | null>(null);
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);

  // POD form state
  let podShipmentId = $state('');
  let signedByName = $state('');
  let podNotes = $state('');
  let photo = $state<File | null>(null);

  async function load() {
    try {
      view = await api<DriverView>(`/public/driver/${token}`);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'This link is invalid';
    }
  }

  async function stopAction(stopId: string, status: 'ARRIVED' | 'DEPARTED') {
    busy = true;
    notice = '';
    try {
      await api(`/public/driver/${token}/stops/${stopId}/status`, {
        method: 'POST',
        body: { status },
      });
      await load();
    } catch (e) {
      notice = e instanceof ApiError ? e.message : 'Failed to update stop';
    } finally {
      busy = false;
    }
  }

  async function submitPod(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    notice = '';
    try {
      await api(`/public/driver/${token}/pod`, {
        method: 'POST',
        body: {
          shipmentId: podShipmentId,
          signedByName: signedByName || undefined,
          notes: podNotes || undefined,
        },
      });
      if (photo) {
        const form = new FormData();
        form.append('file', photo);
        const res = await fetch(`/api/v1/public/driver/${token}/pod/${podShipmentId}/photo`, {
          method: 'POST',
          body: form,
        });
        if (!res.ok) notice = 'POD saved, but the photo upload failed';
      }
      podShipmentId = '';
      signedByName = '';
      podNotes = '';
      photo = null;
      await load();
    } catch (e) {
      notice = e instanceof ApiError ? e.message : 'Failed to save POD';
    } finally {
      busy = false;
    }
  }

  const fmtWindow = (early: string | null, late?: string | null) =>
    early
      ? new Date(early).toLocaleString() + (late ? ' → ' + new Date(late).toLocaleString() : '')
      : '—';

  const podCandidates = $derived(
    view?.shipments.filter(
      (s) => !s.proofOfDelivery && (s.status === 'IN_TRANSIT' || s.status === 'DELIVERED'),
    ) ?? [],
  );

  $effect(() => {
    if (token) void load();
  });
</script>

<div class="driver-page">
  {#if error}
    <p class="error-text">{error}</p>
  {:else if view}
    <header>
      <p class="muted" style="margin: 0;">{view.shipper} · {view.carrier ?? 'Internal fleet'}</p>
      <div style="display: flex; align-items: center; gap: 10px;">
        <h1>{view.loadNumber}</h1>
        <StatusBadge status={view.status} />
      </div>
      {#if view.notes}<p class="muted">{view.notes}</p>{/if}
    </header>

    {#if notice}
      <p class="error-text">{notice}</p>
    {/if}

    {#each view.stops as stop (stop.id)}
      <div class="card stop-card">
        <div class="stop-head">
          <div>
            <strong>#{stop.sequence} — {stop.type}</strong>
            <StatusBadge status={stop.status} />
          </div>
          <div class="muted">
            {stop.location.name}<br />
            {stop.location.addressLine1}, {stop.location.city}<br />
            {#if stop.plannedArrivalEarly}
              Planned: {fmtWindow(stop.plannedArrivalEarly, stop.plannedArrivalLate)}
            {/if}
          </div>
        </div>
        <div class="stop-actions">
          {#if stop.status === 'PENDING'}
            <button class="btn" disabled={busy} onclick={() => stopAction(stop.id, 'ARRIVED')}>
              Arrived
            </button>
          {:else if stop.status === 'ARRIVED'}
            <button class="btn" disabled={busy} onclick={() => stopAction(stop.id, 'DEPARTED')}>
              Departed
            </button>
          {:else}
            <span class="muted">
              {stop.actualDepartureAt
                ? `Departed ${new Date(stop.actualDepartureAt).toLocaleTimeString()}`
                : stop.actualArrivalAt
                  ? `Arrived ${new Date(stop.actualArrivalAt).toLocaleTimeString()}`
                  : ''}
            </span>
          {/if}
        </div>
      </div>
    {:else}
      <p class="muted">No stops on this load yet.</p>
    {/each}

    {#if podCandidates.length > 0}
      <form class="card" onsubmit={submitPod}>
        <h2 style="margin-top: 0;">Proof of delivery</h2>
        <div class="field">
          <label for="podShipment">Shipment</label>
          <select id="podShipment" bind:value={podShipmentId} required>
            <option value="" disabled>Select…</option>
            {#each podCandidates as s (s.id)}
              <option value={s.id}>{s.shipmentNumber}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="signedBy">Received by</label>
          <input id="signedBy" bind:value={signedByName} placeholder="Receiver name" />
        </div>
        <div class="field">
          <label for="podNotes">Notes</label>
          <textarea id="podNotes" rows="2" bind:value={podNotes}></textarea>
        </div>
        <div class="field">
          <label for="photo">Photo (optional)</label>
          <input
            id="photo"
            type="file"
            accept="image/*"
            capture="environment"
            onchange={(e) => (photo = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
          />
        </div>
        <button class="btn" type="submit" disabled={busy} style="width: 100%; justify-content: center;">
          Save POD
        </button>
      </form>
    {/if}
  {:else}
    <p class="muted">Loading…</p>
  {/if}
  <p class="muted" style="font-size: 11px; text-align: center;">Powered by Pulsar</p>
</div>

<style>
  /* Mobile-first: drivers open this on a phone. */
  .driver-page {
    max-width: 480px;
    margin: 0 auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .stop-card {
    padding: 14px;
  }

  .stop-head {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }

  .stop-actions .btn {
    width: 100%;
    justify-content: center;
    padding: 12px;
    font-size: 15px;
  }
</style>
