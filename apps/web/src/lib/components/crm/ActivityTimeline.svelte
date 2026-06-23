<script lang="ts">
  import { formatDateTime } from '$lib/format';

  // ── Types ───────────────────────────────────────────────────────────────────

  export interface Activity {
    id: string;
    type: string;
    body: string;
    dueAt: string | null;
    doneAt: string | null;
    createdAt: string;
    createdByUserId: string | null;
    agentId: string | null;
  }

  // ── Props ───────────────────────────────────────────────────────────────────

  let { activities }: { activities: Activity[] } = $props();

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function typeIcon(type: string): string {
    switch (type) {
      case 'NOTE':    return '📝';
      case 'CALL':    return '📞';
      case 'EMAIL':   return '✉️';
      case 'MEETING': return '🤝';
      case 'TASK':    return '✅';
      default:        return '•';
    }
  }

  function typeLabel(type: string): string {
    switch (type) {
      case 'NOTE':    return 'Note';
      case 'CALL':    return 'Appel';
      case 'EMAIL':   return 'Courriel';
      case 'MEETING': return 'Réunion';
      case 'TASK':    return 'Tâche';
      default:        return type;
    }
  }

  function authorLabel(activity: Activity): string {
    if (activity.agentId) return '🤖 Agent';
    if (activity.createdByUserId) return 'Vous';
    return '—';
  }

  /** Relative label for a date — shows time if today, date otherwise. */
  function relativeTime(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return 'À l\'instant';
    if (diffMin < 60) return `Il y a ${diffMin}m`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `Il y a ${diffH}h`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `Il y a ${diffD}j`;
    return d.toLocaleDateString();
  }
</script>

{#if activities.length === 0}
  <p class="text-xs text-ink-faint">Aucune activité enregistrée.</p>
{:else}
  <ol class="space-y-3">
    {#each activities as activity (activity.id)}
      <li class="flex items-start gap-3 text-xs">
        <!-- Icon bubble -->
        <span
          class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-edge bg-surface-muted text-[11px]"
          title={typeLabel(activity.type)}
        >
          {typeIcon(activity.type)}
        </span>

        <!-- Content -->
        <div class="min-w-0 flex-1">
          <!-- Top row: type + author + time -->
          <div class="mb-0.5 flex flex-wrap items-center gap-1.5">
            <span class="font-semibold text-ink">{typeLabel(activity.type)}</span>
            <span class="text-ink-faint">·</span>
            <span class="text-ink-muted">{authorLabel(activity)}</span>
            <span class="text-ink-faint">·</span>
            <span class="text-ink-faint" title={formatDateTime(activity.createdAt)}>
              {relativeTime(activity.createdAt)}
            </span>
          </div>

          <!-- Body -->
          <p class="leading-snug text-ink">{activity.body}</p>

          <!-- TASK: due / done state -->
          {#if activity.type === 'TASK'}
            <div class="mt-1 flex items-center gap-2">
              {#if activity.doneAt}
                <span class="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-[10px] font-semibold text-ok">
                  ✓ Terminée {relativeTime(activity.doneAt)}
                </span>
              {:else if activity.dueAt}
                {@const overdue = new Date(activity.dueAt) < new Date()}
                <span
                  class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    overdue ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'
                  }`}
                >
                  ⏱ Échéance : {new Date(activity.dueAt).toLocaleDateString()}
                </span>
              {:else}
                <span class="text-[10px] text-ink-faint">Aucune échéance</span>
              {/if}
            </div>
          {/if}
        </div>
      </li>
    {/each}
  </ol>
{/if}
