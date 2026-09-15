<script lang="ts">
  import { confirmAction } from '$lib/stores/confirmation';
  import type { CapacityExcess } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Button, Card, EmptyState, PageHeader, Skeleton } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  // --- Board contract (mirrors PlanningBoardService projection) ---------------
  interface PlanningShipment {
    id: string;
    shipmentNumber: string;
    status: string;
    weightKg?: number;
    volumeM3?: number;
    pallets?: number;
    originLabel: string;
    destinationLabel: string;
    customerName?: string;
  }

  interface PlanningLoad {
    id: string;
    loadNumber: string;
    status: string;
    mode?: string;
    carrierName?: string;
    driverName?: string;
    trailerLabel?: string;
    capacity?: { weightKg?: number; volumeM3?: number; pallets?: number };
    totals: { weightKg: number; volumeM3: number; pallets: number };
    excesses: CapacityExcess[];
    shipments: { id: string; shipmentNumber: string }[];
  }

  interface PlanningResource {
    id: string;
    label: string;
    status: string;
  }

  interface PlanningTrailer extends PlanningResource {
    capacityWeightKg?: number;
    capacityVolumeM3?: number;
    capacityPallets?: number;
  }

  interface PlanningBoard {
    unassignedShipments: PlanningShipment[];
    openLoads: PlanningLoad[];
    resources: {
      vehicles: PlanningResource[];
      trailers: PlanningTrailer[];
      drivers: PlanningResource[];
    };
  }

  // --- Drag payloads -----------------------------------------------------------
  type DragItem =
    | { kind: 'shipment'; id: string; fromLoadId?: string }
    | { kind: 'trailer'; id: string }
    | { kind: 'vehicle'; id: string }
    | { kind: 'driver'; id: string };

  let board = $state<PlanningBoard | null>(null);
  let loading = $state(true);
  let error = $state('');
  let busy = $state(false);

  // Held in component state (HTML5 dataTransfer only carries the type marker).
  let draggingItem = $state<DragItem | null>(null);
  let dropTargetLoadId = $state<string | null>(null);
  let unassignedHover = $state(false);

  type ResourceTab = 'trailers' | 'vehicles' | 'drivers';
  let resourceTab = $state<ResourceTab>('trailers');

  async function load() {
    loading = true;
    error = '';
    try {
      board = await api<PlanningBoard>('/transportation/planning-board');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement de la planche';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  // --- DnD wiring --------------------------------------------------------------
  function startDrag(e: DragEvent, item: DragItem) {
    draggingItem = item;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      // dataTransfer just enables the drop; the real payload lives in state.
      e.dataTransfer.setData('text/plain', item.kind);
    }
  }

  function endDrag() {
    draggingItem = null;
    dropTargetLoadId = null;
    unassignedHover = false;
  }

  function allowDrop(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  // --- Mutations (reuse existing TMS endpoints) --------------------------------

  /** POST helper that surfaces a capacity 400 so callers can offer a force-retry. */
  async function assignShipment(shipmentId: string, loadId: string, force = false) {
    await api(`/transportation/shipments/${shipmentId}/assign-load`, {
      method: 'POST',
      body: force ? { loadId, force: true } : { loadId },
    });
  }

  async function onDropShipmentToLoad(loadId: string, item: DragItem) {
    if (item.kind !== 'shipment') return;
    if (item.fromLoadId === loadId) return; // already there
    busy = true;
    try {
      try {
        await assignShipment(item.id, loadId);
      } catch (e) {
        if (
          e instanceof ApiError &&
          e.statusCode === 400 &&
          (await confirmAction(
            `${e.message}\n\nDépasser la capacité de la remorque et assigner quand même ?`,
          ))
        ) {
          await assignShipment(item.id, loadId, true);
        } else {
          throw e;
        }
      }
      toast.success('Shipment assigné au load');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'assignation");
    } finally {
      busy = false;
    }
  }

  async function onDropShipmentToPool(item: DragItem) {
    if (item.kind !== 'shipment' || !item.fromLoadId) return; // already unassigned
    busy = true;
    try {
      await api(`/transportation/shipments/${item.id}/remove-load`, { method: 'POST' });
      toast.success('Shipment retourné au pool');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du retrait');
    } finally {
      busy = false;
    }
  }

  async function removeShipment(shipmentId: string) {
    busy = true;
    try {
      await api(`/transportation/shipments/${shipmentId}/remove-load`, { method: 'POST' });
      toast.success('Shipment retourné au pool');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du retrait');
    } finally {
      busy = false;
    }
  }

  async function assignResource(
    loadId: string,
    body: { trailerId: string } | { vehicleId: string } | { driverId: string },
    force = false,
  ) {
    await api(`/transportation/loads/${loadId}/assign`, {
      method: 'POST',
      body: force ? { ...body, force: true } : body,
    });
  }

  async function onDropResourceToLoad(loadId: string, item: DragItem) {
    let body: { trailerId: string } | { vehicleId: string } | { driverId: string };
    let label: string;
    if (item.kind === 'trailer') {
      body = { trailerId: item.id };
      label = 'Remorque affectée';
    } else if (item.kind === 'vehicle') {
      body = { vehicleId: item.id };
      label = 'Tracteur affecté';
    } else if (item.kind === 'driver') {
      body = { driverId: item.id };
      label = 'Chauffeur affecté';
    } else {
      return;
    }
    busy = true;
    try {
      try {
        await assignResource(loadId, body);
      } catch (e) {
        // Trailer assignment can 400 on capacity → same force-confirm flow.
        if (
          e instanceof ApiError &&
          e.statusCode === 400 &&
          (await confirmAction(
            `${e.message}\n\nDépasser la capacité et affecter la ressource quand même ?`,
          ))
        ) {
          await assignResource(loadId, body, true);
        } else {
          throw e;
        }
      }
      toast.success(label);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'affectation");
    } finally {
      busy = false;
    }
  }

  /** Route a load drop to the right handler based on the dragged item kind. */
  function onLoadDrop(e: DragEvent, loadId: string) {
    e.preventDefault();
    const item = draggingItem;
    endDrag();
    if (!item) return;
    if (item.kind === 'shipment') void onDropShipmentToLoad(loadId, item);
    else void onDropResourceToLoad(loadId, item);
  }

  function onPoolDrop(e: DragEvent) {
    e.preventDefault();
    const item = draggingItem;
    endDrag();
    if (item) void onDropShipmentToPool(item);
  }

  // --- Capacity bar helpers ----------------------------------------------------
  function pct(used: number, cap?: number): number {
    if (!cap || cap <= 0) return 0;
    return Math.min(100, Math.round((used / cap) * 100));
  }
  function over(used: number, cap?: number): boolean {
    return !!cap && cap > 0 && used > cap;
  }
  const AXIS_LABEL: Record<string, string> = {
    weightKg: 'Poids',
    volumeM3: 'Volume',
    pallets: 'Palettes',
  };

  const resourceTabs: Array<{ id: ResourceTab; label: string }> = [
    { id: 'trailers', label: 'Remorques' },
    { id: 'vehicles', label: 'Tracteurs' },
    { id: 'drivers', label: 'Chauffeurs' },
  ];
  function tabCount(tab: ResourceTab): number {
    if (!board) return 0;
    return board.resources[tab].length;
  }
</script>

<PageHeader
  title="Planification des transports"
  subtitle="Glissez les shipments sur un load, retirez-les vers le pool, et affectez les ressources — tout réutilise les services TMS."
>
  {#snippet actions()}
    <Button variant="secondary" href="/dispatch">Dispatch</Button>
    <Button variant="secondary" onclick={() => void load()}>Rafraîchir</Button>
  {/snippet}
</PageHeader>

{#if loading}
  <Card padded={false}><div class="p-4"><Skeleton rows={8} /></div></Card>
{:else if error}
  <Card>
    <EmptyState title="Erreur" message={error}>
      {#snippet children()}<Button onclick={() => void load()}>Réessayer</Button>{/snippet}
    </EmptyState>
  </Card>
{:else if board}
  {@const b = board}
  <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
    <!-- ── Col 1: Unassigned shipments ──────────────────────────────────── -->
    <section
      class={`flex flex-col rounded-card border bg-surface p-3 transition ${unassignedHover ? 'border-accent ring-1 ring-accent' : 'border-edge'}`}
      ondragover={(e) => {
        allowDrop(e);
        unassignedHover = !!draggingItem && draggingItem.kind === 'shipment';
      }}
      ondragleave={() => (unassignedHover = false)}
      ondrop={onPoolDrop}
      role="list"
    >
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-bold text-ink">Shipments non assignés</h2>
        <Badge tone="neutral">{b.unassignedShipments.length}</Badge>
      </div>
      <div class="flex max-h-[72vh] flex-col gap-2 overflow-y-auto">
        {#each b.unassignedShipments as s (s.id)}
          <div
            role="listitem"
            draggable={true}
            ondragstart={(e) => startDrag(e, { kind: 'shipment', id: s.id })}
            ondragend={endDrag}
            class="cursor-grab rounded-inner border border-edge-soft bg-surface p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card active:cursor-grabbing"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-mono text-sm font-semibold text-accent">{s.shipmentNumber}</span>
              {#if s.customerName}<span class="truncate text-xs text-ink-muted"
                  >{s.customerName}</span
                >{/if}
            </div>
            <div class="mt-1.5 flex items-center gap-2 text-xs text-ink-muted">
              <span class="h-2 w-2 shrink-0 rounded-full bg-ok"></span>
              <span class="min-w-0 flex-1 truncate">{s.originLabel || '—'}</span>
              <span class="h-px w-6 border-t border-dashed border-ink-faint"></span>
              <span class="h-2 w-2 shrink-0 rounded-full bg-accent"></span>
              <span class="min-w-0 flex-1 truncate">{s.destinationLabel || '—'}</span>
            </div>
            <div class="mt-1.5 flex flex-wrap gap-1">
              {#if s.weightKg != null}<Badge tone="neutral">{s.weightKg} kg</Badge>{/if}
              {#if s.volumeM3 != null}<Badge tone="neutral">{s.volumeM3} m³</Badge>{/if}
              {#if s.pallets != null}<Badge tone="neutral">{s.pallets} pal</Badge>{/if}
            </div>
          </div>
        {:else}
          <EmptyState message="Aucun shipment en attente — tout est planifié." />
        {/each}
      </div>
    </section>

    <!-- ── Col 2: Open loads (drop zones) ───────────────────────────────── -->
    <section class="flex flex-col rounded-card border border-edge bg-surface p-3">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-bold text-ink">Loads ouverts</h2>
        <Badge tone="neutral">{b.openLoads.length}</Badge>
      </div>
      <div class="flex max-h-[72vh] flex-col gap-3 overflow-y-auto">
        {#each b.openLoads as load (load.id)}
          {@const c = load.capacity}
          <div
            class={`rounded-card border bg-surface-muted transition ${dropTargetLoadId === load.id ? 'border-accent ring-1 ring-accent' : 'border-edge-soft'}`}
            ondragover={(e) => {
              allowDrop(e);
              if (draggingItem) dropTargetLoadId = load.id;
            }}
            ondragleave={() => {
              if (dropTargetLoadId === load.id) dropTargetLoadId = null;
            }}
            ondrop={(e) => onLoadDrop(e, load.id)}
            role="listitem"
          >
            <!-- header doubles as a resource drop zone -->
            <div class="flex flex-wrap items-center justify-between gap-2 px-3 pt-2.5">
              <div class="flex items-center gap-2">
                <span class="font-mono text-sm font-semibold text-accent">{load.loadNumber}</span>
                <Badge tone={load.status === 'PLANNED' ? 'warn' : 'neutral'}>{load.status}</Badge>
                {#if load.excesses.length > 0}<Badge tone="danger">Capacité dépassée</Badge>{/if}
              </div>
              <span class="text-xs text-ink-muted">{load.shipments.length} shipment(s)</span>
            </div>

            <div class="flex flex-wrap gap-1 px-3 pt-1.5 text-xs text-ink-muted">
              <span class="rounded border border-edge px-1.5"
                >🚚 {load.trailerLabel ?? '— remorque'}</span
              >
              <span class="rounded border border-edge px-1.5">🛻 {load.mode ?? '—'}</span>
              {#if load.driverName}<span class="rounded border border-edge px-1.5"
                  >👤 {load.driverName}</span
                >{/if}
              {#if load.carrierName}<span class="rounded border border-edge px-1.5"
                  >{load.carrierName}</span
                >{/if}
            </div>

            <!-- capacity utilization bars -->
            <div class="space-y-1.5 px-3 pt-2.5">
              {#each [['weightKg', load.totals.weightKg, c?.weightKg], ['volumeM3', load.totals.volumeM3, c?.volumeM3], ['pallets', load.totals.pallets, c?.pallets]] as axis (axis[0])}
                {@const used = Number(axis[1] ?? 0)}
                {@const cap = axis[2] as number | undefined}
                <div class="flex items-center gap-2">
                  <span class="w-14 shrink-0 text-[11px] text-ink-faint"
                    >{AXIS_LABEL[String(axis[0])]}</span
                  >
                  <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-edge">
                    {#if cap}
                      <div
                        class={`h-full rounded-full ${over(used, cap) ? 'bg-danger' : 'bg-accent'}`}
                        style={`width: ${pct(used, cap)}%`}
                      ></div>
                    {/if}
                  </div>
                  <span class="w-24 shrink-0 text-right text-[11px] tabular-nums text-ink-muted">
                    {used}{#if cap}/{cap}{/if}
                  </span>
                </div>
              {/each}
            </div>

            <!-- shipments on this load (draggable out + remove) -->
            <div class="space-y-1.5 px-3 pb-3 pt-2.5">
              {#each load.shipments as s (s.id)}
                <div
                  class="flex items-center justify-between gap-2 rounded-inner border border-edge-soft bg-surface px-2 py-1.5"
                >
                  <span
                    draggable={true}
                    ondragstart={(e) =>
                      startDrag(e, { kind: 'shipment', id: s.id, fromLoadId: load.id })}
                    ondragend={endDrag}
                    role="listitem"
                    class="flex-1 cursor-grab truncate font-mono text-xs font-semibold text-ink active:cursor-grabbing"
                    >{s.shipmentNumber}</span
                  >
                  <button
                    type="button"
                    disabled={busy}
                    onclick={() => void removeShipment(s.id)}
                    title="Retirer du load"
                    class="rounded border border-edge px-1.5 py-0.5 text-[11px] font-semibold text-ink-muted transition hover:border-danger hover:text-danger disabled:opacity-50"
                    >Retirer</button
                  >
                </div>
              {:else}
                <p
                  class="rounded-inner border border-dashed border-edge py-3 text-center text-xs text-ink-faint"
                >
                  Déposez un shipment ici.
                </p>
              {/each}
            </div>
          </div>
        {:else}
          <EmptyState message="Aucun load ouvert — créez-en un depuis Dispatch ou Loads." />
        {/each}
      </div>
    </section>

    <!-- ── Col 3: Available resources ───────────────────────────────────── -->
    <section class="flex flex-col rounded-card border border-edge bg-surface p-3">
      <h2 class="mb-2 text-sm font-bold text-ink">Ressources disponibles</h2>
      <div class="mb-2 inline-flex rounded-lg border border-edge bg-surface p-1">
        {#each resourceTabs as t (t.id)}
          <button
            type="button"
            onclick={() => (resourceTab = t.id)}
            class={`flex-1 rounded-md px-2 py-1 text-xs font-semibold transition ${resourceTab === t.id ? 'bg-accent text-white' : 'text-ink-muted hover:bg-surface-muted hover:text-ink'}`}
          >
            {t.label}
            <span class="ml-1 tabular-nums opacity-80">{tabCount(t.id)}</span>
          </button>
        {/each}
      </div>

      <div class="flex max-h-[68vh] flex-col gap-2 overflow-y-auto">
        {#if resourceTab === 'trailers'}
          {#each b.resources.trailers as r (r.id)}
            <div
              draggable={true}
              ondragstart={(e) => startDrag(e, { kind: 'trailer', id: r.id })}
              ondragend={endDrag}
              role="listitem"
              class="cursor-grab rounded-inner border border-edge-soft bg-surface p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card active:cursor-grabbing"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-semibold text-ink">🚚 {r.label}</span>
                <Badge tone="ok">{r.status}</Badge>
              </div>
              <div class="mt-1 flex flex-wrap gap-1 text-xs text-ink-muted">
                {#if r.capacityWeightKg != null}<span>{r.capacityWeightKg} kg</span>{/if}
                {#if r.capacityVolumeM3 != null}<span>· {r.capacityVolumeM3} m³</span>{/if}
                {#if r.capacityPallets != null}<span>· {r.capacityPallets} pal</span>{/if}
              </div>
            </div>
          {:else}
            <EmptyState message="Aucune remorque disponible." />
          {/each}
        {:else if resourceTab === 'vehicles'}
          {#each b.resources.vehicles as r (r.id)}
            <div
              draggable={true}
              ondragstart={(e) => startDrag(e, { kind: 'vehicle', id: r.id })}
              ondragend={endDrag}
              role="listitem"
              class="flex cursor-grab items-center justify-between gap-2 rounded-inner border border-edge-soft bg-surface p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card active:cursor-grabbing"
            >
              <span class="text-sm font-semibold text-ink">🛻 {r.label}</span>
              <Badge tone="ok">{r.status}</Badge>
            </div>
          {:else}
            <EmptyState message="Aucun tracteur disponible." />
          {/each}
        {:else}
          {#each b.resources.drivers as r (r.id)}
            <div
              draggable={true}
              ondragstart={(e) => startDrag(e, { kind: 'driver', id: r.id })}
              ondragend={endDrag}
              role="listitem"
              class="flex cursor-grab items-center justify-between gap-2 rounded-inner border border-edge-soft bg-surface p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card active:cursor-grabbing"
            >
              <span class="text-sm font-semibold text-ink">👤 {r.label}</span>
              <Badge tone="ok">{r.status}</Badge>
            </div>
          {:else}
            <EmptyState message="Aucun chauffeur disponible." />
          {/each}
        {/if}
      </div>
    </section>
  </div>
{/if}
