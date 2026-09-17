<!--
  Contextual detail of one transport order (rule: a Drawer for details, a Modal
  for a short creation). Everything it shows already travels in the order row —
  no extra round-trip — so opening it is instant; only the change-request form
  and the tracking drawer reach the API.
-->
<script lang="ts">
  import { Badge, Button, Drawer, Modal, Table, labelFor, toneFor } from '$lib/components/ui';
  import { formatDate, formatDateTime } from '$lib/format';
  import type { PortalClient } from '../client';
  import type { PortalOrder, PortalShipment, PortalView } from '../types';
  import ChangeRequestForm from './ChangeRequestForm.svelte';

  let {
    client,
    view,
    order,
    onclose,
    ontrack,
  }: {
    client: PortalClient;
    view: PortalView;
    /** `null` keeps the drawer closed — the caller's selection drives it. */
    order: PortalOrder | null;
    onclose: () => void;
    ontrack: (shipment: PortalShipment) => void;
  } = $props();

  let changeOpen = $state(false);

  const place = (p: { city: string; state: string | null }) =>
    p.state ? `${p.city}, ${p.state}` : p.city;

  const range = (early: string | null, late: string | null) =>
    early ? formatDate(early) + (late ? ` → ${formatDate(late)}` : '') : '—';

  const number = (value: number | null, unit: string) => (value == null ? '—' : `${value} ${unit}`);

  function shipmentActual(shipment: PortalShipment): string {
    if (shipment.actualDeliveryAt) return `livré ${formatDateTime(shipment.actualDeliveryAt)}`;
    if (shipment.actualPickupAt) return `enlevé ${formatDateTime(shipment.actualPickupAt)}`;
    return '—';
  }
</script>

<Drawer
  open={!!order}
  title={order ? `Commande ${order.orderNumber}` : 'Commande'}
  width="lg"
  {onclose}
>
  {#if order}
    <div class="flex flex-col gap-5">
      <!-- Header -->
      <div class="flex flex-wrap items-center gap-2">
        <Badge tone={toneFor(order.status)}>{labelFor(order.status)}</Badge>
        {#if order.customerReference}
          <span class="text-sm text-ink-muted">réf {order.customerReference}</span>
        {/if}
        <span class="text-xs text-ink-faint">
          créée le {formatDate(order.createdAt)} · mise à jour {formatDate(order.updatedAt)}
        </span>
      </div>

      <!-- Route -->
      <section>
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Trajet</h3>
        <p class="text-sm text-ink">
          {place(order.originLocation)} → {place(order.destinationLocation)}
        </p>
      </section>

      <!-- Requested windows -->
      <section>
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Fenêtres demandées
        </h3>
        <dl class="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt class="text-xs text-ink-muted">Enlèvement</dt>
            <dd class="text-ink">
              {range(order.requestedPickupEarly, order.requestedPickupLate)}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-ink-muted">Livraison</dt>
            <dd class="text-ink">
              {range(order.requestedDeliveryEarly, order.requestedDeliveryLate)}
            </dd>
          </div>
        </dl>
      </section>

      <!-- Measures -->
      <section>
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Mesures</h3>
        <dl class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt class="text-xs text-ink-muted">Mode</dt>
            <dd class="text-ink">{order.mode ?? '—'}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-muted">Poids</dt>
            <dd class="text-ink">{number(order.totalWeightKg, 'kg')}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-muted">Volume</dt>
            <dd class="text-ink">{number(order.totalVolumeM3, 'm³')}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-muted">Palettes</dt>
            <dd class="text-ink">{order.palletCount ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <!-- Notes -->
      {#if order.notes}
        <section>
          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Notes</h3>
          <p class="whitespace-pre-wrap text-sm text-ink">{order.notes}</p>
        </section>
      {/if}

      <!-- Shipments -->
      <section>
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Expéditions
        </h3>
        {#if order.shipments.length === 0}
          <p class="text-sm text-ink-muted">
            Aucune expédition pour l'instant — elles apparaîtront dès que la commande sera
            confirmée.
          </p>
        {:else}
          <Table>
            {#snippet head()}
              <th>Numéro</th><th>Statut</th><th>Prévu</th><th>Réel</th><th>Docs</th><th>Action</th>
            {/snippet}
            {#snippet body()}
              {#each order.shipments as shipment (shipment.id)}
                <tr>
                  <td class="font-semibold text-ink">{shipment.shipmentNumber}</td>
                  <td>
                    <Badge tone={toneFor(shipment.status)}>{labelFor(shipment.status)}</Badge>
                  </td>
                  <td class="text-ink-muted">
                    {range(shipment.plannedPickupEarly, shipment.plannedPickupLate)}
                  </td>
                  <td class="text-ink-muted">{shipmentActual(shipment)}</td>
                  <td class="text-ink-muted">
                    {shipment.documentCount}
                    {#if shipment.hasPod}<Badge tone="ok">POD</Badge>{/if}
                  </td>
                  <td class="text-right">
                    <Button variant="secondary" onclick={() => ontrack(shipment)}>Suivre</Button>
                  </td>
                </tr>
              {/each}
            {/snippet}
          </Table>
        {/if}
      </section>

      <div class="flex justify-end border-t border-edge pt-4">
        <Button
          variant="secondary"
          onclick={() => {
            changeOpen = true;
          }}
        >
          Demander un changement
        </Button>
      </div>
    </div>
  {/if}
</Drawer>

<!-- Change request, pre-filled with the open order. -->
<Modal bind:open={changeOpen} title="Demander un changement" size="md">
  {#if order}
    <ChangeRequestForm {client} {view} {order} onsent={() => (changeOpen = false)} />
  {/if}
</Modal>
