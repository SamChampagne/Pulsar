<script lang="ts">
  import type { ControlTower, AttentionItem, AttentionSeverity } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    PageHeader,
    Card,
    EmptyState,
    Skeleton,
    ErrorNotice,
    Select,
  } from '$lib/components/ui';

  let data = $state<ControlTower | null>(null);
  let loading = $state(true);
  let error = $state('');
  let days = $state('30');

  function fmt(v: number | null, suffix = ''): string {
    if (v === null) return '—';
    return `${v.toLocaleString()}${suffix}`;
  }

  function fmtCurrency(v: number | null): string {
    if (v === null) return '—';
    return v.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
  }

  function severityBorderClass(s: AttentionSeverity): string {
    switch (s) {
      case 'critical': return 'border-l-danger';
      case 'warning':  return 'border-l-warn';
      default:         return 'border-l-border';
    }
  }

  function severityBadgeClass(s: AttentionSeverity): string {
    switch (s) {
      case 'critical': return 'bg-danger/10 text-danger';
      case 'warning':  return 'bg-warn/10 text-warn';
      default:         return 'bg-surface-muted text-ink-muted';
    }
  }

  async function load() {
    loading = true;
    error = '';
    try {
      data = await api<ControlTower>('/analytics/control-tower', { query: { days } });
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement du Control Tower';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void days; // re-run when the window changes
    void load();
  });
</script>

<svelte:head><title>Control Tower — Analytics — Pulsar</title></svelte:head>

<PageHeader
  title="Control Tower"
  subtitle="Vue opérationnelle en direct — points d'attention et KPI calculés à la lecture depuis toutes les sources activées."
>
  {#snippet actions()}
    <div class="w-40">
      <Select bind:value={days}>
        <option value="7">7 derniers jours</option>
        <option value="30">30 derniers jours</option>
        <option value="90">90 derniers jours</option>
      </Select>
    </div>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {#each Array(9) as _, i (i)}<Card><Skeleton rows={2} /></Card>{/each}
  </div>
  <Card padded={false}><Skeleton rows={5} /></Card>
{:else if data}
  <!-- KPI tiles -->
  <div class="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    <Card>
      <div class="text-xs text-ink-faint">Loads en transit</div>
      <div class="mt-1 text-2xl font-bold text-ink">{data.kpis.loadsInTransit}</div>
    </Card>
    <Card>
      <div class="text-xs text-ink-faint">Loads en retard</div>
      <div class={`mt-1 text-2xl font-bold ${data.kpis.loadsLate > 0 ? 'text-danger' : 'text-ink'}`}>
        {data.kpis.loadsLate}
      </div>
    </Card>
    <Card>
      <div class="text-xs text-ink-faint">OTIF ({days} j)</div>
      <div class="mt-1 text-2xl font-bold text-ink">{fmt(data.kpis.otifPct, '%')}</div>
    </Card>
    <Card>
      <div class="text-xs text-ink-faint">Coût moyen / load ({days} j)</div>
      <div class="mt-1 text-2xl font-bold text-ink">{fmtCurrency(data.kpis.avgCostPerLoad)}</div>
    </Card>
    <Card>
      <div class="text-xs text-ink-faint">Montant récupéré ({days} j)</div>
      <div class="mt-1 text-2xl font-bold text-ok">{fmtCurrency(data.kpis.recoveredAmount)}</div>
    </Card>
    <Card>
      <div class="text-xs text-ink-faint">Litiges ouverts</div>
      <div class={`mt-1 text-2xl font-bold ${data.kpis.disputesOpen > 0 ? 'text-warn' : 'text-ink'}`}>
        {data.kpis.disputesOpen}
      </div>
    </Card>
    <Card>
      <div class="text-xs text-ink-faint">Disponibilité flotte</div>
      <div class="mt-1 text-2xl font-bold text-ink">{fmt(data.kpis.fleetAvailabilityPct, '%')}</div>
    </Card>
    <Card>
      <div class="text-xs text-ink-faint">Actions agents en attente</div>
      <div class={`mt-1 text-2xl font-bold ${data.kpis.agentActionsPending > 0 ? 'text-warn' : 'text-ink'}`}>
        {data.kpis.agentActionsPending}
      </div>
      {#if data.kpis.agentActionsPending > 0}
        <div class="mt-1 text-[11px] text-ink-faint">
          <a href="/agent-actions" class="text-accent hover:underline">Approuver →</a>
        </div>
      {/if}
    </Card>
    <Card>
      <div class="text-xs text-ink-faint">Tâches ouvertes</div>
      <div class={`mt-1 text-2xl font-bold ${data.kpis.tasksOpen > 0 ? 'text-ink' : 'text-ok'}`}>
        {data.kpis.tasksOpen}
      </div>
      {#if data.kpis.tasksOpen > 0}
        <div class="mt-1 text-[11px] text-ink-faint">
          <a href="/workbench" class="text-accent hover:underline">Workbench →</a>
        </div>
      {/if}
    </Card>
  </div>

  <!-- Attention panel -->
  <div class="mb-2 flex items-center justify-between">
    <h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">Points d'attention</h2>
    {#if data.attention.length > 0}
      <span class="text-xs text-ink-faint">{data.attention.length} élément{data.attention.length > 1 ? 's' : ''}</span>
    {/if}
  </div>

  {#if data.attention.length === 0}
    <Card>
      <EmptyState
        title="Rien ne requiert votre attention"
        message="Toutes les opérations sont dans les normes. Revenez plus tard ou ajustez la fenêtre temporelle."
      />
    </Card>
  {:else}
    <div class="flex flex-col gap-2">
      {#each data.attention as item (item.kind + (item.ref ?? ''))}
        <div class={`rounded-lg border border-l-4 bg-surface px-4 py-3 ${severityBorderClass(item.severity)}`}>
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${severityBadgeClass(item.severity)}`}>
                  {item.severity}
                </span>
                {#if item.href}
                  <a href={item.href} class="truncate text-sm font-medium text-ink hover:underline">
                    {item.label}
                  </a>
                {:else}
                  <span class="truncate text-sm font-medium text-ink">{item.label}</span>
                {/if}
              </div>
              {#if item.at}
                <div class="mt-0.5 text-[11px] text-ink-faint">
                  {new Date(item.at).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
              {/if}
            </div>
            {#if item.href}
              <a href={item.href} class="shrink-0 text-xs text-accent hover:underline">Voir →</a>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
{/if}
