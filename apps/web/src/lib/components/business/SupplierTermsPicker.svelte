<script lang="ts">
  import { api } from '$lib/api/client';
  import type { Paginated, SupplierTermsSnapshot } from '@pulsar/shared';
  import type { SupplierOffer } from './types';
  import { Button, Badge } from '$lib/components/ui';
  let {
    itemId,
    supplierId,
    currency,
    selected,
    editable,
    onchoose,
  }: {
    itemId: string;
    supplierId: string;
    currency: string;
    selected?: SupplierTermsSnapshot | null;
    editable: boolean;
    onchoose: (offer: SupplierOffer | null) => void;
  } = $props();
  let offer = $state<SupplierOffer | null>(null),
    loading = $state(false),
    error = $state('');
  $effect(() => {
    const item = itemId,
      supplier = supplierId;
    let active = true;
    offer = null;
    error = '';
    loading = false;
    if (editable && item && supplier) {
      loading = true;
      void api<Paginated<SupplierOffer>>(`/purchasing/data/items/${item}/supplier-offers`, {
        query: { supplierId: supplier, pageSize: 1 },
      })
        .then((r) => {
          if (active) offer = r.items[0] ?? null;
        })
        .catch((e) => {
          if (active) error = e instanceof Error ? e.message : 'Conditions indisponibles.';
        })
        .finally(() => {
          if (active) loading = false;
        });
    }
    return () => {
      active = false;
    };
  });
  function usable(row: SupplierOffer) {
    const day = new Date().toISOString().slice(0, 10);
    return (
      row.active &&
      row.supplier.active &&
      row.supplier.isSupplier &&
      row.catalogItem.active &&
      row.currency === currency &&
      (!row.validFrom || row.validFrom.slice(0, 10) <= day) &&
      (!row.validUntil || row.validUntil.slice(0, 10) >= day)
    );
  }
</script>

<div class="mt-3 space-y-2 rounded-md border border-edge bg-surface p-3 text-xs">
  {#if selected}
    <div class="flex flex-wrap items-center gap-2">
      <Badge tone="info">Conditions choisies</Badge><strong
        >{selected.supplierReference} · v{selected.version}</strong
      >
    </div>
    <p>
      {selected.unitPrice}
      {selected.currency} / {selected.unit} · minimum {selected.minimumQuantity ?? 'libre'} · multiple
      {selected.orderMultiple ?? 'libre'}
    </p>
    <p class="text-ink-muted">
      Délai indicatif : {selected.leadTimeDays ?? 'non précisé'} jours. Validité UTC : {selected.validFrom ??
        'sans début'} → {selected.validUntil ?? 'sans fin'}.
    </p>
    {#if selected.packaging}<p class="whitespace-pre-wrap break-words">{selected.packaging}</p>{/if}
    {#if selected.terms}<p class="whitespace-pre-wrap break-words">{selected.terms}</p>{/if}
    {#if editable && (selected.supplierId !== supplierId || selected.catalogItemId !== itemId || selected.currency !== currency || (offer && offer.version !== selected.version))}<p
        class="text-warn"
      >
        Ce choix ne correspond plus aux données courantes. Resélectionnez les conditions ou passez
        en prix manuel.
      </p>{/if}
    {#if editable}<Button variant="ghost" onclick={() => onchoose(null)}
        >Passer en prix manuel</Button
      >{:else}<p class="text-ink-muted">Copie historique conservée sur la commande.</p>{/if}
  {:else}<p class="text-ink-muted">Prix manuel · aucune condition fournisseur appliquée.</p>{/if}
  {#if editable}
    {#if loading}<p class="text-ink-muted">Lecture des références fournisseur…</p>{/if}
    {#if error}<p role="alert" class="text-danger">{error}</p>{/if}
    {#if offer}<div class="space-y-2 border-t border-edge pt-2">
        <p>
          Référence disponible : {offer.supplierReference} · {offer.unitPrice}
          {offer.currency} / {offer.catalogItem.unit} · v{offer.version}
        </p>
        <Button
          variant="secondary"
          disabled={!usable(offer)}
          onclick={() => {
            if (offer) onchoose(offer);
          }}>Appliquer ces conditions</Button
        >
        {#if !usable(offer)}<p class="text-warn">
            Référence inactive, hors validité ou dans une autre devise. Aucun taux de change
            automatique.
          </p>{/if}
      </div>{:else if !loading && !error && itemId && supplierId}<p class="text-ink-muted">
        Aucune référence définie pour ce fournisseur. Vous pouvez en ajouter dans Données → Articles
        → Fiche article.
      </p>{/if}
  {/if}
</div>
