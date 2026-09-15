<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import {
    computeAgentAttention,
    rankAgentForOperations,
    summarizeAgentOperationMode,
    type AgentOperationAttention,
  } from '@pulsar/shared';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorNotice,
    PageHeader,
    Skeleton,
  } from '$lib/components/ui';
  import RegisterAgentModal from '$lib/components/agents/RegisterAgentModal.svelte';

  type AutonomyLevel = 'PROPOSE' | 'ACT_LOW' | 'AUTONOMOUS';

  type Kpis = {
    actions: { total: number; executed: number; pending: number };
    approvalRate: number;
    errorRate: number;
    breakerTrips: number;
    tasksResolved?: number;
  };
  type DashAgent = {
    id: string;
    name: string;
    role: string | null;
    avatar: string | null;
    status: string;
    autonomyLevel?: AutonomyLevel;
    breakerTrippedAt?: string | null;
    kpis: Kpis;
  };
  type Rollup = {
    agents: number;
    active: number;
    paused: number;
    revoked: number;
    totalActions: number;
    pendingApprovals: number;
    totalBreakerTrips: number;
    totalTasksResolved: number;
  };

  type AgentView = DashAgent & {
    attention: AgentOperationAttention;
    mode: string;
    rank: number;
  };

  let items = $state<DashAgent[]>([]);
  let rollup = $state<Rollup | null>(null);
  let error = $state('');
  let loading = $state(true);
  let showForm = $state(false);
  // Whether an LLM provider is connected — agents can't talk without one.
  let modelReady = $state<boolean | null>(null);

  const pct = (r: number) => `${Math.round(r * 100)}%`;

  const agentViews = $derived(
    [...items]
      .map((agent): AgentView => {
        const attention = computeAgentAttention(agent);
        return {
          ...agent,
          attention,
          mode: summarizeAgentOperationMode(agent),
          rank:
            rankAgentForOperations(attention) +
            agent.kpis.actions.pending * 10 +
            Math.round(agent.kpis.errorRate * 100),
        };
      })
      .sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name)),
  );

  const attentionQueue = $derived(
    agentViews.filter((agent) => agent.attention.severity !== 'ok').slice(0, 4),
  );

  async function load() {
    loading = true;
    error = '';
    try {
      const data = await api<{ items: DashAgent[]; rollup: Rollup }>('/agents/control-tower');
      items = data.items;
      rollup = data.rollup;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des agents';
    } finally {
      loading = false;
    }
  }

  async function checkModel() {
    try {
      const rt = await api<{ provider?: string | null }>('/agent-runtime');
      modelReady = !!rt?.provider;
    } catch {
      modelReady = false;
    }
  }

  function autonomyTone(
    level: AutonomyLevel | undefined,
  ): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
    if (level === 'AUTONOMOUS') return 'warn';
    if (level === 'ACT_LOW') return 'info';
    return 'neutral';
  }

  function attentionTone(
    severity: AgentOperationAttention['severity'],
  ): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
    if (severity === 'critical') return 'danger';
    if (severity === 'warning') return 'warn';
    if (severity === 'info') return 'info';
    return 'ok';
  }

  function statusTone(status: string): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
    if (status === 'ACTIVE') return 'ok';
    if (status === 'PAUSED') return 'warn';
    if (status === 'REVOKED') return 'danger';
    return 'neutral';
  }

  $effect(() => {
    void load();
    void checkModel();
  });
</script>

<PageHeader
  title="Agents"
  subtitle="Équipe IA, interventions et suivi des actions."
  count={items.length}
>
  {#snippet actions()}
    <Button variant="secondary" href="/agent-actions">Approbations</Button>
    <Button
      onclick={() => {
        showForm = true;
      }}>Nouvel agent</Button
    >
  {/snippet}
</PageHeader>

{#if modelReady === false}
  <div
    class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-warn/40 bg-warn-soft px-4 py-3"
  >
    <div class="text-sm text-ink">
      <span class="font-semibold">Aucun modèle connecté.</span>
      Tes agents ne peuvent pas réfléchir tant qu'un modèle LLM n'est pas branché.
    </div>
    <a
      href="/settings/agent-runtime"
      class="inline-flex shrink-0 items-center rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
      >Connecter un modèle</a
    >
  </div>
{/if}

<ErrorNotice message={error} onretry={load} />
{#if rollup && !loading && !error}
  <dl
    class="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-edge bg-edge sm:grid-cols-4"
  >
    <div class="bg-surface p-4">
      <dt class="text-xs text-ink-muted">Agents actifs</dt>
      <dd class="mt-1 text-2xl font-semibold tabular-nums">
        {rollup.active}<span class="text-sm text-ink-faint"> / {rollup.agents}</span>
      </dd>
    </div>
    <div class="bg-surface p-4">
      <dt class="text-xs text-ink-muted">À approuver</dt>
      <dd class="mt-1 text-2xl font-semibold tabular-nums">
        <a class="text-accent hover:underline" href="/agent-actions">{rollup.pendingApprovals}</a>
      </dd>
    </div>
    <div class="bg-surface p-4">
      <dt class="text-xs text-ink-muted">Actions · 30 jours</dt>
      <dd class="mt-1 text-2xl font-semibold tabular-nums">{rollup.totalActions}</dd>
    </div>
    <div class="bg-surface p-4">
      <dt class="text-xs text-ink-muted">Tâches résolues</dt>
      <dd class="mt-1 text-2xl font-semibold tabular-nums">{rollup.totalTasksResolved}</dd>
    </div>
  </dl>
{/if}

{#if loading}
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {#each { length: 6 } as _, i (i)}
      <Card><Skeleton rows={4} /></Card>
    {/each}
  </div>
{:else if items.length === 0}
  <EmptyState message="Aucun agent enregistré. Engagez votre premier agent IA." />
{:else}
  <div class="mb-5">
    <Card>
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold text-ink">Attention maintenant</h2>
          <p class="mt-0.5 text-xs text-ink-muted">
            Priorisé par risque opérationnel, pas par date de création.
          </p>
        </div>
        <Badge tone={attentionQueue.length ? 'warn' : 'ok'}>
          {attentionQueue.length ? `${attentionQueue.length} à surveiller` : 'sain'}
        </Badge>
      </div>

      {#if attentionQueue.length === 0}
        <div class="rounded-xl border border-edge bg-surface-muted p-4 text-sm text-ink-muted">
          Aucun agent ne demande une intervention immédiate. Continue de surveiller les KPI avant
          d'augmenter l'autonomie.
        </div>
      {:else}
        <ul class="divide-y divide-edge">
          {#each attentionQueue as agent (agent.id)}
            <li class="py-3 first:pt-0 last:pb-0">
              <a
                href="/agents/{agent.id}"
                class="group flex items-start gap-3 rounded-lg p-1 hover:bg-surface-muted"
              >
                <span
                  class="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-lg"
                >
                  {agent.avatar ?? '🤖'}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex flex-wrap items-center gap-2">
                    <span class="font-medium text-ink group-hover:text-accent">{agent.name}</span>
                    <Badge tone={attentionTone(agent.attention.severity)}
                      >{agent.attention.reason}</Badge
                    >
                  </span>
                  <span class="mt-1 block text-xs leading-5 text-ink-muted"
                    >{agent.attention.nextStep}</span
                  >
                </span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    </Card>

    <details class="mt-3 rounded-lg border border-edge bg-surface p-3">
      <summary class="cursor-pointer text-sm font-medium text-ink"
        >Comprendre les niveaux d’autonomie</summary
      >
      <p class="mt-2 text-xs leading-relaxed text-ink-muted">
        PROPOSE : validation humaine. ACT_LOW : actions à faible risque selon les règles. AUTONOMOUS
        : exécution selon les règles autorisées. Les plafonds et la gouvernance restent appliqués
        dans tous les modes.
      </p>
    </details>
  </div>

  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
    {#each agentViews as agent (agent.id)}
      <a
        href="/agents/{agent.id}"
        class="group block rounded-card border border-edge bg-surface p-4 shadow-sm transition-colors hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div class="mb-4 flex items-start gap-3">
          <div
            class="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xl"
          >
            {agent.avatar ?? '🤖'}
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate font-semibold text-ink group-hover:text-accent">{agent.name}</p>
            <p class="truncate text-xs text-ink-muted">{agent.role ?? 'Employé IA Pulsar'}</p>
          </div>
          <Badge tone={attentionTone(agent.attention.severity)}>{agent.attention.severity}</Badge>
        </div>

        <div class="mb-3 flex flex-wrap gap-1.5">
          <Badge tone={statusTone(agent.status)}>{agent.status}</Badge>
          {#if agent.autonomyLevel}
            <Badge tone={autonomyTone(agent.autonomyLevel)}>{agent.autonomyLevel}</Badge>
          {/if}
          {#if agent.breakerTrippedAt}<Badge tone="danger">breaker</Badge>{/if}
        </div>

        <div class="rounded-xl border border-edge bg-surface-muted p-3">
          <p class="text-xs font-medium text-ink">{agent.attention.reason}</p>
          <p class="mt-1 text-xs leading-5 text-ink-muted">{agent.attention.nextStep}</p>
        </div>

        <div class="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <div class="rounded-lg border border-edge p-2">
            <p class="text-base font-semibold text-ink">{agent.kpis.actions.total}</p>
            <p class="text-ink-muted">actions</p>
          </div>
          <div class="rounded-lg border border-edge p-2">
            <p class="text-base font-semibold text-ink">{pct(agent.kpis.approvalRate)}</p>
            <p class="text-ink-muted">approb.</p>
          </div>
          <div class="rounded-lg border border-edge p-2">
            <p class="text-base font-semibold text-ink">{pct(agent.kpis.errorRate)}</p>
            <p class="text-ink-muted">erreur</p>
          </div>
        </div>

        <p class="mt-3 truncate text-xs text-ink-faint">{agent.mode}</p>
      </a>
    {/each}
  </div>
{/if}

<RegisterAgentModal bind:open={showForm} onCreated={load} />
