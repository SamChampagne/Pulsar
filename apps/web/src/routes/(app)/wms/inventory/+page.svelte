<script lang="ts">
  import { onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { auth } from '$lib/stores/auth';
  import { PERMISSIONS, type WmsMoveResult } from '@pulsar/shared';
  import { confirmAction } from '$lib/stores/confirmation';
  import {
    pendingMove,
    rememberMove,
    resolveMove,
    moveScope,
    type MoveIntent,
  } from '$lib/wms/move-intent';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    EntityPicker,
    ErrorNotice,
    Field,
    Input,
    Modal,
    PageHeader,
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
  let moveError = $state('');
  const canManage = $derived(!!$auth?.user.permissions.includes(PERMISSIONS.WMS.MANAGE));

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
    if ($pendingMove) {
      toast.error('Reprenez d’abord le déplacement en attente.');
      return;
    }
    moveItemId = '';
    moveFromBinId = '';
    moveToBinId = '';
    moveQty = 0;
    moveNote = '';
    moveOpen = true;
    moveError = '';
  }

  function openAdjust() {
    adjustItemId = '';
    adjustBinId = '';
    adjustDelta = 0;
    adjustNote = '';
    adjustOpen = true;
  }

  async function submitMove() {
    if (moveSaving || $pendingMove || !canManage) return;
    if (!moveItemId || !moveFromBinId || !moveToBinId || !moveQty) {
      toast.error('Article, bins source/destination et quantité sont requis');
      return;
    }
    moveSaving = true;
    moveError = '';
    let intent: MoveIntent | null = null;
    const scope = moveScope();
    try {
      if (
        !(await confirmAction(
          'Confirmer le déplacement de stock entre les emplacements sélectionnés ? Le journal conservera ce mouvement.',
          { title: 'Confirmer le déplacement', confirmLabel: 'Déplacer le stock' },
        ))
      )
        return;
      if (moveScope() !== scope) throw new Error('La session a changé.');
      intent = rememberMove(
        {
          operationKey: crypto.randomUUID(),
          itemId: moveItemId,
          fromBinId: moveFromBinId,
          toBinId: moveToBinId,
          qty: Number(moveQty),
          ...(moveNote ? { note: moveNote } : {}),
        },
        `${moveQty} ${items.find((i) => i.id === moveItemId)?.unit ?? ''} de ${items.find((i) => i.id === moveItemId)?.sku ?? 'l’article'} : ${bins.find((b) => b.id === moveFromBinId)?.code ?? 'source'} → ${bins.find((b) => b.id === moveToBinId)?.code ?? 'destination'}`,
      );
      await api<WmsMoveResult>('/wms/inventory/move', {
        method: 'POST',
        body: intent.request,
      });
      resolveMove(intent);
      toast.success('Stock déplacé');
      moveOpen = false;
      await load();
    } catch (e) {
      if (intent && e instanceof ApiError && [400, 403, 404, 409, 422].includes(e.statusCode))
        resolveMove(intent);
      moveError = $pendingMove
        ? 'Résultat non confirmé. Fermez et reprenez la demande conservée en haut de la page, sans créer un nouveau déplacement.'
        : e instanceof Error
          ? e.message
          : 'Échec du déplacement';
    } finally {
      moveSaving = false;
    }
  }
  onMount(() => {
    const refresh = () => {
      moveOpen = false;
      void load();
    };
    window.addEventListener('wms:stock-changed', refresh);
    return () => window.removeEventListener('wms:stock-changed', refresh);
  });
  beforeNavigate(({ cancel }) => {
    if (moveSaving) cancel();
  });

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
    <Button variant="secondary" href="/wms/movements">Journal des mouvements</Button>
    {#if canManage}<Button variant="secondary" onclick={openAdjust}>Ajuster</Button>
      <Button onclick={openMove} disabled={!!$pendingMove}>Déplacer</Button>{/if}
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
            <a
              class="text-xs text-accent hover:underline"
              href={`/wms/movements?itemId=${encodeURIComponent(lvl.itemId)}&binId=${encodeURIComponent(lvl.binId)}`}
              >Journal ↗</a
            >
            <span
              class={`ml-auto font-semibold ${Number(lvl.qtyOnHand) < 0 ? 'text-danger' : 'text-ink'}`}
            >
              {lvl.qtyOnHand}
              {lvl.item.unit}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </Card>
{/if}

<!-- Move modal -->
<Modal bind:open={moveOpen} title="Déplacer du stock" dismissible={!moveSaving}>
  <fieldset class="min-w-0 space-y-3" disabled={moveSaving || !!$pendingMove}>
    <Field label="Article">
      <EntityPicker
        endpoint="/wms/choices/items"
        label="Article"
        labelKey="name"
        detailKey="sku"
        bind:value={moveItemId}
      />
    </Field>
    <Field label="Bin source">
      <EntityPicker
        endpoint="/wms/bins"
        label="Bin source"
        labelKey="code"
        detailKey="kind"
        listShape="array"
        bind:value={moveFromBinId}
      />
    </Field>
    <Field label="Bin destination">
      <EntityPicker
        endpoint="/wms/bins"
        label="Bin destination"
        labelKey="code"
        detailKey="kind"
        listShape="array"
        bind:value={moveToBinId}
      />
    </Field>
    <Field label="Quantité">
      <Input type="number" bind:value={moveQty} min={0} step="any" />
    </Field>
    <Field label="Note">
      <Textarea bind:value={moveNote} />
    </Field>
  </fieldset>
  <ErrorNotice message={moveError} />
  {#snippet footer()}
    <Button
      variant="secondary"
      disabled={moveSaving}
      onclick={() => {
        moveOpen = false;
      }}>Fermer</Button
    >
    <Button loading={moveSaving} disabled={!!$pendingMove} onclick={submitMove}>Déplacer</Button>
  {/snippet}
</Modal>

<!-- Adjust modal -->
<Modal bind:open={adjustOpen} title="Ajuster le stock">
  <div class="space-y-3">
    <Field label="Article">
      <EntityPicker
        endpoint="/wms/choices/items"
        label="Article"
        labelKey="name"
        detailKey="sku"
        bind:value={adjustItemId}
      />
    </Field>
    <Field label="Bin">
      <EntityPicker
        endpoint="/wms/bins"
        label="Bin"
        labelKey="code"
        detailKey="kind"
        listShape="array"
        bind:value={adjustBinId}
      />
    </Field>
    <Field label="Delta (peut être négatif)">
      <Input type="number" bind:value={adjustDelta} step="any" />
    </Field>
    <Field label="Note">
      <Textarea bind:value={adjustNote} />
    </Field>
  </div>
  {#snippet footer()}
    <Button
      variant="secondary"
      onclick={() => {
        adjustOpen = false;
      }}>Annuler</Button
    >
    <Button loading={adjustSaving} onclick={submitAdjust}>Ajuster</Button>
  {/snippet}
</Modal>
