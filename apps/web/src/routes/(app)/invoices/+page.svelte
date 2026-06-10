<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import { toast } from '$lib/stores/toast';

  interface InvoiceRow {
    id: string;
    invoiceNumber: string;
    status: string;
    currency: string;
    totalAmount: string;
    approvedAt: string | null;
    createdAt: string;
    carrier: { id: string; name: string };
    lines: { id: string; description: string; amount: string }[];
  }

  interface CarrierOption {
    id: string;
    name: string;
  }

  let invoices = $state<InvoiceRow[]>([]);
  let carriers = $state<CarrierOption[]>([]);
  let selectedCarrierId = $state('');
  let expanded = $state('');
  let error = $state('');

  async function load() {
    try {
      invoices = await api<InvoiceRow[]>('/billing/invoices');
      const result = await api<Paginated<CarrierOption>>('/transportation/carriers', {
        query: { pageSize: 100 },
      });
      carriers = result.items;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load invoices';
    }
  }

  async function draft() {
    try {
      const created = await api<InvoiceRow>('/billing/invoices/draft', {
        method: 'POST',
        body: { carrierId: selectedCarrierId },
      });
      toast.success(`${created.invoiceNumber} drafted (${created.lines.length} load(s))`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to draft invoice');
    }
  }

  async function approve(invoice: InvoiceRow) {
    try {
      await api(`/billing/invoices/${invoice.id}/approve`, { method: 'POST' });
      toast.success(`${invoice.invoiceNumber} approved`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to approve');
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="page-header">
  <h1>Carrier invoices</h1>
  <div style="display: flex; gap: 8px;">
    <select bind:value={selectedCarrierId} style="width: 220px;">
      <option value="" disabled>Draft for carrier…</option>
      {#each carriers as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
    </select>
    <button class="btn" disabled={!selectedCarrierId} onclick={draft}>Generate draft</button>
  </div>
</div>

<p class="muted">
  A draft bundles the carrier's completed, not-yet-invoiced loads at their estimated cost.
  Approving freezes it.
</p>

{#if error}
  <p class="error-text">{error}</p>
{/if}

<div class="card" style="padding: 0;">
  <table>
    <thead>
      <tr>
        <th>Invoice #</th>
        <th>Carrier</th>
        <th>Loads</th>
        <th>Total</th>
        <th>Status</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each invoices as invoice (invoice.id)}
        <tr>
          <td>
            <button
              class="linklike"
              onclick={() => (expanded = expanded === invoice.id ? '' : invoice.id)}
            >
              <strong>{invoice.invoiceNumber}</strong>
            </button>
          </td>
          <td>{invoice.carrier.name}</td>
          <td>{invoice.lines.length}</td>
          <td>{Number(invoice.totalAmount).toLocaleString()} {invoice.currency}</td>
          <td><StatusBadge status={invoice.status} /></td>
          <td style="text-align: right;">
            {#if invoice.status === 'DRAFT'}
              <button class="btn btn-sm" onclick={() => approve(invoice)}>Approve</button>
            {/if}
          </td>
        </tr>
        {#if expanded === invoice.id}
          <tr>
            <td colspan="6" style="background: var(--color-bg);">
              <table>
                <tbody>
                  {#each invoice.lines as line (line.id)}
                    <tr>
                      <td>{line.description}</td>
                      <td style="text-align: right;">
                        {Number(line.amount).toLocaleString()} {invoice.currency}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </td>
          </tr>
        {/if}
      {:else}
        <tr><td colspan="6" class="muted">No invoices yet.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .linklike {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--color-primary);
    font-size: 13px;
  }
</style>
