<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ArrowLeft } from 'lucide-svelte';
  let {
    title,
    kind,
    backHref,
    backLabel,
    meta,
    actions,
  }: {
    title: string;
    kind: string;
    backHref: string;
    backLabel: string;
    meta?: Snippet;
    actions?: Snippet;
  } = $props();
</script>

<header class="mb-5 space-y-3">
  <a
    href={backHref}
    class="inline-flex items-center gap-1.5 rounded text-xs font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
  >
    <ArrowLeft size={14} />{backLabel}
  </a>
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0 flex-1 basis-64">
      <p class="mb-1 text-xs text-ink-muted">{kind}</p>
      <h1 class="break-words text-xl font-semibold tracking-tight text-ink">{title}</h1>
      {#if meta}<div class="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          {@render meta()}
        </div>{/if}
    </div>
    {#if actions}<div class="flex max-w-full flex-wrap items-center gap-2">
        {@render actions()}
      </div>{/if}
  </div>
</header>
