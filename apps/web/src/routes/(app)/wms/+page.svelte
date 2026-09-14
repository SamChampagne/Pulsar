<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorNotice,
    PageHeader,
    Skeleton,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface NegativeBin {
    id: string;
    itemId: string;
    binId: string;
    qtyOnHand: string;
    item: { sku: string };
    bin: { code: string };
  }

  interface Overview {
    distinctItems: number;
    totalOnHand: number;
    openReceipts: number;
    openPickOrders: number;
    negativeBins: NegativeBin[];
  }

  let overview = $state<Overview | null>(null);
  let loading = $state(true);
  let error = $state('');

  async function load() {
    loading = true;
    error = '';
    try {
      overview = await api<Overview>('/wms/overview');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Impossible de charger l’entrepôt';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  const quickLinks = [
    { href: '/wms/inventory', label: 'Inventaire' },
    { href: '/wms/receiving', label: 'Réception' },
    { href: '/wms/picking', label: 'Prélèvement' },
    { href: '/wms/items', label: 'Articles' },
    { href: '/wms/bins', label: 'Emplacements' },
  ];
</script>

<PageHeader title="Entrepôt" subtitle="Réceptions, préparations et écarts de stock à suivre.">
  {#snippet actions()}<Button variant="secondary" href="/wms/inventory">Inventaire</Button><Button
      href="/wms/receiving">Réceptions</Button
    >{/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
    {#each Array(5) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <Card
    ><EmptyState
      title="Données indisponibles"
      message="Réessayez le chargement ou ouvrez directement les réceptions, l’inventaire ou les préparations."
    /></Card
  >
{:else if overview}
  <!-- A. KPI cards -->
  <div class="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
    <a href="/wms/items" class="block">
      <Card>
        <div class="text-xs font-medium text-ink-muted">Articles</div>
        <div class="mt-1 text-2xl font-semibold text-ink">{overview.distinctItems}</div>
      </Card>
    </a>
    <a href="/wms/inventory" class="block">
      <Card>
        <div class="text-xs font-medium text-ink-muted">Quantité totale en stock</div>
        <div class="mt-1 text-2xl font-semibold text-ink">{overview.totalOnHand}</div>
      </Card>
    </a>
    <a href="/wms/receiving" class="block">
      <Card>
        <div class="text-xs font-medium text-ink-muted">Réceptions ouvertes</div>
        <div class="mt-1 text-2xl font-semibold text-ink">{overview.openReceipts}</div>
      </Card>
    </a>
    <a href="/wms/picking" class="block">
      <Card>
        <div class="text-xs font-medium text-ink-muted">Préparations ouvertes</div>
        <div class="mt-1 text-2xl font-semibold text-ink">{overview.openPickOrders}</div>
      </Card>
    </a>
    <a href="#negative" class="block">
      <Card>
        <div class="text-xs font-medium text-danger">Emplacements en anomalie</div>
        <div class="mt-1 text-2xl font-semibold text-danger">{overview.negativeBins.length}</div>
      </Card>
    </a>
  </div>

  <!-- B. Negative-bin attention list -->
  <div id="negative" class="mb-5">
    <h2 class="mb-2 text-sm font-semibold text-ink">Écarts de stock à corriger</h2>
    <Card padded={false}>
      {#if overview.negativeBins.length === 0}
        <EmptyState message="Aucun stock négatif détecté." />
      {:else}
        <div class="divide-y divide-edge">
          {#each overview.negativeBins as nb (nb.id)}
            <div class="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Badge tone="danger">{nb.qtyOnHand}</Badge>
              <span class="font-medium text-ink">{nb.item.sku}</span>
              <span class="text-ink-muted">emplacement {nb.bin.code}</span>
            </div>
          {/each}
        </div>
      {/if}
    </Card>
  </div>

  <!-- C. Quick links to the workbenches -->
  <h2 class="mb-2 text-sm font-semibold text-ink">Raccourcis</h2>
  <div class="flex flex-wrap gap-2">
    {#each quickLinks as link (link.href)}
      <a
        href={link.href}
        class="rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink hover:bg-surface-muted"
      >
        {link.label}
      </a>
    {/each}
  </div>
{/if}
