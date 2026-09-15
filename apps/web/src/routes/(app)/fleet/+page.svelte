<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    FLEET_ASSET_LABELS,
    FLEET_ORDER_LABELS,
    FLEET_TYPE_LABELS,
    fleetAttention,
    fleetDateKey,
    PERMISSIONS,
    type FleetAssetRow,
    type FleetWorkspace,
    type FleetAgenda,
  } from '@pulsar/shared';
  import {
    Badge,
    Button,
    EmptyState,
    ErrorNotice,
    Field,
    Input,
    PageHeader,
    Select,
    Skeleton,
    Tabs,
  } from '$lib/components/ui';
  import FleetAssetDrawer from '$lib/components/fleet/FleetAssetDrawer.svelte';
  import FleetOrderDrawer from '$lib/components/fleet/FleetOrderDrawer.svelte';
  let kind = $state('vehicle'),
    ownership = $state('internal'),
    status = $state(''),
    search = $state(''),
    view = $state('park');
  let page = $state(1),
    workPage = $state(1),
    bucket = $state('dated'),
    from = $state(fleetDateKey(new Date()));
  let data = $state<FleetWorkspace | null>(null),
    agenda = $state<FleetAgenda | null>(null),
    loading = $state(true),
    error = $state(''),
    generation = 0;
  let selected = $state<FleetAssetRow | null>(null),
    order = $state<{ id: string; asset: FleetAssetRow | null } | null>(null);
  const masterRead = $derived(
    !!$auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ) &&
      !!$auth?.tenant.enabledModules.includes('transportation'),
  );
  const busyPanel = $derived(!!selected || !!order);
  $effect(() => {
    kind;
    ownership;
    status;
    search;
    untrack(() => {
      page = 1;
      workPage = 1;
    });
  });
  $effect(() => {
    bucket;
    from;
    untrack(() => {
      workPage = 1;
    });
  });
  async function load() {
    const request = ++generation;
    loading = true;
    error = '';
    try {
      const [park, work] = await Promise.all([
        api<FleetWorkspace>('/fleet/workspace', {
          query: { kind, ownership, status, search, page, pageSize: 30 },
        }),
        api<FleetAgenda>('/fleet/workspace/orders', {
          query: { kind, ownership, status, search, bucket, from, page: workPage, pageSize: 30 },
        }),
      ]);
      if (request === generation) {
        data = park;
        agenda = work;
      }
    } catch (e) {
      if (request === generation) {
        data = null;
        agenda = null;
        error = e instanceof Error ? e.message : 'Poste flotte indisponible.';
      }
    } finally {
      if (request === generation) loading = false;
    }
  }
  $effect(() => {
    kind;
    ownership;
    status;
    search;
    page;
    workPage;
    bucket;
    from;
    data = null;
    agenda = null;
    const timer = setTimeout(() => void load(), 180);
    return () => {
      clearTimeout(timer);
      generation++;
    };
  });
  onMount(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('order')) order = { id: url.searchParams.get('order')!, asset: null };
    return () => {
      generation++;
    };
  });
  beforeNavigate(({ cancel }) => {
    if (busyPanel) cancel();
  });
  function openOrder(id: string, asset: FleetAssetRow) {
    selected = null;
    order = { id, asset };
  }
  function shiftWeek(direction: number) {
    from = fleetDateKey(
      new Date(new Date(`${from}T00:00:00Z`).getTime() + direction * 7 * 86400000),
    );
  }
</script>

<svelte:head><title>Poste flotte — Pulsar</title></svelte:head>
<PageHeader
  title="Flotte"
  subtitle="Disponibilité enregistrée, interventions et échéances au même endroit."
>
  {#snippet actions()}{#if masterRead}<Button variant="secondary" href="/fleet/register"
        >Registre et plans préventifs</Button
      >{/if}<Button
      variant="secondary"
      disabled={busyPanel}
      onclick={() => {
        view = 'agenda';
        bucket = 'history';
      }}>Historique maintenance</Button
    >{/snippet}
</PageHeader>
<div class="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-[10rem_12rem_12rem_minmax(12rem,1fr)_auto]">
  <Field label="Type d’actif"
    ><Select bind:value={kind} disabled={busyPanel}
      ><option value="vehicle">Véhicules</option><option value="trailer">Remorques</option></Select
    ></Field
  >
  <Field label="Périmètre"
    ><Select bind:value={ownership} disabled={busyPanel}
      ><option value="internal">Parc interne</option><option value="all">Tous les actifs</option
      ></Select
    ></Field
  >
  <Field label="État enregistré"
    ><Select bind:value={status} disabled={busyPanel}
      ><option value="">Tous les états</option
      >{#each Object.entries(FLEET_ASSET_LABELS) as [key, label]}<option value={key}>{label}</option
        >{/each}</Select
    ></Field
  >
  <Field label="Rechercher dans le parc"
    ><Input
      bind:value={search}
      placeholder="Unité ou plaque…"
      maxlength={80}
      disabled={busyPanel}
    /></Field
  >
  <div class="self-end">
    <Button variant="secondary" onclick={load} disabled={loading || busyPanel}>Actualiser</Button>
  </div>
</div>
<ErrorNotice message={error} onretry={load} />
{#if loading && !data}<Skeleton rows={6} />{:else if data && agenda}
  <section class="mb-5 border-y border-edge py-4" aria-label="État global du parc sélectionné">
    <div class="flex flex-wrap items-center gap-x-8 gap-y-4">
      <div>
        <p class="font-mono text-2xl font-semibold">{data.summary.total}</p>
        <p class="text-xs text-ink-muted">
          {kind === 'vehicle' ? 'Véhicules' : 'Remorques'} · {ownership === 'internal'
            ? 'internes'
            : 'tous'}
        </p>
      </div>
      {#each [['AVAILABLE', 'available'], ['IN_SERVICE', 'inService'], ['MAINTENANCE', 'maintenance'], ['RETIRED', 'retired']] as [state, key]}<div
        >
          <p class="font-mono text-xl font-semibold">
            {data.summary[key as 'available' | 'inService' | 'maintenance' | 'retired']}
          </p>
          <p class="text-xs text-ink-muted">{FLEET_ASSET_LABELS[state]}</p>
        </div>{/each}
    </div>
    <p class="mt-3 max-w-3xl text-xs leading-relaxed text-ink-muted">
      Statuts de tout ce périmètre, avant recherche. Une unité « disponible » peut être affectée au
      transport; les interventions et documents restent à vérifier dans sa fiche.
    </p>
  </section>
  <Tabs
    bind:active={view}
    label="Poste flotte"
    tabs={[
      { id: 'park', label: `Parc · ${data.total}` },
      { id: 'agenda', label: 'Échéancier maintenance' },
    ]}
  >
    {#if view === 'park'}
      <div class="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {#each data.items as asset (asset.id)}
          <button
            aria-label={`Consulter ${asset.unitNumber}`}
            disabled={loading || busyPanel}
            class="group min-w-0 rounded-lg border border-edge bg-surface p-4 text-left transition-colors duration-150 hover:border-accent/40 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
            onclick={() => {
              selected = asset;
            }}
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="font-mono text-lg font-semibold">{asset.unitNumber}</p>
                <p class="mt-1 text-xs text-ink-muted">{asset.plate || 'Plaque non renseignée'}</p>
              </div>
              <Badge
                tone={asset.status === 'RETIRED'
                  ? 'neutral'
                  : asset.openOrders || asset.status === 'MAINTENANCE'
                    ? 'warn'
                    : asset.status === 'IN_SERVICE'
                      ? 'info'
                      : 'neutral'}>{FLEET_ASSET_LABELS[asset.status]}</Badge
              >
            </div>
            <div class="mt-5 border-t border-edge pt-3">
              <p class="text-sm font-medium">{fleetAttention(asset)}</p>
              <p class="mt-2 text-xs text-ink-muted">
                {asset.expiredDocuments
                  ? `${asset.expiredDocuments} document(s) expiré(s)`
                  : 'Aucun document expiré enregistré'} · {asset.expiringDocuments} à renouveler
              </p>
            </div>
            <div class="mt-4 flex justify-between gap-3 text-xs">
              <span class="text-ink-muted">{asset.internal ? 'Interne' : 'Transporteur'}</span><span
                class="text-accent">Ouvrir le dossier →</span
              >
            </div>
          </button>
        {:else}<div class="md:col-span-2">
            <EmptyState
              title="Aucun actif correspondant"
              message="Modifiez les filtres ou ajoutez un véhicule ou une remorque dans le registre existant."
            />{#if masterRead}<Button variant="secondary" href="/fleet/register"
                >Ouvrir le registre</Button
              >{/if}
          </div>{/each}
      </div>
      {#if data.total > data.pageSize}<nav
          class="mt-5 flex items-center justify-end gap-3"
          aria-label="Pages du parc"
        >
          <Button
            variant="secondary"
            disabled={page <= 1 || busyPanel}
            onclick={() => {
              page--;
            }}>Précédente</Button
          ><span class="text-xs">Page {page} / {Math.ceil(data.total / data.pageSize)}</span><Button
            variant="secondary"
            disabled={page * data.pageSize >= data.total || busyPanel}
            onclick={() => {
              page++;
            }}>Suivante</Button
          >
        </nav>{/if}
    {:else}
      <div class="mb-5 flex flex-wrap items-end gap-3">
        <Field label="Semaine à partir du (UTC)"
          ><Input type="date" bind:value={from} disabled={busyPanel} /></Field
        ><Button variant="secondary" disabled={busyPanel || !from} onclick={() => shiftWeek(-1)}
          >− 7 jours</Button
        ><Button variant="secondary" disabled={busyPanel || !from} onclick={() => shiftWeek(1)}
          >+ 7 jours</Button
        ><Field label="File des interventions"
          ><Select bind:value={bucket} disabled={busyPanel}
            ><option value="dated">Cette semaine · {agenda.counts.dated}</option><option
              value="overdue">Avant cette semaine · {agenda.counts.overdue}</option
            ><option value="undated">Sans échéance · {agenda.counts.undated}</option><option
              value="history">Terminées et annulées · {agenda.counts.history}</option
            ></Select
          ></Field
        >
      </div>
      {#if bucket !== 'history'}<section
          aria-label="Charge de maintenance sur sept jours"
          class="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7"
        >
          {#each agenda.days as day}<div
              class="min-w-0 rounded-md border border-edge p-3"
              class:bg-surface-muted={day.count > 0}
            >
              <p class="text-xs text-ink-muted">
                {new Date(`${day.date}T00:00:00Z`).toLocaleDateString('fr-CA', {
                  weekday: 'short',
                  timeZone: 'UTC',
                })}
              </p>
              <p class="mt-1 font-mono text-xs">{day.date.slice(5)}</p>
              <p class="mt-4 font-mono text-2xl font-semibold">{day.count}</p>
              <p class="mt-1 text-xs text-ink-muted">à échéance</p>
            </div>{/each}
        </section>{/if}
      <p class="mb-4 text-xs text-ink-muted">
        {bucket === 'history'
          ? 'Ordres terminés et annulés, toutes dates, les plus récents en premier.'
          : 'Échéances UTC des ordres ouverts ou en cours. Pas de durée estimée, réservation d’atelier ou disponibilité future déduite.'}
        {agenda.total} intervention(s) dans cette file.
      </p>
      <div class="space-y-3">
        {#each agenda.items as wo (wo.id)}<button
            aria-label={`Intervention ${wo.description}`}
            class="grid w-full min-w-0 gap-4 rounded-lg border border-edge p-4 text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent md:grid-cols-[8rem_minmax(0,1fr)_auto]"
            disabled={busyPanel || loading}
            onclick={() => {
              order = { id: wo.id, asset: null };
            }}
          >
            <div class="border-l-2 border-accent/30 pl-3">
              <p class="font-mono text-sm font-semibold">
                {wo.dueDate ? fleetDateKey(wo.dueDate) : 'À dater'}
              </p>
              <p class="mt-1 text-xs text-ink-muted">{FLEET_TYPE_LABELS[wo.type]}</p>
            </div>
            <div class="min-w-0">
              <p class="break-words text-sm font-semibold">{wo.description}</p>
              <p class="mt-1 text-sm text-ink-muted">
                <span class="font-mono">{wo.asset?.unitNumber ?? 'Actif non renseigné'}</span> · {wo.vendor ||
                  'Prestataire à préciser'}
              </p>
            </div>
            <div class="flex items-center gap-3">
              <Badge>{FLEET_ORDER_LABELS[wo.status]}</Badge><span class="text-accent">→</span>
            </div>
          </button>{:else}<EmptyState
            title="Aucune intervention dans cette file"
            message="Consultez les autres semaines ou les ordres sans échéance. Les plans préventifs n’immobilisent pas le parc avant ouverture d’un ordre."
          />{/each}
      </div>
      {#if agenda.total > agenda.pageSize}<nav
          class="mt-5 flex items-center justify-end gap-3"
          aria-label="Pages de l’échéancier"
        >
          <Button
            variant="secondary"
            disabled={workPage <= 1 || busyPanel}
            onclick={() => {
              workPage--;
            }}>Précédente</Button
          ><span class="text-xs">Page {workPage} / {Math.ceil(agenda.total / agenda.pageSize)}</span
          ><Button
            variant="secondary"
            disabled={workPage * agenda.pageSize >= agenda.total || busyPanel}
            onclick={() => {
              workPage++;
            }}>Suivante</Button
          >
        </nav>{/if}
    {/if}
  </Tabs>
{/if}
{#if selected}<FleetAssetDrawer
    asset={selected}
    onclose={() => {
      selected = null;
    }}
    onorder={openOrder}
  />{/if}
{#if order}{#key order.id}<FleetOrderDrawer
      id={order.id}
      asset={order.asset}
      onclose={() => {
        order = null;
      }}
      onsaved={load}
    />{/key}{/if}
