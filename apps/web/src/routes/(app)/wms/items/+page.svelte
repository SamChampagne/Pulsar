<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { WMS_UNITS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    Field,
    FilterBar,
    Input,
    Modal,
    PageHeader,
    ReferenceSelect,
    Skeleton,
    Table,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface Item {
    id: string;
    sku: string;
    name: string;
    unit: string;
    barcode?: string | null;
    reorderPoint?: number | null;
    reorderQty?: number | null;
    isActive: boolean;
    onHand?: number;
    replenishment?: { status: 'OK' | 'LOW' | 'BELOW_MIN'; belowMin: boolean; suggestedQty: number };
  }

  function replTone(status?: string): 'ok' | 'warn' | 'danger' | 'neutral' {
    return status === 'BELOW_MIN' ? 'danger' : status === 'LOW' ? 'warn' : 'ok';
  }

  const BASE_UNIT_OPTIONS = WMS_UNITS.map((u) => ({ value: u.code, label: u.name }));

  let items = $state<Item[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let error = $state('');
  let search = $state('');

  // Create / edit panel
  let formOpen = $state(false);
  let editId = $state<string | null>(null);
  let formSku = $state('');
  let formName = $state('');
  let formUnit = $state('EA');
  let formBarcode = $state('');
  let formReorderPoint = $state('');
  let formReorderQty = $state('');
  let formActive = $state(true);
  let saving = $state(false);

  /** The closed vocabulary, plus the current value when it's an unknown unit
   *  already stored on an existing item — never silently dropped. */
  const unitOptions = $derived(
    formUnit && !BASE_UNIT_OPTIONS.some((o) => o.value === formUnit)
      ? [...BASE_UNIT_OPTIONS, { value: formUnit, label: formUnit }]
      : BASE_UNIT_OPTIONS,
  );

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await api<Paginated<Item>>('/wms/items', {
        query: { pageSize: 100, search: search.trim() || undefined },
      });
      items = res.items;
      total = res.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des articles';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  function openCreate() {
    editId = null;
    formSku = '';
    formName = '';
    formUnit = 'EA';
    formBarcode = '';
    formReorderPoint = '';
    formReorderQty = '';
    formActive = true;
    formOpen = true;
  }

  function openEdit(it: Item) {
    editId = it.id;
    formSku = it.sku;
    formName = it.name;
    formUnit = it.unit;
    formBarcode = it.barcode ?? '';
    formReorderPoint = it.reorderPoint != null ? String(it.reorderPoint) : '';
    formReorderQty = it.reorderQty != null ? String(it.reorderQty) : '';
    formActive = it.isActive;
    formOpen = true;
  }

  async function submit() {
    if (!formSku.trim() || !formName.trim()) {
      toast.error('SKU et nom sont requis');
      return;
    }
    saving = true;
    try {
      const body = {
        sku: formSku.trim(),
        name: formName.trim(),
        unit: formUnit.trim() || 'EA',
        barcode: formBarcode.trim() || undefined,
        reorderPoint: formReorderPoint !== '' ? Number(formReorderPoint) : undefined,
        reorderQty: formReorderQty !== '' ? Number(formReorderQty) : undefined,
        isActive: formActive,
      };
      if (editId) {
        await api(`/wms/items/${editId}`, { method: 'PATCH', body });
        toast.success('Article mis à jour');
      } else {
        await api('/wms/items', { method: 'POST', body });
        toast.success('Article créé');
      }
      formOpen = false;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'enregistrement");
    } finally {
      saving = false;
    }
  }
</script>

<PageHeader title="Articles" count={total}>
  {#snippet actions()}
    <Button onclick={openCreate}>Nouvel article</Button>
  {/snippet}
</PageHeader>

<FilterBar>
  <a href="/wms" class="text-sm text-accent hover:underline">← Entrepôt</a>
  <div class="w-72">
    <input
      placeholder="Rechercher par SKU ou nom…"
      bind:value={search}
      onkeydown={(e) => {
        if (e.key === 'Enter') void load();
      }}
      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
    />
  </div>
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else if items.length === 0}
  <Card>
    <EmptyState message="Aucun article pour le moment.">
      {#snippet children()}
        <Button onclick={openCreate}>Nouvel article</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>SKU</th><th>Nom</th><th>Unité</th><th class="text-right">Stock</th><th class="text-right"
        >Min / cible</th
      ><th>Réappro</th><th>Statut</th><th>Traçabilité</th>
    {/snippet}
    {#snippet body()}
      {#each items as it (it.id)}
        <tr class="cursor-pointer" onclick={() => openEdit(it)}>
          <td class="font-mono font-semibold text-ink">{it.sku}</td>
          <td>{it.name}</td>
          <td class="text-ink-muted">{it.unit}</td>
          <td class="text-right text-ink">{it.onHand ?? 0}</td>
          <td class="text-right text-ink-muted">
            {it.reorderPoint != null
              ? `${it.reorderPoint}${it.reorderQty != null ? ` / ${it.reorderQty}` : ''}`
              : '—'}
          </td>
          <td>
            {#if it.reorderPoint != null}
              <Badge tone={replTone(it.replenishment?.status)}>
                {it.replenishment?.status === 'BELOW_MIN'
                  ? `Réappro ~${it.replenishment?.suggestedQty}`
                  : it.replenishment?.status === 'LOW'
                    ? 'Bas'
                    : 'OK'}
              </Badge>
            {:else}
              <span class="text-xs text-ink-faint">—</span>
            {/if}
          </td>
          <td
            ><Badge tone={it.isActive ? 'ok' : 'neutral'}>{it.isActive ? 'Actif' : 'Inactif'}</Badge
            ></td
          >
          <td
            ><a
              class="text-xs text-accent hover:underline"
              href={`/wms/movements?itemId=${encodeURIComponent(it.id)}`}
              onclick={(e) => e.stopPropagation()}>Journal ↗</a
            ></td
          >
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Modal bind:open={formOpen} title={editId ? "Modifier l'article" : 'Nouvel article'} size="md">
  {#snippet children()}
    <div class="space-y-3">
      <Field label="SKU">
        <Input bind:value={formSku} placeholder="SKU-001" />
      </Field>
      <Field label="Nom">
        <Input bind:value={formName} placeholder="Désignation" />
      </Field>
      <Field label="Unité">
        <ReferenceSelect options={unitOptions} bind:value={formUnit} />
      </Field>
      <Field label="Code-barres">
        <Input bind:value={formBarcode} placeholder="Optionnel" />
      </Field>
      <div class="grid grid-cols-2 gap-3">
        <Field label="Point de réappro (min)">
          <Input bind:value={formReorderPoint} type="number" min="0" placeholder="ex. 10" />
        </Field>
        <Field label="Niveau cible">
          <Input bind:value={formReorderQty} type="number" min="0" placeholder="ex. 50" />
        </Field>
      </div>
      <Field label="Actif">
        <label class="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" bind:checked={formActive} />
          Article actif
        </label>
      </Field>
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button
          variant="secondary"
          onclick={() => {
            formOpen = false;
          }}>Annuler</Button
        >
        <Button variant="primary" loading={saving} onclick={submit}>Enregistrer</Button>
      </div>
    </div>
  {/snippet}
</Modal>
