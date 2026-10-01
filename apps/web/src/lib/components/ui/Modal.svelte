<script lang="ts">
  import { X } from 'lucide-svelte';
  import { fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import {
    pushOverlay,
    popOverlay,
    isTopOverlay,
    lockScroll,
    unlockScroll,
    focusableElements,
  } from '$lib/stores/overlay-stack';

  type Size = 'sm' | 'md' | 'lg' | 'xl' | 'workspace';
  let {
    open = $bindable(false),
    title = '',
    size = 'md' as Size,
    onclose = undefined as (() => void) | undefined,
    dismissible = true,
    variant = 'default' as 'default' | 'folder',
    children,
    footer = undefined,
  } = $props();

  const widths: Record<Size, string> = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    workspace: 'max-w-7xl h-[calc(100dvh-2rem)]',
  };

  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const dur = reduce ? 0 : 150;

  let token = $state<symbol | null>(null);
  let dialogEl = $state<HTMLElement | null>(null);
  let lastFocused: HTMLElement | null = null;
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 9)}`;

  function close() {
    if (!dismissible) return;
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
        if (dialogEl) {
          const nodes = focusableElements(dialogEl);
          (
            nodes.find((node) => node.hasAttribute('data-initial-focus')) ??
            nodes[0] ??
            dialogEl
          ).focus();
        }
      });
      return () => {
        popOverlay(t);
        token = null;
        unlockScroll();
        if (lastFocused?.isConnected) lastFocused.focus({ preventScroll: true });
      };
    }
  });

  function onkeydown(e: KeyboardEvent) {
    if (!open || !token || !isTopOverlay(token)) return;
    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Tab' && dialogEl) {
      const nodes = focusableElements(dialogEl);
      if (nodes.length === 0) {
        e.preventDefault();
        dialogEl.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (
        e.shiftKey &&
        (document.activeElement === first || !dialogEl.contains(document.activeElement))
      ) {
        e.preventDefault();
        last.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === last || !dialogEl.contains(document.activeElement))
      ) {
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
    class="fixed inset-0 z-50 flex items-center justify-center bg-sidebar/40 p-4 backdrop-blur-[1px]"
    onclick={(e) => {
      if (e.target === e.currentTarget) close();
    }}
    role="presentation"
    transition:fade={{ duration: dur }}
  >
    <div
      bind:this={dialogEl}
      class="flex max-h-[calc(100dvh-2rem)] w-full {widths[size]} {size === 'workspace'
        ? 'overflow-hidden'
        : ''} flex-col {variant === 'folder'
        ? 'rounded-3xl bg-surface/95'
        : 'rounded-card bg-surface'} shadow-pop"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      transition:scale={{ duration: dur, start: 0.98, easing: cubicOut }}
    >
      <div class="flex shrink-0 items-center justify-between border-b border-edge px-4 py-3">
        <h2 id={titleId} class="text-sm font-bold text-ink">{title}</h2>
        <button
          class="shell-icon -mr-2"
          disabled={!dismissible}
          onclick={close}
          aria-label="Fermer"
        >
          <X class="size-4" />
        </button>
      </div>
      <div
        class="workspace-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain {size ===
        'workspace'
          ? 'flex overflow-hidden'
          : 'p-4 sm:p-5'}"
      >
        {@render children()}
      </div>
      {#if footer}
        <div class="flex shrink-0 justify-end gap-2 border-t border-edge px-4 py-3">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}
