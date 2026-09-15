<script lang="ts">
  import { PERMISSIONS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    PageHeader,
    Card,
    Table,
    Badge,
    EmptyState,
    Skeleton,
    ErrorNotice,
    Select,
    type Tone,
  } from '$lib/components/ui';

  interface Kpis {
    actions: {
      total: number;
      executed: number;
      autoApproved: number;
      pending: number;
      rejected: number;
      failed: number;
    };
    approvalRate: number;
    autoApprovalRate: number;
    errorRate: number;
    runs: { total: number; succeeded: number; failed: number; skipped: number; killed: number };
    avgRunLatencyMs: number | null;
    breakerTrips: number;
    tasksResolved: number;
  }
  interface CtAgent {
    id: string;
    name: string;
    role: string | null;
    avatar: string | null;
    status: string;
    autonomyLevel: string;
    breakerTrippedAt: string | null;
    kpis: Kpis;
  }
  interface Rollup {
    agents: number;
    active: number;
    paused: number;
    revoked: number;
    totalActions: number;
    pendingApprovals: number;
    totalBreakerTrips: number;
    totalTasksResolved: number;
  }
  interface ControlTower {
    items: CtAgent[];
    rollup: Rollup;
  }

  const canRead = $derived($auth?.user.permissions.includes(PERMISSIONS.CORE.AGENTS_READ) ?? false);

  let data = $state<ControlTower | null>(null);
  let loading = $state(true);
  let error = $state('');
  let days = $state('30');

  function statusTone(status: string): Tone {
    switch (status) {
      case 'ACTIVE':
        return 'ok';
      case 'PAUSED':
        return 'warn';
      case 'REVOKED':
        return 'danger';
      default:
        return 'neutral';
    }
  }
  function autonomyTone(level: string): Tone {
    switch (level) {
      case 'AUTONOMOUS':
        return 'info';
      case 'ACT_LOW':
        return 'warn';
      case 'PROPOSE':
        return 'neutral';
      default:
        return 'neutral';
    }
  }
  function pct(ratio: number): string {
    return `${Math.round(ratio * 100)} %`;
  }
  function latency(ms: number | null): string {
    if (ms == null) return '—';
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
  }
  function initials(name: string): string {
    return name
      .split(/\s+/)
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  async function load() {
    loading = true;
    error = '';
    try {
      data = await api<ControlTower>('/agents/control-tower', { query: { days } });
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement du Control Tower';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (canRead) {
      void days; // re-run when the window changes
      void load();
    } else {
      loading = false;
    }
  });
</script>

<svelte:head><title>Control Tower — Pulsar</title></svelte:head>

<PageHeader
  title="Supervision des agents"
  subtitle="Santé, productivité et gouvernance de la main-d’œuvre IA du tenant — calculé en direct depuis les runs, actions proposées et tâches."
  count={data?.rollup.agents}
>
  {#snippet actions()}
    <div class="w-40">
      <Select bind:value={days}>
        <option value="7">7 derniers jours</option>
        <option value="30">30 derniers jours</option>
        <option value="90">90 derniers jours</option>
      </Select>
    </div>
  {/snippet}
</PageHeader>

{#if !canRead}
  <Card>
    <EmptyState
      title="Accès restreint"
      message="Vous n’avez pas la permission « core.agents.read »."
    />
  </Card>
{:else}
  <ErrorNotice message={error} onretry={load} />

  {#if loading}
    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {#each Array(5) as _, i (i)}<Card><Skeleton rows={2} /></Card>{/each}
    </div>
    <Card padded={false}><Skeleton rows={6} /></Card>
  {:else if data}
    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Card>
        <div class="text-xs text-ink-faint">Employés IA</div>
        <div class="mt-1 text-2xl font-bold text-ink">{data.rollup.agents}</div>
        <div class="mt-1 text-[11px] text-ink-faint">
          {data.rollup.active} actifs · {data.rollup.paused} en pause · {data.rollup.revoked} révoqués
        </div>
      </Card>
      <Card>
        <div class="text-xs text-ink-faint">Actions ({days} j)</div>
        <div class="mt-1 text-2xl font-bold text-ink">{data.rollup.totalActions}</div>
        <div class="mt-1 text-[11px] text-ink-faint">proposées + exécutées</div>
      </Card>
      <Card>
        <div class="text-xs text-ink-faint">En attente d’approbation</div>
        <div
          class={`mt-1 text-2xl font-bold ${data.rollup.pendingApprovals > 0 ? 'text-warn' : 'text-ink'}`}
        >
          {data.rollup.pendingApprovals}
        </div>
        <div class="mt-1 text-[11px] text-ink-faint">
          <a href="/agent-actions" class="text-accent hover:underline">Voir l’inbox →</a>
        </div>
      </Card>
      <Card>
        <div class="text-xs text-ink-faint">Circuit breaker</div>
        <div
          class={`mt-1 text-2xl font-bold ${data.rollup.totalBreakerTrips > 0 ? 'text-danger' : 'text-ink'}`}
        >
          {data.rollup.totalBreakerTrips}
        </div>
        <div class="mt-1 text-[11px] text-ink-faint">déclenchements</div>
      </Card>
      <Card>
        <div class="text-xs text-ink-faint">Tâches résolues</div>
        <div class="mt-1 text-2xl font-bold text-ok">{data.rollup.totalTasksResolved}</div>
        <div class="mt-1 text-[11px] text-ink-faint">par les agents</div>
      </Card>
    </div>

    {#if data.items.length === 0}
      <Card>
        <EmptyState
          title="Aucun employé IA"
          message="Aucun agent n’est encore enregistré sur ce tenant. Créez-en un dans l’espace Agents."
        >
          {#snippet children()}
            <a
              href="/agents"
              class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
              >Ouvrir l’espace Agents</a
            >
          {/snippet}
        </EmptyState>
      </Card>
    {:else}
      <Table>
        {#snippet head()}
          <th>Employé</th><th>Statut</th><th>Autonomie</th><th class="text-right">Actions</th>
          <th class="text-right">Approbation</th><th class="text-right">Erreur</th>
          <th class="text-right">Runs (ok/err/skip)</th><th class="text-right">Latence</th>
          <th class="text-right">Tâches</th><th></th>
        {/snippet}
        {#snippet body()}
          {#each data!.items as a (a.id)}
            <tr>
              <td>
                <div class="flex items-center gap-2.5">
                  <span
                    class="grid size-8 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-bold text-ink"
                  >
                    {a.avatar || initials(a.name)}
                  </span>
                  <div class="min-w-0">
                    <div class="truncate font-semibold text-ink">{a.name}</div>
                    {#if a.role}<div class="truncate text-xs text-ink-faint">{a.role}</div>{/if}
                  </div>
                </div>
              </td>
              <td>
                <div class="flex flex-col items-start gap-1">
                  <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                  {#if a.breakerTrippedAt}<Badge tone="danger">Breaker</Badge>{/if}
                </div>
              </td>
              <td><Badge tone={autonomyTone(a.autonomyLevel)}>{a.autonomyLevel}</Badge></td>
              <td class="text-right">
                <span class="font-semibold text-ink">{a.kpis.actions.total}</span>
                <div class="text-[11px] text-ink-faint">
                  {a.kpis.actions.executed} exéc · {a.kpis.actions.autoApproved} auto
                  {#if a.kpis.actions.pending > 0}· <span class="text-warn"
                      >{a.kpis.actions.pending} att.</span
                    >{/if}
                </div>
              </td>
              <td class="text-right text-ink">{pct(a.kpis.approvalRate)}</td>
              <td class={`text-right ${a.kpis.errorRate > 0.1 ? 'text-danger' : 'text-ink-muted'}`}>
                {pct(a.kpis.errorRate)}
              </td>
              <td class="text-right text-xs text-ink-muted">
                {a.kpis.runs.succeeded}/{a.kpis.runs.failed}/{a.kpis.runs.skipped}
              </td>
              <td class="text-right text-ink-muted">{latency(a.kpis.avgRunLatencyMs)}</td>
              <td class="text-right text-ink">{a.kpis.tasksResolved}</td>
              <td class="text-right">
                <a href={`/agents/${a.id}`} class="text-xs text-accent hover:underline">Détail →</a>
              </td>
            </tr>
          {/each}
        {/snippet}
      </Table>
    {/if}
  {/if}
{/if}
