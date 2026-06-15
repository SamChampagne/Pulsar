<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
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

  interface ReceiptRow {
    id: string;
    number: string;
    status: string;
    locationId: string;
    reference?: string | null;
    createdAt: string;
    _count: { lines: number };
  }

  interface ReceiptLine {
    id: string;
    itemId: string;
    toBinId: string;
    qty: string;
    item: { sku: string; name: string };
    toBin: { code: string };
  }

  interface ReceiptDetail extends ReceiptRow {
    note?: string | null;
    lines: ReceiptLine[];
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

  interface LocationOption {
    id: string;
    code: string;
    name: string;
    type: string;
  }

  let receipts = $state<ReceiptRow[]>([]);
  let items = $state<Item[]>([]);
  let bins = $state<Bin[]>([]);
  let warehouses = $state<LocationOption[]>([]);
  let loading = $state(true);
  let error = $state('');

  // Selected detail
  let selected = $state<ReceiptDetail | null>(null);
  let detailLoading = $state(false);

  // Create modal
  let createOpen = $state(false);
  let createLocationId = $state('');
  let createReference = $state('');
  let createNote = $state('');
  let createSaving = $state(false);

  // Add-line form
  let lineItemId = $state('');
  let lineToBinId = $state('');
  let lineQty = $state<number>(0);
  let lineSaving = $state(false);

  function statusTone(status: string): Tone {
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

  function locName(id: string): string {
    const l = warehouses.find((w) => w.id === id);
    return l ? `${l.code} — ${l.name}` : id;
  }

  // Bins that belong to the selected receipt's location.
  const selectedBins = $derived(
    selected ? bins.filter((b) => b.locationId === selected!.locationId) : [],
  );

  async function load() {
    loading = true;
    error = '';
    try {
      const [recs, itemsRes, binsRes, locsRes] = await Promise.all([
        api<ReceiptRow[]>('/wms/receipts'),
        api<Paginated<Item>>('/wms/items', { query: { pageSize: 100 } }),
        api<Bin[]>('/wms/bins'),
        api<Paginated<LocationOption>>('/transportation/locations', { query: { pageSize: 100 } }),
      ]);
      receipts = recs;
      items = itemsRes.items;
      bins = binsRes;
      warehouses = locsRes.items.filter((l) => l.type === 'WAREHOUSE');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des réceptions';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  async function selectReceipt(id: string) {
    detailLoading = true;
    lineItemId = '';
    lineToBinId = '';
    lineQty = 0;
    try {
      selected = await api<ReceiptDetail>(`/wms/receipts/${id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du chargement de la réception');
    } finally {
      detailLoading = false;
    }
  }

  async function reloadSelected() {
    if (selected) await selectReceipt(selected.id);
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
      const created = await api<ReceiptDetail>('/wms/receipts', {
        method: 'POST',
        body: {
          locationId: createLocationId,
          reference: createReference || undefined,
          note: createNote || undefined,
        },
      });
      toast.success('Réception créée');
      createOpen = false;
      await load();
      await selectReceipt(created.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création');
    } finally {
      createSaving = false;
    }
  }

  async function addLine() {
    if (!selected) return;
    if (!lineItemId || !lineToBinId || !lineQty) {
      toast.error('Article, bin et quantité sont requis');
      return;
    }
    lineSaving = true;
    try {
      await api(`/wms/receipts/${selected.id}/lines`, {
        method: 'POST',
        body: { itemId: lineItemId, toBinId: lineToBinId, qty: Number(lineQty) },
      });
      toast.success('Ligne ajoutée');
      lineItemId = '';
      lineToBinId = '';
      lineQty = 0;
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
      await api(`/wms/receipts/${selected.id}/lines/${lineId}`, { method: 'DELETE' });
      toast.success('Ligne retirée');
      await reloadSelected();
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du retrait');
    }
  }

  async function postReceipt() {
    if (!selected) return;
    try {
      await api(`/wms/receipts/${selected.id}/post`, { method: 'POST' });
      toast.success('Réception postée');
      await reloadSelected();
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du postage');
    }
  }

  async function cancelReceipt() {
    if (!selected) return;
    if (!confirm('Annuler cette réception ?')) return;
    try {
      await api(`/wms/receipts/${selected.id}/cancel`, { method: 'POST' });
      toast.success('Réception annulée');
      await reloadSelected();
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'annulation");
    }
  }
</script>

<PageHeader title="Réception">
  {#snippet actions()}
    <Button onclick={openCreate}>Nouvelle réception</Button>
  {/snippet}
</PageHeader>

<div class="mb-4">
  <a href="/wms" class="text-sm text-accent hover:underline">← Warehouse</a>
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
      {#if receipts.length === 0}
        <EmptyState message="Aucune réception." />
      {:else}
        <div class="divide-y divide-edge">
          {#each receipts as r (r.id)}
            <button
              type="button"
              class={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface-muted ${selected?.id === r.id ? 'bg-surface-muted' : ''}`}
              onclick={() => selectReceipt(r.id)}
            >
              <Badge tone={statusTone(r.status)}>{r.status}</Badge>
              <span class="font-medium text-ink">{r.number}</span>
              <span class="text-ink-muted">{locName(r.locationId)}</span>
              <span class="ml-auto text-xs text-ink-faint">{r._count.lines} ligne(s)</span>
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
        <EmptyState message="Sélectionnez une réception pour voir le détail." />
      {:else}
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(selected.status)}>{selected.status}</Badge>
          <h2 class="font-semibold text-ink">{selected.number}</h2>
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
                <span class="text-ink-faint">→ {line.toBin.code}</span>
                <span class="ml-auto font-semibold text-ink">{line.qty}</span>
                {#if selected.status === 'DRAFT'}
                  <Button variant="ghost" onclick={() => removeLine(line.id)}>Retirer</Button>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        {#if selected.status === 'DRAFT'}
          <div class="mt-4 flex flex-col gap-3 rounded-card border border-edge bg-surface-muted p-3">
            <Field label="Article">
              <Select bind:value={lineItemId}>
                <option value="">— Sélectionner —</option>
                {#each items as it (it.id)}
                  <option value={it.id}>{it.sku} — {it.name}</option>
                {/each}
              </Select>
            </Field>
            <Field label="Bin destination">
              <Select bind:value={lineToBinId}>
                <option value="">— Sélectionner —</option>
                {#each selectedBins as b (b.id)}
                  <option value={b.id}>{b.code} ({b.kind})</option>
                {/each}
              </Select>
            </Field>
            <Field label="Quantité">
              <Input type="number" bind:value={lineQty} min={0} step="any" />
            </Field>
            <div>
              <Button loading={lineSaving} onclick={addLine}>Ajouter la ligne</Button>
            </div>
          </div>

          <div class="mt-4 flex gap-2">
            <Button onclick={postReceipt} disabled={selected.lines.length === 0}>Poster</Button>
            <Button variant="danger" onclick={cancelReceipt}>Annuler</Button>
          </div>
        {/if}
      {/if}
    </Card>
  </div>
{/if}

<!-- Create modal -->
<Modal bind:open={createOpen} title="Nouvelle réception">
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
      <Input bind:value={createReference} placeholder="Bon de commande / fournisseur" />
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
