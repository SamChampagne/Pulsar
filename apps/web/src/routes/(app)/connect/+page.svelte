<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Card, EmptyState, ErrorNotice, PageHeader, Skeleton } from '$lib/components/ui';
  import {
    buildIntegrationRoadmap,
    inferIntegrationKind,
    integrationAttentionRank,
    summarizeIntegrationReadiness,
    type IntegrationKind,
    type IntegrationConnectorStatus,
    type IntegrationOperationsInput,
    type IntegrationSeverity,
  } from '@pulsar/shared';

  type IntegrationRecord = IntegrationOperationsInput & {
    id: string;
    config?: Record<string, unknown>;
  };

  let integrations = $state<IntegrationRecord[]>([]);
  let error = $state('');
  let loading = $state(true);

  const operations = $derived(
    integrations.map((integration): IntegrationOperationsInput => ({
      ...integration,
      kind: integration.kind ?? inferIntegrationKind(integration.key, integration.name),
      requiredCapabilities: integration.requiredCapabilities ?? requiredCapabilitiesFor(integration.kind ?? inferIntegrationKind(integration.key, integration.name)),
      capabilities: integration.capabilities ?? capabilitiesFromConfig(integration.config),
    })),
  );
  const summary = $derived(summarizeIntegrationReadiness(operations));
  const roadmap = $derived(buildIntegrationRoadmap(operations));
  const rows = $derived(
    [...summary.rows].sort(
      (a, b) => integrationAttentionRank(b.health) - integrationAttentionRank(a.health) || a.name.localeCompare(b.name),
    ),
  );

  function requiredCapabilitiesFor(kind: IntegrationKind): string[] {
    if (kind === 'erp') return ['orders.import', 'customers.import'];
    if (kind === 'accounting') return ['customer-invoices.export', 'payments.import'];
    if (kind === 'telematics') return ['positions.import'];
    if (kind === 'edi') return ['tenders.exchange', 'statuses.import'];
    if (kind === 'warehouse') return ['inventory.import'];
    if (kind === 'webhook') return ['events.deliver'];
    return [];
  }
  function capabilitiesFromConfig(config: Record<string, unknown> | undefined): string[] {
    const raw = config?.capabilities;
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
  }
  function severityTone(severity: IntegrationSeverity): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
    if (severity === 'critical') return 'danger';
    if (severity === 'warning') return 'warn';
    if (severity === 'info') return 'info';
    return 'ok';
  }
  function statusTone(status: IntegrationConnectorStatus): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
    if (status === 'ENABLED') return 'ok';
    if (status === 'ERROR') return 'danger';
    return 'neutral';
  }
  async function load() {
    loading = true;
    error = '';
    try {
      integrations = await api<IntegrationRecord[]>('/integrations');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load integrations';
    } finally {
      loading = false;
    }
  }
  $effect(() => { void load(); });
</script>

<PageHeader
  title="Connect / Developer Platform"
  subtitle="API, webhooks, connectors, MCP tools and external-system readiness — la couche qui rend Pulsar extensible."
/>

{#if error}<ErrorNotice message={error} />{/if}

<section class="mb-5 overflow-hidden rounded-card border border-edge bg-ink text-white shadow-sm">
  <div class="grid gap-5 p-5 lg:grid-cols-[1.1fr_0.9fr] lg:p-6">
    <div>
      <p class="text-xs font-semibold tracking-[0.24em] text-white/55 uppercase">Platform connectivity</p>
      <h1 class="mt-2 max-w-3xl text-2xl font-bold tracking-tight sm:text-3xl">
        Connect n’est plus un réglage caché : c’est l’app qui branche Pulsar au reste de l’entreprise.
      </h1>
      <p class="mt-3 max-w-2xl text-sm leading-6 text-white/68">
        ERP, comptabilité, EDI, télématique, webhooks, API keys et outils MCP doivent vivre dans une même surface
        avec santé, capacités manquantes, logs et actions d’agents.
      </p>
    </div>
    <div class="grid grid-cols-2 gap-2 text-sm">
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Connecteurs</p>
        <p class="mt-1 text-2xl font-semibold">{loading ? '—' : summary.total}</p>
      </div>
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Live</p>
        <p class="mt-1 text-2xl font-semibold">{loading ? '—' : summary.live}</p>
      </div>
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Bloqués</p>
        <p class="mt-1 text-2xl font-semibold">{loading ? '—' : summary.blocked}</p>
      </div>
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">À configurer</p>
        <p class="mt-1 text-2xl font-semibold">{loading ? '—' : summary.notConfigured}</p>
      </div>
    </div>
  </div>
</section>

<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
  <Card padded={false}>
    <h2 class="border-b border-edge-soft px-4 py-3 text-sm font-bold text-ink">Connector readiness</h2>
    {#if loading}
      <Skeleton />
    {:else if rows.length === 0}
      <div class="p-4"><EmptyState message="Aucun connecteur configuré pour ce tenant." /></div>
    {:else}
      <div class="divide-y divide-edge-soft">
        {#each rows as row (row.key)}
          <div class="flex items-start justify-between gap-3 px-4 py-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <p class="truncate text-sm font-semibold text-ink">{row.name}</p>
                <Badge tone={statusTone(row.status)}>{row.status}</Badge>
              </div>
              <p class="mt-1 text-xs leading-5 text-ink-muted">{row.kind} · {row.health.reason}</p>
              {#if row.health.missingCapabilities.length}
                <p class="mt-1 text-xs text-ink-faint">Missing: {row.health.missingCapabilities.join(', ')}</p>
              {/if}
            </div>
            <Badge tone={severityTone(row.health.severity)}>{row.health.severity}</Badge>
          </div>
        {/each}
      </div>
    {/if}
  </Card>

  <div class="space-y-4">
    <Card>
      <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Developer surfaces</p>
      <div class="mt-3 space-y-2">
        <a href="/integrations" class="block rounded-inner bg-surface-muted px-3 py-2 text-sm font-medium text-ink hover:bg-accent-soft hover:text-accent">Connecteurs opérationnels</a>
        <a href="/settings/api-keys" class="block rounded-inner bg-surface-muted px-3 py-2 text-sm font-medium text-ink hover:bg-accent-soft hover:text-accent">Clés API</a>
        <a href="/agents" class="block rounded-inner bg-surface-muted px-3 py-2 text-sm font-medium text-ink hover:bg-accent-soft hover:text-accent">Agents & MCP tools</a>
        <a href="/workbench" class="block rounded-inner bg-surface-muted px-3 py-2 text-sm font-medium text-ink hover:bg-accent-soft hover:text-accent">Events → tasks</a>
      </div>
    </Card>

    <Card>
      <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Next connector order</p>
      {#if loading}
        <Skeleton />
      {:else if roadmap.length === 0}
        <p class="mt-3 text-sm leading-6 text-ink-muted">Aucune recommandation pour l’instant.</p>
      {:else}
        <ol class="mt-3 space-y-2">
          {#each roadmap.slice(0, 4) as phase (phase.phase)}
            <li class="flex gap-2 text-sm">
              <span class="font-mono text-ink-faint">{phase.phase}</span>
              <span class="text-ink-muted">{phase.title}</span>
            </li>
          {/each}
        </ol>
      {/if}
    </Card>
  </div>
</div>
