<script lang="ts">
  import { X } from 'lucide-svelte';
  import { api, ApiError } from '$lib/api/client';
  import { computeDwell } from '@pulsar/shared';
  import { Badge, Button, Select } from '$lib/components/ui';
  import { toneFor } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface MoveEntry {
    id: string;
    movedAt: string;
    fromSpot: { code: string } | null;
    toSpot: { code: string } | null;
  }

  interface VisitDetail {
    id: string;
    visitNumber: string;
    status: string;
    direction: string;
    trailerRef: string | null;
    driverName: string | null;
    checkInAt: string | null;
    checkOutAt?: string | null;
    trailer: { unitNumber: string; plate: string | null } | null;
    carrier: { name: string } | null;
    spot: { code: string } | null;
    appointment: { appointmentNumber: string } | null;
    moves: MoveEntry[];
  }

  interface FreeSpot {
    id: string;
    code: string;
    type: string;
  }

  let {
    visitId,
    freeSpots = [] as FreeSpot[],
    onClose,
    onMoved,
    onCheckedOut,
  }: {
    visitId: string;
    freeSpots: FreeSpot[];
    onClose: () => void;
    onMoved: () => void;
    onCheckedOut: () => void;
  } = $props();

  let visit = $state<VisitDetail | null>(null);
  let loading = $state(true);
  let error = $state('');
  let moveSpotId = $state('');
  let moving = $state(false);
  let checkingOut = $state(false);

  $effect(() => {
    const id = visitId;
    loading = true;
    error = '';
    visit = null;
    moveSpotId = '';
    api<VisitDetail>(`/yard/visits/${id}`)
      .then((v) => {
        if (visitId === id) visit = v;
      })
      .catch((e) => {
        if (visitId === id)
          error = e instanceof ApiError ? e.message : 'Échec du chargement de la visite';
      })
      .finally(() => {
        if (visitId === id) loading = false;
      });
  });

  // Live dwell tick.
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  function formatDwell(ms: number): string {
    if (ms < 0) ms = 0;
    const totalMin = Math.floor(ms / 60000);
    if (totalMin < 60) return `${totalMin}m`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}h ${m}m`;
  }

  const dwell = $derived(
    visit?.checkInAt ? formatDwell(now - new Date(visit.checkInAt).getTime()) : null,
  );
  const dwellInfo = $derived(
    visit?.checkInAt
      ? computeDwell(
          { checkInAt: visit.checkInAt, checkOutAt: visit.checkOutAt ?? null },
          new Date(now),
        )
      : null,
  );

  function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('fr-CA', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function trailerLabel(v: VisitDetail): string {
    if (v.trailer)
      return v.trailer.plate
        ? `${v.trailer.unitNumber} (${v.trailer.plate})`
        : v.trailer.unitNumber;
    return v.trailerRef ?? '—';
  }

  async function doMove() {
    if (!moveSpotId) {
      toast.error('Sélectionnez un spot libre');
      return;
    }
    moving = true;
    try {
      await api(`/yard/visits/${visitId}/move`, { method: 'POST', body: { spotId: moveSpotId } });
      toast.success('Visite déplacée');
      onMoved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du déplacement');
    } finally {
      moving = false;
    }
  }

  async function doCheckOut() {
    checkingOut = true;
    try {
      await api(`/yard/visits/${visitId}/check-out`, { method: 'POST' });
      toast.success('Check-out effectué');
      onCheckedOut();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du check-out');
    } finally {
      checkingOut = false;
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window {onkeydown} />

<!-- Backdrop -->
<div
  class="fixed inset-0 z-30 bg-black/30"
  role="button"
  tabindex="-1"
  aria-label="Fermer"
  onclick={onClose}
  onkeydown={(e) => {
    if (e.key === 'Enter') onClose();
  }}
></div>

<aside
  class="fixed top-0 right-0 z-40 flex h-full w-[360px] flex-col border-l border-edge bg-surface shadow-pop"
  aria-label="Détail de la visite"
>
  <div class="flex items-center justify-between border-b border-edge px-4 py-3">
    <div class="flex min-w-0 items-center gap-2">
      <h2 class="truncate text-sm font-bold text-ink">{visit?.visitNumber ?? 'Visite'}</h2>
      {#if visit}<Badge tone={toneFor(visit.status)}>{visit.status}</Badge>{/if}
    </div>
    <button class="text-ink-faint hover:text-ink" onclick={onClose} aria-label="Fermer">
      <X class="size-4" />
    </button>
  </div>

  <div class="flex-1 overflow-y-auto p-4">
    {#if loading}
      <p class="text-sm text-ink-muted">Chargement…</p>
    {:else if error}
      <p class="text-sm text-danger">{error}</p>
    {:else if visit}
      <dl class="space-y-2.5 text-sm">
        <div class="flex justify-between gap-2">
          <dt class="text-ink-muted">Remorque</dt>
          <dd class="text-right font-medium text-ink">{trailerLabel(visit)}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-ink-muted">Transporteur</dt>
          <dd class="text-right text-ink">{visit.carrier?.name ?? '—'}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-ink-muted">Chauffeur</dt>
          <dd class="text-right text-ink">{visit.driverName ?? '—'}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-ink-muted">Direction</dt>
          <dd class="text-right text-ink">{visit.direction}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-ink-muted">Check-in</dt>
          <dd class="text-right text-ink">{fmtDate(visit.checkInAt)}</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-ink-muted">Séjour</dt>
          <dd class="flex items-center justify-end gap-2 text-right font-semibold text-warn">
            {dwell ?? '—'}
            {#if dwellInfo && dwellInfo.status === 'DETENTION'}
              <Badge tone="danger">Détention +{dwellInfo.detentionMinutes}m</Badge>
            {:else if dwellInfo && dwellInfo.status === 'WARNING'}
              <Badge tone="warn">Bientôt</Badge>
            {/if}
          </dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-ink-muted">Spot actuel</dt>
          <dd class="text-right text-ink">{visit.spot?.code ?? '—'}</dd>
        </div>
        {#if visit.appointment}
          <div class="flex justify-between gap-2">
            <dt class="text-ink-muted">Rendez-vous</dt>
            <dd class="text-right text-ink">{visit.appointment.appointmentNumber}</dd>
          </div>
        {/if}
      </dl>

      <!-- Move log -->
      <div class="mt-5">
        <h3 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
          Journal des mouvements
        </h3>
        {#if visit.moves.length === 0}
          <p class="text-xs text-ink-faint">Aucun mouvement.</p>
        {:else}
          <ol class="space-y-1.5 border-l border-edge pl-3">
            {#each visit.moves as m (m.id)}
              <li class="text-xs">
                <span class="font-medium text-ink">
                  {m.fromSpot?.code ?? '—'} → {m.toSpot?.code ?? 'sortie'}
                </span>
                <span class="text-ink-faint"> · {fmtDate(m.movedAt)}</span>
              </li>
            {/each}
          </ol>
        {/if}
      </div>

      <!-- Move action -->
      <div class="mt-5">
        <h3 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
          Déplacer vers
        </h3>
        <Select bind:value={moveSpotId}>
          <option value="">— Choisir un spot libre —</option>
          {#each freeSpots as s (s.id)}
            <option value={s.id}>{s.code} ({s.type})</option>
          {/each}
        </Select>
        {#if freeSpots.length === 0}
          <p class="mt-1 text-xs text-ink-faint">Aucun spot libre disponible.</p>
        {/if}
      </div>
    {/if}
  </div>

  {#if visit && !loading && !error}
    <div class="flex gap-2 border-t border-edge px-4 py-3">
      <Button variant="secondary" loading={moving} disabled={!moveSpotId} onclick={doMove}
        >Déplacer</Button
      >
      <Button variant="danger" loading={checkingOut} onclick={doCheckOut}>Check-out</Button>
    </div>
  {/if}
</aside>
