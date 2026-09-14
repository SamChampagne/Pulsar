<script lang="ts">
  import { confirmAction } from '$lib/stores/confirmation';
  import { page } from '$app/state';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorNotice,
    Field,
    Input,
    Modal,
    PageHeader,
    RelatedEntities,
    Select,
    Skeleton,
    StatusTimeline,
  } from '$lib/components/ui';
  import type { RelatedGroup, Tone, TimelineEntry } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface ShipmentRef {
    id: string;
    shipmentNumber: string;
    status: string;
  }

  interface PickLine {
    id: string;
    itemId: string;
    fromBinId: string;
    qty: string;
    item: { sku: string; name: string };
    fromBin: { code: string };
  }

  interface PickDetail {
    id: string;
    number: string;
    status: string;
    locationId: string;
    reference?: string | null;
    note?: string | null;
    createdAt: string;
    // Present on the same GET (full record, no `select`) but not previously typed.
    completedAt?: string | null;
    shipment?: ShipmentRef | null;
    _count: { lines: number };
    lines: PickLine[];
  }

  interface Item {
    id: string;
    sku: string;
    name: string;
    unit: string;
  }

  interface Bin {
    id: string;
    code: string;
    kind: string;
    locationId: string;
    location: { code: string; name: string };
  }

  interface Level {
    id: string;
    itemId: string;
    binId: string;
    qtyOnHand: string;
  }

  interface LocationOption {
    id: string;
    code: string;
    name: string;
    type: string;
  }

  const orderId = $derived(page.params.id);

  let order = $state<PickDetail | null>(null);
  let items = $state<Item[]>([]);
  let bins = $state<Bin[]>([]);
  let warehouses = $state<LocationOption[]>([]);
  let loading = $state(true);
  let error = $state('');

  // Add-line modal
  let addLineOpen = $state(false);
  let lineItemId = $state('');
  let lineFromBinId = $state('');
  let lineQty = $state<number>(0);
  let lineSaving = $state(false);
  let availableOnHand = $state<number | null>(null);

  function statusTone(status: string): Tone {
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

  function statusLabel(status: string): string {
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

  function locName(id: string): string {
    const l = warehouses.find((w) => w.id === id);
    return l ? `${l.code} — ${l.name}` : id;
  }

  // Bins that belong to this order's location.
  const selectedBins = $derived(
    order ? bins.filter((b) => b.locationId === order!.locationId) : [],
  );

  // "Lié à" — only ids the page already has are linked. The warehouse location
  // has no detail route yet, so it's shown informationally (no href). The linked
  // shipment's `select` (picking.service.ts `get`) only returns id/number/status —
  // no loadId/transportOrderId — so the chain up to the transport order/load can't
  // be linked without a wider API select; shown informationally too.
  const relatedGroups = $derived<RelatedGroup[]>(
    order
      ? [
          {
            label: 'Entrepôt',
            items: [{ label: locName(order.locationId) }],
          },
          {
            label: 'Expédition',
            items: order.shipment
              ? [
                  {
                    label: order.shipment.shipmentNumber,
                    sublabel: statusLabel(order.shipment.status),
                    tone: statusTone(order.shipment.status),
                  },
                ]
              : [],
          },
        ]
      : [],
  );

  const timelineEntries = $derived<TimelineEntry[]>(
    order
      ? [
          { label: 'Pick order créé', timestamp: order.createdAt, tone: 'neutral' },
          ...(order.completedAt
            ? [{ label: 'Complété', timestamp: order.completedAt, tone: 'ok' as const }]
            : []),
          {
            label: statusLabel(order.status),
            description: 'Statut actuel',
            tone: statusTone(order.status),
          },
        ]
      : [],
  );

  async function load() {
    loading = true;
    error = '';
    try {
      const [ord, itemsRes, binsRes, locsRes] = await Promise.all([
        api<PickDetail>(`/wms/pick-orders/${orderId}`),
        api<Paginated<Item>>('/wms/items', { query: { pageSize: 100 } }),
        api<Bin[]>('/wms/bins'),
        api<Paginated<LocationOption>>('/transportation/locations', { query: { pageSize: 100 } }),
      ]);
      order = ord;
      items = itemsRes.items;
      bins = binsRes;
      warehouses = locsRes.items.filter((l) => l.type === 'WAREHOUSE');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement du pick order';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (orderId) {
      void load();
    }
  });

  // Refresh the available on-hand whenever item + from-bin are both chosen.
  $effect(() => {
    const itemId = lineItemId;
    const binId = lineFromBinId;
    if (!itemId || !binId) {
      availableOnHand = null;
      return;
    }
    void (async () => {
      try {
        const levels = await api<Level[]>('/wms/inventory', { query: { itemId, binId } });
        const match = levels.find((l) => l.itemId === itemId && l.binId === binId);
        availableOnHand = match ? Number(match.qtyOnHand) : 0;
      } catch {
        availableOnHand = null;
      }
    })();
  });

  function openAddLine() {
    lineItemId = '';
    lineFromBinId = '';
    lineQty = 0;
    availableOnHand = null;
    addLineOpen = true;
  }

  async function addLine() {
    if (!order) return;
    if (!lineItemId || !lineFromBinId || !lineQty) {
      toast.error('Article, bin et quantité sont requis');
      return;
    }
    lineSaving = true;
    try {
      await api(`/wms/pick-orders/${order.id}/lines`, {
        method: 'POST',
        body: { itemId: lineItemId, fromBinId: lineFromBinId, qty: Number(lineQty) },
      });
      toast.success('Ligne ajoutée');
      addLineOpen = false;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'ajout de la ligne");
    } finally {
      lineSaving = false;
    }
  }

  async function removeLine(lineId: string) {
    if (!order) return;
    try {
      await api(`/wms/pick-orders/${order.id}/lines/${lineId}`, { method: 'DELETE' });
      toast.success('Ligne retirée');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du retrait');
    }
  }

  async function completeOrder() {
    if (!order) return;
    try {
      await api(`/wms/pick-orders/${order.id}/complete`, { method: 'POST' });
      toast.success('Pick order complété');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la complétion');
    }
  }

  async function cancelOrder() {
    if (!order) return;
    if (!(await confirmAction('Annuler ce pick order ?'))) return;
    try {
      await api(`/wms/pick-orders/${order.id}/cancel`, { method: 'POST' });
      toast.success('Pick order annulé');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'annulation");
    }
  }
</script>

{#if loading}
  <div class="grid gap-3">
    {#each Array(4) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <ErrorNotice message={error} onretry={load} />
{:else if order}
  <PageHeader title={`Prélèvement ${order.number}`} subtitle={locName(order.locationId)}>
    {#snippet actions()}
      <Badge tone={statusTone(order!.status)}>{statusLabel(order!.status)}</Badge>
      {#if order!.status === 'OPEN'}
        <Button onclick={openAddLine}>Ajouter une ligne</Button>
        <Button onclick={completeOrder} disabled={order!.lines.length === 0}>Compléter</Button>
        <Button variant="danger" onclick={cancelOrder}>Annuler</Button>
      {:else if order!.status === 'PICKED'}
        <Button onclick={completeOrder} disabled={order!.lines.length === 0}>Compléter</Button>
        <Button variant="danger" onclick={cancelOrder}>Annuler</Button>
      {/if}
    {/snippet}
  </PageHeader>

  <div class="mb-4">
    <a href="/wms/picking" class="text-sm text-accent hover:underline">← Prélèvements</a>
  </div>

  <div class="grid gap-4 lg:grid-cols-3">
    <div class="lg:col-span-2">
      <Card>
        {#if order.shipment}
          <p class="mb-3 text-sm font-medium text-accent">↔ {order.shipment.shipmentNumber}</p>
        {/if}
        {#if order.reference}
          <p class="mb-3 text-sm text-ink-muted">Réf : {order.reference}</p>
        {/if}
        {#if order.note}
          <p class="mb-3 text-sm text-ink-muted">Note : {order.note}</p>
        {/if}
        <p class="mb-4 text-xs text-ink-faint">
          Créé le {new Date(order.createdAt).toLocaleString()}
        </p>

        {#if order.lines.length === 0}
          <EmptyState message="Aucune ligne." />
        {:else}
          <div class="divide-y divide-edge">
            {#each order.lines as line (line.id)}
              <div class="flex items-center gap-3 py-2.5 text-sm">
                <span class="font-medium text-ink">{line.item.sku}</span>
                <span class="text-ink-muted">{line.item.name}</span>
                <span class="text-ink-faint">{line.fromBin.code} →</span>
                <span class="ml-auto font-semibold text-ink">{line.qty}</span>
                {#if order!.status === 'OPEN'}
                  <Button variant="ghost" onclick={() => removeLine(line.id)}>Retirer</Button>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </Card>
    </div>

    <div class="flex flex-col gap-4">
      <Card>
        <h2 class="mb-3 font-semibold text-ink">Historique</h2>
        <StatusTimeline entries={timelineEntries} />
      </Card>
      <Card>
        <RelatedEntities groups={relatedGroups} />
      </Card>
    </div>
  </div>
{/if}

<!-- Add-line modal -->
<Modal bind:open={addLineOpen} title="Ajouter une ligne">
  <div class="space-y-3">
    <Field label="Article">
      <Select bind:value={lineItemId}>
        <option value="">— Sélectionner —</option>
        {#each items as it (it.id)}
          <option value={it.id}>{it.sku} — {it.name}</option>
        {/each}
      </Select>
    </Field>
    <Field label="Bin source">
      <Select bind:value={lineFromBinId}>
        <option value="">— Sélectionner —</option>
        {#each selectedBins as b (b.id)}
          <option value={b.id}>{b.code} ({b.kind})</option>
        {/each}
      </Select>
    </Field>
    {#if availableOnHand !== null}
      <p class={`text-xs ${availableOnHand <= 0 ? 'text-danger' : 'text-ink-muted'}`}>
        Disponible dans ce bin : <span class="font-semibold">{availableOnHand}</span>
      </p>
    {/if}
    <Field label="Quantité">
      <Input type="number" bind:value={lineQty} min={0} step="any" />
    </Field>
  </div>
  {#snippet footer()}
    <Button
      variant="secondary"
      onclick={() => {
        addLineOpen = false;
      }}>Annuler</Button
    >
    <Button loading={lineSaving} onclick={addLine}>Ajouter</Button>
  {/snippet}
</Modal>
