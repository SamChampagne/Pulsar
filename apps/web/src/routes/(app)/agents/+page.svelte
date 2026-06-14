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

  interface AgentRow {
    id: string;
    name: string;
    description: string | null;
    prefix: string;
    permissions: string[];
    status: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
    role?: string;
    autonomyLevel?: AutonomyLevel;
    avatar?: string;
    model?: string;
    persona?: string;
  }

  let agents = $state<AgentRow[]>([]);
  let error = $state('');
  let loading = $state(true);
  let showForm = $state(false);

  async function load() {
    loading = true;
    try {
      agents = await api<AgentRow[]>('/agents');
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

{#if error}
  <p class="mb-4 text-sm text-danger">{error}</p>
{/if}

{#if loading}
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {#each { length: 6 } as _, i (i)}
      <Card><Skeleton rows={3} /></Card>
    {/each}
  </div>
{:else if agents.length === 0}
  <EmptyState message="Aucun agent enregistré. Engagez votre premier agent IA." />
{:else}
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {#each agents as agent (agent.id)}
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
          {#if agent.revokedAt || agent.status === 'REVOKED'}
            <Badge tone="danger">Revoked</Badge>
          {:else}
            <Badge tone="ok">Active</Badge>
          {/if}
          {#if agent.autonomyLevel}
            <Badge tone={autonomyTone(agent.autonomyLevel)}>{agent.autonomyLevel}</Badge>
          {/if}
        </div>
      </a>
    {/each}
  </div>
{/if}

<RegisterAgentModal bind:open={showForm} onCreated={load} />
