<script module lang="ts">
  export interface RelatedItem {
    label: string;
    sublabel?: string;
    href?: string;
    tone?: string;
  }

  export interface RelatedGroup {
    label: string;
    items: RelatedItem[];
  }
</script>

<script lang="ts">
  import { ChevronRight } from 'lucide-svelte';
  import EmptyState from './EmptyState.svelte';

  let { title = 'Lié à', groups = [] as RelatedGroup[] } = $props();

  const visibleGroups = $derived(groups.filter((g) => g.items.length > 0));

  const dotClass: Record<string, string> = {
    ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger', info: 'bg-info', neutral: 'bg-neutral',
  };
</script>

<div>
  <h2 class="mb-3 text-sm font-semibold text-ink">{title}</h2>

  {#if visibleGroups.length === 0}
    <EmptyState message="Rien à relier pour l'instant." />
  {:else}
    <div class="flex flex-col gap-4">
      {#each visibleGroups as group (group.label)}
        <div>
          <div class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {group.label}
          </div>
          <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
            {#each group.items as item, i (item.href ?? `${group.label}-${i}`)}
              <li>
                {#if item.href}
                  <a
                    href={item.href}
                    class="group flex items-center justify-between gap-2 rounded-inner px-2 py-1.5 -mx-2 text-sm text-ink transition-colors hover:bg-surface-muted"
                  >
                    <span class="flex min-w-0 items-center gap-1.5">
                      {#if item.tone}
                        <span class={`size-1.5 shrink-0 rounded-full ${dotClass[item.tone] ?? dotClass.neutral}`} aria-hidden="true"></span>
                      {/if}
                      <span class="truncate font-medium">{item.label}</span>
                      {#if item.sublabel}
                        <span class="ml-1 text-ink-muted">{item.sublabel}</span>
                      {/if}
                    </span>
                    <ChevronRight
                      class="size-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink-muted"
                    />
                  </a>
                {:else}
                  <div class="flex items-center justify-between gap-2 px-2 py-1.5 text-sm text-ink-muted">
                    <span class="flex min-w-0 items-center gap-1.5">
                      {#if item.tone}
                        <span class={`size-1.5 shrink-0 rounded-full ${dotClass[item.tone] ?? dotClass.neutral}`} aria-hidden="true"></span>
                      {/if}
                      <span class="truncate">{item.label}</span>
                      {#if item.sublabel}
                        <span class="ml-1 text-ink-faint">{item.sublabel}</span>
                      {/if}
                    </span>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  {/if}
</div>
