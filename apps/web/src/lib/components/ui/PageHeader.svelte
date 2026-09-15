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

<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
  <div class="min-w-0">
    {#if eyebrow}<div class="mb-1 text-xs font-medium text-ink-muted">
        {eyebrow}
      </div>{/if}
    <div class="flex items-baseline gap-2.5">
      <h1 class="text-xl font-semibold tracking-tight text-ink">{title}</h1>
      {#if count !== undefined}<span
          class="rounded-full bg-surface-muted px-2 py-0.5 font-mono text-xs text-ink-muted"
          >{count}</span
        >{/if}
    </div>
    {#if subtitle}<p class="mt-1 max-w-3xl text-sm leading-5 text-ink-muted">{subtitle}</p>{/if}
  </div>
  {#if actions}<div class="flex max-w-full flex-wrap items-center gap-2">
      {@render actions()}
    </div>{/if}
</div>
{#if children}{@render children()}{/if}
