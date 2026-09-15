<script lang="ts">
  import { goto } from '$app/navigation';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
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

  import {
    PageHeader,
    Button,
    FilterBar,
    Select,
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

  interface LoadRow {
    id: string;
    loadNumber: string;
    status: string;
    mode: string | null;
    dispatchedAt: string | null;
    carrier: { name: string } | null;
    driver: { firstName: string; lastName: string } | null;
    shipments: { id: string }[];
    customData?: Record<string, unknown>;
  }

  let view = $state<ViewId>('table');
  let statusFilter = $state('');
  let error = $state('');
  let selected = $state<LoadRow | null>(null);
  let loadFieldDefs = $state<CustomFieldDef[]>([]);

  // — Table view (paginated) —
  let rows = $state<LoadRow[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 25;
  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  let loadingTable = $state(true);

  async function loadTable() {
    loadingTable = true;
    try {
      const r = await api<Paginated<LoadRow>>('/transportation/loads', {
        query: { page, pageSize, status: statusFilter || undefined },
      });
      rows = r.items;
      total = r.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement';
    } finally {
      loadingTable = false;
    }
  }

  // — Kanban view (grouped by status) —
  const KANBAN_COLS = ['OPEN', 'PLANNED', 'TENDERED', 'DISPATCHED', 'IN_TRANSIT', 'COMPLETED'];
  let kanbanRows = $state<LoadRow[]>([]);
  let kanbanTotal = $state(0);
  let loadingKanban = $state(false);
  const byStatus = $derived((s: string) => kanbanRows.filter((r) => r.status === s));

  async function loadKanban() {
    loadingKanban = true;
    try {
      const r = await api<Paginated<LoadRow>>('/transportation/loads', {
        query: { page: 1, pageSize: 100 },
      });
      kanbanRows = r.items;
      kanbanTotal = r.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement';
    } finally {
      loadingKanban = false;
    }
  }

  // — Map view (live tracking) —
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

  async function createLoad() {
    try {
      const created = await api<LoadRow>('/transportation/loads', { method: 'POST', body: {} });
      toast.success(`${created.loadNumber} créé`);
      await goto(`/loads/${created.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création');
    }
  }

  const loadScope = $derived(view === 'kanban' ? kanbanRows : rows);
  const openCount = $derived(
    loadScope.filter((l) => ['OPEN', 'PLANNED'].includes(l.status)).length,
  );
  const tenderedCount = $derived(loadScope.filter((l) => l.status === 'TENDERED').length);
  const activeCount = $derived(
    loadScope.filter((l) => ['DISPATCHED', 'IN_TRANSIT'].includes(l.status)).length,
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

  // Load field defs once on mount
  $effect(() => {
    api<CustomFieldDef[]>('/transportation/custom-fields', { query: { entityType: 'LOAD' } })
      .then((defs) => {
        loadFieldDefs = defs;
      })
      .catch(() => {});
  });
</script>

<PageHeader
  title="Chargements"
  subtitle="Consolidate shipments, tender carriers, and track execution through delivery."
  count={total || kanbanTotal}
>
  {#snippet actions()}
    <Button onclick={createLoad}>Nouveau load</Button>
  {/snippet}
</PageHeader>

<ErrorNotice
  message={error}
  onretry={view === 'table' ? loadTable : view === 'kanban' ? loadKanban : loadMap}
/>

<div class="mb-4 grid gap-3 md:grid-cols-3">
  <Card
    ><div class="text-xl font-bold text-ink">{openCount}</div>
    <div class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Open / planned</div>
    <p class="mt-1 text-xs text-ink-faint">Needs carrier, capacity, or dispatch attention.</p></Card
  >
  <Card
    ><div class="text-xl font-bold text-ink">{tenderedCount}</div>
    <div class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Tendered</div>
    <p class="mt-1 text-xs text-ink-faint">Waiting on carrier response or confirmation.</p></Card
  >
  <Card
    ><div class="text-xl font-bold text-ink">{activeCount}</div>
    <div class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Active</div>
    <p class="mt-1 text-xs text-ink-faint">Dispatched or in transit on the live board.</p></Card
  >
</div>

<div class="mb-3 flex flex-wrap items-center gap-3">
  <!-- view switcher -->
  <ViewToggle bind:view views={['table', 'kanban', 'map']} />
  {#if view !== 'map'}
    <div class="w-44">
      <Select bind:value={statusFilter}>
        <option value="">Tous les statuts</option>
        {#each ['OPEN', 'PLANNED', 'TENDERED', 'DISPATCHED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'] as s (s)}
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
        <th>Load #</th><th>Transporteur</th><th>Chauffeur</th><th>Shipments</th>
        <th>Dispatché</th><th>Mode</th><th>Statut</th>
      {/snippet}
      {#snippet body()}
        {#each rows as row (row.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <tr class="cursor-pointer" onclick={() => (selected = row)}>
            <td
              ><a
                href={`/loads/${row.id}`}
                class="font-mono font-semibold text-accent hover:underline"
                onclick={(e) => e.stopPropagation()}>{row.loadNumber}</a
              ></td
            >
            <td>{row.carrier?.name ?? '—'}</td>
            <td>{row.driver ? `${row.driver.firstName} ${row.driver.lastName}` : '—'}</td>
            <td class="font-mono">{row.shipments.length}</td>
            <td>{row.dispatchedAt ? new Date(row.dispatchedAt).toLocaleString() : '—'}</td>
            <td
              >{#if row.mode}<span class="rounded border border-edge px-1.5 text-xs text-neutral"
                  >{row.mode}</span
                >{:else}—{/if}</td
            >
            <td><Badge tone={toneFor(row.status)}>{labelFor(row.status)}</Badge></td>
          </tr>
        {:else}
          <tr
            ><td colspan="7"
              ><EmptyState
                title="Aucun load"
                message="Créez un load depuis des shipments prêts, puis tendez-le à un transporteur pour démarrer l’exécution."
              >
                {#snippet children()}<Button variant="secondary" href="/shipments"
                    >Voir les shipments</Button
                  ><Button onclick={createLoad}>Créer un load</Button>{/snippet}
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
                <div class="font-mono text-sm font-semibold text-accent">{row.loadNumber}</div>
                <div class="mt-0.5 truncate text-xs text-ink-muted">
                  {row.carrier?.name ?? 'Sans transporteur'}
                </div>
                <div class="mt-1 flex items-center justify-between text-[11px] text-ink-faint">
                  <span>{row.shipments.length} shipment{row.shipments.length > 1 ? 's' : ''}</span>
                  {#if row.mode}<span class="rounded border border-edge px-1">{row.mode}</span>{/if}
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
        Affiche les 100 loads les plus récents. Utilise le tableau pour la liste complète.
      </p>{/if}
  {/if}
{:else}
  <!-- map view -->
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
          message="Aucun load actif à suivre — les loads dispatchés et en transit apparaissent ici."
        />
      </div>
    {:else}
      <OpsMap loads={mapLoads} />
    {/if}
  </Card>
{/if}

{#if selected}
  {@const sel = selected}
  <Modal open={true} size="lg" title={sel.loadNumber} onclose={() => (selected = null)}>
    <div class="space-y-3">
      <div>
        <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Statut</div>
        <Badge tone={toneFor(sel.status)}>{labelFor(sel.status)}</Badge>
      </div>
      <div>
        <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
          Transporteur
        </div>
        <div class="text-sm text-ink">{sel.carrier?.name ?? 'Non assigné'}</div>
      </div>
      <div>
        <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
          Chauffeur
        </div>
        <div class="text-sm text-ink">
          {sel.driver ? `${sel.driver.firstName} ${sel.driver.lastName}` : 'Non assigné'}
        </div>
      </div>
      <div>
        <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
          Shipments
        </div>
        <div class="font-mono text-sm text-ink">{sel.shipments.length}</div>
      </div>
      <div>
        <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
          Dispatché
        </div>
        <div class="text-sm text-ink">
          {sel.dispatchedAt ? new Date(sel.dispatchedAt).toLocaleString() : '—'}
        </div>
      </div>
      <div>
        <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">Mode</div>
        <div class="text-sm text-ink">{sel.mode ?? 'Tous modes'}</div>
      </div>
      {#if sel.customData && loadFieldDefs.length > 0}
        {#each loadFieldDefs.filter((d) => d.showInList ?? true) as d (d.key)}
          {#if sel.customData[d.key] !== undefined && sel.customData[d.key] !== null}
            <div>
              <div class="text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
                {d.label}
              </div>
              <div class="text-sm text-ink">{fmtCustomValue(sel.customData[d.key], d.type)}</div>
            </div>
          {/if}
        {/each}
      {/if}
    </div>
    {#snippet footer()}
      <Button variant="secondary" href={`/loads/${sel.id}`}>Ouvrir la page complète</Button>
    {/snippet}
  </Modal>
{/if}
