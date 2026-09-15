<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorNotice,
    PageHeader,
    Skeleton,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  // ----- Types ---------------------------------------------------------------

  interface StageOverview {
    stage: string;
    count: number;
    value: number;
  }

  interface RecentActivity {
    id: string;
    type: string;
    body: string;
    createdAt: string;
    dealId: string | null;
    companyId: string | null;
  }

  interface CrmOverview {
    pipeline: StageOverview[];
    openValue: number;
    wonCount: number;
    lostCount: number;
    winRate: number;
    staleDealCount: number;
    dueFollowupCount: number;
    recentActivities: RecentActivity[];
  }

  // ----- State ---------------------------------------------------------------

  let overview = $state<CrmOverview | null>(null);
  let loading = $state(true);
  let error = $state('');

  // ----- Stage metadata ──────────────────────────────────────────────────────

  const STAGE_META: Record<
    string,
    { label: string; tone: 'neutral' | 'info' | 'warn' | 'ok' | 'danger' }
  > = {
    LEAD: { label: 'Prospect', tone: 'neutral' },
    QUALIFIED: { label: 'Qualifié', tone: 'info' },
    PROPOSAL: { label: 'Proposition', tone: 'warn' },
    WON: { label: 'Gagné', tone: 'ok' },
    LOST: { label: 'Perdu', tone: 'danger' },
  };

  // ----- Data loading ────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    try {
      const raw = await api<Record<string, unknown>>('/crm/overview');
      // Coerce all numeric fields defensively (Decimal → string over wire)
      overview = {
        pipeline: (raw.pipeline as Array<Record<string, unknown>>).map((s) => ({
          stage: String(s.stage),
          count: Number(s.count),
          value: Number(s.value),
        })),
        openValue: Number(raw.openValue),
        wonCount: Number(raw.wonCount),
        lostCount: Number(raw.lostCount),
        winRate: Number(raw.winRate),
        staleDealCount: Number(raw.staleDealCount),
        dueFollowupCount: Number(raw.dueFollowupCount),
        recentActivities: (raw.recentActivities as Array<Record<string, unknown>>).map((a) => ({
          id: String(a.id),
          type: String(a.type),
          body: String(a.body),
          createdAt: String(a.createdAt),
          dealId: a.dealId != null ? String(a.dealId) : null,
          companyId: a.companyId != null ? String(a.companyId) : null,
        })),
      };
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Impossible de charger le tableau de bord CRM';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  // ----- Derived ─────────────────────────────────────────────────────────────

  const pipelineMaxCount = $derived(
    overview ? Math.max(...overview.pipeline.map((s) => s.count), 1) : 1,
  );

  // ----- Formatting helpers ──────────────────────────────────────────────────

  const openDeals = $derived(
    overview?.pipeline
      .filter((row) => !['WON', 'LOST'].includes(row.stage))
      .reduce((sum, row) => sum + row.count, 0) ?? 0,
  );

  function formatPct(rate: number): string {
    return `${Math.round(rate * 100)} %`;
  }

  function activityIcon(type: string): string {
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

  function activityTypeLabel(type: string): string {
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
    return d.toLocaleDateString();
  }
</script>

<PageHeader title="CRM" subtitle="Opportunités, relances et activité commerciale.">
  {#snippet actions()}<Button variant="secondary" href="/crm/activities"
      >Relances et activités</Button
    ><Button href="/crm/pipeline">Ouvrir le pipeline</Button>{/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <!-- Loading skeleton -->
  <div class="space-y-6">
    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {#each Array(4) as _, i (i)}
        <Card><Skeleton rows={2} /></Card>
      {/each}
    </div>
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div class="rounded-card border border-edge-soft bg-surface p-4 shadow-sm lg:col-span-2">
        <Skeleton rows={5} />
      </div>
      <Card><Skeleton rows={5} /></Card>
    </div>
  </div>
{:else if overview}
  <!-- ── KPI row ────────────────────────────────────────────────────────── -->
  <div class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
    <!-- Valeur pipeline ouverte -->
    <Card>
      <div class="text-xs font-medium text-ink-muted">Opportunités ouvertes</div>
      <div class="mt-1 text-2xl font-bold text-ink">{openDeals}</div>
      <div class="mt-0.5 text-xs text-ink-faint">Tous les pipelines</div>
    </Card>

    <!-- Taux de gain -->
    <Card>
      <div class="text-xs font-medium text-ink-muted">Taux de gain</div>
      <div class="mt-1 text-2xl font-bold text-ok">{formatPct(overview.winRate)}</div>
      <div class="mt-0.5 text-xs text-ink-faint">
        {overview.wonCount} gagnés · {overview.lostCount} perdus
      </div>
    </Card>

    <!-- Deals en stagnation → link to /crm/activities -->
    <a
      href="/crm/activities"
      class={`block rounded-card border bg-surface p-4 shadow-sm transition-colors ${
        overview.staleDealCount > 0
          ? 'border-warn/50 hover:border-warn'
          : 'border-edge-soft hover:border-edge'
      }`}
    >
      <div class="text-xs font-medium text-ink-muted">Stagnation</div>
      <div
        class={`mt-1 text-2xl font-bold ${overview.staleDealCount > 0 ? 'text-warn' : 'text-ink'}`}
      >
        {overview.staleDealCount}
      </div>
      <div class="mt-0.5 text-xs text-ink-faint">Opportunités sans activité</div>
    </a>

    <!-- Relances dues → link to /crm/activities -->
    <a
      href="/crm/activities"
      class={`block rounded-card border bg-surface p-4 shadow-sm transition-colors ${
        overview.dueFollowupCount > 0
          ? 'border-danger/50 hover:border-danger'
          : 'border-edge-soft hover:border-edge'
      }`}
    >
      <div class="text-xs font-medium text-ink-muted">Relances dues</div>
      <div
        class={`mt-1 text-2xl font-bold ${overview.dueFollowupCount > 0 ? 'text-danger' : 'text-ink'}`}
      >
        {overview.dueFollowupCount}
      </div>
      <div class="mt-0.5 text-xs text-ink-faint">Suivis en retard</div>
    </a>
  </div>

  <!-- ── Middle row: pipeline by stage + recent activities ──────────────── -->
  <div class="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
    <!-- Répartition par statut commercial -->
    <div class="rounded-card border border-edge-soft bg-surface p-4 shadow-sm lg:col-span-2">
      <div class="mb-3 text-sm font-semibold text-ink">Deals par étape</div>
      {#if overview.pipeline.length === 0}
        <EmptyState message="Aucune donnée de pipeline." />
      {:else}
        <div class="space-y-2">
          {#each overview.pipeline as row (row.stage)}
            {@const meta = STAGE_META[row.stage] ?? { label: row.stage, tone: 'neutral' as const }}
            <div class="flex items-center gap-3">
              <div class="w-28 shrink-0">
                <Badge tone={meta.tone}>{meta.label}</Badge>
              </div>
              <div class="flex flex-1 items-center gap-2">
                <!-- Mini bar -->
                <div class="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    class="h-full rounded-full bg-accent/60 transition-all"
                    style="width: {Math.round((row.count / pipelineMaxCount) * 100)}%"
                  ></div>
                </div>
                <span class="w-6 text-right text-xs font-semibold text-ink">{row.count}</span>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Activité récente -->
    <Card>
      <div class="mb-3 text-sm font-semibold text-ink">Activité récente</div>
      {#if overview.recentActivities.length === 0}
        <EmptyState message="Aucune activité récente." />
      {:else}
        <ol class="space-y-3">
          {#each overview.recentActivities as activity (activity.id)}
            <li class="flex items-start gap-2 text-xs">
              <span
                class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-edge bg-surface-muted text-[10px]"
                title={activityTypeLabel(activity.type)}>{activityIcon(activity.type)}</span
              >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="font-semibold text-ink">{activityTypeLabel(activity.type)}</span>
                  <span class="text-ink-faint">·</span>
                  <span class="text-ink-faint">{relativeTime(activity.createdAt)}</span>
                </div>
                <p class="mt-0.5 line-clamp-2 leading-snug text-ink-muted">{activity.body}</p>
                {#if activity.dealId}<a
                    href="/crm/deals/{activity.dealId}"
                    class="mt-1 inline-block text-accent hover:underline">Voir l’opportunité →</a
                  >{:else if activity.companyId}<a
                    href="/crm/companies/{activity.companyId}"
                    class="mt-1 inline-block text-accent hover:underline">Voir la société →</a
                  >{/if}
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </Card>
  </div>

  <!-- ── Quick links ──────────────────────────────────────────────────────── -->
  <div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
    <a
      href="/crm/pipeline"
      class="block rounded-card border border-edge-soft bg-surface p-4 shadow-sm transition-colors hover:border-accent/50"
    >
      <div class="text-base font-semibold text-ink">Pipeline</div>
      <div class="mt-0.5 text-xs text-ink-faint">Kanban des opportunités</div>
    </a>
    <a
      href="/crm/deals"
      class="block rounded-card border border-edge-soft bg-surface p-4 shadow-sm transition-colors hover:border-accent/50"
    >
      <div class="text-base font-semibold text-ink">Opportunités</div>
      <div class="mt-0.5 text-xs text-ink-faint">Liste de toutes les affaires</div>
    </a>
    <a
      href="/crm/activities"
      class="block rounded-card border border-edge-soft bg-surface p-4 shadow-sm transition-colors hover:border-accent/50"
    >
      <div class="text-base font-semibold text-ink">Activités</div>
      <div class="mt-0.5 text-xs text-ink-faint">Inbox et relances</div>
    </a>
  </div>
{/if}
