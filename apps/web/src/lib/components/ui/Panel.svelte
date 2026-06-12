<script lang="ts">
  import { X, ExternalLink } from 'lucide-svelte';
  import { pushOverlay, popOverlay, isTopOverlay } from '$lib/stores/overlay-stack';

  let {
    open = $bindable(false),
    title = '',
    href = undefined as string | undefined,
    onclose = undefined as (() => void) | undefined,
    children,
    footer = undefined,
  } = $props();

  function close() {
    open = false;
    onclose?.();
  }

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

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && token && isTopOverlay(token)) close();
  }
</script>

<svelte:window {onkeydown} />

{#if open}
  <aside class="fixed top-0 right-0 z-40 flex h-full w-[360px] flex-col border-l border-edge bg-surface shadow-pop"
         aria-label={title}>
    <div class="flex items-center justify-between border-b border-edge px-4 py-3">
      <h2 class="truncate text-sm font-bold text-ink">{title}</h2>
      <div class="flex items-center gap-2">
        {#if href}
          <a {href} class="inline-flex items-center gap-1 text-xs text-accent hover:underline">
            Open <ExternalLink class="size-3" />
          </a>
        {/if}
        <button class="text-ink-faint hover:text-ink" onclick={close} aria-label="Close">
          <X class="size-4" />
        </button>
      </div>
    </div>
    <div class="flex-1 overflow-y-auto p-4">{@render children()}</div>
    {#if footer}<div class="flex gap-2 border-t border-edge px-4 py-3">{@render footer()}</div>{/if}
  </aside>
{/if}
