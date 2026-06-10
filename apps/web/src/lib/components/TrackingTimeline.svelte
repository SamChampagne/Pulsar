<script lang="ts">
  export interface TimelineEvent {
    id: string;
    type: string;
    message: string | null;
    occurredAt: string;
    recordedBy?: { firstName: string; lastName: string } | null;
  }

  let { events }: { events: TimelineEvent[] } = $props();
</script>

{#if events.length === 0}
  <p class="muted">No tracking events yet.</p>
{:else}
  <ul class="timeline">
    {#each events as event (event.id)}
      <li>
        <span class="dot"></span>
        <div>
          <div class="event-head">
            <strong>{event.type.replaceAll('_', ' ')}</strong>
            <span class="muted">{new Date(event.occurredAt).toLocaleString()}</span>
          </div>
          {#if event.message}
            <div class="muted">{event.message}</div>
          {/if}
          {#if event.recordedBy}
            <div class="muted small">by {event.recordedBy.firstName} {event.recordedBy.lastName}</div>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .timeline {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .timeline li {
    position: relative;
    padding: 0 0 18px 24px;
  }

  .timeline li:not(:last-child)::before {
    content: '';
    position: absolute;
    left: 5px;
    top: 14px;
    bottom: 0;
    width: 2px;
    background: var(--color-border);
  }

  .dot {
    position: absolute;
    left: 0;
    top: 4px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--color-primary);
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px var(--color-border);
  }

  .event-head {
    display: flex;
    gap: 10px;
    align-items: baseline;
    font-size: 13px;
  }

  .small {
    font-size: 11px;
  }
</style>
