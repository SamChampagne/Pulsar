<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { page as route } from '$app/state';
  import { api } from '$lib/api/client';
  import { WMS_MOVEMENT_LABELS, type Paginated, type WmsMovementRow } from '@pulsar/shared';
  import {
    Badge,
    Button,
    EmptyState,
    EntityPicker,
    ErrorNotice,
    Field,
    Input,
    PageHeader,
    Select,
    Skeleton,
  } from '$lib/components/ui';
  let siteId = $state(''),
    query = $state(''),
    type = $state(''),
    page = $state(1);
  let data = $state<(Paginated<WmsMovementRow> & { generatedAt: string }) | null>(null);
  let loading = $state(true),
    error = $state(''),
    generation = 0;
  const itemId = $derived(route.url.searchParams.get('itemId') ?? '');
  const binId = $derived(route.url.searchParams.get('binId') ?? '');
  const refId = $derived(route.url.searchParams.get('refId') ?? '');
  const refType = $derived(route.url.searchParams.get('refType') ?? '');
  $effect(() => {
    siteId = route.url.searchParams.get('locationId') ?? '';
  });
  $effect(() => {
    siteId;
    query;
    type;
    itemId;
    binId;
    refId;
    refType;
    untrack(() => (page = 1));
  });
  async function load() {
    const request = ++generation;
    loading = true;
    error = '';
    try {
      const result = await api<typeof data>('/wms/inventory/movements', {
        query: {
          locationId: siteId,
          search: query,
          type,
          itemId,
          binId,
          refId,
          refType,
          page,
          pageSize: 30,
        },
      });
      if (request === generation) data = result;
    } catch (e) {
      if (request === generation) {
        data = null;
        error = e instanceof Error ? e.message : 'Journal indisponible.';
      }
    } finally {
      if (request === generation) loading = false;
    }
  }
  $effect(() => {
    siteId;
    query;
    type;
    itemId;
    binId;
    refId;
    refType;
    page;
    data = null;
    const timer = setTimeout(() => void load(), 180);
    return () => {
      clearTimeout(timer);
      generation++;
    };
  });
  onMount(() => {
    const refresh = () => void load();
    window.addEventListener('wms:stock-changed', refresh);
    return () => {
      generation++;
      window.removeEventListener('wms:stock-changed', refresh);
    };
  });
  function sourceHref(source: NonNullable<WmsMovementRow['source']>) {
    const path =
      source.kind === 'receipt'
        ? 'receiving'
        : source.kind === 'pick-order'
          ? 'picking'
          : 'cycle-counts';
    return `/wms/${path}/${encodeURIComponent(source.id)}`;
  }
</script>

<PageHeader
  title="Journal des mouvements"
  subtitle="Les entrées, sorties et déplacements réellement enregistrés."
>
  {#snippet actions()}<Button variant="secondary" disabled={loading} onclick={load}
      >Actualiser le journal</Button
    >{/snippet}
</PageHeader>
<nav
  class="mb-5 flex flex-wrap gap-4 text-sm text-accent"
  aria-label="Retour aux opérations de stock"
>
  <a href={`/wms${siteId ? `?site=${encodeURIComponent(siteId)}` : ''}`} class="hover:underline"
    >← Entrepôt</a
  >
  <a
    href={`/wms/putaway${siteId ? `?site=${encodeURIComponent(siteId)}` : ''}`}
    class="hover:underline">Rangement</a
  >
  {#if itemId || binId || refId}<a href="/wms/movements" class="hover:underline"
      >Retirer le filtre du dossier</a
    >{/if}
</nav>
{#if itemId || binId || refId}<p
    class="mb-4 rounded-md bg-surface-muted p-3 text-xs text-ink-muted"
  >
    Journal ciblé{itemId ? ' sur un article' : ''}{binId
      ? ' et un emplacement (entrée ou sortie)'
      : ''}{refId ? ' sur le document ouvert' : ''}. Les filtres suivants s’ajoutent à ce contexte.
  </p>{/if}
<div class="mb-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_12rem]">
  <Field label="Entrepôt"
    ><EntityPicker
      endpoint="/wms/sites"
      label="Entrepôt"
      bind:value={siteId}
      placeholder="Tous les entrepôts"
    /></Field
  >
  <Field label="Rechercher un mouvement"
    ><Input bind:value={query} maxlength={120} placeholder="SKU, emplacement ou note…" /></Field
  >
  <Field label="Type de mouvement"
    ><Select bind:value={type}
      ><option value="">Tous les types</option
      >{#each Object.entries(WMS_MOVEMENT_LABELS) as [key, label]}<option value={key}
          >{label}</option
        >{/each}</Select
    ></Field
  >
</div>
<ErrorNotice message={error} onretry={load} />
{#if loading && !data}<Skeleton rows={6} />{:else if data}
  <div
    class="mb-4 flex flex-wrap justify-between gap-3 border-y border-edge py-3 text-xs text-ink-muted"
  >
    <span>{data.total} mouvement(s) · plus récents d’abord</span><span
      >Registre en lecture seule · aucune somme multi-unités</span
    >
  </div>
  <div class="space-y-3">
    {#each data.items as movement (movement.id)}
      <article
        class="min-w-0 rounded-lg border border-edge bg-surface p-4"
        aria-label={`Mouvement ${movement.item.sku}`}
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <Badge>{WMS_MOVEMENT_LABELS[movement.type] ?? movement.type}</Badge><time
                class="text-xs text-ink-muted"
                datetime={movement.createdAt}
                >{new Date(movement.createdAt).toLocaleString('fr-CA')}</time
              >
            </div>
            <p class="mt-3 font-mono text-sm font-semibold">{movement.item.sku}</p>
            <p class="mt-1 break-words text-sm text-ink-muted">{movement.item.name}</p>
          </div>
          <div class="text-right">
            <p class="font-mono text-lg font-semibold">
              {movement.qty} <span class="text-sm font-normal">{movement.unit}</span>
            </p>
            {#if !movement.unitCaptured}<p class="mt-1 text-xs text-warn">
                Unité actuelle · historique non figé
              </p>{/if}
          </div>
        </div>
        <div
          class="my-4 grid items-center gap-3 rounded-md bg-surface-muted p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
        >
          <div>
            <p class="text-xs text-ink-muted">Source</p>
            {#if movement.fromBin}<a
                class="font-mono text-sm text-accent hover:underline"
                href={`/wms?site=${encodeURIComponent(movement.fromBin.locationId)}&bin=${encodeURIComponent(movement.fromBin.id)}`}
                >{movement.fromBin.code} ↗</a
              >
              <p class="text-xs text-ink-muted">{movement.fromBin.locationName}</p>{:else}<p
                class="text-sm"
              >
                {movement.type === 'RECEIPT' ? 'Entrée en stock' : 'Hors emplacement'}
              </p>{/if}
          </div>
          <span class="text-ink-faint" aria-hidden="true">→</span>
          <div>
            <p class="text-xs text-ink-muted">Destination</p>
            {#if movement.toBin}<a
                class="font-mono text-sm text-accent hover:underline"
                href={`/wms?site=${encodeURIComponent(movement.toBin.locationId)}&bin=${encodeURIComponent(movement.toBin.id)}`}
                >{movement.toBin.code} ↗</a
              >
              <p class="text-xs text-ink-muted">{movement.toBin.locationName}</p>{:else}<p
                class="text-sm"
              >
                Sortie du stock
              </p>{/if}
          </div>
        </div>
        {#if movement.note}<p class="mb-3 whitespace-pre-wrap break-words text-sm text-ink-muted">
            {movement.note}
          </p>{/if}
        <div class="flex flex-wrap justify-between gap-3 text-xs">
          <span class="text-ink-muted">{movement.actor ?? 'Acteur non renseigné'}</span
          >{#if movement.source}<a
              class="text-accent hover:underline"
              href={sourceHref(movement.source)}>{movement.source.number} ↗</a
            >{:else}<span class="text-ink-faint">Sans dossier disponible</span>{/if}
        </div>
      </article>
    {:else}<EmptyState
        title="Aucun mouvement correspondant"
        message="Modifiez les filtres ou enregistrez une opération de stock. Aucun mouvement n’est créé par cette consultation."
      />{/each}
  </div>
  {#if data.total > data.pageSize}<nav
      aria-label="Pages du journal"
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
