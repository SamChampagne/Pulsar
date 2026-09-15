<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { pendingMove } from '$lib/wms/move-intent';
  import { PERMISSIONS, type Paginated, type WmsSite, type WmsPutawayRow } from '@pulsar/shared';
  import {
    Button,
    EmptyState,
    EntityPicker,
    ErrorNotice,
    Input,
    PageHeader,
    Skeleton,
  } from '$lib/components/ui';
  import StockMoveDrawer from '$lib/components/wms/StockMoveDrawer.svelte';
  let siteId = $state(''),
    initialized = $state(false),
    query = $state(''),
    page = $state(1);
  let data = $state<(Paginated<WmsPutawayRow> & { site: WmsSite; generatedAt: string }) | null>(
    null,
  );
  let loading = $state(true),
    error = $state(''),
    initError = $state('');
  let selected = $state<WmsPutawayRow | null>(null),
    generation = 0;
  const manage = $derived(!!$auth?.user.permissions.includes(PERMISSIONS.WMS.MANAGE));
  async function init() {
    initError = '';
    try {
      const sites = await api<Paginated<WmsSite>>('/wms/sites');
      siteId = new URL(window.location.href).searchParams.get('site') ?? sites.items[0]?.id ?? '';
      initialized = true;
    } catch (e) {
      initError = e instanceof Error ? e.message : 'Entrepôts indisponibles.';
    } finally {
      loading = false;
    }
  }
  async function load() {
    const request = ++generation,
      site = siteId;
    loading = true;
    error = '';
    if (!site) {
      data = null;
      loading = false;
      return;
    }
    if (data?.site.id !== site) data = null;
    try {
      const result = await api<typeof data>('/wms/putaway', {
        query: { locationId: site, q: query, page },
      });
      if (request === generation) data = result;
    } catch (e) {
      if (request === generation) {
        data = null;
        error = e instanceof Error ? e.message : 'Rangement indisponible.';
      }
    } finally {
      if (request === generation) loading = false;
    }
  }
  $effect(() => {
    siteId;
    query;
    untrack(() => {
      page = 1;
      selected = null;
    });
  });
  $effect(() => {
    siteId;
    query;
    page;
    if (!initialized) return;
    const timer = setTimeout(() => void load(), 180);
    return () => {
      clearTimeout(timer);
      generation++;
    };
  });
  onMount(() => {
    void init();
    const refresh = () => {
      selected = null;
      void load();
    };
    window.addEventListener('wms:stock-changed', refresh);
    return () => {
      generation++;
      window.removeEventListener('wms:stock-changed', refresh);
    };
  });
  beforeNavigate(({ cancel }) => {
    if (selected) cancel();
  });
</script>

<PageHeader title="Rangement" subtitle="Du stock réceptionné à son emplacement de travail.">
  {#snippet actions()}<Button
      variant="secondary"
      href={`/wms/movements${siteId ? `?locationId=${encodeURIComponent(siteId)}` : ''}`}
      >Journal des mouvements</Button
    >{/snippet}
</PageHeader>
<a
  class="text-sm text-accent hover:underline"
  href={`/wms${siteId ? `?site=${encodeURIComponent(siteId)}` : ''}`}>← Vue de l’entrepôt</a
>
<div class="my-5 flex flex-wrap items-end gap-3">
  <div class="w-full sm:w-80">
    <p class="mb-2 text-xs text-ink-muted">Entrepôt de travail</p>
    <EntityPicker
      endpoint="/wms/sites"
      label="Entrepôt"
      bind:value={siteId}
      disabled={!!selected}
    />
  </div>
  <div class="w-full sm:w-72">
    <Input
      aria-label="Rechercher le stock à ranger"
      bind:value={query}
      placeholder="SKU, emplacement ou zone…"
      maxlength={80}
      disabled={!!selected || !siteId}
    />
  </div>
  <Button variant="secondary" onclick={load} disabled={loading || !siteId || !!selected}
    >Actualiser</Button
  >
</div>
<ErrorNotice message={initError} onretry={init} /><ErrorNotice message={error} onretry={load} />
{#if loading && !data}<Skeleton rows={6} />
{:else if !siteId && !initError}<EmptyState
    title="Choisissez un entrepôt"
    message="Le rangement se fait entre emplacements d’un même site."
  />
{:else if data}
  <section class="mb-5 border-y border-edge py-4" aria-label="Contexte du rangement">
    <div class="flex flex-wrap items-baseline justify-between gap-3">
      <h2 class="font-semibold">{data.site.name}</h2>
      <span class="text-sm tabular-nums">{data.total} article(s) / emplacement(s) à ranger</span>
    </div>
    <p class="mt-2 max-w-3xl text-xs leading-relaxed text-ink-muted">
      Stock physique positif dans les emplacements de réception. Chaque ligne est un article à un
      emplacement, pas un lot de provenance ni une réservation. Aucun total ne mélange des unités
      différentes.
    </p>
  </section>
  {#if loading}<p role="status" class="mb-3 text-xs text-ink-muted">Actualisation du stock…</p>{/if}
  <div class="space-y-3">
    {#each data.items as row (`${row.binId}:${row.itemId}`)}
      <article
        aria-label={`À ranger ${row.sku} depuis ${row.binCode}`}
        class="grid min-w-0 items-center gap-4 rounded-lg border border-edge bg-surface p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
      >
        <div>
          <p class="font-mono text-sm font-semibold">{row.sku}</p>
          <p class="mt-1 break-words text-sm text-ink-muted">{row.name}</p>
          <p class="mt-2 font-mono text-xl font-semibold">
            {row.qtyOnHand} <span class="text-sm font-normal text-ink-muted">{row.unit}</span>
          </p>
        </div>
        <div class="border-l-2 border-edge pl-4">
          <p class="text-xs text-ink-muted">En réception</p>
          <a
            class="mt-1 inline-block font-mono text-sm text-accent hover:underline"
            href={`/wms?site=${encodeURIComponent(siteId)}&bin=${encodeURIComponent(row.binId)}`}
            >{row.binCode} ↗</a
          >
          <p class="mt-1 text-xs text-ink-muted">
            {row.zone || 'Sans zone'}{!row.isActive ? ' · article inactif' : ''}{!row.binActive
              ? ' · emplacement inactif'
              : ''}
          </p>
        </div>
        <div class="flex flex-wrap gap-2 md:flex-col">
          {#if manage}<Button
              disabled={loading || !!selected || !row.binActive || !!$pendingMove}
              onclick={() => {
                selected = row;
              }}>Ranger {row.sku}</Button
            >{/if}
          <a
            class="py-2 text-xs text-accent hover:underline"
            href={`/wms/movements?itemId=${encodeURIComponent(row.itemId)}&binId=${encodeURIComponent(row.binId)}&locationId=${encodeURIComponent(siteId)}`}
            >Voir les mouvements ↗</a
          >
        </div>
      </article>
    {:else}<EmptyState
        title={query ? 'Aucun stock correspondant' : 'Aucun stock en attente de rangement'}
        message={query
          ? 'Précisez un autre SKU ou emplacement.'
          : 'Validez une réception vers un emplacement de type Réception pour commencer.'}
      />{/each}
  </div>
  {#if data.total > data.pageSize}<nav
      aria-label="Pages du rangement"
      class="mt-5 flex flex-wrap items-center justify-end gap-3"
    >
      <Button
        variant="secondary"
        disabled={page <= 1 || loading}
        onclick={() => {
          page--;
        }}>Précédente</Button
      ><span class="text-xs">Page {page} / {Math.ceil(data.total / data.pageSize)}</span><Button
        variant="secondary"
        disabled={page * data.pageSize >= data.total || loading}
        onclick={() => {
          page++;
        }}>Suivante</Button
      >
    </nav>{/if}
{/if}
{#if selected}<StockMoveDrawer
    source={selected}
    onclose={() => (selected = null)}
    onsaved={async () => {
      selected = null;
      await load();
    }}
  />{/if}
