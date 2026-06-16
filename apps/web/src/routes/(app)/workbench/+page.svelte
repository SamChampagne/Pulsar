<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { PERMISSIONS } from '@pulsar/shared';
  import { toast } from '$lib/stores/toast';
  import { formatDateTime } from '$lib/format';
  import {
    PageHeader,
    Button,
    FilterBar,
    Select,
    Table,
    Badge,
    EmptyState,
    Panel,
    Card,
    Skeleton,
    Textarea,
    ErrorNotice,
    type Tone,
  } from '$lib/components/ui';

  // ──────────────────────────────────────────────────────────
  // Types
  // ──────────────────────────────────────────────────────────

  interface ProposedActionRef {
    id: string;
    tool: string;
    riskTier: string;
    status: string;
    triggeredByRef: string | null;
    proposedAt: string;
    decidedAt: string | null;
  }

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
    proposedActions?: ProposedActionRef[];
  }

  // ──────────────────────────────────────────────────────────
  // Permissions
  // ──────────────────────────────────────────────────────────

  const canManage = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.OPERATING_TASKS_MANAGE) ?? false,
  );

  // ──────────────────────────────────────────────────────────
  // State
  // ──────────────────────────────────────────────────────────

  let tasks = $state<OperationalTask[]>([]);
  let total = $state(0);
  let error = $state('');
  let loading = $state(true);

  let statusFilter = $state('OPEN');
  let categoryFilter = $state('');
  let assigneeTypeFilter = $state('');

  let selected = $state<OperationalTask | null>(null);
  let detailLoading = $state(false);
  let note = $state('');
  let actionBusy = $state(false);

  const criticalCount = $derived(tasks.filter((t) => t.severity === 'CRITICAL').length);
  const approvalCount = $derived(tasks.filter((t) => t.category === 'APPROVAL').length);
  const agentAssignedCount = $derived(tasks.filter((t) => t.assigneeType === 'AGENT').length);

  // ──────────────────────────────────────────────────────────
  // Data loading
  // ──────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    try {
      const result = await api<Paginated<OperationalTask>>('/operational-tasks', {
        query: {
          pageSize: 50,
          status: statusFilter || undefined,
          category: categoryFilter || undefined,
          assigneeType: assigneeTypeFilter || undefined,
        },
      });
      tasks = result.items;
      total = result.total;
      error = '';
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load workbench tasks';
    } finally {
      loading = false;
    }
  }

  async function openDetail(task: OperationalTask) {
    selected = task;
    note = '';
    detailLoading = true;
    try {
      const full = await api<OperationalTask>(`/operational-tasks/${task.id}`);
      selected = full;
    } catch {
      // keep the row data; proposed actions just won't show
    } finally {
      detailLoading = false;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Actions
  // ──────────────────────────────────────────────────────────

  async function resolve() {
    if (!selected) return;
    actionBusy = true;
    try {
      await api(`/operational-tasks/${selected.id}/resolve`, {
        method: 'POST',
        body: note ? { note } : {},
      });
      toast.success('Task resolved');
      selected = null;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to resolve task');
    } finally {
      actionBusy = false;
    }
  }

  async function dismiss() {
    if (!selected) return;
    actionBusy = true;
    try {
      await api(`/operational-tasks/${selected.id}/dismiss`, {
        method: 'POST',
        body: note ? { note } : {},
      });
      toast.success('Task dismissed');
      selected = null;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to dismiss task');
    } finally {
      actionBusy = false;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  function severityTone(severity: string): Tone {
    switch (severity?.toUpperCase()) {
      case 'CRITICAL': return 'danger';
      case 'WARNING':  return 'warn';
      case 'INFO':     return 'info';
      default:         return 'neutral';
    }
  }

  function statusTone(status: string): Tone {
    switch (status?.toUpperCase()) {
      case 'OPEN':        return 'warn';
      case 'IN_PROGRESS': return 'info';
      case 'RESOLVED':    return 'ok';
      case 'DISMISSED':   return 'neutral';
      default:            return 'neutral';
    }
  }

  function riskTierTone(tier: string): Tone {
    switch (tier?.toUpperCase()) {
      case 'READ':
      case 'LOW':       return 'info';
      case 'MUTATING':  return 'warn';
      case 'SENSITIVE': return 'danger';
      default:          return 'neutral';
    }
  }

  function detailEntries(details: Record<string, unknown> | null): [string, string][] {
    if (!details || typeof details !== 'object') return [];
    return Object.entries(details).map(([k, v]) => [
      k,
      typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v),
    ]);
  }

  function assigneeLabel(task: OperationalTask): string {
    if (task.assigneeType === 'UNASSIGNED') return 'Unassigned';
    if (task.assigneeType === 'HUMAN') return 'Human';
    if (task.assigneeType === 'AGENT') return 'Agent';
    return task.assigneeType;
  }

  // ──────────────────────────────────────────────────────────
  // Reactive load
  // ──────────────────────────────────────────────────────────

  $effect(() => {
    statusFilter;
    categoryFilter;
    assigneeTypeFilter;
    void load();
  });
</script>

<PageHeader
  title="Operating workbench"
  subtitle="Triage exceptions, approvals, reviews, and notifications raised by Pulsar policies or agents."
  count={total}
/>

<div class="mb-4 grid gap-3 sm:grid-cols-3">
  <Card><div class="text-xl font-bold text-ink">{criticalCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Critical</div><p class="mt-1 text-xs text-ink-faint">Handle these before normal reviews.</p></Card>
  <Card><div class="text-xl font-bold text-ink">{approvalCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Approvals</div><p class="mt-1 text-xs text-ink-faint">Tasks tied to explicit decisions or agent actions.</p></Card>
  <Card><div class="text-xl font-bold text-ink">{agentAssignedCount}</div><div class="text-xs uppercase tracking-wide text-ink-muted">Agent-owned</div><p class="mt-1 text-xs text-ink-faint">Work delegated to employee agents.</p></Card>
</div>

<ErrorNotice message={error} onretry={load} />

<FilterBar>
  <div class="w-40">
    <Select bind:value={statusFilter}>
      <option value="">All statuses</option>
      {#each ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED'] as s (s)}
        <option value={s}>{s.replaceAll('_', ' ')}</option>
      {/each}
    </Select>
  </div>
  <div class="w-40">
    <Select bind:value={categoryFilter}>
      <option value="">All categories</option>
      {#each ['EXCEPTION', 'APPROVAL', 'REVIEW', 'NOTIFICATION'] as c (c)}
        <option value={c}>{c}</option>
      {/each}
    </Select>
  </div>
  <div class="w-44">
    <Select bind:value={assigneeTypeFilter}>
      <option value="">All assignees</option>
      {#each ['UNASSIGNED', 'HUMAN', 'AGENT'] as a (a)}
        <option value={a}>{a}</option>
      {/each}
    </Select>
  </div>
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if tasks.length === 0}
  <EmptyState title="No operating tasks match" message="Change the filters or wait for policies and agents to raise work that needs triage.">
    {#snippet children()}<Button variant="secondary" href="/agent-actions">Review agent actions</Button><Button href="/dispatch">Open Dispatch</Button>{/snippet}
  </EmptyState>
{:else}
  <Table>
    {#snippet head()}
      <th>Severity</th>
      <th>Title</th>
      <th>Category</th>
      <th>Subject</th>
      <th>Assignee</th>
      <th>Status</th>
      <th>Created</th>
    {/snippet}
    {#snippet body()}
      {#each tasks as task (task.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <tr class="cursor-pointer" onclick={() => void openDetail(task)}>
          <td><Badge tone={severityTone(task.severity)}>{task.severity}</Badge></td>
          <td class="font-semibold text-ink">{task.title}</td>
          <td class="text-xs text-ink-muted">{task.category}</td>
          <td class="text-xs text-ink-muted">
            {#if task.subjectType && task.subjectId}
              {task.subjectType} {task.subjectId}
            {:else}
              —
            {/if}
          </td>
          <td class="text-xs text-ink-muted">{assigneeLabel(task)}</td>
          <td><Badge tone={statusTone(task.status)}>{task.status.replaceAll('_', ' ')}</Badge></td>
          <td class="text-ink-muted">{formatDateTime(task.createdAt)}</td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

{#if selected}
  {@const sel = selected}
  <Panel
    open={true}
    title={sel.title}
    onclose={() => { selected = null; }}
  >
    {#snippet footer()}
      {#if canManage && (sel.status === 'OPEN' || sel.status === 'IN_PROGRESS')}
        <Button variant="secondary" disabled={actionBusy} onclick={() => void dismiss()}>Dismiss</Button>
        <Button variant="primary" disabled={actionBusy} onclick={() => void resolve()}>Resolve</Button>
      {/if}
    {/snippet}

    <!-- Severity + Status -->
    <div class="mb-3 flex items-center gap-2">
      <Badge tone={severityTone(sel.severity)}>{sel.severity}</Badge>
      <Badge tone={statusTone(sel.status)}>{sel.status.replaceAll('_', ' ')}</Badge>
    </div>

    <!-- Core fields -->
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Category</div>
      <div class="text-sm text-ink">{sel.category}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Type</div>
      <div class="text-sm text-ink">{sel.type}</div>
    </div>
    {#if sel.subjectType || sel.subjectId}
      <div class="mb-3">
        <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Subject</div>
        <div class="text-sm text-ink">{sel.subjectType ?? ''} {sel.subjectId ?? ''}</div>
      </div>
    {/if}
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Assignee</div>
      <div class="text-sm text-ink">{assigneeLabel(sel)}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Created</div>
      <div class="text-sm text-ink">{formatDateTime(sel.createdAt)}</div>
    </div>
    {#if sel.resolvedAt}
      <div class="mb-3">
        <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Resolved</div>
        <div class="text-sm text-ink">{formatDateTime(sel.resolvedAt)}</div>
      </div>
    {/if}

    <!-- Details JSON -->
    {#if detailEntries(sel.details).length > 0}
      <div class="mb-3">
        <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Details</div>
        <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
          {#each detailEntries(sel.details) as [key, value] (key)}
            <dt class="font-medium text-ink-muted">{key}</dt>
            <dd class="break-all text-ink">{value}</dd>
          {/each}
        </dl>
      </div>
    {/if}

    <!-- Proposed actions -->
    {#if detailLoading}
      <div class="mb-3 text-xs text-ink-faint">Loading actions…</div>
    {:else if sel.proposedActions && sel.proposedActions.length > 0}
      <div class="mb-3">
        <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
          Proposed actions ({sel.proposedActions.length})
        </div>
        <div class="mt-1 space-y-1.5">
          {#each sel.proposedActions as pa (pa.id)}
            <div class="rounded border border-edge bg-surface-muted px-2 py-1.5 text-xs">
              <div class="flex items-center gap-2">
                <code class="text-ink">{pa.tool}</code>
                <Badge tone={riskTierTone(pa.riskTier)}>{pa.riskTier}</Badge>
                <Badge tone={statusTone(pa.status)}>{pa.status}</Badge>
              </div>
              <div class="mt-0.5 text-ink-faint">{formatDateTime(pa.proposedAt)}</div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Note for resolve/dismiss -->
    {#if canManage && (sel.status === 'OPEN' || sel.status === 'IN_PROGRESS')}
      <div class="mb-3">
        <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase mb-1">
          Note (optional)
        </div>
        <Textarea bind:value={note} placeholder="Add a resolution note…" rows={2} />
      </div>
    {/if}
  </Panel>
{/if}
