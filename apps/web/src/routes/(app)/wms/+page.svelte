<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Card, EmptyState, ErrorNotice, PageHeader, Skeleton } from '$lib/components/ui';
  import AgentPanel from '$lib/components/AgentPanel.svelte';
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
      error = e instanceof ApiError ? e.message : 'Failed to load warehouse overview';
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

<PageHeader
  title="Warehouse"
  subtitle="Keep receiving, inventory accuracy, picking, and bin exceptions visible from one warehouse cockpit."
/>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
    {#each Array(5) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <Card><EmptyState title="Warehouse data unavailable" message="The warehouse shell is still available. Retry the overview or use the navigation to inspect receiving, inventory, or picking directly." /></Card>
{:else if overview}
  <!-- A. KPI cards -->
  <div class="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
    <a href="/wms/items" class="block">
      <Card>
        <div class="text-xs font-medium text-ink-muted">Articles</div>
        <div class="mt-1 text-3xl font-bold text-ink">{overview.distinctItems}</div>
      </Card>
    </a>
    <a href="/wms/inventory" class="block">
      <Card>
        <div class="text-xs font-medium text-ink-muted">Stock total (on-hand)</div>
        <div class="mt-1 text-3xl font-bold text-ink">{overview.totalOnHand}</div>
      </Card>
    </a>
    <a href="/wms/receiving" class="block">
      <Card>
        <div class="text-xs font-medium text-ink-muted">Réceptions ouvertes</div>
        <div class="mt-1 text-3xl font-bold text-ink">{overview.openReceipts}</div>
      </Card>
    </a>
    <a href="/wms/picking" class="block">
      <Card>
        <div class="text-xs font-medium text-ink-muted">Pick orders ouverts</div>
        <div class="mt-1 text-3xl font-bold text-ink">{overview.openPickOrders}</div>
      </Card>
    </a>
    <a href="#negative" class="block">
      <Card>
        <div class="text-xs font-medium text-danger">Bins négatifs</div>
        <div class="mt-1 text-3xl font-bold text-danger">{overview.negativeBins.length}</div>
      </Card>
    </a>
  </div>

  <!-- B. Negative-bin attention list -->
  <div id="negative" class="mb-5">
    <h2 class="mb-2 text-sm font-semibold text-ink">Bins négatifs à corriger</h2>
    <Card padded={false}>
      {#if overview.negativeBins.length === 0}
        <EmptyState message="Aucun bin négatif." />
      {:else}
        <div class="divide-y divide-edge">
          {#each overview.negativeBins as nb (nb.id)}
            <div class="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Badge tone="danger">{nb.qtyOnHand}</Badge>
              <span class="font-medium text-ink">{nb.item.sku}</span>
              <span class="text-ink-muted">bin {nb.bin.code}</span>
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

  <!-- D. Contextual AI employee -->
  <h2 class="mt-6 mb-2 text-sm font-semibold text-ink">Préposé d'entrepôt IA</h2>
  <div class="h-[480px]">
    <AgentPanel
      presetId="warehouse-clerk"
      title="Préposé d'entrepôt IA"
      intro="Demandez l'état du stock, un réapprovisionnement ou la création d'un pick order — l'agent propose, vous approuvez."
    />
  </div>
{/if}
