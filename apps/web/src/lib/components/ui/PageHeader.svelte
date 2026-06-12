<script lang="ts">
  let { title, count = undefined as number | undefined, actions = undefined, children = undefined } = $props();
</script>

<div class="mb-4 flex items-center justify-between gap-3">
  <div class="flex items-baseline gap-2">
    <h1 class="text-xl font-bold text-ink">{title}</h1>
    {#if count !== undefined}<span class="text-sm text-ink-muted">{count} résultats</span>{/if}
  </div>
  {#if actions}<div class="flex items-center gap-2">{@render actions()}</div>{/if}
</div>
{#if children}{@render children()}{/if}
