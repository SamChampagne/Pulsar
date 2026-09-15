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
    Drawer,
    PageHeader,
    Skeleton,
    Table,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';
  import { auth } from '$lib/stores/auth';

  interface BomLine {
    id: string;
    materialRef: string;
    materialName?: string;
    quantityPerUnit: string;
  }

  interface Bom {
    id: string;
    code: string;
    name: string;
    productRef?: string | null;
    isActive: boolean;
    lines?: BomLine[];
    updatedAt: string;
    _count?: { lines: number };
    revisions?: Revision[];
  }

  type Revision = {
    validFrom?: string | null;
    validUntil?: string | null;
    id: string;
    revision: number;
    outputSku: string;
    outputUnit: string;
    createdAt: string;
    lines?: { id: string; sku: string; name: string; unit: string; quantityPerUnit: string }[];
  };
  const canManage = $derived(Boolean($auth?.user.permissions.includes('manufacturing.manage')));
  const canPublish = $derived(canManage && Boolean($auth?.user.permissions.includes('wms.read')));
  let expectedUpdatedAt = $state('');
  let revisions = $state<Revision[]>([]);
  let viewed = $state<Revision | null>(null);
  let acknowledged = $state(false);
  let validFrom = $state(''),
    validUntil = $state('');
  let panelError = $state('');
  let fetching = $state(false);
  let items = $state<{ sku: string; name: string; unit: string }[]>([]);
  const itemBySku = $derived(new Map(items.map((i) => [i.sku, i])));
  let pageNumber = $state(1);

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
  const busy = $derived(saving || addingLine || fetching);
  let savedHeader = $state('');
  const headerDirty = $derived(
    Boolean(editId) && savedHeader !== JSON.stringify([formName, formProductRef, formActive]),
  );

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await api<Paginated<Bom>>('/manufacturing/boms', {
        query: { page: pageNumber, pageSize: 50, search: search.trim() || undefined },
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
    expectedUpdatedAt = '';
    revisions = [];
    viewed = null;
    acknowledged = false;
    panelError = '';
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
    validFrom = '';
    validUntil = '';
    panelError = '';
    viewed = null;
    acknowledged = false;
    editId = b.id;
    formCode = b.code;
    formName = b.name;
    formProductRef = b.productRef ?? '';
    formActive = b.isActive;
    lines = (b.lines ?? []).slice();
    resetLineForm();
    formOpen = true;
    await refetchOne(b.id);
    if (canPublish) {
      try {
        items = (await api<{ items: typeof items }>('/manufacturing/mrp/options')).items;
      } catch {
        items = [];
        panelError = 'Catalogue WMS indisponible : publication suspendue.';
      }
    }
  }

  async function refetchOne(id: string) {
    fetching = true;
    try {
      const fresh = await api<Bom>(`/manufacturing/boms/${id}`);
      if (id !== editId) return;
      lines = (fresh.lines ?? []).slice();
      expectedUpdatedAt = fresh.updatedAt;
      revisions = fresh.revisions ?? [];
      formCode = fresh.code;
      formName = fresh.name;
      formProductRef = fresh.productRef ?? '';
      formActive = fresh.isActive;
      savedHeader = JSON.stringify([formName, formProductRef, formActive]);
      acknowledged = false;
    } catch (e) {
      panelError = e instanceof ApiError ? e.message : 'Échec du chargement des lignes';
      expectedUpdatedAt = '';
    } finally {
      fetching = false;
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
    if (headerDirty) {
      panelError = 'Enregistrez les changements d’en-tête avant de modifier les composants.';
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
          quantityPerUnit: String(lineQty),
          expectedUpdatedAt,
        },
      });
      toast.success('Ligne ajoutée');
      resetLineForm();
      await refetchOne(editId);
    } catch (e) {
      panelError = e instanceof ApiError ? e.message : "Échec de l'ajout de la ligne";
    } finally {
      addingLine = false;
    }
  }

  async function removeLine(lineId: string) {
    if (!editId) return;
    if (headerDirty) {
      panelError = 'Enregistrez les changements d’en-tête avant de modifier les composants.';
      return;
    }
    addingLine = true;
    try {
      await api(`/manufacturing/boms/${editId}/lines/${lineId}`, {
        method: 'DELETE',
        query: { expectedUpdatedAt },
      });
      toast.success('Ligne supprimée');
      await refetchOne(editId);
    } catch (e) {
      panelError = e instanceof ApiError ? e.message : 'Échec de la suppression de la ligne';
    } finally {
      addingLine = false;
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
        productRef: formProductRef.trim(),
        isActive: formActive,
      };
      if (editId) {
        await api(`/manufacturing/boms/${editId}`, {
          method: 'PATCH',
          body: { ...body, expectedUpdatedAt },
        });
        toast.success('Nomenclature mise à jour');
      } else {
        const created = await api<Bom>('/manufacturing/boms', { method: 'POST', body });
        editId = created.id;
        expectedUpdatedAt = created.updatedAt;
        savedHeader = JSON.stringify([formName, formProductRef, formActive]);
        if (canPublish) {
          try {
            items = (await api<{ items: typeof items }>('/manufacturing/mrp/options')).items;
          } catch {
            items = [];
          }
        }
        lines = (created.lines ?? []).slice();
        toast.success('Nomenclature créée — ajoutez ses lignes');
        saving = false;
        await load();
        return;
      }
      formOpen = false;
      await load();
    } catch (e) {
      panelError = e instanceof ApiError ? e.message : "Échec de l'enregistrement";
    } finally {
      saving = false;
    }
  }

  async function publish() {
    if (!editId || !acknowledged || headerDirty) return;
    saving = true;
    panelError = '';
    try {
      viewed = await api<Revision>(`/manufacturing/boms/${editId}/revisions`, {
        method: 'POST',
        body: {
          expectedUpdatedAt,
          acknowledgeUnits: true,
          validFrom: validFrom || undefined,
          validUntil: validUntil || undefined,
        },
      });
      await refetchOne(editId);
      await load();
      toast.success('Version publiée — sélectionnez-la dans vos règles MRP ou vos OF.');
    } catch (e) {
      panelError = e instanceof Error ? e.message : 'Publication impossible';
    } finally {
      saving = false;
    }
  }
  async function viewRevision(revision: Revision) {
    fetching = true;
    panelError = '';
    try {
      viewed = await api<Revision>(`/manufacturing/boms/${editId}/revisions/${revision.id}`);
    } catch (e) {
      panelError = e instanceof Error ? e.message : 'Version indisponible';
    } finally {
      fetching = false;
    }
  }
</script>

<PageHeader title="Nomenclatures" count={total}>
  {#snippet actions()}
    {#if canManage}<Button onclick={openCreate}>Nouvelle nomenclature</Button>{/if}
  {/snippet}
</PageHeader>

<FilterBar>
  <a href="/manufacturing" class="text-sm text-accent hover:underline">← Fabrication</a>
  <div class="w-72">
    <input
      placeholder="Rechercher par code ou nom…"
      bind:value={search}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          pageNumber = 1;
          void load();
        }
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
        {#if canManage}<Button onclick={openCreate}>Nouvelle nomenclature</Button>{/if}
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Code</th><th>Nom</th><th>Produit</th><th class="text-right">Composants</th><th>Version</th
      ><th>Statut</th>
    {/snippet}
    {#snippet body()}
      {#each boms as b (b.id)}
        <tr>
          <td class="font-mono font-semibold text-ink"
            ><button class="text-accent hover:underline" onclick={() => openEdit(b)}
              >{b.code}</button
            ></td
          >
          <td>{b.name}</td>
          <td class="text-ink-muted">{b.productRef || '—'}</td>
          <td class="text-right text-ink">{b._count?.lines ?? b.lines?.length ?? 0}</td>
          <td
            ><Badge tone={b.revisions?.length ? 'info' : 'neutral'}
              >{b.revisions?.length ? `v${b.revisions[0].revision}` : 'Brouillon seulement'}</Badge
            ></td
          >
          <td>
            <Badge tone={b.isActive ? 'ok' : 'neutral'}>{b.isActive ? 'Actif' : 'Inactif'}</Badge>
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<div class="mt-3 flex items-center justify-between text-xs text-ink-muted">
  <span>Page {pageNumber} · {total} nomenclatures</span>
  <div class="flex gap-2">
    <Button
      variant="ghost"
      disabled={pageNumber <= 1 || loading}
      onclick={() => {
        pageNumber -= 1;
      }}>Précédent</Button
    ><Button
      variant="ghost"
      disabled={pageNumber * 50 >= total || loading}
      onclick={() => {
        pageNumber += 1;
      }}>Suivant</Button
    >
  </div>
</div>

<Drawer
  bind:open={formOpen}
  title={editId ? `${formCode} · Nomenclature` : 'Nouvelle nomenclature'}
  width="xl"
  dismissible={!busy}
>
  {#snippet children()}
    <div class="space-y-3">
      <p class="text-sm text-ink-muted">
        Préparez le brouillon, publiez une version, puis sélectionnez-la dans le MRP ou un OF. Les
        versions publiées ne changent plus.
      </p>
      {#if panelError}<div
          role="alert"
          class="rounded-md border border-danger/20 p-3 text-sm text-danger"
        >
          {panelError}{#if editId}<Button
              variant="ghost"
              disabled={busy}
              onclick={async () => {
                panelError = '';
                await refetchOne(editId!);
              }}>Recharger le brouillon</Button
            >{/if}
        </div>{/if}
      {#if revisions.length}<section class="space-y-2 rounded-md border border-edge p-3">
          <h3 class="text-sm font-semibold">
            Versions publiées · {revisions.length === 30 ? '30 dernières' : revisions.length}
          </h3>
          <div class="flex flex-wrap gap-2">
            {#each revisions as revision (revision.id)}<Button
                variant="secondary"
                disabled={busy}
                onclick={() => viewRevision(revision)}
                >v{revision.revision} · {new Date(revision.createdAt).toLocaleDateString(
                  'fr-CA',
                )}</Button
              >{/each}
          </div>
        </section>{/if}
      {#if viewed}<section class="space-y-2 rounded-md border border-accent/20 bg-accent/5 p-3">
          <h3 class="font-semibold">Version {viewed.revision} · lecture seule</h3>
          <p class="text-xs text-ink-muted">
            Validité : {viewed.validFrom?.slice(0, 10) ?? 'sans début imposé'} → {viewed.validUntil?.slice(
              0,
              10,
            ) ?? 'sans fin imposée'}
          </p>
          <p class="text-xs text-ink-muted">
            Quantités par 1 {viewed.outputUnit} de {viewed.outputSku}.
          </p>
          {#each viewed.lines ?? [] as line (line.id)}<div
              class="flex justify-between gap-3 text-sm"
            >
              <span>{line.sku} · {line.name}</span><span class="font-mono"
                >{line.quantityPerUnit} {line.unit}</span
              >
            </div>{/each}
        </section>{/if}
      <fieldset disabled={!canManage || busy} class="space-y-3">
        <h3 class="text-sm font-semibold">Brouillon de travail</h3>
        <div class="grid grid-cols-2 gap-3">
          <Field label="Code">
            <Input bind:value={formCode} disabled={Boolean(editId)} placeholder="NOM-001" />
          </Field>
          <Field label="Produit">
            <Input bind:value={formProductRef} placeholder="SKU WMS exact" />
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
                      <span class="ml-2 font-mono text-ink-muted"
                        >× {line.quantityPerUnit}
                        {itemBySku.get(line.materialRef)?.unit ?? '(unité à vérifier)'}</span
                      >
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
                  <Input bind:value={lineRef} placeholder="MAT-001" />
                </Field>
                <Field label="Désignation">
                  <Input bind:value={lineName} placeholder="Optionnel" />
                </Field>
                <Field label="Qté / unité">
                  <Input
                    bind:value={lineQty}
                    pattern={'[0-9]+([.][0-9]{1,9})?'}
                    placeholder="0.125"
                  />
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
          <Button variant="primary" loading={saving} onclick={submit}
            >Enregistrer le brouillon</Button
          >
        </div>
      </fieldset>
      {#if editId && canPublish}<section class="space-y-3 border-t border-edge pt-4">
          <h3 class="text-sm font-semibold">Publier une version</h3>
          <div class="grid gap-3 sm:grid-cols-2">
            <Field label="Valide à partir du"
              ><Input type="date" bind:value={validFrom} disabled={busy} /></Field
            >
            <Field label="Valide jusqu’au (inclus)"
              ><Input type="date" bind:value={validUntil} disabled={busy} /></Field
            >
          </div>
          <p class="text-xs text-ink-muted">
            Dates facultatives, figées avec la version. Le MRP exige une version couvrant tout
            l’horizon; il ne la remplace jamais automatiquement.
          </p>
          <p class="text-xs text-ink-muted">
            La publication capture le brouillon enregistré, les SKU et unités WMS. Enregistrez vos
            changements d’en-tête avant de publier. Aucune règle MRP ni aucun OF n’est modifié
            automatiquement.
          </p>
          <label class="flex items-start gap-2 text-sm"
            ><input type="checkbox" bind:checked={acknowledged} disabled={busy} />Je confirme les
            quantités de chaque composant pour 1 {itemBySku.get(formProductRef)?.unit ??
              'unité WMS'} du produit.</label
          ><Button
            disabled={busy ||
              headerDirty ||
              !acknowledged ||
              !expectedUpdatedAt ||
              !lines.length ||
              !items.length}
            onclick={publish}>Publier le brouillon enregistré</Button
          >
        </section>{/if}
    </div>
  {/snippet}
</Drawer>
