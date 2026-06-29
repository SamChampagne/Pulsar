<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { PERMISSIONS, isSlaBreached } from '@pulsar/shared';
  import { formatDateTime } from '$lib/format';
  import {
    PageHeader,
    Card,
    Badge,
    Button,
    EmptyState,
    ErrorNotice,
    FilterBar,
    Select,
    Skeleton,
    type Tone,
  } from '$lib/components/ui';
  import AgentPanel from '$lib/components/AgentPanel.svelte';

  // ──────────────────────────────────────────────────────────
  // Types — mirror the Operating Workbench OperationalTask shape
  // ──────────────────────────────────────────────────────────

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
    caseNumber: string | null;
    slaDueAt: string | null;
    escalatedAt: string | null;
  }

  // ──────────────────────────────────────────────────────────
  // Constants — transport-relevant categories (subset of the
  // workbench category enum). Default to DELAY + TENDER_FAILURE.
  // ──────────────────────────────────────────────────────────

  const TRANSPORT_CATEGORIES = ['DELAY', 'TENDER_FAILURE'] as const;

  // ──────────────────────────────────────────────────────────
  // Permissions
  // ──────────────────────────────────────────────────────────

  const canManage = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.OPERATING_TASKS_MANAGE) ?? false,
  );

  // ──────────────────────────────────────────────────────────
  // Filter state — status filter (default OPEN+IN_PROGRESS via '')
  // and a transport-category filter.
  // ──────────────────────────────────────────────────────────

  let statusFilter = $state('');
  let categoryFilter = $state('');

  // ──────────────────────────────────────────────────────────
  // Data state
  // ──────────────────────────────────────────────────────────

  let tasks = $state<OperationalTask[]>([]);
  let total = $state(0);
  let error = $state('');
  let loading = $state(true);
  let actionBusyId = $state<string | null>(null);

  // ──────────────────────────────────────────────────────────
  // Data loading — same endpoint + query params as the workbench.
  // We request the transport categories the API exposes; the API's
  // `category` param accepts one value, so when no explicit category
  // filter is set we load all statuses/categories and narrow to the
  // transport categories client-side.
  // ──────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    try {
      const result = await api<Paginated<OperationalTask>>('/operational-tasks', {
        query: {
          pageSize: 100,
          status: statusFilter || undefined,
          category: categoryFilter || undefined,
        },
      });
      // Keep only transport-relevant exceptions.
      tasks = result.items.filter((t) =>
        (TRANSPORT_CATEGORIES as readonly string[]).includes(t.category),
      );
      total = tasks.length;
      error = '';
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Chargement des exceptions impossible.';
    } finally {
      loading = false;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Triage actions — POST the exact workbench endpoints.
  // ──────────────────────────────────────────────────────────

  async function start(task: OperationalTask) {
    if (actionBusyId) return;
    actionBusyId = task.id;
    try {
      await api(`/operational-tasks/${task.id}/start`, { method: 'POST' });
      await load();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Erreur au démarrage du triage.';
    } finally {
      actionBusyId = null;
    }
  }

  async function resolve(task: OperationalTask) {
    if (actionBusyId) return;
    actionBusyId = task.id;
    try {
      await api(`/operational-tasks/${task.id}/resolve`, { method: 'POST', body: {} });
      await load();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Erreur à la résolution.';
    } finally {
      actionBusyId = null;
    }
  }

  async function dismiss(task: OperationalTask) {
    if (actionBusyId) return;
    actionBusyId = task.id;
    try {
      await api(`/operational-tasks/${task.id}/dismiss`, { method: 'POST', body: {} });
      await load();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Erreur à l’escalade/ignorance.';
    } finally {
      actionBusyId = null;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Derived KPI cards
  // ──────────────────────────────────────────────────────────

  const openCount = $derived(tasks.filter((t) => t.status === 'OPEN').length);
  const inProgressCount = $derived(tasks.filter((t) => t.status === 'IN_PROGRESS').length);
  const overdueCount = $derived(
    tasks.filter(
      (t) =>
        (t.status === 'OPEN' || t.status === 'IN_PROGRESS') &&
        (t.severity === 'CRITICAL' || isSlaBreached(t.slaDueAt, Date.now()) || !!t.escalatedAt),
    ).length,
  );
  const resolvedTodayCount = $derived(
    tasks.filter((t) => {
      if (t.status !== 'RESOLVED' || !t.resolvedAt) return false;
      const r = new Date(t.resolvedAt);
      const now = new Date();
      return (
        r.getFullYear() === now.getFullYear() &&
        r.getMonth() === now.getMonth() &&
        r.getDate() === now.getDate()
      );
    }).length,
  );

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

  function categoryLabel(category: string): string {
    switch (category) {
      case 'DELAY':
        return 'Retard';
      case 'TENDER_FAILURE':
        return 'Échec d’appel d’offres';
      default:
        return category.replaceAll('_', ' ');
    }
  }

  function ageLabel(createdAt: string): string {
    const diffMs = Date.now() - new Date(createdAt).getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return 'à l’instant';
    if (diffMin < 60) return `${diffMin} min`;
    const h = Math.floor(diffMin / 60);
    if (h < 24) return `${h} h`;
    const d = Math.floor(h / 24);
    return `${d} j`;
  }

  function isOverdue(task: OperationalTask): boolean {
    return isSlaBreached(task.slaDueAt, Date.now()) || !!task.escalatedAt;
  }

  // ──────────────────────────────────────────────────────────
  // Reactive load
  // ──────────────────────────────────────────────────────────

  $effect(() => {
    statusFilter;
    categoryFilter;
    void load();
  });
</script>

<PageHeader
  eyebrow="Transport"
  title="Bureau des exceptions"
  subtitle="Triez les exceptions opérationnelles du transport — retards de tournée, échecs d’appels d’offres — avec votre répartiteur IA à portée de main."
  count={total}
/>

<!-- KPI cards -->
<div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
  <Card>
    <div class="text-xl font-bold text-ink">{openCount}</div>
    <div class="text-xs uppercase tracking-wide text-ink-muted">Exceptions ouvertes</div>
    <p class="mt-1 text-xs text-ink-faint">En attente de prise en charge.</p>
  </Card>
  <Card>
    <div class="text-xl font-bold text-ink">{inProgressCount}</div>
    <div class="text-xs uppercase tracking-wide text-ink-muted">En triage</div>
    <p class="mt-1 text-xs text-ink-faint">Analyse en cours.</p>
  </Card>
  <Card>
    <div class="text-xl font-bold text-ink">{overdueCount}</div>
    <div class="text-xs uppercase tracking-wide text-ink-muted">Prioritaires / en retard</div>
    <p class="mt-1 text-xs text-ink-faint">Critiques ou SLA dépassé.</p>
  </Card>
  <Card>
    <div class="text-xl font-bold text-ink">{resolvedTodayCount}</div>
    <div class="text-xs uppercase tracking-wide text-ink-muted">Résolues aujourd’hui</div>
    <p class="mt-1 text-xs text-ink-faint">Clôturées sur la journée.</p>
  </Card>
</div>

<ErrorNotice message={error} onretry={load} />

<!-- Filters -->
<div class="mb-4">
  <FilterBar>
    <div class="w-44">
      <Select bind:value={statusFilter}>
        <option value="">Statuts actifs</option>
        {#each ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED'] as s (s)}
          <option value={s}>{s.replaceAll('_', ' ')}</option>
        {/each}
      </Select>
    </div>
    <div class="w-56">
      <Select bind:value={categoryFilter}>
        <option value="">Toutes les exceptions</option>
        {#each TRANSPORT_CATEGORIES as c (c)}
          <option value={c}>{categoryLabel(c)}</option>
        {/each}
      </Select>
    </div>
  </FilterBar>
</div>

<!-- Two-column layout: exception list + dispatcher AI rail -->
<div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
  <!-- Exception list -->
  <div>
    {#if loading}
      <Card padded={false}><Skeleton rows={6} /></Card>
    {:else if tasks.length === 0}
      <EmptyState
        title="Aucune exception de transport"
        message="Aucune exception ne correspond aux filtres. Ajustez-les ou suivez l’activité dans le poste de travail."
      >
        {#snippet children()}
          <Button variant="secondary" href="/workbench">Ouvrir le poste de travail</Button>
          <Button href="/dispatch">Ouvrir le Dispatch</Button>
        {/snippet}
      </EmptyState>
    {:else}
      <div class="flex flex-col gap-2">
        {#each tasks as task (task.id)}
          <div
            class={`rounded-card border bg-surface p-3 shadow-sm ${
              isOverdue(task)
                ? 'border-danger-soft bg-danger-soft'
                : 'border-edge-soft'
            }`}
          >
            <!-- Top row: severity + status + age -->
            <div class="mb-1.5 flex flex-wrap items-center gap-2">
              <Badge tone={severityTone(task.severity)}>{task.severity}</Badge>
              <Badge tone={statusTone(task.status)}>{task.status.replaceAll('_', ' ')}</Badge>
              <Badge tone="info">{categoryLabel(task.category)}</Badge>
              {#if isOverdue(task)}
                <span class="inline-flex items-center rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">
                  En retard
                </span>
              {/if}
              <span class="ml-auto text-xs text-ink-faint">{ageLabel(task.createdAt)}</span>
            </div>

            <!-- Title + case number -->
            <div class="mb-1">
              {#if task.caseNumber}
                <span class="mr-1 font-mono text-[11px] text-ink-muted">{task.caseNumber}</span>
              {/if}
              <span class="text-sm font-semibold text-ink">{task.title}</span>
            </div>

            <!-- Linked entity + created -->
            <div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-muted">
              {#if task.subjectType && task.subjectId}
                <span>
                  Lié à&nbsp;: <span class="text-ink">{task.subjectType} {task.subjectId}</span>
                </span>
              {/if}
              <span>Créé le {formatDateTime(task.createdAt)}</span>
            </div>

            <!-- Triage actions -->
            {#if canManage && (task.status === 'OPEN' || task.status === 'IN_PROGRESS')}
              <div class="flex flex-wrap gap-2 border-t border-edge-soft pt-2">
                {#if task.status === 'OPEN'}
                  <Button
                    variant="secondary"
                    disabled={actionBusyId === task.id}
                    onclick={() => void start(task)}
                  >
                    Prendre en charge
                  </Button>
                {/if}
                <Button
                  variant="ghost"
                  disabled={actionBusyId === task.id}
                  onclick={() => void dismiss(task)}
                >
                  Escalader / Ignorer
                </Button>
                <Button
                  variant="primary"
                  disabled={actionBusyId === task.id}
                  onclick={() => void resolve(task)}
                >
                  Résoudre
                </Button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Right rail: dispatcher AI agent -->
  <div class="h-[560px]">
    <AgentPanel
      presetId="dispatcher"
      title="Répartiteur IA"
      intro="Demandez au répartiteur d’analyser une exception, de proposer une réaffectation ou de relancer un appel d’offres — il propose, vous approuvez."
    />
  </div>
</div>
