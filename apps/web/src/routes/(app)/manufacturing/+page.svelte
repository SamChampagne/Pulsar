<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { Card, PageHeader, Skeleton } from '$lib/components/ui';
  import AgentPanel from '$lib/components/AgentPanel.svelte';
  import { Factory, CalendarClock, Workflow, Boxes, ClipboardList, GanttChartSquare } from 'lucide-svelte';

  interface Counts {
    workCenters: number;
    calendars: number;
    routings: number;
    boms: number;
    orders: number;
    activeOrders: number;
  }

  let counts = $state<Counts | null>(null);
  let lastRun = $state<{ id: string; strategy: string; solverStatus: string; createdAt: string; assignmentCount: number; isBaseline: boolean } | null>(null);
  let loading = $state(true);

  async function load() {
    loading = true;
    try {
      const [wc, cal, rt, bom, orders, active, runs] = await Promise.all([
        api<Paginated<unknown>>('/manufacturing/work-centers', { query: { pageSize: 1 } }),
        api<Paginated<unknown>>('/manufacturing/calendars', { query: { pageSize: 1 } }),
        api<Paginated<unknown>>('/manufacturing/routings', { query: { pageSize: 1 } }),
        api<Paginated<unknown>>('/manufacturing/boms', { query: { pageSize: 1 } }),
        api<Paginated<unknown>>('/manufacturing/orders', { query: { pageSize: 1 } }),
        api<Paginated<unknown>>('/manufacturing/orders', { query: { pageSize: 1, status: 'RELEASED' } }),
        api<Paginated<typeof lastRun & object>>('/manufacturing/scheduling/runs', { query: { pageSize: 1 } }),
      ]);
      counts = {
        workCenters: wc.total,
        calendars: cal.total,
        routings: rt.total,
        boms: bom.total,
        orders: orders.total,
        activeOrders: active.total,
      };
      lastRun = runs.items[0] ?? null;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  const tiles = [
    { href: '/manufacturing/scheduling', label: 'Planification (Gantt)', desc: 'Lancer et visualiser un ordonnancement APS', icon: GanttChartSquare, accent: true },
    { href: '/manufacturing/orders', label: 'Ordres de fabrication', desc: 'Demande de production et cycle de vie', icon: ClipboardList },
    { href: '/manufacturing/work-centers', label: 'Postes de charge', desc: 'Ressources de production', icon: Factory },
    { href: '/manufacturing/calendars', label: 'Calendriers', desc: 'Quarts et heures ouvrées', icon: CalendarClock },
    { href: '/manufacturing/routings', label: 'Gammes', desc: 'Séquences d’opérations par produit', icon: Workflow },
    { href: '/manufacturing/boms', label: 'Nomenclatures', desc: 'Matières par produit', icon: Boxes },
  ];
</script>

<PageHeader title="Fabrication" eyebrow="Manufacturing / APS" />

{#if loading}
  <Card><Skeleton rows={4} /></Card>
{:else}
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
    {#each [
      { label: 'Postes', value: counts?.workCenters ?? 0 },
      { label: 'Calendriers', value: counts?.calendars ?? 0 },
      { label: 'Gammes', value: counts?.routings ?? 0 },
      { label: 'Nomenclatures', value: counts?.boms ?? 0 },
      { label: 'Ordres', value: counts?.orders ?? 0 },
      { label: 'À planifier', value: counts?.activeOrders ?? 0 },
    ] as stat (stat.label)}
      <Card>
        <div class="text-2xl font-semibold text-ink">{stat.value}</div>
        <div class="text-xs text-ink-muted">{stat.label}</div>
      </Card>
    {/each}
  </div>

  <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {#each tiles as t (t.href)}
      <a href={t.href} class="block">
        <Card>
          <div class="flex items-start gap-3">
            <div class="rounded-lg border border-edge p-2 {t.accent ? 'bg-accent/10 text-accent' : 'text-ink-muted'}">
              <t.icon size={20} />
            </div>
            <div class="min-w-0">
              <div class="font-medium text-ink">{t.label}</div>
              <div class="text-sm text-ink-muted">{t.desc}</div>
            </div>
          </div>
        </Card>
      </a>
    {/each}
  </div>

  {#if lastRun}
    <div class="mt-4">
      <Card>
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-xs text-ink-muted">Dernière planification</div>
            <div class="text-sm text-ink">
              {lastRun.strategy} · {lastRun.solverStatus} · {lastRun.assignmentCount} affectations
              {#if lastRun.isBaseline}· <span class="text-accent">baseline</span>{/if}
            </div>
          </div>
          <a href="/manufacturing/scheduling" class="text-sm text-accent hover:underline">Ouvrir le Gantt →</a>
        </div>
      </Card>
    </div>
  {/if}

  <div class="mt-6">
    <h2 class="mb-2 text-sm font-semibold text-ink">Planificateur de production IA</h2>
    <div class="h-[480px]">
      <AgentPanel
        presetId="production-planner"
        title="Planificateur de production IA"
        intro="Demandez l'état des ordres de fabrication, la charge des postes ou un ajustement de plan — l'agent propose, vous approuvez."
      />
    </div>
  </div>
{/if}
