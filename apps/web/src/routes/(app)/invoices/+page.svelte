<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { getAccessToken } from '$lib/stores/auth';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import { toast } from '$lib/stores/toast';

  interface LineRow {
    id: string;
    description: string;
    amount: string;
    invoicedAmount: string | null;
    variance: string | null;
  }
  interface InvoiceRow {
    id: string;
    invoiceNumber: string;
    status: string;
    currency: string;
    totalAmount: string;
    invoicedTotal: string | null;
    varianceTotal: string | null;
    varianceGross: string | null;
    carrierInvoiceNumber: string | null;
    disputeReasonCode: string | null;
    disputeNote: string | null;
    approvedAt: string | null;
    paidAt: string | null;
    createdAt: string;
    carrier: { id: string; name: string };
    lines: LineRow[];
  }
  interface CarrierOption {
    id: string;
    name: string;
  }

  const REASON_CODES = [
    'RATE_MISMATCH',
    'QUANTITY_MISMATCH',
    'UNEXPECTED_CHARGE',
    'DUPLICATE_BILLING',
    'OTHER',
  ];

  let invoices = $state<InvoiceRow[]>([]);
  let carriers = $state<CarrierOption[]>([]);
  let selectedCarrierId = $state('');
  let statusFilter = $state('');
  let expanded = $state('');
  let error = $state('');

  // Reconcile form state (per expanded invoice)
  let carrierInvoiceNumber = $state('');
  let invoicedAmounts = $state<Record<string, string>>({});

  // Dispute resolution form state
  let resolution = $state<'ACCEPT_INVOICED' | 'KEEP_EXPECTED'>('ACCEPT_INVOICED');
  let reasonCode = $state('RATE_MISMATCH');
  let disputeNote = $state('');

  async function load() {
    try {
      invoices = await api<InvoiceRow[]>('/billing/invoices', {
        query: { status: statusFilter || undefined },
      });
      const result = await api<Paginated<CarrierOption>>('/transportation/carriers', {
        query: { pageSize: 100 },
      });
      carriers = result.items;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load invoices';
    }
  }

  function expand(invoice: InvoiceRow) {
    expanded = expanded === invoice.id ? '' : invoice.id;
    carrierInvoiceNumber = invoice.carrierInvoiceNumber ?? '';
    invoicedAmounts = Object.fromEntries(
      invoice.lines.map((l) => [l.id, l.invoicedAmount ?? l.amount]),
    );
    // The dispute form state is shared across rows — reset it so invoice A's
    // resolution/note never pre-fills invoice B's form.
    resolution = 'ACCEPT_INVOICED';
    reasonCode = 'RATE_MISMATCH';
    disputeNote = '';
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

  async function reconcile(invoice: InvoiceRow) {
    try {
      const result = await api<InvoiceRow>(`/billing/invoices/${invoice.id}/reconcile`, {
        method: 'POST',
        body: {
          carrierInvoiceNumber,
          lines: invoice.lines.map((l) => {
            // An emptied input must mean "unchanged", not "invoiced 0".
            const parsed = Number(invoicedAmounts[l.id]);
            return {
              lineId: l.id,
              invoicedAmount:
                Number.isFinite(parsed) && invoicedAmounts[l.id] !== ''
                  ? parsed
                  : Number(l.amount),
            };
          }),
        },
      });
      toast.success(
        result.status === 'APPROVED'
          ? `${invoice.invoiceNumber} reconciled — within tolerance, approved`
          : `${invoice.invoiceNumber} disputed (gross variance ${result.varianceGross})`,
      );
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to reconcile');
    }
  }

  async function resolve(invoice: InvoiceRow) {
    try {
      await api(`/billing/invoices/${invoice.id}/resolve-dispute`, {
        method: 'POST',
        body: { resolution, reasonCode, note: disputeNote || undefined },
      });
      toast.success(`${invoice.invoiceNumber} dispute resolved`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to resolve dispute');
    }
  }

  async function approve(invoice: InvoiceRow) {
    try {
      await api(`/billing/invoices/${invoice.id}/approve`, { method: 'POST' });
      toast.success(`${invoice.invoiceNumber} approved (self-billing, no reconciliation)`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to approve');
    }
  }

  async function markPaid(invoice: InvoiceRow) {
    try {
      await api(`/billing/invoices/${invoice.id}/mark-paid`, { method: 'POST', body: {} });
      toast.success(`${invoice.invoiceNumber} marked paid`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to mark paid');
    }
  }

  async function exportCsv() {
    const query = statusFilter ? `?status=${statusFilter}` : '';
    const res = await fetch(`/api/v1/billing/invoices/export.csv${query}`, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
    });
    if (!res.ok) {
      toast.error('Export failed');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'invoices.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  $effect(() => {
    void statusFilter;
    void load();
  });
</script>

<div class="page-header">
  <h1>Carrier invoices</h1>
  <div style="display: flex; gap: 8px;">
    <select bind:value={statusFilter} style="width: 140px;">
      <option value="">All statuses</option>
      <option value="DRAFT">Draft</option>
      <option value="DISPUTED">Disputed</option>
      <option value="APPROVED">Approved</option>
      <option value="PAID">Paid</option>
    </select>
    <button class="btn btn-sm" onclick={exportCsv}>Export CSV</button>
    <select bind:value={selectedCarrierId} style="width: 220px;">
      <option value="" disabled>Draft for carrier…</option>
      {#each carriers as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
    </select>
    <button class="btn" disabled={!selectedCarrierId} onclick={draft}>Generate draft</button>
  </div>
</div>

<p class="muted">
  A draft bundles the carrier's completed, not-yet-invoiced loads at their estimated cost
  (the expected amount). Reconcile it against the carrier's actual invoice: within tolerance
  it is approved automatically; over tolerance it goes to dispute.
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
        <th>Expected</th>
        <th>Invoiced</th>
        <th>Variance (net / gross)</th>
        <th>Status</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each invoices as invoice (invoice.id)}
        <tr>
          <td>
            <button class="linklike" onclick={() => expand(invoice)}>
              <strong>{invoice.invoiceNumber}</strong>
            </button>
          </td>
          <td>{invoice.carrier.name}</td>
          <td>{Number(invoice.totalAmount).toLocaleString()} {invoice.currency}</td>
          <td>
            {invoice.invoicedTotal !== null
              ? `${Number(invoice.invoicedTotal).toLocaleString()} ${invoice.currency}`
              : '—'}
          </td>
          <td>
            {invoice.varianceGross !== null
              ? `${Number(invoice.varianceTotal).toLocaleString()} / ${Number(invoice.varianceGross).toLocaleString()}`
              : '—'}
          </td>
          <td><StatusBadge status={invoice.status} /></td>
          <td style="text-align: right;">
            {#if invoice.status === 'DRAFT'}
              <button class="btn btn-sm" onclick={() => approve(invoice)}>Approve as-is</button>
            {:else if invoice.status === 'APPROVED'}
              <button class="btn btn-sm" onclick={() => markPaid(invoice)}>Mark paid</button>
            {/if}
          </td>
        </tr>
        {#if expanded === invoice.id}
          <tr>
            <td colspan="7" style="background: var(--color-bg);">
              <table>
                <tbody>
                  {#each invoice.lines as line (line.id)}
                    <tr>
                      <td>{line.description}</td>
                      <td style="text-align: right;">
                        {Number(line.amount).toLocaleString()} {invoice.currency}
                      </td>
                      <td style="text-align: right; width: 160px;">
                        {#if invoice.status === 'DRAFT' || invoice.status === 'DISPUTED'}
                          <input
                            type="number"
                            step="0.01"
                            bind:value={invoicedAmounts[line.id]}
                            style="width: 120px; text-align: right;"
                          />
                        {:else if line.invoicedAmount !== null}
                          {Number(line.invoicedAmount).toLocaleString()}
                          {#if line.variance !== null && Number(line.variance) !== 0}
                            <span class="error-text">({Number(line.variance) > 0 ? '+' : ''}{line.variance})</span>
                          {/if}
                        {:else}
                          —
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>

              {#if invoice.status === 'DRAFT' || invoice.status === 'DISPUTED'}
                <div style="display: flex; gap: 8px; padding: 8px; align-items: center;">
                  <input
                    placeholder="Carrier invoice #"
                    bind:value={carrierInvoiceNumber}
                    style="width: 200px;"
                  />
                  <button
                    class="btn btn-sm"
                    disabled={!carrierInvoiceNumber}
                    onclick={() => reconcile(invoice)}
                  >
                    {invoice.status === 'DISPUTED' ? 'Re-reconcile (corrected invoice)' : 'Reconcile'}
                  </button>
                </div>
              {/if}

              {#if invoice.status === 'DISPUTED'}
                <div style="display: flex; gap: 8px; padding: 8px; align-items: center;">
                  <select bind:value={resolution} style="width: 180px;">
                    <option value="ACCEPT_INVOICED">Pay invoiced amount</option>
                    <option value="KEEP_EXPECTED">Pay expected amount</option>
                  </select>
                  <select bind:value={reasonCode} style="width: 200px;">
                    {#each REASON_CODES as code (code)}<option value={code}>{code}</option>{/each}
                  </select>
                  <input placeholder="Note (optional)" bind:value={disputeNote} style="flex: 1;" />
                  <button class="btn btn-sm" onclick={() => resolve(invoice)}>Resolve dispute</button>
                </div>
              {/if}

              {#if invoice.disputeReasonCode}
                <p class="muted" style="padding: 0 8px;">
                  Dispute: {invoice.disputeReasonCode}{invoice.disputeNote ? ` — ${invoice.disputeNote}` : ''}
                </p>
              {/if}
            </td>
          </tr>
        {/if}
      {:else}
        <tr><td colspan="7" class="muted">No invoices yet.</td></tr>
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
