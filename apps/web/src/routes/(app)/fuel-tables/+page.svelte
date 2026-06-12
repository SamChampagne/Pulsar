<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDate } from '$lib/format';
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
  } from '$lib/components/ui';

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
  let loading = $state(true);

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
    } finally {
      loading = false;
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

<PageHeader title="Fuel Tables" count={total}>
  {#snippet actions()}
    <Button onclick={() => { reset(); showForm = true; }}>New fuel table</Button>
  {/snippet}
</PageHeader>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else}
<Table>
  {#snippet head()}
    <th>Name</th><th>Entries</th><th>Latest effective</th><th>Latest surcharge</th><th></th>
  {/snippet}
  {#snippet body()}
    {#each fuelTables as ft (ft.id)}
      {@const latest = ft.entries.length > 0 ? ft.entries[ft.entries.length - 1] : null}
      <tr>
        <td><span class="font-semibold text-ink">{ft.name}</span></td>
        <td class="tabular-nums">{ft.entries.length}</td>
        <td class="text-sm text-ink-muted">
          {formatDate(latest?.effectiveFrom)}
        </td>
        <td class="tabular-nums">
          {latest ? `${latest.pct}%` : '—'}
        </td>
        <td class="text-right">
          <div class="inline-flex gap-2">
            <Button variant="secondary" onclick={() => edit(ft)}>Edit</Button>
            <Button variant="danger" onclick={() => remove(ft)}>Delete</Button>
          </div>
        </td>
      </tr>
    {:else}
      <tr><td colspan="5"><EmptyState message="No fuel tables yet." /></td></tr>
    {/each}
  {/snippet}
</Table>
{/if}

<!-- ─── Fuel table form Modal ─────────────────────────────────────────────────── -->
<Modal bind:open={showForm} title={editingId ? 'Edit fuel table' : 'New fuel table'}>
  {#snippet children()}
    <form onsubmit={save}>
      <Field label="Name">
        <Input bind:value={tableName} required placeholder="Summer 2025" />
      </Field>

      <div class="mt-4">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-sm font-semibold text-ink">Entries</span>
          <Button variant="secondary" onclick={addEntry}>Add entry</Button>
        </div>

        {#if entries.length === 0}
          <p class="text-xs text-ink-muted">
            {editingId ? 'At least one entry required.' : 'No entries — add entries below (optional for new tables).'}
          </p>
        {:else}
          <div class="space-y-2">
            {#each entries as entry, i (i)}
              <div class="grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
                <Field label="Effective from">
                  <Input type="date" bind:value={entry.date} required />
                </Field>
                <Field label="Surcharge %">
                  <Input type="number" step="0.01" min="0" bind:value={entry.pct} required />
                </Field>
                <Button variant="danger" onclick={() => removeEntry(i)}>Remove</Button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onclick={reset}>Cancel</Button>
        <Button type="submit" disabled={editingId !== null && entries.length === 0}>
          {editingId ? 'Update' : 'Create'}
        </Button>
      </div>
    </form>
  {/snippet}
</Modal>
