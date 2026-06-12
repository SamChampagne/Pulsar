<script lang="ts">
  let { tabs = [] as { id: string; label: string }[], active = $bindable(''), children } = $props();
</script>

<div class="mb-4 flex gap-1 border-b border-edge">
  {#each tabs as t (t.id)}
    <button
      class={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${active === t.id ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink'}`}
      onclick={() => (active = t.id)}
    >{t.label}</button>
  {/each}
</div>
{@render children()}
