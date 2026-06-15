<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Button, Card, EmptyState, PageHeader, Skeleton } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  type PickStatus = 'NOT_PICKED' | 'PICKING' | 'PICKED';

  interface PickOrderRef {
    id: string;
    number: string;
    status: string;
  }

  interface PendingShipment {
    id: string;
    shipmentNumber: string;
    status: string;
    originLocationId: string;
    originLocation: { code: string; name: string } | null;
    destinationLocation: { code: string; name: string } | null;
    weightKg: string | number | null;
    plannedPickupEarly: string | null;
    pickOrders: PickOrderRef[];
    pickStatus: PickStatus;
  }

  let shipments = $state<PendingShipment[]>([]);
  let loading = $state(true);
  let error = $state('');
  let creatingId = $state<string | null>(null);

  function pickStatusTone(status: PickStatus): Tone {
    switch (status) {
      case 'PICKED':
        return 'ok';
      case 'PICKING':
        return 'warn';
      case 'NOT_PICKED':
      default:
        return 'neutral';
    }
  }

  function pickStatusLabel(status: PickStatus): string {
    switch (status) {
      case 'PICKED':
        return 'Préparé';
      case 'PICKING':
        return 'En préparation';
      case 'NOT_PICKED':
      default:
        return 'À préparer';
    }
  }

  function formatDate(value: string | null): string {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }

  function formatWeight(value: string | number | null): string {
    if (value === null || value === undefined) return '—';
    const n = Number(value);
    return Number.isNaN(n) ? '—' : `${n} kg`;
  }

  async function load() {
    loading = true;
    error = '';
    try {
      shipments = await api<PendingShipment[]>('/wms/fulfillment/pending');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des shipments à préparer';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  async function createPickOrder(shipment: PendingShipment) {
    creatingId = shipment.id;
    try {
      await api('/wms/pick-orders', {
        method: 'POST',
        body: { locationId: shipment.originLocationId, shipmentId: shipment.id },
      });
      toast.success('Pick order créé');
      await goto(`/wms/picking?shipmentId=${shipment.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création du pick order');
    } finally {
      creatingId = null;
    }
  }
</script>

<PageHeader title="Préparation" />

<div class="mb-4">
  <a href="/wms" class="text-sm text-accent hover:underline">← Warehouse</a>
</div>

{#if loading}
  <div class="grid gap-3">
    {#each Array(4) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else}
  <Card padded={false}>
    {#if shipments.length === 0}
      <EmptyState message="Aucun shipment à préparer." />
    {:else}
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-edge text-left text-xs text-ink-faint">
            <th class="px-4 py-2.5 font-medium">Shipment</th>
            <th class="px-4 py-2.5 font-medium">Trajet</th>
            <th class="px-4 py-2.5 font-medium">Enlèvement prévu</th>
            <th class="px-4 py-2.5 font-medium">Poids</th>
            <th class="px-4 py-2.5 font-medium">Préparation</th>
            <th class="px-4 py-2.5 font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-edge">
          {#each shipments as s (s.id)}
            <tr class="hover:bg-surface-muted">
              <td class="px-4 py-2.5 font-medium text-ink">{s.shipmentNumber}</td>
              <td class="px-4 py-2.5 text-ink-muted">
                {s.originLocation?.code ?? '—'} <span class="text-ink-faint">→</span>
                {s.destinationLocation?.code ?? '—'}
              </td>
              <td class="px-4 py-2.5 text-ink-muted">{formatDate(s.plannedPickupEarly)}</td>
              <td class="px-4 py-2.5 text-ink-muted">{formatWeight(s.weightKg)}</td>
              <td class="px-4 py-2.5">
                <Badge tone={pickStatusTone(s.pickStatus)}>{pickStatusLabel(s.pickStatus)}</Badge>
              </td>
              <td class="px-4 py-2.5 text-right">
                {#if s.pickStatus === 'NOT_PICKED'}
                  <Button loading={creatingId === s.id} onclick={() => createPickOrder(s)}>
                    Créer le pick order
                  </Button>
                {:else}
                  <a
                    href={`/wms/picking?shipmentId=${s.id}`}
                    class="text-sm text-accent hover:underline"
                  >
                    Voir le pick
                  </a>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </Card>
{/if}
