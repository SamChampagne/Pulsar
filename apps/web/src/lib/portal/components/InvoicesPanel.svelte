<script lang="ts">
  import { Badge, toneFor, labelFor } from '$lib/components/ui';
  import { formatDate } from '$lib/format';
  import type { PortalClient } from '../client';
  import type { Invoice } from '../types';

  let { client, active }: { client: PortalClient; active: boolean } = $props();

  let invoices = $state<Invoice[]>([]);
  let loaded = $state(false);
  let loading = $state(false);

  async function loadInvoices() {
    if (loaded || loading) return;
    loading = true;
    try {
      invoices = await client.get<Invoice[]>('/invoices');
      loaded = true;
    } catch {
      invoices = [];
    } finally {
      loading = false;
    }
  }

  // Lazy load: fetch only once the tab is first activated.
  $effect(() => {
    if (active && !loaded) void loadInvoices();
  });
</script>

{#if loading}
  <p class="text-sm text-ink-muted">Chargement…</p>
{:else if loaded && invoices.length === 0}
  <p class="text-sm text-ink-muted">Aucune facture.</p>
{:else}
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-edge text-left text-xs text-ink-muted">
          <th class="pb-2 pr-4">Numéro</th>
          <th class="pb-2 pr-4">Statut</th>
          <th class="pb-2 pr-4">Montant</th>
          <th class="pb-2 pr-4">Envoyée</th>
          <th class="pb-2">Payée</th>
        </tr>
      </thead>
      <tbody>
        {#each invoices as invoice (invoice.invoiceNumber)}
          <tr class="border-b border-edge last:border-0">
            <td class="py-2 pr-4 font-mono text-ink">{invoice.invoiceNumber}</td>
            <td class="py-2 pr-4">
              <Badge tone={toneFor(invoice.status)}>{labelFor(invoice.status)}</Badge>
            </td>
            <td class="py-2 pr-4 text-ink">{invoice.currency} {invoice.totalAmount.toFixed(2)}</td>
            <td class="py-2 pr-4 text-ink-muted"
              >{invoice.sentAt ? formatDate(invoice.sentAt) : '—'}</td
            >
            <td class="py-2 text-ink-muted">{invoice.paidAt ? formatDate(invoice.paidAt) : '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
