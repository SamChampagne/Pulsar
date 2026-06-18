<script lang="ts">
  import type { ComponentType } from 'svelte';
  let {
    label, icon, accent = '#6f7480', editing = false,
    onactivate = undefined as (() => void) | undefined,
    onremove = undefined as (() => void) | undefined,
    oncontext = undefined as ((e: MouseEvent) => void) | undefined,
  } = $props<{
    label: string; icon: ComponentType; accent?: string; editing?: boolean;
    onactivate?: () => void; onremove?: () => void; oncontext?: (e: MouseEvent) => void;
  }>();
  const Icon = $derived(icon);
</script>

<button
  type="button"
  class="group relative flex w-24 flex-col items-center text-center outline-none {editing ? 'animate-[wiggle_0.3s_ease-in-out_infinite] motion-reduce:animate-none' : ''}"
  onclick={() => onactivate?.()}
  oncontextmenu={(e) => oncontext?.(e)}
  aria-label={label}
>
  {#if editing && onremove}
    <span role="button" tabindex="0"
      class="absolute -top-1 left-5 z-10 grid size-5 place-items-center rounded-full bg-ink text-xs text-white shadow"
      onclick={(e) => { e.stopPropagation(); onremove?.(); }}
      onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onremove?.(); } }}
      aria-label={`Retirer ${label}`}>×</span>
  {/if}
  <span class="grid size-14 place-items-center rounded-2xl text-white shadow-sm ring-1 ring-black/5 transition duration-150 group-hover:-translate-y-1 group-hover:shadow-md" style={`background: ${accent}`}>
    <Icon class="size-7" strokeWidth={2.15} />
  </span>
  <span class="mt-3 line-clamp-2 text-sm font-semibold leading-tight text-ink group-hover:text-accent">{label}</span>
</button>
