<script lang="ts">
  import BinCreateModal from './BinCreateModal.svelte';
  import LotChoice from './LotChoice.svelte';
  import { auth } from '$lib/stores/auth';
  let createDestination = $state(false);
  import { api, ApiError } from '$lib/api/client';
  import { Button, EntityPicker, ErrorNotice, Field, Input, Textarea } from '$lib/components/ui';
  import { confirmAction } from '$lib/stores/confirmation';
  import {
    pendingMove,
    moveScope,
    rememberMove,
    resolveMove,
    type MoveIntent,
  } from '$lib/wms/move-intent';
  import type { WmsMoveResult } from '@pulsar/shared';
  let {
    source,
    onbusy,
    onsaved,
    oncancel,
  }: {
    source: {
      itemId: string;
      sku: string;
      unit: string;
      qtyOnHand: string;
      binId: string;
      binCode: string;
      locationId: string;
    };
    onbusy: (busy: boolean) => void;
    onsaved: () => void | Promise<void>;
    oncancel: () => void;
  } = $props();
  let qty = $state<number | null>(null),
    destination = $state(''),
    note = $state('');
  let busy = $state(false),
    error = $state('');
  let lotId = $state(''),
    lotReady = $state(false);
  async function move() {
    if (busy || $pendingMove || !lotReady) return;
    if (
      !qty ||
      qty <= 0 ||
      !Number.isFinite(qty) ||
      qty > Number(source.qtyOnHand) ||
      Math.abs(qty * 1000 - Math.round(qty * 1000)) > 1e-7 ||
      !destination ||
      destination === source.binId
    ) {
      error =
        'Choisissez une autre destination et une quantité positive disponible (trois décimales maximum).';
      return;
    }
    busy = true;
    onbusy(true);
    error = '';
    let intent: MoveIntent | null = null;
    let committed = false;
    const scope = moveScope();
    try {
      const target = await api<{ code: string; isActive: boolean; locationId: string }>(
        `/wms/sites/${encodeURIComponent(source.locationId)}/bins/${encodeURIComponent(destination)}`,
      );
      if (!target.isActive || target.locationId !== source.locationId)
        throw new Error('Choisissez un emplacement actif du même entrepôt.');
      const lot = lotId
        ? await api<{ code: string }>(`/wms/items/${source.itemId}/lots/${lotId}`)
        : null;
      const label = `${qty} ${source.unit} de ${source.sku}${lot ? ` · lot ${lot.code}` : ''} : ${source.binCode} → ${target.code}`;
      if (
        !(await confirmAction(
          `Déplacer ${label} ? Le serveur revérifie le stock. Aucun dossier de réception ou de transport ne sera terminé.`,
          { title: 'Confirmer le déplacement', confirmLabel: 'Déplacer le stock' },
        ))
      )
        return;
      if (moveScope() !== scope) throw new Error('La session a changé.');
      intent = rememberMove(
        {
          operationKey: crypto.randomUUID(),
          itemId: source.itemId,
          fromBinId: source.binId,
          toBinId: destination,
          locationId: source.locationId,
          qty,
          ...(lotId ? { lotId } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        label,
      );
      await api<WmsMoveResult>('/wms/inventory/move', { method: 'POST', body: intent.request });
      committed = true;
      resolveMove(intent);
      await onsaved();
    } catch (e) {
      if (
        !committed &&
        intent &&
        e instanceof ApiError &&
        [400, 403, 404, 409, 422].includes(e.statusCode)
      )
        resolveMove(intent);
      error = $pendingMove
        ? 'Résultat non confirmé. Le stock a peut-être été déplacé. Fermez le panneau puis utilisez « Vérifier et reprendre » : la demande originale est conservée, sans double déplacement.'
        : e instanceof Error
          ? e.message
          : 'Déplacement indisponible.';
    } finally {
      busy = false;
      onbusy(false);
    }
  }
</script>

<section class="mt-5" aria-label="Déplacement de stock">
  <h3 class="text-sm font-semibold">Déplacer {source.sku}</h3>
  <p class="mt-2 text-sm text-ink-muted">
    Source <span class="font-mono">{source.binCode}</span> ·
    <span class="font-mono">{source.qtyOnHand} {source.unit}</span> sur place
  </p>
  <fieldset disabled={busy || !!$pendingMove} class="mt-4 min-w-0 space-y-4">
    <LotChoice
      itemId={source.itemId}
      binId={source.binId}
      bind:value={lotId}
      bind:ready={lotReady}
      disabled={busy || !!$pendingMove}
    />
    <Field label="Emplacement de destination"
      ><EntityPicker
        endpoint={`/wms/sites/${encodeURIComponent(source.locationId)}/bins`}
        label="Destination"
        allowCreate={$auth?.user.permissions.includes('wms.manage')
          ? { label: '+ Créer un emplacement', onCreate: () => (createDestination = true) }
          : undefined}
        pageSize={50}
        bind:value={destination}
        disabled={busy || !!$pendingMove}
      /></Field
    >
    <p class="text-xs text-ink-muted">
      Recherche par code ou zone, parmi les emplacements actifs de cet entrepôt.
    </p>
    <Field label={`Quantité (${source.unit})`}
      ><Input
        type="number"
        bind:value={qty}
        min={0.001}
        step={0.001}
        max={Number(source.qtyOnHand)}
      /></Field
    >
    <Field label="Note du mouvement"><Textarea bind:value={note} maxlength={1000} rows={2} /></Field
    >
    <p class="text-xs text-ink-muted">
      Le déplacement déduit la source et augmente la destination dans la même opération. Ce n’est ni
      une réservation ni une réception partielle.
    </p>
  </fieldset>
  <div class="mt-4"><ErrorNotice message={error} /></div>
  <div class="mt-4 flex flex-wrap gap-2">
    <Button disabled={busy || !!$pendingMove || !destination || !lotReady} onclick={move}
      >Vérifier le déplacement</Button
    >
    <Button variant="ghost" disabled={busy} onclick={oncancel}
      >{$pendingMove ? 'Fermer la saisie' : 'Annuler la saisie'}</Button
    >
  </div>
</section>
<BinCreateModal
  bind:open={createDestination}
  locationId={source.locationId}
  oncreated={(bin) => (destination = bin.id)}
/>
