<script lang="ts">
  import { groupWmsBins, WMS_BIN_LABELS, type WmsVisualBin } from '@pulsar/shared';
  let { bins, onselect }: { bins: WmsVisualBin[]; onselect: (id: string) => void } = $props();
  const groups = $derived(groupWmsBins(bins));
  const state = (bin: WmsVisualBin) =>
    !bin.isActive
      ? 'Inactif'
      : bin.negativeItems
        ? 'Anomalie'
        : bin.stockedItems
          ? 'Avec stock'
          : 'Sans stock';
</script>

<div class="space-y-6" aria-label="Zones de l’entrepôt">
  {#each groups as group (group.key)}
    <section class="zone">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-sm font-semibold">
          {group.label}
          <span class="ml-2 font-normal text-ink-muted">{WMS_BIN_LABELS[group.kind]}</span>
        </h3>
        <span class="text-xs tabular-nums text-ink-muted"
          >{group.bins.length} emplacement(s) affiché(s)</span
        >
      </div>
      <div class="bin-grid">
        {#each group.bins as bin (bin.id)}
          <button
            class="bin"
            class:stocked={bin.stockedItems > 0}
            class:inactive={!bin.isActive}
            class:anomaly={bin.negativeItems > 0}
            aria-label={`Emplacement ${bin.code} — ${state(bin)}`}
            onclick={() => onselect(bin.id)}
          >
            <span class="flex items-center justify-between gap-2"
              ><span class="font-mono text-sm font-semibold">{bin.code}</span><span
                class="indicator"
                aria-hidden="true"
              ></span></span
            >
            <span class="mt-3 block text-xs text-ink-muted">{state(bin)}</span>
            <span class="mt-1 block text-xs tabular-nums text-ink-muted"
              >{bin.stockedItems} article(s) en stock</span
            >
          </button>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .zone {
    border-top: 1px solid var(--color-edge);
    padding-top: 1rem;
  }
  .bin-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
    gap: 0.6rem;
  }
  .bin {
    min-width: 0;
    text-align: left;
    padding: 0.85rem;
    border: 1px solid var(--color-edge);
    border-bottom-width: 3px;
    border-radius: 0.45rem;
    background: var(--color-surface);
    transition:
      transform 160ms,
      background-color 160ms,
      border-color 160ms;
    overflow-wrap: anywhere;
  }
  .bin:hover {
    transform: translateY(-2px);
    background: var(--color-surface-muted);
    border-color: var(--color-accent);
  }
  .bin:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 3px;
  }
  .bin:active {
    transform: translateY(0);
  }
  .stocked {
    border-bottom-color: var(--color-accent);
  }
  .inactive {
    border-style: dashed;
    background: var(--color-surface-muted);
  }
  .anomaly {
    border-bottom-color: var(--color-danger);
  }
  .indicator {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--color-ink-faint);
    flex-shrink: 0;
  }
  .stocked .indicator {
    background: var(--color-accent);
  }
  .anomaly .indicator {
    background: var(--color-danger);
  }
  @media (prefers-reduced-motion: reduce) {
    .bin {
      transition: none;
    }
    .bin:hover {
      transform: none;
    }
  }
</style>
