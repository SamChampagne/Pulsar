<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Button,
    Card,
    Table,
    Badge,
    EmptyState,
    Skeleton,
    Modal,
    Field,
    Input,
    Select,
  } from '$lib/components/ui';

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
  let loading = $state(true);

  // ─── Create/Edit modal ───────────────────────────────────────────────────────
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
  let showCarrierModal = $state(false);
  let carrierModalLane = $state<Lane | null>(null);

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
    showForm = false;
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
    carrierModalLane = lane;
    editingLaneId = lane.id;
    editingCarrierIds = lane.carrierPreferences.map((p) => p.carrier.id);
    carrierToAdd = '';
    showCarrierModal = true;
  }

  function cancelEditCarriers() {
    editingLaneId = null;
    editingCarrierIds = [];
    carrierToAdd = '';
    showCarrierModal = false;
    carrierModalLane = null;
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

<PageHeader title="Lanes" count={total}>
  {#snippet actions()}
    <Button onclick={() => { resetForm(); showForm = true; }}>New lane</Button>
  {/snippet}
</PageHeader>

<p class="mb-4 text-sm text-ink-muted">
  Auto-tendering uses the most specific matching lane that has a preference list (site beats city
  beats state beats country). Carriers in the preference list are offered the load in rank order;
  rank 1 is tried first.
</p>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else}
<Table>
  {#snippet head()}
    <th>Lane</th><th>Origin</th><th>Destination</th><th>Carrier preferences</th><th></th>
  {/snippet}
  {#snippet body()}
    {#each lanes as lane (lane.id)}
      <tr>
        <td><span class="font-semibold text-ink">{lane.name ?? '—'}</span></td>
        <td>
          <span class="mr-1 rounded border border-edge px-1.5 text-[11px] text-neutral">{lane.originType}</span>
          {endpointLabel(lane, 'origin')}
        </td>
        <td>
          <span class="mr-1 rounded border border-edge px-1.5 text-[11px] text-neutral">{lane.destinationType}</span>
          {endpointLabel(lane, 'destination')}
        </td>
        <td>
          {#if lane.carrierPreferences.length > 0}
            <span class="text-sm text-ink">{lane.carrierPreferences.map((p) => p.carrier.name).join(', ')}</span>
            <span class="ml-1 text-xs text-ink-muted">({lane.carrierPreferences.length})</span>
          {:else}
            <span class="text-sm text-ink-faint">None</span>
          {/if}
        </td>
        <td class="text-right">
          <div class="inline-flex gap-2">
            <Button variant="secondary" onclick={() => startEditCarriers(lane)}>Edit carriers</Button>
            <Button variant="danger" onclick={() => deleteLane(lane.id)}>Delete</Button>
          </div>
        </td>
      </tr>
    {:else}
      <tr><td colspan="5"><EmptyState message="No lanes defined yet." /></td></tr>
    {/each}
  {/snippet}
</Table>
{/if}

<!-- ─── Create lane Modal ─────────────────────────────────────────────────────── -->
<Modal bind:open={showForm} title="New lane">
  {#snippet children()}
    <form onsubmit={create}>
      <Field label="Name (optional)">
        <Input bind:value={formName} placeholder="e.g. Montreal → Toronto" />
      </Field>

      <div class="mt-4 grid grid-cols-2 gap-4">
        <!-- Origin -->
        <fieldset class="rounded-md border border-edge p-3">
          <legend class="px-1 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">Origin</legend>
          <Field label="Level">
            <Select bind:value={originType}>
              <option value="LOCATION">LOCATION</option>
              <option value="CITY">CITY</option>
              <option value="STATE">STATE</option>
              <option value="COUNTRY">COUNTRY</option>
            </Select>
          </Field>

          {#if originType === 'LOCATION'}
            <Field label="Location">
              <Select bind:value={originLocationId} required>
                <option value="" disabled>Select…</option>
                {#each locations as l (l.id)}
                  <option value={l.id}>{l.name} ({l.city})</option>
                {/each}
              </Select>
            </Field>
          {:else if originType === 'CITY'}
            <Field label="City">
              <Input bind:value={originCity} required placeholder="Montreal" />
            </Field>
            <Field label="State / Province">
              <Input bind:value={originState} required placeholder="QC" />
            </Field>
            <Field label="Country">
              <Input bind:value={originCountry} required placeholder="CA" />
            </Field>
          {:else if originType === 'STATE'}
            <Field label="State / Province">
              <Input bind:value={originState} required placeholder="QC" />
            </Field>
            <Field label="Country">
              <Input bind:value={originCountry} required placeholder="CA" />
            </Field>
          {:else if originType === 'COUNTRY'}
            <Field label="Country">
              <Input bind:value={originCountry} required placeholder="CA" />
            </Field>
          {/if}
        </fieldset>

        <!-- Destination -->
        <fieldset class="rounded-md border border-edge p-3">
          <legend class="px-1 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">Destination</legend>
          <Field label="Level">
            <Select bind:value={destinationType}>
              <option value="LOCATION">LOCATION</option>
              <option value="CITY">CITY</option>
              <option value="STATE">STATE</option>
              <option value="COUNTRY">COUNTRY</option>
            </Select>
          </Field>

          {#if destinationType === 'LOCATION'}
            <Field label="Location">
              <Select bind:value={destinationLocationId} required>
                <option value="" disabled>Select…</option>
                {#each locations as l (l.id)}
                  <option value={l.id}>{l.name} ({l.city})</option>
                {/each}
              </Select>
            </Field>
          {:else if destinationType === 'CITY'}
            <Field label="City">
              <Input bind:value={destinationCity} required placeholder="Toronto" />
            </Field>
            <Field label="State / Province">
              <Input bind:value={destinationState} required placeholder="ON" />
            </Field>
            <Field label="Country">
              <Input bind:value={destinationCountry} required placeholder="CA" />
            </Field>
          {:else if destinationType === 'STATE'}
            <Field label="State / Province">
              <Input bind:value={destinationState} required placeholder="ON" />
            </Field>
            <Field label="Country">
              <Input bind:value={destinationCountry} required placeholder="CA" />
            </Field>
          {:else if destinationType === 'COUNTRY'}
            <Field label="Country">
              <Input bind:value={destinationCountry} required placeholder="CA" />
            </Field>
          {/if}
        </fieldset>
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onclick={resetForm}>Cancel</Button>
        <Button type="submit">Create lane</Button>
      </div>
    </form>
  {/snippet}
</Modal>

<!-- ─── Carrier preferences Modal ────────────────────────────────────────────── -->
<Modal bind:open={showCarrierModal} title="Edit carrier preferences — {carrierModalLane?.name ?? '—'}">
  {#snippet children()}
    <div class="mb-3">
      <Field label="Add carrier">
        <div class="flex gap-2">
          <div class="flex-1">
            <Select bind:value={carrierToAdd}>
              <option value="" disabled>Select carrier…</option>
              {#each carriers.filter((c) => !editingCarrierIds.includes(c.id)) as c (c.id)}
                <option value={c.id}>{c.name}</option>
              {/each}
            </Select>
          </div>
          <Button variant="secondary" onclick={addCarrier}>Add</Button>
        </div>
      </Field>
    </div>

    {#if editingCarrierIds.length > 0}
      <ol class="space-y-1">
        {#each editingCarrierIds as id, index (id)}
          <li class="flex items-center justify-between rounded-md border border-edge px-3 py-2 text-sm">
            <span class="text-ink">{index + 1}. {carrierName(id)}</span>
            <div class="flex gap-1">
              <Button variant="secondary" onclick={() => move(index, -1)}>↑</Button>
              <Button variant="secondary" onclick={() => move(index, 1)}>↓</Button>
              <Button variant="danger" onclick={() => { editingCarrierIds = editingCarrierIds.filter((c) => c !== id); }}>✕</Button>
            </div>
          </li>
        {/each}
      </ol>
    {:else}
      <p class="text-sm text-ink-faint">No carriers in list — save to clear preferences.</p>
    {/if}

    <div class="flex justify-end gap-2 pt-2">
      <Button variant="secondary" onclick={cancelEditCarriers}>Cancel</Button>
      <Button onclick={saveCarriers}>Save preferences</Button>
    </div>
  {/snippet}
</Modal>
