<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    Field,
    FilterBar,
    Input,
    Panel,
    PageHeader,
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
    isActive: boolean;
  }

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
      onkeydown={(e) => { if (e.key === 'Enter') void load(); }}
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
      <th>SKU</th><th>Nom</th><th>Unité</th><th>Code-barres</th><th>Statut</th>
    {/snippet}
    {#snippet body()}
      {#each items as it (it.id)}
        <tr class="cursor-pointer" onclick={() => openEdit(it)}>
          <td class="font-mono font-semibold text-ink">{it.sku}</td>
          <td>{it.name}</td>
          <td class="text-ink-muted">{it.unit}</td>
          <td class="font-mono text-ink-muted">{it.barcode ?? '—'}</td>
          <td><Badge tone={it.isActive ? 'ok' : 'neutral'}>{it.isActive ? 'Actif' : 'Inactif'}</Badge></td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Panel bind:open={formOpen} title={editId ? "Modifier l'article" : 'Nouvel article'}>
  {#snippet children()}
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
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={() => { formOpen = false; }}>Annuler</Button>
        <Button variant="primary" loading={saving} onclick={submit}>Enregistrer</Button>
      </div>
    </div>
  {/snippet}
</Panel>
