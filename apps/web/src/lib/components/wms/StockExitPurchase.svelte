<script lang="ts">
  import { api } from '$lib/api/client';
  import { Button, Skeleton } from '$lib/components/ui';
  let { id }: { id: string } = $props();
  type Purchase = {
    orderId: string;
    orderNumber: string;
    position: number;
    name: string;
    receiptId: string;
    receiptNumber: string;
    receivedQuantity: string;
    unit: string;
    unitPrice: string;
    currency: string;
  };
  let snapshot = $state<Purchase | null>(null),
    available = $state(false),
    loading = $state(true),
    error = $state('');
  $effect(() => {
    let active = true;
    snapshot = null;
    loading = true;
    error = '';
    api<{ available: boolean; snapshot?: Purchase }>(`/wms/stock-exits/${id}/purchase`)
      .then((r) => {
        if (active) {
          available = r.available;
          snapshot = r.snapshot ?? null;
        }
      })
      .catch((e) => {
        if (active) error = e.message;
      })
      .finally(() => {
        if (active) loading = false;
      });
    return () => {
      active = false;
    };
  });
</script>

{#if loading}<Skeleton rows={2} />{:else if error}<p role="alert" class="text-sm text-danger">
    {error}
  </p>{:else if available}
  <section
    class="space-y-2 rounded-lg border border-edge p-4"
    aria-label="Réception d’achat rattachée"
  >
    <h3 class="font-semibold">Réception d’achat rattachée</h3>
    {#if snapshot}
      <p class="text-sm break-words">
        {snapshot.orderNumber} · ligne {snapshot.position + 1} · {snapshot.name}
      </p>
      <p class="text-sm text-ink-muted">
        {snapshot.receiptNumber} : {snapshot.receivedQuantity}
        {snapshot.unit} reçus · prix d’achat capturé {snapshot.unitPrice}
        {snapshot.currency} / {snapshot.unit}.
      </p>
      <Button variant="ghost" href={`/purchasing/orders/${snapshot.orderId}/receiving`}
        >Voir la réception d’achat</Button
      >
      <p class="text-xs text-ink-muted">
        Rattachement documentaire figé. La quantité reçue reste historique; aucun avoir,
        remboursement ni réouverture de commande.
      </p>
    {:else}<p class="text-sm text-ink-muted">
        Retour autonome, sans ligne d’achat rattachée. Aucune provenance d’achat supposée.
      </p>{/if}
  </section>
{/if}
