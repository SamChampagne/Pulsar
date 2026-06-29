<script lang="ts">
  // Load Control Room — deep operational tool for Transport.
  // Real-time control of loads in flight: live map + status board + exception
  // banner + cost, with the dispatcher AI employee present in the right rail.
  // Reads GET /transportation/loads/active-map (no rollup) and polls while the
  // tab is visible. The agent proposes; the operator approves inline (AgentPanel).
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import {
    PageHeader,
    Card,
    Badge,
    ErrorNotice,
    EmptyState,
    Button,
    ViewToggle,
    toneFor,
    labelFor,
    type ViewId,
  } from '$lib/components/ui';
  import OpsMap from '$lib/components/OpsMap.svelte';
  import AgentPanel from '$lib/components/AgentPanel.svelte';

  interface MapStop {
    sequence: number;
    type: string;
    status: string;
    name: string;
    city: string;
    latitude: number | null;
    longitude: number | null;
  }
  interface MapLoad {
    id: string;
    loadNumber: string;
    status: string;
    carrier: string | null;
    isLate: boolean;
    lastPosition: { latitude: number; longitude: number; occurredAt: string } | null;
    stops: MapStop[];
  }

  let loads = $state<MapLoad[]>([]);
  let loading = $state(true);
  let error = $state('');
  let view = $state<ViewId>('kanban');

  // Columns in operational order; only those with loads render.
  const COLUMN_ORDER = ['PLANNED', 'DISPATCHED', 'IN_TRANSIT', 'COMPLETED'];

  const total = $derived(loads.length);
  const lateCount = $derived(loads.filter((l) => l.isLate).length);
  const inTransit = $derived(loads.filter((l) => l.status === 'IN_TRANSIT').length);
  const dispatched = $derived(loads.filter((l) => l.status === 'DISPATCHED').length);
  const planned = $derived(loads.filter((l) => l.status === 'PLANNED').length);

  const columns = $derived(
    [...new Set([...COLUMN_ORDER, ...loads.map((l) => l.status)])]
      .map((status) => ({ status, items: loads.filter((l) => l.status === status) }))
      .filter((c) => c.items.length > 0),
  );

  function routeLabel(l: MapLoad): string {
    if (l.stops.length === 0) return '—';
    const origin = l.stops[0]?.city || l.stops[0]?.name || '?';
    const dest = l.stops[l.stops.length - 1]?.city || l.stops[l.stops.length - 1]?.name || '?';
    return `${origin} → ${dest}`;
  }

  function nextStop(l: MapLoad): MapStop | null {
    return l.stops.find((s) => s.status !== 'COMPLETED' && s.status !== 'DEPARTED') ?? null;
  }

  async function load() {
    loading = true;
    error = '';
    try {
      loads = await api<MapLoad[]>('/transportation/loads/active-map');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Chargement de la salle de contrôle impossible.';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 45_000);
    return () => clearInterval(timer);
  });
</script>

<PageHeader
  title="Load Control Room"
  eyebrow="Transport"
  subtitle="Surveillez les chargements en vol, repérez les retards et agissez sans quitter l’écran."
  count={total}
>
  {#snippet actions()}
    <ViewToggle bind:view views={['kanban', 'map']} />
    <Button variant="secondary" onclick={load}>Rafraîchir</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

<div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
  <Card>
    <p class="text-xs text-ink-muted">En vol</p>
    <p class="mt-1 text-2xl font-semibold text-ink">{total}</p>
  </Card>
  <Card>
    <p class="text-xs text-ink-muted">En transit</p>
    <p class="mt-1 text-2xl font-semibold text-ink">{inTransit}</p>
  </Card>
  <Card>
    <p class="text-xs text-ink-muted">Dispatchés</p>
    <p class="mt-1 text-2xl font-semibold text-ink">{dispatched}</p>
  </Card>
  <Card>
    <p class="text-xs text-ink-muted">Planifiés</p>
    <p class="mt-1 text-2xl font-semibold text-ink">{planned}</p>
  </Card>
  <Card>
    <p class="text-xs text-ink-muted">En retard</p>
    <p class="mt-1 text-2xl font-semibold {lateCount > 0 ? 'text-danger' : 'text-ink'}">{lateCount}</p>
  </Card>
</div>

{#if lateCount > 0}
  <div class="mb-4 rounded-card border border-danger-soft bg-danger-soft px-4 py-2 text-sm text-danger">
    ⚠ {lateCount} chargement(s) en retard — priorisez le triage et l’escalade à l’agent.
  </div>
{/if}

<div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
  <div class="min-w-0">
    {#if loading && loads.length === 0}
      <Card><p class="text-sm text-ink-muted">Chargement…</p></Card>
    {:else if loads.length === 0}
      <Card>
        <EmptyState
          title="Aucun chargement en vol"
          message="Les chargements dispatchés et en transit apparaîtront ici. Planifiez du fret depuis le Dispatch Cockpit."
        >
          {#snippet children()}
            <Button onclick={() => goto('/dispatch')}>Aller au Dispatch</Button>
          {/snippet}
        </EmptyState>
      </Card>
    {:else if view === 'map'}
      <div class="h-[600px] overflow-hidden rounded-card border border-edge">
        <OpsMap {loads} />
      </div>
    {:else}
      <!-- Kanban by status -->
      <div class="flex gap-3 overflow-x-auto pb-2">
        {#each columns as col (col.status)}
          <div class="w-72 shrink-0">
            <div class="mb-2 flex items-center justify-between">
              <Badge tone={toneFor(col.status)}>{labelFor(col.status)}</Badge>
              <span class="text-xs text-ink-muted">{col.items.length}</span>
            </div>
            <div class="flex flex-col gap-2">
              {#each col.items as l (l.id)}
                <button
                  type="button"
                  onclick={() => goto(`/loads/${l.id}`)}
                  class="w-full rounded-card border bg-surface p-3 text-left transition hover:border-accent {l.isLate
                    ? 'border-danger-soft'
                    : 'border-edge'}"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm font-semibold text-ink">{l.loadNumber}</span>
                    {#if l.isLate}<Badge tone="danger">Retard</Badge>{/if}
                  </div>
                  <p class="mt-1 truncate text-xs text-ink-muted">{routeLabel(l)}</p>
                  <p class="mt-1 truncate text-xs text-ink-faint">
                    {l.carrier ?? 'Transporteur non assigné'}
                  </p>
                  {#if nextStop(l)}
                    {@const ns = nextStop(l)}
                    <p class="mt-1 truncate text-xs text-ink-muted">
                      Prochain&nbsp;: {ns?.city || ns?.name} ({labelFor(ns?.type ?? '')})
                    </p>
                  {/if}
                  {#if l.lastPosition}
                    <p class="mt-1 text-[11px] text-ink-faint">
                      Position&nbsp;: {new Date(l.lastPosition.occurredAt).toLocaleString('fr-CA')}
                    </p>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <div class="h-[600px]">
    <AgentPanel
      presetId="dispatcher"
      title="Répartiteur IA"
      intro="Demandez un état des retards, une ré-affectation ou un tender — l’agent propose, vous approuvez."
    />
  </div>
</div>
