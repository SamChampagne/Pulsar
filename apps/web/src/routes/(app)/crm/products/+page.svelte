<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDate } from '$lib/format';
  import {
    PageHeader,
    Button,
    FilterBar,
    Select,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    ErrorNotice,
    Modal,
    Field,
    Input,
    Textarea,
    type Tone,
  } from '$lib/components/ui';
  import { untrack } from 'svelte';

  // ── Types ───────────────────────────────────────────────────────────────────

  interface ProductRow {
    id: string;
    name: string;
    sku: string | null;
    description: string | null;
    unitPrice: number;
    currency: string;
    active: boolean;
    createdAt: string;
  }

  // ── State — list ─────────────────────────────────────────────────────────────

  let products = $state<ProductRow[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 25;
  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  let search = $state('');
  let activeFilter = $state('');
  let loading = $state(true);
  let error = $state('');

  // ── State — detail panel ─────────────────────────────────────────────────────

  let selected = $state<ProductRow | null>(null);

  // ── State — create/edit modal ─────────────────────────────────────────────────

  let formOpen = $state(false);
  let formMode = $state<'create' | 'edit'>('create');
  let formId = $state('');
  let formName = $state('');
  let formSku = $state('');
  let formDescription = $state('');
  let formUnitPrice = $state<number | null>(null);
  let formCurrency = $state('CAD');
  let formActive = $state(true);
  let formSaving = $state(false);

  // ── State — delete ────────────────────────────────────────────────────────────

  let deleteError = $state('');
  let deleting = $state<string | null>(null);

  // ── Data loading ─────────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    try {
      const result = await api<Paginated<ProductRow>>('/crm/products', {
        query: {
          search: search || undefined,
          page,
          pageSize,
          active: activeFilter || undefined,
        },
      });
      products = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Impossible de charger les produits';
    } finally {
      loading = false;
    }
  }

  // ── Create / Edit ─────────────────────────────────────────────────────────────

  function openCreate() {
    formMode = 'create';
    formId = '';
    formName = '';
    formSku = '';
    formDescription = '';
    formUnitPrice = null;
    formCurrency = 'CAD';
    formActive = true;
    deleteError = '';
    formOpen = true;
  }

  function openEdit(product: ProductRow) {
    formMode = 'edit';
    formId = product.id;
    formName = product.name;
    formSku = product.sku ?? '';
    formDescription = product.description ?? '';
    formUnitPrice = product.unitPrice != null ? Number(product.unitPrice) : null;
    formCurrency = product.currency;
    formActive = product.active;
    deleteError = '';
    formOpen = true;
  }

  async function submitForm() {
    if (!formName.trim()) {
      toast.error('Le nom est obligatoire');
      return;
    }
    const parsedPrice = formUnitPrice != null ? Number(formUnitPrice) : NaN;
    if (formUnitPrice != null && (isNaN(parsedPrice) || parsedPrice < 0)) {
      toast.error('Le prix unitaire doit être un nombre positif');
      return;
    }
    formSaving = true;
    try {
      const body = {
        name: formName.trim(),
        sku: formSku.trim() || undefined,
        description: formDescription.trim() || undefined,
        unitPrice: formUnitPrice != null ? parsedPrice : undefined,
        currency: formCurrency || undefined,
        active: formActive,
      };
      if (formMode === 'create') {
        await api<ProductRow>('/crm/products', { method: 'POST', body });
        toast.success('Produit créé');
      } else {
        const updated = await api<ProductRow>(`/crm/products/${formId}`, { method: 'PATCH', body });
        toast.success('Produit mis à jour');
        if (selected?.id === formId) selected = updated;
      }
      formOpen = false;
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'enregistrement");
    } finally {
      formSaving = false;
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────────

  async function deleteProduct(product: ProductRow) {
    deleting = product.id;
    deleteError = '';
    try {
      await api(`/crm/products/${product.id}`, { method: 'DELETE' });
      toast.success('Produit supprimé');
      if (selected?.id === product.id) selected = null;
      void load();
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 409) {
        deleteError = 'Ce produit est référencé par des lignes de deal et ne peut pas être supprimé.';
      } else {
        deleteError = e instanceof ApiError ? e.message : 'Impossible de supprimer le produit';
      }
    } finally {
      deleting = null;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function activeTone(active: boolean): Tone {
    return active ? 'ok' : 'neutral';
  }

  function formatPrice(unitPrice: number | string, currency: string): string {
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(unitPrice));
  }

  // ── Reactive load ─────────────────────────────────────────────────────────────

  $effect(() => {
    const _s = search;
    const _af = activeFilter;
    untrack(() => {
      page = 1;
      void load();
    });
  });
</script>

<PageHeader title="Produits" subtitle="Cataloguez vos produits et services pour les lignes de deals." count={total}>
  {#snippet actions()}
    <Button onclick={openCreate}>Nouveau produit</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

<FilterBar>
  <div class="w-64">
    <input
      placeholder="Rechercher par nom ou SKU…"
      bind:value={search}
      onkeydown={(e) => { if (e.key === 'Enter') void load(); }}
      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
    />
  </div>
  <div class="w-44">
    <Select bind:value={activeFilter}>
      <option value="">Tous les statuts</option>
      <option value="true">Actifs seulement</option>
      <option value="false">Inactifs seulement</option>
    </Select>
  </div>
</FilterBar>

<!-- List / panel layout -->
<div class={`flex gap-4 ${selected ? 'items-start' : ''}`}>
  <!-- ── List ── -->
  <div class={`min-w-0 flex-1 transition-all ${selected ? 'max-w-[55%]' : ''}`}>
    {#if loading}
      <Card padded={false}><Skeleton rows={6} /></Card>
    {:else if products.length === 0}
      <Card>
        <EmptyState message="Aucun produit pour le moment." />
      </Card>
    {:else}
      <Table>
        {#snippet head()}
          <th>Nom</th><th>SKU</th><th>Prix unitaire</th><th>Statut</th><th>Créé le</th>
        {/snippet}
        {#snippet body()}
          {#each products as product (product.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <tr
              class={`cursor-pointer transition-colors hover:bg-surface-muted ${selected?.id === product.id ? 'bg-accent-soft/20' : ''}`}
              onclick={() => { selected = product; deleteError = ''; }}
            >
              <td class="font-semibold text-ink">{product.name}</td>
              <td class="font-mono text-xs text-ink-muted">{product.sku ?? '—'}</td>
              <td class="text-ink">{formatPrice(product.unitPrice, product.currency)}</td>
              <td>
                <Badge tone={activeTone(product.active)}>
                  {product.active ? 'Actif' : 'Inactif'}
                </Badge>
              </td>
              <td class="text-ink-muted">{formatDate(product.createdAt)}</td>
            </tr>
          {/each}
        {/snippet}
      </Table>
    {/if}

    {#if total > pageSize}
      <div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
        <span class="font-mono text-xs">
          {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} sur {total}
        </span>
        <div class="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={page <= 1}
            onclick={() => { page = Math.max(1, page - 1); void load(); }}
          >Précédent</Button>
          <span class="font-mono text-xs">Page {page} / {totalPages}</span>
          <Button
            variant="secondary"
            disabled={page >= totalPages}
            onclick={() => { page = Math.min(totalPages, page + 1); void load(); }}
          >Suivant</Button>
        </div>
      </div>
    {/if}
  </div>

  <!-- ── Detail panel ── -->
  {#if selected}
    <div class="w-[42%] shrink-0">
      <Card>
        <!-- Panel header -->
        <div class="mb-4 flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h2 class="truncate text-base font-bold text-ink">{selected.name}</h2>
            <Badge tone={activeTone(selected.active)}>
              {selected.active ? 'Actif' : 'Inactif'}
            </Badge>
          </div>
          <button
            class="shrink-0 rounded p-1 text-ink-faint hover:bg-surface-muted hover:text-ink"
            onclick={() => { selected = null; deleteError = ''; }}
            aria-label="Fermer"
          >✕</button>
        </div>

        <!-- Product fields -->
        <div class="mb-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Prix unitaire</div>
            <div class="text-ink font-semibold">{formatPrice(selected.unitPrice, selected.currency)}</div>
          </div>
          <div>
            <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Devise</div>
            <div class="text-ink font-mono">{selected.currency}</div>
          </div>
          {#if selected.sku}
            <div>
              <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">SKU</div>
              <div class="font-mono text-ink">{selected.sku}</div>
            </div>
          {/if}
          <div>
            <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Créé le</div>
            <div class="text-ink">{formatDate(selected.createdAt)}</div>
          </div>
        </div>

        {#if selected.description}
          <div class="mb-4">
            <div class="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Description</div>
            <p class="text-xs text-ink leading-relaxed">{selected.description}</p>
          </div>
        {/if}

        <!-- 409 delete error notice -->
        {#if deleteError}
          <div class="mb-3 rounded-md border border-danger bg-danger-soft/20 px-3 py-2 text-xs text-danger">
            {deleteError}
          </div>
        {/if}

        <!-- Actions -->
        <div class="flex flex-wrap gap-2">
          <Button onclick={() => openEdit(selected!)}>Modifier</Button>
          <Button
            variant="danger"
            loading={deleting === selected.id}
            onclick={() => void deleteProduct(selected!)}
          >Supprimer</Button>
        </div>
      </Card>
    </div>
  {/if}
</div>

<!-- Create / Edit modal -->
<Modal
  bind:open={formOpen}
  title={formMode === 'create' ? 'Nouveau produit' : 'Modifier le produit'}
>
  <div class="flex flex-col gap-4">
    <Field label="Nom *">
      <Input bind:value={formName} placeholder="Ex. : Logiciel TMS — licence annuelle" />
    </Field>
    <Field label="SKU">
      <Input bind:value={formSku} placeholder="TMS-LIC-2026" />
    </Field>
    <Field label="Description">
      <Textarea bind:value={formDescription} rows={3} placeholder="Description du produit ou du service…" />
    </Field>
    <div class="grid grid-cols-2 gap-4">
      <Field label="Prix unitaire">
        <Input
          bind:value={formUnitPrice}
          type="number"
          placeholder="0.00"
        />
      </Field>
      <Field label="Devise">
        <Select bind:value={formCurrency}>
          <option value="CAD">CAD</option>
          <option value="USD">USD</option>
          <option value="EUR">EUR</option>
        </Select>
      </Field>
    </div>
    <Field label="Statut">
      <Select
        value={formActive ? 'true' : 'false'}
        onchange={(e) => { formActive = (e.currentTarget as HTMLSelectElement).value === 'true'; }}
      >
        <option value="true">Actif</option>
        <option value="false">Inactif</option>
      </Select>
    </Field>
  </div>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => { formOpen = false; }}>Annuler</Button>
    <Button loading={formSaving} onclick={submitForm}>
      {formMode === 'create' ? 'Créer' : 'Enregistrer'}
    </Button>
  {/snippet}
</Modal>
