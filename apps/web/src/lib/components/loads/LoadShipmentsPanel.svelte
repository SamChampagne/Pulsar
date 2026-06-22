<script lang="ts">
  import { Badge, Button, Card, Field } from '$lib/components/ui';
  import { toneFor, labelFor } from '$lib/components/ui';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import type { ShipmentOnLoad } from './types';

  interface Props {
    shipments: ShipmentOnLoad[];
    loadStatus: string;
    onReload: () => Promise<void>;
  }

  const { shipments, loadStatus, onReload }: Props = $props();

  let podShipment = $state<ShipmentOnLoad | null>(null);
  let podForm = $state({ signedByName: '', notes: '' });

  async function capturePod() {
    if (!podShipment) return;
    try {
      await api('/transportation/tracking/pod', {
        method: 'POST',
        body: {
          shipmentId: podShipment.id,
          signedByName: podForm.signedByName || undefined,
          notes: podForm.notes || undefined,
        },
      });
      toast.success(`POD captured for ${podShipment.shipmentNumber}`);
      podShipment = null;
      podForm = { signedByName: '', notes: '' };
      await onReload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to capture POD');
    }
  }
</script>

<Card>
  <h2 class="mb-3 font-semibold text-ink">Shipments</h2>
  {#if shipments.length === 0}
    <p class="text-sm text-ink-muted">
      Empty load — assign shipments from the <a href="/shipments" class="text-accent hover:underline">Shipments</a> page.
    </p>
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-edge text-xs text-ink-muted uppercase tracking-wide">
            <th class="pb-2 text-left font-semibold">Shipment #</th>
            <th class="pb-2 text-left font-semibold">Status</th>
            <th class="pb-2 text-left font-semibold">POD</th>
            <th class="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {#each shipments as shipment (shipment.id)}
            <tr class="border-b border-edge last:border-0">
              <td class="py-2 pr-2">
                <a href={`/transport-orders/${shipment.transportOrderId}`} class="font-semibold text-accent hover:underline">
                  {shipment.shipmentNumber}
                </a>
              </td>
              <td class="py-2 pr-2">
                <Badge tone={toneFor(shipment.status)}>{labelFor(shipment.status)}</Badge>
              </td>
              <td class="py-2 pr-2">
                {#if shipment.proofOfDelivery}
                  <Badge tone="ok">{shipment.proofOfDelivery.signedByName ?? 'Signed'}</Badge>
                {:else}
                  <span class="text-ink-muted">—</span>
                {/if}
              </td>
              <td class="py-2 text-right">
                {#if !shipment.proofOfDelivery && (shipment.status === 'IN_TRANSIT' || shipment.status === 'DELIVERED')}
                  <Button variant="secondary" onclick={() => { podShipment = shipment; }}>Capture POD</Button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if podShipment}
    <div class="mt-4 border-t border-edge pt-4">
      <h3 class="mb-3 font-semibold text-ink">POD — {podShipment.shipmentNumber}</h3>
      <div class="flex flex-col gap-3">
        <Field label="Signed by">
          <input
            id="signedBy"
            bind:value={podForm.signedByName}
            placeholder="Receiver name"
            class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </Field>
        <Field label="Notes">
          <textarea
            id="podNotes"
            rows="2"
            bind:value={podForm.notes}
            class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          ></textarea>
        </Field>
        <div class="flex gap-2">
          <Button variant="primary" onclick={capturePod}>Save POD</Button>
          <Button variant="secondary" onclick={() => { podShipment = null; }}>Cancel</Button>
        </div>
      </div>
    </div>
  {/if}
</Card>
