<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Button, Card } from '$lib/components/ui';
  import DriverPackagesPanel from '$lib/components/loads/DriverPackagesPanel.svelte';
  import { toneFor, labelFor } from '$lib/components/ui';
  import { formatDateTime, formatTime } from '$lib/format';
  import type { PublicDriverDocuments } from '@pulsar/shared';

  interface DriverView {
    shipper: string;
    carrier: string | null;
    loadNumber: string;
    status: string;
    shipments: {
      id: string;
      shipmentNumber: string;
      status: string;
      hasPod: boolean;
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

  const token = $derived(page.params.token ?? '');

  let view = $state<DriverView | null>(null);
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);
  let loading = $state(false);
  let online = $state(true);
  let refreshVersion = $state(0);
  let driverDocuments = $state<PublicDriverDocuments | null>(null);
  let documentsLoading = $state(false),
    documentBusy = $state(false),
    documentsError = $state('');
  let documentGeneration = 0;

  async function loadDocuments(currentToken: string, status: string) {
    const generation = ++documentGeneration;
    driverDocuments = null;
    documentsError = '';
    documentBusy = false;
    if (!['DISPATCHED', 'IN_TRANSIT'].includes(status)) {
      documentsLoading = false;
      return;
    }
    documentsLoading = true;
    try {
      const result = await api<PublicDriverDocuments>(
        `/public/driver/${encodeURIComponent(currentToken)}/documents`,
      );
      if (currentToken === token && generation === documentGeneration) driverDocuments = result;
    } catch (e) {
      if (currentToken === token && generation === documentGeneration)
        documentsError =
          e instanceof Error
            ? e.message
            : 'Document de tournée indisponible. Contactez l’exploitation.';
    } finally {
      if (currentToken === token && generation === documentGeneration) documentsLoading = false;
    }
  }

  async function downloadDriverDocument(item: PublicDriverDocuments['documents'][number]) {
    if (
      !item.ready ||
      documentBusy ||
      loading ||
      documentsLoading ||
      !online ||
      !activeLoad ||
      error
    )
      return;
    const currentToken = token,
      generation = documentGeneration;
    documentBusy = true;
    documentsError = '';
    try {
      const response = await fetch(
        `/api/v1/public/driver/${encodeURIComponent(currentToken)}/documents/${encodeURIComponent(item.ref)}/file`,
        { cache: 'no-store', referrerPolicy: 'no-referrer' },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          payload?.message ?? 'Téléchargement indisponible. Contactez l’exploitation.',
        );
      }
      if (!response.headers.get('content-type')?.includes('application/pdf'))
        throw new Error('Réponse de document invalide. Aucun fichier téléchargé.');
      const blob = await response.blob();
      if (blob.size > 10 * 1024 * 1024 || (await blob.slice(0, 5).text()) !== '%PDF-')
        throw new Error('PDF invalide. Aucun fichier téléchargé.');
      if (currentToken !== token || generation !== documentGeneration || !activeLoad) return;
      const url = URL.createObjectURL(blob),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${item.number}-r${item.revision}.pdf`.replace(/[^\w.-]/g, '_');
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      if (currentToken === token && generation === documentGeneration) {
        driverDocuments = null;
        documentsError = `${e instanceof Error ? e.message : 'PDF indisponible.'} Actualisez la mission avant de réessayer.`;
      }
    } finally {
      if (currentToken === token && generation === documentGeneration) documentBusy = false;
    }
  }

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
    const currentToken = token;
    loading = true;
    error = '';
    try {
      const result = await api<DriverView>(`/public/driver/${encodeURIComponent(currentToken)}`);
      if (token !== currentToken) return;
      view = result;
      refreshVersion++;
      void loadDocuments(currentToken, result.status);
    } catch (e) {
      if (token === currentToken)
        error =
          e instanceof ApiError
            ? e.message
            : 'Mission indisponible. Vérifiez votre connexion ou contactez la régulation.';
    } finally {
      if (token === currentToken) loading = false;
    }
  }

  async function requestPod(ref: string) {
    if (loadClosed) return;
    await load();
    if (!podCandidates.some((s) => s.id === ref)) {
      notice =
        'La preuve de livraison n’est pas disponible pour cette expédition. Actualisez la mission ou contactez la régulation.';
      return;
    }
    podShipmentId = ref;
    await tick();
    document.getElementById('pod-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('signedBy')?.focus({ preventScroll: true });
  }

  async function stopAction(stopId: string, status: 'ARRIVED' | 'DEPARTED') {
    if (loadClosed || loading || busy || !online || error) return;
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
    if (loadClosed || loading || busy || !online || error) return;
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
    if (loadClosed || loading || sigBusy || !online || error) return;
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
    if (loadClosed || loading || excBusy || !online || error || !excNote.trim()) return;
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
    early ? formatDateTime(early) + (late ? ' → ' + formatDateTime(late) : '') : '—';

  // A COMPLETED/CANCELLED load is closed — the server blocks all driver mutations (state
  // machine is source of truth), so the UI hides stop actions + POD capture to match.
  const loadClosed = $derived(view?.status === 'COMPLETED' || view?.status === 'CANCELLED');

  const podCandidates = $derived(
    loadClosed
      ? []
      : (view?.shipments.filter(
          (s) => !s.hasPod && (s.status === 'IN_TRANSIT' || s.status === 'DELIVERED'),
        ) ?? []),
  );

  // --- Position sharing (phase 10) ---------------------------------------
  // Explicit opt-in for this open mission; never persist or silently restore consent.
  let sharing = $state(false);
  let lastSentAt = $state<number | null>(null);

  const activeLoad = $derived(view?.status === 'DISPATCHED' || view?.status === 'IN_TRANSIT');

  function sendPosition() {
    if (!sharing || !activeLoad || !online || error || !('geolocation' in navigator)) return;
    const currentToken = token;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!sharing || !activeLoad || token !== currentToken) return;
        void api(`/public/driver/${encodeURIComponent(currentToken)}/position`, {
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
    if (!view || !activeLoad || !sharing) return;
    untrack(sendPosition);
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
    token;
    untrack(() => {
      view = null;
      sharing = false;
      lastSentAt = null;
      notice = '';
      podShipmentId = '';
      signedByName = '';
      podNotes = '';
      photo = null;
      showException = false;
      ++documentGeneration;
      driverDocuments = null;
      documentsError = '';
      documentsLoading = false;
      documentBusy = false;
      if (token) void load();
    });
  });
  onMount(() => {
    const update = () => {
      online = navigator.onLine;
    };
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  });
</script>

<svelte:head
  ><title>Mission chauffeur · Pulsar</title><meta name="robots" content="noindex,nofollow" /><meta
    name="referrer"
    content="no-referrer"
  /></svelte:head
>

<!-- Mobile-first: drivers open this on a phone. -->
<main class="mx-auto flex max-w-md flex-col gap-4 p-4 pb-8">
  {#if error}
    <p class="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>
    <Button variant="secondary" onclick={load} disabled={loading || !online}
      >Actualiser la mission</Button
    >
  {:else if view}
    <!-- Header -->
    <div>
      <p class="text-sm text-ink-muted">{view.shipper} · {view.carrier ?? 'Flotte interne'}</p>
      <div class="flex items-center gap-3">
        <h1 class="text-xl font-bold text-ink">{view.loadNumber}</h1>
        <Badge tone={toneFor(view.status)}>{labelFor(view.status)}</Badge>
      </div>
      <div class="mt-3">
        <Button variant="secondary" onclick={load} disabled={loading || busy || !online}
          >Actualiser la mission</Button
        >
      </div>
    </div>

    {#if activeLoad}
      <Card>
        <section aria-label="Document de tournée chauffeur">
          <h2 class="text-sm font-semibold">Document de tournée</h2>
          {#if documentsLoading}<p class="mt-2 text-xs text-ink-muted" role="status">
              Vérification de la publication…
            </p>
          {:else if documentsError}<p class="mt-2 text-sm text-danger" role="alert">
              {documentsError}
            </p>
          {:else if driverDocuments?.documents.length}
            {#each driverDocuments.documents as item (item.ref)}
              <p class="mt-2 font-mono text-sm">{item.number} · édition {item.revision}</p>
              <p class="mt-1 text-xs text-ink-muted">Publié le {formatDateTime(item.issuedAt)}</p>
              {#if !item.ready}<p class="mt-2 text-xs text-ink-muted">
                  L’exploitation doit encore préparer le PDF.
                </p>{/if}
              <div class="mt-3">
                <Button
                  variant="secondary"
                  onclick={() => downloadDriverDocument(item)}
                  loading={documentBusy}
                  disabled={!item.ready || documentsLoading || loading || !online}
                  >Télécharger le document de tournée</Button
                >
              </div>
            {/each}
            <p class="mt-3 text-xs text-ink-muted">
              Copie figée des adresses et codes colis. Ni connaissement réglementaire, ni preuve de
              livraison. Vérifiez la mission en ligne après un changement.
            </p>
          {:else}<p class="mt-2 text-sm text-ink-muted">
              {driverDocuments?.message ?? 'Aucun document publié. Contactez l’exploitation.'}
            </p>{/if}
        </section>
      </Card>
    {/if}

    {#if activeLoad}
      <div
        class="flex items-center justify-between rounded-card border border-edge bg-surface px-3 py-2 text-xs text-ink-muted"
      >
        <span>
          {sharing ? 'Partage de position actif' : 'Position non partagée'}
          {#if sharing && lastSentAt}
            · envoyée à {formatTime(new Date(lastSentAt).toISOString())}
          {/if}
        </span>
        <button
          type="button"
          class="font-semibold text-accent hover:underline"
          onclick={() => (sharing = !sharing)}
        >
          {sharing ? 'Arrêter' : 'Partager ma position'}
        </button>
      </div>
    {/if}

    {#if !online}<p role="status" class="rounded-md bg-warn-soft p-3 text-sm">
        Vous êtes hors connexion. Aucune action n’est envoyée automatiquement à la reconnexion.
      </p>{/if}

    <DriverPackagesPanel
      {token}
      refreshKey={refreshVersion}
      onChange={load}
      onRequestPod={requestPod}
      disabled={loading || busy || !!error}
    />

    {#if loadClosed}
      <p class="rounded-md border border-edge bg-surface px-4 py-3 text-sm text-ink-muted">
        Ce chargement est clôturé ({labelFor(view.status)}). Aucune action n'est possible.
      </p>
    {/if}

    {#if notice}
      <p class="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">{notice}</p>
    {/if}

    <h2 class="mt-2 text-base font-semibold">Arrêts de la tournée</h2>
    {#each view.stops as stop (stop.id)}
      <Card>
        <div class="mb-3 flex items-start justify-between gap-2">
          <div>
            <p class="font-semibold text-ink">
              #{stop.sequence} — {stop.type === 'PICKUP' ? 'Ramassage' : 'Livraison'}
            </p>
            <p class="text-sm text-ink-muted">
              {stop.location.name}<br />
              {stop.location.addressLine1}, {stop.location.city}{stop.location.state
                ? `, ${stop.location.state}`
                : ''}
            </p>
            {#if stop.plannedArrivalEarly}
              <p class="mt-1 text-xs text-ink-muted">
                Prévu : {fmtWindow(stop.plannedArrivalEarly, stop.plannedArrivalLate)}
              </p>
            {/if}
          </div>
          <Badge tone={toneFor(stop.status)}>{labelFor(stop.status)}</Badge>
        </div>

        <!-- Full-width tap targets using plain button for mobile -->
        {#if loadClosed}
          <p class="text-sm text-ink-muted">
            {stop.actualDepartureAt
              ? `Departed ${formatDateTime(stop.actualDepartureAt)}`
              : stop.actualArrivalAt
                ? `Arrived ${formatDateTime(stop.actualArrivalAt)}`
                : '—'}
          </p>
        {:else if stop.status === 'PENDING'}
          <button
            class="w-full rounded-md bg-accent px-3 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-hover"
            disabled={busy || loading || !online}
            onclick={() => stopAction(stop.id, 'ARRIVED')}
          >
            Confirmer l’arrivée
          </button>
        {:else if stop.status === 'ARRIVED'}
          <button
            class="w-full rounded-md bg-accent px-3 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-hover"
            disabled={busy || loading || !online}
            onclick={() => stopAction(stop.id, 'DEPARTED')}
          >
            Confirmer le départ
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
      <p class="text-sm text-ink-muted">Aucun arrêt déclaré pour cette mission.</p>
    {/each}

    <!-- Legacy mission-level incident complements package-specific reports. -->
    {#if !loadClosed}
      <div>
        <button
          type="button"
          class="w-full rounded-md border border-edge bg-surface px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-muted"
          onclick={() => {
            showException = !showException;
            if (!showException) excNotice = '';
          }}
        >
          {showException ? 'Annuler' : 'Signaler un problème de tournée'}
        </button>
        {#if showException}
          <Card>
            <h2 class="mb-3 text-base font-semibold text-ink">Signaler un problème</h2>
            <div class="flex flex-col gap-3">
              <div>
                <label
                  class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase"
                  for="excKind">Type</label
                >
                <select
                  id="excKind"
                  bind:value={excKind}
                  class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                >
                  <option value="DAMAGE">Dommage</option>
                  <option value="DELAY">Retard</option>
                  <option value="REFUSED">Refusé</option>
                  <option value="OTHER">Autre</option>
                </select>
              </div>
              <div>
                <label
                  class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase"
                  for="excShipment">Envoi (optionnel)</label
                >
                <select
                  id="excShipment"
                  bind:value={excShipmentId}
                  class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                >
                  <option value="">— Général —</option>
                  {#each view.shipments as s (s.id)}
                    <option value={s.id}>{s.shipmentNumber}</option>
                  {/each}
                </select>
              </div>
              <div>
                <label
                  class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase"
                  for="excStop">Arrêt (optionnel)</label
                >
                <select
                  id="excStop"
                  bind:value={excStopId}
                  class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                >
                  <option value="">— Aucun —</option>
                  {#each view.stops as st (st.id)}
                    <option value={st.id}>#{st.sequence} {st.type} — {st.location.name}</option>
                  {/each}
                </select>
              </div>
              <div>
                <label
                  class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase"
                  for="excNote">Note</label
                >
                <textarea
                  id="excNote"
                  rows={3}
                  bind:value={excNote}
                  maxlength={1000}
                  class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                ></textarea>
              </div>
              {#if excNotice}
                <p
                  class="text-sm"
                  class:text-danger={!excNotice.startsWith('Problème signalé')}
                  class:text-success={excNotice.startsWith('Problème signalé')}
                >
                  {excNotice}
                </p>
              {/if}
              <button
                type="button"
                disabled={excBusy || loading || !online || !excNote.trim()}
                class="w-full rounded-md bg-accent px-3 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-hover"
                onclick={() => void submitException()}
              >
                Envoyer
              </button>
            </div>
          </Card>
        {/if}
      </div>
    {/if}

    <!-- POD form -->
    {#if podCandidates.length > 0}
      <section id="pod-section" aria-label="Preuve de livraison">
        <Card>
          <h2 class="mb-3 text-base font-semibold text-ink">Preuve de livraison</h2>
          <form onsubmit={submitPod} class="flex flex-col gap-3">
            <div>
              <label
                class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase"
                for="podShipment">Expédition</label
              >
              <select
                id="podShipment"
                bind:value={podShipmentId}
                required
                onchange={() => {
                  sigNotice = '';
                }}
                class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              >
                <option value="" disabled>Choisir une expédition…</option>
                {#each podCandidates as s (s.id)}
                  <option value={s.id}>{s.shipmentNumber}</option>
                {/each}
              </select>
            </div>
            <div>
              <label
                class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase"
                for="signedBy">Nom du destinataire</label
              >
              <input
                id="signedBy"
                bind:value={signedByName}
                placeholder="Nom de la personne qui reçoit"
                maxlength={120}
                class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
            <div>
              <label
                class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase"
                for="podNotes">Notes</label
              >
              <textarea
                id="podNotes"
                rows={2}
                bind:value={podNotes}
                maxlength={1000}
                class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              ></textarea>
            </div>
            <div>
              <label
                class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase"
                for="photo">Photo (facultatif)</label
              >
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
              <label class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase"
                >Signature</label
              >
              <canvas
                bind:this={sigCanvas}
                width={340}
                height={160}
                class="w-full touch-none rounded-md border border-edge bg-white"
                onpointerdown={(e) => {
                  sigDrawing = true;
                  const ctx = sigCanvas!.getContext('2d')!;
                  const r = sigCanvas!.getBoundingClientRect();
                  ctx.beginPath();
                  ctx.moveTo(e.clientX - r.left, e.clientY - r.top);
                }}
                onpointermove={(e) => {
                  if (!sigDrawing) return;
                  const ctx = sigCanvas!.getContext('2d')!;
                  const r = sigCanvas!.getBoundingClientRect();
                  ctx.lineTo(e.clientX - r.left, e.clientY - r.top);
                  ctx.stroke();
                }}
                onpointerup={() => {
                  sigDrawing = false;
                }}
                onpointerleave={() => {
                  sigDrawing = false;
                }}
              ></canvas>
              <div class="mt-1 flex gap-2">
                <button
                  type="button"
                  class="text-xs text-ink-muted hover:text-ink underline"
                  onclick={() => {
                    const ctx = sigCanvas?.getContext('2d');
                    if (ctx && sigCanvas) ctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
                    sigNotice = '';
                  }}>Effacer</button
                >
                <button
                  type="button"
                  disabled={sigBusy || loading || !online}
                  class="text-xs font-semibold text-accent hover:underline disabled:opacity-50"
                  onclick={() => {
                    if (podShipmentId) void submitSignature(podShipmentId);
                    else sigNotice = "Sélectionnez un envoi d'abord";
                  }}>Enregistrer signature</button
                >
              </div>
              {#if sigNotice}<p
                  class="mt-1 text-xs"
                  class:text-danger={sigNotice !== 'Signature saved'}
                  class:text-success={sigNotice === 'Signature saved'}
                >
                  {sigNotice}
                </p>{/if}
            </div>
            <button
              type="submit"
              disabled={busy || loading || !online}
              class="w-full rounded-md bg-accent px-3 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-accent-hover"
            >
              Enregistrer la preuve de livraison
            </button>
          </form>
        </Card>
      </section>
    {/if}

    <p class="text-center text-xs text-ink-faint">Mission sécurisée · Pulsar</p>
  {:else}
    <p class="text-sm text-ink-muted">Chargement de la mission…</p>
  {/if}
</main>
