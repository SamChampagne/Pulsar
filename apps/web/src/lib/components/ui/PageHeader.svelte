<script lang="ts">
  let {
    title,
    subtitle = '',
    eyebrow = '',
    count = undefined as number | undefined,
    actions = undefined,
    children = undefined,
  } = $props();
</script>

<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
  <div class="min-w-0">
    {#if eyebrow}
      <div class="mb-1 text-[10px] font-bold tracking-[0.18em] text-accent uppercase">{eyebrow}</div>
    {/if}
    <div class="flex flex-wrap items-baseline gap-2">
      <h1 class="text-xl font-bold text-ink">{title}</h1>
      {#if count !== undefined}<span class="text-sm text-ink-muted">{count} results</span>{/if}
    </div>
    {#if subtitle}
      <p class="mt-1 max-w-3xl text-sm text-ink-muted">{subtitle}</p>
    {/if}
  </div>
  {#if actions}<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>{/if}
</div>
{#if children}{@render children()}{/if}
