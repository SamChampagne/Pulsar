<script lang="ts">
  let {
    title,
    eyebrow = undefined as string | undefined,
    subtitle = undefined as string | undefined,
    count = undefined as number | undefined,
    actions = undefined,
    children = undefined,
  } = $props();
</script>

<div class="mb-5 flex items-start justify-between gap-3">
  <div class="min-w-0">
    {#if eyebrow}<div class="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{eyebrow}</div>{/if}
    <div class="flex items-baseline gap-2.5">
      <h1 class="text-2xl font-bold tracking-tight text-ink">{title}</h1>
      {#if count !== undefined}<span class="rounded-full bg-surface-muted px-2 py-0.5 font-mono text-xs text-ink-muted">{count}</span>{/if}
    </div>
    {#if subtitle}<p class="mt-1 max-w-3xl text-sm leading-6 text-ink-muted">{subtitle}</p>{/if}
  </div>
  {#if actions}<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>{/if}
</div>
{#if children}{@render children()}{/if}
