<script lang="ts">
  let {
    tabs = [] as { id: string; label: string }[],
    active = $bindable(''),
    label = 'Sections',
    children,
  } = $props();
  const id = $props.id();
  let tablist: HTMLDivElement;

  function onkeydown(event: KeyboardEvent, index: number) {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    active = tabs[next].id;
    tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }
</script>

<div
  bind:this={tablist}
  role="tablist"
  aria-label={label}
  class="mb-4 flex min-w-0 gap-1 overflow-x-auto border-b border-edge"
>
  {#each tabs as t, index (t.id)}
    <button
      type="button"
      role="tab"
      id={`${id}-tab-${t.id}`}
      aria-controls={`${id}-panel`}
      aria-selected={active === t.id}
      tabindex={active === t.id || (!active && index === 0) ? 0 : -1}
      class={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-accent ${active === t.id ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:bg-surface-muted hover:text-ink'}`}
      onclick={() => (active = t.id)}
      onkeydown={(event) => onkeydown(event, index)}>{t.label}</button
    >
  {/each}
</div>
<div
  role="tabpanel"
  id={`${id}-panel`}
  aria-labelledby={active ? `${id}-tab-${active}` : undefined}
  tabindex="0"
  class="min-w-0 focus-visible:outline-2 focus-visible:outline-accent"
>
  {@render children()}
</div>
