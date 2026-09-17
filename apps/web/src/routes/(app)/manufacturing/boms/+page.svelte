<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    EntityPicker,
    Field,
    FilterBar,
    Input,
    Modal,
    PageHeader,
    Skeleton,
    Table,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface BomLine {
    id: string;
    materialRef: string;
    materialName?: string;
    quantityPerUnit: number;
  }

  interface Bom {
    id: string;
    code: string;
    name: string;
    productRef?: string | null;
    isActive: boolean;
    lines?: BomLine[];
  }

  let boms = $state<Bom[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let error = $state('');
  let search = $state('');

  // Create / edit panel
  let formOpen = $state(false);
  let editId = $state<string | null>(null);
  let formCode = $state('');
  let formName = $state('');
  let formProductRef = $state('');
  let formActive = $state(true);
  let saving = $state(false);

  // Lines editor
  let lines = $state<BomLine[]>([]);
  let lineRef = $state('');
  let lineName = $state('');
  let lineQty = $state('');
  let addingLine = $state(false);

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await api<Paginated<Bom>>('/manufacturing/boms', {
        query: { pageSize: 100, search: search.trim() || undefined },
      });
      boms = res.items;
      total = res.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des nomenclatures';
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
    formCode = '';
    formName = '';
    formProductRef = '';
    formActive = true;
    lines = [];
    resetLineForm();
    formOpen = true;
  }

  async function openEdit(b: Bom) {
    editId = b.id;
    formCode = b.code;
    formName = b.name;
    formProductRef = b.productRef ?? '';
    formActive = b.isActive;
    lines = (b.lines ?? []).slice();
    resetLineForm();
    formOpen = true;
    await refetchOne(b.id);
  }

  async function refetchOne(id: string) {
    try {
      const fresh = await api<Bom>(`/manufacturing/boms/${id}`);
      lines = (fresh.lines ?? []).slice();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du chargement des lignes');
    }
  }

  function resetLineForm() {
    lineRef = '';
    lineName = '';
    lineQty = '';
  }

  async function addLine() {
    if (!editId) {
      toast.error("Enregistrez d'abord la nomenclature");
      return;
    }
    if (!lineRef.trim() || lineQty === '') {
      toast.error('Référence et quantité sont requises');
      return;
    }
    addingLine = true;
    try {
      await api(`/manufacturing/boms/${editId}/lines`, {
        method: 'POST',
        body: {
          materialRef: lineRef.trim(),
          materialName: lineName.trim() || undefined,
          quantityPerUnit: Number(lineQty),
        },
      });
      toast.success('Ligne ajoutée');
      resetLineForm();
      await refetchOne(editId);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'ajout de la ligne");
    } finally {
      addingLine = false;
    }
  }

  async function removeLine(lineId: string) {
    if (!editId) return;
    try {
      await api(`/manufacturing/boms/${editId}/lines/${lineId}`, { method: 'DELETE' });
      toast.success('Ligne supprimée');
      await refetchOne(editId);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la suppression de la ligne');
    }
  }

  async function submit() {
    if (!formCode.trim() || !formName.trim()) {
      toast.error('Code et nom sont requis');
      return;
    }
    saving = true;
    try {
      const body = {
        code: formCode.trim(),
        name: formName.trim(),
        productRef: formProductRef.trim() || undefined,
        isActive: formActive,
      };
      if (editId) {
        await api(`/manufacturing/boms/${editId}`, { method: 'PATCH', body });
        toast.success('Nomenclature mise à jour');
      } else {
        const created = await api<Bom>('/manufacturing/boms', { method: 'POST', body });
        editId = created.id;
        lines = (created.lines ?? []).slice();
        toast.success('Nomenclature créée — ajoutez ses lignes');
        saving = false;
        await load();
        return;
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

<PageHeader title="Nomenclatures" count={total}>
  {#snippet actions()}
    <Button onclick={openCreate}>Nouvelle nomenclature</Button>
  {/snippet}
</PageHeader>

<FilterBar>
  <a href="/manufacturing" class="text-sm text-accent hover:underline">← Fabrication</a>
  <div class="w-72">
    <input
      placeholder="Rechercher par code ou nom…"
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
{:else if boms.length === 0}
  <Card>
    <EmptyState message="Aucune nomenclature pour le moment.">
      {#snippet children()}
        <Button onclick={openCreate}>Nouvelle nomenclature</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Code</th><th>Nom</th><th>Produit</th><th class="text-right">Nb lignes</th><th>Statut</th>
    {/snippet}
    {#snippet body()}
      {#each boms as b (b.id)}
        <tr class="cursor-pointer" onclick={() => openEdit(b)}>
          <td class="font-mono font-semibold text-ink">{b.code}</td>
          <td>{b.name}</td>
          <td class="text-ink-muted">{b.productRef || '—'}</td>
          <td class="text-right text-ink">{b.lines?.length ?? 0}</td>
          <td>
            <Badge tone={b.isActive ? 'ok' : 'neutral'}>{b.isActive ? 'Actif' : 'Inactif'}</Badge>
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Modal
  bind:open={formOpen}
  title={editId ? 'Modifier la nomenclature' : 'Nouvelle nomenclature'}
  size="lg"
>
  {#snippet children()}
    <div class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <Field label="Code">
          <Input bind:value={formCode} placeholder="NOM-001" />
        </Field>
        <Field label="Produit">
          <EntityPicker
            endpoint="/wms/choices/items"
            label="Produit"
            placeholder="Optionnel"
            labelKey="name"
            valueKey="sku"
            selectedLabel={formProductRef}
            bind:value={formProductRef}
          />
        </Field>
      </div>
      <Field label="Nom">
        <Input bind:value={formName} placeholder="Désignation" />
      </Field>
      <Field label="Actif">
        <label class="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" bind:checked={formActive} />
          Nomenclature active
        </label>
      </Field>

      {#if editId}
        <div class="space-y-2 border-t border-edge pt-3">
          <h3 class="text-sm font-bold text-ink">Lignes</h3>
          {#if lines.length === 0}
            <p class="text-sm text-ink-faint">Aucune ligne pour le moment.</p>
          {:else}
            <ul class="space-y-1">
              {#each lines as line (line.id)}
                <li
                  class="flex items-center justify-between gap-2 rounded-md border border-edge bg-surface px-3 py-2"
                >
                  <div class="text-sm">
                    <span class="font-mono font-semibold text-ink">{line.materialRef}</span>
                    {#if line.materialName}
                      <span class="ml-2 text-ink-muted">{line.materialName}</span>
                    {/if}
                    <span class="ml-2 text-ink-muted">× {line.quantityPerUnit}</span>
                  </div>
                  <button
                    class="text-xs text-danger hover:underline"
                    onclick={() => removeLine(line.id)}>Retirer</button
                  >
                </li>
              {/each}
            </ul>
          {/if}

          <div class="space-y-2 rounded-md border border-edge bg-surface-muted p-3">
            <div class="grid grid-cols-3 gap-2">
              <Field label="Référence matière">
                <EntityPicker
                  endpoint="/wms/choices/items"
                  label="Référence matière"
                  placeholder="MAT-001"
                  labelKey="name"
                  valueKey="sku"
                  bind:value={lineRef}
                />
              </Field>
              <Field label="Désignation">
                <Input bind:value={lineName} placeholder="Optionnel" />
              </Field>
              <Field label="Qté / unité">
                <Input bind:value={lineQty} type="number" min="0" placeholder="1" />
              </Field>
            </div>
            <div class="flex justify-end">
              <Button variant="secondary" loading={addingLine} onclick={addLine}>
                Ajouter la ligne
              </Button>
            </div>
          </div>
        </div>
      {/if}

      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button
          variant="secondary"
          onclick={() => {
            formOpen = false;
          }}>Fermer</Button
        >
        <Button variant="primary" loading={saving} onclick={submit}>Enregistrer</Button>
      </div>
    </div>
  {/snippet}
</Modal>
