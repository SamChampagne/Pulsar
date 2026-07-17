<script lang="ts">
  import { X } from 'lucide-svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import {
    pushOverlay,
    popOverlay,
    isTopOverlay,
    lockScroll,
    unlockScroll,
  } from '$lib/stores/overlay-stack';

  type Width = 'sm' | 'md' | 'lg';
  let {
    open = $bindable(false),
    title = '',
    width = 'md' as Width,
    onclose = undefined as (() => void) | undefined,
    children,
    footer = undefined,
  } = $props();

  const widths: Record<Width, string> = {
    sm: 'max-w-xs',
    md: 'max-w-md',
    lg: 'max-w-xl',
  };

  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const dur = reduce ? 0 : 200;

  let token = $state<symbol | null>(null);
  let panelEl = $state<HTMLElement | null>(null);
  let lastFocused: HTMLElement | null = null;
  const titleId = `drawer-title-${Math.random().toString(36).slice(2, 9)}`;

  function close() {
    open = false;
    onclose?.();
  }

  $effect(() => {
    if (open) {
      const t = pushOverlay();
      token = t;
      lastFocused = document.activeElement as HTMLElement | null;
      lockScroll();
      queueMicrotask(() => {
        const focusable = panelEl?.querySelector<HTMLElement>(
          'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
        );
        focusable?.focus();
      });
      return () => {
        popOverlay(t);
        token = null;
        unlockScroll();
        lastFocused?.focus?.();
      };
    }
  });

  function onkeydown(e: KeyboardEvent) {
    if (!open || !token || !isTopOverlay(token)) return;
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (e.key === 'Tab' && panelEl) {
      const nodes = Array.from(
        panelEl.querySelectorAll<HTMLElement>(
          'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (n) => !n.hasAttribute('disabled') && n.getAttribute('aria-disabled') !== 'true',
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
</script>

<svelte:window {onkeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex justify-end overflow-hidden bg-sidebar/40 backdrop-blur-[1px]"
    onclick={(e) => {
      if (e.target === e.currentTarget) close();
    }}
    role="presentation"
    transition:fade={{ duration: dur }}
  >
    <div
      bind:this={panelEl}
      class="flex h-full w-full {widths[width]} flex-col bg-surface shadow-pop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      transition:fly={{ x: 40, duration: dur, easing: cubicOut, opacity: reduce ? 1 : 0 }}
    >
      <div class="flex items-center justify-between border-b border-edge px-4 py-3">
        <h2 id={titleId} class="text-sm font-bold text-ink">{title}</h2>
        <button class="text-ink-faint hover:text-ink" onclick={close} aria-label="Fermer">
          <X class="size-4" />
        </button>
      </div>
      <div class="flex-1 overflow-y-auto p-4">{@render children()}</div>
      {#if footer}
        <div class="flex justify-end gap-2 border-t border-edge px-4 py-3">{@render footer()}</div>
      {/if}
    </div>
  </div>
{/if}
