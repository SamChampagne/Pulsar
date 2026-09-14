<script lang="ts">
  import { density } from '$lib/stores/density';
  let { head, body } = $props();
</script>

<!-- Contain absolutely positioned sr-only headers within the scrolling table. -->
<div class={`relative overflow-x-auto rounded-card border border-edge-soft bg-surface shadow-sm ${$density === 'compact' ? 'tbl-compact' : ''}`}>
  <table class="w-full border-collapse text-sm">
    <thead>
      <tr class="border-b border-edge bg-surface-muted text-left text-[11px] tracking-wide text-ink-muted uppercase">
        {@render head()}
      </tr>
    </thead>
    <tbody>{@render body()}</tbody>
  </table>
</div>

<style>
  table :global(th) { padding: 0.5rem 0.75rem; font-weight: 600; }
  table :global(td) { padding: 0.625rem 0.75rem; border-bottom: 1px solid var(--color-edge-soft); }
  table :global(tbody tr:last-child td) { border-bottom: none; }
  table :global(tbody tr:hover) { background: var(--color-surface-muted); }
  :global(.tbl-compact > table > tbody > tr > td) { padding: 0.25rem 0.75rem; }
</style>
