<script lang="ts">
  import { Field, Select, Textarea, Button } from '$lib/components/ui';
  import { PortalApiError } from '../api';
  import type { PortalClient } from '../client';
  import type { PortalView } from '../types';

  let { client, view }: { client: PortalClient; view: PortalView } = $props();

  let changeKind = $state('');
  let changeOrderId = $state('');
  let changeShipmentId = $state('');
  let changeNote = $state('');
  let changeNotice = $state('');
  let changeSending = $state(false);
  let changeError = $state('');

  const selectedOrderForChange = $derived(view.orders.find((o) => o.id === changeOrderId) ?? null);

  async function submitChange(event: SubmitEvent) {
    event.preventDefault();
    changeNotice = '';
    changeError = '';
    changeSending = true;
    try {
      await client.post('/change-requests', {
        kind: changeKind,
        note: changeNote,
        orderId: changeOrderId || undefined,
        shipmentId: changeShipmentId || undefined,
      });
      changeNotice = 'Demande envoyée.';
      changeKind = '';
      changeOrderId = '';
      changeShipmentId = '';
      changeNote = '';
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
  <Field label="Type de demande">
    <Select bind:value={changeKind} required>
      <option value="" disabled>Sélectionner…</option>
      <option value="DATE">DATE</option>
      <option value="ADDRESS">ADDRESS</option>
      <option value="CANCEL">CANCEL</option>
      <option value="OTHER">OTHER</option>
    </Select>
  </Field>
  <Field label="Commande (optionnel)">
    <Select bind:value={changeOrderId}>
      <option value="">— Toutes —</option>
      {#each view.orders as order (order.id)}
        <option value={order.id}>{order.orderNumber}</option>
      {/each}
    </Select>
  </Field>
  {#if selectedOrderForChange && selectedOrderForChange.shipments.length > 0}
    <Field label="Envoi (optionnel)">
      <Select bind:value={changeShipmentId}>
        <option value="">— Tous —</option>
        {#each selectedOrderForChange.shipments as shipment (shipment.id)}
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
