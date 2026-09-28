<script lang="ts">
  import { beforeNavigate } from '$app/navigation';
  import { auth } from '$lib/stores/auth';
  import { api, ApiError } from '$lib/api/client';
  import { Button, Field, Textarea, Select, EntityPicker } from '$lib/components/ui';
  import { formatDateTime } from '$lib/format';
  import {
    readLotDecisionIntent,
    rememberLotDecisionIntent,
    type LotDecisionIntent,
  } from './lot-decision-intent';
  let {
    itemId,
    lot,
    onchange,
  }: {
    itemId: string;
    lot: {
      id: string;
      code: string;
      disposition: string;
      dispositionRevision: number;
      dispositionReason: string | null;
    };
    onchange: () => void;
  } = $props();
  const canManage = $derived($auth?.user.permissions.includes('wms.manage'));
  const canRelease = $derived(canManage && $auth?.user.permissions.includes('wms.lots.release'));
  const canQuality = $derived(
    $auth?.tenant.enabledModules.includes('quality') &&
      $auth.user.permissions.includes('quality.read'),
  );
  let referenceMode = $state('manual'),
    inspectionId = $state(''),
    inspectionVersion = $state(''),
    selectedInspectionId = $state('');
  $effect(() => {
    if (inspectionId !== selectedInspectionId) inspectionVersion = '';
  });
  const held = $derived(lot.disposition === 'QUARANTINED');
  const path = $derived(`/wms/items/${itemId}/lots/${lot.id}`);
  const key = $derived(
    `pulsar:lot-decision:${$auth?.tenant.id}:${$auth?.user.id}:${itemId}:${lot.id}`,
  );
  let open = $state(false),
    historyOpen = $state(false),
    busy = $state(false),
    error = $state(''),
    storageError = $state(false),
    reason = $state(''),
    control = $state(''),
    confirmed = $state(false),
    pending = $state<LotDecisionIntent | null>(null);
  let history = $state<
      {
        id: string;
        revision: number;
        toDisposition: string;
        reason: string;
        controlNote: string | null;
        createdAt: string;
        createdBy: { firstName: string; lastName: string };
        qualitySnapshot?: {
          id: string;
          number: string;
          title: string;
          planName: string;
          planRevision: number;
        } | null;
      }[]
    >([]),
    historyPage = $state(1),
    historyTotal = $state(0),
    historyLoading = $state(false);
  $effect(() => {
    const storageKey = key;
    try {
      pending = readLotDecisionIntent(storageKey);
      storageError = false;
    } catch (e) {
      error = (e as Error).message;
      storageError = true;
    }
  });
  beforeNavigate((n) => {
    if (busy) n.cancel();
  });
  async function readHistory(page = 1) {
    historyLoading = true;
    error = '';
    try {
      const r = await api<{ items: typeof history; total: number }>(`${path}/decisions`, {
        query: { page, pageSize: 10 },
      });
      history = r.items;
      historyTotal = r.total;
      historyPage = page;
      historyOpen = true;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      historyLoading = false;
    }
  }
  async function submit(recover = false) {
    if (busy || storageError || !canManage || (!recover && (!confirmed || !reason.trim()))) return;
    if (
      !recover &&
      held &&
      referenceMode === 'quality' &&
      (!canQuality || !inspectionId || !inspectionVersion)
    )
      return;
    const request: LotDecisionIntent = pending ?? {
      action: held ? 'release' : 'quarantine',
      body: {
        operationKey: crypto.randomUUID(),
        expectedRevision: lot.dispositionRevision,
        reason: reason.trim(),
        ...(held ? { controlNote: control.trim() } : {}),
        ...(held && referenceMode === 'quality'
          ? { qualityInspectionId: inspectionId, expectedInspectionUpdatedAt: inspectionVersion }
          : {}),
      },
    };
    if (request.action === 'release' && !canRelease) return;
    busy = true;
    error = '';
    const storageKey = key;
    try {
      rememberLotDecisionIntent(storageKey, request);
      pending = request;
      await api(`${path}/${request.action}`, { method: 'POST', body: request.body });
      localStorage.removeItem(storageKey);
      pending = null;
      open = false;
      reason = '';
      control = '';
      confirmed = false;
      referenceMode = 'manual';
      inspectionId = '';
      inspectionVersion = '';
      selectedInspectionId = '';
      await readHistory();
      onchange();
    } catch (e) {
      error = (e as Error).message;
      // On recovery, an intermediate refusal never erases an uncertain original request.
      if (!recover && e instanceof ApiError && [400, 403, 404, 409].includes(e.statusCode)) {
        localStorage.removeItem(storageKey);
        pending = null;
      }
    } finally {
      busy = false;
    }
  }
</script>

<section class="space-y-3 border-t border-edge pt-3" aria-label={`Contrôle du lot ${lot.code}`}>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <p class={`text-sm font-medium ${held ? 'text-warn' : ''}`}>
      {held ? 'En quarantaine · sorties bloquées' : 'Sans blocage de stock'}
      <span class="text-xs text-ink-muted">· révision {lot.dispositionRevision}</span>
    </p>
    <Button
      variant="ghost"
      loading={historyLoading}
      disabled={busy}
      onclick={() => {
        if (historyOpen) historyOpen = false;
        else void readHistory();
      }}>Historique des contrôles</Button
    >
  </div>
  {#if lot.dispositionReason}<p class="text-sm break-words text-ink-muted">
      {lot.dispositionReason}
    </p>{/if}
  {#if held}<p class="max-w-3xl text-xs text-ink-muted">
      Le blocage couvre ce lot dans tous les entrepôts. Entrées et déplacements permis;
      prélèvements, consommation et ajustements négatifs interdits. Les quantités restent physiques
      mais sont exclues du MRP et de l’APS matières.
    </p>{:else}<p class="text-xs text-ink-muted">
      L’absence de blocage n’est pas une certification qualité.
    </p>{/if}
  {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
  {#if pending}<aside class="rounded-lg border border-edge bg-surface-muted p-3 space-y-2">
      <p class="text-sm font-medium">Décision à confirmer</p>
      <p class="text-xs text-ink-muted">
        {pending.action === 'release' ? 'Libération' : 'Quarantaine'} · {pending.body.reason}. La
        reprise conserve exactement la demande enregistrée, sans nouvelle décision.
      </p>
      <Button
        disabled={busy || !canManage || (pending.action === 'release' && !canRelease)}
        onclick={() => void submit(true)}>Reprendre la même décision</Button
      >
    </aside>{:else if canManage && !storageError}
    {#if open}<form
        class="max-w-3xl space-y-3 rounded-lg bg-surface-muted p-4"
        onsubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h3 class="text-sm font-semibold">
          {held ? 'Libérer après contrôle' : 'Mettre en quarantaine'}
        </h3>
        <fieldset disabled={busy} class="min-w-0 space-y-3">
          <Field label="Motif de la décision"
            ><Textarea bind:value={reason} required minlength={3} maxlength={1000} /></Field
          >
          {#if held}<Field label="Contrôle réalisé et résultat"
              ><Textarea
                bind:value={control}
                required
                minlength={10}
                maxlength={2000}
                placeholder="Contrôle, référence du dossier et résultat permettant la libération…"
              /></Field
            >{/if}
          {#if held && canQuality}
            <Field label="Justificatif de libération"
              ><Select aria-label="Justificatif de libération" bind:value={referenceMode}>
                <option value="manual">Compte rendu manuel</option><option value="quality"
                  >Contrôle du module Qualité</option
                >
              </Select></Field
            >
            {#if referenceMode === 'quality'}
              <EntityPicker
                endpoint={`${path}/quality-inspections`}
                filters={{ releaseEligible: 'true' }}
                label="Contrôle conforme"
                bind:value={inspectionId}
                onselect={(r) => {
                  selectedInspectionId = String(r.id);
                  inspectionVersion = String(r.updatedAt ?? '');
                }}
              />
              <p class="text-xs text-ink-muted">
                Uniquement les contrôles terminés et conformes de ce lot, préparés pendant cette
                quarantaine, sans mouvement depuis. Le serveur revérifie le contexte à la
                confirmation.
              </p>
            {/if}
          {/if}
          <label class="flex gap-2 text-sm"
            ><input type="checkbox" bind:checked={confirmed} required />{held
              ? 'Je confirme le contrôle et autorise la reprise d’utilisation de tout ce lot.'
              : 'Je confirme le blocage de tout ce lot, y compris dans les autres entrepôts.'}</label
          >
        </fieldset>
        <div class="flex flex-wrap gap-2">
          <Button
            type="submit"
            loading={busy}
            disabled={!confirmed ||
              (held &&
                (!canRelease ||
                  (referenceMode === 'quality' && (!inspectionId || !inspectionVersion))))}
            >Confirmer {held ? 'la libération' : 'la quarantaine'}</Button
          ><Button
            variant="ghost"
            disabled={busy}
            onclick={() => {
              open = false;
              confirmed = false;
            }}>Annuler</Button
          >
        </div>
      </form>{:else if !held || canRelease}<Button
        variant="secondary"
        disabled={busy}
        onclick={() => {
          open = true;
          confirmed = false;
        }}>{held ? 'Libérer après contrôle' : 'Mettre en quarantaine'}</Button
      >{:else}<p class="text-xs text-ink-muted">
        La libération exige le droit « Libérer les lots » (wms.lots.release).
      </p>{/if}
  {/if}
  {#if historyOpen}<ol class="space-y-3 text-sm" aria-label="Historique des décisions">
      {#if !history.length}<li class="text-ink-muted">
          Aucune décision enregistrée pour ce lot.
        </li>{/if}
      {#each history as h}<li class="border-l-2 border-edge pl-3 space-y-1">
          <p class="font-medium">
            {h.toDisposition === 'QUARANTINED' ? 'Quarantaine' : 'Libération'} · révision {h.revision}
          </p>
          <p class="text-xs text-ink-muted">
            {formatDateTime(h.createdAt)} · {h.createdBy.firstName}
            {h.createdBy.lastName}
          </p>
          <p class="break-words">{h.reason}</p>
          {#if h.controlNote}<p class="break-words text-ink-muted">
              Contrôle : {h.controlNote}
            </p>{/if}
          {#if canQuality && h.qualitySnapshot}<p class="text-xs text-ink-muted break-words">
              Preuve figée : <a
                class="text-accent underline"
                href={`/quality/inspections/${h.qualitySnapshot.id}`}
                >{h.qualitySnapshot.number} · {h.qualitySnapshot.title}</a
              >
              — {h.qualitySnapshot.planName} v{h.qualitySnapshot.planRevision}, conforme au moment
              de la décision.
            </p>{/if}
        </li>{/each}
    </ol>
    {#if historyTotal > 10}<div class="flex gap-2">
        <Button
          variant="ghost"
          disabled={historyLoading || historyPage === 1}
          onclick={() => void readHistory(historyPage - 1)}>Contrôles précédents</Button
        ><Button
          variant="ghost"
          disabled={historyLoading || historyPage * 10 >= historyTotal}
          onclick={() => void readHistory(historyPage + 1)}>Contrôles suivants</Button
        >
      </div>{/if}{/if}
</section>
