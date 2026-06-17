<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Button,
    FilterBar,
    Field,
    Input,
    Select,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    Panel,
    ErrorNotice,
    type Tone,
  } from '$lib/components/ui';

  interface Location {
    id: string;
    code: string;
    name: string;
    type: string;
    customerId: string | null;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string | null;
    postalCode: string | null;
    country: string | null;
    latitude: number | null;
    longitude: number | null;
    timezone: string | null;
    isActive: boolean;
  }

  const LOCATION_TYPES = [
    'PLANT',
    'WAREHOUSE',
    'DISTRIBUTION_CENTER',
    'CUSTOMER_SITE',
    'CARRIER_TERMINAL',
    'OTHER',
  ];
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

  let locations = $state<Location[]>([]);
  let total = $state(0);
  let search = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let error = $state('');

  let showForm = $state(false);
  let editing = $state<Location | null>(null);
  let form = $state(blankForm());

  function blankForm() {
    return {
      code: '',
      name: '',
      type: 'WAREHOUSE',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
      latitude: '',
      longitude: '',
      timezone: '',
      isActive: true,
    };
  }

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
      const result = await api<Paginated<Location>>('/transportation/locations', {
        query: { search, pageSize: 100 },
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
    form = blankForm();
    error = '';
    showForm = true;
  }
  function openEdit(loc: Location) {
    editing = loc;
    form = {
      code: loc.code,
      name: loc.name,
      type: loc.type,
      addressLine1: loc.addressLine1,
      addressLine2: loc.addressLine2 ?? '',
      city: loc.city,
      state: loc.state ?? '',
      postalCode: loc.postalCode ?? '',
      country: loc.country ?? '',
      latitude: loc.latitude != null ? String(loc.latitude) : '',
      longitude: loc.longitude != null ? String(loc.longitude) : '',
      timezone: loc.timezone ?? '',
      isActive: loc.isActive,
    };
    error = '';
    showForm = true;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    saving = true;
    const body = {
      code: form.code,
      name: form.name,
      type: form.type,
      addressLine1: form.addressLine1,
      addressLine2: form.addressLine2 || undefined,
      city: form.city,
      state: form.state || undefined,
      postalCode: form.postalCode || undefined,
      country: form.country || undefined,
      latitude: form.latitude !== '' ? Number(form.latitude) : undefined,
      longitude: form.longitude !== '' ? Number(form.longitude) : undefined,
      timezone: form.timezone || undefined,
      ...(editing ? { isActive: form.isActive } : {}),
    };
    try {
      if (editing) {
        await api(`/transportation/locations/${editing.id}`, { method: 'PATCH', body });
        toast.success('Lieu mis à jour');
      } else {
        await api('/transportation/locations', { method: 'POST', body });
        toast.success('Lieu créé');
      }
      showForm = false;
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Échec de l’enregistrement';
      error = msg;
      toast.error(msg);
    } finally {
      saving = false;
    }
  }

  function addressLine(l: Location): string {
    return [l.city, l.state, l.postalCode].filter(Boolean).join(', ');
  }

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
    <Button onclick={openNew}>Nouveau lieu</Button>
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
        <Button onclick={openNew}>Nouveau lieu</Button>
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
        <tr class="cursor-pointer hover:bg-surface-muted" onclick={() => openEdit(loc)}>
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
          <td class="text-right text-xs text-ink-faint">Éditer →</td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Panel bind:open={showForm} title={editing ? `Éditer ${editing.code}` : 'Nouveau lieu'}>
  {#snippet children()}
    <form onsubmit={save} class="space-y-3">
      {#if error}<p class="text-sm text-danger">{error}</p>{/if}
      <div class="grid grid-cols-2 gap-3">
        <Field label="Code"><Input bind:value={form.code} required placeholder="WH-MTL" /></Field>
        <Field label="Type">
          <Select bind:value={form.type}>
            {#each LOCATION_TYPES as t (t)}<option value={t}>{typeLabel(t)}</option>{/each}
          </Select>
        </Field>
      </div>
      <Field label="Nom"><Input bind:value={form.name} required /></Field>
      <Field label="Adresse"
        ><Input bind:value={form.addressLine1} required placeholder="1234 rue Principale" /></Field
      >
      <Field label="Complément d’adresse"
        ><Input bind:value={form.addressLine2} placeholder="Suite, dock…" /></Field
      >
      <div class="grid grid-cols-2 gap-3">
        <Field label="Ville"><Input bind:value={form.city} required /></Field>
        <Field label="Province / État"><Input bind:value={form.state} placeholder="QC" /></Field>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <Field label="Code postal"
          ><Input bind:value={form.postalCode} placeholder="H1A 1A1" /></Field
        >
        <Field label="Pays"><Input bind:value={form.country} placeholder="CA" /></Field>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <Field label="Latitude"><Input bind:value={form.latitude} type="number" /></Field>
        <Field label="Longitude"><Input bind:value={form.longitude} type="number" /></Field>
        <Field label="Fuseau"
          ><Input bind:value={form.timezone} placeholder="America/Toronto" /></Field
        >
      </div>
      <p class="text-xs text-ink-faint">
        Latitude/longitude sont optionnelles : laissées vides, le serveur tente un géocodage
        automatique de l’adresse.
      </p>
      {#if editing}
        <label class="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" bind:checked={form.isActive} class="rounded border-edge" /> Lieu actif
        </label>
      {/if}
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button
          variant="secondary"
          onclick={() => {
            showForm = false;
          }}>Annuler</Button
        >
        <Button variant="primary" type="submit" loading={saving}
          >{editing ? 'Enregistrer' : 'Créer'}</Button
        >
      </div>
    </form>
  {/snippet}
</Panel>
