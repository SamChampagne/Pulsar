<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    Field,
    PageHeader,
    Select,
    Skeleton,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface Assignment {
    id: string;
    operationId: string;
    orderId: string;
    workCenterId: string;
    setupStart: string;
    start: string;
    end: string;
  }
  interface Run {
    id: string;
    strategy: string;
    solverStatus: string;
    objectiveValue: number;
    wallTimeMs: number;
    orderCount: number;
    operationCount: number;
    assignmentCount: number;
    isBaseline: boolean;
    warnings: string[];
    createdAt: string;
    assignments?: Assignment[];
  }
  interface WorkCenter {
    id: string;
    code: string;
    name: string;
  }

  let runs = $state<Run[]>([]);
  let selected = $state<Run | null>(null);
  let workCenters = $state<WorkCenter[]>([]);
  let orderNumbers = $state<Record<string, string>>({});
  let opNames = $state<Record<string, string>>({});
  let loading = $state(true);
  let running = $state(false);
  let error = $state('');

  // Run controls
  let strategy = $state('greedy');
  let horizonDays = $state('30');

  const PALETTE = ['#2563eb', '#16a34a', '#db2777', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#65a30d'];
  function orderColor(orderId: string): string {
    let h = 0;
    for (let i = 0; i < orderId.length; i++) h = (h * 31 + orderId.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  const wcName = $derived(new Map(workCenters.map((w) => [w.id, w.name])));

  async function loadRuns() {
    loading = true;
    error = '';
    try {
      const [runRes, wcRes] = await Promise.all([
        api<Paginated<Run>>('/manufacturing/scheduling/runs', { query: { pageSize: 50 } }),
        api<Paginated<WorkCenter>>('/manufacturing/work-centers', { query: { pageSize: 200 } }),
      ]);
      runs = runRes.items;
      workCenters = wcRes.items;
      if (runs.length > 0 && !selected) await select(runs[0].id);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  async function select(id: string) {
    const run = await api<Run>(`/manufacturing/scheduling/runs/${id}`);
    selected = run;
    // Enrich labels: order numbers + operation names from the involved orders.
    const orderIds = [...new Set((run.assignments ?? []).map((a) => a.orderId))];
    const details = await Promise.all(
      orderIds.map((oid) =>
        api<{ id: string; number: string; operations: { id: string; name: string }[] }>(
          `/manufacturing/orders/${oid}`,
        ).catch(() => null),
      ),
    );
    const nums: Record<string, string> = {};
    const names: Record<string, string> = {};
    for (const d of details) {
      if (!d) continue;
      nums[d.id] = d.number;
      for (const op of d.operations) names[op.id] = op.name;
    }
    orderNumbers = nums;
    opNames = names;
  }

  async function runSchedule() {
    running = true;
    try {
      const run = await api<Run>('/manufacturing/scheduling/run', {
        method: 'POST',
        body: { strategy, horizonDays: Number(horizonDays) || 30 },
      });
      toast.success(`Planification ${run.solverStatus} — ${run.assignmentCount} affectations`);
      selected = null;
      await loadRuns();
      await select(run.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la planification');
    } finally {
      running = false;
    }
  }

  async function publish() {
    if (!selected) return;
    try {
      await api(`/manufacturing/scheduling/runs/${selected.id}/publish`, { method: 'POST' });
      toast.success('Run publié comme baseline');
      await loadRuns();
      await select(selected.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la publication');
    }
  }

  $effect(() => {
    void loadRuns();
  });

  // --- Gantt geometry --------------------------------------------------------
  interface Bar {
    a: Assignment;
    leftPct: number;
    widthPct: number;
    color: string;
    label: string;
    title: string;
  }
  interface Tick {
    leftPct: number;
    label: string;
  }

  const fmt = new Intl.DateTimeFormat('fr-CA', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const fmtTime = new Intl.DateTimeFormat('fr-CA', { hour: '2-digit', minute: '2-digit' });

  const gantt = $derived.by(() => {
    const a = selected?.assignments ?? [];
    if (a.length === 0) return { rows: [] as { wcId: string; name: string; bars: Bar[] }[], ticks: [] as Tick[], empty: true };
    const startMs = Math.min(...a.map((x) => new Date(x.start).getTime()));
    const endMs = Math.max(...a.map((x) => new Date(x.end).getTime()));
    const span = Math.max(endMs - startMs, 60_000);
    const pct = (ms: number) => ((ms - startMs) / span) * 100;

    // Rows: work centers that carry assignments, ordered by name.
    const wcIds = [...new Set(a.map((x) => x.workCenterId))];
    const rows = wcIds
      .map((wcId) => ({
        wcId,
        name: wcName.get(wcId) ?? wcId,
        bars: a
          .filter((x) => x.workCenterId === wcId)
          .map((x): Bar => {
            const s = new Date(x.start).getTime();
            const e = new Date(x.end).getTime();
            const num = orderNumbers[x.orderId] ?? '';
            const op = opNames[x.operationId] ?? 'Opération';
            return {
              a: x,
              leftPct: pct(s),
              widthPct: Math.max(((e - s) / span) * 100, 0.8),
              color: orderColor(x.orderId),
              label: op,
              title: `${num} · ${op}\n${wcName.get(wcId) ?? wcId}\n${fmtTime.format(new Date(x.start))} → ${fmtTime.format(new Date(x.end))}`,
            };
          }),
      }))
      .sort((p, q) => p.name.localeCompare(q.name));

    // Ticks: one per day boundary within the window.
    const ticks: Tick[] = [];
    const d = new Date(startMs);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 1);
    while (d.getTime() < endMs) {
      ticks.push({ leftPct: pct(d.getTime()), label: fmt.format(d) });
      d.setDate(d.getDate() + 1);
    }
    return { rows, ticks, empty: false };
  });

  const STRATEGIES = ['greedy', 'backward', 'hybrid', 'cpsat', 'auto'];
</script>

<PageHeader title="Planification" eyebrow="Manufacturing / APS">
  {#snippet actions()}
    <a href="/manufacturing" class="text-sm text-accent hover:underline">← Fabrication</a>
  {/snippet}
</PageHeader>

<Card>
  <div class="flex flex-wrap items-end gap-3">
    <Field label="Stratégie">
      <Select bind:value={strategy}>
        {#each STRATEGIES as s (s)}<option value={s}>{s}</option>{/each}
      </Select>
    </Field>
    <Field label="Horizon (jours)">
      <input
        type="number"
        min="1"
        bind:value={horizonDays}
        class="w-28 rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
      />
    </Field>
    <Button variant="primary" loading={running} onclick={runSchedule}>Lancer une planification</Button>
    {#if selected && !selected.isBaseline}
      <Button variant="secondary" onclick={publish}>Publier comme baseline</Button>
    {/if}
  </div>
</Card>

{#if loading}
  <Card><Skeleton rows={6} /></Card>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else if runs.length === 0}
  <Card>
    <EmptyState message="Aucune planification pour le moment. Libérez un ordre de fabrication puis lancez une planification.">
      {#snippet children()}
        <Button variant="primary" loading={running} onclick={runSchedule}>Lancer une planification</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[18rem_1fr]">
    <!-- Runs list -->
    <Card padded={false}>
      <div class="border-b border-edge px-3 py-2 text-xs font-medium text-ink-muted">Historique des runs</div>
      <ul class="max-h-[28rem] overflow-y-auto">
        {#each runs as r (r.id)}
          <li>
            <button
              class="w-full border-b border-edge px-3 py-2 text-left hover:bg-surface-muted {selected?.id === r.id ? 'bg-accent/5' : ''}"
              onclick={() => select(r.id)}
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm text-ink">{new Date(r.createdAt).toLocaleString('fr-CA')}</span>
                {#if r.isBaseline}<Badge tone="ok">baseline</Badge>{/if}
              </div>
              <div class="text-xs text-ink-muted">
                {r.strategy} · {r.solverStatus} · {r.assignmentCount} aff.
              </div>
            </button>
          </li>
        {/each}
      </ul>
    </Card>

    <!-- Gantt -->
    <Card>
      {#if !selected}
        <p class="text-sm text-ink-muted">Sélectionnez un run.</p>
      {:else}
        <div class="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={selected.solverStatus.toLowerCase().includes('optimal') ? 'ok' : 'info'}>
            {selected.solverStatus}
          </Badge>
          <span class="text-ink-muted">stratégie <span class="text-ink">{selected.strategy}</span></span>
          <span class="text-ink-muted">objectif <span class="text-ink">{selected.objectiveValue}</span></span>
          <span class="text-ink-muted">{selected.wallTimeMs} ms</span>
          <span class="text-ink-muted">{selected.assignmentCount} affectations</span>
          {#if selected.isBaseline}<Badge tone="ok">baseline</Badge>{/if}
        </div>

        {#if selected.warnings?.length}
          <div class="mb-3 rounded-md border border-warn/40 bg-warn/10 p-2 text-xs text-ink-muted">
            {#each selected.warnings as w (w)}<div>⚠ {w}</div>{/each}
          </div>
        {/if}

        {#if gantt.empty}
          <p class="text-sm text-ink-muted">Ce run n’a aucune affectation (aucune demande planifiable).</p>
        {:else}
          <div class="overflow-x-auto">
            <div class="min-w-[48rem]">
              <!-- time axis -->
              <div class="relative ml-40 h-5 border-b border-edge">
                {#each gantt.ticks as t (t.label)}
                  <div class="absolute top-0 h-full border-l border-edge/60" style="left:{t.leftPct}%">
                    <span class="ml-1 text-[10px] text-ink-faint">{t.label}</span>
                  </div>
                {/each}
              </div>
              <!-- rows -->
              {#each gantt.rows as row (row.wcId)}
                <div class="flex items-stretch border-b border-edge/50">
                  <div class="w-40 shrink-0 py-2 pr-2 text-sm text-ink">{row.name}</div>
                  <div class="relative my-1 h-8 flex-1">
                    {#each row.bars as bar (bar.a.id)}
                      <div
                        class="absolute top-0 flex h-8 items-center overflow-hidden rounded px-1.5 text-[11px] font-medium text-white shadow-sm"
                        style="left:{bar.leftPct}%; width:{bar.widthPct}%; background:{bar.color}"
                        title={bar.title}
                      >
                        <span class="truncate">{bar.label}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>
          <!-- legend -->
          <div class="mt-3 flex flex-wrap gap-3 text-xs text-ink-muted">
            {#each [...new Set((selected.assignments ?? []).map((a) => a.orderId))] as oid (oid)}
              <span class="inline-flex items-center gap-1">
                <span class="inline-block h-3 w-3 rounded" style="background:{orderColor(oid)}"></span>
                {orderNumbers[oid] ?? oid.slice(0, 8)}
              </span>
            {/each}
          </div>
        {/if}
      {/if}
    </Card>
  </div>
{/if}
