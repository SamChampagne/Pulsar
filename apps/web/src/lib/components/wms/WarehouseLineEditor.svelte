<script lang="ts">
  import { untrack } from 'svelte';
  import LotChoice from './LotChoice.svelte';
  import { api, ApiError } from '$lib/api/client';
  import { confirmAction } from '$lib/stores/confirmation';
  import type { WmsGuidedDocument, WmsDocumentLine } from '@pulsar/shared';
  import { Button, Drawer, EntityPicker, ErrorNotice, Field, Input } from '$lib/components/ui';
  let {
    kind,
    document,
    line,
    onclose,
    onsaved,
  }: {
    kind: 'receipt' | 'pick-order';
    document: WmsGuidedDocument;
    line: WmsDocumentLine | null;
    onclose: () => void;
    onsaved: () => Promise<void>;
  } = $props();
  let open = $state(true),
    busy = $state(false),
    error = $state(''),
    uncertain = $state(false);
  let itemId = $state(untrack(() => line?.itemId ?? ''));
  let binId = $state(untrack(() => line?.toBinId ?? line?.fromBinId ?? ''));
  let lotId = $state(untrack(() => line?.lotId ?? '')),
    lotReady = $state(false);
  let qty = $state<number | null>(untrack(() => (line ? Number(line.qty) : null)));
  const version = untrack(() => document.updatedAt);
  let item = $state<{ unit: string; isActive: boolean } | null>(null);
  let referenceError = $state(''),
    checking = $state(false),
    stock = $state<string | null>(null);
  const endpoint = $derived(kind === 'receipt' ? 'receipts' : 'pick-orders');
  $effect(() => {
    const i = itemId,
      b = binId,
      site = document.locationId,
      picking = kind === 'pick-order';
    let disposed = false;
    item = null;
    stock = null;
    referenceError = '';
    checking = !!i;
    if (!i) return;
    void (async () => {
      try {
        const result = await api<{ unit: string; isActive: boolean }>(
          `/wms/choices/items/${encodeURIComponent(i)}`,
        );
        if (disposed) return;
        item = result;
        if (!result.isActive)
          referenceError = 'Cet article est inactif. Choisissez un article actif.';
        if (b) {
          const target = await api<{ isActive: boolean; locationId: string }>(
            `/wms/sites/${encodeURIComponent(site)}/bins/${encodeURIComponent(b)}`,
          );
          if (disposed) return;
          if (!target.isActive || target.locationId !== site)
            referenceError = 'Choisissez un emplacement actif de cet entrepôt.';
          if (picking) {
            const levels = await api<{ itemId: string; binId: string; qtyOnHand: string }[]>(
              '/wms/inventory',
              { query: { itemId: i, binId: b } },
            );
            if (!disposed)
              stock = levels.find((l) => l.itemId === i && l.binId === b)?.qtyOnHand ?? '0';
          }
        }
      } catch (e) {
        if (!disposed)
          referenceError = e instanceof Error ? e.message : 'Référentiels indisponibles.';
      } finally {
        if (!disposed) checking = false;
      }
    })();
    return () => {
      disposed = true;
    };
  });
  async function close() {
    if (busy) return;
    if (
      !uncertain &&
      !(await confirmAction('Fermer et abandonner la saisie de cette ligne ?', {
        title: 'Fermer la ligne',
        confirmLabel: 'Abandonner',
      }))
    )
      return;
    open = false;
    if (uncertain) await onsaved();
    else onclose();
  }
  async function save() {
    if (busy || checking || uncertain || referenceError || !lotReady) return;
    if (
      !itemId ||
      !binId ||
      !item ||
      !qty ||
      !Number.isFinite(qty) ||
      qty <= 0 ||
      Math.abs(qty * 1000 - Math.round(qty * 1000)) > 1e-7
    ) {
      error =
        'Choisissez l’article, l’emplacement et une quantité positive (trois décimales maximum).';
      return;
    }
    busy = true;
    error = '';
    try {
      await api(`/wms/${endpoint}/${document.id}/lines${line ? `/${line.id}` : ''}`, {
        method: line ? 'PATCH' : 'POST',
        body: {
          itemId,
          [kind === 'receipt' ? 'toBinId' : 'fromBinId']: binId,
          qty,
          expectedUpdatedAt: version,
          ...(lotId ? { lotId } : {}),
        },
      });
      // A successful line write must never be replayed when refreshing the screen fails.
      open = false;
      await onsaved();
    } catch (e) {
      if (e instanceof ApiError && [400, 403, 404, 409, 422].includes(e.statusCode))
        error = e.message;
      else {
        uncertain = true;
        error =
          'Résultat non confirmé. La ligne a peut-être été enregistrée. Fermez et actualisez le dossier avant toute nouvelle tentative.';
      }
    } finally {
      busy = false;
    }
  }
</script>

<Drawer
  bind:open
  title={line ? 'Modifier la ligne' : 'Ajouter une ligne'}
  width="md"
  dismissible={!busy}
  onbeforeclose={() => {
    void close();
    return false;
  }}
>
  <p class="mb-5 text-sm text-ink-muted">
    {document.number} · {document.location?.name ?? document.locationId}
  </p>
  <fieldset disabled={busy || uncertain} class="min-w-0 space-y-5">
    <section aria-label="Article et quantité">
      <p class="mb-3 text-xs font-semibold text-ink-muted">01 · Article et quantité</p>
      <div class="space-y-4">
        <Field label="Article"
          ><EntityPicker
            endpoint="/wms/choices/items"
            label="Article"
            bind:value={itemId}
            disabled={busy || uncertain}
          /></Field
        >
        <Field label={`Quantité${item ? ` (${item.unit})` : ''}`}
          ><Input type="number" bind:value={qty} min={0.001} step={0.001} /></Field
        >
      </div>
    </section>
    <section class="border-t border-edge pt-4" aria-label="Emplacement de la ligne">
      <p class="mb-3 text-xs font-semibold text-ink-muted">
        02 · {kind === 'receipt' ? 'Ranger à' : 'Prélever depuis'}
      </p>
      <Field label="Emplacement"
        ><EntityPicker
          endpoint={`/wms/sites/${encodeURIComponent(document.locationId)}/bins`}
          label="Emplacement"
          pageSize={50}
          bind:value={binId}
          disabled={busy || uncertain}
        /></Field
      >
      <p class="mt-2 text-xs text-ink-muted">
        Seulement les emplacements actifs de cet entrepôt. Recherche par code ou zone.
      </p>
    </section>
    <LotChoice
      outgoing={kind === 'pick-order'}
      {itemId}
      binId={kind === 'pick-order' ? binId : ''}
      allowCreate={kind === 'receipt'}
      bind:value={lotId}
      bind:ready={lotReady}
      disabled={busy || uncertain}
    />
    {#if checking}<p role="status" class="text-xs text-ink-muted">
        Vérification des références…
      </p>{/if}
    {#if stock !== null}<div class="rounded-md bg-surface-muted p-3 text-sm">
        Stock physique total (tous lots) : <span class="font-mono font-semibold"
          >{stock} {item?.unit}</span
        >
        <p class="mt-1 text-xs text-ink-muted">
          Non réservé. Le besoin cumulé des lignes sera contrôlé dans le dossier, puis à la sortie
          de stock.
        </p>
      </div>{/if}
    <p class="border-t border-edge pt-4 text-xs text-ink-muted">
      Enregistrer cette ligne ne modifie aucun stock. {kind === 'receipt'
        ? 'La mise en stock intervient à la validation de la réception.'
        : 'La sortie de stock intervient à la finalisation de la préparation.'}
    </p>
  </fieldset>
  <div class="mt-4 space-y-2">
    <ErrorNotice message={referenceError} /><ErrorNotice message={error} />
  </div>
  {#snippet footer()}
    <Button variant="secondary" disabled={busy} onclick={close}
      >{uncertain ? 'Fermer et actualiser' : 'Fermer'}</Button
    >
    {#if !uncertain}<Button
        loading={busy}
        disabled={checking || !!referenceError || !itemId || !binId || !lotReady}
        onclick={save}>Enregistrer la ligne</Button
      >{/if}
  {/snippet}
</Drawer>
