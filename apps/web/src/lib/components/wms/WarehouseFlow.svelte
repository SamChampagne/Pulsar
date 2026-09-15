<script lang="ts">
  import { WMS_BIN_LABELS, type WmsWorkspace } from '@pulsar/shared';
  let { data, onbin }: { data: WmsWorkspace; onbin: (id: string) => void } = $props();
  const lanes = $derived([
    {
      key: 'receiving',
      label: 'Réceptionner',
      description: 'Brouillons à vérifier et valider',
      href: '/wms/receiving',
      ...data.receiving,
    },
    {
      key: 'putaway',
      label: 'Ranger',
      description: 'Emplacements de réception avec du stock',
      href: '',
      items: [],
      total: data.putaway.total,
    },
    {
      key: 'picking',
      label: 'Préparer',
      description: 'Préparations ouvertes',
      href: '/wms/picking',
      ...data.picking,
    },
    {
      key: 'finishing',
      label: 'Finaliser',
      description: 'Prélevées, stock décrémenté à la complétion',
      href: '/wms/picking',
      ...data.finishing,
    },
  ]);
</script>

<section aria-label="Flux de travail de l’entrepôt" class="min-w-0">
  <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
    <h2 class="text-base font-semibold">Le travail à faire</h2>
    <p class="text-xs text-ink-muted">Files indépendantes · aucune transition automatique</p>
  </div>
  <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
    {#each lanes as lane, index (lane.key)}
      <section class="min-w-0 rounded-lg bg-surface-muted p-4">
        <div class="flex items-center gap-2">
          <span class="font-mono text-xs text-ink-faint">0{index + 1}</span>
          <h3 class="text-sm font-semibold">{lane.label}</h3>
          <span class="ml-auto font-mono text-xl font-semibold">{lane.total}</span>
        </div>
        <p class="mt-1 min-h-8 text-xs text-ink-muted">{lane.description}</p>
        <div class="mt-3 max-h-64 space-y-2 overflow-y-auto overscroll-contain">
          {#if lane.key === 'putaway'}
            {#each data.putaway.items as bin (bin.id)}<button
                class="flow-item"
                onclick={() => onbin(bin.id)}
                aria-label={`Ranger depuis ${bin.code}`}
                ><span class="font-mono text-sm font-medium">{bin.code}</span><span
                  class="mt-1 block text-xs text-ink-muted"
                  >{bin.zone ?? WMS_BIN_LABELS[bin.kind]} · {bin.stockedItems} article(s){!bin.isActive
                    ? ' · inactif'
                    : ''}</span
                ></button
              >{/each}
          {:else}
            {#each lane.items as doc (doc.id)}<a class="flow-item" href={`${lane.href}/${doc.id}`}
                ><span class="font-mono text-sm font-medium">{doc.number} ↗</span><span
                  class="mt-1 block truncate text-xs text-ink-muted"
                  >{doc.reference || 'Sans référence'} · {doc.lineCount} ligne(s)</span
                ></a
              >{/each}
          {/if}
          {#if lane.total === 0}<p class="py-4 text-xs text-ink-faint">Rien en attente.</p>{/if}
        </div>
        {#if lane.total > 20}<p class="mt-2 text-xs text-warn">
            20 éléments affichés sur {lane.total}.
          </p>{/if}
        {#if lane.href}<a
            class="mt-3 inline-block text-xs font-medium text-accent hover:underline"
            href={`${lane.href}?locationId=${encodeURIComponent(data.site.id)}`}
            >Ouvrir la liste →</a
          >{/if}
      </section>
    {/each}
  </div>
</section>

<style>
  .flow-item {
    display: block;
    width: 100%;
    min-width: 0;
    text-align: left;
    padding: 0.65rem 0.75rem;
    border-radius: 0.35rem;
    background: var(--color-surface);
    transition: background-color 160ms;
    overflow-wrap: anywhere;
  }
  .flow-item:hover {
    background: var(--color-accent-soft);
  }
  .flow-item:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .flow-item {
      transition: none;
    }
  }
</style>
