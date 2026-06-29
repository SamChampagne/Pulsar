<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorNotice,
    PageHeader,
    Skeleton,
  } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';

  // --- Shapes (mirrored from /wms/receiving, /wms/picking, /wms/fulfillment, /wms/overview) ---
  interface NegativeBin {
    id: string;
    itemId: string;
    binId: string;
    qtyOnHand: string;
    item: { sku: string };
    bin: { code: string };
  }

  interface BelowMinItem {
    id: string;
    sku: string;
    name: string;
    onHand: number;
    reorderPoint: number | null;
    belowMin: boolean;
  }

  interface Overview {
    distinctItems: number;
    totalOnHand: number;
    openReceipts: number;
    openPickOrders: number;
    negativeBins: NegativeBin[];
    belowMin: BelowMinItem[];
    openCycleCounts: number;
  }

  interface ReceiptRow {
    id: string;
    number: string;
    status: string;
    locationId: string;
    reference?: string | null;
    createdAt: string;
    _count: { lines: number };
  }

  interface ShipmentRef {
    id: string;
    shipmentNumber: string;
    status: string;
  }

  interface PickRow {
    id: string;
    number: string;
    status: string;
    locationId: string;
    reference?: string | null;
    createdAt: string;
    shipment?: ShipmentRef | null;
    _count: { lines: number };
  }

  type PickStatus = 'NOT_PICKED' | 'PICKING' | 'PICKED';

  interface PickOrderRef {
    id: string;
    number: string;
    status: string;
  }

  interface PendingShipment {
    id: string;
    shipmentNumber: string;
    status: string;
    originLocationId: string;
    originLocation: { code: string; name: string } | null;
    destinationLocation: { code: string; name: string } | null;
    weightKg: string | number | null;
    plannedPickupEarly: string | null;
    pickOrders: PickOrderRef[];
    pickStatus: PickStatus;
  }

  let overview = $state<Overview | null>(null);
  let receipts = $state<ReceiptRow[]>([]);
  let picks = $state<PickRow[]>([]);
  let pending = $state<PendingShipment[]>([]);
  let loading = $state(true);
  let error = $state('');

  // --- Status helpers ---
  function receiptTone(status: string): Tone {
    switch (status) {
      case 'DRAFT':
        return 'info';
      case 'POSTED':
        return 'ok';
      case 'CANCELLED':
        return 'neutral';
      default:
        return 'neutral';
    }
  }

  function receiptLabel(status: string): string {
    switch (status) {
      case 'DRAFT':
        return 'Brouillon';
      case 'POSTED':
        return 'Validée';
      case 'CANCELLED':
        return 'Annulée';
      default:
        return status;
    }
  }

  function pickTone(status: string): Tone {
    switch (status) {
      case 'OPEN':
        return 'info';
      case 'PICKED':
        return 'warn';
      case 'COMPLETED':
        return 'ok';
      case 'CANCELLED':
        return 'neutral';
      default:
        return 'neutral';
    }
  }

  function pickLabel(status: string): string {
    switch (status) {
      case 'OPEN':
        return 'Ouvert';
      case 'PICKED':
        return 'Prélevé';
      case 'COMPLETED':
        return 'Complété';
      case 'CANCELLED':
        return 'Annulé';
      default:
        return status;
    }
  }

  function pickStatusTone(status: PickStatus): Tone {
    switch (status) {
      case 'PICKED':
        return 'ok';
      case 'PICKING':
        return 'warn';
      case 'NOT_PICKED':
      default:
        return 'neutral';
    }
  }

  function pickStatusLabel(status: PickStatus): string {
    switch (status) {
      case 'PICKED':
        return 'Préparé';
      case 'PICKING':
        return 'En préparation';
      case 'NOT_PICKED':
      default:
        return 'À préparer';
    }
  }

  function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
  }

  async function load() {
    loading = true;
    error = '';
    try {
      // Inbound = DRAFT receipts; Outbound = active pick orders (OPEN + PICKED).
      // We pull each backlog explicitly via the status filter so the board reflects live work.
      const [ov, draftReceipts, openPicks, pickedPicks, pendingShipments] = await Promise.all([
        api<Overview>('/wms/overview'),
        api<ReceiptRow[]>('/wms/receipts', { query: { status: 'DRAFT' } }),
        api<PickRow[]>('/wms/pick-orders', { query: { status: 'OPEN' } }),
        api<PickRow[]>('/wms/pick-orders', { query: { status: 'PICKED' } }),
        api<PendingShipment[]>('/wms/fulfillment/pending'),
      ]);
      overview = ov;
      receipts = draftReceipts;
      picks = [...openPicks, ...pickedPicks];
      pending = pendingShipments;
    } catch (e) {
      error = e instanceof ApiError ? e.message : "Échec du chargement du flux d'entrepôt";
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  // --- Derived board groupings ---
  const openPicks = $derived(picks.filter((p) => p.status === 'OPEN'));
  const pickedPicks = $derived(picks.filter((p) => p.status === 'PICKED'));
  const stagingPending = $derived(pending.filter((s) => s.pickStatus !== 'PICKED'));

  // Inventory-integrity signals worth escalating now.
  const negativeBins = $derived(overview?.negativeBins ?? []);
  const belowMin = $derived(overview?.belowMin ?? []);
</script>

<PageHeader
  title="Flux d'entrepôt"
  eyebrow="WMS"
  subtitle="Suivre le travail d'entrepôt d'un seul regard : réception entrante, intégrité du stock, prélèvement sortant et préparation des expéditions."
  count={receipts.length + picks.length + stagingPending.length}
>
  {#snippet actions()}
    <a
      href="/wms"
      class="rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink hover:bg-surface-muted"
    >
      Cockpit
    </a>
    <Button onclick={load}>Rafraîchir</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {#each Array(4) as _, i (i)}<Skeleton />{/each}
  </div>
  <div class="mt-5 flex gap-3 overflow-x-auto">
    {#each Array(4) as _, i (i)}
      <div class="w-72 shrink-0"><Skeleton /></div>
    {/each}
  </div>
{:else if error && !overview}
  <Card>
    <EmptyState
      title="Flux indisponible"
      message="Impossible de charger le flux d'entrepôt. Réessayez ou inspectez directement la réception et le prélèvement."
    >
      {#snippet children()}
        <Button onclick={load}>Réessayer</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else if overview}
  <!-- KPI strip — what needs attention now -->
  <div class="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <Card>
      <div class="text-xs font-medium text-ink-muted">Réceptions à valider</div>
      <div class="mt-1 text-3xl font-bold text-ink">{receipts.length}</div>
      <div class="mt-0.5 text-xs text-ink-faint">brouillons en attente</div>
    </Card>
    <Card>
      <div class="text-xs font-medium text-ink-muted">Prélèvements actifs</div>
      <div class="mt-1 text-3xl font-bold text-ink">{openPicks.length + pickedPicks.length}</div>
      <div class="mt-0.5 text-xs text-ink-faint">{openPicks.length} ouvert(s) · {pickedPicks.length} prélevé(s)</div>
    </Card>
    <Card>
      <div class="text-xs font-medium text-ink-muted">Expéditions à préparer</div>
      <div class="mt-1 text-3xl font-bold text-ink">{stagingPending.length}</div>
      <div class="mt-0.5 text-xs text-ink-faint">en attente de prélèvement</div>
    </Card>
    <Card>
      <div class="text-xs font-medium {negativeBins.length > 0 ? 'text-danger' : 'text-ink-muted'}">
        Bins négatifs
      </div>
      <div class="mt-1 text-3xl font-bold {negativeBins.length > 0 ? 'text-danger' : 'text-ink'}">
        {negativeBins.length}
      </div>
      <div class="mt-0.5 text-xs text-ink-faint">{belowMin.length} article(s) sous le minimum</div>
    </Card>
  </div>

  <!-- Flow board: Inbound → Inventory → Outbound → Staging -->
  <div class="flex gap-3 overflow-x-auto pb-2">
    <!-- Column 1: Inbound (Réception) -->
    <div class="flex w-72 shrink-0 flex-col rounded-card border border-edge-soft bg-surface-muted">
      <div class="flex items-center justify-between gap-2 px-3 py-2">
        <div>
          <div class="text-sm font-semibold text-ink">Réception</div>
          <div class="text-[11px] text-ink-faint">Entrant — à valider</div>
        </div>
        <Badge tone="info">{receipts.length}</Badge>
      </div>
      <div class="flex max-h-[70vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
        {#if receipts.length === 0}
          <p class="px-1 py-6 text-center text-xs text-ink-faint">Aucune réception en attente.</p>
        {:else}
          {#each receipts as r (r.id)}
            <a
              href={`/wms/receiving/${r.id}`}
              class="block rounded-inner border border-edge-soft bg-surface p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-semibold text-ink">{r.number}</span>
                <Badge tone={receiptTone(r.status)}>{receiptLabel(r.status)}</Badge>
              </div>
              {#if r.reference}
                <div class="mt-0.5 truncate text-xs text-ink-muted">Réf : {r.reference}</div>
              {/if}
              <div class="mt-1 flex items-center justify-between text-[11px] text-ink-faint">
                <span>{r._count.lines} ligne(s)</span>
                <span>{fmtDate(r.createdAt)}</span>
              </div>
            </a>
          {/each}
        {/if}
      </div>
    </div>

    <!-- Column 2: Inventory integrity (Mise en stock / signaux) -->
    <div class="flex w-72 shrink-0 flex-col rounded-card border border-edge-soft bg-surface-muted">
      <div class="flex items-center justify-between gap-2 px-3 py-2">
        <div>
          <div class="text-sm font-semibold text-ink">Mise en stock</div>
          <div class="text-[11px] text-ink-faint">Intégrité du stock</div>
        </div>
        <Badge tone={negativeBins.length > 0 ? 'danger' : 'neutral'}>
          {negativeBins.length + belowMin.length}
        </Badge>
      </div>
      <div class="flex max-h-[70vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
        {#if negativeBins.length === 0 && belowMin.length === 0}
          <p class="px-1 py-6 text-center text-xs text-ink-faint">
            Aucun écart de stock à corriger.
          </p>
        {/if}
        {#each negativeBins as nb (nb.id)}
          <a
            href="/wms/inventory"
            class="block rounded-inner border border-danger-soft bg-danger-soft p-2.5"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm font-semibold text-ink">{nb.item.sku}</span>
              <Badge tone="danger">{nb.qtyOnHand}</Badge>
            </div>
            <div class="mt-0.5 text-[11px] text-ink-muted">Bin {nb.bin.code} · solde négatif</div>
          </a>
        {/each}
        {#each belowMin as bm (bm.id)}
          <a
            href="/wms/inventory"
            class="block rounded-inner border border-edge-soft bg-warn-soft p-2.5"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm font-semibold text-ink">{bm.sku}</span>
              <Badge tone="warn">{bm.onHand}</Badge>
            </div>
            <div class="mt-0.5 truncate text-[11px] text-ink-muted">
              {bm.name} · sous le minimum{bm.reorderPoint != null ? ` (${bm.reorderPoint})` : ''}
            </div>
          </a>
        {/each}
      </div>
    </div>

    <!-- Column 3: Outbound picking (Prélèvement) -->
    <div class="flex w-72 shrink-0 flex-col rounded-card border border-edge-soft bg-surface-muted">
      <div class="flex items-center justify-between gap-2 px-3 py-2">
        <div>
          <div class="text-sm font-semibold text-ink">Prélèvement</div>
          <div class="text-[11px] text-ink-faint">Sortant — en cours</div>
        </div>
        <Badge tone="warn">{openPicks.length + pickedPicks.length}</Badge>
      </div>
      <div class="flex max-h-[70vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
        {#if openPicks.length + pickedPicks.length === 0}
          <p class="px-1 py-6 text-center text-xs text-ink-faint">Aucun prélèvement actif.</p>
        {:else}
          {#each [...openPicks, ...pickedPicks] as p (p.id)}
            <a
              href={`/wms/picking/${p.id}`}
              class="block rounded-inner border border-edge-soft bg-surface p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-semibold text-ink">{p.number}</span>
                <Badge tone={pickTone(p.status)}>{pickLabel(p.status)}</Badge>
              </div>
              {#if p.shipment}
                <div class="mt-0.5 text-[11px] font-medium text-accent">↔ {p.shipment.shipmentNumber}</div>
              {/if}
              <div class="mt-1 flex items-center justify-between text-[11px] text-ink-faint">
                <span>{p._count.lines} ligne(s)</span>
                <span>{fmtDate(p.createdAt)}</span>
              </div>
            </a>
          {/each}
        {/if}
      </div>
    </div>

    <!-- Column 4: Staging (Préparation des expéditions) -->
    <div class="flex w-72 shrink-0 flex-col rounded-card border border-edge-soft bg-surface-muted">
      <div class="flex items-center justify-between gap-2 px-3 py-2">
        <div>
          <div class="text-sm font-semibold text-ink">Préparation</div>
          <div class="text-[11px] text-ink-faint">Staging des expéditions</div>
        </div>
        <Badge tone="neutral">{stagingPending.length}</Badge>
      </div>
      <div class="flex max-h-[70vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
        {#if stagingPending.length === 0}
          <p class="px-1 py-6 text-center text-xs text-ink-faint">
            Aucune expédition à préparer.
          </p>
        {:else}
          {#each stagingPending as s (s.id)}
            {@const linkedPick = s.pickOrders[0]}
            <a
              href={linkedPick ? `/wms/picking/${linkedPick.id}` : `/wms/picking?shipmentId=${s.id}`}
              class="block rounded-inner border border-edge-soft bg-surface p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-semibold text-ink">{s.shipmentNumber}</span>
                <Badge tone={pickStatusTone(s.pickStatus)}>{pickStatusLabel(s.pickStatus)}</Badge>
              </div>
              <div class="mt-0.5 truncate text-[11px] text-ink-muted">
                {s.originLocation?.code ?? '—'} → {s.destinationLocation?.code ?? '—'}
              </div>
              <div class="mt-1 flex items-center justify-between text-[11px] text-ink-faint">
                <span>{s.pickOrders.length} pick(s)</span>
                <span>{fmtDate(s.plannedPickupEarly)}</span>
              </div>
            </a>
          {/each}
        {/if}
      </div>
    </div>
  </div>

  <!-- Footnote: deep links to the workbenches -->
  <div class="mt-4 flex flex-wrap gap-2">
    <a
      href="/wms/receiving"
      class="rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink hover:bg-surface-muted"
    >
      Réception
    </a>
    <a
      href="/wms/picking"
      class="rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink hover:bg-surface-muted"
    >
      Prélèvement
    </a>
    <a
      href="/wms/fulfillment"
      class="rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink hover:bg-surface-muted"
    >
      Préparation
    </a>
    <a
      href="/wms/inventory"
      class="rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink hover:bg-surface-muted"
    >
      Inventaire
    </a>
  </div>
{/if}
