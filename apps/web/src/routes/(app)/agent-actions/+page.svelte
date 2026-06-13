<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { PERMISSIONS } from '@pulsar/shared';
  import { toast } from '$lib/stores/toast';
  import { formatDateTime } from '$lib/format';
  import {
    PageHeader,
    Button,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    type Tone,
  } from '$lib/components/ui';

  // listPending returns the clean projection (see proposed-actions.service project()).
  interface Proposal {
    id: string;
    tool: string;
    riskTier: string;
    status: string;
    args: Record<string, unknown>;
    triggeredByRef: string | null;
    proposedAt: string;
  }

  const canApprove = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.AGENTS_ACTIONS_APPROVE) ?? false,
  );

  let pending = $state<Proposal[]>([]);
  let error = $state('');
  let loading = $state(true);
  let busy = $state<Record<string, boolean>>({});

  async function load() {
    try {
      pending = await api<Proposal[]>('/agent-actions');
      error = '';
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load agent actions';
    } finally {
      loading = false;
    }
  }

  async function approve(p: Proposal) {
    busy[p.id] = true;
    try {
      await api(`/agent-actions/${p.id}/approve`, { method: 'POST' });
      toast.success(`Approved — ${p.tool} executed`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to approve');
    } finally {
      busy[p.id] = false;
    }
  }

  async function reject(p: Proposal) {
    busy[p.id] = true;
    try {
      await api(`/agent-actions/${p.id}/reject`, { method: 'POST' });
      toast.success(`Rejected — ${p.tool} discarded`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to reject');
    } finally {
      busy[p.id] = false;
    }
  }

  // READ/LOW tiers are low-risk (info); MUTATING/SENSITIVE escalate to warn/danger.
  function tierTone(tier: string): Tone {
    switch (tier?.toUpperCase()) {
      case 'READ':
      case 'LOW':
        return 'info';
      case 'MUTATING':
        return 'warn';
      case 'SENSITIVE':
        return 'danger';
      default:
        return 'neutral';
    }
  }

  function argEntries(args: Record<string, unknown>): [string, string][] {
    if (!args || typeof args !== 'object') return [];
    return Object.entries(args).map(([k, v]) => [
      k,
      typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v),
    ]);
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Agent actions" />

<p class="mb-4 text-sm text-ink-muted">
  Mutating and sensitive actions proposed by AI agents wait here for review. Approving executes the
  queued tool server-side; rejecting discards it. Read-only tool calls run live and never appear here.
</p>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if loading}
  <Card padded={false}><Skeleton rows={4} /></Card>
{:else if pending.length === 0}
  <EmptyState message="No pending actions. Agents have nothing waiting for approval." />
{:else}
  <Table>
    {#snippet head()}
      <th>Tool</th>
      <th>Arguments</th>
      <th>Risk</th>
      <th>Proposed</th>
      <th>Triggered by</th>
      <th></th>
    {/snippet}
    {#snippet body()}
      {#each pending as p (p.id)}
        <tr>
          <td class="font-semibold"><code class="text-xs">{p.tool}</code></td>
          <td>
            {#if argEntries(p.args).length === 0}
              <span class="text-xs text-ink-faint">—</span>
            {:else}
              <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
                {#each argEntries(p.args) as [key, value] (key)}
                  <dt class="font-medium text-ink-muted">{key}</dt>
                  <dd class="break-all text-ink">{value}</dd>
                {/each}
              </dl>
            {/if}
          </td>
          <td><Badge tone={tierTone(p.riskTier)}>{p.riskTier}</Badge></td>
          <td class="text-ink-muted">{formatDateTime(p.proposedAt)}</td>
          <td class="text-xs text-ink-muted">{p.triggeredByRef ?? '—'}</td>
          <td class="text-right whitespace-nowrap">
            {#if canApprove}
              <Button variant="secondary" disabled={busy[p.id]} onclick={() => void reject(p)}>
                Reject
              </Button>
              <Button variant="primary" disabled={busy[p.id]} onclick={() => void approve(p)}>
                Approve
              </Button>
            {:else}
              <span class="text-xs text-ink-faint">View only</span>
            {/if}
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}
