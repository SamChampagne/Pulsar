<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import type { Paginated } from '@pulsar/shared';
  import {
    PageHeader,
    Card,
    Badge,
    Button,
    EmptyState,
    ErrorNotice,
    Skeleton,
    toneFor,
    type Tone,
  } from '$lib/components/ui';

  // ── Types (mirrored from existing pages / API controllers) ──────────────────

  interface IntegrationRecord {
    id: string;
    key: string;
    name: string;
    status: 'DISABLED' | 'ENABLED' | 'ERROR';
    config?: Record<string, unknown>;
  }

  interface InboundMessage {
    id: string;
    source: string;
    status: string;
    kind: string;
    summary: string | null;
    createdAt: string;
  }

  interface ImportBatch {
    id: string;
    number: string;
    target: string;
    status: string;
    totalRows: number;
    importedRows: number;
    failedRows: number;
    createdAt: string;
  }

  interface ApiKeyRow {
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    lastUsedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
  }

  // ── State ────────────────────────────────────────────────────────────────
  // Each endpoint group is loaded in its own try/catch so a single 403 / failure
  // (e.g. missing read permission for one surface) defaults that section to empty
  // instead of blanking the whole studio.

  let loading = $state(true);
  let error = $state('');

  let integrations = $state<IntegrationRecord[]>([]);
  let inbound = $state<InboundMessage[]>([]);
  let inboundTotal = $state(0);
  let imports = $state<ImportBatch[]>([]);
  let importsTotal = $state(0);
  let apiKeys = $state<ApiKeyRow[]>([]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function fmt(value: string | null | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-CA');
  }

  function configString(config: Record<string, unknown> | undefined, key: string): string {
    const v = config?.[key];
    return typeof v === 'string' ? v : '';
  }

  function integrationStatusTone(status: IntegrationRecord['status']): Tone {
    if (status === 'ENABLED') return 'ok';
    if (status === 'ERROR') return 'danger';
    return 'neutral';
  }

  // Direction is stored in the integration config by Connect Studio (inbound/outbound/bidirectional).
  function directionOf(integration: IntegrationRecord): 'inbound' | 'outbound' | 'bidirectional' | '' {
    const raw = configString(integration.config, 'direction');
    if (raw === 'inbound' || raw === 'outbound' || raw === 'bidirectional') return raw;
    return '';
  }

  // ── Derived KPIs ─────────────────────────────────────────────────────────

  const activeConnectors = $derived(integrations.filter((i) => i.status === 'ENABLED').length);
  const errorConnectors = $derived(integrations.filter((i) => i.status === 'ERROR').length);

  // "non traités" = received but not yet imported/ignored
  const untreatedInbound = $derived(
    inbound.filter((m) => m.status === 'RECEIVED' || m.status === 'PARSED' || m.status === 'FAILED')
      .length,
  );
  const failedInbound = $derived(inbound.filter((m) => m.status === 'FAILED').length);

  const recentImports = $derived(imports.length);
  const failedImportBatches = $derived(imports.filter((b) => b.failedRows > 0).length);

  const activeApiKeys = $derived(apiKeys.filter((k) => !k.revokedAt).length);

  // ── Flux columns (deep-linked nodes) ───────────────────────────────────────

  // Outbound integrations = connectors flagged outbound/bidirectional or webhook kind.
  const outboundIntegrations = $derived(
    integrations.filter((i) => {
      const dir = directionOf(i);
      const kind = configString(i.config, 'kind');
      return dir === 'outbound' || dir === 'bidirectional' || kind === 'webhook';
    }),
  );
  const inboundIntegrations = $derived(
    integrations.filter((i) => {
      const dir = directionOf(i);
      return dir === 'inbound' || dir === 'bidirectional';
    }),
  );

  // ── Load ───────────────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    let anySucceeded = false;

    await Promise.all([
      (async () => {
        try {
          integrations = await api<IntegrationRecord[]>('/integrations');
          anySucceeded = true;
        } catch {
          integrations = [];
        }
      })(),
      (async () => {
        try {
          const res = await api<Paginated<InboundMessage>>('/connect/inbox', {
            query: { page: 1, pageSize: 8 },
          });
          inbound = res.items;
          inboundTotal = res.total;
          anySucceeded = true;
        } catch {
          inbound = [];
          inboundTotal = 0;
        }
      })(),
      (async () => {
        try {
          const res = await api<Paginated<ImportBatch>>('/connect/imports', {
            query: { page: 1, pageSize: 8 },
          });
          imports = res.items;
          importsTotal = res.total;
          anySucceeded = true;
        } catch {
          imports = [];
          importsTotal = 0;
        }
      })(),
      (async () => {
        try {
          apiKeys = await api<ApiKeyRow[]>('/api-keys');
          anySucceeded = true;
        } catch {
          apiKeys = [];
        }
      })(),
    ]);

    // Only surface a page-level error if every endpoint failed (likely auth/network),
    // not when a single surface is simply forbidden for this role.
    if (!anySucceeded) {
      error = 'Impossible de charger les données Connect. Vérifiez vos permissions ou réessayez.';
    }
    loading = false;
  }

  $effect(() => {
    void load();
  });

  // ── Combined recent activity (inbound + imports, newest first) ───────────────

  type ActivityRow = {
    id: string;
    kind: 'inbound' | 'import';
    label: string;
    sub: string;
    status: string;
    createdAt: string;
    href: string;
  };

  const activity = $derived<ActivityRow[]>(
    [
      ...inbound.map(
        (m): ActivityRow => ({
          id: `in-${m.id}`,
          kind: 'inbound',
          label: m.summary || m.kind || 'Message entrant',
          sub: `Canal ${m.source}`,
          status: m.status,
          createdAt: m.createdAt,
          href: '/connect/inbox',
        }),
      ),
      ...imports.map(
        (b): ActivityRow => ({
          id: `imp-${b.id}`,
          kind: 'import',
          label: `${b.number} · ${b.target}`,
          sub: `${b.importedRows}/${b.totalRows} importés${b.failedRows ? ` · ${b.failedRows} échecs` : ''}`,
          status: b.status,
          createdAt: b.createdAt,
          href: '/connect/imports',
        }),
      ),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10),
  );
</script>

<PageHeader
  title="Connect Studio"
  eyebrow="Connect / Developer Platform"
  subtitle="Vue d'ensemble de vos systèmes branchés et des flux entrants/sortants."
>
  {#snippet actions()}
    <Button variant="secondary" href="/connect">Accueil Connect</Button>
    <Button href="/integrations">Connecteurs</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

<!-- ── KPI cards ─────────────────────────────────────────────────────────── -->
{#if loading}
  <div class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
    {#each Array(5) as _, i (i)}
      <Card><Skeleton rows={2} /></Card>
    {/each}
  </div>
{:else}
  <div class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
    <div class="rounded-card border border-edge bg-surface p-4">
      <p class="text-xs text-ink-faint">Connecteurs actifs</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{activeConnectors}</p>
      <p class="mt-1 text-[11px] text-ink-faint">
        {integrations.length} configurés{errorConnectors ? ` · ${errorConnectors} en erreur` : ''}
      </p>
    </div>
    <div class="rounded-card border border-edge bg-surface p-4">
      <p class="text-xs text-ink-faint">Canaux entrants</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{inboundTotal}</p>
      <p class="mt-1 text-[11px] {untreatedInbound ? 'text-warn' : 'text-ink-faint'}">
        {untreatedInbound} non traités
      </p>
    </div>
    <div class="rounded-card border border-edge bg-surface p-4">
      <p class="text-xs text-ink-faint">Imports récents</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{importsTotal}</p>
      <p class="mt-1 text-[11px] {failedImportBatches ? 'text-danger' : 'text-ink-faint'}">
        {failedImportBatches ? `${failedImportBatches} avec échecs` : 'aucun échec'}
      </p>
    </div>
    <div class="rounded-card border border-edge bg-surface p-4">
      <p class="text-xs text-ink-faint">Clés API actives</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{activeApiKeys}</p>
      <p class="mt-1 text-[11px] text-ink-faint">{apiKeys.length} émises</p>
    </div>
    <div class="rounded-card border border-edge bg-surface p-4">
      <p class="text-xs text-ink-faint">Flux entrants en alerte</p>
      <p class="mt-1 text-2xl font-semibold {failedInbound ? 'text-danger' : 'text-ink'}">
        {failedInbound}
      </p>
      <p class="mt-1 text-[11px] text-ink-faint">messages en échec</p>
    </div>
  </div>
{/if}

<!-- ── Flux board: Entrant → Pulsar → Sortant ─────────────────────────────── -->
<Card padded={false}>
  <div class="border-b border-edge-soft px-4 py-3">
    <h2 class="text-sm font-bold text-ink">Flux de la plateforme</h2>
    <p class="mt-1 text-xs text-ink-muted">
      Ce qui entre dans Pulsar (gauche) et ce qui en sort (droite). Cliquez une carte pour gérer la
      surface.
    </p>
  </div>

  <div class="overflow-x-auto p-4">
    <div class="grid min-w-[760px] grid-cols-[minmax(0,1fr)_auto_minmax(0,0.9fr)_auto_minmax(0,1fr)] items-stretch gap-3">
      <!-- INBOUND column -->
      <div class="space-y-3">
        <p class="text-[11px] font-semibold tracking-[0.18em] text-ink-faint uppercase">Entrant</p>

        <a
          href="/connect/inbox"
          class="block rounded-inner border border-edge bg-surface-muted p-3 transition hover:border-accent/40"
        >
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-semibold text-ink">Email / IMAP · Inbox</p>
            <Badge tone={failedInbound ? 'danger' : untreatedInbound ? 'warn' : 'ok'}>
              {inboundTotal}
            </Badge>
          </div>
          <p class="mt-1 text-xs text-ink-muted">
            Webhooks, documents, courriels. {untreatedInbound} non traités.
          </p>
        </a>

        <a
          href="/connect/imports"
          class="block rounded-inner border border-edge bg-surface-muted p-3 transition hover:border-accent/40"
        >
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-semibold text-ink">Imports CSV</p>
            <Badge tone={failedImportBatches ? 'warn' : 'ok'}>{importsTotal}</Badge>
          </div>
          <p class="mt-1 text-xs text-ink-muted">
            Clients, transporteurs, lieux, articles en masse.
          </p>
        </a>

        <a
          href="/settings/api-keys"
          class="block rounded-inner border border-edge bg-surface-muted p-3 transition hover:border-accent/40"
        >
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-semibold text-ink">Clés API · Appelants externes</p>
            <Badge tone={activeApiKeys ? 'ok' : 'neutral'}>{activeApiKeys}</Badge>
          </div>
          <p class="mt-1 text-xs text-ink-muted">Accès machine-à-machine en lecture (X-Api-Key).</p>
        </a>

        {#each inboundIntegrations as integ (integ.id)}
          <a
            href="/integrations"
            class="block rounded-inner border border-edge-soft bg-surface p-3 transition hover:border-accent/40"
          >
            <div class="flex items-center justify-between gap-2">
              <p class="truncate text-sm font-semibold text-ink">{integ.name}</p>
              <Badge tone={integrationStatusTone(integ.status)}>{integ.status}</Badge>
            </div>
            <p class="mt-1 text-xs text-ink-muted">
              Connecteur entrant{configString(integ.config, 'kind')
                ? ` · ${configString(integ.config, 'kind')}`
                : ''}
            </p>
          </a>
        {/each}
      </div>

      <!-- arrow inbound → -->
      <div class="flex items-center justify-center text-2xl text-accent" aria-hidden="true">⟶</div>

      <!-- PULSAR center -->
      <div class="flex flex-col justify-center rounded-card border border-edge bg-ink p-4 text-center text-white">
        <p class="text-[11px] font-semibold tracking-[0.2em] text-white/55 uppercase">Plateforme</p>
        <p class="mt-2 text-xl font-bold">Pulsar</p>
        <p class="mt-1 text-xs leading-5 text-white/65">
          Ingestion, normalisation, gouvernance et distribution des flux.
        </p>
        <div class="mt-3 flex flex-wrap justify-center gap-1.5">
          <span class="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold">
            {activeConnectors} live
          </span>
          {#if errorConnectors}
            <span class="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger">
              {errorConnectors} erreur
            </span>
          {/if}
        </div>
      </div>

      <!-- arrow → outbound -->
      <div class="flex items-center justify-center text-2xl text-accent" aria-hidden="true">⟶</div>

      <!-- OUTBOUND column -->
      <div class="space-y-3">
        <p class="text-[11px] font-semibold tracking-[0.18em] text-ink-faint uppercase">Sortant</p>

        <a
          href="/integrations"
          class="block rounded-inner border border-edge bg-surface-muted p-3 transition hover:border-accent/40"
        >
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-semibold text-ink">Connecteurs & webhooks</p>
            <Badge tone={errorConnectors ? 'danger' : activeConnectors ? 'ok' : 'neutral'}>
              {activeConnectors}
            </Badge>
          </div>
          <p class="mt-1 text-xs text-ink-muted">
            Livraisons d'événements vers les systèmes tiers (outbox).
          </p>
        </a>

        {#if outboundIntegrations.length}
          {#each outboundIntegrations as integ (integ.id)}
            <a
              href="/integrations"
              class="block rounded-inner border border-edge-soft bg-surface p-3 transition hover:border-accent/40"
            >
              <div class="flex items-center justify-between gap-2">
                <p class="truncate text-sm font-semibold text-ink">{integ.name}</p>
                <Badge tone={integrationStatusTone(integ.status)}>{integ.status}</Badge>
              </div>
              <p class="mt-1 text-xs text-ink-muted">
                Connecteur sortant{configString(integ.config, 'kind')
                  ? ` · ${configString(integ.config, 'kind')}`
                  : ''}
              </p>
            </a>
          {/each}
        {/if}

        <a
          href="/agents"
          class="block rounded-inner border border-edge bg-surface-muted p-3 transition hover:border-accent/40"
        >
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-semibold text-ink">Agents · MCP Tools</p>
            <Badge tone="info">MCP</Badge>
          </div>
          <p class="mt-1 text-xs text-ink-muted">
            Outils gouvernés exposés aux agents (lecture / actions en file).
          </p>
        </a>
      </div>
    </div>
  </div>
</Card>

<!-- ── Recent activity ─────────────────────────────────────────────────────── -->
<div class="mt-6">
  <Card padded={false}>
    <div class="border-b border-edge-soft px-4 py-3">
      <h2 class="text-sm font-bold text-ink">Activité récente des flux</h2>
      <p class="mt-1 text-xs text-ink-muted">Derniers messages entrants et batches d'import.</p>
    </div>

    {#if loading}
      <div class="p-4"><Skeleton rows={5} /></div>
    {:else if activity.length === 0}
      <div class="p-4">
        <EmptyState
          title="Aucune activité"
          message="Aucun flux entrant ni import récent. Branchez un connecteur ou lancez un import pour démarrer."
        >
          {#snippet children()}
            <Button variant="secondary" href="/connect/imports">Lancer un import</Button>
          {/snippet}
        </EmptyState>
      </div>
    {:else}
      <ul class="divide-y divide-edge-soft">
        {#each activity as row (row.id)}
          <li>
            <a
              href={row.href}
              class="flex items-start justify-between gap-3 px-4 py-3 transition hover:bg-surface-muted"
            >
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <Badge tone={row.kind === 'inbound' ? 'info' : 'neutral'}>
                    {row.kind === 'inbound' ? 'Entrant' : 'Import'}
                  </Badge>
                  <p class="truncate text-sm font-medium text-ink">{row.label}</p>
                </div>
                <p class="mt-1 text-xs text-ink-muted">{row.sub}</p>
              </div>
              <div class="shrink-0 text-right">
                <Badge tone={toneFor(row.status)}>{row.status}</Badge>
                <p class="mt-1 text-[11px] text-ink-faint">{fmt(row.createdAt)}</p>
              </div>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </Card>
</div>
