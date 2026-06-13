<script lang="ts">
  import { PERMISSION_CATALOG } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDateTime } from '$lib/format';
  import {
    PageHeader,
    Button,
    Field,
    Input,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    Modal,
  } from '$lib/components/ui';

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
  }

  // Dispatch-relevant scopes the agent tools use (transportation read/manage + analytics).
  const DISPATCH_KEYS = [
    'transportation.orders.read',
    'transportation.planning.read',
    'transportation.planning.manage',
    'transportation.analytics.read',
  ];
  const dispatchScopes = DISPATCH_KEYS.map((key) => ({
    key,
    description: PERMISSION_CATALOG.find((p) => p.key === key)?.description ?? key,
  }));

  let agents = $state<AgentRow[]>([]);
  let error = $state('');
  let loading = $state(true);
  let showForm = $state(false);
  let name = $state('');
  let description = $state('');
  let permissions = $state<string[]>([]);
  let maxAmountPerAction = $state('');
  let maxActionsPerMinute = $state('');
  let createdKey = $state('');

  async function load() {
    try {
      agents = await api<AgentRow[]>('/agents');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load agents';
    } finally {
      loading = false;
    }
  }

  function togglePermission(key: string) {
    permissions = permissions.includes(key)
      ? permissions.filter((p) => p !== key)
      : [...permissions, key];
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    try {
      const caps: { maxAmountPerAction?: number; maxActionsPerMinute?: number } = {};
      const amount = Number(maxAmountPerAction);
      const rate = Number(maxActionsPerMinute);
      if (maxAmountPerAction.trim() !== '' && amount > 0) caps.maxAmountPerAction = amount;
      if (maxActionsPerMinute.trim() !== '' && rate > 0) caps.maxActionsPerMinute = rate;

      const created = await api<AgentRow & { key: string }>('/agents', {
        method: 'POST',
        body: {
          name,
          ...(description.trim() ? { description } : {}),
          permissions,
          caps,
        },
      });
      createdKey = created.key;
      name = '';
      description = '';
      permissions = [];
      maxAmountPerAction = '';
      maxActionsPerMinute = '';
      showForm = false;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to register agent');
    }
  }

  async function copyKey() {
    await navigator.clipboard.writeText(createdKey);
    toast.success('Agent key copied — store it now, it will not be shown again');
  }

  async function revoke(agent: AgentRow) {
    if (!confirm(`Revoke agent "${agent.name}"? Its key will stop working immediately.`)) return;
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
    <Button onclick={() => { showForm = true; }}>Register agent</Button>
  {/snippet}
</PageHeader>

<p class="mb-4 text-sm text-ink-muted">
  AI agents act through the MCP server with scoped permissions and optional caps. Mutating actions
  land in the actions inbox for review; reads run live. The agent key authenticates via the
  <code class="rounded bg-surface-muted px-1 text-xs">X-Agent-Key</code> header on
  <code class="rounded bg-surface-muted px-1 text-xs">POST /api/v1/mcp</code>.
</p>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if createdKey}
  <Card>
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex-1">
        <p class="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">Your new agent key — shown once</p>
        <code class="break-all text-sm text-ink">{createdKey}</code>
      </div>
      <Button variant="secondary" onclick={copyKey}>Copy</Button>
    </div>
    <p class="mt-2 text-xs text-ink-muted">Store it somewhere safe. You will not be able to view it again.</p>
  </Card>
{/if}

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
          <td class="font-semibold">{agent.name}</td>
          <td><code class="text-xs text-ink-muted">{agent.prefix}…</code></td>
          <td class="text-xs text-ink-muted">{agent.permissions.length} scope{agent.permissions.length === 1 ? '' : 's'}</td>
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
                onclick={(e) => { e.stopPropagation(); void revoke(agent); }}
              >Revoke</Button>
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

<Modal bind:open={showForm} title="Register agent">
  {#snippet children()}
    <form onsubmit={create}>
      <Field label="Name">
        <Input bind:value={name} required placeholder="Dispatch copilot" />
      </Field>
      <div class="mt-3">
        <Field label="Description">
          <Input bind:value={description} placeholder="Optional — what this agent does" />
        </Field>
      </div>
      <div class="mt-3">
        <span class="mb-1.5 block text-xs font-semibold tracking-wide text-ink-muted uppercase">Permissions</span>
        <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {#each dispatchScopes as scope (scope.key)}
            <label class="flex cursor-pointer items-center gap-1.5 text-xs text-ink">
              <input
                type="checkbox"
                checked={permissions.includes(scope.key)}
                onchange={() => togglePermission(scope.key)}
              />
              <code class="text-ink-muted">{scope.key}</code>
            </label>
          {/each}
        </div>
      </div>
      <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Max amount per action">
          <Input type="number" bind:value={maxAmountPerAction} placeholder="Optional" />
        </Field>
        <Field label="Max actions per minute">
          <Input type="number" bind:value={maxActionsPerMinute} placeholder="Optional" />
        </Field>
      </div>
      <div class="mt-4 flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={() => { showForm = false; }}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={permissions.length === 0}>Register agent</Button>
      </div>
    </form>
  {/snippet}
</Modal>
