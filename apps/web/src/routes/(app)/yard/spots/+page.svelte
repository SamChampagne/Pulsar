<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { YardSpotType } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    Field,
    Input,
    Modal,
    PageHeader,
    Select,
    Skeleton,
  } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

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

  let spots = $state<Spot[]>([]);
  let locations = $state<LocationOption[]>([]);
  let loading = $state(true);
  let error = $state('');
  let filterLocationId = $state('');

  // Create / edit modal
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

  async function loadLocations() {
    const res = await api<Paginated<LocationOption>>('/transportation/locations', {
      query: { pageSize: 100 },
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

<PageHeader title="Spots">
  {#snippet actions()}
    <Button onclick={openCreate}>Nouveau spot</Button>
  {/snippet}
</PageHeader>

<div class="mb-4 flex items-center gap-3">
  <a href="/yard" class="text-sm text-accent hover:underline">← Yard</a>
  <div class="max-w-xs flex-1">
    <Select bind:value={filterLocationId}>
      <option value="">Tous les sites</option>
      {#each locations as l (l.id)}
        <option value={l.id}>{l.code} — {l.name}</option>
      {/each}
    </Select>
  </div>
</div>

{#if loading}
  <div class="grid gap-3">
    {#each Array(4) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else}
  <Card padded={false}>
    {#if spots.length === 0}
      <EmptyState message="Aucun spot." />
    {:else}
      <div class="divide-y divide-edge">
        {#each spots as s (s.id)}
          <div class="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span class="font-medium text-ink">{s.code}</span>
            <Badge tone={typeTone(s.type)}>{s.type}</Badge>
            <span class="text-ink-muted">{s.location.code} — {s.location.name}</span>
            <Badge tone={s.isActive ? 'ok' : 'neutral'}>{s.isActive ? 'Actif' : 'Inactif'}</Badge>
            <span class="ml-auto"><Button variant="ghost" onclick={() => openEdit(s)}>Modifier</Button></span>
          </div>
        {/each}
      </div>
    {/if}
  </Card>
{/if}

<Modal bind:open={formOpen} title={editId ? 'Modifier le spot' : 'Nouveau spot'}>
  <div class="space-y-3">
    <Field label="Site">
      <Select bind:value={formLocationId}>
        <option value="">— Sélectionner —</option>
        {#each locations as l (l.id)}
          <option value={l.id}>{l.code} — {l.name}</option>
        {/each}
      </Select>
    </Field>
    <Field label="Code">
      <Input bind:value={formCode} placeholder="DOOR-1" />
    </Field>
    <Field label="Type">
      <Select bind:value={formType}>
        {#each TYPES as t (t)}<option value={t}>{t}</option>{/each}
      </Select>
    </Field>
    <Field label="Actif">
      <label class="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" bind:checked={formActive} />
        Spot actif
      </label>
    </Field>
  </div>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => { formOpen = false; }}>Annuler</Button>
    <Button loading={saving} onclick={submit}>Enregistrer</Button>
  {/snippet}
</Modal>
