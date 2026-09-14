<script lang="ts">
  import { confirmAction } from '$lib/stores/confirmation';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDateTime } from '$lib/format';
  import { PageHeader, Button, Table, Badge, EmptyState, Card, Skeleton } from '$lib/components/ui';
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
    try {
      agents = await api<AgentRow[]>('/agents');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load agents';
    } finally {
      loading = false;
    }
  }

  async function revoke(agent: AgentRow) {
    if (
      !(await confirmAction(`Revoke agent "${agent.name}"? Its key will stop working immediately.`))
    )
      return;
    try {
      await api(`/agents/${agent.id}`, { method: 'DELETE' });
      toast.success(`${agent.name} revoked`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to revoke');
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Agents">
  {#snippet actions()}
    <Button
      onclick={() => {
        showForm = true;
      }}>Register agent</Button
    >
  {/snippet}
</PageHeader>

<p class="mb-4 text-sm text-ink-muted">
  AI agents act through the MCP server with scoped permissions and optional caps. Mutating actions
  land in the actions inbox for review; reads run live. The agent key authenticates via the
  <code class="rounded bg-surface-muted px-1 text-xs">X-Agent-Key</code> header on
  <code class="rounded bg-surface-muted px-1 text-xs">POST /api/v1/mcp</code>.
</p>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if loading}
  <Card padded={false}><Skeleton rows={5} /></Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Name</th>
      <th>Prefix</th>
      <th>Permissions</th>
      <th>Created</th>
      <th>Status</th>
      <th></th>
    {/snippet}
    {#snippet body()}
      {#each agents as agent (agent.id)}
        <tr>
          <td class="font-semibold">
            {#if agent.avatar}<span class="mr-1">{agent.avatar}</span>{/if}{agent.name}
            {#if agent.role}<span class="ml-1.5 text-xs text-ink-muted">({agent.role})</span>{/if}
          </td>
          <td><code class="text-xs text-ink-muted">{agent.prefix}…</code></td>
          <td class="text-xs text-ink-muted"
            >{agent.permissions.length} scope{agent.permissions.length === 1 ? '' : 's'}</td
          >
          <td class="text-ink-muted">{formatDateTime(agent.createdAt)}</td>
          <td>
            {#if agent.revokedAt || agent.status === 'REVOKED'}
              <Badge tone="danger">Revoked</Badge>
            {:else}
              <Badge tone="ok">Active</Badge>
            {/if}
          </td>
          <td class="text-right">
            {#if !agent.revokedAt && agent.status !== 'REVOKED'}
              <Button
                variant="danger"
                onclick={(e) => {
                  e.stopPropagation();
                  void revoke(agent);
                }}>Revoke</Button
              >
            {/if}
          </td>
        </tr>
      {:else}
        <tr>
          <td colspan={6}><EmptyState message="No agents yet." /></td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<RegisterAgentModal bind:open={showForm} onCreated={load} />
