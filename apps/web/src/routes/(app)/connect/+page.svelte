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
    integrations.map(
      (integration): IntegrationOperationsInput => ({
        ...integration,
        kind: integration.kind ?? inferIntegrationKind(integration.key, integration.name),
        requiredCapabilities:
          integration.requiredCapabilities ??
          requiredCapabilitiesFor(
            integration.kind ?? inferIntegrationKind(integration.key, integration.name),
          ),
        capabilities: integration.capabilities ?? capabilitiesFromConfig(integration.config),
      }),
    ),
  );
  const summary = $derived(summarizeIntegrationReadiness(operations));
  const roadmap = $derived(buildIntegrationRoadmap(operations));
  const rows = $derived(
    [...summary.rows].sort(
      (a, b) =>
        integrationAttentionRank(b.health) - integrationAttentionRank(a.health) ||
        a.name.localeCompare(b.name),
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
  function severityTone(
    severity: IntegrationSeverity,
  ): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
    if (severity === 'critical') return 'danger';
    if (severity === 'warning') return 'warn';
    if (severity === 'info') return 'info';
    return 'ok';
  }
  function statusTone(
    status: IntegrationConnectorStatus,
  ): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
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
  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Connect" subtitle="Connecteurs, API keys, webhooks, MCP." />

{#if error}<ErrorNotice message={error} />{/if}

<section class="mb-5 rounded-card border border-edge bg-surface p-4 shadow-sm">
  <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
    <div>
      <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">
        Platform connectivity
      </p>
      <h1 class="mt-1 text-xl font-bold text-ink">Integration command</h1>
    </div>
    <div class="flex flex-wrap gap-2">
      <a
        href="/integrations"
        class="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-strong"
        >Connect Studio</a
      >
      <a
        href="/settings/api-keys"
        class="rounded-md border border-edge px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-muted"
        >API keys</a
      >
      <a
        href="/agents"
        class="rounded-md border border-edge px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-muted"
        >MCP / agents</a
      >
    </div>
  </div>
  <div class="mt-4 grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
    <div class="rounded-xl bg-surface-muted p-3">
      <p class="text-xs text-ink-faint">Connecteurs</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{loading ? '—' : summary.total}</p>
    </div>
    <div class="rounded-xl bg-surface-muted p-3">
      <p class="text-xs text-ink-faint">Live</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{loading ? '—' : summary.live}</p>
    </div>
    <div class="rounded-xl bg-surface-muted p-3">
      <p class="text-xs text-ink-faint">Bloqués</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{loading ? '—' : summary.blocked}</p>
    </div>
    <div class="rounded-xl bg-surface-muted p-3">
      <p class="text-xs text-ink-faint">À configurer</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{loading ? '—' : summary.notConfigured}</p>
    </div>
  </div>
</section>

<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
  <Card padded={false}>
    <h2 class="border-b border-edge-soft px-4 py-3 text-sm font-bold text-ink">
      Connector readiness
    </h2>
    {#if loading}
      <Skeleton />
    {:else if rows.length === 0}
      <div class="p-4"><EmptyState message="Aucun connecteur configuré pour ce tenant." /></div>
    {:else}
      <div class="divide-y divide-edge-soft">
        {#each rows as row (row.key)}
          <a
            href="/integrations"
            class="flex items-start justify-between gap-3 px-4 py-3 transition hover:bg-surface-muted"
          >
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <p class="truncate text-sm font-semibold text-ink">{row.name}</p>
                <Badge tone={statusTone(row.status)}>{row.status}</Badge>
              </div>
              <p class="mt-1 text-xs leading-5 text-ink-muted">{row.kind} · {row.health.reason}</p>
              {#if row.health.missingCapabilities.length}
                <p class="mt-1 text-xs text-ink-faint">
                  Missing: {row.health.missingCapabilities.join(', ')}
                </p>
              {/if}
            </div>
            <Badge tone={severityTone(row.health.severity)}>{row.health.severity}</Badge>
          </a>
        {/each}
      </div>
    {/if}
  </Card>

  <div class="space-y-4">
    <Card>
      <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">
        Developer surfaces
      </p>
      <div class="mt-3 space-y-2">
        <a
          href="/integrations"
          class="block rounded-inner bg-surface-muted px-3 py-2 text-sm font-medium text-ink hover:bg-accent-soft hover:text-accent"
          >Connecteurs opérationnels</a
        >
        <a
          href="/settings/api-keys"
          class="block rounded-inner bg-surface-muted px-3 py-2 text-sm font-medium text-ink hover:bg-accent-soft hover:text-accent"
          >Clés API</a
        >
        <a
          href="/agents"
          class="block rounded-inner bg-surface-muted px-3 py-2 text-sm font-medium text-ink hover:bg-accent-soft hover:text-accent"
          >Agents & MCP tools</a
        >
        <a
          href="/workbench"
          class="block rounded-inner bg-surface-muted px-3 py-2 text-sm font-medium text-ink hover:bg-accent-soft hover:text-accent"
          >Events → tasks</a
        >
      </div>
    </Card>

    <Card>
      <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">
        Next connector order
      </p>
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
