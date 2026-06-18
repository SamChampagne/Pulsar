<script lang="ts">
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Card } from '$lib/components/ui';
  import { toneFor, labelFor } from '$lib/components/ui';
  import { formatDateTime } from '$lib/format';

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
      notes?: string | null;
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

  // Signature canvas state
  let sigCanvas = $state<HTMLCanvasElement | null>(null);
  let sigDrawing = $state(false);
  let sigNotice = $state('');
  let sigBusy = $state(false);

  // Exception form state
  let showException = $state(false);
  let excKind = $state('DAMAGE');
  let excShipmentId = $state('');
  let excStopId = $state('');
  let excNote = $state('');
  let excBusy = $state(false);
  let excNotice = $state('');

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

  async function submitSignature(shipmentId: string) {
    sigBusy = true;
    sigNotice = '';
    try {
      const dataUrl = sigCanvas!.toDataURL('image/png');
      const blob = await (await fetch(dataUrl)).blob();
      const form = new FormData();
      form.append('file', blob, 'signature.png');
      const res = await fetch(`/api/v1/public/driver/${token}/pod/${shipmentId}/signature`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        sigNotice = (data as { message?: string }).message ?? 'Failed to save signature';
      } else {
        sigNotice = 'Signature saved';
        const ctx = sigCanvas?.getContext('2d');
        if (ctx && sigCanvas) ctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
      }
    } catch (e) {
      sigNotice = e instanceof Error ? e.message : 'Failed to save signature';
    } finally {
      sigBusy = false;
    }
  }

  async function submitException() {
    excBusy = true;
    excNotice = '';
    try {
      const res = await fetch(`/api/v1/public/driver/${token}/exception`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipmentId: excShipmentId || undefined,
          stopId: excStopId || undefined,
          kind: excKind,
          note: excNote,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        excNotice = (data as { message?: string }).message ?? 'Failed to report exception';
      } else {
        excNotice = 'Problème signalé';
        excKind = 'DAMAGE';
        excShipmentId = '';
        excStopId = '';
        excNote = '';
        showException = false;
      }
    } catch (e) {
      excNotice = e instanceof Error ? e.message : 'Failed to report exception';
    } finally {
      excBusy = false;
    }
  }

  const fmtWindow = (early: string | null, late?: string | null) =>
    early
      ? formatDateTime(early) + (late ? ' → ' + formatDateTime(late) : '')
      : '—';

  const podCandidates = $derived(
    view?.shipments.filter(
      (s) => !s.proofOfDelivery && (s.status === 'IN_TRANSIT' || s.status === 'DELIVERED'),
    ) ?? [],
  );

  // --- Position sharing (phase 10) ---------------------------------------
  // Immediate ping on load + on tab-visible + every 2 min while the page is
  // open and the load active. Screen locked / page closed = no pings (assumed).
  let sharing = $state(true);
  let lastSentAt = $state<number | null>(null);

  const activeLoad = $derived(view?.status === 'DISPATCHED' || view?.status === 'IN_TRANSIT');

  function sendPosition() {
    if (!sharing || !activeLoad || !('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void api(`/public/driver/${token}/position`, {
          method: 'POST',
          body: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
        })
          .then(() => (lastSentAt = Date.now()))
          .catch(() => {}); // best-effort: a failed ping never disturbs the driver
      },
      () => {}, // permission denied / unavailable: stay silent
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  }

  $effect(() => {
    if (!view || !activeLoad) return;
    sendPosition(); // fresh point on every page open (spec §B)
    const timer = setInterval(sendPosition, 120_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') sendPosition();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  });

  $effect(() => {
    if (token) void load();
  });
</script>

<!-- Mobile-first: drivers open this on a phone. -->
<div class="mx-auto flex max-w-md flex-col gap-3 p-4">
  {#if error}
    <p class="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>
  {:else if view}
    <!-- Header -->
    <div>
      <p class="text-sm text-ink-muted">{view.shipper} · {view.carrier ?? 'Internal fleet'}</p>
      <div class="flex items-center gap-3">
        <h1 class="text-xl font-bold text-ink">{view.loadNumber}</h1>
        <Badge tone={toneFor(view.status)}>{labelFor(view.status)}</Badge>
      </div>
      {#if view.notes}<p class="text-sm text-ink-muted">{view.notes}</p>{/if}
      <a
        href={`/api/v1/public/driver/${token}/bol`}
        target="_blank"
        class="mt-2 inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-muted"
      >
        Download BOL (if generated)
      </a>
    </div>

    {#if activeLoad}
      <div class="flex items-center justify-between rounded-card border border-edge bg-surface px-3 py-2 text-xs text-ink-muted">
        <span>
          {sharing ? 'Position sharing active' : 'Position sharing paused'}
          {#if sharing && lastSentAt}
            · last sent {new Date(lastSentAt).toLocaleTimeString()}
          {/if}
        </span>
        <button
          type="button"
          class="font-semibold text-accent hover:underline"
          onclick={() => (sharing = !sharing)}
        >
          {sharing ? 'Turn off' : 'Turn on'}
        </button>
      </div>
    {/if}

    {#if notice}
      <p class="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">{notice}</p>
    {/if}

    <!-- Stops -->
    {#each view.stops as stop (stop.id)}
      <Card>
        <div class="mb-3 flex items-start justify-between gap-2">
          <div>
            <p class="font-semibold text-ink">#{stop.sequence} — {stop.type}</p>
            <p class="text-sm text-ink-muted">
              {stop.location.name}<br />
              {stop.location.addressLine1}, {stop.location.city}{stop.location.state ? `, ${stop.location.state}` : ''}
            </p>
            {#if stop.notes}<p class="mt-1 text-xs text-ink-muted italic">{stop.notes}</p>{/if}
            {#if stop.plannedArrivalEarly}
              <p class="mt-1 text-xs text-ink-muted">Planned: {fmtWindow(stop.plannedArrivalEarly, stop.plannedArrivalLate)}</p>
            {/if}
          </div>
          <Badge tone={toneFor(stop.status)}>{labelFor(stop.status)}</Badge>
        </div>

        <!-- Full-width tap targets using plain button for mobile -->
        {#if stop.status === 'PENDING'}
          <button
            class="w-full rounded-md bg-accent px-3 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-hover"
            disabled={busy}
            onclick={() => stopAction(stop.id, 'ARRIVED')}
          >
            Arrived
          </button>
        {:else if stop.status === 'ARRIVED'}
          <button
            class="w-full rounded-md bg-accent px-3 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-hover"
            disabled={busy}
            onclick={() => stopAction(stop.id, 'DEPARTED')}
          >
            Departed
          </button>
        {:else}
          <p class="text-sm text-ink-muted">
            {stop.actualDepartureAt
              ? `Departed ${formatDateTime(stop.actualDepartureAt)}`
              : stop.actualArrivalAt
                ? `Arrived ${formatDateTime(stop.actualArrivalAt)}`
                : ''}
          </p>
        {/if}
      </Card>
    {:else}
      <p class="text-sm text-ink-muted">No stops on this load yet.</p>
    {/each}

    <!-- Exception report -->
    <div>
      <button
        type="button"
        class="w-full rounded-md border border-edge bg-surface px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-muted"
        onclick={() => { showException = !showException; if (!showException) excNotice = ''; }}
      >
        {showException ? 'Annuler' : 'Signaler un problème'}
      </button>
      {#if showException}
        <Card>
          <h2 class="mb-3 text-base font-semibold text-ink">Signaler un problème</h2>
          <div class="flex flex-col gap-3">
            <div>
              <label class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase" for="excKind">Type</label>
              <select id="excKind" bind:value={excKind} class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none">
                <option value="DAMAGE">Dommage</option>
                <option value="DELAY">Retard</option>
                <option value="REFUSED">Refusé</option>
                <option value="OTHER">Autre</option>
              </select>
            </div>
            <div>
              <label class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase" for="excShipment">Envoi (optionnel)</label>
              <select id="excShipment" bind:value={excShipmentId} class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none">
                <option value="">— Général —</option>
                {#each view.shipments as s (s.id)}
                  <option value={s.id}>{s.shipmentNumber}</option>
                {/each}
              </select>
            </div>
            <div>
              <label class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase" for="excStop">Arrêt (optionnel)</label>
              <select id="excStop" bind:value={excStopId} class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none">
                <option value="">— Aucun —</option>
                {#each view.stops as st (st.id)}
                  <option value={st.id}>#{st.sequence} {st.type} — {st.location.name}</option>
                {/each}
              </select>
            </div>
            <div>
              <label class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase" for="excNote">Note</label>
              <textarea id="excNote" rows={3} bind:value={excNote} class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"></textarea>
            </div>
            {#if excNotice}
              <p class="text-sm" class:text-danger={!excNotice.startsWith('Problème signalé')} class:text-success={excNotice.startsWith('Problème signalé')}>{excNotice}</p>
            {/if}
            <button
              type="button"
              disabled={excBusy}
              class="w-full rounded-md bg-accent px-3 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-hover"
              onclick={() => void submitException()}
            >
              Envoyer
            </button>
          </div>
        </Card>
      {/if}
    </div>

    <!-- POD form -->
    {#if podCandidates.length > 0}
      <Card>
        <h2 class="mb-3 text-base font-semibold text-ink">Proof of delivery</h2>
        <form onsubmit={submitPod} class="flex flex-col gap-3">
          <div>
            <label class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase" for="podShipment">Shipment</label>
            <select
              id="podShipment"
              bind:value={podShipmentId}
              required
              onchange={() => { sigNotice = ''; }}
              class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            >
              <option value="" disabled>Select…</option>
              {#each podCandidates as s (s.id)}
                <option value={s.id}>{s.shipmentNumber}</option>
              {/each}
            </select>
          </div>
          <div>
            <label class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase" for="signedBy">Received by</label>
            <input
              id="signedBy"
              bind:value={signedByName}
              placeholder="Receiver name"
              class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase" for="podNotes">Notes</label>
            <textarea
              id="podNotes"
              rows={2}
              bind:value={podNotes}
              class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            ></textarea>
          </div>
          <div>
            <label class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase" for="photo">Photo (optional)</label>
            <input
              id="photo"
              type="file"
              accept="image/*"
              capture="environment"
              class="w-full text-sm text-ink"
              onchange={(e) => (photo = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
            />
          </div>
          <div>
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase">Signature</label>
            <canvas
              bind:this={sigCanvas}
              width={340}
              height={160}
              class="w-full touch-none rounded-md border border-edge bg-white"
              onpointerdown={(e) => { sigDrawing = true; const ctx = sigCanvas!.getContext('2d')!; const r = sigCanvas!.getBoundingClientRect(); ctx.beginPath(); ctx.moveTo(e.clientX - r.left, e.clientY - r.top); }}
              onpointermove={(e) => { if (!sigDrawing) return; const ctx = sigCanvas!.getContext('2d')!; const r = sigCanvas!.getBoundingClientRect(); ctx.lineTo(e.clientX - r.left, e.clientY - r.top); ctx.stroke(); }}
              onpointerup={() => { sigDrawing = false; }}
              onpointerleave={() => { sigDrawing = false; }}
            ></canvas>
            <div class="mt-1 flex gap-2">
              <button type="button" class="text-xs text-ink-muted hover:text-ink underline" onclick={() => { const ctx = sigCanvas?.getContext('2d'); if (ctx && sigCanvas) ctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height); sigNotice = ''; }}>Effacer</button>
              <button type="button" disabled={sigBusy} class="text-xs font-semibold text-accent hover:underline disabled:opacity-50" onclick={() => { if (podShipmentId) void submitSignature(podShipmentId); else sigNotice = 'Sélectionnez un envoi d\'abord'; }}>Enregistrer signature</button>
            </div>
            {#if sigNotice}<p class="mt-1 text-xs" class:text-danger={sigNotice !== 'Signature saved'} class:text-success={sigNotice === 'Signature saved'}>{sigNotice}</p>{/if}
          </div>
          <button
            type="submit"
            disabled={busy}
            class="w-full rounded-md bg-accent px-3 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-hover"
          >
            Save POD
          </button>
        </form>
      </Card>
    {/if}

    <p class="text-center text-xs text-ink-faint">Powered by Pulsar</p>
  {:else}
    <p class="text-sm text-ink-muted">Loading…</p>
  {/if}
</div>
