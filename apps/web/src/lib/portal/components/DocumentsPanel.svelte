<script lang="ts">
  import type { PortalClient } from '../client';
  import type { PortalView, PortalDocument } from '../types';

  let { client, view }: { client: PortalClient; view: PortalView } = $props();

  let shipmentDocs = $state<Record<string, PortalDocument[]>>({});
  let shipmentDocsOpen = $state<Record<string, boolean>>({});
  let shipmentDocsLoading = $state<Record<string, boolean>>({});

  async function loadShipmentDocs(shipmentId: string) {
    if (shipmentDocsLoading[shipmentId]) return;
    shipmentDocsLoading = { ...shipmentDocsLoading, [shipmentId]: true };
    try {
      const docs = await client.get<PortalDocument[]>(`/shipments/${shipmentId}/documents`);
      shipmentDocs = { ...shipmentDocs, [shipmentId]: docs };
    } catch {
      shipmentDocs = { ...shipmentDocs, [shipmentId]: [] };
    } finally {
      shipmentDocsLoading = { ...shipmentDocsLoading, [shipmentId]: false };
    }
  }

  function toggleShipmentDocs(shipmentId: string) {
    const isOpen = shipmentDocsOpen[shipmentId];
    shipmentDocsOpen = { ...shipmentDocsOpen, [shipmentId]: !isOpen };
    if (!isOpen && !(shipmentId in shipmentDocs)) {
      void loadShipmentDocs(shipmentId);
    }
  }

  async function downloadDoc(doc: PortalDocument) {
    const blob = await client.download(`/documents/${doc.id}/download`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

{#if view.orders.length === 0}
  <p class="text-sm text-ink-muted">Aucune commande.</p>
{:else}
  <div class="flex flex-col divide-y divide-edge">
    {#each view.orders as order (order.orderNumber)}
      <div class="py-4">
        <p class="mb-2 font-semibold text-ink">{order.orderNumber}</p>
        {#if order.shipments.length === 0}
          <p class="text-xs text-ink-muted">Aucun envoi.</p>
        {:else}
          {#each order.shipments as shipment (shipment.id)}
            <div class="mb-2">
              <button
                type="button"
                class="text-sm text-accent hover:underline"
                onclick={() => toggleShipmentDocs(shipment.id)}
              >
                {shipment.shipmentNumber} — Documents
                {#if shipmentDocs[shipment.id]}({shipmentDocs[shipment.id].length}){/if}
              </button>
              {#if shipmentDocsOpen[shipment.id]}
                {#if shipmentDocsLoading[shipment.id]}
                  <p class="mt-1 text-xs text-ink-muted">Chargement…</p>
                {:else if !shipmentDocs[shipment.id] || shipmentDocs[shipment.id].length === 0}
                  <p class="mt-1 text-xs text-ink-muted">Aucun document.</p>
                {:else}
                  <ul class="mt-1 space-y-1">
                    {#each shipmentDocs[shipment.id] as doc (doc.id)}
                      <li class="flex items-center gap-2 text-sm">
                        <span class="text-ink">{doc.fileName}</span>
                        <button
                          type="button"
                          class="text-xs text-accent hover:underline"
                          onclick={() => downloadDoc(doc)}
                        >
                          Télécharger
                        </button>
                      </li>
                    {/each}
                  </ul>
                {/if}
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {/each}
  </div>
{/if}
