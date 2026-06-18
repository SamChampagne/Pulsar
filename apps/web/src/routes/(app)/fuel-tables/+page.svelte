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
  let saving = $state(false);

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
      error = e instanceof ApiError ? e.message : 'Échec du chargement des tables de carburant';
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

  function openNew() {
    reset();
    showForm = true;
  }

  function edit(ft: FuelTable) {
    editingId = ft.id;
    tableName = ft.name;
    entries = ft.entries.map((e) => ({
      date: e.effectiveFrom.slice(0, 10),
      pct: e.pct,
    }));
    error = '';
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
      const msg = 'Au moins une entrée est requise lors de la modification d’une table de carburant.';
      error = msg;
      toast.error(msg);
      return;
    }

    saving = true;
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
        toast.success('Table de carburant mise à jour');
      } else {
        const body: Record<string, unknown> = { name: tableName };
        if (entries.length > 0) {
          body.entries = mappedEntries;
        }
        await api('/transportation/fuel-tables', { method: 'POST', body });
        toast.success('Table de carburant créée');
      }
      reset();
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Échec de l'enregistrement de la table de carburant";
      error = msg;
      toast.error(msg);
    } finally {
      saving = false;
    }
  }

  async function remove(ft: FuelTable) {
    try {
      await api(`/transportation/fuel-tables/${ft.id}`, { method: 'DELETE' });
      toast.success(`Table de carburant « ${ft.name} » supprimée`);
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Échec de la suppression de la table de carburant';
      toast.error(msg);
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Tables de carburant" count={total}>
  {#snippet actions()}
    <Button onclick={openNew}>Nouvelle table</Button>
  {/snippet}
</PageHeader>

{#if error && !showForm}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if fuelTables.length === 0}
  <Card>
    <EmptyState message="Aucune table de carburant pour le moment.">
      {#snippet children()}
        <Button onclick={openNew}>Nouvelle table</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Nom</th><th>Entrées</th><th>Dernière prise d’effet</th><th>Dernière surcharge</th><th></th>
    {/snippet}
    {#snippet body()}
      {#each fuelTables as ft (ft.id)}
        {@const latest = ft.entries.length > 0 ? ft.entries[ft.entries.length - 1] : null}
        <tr class="cursor-pointer" onclick={() => edit(ft)}>
          <td class="font-semibold text-ink">{ft.name}</td>
          <td class="font-mono tabular-nums">{ft.entries.length}</td>
          <td class="text-sm text-ink-muted">
            {formatDate(latest?.effectiveFrom)}
          </td>
          <td class="font-mono tabular-nums">
            {latest ? `${latest.pct}%` : '—'}
          </td>
          <td class="text-right" onclick={(e) => e.stopPropagation()}>
            <div class="inline-flex gap-2">
              <Button variant="secondary" onclick={() => edit(ft)}>Modifier</Button>
              <Button variant="danger" onclick={() => remove(ft)}>Supprimer</Button>
            </div>
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Modal bind:open={showForm} title={editingId ? 'Modifier la table' : 'Nouvelle table de carburant'} size="md">
  {#snippet children()}
    <form onsubmit={save} class="space-y-4">
      {#if error}<p class="text-sm text-danger">{error}</p>{/if}
      <Field label="Nom">
        <Input bind:value={tableName} required placeholder="Été 2025" />
      </Field>

      <div>
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Entrées</span>
          <Button variant="secondary" onclick={addEntry}>Ajouter une entrée</Button>
        </div>

        {#if entries.length === 0}
          <p class="text-xs text-ink-muted">
            {editingId
              ? 'Au moins une entrée requise.'
              : 'Aucune entrée — ajoutez-en ci-dessous (optionnel pour une nouvelle table).'}
          </p>
        {:else}
          <div class="space-y-3">
            {#each entries as entry, i (i)}
              <div class="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Field label="Prise d’effet">
                  <Input type="date" bind:value={entry.date} required />
                </Field>
                <Field label="Surcharge %">
                  <Input type="number" step="0.01" min="0" bind:value={entry.pct} required />
                </Field>
                <Button variant="danger" onclick={() => removeEntry(i)}>Retirer</Button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={reset}>Annuler</Button>
        <Button type="submit" loading={saving} disabled={editingId !== null && entries.length === 0}>
          {editingId ? 'Mettre à jour' : 'Créer'}
        </Button>
      </div>
    </form>
  {/snippet}
</Modal>
