<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { COUNTRIES, regionsFor } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Button,
    Card,
    Table,
    EmptyState,
    Skeleton,
    Modal,
    Field,
    Input,
    Select,
    ReferenceSelect,
  } from '$lib/components/ui';

  const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.code, label: c.name }));

  type EndpointType = 'LOCATION' | 'CITY' | 'STATE' | 'COUNTRY';

  const ENDPOINT_LABELS: Record<EndpointType, string> = {
    LOCATION: 'Site',
    CITY: 'Ville',
    STATE: 'Province / État',
    COUNTRY: 'Pays',
  };

  interface LocationOption {
    id: string;
    code: string;
    name: string;
    city: string;
  }

  interface CarrierOption {
    id: string;
    code: string;
    name: string;
    email: string | null;
  }

  interface CarrierPreference {
    id: string;
    rank: number;
    carrier: { id: string; code: string; name: string; email: string | null };
  }

  interface Lane {
    id: string;
    name: string | null;
    originType: EndpointType;
    originCity: string | null;
    originState: string | null;
    originCountry: string | null;
    originLocation: { id: string; code: string; name: string; city: string } | null;
    destinationType: EndpointType;
    destinationCity: string | null;
    destinationState: string | null;
    destinationCountry: string | null;
    destinationLocation: { id: string; code: string; name: string; city: string } | null;
    carrierPreferences: CarrierPreference[];
  }

  // ─── Data ────────────────────────────────────────────────────────────────────
  let lanes = $state<Lane[]>([]);
  let total = $state(0);
  let locations = $state<LocationOption[]>([]);
  let carriers = $state<CarrierOption[]>([]);
  let error = $state('');
  let loading = $state(true);

  // ─── Create panel ──────────────────────────────────────────────────────────────
  let showForm = $state(false);

  let formName = $state('');

  let originType = $state<EndpointType>('LOCATION');
  let originLocationId = $state('');
  let originCity = $state('');
  let originState = $state('');
  let originCountry = $state('');

  let destinationType = $state<EndpointType>('LOCATION');
  let destinationLocationId = $state('');
  let destinationCity = $state('');
  let destinationState = $state('');
  let destinationCountry = $state('');

  // ─── Per-lane carrier editor ──────────────────────────────────────────────────
  let editingLaneId = $state<string | null>(null);
  let editingCarrierIds = $state<string[]>([]);
  let carrierToAdd = $state('');
  let showCarrierPanel = $state(false);
  let carrierPanelLane = $state<Lane | null>(null);

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  function endpointLabel(lane: Lane, side: 'origin' | 'destination'): string {
    const type = side === 'origin' ? lane.originType : lane.destinationType;
    const loc = side === 'origin' ? lane.originLocation : lane.destinationLocation;
    const city = side === 'origin' ? lane.originCity : lane.destinationCity;
    const state = side === 'origin' ? lane.originState : lane.destinationState;
    const country = side === 'origin' ? lane.originCountry : lane.destinationCountry;

    switch (type) {
      case 'LOCATION':
        return loc ? `${loc.name} (${loc.city})` : '—';
      case 'CITY':
        return `${city ?? ''}, ${state ?? ''} (${country ?? ''})`;
      case 'STATE':
        return `${state ?? ''} (${country ?? ''})`;
      case 'COUNTRY':
        return country ?? '—';
    }
  }

  function buildEndpointBody(
    type: EndpointType,
    locationId: string,
    city: string,
    state: string,
    country: string,
  ): Record<string, string | undefined> {
    switch (type) {
      case 'LOCATION':
        return { locationId };
      case 'CITY':
        return { city, state, country };
      case 'STATE':
        return { state, country };
      case 'COUNTRY':
        return { country };
    }
  }

  function carrierName(id: string): string {
    return carriers.find((c) => c.id === id)?.name ?? id;
  }

  /** Distinct cities across the tenant's locations, for the free-text city field. */
  const cityOptions = $derived(
    [...new Set(locations.map((l) => l.city).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
  );

  const originRegions = $derived(
    regionsFor(originCountry).map((r) => ({ value: r.code, label: r.name })),
  );
  const destinationRegions = $derived(
    regionsFor(destinationCountry).map((r) => ({ value: r.code, label: r.name })),
  );

  function resetOriginState() {
    originState = '';
  }
  function resetDestinationState() {
    destinationState = '';
  }

  // ─── Load ────────────────────────────────────────────────────────────────────
  async function load() {
    try {
      const [lanesRes, locsRes, carriersRes] = await Promise.all([
        api<Paginated<Lane>>('/transportation/lanes', { query: { pageSize: 100 } }),
        api<Paginated<LocationOption>>('/locations', { query: { pageSize: 100 } }),
        api<Paginated<CarrierOption>>('/transportation/carriers', { query: { pageSize: 100 } }),
      ]);
      lanes = lanesRes.items;
      total = lanesRes.total;
      locations = locsRes.items;
      carriers = carriersRes.items;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des corridors';
    } finally {
      loading = false;
    }
  }

  // ─── Create lane ─────────────────────────────────────────────────────────────
  async function create(event: SubmitEvent) {
    event.preventDefault();
    try {
      const body: Record<string, unknown> = {
        originType,
        origin: buildEndpointBody(
          originType,
          originLocationId,
          originCity,
          originState,
          originCountry,
        ),
        destinationType,
        destination: buildEndpointBody(
          destinationType,
          destinationLocationId,
          destinationCity,
          destinationState,
          destinationCountry,
        ),
      };
      if (formName.trim()) body.name = formName.trim();

      await api('/transportation/lanes', { method: 'POST', body });
      toast.success('Corridor créé');
      resetForm();
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Échec de la création du corridor';
      toast.error(msg);
    }
  }

  function resetForm() {
    formName = '';
    originType = 'LOCATION';
    originLocationId = '';
    originCity = '';
    originState = '';
    originCountry = '';
    destinationType = 'LOCATION';
    destinationLocationId = '';
    destinationCity = '';
    destinationState = '';
    destinationCountry = '';
    showForm = false;
  }

  // ─── Delete lane ─────────────────────────────────────────────────────────────
  async function deleteLane(id: string) {
    try {
      await api(`/transportation/lanes/${id}`, { method: 'DELETE' });
      toast.success('Corridor supprimé');
      if (editingLaneId === id) {
        editingLaneId = null;
        editingCarrierIds = [];
        showCarrierPanel = false;
      }
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Échec de la suppression du corridor';
      toast.error(msg);
    }
  }

  // ─── Carrier preferences editor ───────────────────────────────────────────────
  function startEditCarriers(lane: Lane) {
    carrierPanelLane = lane;
    editingLaneId = lane.id;
    editingCarrierIds = lane.carrierPreferences.map((p) => p.carrier.id);
    carrierToAdd = '';
    showCarrierPanel = true;
  }

  function cancelEditCarriers() {
    editingLaneId = null;
    editingCarrierIds = [];
    carrierToAdd = '';
    showCarrierPanel = false;
    carrierPanelLane = null;
  }

  function addCarrier() {
    if (carrierToAdd && !editingCarrierIds.includes(carrierToAdd)) {
      editingCarrierIds = [...editingCarrierIds, carrierToAdd];
    }
    carrierToAdd = '';
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= editingCarrierIds.length) return;
    const next = [...editingCarrierIds];
    [next[index], next[target]] = [next[target], next[index]];
    editingCarrierIds = next;
  }

  async function saveCarriers() {
    if (!editingLaneId) return;
    try {
      await api(`/transportation/lanes/${editingLaneId}/carriers`, {
        method: 'PUT',
        body: { carrierIds: editingCarrierIds },
      });
      toast.success('Préférences transporteurs enregistrées');
      cancelEditCarriers();
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Échec de l'enregistrement des préférences";
      toast.error(msg);
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Liaisons · corridors" count={total}>
  {#snippet actions()}
    <Button
      onclick={() => {
        resetForm();
        showForm = true;
      }}>Nouveau corridor</Button
    >
  {/snippet}
</PageHeader>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if lanes.length === 0}
  <Card>
    <EmptyState message="Aucun corridor défini pour le moment.">
      {#snippet children()}
        <Button
          onclick={() => {
            resetForm();
            showForm = true;
          }}>Nouveau corridor</Button
        >
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Corridor</th><th>Origine</th><th>Destination</th><th>Préférences transporteurs</th><th
      ></th>
    {/snippet}
    {#snippet body()}
      {#each lanes as lane (lane.id)}
        <tr class="cursor-pointer" onclick={() => startEditCarriers(lane)}>
          <td><span class="font-semibold text-ink">{lane.name ?? '—'}</span></td>
          <td>
            <span class="mr-1 rounded border border-edge px-1.5 font-mono text-[11px] text-neutral"
              >{ENDPOINT_LABELS[lane.originType]}</span
            >
            {endpointLabel(lane, 'origin')}
          </td>
          <td>
            <span class="mr-1 rounded border border-edge px-1.5 font-mono text-[11px] text-neutral"
              >{ENDPOINT_LABELS[lane.destinationType]}</span
            >
            {endpointLabel(lane, 'destination')}
          </td>
          <td>
            {#if lane.carrierPreferences.length > 0}
              <span class="text-sm text-ink"
                >{lane.carrierPreferences.map((p) => p.carrier.name).join(', ')}</span
              >
              <span class="ml-1 font-mono text-xs text-ink-muted"
                >({lane.carrierPreferences.length})</span
              >
            {:else}
              <span class="text-sm text-ink-faint">Aucune</span>
            {/if}
          </td>
          <td class="text-right">
            <div class="inline-flex gap-2">
              <Button
                variant="secondary"
                onclick={(e: MouseEvent) => {
                  e.stopPropagation();
                  startEditCarriers(lane);
                }}>Transporteurs</Button
              >
              <Button
                variant="danger"
                onclick={(e: MouseEvent) => {
                  e.stopPropagation();
                  deleteLane(lane.id);
                }}>Supprimer</Button
              >
            </div>
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<!-- ─── Create lane Modal ───────────────────────────────────────────────────────── -->
<Modal bind:open={showForm} title="Nouveau corridor" size="md">
  {#snippet children()}
    <form onsubmit={create} class="space-y-4">
      <Field label="Nom (optionnel)">
        <Input bind:value={formName} placeholder="ex. Montréal → Toronto" />
      </Field>

      <fieldset class="space-y-2 rounded-inner border border-edge p-3">
        <legend class="px-1 text-[11px] font-semibold tracking-wide text-ink-muted uppercase"
          >Origine</legend
        >
        <Field label="Niveau">
          <Select bind:value={originType}>
            {#each Object.keys(ENDPOINT_LABELS) as t (t)}
              <option value={t}>{ENDPOINT_LABELS[t as EndpointType]}</option>
            {/each}
          </Select>
        </Field>

        {#if originType === 'LOCATION'}
          <Field label="Site">
            <Select bind:value={originLocationId} required>
              <option value="" disabled>Sélectionner…</option>
              {#each locations as l (l.id)}
                <option value={l.id}>{l.name} ({l.city})</option>
              {/each}
            </Select>
          </Field>
        {:else if originType === 'CITY'}
          <Field label="Ville">
            <input
              bind:value={originCity}
              required
              list="lane-city-list"
              placeholder="Montréal"
              class="min-h-9 w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </Field>
          <Field label="Province / État">
            {#if originRegions.length}
              <ReferenceSelect options={originRegions} bind:value={originState} required />
            {:else}
              <Input bind:value={originState} required placeholder="QC" />
            {/if}
          </Field>
          <Field label="Pays">
            <ReferenceSelect
              options={COUNTRY_OPTIONS}
              bind:value={originCountry}
              onchange={resetOriginState}
              required
            />
          </Field>
        {:else if originType === 'STATE'}
          <Field label="Province / État">
            {#if originRegions.length}
              <ReferenceSelect options={originRegions} bind:value={originState} required />
            {:else}
              <Input bind:value={originState} required placeholder="QC" />
            {/if}
          </Field>
          <Field label="Pays">
            <ReferenceSelect
              options={COUNTRY_OPTIONS}
              bind:value={originCountry}
              onchange={resetOriginState}
              required
            />
          </Field>
        {:else if originType === 'COUNTRY'}
          <Field label="Pays">
            <ReferenceSelect options={COUNTRY_OPTIONS} bind:value={originCountry} />
          </Field>
        {/if}
      </fieldset>

      <fieldset class="space-y-2 rounded-inner border border-edge p-3">
        <legend class="px-1 text-[11px] font-semibold tracking-wide text-ink-muted uppercase"
          >Destination</legend
        >
        <Field label="Niveau">
          <Select bind:value={destinationType}>
            {#each Object.keys(ENDPOINT_LABELS) as t (t)}
              <option value={t}>{ENDPOINT_LABELS[t as EndpointType]}</option>
            {/each}
          </Select>
        </Field>

        {#if destinationType === 'LOCATION'}
          <Field label="Site">
            <Select bind:value={destinationLocationId} required>
              <option value="" disabled>Sélectionner…</option>
              {#each locations as l (l.id)}
                <option value={l.id}>{l.name} ({l.city})</option>
              {/each}
            </Select>
          </Field>
        {:else if destinationType === 'CITY'}
          <Field label="Ville">
            <input
              bind:value={destinationCity}
              required
              list="lane-city-list"
              placeholder="Toronto"
              class="min-h-9 w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </Field>
          <Field label="Province / État">
            {#if destinationRegions.length}
              <ReferenceSelect
                options={destinationRegions}
                bind:value={destinationState}
                required
              />
            {:else}
              <Input bind:value={destinationState} required placeholder="ON" />
            {/if}
          </Field>
          <Field label="Pays">
            <ReferenceSelect
              options={COUNTRY_OPTIONS}
              bind:value={destinationCountry}
              onchange={resetDestinationState}
              required
            />
          </Field>
        {:else if destinationType === 'STATE'}
          <Field label="Province / État">
            {#if destinationRegions.length}
              <ReferenceSelect
                options={destinationRegions}
                bind:value={destinationState}
                required
              />
            {:else}
              <Input bind:value={destinationState} required placeholder="ON" />
            {/if}
          </Field>
          <Field label="Pays">
            <ReferenceSelect
              options={COUNTRY_OPTIONS}
              bind:value={destinationCountry}
              onchange={resetDestinationState}
              required
            />
          </Field>
        {:else if destinationType === 'COUNTRY'}
          <Field label="Pays">
            <ReferenceSelect options={COUNTRY_OPTIONS} bind:value={destinationCountry} />
          </Field>
        {/if}
      </fieldset>

      <datalist id="lane-city-list">
        {#each cityOptions as city (city)}<option value={city}></option>{/each}
      </datalist>

      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={resetForm}>Annuler</Button>
        <Button variant="primary" type="submit">Créer le corridor</Button>
      </div>
    </form>
  {/snippet}
</Modal>

<!-- ─── Carrier preferences Modal ─────────────────────────────────────────────── -->
<Modal
  bind:open={showCarrierPanel}
  title="Préférences — {carrierPanelLane?.name ?? '—'}"
  onclose={cancelEditCarriers}
  size="md"
>
  {#snippet children()}
    <div class="space-y-3">
      <Field label="Ajouter un transporteur">
        <div class="flex gap-2">
          <div class="flex-1">
            <Select bind:value={carrierToAdd}>
              <option value="" disabled>Sélectionner un transporteur…</option>
              {#each carriers.filter((c) => !editingCarrierIds.includes(c.id)) as c (c.id)}
                <option value={c.id}>{c.name}</option>
              {/each}
            </Select>
          </div>
          <Button variant="secondary" onclick={addCarrier}>Ajouter</Button>
        </div>
      </Field>

      {#if editingCarrierIds.length > 0}
        <ol class="space-y-1">
          {#each editingCarrierIds as id, index (id)}
            <li
              class="flex items-center justify-between rounded-inner border border-edge px-3 py-2 text-sm"
            >
              <span class="text-ink"
                ><span class="font-mono text-ink-muted">{index + 1}.</span> {carrierName(id)}</span
              >
              <div class="flex gap-1">
                <Button variant="secondary" onclick={() => move(index, -1)}>↑</Button>
                <Button variant="secondary" onclick={() => move(index, 1)}>↓</Button>
                <Button
                  variant="danger"
                  onclick={() => {
                    editingCarrierIds = editingCarrierIds.filter((c) => c !== id);
                  }}>✕</Button
                >
              </div>
            </li>
          {/each}
        </ol>
      {:else}
        <p class="text-sm text-ink-faint">
          Aucun transporteur dans la liste — enregistrer pour vider les préférences.
        </p>
      {/if}

      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={cancelEditCarriers}>Annuler</Button>
        <Button variant="primary" onclick={saveCarriers}>Enregistrer</Button>
      </div>
    </div>
  {/snippet}
</Modal>
