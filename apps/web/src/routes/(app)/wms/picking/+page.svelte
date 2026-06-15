<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    Field,
    Input,
    Modal,
    PageHeader,
    Select,
    Skeleton,
    Textarea,
  } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

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

  interface PickLine {
    id: string;
    itemId: string;
    fromBinId: string;
    qty: string;
    item: { sku: string; name: string };
    fromBin: { code: string };
  }

  interface PickDetail extends PickRow {
    note?: string | null;
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

  let orders = $state<PickRow[]>([]);
  let items = $state<Item[]>([]);
  let bins = $state<Bin[]>([]);
  let warehouses = $state<LocationOption[]>([]);
  let loading = $state(true);
  let error = $state('');

  // Selected detail
  let selected = $state<PickDetail | null>(null);
  let detailLoading = $state(false);

  // Create modal
  let createOpen = $state(false);
  let createLocationId = $state('');
  let createReference = $state('');
  let createNote = $state('');
  let createSaving = $state(false);

  // Add-line form
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

  function locName(id: string): string {
    const l = warehouses.find((w) => w.id === id);
    return l ? `${l.code} — ${l.name}` : id;
  }

  // Bins that belong to the selected order's location.
  const selectedBins = $derived(
    selected ? bins.filter((b) => b.locationId === selected!.locationId) : [],
  );

  // Optional shipment pre-filter, driven by ?shipmentId=… (set from the fulfillment workbench).
  const shipmentFilter = $derived(page.url.searchParams.get('shipmentId'));

  async function load() {
    loading = true;
    error = '';
    try {
      const [ords, itemsRes, binsRes, locsRes] = await Promise.all([
        api<PickRow[]>('/wms/pick-orders', {
          query: shipmentFilter ? { shipmentId: shipmentFilter } : undefined,
        }),
        api<Paginated<Item>>('/wms/items', { query: { pageSize: 100 } }),
        api<Bin[]>('/wms/bins'),
        api<Paginated<LocationOption>>('/transportation/locations', { query: { pageSize: 100 } }),
      ]);
      orders = ords;
      items = itemsRes.items;
      bins = binsRes;
      warehouses = locsRes.items.filter((l) => l.type === 'WAREHOUSE');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des pick orders';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    // re-run when the shipment filter changes (deep-link from the fulfillment workbench)
    void shipmentFilter;
    void load();
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

  async function selectOrder(id: string) {
    detailLoading = true;
    lineItemId = '';
    lineFromBinId = '';
    lineQty = 0;
    availableOnHand = null;
    try {
      selected = await api<PickDetail>(`/wms/pick-orders/${id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du chargement du pick order');
    } finally {
      detailLoading = false;
    }
  }

  async function reloadSelected() {
    if (selected) await selectOrder(selected.id);
  }

  function openCreate() {
    createLocationId = warehouses[0]?.id ?? '';
    createReference = '';
    createNote = '';
    createOpen = true;
  }

  async function submitCreate() {
    if (!createLocationId) {
      toast.error('Sélectionnez un entrepôt');
      return;
    }
    createSaving = true;
    try {
      const created = await api<PickDetail>('/wms/pick-orders', {
        method: 'POST',
        body: {
          locationId: createLocationId,
          reference: createReference || undefined,
          note: createNote || undefined,
        },
      });
      toast.success('Pick order créé');
      createOpen = false;
      await load();
      await selectOrder(created.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création');
    } finally {
      createSaving = false;
    }
  }

  async function addLine() {
    if (!selected) return;
    if (!lineItemId || !lineFromBinId || !lineQty) {
      toast.error('Article, bin et quantité sont requis');
      return;
    }
    lineSaving = true;
    try {
      await api(`/wms/pick-orders/${selected.id}/lines`, {
        method: 'POST',
        body: { itemId: lineItemId, fromBinId: lineFromBinId, qty: Number(lineQty) },
      });
      toast.success('Ligne ajoutée');
      lineItemId = '';
      lineFromBinId = '';
      lineQty = 0;
      availableOnHand = null;
      await reloadSelected();
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'ajout de la ligne");
    } finally {
      lineSaving = false;
    }
  }

  async function removeLine(lineId: string) {
    if (!selected) return;
    try {
      await api(`/wms/pick-orders/${selected.id}/lines/${lineId}`, { method: 'DELETE' });
      toast.success('Ligne retirée');
      await reloadSelected();
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du retrait');
    }
  }

  async function completeOrder() {
    if (!selected) return;
    try {
      await api(`/wms/pick-orders/${selected.id}/complete`, { method: 'POST' });
      toast.success('Pick order complété');
      await reloadSelected();
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la complétion');
    }
  }

  async function cancelOrder() {
    if (!selected) return;
    if (!confirm('Annuler ce pick order ?')) return;
    try {
      await api(`/wms/pick-orders/${selected.id}/cancel`, { method: 'POST' });
      toast.success('Pick order annulé');
      await reloadSelected();
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'annulation");
    }
  }
</script>

<PageHeader title="Prélèvement">
  {#snippet actions()}
    <Button onclick={openCreate}>Nouveau pick order</Button>
  {/snippet}
</PageHeader>

<div class="mb-4 flex items-center gap-3">
  <a href="/wms" class="text-sm text-accent hover:underline">← Warehouse</a>
  {#if shipmentFilter}
    <span class="text-sm text-ink-muted">
      Filtré par shipment —
      <a href="/wms/picking" class="text-accent hover:underline">tout afficher</a>
    </span>
  {/if}
</div>

{#if loading}
  <div class="grid gap-3">
    {#each Array(4) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else}
  <div class="grid gap-4 lg:grid-cols-2">
    <!-- List -->
    <Card padded={false}>
      {#if orders.length === 0}
        <EmptyState message="Aucun pick order." />
      {:else}
        <div class="divide-y divide-edge">
          {#each orders as o (o.id)}
            <button
              type="button"
              class={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface-muted ${selected?.id === o.id ? 'bg-surface-muted' : ''}`}
              onclick={() => selectOrder(o.id)}
            >
              <Badge tone={statusTone(o.status)}>{o.status}</Badge>
              <span class="font-medium text-ink">{o.number}</span>
              {#if o.shipment}
                <span class="text-xs font-medium text-accent">↔ {o.shipment.shipmentNumber}</span>
              {/if}
              <span class="text-ink-muted">{locName(o.locationId)}</span>
              <span class="ml-auto text-xs text-ink-faint">{o._count.lines} ligne(s)</span>
            </button>
          {/each}
        </div>
      {/if}
    </Card>

    <!-- Detail -->
    <Card>
      {#if detailLoading}
        <Skeleton />
      {:else if !selected}
        <EmptyState message="Sélectionnez un pick order pour voir le détail." />
      {:else}
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(selected.status)}>{selected.status}</Badge>
          <h2 class="font-semibold text-ink">{selected.number}</h2>
          {#if selected.shipment}
            <span class="text-sm font-medium text-accent">↔ {selected.shipment.shipmentNumber}</span>
          {/if}
          <span class="text-sm text-ink-muted">{locName(selected.locationId)}</span>
        </div>
        {#if selected.reference}
          <p class="mb-2 text-sm text-ink-muted">Réf : {selected.reference}</p>
        {/if}

        {#if selected.lines.length === 0}
          <EmptyState message="Aucune ligne." />
        {:else}
          <div class="divide-y divide-edge">
            {#each selected.lines as line (line.id)}
              <div class="flex items-center gap-3 py-2.5 text-sm">
                <span class="font-medium text-ink">{line.item.sku}</span>
                <span class="text-ink-muted">{line.item.name}</span>
                <span class="text-ink-faint">{line.fromBin.code} →</span>
                <span class="ml-auto font-semibold text-ink">{line.qty}</span>
                {#if selected.status === 'OPEN'}
                  <Button variant="ghost" onclick={() => removeLine(line.id)}>Retirer</Button>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        {#if selected.status === 'OPEN' || selected.status === 'PICKED'}
          {#if selected.status === 'OPEN'}
            <div class="mt-4 flex flex-col gap-3 rounded-card border border-edge bg-surface-muted p-3">
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
              <div>
                <Button loading={lineSaving} onclick={addLine}>Ajouter la ligne</Button>
              </div>
            </div>
          {/if}

          <div class="mt-4 flex gap-2">
            <Button onclick={completeOrder} disabled={selected.lines.length === 0}>Compléter</Button>
            <Button variant="danger" onclick={cancelOrder}>Annuler</Button>
          </div>
        {/if}
      {/if}
    </Card>
  </div>
{/if}

<!-- Create modal -->
<Modal bind:open={createOpen} title="Nouveau pick order">
  <div class="space-y-3">
    <Field label="Entrepôt">
      <Select bind:value={createLocationId}>
        <option value="">— Sélectionner —</option>
        {#each warehouses as w (w.id)}
          <option value={w.id}>{w.code} — {w.name}</option>
        {/each}
      </Select>
    </Field>
    <Field label="Référence">
      <Input bind:value={createReference} placeholder="Commande client / expédition" />
    </Field>
    <Field label="Note">
      <Textarea bind:value={createNote} />
    </Field>
  </div>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => { createOpen = false; }}>Annuler</Button>
    <Button loading={createSaving} onclick={submitCreate}>Créer</Button>
  {/snippet}
</Modal>
