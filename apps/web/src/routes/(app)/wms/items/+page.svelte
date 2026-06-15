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
    Skeleton,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface Item {
    id: string;
    sku: string;
    name: string;
    unit: string;
    barcode?: string | null;
    isActive: boolean;
  }

  let items = $state<Item[]>([]);
  let loading = $state(true);
  let error = $state('');
  let search = $state('');

  // Create / edit modal
  let formOpen = $state(false);
  let editId = $state<string | null>(null);
  let formSku = $state('');
  let formName = $state('');
  let formUnit = $state('EA');
  let formBarcode = $state('');
  let formActive = $state(true);
  let saving = $state(false);

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await api<Paginated<Item>>('/wms/items', {
        query: { pageSize: 100, search: search.trim() || undefined },
      });
      items = res.items;
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
    formActive = true;
    formOpen = true;
  }

  function openEdit(it: Item) {
    editId = it.id;
    formSku = it.sku;
    formName = it.name;
    formUnit = it.unit;
    formBarcode = it.barcode ?? '';
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

<PageHeader title="Articles">
  {#snippet actions()}
    <Button onclick={openCreate}>Nouvel article</Button>
  {/snippet}
</PageHeader>

<div class="mb-4 flex items-center gap-3">
  <a href="/wms" class="text-sm text-accent hover:underline">← Warehouse</a>
  <div class="max-w-sm flex-1">
    <Input bind:value={search} placeholder="Rechercher par SKU ou nom…" />
  </div>
</div>

{#if loading}
  <div class="grid gap-3">
    {#each Array(4) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else}
  <Card padded={false}>
    {#if items.length === 0}
      <EmptyState message="Aucun article." />
    {:else}
      <div class="divide-y divide-edge">
        {#each items as it (it.id)}
          <div class="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span class="font-medium text-ink">{it.sku}</span>
            <span class="text-ink-muted">{it.name}</span>
            <span class="text-ink-faint">{it.unit}</span>
            <Badge tone={it.isActive ? 'ok' : 'neutral'}>{it.isActive ? 'Actif' : 'Inactif'}</Badge>
            <span class="ml-auto"><Button variant="ghost" onclick={() => openEdit(it)}>Modifier</Button></span>
          </div>
        {/each}
      </div>
    {/if}
  </Card>
{/if}

<Modal bind:open={formOpen} title={editId ? "Modifier l'article" : 'Nouvel article'}>
  <div class="space-y-3">
    <Field label="SKU">
      <Input bind:value={formSku} placeholder="SKU-001" />
    </Field>
    <Field label="Nom">
      <Input bind:value={formName} placeholder="Désignation" />
    </Field>
    <Field label="Unité">
      <Input bind:value={formUnit} placeholder="EA" />
    </Field>
    <Field label="Code-barres">
      <Input bind:value={formBarcode} placeholder="Optionnel" />
    </Field>
    <Field label="Actif">
      <label class="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" bind:checked={formActive} />
        Article actif
      </label>
    </Field>
  </div>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => { formOpen = false; }}>Annuler</Button>
    <Button loading={saving} onclick={submit}>Enregistrer</Button>
  {/snippet}
</Modal>
