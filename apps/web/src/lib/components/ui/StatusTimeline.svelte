<script module lang="ts">
  import type { Tone } from './status';

  export interface TimelineEntry {
    label: string;
    timestamp?: string | Date;
    actor?: string;
    description?: string;
    tone?: Tone;
  }
</script>

<script lang="ts">
  import { formatDateTime } from '$lib/format';
  let { entries = [] as TimelineEntry[] } = $props();

  const dotClass: Record<Tone, string> = {
    ok: 'bg-ok',
    warn: 'bg-warn',
    danger: 'bg-danger',
    info: 'bg-info',
    neutral: 'bg-neutral',
  };

  function formatTimestamp(ts: string | Date | undefined): string {
    if (!ts) return '';
    const d = typeof ts === 'string' ? new Date(ts) : ts;
    if (Number.isNaN(d.getTime())) return '';
    return formatDateTime(d.toISOString());
  }
</script>

{#if entries.length === 0}
  <p class="text-sm text-ink-muted">Aucun événement.</p>
{:else}
  <ul class="m-0 list-none p-0">
    {#each entries as entry, i (i)}
      <li class="relative pb-5 pl-6 last:pb-0">
        <!-- vertical line connecting entries -->
        <span
          class="absolute left-[5px] top-3.5 bottom-0 w-px border-l-2 border-edge [li:last-child_&]:hidden"
        ></span>
        <!-- colored dot -->
        <span
          class={`absolute left-0 top-1 h-3 w-3 rounded-full border-2 border-surface ${dotClass[entry.tone ?? 'neutral']}`}
        ></span>
        <div>
          <div class="flex items-baseline gap-2 text-xs">
            <strong class="text-sm font-semibold text-ink">{entry.label}</strong>
            {#if entry.timestamp}
              <span class="text-ink-muted">{formatTimestamp(entry.timestamp)}</span>
            {/if}
          </div>
          {#if entry.description}
            <div class="mt-0.5 text-sm text-ink-muted">{entry.description}</div>
          {/if}
          {#if entry.actor}
            <div class="mt-0.5 text-xs text-ink-faint">par {entry.actor}</div>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
{/if}
