<script lang="ts">
  // Planning Runs — versioned plan comparison (first slice of Continuous Planning).
  // Lists the APS scheduling runs and diffs two of them: which operations moved
  // work center or start time, which were added/removed. Read-only over the
  // existing SchedulingRun history — no new model, no migration.
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api/client';
  import type { Paginated } from '@pulsar/shared';
  import {
    PageHeader,
    Card,
    Badge,
    Button,
    EmptyState,
    ErrorNotice,
    Select,
    Skeleton,
  } from '$lib/components/ui';

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
    assignmentCount: number;
    isBaseline: boolean;
    createdAt: string;
    assignments?: Assignment[];
  }
  interface Order {
    id: string;
    number: string;
  }
  interface WorkCenter {
    id: string;
    name: string;
  }

  let runs = $state<Run[]>([]);
  let wcName = $state<Record<string, string>>({});
  let orderNum = $state<Record<string, string>>({});
  let loading = $state(true);
  let error = $state('');

  let aId = $state<string | undefined>(undefined);
  let bId = $state<string | undefined>(undefined);
  let runA = $state<Run | null>(null);
  let runB = $state<Run | null>(null);
  let loadingDetail = $state(false);

  function fmtDateTime(iso: string): string {
    return new Date(iso).toLocaleString('fr-CA', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  function fmtDelta(min: number): string {
    const s = min > 0 ? '+' : '';
    if (Math.abs(min) >= 60) return `${s}${(min / 60).toFixed(1)} h`;
    return `${s}${min} min`;
  }
  function runLabel(r: Run): string {
    return `${fmtDateTime(r.createdAt)} · ${r.strategy} · ${r.solverStatus}${r.isBaseline ? ' · baseline' : ''}`;
  }
  function makespanMin(r: Run | null): number {
    const a = r?.assignments ?? [];
    if (a.length === 0) return 0;
    const starts = a.map((x) => new Date(x.start).getTime());
    const ends = a.map((x) => new Date(x.end).getTime());
    return Math.round((Math.max(...ends) - Math.min(...starts)) / 60000);
  }
  function fmtMakespan(min: number): string {
    if (min <= 0) return '—';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h} h ${m.toString().padStart(2, '0')}` : `${m} min`;
  }

  interface DiffRow {
    operationId: string;
    orderLabel: string;
    kind: 'MOVED_CENTER' | 'MOVED_TIME' | 'MOVED_BOTH' | 'ADDED' | 'REMOVED';
    fromCenter?: string;
    toCenter?: string;
    fromStart?: string;
    toStart?: string;
    deltaMin?: number;
  }

  const diff = $derived.by<DiffRow[]>(() => {
    if (!runA || !runB) return [];
    const aMap = new Map((runA.assignments ?? []).map((x) => [x.operationId, x]));
    const bMap = new Map((runB.assignments ?? []).map((x) => [x.operationId, x]));
    const opIds = new Set([...aMap.keys(), ...bMap.keys()]);
    const rows: DiffRow[] = [];
    for (const opId of opIds) {
      const a = aMap.get(opId);
      const b = bMap.get(opId);
      const orderLabel = orderNum[b?.orderId ?? a?.orderId ?? ''] ?? '—';
      if (a && !b) {
        rows.push({ operationId: opId, orderLabel, kind: 'REMOVED', fromCenter: wcName[a.workCenterId] ?? a.workCenterId, fromStart: a.start });
      } else if (!a && b) {
        rows.push({ operationId: opId, orderLabel, kind: 'ADDED', toCenter: wcName[b.workCenterId] ?? b.workCenterId, toStart: b.start });
      } else if (a && b) {
        const centerMoved = a.workCenterId !== b.workCenterId;
        const deltaMin = Math.round((new Date(b.start).getTime() - new Date(a.start).getTime()) / 60000);
        const timeMoved = deltaMin !== 0;
        if (!centerMoved && !timeMoved) continue; // unchanged
        rows.push({
          operationId: opId,
          orderLabel,
          kind: centerMoved && timeMoved ? 'MOVED_BOTH' : centerMoved ? 'MOVED_CENTER' : 'MOVED_TIME',
          fromCenter: wcName[a.workCenterId] ?? a.workCenterId,
          toCenter: wcName[b.workCenterId] ?? b.workCenterId,
          fromStart: a.start,
          toStart: b.start,
          deltaMin,
        });
      }
    }
    // Most-changed first: BOTH, CENTER, TIME, then ADDED/REMOVED
    const rank = { MOVED_BOTH: 0, MOVED_CENTER: 1, MOVED_TIME: 2, ADDED: 3, REMOVED: 4 };
    return rows.sort((x, y) => rank[x.kind] - rank[y.kind]);
  });

  const movedCount = $derived(diff.filter((d) => d.kind.startsWith('MOVED')).length);
  const addedCount = $derived(diff.filter((d) => d.kind === 'ADDED').length);
  const removedCount = $derived(diff.filter((d) => d.kind === 'REMOVED').length);

  function kindTone(k: DiffRow['kind']): 'info' | 'warn' | 'ok' | 'danger' {
    if (k === 'ADDED') return 'ok';
    if (k === 'REMOVED') return 'danger';
    return 'warn';
  }
  function kindLabel(k: DiffRow['kind']): string {
    return {
      MOVED_BOTH: 'Poste + horaire',
      MOVED_CENTER: 'Poste',
      MOVED_TIME: 'Horaire',
      ADDED: 'Ajoutée',
      REMOVED: 'Retirée',
    }[k];
  }

  async function fetchRun(id: string): Promise<Run> {
    return api<Run>(`/manufacturing/scheduling/runs/${id}`);
  }

  async function loadPair() {
    if (!aId || !bId) return;
    loadingDetail = true;
    error = '';
    try {
      const [a, b] = await Promise.all([fetchRun(aId), fetchRun(bId)]);
      runA = a;
      runB = b;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Chargement des plans impossible.';
    } finally {
      loadingDetail = false;
    }
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const [runRes, wcRes, orderRes] = await Promise.all([
        api<Paginated<Run>>('/manufacturing/scheduling/runs', { query: { pageSize: 50 } }),
        api<Paginated<WorkCenter>>('/manufacturing/work-centers', { query: { pageSize: 100 } }),
        api<Paginated<Order>>('/manufacturing/orders', { query: { pageSize: 100 } }),
      ]);
      runs = runRes.items;
      wcName = Object.fromEntries(wcRes.items.map((w) => [w.id, w.name]));
      orderNum = Object.fromEntries(orderRes.items.map((o) => [o.id, o.number]));
      // Default: B = latest run, A = baseline if any else the next most recent.
      if (runs.length >= 1) bId = runs[0].id;
      if (runs.length >= 2) aId = (runs.find((r) => r.isBaseline) ?? runs[1]).id;
      if (aId === bId && runs.length >= 2) aId = runs[1].id;
      if (aId && bId) await loadPair();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Chargement des runs impossible.';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<PageHeader
  title="Planning Runs"
  eyebrow="Manufacturing / APS"
  subtitle="Comparez deux plans d’ordonnancement et voyez ce qui a bougé entre deux exécutions."
  count={runs.length}
>
  {#snippet actions()}
    <Button variant="secondary" href="/manufacturing/scheduling">Ouvrir le Gantt</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <Card><Skeleton /></Card>
{:else if runs.length < 2}
  <Card>
    <EmptyState
      title="Pas assez de plans à comparer"
      message="Lancez au moins deux ordonnancements pour visualiser ce qui change d’un plan à l’autre."
    >
      {#snippet children()}
        <Button href="/manufacturing/scheduling">Lancer une planification</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Card>
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="text-sm">
        <span class="mb-1 block text-xs font-semibold text-ink-muted">Plan A (référence)</span>
        <Select bind:value={aId} onchange={loadPair}>
          {#each runs as r (r.id)}
            <option value={r.id}>{runLabel(r)}</option>
          {/each}
        </Select>
      </label>
      <label class="text-sm">
        <span class="mb-1 block text-xs font-semibold text-ink-muted">Plan B (comparé)</span>
        <Select bind:value={bId} onchange={loadPair}>
          {#each runs as r (r.id)}
            <option value={r.id}>{runLabel(r)}</option>
          {/each}
        </Select>
      </label>
    </div>
  </Card>

  {#if loadingDetail}
    <Card><Skeleton /></Card>
  {:else if runA && runB}
    <div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Card>
        <p class="text-xs text-ink-muted">Objectif</p>
        <p class="mt-1 text-lg font-semibold text-ink">{runA.objectiveValue} → {runB.objectiveValue}</p>
      </Card>
      <Card>
        <p class="text-xs text-ink-muted">Makespan</p>
        <p class="mt-1 text-lg font-semibold text-ink">
          {fmtMakespan(makespanMin(runA))} → {fmtMakespan(makespanMin(runB))}
        </p>
      </Card>
      <Card>
        <p class="text-xs text-ink-muted">Affectations</p>
        <p class="mt-1 text-lg font-semibold text-ink">{runA.assignmentCount} → {runB.assignmentCount}</p>
      </Card>
      <Card>
        <p class="text-xs text-ink-muted">Opérations déplacées</p>
        <p class="mt-1 text-2xl font-semibold {movedCount > 0 ? 'text-accent' : 'text-ink'}">{movedCount}</p>
      </Card>
      <Card>
        <p class="text-xs text-ink-muted">Ajoutées / retirées</p>
        <p class="mt-1 text-2xl font-semibold text-ink">{addedCount} / {removedCount}</p>
      </Card>
    </div>

    <div class="mt-4">
      <h2 class="mb-2 text-sm font-semibold text-ink">Changements (A → B)</h2>
      {#if diff.length === 0}
        <Card>
          <EmptyState
            title="Plans identiques"
            message="Aucune opération n’a changé de poste ou d’horaire entre ces deux plans."
          />
        </Card>
      {:else}
        <Card padded={false}>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-edge-soft text-left text-xs text-ink-muted">
                  <th class="px-4 py-2">Ordre</th>
                  <th class="px-4 py-2">Changement</th>
                  <th class="px-4 py-2">Poste (A → B)</th>
                  <th class="px-4 py-2">Début (A → B)</th>
                  <th class="px-4 py-2">Décalage</th>
                </tr>
              </thead>
              <tbody>
                {#each diff as d (d.operationId)}
                  <tr class="border-b border-edge-soft last:border-0">
                    <td class="px-4 py-2 font-medium text-ink">{d.orderLabel}</td>
                    <td class="px-4 py-2"><Badge tone={kindTone(d.kind)}>{kindLabel(d.kind)}</Badge></td>
                    <td class="px-4 py-2 text-ink-muted">
                      {#if d.kind === 'ADDED'}— → {d.toCenter}
                      {:else if d.kind === 'REMOVED'}{d.fromCenter} → —
                      {:else if d.fromCenter !== d.toCenter}{d.fromCenter} → {d.toCenter}
                      {:else}{d.toCenter}{/if}
                    </td>
                    <td class="px-4 py-2 text-ink-muted">
                      {#if d.fromStart && d.toStart}{fmtDateTime(d.fromStart)} → {fmtDateTime(d.toStart)}
                      {:else if d.toStart}{fmtDateTime(d.toStart)}
                      {:else if d.fromStart}{fmtDateTime(d.fromStart)}{/if}
                    </td>
                    <td class="px-4 py-2 {d.deltaMin ? 'text-accent' : 'text-ink-faint'}">
                      {d.deltaMin ? fmtDelta(d.deltaMin) : '—'}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </Card>
      {/if}
    </div>
  {/if}
{/if}
