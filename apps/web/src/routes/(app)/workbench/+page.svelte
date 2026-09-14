<script lang="ts">
  import { page as route } from '$app/state';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { PERMISSIONS } from '@pulsar/shared';
  import { isSlaBreached } from '@pulsar/shared';
  import { formatDateTime } from '$lib/format';
  import {
    PageHeader,
    Button,
    FilterBar,
    Select,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    ErrorNotice,
    ViewToggle,
    type ViewId,
    type Tone,
  } from '$lib/components/ui';
  import TaskDetailPanel from '$lib/components/workbench/TaskDetailPanel.svelte';

  // ──────────────────────────────────────────────────────────
  // Types
  // ──────────────────────────────────────────────────────────

  interface ProposedActionRef {
    id: string;
    tool: string;
    riskTier: string;
    status: string;
    triggeredByRef: string | null;
    proposedAt: string;
    decidedAt: string | null;
  }

  interface NoteEntry {
    at: string;
    byUserId: string;
    text: string;
  }

  interface OperationalTask {
    id: string;
    type: string;
    category: string;
    status: string;
    severity: string;
    title: string;
    details: Record<string, unknown> | null;
    subjectType: string | null;
    subjectId: string | null;
    assigneeType: string;
    assigneeUserId: string | null;
    assigneeAgentId: string | null;
    createdAt: string;
    resolvedAt: string | null;
    // v2 enriched fields
    caseNumber: string | null;
    slaDueAt: string | null;
    escalatedAt: string | null;
    // detail-only fields (populated after GET :id)
    slaBreached?: boolean;
    notes?: NoteEntry[] | null;
    proposedActions?: ProposedActionRef[];
  }

  // ──────────────────────────────────────────────────────────
  // Constants
  // ──────────────────────────────────────────────────────────

  const ALL_CATEGORIES = [
    'DELAY',
    'TENDER_FAILURE',
    'FREIGHT_AUDIT',
    'FLEET_MAINTENANCE',
    'FLEET_PM_DUE',
    'WMS_REPLENISH',
    'WMS_COUNT_VARIANCE',
    'FULFILLMENT_READY',
    'YARD_ARRIVAL',
    'YARD_DETENTION',
    'YARD_APPOINTMENT_LATE',
  ] as const;

  const KANBAN_COLUMNS = [
    { key: 'OPEN', label: 'Nouveau', tone: 'warn' as Tone },
    { key: 'IN_PROGRESS', label: 'En analyse', tone: 'info' as Tone },
    { key: 'RESOLVED', label: 'Résolu', tone: 'ok' as Tone },
    { key: 'DISMISSED', label: 'Ignoré', tone: 'neutral' as Tone },
  ] as const;

  // ──────────────────────────────────────────────────────────
  // Permissions
  // ──────────────────────────────────────────────────────────

  const canManage = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.OPERATING_TASKS_MANAGE) ?? false,
  );

  // ──────────────────────────────────────────────────────────
  // View state
  // ──────────────────────────────────────────────────────────

  let view = $state<ViewId>('kanban');

  // ──────────────────────────────────────────────────────────
  // Filter state
  // ──────────────────────────────────────────────────────────

  let statusFilter = $state('');
  let categoryFilter = $state('');
  let assigneeTypeFilter = $state('');

  // ──────────────────────────────────────────────────────────
  // Data state
  // ──────────────────────────────────────────────────────────

  let tasks = $state<OperationalTask[]>([]);
  let total = $state(0);
  let error = $state('');
  let loading = $state(true);

  // Detail panel
  let selected = $state<OperationalTask | null>(null);
  let detailLoading = $state(false);
  $effect(() => {
    const id = route.url.searchParams.get('task');
    if (!id) return;
    let active = true;
    detailLoading = true;
    void api<OperationalTask>(`/operational-tasks/${encodeURIComponent(id)}`)
      .then((task) => {
        if (active) selected = task;
      })
      .catch(() => {
        if (active) error = 'Cette tâche est introuvable ou non accessible.';
      })
      .finally(() => {
        if (active) detailLoading = false;
      });
    return () => {
      active = false;
    };
  });

  // ──────────────────────────────────────────────────────────
  // Derived summary counts
  // ──────────────────────────────────────────────────────────

  const criticalCount = $derived(tasks.filter((t) => t.severity === 'CRITICAL').length);
  const agentAssignedCount = $derived(tasks.filter((t) => t.assigneeType === 'AGENT').length);
  const slaBreachedCount = $derived(
    tasks.filter((t) => isSlaBreached(t.slaDueAt, Date.now())).length,
  );

  // ──────────────────────────────────────────────────────────
  // Kanban columns — derived from current tasks list
  // ──────────────────────────────────────────────────────────

  const kanbanColumns = $derived(
    KANBAN_COLUMNS.map((col) => ({
      ...col,
      tasks: tasks.filter((t) => t.status === col.key),
    })),
  );

  // ──────────────────────────────────────────────────────────
  // Data loading
  // ──────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    try {
      // For kanban: load all statuses at once (no status filter override)
      const effectiveStatus = statusFilter || undefined;
      const result = await api<Paginated<OperationalTask>>('/operational-tasks', {
        query: {
          pageSize: 100,
          status: effectiveStatus,
          category: categoryFilter || undefined,
          assigneeType: assigneeTypeFilter || undefined,
        },
      });
      tasks = result.items;
      total = result.total;
      error = '';
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load workbench tasks';
    } finally {
      loading = false;
    }
  }

  async function openDetail(task: OperationalTask) {
    selected = task;
    detailLoading = true;
    try {
      const full = await api<OperationalTask>(`/operational-tasks/${task.id}`);
      selected = full;
    } catch {
      // keep the row data
    } finally {
      detailLoading = false;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  function severityTone(severity: string): Tone {
    switch (severity?.toUpperCase()) {
      case 'CRITICAL':
        return 'danger';
      case 'WARNING':
        return 'warn';
      case 'INFO':
        return 'info';
      default:
        return 'neutral';
    }
  }

  function statusTone(status: string): Tone {
    switch (status?.toUpperCase()) {
      case 'OPEN':
        return 'warn';
      case 'IN_PROGRESS':
        return 'info';
      case 'RESOLVED':
        return 'ok';
      case 'DISMISSED':
        return 'neutral';
      default:
        return 'neutral';
    }
  }

  function slaBadgeInfo(task: OperationalTask): { label: string; cls: string } | null {
    if (!task.slaDueAt) return null;
    const now = Date.now();
    const due = new Date(task.slaDueAt).getTime();
    const diffMs = due - now;
    const breached = diffMs <= 0 || !!task.escalatedAt;
    if (breached) {
      return { label: 'En retard', cls: 'bg-danger-soft text-danger' };
    }
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 60) return { label: `SLA ${diffMin}m`, cls: 'bg-ok-soft text-ok' };
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    const label = m > 0 ? `SLA ${h}h${m}m` : `SLA ${h}h`;
    return { label, cls: diffMin < 120 ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok' };
  }

  function assigneeLabel(task: OperationalTask): string {
    if (task.assigneeType === 'UNASSIGNED') return 'Non assigné';
    if (task.assigneeType === 'HUMAN') return 'Humain';
    if (task.assigneeType === 'AGENT') return 'Agent';
    return task.assigneeType;
  }

  // ──────────────────────────────────────────────────────────
  // Reactive load
  // ──────────────────────────────────────────────────────────

  $effect(() => {
    view;
    statusFilter;
    categoryFilter;
    assigneeTypeFilter;
    void load();
  });
</script>

<PageHeader
  title="Poste de travail"
  subtitle="Triez les exceptions, approbations, révisions et notifications générées par les politiques et agents Pulsar."
  count={total}
/>

<!-- Summary cards -->
<div class="mb-4 grid gap-3 sm:grid-cols-4">
  <Card>
    <div class="text-xl font-bold text-ink">{criticalCount}</div>
    <div class="text-xs uppercase tracking-wide text-ink-muted">Critiques</div>
    <p class="mt-1 text-xs text-ink-faint">À traiter en priorité.</p>
  </Card>
  <Card>
    <div class="text-xl font-bold text-ink">{slaBreachedCount}</div>
    <div class="text-xs uppercase tracking-wide text-ink-muted">SLA dépassé</div>
    <p class="mt-1 text-xs text-ink-faint">Délai de traitement expiré.</p>
  </Card>
  <Card>
    <div class="text-xl font-bold text-ink">{agentAssignedCount}</div>
    <div class="text-xs uppercase tracking-wide text-ink-muted">Agents</div>
    <p class="mt-1 text-xs text-ink-faint">Travail délégué aux agents employés.</p>
  </Card>
  <Card>
    <div class="text-xl font-bold text-ink">{total}</div>
    <div class="text-xs uppercase tracking-wide text-ink-muted">Total</div>
    <p class="mt-1 text-xs text-ink-faint">Tâches correspondant aux filtres.</p>
  </Card>
</div>

<ErrorNotice message={error} onretry={load} />

<!-- Filters + view toggle -->
<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
  <FilterBar>
    <div class="w-40">
      <Select bind:value={statusFilter}>
        <option value="">Tous les statuts</option>
        {#each ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED'] as s (s)}
          <option value={s}>{s.replaceAll('_', ' ')}</option>
        {/each}
      </Select>
    </div>
    <div class="w-52">
      <Select bind:value={categoryFilter}>
        <option value="">Toutes les catégories</option>
        {#each ALL_CATEGORIES as c (c)}
          <option value={c}>{c.replaceAll('_', ' ')}</option>
        {/each}
      </Select>
    </div>
    <div class="w-44">
      <Select bind:value={assigneeTypeFilter}>
        <option value="">Tous les assignés</option>
        {#each ['UNASSIGNED', 'HUMAN', 'AGENT'] as a (a)}
          <option value={a}>{a}</option>
        {/each}
      </Select>
    </div>
  </FilterBar>
  <ViewToggle bind:view views={['table', 'kanban']} />
</div>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if tasks.length === 0}
  <EmptyState
    title="Aucune tâche opérationnelle"
    message="Modifiez les filtres ou attendez que des politiques ou agents créent du travail nécessitant un triage."
  >
    {#snippet children()}
      <Button variant="secondary" href="/agent-actions">Réviser les actions agents</Button>
      <Button href="/dispatch">Ouvrir le Dispatch</Button>
    {/snippet}
  </EmptyState>
{:else if view === 'table'}
  <!-- ─── TABLE VIEW ─── -->
  <Table>
    {#snippet head()}
      <th>Sévérité</th>
      <th>Titre</th>
      <th>Catégorie</th>
      <th>SLA</th>
      <th>Sujet</th>
      <th>Assigné</th>
      <th>Statut</th>
      <th>Créé le</th>
    {/snippet}
    {#snippet body()}
      {#each tasks as task (task.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <tr class="cursor-pointer" onclick={() => void openDetail(task)}>
          <td><Badge tone={severityTone(task.severity)}>{task.severity}</Badge></td>
          <td class="font-semibold text-ink">
            {#if task.caseNumber}
              <span class="mr-1 text-ink-muted font-mono text-xs">{task.caseNumber}</span>
            {/if}
            {task.title}
          </td>
          <td class="text-xs text-ink-muted">{task.category.replaceAll('_', ' ')}</td>
          <td>
            {#if task.slaDueAt}
              {@const sla = slaBadgeInfo(task)}
              {#if sla}
                <span
                  class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${sla.cls}`}
                >
                  {sla.label}
                </span>
              {/if}
            {:else}
              <span class="text-ink-faint text-xs">—</span>
            {/if}
          </td>
          <td class="text-xs text-ink-muted">
            {#if task.subjectType && task.subjectId}
              {task.subjectType} {task.subjectId}
            {:else}—{/if}
          </td>
          <td class="text-xs text-ink-muted">{assigneeLabel(task)}</td>
          <td><Badge tone={statusTone(task.status)}>{task.status.replaceAll('_', ' ')}</Badge></td>
          <td class="text-ink-muted">{formatDateTime(task.createdAt)}</td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{:else}
  <!-- ─── KANBAN VIEW ─── -->
  <div class="flex gap-4 overflow-x-auto pb-4">
    {#each kanbanColumns as col (col.key)}
      <div class="flex w-72 shrink-0 flex-col">
        <!-- Column header -->
        <div class="mb-3 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-ink">{col.label}</span>
            <Badge tone={col.tone}>{col.tasks.length}</Badge>
          </div>
        </div>

        <!-- Cards -->
        <div class="flex flex-col gap-2">
          {#each col.tasks as task (task.id)}
            {@const sla = slaBadgeInfo(task)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              role="button"
              tabindex="0"
              class="cursor-pointer rounded-card border border-edge-soft bg-surface p-3 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              onclick={() => void openDetail(task)}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void openDetail(task);
                }
              }}
            >
              <!-- Top row: severity + SLA -->
              <div class="mb-2 flex items-center justify-between gap-1">
                <Badge tone={severityTone(task.severity)}>{task.severity}</Badge>
                {#if sla}
                  <span
                    class={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${sla.cls}`}
                  >
                    ⏱ {sla.label}
                  </span>
                {/if}
              </div>

              <!-- Case number + title -->
              <div class="mb-1">
                {#if task.caseNumber}
                  <div class="font-mono text-[10px] text-ink-muted">{task.caseNumber}</div>
                {/if}
                <div class="text-sm font-semibold leading-snug text-ink">{task.title}</div>
              </div>

              <!-- Category -->
              <div class="mb-2 text-[11px] text-ink-muted">
                {task.category.replaceAll('_', ' ')}
              </div>

              <!-- Bottom row: assignee + escalated indicator -->
              <div class="flex items-center justify-between text-[10px] text-ink-faint">
                <span>{assigneeLabel(task)}</span>
                {#if task.escalatedAt}
                  <Badge tone="danger">Escaladé</Badge>
                {/if}
              </div>
            </div>
          {/each}

          {#if col.tasks.length === 0}
            <div
              class="rounded-card border border-dashed border-edge py-6 text-center text-xs text-ink-faint"
            >
              Aucune tâche
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <!-- Kanban footnote for "attente humain" -->
  <p class="mt-2 text-xs text-ink-faint">
    Les tâches «&nbsp;En attente approbation humaine&nbsp;» (actions proposées en attente)
    apparaissent dans la colonne «&nbsp;En analyse&nbsp;» — ouvrez la tâche pour voir le détail des
    actions.
  </p>
{/if}

<!-- ─── DETAIL PANEL ─── -->
{#if selected && !detailLoading}
  <TaskDetailPanel
    task={selected}
    {canManage}
    onclose={() => {
      selected = null;
    }}
    onrefresh={() => void load()}
  />
{:else if selected && detailLoading}
  <!-- Loading overlay while fetching detail -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-sidebar/40 backdrop-blur-[1px]"
  >
    <div class="rounded-card bg-surface px-6 py-4 shadow-pop">
      <Skeleton rows={4} />
    </div>
  </div>
{/if}
