<script lang="ts">
  import { Badge, Card, labelFor, toneFor } from '$lib/components/ui';
  import { formatDateTime } from '$lib/format';
  import type { RecipientPackageTracking } from './recipient-packages';

  let { tracking }: { tracking?: RecipientPackageTracking } = $props();
  const counts = $derived(tracking?.counts);
  const partial = $derived(!!counts && counts.delivered > 0 && counts.delivered < counts.active);
  function statusLabel(status: string) {
    if (status === 'PREPARED') return 'Préparé';
    if (status === 'LOADED') return 'Chargé';
    if (status === 'RETURNED') return 'Retourné';
    return labelFor(status);
  }
</script>

<section aria-label="Suivi des colis" data-testid="recipient-packages">
  <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
    <h2 class="text-base font-semibold text-ink">Vos colis</h2>
    {#if partial}<Badge tone="info">Livraison partielle</Badge>{/if}
  </div>
  <Card>
    {#if !tracking}
      <p class="text-sm text-ink-muted">Le détail des colis n’est pas disponible pour cette expédition.</p>
    {:else if !tracking.enabled}
      <p class="text-sm font-medium text-ink">Suivi par colis non activé</p>
      <p class="mt-1 text-sm text-ink-muted">Cette expédition utilise le suivi global. Aucun nombre de colis livrés n’est déduit de son statut.</p>
    {:else if !counts || counts.total === 0}
      <p class="text-sm font-medium text-ink">Aucun colis déclaré pour le moment</p>
      <p class="mt-1 text-sm text-ink-muted">Le suivi par colis est activé. Aucune livraison de colis n’est encore confirmée.</p>
    {:else}
      <div class="mb-4 border-b border-edge pb-4">
        {#if counts.active > 0}
          <p class="text-sm text-ink">
            <span class="text-2xl font-semibold tabular-nums">{counts.delivered}</span>
            <span class="ml-1 text-ink-muted">sur {counts.active} colis actifs livrés</span>
          </p>
        {:else}
          <p class="text-sm font-medium text-ink">Aucun colis actif</p>
        {/if}
        <p class="mt-2 text-xs leading-relaxed text-ink-muted">
          {counts.prepared} préparé{counts.prepared > 1 ? 's' : ''} ·
          {counts.loaded} chargé{counts.loaded > 1 ? 's' : ''} ·
          {counts.returned ?? 0} retourné{(counts.returned ?? 0) > 1 ? 's' : ''} ·
          {counts.cancelled} annulé{counts.cancelled > 1 ? 's' : ''}
        </p>
        <p class="mt-2 max-w-prose text-xs leading-relaxed text-ink-muted">
          Les états ci-dessous correspondent aux confirmations de chaque colis.
          La position du véhicule et une preuve de livraison ne confirment pas, à elles seules, la remise de tous les colis.
        </p>
      </div>
      <ul class="divide-y divide-edge">
        {#each tracking.packages as parcel (parcel.code)}
          <li class="py-3 first:pt-0 last:pb-0">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="break-all font-mono text-sm font-medium text-ink">{parcel.code}</span>
              <Badge tone={parcel.status === 'LOADED' ? 'info' : toneFor(parcel.status)}>{statusLabel(parcel.status)}</Badge>
            </div>
            {#if parcel.loadedAt || parcel.deliveredAt}
              <dl class="mt-2 grid gap-x-5 gap-y-1 text-xs sm:grid-cols-2">
                {#if parcel.loadedAt}
                  <div><dt class="text-ink-muted">Chargement confirmé</dt><dd class="mt-0.5 text-ink">{formatDateTime(parcel.loadedAt)}</dd></div>
                {/if}
                {#if parcel.deliveredAt}
                  <div><dt class="text-ink-muted">Remise confirmée</dt><dd class="mt-0.5 text-ink">{formatDateTime(parcel.deliveredAt)}</dd></div>
                {/if}
              </dl>
            {:else if parcel.status === 'CANCELLED'}
              <p class="mt-1 text-xs text-ink-muted">Exclu du nombre de colis actifs.</p>
            {:else}
              <p class="mt-1 text-xs text-ink-muted">Chargement et remise non confirmés.</p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </Card>
</section>
