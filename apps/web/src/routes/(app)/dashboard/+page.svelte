<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { MODULE_KEYS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { formatDateTime } from '$lib/format';
  import {
    PageHeader,
    Card,
    Skeleton,
    EmptyState,
    Badge,
    Button,
    ExceptionBanner,
  } from '$lib/components/ui';
  import OpsMap from '$lib/components/OpsMap.svelte';

  // ──────────────────────────────────────────────────────────
  // Module gating — never fetch a disabled module's endpoints.
  // ──────────────────────────────────────────────────────────

  const enabledModules = $derived($auth?.tenant.enabledModules ?? []);
  const hasTransportation = $derived(enabledModules.includes(MODULE_KEYS.TRANSPORTATION));
  const hasBilling = $derived(enabledModules.includes(MODULE_KEYS.BILLING));
  const hasCrm = $derived(enabledModules.includes(MODULE_KEYS.CRM));

  function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : 'Échec du chargement';
  }
  function isForbidden(e: unknown): boolean {
    return e instanceof ApiError && e.statusCode === 403;
  }

  // ──────────────────────────────────────────────────────────
  // Bucket 0 — transport KPI strip (unchanged behaviour, module-gated)
  // ──────────────────────────────────────────────────────────

  interface Metric {
    label: string;
    value: number | string;
    href: string;
  }
  let metrics = $state<Metric[]>([]);
  let statsError = $state('');
  let statsLoading = $state(true);

  async function loadStats() {
    statsLoading = true;
    try {
      const [orders, shipments, loads, carriers] = await Promise.all([
        api<Paginated<unknown>>('/transportation/transport-orders', { query: { pageSize: 1 } }),
        api<Paginated<unknown>>('/transportation/shipments', { query: { pageSize: 1 } }),
        api<Paginated<unknown>>('/transportation/loads', { query: { pageSize: 1 } }),
        api<Paginated<unknown>>('/transportation/carriers', { query: { pageSize: 1 } }),
      ]);
      metrics = [
        { label: 'Ordres de transport', value: orders.total, href: '/transport-orders' },
        { label: 'Shipments', value: shipments.total, href: '/shipments' },
        { label: 'Loads', value: loads.total, href: '/loads' },
        { label: 'Transporteurs', value: carriers.total, href: '/carriers' },
      ];
      statsError = '';
    } catch (e) {
      statsError = messageOf(e);
    } finally {
      statsLoading = false;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Bucket 1 — en retard / bloqué (TRANSPORTATION): live map + late loads
  // ──────────────────────────────────────────────────────────

  interface MapLoad {
    id: string;
    loadNumber: string;
    status: string;
    carrier: string | null;
    isLate: boolean;
    lastPosition: { latitude: number; longitude: number; occurredAt: string } | null;
    stops: {
      sequence: number; type: string; status: string; name: string; city: string;
      latitude: number | null; longitude: number | null;
    }[];
  }

  let mapLoads = $state<MapLoad[]>([]);
  let mapLoaded = $state(false);
  let mapError = $state('');

  const lateLoads = $derived(mapLoads.filter((l) => l.isLate));
  const activeCount = $derived(mapLoads.length);

  async function loadMap() {
    try {
      mapLoads = await api<MapLoad[]>('/transportation/loads/active-map');
      mapError = '';
    } catch (e) {
      mapError = messageOf(e);
    } finally {
      mapLoaded = true;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Bucket 2 — décisions en attente (agents / governance, core)
  // ──────────────────────────────────────────────────────────

  interface ProposedActionSummary {
    id: string;
    tool: string;
    riskTier: string;
    proposedAt: string;
  }

  let decisions = $state<ProposedActionSummary[]>([]);
  let decisionsLoaded = $state(false);
  let decisionsError = $state('');
  let decisionsAvailable = $state(true);

  async function loadDecisions() {
    try {
      decisions = await api<ProposedActionSummary[]>('/agent-actions');
      decisionsError = '';
    } catch (e) {
      if (isForbidden(e)) decisionsAvailable = false;
      else decisionsError = messageOf(e);
    } finally {
      decisionsLoaded = true;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Bucket 3 — tâches ouvertes (workbench / operating, core)
  // ──────────────────────────────────────────────────────────

  interface OperationalTaskSummary {
    id: string;
    title: string;
    category: string;
    createdAt: string;
  }

  let openTasks = $state<OperationalTaskSummary[]>([]);
  let openTasksTotal = $state(0);
  let openTasksLoaded = $state(false);
  let openTasksError = $state('');
  let openTasksAvailable = $state(true);

  async function loadOpenTasks() {
    try {
      const res = await api<Paginated<OperationalTaskSummary>>('/operational-tasks', {
        query: { status: 'OPEN', pageSize: 5 },
      });
      openTasks = res.items;
      openTasksTotal = res.total;
      openTasksError = '';
    } catch (e) {
      if (isForbidden(e)) openTasksAvailable = false;
      else openTasksError = messageOf(e);
    } finally {
      openTasksLoaded = true;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Bucket 4 — exceptions coût (BILLING / freight audit)
  // ──────────────────────────────────────────────────────────

  interface FreightExceptionInvoice {
    id: string;
    carrierInvoiceNumber: string;
    status: string;
    varianceGross: string | null;
    currency: string;
    carrier: { name: string };
  }

  let freightExceptions = $state<FreightExceptionInvoice[]>([]);
  let freightExceptionsCount = $state(0);
  let freightLoaded = $state(false);
  let freightError = $state('');
  let freightAvailable = $state(true);

  async function loadFreightExceptions() {
    try {
      const invoices = await api<FreightExceptionInvoice[]>('/freight-audit/incoming-invoices');
      const flagged = invoices.filter((i) => i.status === 'FLAGGED' || i.status === 'DISPUTED');
      freightExceptions = flagged.slice(0, 5);
      freightExceptionsCount = flagged.length;
      freightError = '';
    } catch (e) {
      if (isForbidden(e)) freightAvailable = false;
      else freightError = messageOf(e);
    } finally {
      freightLoaded = true;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Bucket 5 — CRM (relances en retard + deals stagnants)
  // ──────────────────────────────────────────────────────────

  interface CrmOverview {
    staleDealCount: number;
    dueFollowupCount: number;
    recentActivities: {
      id: string;
      type: string;
      body: string;
      createdAt: string;
      dealId: string | null;
    }[];
  }

  let crmOverview = $state<CrmOverview | null>(null);
  let crmLoaded = $state(false);
  let crmError = $state('');
  let crmAvailable = $state(true);

  async function loadCrm() {
    try {
      crmOverview = await api<CrmOverview>('/crm/overview');
      crmError = '';
    } catch (e) {
      if (isForbidden(e)) crmAvailable = false;
      else crmError = messageOf(e);
    } finally {
      crmLoaded = true;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Bucket 6 — récent (journal d'audit, core)
  // ──────────────────────────────────────────────────────────

  interface AuditLogEntry {
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    createdAt: string;
    user: { email: string; firstName: string; lastName: string } | null;
  }

  let recentLogs = $state<AuditLogEntry[]>([]);
  let recentLoaded = $state(false);
  let recentError = $state('');
  let recentAvailable = $state(true);

  async function loadRecent() {
    try {
      const res = await api<Paginated<AuditLogEntry>>('/audit-logs', { query: { pageSize: 6 } });
      recentLogs = res.items;
      recentError = '';
    } catch (e) {
      if (isForbidden(e)) recentAvailable = false;
      else recentError = messageOf(e);
    } finally {
      recentLoaded = true;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Top-of-page attention summary
  // ──────────────────────────────────────────────────────────

  function pluralize(n: number, singular: string, plural = `${singular}s`): string {
    return n > 1 ? plural : singular;
  }

  const urgentParts = $derived.by(() => {
    const parts: string[] = [];
    if (hasTransportation && lateLoads.length > 0) {
      parts.push(`${lateLoads.length} ${pluralize(lateLoads.length, 'load en retard', 'loads en retard')}`);
    }
    if (decisions.length > 0) {
      parts.push(`${decisions.length} ${pluralize(decisions.length, 'décision en attente', 'décisions en attente')}`);
    }
    if (openTasksTotal > 0) {
      parts.push(`${openTasksTotal} ${pluralize(openTasksTotal, 'tâche ouverte', 'tâches ouvertes')}`);
    }
    if (hasBilling && freightExceptionsCount > 0) {
      parts.push(
        `${freightExceptionsCount} ${pluralize(freightExceptionsCount, 'exception coût', 'exceptions coût')}`,
      );
    }
    return parts;
  });
  const showBanner = $derived(urgentParts.length > 0);
  const bannerSeverity = $derived(hasTransportation && lateLoads.length > 0 ? 'danger' : 'warn');

  // ──────────────────────────────────────────────────────────
  // Shortcuts (unchanged)
  // ──────────────────────────────────────────────────────────

  const shortcuts = [
    { label: 'Dispatch', href: '/dispatch', hint: 'Planifier & tender' },
    { label: 'Plan de cour', href: '/yard', hint: 'Gate & quais' },
    { label: 'Entrepôt', href: '/wms', hint: 'Stock & flux' },
    { label: 'Workbench', href: '/workbench', hint: 'Tâches' },
    { label: 'Actions agents', href: '/agent-actions', hint: 'À approuver' },
  ];

  function refreshAll() {
    if (hasTransportation) {
      void loadStats();
      void loadMap();
    }
    void loadDecisions();
    void loadOpenTasks();
    if (hasBilling) void loadFreightExceptions();
    if (hasCrm) void loadCrm();
    void loadRecent();
  }

  $effect(() => {
    if (hasTransportation) void loadStats();
  });

  $effect(() => {
    if (!hasTransportation) return;
    void loadMap();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadMap();
    }, 45_000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    void loadDecisions();
  });

  $effect(() => {
    void loadOpenTasks();
  });

  $effect(() => {
    if (hasBilling) void loadFreightExceptions();
  });

  $effect(() => {
    if (hasCrm) void loadCrm();
  });

  $effect(() => {
    void loadRecent();
  });
</script>

<PageHeader title="Centre des opérations">
  {#snippet actions()}
    <Button variant="secondary" onclick={refreshAll}>Actualiser</Button>
  {/snippet}
</PageHeader>

{#if showBanner}
  <div class="mb-4">
    <ExceptionBanner
      severity={bannerSeverity}
      title="À traiter maintenant"
      message={urgentParts.join(' · ')}
    />
  </div>
{/if}

<!-- KPI strip (transport) -->
{#if hasTransportation}
  {#if statsLoading}
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {#each { length: 5 } as _, i (i)}<Card><Skeleton rows={2} /></Card>{/each}
    </div>
  {:else}
    {#if statsError}<p class="mb-3 text-sm text-danger">{statsError}</p>{/if}
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {#each metrics as m (m.label)}
        <a
          href={m.href}
          class="group rounded-card border border-edge-soft bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-accent hover:shadow-card"
        >
          <div class="font-mono text-3xl font-bold text-ink">{m.value}</div>
          <div class="mt-1 text-xs tracking-wide text-ink-muted uppercase">{m.label}</div>
        </a>
      {/each}
      <a
        href="/loads"
        class="rounded-card border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card {lateLoads.length
          ? 'border-danger/30 bg-danger-soft'
          : 'border-edge-soft bg-surface'}"
      >
        <div class="font-mono text-3xl font-bold {lateLoads.length ? 'text-danger' : 'text-ink'}">
          {lateLoads.length}
        </div>
        <div class="mt-1 text-xs tracking-wide text-ink-muted uppercase">Loads en retard</div>
      </a>
    </div>
  {/if}
{/if}

<!-- Live map + à surveiller (transport only) -->
{#if hasTransportation}
  <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
    <Card padded={false}>
      <div class="flex items-center justify-between px-4 pt-3 pb-2">
        <h2 class="text-sm font-bold text-ink">Opérations en direct</h2>
        <span class="font-mono text-xs text-ink-muted">{activeCount} actifs</span>
      </div>
      {#if !mapLoaded}
        <div class="px-4 pb-4"><Skeleton rows={6} /></div>
      {:else if mapError}
        <div class="px-4 pb-4">
          <p class="text-sm text-danger">{mapError}</p>
        </div>
      {:else if mapLoads.length === 0}
        <div class="px-4 pb-4">
          <EmptyState message="Aucun load actif — les loads dispatchés et en transit apparaissent ici." />
        </div>
      {:else}
        <OpsMap loads={mapLoads} />
      {/if}
    </Card>

    <Card padded={false}>
      <h2 class="border-b border-edge-soft px-4 py-3 text-sm font-bold text-ink">En retard / bloqué</h2>
      <div class="max-h-72 overflow-y-auto">
        {#if !mapLoaded}
          <div class="p-4"><Skeleton rows={3} /></div>
        {:else if mapError}
          <p class="px-4 py-6 text-center text-sm text-danger">{mapError}</p>
        {:else if lateLoads.length === 0}
          <p class="px-4 py-6 text-center text-sm text-ink-muted">Rien en retard. Tout roule.</p>
        {:else}
          {#each lateLoads as l (l.id)}
            <a
              href="/loads/{l.id}"
              class="flex items-center justify-between gap-2 border-b border-edge-soft px-4 py-2.5 transition-colors last:border-0 hover:bg-surface-muted"
            >
              <div class="min-w-0">
                <div class="font-mono text-sm font-semibold text-ink">{l.loadNumber}</div>
                <div class="truncate text-xs text-ink-muted">{l.carrier ?? 'Sans transporteur'}</div>
              </div>
              <Badge tone="danger">Retard</Badge>
            </a>
          {/each}
        {/if}
      </div>
    </Card>
  </div>
{/if}

<!-- Attention buckets -->
<div class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
  <!-- Décisions en attente -->
  {#if decisionsAvailable}
    <Card padded={false}>
      <div class="flex items-center justify-between border-b border-edge-soft px-4 py-3">
        <h2 class="text-sm font-bold text-ink">Décisions en attente</h2>
        {#if decisionsLoaded && !decisionsError}
          <span class="font-mono text-xs text-ink-muted">{decisions.length}</span>
        {/if}
      </div>
      {#if !decisionsLoaded}
        <div class="p-4"><Skeleton rows={3} /></div>
      {:else if decisionsError}
        <p class="px-4 py-6 text-center text-sm text-danger">{decisionsError}</p>
      {:else if decisions.length === 0}
        <p class="px-4 py-6 text-center text-sm text-ink-muted">Aucune action agent en attente d'approbation.</p>
      {:else}
        <div class="max-h-64 overflow-y-auto">
          {#each decisions.slice(0, 5) as d (d.id)}
            <a
              href="/agent-actions"
              class="flex items-center justify-between gap-2 border-b border-edge-soft px-4 py-2.5 transition-colors last:border-0 hover:bg-surface-muted"
            >
              <div class="min-w-0">
                <div class="truncate font-mono text-sm font-semibold text-ink">{d.tool}</div>
                <div class="truncate text-xs text-ink-muted">{formatDateTime(d.proposedAt)}</div>
              </div>
              <Badge tone={d.riskTier === 'SENSITIVE' ? 'danger' : 'warn'}>{d.riskTier}</Badge>
            </a>
          {/each}
        </div>
      {/if}
      <div class="border-t border-edge-soft px-4 py-2">
        <a href="/agent-actions" class="text-xs font-semibold text-accent hover:underline">Voir tout →</a>
      </div>
    </Card>
  {/if}

  <!-- Tâches ouvertes -->
  {#if openTasksAvailable}
    <Card padded={false}>
      <div class="flex items-center justify-between border-b border-edge-soft px-4 py-3">
        <h2 class="text-sm font-bold text-ink">Tâches ouvertes</h2>
        {#if openTasksLoaded && !openTasksError}
          <span class="font-mono text-xs text-ink-muted">{openTasksTotal}</span>
        {/if}
      </div>
      {#if !openTasksLoaded}
        <div class="p-4"><Skeleton rows={3} /></div>
      {:else if openTasksError}
        <p class="px-4 py-6 text-center text-sm text-danger">{openTasksError}</p>
      {:else if openTasks.length === 0}
        <p class="px-4 py-6 text-center text-sm text-ink-muted">Aucune tâche ouverte dans le workbench.</p>
      {:else}
        <div class="max-h-64 overflow-y-auto">
          {#each openTasks as t (t.id)}
            <a
              href="/workbench"
              class="flex items-center justify-between gap-2 border-b border-edge-soft px-4 py-2.5 transition-colors last:border-0 hover:bg-surface-muted"
            >
              <div class="min-w-0">
                <div class="truncate text-sm font-semibold text-ink">{t.title}</div>
                <div class="truncate text-xs text-ink-muted">{t.category}</div>
              </div>
              <Badge tone="warn">Ouvert</Badge>
            </a>
          {/each}
        </div>
      {/if}
      <div class="border-t border-edge-soft px-4 py-2">
        <a href="/workbench" class="text-xs font-semibold text-accent hover:underline">Voir tout →</a>
      </div>
    </Card>
  {/if}

  <!-- Exceptions coût (billing) -->
  {#if hasBilling && freightAvailable}
    <Card padded={false}>
      <div class="flex items-center justify-between border-b border-edge-soft px-4 py-3">
        <h2 class="text-sm font-bold text-ink">Exceptions coût</h2>
        {#if freightLoaded && !freightError}
          <span class="font-mono text-xs text-ink-muted">{freightExceptionsCount}</span>
        {/if}
      </div>
      {#if !freightLoaded}
        <div class="p-4"><Skeleton rows={3} /></div>
      {:else if freightError}
        <p class="px-4 py-6 text-center text-sm text-danger">{freightError}</p>
      {:else if freightExceptions.length === 0}
        <p class="px-4 py-6 text-center text-sm text-ink-muted">Aucun écart facture transporteur en attente.</p>
      {:else}
        <div class="max-h-64 overflow-y-auto">
          {#each freightExceptions as inv (inv.id)}
            <a
              href="/billing/freight-audit/{inv.id}"
              class="flex items-center justify-between gap-2 border-b border-edge-soft px-4 py-2.5 transition-colors last:border-0 hover:bg-surface-muted"
            >
              <div class="min-w-0">
                <div class="truncate font-mono text-sm font-semibold text-ink">{inv.carrierInvoiceNumber}</div>
                <div class="truncate text-xs text-ink-muted">{inv.carrier.name}</div>
              </div>
              <Badge tone={inv.status === 'DISPUTED' ? 'danger' : 'warn'}>{inv.status}</Badge>
            </a>
          {/each}
        </div>
      {/if}
      <div class="border-t border-edge-soft px-4 py-2">
        <a href="/billing/freight-audit" class="text-xs font-semibold text-accent hover:underline">Voir tout →</a>
      </div>
    </Card>
  {/if}

  <!-- CRM -->
  {#if hasCrm && crmAvailable}
    <Card padded={false}>
      <div class="flex items-center justify-between border-b border-edge-soft px-4 py-3">
        <h2 class="text-sm font-bold text-ink">CRM</h2>
        {#if crmLoaded && !crmError && crmOverview}
          <span class="font-mono text-xs text-ink-muted">
            {crmOverview.dueFollowupCount + crmOverview.staleDealCount}
          </span>
        {/if}
      </div>
      {#if !crmLoaded}
        <div class="p-4"><Skeleton rows={3} /></div>
      {:else if crmError}
        <p class="px-4 py-6 text-center text-sm text-danger">{crmError}</p>
      {:else if crmOverview && (crmOverview.dueFollowupCount > 0 || crmOverview.staleDealCount > 0)}
        <div class="grid grid-cols-2 gap-2 px-4 py-3">
          <a href="/crm/activities" class="rounded-inner bg-surface-muted p-2 text-center hover:bg-edge-soft">
            <div class="font-mono text-lg font-bold text-ink">{crmOverview.dueFollowupCount}</div>
            <div class="text-[11px] text-ink-muted uppercase">Relances en retard</div>
          </a>
          <a href="/crm/pipeline" class="rounded-inner bg-surface-muted p-2 text-center hover:bg-edge-soft">
            <div class="font-mono text-lg font-bold text-ink">{crmOverview.staleDealCount}</div>
            <div class="text-[11px] text-ink-muted uppercase">Deals stagnants</div>
          </a>
        </div>
      {:else}
        <p class="px-4 py-6 text-center text-sm text-ink-muted">Aucune relance ni deal stagnant.</p>
      {/if}
      <div class="border-t border-edge-soft px-4 py-2">
        <a href="/crm" class="text-xs font-semibold text-accent hover:underline">Voir tout →</a>
      </div>
    </Card>
  {/if}
</div>

<div class="mt-4 grid gap-4 lg:grid-cols-2">
  <!-- Récent -->
  {#if recentAvailable}
    <Card padded={false}>
      <h2 class="border-b border-edge-soft px-4 py-3 text-sm font-bold text-ink">Récent</h2>
      {#if !recentLoaded}
        <div class="p-4"><Skeleton rows={4} /></div>
      {:else if recentError}
        <p class="px-4 py-6 text-center text-sm text-danger">{recentError}</p>
      {:else if recentLogs.length === 0}
        <p class="px-4 py-6 text-center text-sm text-ink-muted">Aucune activité récente.</p>
      {:else}
        <div class="max-h-56 overflow-y-auto">
          {#each recentLogs as log (log.id)}
            <div class="flex items-center justify-between gap-2 border-b border-edge-soft px-4 py-2 last:border-0">
              <div class="min-w-0">
                <div class="truncate text-xs text-ink">
                  <span class="font-semibold">{log.action}</span>
                  <span class="text-ink-muted"> · {log.entityType}</span>
                </div>
                <div class="truncate text-[11px] text-ink-faint">
                  {log.user ? `${log.user.firstName} ${log.user.lastName}` : 'Système'} · {formatDateTime(log.createdAt)}
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
      <div class="border-t border-edge-soft px-4 py-2">
        <a href="/settings/audit" class="text-xs font-semibold text-accent hover:underline">Journal d'audit →</a>
      </div>
    </Card>
  {/if}

  <!-- Shortcuts -->
  <Card padded={false}>
    <h2 class="border-b border-edge-soft px-4 py-3 text-sm font-bold text-ink">Raccourcis</h2>
    <div class="p-2">
      {#each shortcuts as s (s.href)}
        <a
          href={s.href}
          class="flex items-center justify-between rounded-inner px-2 py-2 transition-colors hover:bg-surface-muted"
        >
          <span class="text-sm font-medium text-ink">{s.label}</span>
          <span class="text-xs text-ink-faint">{s.hint}</span>
        </a>
      {/each}
    </div>
  </Card>
</div>
