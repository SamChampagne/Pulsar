<script lang="ts">
  import { pushOverlay, popOverlay, isTopOverlay } from '$lib/stores/overlay-stack';

  let {
    open = $bindable(false),
    x = 0,
    y = 0,
    actions = [] as { label: string; run: () => void }[],
  } = $props<{ open?: boolean; x?: number; y?: number; actions?: { label: string; run: () => void }[] }>();

  let token = $state<symbol | null>(null);

  $effect(() => {
    if (open) {
      const t = pushOverlay();
      token = t;
      return () => {
        popOverlay(t);
        token = null;
      };
    }
  });

  function close() { open = false; }

  function onkeydown(e: KeyboardEvent) {
    if (open && token && isTopOverlay(token) && e.key === 'Escape') close();
  }
</script>

<svelte:window {onkeydown} />

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="fixed inset-0 z-50" onclick={close} role="presentation">
    <div
      class="absolute min-w-44 rounded-xl border border-edge bg-surface p-1 shadow-pop"
      style={`left:${x}px; top:${y}px`}
      role="menu"
    >
      {#each actions as a (a.label)}
        <button
          type="button"
          role="menuitem"
          class="block w-full rounded-lg px-3 py-1.5 text-left text-sm text-ink hover:bg-surface-muted"
          onclick={(e) => { e.stopPropagation(); a.run(); close(); }}
        >{a.label}</button>
      {/each}
    </div>
  </div>
{/if}
