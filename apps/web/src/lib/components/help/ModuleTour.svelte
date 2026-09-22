<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { SvelteSet } from 'svelte/reactivity';
  import { fade } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { auth } from '$lib/stores/auth';
  import { getPreferences, putModuleTour } from '$lib/api/preferences';
  import { tourRequest, shouldStartTour, TOUR_ROUTES } from '$lib/help/tours';
  import { MODULE_GUIDES } from '$lib/help/catalog';
  import { MODULE_LESSONS, LESSON_TITLES } from '$lib/help/module-lessons';
  import { moduleTourVersion } from '@pulsar/shared';
  import type { NavDomain } from '$lib/modules/navigation';
  import type { ModuleTours, ModuleTourProgress, TourModuleKey } from '@pulsar/shared';
  import {
    hasOpenOverlay,
    pushOverlay,
    popOverlay,
    isTopOverlay,
    focusableElements,
  } from '$lib/stores/overlay-stack';
  let { domain }: { domain?: NavDomain } = $props();
  let progress = $state<ModuleTours>({}),
    ready = $state(false),
    open = $state(false);
  let step = $state(0),
    saving = $state(false),
    error = $state('');
  let panel = $state<HTMLElement>(),
    highlight = $state<{ left: number; top: number; width: number; height: number } | null>(null);
  let panelStyle = $state(''),
    token: symbol | null = null;
  let launched = new SvelteSet<string>(),
    // A previous shell's replay request must not reopen guides after signing in again.
    lastRequest = get(tourRequest);
  const reduceMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sessionKey = $derived($auth ? $auth.tenant.id + ':' + $auth.user.id : '');
  const key = $derived(domain?.key as TourModuleKey | undefined);
  const guide = $derived(key ? MODULE_GUIDES[key] : undefined);
  const links = $derived(domain?.sections.flatMap((s) => s.links) ?? []);
  const destinations = $derived(
    (TOUR_ROUTES[key ?? ''] ?? [])
      .map((href) => links.find((l) => l.href === href))
      .filter((l): l is NonNullable<typeof l> => !!l),
  );
  const scanning = $derived(
    ['wms', 'transport', 'manufacturing', 'yard', 'fleet'].includes(key ?? ''),
  );
  const defaultSteps = $derived([
    {
      title: 'Bienvenue dans ' + (domain?.label ?? ''),
      text: guide?.purpose ?? '',
      selectors: ['[data-tour="module-switcher"]'],
      link: undefined,
    },
    {
      title: LESSON_TITLES[key ?? '']?.[0] ?? 'Préparer les références du module',
      text: guide?.steps[0] ?? '',
      selectors: [
        ...(destinations[0] ? [`[data-tour-href="${destinations[0].href}"]`] : []),
        '[data-tour="module-nav"]',
        '[data-tour="module-menu"]',
        '[data-tour="module-switcher"]',
      ],
      link: destinations[0],
    },
    {
      title: LESSON_TITLES[key ?? '']?.[1] ?? 'Traiter les dossiers du module',
      text: guide?.steps[1] ?? '',
      selectors: ['#workspace-content h1', '#workspace-content'],
      link: destinations[1],
    },
    {
      title: LESSON_TITLES[key ?? '']?.[2] ?? 'Vérifier les effets métier',
      text: scanning
        ? 'Le lecteur retrouve un dossier ou remplit une sélection. Les boutons de validation restent nécessaires pour modifier les opérations. En entrepôt, le scan est aussi disponible dans les sélecteurs et les comptages.'
        : (guide?.steps[2] ?? ''),
      selectors: [
        '[data-tour="module-scanner"]',
        '[data-tour="page-actions"]',
        '#workspace-content h1',
      ],
      link: destinations[2],
    },
    {
      title: 'Retrouver l’aide et les connexions',
      text:
        (guide?.connections ?? '') +
        ' Le bouton ? de la page explique son rôle; celui de la barre supérieure relance ce tutoriel.',
      selectors: [
        '[data-tour="page-help"]',
        '[data-tour="module-help"]',
        '[data-tour="module-switcher"]',
      ],
      link: undefined,
    },
  ]);
  const steps = $derived(
    MODULE_LESSONS[key ?? '']
      ? MODULE_LESSONS[key ?? '']
          .filter((s) => !s.href || links.some((l) => l.href === s.href))
          .map((s) => ({
            ...s,
            link: links.find((l) => l.href === s.href),
            selectors:
              s.href && page.url.pathname === s.href
                ? ['#workspace-content h1']
                : s.href
                  ? [`[data-tour-href="${s.href}"]`, '[data-tour="module-menu"]']
                  : ['[data-tour="module-switcher"]'],
          }))
      : defaultSteps,
  );
  $effect(() => {
    const identity = sessionKey;
    let disposed = false;
    ready = false;
    open = false;
    launched.clear();
    progress = {};
    if (!identity) return;
    void getPreferences()
      .then((p) => {
        if (!disposed && sessionKey === identity) {
          progress = p.moduleTours ?? {};
          ready = true;
        }
      })
      .catch(() => {
        // No local "seen" fallback: never mark a tour completed without server confirmation.
        if (!disposed) {
          error = 'Progression indisponible. Le guide peut être relancé depuis l’aide.';
        }
      });
    return () => {
      disposed = true;
    };
  });
  $effect(() => {
    const module = key;
    // Closing when changing module preserves the previous module's recorded progress.
    open = false;
    const loaded = ready;
    const request = $tourRequest;
    const replay = request !== lastRequest;
    if (replay) lastRequest = request;
    if (!module || !untrack(() => guide) || (!loaded && !replay)) return;
    const stored = untrack(() => progress[module]);
    if (!replay && (untrack(() => launched.has(module)) || !shouldStartTour(stored))) return;
    const timer = window.setInterval(() => {
      if (hasOpenOverlay() || document.querySelector('[role="dialog"]')) return;
      clearInterval(timer);
      if (key !== module) return;
      launched.add(module);
      step =
        replay || stored?.version !== moduleTourVersion(module)
          ? 0
          : Math.min(stored?.step ?? 0, steps.length - 1);
      error = '';
      open = true;
      // Record the first presentation immediately, even before the user clicks Next.
      // Failed persistence remains explicit; never hide it behind a local "seen" flag.
      void persist('IN_PROGRESS', step);
    }, 200);
    return () => clearInterval(timer);
  });
  $effect(() => {
    if (!open) return;
    const oldFocus = document.activeElement as HTMLElement | null;
    const t = pushOverlay();
    token = t;
    queueMicrotask(() => panel?.focus());
    return () => {
      popOverlay(t);
      token = null;
      if (oldFocus?.isConnected) oldFocus.focus({ preventScroll: true });
    };
  });
  $effect(() => {
    if (!open) return;
    step;
    page.url.pathname;
    let cancelled = false,
      frame = 0;
    function measure() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (cancelled) return;
        const target = steps[step].selectors
          .flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)])
          .find((el) => el.getClientRects().length && el.getBoundingClientRect().width > 0);
        const r = target?.getBoundingClientRect();
        highlight = r
          ? {
              left: Math.max(4, r.left - 4),
              top: Math.max(4, r.top - 4),
              width: Math.min(r.width + 8, window.innerWidth - Math.max(4, r.left - 4) - 4),
              height: Math.min(r.height + 8, window.innerHeight - Math.max(4, r.top - 4) - 4),
            }
          : null;
        const width = Math.min(420, window.innerWidth - 24);
        const left = Math.max(12, Math.min(r?.left ?? 12, window.innerWidth - width - 12));
        const height = panel?.offsetHeight ?? 330;
        const below = (r?.bottom ?? 0) + 14;
        const top =
          below + height < window.innerHeight - 12
            ? below
            : Math.max(12, window.innerHeight - height - 12);
        panelStyle = `width:${width}px;left:${left}px;top:${top}px;max-height:calc(100dvh - 24px)`;
      });
    }
    void tick().then(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    if (panel) observer.observe(panel);
    window.addEventListener('resize', measure);
    document.addEventListener('scroll', measure, true);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', measure);
      document.removeEventListener('scroll', measure, true);
    };
  });
  $effect(() => {
    if (!open) return;
    step;
    void tick().then(() => {
      if (open) panel?.focus({ preventScroll: true });
    });
  });
  async function persist(status: ModuleTourProgress['status'], next: number) {
    if (!key || saving) return false;
    const module = key,
      identity = sessionKey;
    saving = true;
    error = '';
    try {
      const p = { version: moduleTourVersion(module), step: next, status };
      await putModuleTour(module, p);
      if (identity !== sessionKey || key !== module) return false;
      progress[module] = p;
      return true;
    } catch {
      error =
        'Progression non enregistrée. Réessayez; vous pouvez aussi fermer pour cette session.';
      return false;
    } finally {
      saving = false;
    }
  }
  async function next() {
    if (
      await persist(
        step === steps.length - 1 ? 'COMPLETED' : 'IN_PROGRESS',
        Math.min(step + 1, steps.length - 1),
      )
    ) {
      if (step === steps.length - 1) open = false;
      else step++;
    }
  }
  async function skip() {
    if (await persist('SKIPPED', step)) open = false;
  }
  async function practice() {
    const href = steps[step].link?.href;
    if (!href || !(await persist('IN_PROGRESS', step))) return;
    open = false;
    await goto(href);
  }
  function keydown(e: KeyboardEvent) {
    if (!open || !token || !isTopOverlay(token)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!saving) void skip();
    }
    if (e.key === 'Tab' && panel) {
      const nodes = focusableElements(panel),
        first = nodes[0],
        last = nodes[nodes.length - 1];
      if (!first) {
        e.preventDefault();
        return;
      }
      if (
        e.shiftKey &&
        (document.activeElement === first || !panel.contains(document.activeElement))
      ) {
        e.preventDefault();
        last.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === last || !panel.contains(document.activeElement))
      ) {
        e.preventDefault();
        first.focus();
      }
    }
  }
</script>

<svelte:window onkeydown={keydown} />
{#if !open && key && progress[key]?.status === 'IN_PROGRESS' && launched.has(key)}
  <button
    type="button"
    class="fixed bottom-4 right-4 z-40 rounded-lg border border-edge bg-surface px-4 py-3 text-sm shadow-pop"
    onclick={() => {
      if (hasOpenOverlay()) {
        return;
      }
      step = Math.min(progress[key!]?.step ?? 0, steps.length - 1);
      open = true;
    }}>Reprendre mon parcours · {domain?.label} (fermez d’abord les formulaires)</button
  >
{/if}
{#if open && guide}
  <div
    class="fixed inset-0 z-[60]"
    data-testid="module-tour"
    transition:fade={{ duration: reduceMotion ? 0 : 120 }}
  >
    {#if !highlight}<div class="absolute inset-0 bg-black/40"></div>{/if}
    {#if highlight}<div
        aria-hidden="true"
        class="pointer-events-none fixed rounded-lg border-2 border-accent motion-safe:transition-[left,top,width,height] motion-safe:duration-150"
        style={`left:${highlight.left}px;top:${highlight.top}px;width:${highlight.width}px;height:${highlight.height}px;box-shadow:0 0 0 9999px rgb(0 0 0 / 45%)`}
      ></div>{/if}
    <div
      bind:this={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="module-tour-title"
      aria-describedby="module-tour-body"
      tabindex="-1"
      class="fixed overflow-y-auto rounded-xl border border-edge bg-surface p-5 text-ink shadow-pop outline-none"
      style={panelStyle}
    >
      <p class="mb-2 text-xs font-medium text-ink-muted">
        {domain?.label} · Étape {step + 1} sur {steps.length}
      </p>
      <h2 id="module-tour-title" class="text-lg font-semibold">{steps[step].title}</h2>
      <p id="module-tour-body" class="mt-3 text-sm leading-6 text-ink-muted">{steps[step].text}</p>
      {#if steps[step].link}{@const link = steps[step].link!}
        <button
          type="button"
          class="mt-3 min-h-11 rounded-md border border-edge px-3 text-sm text-accent"
          disabled={saving}
          onclick={() => goto(link.href)}>Explorer : {link.label}</button
        >
        <button
          type="button"
          class="mt-2 ml-2 min-h-11 rounded-md bg-accent px-3 text-sm text-white"
          disabled={saving}
          onclick={practice}>Pratiquer sur cet écran</button
        >
      {/if}
      {#if error}<p class="mt-3 text-sm text-danger" role="alert">{error}</p>{/if}
      <div class="mt-5 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={saving}
          onclick={skip}
          class="min-h-11 rounded-md px-2 text-sm text-ink-muted">Passer le tutoriel</button
        >
        <div class="flex gap-2">
          <button
            type="button"
            disabled={saving || step === 0}
            onclick={() => step--}
            class="min-h-11 rounded-md border border-edge px-3 text-sm disabled:opacity-40"
            >Précédent</button
          >
          <button
            type="button"
            disabled={saving}
            onclick={next}
            class="min-h-11 rounded-md bg-accent px-4 text-sm text-white disabled:opacity-40"
            >{saving
              ? 'Enregistrement…'
              : step === steps.length - 1
                ? 'Terminer'
                : 'Suivant'}</button
          >
        </div>
      </div>
      {#if error}<button class="mt-2 text-xs underline" onclick={() => (open = false)}
          >Fermer pour cette session</button
        >{/if}
    </div>
  </div>
{/if}
