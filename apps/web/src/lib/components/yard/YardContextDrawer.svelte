<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api, ApiError } from '$lib/api/client';
  import {
    computeDwell,
    PERMISSIONS,
    yardDirectionLabel,
    yardSpotLabel,
    yardStatusLabel,
    type YardWorkspaceVisit,
  } from '@pulsar/shared';
  import { Badge, Button, Drawer, ErrorNotice, Field, Select, Skeleton } from '$lib/components/ui';
  import { auth } from '$lib/stores/auth';
  import { confirmAction } from '$lib/stores/confirmation';
  import YardDossiers from './YardDossiers.svelte';
  let {
    visitId,
    freeSpots,
    timeZone = 'UTC',
    actionsDisabled = false,
    siteId,
    onClose,
    onMoved,
    onCheckedOut,
  }: {
    visitId: string;
    freeSpots: { id: string; code: string; type: string }[];
    timeZone?: string;
    actionsDisabled?: boolean;
    siteId: string;
    onClose: () => void;
    onMoved: () => void | Promise<void>;
    onCheckedOut: () => void | Promise<void>;
  } = $props();
  type Detail = YardWorkspaceVisit & {
    locationId: string;
    checkOutAt: string | null;
    notes: string | null;
    spot: { code: string } | null;
    appointment: { appointmentNumber: string } | null;
    moves: {
      id: string;
      movedAt: string;
      note: string | null;
      fromSpot: { code: string } | null;
      toSpot: { code: string } | null;
    }[];
  };
  let open = $state(true),
    visit = $state<Detail | null>(null),
    loading = $state(true),
    error = $state(''),
    actionError = $state(''),
    moveSpotId = $state(''),
    busy = $state(false),
    linksBusy = $state(false),
    now = $state(Date.now());
  let generation = 0;
  const canManage = $derived(
    !actionsDisabled && !!$auth?.user.permissions.includes(PERMISSIONS.YARD.MANAGE),
  );
  const active = $derived(!!visit && ['CHECKED_IN', 'ASSIGNED'].includes(visit.status));
  const dwell = $derived(
    visit
      ? computeDwell({ checkInAt: visit.checkInAt, checkOutAt: visit.checkOutAt }, new Date(now))
      : null,
  );
  async function load(id = visitId) {
    const request = ++generation;
    loading = true;
    error = '';
    visit = null;
    try {
      const v = await api<Detail>(`/yard/visits/${id}`);
      if (v.locationId !== siteId)
        throw new Error('Cette visite ne correspond pas au site sélectionné.');
      if (request === generation) visit = v;
    } catch (e) {
      if (request === generation) error = e instanceof Error ? e.message : 'Visite indisponible.';
    } finally {
      if (request === generation) loading = false;
    }
  }
  $effect(() => {
    const id = visitId;
    moveSpotId = '';
    actionError = '';
    void load(id);
  });
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 30000);
    return () => clearInterval(t);
  });
  onDestroy(() => generation++);
  const fmt = (s: string) => new Date(s).toLocaleString('fr-CA', { timeZone });
  async function act(kind: 'move' | 'check-out') {
    if (busy || linksBusy || !canManage || !active || !visit) return;
    busy = true;
    actionError = '';
    const target = freeSpots.find((s) => s.id === moveSpotId);
    try {
      if (kind === 'move' && !target) return;
      if (
        !(await confirmAction(
          kind === 'move'
            ? `Déplacer ${visit.visitNumber} vers ${target!.code} ? Le serveur revérifiera la disponibilité.`
            : `Enregistrer le départ de ${visit.visitNumber} et libérer son emplacement ? Cette action ne termine pas un chargement ou une réception.`,
          {
            title: kind === 'move' ? 'Confirmer l’affectation' : 'Enregistrer le départ',
            confirmLabel: kind === 'move' ? 'Affecter' : 'Confirmer le départ',
            dangerous: kind === 'check-out',
          },
        ))
      )
        return;
      await api(`/yard/visits/${visitId}/${kind === 'move' && !visit.spotId ? 'assign' : kind}`, {
        method: 'POST',
        body: kind === 'move' ? { spotId: moveSpotId } : {},
      });
      if (kind === 'check-out') {
        await onCheckedOut();
        open = false;
        onClose();
      } else {
        moveSpotId = '';
        await load();
        await onMoved();
      }
    } catch (e) {
      actionError =
        e instanceof ApiError
          ? e.message
          : 'Réponse non confirmée. Vérifiez la visite avant de réessayer.';
    } finally {
      busy = false;
    }
  }
</script>

<Drawer
  bind:open
  title={visit ? `Visite ${visit.visitNumber}` : 'Dossier de visite'}
  width="lg"
  dismissible={!busy && !linksBusy}
  onclose={onClose}
>
  {#if loading}<Skeleton rows={5} />{:else if error}<ErrorNotice
      message={error}
      onretry={() => load()}
    />{:else if visit}
    <div class="mb-5 flex flex-wrap items-center gap-2">
      <Badge tone={active ? 'info' : 'neutral'}>{yardStatusLabel(visit.status)}</Badge><span
        class="text-sm text-ink-muted">{yardDirectionLabel(visit.direction)}</span
      >
    </div>
    <h3 class="text-2xl font-semibold tracking-tight">
      {visit.trailer?.unitNumber ?? visit.trailerRef ?? 'Remorque non renseignée'}
    </h3>
    <p class="mt-1 text-sm text-ink-muted">{visit.carrier?.name ?? 'Transporteur non renseigné'}</p>
    <dl class="my-6 grid grid-cols-2 gap-4 text-sm">
      <div>
        <dt class="text-xs text-ink-muted">Emplacement</dt>
        <dd class="mt-1 font-medium">{visit.spot?.code ?? 'À affecter'}</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">Présence en cour</dt>
        <dd class={`mt-1 font-mono ${dwell?.status === 'DETENTION' ? 'text-danger' : ''}`}>
          {dwell?.minutes ?? 0} min
        </dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">Chauffeur</dt>
        <dd class="mt-1">{visit.driverName ?? '—'}</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">Arrivée · {timeZone}</dt>
        <dd class="mt-1">{fmt(visit.checkInAt)}</dd>
      </div>
    </dl>
    {#if visit.appointment}<p class="mb-4 rounded-md bg-surface-muted p-3 text-sm">
        Rendez-vous lié · <strong>{visit.appointment.appointmentNumber}</strong>
      </p>{/if}
    {#if visit.notes}<p class="mb-4 whitespace-pre-wrap text-sm">{visit.notes}</p>{/if}
    <h3 class="mb-3 text-sm font-semibold">Historique des déplacements</h3>
    <ol class="space-y-3 border-l border-edge pl-4">
      {#each visit.moves as m (m.id)}<li>
          <p class="text-sm">
            {m.fromSpot?.code ?? 'Entrée'} → {m.toSpot?.code ?? 'Sortie de cour'}
          </p>
          <p class="text-xs text-ink-muted">{fmt(m.movedAt)}{m.note ? ` · ${m.note}` : ''}</p>
        </li>{:else}<li class="text-sm text-ink-muted">Aucun déplacement enregistré.</li>{/each}
    </ol>
    {#if canManage && active}<div class="mt-6 border-t border-edge pt-4">
        <Field label="Emplacement de destination"
          ><Select bind:value={moveSpotId} disabled={busy || linksBusy}
            ><option value="">Choisir un emplacement libre</option
            >{#each freeSpots as s (s.id)}<option value={s.id}
                >{s.code} · {yardSpotLabel(s.type)}</option
              >{/each}</Select
          ></Field
        >
        <p class="mt-2 text-xs text-ink-muted">
          Seulement les emplacements libres du site. La disponibilité est revérifiée à la
          confirmation.
        </p>
      </div>{/if}
    <YardDossiers
      sourceType="visit"
      sourceId={visitId}
      disabled={busy || actionsDisabled}
      bind:working={linksBusy}
      onNavigate={onClose}
    />
  {/if}
  <div class="mt-4"><ErrorNotice message={actionError} /></div>
  {#snippet footer()}{#if canManage && active}<Button
        variant="secondary"
        disabled={busy || linksBusy || !moveSpotId}
        onclick={() => act('move')}>{visit?.spotId ? 'Déplacer' : 'Affecter'}</Button
      ><Button disabled={busy || linksBusy} onclick={() => act('check-out')}
        >Enregistrer le départ</Button
      >{/if}{/snippet}
</Drawer>
