<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    MODULE_KEYS,
    PERMISSIONS,
    type WmsWorkspace,
    type WmsSite,
    type Paginated,
  } from '@pulsar/shared';
  import {
    Button,
    Card,
    EmptyState,
    EntityPicker,
    ErrorNotice,
    Input,
    PageHeader,
    Skeleton,
  } from '$lib/components/ui';
  import WarehouseZones from '$lib/components/wms/WarehouseZones.svelte';
  import WarehouseFlow from '$lib/components/wms/WarehouseFlow.svelte';
  import WarehouseBinDrawer from '$lib/components/wms/WarehouseBinDrawer.svelte';
  import LocationFormModal from '$lib/components/locations/LocationFormModal.svelte';
  import type { LocationRecord } from '$lib/components/locations/types';
  let siteId = $state(''),
    initialized = $state(false),
    query = $state(''),
    page = $state(1);
  let data = $state<WmsWorkspace | null>(null),
    loading = $state(true),
    error = $state(''),
    initError = $state('');
  let binId = $state(''),
    generation = 0,
    pendingBin = '';
  let sitesEmpty = $state(false);
  let showCreateSite = $state(false);
  const yard = $derived(
    !!$auth?.tenant.enabledModules.includes(MODULE_KEYS.YARD) &&
      !!$auth?.user.permissions.includes(PERMISSIONS.YARD.READ),
  );
  const canManage = $derived(!!$auth?.user.permissions.includes(PERMISSIONS.WMS.MANAGE));
  const canManageLocations = $derived(
    !!$auth?.user.permissions.includes(PERMISSIONS.CORE.LOCATIONS_MANAGE),
  );
  const canReadLocations = $derived(
    !!$auth?.user.permissions.includes(PERMISSIONS.CORE.LOCATIONS_READ),
  );
  async function init() {
    initError = '';
    loading = true;
    try {
      const params = new URL(window.location.href).searchParams;
      const sites = await api<Paginated<WmsSite>>('/wms/sites');
      sitesEmpty = sites.total === 0;
      pendingBin = params.get('bin') ?? '';
      siteId = params.get('site') ?? sites.items[0]?.id ?? '';
      initialized = true;
    } catch (e) {
      initError = e instanceof Error ? e.message : 'Entrepôts indisponibles.';
    } finally {
      loading = false;
    }
  }
  async function onSiteCreated(loc: LocationRecord) {
    showCreateSite = false;
    await init();
    siteId = loc.id;
  }
  async function load() {
    const id = siteId,
      p = page,
      q = query,
      request = ++generation;
    if (!id) {
      data = null;
      loading = false;
      return;
    }
    loading = true;
    error = '';
    if (data?.site.id !== id) data = null;
    try {
      const result = await api<WmsWorkspace>('/wms/workspace', {
        query: { locationId: id, q, page: p },
      });
      if (request === generation) {
        data = result;
        if (pendingBin) {
          binId = pendingBin;
          pendingBin = '';
        }
      }
    } catch (e) {
      if (request === generation) {
        data = null;
        error = e instanceof Error ? e.message : 'Entrepôt indisponible.';
      }
    } finally {
      if (request === generation) loading = false;
    }
  }
  $effect(() => {
    siteId;
    untrack(() => {
      page = 1;
      binId = '';
      data = null;
    });
  });
  $effect(() => {
    query;
    untrack(() => (page = 1));
  });
  $effect(() => {
    siteId;
    query;
    page;
    if (!initialized) return;
    const timer = setTimeout(() => void load(), 200);
    return () => {
      clearTimeout(timer);
      generation++;
    };
  });
  onMount(() => {
    void init();
    const refresh = () => {
      binId = '';
      void load();
    };
    window.addEventListener('wms:stock-changed', refresh);
    return () => {
      generation++;
      window.removeEventListener('wms:stock-changed', refresh);
    };
  });
  beforeNavigate(({ cancel }) => {
    if (binId) cancel();
  });
</script>

<PageHeader
  title="Entrepôt"
  subtitle="Votre poste de travail par site : réception, rangement et préparation."
>
  {#snippet actions()}<Button variant="secondary" href="/wms/inventory">Inventaire détaillé</Button
    ><Button variant="secondary" href="/wms/receiving">Réceptions</Button>
    <Button
      variant="secondary"
      href={`/wms/movements${siteId ? `?locationId=${encodeURIComponent(siteId)}` : ''}`}
      >Journal des mouvements</Button
    >{/snippet}
</PageHeader>
<div class="mb-5 flex flex-wrap items-end gap-3">
  <div class="w-full sm:w-80">
    <p class="mb-1.5 text-xs font-medium text-ink-muted">Site de travail</p>
    <EntityPicker endpoint="/wms/sites" label="Entrepôt" bind:value={siteId} disabled={!!binId} />
  </div>
  {#if canManageLocations}
    <Button
      variant="secondary"
      onclick={() => {
        showCreateSite = true;
      }}>+ Entrepôt</Button
    >
  {/if}
  <Button variant="secondary" disabled={loading || !siteId || !!binId} onclick={load}
    >Actualiser</Button
  >
  {#if data && yard}<Button variant="ghost" href={`/yard?site=${encodeURIComponent(data.site.id)}`}
      >Cour & quais ↗</Button
    >{/if}
  {#if canManage}<Button variant="ghost" href="/wms/bins">Gérer les emplacements</Button>{/if}
</div>
<ErrorNotice message={initError} onretry={init} /><ErrorNotice message={error} onretry={load} />
<div class="mb-5 max-w-sm">
  <Input
    aria-label="Rechercher un emplacement ou une zone"
    bind:value={query}
    maxlength={80}
    placeholder="Emplacement ou zone…"
    disabled={!!binId || !siteId}
  />
</div>
{#if loading && !data}<Skeleton rows={8} />
{:else if !error && !initError && !siteId && sitesEmpty}<Card
    ><EmptyState
      title="Aucun entrepôt"
      message={canManageLocations
        ? 'Créez votre premier entrepôt pour commencer à réceptionner, ranger et préparer.'
        : 'Demandez à un administrateur de créer un lieu de type entrepôt.'}
    >
      {#snippet children()}
        {#if canManageLocations}
          <Button
            onclick={() => {
              showCreateSite = true;
            }}>Créer un entrepôt</Button
          >
        {:else if canReadLocations}
          <Button variant="secondary" href="/locations">Voir les lieux</Button>
        {/if}
      {/snippet}
    </EmptyState></Card
  >
{:else if !error && !initError && !siteId}<Card
    ><EmptyState
      title="Choisissez un entrepôt"
      message="Sélectionnez un site existant. Si aucun site n’est disponible, demandez à un administrateur de créer une localisation de type entrepôt."
    /></Card
  >
{:else if data}
  <div
    class="mb-6 flex flex-wrap items-center gap-x-7 gap-y-3 border-y border-edge py-4"
    aria-label="État du site"
  >
    <div>
      <span class="text-xl font-semibold tabular-nums">{data.summary.bins}</span><span
        class="ml-2 text-xs text-ink-muted">emplacements</span
      >
    </div>
    <div>
      <span class="text-xl font-semibold tabular-nums">{data.summary.stockedBins}</span><span
        class="ml-2 text-xs text-ink-muted">avec du stock</span
      >
    </div>
    <div>
      <span class="text-xl font-semibold tabular-nums">{data.summary.inactiveBins}</span><span
        class="ml-2 text-xs text-ink-muted">inactifs</span
      >
    </div>
    <a href="/wms/cycle-counts" class="text-xs text-accent hover:underline"
      >{data.summary.cycleCounts} inventaire(s) tournant(s) ouvert(s) ↗</a
    >
    <span class="text-xs text-ink-faint"
      >Actualisé à {new Date(data.generatedAt).toLocaleTimeString('fr-CA', {
        hour: '2-digit',
        minute: '2-digit',
      })}</span
    >
  </div>
  {#if data.summary.negativeLevels}<p
      role="alert"
      class="mb-5 rounded-md border border-danger/30 p-3 text-sm text-danger"
    >
      {data.summary.negativeLevels} solde(s) négatif(s) à vérifier dans l’inventaire.
    </p>{/if}
  <WarehouseFlow {data} onbin={(id) => (binId = id)} />
  <section class="mt-8" aria-label="Vue des emplacements">
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold">Les zones et leurs emplacements</h2>
        <p class="mt-1 text-xs text-ink-muted">
          Vue schématique, sans échelle physique ni estimation de capacité. Les quantités restent
          par article et unité.
        </p>
      </div>
    </div>
    {#if !data.bins.total}<Card
        ><EmptyState
          title={query ? 'Aucun emplacement correspondant' : 'Aucun emplacement configuré'}
          message={query
            ? 'Essayez un autre code ou nom de zone.'
            : 'Ajoutez des emplacements de réception, stockage et expédition. Le plan utilisera vos données réelles.'}
        />{#if canManage && !query}<Button variant="secondary" href="/wms/bins"
            >Créer les emplacements</Button
          >{/if}</Card
      >{:else}<WarehouseZones bins={data.bins.items} onselect={(id) => (binId = id)} />{/if}
    {#if data.bins.total > data.bins.pageSize}<nav
        class="mt-4 flex items-center justify-end gap-3"
        aria-label="Pages des emplacements"
      >
        <Button
          variant="secondary"
          disabled={page <= 1 || loading}
          onclick={() => {
            page--;
          }}>Précédente</Button
        ><span class="text-xs tabular-nums"
          >Page {page} / {Math.ceil(data.bins.total / data.bins.pageSize)} · {data.bins.total} résultats</span
        ><Button
          variant="secondary"
          disabled={page * data.bins.pageSize >= data.bins.total || loading}
          onclick={() => {
            page++;
          }}>Suivante</Button
        >
      </nav>{/if}
  </section>
{/if}
{#if binId && data}<WarehouseBinDrawer
    {binId}
    siteId={data.site.id}
    onclose={() => (binId = '')}
    onsaved={async () => {
      binId = '';
      await load();
    }}
  />{/if}
<LocationFormModal
  bind:open={showCreateSite}
  location={null}
  lockedType="WAREHOUSE"
  oncreated={onSiteCreated}
/>
