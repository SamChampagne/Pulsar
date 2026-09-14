<script lang="ts">
  import { Search } from 'lucide-svelte';
  import { pushOverlay, popOverlay, isTopOverlay } from '$lib/stores/overlay-stack';

  interface Command {
    label: string;
    hint?: string;
    run: () => void;
  }
  let { open = $bindable(false), commands = [] as Command[] } = $props();
  let query = $state('');
  let selected = $state(0);
  let panelEl = $state<HTMLElement | null>(null);

  const filtered = $derived(
    commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())),
  );

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

  function focusOnMount(node: HTMLInputElement) {
    const previous = document.activeElement as HTMLElement | null;
    node.focus();
    return {
      destroy() {
        previous?.focus?.();
      },
    };
  }

  function onkeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      open = !open;
      query = '';
      selected = 0;
    }
    if (!open || !token || !isTopOverlay(token)) return;
    if (e.key === 'Escape' && token && isTopOverlay(token)) open = false;
    if (e.key === 'Tab' && panelEl) {
      const nodes = Array.from(panelEl.querySelectorAll<HTMLElement>('input, button'));
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selected = Math.max(0, Math.min(selected + 1, filtered.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selected = Math.max(selected - 1, 0);
    }
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement && filtered[selected]) {
      e.preventDefault();
      filtered[selected].run();
      open = false;
    }
  }
</script>

<svelte:window {onkeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-start justify-center bg-sidebar/40 pt-[15vh]"
    onclick={(e) => {
      if (e.target === e.currentTarget) open = false;
    }}
    role="presentation"
  >
    <div
      bind:this={panelEl}
      role="dialog"
      aria-modal="true"
      aria-label="Navigation rapide"
      class="w-full max-w-md overflow-hidden rounded-card bg-surface shadow-pop"
    >
      <div class="flex items-center gap-2 border-b border-edge px-3">
        <Search class="size-4 text-ink-faint" />
        <input
          class="w-full bg-transparent py-3 text-sm outline-none placeholder:text-ink-faint"
          placeholder="Aller à… ou choisir « Assistant IA »"
          aria-label="Rechercher une destination"
          bind:value={query}
          oninput={() => (selected = 0)}
          use:focusOnMount
        />
        <kbd class="rounded border border-edge px-1.5 text-[10px] text-ink-faint">esc</kbd>
      </div>
      <ul class="max-h-72 overflow-y-auto py-1">
        <!-- Labels repeat across modules (e.g. Configuration); not entity IDs. -->
        {#each filtered as cmd, i}
          <li>
            <button
              class={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${i === selected ? 'bg-accent-soft text-accent' : 'text-ink'}`}
              onmouseenter={() => (selected = i)}
              onclick={() => {
                cmd.run();
                open = false;
              }}
            >
              {cmd.label}
              {#if cmd.hint}<span class="text-xs text-ink-faint">{cmd.hint}</span>{/if}
            </button>
          </li>
        {:else}
          <li class="px-3 py-4 text-center text-xs text-ink-faint">Aucun résultat</li>
        {/each}
      </ul>
    </div>
  </div>
{/if}
