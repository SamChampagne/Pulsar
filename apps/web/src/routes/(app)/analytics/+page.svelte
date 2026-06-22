<script lang="ts">
  import type { ControlTower } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { PageHeader, Card, Skeleton, ErrorNotice, Select } from '$lib/components/ui';
  import { BarChart3, Gauge, Truck, Workflow, ArrowRight } from 'lucide-svelte';

  let data = $state<ControlTower | null>(null);
  let loading = $state(true);
  let error = $state('');
  let days = $state('30');

  const canSeeCarriers = $derived(
    $auth?.user.permissions.includes('transportation.analytics.read') ?? false,
  );

  function fmt(v: number | null, suffix = ''): string {
    if (v === null) return '—';
    return `${v.toLocaleString()}${suffix}`;
  }

  function fmtCurrency(v: number | null): string {
    if (v === null) return '—';
    return v.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
  }

  async function load() {
    loading = true;
    error = '';
    try {
      data = await api<ControlTower>('/analytics/control-tower', { query: { days } });
    } catch (e) {
      error = e instanceof ApiError ? e.message : "Échec du chargement de l'aperçu Analytics";
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void days; // re-run when the window changes
    void load();
  });

  const cards = $derived([
    {
      href: '/analytics/control-tower',
      label: 'Control Tower',
      desc: "Points d'attention en direct et KPI opérationnels cross-module.",
      icon: Gauge,
      show: true,
    },
    {
      href: '/analytics/scorecards',
      label: 'Scorecards',
      desc: 'Disponibilité flotte, congestion cour, préparation entrepôt, exceptions et ROI agents.',
      icon: BarChart3,
      show: true,
    },
    {
      href: '/analytics/flow',
      label: 'Flux',
      desc: 'Chaînes événement → tâches → actions cross-module — timeline, tracé entité et carte de flux.',
      icon: Workflow,
      show: true,
    },
    {
      href: '/analytics/carriers',
      label: 'Scorecard transporteurs',
      desc: 'Acceptation, ponctualité, exposition et dépense estimée par transporteur.',
      icon: Truck,
      show: canSeeCarriers,
    },
  ].filter((c) => c.show));
</script>

<svelte:head><title>Analytics — Pulsar</title></svelte:head>

<PageHeader
  title="Analytics"
  subtitle="Le pouls opérationnel de votre tenant — KPI cross-module calculés à la lecture, et accès direct aux tableaux détaillés."
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

<!-- Headline KPIs -->
{#if loading}
  <div class="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {#each Array(4) as _, i (i)}<Card><Skeleton rows={2} /></Card>{/each}
  </div>
{:else if data}
  <div class="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
      <div class="text-xs text-ink-faint">Montant récupéré ({days} j)</div>
      <div class="mt-1 text-2xl font-bold text-ok">{fmtCurrency(data.kpis.recoveredAmount)}</div>
    </Card>
  </div>

  {#if data.attention.length > 0}
    <div class="mb-6">
      <a
        href="/analytics/control-tower"
        class="flex items-center justify-between gap-3 rounded-lg border border-l-4 border-l-warn bg-surface px-4 py-3 transition hover:bg-surface-muted"
      >
        <div class="min-w-0">
          <div class="text-sm font-semibold text-ink">
            {data.attention.length} point{data.attention.length > 1 ? 's' : ''} d'attention
          </div>
          <div class="truncate text-xs text-ink-muted">{data.attention[0].label}</div>
        </div>
        <span class="shrink-0 text-xs text-accent">Control Tower →</span>
      </a>
    </div>
  {/if}
{/if}

<!-- Navigation cards -->
<h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">Tableaux</h2>
<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
  {#each cards as c (c.href)}
    {@const Icon = c.icon}
    <a href={c.href} class="group block">
      <Card>
        <div class="flex items-start gap-3">
          <div class="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <Icon class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold text-ink">{c.label}</span>
              <ArrowRight class="size-4 shrink-0 text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-accent" />
            </div>
            <p class="mt-1 text-xs text-ink-muted">{c.desc}</p>
          </div>
        </div>
      </Card>
    </a>
  {/each}
</div>
