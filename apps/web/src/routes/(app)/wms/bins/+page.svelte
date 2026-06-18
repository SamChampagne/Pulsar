<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    Field,
    FilterBar,
    Input,
    Modal,
    PageHeader,
    Select,
    Skeleton,
    Table,
  } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface Bin {
    id: string;
    code: string;
    kind: string;
    locationId: string;
    isActive: boolean;
    location: { id: string; code: string; name: string };
  }

  interface LocationOption {
    id: string;
    code: string;
    name: string;
    type: string;
  }

  const KINDS = ['RECEIVING', 'STORAGE', 'SHIPPING'];
  const KIND_LABELS: Record<string, string> = {
    RECEIVING: 'Réception',
    STORAGE: 'Stockage',
    SHIPPING: 'Expédition',
  };

  let bins = $state<Bin[]>([]);
  let warehouses = $state<LocationOption[]>([]);
  let loading = $state(true);
  let error = $state('');
  let filterLocationId = $state('');

  // Create / edit panel
  let formOpen = $state(false);
  let editId = $state<string | null>(null);
  let formLocationId = $state('');
  let formCode = $state('');
  let formKind = $state('STORAGE');
  let formActive = $state(true);
  let saving = $state(false);

  function kindTone(kind: string): Tone {
    switch (kind) {
      case 'RECEIVING':
        return 'info';
      case 'STORAGE':
        return 'neutral';
      case 'SHIPPING':
        return 'warn';
      default:
        return 'neutral';
    }
  }

  function kindLabel(kind: string): string {
    return KIND_LABELS[kind] ?? kind;
  }

  async function loadWarehouses() {
    const res = await api<Paginated<LocationOption>>('/transportation/locations', {
      query: { pageSize: 100 },
    });
    warehouses = res.items.filter((l) => l.type === 'WAREHOUSE');
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const [binsRes] = await Promise.all([
        api<Bin[]>('/wms/bins', { query: { locationId: filterLocationId || undefined } }),
        warehouses.length === 0 ? loadWarehouses() : Promise.resolve(),
      ]);
      bins = binsRes;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des emplacements';
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
    formLocationId = filterLocationId || warehouses[0]?.id || '';
    formCode = '';
    formKind = 'STORAGE';
    formActive = true;
    formOpen = true;
  }

  function openEdit(b: Bin) {
    editId = b.id;
    formLocationId = b.locationId;
    formCode = b.code;
    formKind = b.kind;
    formActive = b.isActive;
    formOpen = true;
  }

  async function submit() {
    if (!formLocationId || !formCode.trim()) {
      toast.error('Entrepôt et code sont requis');
      return;
    }
    saving = true;
    try {
      const body = {
        locationId: formLocationId,
        code: formCode.trim(),
        kind: formKind,
        isActive: formActive,
      };
      if (editId) {
        await api(`/wms/bins/${editId}`, { method: 'PATCH', body });
        toast.success('Emplacement mis à jour');
      } else {
        await api('/wms/bins', { method: 'POST', body });
        toast.success('Emplacement créé');
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

<PageHeader title="Emplacements" count={bins.length}>
  {#snippet actions()}
    <Button onclick={openCreate}>Nouvel emplacement</Button>
  {/snippet}
</PageHeader>

<FilterBar>
  <a href="/wms" class="text-sm text-accent hover:underline">← Entrepôt</a>
  <div class="w-64">
    <Select bind:value={filterLocationId}>
      <option value="">Tous les entrepôts</option>
      {#each warehouses as w (w.id)}
        <option value={w.id}>{w.code} — {w.name}</option>
      {/each}
    </Select>
  </div>
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else if bins.length === 0}
  <Card>
    <EmptyState message="Aucun emplacement pour le moment.">
      {#snippet children()}
        <Button onclick={openCreate}>Nouvel emplacement</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Code</th><th>Type</th><th>Entrepôt</th><th>Statut</th>
    {/snippet}
    {#snippet body()}
      {#each bins as b (b.id)}
        <tr class="cursor-pointer" onclick={() => openEdit(b)}>
          <td class="font-mono font-semibold text-ink">{b.code}</td>
          <td><Badge tone={kindTone(b.kind)}>{kindLabel(b.kind)}</Badge></td>
          <td class="text-ink-muted"><span class="font-mono">{b.location.code}</span> — {b.location.name}</td>
          <td><Badge tone={b.isActive ? 'ok' : 'neutral'}>{b.isActive ? 'Actif' : 'Inactif'}</Badge></td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Modal bind:open={formOpen} title={editId ? "Modifier l'emplacement" : 'Nouvel emplacement'} size="md">
  {#snippet children()}
    <div class="space-y-3">
      <Field label="Entrepôt">
        <Select bind:value={formLocationId}>
          <option value="">— Sélectionner —</option>
          {#each warehouses as w (w.id)}
            <option value={w.id}>{w.code} — {w.name}</option>
          {/each}
        </Select>
      </Field>
      <Field label="Code">
        <Input bind:value={formCode} placeholder="A-01-01" />
      </Field>
      <Field label="Type">
        <Select bind:value={formKind}>
          {#each KINDS as k (k)}<option value={k}>{KIND_LABELS[k] ?? k}</option>{/each}
        </Select>
      </Field>
      <Field label="Actif">
        <label class="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" bind:checked={formActive} />
          Emplacement actif
        </label>
      </Field>
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={() => { formOpen = false; }}>Annuler</Button>
        <Button variant="primary" loading={saving} onclick={submit}>Enregistrer</Button>
      </div>
    </div>
  {/snippet}
</Modal>
