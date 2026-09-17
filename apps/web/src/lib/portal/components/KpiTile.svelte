<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * One portal dashboard signal. Same visual language as the tenant dashboard
   * strip (big mono figure + small uppercase label), with an optional hint line
   * for the detail that makes the number actionable (amount due, oldest item…).
   *
   * `href` turns the tile into a real link to the page that resolves it; a tile
   * without `href` stays a plain read-out.
   */
  let {
    label,
    value,
    hint = undefined,
    href = undefined,
    tone = 'neutral' as 'neutral' | 'warn' | 'danger',
    children = undefined,
  }: {
    label: string;
    value: string | number;
    hint?: string | undefined;
    href?: string | undefined;
    tone?: 'neutral' | 'warn' | 'danger';
    children?: Snippet;
  } = $props();

  const shell = $derived(
    tone === 'danger'
      ? 'border-danger/30 bg-danger-soft'
      : tone === 'warn'
        ? 'border-warn/30 bg-warn-soft'
        : 'border-edge-soft bg-surface',
  );
  const figure = $derived(
    tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-ink',
  );
</script>

{#snippet body()}
  <div class={`font-mono text-3xl font-bold ${figure}`}>{value}</div>
  <div class="mt-1 text-xs tracking-wide text-ink-muted uppercase">{label}</div>
  {#if hint}<div class="mt-1 text-xs text-ink-faint">{hint}</div>{/if}
  {#if children}<div class="mt-1 text-xs text-ink-faint">{@render children()}</div>{/if}
{/snippet}

{#if href}
  <a
    {href}
    class={`block rounded-card border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card ${shell}`}
  >
    {@render body()}
  </a>
{:else}
  <div class={`rounded-card border p-4 shadow-sm ${shell}`}>
    {@render body()}
  </div>
{/if}
