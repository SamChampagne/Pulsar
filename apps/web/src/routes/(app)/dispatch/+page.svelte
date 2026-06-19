<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { suggestConsolidations, DEFAULT_TRAILER_CAPACITY } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Card, PageHeader, type Tone } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';
  import DispatchBacklog from '$lib/components/dispatch/DispatchBacklog.svelte';
  import LoadBuilder from '$lib/components/dispatch/LoadBuilder.svelte';
  import DispatchSidePanel from '$lib/components/dispatch/DispatchSidePanel.svelte';

  interface BacklogShipment {
    id: string;
    shipmentNumber: string;
    status: string;
    plannedPickupEarly: string | null;
    plannedDeliveryEarly: string | null;
    transportOrder: { id: string; orderNumber: string };
    originLocation: { name: string; city: string };
    destinationLocation: { name: string; city: string };
    weightKg?: number | null;
    volumeM3?: number | null;
    palletCount?: number | null;
  }

  interface OpenLoad {
    id: string;
    loadNumber: string;
    status: string;
  }

  type LoadStop = {
    id: string;
    sequence: number;
    type: string;
    location?: { name?: string | null; city?: string | null } | null;
    plannedArrivalEarly?: string | null;
    plannedArrivalLate?: string | null;
    [key: string]: unknown;
  };

  type LoadShipment = {
    id: string;
    shipmentNumber: string;
    status: string;
    weightKg?: number | null;
    volumeM3?: number | null;
    palletCount?: number | null;
    [key: string]: unknown;
  };

  type LoadDetail = {
    id: string;
    loadNumber: string;
    status: string;
    estimatedCost?: string | number | null;
    costCurrency?: string | null;
    shipments?: LoadShipment[];
    route?: { stops?: LoadStop[] | null; [key: string]: unknown } | null;
    [key: string]: unknown;
  };

  type DispatchView = 'map' | 'board' | 'table';

  let backlog = $state<BacklogShipment[]>([]);
  let backlogLoading = $state(true);
  let selectedIds = $state<Set<string>>(new Set());
  let openLoads = $state<OpenLoad[]>([]);
  let activeLoads = $state<OpenLoad[]>([]);
  let selectedLoadId = $state<string | null>(null);
  let selectedLoad = $state<LoadDetail | null>(null);
  let busy = $state(false);
  let view = $state<DispatchView>('map');

  const hasSelection = $derived(selectedIds.size > 0);
  const selectedCount = $derived(selectedIds.size);
  const lateBacklog = $derived(backlog.filter((s) => isPast(s.plannedPickupEarly)).length);
  const plannedLoadCount = $derived(openLoads.filter((l) => l.status === 'PLANNED').length);
  const openLoadCount = $derived(openLoads.filter((l) => l.status === 'OPEN').length);
  const movingLoadCount = $derived(activeLoads.length);
  const canMutateSelectedLoad = $derived(
    !selectedLoad || ['OPEN', 'PLANNED'].includes(selectedLoad.status),
  );
  const selectedStops = $derived(
    [...(selectedLoad?.route?.stops ?? [])].sort((a, b) => a.sequence - b.sequence),
  );
  const selectedShipments = $derived(selectedLoad?.shipments ?? []);
  const selectedShipmentCount = $derived(selectedShipments.length);

  const viewOptions: Array<{ id: DispatchView; label: string; hint: string }> = [
    { id: 'map', label: 'Map', hint: 'route + rates' },
    { id: 'board', label: 'Board', hint: 'ops pipeline' },
    { id: 'table', label: 'Table', hint: 'dense planning' },
  ];

  const boardColumns: Array<{ title: string; statuses: string[]; tone: Tone }> = [
    { title: 'Planned', statuses: ['PLANNED'], tone: 'warn' },
    { title: 'Open', statuses: ['OPEN'], tone: 'neutral' },
    { title: 'Dispatched / Moving', statuses: ['DISPATCHED', 'IN_TRANSIT'], tone: 'info' },
  ];

  async function loadBacklog() {
    backlogLoading = true;
    try {
      const res = await api<Paginated<BacklogShipment>>('/transportation/shipments', {
        query: { unassigned: 'true', pageSize: 100 },
      });
      backlog = res.items;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to load backlog');
    } finally {
      backlogLoading = false;
    }
  }

  type LoadOption = OpenLoad;

  async function loadOpenLoads() {
    const [open, planned, dispatched, inTransit] = await Promise.allSettled([
      api<{ items: LoadOption[] }>('/transportation/loads', {
        query: { status: 'OPEN', pageSize: 100 },
      }),
      api<{ items: LoadOption[] }>('/transportation/loads', {
        query: { status: 'PLANNED', pageSize: 100 },
      }),
      api<{ items: LoadOption[] }>('/transportation/loads', {
        query: { status: 'DISPATCHED', pageSize: 50 },
      }),
      api<{ items: LoadOption[] }>('/transportation/loads', {
        query: { status: 'IN_TRANSIT', pageSize: 50 },
      }),
    ]);

    const items = (result: PromiseSettledResult<{ items: LoadOption[] }>) =>
      result.status === 'fulfilled' ? result.value.items : [];

    openLoads = [...items(planned), ...items(open)];
    activeLoads = [...items(dispatched), ...items(inTransit)];
  }

  async function selectLoad(id: string) {
    try {
      const detail = await api<LoadDetail>(`/transportation/loads/${id}`);
      selectedLoad = detail;
      selectedLoadId = id;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Load');
      selectedLoad = null;
      selectedLoadId = null;
    }
  }

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds = next;
  }

  async function createLoadFrom(ids: string[]) {
    if (ids.length === 0) return;
    busy = true;
    try {
      const created = await api<OpenLoad>('/transportation/loads/consolidate', {
        method: 'POST',
        body: { shipmentIds: ids },
      });
      selectedIds = new Set();
      await Promise.all([loadBacklog(), loadOpenLoads()]);
      await selectLoad(created.id);
      view = 'map';
      toast.success(`${created.loadNumber} created`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to consolidate');
    } finally {
      busy = false;
    }
  }

  function consolidate() {
    return createLoadFrom([...selectedIds]);
  }

  // --- Consolidation optimizer (pure, runs on the loaded backlog) -------------
  let optimizerOpen = $state(false);
  const suggestions = $derived(
    suggestConsolidations(
      backlog.map((s) => ({
        id: s.id,
        shipmentNumber: s.shipmentNumber,
        originCity: s.originLocation?.city ?? '',
        destinationCity: s.destinationLocation?.city ?? '',
        weightKg: s.weightKg ?? 0,
        volumeM3: s.volumeM3 ?? 0,
        palletCount: s.palletCount ?? 0,
      })),
      DEFAULT_TRAILER_CAPACITY,
    ),
  );
  const topSuggestions = $derived(suggestions.groups.slice(0, 5));

  function selectGroup(ids: string[]) {
    selectedIds = new Set(ids);
    view = 'map';
  }
  function pct(n: number): number {
    return Math.min(100, Math.round(n * 100));
  }

  async function addSelectionToLoad() {
    if (!selectedLoadId || selectedIds.size === 0) return;
    if (selectedLoad && !['OPEN', 'PLANNED'].includes(selectedLoad.status)) {
      toast.error('Only OPEN or PLANNED loads can receive shipments.');
      return;
    }
    busy = true;
    try {
      for (const sid of selectedIds) {
        await api(`/transportation/shipments/${sid}/assign-load`, {
          method: 'POST',
          body: { loadId: selectedLoadId },
        });
      }
      selectedIds = new Set();
      await loadBacklog();
      if (selectedLoadId) await selectLoad(selectedLoadId);
      toast.success('Shipments assigned to load');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Assignation (capacité ?)');
      selectedIds = new Set();
      await loadBacklog();
      if (selectedLoadId) await selectLoad(selectedLoadId);
    } finally {
      busy = false;
    }
  }

  async function removeShipment(sid: string) {
    if (selectedLoad && !['OPEN', 'PLANNED'].includes(selectedLoad.status)) {
      toast.error('Only OPEN or PLANNED loads can be edited from dispatch planning.');
      return;
    }
    busy = true;
    try {
      await api(`/transportation/shipments/${sid}/remove-load`, { method: 'POST' });
      await loadBacklog();
      if (selectedLoadId) await selectLoad(selectedLoadId);
      toast.success('Shipment returned to planning pool');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to remove shipment');
    } finally {
      busy = false;
    }
  }

  function loadsByStatus(statuses: string[]) {
    const source = [...openLoads, ...activeLoads];
    return source.filter((l) => statuses.includes(l.status));
  }

  function isPast(value: string | null) {
    return !!value && new Date(value).getTime() < Date.now();
  }

  function fmtDate(value: string | null | undefined) {
    if (!value) return '—';
    return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function fmtTime(value: string | null | undefined) {
    if (!value) return '—';
    return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function statusTone(status: string): 'neutral' | 'info' | 'ok' | 'warn' | 'danger' {
    if (['DISPATCHED', 'IN_TRANSIT', 'STARTED'].includes(status)) return 'info';
    if (['DELIVERED', 'COMPLETED', 'CLOSED'].includes(status)) return 'ok';
    if (['CANCELLED', 'FAILED'].includes(status)) return 'danger';
    if (['PLANNED', 'TENDERED'].includes(status)) return 'warn';
    return 'neutral';
  }

  $effect(() => {
    void loadBacklog();
    void loadOpenLoads();
  });
</script>

<PageHeader
  title="Dispatch"
  subtitle="Plan unassigned shipments, build loads, and move execution forward from one cockpit."
/>

<section class="mb-4 overflow-hidden rounded-card border border-edge bg-surface shadow-sm">
  <div
    class="border-b border-edge bg-[linear-gradient(135deg,#0f172a_0%,#172554_52%,#1e3a8a_100%)] p-4 text-white"
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-xs font-semibold tracking-[0.18em] text-blue-100 uppercase">
          Operations cockpit
        </p>
        <h1 class="mt-1 text-2xl font-bold tracking-tight">
          Planifier, suivre et tender depuis la même surface.
        </h1>
        <p class="mt-1 max-w-3xl text-sm text-blue-100">
          Pulsar passe d'une page de gestion à un poste de dispatch: backlog, route, rates, board
          d'états et actions agent-ready au même endroit.
        </p>
      </div>
      <div class="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-right backdrop-blur">
        <div class="text-xs text-blue-100">Sélection active</div>
        <div class="text-2xl font-bold">{selectedCount}</div>
      </div>
    </div>
  </div>

  <div class="grid gap-0 divide-y divide-edge md:grid-cols-4 md:divide-x md:divide-y-0">
    <div class="p-3">
      <div class="text-xs font-medium text-ink-muted">Unplanned shipments</div>
      <div class="mt-1 flex items-end gap-2">
        <span class="text-2xl font-bold text-ink">{backlog.length}</span>
        {#if lateBacklog > 0}<Badge tone="danger">{lateBacklog} late</Badge>{/if}
      </div>
    </div>
    <div class="p-3">
      <div class="text-xs font-medium text-ink-muted">Loads planned/open</div>
      <div class="mt-1 text-2xl font-bold text-ink">{plannedLoadCount + openLoadCount}</div>
    </div>
    <div class="p-3">
      <div class="text-xs font-medium text-ink-muted">Moving / dispatched</div>
      <div class="mt-1 text-2xl font-bold text-ink">{movingLoadCount}</div>
    </div>
    <div class="p-3">
      <div class="text-xs font-medium text-ink-muted">Selected load</div>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        <span class="text-lg font-bold text-ink">{selectedLoad?.loadNumber ?? '—'}</span>
        {#if selectedLoad}<Badge tone={statusTone(selectedLoad.status)}>{selectedLoad.status}</Badge
          >{/if}
      </div>
    </div>
  </div>
</section>

{#if suggestions.groups.length > 0}
  <section class="mb-3 overflow-hidden rounded-card border border-edge bg-surface shadow-sm">
    <button
      type="button"
      onclick={() => (optimizerOpen = !optimizerOpen)}
      class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-muted"
    >
      <div class="flex items-center gap-2">
        <span class="grid size-7 place-items-center rounded-lg bg-accent/10 text-accent">✦</span>
        <div>
          <div class="text-sm font-bold text-ink">Suggestions d'optimisation</div>
          <div class="text-xs text-ink-muted">
            {suggestions.groups.length} regroupement(s) proposé(s) — même voie, capacité 3 axes respectée
          </div>
        </div>
      </div>
      <span class="text-xs font-semibold text-accent">{optimizerOpen ? 'Masquer' : 'Voir'}</span>
    </button>

    {#if optimizerOpen}
      <div class="grid gap-2 border-t border-edge p-3 md:grid-cols-2 xl:grid-cols-3">
        {#each topSuggestions as g (g.shipmentIds.join(','))}
          <div class="rounded-lg border border-edge bg-surface-muted p-3">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0 text-sm font-semibold text-ink">
                <span class="truncate">{g.originCity || '—'} → {g.destinationCity || '—'}</span>
              </div>
              <Badge
                tone={g.utilization >= 0.85 ? 'ok' : g.utilization >= 0.5 ? 'info' : 'neutral'}
              >
                {pct(g.utilization)}% plein
              </Badge>
            </div>
            <div class="mt-1 text-xs text-ink-muted">
              {g.count} shipments · {g.shipmentNumbers.slice(0, 4).join(', ')}{g.count > 4
                ? '…'
                : ''}
            </div>

            <div class="mt-3 space-y-1.5">
              {#each [['Poids', g.fill.weight], ['Volume', g.fill.volume], ['Palettes', g.fill.pallets]] as axis (axis[0])}
                <div class="flex items-center gap-2">
                  <span class="w-14 shrink-0 text-[11px] text-ink-faint">{axis[0]}</span>
                  <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-edge">
                    <div
                      class={`h-full rounded-full ${Number(axis[1]) >= 0.95 ? 'bg-warn' : 'bg-accent'}`}
                      style={`width: ${pct(Number(axis[1]))}%`}
                    ></div>
                  </div>
                  <span class="w-9 shrink-0 text-right text-[11px] tabular-nums text-ink-muted"
                    >{pct(Number(axis[1]))}%</span
                  >
                </div>
              {/each}
            </div>

            <div class="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onclick={() => createLoadFrom(g.shipmentIds)}
                class="flex-1 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-strong disabled:opacity-50"
              >
                Créer le load
              </button>
              <button
                type="button"
                onclick={() => selectGroup(g.shipmentIds)}
                class="rounded-md border border-edge bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted transition hover:bg-surface-muted hover:text-ink"
              >
                Sélectionner
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
  <div class="inline-flex rounded-lg border border-edge bg-surface p-1 shadow-sm">
    {#each viewOptions as option (option.id)}
      <button
        type="button"
        onclick={() => (view = option.id)}
        class={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${view === option.id ? 'bg-accent text-white shadow-sm' : 'text-ink-muted hover:bg-surface-muted hover:text-ink'}`}
      >
        {option.label}
        <span
          class={`ml-1 hidden text-xs font-normal md:inline ${view === option.id ? 'text-blue-100' : 'text-ink-faint'}`}
          >{option.hint}</span
        >
      </button>
    {/each}
  </div>
  <div class="flex items-center gap-3">
    <a
      href="/planning"
      class="rounded-md border border-edge bg-surface px-3 py-1.5 text-sm font-semibold text-ink-muted transition hover:bg-surface-muted hover:text-ink"
      >Planning Board</a
    >
    <p class="hidden text-xs text-ink-muted lg:block">
      Switch modes based on the job: route context, status pipeline, or dense planning table.
    </p>
  </div>
</div>

{#if view === 'map'}
  <div class="grid gap-3 xl:grid-cols-[320px_minmax(0,1fr)_420px]">
    <DispatchBacklog {backlog} {backlogLoading} {selectedIds} onToggle={toggle} />
    <LoadBuilder
      {selectedLoad}
      {openLoads}
      {selectedLoadId}
      {hasSelection}
      {busy}
      onSelectLoad={selectLoad}
      onConsolidate={consolidate}
      onAddSelection={addSelectionToLoad}
      onRemoveShipment={removeShipment}
      canAddSelection={canMutateSelectedLoad}
      canRemoveShipment={canMutateSelectedLoad}
    />
    <DispatchSidePanel
      {selectedLoad}
      onChanged={() => selectedLoadId && selectLoad(selectedLoadId)}
    />
  </div>
{:else if view === 'board'}
  <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
    <div class="rounded-card border border-edge bg-surface p-3">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
        <section class="rounded-lg bg-surface-muted p-2">
          <div class="mb-2 flex items-center justify-between">
            <h2 class="text-sm font-semibold text-ink">Created</h2>
            <Badge tone="neutral">{backlog.length}</Badge>
          </div>
          <div class="space-y-2">
            {#each backlog.slice(0, 12) as shipment (shipment.id)}
              <button
                type="button"
                onclick={() => toggle(shipment.id)}
                class={`w-full rounded-md border bg-surface p-2 text-left text-xs shadow-sm transition ${selectedIds.has(shipment.id) ? 'border-accent ring-1 ring-accent' : 'border-edge hover:border-accent'}`}
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="font-semibold text-ink">{shipment.shipmentNumber}</span>
                  <Badge tone={isPast(shipment.plannedPickupEarly) ? 'danger' : 'neutral'}
                    >{fmtDate(shipment.plannedPickupEarly)}</Badge
                  >
                </div>
                <div class="mt-2 flex items-center gap-2 text-ink-muted">
                  <span class="h-2 w-2 rounded-full bg-ok"></span>
                  <span class="min-w-0 flex-1 truncate">{shipment.originLocation.city}</span>
                  <span class="h-px w-8 border-t border-dashed border-ink-faint"></span>
                  <span class="h-2 w-2 rounded-full bg-accent"></span>
                  <span class="min-w-0 flex-1 truncate">{shipment.destinationLocation.city}</span>
                </div>
                <div class="mt-2 flex flex-wrap gap-1">
                  <Badge tone="neutral">{shipment.transportOrder.orderNumber}</Badge>
                  {#if shipment.palletCount != null}<Badge tone="neutral"
                      >{shipment.palletCount} pal</Badge
                    >{/if}
                </div>
              </button>
            {/each}
          </div>
        </section>

        {#each boardColumns as column (column.title)}
          {@const columnLoads = loadsByStatus(column.statuses)}
          <section class="rounded-lg bg-surface-muted p-2">
            <div class="mb-2 flex items-center justify-between">
              <h2 class="text-sm font-semibold text-ink">{column.title}</h2>
              <Badge tone={column.tone}>{columnLoads.length}</Badge>
            </div>
            <div class="space-y-2">
              {#each columnLoads as load (load.id)}
                <button
                  type="button"
                  onclick={() => {
                    void selectLoad(load.id);
                  }}
                  class={`w-full rounded-md border bg-surface p-2 text-left text-xs shadow-sm transition ${selectedLoadId === load.id ? 'border-accent ring-1 ring-accent' : 'border-edge hover:border-accent'}`}
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-semibold text-ink">{load.loadNumber}</span>
                    <Badge tone={statusTone(load.status)}>{load.status}</Badge>
                  </div>
                  <div class="mt-2 flex items-center gap-2 text-ink-muted">
                    <span
                      class="grid h-5 w-5 place-items-center rounded-full bg-accent-soft text-[10px] font-bold text-accent"
                      >L</span
                    >
                    <span class="h-px flex-1 border-t border-dashed border-ink-faint"></span>
                    <span
                      class="grid h-5 w-5 place-items-center rounded-full bg-ok-soft text-[10px] font-bold text-ok"
                      >✓</span
                    >
                  </div>
                  <p class="mt-2 text-ink-muted">Clique pour ouvrir route, rates et tender.</p>
                </button>
              {:else}
                <div
                  class="rounded-md border border-dashed border-edge p-4 text-center text-xs text-ink-faint"
                >
                  Aucun load.
                </div>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    </div>

    <div class="space-y-3">
      <Card>
        <h2 class="mb-3 text-sm font-bold text-ink">Activity rail</h2>
        {#if !selectedLoad}
          <p class="text-sm text-ink-muted">Sélectionne un load pour voir sa progression.</p>
        {:else}
          <ol class="space-y-3">
            {#each ['Created', 'Planned', 'Tendered', 'Dispatched', 'In transit', 'Delivered'] as step, index (step)}
              {@const activeIndex = Math.max(
                0,
                ['OPEN', 'PLANNED', 'TENDERED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED'].indexOf(
                  selectedLoad.status,
                ),
              )}
              <li class="flex gap-3 text-sm">
                <span
                  class={`mt-0.5 h-3 w-3 rounded-full ${index <= activeIndex ? 'bg-accent' : 'bg-edge'}`}
                ></span>
                <div>
                  <div class="font-medium text-ink">{step}</div>
                  <div class="text-xs text-ink-muted">
                    {index === 0
                      ? selectedLoad.loadNumber
                      : index <= activeIndex
                        ? 'completed / current'
                        : 'waiting'}
                  </div>
                </div>
              </li>
            {/each}
          </ol>
        {/if}
      </Card>

      <Card>
        <h2 class="mb-3 text-sm font-bold text-ink">Selected load details</h2>
        {#if !selectedLoad}
          <p class="text-sm text-ink-muted">Aucun load sélectionné.</p>
        {:else}
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div class="text-xs text-ink-muted">Shipments</div>
              <div class="text-xl font-bold text-ink">{selectedShipmentCount}</div>
            </div>
            <div>
              <div class="text-xs text-ink-muted">Stops</div>
              <div class="text-xl font-bold text-ink">{selectedStops.length}</div>
            </div>
          </div>
          <div class="mt-3 space-y-2">
            {#each selectedStops.slice(0, 4) as stop (stop.id)}
              <div
                class="flex items-center gap-2 rounded-md border border-edge px-2 py-1.5 text-xs"
              >
                <Badge tone={stop.type === 'PICKUP' ? 'info' : 'ok'}>{stop.sequence}</Badge>
                <span class="min-w-0 flex-1 truncate text-ink">
                  {[stop.location?.name, stop.location?.city].filter(Boolean).join(', ') ||
                    stop.type}
                </span>
                <span class="text-ink-muted">{fmtTime(stop.plannedArrivalEarly)}</span>
              </div>
            {/each}
          </div>
        {/if}
      </Card>

      {#if selectedLoad}
        <DispatchSidePanel
          {selectedLoad}
          onChanged={() => selectedLoadId && selectLoad(selectedLoadId)}
        />
      {:else if selectedIds.size > 0}
        <Card>
          <h2 class="mb-2 text-sm font-bold text-ink">Planning actions</h2>
          <p class="mb-3 text-sm text-ink-muted">
            {selectedIds.size} shipment(s) sélectionné(s). Passe en mode Map pour consolider ou ajouter
            à un load.
          </p>
          <button
            type="button"
            class="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
            onclick={() => (view = 'map')}
          >
            Ouvrir les actions Map
          </button>
        </Card>
      {/if}
    </div>
  </div>
{:else}
  <div class="grid gap-3 lg:grid-cols-[26%_minmax(0,1fr)_30%]">
    <DispatchBacklog {backlog} {backlogLoading} {selectedIds} onToggle={toggle} />
    <LoadBuilder
      {selectedLoad}
      {openLoads}
      {selectedLoadId}
      {hasSelection}
      {busy}
      onSelectLoad={selectLoad}
      onConsolidate={consolidate}
      onAddSelection={addSelectionToLoad}
      onRemoveShipment={removeShipment}
      canAddSelection={canMutateSelectedLoad}
      canRemoveShipment={canMutateSelectedLoad}
    />
    <DispatchSidePanel
      {selectedLoad}
      onChanged={() => selectedLoadId && selectLoad(selectedLoadId)}
    />
  </div>
{/if}
