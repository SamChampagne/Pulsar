<script lang="ts">
  import { untrack } from 'svelte';
  import { api } from '$lib/api/client';
  import { Button, Drawer, Field, Input, Select } from '$lib/components/ui';
  type Mapping = {
    id: string;
    productId: string;
    itemId: string;
    commercialUnit: string;
    numerator: string;
    denominator: string;
    unitSnapshot: string;
    isActive: boolean;
    updatedAt: string;
    product: { name: string };
    item: { sku: string };
  };
  let {
    open = $bindable(false),
    items,
    canManage,
  }: {
    open?: boolean;
    items: { id: string; sku: string; name: string; unit: string }[];
    canManage: boolean;
  } = $props();
  let mappings = $state<Mapping[]>([]),
    total = $state(0),
    page = $state(1),
    search = $state('');
  let products = $state<{ id: string; name: string; sku: string | null }[]>([]),
    productSearch = $state(''),
    productPage = $state(1),
    productTotal = $state(0);
  let editing = $state<Mapping | null>(null),
    form = $state(false),
    busy = $state(false),
    error = $state(''),
    uncertain = $state(false);
  let productId = $state(''),
    itemId = $state(''),
    unit = $state('boîte'),
    numerator = $state('1'),
    denominator = $state('1'),
    active = $state(true),
    acknowledged = $state(false);
  async function load() {
    busy = true;
    error = '';
    try {
      const response = await api<{ items: Mapping[]; total: number }>(
        '/manufacturing/mrp/product-mappings',
        { query: { page, pageSize: 20, search: search || undefined } },
      );
      mappings = response.items;
      total = response.total;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Correspondances indisponibles';
    } finally {
      busy = false;
    }
  }
  async function loadProducts() {
    busy = true;
    try {
      const response = await api<{ items: typeof products; total: number }>('/crm/products', {
        query: {
          page: productPage,
          pageSize: 20,
          search: productSearch || undefined,
          active: 'true',
        },
      });
      products = response.items;
      productTotal = response.total;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Produits indisponibles';
    } finally {
      busy = false;
    }
  }
  $effect(() => {
    if (open)
      untrack(() => {
        form = false;
        page = 1;
        search = '';
        uncertain = false;
        void load();
      });
  });
  async function edit(mapping: Mapping | null) {
    editing = mapping;
    form = true;
    error = '';
    uncertain = false;
    productId = mapping?.productId ?? '';
    itemId = mapping?.itemId ?? '';
    unit = mapping?.commercialUnit ?? 'boîte';
    numerator = mapping?.numerator ?? '1';
    denominator = mapping?.denominator ?? '1';
    active = mapping?.isActive ?? true;
    acknowledged = false;
    productPage = 1;
    productSearch = '';
    if (!mapping) await loadProducts();
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (uncertain || !acknowledged) return;
    busy = true;
    error = '';
    try {
      await api('/manufacturing/mrp/product-mappings', {
        method: 'PUT',
        body: {
          productId,
          itemId,
          commercialUnit: unit,
          numerator,
          denominator,
          isActive: active,
          acknowledgeUnits: true,
          ...(editing ? { expectedUpdatedAt: editing.updatedAt } : {}),
        },
      });
      form = false;
      await load();
    } catch (e) {
      uncertain = true;
      error = `${e instanceof Error ? e.message : 'Échec'}. Revenez à la liste et actualisez avant de reprendre.`;
    } finally {
      busy = false;
    }
  }
</script>

<Drawer bind:open title="Produits et unités commerciales" width="lg" dismissible={!busy}>
  <p class="mb-4 text-sm text-ink-muted">
    Correspondances réutilisables pour les nouvelles demandes CRM. Chaque demande conserve son
    ratio; aucune conversion de stock ni modification rétroactive.
  </p>
  {#if error}<p role="alert" class="mb-4 rounded-md bg-danger/5 p-3 text-sm text-danger">
      {error}
    </p>{/if}
  {#if !form}
    <div class="mb-4 flex flex-wrap gap-2">
      <Input
        bind:value={search}
        aria-label="Rechercher une correspondance"
        placeholder="Nom du produit CRM…"
      /><Button
        variant="secondary"
        disabled={busy}
        onclick={async () => {
          page = 1;
          await load();
        }}>Rechercher</Button
      >{#if canManage}<Button disabled={busy} onclick={() => edit(null)}
          >Nouvelle correspondance</Button
        >{/if}
    </div>
    <div class="divide-y divide-edge">
      {#each mappings as mapping (mapping.id)}<article class="py-4">
          <p class="font-medium text-ink">{mapping.product.name} → {mapping.item.sku}</p>
          <p class="mt-1 font-mono text-sm text-ink-muted">
            {mapping.denominator}
            {mapping.commercialUnit} = {mapping.numerator}
            {mapping.unitSnapshot}
          </p>
          <p class="mt-1 text-xs text-ink-muted">
            {mapping.isActive
              ? 'Disponible pour les nouvelles demandes'
              : 'Désactivée — historiques conservés'}
          </p>
          {#if canManage}<Button variant="ghost" onclick={() => edit(mapping)}
              >Modifier le ratio</Button
            >{/if}
        </article>{/each}
    </div>
    {#if !mappings.length && !busy}<p class="py-6 text-sm text-ink-muted">
        Aucune correspondance. Créez un produit dans le CRM puis associez-le à son article WMS.
      </p>{/if}
    <div class="mt-4 flex items-center justify-between text-xs text-ink-muted">
      <span>{total} correspondances · page {page}</span>
      <div class="flex">
        <Button
          variant="ghost"
          disabled={busy || page <= 1}
          onclick={async () => {
            page--;
            await load();
          }}>Précédent</Button
        ><Button
          variant="ghost"
          disabled={busy || page * 20 >= total}
          onclick={async () => {
            page++;
            await load();
          }}>Suivant</Button
        >
      </div>
    </div>
  {:else}
    <Button
      variant="ghost"
      disabled={busy}
      onclick={async () => {
        form = false;
        await load();
      }}>Retour aux correspondances</Button
    >
    <form onsubmit={save} class="mt-4 space-y-4">
      {#if editing}<p class="font-medium text-ink">
          Produit CRM : {editing.product.name}
        </p>{:else}<div class="flex gap-2">
          <Input bind:value={productSearch} aria-label="Rechercher un produit CRM" /><Button
            variant="secondary"
            disabled={busy || uncertain}
            onclick={async () => {
              productPage = 1;
              await loadProducts();
            }}>Chercher le produit</Button
          >
        </div>
        <Field label="Produit CRM"
          ><Select bind:value={productId} required disabled={busy || uncertain}
            ><option value="">Choisir le produit exact</option
            >{#each products as product (product.id)}<option value={product.id}
                >{product.name}{product.sku ? ` · ${product.sku}` : ''}</option
              >{/each}</Select
          ></Field
        >
        <div class="flex items-center justify-between text-xs">
          <span>{productTotal} produits · page {productPage}</span><Button
            variant="ghost"
            disabled={busy || productPage <= 1}
            onclick={async () => {
              productPage--;
              await loadProducts();
            }}>Produits précédents</Button
          ><Button
            variant="ghost"
            disabled={busy || productPage * 20 >= productTotal}
            onclick={async () => {
              productPage++;
              await loadProducts();
            }}>Produits suivants</Button
          >
        </div>{/if}
      <Field label="Article WMS cible"
        ><Select bind:value={itemId} required disabled={busy || uncertain}
          ><option value="">Choisir l’article exact</option>{#each items as item (item.id)}<option
              value={item.id}>{item.sku} · {item.name} ({item.unit})</option
            >{/each}</Select
        ></Field
      >
      <Field label="Nom de l’unité commerciale"
        ><Input bind:value={unit} maxlength={40} required disabled={busy || uncertain} /></Field
      >
      <div class="grid grid-cols-2 gap-3">
        <Field label="Quantité commerciale"
          ><Input
            bind:value={denominator}
            required
            pattern={'[0-9]+([.][0-9]{1,6})?'}
            disabled={busy || uncertain}
          /></Field
        ><Field
          label={`Équivalent WMS (${items.find((item) => item.id === itemId)?.unit ?? 'unité'})`}
          ><Input
            bind:value={numerator}
            required
            pattern={'[0-9]+([.][0-9]{1,6})?'}
            disabled={busy || uncertain}
          /></Field
        >
      </div>
      <p class="rounded-md bg-surface-muted p-3 text-sm">
        Exemple : 1 boîte = 12 EA. Un résultat non exact à 3 décimales sera refusé. Aucun facteur
        masse/volume ou densité n’est déduit.
      </p>
      <label class="flex items-start gap-2 text-sm"
        ><input
          type="checkbox"
          bind:checked={acknowledged}
          required
          disabled={busy || uncertain}
        />Je confirme ce produit, cet article et ce ratio pour les nouvelles demandes.</label
      >
      <label class="flex gap-2 text-sm"
        ><input type="checkbox" bind:checked={active} disabled={busy || uncertain} />Correspondance
        active</label
      >
      <Button type="submit" loading={busy} disabled={uncertain || !acknowledged}
        >Enregistrer la correspondance</Button
      >
    </form>
  {/if}
</Drawer>
