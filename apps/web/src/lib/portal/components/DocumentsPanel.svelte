<!--
  Documents section: a flat list aggregated across every shipment of every
  order in `view`, sorted most-recent-first (spec B5). One round-trip per
  shipment (`GET /shipments/:id/documents`), bounded to a handful in flight at
  once so a customer with many shipments doesn't fire dozens of requests at
  the same instant.
-->
<script lang="ts">
  import { Card, EmptyState, ErrorNotice, PageHeader, Skeleton, Table } from '$lib/components/ui';
  import { formatDate } from '$lib/format';
  import { PortalApiError } from '../api';
  import type { PortalClient } from '../client';
  import type { PortalDocument, PortalView } from '../types';

  let { client, view }: { client: PortalClient; view: PortalView } = $props();

  interface DocumentRow extends PortalDocument {
    shipmentNumber: string;
    orderNumber: string;
  }

  let rows = $state<DocumentRow[]>([]);
  let loading = $state(true);
  let error = $state('');

  /** Runs `fn` over `items` with at most `limit` in flight at once. */
  async function mapLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let cursor = 0;
    async function worker() {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const targets = view.orders.flatMap((order) =>
        order.shipments.map((shipment) => ({ order, shipment })),
      );
      const perShipment = await mapLimit(targets, 5, async ({ order, shipment }) => {
        try {
          const docs = await client.get<PortalDocument[]>(`/shipments/${shipment.id}/documents`);
          return docs.map<DocumentRow>((doc) => ({
            ...doc,
            shipmentNumber: shipment.shipmentNumber,
            orderNumber: order.orderNumber,
          }));
        } catch {
          // One shipment's documents failing to load must not blank the rest.
          return [] as DocumentRow[];
        }
      });
      rows = perShipment.flat().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    } catch {
      rows = [];
      error = 'Impossible de charger les documents.';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void view;
    void load();
  });

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

<PageHeader
  title="Documents"
  subtitle="Tous les documents de vos expéditions, du plus récent au plus ancien."
  count={loading ? undefined : rows.length}
/>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <Card padded={false}><Skeleton rows={5} /></Card>
{:else if rows.length === 0}
  <Card>
    <EmptyState
      title="Aucun document"
      message="Les documents liés à vos expéditions (preuves de livraison, bons, etc.) apparaîtront ici dès qu'ils seront disponibles."
    />
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Document</th><th>Expédition</th><th>Commande</th><th>Date</th><th class="text-right"
        >Action</th
      >
    {/snippet}
    {#snippet body()}
      {#each rows as doc (doc.id)}
        <tr>
          <td class="text-ink">{doc.fileName}</td>
          <td class="text-ink-muted">{doc.shipmentNumber}</td>
          <td class="text-ink-muted">{doc.orderNumber}</td>
          <td class="text-ink-muted">{formatDate(doc.createdAt)}</td>
          <td class="text-right">
            <button
              type="button"
              class="text-sm font-medium text-accent hover:underline"
              onclick={() => downloadDoc(doc)}
            >
              Télécharger
            </button>
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}
