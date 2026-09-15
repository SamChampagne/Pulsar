<script lang="ts">
  import { onMount } from 'svelte';
  import { page as route } from '$app/state';
  import { auth } from '$lib/stores/auth';
  import { api } from '$lib/api/client';
  import { Badge, Button, PageHeader } from '$lib/components/ui';
  import { ArrowRight, PackageCheck, ShoppingCart, Users } from 'lucide-svelte';
  import MaterialPurchaseDrawer from '$lib/components/manufacturing/MaterialPurchaseDrawer.svelte';
  import MaterialSuppliersDrawer from '$lib/components/manufacturing/MaterialSuppliersDrawer.svelte';
  import MaterialArrivals from '$lib/components/manufacturing/MaterialArrivals.svelte';
  let view = $state<'requests' | 'arrivals'>('requests'),
    arrivalVersion = $state(0);
  import {
    purchaseLabel,
    type MaterialRequest,
  } from '$lib/components/manufacturing/material-purchase-types';
  let requests = $state<MaterialRequest[]>([]),
    total = $state(0),
    page = $state(1),
    busy = $state(false),
    error = $state('');
  let selected = $state(''),
    open = $state(false),
    suppliersOpen = $state(false);
  const canManage = $derived($auth?.user.permissions.includes('manufacturing.manage') ?? false);
  const canReceive = $derived(
    canManage && ($auth?.user.permissions.includes('wms.manage') ?? false),
  );
  async function load() {
    busy = true;
    error = '';
    try {
      const data = await api<{ items: MaterialRequest[]; total: number }>(
        '/manufacturing/material-purchases/requests',
        { query: { page, pageSize: 20 } },
      );
      requests = data.items;
      total = data.total;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Achats indisponibles.';
    } finally {
      busy = false;
    }
  }
  onMount(() => {
    void load();
    const id = route.url.searchParams.get('preparationId');
    if (id) {
      selected = id;
      open = true;
    }
  });
</script>

<PageHeader
  eyebrow="Fabrication · Approvisionnement"
  title="Achats matières"
  subtitle="Du besoin calculé à la matière reçue, avec une trace unique entre MRP et entrepôt."
>
  {#snippet actions()}<Button variant="secondary" disabled={busy} onclick={load}>Actualiser</Button
    ><Button
      variant="secondary"
      onclick={() => {
        suppliersOpen = true;
      }}><Users size={16} /> Fournisseurs</Button
    >{/snippet}
</PageHeader>
<div
  class="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-edge bg-surface p-4 text-sm"
>
  <ShoppingCart size={18} class="text-ink-muted" /><a
    href="/manufacturing/mrp"
    class="text-accent hover:underline">Demande MRP</a
  ><ArrowRight size={14} /><span>Commande confirmée</span><ArrowRight size={14} /><span
    >Réceptions WMS</span
  ><ArrowRight size={14} /><PackageCheck size={16} /><span>Stock disponible</span>
</div>
<nav aria-label="Vue achats" class="mb-5 flex gap-2">
  <Button
    variant={view === 'requests' ? 'primary' : 'secondary'}
    onclick={() => {
      view = 'requests';
    }}>Demandes et achats</Button
  ><Button
    variant={view === 'arrivals' ? 'primary' : 'secondary'}
    onclick={() => {
      view = 'arrivals';
    }}>Arrivages</Button
  >
</nav>
{#if view === 'arrivals'}{#key arrivalVersion}<MaterialArrivals
      onselect={(id) => {
        selected = id;
        open = true;
      }}
    />{/key}{:else}
  {#if error}<p
      role="alert"
      class="mb-4 rounded-md border border-danger/20 p-3 text-sm text-danger"
    >
      {error}
    </p>{/if}
  {#if busy}<p role="status" class="p-6 text-sm text-ink-muted">
      Chargement des demandes d’achat…
    </p>{:else if !requests.length && !error}<section
      class="rounded-md border border-dashed border-edge p-8 text-center"
    >
      <ShoppingCart class="mx-auto mb-3 text-ink-muted" size={24} />
      <h2 class="font-semibold">Les achats commencent par un besoin</h2>
      <p class="mx-auto mt-2 max-w-lg text-sm text-ink-muted">
        Préparez une proposition BUY dans le MRP. Sa quantité, son article et son entrepôt
        apparaîtront ici pour choisir le fournisseur et organiser les arrivées.
      </p>
      <a class="mt-4 inline-block text-sm text-accent hover:underline" href="/manufacturing/mrp"
        >Ouvrir les besoins matières →</a
      >
    </section>{:else}
    <section
      aria-label="Demandes et commandes matières"
      class="divide-y divide-edge overflow-hidden rounded-md border border-edge bg-surface"
    >
      {#each requests as request}<button
          class="flex w-full flex-wrap items-center gap-4 p-4 text-left transition-colors hover:bg-surface-muted focus-visible:outline-accent"
          onclick={() => {
            selected = request.id;
            open = true;
          }}
        >
          <div class="min-w-0 flex-1 basis-52">
            <p class="text-xs font-mono text-ink-muted">{request.number} · {request.item.sku}</p>
            <h2 class="mt-1 font-medium">{request.item.name}</h2>
            <p class="mt-1 text-xs text-ink-muted">
              {request.location.name} · besoin le {request.dueDate.slice(0, 10)}
            </p>
          </div>
          <div class="text-right">
            <p class="font-mono text-sm">{request.quantity} {request.unitSnapshot}</p>
            <p class="mt-1 text-xs text-ink-muted">
              {request.purchaseOrder?.number ?? 'Fournisseur à choisir'}
            </p>
          </div>
          <Badge tone="neutral"
            >{purchaseLabel(request.purchaseOrder?.status ?? request.status)}</Badge
          ><ArrowRight size={16} class="text-ink-muted" />
        </button>{/each}
    </section>
    <div class="mt-4 flex items-center justify-between gap-3 text-sm">
      <Button
        variant="secondary"
        disabled={busy || page === 1}
        onclick={() => {
          page--;
          void load();
        }}>Précédent</Button
      ><span>Page {page} · {total} demandes</span><Button
        variant="secondary"
        disabled={busy || page * 20 >= total}
        onclick={() => {
          page++;
          void load();
        }}>Suivant</Button
      >
    </div>
  {/if}
{/if}
{#if selected}<MaterialPurchaseDrawer
    bind:open
    preparationId={selected}
    {canManage}
    {canReceive}
    onchanged={() => {
      arrivalVersion++;
      void load();
    }}
  />{/if}
<MaterialSuppliersDrawer bind:open={suppliersOpen} {canManage} />
