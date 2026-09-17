<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { Paginated } from '@pulsar/shared';
  import { PERMISSIONS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { formatDate as formatDateShared } from '$lib/format';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    EntityPicker,
    Field,
    Input,
    Modal,
    PageHeader,
    Skeleton,
    Textarea,
    ViewToggle,
    type ViewId,
  } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';
  import CustomFieldInputs from '$lib/components/CustomFieldInputs.svelte';
  import LocationFormModal from '$lib/components/locations/LocationFormModal.svelte';
  import type { LocationRecord } from '$lib/components/locations/types';

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

  interface CustomFieldDef {
    key: string;
    label: string;
    type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';
    options?: { value: string; label: string }[];
    required: boolean;
    showInList?: boolean;
  }

  let orders = $state<PickRow[]>([]);
  let warehouses = $state<LocationOption[]>([]);
  let loading = $state(true);
  let error = $state('');
  let view = $state<ViewId>('table');

  // Create modal
  let createOpen = $state(false);
  let createLocationId = $state('');
  let createReference = $state('');
  let createNote = $state('');
  let createSaving = $state(false);
  let pickFieldDefs = $state<CustomFieldDef[]>([]);
  let customData = $state<Record<string, unknown>>({});
  let showCreateWarehouse = $state(false);
  const canManageLocations = $derived(
    !!$auth?.user.permissions.includes(PERMISSIONS.CORE.LOCATIONS_MANAGE),
  );

  async function onWarehouseCreated(loc: LocationRecord) {
    showCreateWarehouse = false;
    warehouses = [...warehouses, { id: loc.id, code: loc.code, name: loc.name, type: loc.type }];
    createLocationId = loc.id;
  }

  const KANBAN_COLS: { status: string; label: string }[] = [
    { status: 'OPEN', label: 'Ouvert' },
    { status: 'PICKED', label: 'Prélevé' },
    { status: 'COMPLETED', label: 'Complété' },
    { status: 'CANCELLED', label: 'Annulé' },
  ];

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

  function statusLabel(status: string): string {
    switch (status) {
      case 'OPEN':
        return 'Ouvert';
      case 'PICKED':
        return 'Prélevé';
      case 'COMPLETED':
        return 'Complété';
      case 'CANCELLED':
        return 'Annulé';
      default:
        return status;
    }
  }

  function locName(id: string): string {
    const l = warehouses.find((w) => w.id === id);
    return l ? `${l.code} — ${l.name}` : id;
  }

  function fmtDate(iso: string): string {
    return formatDateShared(iso);
  }

  // Optional shipment pre-filter, driven by ?shipmentId=… (set from the fulfillment workbench).
  const shipmentFilter = $derived(page.url.searchParams.get('shipmentId'));

  async function load() {
    loading = true;
    error = '';
    try {
      const [ords, locsRes] = await Promise.all([
        api<PickRow[]>('/wms/pick-orders', {
          query: {
            shipmentId: shipmentFilter || undefined,
            locationId: page.url.searchParams.get('locationId') || undefined,
          },
        }),
        api<Paginated<LocationOption>>('/wms/sites', { query: { pageSize: 100 } }),
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

  async function openCreate() {
    createLocationId = page.url.searchParams.get('locationId') || warehouses[0]?.id || '';
    createReference = '';
    createNote = '';
    customData = {};
    createOpen = true;
    pickFieldDefs = await api<CustomFieldDef[]>('/wms/custom-fields', {
      query: { entityType: 'PICK_ORDER' },
    }).catch(() => [] as CustomFieldDef[]);
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
          customData: Object.keys(customData).length > 0 ? customData : undefined,
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
    <ViewToggle bind:view views={['table', 'cards', 'kanban']} />
    <Button onclick={openCreate}>Nouveau pick order</Button>
  {/snippet}
</PageHeader>

<div class="mb-4 flex items-center gap-3">
  <a
    href={page.url.searchParams.get('locationId')
      ? `/wms?site=${encodeURIComponent(page.url.searchParams.get('locationId')!)}`
      : '/wms'}
    class="text-sm text-accent hover:underline">← Entrepôt</a
  >
  {#if page.url.searchParams.get('locationId')}<span class="text-xs text-ink-muted"
      >Site : {locName(page.url.searchParams.get('locationId')!)} ·
      <a href="/wms/picking" class="text-accent hover:underline">Tous les sites</a></span
    >{/if}
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
{:else if view === 'table'}
  {#if orders.length === 0}
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
            <Badge tone={statusTone(o.status)}>{statusLabel(o.status)}</Badge>
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
{:else if view === 'cards'}
  {#if orders.length === 0}
    <EmptyState message="Aucun pick order." />
  {:else}
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each orders as o (o.id)}
        <a href={`/wms/picking/${o.id}`} class="block">
          <Card>
            <div class="flex items-start justify-between gap-2">
              <span class="font-semibold text-ink">{o.number}</span>
              <Badge tone={statusTone(o.status)}>{statusLabel(o.status)}</Badge>
            </div>
            {#if o.shipment}
              <p class="mt-0.5 text-xs font-medium text-accent">↔ {o.shipment.shipmentNumber}</p>
            {/if}
            <p class="mt-1 truncate text-sm text-ink-muted">{locName(o.locationId)}</p>
            {#if o.reference}
              <p class="mt-0.5 truncate text-xs text-ink-faint">Réf : {o.reference}</p>
            {/if}
            <div class="mt-2 flex items-center justify-between text-xs text-ink-faint">
              <span>{o._count.lines} ligne(s)</span>
              <span>{fmtDate(o.createdAt)}</span>
            </div>
          </Card>
        </a>
      {/each}
    </div>
  {/if}
{:else if view === 'kanban'}
  <div class="flex gap-3 overflow-x-auto pb-2">
    {#each KANBAN_COLS as col (col.status)}
      {@const items = orders.filter((o) => o.status === col.status)}
      <div
        class="flex w-64 shrink-0 flex-col rounded-card border border-edge-soft bg-surface-muted"
      >
        <div class="flex items-center justify-between px-3 py-2">
          <Badge tone={statusTone(col.status)}>{col.label}</Badge>
          <span class="font-mono text-xs text-ink-muted">{items.length}</span>
        </div>
        <div class="flex max-h-[65vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
          {#if items.length === 0}
            <p class="px-1 py-3 text-center text-xs text-ink-faint">—</p>
          {:else}
            {#each items as o (o.id)}
              <a
                href={`/wms/picking/${o.id}`}
                class="block rounded-inner border border-edge-soft bg-surface p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card"
              >
                <div class="font-semibold text-sm text-ink">{o.number}</div>
                {#if o.shipment}
                  <div class="mt-0.5 text-[11px] font-medium text-accent">
                    ↔ {o.shipment.shipmentNumber}
                  </div>
                {/if}
                <div class="mt-0.5 truncate text-xs text-ink-muted">{locName(o.locationId)}</div>
                <div class="mt-1 flex items-center justify-between text-[11px] text-ink-faint">
                  <span>{o._count.lines} ligne(s)</span>
                  <span>{fmtDate(o.createdAt)}</span>
                </div>
              </a>
            {/each}
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}

<!-- Create modal -->
<Modal bind:open={createOpen} title="Nouveau pick order">
  <div class="space-y-3">
    <Field label="Entrepôt">
      <EntityPicker
        endpoint="/wms/sites"
        label="Entrepôt"
        bind:value={createLocationId}
        allowCreate={canManageLocations
          ? { label: 'Créer un entrepôt', onCreate: () => (showCreateWarehouse = true) }
          : undefined}
      />
    </Field>
    <Field label="Référence">
      <Input bind:value={createReference} placeholder="Commande client / expédition" />
    </Field>
    <Field label="Note">
      <Textarea bind:value={createNote} />
    </Field>
    {#if pickFieldDefs.length > 0}
      <CustomFieldInputs definitions={pickFieldDefs} bind:data={customData} />
    {/if}
  </div>
  {#snippet footer()}
    <Button
      variant="secondary"
      onclick={() => {
        createOpen = false;
      }}>Annuler</Button
    >
    <Button loading={createSaving} onclick={submitCreate}>Créer</Button>
  {/snippet}
</Modal>

<LocationFormModal
  bind:open={showCreateWarehouse}
  location={null}
  lockedType="WAREHOUSE"
  oncreated={onWarehouseCreated}
/>
