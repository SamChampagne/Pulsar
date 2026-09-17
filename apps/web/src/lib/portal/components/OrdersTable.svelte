<!--
  The portal's order workspace: filters + paginated table + the two drawers and
  the creation modal. One implementation for both doors — the session workspace
  (`/portal/orders`) and the capability link (`/portal/:token`) — because the
  two planes expose the very same routes behind `PortalClient`.

  The period filter is applied in the browser: `GET /orders` takes `status`,
  `search`, `page` and `pageSize` only, and this task does not add API
  parameters. The hidden-row count says so out loud rather than quietly
  contradicting the "x–y sur n" line, which stays the server's truth.
-->
<script lang="ts">
  import { type Paginated, ShipmentStatus, TransportOrderStatus } from '@pulsar/shared';
  import { untrack } from 'svelte';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorNotice,
    Field,
    FilterBar,
    Input,
    ReferenceSelect,
    Skeleton,
    Table,
    labelFor,
    toneFor,
  } from '$lib/components/ui';
  import { formatDate } from '$lib/format';
  import { PortalApiError } from '../api';
  import type { PortalClient } from '../client';
  import type { PortalOrder, PortalShipment, PortalView } from '../types';
  import NewOrderModal from './NewOrderModal.svelte';
  import OrderDrawer from './OrderDrawer.svelte';
  import ShipmentTrackingDrawer from './ShipmentTrackingDrawer.svelte';

  let {
    client,
    view,
    createOpen = $bindable(false),
    total = $bindable(0),
    onOrderCreated = undefined,
  }: {
    client: PortalClient;
    view: PortalView;
    /** Bound by the page so its header button can open the creation modal. */
    createOpen?: boolean;
    /** Bound by the page to show the server count next to its title. */
    total?: number;
    /** Lets the caller refresh whatever else depends on the order list. */
    onOrderCreated?: (() => void | Promise<void>) | undefined;
  } = $props();

  const pageSize = 20;

  let orders = $state<PortalOrder[]>([]);
  let page = $state(1);
  let loading = $state(true);
  let error = $state('');

  // Filters
  let statusFilter = $state('');
  let searchInput = $state('');
  let search = $state('');
  let from = $state('');
  let to = $state('');
  let debounce: ReturnType<typeof setTimeout> | null = null;

  // Selection
  let selected = $state<PortalOrder | null>(null);
  let tracked = $state<PortalShipment | null>(null);

  const statusOptions = Object.values(TransportOrderStatus).map((value) => ({
    value,
    label: labelFor(value),
  }));

  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));

  /** Period filter — client-side, on the loaded page (see the file header). */
  const visible = $derived(
    orders.filter((order) => {
      const day = order.createdAt.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    }),
  );
  const hiddenByPeriod = $derived(orders.length - visible.length);
  const filtered = $derived(!!statusFilter || !!search || !!from || !!to);

  function place(p: { city: string; state: string | null }): string {
    return p.state ? `${p.city}, ${p.state}` : p.city;
  }

  function range(early: string | null, late: string | null): string {
    return early ? formatDate(early) + (late ? ` → ${formatDate(late)}` : '') : '—';
  }

  function inTransit(order: PortalOrder): number {
    return order.shipments.filter((s) => s.status === ShipmentStatus.IN_TRANSIT).length;
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const result = await client.get<Paginated<PortalOrder>>('/orders', {
        status: statusFilter || undefined,
        search: search || undefined,
        page,
        pageSize,
      });
      orders = result.items;
      total = result.total;
    } catch (e) {
      orders = [];
      error = e instanceof PortalApiError ? e.message : 'Impossible de charger les commandes.';
    } finally {
      loading = false;
    }
  }

  function onSearchInput() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      search = searchInput.trim();
    }, 250);
  }

  function reset() {
    if (debounce) clearTimeout(debounce);
    statusFilter = '';
    searchInput = '';
    search = '';
    from = '';
    to = '';
  }

  function goTo(next: number) {
    page = next;
    void load();
  }

  async function afterCreate() {
    page = 1;
    await load();
    await onOrderCreated?.();
  }

  // Server-side filters reset the paging and reload; the period is local.
  $effect(() => {
    const _status = statusFilter;
    const _search = search;
    untrack(() => {
      page = 1;
      void load();
    });
  });
</script>

<ErrorNotice message={error} onretry={load} />

<FilterBar>
  <Field label="Statut">
    <ReferenceSelect
      options={statusOptions}
      bind:value={statusFilter}
      clearable
      placeholder="Tous les statuts"
    />
  </Field>
  <Field label="Recherche">
    <Input bind:value={searchInput} oninput={onSearchInput} placeholder="Numéro ou référence…" />
  </Field>
  <Field label="Créée du">
    <Input type="date" bind:value={from} />
  </Field>
  <Field label="Créée au">
    <Input type="date" bind:value={to} />
  </Field>
  <Button variant="secondary" onclick={reset} disabled={!filtered}>Réinitialiser</Button>
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if visible.length === 0}
  <Card>
    <EmptyState
      title={filtered ? 'Aucune commande ne correspond' : 'Aucune commande'}
      message={filtered
        ? 'Élargissez la période ou effacez les filtres pour revoir vos commandes.'
        : 'Envoyez une demande de transport : elle apparaîtra ici dès sa réception.'}
    >
      {#if filtered}
        <Button variant="secondary" onclick={reset}>Réinitialiser les filtres</Button>
      {:else}
        <Button
          onclick={() => {
            createOpen = true;
          }}>Nouvelle demande de transport</Button
        >
      {/if}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Numéro</th>
      <th>Référence</th>
      <th>Trajet</th>
      <th>Statut</th>
      <th>Enlèvement demandé</th>
      <th>Livraison demandée</th>
      <th>Expéditions</th>
    {/snippet}
    {#snippet body()}
      {#each visible as order (order.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <tr
          class="cursor-pointer transition-colors hover:bg-surface-muted"
          onclick={() => (selected = order)}
        >
          <td class="font-semibold text-ink">{order.orderNumber}</td>
          <td class="text-ink-muted">{order.customerReference ?? '—'}</td>
          <td class="text-ink"
            >{place(order.originLocation)} → {place(order.destinationLocation)}</td
          >
          <td><Badge tone={toneFor(order.status)}>{labelFor(order.status)}</Badge></td>
          <td class="text-ink-muted">
            {range(order.requestedPickupEarly, order.requestedPickupLate)}
          </td>
          <td class="text-ink-muted">
            {range(order.requestedDeliveryEarly, order.requestedDeliveryLate)}
          </td>
          <td class="text-ink-muted">
            {order.shipments.length}
            {#if inTransit(order) > 0}
              <span class="text-xs text-info">· {inTransit(order)} en transit</span>
            {/if}
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>

  {#if hiddenByPeriod > 0}
    <p class="mt-2 text-xs text-ink-faint">
      {hiddenByPeriod} commande{hiddenByPeriod > 1 ? 's' : ''} de cette page masquée{hiddenByPeriod >
      1
        ? 's'
        : ''} par le filtre de période.
    </p>
  {/if}

  {#if total > pageSize}
    <div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
      <span class="font-mono text-xs">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} sur {total}
      </span>
      <div class="flex items-center gap-2">
        <Button
          variant="secondary"
          disabled={page <= 1}
          onclick={() => goTo(Math.max(1, page - 1))}
        >
          Précédent
        </Button>
        <span class="font-mono text-xs">Page {page} / {totalPages}</span>
        <Button
          variant="secondary"
          disabled={page >= totalPages}
          onclick={() => goTo(Math.min(totalPages, page + 1))}
        >
          Suivant
        </Button>
      </div>
    </div>
  {/if}
{/if}

<!-- The tracking drawer is wider than the order drawer, so showing both at once
     would leave the order panel sitting on top of it. The order drawer steps
     aside while tracking is open and comes back when it closes. -->
<OrderDrawer
  {client}
  {view}
  order={tracked ? null : selected}
  onclose={() => {
    selected = null;
  }}
  ontrack={(shipment) => {
    tracked = shipment;
  }}
/>

<ShipmentTrackingDrawer
  {client}
  shipmentId={tracked?.id ?? null}
  shipmentNumber={tracked?.shipmentNumber ?? ''}
  onclose={() => {
    tracked = null;
  }}
/>

<NewOrderModal {client} {view} bind:open={createOpen} oncreated={afterCreate} />
