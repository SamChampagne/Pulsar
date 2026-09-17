<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { PERMISSIONS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    PageHeader,
    Button,
    FilterBar,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    ErrorNotice,
    type Tone,
  } from '$lib/components/ui';
  import LocationFormModal from '$lib/components/locations/LocationFormModal.svelte';
  import type { LocationRecord } from '$lib/components/locations/types';

  const TYPE_TONE: Record<string, Tone> = {
    PLANT: 'info',
    WAREHOUSE: 'ok',
    DISTRIBUTION_CENTER: 'ok',
    CUSTOMER_SITE: 'warn',
    CARRIER_TERMINAL: 'neutral',
    OTHER: 'neutral',
  };
  function typeTone(t: string): Tone {
    return TYPE_TONE[t] ?? 'neutral';
  }
  function typeLabel(t: string): string {
    return t
      .replaceAll('_', ' ')
      .toLowerCase()
      .replace(/^./, (c) => c.toUpperCase());
  }

  const canManage = $derived(
    ($auth?.user.permissions ?? []).includes(PERMISSIONS.CORE.LOCATIONS_MANAGE),
  );

  let locations = $state<LocationRecord[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 25;
  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  let search = $state('');
  let loading = $state(true);
  let error = $state('');

  let showForm = $state(false);
  let editing = $state<LocationRecord | null>(null);

  // Signals over the loaded page.
  const geocoded = $derived(
    locations.filter((l) => l.latitude != null && l.longitude != null).length,
  );
  const warehouses = $derived(locations.filter((l) => l.type === 'WAREHOUSE').length);
  const inactive = $derived(locations.filter((l) => !l.isActive).length);

  async function load() {
    loading = true;
    error = '';
    try {
      const result = await api<Paginated<LocationRecord>>('/locations', {
        query: { search, page, pageSize },
      });
      locations = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des lieux';
    } finally {
      loading = false;
    }
  }

  function openNew() {
    editing = null;
    showForm = true;
  }
  function openEdit(loc: LocationRecord) {
    if (!canManage) return;
    editing = loc;
    showForm = true;
  }

  function addressLine(l: LocationRecord): string {
    return [l.city, l.state, l.postalCode].filter(Boolean).join(', ');
  }

  // Reset to page 1 whenever search changes.
  $effect(() => {
    search;
    page = 1;
  });

  $effect(() => {
    void load();
  });
</script>

<svelte:head><title>Lieux — Pulsar</title></svelte:head>

<PageHeader
  title="Lieux"
  subtitle="Sites, entrepôts, usines et adresses partagés par le transport, l’entrepôt et la cour. Le géocodage alimente les distances et la carte."
  count={total}
>
  {#snippet actions()}
    {#if canManage}
      <Button onclick={openNew}>Nouveau lieu</Button>
    {/if}
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

<div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
  <Card>
    <div class="text-xs text-ink-faint">Lieux (total)</div>
    <div class="mt-1 text-2xl font-bold text-ink">{total}</div>
  </Card>
  <Card>
    <div class="text-xs text-ink-faint">Géocodés</div>
    <div class="mt-1 text-2xl font-bold text-ok">{geocoded}</div>
    <div class="mt-1 text-[11px] text-ink-faint">lat/long présents (sur cette page)</div>
  </Card>
  <Card>
    <div class="text-xs text-ink-faint">Entrepôts</div>
    <div class="mt-1 text-2xl font-bold text-ink">{warehouses}</div>
    <div class="mt-1 text-[11px] text-ink-faint">utilisables par le WMS</div>
  </Card>
  <Card>
    <div class="text-xs text-ink-faint">Inactifs</div>
    <div class={`mt-1 text-2xl font-bold ${inactive > 0 ? 'text-warn' : 'text-ink'}`}>
      {inactive}
    </div>
    <div class="mt-1 text-[11px] text-ink-faint">sur cette page</div>
  </Card>
</div>

<FilterBar>
  <div class="w-72">
    <input
      placeholder="Rechercher nom, code, ville…"
      bind:value={search}
      onkeydown={(e) => {
        if (e.key === 'Enter') load();
      }}
      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
    />
  </div>
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={8} /></Card>
{:else if locations.length === 0}
  <Card>
    <EmptyState
      title="Aucun lieu"
      message="Créez vos sites avant de planifier des ordres : origines, destinations et entrepôts s’y rattachent."
    >
      {#snippet children()}
        {#if canManage}
          <Button onclick={openNew}>Nouveau lieu</Button>
        {/if}
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Code</th><th>Nom</th><th>Type</th><th>Ville</th><th>Géo</th><th>Statut</th><th></th>
    {/snippet}
    {#snippet body()}
      {#each locations as loc (loc.id)}
        <tr
          class={canManage ? 'cursor-pointer hover:bg-surface-muted' : ''}
          onclick={() => openEdit(loc)}
        >
          <td class="font-mono font-semibold text-ink">{loc.code}</td>
          <td>{loc.name}</td>
          <td><Badge tone={typeTone(loc.type)}>{typeLabel(loc.type)}</Badge></td>
          <td class="text-ink-muted">{addressLine(loc) || '—'}</td>
          <td>
            {#if loc.latitude != null && loc.longitude != null}
              <span class="text-xs text-ok">✓</span>
            {:else}
              <span class="text-xs text-ink-faint">—</span>
            {/if}
          </td>
          <td>
            {#if loc.isActive}
              <Badge tone="ok">Actif</Badge>
            {:else}
              <Badge tone="neutral">Inactif</Badge>
            {/if}
          </td>
          <td class="text-right text-xs text-ink-faint">{canManage ? 'Éditer →' : ''}</td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

{#if total > pageSize}
  <div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
    <span class="font-mono text-xs"
      >{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} sur {total}</span
    >
    <div class="flex items-center gap-2">
      <Button
        variant="secondary"
        disabled={page <= 1}
        onclick={() => {
          page = Math.max(1, page - 1);
          void load();
        }}>Précédent</Button
      >
      <span class="font-mono text-xs">Page {page} / {totalPages}</span>
      <Button
        variant="secondary"
        disabled={page >= totalPages}
        onclick={() => {
          page = Math.min(totalPages, page + 1);
          void load();
        }}>Suivant</Button
      >
    </div>
  </div>
{/if}

<LocationFormModal
  bind:open={showForm}
  location={editing}
  oncreated={() => {
    void load();
  }}
  onupdated={() => {
    void load();
  }}
/>
