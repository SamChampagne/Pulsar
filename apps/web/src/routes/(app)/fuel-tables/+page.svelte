<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';

  interface FuelEntry {
    id: string;
    effectiveFrom: string;
    pct: number;
  }

  interface FuelTable {
    id: string;
    name: string;
    entries: FuelEntry[];
  }

  interface EntryRow {
    date: string;
    pct: number | string;
  }

  let fuelTables = $state<FuelTable[]>([]);
  let total = $state(0);
  let error = $state('');
  let showForm = $state(false);

  // Form state
  let editingId = $state<string | null>(null);
  let tableName = $state('');
  let entries = $state<EntryRow[]>([]);

  async function load() {
    try {
      const result = await api<Paginated<FuelTable>>('/transportation/fuel-tables', {
        query: { pageSize: 100 },
      });
      fuelTables = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load fuel tables';
    }
  }

  function reset() {
    editingId = null;
    tableName = '';
    entries = [];
    showForm = false;
    error = '';
  }

  function edit(ft: FuelTable) {
    editingId = ft.id;
    tableName = ft.name;
    entries = ft.entries.map((e) => ({
      date: e.effectiveFrom.slice(0, 10),
      pct: e.pct,
    }));
    showForm = true;
  }

  function addEntry() {
    entries = [...entries, { date: '', pct: 0 }];
  }

  function removeEntry(index: number) {
    entries = entries.filter((_, i) => i !== index);
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    error = '';

    if (editingId && entries.length === 0) {
      const msg = 'At least one entry is required when editing a fuel table.';
      error = msg;
      toast.error(msg);
      return;
    }

    try {
      const mappedEntries = entries.map((e) => ({
        effectiveFrom: new Date(e.date).toISOString(),
        pct: Number(e.pct),
      }));

      if (editingId) {
        await api(`/transportation/fuel-tables/${editingId}`, {
          method: 'PATCH',
          body: { name: tableName, entries: mappedEntries },
        });
        toast.success('Fuel table updated');
      } else {
        const body: Record<string, unknown> = { name: tableName };
        if (entries.length > 0) {
          body.entries = mappedEntries;
        }
        await api('/transportation/fuel-tables', { method: 'POST', body });
        toast.success('Fuel table created');
      }
      reset();
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to save fuel table';
      error = msg;
      toast.error(msg);
    }
  }

  async function remove(ft: FuelTable) {
    try {
      await api(`/transportation/fuel-tables/${ft.id}`, { method: 'DELETE' });
      toast.success(`Fuel table "${ft.name}" deleted`);
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to delete fuel table';
      toast.error(msg);
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="page-header">
  <h1>Fuel Tables <span class="muted">({total})</span></h1>
  <button class="btn" onclick={() => { reset(); showForm = !showForm; }}>New fuel table</button>
</div>

{#if error}
  <p class="error-text">{error}</p>
{/if}

{#if showForm}
  <form class="card" style="margin-bottom: 20px;" onsubmit={save}>
    <h2 style="margin-top: 0;">{editingId ? 'Edit fuel table' : 'New fuel table'}</h2>

    <div class="field" style="max-width: 320px;">
      <label for="ft-name">Name</label>
      <input id="ft-name" bind:value={tableName} required placeholder="Summer 2025" />
    </div>

    <div class="section-header">
      <strong>Entries</strong>
      <button class="btn btn-secondary btn-sm" type="button" onclick={addEntry}>Add entry</button>
    </div>

    {#if entries.length === 0}
      <p class="muted" style="font-size: 12px; margin: 4px 0 12px;">
        {editingId ? 'At least one entry required.' : 'No entries — add entries below (optional for new tables).'}
      </p>
    {:else}
      <div class="entries-list">
        {#each entries as entry, i (i)}
          <div class="entry-row">
            <div class="field" style="margin-bottom: 0;">
              <label for="entry-date-{i}">Effective from</label>
              <input
                id="entry-date-{i}"
                type="date"
                bind:value={entry.date}
                required
              />
            </div>
            <div class="field" style="margin-bottom: 0;">
              <label for="entry-pct-{i}">Surcharge %</label>
              <input
                id="entry-pct-{i}"
                type="number"
                step="0.01"
                min="0"
                bind:value={entry.pct}
                required
              />
            </div>
            <button
              class="btn btn-danger btn-sm"
              type="button"
              style="align-self: flex-end;"
              onclick={() => removeEntry(i)}
            >
              Remove
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <div style="display: flex; gap: 8px; margin-top: 12px;">
      <button
        class="btn"
        type="submit"
        disabled={editingId !== null && entries.length === 0}
      >
        {editingId ? 'Update' : 'Create'}
      </button>
      <button class="btn btn-secondary" type="button" onclick={reset}>Cancel</button>
    </div>
  </form>
{/if}

<div class="tables-list">
  {#each fuelTables as ft (ft.id)}
    <div class="card fuel-card">
      <div class="card-header">
        <strong class="card-title">{ft.name}</strong>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary btn-sm" onclick={() => edit(ft)}>Edit</button>
          <button class="btn btn-danger btn-sm" onclick={() => remove(ft)}>Delete</button>
        </div>
      </div>
      {#if ft.entries.length === 0}
        <p class="muted" style="font-size: 13px; margin: 8px 0 0;">No entries.</p>
      {:else}
        <table class="entries-table">
          <thead>
            <tr>
              <th>Effective from</th>
              <th>Surcharge %</th>
            </tr>
          </thead>
          <tbody>
            {#each ft.entries as entry (entry.id)}
              <tr>
                <td>{entry.effectiveFrom.slice(0, 10)}</td>
                <td>{entry.pct}%</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {:else}
    <p class="muted">No fuel tables yet.</p>
  {/each}
</div>

<style>
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .entries-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
    max-width: 640px;
  }

  .entry-row {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 12px;
    align-items: flex-start;
  }

  .tables-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .fuel-card {
    padding: 16px;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .card-title {
    font-size: 15px;
  }

  .entries-table {
    width: auto;
    min-width: 320px;
    font-size: 13px;
  }

  .entries-table th,
  .entries-table td {
    padding: 4px 12px;
  }
</style>
