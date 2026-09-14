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
    ErrorNotice,
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

  const sensitiveCount = $derived(pending.filter((p) => p.riskTier?.toUpperCase() === 'SENSITIVE').length);
  const mutatingCount = $derived(pending.filter((p) => p.riskTier?.toUpperCase() === 'MUTATING').length);
  const toolCount = $derived(new Set(pending.map((p) => p.tool)).size);

  async function load() {
    loading = true;
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

  // "Why pending" — this list is tenant-wide (no agentId in the projection, so the specific
  // agent's autonomy/caps can't be joined in here without another backend change, which is
  // out of scope). Give a tier-based explanation of the governance rule instead, plus the
  // amount when the tool call carries one (both tms/billing amount-capped tools expose it as
  // `args.amount` — see tool-registry `amountFrom`).
  function pendingReason(p: Proposal): string {
    const tier = p.riskTier?.toUpperCase();
    const base =
      tier === 'SENSITIVE'
        ? 'Tier SENSIBLE → approbation humaine toujours requise.'
        : tier === 'MUTATING'
          ? "Tier MUTATION → auto-exécutable selon l'autonomie de l'agent, sinon approbation requise."
          : '';
    const amount = p.args && typeof p.args === 'object' ? (p.args as Record<string, unknown>).amount : undefined;
    if (typeof amount === 'number') {
      return `${base} Montant en jeu : ${amount}.`;
    }
    return base;
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader
  title="Agent actions"
  subtitle="Review mutating and sensitive AI tool calls before they execute against tenant data."
/>

<div class="mb-4 grid gap-3 sm:grid-cols-3">
  <Card><div class="text-xl font-bold text-ink">{pending.length}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Awaiting decision</div><p class="mt-1 text-xs text-ink-faint">Approve executes the queued tool; reject discards it.</p></Card>
  <Card><div class="text-xl font-bold text-ink">{sensitiveCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Sensitive</div><p class="mt-1 text-xs text-ink-faint">Inspect first; {mutatingCount} more mutate data.</p></Card>
  <Card><div class="text-xl font-bold text-ink">{toolCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Tools involved</div><p class="mt-1 text-xs text-ink-faint">Distinct automation surfaces requesting approval.</p></Card>
</div>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <Card padded={false}><Skeleton rows={4} /></Card>
{:else if pending.length === 0}
  <EmptyState title="No agent actions waiting" message="Read-only and low-risk tool calls run directly. Mutating or sensitive proposals will appear here when a human decision is required.">
    {#snippet children()}<Button variant="secondary" href="/agents">Open agents</Button><Button href="/workbench">Open workbench</Button>{/snippet}
  </EmptyState>
{:else}
  <Table>
    {#snippet head()}
      <th>Tool</th>
      <th>Arguments</th>
      <th>Risk</th>
      <th>Why pending</th>
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
          <td class="max-w-56 text-xs text-ink-muted">{pendingReason(p)}</td>
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
