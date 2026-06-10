<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';

  interface LaneRow {
    id: string;
    rank: number;
    originLocation: { id: string; name: string; city: string };
    destinationLocation: { id: string; name: string; city: string };
    carrier: { id: string; name: string; email: string | null };
  }

  interface Option {
    id: string;
    name: string;
  }

  let lanes = $state<LaneRow[]>([]);
  let locations = $state<Option[]>([]);
  let carriers = $state<Option[]>([]);
  let error = $state('');

  // Editor state
  let originId = $state('');
  let destinationId = $state('');
  let selectedCarrierIds = $state<string[]>([]);
  let carrierToAdd = $state('');

  const grouped = $derived(
    Object.values(
      lanes.reduce<Record<string, { key: string; origin: string; destination: string; rows: LaneRow[] }>>(
        (acc, lane) => {
          const key = `${lane.originLocation.id}→${lane.destinationLocation.id}`;
          acc[key] ??= {
            key,
            origin: `${lane.originLocation.name} (${lane.originLocation.city})`,
            destination: `${lane.destinationLocation.name} (${lane.destinationLocation.city})`,
            rows: [],
          };
          acc[key].rows.push(lane);
          return acc;
        },
        {},
      ),
    ),
  );

  async function load() {
    try {
      [lanes] = [await api<LaneRow[]>('/transportation/lanes')];
      const [locs, carrs] = await Promise.all([
        api<Paginated<Option>>('/transportation/locations', { query: { pageSize: 100 } }),
        api<Paginated<Option>>('/transportation/carriers', { query: { pageSize: 100 } }),
      ]);
      locations = locs.items;
      carriers = carrs.items;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load lanes';
    }
  }

  function addCarrier() {
    if (carrierToAdd && !selectedCarrierIds.includes(carrierToAdd)) {
      selectedCarrierIds = [...selectedCarrierIds, carrierToAdd];
    }
    carrierToAdd = '';
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= selectedCarrierIds.length) return;
    const next = [...selectedCarrierIds];
    [next[index], next[target]] = [next[target], next[index]];
    selectedCarrierIds = next;
  }

  function carrierName(id: string): string {
    return carriers.find((c) => c.id === id)?.name ?? id;
  }

  function editLane(group: { rows: LaneRow[] }) {
    originId = group.rows[0].originLocation.id;
    destinationId = group.rows[0].destinationLocation.id;
    selectedCarrierIds = group.rows.map((r) => r.carrier.id);
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    try {
      await api('/transportation/lanes', {
        method: 'PUT',
        body: { originLocationId: originId, destinationLocationId: destinationId, carrierIds: selectedCarrierIds },
      });
      toast.success('Lane preferences saved');
      selectedCarrierIds = [];
      originId = '';
      destinationId = '';
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save lane');
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="page-header">
  <h1>Lane carrier preferences</h1>
</div>

<p class="muted">
  Ordered carrier list per origin → destination pair. Auto-tendering offers the load to rank 1
  first, then moves to the next carrier when an offer is declined or expires.
</p>

{#if error}
  <p class="error-text">{error}</p>
{/if}

<form class="card" style="margin-bottom: 20px;" onsubmit={save}>
  <h2 style="margin-top: 0;">Define a lane</h2>
  <div class="lane-grid">
    <div class="field">
      <label for="origin">Origin</label>
      <select id="origin" bind:value={originId} required>
        <option value="" disabled>Select…</option>
        {#each locations as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
      </select>
    </div>
    <div class="field">
      <label for="destination">Destination</label>
      <select id="destination" bind:value={destinationId} required>
        <option value="" disabled>Select…</option>
        {#each locations as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
      </select>
    </div>
  </div>

  <div class="field">
    <label for="addCarrier">Carriers (ordered by preference)</label>
    <div style="display: flex; gap: 8px; max-width: 420px;">
      <select id="addCarrier" bind:value={carrierToAdd}>
        <option value="" disabled>Add a carrier…</option>
        {#each carriers.filter((c) => !selectedCarrierIds.includes(c.id)) as c (c.id)}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
      <button class="btn btn-secondary" type="button" onclick={addCarrier}>Add</button>
    </div>
  </div>

  {#if selectedCarrierIds.length > 0}
    <ol class="carrier-list">
      {#each selectedCarrierIds as id, index (id)}
        <li>
          <span>{index + 1}. {carrierName(id)}</span>
          <span class="row-actions">
            <button class="btn btn-secondary btn-sm" type="button" onclick={() => move(index, -1)}>↑</button>
            <button class="btn btn-secondary btn-sm" type="button" onclick={() => move(index, 1)}>↓</button>
            <button
              class="btn btn-danger btn-sm"
              type="button"
              onclick={() => (selectedCarrierIds = selectedCarrierIds.filter((c) => c !== id))}
            >
              ✕
            </button>
          </span>
        </li>
      {/each}
    </ol>
  {/if}

  <button class="btn" type="submit" disabled={selectedCarrierIds.length === 0}>Save lane</button>
</form>

{#each grouped as group (group.key)}
  <div class="card" style="margin-bottom: 12px;">
    <strong>{group.origin}</strong> → <strong>{group.destination}</strong>
    <ol style="margin: 8px 0 0;">
      {#each group.rows as row (row.id)}
        <li>
          {row.carrier.name}
          {#if !row.carrier.email}
            <span class="badge badge-warning">no email</span>
          {/if}
        </li>
      {/each}
    </ol>
    <button class="btn btn-secondary btn-sm" style="margin-top: 8px;" onclick={() => editLane(group)}>
      Edit
    </button>
  </div>
{:else}
  <p class="muted">No lanes defined yet.</p>
{/each}

<style>
  .lane-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 20px;
    max-width: 640px;
  }

  .carrier-list {
    list-style: none;
    padding: 0;
    max-width: 420px;
  }

  .carrier-list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 0;
    border-bottom: 1px solid var(--color-border);
  }

  .row-actions {
    display: flex;
    gap: 4px;
  }
</style>
