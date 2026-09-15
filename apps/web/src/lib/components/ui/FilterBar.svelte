<script lang="ts">
  import { Rows3 } from 'lucide-svelte';
  import { density, toggleDensity } from '$lib/stores/density';
  let { children = undefined } = $props();
</script>

<div
  class="filter-bar mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-edge bg-surface p-3"
  role="group"
  aria-label="Filtres et affichage"
>
  {#if children}{@render children()}{/if}
  <button
    class="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs text-ink-muted hover:bg-surface-muted hover:text-ink"
    onclick={toggleDensity}
    title="Basculer la densité du tableau"
    aria-pressed={$density === 'compact'}
  >
    <Rows3 class="size-3.5" />
    {$density === 'compact' ? 'Compact' : 'Confort'}
  </button>
</div>

<style>
  .filter-bar :global(> div),
  .filter-bar :global(> label) {
    max-width: 100%;
    min-width: 0;
  }
  @media (max-width: 639px) {
    .filter-bar :global(> div),
    .filter-bar :global(> label) {
      flex: 1 1 100%;
      width: 100%;
    }
  }
</style>
