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
    Panel,
    Field,
    Input,
    Select,
  } from '$lib/components/ui';

  interface Accessorial {
    id: string;
    code: string;
    name: string;
    unit: 'FLAT' | 'PER_HOUR' | 'PER_UNIT';
  }

  let accessorials = $state<Accessorial[]>([]);
  let total = $state(0);
  let error = $state('');
  let showForm = $state(false);
  let loading = $state(true);
  let saving = $state(false);

  // Form state
  let editingId = $state<string | null>(null);
  let code = $state('');
  let name = $state('');
  let unit = $state<'FLAT' | 'PER_HOUR' | 'PER_UNIT'>('FLAT');

  async function load() {
    try {
      const result = await api<Paginated<Accessorial>>('/transportation/accessorials', {
        query: { pageSize: 100 },
      });
      accessorials = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des accessoriaux';
    } finally {
      loading = false;
    }
  }

  function reset() {
    editingId = null;
    code = '';
    name = '';
    unit = 'FLAT';
    showForm = false;
    error = '';
  }

  function openNew() {
    reset();
    showForm = true;
  }

  function edit(acc: Accessorial) {
    editingId = acc.id;
    code = acc.code;
    name = acc.name;
    unit = acc.unit;
    error = '';
    showForm = true;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    saving = true;
    try {
      const body = { code: code.toUpperCase(), name, unit };
      if (editingId) {
        await api(`/transportation/accessorials/${editingId}`, { method: 'PATCH', body });
        toast.success('Accessoriel mis à jour');
      } else {
        await api('/transportation/accessorials', { method: 'POST', body });
        toast.success('Accessoriel créé');
      }
      reset();
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Échec de l'enregistrement de l'accessoriel";
      error = msg;
      toast.error(msg);
    } finally {
      saving = false;
    }
  }

  async function remove(acc: Accessorial) {
    try {
      await api(`/transportation/accessorials/${acc.id}`, { method: 'DELETE' });
      toast.success(`Accessoriel ${acc.code} supprimé`);
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Échec de la suppression de l'accessoriel";
      toast.error(msg);
    }
  }

  const UNIT_LABELS: Record<string, string> = {
    FLAT: 'Forfait',
    PER_HOUR: 'Par heure',
    PER_UNIT: 'Par unité',
  };

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Accessoriaux" count={total}>
  {#snippet actions()}
    <Button onclick={openNew}>Nouvel accessoriel</Button>
  {/snippet}
</PageHeader>

{#if error && !showForm}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if accessorials.length === 0}
  <Card>
    <EmptyState message="Aucun accessoriel pour le moment.">
      {#snippet children()}
        <Button onclick={openNew}>Nouvel accessoriel</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Code</th><th>Nom</th><th>Unité</th><th></th>
    {/snippet}
    {#snippet body()}
      {#each accessorials as acc (acc.id)}
        <tr class="cursor-pointer" onclick={() => edit(acc)}>
          <td class="font-mono font-semibold text-ink">{acc.code}</td>
          <td>{acc.name}</td>
          <td><Badge tone="neutral">{UNIT_LABELS[acc.unit] ?? acc.unit}</Badge></td>
          <td class="text-right" onclick={(e) => e.stopPropagation()}>
            <div class="inline-flex gap-2">
              <Button variant="secondary" onclick={() => edit(acc)}>Modifier</Button>
              <Button variant="danger" onclick={() => remove(acc)}>Supprimer</Button>
            </div>
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Panel bind:open={showForm} title={editingId ? 'Modifier accessoriel' : 'Nouvel accessoriel'}>
  {#snippet children()}
    <form onsubmit={save} class="space-y-3">
      {#if error}<p class="text-sm text-danger">{error}</p>{/if}
      <Field label="Code">
        <Input
          bind:value={code}
          required
          placeholder="FUEL_SUR"
          oninput={(e) => { code = e.currentTarget.value.toUpperCase(); }}
        />
      </Field>
      <Field label="Nom">
        <Input bind:value={name} required placeholder="Surcharge carburant" />
      </Field>
      <Field label="Unité">
        <Select bind:value={unit} required>
          <option value="FLAT">Forfait</option>
          <option value="PER_HOUR">Par heure</option>
          <option value="PER_UNIT">Par unité</option>
        </Select>
      </Field>
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={reset}>Annuler</Button>
        <Button type="submit" loading={saving}>{editingId ? 'Mettre à jour' : 'Créer'}</Button>
      </div>
    </form>
  {/snippet}
</Panel>
