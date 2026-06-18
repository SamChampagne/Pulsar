<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { pushOverlay, popOverlay, isTopOverlay } from '$lib/stores/overlay-stack';
  let { open = $bindable(false), name = '', onclose = undefined as (() => void) | undefined, children, footer = undefined } = $props();
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const dur = reduce ? 0 : 220;
  let token = $state<symbol | null>(null);
  function close() { open = false; onclose?.(); }
  $effect(() => { if (open) { const t = pushOverlay(); token = t; return () => { popOverlay(t); token = null; }; } });
  function onkeydown(e: KeyboardEvent) { if (open && token && isTopOverlay(token) && e.key === 'Escape') close(); }
</script>
<svelte:window {onkeydown} />
{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-md" onclick={(e) => { if (e.target === e.currentTarget) close(); }} role="presentation" transition:fade={{ duration: dur }}>
    <div class="w-[min(560px,calc(100vw-2rem))] rounded-[30px] border border-edge bg-white/95 p-6 shadow-pop" role="dialog" aria-modal="true" aria-label={name} transition:scale={{ duration: dur, start: 0.4, easing: cubicOut }}>
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-base font-semibold text-ink">{name}</h2>
        <button class="rounded-full bg-surface-muted px-2 py-1 text-xs font-semibold text-ink-muted hover:text-ink" onclick={close}>Fermer</button>
      </div>
      <div class="grid grid-cols-3 justify-items-center gap-x-6 gap-y-8 sm:grid-cols-4">{@render children()}</div>
      {#if footer}<div class="mt-5 border-t border-edge pt-4">{@render footer()}</div>{/if}
    </div>
  </div>
{/if}
