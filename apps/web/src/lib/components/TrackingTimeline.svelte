<script lang="ts">
  export interface TimelineEvent {
    id: string;
    type: string;
    message: string | null;
    occurredAt: string;
    recordedBy?: { firstName: string; lastName: string } | null;
  }

  let { events }: { events: TimelineEvent[] } = $props();

  function dotClass(type: string): string {
    if (type === 'DELAYED' || type === 'EXCEPTION') return 'bg-danger';
    if (type === 'DELIVERED') return 'bg-ok';
    return 'bg-info';
  }
</script>

{#if events.length === 0}
  <p class="text-sm text-ink-muted">No tracking events yet.</p>
{:else}
  <ul class="m-0 list-none p-0">
    {#each events as event (event.id)}
      <li class="relative pb-5 pl-6 last:pb-0">
        <!-- vertical line connecting entries -->
        {#if true}
          <span
            class="absolute left-[5px] top-3.5 bottom-0 w-px border-l-2 border-edge [li:last-child_&]:hidden"
          ></span>
        {/if}
        <!-- colored dot -->
        <span
          class={`absolute left-0 top-1 h-3 w-3 rounded-full border-2 border-surface ${dotClass(event.type)}`}
        ></span>
        <div>
          <div class="flex items-baseline gap-2 text-xs">
            <strong class="text-sm font-semibold text-ink">{event.type.replaceAll('_', ' ')}</strong>
            <span class="text-ink-muted">{new Date(event.occurredAt).toLocaleString()}</span>
          </div>
          {#if event.message}
            <div class="mt-0.5 text-sm text-ink-muted">{event.message}</div>
          {/if}
          {#if event.recordedBy}
            <div class="mt-0.5 text-xs text-ink-faint">by {event.recordedBy.firstName} {event.recordedBy.lastName}</div>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
{/if}
