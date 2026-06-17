<script lang="ts">
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
    Select,
    Skeleton,
  } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface ReceiptLine {
    id: string;
    itemId: string;
    toBinId: string;
    qty: string;
    item: { sku: string; name: string };
    toBin: { code: string };
  }

  interface ReceiptDetail {
    id: string;
    number: string;
    status: string;
    locationId: string;
    reference?: string | null;
    note?: string | null;
    createdAt: string;
    _count: { lines: number };
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

  const receiptId = $derived(page.params.id);

  let receipt = $state<ReceiptDetail | null>(null);
  let items = $state<Item[]>([]);
  let bins = $state<Bin[]>([]);
  let warehouses = $state<LocationOption[]>([]);
  let loading = $state(true);
  let error = $state('');

  // Add-line modal
  let addLineOpen = $state(false);
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

  // Bins that belong to the receipt's location.
  const selectedBins = $derived(
    receipt ? bins.filter((b) => b.locationId === receipt!.locationId) : [],
  );

  async function load() {
    loading = true;
    error = '';
    try {
      const [rec, itemsRes, binsRes, locsRes] = await Promise.all([
        api<ReceiptDetail>(`/wms/receipts/${receiptId}`),
        api<Paginated<Item>>('/wms/items', { query: { pageSize: 100 } }),
        api<Bin[]>('/wms/bins'),
        api<Paginated<LocationOption>>('/transportation/locations', { query: { pageSize: 100 } }),
      ]);
      receipt = rec;
      items = itemsRes.items;
      bins = binsRes;
      warehouses = locsRes.items.filter((l) => l.type === 'WAREHOUSE');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement de la réception';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (receiptId) {
      void load();
    }
  });

  function openAddLine() {
    lineItemId = '';
    lineToBinId = '';
    lineQty = 0;
    addLineOpen = true;
  }

  async function addLine() {
    if (!receipt) return;
    if (!lineItemId || !lineToBinId || !lineQty) {
      toast.error('Article, bin et quantité sont requis');
      return;
    }
    lineSaving = true;
    try {
      await api(`/wms/receipts/${receipt.id}/lines`, {
        method: 'POST',
        body: { itemId: lineItemId, toBinId: lineToBinId, qty: Number(lineQty) },
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
    if (!receipt) return;
    try {
      await api(`/wms/receipts/${receipt.id}/lines/${lineId}`, { method: 'DELETE' });
      toast.success('Ligne retirée');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du retrait');
    }
  }

  async function postReceipt() {
    if (!receipt) return;
    try {
      await api(`/wms/receipts/${receipt.id}/post`, { method: 'POST' });
      toast.success('Réception postée');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du postage');
    }
  }

  async function cancelReceipt() {
    if (!receipt) return;
    if (!confirm('Annuler cette réception ?')) return;
    try {
      await api(`/wms/receipts/${receipt.id}/cancel`, { method: 'POST' });
      toast.success('Réception annulée');
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
{:else if receipt}
  <PageHeader title={`Réception ${receipt.number}`} subtitle={locName(receipt.locationId)}>
    {#snippet actions()}
      <Badge tone={statusTone(receipt!.status)}>{receipt!.status}</Badge>
      {#if receipt!.status === 'DRAFT'}
        <Button onclick={openAddLine}>Ajouter une ligne</Button>
        <Button
          onclick={postReceipt}
          disabled={receipt!.lines.length === 0}
        >Poster</Button>
        <Button variant="danger" onclick={cancelReceipt}>Annuler</Button>
      {/if}
    {/snippet}
  </PageHeader>

  <div class="mb-4">
    <a href="/wms/receiving" class="text-sm text-accent hover:underline">← Réceptions</a>
  </div>

  <Card>
    {#if receipt.reference}
      <p class="mb-3 text-sm text-ink-muted">Réf : {receipt.reference}</p>
    {/if}
    {#if receipt.note}
      <p class="mb-3 text-sm text-ink-muted">Note : {receipt.note}</p>
    {/if}
    <p class="mb-4 text-xs text-ink-faint">
      Créée le {new Date(receipt.createdAt).toLocaleString()}
    </p>

    {#if receipt.lines.length === 0}
      <EmptyState message="Aucune ligne." />
    {:else}
      <div class="divide-y divide-edge">
        {#each receipt.lines as line (line.id)}
          <div class="flex items-center gap-3 py-2.5 text-sm">
            <span class="font-medium text-ink">{line.item.sku}</span>
            <span class="text-ink-muted">{line.item.name}</span>
            <span class="text-ink-faint">→ {line.toBin.code}</span>
            <span class="ml-auto font-semibold text-ink">{line.qty}</span>
            {#if receipt!.status === 'DRAFT'}
              <Button variant="ghost" onclick={() => removeLine(line.id)}>Retirer</Button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </Card>
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
  </div>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => { addLineOpen = false; }}>Annuler</Button>
    <Button loading={lineSaving} onclick={addLine}>Ajouter</Button>
  {/snippet}
</Modal>
