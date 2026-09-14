<script lang="ts">
  let { sections }: { sections: { id: string; label: string }[] } = $props();
  let active = $state('');
  let nav = $state<HTMLElement>();
  // Preserve an explicit destination when the last section cannot reach the
  // top of the viewport. A new scroll gesture resumes automatic tracking.
  let requestedSection: string | null = null;

  $effect(() => {
    const entries = sections;
    const root = nav?.closest('[data-workspace-scroll]');
    if (!root) return;
    let frame = 0;
    function update() {
      if (requestedSection && entries.some((entry) => entry.id === requestedSection)) {
        active = requestedSection;
        return;
      }
      const top = root!.getBoundingClientRect().top + (nav?.offsetHeight ?? 44) + 32;
      active = entries[0]?.id ?? '';
      let closest = Infinity;
      for (const entry of entries) {
        const target = document.getElementById(entry.id);
        const y = target?.getBoundingClientRect().top;
        if (y !== undefined && Math.abs(y - top) < closest) {
          active = entry.id;
          closest = Math.abs(y - top);
        }
      }
    }
    function onscroll() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    }
    function resumeTracking(event: Event) {
      if (
        event instanceof KeyboardEvent &&
        !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
      )
        return;
      requestedSection = null;
    }
    update();
    root.addEventListener('scroll', onscroll, { passive: true });
    for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
      root.addEventListener(name, resumeTracking, { passive: true });
    return () => {
      root.removeEventListener('scroll', onscroll);
      for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
        root.removeEventListener(name, resumeTracking);
      cancelAnimationFrame(frame);
    };
  });

  function navigate(event: MouseEvent, id: string) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(id);
    const root = nav?.closest('[data-workspace-scroll]');
    if (!target || !root) return;
    event.preventDefault();
    requestedSection = id;
    target.focus({ preventScroll: true });
    // Only scroll the work surface, never the document behind the fixed shell.
    root.scrollTo({
      top:
        root.scrollTop +
        target.getBoundingClientRect().top -
        root.getBoundingClientRect().top -
        (nav?.offsetHeight ?? 44) -
        24,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
    active = id;
  }
</script>

<nav
  bind:this={nav}
  aria-label="Sections du dossier"
  class="sticky top-0 z-10 mb-5 flex max-w-full gap-1 overflow-x-auto border-b border-edge bg-surface py-1"
>
  {#each sections as section (section.id)}
    <a
      href={'#' + section.id}
      aria-current={active === section.id ? 'location' : undefined}
      onclick={(e) => navigate(e, section.id)}
      class="shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent {active ===
      section.id
        ? 'bg-surface-muted text-ink'
        : 'text-ink-muted hover:bg-surface-muted hover:text-ink'}">{section.label}</a
    >
  {/each}
</nav>
