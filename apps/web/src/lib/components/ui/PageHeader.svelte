<script lang="ts">
  let { title, count = undefined as number | undefined, actions = undefined, children = undefined } = $props();
</script>

<div class="mb-5 flex items-center justify-between gap-3">
  <div class="flex items-baseline gap-2.5">
    <h1 class="text-2xl font-bold tracking-tight text-ink">{title}</h1>
    {#if count !== undefined}<span class="rounded-full bg-surface-muted px-2 py-0.5 font-mono text-xs text-ink-muted">{count}</span>{/if}
  </div>
  {#if actions}<div class="flex items-center gap-2">{@render actions()}</div>{/if}
</div>
{#if children}{@render children()}{/if}
