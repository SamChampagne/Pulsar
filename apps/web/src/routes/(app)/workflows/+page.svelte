<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { page as route } from '$app/state';
  import {
    PERMISSIONS,
    SalesOrderStatus,
    TransportOrderStatus,
    ShipmentStatus,
    LoadStatus,
    type DossierRootType,
    type Paginated,
  } from '@pulsar/shared';
  import { auth } from '$lib/stores/auth';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    EmptyState,
    ErrorNotice,
    Skeleton,
    Table,
    labelFor,
    toneFor,
  } from '$lib/components/ui';
  import DossierPanel from '$lib/components/workflows/DossierPanel.svelte';
  import { parseWorkViews, type WorkView } from '$lib/workflows/saved-views';
  interface Row {
    id: string;
    number?: string;
    orderNumber?: string;
    shipmentNumber?: string;
    loadNumber?: string;
    status: string;
    createdAt: string;
  }
  const sources = [
    {
      type: 'SALES_ORDER' as const,
      label: 'Commandes commerciales',
      module: 'crm',
      permission: PERMISSIONS.CRM.READ,
      path: '/crm/sales-orders',
      statuses: Object.values(SalesOrderStatus),
    },
    {
      type: 'TRANSPORT_ORDER' as const,
      label: 'Ordres de transport',
      module: 'transportation',
      permission: PERMISSIONS.TRANSPORTATION.ORDERS_READ,
      path: '/transportation/transport-orders',
      statuses: Object.values(TransportOrderStatus),
    },
    {
      type: 'SHIPMENT' as const,
      label: 'Expéditions',
      module: 'transportation',
      permission: PERMISSIONS.TRANSPORTATION.ORDERS_READ,
      path: '/transportation/shipments',
      statuses: Object.values(ShipmentStatus),
    },
    {
      type: 'LOAD' as const,
      label: 'Chargements',
      module: 'transportation',
      permission: PERMISSIONS.TRANSPORTATION.PLANNING_READ,
      path: '/transportation/loads',
      statuses: Object.values(LoadStatus),
    },
  ];
  const allowed = $derived(
    sources.filter(
      (s) =>
        $auth?.tenant.enabledModules.some((m) => m === s.module) &&
        $auth.user.permissions.includes(s.permission),
    ),
  );
  const authorized = $derived(
    $auth?.tenant.enabledModules.includes('analytics') &&
      $auth.user.permissions.includes(PERMISSIONS.ANALYTICS.READ),
  );
  const storageKey = $derived(`pulsar:work-views:v1:${$auth?.tenant.id}:${$auth?.user.id}`);
  let type = $state<DossierRootType>('SALES_ORDER');
  const source = $derived(allowed.find((s) => s.type === type));
  let search = $state('');
  let status = $state('');
  let currentPage = $state(1);
  let rows = $state<Row[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let error = $state('');
  let ready = $state(false);
  let refresh = $state(0);
  let selectedId = $state('');
  let selectedType = $state<DossierRootType>('SALES_ORDER');
  let panelOpen = $state(false);
  let views = $state<WorkView[]>([]);
  let viewName = $state('');
  let storageError = $state('');
  let request = 0;
  const pages = $derived(Math.max(1, Math.ceil(total / 25)));
  const number = (row: Row) =>
    row.number ?? row.orderNumber ?? row.shipmentNumber ?? row.loadNumber ?? row.id;
  onMount(() => {
    try {
      views = parseWorkViews(localStorage.getItem(storageKey));
    } catch {
      storageError = 'Les vues ne peuvent pas être conservées sur cet appareil.';
    }
    type = allowed[0]?.type ?? 'SALES_ORDER';
    ready = true;
  });
  function open(row: Row) {
    selectedType = type;
    selectedId = row.id;
    panelOpen = true;
  }
  function apply(view: WorkView) {
    if (!allowed.some((s) => s.type === view.type)) return;
    type = view.type as DossierRootType;
    search = view.search;
    status = view.status;
    currentPage = 1;
  }
  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(views));
      storageError = '';
    } catch {
      storageError = 'La vue n’a pas pu être enregistrée sur cet appareil.';
    }
  }
  function save() {
    const name = viewName.trim();
    if (!name) return;
    views = [...views.filter((v) => v.name !== name), { name, type, search, status }].slice(0, 10);
    viewName = '';
    persist();
  }
  $effect(() => {
    const filters = [type, search, status];
    void filters;
    untrack(() => {
      currentPage = 1;
    });
  });
  $effect(() => {
    if (!ready || !authorized || !source) {
      loading = false;
      return;
    }
    const path = source.path;
    const query = {
      page: currentPage,
      pageSize: 25,
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
    };
    refresh;
    const current = ++request;
    loading = true;
    error = '';
    const timer = setTimeout(() => {
      void api<Paginated<Row>>(path, { query })
        .then((result) => {
          if (current === request) {
            rows = result.items;
            total = result.total;
          }
        })
        .catch((e) => {
          if (current === request) {
            rows = [];
            total = 0;
            error = e instanceof ApiError ? e.message : 'Impossible de charger la liste.';
          }
        })
        .finally(() => {
          if (current === request) loading = false;
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      request++;
    };
  });
  $effect(() => {
    if (!ready) return;
    const rootType = route.url.searchParams.get('entityType');
    const rootId = route.url.searchParams.get('entityId');
    if (rootId && rootType && allowed.some((s) => s.type === rootType)) {
      selectedType = rootType as DossierRootType;
      selectedId = rootId;
      panelOpen = true;
    }
  });
</script>

<svelte:head><title>Dossiers connectés | Pulsar</title></svelte:head>
<div class="mb-5 flex flex-wrap items-start justify-between gap-3">
  <div>
    <h1 class="text-2xl font-semibold tracking-tight">Dossiers connectés</h1>
    <p class="mt-1 max-w-2xl text-sm text-ink-muted">
      Retrouvez le parcours d’une commande, ses liens métier et ses décisions sans perdre votre
      liste.
    </p>
  </div>
  <Button
    variant="secondary"
    onclick={() => {
      refresh++;
    }}
    {loading}>Actualiser</Button
  >
</div>
{#if !authorized}<EmptyState
    title="Accès à Analytics requis"
    message="Le module Analytics et sa permission de lecture permettent d’ouvrir les dossiers connectés."
  />{:else if !allowed.length}<EmptyState
    message="Aucun module métier accessible pour ce compte."
  />{:else}
  <section
    aria-label="Vues personnelles"
    class="mb-4 rounded-inner border border-edge bg-surface p-3"
  >
    <div class="flex flex-wrap items-center gap-2">
      <span class="mr-2 text-xs text-ink-muted">Vues sur cet appareil</span
      >{#each views as view (view.name)}<div class="flex rounded border border-edge">
          <button
            disabled={!allowed.some((s) => s.type === view.type)}
            class="px-2 py-1 text-xs hover:bg-surface-muted disabled:opacity-50"
            onclick={() => apply(view)}>{view.name}</button
          ><button
            aria-label={`Supprimer la vue ${view.name}`}
            class="border-l border-edge px-2 text-xs text-ink-muted hover:text-danger"
            onclick={() => {
              views = views.filter((v) => v.name !== view.name);
              persist();
            }}>×</button
          >
        </div>{/each}<label class="ml-auto"
        ><span class="sr-only">Nom de la vue</span><input
          maxlength="50"
          bind:value={viewName}
          placeholder="Nom de la vue"
          class="w-40 rounded border border-edge bg-surface px-2 py-1.5 text-xs"
        /></label
      ><Button variant="ghost" disabled={!viewName.trim() || views.length >= 10} onclick={save}
        >Enregistrer</Button
      >
    </div>
    {#if storageError}<p role="status" class="mt-2 text-xs text-warn">{storageError}</p>{/if}
  </section>
  <div class="mb-4 flex flex-wrap items-end gap-3">
    <label class="flex flex-col gap-1 text-xs text-ink-muted"
      >Point de départ<select
        bind:value={type}
        onchange={() => {
          status = '';
          search = '';
        }}
        class="rounded-inner border border-edge bg-surface px-3 py-2 text-sm text-ink"
        >{#each allowed as option}<option value={option.type}>{option.label}</option>{/each}</select
      ></label
    >
    <label class="flex flex-col gap-1 text-xs text-ink-muted"
      >Statut<select
        bind:value={status}
        class="rounded-inner border border-edge bg-surface px-3 py-2 text-sm text-ink"
        ><option value="">Tous les statuts</option>{#each source?.statuses ?? [] as value}<option
            {value}>{labelFor(value)}</option
          >{/each}</select
      ></label
    >
    <label class="flex min-w-48 flex-1 flex-col gap-1 text-xs text-ink-muted"
      >Rechercher une référence<input
        bind:value={search}
        maxlength="200"
        placeholder="Numéro du dossier"
        class="rounded-inner border border-edge bg-surface px-3 py-2 text-sm text-ink"
      /></label
    >
    <Button
      variant="ghost"
      onclick={() => {
        search = '';
        status = '';
      }}>Réinitialiser</Button
    >
  </div>
  <ErrorNotice
    message={error}
    onretry={() => {
      refresh++;
    }}
  />
  {#if loading}<Skeleton rows={6} />{:else if !error}
    <Table
      >{#snippet head()}<th>Référence</th><th>État source</th><th>Création</th><th
          ><span class="sr-only">Ouvrir</span></th
        >{/snippet}{#snippet body()}{#each rows as row (row.id)}<tr
            ><td
              ><button
                onclick={() => open(row)}
                class="font-mono text-sm font-semibold text-accent hover:underline"
                >{number(row)}</button
              ></td
            ><td><Badge tone={toneFor(row.status)}>{labelFor(row.status)}</Badge></td><td
              class="whitespace-nowrap text-xs text-ink-muted"
              >{new Date(row.createdAt).toLocaleDateString('fr-CA')}</td
            ><td class="text-right"
              ><Button variant="ghost" onclick={() => open(row)}>Voir le parcours</Button></td
            ></tr
          >{:else}<tr
            ><td colspan="4"
              ><EmptyState
                message="Aucun dossier ne correspond à cette vue. Modifiez les filtres ou créez une commande dans son module."
              /></td
            ></tr
          >{/each}{/snippet}</Table
    >
    <div class="mt-3 flex items-center justify-between text-xs text-ink-muted">
      <span>{total} dossiers · page {currentPage}/{pages}</span>
      <div class="flex gap-2">
        <Button
          variant="secondary"
          disabled={currentPage <= 1}
          onclick={() => {
            currentPage--;
          }}>Précédent</Button
        ><Button
          variant="secondary"
          disabled={currentPage >= pages}
          onclick={() => {
            currentPage++;
          }}>Suivant</Button
        >
      </div>
    </div>
  {/if}
{/if}
<DossierPanel bind:open={panelOpen} entityType={selectedType} entityId={selectedId} />
