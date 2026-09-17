<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { PERMISSIONS, YardSpotType } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    EntityPicker,
    Field,
    FilterBar,
    Input,
    Modal,
    PageHeader,
    Select,
    Skeleton,
    Table,
  } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';
  import LocationFormModal from '$lib/components/locations/LocationFormModal.svelte';
  import type { LocationRecord } from '$lib/components/locations/types';

  interface Spot {
    id: string;
    code: string;
    type: string;
    locationId: string;
    isActive: boolean;
    location: { code: string; name: string };
  }

  interface LocationOption {
    id: string;
    code: string;
    name: string;
    type: string;
  }

  const TYPES = [YardSpotType.DOCK_DOOR, YardSpotType.PARKING, YardSpotType.STAGING];
  const TYPE_LABELS: Record<string, string> = {
    DOCK_DOOR: 'Quai',
    PARKING: 'Stationnement',
    STAGING: 'Pré-quai',
  };

  let spots = $state<Spot[]>([]);
  let locations = $state<LocationOption[]>([]);
  let loading = $state(true);
  let error = $state('');
  let filterLocationId = $state('');
  let showCreateSite = $state(false);
  const canManageLocations = $derived(
    !!$auth?.user.permissions.includes(PERMISSIONS.CORE.LOCATIONS_MANAGE),
  );

  async function onSiteCreated(loc: LocationRecord) {
    showCreateSite = false;
    await loadLocations();
    filterLocationId = loc.id;
  }

  // Create / edit panel
  let formOpen = $state(false);
  let editId = $state<string | null>(null);
  let formLocationId = $state('');
  let formCode = $state('');
  let formType = $state<string>(YardSpotType.PARKING);
  let formActive = $state(true);
  let saving = $state(false);

  function typeTone(type: string): Tone {
    switch (type) {
      case 'DOCK_DOOR':
        return 'info';
      case 'PARKING':
        return 'neutral';
      case 'STAGING':
        return 'warn';
      default:
        return 'neutral';
    }
  }

  function typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  async function loadLocations() {
    const res = await api<Paginated<LocationOption>>('/locations', {
      query: { type: 'WAREHOUSE', pageSize: 100 },
    });
    locations = res.items;
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const [spotsRes] = await Promise.all([
        api<Spot[]>('/yard/spots', { query: { locationId: filterLocationId || undefined } }),
        locations.length === 0 ? loadLocations() : Promise.resolve(),
      ]);
      spots = spotsRes;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des spots';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  function openCreate() {
    editId = null;
    formLocationId = filterLocationId || locations[0]?.id || '';
    formCode = '';
    formType = YardSpotType.PARKING;
    formActive = true;
    formOpen = true;
  }

  function openEdit(s: Spot) {
    editId = s.id;
    formLocationId = s.locationId;
    formCode = s.code;
    formType = s.type;
    formActive = s.isActive;
    formOpen = true;
  }

  async function submit() {
    if (!formLocationId || !formCode.trim()) {
      toast.error('Site et code sont requis');
      return;
    }
    saving = true;
    try {
      const body = {
        locationId: formLocationId,
        code: formCode.trim(),
        type: formType,
        isActive: formActive,
      };
      if (editId) {
        await api(`/yard/spots/${editId}`, { method: 'PATCH', body });
        toast.success('Spot mis à jour');
      } else {
        await api('/yard/spots', { method: 'POST', body });
        toast.success('Spot créé');
      }
      formOpen = false;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'enregistrement");
    } finally {
      saving = false;
    }
  }
</script>

<PageHeader title="Emplacements de cour" count={spots.length}>
  {#snippet actions()}
    <Button onclick={openCreate}>Nouveau spot</Button>
  {/snippet}
</PageHeader>

<FilterBar>
  <a href="/yard" class="text-sm text-accent hover:underline">← Cour</a>
  <div class="w-64">
    <EntityPicker
      endpoint="/locations"
      label="Site"
      placeholder="Tous les sites"
      filters={{ type: 'WAREHOUSE' }}
      labelKey="name"
      detailKey="code"
      bind:value={filterLocationId}
    />
  </div>
  {#if canManageLocations}
    <Button
      variant="secondary"
      onclick={() => {
        showCreateSite = true;
      }}>+ Site</Button
    >
  {/if}
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else if spots.length === 0}
  <Card>
    <EmptyState message="Aucun spot pour le moment.">
      {#snippet children()}
        <Button onclick={openCreate}>Nouveau spot</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Code</th><th>Type</th><th>Site</th><th>Statut</th>
    {/snippet}
    {#snippet body()}
      {#each spots as s (s.id)}
        <tr class="cursor-pointer" onclick={() => openEdit(s)}>
          <td class="font-mono font-semibold text-ink">{s.code}</td>
          <td><Badge tone={typeTone(s.type)}>{typeLabel(s.type)}</Badge></td>
          <td class="text-ink-muted"
            ><span class="font-mono">{s.location.code}</span> — {s.location.name}</td
          >
          <td
            ><Badge tone={s.isActive ? 'ok' : 'neutral'}>{s.isActive ? 'Actif' : 'Inactif'}</Badge
            ></td
          >
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Modal bind:open={formOpen} title={editId ? 'Modifier le spot' : 'Nouveau spot'} size="md">
  {#snippet children()}
    <div class="space-y-3">
      <Field label="Site">
        <EntityPicker
          endpoint="/locations"
          label="Site"
          filters={{ type: 'WAREHOUSE' }}
          labelKey="name"
          detailKey="code"
          bind:value={formLocationId}
        />
      </Field>
      <Field label="Code">
        <Input bind:value={formCode} placeholder="DOOR-1" />
      </Field>
      <Field label="Type">
        <Select bind:value={formType}>
          {#each TYPES as t (t)}<option value={t}>{TYPE_LABELS[t] ?? t}</option>{/each}
        </Select>
      </Field>
      <Field label="Actif">
        <label class="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" bind:checked={formActive} />
          Spot actif
        </label>
      </Field>
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button
          variant="secondary"
          onclick={() => {
            formOpen = false;
          }}>Annuler</Button
        >
        <Button variant="primary" loading={saving} onclick={submit}>Enregistrer</Button>
      </div>
    </div>
  {/snippet}
</Modal>

<LocationFormModal
  bind:open={showCreateSite}
  location={null}
  lockedType={null}
  defaultType="OTHER"
  oncreated={onSiteCreated}
/>
