<script lang="ts">
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import PublicShell from '$lib/components/PublicShell.svelte';
  import { Badge, Button, Card, Field, Input } from '$lib/components/ui';
  import { toneFor, labelFor } from '$lib/components/ui';
  import { formatDateTime } from '$lib/format';

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
      ? formatDateTime(early) + (late ? ' → ' + formatDateTime(late) : '')
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

<PublicShell maxWidth="max-w-2xl">
  {#if error}
    <p class="text-sm text-danger">{error}</p>
  {:else if tender}
    <p class="mb-1 text-sm text-ink-muted">Transport offer from <strong>{tender.shipper}</strong></p>
    <div class="mb-1 flex items-center gap-3">
      <h1 class="text-xl font-bold text-ink">{tender.load.loadNumber}</h1>
      <Badge tone={toneFor(tender.status)}>{labelFor(tender.status)}</Badge>
    </div>
    <p class="mb-4 text-sm text-ink-muted">
      For {tender.carrier} · expires {formatDateTime(tender.expiresAt)}
    </p>

    {#if tender.load.notes}
      <p class="mb-4 text-sm text-ink">{tender.load.notes}</p>
    {/if}
    {#if tender.message}
      <p class="mb-4 text-sm text-ink">{tender.message}</p>
    {/if}

    <Card>
      <p class="text-sm text-ink">
        <strong>{tender.load.shipments.length}</strong> shipment(s) ·
        <strong>{totalWeight.toLocaleString()}</strong> kg ·
        <strong>{totalPallets}</strong> pallets
        {#if tender.load.route?.totalDistanceKm}
          · {tender.load.route.totalDistanceKm} km
        {/if}
      </p>
    </Card>

    {#if tender.load.route}
      <div class="mt-4 overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-edge text-left text-xs font-semibold text-ink-muted uppercase tracking-wide">
              <th class="pb-2 pr-4">#</th>
              <th class="pb-2 pr-4">Type</th>
              <th class="pb-2 pr-4">Location</th>
              <th class="pb-2">Planned window</th>
            </tr>
          </thead>
          <tbody>
            {#each tender.load.route.stops as stop (stop.sequence)}
              <tr class="border-b border-edge last:border-0">
                <td class="py-2 pr-4 text-ink-muted">{stop.sequence}</td>
                <td class="py-2 pr-4 font-medium text-ink">{stop.type}</td>
                <td class="py-2 pr-4 text-ink">
                  {stop.location.name}, {stop.location.city}{stop.location.state ? `, ${stop.location.state}` : ''}
                </td>
                <td class="py-2 text-ink-muted">{fmtWindow(stop.plannedArrivalEarly, stop.plannedArrivalLate)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    {#if tender.status === 'PENDING'}
      <div class="mt-6 flex gap-3">
        <Button variant="primary" disabled={busy} onclick={() => respond(true)}>Accept</Button>
        <Button variant="danger" disabled={busy} onclick={() => { showDecline = !showDecline; }}>
          Decline
        </Button>
      </div>
      {#if showDecline}
        <div class="mt-4 flex flex-col gap-3">
          <Field label="Reason (optional)">
            <Input bind:value={declineReason} placeholder="No capacity this week" />
          </Field>
          <Button variant="danger" disabled={busy} onclick={() => respond(false)}>
            Confirm decline
          </Button>
        </div>
      {/if}
    {:else if tender.status === 'ACCEPTED'}
      <p class="mt-4 text-sm text-ok">Offer accepted. The shipper will dispatch the load.</p>
    {:else if tender.status === 'DECLINED'}
      <p class="mt-4 text-sm text-ink-muted">This offer was declined.</p>
    {:else}
      <p class="mt-4 text-sm text-ink-muted">This offer is no longer open ({tender.status.toLowerCase()}).</p>
    {/if}

    <p class="mt-6 text-center text-xs text-ink-faint">Powered by Pulsar</p>
  {:else}
    <p class="text-sm text-ink-muted">Loading…</p>
  {/if}
</PublicShell>
