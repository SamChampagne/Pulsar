<script lang="ts">
  import { X } from 'lucide-svelte';
  let { open = $bindable(false), title = '', children, footer = undefined } = $props();
  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false;
  }
</script>

<svelte:window {onkeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-sidebar/40 p-4"
       onclick={(e) => { if (e.target === e.currentTarget) open = false; }}
       role="presentation">
    <div class="w-full max-w-lg rounded-card bg-surface shadow-pop" role="dialog" aria-modal="true">
      <div class="flex items-center justify-between border-b border-edge px-4 py-3">
        <h2 class="text-sm font-bold text-ink">{title}</h2>
        <button class="text-ink-faint hover:text-ink" onclick={() => (open = false)} aria-label="Close">
          <X class="size-4" />
        </button>
      </div>
      <div class="max-h-[70vh] overflow-y-auto p-4">{@render children()}</div>
      {#if footer}<div class="flex justify-end gap-2 border-t border-edge px-4 py-3">{@render footer()}</div>{/if}
    </div>
  </div>
{/if}
