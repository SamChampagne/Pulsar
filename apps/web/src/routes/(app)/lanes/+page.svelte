<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';

  type EndpointType = 'LOCATION' | 'CITY' | 'STATE' | 'COUNTRY';

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

  // ─── Create form ─────────────────────────────────────────────────────────────
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

  // ─── Load ────────────────────────────────────────────────────────────────────
  async function load() {
    try {
      const [lanesRes, locsRes, carriersRes] = await Promise.all([
        api<Paginated<Lane>>('/transportation/lanes', { query: { pageSize: 100 } }),
        api<Paginated<LocationOption>>('/transportation/locations', { query: { pageSize: 100 } }),
        api<Paginated<CarrierOption>>('/transportation/carriers', { query: { pageSize: 100 } }),
      ]);
      lanes = lanesRes.items;
      total = lanesRes.total;
      locations = locsRes.items;
      carriers = carriersRes.items;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load lanes';
    }
  }

  // ─── Create lane ─────────────────────────────────────────────────────────────
  async function create(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    try {
      const body: Record<string, unknown> = {
        originType,
        origin: buildEndpointBody(originType, originLocationId, originCity, originState, originCountry),
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
      toast.success('Lane created');
      resetForm();
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to create lane';
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
  }

  // ─── Delete lane ─────────────────────────────────────────────────────────────
  async function deleteLane(id: string) {
    try {
      await api(`/transportation/lanes/${id}`, { method: 'DELETE' });
      toast.success('Lane deleted');
      if (editingLaneId === id) {
        editingLaneId = null;
        editingCarrierIds = [];
      }
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to delete lane';
      toast.error(msg);
    }
  }

  // ─── Carrier preferences editor ───────────────────────────────────────────────
  function startEditCarriers(lane: Lane) {
    editingLaneId = lane.id;
    editingCarrierIds = lane.carrierPreferences.map((p) => p.carrier.id);
    carrierToAdd = '';
  }

  function cancelEditCarriers() {
    editingLaneId = null;
    editingCarrierIds = [];
    carrierToAdd = '';
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
      toast.success('Carrier preferences saved');
      cancelEditCarriers();
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to save carrier preferences';
      toast.error(msg);
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="page-header">
  <h1>Lanes <span class="muted">({total})</span></h1>
</div>

<p class="muted">
  Auto-tendering uses the most specific matching lane that has a preference list (site beats city
  beats state beats country). Carriers in the preference list are offered the load in rank order;
  rank 1 is tried first.
</p>

{#if error}
  <p class="error-text">{error}</p>
{/if}

<!-- ─── Create form ──────────────────────────────────────────────────────────── -->
<form class="card" style="margin-bottom: 20px;" onsubmit={create}>
  <h2 style="margin-top: 0;">New lane</h2>

  <div class="field" style="max-width: 320px;">
    <label for="lane-name">Name <span class="muted">(optional)</span></label>
    <input id="lane-name" bind:value={formName} placeholder="e.g. Montreal → Toronto" />
  </div>

  <div class="endpoint-grid">
    <!-- Origin -->
    <fieldset class="endpoint-box">
      <legend>Origin</legend>
      <div class="field">
        <label for="origin-type">Level</label>
        <select id="origin-type" bind:value={originType}>
          <option value="LOCATION">LOCATION</option>
          <option value="CITY">CITY</option>
          <option value="STATE">STATE</option>
          <option value="COUNTRY">COUNTRY</option>
        </select>
      </div>

      {#if originType === 'LOCATION'}
        <div class="field">
          <label for="origin-location">Location</label>
          <select id="origin-location" bind:value={originLocationId} required>
            <option value="" disabled>Select…</option>
            {#each locations as l (l.id)}
              <option value={l.id}>{l.name} ({l.city})</option>
            {/each}
          </select>
        </div>
      {:else if originType === 'CITY'}
        <div class="field">
          <label for="origin-city">City</label>
          <input id="origin-city" bind:value={originCity} required placeholder="Montreal" />
        </div>
        <div class="field">
          <label for="origin-state-city">State / Province</label>
          <input id="origin-state-city" bind:value={originState} required placeholder="QC" />
        </div>
        <div class="field">
          <label for="origin-country-city">Country</label>
          <input id="origin-country-city" bind:value={originCountry} required placeholder="CA" />
        </div>
      {:else if originType === 'STATE'}
        <div class="field">
          <label for="origin-state">State / Province</label>
          <input id="origin-state" bind:value={originState} required placeholder="QC" />
        </div>
        <div class="field">
          <label for="origin-country-state">Country</label>
          <input id="origin-country-state" bind:value={originCountry} required placeholder="CA" />
        </div>
      {:else if originType === 'COUNTRY'}
        <div class="field">
          <label for="origin-country">Country</label>
          <input id="origin-country" bind:value={originCountry} required placeholder="CA" />
        </div>
      {/if}
    </fieldset>

    <!-- Destination -->
    <fieldset class="endpoint-box">
      <legend>Destination</legend>
      <div class="field">
        <label for="dest-type">Level</label>
        <select id="dest-type" bind:value={destinationType}>
          <option value="LOCATION">LOCATION</option>
          <option value="CITY">CITY</option>
          <option value="STATE">STATE</option>
          <option value="COUNTRY">COUNTRY</option>
        </select>
      </div>

      {#if destinationType === 'LOCATION'}
        <div class="field">
          <label for="dest-location">Location</label>
          <select id="dest-location" bind:value={destinationLocationId} required>
            <option value="" disabled>Select…</option>
            {#each locations as l (l.id)}
              <option value={l.id}>{l.name} ({l.city})</option>
            {/each}
          </select>
        </div>
      {:else if destinationType === 'CITY'}
        <div class="field">
          <label for="dest-city">City</label>
          <input id="dest-city" bind:value={destinationCity} required placeholder="Toronto" />
        </div>
        <div class="field">
          <label for="dest-state-city">State / Province</label>
          <input id="dest-state-city" bind:value={destinationState} required placeholder="ON" />
        </div>
        <div class="field">
          <label for="dest-country-city">Country</label>
          <input id="dest-country-city" bind:value={destinationCountry} required placeholder="CA" />
        </div>
      {:else if destinationType === 'STATE'}
        <div class="field">
          <label for="dest-state">State / Province</label>
          <input id="dest-state" bind:value={destinationState} required placeholder="ON" />
        </div>
        <div class="field">
          <label for="dest-country-state">Country</label>
          <input id="dest-country-state" bind:value={destinationCountry} required placeholder="CA" />
        </div>
      {:else if destinationType === 'COUNTRY'}
        <div class="field">
          <label for="dest-country">Country</label>
          <input id="dest-country" bind:value={destinationCountry} required placeholder="CA" />
        </div>
      {/if}
    </fieldset>
  </div>

  <button class="btn" type="submit" style="margin-top: 4px;">Create lane</button>
</form>

<!-- ─── Lanes list ──────────────────────────────────────────────────────────── -->
{#each lanes as lane (lane.id)}
  <div class="card" style="margin-bottom: 12px;">
    <div class="lane-header">
      <div>
        <strong>{lane.name ?? '—'}</strong>
        <span style="margin: 0 8px; color: var(--color-text-muted);">
          <span class="badge badge-muted">{lane.originType}</span>
          {endpointLabel(lane, 'origin')}
          →
          <span class="badge badge-muted">{lane.destinationType}</span>
          {endpointLabel(lane, 'destination')}
        </span>
      </div>
      <div class="row-actions">
        <button
          class="btn btn-secondary btn-sm"
          onclick={() => {
            if (editingLaneId === lane.id) {
              cancelEditCarriers();
            } else {
              startEditCarriers(lane);
            }
          }}
        >
          {editingLaneId === lane.id ? 'Cancel' : 'Edit carriers'}
        </button>
        <button class="btn btn-danger btn-sm" onclick={() => deleteLane(lane.id)}>Delete</button>
      </div>
    </div>

    <!-- Carrier preferences display -->
    {#if lane.carrierPreferences.length > 0}
      <ol class="pref-list">
        {#each lane.carrierPreferences as pref (pref.id)}
          <li>
            {pref.rank}. {pref.carrier.name}
            {#if !pref.carrier.email}
              <span class="badge badge-warning">no email</span>
            {/if}
          </li>
        {/each}
      </ol>
    {:else}
      <p class="muted" style="font-size: 13px; margin: 8px 0 0;">No carrier preferences yet.</p>
    {/if}

    <!-- Inline carrier editor -->
    {#if editingLaneId === lane.id}
      <div class="carrier-editor">
        <div class="field">
          <label for="add-carrier-{lane.id}">Add carrier</label>
          <div style="display: flex; gap: 8px; max-width: 420px;">
            <select id="add-carrier-{lane.id}" bind:value={carrierToAdd}>
              <option value="" disabled>Select carrier…</option>
              {#each carriers.filter((c) => !editingCarrierIds.includes(c.id)) as c (c.id)}
                <option value={c.id}>{c.name}</option>
              {/each}
            </select>
            <button class="btn btn-secondary" type="button" onclick={addCarrier}>Add</button>
          </div>
        </div>

        {#if editingCarrierIds.length > 0}
          <ol class="carrier-list">
            {#each editingCarrierIds as id, index (id)}
              <li>
                <span>{index + 1}. {carrierName(id)}</span>
                <span class="row-actions">
                  <button class="btn btn-secondary btn-sm" type="button" onclick={() => move(index, -1)}>↑</button>
                  <button class="btn btn-secondary btn-sm" type="button" onclick={() => move(index, 1)}>↓</button>
                  <button
                    class="btn btn-danger btn-sm"
                    type="button"
                    onclick={() => (editingCarrierIds = editingCarrierIds.filter((c) => c !== id))}
                  >
                    ✕
                  </button>
                </span>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="muted" style="font-size: 13px; margin: 4px 0 8px;">No carriers in list — save to clear preferences.</p>
        {/if}

        <button class="btn" type="button" onclick={saveCarriers}>Save preferences</button>
      </div>
    {/if}
  </div>
{:else}
  <p class="muted">No lanes defined yet.</p>
{/each}

<style>
  .endpoint-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 20px;
    max-width: 700px;
    margin-bottom: 8px;
  }

  .endpoint-box {
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 12px 16px;
    margin: 0;
  }

  .endpoint-box legend {
    font-weight: 600;
    font-size: 13px;
    padding: 0 4px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .lane-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    flex-wrap: wrap;
  }

  .row-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .pref-list {
    margin: 8px 0 0;
    padding-left: 20px;
    font-size: 14px;
  }

  .carrier-editor {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--color-border);
  }

  .carrier-list {
    list-style: none;
    padding: 0;
    max-width: 420px;
    margin-bottom: 12px;
  }

  .carrier-list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 0;
    border-bottom: 1px solid var(--color-border);
  }
</style>
