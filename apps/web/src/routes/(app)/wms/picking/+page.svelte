<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
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

  interface ShipmentRef {
    id: string;
    shipmentNumber: string;
    status: string;
  }

  interface PickRow {
    id: string;
    number: string;
    status: string;
    locationId: string;
    reference?: string | null;
    createdAt: string;
    shipment?: ShipmentRef | null;
    _count: { lines: number };
  }

  interface PickDetail {
    id: string;
    number: string;
    status: string;
    locationId: string;
    reference?: string | null;
    note?: string | null;
    createdAt: string;
  }

  interface LocationOption {
    id: string;
    code: string;
    name: string;
    type: string;
  }

  let orders = $state<PickRow[]>([]);
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
      case 'OPEN':
        return 'info';
      case 'PICKED':
        return 'warn';
      case 'COMPLETED':
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

  // Optional shipment pre-filter, driven by ?shipmentId=… (set from the fulfillment workbench).
  const shipmentFilter = $derived(page.url.searchParams.get('shipmentId'));

  async function load() {
    loading = true;
    error = '';
    try {
      const [ords, locsRes] = await Promise.all([
        api<PickRow[]>('/wms/pick-orders', {
          query: shipmentFilter ? { shipmentId: shipmentFilter } : undefined,
        }),
        api<Paginated<LocationOption>>('/transportation/locations', { query: { pageSize: 100 } }),
      ]);
      orders = ords;
      warehouses = locsRes.items.filter((l) => l.type === 'WAREHOUSE');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des pick orders';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    // re-run when the shipment filter changes (deep-link from the fulfillment workbench)
    void shipmentFilter;
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
      const created = await api<PickDetail>('/wms/pick-orders', {
        method: 'POST',
        body: {
          locationId: createLocationId,
          reference: createReference || undefined,
          note: createNote || undefined,
        },
      });
      toast.success('Pick order créé');
      createOpen = false;
      await goto(`/wms/picking/${created.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création');
    } finally {
      createSaving = false;
    }
  }
</script>

<PageHeader title="Prélèvement">
  {#snippet actions()}
    <Button onclick={openCreate}>Nouveau pick order</Button>
  {/snippet}
</PageHeader>

<div class="mb-4 flex items-center gap-3">
  <a href="/wms" class="text-sm text-accent hover:underline">← Warehouse</a>
  {#if shipmentFilter}
    <span class="text-sm text-ink-muted">
      Filtré par shipment —
      <a href="/wms/picking" class="text-accent hover:underline">tout afficher</a>
    </span>
  {/if}
</div>

{#if loading}
  <div class="grid gap-3">
    {#each Array(4) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else if orders.length === 0}
  <EmptyState message="Aucun pick order." />
{:else}
  <Card padded={false}>
    <div class="divide-y divide-edge">
      {#each orders as o (o.id)}
        <button
          type="button"
          class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface-muted"
          onclick={() => goto(`/wms/picking/${o.id}`)}
        >
          <Badge tone={statusTone(o.status)}>{o.status}</Badge>
          <span class="font-medium text-ink">{o.number}</span>
          {#if o.shipment}
            <span class="text-xs font-medium text-accent">↔ {o.shipment.shipmentNumber}</span>
          {/if}
          <span class="text-ink-muted">{locName(o.locationId)}</span>
          <span class="ml-auto text-xs text-ink-faint">{o._count.lines} ligne(s)</span>
        </button>
      {/each}
    </div>
  </Card>
{/if}

<!-- Create modal -->
<Modal bind:open={createOpen} title="Nouveau pick order">
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
      <Input bind:value={createReference} placeholder="Commande client / expédition" />
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
