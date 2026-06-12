<script lang="ts">
  import { Rows3 } from 'lucide-svelte';
  import { toggleDensity } from '$lib/stores/density';
  let { children = undefined } = $props();
</script>

<div class="mb-3 flex flex-wrap items-center gap-2">
  {#if children}{@render children()}{/if}
  <button
    class="ml-auto inline-flex items-center gap-1 rounded-md border border-edge bg-surface px-2 py-1 text-xs text-ink-muted hover:text-ink"
    onclick={toggleDensity}
    title="Toggle table density"
  >
    <Rows3 class="size-3.5" /> Density
  </button>
</div>
