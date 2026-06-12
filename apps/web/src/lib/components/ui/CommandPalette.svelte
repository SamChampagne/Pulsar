<script lang="ts">
  import { Search } from 'lucide-svelte';

  interface Command { label: string; hint?: string; run: () => void }
  let { open = $bindable(false), commands = [] as Command[] } = $props();
  let query = $state('');
  let selected = $state(0);

  const filtered = $derived(
    commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())),
  );

  function onkeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      open = !open;
      query = '';
      selected = 0;
    }
    if (!open) return;
    if (e.key === 'Escape') open = false;
    if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(selected + 1, filtered.length - 1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(selected - 1, 0); }
    if (e.key === 'Enter' && filtered[selected]) { filtered[selected].run(); open = false; }
  }
</script>

<svelte:window {onkeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-start justify-center bg-sidebar/40 pt-[15vh]"
       onclick={(e) => { if (e.target === e.currentTarget) open = false; }} role="presentation">
    <div class="w-full max-w-md overflow-hidden rounded-card bg-surface shadow-pop">
      <div class="flex items-center gap-2 border-b border-edge px-3">
        <Search class="size-4 text-ink-faint" />
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="w-full bg-transparent py-3 text-sm outline-none placeholder:text-ink-faint"
          placeholder="Go to… (AI assistant lands here)"
          bind:value={query}
          oninput={() => (selected = 0)}
          autofocus
        />
        <kbd class="rounded border border-edge px-1.5 text-[10px] text-ink-faint">esc</kbd>
      </div>
      <ul class="max-h-72 overflow-y-auto py-1">
        {#each filtered as cmd, i (cmd.label)}
          <li>
            <button
              class={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${i === selected ? 'bg-accent-soft text-accent' : 'text-ink'}`}
              onmouseenter={() => (selected = i)}
              onclick={() => { cmd.run(); open = false; }}
            >
              {cmd.label}
              {#if cmd.hint}<span class="text-xs text-ink-faint">{cmd.hint}</span>{/if}
            </button>
          </li>
        {:else}
          <li class="px-3 py-4 text-center text-xs text-ink-faint">No results</li>
        {/each}
      </ul>
    </div>
  </div>
{/if}
