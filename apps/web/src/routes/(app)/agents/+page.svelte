<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
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

  let items = $state<DashAgent[]>([]);
  let rollup = $state<Rollup | null>(null);
  let error = $state('');
  let loading = $state(true);
  let showForm = $state(false);

  const pct = (r: number) => `${Math.round(r * 100)}%`;

  async function load() {
    loading = true;
    try {
      const data = await api<{ items: DashAgent[]; rollup: Rollup }>('/agents/control-tower');
      items = data.items;
      rollup = data.rollup;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load agents';
    } finally {
      loading = false;
    }
  }

  function autonomyTone(level: AutonomyLevel | undefined): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
    if (level === 'AUTONOMOUS') return 'warn';
    if (level === 'ACT_LOW') return 'info';
    return 'neutral';
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Agents">
  {#snippet actions()}
    <Button onclick={() => { showForm = true; }}>Engager un agent</Button>
  {/snippet}
</PageHeader>

<p class="mb-6 text-sm text-ink-muted">
  Les agents IA agissent via le serveur MCP avec des permissions définies. Chaque agent est un
  employé numérique — ses actions de mutation passent par la file d'approbation.
</p>

{#if rollup}
  <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
    <Card><p class="text-xs text-ink-muted">Agents actifs</p><p class="text-xl font-semibold text-ink">{rollup.active}/{rollup.agents}</p></Card>
    <Card><p class="text-xs text-ink-muted">Actions (30 j)</p><p class="text-xl font-semibold text-ink">{rollup.totalActions}</p></Card>
    <Card><p class="text-xs text-ink-muted">En attente d'approbation</p><p class="text-xl font-semibold text-ink">{rollup.pendingApprovals}</p></Card>
    <Card><p class="text-xs text-ink-muted">Tâches résolues</p><p class="text-xl font-semibold text-ink">{rollup.totalTasksResolved}</p></Card>
  </div>
{/if}

{#if error}
  <p class="mb-4 text-sm text-danger">{error}</p>
{/if}

{#if loading}
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {#each { length: 6 } as _, i (i)}
      <Card><Skeleton rows={3} /></Card>
    {/each}
  </div>
{:else if items.length === 0}
  <EmptyState message="Aucun agent enregistré. Engagez votre premier agent IA." />
{:else}
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {#each items as agent (agent.id)}
      <a
        href="/agents/{agent.id}"
        class="block rounded-card border border-edge bg-surface p-4 shadow-sm transition hover:border-accent hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div class="mb-3 flex items-start gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xl">
            {agent.avatar ?? '🤖'}
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate font-semibold text-ink">{agent.name}</p>
            {#if agent.role}
              <p class="truncate text-xs text-ink-muted">{agent.role}</p>
            {/if}
          </div>
        </div>

        <div class="flex flex-wrap gap-1.5">
          {#if agent.status === 'REVOKED'}
            <Badge tone="danger">Révoqué</Badge>
          {:else if agent.status === 'PAUSED'}
            <Badge tone="warn">En pause</Badge>
          {:else if agent.status === 'ACTIVE'}
            <Badge tone="ok">Actif</Badge>
          {:else}
            <Badge tone="neutral">{agent.status}</Badge>
          {/if}
          {#if agent.autonomyLevel}
            <Badge tone={autonomyTone(agent.autonomyLevel)}>{agent.autonomyLevel}</Badge>
          {/if}
        </div>

        <div class="mt-2 flex flex-wrap gap-1.5 text-xs">
          <Badge tone="neutral">{agent.kpis.actions.total} actions</Badge>
          <Badge tone="ok">{pct(agent.kpis.approvalRate)} appr.</Badge>
          {#if agent.kpis.errorRate > 0}<Badge tone="danger">{pct(agent.kpis.errorRate)} err.</Badge>{/if}
          {#if agent.breakerTrippedAt}<Badge tone="warn">breaker</Badge>{/if}
        </div>
      </a>
    {/each}
  </div>
{/if}

<RegisterAgentModal bind:open={showForm} onCreated={load} />
