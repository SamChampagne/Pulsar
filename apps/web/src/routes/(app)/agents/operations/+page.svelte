<script lang="ts">
  import { PERMISSIONS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    PageHeader,
    Card,
    Table,
    Badge,
    Button,
    EmptyState,
    Skeleton,
    ErrorNotice,
    Select,
    type Tone,
  } from '$lib/components/ui';

  // ── Shapes (mirror GET /agents/control-tower) ───────────────────────────────
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
  const canManage = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.AGENTS_MANAGE) ?? false,
  );

  let data = $state<ControlTower | null>(null);
  let loading = $state(true);
  let error = $state('');
  let days = $state('30');
  // id of the agent whose row action is in flight (disables that row's buttons)
  let busyId = $state<string | null>(null);
  let busyAll = $state(false);
  let actionError = $state('');

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
  function statusLabel(status: string): string {
    switch (status) {
      case 'ACTIVE':
        return 'Actif';
      case 'PAUSED':
        return 'En pause';
      case 'REVOKED':
        return 'Révoqué';
      default:
        return status;
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
  function autonomyLabel(level: string): string {
    switch (level) {
      case 'AUTONOMOUS':
        return 'Autonome';
      case 'ACT_LOW':
        return 'Agit (faible risque)';
      case 'PROPOSE':
        return 'Propose';
      default:
        return level;
    }
  }
  function initials(name: string): string {
    return name
      .split(/\s+/)
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }
  function relativeTime(iso: string | null): string {
    if (!iso) return '—';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '—';
    const diff = Date.now() - then;
    const min = Math.round(diff / 60_000);
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `il y a ${h} h`;
    const d = Math.round(h / 24);
    return `il y a ${d} j`;
  }

  // Agents whose execution health needs a manager's eye: breaker tripped,
  // paused, pending approvals, or a non-trivial run error rate.
  const attention = $derived(
    (data?.items ?? [])
      .filter(
        (a) =>
          a.breakerTrippedAt ||
          a.status === 'PAUSED' ||
          a.kpis.actions.pending > 0 ||
          a.kpis.runs.failed > 0,
      )
      .slice(0, 6),
  );

  async function load() {
    loading = true;
    error = '';
    try {
      data = await api<ControlTower>('/agents/control-tower', { query: { days } });
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement du centre d’opérations';
    } finally {
      loading = false;
    }
  }

  async function act(id: string, path: string) {
    if (busyId) return;
    busyId = id;
    actionError = '';
    try {
      await api(`/agents/${id}/${path}`, { method: 'POST' });
      await load();
    } catch (e) {
      actionError = e instanceof ApiError ? e.message : 'Action impossible';
    } finally {
      busyId = null;
    }
  }

  async function pauseAll() {
    if (busyAll) return;
    busyAll = true;
    actionError = '';
    try {
      await api('/agents/pause-all', { method: 'POST' });
      await load();
    } catch (e) {
      actionError = e instanceof ApiError ? e.message : 'Mise en pause globale impossible';
    } finally {
      busyAll = false;
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

<svelte:head><title>Centre d’opérations agents — Pulsar</title></svelte:head>

<PageHeader
  title="Centre d’opérations"
  eyebrow="Main-d’œuvre IA"
  subtitle="Le cockpit du manager pour superviser les employés IA 24/7 : santé d’exécution, gouvernance et interventions immédiates (pause, reprise, réveil)."
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
    {#if canManage}
      <Button
        variant="danger"
        loading={busyAll}
        disabled={!data || data.rollup.active === 0}
        onclick={pauseAll}
      >
        Tout mettre en pause
      </Button>
    {/if}
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
  {#if actionError}
    <div
      class="mb-4 rounded-card border border-danger-soft bg-danger-soft px-4 py-2.5 text-sm text-danger"
    >
      {actionError}
    </div>
  {/if}

  {#if loading}
    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      {#each Array(6) as _, i (i)}<Card><Skeleton rows={2} /></Card>{/each}
    </div>
    <Card padded={false}><Skeleton rows={6} /></Card>
  {:else if data}
    <!-- KPI cards -->
    <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <Card>
        <div class="text-xs text-ink-faint">Employés IA</div>
        <div class="mt-1 text-2xl font-bold text-ink">{data.rollup.agents}</div>
        <div class="mt-1 text-[11px] text-ink-faint">enregistrés sur le tenant</div>
      </Card>
      <Card>
        <div class="text-xs text-ink-faint">Actifs</div>
        <div class="mt-1 text-2xl font-bold text-ok">{data.rollup.active}</div>
        <div class="mt-1 text-[11px] text-ink-faint">en service 24/7</div>
      </Card>
      <Card>
        <div class="text-xs text-ink-faint">En pause</div>
        <div class={`mt-1 text-2xl font-bold ${data.rollup.paused > 0 ? 'text-warn' : 'text-ink'}`}>
          {data.rollup.paused}
        </div>
        <div class="mt-1 text-[11px] text-ink-faint">kill switch à chaud</div>
      </Card>
      <Card>
        <div class="text-xs text-ink-faint">Révoqués</div>
        <div class="mt-1 text-2xl font-bold text-ink">{data.rollup.revoked}</div>
        <div class="mt-1 text-[11px] text-ink-faint">désactivés (permanent)</div>
      </Card>
      <Card>
        <div class="text-xs text-ink-faint">Circuit breaker</div>
        <div
          class={`mt-1 text-2xl font-bold ${data.rollup.totalBreakerTrips > 0 ? 'text-danger' : 'text-ink'}`}
        >
          {data.rollup.totalBreakerTrips}
        </div>
        <div class="mt-1 text-[11px] text-ink-faint">déclenchements ({days} j)</div>
      </Card>
      <Card>
        <div class="text-xs text-ink-faint">À approuver</div>
        <div
          class={`mt-1 text-2xl font-bold ${data.rollup.pendingApprovals > 0 ? 'text-warn' : 'text-ink'}`}
        >
          {data.rollup.pendingApprovals}
        </div>
        <div class="mt-1 text-[11px] text-ink-faint">
          <a href="/agent-actions" class="text-accent hover:underline">Voir l’inbox →</a>
        </div>
      </Card>
    </div>

    {#if data.items.length === 0}
      <Card>
        <EmptyState
          title="Aucun employé IA"
          message="Aucun agent n’est encore enregistré sur ce tenant. Engagez votre premier employé IA dans l’espace Agents."
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
      <!-- Attention feed: who needs me now -->
      {#if attention.length > 0}
        <Card>
          <div class="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-ink">À surveiller maintenant</h2>
              <p class="mt-0.5 text-xs text-ink-muted">
                Breaker, pause, approbations en attente ou runs en échec sur la fenêtre.
              </p>
            </div>
            <Badge tone="warn">{attention.length}</Badge>
          </div>
          <ul class="divide-y divide-edge-soft">
            {#each attention as a (a.id)}
              <li class="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span
                  class="grid size-8 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-bold text-ink"
                >
                  {a.avatar || initials(a.name)}
                </span>
                <a
                  href={`/agents/${a.id}`}
                  class="min-w-0 flex-1 truncate font-medium text-ink hover:text-accent"
                >
                  {a.name}
                </a>
                <div class="flex flex-wrap items-center justify-end gap-1.5">
                  {#if a.breakerTrippedAt}<Badge tone="danger">Breaker</Badge>{/if}
                  {#if a.status === 'PAUSED'}<Badge tone="warn">En pause</Badge>{/if}
                  {#if a.kpis.actions.pending > 0}<Badge tone="warn"
                      >{a.kpis.actions.pending} à approuver</Badge
                    >{/if}
                  {#if a.kpis.runs.failed > 0}<Badge tone="danger"
                      >{a.kpis.runs.failed} runs en échec</Badge
                    >{/if}
                </div>
              </li>
            {/each}
          </ul>
        </Card>

        <div class="h-4"></div>
      {/if}

      <!-- Roster with health + row actions -->
      <Table>
        {#snippet head()}
          <th>Employé</th>
          <th>Statut</th>
          <th>Autonomie</th>
          <th>Breaker</th>
          <th class="text-right">Santé d’exéc.</th>
          <th class="text-right">À approuver</th>
          {#if canManage}<th class="text-right">Pilotage</th>{/if}
          <th></th>
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
                    <a
                      href={`/agents/${a.id}`}
                      class="block truncate font-semibold text-ink hover:text-accent"
                    >
                      {a.name}
                    </a>
                    {#if a.role}<div class="truncate text-xs text-ink-faint">{a.role}</div>{/if}
                  </div>
                </div>
              </td>
              <td><Badge tone={statusTone(a.status)}>{statusLabel(a.status)}</Badge></td>
              <td><Badge tone={autonomyTone(a.autonomyLevel)}>{autonomyLabel(a.autonomyLevel)}</Badge></td>
              <td>
                {#if a.breakerTrippedAt}
                  <div class="flex flex-col items-start gap-1">
                    <Badge tone="danger">Déclenché</Badge>
                    <span class="text-[11px] text-ink-faint">{relativeTime(a.breakerTrippedAt)}</span>
                  </div>
                {:else}
                  <span class="text-xs text-ink-faint">—</span>
                {/if}
              </td>
              <td class="text-right">
                <span class="text-xs text-ink-muted">
                  {a.kpis.runs.succeeded}/{a.kpis.runs.failed}/{a.kpis.runs.skipped}
                </span>
                <div class="text-[11px] text-ink-faint">ok / err / skip</div>
              </td>
              <td class="text-right">
                {#if a.kpis.actions.pending > 0}
                  <span class="font-semibold text-warn">{a.kpis.actions.pending}</span>
                {:else}
                  <span class="text-ink-muted">0</span>
                {/if}
              </td>
              {#if canManage}
                <td class="text-right">
                  <div class="flex items-center justify-end gap-1.5">
                    {#if a.breakerTrippedAt}
                      <Button
                        variant="secondary"
                        loading={busyId === a.id}
                        disabled={busyId !== null}
                        onclick={() => act(a.id, 'reset-breaker')}
                      >
                        Réarmer
                      </Button>
                    {/if}
                    {#if a.status === 'PAUSED'}
                      <Button
                        variant="secondary"
                        loading={busyId === a.id}
                        disabled={busyId !== null}
                        onclick={() => act(a.id, 'resume')}
                      >
                        Reprendre
                      </Button>
                    {:else if a.status === 'ACTIVE'}
                      <Button
                        variant="secondary"
                        loading={busyId === a.id}
                        disabled={busyId !== null}
                        onclick={() => act(a.id, 'pause')}
                      >
                        Pause
                      </Button>
                    {/if}
                    {#if a.status === 'ACTIVE'}
                      <Button
                        variant="ghost"
                        loading={busyId === a.id}
                        disabled={busyId !== null}
                        onclick={() => act(a.id, 'run-now')}
                      >
                        Réveiller
                      </Button>
                    {/if}
                  </div>
                </td>
              {/if}
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
