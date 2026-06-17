<script lang="ts">
  import { goto } from '$app/navigation';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    Field,
    Input,
    Modal,
    PageHeader,
    Select,
    Skeleton,
    Textarea,
  } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface ReceiptRow {
    id: string;
    number: string;
    status: string;
    locationId: string;
    reference?: string | null;
    createdAt: string;
    _count: { lines: number };
  }

  interface ReceiptDetail {
    id: string;
    number: string;
    status: string;
    locationId: string;
    reference?: string | null;
    note?: string | null;
    createdAt: string;
    _count: { lines: number };
  }

  interface LocationOption {
    id: string;
    code: string;
    name: string;
    type: string;
  }

  let receipts = $state<ReceiptRow[]>([]);
  let warehouses = $state<LocationOption[]>([]);
  let loading = $state(true);
  let error = $state('');

  // Create modal
  let createOpen = $state(false);
  let createLocationId = $state('');
  let createReference = $state('');
  let createNote = $state('');
  let createSaving = $state(false);

  function statusTone(status: string): Tone {
    switch (status) {
      case 'DRAFT':
        return 'info';
      case 'POSTED':
        return 'ok';
      case 'CANCELLED':
        return 'neutral';
      default:
        return 'neutral';
    }
  }

  function locName(id: string): string {
    const l = warehouses.find((w) => w.id === id);
    return l ? `${l.code} — ${l.name}` : id;
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const [recs, locsRes] = await Promise.all([
        api<ReceiptRow[]>('/wms/receipts'),
        api<Paginated<LocationOption>>('/transportation/locations', { query: { pageSize: 100 } }),
      ]);
      receipts = recs;
      warehouses = locsRes.items.filter((l) => l.type === 'WAREHOUSE');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des réceptions';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  function openCreate() {
    createLocationId = warehouses[0]?.id ?? '';
    createReference = '';
    createNote = '';
    createOpen = true;
  }

  async function submitCreate() {
    if (!createLocationId) {
      toast.error('Sélectionnez un entrepôt');
      return;
    }
    createSaving = true;
    try {
      const created = await api<ReceiptDetail>('/wms/receipts', {
        method: 'POST',
        body: {
          locationId: createLocationId,
          reference: createReference || undefined,
          note: createNote || undefined,
        },
      });
      toast.success('Réception créée');
      createOpen = false;
      await goto(`/wms/receiving/${created.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création');
    } finally {
      createSaving = false;
    }
  }
</script>

<PageHeader title="Réception">
  {#snippet actions()}
    <Button onclick={openCreate}>Nouvelle réception</Button>
  {/snippet}
</PageHeader>

<div class="mb-4">
  <a href="/wms" class="text-sm text-accent hover:underline">← Warehouse</a>
</div>

{#if loading}
  <div class="grid gap-3">
    {#each Array(4) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else if receipts.length === 0}
  <EmptyState message="Aucune réception." />
{:else}
  <Card padded={false}>
    <div class="divide-y divide-edge">
      {#each receipts as r (r.id)}
        <button
          type="button"
          class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface-muted"
          onclick={() => goto(`/wms/receiving/${r.id}`)}
        >
          <Badge tone={statusTone(r.status)}>{r.status}</Badge>
          <span class="font-medium text-ink">{r.number}</span>
          <span class="text-ink-muted">{locName(r.locationId)}</span>
          <span class="ml-auto text-xs text-ink-faint">{r._count.lines} ligne(s)</span>
        </button>
      {/each}
    </div>
  </Card>
{/if}

<!-- Create modal -->
<Modal bind:open={createOpen} title="Nouvelle réception">
  <div class="space-y-3">
    <Field label="Entrepôt">
      <Select bind:value={createLocationId}>
        <option value="">— Sélectionner —</option>
        {#each warehouses as w (w.id)}
          <option value={w.id}>{w.code} — {w.name}</option>
        {/each}
      </Select>
    </Field>
    <Field label="Référence">
      <Input bind:value={createReference} placeholder="Bon de commande / fournisseur" />
    </Field>
    <Field label="Note">
      <Textarea bind:value={createNote} />
    </Field>
  </div>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => { createOpen = false; }}>Annuler</Button>
    <Button loading={createSaving} onclick={submitCreate}>Créer</Button>
  {/snippet}
</Modal>
