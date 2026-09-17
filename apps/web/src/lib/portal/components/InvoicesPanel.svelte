<!--
  Invoices section: full table + a compact "totals by status/currency" summary
  (spec B5). Shared by the session workspace (`/portal/invoices`) and the
  capability-link plane (`/portal/:token`, `active` gates the lazy fetch there).
-->
<script lang="ts">
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorNotice,
    PageHeader,
    Skeleton,
    Table,
    toneFor,
    labelFor,
  } from '$lib/components/ui';
  import { formatDate, formatMoney } from '$lib/format';
  import { PortalApiError } from '../api';
  import type { PortalClient } from '../client';
  import type { Invoice } from '../types';

  let { client, active }: { client: PortalClient; active: boolean } = $props();

  let invoices = $state<Invoice[]>([]);
  let loaded = $state(false);
  let loading = $state(false);
  let error = $state('');
  let downloadingId = $state('');

  interface TotalRow {
    currency: string;
    status: string;
    count: number;
    total: number;
  }

  /** Totals grouped by currency then status — the numbers the spec asks for. */
  const totals = $derived.by<TotalRow[]>(() => {
    const byGroup = new Map<string, TotalRow>();
    for (const invoice of invoices) {
      const key = `${invoice.currency}:${invoice.status}`;
      const row = byGroup.get(key) ?? {
        currency: invoice.currency,
        status: invoice.status,
        count: 0,
        total: 0,
      };
      row.count += 1;
      row.total += invoice.totalAmount;
      byGroup.set(key, row);
    }
    return [...byGroup.values()].sort(
      (a, b) => a.currency.localeCompare(b.currency) || a.status.localeCompare(b.status),
    );
  });

  async function loadInvoices() {
    if (loading) return;
    loading = true;
    error = '';
    try {
      invoices = await client.get<Invoice[]>('/invoices');
      loaded = true;
    } catch (e) {
      invoices = [];
      error = e instanceof PortalApiError ? e.message : 'Impossible de charger les factures.';
    } finally {
      // A failed fetch still counts as an attempt: the lazy-load effect must not loop on the error.
      loaded = true;
      loading = false;
    }
  }

  async function downloadPdf(invoice: Invoice) {
    downloadingId = invoice.id;
    try {
      const blob = await client.download(`/invoices/${invoice.id}/pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${invoice.invoiceNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // The download stays a best-effort convenience: a failure is silent
      // rather than throwing an unrelated error banner over the table.
    } finally {
      downloadingId = '';
    }
  }

  // Lazy load: fetch only once the tab (or page) is first activated.
  $effect(() => {
    if (active && !loaded && !loading) void loadInvoices();
  });
</script>

<PageHeader
  title="Factures"
  subtitle="Vos relevés de facturation, leur statut et leur téléchargement PDF."
  count={loaded ? invoices.length : undefined}
/>

<ErrorNotice message={error} onretry={loadInvoices} />

{#if loading && !loaded}
  <Card padded={false}><Skeleton rows={5} /></Card>
{:else if loaded && invoices.length === 0}
  <Card><EmptyState title="Aucune facture" message="Vos factures apparaîtront ici." /></Card>
{:else if loaded}
  {#if totals.length > 1}
    <div class="mb-4">
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Totaux par statut et devise
      </h2>
      <Table>
        {#snippet head()}
          <th>Devise</th><th>Statut</th><th>Nombre</th><th>Montant</th>
        {/snippet}
        {#snippet body()}
          {#each totals as row (`${row.currency}:${row.status}`)}
            <tr>
              <td class="font-mono text-xs text-ink-faint">{row.currency}</td>
              <td><Badge tone={toneFor(row.status)}>{labelFor(row.status)}</Badge></td>
              <td class="text-ink-muted">{row.count}</td>
              <td class="text-ink">{formatMoney(row.total, row.currency)}</td>
            </tr>
          {/each}
        {/snippet}
      </Table>
    </div>
  {/if}

  <Table>
    {#snippet head()}
      <th>Numéro</th><th>Statut</th><th>Montant net</th><th>Taxe</th><th>Total</th><th>Envoyée</th
      ><th>Payée</th><th class="text-right">Action</th>
    {/snippet}
    {#snippet body()}
      {#each invoices as invoice (invoice.id)}
        <tr>
          <td class="font-mono text-ink">{invoice.invoiceNumber}</td>
          <td><Badge tone={toneFor(invoice.status)}>{labelFor(invoice.status)}</Badge></td>
          <td class="text-ink-muted">{formatMoney(invoice.netAmount, invoice.currency)}</td>
          <td class="text-ink-muted">{formatMoney(invoice.taxAmount, invoice.currency)}</td>
          <td class="text-ink">{formatMoney(invoice.totalAmount, invoice.currency)}</td>
          <td class="text-ink-muted">{invoice.sentAt ? formatDate(invoice.sentAt) : '—'}</td>
          <td class="text-ink-muted">{invoice.paidAt ? formatDate(invoice.paidAt) : '—'}</td>
          <td class="text-right">
            <Button
              variant="secondary"
              loading={downloadingId === invoice.id}
              onclick={() => downloadPdf(invoice)}
            >
              PDF
            </Button>
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}
