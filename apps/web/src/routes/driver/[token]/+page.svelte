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
      ? formatDateTime(early) + (late ? ' → ' + formatDateTime(late) : '')
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

    <!-- Shipments list -->
    {#if view.shipments.length > 0}
      <Card>
        <h2 class="mb-3 text-base font-semibold text-ink">Shipments</h2>
        <ul class="flex flex-col gap-2">
          {#each view.shipments as s (s.id)}
            <li class="flex items-center justify-between text-sm">
              <span class="text-ink">{s.shipmentNumber}</span>
              <Badge tone={toneFor(s.status)}>{labelFor(s.status)}</Badge>
            </li>
          {/each}
        </ul>
      </Card>
    {/if}

    <p class="text-center text-xs text-ink-faint">Powered by Pulsar</p>
  {:else}
    <p class="text-sm text-ink-muted">Loading…</p>
  {/if}
</div>
