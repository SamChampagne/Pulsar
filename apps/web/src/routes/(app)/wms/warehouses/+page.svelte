<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { PERMISSIONS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    PageHeader,
    Button,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    ErrorNotice,
  } from '$lib/components/ui';
  import LocationFormModal from '$lib/components/locations/LocationFormModal.svelte';
  import type { LocationRecord } from '$lib/components/locations/types';

  const canManage = $derived(
    ($auth?.user.permissions ?? []).includes(PERMISSIONS.CORE.LOCATIONS_MANAGE),
  );

  let warehouses = $state<LocationRecord[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let error = $state('');

  let showForm = $state(false);
  let editing = $state<LocationRecord | null>(null);

  async function load() {
    loading = true;
    error = '';
    try {
      const result = await api<Paginated<LocationRecord>>('/locations', {
        query: { type: 'WAREHOUSE', pageSize: 100 },
      });
      warehouses = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des entrepôts';
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

  $effect(() => {
    void load();
  });
</script>

<svelte:head><title>Entrepôts — Pulsar</title></svelte:head>

<PageHeader
  title="Entrepôts"
  subtitle="Sites de type entrepôt utilisables par le module Entrepôt (réception, rangement, préparation)."
  count={total}
>
  {#snippet actions()}
    {#if canManage}
      <Button onclick={openNew}>Nouvel entrepôt</Button>
    {/if}
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if warehouses.length === 0}
  <Card>
    <EmptyState title="Aucun entrepôt" message="Aucun entrepôt — créez le premier pour commencer.">
      {#snippet children()}
        {#if canManage}
          <Button onclick={openNew}>Nouvel entrepôt</Button>
        {/if}
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Code</th><th>Nom</th><th>Ville</th><th>Actif</th><th></th>
    {/snippet}
    {#snippet body()}
      {#each warehouses as loc (loc.id)}
        <tr
          class={canManage ? 'cursor-pointer hover:bg-surface-muted' : ''}
          onclick={() => openEdit(loc)}
        >
          <td class="font-mono font-semibold text-ink">{loc.code}</td>
          <td>{loc.name}</td>
          <td class="text-ink-muted">{loc.city || '—'}</td>
          <td>
            {#if loc.isActive}
              <Badge tone="ok">Actif</Badge>
            {:else}
              <Badge tone="neutral">Inactif</Badge>
            {/if}
          </td>
          <td class="text-right text-xs text-ink-faint">
            {#if canManage}
              <Button
                variant="ghost"
                onclick={(e: MouseEvent) => {
                  e.stopPropagation();
                  openEdit(loc);
                }}>Modifier</Button
              >
            {/if}
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<LocationFormModal
  bind:open={showForm}
  location={editing}
  lockedType="WAREHOUSE"
  oncreated={() => {
    void load();
  }}
  onupdated={() => {
    void load();
  }}
/>
