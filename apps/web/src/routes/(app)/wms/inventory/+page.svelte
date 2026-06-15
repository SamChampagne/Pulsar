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
  import { toast } from '$lib/stores/toast';

  interface Level {
    id: string;
    itemId: string;
    binId: string;
    qtyOnHand: string;
    item: { id: string; sku: string; name: string; unit: string };
    bin: { id: string; code: string; kind: string; locationId: string };
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

  let levels = $state<Level[]>([]);
  let items = $state<Item[]>([]);
  let bins = $state<Bin[]>([]);
  let loading = $state(true);
  let error = $state('');
  let search = $state('');

  // Move modal
  let moveOpen = $state(false);
  let moveItemId = $state('');
  let moveFromBinId = $state('');
  let moveToBinId = $state('');
  let moveQty = $state<number>(0);
  let moveNote = $state('');
  let moveSaving = $state(false);

  // Adjust modal
  let adjustOpen = $state(false);
  let adjustItemId = $state('');
  let adjustBinId = $state('');
  let adjustDelta = $state<number>(0);
  let adjustNote = $state('');
  let adjustSaving = $state(false);

  // Client-side filter on sku/name, then sort by item sku then bin code.
  const filtered = $derived(
    levels
      .filter((l) => {
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        return l.item.sku.toLowerCase().includes(q) || l.item.name.toLowerCase().includes(q);
      })
      .sort((a, b) => a.item.sku.localeCompare(b.item.sku) || a.bin.code.localeCompare(b.bin.code)),
  );

  function binLabel(b: Bin): string {
    return `${b.code} (${b.kind})`;
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const [lvls, itemsRes, binsRes] = await Promise.all([
        api<Level[]>('/wms/inventory'),
        api<Paginated<Item>>('/wms/items', { query: { pageSize: 100 } }),
        api<Bin[]>('/wms/bins'),
      ]);
      levels = lvls;
      items = itemsRes.items;
      bins = binsRes.slice(0, 200);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load inventory';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  function openMove() {
    moveItemId = '';
    moveFromBinId = '';
    moveToBinId = '';
    moveQty = 0;
    moveNote = '';
    moveOpen = true;
  }

  function openAdjust() {
    adjustItemId = '';
    adjustBinId = '';
    adjustDelta = 0;
    adjustNote = '';
    adjustOpen = true;
  }

  async function submitMove() {
    if (!moveItemId || !moveFromBinId || !moveToBinId || !moveQty) {
      toast.error('Article, bins source/destination et quantité sont requis');
      return;
    }
    moveSaving = true;
    try {
      await api('/wms/inventory/move', {
        method: 'POST',
        body: {
          itemId: moveItemId,
          fromBinId: moveFromBinId,
          toBinId: moveToBinId,
          qty: Number(moveQty),
          note: moveNote || undefined,
        },
      });
      toast.success('Stock déplacé');
      moveOpen = false;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du déplacement');
    } finally {
      moveSaving = false;
    }
  }

  async function submitAdjust() {
    if (!adjustItemId || !adjustBinId || !adjustDelta) {
      toast.error('Article, bin et delta (non nul) sont requis');
      return;
    }
    adjustSaving = true;
    try {
      await api('/wms/inventory/adjust', {
        method: 'POST',
        body: {
          itemId: adjustItemId,
          binId: adjustBinId,
          qtyDelta: Number(adjustDelta),
          note: adjustNote || undefined,
        },
      });
      toast.success('Stock ajusté');
      adjustOpen = false;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'ajustement");
    } finally {
      adjustSaving = false;
    }
  }
</script>

<PageHeader title="Inventaire">
  {#snippet actions()}
    <Button variant="secondary" onclick={openAdjust}>Ajuster</Button>
    <Button onclick={openMove}>Déplacer</Button>
  {/snippet}
</PageHeader>

<div class="mb-4 max-w-sm">
  <Input bind:value={search} placeholder="Rechercher par SKU ou nom…" />
</div>

{#if loading}
  <div class="grid gap-3">
    {#each Array(4) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else}
  <Card padded={false}>
    {#if filtered.length === 0}
      <EmptyState message="Aucun stock." />
    {:else}
      <div class="divide-y divide-edge">
        {#each filtered as lvl (lvl.id)}
          <div class="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span class="font-medium text-ink">{lvl.item.sku}</span>
            <span class="text-ink-muted">{lvl.item.name}</span>
            <span class="text-ink-faint">{lvl.bin.code}</span>
            <Badge tone="neutral">{lvl.bin.kind}</Badge>
            <span
              class={`ml-auto font-semibold ${Number(lvl.qtyOnHand) < 0 ? 'text-danger' : 'text-ink'}`}
            >
              {lvl.qtyOnHand} {lvl.item.unit}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </Card>
{/if}

<!-- Move modal -->
<Modal bind:open={moveOpen} title="Déplacer du stock">
  <div class="space-y-3">
    <Field label="Article">
      <Select bind:value={moveItemId}>
        <option value="">— Sélectionner —</option>
        {#each items as it (it.id)}
          <option value={it.id}>{it.sku} — {it.name}</option>
        {/each}
      </Select>
    </Field>
    <Field label="Bin source">
      <Select bind:value={moveFromBinId}>
        <option value="">— Sélectionner —</option>
        {#each bins as b (b.id)}
          <option value={b.id}>{binLabel(b)}</option>
        {/each}
      </Select>
    </Field>
    <Field label="Bin destination">
      <Select bind:value={moveToBinId}>
        <option value="">— Sélectionner —</option>
        {#each bins as b (b.id)}
          <option value={b.id}>{binLabel(b)}</option>
        {/each}
      </Select>
    </Field>
    <Field label="Quantité">
      <Input type="number" bind:value={moveQty} min={0} step="any" />
    </Field>
    <Field label="Note">
      <Textarea bind:value={moveNote} />
    </Field>
  </div>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => { moveOpen = false; }}>Annuler</Button>
    <Button loading={moveSaving} onclick={submitMove}>Déplacer</Button>
  {/snippet}
</Modal>

<!-- Adjust modal -->
<Modal bind:open={adjustOpen} title="Ajuster le stock">
  <div class="space-y-3">
    <Field label="Article">
      <Select bind:value={adjustItemId}>
        <option value="">— Sélectionner —</option>
        {#each items as it (it.id)}
          <option value={it.id}>{it.sku} — {it.name}</option>
        {/each}
      </Select>
    </Field>
    <Field label="Bin">
      <Select bind:value={adjustBinId}>
        <option value="">— Sélectionner —</option>
        {#each bins as b (b.id)}
          <option value={b.id}>{binLabel(b)}</option>
        {/each}
      </Select>
    </Field>
    <Field label="Delta (peut être négatif)">
      <Input type="number" bind:value={adjustDelta} step="any" />
    </Field>
    <Field label="Note">
      <Textarea bind:value={adjustNote} />
    </Field>
  </div>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => { adjustOpen = false; }}>Annuler</Button>
    <Button loading={adjustSaving} onclick={submitAdjust}>Ajuster</Button>
  {/snippet}
</Modal>
