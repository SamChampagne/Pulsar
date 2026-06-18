<script lang="ts">
  let { name, editing = false, onopen, onremove = undefined, oncontext = undefined } =
    $props<{ name: string; editing?: boolean; onopen: () => void; onremove?: () => void; oncontext?: (e: MouseEvent) => void }>();
</script>

<button type="button"
  class="group relative flex w-24 flex-col items-center text-center outline-none {editing ? 'animate-[wiggle_0.3s_ease-in-out_infinite] motion-reduce:animate-none' : ''}"
  onclick={() => onopen()} oncontextmenu={(e) => oncontext?.(e)} aria-label={`Ouvrir le dossier ${name}`}>
  {#if editing && onremove}
    <span role="button" tabindex="0" class="absolute -top-1 left-5 z-10 grid size-5 place-items-center rounded-full bg-ink text-xs text-white shadow"
      onclick={(e) => { e.stopPropagation(); onremove?.(); }} onkeydown={(e) => { if (e.key === 'Enter') onremove?.(); }} aria-label={`Retirer ${name}`}>×</span>
  {/if}
  <span class="grid size-14 place-items-center rounded-2xl bg-[#737985]/15 p-2 ring-1 ring-black/5 transition duration-150 group-hover:-translate-y-1">
    <span class="grid size-full grid-cols-2 grid-rows-2 gap-1">
      {#each Array(4) as _, i (i)}<span class="rounded-md bg-[#737985]/50"></span>{/each}
    </span>
  </span>
  <span class="mt-3 line-clamp-2 text-sm font-semibold leading-tight text-ink group-hover:text-accent">{name}</span>
</button>
