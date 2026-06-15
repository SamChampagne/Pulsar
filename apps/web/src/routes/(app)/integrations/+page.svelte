<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Card, EmptyState, PageHeader, Skeleton } from '$lib/components/ui';
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

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Integration Operating Layer" />

<section class="mb-6 overflow-hidden rounded-card border border-edge bg-ink text-white shadow-sm">
  <div class="grid gap-6 p-5 lg:grid-cols-[1.1fr_0.9fr] lg:p-6">
    <div>
      <p class="text-xs font-semibold tracking-[0.22em] text-white/55 uppercase">Software integrations</p>
      <h1 class="mt-2 max-w-3xl text-2xl font-bold tracking-tight sm:text-3xl">
        Prépare Pulsar à brancher ERP, EDI, télématique et comptabilité sans perdre la gouvernance.
      </h1>
      <p class="mt-3 max-w-2xl text-sm leading-6 text-white/68">
        Cette vue transforme les intégrations en couche opérationnelle : état, capacités manquantes,
        santé des livraisons et ordre de branchement pour les futurs agents Hermes.
      </p>
    </div>

    <div class="grid grid-cols-2 gap-2 text-sm">
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Connecteurs</p>
        <p class="mt-1 text-2xl font-semibold">{summary.total}</p>
      </div>
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Live</p>
        <p class="mt-1 text-2xl font-semibold">{summary.live}</p>
      </div>
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Bloqués</p>
        <p class="mt-1 text-2xl font-semibold">{summary.blocked}</p>
      </div>
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">À configurer</p>
        <p class="mt-1 text-2xl font-semibold">{summary.notConfigured}</p>
      </div>
    </div>
  </div>
</section>

{#if error}<p class="mb-4 text-sm text-danger">{error}</p>{/if}

{#if loading}
  <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
    {#each { length: 3 } as _, i (i)}
      <Card><Skeleton rows={5} /></Card>
    {/each}
  </div>
{:else if integrations.length === 0}
  <EmptyState message="Aucune intégration configurée. Crée un premier connecteur ERP, EDI ou webhook." />
{:else}
  <div class="mb-6 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
    <Card>
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold text-ink">Attention intégrations</h2>
          <p class="mt-0.5 text-xs text-ink-muted">Ordonné par risque business et santé des livraisons.</p>
        </div>
        <Badge tone={summary.attention.length ? 'warn' : 'ok'}>
          {summary.attention.length ? `${summary.attention.length} à traiter` : 'stable'}
        </Badge>
      </div>

      <ul class="divide-y divide-edge">
        {#each summary.attention.slice(0, 5) as row (row.key)}
          <li class="py-3 first:pt-0 last:pb-0">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-medium text-ink">{row.name}</span>
                  <Badge tone={severityTone(row.health.severity)}>{row.health.state}</Badge>
                </div>
                <p class="mt-1 text-xs text-ink-muted">{row.health.reason}</p>
                <p class="mt-1 text-xs text-ink-faint">{row.health.nextStep}</p>
              </div>
              <Badge tone="neutral">{row.kind}</Badge>
            </div>
          </li>
        {:else}
          <li class="py-3 text-sm text-ink-muted">Tous les connecteurs actifs sont sains.</li>
        {/each}
      </ul>
    </Card>

    <Card>
      <h2 class="text-sm font-semibold text-ink">Roadmap de branchement</h2>
      <p class="mt-0.5 text-xs text-ink-muted">
        L’ordre évite de donner trop d’autonomie aux agents avant les sources de vérité.
      </p>
      <div class="mt-4 space-y-3">
        {#each roadmap as phase (phase.phase)}
          <div class="rounded-xl border border-edge p-3">
            <div class="flex items-center justify-between gap-2">
              <p class="text-sm font-semibold text-ink">{phase.title}</p>
              <Badge tone="info">{phase.phase}</Badge>
            </div>
            <p class="mt-1 text-xs leading-5 text-ink-muted">{phase.outcome}</p>
            <p class="mt-2 text-xs text-ink-faint">
              {phase.connectors.length ? phase.connectors.map((connector) => connector.name).join(' · ') : 'Aucun connecteur dans cette phase'}
            </p>
          </div>
        {/each}
      </div>
    </Card>
  </div>

  <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
    {#each rows as row (row.key)}
      <Card>
        <div class="mb-4 flex items-start justify-between gap-3">
          <div>
            <p class="font-semibold text-ink">{row.name}</p>
            <p class="text-xs text-ink-muted">{row.key}</p>
          </div>
          <div class="flex flex-wrap justify-end gap-1.5">
            <Badge tone={statusTone(row.status)}>{row.status}</Badge>
            <Badge tone="neutral">{row.kind}</Badge>
          </div>
        </div>
        <div class="rounded-xl border border-edge bg-surface-muted p-3">
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm font-medium text-ink">{row.health.reason}</span>
            <Badge tone={severityTone(row.health.severity)}>{row.health.severity}</Badge>
          </div>
          <p class="mt-2 text-xs leading-5 text-ink-muted">{row.health.nextStep}</p>
          {#if row.health.failureRatePct !== null}
            <p class="mt-2 text-xs text-ink-faint">Échec 24h : {row.health.failureRatePct}%</p>
          {/if}
          {#if row.health.missingCapabilities.length > 0}
            <p class="mt-2 text-xs text-ink-faint">
              Capacités manquantes : {row.health.missingCapabilities.join(', ')}
            </p>
          {/if}
        </div>
      </Card>
    {/each}
  </div>
{/if}
