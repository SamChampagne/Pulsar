<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorNotice,
    Input,
    PageHeader,
    Select,
    Skeleton,
    Tabs,
  } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';
  import { reactionByKey } from '@pulsar/shared';

  // ── Types ──────────────────────────────────────────────────────────────────

  interface FlowEvent {
    id: string;
    type: string;
    module: string;
    subjectType: string;
    subjectId: string;
    at: string;
  }

  interface FlowTask {
    id: string;
    category: string;
    status: string;
    severity: string;
    subjectType: string;
    subjectId: string;
    sourceEventId: string | null;
    assigneeAgentId: string | null;
    at: string;
  }

  interface FlowAction {
    id: string;
    tool: string;
    status: string;
    agentId: string | null;
    triggeredByRef: string | null;
    autoApproved: boolean;
    at: string;
  }

  interface FlowReaction {
    id: string;
    action: string;
    status: string;
    module: string;
    eventId: string;
    at: string;
  }

  interface FlowChain {
    event: FlowEvent | null;
    tasks: FlowTask[];
    actions: FlowAction[];
    reactions: FlowReaction[];
    modules: string[];
    crossModule: boolean;
    startedAt: string;
    lastAt: string;
  }

  interface ReactionKpis {
    executed: number;
    failed: number;
    byAction: { action: string; executed: number; failed: number }[];
  }

  interface FlowMapNode {
    module: string;
    eventCount: number;
  }

  interface FlowMapEdge {
    from: string;
    to: string;
    count: number;
    kind: 'event' | 'reaction';
  }

  interface FlowMapData {
    nodes: FlowMapNode[];
    edges: FlowMapEdge[];
  }

  type TraceStageStatus = 'PENDING' | 'ACTIVE' | 'DONE' | 'BLOCKED';

  interface TraceStage {
    stage: string;
    module: string;
    status: TraceStageStatus;
    at: string | null;
    refs: string[];
  }

  interface TraceData {
    rootType: string;
    rootId: string;
    stages: TraceStage[];
  }

  // ── State ──────────────────────────────────────────────────────────────────

  let tab = $state<'timeline' | 'trace' | 'map'>('timeline');

  // Timeline
  let timelineData = $state<FlowChain[]>([]);
  let reactionKpis = $state<ReactionKpis | null>(null);
  let timelineLoading = $state(false);
  let timelineError = $state('');
  let days = $state('7');
  let crossOnly = $state(false);
  let expandedChains = $state<Set<number>>(new Set());

  // Trace
  let traceEntityType = $state('TRANSPORT_ORDER');
  let traceEntityId = $state('');
  let traceData = $state<TraceData | null>(null);
  let traceLoading = $state(false);
  let traceError = $state('');

  // Map
  let mapData = $state<FlowMapData | null>(null);
  let mapLoading = $state(false);
  let mapError = $state('');

  // ── Helpers ────────────────────────────────────────────────────────────────

  function fmtAt(at: string | null): string {
    if (!at) return '—';
    return new Date(at).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' });
  }

  function stageTone(status: TraceStageStatus): Tone {
    switch (status) {
      case 'DONE':    return 'ok';
      case 'ACTIVE':  return 'info';
      case 'BLOCKED': return 'danger';
      default:        return 'neutral';
    }
  }

  function taskTone(status: string): Tone {
    switch (status) {
      case 'DONE':        return 'ok';
      case 'IN_PROGRESS': return 'info';
      case 'BLOCKED':     return 'danger';
      default:            return 'neutral';
    }
  }

  function actionTone(status: string): Tone {
    switch (status) {
      case 'EXECUTED':  return 'ok';
      case 'APPROVED':  return 'ok';
      case 'DENIED':    return 'danger';
      case 'PENDING':   return 'warn';
      default:          return 'neutral';
    }
  }

  function severityTone(severity: string): Tone {
    switch (severity) {
      case 'CRITICAL': return 'danger';
      case 'WARNING':  return 'warn';
      default:         return 'neutral';
    }
  }

  function toggleChain(i: number): void {
    const next = new Set(expandedChains);
    if (next.has(i)) {
      next.delete(i);
    } else {
      next.add(i);
    }
    expandedChains = next;
  }

  // ── Data loaders ───────────────────────────────────────────────────────────

  async function loadTimeline(): Promise<void> {
    timelineLoading = true;
    timelineError = '';
    try {
      const res = await api<{ chains: FlowChain[]; reactionKpis: ReactionKpis }>('/analytics/flow/timeline', {
        query: { days, crossOnly: crossOnly ? 'true' : 'false' },
      });
      timelineData = res.chains;
      reactionKpis = res.reactionKpis ?? null;
    } catch (e) {
      timelineError = e instanceof ApiError ? e.message : 'Échec du chargement de la timeline';
    } finally {
      timelineLoading = false;
    }
  }

  function reactionLabel(action: string): string {
    return reactionByKey(action)?.label ?? action;
  }

  async function loadMap(): Promise<void> {
    mapLoading = true;
    mapError = '';
    try {
      mapData = await api<FlowMapData>('/analytics/flow/map', { query: { days } });
    } catch (e) {
      mapError = e instanceof ApiError ? e.message : 'Échec du chargement de la carte de flux';
    } finally {
      mapLoading = false;
    }
  }

  async function runTrace(): Promise<void> {
    if (!traceEntityId.trim()) return;
    traceLoading = true;
    traceError = '';
    traceData = null;
    try {
      traceData = await api<TraceData>('/analytics/flow/trace', {
        query: { entityType: traceEntityType, entityId: traceEntityId.trim() },
      });
    } catch (e) {
      traceError = e instanceof ApiError ? e.message : 'Échec du tracé de l\'entité';
    } finally {
      traceLoading = false;
    }
  }

  // ── Effects ────────────────────────────────────────────────────────────────

  // Timeline: load on mount + filter changes + polling ~30s when visible
  $effect(() => {
    void days;
    void crossOnly;
    if (tab === 'timeline') void loadTimeline();
  });

  $effect(() => {
    if (tab !== 'timeline') return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadTimeline();
    }, 30_000);
    return () => clearInterval(timer);
  });

  // Map: load when switching to map tab (days-reactive too)
  $effect(() => {
    void days;
    if (tab === 'map') void loadMap();
  });
</script>

<svelte:head><title>Flux — Analytics — Pulsar</title></svelte:head>

<PageHeader
  title="Flux"
  subtitle="Chaînes événement → tâches → actions cross-module — timeline, tracé entité et carte de flux."
>
  {#snippet actions()}
    <Button variant="secondary" href="/analytics/control-tower">Control Tower</Button>
    {#if tab === 'timeline' || tab === 'map'}
      <div class="w-40">
        <Select bind:value={days}>
          <option value="1">Dernières 24 h</option>
          <option value="7">7 derniers jours</option>
          <option value="30">30 derniers jours</option>
        </Select>
      </div>
    {/if}
  {/snippet}
</PageHeader>

<Tabs
  tabs={[
    { id: 'timeline', label: 'Timeline' },
    { id: 'trace',    label: 'Tracé entité' },
    { id: 'map',      label: 'Carte de flux' },
  ]}
  bind:active={tab}
>
  {#snippet children()}
    <!-- ── TIMELINE ──────────────────────────────────────────────────────── -->
    {#if tab === 'timeline'}
      <!-- Filters -->
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <label class="flex cursor-pointer items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            class="accent-accent"
            bind:checked={crossOnly}
          />
          Cross-module uniquement
        </label>
      </div>

      <ErrorNotice message={timelineError} onretry={loadTimeline} />

      {#if reactionKpis}
        <div class="mb-3 flex items-center gap-3 rounded-md border border-edge-soft px-3 py-2 text-sm">
          <span class="font-bold text-ink">⚡ Réactions</span>
          <span class="text-ok">{reactionKpis.executed} exécutées</span>
          <span class="text-danger">{reactionKpis.failed} échouées</span>
          {#if reactionKpis.byAction.length}
            <span class="text-ink-muted">· top : {reactionKpis.byAction.slice(0, 3).map((a) => `${reactionLabel(a.action)} (${a.executed + a.failed})`).join(', ')}</span>
          {/if}
        </div>
      {/if}

      {#if timelineLoading && timelineData.length === 0}
        <div class="flex flex-col gap-3">
          {#each Array(4) as _, i (i)}<Card><Skeleton rows={3} /></Card>{/each}
        </div>
      {:else if timelineData.length === 0 && !timelineLoading}
        <Card>
          <EmptyState
            title="Aucune chaîne de flux"
            message="Aucune chaîne événement→tâche→action sur cette fenêtre. Ajustez les filtres ou revenez plus tard."
          />
        </Card>
      {:else}
        <div class="flex flex-col gap-3">
          {#each timelineData as chain, i (chain.startedAt + i)}
            {@const expanded = expandedChains.has(i)}
            <Card padded={false}>
              <!-- Chain header -->
              <button
                class="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-muted"
                onclick={() => toggleChain(i)}
              >
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    {#if chain.crossModule}
                      <Badge tone="info">Cross-module</Badge>
                    {/if}
                    {#each chain.modules as mod (mod)}
                      <span class="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-muted uppercase">{mod}</span>
                    {/each}
                  </div>
                  <div class="mt-1 flex items-center gap-3 text-xs text-ink-faint">
                    <span>{fmtAt(chain.startedAt)}</span>
                    {#if chain.lastAt !== chain.startedAt}
                      <span>→ {fmtAt(chain.lastAt)}</span>
                    {/if}
                    <span>{chain.tasks.length} tâche{chain.tasks.length !== 1 ? 's' : ''}</span>
                    <span>{chain.actions.length} action{chain.actions.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                <span class="shrink-0 text-xs text-ink-faint">{expanded ? '▲' : '▼'}</span>
              </button>

              {#if expanded}
                <div class="border-t border-edge-soft px-4 py-3">
                  <!-- Event -->
                  {#if chain.event}
                    {@const ev = chain.event}
                    <div class="mb-3">
                      <div class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Événement déclencheur</div>
                      <div class="flex flex-wrap items-center gap-2 text-sm">
                        <span class="rounded bg-info-soft px-1.5 py-0.5 text-xs font-medium text-info">{ev.type}</span>
                        <span class="text-ink-muted">{ev.module}</span>
                        <span class="font-mono text-xs text-ink-faint">{ev.subjectType} {ev.subjectId.slice(0, 8)}</span>
                        <span class="text-xs text-ink-faint">{fmtAt(ev.at)}</span>
                      </div>
                    </div>
                  {/if}

                  <!-- Tasks -->
                  {#if chain.tasks.length > 0}
                    <div class="mb-3">
                      <div class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Tâches ({chain.tasks.length})</div>
                      <div class="flex flex-col gap-1.5">
                        {#each chain.tasks as task (task.id)}
                          <div class="flex flex-wrap items-center gap-2 rounded-inner bg-surface-muted px-3 py-2 text-sm">
                            <Badge tone={taskTone(task.status)}>{task.status}</Badge>
                            {#if task.severity !== 'INFO'}
                              <Badge tone={severityTone(task.severity)}>{task.severity}</Badge>
                            {/if}
                            <span class="text-ink">{task.category}</span>
                            <span class="font-mono text-xs text-ink-faint">{task.subjectType} {task.subjectId.slice(0, 8)}</span>
                            {#if task.assigneeAgentId}
                              <span class="text-xs text-ink-faint">agent: {task.assigneeAgentId.slice(0, 8)}</span>
                            {/if}
                            <span class="ml-auto text-xs text-ink-faint">{fmtAt(task.at)}</span>
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}

                  <!-- Actions -->
                  {#if chain.actions.length > 0}
                    <div class={chain.reactions?.length ? 'mb-3' : ''}>
                      <div class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Actions ({chain.actions.length})</div>
                      <div class="flex flex-col gap-1.5">
                        {#each chain.actions as action (action.id)}
                          <div class="flex flex-wrap items-center gap-2 rounded-inner bg-surface-muted px-3 py-2 text-sm">
                            <Badge tone={actionTone(action.status)}>{action.status}</Badge>
                            <span class="font-mono text-ink">{action.tool}</span>
                            {#if action.autoApproved}
                              <span class="rounded bg-ok-soft px-1.5 py-0.5 text-[11px] font-medium text-ok">auto</span>
                            {/if}
                            {#if action.triggeredByRef}
                              <span class="text-xs text-ink-faint">{action.triggeredByRef}</span>
                            {/if}
                            <span class="ml-auto text-xs text-ink-faint">{fmtAt(action.at)}</span>
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}

                  <!-- Reactions -->
                  {#if chain.reactions?.length}
                    <div>
                      <div class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Réactions ({chain.reactions.length})</div>
                      <div class="mt-1 flex flex-wrap gap-1">
                        {#each chain.reactions as r (r.id)}
                          <span class="rounded px-1.5 py-0.5 text-xs {r.status === 'EXECUTED' ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'}">
                            ⚡ {reactionLabel(r.action)} → {r.module}{r.status === 'FAILED' ? ' (échec)' : ''}
                          </span>
                        {/each}
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
            </Card>
          {/each}
        </div>
      {/if}

    <!-- ── TRACE ─────────────────────────────────────────────────────────── -->
    {:else if tab === 'trace'}
      <div class="mb-4 flex flex-wrap items-end gap-3">
        <div class="w-56">
          <label class="mb-1 block text-xs font-medium text-ink-muted">Type d'entité</label>
          <Select bind:value={traceEntityType}>
            <option value="TRANSPORT_ORDER">Ordre de transport</option>
            <option value="SHIPMENT">Shipment</option>
            <option value="LOAD">Load</option>
          </Select>
        </div>
        <div class="flex-1" style="min-width:180px;max-width:320px">
          <label class="mb-1 block text-xs font-medium text-ink-muted">ID</label>
          <Input
            bind:value={traceEntityId}
            placeholder="ID de l'entité…"
          />
        </div>
        <Button onclick={() => void runTrace()} disabled={!traceEntityId.trim() || traceLoading}>
          {traceLoading ? 'Chargement…' : 'Tracer'}
        </Button>
      </div>

      <ErrorNotice message={traceError} onretry={runTrace} />

      {#if traceLoading}
        <Card><Skeleton rows={5} /></Card>
      {:else if traceData}
        <div class="mb-3 flex items-center gap-2">
          <span class="text-sm font-semibold text-ink">{traceData.rootType}</span>
          <span class="font-mono text-xs text-ink-muted">{traceData.rootId}</span>
        </div>

        <!-- Stages vertical pipeline -->
        <div class="flex flex-col gap-0">
          {#each traceData.stages as stage, idx (stage.stage + idx)}
            {@const isLast = idx === traceData.stages.length - 1}
            <div class="flex gap-3">
              <!-- Timeline spine -->
              <div class="flex flex-col items-center">
                <div class={`mt-1 size-3 shrink-0 rounded-full border-2 ${stage.status === 'DONE' ? 'border-ok bg-ok' : stage.status === 'ACTIVE' ? 'border-info bg-info' : stage.status === 'BLOCKED' ? 'border-danger bg-danger' : 'border-edge bg-surface'}`}></div>
                {#if !isLast}
                  <div class="w-px flex-1 bg-edge-soft"></div>
                {/if}
              </div>
              <!-- Stage content -->
              <div class={`pb-4 min-w-0 flex-1 ${isLast ? '' : ''}`}>
                <div class="flex flex-wrap items-center gap-2">
                  <Badge tone={stageTone(stage.status)}>{stage.status}</Badge>
                  <span class="font-medium text-ink">{stage.stage}</span>
                  <span class="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-muted uppercase">{stage.module}</span>
                  {#if stage.at}
                    <span class="text-xs text-ink-faint">{fmtAt(stage.at)}</span>
                  {/if}
                </div>
                {#if stage.refs.length > 0}
                  <div class="mt-1 flex flex-wrap gap-1">
                    {#each stage.refs as ref (ref)}
                      <span class="font-mono text-[11px] text-ink-faint">{ref}</span>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <Card>
          <EmptyState
            title="Tracé entité"
            message="Sélectionnez un type d'entité et saisissez son ID pour visualiser les étapes de son cycle de vie cross-module."
          />
        </Card>
      {/if}

    <!-- ── MAP ───────────────────────────────────────────────────────────── -->
    {:else if tab === 'map'}
      <ErrorNotice message={mapError} onretry={loadMap} />

      {#if mapLoading && !mapData}
        <div class="grid gap-3 sm:grid-cols-2">
          <Card><Skeleton rows={4} /></Card>
          <Card><Skeleton rows={4} /></Card>
        </div>
      {:else if mapData}
        <div class="grid gap-4 sm:grid-cols-2">
          <!-- Nodes -->
          <Card padded={false}>
            <h2 class="border-b border-edge-soft px-4 py-3 text-sm font-bold text-ink">Modules actifs</h2>
            {#if mapData.nodes.length === 0}
              <div class="px-4 py-4">
                <EmptyState message="Aucun module avec événements sur cette fenêtre." />
              </div>
            {:else}
              <ul class="divide-y divide-edge-soft">
                {#each mapData.nodes as node (node.module)}
                  <li class="flex items-center justify-between px-4 py-2.5">
                    <span class="rounded bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent uppercase">{node.module}</span>
                    <span class="font-mono text-sm font-semibold text-ink">{node.eventCount} <span class="text-xs font-normal text-ink-faint">événements</span></span>
                  </li>
                {/each}
              </ul>
            {/if}
          </Card>

          <!-- Edges -->
          <Card padded={false}>
            <div class="flex items-center justify-between border-b border-edge-soft px-4 py-3">
              <h2 class="text-sm font-bold text-ink">Flux entre modules</h2>
              <span class="text-[11px] text-ink-faint">⚡ = réaction cross-module</span>
            </div>
            {#if mapData.edges.length === 0}
              <div class="px-4 py-4">
                <EmptyState message="Aucun flux cross-module sur cette fenêtre." />
              </div>
            {:else}
              <ul class="divide-y divide-edge-soft">
                {#each mapData.edges as edge (`${edge.from}→${edge.to}→${edge.kind}`)}
                  <li class="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span class="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-muted uppercase">{edge.from}</span>
                    <span class="{edge.kind === 'reaction' ? 'text-accent' : 'text-ink-faint'}">→</span>
                    <span class="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-muted uppercase">{edge.to}</span>
                    {#if edge.kind === 'reaction'}
                      <span class="text-accent text-xs">⚡ réaction</span>
                    {/if}
                    <span class="ml-auto font-mono text-sm font-semibold text-ink">{edge.count}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </Card>
        </div>
      {:else}
        <Card>
          <EmptyState
            title="Carte de flux"
            message="Aucune donnée disponible. Sélectionnez une fenêtre temporelle et réessayez."
          >
            {#snippet children()}<Button onclick={() => void loadMap()}>Charger</Button>{/snippet}
          </EmptyState>
        </Card>
      {/if}
    {/if}
  {/snippet}
</Tabs>
