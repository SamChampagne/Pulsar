<script lang="ts">
  import { Field, Select, Textarea, Button } from '$lib/components/ui';
  import { PortalApiError } from '../api';
  import type { PortalClient } from '../client';
  import type { PortalOrder, PortalView } from '../types';

  let {
    client,
    view,
    order = null,
    onsent = undefined,
  }: {
    client: PortalClient;
    view: PortalView;
    /**
     * Pre-filled context: when the form is opened from an order drawer the
     * order is fixed (and may well sit outside the 50 rows of `view.orders`),
     * so it is displayed rather than chosen.
     */
    order?: PortalOrder | null;
    onsent?: (() => void) | undefined;
  } = $props();

  let changeKind = $state('');
  let changeOrderId = $state('');
  let changeShipmentId = $state('');
  let changeNote = $state('');
  let changeNotice = $state('');
  let changeSending = $state(false);
  let changeError = $state('');

  /** The order the request hangs off: the fixed one, or the picked one. */
  const contextOrder = $derived(order ?? view.orders.find((o) => o.id === changeOrderId) ?? null);

  async function submitChange(event: SubmitEvent) {
    event.preventDefault();
    changeNotice = '';
    changeError = '';
    changeSending = true;
    try {
      await client.post('/change-requests', {
        kind: changeKind,
        note: changeNote,
        orderId: order?.id ?? (changeOrderId || undefined),
        shipmentId: changeShipmentId || undefined,
      });
      changeNotice = 'Demande envoyée.';
      changeKind = '';
      changeOrderId = '';
      changeShipmentId = '';
      changeNote = '';
      onsent?.();
    } catch (e) {
      changeError = e instanceof PortalApiError ? e.message : "Échec de l'envoi";
    } finally {
      changeSending = false;
    }
  }
</script>

<form onsubmit={submitChange} class="flex flex-col gap-4">
  {#if changeNotice}
    <p class="text-sm text-ok">{changeNotice}</p>
  {/if}
  {#if changeError}
    <p class="text-sm text-danger">{changeError}</p>
  {/if}
  {#if order}
    <p class="text-sm text-ink-muted">
      Commande <span class="font-semibold text-ink">{order.orderNumber}</span>
    </p>
  {/if}
  <Field label="Type de demande">
    <Select bind:value={changeKind} required>
      <option value="" disabled>Sélectionner…</option>
      <option value="DATE">DATE</option>
      <option value="ADDRESS">ADDRESS</option>
      <option value="CANCEL">CANCEL</option>
      <option value="OTHER">OTHER</option>
    </Select>
  </Field>
  {#if !order}
    <Field label="Commande (optionnel)">
      <Select bind:value={changeOrderId}>
        <option value="">— Toutes —</option>
        {#each view.orders as o (o.id)}
          <option value={o.id}>{o.orderNumber}</option>
        {/each}
      </Select>
    </Field>
  {/if}
  {#if contextOrder && contextOrder.shipments.length > 0}
    <Field label="Envoi (optionnel)">
      <Select bind:value={changeShipmentId}>
        <option value="">— Tous —</option>
        {#each contextOrder.shipments as shipment (shipment.id)}
          <option value={shipment.id}>{shipment.shipmentNumber}</option>
        {/each}
      </Select>
    </Field>
  {/if}
  <Field label="Note">
    <Textarea bind:value={changeNote} rows={3} placeholder="Décrivez le changement souhaité…" />
  </Field>
  <div class="flex justify-end">
    <Button type="submit" loading={changeSending} disabled={!changeKind || !changeNote}>
      Envoyer
    </Button>
  </div>
</form>
