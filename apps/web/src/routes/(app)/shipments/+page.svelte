<script lang="ts">
  import { page as route } from '$app/state';
  import DossierButton from '$lib/components/workflows/DossierButton.svelte';
  import type { Paginated } from '@pulsar/shared';
  import { PERMISSIONS } from '@pulsar/shared';
  import { auth } from '$lib/stores/auth';
  import { api, ApiError } from '$lib/api/client';
  import {
    PageHeader,
    Button,
    Select,
    Field,
    Textarea,
    Table,
    Badge,
    EmptyState,
    Modal,
    Card,
    Skeleton,
    ErrorNotice,
    toneFor,
    labelFor,
    ViewToggle,
    type ViewId,
  } from '$lib/components/ui';
  import OpsMap from '$lib/components/OpsMap.svelte';
  import { fmtCustomValue } from '$lib/format';
  import { toast } from '$lib/stores/toast';

  interface CustomFieldDef {
    key: string;
    label: string;
    type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';
    options?: { value: string; label: string }[];
    required: boolean;
    showInList?: boolean;
  }

  interface ShipmentRow {
    id: string;
    shipmentNumber: string;
    status: string;
    plannedPickupEarly: string | null;
    plannedPickupLate: string | null;
    plannedDeliveryEarly: string | null;
    plannedDeliveryLate: string | null;
    transportOrder: { id: string; orderNumber: string };
    originLocation: { name: string; city: string };
    destinationLocation: { name: string; city: string };
    load: { id: string; loadNumber: string; status: string } | null;
    totalWeightKg?: number | null;
    totalVolumeM3?: number | null;
    palletCount?: number | null;
    customData?: Record<string, unknown>;
  }

  const fmtWindow = (early: string | null, late?: string | null) =>
    early
      ? new Date(early).toLocaleDateString() +
        (late ? ' → ' + new Date(late).toLocaleDateString() : '')
      : '—';

  interface LoadOption {
    id: string;
    loadNumber: string;
    status: string;
  }

  interface CapacityExcess {
    axis: string;
    capacity: number;
    requested: number;
    excess: number;
  }

  interface ShipmentComment {
    id: string;
    authorType: 'CUSTOMER' | 'STAFF';
    authorName: string;
    body: string;
    createdAt: string;
  }

  let view = $state<ViewId>('table');
  let statusFilter = $state('');
  let error = $state('');
  let selected = $state<ShipmentRow | null>(null);
  $effect(() => {
    const id = route.url.searchParams.get('shipment');
    if (!id) return;
    let active = true;
    void api<ShipmentRow>(`/transportation/shipments/${encodeURIComponent(id)}`)
      .then((row) => {
        if (active) selected = row;
      })
      .catch(() => {
        if (active) error = 'Cette expédition est introuvable ou non accessible.';
      });
    return () => {
      active = false;
    };
  });
  let shipmentFieldDefs = $state<CustomFieldDef[]>([]);

  const canReply = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE) ?? false,
  );

  // — Comments modal —
  let commentsFor = $state<ShipmentRow | null>(null);
  let comments = $state<ShipmentComment[]>([]);
  let commentsLoading = $state(false);
  let commentDraft = $state('');
  let commentSending = $state(false);

  async function loadComments(shipmentId: string) {
    commentsLoading = true;
    try {
      comments = await api<ShipmentComment[]>(`/transportation/shipments/${shipmentId}/comments`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du chargement des commentaires');
      comments = [];
    } finally {
      commentsLoading = false;
    }
  }

  async function openComments(shipment: ShipmentRow) {
    commentsFor = shipment;
    comments = [];
    commentDraft = '';
    await loadComments(shipment.id);
  }

  async function submitComment() {
    if (!commentsFor) return;
    const body = commentDraft.trim();
    if (!body) return;
    commentSending = true;
    try {
      await api(`/transportation/shipments/${commentsFor.id}/comments`, {
        method: 'POST',
        body: { body },
      });
      commentDraft = '';
      await loadComments(commentsFor.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'envoi du commentaire");
    } finally {
      commentSending = false;
    }
  }

  // — Table view (paginated) —
  let shipments = $state<ShipmentRow[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 25;
  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  let loadingTable = $state(true);

  // — Kanban view (grouped by status) —
  const KANBAN_COLS = [
    'PENDING',
    'PLANNED',
    'DISPATCHED',
    'IN_TRANSIT',
    'DELIVERED',
    'CLOSED',
    'CANCELLED',
  ];
  let kanbanRows = $state<ShipmentRow[]>([]);
  let kanbanTotal = $state(0);
  let loadingKanban = $state(false);
  const byStatus = $derived((s: string) => kanbanRows.filter((r) => r.status === s));

  // — Map view (live tracking, reuses the loads active-map payload) —
  interface MapLoad {
    id: string;
    loadNumber: string;
    status: string;
    carrier: string | null;
    isLate: boolean;
    lastPosition: { latitude: number; longitude: number; occurredAt: string } | null;
    stops: {
      sequence: number;
      type: string;
      status: string;
      name: string;
      city: string;
      latitude: number | null;
      longitude: number | null;
    }[];
  }
  let mapLoads = $state<MapLoad[]>([]);
  let loadingMap = $state(false);

  // "Assign to load" picker state
  let assigning = $state<ShipmentRow | null>(null);
  let openLoads = $state<LoadOption[]>([]);
  let selectedLoadId = $state('');
  let assignCapacityExcesses = $state<CapacityExcess[]>([]);
  let assignForce = $state(false);
  let pendingLoadId = $state('');

  async function loadTable() {
    loadingTable = true;
    try {
      const result = await api<Paginated<ShipmentRow>>('/transportation/shipments', {
        query: { page, pageSize, status: statusFilter || undefined },
      });
      shipments = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des shipments';
    } finally {
      loadingTable = false;
    }
  }

  async function loadKanban() {
    loadingKanban = true;
    try {
      const result = await api<Paginated<ShipmentRow>>('/transportation/shipments', {
        query: { page: 1, pageSize: 100 },
      });
      kanbanRows = result.items;
      kanbanTotal = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des shipments';
    } finally {
      loadingKanban = false;
    }
  }

  async function loadMap() {
    loadingMap = true;
    try {
      mapLoads = await api<MapLoad[]>('/transportation/loads/active-map');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement de la carte';
    } finally {
      loadingMap = false;
    }
  }

  // Refresh whatever view is active (after a mutation).
  async function refresh() {
    if (view === 'table') await loadTable();
    else if (view === 'kanban') await loadKanban();
    else await loadMap();
  }

  async function openAssign(shipment: ShipmentRow) {
    assigning = shipment;
    selectedLoadId = '';
    assignCapacityExcesses = [];
    assignForce = false;
    pendingLoadId = '';
    const result = await api<Paginated<LoadOption>>('/transportation/loads', {
      query: { pageSize: 100 },
    });
    openLoads = result.items.filter((l) => l.status === 'OPEN' || l.status === 'PLANNED');
  }

  async function assign(force = false) {
    if (!assigning) return;
    try {
      let loadId = force ? pendingLoadId : selectedLoadId;
      if (!loadId) {
        const created = await api<LoadOption>('/transportation/loads', {
          method: 'POST',
          body: {},
        });
        loadId = created.id;
      }
      const resp = await api<{ modeWarning?: { loadMode: string; orderMode: string } }>(
        `/transportation/shipments/${assigning.id}/assign-load`,
        {
          method: 'POST',
          body: force ? { loadId, force: true } : { loadId },
        },
      );
      if (resp?.modeWarning) {
        const { loadMode, orderMode } = resp.modeWarning;
        toast.error(
          `Mode incompatible : load ${loadMode} / commande ${orderMode} — assigné quand même`,
        );
      } else {
        toast.success(`${assigning.shipmentNumber} assigné au load`);
      }
      assigning = null;
      assignCapacityExcesses = [];
      assignForce = false;
      pendingLoadId = '';
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 400) {
        const body = e.body as { excesses?: CapacityExcess[] } | null;
        if (body?.excesses?.length) {
          // Resolve the load id we were trying to assign to (for force retry)
          if (!force) {
            let resolvedId = selectedLoadId;
            if (!resolvedId) {
              // A new load was created inside the try before the error; we can't recover it here.
              // Re-open assign so user picks an existing load for force.
              assignCapacityExcesses = body.excesses;
              assignForce = false;
              pendingLoadId = '';
              return;
            }
            pendingLoadId = resolvedId;
          }
          assignCapacityExcesses = body.excesses;
          return;
        }
      }
      toast.error(e instanceof ApiError ? e.message : "Échec de l'assignation");
    }
  }

  async function shareTracking(shipment: ShipmentRow) {
    try {
      const { url } = await api<{ url: string }>(`/transportation/shipments/${shipment.id}/share`, {
        method: 'POST',
      });
      await navigator.clipboard.writeText(url);
      toast.success(`Lien de suivi pour ${shipment.shipmentNumber} copié`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création du lien de suivi');
    }
  }

  async function cancelShipment(shipment: ShipmentRow) {
    try {
      await api(`/transportation/shipments/${shipment.id}/cancel`, { method: 'POST' });
      toast.success(`${shipment.shipmentNumber} annulé`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'annulation du shipment");
    }
  }

  async function removeFromLoad(shipment: ShipmentRow) {
    try {
      await api(`/transportation/shipments/${shipment.id}/remove-load`, { method: 'POST' });
      toast.success(`${shipment.shipmentNumber} renvoyé au pool de planification`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du retrait du load');
    }
  }

  function fmtDims(row: ShipmentRow): string {
    const parts: string[] = [];
    if (row.totalWeightKg != null) parts.push(`${row.totalWeightKg.toLocaleString()} kg`);
    if (row.totalVolumeM3 != null) parts.push(`${row.totalVolumeM3} m³`);
    if (row.palletCount != null) parts.push(`${row.palletCount} pal`);
    return parts.length > 0 ? parts.join(' · ') : '—';
  }

  const shipmentScope = $derived(view === 'kanban' ? kanbanRows : shipments);
  const unassignedCount = $derived(shipmentScope.filter((s) => !s.load).length);
  const inMotionCount = $derived(
    shipmentScope.filter((s) => ['DISPATCHED', 'IN_TRANSIT'].includes(s.status)).length,
  );
  const deliveredCount = $derived(
    shipmentScope.filter((s) => ['DELIVERED', 'CLOSED'].includes(s.status)).length,
  );

  // Reset to page 1 whenever the filter changes.
  $effect(() => {
    statusFilter;
    page = 1;
  });

  $effect(() => {
    error = '';
    if (view === 'table') void loadTable();
    else if (view === 'kanban') void loadKanban();
    else void loadMap();
  });

  // Load SHIPMENT custom field definitions once on mount
  $effect(() => {
    api<CustomFieldDef[]>('/transportation/custom-fields', { query: { entityType: 'SHIPMENT' } })
      .then((defs) => {
        shipmentFieldDefs = defs;
      })
      .catch(() => {});
  });
</script>

<PageHeader
  title="Shipments"
  subtitle="Plan confirmed freight into loads, then monitor pickup, transit, and delivery readiness."
  count={total || kanbanTotal}
/>

<ErrorNotice message={error} onretry={refresh} />

<div class="mb-4 grid gap-3 md:grid-cols-3">
  <Card
    ><div class="text-xl font-bold text-ink">{unassignedCount}</div>
    <div class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Unassigned</div>
    <p class="mt-1 text-xs text-ink-faint">Needs a load before dispatch can move.</p></Card
  >
  <Card
    ><div class="text-xl font-bold text-ink">{inMotionCount}</div>
    <div class="text-xs font-semibold uppercase tracking-wide text-ink-muted">In motion</div>
    <p class="mt-1 text-xs text-ink-faint">Dispatched or currently in transit.</p></Card
  >
  <Card
    ><div class="text-xl font-bold text-ink">{deliveredCount}</div>
    <div class="text-xs font-semibold uppercase tracking-wide text-ink-muted">
      Delivered / closed
    </div>
    <p class="mt-1 text-xs text-ink-faint">Ready for proof, billing, or audit handoff.</p></Card
  >
</div>

<div class="mb-3 flex flex-wrap items-center gap-3">
  <!-- view switcher -->
  <ViewToggle bind:view views={['table', 'kanban', 'map']} />
  {#if view === 'table'}
    <div class="w-44">
      <Select bind:value={statusFilter}>
        <option value="">Tous les statuts</option>
        {#each KANBAN_COLS as s (s)}
          <option value={s}>{labelFor(s)}</option>
        {/each}
      </Select>
    </div>
  {/if}
</div>

{#if view === 'table'}
  {#if loadingTable}
    <Card padded={false}><div class="p-4"><Skeleton rows={6} /></div></Card>
  {:else}
    <Table>
      {#snippet head()}
        <th>Shipment #</th><th>Commande #</th><th>Origine → Destination</th>
        <th>Poids / Vol / Pal</th><th>Load</th><th>Statut</th>
      {/snippet}
      {#snippet body()}
        {#each shipments as row (row.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <tr class="cursor-pointer" onclick={() => (selected = row)}>
            <td class="font-semibold">{row.shipmentNumber}</td>
            <td>
              <a
                href={`/transport-orders/${row.transportOrder.id}`}
                class="font-semibold text-accent hover:underline"
                onclick={(e) => e.stopPropagation()}>{row.transportOrder.orderNumber}</a
              >
            </td>
            <td>{row.originLocation.city} → {row.destinationLocation.city}</td>
            <td class="text-sm text-ink-muted">{fmtDims(row)}</td>
            <td>
              {#if row.load}
                <a
                  href={`/loads/${row.load.id}`}
                  class="font-semibold text-accent hover:underline"
                  onclick={(e) => e.stopPropagation()}>{row.load.loadNumber}</a
                >
              {:else}
                —
              {/if}
            </td>
            <td><Badge tone={toneFor(row.status)}>{labelFor(row.status)}</Badge></td>
          </tr>
        {:else}
          <tr
            ><td colspan="6"
              ><EmptyState
                title="Aucun shipment à planifier"
                message="Planifiez une commande confirmée pour créer un shipment, puis assignez-le à un load depuis Dispatch."
              >
                {#snippet children()}<Button href="/transport-orders">Voir les commandes</Button
                  >{/snippet}
              </EmptyState></td
            ></tr
          >
        {/each}
      {/snippet}
    </Table>

    {#if total > pageSize}
      <div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
        <span class="font-mono text-xs"
          >{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} sur {total}</span
        >
        <div class="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={page <= 1}
            onclick={() => {
              page = Math.max(1, page - 1);
              void loadTable();
            }}>Précédent</Button
          >
          <span class="font-mono text-xs">Page {page} / {totalPages}</span>
          <Button
            variant="secondary"
            disabled={page >= totalPages}
            onclick={() => {
              page = Math.min(totalPages, page + 1);
              void loadTable();
            }}>Suivant</Button
          >
        </div>
      </div>
    {/if}
  {/if}
{:else if view === 'kanban'}
  {#if loadingKanban}
    <Card padded={false}><div class="p-4"><Skeleton rows={6} /></div></Card>
  {:else}
    <div class="flex gap-3 overflow-x-auto pb-2">
      {#each KANBAN_COLS as col (col)}
        {@const items = byStatus(col)}
        <div
          class="flex w-64 shrink-0 flex-col rounded-card border border-edge-soft bg-surface-muted"
        >
          <div class="flex items-center justify-between px-3 py-2">
            <Badge tone={toneFor(col)}>{labelFor(col)}</Badge>
            <span class="font-mono text-xs text-ink-muted">{items.length}</span>
          </div>
          <div class="flex max-h-[65vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
            {#each items as row (row.id)}
              <div
                role="button"
                tabindex="0"
                class="cursor-pointer rounded-inner border border-edge-soft bg-surface p-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-card"
                onclick={() => (selected = row)}
                onkeydown={(e) => {
                  if (e.key === 'Enter') selected = row;
                }}
              >
                <div class="font-semibold text-sm text-ink">{row.shipmentNumber}</div>
                <div class="mt-0.5 truncate text-xs text-ink-muted">
                  {row.originLocation.city} → {row.destinationLocation.city}
                </div>
                <div class="mt-1 flex items-center justify-between text-[11px] text-ink-faint">
                  <span>{fmtDims(row)}</span>
                  {#if row.load}<span class="rounded border border-edge px-1 font-mono"
                      >{row.load.loadNumber}</span
                    >{/if}
                </div>
              </div>
            {:else}
              <p class="px-1 py-3 text-center text-xs text-ink-faint">—</p>
            {/each}
          </div>
        </div>
      {/each}
    </div>
    {#if kanbanTotal > 100}<p class="mt-2 text-xs text-ink-faint">
        Affiche les 100 shipments les plus récents. Utilise le tableau pour la liste complète.
      </p>{/if}
  {/if}
{:else}
  <!-- map view (live tracking) -->
  <Card padded={false}>
    <div class="flex items-center justify-between px-4 pt-3 pb-2">
      <h2 class="text-sm font-bold text-ink">Suivi en direct</h2>
      <span class="font-mono text-xs text-ink-muted">
        {mapLoads.length} actifs{#if mapLoads.some((l) => l.isLate)}
          · <span class="text-danger">{mapLoads.filter((l) => l.isLate).length} en retard</span
          >{/if}
      </span>
    </div>
    {#if loadingMap}
      <div class="px-4 pb-4"><Skeleton rows={6} /></div>
    {:else if mapLoads.length === 0}
      <div class="px-4 pb-4">
        <EmptyState
          message="Aucun shipment actif à suivre — les loads dispatchés et en transit apparaissent ici."
        />
      </div>
    {:else}
      <OpsMap loads={mapLoads} />
    {/if}
  </Card>
{/if}

{#if selected}
  {@const sel = selected}
  <Modal
    open={true}
    size="lg"
    title={sel.shipmentNumber}
    onclose={() => {
      selected = null;
      assigning = null;
    }}
  >
    <div class="mb-3">
      <DossierButton entityType="SHIPMENT" entityId={sel.id} />
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Statut</div>
      <div class="text-sm text-ink">
        <Badge tone={toneFor(sel.status)}>{labelFor(sel.status)}</Badge>
      </div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Commande</div>
      <div class="text-sm text-ink">
        <a href={`/transport-orders/${sel.transportOrder.id}`} class="text-accent hover:underline"
          >{sel.transportOrder.orderNumber}</a
        >
      </div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
        Origine → Destination
      </div>
      <div class="text-sm text-ink">
        {sel.originLocation.name}, {sel.originLocation.city} → {sel.destinationLocation.name}, {sel
          .destinationLocation.city}
      </div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
        Fenêtre d'enlèvement
      </div>
      <div class="text-sm text-ink">{fmtWindow(sel.plannedPickupEarly, sel.plannedPickupLate)}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
        Fenêtre de livraison
      </div>
      <div class="text-sm text-ink">
        {fmtWindow(sel.plannedDeliveryEarly, sel.plannedDeliveryLate)}
      </div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
        Poids / Vol / Pal
      </div>
      <div class="text-sm text-ink">{fmtDims(sel)}</div>
    </div>
    <div class="mb-3">
      <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Load</div>
      <div class="text-sm text-ink">
        {#if sel.load}
          <a href={`/loads/${sel.load.id}`} class="text-accent hover:underline"
            >{sel.load.loadNumber}</a
          >
        {:else}
          —
        {/if}
      </div>
    </div>
    {#if sel.customData && shipmentFieldDefs.length > 0}
      {#each shipmentFieldDefs.filter((d) => d.showInList ?? true) as d (d.key)}
        {#if sel.customData[d.key] !== undefined && sel.customData[d.key] !== null}
          <div class="mb-3">
            <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
              {d.label}
            </div>
            <div class="text-sm text-ink">{fmtCustomValue(sel.customData[d.key], d.type)}</div>
          </div>
        {/if}
      {/each}
    {/if}

    <!-- Assign / unassign controls in the panel -->
    <div class="mt-4 border-t border-edge pt-4">
      {#if sel.status === 'PENDING'}
        {#if !assigning || assigning.id !== sel.id}
          <Button variant="primary" onclick={() => openAssign(sel)}>Assigner à un load</Button>
          <div class="mt-2">
            <Button variant="danger" onclick={() => cancelShipment(sel)}>Annuler le shipment</Button
            >
          </div>
        {:else}
          <Field label="Load">
            <select
              bind:value={selectedLoadId}
              onchange={() => {
                assignCapacityExcesses = [];
                assignForce = false;
              }}
              class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            >
              <option value="">+ Créer un nouveau load</option>
              {#each openLoads as l (l.id)}
                <option value={l.id}>{l.loadNumber} ({l.status})</option>
              {/each}
            </select>
          </Field>

          {#if assignCapacityExcesses.length > 0}
            <div class="mt-3 rounded-card border border-warn bg-warn-soft p-3">
              <p class="mb-2 text-sm font-semibold text-warn">Capacité de la remorque dépassée</p>
              <table class="w-full text-xs">
                <thead>
                  <tr class="text-ink-muted">
                    <th class="pb-1 text-left">Axe</th>
                    <th class="pb-1 text-right">Capacité</th>
                    <th class="pb-1 text-right">Demandé</th>
                    <th class="pb-1 text-right">Excès</th>
                  </tr>
                </thead>
                <tbody>
                  {#each assignCapacityExcesses as ex (ex.axis)}
                    <tr>
                      <td class="py-0.5">{ex.axis}</td>
                      <td class="py-0.5 text-right">{ex.capacity}</td>
                      <td class="py-0.5 text-right">{ex.requested}</td>
                      <td class="py-0.5 text-right text-danger">+{ex.excess}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
              <label class="mt-2 flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input type="checkbox" bind:checked={assignForce} />
                Forcer l'assignation (audité)
              </label>
            </div>
          {/if}

          <div class="mt-3 flex gap-2">
            {#if assignCapacityExcesses.length > 0 && assignForce}
              <Button variant="danger" onclick={() => assign(true)}
                >Confirmer l'assignation forcée</Button
              >
            {:else}
              <Button variant="primary" onclick={() => assign()}>Assigner</Button>
            {/if}
            <Button
              variant="secondary"
              onclick={() => {
                assigning = null;
              }}>Annuler</Button
            >
          </div>
        {/if}
      {:else if sel.status === 'PLANNED'}
        <Button variant="secondary" onclick={() => removeFromLoad(sel)}>Retirer du load</Button>
      {/if}
      <div class="mt-2">
        <Button variant="secondary" onclick={() => shareTracking(sel)}>Partager le suivi</Button>
      </div>
      <div class="mt-2">
        <Button variant="secondary" onclick={() => openComments(sel)}>Commentaires</Button>
      </div>
    </div>
  </Modal>
{/if}

{#if commentsFor}
  {@const c = commentsFor}
  <Modal
    open={true}
    size="lg"
    title={`Commentaires · ${c.shipmentNumber}`}
    onclose={() => {
      commentsFor = null;
    }}
  >
    {#if commentsLoading}
      <Skeleton rows={4} />
    {:else if comments.length === 0}
      <EmptyState message="Aucun commentaire pour le moment." />
    {:else}
      <ul class="flex flex-col gap-2">
        {#each comments as comment (comment.id)}
          <li class="rounded-card border border-edge-soft bg-surface-muted px-3 py-2">
            <div class="mb-1 flex items-center gap-2">
              <span class="text-sm font-semibold text-ink">{comment.authorName}</span>
              <Badge tone={comment.authorType === 'STAFF' ? 'info' : 'neutral'}>
                {comment.authorType === 'STAFF' ? 'Équipe' : 'Client'}
              </Badge>
              <span class="text-xs text-ink-faint"
                >{new Date(comment.createdAt).toLocaleString()}</span
              >
            </div>
            <p class="whitespace-pre-wrap text-sm text-ink">{comment.body}</p>
          </li>
        {/each}
      </ul>
    {/if}

    {#snippet footer()}
      {#if canReply}
        <div class="flex w-full flex-col gap-2">
          <Field label="Répondre">
            <Textarea bind:value={commentDraft} rows={2} placeholder="Écrire une réponse…" />
          </Field>
          <div class="flex justify-end">
            <Button
              variant="primary"
              loading={commentSending}
              disabled={!commentDraft.trim()}
              onclick={submitComment}
            >
              Envoyer
            </Button>
          </div>
        </div>
      {:else}
        <p class="text-xs text-ink-faint">
          Lecture seule — la permission de planification est requise pour répondre.
        </p>
      {/if}
    {/snippet}
  </Modal>
{/if}
