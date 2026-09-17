<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDate, formatDateTime } from '$lib/format';
  import {
    PageHeader,
    Button,
    Card,
    EmptyState,
    ErrorNotice,
    Skeleton,
    Badge,
    type Tone,
  } from '$lib/components/ui';
  import { untrack } from 'svelte';

  // ── Types ────────────────────────────────────────────────────────────────────

  interface CrmActivity {
    id: string;
    type: string;
    body: string;
    dueAt: string | null;
    doneAt: string | null;
    dealId: string | null;
    companyId: string | null;
    contactId: string | null;
    createdByUserId: string | null;
    agentId: string | null;
    createdAt: string;
  }

  // ── Filter segments ──────────────────────────────────────────────────────────

  type FilterKey = 'overdue' | 'pending' | 'all';

  interface Segment {
    key: FilterKey;
    label: string;
  }

  const SEGMENTS: Segment[] = [
    { key: 'overdue', label: 'Relances en retard' },
    { key: 'pending', label: 'À faire' },
    { key: 'all', label: 'Toutes' },
  ];

  // ── State ────────────────────────────────────────────────────────────────────

  let activeFilter = $state<FilterKey>('overdue');
  let activities = $state<CrmActivity[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 25;
  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  let loading = $state(true);
  let error = $state('');
  let completing = $state<string | null>(null); // activityId being marked done

  // ── Query builder ─────────────────────────────────────────────────────────────

  function buildQuery(): Record<string, string | number | undefined> {
    const base: Record<string, string | number | undefined> = { page, pageSize };
    if (activeFilter === 'overdue') {
      base['overdue'] = 'true';
    } else if (activeFilter === 'pending') {
      base['type'] = 'TASK';
      base['pending'] = 'true';
    }
    return base;
  }

  // ── Data loading ──────────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    try {
      const result = await api<Paginated<CrmActivity>>('/crm/activities', {
        query: buildQuery(),
      });
      activities = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Impossible de charger les activités';
    } finally {
      loading = false;
    }
  }

  // ── Mark done ────────────────────────────────────────────────────────────────

  async function markDone(activityId: string) {
    completing = activityId;
    try {
      await api(`/crm/activities/${activityId}/complete`, { method: 'POST' });
      toast.success('Tâche marquée comme terminée');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Impossible de compléter la tâche');
    } finally {
      completing = null;
    }
  }

  // ── Reactive load — single $effect + untrack pattern ─────────────────────────

  $effect(() => {
    const _f = activeFilter;
    untrack(() => {
      page = 1;
      void load();
    });
  });

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function typeIcon(type: string): string {
    switch (type) {
      case 'NOTE':
        return '📝';
      case 'CALL':
        return '📞';
      case 'EMAIL':
        return '✉️';
      case 'MEETING':
        return '🤝';
      case 'TASK':
        return '✅';
      default:
        return '•';
    }
  }

  function typeLabel(type: string): string {
    switch (type) {
      case 'NOTE':
        return 'Note';
      case 'CALL':
        return 'Appel';
      case 'EMAIL':
        return 'Courriel';
      case 'MEETING':
        return 'Réunion';
      case 'TASK':
        return 'Tâche';
      default:
        return type;
    }
  }

  function typeTone(type: string): Tone {
    switch (type) {
      case 'TASK':
        return 'warn';
      case 'NOTE':
        return 'neutral';
      case 'CALL':
        return 'info';
      case 'EMAIL':
        return 'info';
      case 'MEETING':
        return 'ok';
      default:
        return 'neutral';
    }
  }

  function authorLabel(activity: CrmActivity): string {
    if (activity.agentId) return '🤖 Agent';
    if (activity.createdByUserId) return 'Utilisateur';
    return '—';
  }

  function isOverdue(activity: CrmActivity): boolean {
    return (
      activity.type === 'TASK' &&
      !activity.doneAt &&
      !!activity.dueAt &&
      new Date(activity.dueAt) < new Date()
    );
  }

  function isPendingTask(activity: CrmActivity): boolean {
    return activity.type === 'TASK' && !activity.doneAt;
  }

  function relativeTime(iso: string): string {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return "À l'instant";
    if (diffMin < 60) return `Il y a ${diffMin}m`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `Il y a ${diffH}h`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `Il y a ${diffD}j`;
    return formatDate(iso);
  }

  function subjectRef(activity: CrmActivity): string | null {
    if (activity.dealId) return `Affaire ${activity.dealId.slice(0, 8)}…`;
    if (activity.companyId) return `Société ${activity.companyId.slice(0, 8)}…`;
    if (activity.contactId) return `Contact ${activity.contactId.slice(0, 8)}…`;
    return null;
  }

  function subjectHref(activity: CrmActivity): string | null {
    if (activity.dealId) return `/crm/deals`;
    if (activity.companyId) return `/crm/companies`;
    if (activity.contactId) return `/crm/contacts`;
    return null;
  }
</script>

<PageHeader title="Activités" subtitle="Inbox des relances, tâches et suivis CRM." count={total} />

<ErrorNotice message={error} onretry={load} />

<!-- ── Filter segmented control ───────────────────────────────────────────── -->
<div class="mb-4 flex items-center gap-1 rounded-lg border border-edge bg-surface-muted p-1 w-fit">
  {#each SEGMENTS as seg (seg.key)}
    <button
      type="button"
      class={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        activeFilter === seg.key
          ? 'bg-accent text-white shadow-sm'
          : 'text-ink-muted hover:bg-surface hover:text-ink'
      }`}
      onclick={() => {
        activeFilter = seg.key;
      }}
    >
      {seg.label}
    </button>
  {/each}
</div>

<!-- ── List ───────────────────────────────────────────────────────────────── -->
{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if activities.length === 0}
  <Card>
    <EmptyState
      message={activeFilter === 'overdue'
        ? 'Aucune relance en retard. Tout est à jour !'
        : activeFilter === 'pending'
          ? 'Aucune tâche en attente.'
          : 'Aucune activité enregistrée.'}
    />
  </Card>
{:else}
  <ol class="space-y-2">
    {#each activities as activity (activity.id)}
      {@const overdue = isOverdue(activity)}
      {@const pendingTask = isPendingTask(activity)}
      <li
        class={`flex items-start gap-4 rounded-card border bg-surface px-4 py-3 shadow-sm ${
          overdue ? 'border-danger/40 bg-danger-soft/10' : 'border-edge-soft'
        }`}
      >
        <!-- Type icon bubble -->
        <span
          class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-edge bg-surface-muted text-sm"
          title={typeLabel(activity.type)}
        >
          {typeIcon(activity.type)}
        </span>

        <!-- Content -->
        <div class="min-w-0 flex-1">
          <!-- Top row: type badge + author + created time + subject -->
          <div class="mb-1 flex flex-wrap items-center gap-2">
            <Badge tone={typeTone(activity.type)}>{typeLabel(activity.type)}</Badge>
            <span class="text-xs text-ink-muted">{authorLabel(activity)}</span>
            <span class="text-xs text-ink-faint" title={formatDateTime(activity.createdAt)}>
              {relativeTime(activity.createdAt)}
            </span>
            {#if subjectRef(activity)}
              <span class="text-xs text-ink-faint">·</span>
              {#if subjectHref(activity)}
                <a
                  href={subjectHref(activity)}
                  class="text-xs text-accent hover:underline font-mono"
                >
                  {subjectRef(activity)}
                </a>
              {:else}
                <span class="font-mono text-xs text-ink-faint">{subjectRef(activity)}</span>
              {/if}
            {/if}
          </div>

          <!-- Body -->
          <p class="text-sm leading-snug text-ink">{activity.body}</p>

          <!-- TASK: due/done state + complete button -->
          {#if activity.type === 'TASK'}
            <div class="mt-2 flex flex-wrap items-center gap-3">
              {#if activity.doneAt}
                <span
                  class="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-[10px] font-semibold text-ok"
                >
                  ✓ Terminée le {formatDate(activity.doneAt)}
                </span>
              {:else if activity.dueAt}
                <span
                  class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    overdue ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'
                  }`}
                >
                  ⏱ Échéance : {formatDate(activity.dueAt)}
                  {#if overdue}&nbsp;— En retard{/if}
                </span>
              {:else}
                <span class="text-[10px] text-ink-faint">Aucune échéance</span>
              {/if}

              {#if pendingTask}
                <Button
                  variant="secondary"
                  loading={completing === activity.id}
                  onclick={() => void markDone(activity.id)}
                >
                  Marquer fait
                </Button>
              {/if}
            </div>
          {/if}
        </div>
      </li>
    {/each}
  </ol>

  <!-- ── Pagination ───────────────────────────────────────────────────────── -->
  {#if total > pageSize}
    <div class="mt-4 flex items-center justify-between text-sm text-ink-muted">
      <span class="font-mono text-xs">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} sur {total}
      </span>
      <div class="flex items-center gap-2">
        <Button
          variant="secondary"
          disabled={page <= 1}
          onclick={() => {
            page = Math.max(1, page - 1);
            void load();
          }}>Précédent</Button
        >
        <span class="font-mono text-xs">Page {page} / {totalPages}</span>
        <Button
          variant="secondary"
          disabled={page >= totalPages}
          onclick={() => {
            page = Math.min(totalPages, page + 1);
            void load();
          }}>Suivant</Button
        >
      </div>
    </div>
  {/if}
{/if}
