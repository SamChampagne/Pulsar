<script lang="ts">
  import {
    Table as TableIcon,
    LayoutGrid,
    KanbanSquare,
    Map as MapIcon,
  } from 'lucide-svelte';
  import type { ViewId } from './view.js';

  const ICONS: Record<ViewId, typeof TableIcon> = {
    table: TableIcon,
    cards: LayoutGrid,
    kanban: KanbanSquare,
    map: MapIcon,
  };
  const LABELS: Record<ViewId, string> = {
    table: 'Tableau',
    cards: 'Cartes',
    kanban: 'Kanban',
    map: 'Carte',
  };

  let {
    view = $bindable('table' as ViewId),
    views = ['table', 'cards'] as ViewId[],
  } = $props();
</script>

<div class="inline-flex items-center gap-1 rounded-md border border-edge bg-surface p-0.5">
  {#each views as v (v)}
    {@const Icon = ICONS[v]}
    <button
      type="button"
      onclick={() => (view = v)}
      class={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium transition-colors ${
        view === v ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'
      }`}
      aria-pressed={view === v}
    >
      <Icon class="size-4" />
      <span class="hidden sm:inline">{LABELS[v]}</span>
    </button>
  {/each}
</div>
