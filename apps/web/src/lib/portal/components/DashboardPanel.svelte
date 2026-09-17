<script lang="ts">
  import {
    CustomerInvoiceStatus,
    PortalChangeRequestStatus,
    ShipmentStatus,
    TransportOrderStatus,
  } from '@pulsar/shared';
  import { Badge, Card, EmptyState, ErrorNotice, PageHeader, Skeleton } from '$lib/components/ui';
  import { labelFor, toneFor } from '$lib/components/ui';
  import { formatDate, formatMoney } from '$lib/format';
  import { PortalApiError } from '../api';
  import type { PortalClient } from '../client';
  import type { Invoice, PortalChangeRequest, PortalView } from '../types';
  import { positionAt } from '../types';
  import KpiTile from './KpiTile.svelte';
  import PortalMap, { type PortalMapPoint } from './PortalMap.svelte';

  /**
   * The portal home: what is moving, what is owed, what is waiting on the
   * shipper. Orders come from the shell's single `/view` load; invoices and
   * change requests are fetched here because no other portal page needs them
   * as counts.
   *
   * `hrefs` is optional so the same panel serves the capability-link plane,
   * which has no sub-routes: tiles there are read-outs instead of links.
   */
  let {
    client,
    view,
    hrefs = {},
  }: {
    client: PortalClient;
    view: PortalView;
    hrefs?: { orders?: string; invoices?: string; requests?: string };
  } = $props();

  let invoices = $state<Invoice[] | null>(null);
  let requests = $state<PortalChangeRequest[] | null>(null);
  let loading = $state(true);
  let error = $state('');

  const OPEN_ORDER_STATUSES = new Set<string>([
    TransportOrderStatus.DRAFT,
    TransportOrderStatus.CONFIRMED,
    TransportOrderStatus.PLANNED,
    TransportOrderStatus.IN_EXECUTION,
  ]);
  const MOVING_STATUSES = new Set<string>([ShipmentStatus.DISPATCHED, ShipmentStatus.IN_TRANSIT]);
  const OPEN_REQUEST_STATUSES = new Set<string>([
    PortalChangeRequestStatus.OPEN,
    PortalChangeRequestStatus.ACKNOWLEDGED,
  ]);

  const shipments = $derived(view.orders.flatMap((order) => order.shipments));
  const openOrders = $derived(view.orders.filter((o) => OPEN_ORDER_STATUSES.has(o.status)));
  const moving = $derived(shipments.filter((s) => MOVING_STATUSES.has(s.status)));

  const deliveredRecently = $derived.by(() => {
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return shipments.filter(
      (s) => s.actualDeliveryAt && new Date(s.actualDeliveryAt).getTime() >= since,
    );
  });

  /** Unpaid = every statement the portal can see that is not settled yet. */
  const unpaid = $derived((invoices ?? []).filter((i) => i.status !== CustomerInvoiceStatus.PAID));
  const dueByCurrency = $derived.by(() => {
    const totals = new Map<string, number>();
    for (const invoice of unpaid) {
      const outstanding = invoice.totalAmount - invoice.amountPaid;
      if (outstanding <= 0) continue;
      totals.set(invoice.currency, (totals.get(invoice.currency) ?? 0) + outstanding);
    }
    return [...totals.entries()]
      .map(([currency, total]) => formatMoney(total, currency))
      .join(' · ');
  });

  const openRequests = $derived(
    (requests ?? []).filter((r) => OPEN_REQUEST_STATUSES.has(r.status)),
  );

  const mapPoints = $derived.by(() =>
    moving.reduce<PortalMapPoint[]>((points, shipment) => {
      const position = shipment.lastPosition;
      if (!position) return points;
      const at = positionAt(position);
      points.push({
        id: shipment.id,
        label: shipment.shipmentNumber,
        latitude: position.latitude,
        longitude: position.longitude,
        detail: at ? `position du ${formatDate(at)}` : null,
      });
      return points;
    }, []),
  );

  const latestOrders = $derived(view.orders.slice(0, 5));
  const latestInvoices = $derived((invoices ?? []).slice(0, 5));

  async function load() {
    loading = true;
    error = '';
    try {
      // Both are independent reads — one round-trip each, in parallel.
      const [loadedInvoices, loadedRequests] = await Promise.all([
        client.get<Invoice[]>('/invoices'),
        client.get<PortalChangeRequest[]>('/change-requests'),
      ]);
      invoices = loadedInvoices;
      requests = loadedRequests;
    } catch (e) {
      error = e instanceof PortalApiError ? e.message : 'Tableau de bord indisponible.';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader
  title="Tableau de bord"
  subtitle={`Vos expéditions, vos factures et vos demandes chez ${view.shipper}.`}
/>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
    {#each { length: 5 } as _, i (i)}<Card><Skeleton rows={2} /></Card>{/each}
  </div>
{:else}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
    <KpiTile
      label="Commandes actives"
      value={openOrders.length}
      href={hrefs.orders}
      hint={view.orders.length ? `${view.orders.length} au total` : undefined}
    />
    <KpiTile label="Expéditions en transit" value={moving.length} href={hrefs.orders} />
    <KpiTile label="Livrées (30 j)" value={deliveredRecently.length} href={hrefs.orders} />
    <KpiTile
      label="Factures à payer"
      value={unpaid.length}
      href={hrefs.invoices}
      hint={dueByCurrency || undefined}
      tone={unpaid.length > 0 ? 'warn' : 'neutral'}
    />
    <KpiTile
      label="Demandes ouvertes"
      value={openRequests.length}
      href={hrefs.requests}
      tone={openRequests.length > 0 ? 'warn' : 'neutral'}
    />
  </div>
{/if}

<section class="mt-4">
  <Card>
    <h2 class="mb-3 text-sm font-semibold text-ink">Expéditions en transit</h2>
    {#if mapPoints.length > 0}
      <PortalMap points={mapPoints} />
      <p class="mt-2 text-xs text-ink-faint">
        Dernière position connue de chaque expédition en cours.
      </p>
    {:else}
      <EmptyState
        title="Aucune expédition en transit"
        message="Dès qu’une expédition part, sa dernière position connue apparaît ici."
      />
    {/if}
  </Card>
</section>

<div class="mt-4 grid gap-4 lg:grid-cols-2">
  <Card>
    <div class="mb-3 flex items-center justify-between gap-2">
      <h2 class="text-sm font-semibold text-ink">Dernières commandes</h2>
      {#if hrefs.orders}<a href={hrefs.orders} class="text-xs text-accent hover:underline"
          >Tout voir</a
        >{/if}
    </div>
    {#if latestOrders.length === 0}
      <EmptyState
        title="Aucune commande"
        message="Envoyez une demande de transport depuis la page Commandes."
      />
    {:else}
      <ul class="divide-y divide-edge-soft">
        {#each latestOrders as order (order.id)}
          <li class="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-sm text-ink">{order.orderNumber}</span>
                <Badge tone={toneFor(order.status)}>{labelFor(order.status)}</Badge>
              </div>
              <p class="mt-0.5 truncate text-xs text-ink-muted">
                {order.originLocation.city} → {order.destinationLocation.city}
              </p>
            </div>
            <span class="text-xs text-ink-faint">{formatDate(order.createdAt)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </Card>

  <Card>
    <div class="mb-3 flex items-center justify-between gap-2">
      <h2 class="text-sm font-semibold text-ink">Factures récentes</h2>
      {#if hrefs.invoices}<a href={hrefs.invoices} class="text-xs text-accent hover:underline"
          >Tout voir</a
        >{/if}
    </div>
    {#if loading}
      <Skeleton rows={3} />
    {:else if latestInvoices.length === 0}
      <EmptyState
        title="Aucune facture"
        message="Vos relevés apparaîtront ici dès leur approbation."
      />
    {:else}
      <ul class="divide-y divide-edge-soft">
        {#each latestInvoices as invoice (invoice.id)}
          <li class="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <span class="font-mono text-sm text-ink">{invoice.invoiceNumber}</span>
              <Badge tone={toneFor(invoice.status)}>{labelFor(invoice.status)}</Badge>
            </div>
            <span class="text-sm text-ink"
              >{formatMoney(invoice.totalAmount, invoice.currency)}</span
            >
          </li>
        {/each}
      </ul>
    {/if}
  </Card>
</div>
